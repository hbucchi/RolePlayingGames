import { test } from 'node:test';
import assert from 'node:assert/strict';
import { abilityModifier, formatModifier, pointBuyTotal, applyBonuses, autoAssign, STANDARD_ARRAY } from '../src/engine/abilities.js';

test('ability modifier table', () => {
  const table = { 1: -5, 3: -4, 8: -1, 9: -1, 10: 0, 11: 0, 12: 1, 15: 2, 18: 4, 20: 5 };
  for (const [score, mod] of Object.entries(table)) assert.equal(abilityModifier(Number(score)), mod, `score ${score}`);
  assert.equal(formatModifier(2), '+2');
  assert.equal(formatModifier(0), '+0');
  assert.equal(formatModifier(-1), '-1');
});

test('point buy costs', () => {
  assert.equal(pointBuyTotal({ str: 8, dex: 8, con: 8, int: 8, wis: 8, cha: 8 }), 0);
  assert.equal(pointBuyTotal({ str: 15, dex: 15, con: 15, int: 8, wis: 8, cha: 8 }), 27);
  // The standard array costs exactly 27 points too.
  assert.equal(pointBuyTotal({ str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: 8 }), 27);
  assert.throws(() => pointBuyTotal({ str: 16, dex: 8, con: 8, int: 8, wis: 8, cha: 8 }), RangeError);
});

test('bonuses add and cap at 20', () => {
  const r = applyBonuses({ str: 19, dex: 10, con: 10, int: 10, wis: 10, cha: 10 }, { str: 2, dex: 1 });
  assert.equal(r.str, 20);
  assert.equal(r.dex, 11);
});

test('autoAssign puts the highest values in priority order', () => {
  const a = autoAssign([...STANDARD_ARRAY], ['dex', 'wis', 'con']);
  assert.equal(STANDARD_ARRAY[a.dex], 15);
  assert.equal(STANDARD_ARRAY[a.wis], 14);
  assert.equal(STANDARD_ARRAY[a.con], 13);
  assert.equal(new Set(Object.values(a)).size, 6);
});
