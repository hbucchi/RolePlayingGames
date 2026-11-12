/**
 * The item catalogue. Inspired by the breadth of classic sandbox RPG item systems (Ultima
 * Online especially): arms and armour, magic gear named by its power, consumables, working
 * tools, and raw crafting resources (logs of different woods, ores, hides, herbs, gems).
 *
 * Weapon and armour numbers follow the 5e SRD 5.1 (CC-BY-4.0). Values are in copper pieces:
 * 1 gp = 10 sp = 100 cp. Weights are in pounds.
 *
 * Every item: { id, name, cat, rarity, weight, value, stack?, desc, glyph, icon?, slot?, ... }
 *   cat:    weapon | armor | shield | ammo | consumable | tool | resource | gem | clothing | jewelry | trinket
 *   rarity: common | uncommon | rare | very-rare | legendary
 *   slot:   mainHand | offHand | ranged | body | cloak | neck | wrist | ring
 *           (a hero wears 1 necklace, a bracelet on each wrist and up to 10 rings: items.js JEWEL_SLOTS)
 */

import { metricText } from '../../engine/units.js';

const GP = 100; const SP = 10;
const icon = (id) => `assets/items/${id}.jpg`;
// Every item has its own picture in assets/items/<id>.jpg (tests/items-art.test.js checks it);
// an item may borrow another's with icon: icon('other-id').


const items = [];
// Nothing weighs nothing: small things get a small weight (in pounds) so every item counts.
const SMALLEST = { ring: 0.05, gem: 0.05, neck: 0.1, wrist: 0.2, weapon: 0.25, tool: 0.2 };
const add = (o) => {
  const weight = o.weight > 0 ? o.weight : SMALLEST[o.slot] ?? SMALLEST[o.cat] ?? 0.1;
  items.push({ rarity: 'common', stack: false, value: 0, glyph: '•', ...o, weight, icon: o.icon ?? icon(o.id) });
};

// ---------------------------------------------------------------------------
// Weapons. damage: base die; props mirror the SRD weapon properties.
// ---------------------------------------------------------------------------
const weapon = (id, name, group, damage, type, value, weight, props = [], extra = {}) => {
  const w = { damage, type, group, props };
  for (const p of props) {
    if (p === 'finesse') w.finesse = true;
    if (p === 'light') w.light = true;
    if (p === 'two-handed') w.twoHanded = true;
    if (p.startsWith('versatile')) w.versatile = p.split(' ')[1];
    if (p.startsWith('thrown')) w.thrown = p.split(' ')[1];
    if (p.startsWith('range')) { w.range = p.split(' ')[1]; w.ranged = true; }
    if (p.startsWith('ammo')) w.ammo = p.split(' ')[1];
  }
  add({
    id, name, cat: 'weapon', weight, value, glyph: w.ranged ? '🏹' : '⚔', slot: w.ranged ? 'ranged' : 'mainHand',
    weapon: w, desc: extra.desc ?? metricText(`${group === 'simple' ? 'A simple' : 'A martial'} weapon: ${damage} ${type}${props.length ? ` (${props.join(', ')})` : ''}.`), ...extra,
  });
};

