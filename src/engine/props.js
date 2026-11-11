/**
 * Props: furniture and objects standing on a map's terrain (bookshelves, tables, forges, statues...).
 *
 * A map may carry `map.props = [{ kind, x, y, rot }]`. A prop fills a w x h block of squares from its
 * top-left square (x, y); rot 90 turns it a quarter (a 2 x 1 bookshelf becomes 1 x 2). Each kind says
 * what it does to movement:
 *   block  'move'   nobody walks through it (tables, statues, a forge)
 *          'slow'   difficult terrain, costs double (chairs, rubble)
 *          false    walk over it (a rug)
 * Wall props (torches, chains) hang on a wall square next to the floor and never get in the way.
 * `station` marks crafting stations for the crafting system to come (forge, anvil, workbench...).
 * Pictures: assets/props/<kind>.png, top-down, made with tools/art (sheets f1 and f2), drawn to fit
 * the block without stretching. A prop's size here follows its picture's shape.
 */
import { TILE } from './dungeon.js';
import { seededRng } from './dice.js';

export const PROPS = {
  bookshelf: { name: 'Bookshelf', w: 1, h: 2, block: 'move' },
  'round-table': { name: 'Round table', w: 1, h: 1, block: 'move' },
  'long-table': { name: 'Long table', w: 2, h: 1, block: 'move' },
  chair: { name: 'Chair', w: 1, h: 1, block: 'slow', scale: 0.7 },
  bed: { name: 'Bed', w: 1, h: 1, block: 'move' },
  barrel: { name: 'Barrel', w: 1, h: 1, block: 'move', scale: 0.8 },
  crates: { name: 'Crates', w: 1, h: 1, block: 'move' },
  'wall-torch': { name: 'Wall torch', w: 1, h: 1, block: false, wall: true, light: true, scale: 0.75 },
  chains: { name: 'Chains', w: 1, h: 1, block: false, scale: 0.8 },
  candelabra: { name: 'Candelabra', w: 1, h: 1, block: 'move', light: true, scale: 0.8 },
  rug: { name: 'Rug', w: 3, h: 2, block: false, under: true },
  statue: { name: 'Statue', w: 1, h: 1, block: 'move' },
  forge: { name: 'Forge', w: 2, h: 2, block: 'move', light: true, station: 'forge' },
  anvil: { name: 'Anvil', w: 1, h: 1, block: 'move', station: 'anvil', scale: 0.85 },
  grindstone: { name: 'Grindstone', w: 2, h: 1, block: 'move', station: 'grindstone' },
  'weapon-rack': { name: 'Weapon rack', w: 2, h: 1, block: 'move' },
  'armour-stand': { name: 'Armour stand', w: 1, h: 1, block: 'move', scale: 0.85 },
  workbench: { name: 'Workbench', w: 2, h: 1, block: 'move', station: 'workbench' },
  'water-trough': { name: 'Quenching trough', w: 2, h: 1, block: 'move', station: 'quench' },
  brazier: { name: 'Brazier', w: 1, h: 1, block: 'move', light: true, scale: 0.85 },
  altar: { name: 'Altar', w: 1, h: 1, block: 'move', station: 'altar' },
  sarcophagus: { name: 'Sarcophagus', w: 2, h: 1, block: 'move' },
  rubble: { name: 'Rubble', w: 2, h: 2, block: 'slow' },
  fountain: { name: 'Fountain', w: 2, h: 2, block: 'move' },
};
export const PROP_IDS = Object.keys(PROPS);
export const propImage = (kind) => `assets/props/${kind}.png`;

/** Width and height of a placed prop (turned a quarter when rot is 90 or 270). */
export function propDims(p) {
  const d = PROPS[p.kind] ?? { w: 1, h: 1 };
  return (p.rot ?? 0) % 180 ? { w: d.h, h: d.w } : { w: d.w, h: d.h };
}
export function propCells(p) {
  const { w, h } = propDims(p); const out = [];
  for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) out.push({ x: p.x + dx, y: p.y + dy });
  return out;
}

/**
 * Movement cost a prop adds to a square: Infinity (blocked), 2 (difficult) or 1. Indexed once per
 * map and cached on it (non-enumerable, so saves stay small); call clearPropIndex after changes.
 */
