import { mw, act, multi, lore, T } from './dsl.js';

/**
 * True dragons share one structure across four ages, so they are generated from a table.
 * Row: [age, ac, hitDice, speed, abilities, saves, skills, cr, biteDamage, clawDice, breathFeet, breathDice, breathDC]
 * Damage bonus = STR modifier; to-hit = proficiency + STR modifier (computed below).
 */
const SIZE = { wyrmling: 'Medium', young: 'Large', adult: 'Huge', ancient: 'Gargantuan' };
const REACH = { wyrmling: [5, 5, 0], young: [10, 5, 0], adult: [10, 5, 15], ancient: [15, 10, 20] };
const SENSES = {
  wyrmling: { blindsight: 10, darkvision: 60 }, young: { blindsight: 30, darkvision: 120 },
  adult: { blindsight: 60, darkvision: 120 }, ancient: { blindsight: 60, darkvision: 120 },
};
const pbFor = (cr) => (cr <= 4 ? 2 : cr <= 8 ? 3 : cr <= 12 ? 4 : cr <= 16 ? 5 : cr <= 20 ? 6 : cr <= 24 ? 7 : 8);
const mod = (s) => Math.floor((s - 10) / 2);
const avg = (n, s) => Math.floor((n * (s + 1)) / 2);

const COLORS = {
  // ---- Chromatic -----------------------------------------------------------
  black: {
    alignment: 'chaotic evil', element: 'acid', shape: 'line', save: 'dex', breathName: 'Acid Breath', amphibious: true,
    rows: [
      ['wyrmling', 17, '6d8+6', { walk: 30, fly: 60, swim: 30 }, [15, 14, 13, 10, 11, 13], { dex: 4, con: 3, wis: 2, cha: 3 }, { perception: 4, stealth: 4 }, 2, '1d4', '', 15, '5d8', 11],
      ['young', 18, '15d10+45', { walk: 40, fly: 80, swim: 40 }, [19, 14, 17, 12, 11, 15], { dex: 5, con: 6, wis: 3, cha: 5 }, { perception: 6, stealth: 5 }, 7, '1d8', '2d6', 30, '11d8', 14],
      ['adult', 19, '17d12+85', { walk: 40, fly: 80, swim: 40 }, [23, 14, 21, 14, 13, 17], { dex: 7, con: 10, wis: 6, cha: 8 }, { perception: 11, stealth: 7 }, 14, '1d8', '2d6', 60, '12d8', 18],
      ['ancient', 22, '21d20+147', { walk: 40, fly: 80, swim: 40 }, [27, 14, 25, 16, 15, 19], { dex: 9, con: 14, wis: 9, cha: 11 }, { perception: 16, stealth: 9 }, 21, '2d8', '2d6', 90, '15d8', 22],
    ],
    habitat: ['swamp'],
    personality: 'Cruel, vindictive and patient; enjoys watching the weak despair.',
    origin: 'Black dragons lair in sunken ruins and rotting swamps, dissolving the remains of fallen kingdoms and hoarding their relics.',
    tactics: 'Ambush from murky water, breathe acid down a line of foes, then retreat underwater to wait.',
  },
  blue: {
    alignment: 'lawful evil', element: 'lightning', shape: 'line', save: 'dex', breathName: 'Lightning Breath',
    rows: [
      ['wyrmling', 17, '8d8+16', { walk: 30, burrow: 15, fly: 60 }, [17, 10, 15, 12, 11, 15], { dex: 2, con: 4, wis: 2, cha: 4 }, { perception: 4, stealth: 2 }, 3, '1d6', '', 30, '4d10', 12],
      ['young', 18, '16d10+64', { walk: 40, burrow: 20, fly: 80 }, [21, 10, 19, 14, 13, 17], { dex: 4, con: 8, wis: 5, cha: 7 }, { perception: 9, stealth: 4 }, 9, '1d10', '2d6', 60, '10d10', 16],
      ['adult', 19, '18d12+108', { walk: 40, burrow: 30, fly: 80 }, [25, 10, 23, 16, 15, 19], { dex: 5, con: 11, wis: 7, cha: 9 }, { perception: 12, stealth: 5 }, 16, '1d10', '2d6', 90, '12d10', 19],
      ['ancient', 22, '26d20+208', { walk: 40, burrow: 40, fly: 80 }, [29, 10, 27, 18, 17, 21], { dex: 7, con: 15, wis: 10, cha: 12 }, { perception: 17, stealth: 7 }, 23, '2d10', '2d6', 120, '16d10', 23],
    ],
    habitat: ['desert', 'coast'],
    personality: 'Vain, territorial and orderly; demands tribute and obedience.',
    origin: 'Blue dragons rule deserts from lairs beneath the sand, keeping lesser creatures as servants and gems as their pride.',
    tactics: 'Burrow under the sand, erupt beneath foes, fly high and blast with lightning from range.',
  },
  green: {
    alignment: 'lawful evil', element: 'poison', shape: 'cone', save: 'con', breathName: 'Poison Breath', amphibious: true,
    rows: [
      ['wyrmling', 17, '7d8+7', { walk: 30, fly: 60, swim: 30 }, [15, 12, 13, 14, 11, 13], { dex: 3, con: 3, wis: 2, cha: 3 }, { perception: 4, stealth: 3 }, 2, '1d6', '', 15, '6d6', 11],
      ['young', 18, '16d10+48', { walk: 40, fly: 80, swim: 40 }, [19, 12, 17, 16, 13, 15], { dex: 4, con: 6, wis: 4, cha: 5 }, { deception: 5, perception: 7, stealth: 4 }, 8, '2d6', '2d6', 30, '12d6', 14],
      ['adult', 19, '18d12+90', { walk: 40, fly: 80, swim: 40 }, [23, 12, 21, 18, 15, 17], { dex: 6, con: 10, wis: 7, cha: 8 }, { deception: 8, insight: 7, perception: 12, persuasion: 8, stealth: 6 }, 15, '2d6', '4d6', 60, '16d6', 18],
      ['ancient', 21, '22d20+154', { walk: 40, fly: 80, swim: 40 }, [27, 12, 25, 20, 17, 19], { dex: 8, con: 14, wis: 10, cha: 11 }, { deception: 11, insight: 10, perception: 17, persuasion: 11, stealth: 8 }, 22, '3d6', '4d6', 90, '22d6', 22],
    ],
    habitat: ['forest'],
    personality: 'Deceitful, manipulative and proud; loves to make others betray themselves.',
    origin: 'Green dragons claim ancient forests, twisting the elves, woodfolk and beasts within into spies and servants.',
    tactics: 'Talk first, poison second; corrupt a foe with promises, then breathe on the group when it is clustered.',
  },
  red: {
    alignment: 'chaotic evil', element: 'fire', shape: 'cone', save: 'dex', breathName: 'Fire Breath',
    rows: [
      ['wyrmling', 17, '10d8+30', { walk: 30, climb: 30, fly: 60 }, [19, 10, 17, 12, 11, 15], { dex: 2, con: 5, wis: 2, cha: 4 }, { perception: 4, stealth: 2 }, 4, '1d6', '', 15, '7d6', 13],
      ['young', 18, '17d10+85', { walk: 40, climb: 40, fly: 80 }, [23, 10, 21, 14, 11, 19], { dex: 4, con: 9, wis: 4, cha: 8 }, { perception: 8, stealth: 4 }, 10, '1d6', '2d6', 30, '16d6', 17],
      ['adult', 19, '19d12+133', { walk: 40, climb: 40, fly: 80 }, [27, 10, 25, 16, 13, 21], { dex: 6, con: 13, wis: 7, cha: 11 }, { perception: 13, stealth: 6 }, 17, '2d6', '2d6', 60, '18d6', 21],
      ['ancient', 22, '28d20+252', { walk: 40, climb: 40, fly: 80 }, [30, 10, 29, 18, 15, 23], { dex: 7, con: 16, wis: 9, cha: 13 }, { perception: 16, stealth: 7 }, 24, '4d6', '2d6', 90, '26d6', 24],
    ],
    habitat: ['mountain', 'hill'],
    personality: 'Arrogant beyond measure, greedy and wrathful; believes the world owes it tribute.',
    origin: 'Red dragons nest in volcanic peaks and conquered dwarf-halls, sleeping on mountains of gold and remembering every coin.',
    tactics: 'Fly in, terrify with presence, burn everything in a cone, and finish the survivors with claw and tail.',
  },
  white: {
    alignment: 'chaotic evil', element: 'cold', shape: 'cone', save: 'con', breathName: 'Cold Breath', iceWalk: true,
    rows: [
      ['wyrmling', 16, '5d8+10', { walk: 30, burrow: 15, fly: 60, swim: 30 }, [14, 10, 14, 5, 10, 11], { dex: 2, con: 4, wis: 2, cha: 2 }, { perception: 4, stealth: 2 }, 2, '1d4', '', 15, '5d8', 12],
      ['young', 17, '14d10+56', { walk: 40, burrow: 20, fly: 80, swim: 40 }, [18, 10, 18, 6, 11, 12], { dex: 3, con: 7, wis: 3, cha: 4 }, { perception: 6, stealth: 3 }, 6, '1d8', '2d6', 30, '10d8', 15],
      ['adult', 18, '16d12+96', { walk: 40, burrow: 30, fly: 80, swim: 40 }, [22, 10, 22, 8, 12, 12], { dex: 5, con: 11, wis: 6, cha: 6 }, { perception: 11, stealth: 5 }, 13, '1d8', '2d6', 60, '12d8', 19],
      ['ancient', 20, '18d20+144', { walk: 40, burrow: 40, fly: 80, swim: 40 }, [26, 10, 26, 10, 13, 14], { dex: 6, con: 14, wis: 7, cha: 8 }, { perception: 13, stealth: 6 }, 20, '2d8', '2d6', 90, '16d8', 22],
    ],
    habitat: ['arctic', 'mountain'],
    personality: 'Bestial, simple and savage; driven by hunger and a hoarder\'s instinct.',
    origin: 'White dragons haunt icy wastes and glacier caves, freezing their prey and trophies into the walls of their lairs.',
    tactics: 'Strike from snowstorms, breathe frost, and drag victims under the ice.',
  },
  // ---- Metallic ------------------------------------------------------------
  brass: {
    alignment: 'chaotic good', element: 'fire', shape: 'line', save: 'dex', breathName: 'Fire Breath', second: ['Sleep Breath', 'cone', 'con', 'falls unconscious for {dur}. This effect ends if it takes damage or someone uses an action to wake it.'],
    rows: [
      ['wyrmling', 16, '3d8+3', { walk: 30, burrow: 15, fly: 60 }, [15, 10, 13, 10, 11, 13], { dex: 2, con: 3, wis: 2, cha: 3 }, { perception: 4, stealth: 2 }, 1, '', '', 20, '4d6', 11, 15, '1 minute'],
      ['young', 17, '13d10+39', { walk: 40, burrow: 20, fly: 80 }, [19, 10, 17, 12, 11, 15], { dex: 3, con: 6, wis: 3, cha: 5 }, { perception: 6, persuasion: 5, stealth: 3 }, 6, '', '2d6', 40, '12d6', 14, 30, '5 minutes'],
      ['adult', 18, '15d12+75', { walk: 40, burrow: 30, fly: 80 }, [23, 10, 21, 14, 13, 17], { dex: 5, con: 10, wis: 6, cha: 8 }, { history: 7, perception: 11, persuasion: 8, stealth: 5 }, 13, '', '2d6', 60, '13d6', 18, 60, '10 minutes'],
      ['ancient', 20, '17d20+119', { walk: 40, burrow: 40, fly: 80 }, [27, 10, 25, 16, 15, 19], { dex: 6, con: 13, wis: 8, cha: 10 }, { history: 9, perception: 14, persuasion: 10, stealth: 6 }, 20, '', '2d6', 90, '16d6', 21, 90, '10 minutes'],
    ],
    habitat: ['desert'],
    personality: 'Talkative, nosy and sociable; would rather chat for hours than fight.',
    origin: 'Brass dragons sun themselves in hot deserts and collect gossip as eagerly as treasure.',
    tactics: 'Sleep-breathe annoying visitors, then interrogate them politely when they wake.',
  },
  bronze: {
    alignment: 'lawful good', element: 'lightning', shape: 'line', save: 'dex', breathName: 'Lightning Breath', amphibious: true, second: ['Repulsion Breath', 'cone', 'str', 'is pushed {dur} away from the dragon.'],
    rows: [
      ['wyrmling', 17, '5d8+10', { walk: 30, fly: 60, swim: 30 }, [17, 10, 15, 12, 11, 15], { dex: 2, con: 4, wis: 2, cha: 4 }, { perception: 4, stealth: 2 }, 2, '', '', 40, '3d10', 12, 30, '30 feet'],
      ['young', 18, '15d10+60', { walk: 40, fly: 80, swim: 40 }, [21, 10, 19, 14, 13, 17], { dex: 3, con: 7, wis: 4, cha: 6 }, { insight: 4, perception: 7, stealth: 3 }, 8, '', '2d6', 60, '10d10', 15, 30, '40 feet'],
      ['adult', 19, '17d12+102', { walk: 40, fly: 80, swim: 40 }, [25, 10, 23, 16, 15, 19], { dex: 5, con: 11, wis: 7, cha: 9 }, { insight: 7, perception: 12, stealth: 5 }, 15, '', '2d6', 90, '12d10', 19, 30, '60 feet'],
      ['ancient', 22, '24d20+192', { walk: 40, fly: 80, swim: 40 }, [29, 10, 27, 18, 17, 21], { dex: 7, con: 15, wis: 10, cha: 12 }, { insight: 10, perception: 17, stealth: 7 }, 22, '', '2d6', 120, '16d10', 23, 30, '60 feet'],
    ],
    habitat: ['coast'],
    personality: 'Dutiful, curious about mortals, and fond of a good naval battle.',
    origin: 'Bronze dragons dwell in sea caves and watch over shipping lanes, sometimes disguised as sailors.',
    tactics: 'Push enemy ships and boarders away with repulsion breath, then strike with lightning.',
  },
  copper: {
    alignment: 'chaotic good', element: 'acid', shape: 'line', save: 'dex', breathName: 'Acid Breath', second: ['Slowing Breath', 'cone', 'con', 'can\'t use reactions, its speed is halved, and it can\'t make more than one attack on its turn for 1 minute. It can repeat the save at the end of each of its turns.'],
    rows: [
      ['wyrmling', 16, '4d8+4', { walk: 30, climb: 30, fly: 60 }, [15, 12, 13, 14, 11, 13], { dex: 3, con: 3, wis: 2, cha: 3 }, { perception: 4, stealth: 3 }, 1, '', '', 20, '4d8', 11, 15],
      ['young', 17, '14d10+42', { walk: 40, climb: 40, fly: 80 }, [19, 12, 17, 16, 13, 15], { dex: 4, con: 6, wis: 4, cha: 5 }, { deception: 5, perception: 7, stealth: 4 }, 7, '', '2d6', 40, '9d8', 14, 30],
      ['adult', 18, '16d12+80', { walk: 40, climb: 40, fly: 80 }, [23, 12, 21, 18, 15, 17], { dex: 6, con: 10, wis: 7, cha: 8 }, { deception: 8, perception: 12, stealth: 6 }, 14, '', '2d6', 60, '12d8', 18, 60],
      ['ancient', 21, '20d20+140', { walk: 40, climb: 40, fly: 80 }, [27, 12, 25, 20, 17, 19], { dex: 8, con: 14, wis: 10, cha: 11 }, { deception: 11, perception: 17, stealth: 8 }, 21, '', '2d6', 90, '14d8', 22, 90],
    ],
    habitat: ['hill', 'mountain'],
    personality: 'Playful jokers who love riddles and pranks, and sulk if no one laughs.',
    origin: 'Copper dragons live in rocky uplands, riddling travellers and hoarding curiosities.',
    tactics: 'Slow the group, then toy with them; turn deadly only against real villains.',
  },
  gold: {
    alignment: 'lawful good', element: 'fire', shape: 'cone', save: 'dex', breathName: 'Fire Breath', amphibious: true, second: ['Weakening Breath', 'cone', 'str', 'has disadvantage on Strength-based attack rolls, Strength checks, and Strength saving throws for 1 minute. It can repeat the save at the end of each of its turns.'],
    rows: [
      ['wyrmling', 17, '8d8+24', { walk: 30, fly: 60, swim: 30 }, [19, 14, 17, 14, 11, 16], { dex: 4, con: 5, wis: 2, cha: 5 }, { perception: 4, stealth: 4 }, 3, '', '', 15, '4d10', 13, 15],
      ['young', 18, '17d10+85', { walk: 40, fly: 80, swim: 40 }, [23, 14, 21, 16, 13, 20], { dex: 6, con: 9, wis: 5, cha: 9 }, { insight: 5, perception: 9, persuasion: 9, stealth: 6 }, 10, '', '2d6', 30, '10d10', 17, 30],
      ['adult', 19, '19d12+133', { walk: 40, fly: 80, swim: 40 }, [27, 14, 25, 16, 15, 24], { dex: 8, con: 13, wis: 8, cha: 13 }, { insight: 8, perception: 14, persuasion: 13, stealth: 8 }, 17, '', '2d6', 60, '12d10', 21, 60],
      ['ancient', 22, '28d20+252', { walk: 40, fly: 80, swim: 40 }, [30, 14, 29, 18, 17, 28], { dex: 9, con: 16, wis: 10, cha: 16 }, { insight: 10, perception: 17, persuasion: 16, stealth: 9 }, 24, '', '2d6', 90, '13d10', 24, 90],
    ],
    habitat: ['forest', 'grassland', 'coast'],
    personality: 'Wise, just and serene; patient beyond mortal understanding.',
    origin: 'Gold dragons are the noblest of their kind, wandering in disguise to test and help mortals.',
    tactics: 'Weaken brutes, burn the truly wicked, and spare whoever surrenders.',
  },
  silver: {
    alignment: 'lawful good', element: 'cold', shape: 'cone', save: 'con', breathName: 'Cold Breath', second: ['Paralyzing Breath', 'cone', 'con', 'is paralyzed for 1 minute. It can repeat the save at the end of each of its turns.'],
    rows: [
      ['wyrmling', 17, '6d8+18', { walk: 30, fly: 60 }, [19, 10, 17, 12, 11, 15], { dex: 2, con: 5, wis: 2, cha: 4 }, { perception: 4, stealth: 2 }, 2, '', '', 15, '4d8', 13, 15],
      ['young', 18, '16d10+80', { walk: 40, fly: 80 }, [23, 10, 21, 14, 11, 19], { dex: 4, con: 9, wis: 4, cha: 8 }, { arcana: 6, history: 6, perception: 8, stealth: 4 }, 9, '', '2d6', 30, '12d8', 17, 30],
      ['adult', 19, '18d12+126', { walk: 40, fly: 80 }, [27, 10, 25, 16, 13, 21], { dex: 5, con: 12, wis: 6, cha: 10 }, { arcana: 8, history: 8, perception: 11, stealth: 5 }, 16, '', '2d6', 60, '13d8', 20, 60],
      ['ancient', 22, '25d20+225', { walk: 40, fly: 80 }, [30, 10, 29, 18, 15, 23], { dex: 7, con: 16, wis: 9, cha: 13 }, { arcana: 11, history: 11, perception: 16, stealth: 7 }, 23, '', '2d6', 90, '15d8', 24, 90],
    ],
    habitat: ['mountain', 'arctic'],
    personality: 'Kind and friendly; loves mortal company and often lives among people in disguise.',
    origin: 'Silver dragons dwell on cloud-wreathed peaks but spend much of their lives in human or elven form.',
    tactics: 'Paralyse rather than kill; freeze those who threaten the innocent.',
  },
};

