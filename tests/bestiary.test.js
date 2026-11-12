import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BESTIARY } from '../src/content/bestiary/index.js';
import { validateMonster, averageRoll, crValue, CR_TABLE, buildMonster, filterMonsters } from '../src/engine/monsters.js';

test('every monster passes validation', () => {
  const issues = BESTIARY.flatMap(validateMonster);
  assert.deepEqual(issues, []);
});

test('monster ids are unique', () => {
  const ids = BESTIARY.map((m) => m.id);
  const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
  assert.deepEqual(dupes, []);
});

test('average hit points follow the dice formula', () => {
  assert.equal(averageRoll('2d6'), 7);
  assert.equal(averageRoll('9d8+18'), 58);
  assert.equal(averageRoll('2d6-2'), 5);
  assert.equal(averageRoll('33d20+330'), 676);
});

test('challenge ratings map to XP and proficiency', () => {
  assert.equal(crValue('1/4'), 0.25);
  assert.equal(CR_TABLE['1/4'].xp, 50);
  assert.equal(CR_TABLE[5].pb, 3);
  assert.equal(CR_TABLE[30].xp, 155000);
});

test('goblin builds into a full stat block', () => {
  const g = BESTIARY.find((m) => m.id === 'goblin');
  assert.equal(g.hp, 7);
  assert.equal(g.xp, 50);
  assert.equal(g.passivePerception, 9);
  assert.match(g.actions[0].text, /Melee Weapon Attack: \+4 to hit, reach 5 ft\., one target\. Hit: 5 \(1d6 \+ 2\) slashing damage\./);
});

test('validation catches inconsistent hit dice', () => {
  const bad = buildMonster({ name: 'Bad', size: 'Medium', type: 'beast', ac: 12, hp: '2d8+5', ab: [10, 10, 14, 10, 10, 10], cr: '1', lore: { personality: 'x', origin: 'x', tactics: 'x' } });
  assert.ok(validateMonster(bad).some((i) => /hit dice bonus/.test(i)));
});

test('filtering by type and CR', () => {
  const low = filterMonsters(BESTIARY, { type: 'humanoid', maxCr: 0.25 });
  assert.ok(low.length > 0 && low.every((m) => m.type === 'humanoid' && m.crValue <= 0.25));
});

test('tuning: heavy hitters rebalanced for these rules, and the printed stat block follows', async () => {
  const { BESTIARY_BY_ID: B } = await import('../src/content/bestiary/index.js');
  const sword = B['storm-giant'].actions.find((a) => a.name === 'Greatsword');
  assert.equal(sword.attack.damage[0].dice, '4d6+9');
  assert.match(sword.text, /\(4d6 \+ 9\)/);
  assert.equal(B.gladiator.actions.find((a) => a.name === 'Multiattack').text, 'Makes two melee attacks.');
  assert.ok(B.gladiator.hp < 112);
});
