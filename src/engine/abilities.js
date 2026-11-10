/** The six abilities and the three ways to generate scores (5e SRD rules). */

export const ABILITY_IDS = ['str', 'dex', 'con', 'int', 'wis', 'cha'];

export const ABILITIES = {
  str: { name: 'Strength', short: 'STR', blurb: 'Raw might: lifting, climbing, melee blows.' },
  dex: { name: 'Dexterity', short: 'DEX', blurb: 'Agility and reflexes: bows, stealth, dodging.' },
  con: { name: 'Constitution', short: 'CON', blurb: 'Stamina and health: adds to hit points.' },
  int: { name: 'Intelligence', short: 'INT', blurb: 'Reason and memory: lore, investigation.' },
  wis: { name: 'Wisdom', short: 'WIS', blurb: 'Perception and insight: noticing, healing, wild-craft.' },
  cha: { name: 'Charisma', short: 'CHA', blurb: 'Force of personality: persuasion, song, command.' },
};

export const SCORE_CAP = 20;

/**
 * Modifier = floor((score - 10) / 2).
 * 10-11 is average (+0); every 2 points away from that shifts the modifier by 1.
 * Math.floor (not truncation) matters for low scores: score 9 -> floor(-0.5) = -1.
 */
export function abilityModifier(score) {
  return Math.floor((score - 10) / 2);
}

export function formatModifier(mod) {
  return mod >= 0 ? `+${mod}` : `${mod}`;
}

export const ABILITY_METHODS = {
  roll: { name: 'Roll the dice', blurb: 'Roll 4d6 six times, drop the lowest die each time, then place the results.' },
  standard: { name: 'Standard array', blurb: 'Place a fixed set of scores: 15, 14, 13, 12, 10, 8. Fair and predictable.' },
  pointbuy: { name: 'Point buy', blurb: 'Spend 27 points to buy each score between 8 and 15.' },
};

export const STANDARD_ARRAY = Object.freeze([15, 14, 13, 12, 10, 8]);

export const POINT_BUY = Object.freeze({
  budget: 27,
  min: 8,
  max: 15,
  costs: Object.freeze({ 8: 0, 9: 1, 10: 2, 11: 3, 12: 4, 13: 5, 14: 7, 15: 9 }),
});

export function pointBuyScoreCost(score) {
  const cost = POINT_BUY.costs[score];
  if (cost === undefined) throw new RangeError(`Point-buy scores must be ${POINT_BUY.min}-${POINT_BUY.max}, got ${score}`);
  return cost;
}

export function pointBuyTotal(scores) {
  return ABILITY_IDS.reduce((sum, id) => sum + pointBuyScoreCost(scores[id]), 0);
}

export function scoresFilledWith(value) {
  return Object.fromEntries(ABILITY_IDS.map((id) => [id, value]));
}

/** Add racial (or other) bonuses to base scores, capped at 20. */
export function applyBonuses(base, bonuses = {}, cap = SCORE_CAP) {
  return Object.fromEntries(
    ABILITY_IDS.map((id) => [id, Math.min(cap, (base[id] ?? 0) + (bonuses[id] ?? 0))]),
  );
}

/**
 * Assign pool values to abilities by priority: highest value to the first ability, and so on.
 * Returns a map ability -> pool index.
 */
export function autoAssign(pool, priority) {
  const order = pool.map((v, i) => ({ v, i })).sort((a, b) => b.v - a.v || a.i - b.i);
  const fullPriority = [...priority, ...ABILITY_IDS.filter((id) => !priority.includes(id))];
  return Object.fromEntries(fullPriority.map((id, rank) => [id, order[rank]?.i ?? null]));
}
