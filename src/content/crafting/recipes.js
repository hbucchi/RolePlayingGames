/**
 * The recipe book (engine/crafting.js plays them out).
 *
 *   { id, skill, group, dc, inputs: [{ id, qty }], slot?: { kind, qty }, output: { id, qty } }
 *
 * skill: who makes it.
 *   smithing     every weapon and every piece of armour (blades, mail and plate, but also clubs,
 *                staves, shields and leather armour): the smith is the armourer and weaponsmith
 *   woodcraft    bows and crossbows, and what they shoot: arrows, bolts, bowstrings
 *   leatherwork  supplies: tanning hides into leather, sinew, bandages, rope
 * slot:  a material the crafter chooses, which the made thing is then made of: kind 'metal'
 *        takes ingots (iron ... mithral), kind 'wood' takes logs (ash ... goldenwood). Rarer
 *        materials are harder to work (MATERIAL_DC in crafting.js).
 * Some inputs are themselves crafted ("composite"): ingots are smelted from ore, steel is made
 * from iron ingots, dwarf-steel from steel and silver, leather is tanned from hides, bowstrings
 * are twisted from silk or sinew.
 */
const R = (id, skill, group, dc, inputs, output, slot = null) => ({ id, skill, group, dc, inputs: inputs.map(([i, q]) => ({ id: i, qty: q })), output: typeof output === 'string' ? { id: output, qty: 1 } : output, slot });
const metal = (qty) => ({ kind: 'metal', qty });
const wood = (qty) => ({ kind: 'wood', qty });

