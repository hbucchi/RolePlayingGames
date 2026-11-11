import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveCharacter, applyLevelUp, pendingLevelUps, levelUpSummary, levelChoices, syncBaseFromAssignment } from '../src/engine/character.js';
import { getSetting } from '../src/content/registry.js';

const setting = getSetting('westlands');
const hero = (level) => { const d = syncBaseFromAssignment(structuredClone(setting.premades[0])); d.level = level; return d; };

test('choices come at the right levels: ASI at 4/8/12/16/19, a new skill at 3/7/11/15', () => {
  assert.deepEqual(levelChoices(4), { asi: true, skill: false });
  assert.deepEqual(levelChoices(3), { asi: false, skill: true });
  assert.deepEqual(levelChoices(2), { asi: false, skill: false });
  assert.deepEqual(pendingLevelUps(hero(8)), [3, 4, 7, 8]);
});

test('an Ability Score Improvement raises scores (max 20) and must spend exactly 2 points', () => {
  const d = hero(4);
  const dex = deriveCharacter(d, setting).scores.dex;
  assert.match(applyLevelUp(d, setting, 4, { abilities: { dex: 1 } }).join(), /exactly 2 points/);
  assert.deepEqual(applyLevelUp(d, setting, 4, { abilities: { dex: 1, con: 1 } }), []);
  assert.equal(deriveCharacter(d, setting).scores.dex, dex + 1);
  assert.equal(deriveCharacter({ ...d, level: 3 }, setting).scores.dex, dex, 'only counts once the level is reached');
  const strong = hero(4); strong.baseAbilities.str = 19;
  assert.match(applyLevelUp(strong, setting, 4, { abilities: { str: 2 } }).join(), /above 20/);
});

test('a trained skill becomes proficient; a known one is refused', () => {
  const d = hero(3);
  const c = deriveCharacter(d, setting);
  const known = c.skills.find((s) => s.proficient).id;
  const fresh = c.skills.find((s) => !s.proficient);
  assert.match(applyLevelUp(d, setting, 3, { skill: known }).join(), /already knows/);
  assert.deepEqual(applyLevelUp(d, setting, 3, { skill: fresh.id }), []);
  const after = deriveCharacter(d, setting).skills.find((s) => s.id === fresh.id);
  assert.equal(after.proficient, true);
  assert.equal(after.source, 'training');
  assert.deepEqual(pendingLevelUps(d), []);
});

test('the summary lists what changed', () => {
  const d = hero(5);
  const sum = levelUpSummary(d, setting, 4, 5);
  const labels = sum.lines.map((l) => l.label);
  assert.ok(labels.includes('Hit points'));
  assert.ok(labels.includes('Proficiency bonus'), 'level 5 raises proficiency to +3');
});
