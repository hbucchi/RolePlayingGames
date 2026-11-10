/**
 * How many squares a creature fills. 5e: Tiny/Small/Medium take one 5-ft square, Large a 2x2
 * block (10 x 10 ft), Huge 3x3, Gargantuan 4x4 or more. A creature's position is the top-left
 * square of its block.
 *
 * Distance between two creatures is measured between their nearest squares: for blocks, the gap
 * along x and along y (0 if they overlap on that axis), and the larger of the two gaps.
 */
export const SIZE_SQUARES = { Tiny: 1, Small: 1, Medium: 1, Large: 2, Huge: 3, Gargantuan: 4 };

/** Per-creature exceptions (the Westlands' great fire-demon fills a 2x2 block, by request). */
export const FOOTPRINT_OVERRIDE = { 'shadowflame-tyrant': 2 };

export const footprintOf = (stat) => FOOTPRINT_OVERRIDE[stat?.id] ?? SIZE_SQUARES[stat?.size] ?? 1;

/** All squares a creature at `pos` with block size `n` covers. */
export function cellsOf(pos, n = 1) {
  const out = [];
  for (let dy = 0; dy < n; dy++) for (let dx = 0; dx < n; dx++) out.push({ x: pos.x + dx, y: pos.y + dy });
  return out;
}

/** Chebyshev distance between two blocks (in squares). */
export function blockDistance(a, an, b, bn) {
  const gx = Math.max(0, a.x - (b.x + bn - 1), b.x - (a.x + an - 1));
  const gy = Math.max(0, a.y - (b.y + bn - 1), b.y - (a.y + an - 1));
  return Math.max(gx, gy);
}

/** Centre of a block, in square units (for drawing and aiming). */
export const centerOf = (pos, n = 1) => ({ x: pos.x + n / 2 - 0.5, y: pos.y + n / 2 - 0.5 });
