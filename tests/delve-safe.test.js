import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDelveStore } from '../src/engine/delve.js';
import { createSafe, SAFE_SLOTS } from '../src/engine/safe.js';
import { makeItem } from '../src/engine/items.js';

const mem = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };

test('delve: gains are only kept at an exit; defeat puts the heroes back', () => {
  const store = createDelveStore(mem());
  const roster = new Map();
  const hero = { id: 'h1', name: 'Brannoc', xp: 100, coins: 50, inventory: [] };
  roster.set('h1', structuredClone(hero));
  store.begin('dungeon', [hero]);
  assert.ok(store.active());
  // In the dungeon: XP and loot, saved as you go...
  hero.xp = 400; hero.coins = 900; roster.set('h1', structuredClone(hero));
  // ...the party falls: back as they came in.
  const names = store.restore((d) => roster.set(d.id, d));
  assert.deepEqual(names, ['Brannoc']);
  assert.equal(roster.get('h1').xp, 100); assert.equal(roster.get('h1').coins, 50);
  assert.equal(store.active(), false);
});

test('delve: the stairs move the checkpoint forward; adopted heroes are followed', () => {
  const store = createDelveStore(mem());
  const roster = new Map();
  store.begin('dungeon', [{ id: 'premade-x', name: 'Pippa', xp: 0 }]);
  store.rename('premade-x', 'p9');
  store.commit([{ id: 'p9', name: 'Pippa', xp: 300 }]);
  store.restore((d) => roster.set(d.id, d));
  assert.equal(roster.get('p9').xp, 300, 'what was carried to the stairs is kept');
});

test('safe: 120 slots, stacks share one, worn things stay on the hero', () => {
  const safe = createSafe(mem());
  const sword = makeItem('longsword');
  const arrows = makeItem('arrows', 20);
  const hero = { inventory: [sword, arrows, makeItem('arrows', 5)], equipped: {} };
  assert.equal(safe.store(hero, sword.uid).ok, true);
  safe.store(hero, arrows.uid); safe.store(hero, hero.inventory[0].uid);
  assert.equal(safe.used(), 2, 'the arrows make one stack');
  assert.equal(safe.items().find((x) => x.id === 'arrows').qty, 25);
  assert.equal(hero.inventory.length, 0);
  const worn = makeItem('leather'); const h2 = { inventory: [worn], equipped: { body: worn.uid } };
  assert.equal(safe.store(h2, worn.uid).ok, false);
  // Take it back out.
  const s = safe.items().find((x) => x.id === 'longsword');
  assert.equal(safe.take(hero, s.uid).ok, true);
  assert.equal(hero.inventory[0].id, 'longsword');
  assert.equal(SAFE_SLOTS, 120);
});

test('xp rates: dungeons teach little, the campaign most; campaign foes are veterans', async () => {
  const { XP_RATE } = await import('../src/engine/progression.js');
  assert.ok(XP_RATE.dungeon < XP_RATE.story && XP_RATE.story < XP_RATE.campaign);
  const { createMonster, makeVeteran } = await import('../src/engine/combat.js');
  const { BESTIARY_BY_ID } = await import('../src/content/bestiary/index.js');
  const g = createMonster(BESTIARY_BY_ID.goblin, 'g', { x: 0, y: 0 });
  const v = makeVeteran(createMonster(BESTIARY_BY_ID.goblin, 'v', { x: 0, y: 0 }));
  assert.equal(v.maxHp, Math.round(g.maxHp * 1.3));
  assert.equal(v.weapons[0].toHit, g.weapons[0].toHit + 1);
});
