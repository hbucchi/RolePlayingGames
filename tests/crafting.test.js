import { test } from 'node:test';
import assert from 'node:assert/strict';
import { craft, chances, effectiveSkill, targetSkill, countOf, gainChance, gainStep, materialChoices } from '../src/engine/crafting.js';
import { RECIPES, RECIPES_BY_ID } from '../src/content/crafting/recipes.js';
import { ITEMS_BY_ID } from '../src/content/items/catalogue.js';
import { makeItem, itemName, itemValue, gearStats, equipItem } from '../src/engine/items.js';
import { createSafe } from '../src/engine/safe.js';
import { heroDefence } from '../src/engine/defence.js';

const mem = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };
const sheet = { mods: { str: 4, dex: 4 }, features: [], proficiencyBonus: 6 }; // abilities do not matter
const dwarf = { ...sheet, features: [{ name: 'Smith-born', text: "You are proficient with smith's tools." }] };
/**
 * Scripted dice: craft() rolls rng(100) for the d100 (returns 0..99, so `d100 - 1`), then
 * rng(1000) for the chance to learn. `learn`: true always learns, false never.
 */
const dice = (d100, learn = false) => { let n = 0; return (sides) => (n++ === 0 ? d100 - 1 : sides === 1000 ? (learn ? 0 : 999) : 0); };
const ore = () => ({ inventory: [makeItem('iron-ore', 2), makeItem('coal', 1)], equipped: {} });

test('recipes: every input and output exists; every crafted thing comes from a known trade', () => {
  for (const r of RECIPES) {
    for (const i of r.inputs) assert.ok(ITEMS_BY_ID[i.id], `${r.id}: ${i.id}`);
    assert.ok(ITEMS_BY_ID[r.output.id], `${r.id} -> ${r.output.id}`);
    assert.ok(['smithing', 'woodcraft', 'leatherwork'].includes(r.skill));
  }
});

test('the chance depends only on the trade skill: 50% at the target, +1% a point, certain 50 above', () => {
  assert.deepEqual(chances(40, 40), { success: 0.5, superior: 0, failure: 0.5 });
  assert.equal(chances(60, 40).success, 0.7); assert.equal(chances(60, 40).superior, 0.1);
  assert.equal(chances(90, 40).success, 1); assert.equal(chances(100, 0).superior, 0.25, 'superior tops out at 25%');
  assert.equal(chances(0, 60).success, 0, 'fifty points short: not yet');
  assert.equal(targetSkill(RECIPES_BY_ID['smelt-iron']), 0);
  assert.equal(targetSkill(RECIPES_BY_ID['forge-plate'], 'mithral'), 95);
  assert.equal(targetSkill(RECIPES_BY_ID['forge-longsword'], 'mithral'), targetSkill(RECIPES_BY_ID['forge-longsword'], 'iron') + 45);
  // Abilities and level do not count; knowing the tools does (+5).
  assert.equal(effectiveSkill(sheet, { crafts: { smithing: 37 } }, 'smithing'), 37);
  assert.equal(effectiveSkill(dwarf, { crafts: { smithing: 37 } }, 'smithing'), 42);
});

test('an attempt: superior, success or failure on a d100', () => {
  const at = (d100, skill = 40) => { const d = ore(); d.crafts = { smithing: skill }; return { d, r: craft({ recipeId: 'smelt-iron', sheet, draft: d, rng: dice(d100) }) }; };
  // Skill 40 at a target of 0: 90% success, 20% superior.
  let { d, r } = at(15);
  assert.equal(r.outcome, 'superior'); assert.equal(countOf('iron-ingot', d), 2, 'a superior smelt yields double');
  ({ d, r } = at(80)); assert.equal(r.outcome, 'success'); assert.equal(countOf('iron-ingot', d), 1); assert.equal(countOf('iron-ore', d), 0);
  ({ d, r } = at(95)); assert.equal(r.outcome, 'fail'); assert.equal(countOf('iron-ore', d), 1, 'half the ore is saved'); assert.equal(countOf('coal', d), 0);
  const hard = { inventory: [makeItem('mithral-ingot', 14), makeItem('tanned-leather', 2)], equipped: {} };
  const no = craft({ recipeId: 'forge-plate', material: 'mithral', sheet, draft: hard, rng: dice(1) });
  assert.equal(no.ok, false); assert.match(no.message, /Too difficult/); assert.equal(countOf('mithral-ingot', hard), 14, 'nothing used');
});

