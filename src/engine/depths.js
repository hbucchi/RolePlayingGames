/**
 * The descent: a generated dungeon is 10 floors deep. Each floor down is more dangerous and pays
 * more, so every staircase is a choice (go on, or carry your gains out: engine/delve.js). The
 * tenth floor is one great hall with a boss.
 *
 * Danger rises gradually, three ways:
 *   level     foes are matched to the party's level + 0.4 per floor below the first
 *             (floor 1: +0, floor 4: +1, floor 6: +2, floor 9: +3, the boss: +4)
 *   mix       fewer easy rooms and more hard ones the deeper you go
 *   crowding  a few more rooms hold someone
 * Rewards rise with it: experience and coins x(1 + 0.25 per floor below the first), so floor 5
 * pays twice what floor 1 does, and chests are stocked as for a party a level higher every
 * two floors.
 *
 * Why it balances: going down is worth it when (chance to survive) x (what the floor pays) is
 * more than (chance to fall) x (what you carry and would lose). Danger and pay both grow, so
 * the answer changes from floor to floor, and from party to party.
 */
import { THRESHOLDS, crowdMultiplier } from './progression.js';

export const MAX_DEPTH = 10;
export const isBossFloor = (depth) => depth >= MAX_DEPTH;

/** The level foes are matched to on a floor. */
export const depthLevel = (partyLevel, depth) => Math.min(20, Math.max(1, partyLevel + Math.round((Math.max(1, depth) - 1) * 0.4)));

/** The level the boss is matched to: the party's own (the floors' +0.4 each is for the rooms). */
export const bossLevel = (partyLevel) => Math.min(20, Math.max(1, partyLevel));

/** What a floor pays, as a multiple of the first floor (XP and coins). */
export const depthReward = (depth) => 1 + 0.25 * (Math.max(1, depth) - 1);

/** The level chests are stocked for. */
export const lootLevel = (partyLevel, depth) => Math.min(20, partyLevel + Math.floor((Math.max(1, depth) - 1) / 2));

/** Each room's encounter: % easy, % medium (the rest hard), and the chance a room is occupied. */
export function depthMix(depth) {
  const d = Math.max(1, depth) - 1;
  const easy = Math.max(10, 40 - 4 * d);
  const hard = Math.min(45, 15 + 4 * d);
  return { easy, medium: 100 - easy - hard, hard, chance: Math.min(0.7, 0.5 + 0.025 * d) };
}

/**
 * The boss of the tenth floor, for a party of this size at its level: a creature worth between
 * "hard" and "deadly" XP for them (5e budget), one of the three strongest that fit; with a pair
 * of guards from what is left of the budget when the boss alone is far short of it. On the
 * throne it also takes one legendary action a round (tools/sim: fresh parties win about 60-90%,
 * worn ones from nine floors of fighting rather less).
 * `pool`: stat blocks with .xp. `rng(n)` returns 0..n-1.
 * @returns {{ boss, guards: [] }}
 */
export function pickBoss(pool, level, partySize, rng) {
  const lv = Math.min(20, Math.max(1, level));
  const low = THRESHOLDS[lv][2] * partySize; const high = THRESHOLDS[lv][3] * partySize;
  const sorted = [...pool].sort((a, b) => b.xp - a.xp);
  const fits = sorted.filter((m) => m.xp <= high && m.xp >= low);
  const boss = fits.length ? fits[rng(Math.min(3, fits.length))] : sorted.find((m) => m.xp <= high) ?? sorted[sorted.length - 1];
  const guards = [];
  // Room for two guards? Adjusted XP with 3 creatures is x2 (progression.js crowdMultiplier).
  const spare = high / crowdMultiplier(3) - boss.xp;
  if (spare > 0) {
    const g = sorted.filter((m) => m.id !== boss.id && m.xp * 2 <= spare && m.xp >= spare / 8);
    if (g.length) { const pick = g[rng(g.length)]; guards.push(pick, pick); }
  }
  return { boss, guards };
}
