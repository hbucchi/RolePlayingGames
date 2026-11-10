import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ITEMS, ITEMS_BY_ID } from '../src/content/items/catalogue.js';
import {
  makeItem, addItem, removeItem, consume, countOf, splitCoins, formatCoins, carriedWeight, equipItem, gearStats,
  startingGear, itemName, itemRarity, weaponProficient,
} from '../src/engine/items.js';
import { levelForXp, XP_FOR_LEVEL, xpProgress, crowdMultiplier, rateEncounter, buildEncounter } from '../src/engine/progression.js';
import { rollCoins, rollMonsterLoot, rollChestLoot, rollMagicItem, magicChanceAfter, expectedDrops } from '../src/engine/loot.js';
import { lootProfileFor, LOOT_PROFILES } from '../src/content/items/loot-tables.js';
import { placeFeatures, populateDungeon, skillCheck, checkChance } from '../src/engine/features.js';
import { generateDungeon } from '../src/engine/dungeon.js';
import { seededRng } from '../src/engine/dice.js';
import { BESTIARY_BY_ID } from '../src/content/bestiary/index.js';
import { DUNGEON_FOES } from '../src/content/westlands/dungeon-foes.js';
import { getSetting } from '../src/content/registry.js';
import { deriveCharacter, ensureGear, gainXp, syncBaseFromAssignment } from '../src/engine/character.js';

const setting = getSetting('westlands');
const premade = (id) => syncBaseFromAssignment(structuredClone(setting.premades.find((p) => p.id === id)));

test('catalogue: every item is well formed and every kit and loot entry exists', () => {
  for (const it of ITEMS) {
    assert.ok(it.id && it.name && it.cat && it.desc, it.id);
    assert.ok(it.value >= 0 && it.weight >= 0, it.id);
    if (it.cat === 'weapon') assert.match(it.weapon.damage, /^\d+d\d+$/, it.id);
    if (it.icon) assert.match(it.icon, /^assets\/items\/[\w-]+\.jpg$/);
  }
  const ids = (k) => (Array.isArray(k) ? k[0] : k);
  for (const c of setting.classes) for (const k of c.kit) assert.ok(ITEMS_BY_ID[ids(k)] || ['traveller', 'burglar', 'scholar', 'entertainer'].includes(ids(k)), `${c.id}: ${ids(k)}`);
  for (const b of setting.backgrounds) for (const k of b.kit) assert.ok(ITEMS_BY_ID[ids(k)], `${b.id}: ${ids(k)}`);
  for (const [name, p] of Object.entries(LOOT_PROFILES)) for (const e of p.items) assert.ok(ITEMS_BY_ID[e.id], `${name}: ${e.id}`);
});

test('coins: copper totals split into the fewest coins', () => {
  assert.deepEqual(splitCoins(1234), { gp: 12, sp: 3, cp: 4 });
  assert.equal(formatCoins(1005), '10 gp, 5 cp');
  assert.equal(formatCoins(0), '0 cp');
});

test('inventory: stacks merge, removal and consumption work', () => {
  const inv = [];
  addItem(inv, makeItem('arrows', 10));
  addItem(inv, makeItem('arrows', 5));
  addItem(inv, makeItem('dagger'));
  addItem(inv, makeItem('dagger'));
  assert.equal(inv.length, 3); // arrows stack, daggers do not
  assert.equal(countOf(inv, 'arrows'), 15);
  assert.ok(consume(inv, 'arrows', 15));
  assert.equal(countOf(inv, 'arrows'), 0);
  assert.equal(consume(inv, 'arrows', 1), false);
  removeItem(inv, inv[0].uid);
  assert.equal(countOf(inv, 'dagger'), 1);
  // 50 coins weigh a pound
  assert.equal(carriedWeight([makeItem('longsword')], 5000), 3 + 1);
});

