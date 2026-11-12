/**
 * Crafting: resources + a trade, on the D&D scale (and inspired by Ultima Online's crafting).
 *
 * Three trades, each with its own level from 1 to 20 and its own experience, kept apart from the
 * hero's: crafting never gives a hero XP, and a hero's level and abilities do not help at the bench.
 *   smithing     the forge: smelting ore into ingots; every weapon and every armour
 *   woodcraft    the bowyer's bench: bows, crossbows, arrows, bolts, bowstrings
 *   leatherwork  the tannery: tanning hides into leather, sinew, bandages, rope
 *
 * The roll:  d20 + trade level (+2 with the trade's tools: dwarves of the Deep Halls are born to
 *            smith's tools) against the recipe's DC (its difficulty + its material's: mithral +9).
 * Each recipe and material needs a trade level to try at all: DC - 12 (at least 1). At that level
 * the roll succeeds about 45% of the time; each level above adds 5%, up to 95%. So every new level
 * opens harder work, and makes the old work easier.
 *   Superior  a natural 20, or a roll of 11+ on the die that beats the DC by 10: +1 to hit and
 *             damage, or +5% absorption; worth twice as much; ingots and arrows come out double
 *   Failure   a natural 1, or under the DC: half of each material is lost (rounded up)
 *
 * Trade experience, on every attempt: the recipe's DC on a success, half of it on a failure,
 * nothing for work you cannot fail (95%). Levels: 30 x L x (L - 1) XP (level 2: 60, 5: 600,
 * 10: 2,700, 20: 11,400). Working at recipes near your level, that is about 8 attempts to level 2,
 * 60 to level 5, 220 to level 10 and 670 to master a trade (level 20).
 */
import { RECIPES_BY_ID } from '../content/crafting/recipes.js';
import { ITEMS_BY_ID } from '../content/items/catalogue.js';
import { makeItem, addItem, removeItem, isEquipped, itemName, whyNoRoom } from './items.js';
import { METALS } from './materials.js';
import { cryptoRandomInt } from './dice.js';

