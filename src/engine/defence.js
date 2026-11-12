/**
 * Defence in three steps: evade, block, absorb.
 *
 *   1. Evade (DEX). The attacker rolls d20 + attack bonus against the defender's Evasion:
 *        Evasion = 10 + DEX modifier (medium armour lets at most +2 count, heavy armour none)
 *                  + magic (a ring of protection) + cover.
 *      Missing it means the blow was dodged. A natural 20 always lands; a natural 1 always misses.
 *   2. Block (training). A blow that would land can be stopped by a shield, or parried with a
 *      melee weapon the defender is trained with:
 *        shield  15% + 5% x proficiency bonus     (25% at level 1, 45% at level 17)
 *        parry    5% + 5% x proficiency bonus     (15% at level 1)
 *      at most 50%. Only a shield stops arrows and bolts; nothing blocks a spell; and you cannot
 *      block what you do not see coming (from behind, unaware, helpless) or a critical hit.
 *   3. Absorb (armour, where it lands). Roll d100 for the body part hit (body.js). The armour
 *      over that part takes a share of the damage: 40% armour turns a 10-point blow into 6.
 *
 * The chance that an attack does damage, with p = chance to beat Evasion, c = chance of a
 * natural 20 (0.05, or 0.0975 with advantage) and b = block chance:
 *   P(lands) = c + (p - c) x (1 - b)       (a critical hit cannot be blocked)
 *
 * Monsters: Evasion = 10 + DEX modifier. The rest of their Armour Class becomes armour: worn
 * armour named in the stat block covers what that armour covers; natural armour (hide, scales,
 * shell) covers the whole body at 6% per point of AC above 10 + DEX, at most 60%.
 */
import { itemDef } from './items.js';
import { BODY_PARTS } from './body.js';

/** Damage absorbed by each armour, in percent. Each +1 of enchantment adds 5%. */
export const ARMOUR_ABSORB = {
  padded: 10, leather: 10, 'studded-leather': 15, 'hide-armour': 20,
  'chain-shirt': 25, 'scale-mail': 30, breastplate: 30, 'half-plate': 40, 'mithral-shirt': 30,
  'ring-mail': 30, 'chain-mail': 40, splint: 45, plate: 55,
};
export const MAX_ABSORB = 60;
export const MAX_BLOCK = 50;

/** Which parts armour covers: light the trunk, medium the arms too, heavy almost everything; plate has a helm. */
export const ARMOUR_COVERS = {
  light: ['chest', 'abdomen'],
  medium: ['chest', 'abdomen', 'right-arm', 'left-arm'],
  heavy: ['chest', 'abdomen', 'right-arm', 'left-arm', 'right-leg', 'left-leg', 'neck'],
};
const coversOf = (id, type) => (id === 'plate' ? [...ARMOUR_COVERS.heavy, 'head'] : ARMOUR_COVERS[type] ?? ARMOUR_COVERS.light);

export const shieldBlock = (pb, trained = true) => Math.min(MAX_BLOCK, 15 + (trained ? 5 * pb : 0));
export const parryBlock = (pb) => Math.min(MAX_BLOCK, 5 + 5 * pb);

const allParts = (pct) => Object.fromEntries(BODY_PARTS.map((p) => [p.id, pct]));
const partsOf = (ids, pct) => Object.fromEntries(BODY_PARTS.map((p) => [p.id, ids.includes(p.id) ? pct : 0]));
const dexFor = (dex, type) => (type === 'heavy' ? 0 : type === 'medium' ? Math.min(2, dex) : dex);

/**
 * A hero's defence from what they wear and wield.
 * @returns {{ evasion, block, blockWith: 'shield'|'parry'|null, armour: {partId: pct}, armourName }}
 */
export function heroDefence(gear, { dex = 0, pb = 2, shieldTrained = true, weaponTrained = () => true, magicEvasion = 0 } = {}) {
  const eq = (slot) => (gear.inventory ?? []).find((x) => x.uid === gear.equipped?.[slot]) ?? null;
  const bodyInst = eq('body'); const body = itemDef(bodyInst);
  const type = body?.armor?.type ?? null;
  const evasion = 10 + dexFor(dex, type) + magicEvasion;
  let armour = allParts(0); let armourName = null;
  if (body?.armor) {
    const pct = Math.min(MAX_ABSORB, (ARMOUR_ABSORB[body.id] ?? Math.max(5, 5 + 6 * (body.armor.base - 10))) + 5 * (bodyInst.bonus ?? 0));
    armour = partsOf(coversOf(body.id, type), pct); armourName = body.name;
  }
  const offInst = eq('offHand'); const off = itemDef(offInst);
  const mainInst = eq('mainHand'); const main = itemDef(mainInst);
  const shield = off?.cat === 'shield' ? shieldBlock(pb, shieldTrained) + 5 * (offInst.bonus ?? 0) : 0;
  const parry = main?.weapon && !main.weapon.ranged && weaponTrained(main) ? parryBlock(pb) : 0;
  const block = Math.min(MAX_BLOCK, Math.max(shield, parry));
  return { evasion, block, blockWith: block ? (shield >= parry ? 'shield' : 'parry') : null, armour, armourName };
}

