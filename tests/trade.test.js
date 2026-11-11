import { test } from 'node:test';
import assert from 'node:assert/strict';
import { haggleRate, sellPrice, sellItem, whyUnsellable, BASE_RATE } from '../src/engine/trade.js';
import { makeItem, equipItem } from '../src/engine/items.js';
import { ITEMS_BY_ID } from '../src/content/items/catalogue.js';

test('traders pay half; haggling adds 1% per point over 10, up to 75%', () => {
  assert.equal(BASE_RATE, 0.5);
  assert.equal(haggleRate(8, 5), 0.5, 'a poor roll keeps half price');
  assert.equal(haggleRate(17, 12), 0.57);
  assert.equal(haggleRate(40, 19), 0.75, 'capped');
  assert.equal(haggleRate(20, 20), 0.65, 'natural 20: +5%');
  assert.equal(haggleRate(25, 1), 0.45, 'natural 1: the trader is offended');
});

test('selling moves the item out and the coins in; stacks sell one or all', () => {
  const gold = makeItem('gold-ring'); // 25 gp new
  const arrows = makeItem('arrows', 20);
  const gear = { inventory: [gold, arrows], equipped: {}, coins: 0 };
  assert.equal(sellPrice(gold, 0.5), ITEMS_BY_ID['gold-ring'].value / 2);
  const r = sellItem(gear, gold.uid, 0.6);
  assert.ok(r.ok); assert.equal(gear.coins, Math.floor(ITEMS_BY_ID['gold-ring'].value * 0.6));
  assert.ok(!gear.inventory.includes(gold));
  sellItem(gear, arrows.uid, 0.5, 1);
  assert.equal(gear.inventory.find((x) => x.id === 'arrows').qty, 19, 'sold one arrow');
});

test('worn things, quest items and keys are not for sale', () => {
  const ring = makeItem('ruby-ring'); const signet = makeItem('stewards-signet'); const key = makeItem('iron-key', 1, { door: '1,1' });
  const gear = { inventory: [ring, signet, key], equipped: {}, coins: 0 };
  equipItem(gear, ring.uid);
  assert.match(whyUnsellable(gear, ring), /take it off/);
  assert.ok(whyUnsellable(gear, signet));
  assert.ok(whyUnsellable(gear, key));
  assert.equal(sellItem(gear, signet.uid).ok, false);
});