export const CRAFT_SKILLS = {
  smithing: { name: 'Smithing', station: 'The forge', tool: /smith's tools/i },
  woodcraft: { name: 'Woodcraft', station: 'The bowyer\'s bench', tool: /woodcarver's tools|carpenter's tools|bowyer/i },
  leatherwork: { name: 'Leatherwork', station: 'The tannery', tool: /leatherworker's tools/i },
};
export const CRAFT_IDS = Object.keys(CRAFT_SKILLS);

/** How much harder each material is to work than iron or ash. */
export const MATERIAL_DC = {
  iron: 0, copper: 0, steel: 2, bronze: 1, 'black-iron': 5, silver: 3, gold: 3, 'dwarf-steel': 7, mithral: 9,
  ash: 0, oak: 0, beech: 0, yew: 2, holly: 3, blackwood: 6, goldenwood: 9,
};
/** The resource that stands for each material in a recipe's slot. */
export const materialItem = (kind, m) => (kind === 'metal' ? `${m}-ingot` : `${m}-log`);
const MATERIALS_OF = {
  metal: ['iron', 'copper', 'bronze', 'steel', 'black-iron', 'silver', 'gold', 'dwarf-steel', 'mithral'],
  wood: ['ash', 'oak', 'beech', 'yew', 'holly', 'blackwood', 'goldenwood'],
};

export const TRADE_MAX = 20;
/** Trade experience needed for each level (index = level). */
export const TRADE_XP = Array.from({ length: TRADE_MAX + 1 }, (_, l) => (l <= 1 ? 0 : 30 * l * (l - 1)));
/** A hero's experience in a trade. */
export const tradeXp = (draft, skill) => Math.max(0, draft?.trades?.[skill] ?? 0);
/** A hero's level in a trade (1-20). */
export function tradeLevel(draft, skill) {
  const xp = tradeXp(draft, skill); let lv = 1;
  for (let l = 2; l <= TRADE_MAX; l++) if (xp >= TRADE_XP[l]) lv = l;
  return lv;
}
/** Title by level, for the workshop. */
export const tradeTitle = (lv) => (lv >= 20 ? 'Grandmaster' : lv >= 15 ? 'Master' : lv >= 10 ? 'Expert' : lv >= 5 ? 'Journeyman' : 'Apprentice');

/** Does this hero know the trade's tools (a race or class feature that names them)? */
export function toolProficient(sheet, skill) {
  const re = CRAFT_SKILLS[skill]?.tool;
  return !!re && (sheet?.features ?? []).some((f) => re.test(`${f.name} ${f.text ?? ''}`));
}

/** The bonus on the roll: trade level, +2 with the trade's tools. */
export const craftBonus = (sheet, draft, skill) => tradeLevel(draft, skill) + (toolProficient(sheet, skill) ? 2 : 0);

/** A recipe's DC in its material. */
export const recipeDc = (recipe, material = null) => recipe.dc + (material ? MATERIAL_DC[material] ?? 0 : 0);
/** The trade level a recipe needs, in its material: DC - 12, at least 1 (iron plate 6, mithral plate 15). */
export const minLevel = (recipe, material = null) => Math.max(1, recipeDc(recipe, material) - 12);

/** Chances for a bonus against a DC (0..1): success, superior, failure. */
export function chances(bonus, dc) {
  const atLeast = (face) => Math.min(20, Math.max(0, 21 - face)) / 20; // P(d20 >= face)
  const success = Math.min(0.95, Math.max(0.05, atLeast(dc - bonus)));
  const superior = Math.min(success, Math.max(0.05, atLeast(Math.max(11, dc + 10 - bonus))));
  return { success, superior, failure: 1 - success };
}
/** Trade XP from one attempt: the DC on a success, half on a failure, none if it could not fail. */
export const tradeXpFor = (dc, ok, success) => (success >= 0.95 ? 0 : ok ? dc : Math.floor(dc / 2));

// ---- Resources: the hero's bag first, then the company's safe -------------------------------------

/** How many of a resource the hero can use: unequipped in the bag, plus what is in the safe. */
export function countOf(id, draft, safe = null) {
  const bag = (draft.inventory ?? []).filter((x) => x.id === id && !x.bonus && !isEquipped(draft, x.uid)).reduce((n, x) => n + (x.qty ?? 1), 0);
  const box = (safe?.items() ?? []).filter((x) => x.id === id && !x.bonus).reduce((n, x) => n + (x.qty ?? 1), 0);
  return bag + box;
}
function takeOf(id, n, draft, safe) {
  let left = n;
  for (const x of [...(draft.inventory ?? [])]) {
    if (left <= 0) break;
    if (x.id !== id || x.bonus || isEquipped(draft, x.uid)) continue;
    left -= removeItem(draft.inventory, x.uid, left);
  }
  if (left > 0 && safe) left -= safe.remove(id, left);
  return n - left;
}

/** Everything a recipe needs, for a material: [{ id, qty, have }]. */
export function needs(recipe, material, draft, safe) {
  const list = recipe.inputs.map((i) => ({ ...i }));
  if (recipe.slot && material) list.unshift({ id: materialItem(recipe.slot.kind, material), qty: recipe.slot.qty, material: true });
  return list.map((i) => ({ ...i, have: countOf(i.id, draft, safe) }));
}
/** The materials a recipe can be made of, with whether the hero has enough of each. */
export function materialChoices(recipe, draft, safe) {
  if (!recipe.slot) return [];
  return MATERIALS_OF[recipe.slot.kind].map((m) => ({ id: m, name: METALS[m]?.name ?? m, have: countOf(materialItem(recipe.slot.kind, m), draft, safe), dc: recipeDc(recipe, m) }));
}
export const canAfford = (recipe, material, draft, safe) => (!recipe.slot || material) && needs(recipe, material, draft, safe).every((i) => i.have >= i.qty);

/**
 * Make something. `sheet`: the hero's derived character (abilities, features); `draft`: their
 * saved record (bag, crafts); `safe`: the company's safe (engine/safe.js) or null.
 * @returns {{ ok, outcome: 'superior'|'success'|'fail', d20, bonus, total, dc, chance, superiorChance, lost, made, gain, levelUp, message }}
 */
export function craft({ recipeId, material = null, sheet, draft, safe = null, rng = cryptoRandomInt }) {
  const recipe = RECIPES_BY_ID[recipeId];
  if (!recipe) return { ok: false, message: 'No such recipe.' };
  if (recipe.slot && !MATERIALS_OF[recipe.slot.kind].includes(material)) return { ok: false, message: 'Choose what to make it of.' };
  if (!canAfford(recipe, material, draft, safe)) return { ok: false, message: 'You do not have everything it needs.' };
  const skill = recipe.skill;
  const level = tradeLevel(draft, skill); const need = minLevel(recipe, material);
  if (level < need) return { ok: false, message: `Too difficult yet: it needs ${CRAFT_SKILLS[skill].name.toLowerCase()} level ${need}.` };
  const bonus = craftBonus(sheet, draft, skill);
  const dc = recipeDc(recipe, material);
  const c = chances(bonus, dc);
  const d20 = rng(20) + 1; const total = d20 + bonus;
  const outcome = d20 === 20 || (d20 >= 11 && total >= dc + 10) ? 'superior' : d20 !== 1 && total >= dc ? 'success' : 'fail';
  const ok = outcome !== 'fail';
  // Resources: all used on a success; half lost on a failure.
  const lost = [];
  for (const i of needs(recipe, material, draft, safe)) {
    const n = ok ? i.qty : Math.ceil(i.qty / 2);
    takeOf(i.id, n, draft, safe);
    if (!ok) lost.push({ id: i.id, qty: n });
  }
  let made = null;
  if (ok) {
    const extra = {};
    if (recipe.slot) extra.material = material;
    if (outcome === 'superior' && !ITEMS_BY_ID[recipe.output.id]?.stack) extra.quality = 'superior';
    made = makeItem(recipe.output.id, recipe.output.qty * (outcome === 'superior' && ITEMS_BY_ID[recipe.output.id]?.stack ? 2 : 1), extra);
    // Into the bag; if it is full, into the safe (if that is full too, the bag takes it anyway).
    if (whyNoRoom(draft, made, null) && safe?.add(made).ok) made.inSafe = true;
    else addItem(draft.inventory ??= [], made);
  }
  // Practice: trade experience, and perhaps a new level.
  const gain = tradeXpFor(dc, ok, c.success);
  const before = level;
  if (gain) { draft.trades ??= {}; draft.trades[skill] = tradeXp(draft, skill) + gain; }
  const levelUp = tradeLevel(draft, skill) > before ? tradeLevel(draft, skill) : null;
  const name = made ? `${made.qty > 1 ? `${made.qty} × ` : ''}${itemName(made)}` : itemName({ id: recipe.output.id });
  const where = made?.inSafe ? ' (the bag is full: it went into the safe)' : '';
  const message = outcome === 'superior' ? `A masterwork! ${name}${where}.` : outcome === 'success' ? `Made: ${name}${where}.`
    : `It goes wrong: half the materials are lost.`;
  return { ok: true, outcome, d20, bonus, total, dc, chance: c.success, superiorChance: c.superior, lost, made, gain, levelUp, skill, message };
}
