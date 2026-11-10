import { test } from 'node:test';
import assert from 'node:assert/strict';
import { monsterPowers, freshMonsterUses, canUse, spend, rollRecharge, areaCells, parseAura, parseAreaAction } from '../src/engine/monster-magic.js';
import { terrainCost } from '../src/engine/terrain.js';
import { BESTIARY_BY_ID as B } from '../src/content/bestiary/index.js';
import { seededRng } from '../src/engine/dice.js';

const names = (id) => monsterPowers(B[id]).map((p) => p.name);

test('casters, dragons and fiends get their magic from the stat block', () => {
  assert.ok(names('mage').includes('Fireball') && names('mage').includes('Fire Bolt'));
  assert.ok(names('mage').includes('Cone of Cold'));
  const breath = monsterPowers(B['adult-red-dragon']).find((p) => p.name === 'Fire Breath');
  assert.deepEqual([breath.shape, breath.size, breath.save, breath.dc, breath.dice, breath.recharge, breath.linger], ['cone', 12, 'dex', 21, '18d6', 5, 'fire']);
  assert.equal(monsterPowers(B['young-white-dragon']).find((p) => /Breath/.test(p.name)).linger, 'ice');
  assert.deepEqual(parseAura(B['shadowflame-tyrant'].traits), { name: 'Mantle of Shadow and Flame', size: 2, dice: '4d6', type: 'fire' });
  assert.equal(parseAreaAction({ name: 'Bite', text: 'Melee Weapon Attack: +4 to hit.' }), null);
});

test('slots, recharge and daily uses are spent and come back', () => {
  const powers = monsterPowers(B.mage); const uses = freshMonsterUses(B.mage, powers);
  const fireball = powers.find((p) => p.name === 'Fireball');
  let cast = 0; for (let i = 0; i < 10; i++) if (canUse(fireball, uses)) { spend(fireball, uses); cast++; }
  assert.equal(cast, 7); // any slot of 3rd level or higher: 3 + 3 + 1
  assert.equal(canUse(fireball, uses), false);
  assert.ok(canUse(powers.find((p) => p.name === 'Fire Bolt'), uses)); // cantrips never run out
  const dp = monsterPowers(B['adult-red-dragon']); const du = freshMonsterUses(B['adult-red-dragon'], dp);
  const br = dp.find((p) => p.recharge); spend(br, du); assert.equal(canUse(br, du), false);
  // Recharge 5-6 comes back on 2 faces of 6: about a third of turns.
  const rng = seededRng(3); let back = 0;
  for (let i = 0; i < 6000; i++) { du.ready[br.id] = false; if (rollRecharge([br], du, rng).length) back++; }
  assert.ok(Math.abs(back / 6000 - 1 / 3) < 0.02, `${back / 6000}`);
});

test('area shapes: bursts, cones as wide as they are long, one-square lines', () => {
  const caster = { pos: { x: 10, y: 10 }, size: 1 };
  const ok = () => true;
  assert.equal(areaCells({ shape: 'radius', size: 1 }, caster, { x: 20, y: 20 }, ok).length, 9);
  const cone = areaCells({ shape: 'cone', size: 6 }, caster, { x: 20, y: 10 }, ok);
  assert.ok(cone.every((c) => c.x > 10) && cone.some((c) => c.x === 16 && Math.abs(c.y - 10) === 3));
  const line = areaCells({ shape: 'line', size: 5 }, caster, { x: 10, y: 0 }, ok);
  assert.deepEqual(line.map((c) => `${c.x},${c.y}`).sort(), ['10,5', '10,6', '10,7', '10,8', '10,9'].sort());
});

test('magic ground: ice and rubble double the cost of a square for a while', () => {
  const map = { temp: new Map([['3,4', 2]]) };
  assert.equal(terrainCost(map, 3, 4), 2);
  assert.equal(terrainCost(map, 1, 1), 1);
});
