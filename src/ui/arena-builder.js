/**
 * Arena builder: paint terrain square by square, place heroes and foes, save the layout and
 * start a bout. The battle itself runs in the same engine as the dungeon (dungeon-view.js).
 */
import { createStore, FORMATS } from '../engine/saves.js';
import { TERRAINS, createArenaMap, paintTerrain, encodeTerrain, decodeArena, standable } from '../engine/terrain.js';
import { renderArenaSVG } from '../engine/arena-render.js';
import { BESTIARY, BESTIARY_BY_ID } from '../content/bestiary/index.js';
import { DUNGEON_FOES } from '../content/westlands/dungeon-foes.js';
import { monsterPortrait, portraitTint } from '../content/media.js';
import { footprintOf, cellsOf, dims, orientFor, isSquare, sizeLabel } from '../engine/size.js';

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const KEY = 'rpg.arenas.v1';
const SIZES = [[12, 10], [16, 12], [20, 16], [24, 18], [32, 24]];
const FIGHTERS = BESTIARY.filter((m) => m.actions.some((a) => a.attack)).sort((a, b) => a.crValue - b.crValue || a.name.localeCompare(b.name));

const store = () => createStore(localStorage, KEY, FORMATS.arenas); // versioned, see engine/saves.js
export function loadArenas() {
  try { const v = store().read(); return Array.isArray(v) ? v : []; } catch { return []; }
}
function storeArenas(list) { try { return store().write(list); } catch { return false; } }

/** A fresh layout with a ring of grass and a pool, so a new arena is not a blank grey box. */
/** Which side a placed creature fights on; bound creatures start chained where they stand. */
const SIDES = { enemy: 'Enemy', ally: 'Ally (fights for you)', 'bound-captive': 'Captive, chained (free them!)', 'bound-enemy': 'Enemy, chained in place' };
/** A placed creature's block, turned the way it was placed (long bodies face east or west when lying east-west). */
const foeSize = (f) => orientFor(footprintOf(BESTIARY_BY_ID[f.statId]), f.facing ?? 4);
const SIDE_RING = { enemy: '#c94a3a', ally: '#5fbf6a', 'bound-captive': '#d4b35a', 'bound-enemy': '#c94a3a' };

export function defaultArena(w = 20, h = 16) {
  const map = createArenaMap(w, h, 'cobbles');
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) if (x === 1 || y === 1 || x === w - 2 || y === h - 2) paintTerrain(map, x, y, 'grass');
  const cx = Math.floor(w / 2); const cy = Math.floor(h / 2);
  for (const [dx, dy] of [[0, 0], [-1, 0], [0, -1], [-1, -1]]) paintTerrain(map, cx + dx, cy + dy, 'shallow');
  return { name: 'New arena', map, heroes: [], foes: [] };
}

/**
 * @param host     element to draw into
 * @param ctx      { heroes: [{id, label, look}], setup, onChange(setup), onFight(setup), notify(text, kind) }
 */
