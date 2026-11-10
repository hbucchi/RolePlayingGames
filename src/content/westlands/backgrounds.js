/** Backgrounds: where your hero came from before the adventure began. */
const G = (name) => ({ kind: 'gear', name });

export const backgrounds = [
  {
    id: 'wanderer',
    name: 'Wanderer',
    description: 'You have walked many roads and slept under many skies, never long in one place.',
    skills: ['survival', 'insight'],
    feature: { name: 'Roads Remembered', text: 'You always know the nearest road, ford or shelter, and can find food and fresh water for yourself and five others each day.' },
    equipment: [G('Walking staff'), G('Weathered map')],
    kit: ['quarterstaff', 'weathered-map', 'kingsfoil'], coins: 1000,
  },
  {
    id: 'scholar',
    name: 'Scholar of the Archives',
    description: 'You spent years among dusty scrolls in a great city\'s library, copying chronicles nobody else reads.',
    skills: ['history', 'investigation'],
    feature: { name: 'Researcher', text: 'When you do not know a piece of lore, you know which archive, sage or ruin might hold the answer.' },
    equipment: [G('Ink, quill and parchment'), G('Letter of introduction')],
    kit: ['ink-quill', 'letter-of-introduction'], coins: 1000,
  },
  {
    id: 'soldier',
    name: 'Soldier of the Watch',
    description: 'You served on a border garrison, standing watch through long nights while the enemy gathered beyond the river.',
    skills: ['athletics', 'intimidation'],
    feature: { name: 'Military Rank', text: 'Soldiers of your former realm recognise your rank, and you can requisition simple gear and horses from friendly garrisons.' },
    equipment: [G('Insignia of rank'), G('Horn')],
    kit: ['insignia', 'horn', ['bandage', 3]], coins: 1000,
  },
  {
    id: 'hearthfolk',
    name: 'Hearth-folk',
    description: 'You grew up in a quiet farming country of hedges and gardens, and never expected to leave it.',
    skills: ['animal-handling', 'nature'],
    feature: { name: 'Rustic Hospitality', text: 'Country folk see you as one of their own; they will shelter you and hide you from pursuers unless it would endanger them.' },
    equipment: [G('Pipe and leaf'), G('Gardening hoe'), G('Pocket handkerchief')],
    kit: ['pipe-and-leaf', 'handkerchief', ['kingsfoil', 2]], coins: 1000,
  },
  {
    id: 'exile',
    name: 'Exile',
    description: 'You were driven from your homeland for a crime, true or false. You carry its memory like a stone.',
    skills: ['deception', 'stealth'],
    feature: { name: 'Hidden Past', text: 'You can pass as a commoner of almost any land, and you know how to find people who ask no questions.' },
    equipment: [G('Token of your lost home'), G('Dark cloak')],
    kit: ['home-token', 'dark-cloak'], coins: 1000,
  },
  {
    id: 'trader',
    name: 'River Trader',
    description: 'You worked the barges and markets of the great river, haggling with Men, Dwarves and stranger folk.',
    skills: ['persuasion', 'perception'],
    feature: { name: 'Trade Network', text: 'In any town on a river or road you can find a merchant who owes you a favour or will sell to you at a fair price.' },
    equipment: [G('Merchant\'s scales'), G('Purse of 15 silver pennies')],
    kit: ['merchants-scales'], coins: 1500,
  },
];
