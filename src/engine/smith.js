/**
 * Repairs at a smith (the Trading Post's forge, Hedda in Ashford). Armour loses condition with
 * every blow it takes (defence.js); a smith restores it to 100% for coin:
 *
 *   cost = price new x (100 - condition)% x 1/2,  at least 1 silver
 *
 * so a coat of mail (75 gp) at 80% costs 75 x 0.20 x 0.5 = 7.5 gp. Later, crafters will be able
 * to mend gear with resources instead.
 */
import { itemDef, itemName } from './items.js';

const SP = 10;
/** Things that wear: armour of every kind (body pieces, helms, gauntlets...). */
export const wears = (inst) => !!itemDef(inst)?.armor;
export const conditionOf = (inst) => inst.condition ?? 100;

/** Copper to bring this item back to 100%. 0 if it needs nothing. */
export function repairCost(inst) {
  if (!wears(inst) || conditionOf(inst) >= 100) return 0;
  const def = itemDef(inst);
  const value = def.value * (inst.bonus ? [1, 20, 80, 300][inst.bonus] : 1);
  return Math.max(SP, Math.round(value * ((100 - conditionOf(inst)) / 100) * 0.5));
}

/** Everything in a hero's gear that a smith could mend, with prices. */
export const repairable = (gear) => (gear.inventory ?? []).filter((x) => repairCost(x) > 0).map((inst) => ({ inst, cost: repairCost(inst) }));

/** Mend one item (or everything with uid null). Returns { ok, cost, mended: [names], message }. */
export function repair(gear, uid = null) {
  const list = repairable(gear).filter((x) => uid === null || x.inst.uid === uid);
  if (!list.length) return { ok: false, cost: 0, mended: [], message: 'Nothing here needs mending.' };
  const cost = list.reduce((n, x) => n + x.cost, 0);
  if ((gear.coins ?? 0) < cost) return { ok: false, cost, mended: [], message: 'Not enough coin for the repairs.' };
  gear.coins -= cost;
  for (const x of list) x.inst.condition = 100;
  return { ok: true, cost, mended: list.map((x) => itemName(x.inst)), message: null };
}
