/**
 * The bestiary: every creature, normalised into full stat blocks.
 *
 * Creatures marked source "SRD 5.1" use game mechanics from the System Reference Document 5.1
 * (Wizards of the Coast LLC, https://dnd.wizards.com/resources/systems-reference-document),
 * licensed under CC-BY-4.0. Descriptions, personalities, origins and tactics are original
 * to this project. Westlands creatures are original creations inspired by Tolkien's world.
 */
import { buildMonster } from '../../engine/monsters.js';
import { humanoids } from './humanoids.js';
import { undead } from './undead.js';
import { dragons } from './dragons.js';
import { beasts } from './beasts.js';
import { monstrosities } from './monstrosities.js';
import { fiends } from './fiends.js';
import { giants } from './giants.js';
import { elementals, celestials, constructs, fey, oozes, plants, aberrations } from './others.js';
import { westlandsFoes } from './westlands.js';
import { tune } from './tuning.js';

const RAW = [
  ...humanoids,
  ...undead,
  ...dragons,
  ...beasts,
  ...monstrosities,
  ...fiends,
  ...giants,
  ...elementals,
  ...celestials,
  ...constructs,
  ...fey,
  ...oozes,
  ...plants,
  ...aberrations,
  ...westlandsFoes,
];

const BUILT = RAW.map(tune).map(buildMonster); // tuning.js: stat blocks rebalanced for these rules

/**
 * Test Dragon: an ancient red dragon under another name, used to try out top-down bodies
 * (wings spread, so it is wider than it is long: 5 x 4 squares, the long side across its facing).
 */
const ancientRed = BUILT.find((m) => m.id === 'ancient-red-dragon');
if (ancientRed) {
  BUILT.push({
    ...ancientRed, id: 'test-dragon', name: 'Test Dragon', art: { portrait: 'red-dragon', body: 'body-test-dragon' }, source: 'Westlands', settings: ['westlands'],
    appearance: 'A colossal crimson dragon seen from above: great wings spread wide to either side, a long horned neck, four clawed legs and a trailing tail.',
  });
}

export const BESTIARY = BUILT.sort((a, b) => a.name.localeCompare(b.name));
export const BESTIARY_BY_ID = Object.fromEntries(BESTIARY.map((m) => [m.id, m]));
