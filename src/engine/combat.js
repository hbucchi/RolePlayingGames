/**
 * Tactical combat on the dungeon grid: facing, attacks, cover, monster placement and AI.
 *
 * Probability notes (used for the hit-chance shown in the UI):
 *   Rolling d20 + bonus >= AC succeeds on (21 - (AC - bonus)) of the 20 faces, so
 *   P(hit) = (21 - AC + bonus) / 20, clamped to [1/20, 19/20] because a natural 1 always
 *   misses and a natural 20 always hits.
 *   With advantage you roll twice and keep the higher: you miss only if BOTH miss, so
 *   P = 1 - (1 - p)^2. With disadvantage both must hit: P = p^2.
 */
import { roll, seededRng, cryptoRandomInt } from './dice.js';
import { reachableSquares, cellKey } from './movement.js';
import { lineOfSight, coverBetween } from './vision.js';

// ---------------------------------------------------------------------------
// Facing
// ---------------------------------------------------------------------------

/** The 8 facings, clockwise from north. */
export const FACINGS = [
  { dx: 0, dy: -1, name: 'north' }, { dx: 1, dy: -1, name: 'north-east' }, { dx: 1, dy: 0, name: 'east' }, { dx: 1, dy: 1, name: 'south-east' },
  { dx: 0, dy: 1, name: 'south' }, { dx: -1, dy: 1, name: 'south-west' }, { dx: -1, dy: 0, name: 'west' }, { dx: -1, dy: -1, name: 'north-west' },
];

export function facingToward(from, to) {
  const dx = Math.sign(to.x - from.x); const dy = Math.sign(to.y - from.y);
  return FACINGS.findIndex((f) => f.dx === dx && f.dy === dy);
}

export const rotateFacing = (f, steps) => (((f + steps) % 8) + 8) % 8;
export const facingAngle = (f) => f * 45; // degrees clockwise from north

/**
 * Is `attacker` behind `target`? Take the direction from target to attacker (signs only)
 * and its dot product with the target's facing. A negative dot product means the attacker
 * is in the rear half; with 8 directions that is the 3 squares directly behind.
 */
export function isBehind(attackerPos, target) {
  const f = FACINGS[target.facing];
  const rx = Math.sign(attackerPos.x - target.pos.x); const ry = Math.sign(attackerPos.y - target.pos.y);
  return rx * f.dx + ry * f.dy <= -1;
}

// ---------------------------------------------------------------------------
// Weapons and attacks
// ---------------------------------------------------------------------------

export const chebyshev = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));

/** Normalise a weapon into { name, toHit, damage, type, melee, ranged, normal, long } (ranges in squares). */
export function weaponFromHeroAttack(a) {
  const props = a.properties ?? [];
  const range = props.find((p) => /^range /.test(p));
  const thrown = props.find((p) => /^thrown /.test(p));
  const spec = (range ?? thrown)?.split(' ')[1];
  const [normal, long] = spec ? spec.split('/').map((n) => Number(n) / 5) : [0, 0];
  return { name: a.name, toHit: a.toHit, damage: a.damage, type: a.damageType, melee: !range, ranged: !!(range || thrown), normal, long };
}

export function weaponFromMonsterAction(action) {
  const at = action.attack;
  const [normal, long] = at.range ? at.range.split('/').map((n) => Number(n) / 5) : [0, 0];
  const main = at.damage[0];
  return { name: action.name, toHit: at.toHit, damage: main.dice, type: main.type, melee: ['mw', 'mrw', 'ms'].includes(at.kind), ranged: ['rw', 'mrw', 'rs'].includes(at.kind), normal, long, extra: at.damage.slice(1) };
}

export function hitChance(toHit, ac, mode = 'normal') {
  const p = Math.min(19, Math.max(1, 21 - (ac - toHit))) / 20;
  if (mode === 'advantage') return 1 - (1 - p) ** 2;
  if (mode === 'disadvantage') return p ** 2;
  return p;
}

/** Advantage and disadvantage cancel out (5e: any amount of each = a normal roll). */
export function rollMode(advReasons, disReasons) {
  if (advReasons.length && !disReasons.length) return 'advantage';
  if (disReasons.length && !advReasons.length) return 'disadvantage';
  return 'normal';
}

