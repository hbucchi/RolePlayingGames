import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pieceAbsorb, resistance, typeFactor, heroDefence, monsterDefence, absorbed, landChance, blockChanceVs, shieldBlock, parryBlock, ARMOUR_ABSORB, strike, coverage, wearArmour, effectiveAbsorb } from '../src/engine/defence.js';
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

test('heroes: Evasion from DEX minus armour hindrance, block from shield or trained weapon', () => {
  const light = heroDefence(kit('leather', 'shortsword'), { dex: 3, pb: 2 });
  assert.equal(light.evasion, 13); assert.equal(light.block, parryBlock(2)); assert.equal(light.blockWith, 'parry');
  assert.equal(light.armour.pct, 10); assert.equal(light.armour.cover['left-arm'], 4); assert.equal(light.armour.cover['left-leg'], undefined);
  const heavy = heroDefence(kit('chain-mail', 'longsword', 'shield'), { dex: 2, pb: 2 });
  assert.equal(heavy.evasion, 9, '10 + DEX 2 - hindrance 3'); assert.equal(heavy.moveLost, 1);
  assert.equal(heroDefence(kit('chain-mail'), { dex: 2, str: 16 }).moveLost, 0, 'STR 16 shrugs off a square');
  assert.equal(heroDefence(kit('plate'), { dex: 0 }).hinder, 5); assert.equal(heroDefence(kit('plate'), { dex: 0 }).moveLost, 2);
  assert.equal(heroDefence(kit('leather'), { dex: 0 }).hinder, 0, 'leather does not hinder');
  assert.equal(heroDefence(kit('mithral-shirt'), { dex: 3 }).evasion, 13, 'mithral does not hinder'); assert.equal(heavy.block, shieldBlock(2)); assert.equal(heavy.blockWith, 'shield');
  assert.equal(heroDefence(kit('plate'), { dex: 0 }).armour.cover.head, undefined, 'the helm is a separate piece');
  assert.equal(heroDefence(kit('plate', 'great-helm'), { dex: 0 }).pieces.length, 2);
  assert.equal(heroDefence(kit('scale-mail'), { dex: 4 }).evasion, 12, '10 + 4 - hindrance 2');
  assert.equal(heroDefence(kit('leather', 'longsword'), { dex: 0, weaponTrained: () => false }).block, 0, 'no parry with an untrained weapon');
  assert.equal(heroDefence(kit('leather'), { dex: 1, magicEvasion: 1 }).evasion, 12, 'a ring of protection adds to Evasion');
});

test('the d100 strip: a roll inside the covered points meets armour, beyond them finds a gap', () => {
  // Left arm is 1-12; a leather jerkin covers 4 of it (rolls 1-4).
  const d = heroDefence(kit('leather'), { dex: 0 });
  const s3 = strike(d, 3); assert.equal(s3.part, 'left-arm'); assert.equal(s3.offset, 3); assert.equal(s3.covered, true); assert.equal(s3.pct, 10);
  const s7 = strike(d, 7); assert.equal(s7.part, 'left-arm'); assert.equal(s7.covered, false, 'a 7 lands on the left arm, in the gap'); assert.equal(s7.pct, 0);
  assert.equal(strike(d, 95).part, 'head'); assert.equal(strike(d, 95).covered, false);
  assert.equal(coverage(d.armour), 18 + 10 + 4 + 4);
  assert.equal(coverage(heroDefence(kit('plate'), { dex: 0 }).armour), 82);
  assert.equal(coverage(heroDefence(kit('plate', 'great-helm', 'gauntlets'), { dex: 0 })), 100, 'plate, a great helm and gauntlets cover every point');
});

test('layers: pieces on the same part multiply; head, neck, hands get their own pieces', () => {
  const d = heroDefence(kit('chain-mail', 'steel-vambraces', 'iron-helm', 'steel-gorget'), { dex: 0 });
  // Left arm 1-12: mail covers 1-11, vambraces 1-8. A 5 meets both: layered, 1 - (1 - a) x (1 - b).
  const [mail, vamb] = [d.pieces.find((p) => p.slot === 'body'), d.pieces.find((p) => p.slot === 'arms')];
  const both = Math.round(100 * (1 - (1 - pieceAbsorb(mail) / 100) * (1 - pieceAbsorb(vamb) / 100)));
  assert.equal(strike(d, 5).pct, both); assert.equal(strike(d, 5).pieces.length, 2);
  assert.equal(strike(d, 10).pct, pieceAbsorb(mail), 'beyond the vambraces only the mail');
  assert.equal(strike(d, 12).pct, 0, 'the last point of the arm is a gap');
  assert.ok(strike(d, 92).covered, 'the helm covers the head: 91-97');
  assert.equal(strike(d, 99).covered, false, 'the face is open');
  assert.ok(strike(d, 89).pieces.length === 2, 'mail and gorget on the neck');
  assert.ok(d.hinder >= 4, 'more pieces, more hindrance');
});