// Simple melee
weapon('club', 'Club', 'simple', '1d4', 'bludgeoning', 1 * SP, 2, ['light']);
weapon('dagger', 'Dagger', 'simple', '1d4', 'piercing', 2 * GP, 1, ['finesse', 'light', 'thrown 20/60'], { desc: 'A plain, double-edged dagger. Quick in the hand, and it can be thrown.' });
weapon('greatclub', 'Greatclub', 'simple', '1d8', 'bludgeoning', 2 * SP, 10, ['two-handed']);
weapon('handaxe', 'Handaxe', 'simple', '1d6', 'slashing', 5 * GP, 2, ['light', 'thrown 20/60']);
weapon('javelin', 'Javelin', 'simple', '1d6', 'piercing', 5 * SP, 2, ['thrown 30/120']);
weapon('light-hammer', 'Light hammer', 'simple', '1d4', 'bludgeoning', 2 * GP, 2, ['light', 'thrown 20/60']);
weapon('mace', 'Mace', 'simple', '1d6', 'bludgeoning', 5 * GP, 4);
weapon('quarterstaff', 'Quarterstaff', 'simple', '1d6', 'bludgeoning', 2 * SP, 4, ['versatile 1d8'], { desc: 'A shod staff of ash wood, as useful on the road as in a fight.' });
weapon('sickle', 'Sickle', 'simple', '1d4', 'slashing', 1 * GP, 2, ['light']);
weapon('spear', 'Spear', 'simple', '1d6', 'piercing', 1 * GP, 3, ['thrown 20/60', 'versatile 1d8'], { desc: 'A leaf-bladed spear on an ash shaft. It can be thrown or used two-handed.' });
// Simple ranged
weapon('light-crossbow', 'Light crossbow', 'simple', '1d8', 'piercing', 25 * GP, 5, ['range 80/320', 'ammo bolts', 'two-handed']);
weapon('dart', 'Dart', 'simple', '1d4', 'piercing', 5, 0.25, ['finesse', 'thrown 20/60']);
weapon('shortbow', 'Shortbow', 'simple', '1d6', 'piercing', 25 * GP, 2, ['range 80/320', 'ammo arrows', 'two-handed'], { desc: 'A short recurved bow, easy to shoot in close tunnels.' });
weapon('sling', 'Sling', 'simple', '1d4', 'bludgeoning', 1 * SP, 0, ['range 30/120', 'ammo sling-bullets'], { desc: 'A leather strap and pouch. Every halfling child learns it before they can read.' });
// Martial melee
weapon('battleaxe', 'Battleaxe', 'martial', '1d8', 'slashing', 10 * GP, 4, ['versatile 1d10']);
weapon('flail', 'Flail', 'martial', '1d8', 'bludgeoning', 10 * GP, 2);
weapon('glaive', 'Glaive', 'martial', '1d10', 'slashing', 20 * GP, 6, ['heavy', 'reach', 'two-handed']);
weapon('greataxe', 'Greataxe', 'martial', '1d12', 'slashing', 30 * GP, 7, ['heavy', 'two-handed']);
weapon('greatsword', 'Greatsword', 'martial', '2d6', 'slashing', 50 * GP, 6, ['heavy', 'two-handed']);
weapon('halberd', 'Halberd', 'martial', '1d10', 'slashing', 20 * GP, 6, ['heavy', 'reach', 'two-handed']);
weapon('longsword', 'Longsword', 'martial', '1d8', 'slashing', 15 * GP, 3, ['versatile 1d10'], { desc: 'A straight, well-balanced sword of the West. One hand or two.' });
weapon('maul', 'Maul', 'martial', '2d6', 'bludgeoning', 10 * GP, 10, ['heavy', 'two-handed']);
weapon('morningstar', 'Morningstar', 'martial', '1d8', 'piercing', 15 * GP, 4);
weapon('rapier', 'Rapier', 'martial', '1d8', 'piercing', 25 * GP, 2, ['finesse']);
weapon('scimitar', 'Scimitar', 'martial', '1d6', 'slashing', 25 * GP, 3, ['finesse', 'light'], { desc: 'A curved, notched blade of goblin make. Crude, but sharp.' });
weapon('shortsword', 'Short sword', 'martial', '1d6', 'piercing', 10 * GP, 2, ['finesse', 'light'], { desc: 'A short, leaf-shaped blade, ideal for small hands and quick work.' });
// Silvered blades (materials.js 'silver', worth 4x): they bite creatures that shrug off plain steel
// (werewolves, many devils and spirits) and burn the undead and fiends for an extra 1d6 radiant.
// Sold by every trader, so a party can prepare before such foes turn up (levels 3-5).
weapon('silvered-dagger', 'Silvered dagger', 'simple', '1d4', 'piercing', 2 * GP, 1, ['finesse', 'light', 'thrown 20/60'], { desc: 'A dagger with a silvered edge. Werewolves and restless dead fear it.', icon: icon('dagger'), material: 'silver' });
weapon('silvered-shortsword', 'Silvered short sword', 'martial', '1d6', 'piercing', 10 * GP, 2, ['finesse', 'light'], { desc: 'A short blade washed in silver: it bites what plain steel cannot.', icon: icon('shortsword'), material: 'silver' });
weapon('silvered-longsword', 'Silvered longsword', 'martial', '1d8', 'slashing', 15 * GP, 3, ['versatile 1d10'], { desc: 'A longsword with a silvered edge, for hunters of werewolves and wights.', icon: icon('longsword'), material: 'silver' });
weapon('silvered-rapier', 'Silvered rapier', 'martial', '1d8', 'piercing', 25 * GP, 2, ['finesse'], { desc: 'A duellist\'s blade, silvered: elegant, and deadly to the cursed.', icon: icon('rapier'), material: 'silver' });
weapon('long-knife', 'Long knife', 'martial', '1d6', 'piercing', 8 * GP, 2, ['finesse', 'light'], { desc: 'A long hunting knife of the northern rangers, worn at the hip.' });
weapon('war-pick', 'War pick', 'martial', '1d8', 'piercing', 5 * GP, 2);
weapon('warhammer', 'Warhammer', 'martial', '1d8', 'bludgeoning', 15 * GP, 2, ['versatile 1d10']);
weapon('whip', 'Whip', 'martial', '1d4', 'slashing', 2 * GP, 3, ['finesse', 'reach']);
// Martial ranged
weapon('hand-crossbow', 'Hand crossbow', 'martial', '1d6', 'piercing', 75 * GP, 3, ['range 30/120', 'ammo bolts', 'light']);
weapon('heavy-crossbow', 'Heavy crossbow', 'martial', '1d10', 'piercing', 50 * GP, 18, ['range 100/400', 'ammo bolts', 'heavy', 'two-handed']);
weapon('longbow', 'Longbow', 'martial', '1d8', 'piercing', 50 * GP, 2, ['range 150/600', 'ammo arrows', 'heavy', 'two-handed'], { desc: 'A tall bow of seasoned yew, taller than a halfling. Its arrows reach far.' });