export const RECIPES = [
  // ---- The forge: smelting (composite resources) ----------------------------------------------
  R('smelt-iron', 'smithing', 'Smelting', 8, [['iron-ore', 2], ['coal', 1]], 'iron-ingot'),
  R('smelt-copper', 'smithing', 'Smelting', 8, [['copper-ore', 2], ['coal', 1]], 'copper-ingot'),
  R('alloy-bronze', 'smithing', 'Smelting', 10, [['copper-ore', 1], ['tin-ore', 1], ['coal', 1]], 'bronze-ingot'),
  R('smelt-silver', 'smithing', 'Smelting', 12, [['silver-ore', 2], ['coal', 1]], 'silver-ingot'),
  R('smelt-gold', 'smithing', 'Smelting', 13, [['gold-ore', 2], ['coal', 1]], 'gold-ingot'),
  R('fold-steel', 'smithing', 'Smelting', 12, [['iron-ingot', 2], ['coal', 2]], 'steel-ingot'),
  R('quench-black-iron', 'smithing', 'Smelting', 15, [['iron-ingot', 2], ['coal', 1], ['bloodmoss', 1]], 'black-iron-ingot'),
  R('dwarf-steel', 'smithing', 'Smelting', 18, [['steel-ingot', 2], ['silver-ingot', 1], ['coal', 2]], 'dwarf-steel-ingot'),
  R('smelt-mithral', 'smithing', 'Smelting', 18, [['mithral-ore', 1], ['coal', 2]], 'mithral-ingot'),

  // ---- The forge: blades and heads (the metal is the crafter's choice) -------------------------
  ...[
    ['dagger', 9, 1, []], ['handaxe', 10, 1, [['ash-log', 1]]], ['sickle', 9, 1, [['ash-log', 1]]],
    ['mace', 10, 2, [['ash-log', 1]]], ['spear', 9, 1, [['ash-log', 1]]], ['shortsword', 11, 2, [['tanned-leather', 1]]],
    ['scimitar', 12, 2, [['tanned-leather', 1]]], ['long-knife', 11, 2, [['tanned-leather', 1]]], ['rapier', 14, 2, [['tanned-leather', 1]]],
    ['longsword', 13, 3, [['tanned-leather', 1]]], ['battleaxe', 12, 3, [['ash-log', 1]]], ['warhammer', 12, 3, [['ash-log', 1]]],
    ['war-pick', 12, 2, [['ash-log', 1]]], ['morningstar', 12, 3, [['ash-log', 1]]], ['flail', 13, 3, [['ash-log', 1]]],
    ['greatsword', 15, 5, [['tanned-leather', 1]]], ['greataxe', 14, 4, [['ash-log', 1]]], ['maul', 13, 5, [['ash-log', 1]]],
    ['glaive', 14, 3, [['ash-log', 2]]], ['halberd', 14, 3, [['ash-log', 2]]],
  ].map(([id, dc, n, extra]) => R(`forge-${id}`, 'smithing', 'Weapons', dc, extra, id, metal(n))),

  // ---- The forge: armour ------------------------------------------------------------------------
  ...[
    ['chain-shirt', 12, 6, []], ['ring-mail', 11, 6, [['tanned-leather', 2]]], ['scale-mail', 13, 8, [['tanned-leather', 2]]],
    ['chain-mail', 14, 9, []], ['breastplate', 14, 6, [['tanned-leather', 1]]], ['half-plate', 16, 10, [['tanned-leather', 2]]],
    ['splint', 16, 11, [['tanned-leather', 2]]], ['plate', 18, 14, [['tanned-leather', 2]]],
    ['iron-helm', 11, 3, []], ['mail-coif', 11, 2, []], ['great-helm', 14, 4, [['tanned-leather', 1]]], ['steel-gorget', 12, 2, []],
    ['steel-vambraces', 12, 3, [['tanned-leather', 1]]], ['gauntlets', 13, 2, [['tanned-leather', 1]]], ['mail-chausses', 13, 4, []],
    ['steel-greaves', 13, 3, [['tanned-leather', 1]]],
  ].map(([id, dc, n, extra]) => R(`forge-${id}`, 'smithing', 'Armour', dc, extra, id, metal(n))),

  // ---- The workbench: bows, staves and shafts (the wood is the crafter's choice) ----------------
  R('twist-bowstring', 'woodcraft', 'Parts', 9, [['spider-silk', 2]], { id: 'bowstring', qty: 2 }),
  R('carve-club', 'smithing', 'Weapons', 5, [], 'club', wood(1)),
  R('carve-greatclub', 'smithing', 'Weapons', 6, [], 'greatclub', wood(3)),
  R('carve-quarterstaff', 'smithing', 'Weapons', 8, [], 'quarterstaff', wood(2)),
  R('carve-javelin', 'smithing', 'Weapons', 9, [['iron-ingot', 1]], { id: 'javelin', qty: 2 }, wood(1)),
  R('carve-shortbow', 'woodcraft', 'Weapons', 11, [['bowstring', 1]], 'shortbow', wood(2)),
  R('carve-longbow', 'woodcraft', 'Weapons', 14, [['bowstring', 1]], 'longbow', wood(3)),
  R('carve-light-crossbow', 'woodcraft', 'Weapons', 14, [['bowstring', 1], ['iron-ingot', 1]], 'light-crossbow', wood(2)),
  R('carve-hand-crossbow', 'woodcraft', 'Weapons', 15, [['bowstring', 1], ['steel-ingot', 1]], 'hand-crossbow', wood(1)),
  R('carve-heavy-crossbow', 'woodcraft', 'Weapons', 16, [['bowstring', 1], ['steel-ingot', 2]], 'heavy-crossbow', wood(3)),
  R('fletch-arrows', 'woodcraft', 'Ammunition', 8, [['ash-log', 1], ['feathers', 2], ['iron-ingot', 1]], { id: 'arrows', qty: 20 }),
  R('fletch-bolts', 'woodcraft', 'Ammunition', 9, [['oak-log', 1], ['feathers', 1], ['iron-ingot', 1]], { id: 'bolts', qty: 20 }),
  R('build-shield', 'smithing', 'Armour', 10, [['oak-log', 3], ['iron-ingot', 1], ['tanned-leather', 1]], 'shield'),

  // ---- The tannery: leather and cloth -------------------------------------------------------------
  R('tan-hide', 'leatherwork', 'Tanning', 7, [['hide', 2], ['oak-log', 1]], 'tanned-leather'),
  R('tan-pelt', 'leatherwork', 'Tanning', 9, [['wolf-pelt', 1], ['oak-log', 1]], { id: 'tanned-leather', qty: 2 }),
  R('sinew-bowstring', 'leatherwork', 'Tanning', 8, [['hide', 1]], 'bowstring'),
  R('cut-bandages', 'leatherwork', 'Supplies', 5, [['cloth', 1]], { id: 'bandage', qty: 3 }),
  R('braid-rope', 'leatherwork', 'Supplies', 9, [['hide', 2]], 'rope'),
  R('weave-elven-rope', 'leatherwork', 'Supplies', 15, [['spider-silk', 6]], 'elven-rope'),
  R('sew-padded', 'smithing', 'Armour', 7, [['cloth', 4]], 'padded'),
  R('stitch-leather', 'smithing', 'Armour', 9, [['tanned-leather', 4]], 'leather'),
  R('stitch-studded', 'smithing', 'Armour', 12, [['tanned-leather', 5], ['iron-ingot', 1]], 'studded-leather'),
  R('stitch-hide-armour', 'smithing', 'Armour', 8, [['hide', 4], ['tanned-leather', 1]], 'hide-armour'),
  R('stitch-leather-cap', 'smithing', 'Armour', 7, [['tanned-leather', 1]], 'leather-cap'),
  R('stitch-leather-vambraces', 'smithing', 'Armour', 8, [['tanned-leather', 2]], 'leather-vambraces'),
  R('stitch-leather-gloves', 'smithing', 'Armour', 8, [['tanned-leather', 1]], 'leather-gloves'),
  R('stitch-leather-leggings', 'smithing', 'Armour', 9, [['tanned-leather', 3]], 'leather-leggings'),
  R('stitch-sling', 'smithing', 'Weapons', 6, [['tanned-leather', 1]], 'sling'),
  R('braid-whip', 'smithing', 'Weapons', 9, [['tanned-leather', 2]], 'whip'),
];
export const RECIPES_BY_ID = Object.fromEntries(RECIPES.map((r) => [r.id, r]));

/** What a crafter can buy at the workshop to begin with: plain, common supplies (price = value). */
export const SUPPLIES = ['coal', 'iron-ore', 'copper-ore', 'tin-ore', 'ash-log', 'oak-log', 'hide', 'cloth', 'feathers'];
