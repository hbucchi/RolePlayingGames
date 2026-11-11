import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stockFor, buyItem, buyPrice, rareOffer, haulFor, period, isStandard, MAGIC_MARKUP, BUNDLE } from '../src/engine/shop.js';
import { makeItem, itemValue, isMagic } from '../src/engine/items.js';
import { ITEMS_BY_ID } from '../src/content/items/catalogue.js';

test('standard stock: only plain common goods, all affordable from one dungeon', () => {
  for (const level of [1, 3, 5, 10, 20]) {
    const st = stockFor({ traderKey: 'marta', level });
    assert.ok(st.standard.length > 40, `level ${level} has plenty for sale`);
    for (const g of st.standard) {
      assert.ok(isStandard(g.def), `${g.id} is standard`);
      assert.ok(!g.def.magic && g.def.rarity === 'common');
      assert.ok(g.price <= haulFor(level), `${g.id} costs no more than one haul`);
    }
  }
  const l1 = stockFor({ traderKey: 'marta', level: 1 });
  assert.ok(l1.standard.some((g) => g.id === 'longsword'));
  assert.ok(l1.later.some((g) => g.id === 'plate' && g.from === 10), 'plate waits for level 10');
  assert.ok(stockFor({ traderKey: 'marta', level: 10 }).standard.some((g) => g.id === 'plate'));
  assert.ok(!l1.standard.some((g) => ITEMS_BY_ID[g.id].key || ITEMS_BY_ID[g.id].quest));
});

test('magic and rare goods cost three times their value', () => {
  const blade = makeItem('longsword', 1, { bonus: 1 });
  assert.equal(buyPrice(blade), itemValue(blade) * MAGIC_MARKUP);
  assert.equal(buyPrice(makeItem('ring-of-protection')), 3500 * 100 * 3);
  assert.equal(buyPrice(makeItem('longsword')), 15 * 100);
});

test('haggling lowers buying prices by the same points it raises selling ones', () => {
  const sword = makeItem('longsword');
  assert.equal(buyPrice(sword, 0.6), Math.ceil(1500 * 0.9));
  assert.equal(buyPrice(sword, 0.75), Math.ceil(1500 * 0.75));
  assert.equal(buyPrice(sword, 0.45), Math.ceil(1500 * 1.05));
});

test('rare offers: about 10% of periods, stable within a period, change every 3 adventures', () => {
  let hits = 0; const N = 2000;
  for (let p = 0; p < N; p++) if (rareOffer('marta', p, 3)) hits++;
  assert.ok(hits > N * 0.07 && hits < N * 0.13, `about 10% (${hits}/${N})`);
  for (let p = 0; p < 50; p++) {
    const a = rareOffer('marta', p, 3); const b = rareOffer('marta', p, 3);
    assert.deepEqual(a && { id: a.id, bonus: a.bonus }, b && { id: b.id, bonus: b.bonus });
    if (a) assert.ok(isMagic(a) || ITEMS_BY_ID[a.id].rarity !== 'common');
  }
  assert.deepEqual([0, 1, 2].map((n) => period(n).period), [0, 0, 0]);
  assert.equal(period(3).period, 1);
  assert.equal(period(4).nextIn, 2);
  const p = [...Array(200).keys()].find((k) => rareOffer('marta', k, 3));
  const st = stockFor({ traderKey: 'marta', level: 3, adventures: p * 3 });
  assert.ok(st.rare && st.rare.price === buyPrice(st.rare.inst));
  assert.equal(stockFor({ traderKey: 'marta', level: 3, adventures: p * 3, bought: true }).rare, null, 'a bought offer is gone');
});

test('buying takes coins and fills the pack; bundles stack', () => {
  const gear = { coins: 2000, inventory: [], equipped: {} };
  const r = buyItem(gear, 'longsword');
  assert.ok(r.ok); assert.equal(gear.coins, 500); assert.equal(gear.inventory[0].id, 'longsword');
  assert.equal(buyItem(gear, 'longsword').ok, false, 'not enough coin');
  assert.equal(gear.coins, 500);
  buyItem(gear, 'arrows'); buyItem(gear, 'arrows');
  assert.equal(gear.inventory.find((x) => x.id === 'arrows').qty, BUNDLE.arrows * 2);
  assert.equal(buyItem({ coins: 1e9, inventory: [] }, 'ring-of-protection').ok, false, 'magic only through the rare offer');
  const rich = { coins: 1e9, inventory: [] };
  const rr = buyItem(rich, makeItem('longsword', 1, { bonus: 2 }));
  assert.ok(rr.ok); assert.equal(rich.inventory[0].bonus, 2);
});
