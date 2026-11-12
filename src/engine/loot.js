/**
 * Rolling loot. Each table entry is an independent Bernoulli trial: with probability p the
 * item drops. If a monster has n entries, the expected number of drops is the sum of the p's
 * (linearity of expectation), and the chance of getting at least one magic item from k kills
 * is 1 - (1 - p)^k.
 */
import { ITEMS_BY_ID, RARITY_ORDER } from '../content/items/catalogue.js';
import { lootProfileFor, CHEST_PROFILE, ARMS_POOL, ARMOR_POOL } from '../content/items/loot-tables.js';
import { makeItem } from './items.js';
import { isMetal, rollMetal } from './materials.js';
import { cryptoRandomInt } from './dice.js';

const dice = (n, sides, rng) => { let t = 0; for (let i = 0; i < n; i++) t += rng(sides) + 1; return t; };
const between = ([lo, hi], rng) => lo + rng(hi - lo + 1);

/**
 * Coins carried by one creature, after the DMG "Individual Treasure" tables (electrum and
 * platinum are converted to silver and gold). Returned in copper pieces.
 */
export function rollCoins(cr, rng = cryptoRandomInt) {
  const d100 = rng(100) + 1;
  const cp = (n) => n; const sp = (n) => n * 10; const gp = (n) => n * 100;
  if (cr <= 4) {
    if (d100 <= 30) return cp(dice(5, 6, rng));
    if (d100 <= 60) return sp(dice(4, 6, rng));
    if (d100 <= 70) return sp(dice(3, 6, rng) * 5);
    if (d100 <= 95) return gp(dice(3, 6, rng));
    return gp(dice(1, 6, rng) * 10);
  }
  if (cr <= 10) {
    if (d100 <= 30) return cp(dice(4, 6, rng) * 100) + sp(dice(1, 6, rng) * 50);
    if (d100 <= 60) return sp(dice(6, 6, rng) * 10) + gp(dice(2, 6, rng) * 10);
    if (d100 <= 70) return sp(dice(3, 6, rng) * 50) + gp(dice(2, 6, rng) * 10);
    if (d100 <= 95) return gp(dice(4, 6, rng) * 10);
    return gp(dice(2, 6, rng) * 10 + dice(3, 6, rng) * 10);
  }
  if (cr <= 16) {
    if (d100 <= 20) return sp(dice(4, 6, rng) * 100) + gp(dice(1, 6, rng) * 100);
    if (d100 <= 35) return sp(dice(1, 6, rng) * 500) + gp(dice(2, 6, rng) * 100);
    if (d100 <= 75) return gp(dice(2, 6, rng) * 100 + dice(1, 6, rng) * 100);
    return gp(dice(2, 6, rng) * 100 + dice(2, 6, rng) * 100);
  }
  if (d100 <= 15) return sp(dice(2, 6, rng) * 1000) + gp(dice(8, 6, rng) * 100);
  if (d100 <= 55) return gp(dice(1, 6, rng) * 1000 + dice(1, 6, rng) * 1000);
  return gp(dice(1, 6, rng) * 1000 + dice(2, 6, rng) * 1000);
}

/** Magic grows more common, and more powerful, with challenge rating. */
export const magicScale = (cr) => Math.min(4, 1 + cr / 4);

function enchantTier(cr, rng) {
  const r = rng(100);
  if (cr < 5) return r < 90 ? 1 : 2;
  if (cr < 11) return r < 60 ? 1 : r < 95 ? 2 : 3;
  return r < 60 ? 2 : 3;
}

/** One magic item: 60% an enchanted weapon or armour ("Longsword of Might"), 40% a named treasure. */
export function rollMagicItem(cr, rng = cryptoRandomInt) {
  if (rng(100) < 60) {
    const bonus = enchantTier(cr, rng);
    const pool = rng(100) < 65 ? ARMS_POOL : ARMOR_POOL;
    return makeItem(pool[rng(pool.length)], 1, { bonus });
  }
  // Named treasures, weighted so rarer things turn up less often: uncommon 6, rare 3, very rare 1.
  const weight = { common: 8, uncommon: 6, rare: 3, 'very-rare': 1, legendary: 0 };
  const maxRarity = cr < 5 ? 'rare' : 'very-rare';
  const named = Object.values(ITEMS_BY_ID).filter((d) => d.magic || (d.cat === 'consumable' && d.rarity !== 'common' && d.use?.kind === 'heal'))
    .filter((d) => RARITY_ORDER.indexOf(d.rarity) <= RARITY_ORDER.indexOf(maxRarity));
  const total = named.reduce((t, d) => t + weight[d.rarity], 0);
  let pick = rng(total);
  for (const d of named) { pick -= weight[d.rarity]; if (pick < 0) return makeItem(d.id, 1); }
  return makeItem('potion-healing', 1);
}