export function propCost(map, x, y) {
  if (!map.props?.length) return 1;
  let idx = map.__propIdx;
  if (!idx) {
    idx = new Map();
    for (const p of map.props) {
      const def = PROPS[p.kind]; if (!def || def.wall || !def.block) continue;
      const c = def.block === 'move' ? Infinity : 2;
      for (const q of propCells(p)) idx.set(`${q.x},${q.y}`, Math.max(c, idx.get(`${q.x},${q.y}`) ?? 1));
    }
    Object.defineProperty(map, '__propIdx', { value: idx, configurable: true, enumerable: false });
  }
  return idx.get(`${x},${y}`) ?? 1;
}
export const clearPropIndex = (map) => { if (map) delete map.__propIdx; };

/** The prop standing on a square, if any. */
export const propAt = (map, x, y) => (map.props ?? []).find((p) => propCells(p).some((q) => q.x === x && q.y === y)) ?? null;

/** SVG for a map's props (rugs first, so furniture stands on them). */
export function propsSvg(map, S) {
  const list = [...(map.props ?? [])].filter((p) => PROPS[p.kind]).sort((a, b) => !!PROPS[b.kind].under - !!PROPS[a.kind].under);
  return list.map((p) => {
    const def = PROPS[p.kind]; const { w, h } = propDims(p);
    const cx = (p.x + w / 2) * S; const cy = (p.y + h / 2) * S;
    // The picture is drawn unturned (def.w x def.h) and rotated about the block's centre.
    const k = def.scale ?? 0.96; const pw = def.w * S * k; const ph = def.h * S * k;
    const glow = def.light ? `<circle r="${S * Math.max(def.w, def.h) * 0.9}" fill="url(#prop-glow)" class="prop-glow"/>` : '';
    return `<g class="prop prop-${p.kind}" transform="translate(${cx} ${cy}) rotate(${p.rot ?? 0})">${glow}<image href="${propImage(p.kind)}" x="${-pw / 2}" y="${-ph / 2}" width="${pw}" height="${ph}" preserveAspectRatio="xMidYMid meet"/></g>`;
  }).join('');
}
export const PROP_DEFS = '<radialGradient id="prop-glow"><stop offset="0" stop-color="#ffb347" stop-opacity=".38"/><stop offset=".55" stop-color="#ff8a1e" stop-opacity=".12"/><stop offset="1" stop-color="#ff8a1e" stop-opacity="0"/></radialGradient>';

// ---------------------------------------------------------------------------
// Furnishing generated dungeons: each kind of room gets the things it would hold
// ---------------------------------------------------------------------------

/** What a room holds, by its name (see ROOM_NAMES in dungeon.js). Wall props go along the walls. */
const FURNISH = [
  [/Library|Study/, ['bookshelf', 'bookshelf', 'bookshelf', 'round-table', 'chair', 'candelabra']],
  [/Forge/, ['forge', 'anvil', 'water-trough', 'workbench', 'grindstone', 'barrel']],
  [/Armoury/, ['weapon-rack', 'weapon-rack', 'armour-stand', 'armour-stand', 'grindstone', 'crates']],
  [/Chapel|Shrine/, ['altar', 'candelabra', 'candelabra', 'statue', 'rug']],
  [/Crypt|Ossuary/, ['sarcophagus', 'sarcophagus', 'sarcophagus', 'candelabra', 'rubble']],
  [/Barracks/, ['bed', 'bed', 'bed', 'barrel', 'weapon-rack', 'chair']],
  [/Feast Hall|Great Hall|Hall of Kings/, ['long-table', 'chair', 'chair', 'chair', 'brazier', 'statue', 'statue', 'barrel']],
  [/Throne Hall/, ['rug', 'statue', 'statue', 'brazier', 'brazier']],
  [/Pillared Hall/, ['rubble', 'statue', 'brazier']],
  [/Storeroom|Pantry|Larder|Vault|Closet/, ['barrel', 'crates', 'crates', 'barrel']],
  [/Cell/, ['chains', 'chains']],
  [/Cistern|Well Room/, ['fountain', 'barrel']],
  [/Guardroom|Watch Post/, ['round-table', 'chair', 'chair', 'barrel', 'weapon-rack']],
  [/Gallery/, ['statue', 'statue', 'statue', 'rug']],
  [/Alcove|Niche/, ['candelabra']],
];

