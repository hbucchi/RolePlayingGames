/**
 * The safe: a strongbox in town where the company keeps loot carried out of the dungeons.
 * 120 slots; a stack of the same thing (arrows, ore, gems) takes one slot, as in a hero's bag.
 * Shared by every hero; coins stay in each hero's purse.
 */
import { addItem, removeItem, itemDef, isEquipped, whyNoRoom } from './items.js';

export const SAFE_SLOTS = 120;
const KEY = 'rpg.safe.v1';

export function createSafe(backend) {
  const read = () => { try { const v = JSON.parse(backend.getItem(KEY) ?? 'null'); return Array.isArray(v?.items) ? v : { items: [] }; } catch { return { items: [] }; } };
  const write = (v) => { try { backend.setItem(KEY, JSON.stringify(v)); } catch { /* storage blocked */ } };
  const joins = (items, inst) => !!itemDef(inst)?.stack && !inst.bonus && items.some((x) => x.id === inst.id && !x.bonus);
  return {
    items: () => read().items,
    used: () => read().items.length,
    /** Why this cannot go in (or null): the safe is full. */
    whyNot(inst) { const s = read(); return !joins(s.items, inst) && s.items.length >= SAFE_SLOTS ? `The safe is full (${SAFE_SLOTS} of ${SAFE_SLOTS} slots).` : null; },
    /** Move an item (or `qty` of a stack) from a hero's bag into the safe. Worn and wielded things stay on the hero. */
    store(draft, uid, qty = Infinity) {
      const inst = (draft.inventory ?? []).find((x) => x.uid === uid);
      if (!inst) return { ok: false, message: 'Nothing to store.' };
      if (isEquipped(draft, uid)) return { ok: false, message: 'Take it off first: worn and wielded things stay with the hero.' };
      const why = this.whyNot(inst); if (why) return { ok: false, message: why };
      const s = read();
      const n = removeItem(draft.inventory, uid, qty);
      addItem(s.items, { ...structuredClone(inst), qty: n, uid: undefined });
      write(s);
      return { ok: true, n };
    },
    /** Use up `n` of a plain resource kept in the safe (crafting). Returns how many were taken. */
    remove(id, n) {
      const s = read(); let left = n;
      for (const x of [...s.items]) { if (left <= 0) break; if (x.id === id && !x.bonus) left -= removeItem(s.items, x.uid, left); }
      write(s);
      return n - left;
    },
    /** Put something straight into the safe (a crafted piece when the bag is full). */
    add(inst) { const why = this.whyNot(inst); if (why) return { ok: false, message: why }; const s = read(); addItem(s.items, { ...structuredClone(inst), uid: undefined }); write(s); return { ok: true }; },
    /** Take an item out of the safe into a hero's bag, if the bag has room and the hero can carry it. */
    take(draft, uid, qty = Infinity, str = null) {
      const s = read(); const inst = s.items.find((x) => x.uid === uid);
      if (!inst) return { ok: false, message: 'It is not in the safe.' };
      const n = Math.min(qty, inst.qty ?? 1);
      const moving = { ...structuredClone(inst), qty: n };
      const why = whyNoRoom(draft, moving, str); if (why) return { ok: false, message: why };
      removeItem(s.items, uid, n);
      addItem(draft.inventory ??= [], { ...moving, uid: undefined });
      write(s);
      return { ok: true, n };
    },
  };
}
