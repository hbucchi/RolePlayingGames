/**
 * Character roster persistence. The backend is injectable (anything with
 * getItem/setItem) so it can be tested in Node and swapped for a server later.
 */
import { ABILITY_IDS } from './abilities.js';
import { DRAFT_VERSION, makeId } from './character.js';
import { createStore, FORMATS, migrateCharacter } from './saves.js';

const KEY = 'rpg.roster.v1'; // the key keeps its old name; the data inside is versioned (saves.js)

function memoryBackend() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) };
}

export function defaultBackend() {
  try {
    const ls = globalThis.localStorage;
    const probe = '__rpg_probe__';
    ls.setItem(probe, '1');
    ls.removeItem(probe);
    return ls;
  } catch {
    return memoryBackend(); // private mode / blocked storage: work for this session only
  }
}

export function createRoster(backend = defaultBackend()) {
  const store = createStore(backend, KEY, FORMATS.roster);
  const read = () => { const list = store.read(); return Array.isArray(list) ? list.filter(isCharacterShape) : []; };
  const write = (list) => store.write(list);

  return {
    list: read,
    get: (id) => read().find((c) => c.id === id) ?? null,
    save(draft) {
      const list = read();
      const record = { ...structuredClone(draft), updatedAt: new Date().toISOString() };
      const i = list.findIndex((c) => c.id === record.id);
      if (i >= 0) list[i] = record; else list.push(record);
      write(list);
      return record;
    },
    remove(id) {
      write(read().filter((c) => c.id !== id));
    },
  };
}

/** Minimal structural check so corrupted or foreign JSON can't break the app. */
export function isCharacterShape(c) {
  return !!c && typeof c === 'object'
    && typeof c.id === 'string'
    && typeof c.name === 'string'
    && typeof c.settingId === 'string'
    && c.baseAbilities && ABILITY_IDS.every((id) => c.baseAbilities[id] === null || Number.isInteger(c.baseAbilities[id]))
    && Array.isArray(c.skillChoices);
}

export function exportCharacter(draft) {
  return JSON.stringify({ format: 'rpg-character', version: DRAFT_VERSION, character: draft }, null, 2);
}

/** Parse an exported file. Imports get a fresh id so they never overwrite an existing hero. */
export function importCharacter(text) {
  let data;
  try { data = JSON.parse(text); } catch { throw new Error('That file is not valid JSON.'); }
  const raw = data?.format === 'rpg-character' ? data.character : data;
  if (!isCharacterShape(raw)) throw new Error('That file does not contain a character.');
  if ((raw.version ?? 1) > DRAFT_VERSION) throw new Error('That character comes from a newer version of the game. Update the game to import it.');
  const c = migrateCharacter(raw);
  return { ...c, id: makeId(), name: String(c.name).slice(0, 40) };
}
