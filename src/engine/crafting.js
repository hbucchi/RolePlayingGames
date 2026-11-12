/**
 * Crafting: resources + skill, the way Ultima Online does it.
 *
 * Three trades, each a skill from 0.0 to 100.0, kept apart from everything else a hero is: they
 * do not use the hero's level, abilities or XP, and crafting never gives XP. A trade grows only by
 * practising it.
 *   smithing     the forge: smelting ore into ingots; every weapon and every armour
 *   woodcraft    the bowyer's bench: bows, crossbows, arrows, bolts, bowstrings
 *   leatherwork  the tannery: tanning hides into leather, sinew, bandages, rope
 *
 * Every recipe has a target skill (its difficulty, and its material's: mithral is harder than
 * iron). Your chance to make it:
 *   success  = 50% + 1% for each point your skill is above the target   (0% to 100%)
 *              so at the target it is a coin toss, 50 points above it is certain, and 50
 *              below it is impossible (the recipe is shown, but you cannot try it yet)
 *   superior = 1% for every 2 points above the target, up to 25%  (+1 to hit and damage, or +5%
 *              absorption; worth twice as much; ingots and arrows come out double)
 *   failure  = the rest: half of each material is lost (rounded up)
 * Knowing the trade's tools (dwarves of the Deep Halls with smith's tools) counts as 5 more points.
 *
 * Getting better, on every attempt (a success or a failure):
 *   chance to gain = ((100 - skill) / 100 + (1 - success chance)) / 2
 * so you learn most from hard work and while you are still green; a recipe you cannot fail
 * teaches nothing. Each gain is worth 1.0 point up to 30, 0.5 up to 60, 0.3 up to 90 and 0.1
 * after that. Working at recipes near your skill: about 45 attempts to reach 30, 170 to 60,
 * 450 to 90 and 800 to 1,300 to master a trade (100): the last ten points are a master's slow work.
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

/** A hero's rank in a trade (0-100). */
export const rankOf = (draft, skill) => Math.min(100, Math.max(0, draft?.crafts?.[skill] ?? 0));

/** Does this hero know the trade's tools (a race or class feature that names them)? */
export function toolProficient(sheet, skill) {
  const re = CRAFT_SKILLS[skill]?.tool;
  return !!re && (sheet?.features ?? []).some((f) => re.test(`${f.name} ${f.text ?? ''}`));
}

/** Your working skill in a trade: its rank, plus 5 if you know the trade's tools. */
export const effectiveSkill = (sheet, draft, skill) => rankOf(draft, skill) + (toolProficient(sheet, skill) ? 5 : 0);
/** Kept for the old name: the working skill. */
export const craftBonus = effectiveSkill;

/** A recipe's difficulty in its material, as a DC (shown to the player) and a target skill. */
export const recipeDc = (recipe, material = null) => recipe.dc + (material ? MATERIAL_DC[material] ?? 0 : 0);
/** DC 8 (smelting iron) is a target of 0; each DC point is 5 skill points (plate of mithral: 95). */
export const targetSkill = (recipe, material = null) => Math.min(100, Math.max(0, (recipeDc(recipe, material) - 8) * 5));

/** Chances with a working skill against a target (0..1): success, superior, failure. */
export function chances(skill, target) {
  const success = Math.min(1, Math.max(0, 0.5 + (skill - target) / 100));
  const superior = success > 0 ? Math.min(0.25, Math.max(0, (skill - target) / 200)) : 0;
  return { success, superior: Math.min(superior, success), failure: 1 - success };
}

/** Points gained per step at a rank: quick while green, slow near mastery. */
export const gainStep = (rank) => (rank < 30 ? 1 : rank < 60 ? 0.5 : rank < 90 ? 0.3 : 0.1);
/** The chance an attempt teaches something (see the header). Trivial or impossible work: none. */
export function gainChance(rank, success) {
  if (success >= 1 || success <= 0 || rank >= 100) return 0;
  return ((100 - rank) / 100 + (1 - success)) / 2;
}

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
 * @returns {{ ok, outcome: 'superior'|'success'|'fail', d100, skillValue, target, chance, superiorChance, gainChance, lost, made, gain, message }}
 */
export function craft({ recipeId, material = null, sheet, draft, safe = null, rng = cryptoRandomInt }) {
  const recipe = RECIPES_BY_ID[recipeId];
  if (!recipe) return { ok: false, message: 'No such recipe.' };
  if (recipe.slot && !MATERIALS_OF[recipe.slot.kind].includes(material)) return { ok: false, message: 'Choose what to make it of.' };
  if (!canAfford(recipe, material, draft, safe)) return { ok: false, message: 'You do not have everything it needs.' };
  const skill = recipe.skill;
  const eff = effectiveSkill(sheet, draft, skill);
  const target = targetSkill(recipe, material);
  const c = chances(eff, target);
  if (c.success <= 0) return { ok: false, message: `Too difficult yet: it needs about ${target - 50} ${CRAFT_SKILLS[skill].name.toLowerCase()} to try.` };
  const d100 = rng(100) + 1; // 1..100: at or under the chance succeeds
  const outcome = d100 <= Math.round(c.superior * 100) ? 'superior' : d100 <= Math.round(c.success * 100) ? 'success' : 'fail';
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
  // Practice: a chance to get better, success or not (see the header).
  const rank = rankOf(draft, skill);
  const gc = gainChance(rank, c.success);
  const gain = rng(1000) < gc * 1000 ? Math.min(100 - rank, gainStep(rank)) : 0;
  if (gain) { draft.crafts ??= {}; draft.crafts[skill] = Math.round((rank + gain) * 10) / 10; }
  const name = made ? `${made.qty > 1 ? `${made.qty} × ` : ''}${itemName(made)}` : itemName({ id: recipe.output.id });
  const where = made?.inSafe ? ' (the bag is full: it went into the safe)' : '';
  const message = outcome === 'superior' ? `A masterwork! ${name}${where}.` : outcome === 'success' ? `Made: ${name}${where}.`
    : `It goes wrong: half the materials are lost.`;
  return { ok: true, outcome, d100, skillValue: eff, target, chance: c.success, superiorChance: c.superior, gainChance: gc, lost, made, gain, skill, message };
}
