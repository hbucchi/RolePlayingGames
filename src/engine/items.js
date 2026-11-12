/**
 * Inventory and equipment rules. A hero carries a list of item *instances*
 * ({ uid, id, qty, bonus?, charges? }) that point into the catalogue, plus an `equipped`
 * map of slot -> uid. Everything a sheet shows (AC, attacks) is derived from those.
 *
 * Money is stored as a single number of copper pieces: 1 gp = 10 sp = 100 cp. Storing the
 * smallest unit avoids rounding errors (0.1 + 0.2 !== 0.3 in floating point, but 10 + 20 === 30).
 */
import { ITEMS_BY_ID, ENCHANT, ENCHANT_RARITY, RARITY_ORDER } from '../content/items/catalogue.js';
import { kg } from './units.js';

/** Arms and armour: the paper doll's first tab. */
export const SLOTS = [
  { id: 'mainHand', name: 'Main hand' }, { id: 'offHand', name: 'Off hand' }, { id: 'ranged', name: 'Ranged' },
  { id: 'head', name: 'Helm' }, { id: 'throat', name: 'Gorget' }, { id: 'body', name: 'Armour' },
  { id: 'arms', name: 'Vambraces' }, { id: 'hands', name: 'Gloves' }, { id: 'legs', name: 'Leg armour' }, { id: 'cloak', name: 'Cloak' },
];
/** Armour is worn in pieces: each slot protects its own part of the body (engine/defence.js). */
export const ARMOUR_SLOTS = ['head', 'throat', 'body', 'arms', 'hands', 'legs'];
/** Jewellery: the second tab. One necklace, a bracelet on each wrist, and a ring on each finger and thumb. */
const FINGERS = ['thumb', 'index finger', 'middle finger', 'ring finger', 'little finger'];
export const JEWEL_SLOTS = [
  { id: 'neck', name: 'Necklace', group: 'neck' },
  { id: 'wrist1', name: 'Left wrist', group: 'wrist' }, { id: 'wrist2', name: 'Right wrist', group: 'wrist' },
  ...['Left', 'Right'].flatMap((hand, h) => FINGERS.map((f, i) => ({ id: `ring${h * 5 + i + 1}`, name: `${hand} ${f}`, group: 'ring' }))),
];
export const ALL_SLOTS = [...SLOTS, ...JEWEL_SLOTS];
/** An item's slot kind and the slots of that kind (a ring may go on any of 10 fingers). */
export const SLOT_GROUPS = { neck: ['neck'], wrist: ['wrist1', 'wrist2'], ring: JEWEL_SLOTS.filter((s) => s.group === 'ring').map((s) => s.id) };

