/** The dungeon ladder (engine/dungeons.js): unlock in order, replays pay half. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DUNGEONS, loadProgress, markCompleted, isUnlocked, isCompleted, rewardShare, REPLAY } from '../src/engine/dungeons.js';

const memory = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)) }; };

test('ten dungeons, rising in level and depth, each with its own seed', () => {
  assert.equal(DUNGEONS.length, 10);
  for (let i = 1; i < DUNGEONS.length; i++) {
    assert.ok(DUNGEONS[i].level > DUNGEONS[i - 1].level, DUNGEONS[i].id);
    assert.ok(DUNGEONS[i].floors >= DUNGEONS[i - 1].floors && DUNGEONS[i].floors <= 10);
  }
  assert.equal(new Set(DUNGEONS.map((d) => d.seed)).size, 10);
});

test('the first is open; each next one opens when the one before is conquered; replays pay half', () => {
  const store = memory();
  let p = loadProgress(store);
  assert.ok(isUnlocked(DUNGEONS[0].id, p));
  assert.ok(!isUnlocked(DUNGEONS[1].id, p));
  assert.equal(rewardShare(DUNGEONS[0].id, p), 1);
  p = markCompleted(DUNGEONS[0].id, store);
  assert.ok(isCompleted(DUNGEONS[0].id, loadProgress(store)));
  assert.ok(isUnlocked(DUNGEONS[1].id, loadProgress(store)));
  assert.ok(!isUnlocked(DUNGEONS[2].id, loadProgress(store)));
  assert.equal(rewardShare(DUNGEONS[0].id, loadProgress(store)), REPLAY);
  markCompleted(DUNGEONS[0].id, store);
  assert.equal(loadProgress(store).completed[DUNGEONS[0].id], 2, 'counts every conquest');
});
