import { test } from 'node:test';
import assert from 'node:assert/strict';
import { craft, chances, craftBonus, recipeDc, minLevel, tradeLevel, tradeXpFor, TRADE_XP, countOf, materialChoices } from '../src/engine/crafting.js';
import { RECIPES, RECIPES_BY_ID } from '../src/content/crafting/recipes.js';
import { ITEMS_BY_ID } from '../src/content/items/catalogue.js';
import { makeItem, itemName, itemValue, gearStats, equipItem } from '../src/engine/items.js';
import { createSafe } from '../src/engine/safe.js';
import { heroDefence } from '../src/engine/defence.js';

const mem = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };
const sheet = { mods: { str: 4, dex: 4 }, features: [], proficiencyBonus: 6 }; // abilities do not matter
const dwarf = { ...sheet, features: [{ name: 'Smith-born', text: "You are proficient with smith's tools." }] };
/** A d20 that always shows `face` (rng(20) returns 0..19). */
const die = (face) => () => face - 1;
/** A hero with trade experience enough for a level. */
const at = (skill, level, inv = []) => ({ inventory: inv, equipped: {}, trades: { [skill]: TRADE_XP[level] } });
const ore = () => ({ inventory: [makeItem('iron-ore', 2), makeItem('coal', 1)], equipped: {} });

test('recipes: every input and output exists; every crafted thing comes from a known trade', () => {
  for (const r of RECIPES) {
    for (const i of r.inputs) assert.ok(ITEMS_BY_ID[i.id], `${r.id}: ${i.id}`);
    assert.ok(ITEMS_BY_ID[r.output.id], `${r.id} -> ${r.output.id}`);
    assert.ok(['smithing', 'woodcraft', 'leatherwork'].includes(r.skill));
  }
});

test('trade levels 1-20: d20 + level (+2 tools) vs DC; each recipe needs a level, and gets easier above it', () => {
  assert.equal(tradeLevel({}, 'smithing'), 1);
  assert.equal(tradeLevel({ trades: { smithing: TRADE_XP[7] } }, 'smithing'), 7);
  assert.equal(tradeLevel({ trades: { smithing: 1e9 } }, 'smithing'), 20);
  assert.equal(craftBonus(sheet, at('smithing', 7), 'smithing'), 7, 'abilities and hero level do not count');
  assert.equal(craftBonus(dwarf, at('smithing', 7), 'smithing'), 9, "smith's tools: +2");
  assert.equal(minLevel(RECIPES_BY_ID['smelt-iron']), 1);
  assert.equal(minLevel(RECIPES_BY_ID['forge-plate'], 'iron'), 6);
  assert.equal(minLevel(RECIPES_BY_ID['forge-plate'], 'mithral'), 15);
  // At the level it needs: 45%; five levels on: 70%.
  const dc = recipeDc(RECIPES_BY_ID['forge-plate'], 'mithral');
  assert.equal(chances(15, dc).success, 0.45); assert.equal(chances(20, dc).success, 0.7);
  assert.equal(chances(20, 9).success, 0.95, 'never certain');
});

test('an attempt: superior, success or failure on a d20; too hard is refused', () => {
  const run = (face) => { const d = at('smithing', 1, [makeItem('iron-ore', 2), makeItem('coal', 1)]); return { d, r: craft({ recipeId: 'smelt-iron', sheet, draft: d, rng: die(face) }) }; };
  let { d, r } = run(20);
  assert.equal(r.outcome, 'superior'); assert.equal(countOf('iron-ingot', d), 2, 'a superior smelt yields double');
  ({ d, r } = run(10)); assert.equal(r.outcome, 'success'); assert.equal(countOf('iron-ingot', d), 1); assert.equal(countOf('iron-ore', d), 0);
  ({ d, r } = run(5)); assert.equal(r.outcome, 'fail'); assert.equal(countOf('iron-ore', d), 1, 'half the ore is saved'); assert.equal(countOf('coal', d), 0);
  ({ d, r } = run(1)); assert.equal(r.outcome, 'fail', 'a natural 1 fails');
  const hard = at('smithing', 10, [makeItem('mithral-ingot', 14), makeItem('tanned-leather', 2)]);
  const no = craft({ recipeId: 'forge-plate', material: 'mithral', sheet, draft: hard, rng: die(20) });
  assert.equal(no.ok, false); assert.match(no.message, /level 15/); assert.equal(countOf('mithral-ingot', hard), 14, 'nothing used');
});

test('the material chosen is what the piece is made of', () => {
  const d = at('smithing', 12, [makeItem('mithral-ingot', 3), makeItem('tanned-leather', 1), makeItem('steel-ingot', 3)]);
  assert.equal(materialChoices(RECIPES_BY_ID['forge-longsword'], d, null).find((m) => m.id === 'mithral').have, 3);
  const r = craft({ recipeId: 'forge-longsword', material: 'mithral', sheet, draft: d, rng: die(12) }); // 24 vs DC 22
  assert.equal(r.outcome, 'success'); assert.equal(itemName(r.made), 'Mithral longsword');
  assert.equal(countOf('mithral-ingot', d), 0); assert.equal(countOf('steel-ingot', d), 3, 'only the chosen metal is used');
  const w = at('woodcraft', 5, [makeItem('yew-log', 3), makeItem('bowstring', 1)]);
  assert.equal(itemName(craft({ recipeId: 'carve-longbow', material: 'yew', sheet, draft: w, rng: die(15) }).made), 'Yew longbow');
});

test('composite resources chain (ore -> iron -> steel), and the safe feeds the bench', () => {
  const safe = createSafe(mem());
  const d = at('smithing', 5);
  const box = { inventory: [makeItem('iron-ore', 4), makeItem('coal', 4)], equipped: {} };
  for (const x of [...box.inventory]) safe.store(box, x.uid);
  assert.equal(countOf('iron-ore', d, safe), 4);
  craft({ recipeId: 'smelt-iron', sheet, draft: d, safe, rng: die(10) });
  craft({ recipeId: 'smelt-iron', sheet, draft: d, safe, rng: die(10) });
  assert.equal(countOf('iron-ingot', d), 2);
  assert.equal(craft({ recipeId: 'fold-steel', sheet, draft: d, safe, rng: die(10) }).outcome, 'success');
  assert.equal(countOf('steel-ingot', d), 1); assert.equal(countOf('coal', d, safe), 0, 'coal taken from the safe');
});

test('trade experience: the DC on a success, half on a failure, none for sure work; never hero XP', () => {
  assert.equal(tradeXpFor(12, true, 0.5), 12); assert.equal(tradeXpFor(12, false, 0.5), 6); assert.equal(tradeXpFor(12, true, 0.95), 0);
  assert.deepEqual([2, 5, 10, 20].map((l) => TRADE_XP[l]), [60, 600, 2700, 11400]);
  const d = at('smithing', 1, [makeItem('iron-ore', 2), makeItem('coal', 1)]); d.xp = 0;
  const r = craft({ recipeId: 'smelt-iron', sheet, draft: d, rng: die(15) });
  assert.equal(r.gain, 8); assert.equal(d.trades.smithing, 8); assert.equal(d.xp, 0, 'crafting never gives a hero experience');
  const e = at('smithing', 1, [makeItem('iron-ore', 16), makeItem('coal', 8)]); e.trades.smithing = 55;
  const up = craft({ recipeId: 'smelt-iron', sheet, draft: e, rng: die(15) });
  assert.equal(up.levelUp, 2, 'a new trade level');
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
