/**
 * Reach: how many squares (tiles) a weapon or spell can carry. 1 square = 5 ft.
 *
 * The rulebook's ranges are made for open fields: a longbow's 150/600 ft would cross any of our
 * maps. Here every shot and spell has ONE reach, a hard limit: a bow with reach 8 can hit a foe
 * 8 squares away, and cannot hit one 10 squares away. Inside its reach the shot is normal.
 *
 *   bows, crossbows, slings  half the rulebook's normal range, between 4 and 12 squares
 *                            (shortbow 8, light crossbow 8, heavy crossbow 10, longbow 12, sling 4)
 *   thrown weapons           the rulebook's normal range, at most 8 (dagger 4, javelin 6, rock 8)
 *   spells                   the rulebook's range, at most 12 squares (60 ft); touch and self unchanged
 */
export const RANGE_CAP = { launcher: 12, launcherMin: 4, thrown: 8, spell: 12 };

/** A weapon's reach in squares, from its rulebook normal range (squares). */
export function reachFor(normal, { thrown = false } = {}) {
  if (!normal) return 0;
  if (thrown) return Math.min(Math.round(normal), RANGE_CAP.thrown);
  return Math.max(RANGE_CAP.launcherMin, Math.min(RANGE_CAP.launcher, Math.round(normal / 2)));
}

/**
 * [normal, long] for the rest of the engine: both are the reach (no "long range" band any more).
 * Kept as a pair so older code that reads weapon.normal and weapon.long still works.
 */
export function playRange(normal, _long, opts = {}) {
  const r = reachFor(normal, opts);
  return [r, r];
}

/** A spell's reach in squares (0 and 1 = self and touch, kept as they are). */
export const spellRange = (r) => (r > 1 ? Math.min(r, RANGE_CAP.spell) : r);

/** Weapons that are thrown and gone (a creature carries only a few); rocks can always be found. */
export const THROWN_NAMES = /javelin|spear|dagger|harpoon|hand ?axe|trident|dart/i;
export const ENDLESS_THROWN = /rock|boulder/i;
export const THROWS_CARRIED = 2;
