/**
 * Ready-made heroes, stored exactly like player drafts (choices only), using the
 * standard array. Assignment values are indices into [15, 14, 13, 12, 10, 8].
 */
const premade = (p) => ({
  version: 1,
  settingId: 'westlands',
  level: 1,
  abilityMethod: 'standard',
  abilityRolls: Array(6).fill(null),
  baseAbilities: { str: null, dex: null, con: null, int: null, wis: null, cha: null },
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: null,
  subraceId: null,
  ...p,
});

export const premades = [
  premade({
    id: 'premade-halric',
    name: 'Halric Greyfell',
    concept: 'A silent ranger of the north who has watched the old roads for forty years.',
    raceId: 'men-west', classId: 'ranger', backgroundId: 'wanderer',
    abilityAssignment: { dex: 0, wis: 1, con: 2, str: 3, int: 4, cha: 5 },
    skillChoices: ['stealth', 'perception', 'nature'],
  }),
  premade({
    id: 'premade-brannoc',
    name: 'Brannoc Ironbrow',
    concept: 'A dwarf warrior sworn to reclaim the lost halls of his grandfathers.',
    raceId: 'dwarf', subraceId: 'longbeard', classId: 'warrior', backgroundId: 'soldier',
    abilityAssignment: { str: 0, con: 1, wis: 2, dex: 3, cha: 4, int: 5 },
    skillChoices: ['perception', 'history'],
  }),
  premade({
    id: 'premade-pippa',
    name: 'Pippa Underhedge',
    concept: 'A halfling who "borrowed" a map from the wrong person and now cannot go home.',
    raceId: 'halfling', subraceId: 'hillfolk', classId: 'burglar', backgroundId: 'hearthfolk',
    abilityAssignment: { dex: 0, cha: 1, con: 2, wis: 3, int: 4, str: 5 },
    skillChoices: ['stealth', 'sleight-of-hand', 'persuasion', 'perception'],
  }),
  premade({
    id: 'premade-lirien',
    name: 'Lírien of the Wood',
    concept: 'A wood-elf minstrel who sings to remember the friends the years have taken.',
    raceId: 'elf', subraceId: 'wood', classId: 'minstrel', backgroundId: 'trader',
    abilityAssignment: { cha: 0, dex: 1, wis: 2, con: 3, int: 4, str: 5 },
    skillChoices: ['performance', 'history', 'insight'],
  }),
];
