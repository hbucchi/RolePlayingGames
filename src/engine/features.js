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

/** Trap kinds. Each has a painted floor tile for when it is found, sprung and disarmed (assets/traps). */
export const TRAP_KINDS = [
  { kind: 'spikes', name: 'spike plate', type: 'piercing', text: 'Iron spikes shoot up through the floor!' },
  { kind: 'pit', name: 'collapsing floor', type: 'bludgeoning', text: 'The floor gives way beneath you!' },
  { kind: 'ceiling', name: 'falling ceiling', type: 'bludgeoning', text: 'Stones crash down from the ceiling!' },
  { kind: 'darts', name: 'dart trap', type: 'piercing', text: 'Darts hiss out of holes in the wall!' },
  { kind: 'blade', name: 'scything blade', type: 'slashing', text: 'A rusty blade swings up out of the floor!' },
];
/** The tile to draw for a trap: armed (found), sprung, or made safe. */
export function trapTile(t) {
  if (t.disarmed) return `assets/traps/${t.kind === 'pit' ? 'pit-nailed' : t.kind === 'ceiling' ? 'ceiling-armed' : 'plate-jammed'}.jpg`;
  return `assets/traps/${t.kind}-${t.sprung ? 'sprung' : 'armed'}.jpg`;
}
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
    // Most locked doors are oak (easy to force, but loud if you botch it). Some could be iron: that
    // is decided below, once the chests are placed (an early iron door needs a key to be found).
    // From a hash of the square, so the rest of the dungeon's dice stay the same.
    const ironish = (((d.x * 73856093) ^ (d.y * 19349663)) >>> 0) % 100 < 18 + tier * 4;
    const r = rng(5);
    // Early on, locks are simple (DC 8-12 at levels 1-2); they get better deeper and later.
    locks.set(k, { dc: (tier === 0 ? 8 : 10) + r + tier, material: 'wood', ironish });
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

  // Iron doors. Early in the game (levels 1-5) an iron door appears only if its key can be put in a
  // chest the party can reach without passing that door (or any other iron door): one key, one door.
  // From level 6 iron doors may also stand without a key (then: pick the lock, or a giant's shove);
  // about half of them still have a key hidden somewhere.
  const ironDoors = new Set();
  for (const [k, lock] of locks) {
    const want = lock.ironish; delete lock.ironish;
    if (!want) continue;
    const before = reachable(map, map.entrance, new Set([...secretDoors, ...ironDoors, k]));
    // Making this door iron must not lock away a key already hidden for another door.
    if (chests.some((c) => c.keyFor && !before.has(cellKey(c.x, c.y)))) continue;
    const holders = chests.filter((c) => before.has(cellKey(c.x, c.y)) && !c.keyFor);
    const keyed = tier < 2 || (((k.length * 7919) ^ seed) >>> 0) % 2 === 0;
    if (keyed && holders.length) {
      const chest = holders[(((seed * 31) ^ k.length * 17) >>> 0) % holders.length];
      chest.keyFor = k; lock.material = 'iron'; lock.key = chest.id; ironDoors.add(k);
    } else if (tier >= 2) { lock.material = 'iron'; ironDoors.add(k); }
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
  // A mana totem: one per floor, in a room away from the stairs, usable once (restores mana and
  // abilities, engine/magic.js replenish). Picked from a hash, so the other dice stay the same.
  let totem = null;
  const rooms = map.rooms.filter((r) => !r.entrance).sort((a, b) => a.id - b.id);
  for (let k = 0; k < rooms.length && !totem; k++) {
    const r = rooms[(((seed * 2654435761) >>> 0) + k * 7) % rooms.length];
    const cx = r.x + Math.floor(r.w / 2); const cy = r.y + Math.floor(r.h / 2);
    for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [-1, 0], [0, -1], [1, 1]]) {
      const x = cx + dx; const y = cy + dy; const kk = cellKey(x, y);
      if (isWalkable(map, x, y) && !taken.has(kk) && !nearDoor(x, y)) { totem = { x, y, used: false }; taken.add(kk); break; }
    }
  }
  return { chests, traps, secretDoors, locks, totem };
}

/**
 * Fill rooms with monsters suited to the hero's level using the encounter budget:
 * most rooms easy or medium, a few hard. About half the rooms are empty.
 */
export function populateDungeon(map, seed, level, pool, { chance = 0.5, avoid = new Set(), partySize = 1, mix = { easy: 40, medium: 45 } } = {}) {
  const rng = seededRng((seed * 2654435761) >>> 0);
  const monsters = [];
  let n = 0;
  for (const r of map.rooms) {
    if (r.entrance || rng(1000) / 1000 >= chance) continue;
    const roll = rng(100);
    const difficulty = roll < mix.easy ? 'easy' : roll < mix.easy + mix.medium ? 'medium' : 'hard'; // deeper floors are harder (depths.js)
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

/**
 * Forcing something open (Athletics). Oak doors give way easily (DC 7-9 early, up to 10 later):
 * the check only decides whether you ease it open quietly or splinter it with a crash. Iron doors
 * barely move (DC 20+); their key opens them. Chests and shackles: the lock's DC + 2.
 * Botched attempts are loud: foes within NOISE.fail squares hear it, NOISE.fumble on a natural 1.
 */
export const NOISE = { fail: 10, fumble: 15 };
export function forceDc(lock, kind = 'door') {
  if (kind !== 'door') return lock.dc + 2;
  // Oak: DC 7-9 for a first-level hero, a little more deeper down. Iron: 20 + the lock's quality.
  return lock.material === 'iron' ? 20 + Math.max(0, lock.dc - 10) : 7 + Math.max(0, Math.min(6, lock.dc - 8) >> 1);
}
