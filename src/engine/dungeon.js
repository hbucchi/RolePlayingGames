/**
 * Procedural dungeon generator.
 *
 * The dungeon is a grid of square cells (default 32 x 32, one cell = 5 ft, drawn at 64 px
 * so the board is 2048 x 2048). The grid is the single source of truth: artwork is painted
 * on top of it, so walls and doors always sit exactly on cell boundaries.
 *
 * Algorithm
 *  1. Place rectangular rooms of mixed sizes (large first) at random, rejecting overlaps.
 *     Each room keeps a one-cell "wall ring" around it plus a free lane for corridors.
 *  2. Build a minimum spanning tree (MST) over the room centres so every room is reachable
 *     with the shortest total corridor length, then add a few extra links to create loops.
 *  3. For each link, pick a door on the facing walls of both rooms and dig a corridor
 *     between them with A* search, which avoids rooms and prefers reusing corridors.
 *  4. Verify everything is connected (flood fill); if not, try again with the next seed.
 */
import { seededRng } from './dice.js';

export const TILE = Object.freeze({ ROCK: 0, ROOM: 1, CORRIDOR: 2, DOOR: 3 });

export const DUNGEON_DEFAULTS = Object.freeze({
  width: 32,
  height: 32,
  cellSize: 64, // pixels per cell on the 2048 px board
  feetPerCell: 5, // 5e: one square = 5 feet
  // How many rooms of each size class to try to place (largest first).
  roomPlan: [
    { size: 'large', count: 2, min: 7, max: 9 },
    { size: 'medium', count: 6, min: 5, max: 6 },
    { size: 'small', count: 10, min: 3, max: 4 },
  ],
  // After the plan, keep packing small rooms into leftover space (up to this many in total).
  maxRooms: 20,
  extraLinkChance: 0.35,
  maxAttempts: 25,
});

const ROOM_NAMES = {
  large: ['Great Hall', 'Pillared Hall', 'Hall of Kings', 'Feast Hall', 'Throne Hall'],
  medium: ['Guardroom', 'Armoury', 'Chapel', 'Library', 'Crypt', 'Forge', 'Barracks', 'Cistern', 'Gallery', 'Shrine'],
  small: ['Cell', 'Storeroom', 'Alcove', 'Vault', 'Closet', 'Ossuary', 'Pantry', 'Well Room', 'Study', 'Niche', 'Larder', 'Watch Post'],
};

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

const randInt = (rng, min, max) => min + rng(max - min + 1); // inclusive
const key = (x, y) => `${x},${y}`;
const center = (r) => ({ x: r.x + (r.w - 1) / 2, y: r.y + (r.h - 1) / 2 });
const inRect = (r, x, y) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
const inRing = (r, x, y) => x >= r.x - 1 && x <= r.x + r.w && y >= r.y - 1 && y <= r.y + r.h && !inRect(r, x, y);

function shuffle(rng, arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = rng(i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// ---------------------------------------------------------------------------
// 1. Room placement
// ---------------------------------------------------------------------------

/**
 * Spacing between two room interiors along x and y: how many cells lie between them
 * (negative when their projections overlap on that axis).
 */
function spacing(a, b) {
  return {
    dx: Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w)),
    dy: Math.max(b.y - (a.y + a.h), a.y - (b.y + b.h)),
  };
}

/** How many cells two rooms' sides run alongside each other (projection overlap). */
const sharedLength = (a0, a1, b0, b1) => Math.min(a1, b1) - Math.max(a0, b0);

/**
 * If two rooms are separated by exactly one wall along a run of at least 2 cells, they
 * share that wall and can be joined by a door straight through it.
 * Returns the wall cells that could hold a door, or null.
 */
