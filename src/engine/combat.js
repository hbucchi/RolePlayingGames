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
import { monsterPowers, freshMonsterUses, parseAura } from './monster-magic.js';
import { lineOfSight, coverBetween } from './vision.js';
import { footprintOf, cellsOf, blockDistance, centerOf } from './size.js';

/** Distance between two creatures, measured between their nearest squares (big creatures fill blocks). */
export const entityDistance = (a, b) => blockDistance(a.pos, a.size ?? 1, b.pos, b.size ?? 1);
/** Does a creature cover a square? */
export const covers = (e, c) => c.x >= e.pos.x && c.y >= e.pos.y && c.x < e.pos.x + (e.size ?? 1) && c.y < e.pos.y + (e.size ?? 1);
/** Best line of sight between any square of one creature and any square of the other. */
export function bestSight(a, b, opaque) {
  let best = null;
  for (const ca of cellsOf(a.pos, a.size ?? 1)) {
    for (const cb of cellsOf(b.pos, b.size ?? 1)) {
      const los = lineOfSight(ca, cb, opaque);
      if (los.visible) return { from: ca, to: cb, ...los };
      best ??= { from: ca, to: cb, ...los };
    }
  }
  return best;
}
/**
 * Melee reach in squares. Every melee attack needs the attacker to touch its target: an adjacent
 * square, diagonals included (the stat block's 10 ft reach is kept as `statReach` for show only).
 * Anything farther away has to be a ranged attack: a bow, a thrown spear, a spell.
 */
export const reachOf = (e) => Math.max(1, ...e.weapons.filter((w) => w.melee).map((w) => w.reach ?? 1));

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
  const c = centerOf(target.pos, target.size ?? 1);
  const rx = Math.sign(attackerPos.x - c.x); const ry = Math.sign(attackerPos.y - c.y);
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
  return { name: a.name, toHit: a.toHit, damage: a.damage, type: a.damageType, melee: !range, ranged: !!(range || thrown), normal, long, reach: 1 };
}

