import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeItem, addItem, bagUsed, whyNoRoom, loadLimits, carriedWeight, BAG_SLOTS, equipItem } from '../src/engine/items.js';
import { buyItem } from '../src/engine/shop.js';

const bagOf = (n) => { const g = { inventory: [], equipped: {}, coins: 0 }; for (let i = 0; i < n; i++) addItem(g.inventory, makeItem('dagger')); return g; };

test('the bag holds 20 things; stacks share a slot; worn gear is not in the bag', () => {
  assert.equal(BAG_SLOTS, 20);
  const g = bagOf(20);
  assert.equal(bagUsed(g), 20);
  assert.match(whyNoRoom(g, makeItem('club'), 10), /full \(20 of 20/);
  // Wielding one dagger frees a slot.
  equipItem(g, g.inventory[0].uid, 'mainHand');
  assert.equal(bagUsed(g), 19);
  assert.equal(whyNoRoom(g, makeItem('club'), 10), null);
  // A full bag still takes more of a stack it already holds.
  addItem(g.inventory, makeItem('arrows', 20));
  assert.equal(bagUsed(g), 20);
  assert.equal(whyNoRoom(g, makeItem('arrows', 20), 10), null);
  assert.ok(whyNoRoom(g, makeItem('bolts', 20), 10));
});

test('weight: burdened above STR x 10 lb; STR x 15 lb is the most you can carry', () => {
  assert.deepEqual(loadLimits(10), { burdened: 100, max: 150 });
  const g = { inventory: [makeItem('plate'), makeItem('plate')], equipped: {}, coins: 0 }; // 130 lb
  assert.equal(carriedWeight(g.inventory), 130);
  assert.match(whyNoRoom(g, makeItem('chain-mail'), 10), /Too heavy/); // +55 lb = 185 > 150
  assert.equal(whyNoRoom(g, makeItem('chain-mail'), 13), null); // STR 13 carries 195 lb
  assert.match(whyNoRoom(g, makeItem('dagger'), 8), /Too heavy/, 'already over a weak hero\'s limit');
});

test('traders will not sell what does not fit', () => {
  const g = bagOf(20); g.coins = 100000;
  const r = buyItem(g, 'longsword', 0.5, 10);
  assert.equal(r.ok, false); assert.match(r.message, /full/);
  assert.equal(g.coins, 100000, 'no coins taken');
  assert.ok(buyItem(g, 'dagger', 0.5, 10).ok === false);
  const h = bagOf(3); h.coins = 100000;
  assert.ok(buyItem(h, 'longsword', 0.5, 10).ok);
});