test('equipping: two-handed weapons free the off hand, and enchantments are named', () => {
  const gear = { inventory: [makeItem('shield'), makeItem('greatsword'), makeItem('longsword', 1, { bonus: 2 })], equipped: {} };
  equipItem(gear, gear.inventory[0].uid);
  assert.equal(gear.equipped.offHand, gear.inventory[0].uid);
  equipItem(gear, gear.inventory[1].uid);
  assert.equal(gear.equipped.mainHand, gear.inventory[1].uid);
  assert.equal(gear.equipped.offHand, undefined);
  assert.equal(itemName(gear.inventory[2]), 'Longsword of Power');
  assert.equal(itemRarity(gear.inventory[2]), 'rare');
});

test('gear stats: AC and attacks come from equipped items', () => {
  const mods = { str: 3, dex: 1, con: 2, int: 0, wis: 0, cha: 0 };
  const scores = { str: 16, dex: 12, con: 14, int: 10, wis: 10, cha: 10 };
  const gear = { inventory: [makeItem('chain-mail'), makeItem('shield'), makeItem('longsword', 1, { bonus: 1 })], equipped: {} };
  for (const x of gear.inventory) equipItem(gear, x.uid);
  const g = gearStats(gear, { mods, scores, pb: 2, weaponProfs: ['Martial weapons'], armorProfs: ['All armour', 'Shields'] });
  assert.equal(g.ac, 16 + 2); // heavy armour ignores DEX; shield +2
  const sword = g.attacks.find((a) => a.name === 'Longsword of Might');
  assert.equal(sword.toHit, 3 + 2 + 1);
  assert.equal(sword.damage, '1d8+4'); // one-handed with a shield: no versatile die
  assert.ok(weaponProficient(ITEMS_BY_ID.shortsword, ['Short swords']));
  assert.ok(!weaponProficient(ITEMS_BY_ID.longsword, ['Simple weapons']));
});

test('starting gear: classes get their kit, equipped', () => {
  const warrior = startingGear(setting.classes.find((c) => c.id === 'warrior'), setting.backgrounds[0]);
  const names = Object.values(warrior.equipped).map((u) => warrior.inventory.find((x) => x.uid === u).id).sort();
  assert.deepEqual(names, ['chain-mail', 'longsword', 'shield']);
  assert.ok(countOf(warrior.inventory, 'bandage') >= 5);
  const d = ensureGear(premade('premade-halric'), setting);
  const c = deriveCharacter(d, setting);
  assert.deepEqual(c.attacks.map((a) => a.name).sort(), ['Long knife', 'Longbow']);
  assert.equal(c.attacks.find((a) => a.name === 'Longbow').ammo, 'arrows');
});

test('experience: the 5e level table and level-ups', () => {
  assert.equal(levelForXp(0), 1);
  assert.equal(levelForXp(299), 1);
  assert.equal(levelForXp(300), 2);
  assert.equal(levelForXp(355000), 20);
  assert.deepEqual(xpProgress(600, 2), { into: 300, needed: 600, fraction: 0.5 });
  const d = ensureGear(premade('premade-brannoc'), setting);
  const hp1 = deriveCharacter(d, setting).maxHp;
  const r = gainXp(d, 300);
  assert.deepEqual([r.from, r.to], [1, 2]);
  assert.ok(deriveCharacter(d, setting).maxHp > hp1);
});

test('encounters: crowd multiplier and budgets', () => {
  assert.equal(crowdMultiplier(1), 1);
  assert.equal(crowdMultiplier(2), 1.5);
  assert.equal(crowdMultiplier(4), 2);
  // Two goblins (50 XP each) against one level 1 hero: 150 adjusted XP is deadly (>= 100).
  assert.equal(rateEncounter([50, 50], [1]).rating, 'deadly');
  assert.equal(rateEncounter([25], [1]).rating, 'easy');
  const pool = DUNGEON_FOES.map((id) => BESTIARY_BY_ID[id]);
  const rng = seededRng(3);
  for (let i = 0; i < 200; i++) {
    for (const level of [1, 3, 8, 15]) {
      const group = buildEncounter(level, pool, rng, { difficulty: 'medium' });
      assert.ok(group.length >= 1 && group.length <= 2);
      const rating = rateEncounter(group.map((m) => m.xp), [level]).rating;
      assert.ok(['trivial', 'easy', 'medium'].includes(rating), `level ${level}: ${group.map((m) => m.name)} is ${rating}`);
    }
  }
});

