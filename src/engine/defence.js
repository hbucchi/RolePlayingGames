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
import { BODY_PARTS, BODY_MAPS, partOf, strikeAt, bodyMapOf } from './body.js';
import { absorbFor, ARMOUR_FORM, METALS, metalOf, isMetal, isPhysical } from './materials.js';

/**
 * Every armour: absorption (%) and coverage (points of each part's stretch). Parts not listed are
 * bare. For scale, the stretches are: arms 12 each, hands 4, legs 9, abdomen 15, chest 22,
 * neck 3, head 10.
 */
export const ARMOURS = {
  // absorb: the armour's nominal absorption (for hindrance and enchantment); abs: what it really
  // stops, per physical damage type, plus one overall figure against every elemental type.
  //                         edge (slashing) · point (piercing) · blunt (bludgeoning) · elemental
  padded: { absorb: 10, abs: { slashing: 10, piercing: 8, bludgeoning: 13, elemental: 3 }, cover: { chest: 20, abdomen: 12, 'left-arm': 6, 'right-arm': 6 } },
  leather: { absorb: 10, abs: { slashing: 10, piercing: 8, bludgeoning: 8, elemental: 6 }, cover: { chest: 18, abdomen: 10, 'left-arm': 4, 'right-arm': 4 } },
  'studded-leather': { absorb: 15, abs: { slashing: 15, piercing: 12, bludgeoning: 12, elemental: 8 }, cover: { chest: 20, abdomen: 12, 'left-arm': 6, 'right-arm': 6 } },
  'hide-armour': { absorb: 20, abs: { slashing: 20, piercing: 16, bludgeoning: 16, elemental: 10 }, cover: { chest: 20, abdomen: 13, 'left-arm': 8, 'right-arm': 8, 'left-leg': 3, 'right-leg': 3 } },
  'chain-shirt': { absorb: 25, abs: { slashing: 31, piercing: 15, bludgeoning: 15, elemental: 8 }, cover: { chest: 22, abdomen: 12, 'left-arm': 6, 'right-arm': 6 } },
  'mithral-shirt': { absorb: 30, abs: { slashing: 38, piercing: 18, bludgeoning: 18, elemental: 9 }, cover: { chest: 22, abdomen: 12, 'left-arm': 6, 'right-arm': 6 } },
  'scale-mail': { absorb: 30, abs: { slashing: 33, piercing: 27, bludgeoning: 24, elemental: 12 }, cover: { chest: 22, abdomen: 14, 'left-arm': 9, 'right-arm': 9, 'left-leg': 4, 'right-leg': 4 } },
  breastplate: { absorb: 30, abs: { slashing: 36, piercing: 30, bludgeoning: 24, elemental: 15 }, cover: { chest: 22, abdomen: 10 } },
  'half-plate': { absorb: 40, abs: { slashing: 48, piercing: 40, bludgeoning: 32, elemental: 18 }, cover: { chest: 22, abdomen: 14, 'left-arm': 10, 'right-arm': 10, 'left-leg': 5, 'right-leg': 5 } },
  'ring-mail': { absorb: 30, abs: { slashing: 38, piercing: 18, bludgeoning: 18, elemental: 9 }, cover: { chest: 22, abdomen: 14, 'left-arm': 10, 'right-arm': 10, 'left-leg': 6, 'right-leg': 6, neck: 1 } },
  'chain-mail': { absorb: 40, abs: { slashing: 50, piercing: 24, bludgeoning: 24, elemental: 12 }, cover: { chest: 22, abdomen: 15, 'left-arm': 11, 'right-arm': 11, 'left-leg': 7, 'right-leg': 7, neck: 2 } },
  splint: { absorb: 45, abs: { slashing: 54, piercing: 45, bludgeoning: 36, elemental: 20 }, cover: { chest: 22, abdomen: 15, 'left-arm': 11, 'right-arm': 11, 'left-leg': 8, 'right-leg': 8, neck: 2 } },
  plate: { absorb: 55, abs: { slashing: 66, piercing: 55, bludgeoning: 44, elemental: 22 }, cover: { chest: 22, abdomen: 15, 'left-arm': 12, 'right-arm': 12, 'left-leg': 9, 'right-leg': 9, neck: 3 } },
  // Pieces, each in its own slot: helm, gorget, vambraces, gloves, leg armour.
  'leather-cap': { absorb: 10, abs: { slashing: 10, piercing: 8, bludgeoning: 8, elemental: 6 }, cover: { head: 6 } },
  'iron-helm': { absorb: 35, abs: { slashing: 42, piercing: 35, bludgeoning: 28, elemental: 15 }, cover: { head: 7 } },
  'mail-coif': { absorb: 35, abs: { slashing: 44, piercing: 21, bludgeoning: 21, elemental: 10 }, cover: { head: 4, neck: 3 } },
  'great-helm': { absorb: 50, abs: { slashing: 60, piercing: 50, bludgeoning: 40, elemental: 20 }, cover: { head: 10 } },
  'steel-gorget': { absorb: 45, abs: { slashing: 54, piercing: 45, bludgeoning: 36, elemental: 18 }, cover: { neck: 3 } },
  'leather-vambraces': { absorb: 10, abs: { slashing: 10, piercing: 8, bludgeoning: 8, elemental: 6 }, cover: { 'left-arm': 5, 'right-arm': 5 } },
  'steel-vambraces': { absorb: 40, abs: { slashing: 48, piercing: 40, bludgeoning: 32, elemental: 16 }, cover: { 'left-arm': 8, 'right-arm': 8 } },
  'leather-gloves': { absorb: 10, abs: { slashing: 10, piercing: 8, bludgeoning: 8, elemental: 6 }, cover: { 'left-hand': 3, 'right-hand': 3 } },
  gauntlets: { absorb: 40, abs: { slashing: 48, piercing: 40, bludgeoning: 32, elemental: 16 }, cover: { 'left-hand': 4, 'right-hand': 4 } },
  'leather-leggings': { absorb: 10, abs: { slashing: 10, piercing: 8, bludgeoning: 8, elemental: 6 }, cover: { 'left-leg': 6, 'right-leg': 6 } },
  'mail-chausses': { absorb: 40, abs: { slashing: 50, piercing: 24, bludgeoning: 24, elemental: 12 }, cover: { 'left-leg': 8, 'right-leg': 8 } },
  'steel-greaves': { absorb: 45, abs: { slashing: 54, piercing: 45, bludgeoning: 36, elemental: 18 }, cover: { 'left-leg': 7, 'right-leg': 7 } },
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
/**
 * Natural armour (hide, scales, shell) covers the whole body except its weak spots: the soft
 * throat and belly of a beast or dragon, the swollen abdomen of a spider. Points left bare:
 */
export const WEAK_SPOTS = {
  humanoid: {},
  quadruped: { neck: 3, abdomen: 4 },
  arachnid: { abdomen: 8 },
};
const fullCover = (map) => Object.fromEntries((BODY_MAPS[map] ?? BODY_PARTS).map((p) => [p.id, Math.max(0, p.weight - (WEAK_SPOTS[map]?.[p.id] ?? 0))]));

/**
 * A creature's own nature against damage types, from its stat block: immune (no damage),
 * resistant (half), vulnerable (double). "Bludgeoning, piercing, and slashing from nonmagical
 * attacks" applies to physical blows from weapons without enchantment (silver gets past it when
 * the stat block says "that aren't silvered").
 */
export function affinityOf(stat) {
  const plain = (list) => (list ?? []).filter((x) => !/from nonmagical/i.test(x)).flatMap((x) => x.split(/,\s*(?:and\s+)?|\s+and\s+/)).map((x) => x.trim().toLowerCase()).filter(Boolean);
  const phys = (list) => (list ?? []).find((x) => /from nonmagical/i.test(x)) ?? null;
  const pr = phys(stat.resist); const pi = phys(stat.immune);
  return {
    immune: plain(stat.immune), resist: plain(stat.resist), vulnerable: plain(stat.vulnerable),
    mundane: pi ? 'immune' : pr ? 'resist' : null, silverGets: /silvered/i.test(pi ?? pr ?? ''),
  };
}
/**
 * How much of a damage type a creature takes: 0 (immune), 0.5 (resistant), 1, or 2 (vulnerable).
 * Plain (non-magic, non-silver) weapons against a creature that shrugs them off are softened
 * from 5e: "resistant" takes x0.75 and "immune" x0.5, because its natural armour already
 * absorbs part of each blow, and a party without magic weapons must still be able to win.
 */
export function typeFactor(def, type, { magic = false, silver = false } = {}) {
  const a = def?.affinity; if (!a || !type) return 1;
  if (a.immune.includes(type)) return 0;
  if (isPhysical(type) && a.mundane && !magic && !(silver && a.silverGets)) return a.mundane === 'immune' ? 0.5 : 0.75;
  if (a.resist.includes(type)) return 0.5;
  if (a.vulnerable.includes(type)) return 2;
  return 1;
}

export const shieldBlock = (pb, trained = true) => Math.min(MAX_BLOCK, 15 + (trained ? 5 * pb : 0));
export const parryBlock = (pb) => Math.min(MAX_BLOCK, 5 + 5 * pb);

/** The absorption armour gives at its condition (0-100%). */
export const effectiveAbsorb = (absorb, condition = 100) => Math.round(absorb * Math.max(0, Math.min(100, condition)) / 100);

/** A piece's absorption against one damage type (materials.js: form x metal x condition). */
export const pieceAbsorb = (p, type = 'slashing') => absorbFor({ abs: p.abs, metal: p.metal, condition: p.condition }, type);
/** An armour's four absorptions with its enchantment (+5 to each per +1). */
const withBonus = (abs, bonus = 0) => Object.fromEntries(Object.entries(abs).map(([k, v]) => [k, v + 5 * bonus]));
/** A creature's own hide, scales or shell: even against every blow, half as good against the elements. */
const naturalAbs = (a) => ({ slashing: a, piercing: a, bludgeoning: a, elemental: Math.round(a / 2) });

/**
 * One worn piece: { name, absorb (base), form, metal, condition, pct (against edges, for show),
 * cover, uid, hinder }. `cover` maps part id -> points covered (never more than the part's stretch).
 */
function piece({ name, absorb, abs, cover, condition = 100, uid = null, hinder = null, form = 'leather', metal = null, map = 'humanoid' }) {
  const c = Object.fromEntries(Object.entries(cover).map(([k, v]) => [k, Math.min(v, partOf(map, k)?.weight ?? 0)]));
  const points = Object.values(c).reduce((x, y) => x + y, 0);
  const p = { name, absorb, abs: abs ?? naturalAbs(absorb), form, metal, condition, cover: c, uid, hinder: hinder ?? hindranceOf(absorb, points) };
  p.pct = pieceAbsorb(p);
  return p;
}

/**
 * A hero's defence from what they wear and wield.
 * @returns {{ evasion, block, blockWith, pieces, armour, hinder, moveLost, map }}
 */
export function heroDefence(gear, { dex = 0, pb = 2, str = 10, shieldTrained = true, weaponTrained = () => true, magicEvasion = 0 } = {}) {
  const eq = (slot) => (gear.inventory ?? []).find((x) => x.uid === gear.equipped?.[slot]) ?? null;
  // Every armour slot: body armour, helm, gorget, vambraces, gloves, leg armour.
  const pieces = [];
  let raw = 0;
  for (const slot of ['body', 'head', 'throat', 'arms', 'hands', 'legs']) {
    const inst = eq(slot); const def = itemDef(inst);
    if (!def?.armor) continue;
    const a = ARMOURS[def.id] ?? { absorb: 10, abs: ARMOURS.leather.abs, cover: ARMOURS.leather.cover };
    const metal = metalOf(inst, def);
    const name = metal && metal !== metalOf({}, def) ? `${METALS[metal].name} ${def.name.toLowerCase()}` : def.name;
    // Enchantment adds absorption, not stiffness: hindrance stays the armour's own (and its metal's).
    // Enchantment and craftsmanship (a superior piece: +5%) both add absorption, not stiffness.
    const better = (inst.bonus ?? 0) + (inst.quality === 'superior' ? 1 : 0);
    const p = piece({ name: inst.quality === 'superior' ? `Superior ${name[0].toLowerCase()}${name.slice(1)}` : name, absorb: Math.min(MAX_ABSORB, a.absorb + 5 * better), abs: withBonus(a.abs, better), cover: a.cover, condition: inst.condition ?? 100, uid: inst.uid, hinder: a.hinder, form: ARMOUR_FORM[def.id] ?? 'leather', metal });
    p.slot = slot; pieces.push(p);
    raw += a.hinder === 0 ? 0 : rawHindrance(a.absorb, Object.values(a.cover).reduce((x, y) => x + y, 0)) * (METALS[metal]?.hinder ?? 1);
  }
  const hinder = Math.round(raw);
  // However stiff the armour, it never takes Evasion below 8 (unless you were already clumsier).
  const evasion = Math.max(Math.min(8, 10 + dex), 10 + dex - hinder) + magicEvasion;
  const offInst = eq('offHand'); const off = itemDef(offInst);
  const mainInst = eq('mainHand'); const main = itemDef(mainInst);
  const shield = off?.cat === 'shield' ? shieldBlock(pb, shieldTrained) + 5 * ((offInst.bonus ?? 0) + (offInst.quality === 'superior' ? 1 : 0)) : 0;
  const parry = main?.weapon && !main.weapon.ranged && weaponTrained(main) ? parryBlock(pb) : 0;
  const block = Math.min(MAX_BLOCK, Math.max(shield, parry));
  return { evasion, block, blockWith: block ? (shield >= parry ? 'shield' : 'parry') : null, pieces, armour: pieces.find((x) => x.slot === 'body') ?? pieces[0] ?? null, hinder, moveLost: moveSquaresLost(hinder, str), map: 'humanoid' };
}

/** Armour named in a stat block ("leather armor, shield", "natural armor"). */
const WORN = [
  [/half plate/i, 'half-plate'], [/\bplate\b/i, 'plate'], [/splint/i, 'splint'], [/chain mail/i, 'chain-mail'],
  [/chain shirt/i, 'chain-shirt'], [/ring mail/i, 'ring-mail'], [/scale/i, 'scale-mail'], [/breastplate/i, 'breastplate'],
  [/studded/i, 'studded-leather'], [/\bhide\b/i, 'hide-armour'], [/leather/i, 'leather'], [/padded/i, 'padded'],
  [/\bmail\b/i, 'chain-mail'], // "iron mail", "black mail", "ancient bronze mail": a coat of mail
];
/** The metal named in a stat block: "bronze mail", "black plate", "gilded scale"... */
const WORN_METAL = [[/mithral/i, 'mithral'], [/dwarf/i, 'dwarf-steel'], [/gild|gold/i, 'gold'], [/silver/i, 'silver'], [/bronze/i, 'bronze'], [/copper/i, 'copper'], [/black|dark/i, 'black-iron'], [/iron/i, 'iron']];
/** Weapons a creature can parry with (claws and jaws do not parry). */
const MADE_WEAPON = /sword|axe|mace|spear|scimitar|club|dagger|hammer|staff|flail|pick|glaive|halberd|rapier|morningstar|trident|maul|javelin|pike|lance|sickle|blade|knife|cudgel/i;

/** A monster's defence from its stat block. */
export function monsterDefence(stat) {
  const dex = stat.mods?.dex ?? 0;
  const pb = stat.proficiencyBonus ?? 2;
  const text = stat.armor ?? '';
  const map = bodyMapOf(stat);
  const hasShield = /shield/i.test(text);
  const worn = map === 'humanoid' ? WORN.find(([re]) => re.test(text))?.[1] : null;
  const wornDef = worn ? itemDef({ id: worn }) : null;
  let armour = null;
  if (wornDef) {
    const metal = isMetal(wornDef) ? (WORN_METAL.find(([re]) => re.test(text))?.[1] ?? 'steel') : null;
    armour = piece({ name: metal && metal !== 'steel' ? `${METALS[metal].name} ${wornDef.name.toLowerCase()}` : wornDef.name, ...ARMOURS[worn], form: ARMOUR_FORM[worn], metal });
  } else {
    const pts = Math.max(0, (stat.ac ?? 10) - 10 - dex - (hasShield ? 2 : 0));
    const absorb = Math.min(MAX_ABSORB, 6 * pts);
    // Natural armour, or something odd in the stat block ("robes of warding"): named in its own words.
    const own = text.split(',')[0].trim();
    if (absorb) armour = piece({ name: !own || /natural/i.test(own) ? 'natural armour' : own[0].toUpperCase() + own.slice(1), absorb, cover: fullCover(map), form: 'natural', map });
  }
  // Worn armour hinders monsters too; natural armour is part of the body and does not.
  const hinder = wornDef ? armour.hinder : 0;
  // The same floor as a hero's: heavy armour never takes Evasion below 8.
  const evasion = Math.max(Math.min(8, 10 + dex), 10 + dex - hinder);
  // Parrying is a trained fighter's skill (INT 8+): a troll swinging a club just swings.
  const canParry = map === 'humanoid' && (stat.scores?.int ?? 0) >= 8 && (stat.actions ?? []).some((a) => a.attack && ['mw', 'mrw'].includes(a.attack.kind) && MADE_WEAPON.test(a.name));
  const shield = hasShield ? shieldBlock(pb) : 0;
  const parry = canParry ? parryBlock(pb) : 0;
  const block = Math.min(MAX_BLOCK, Math.max(shield, parry));
  return { evasion, block, blockWith: block ? (shield >= parry ? 'shield' : 'parry') : null, pieces: armour ? [armour] : [], armour, hinder, moveLost: 0, map, affinity: affinityOf(stat) };
}

/** The pieces of armour that a blow at this part and offset meets. */
export const piecesAt = (def, part, offset) => (def?.pieces ?? []).filter((p) => offset <= (p.cover[part] ?? 0));

/** Layered absorption: each piece lets through (1 - its share); at most MAX_LAYERED. */
const layered = (pieces, type) => {
  if (!pieces.length) return 0;
  const through = pieces.reduce((f, p) => f * (1 - pieceAbsorb(p, type) / 100), 1);
  return Math.min(MAX_LAYERED, Math.round(100 * (1 - through)));
};

/**
 * Where a physical blow lands on this defender (d100 on its body map), and what armour it meets
 * there against that damage type.
 * @returns {{ part, offset, covered: boolean, pct: number, pieces }}  pct = combined absorption (0 in a gap)
 */
export function strike(def, d100, type = 'slashing') {
  const { part, offset } = strikeAt(d100, def?.map ?? 'humanoid');
  const met = piecesAt(def, part, offset);
  return { part, offset, covered: met.length > 0, pct: layered(met, type), pieces: met };
}

/**
 * Resistance to a non-physical damage type (fire, cold...): such damage does not land on one part;
 * the armour helps in proportion to how much of the body it covers. The average, over every point
 * of the body, of the layered absorption against that type.
 */
export function resistance(def, type) {
  if (!def?.pieces?.length) return 0;
  const list = BODY_MAPS[def.map ?? 'humanoid'] ?? BODY_PARTS;
  let sum = 0;
  for (const p of list) for (let o = 1; o <= p.weight; o++) sum += layered(piecesAt(def, p.id, o), type);
  return Math.round(sum / 100);
}

/**
 * Elemental damage after the armour (spells, breath, burning ground...): physical damage is
 * returned unchanged (it is dealt with where it lands); anything else is lessened by the armour's
 * overall resistance to that type.
 */
export function afterResistance(def, amount, type, how = {}) {
  if (!(amount > 0) || !type) return amount;
  if (isPhysical(type)) return Math.round(amount * typeFactor(def, type, how));
  const res = resistance(def, type);
  return Math.round((res ? amount * (1 - res / 100) : amount) * typeFactor(def, type, how));
}

/** Wear armour by one blow (1%, or 3% for a critical hit); returns the new condition. */
export function wearArmour(armour, crit = false) {
  if (!armour) return null;
  armour.condition = Math.max(0, armour.condition - (crit ? 3 : 1));
  armour.pct = pieceAbsorb(armour);
  return armour.condition;
}

/** Points of a part's stretch covered by at least one piece. */
export const partCover = (def, part) => Math.max(0, ...(def?.pieces ?? []).map((p) => p.cover[part] ?? 0));

/** Points of the body (out of 100) covered: by one piece, or (given a defence) by any of its pieces. */
export function coverage(x) {
  if (!x) return 0;
  if (x.pieces) return (BODY_MAPS[x.map ?? 'humanoid'] ?? BODY_PARTS).reduce((n, p) => n + partCover(x, p.id), 0);
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
  return `${ps.map((a) => `${a.name} ${pieceAbsorb(a, 'slashing')}/${pieceAbsorb(a, 'piercing')}/${pieceAbsorb(a, 'bludgeoning')}%${a.condition < 100 ? ` (condition ${a.condition}%)` : ''}`).join(', ')} (edge/point/blunt): ${n === 100 ? 'the whole body' : `${n} of 100 points covered`}${def.hinder ? `, hindrance ${def.hinder} (−${def.hinder} Evasion)` : ''}`;
}