/**
 * Put furniture in a generated dungeon's rooms. Blocking things go against the walls, away from
 * doors, and a prop is kept only if every walkable square can still reach every other (a flood fill
 * from the entrance), so nothing is ever walled off. `avoid` holds "x,y" squares to keep clear
 * (chests, stairs, traps, creatures). Seeded: the same dungeon is always furnished the same way.
 */
export function furnishDungeon(map, seed, avoid = new Set()) {
  const rng = seededRng((seed * 40503 + 7) >>> 0);
  const props = [];
  map.props = props;
  const floor = (x, y) => map.tiles[y]?.[x] !== undefined && map.tiles[y][x] !== TILE.ROCK;
  const isDoor = (x, y) => map.tiles[y]?.[x] === TILE.DOOR;
  const keys = new Set(avoid);
  for (const s of [map.entrance, map.exit]) if (s) keys.add(`${s.x},${s.y}`);
  const taken = new Set();

  const connected = () => {
    clearPropIndex(map);
    const start = map.entrance; if (!start) return true;
    const ok = (x, y) => floor(x, y) && propCost(map, x, y) !== Infinity;
    let total = 0;
    for (let y = 0; y < map.height; y++) for (let x = 0; x < map.width; x++) if (ok(x, y)) total++;
    const seen = new Set([`${start.x},${start.y}`]); const q = [start];
    while (q.length) {
      const c = q.pop();
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = c.x + dx; const ny = c.y + dy; const k = `${nx},${ny}`;
        if (!seen.has(k) && ok(nx, ny)) { seen.add(k); q.push({ x: nx, y: ny }); }
      }
    }
    return seen.size === total;
  };
  const nearDoor = (x, y) => [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]].some(([dx, dy]) => isDoor(x + dx, y + dy));

  for (const r of map.rooms) {
    if (r.entrance) continue;
    const plan = [...(FURNISH.find(([re]) => re.test(r.name ?? ''))?.[1] ?? [])];
    // Odds and ends that turn up anywhere: a barrel, crates, a fallen stone, a candle, old chains.
    const ODDS = ['barrel', 'crates', 'rubble', 'candelabra', 'chains', 'barrel'];
    for (let k = rng(3); k > 0; k--) plan.push(ODDS[rng(ODDS.length)]);
    // A torch on the wall of most rooms: on the rock just above the room's top edge.
    if (rng(100) < 85) {
      const tx = r.x + 1 + rng(Math.max(1, r.w - 2));
      if (!floor(tx, r.y - 1) && !isDoor(tx, r.y - 1)) props.push({ kind: 'wall-torch', x: tx, y: r.y - 1, rot: 180 }); // flame toward the room
    }
    for (const kind of plan) {
      const def = PROPS[kind];
      for (let t = 0; t < 30; t++) {
        const rot = def.w !== def.h && rng(2) ? 90 : 0;
        const p = { kind, x: 0, y: 0, rot };
        const { w, h } = propDims(p);
        if (w > r.w || h > r.h) continue;
        p.x = r.x + rng(r.w - w + 1); p.y = r.y + rng(r.h - h + 1);
        const cells = propCells(p);
        // Big blocking furniture stands against a wall; rugs and small things may sit anywhere.
        const againstWall = cells.some((c) => c.x === r.x || c.y === r.y || c.x === r.x + r.w - 1 || c.y === r.y + r.h - 1);
        if (def.block === 'move' && !def.under && !againstWall && w * h > 1) continue;
        if (cells.some((c) => !floor(c.x, c.y) || keys.has(`${c.x},${c.y}`) || nearDoor(c.x, c.y) || (taken.has(`${c.x},${c.y}`) && !def.under))) continue;
        props.push(p);
        if (def.block && !connected()) { props.pop(); clearPropIndex(map); continue; }
        if (!def.under) for (const c of cells) taken.add(`${c.x},${c.y}`);
        break;
      }
    }
  }
  clearPropIndex(map);
  return props;
}
