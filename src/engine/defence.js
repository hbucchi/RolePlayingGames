/**
 * Defence in three steps: evade, block, absorb.
 *
 *   1. Evade (DEX). The attacker rolls d20 + attack bonus against the defender's Evasion:
 *        Evasion = 10 + DEX modifier - armour hindrance + magic (a ring of protection) + cover.
 *      Missing it means the blow was dodged. A natural 20 always lands; a natural 1 always misses.
 *   2. Block (training). A blow that would land can be stopped by a shield, or parried with a
 *      melee weapon the defender is trained with:
 *        shield  15% + 5% x proficiency bonus     (25% at level 1, 45% at level 17)
 *        parry    5% + 5% x proficiency bonus     (15% at level 1)
 *      at most 50%. Only a shield stops arrows and bolts; nothing blocks a spell; and you cannot
 *      block what you do not see coming (from behind, unaware, helpless) or a critical hit.
 *   3. Absorb (armour, where it lands). Roll d100. The body is one strip of 100 points, a stretch
 *      per part (body.js: left arm 1-12, right arm 13-24, ... head 91-100). Armour has
 *        absorption  the share of damage it takes where it covers (chain mail 40%)
 *        coverage    how many points of each part's stretch it covers, from the start
 *                    (a leather jerkin covers 4 of the left arm's 12: rolls 1-4)
 *        condition   0-100%; worn armour absorbs less: absorption x condition
 *      A roll inside the covered points meets the armour; a roll beyond them lands on the same
 *      part through a gap, at full damage. Each blow the armour takes wears it by 1% (3% on a
 *      critical hit).
 *
 * The chance that an attack does damage, with p = chance to beat Evasion, c = chance of a
 * natural 20 (0.05, or 0.0975 with advantage) and b = block chance:
 *   P(lands) = c + (p - c) x (1 - b)       (a critical hit cannot be blocked)
 * and the chance a blow that lands meets armour is (points covered) / 100.
 *
 * Monsters: Evasion = 10 + DEX modifier. The rest of their Armour Class becomes armour: worn
 * armour named in the stat block (with its own coverage); natural armour (hide, scales, shell)
 * covers every point of the body, absorbing 6% per point of AC above 10 + DEX (at most 60%).
 */
import { itemDef } from './items.js';
import { BODY_PARTS, BODY_BY_ID, strikeAt } from './body.js';

/**
 * Every armour: absorption (%) and coverage (points of each part's stretch). Parts not listed are
 * bare. For scale, the stretches are: arms 12 each, hands 4, legs 9, abdomen 15, chest 22,
 * neck 3, head 10.
 */
