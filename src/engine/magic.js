/**
 * Spellcasting and class-ability rules (5e SRD), kept free of the DOM so they can be tested.
 *
 * Spell slots are the "fuel" of magic: casting a spell of level n spends one slot of level n or
 * higher (a higher slot makes many spells stronger: "upcasting"). Slots come back on a long rest.
 * A full caster's slots follow the table below by level; a half caster (ranger, warden) uses the
 * same table at half their level, rounded up, starting at level 2.
 *
 * Save DC = 8 + proficiency bonus + spellcasting modifier. Spell attack = proficiency + modifier.
 */
import { SPELLS, ABILITIES, SPELLS_BY_ID, ABILITIES_BY_ID } from '../content/westlands/magic.js';
import { roll, cryptoRandomInt } from './dice.js';

/** Full-caster slots by character level: index i = number of slots of spell level i + 1. */
export const FULL_CASTER_SLOTS = [null,
  [2], [3], [4, 2], [4, 3], [4, 3, 2], [4, 3, 3], [4, 3, 3, 1], [4, 3, 3, 2], [4, 3, 3, 3, 1], [4, 3, 3, 3, 2],
  [4, 3, 3, 3, 2, 1], [4, 3, 3, 3, 2, 1], [4, 3, 3, 3, 2, 1, 1], [4, 3, 3, 3, 2, 1, 1], [4, 3, 3, 3, 2, 1, 1, 1],
  [4, 3, 3, 3, 2, 1, 1, 1], [4, 3, 3, 3, 2, 1, 1, 1, 1], [4, 3, 3, 3, 3, 1, 1, 1, 1], [4, 3, 3, 3, 3, 2, 1, 1, 1], [4, 3, 3, 3, 3, 2, 2, 1, 1],
];

export function slotsFor(type, level) {
  const l = Math.max(1, Math.min(20, level));
  if (type === 'full') return [...FULL_CASTER_SLOTS[l]];
  if (type === 'half') return l < 2 ? [] : [...FULL_CASTER_SLOTS[Math.ceil(l / 2)]];
  return [];
}

/** The first class level at which a caster of this type has a slot of spell level n. */
export function unlockLevel(type, n) {
  if (n === 0) return type === 'full' ? 1 : null;
  for (let l = 1; l <= 20; l++) if (slotsFor(type, l).length >= n) return l;
  return null;
}

export function casterInfo(cls, mods, pb) {
  const sc = cls?.spellcasting;
  if (!sc) return null;
  const mod = mods[sc.ability];
  return { ability: sc.ability, type: sc.type, mod, dc: 8 + pb + mod, attack: pb + mod };
}

/** Uses of an ability at a level (functions in the content get level and ability modifiers). */
export const abilityUses = (ab, level, mods) => (typeof ab.uses === 'function' ? ab.uses(level, mods) : ab.uses ?? Infinity);
export const abilityPer = (ab, level) => (typeof ab.per === 'function' ? ab.per(level) : ab.per);

/** Everything a hero of this class and level can do, plus what unlocks later. */
export function magicFor(cls, level, mods) {
  const type = cls?.spellcasting?.type ?? null;
  const spells = SPELLS.filter((sp) => sp.classes.includes(cls?.id)).map((sp) => ({ ...sp, unlock: unlockLevel(type, sp.level) }))
    .filter((sp) => sp.unlock !== null);
  const abilities = ABILITIES.filter((a) => a.class === cls?.id).map((a) => ({ ...a, unlock: a.minLevel }));
  return {
    type,
    spells: spells.filter((sp) => sp.unlock <= level),
    abilities: abilities.filter((a) => a.unlock <= level).map((a) => ({ ...a, maxUses: abilityUses(a, level, mods), period: abilityPer(a, level) })),
    locked: [...spells, ...abilities].filter((x) => x.unlock > level).sort((a, b) => a.unlock - b.unlock),
  };
}

/** Fresh resources for a delve: full slots, full ability uses, all hit dice. */
export function freshResources(hero) {
  const slots = slotsFor(hero.casterType, hero.level);
  const uses = {};
  for (const a of hero.abilities) if (a.maxUses !== Infinity) uses[a.id] = a.maxUses;
  return { slots: [...slots], maxSlots: [...slots], uses, hitDice: hero.level, pool: hero.cls === 'warden' ? 5 * hero.level : 0, concentration: null };
}

/** Lowest available slot level that can cast a spell of level n (0 = none free). */
export function lowestSlot(res, n) {
  if (n === 0) return 0;
  for (let i = n; i <= res.slots.length; i++) if (res.slots[i - 1] > 0) return i;
  return -1;
}

// ---------------------------------------------------------------------------
// Dice scaling
// ---------------------------------------------------------------------------

