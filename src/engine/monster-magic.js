/**
 * Monster magic: spells from a stat block's Spellcasting, plus breath weapons, roars and fiery
 * auras read from its actions and traits. Pure functions: the UI animates and applies them.
 *
 * Each usable power becomes a plain object:
 *   { id, name, kind, range, save, dc, dice, type, half, shape, size, rider, linger, level, recharge, perDay }
 * kind: 'bolt' (spell attack roll), 'darts' (never misses), 'save' (one target saves),
 *       'area' (everyone in a cone, line, burst or ring saves), 'wall' (a lasting line of fire).
 * shape (squares): 'radius' n around a point, 'around' n around the caster, 'cone' n long, 'line' n long.
 * linger: ground left changed for a few rounds: 'fire' burns, 'ice' and 'rubble' slow,
 *         'poison' chokes.
 */
import { blockDistance, cellsOf, centerOf, spanOf } from './size.js';

// The spells monsters actually cast, with what they do on this grid (ranges in squares).
export const MONSTER_SPELLS = {
  'fire bolt': { kind: 'bolt', dice: '1d10', type: 'fire', range: 24, level: 0 },
  'ray of frost': { kind: 'bolt', dice: '1d8', type: 'cold', range: 12, level: 0 },
  'produce flame': { kind: 'bolt', dice: '1d8', type: 'fire', range: 6, level: 0 },
  'sacred flame': { kind: 'save', save: 'dex', dice: '1d8', type: 'radiant', range: 12, level: 0, half: false },
  'vicious mockery': { kind: 'save', save: 'wis', dice: '1d4', type: 'psychic', range: 12, level: 0, half: false, rider: 'mock' },
  'magic missile': { kind: 'darts', count: 3, dice: '1d4+1', type: 'force', range: 24, level: 1 },
  'guiding bolt': { kind: 'bolt', dice: '4d6', type: 'radiant', range: 24, level: 1 },
  thunderwave: { kind: 'area', shape: 'around', size: 1, save: 'con', dice: '2d8', type: 'thunder', half: true, level: 1, linger: 'rubble', lingerRounds: 3 },
  entangle: { kind: 'area', shape: 'radius', size: 2, range: 18, save: 'str', type: 'none', rider: 'restrain', level: 1 },
  command: { kind: 'save', save: 'wis', range: 12, level: 1, rider: 'flee' },
  'acid arrow': { kind: 'bolt', dice: '4d4', type: 'acid', range: 18, level: 2, linger: 'poison', lingerRounds: 2, lingerRadius: 0 },
  shatter: { kind: 'area', shape: 'radius', size: 2, range: 12, save: 'con', dice: '3d8', type: 'thunder', half: true, level: 2, linger: 'rubble', lingerRounds: 4 },
  fireball: { kind: 'area', shape: 'radius', size: 4, range: 30, save: 'dex', dice: '8d6', type: 'fire', half: true, level: 3, linger: 'fire', lingerRounds: 2 },
  'lightning bolt': { kind: 'area', shape: 'line', size: 20, save: 'dex', dice: '8d6', type: 'lightning', half: true, level: 3, linger: 'rubble', lingerRounds: 2 },
  fear: { kind: 'area', shape: 'cone', size: 6, save: 'wis', type: 'none', rider: 'flee', level: 3 },
  'ice storm': { kind: 'area', shape: 'radius', size: 4, range: 60, save: 'dex', dice: '6d6', type: 'cold', half: true, level: 4, linger: 'ice', lingerRounds: 10 },
  blight: { kind: 'save', save: 'con', dice: '8d8', type: 'necrotic', range: 6, level: 4, half: true },
  'wall of fire': { kind: 'wall', save: 'dex', dice: '5d8', type: 'fire', range: 24, level: 4, length: 7, lingerRounds: 10 },
  'cone of cold': { kind: 'area', shape: 'cone', size: 12, save: 'con', dice: '8d8', type: 'cold', half: true, level: 5, linger: 'ice', lingerRounds: 3 },
  'flame strike': { kind: 'area', shape: 'radius', size: 2, range: 12, save: 'dex', dice: '8d6', type: 'fire', half: true, level: 5, linger: 'fire', lingerRounds: 1 },
  cloudkill: { kind: 'area', shape: 'radius', size: 4, range: 24, save: 'con', dice: '5d8', type: 'poison', half: true, level: 5, linger: 'poison', lingerRounds: 10 },
  'chain lightning': { kind: 'save', save: 'dex', dice: '10d8', type: 'lightning', range: 30, level: 6, half: true },
  disintegrate: { kind: 'save', save: 'dex', dice: '10d6+40', type: 'force', range: 12, level: 6, half: false },
  harm: { kind: 'save', save: 'con', dice: '14d6', type: 'necrotic', range: 12, level: 6, half: true },
  'finger of death': { kind: 'save', save: 'con', dice: '7d8+30', type: 'necrotic', range: 12, level: 7, half: true },
};

