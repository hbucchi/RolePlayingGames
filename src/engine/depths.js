/**
 * The descent: a generated dungeon is 10 floors deep. Each floor down is more dangerous and pays
 * more, so every staircase is a choice (go on, or carry your gains out: engine/delve.js). The
 * tenth floor is one great hall with a boss.
 *
 * Danger rises gradually, three ways:
 *   level     foes are matched to the party's level + 0.3 per floor below the first
 *             (floor 1: +0, floor 3: +1, floor 6: +2, floor 9: +2, floor 10's boss: see bossLevel)
 *   mix       fewer easy rooms and more hard ones the deeper you go (hard: 15% to 35%)
 *   crowding  a few more rooms hold someone (45% to 60%)
 * and with the size of the party (PARTY_FILL): one hero meets half the rooms a party of four does.
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
export const depthLevel = (partyLevel, depth) => Math.min(20, Math.max(1, partyLevel + Math.round((Math.max(1, depth) - 1) * 0.3)));

/** The level the boss is matched to: the party's own (the floors' +0.4 each is for the rooms). */
export const bossLevel = (partyLevel) => Math.min(20, Math.max(1, partyLevel));

/** What a floor pays, as a multiple of the first floor (XP and coins). */
export const depthReward = (depth) => 1 + 0.25 * (Math.max(1, depth) - 1);

/** The level chests are stocked for. */
export const lootLevel = (partyLevel, depth) => Math.min(20, partyLevel + Math.floor((Math.max(1, depth) - 1) / 2));

/**
 * How full a floor is for a party of this size: a lone hero meets about half as many occupied
 * rooms as a party of four, and more of them easy. (The encounter budget already scales each
 * room's foes with the party, progression.js; this scales how many rooms there are to fight, since
 * one hero has a quarter of a party's hit points to carry through the whole floor.)
 */
export const PARTY_FILL = { 1: 0.5, 2: 0.7, 3: 0.85, 4: 1 };
const EASIER = { 1: 15, 2: 8, 3: 3, 4: 0 }; // percentage points moved from hard to easy

/** Each room's encounter: % easy, % medium (the rest hard), and the chance a room is occupied. */
export function depthMix(depth, partySize = 4) {
  const d = Math.max(1, depth) - 1;
  const size = Math.min(4, Math.max(1, partySize));
  const shift = EASIER[size];
  const hard = Math.max(5, Math.min(35, 15 + 2.5 * d) - shift);
  const easy = Math.min(60, Math.max(15, 40 - 3 * d) + shift);
  return { easy, medium: 100 - easy - hard, hard, chance: Math.min(0.6, 0.45 + 0.017 * d) * PARTY_FILL[size] };
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
/** The boss's XP band by party size: indexes into THRESHOLDS (0 easy, 1 medium, 2 hard, 3 deadly). */
export const BOSS_BAND = { 1: [0, 1], 2: [1, 2], 3: [2, 3], 4: [2, 3] };
/** Legendary actions only against a party: a lone hero would face two blows a round. */
export const bossHasLegendary = (partySize) => partySize >= 2;

export function pickBoss(pool, level, partySize, rng) {
  const lv = Math.min(20, Math.max(1, level));
  // A lone hero has one turn a round against the boss's turn and its legendary blow: they get an
  // easier boss (easy to medium); a pair medium to hard; three or four, hard to deadly.
  const band = BOSS_BAND[Math.min(4, Math.max(1, partySize))];
  const low = THRESHOLDS[lv][band[0]] * partySize; const high = THRESHOLDS[lv][band[1]] * partySize;
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
