/**
 * Experience, levels and encounter balance (5e SRD / DMG rules).
 *
 * Encounter maths: every monster is worth XP. To judge how dangerous a fight is, add up the
 * monsters' XP and multiply by a crowd factor (a pair of goblins is worse than twice one goblin,
 * because the hero is attacked twice per round): 1 monster x1, 2 x1.5, 3-6 x2, 7-10 x2.5 ...
 * Compare that "adjusted XP" with the hero's thresholds for easy / medium / hard / deadly.
 */
import { seededRng } from './dice.js';

/** XP needed to reach each level (index = level). */
export const XP_FOR_LEVEL = [0, 0, 300, 900, 2700, 6500, 14000, 23000, 34000, 48000, 64000, 85000, 100000, 120000, 140000, 165000, 195000, 225000, 265000, 305000, 355000];

export function levelForXp(xp) {
  let lvl = 1;
  for (let l = 2; l <= 20; l++) if (xp >= XP_FOR_LEVEL[l]) lvl = l;
  return lvl;
}

/** Progress toward the next level as { into, needed, fraction }. */
export function xpProgress(xp, level = levelForXp(xp)) {
  if (level >= 20) return { into: 0, needed: 0, fraction: 1 };
  const lo = XP_FOR_LEVEL[level]; const hi = XP_FOR_LEVEL[level + 1];
  return { into: xp - lo, needed: hi - lo, fraction: Math.max(0, Math.min(1, (xp - lo) / (hi - lo))) };
}

/** Per-character XP thresholds (DMG): [easy, medium, hard, deadly]. */
export const THRESHOLDS = [null,
  [25, 50, 75, 100], [50, 100, 150, 200], [75, 150, 225, 400], [125, 250, 375, 500], [250, 500, 750, 1100],
  [300, 600, 900, 1400], [350, 750, 1100, 1700], [450, 900, 1400, 2100], [550, 1100, 1600, 2400], [600, 1200, 1900, 2800],
  [800, 1600, 2400, 3600], [1000, 2000, 3000, 4500], [1100, 2200, 3400, 5100], [1250, 2500, 3800, 5700], [1400, 2800, 4300, 6400],
  [1600, 3200, 4800, 7200], [2000, 3900, 5900, 8800], [2100, 4200, 6300, 9500], [2400, 4900, 7300, 10900], [2800, 5700, 8500, 12700],
];
export const DIFFICULTY = ['easy', 'medium', 'hard', 'deadly'];

export function crowdMultiplier(n) {
  if (n <= 1) return 1;
  if (n === 2) return 1.5;
  if (n <= 6) return 2;
  if (n <= 10) return 2.5;
  if (n <= 14) return 3;
  return 4;
}

export const adjustedXp = (xps) => xps.reduce((a, b) => a + b, 0) * crowdMultiplier(xps.length);

/** Rate an encounter for a party: 'trivial' | 'easy' | 'medium' | 'hard' | 'deadly'. */
export function rateEncounter(xps, levels) {
  const adj = adjustedXp(xps);
  const sum = (i) => levels.reduce((a, l) => a + THRESHOLDS[Math.min(20, Math.max(1, l))][i], 0);
  let rating = 'trivial';
  for (let i = 0; i < 4; i++) if (adj >= sum(i)) rating = DIFFICULTY[i];
  return { adjusted: adj, rating };
}

/**
 * Build one room's encounter for a hero of `level`: 1 or 2 monsters (never more, so rooms
 * stay readable) whose adjusted XP stays within the hero's budget. `pool` is a list of
 * monster stat blocks with .xp. Prefers monsters that use a good share of the budget.
 */
export function buildEncounter(level, pool, rng, { difficulty = 'medium', maxCount = 2, partySize = 1 } = {}) {
  // A party's budget is the sum of its members' thresholds (here: same level, so x party size).
  const budget = THRESHOLDS[Math.min(20, Math.max(1, level))][DIFFICULTY.indexOf(difficulty)] * partySize;
  const sorted = [...pool].sort((a, b) => a.xp - b.xp);
  const count = maxCount <= 1 ? 1 : 1 + (rng(100) < 45 ? 1 : 0) + (maxCount > 2 && rng(100) < 35 ? 1 : 0) + (maxCount > 3 && rng(100) < 25 ? 1 : 0);
  const per = budget / (crowdMultiplier(count) * count);
  let fits = sorted.filter((m) => m.xp <= per && m.xp >= per / 4);
  if (!fits.length) fits = sorted.filter((m) => m.xp <= per);
  if (!fits.length) return [sorted[0]];
  const first = fits[rng(fits.length)];
  const group = [first];
  // A band: usually the same kind (a hunting pack, guards), sometimes mixed.
  while (group.length < count) group.push(rng(100) < 65 ? first : fits[rng(fits.length)]);
  return group;
}

/**
 * Starting wealth for a hero who begins above level 1 (sandbox mode), loosely after the DMG's
 * "Starting at Higher Level" table. In copper pieces.
 */
export function startingWealth(level, rng = seededRng(level)) {
  if (level <= 1) return 0;
  if (level <= 4) return (2 + rng(4)) * 1000; // a few dozen gold
  if (level <= 10) return 50000 + (1 + rng(10)) * 2500; // 500 gp + 1d10 x 25 gp
  if (level <= 16) return 500000 + (1 + rng(10)) * 25000; // 5,000 gp + 1d10 x 250 gp
  return 2000000 + (1 + rng(10)) * 250000; // 20,000 gp + 1d10 x 2,500 gp
}

/** Magic items a sandbox hero may start with (DMG: by tier). Returns [{ id?, bonus?, base? }]. */
export function startingMagic(level) {
  if (level < 5) return [];
  if (level < 11) return [{ id: 'potion-greater-healing', qty: 2 }, { base: 'weapon', bonus: 1 }];
  if (level < 17) return [{ id: 'potion-superior-healing', qty: 2 }, { base: 'weapon', bonus: 2 }, { base: 'armor', bonus: 1 }];
  return [{ id: 'potion-superior-healing', qty: 4 }, { base: 'weapon', bonus: 3 }, { base: 'armor', bonus: 2 }, { id: 'ring-of-protection' }];
}
