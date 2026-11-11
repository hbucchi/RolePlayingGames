import { test } from 'node:test';
import assert from 'node:assert/strict';
import { forceDc, NOISE, placeFeatures } from '../src/engine/features.js';
import { generateDungeon } from '../src/engine/dungeon.js';

test('oak doors are easy to force, iron doors very hard, chests as before', () => {
  for (let dc = 10; dc <= 20; dc++) {
    assert.ok(forceDc({ dc, material: 'wood' }) <= 11, `oak DC ${forceDc({ dc, material: 'wood' })}`);
    assert.ok(forceDc({ dc, material: 'iron' }) >= 22, 'iron');
  }
  assert.equal(forceDc({ dc: 13 }, 'chest'), 15);
  assert.deepEqual(NOISE, { fail: 10, fumble: 15 });
});

test('locked doors are oak or iron, mostly oak', () => {
  let wood = 0; let iron = 0;
  for (let seed = 1; seed <= 60; seed++) for (const l of placeFeatures(generateDungeon(seed), seed, 1).locks.values()) l.material === 'iron' ? iron++ : wood++;
  assert.ok(wood > iron && iron > 0, `${wood} oak, ${iron} iron`);
});