test('loot: coins by challenge rating, beasts carry no money, magic is rare', () => {
  const rng = seededRng(11);
  let low = 0; let high = 0;
  for (let i = 0; i < 300; i++) { low += rollCoins(0.25, rng); high += rollCoins(12, rng); }
  assert.ok(high > low * 50, 'high-CR creatures carry far more');
  const wolf = BESTIARY_BY_ID.wolf;
  assert.equal(lootProfileFor(wolf).coins, 0);
  for (let i = 0; i < 100; i++) assert.equal(rollMonsterLoot(wolf, rng).coins, 0);
  const goblin = BESTIARY_BY_ID.goblin;
  assert.equal(lootProfileFor(goblin).label, 'goblin');
  assert.equal(lootProfileFor(BESTIARY_BY_ID['dark-wood-spiderling']).label, 'spider');
  assert.ok(expectedDrops(goblin) > 1);
  // P(at least one magic item in 20 goblin kills) = 1 - (1 - p)^20, p = 1% x 1.0625
  const p = 0.01 * (1 + 0.25 / 4);
  assert.ok(Math.abs(magicChanceAfter(goblin, 20) - (1 - (1 - p) ** 20)) < 1e-12);
  // Simulated drop rate is close to the table's
  let magic = 0; const N = 20000;
  for (let i = 0; i < N; i++) if (rollMonsterLoot(goblin, rng).items.some((x) => x.bonus || ITEMS_BY_ID[x.id].magic)) magic++;
  assert.ok(Math.abs(magic / N - p) < 0.006, `observed ${magic / N}`);
  for (let i = 0; i < 50; i++) { const it = rollMagicItem(3, rng); assert.ok(it.bonus || ITEMS_BY_ID[it.id].magic || ITEMS_BY_ID[it.id].use?.kind === 'heal'); }
  for (let i = 0; i < 50; i++) { const l = rollChestLoot(1, rng); assert.ok(l.coins > 0 || l.items.length > 0); }
});

test('dungeon features: secret doors never cut off part of the dungeon', () => {
  let secrets = 0;
  for (let seed = 1; seed <= 25; seed++) {
    const map = generateDungeon(seed);
    const f = placeFeatures(map, seed, 1);
    secrets += f.secretDoors.size;
    for (const k of f.secretDoors) assert.ok(!f.locks.has(k));
    for (const c of f.chests) assert.ok(map.tiles[c.y][c.x] !== 0);
    for (const t of f.traps) assert.ok(!map.doors.some((d) => d.x === t.x && d.y === t.y));
    // Same seed, same secrets
    const g = placeFeatures(map, seed, 1);
    assert.deepEqual([...g.secretDoors], [...f.secretDoors]);
  }
  assert.ok(secrets > 0, 'some dungeons have secret doors');
});

test('dungeon population: level 1 meets weak foes, never more than 2 per room', () => {
  const pool = DUNGEON_FOES.map((id) => BESTIARY_BY_ID[id]);
  const map = generateDungeon(7);
  const ms = populateDungeon(map, 7, 1, pool);
  assert.ok(ms.every((m) => BESTIARY_BY_ID[m.statId].crValue <= 0.25));
  const perRoom = {};
  for (const m of ms) { const r = map.rooms.find((x) => m.pos.x >= x.x && m.pos.x < x.x + x.w && m.pos.y >= x.y && m.pos.y < x.y + x.h); perRoom[r.id] = (perRoom[r.id] ?? 0) + 1; }
  assert.ok(Object.values(perRoom).every((n) => n <= 2));
});

test('skill checks: the formula behind the percentages', () => {
  assert.equal(checkChance(0, 11), 0.5);
  assert.equal(checkChance(5, 10), 0.8);
  assert.equal(checkChance(10, 5), 1);
  const c = skillCheck(3, 15, { rng: () => 11 }); // d20 = 12
  assert.equal(c.total, 15); assert.ok(c.ok);
});
