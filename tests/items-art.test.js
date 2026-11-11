import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { ITEMS } from '../src/content/items/catalogue.js';

test('every item has a picture on disk', () => {
  const missing = ITEMS.filter((i) => !i.icon || !fs.existsSync(new URL(`../${i.icon}`, import.meta.url))).map((i) => i.id);
  assert.deepEqual(missing, []);
});

test('item ids are unique (one id, one item)', () => {
  const seen = new Set(); const dup = [];
  for (const i of ITEMS) { if (seen.has(i.id)) dup.push(i.id); seen.add(i.id); }
  assert.deepEqual(dup, []);
});

test('every item has a weight', () => {
  assert.deepEqual(ITEMS.filter((i) => !(i.weight > 0)).map((i) => i.id), []);
});
