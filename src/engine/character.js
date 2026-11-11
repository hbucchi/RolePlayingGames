/**
 * Character model: a "draft" stores only the player's choices; everything else
 * (final scores, HP, AC, skill bonuses...) is derived from those choices plus the
 * setting's content. Storing choices, not results, means rules fixes or content
 * updates automatically flow into saved characters.
 */
import {
  ABILITY_IDS, ABILITY_METHODS, POINT_BUY, STANDARD_ARRAY,
  abilityModifier, applyBonuses, pointBuyTotal, scoresFilledWith,
} from './abilities.js';
import { SKILLS, SKILLS_BY_ID } from './skills.js';
import { startingGear, gearStats, itemName, itemDef, equippedIn, tidyEquipped } from './items.js';
import { XP_FOR_LEVEL, levelForXp, startingWealth, startingMagic } from './progression.js';
import { addItem, makeItem, carriedWeight, carryCapacity, loadLimits, bagUsed, BAG_SLOTS } from './items.js';
import { magicFor, casterInfo, attacksPerAction, manaFor } from './magic.js';

export const DRAFT_VERSION = 1;

export const STEPS = [
  { id: 'concept', title: 'Name & Concept' },
  { id: 'race', title: 'Kindred' },
  { id: 'class', title: 'Calling' },
  { id: 'abilities', title: 'Abilities' },
  { id: 'skills', title: 'Background & Skills' },
  { id: 'review', title: 'Review' },
];

