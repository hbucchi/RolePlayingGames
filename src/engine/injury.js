/**
 * Local injuries. Every creature has its total hit points and, for each body part, a part health
 * (a share of its maximum HP). A blow that lands (defence.js) hurts in two ways:
 *
 *   the part      takes the damage that got past the armour, as it is;
 *   total HP      takes that damage x the part's multiplier: the neck is the most dangerous
 *                 place to be struck (x2), the head next (x1.5); limbs are tougher (x0.75), hands
 *                 tougher still (x0.5).
 *
 * If total HP reaches 0 first, the creature falls (or dies). If a part reaches 0 first it is
 * crippled, with a heavy penalty until it is healed:
 *   head            dazed: -2 Evasion, disadvantage on attacks
 *   neck, chest,
 *   abdomen         bleeding: 1 hit point lost at the start of each of its turns
 *   right arm/hand  the weapon arm: disadvantage on attacks, no parrying
 *   left arm/hand   the shield arm: no blocking with a shield
 *   each leg        -2 squares of movement (both: barely a crawl)
 *
 * The average multiplier, weighted by how often each part is struck, is about 0.93: a little
 * under 1, so blows to the body's tougher parts make fights last slightly longer, and a blow to
 * the neck or head is a real danger.
 *
 * Healing (potions, spells) mends total HP and every hurt part by the same amount.
 */
import { BODY_MAPS, partOf } from './body.js';

const HUMANOID_RULES = {
  head: { hp: 0.75, mult: 1.5, crippled: 'dazed' },
  neck: { hp: 0.6, mult: 2, crippled: 'bleeding' },
  chest: { hp: 0.9, mult: 1, crippled: 'bleeding' },
  abdomen: { hp: 0.8, mult: 1, crippled: 'bleeding' },
  'right-arm': { hp: 0.8, mult: 0.75, crippled: 'weapon arm' },
  'left-arm': { hp: 0.8, mult: 0.75, crippled: 'shield arm' },
  'right-hand': { hp: 0.6, mult: 0.5, crippled: 'weapon arm' },
  'left-hand': { hp: 0.6, mult: 0.5, crippled: 'shield arm' },
  'right-leg': { hp: 0.85, mult: 0.75, crippled: 'lame', lame: 2 },
  'left-leg': { hp: 0.85, mult: 0.75, crippled: 'lame', lame: 2 },
};
/** Per body map (body.js): a part's share of max HP, its multiplier to total HP, what crippling does. */
export const RULES_BY_MAP = {
  humanoid: HUMANOID_RULES,
  quadruped: {
    head: { hp: 0.3, mult: 1.5, crippled: 'dazed' },
    neck: { hp: 0.35, mult: 2, crippled: 'bleeding' },
    chest: { hp: 0.6, mult: 1, crippled: 'bleeding' },
    abdomen: { hp: 0.45, mult: 1, crippled: 'bleeding' },
    hindquarters: { hp: 0.5, mult: 1, crippled: 'lame', lame: 1 },
    tail: { hp: 0.25, mult: 0.5, crippled: 'docked' },
    ...Object.fromEntries(['fore-left-leg', 'fore-right-leg', 'hind-left-leg', 'hind-right-leg'].map((id) => [id, { hp: 0.4, mult: 0.75, crippled: 'lame', lame: 1 }])),
  },
  arachnid: {
    head: { hp: 0.3, mult: 1.5, crippled: 'dazed' },
    cephalothorax: { hp: 0.6, mult: 1, crippled: 'bleeding' },
    abdomen: { hp: 0.5, mult: 1.25, crippled: 'bleeding' }, // soft and swollen
    ...Object.fromEntries([1, 2, 3, 4, 5, 6, 7, 8].map((n) => [`leg-${n}`, { hp: 0.25, mult: 0.5, crippled: 'lame', lame: 1 }])),
  },
};
/** Humanoid rules by part id (the heroes' bodies). */
export const PART_RULES = HUMANOID_RULES;
const mapOf = (e) => e?.bodyMap ?? 'humanoid';
export const ruleOf = (e, part) => RULES_BY_MAP[mapOf(e)]?.[part] ?? HUMANOID_RULES[part] ?? { hp: 0.4, mult: 1, crippled: 'bleeding' };

