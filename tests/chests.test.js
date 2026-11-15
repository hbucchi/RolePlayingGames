/** Treasure comes slowly: two chests a floor, each modest, some trapped (features.js, loot.js). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateDungeon } from '../src/engine/dungeon.js';
import { placeFeatures, CHESTS_PER_FLOOR } from '../src/engine/features.js';
import { rollChestLoot } from '../src/engine/loot.js';
import { isMagic } from '../src/engine/items.js';

const seeded = (seed) => () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
const rngInt = (r) => (n) => Math.floor(r() * n);

test('every floor has at most two chests, and some are trapped', () => {
  let trapped = 0; let total = 0;
  for (let seed = 1; seed <= 200; seed++) {
    const f = placeFeatures(generateDungeon(seed), seed, 3);
    assert.ok(f.chests.length <= CHESTS_PER_FLOOR, `seed ${seed}: ${f.chests.length} chests`);
    total += f.chests.length; trapped += f.chests.filter((c) => c.trap).length;
    for (const c of f.chests) if (c.trap) assert.match(c.trap.damage, /^\d+d8$/);
  }
  assert.ok(total >= 350, 'nearly every floor has its two chests');
  assert.ok(trapped / total > 0.15 && trapped / total < 0.4, `about a quarter trapped (${trapped}/${total})`);
});

test('a chest holds one to three things, more and better deeper down', () => {
  const r = rngInt(seeded(7));
  const avg = (depth) => { let n = 0; let magic = 0; for (let i = 0; i < 400; i++) { const l = rollChestLoot(3, r, depth); assert.ok(l.items.length >= 1 && l.items.length <= 3); n += l.items.length; magic += l.items.some(isMagic) ? 1 : 0; } return { n: n / 400, magic: magic / 400 }; };
  const top = avg(1); const deep = avg(10);
  assert.ok(top.n <= 2 && deep.n >= 2, `${top.n} items on floor 1, ${deep.n} on floor 10`);
  assert.ok(deep.magic > top.magic, 'magic is likelier deep down');
});
