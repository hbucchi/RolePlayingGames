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
import { BODY_PARTS, BODY_BY_ID } from './body.js';

export const PART_RULES = {
  head: { hp: 0.3, mult: 1.5, crippled: 'dazed' },
  neck: { hp: 0.2, mult: 2, crippled: 'bleeding' },
  chest: { hp: 0.6, mult: 1, crippled: 'bleeding' },
  abdomen: { hp: 0.45, mult: 1, crippled: 'bleeding' },
  'right-arm': { hp: 0.4, mult: 0.75, crippled: 'weapon arm' },
  'left-arm': { hp: 0.4, mult: 0.75, crippled: 'shield arm' },
  'right-hand': { hp: 0.2, mult: 0.5, crippled: 'weapon arm' },
  'left-hand': { hp: 0.2, mult: 0.5, crippled: 'shield arm' },
  'right-leg': { hp: 0.45, mult: 0.75, crippled: 'lame' },
  'left-leg': { hp: 0.45, mult: 0.75, crippled: 'lame' },
};
export const CRIPPLED_TEXT = {
  dazed: 'dazed: −2 Evasion, disadvantage on attacks',
  bleeding: 'bleeding: −1 HP each turn',
  'weapon arm': 'weapon arm useless: disadvantage on attacks, no parrying',
  'shield arm': 'shield arm useless: no blocking with a shield',
  lame: 'lame: −2 squares of movement',
};

/** A part's health: its share of the creature's maximum HP (at least 2). */
export const partMax = (maxHp, part) => Math.max(2, Math.round(maxHp * (PART_RULES[part]?.hp ?? 0.4)));
/** Damage a part has taken so far. */
export const partDamage = (e, part) => e.parts?.[part] ?? 0;
export const partLeft = (e, part) => Math.max(0, partMax(e.maxHp, part) - partDamage(e, part));
export const isCrippled = (e, part) => partDamage(e, part) >= partMax(e.maxHp, part);
export const crippledParts = (e) => BODY_PARTS.filter((p) => isCrippled(e, p.id)).map((p) => p.id);

/**
 * A blow of `damage` (already past the armour) lands on `part`.
 * @returns {{ total, mult, partLeft, partMax, crippledNow: boolean }}  `total` is what total HP loses.
 */
export function applyHit(e, part, damage) {
  e.parts ??= {};
  const max = partMax(e.maxHp, part);
  const before = partDamage(e, part);
  e.parts[part] = Math.min(max, before + damage);
  const mult = PART_RULES[part]?.mult ?? 1;
  return { total: Math.max(1, Math.round(damage * mult)), mult, partLeft: max - e.parts[part], partMax: max, crippledNow: before < max && e.parts[part] >= max };
}

/** What crippled parts cost right now. */
export function injuryPenalties(e) {
  const out = { attackDis: [], evasion: 0, noShield: false, noParry: false, moveLost: 0, bleeding: false };
  for (const part of crippledParts(e)) {
    const kind = PART_RULES[part].crippled;
    if (kind === 'dazed') { out.evasion -= 2; out.attackDis.push('dazed by a head wound'); }
    if (kind === 'bleeding') out.bleeding = true;
    if (kind === 'weapon arm') { out.noParry = true; if (!out.attackDis.includes('weapon arm crippled')) out.attackDis.push('weapon arm crippled'); }
    if (kind === 'shield arm') out.noShield = true;
    if (kind === 'lame') out.moveLost += 2;
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
  return BODY_PARTS.filter((p) => partDamage(e, p.id) > 0)
    .map((p) => ({ p, left: partLeft(e, p.id), max: partMax(e.maxHp, p.id) }))
    .sort((a, b) => a.left / a.max - b.left / b.max)
    .map(({ p, left, max }) => `${BODY_BY_ID[p.id].name} ${left}/${max}${left <= 0 ? ` (${PART_RULES[p.id].crippled})` : ''}`);
}
