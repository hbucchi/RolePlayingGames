/**
 * Terrain for arena maps. Each square of an arena has a terrain id; walls are solid rock tiles.
 *
 * Movement cost (5e): difficult terrain (mud, shallow water, snow) costs 1 extra square for each
 * square you enter, so a step costs 2 instead of 1. Deep water cannot be walked through, but you
 * can see and shoot across it. Walls block both movement and sight.
 */
import { TILE } from './dungeon.js';

export const TERRAINS = {
  floor: { name: 'Stone floor', cost: 1, texture: 'assets/textures/floor-flagstone.jpg', color: '#8d826e' },
  castle: { name: 'Castle floor', cost: 1, texture: 'assets/terrain/castle.jpg', color: '#b9b3a5' },
  cobbles: { name: 'Cobblestones', cost: 1, texture: 'assets/terrain/cobbles.jpg', color: '#7c7b75' },
  grass: { name: 'Grass', cost: 1, texture: 'assets/terrain/grass.jpg', color: '#5f8a3a' },
  sand: { name: 'Sand', cost: 1, texture: 'assets/terrain/sand.jpg', color: '#d8bf82' },
  blood: { name: 'Bloodied stone', cost: 1, texture: 'assets/terrain/blood.jpg', color: '#7b3a30' },
  mud: { name: 'Mud', cost: 2, texture: 'assets/terrain/mud.jpg', color: '#6b4f33', note: 'difficult terrain' },
  snow: { name: 'Snow', cost: 2, texture: 'assets/terrain/snow.jpg', color: '#e6edf2', note: 'difficult terrain' },
  shallow: { name: 'Shallow water', cost: 2, texture: 'assets/terrain/shallow.jpg', color: '#6fa6b8', note: 'difficult terrain' },
  river: { name: 'Deep water', cost: Infinity, texture: 'assets/terrain/river.jpg', color: '#24507a', note: 'cannot be crossed on foot' },
  wall: { name: 'Wall', wall: true, texture: 'assets/textures/rock-bedrock.jpg', color: '#2b251f', note: 'blocks movement and sight' },
};
export const TERRAIN_IDS = Object.keys(TERRAINS);

/** Movement cost multiplier for entering a square (1 normal, 2 difficult, Infinity impassable). */
export function terrainCost(map, x, y) {
  const id = map.terrain?.[y]?.[x];
  return id ? TERRAINS[id]?.cost ?? 1 : 1;
}

/**
 * An empty arena: a w x h grid with a one-square wall all around and a stone floor inside.
 * The same shape as a generated dungeon, so the battle engine works on it unchanged.
 */
export function createArenaMap(w = 20, h = 16, fill = 'floor') {
  const tiles = []; const terrain = [];
  for (let y = 0; y < h; y++) {
    tiles.push([]); terrain.push([]);
    for (let x = 0; x < w; x++) {
      const edge = x === 0 || y === 0 || x === w - 1 || y === h - 1;
      tiles[y].push(edge ? TILE.ROCK : TILE.ROOM);
      terrain[y].push(edge ? 'wall' : fill);
    }
  }
  return {
    version: 1, arena: true, width: w, height: h, cellSize: 64, feetPerCell: 5, tiles, terrain,
    rooms: [{ id: 1, x: 1, y: 1, w: w - 2, h: h - 2, name: 'Arena', entrance: true, doors: [] }],
    doors: [], entrance: { roomId: 1, x: 1, y: h - 2 }, exit: null,
  };
}

/** Paint one square. The outer wall cannot be removed (it keeps the arena closed). */
export function paintTerrain(map, x, y, id) {
  if (!TERRAINS[id] || x <= 0 || y <= 0 || x >= map.width - 1 || y >= map.height - 1) return false;
  map.terrain[y][x] = id;
  map.tiles[y][x] = TERRAINS[id].wall ? TILE.ROCK : TILE.ROOM;
  return true;
}

/** Can a creature stand here? (Not in a wall or deep water.) */
export const standable = (map, x, y) => map.tiles[y]?.[x] !== undefined && map.tiles[y][x] !== TILE.ROCK && terrainCost(map, x, y) !== Infinity;

/** Compact form for saving: rows of single-letter codes. */
const CODE = { floor: '.', castle: 'c', cobbles: 'o', grass: 'g', sand: 's', blood: 'b', mud: 'm', snow: 'n', shallow: 'w', river: 'r', wall: '#' };
const FROM_CODE = Object.fromEntries(Object.entries(CODE).map(([k, v]) => [v, k]));
export const encodeTerrain = (map) => map.terrain.map((row) => row.map((id) => CODE[id] ?? '.').join(''));
export function decodeArena(rows) {
  const h = rows.length; const w = rows[0].length;
  const map = createArenaMap(w, h);
  rows.forEach((row, y) => [...row].forEach((ch, x) => { if (y > 0 && x > 0 && y < h - 1 && x < w - 1) paintTerrain(map, x, y, FROM_CODE[ch] ?? 'floor'); }));
  return map;
}