/** What a damage type leaves on the ground when a breath or blast lingers. */
export const LINGER_FOR_TYPE = { fire: 'fire', cold: 'ice', thunder: 'rubble', lightning: 'rubble', poison: 'poison', acid: 'poison' };

/** Lingering ground: what it does each round to whoever stands in it, and how hard it is to cross. */
export const GROUND = {
  fire: { label: 'burning ground', save: 'dex', dice: '2d6', type: 'fire', cost: 1 },
  ice: { label: 'sheet of ice', cost: 2 },
  rubble: { label: 'shattered ground', cost: 2 },
  poison: { label: 'poison cloud', save: 'con', dice: '2d6', type: 'poison', cost: 1 },
  firewall: { label: 'wall of fire', cost: 1 },
};

const ABIL = { strength: 'str', dexterity: 'dex', constitution: 'con', intelligence: 'int', wisdom: 'wis', charisma: 'cha' };

/**
 * Read a save-based action ("Fire Breath (Recharge 5-6)", "Roar of the Deep") from its text.
 * Returns null when it is not something we can play out (no save, or no area).
 */
export function parseAreaAction(action) {
  const text = action.text ?? '';
  const save = /DC (\d+) (Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma) saving throw/.exec(text);
  if (!save) return null;
  let shape = null; let size = 0;
  const cone = /(\d+)-foot cone/.exec(text); const line = /(\d+)-foot line/.exec(text);
  const within = /within (\d+) (?:feet|ft)/.exec(text);
  if (cone) { shape = 'cone'; size = Number(cone[1]) / 5; } else if (line) { shape = 'line'; size = Number(line[1]) / 5; } else if (within) { shape = 'around'; size = Math.min(12, Number(within[1]) / 5); }
  if (!shape) return null;
  const dmg = /\d+ \((\d+d\d+(?: [+-] \d+)?)\) (\w+) damage/.exec(text);
  const rider = /frightened/.test(text) ? 'flee' : /restrained/.test(text) ? 'restrain' : /prone/.test(text) ? 'prone' : null;
  if (!dmg && !rider) return null;
  const recharge = /\(Recharge (\d)(?:[–-]6)?\)/.exec(action.name);
  const perDay = /\((\d)\/Day\)/.exec(action.name);
  const type = dmg ? dmg[2] : 'none';
  return {
    id: action.name.toLowerCase().replace(/[^a-z]+/g, '-').replace(/-+$/, ''),
    name: action.name.replace(/\s*\(.*\)$/, ''), kind: 'area', shape, size,
    save: ABIL[save[2].toLowerCase()], dc: Number(save[1]), dice: dmg ? dmg[1].replace(/ /g, '') : null, type,
    half: /half as much/.test(text), rider,
    linger: dmg && shape !== 'around' ? LINGER_FOR_TYPE[type] ?? null : null, lingerRounds: 2,
    recharge: recharge ? Number(recharge[1]) : null,
    // A pure scare (Frightful Presence) works once on a crowd; after that they are used to it.
    perDay: perDay ? Number(perDay[1]) : (!dmg && !recharge ? 1 : null), breath: /breath/i.test(action.name),
  };
}

/** A trait like "At the start of each of its turns, each creature within 10 feet of it takes 14 (4d6) fire damage." */
export function parseAura(traits = []) {
  for (const t of traits) {
    const m = /start of each of its turns, each creature within (\d+) feet of it takes \d+ \((\d+d\d+(?: [+-] \d+)?)\) (\w+) damage/.exec(t.text ?? '');
    if (m) return { name: t.name, size: Number(m[1]) / 5, dice: m[2].replace(/ /g, ''), type: m[3] };
  }
  return null;
}

/** Every power a creature can use in this game, with its uses: spell slots, per-day counts, recharge. */
export function monsterPowers(stat) {
  const out = [];
  const sc = stat.spellcasting;
  if (sc) {
    const dc = sc.dc ?? 13; const toHit = sc.toHit ?? dc - 8;
    const add = (name, level, perDay = null) => {
      const def = MONSTER_SPELLS[name.toLowerCase()];
      if (!def || out.some((p) => p.id === name)) return;
      out.push({ ...def, id: name, name: name.replace(/\b\w/g, (c) => c.toUpperCase()).replace(/ (Of|The) /g, (w) => w.toLowerCase()), dc, toHit, level: level ?? def.level, perDay, spell: true });
    };
    if (sc.kind === 'slots') for (const [lvl, list] of Object.entries(sc.spells ?? {})) for (const n of list) add(n, Number(lvl));
    for (const n of sc.atWill ?? []) add(n, 0);
    for (const [per, list] of Object.entries(sc.perDay ?? {})) for (const n of list) add(n, null, Number(per));
  }
  for (const a of stat.actions ?? []) {
    if (a.attack) continue;
    const p = parseAreaAction(a);
    if (p) out.push(p);
  }
  return out;
}

