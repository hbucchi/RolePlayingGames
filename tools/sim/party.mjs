// Parties by level and monster groups for the balance runs.
import { hero, monster } from './battle-sim.mjs';

/** Gear for each premade by level: what a party plausibly has found by then. */
export function gearFor(i, level) {
  if (level < 5) return null; // their starting kit
  const b = level >= 17 ? 3 : level >= 11 ? 2 : 1;
  const tiers = {
    0: level >= 11 ? [['half-plate', { bonus: b - 1 }], 'iron-helm', 'steel-vambraces'] : ['chain-shirt', 'leather-cap'],
    1: level >= 17 ? [['plate', { bonus: 3, material: 'dwarf-steel' }], 'great-helm', 'gauntlets', 'steel-greaves', 'steel-gorget', ['shield', { bonus: 2 }]]
      : level >= 11 ? [['plate', { bonus: 1 }], 'great-helm', 'gauntlets', ['shield', { bonus: 1 }]] : ['splint', 'iron-helm', 'shield'],
    2: [['studded-leather', { bonus: b - 1 }], 'leather-cap', 'leather-gloves'],
    3: [['chain-shirt', { bonus: b - 1 }]],
  };
  const weapon = { 0: 'longsword', 1: 'longsword', 2: 'rapier', 3: 'rapier' }[i];
  return [...tiers[i].map((g) => (Array.isArray(g) && !g[1].bonus && !g[1].material ? g[0] : g)), [weapon, { bonus: b }]];
}
export const partyAt = (level) => () => [0, 1, 2, 3].map((i) => hero(i, level, gearFor(i, level)));
export const many = (id, n) => () => Array.from({ length: n }, () => monster(id, true));
export const mix = (list) => () => list.flatMap(([id, n]) => Array.from({ length: n }, () => monster(id, true)));
