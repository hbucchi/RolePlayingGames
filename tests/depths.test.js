import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_DEPTH, isBossFloor, depthLevel, depthReward, depthMix, pickBoss, lootLevel } from '../src/engine/depths.js';
import { generateBossLair, TILE } from '../src/engine/dungeon.js';
import { DUNGEON_FOES } from '../src/content/westlands/dungeon-foes.js';
import { BESTIARY_BY_ID } from '../src/content/bestiary/index.js';
import { seededRng } from '../src/engine/dice.js';

test('depths: ten floors, danger and pay rising gradually', () => {
  assert.equal(MAX_DEPTH, 10); assert.ok(isBossFloor(10)); assert.ok(!isBossFloor(9));
  assert.deepEqual([1, 2, 3, 4, 6, 9, 10].map((d) => depthLevel(3, d)), [3, 3, 4, 4, 5, 6, 7]);
  assert.equal(depthReward(1), 1); assert.equal(depthReward(5), 2); assert.equal(depthReward(10), 3.25);
  assert.equal(lootLevel(3, 1), 3); assert.equal(lootLevel(3, 9), 7);
  const a = depthMix(1); const b = depthMix(9);
  assert.equal(a.easy + a.medium + a.hard, 100);
  assert.ok(b.easy < a.easy && b.hard > a.hard && b.chance > a.chance);
});

test('depths: the tenth floor is one hall, with a boss fit for the party', () => {
  const map = generateBossLair(42);
  assert.equal(map.rooms.length, 1); assert.ok(map.boss);
  assert.notEqual(map.tiles[map.entrance.y][map.entrance.x], TILE.ROCK);
  assert.notEqual(map.tiles[map.exit.y][map.exit.x], TILE.ROCK);
  const pool = DUNGEON_FOES.map((id) => BESTIARY_BY_ID[id]).filter(Boolean);
  for (const lv of [1, 4, 8, 14]) {
    const { boss } = pickBoss(pool, lv, 4, seededRng(lv));
    assert.ok(boss, `a boss at level ${lv}`);
  }
  const low = pickBoss(pool, 1, 4, seededRng(1)).boss; const high = pickBoss(pool, 14, 4, seededRng(1)).boss;
  assert.ok(high.xp > low.xp, 'stronger parties meet stronger bosses');
});