/** Armour named in a stat block ("leather armor, shield", "natural armor"). */
const WORN = [
  [/half plate/i, 'half-plate'], [/\bplate\b/i, 'plate'], [/splint/i, 'splint'], [/chain mail/i, 'chain-mail'],
  [/chain shirt/i, 'chain-shirt'], [/ring mail/i, 'ring-mail'], [/scale/i, 'scale-mail'], [/breastplate/i, 'breastplate'],
  [/studded/i, 'studded-leather'], [/\bhide\b/i, 'hide-armour'], [/leather/i, 'leather'], [/padded/i, 'padded'],
  [/\bmail\b/i, 'chain-mail'], // "iron mail", "black mail", "ancient bronze mail": a coat of mail
];
/** Weapons a creature can parry with (claws and jaws do not parry). */
const MADE_WEAPON = /sword|axe|mace|spear|scimitar|club|dagger|hammer|staff|flail|pick|glaive|halberd|rapier|morningstar|trident|maul|javelin|pike|lance|sickle|blade|knife|cudgel/i;

/** A monster's defence from its stat block. */
export function monsterDefence(stat) {
  const dex = stat.mods?.dex ?? 0;
  const pb = stat.proficiencyBonus ?? 2;
  const text = stat.armor ?? '';
  const hasShield = /shield/i.test(text);
  const worn = WORN.find(([re]) => re.test(text))?.[1];
  const wornDef = worn ? itemDef({ id: worn }) : null;
  const type = wornDef?.armor?.type ?? null;
  const evasion = 10 + dexFor(dex, type);
  let armour; let armourName;
  if (wornDef) {
    armour = partsOf(coversOf(worn, type), ARMOUR_ABSORB[worn]); armourName = wornDef.name;
  } else {
    const pts = Math.max(0, (stat.ac ?? 10) - 10 - dex - (hasShield ? 2 : 0));
    const pct = Math.min(MAX_ABSORB, 6 * pts);
    // Natural armour, or something odd in the stat block ("robes of warding"): named in its own words.
    const own = text.split(',')[0].trim();
    armour = allParts(pct); armourName = pct ? (!own || /natural/i.test(own) ? 'natural armour' : own[0].toUpperCase() + own.slice(1)) : null;
  }
  const canParry = (stat.scores?.int ?? 0) >= 5 && (stat.actions ?? []).some((a) => a.attack && ['mw', 'mrw'].includes(a.attack.kind) && MADE_WEAPON.test(a.name));
  const shield = hasShield ? shieldBlock(pb) : 0;
  const parry = canParry ? parryBlock(pb) : 0;
  const block = Math.min(MAX_BLOCK, Math.max(shield, parry));
  return { evasion, block, blockWith: block ? (shield >= parry ? 'shield' : 'parry') : null, armour, armourName };
}

/**
 * Can this blow be blocked, and how likely is it? (0..1)
 * `ranged`: an arrow or thrown weapon (shields only); `spell`: never; `unseen`: from behind,
 * unaware or helpless.
 */
export function blockChanceVs(def, { ranged = false, spell = false, unseen = false } = {}) {
  if (!def?.block || spell || unseen) return 0;
  if (ranged && def.blockWith !== 'shield') return 0;
  return def.block / 100;
}

/** Damage after armour on the part struck: at least 1 point gets through. */
export function absorbed(damage, pct) {
  if (!pct || damage <= 0) return damage;
  return Math.max(1, Math.round(damage * (1 - pct / 100)));
}

/** The chance an attack does damage: beat Evasion, then not be blocked (a natural 20 cannot be). */
export function landChance(hitP, block, mode = 'normal') {
  const crit = mode === 'advantage' ? 1 - 0.95 ** 2 : mode === 'disadvantage' ? 0.05 ** 2 : 0.05;
  return Math.max(0, Math.min(1, crit + Math.max(0, hitP - crit) * (1 - block)));
}

/** "Chain mail 40% (trunk, arms, legs, neck)" style summary of where armour protects. */
export function armourSummary(def) {
  const covered = BODY_PARTS.filter((p) => def.armour[p.id] > 0);
  if (!covered.length) return 'No armour';
  const pcts = [...new Set(covered.map((p) => def.armour[p.id]))];
  const where = covered.length === BODY_PARTS.length ? 'whole body' : covered.map((p) => p.name.toLowerCase()).join(', ');
  return `${def.armourName ?? 'Armour'} ${pcts.join('/')}% (${where})`;
}