// Ammunition
add({ id: 'arrows', name: 'Arrows', cat: 'ammo', stack: true, weight: 0.05, value: 5, glyph: '➶', ammo: 'arrows', desc: 'Grey-fletched arrows. You can often recover half of those you shoot after a fight.' });
add({ id: 'bolts', name: 'Crossbow bolts', cat: 'ammo', stack: true, weight: 0.075, value: 5, glyph: '➶', ammo: 'bolts', desc: 'Short, heavy crossbow bolts.' });
add({ id: 'sling-bullets', name: 'Sling stones', cat: 'ammo', stack: true, weight: 0.075, value: 1, glyph: '●', ammo: 'sling-bullets', desc: 'Smooth river stones and lead bullets for a sling.' });

// ---------------------------------------------------------------------------
// Armour and shields
// ---------------------------------------------------------------------------
const armor = (id, name, type, base, value, weight, extra = {}) => add({
  id, name, cat: 'armor', slot: 'body', weight, value, glyph: '🛡',
  armor: { type, base, dexCap: type === 'light' ? null : type === 'medium' ? 2 : 0, stealthDis: !!extra.stealthDis, str: extra.str ?? 0 },
  desc: extra.desc ?? `${type[0].toUpperCase()}${type.slice(1)} armour: AC ${base}${type === 'light' ? ' + DEX' : type === 'medium' ? ' + DEX (max 2)' : ''}.`, ...extra,
});
armor('padded', 'Padded gambeson', 'light', 11, 5 * GP, 8, { stealthDis: true });
armor('leather', 'Leather jerkin', 'light', 11, 10 * GP, 10, { desc: 'Boiled leather, oiled against the rain. Light armour: AC 11 + your DEX modifier.' });
armor('studded-leather', 'Studded leather', 'light', 12, 45 * GP, 13);
armor('hide-armour', 'Hide armour', 'medium', 12, 10 * GP, 12);
armor('chain-shirt', 'Chain shirt', 'medium', 13, 50 * GP, 20);
armor('scale-mail', 'Scale coat', 'medium', 14, 50 * GP, 45, { stealthDis: true, desc: 'Overlapping bronze scales on a leather coat. Medium armour: AC 14 + DEX (max 2); noisy.' });
armor('breastplate', 'Breastplate', 'medium', 14, 400 * GP, 20);
armor('half-plate', 'Half plate', 'medium', 15, 750 * GP, 40, { stealthDis: true });
armor('ring-mail', 'Ring mail', 'heavy', 14, 30 * GP, 40, { stealthDis: true });
armor('chain-mail', 'Coat of mail', 'heavy', 16, 75 * GP, 55, { stealthDis: true, str: 13, desc: 'A long hauberk of riveted rings. Heavy armour: AC 16, no DEX bonus; needs STR 13.' });
armor('splint', 'Splint armour', 'heavy', 17, 200 * GP, 60, { stealthDis: true, str: 15 });
armor('plate', 'Plate armour', 'heavy', 18, 1500 * GP, 65, { stealthDis: true, str: 15 });
// Armour pieces: each covers its own part of the body and layers with body armour (defence.js
// ARMOURS has their absorption and coverage). type: light pieces of leather, heavy of steel.
const piece = (id, name, slot, type, value, weight, desc) => add({ id, name, cat: 'armor', slot, weight, value, glyph: '🛡', armor: { type, piece: true }, desc });
piece('leather-cap', 'Leather cap', 'head', 'light', 1 * GP, 1, 'A boiled-leather cap. Better than a bare head.');
piece('iron-helm', 'Iron helm', 'head', 'heavy', 10 * GP, 4, 'A round iron helm with a nasal guard. Most of the head, but not the face.');
piece('mail-coif', 'Mail coif', 'head', 'heavy', 15 * GP, 5, 'A hood of mail that falls over the neck and shoulders.');
piece('great-helm', 'Great helm', 'head', 'heavy', 30 * GP, 8, 'A closed steel helm with eye slits: the whole head, at the cost of a narrow view.');
piece('steel-gorget', 'Steel gorget', 'throat', 'heavy', 15 * GP, 2, 'A steel collar that guards the throat, the most dangerous place to be struck.');
piece('leather-vambraces', 'Leather vambraces', 'arms', 'light', 2 * GP, 1, 'Hardened leather guards for the forearms.');
piece('steel-vambraces', 'Steel vambraces', 'arms', 'heavy', 20 * GP, 4, 'Steel plates strapped over the forearms and elbows.');
piece('leather-gloves', 'Leather gloves', 'hands', 'light', 1 * GP, 0.5, 'Thick riding gloves.');
piece('gauntlets', 'Steel gauntlets', 'hands', 'heavy', 15 * GP, 3, 'Articulated steel gauntlets: fingers that can still grip a sword.');
piece('leather-leggings', 'Leather leggings', 'legs', 'light', 3 * GP, 3, 'Boiled-leather guards for thighs and shins.');
piece('mail-chausses', 'Mail chausses', 'legs', 'heavy', 25 * GP, 10, 'Leggings of mail, laced to the belt.');
piece('steel-greaves', 'Steel greaves', 'legs', 'heavy', 30 * GP, 8, 'Steel shin and thigh plates with knee cops.');
add({ id: 'shield', name: 'Round shield', cat: 'shield', slot: 'offHand', weight: 6, value: 10 * GP, glyph: '⛉', acBonus: 2, desc: 'A round shield of lime-wood with an iron boss. +2 AC while carried.' });