export function sharedWall(a, b) {
  const { dx, dy } = spacing(a, b);
  if (dx === 1 && dy < 0 && sharedLength(a.y, a.y + a.h, b.y, b.y + b.h) >= 2) {
    const x = a.x < b.x ? a.x + a.w : b.x + b.w;
    const y0 = Math.max(a.y, b.y); const y1 = Math.min(a.y + a.h, b.y + b.h);
    return { orientation: 'h', cells: Array.from({ length: y1 - y0 }, (_, i) => ({ x, y: y0 + i })) };
  }
  if (dy === 1 && dx < 0 && sharedLength(a.x, a.x + a.w, b.x, b.x + b.w) >= 2) {
    const y = a.y < b.y ? a.y + a.h : b.y + b.h;
    const x0 = Math.max(a.x, b.x); const x1 = Math.min(a.x + a.w, b.x + b.w);
    return { orientation: 'v', cells: Array.from({ length: x1 - x0 }, (_, i) => ({ x: x0 + i, y })) };
  }
  return null;
}

/**
 * Rooms may either share exactly one wall (a run of at least 2 cells), or stand at least
 * 2 cells apart. Anything else (overlapping, touching corners) is rejected.
 */
function overlaps(a, b) {
  const { dx, dy } = spacing(a, b);
  if (Math.max(dx, dy) >= 2) return false;
  return !sharedWall(a, b);
}

function placeRooms(rng, cfg) {
  const rooms = [];
  const usedNames = new Set();
  for (const cls of cfg.roomPlan) {
    for (let n = 0; n < cls.count; n++) {
      for (let attempt = 0; attempt < 200; attempt++) {
        const w = randInt(rng, cls.min, cls.max);
        const h = randInt(rng, Math.max(3, cls.min - 1), cls.max);
        // Interior starts at 2 so the wall ring (1) and map edge (0) stay rock.
        const x = randInt(rng, 2, cfg.width - 2 - w);
        const y = randInt(rng, 2, cfg.height - 2 - h);
        const room = { x, y, w, h };
        if (rooms.some((r) => overlaps(r, room))) continue;
        const pool = ROOM_NAMES[cls.size].filter((nm) => !usedNames.has(nm));
        const name = pool.length ? pool[rng(pool.length)] : ROOM_NAMES[cls.size][rng(ROOM_NAMES[cls.size].length)];
        usedNames.add(name);
        rooms.push({ ...room, size: cls.size, name, doors: [] });
        break;
      }
    }
  }
  // Fill pass: a systematic scan finds gaps random throws miss.
  const fill = [];
  for (let y = 2; y < cfg.height - 4; y++) for (let x = 2; x < cfg.width - 4; x++) fill.push({ x, y });
  for (const p of shuffle(rng, fill)) {
    if (rooms.length >= cfg.maxRooms) break;
    const w = randInt(rng, 3, 4); const h = randInt(rng, 3, 4);
    const room = { x: p.x, y: p.y, w, h };
    if (room.x + w > cfg.width - 2 || room.y + h > cfg.height - 2) continue;
    if (rooms.some((r) => overlaps(r, room))) continue;
    const pool = ROOM_NAMES.small.filter((nm) => !usedNames.has(nm));
    const name = pool.length ? pool[rng(pool.length)] : 'Cell';
    usedNames.add(name);
    rooms.push({ ...room, size: 'small', name, doors: [] });
  }
  // Number rooms top-to-bottom, left-to-right, like a printed adventure map.
  rooms.sort((a, b) => a.y - b.y || a.x - b.x);
  rooms.forEach((r, i) => { r.id = i + 1; });
  return rooms;
}

// ---------------------------------------------------------------------------
// 2. Which rooms to link: minimum spanning tree + a few loops
// ---------------------------------------------------------------------------

function roomDistance(a, b) {
  const ca = center(a); const cb = center(b);
  return Math.hypot(ca.x - cb.x, ca.y - cb.y);
}

/**
 * Prim's algorithm: start from one room, repeatedly add the cheapest edge that reaches a
 * room not yet in the tree. Result: n-1 edges connecting all n rooms with minimal total length.
 */
