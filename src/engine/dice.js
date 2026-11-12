/**
 * Dice engine.
 *
 * An "rng" here is a function `(n) => integer in [0, n)`. Keeping that as the only
 * interface lets the game use true crypto randomness while tests use a seeded,
 * repeatable generator.
 */

const UINT32_RANGE = 2 ** 32;

/**
 * Uniform random integer in [0, maxExclusive) using the browser/Node crypto source.
 *
 * Why the loop (rejection sampling)? A raw 32-bit value has 2^32 outcomes. If we did
 * `x % 6`, 2^32 is not divisible by 6, so the first few remainders would come up very
 * slightly more often ("modulo bias"). We throw away the top sliver of values that
 * would cause that imbalance, so every face is exactly equally likely.
 */
export function cryptoRandomInt(maxExclusive) {
  if (!Number.isInteger(maxExclusive) || maxExclusive < 1 || maxExclusive > UINT32_RANGE) {
    throw new RangeError(`maxExclusive must be an integer in [1, 2^32], got ${maxExclusive}`);
  }
  const limit = UINT32_RANGE - (UINT32_RANGE % maxExclusive);
  const buf = new Uint32Array(1);
  let x;
  do {
    globalThis.crypto.getRandomValues(buf);
    x = buf[0];
  } while (x >= limit);
  return x % maxExclusive;
}

/** Deterministic generator (mulberry32) for tests and replayable rolls. */
export function seededRng(seed) {
  let a = seed >>> 0;
  return (maxExclusive) => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    const unit = ((t ^ (t >>> 14)) >>> 0) / UINT32_RANGE;
    return Math.floor(unit * maxExclusive);
  };
}

export const DIE_TYPES = [4, 6, 8, 10, 12, 20, 100];

export function rollDie(sides, rng = cryptoRandomInt) {
  return rng(sides) + 1;
}

export function rollDice(count, sides, rng = cryptoRandomInt) {
  return Array.from({ length: count }, () => rollDie(sides, rng));
}

const NOTATION = /^\s*(\d*)\s*d\s*(\d+)\s*(?:(kh|kl)\s*(\d+))?\s*(?:([+-])\s*(\d+))?\s*$/i;

/**
 * Parse dice notation: "d20", "1d20+5", "2d8-1", "4d6kh3" (keep highest 3),
 * "2d20kl1" (keep lowest 1, i.e. disadvantage).
 */
export function parseNotation(notation) {
  const m = NOTATION.exec(notation);
  if (!m) throw new SyntaxError(`Invalid dice notation: "${notation}"`);
  const count = m[1] === '' ? 1 : Number(m[1]);
  const sides = Number(m[2]);
  const keepMode = m[3] ? m[3].toLowerCase() : null;
  const keep = keepMode ? Number(m[4]) : count;
  const modifier = m[5] ? (m[5] === '-' ? -1 : 1) * Number(m[6]) : 0;
  if (count < 1 || count > 100) throw new RangeError('Dice count must be 1-100');
  if (sides < 2) throw new RangeError('A die needs at least 2 sides');
  if (keep < 1 || keep > count) throw new RangeError('Keep count must be between 1 and the dice count');
  return { count, sides, keepMode, keep, modifier };
}

/**
 * Roll dice notation. Returns every individual die so the UI can show which were dropped.
 * @returns {{notation:string, rolls:number[], keptIndices:number[], droppedIndices:number[], modifier:number, total:number}}
 */
export function roll(notation, rng = cryptoRandomInt) {
  // A flat amount ("1": a cat's claws) needs no dice.
  if (/^\s*\d+\s*$/.test(String(notation))) { const n = Number(notation); return { notation: String(notation), rolls: [], keptIndices: [], droppedIndices: [], modifier: n, total: n }; }
  const { count, sides, keepMode, keep, modifier } = parseNotation(notation);
  const rolls = rollDice(count, sides, rng);
  const order = rolls.map((_, i) => i);
  if (keepMode === 'kh') order.sort((a, b) => rolls[b] - rolls[a] || a - b);
  if (keepMode === 'kl') order.sort((a, b) => rolls[a] - rolls[b] || a - b);
  const keptIndices = order.slice(0, keep).sort((a, b) => a - b);
  const droppedIndices = order.slice(keep).sort((a, b) => a - b);
  const total = keptIndices.reduce((sum, i) => sum + rolls[i], 0) + modifier;
  return { notation, rolls, keptIndices, droppedIndices, modifier, total };
}

/** The classic ability-score roll: 4d6, drop the lowest die. Result range 3-18. */
export function rollAbilityScore(rng = cryptoRandomInt) {
  return roll('4d6kh3', rng);
}