const LOOK = {
  black: 'glossy black scales, a skull-like face with forward-swept horns, and acid dripping from its jaws, in a fetid swamp of rotting trees',
  blue: 'cobalt-blue scales, a single great horn on its snout, frilled ears and crackling lightning around its jaws, beneath a desert storm',
  green: 'emerald-green scales, a long crest running from head to tail, and a sinuous body, coiled among ancient forest trees in poisonous mist',
  red: 'crimson scales, swept-back horns, a smoking mouth full of fangs and enormous wings, perched on a hoard of gold inside a volcanic cavern',
  white: 'frost-white scales, a crested head with a beak-like snout, and icy breath, crouched on a glacier under a pale sky',
  brass: 'brass-coloured scales, a broad head-plate like a shield, and wide wings, basking on warm desert rocks',
  bronze: 'bronze scales with a sea-green sheen, ridged horns and a fin-like frill, rising from waves near a sea cliff',
  copper: 'gleaming copper scales with a blue-green patina, long backswept horns and a playful expression, perched on red canyon rocks',
  gold: 'shining golden scales, a whiskered face, a majestic frill of horns, and a serene, wise gaze, resting beside a clear forest lake',
  silver: 'bright silver scales, a smooth frilled head and kind eyes, gliding among snowy mountain peaks and clouds',
};
const AGE_LOOK = {
  wyrmling: 'A dog-sized baby dragon with oversized eyes and wings it has not grown into, with',
  young: 'A horse-sized young dragon, lean and powerful, with',
  adult: 'A huge adult dragon the size of a house, armoured and terrifying, with',
  ancient: 'A gargantuan ancient dragon as large as a castle, its scales scarred and thick as shields, with',
};

