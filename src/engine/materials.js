/**
 * What armour and weapons are made of.
 *
 * Damage types. Physical blows (slashing, piercing, bludgeoning) land on a body part and are
 * stopped by the armour there (defence.js). Every other type (fire, cold, lightning, acid,
 * poison, necrotic, radiant, force, thunder, psychic) goes straight to total HP, lessened only by
 * the armour's overall resistance to it (the average over every point of the body).
 *
 * Form: how an armour is built (the starting point for each armour's own absorptions in
 * defence.js ARMOURS, which are set piece by piece):
 *   cloth (padded)   good against blunt blows, poor against points, burns
 *   leather, hide    even, a little against the elements
 *   mail             excellent against edges, poor against points and blunt blows; conducts lightning
 *   scale            good all round
 *   plate            excellent against edges, good against points
 *   natural          a creature's own hide, scales or shell: even
 *
 * Metal: what mail, scale and plate (and blades and axe heads) are forged from, inspired by
 * Ultima Online's ores. A metal scales the absorption, adds resistances, and changes weight,
 * price and stiffness; on a weapon it changes accuracy or damage.
 */
export const PHYSICAL = ['slashing', 'piercing', 'bludgeoning'];
export const ELEMENTS = ['fire', 'cold', 'lightning', 'acid', 'poison', 'necrotic', 'radiant', 'force', 'thunder', 'psychic'];
export const isPhysical = (type) => PHYSICAL.includes(type);

/** Absorption per damage type, as a share of the armour's base absorption. */
export const FORMS = {
  cloth: { label: 'cloth', slashing: 1, piercing: 0.8, bludgeoning: 1.3, fire: 0, cold: 1, lightning: 0.5, acid: 0.5 },
  leather: { label: 'leather', slashing: 1, piercing: 0.8, bludgeoning: 0.8, fire: 0.6, cold: 0.8, lightning: 0.6, acid: 0.5 },
  mail: { label: 'mail', slashing: 1.25, piercing: 0.6, bludgeoning: 0.6, fire: 0.3, cold: 0.3, lightning: 0, acid: 0.3 },
  scale: { label: 'scale', slashing: 1.1, piercing: 0.9, bludgeoning: 0.8, fire: 0.4, cold: 0.4, lightning: 0.2, acid: 0.4 },
  plate: { label: 'plate', slashing: 1.2, piercing: 1, bludgeoning: 0.8, fire: 0.5, cold: 0.4, lightning: 0, acid: 0.5 },
  natural: { label: 'natural', slashing: 1, piercing: 1, bludgeoning: 1, fire: 0.5, cold: 0.5, lightning: 0.5, acid: 0.5 },
};

/**
 * Metals. absorb: multiplies the armour's absorption; resist: added percentage points per type;
 * weight, value, hinder: multipliers; weapon: { toHit, damage, bane: { types, dice, type } };
 * tint: a CSS filter that recolours the steel icons.
 */
export const METALS = {
  iron: { name: 'Iron', absorb: 0.9, resist: {}, weight: 1.1, value: 0.7, hinder: 1, weapon: { toHit: 0, damage: -1 }, tint: 'grayscale(.6) brightness(.72) contrast(1.1)', rarity: 'common' },
  steel: { name: 'Steel', absorb: 1, resist: {}, weight: 1, value: 1, hinder: 1, weapon: { toHit: 0, damage: 0 }, tint: 'none', rarity: 'common' },
  bronze: { name: 'Bronze', absorb: 0.9, resist: { fire: 10, cold: 5 }, weight: 1.1, value: 1.2, hinder: 1, weapon: { toHit: 0, damage: -1 }, tint: 'sepia(1) saturate(2.2) hue-rotate(-12deg) brightness(.85)', rarity: 'common' },
  copper: { name: 'Copper', absorb: 0.8, resist: { acid: 10, poison: 10 }, weight: 1.1, value: 1.3, hinder: 1, weapon: { toHit: 0, damage: -1 }, tint: 'sepia(1) saturate(3.2) hue-rotate(-28deg) brightness(.8)', rarity: 'common' },
  'black-iron': { name: 'Black iron', absorb: 1, resist: { cold: 10, necrotic: 10 }, weight: 1.2, value: 1.5, hinder: 1.1, weapon: { toHit: 0, damage: 1 }, tint: 'grayscale(1) brightness(.42) contrast(1.3)', rarity: 'uncommon' },
  silver: { name: 'Silver', absorb: 0.85, resist: { necrotic: 15, radiant: 5 }, weight: 1.15, value: 4, hinder: 1, weapon: { toHit: 0, damage: 0, bane: { types: ['undead', 'fiend'], dice: '1d6', type: 'radiant' } }, tint: 'grayscale(1) brightness(1.35) contrast(1.05)', rarity: 'uncommon' },
  gold: { name: 'Gold', absorb: 0.7, resist: { fire: 15, acid: 15 }, weight: 1.6, value: 8, hinder: 1.3, weapon: { toHit: 0, damage: -2 }, tint: 'sepia(1) saturate(4) hue-rotate(4deg) brightness(1.08)', rarity: 'rare' },
  'dwarf-steel': { name: 'Dwarf-steel', absorb: 1.15, resist: { fire: 10, lightning: 5 }, weight: 1, value: 10, hinder: 1, weapon: { toHit: 0, damage: 1 }, tint: 'hue-rotate(195deg) saturate(1.8) brightness(.95)', rarity: 'rare' },
  mithral: { name: 'Mithral', absorb: 1.1, resist: { lightning: 10, cold: 5 }, weight: 0.5, value: 20, hinder: 0.5, weapon: { toHit: 1, damage: 0 }, tint: 'grayscale(1) brightness(1.45) sepia(.25) hue-rotate(170deg) saturate(1.6)', rarity: 'very-rare' },
};
export const DEFAULT_METAL = 'steel';

