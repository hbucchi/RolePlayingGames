/**
 * Draw an arena map as SVG: every square filled with its terrain texture. Each terrain has four
 * painted variations; a square picks one from a hash of its coordinates, so large areas do not
 * show an obvious repeating tile, and the choice never flickers between redraws.
 */
import { TERRAINS } from './terrain.js';

const VARIANTS = 4;
const variantOf = (x, y) => (((x * 73856093) ^ (y * 19349663)) >>> 0) % VARIANTS + 1;
const single = (id) => id === 'floor' || id === 'wall' || TERRAINS[id].single;
const textureFor = (id, n) => (single(id) ? TERRAINS[id].texture : TERRAINS[id].texture.replace('.jpg', `-${n}.jpg`));

export function terrainPatterns(prefix = 'ar', tile = 256) {
  let defs = '';
  for (const id of Object.keys(TERRAINS)) {
    const nVar = single(id) ? 1 : VARIANTS;
    for (let n = 1; n <= nVar; n++) {
      const size = id === 'wall' ? 512 : id === 'floor' ? 384 : tile;
      defs += `<pattern id="${prefix}-${id}-${n}" patternUnits="userSpaceOnUse" width="${size}" height="${size}"><image href="${textureFor(id, n)}" width="${size}" height="${size}"/></pattern>`;
    }
  }
  return defs;
}

export const fillFor = (map, x, y, prefix = 'ar') => {
  const id = map.terrain[y][x];
  const n = single(id) ? 1 : variantOf(x, y);
  return `url(#${prefix}-${id}-${n})`;
};

export function renderArenaSVG(map, { grid = true, prefix = 'ar' } = {}) {
  const S = map.cellSize; const W = map.width * S; const H = map.height * S;
  let cells = ''; let walls = ''; let props = '';
  const at = (x, y) => map.terrain[y]?.[x];
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      const id = map.terrain[y][x];
      const fill = id === 'planks' || id === 'table' ? `url(#ar-planks${y % 2 ? '-b' : ''})` : fillFor(map, x, y, prefix);
      cells += `<rect x="${x * S}" y="${y * S}" width="${S + 0.5}" height="${S + 0.5}" fill="${fill}"/>`;
      if (id === 'wall') walls += `M${x * S} ${y * S}h${S}v${S}h${-S}z`;
      // Furniture: a darker plank top with a rim, so tables and counters read as solid.
      if (id === 'table') props += `<rect x="${x * S + 4}" y="${y * S + 4}" width="${S - 8}" height="${S - 8}" rx="6" class="ar-table"/>`;
      // A house: a pitched roof of tiles; neighbouring roof squares join into one building.
      if (id === 'roof') {
        const e = at(x + 1, y) === 'roof'; const w = at(x - 1, y) === 'roof'; const n = at(x, y - 1) === 'roof'; const sth = at(x, y + 1) === 'roof';
        props += `<rect x="${x * S - (w ? 1 : -2)}" y="${y * S - (n ? 1 : -2)}" width="${S + (w ? 1 : -2) + (e ? 1 : -2)}" height="${S + (n ? 1 : -2) + (sth ? 1 : -2)}" fill="url(#ar-rooftiles)"/>`;
        if (!n) props += `<line x1="${x * S}" y1="${y * S + 3}" x2="${(x + 1) * S}" y2="${y * S + 3}" class="ar-eave"/>`;
        if (!sth) props += `<line x1="${x * S}" y1="${(y + 1) * S - 3}" x2="${(x + 1) * S}" y2="${(y + 1) * S - 3}" class="ar-eave"/>`;
      }
      // Trees: a few overlapping canopies with a shadow, different on every square.
      if (id === 'tree') {
        const h = ((x * 73856093) ^ (y * 19349663)) >>> 0;
        props += `<ellipse cx="${x * S + S * 0.55}" cy="${y * S + S * 0.6}" rx="${S * 0.5}" ry="${S * 0.42}" fill="#000" opacity=".3"/>`;
        for (let k = 0; k < 3; k++) {
          const cx = x * S + S * (0.3 + ((h >> (k * 4)) % 5) * 0.1); const cy = y * S + S * (0.3 + ((h >> (k * 4 + 2)) % 5) * 0.1); const r = S * (0.3 + ((h >> (k * 3)) % 3) * 0.06);
          props += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="url(#ar-canopy)"/>`;
        }
      }
    }
  }
  let lines = '';
  if (grid) {
    for (let x = 1; x < map.width; x++) lines += `M${x * S} ${S}V${H - S}`;
    for (let y = 1; y < map.height; y++) lines += `M${S} ${y * S}H${W - S}`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Arena map">
  <defs>${terrainPatterns(prefix)}<pattern id="dg-rock" patternUnits="userSpaceOnUse" width="512" height="512"><image href="${TERRAINS.wall.texture}" width="512" height="512"/></pattern>
  <radialGradient id="ar-canopy" cx=".4" cy=".35"><stop offset="0" stop-color="#6f9a3e"/><stop offset=".6" stop-color="#3f6826"/><stop offset="1" stop-color="#22391a"/></radialGradient>
  <pattern id="ar-planks" patternUnits="userSpaceOnUse" width="${S * 2}" height="${S / 4}"><rect width="${S * 2}" height="${S / 4}" fill="#8a5d32"/><rect y="1" width="${S * 2}" height="${S / 4 - 2}" fill="url(#ar-wood)"/><path d="M0 .5H${S * 2}M${S * 0.7} 0V${S / 4}" stroke="#3f2810" stroke-width="2"/></pattern>
  <pattern id="ar-planks-b" patternUnits="userSpaceOnUse" width="${S * 2}" height="${S / 4}" patternTransform="translate(${S * 0.9} 0)"><rect width="${S * 2}" height="${S / 4}" fill="#835830"/><rect y="1" width="${S * 2}" height="${S / 4 - 2}" fill="url(#ar-wood)"/><path d="M0 .5H${S * 2}M${S * 1.3} 0V${S / 4}" stroke="#3f2810" stroke-width="2"/></pattern>
  <linearGradient id="ar-wood" x1="0" x2="1"><stop offset="0" stop-color="#9a6a3a"/><stop offset=".3" stop-color="#8a5b30"/><stop offset=".55" stop-color="#a0703f"/><stop offset=".8" stop-color="#875a31"/><stop offset="1" stop-color="#94653a"/></linearGradient>
  <pattern id="ar-rooftiles" patternUnits="userSpaceOnUse" width="16" height="12"><rect width="16" height="12" fill="#8a4630"/><path d="M0 11.5H16M8 0V6M0 6H16M4 6V12M12 6V12" stroke="#5e2c1d" stroke-width="1.4"/></pattern></defs>
  ${cells}
  ${props}
  ${(map.exits ?? (map.exit ? [map.exit] : [])).map((e) => `<g transform="translate(${(e.x + 0.5) * S} ${(e.y + 0.5) * S})" class="ar-exit"><circle r="${S * 0.42}"/><text y="${S * 0.12}" style="font-size:${S * 0.42}px">⇦</text><text y="${S * 0.72}" class="ar-exit-label" style="font-size:${S * 0.22}px">Exit</text></g>`).join('')}
  <path d="${walls}" fill="#000" opacity=".35"/>
  <path d="${walls}" fill="none" stroke="#0d0a07" stroke-width="3"/>
  ${grid ? `<path d="${lines}" stroke="#120c06" stroke-opacity=".45" stroke-width="2"/>` : ''}
</svg>`;
}
