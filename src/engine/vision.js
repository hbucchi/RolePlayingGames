/**
 * Line of sight and fog of war on the square grid.
 *
 * A square B is visible from square A if a straight segment from the CENTRE of A reaches
 * any of five sample points in B (its centre, or a point near each of its corners) without
 * passing through an opaque square. Opaque = solid rock or a closed door.
 *
 * The segment is walked in small steps. Whenever it crosses from one square into a
 * diagonal neighbour (exactly through a corner), we also test the two squares that share
 * that corner: if BOTH are opaque the corner is "pinched" and sight can't squeeze through.
 *
 * Cover for ranged attacks follows from the same test: if the target's centre is hidden
 * but part of its square is visible, it has half cover (+2 AC).
 */
import { TILE } from './dungeon.js';

export const cellKey = (x, y) => `${x},${y}`;

/** Points inside a square that we try to see: centre first, then four inset corners. */
const SAMPLE_POINTS = [[0.5, 0.5], [0.15, 0.15], [0.85, 0.15], [0.15, 0.85], [0.85, 0.85]];

export function makeOpacity(map, doorState) {
  return (x, y) => {
    if (x < 0 || y < 0 || x >= map.width || y >= map.height) return true;
    const t = map.tiles[y][x];
    if (t === TILE.ROCK) return true;
    if (t === TILE.DOOR) return !doorState?.get(cellKey(x, y));
    return false;
  };
}

/**
 * Is the straight segment from (x0,y0) to (x1,y1) (in square units) clear?
 * Squares at the two ends are not tested (you can see a wall, and see out of a doorway).
 */
export function segmentClear(x0, y0, x1, y1, opaque, start, end) {
  const len = Math.hypot(x1 - x0, y1 - y0);
  const steps = Math.max(1, Math.ceil(len * 8));
  let px = start.x; let py = start.y;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const cx = Math.floor(x0 + (x1 - x0) * t);
    const cy = Math.floor(y0 + (y1 - y0) * t);
    if (cx === px && cy === py) continue;
    // Diagonal step: blocked if both orthogonal neighbours are opaque (a pinched corner).
    if (cx !== px && cy !== py && opaque(cx, py) && opaque(px, cy)) return false;
    px = cx; py = cy;
    if (cx === end.x && cy === end.y) return true;
    if (opaque(cx, cy)) return false;
  }
  return true;
}

/**
 * Line of sight from square a to square b.
 * @returns {{visible: boolean, centre: boolean}} centre = the target's centre is in view.
 */
export function lineOfSight(a, b, opaque) {
  if (a.x === b.x && a.y === b.y) return { visible: true, centre: true };
  const ox = a.x + 0.5; const oy = a.y + 0.5;
  let visible = false;
  let centre = false;
  for (let i = 0; i < SAMPLE_POINTS.length; i++) {
    const [sx, sy] = SAMPLE_POINTS[i];
    if (segmentClear(ox, oy, b.x + sx, b.y + sy, opaque, a, b)) {
      visible = true;
      if (i === 0) centre = true;
      break;
    }
  }
  return { visible, centre };
}

/** Every square visible from `from`, up to `range` squares away (default: whole map). */
export function visibleSquares(map, from, opaque, range = Infinity) {
  const seen = new Set();
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      if (Math.max(Math.abs(x - from.x), Math.abs(y - from.y)) > range) continue;
      // Interior rock (no open neighbour) can never be seen; skip it to save work.
      if (map.tiles[y][x] === TILE.ROCK && !touchesOpen(map, x, y)) continue;
      if (lineOfSight(from, { x, y }, opaque).visible) seen.add(cellKey(x, y));
    }
  }
  return seen;
}

function touchesOpen(map, x, y) {
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx; const ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < map.width && ny < map.height && map.tiles[ny][nx] !== TILE.ROCK) return true;
    }
  }
  return false;
}

/**
 * Hero-Quest-style reveal: corridors are revealed square by square as they come into view,
 * but the moment any floor square of a room is seen, the whole room (and its walls and
 * doorways) is revealed.
 */
export function revealFrom(map, visible, revealed) {
  for (const k of visible) revealed.add(k);
  for (const r of map.rooms) {
    let seenRoom = false;
    for (let y = r.y; y < r.y + r.h && !seenRoom; y++) {
      for (let x = r.x; x < r.x + r.w; x++) if (visible.has(cellKey(x, y))) { seenRoom = true; break; }
    }
    if (!seenRoom) continue;
    for (let y = r.y - 1; y <= r.y + r.h; y++) {
      for (let x = r.x - 1; x <= r.x + r.w; x++) revealed.add(cellKey(x, y));
    }
  }
  return revealed;
}

/**
 * Cover for a ranged attack from a to b.
 *   none  - the target's centre is visible and no creature stands in the way
 *   half  - only part of the target's square is visible, or a creature is in the way (+2 AC)
 *   total - no line of sight at all
 */
export function coverBetween(a, b, opaque, occupied = new Set()) {
  const los = lineOfSight(a, b, opaque);
  if (!los.visible) return 'total';
  if (!los.centre) return 'half';
  // A creature standing on the line between attacker and target gives half cover.
  const ox = a.x + 0.5; const oy = a.y + 0.5; const tx = b.x + 0.5; const ty = b.y + 0.5;
  const steps = Math.ceil(Math.hypot(tx - ox, ty - oy) * 8);
  for (let i = 1; i < steps; i++) {
    const cx = Math.floor(ox + (tx - ox) * (i / steps));
    const cy = Math.floor(oy + (ty - oy) * (i / steps));
    if ((cx !== a.x || cy !== a.y) && (cx !== b.x || cy !== b.y) && occupied.has(cellKey(cx, cy))) return 'half';
  }
  return 'none';
}
