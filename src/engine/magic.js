/**
 * Spellcasting and class-ability rules, kept free of the DOM so they can be tested.
 *
 * MANA is the fuel of magic (this game's own rule, in place of the rulebook's spell slots and
 * rests). A caster has a few mana crystals; a spell costs some of them by its circle (MANA_COST),
 * cantrips are free. Spent mana comes back only at a mana totem (one per dungeon floor) or by
 * sleeping at an inn or a camp; the same recovers class abilities' uses.
 *   full casters (loremaster, minstrel)  2 mana at level 1, rising to 10 at level 20
 *   half casters (ranger, warden)        2 mana from level 2 (when their magic starts), up to 6
 * The spell-slot table below still decides WHEN each circle of spells unlocks.
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

// ---------------------------------------------------------------------------
// Mana
// ---------------------------------------------------------------------------

/**
 * Mana crystals by level. Full casters: 2 + round(8 x (level - 1) / 19), a straight line from
 * 2 at level 1 to 10 at level 20 (3 at level 3, 4 at 5, 6 at 10, 8 at 15). Half casters follow
 * the same line at half their level (rounded up) once their magic begins at level 2: 2 to 6.
 */
export function manaFor(type, level) {
  const l = Math.max(1, Math.min(20, level));
  if (type === 'full') return 2 + Math.round((8 * (l - 1)) / 19);
  if (type === 'half') return l < 2 ? 0 : 2 + Math.round((8 * (Math.ceil(l / 2) - 1)) / 19);
  return 0;
}

/** Mana per spell circle: cantrips free; most spells 1; potent ones 2-3; the 9th circle 7. */
export const MANA_COST = [0, 1, 1, 2, 2, 3, 3, 4, 5, 7];
export const manaCost = (spell) => spell.mana ?? MANA_COST[spell.level] ?? 1;

/** Fresh resources for a delve: full mana and full ability uses. */
export function freshResources(hero) {
  const uses = {};
  for (const a of hero.abilities) if (a.maxUses !== Infinity) uses[a.id] = a.maxUses;
  const max = manaFor(hero.casterType, hero.level);
  return { mana: max, maxMana: max, uses, pool: hero.cls === 'warden' ? 5 * hero.level : 0, concentration: null };
}

/** Older saves kept spell slots: turn them into mana (full, at the hero's level). */
export function migrateResources(res, hero) {
  if (!res || res.maxMana !== undefined) return res;
  const max = manaFor(hero.casterType, hero.level);
  return { mana: max, maxMana: max, uses: res.uses ?? {}, pool: res.pool ?? 0, concentration: res.concentration ?? null };
}

/**
 * Recover at a mana totem, an inn or a camp: all mana, every ability's uses, the warden's pool.
 * Returns how much mana came back.
 */
export function replenish(res, hero) {
  const got = res.maxMana - res.mana;
  res.mana = res.maxMana;
  for (const a of hero.abilities) if (a.maxUses !== Infinity) res.uses[a.id] = a.maxUses;
  res.pool = hero.cls === 'warden' ? 5 * hero.level : 0;
  return got;
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

/** Arcane Recovery (loremaster): regain a quarter of your level in mana, rounded up (at least 1). */
export function arcaneRecovery(res, level) {
  const want = Math.max(1, Math.ceil(level / 4));
  const got = Math.min(want, res.maxMana - res.mana);
  res.mana += got;
  return got;
}

export { SPELLS_BY_ID, ABILITIES_BY_ID };
