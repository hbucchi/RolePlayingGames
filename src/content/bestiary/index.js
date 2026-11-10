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

const RAW = [
  ...humanoids,
  ...undead,
  ...dragons,
];

export const BESTIARY = RAW.map(buildMonster).sort((a, b) => a.name.localeCompare(b.name));
export const BESTIARY_BY_ID = Object.fromEntries(BESTIARY.map((m) => [m.id, m]));
