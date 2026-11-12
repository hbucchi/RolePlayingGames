/**
 * How many squares a creature fills. 5e: Tiny/Small/Medium take one 5-ft square, Large a 2x2
 * block (10 x 10 ft), Huge 3x3, Gargantuan "20 ft or more". Ours are drawn to awe: a Gargantuan
 * creature fills 8x8 squares, and the greatest of them (ancient dragons, the Tarrasque, the Roc)
 * up to 10x8, next to a hero's single square. A creature's position is the top-left
 * square of its block.
 *
 * Long-bodied creatures (dragons, drakes, wyrms) fill a RECTANGLE instead: a young dragon is
 * 3 x 2, an adult 7 x 5, an ancient 10 x 8. A size is therefore either a number n (an n x n
 * square) or { w, h }. The long side follows the way the creature faces: w > h lies east-west,
 * h > w lies north-south, and it turns when it has room.
 *
 * Distance between two creatures is measured between their nearest squares: for blocks, the gap
 * along x and along y (0 if they overlap on that axis), and the larger of the two gaps.
 */
export const SIZE_SQUARES = { Tiny: 1, Small: 1, Medium: 1, Large: 2, Huge: 3, Gargantuan: 8 };

/** Per-creature exceptions (the Westlands' great fire-demon fills a 2x2 block, by request). */
export const FOOTPRINT_OVERRIDE = {
  'shadowflame-tyrant': 3, // thick body, wings to the sides
  'grey-ice-drake': { w: 4, h: 2 }, // a long, wingless serpent
  'long-worm-of-the-burning-fens': { w: 5, h: 2 },
  // The Gargantuan: up to 10 x 8 squares (50 x 40 ft).
  'dragon-turtle': { w: 10, h: 8 },
  tarrasque: { w: 10, h: 8 },
  roc: { w: 10, h: 8, across: true }, // wings spread across the way it faces
  'purple-worm': { w: 10, h: 5 },
  kraken: 8,
  'war-mammoth-of-the-southern-host': { w: 8, h: 6 },
  // Wings spread: wider than long, so the long side lies ACROSS the way it faces.
  'test-dragon': { w: 5, h: 4, across: true },
};
/** Dragons are long: their body by size category (Medium wyrmlings still fit one square). */
const DRAGON_BODY = { Large: { w: 3, h: 2 }, Huge: { w: 7, h: 5 }, Gargantuan: { w: 10, h: 8 } };
const LONG_BODY = /dragon|drake|wyrm/;

/** Width and height of a size (a number means a square). */
export const dims = (n = 1) => (typeof n === 'number' ? { w: n, h: n } : n);
export const isSquare = (n) => { const d = dims(n); return d.w === d.h; };
/** The longer side, in squares. */
export const spanOf = (n) => { const d = dims(n); return Math.max(d.w, d.h); };
/** The same block turned a quarter: 3 x 2 becomes 2 x 3. */
export const rotated = (n) => { const d = dims(n); return d.w === d.h ? n : { ...d, w: d.h, h: d.w }; };

export function footprintOf(stat) {
  if (!stat) return 1;
  if (FOOTPRINT_OVERRIDE[stat.id]) return FOOTPRINT_OVERRIDE[stat.id];
  if ((stat.type === 'dragon' || LONG_BODY.test(stat.id)) && DRAGON_BODY[stat.size]) return DRAGON_BODY[stat.size];
  return SIZE_SQUARES[stat.size] ?? 1;
}

/** A footprint turned to match a facing (0 = north ... 2 = east ... 4 = south ... 6 = west). */
export function orientFor(n, facing = 4) {
  const d = dims(n); if (d.w === d.h) return n;
  let eastWest = facing === 2 || facing === 6; // diagonals and north/south: lie north-south
  if (d.across) eastWest = !eastWest; // spread wings lie across the facing
  const long = Math.max(d.w, d.h); const short = Math.min(d.w, d.h);
  return eastWest ? { ...d, w: long, h: short } : { ...d, w: short, h: long };
}

/** Text for a size: "3x2 squares". */
export const sizeLabel = (n) => { const d = dims(n); return `${d.w}×${d.h}`; };

/** All squares a creature at `pos` with block size `n` covers. */
export function cellsOf(pos, n = 1) {
  const { w, h } = dims(n); const out = [];
  for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) out.push({ x: pos.x + dx, y: pos.y + dy });
  return out;
}

/** Chebyshev distance between two blocks (in squares). */
export function blockDistance(a, an, b, bn) {
  const A = dims(an); const B = dims(bn);
  const gx = Math.max(0, a.x - (b.x + B.w - 1), b.x - (a.x + A.w - 1));
  const gy = Math.max(0, a.y - (b.y + B.h - 1), b.y - (a.y + A.h - 1));
  return Math.max(gx, gy);
}

/** Centre of a block, in square units (for drawing and aiming). */
export const centerOf = (pos, n = 1) => { const { w, h } = dims(n); return { x: pos.x + w / 2 - 0.5, y: pos.y + h / 2 - 0.5 }; };
