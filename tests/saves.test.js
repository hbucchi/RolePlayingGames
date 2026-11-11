import { test } from 'node:test';
import assert from 'node:assert/strict';
import { upgrade, createStore, FORMATS, envelope } from '../src/engine/saves.js';
import { createRoster } from '../src/engine/storage.js';
import { newDraft } from '../src/engine/character.js';

const memory = (init = {}) => {
  const m = new Map(Object.entries(init));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), dump: () => Object.fromEntries(m) };
};

test('a bare (pre-envelope) roster upgrades to the current version and is written back once', () => {
  const old = [{ ...newDraft('westlands'), name: 'Old Timer' }];
  delete old[0].version;
  const be = memory({ 'rpg.roster.v1': JSON.stringify(old) });
  const roster = createRoster(be);
  assert.equal(roster.list()[0].name, 'Old Timer');
  assert.equal(roster.list()[0].version, 1);
  const saved = JSON.parse(be.dump()['rpg.roster.v1']);
  assert.equal(saved.format, 'rpg-roster');
  assert.equal(saved.version, FORMATS.roster.version);
});

test('migrations run one version at a time', () => {
  const fmt = { id: 't', version: 3, empty: () => [], migrations: { 1: (d) => d.map((x) => ({ ...x, b: 1 })), 2: (d) => d.map((x) => ({ ...x, c: x.b + 1 })) } };
  const r = upgrade(fmt, JSON.stringify([{ a: 0 }]));
  assert.deepEqual(r.data, [{ a: 0, b: 1, c: 2 }]);
  assert.equal(r.version, 3);
});

test('a save from a newer game is read but never overwritten', () => {
  const be = memory({ k: JSON.stringify({ format: 'rpg-arenas', version: 99, data: [{ id: 'x' }] }) });
  const store = createStore(be, 'k', FORMATS.arenas);
  assert.deepEqual(store.read(), [{ id: 'x' }]);
  assert.equal(store.write([]), false);
  assert.equal(JSON.parse(be.dump().k).version, 99);
});

test('unreadable data is set aside, not lost', () => {
  const be = memory({ k: '{not json' });
  assert.deepEqual(createStore(be, 'k', FORMATS.arenas).read(), []);
  assert.equal(be.dump()['k.broken'], '{not json');
});

test('current data round-trips unchanged', () => {
  const be = memory();
  const store = createStore(be, 'k', FORMATS.stories);
  store.write({ a: { scene: 'x' } });
  assert.equal(be.dump().k, envelope(FORMATS.stories, { a: { scene: 'x' } }));
  assert.deepEqual(store.read(), { a: { scene: 'x' } });
});