export function minimumSpanningTree(rooms) {
  if (rooms.length < 2) return [];
  const inTree = new Set([0]);
  const edges = [];
  while (inTree.size < rooms.length) {
    let best = null;
    for (const i of inTree) {
      for (let j = 0; j < rooms.length; j++) {
        if (inTree.has(j)) continue;
        const d = roomDistance(rooms[i], rooms[j]);
        if (!best || d < best.d) best = { a: i, b: j, d };
      }
    }
    inTree.add(best.b);
    edges.push(best);
  }
  return edges;
}

function chooseLinks(rng, rooms, cfg) {
  const mst = minimumSpanningTree(rooms);
  const linked = new Set(mst.map((e) => key(Math.min(e.a, e.b), Math.max(e.a, e.b))));
  const extras = [];
  for (let i = 0; i < rooms.length; i++) {
    // Each room considers a loop link to its nearest unlinked neighbour.
    const candidates = rooms.map((r, j) => ({ j, d: roomDistance(rooms[i], r) }))
      .filter(({ j }) => j !== i && !linked.has(key(Math.min(i, j), Math.max(i, j))))
      .sort((p, q) => p.d - q.d);
    const c = candidates[0];
    if (c && c.d < 14 && rng(1000) / 1000 < cfg.extraLinkChance) {
      linked.add(key(Math.min(i, c.j), Math.max(i, c.j)));
      extras.push({ a: i, b: c.j, d: c.d });
    }
  }
  return { mst, extras };
}

// ---------------------------------------------------------------------------
// 3. Doors and corridors
// ---------------------------------------------------------------------------

const SIDES = {
  N: { dx: 0, dy: -1 }, S: { dx: 0, dy: 1 }, W: { dx: -1, dy: 0 }, E: { dx: 1, dy: 0 },
};

/** Sides of room `a` ordered by how directly they face room `b`. */
function facingSides(a, b) {
  const ca = center(a); const cb = center(b);
  const dx = cb.x - ca.x; const dy = cb.y - ca.y;
  const horiz = dx >= 0 ? 'E' : 'W';
  const vert = dy >= 0 ? 'S' : 'N';
  const primary = Math.abs(dx) >= Math.abs(dy) ? [horiz, vert] : [vert, horiz];
  const rest = ['N', 'S', 'E', 'W'].filter((s) => !primary.includes(s));
  return [...primary, ...rest];
}

/** Door positions along one side of a room: the wall-ring cell plus the corridor cell just outside it. */
function doorCandidates(room, side, target) {
  const tc = center(target);
  const cells = [];
  if (side === 'N' || side === 'S') {
    const y = side === 'N' ? room.y - 1 : room.y + room.h;
    for (let x = room.x; x < room.x + room.w; x++) cells.push({ x, y });
    cells.sort((p, q) => Math.abs(p.x - tc.x) - Math.abs(q.x - tc.x));
  } else {
    const x = side === 'W' ? room.x - 1 : room.x + room.w;
    for (let y = room.y; y < room.y + room.h; y++) cells.push({ x, y });
    cells.sort((p, q) => Math.abs(p.y - tc.y) - Math.abs(q.y - tc.y));
  }
  const { dx, dy } = SIDES[side];
  return cells.map((d) => ({ door: d, out: { x: d.x + dx, y: d.y + dy }, side }));
}

/**
 * A* search for a 4-directional corridor. Cost: 1 per new cell, 0.4 for reusing an existing
 * corridor (so corridors merge into a network), +0.6 per turn (so corridors stay straight).
 * The heuristic is Manhattan distance, which never overestimates, so A* finds the cheapest path.
 */