/** Double the dice (not the modifier) for a critical hit: "1d8+3" -> "2d8+3". */
export function critNotation(notation) {
  return notation.replace(/^(\d*)d(\d+)/, (_, n, s) => `${(Number(n) || 1) * 2}d${s}`);
}

/**
 * Resolve one attack roll and its damage.
 * @returns {{d20s:number[], d20:number, total:number, hit:boolean, crit:boolean, damage:number, damageRoll:object|null, mode:string, ac:number}}
 */
export function resolveAttack({ weapon, ac, mode = 'normal', rng = cryptoRandomInt }) {
  const d20s = [rng(20) + 1];
  if (mode !== 'normal') d20s.push(rng(20) + 1);
  const d20 = mode === 'advantage' ? Math.max(...d20s) : mode === 'disadvantage' ? Math.min(...d20s) : d20s[0];
  const total = d20 + weapon.toHit;
  const crit = d20 === 20;
  const hit = d20 !== 1 && (crit || total >= ac);
  let damage = 0; let damageRoll = null; const extras = [];
  if (hit) {
    damageRoll = roll(crit ? critNotation(weapon.damage) : weapon.damage, rng);
    damage = Math.max(1, damageRoll.total);
    for (const e of weapon.extra ?? []) {
      if (!/d/.test(e.dice)) continue;
      const r = roll(crit ? critNotation(e.dice) : e.dice, rng);
      extras.push({ type: e.type, total: r.total });
      damage += r.total;
    }
  }
  return { d20s, d20, total, hit, crit, damage, damageRoll, extras, mode, ac };
}

/**
 * Everything that modifies an attack from attacker to target, for both the UI preview and
 * the actual roll. Returns null if the attack is impossible (out of range, no sight...).
 */
export function attackOptions({ attacker, target, weapon, opaque, occupied, enemiesOf }) {
  const dist = chebyshev(attacker.pos, target.pos);
  const adv = []; const dis = [];
  let ac = target.ac;
  let cover = 'none';
  let usingRanged = false;
  if (dist <= 1 && weapon.melee) {
    // melee: adjacent, including diagonals
  } else if (weapon.ranged && dist <= weapon.long) {
    usingRanged = true;
    const others = new Set([...occupied].filter((k) => k !== cellKey(attacker.pos.x, attacker.pos.y) && k !== cellKey(target.pos.x, target.pos.y)));
    cover = coverBetween(attacker.pos, target.pos, opaque, others);
    if (cover === 'total') return null;
    if (cover === 'half') ac += 2;
    if (dist > weapon.normal) dis.push('long range');
    if (enemiesOf(attacker).some((e) => chebyshev(e.pos, attacker.pos) <= 1)) dis.push('enemy adjacent');
  } else {
    return null;
  }
  if (!lineOfSight(attacker.pos, target.pos, opaque).visible) return null;
  if (isBehind(attacker.pos, target)) adv.push('attacking from behind');
  if (target.aware === false) adv.push('target unaware');
  const mode = rollMode(adv, dis);
  return { dist, ac, cover, adv, dis, mode, ranged: usingRanged, chance: hitChance(weapon.toHit, ac, mode) };
}

// ---------------------------------------------------------------------------
// Monsters
// ---------------------------------------------------------------------------

export function createMonster(stat, id, pos, facing = 4) {
  const weapons = stat.actions.filter((a) => a.attack).map(weaponFromMonsterAction);
  return {
    id, statId: stat.id, name: stat.name, pos, facing,
    hp: stat.hp, maxHp: stat.hp, ac: stat.ac, dexMod: stat.mods.dex,
    speed: Math.floor(Math.max(stat.speed.walk ?? 30, stat.speed.fly ?? 0, stat.speed.climb ?? 0) / 5),
    weapons, aware: false, dead: false, reaction: true,
    nimble: stat.traits.some((t) => /Nimble Escape/.test(t.name)),
    flyby: stat.traits.some((t) => /Flyby/.test(t.name)),
    cowardly: stat.traits.some((t) => /Cowardly/.test(t.name)),
  };
}

/**
 * Place monsters in rooms: each room other than the entrance has a chance to hold
 * 1 or 2 of them (never more than 2), on random free squares. Seeded, so the same
 * dungeon always has the same goblins.
 */
