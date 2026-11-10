/**
 * Kindreds of the Westlands. Mechanics follow the 5e SRD race structure
 * (ability bonuses, speed, traits); flavour is original, Tolkien-inspired.
 */
export const races = [
  {
    id: 'men-west',
    name: 'Men of the West',
    tagline: 'Heirs of a drowned kingdom, long-lived and watchful.',
    description:
      'Descended from the sea-kings of old, these tall and grave folk live longer than other Men. '
      + 'Few now remember their deeds; they walk the wild places as wardens, unthanked, keeping the dark at bay.',
    abilityBonuses: { str: 1, con: 1, wis: 1 },
    speed: 30,
    size: 'Medium',
    skillProficiencies: ['survival'],
    languages: ['Common Speech', 'Elvish (Grey-tongue)'],
    traits: [
      { name: 'Blood of the Sea-Kings', text: 'You live for two centuries or more and recover quickly: when you take a short rest you may reroll any 1s on hit dice spent.' },
      { name: 'Foresight', text: 'Once per long rest, after the Narrator describes a scene, you may ask one question about lurking danger and receive a truthful hint.' },
    ],
  },
  {
    id: 'men-plains',
    name: 'Riders of the Plains',
    tagline: 'Proud horse-folk of the grasslands.',
    description:
      'Fair-haired riders who live by the horse and the spear. They sing of their fathers\' deeds in long halls of timber '
      + 'and answer any call to war with a thunder of hooves.',
    abilityBonuses: { str: 1, dex: 1, cha: 1 },
    speed: 30,
    size: 'Medium',
    skillProficiencies: ['animal-handling'],
    languages: ['Common Speech', 'Plains-tongue'],
    traits: [
      { name: 'Born in the Saddle', text: 'Mounting or dismounting costs you only 5 feet of movement, and you have advantage on checks to stay mounted.' },
      { name: 'Thunder of Hooves', text: 'When you charge at least 20 feet on horseback, your first melee hit deals an extra 1d6 damage.' },
    ],
  },
  {
    id: 'elf',
    name: 'Elves',
    tagline: 'The Firstborn, deathless and fading.',
    description:
      'Elves remember the light of the elder days and grieve for what was lost. They are tireless, graceful and keen of sight; '
      + 'many have already sailed into the West, and those who remain fight a long defeat.',
    abilityBonuses: { dex: 2 },
    speed: 30,
    size: 'Medium',
    skillProficiencies: ['perception'],
    languages: ['Common Speech', 'Elvish (Grey-tongue)'],
    traits: [
      { name: 'Starlit Sight', text: 'You see in dim light within 60 feet as if it were bright light, and in darkness as if it were dim light.' },
      { name: 'Undying Spirit', text: 'You have advantage on saving throws against being frightened or charmed, and magic cannot put you to sleep.' },
      { name: 'Reverie', text: 'You do not sleep. Instead you rest in waking dreams for 4 hours and gain the benefit of a long rest.' },
    ],
    subraces: [
      {
        id: 'high',
        name: 'Elves of the Elder Light',
        description: 'Those who once dwelt in the blessed West. Wise in lore and craft; their eyes still hold a gleam of the ancient light.',
        abilityBonuses: { int: 1 },
        languages: ['Elvish (High-tongue)'],
        traits: [{ name: 'Memory of the Elder Days', text: 'You have advantage on History checks concerning ancient realms, artefacts and the deeds of the Firstborn.' }],
      },
      {
        id: 'wood',
        name: 'Wood-elves',
        description: 'Merry and wary folk of the great forests, who love the stars and the song of the trees.',
        abilityBonuses: { wis: 1 },
        speed: 35,
        traits: [{ name: 'Forest-walker', text: 'You can attempt to hide even when only lightly obscured by foliage, mist or falling snow.' }],
      },
    ],
  },
  {
    id: 'dwarf',
    name: 'Dwarves',
    tagline: 'Stone-hearted folk of the deep halls.',
    description:
      'Stubborn, proud and unbreakable, Dwarves delve for true-silver and gold beneath the mountains. Their grudges last '
      + 'longer than most kingdoms, and so does their friendship once given.',
    abilityBonuses: { con: 2 },
    speed: 25,
    size: 'Medium',
    skillProficiencies: [],
    languages: ['Common Speech', 'Dwarvish (secret tongue)'],
    traits: [
      { name: 'Darkvision', text: 'Accustomed to life underground, you see in darkness within 60 feet as if it were dim light.' },
      { name: 'Stout Heart', text: 'You have advantage on saving throws against poison and resistance to poison damage. Heavy armour does not slow you.' },
      { name: 'Stonecunning', text: 'When you make a History check about stonework, add double your proficiency bonus.' },
    ],
    subraces: [
      {
        id: 'longbeard',
        name: 'Folk of the Deep Halls',
        description: 'The eldest house of the Dwarves, keepers of the great mansions under the mountains. Tough as old roots.',
        abilityBonuses: { wis: 1 },
        hpPerLevel: 1,
        traits: [{ name: 'Dwarven Toughness', text: 'Your hit point maximum increases by 1, and by 1 again every time you gain a level.' }],
      },
      {
        id: 'ironfolk',
        name: 'Ironfolk of the Eastern Hills',
        description: 'Warlike smiths of the eastern ranges, famed for mattocks, mail and a fearsome battle-cry.',
        abilityBonuses: { str: 2 },
        traits: [{ name: 'Smith-born', text: 'You are proficient with smith\'s tools, and you can wear medium armour without penalty to Stealth.' }],
      },
    ],
  },
  {
    id: 'halfling',
    name: 'Halflings',
    tagline: 'Small, comfortable folk with surprising courage.',
    description:
      'Halflings love good food, quiet gardens and a well-stocked pantry. Adventures make one late for dinner, they say, '
      + 'and yet when the world is darkest, these small folk are often found where the great would not dare to go.',
    abilityBonuses: { dex: 2 },
    speed: 25,
    size: 'Small',
    skillProficiencies: [],
    languages: ['Common Speech'],
    traits: [
      { name: 'Lucky', text: 'When you roll a 1 on a d20 for an attack, ability check or saving throw, you may reroll and must use the new roll.' },
      { name: 'Brave', text: 'You have advantage on saving throws against being frightened.' },
      { name: 'Nimble', text: 'You can move through the space of any creature larger than you.' },
    ],
    subraces: [
      {
        id: 'hillfolk',
        name: 'Hillfolk',
        description: 'The most common sort: friendly, sociable and fond of a good party.',
        abilityBonuses: { cha: 1 },
        traits: [{ name: 'Naturally Stealthy', text: 'You can attempt to hide even when only obscured by a creature at least one size larger than you.' }],
      },
      {
        id: 'riverfolk',
        name: 'Riverfolk',
        description: 'Broader, hardier halflings of the riverbanks who, unusually, like boats and are not afraid of water.',
        abilityBonuses: { con: 1 },
        traits: [{ name: 'Stout Stomach', text: 'You have advantage on saving throws against poison, and resistance to poison damage.' }],
      },
    ],
  },
];
