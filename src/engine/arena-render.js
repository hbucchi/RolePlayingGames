/**
 * Draw an arena map as SVG: every square filled with its terrain texture. Each terrain has four
 * painted variations; a square picks one from a hash of its coordinates, so large areas do not
 * show an obvious repeating tile, and the choice never flickers between redraws.
 */
import { TERRAINS } from './terrain.js';

const VARIANTS = 4;
const variantOf = (x, y) => (((x * 73856093) ^ (y * 19349663)) >>> 0) % VARIANTS + 1;
const textureFor = (id, n) => (id === 'floor' || id === 'wall' ? TERRAINS[id].texture : TERRAINS[id].texture.replace('.jpg', `-${n}.jpg`));

export function terrainPatterns(prefix = 'ar', tile = 256) {
  let defs = '';
  for (const id of Object.keys(TERRAINS)) {
    const nVar = id === 'floor' || id === 'wall' ? 1 : VARIANTS;
    for (let n = 1; n <= nVar; n++) {
      const size = id === 'wall' ? 512 : id === 'floor' ? 384 : tile;
      defs += `<pattern id="${prefix}-${id}-${n}" patternUnits="userSpaceOnUse" width="${size}" height="${size}"><image href="${textureFor(id, n)}" width="${size}" height="${size}"/></pattern>`;
    }
  }
  return defs;
}

export const fillFor = (map, x, y, prefix = 'ar') => {
  const id = map.terrain[y][x];
  const n = id === 'floor' || id === 'wall' ? 1 : variantOf(x, y);
  return `url(#${prefix}-${id}-${n})`;
};

export function renderArenaSVG(map, { grid = true, prefix = 'ar' } = {}) {
  const S = map.cellSize; const W = map.width * S; const H = map.height * S;
  let cells = ''; let walls = '';
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      const id = map.terrain[y][x];
      cells += `<rect x="${x * S}" y="${y * S}" width="${S + 0.5}" height="${S + 0.5}" fill="${fillFor(map, x, y, prefix)}"/>`;
      if (id === 'wall') walls += `M${x * S} ${y * S}h${S}v${S}h${-S}z`;
    }
  }
  let lines = '';
  if (grid) {
    for (let x = 1; x < map.width; x++) lines += `M${x * S} ${S}V${H - S}`;
    for (let y = 1; y < map.height; y++) lines += `M${S} ${y * S}H${W - S}`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Arena map">
  <defs>${terrainPatterns(prefix)}<pattern id="dg-rock" patternUnits="userSpaceOnUse" width="512" height="512"><image href="${TERRAINS.wall.texture}" width="512" height="512"/></pattern></defs>
  ${cells}
  <path d="${walls}" fill="#000" opacity=".35"/>
  <path d="${walls}" fill="none" stroke="#0d0a07" stroke-width="3"/>
  ${grid ? `<path d="${lines}" stroke="#120c06" stroke-opacity=".45" stroke-width="2"/>` : ''}
</svg>`;
}