const ageLore = {
  wyrmling: 'A wyrmling is young, reckless and testing its strength; it has not yet learned caution.',
  young: 'A young dragon is claiming its first territory and eager to prove itself.',
  adult: 'An adult dragon rules its domain and its lair warps the land around it.',
  ancient: 'An ancient dragon has outlived kingdoms; its name is spoken in legend.',
};

function makeDragon(color, def, row) {
  const [age, ac, hp, speed, ab, saves, skills, cr, biteExtra, clawDice, breathFeet, breathDice, breathDC, secondFeet, secondDur] = row;
  const pb = pbFor(cr);
  const sm = mod(ab[0]);
  const hit = pb + sm;
  const [biteReach, clawReach, tailReach] = REACH[age];
  const big = age === 'adult' || age === 'ancient';
  const name = `${age[0].toUpperCase()}${age.slice(1)} ${color[0].toUpperCase()}${color.slice(1)} Dragon`;
  const biteDice = age === 'wyrmling' ? '1d10' : '2d10';
  const saveName = { dex: 'Dexterity', con: 'Constitution', str: 'Strength' };
  const area = def.shape === 'line' ? `${breathFeet}-foot line that is 5 feet wide` : `${breathFeet}-foot cone`;
  const n = Number(breathDice.split('d')[0]); const s = Number(breathDice.split('d')[1]);
  const breathText = `Exhales ${def.element} in a ${area}. Each creature in that area must make a DC ${breathDC} ${saveName[def.save]} saving throw, taking ${avg(n, s)} (${breathDice}) ${def.element} damage on a failed save, or half as much on a success.`;

  const actions = [];
  if (age !== 'wyrmling') actions.push(multi(big ? 'Can use its Frightful Presence. It then makes three attacks: one with its bite and two with its claws.' : 'Makes three attacks: one with its bite and two with its claws.'));
  actions.push(mw('Bite', hit, biteReach, [`${biteDice}+${sm} piercing`, biteExtra ? `${biteExtra} ${def.element}` : null]));
  if (clawDice) actions.push(mw('Claw', hit, clawReach, `${clawDice}+${sm} slashing`));
  if (tailReach) actions.push(mw('Tail', hit, tailReach, `2d8+${sm} bludgeoning`));
  const fpDC = 8 + pb + mod(ab[5]);
  if (big) actions.push(act('Frightful Presence', `Each creature of the dragon's choice within 120 feet that is aware of it must succeed on a DC ${fpDC} Wisdom saving throw or become frightened for 1 minute. A creature can repeat the save at the end of each of its turns, and is immune to this dragon's Frightful Presence for 24 hours on a success.`));
  if (def.second) {
    const [secName, secShape, secSave, effect] = def.second;
    const secArea = secShape === 'line' ? `${secondFeet}-foot line` : `${secondFeet}-foot cone`;
    actions.push(act('Breath Weapons (Recharge 5-6)', `Uses one of the following breath weapons. ${def.breathName}: ${breathText} ${secName}: Each creature in a ${secArea} must succeed on a DC ${breathDC} ${saveName[secSave]} saving throw or ${effect.replace('{dur}', secondDur ?? '')}`, { recharge: '5-6' }));
  } else {
    actions.push(act(`${def.breathName} (Recharge 5-6)`, breathText, { recharge: '5-6' }));
  }
  if (age === 'ancient' && def.second) {
    actions.push(act('Change Shape', 'Magically polymorphs into a humanoid or beast with a challenge rating no higher than its own, or back into its true form. It keeps its alignment, hit points, mental scores, and the ability to speak, and its gear melds into or is worn by the new form.'));
  }

  const traits = [];
  if (def.amphibious) traits.push(T.amphibious);
  if (def.iceWalk && age !== 'wyrmling') traits.push(act('Ice Walk', 'Can move across and climb icy surfaces without needing an ability check. Difficult terrain made of ice or snow doesn\'t cost it extra movement.'));
  if (big) traits.push(T.legendaryResistance(3));

  const wingDC = 8 + pb + sm;
  return {
    name, size: SIZE[age], type: 'dragon', alignment: def.alignment, ac, armor: 'natural armor', hp, speed, ab, saves, skills,
    immune: [def.element], conditionImmune: def.element === 'poison' ? ['poisoned'] : [], senses: SENSES[age],
    languages: age === 'wyrmling' ? 'Draconic' : 'Common, Draconic', cr: String(cr), traits, actions,
    legendary: big ? {
      count: 3, actions: [
        act('Detect', 'Makes a Wisdom (Perception) check.'),
        act('Tail Attack', 'Makes a tail attack.'),
        act('Wing Attack (Costs 2 Actions)', `Beats its wings. Each creature within ${age === 'ancient' ? 15 : 10} feet must succeed on a DC ${wingDC} Dexterity saving throw or take ${avg(2, 6) + sm} (2d6 + ${sm}) bludgeoning damage and be knocked prone. The dragon can then fly up to half its flying speed.`, { cost: 2 }),
      ],
    } : null,
    habitat: def.habitat,
    appearance: `${AGE_LOOK[age]} ${LOOK[color]}.`,
    lore: lore(def.personality, `${def.origin} ${ageLore[age]}`, def.tactics),
    settings: color === 'red' || color === 'white' ? ['core', 'westlands'] : ['core'],
  };
}