/** Add extra dice to a notation: addDice('3d6', '1d6', 2) -> '5d6'. Flat bonuses are kept. */
export function addDice(base, extra, times) {
  if (!extra || times <= 0) return base;
  const m = /^(\d+)d(\d+)(.*)$/.exec(base); const e = /^(\d+)d(\d+)$/.exec(extra);
  if (!m || !e || m[2] !== e[2]) return base;
  return `${Number(m[1]) + Number(e[1]) * times}d${m[2]}${m[3]}`;
}

/** Cantrips grow with the caster's level: one more die at 5, 11 and 17. */
export function cantripDice(dice, level) {
  const n = 1 + (level >= 5) + (level >= 11) + (level >= 17);
  return dice.replace(/^1d/, `${n}d`);
}

/** The dice a spell rolls when cast with a given slot (upcast) by a caster of a given level. */
export function spellDice(spell, slotLevel, casterLevel) {
  const e = spell.effect;
  if (!e.dice) return null;
  if (e.cantrip) return cantripDice(e.dice, casterLevel);
  return addDice(e.dice, spell.upcast?.dice, slotLevel - spell.level);
}
export const spellCount = (spell, slotLevel, key) => (spell.effect[key] ?? 1) + (spell.upcast?.[key] ?? 0) * Math.max(0, slotLevel - spell.level);

// ---------------------------------------------------------------------------
// Class features with numbers
// ---------------------------------------------------------------------------

export const sneakAttackDice = (level) => `${Math.ceil(level / 2)}d6`;
export function attacksPerAction(clsId, level) {
  if (clsId === 'warrior') return level >= 20 ? 4 : level >= 11 ? 3 : level >= 5 ? 2 : 1;
  if ((clsId === 'ranger' || clsId === 'warden') && level >= 5) return 2;
  return 1;
}
export const inspirationDie = (level) => (level >= 15 ? 'd12' : level >= 10 ? 'd10' : level >= 5 ? 'd8' : 'd6');

/** A monster's saving throw bonus: its listed save, or just the ability modifier. */
export const monsterSave = (stat, ability) => stat.saves?.[ability] ?? stat.mods[ability];

/** Concentration: when hurt, CON save with DC 10 or half the damage, whichever is higher. */
export const concentrationDC = (damage) => Math.max(10, Math.floor(damage / 2));

/**
 * A small reward for using a skill well (this is a house rule; the 5e rules give XP only for
 * overcoming challenges). Harder checks are worth more, and it scales with level so it stays a
 * small but steady trickle: roughly DC / 2 x level.
 */
export const skillXp = (dc, level) => Math.max(1, Math.round((dc / 2) * level));

// ---------------------------------------------------------------------------
// Rests
// ---------------------------------------------------------------------------

/**
 * Short rest (an hour): spend Hit Dice to heal (each: roll the hit die + CON modifier) until
 * healed or out of dice; abilities that recharge on a short rest come back.
 */
export function shortRest(res, hero, hp, maxHp, rng = cryptoRandomInt) {
  const rolls = [];
  let healed = 0;
  while (hp + healed < maxHp && res.hitDice > 0) {
    res.hitDice--;
    const r = roll(`1d${hero.hitDie}`, rng).total;
    const gain = Math.max(1, r + hero.conMod);
    rolls.push(r); healed += gain;
  }
  for (const a of hero.abilities) if (a.period === 'short' && a.maxUses !== Infinity) res.uses[a.id] = a.maxUses;
  return { healed: Math.min(healed, maxHp - hp), rolls };
}

/** Long rest (eight hours): everything back; you regain up to half your Hit Dice (min 1). */
export function longRest(res, hero) {
  res.slots = [...res.maxSlots];
  for (const a of hero.abilities) if (a.maxUses !== Infinity) res.uses[a.id] = a.maxUses;
  res.hitDice = Math.min(hero.level, res.hitDice + Math.max(1, Math.floor(hero.level / 2)));
  res.pool = hero.cls === 'warden' ? 5 * hero.level : 0;
}

/**
 * Resting in a dungeon is risky: roll a d6 for wandering monsters. A short rest is interrupted
 * on a 1 (1 in 6, about 17%); a long rest on a 1 or 2 (1 in 3).
 */
export function wanderingCheck(kind, rng = cryptoRandomInt) {
  const d6 = rng(6) + 1;
  return { d6, interrupted: kind === 'long' ? d6 <= 2 : d6 === 1 };
}

/** Arcane Recovery: regain slots whose levels add up to ceil(level / 2), highest first (max 5th). */
export function arcaneRecovery(res, level) {
  let budget = Math.ceil(level / 2);
  const got = [];
  for (let n = Math.min(5, res.maxSlots.length); n >= 1 && budget > 0; n--) {
    while (budget >= n && res.slots[n - 1] < res.maxSlots[n - 1]) { res.slots[n - 1]++; budget -= n; got.push(n); }
  }
  return got;
}

export { SPELLS_BY_ID, ABILITIES_BY_ID };
