import { test } from 'node:test';
import assert from 'node:assert/strict';
import { heroDefence, monsterDefence, absorbed, landChance, blockChanceVs, shieldBlock, parryBlock, ARMOUR_ABSORB } from '../src/engine/defence.js';
import { makeItem, equipItem } from '../src/engine/items.js';
import { BESTIARY_BY_ID } from '../src/content/bestiary/index.js';
import { hitLocation } from '../src/engine/body.js';

const kit = (...ids) => { const g = { inventory: [], equipped: {} }; for (const id of ids) { const it = makeItem(id); g.inventory.push(it); equipItem(g, it.uid); } return g; };

test('armour absorbs a percentage: 10 damage through 40% is 6', () => {
  assert.equal(absorbed(10, 40), 6);
  assert.equal(absorbed(10, 0), 10);
  assert.equal(absorbed(1, 55), 1, 'at least 1 gets through');
  assert.equal(ARMOUR_ABSORB['chain-mail'], 40); assert.equal(ARMOUR_ABSORB.plate, 55);
});

test('heroes: Evasion from DEX (capped by armour), block from shield or trained weapon, armour by body part', () => {
  const light = heroDefence(kit('leather', 'shortsword'), { dex: 3, pb: 2 });
  assert.equal(light.evasion, 13); assert.equal(light.block, parryBlock(2)); assert.equal(light.blockWith, 'parry');
  assert.equal(light.armour.chest, 10); assert.equal(light.armour['left-leg'], 0);
  const heavy = heroDefence(kit('chain-mail', 'longsword', 'shield'), { dex: 2, pb: 2 });
  assert.equal(heavy.evasion, 10, 'heavy armour: no DEX'); assert.equal(heavy.block, shieldBlock(2)); assert.equal(heavy.blockWith, 'shield');
  assert.equal(heavy.armour['left-leg'], 40); assert.equal(heavy.armour.head, 0);
  assert.equal(heroDefence(kit('plate'), { dex: 0 }).armour.head, 55, 'plate has a helm');
  assert.equal(heroDefence(kit('scale-mail'), { dex: 4 }).evasion, 12, 'medium armour: DEX at most +2');
  const untrained = heroDefence(kit('leather', 'longsword'), { dex: 0, weaponTrained: () => false });
  assert.equal(untrained.block, 0, 'no parry with an untrained weapon');
  assert.equal(heroDefence(kit('leather'), { dex: 1, magicEvasion: 1 }).evasion, 12, 'a ring of protection adds to Evasion');
});

test('monsters: worn armour from the stat block, natural armour all over, parry only with made weapons', () => {
  const gob = monsterDefence(BESTIARY_BY_ID.goblin);
  assert.equal(gob.evasion, 12); assert.equal(gob.blockWith, 'shield'); assert.equal(gob.block, 25);
  assert.equal(gob.armour.chest, 10); assert.equal(gob.armour.head, 0);
  const wolf = monsterDefence(BESTIARY_BY_ID.wolf);
  assert.equal(wolf.block, 0, 'jaws do not parry');
  assert.ok(Object.values(wolf.armour).every((p) => p === wolf.armour.chest), 'natural armour covers the whole body');
});

test('blocking rules and the chance to land', () => {
  const shield = { block: 25, blockWith: 'shield' }; const parry = { block: 15, blockWith: 'parry' };
  assert.equal(blockChanceVs(shield, { ranged: true }), 0.25, 'shields stop arrows');
  assert.equal(blockChanceVs(parry, { ranged: true }), 0, 'you cannot parry an arrow');
  assert.equal(blockChanceVs(shield, { spell: true }), 0);
  assert.equal(blockChanceVs(shield, { unseen: true }), 0, 'not from behind or unaware');
  // 65% past Evasion, 25% blocked, criticals (5%) cannot be: 0.05 + 0.60 x 0.75 = 0.50
  assert.ok(Math.abs(landChance(0.65, 0.25) - 0.5) < 1e-9);
});

test('hit location follows the body weights', () => {
  assert.equal(hitLocation(1), 'head'); assert.equal(hitLocation(10), 'head'); assert.equal(hitLocation(11), 'neck');
  assert.equal(hitLocation(100), 'left-leg');
});
