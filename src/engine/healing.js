/**
 * Healing in town. Wounds (and hurt body parts, injury.js) stay on a hero between adventures
 * until mended: by potions and spells in the field, or in town for coin.
 *
 *   the inn      a bed for the night, 1 gp: every wound and injury mended (and a fresh start)
 *   the healer   at once, 2 sp per hit point: cheaper for a scratch, dearer for deep wounds
 *
 * So the healer is the better deal below 5 missing hit points (5 x 2 sp = 1 gp), the inn above.
 */
export const INN_COST = 100; // copper pieces: 1 gp
export const HEALER_PER_HP = 20; // 2 sp

export const woundsOf = (d) => Math.max(0, d?.wounds ?? 0);
export const isHurt = (d) => woundsOf(d) > 0 || Object.values(d?.injuries ?? {}).some((v) => v > 0);
export const healCost = (d, kind) => (kind === 'inn' ? INN_COST : Math.max(1, woundsOf(d)) * HEALER_PER_HP);

/** Mend a hero in town. `kind`: 'inn' | 'healer'. Returns { ok, cost, healed, message }. */
export function healInTown(d, kind) {
  if (!isHurt(d)) return { ok: false, message: 'Not a scratch on them.' };
  const cost = healCost(d, kind);
  if ((d.coins ?? 0) < cost) return { ok: false, cost, message: 'Not enough coin.' };
  const healed = woundsOf(d);
  d.coins -= cost; d.wounds = 0; d.injuries = {};
  return { ok: true, cost, healed, message: kind === 'inn' ? 'A soft bed and a hot meal: whole again by morning.' : 'The healer\'s hands are warm; the wounds close.' };
}