/** Fresh uses for a creature: its spell slots (by level) and per-day counts; recharge powers start ready. */
export function freshMonsterUses(stat, powers) {
  const slots = { ...(stat.spellcasting?.kind === 'slots' ? stat.spellcasting.slots : {}) };
  const perDay = Object.fromEntries(powers.filter((p) => p.perDay).map((p) => [p.id, p.perDay]));
  const ready = Object.fromEntries(powers.filter((p) => p.recharge).map((p) => [p.id, true]));
  return { slots, perDay, ready };
}

/** Can it use this power now? (A levelled spell needs a slot of at least that level.) */
export function canUse(p, uses) {
  if (p.recharge) return !!uses.ready[p.id];
  if (p.perDay) return (uses.perDay[p.id] ?? 0) > 0;
  if (p.spell && p.level > 0 && uses.slots && Object.keys(uses.slots).length) return Object.entries(uses.slots).some(([l, n]) => Number(l) >= p.level && n > 0);
  return true;
}
/** Spend it: the lowest slot that fits, one daily use, or the recharge. */
export function spend(p, uses) {
  if (p.recharge) { uses.ready[p.id] = false; return; }
  if (p.perDay) { uses.perDay[p.id]--; return; }
  if (p.spell && p.level > 0 && Object.keys(uses.slots).length) {
    const l = Object.keys(uses.slots).map(Number).sort((a, b) => a - b).find((x) => x >= p.level && uses.slots[x] > 0);
    if (l) uses.slots[l]--;
  }
}
/** Start of its turn: each spent recharge power comes back on a d6 roll of `recharge` or more. */
export function rollRecharge(powers, uses, rng) {
  const back = [];
  for (const p of powers) if (p.recharge && !uses.ready[p.id] && rng(6) + 1 >= p.recharge) { uses.ready[p.id] = true; back.push(p); }
  return back;
}

/**
 * The squares an area covers. origin: the caster's top-left square and size; toward: the target point.
 *  - radius: every square within `size` of the point (a burst)
 *  - around: every square within `size` of the caster's block, not the caster itself
 *  - cone: squares within `size` of the caster whose direction is within ~26.6° of the aim
 *    (a 5e cone is as wide as it is long at its end: half-angle atan(1/2))
 *  - line: squares whose centre is within half a square of the line, out to `size`
 */
export function areaCells(p, caster, toward, inBounds) {
  const n = caster.size ?? 1; const o = centerOf(caster.pos, n); const span = spanOf(n);
  const own = new Set(cellsOf(caster.pos, n).map((c) => `${c.x},${c.y}`));
  const out = [];
  const R = p.shape === 'radius' ? p.size : p.size + span;
  const cx = p.shape === 'radius' ? toward.x : o.x; const cy = p.shape === 'radius' ? toward.y : o.y;
  const dx = toward.x - o.x; const dy = toward.y - o.y; const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len; const uy = dy / len;
  for (let y = Math.floor(cy - R - 1); y <= Math.ceil(cy + R + 1); y++) {
    for (let x = Math.floor(cx - R - 1); x <= Math.ceil(cx + R + 1); x++) {
      if (!inBounds(x, y) || own.has(`${x},${y}`)) continue;
      const vx = x - o.x; const vy = y - o.y; const along = vx * ux + vy * uy;
      let hit = false;
      if (p.shape === 'radius') hit = Math.max(Math.abs(x - toward.x), Math.abs(y - toward.y)) <= p.size;
      else if (p.shape === 'around') hit = blockDistance(caster.pos, n, { x, y }, 1) <= p.size;
      else if (p.shape === 'cone') hit = along > 0 && along <= p.size + span / 2 && Math.abs(vx * uy - vy * ux) <= along * 0.5 + 0.5;
      else if (p.shape === 'line') hit = along > 0 && along <= p.size + span / 2 && Math.abs(vx * uy - vy * ux) <= 0.5;
      if (hit) out.push({ x, y });
    }
  }
  return out;
}

/** How far it can be aimed from (squares). Cones, lines and rings start at the caster. */
export const powerRange = (p) => (p.kind === 'area' && p.shape !== 'radius' ? p.size : p.range ?? 12);
