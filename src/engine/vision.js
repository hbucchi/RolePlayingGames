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

// ---------------------------------------------------------------------------
// Cover for shots and spells (5e Dungeon Master's Guide): pick the corner of the attacker's
// square with the best view and draw lines to the 4 corners of the target's square. Count the
// lines a wall blocks: 0 = no cover, 1-2 = half cover (+2 AC), 3 = three-quarters (+5 AC),
// 4 = total cover (no shot). Slipping diagonally between two walls that meet at a corner blocks.
// Corners are pulled in a little so a line grazing a wall's edge does not count as passing it.
// ---------------------------------------------------------------------------
const INSET = 0.04;
const CORNERS = [[INSET, INSET], [1 - INSET, INSET], [INSET, 1 - INSET], [1 - INSET, 1 - INSET]];

/** Does a straight line between two points cross a wall? (cells in `own` never block) */
export function lineBlocked(x0, y0, x1, y1, opaque, own) {
  const steps = Math.max(2, Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 20));
  let px = Math.floor(x0); let py = Math.floor(y0);
  for (let i = 1; i <= steps; i++) {
    const cx = Math.floor(x0 + ((x1 - x0) * i) / steps); const cy = Math.floor(y0 + ((y1 - y0) * i) / steps);
    if (cx === px && cy === py) continue;
    if (cx !== px && cy !== py && opaque(cx, py) && opaque(px, cy)) return true; // squeezing between two walls
    if (!own.has(cellKey(cx, cy)) && opaque(cx, cy)) return true;
    px = cx; py = cy;
  }
  return false;
}

/** How many of the 4 target corners a wall hides, from the attacker's best corner (0-4). */
export function cornersBlocked(a, b, opaque, own = new Set([cellKey(a.x, a.y), cellKey(b.x, b.y)])) {
  let best = 4;
  for (const [ax, ay] of CORNERS) {
    let blocked = 0;
    for (const [bx, by] of CORNERS) if (lineBlocked(a.x + ax, a.y + ay, b.x + bx, b.y + by, opaque, own)) blocked++;
    best = Math.min(best, blocked);
    if (!best) break;
  }
  return best;
}

/**
 * Does the straight line between two square centres scrape past a wall corner (cross diagonally
 * where one of the two side squares is a wall) or run through one? Then the target is partly
 * behind that corner: at least half cover, even if a lean from the best corner would show it all.
 */
export function centreGrazes(a, b, opaque, own) {
  const x0 = a.x + 0.5; const y0 = a.y + 0.5; const x1 = b.x + 0.5; const y1 = b.y + 0.5;
  const steps = Math.max(2, Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 40));
  let px = a.x; let py = a.y;
  for (let i = 1; i <= steps; i++) {
    const cx = Math.floor(x0 + ((x1 - x0) * i) / steps + 1e-9); const cy = Math.floor(y0 + ((y1 - y0) * i) / steps + 1e-9);
    if (cx === px && cy === py) continue;
    if (!own.has(cellKey(cx, cy)) && opaque(cx, cy)) return true;
    if (cx !== px && cy !== py && (opaque(cx, py) || opaque(px, cy))) return true;
    px = cx; py = cy;
  }
  return false;
}

export const COVER_AC = { none: 0, half: 2, 'three-quarters': 5, total: Infinity };
const COVER_OF = ['none', 'half', 'half', 'three-quarters', 'total'];

/**
 * Cover between two creatures of any size: the best pair of squares counts. A creature standing
 * on the line between them also gives half cover (`occupied`: cells of others).
 */
export function rangedCover(aCells, bCells, opaque, occupied = new Set()) {
  const own = new Set([...aCells, ...bCells].map((c) => cellKey(c.x, c.y)));
  let best = 'total'; let pair = null;
  const rank = (c) => COVER_OF.indexOf(c);
  for (const a of aCells) {
    for (const b of bCells) {
      let c = COVER_OF[cornersBlocked(a, b, opaque, own)];
      if (c === 'none' && centreGrazes(a, b, opaque, own)) c = 'half';
      if (rank(c) < rank(best)) { best = c; pair = [a, b]; }
      if (best === 'none') break;
    }
    if (best === 'none') break;
  }
  if (best === 'none' && pair && coverBetween(pair[0], pair[1], () => false, occupied) === 'half') best = 'half';
  return best;
}

/**
 * Field of view: a creature sees what lies in front of it and to its sides, not behind it.
 * Facing f (0 = north, clockwise in 45-degree steps) points along the unit vector u. A square at
 * offset v is in view when the angle between u and v is at most FOV_HALF, i.e. when
 * cos(angle) = (u . v) / |v| >= cos(FOV_HALF). With FOV_HALF = 112.5 degrees the blind wedge is the
 * 135 degrees straight behind: the same three rear directions that give attackers advantage.
 * Squares right next to you are always sensed (you hear and feel them).
 */
export const FOV_HALF = 112.5;
const FACE_VEC = [[0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1]];
const COS_HALF = Math.cos((FOV_HALF * Math.PI) / 180);
export function inFieldOfView(from, facing, cell) {
  const vx = cell.x - from.x; const vy = cell.y - from.y;
  if (Math.max(Math.abs(vx), Math.abs(vy)) <= 1) return true;
  const [fx, fy] = FACE_VEC[((facing ?? 4) % 8 + 8) % 8];
  const dot = (fx * vx + fy * vy) / Math.hypot(fx, fy);
  return dot / Math.hypot(vx, vy) >= COS_HALF - 1e-9;
}