export const ARMOURS = {
  padded: { absorb: 10, cover: { chest: 20, abdomen: 12, 'left-arm': 6, 'right-arm': 6 } },
  leather: { absorb: 10, cover: { chest: 18, abdomen: 10, 'left-arm': 4, 'right-arm': 4 } },
  'studded-leather': { absorb: 15, cover: { chest: 20, abdomen: 12, 'left-arm': 6, 'right-arm': 6 } },
  'hide-armour': { absorb: 20, cover: { chest: 20, abdomen: 13, 'left-arm': 8, 'right-arm': 8, 'left-leg': 3, 'right-leg': 3 } },
  'chain-shirt': { absorb: 25, cover: { chest: 22, abdomen: 12, 'left-arm': 6, 'right-arm': 6 } },
  'mithral-shirt': { absorb: 30, cover: { chest: 22, abdomen: 12, 'left-arm': 6, 'right-arm': 6 } },
  'scale-mail': { absorb: 30, cover: { chest: 22, abdomen: 14, 'left-arm': 9, 'right-arm': 9, 'left-leg': 4, 'right-leg': 4 } },
  breastplate: { absorb: 30, cover: { chest: 22, abdomen: 10 } },
  'half-plate': { absorb: 40, cover: { chest: 22, abdomen: 14, 'left-arm': 10, 'right-arm': 10, 'left-leg': 5, 'right-leg': 5 } },
  'ring-mail': { absorb: 30, cover: { chest: 22, abdomen: 14, 'left-arm': 10, 'right-arm': 10, 'left-leg': 6, 'right-leg': 6, neck: 1 } },
  'chain-mail': { absorb: 40, cover: { chest: 22, abdomen: 15, 'left-arm': 11, 'right-arm': 11, 'left-leg': 7, 'right-leg': 7, neck: 2 } },
  splint: { absorb: 45, cover: { chest: 22, abdomen: 15, 'left-arm': 11, 'right-arm': 11, 'left-leg': 8, 'right-leg': 8, neck: 2 } },
  plate: { absorb: 55, cover: { chest: 22, abdomen: 15, 'left-arm': 12, 'right-arm': 12, 'left-leg': 9, 'right-leg': 9, neck: 3 } },
  // Pieces, each in its own slot: helm, gorget, vambraces, gloves, leg armour.
  'leather-cap': { absorb: 10, cover: { head: 6 } },
  'iron-helm': { absorb: 35, cover: { head: 7 } },
  'mail-coif': { absorb: 35, cover: { head: 4, neck: 3 } },
  'great-helm': { absorb: 50, cover: { head: 10 } },
  'steel-gorget': { absorb: 45, cover: { neck: 3 } },
  'leather-vambraces': { absorb: 10, cover: { 'left-arm': 5, 'right-arm': 5 } },
  'steel-vambraces': { absorb: 40, cover: { 'left-arm': 8, 'right-arm': 8 } },
  'leather-gloves': { absorb: 10, cover: { 'left-hand': 3, 'right-hand': 3 } },
  gauntlets: { absorb: 40, cover: { 'left-hand': 4, 'right-hand': 4 } },
  'leather-leggings': { absorb: 10, cover: { 'left-leg': 6, 'right-leg': 6 } },
  'mail-chausses': { absorb: 40, cover: { 'left-leg': 8, 'right-leg': 8 } },
  'steel-greaves': { absorb: 45, cover: { 'left-leg': 7, 'right-leg': 7 } },
};
/** Layers multiply: 40% over 40% lets 0.6 x 0.6 = 36% through (64% absorbed), at most 75%. */
export const MAX_LAYERED = 75;
/**
 * Hindrance: the more armour covers and the more it absorbs, the heavier and stiffer it is.
 *   hindrance = round(absorption % x points covered / 1000)
 * It takes 1 from Evasion per point, and costs movement: 2-3 points one square (1.5 m),
 * 4 or more two squares (3 m). A very strong wearer (STR 16+) shrugs off one square of that.
 * leather 0, studded / hide / chain shirt / breastplate 1, scale / ring mail 2, half plate /
 * coat of mail 3, splint 4, plate 5.
 */
export const hindranceOf = (absorb, points) => Math.round((absorb * points) / 1000);
const rawHindrance = (absorb, points) => (absorb * points) / 1000;
for (const a of Object.values(ARMOURS)) a.hinder = hindranceOf(a.absorb, Object.values(a.cover).reduce((x, y) => x + y, 0));
ARMOURS['mithral-shirt'].hinder = 0; // true-silver: light as linen, it does not hinder at all
export const moveSquaresLost = (hinder, str = 10) => Math.max(0, (hinder >= 4 ? 2 : hinder >= 2 ? 1 : 0) - (str >= 16 ? 1 : 0));
export const ARMOUR_ABSORB = Object.fromEntries(Object.entries(ARMOURS).map(([k, v]) => [k, v.absorb]));
export const MAX_ABSORB = 60;
export const MAX_BLOCK = 50;
const FULL = Object.fromEntries(BODY_PARTS.map((p) => [p.id, p.weight])); // natural armour: every point

