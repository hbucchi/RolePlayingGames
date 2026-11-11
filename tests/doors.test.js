import { test } from 'node:test';
import assert from 'node:assert/strict';
import { forceDc, NOISE, placeFeatures } from '../src/engine/features.js';
import { generateDungeon, TILE } from '../src/engine/dungeon.js';

test('oak doors are easy to force (easiest early), iron doors very hard, chests as before', () => {
  for (let dc = 8; dc <= 12; dc++) assert.ok(forceDc({ dc, material: 'wood' }) <= 9, `early oak DC ${forceDc({ dc, material: 'wood' })}`);
  for (let dc = 10; dc <= 20; dc++) {
    assert.ok(forceDc({ dc, material: 'wood' }) <= 10);
    assert.ok(forceDc({ dc, material: 'iron' }) >= 20, 'iron');
  }
  assert.equal(forceDc({ dc: 13 }, 'chest'), 15);
  assert.deepEqual(NOISE, { fail: 10, fumble: 15 });
});

/** Squares reachable from the entrance without passing the given doors (4-way steps). */
function reach(map, blocked) {
  const k = (x, y) => `${x},${y}`; const seen = new Set([k(map.entrance.x, map.entrance.y)]); const q = [map.entrance];
  while (q.length) {
    const c = q.pop();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const x = c.x + dx; const y = c.y + dy;
      if (!seen.has(k(x, y)) && !blocked.has(k(x, y)) && map.tiles[y]?.[x] !== undefined && map.tiles[y][x] !== TILE.ROCK) { seen.add(k(x, y)); q.push({ x, y }); }
    }
  }
  return seen;
}

test('early on, every iron door has its own key in a chest you can reach without it', () => {
  let iron = 0;
  for (let seed = 1; seed <= 80; seed++) {
    const map = generateDungeon(seed); const f = placeFeatures(map, seed, 1);
    const ironDoors = [...f.locks].filter(([, l]) => l.material === 'iron');
    for (const [k, l] of ironDoors) {
      iron++;
      assert.ok(l.key, `seed ${seed}: iron door ${k} has a key`);
      const chest = f.chests.find((c) => c.id === l.key);
      assert.equal(chest.keyFor, k, 'one key, one door');
      const open = reach(map, new Set([...f.secretDoors, ...ironDoors.map(([d]) => d)]));
      assert.ok(open.has(`${chest.x},${chest.y}`), `seed ${seed}: the key for ${k} is reachable`);
    }
    for (const l of f.locks.values()) assert.ok(l.dc <= 12, 'simple locks at level 1');
  }
  assert.ok(iron > 0, 'some early iron doors exist (with keys)');
  // Later, iron doors may stand without a key.
  let keyless = 0;
  for (let seed = 1; seed <= 80; seed++) for (const l of placeFeatures(generateDungeon(seed), seed, 9).locks.values()) if (l.material === 'iron' && !l.key) keyless++;
  assert.ok(keyless > 0, 'keyless iron doors appear at higher levels');
});

import { existsSync } from 'node:fs';
import { TRAP_KINDS, trapTile } from '../src/engine/features.js';
test('every trap has a painted tile when found, sprung and disarmed', () => {
  assert.ok(TRAP_KINDS.some((k) => k.kind === 'spikes') && TRAP_KINDS.some((k) => k.kind === 'ceiling') && TRAP_KINDS.some((k) => k.kind === 'pit'));
  for (const k of TRAP_KINDS) for (const st of [{}, { sprung: true }, { disarmed: true }]) {
    const f = trapTile({ kind: k.kind, ...st });
    assert.ok(existsSync(new URL(`../${f}`, import.meta.url)), `${k.kind}: ${f}`);
  }
});