export function makeId() {
  return globalThis.crypto?.randomUUID?.() ?? `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function newDraft(settingId) {
  return {
    version: DRAFT_VERSION,
    id: makeId(),
    settingId,
    name: '',
    concept: '',
    raceId: null,
    subraceId: null,
    classId: null,
    backgroundId: null,
    abilityMethod: 'roll',
    abilityRolls: Array(6).fill(null), // each: result of rollAbilityScore()
    abilityAssignment: scoresFilledWith(null), // ability -> pool index (roll / standard)
    baseAbilities: scoresFilledWith(null),
    skillChoices: [],
    mode: 'standard', // 'standard': start at level 1 and earn XP; 'sandbox': pick any level
    level: 1,
    xp: 0,
    createdAt: new Date().toISOString(),
    updatedAt: null,
  };
}

/** Proficiency bonus: +2 at levels 1-4, rising by 1 every 4 levels (max +6 at 17-20). */
export function proficiencyBonus(level) {
  return 2 + Math.floor((Math.max(1, Math.min(20, level)) - 1) / 4);
}

/** The values available to place, for pool-based methods. */
export function abilityPool(draft) {
  if (draft.abilityMethod === 'standard') return [...STANDARD_ARRAY];
  if (draft.abilityMethod === 'roll') return draft.abilityRolls.map((r) => (r ? r.total : null));
  return [];
}

/** Rebuild baseAbilities from the pool + assignment (roll / standard methods). */
export function syncBaseFromAssignment(draft) {
  const pool = abilityPool(draft);
  for (const id of ABILITY_IDS) {
    const idx = draft.abilityAssignment[id];
    draft.baseAbilities[id] = idx === null || idx === undefined ? null : pool[idx] ?? null;
  }
  return draft;
}

export function setAbilityMethod(draft, method) {
  if (!ABILITY_METHODS[method]) throw new Error(`Unknown method ${method}`);
  draft.abilityMethod = method;
  draft.abilityAssignment = scoresFilledWith(null);
  draft.baseAbilities = method === 'pointbuy' ? scoresFilledWith(POINT_BUY.min) : scoresFilledWith(null);
  return draft;
}

/** Merge a race with its chosen subrace into a single effective race. */
export function resolveRace(setting, raceId, subraceId) {
  const race = setting.races.find((r) => r.id === raceId);
  if (!race) return null;
  const sub = race.subraces?.find((s) => s.id === subraceId) ?? null;
  const bonuses = { ...race.abilityBonuses };
  for (const [k, v] of Object.entries(sub?.abilityBonuses ?? {})) bonuses[k] = (bonuses[k] ?? 0) + v;
  return {
    id: race.id,
    name: sub ? sub.name : race.name,
    race,
    subrace: sub,
    abilityBonuses: bonuses,
    speed: sub?.speed ?? race.speed,
    size: race.size,
    traits: [...race.traits, ...(sub?.traits ?? [])],
    skillProficiencies: [...(race.skillProficiencies ?? []), ...(sub?.skillProficiencies ?? [])],
    languages: [...race.languages, ...(sub?.languages ?? [])],
    hpPerLevel: (race.hpPerLevel ?? 0) + (sub?.hpPerLevel ?? 0),
  };
}

/** Skills granted automatically by kindred and background (not chosen from the class list). */
export function grantedSkills(draft, setting) {
  const race = resolveRace(setting, draft.raceId, draft.subraceId);
  const bg = setting.backgrounds.find((b) => b.id === draft.backgroundId);
  return [...new Set([...(race?.skillProficiencies ?? []), ...(bg?.skills ?? [])])];
}

/** Drop chosen skills that became invalid (e.g. now granted by a new background). */
export function pruneSkillChoices(draft, setting) {
  const cls = setting.classes.find((c) => c.id === draft.classId);
  const granted = new Set(grantedSkills(draft, setting));
  const allowed = new Set(cls?.skillChoices.from ?? []);
  draft.skillChoices = [...new Set(draft.skillChoices)]
    .filter((s) => allowed.has(s) && !granted.has(s))
    .slice(0, cls?.skillChoices.count ?? 0);
  return draft;
}

// ---------------------------------------------------------------------------
// Validation: one function per wizard step, each returns a list of messages.
// ---------------------------------------------------------------------------

const validators = {
  concept(d) {
    const name = d.name.trim();
    if (!Number.isInteger(d.level ?? 1) || (d.level ?? 1) < 1 || (d.level ?? 1) > 20) return ['Level must be between 1 and 20.'];
    if (name.length < 2) return ['Give your hero a name (at least 2 characters).'];
    if (name.length > 40) return ['Names are limited to 40 characters.'];
    return [];
  },
  race(d, s) {
    const race = s.races.find((r) => r.id === d.raceId);
    if (!race) return ['Choose a kindred.'];
    if (race.subraces?.length && !race.subraces.some((x) => x.id === d.subraceId)) {
      return [`Choose which people of the ${race.name} you hail from.`];
    }
    return [];
  },
  class(d, s) {
    return s.classes.some((c) => c.id === d.classId) ? [] : ['Choose a calling.'];
  },
  abilities(d) {
    const errors = [];
    if (d.abilityMethod === 'roll' && d.abilityRolls.some((r) => !r)) errors.push('Roll all six ability scores.');
    if (d.abilityMethod === 'roll' || d.abilityMethod === 'standard') {
      const used = ABILITY_IDS.map((id) => d.abilityAssignment[id]).filter((i) => i !== null && i !== undefined);
      if (used.length < 6) errors.push('Place a score in every ability.');
      if (new Set(used).size !== used.length) errors.push('Each score can only be placed once.');
    }
    if (d.abilityMethod === 'pointbuy') {
      const ok = ABILITY_IDS.every((id) => Number.isInteger(d.baseAbilities[id])
        && d.baseAbilities[id] >= POINT_BUY.min && d.baseAbilities[id] <= POINT_BUY.max);
      if (!ok) errors.push(`Point-buy scores must be between ${POINT_BUY.min} and ${POINT_BUY.max}.`);
      else if (pointBuyTotal(d.baseAbilities) > POINT_BUY.budget) errors.push(`You have spent more than ${POINT_BUY.budget} points.`);
    }
    if (!errors.length && !ABILITY_IDS.every((id) => Number.isInteger(d.baseAbilities[id]))) {
      errors.push('Every ability needs a score.');
    }
    return errors;
  },
  skills(d, s) {
    const errors = [];
    if (!s.backgrounds.some((b) => b.id === d.backgroundId)) errors.push('Choose a background.');
    const cls = s.classes.find((c) => c.id === d.classId);
    if (cls) {
      const granted = new Set(grantedSkills(d, s));
      const valid = d.skillChoices.filter((x) => cls.skillChoices.from.includes(x) && !granted.has(x));
      if (new Set(valid).size !== cls.skillChoices.count) {
        errors.push(`Choose exactly ${cls.skillChoices.count} skills from your calling (${valid.length} chosen).`);
      }
    }
    return errors;
  },
  review(d, s) {
    return STEPS.slice(0, -1).flatMap((st) => validators[st.id](d, s));
  },
};

export function validateStep(stepId, draft, setting) {
  return validators[stepId](draft, setting);
}

export function isComplete(draft, setting) {
  return validateStep('review', draft, setting).length === 0;
}

// ---------------------------------------------------------------------------
// Derivation: turn choices into a playable character sheet.
// ---------------------------------------------------------------------------

/**
 * Armor Class.
 *  - No armour: 10 + DEX modifier.
 *  - Armour: its base value + DEX modifier, capped for medium armour (dexCap 2), none for heavy (dexCap 0).
 *  - A shield adds +2 on top.
 */
export function armorClass(equipment, dexMod) {
  const armor = equipment.find((e) => e.kind === 'armor');
  const shield = equipment.find((e) => e.kind === 'shield');
  let ac = 10 + dexMod;
  if (armor) {
    const dex = armor.armor.dexCap === null || armor.armor.dexCap === undefined ? dexMod : Math.min(dexMod, armor.armor.dexCap);
    ac = armor.armor.base + dex;
  }
  return ac + (shield ? shield.acBonus ?? 2 : 0);
}

export function deriveCharacter(draft, setting) {
  const race = resolveRace(setting, draft.raceId, draft.subraceId);
  const cls = setting.classes.find((c) => c.id === draft.classId) ?? null;
  const bg = setting.backgrounds.find((b) => b.id === draft.backgroundId) ?? null;
  const level = draft.level ?? 1;
  const pb = proficiencyBonus(level);

  const base = Object.fromEntries(ABILITY_IDS.map((id) => [id, draft.baseAbilities[id] ?? 10]));
  const scores = applyBonuses(base, race?.abilityBonuses);
  // Ability Score Improvements chosen at level-ups (only up to the current level), at most 20.
  for (const [lv, up] of Object.entries(draft.levelUps ?? {})) {
    if (Number(lv) > level) continue;
    for (const [id, n] of Object.entries(up.abilities ?? {})) if (id in scores) scores[id] = Math.min(20, scores[id] + n);
  }
  const mods = Object.fromEntries(ABILITY_IDS.map((id) => [id, abilityModifier(scores[id])]));

  const trained = Object.entries(draft.levelUps ?? {}).filter(([lv, up]) => Number(lv) <= level && up.skill).map(([, up]) => up.skill);
  const profSkills = new Set([...grantedSkills(draft, setting), ...draft.skillChoices, ...trained]);
  const skills = SKILLS.map((sk) => ({
    ...sk,
    proficient: profSkills.has(sk.id),
    source: race?.skillProficiencies.includes(sk.id) ? 'kindred'
      : bg?.skills.includes(sk.id) ? 'background'
        : draft.skillChoices.includes(sk.id) ? 'calling' : trained.includes(sk.id) ? 'training' : null,
    bonus: mods[sk.ability] + (profSkills.has(sk.id) ? pb : 0),
  }));

  const savingThrows = ABILITY_IDS.map((id) => ({
    ability: id,
    proficient: !!cls?.savingThrows.includes(id),
    bonus: mods[id] + (cls?.savingThrows.includes(id) ? pb : 0),
  }));

  // Level 1 HP: the hit die's maximum + CON modifier. Each later level adds the die's
  // average (rounded up) + CON modifier. Kindred bonuses (e.g. dwarven toughness) add per level.
  const hitDie = cls?.hitDie ?? 8;
  const perLevelCon = mods.con + (race?.hpPerLevel ?? 0);
  const baseHp = Math.max(1, hitDie + perLevelCon + (level - 1) * Math.max(1, hitDie / 2 + 1 + perLevelCon));

  // Gear: the hero's own inventory once saved; a preview of the starting kit while in the wizard.
  const gear = draft.inventory ? draft : startingGear(cls, bg);
  const g = gearStats(gear, { mods, scores, pb, weaponProfs: cls?.weaponProficiencies ?? [], armorProfs: cls?.armorProficiencies ?? [] });
  for (const sk of skills) sk.bonus += g.skillBonus[sk.id] ?? 0;
  for (const st of savingThrows) st.bonus += g.saveBonus;
  const ac = g.ac;
  // Encumbrance (items.js): above STR x 10 lb you are burdened (speed -10 ft); STR x 15 lb is the
  // most you can carry (more is only possible with gear from before the limit: speed -20 ft).
  const load = carriedWeight(gear.inventory, gear.coins ?? draft.coins ?? 0);
  const capacity = carryCapacity(scores.str);
  const limits = loadLimits(scores.str);
  const burden = load > capacity ? 20 : load > limits.burdened ? 10 : 0;
  if (burden === 10) g.notes.push(`Burdened (${load} lb; over ${limits.burdened} lb): speed −10 ft.`);
  if (burden === 20) g.notes.push(`Overloaded (${load} / ${capacity} lb): speed −20 ft. Drop something.`);
  const attacks = g.attacks;
  // Ranger Archery style (level 2): +2 to hit with ranged weapons.
  if (cls?.id === 'ranger' && level >= 2) for (const at of attacks) if (at.slot === 'ranged') { at.toHit += 2; at.archery = true; }
  const maxHp = baseHp + g.hpBonus;
  const equipment = gear.inventory.map((x) => ({ uid: x.uid, name: itemName(x), qty: x.qty ?? 1, equipped: Object.values(gear.equipped ?? {}).includes(x.uid) }));

  const perception = skills.find((s) => s.id === 'perception');

  return {
    id: draft.id,
    name: draft.name.trim(),
    concept: draft.concept.trim(),
    level,
    race,
    cls,
    background: bg,
    proficiencyBonus: pb,
    base,
    scores,
    mods,
    savingThrows,
    skills,
    hitDie,
    maxHp,
    ac,
    initiative: mods.dex,
    speed: (race?.speed ?? 30) - g.speedPenalty - burden,
    load, capacity, burdenedAt: limits.burdened, burden,
    bag: { used: bagUsed(gear), slots: BAG_SLOTS },
    // Thieves' tools checks use DEX, plus proficiency if trained (burglars are).
    toolBonus: mods.dex + (cls?.toolProficiencies?.includes('thieves-tools') ? pb : 0),
    xp: draft.xp ?? XP_FOR_LEVEL[level],
    mode: draft.mode ?? 'standard',
    coins: gear.coins ?? draft.coins ?? 0,
    gearNotes: g.notes,
    magic: magicFor(cls, level, mods),
    caster: casterInfo(cls, mods, pb),
    attacksPerAction: attacksPerAction(cls?.id, level),
    passivePerception: 10 + perception.bonus,
    attacks,
    equipment,
    languages: [...new Set(race?.languages ?? [])],
    features: [
      ...(race?.traits ?? []).map((t) => ({ ...t, source: race.name })),
      ...(cls?.features ?? []).map((f) => ({ ...f, source: cls.name })),
      ...(bg ? [{ ...bg.feature, source: bg.name }] : []),
    ],
    armorProficiencies: cls?.armorProficiencies ?? [],
    weaponProficiencies: cls?.weaponProficiencies ?? [],
  };
}

export function skillName(id) {
  return SKILLS_BY_ID[id]?.name ?? id;
}

// ---------------------------------------------------------------------------
// Gear and experience
// ---------------------------------------------------------------------------

/**
 * Give a hero its inventory if it has none yet (new heroes, and saves from before items
 * existed). Sandbox heroes above level 1 also get the wealth and magic of a veteran.
 */
export function ensureGear(draft, setting) {
  if (draft.inventory) { tidyEquipped(draft); return draft; }
  const cls = setting.classes.find((c) => c.id === draft.classId) ?? null;
  const bg = setting.backgrounds.find((b) => b.id === draft.backgroundId) ?? null;
  const g = startingGear(cls, bg);
  draft.inventory = g.inventory; draft.equipped = g.equipped; draft.coins = g.coins;
  const level = draft.level ?? 1;
  if (level > 1) {
    draft.coins += startingWealth(level);
    for (const m of startingMagic(level)) {
      if (m.id) { addItem(draft.inventory, makeItem(m.id, m.qty ?? 1)); continue; }
      const slot = m.base === 'weapon' ? (equippedIn(draft, 'mainHand') ? 'mainHand' : 'ranged') : 'body';
      const inst = equippedIn(draft, slot);
      if (inst) inst.bonus = m.bonus;
    }
  }
  draft.xp ??= XP_FOR_LEVEL[level];
  return draft;
}

/** Add experience. Returns { gained, from, to } so the UI can celebrate a level-up. */
// ---------------------------------------------------------------------------
// Level-ups: what a new level lets the player choose
// ---------------------------------------------------------------------------

/** Ability Score Improvement levels (as in the rules): +2 to one ability or +1 to two, max 20. */
export const ASI_LEVELS = [4, 8, 12, 16, 19];
/** House rule: a hero also trains a new skill at these levels (something to choose more often). */
export const SKILL_LEVELS = [3, 7, 11, 15];

export const levelChoices = (level) => ({ asi: ASI_LEVELS.includes(level), skill: SKILL_LEVELS.includes(level) });

/** Levels up to the hero's current one whose choices have not been made yet. */
export function pendingLevelUps(draft) {
  const out = [];
  for (let lv = 2; lv <= (draft.level ?? 1); lv++) {
    const c = levelChoices(lv);
    if ((c.asi || c.skill) && !draft.levelUps?.[lv]) out.push(lv);
  }
  return out;
}

/**
 * Record a level's choices. abilities: { str: 2 } or { str: 1, dex: 1 }; skill: a skill id.
 * Returns problems as sentences (empty when it is valid and saved).
 */
export function applyLevelUp(draft, setting, level, { abilities = null, skill = null } = {}) {
  const c = levelChoices(level); const issues = [];
  if (c.asi) {
    const pts = Object.values(abilities ?? {}).reduce((a, b) => a + b, 0);
    if (pts !== 2 || Object.values(abilities).some((n) => n < 1 || n > 2)) issues.push('Spend exactly 2 points: +2 to one ability, or +1 to two.');
    const before = deriveCharacter({ ...draft, level: level - 1 }, setting).scores;
    for (const [id, n] of Object.entries(abilities ?? {})) if (before[id] + n > 20) issues.push(`${id.toUpperCase()} cannot go above 20.`);
  }
  if (c.skill) {
    const ch = deriveCharacter({ ...draft, level: level - 1 }, setting);
    if (!skill) issues.push('Choose a skill to train.');
    else if (ch.skills.find((x) => x.id === skill)?.proficient) issues.push('Your hero already knows that skill.');
  }
  if (!issues.length) draft.levelUps = { ...(draft.levelUps ?? {}), [level]: { abilities: c.asi ? abilities : null, skill: c.skill ? skill : null } };
  return issues;
}

/** What changed between two levels, for the level-up summary. */
export function levelUpSummary(draft, setting, from, to) {
  const a = deriveCharacter({ ...draft, level: from }, setting);
  const b = deriveCharacter({ ...draft, level: to }, setting);
  const names = (c) => new Set([...(c.magic?.spells ?? []), ...(c.magic?.abilities ?? [])].map((x) => x.name));
  const before = names(a);
  const slots = (c, lv) => (c.magic?.type && manaFor(c.magic.type, lv) ? `${manaFor(c.magic.type, lv)}` : '');
  return {
    from, to,
    lines: [
      { label: 'Hit points', from: a.maxHp, to: b.maxHp },
      { label: 'Proficiency bonus', from: `+${a.proficiencyBonus}`, to: `+${b.proficiencyBonus}` },
      { label: 'Attacks per action', from: a.attacksPerAction, to: b.attacksPerAction },
      { label: 'Mana crystals', from: slots(a, from) || '—', to: slots(b, to) || '—' },
      ...ABILITY_IDS.map((id) => ({ label: id.toUpperCase(), from: a.scores[id], to: b.scores[id] })),
    ].filter((l) => String(l.from) !== String(l.to)),
    newMagic: [...names(b)].filter((n) => !before.has(n)),
    newSkills: b.skills.filter((sk) => sk.proficient && !a.skills.find((x) => x.id === sk.id)?.proficient).map((sk) => sk.name),
  };
}

export function gainXp(draft, amount) {
  const from = draft.level ?? 1;
  draft.xp = (draft.xp ?? XP_FOR_LEVEL[from]) + Math.max(0, Math.floor(amount));
  const to = Math.max(from, levelForXp(draft.xp));
  draft.level = to;
  return { gained: amount, from, to };
}

export { itemDef };