/** Forged things found in the world come in many metals (materials.js); the deeper, the rarer. */
function forged(inst, cr, rng) {
  const def = ITEMS_BY_ID[inst.id];
  if (isMetal(def) && !inst.material && !/iron|mithral/.test(def.id)) { const m = rollMetal(cr, rng); if (m !== 'steel') inst.material = m; }
  return inst;
}

function rollProfile(profile, cr, rng) {
  const items = [];
  for (const e of profile.items) {
    if (rng(10000) < e.p * 10000) items.push(makeItem(e.id, between(e.qty, rng)));
  }
  if (profile.randomWeapon && rng(10000) < profile.randomWeapon * 10000) items.push(makeItem(ARMS_POOL[rng(ARMS_POOL.length)]));
  if (profile.randomArmor && rng(10000) < profile.randomArmor * 10000) items.push(makeItem(ARMOR_POOL[rng(ARMOR_POOL.length)]));
  if (profile.magic && rng(100000) < profile.magic * magicScale(cr) * 100000) items.push(rollMagicItem(cr, rng));
  for (const it of items) forged(it, cr, rng);
  let coins = 0;
  if (profile.coins) {
    // Fractional multipliers mean "sometimes carries money": 0.4 => 40% chance of a full roll.
    const whole = Math.floor(profile.coins); const frac = profile.coins - whole;
    for (let i = 0; i < whole; i++) coins += rollCoins(cr, rng);
    if (frac && rng(1000) < frac * 1000) coins += rollCoins(cr, rng);
  }
  return { coins, items };
}

/** Loot from a slain monster. */
export function rollMonsterLoot(stat, rng = cryptoRandomInt) {
  const loot = rollProfile(lootProfileFor(stat), stat.crValue ?? 0, rng);
  if (stat.type === 'dragon') addHoard(loot, stat, rng);
  return loot;
}

/** How many sure magic treasures a dragon guards, by age: wyrmling 1, young 2, adult 3, ancient 4. */
export function hoardSize(stat) {
  const id = stat.id ?? '';
  if (/ancient|wyrm\b|ember-wyrm/.test(id)) return 4;
  if (/adult/.test(id)) return 3;
  if (/young/.test(id)) return 2;
  return 1;
}

/**
 * A dragon's hoard, on top of what it carries: sure magic treasures (rolled as if the dragon
 * were 3 challenge ratings higher, so they run richer), gems, and a heap of coins.
 */
function addHoard(loot, stat, rng) {
  const cr = (stat.crValue ?? 0) + 3;
  for (let i = 0; i < hoardSize(stat); i++) loot.items.push(rollMagicItem(cr, rng));
  const gems = ['ruby', 'emerald', 'sapphire', 'diamond'];
  for (let i = 0; i < hoardSize(stat); i++) loot.items.push(makeItem(gems[rng(gems.length)], 1 + rng(2)));
  for (let i = 0; i < 2 * hoardSize(stat); i++) loot.coins += rollCoins(cr, rng);
  loot.hoard = true;
}

/** Loot in a treasure chest for a dungeon of the given level; better potions at higher levels. */
export function rollChestLoot(level, rng = cryptoRandomInt) {
  const cr = Math.max(0, level - 1);
  const loot = rollProfile(CHEST_PROFILE, cr, rng);
  if (level >= 5) for (const it of loot.items) if (it.id === 'potion-healing' && rng(2)) it.id = level >= 11 ? 'potion-superior-healing' : 'potion-greater-healing';
  if (!loot.items.length && !loot.coins) loot.items.push(makeItem('bandage', 2));
  return loot;
}

/** Expected number of item drops from a profile: the sum of the independent probabilities. */
export const expectedDrops = (stat) => lootProfileFor(stat).items.reduce((s, e) => s + e.p, 0);

/** Probability of at least one magic item after k kills of this creature. */
export const magicChanceAfter = (stat, k) => {
  const p = (lootProfileFor(stat).magic ?? 0) * magicScale(stat.crValue ?? 0);
  return 1 - (1 - p) ** k;
};

export { ITEMS_BY_ID };
