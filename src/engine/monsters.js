/**
 * Monster engine: normalises compact monster data into full stat blocks, derives the
 * standard numbers, and validates entries so data mistakes are caught by tests.
 *
 * Key 5e formulas used here:
 *   ability modifier      floor((score - 10) / 2)
 *   proficiency bonus     set by Challenge Rating (CR): +2 at CR 0-4, +3 at 5-8, ... +9 at 29-30
 *   average hit points    each die averages (sides + 1) / 2, so NdS + M averages floor(N(S+1)/2) + M
 *   weapon attack bonus   proficiency + STR (melee) or DEX (ranged / finesse) modifier
 *   save DC               8 + proficiency + the relevant ability modifier
 */
import { ABILITY_IDS, abilityModifier, formatModifier } from './abilities.js';
import { parseNotation } from './dice.js';
import { metres } from './units.js';

/** XP awarded and proficiency bonus for each Challenge Rating. */
export const CR_TABLE = {
  0: { xp: 10, pb: 2 }, '1/8': { xp: 25, pb: 2 }, '1/4': { xp: 50, pb: 2 }, '1/2': { xp: 100, pb: 2 },
  1: { xp: 200, pb: 2 }, 2: { xp: 450, pb: 2 }, 3: { xp: 700, pb: 2 }, 4: { xp: 1100, pb: 2 },
  5: { xp: 1800, pb: 3 }, 6: { xp: 2300, pb: 3 }, 7: { xp: 2900, pb: 3 }, 8: { xp: 3900, pb: 3 },
  9: { xp: 5000, pb: 4 }, 10: { xp: 5900, pb: 4 }, 11: { xp: 7200, pb: 4 }, 12: { xp: 8400, pb: 4 },
  13: { xp: 10000, pb: 5 }, 14: { xp: 11500, pb: 5 }, 15: { xp: 13000, pb: 5 }, 16: { xp: 15000, pb: 5 },
  17: { xp: 18000, pb: 6 }, 18: { xp: 20000, pb: 6 }, 19: { xp: 22000, pb: 6 }, 20: { xp: 25000, pb: 6 },
  21: { xp: 33000, pb: 7 }, 22: { xp: 41000, pb: 7 }, 23: { xp: 50000, pb: 7 }, 24: { xp: 62000, pb: 7 },
  25: { xp: 75000, pb: 8 }, 26: { xp: 90000, pb: 8 }, 27: { xp: 105000, pb: 8 }, 28: { xp: 120000, pb: 8 },
  29: { xp: 135000, pb: 9 }, 30: { xp: 155000, pb: 9 },
};

/** CR as a number, for sorting and filtering ("1/4" -> 0.25). */
export function crValue(cr) {
  const s = String(cr);
  if (s.includes('/')) { const [a, b] = s.split('/').map(Number); return a / b; }
  return Number(s);
}

export const SIZES = ['Tiny', 'Small', 'Medium', 'Large', 'Huge', 'Gargantuan'];
export const SIZE_HIT_DIE = { Tiny: 4, Small: 6, Medium: 8, Large: 10, Huge: 12, Gargantuan: 20 };
/** Squares a creature occupies on the grid (each side). */
export const SIZE_SQUARES = { Tiny: 1, Small: 1, Medium: 1, Large: 2, Huge: 3, Gargantuan: 8 };

export const CREATURE_TYPES = [
  'aberration', 'beast', 'celestial', 'construct', 'dragon', 'elemental', 'fey', 'fiend',
  'giant', 'humanoid', 'monstrosity', 'ooze', 'plant', 'undead',
];

export const SKILL_ABILITY = {
  acrobatics: 'dex', 'animal-handling': 'wis', arcana: 'int', athletics: 'str', deception: 'cha',
  history: 'int', insight: 'wis', intimidation: 'cha', investigation: 'int', medicine: 'wis',
  nature: 'int', perception: 'wis', performance: 'cha', persuasion: 'cha', religion: 'int',
  'sleight-of-hand': 'dex', stealth: 'dex', survival: 'wis',
};