const trueDragons = Object.entries(COLORS).flatMap(([color, def]) => def.rows.map((row) => makeDragon(color, def, row)));

export const dragons = [
  ...trueDragons,
  {
    name: 'Dragon Turtle', size: 'Gargantuan', type: 'dragon', alignment: 'neutral',
    ac: 20, armor: 'natural armor', hp: '22d20+110', speed: { walk: 20, swim: 40 }, ab: [25, 10, 20, 10, 12, 12],
    saves: { dex: 6, con: 11, wis: 7 }, resist: ['fire'], senses: { darkvision: 120 }, languages: 'Aquan, Draconic', cr: '17',
    traits: [T.amphibious],
    actions: [
      multi('Makes three attacks: one with its bite and two with its claws. It can make one tail attack in place of its two claw attacks.'),
      mw('Bite', 13, 15, '3d12+7 piercing'), mw('Claw', 13, 10, '2d8+7 slashing'),
      mw('Tail', 13, 15, '3d12+7 bludgeoning', 'If the target is a creature, it must succeed on a DC 20 Strength saving throw or be pushed up to 10 feet away and knocked prone.'),
      act('Steam Breath (Recharge 5-6)', 'Exhales scalding steam in a 60-foot cone. Each creature there must make a DC 18 Constitution saving throw, taking 52 (15d6) fire damage on a failed save, or half as much on a success. Being underwater doesn\'t grant resistance.', { recharge: '5-6' }),
    ],
    habitat: ['coast', 'underwater'],
    appearance: 'A colossal sea turtle with a craggy, barnacle-covered shell like a small island, a draconic head with a frilled crest and sea-green scales, and steam hissing from its nostrils, rising out of stormy waves beside a sinking ship.',
    lore: lore('Greedy, moody and old as the reefs; can be bargained with.', 'Island-sized sea dragons that demand tribute from ships crossing their waters.', 'Capsize ships, boil crews with steam, drag the treasure down.'),
  },
  {
    name: 'Pseudodragon', size: 'Tiny', type: 'dragon', alignment: 'neutral good',
    ac: 13, armor: 'natural armor', hp: '2d4+2', speed: { walk: 15, fly: 60 }, ab: [6, 15, 13, 10, 12, 10],
    skills: { perception: 3, stealth: 4 }, senses: { blindsight: 10, darkvision: 60 }, languages: 'understands Common and Draconic but can\'t speak', cr: '1/4',
    traits: [
      act('Keen Senses', 'Has advantage on Wisdom (Perception) checks that rely on sight, hearing, or smell.'),
      T.magicResistance,
      act('Limited Telepathy', 'Can magically communicate simple ideas, emotions, and images telepathically with any creature within 100 feet that can understand a language.'),
    ],
    actions: [mw('Bite', 4, 5, '1d4+2 piercing'),
      mw('Sting', 4, 5, '1d4+2 piercing', 'The target must succeed on a DC 11 Constitution saving throw or become poisoned for 1 hour. If it fails by 5 or more, it falls unconscious for the same duration, or until it takes damage or someone shakes it awake.')],
    habitat: ['forest', 'urban'],
    appearance: 'A cat-sized dragon with fine reddish-brown scales, small feathered wings, large curious golden eyes and a barbed tail, perched on a wizard\'s shoulder.',
    lore: lore('Affectionate, curious and a little smug; purrs when pleased.', 'Cat-sized dragons that bond with kind-hearted wizards as familiars.', 'Sting and flee; put a bully to sleep.'),
  },
  {
    name: 'Wyvern', size: 'Large', type: 'dragon', alignment: 'unaligned',
    ac: 13, armor: 'natural armor', hp: '13d10+39', speed: { walk: 20, fly: 80 }, ab: [19, 10, 16, 5, 12, 6],
    skills: { perception: 4 }, senses: { darkvision: 60 }, languages: '—', cr: '6',
    actions: [
      multi('Makes two attacks: one with its bite and one with its stinger. While flying, it can use its claws in place of one other attack.'),
      mw('Bite', 7, 10, '2d6+4 piercing'), mw('Claws', 7, 5, '2d8+4 slashing'),
      mw('Stinger', 7, 10, '2d6+4 piercing', 'The target must make a DC 15 Constitution saving throw, taking 24 (7d6) poison damage on a failed save, or half as much on a success.'),
    ],
    habitat: ['mountain', 'hill'],
    appearance: 'A large two-legged dragon-kin with leathery bat-like wings, dark brown-green scales, a long neck with a toothy reptilian head, and a long tail ending in a venomous scorpion-like stinger, diving from a mountain crag.',
    lore: lore('Vicious, territorial and dim; attacks anything that moves.', 'Lesser cousins of dragons, two-legged and venomous, sometimes tamed as mounts by brave or desperate riders.', 'Swoop, sting, carry off prey to the nest.'),
    settings: ['core', 'westlands'],
  },
];