// Clothing and cloaks
add({ id: 'hooded-cloak', name: 'Hooded cloak', cat: 'clothing', slot: 'cloak', weight: 2, value: 1 * GP, glyph: '🧥', desc: 'A weathered green hooded cloak that keeps off rain and prying eyes.' });
add({ id: 'dark-cloak', name: 'Dark cloak', cat: 'clothing', slot: 'cloak', weight: 2, value: 1 * GP, glyph: '🧥', desc: 'A plain black travelling cloak.' });

// ---------------------------------------------------------------------------
// Consumables
// ---------------------------------------------------------------------------
add({ id: 'bandage', name: 'Bandage', cat: 'consumable', stack: true, weight: 0.1, value: 1 * SP, glyph: '🩹', use: { kind: 'bandage' },
  desc: 'Clean linen strips. Use one to bind your wounds: a Medicine check (DC 10) heals 1d6 + your Medicine bonus; a failure wastes it. Takes your action in combat.' });
add({ id: 'potion-healing', name: 'Potion of healing', cat: 'consumable', stack: true, weight: 0.5, value: 50 * GP, glyph: '🧪', use: { kind: 'heal', dice: '2d4+2' },
  desc: 'A red cordial that glimmers when shaken. Drink it to regain 2d4 + 2 hit points. Takes your action in combat.' });
add({ id: 'potion-greater-healing', name: 'Potion of greater healing', cat: 'consumable', rarity: 'uncommon', stack: true, weight: 0.5, value: 150 * GP, glyph: '🧪', use: { kind: 'heal', dice: '4d4+4' },
  desc: 'A deeper red draught. Regain 4d4 + 4 hit points.' });
add({ id: 'potion-superior-healing', name: 'Potion of superior healing', cat: 'consumable', rarity: 'rare', stack: true, weight: 0.5, value: 450 * GP, glyph: '🧪', use: { kind: 'heal', dice: '8d4+8' },
  desc: 'A crimson elixir that burns like summer. Regain 8d4 + 8 hit points.' });
add({ id: 'waybread', name: 'Elven waybread', cat: 'consumable', rarity: 'uncommon', stack: true, weight: 0.2, value: 5 * GP, glyph: '🍞', use: { kind: 'heal', dice: '1d6+1' },
  desc: 'Thin golden cakes wrapped in leaves. One bite heartens a weary traveller (regain 1d6 + 1 hit points).' });
add({ id: 'kingsfoil', name: 'Kingsfoil leaf', cat: 'consumable', stack: true, weight: 0.05, value: 2 * SP, glyph: '🌿', use: { kind: 'heal', dice: '1d4' },
  desc: 'A humble weed with a sweet smell when crushed. Chewed or steeped, it eases pain (regain 1d4 hit points). Also a healing herb for crafting.' });
add({ id: 'rations', name: 'Trail rations', cat: 'consumable', stack: true, weight: 2, value: 5 * SP, glyph: '🥖', desc: 'Dried meat, hard cheese and biscuit for one day.' });
add({ id: 'antidote', name: 'Antitoxin', cat: 'consumable', stack: true, weight: 0.2, value: 50 * GP, glyph: '⚗', desc: 'A bitter vial that grants advantage on saves against poison for an hour.' });