export const slugify = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** Average of a dice expression, the way stat blocks print it: floor(N * (S + 1) / 2) + M. */
export function averageRoll(notation) {
  const { count, sides, modifier } = parseNotation(notation);
  return Math.floor((count * (sides + 1)) / 2) + modifier;
}

export function formatSpeed(speed) {
  const parts = [`${speed.walk ?? 0} ft.`];
  for (const k of ['burrow', 'climb', 'fly', 'swim']) {
    if (speed[k]) parts.push(`${k} ${speed[k]} ft.${k === 'fly' && speed.hover ? ' (hover)' : ''}`);
  }
  return parts.join(', ');
}

// ---------------------------------------------------------------------------
// Attack / action text
// ---------------------------------------------------------------------------

function damageText(damage) {
  return damage.map(({ dice, type }) => {
    if (/^\d+$/.test(dice)) return `${dice} ${type} damage`;
    return `${averageRoll(dice)} (${dice.replace(/([+-])/, ' $1 ')}) ${type} damage`;
  }).join(' plus ');
}

/** Render an attack object as stat-block prose. */
export function attackText(a) {
  const kinds = { mw: 'Melee Weapon Attack', rw: 'Ranged Weapon Attack', mrw: 'Melee or Ranged Weapon Attack', ms: 'Melee Spell Attack', rs: 'Ranged Spell Attack' };
  const reach = [a.reach ? `reach ${a.reach} ft.` : null, a.range ? `range ${a.range} ft.` : null].filter(Boolean).join(' or ');
  const hit = a.damage?.length ? `${damageText(a.damage)}${a.extra ? `. ${a.extra}` : '.'}` : (a.extra ?? '');
  return `${kinds[a.kind]}: ${formatModifier(a.toHit)} to hit, ${reach}, ${a.targets ?? 'one target'}. Hit: ${hit}`;
}

// ---------------------------------------------------------------------------
// Normalise
// ---------------------------------------------------------------------------

/** Turn authoring data into a complete monster record with derived values. */
export function buildMonster(raw) {
  const scores = Object.fromEntries(ABILITY_IDS.map((id, i) => [id, raw.ab[i]]));
  const mods = Object.fromEntries(ABILITY_IDS.map((id) => [id, abilityModifier(scores[id])]));
  const cr = String(raw.cr);
  const { xp, pb } = CR_TABLE[cr] ?? { xp: 0, pb: 2 };
  const hpAvg = /d/.test(raw.hp) ? averageRoll(raw.hp) : Number(raw.hp);
  const skills = raw.skills ?? {};
  const perception = skills.perception ?? mods.wis;
  const speed = typeof raw.speed === 'number' ? { walk: raw.speed } : { walk: 30, ...raw.speed };
  const mapAction = (a) => (a.attack ? { ...a, text: attackText(a.attack) } : a);

  return {
    id: raw.id ?? slugify(raw.name),
    name: raw.name,
    source: raw.source ?? 'SRD 5.1',
    size: raw.size,
    type: raw.type,
    subtype: raw.subtype ?? null,
    alignment: raw.alignment ?? 'unaligned',
    ac: raw.ac,
    armor: raw.armor ?? null,
    hp: hpAvg,
    hitDice: /d/.test(raw.hp) ? raw.hp : null,
    speed,
    speedText: formatSpeed(speed),
    scores,
    mods,
    saves: raw.saves ?? {},
    skills,
    vulnerable: raw.vulnerable ?? [],
    resist: raw.resist ?? [],
    immune: raw.immune ?? [],
    conditionImmune: raw.conditionImmune ?? [],
    senses: raw.senses ?? {},
    passivePerception: 10 + perception,
    languages: raw.languages ?? '—',
    cr,
    crValue: crValue(cr),
    xp,
    proficiencyBonus: pb,
    traits: raw.traits ?? [],
    spellcasting: raw.spellcasting ?? null,
    actions: (raw.actions ?? []).map(mapAction),
    bonusActions: (raw.bonusActions ?? []).map(mapAction),
    reactions: raw.reactions ?? [],
    legendary: raw.legendary ?? null,
    habitat: raw.habitat ?? [],
    lore: raw.lore ?? null,
    appearance: raw.appearance ?? null,
    settings: raw.settings ?? ['core'],
    // How it looks and sounds: art = { portrait, body, tint, portraitTint } (keys of image files
    // in assets/portraits and assets/bodies, CSS filters for the tints), voice = a sound family.
    art: raw.art ?? {},
    voice: raw.voice ?? null,
  };
}

