/**
 * Progress is kept only at the way out. When a party goes down into a dungeon (or into a
 * campaign place), a checkpoint remembers each hero exactly as they were. Everything gained
 * inside (experience, loot, coins, levels) is real while you play, but it is only made safe
 * at an exit:
 *
 *   the stairs down   the checkpoint moves forward: what you carry now is yours
 *   leaving           the checkpoint is closed: what you carry is yours
 *   defeat            every hero goes back to the checkpoint: the floor's gains are lost
 *   walking away      (back to the menu, a new dungeon, closing the game) the same as defeat
 *
 * The checkpoint is stored, so closing the page in the middle of a floor cannot be used to
 * keep the loot: the next time the game starts it puts the heroes back.
 */
const KEY = 'rpg.delve.v1';

export function createDelveStore(backend) {
  const read = () => { try { const v = JSON.parse(backend.getItem(KEY) ?? 'null'); return v && Array.isArray(v.drafts) ? v : null; } catch { return null; } };
  const write = (v) => { try { if (v) backend.setItem(KEY, JSON.stringify(v)); else backend.removeItem?.(KEY) ?? backend.setItem(KEY, 'null'); } catch { /* storage blocked */ } };
  return {
    /** Is a delve under way (gains not yet safe)? */
    active: () => !!read(),
    get: read,
    /** A party goes in: remember every hero as they are. `kind`: 'dungeon' | 'place'. */
    begin(kind, drafts, where = '') { write({ kind, where, at: new Date().toISOString(), drafts: structuredClone(drafts.filter(Boolean)) }); },
    /** An exit reached: the heroes as they are now are the new checkpoint. */
    commit(drafts) { const cur = read(); if (cur) write({ ...cur, at: new Date().toISOString(), drafts: structuredClone(drafts.filter(Boolean)) }); },
    /** The party is out: nothing more to undo. */
    end() { write(null); },
    /** A ready-made hero adopted on the way gets a new id: follow it. */
    rename(oldId, newId) {
      const cur = read(); if (!cur) return;
      for (const d of cur.drafts) if (d.id === oldId) { d.premadeOf ??= oldId; d.id = newId; }
      write(cur);
    },
    /**
     * Put every hero back as the checkpoint has them, with `save(draft)`, and close it.
     * Ready-made heroes never adopted had nothing saved, so there is nothing to put back.
     * @returns {string[]} the names of the heroes put back
     */
    restore(save) {
      const cur = read(); if (!cur) return [];
      const names = [];
      for (const d of cur.drafts) { if (String(d.id).startsWith('premade-')) continue; save(d); names.push(d.name); }
      write(null);
      return names;
    },
  };
}
