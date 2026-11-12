import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  slotsFor, unlockLevel, spellDice, cantripDice, addDice, spellCount, freshResources, manaFor, manaCost, MANA_COST, replenish, migrateResources,
  arcaneRecovery, skillXp, sneakAttackDice, attacksPerAction, concentrationDC, magicFor, casterInfo, inspirationDie,
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

test('mana: 2 crystals at level 1 up to 10 at level 20 (half casters up to 6)', () => {
  assert.equal(manaFor('full', 1), 2);
  assert.equal(manaFor('full', 3), 3);
  assert.equal(manaFor('full', 10), 6);
  assert.equal(manaFor('full', 20), 10);
  for (let l = 2; l <= 20; l++) assert.ok(manaFor('full', l) >= manaFor('full', l - 1), 'never shrinks');
  assert.equal(manaFor('half', 1), 0);
  assert.equal(manaFor('half', 2), 2);
  assert.equal(manaFor('half', 20), 6);
  assert.equal(manaFor(null, 20), 0);
});

test('mana costs: cantrips free, most spells 1, potent 2-3, the 9th circle 7', () => {
  assert.deepEqual(MANA_COST, [0, 1, 1, 2, 2, 3, 3, 4, 5, 7]);
  for (const sp of SPELLS) {
    const c = manaCost(sp);
    if (sp.level === 0) assert.equal(c, 0, sp.id);
    if (sp.level >= 1 && sp.level <= 2) assert.equal(c, 1, sp.id);
  }
  for (const id of ['blizzard', 'firestorm', 'meteor-swarm']) assert.equal(manaCost(SPELLS.find((x) => x.id === id)), 7, id);
});

test('mana comes back at a totem, an inn or a camp, with every ability use', () => {
  const mods = { str: 0, dex: 0, con: 2, int: 3, wis: 0, cha: 0 };
  const m = magicFor(cls('loremaster'), 3, mods);
  const hero = { level: 3, casterType: 'full', abilities: m.abilities, cls: 'loremaster' };
  const res = freshResources(hero);
  assert.deepEqual([res.mana, res.maxMana], [3, 3]);
  res.mana = 0; res.uses['words-of-command'] = 0;
  assert.equal(arcaneRecovery(res, 3), 1, 'arcane recovery: a quarter of the level, at least 1');
  assert.equal(replenish(res, hero), 2);
  assert.equal(res.mana, 3);
  assert.equal(res.uses['words-of-command'], 2);
  // An old save with spell slots becomes mana.
  const old = migrateResources({ slots: [1, 0], maxSlots: [4, 2], uses: {}, hitDice: 3 }, hero);
  assert.deepEqual([old.mana, old.maxMana], [3, 3]);
});

test('terrain: difficult squares cost double, deep water blocks, arenas round-trip', async () => {
  const { createArenaMap, paintTerrain, encodeTerrain, decodeArena, terrainCost } = await import('../src/engine/terrain.js');
  const { reachableSquares } = await import('../src/engine/movement.js');
  const map = createArenaMap(10, 5);
  for (let x = 2; x <= 3; x++) paintTerrain(map, x, 2, 'mud');
  paintTerrain(map, 5, 1, 'river'); paintTerrain(map, 5, 2, 'river'); paintTerrain(map, 5, 3, 'river');
  assert.equal(terrainCost(map, 2, 2), 2);
  const r = reachableSquares(map, { x: 1, y: 2 }, 20);
  assert.equal(r.get('3,2').cost, 3); // diagonal around the mud: 1 + 1 + 1 beats 2 + 2
  assert.equal(r.get('4,2').cost, 3);
  assert.ok(!r.has('6,2'), 'the river is a wall to walkers');
  const back = decodeArena(encodeTerrain(map));
  assert.deepEqual(back.terrain, map.terrain);
  assert.ok(!paintTerrain(map, 0, 0, 'grass'), 'the outer wall stays');
});

