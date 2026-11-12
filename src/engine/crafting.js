/**
 * Crafting: resources + skill + a roll.
 *
 * Three trades, each a skill from 0 to 100 that grows with practice (like Ultima Online's):
 *   smithing     STR   the forge: smelting ore into ingots, blades, mail and plate
 *   woodcraft    DEX   the workbench: bows, crossbows, staves, arrows, shields
 *   leatherwork  DEX   the tannery: tanning hides, leather armour, bandages, rope
 *
 * The roll:  d20 + ability modifier + rank/10 (0 to +10) + proficiency bonus with the trade's
 *            tools (dwarves of the Deep Halls are born to smith's tools), against the recipe's
 *            DC + its material's difficulty (mithral is harder to work than iron).
 *   P(success) = (21 - (DC - bonus)) / 20, clamped to 5%..95% (a natural 1 always fails,
 *                a natural 20 always succeeds).
 *   Superior  (a natural 20, or beating the DC by 10 or more): a superior piece, +1 to hit and
 *             damage, or +5% absorption, and worth twice as much (items.js QUALITY).
 *   Failure   by less than 5: half of each resource is lost (rounded up); the rest comes back.
 *   Botch     (a natural 1, or failing by 5 or more): every resource is lost.
 *
 * Getting better: a trivial recipe (success 95% or more) teaches nothing. Otherwise a success
 * adds a point to the skill (two if it was a long shot), a failure half a point; above 50 every
 * gain is halved. So 0 to 50 takes about fifty worthwhile crafts, 50 to 100 about a hundred.
 */
import { RECIPES_BY_ID } from '../content/crafting/recipes.js';
import { ITEMS_BY_ID } from '../content/items/catalogue.js';
import { makeItem, addItem, removeItem, isEquipped, itemName, whyNoRoom } from './items.js';
import { METALS } from './materials.js';
import { cryptoRandomInt } from './dice.js';

export const CRAFT_SKILLS = {
  smithing: { name: 'Smithing', ability: 'str', station: 'The forge', tool: /smith's tools/i },
  woodcraft: { name: 'Woodcraft', ability: 'dex', station: 'The workbench', tool: /woodcarver's tools|carpenter's tools/i },
  leatherwork: { name: 'Leatherwork', ability: 'dex', station: 'The tannery', tool: /leatherworker's tools/i },
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

/** The bonus on a crafting roll: ability + rank/10 + proficiency with the tools. */
export function craftBonus(sheet, draft, skill) {
  const ab = CRAFT_SKILLS[skill].ability;
  return (sheet?.mods?.[ab] ?? 0) + Math.floor(rankOf(draft, skill) / 10) + (toolProficient(sheet, skill) ? sheet?.proficiencyBonus ?? 2 : 0);
}

/** The DC of a recipe made of a material. */
export const recipeDc = (recipe, material = null) => recipe.dc + (material ? MATERIAL_DC[material] ?? 0 : 0);

/** Chances for a bonus against a DC: success, superior, botch (all 0..1). */
export function chances(bonus, dc) {
  const p = (need) => Math.min(20, Math.max(0, 21 - need)) / 20; // P(d20 >= need)
  const success = Math.min(0.95, Math.max(0.05, p(dc - bonus)));
  const superior = Math.max(0.05, p(dc + 10 - bonus)); // a natural 20 always shines
  const botch = Math.max(0.05, 1 - p(dc - 4 - bonus)); // a natural 1, or missing by 5+
  return { success, superior: Math.min(superior, success), botch: Math.min(botch, 1 - success) };
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

/** Skill gained from one attempt (see the header). */
export function skillGain(rank, bonus, dc, ok) {
  const c = chances(bonus, dc);
  if (c.success >= 0.95) return 0; // trivial: nothing to learn
  let g = ok ? (c.success < 0.5 ? 2 : 1) : 0.5;
  if (rank >= 50) g /= 2;
  return Math.min(100 - rank, g);
}

/**
 * Make something. `sheet`: the hero's derived character (abilities, features); `draft`: their
 * saved record (bag, crafts); `safe`: the company's safe (engine/safe.js) or null.
 * @returns {{ ok, outcome: 'superior'|'success'|'fail'|'botch', d20, bonus, total, dc, lost, made, gain, message }}
 */
export function craft({ recipeId, material = null, sheet, draft, safe = null, rng = cryptoRandomInt }) {
  const recipe = RECIPES_BY_ID[recipeId];
  if (!recipe) return { ok: false, message: 'No such recipe.' };
  if (recipe.slot && !MATERIALS_OF[recipe.slot.kind].includes(material)) return { ok: false, message: 'Choose what to make it of.' };
  if (!canAfford(recipe, material, draft, safe)) return { ok: false, message: 'You do not have everything it needs.' };
  const skill = recipe.skill;
  const bonus = craftBonus(sheet, draft, skill);
  const dc = recipeDc(recipe, material);
  const d20 = rng(20) + 1; const total = d20 + bonus;
  const outcome = d20 === 20 || (d20 !== 1 && total >= dc + 10) ? 'superior' : d20 !== 1 && total >= dc ? 'success' : d20 === 1 || total <= dc - 5 ? 'botch' : 'fail';
  const ok = outcome === 'superior' || outcome === 'success';
  // Resources: all used on a success; half lost on a near miss; all lost on a botch.
  const lost = [];
  for (const i of needs(recipe, material, draft, safe)) {
    const n = ok || outcome === 'botch' ? i.qty : Math.ceil(i.qty / 2);
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
  const rank = rankOf(draft, skill);
  const gain = skillGain(rank, bonus, dc, ok);
  if (gain) { draft.crafts ??= {}; draft.crafts[skill] = Math.round((rank + gain) * 10) / 10; }
  const name = made ? `${made.qty > 1 ? `${made.qty} × ` : ''}${itemName(made)}` : itemName({ id: recipe.output.id });
  const where = made?.inSafe ? ' (the bag is full: it went into the safe)' : '';
  const message = outcome === 'superior' ? `A masterwork! ${name}${where}.` : outcome === 'success' ? `Made: ${name}${where}.`
    : outcome === 'fail' ? `It goes wrong, but half the materials are saved.` : `Ruined: every material is lost.`;
  return { ok: true, outcome, d20, bonus, total, dc, lost, made, gain, skill, message };
}