// ---------------------------------------------------------------------------
// Tools and gear (functional items)
// ---------------------------------------------------------------------------
const tool = (id, name, value, weight, desc, extra = {}) => add({ id, name, cat: 'tool', value, weight, desc, glyph: '🔧', ...extra });
tool('iron-key', 'Iron key', 0, 0, 'A heavy iron key. It fits one iron door in this dungeon, and only that one.', { glyph: '🗝', key: true });
tool('thieves-tools', 'Thieves\' tools', 25 * GP, 1, 'Picks, a small mirror, narrow scissors and pliers. Needed to pick locks and disarm traps (DEX check). A bad failure (by 5 or more) snaps a pick.', { charges: 10, glyph: '🗝' });
tool('healers-kit', 'Healer\'s kit', 5 * GP, 3, 'Salves, splints and a needle. While you carry it, you bandage with advantage on your Medicine check.', { glyph: '✚' });
tool('crowbar', 'Crowbar', 2 * GP, 5, 'A bar of iron with a flattened end. Gives advantage on Strength checks to force doors and chests open.', { glyph: '🔩' });
tool('rope', 'Hempen rope (15 m)', 1 * GP, 10, 'Fifteen metres of strong hemp. Used to climb out of pits and down shafts.', { glyph: '➰' });
tool('elven-rope', 'Elven rope (9 m)', 20 * GP, 2, 'Grey, silken and astonishingly strong. Knots seem to untie themselves when you call them.', { rarity: 'uncommon', glyph: '➰' });
tool('torch', 'Torch', 1, 1, 'A pitch-soaked torch that burns for an hour.', { stack: true, glyph: '🔥' });
tool('lantern', 'Hooded lantern', 5 * GP, 2, 'An oil lantern with a shutter to hide its light.', { glyph: '🏮' });
tool('tinderbox', 'Tinderbox', 5 * SP, 1, 'Flint, fire steel and tinder.', { glyph: '🔥' });
tool('bedroll', 'Bedroll', 1 * GP, 7, 'A blanket roll for sleeping on the road.', { glyph: '🛏' });
tool('waterskin', 'Waterskin', 2 * SP, 5, 'A leather skin that holds four pints.', { glyph: '💧' });
tool('grappling-hook', 'Grappling hook', 2 * GP, 4, 'An iron hook to tie to a rope.', { glyph: '⚓' });
tool('pickaxe', 'Pickaxe', 2 * GP, 10, 'For mining ore from veins in the rock (mining comes later).', { glyph: '⛏' });
tool('hatchet', 'Hatchet', 1 * GP, 2, 'For felling trees and cutting logs (lumberjacking comes later).', { glyph: '🪓' });
tool('smiths-hammer', 'Smith\'s hammer', 2 * GP, 3, 'For forging ingots into arms and armour (crafting comes later).', { glyph: '🔨' });
tool('tinkers-tools', 'Tinker\'s tools', 50 * GP, 10, 'For making and mending small mechanisms.', { glyph: '⚙' });
tool('herbalism-kit', 'Herbalism kit', 5 * GP, 3, 'Pouches, mortar and pestle for brewing salves and potions from herbs.', { glyph: '🌿' });
tool('sewing-kit', 'Sewing kit', 1 * GP, 1, 'Needles and thread for tailoring cloth and leather.', { glyph: '🧵' });
tool('fletching-kit', 'Fletching kit', 2 * GP, 2, 'Knives, glue and feathers for making arrows from wood.', { glyph: '🪶' });
tool('instrument', 'Harp or flute', 30 * GP, 3, 'A well-loved instrument.', { glyph: '🎵' });
tool('book-of-lore', 'Book of old lore', 25 * GP, 5, 'Notes on ruins, runes and ancient kingdoms.', { glyph: '📖' });
tool('ink-quill', 'Ink, quill and parchment', 10 * GP, 1, 'For writing letters and copying inscriptions.', { glyph: '✒' });

// Trinkets and keepsakes (background gear)
const trinket = (id, name, desc, value = 1 * SP) => add({ id, name, cat: 'trinket', value, weight: 0.5, desc, glyph: '✦' });
trinket('weathered-map', 'Weathered map', 'A map of the old roads, much folded and annotated.');
trinket('letter-of-introduction', 'Letter of introduction', 'A sealed letter vouching for you.');
trinket('insignia', 'Insignia of rank', 'A badge from your old company.');
trinket('horn', 'Horn', 'A carved horn whose call carries for miles.', 3 * GP);
trinket('pipe-and-leaf', 'Pipe and leaf', 'A clay pipe and a pouch of fragrant leaf.', 5 * SP);
trinket('handkerchief', 'Pocket handkerchief', 'Never leave home without one.', 1);
trinket('home-token', 'Token of your lost home', 'A small keepsake: a stone, a ring, a ribbon.');
trinket('merchants-scales', 'Merchant\'s scales', 'A small brass balance and weights.', 5 * GP);
trinket('goblin-trinket', 'Goblin trinket', 'A string of teeth and bottle-caps. Worth nothing, except to a goblin.', 2);
trinket('stewards-signet', 'The Steward\'s signet', 'A heavy gold ring engraved with the oak and river of Ashford. Its seal makes the Steward\'s word law.', 25 * GP);
items[items.length - 1].quest = true; // a quest item: traders will not buy it

