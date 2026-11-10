/**
 * Creatures that haunt the Westlands dungeons, from vermin for a new hero to horrors for a
 * veteran. The encounter builder picks from these by the hero's level and XP budget.
 */
export const DUNGEON_FOES = [
  'pit-runt', 'dark-wood-spiderling', 'crag-bat', // CR 1/8: first delves
  'goblin', 'mountain-goblin', 'wolf', 'skeleton', 'giant-wolf-spider', // CR 1/4
  'black-pit-orc', 'orc-tracker', 'worg', // CR 1/2
  'dire-wolf', 'giant-spider', 'amazon-spear-maiden', 'amazon-archer', // CR 1
  'shadow-wolf', 'sun-hardened-great-orc', 'hollow-hill-lurker', // CR 2
  'great-goblin-of-the-mountain-halls', 'wight', 'weaver-of-the-nightwood', 'amazon-huntress', // CR 3
  'hill-troll', 'orc-captain', // CR 4
  'cairn-wight', 'stone-troll', 'snow-troll', 'shadow-wolf-chieftain', // CR 5
  'herald-of-the-dark-tower', 'amazon-war-queen', 'cave-troll', 'spirit-wolf-of-the-shadow', 'shadow-bred-war-troll', // CR 6-9
  'hooded-rider-of-the-shadow', 'fallen-loremaster', 'dread-sovereign-of-the-hooded-riders', // CR 10+
];