/** The form of each armour (defence.js ARMOURS has absorption and coverage). */
export const ARMOUR_FORM = {
  padded: 'cloth', leather: 'leather', 'studded-leather': 'leather', 'hide-armour': 'leather',
  'leather-cap': 'leather', 'leather-vambraces': 'leather', 'leather-gloves': 'leather', 'leather-leggings': 'leather',
  'chain-shirt': 'mail', 'mithral-shirt': 'mail', 'ring-mail': 'mail', 'chain-mail': 'mail', 'mail-coif': 'mail', 'mail-chausses': 'mail',
  'scale-mail': 'scale',
  breastplate: 'plate', 'half-plate': 'plate', splint: 'plate', plate: 'plate',
  'iron-helm': 'plate', 'great-helm': 'plate', 'steel-gorget': 'plate', 'steel-vambraces': 'plate', gauntlets: 'plate', 'steel-greaves': 'plate',
};
/** Weapons with no forged metal to speak of. */
const NOT_METAL = new Set(['club', 'greatclub', 'quarterstaff', 'sling', 'shortbow', 'longbow', 'light-crossbow', 'hand-crossbow', 'heavy-crossbow', 'whip', 'dart', 'javelin']);

/** Can this item be made of different metals? */
export function isMetal(def) {
  if (!def) return false;
  if (def.cat === 'armor') return ['mail', 'scale', 'plate'].includes(ARMOUR_FORM[def.id]);
  if (def.cat === 'weapon') return !NOT_METAL.has(def.id) && !def.magic;
  return false;
}
/** The metal an item is made of (its own default when nothing is recorded). */
export function metalOf(inst, def) {
  if (!isMetal(def)) return null;
  if (inst?.material && METALS[inst.material]) return inst.material;
  if (/mithral/.test(def.id)) return 'mithral';
  if (/iron/.test(def.id)) return 'iron';
  return DEFAULT_METAL;
}

/**
 * An armour piece's absorption against one damage type, in percent. Each piece has its own
 * absorption against each physical type (slashing, piercing, bludgeoning) and one overall figure
 * against every elemental type (defence.js ARMOURS). The metal scales the physical ones and adds
 * its own resistances to the elemental one; at most 75%, then x condition.
 *   physical:  abs[type] x metal.absorb
 *   elemental: abs.elemental + metal.resist[type]
 */
export function absorbFor({ abs, metal = null, condition = 100 }, type) {
  const m = METALS[metal] ?? null;
  const v = isPhysical(type) ? (abs?.[type] ?? 0) * (m?.absorb ?? 1) : (abs?.elemental ?? 0) + (m?.resist?.[type] ?? 0);
  return Math.max(0, Math.round(Math.min(75, v) * Math.max(0, Math.min(100, condition)) / 100));
}

/**
 * A metal rolled for loot: commoner metals often, rare ones more as the danger (challenge
 * rating) rises. `rng(n)` returns 0..n-1.
 */
export function rollMetal(cr = 1, rng = (n) => Math.floor(Math.random() * n)) {
  const deep = Math.min(10, cr);
  const table = [['steel', 40], ['iron', 25], ['bronze', 12], ['copper', 8], ['black-iron', 5 + deep], ['silver', 4 + deep / 2], ['gold', 2 + deep / 3], ['dwarf-steel', 1 + deep / 2], ['mithral', deep / 4]];
  const total = table.reduce((n, [, w]) => n + w, 0);
  let r = rng(Math.round(total * 100)) / 100;
  for (const [id, w] of table) { r -= w; if (r < 0) return id; }
  return 'steel';
}
