/**
 * Asset packs, for the hosted build (see tools/build.mjs). The hosted page may hold only a few
 * hundred files, so pictures and sounds travel in a few pack files: JSON objects mapping an asset
 * path ("assets/bodies/body-fam-owlbear.png") to a base64 data URI. assets/packs/index.json says
 * which pack holds which path, which packs to load before the game starts (`startup`), which to
 * fetch right after (`background`); every other pack loads the first time one of its assets is
 * asked for (lazy loading), so the start-up wait stays the same however many creatures exist.
 *
 * `packed(path)` returns, in order:
 *   - a blob: URL if the pack holding the path has arrived (a short in-memory address, so the long
 *     base64 text is not copied into every <img>);
 *   - a transparent placeholder if the path is in a pack still on its way. The pack is requested,
 *     and when it lands every placeholder on the page is swapped for the real picture;
 *   - the path itself when no pack has it: running from the repository uses the plain files.
 */
const BLOBS = new Map();
const LOADING = new Map();
let INDEX = { files: {}, startup: [], background: [] };
const BLANK = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';

function toBlobUrl(uri) {
  const [head, b64] = uri.split(',');
  const bin = atob(b64); const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return URL.createObjectURL(new Blob([bytes], { type: head.slice(5, head.indexOf(';')) }));
}

/** Swap placeholders (marked with their asset path after #) for the real pictures. */
function swapPlaceholders() {
  if (typeof document === 'undefined') return;
  for (const el of document.querySelectorAll(`img[src^="${BLANK}#"], image[href^="${BLANK}#"]`)) {
    const attr = el.tagName.toLowerCase() === 'img' ? 'src' : 'href';
    const url = BLOBS.get(el.getAttribute(attr).slice(BLANK.length + 1));
    if (url) el.setAttribute(attr, url);
  }
}

/** Load one pack (once); resolves when its assets are ready. */
export function loadPack(name) {
  if (!LOADING.has(name)) {
    LOADING.set(name, fetch(`assets/packs/${name}.json`).then((r) => (r.ok ? r.json() : {})).then((entries) => {
      for (const [path, uri] of Object.entries(entries)) BLOBS.set(path, toBlobUrl(uri));
      swapPlaceholders();
    }).catch(() => { /* a missing pack leaves its pictures blank, nothing worse */ }));
  }
  return LOADING.get(name);
}

/** Wait until the given asset paths are ready (to start a fight without blank figures). */
export function need(paths) {
  return Promise.all([...new Set(paths.map((p) => INDEX.files[p]).filter(Boolean))].map(loadPack));
}

export function packed(path) {
  if (BLOBS.has(path)) return BLOBS.get(path);
  const pack = INDEX.files[path];
  if (!pack) return path;
  loadPack(pack);
  return `${BLANK}#${path}`;
}

async function start() {
  if (typeof location === 'undefined') return; // tests in Node: plain files only
  try {
    const r = await fetch('assets/packs/index.json');
    if (!r.ok) return;
    INDEX = { files: {}, startup: [], background: [], ...(await r.json()) };
    await Promise.all(INDEX.startup.map(loadPack));
    INDEX.background.forEach(loadPack);
  } catch { /* no packs: use the plain files */ }
}
await start();
