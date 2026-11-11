/**
 * Versioned saves. Everything the game keeps in the browser is written as an envelope
 *   { format: 'rpg-roster', version: 2, data: ... }
 * and read back through the format's migrations: small functions that each upgrade data by one
 * version (1 -> 2, 2 -> 3, ...). Chaining them means a save from any older version of the game
 * still loads, however many updates ago it was made, and each upgrade is written once.
 *
 * To change what is saved: bump the format's `version` and add a migration from the old version
 * that turns old data into the new shape (and a test with a sample of old data).
 *
 * Saves from before envelopes existed (bare data) count as version 1. A save from a newer game
 * than this one is returned untouched (`newer: true`) and never overwritten by older code.
 */
import { DRAFT_VERSION } from './character.js';

/** Character drafts carry their own version: upgrades for one character, by version. */
export const CHARACTER_MIGRATIONS = {
  // 1: (d) => ({ ...d, newField: default }),   // the first change to characters goes here
};

export function migrateCharacter(d) {
  let c = { ...d, version: d.version ?? 1 };
  while (c.version < DRAFT_VERSION) {
    const step = CHARACTER_MIGRATIONS[c.version];
    if (!step) throw new Error(`No upgrade for characters from version ${c.version}`);
    c = { ...step(c), version: c.version + 1 };
  }
  return c;
}

export const FORMATS = {
  // version 1: a bare array of drafts; version 2: in an envelope, every draft upgraded.
  roster: { id: 'rpg-roster', version: 2, empty: () => [], migrations: { 1: (list) => list.map(migrateCharacter) } },
  // version 1: a bare array of arenas; version 2: in an envelope.
  arenas: { id: 'rpg-arenas', version: 2, empty: () => [], migrations: { 1: (list) => list } },
  // Story progress by story id.
  stories: { id: 'rpg-stories', version: 1, empty: () => ({}), migrations: {} },
  // Campaign progress (where the party is, what it knows, quest flags, wounds) by campaign id.
  campaigns: { id: 'rpg-campaigns', version: 1, empty: () => ({}), migrations: {} },
};

/** Upgrade raw stored text to the current version. Returns { data, version, newer, upgraded }. */
export function upgrade(format, raw) {
  if (raw == null || raw === '') return { data: format.empty(), version: format.version, newer: false, upgraded: false };
  const parsed = JSON.parse(raw);
  const enveloped = parsed && typeof parsed === 'object' && !Array.isArray(parsed) && parsed.format === format.id;
  let version = enveloped ? parsed.version : 1;
  let data = enveloped ? parsed.data : parsed;
  if (version > format.version) return { data, version, newer: true, upgraded: false };
  const from = version;
  while (version < format.version) {
    const step = format.migrations[version];
    if (!step) throw new Error(`No upgrade for ${format.id} from version ${version}`);
    data = step(data); version += 1;
  }
  return { data, version, newer: false, upgraded: version !== from || !enveloped };
}

export const envelope = (format, data) => JSON.stringify({ format: format.id, version: format.version, data });

/**
 * A store for one format under one key. Reading upgrades (and writes the upgrade back, once);
 * unreadable data is kept aside under KEY.broken instead of being lost.
 */
export function createStore(backend, key, format) {
  let newer = false;
  return {
    read() {
      let raw = null;
      try { raw = backend.getItem(key); } catch { return format.empty(); }
      try {
        const r = upgrade(format, raw);
        newer = r.newer;
        if (r.upgraded) backend.setItem(key, envelope(format, r.data));
        return r.data;
      } catch {
        try { backend.setItem(`${key}.broken`, raw); } catch { /* ignore */ }
        return format.empty();
      }
    },
    write(data) {
      if (newer) return false; // a newer game owns this save: don't clobber it
      backend.setItem(key, envelope(format, data));
      return true;
    },
  };
}
