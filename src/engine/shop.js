/**
 * Buying from traders (the Trading Post, and caravans met in dungeons).
 *
 * Standard goods: every plain, common item in the catalogue (arms, armour, shields, ammunition,
 * potions of healing, tools, cloaks, plain jewellery) is always in stock, at its catalogue price.
 * A trader only stocks what a hero of your level could pay for with one dungeon's takings:
 *
 *   in stock  <=>  price <= HAUL_GP(level)
 *
 * HAUL_GP comes from simulating 60 dungeons per level (tools: coins found plus loot sold at 50%):
 * the median is about 210 gp at level 1, 270 gp at 3, 310 gp at 5 and 1,700 gp at 10 (monsters of
 * challenge 5+ carry far more coin). So the 1,500 gp plate armour waits until level 10, and
 * everything a level 1 hero sees costs at most one good delve.
 *
 * Magic and rare goods cost three times their value, and are rare: each trader has a 10% chance
 * of holding one, and the offer only changes after 3 more adventures (dungeon floors finished,
 * story battles won, campaign places cleared). The roll is seeded by the trader and the period,
 * so it stays the same however often you look.
 *
 *   period = floor(adventures / 3)
 *   P(an offer this period) = 0.10, so over 10 periods (30 adventures) P(at least one) = 1 - 0.9^10 = 65%
 *
 * Haggling works both ways: the rate a Persuasion check earns for selling (50% to 75%) also
 * takes the same number of points off buying prices, e.g. selling at 60% means buying at 90%.
 */
import { ITEMS } from '../content/items/catalogue.js';
import { itemDef, itemValue, isMagic, makeItem, itemRarity } from './items.js';
import { seededRng } from './dice.js';
import { rollMagicItem } from './loot.js';
import { BASE_RATE } from './trade.js';

export const MAGIC_MARKUP = 3;
export const RARE_CHANCE = 0.1;
export const REFRESH_EVERY = 3;
const GP = 100;

/** What one dungeon typically earns a hero of this level, in copper (see the note above). */
export function haulFor(level = 1) {
  if (level >= 10) return 1700 * GP;
  if (level >= 5) return 400 * GP;
  return 250 * GP;
}
/** The lowest level whose haul pays for this price (for "from level N" hints). */
export const levelFor = (price) => (price <= haulFor(1) ? 1 : price <= haulFor(5) ? 5 : 10);

/** Things a trader sells by the bundle rather than one at a time. */
export const BUNDLE = { arrows: 20, bolts: 20, 'sling-bullets': 20, torch: 5, bandage: 5, rations: 5 };

const STANDARD_CATS = new Set(['weapon', 'armor', 'shield', 'ammo', 'consumable', 'tool', 'clothing', 'jewelry']);
/** Plain goods any trader carries: common, not magic, worth something, not a key or quest item. */
export const isStandard = (def) => !!def && STANDARD_CATS.has(def.cat) && !def.magic && (def.rarity ?? 'common') === 'common'
  && def.value > 0 && !def.key && !def.quest;

/** The price multiplier for a sale: 1 for plain goods, 3 for magic or rare ones. */
export const markup = (inst) => (isMagic(inst) || itemRarity(inst) !== 'common' ? MAGIC_MARKUP : 1);

/**
 * What a hero pays for `inst` (its whole qty), in copper. `rate` is the haggled selling rate;
 * each point above 50% takes a point off (and an offended trader's 45% adds 5%).
 */
export function buyPrice(inst, rate = BASE_RATE) {
  const base = itemValue(inst) * markup(inst);
  return Math.ceil(base * (1 - (rate - BASE_RATE)));
}

/** Which offer period we are in, and how many adventures until the next one. */
export function period(adventures = 0) {
  const p = Math.floor(adventures / REFRESH_EVERY);
  return { period: p, nextIn: REFRESH_EVERY - (adventures % REFRESH_EVERY) };
}

const hash = (str) => { let h = 2166136261; for (const ch of String(str)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };

/** This trader's rare offer for a period: a magic item 10% of the time, else null. Deterministic. */
export function rareOffer(traderKey, periodNo, level = 1) {
  const rng = seededRng((hash(traderKey) ^ Math.imul(periodNo + 1, 2654435761)) >>> 0);
  if (rng(1000) >= RARE_CHANCE * 1000) return null;
  const inst = rollMagicItem(Math.max(1, level), rng);
  return { ...inst, uid: `rare-${traderKey}-${periodNo}` };
}

/**
 * Everything a trader offers a hero of `level`:
 *   { standard: [{ id, qty, price, def }], later: [{ id, def, from }], rare: { inst, price } | null }
 * `later` lists the goods too dear for now, with the level from which they are stocked.
 * `bought` is true when this period's rare item is already sold (it does not come back).
 */
export function stockFor({ traderKey, level = 1, adventures = 0, bought = false, rate = BASE_RATE }) {
  const cap = haulFor(level);
  const standard = []; const later = [];
  for (const def of ITEMS) {
    if (!isStandard(def)) continue;
    const qty = BUNDLE[def.id] ?? 1;
    const price = buyPrice({ id: def.id, qty }, rate);
    if (def.value * qty <= cap) standard.push({ id: def.id, qty, price, def });
    else later.push({ id: def.id, def, from: levelFor(def.value * qty) });
  }
  const { period: p, nextIn } = period(adventures);
  const offer = bought ? null : rareOffer(traderKey, p, level);
  return { standard, later, rare: offer ? { inst: offer, price: buyPrice(offer, rate) } : null, nextIn, period: p };
}

/**
 * Buy something: takes the coins and puts the item in the pack. `what` is a standard id, or
 * the rare offer's instance. Returns { ok, cost, inst, message }.
 */
export function buyItem(gear, what, rate = BASE_RATE) {
  const inst = typeof what === 'string' ? makeItem(what, BUNDLE[what] ?? 1) : { ...what, uid: undefined };
  if (!itemDef(inst)) return { ok: false, message: 'The trader has no such thing.' };
  if (typeof what === 'string' && !isStandard(itemDef(inst))) return { ok: false, message: 'Not for sale here.' };
  const cost = buyPrice(inst, rate);
  if ((gear.coins ?? 0) < cost) return { ok: false, cost, message: 'Not enough coin.' };
  gear.coins -= cost;
  const def = itemDef(inst);
  const same = def.stack && !inst.bonus ? gear.inventory.find((x) => x.id === inst.id && !x.bonus) : null;
  if (same) same.qty += inst.qty; else gear.inventory.push(typeof what === 'string' ? inst : makeItem(inst.id, inst.qty ?? 1, inst.bonus ? { bonus: inst.bonus } : {}));
  return { ok: true, cost, inst, message: null };
}
