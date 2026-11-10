import { races } from './races.js';
import { classes } from './classes.js';
import { backgrounds } from './backgrounds.js';
import { premades } from './premades.js';

export const westlands = {
  id: 'westlands',
  name: 'Tales of the Westlands',
  subtitle: 'A world of fading Elves, stubborn Dwarves and brave small folk, inspired by Tolkien\'s Middle-earth.',
  races,
  classes,
  backgrounds,
  premades,
  adventures: [
    {
      id: 'dungeon-sandbox',
      title: 'Dungeon Sandbox',
      blurb: 'Empty halls beneath the hills, freshly delved. Walk them square by square to learn how movement works before the monsters move in.',
      levels: 'Any', length: 'Free exploration', status: 'playable',
    },
    {
      id: 'barrow-of-the-lost-king',
      title: 'The Barrow of the Lost King',
      blurb: 'Mists gather on the downs, and something old has woken beneath the standing stones.',
      levels: '1-2', length: 'One evening', status: 'coming-soon',
    },
    {
      id: 'the-burning-ford',
      title: 'The Burning Ford',
      blurb: 'Raiders hold the only crossing of the river. A village on the far bank waits for help that may not come.',
      levels: '1-3', length: 'Two or three sessions', status: 'coming-soon',
    },
    {
      id: 'halls-beneath-the-mountain',
      title: 'Halls Beneath the Mountain',
      blurb: 'A dwarf-lord\'s map leads to a sealed door, a forgotten password and the dark beyond.',
      levels: '2-4', length: 'Campaign arc', status: 'coming-soon',
    },
  ],
};