export function placeMonsters(map, stat, seed, { chance = 0.5, maxPerRoom = 2 } = {}) {
  const rng = seededRng((seed * 2654435761) >>> 0);
  const monsters = [];
  let n = 0;
  for (const r of map.rooms) {
    if (r.entrance) continue;
    if (rng(1000) / 1000 >= chance) continue;
    const count = 1 + rng(maxPerRoom);
    const used = new Set();
    for (let i = 0; i < count; i++) {
      let pos;
      for (let tries = 0; tries < 20; tries++) {
        const p = { x: r.x + rng(r.w), y: r.y + rng(r.h) };
        if (!used.has(cellKey(p.x, p.y))) { pos = p; break; }
      }
      if (!pos) continue;
      used.add(cellKey(pos.x, pos.y));
      monsters.push(createMonster(stat, `m${++n}`, pos, rng(8)));
    }
  }
  return monsters;
}

export function rollInitiative(dexMod, rng = cryptoRandomInt) {
  const d20 = rng(20) + 1;
  return { d20, total: d20 + dexMod };
}

/**
 * Decide a monster's turn. Pure: returns a list of steps for the UI to animate.
 *   { type: 'move', path } | { type: 'disengage' } | { type: 'attack', weapon } | { type: 'wait' }
 * Goblin tactics: shoot when the hero is visible and not adjacent; when adjacent, either
 * hack with the scimitar or (if wounded, or sometimes anyway) use Nimble Escape to slip away
 * and shoot; otherwise close the distance.
 */
export function planMonsterTurn({ m, hero, map, opaque, blocked, rng = cryptoRandomInt }) {
  const melee = m.weapons.find((w) => w.melee);
  const ranged = m.weapons.find((w) => w.ranged && !w.melee) ?? null;
  const dist = chebyshev(m.pos, hero.pos);
  const sees = (pos) => lineOfSight(pos, hero.pos, opaque).visible;

  // Cowards run when badly hurt: to the reachable square farthest from the hero, then shoot if they can.
  if (m.cowardly && m.hp <= m.maxHp / 2) {
    const reach = reachableSquares(map, m.pos, m.speed, { blocked });
    const far = [...reach.values()].sort((a, b) => chebyshev(b, hero.pos) - chebyshev(a, hero.pos) || a.cost - b.cost)[0];
    if (far && chebyshev(far, hero.pos) > dist) {
      const steps = [{ type: 'flee' }, { type: 'move', path: far.path }];
      if (ranged && chebyshev(far, hero.pos) <= ranged.long && sees(far)) steps.push({ type: 'attack', weapon: ranged });
      return steps;
    }
  }

  if (dist <= 1) {
    const wounded = m.hp <= m.maxHp / 2;
    if (ranged && m.nimble && (wounded || rng(100) < 35)) {
      const reach = reachableSquares(map, m.pos, m.speed, { blocked });
      const spots = [...reach.values()].filter((c) => chebyshev(c, hero.pos) >= 3 && sees(c));
      spots.sort((a, b) => chebyshev(b, hero.pos) - chebyshev(a, hero.pos) || a.cost - b.cost);
      if (spots.length) return [{ type: 'disengage' }, { type: 'move', path: spots[0].path }, { type: 'attack', weapon: ranged }];
    }
    return melee ? [{ type: 'attack', weapon: melee }] : [{ type: 'wait' }];
  }

  if (ranged && sees(m.pos) && dist <= ranged.long) return [{ type: 'attack', weapon: ranged }];

  // Close in: find the cheapest free square next to the hero, then walk part of the way.
  const all = reachableSquares(map, m.pos, 200, { blocked });
  let best = null;
  for (const c of all.values()) {
    if (chebyshev(c, hero.pos) !== 1) continue;
    if (!best || c.cost < best.cost) best = c;
  }
  if (!best) return [{ type: 'wait' }];
  const path = best.path.slice(0, m.speed + 1);
  const end = path[path.length - 1];
  const steps = [{ type: 'move', path }];
  if (chebyshev(end, hero.pos) <= 1 && melee) steps.push({ type: 'attack', weapon: melee });
  else if (ranged && sees(end) && chebyshev(end, hero.pos) <= ranged.long) steps.push({ type: 'attack', weapon: ranged });
  return steps;
}

/** A plain-language description of how hurt a creature looks (players don't see exact HP). */
export function woundState(hp, maxHp) {
  if (hp <= 0) return 'dead';
  if (hp === maxHp) return 'unhurt';
  if (hp > maxHp / 2) return 'wounded';
  return 'bloodied';
}
