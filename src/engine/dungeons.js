/**
 * The dungeons of the Westlands: a ladder of ten, each a fixed delve (its own seed, so the same
 * halls every time) of a set number of floors with a boss in the great hall at the bottom.
 *
 *   level    the level its foes are matched to on the first floor (depths.js adds a little per
 *            floor below), and so the level each hero should have: the suggested level. The
 *            encounter budget already scales with the party's size (progression.js) and a lone
 *            hero meets fewer occupied rooms (depths.js PARTY_FILL), so the suggestion holds for
 *            one hero or four.
 *   floors   how deep it goes; the last floor is the boss's hall.
 *
 * Progress: slaying a dungeon's boss completes it. The first dungeon is always open; each of the
 * others opens once the one before it is completed. A completed dungeon can be run again, for
 * half the experience and half the loot (REPLAY): the ladder is for climbing, not for farming.
 */
export const DUNGEONS = [
  { id: 'old-cellars', name: 'The Old Cellars', seed: 7, level: 1, floors: 3, blurb: 'Damp vaults under a burned-out inn, where rats grow bold and something has moved into the wine store.' },
  { id: 'goblin-warrens', name: 'The Goblin Warrens', seed: 31, level: 2, floors: 4, blurb: 'Low tunnels gnawed into the hillside. The goblins have traps, dogs, and a chief who wants your boots.' },
  { id: 'sunken-crypt', name: 'The Sunken Crypt', seed: 58, level: 3, floors: 5, blurb: 'A chapel crypt half drowned by the marsh. The dead were never buried quietly here.' },
  { id: 'spider-caves', name: 'The Weaver Caves', seed: 112, level: 4, floors: 5, blurb: 'Silk curtains every passage. Whatever spins them is patient, and very large.' },
  { id: 'orc-hold', name: 'Gorgoth\'s Hold', seed: 203, level: 5, floors: 6, blurb: 'An old dwarf fort taken by an orc warband. Their war-drums never stop.' },
  { id: 'drowned-mines', name: 'The Drowned Mines', seed: 377, level: 7, floors: 7, blurb: 'Silver once came out of these shafts. Now only cold water and worse things do.' },
  { id: 'bone-halls', name: 'The Bone Halls', seed: 441, level: 9, floors: 8, blurb: 'A necromancer\'s ossuary, its walls built of the dead. Some of the walls still move.' },
  { id: 'wyrms-roost', name: 'The Wyrm\'s Roost', seed: 589, level: 11, floors: 9, blurb: 'Scorched galleries climbing to a dragon\'s lair. The gold is real; so is the fire.' },
  { id: 'fallen-star', name: 'Halls of the Fallen Star', seed: 733, level: 14, floors: 10, blurb: 'Where a star fell, a temple rose, and what it worships came down with the star.' },
  { id: 'abyssal-throne', name: 'The Abyssal Throne', seed: 907, level: 17, floors: 10, blurb: 'The deepest place in the Westlands. Few who go down come back to tell of the throne.' },
];
export const DUNGEON_BY_ID = Object.fromEntries(DUNGEONS.map((d) => [d.id, d]));

/** A completed dungeon run again pays this share of its experience and loot. */
export const REPLAY = 0.5;

const KEY = 'rpg.dungeons.v1';
/** Progress: { completed: { [id]: times } }, from storage (any { getItem, setItem }). */
export function loadProgress(store = globalThis.localStorage) {
  try { const p = JSON.parse(store?.getItem(KEY) ?? 'null'); return p && typeof p === 'object' ? { completed: p.completed ?? {} } : { completed: {} }; } catch { return { completed: {} }; }
}
export function markCompleted(id, store = globalThis.localStorage) {
  const p = loadProgress(store); p.completed[id] = (p.completed[id] ?? 0) + 1;
  try { store?.setItem(KEY, JSON.stringify(p)); } catch { /* storage blocked */ }
  return p;
}
export const isCompleted = (id, progress) => (progress.completed[id] ?? 0) > 0;
/** Open if it is the first, or the one before it has been completed. */
export function isUnlocked(id, progress) {
  const i = DUNGEONS.findIndex((d) => d.id === id);
  return i === 0 || (i > 0 && isCompleted(DUNGEONS[i - 1].id, progress));
}
/** What a run pays: 1, or REPLAY for a dungeon already completed. */
export const rewardShare = (id, progress) => (isCompleted(id, progress) ? REPLAY : 1);
