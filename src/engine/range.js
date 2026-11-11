/**
 * Play-scale ranges. The rulebook's ranges are made for open fields: a longbow reaches 600 ft
 * (120 squares), so on our dungeon maps anything in sight would be in range. Here every shot and
 * spell has a reach that fits a room or a cave (1 square = 5 ft):
 *
 *   thrown weapons (javelin, dagger, spear, rock)  normal as listed (at most 8), long at most 2x normal, max 8
 *   bows, crossbows, slings, spell attacks          normal at most 8 squares (40 ft), long at most 16 (80 ft)
 *   spells                                          at most 12 squares (60 ft); touch and self unchanged
 *
 * Beyond normal range a shot has disadvantage; beyond long range it is impossible.
 */
export const RANGE_CAP = { normal: 8, long: 16, thrownLong: 8, spell: 12 };

export function playRange(normal, long, { thrown = false } = {}) {
  if (!normal) return [0, 0];
  const n = Math.min(normal, RANGE_CAP.normal);
  const l = Math.max(n, Math.min(long || n, 2 * n, thrown ? RANGE_CAP.thrownLong : RANGE_CAP.long));
  return [n, l];
}

/** A spell's reach in squares (0 and 1 = self and touch, kept as they are). */
export const spellRange = (r) => (r > 1 ? Math.min(r, RANGE_CAP.spell) : r);

/** Weapons that are thrown and gone (a creature carries only a few); rocks can always be found. */
export const THROWN_NAMES = /javelin|spear|dagger|harpoon|hand ?axe|trident|dart/i;
export const ENDLESS_THROWN = /rock|boulder/i;
export const THROWS_CARRIED = 2;
