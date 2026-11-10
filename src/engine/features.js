/**
 * Things hidden in a dungeon besides its monsters: treasure chests (some locked), traps,
 * secret doors and locked doors. Placement is seeded, so a dungeon number always holds the
 * same secrets. Also the skill-check helper used to find, pick and disarm them.
 *
 * Skill checks: roll d20 + bonus and compare with a Difficulty Class (DC). With advantage you
 * roll twice and keep the higher. Passive checks (noticing a trap as you walk) use 10 + bonus
 * instead of a roll: 10 is the average of a d20 roll... almost (the true mean is 10.5).
 */
import { seededRng, cryptoRandomInt } from './dice.js';
import { TILE, isWalkable } from './dungeon.js';
import { cellKey } from './movement.js';
import { createMonster } from './combat.js';
import { buildEncounter } from './progression.js';
import { footprintOf, cellsOf, dims, orientFor } from './size.js';

/** d20 + bonus vs DC. mode: 'normal' | 'advantage' | 'disadvantage'. */
export function skillCheck(bonus, dc, { mode = 'normal', rng = cryptoRandomInt } = {}) {
  const d20s = [rng(20) + 1];
  if (mode !== 'normal') d20s.push(rng(20) + 1);
  const d20 = mode === 'advantage' ? Math.max(...d20s) : mode === 'disadvantage' ? Math.min(...d20s) : d20s[0];
  const total = d20 + bonus;
  return { d20s, d20, bonus, total, dc, ok: total >= dc, margin: total - dc, mode };
}

/** Chance that d20 + bonus >= dc (a natural 1 does not auto-fail an ability check in 5e). */
export const checkChance = (bonus, dc) => Math.min(20, Math.max(0, 21 - (dc - bonus))) / 20;

/** Everything reachable from `start`, treating `blocked` keys as walls (breadth-first search). */
function reachable(map, start, blocked) {
  const seen = new Set([cellKey(start.x, start.y)]);
  const queue = [start];
  while (queue.length) {
    const { x, y } = queue.shift();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx; const ny = y + dy; const k = cellKey(nx, ny);
      if (seen.has(k) || blocked.has(k) || !isWalkable(map, nx, ny)) continue;
      seen.add(k); queue.push({ x: nx, y: ny });
    }
  }
  return seen;
}

function countWalkable(map, blocked) {
  let n = 0;
  for (let y = 0; y < map.height; y++) for (let x = 0; x < map.width; x++) if (map.tiles[y][x] !== TILE.ROCK && !blocked.has(cellKey(x, y))) n++;
  return n;
}

const TRAP_KINDS = [
  { kind: 'darts', name: 'dart trap', type: 'piercing', text: 'Darts hiss out of holes in the wall!' },
  { kind: 'pit', name: 'hidden pit', type: 'bludgeoning', text: 'The floor gives way into a shallow pit!' },
  { kind: 'blade', name: 'scything blade', type: 'slashing', text: 'A rusty blade swings out of the wall!' },
];
/** Trap damage by level tier (DMG "setback" to "dangerous"). */
export const trapDamage = (level) => (level <= 4 ? '1d10' : level <= 10 ? '2d10' : level <= 16 ? '4d10' : '10d10');

/**
 * Place chests, traps, secret doors and locks.
 * @returns {{ chests, traps, secretDoors:Set<string>, locks:Map<string,{dc:number}> }}
 */
