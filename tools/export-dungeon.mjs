#!/usr/bin/env node
/**
 * Export a dungeon as data + images.
 *
 *   node tools/export-dungeon.mjs [seed] [name]
 *
 * Writes to assets/dungeons/:
 *   <name>.json        the grid data (source of truth for movement)
 *   <name>-board.jpg   2048x2048 painted board, no grid
 *   <name>-grid.jpg    2048x2048 board with the movement grid, room numbers and coordinates
 *
 * Images are rasterised with the pre-installed Playwright Chromium.
 */
import { createRequire } from 'node:module';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { generateDungeon } from '../src/engine/dungeon.js';
import { renderDungeonSVG, DEFAULT_TEXTURES } from '../src/engine/dungeon-render.js';

const seed = Number(process.argv[2] ?? 1);
const name = process.argv[3] ?? `dungeon-${seed}`;
const OUT = new URL('../assets/dungeons/', import.meta.url);
const ROOT = new URL('../', import.meta.url);

const map = generateDungeon(seed);
await mkdir(OUT, { recursive: true });
await writeFile(new URL(`${name}.json`, OUT), JSON.stringify({ ...map, tiles: map.tiles.map((r) => r.join('')) }, null, 1));

// Inline the textures as data: URIs so the SVG is self-contained.
const mime = (p) => (p.endsWith('.png') ? 'image/png' : 'image/jpeg');
const textures = {};
for (const [k, p] of Object.entries(DEFAULT_TEXTURES)) {
  textures[k] = `data:${mime(p)};base64,${(await readFile(new URL(p, ROOT))).toString('base64')}`;
}

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 2048, height: 2048 }, deviceScaleFactor: 1 });
for (const [suffix, opts] of [['board', { grid: false, labels: false, coords: false }], ['grid', {}]]) {
  const svg = renderDungeonSVG(map, { textures, ...opts });
  await page.setContent(`<!doctype html><html><body style="margin:0;background:#000">${svg}</body></html>`);
  await page.waitForFunction(() => [...document.images].every((i) => i.complete));
  await page.waitForTimeout(150);
  await page.screenshot({ path: new URL(`${name}-${suffix}.jpg`, OUT).pathname, type: 'jpeg', quality: 88, clip: { x: 0, y: 0, width: 2048, height: 2048 } });
}
await browser.close();
console.log(`${name}: ${map.rooms.length} rooms, ${map.doors.length} doors, ${map.width}x${map.height} squares -> assets/dungeons/`);
