/**
 * What the traders remember between visits, kept on this device: how many adventures the company
 * has finished (traders' rare offers change every 3, engine/shop.js), and which rare offers were
 * already bought. Storage can be missing (private windows): then everything reads as zero.
 */
const KEY = 'rpg.shop';

function read() {
  try { return JSON.parse(localStorage.getItem(KEY)) ?? {}; } catch { return {}; }
}
function write(v) {
  try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* no storage: nothing is remembered */ }
}

/** Adventures finished so far (dungeon floors, story battles won, campaign places cleared). */
export const adventures = () => read().adventures ?? 0;

/** One more adventure finished. Returns the new count. */
export function countAdventure() {
  const v = read(); v.adventures = (v.adventures ?? 0) + 1;
  // Forget purchases from old periods: only the current one matters.
  const p = Math.floor(v.adventures / 3);
  v.bought = Object.fromEntries(Object.entries(v.bought ?? {}).filter(([, per]) => per >= p));
  write(v); return v.adventures;
}

/** Was this trader's rare offer for `period` already bought? */
export const rareBought = (traderKey, period) => read().bought?.[traderKey] === period;
export function markRareBought(traderKey, period) {
  const v = read(); v.bought = { ...(v.bought ?? {}), [traderKey]: period }; write(v);
}