test('condition: worn armour absorbs less, and each blow wears it', () => {
  const g = kit('chain-mail'); g.inventory[0].condition = 50;
  const d = heroDefence(g, { dex: 0 });
  assert.equal(d.armour.absorb, 40); assert.equal(d.armour.condition, 50); assert.equal(d.armour.pct, 25, 'edge 50% at half condition');
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
  assert.equal(coverage(wolf.armour), 93, 'natural armour covers all but the weak spots (throat and belly)');
  const dragon = monsterDefence(BESTIARY_BY_ID['adult-red-dragon']);
  assert.equal(typeFactor(dragon, 'fire'), 0, 'red dragons are immune to fire');
  const balor = monsterDefence(BESTIARY_BY_ID.balor);
  assert.equal(typeFactor(balor, 'slashing'), 0.5, 'mundane blades only half hurt a balor');
  assert.equal(typeFactor(balor, 'slashing', { magic: true }), 1);
  assert.equal(typeFactor(monsterDefence(BESTIARY_BY_ID.skeleton), 'bludgeoning'), 2, 'skeletons shatter');
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

test('local injuries: part health, multipliers to total HP, crippled parts', async () => {
  const { applyHit, partMax, injuryPenalties, healParts, isCrippled } = await import('../src/engine/injury.js');
  const e = { maxHp: 30, hp: 30 };
  assert.equal(partMax(30, 'neck'), 11); assert.equal(partMax(30, 'chest'), 18); assert.equal(partMax(30, 'left-leg'), 15);
  assert.equal(partMax(9, 'left-hand'), 4, 'never below 4');
  // 4 damage to the neck: the neck takes 4, total HP takes 8 (x2).
  let r = applyHit(e, 'neck', 4); assert.equal(r.total, 8); assert.equal(r.partLeft, 7);
  r = applyHit(e, 'head', 4); assert.equal(r.total, 6, 'head x1.5');
  r = applyHit(e, 'left-hand', 4); assert.equal(r.total, 2, 'hand x0.5');
  assert.equal(applyHit(e, 'chest', 0).total, 0, 'nothing through, nothing lost');
  // Cripple the neck: bleeding.
  r = applyHit(e, 'neck', 7); assert.equal(r.crippledNow, true); assert.equal(injuryPenalties(e).bleeding, true);
  // A lame leg costs 2 squares; a crippled weapon arm gives disadvantage.
  applyHit(e, 'right-leg', 99); applyHit(e, 'right-arm', 99);
  const p = injuryPenalties(e);
  assert.equal(p.moveLost, 2); assert.ok(p.attackDis.length); assert.equal(p.noParry, true);
  healParts(e, 100); assert.equal(isCrippled(e, 'neck'), false, 'healing mends parts');
});

test('materials: each piece has its own edge/point/blunt absorption and one against the elements; metals change it', async () => {
  const { absorbFor, rollMetal, METALS } = await import('../src/engine/materials.js');
  const { ARMOURS } = await import('../src/engine/defence.js');
  const mail = ARMOURS['chain-mail'].abs;
  assert.deepEqual(mail, { slashing: 50, piercing: 24, bludgeoning: 24, elemental: 12 });
  assert.equal(absorbFor({ abs: mail, metal: 'steel' }, 'slashing'), 50);
  assert.equal(absorbFor({ abs: mail, metal: 'steel' }, 'piercing'), 24);
  assert.equal(absorbFor({ abs: mail, metal: 'steel' }, 'fire'), 12, 'one figure for every element');
  assert.equal(absorbFor({ abs: mail, metal: 'steel' }, 'lightning'), 12);
  // Padded cloth is best against blunt blows.
  assert.ok(ARMOURS.padded.abs.bludgeoning > ARMOURS.padded.abs.piercing);
  // Bronze adds fire on top of the elemental figure; gold is soft; mithral stronger and lighter.
  assert.equal(absorbFor({ abs: mail, metal: 'bronze' }, 'fire'), 22);
  assert.equal(absorbFor({ abs: mail, metal: 'bronze' }, 'slashing'), 45);
  assert.ok(absorbFor({ abs: mail, metal: 'gold' }, 'slashing') < 50);
  assert.ok(METALS.mithral.weight < 1 && METALS.gold.weight > 1);
  assert.equal(absorbFor({ abs: mail, metal: 'steel', condition: 50 }, 'slashing'), 25, 'condition halves it');
  const g = kit('chain-mail'); g.inventory[0].material = 'bronze';
  const d = heroDefence(g, { dex: 0 });
  assert.match(d.armour.name, /^Bronze/);
  assert.ok(resistance(d, 'fire') > 0, 'elemental damage meets the armour overall');
  for (let i = 0; i < 50; i++) assert.ok(METALS[rollMetal(3)]);
});

test('body maps: four-legged beasts and spiders', async () => {
  const { bodyMapOf, strikeAt } = await import('../src/engine/body.js');
  assert.equal(bodyMapOf(BESTIARY_BY_ID.wolf), 'quadruped');
  assert.equal(bodyMapOf(BESTIARY_BY_ID['giant-spider']), 'arachnid');
  assert.equal(bodyMapOf(BESTIARY_BY_ID.goblin), 'humanoid');
  assert.equal(strikeAt(100, 'quadruped').part, 'head'); assert.equal(strikeAt(1, 'arachnid').part, 'leg-1');
  assert.equal(monsterDefence(BESTIARY_BY_ID.wolf).map, 'quadruped');
});