export function weaponFromMonsterAction(action) {
  const at = action.attack;
  const [normal, long] = at.range ? at.range.split('/').map((n) => Number(n) / 5) : [0, 0];
  const main = at.damage[0];
  return { name: action.name, toHit: at.toHit, damage: main.dice, type: main.type, melee: ['mw', 'mrw', 'ms'].includes(at.kind), ranged: ['rw', 'mrw', 'rs'].includes(at.kind), normal, long, extra: at.damage.slice(1), reach: 1, statReach: Math.max(1, Math.round((at.reach ?? 5) / 5)),
    spell: ['rs', 'ms'].includes(at.kind) };
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
export function resolveAttack({ weapon, ac, mode = 'normal', rng = cryptoRandomInt, autoCrit = false }) {
  const d20s = [rng(20) + 1];
  if (mode !== 'normal') d20s.push(rng(20) + 1);
  const d20 = mode === 'advantage' ? Math.max(...d20s) : mode === 'disadvantage' ? Math.min(...d20s) : d20s[0];
  const total = d20 + weapon.toHit;
  let crit = d20 === 20;
  const hit = d20 !== 1 && (crit || total >= ac);
  if (hit && autoCrit) crit = true; // e.g. a melee hit on a paralysed creature
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
  const dist = entityDistance(attacker, target);
  const adv = []; const dis = [];
  let ac = target.ac;
  let cover = 'none';
  let usingRanged = false;
  const sight = bestSight(attacker, target, opaque);
  if (!sight?.visible) return null;
  if (dist <= (weapon.reach ?? 1) && weapon.melee) {
    // melee: touching the target (adjacent, diagonals included)
  } else if (weapon.ranged && dist <= weapon.long) {
    usingRanged = true;
    const own = new Set([...cellsOf(attacker.pos, attacker.size ?? 1), ...cellsOf(target.pos, target.size ?? 1)].map((c) => cellKey(c.x, c.y)));
    const others = new Set([...occupied].filter((k) => !own.has(k)));
    cover = coverBetween(sight.from, sight.to, opaque, others);
    if (cover === 'total') return null;
    if (cover === 'half') ac += 2;
    if (dist > weapon.normal) dis.push('long range');
    if (enemiesOf(attacker).some((e) => entityDistance(e, attacker) <= 1)) dis.push('enemy adjacent');
  } else {
    return null;
  }
  if (isBehind(centerOf(attacker.pos, attacker.size ?? 1), target)) adv.push('attacking from behind');
  if (target.aware === false) adv.push('target unaware');
  const c = target.cond ?? {};
  if (c.asleep || c.paralyzed || c.stun > 0 || c.petrified) adv.push(c.petrified ? 'target turned to stone' : 'target helpless');
  else if (c.restrained || c.bound) adv.push(c.bound ? `target ${BOUND_TEXT[c.bound.to] ?? 'bound'}` : 'target restrained');
  // Prone: easy to hit up close, hard to hit from afar.
  if (c.prone) { if (usingRanged) dis.push('target prone (far)'); else adv.push('target prone'); }
  const a = attacker.cond ?? {};
  if (a.mock) dis.push('shaken by mockery');
  if (a.prone) dis.push('attacking from the ground');
  if (a.restrained || a.bound) dis.push('cannot move freely');
  if (a.frightened) dis.push('frightened');
  const mode = rollMode(adv, dis);
  return { dist, ac, cover, adv, dis, mode, ranged: usingRanged, chance: hitChance(weapon.toHit, ac, mode) };
}

// ---------------------------------------------------------------------------
// Position effects: bound, petrified, prone, grappled
// ---------------------------------------------------------------------------

/** What a creature is bound to, in words. */
export const BOUND_TEXT = { wall: 'chained to the wall', floor: 'shackled to the floor', post: 'tied to a post', web: 'stuck in a web', force: 'pinned by chains of force' };

/**
 * Conditions that keep a creature where it is. In 5e terms: bound (restrained in place),
 * grappled and restrained have speed 0; petrified creatures cannot act at all.
 */
export const immobile = (e) => !!(e.cond && (e.cond.bound || e.cond.grappled || e.cond.restrained || e.cond.petrified || e.cond.paralyzed || e.cond.asleep));

/** A short list of the conditions on a creature, for the UI. */
export function conditionLabels(e) {
  const c = e.cond ?? {}; const out = [];
  if (c.bound) out.push(BOUND_TEXT[c.bound.to] ?? 'bound');
  if (c.petrified) out.push('turned to stone');
  if (c.prone) out.push('prone');
  if (c.grappled) out.push('grappled');
  if (c.restrained) out.push('restrained');
  if (c.paralyzed) out.push('paralysed');
  if (c.asleep) out.push('asleep');
  if (c.stun > 0) out.push('stunned');
  if (c.flee > 0) out.push('frightened');
  if (c.mock) out.push('mocked');
  if (c.taunt) out.push('taunted');
  return out;
}

/** Shove and grapple: Athletics against the target's better of Athletics and Acrobatics. */
export function escapeBonus(stat) {
  const ath = stat.skills?.athletics ?? stat.mods?.str ?? 0;
  const acr = stat.skills?.acrobatics ?? stat.mods?.dex ?? 0;
  return Math.max(ath, acr);
}
const SIZE_RANK = { Tiny: 0, Small: 1, Medium: 2, Large: 3, Huge: 4, Gargantuan: 5 };
/** You can shove or grapple a creature at most one size larger than you (heroes are Medium or Small). */
export const canWrestle = (stat, heroSize = 'Medium') => (SIZE_RANK[stat.size] ?? 2) <= (SIZE_RANK[heroSize] ?? 2) + 1;

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
    size: footprintOf(stat),
    cowardly: stat.traits.some((t) => /Cowardly/.test(t.name)),
    ...(() => { const powers = monsterPowers(stat); return { powers, uses: freshMonsterUses(stat, powers), aura: parseAura(stat.traits) }; })(),
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
  const n = m.size ?? 1;
  const reachSq = reachOf(m);
  const dAt = (pos) => blockDistance(pos, n, hero.pos, hero.size ?? 1);
  const dist = dAt(m.pos);
  const sees = (pos) => !!bestSight({ pos, size: n }, hero, opaque)?.visible;
  const move = (budget) => reachableSquares(map, m.pos, budget, { blocked, size: n });

  // Cowards run when badly hurt: to the reachable square farthest from the hero, then shoot if they can.
  if ((m.cowardly && m.hp <= m.maxHp / 2) || m.cond?.flee > 0) {
    const reach = move(m.speed);
    const far = [...reach.values()].sort((a, b) => dAt(b) - dAt(a) || a.cost - b.cost)[0];
    if (far && dAt(far) > dist) {
      return [{ type: 'flee' }, { type: 'move', path: far.path }]; // a coward runs; it does not stop to shoot
    }
  }

  if (melee && dist <= reachSq && sees(m.pos)) {
    const wounded = m.hp <= m.maxHp / 2;
    if (ranged && m.nimble && (wounded || rng(100) < 35)) {
      const reach = move(m.speed);
      const spots = [...reach.values()].filter((c) => dAt(c) >= 3 && sees(c));
      spots.sort((a, b) => dAt(b) - dAt(a) || a.cost - b.cost);
      if (spots.length) return [{ type: 'disengage' }, { type: 'move', path: spots[0].path }, { type: 'attack', weapon: ranged }];
    }
    return [{ type: 'attack', weapon: melee }];
  }

  if (ranged && sees(m.pos) && dist <= ranged.long) return [{ type: 'attack', weapon: ranged }];

  // Close in: find the cheapest square within reach of the hero, then walk part of the way.
  const all = move(200);
  let best = null;
  for (const c of all.values()) {
    if (dAt(c) > reachSq || dAt(c) < 1) continue;
    if (!best || c.cost < best.cost) best = c;
  }
  if (!best) return [{ type: 'wait' }];
  const path = best.path.slice(0, m.speed + 1);
  const end = path[path.length - 1];
  const steps = [{ type: 'move', path }];
  if (dAt(end) <= reachSq && melee) steps.push({ type: 'attack', weapon: melee });
  else if (ranged && sees(end) && dAt(end) <= ranged.long) steps.push({ type: 'attack', weapon: ranged });
  return steps;
}

/** A plain-language description of how hurt a creature looks (players don't see exact HP). */
export function woundState(hp, maxHp) {
  if (hp <= 0) return 'dead';
  if (hp === maxHp) return 'unhurt';
  if (hp > maxHp / 2) return 'wounded';
  return 'bloodied';
}
