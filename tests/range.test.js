import { test } from 'node:test';
import assert from 'node:assert/strict';
import { playRange, spellRange, RANGE_CAP } from '../src/engine/range.js';
import { weaponFromMonsterAction, createMonster, planMonsterTurn } from '../src/engine/combat.js';
import { BESTIARY, BESTIARY_BY_ID } from '../src/content/bestiary/index.js';
import { SPELLS } from '../src/content/westlands/magic.js';
import { MONSTER_SPELLS, powerRange } from '../src/engine/monster-magic.js';
import { createArenaMap } from '../src/engine/terrain.js';

test('ranges fit the map: nothing shoots across the whole dungeon', () => {
  assert.deepEqual(playRange(30, 120), [8, 16]);            // longbow
  assert.deepEqual(playRange(6, 24, { thrown: true }), [6, 8]); // javelin
  assert.deepEqual(playRange(4, 12, { thrown: true }), [4, 8]); // dagger
  for (const m of BESTIARY) for (const a of m.actions.filter((x) => x.attack?.damage?.length)) {
    const w = weaponFromMonsterAction(a);
    assert.ok(w.long <= RANGE_CAP.long, `${m.id} ${a.name} reaches ${w.long}`);
  }
  for (const sp of SPELLS) assert.ok(sp.range <= RANGE_CAP.spell, `${sp.id} reaches ${sp.range}`);
  for (const p of Object.values(MONSTER_SPELLS)) assert.ok(powerRange(p) <= RANGE_CAP.spell);
  assert.equal(spellRange(1), 1, 'touch stays touch');
});

test('an ogre charges with its club instead of standing back throwing javelins', () => {
  const map = createArenaMap(16, 10, 'floor');
  const ogre = createMonster(BESTIARY_BY_ID.ogre, 'o1', { x: 2, y: 5 });
  const hero = { pos: { x: 9, y: 5 }, size: 1 };
  const plan = planMonsterTurn({ m: ogre, hero, map, opaque: () => false, blocked: new Set(), rng: () => 99 });
  assert.equal(plan[0].type, 'move');
  const attack = plan.find((st) => st.type === 'attack');
  assert.ok(!attack || attack.weapon.name === 'Greatclub' || attack.weapon.thrown, 'closes in first');
  const jav = ogre.weapons.find((w) => w.name === 'Javelin');
  assert.equal(jav.throws, 2, 'carries two javelins');
});

test('archers keep shooting; out of javelins means melee only', () => {
  const map = createArenaMap(16, 10, 'floor');
  const goblin = createMonster(BESTIARY_BY_ID.goblin, 'g1', { x: 2, y: 5 });
  const hero = { pos: { x: 8, y: 5 }, size: 1 };
  const plan = planMonsterTurn({ m: goblin, hero, map, opaque: () => false, blocked: new Set(), rng: () => 99 });
  assert.deepEqual(plan.map((st) => st.type), ['attack']);
  assert.match(plan[0].weapon.name, /bow/i);
  const ogre = createMonster(BESTIARY_BY_ID.ogre, 'o2', { x: 2, y: 5 });
  ogre.weapons.find((w) => w.name === 'Javelin').throws = 0;
  const far = planMonsterTurn({ m: ogre, hero: { pos: { x: 14, y: 5 }, size: 1 }, map, opaque: () => false, blocked: new Set(), rng: () => 99 });
  assert.ok(!far.some((st) => st.type === 'attack' && st.weapon.name === 'Javelin'));
});

import { rangedCover } from '../src/engine/vision.js';
test('cover: shots past corners are harder, blocked lines are impossible', () => {
  const walls = (list) => { const W = new Set(list.map(([x, y]) => `${x},${y}`)); return (x, y) => W.has(`${x},${y}`); };
  const cases = [
    [{ x: 0, y: 0 }, { x: 1, y: 1 }, [[1, 0]], 'half'],                    // diagonal, behind one corner
    [{ x: 0, y: 0 }, { x: 3, y: 3 }, [[1, 0]], 'half'],                    // diagonal past a corner, farther
    [{ x: 0, y: 0 }, { x: 1, y: 1 }, [[1, 0], [0, 1]], 'total'],           // squeezing between two walls
    [{ x: 0, y: 0 }, { x: 2, y: 1 }, [[1, 0]], 'half'],                    // peeking around a corner
    [{ x: 0, y: 2 }, { x: 5, y: 0 }, [[2, 1], [2, 0]], 'three-quarters'],  // through a doorway's edge
    [{ x: 0, y: 0 }, { x: 4, y: 0 }, [[2, 0]], 'total'],                   // behind a pillar
    [{ x: 0, y: 0 }, { x: 3, y: 3 }, [], 'none'],                          // open ground
    [{ x: 0, y: 1 }, { x: 5, y: 1 }, [[1, 0], [2, 0], [3, 0]], 'none'],    // along a wall, not past it
  ];
  for (const [a, b, w, want] of cases) assert.equal(rangedCover([a], [b], walls(w)), want, `${JSON.stringify(a)} -> ${JSON.stringify(b)}`);
  // A creature in the way gives half cover on open ground.
  assert.equal(rangedCover([{ x: 0, y: 0 }], [{ x: 4, y: 0 }], walls([]), new Set(['2,0'])), 'half');
});
