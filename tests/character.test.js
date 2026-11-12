import { test } from 'node:test';
import assert from 'node:assert/strict';
import { westlands } from '../src/content/westlands/index.js';
import {
  newDraft, validateStep, deriveCharacter, isComplete, proficiencyBonus, setAbilityMethod,
  syncBaseFromAssignment, pruneSkillChoices, armorClass, STEPS,
} from '../src/engine/character.js';
import { rollAbilityScore, seededRng } from '../src/engine/dice.js';
import { createRoster, exportCharacter, importCharacter } from '../src/engine/storage.js';

function dwarfWarrior() {
  const d = newDraft('westlands');
  Object.assign(d, { name: 'Brannoc', raceId: 'dwarf', subraceId: 'longbeard', classId: 'warrior', backgroundId: 'soldier' });
  setAbilityMethod(d, 'standard');
  d.abilityAssignment = { str: 0, con: 1, wis: 2, dex: 3, cha: 4, int: 5 }; // 15 14 13 12 10 8
  syncBaseFromAssignment(d);
  d.skillChoices = ['perception', 'history'];
  return d;
}

test('proficiency bonus by level', () => {
  assert.deepEqual([1, 4, 5, 8, 9, 13, 17, 20].map(proficiencyBonus), [2, 2, 3, 3, 4, 5, 6, 6]);
});

test('a fresh draft fails each step with a helpful message', () => {
  const d = newDraft('westlands');
  for (const step of STEPS) assert.ok(validateStep(step.id, d, westlands).length > 0, step.id);
});

test('subrace is required when a kindred has them', () => {
  const d = newDraft('westlands');
  d.raceId = 'elf';
  assert.match(validateStep('race', d, westlands)[0], /hail from/);
  d.subraceId = 'wood';
  assert.deepEqual(validateStep('race', d, westlands), []);
});

test('dwarf warrior derives the right numbers', () => {
  const d = dwarfWarrior();
  assert.ok(isComplete(d, westlands), validateStep('review', d, westlands).join('; '));
  const c = deriveCharacter(d, westlands);
  // CON 14 +2 dwarf = 16 (+3); WIS 13 +1 = 14 (+2); STR 15
  assert.equal(c.scores.con, 16);
  assert.equal(c.scores.wis, 14);
  assert.equal(c.mods.con, 3);
  // HP = d10 max (10) + CON 3 + Dwarven Toughness 1
  assert.equal(c.maxHp, 14);
  // Defence (defence.js): heavy armour lets no DEX count, so Evasion is 10; the shield blocks
  // 15% + 5% x proficiency 2 = 25%; the coat of mail absorbs 40% wherever it covers.
  assert.equal(c.ac, 10);
  assert.equal(c.defence.evasion, 10);
  assert.equal(c.defence.block, 25); assert.equal(c.defence.blockWith, 'shield');
  assert.equal(c.defence.armour.pct, 40); assert.equal(c.defence.armour.cover.chest, 22); assert.equal(c.defence.armour.cover['left-leg'], 7);
  assert.equal(c.defence.armour.cover.head, undefined, 'a coat of mail has no helm');
  const athletics = c.skills.find((s) => s.id === 'athletics');
  assert.equal(athletics.proficient, true);
  assert.equal(athletics.source, 'background');
  assert.equal(athletics.bonus, 2 + 2); // STR +2, proficiency +2
  assert.equal(c.savingThrows.find((s) => s.ability === 'con').bonus, 5);
  assert.equal(c.attacks[0].name, 'Longsword');
  assert.equal(c.attacks[0].toHit, 4);
  assert.equal(c.attacks[0].damage, '1d8+2');
  assert.equal(c.speed, 25);
  assert.equal(c.passivePerception, 10 + 2 + 2);
});

test('skill choices cannot duplicate granted skills', () => {
  const d = dwarfWarrior();
  d.skillChoices = ['athletics', 'perception']; // athletics comes from the Soldier background
  assert.ok(validateStep('skills', d, westlands).length > 0);
  pruneSkillChoices(d, westlands);
  assert.deepEqual(d.skillChoices, ['perception']);
});

test('rolled scores flow through assignment', () => {
  const d = dwarfWarrior();
  setAbilityMethod(d, 'roll');
  assert.ok(validateStep('abilities', d, westlands).some((e) => /Roll all six/.test(e)));
  const rng = seededRng(5);
  d.abilityRolls = d.abilityRolls.map(() => rollAbilityScore(rng));
  d.abilityAssignment = { str: 0, dex: 1, con: 2, int: 3, wis: 4, cha: 5 };
  syncBaseFromAssignment(d);
  assert.deepEqual(validateStep('abilities', d, westlands), []);
  assert.equal(d.baseAbilities.con, d.abilityRolls[2].total);
  d.abilityAssignment.dex = 0; // duplicate use of roll #0
  assert.ok(validateStep('abilities', d, westlands).some((e) => /only be placed once/.test(e)));
});

test('point buy over budget is rejected', () => {
  const d = dwarfWarrior();
  setAbilityMethod(d, 'pointbuy');
  assert.deepEqual(validateStep('abilities', d, westlands), []);
  d.baseAbilities = { str: 15, dex: 15, con: 15, int: 15, wis: 8, cha: 8 };
  assert.match(validateStep('abilities', d, westlands)[0], /more than 27/);
});

test('armour class rules', () => {
  assert.equal(armorClass([], 3), 13);
  assert.equal(armorClass([{ kind: 'armor', armor: { base: 11, dexCap: null } }], 4), 15);
  assert.equal(armorClass([{ kind: 'armor', armor: { base: 14, dexCap: 2 } }], 4), 16);
  assert.equal(armorClass([{ kind: 'armor', armor: { base: 16, dexCap: 0 } }, { kind: 'shield', acBonus: 2 }], 4), 18);
});

test('every premade hero is valid', () => {
  for (const p of westlands.premades) {
    const d = syncBaseFromAssignment(structuredClone(p));
    assert.deepEqual(validateStep('review', d, westlands), [], p.name);
  }
});

test('roster save / list / remove and import / export', () => {
  const mem = new Map();
  const roster = createRoster({ getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) });
  const d = dwarfWarrior();
  roster.save(d);
  roster.save({ ...d, name: 'Brannoc II' });
  assert.equal(roster.list().length, 1);
  assert.equal(roster.get(d.id).name, 'Brannoc II');
  const imported = importCharacter(exportCharacter(d));
  assert.notEqual(imported.id, d.id);
  assert.equal(imported.name, 'Brannoc');
  assert.throws(() => importCharacter('{"nope":1}'), /does not contain/);
  roster.remove(d.id);
  assert.equal(roster.list().length, 0);
});
