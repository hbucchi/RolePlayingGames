import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TILE, generateDungeon } from '../src/engine/dungeon.js';
import { makeOpacity, lineOfSight, visibleSquares, revealFrom, coverBetween, cellKey } from '../src/engine/vision.js';
import {
  isBehind, facingToward, hitChance, rollMode, critNotation, resolveAttack, weaponFromHeroAttack,
  placeMonsters, planMonsterTurn, createMonster, attackOptions, FACINGS,
} from '../src/engine/combat.js';
import { seededRng } from '../src/engine/dice.js';
import { BESTIARY_BY_ID } from '../src/content/bestiary/index.js';

/** '#' rock, '.' floor, 'D' door. */
function asciiMap(rows, rooms = []) {
  const doors = [];
  const tiles = rows.map((r, y) => [...r].map((c, x) => {
    if (c === 'D') { doors.push({ x, y }); return TILE.DOOR; }
    return c === '#' ? TILE.ROCK : TILE.ROOM;
  }));
  return { width: rows[0].length, height: rows.length, cellSize: 64, feetPerCell: 5, tiles, rooms, doors };
}

test('open floor is fully visible; walls block sight', () => {
  const m = asciiMap(['#######', '#.....#', '#..#..#', '#.....#', '#######']);
  const op = makeOpacity(m);
  assert.equal(lineOfSight({ x: 1, y: 1 }, { x: 5, y: 1 }, op).visible, true);
  assert.equal(lineOfSight({ x: 1, y: 1 }, { x: 5, y: 3 }, op).visible, false, 'pillar sits on this line');
  // Directly behind the pillar at (3,2): blocked
  assert.equal(lineOfSight({ x: 1, y: 2 }, { x: 5, y: 2 }, op).visible, false);
  // Walls themselves are visible (you can see a wall)
  assert.equal(lineOfSight({ x: 1, y: 1 }, { x: 0, y: 1 }, op).visible, true);
});

test('sight cannot squeeze through a pinched diagonal corner', () => {
  const m = asciiMap(['####', '#.##', '##.#', '####']);
  assert.equal(lineOfSight({ x: 1, y: 1 }, { x: 2, y: 2 }, makeOpacity(m)).visible, false);
});

test('closed doors block sight, open doors do not', () => {
  const m = asciiMap(['#######', '#..D..#', '#######']);
  const closed = makeOpacity(m, new Map());
  const open = makeOpacity(m, new Map([[cellKey(3, 1), true]]));
  assert.equal(lineOfSight({ x: 1, y: 1 }, { x: 5, y: 1 }, closed).visible, false);
  assert.equal(lineOfSight({ x: 1, y: 1 }, { x: 3, y: 1 }, closed).visible, true, 'the door itself is visible');
  assert.equal(lineOfSight({ x: 1, y: 1 }, { x: 5, y: 1 }, open).visible, true);
});

test('seeing one square of a room reveals the whole room', () => {
  const room = { x: 4, y: 1, w: 3, h: 3 };
  const m = asciiMap(['########', '#..D...#', '####...#', '####...#', '########'], [room]);
  const op = makeOpacity(m, new Map([[cellKey(3, 1), true]]));
  const vis = visibleSquares(m, { x: 1, y: 1 }, op);
  assert.ok(!vis.has(cellKey(6, 3)), 'far corner not directly visible');
  const revealed = revealFrom(m, vis, new Set());
  assert.ok(revealed.has(cellKey(6, 3)), 'but revealed as part of the room');
});

test('cover: partial sight or a creature in the way gives half cover', () => {
  const m = asciiMap(['#######', '#.....#', '#.....#', '#######']);
  const op = makeOpacity(m);
  assert.equal(coverBetween({ x: 1, y: 1 }, { x: 5, y: 1 }, op), 'none');
  assert.equal(coverBetween({ x: 1, y: 1 }, { x: 5, y: 1 }, op, new Set([cellKey(3, 1)])), 'half');
});

test('generated dungeons: entrance sees its own room', () => {
  const d = generateDungeon(7);
  const vis = visibleSquares(d, d.entrance, makeOpacity(d, new Map()));
  assert.ok(vis.size > 4);
});

test('facing and attacks from behind', () => {
  const target = { pos: { x: 5, y: 5 }, facing: 2 }; // facing east
  assert.equal(isBehind({ x: 4, y: 5 }, target), true);
  assert.equal(isBehind({ x: 4, y: 4 }, target), true);
  assert.equal(isBehind({ x: 6, y: 5 }, target), false);
  assert.equal(isBehind({ x: 5, y: 4 }, target), false, 'flank is not behind');
  assert.equal(FACINGS[facingToward({ x: 0, y: 0 }, { x: 3, y: -2 })].name, 'north-east');
});