export const shieldBlock = (pb, trained = true) => Math.min(MAX_BLOCK, 15 + (trained ? 5 * pb : 0));
export const parryBlock = (pb) => Math.min(MAX_BLOCK, 5 + 5 * pb);

/** The absorption armour gives at its condition (0-100%). */
export const effectiveAbsorb = (absorb, condition = 100) => Math.round(absorb * Math.max(0, Math.min(100, condition)) / 100);

/**
 * One worn piece: { name, absorb, condition, pct (absorb at that condition), cover, uid }.
 * `cover` maps part id -> points covered (never more than the part's stretch).
 */
function piece({ name, absorb, cover, condition = 100, uid = null, hinder = null }) {
  const c = Object.fromEntries(Object.entries(cover).map(([k, v]) => [k, Math.min(v, BODY_BY_ID[k]?.weight ?? 0)]));
  const points = Object.values(c).reduce((x, y) => x + y, 0);
  return { name, absorb, condition, pct: effectiveAbsorb(absorb, condition), cover: c, uid, hinder: hinder ?? hindranceOf(absorb, points) };
}

/**
 * A hero's defence from what they wear and wield.
 * @returns {{ evasion, block, blockWith: 'shield'|'parry'|null, armour: piece|null }}
 */
export function heroDefence(gear, { dex = 0, pb = 2, str = 10, shieldTrained = true, weaponTrained = () => true, magicEvasion = 0 } = {}) {
  const eq = (slot) => (gear.inventory ?? []).find((x) => x.uid === gear.equipped?.[slot]) ?? null;
  // Every armour slot: body armour, helm, gorget, vambraces, gloves, leg armour.
  const pieces = [];
  let raw = 0;
  for (const slot of ['body', 'head', 'throat', 'arms', 'hands', 'legs']) {
    const inst = eq(slot); const def = itemDef(inst);
    if (!def?.armor) continue;
    const a = ARMOURS[def.id] ?? { absorb: Math.max(5, 5 + 6 * ((def.armor.base ?? 11) - 10)), cover: ARMOURS.leather.cover };
    // Enchantment adds absorption, not stiffness: hindrance stays the armour's own.
    const p = piece({ name: def.name, absorb: Math.min(MAX_ABSORB, a.absorb + 5 * (inst.bonus ?? 0)), cover: a.cover, condition: inst.condition ?? 100, uid: inst.uid, hinder: a.hinder });
    p.slot = slot; pieces.push(p);
    raw += a.hinder === 0 ? 0 : rawHindrance(a.absorb, Object.values(a.cover).reduce((x, y) => x + y, 0));
  }
  const hinder = Math.round(raw);
  const evasion = 10 + dex - hinder + magicEvasion;
  const offInst = eq('offHand'); const off = itemDef(offInst);
  const mainInst = eq('mainHand'); const main = itemDef(mainInst);
  const shield = off?.cat === 'shield' ? shieldBlock(pb, shieldTrained) + 5 * (offInst.bonus ?? 0) : 0;
  const parry = main?.weapon && !main.weapon.ranged && weaponTrained(main) ? parryBlock(pb) : 0;
  const block = Math.min(MAX_BLOCK, Math.max(shield, parry));
  return { evasion, block, blockWith: block ? (shield >= parry ? 'shield' : 'parry') : null, pieces, armour: pieces.find((x) => x.slot === 'body') ?? pieces[0] ?? null, hinder, moveLost: moveSquaresLost(hinder, str) };
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
  let armour = null;
  if (wornDef) {
    armour = piece({ name: wornDef.name, ...ARMOURS[worn] });
  } else {
    const pts = Math.max(0, (stat.ac ?? 10) - 10 - dex - (hasShield ? 2 : 0));
    const absorb = Math.min(MAX_ABSORB, 6 * pts);
    // Natural armour, or something odd in the stat block ("robes of warding"): named in its own words.
    const own = text.split(',')[0].trim();
    if (absorb) armour = piece({ name: !own || /natural/i.test(own) ? 'natural armour' : own[0].toUpperCase() + own.slice(1), absorb, cover: FULL });
  }
  // Worn armour hinders monsters too; natural armour is part of the body and does not.
  const hinder = wornDef ? armour.hinder : 0;
  const evasion = 10 + dex - hinder;
  const canParry = (stat.scores?.int ?? 0) >= 5 && (stat.actions ?? []).some((a) => a.attack && ['mw', 'mrw'].includes(a.attack.kind) && MADE_WEAPON.test(a.name));
  const shield = hasShield ? shieldBlock(pb) : 0;
  const parry = canParry ? parryBlock(pb) : 0;
  const block = Math.min(MAX_BLOCK, Math.max(shield, parry));
  return { evasion, block, blockWith: block ? (shield >= parry ? 'shield' : 'parry') : null, pieces: armour ? [armour] : [], armour, hinder, moveLost: 0 };
}

