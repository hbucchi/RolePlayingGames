import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { PROPS, PROP_IDS, propCells, propCost, furnishDungeon, propsSvg, propImage } from '../src/engine/props.js';
import { generateDungeon, TILE } from '../src/engine/dungeon.js';
import { reachableSquares } from '../src/engine/movement.js';
import { CAMPAIGNS } from '../src/content/campaigns/index.js';
import { parseLocation } from '../src/engine/campaign.js';
import { CODE, decodeArena } from '../src/engine/terrain.js';

test('every prop has its picture', () => {
  for (const id of PROP_IDS) assert.ok(existsSync(new URL(`../${propImage(id)}`, import.meta.url)), `${id} has no picture`);
  for (const id of ['forge', 'anvil', 'workbench', 'grindstone']) assert.ok(PROPS[id].station, `${id} is a crafting station`);
});

test('furniture blocks or slows movement; a rug does not', () => {
  const map = generateDungeon(3);
  map.props = [{ kind: 'long-table', x: 2, y: 2 }, { kind: 'chair', x: 5, y: 5 }, { kind: 'rug', x: 7, y: 7 }];
  assert.equal(propCost(map, 3, 2), Infinity);
  assert.equal(propCost(map, 5, 5), 2);
  assert.equal(propCost(map, 8, 8), 1);
  assert.equal(propCells({ kind: 'bookshelf', x: 1, y: 1, rot: 90 }).length, 2);
  assert.match(propsSvg(map, 64), /assets\/props\/long-table\.png/);
});

test('furnished dungeons stay fully connected and keep chests and stairs clear', () => {
  for (let seed = 1; seed <= 25; seed++) {
    const map = generateDungeon(seed);
    const avoid = new Set([`${map.exit.x},${map.exit.y}`]);
    const props = furnishDungeon(map, seed, avoid);
    assert.ok(props.length > 0, `seed ${seed} got some furniture`);
    assert.deepEqual(furnishDungeon(generateDungeon(seed), seed, avoid), props, 'seeded');
    // Every walkable square that is not under furniture can be reached from the entrance.
    const reach = reachableSquares(map, map.entrance, 9999);
    for (let y = 0; y < map.height; y++) for (let x = 0; x < map.width; x++) {
      if (map.tiles[y][x] === TILE.ROCK || propCost(map, x, y) === Infinity) continue;
      assert.ok(reach.has(`${x},${y}`), `seed ${seed}: ${x},${y} cut off by furniture`);
    }
    assert.ok(propCost(map, map.exit.x, map.exit.y) < Infinity, 'stairs clear');
  }
});

test('props in the campaign places stand on open floor and wall nobody in', () => {
  for (const c of CAMPAIGNS) for (const [id, loc] of Object.entries(c.locations)) {
    if (!loc.rows) continue;
    const p = parseLocation(loc, (t) => CODE[t] ?? '.');
    const map = decodeArena(p.terrainRows); map.props = loc.props ?? [];
    const people = [...p.heroes, ...p.exits, ...p.npcs.map((n) => n.pos), ...p.foes.map((f) => f.pos), ...p.chests.map((ch) => ch.pos)];
    for (const pr of map.props) {
      assert.ok(PROPS[pr.kind], `${id}: unknown prop ${pr.kind}`);
      if (PROPS[pr.kind].wall) continue;
      for (const q of propCells(pr)) {
        assert.notEqual(map.tiles[q.y]?.[q.x], TILE.ROCK, `${id}: ${pr.kind} in a wall at ${q.x},${q.y}`);
        assert.ok(!people.some((o) => o.x === q.x && o.y === q.y), `${id}: ${pr.kind} on someone at ${q.x},${q.y}`);
      }
    }
    // Everyone (and every chest) can still be walked up to from where the party arrives.
    const reach = reachableSquares(map, p.heroes[0], 9999);
    for (const o of [...p.exits, ...p.npcs.map((n) => n.pos), ...p.chests.map((ch) => ch.pos)]) {
      const near = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]].some(([dx, dy]) => reach.has(`${o.x + dx},${o.y + dy}`));
      assert.ok(near, `${id}: ${o.x},${o.y} cannot be reached`);
    }
  }
});