function digPath(grid, blocked, from, to, W, H) {
  const startKey = key(from.x, from.y);
  const open = [{ x: from.x, y: from.y, dir: -1, g: 0, f: 0 }];
  const best = new Map([[`${startKey},-1`, 0]]);
  const parent = new Map();
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  while (open.length) {
    // Pop the node with the lowest f = g + h (a linear scan is fine for 32x32).
    let bi = 0;
    for (let i = 1; i < open.length; i++) if (open[i].f < open[bi].f) bi = i;
    const cur = open.splice(bi, 1)[0];
    if (cur.x === to.x && cur.y === to.y) {
      const path = [];
      let k = `${key(cur.x, cur.y)},${cur.dir}`;
      while (k) { const [x, y] = k.split(',').map(Number); path.push({ x, y }); k = parent.get(k); }
      return path.reverse();
    }
    const curKey = `${key(cur.x, cur.y)},${cur.dir}`;
    if (cur.g > (best.get(curKey) ?? Infinity)) continue;
    dirs.forEach(([dx, dy], dir) => {
      const nx = cur.x + dx; const ny = cur.y + dy;
      if (nx < 1 || ny < 1 || nx > W - 2 || ny > H - 2) return;
      if (blocked[ny][nx]) return;
      const step = grid[ny][nx] === TILE.CORRIDOR ? 0.4 : 1;
      const turn = cur.dir !== -1 && cur.dir !== dir ? 0.6 : 0;
      const g = cur.g + step + turn;
      const nk = `${key(nx, ny)},${dir}`;
      if (g >= (best.get(nk) ?? Infinity)) return;
      best.set(nk, g);
      parent.set(nk, curKey);
      open.push({ x: nx, y: ny, dir, g, f: g + Math.abs(nx - to.x) + Math.abs(ny - to.y) });
    });
  }
  return null;
}

function connectRooms(grid, blocked, rooms, a, b, W, H) {
  const wall = sharedWall(a, b);
  if (wall) {
    const mid = wall.cells[Math.floor((wall.cells.length - 1) / 2)];
    grid[mid.y][mid.x] = TILE.DOOR;
    const sideA = wall.orientation === 'h' ? (a.x < b.x ? 'E' : 'W') : (a.y < b.y ? 'S' : 'N');
    const opposite = { N: 'S', S: 'N', E: 'W', W: 'E' };
    a.doors.push({ x: mid.x, y: mid.y, side: sideA });
    b.doors.push({ x: mid.x, y: mid.y, side: opposite[sideA] });
    return true;
  }
  for (const sa of facingSides(a, b).slice(0, 3)) {
    for (const sb of facingSides(b, a).slice(0, 3)) {
      const ca = doorCandidates(a, sa, b).filter((c) => okDoor(c, blocked, a, W, H)).slice(0, 3);
      const cb = doorCandidates(b, sb, a).filter((c) => okDoor(c, blocked, b, W, H)).slice(0, 3);
      for (const da of ca) {
        for (const db of cb) {
          const path = digPath(grid, blocked, da.out, db.out, W, H);
          if (!path) continue;
          for (const p of path) if (grid[p.y][p.x] === TILE.ROCK) grid[p.y][p.x] = TILE.CORRIDOR;
          addDoor(grid, a, da);
          addDoor(grid, b, db);
          return true;
        }
      }
    }
  }
  return false;
}

function okDoor(c, blocked, room, W, H) {
  const { door, out } = c;
  if (out.x < 1 || out.y < 1 || out.x > W - 2 || out.y > H - 2) return false;
  if (blocked[out.y][out.x]) return false;
  // Never put two doors side by side on the same wall: reuse instead (handled by addDoor).
  return !room.doors.some((d) => Math.abs(d.x - door.x) + Math.abs(d.y - door.y) === 1);
}

function addDoor(grid, room, c) {
  grid[c.door.y][c.door.x] = TILE.DOOR;
  if (!room.doors.some((d) => d.x === c.door.x && d.y === c.door.y)) {
    room.doors.push({ x: c.door.x, y: c.door.y, side: c.side });
  }
}

// ---------------------------------------------------------------------------
// 4. Validation helpers
// ---------------------------------------------------------------------------

export const isWalkable = (map, x, y) => x >= 0 && y >= 0 && x < map.width && y < map.height && map.tiles[y][x] !== TILE.ROCK;