test('the material chosen is what the piece is made of', () => {
  const d = { inventory: [makeItem('mithral-ingot', 3), makeItem('tanned-leather', 1), makeItem('steel-ingot', 3)], equipped: {}, crafts: { smithing: 70 } };
  assert.equal(materialChoices(RECIPES_BY_ID['forge-longsword'], d, null).find((m) => m.id === 'mithral').have, 3);
  const r = craft({ recipeId: 'forge-longsword', material: 'mithral', sheet, draft: d, rng: dice(40) }); // target 70: 50%
  assert.equal(r.outcome, 'success'); assert.equal(itemName(r.made), 'Mithral longsword');
  assert.equal(countOf('mithral-ingot', d), 0); assert.equal(countOf('steel-ingot', d), 3, 'only the chosen metal is used');
  const w = { inventory: [makeItem('yew-log', 3), makeItem('bowstring', 1)], equipped: {}, crafts: { woodcraft: 60 } };
  assert.equal(itemName(craft({ recipeId: 'carve-longbow', material: 'yew', sheet, draft: w, rng: dice(50) }).made), 'Yew longbow');
});

test('composite resources chain (ore -> iron -> steel), and the safe feeds the bench', () => {
  const safe = createSafe(mem());
  const d = { inventory: [], equipped: {}, crafts: { smithing: 50 } };
  const box = { inventory: [makeItem('iron-ore', 4), makeItem('coal', 4)], equipped: {} };
  for (const x of [...box.inventory]) safe.store(box, x.uid);
  assert.equal(countOf('iron-ore', d, safe), 4);
  craft({ recipeId: 'smelt-iron', sheet, draft: d, safe, rng: dice(50) });
  craft({ recipeId: 'smelt-iron', sheet, draft: d, safe, rng: dice(50) });
  assert.equal(countOf('iron-ingot', d), 2);
  assert.equal(craft({ recipeId: 'fold-steel', sheet, draft: d, safe, rng: dice(50) }).outcome, 'success');
  assert.equal(countOf('steel-ingot', d), 1); assert.equal(countOf('coal', d, safe), 0, 'coal taken from the safe');
});

test('practice: a chance to learn on every attempt, more from hard work and while green; never XP', () => {
  assert.equal(gainChance(0, 0.5), 0.75); assert.equal(gainChance(80, 0.5), 0.35);
  assert.equal(gainChance(50, 1), 0, 'what you cannot fail teaches nothing');
  assert.deepEqual([0, 29, 30, 59, 60, 89, 90].map(gainStep), [1, 1, 0.5, 0.5, 0.3, 0.3, 0.1]);
  const d = ore(); d.crafts = { smithing: 10 }; d.xp = 0;
  const r = craft({ recipeId: 'smelt-iron', sheet, draft: d, rng: dice(99, true) }); // fails, but learns
  assert.equal(r.outcome, 'fail'); assert.equal(r.gain, 1); assert.equal(d.crafts.smithing, 11);
  assert.equal(d.xp, 0, 'crafting never gives a hero experience');
  const e = ore(); e.crafts = { smithing: 10 };
  assert.equal(craft({ recipeId: 'smelt-iron', sheet, draft: e, rng: dice(1, false) }).gain, 0, 'and sometimes nothing is learned');
});

test('who makes what: the smith every weapon and armour; woodcraft bows and what they shoot', () => {
  for (const r of RECIPES) {
    const def = ITEMS_BY_ID[r.output.id];
    const bowish = /bow|bolts|arrows|bowstring/.test(r.output.id);
    if (bowish && r.skill !== 'leatherwork') assert.equal(r.skill, 'woodcraft', `${r.id}`);
    else if (['weapon', 'armor', 'shield'].includes(def.cat)) assert.equal(r.skill, 'smithing', `${r.id}`);
  }
});

test('superior pieces: +1 to hit and damage, +5% absorption, twice the value; not magic', () => {
  const sw = makeItem('longsword', 1, { quality: 'superior' });
  const plain = makeItem('longsword');
  assert.equal(itemName(sw), 'Superior longsword');
  assert.equal(itemValue(sw), 2 * itemValue(plain));
  const ctx = { mods: { str: 3, dex: 0 }, scores: { str: 16 }, pb: 2, weaponProfs: ['martial'], armorProfs: [] };
  const g = (inst) => { const d = { inventory: [inst], equipped: {} }; equipItem(d, inst.uid); return gearStats(d, ctx).attacks[0]; };
  const a = g(sw); const b = g(plain);
  assert.equal(a.toHit, b.toHit + 1); assert.notEqual(a.damage, b.damage); assert.equal(a.magic, false);
  const arm = (inst) => { const d = { inventory: [inst], equipped: {} }; equipItem(d, inst.uid); return heroDefence(d, {}).pieces[0].abs.slashing; };
  assert.equal(arm(makeItem('chain-mail', 1, { quality: 'superior' })), arm(makeItem('chain-mail')) + 5);
});
