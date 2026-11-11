/**
 * Grid movement (5e rules).
 *
 * A creature's speed in feet becomes a budget of squares: speed / 5 (30 ft = 6 squares).
 * Moving to any of the 8 neighbouring squares costs 1 square, with two diagonal rules:
 *   - 'standard' (5e default): every diagonal costs 1 square, like orthogonal moves.
 *   - 'alternating' (optional 5-10-5 rule): the 1st diagonal costs 1, the 2nd costs 2,
 *     the 3rd costs 1, ... which approximates real distance (a diagonal is ~1.41 long).
 * You can't cut a corner: a diagonal step needs both orthogonal squares beside it to be open.
 *
 * Finding every reachable square is a shortest-path problem on a weighted graph, solved
 * with Dijkstra's algorithm: always expand the cheapest unexplored square next, so the
 * first time a square is settled its cost is the minimum possible.
 */
import { dims } from './size.js';
import { isWalkable } from './dungeon.js';
import { terrainCost } from './terrain.js';

export const DIAGONAL_RULES = {
  standard: { name: 'Standard (every square 5 ft)' },
  alternating: { name: 'Variant 5-10-5 (every 2nd diagonal 10 ft)' },
};

const STEPS = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
  [1, 1], [1, -1], [-1, 1], [-1, -1],
];

export const cellKey = (x, y) => `${x},${y}`;

export function speedToSquares(speedFeet, feetPerCell = 5) {
  return Math.floor(speedFeet / feetPerCell);
}

/** Can a creature step from (x,y) by (dx,dy)? Blocks walls and diagonal corner-cutting. */
export function canStep(map, x, y, dx, dy, blocked, size = 1) {
  const d = dims(size);
  if (d.w > 1 || d.h > 1) {
    // A big creature's whole block (square or rectangle) must fit at the new position.
    for (let oy = 0; oy < d.h; oy++) for (let ox = 0; ox < d.w; ox++) if (!canStep(map, x + ox, y + oy, dx, dy, blocked, 1)) return false;
    return true;
  }
  const nx = x + dx; const ny = y + dy;
  if (!isWalkable(map, nx, ny) || blocked?.has(cellKey(nx, ny))) return false;
  if ((map.terrain || map.props) && terrainCost(map, nx, ny) === Infinity) return false; // deep water
  if (dx !== 0 && dy !== 0) {
    return isWalkable(map, x + dx, y) && isWalkable(map, x, y + dy);
  }
  return true;
}

/**
 * Every square reachable from `start` within `budget` squares.
 * @returns {Map<string, {x, y, cost, path}>} keyed "x,y"; `path` lists squares from start.
 *
 * State = (square, parity of diagonals taken so far). Parity only matters for the
 * alternating rule; under the standard rule it is always 0.
 */
export function reachableSquares(map, start, budget, { diagonalRule = 'standard', blocked = null, size = 1 } = {}) {
  const alternating = diagonalRule === 'alternating';
  const best = new Map(); // stateKey -> cost
  const parent = new Map(); // stateKey -> previous stateKey
  const startKey = `${cellKey(start.x, start.y)},0`;
  best.set(startKey, 0);
  const frontier = [{ x: start.x, y: start.y, parity: 0, cost: 0, key: startKey }];
  const settled = new Set();
  const result = new Map();

  while (frontier.length) {
    // Take the cheapest state. (A linear scan is fast enough for a few hundred squares;
    // a binary heap would make this O(log n) for big maps.)
    let bi = 0;
    for (let i = 1; i < frontier.length; i++) if (frontier[i].cost < frontier[bi].cost) bi = i;
    const cur = frontier.splice(bi, 1)[0];
    if (settled.has(cur.key)) continue;
    settled.add(cur.key);

    const ck = cellKey(cur.x, cur.y);
    if (!result.has(ck) || result.get(ck).cost > cur.cost) {
      result.set(ck, { x: cur.x, y: cur.y, cost: cur.cost, stateKey: cur.key });
    }

    for (const [dx, dy] of STEPS) {
      if (!canStep(map, cur.x, cur.y, dx, dy, blocked, size)) continue;
      const diagonal = dx !== 0 && dy !== 0;
      // Difficult terrain doubles the cost of entering a square.
      const stepCost = (diagonal && alternating && cur.parity === 1 ? 2 : 1) * (map.terrain || map.props || map.temp ? terrainCost(map, cur.x + dx, cur.y + dy) : 1);
      const parity = diagonal && alternating ? 1 - cur.parity : cur.parity;
      const cost = cur.cost + stepCost;
      if (cost > budget) continue;
      const nk = `${cellKey(cur.x + dx, cur.y + dy)},${parity}`;
      if (cost >= (best.get(nk) ?? Infinity)) continue;
      best.set(nk, cost);
      parent.set(nk, cur.key);
      frontier.push({ x: cur.x + dx, y: cur.y + dy, parity, cost, key: nk });
    }
  }

  // Rebuild each square's path by walking parent links back to the start.
  for (const entry of result.values()) {
    const path = [];
    let k = entry.stateKey;
    while (k) {
      const [x, y] = k.split(',').map(Number);
      path.push({ x, y });
      k = parent.get(k);
    }
    entry.path = path.reverse();
    delete entry.stateKey;
  }
  return result;
}

/** Straight-line distance in squares under a diagonal rule, ignoring walls (for ranges). */
export function gridDistance(a, b, diagonalRule = 'standard') {
  const dx = Math.abs(a.x - b.x); const dy = Math.abs(a.y - b.y);
  const diag = Math.min(dx, dy); const straight = Math.max(dx, dy) - diag;
  if (diagonalRule === 'alternating') return straight + diag + Math.floor(diag / 2);
  return straight + diag;
}