/** Flood fill from a cell; returns the set of reachable walkable cells. */
export function floodFill(map, start) {
  const seen = new Set([key(start.x, start.y)]);
  const stack = [start];
  while (stack.length) {
    const { x, y } = stack.pop();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx; const ny = y + dy;
      const k = key(nx, ny);
      if (!seen.has(k) && isWalkable(map, nx, ny)) { seen.add(k); stack.push({ x: nx, y: ny }); }
    }
  }
  return seen;
}

export function walkableCount(map) {
  return map.tiles.reduce((n, row) => n + row.filter((t) => t !== TILE.ROCK).length, 0);
}

/** Which room (if any) contains a cell. */
export function roomAt(map, x, y) {
  return map.rooms.find((r) => inRect(r, x, y)) ?? null;
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Generate a dungeon. Same seed + same options => identical dungeon, so a map can be
 * shared or saved as just its seed.
 */
export function generateDungeon(seed = 1, options = {}) {
  const cfg = { ...DUNGEON_DEFAULTS, ...options };
  for (let attempt = 0; attempt < cfg.maxAttempts; attempt++) {
    const map = tryGenerate((seed >>> 0) + attempt * 7919, cfg);
    if (map) return { ...map, seed, attempt };
  }
  throw new Error(`Could not generate a connected dungeon for seed ${seed}`);
}

function tryGenerate(seed, cfg) {
  const rng = seededRng(seed);
  const W = cfg.width; const H = cfg.height;
  const rooms = placeRooms(rng, cfg);
  if (rooms.length < 6) return null;

  const grid = Array.from({ length: H }, () => Array(W).fill(TILE.ROCK));
  const blocked = Array.from({ length: H }, () => Array(W).fill(false));
  for (const r of rooms) {
    for (let y = r.y - 1; y <= r.y + r.h; y++) {
      for (let x = r.x - 1; x <= r.x + r.w; x++) {
        blocked[y][x] = true; // room interiors and their wall rings are off-limits to corridors
        if (inRect(r, x, y)) grid[y][x] = TILE.ROOM;
      }
    }
  }

  const { mst, extras } = chooseLinks(rng, rooms, cfg);
  for (const e of mst) {
    if (!connectRooms(grid, blocked, rooms, rooms[e.a], rooms[e.b], W, H)) {
      // Try linking the stranded room to any other room instead.
      const others = rooms.map((r, i) => i).filter((i) => i !== e.b)
        .sort((i, j) => roomDistance(rooms[e.b], rooms[i]) - roomDistance(rooms[e.b], rooms[j]));
      if (!others.some((i) => connectRooms(grid, blocked, rooms, rooms[e.b], rooms[i], W, H))) return null;
    }
  }
  for (const e of shuffle(rng, extras)) connectRooms(grid, blocked, rooms, rooms[e.a], rooms[e.b], W, H);

  const map = {
    version: 1,
    width: W,
    height: H,
    cellSize: cfg.cellSize,
    feetPerCell: cfg.feetPerCell,
    tiles: grid,
    rooms,
    doors: [],
    entrance: null,
  };

  // Each door records its orientation: 'h' if you walk through it east-west, 'v' north-south.
  for (const r of rooms) {
    for (const d of r.doors) {
      const existing = map.doors.find((x) => x.x === d.x && x.y === d.y);
      if (existing) { existing.rooms.push(r.id); continue; }
      map.doors.push({ x: d.x, y: d.y, orientation: d.side === 'E' || d.side === 'W' ? 'h' : 'v', rooms: [r.id] });
    }
  }

  // Entrance: the small or medium room closest to the bottom edge gets the stairs down from the surface.
  const entranceRoom = [...rooms].filter((r) => r.size !== 'large')
    .sort((a, b) => (b.y + b.h) - (a.y + a.h))[0] ?? rooms[0];
  entranceRoom.entrance = true;
  map.entrance = { roomId: entranceRoom.id, x: entranceRoom.x + Math.floor(entranceRoom.w / 2), y: entranceRoom.y + entranceRoom.h - 1 };

  // Everything must be reachable from the entrance.
  if (floodFill(map, map.entrance).size !== walkableCount(map)) return null;
  return map;
}