/** The pieces of armour that a blow at this part and offset meets. */
export const piecesAt = (def, part, offset) => (def?.pieces ?? []).filter((p) => offset <= (p.cover[part] ?? 0));

/**
 * Where a d100 lands on this defender, and what armour it meets there.
 * @returns {{ part, offset, covered: boolean, pct: number, pieces }}  pct = combined absorption (0 in a gap)
 */
export function strike(def, d100) {
  const { part, offset } = strikeAt(d100);
  const met = piecesAt(def, part, offset);
  const through = met.reduce((f, p) => f * (1 - p.pct / 100), 1);
  const pct = met.length ? Math.min(MAX_LAYERED, Math.round(100 * (1 - through))) : 0;
  return { part, offset, covered: met.length > 0, pct, pieces: met };
}

/** Wear armour by one blow (1%, or 3% for a critical hit); returns the new condition. */
export function wearArmour(armour, crit = false) {
  if (!armour) return null;
  armour.condition = Math.max(0, armour.condition - (crit ? 3 : 1));
  armour.pct = effectiveAbsorb(armour.absorb, armour.condition);
  return armour.condition;
}

/** Points of a part's stretch covered by at least one piece. */
export const partCover = (def, part) => Math.max(0, ...(def?.pieces ?? []).map((p) => p.cover[part] ?? 0));

/** Points of the body (out of 100) covered: by one piece, or (given a defence) by any of its pieces. */
export function coverage(x) {
  if (!x) return 0;
  if (x.pieces) return BODY_PARTS.reduce((n, p) => n + partCover(x, p.id), 0);
  return Object.values(x.cover).reduce((a, b) => a + b, 0);
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

/** Damage after armour: at least 1 point gets through. */
export function absorbed(damage, pct) {
  if (!pct || damage <= 0) return damage;
  return Math.max(1, Math.round(damage * (1 - pct / 100)));
}

/** The chance an attack does damage: beat Evasion, then not be blocked (a natural 20 cannot be). */
export function landChance(hitP, block, mode = 'normal') {
  const crit = mode === 'advantage' ? 1 - 0.95 ** 2 : mode === 'disadvantage' ? 0.05 ** 2 : 0.05;
  return Math.max(0, Math.min(1, crit + Math.max(0, hitP - crit) * (1 - block)));
}

/** "Coat of mail 40%, Iron helm 35%: cover 84 of 100 points, hindrance 3" */
export function armourSummary(def) {
  const ps = def?.pieces ?? (def?.armour ? [def.armour] : []);
  if (!ps.length) return 'No armour';
  const n = coverage(def.pieces ? def : ps[0]);
  return `${ps.map((a) => `${a.name} ${a.pct}%${a.condition < 100 ? ` (condition ${a.condition}%)` : ''}`).join(', ')}: ${n === 100 ? 'the whole body' : `${n} of 100 points covered`}${def.hinder ? `, hindrance ${def.hinder} (−${def.hinder} Evasion)` : ''}`;
}
