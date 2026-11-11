/**
 * Callings (classes). Low-magic adaptations of 5e SRD classes, in keeping with a
 * world where open sorcery is rare and dangerous.
 *
 * Equipment items carry the numbers the engine needs:
 *   armor:  { base, dexCap }  (dexCap null = full DEX, 2 = medium, 0 = heavy)
 *   shield: { acBonus }
 *   weapon: { damage, damageType, ability, finesse? }
 */
const W = (name, damage, damageType, ability, extra = {}) => ({ kind: 'weapon', name, damage, damageType, ability, ...extra });
const A = (name, base, dexCap) => ({ kind: 'armor', name, armor: { base, dexCap } });
const G = (name) => ({ kind: 'gear', name });
const SHIELD = { kind: 'shield', name: 'Round shield', acBonus: 2 };

export const classes = [
  {
    id: 'warrior',
    name: 'Warrior',
    tagline: 'Shield-bearer, spear-wielder, the wall against the dark.',
    description: 'Trained to the sword and shield, warriors stand in the front rank. They are the hardiest of heroes and the most dependable in a fight.',
    hitDie: 10,
    primary: ['str', 'con'],
    abilityPriority: ['str', 'con', 'dex', 'wis', 'cha', 'int'],
    savingThrows: ['str', 'con'],
    armorProficiencies: ['All armour', 'Shields'],
    weaponProficiencies: ['Simple weapons', 'Martial weapons'],
    skillChoices: { count: 2, from: ['acrobatics', 'animal-handling', 'athletics', 'history', 'insight', 'intimidation', 'perception', 'survival'] },
    features: [
      { name: 'Fighting Style: Shield-wall', text: 'While you wield a shield, you can use your reaction to impose disadvantage on an attack against an adjacent ally.' },
      { name: 'Second Wind', text: 'Once (until you recover at a mana totem, an inn or a camp), as a bonus action, regain 1d10 + your level in hit points.' },
    ],
    equipment: [A('Coat of mail', 16, 0), SHIELD, W('Longsword', '1d8', 'slashing', 'str'), W('Spear (thrown)', '1d6', 'piercing', 'str', { properties: ['thrown 20/60'] }), G('Traveller\'s pack')],
    kit: ['chain-mail', 'shield', 'longsword', 'spear', 'traveller'],
  },
  {
    id: 'ranger',
    spellcasting: { ability: 'wis', type: 'half' },
    name: 'Ranger',
    tagline: 'Wilderness wanderer and hunter of the Shadow\'s creatures.',
    description: 'Rangers patrol the empty lands, reading tracks, guarding the borders of quiet countries whose people never know they are protected.',
    hitDie: 10,
    primary: ['dex', 'wis'],
    abilityPriority: ['dex', 'wis', 'con', 'str', 'int', 'cha'],
    savingThrows: ['str', 'dex'],
    armorProficiencies: ['Light armour', 'Medium armour', 'Shields'],
    weaponProficiencies: ['Simple weapons', 'Martial weapons'],
    skillChoices: { count: 3, from: ['animal-handling', 'athletics', 'insight', 'investigation', 'nature', 'perception', 'stealth', 'survival'] },
    features: [
      { name: 'Favoured Foe: Servants of the Shadow', text: 'You have advantage on Survival checks to track orcs, wolves and other creatures of the Shadow, and on Intelligence checks to recall lore about them.' },
      { name: 'Wilderness Wanderer', text: 'Difficult terrain does not slow your group\'s travel, and you can never become lost except by magical means.' },
    ],
    equipment: [A('Leather jerkin', 11, null), W('Longbow', '1d8', 'piercing', 'dex', { properties: ['range 150/600'] }), W('Long knife', '1d6', 'piercing', 'dex', { finesse: true, properties: ['finesse'] }), G('Hooded cloak'), G('Traveller\'s pack')],
    kit: ['leather', 'longbow', ['arrows', 20], 'long-knife', 'hooded-cloak', 'traveller'],
  },
  {
    id: 'burglar',
    name: 'Burglar',
    tagline: 'Quiet feet, quick hands, and a knack for riddles.',
    description: 'Burglars get in, and more importantly, out. They pick locks, slip past guards and strike where foes are least prepared.',
    hitDie: 8,
    primary: ['dex', 'int'],
    abilityPriority: ['dex', 'con', 'wis', 'int', 'cha', 'str'],
    savingThrows: ['dex', 'int'],
    armorProficiencies: ['Light armour'],
    weaponProficiencies: ['Simple weapons', 'Short swords', 'Shortbows'],
    toolProficiencies: ['thieves-tools'],
    skillChoices: { count: 4, from: ['acrobatics', 'athletics', 'deception', 'insight', 'intimidation', 'investigation', 'perception', 'performance', 'persuasion', 'sleight-of-hand', 'stealth'] },
    features: [
      { name: 'Sneak Attack', text: 'Once per turn, deal an extra 1d6 damage to a creature you hit with a finesse or ranged weapon if you have advantage, or an ally is next to it.' },
      { name: 'Burglar\'s Eye', text: 'You are proficient with thieves\' tools, and you notice hidden doors, traps and loose stones with a glance (advantage on checks to find them).' },
    ],
    equipment: [A('Leather jerkin', 11, null), W('Short sword', '1d6', 'piercing', 'dex', { finesse: true, properties: ['finesse', 'light'] }), W('Sling', '1d4', 'bludgeoning', 'dex', { properties: ['range 30/120'] }), G('Thieves\' tools'), G('Burglar\'s pack')],
    kit: ['leather', 'shortsword', 'sling', ['sling-bullets', 20], 'thieves-tools', 'burglar'],
  },
  {
    id: 'loremaster',
    spellcasting: { ability: 'int', type: 'full' },
    name: 'Loremaster',
    tagline: 'Keeper of old words, whose knowledge is a kind of power.',
    description: 'Loremasters study forgotten tongues and the deep history of the world. A few learn words of command that bend fire, light and will.',
    hitDie: 6,
    primary: ['int', 'wis'],
    abilityPriority: ['int', 'wis', 'con', 'dex', 'cha', 'str'],
    savingThrows: ['int', 'wis'],
    armorProficiencies: [],
    weaponProficiencies: ['Daggers', 'Quarterstaffs', 'Light crossbows'],
    skillChoices: { count: 2, from: ['arcana', 'history', 'insight', 'investigation', 'medicine', 'religion'] },
    features: [
      { name: 'Words of Command', text: 'Twice (until you recover at a mana totem, an inn or a camp), speak a word of power: kindle a light or flame, bar a door, or force a creature within 9 m to make a Wisdom save (DC 8 + proficiency + INT) or be stunned until the end of its next turn.' },
      { name: 'Ancient Lore', text: 'Add your Intelligence modifier a second time to checks about ancient history, ruins, runes and artefacts.' },
    ],
    equipment: [W('Quarterstaff', '1d6', 'bludgeoning', 'str'), W('Dagger', '1d4', 'piercing', 'dex', { finesse: true, properties: ['finesse', 'thrown 20/60'] }), G('Book of old lore'), G('Scholar\'s pack')],
    kit: ['quarterstaff', 'dagger', 'book-of-lore', 'scholar'],
  },
  {
    id: 'minstrel',
    spellcasting: { ability: 'cha', type: 'full' },
    name: 'Minstrel',
    tagline: 'Songs of the elder days that lift weary hearts.',
    description: 'Minstrels carry the memory of peoples in their songs. Their music heartens allies, unsettles foes and opens the doors of great halls.',
    hitDie: 8,
    primary: ['cha', 'dex'],
    abilityPriority: ['cha', 'dex', 'con', 'wis', 'int', 'str'],
    savingThrows: ['dex', 'cha'],
    armorProficiencies: ['Light armour'],
    weaponProficiencies: ['Simple weapons', 'Rapiers', 'Short swords', 'Longswords'],
    skillChoices: { count: 3, from: ['acrobatics', 'animal-handling', 'arcana', 'athletics', 'deception', 'history', 'insight', 'intimidation', 'investigation', 'medicine', 'nature', 'perception', 'performance', 'persuasion', 'religion', 'sleight-of-hand', 'stealth', 'survival'] },
    features: [
      { name: 'Song of Heartening', text: 'As a bonus action, grant an ally who can hear you a d6 they can add to one roll in the next 10 minutes. Uses equal to your Charisma modifier (minimum 1) , refilled at a mana totem, an inn or a camp.' },
      { name: 'Welcome in Every Hall', text: 'Common folk and lords alike will offer you food and a place by the fire in exchange for a song.' },
    ],
    equipment: [A('Leather jerkin', 11, null), W('Short sword', '1d6', 'piercing', 'dex', { finesse: true, properties: ['finesse', 'light'] }), G('Harp or flute'), G('Entertainer\'s pack')],
    kit: ['leather', 'shortsword', 'instrument', 'entertainer'],
  },
  {
    id: 'warden',
    spellcasting: { ability: 'wis', type: 'half' },
    name: 'Warden',
    tagline: 'Healer and protector, steadfast as an old oak.',
    description: 'Wardens tend the wounded and guard the helpless. They know the herbs that drive back the cold of evil wounds, and they do not give ground.',
    hitDie: 10,
    primary: ['wis', 'con'],
    abilityPriority: ['wis', 'con', 'str', 'dex', 'cha', 'int'],
    savingThrows: ['con', 'wis'],
    armorProficiencies: ['Light armour', 'Medium armour', 'Shields'],
    weaponProficiencies: ['Simple weapons'],
    skillChoices: { count: 2, from: ['animal-handling', 'insight', 'medicine', 'nature', 'perception', 'survival'] },
    features: [
      { name: 'Healing Hands', text: 'You have a pool of healing equal to 5 x your level, refilled at a mana totem, an inn or a camp. As an action, touch a creature to restore any number of hit points from the pool.' },
      { name: 'Steadfast', text: 'You cannot be moved against your will while standing your ground, and allies within 3 m have advantage on saves against fear.' },
    ],
    equipment: [A('Scale coat', 14, 2), SHIELD, W('Spear', '1d6', 'piercing', 'str', { properties: ['versatile 1d8'] }), G('Herbalism kit'), G('Traveller\'s pack')],
    kit: ['scale-mail', 'shield', 'spear', 'herbalism-kit', 'healers-kit', ['bandage', 5], 'traveller'],
  },
];