export function placeFeatures(map, seed, level = 1) {
  const rng = seededRng(((seed + 101) * 2246822519) >>> 0);
  const tier = Math.floor(level / 3);
  const doorKeys = new Set(map.doors.map((d) => cellKey(d.x, d.y)));
  const taken = new Set([cellKey(map.entrance.x, map.entrance.y), ...(map.exit ? [cellKey(map.exit.x, map.exit.y)] : [])]);
  const nearDoor = (x, y) => map.doors.some((d) => Math.abs(d.x - x) + Math.abs(d.y - y) <= 1);

  // Secret doors: only doors whose loss keeps every square reachable (doors on loops), so a
  // hero who never finds them can still explore the whole dungeon.
  const secretDoors = new Set();
  for (const d of [...map.doors].sort(() => rng(3) - 1)) {
    if (secretDoors.size >= 2) break;
    if (rng(100) >= 35) continue;
    const trial = new Set([...secretDoors, cellKey(d.x, d.y)]);
    if (reachable(map, map.entrance, trial).size === countWalkable(map, trial)) secretDoors.add(cellKey(d.x, d.y));
  }

  // Locked doors: picked with thieves' tools or forced with Strength. Never the secret ones.
  const locks = new Map();
  for (const d of map.doors) {
    const k = cellKey(d.x, d.y);
    if (secretDoors.has(k) || rng(100) >= 18) continue;
    locks.set(k, { dc: 10 + rng(5) + tier });
  }

  // Chests: about a third of the rooms, against a wall, away from doors.
  const chests = [];
  for (const r of map.rooms) {
    if (r.entrance || rng(100) >= 35) continue;
    for (let t = 0; t < 12; t++) {
      const edge = rng(4);
      const x = edge === 0 ? r.x : edge === 1 ? r.x + r.w - 1 : r.x + rng(r.w);
      const y = edge === 2 ? r.y : edge === 3 ? r.y + r.h - 1 : r.y + rng(r.h);
      const k = cellKey(x, y);
      if (taken.has(k) || nearDoor(x, y)) continue;
      taken.add(k);
      const locked = rng(100) < 50;
      chests.push({ id: `c${chests.length + 1}`, x, y, roomId: r.id, locked, dc: 10 + rng(5) + tier, opened: false, loot: null });
      break;
    }
  }

  // Traps: in corridors and rooms, never on doors, chests or the stairs.
  const traps = [];
  const want = Math.max(2, Math.round(map.rooms.length / 3));
  for (let t = 0; t < want * 30 && traps.length < want; t++) {
    const x = 1 + rng(map.width - 2); const y = 1 + rng(map.height - 2);
    const k = cellKey(x, y);
    if (map.tiles[y][x] === TILE.ROCK || doorKeys.has(k) || taken.has(k)) continue;
    const room = map.rooms.find((r) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h);
    if (room?.entrance) continue;
    taken.add(k);
    const kind = TRAP_KINDS[rng(TRAP_KINDS.length)];
    traps.push({ id: `t${traps.length + 1}`, x, y, ...kind, dc: 11 + rng(4) + tier, saveDc: 11 + tier, damage: trapDamage(level), found: false, disarmed: false, sprung: false });
  }
  return { chests, traps, secretDoors, locks };
}

/**
 * Fill rooms with monsters suited to the hero's level using the encounter budget:
 * most rooms easy or medium, a few hard. About half the rooms are empty.
 */
export function populateDungeon(map, seed, level, pool, { chance = 0.5, avoid = new Set(), partySize = 1 } = {}) {
  const rng = seededRng((seed * 2654435761) >>> 0);
  const monsters = [];
  let n = 0;
  for (const r of map.rooms) {
    if (r.entrance || rng(1000) / 1000 >= chance) continue;
    const roll = rng(100);
    const difficulty = roll < 40 ? 'easy' : roll < 85 ? 'medium' : 'hard';
    const group = buildEncounter(level, pool, rng, { difficulty, partySize, maxCount: Math.min(4, partySize + 1) });
    const used = new Set();
    for (const stat of group) {
      // Big creatures fill a block of squares that must fit inside the room.
      // Long bodies are laid along the room's longer side.
      const facing = rng(8);
      const fp = orientFor(footprintOf(stat), r.w >= r.h ? 2 : 4);
      const { w, h } = dims(fp);
      if (w > r.w || h > r.h) continue;
      let pos = null;
      for (let t = 0; t < 40; t++) {
        const p = { x: r.x + rng(r.w - w + 1), y: r.y + rng(r.h - h + 1) };
        if (cellsOf(p, fp).every((c) => !used.has(cellKey(c.x, c.y)) && !avoid.has(cellKey(c.x, c.y)))) { pos = p; break; }
      }
      if (!pos) continue;
      for (const c of cellsOf(pos, fp)) used.add(cellKey(c.x, c.y));
      const m = createMonster(stat, `m${++n}`, pos, facing);
      m.size = fp; // keep the orientation that fits this room
      if (w !== h) m.facing = (w > h) !== !!dims(fp).across ? (facing < 4 ? 2 : 6) : (facing >= 2 && facing <= 5 ? 4 : 0);
      monsters.push({ ...m, roomDifficulty: difficulty });
    }
  }
  return monsters;
}
