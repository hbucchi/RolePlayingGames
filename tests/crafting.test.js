import { test } from 'node:test';
import assert from 'node:assert/strict';
import { craft, chances, craftBonus, recipeDc, countOf, skillGain, materialChoices } from '../src/engine/crafting.js';
import { RECIPES, RECIPES_BY_ID } from '../src/content/crafting/recipes.js';
import { ITEMS_BY_ID } from '../src/content/items/catalogue.js';
import { makeItem, itemName, itemValue, gearStats, equipItem } from '../src/engine/items.js';
import { createSafe } from '../src/engine/safe.js';
import { heroDefence } from '../src/engine/defence.js';

const mem = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };
const sheet = { mods: { str: 2, dex: 1 }, features: [], proficiencyBonus: 2 };
const dwarf = { ...sheet, features: [{ name: 'Smith-born', text: "You are proficient with smith's tools." }] };
/** A d20 that always shows `face` (rng(20) returns 0..19). */
const die = (face) => () => face - 1;

test('recipes: every input and output exists; every crafted thing comes from a known trade', () => {
  for (const r of RECIPES) {
    for (const i of r.inputs) assert.ok(ITEMS_BY_ID[i.id], `${r.id}: ${i.id}`);
    assert.ok(ITEMS_BY_ID[r.output.id], `${r.id} -> ${r.output.id}`);
    assert.ok(['smithing', 'woodcraft', 'leatherwork'].includes(r.skill));
  }
});

test('crafting: the roll is d20 + ability + rank/10 + tools; superior, success, a near miss and a botch', () => {
  assert.equal(craftBonus(sheet, { crafts: { smithing: 37 } }, 'smithing'), 2 + 3);
  assert.equal(craftBonus(dwarf, {}, 'smithing'), 2 + 2, "smith's tools add the proficiency bonus");
  const fresh = () => ({ inventory: [makeItem('iron-ore', 2), makeItem('coal', 1)], equipped: {} });
  let d = fresh(); let r = craft({ recipeId: 'smelt-iron', sheet, draft: d, rng: die(20) });
  assert.equal(r.outcome, 'superior'); assert.equal(countOf('iron-ingot', d), 2, 'a superior smelt yields double');
  d = fresh(); r = craft({ recipeId: 'smelt-iron', sheet, draft: d, rng: die(8) }); // 10 vs DC 8
  assert.equal(r.outcome, 'success'); assert.equal(countOf('iron-ingot', d), 1); assert.equal(countOf('iron-ore', d), 0);
  d = fresh(); r = craft({ recipeId: 'smelt-iron', sheet, draft: d, rng: die(4) }); // 6 vs 8: a near miss
  assert.equal(r.outcome, 'fail'); assert.equal(countOf('iron-ore', d), 1, 'half the ore is saved'); assert.equal(countOf('coal', d), 0);
  d = fresh(); r = craft({ recipeId: 'smelt-iron', sheet, draft: d, rng: die(1) });
  assert.equal(r.outcome, 'botch'); assert.equal(countOf('iron-ore', d) + countOf('coal', d), 0, 'a natural 1 ruins everything');
  const c = chances(2, 12); // need 10+: 55%
  assert.equal(c.success, 0.55); assert.equal(c.superior, 0.05);
});

test('crafting: the material chosen is what the piece is made of, and rarer metals are harder', () => {
  const d = { inventory: [makeItem('mithral-ingot', 3), makeItem('tanned-leather', 1), makeItem('steel-ingot', 3)], equipped: {}, crafts: { smithing: 50 } };
  const r0 = RECIPES_BY_ID['forge-longsword'];
  assert.equal(recipeDc(r0, 'mithral'), recipeDc(r0, 'iron') + 9);
  assert.equal(materialChoices(r0, d, null).find((m) => m.id === 'mithral').have, 3);
  const r = craft({ recipeId: 'forge-longsword', material: 'mithral', sheet: dwarf, draft: d, rng: die(19) }); // 19 + 2 + 5 + 2 = 28 vs DC 22
  assert.equal(r.outcome, 'success');
  assert.equal(r.made.material, 'mithral'); assert.equal(itemName(r.made), 'Mithral longsword');
  assert.equal(countOf('mithral-ingot', d), 0); assert.equal(countOf('steel-ingot', d), 3, 'only the chosen metal is used');
  // Woods for bows: a yew longbow.
  const w = { inventory: [makeItem('yew-log', 3), makeItem('bowstring', 1)], equipped: {} };
  const b = craft({ recipeId: 'carve-longbow', material: 'yew', sheet, draft: w, rng: die(19) });
  assert.equal(itemName(b.made), 'Yew longbow');
});

test('crafting: composite resources chain (ore -> iron -> steel), and the safe feeds the bench', () => {
  const safe = createSafe(mem());
  const d = { inventory: [], equipped: {} };
  const box = { inventory: [makeItem('iron-ore', 4), makeItem('coal', 4)], equipped: {} };
  for (const x of [...box.inventory]) safe.store(box, x.uid);
  assert.equal(countOf('iron-ore', d, safe), 4);
  craft({ recipeId: 'smelt-iron', sheet, draft: d, safe, rng: die(10) });
  craft({ recipeId: 'smelt-iron', sheet, draft: d, safe, rng: die(10) });
  assert.equal(countOf('iron-ingot', d), 2);
  const r = craft({ recipeId: 'fold-steel', sheet, draft: d, safe, rng: die(15) });
  assert.equal(r.outcome, 'success'); assert.equal(countOf('steel-ingot', d), 1);
  assert.equal(countOf('coal', d, safe), 0, 'coal taken from the safe');
});

test('crafting: the trade grows with worthwhile work, not with trivial work', () => {
  assert.equal(skillGain(0, 10, 8, true), 0, 'trivial: 95%+');
  assert.equal(skillGain(0, 2, 12, true), 1);
  assert.equal(skillGain(0, 2, 18, true), 2, 'a long shot teaches more');
  assert.equal(skillGain(0, 2, 12, false), 0.5);
  assert.equal(skillGain(60, 2, 12, true), 0.5, 'above 50 every gain is halved');
  const d = { inventory: [makeItem('iron-ore', 2), makeItem('coal', 1)], equipped: {} };
  craft({ recipeId: 'smelt-iron', sheet, draft: d, rng: die(12) });
  assert.equal(d.crafts.smithing, 1);
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

test('who makes what: the smith every weapon and armour; woodcraft bows and what they shoot', () => {
  for (const r of RECIPES) {
    const def = ITEMS_BY_ID[r.output.id];
    const bowish = /bow|bolts|arrows|bowstring/.test(r.output.id);
    if (bowish && r.skill !== 'leatherwork') assert.equal(r.skill, 'woodcraft', `${r.id}`);
    else if (['weapon', 'armor', 'shield'].includes(def.cat)) assert.equal(r.skill, 'smithing', `${r.id}`);
  }
});
