/**
 * Selling loot to traders.
 *
 * A trader pays half an item's buying price (its value in the catalogue). Once per visit a hero
 * may haggle: a Charisma (Persuasion) check. Every point the total beats 10 adds 1% to the price,
 * up to 75%. A natural 1 annoys the trader (45% for this visit); a natural 20 adds another 5%.
 *
 *   rate = clamp(0.50 + 0.01 x (total - 10), 0.50, 0.75)
 *
 * So a hero with Persuasion +5 who rolls 12 (total 17) sells at 57%; one with +0 needs a 20 to
 * reach 65% (60% for beating 10 by 10, plus 5% for the natural 20). Prices are in copper, rounded down.
 */
import { itemDef, itemValue, isEquipped } from './items.js';

export const BASE_RATE = 0.5;
export const MAX_RATE = 0.75;

/** The rate a haggling roll earns. `d20` is the die itself (for the natural 1 and 20). */
export function haggleRate(total, d20 = 10) {
  if (d20 === 1) return 0.45;
  const rate = BASE_RATE + Math.max(0, total - 10) * 0.01 + (d20 === 20 ? 0.05 : 0);
  return Math.round(Math.min(MAX_RATE, rate) * 100) / 100;
}

/** What a trader pays for one of an item (or `qty` of a stack), in copper. */
export function sellPrice(inst, rate = BASE_RATE, qty = 1) {
  const each = itemValue({ ...inst, qty: 1 });
  return Math.floor(each * rate * qty);
}

/**
 * Can this be sold? Not while worn or wielded (take it off first), not quest items (the Steward
 * wants his signet back), not keys, and not things worth nothing.
 */
export function whyUnsellable(gear, inst) {
  const def = itemDef(inst);
  if (!def) return 'unknown item';
  if (isEquipped(gear, inst.uid)) return 'take it off first';
  if (def.quest || def.key) return 'not for sale';
  if (!(itemValue({ ...inst, qty: 1 }) > 0)) return 'worthless';
  return null;
}

/**
 * Sell `qty` (default: the whole stack) of an item from a hero's gear. Changes the gear: the item
 * leaves the pack, the coins go in the purse. Returns { ok, coins, sold, message }.
 */
export function sellItem(gear, uid, rate = BASE_RATE, qty = null) {
  const inst = gear.inventory.find((x) => x.uid === uid);
  if (!inst) return { ok: false, message: 'You no longer have that.' };
  const why = whyUnsellable(gear, inst);
  if (why) return { ok: false, message: `Cannot sell that: ${why}.` };
  const have = inst.qty ?? 1; const n = Math.max(1, Math.min(have, qty ?? have));
  const coins = sellPrice(inst, rate, n);
  if (n >= have) gear.inventory = gear.inventory.filter((x) => x !== inst);
  else inst.qty = have - n;
  gear.coins = (gear.coins ?? 0) + coins;
  return { ok: true, coins, sold: n, message: null };
}

/** Everything a trader would buy from this pack, with prices at `rate`. */
export function sellable(gear, rate = BASE_RATE) {
  return (gear.inventory ?? []).map((inst) => ({ inst, why: whyUnsellable(gear, inst), each: sellPrice(inst, rate, 1), all: sellPrice(inst, rate, inst.qty ?? 1) }));
}
