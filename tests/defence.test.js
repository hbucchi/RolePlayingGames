import { test } from 'node:test';
import assert from 'node:assert/strict';
import { heroDefence, monsterDefence, absorbed, landChance, blockChanceVs, shieldBlock, parryBlock, ARMOUR_ABSORB, strike, coverage, wearArmour, effectiveAbsorb } from '../src/engine/defence.js';
import { makeItem, equipItem } from '../src/engine/items.js';
import { BESTIARY_BY_ID } from '../src/content/bestiary/index.js';
import { hitLocation, BODY_PARTS } from '../src/engine/body.js';

const kit = (...ids) => { const g = { inventory: [], equipped: {} }; for (const id of ids) { const it = makeItem(id); g.inventory.push(it); equipItem(g, it.uid); } return g; };

test('armour absorbs a percentage: 10 damage through 40% is 6', () => {
  assert.equal(absorbed(10, 40), 6);
  assert.equal(absorbed(10, 0), 10);
  assert.equal(absorbed(1, 55), 1, 'at least 1 gets through');
  assert.equal(ARMOUR_ABSORB['chain-mail'], 40); assert.equal(ARMOUR_ABSORB.plate, 55);
});

test('heroes: Evasion from DEX (capped by armour), block from shield or trained weapon', () => {
  const light = heroDefence(kit('leather', 'shortsword'), { dex: 3, pb: 2 });
  assert.equal(light.evasion, 13); assert.equal(light.block, parryBlock(2)); assert.equal(light.blockWith, 'parry');
  assert.equal(light.armour.pct, 10); assert.equal(light.armour.cover['left-arm'], 4); assert.equal(light.armour.cover['left-leg'], undefined);
  const heavy = heroDefence(kit('chain-mail', 'longsword', 'shield'), { dex: 2, pb: 2 });
  assert.equal(heavy.evasion, 10, 'heavy armour: no DEX'); assert.equal(heavy.block, shieldBlock(2)); assert.equal(heavy.blockWith, 'shield');
  assert.equal(heroDefence(kit('plate'), { dex: 0 }).armour.cover.head, 8, 'plate has a helm (8 of the head\'s 10 points)');
  assert.equal(heroDefence(kit('scale-mail'), { dex: 4 }).evasion, 12, 'medium armour: DEX at most +2');
  assert.equal(heroDefence(kit('leather', 'longsword'), { dex: 0, weaponTrained: () => false }).block, 0, 'no parry with an untrained weapon');
  assert.equal(heroDefence(kit('leather'), { dex: 1, magicEvasion: 1 }).evasion, 12, 'a ring of protection adds to Evasion');
});

test('the d100 strip: a roll inside the covered points meets armour, beyond them finds a gap', () => {
  // Left arm is 1-12; a leather jerkin covers 4 of it (rolls 1-4).
  const d = heroDefence(kit('leather'), { dex: 0 });
  assert.deepEqual(strike(d, 3), { part: 'left-arm', offset: 3, covered: true, pct: 10 });
  assert.deepEqual(strike(d, 7), { part: 'left-arm', offset: 7, covered: false, pct: 0 }, 'a 7 lands on the left arm, in the gap');
  assert.equal(strike(d, 95).part, 'head'); assert.equal(strike(d, 95).covered, false);
  assert.equal(coverage(d.armour), 18 + 10 + 4 + 4);
  assert.equal(coverage(heroDefence(kit('plate'), { dex: 0 }).armour), 96);
});

test('condition: worn armour absorbs less, and each blow wears it', () => {
  const g = kit('chain-mail'); g.inventory[0].condition = 50;
  const d = heroDefence(g, { dex: 0 });
  assert.equal(d.armour.absorb, 40); assert.equal(d.armour.condition, 50); assert.equal(d.armour.pct, 20);
  assert.equal(effectiveAbsorb(40, 100), 40);
  const fresh = heroDefence(kit('chain-mail'), { dex: 0 }).armour;
  wearArmour(fresh); assert.equal(fresh.condition, 99);
  wearArmour(fresh, true); assert.equal(fresh.condition, 96, 'a critical hit wears it by 3%');
});

test('monsters: worn armour from the stat block, natural armour all over, parry only with made weapons', () => {
  const gob = monsterDefence(BESTIARY_BY_ID.goblin);
  assert.equal(gob.evasion, 12); assert.equal(gob.blockWith, 'shield'); assert.equal(gob.block, 25);
  assert.equal(gob.armour.pct, 10); assert.equal(gob.armour.cover.head, undefined);
  const wolf = monsterDefence(BESTIARY_BY_ID.wolf);
  assert.equal(wolf.block, 0, 'jaws do not parry');
  assert.equal(coverage(wolf.armour), 100, 'natural armour covers the whole body');
});

test('blocking rules and the chance to land', () => {
  const shield = { block: 25, blockWith: 'shield' }; const parry = { block: 15, blockWith: 'parry' };
  assert.equal(blockChanceVs(shield, { ranged: true }), 0.25, 'shields stop arrows');
  assert.equal(blockChanceVs(parry, { ranged: true }), 0, 'you cannot parry an arrow');
  assert.equal(blockChanceVs(shield, { spell: true }), 0);
  assert.equal(blockChanceVs(shield, { unseen: true }), 0, 'not from behind or unaware');
  // 65% past Evasion, 25% blocked, criticals (5%) cannot be: 0.05 + 0.60 x 0.75 = 0.50
  assert.ok(Math.abs(landChance(0.65, 0.25) - 0.5) < 1e-9);
});

test('hit location: each part owns a stretch of the d100', () => {
  assert.equal(hitLocation(1), 'left-arm'); assert.equal(hitLocation(12), 'left-arm'); assert.equal(hitLocation(13), 'right-arm');
  assert.equal(hitLocation(91), 'head'); assert.equal(hitLocation(100), 'head');
  assert.deepEqual(BODY_PARTS.map((p) => [p.from, p.to]).at(-1), [91, 100]);
});
