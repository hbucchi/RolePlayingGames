/**
 * What each kind of creature carries. Every entry has a drop chance p (0-1) that is rolled
 * independently, so a goblin can drop both arrows and a bandage. A beast carries no coins
 * or swords, only its hide and bones; a spider's lair hides the leftovers of its victims.
 *
 *   { id, p, qty: [min, max] }      a specific item
 *   coins: multiplier on the DMG individual-treasure coin roll (0 = carries no money)
 *   magic: chance of a magic item (scaled up with challenge rating in loot.js)
 */
const I = (id, p, min = 1, max = min) => ({ id, p, qty: [min, max] });

export const LOOT_PROFILES = {
  goblinoid: {
    label: 'goblin', coins: 1, magic: 0.01,
    items: [I('arrows', 0.35, 2, 8), I('scimitar', 0.08), I('shortbow', 0.05), I('bandage', 0.15, 1, 2), I('torch', 0.2, 1, 2),
      I('goblin-trinket', 0.3), I('coal', 0.1), I('copper-ore', 0.08), I('iron-ore', 0.08), I('rations', 0.1), I('potion-healing', 0.03), I('thieves-tools', 0.02)],
  },
  runt: {
    label: 'pit-runt', coins: 0.4, magic: 0.005,
    items: [I('sling-bullets', 0.3, 3, 10), I('dagger', 0.1), I('sling', 0.05), I('goblin-trinket', 0.4), I('bandage', 0.12), I('kingsfoil', 0.12, 1, 2),
      I('torch', 0.15), I('bones', 0.1), I('copper-ore', 0.06), I('coal', 0.08)],
  },
  orc: {
    label: 'orc', coins: 1, magic: 0.015,
    items: [I('arrows', 0.3, 3, 10), I('scimitar', 0.1), I('shortbow', 0.05), I('iron-ore', 0.12), I('coal', 0.1), I('bones', 0.1),
      I('chain-shirt', 0.02), I('shield', 0.04), I('bandage', 0.1), I('potion-healing', 0.04)],
  },
  spider: {
    label: 'spider', coins: 0.15, magic: 0.01, // coins and magic from the remains of its victims
    items: [I('spider-silk', 0.7, 1, 4), I('venom-sac', 0.2), I('bones', 0.25, 1, 2), I('amber', 0.03), I('dagger', 0.03)],
  },
  bat: { label: 'bat', coins: 0, magic: 0, items: [I('bat-wing', 0.6, 1, 2), I('bones', 0.1), I('bloodmoss', 0.12)] },
  rat: { label: 'rat', coins: 0.1, magic: 0, items: [I('hide', 0.2), I('bones', 0.2), I('garlic', 0.05)] },
  wolf: { label: 'wolf', coins: 0, magic: 0, items: [I('wolf-pelt', 0.35), I('hide', 0.4), I('bones', 0.4, 1, 2)] },
  beast: { label: 'beast', coins: 0, magic: 0, items: [I('hide', 0.5), I('bones', 0.4, 1, 2), I('feathers', 0.15, 2, 6)] },
  undead: {
    label: 'undead', coins: 0.7, magic: 0.03,
    items: [I('bones', 0.6, 1, 3), I('cloth', 0.2), I('dagger', 0.05), I('longsword', 0.03), I('amber', 0.05), I('garnet', 0.05), I('silver-ore', 0.03)],
  },
  humanoid: {
    label: 'humanoid', coins: 1, magic: 0.02,
    items: [I('dagger', 0.1), I('shortsword', 0.05), I('bandage', 0.2, 1, 3), I('rations', 0.2), I('potion-healing', 0.04), I('rope', 0.05), I('thieves-tools', 0.03), I('cloth', 0.1)],
  },
  troll: {
    label: 'troll', coins: 1.5, magic: 0.05,
    items: [I('bones', 0.5, 2, 5), I('hide', 0.3), I('iron-ore', 0.2), I('gold-ore', 0.05), I('greatclub', 0.1), I('sapphire', 0.05), I('ruby', 0.02)],
  },
  dragon: {
    label: 'dragon', coins: 5, magic: 0.25,
    items: [I('gold-ore', 0.3, 1, 4), I('mithral-ore', 0.08), I('ruby', 0.2, 1, 2), I('emerald', 0.2, 1, 2), I('diamond', 0.08), I('sapphire', 0.25, 1, 3)],
  },
  plant: {
    label: 'plant', coins: 0, magic: 0.005,
    items: [I('oak-log', 0.3, 1, 3), I('ash-log', 0.2), I('yew-log', 0.05), I('blackwood-log', 0.02), I('kingsfoil', 0.3, 1, 3), I('mandrake', 0.1), I('nightshade', 0.1), I('ginseng', 0.1)],
  },
  elemental: { label: 'elemental', coins: 0, magic: 0.02, items: [I('iron-ore', 0.3, 1, 3), I('coal', 0.3, 1, 3), I('silver-ore', 0.08), I('garnet', 0.1), I('ruby', 0.03)] },
  construct: { label: 'construct', coins: 0, magic: 0.03, items: [I('iron-ingot', 0.4, 1, 3), I('bronze-ingot', 0.2), I('tin-ore', 0.15)] },
  monstrosity: { label: 'monstrosity', coins: 0.3, magic: 0.02, items: [I('hide', 0.4), I('bones', 0.4, 1, 3), I('venom-sac', 0.08), I('garnet', 0.04)] },
  fey: { label: 'fey', coins: 0.3, magic: 0.04, items: [I('kingsfoil', 0.3, 1, 2), I('ginseng', 0.15), I('amethyst', 0.06), I('holly-log', 0.05), I('waybread', 0.05)] },
  fiend: { label: 'fiend', coins: 1, magic: 0.05, items: [I('bloodmoss', 0.3), I('nightshade', 0.2), I('ruby', 0.05), I('bones', 0.2)] },
  celestial: { label: 'celestial', coins: 0.5, magic: 0.08, items: [I('sapphire', 0.1), I('diamond', 0.02), I('kingsfoil', 0.2)] },
  aberration: { label: 'aberration', coins: 0.5, magic: 0.04, items: [I('nightshade', 0.2), I('amethyst', 0.08), I('mandrake', 0.1)] },
  ooze: { label: 'ooze', coins: 0.5, magic: 0.02, items: [I('iron-ore', 0.1), I('bones', 0.2), I('amber', 0.05)] },
};