// ---------------------------------------------------------------------------
// Crafting resources: woods, ores, ingots, hides, cloth, herbs, gems
// ---------------------------------------------------------------------------
const res = (id, name, value, weight, desc, extra = {}) => add({ id, name, cat: 'resource', stack: true, value, weight, desc, glyph: '◆', ...extra });
// Woods (from common to precious)
res('oak-log', 'Oak log', 2, 2, 'Hard, heavy oak. Good for shields, clubs and chests.', { glyph: '🪵' });
res('ash-log', 'Ash log', 3, 2, 'Springy ash, the wood of spear-shafts and staves.', { glyph: '🪵' });
res('beech-log', 'Beech log', 2, 2, 'Pale, even-grained beech for tools and bowls.', { glyph: '🪵', icon: icon('oak-log') });
res('yew-log', 'Yew log', 8, 2, 'Red-hearted yew: the best wood for longbows.', { glyph: '🪵', rarity: 'uncommon' });
res('holly-log', 'Holly log', 10, 2, 'White, close-grained holly from the old elven lands. Takes fine carving.', { glyph: '🪵', rarity: 'uncommon' });
res('blackwood-log', 'Blackwood log', 30, 2, 'Dense black timber from deep in the old forest. Hard as iron.', { glyph: '🪵', rarity: 'rare' });
res('goldenwood-log', 'Goldenwood log', 120, 1, 'Silver-barked wood with golden leaves still clinging. Light, strong, and never rots.', { glyph: '🪵', rarity: 'very-rare' });
// Ores
res('coal', 'Coal', 1, 1, 'Black fuel for the forge.', { glyph: '⬛' });
res('copper-ore', 'Copper ore', 3, 1, 'Green-streaked rock rich in copper.', { glyph: '🪨' });
res('tin-ore', 'Tin ore', 3, 1, 'Grey ore. With copper, it makes bronze.', { glyph: '🪨' });
res('iron-ore', 'Iron ore', 4, 1, 'Rust-red rock, the backbone of every smithy.', { glyph: '🪨' });
res('silver-ore', 'Silver ore', 20, 1, 'Glittering ore that yields bright silver.', { glyph: '🪨', rarity: 'uncommon' });
res('gold-ore', 'Gold ore', 60, 1, 'Heavy rock threaded with gold.', { glyph: '🪨', rarity: 'rare' });
res('mithral-ore', 'Mithral ore', 500, 1, 'A few grains of true-silver: light as down, harder than steel. Worth more than its weight in gold.', { glyph: '🪨', rarity: 'very-rare' });
// Ingots: made at the forge (crafting.js), and what metal gear is forged from. Each is of its
// metal (materials.js): its value is the base x the metal's worth, and its icon takes the metal's tint.
const ingot = (metal, name, base, desc, rarity = 'common') => res(`${metal}-ingot`, name, base, 1, desc, { glyph: '▬', material: metal, rarity, icon: icon(metal === 'bronze' ? 'bronze-ingot' : 'iron-ingot') });
ingot('iron', 'Iron ingot', 14, 'A bar of smelted iron, ready for the anvil.');
ingot('steel', 'Steel ingot', 14, 'Iron folded with charcoal into steel: the smith\'s standard.');
ingot('copper', 'Copper ingot', 10, 'A soft red bar of copper.');
ingot('bronze', 'Bronze ingot', 10, 'A bar of bronze: copper with a little tin.');
ingot('black-iron', 'Black iron ingot', 12, 'Iron quenched in bloodmoss: black, cold and stubborn.', 'uncommon');
ingot('silver', 'Silver ingot', 12, 'A bright bar of silver. The cursed fear its edge.', 'uncommon');
ingot('gold', 'Gold ingot', 12, 'A heavy, soft bar of gold.', 'rare');
ingot('dwarf-steel', 'Dwarf-steel ingot', 12, 'Steel worked with silver by the old dwarven secret: blue-grey and keen.', 'rare');
ingot('mithral', 'Mithral ingot', 60, 'True-silver, smelted: light as a feather, harder than steel.', 'very-rare');
res('tanned-leather', 'Tanned leather', 6, 1, 'Hide tanned into supple leather, ready to cut and stitch.', { glyph: '🟫', icon: icon('hide') });
res('bowstring', 'Bowstring', 4, 0.05, 'A waxed string of twisted silk or sinew.', { glyph: '〰', icon: icon('spider-silk') });
// Animal and monster parts
res('hide', 'Raw hide', 3, 2, 'An untanned animal hide, for leatherwork.', { glyph: '🟫' });
res('wolf-pelt', 'Wolf pelt', 15, 3, 'A thick grey pelt. Warm, and prized by furriers.', { glyph: '🟫', rarity: 'uncommon' });
res('bat-wing', 'Bat wing', 2, 0.1, 'A leathery wing. Herbalists use them in sleeping draughts.', { glyph: '🦇' });
res('bones', 'Bones', 1, 1, 'A handful of bones.', { glyph: '🦴' });
res('feathers', 'Feathers', 1, 0.05, 'Grey feathers for fletching arrows.', { glyph: '🪶' });
res('spider-silk', 'Spider silk', 5, 0.1, 'Sticky grey silk from a great spider. Strong as rope, light as breath.', { glyph: '🕸' });
res('venom-sac', 'Venom sac', 20, 0.1, 'A spider\'s venom gland. Handle carefully.', { glyph: '💧', rarity: 'uncommon' });
res('cloth', 'Cloth', 2, 0.5, 'A bolt of rough cloth.', { glyph: '🧵' });
// Herbs (alchemy reagents)
res('garlic', 'Garlic', 1, 0.05, 'A pungent bulb, used in cures and wards.', { glyph: '🧄' });
res('ginseng', 'Ginseng root', 3, 0.05, 'A forked root that restores vigour.', { glyph: '🌱' });
res('mandrake', 'Mandrake root', 5, 0.05, 'A root shaped like a little man. It does not scream. Usually.', { glyph: '🌱', rarity: 'uncommon' });
res('nightshade', 'Nightshade', 4, 0.05, 'Deadly purple berries, used in poisons.', { glyph: '🫐', rarity: 'uncommon' });
res('bloodmoss', 'Bloodmoss', 3, 0.05, 'Red moss from cave walls.', { glyph: '🌿' });
// Gems
const gem = (id, name, value, rarity, desc) => add({ id, name, cat: 'gem', stack: true, value, weight: 0, rarity, desc, glyph: '💎' });
gem('amber', 'Amber', 10 * GP, 'common', 'Golden fossil resin, sometimes with a tiny insect trapped inside.');
gem('garnet', 'Garnet', 25 * GP, 'common', 'A deep red stone.');
gem('amethyst', 'Amethyst', 50 * GP, 'uncommon', 'A violet crystal.');
gem('sapphire', 'Sapphire', 100 * GP, 'uncommon', 'A blue gem as clear as a winter sky.');
gem('ruby', 'Ruby', 250 * GP, 'rare', 'A blood-red gem that seems to hold a small fire.');
gem('emerald', 'Emerald', 250 * GP, 'rare', 'A green gem from the deep mines.');
gem('diamond', 'Diamond', 1000 * GP, 'very-rare', 'A white star of a stone.');

