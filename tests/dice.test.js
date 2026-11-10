import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cryptoRandomInt, seededRng, rollDie, roll, rollAbilityScore, parseNotation } from '../src/engine/dice.js';

test('cryptoRandomInt stays in range and hits every value', () => {
  const seen = new Set();
  for (let i = 0; i < 2000; i++) {
    const x = cryptoRandomInt(6);
    assert.ok(x >= 0 && x < 6);
    seen.add(x);
  }
  assert.equal(seen.size, 6);
  assert.throws(() => cryptoRandomInt(0), RangeError);
});

test('seeded rng is deterministic', () => {
  const a = seededRng(42); const b = seededRng(42);
  const ra = Array.from({ length: 20 }, () => rollDie(20, a));
  const rb = Array.from({ length: 20 }, () => rollDie(20, b));
  assert.deepEqual(ra, rb);
  assert.ok(ra.every((x) => x >= 1 && x <= 20));
});

test('d6 is roughly uniform (chi-squared sanity check)', () => {
  const rng = seededRng(7); const n = 60000; const counts = Array(6).fill(0);
  for (let i = 0; i < n; i++) counts[rollDie(6, rng) - 1]++;
  const expected = n / 6;
  const chi2 = counts.reduce((s, c) => s + (c - expected) ** 2 / expected, 0);
  assert.ok(chi2 < 20.5, `chi2 ${chi2}`); // p ~ 0.001 critical value for 5 degrees of freedom
});

test('parseNotation handles common forms', () => {
  assert.deepEqual(parseNotation('d20'), { count: 1, sides: 20, keepMode: null, keep: 1, modifier: 0 });
  assert.deepEqual(parseNotation('2d8-1'), { count: 2, sides: 8, keepMode: null, keep: 2, modifier: -1 });
  assert.deepEqual(parseNotation('4d6kh3'), { count: 4, sides: 6, keepMode: 'kh', keep: 3, modifier: 0 });
  assert.throws(() => parseNotation('banana'), SyntaxError);
  assert.throws(() => parseNotation('2d6kh3'), RangeError);
});

test('keep-lowest gives disadvantage', () => {
  const r = roll('2d20kl1', seededRng(3));
  assert.equal(r.total, Math.min(...r.rolls));
});

test('4d6 drop lowest keeps the three highest dice', () => {
  const rng = seededRng(123);
  for (let i = 0; i < 500; i++) {
    const r = rollAbilityScore(rng);
    assert.equal(r.rolls.length, 4);
    assert.equal(r.droppedIndices.length, 1);
    const sorted = [...r.rolls].sort((a, b) => b - a);
    assert.equal(r.total, sorted[0] + sorted[1] + sorted[2]);
    assert.ok(r.total >= 3 && r.total <= 18);
  }
});

test('4d6 drop lowest averages about 12.24', () => {
  const rng = seededRng(99); const n = 40000; let sum = 0;
  for (let i = 0; i < n; i++) sum += rollAbilityScore(rng).total;
  assert.ok(Math.abs(sum / n - 12.24) < 0.06, `mean ${sum / n}`);
});
