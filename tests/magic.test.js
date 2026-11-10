import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  slotsFor, unlockLevel, spellDice, cantripDice, addDice, spellCount, freshResources, lowestSlot, shortRest, longRest,
  arcaneRecovery, wanderingCheck, skillXp, sneakAttackDice, attacksPerAction, concentrationDC, magicFor, casterInfo, inspirationDie,
} from '../src/engine/magic.js';
import { SPELLS, ABILITIES, SPELLS_BY_ID } from '../src/content/westlands/magic.js';
import { getSetting } from '../src/content/registry.js';
import { seededRng } from '../src/engine/dice.js';

const setting = getSetting('westlands');
const cls = (id) => setting.classes.find((c) => c.id === id);

test('spell content is well formed', () => {
  const ids = new Set();
  for (const sp of [...SPELLS, ...ABILITIES]) {
    assert.ok(!ids.has(sp.id), `duplicate ${sp.id}`); ids.add(sp.id);
    assert.ok(sp.name && sp.desc, sp.id);
    if (sp.kind === 'spell') {
      assert.ok(sp.level >= 0 && sp.level <= 9, sp.id);
      for (const c of sp.classes) assert.ok(cls(c)?.spellcasting, `${sp.id}: ${c} cannot cast`);
      if (sp.effect.dice) assert.match(sp.effect.dice, /^\d+d\d+(\+\d+)?$/, sp.id);
    } else assert.ok(cls(sp.class), sp.id);
  }
});

test('spell slots: full casters by level, half casters at half level from 2nd', () => {
  assert.deepEqual(slotsFor('full', 1), [2]);
  assert.deepEqual(slotsFor('full', 5), [4, 3, 2]);
  assert.deepEqual(slotsFor('full', 20), [4, 3, 3, 3, 3, 2, 2, 1, 1]);
  assert.deepEqual(slotsFor('half', 1), []);
  assert.deepEqual(slotsFor('half', 2), [2]);
  assert.deepEqual(slotsFor('half', 5), [4, 2]); // = full caster level 3
  assert.deepEqual(slotsFor(null, 10), []);
  assert.equal(unlockLevel('full', 3), 5); // Fireball at level 5
  assert.equal(unlockLevel('half', 2), 5);
  assert.equal(unlockLevel('half', 0), null); // half casters have no cantrips
});

test('dice scaling: cantrips grow with level, upcasting adds dice', () => {
  assert.equal(cantripDice('1d10', 1), '1d10');
  assert.equal(cantripDice('1d10', 5), '2d10');
  assert.equal(cantripDice('1d10', 17), '4d10');
  assert.equal(addDice('8d6', '1d6', 2), '10d6');
  assert.equal(addDice('10d6+40', '3d6', 1), '13d6+40');
  assert.equal(spellDice(SPELLS_BY_ID.fireball, 5, 9), '10d6');
  assert.equal(spellDice(SPELLS_BY_ID['fire-bolt'], 0, 11), '3d10');
  assert.equal(spellCount(SPELLS_BY_ID['magic-missile'], 3, 'count'), 5);
  assert.equal(spellCount(SPELLS_BY_ID['scorching-ray'], 2, 'rays'), 3);
});

test('class magic unlocks with level', () => {
  const mods = { str: 0, dex: 2, con: 1, int: 3, wis: 1, cha: 2 };
  const lm1 = magicFor(cls('loremaster'), 1, mods);
  assert.ok(lm1.spells.some((s) => s.id === 'fire-bolt'));
  assert.ok(!lm1.spells.some((s) => s.id === 'fireball'));
  assert.ok(magicFor(cls('loremaster'), 5, mods).spells.some((s) => s.id === 'fireball'));
  assert.equal(magicFor(cls('ranger'), 1, mods).spells.length, 0);
  assert.ok(magicFor(cls('ranger'), 2, mods).spells.some((s) => s.id === 'hunters-mark'));
  const war = magicFor(cls('warrior'), 2, mods);
  assert.deepEqual(war.abilities.map((a) => a.id), ['second-wind', 'action-surge']);
  assert.equal(war.abilities[1].maxUses, 1);
  assert.equal(magicFor(cls('warrior'), 17, mods).abilities.find((a) => a.id === 'action-surge').maxUses, 2);
  assert.equal(magicFor(cls('minstrel'), 1, mods).abilities[0].period, 'long');
  assert.equal(magicFor(cls('minstrel'), 5, mods).abilities[0].period, 'short');
  const info = casterInfo(cls('loremaster'), mods, 2);
  assert.deepEqual([info.dc, info.attack], [13, 5]); // 8 + 2 + 3, 2 + 3
});

test('class numbers: sneak attack, extra attack, inspiration, concentration', () => {
  assert.equal(sneakAttackDice(1), '1d6');
  assert.equal(sneakAttackDice(5), '3d6');
  assert.equal(attacksPerAction('warrior', 4), 1);
  assert.equal(attacksPerAction('warrior', 5), 2);
  assert.equal(attacksPerAction('warrior', 20), 4);
  assert.equal(attacksPerAction('loremaster', 20), 1);
  assert.equal(inspirationDie(10), 'd10');
  assert.equal(concentrationDC(8), 10);
  assert.equal(concentrationDC(30), 15);
  assert.equal(skillXp(10, 1), 5);
  assert.equal(skillXp(15, 4), 30);
});

test('rests: hit dice heal on a short rest, a long rest restores everything', () => {
  const mods = { str: 0, dex: 0, con: 2, int: 3, wis: 0, cha: 0 };
  const m = magicFor(cls('loremaster'), 3, mods);
  const hero = { level: 3, casterType: 'full', abilities: m.abilities, cls: 'loremaster', hitDie: 6, conMod: 2 };
  const res = freshResources(hero);
  assert.deepEqual(res.slots, [4, 2]);
  assert.equal(lowestSlot(res, 1), 1);
  res.slots = [0, 0];
  assert.equal(lowestSlot(res, 1), -1);
  assert.deepEqual(arcaneRecovery(res, 3), [2]); // ceil(3/2) = 2 levels: one 2nd-level slot
  res.uses['words-of-command'] = 0;
  const r = shortRest(res, hero, 5, 20, seededRng(4));
  assert.ok(r.healed > 0 && r.rolls.length >= 1 && res.hitDice === 3 - r.rolls.length);
  assert.equal(res.uses['words-of-command'], 0); // long-rest ability: still spent
  longRest(res, hero);
  assert.deepEqual(res.slots, [4, 2]);
  assert.equal(res.uses['words-of-command'], 2);
});

test('wandering monsters interrupt about 1 in 6 short rests and 1 in 3 long rests', () => {
  const rng = seededRng(9); const N = 6000;
  let short = 0; let long = 0;
  for (let i = 0; i < N; i++) { if (wanderingCheck('short', rng).interrupted) short++; if (wanderingCheck('long', rng).interrupted) long++; }
  assert.ok(Math.abs(short / N - 1 / 6) < 0.02, `${short / N}`);
  assert.ok(Math.abs(long / N - 1 / 3) < 0.02, `${long / N}`);
});
