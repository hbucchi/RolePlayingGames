// Which party a monster is meant for, by the 5e encounter budget.
import { THRESHOLDS, crowdMultiplier } from '../../src/engine/progression.js';

/**
 * Party level and group size that make this monster a hard fight: the adjusted XP nearest (on a
 * log scale) the middle of the hard-to-deadly band, sqrt(hard x deadly).
 */
export function matchFor(stat) {
  const xp = stat.xp ?? 0;
  const mid = (lv) => Math.sqrt(THRESHOLDS[lv][2] * THRESHOLDS[lv][3]) * 4;
  const off = (adj, lv) => Math.abs(Math.log(adj / mid(lv)));
  if (xp >= THRESHOLDS[1][2] * 4) {
    let best = 1;
    for (let l = 1; l <= 20; l++) if (off(xp, l) < off(xp, best)) best = l;
    return { level: best, count: 1, beyond: xp > THRESHOLDS[20][3] * 4 };
  }
  let n = 1;
  for (let k = 1; k <= 8; k++) if (off(k * xp * crowdMultiplier(k), 1) < off(n * xp * crowdMultiplier(n), 1)) n = k;
  return { level: 1, count: n };
}