const BY_ID = {
  'pit-runt': 'runt', 'crag-bat': 'bat', 'dark-wood-spiderling': 'spider', 'giant-rat': 'rat',
  wolf: 'wolf', worg: 'wolf', 'dire-wolf': 'wolf', 'winter-wolf': 'wolf', 'shadow-wolf': 'wolf', 'shadow-wolf-chieftain': 'wolf', 'spirit-wolf-of-the-shadow': 'wolf',
  'giant-bat': 'bat', 'swarm-of-bats': 'bat', 'giant-spider': 'spider', 'giant-wolf-spider': 'spider', 'weaver-of-the-nightwood': 'spider', 'brood-queen-of-the-dark-pass': 'spider', ettercap: 'spider',
  ogre: 'troll',
};

/** Pick the loot profile for a monster stat block. */
export function lootProfileFor(stat) {
  if (BY_ID[stat.id]) return LOOT_PROFILES[BY_ID[stat.id]];
  const sub = stat.subtype ?? '';
  if (/goblinoid/.test(sub)) return LOOT_PROFILES.goblinoid;
  if (/orc/.test(sub)) return LOOT_PROFILES.orc;
  if (/troll/i.test(stat.name) || stat.type === 'giant') return LOOT_PROFILES.troll;
  return LOOT_PROFILES[stat.type] ?? LOOT_PROFILES.humanoid;
}

/** Chest contents scale with the dungeon's level. */
export const CHEST_PROFILE = {
  label: 'chest', coins: 3, magic: 0.08,
  items: [I('potion-healing', 0.35), I('bandage', 0.4, 2, 5), I('kingsfoil', 0.2, 1, 3), I('rope', 0.1), I('torch', 0.2, 1, 3), I('thieves-tools', 0.05), I('crowbar', 0.05),
    I('iron-ore', 0.2, 1, 4), I('copper-ore', 0.15, 1, 4), I('tin-ore', 0.1, 1, 3), I('silver-ore', 0.06, 1, 2), I('gold-ore', 0.03), I('mithral-ore', 0.005),
    I('oak-log', 0.15, 1, 3), I('yew-log', 0.06), I('holly-log', 0.04), I('goldenwood-log', 0.005),
    I('amber', 0.1), I('garnet', 0.08), I('amethyst', 0.05), I('sapphire', 0.03), I('ruby', 0.015), I('emerald', 0.015), I('diamond', 0.004),
    I('waybread', 0.05, 1, 2), I('elven-rope', 0.02), I('antidote', 0.04), I('arrows', 0.15, 5, 15)],
  randomWeapon: 0.12, randomArmor: 0.06,
};

/** Plain weapons and armour that can turn up in chests (and be enchanted as magic drops). */
export const ARMS_POOL = ['dagger', 'shortsword', 'longsword', 'scimitar', 'mace', 'handaxe', 'battleaxe', 'warhammer', 'rapier', 'spear', 'shortbow', 'longbow', 'light-crossbow', 'greatsword', 'greataxe'];
export const ARMOR_POOL = ['leather', 'studded-leather', 'hide', 'chain-shirt', 'scale-mail', 'breastplate', 'ring-mail', 'chain-mail', 'shield'];