test('creature sizes: blocks, distance between blocks, reach and big movers', async () => {
  const { footprintOf, blockDistance, cellsOf } = await import('../src/engine/size.js');
  const { createMonster, entityDistance, reachOf } = await import('../src/engine/combat.js');
  const { BESTIARY_BY_ID } = await import('../src/content/bestiary/index.js');
  const { reachableSquares } = await import('../src/engine/movement.js');
  const { createArenaMap, paintTerrain } = await import('../src/engine/terrain.js');
  assert.equal(footprintOf(BESTIARY_BY_ID.goblin), 1);
  assert.equal(footprintOf(BESTIARY_BY_ID.ogre), 2);
  // Dragons are long: rectangles, not squares.
  assert.deepEqual(footprintOf(BESTIARY_BY_ID['young-red-dragon']), { w: 3, h: 2 });
  assert.deepEqual(footprintOf(BESTIARY_BY_ID['adult-red-dragon']), { w: 7, h: 5 });
  assert.deepEqual(footprintOf(BESTIARY_BY_ID['ancient-red-dragon']), { w: 10, h: 8 }); // Gargantuan: awe-inspiring
  assert.equal(footprintOf(BESTIARY_BY_ID['wyrmling-red-dragon']), 1);
  assert.deepEqual(footprintOf(BESTIARY_BY_ID.roc), { w: 10, h: 8, across: true }); // wings spread
  assert.equal(footprintOf(BESTIARY_BY_ID.kraken), 8); // other Gargantuan creatures: 8 x 8
  assert.equal(footprintOf(BESTIARY_BY_ID['shadowflame-tyrant']), 3); // thick body, wings to the sides
  assert.equal(cellsOf({ x: 1, y: 1 }, 2).length, 4);
  // A 2x2 troll at (5,5) and a hero at (7,5): the nearest troll square is (6,5), one square away.
  assert.equal(blockDistance({ x: 5, y: 5 }, 2, { x: 7, y: 5 }, 1), 1);
  assert.equal(blockDistance({ x: 5, y: 5 }, 2, { x: 9, y: 9 }, 1), 3);
  const troll = createMonster(BESTIARY_BY_ID['hill-troll'], 't', { x: 2, y: 2 });
  assert.equal(troll.size, 2);
  const ogre = createMonster(BESTIARY_BY_ID.ogre, 'o', { x: 2, y: 2 });
  assert.equal(entityDistance(ogre, { pos: { x: 4, y: 3 } }), 1);
  const giant = createMonster(BESTIARY_BY_ID['hill-giant'], 'g', { x: 2, y: 2 });
  assert.equal(reachOf(giant), 1); // melee needs touch: adjacent squares only
  // A 3x2 dragon facing east lies east-west; facing north it turns to 2x3.
  const { orientFor, rotated, isSquare } = await import('../src/engine/size.js');
  assert.deepEqual(orientFor({ w: 3, h: 2 }, 0), { w: 2, h: 3 });
  assert.deepEqual(orientFor({ w: 3, h: 2 }, 6), { w: 3, h: 2 });
  assert.deepEqual(rotated({ w: 4, h: 3 }), { w: 3, h: 4 });
  assert.ok(isSquare(2) && !isSquare({ w: 3, h: 2 }));
  assert.equal(cellsOf({ x: 0, y: 0 }, { w: 3, h: 2 }).length, 6);
  // A 3x2 block at (5,5) spans x 5..7, y 5..6: a hero at (8,7) is touching it diagonally.
  assert.equal(blockDistance({ x: 5, y: 5 }, { w: 3, h: 2 }, { x: 8, y: 7 }, 1), 1);
  assert.equal(blockDistance({ x: 5, y: 5 }, { w: 3, h: 2 }, { x: 5, y: 9 }, 1), 3);
  // A 2x2 creature cannot squeeze through a one-square gap.
  const map = createArenaMap(10, 8);
  for (let y = 1; y < 7; y++) if (y !== 3) paintTerrain(map, 5, y, 'wall');
  const small = reachableSquares(map, { x: 2, y: 2 }, 30);
  const big = reachableSquares(map, { x: 2, y: 2 }, 30, { size: 2 });
  assert.ok(small.has('7,3'));
  assert.ok(![...big.keys()].some((k) => Number(k.split(',')[0]) >= 6));
});
