/**
 * Optional asset packs. The hosted build can hold only a limited number of files, so it bundles
 * the many small family portraits, bodies and voices into a few pack files instead:
 * assets/packs/index.json names the packs, and each pack maps an asset path
 * (e.g. "assets/bodies/body-fam-owlbear.png") to a base64 data URI.
 *
 * Each entry becomes a blob: URL (a short in-memory address, so the long base64 text isn't copied
 * into every <img> tag). `packed(path)` gives that URL, or the path itself when no pack has it,
 * which is the case when you run the game from the repository.
 */
const PACK = new Map();

async function load() {
  if (typeof location === 'undefined') return; // tests in Node: plain files only
  try {
    const r = await fetch('assets/packs/index.json');
    if (!r.ok) return;
    const names = await r.json();
    await Promise.all(names.map(async (name) => {
      const entries = await (await fetch(`assets/packs/${name}`)).json();
      for (const [path, uri] of Object.entries(entries)) {
        const [head, b64] = uri.split(',');
        const bin = atob(b64); const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        PACK.set(path, URL.createObjectURL(new Blob([bytes], { type: head.slice(5, head.indexOf(';')) })));
      }
    }));
  } catch { /* no packs: use the plain files */ }
}
await load();

export const packed = (path) => PACK.get(path) ?? path;
