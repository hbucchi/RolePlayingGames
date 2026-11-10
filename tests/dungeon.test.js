import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateDungeon, TILE, floodFill, walkableCount, isWalkable, roomAt, minimumSpanningTree, sharedWall } from '../src/engine/dungeon.js';
import { reachableSquares, gridDistance, speedToSquares, canStep } from '../src/engine/movement.js';
import { renderDungeonSVG } from '../src/engine/dungeon-render.js';

const SEEDS = Array.from({ length: 40 }, (_, i) => i + 1);

test('same seed gives the same dungeon', () => {
  assert.deepEqual(generateDungeon(42).tiles, generateDungeon(42).tiles);
  assert.notDeepEqual(generateDungeon(42).tiles, generateDungeon(43).tiles);
});

test('board is 2048 x 2048 pixels on a 32 x 32 grid of 5 ft squares', () => {
  const m = generateDungeon(1);
  assert.equal(m.width * m.cellSize, 2048);
  assert.equal(m.height * m.cellSize, 2048);
  assert.equal(m.width, 32);
  assert.equal(m.feetPerCell, 5);
});

test('every dungeon is fully connected from the entrance', () => {
  for (const seed of SEEDS) {
    const m = generateDungeon(seed);
    assert.equal(floodFill(m, m.entrance).size, walkableCount(m), `seed ${seed}`);
    assert.ok(roomAt(m, m.entrance.x, m.entrance.y), `entrance inside a room, seed ${seed}`);
  }
});

test('dungeons have many rooms of mixed sizes', () => {
  for (const seed of SEEDS) {
    const m = generateDungeon(seed);
    assert.ok(m.rooms.length >= 12, `seed ${seed}: ${m.rooms.length} rooms`);
    const sizes = new Set(m.rooms.map((r) => r.size));
    assert.ok(sizes.has('large') && sizes.has('small'), `seed ${seed}`);
  }
});

test('rooms stay in bounds, never overlap, and the map edge stays solid rock', () => {
  for (const seed of SEEDS) {
    const m = generateDungeon(seed);
    for (const r of m.rooms) {
      assert.ok(r.x >= 2 && r.y >= 2 && r.x + r.w <= m.width - 2 && r.y + r.h <= m.height - 2);
      for (const o of m.rooms) {
        if (o === r) continue;
        const apart = r.x + r.w < o.x || o.x + o.w < r.x || r.y + r.h < o.y || o.y + o.h < r.y;
        assert.ok(apart || sharedWall(r, o), `rooms ${r.id} and ${o.id} overlap (seed ${seed})`);
      }
    }
    for (let i = 0; i < m.width; i++) {
      assert.equal(m.tiles[0][i], TILE.ROCK); assert.equal(m.tiles[m.height - 1][i], TILE.ROCK);
      assert.equal(m.tiles[i][0], TILE.ROCK); assert.equal(m.tiles[i][m.width - 1], TILE.ROCK);
    }
  }
});

test('every room has a door, and each door is a proper doorway', () => {
  for (const seed of SEEDS) {
    const m = generateDungeon(seed);
    for (const r of m.rooms) assert.ok(r.doors.length >= 1, `room ${r.id} seed ${seed}`);
    for (const d of m.doors) {
      assert.equal(m.tiles[d.y][d.x], TILE.DOOR);
      // A doorway is open on exactly the two opposite sides it is walked through, walled on the others.
      const ew = isWalkable(m, d.x - 1, d.y) && isWalkable(m, d.x + 1, d.y);
      const ns = isWalkable(m, d.x, d.y - 1) && isWalkable(m, d.x, d.y + 1);
      if (d.orientation === 'h') {
        assert.ok(ew && !isWalkable(m, d.x, d.y - 1) && !isWalkable(m, d.x, d.y + 1), `door ${d.x},${d.y} seed ${seed}`);
      } else {
        assert.ok(ns && !isWalkable(m, d.x - 1, d.y) && !isWalkable(m, d.x + 1, d.y), `door ${d.x},${d.y} seed ${seed}`);
      }
    }
  }
});

