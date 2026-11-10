/**
 * Draw a dungeon map as an SVG string (works in the browser and in Node).
 *
 * Layers, bottom to top:
 *   1. bedrock texture over the whole board
 *   2. floor texture, clipped to walkable squares
 *   3. soft inner shadow along the walls
 *   4. the movement grid (only on walkable squares, like a printed battle map)
 *   5. crisp wall outlines
 *   6. doors, entrance stairs, room numbers, edge coordinates
 *
 * Every shape comes from the grid data, so art and grid can never disagree.
 */
import { TILE } from './dungeon.js';

export const DEFAULT_TEXTURES = {
  floor: 'assets/textures/floor-flagstone.jpg',
  rock: 'assets/textures/rock-bedrock.jpg',
  door: 'assets/textures/door-oak.png',
};

const walk = (map, x, y) => x >= 0 && y >= 0 && x < map.width && y < map.height && map.tiles[y][x] !== TILE.ROCK;

/** Walkable area as one path of horizontal runs (far fewer shapes than one per square). */
export function floorPath(map, S) {
  let d = '';
  for (let y = 0; y < map.height; y++) {
    let x = 0;
    while (x < map.width) {
      if (!walk(map, x, y)) { x++; continue; }
      const x0 = x;
      while (x < map.width && walk(map, x, y)) x++;
      d += `M${x0 * S} ${y * S}h${(x - x0) * S}v${S}h${-(x - x0) * S}z`;
    }
  }
  return d;
}

/** Every boundary between a walkable square and rock, merged into straight runs. */
export function wallPath(map, S) {
  let d = '';
  // Horizontal edges: between row y-1 and row y.
  for (let y = 0; y <= map.height; y++) {
    let x = 0;
    while (x < map.width) {
      const edge = walk(map, x, y) !== walk(map, x, y - 1);
      if (!edge) { x++; continue; }
      const x0 = x;
      while (x < map.width && walk(map, x, y) !== walk(map, x, y - 1)) x++;
      d += `M${x0 * S} ${y * S}H${x * S}`;
    }
  }
  // Vertical edges: between column x-1 and column x.
  for (let x = 0; x <= map.width; x++) {
    let y = 0;
    while (y < map.height) {
      const edge = walk(map, x, y) !== walk(map, x - 1, y);
      if (!edge) { y++; continue; }
      const y0 = y;
      while (y < map.height && walk(map, x, y) !== walk(map, x - 1, y)) y++;
      d += `M${x * S} ${y0 * S}V${y * S}`;
    }
  }
  return d;
}

function gridLines(map, S) {
  let d = '';
  for (let i = 1; i < map.width; i++) d += `M${i * S} 0V${map.height * S}`;
  for (let j = 1; j < map.height; j++) d += `M0 ${j * S}H${map.width * S}`;
  return d;
}

function doorSvg(door, S, tex) {
  const cx = (door.x + 0.5) * S; const cy = (door.y + 0.5) * S;
  // 'h' doors are walked through east-west, so the slab stands north-south (rotated 90 deg).
  const rot = door.orientation === 'h' ? 90 : 0;
  const w = S * 0.98; const h = S * 0.44;
  const slab = tex
    ? `<image href="${tex}" x="${-w / 2}" y="${-h / 2}" width="${w}" height="${h}" preserveAspectRatio="none"/>`
    : `<rect x="${-w / 2}" y="${-h / 2}" width="${w}" height="${h}" rx="3" fill="#6b4a2b" stroke="#2a1a0c" stroke-width="3"/>`;
  return `<g transform="translate(${cx} ${cy}) rotate(${rot})">
    <rect x="${-w / 2 - 4}" y="${-h / 2 - 3}" width="${w + 8}" height="${h + 6}" rx="4" fill="#000" opacity=".45"/>
    ${slab}
    <rect x="${-w / 2}" y="${-h / 2}" width="${w}" height="${h}" rx="2" fill="none" stroke="#120a04" stroke-width="2.5"/></g>`;
}