// ---------------------------------------------------------------------------
// Named magic items (the rarest drops)
// ---------------------------------------------------------------------------
const magic = (o) => add({ magic: true, ...o });
magic({ id: 'ring-of-protection', name: 'Ring of protection', cat: 'jewelry', slot: 'ring', rarity: 'rare', weight: 0, value: 3500 * GP, glyph: '💍', acBonus: 1, saveBonus: 1,
  desc: 'A plain band of white gold. While worn: +1 to AC and saving throws.' });
magic({ id: 'elven-cloak', name: 'Elven grey cloak', cat: 'clothing', slot: 'cloak', rarity: 'uncommon', weight: 1, value: 500 * GP, glyph: '🧥', skillBonus: { stealth: 2 },
  desc: 'A cloak woven by elves. It takes on the colours of leaf and stone (+2 to Stealth while worn).' });
magic({ id: 'mithral-shirt', name: 'Mithral shirt', cat: 'armor', slot: 'body', rarity: 'uncommon', weight: 10, value: 800 * GP, glyph: '🛡',
  armor: { type: 'medium', base: 13, dexCap: 2, stealthDis: false, str: 0 }, desc: 'A shirt of tiny silver rings, light as linen. Medium armour (AC 13 + DEX, max 2) that never hinders stealth.' });
magic({ id: 'barrow-blade', name: 'Barrow-blade of the old kings', cat: 'weapon', slot: 'mainHand', rarity: 'rare', weight: 2, value: 1000 * GP, glyph: '⚔', bonus: 1,
  weapon: { damage: '1d6', type: 'piercing', group: 'martial', props: ['finesse', 'light'], finesse: true, light: true },
  desc: 'A short blade from an ancient tomb, its steel etched with red-gold runes. A +1 weapon, forged long ago against the servants of the Shadow.' });
magic({ id: 'glimmer-blade', name: 'Glimmer-blade', cat: 'weapon', slot: 'mainHand', rarity: 'very-rare', weight: 3, value: 4000 * GP, glyph: '⚔', bonus: 2,
  weapon: { damage: '1d8', type: 'slashing', group: 'martial', props: ['versatile 1d10'], versatile: '1d10' },
  desc: 'An elf-forged longsword that glows a faint blue when goblins or orcs are near. A +2 weapon.' });
magic({ id: 'phial-of-starlight', name: 'Phial of starlight', cat: 'jewelry', slot: 'neck', rarity: 'rare', weight: 0, value: 2000 * GP, glyph: '✨', use: { kind: 'light' },
  desc: 'A crystal phial holding a captured star. Raise it to flood your surroundings with silver light, revealing every hidden trap and door within sight.' });