test('minimum spanning tree links n rooms with n-1 edges', () => {
  const rooms = [{ x: 0, y: 0, w: 1, h: 1 }, { x: 10, y: 0, w: 1, h: 1 }, { x: 0, y: 10, w: 1, h: 1 }, { x: 11, y: 11, w: 1, h: 1 }];
  const edges = minimumSpanningTree(rooms);
  assert.equal(edges.length, 3);
  assert.equal(Math.round(edges.reduce((s, e) => s + e.d, 0)), 31); // 10 + 10 + ~11.05
});

// ---- Movement ------------------------------------------------------------

/** Tiny hand-made map from ASCII: '#' rock, '.' floor. */
function asciiMap(rows) {
  return {
    width: rows[0].length, height: rows.length, cellSize: 64, feetPerCell: 5, rooms: [], doors: [],
    tiles: rows.map((r) => [...r].map((c) => (c === '#' ? TILE.ROCK : TILE.ROOM))),
  };
}

test('speed converts to squares', () => {
  assert.equal(speedToSquares(30), 6);
  assert.equal(speedToSquares(25), 5);
  assert.equal(speedToSquares(35), 7);
});

test('standard rule: diagonals cost 1, so range is a square', () => {
  const m = asciiMap(['#######', '#.....#', '#.....#', '#.....#', '#.....#', '#.....#', '#######']);
  const r = reachableSquares(m, { x: 3, y: 3 }, 2);
  assert.equal(r.size, 25);
  assert.equal(r.get('1,1').cost, 2);
  assert.equal(r.get('1,1').path.length, 3);
});

test('alternating rule: the second diagonal costs 2', () => {
  const m = asciiMap(['#######', '#.....#', '#.....#', '#.....#', '#.....#', '#.....#', '#######']);
  const r = reachableSquares(m, { x: 3, y: 3 }, 2, { diagonalRule: 'alternating' });
  assert.ok(!r.has('1,1'), 'two diagonals cost 3');
  assert.equal(r.get('2,2').cost, 1);
  assert.equal(r.size, 21); // 25 minus the four far corners
  assert.equal(gridDistance({ x: 0, y: 0 }, { x: 4, y: 4 }, 'alternating'), 6);
  assert.equal(gridDistance({ x: 0, y: 0 }, { x: 4, y: 4 }), 4);
});

test('walls block and corners cannot be cut', () => {
  const m = asciiMap(['#####', '#.#.#', '#...#', '#####']);
  assert.equal(canStep(m, 1, 1, 1, 1), false); // (2,1) is rock, so no diagonal to (2,2)
  const r = reachableSquares(m, { x: 1, y: 1 }, 2);
  assert.equal(r.get('2,2').cost, 2); // down then right
  // (3,1) needs 4 steps: down, right, right, up. Both diagonal shortcuts would cut the pillar's corner.
  assert.ok(!reachableSquares(m, { x: 1, y: 1 }, 3).has('3,1'));
  assert.equal(reachableSquares(m, { x: 1, y: 1 }, 4).get('3,1').cost, 4);
});

test('occupied squares can be blocked', () => {
  const m = asciiMap(['#####', '#...#', '#####']);
  const r = reachableSquares(m, { x: 1, y: 1 }, 5, { blocked: new Set(['2,1']) });
  assert.ok(!r.has('3,1'));
});

test('renderer produces a 2048 px SVG with every door', () => {
  const m = generateDungeon(3);
  const svg = renderDungeonSVG(m, { textures: null });
  assert.match(svg, /viewBox="0 0 2048 2048"/);
  assert.equal((svg.match(/rotate\(/g) || []).length, m.doors.length);
  assert.equal((svg.match(/class="room-label"/g) || []).length, m.rooms.length);
});