export function mountArenaBuilder(host, ctx) {
  const st = {
    setup: ctx.setup ?? defaultArena(), tool: 'paint', terrain: 'grass', heroPick: ctx.heroes[0]?.id ?? null,
    foePick: 'goblin', foeFilter: '', side: 'enemy', lie: 'ew', painting: false, facing: 4,
  };
  const S = () => st.setup.map.cellSize;
  const save = () => ctx.onChange?.(st.setup);

  function occupiedBy(x, y) {
    for (const h of st.setup.heroes) if (h.pos.x === x && h.pos.y === y) return { kind: 'hero', ref: h };
    for (const f of st.setup.foes) if (cellsOf(f.pos, foeSize(f)).some((c) => c.x === x && c.y === y)) return { kind: 'foe', ref: f };
    return null;
  }

  function tokensSvg() {
    const sz = S(); let out = '';
    for (const f of st.setup.foes) {
      const stat = BESTIARY_BY_ID[f.statId]; const d = dims(foeSize(f)); const img = monsterPortrait(f.statId);
      const cx = (f.pos.x + d.w / 2) * sz; const cy = (f.pos.y + d.h / 2) * sz;
      // Round tokens for square blocks, rounded rectangles for long bodies (never squashed).
      const hw = d.w === d.h ? sz * 0.42 * d.w : d.w * sz / 2 - 6; const hh = d.w === d.h ? hw : d.h * sz / 2 - 6;
      const rx = d.w === d.h ? hw : Math.min(hw, hh) * 0.4;
      const ring = `fill="none" stroke="${SIDE_RING[f.side ?? 'enemy']}" stroke-width="5" ${f.side?.startsWith('bound') ? 'stroke-dasharray="8 5"' : ''}`;
      out += `<g class="ab-token foe"><rect x="${f.pos.x * sz + 3}" y="${f.pos.y * sz + 3}" width="${d.w * sz - 6}" height="${d.h * sz - 6}" rx="10" class="ab-foot"/>
        <clipPath id="abc-${f.uid}"><rect x="${cx - hw}" y="${cy - hh}" width="${2 * hw}" height="${2 * hh}" rx="${rx}"/></clipPath>
        ${img ? `<image href="${esc(img)}" x="${cx - hw}" y="${cy - hh}" width="${2 * hw}" height="${2 * hh}" clip-path="url(#abc-${f.uid})" preserveAspectRatio="xMidYMid slice" style="filter:${portraitTint(f.statId)}"/>` : `<rect x="${cx - hw}" y="${cy - hh}" width="${2 * hw}" height="${2 * hh}" rx="${rx}" fill="#5b2a22"/><text x="${cx}" y="${cy + 10}" class="ab-letter">${esc(stat.name[0])}</text>`}
        <rect x="${cx - hw}" y="${cy - hh}" width="${2 * hw}" height="${2 * hh}" rx="${rx}" ${ring}/></g>`;
    }
    for (const h of st.setup.heroes) {
      const info = ctx.heroes.find((x) => x.id === h.id); if (!info) continue;
      const cx = (h.pos.x + 0.5) * sz; const cy = (h.pos.y + 0.5) * sz; const r = sz * 0.4;
      out += `<g class="ab-token hero"><clipPath id="abh-${esc(h.id)}"><circle cx="${cx}" cy="${cy}" r="${r}"/></clipPath>
        <image href="${esc(info.look?.url ?? '')}" x="${cx - r}" y="${cy - r}" width="${2 * r}" height="${2 * r}" clip-path="url(#abh-${esc(h.id)})" preserveAspectRatio="xMidYMid slice" style="filter:${info.look?.filter ?? 'none'}"/>
        <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${info.look?.frameColor ?? '#c9a227'}" stroke-width="5"/></g>`;
    }
    return out;
  }

  function drawMap() {
    const box = host.querySelector('.ab-map');
    const svg = renderArenaSVG(st.setup.map, { grid: true, prefix: 'ab' });
    box.innerHTML = svg.replace('</svg>', `<g class="ab-tokens">${tokensSvg()}</g></svg>`);
  }

  function palette() {
    return Object.entries(TERRAINS).map(([id, t]) => `
      <button class="ab-swatch ${st.tool === 'paint' && st.terrain === id ? 'sel' : ''}" data-ab="terrain" data-id="${id}" title="${esc(t.name)}${t.note ? `: ${esc(t.note)}` : ''}">
        <span class="sw" style="background-image:url('${esc(id === 'floor' || id === 'wall' ? t.texture : t.texture.replace('.jpg', '-1.jpg'))}')"></span>
        <span>${esc(t.name)}${t.cost === 2 ? ' <small>×2 move</small>' : t.cost === Infinity ? ' <small>no walking</small>' : t.wall ? ' <small>blocks</small>' : ''}</span>
      </button>`).join('');
  }

  function foeOptions() {
    const q = st.foeFilter.trim().toLowerCase();
    const list = q ? FIGHTERS.filter((m) => m.name.toLowerCase().includes(q)) : FIGHTERS.filter((m) => DUNGEON_FOES.includes(m.id));
    return list.slice(0, 120).map((m) => `<option value="${m.id}" ${m.id === st.foePick ? 'selected' : ''}>CR ${m.cr} · ${esc(m.name)} (${m.size}${footprintOf(m) !== 1 ? `, ${sizeLabel(footprintOf(m))} squares` : ''})</option>`).join('');
  }

  function drawPanel() {
    const saved = loadArenas();
    const sizeNow = `${st.setup.map.width}x${st.setup.map.height}`;
    host.querySelector('.ab-panel').innerHTML = `
      <section class="panel">
        <h3>Arena</h3>
        <label class="field">Name <input type="text" data-ab-input="name" maxlength="40" value="${esc(st.setup.name)}"></label>
        <div class="row wrap">
          <label class="field small">Size
            <select data-ab-input="size">${SIZES.map(([w, h]) => `<option value="${w}x${h}" ${`${w}x${h}` === sizeNow ? 'selected' : ''}>${w - 2} × ${h - 2} squares</option>`).join('')}</select>
          </label>
          <button class="btn small ghost" data-ab="clear">Clear terrain</button>
        </div>
      </section>
      <section class="panel">
        <h3>1 · Paint terrain</h3>
        <p class="small muted">Pick a terrain, then click or drag across squares. Mud, snow and shallow water are difficult terrain (moving into them costs double). Deep water cannot be walked through; walls block movement and sight.</p>
        <div class="ab-palette">${palette()}</div>
      </section>
      <section class="panel">
        <h3>2 · Place your party <span class="muted small">(${st.setup.heroes.length}/4)</span></h3>
        <div class="chips">${ctx.heroes.map((h) => `<button class="chip ${st.tool === 'hero' && st.heroPick === h.id ? 'sel' : ''} ${st.setup.heroes.some((x) => x.id === h.id) ? 'placed' : ''}" data-ab="hero" data-id="${esc(h.id)}">${esc(h.label.split(',')[0])}${st.setup.heroes.some((x) => x.id === h.id) ? ' ✓' : ''}</button>`).join('')}</div>
        <p class="small muted">Choose a hero, then click a square. Click a placed hero again to move them.</p>
      </section>
      <section class="panel">
        <h3>3 · Place the creatures <span class="muted small">(${st.setup.foes.length})</span></h3>
        <input type="search" placeholder="Search all ${FIGHTERS.length} creatures…" data-ab-input="foe-filter" value="${esc(st.foeFilter)}">
        <select data-ab-input="foe" size="6" class="ab-foes">${foeOptions()}</select>
        <label class="small">Side: <select data-ab-input="side">${Object.entries(SIDES).map(([k, v]) => `<option value="${k}" ${st.side === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
        ${!isSquare(footprintOf(BESTIARY_BY_ID[st.foePick])) ? `<label class="small">Long body lies: <select data-ab-input="lie"><option value="ew" ${st.lie === 'ew' ? 'selected' : ''}>east–west</option><option value="ns" ${st.lie === 'ns' ? 'selected' : ''}>north–south</option></select></label>` : ''}
        <button class="btn small ${st.tool === 'foe' ? 'primary' : ''}" data-ab="foe-tool">Place this creature</button>
        <p class="small muted">Large creatures fill 2×2 squares, Huge 3×3, Gargantuan 4×4.</p>
        ${st.setup.foes.length ? `<ul class="plain small ab-foe-list">${st.setup.foes.map((f) => `<li>${esc(BESTIARY_BY_ID[f.statId]?.name)}${f.side && f.side !== 'enemy' ? ` <i>(${SIDES[f.side].toLowerCase()})</i>` : ''} <span class="muted">(${f.pos.x}, ${f.pos.y})</span> <button class="linkish" data-ab="remove-foe" data-uid="${f.uid}">remove</button></li>`).join('')}</ul>` : ''}
        <button class="btn small ghost ${st.tool === 'erase' ? 'primary' : ''}" data-ab="erase-tool">✕ Remove tool (click a token)</button>
      </section>
      <section class="panel">
        <h3>Save &amp; load</h3>
        <div class="row wrap"><button class="btn small" data-ab="save">Save arena</button><button class="btn small ghost" data-ab="new">New arena</button></div>
        ${saved.length ? `<ul class="plain ab-saved">${saved.map((a) => `<li><b>${esc(a.name)}</b> <span class="muted small">${a.rows[0].length - 2}×${a.rows.length - 2} · ${a.foes.length} foes</span>
          <button class="linkish" data-ab="load" data-id="${a.id}">load</button> · <button class="linkish" data-ab="delete" data-id="${a.id}">delete</button></li>`).join('')}</ul>` : '<p class="small muted">No saved arenas yet.</p>'}
      </section>
      <button class="btn primary big ab-fight" data-ab="fight" ${st.setup.heroes.length && st.setup.foes.length ? '' : 'disabled'}>⚔ Start the bout</button>`;
  }

  function redraw() { drawMap(); drawPanel(); save(); }

  host.innerHTML = `<div class="ab-layout"><div class="ab-mapwrap"><div class="ab-map" aria-label="Arena map: click or drag to paint"></div>
    <p class="small muted">Tool: <b class="ab-tool"></b></p></div><aside class="ab-panel"></aside></div>`;

  const toolLabel = () => ({ paint: `Paint ${TERRAINS[st.terrain].name}`, hero: `Place ${ctx.heroes.find((h) => h.id === st.heroPick)?.label.split(',')[0] ?? 'hero'}`, foe: `Place ${BESTIARY_BY_ID[st.foePick]?.name}`, erase: 'Remove a token' }[st.tool]);

  function cellAt(e) {
    const svg = host.querySelector('.ab-map svg'); if (!svg) return null;
    const r = svg.getBoundingClientRect();
    const x = Math.floor(((e.clientX - r.left) / r.width) * st.setup.map.width);
    const y = Math.floor(((e.clientY - r.top) / r.height) * st.setup.map.height);
    return x >= 0 && y >= 0 && x < st.setup.map.width && y < st.setup.map.height ? { x, y } : null;
  }

  let uid = Date.now();
  function act(c) {
    const map = st.setup.map; const here = occupiedBy(c.x, c.y);
    if (st.tool === 'paint') {
      if (TERRAINS[st.terrain].wall && here) return ctx.notify?.('Clear the token from that square first.', 'bad');
      paintTerrain(map, c.x, c.y, st.terrain); drawMap(); save(); return;
    }
    if (st.tool === 'erase') {
      if (here?.kind === 'hero') st.setup.heroes = st.setup.heroes.filter((h) => h !== here.ref);
      if (here?.kind === 'foe') st.setup.foes = st.setup.foes.filter((f) => f !== here.ref);
      redraw(); return;
    }
    if (st.tool === 'hero') {
      if (!standable(map, c.x, c.y) || (here && here.ref.id !== st.heroPick)) return ctx.notify?.('Pick an empty square that can be stood on.', 'bad');
      const existing = st.setup.heroes.find((h) => h.id === st.heroPick);
      if (existing) existing.pos = c;
      else if (st.setup.heroes.length >= 4) return ctx.notify?.('A party can have up to 4 heroes.', 'bad');
      else st.setup.heroes.push({ id: st.heroPick, pos: c });
      redraw(); return;
    }
    if (st.tool === 'foe') {
      const fp0 = footprintOf(BESTIARY_BY_ID[st.foePick]);
      // The long side lies east-west: along the facing for long bodies, across it for spread wings.
      const face = (st.lie === 'ew') !== !!fp0.across ? 2 : 4;
      const n = orientFor(fp0, face);
      const cells = cellsOf(c, n);
      if (!cells.every((q) => standable(map, q.x, q.y) && !occupiedBy(q.x, q.y))) return ctx.notify?.(`A ${BESTIARY_BY_ID[st.foePick].name} needs ${sizeLabel(n)} clear squares here (its top-left corner goes where you click).`, 'bad');
      st.setup.foes.push({ uid: uid++, statId: st.foePick, pos: c, facing: isSquare(fp0) ? 4 : face, side: st.side });
      redraw();
    }
  }

  // Painting: press and drag across squares; other tools act on a single click.
  host.addEventListener('pointerdown', (e) => {
    const c = e.target.closest('.ab-map') && cellAt(e); if (!c) return;
    e.preventDefault(); st.painting = st.tool === 'paint'; st.last = `${c.x},${c.y}`; act(c);
  });
  host.addEventListener('pointermove', (e) => {
    if (!st.painting) return;
    const c = cellAt(e); if (!c || `${c.x},${c.y}` === st.last) return;
    st.last = `${c.x},${c.y}`; act(c);
  });
  window.addEventListener('pointerup', () => { st.painting = false; });

  host.addEventListener('click', (e) => {
    const el = e.target.closest('[data-ab]'); if (!el) return;
    const a = el.dataset.ab;
    if (a === 'terrain') { st.tool = 'paint'; st.terrain = el.dataset.id; }
    if (a === 'hero') { st.tool = 'hero'; st.heroPick = el.dataset.id; }
    if (a === 'foe-tool') st.tool = 'foe';
    if (a === 'erase-tool') st.tool = 'erase';
    if (a === 'remove-foe') st.setup.foes = st.setup.foes.filter((f) => String(f.uid) !== el.dataset.uid);
    if (a === 'clear') { const { width: w, height: h } = st.setup.map; st.setup.map = createArenaMap(w, h); st.setup.foes = []; st.setup.heroes = []; }
    if (a === 'new') st.setup = defaultArena(st.setup.map.width, st.setup.map.height);
    if (a === 'save') {
      const list = loadArenas();
      const rec = { id: st.setup.id ?? `a${Date.now().toString(36)}`, name: st.setup.name.trim() || 'Arena', rows: encodeTerrain(st.setup.map), heroes: st.setup.heroes, foes: st.setup.foes, updated: new Date().toISOString() };
      st.setup.id = rec.id;
      const i = list.findIndex((x) => x.id === rec.id); if (i >= 0) list[i] = rec; else list.push(rec);
      const ok = storeArenas(list);
      ctx.notify?.(ok ? `Saved "${rec.name}". Load it again any time from this list.` : 'Could not save: browser storage is unavailable.', ok ? 'ok' : 'bad');
    }
    if (a === 'load') {
      const rec = loadArenas().find((x) => x.id === el.dataset.id);
      if (rec) st.setup = { id: rec.id, name: rec.name, map: decodeArena(rec.rows), heroes: rec.heroes.filter((h) => ctx.heroes.some((x) => x.id === h.id)), foes: rec.foes.filter((f) => BESTIARY_BY_ID[f.statId]) };
    }
    if (a === 'delete') {
      const armed = st.armedDelete === el.dataset.id;
      if (!armed) { st.armedDelete = el.dataset.id; ctx.notify?.('Click delete again to remove this arena.'); return; }
      storeArenas(loadArenas().filter((x) => x.id !== el.dataset.id)); st.armedDelete = null;
    }
    if (a === 'fight') { ctx.onFight?.(structuredClone({ ...st.setup, map: st.setup.map })); return; }
    host.querySelector('.ab-tool').textContent = toolLabel();
    redraw();
  });
  host.addEventListener('change', (e) => {
    const k = e.target.dataset.abInput; if (!k) return;
    if (k === 'size') {
      const [w, h] = e.target.value.split('x').map(Number);
      st.setup = { ...defaultArena(w, h), name: st.setup.name, id: st.setup.id };
      redraw();
    }
    if (k === 'lie') { st.lie = e.target.value; st.tool = 'foe'; drawPanel(); }
    if (k === 'side') { st.side = e.target.value; st.tool = 'foe'; drawPanel(); }
    if (k === 'foe') { st.foePick = e.target.value; st.tool = 'foe'; host.querySelector('.ab-tool').textContent = toolLabel(); drawPanel(); }
  });
  host.addEventListener('input', (e) => {
    const k = e.target.dataset.abInput;
    if (k === 'name') { st.setup.name = e.target.value; save(); }
    if (k === 'foe-filter') { st.foeFilter = e.target.value; host.querySelector('.ab-foes').innerHTML = foeOptions(); }
  });

  host.querySelector('.ab-tool').textContent = toolLabel();
  redraw();
}
