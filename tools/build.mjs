// Build the hosted version of the game into dist/.     npm run build
//
// The hosted page (a claude.ai artifact) can hold at most 511 files of up to 16 MB each, and may
// not load pictures from other websites. So portraits, bodies and sounds are bundled into packs
// (see src/content/asset-pack.js), grouped so a player downloads only what they meet:
//   core              hero portraits and bodies           loaded before the game starts
//   sounds            every sound effect                  fetched right after start-up
//   portraits-<type>  creature paintings by creature type loaded when first shown
//   bodies-<type>     creature bodies by creature type    loaded when first shown
// Everything else (code, music, terrain, items, spell effects) is copied as plain files.
// Afterwards the script prints the file count and writes dist/publish-files.json, the file map
// for publishing.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { BESTIARY } from '../src/content/bestiary/index.js';
import { PORTRAITS, PORTRAIT_VARIANTS, HERO_BODIES } from '../src/content/media.js';
import { SOUND_KEYS, variantsOf } from '../src/ui/audio.js';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const DIST = path.join(ROOT, 'dist');
const LIMIT_FILES = 511; const LIMIT_BYTES = 16e6;
const rel = (p) => path.relative(ROOT, p);

fs.rmSync(DIST, { recursive: true, force: true });
const written = [];
const write = (to, data) => { const f = path.join(DIST, to); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, data); written.push(to); };
const copyTree = (dir) => {
  for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const p = `${dir}/${e.name}`;
    if (e.isDirectory()) copyTree(p); else write(p, fs.readFileSync(path.join(ROOT, p)));
  }
};

// ---- Plain files ----------------------------------------------------------------------------
write('hero-forge.html', fs.readFileSync(path.join(ROOT, 'publish/hero-forge.html')));
write('index.html', fs.readFileSync(path.join(ROOT, 'index.html'))); // for `ROOT=dist npm start`
copyTree('src');
for (const dir of ['music', 'terrain', 'textures', 'items', 'vfx', 'campaign', 'props']) copyTree(`assets/${dir}`);

// ---- Packs ------------------------------------------------------------------------------------
const packs = {}; // name -> [[asset path, kind]]
const placed = new Set();
const add = (pack, asset, kind) => {
  if (placed.has(asset)) return; // shared pictures go in the first pack that needs them
  if (!fs.existsSync(path.join(ROOT, asset))) { console.warn('missing', asset); return; }
  placed.add(asset); (packs[pack] ??= []).push([asset, kind]);
};
for (const key of Object.keys(PORTRAITS)) for (let n = 1; n <= PORTRAIT_VARIANTS; n++) add('core', `assets/portraits/${key}-${n}.jpg`, 'portrait');
for (const key of new Set(Object.values(HERO_BODIES))) add('core', `assets/bodies/${key}.png`, 'body');
for (const key of SOUND_KEYS) for (let n = 1; n <= variantsOf(key); n++) add('sounds', `assets/sounds/${key}-${n}.mp3`, 'sound');
for (const m of [...BESTIARY].sort((a, b) => a.type.localeCompare(b.type))) {
  if (m.art.portrait) add(`portraits-${m.type}`, `assets/portraits/${m.art.portrait}-1.jpg`, 'portrait');
  if (m.art.body) add(`bodies-${m.type}`, `assets/bodies/${m.art.body}.png`, 'body');
}

const images = Object.values(packs).flat().filter(([, kind]) => kind !== 'sound').map(([asset, kind]) => [path.join(ROOT, asset), kind === 'body' ? 82 : 80]);
const encoded = JSON.parse(execFileSync('python3', [path.join(ROOT, 'tools/encode.py')], { input: JSON.stringify(images), maxBuffer: 1 << 30 }).toString());
const index = { startup: ['core'], background: ['sounds'], files: {} };
const report = [];
for (const [name, list] of Object.entries(packs)) {
  const entries = {};
  for (const [asset, kind] of list) {
    entries[asset] = kind === 'sound'
      ? `data:audio/mpeg;base64,${fs.readFileSync(path.join(ROOT, asset)).toString('base64')}`
      : encoded[path.join(ROOT, asset)];
    index.files[asset] = name;
  }
  const json = JSON.stringify(entries);
  if (json.length > LIMIT_BYTES) throw new Error(`pack ${name} is ${(json.length / 1e6).toFixed(1)} MB, over the 16 MB limit: split it`);
  write(`assets/packs/${name}.json`, json);
  report.push(`  ${name.padEnd(24)} ${String(list.length).padStart(4)} assets  ${(json.length / 1e6).toFixed(2)} MB`);
}
write('assets/packs/index.json', JSON.stringify(index));

// ---- Report -------------------------------------------------------------------------------
const publish = Object.fromEntries(written.filter((f) => f !== 'hero-forge.html' && f !== 'index.html').map((f) => [f, rel(path.join(DIST, f))]));
fs.writeFileSync(path.join(DIST, 'publish-files.json'), JSON.stringify(publish, null, 1));
const big = written.filter((f) => fs.statSync(path.join(DIST, f)).size > LIMIT_BYTES);
console.log(`Packs:\n${report.join('\n')}`);
console.log(`\ndist/: ${written.length} files (limit ${LIMIT_FILES})${big.length ? `, OVER 16 MB: ${big.join(', ')}` : ''}`);
if (written.length > LIMIT_FILES) process.exitCode = 1;