test('hit chance maths', () => {
  assert.equal(hitChance(4, 15), 0.5); // need 11+ on d20: 10 faces of 20
  assert.equal(hitChance(4, 15, 'advantage'), 0.75);
  assert.equal(hitChance(4, 15, 'disadvantage'), 0.25);
  assert.equal(hitChance(20, 5), 0.95); // natural 1 always misses
  assert.equal(hitChance(0, 30), 0.05); // natural 20 always hits
  assert.equal(rollMode(['behind'], ['long range']), 'normal');
  assert.equal(critNotation('1d8+3'), '2d8+3');
  assert.equal(critNotation('2d6'), '4d6');
});

test('resolveAttack respects natural 1 and 20', () => {
  const w = { toHit: 50, damage: '1d4' };
  const one = resolveAttack({ weapon: w, ac: 10, rng: () => 0 });
  assert.equal(one.d20, 1); assert.equal(one.hit, false);
  const twenty = resolveAttack({ weapon: { toHit: -50, damage: '1d4' }, ac: 30, rng: () => 19 });
  assert.equal(twenty.crit, true); assert.equal(twenty.hit, true);
  assert.equal(twenty.damageRoll.rolls.length, 2, 'crit doubles dice');
});

test('hero weapon ranges come from properties', () => {
  const bow = weaponFromHeroAttack({ name: 'Longbow', toHit: 5, damage: '1d8+3', damageType: 'piercing', properties: ['range 150/600'] });
  // Reach (engine/range.js): a longbow's 150 ft normal range becomes a reach of 12 squares.
  assert.deepEqual([bow.melee, bow.ranged, bow.normal, bow.long], [false, true, 12, 12]);
  const spear = weaponFromHeroAttack({ name: 'Spear', toHit: 5, damage: '1d6+3', damageType: 'piercing', properties: ['thrown 20/60'] });
  assert.deepEqual([spear.melee, spear.ranged, spear.normal, spear.long], [true, true, 4, 4]);
});

test('at most two goblins per room, never in the entrance room', () => {
  const goblin = BESTIARY_BY_ID.goblin;
  for (let seed = 1; seed <= 20; seed++) {
    const d = generateDungeon(seed);
    const ms = placeMonsters(d, goblin, seed);
    const entrance = d.rooms.find((r) => r.entrance);
    for (const r of d.rooms) {
      const inside = ms.filter((m) => m.pos.x >= r.x && m.pos.x < r.x + r.w && m.pos.y >= r.y && m.pos.y < r.y + r.h);
      assert.ok(inside.length <= 2);
      if (r === entrance) assert.equal(inside.length, 0);
    }
    assert.equal(new Set(ms.map((m) => cellKey(m.pos.x, m.pos.y))).size, ms.length, 'no two on one square');
  }
});

test('goblin AI: adjacent goblin attacks or slips away; distant visible goblin shoots', () => {
  const m = asciiMap(['############', '#..........#', '#..........#', '#..........#', '############']);
  const op = makeOpacity(m);
  const g = createMonster(BESTIARY_BY_ID.goblin, 'g', { x: 2, y: 2 });
  const hero = { pos: { x: 3, y: 2 } };
  const plan = planMonsterTurn({ m: g, hero, map: m, opaque: op, blocked: new Set([cellKey(3, 2)]), rng: seededRng(1) });
  assert.ok(plan.some((s) => s.type === 'attack'));
  const far = createMonster(BESTIARY_BY_ID.goblin, 'f', { x: 10, y: 3 });
  const plan2 = planMonsterTurn({ m: far, hero, map: m, opaque: op, blocked: new Set(), rng: seededRng(1) });
  assert.equal(plan2[0].type, 'attack');
  assert.equal(plan2[0].weapon.name, 'Shortbow');
});

test('attack options: ranged needs sight; adjacent enemy imposes disadvantage', () => {
  const m = asciiMap(['########', '#......#', '#..#...#', '#......#', '########']);
  const op = makeOpacity(m);
  const bow = { name: 'Bow', toHit: 5, damage: '1d8', melee: false, ranged: true, normal: 16, long: 64 };
  const hero = { pos: { x: 1, y: 2 }, facing: 2 };
  const hidden = { pos: { x: 5, y: 2 }, ac: 13, facing: 6, aware: true };
  assert.equal(attackOptions({ attacker: hero, target: hidden, weapon: bow, opaque: op, occupied: new Set(), enemiesOf: () => [] }), null);
  const seen = { pos: { x: 5, y: 1 }, ac: 13, facing: 6, aware: true };
  const opts = attackOptions({ attacker: hero, target: seen, weapon: bow, opaque: op, occupied: new Set(), enemiesOf: () => [{ pos: { x: 2, y: 2 } }] });
  assert.equal(opts.mode, 'disadvantage');
});
