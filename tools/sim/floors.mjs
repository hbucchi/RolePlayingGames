/**
 * Whole floors: the party fights the rooms on its way to the stairs (about 60% of the occupied
 * ones), wounds carried from fight to fight, bandages between fights, no rest. How often does a
 * fresh party reach the stairs, by level, floor and party size? (engine/depths.js is tuned on it.)
 *
 *   node tools/sim/floors.mjs
 */
import { fight, hero, monster } from './battle-sim.mjs';
import { gearFor } from './party.mjs';
import { populateDungeon } from '../../src/engine/features.js';
import { generateDungeon } from '../../src/engine/dungeon.js';
import { depthLevel, depthMix } from '../../src/engine/depths.js';
import { DUNGEON_FOES } from '../../src/content/westlands/dungeon-foes.js';
import { BESTIARY_BY_ID } from '../../src/content/bestiary/index.js';
const full = DUNGEON_FOES.map((i) => BESTIARY_BY_ID[i]);
const steel = full.filter((s) => !/nonmagical/.test([...s.resist, ...s.immune].join(' ')));
export function floor(lv, size, depth, seed, opts = {}) {
  const map = generateDungeon(seed);
  const mix = depthMix(depth, size);
  const mons = populateDungeon(map, seed, depthLevel(lv, depth), lv < 5 ? steel : full, { partySize: size, mix, chance: mix.chance, ...opts });
  // group monsters by room
  const by = {}; for (const m of mons) { const r = map.rooms.find((q) => m.pos.x >= q.x && m.pos.x < q.x + q.w && m.pos.y >= q.y && m.pos.y < q.y + q.h); (by[r?.id ?? 0] ??= []).push(m.statId); }
  const party = [1, 0, 2, 3].slice(0, size).map((i) => hero(i, lv, gearFor(i, lv)));
  party.forEach((h, i) => { h.bandages = [5, 8, 5, 3][[1, 0, 2, 3][i]] ?? 4; });
  let fights = 0;
  const groups = Object.values(by);
  // The way to the stairs passes about 60% of the occupied rooms.
  const path = groups.filter((_, i) => ((seed * 7 + i * 13) % 10) < 6);
  for (const ids of path) {
    fights++;
    const r = fight(() => party.filter((h) => h.hp > 0), () => ids.map((id) => monster(id, true)));
    if (!r.won) return { cleared: false, fights, foes: mons.length, hpLeft: 0 };
    // Between fights: bandages (DC 10 Medicine, 1d6: about 2.5 HP each on average).
    for (const h of party) while (h.hp > 0 && h.bandages > 0 && h.maxHp - h.hp >= 3) { h.bandages--; h.hp = Math.min(h.maxHp, h.hp + 2.5); }
  }
  return { cleared: true, fights, foes: mons.length, hpLeft: party.reduce((s, h) => s + Math.max(0, h.hp), 0) / party.reduce((s, h) => s + h.maxHp, 0) };
}
if (process.argv[1].endsWith('floors.mjs')) {
  for (const lv of [1, 3, 5, 8]) for (const depth of [1, 5, 9]) {
    const row = [];
    for (const size of [1, 2, 3, 4]) {
      const N = 60; let c = 0, f = 0, foes = 0, hp = 0;
      for (let s = 1; s <= N; s++) { const r = floor(lv, size, depth, s * 31 + depth); c += r.cleared; f += r.fights; foes += r.foes; hp += r.hpLeft; }
      row.push(`${size}: ${Math.round(100 * c / N)}% clear, ${(foes / N).toFixed(0)} foes, ${Math.round(100 * hp / Math.max(1, c))}% HP left`);
    }
    console.log(`L${lv} floor ${depth} | ${row.join(' | ')}`);
  }
}