export const CRIPPLED_TEXT = {
  dazed: 'dazed: −2 Evasion, disadvantage on attacks',
  bleeding: 'bleeding: −1 HP each turn',
  'weapon arm': 'weapon arm useless: disadvantage on attacks, no parrying',
  'shield arm': 'shield arm useless: no blocking with a shield',
  lame: 'lame: slower (−2 squares for a person, −1 a leg for beasts and spiders)',
  docked: 'tail crippled: no other effect',
};

/**
 * A part's health: its share of the creature's maximum HP, at least 6. The shares are high (a
 * leg has 85% of the body's HP) so that crippling is a real but occasional blow: about one part
 * in a level-1 fight with goblins, more against big hitters like an ogre (tools/sim).
 */
export const PART_MIN = 6;
export const partMax = (maxHp, part, e = null) => Math.max(PART_MIN, Math.round(maxHp * ruleOf(e, part).hp));
/** Damage a part has taken so far. */
export const partDamage = (e, part) => e.parts?.[part] ?? 0;
export const partLeft = (e, part) => Math.max(0, partMax(e.maxHp, part, e) - partDamage(e, part));
export const isCrippled = (e, part) => partDamage(e, part) >= partMax(e.maxHp, part, e);
export const crippledParts = (e) => (BODY_MAPS[mapOf(e)] ?? BODY_MAPS.humanoid).filter((p) => isCrippled(e, p.id)).map((p) => p.id);

/**
 * A blow of `damage` (already past the armour) lands on `part`.
 * @returns {{ total, mult, partLeft, partMax, crippledNow: boolean }}  `total` is what total HP loses.
 */
export function applyHit(e, part, damage) {
  e.parts ??= {};
  const max = partMax(e.maxHp, part, e);
  const before = partDamage(e, part);
  e.parts[part] = Math.min(max, before + damage);
  const mult = ruleOf(e, part).mult;
  return { total: damage > 0 ? Math.max(1, Math.round(damage * mult)) : 0, mult, partLeft: max - e.parts[part], partMax: max, crippledNow: before < max && e.parts[part] >= max };
}

/** What crippled parts cost right now. */
export function injuryPenalties(e) {
  const out = { attackDis: [], evasion: 0, noShield: false, noParry: false, moveLost: 0, bleeding: false };
  for (const part of crippledParts(e)) {
    const rule = ruleOf(e, part); const kind = rule.crippled;
    if (kind === 'dazed') { out.evasion -= 2; out.attackDis.push('dazed by a head wound'); }
    if (kind === 'bleeding') out.bleeding = true;
    if (kind === 'weapon arm') { out.noParry = true; if (!out.attackDis.includes('weapon arm crippled')) out.attackDis.push('weapon arm crippled'); }
    if (kind === 'shield arm') out.noShield = true;
    if (kind === 'lame') out.moveLost += rule.lame ?? 2;
  }
  return out;
}

/** Healing mends total HP elsewhere; here every hurt part recovers the same amount. */
export function healParts(e, amount) {
  if (!e.parts || amount <= 0) return;
  for (const k of Object.keys(e.parts)) { e.parts[k] = Math.max(0, e.parts[k] - amount); if (!e.parts[k]) delete e.parts[k]; }
}

/** "Left leg 2/9 (lame)" lines for the hurt parts, worst first. */
export function injuryLines(e) {
  return (BODY_MAPS[mapOf(e)] ?? BODY_MAPS.humanoid).filter((p) => partDamage(e, p.id) > 0)
    .map((p) => ({ p, left: partLeft(e, p.id), max: partMax(e.maxHp, p.id, e) }))
    .sort((a, b) => a.left / a.max - b.left / b.max)
    .map(({ p, left, max }) => `${partOf(mapOf(e), p.id).name} ${left}/${max}${left <= 0 ? ` (${ruleOf(e, p.id).crippled})` : ''}`);
}