/** Senses for the player to read (in metres: engine/units.js). */
export function sensesText(m) {
  const parts = Object.entries(m.senses).map(([k, v]) => (typeof v === 'number' ? `${k} ${metres(v)} m` : `${k} ${v}`));
  parts.push(`passive Perception ${m.passivePerception}`);
  return parts.join(', ');
}

// ---------------------------------------------------------------------------
// Validation (used by tests): catches typos and inconsistent numbers.
// ---------------------------------------------------------------------------

export function validateMonster(m) {
  const issues = [];
  const say = (msg) => issues.push(`${m.name}: ${msg}`);
  if (!SIZES.includes(m.size)) say(`bad size ${m.size}`);
  if (!CREATURE_TYPES.includes(m.type)) say(`bad type ${m.type}`);
  if (!(m.cr in CR_TABLE)) say(`bad CR ${m.cr}`);
  if (!Number.isInteger(m.ac) || m.ac < 5 || m.ac > 25) say(`odd AC ${m.ac}`);
  if (!(m.hp > 0)) say('needs hit points');
  if (ABILITY_IDS.some((id) => !Number.isInteger(m.scores[id]) || m.scores[id] < 1 || m.scores[id] > 30)) say('ability scores must be 1-30');

  // Hit dice: the die size follows creature size, and the bonus is CON mod x number of dice.
  if (m.hitDice) {
    const { count, sides, modifier } = parseNotation(m.hitDice);
    if (sides !== SIZE_HIT_DIE[m.size]) say(`hit die d${sides} does not match size ${m.size}`);
    if (modifier !== count * m.mods.con) say(`hit dice bonus ${modifier} should be ${count * m.mods.con} (CON ${formatModifier(m.mods.con)} x ${count})`);
  }

  for (const [id, v] of Object.entries(m.saves)) {
    if (!ABILITY_IDS.includes(id)) say(`unknown save ${id}`);
    else if (v < m.mods[id] + m.proficiencyBonus) say(`save ${id} ${v} below mod+prof`);
  }
  for (const [id, v] of Object.entries(m.skills)) {
    if (!SKILL_ABILITY[id]) say(`unknown skill ${id}`);
    else if (v < m.mods[SKILL_ABILITY[id]] + m.proficiencyBonus) say(`skill ${id} ${v} below mod+prof`);
  }

  const allActions = [...m.actions, ...m.bonusActions, ...m.reactions, ...(m.legendary?.actions ?? [])];
  for (const a of allActions) {
    if (!a.name) say('action without a name');
    if (!a.attack && !a.text) say(`action ${a.name} has no text`);
    for (const d of a.attack?.damage ?? []) {
      try { if (!/^\d+$/.test(d.dice)) parseNotation(d.dice); } catch { say(`bad damage dice ${d.dice} in ${a.name}`); }
    }
  }
  if (!m.lore?.personality || !m.lore?.origin || !m.lore?.tactics) say('needs lore: personality, origin and tactics');
  if (!m.appearance || m.appearance.length < 60) say('needs a visual appearance description (for image generation)');
  return issues;
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export function filterMonsters(list, { text = '', type = '', minCr = 0, maxCr = 30, source = '', habitat = '' } = {}) {
  const q = text.trim().toLowerCase();
  return list.filter((m) => (!type || m.type === type)
    && m.crValue >= minCr && m.crValue <= maxCr
    && (!source || m.source === source)
    && (!habitat || m.habitat.includes(habitat))
    && (!q || m.name.toLowerCase().includes(q) || (m.subtype ?? '').includes(q) || m.type.includes(q)));
}

/** Encounter difficulty helper: total XP of a group. */
export function encounterXp(monsters) {
  return monsters.reduce((s, m) => s + m.xp, 0);
}