// Jewellery: rings for ten fingers, a bracelet for each wrist, one necklace.
add({ id: 'gold-ring', name: 'Gold ring', cat: 'jewelry', slot: 'ring', weight: 0, value: 25 * GP, glyph: '💍', desc: 'A plain band of polished gold. Worth something to the right buyer.' });
add({ id: 'copper-bangle', name: 'Copper bangle', cat: 'jewelry', slot: 'wrist', weight: 0, value: 2 * GP, glyph: '◯', desc: 'A hammered copper bangle, the kind farmers give at a wedding.' });
add({ id: 'silver-bracelet', name: 'Silver charm bracelet', cat: 'jewelry', slot: 'wrist', weight: 0, value: 15 * GP, glyph: '◯', desc: 'A fine silver chain hung with tiny charms: a moon, a key, a little horse.' });
add({ id: 'silver-pendant', name: 'Silver pendant', cat: 'jewelry', slot: 'neck', weight: 0, value: 10 * GP, glyph: '📿', desc: 'A teardrop of rock crystal on a fine silver chain.' });
magic({ id: 'ruby-ring', name: 'Ring of the hearth', cat: 'jewelry', slot: 'ring', rarity: 'uncommon', weight: 0, value: 300 * GP, glyph: '💍', hpBonus: 3,
  desc: 'A gold ring with a ruby that glows like an ember. +3 maximum hit points while worn.' });
magic({ id: 'sapphire-ring', name: 'Ring of clear sight', cat: 'jewelry', slot: 'ring', rarity: 'uncommon', weight: 0, value: 300 * GP, glyph: '💍', skillBonus: { insight: 2 },
  desc: 'A silver ring with a sapphire as cold and clear as a winter sky. +2 to Insight while worn.' });
magic({ id: 'fox-ring', name: 'Ring of the fox', cat: 'jewelry', slot: 'ring', rarity: 'uncommon', weight: 0, value: 350 * GP, glyph: '💍', skillBonus: { stealth: 2 },
  desc: 'An emerald carved as a fox\'s head, set in gold. +2 to Stealth while worn.' });
magic({ id: 'sentinel-ring', name: 'Ring of the sentinel', cat: 'jewelry', slot: 'ring', rarity: 'uncommon', weight: 0, value: 350 * GP, glyph: '💍', skillBonus: { perception: 2 },
  desc: 'A black iron ring engraved with an eye that glows faintly silver. +2 to Perception while worn.' });
magic({ id: 'bracers-of-defence', name: 'Bracers of defence', cat: 'jewelry', slot: 'wrist', rarity: 'rare', weight: 1, value: 1500 * GP, glyph: '🛡', acBonus: 1,
  desc: 'A riveted leather and steel bracer, humming with a warding charm. +1 to AC while worn.' });
magic({ id: 'sun-amulet', name: 'Amulet of the dawn', cat: 'jewelry', slot: 'neck', rarity: 'uncommon', weight: 0, value: 400 * GP, glyph: '☀', skillBonus: { religion: 2, medicine: 2 },
  desc: 'A golden sun on a chain, blessed at the Chapel of the Dawn. +2 to Religion and Medicine while worn.' });
magic({ id: 'amulet-of-warding', name: 'Amulet of warding', cat: 'jewelry', slot: 'neck', rarity: 'rare', weight: 0, value: 1500 * GP, glyph: '📿', saveBonus: 1,
  desc: 'A blue gem in dark silver filigree that brightens when a curse draws near. +1 to saving throws while worn.' });
magic({ id: 'amulet-of-vigour', name: 'Amulet of vigour', cat: 'jewelry', slot: 'neck', rarity: 'uncommon', weight: 0, value: 400 * GP, glyph: '📿', hpBonus: 5,
  desc: 'A green stone on a silver chain, warm to the touch. +5 maximum hit points while worn.' });

/**
 * Enchanted gear, named like the classic Ultima Online tiers. A +1 weapon is "of Might",
 * +2 "of Power", +3 "of Vanquishing"; armour is "of Defense", "of Hardening", "of Invulnerability".
 * Rarity follows the 5e DMG: +1 uncommon, +2 rare, +3 very rare.
 */
export const ENCHANT = {
  weapon: { 1: 'of Might', 2: 'of Power', 3: 'of Vanquishing' },
  armor: { 1: 'of Defense', 2: 'of Hardening', 3: 'of Invulnerability' },
  shield: { 1: 'of Defense', 2: 'of Hardening', 3: 'of Invulnerability' },
};
export const ENCHANT_RARITY = { 1: 'uncommon', 2: 'rare', 3: 'very-rare' };

export const ITEMS = Object.freeze(items);
export const ITEMS_BY_ID = Object.freeze(Object.fromEntries(items.map((i) => [i.id, i])));
export const RARITY_ORDER = ['common', 'uncommon', 'rare', 'very-rare', 'legendary'];
export const RARITY_LABEL = { common: 'Common', uncommon: 'Uncommon', rare: 'Rare', 'very-rare': 'Very rare', legendary: 'Legendary' };
export const CATEGORY_LABEL = {
  weapon: 'Weapon', armor: 'Armour', shield: 'Shield', ammo: 'Ammunition', consumable: 'Consumable', tool: 'Tool',
  resource: 'Resource', gem: 'Gem', clothing: 'Clothing', jewelry: 'Jewellery', trinket: 'Keepsake',
};
export { GP, SP };