let counter = 0;
export const newUid = () => `i${Date.now().toString(36)}${(counter++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export const itemDef = (inst) => ITEMS_BY_ID[inst?.id] ?? null;

export function makeItem(id, qty = 1, extra = {}) {
  const def = ITEMS_BY_ID[id];
  if (!def) throw new Error(`Unknown item ${id}`);
  const inst = { uid: newUid(), id, qty: def.stack ? qty : 1, ...extra };
  if (def.charges && inst.charges === undefined) inst.charges = def.charges;
  return inst;
}

/** Display name, including enchantment: "Longsword of Might". */
export function itemName(inst) {
  const def = itemDef(inst);
  if (!def) return 'Unknown item';
  const suffix = inst.bonus && ENCHANT[def.cat]?.[inst.bonus];
  // A key names the door it opens: "Iron key (Armoury door)".
  if (inst.label) return `${def.name} (${inst.label})`;
  return suffix ? `${def.name} ${suffix}` : def.name;
}

export function itemRarity(inst) {
  const def = itemDef(inst);
  const base = def?.rarity ?? 'common';
  const ench = inst.bonus ? ENCHANT_RARITY[inst.bonus] : 'common';
  return RARITY_ORDER[Math.max(RARITY_ORDER.indexOf(base), RARITY_ORDER.indexOf(ench))];
}

export const isMagic = (inst) => !!(itemDef(inst)?.magic || inst.bonus);

/** Value in copper: magic bonuses multiply the price, as rarer items do in the DMG price bands. */
export function itemValue(inst) {
  const def = itemDef(inst);
  if (!def) return 0;
  const mult = inst.bonus ? [1, 20, 80, 300][inst.bonus] : 1;
  return def.value * mult * (inst.qty ?? 1);
}

// ---------------------------------------------------------------------------
// Inventory operations (they mutate the given list and return it)
// ---------------------------------------------------------------------------

/** Add an instance, merging stacks of the same plain stackable item. */
export function addItem(inv, inst) {
  const def = itemDef(inst);
  if (def?.stack && !inst.bonus) {
    const same = inv.find((x) => x.id === inst.id && !x.bonus);
    if (same) { same.qty += inst.qty; return inv; }
  }
  inv.push({ ...inst, uid: inst.uid ?? newUid() });
  return inv;
}

/** Remove n of an instance (the whole stack if n is omitted). Returns the removed amount. */
export function removeItem(inv, uid, n = Infinity) {
  const i = inv.findIndex((x) => x.uid === uid);
  if (i < 0) return 0;
  const take = Math.min(n, inv[i].qty ?? 1);
  inv[i].qty = (inv[i].qty ?? 1) - take;
  if (inv[i].qty <= 0) inv.splice(i, 1);
  return take;
}

export const countOf = (inv, id) => inv.filter((x) => x.id === id).reduce((n, x) => n + (x.qty ?? 1), 0);
export const findItem = (inv, id) => inv.find((x) => x.id === id) ?? null;

/** Use up n of an item id across stacks. Returns true if there were enough. */
export function consume(inv, id, n = 1) {
  if (countOf(inv, id) < n) return false;
  let left = n;
  for (const x of [...inv]) {
    if (x.id !== id || left <= 0) continue;
    left -= removeItem(inv, x.uid, left);
  }
  return true;
}

// ---------------------------------------------------------------------------
// Coins
// ---------------------------------------------------------------------------

/** Break a copper total into the fewest coins: integer division and remainders. */
export function splitCoins(cp) {
  const total = Math.max(0, Math.floor(cp));
  return { gp: Math.floor(total / 100), sp: Math.floor((total % 100) / 10), cp: total % 10 };
}
export function formatCoins(cp) {
  const c = splitCoins(cp);
  const parts = [c.gp && `${c.gp} gp`, c.sp && `${c.sp} sp`, c.cp && `${c.cp} cp`].filter(Boolean);
  return parts.length ? parts.join(', ') : '0 cp';
}

// ---------------------------------------------------------------------------
// Weight and carrying capacity (5e: STR score x 15 lb; 50 coins weigh a pound)
// ---------------------------------------------------------------------------

export function carriedWeight(inv, coins = 0) {
  const items = inv.reduce((w, x) => w + (itemDef(x)?.weight ?? 0) * (x.qty ?? 1), 0);
  const c = splitCoins(coins);
  return Math.round((items + (c.gp + c.sp + c.cp) / 50) * 10) / 10;
}
export const carryCapacity = (str) => str * 15;

/**
 * Carrying, for real. Two limits, both shown in the pack:
 *   Slots: the bag holds BAG_SLOTS things. A stack of the same plain item (arrows, potions, gems)
 *          shares one slot; what you wear or wield is on you, not in the bag; coins have a purse.
 *   Weight: everything counts, worn gear and coins too (50 coins weigh a pound).
 *          Above STR x 10 lb you are burdened (speed -10 ft); STR x 15 lb is all you can carry.
 */
export const BAG_SLOTS = 20;
export const loadLimits = (str) => ({ burdened: str * 10, max: carryCapacity(str) });
/** Bag slots in use: every unequipped item or stack. */
export const bagUsed = (gear) => (gear.inventory ?? []).filter((x) => !isEquipped(gear, x.uid)).length;
/** Does this item join a stack already in the bag (so it needs no new slot)? */
function joinsStack(gear, inst) {
  const def = itemDef(inst);
  return !!(def?.stack && !inst.bonus && (gear.inventory ?? []).some((x) => x.id === inst.id && !x.bonus && !isEquipped(gear, x.uid)));
}
/**
 * Why `inst` cannot go in the pack, or null if it can. `str` is the carrier's Strength score.
 * `freeing` is a slot that the same move frees (taking off one thing to put another on).
 */
export function whyNoRoom(gear, inst, str, { slot = true } = {}) {
  if (slot && !joinsStack(gear, inst) && bagUsed(gear) >= BAG_SLOTS) return `Your pack is full (${BAG_SLOTS} of ${BAG_SLOTS} slots). Drop, sell or use something first.`;
  if (str) {
    const after = carriedWeight([...(gear.inventory ?? []), inst], gear.coins ?? 0);
    const { max } = loadLimits(str);
    if (after > max) return `Too heavy: that would make ${kg(after)}, and you can carry at most ${kg(max)} (Strength ${str}).`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Equipping
// ---------------------------------------------------------------------------

/** Which slot an item goes in. A light weapon can also go in the off hand (two-weapon fighting). */
export function slotFor(inst, wanted) {
  const def = itemDef(inst);
  if (!def?.slot) return null;
  if (wanted === 'offHand' && def.cat === 'weapon' && def.weapon.light && !def.weapon.ranged) return 'offHand';
  if (wanted === 'mainHand' && def.cat === 'weapon' && !def.weapon.ranged) return 'mainHand';
  if (wanted === 'ranged' && def.cat === 'weapon' && (def.weapon.ranged || def.weapon.thrown)) return 'ranged';
  return def.slot;
}

const equippedDef = (gear, slot) => {
  const inst = gear.inventory.find((x) => x.uid === gear.equipped?.[slot]);
  return inst ? itemDef(inst) : null;
};

/**
 * Equip an item. Returns { ok, slot, message, freed: [slots emptied] }.
 * Two-handed weapons need the off hand free, so equipping one empties it (and vice versa).
 */
export function equipItem(gear, uid, wanted) {
  const inst = gear.inventory.find((x) => x.uid === uid);
  if (!inst) return { ok: false, message: 'You no longer have that.' };
  let slot = slotFor(inst, wanted);
  if (!slot) return { ok: false, message: `${itemName(inst)} cannot be equipped.` };
  gear.equipped ??= {};
  // Rings, bracelets: the finger or wrist asked for, else the first free one, else the first.
  const group = SLOT_GROUPS[slot];
  if (group && group.length > 1) {
    const here = Object.entries(gear.equipped).find(([, u]) => u === uid)?.[0];
    slot = group.includes(wanted) ? wanted : group.includes(here) ? here : group.find((x) => !gear.equipped[x]) ?? group[0];
  }
  const freed = [];
  for (const [s, u] of Object.entries(gear.equipped)) if (u === uid && s !== slot) { delete gear.equipped[s]; freed.push(s); }
  const def = itemDef(inst);
  if (slot === 'mainHand' && def.weapon?.twoHanded && gear.equipped.offHand) { delete gear.equipped.offHand; freed.push('offHand'); }
  if (slot === 'offHand' && equippedDef(gear, 'mainHand')?.weapon?.twoHanded) { delete gear.equipped.mainHand; freed.push('mainHand'); }
  gear.equipped[slot] = uid;
  return { ok: true, slot, freed, message: `${itemName(inst)} equipped (${ALL_SLOTS.find((s) => s.id === slot).name.toLowerCase()}).` };
}

export function unequipSlot(gear, slot) {
  if (!gear.equipped?.[slot]) return false;
  delete gear.equipped[slot];
  return true;
}

export const isEquipped = (gear, uid) => Object.values(gear.equipped ?? {}).includes(uid);
export const equippedIn = (gear, slot) => gear.inventory.find((x) => x.uid === gear.equipped?.[slot]) ?? null;

/** Drop dangling references (an equipped item that was sold, used up or lost). */
export function tidyEquipped(gear) {
  // Older saves had a single ring slot: it is the left thumb now.
  if (gear.equipped?.ring) { gear.equipped.ring1 ??= gear.equipped.ring; delete gear.equipped.ring; }
  for (const [slot, uid] of Object.entries(gear.equipped ?? {})) if (!gear.inventory.some((x) => x.uid === uid)) delete gear.equipped[slot];
  return gear;
}

// ---------------------------------------------------------------------------
// Proficiency, armour class and attacks from equipped gear
// ---------------------------------------------------------------------------

/** Does a class's weapon training cover this weapon? ("Martial weapons", or a named kind like "Short swords".) */
export function weaponProficient(def, profs = []) {
  const list = profs.map((p) => p.toLowerCase());
  if (list.includes(`${def.weapon.group} weapons`)) return true;
  const plural = `${def.name.toLowerCase()}s`;
  return list.some((p) => p === plural || p === `${def.name.toLowerCase()}es`);
}
export function armorProficient(def, profs = []) {
  const list = profs.map((p) => p.toLowerCase());
  if (list.includes('all armour')) return true;
  if (def.cat === 'shield') return list.includes('shields');
  return list.includes(`${def.armor.type} armour`);
}

const fmtMod = (n) => (n ? (n > 0 ? `+${n}` : `${n}`) : '');

/**
 * Everything gear contributes to a character.
 * @param gear { inventory, equipped }
 * @param ctx  { mods, scores, pb, weaponProfs, armorProfs }
 */
export function gearStats(gear, { mods, scores, pb, weaponProfs, armorProfs }) {
  const notes = [];
  const eq = (slot) => equippedIn(gear, slot);
  const bodyInst = eq('body'); const body = itemDef(bodyInst);
  const offInst = eq('offHand'); const off = itemDef(offInst);

  // Armour class: armour base + DEX (capped for medium, none for heavy) + shield + magic.
  let ac = 10 + mods.dex;
  if (body?.armor) {
    const a = body.armor;
    const dex = a.dexCap === null || a.dexCap === undefined ? mods.dex : Math.min(mods.dex, a.dexCap);
    ac = a.base + dex + (bodyInst.bonus ?? 0);
    if (a.str && scores.str < a.str) notes.push(`${body.name} needs STR ${a.str}: your speed drops by 3 m.`);
    if (a.stealthDis) notes.push(`${body.name} is noisy: disadvantage on Stealth.`);
    if (!armorProficient(body, armorProfs)) notes.push(`You are not trained in ${a.type} armour: disadvantage on STR and DEX checks and attacks.`);
  }
  if (off?.cat === 'shield') {
    ac += (off.acBonus ?? 2) + (offInst.bonus ?? 0);
    if (!armorProficient(off, armorProfs)) notes.push('You are not trained with shields.');
  }
  let hpBonus = 0; const skillBonus = {}; let saveBonus = 0; let magicAc = 0;
  for (const slot of ['cloak', ...JEWEL_SLOTS.map((j) => j.id), 'ring']) {
    const d = itemDef(eq(slot));
    if (!d) continue;
    ac += d.acBonus ?? 0; magicAc += d.acBonus ?? 0;
    hpBonus += d.hpBonus ?? 0;
    saveBonus += d.saveBonus ?? 0;
    for (const [k, v] of Object.entries(d.skillBonus ?? {})) skillBonus[k] = (skillBonus[k] ?? 0) + v;
  }

  // Attacks: one per equipped weapon. Finesse uses the better of STR and DEX, ranged
  // weapons use DEX, everything else STR. Proficiency adds your proficiency bonus to hit.
  const attacks = [];
  for (const slot of ['mainHand', 'offHand', 'ranged']) {
    const inst = eq(slot); const def = itemDef(inst);
    if (!def?.weapon) continue;
    const w = def.weapon;
    const ability = w.finesse ? (mods.str >= mods.dex ? 'str' : 'dex') : w.ranged ? 'dex' : 'str';
    const prof = weaponProficient(def, weaponProfs);
    const bonus = inst.bonus ?? def.bonus ?? 0;
    const twoHands = slot === 'mainHand' && w.versatile && !offInst;
    const die = twoHands ? w.versatile : w.damage;
    // An off-hand attack (two-weapon fighting) adds no ability modifier to damage, unless it is negative.
    const dmgMod = (slot === 'offHand' ? Math.min(0, mods[ability]) : mods[ability]) + bonus;
    const props = [...(w.props ?? [])];
    if (w.thrown && slot !== 'ranged') props.push(`thrown ${w.thrown}`);
    attacks.push({
      uid: inst.uid, slot, name: itemName(inst), ability, proficient: prof,
      toHit: mods[ability] + (prof ? pb : 0) + bonus,
      damage: `${die}${fmtMod(dmgMod)}`,
      damageType: w.type,
      properties: [...new Set(props.filter((p) => !p.startsWith('thrown') || slot !== 'ranged'))],
      ammo: w.ammo ?? null,
      magic: !!bonus,
    });
    if (!prof) notes.push(`Not trained with ${def.name.toLowerCase()}: no proficiency bonus to hit.`);
  }
  if (!attacks.some((a) => a.slot === 'mainHand' || a.slot === 'offHand')) {
    // Unarmed strike: 1 + STR modifier bludgeoning, always proficient.
    attacks.push({ uid: null, slot: 'unarmed', name: 'Unarmed strike', ability: 'str', proficient: true, toHit: mods.str + pb, damage: `${Math.max(1, 1 + mods.str)}`, damageType: 'bludgeoning', properties: [], ammo: null, magic: false });
  }
  return { ac, magicAc, attacks, notes: [...new Set(notes)], hpBonus, skillBonus, saveBonus, speedPenalty: body?.armor?.str && scores.str < body.armor.str ? 10 : 0 };
}

// ---------------------------------------------------------------------------
// Starting gear
// ---------------------------------------------------------------------------

export const PACKS = {
  traveller: [['bedroll'], ['rations', 3], ['waterskin'], ['tinderbox'], ['torch', 5], ['rope'], ['bandage', 5]],
  burglar: [['crowbar'], ['rations', 2], ['tinderbox'], ['torch', 5], ['rope'], ['bandage', 5]],
  scholar: [['ink-quill'], ['rations', 2], ['bandage', 3]],
  entertainer: [['bedroll'], ['rations', 3], ['waterskin'], ['bandage', 3]],
};

/** Build a new hero's inventory from class + background kits, and equip the obvious things. */
export function startingGear(cls, bg) {
  const inventory = [];
  const kit = [...(cls?.kit ?? []), ...(bg?.kit ?? [])];
  for (const entry of kit) {
    const [id, qty = 1] = Array.isArray(entry) ? entry : [entry];
    if (PACKS[id]) { for (const [pid, pq = 1] of PACKS[id]) addItem(inventory, makeItem(pid, pq)); continue; }
    addItem(inventory, makeItem(id, qty));
  }
  const gear = { inventory, equipped: {} };
  const first = (pred) => inventory.find((x) => pred(itemDef(x)));
  const body = first((d) => d.cat === 'armor' && d.slot === 'body'); if (body) gear.equipped.body = body.uid;
  const melee = first((d) => d.cat === 'weapon' && !d.weapon.ranged); if (melee) gear.equipped.mainHand = melee.uid;
  const ranged = first((d) => d.cat === 'weapon' && d.weapon.ranged); if (ranged) gear.equipped.ranged = ranged.uid;
  const shield = first((d) => d.cat === 'shield');
  if (shield && !itemDef(inventory.find((x) => x.uid === gear.equipped.mainHand))?.weapon?.twoHanded) gear.equipped.offHand = shield.uid;
  const cloak = first((d) => d.slot === 'cloak'); if (cloak) gear.equipped.cloak = cloak.uid;
  return { ...gear, coins: bg?.coins ?? 1000 };
}