function stairsSvg(entrance, S) {
  const x = entrance.x * S; const y = entrance.y * S;
  let steps = '';
  for (let i = 0; i < 5; i++) {
    const inset = i * 4;
    steps += `<rect x="${x + 6 + inset}" y="${y + 6 + i * 11}" width="${S - 12 - inset * 2}" height="9" fill="#d9ceb4" stroke="#3a2e22" stroke-width="2" opacity="${1 - i * 0.12}"/>`;
  }
  return `<g class="stairs">${steps}</g>`;
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/**
 * @param {object} map  from generateDungeon()
 * @param {object} [o]
 * @param {object|null} [o.textures]  {floor, rock, door} image URLs (or data: URIs); null = flat colours
 * @param {boolean} [o.grid=true]      draw the movement grid
 * @param {boolean} [o.labels=true]    room numbers and entrance
 * @param {boolean} [o.coords=true]    column/row numbers in the rock border
 */
export function renderDungeonSVG(map, o = {}) {
  const { textures = DEFAULT_TEXTURES, grid = true, labels = true, coords = true, idPrefix = 'dg' } = o;
  const S = map.cellSize;
  const W = map.width * S; const H = map.height * S;
  const id = (n) => `${idPrefix}-${n}`;
  const floorD = floorPath(map, S);
  const wallD = wallPath(map, S);

  const defs = `
    <defs>
      ${textures ? `
      <pattern id="${id('rock')}" patternUnits="userSpaceOnUse" width="512" height="512">
        <image href="${textures.rock}" width="512" height="512"/>
      </pattern>
      <pattern id="${id('floor')}" patternUnits="userSpaceOnUse" width="384" height="384">
        <image href="${textures.floor}" width="384" height="384"/>
      </pattern>` : ''}
      <clipPath id="${id('clip')}"><path d="${floorD}"/></clipPath>
      <filter id="${id('blur')}" x="-5%" y="-5%" width="110%" height="110%"><feGaussianBlur stdDeviation="9"/></filter>
      <radialGradient id="${id('vignette')}" cx="50%" cy="50%" r="72%">
        <stop offset="60%" stop-color="#000" stop-opacity="0"/><stop offset="100%" stop-color="#000" stop-opacity=".55"/>
      </radialGradient>
    </defs>`;

  const rockFill = textures ? `url(#${id('rock')})` : '#2b251f';
  const floorFill = textures ? `url(#${id('floor')})` : '#cdbf9f';

  const coordText = !coords ? '' : `<g font-family="Georgia, 'Times New Roman', serif" font-size="${S * 0.3}" fill="#d8c9a6" fill-opacity=".75" text-anchor="middle">
    ${Array.from({ length: map.width - 2 }, (_, i) => i + 1).map((x) => `<text x="${(x + 0.5) * S}" y="${S * 0.62}">${x}</text>`).join('')}
    ${Array.from({ length: map.height - 2 }, (_, i) => i + 1).map((y) => `<text x="${S * 0.5}" y="${(y + 0.5) * S + S * 0.11}">${y}</text>`).join('')}
  </g>`;

  const roomLabels = !labels ? '' : map.rooms.map((r) => {
    const cx = (r.x + r.w / 2) * S; const cy = (r.y + r.h / 2) * S;
    return `<g class="room-label"><circle cx="${cx}" cy="${cy}" r="${S * 0.34}" fill="#f1e6cc" fill-opacity=".9" stroke="#3a2a18" stroke-width="3"/>
      <text x="${cx}" y="${cy + S * 0.13}" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif" font-weight="700" font-size="${S * 0.38}" fill="#3a2a18">${r.id}</text></g>`;
  }).join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(`Dungeon map, ${map.rooms.length} rooms`)}">
  ${defs}
  <rect width="${W}" height="${H}" fill="${rockFill}"/>
  <rect width="${W}" height="${H}" fill="#000" opacity=".25"/>
  <path d="${floorD}" fill="${floorFill}"/>
  <g clip-path="url(#${id('clip')})">
    <path d="${wallD}" stroke="#000" stroke-opacity=".7" stroke-width="30" fill="none" filter="url(#${id('blur')})"/>
    ${grid ? `<path d="${gridLines(map, S)}" stroke="#120c06" stroke-opacity=".5" stroke-width="2.5" fill="none"/>
    <path d="${gridLines(map, S)}" stroke="#fff" stroke-opacity=".07" stroke-width="1.5" fill="none" transform="translate(1.5 1.5)"/>` : ''}
  </g>
  <path d="${wallD}" stroke="#0d0a07" stroke-width="8" stroke-linecap="square" fill="none"/>
  ${map.doors.map((d) => doorSvg(d, S, textures?.door)).join('')}
  ${labels && map.entrance ? stairsSvg(map.entrance, S) : ''}
  ${roomLabels}
  ${coordText}
  <rect width="${W}" height="${H}" fill="url(#${id('vignette')})" pointer-events="none"/>
  <rect x="3" y="3" width="${W - 6}" height="${H - 6}" fill="none" stroke="#0d0a07" stroke-width="6"/>
</svg>`;
}
