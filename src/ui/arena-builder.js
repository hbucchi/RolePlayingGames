/**
 * Arena builder: paint terrain square by square, place heroes and foes, save the layout and
 * start a bout. The battle itself runs in the same engine as the dungeon (dungeon-view.js).
 */
import { createStore, FORMATS } from '../engine/saves.js';
import { TERRAINS, createArenaMap, paintTerrain, encodeTerrain, decodeArena, standable } from '../engine/terrain.js';
import { PROPS, propCells, propDims, propImage, clearPropIndex } from '../engine/props.js';
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
  // A few pieces to start from (the furniture tool adds or removes more).
  map.props = [{ kind: 'statue', x: 3, y: 3 }, { kind: 'statue', x: w - 4, y: 3 }, { kind: 'brazier', x: 3, y: h - 4 }, { kind: 'brazier', x: w - 4, y: h - 4 },
    { kind: 'barrel', x: 2, y: Math.floor(h / 2) }, { kind: 'crates', x: w - 3, y: Math.floor(h / 2) }];
  return { name: 'New arena', map, heroes: [], foes: [] };
}

/**
 * @param host     element to draw into
 * @param ctx      { heroes: [{id, label, look}], setup, onChange(setup), onFight(setup), notify(text, kind) }
 */
export function mountArenaBuilder(host, ctx) {
  const st = {
    setup: ctx.setup ?? defaultArena(), tool: 'paint', terrain: 'grass', heroPick: ctx.heroes[0]?.id ?? null,
    foePick: 'goblin', foeFilter: '', side: 'enemy', lie: 'ew', painting: false, facing: 4, propPick: 'barrel', propRot: 0,
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

  /** Furniture and fittings to place (engine/props.js); crafting stations are marked ⚒. */
  function propPalette() {
    return Object.entries(PROPS).map(([id, p]) => `
      <button class="ab-swatch ab-prop ${st.tool === 'prop' && st.propPick === id ? 'sel' : ''}" data-ab="prop" data-id="${id}" title="${esc(p.name)} · ${p.w}×${p.h} · ${p.block === 'move' ? 'blocks movement' : p.block === 'slow' ? 'difficult terrain' : 'walk over it'}${p.station ? ' · crafting station' : ''}">
        <span class="sw" style="background-image:url('${esc(propImage(id))}')"></span>
        <span>${esc(p.name)}${p.station ? ' <small>⚒</small>' : ''}</span>
      </button>`).join('');
  }
  const propAtCell = (x, y) => (st.setup.map.props ?? []).find((p) => propCells(p).some((q) => q.x === x && q.y === y));

  function foeOptions() {
    const q = st.foeFilter.trim().toLowerCase();
    const list = q ? FIGHTERS.filter((m) => m.name.toLowerCase().includes(q)) : FIGHTERS.filter((m) => DUNGEON_FOES.includes(m.id));
    return list.slice(0, 120).map((m) => `<option value="${m.id}" ${m.id === st.foePick ? 'selected' : ''}>CR ${m.cr} · ${esc(m.name)} (${m.size}${footprintOf(m) !== 1 ? `, ${sizeLabel(footprintOf(m))} squares` : ''})</option>`).join('');
  }

  /**
   * The builder's controls. Everything that matters fits in the first screen: the Start button
   * and the arena itself in a toolbar on top, then one compact card per tool, each a dropdown.
   */
  function drawPanel() {
    const saved = loadArenas();
    const sizeNow = `${st.setup.map.width}x${st.setup.map.height}`;
    const ready = st.setup.heroes.length && st.setup.foes.length;
    const why = !st.setup.heroes.length ? 'Place at least one hero' : !st.setup.foes.length ? 'Place at least one creature' : '';
    host.querySelector('.ab-top').innerHTML = `
      <button class="btn primary big ab-fight" data-ab="fight" ${ready ? '' : 'disabled'} title="${esc(why || 'Fight on this map')}">⚔ Start the bout</button>
      <label class="field small ab-name">Arena <input type="text" data-ab-input="name" maxlength="40" value="${esc(st.setup.name)}"></label>
      <label class="field small">Size <select data-ab-input="size">${SIZES.map(([w, h]) => `<option value="${w}x${h}" ${`${w}x${h}` === sizeNow ? 'selected' : ''}>${w - 2} × ${h - 2}</option>`).join('')}</select></label>
      <label class="field small">Saved <select data-ab-input="saved"><option value="">${saved.length ? `Load one of ${saved.length}…` : 'None yet'}</option>${saved.map((a) => `<option value="${a.id}">${esc(a.name)} (${a.rows[0].length - 2}×${a.rows.length - 2}, ${a.foes.length} foes)</option>`).join('')}</select></label>
      <div class="ab-top-btns">
        <button class="btn small" data-ab="save" title="Save this arena in this browser">💾 Save</button>
        <button class="btn small ghost" data-ab="new" title="A fresh arena of this size">New</button>
        <button class="btn small ghost" data-ab="clear" title="Wipe terrain, furniture and tokens">Clear</button>
        ${st.setup.id && saved.some((a) => a.id === st.setup.id) ? `<button class="btn small ghost danger" data-ab="delete" data-id="${st.setup.id}" title="Delete the saved copy">🗑</button>` : ''}
      </div>
      ${why ? `<span class="small muted ab-why">${esc(why)} to start.</span>` : ''}`;
    const t = (id) => (st.tool === id ? 'on' : '');
    const stat = BESTIARY_BY_ID[st.foePick];
    host.querySelector('.ab-panel').innerHTML = `
      <section class="ab-card ${t('paint')}">
        <button class="ab-card-head" data-ab="tool" data-tool="paint"><span>🖌 Paint terrain</span><small>click or drag</small></button>
        <select data-ab-input="terrain">${Object.entries(TERRAINS).map(([id, x]) => `<option value="${id}" ${st.terrain === id ? 'selected' : ''}>${esc(x.name)}${x.cost === 2 ? ' (×2 move)' : x.cost === Infinity ? ' (no walking)' : x.wall ? ' (blocks)' : ''}</option>`).join('')}</select>
        <span class="ab-swatch-now" style="background-image:url('${esc(st.terrain === 'floor' || st.terrain === 'wall' || TERRAINS[st.terrain].single ? TERRAINS[st.terrain].texture : TERRAINS[st.terrain].texture.replace('.jpg', '-1.jpg'))}')"></span>
      </section>
      <section class="ab-card ${t('prop')}">
        <button class="ab-card-head" data-ab="tool" data-tool="prop"><span>🪑 Furniture</span><small>top-left corner</small></button>
        <select data-ab-input="prop">${Object.entries(PROPS).map(([id, x]) => `<option value="${id}" ${st.propPick === id ? 'selected' : ''}>${esc(x.name)} · ${x.w}×${x.h}${x.station ? ' ⚒' : ''}${x.block === 'slow' ? ' (slows)' : !x.block ? ' (walk over)' : ''}</option>`).join('')}</select>
        <span class="ab-swatch-now prop" style="background-image:url('${esc(propImage(st.propPick))}')"></span>
        <button class="btn small" data-ab="prop-rot" title="Turn the piece">↻ ${st.propRot}°</button>
      </section>
      <section class="ab-card ${t('hero')}">
        <button class="ab-card-head" data-ab="tool" data-tool="hero"><span>🛡 Heroes</span><small>${st.setup.heroes.length}/4 placed</small></button>
        <select data-ab-input="hero">${ctx.heroes.map((h) => `<option value="${esc(h.id)}" ${st.heroPick === h.id ? 'selected' : ''}>${esc(h.label.split(',')[0])}${st.setup.heroes.some((x) => x.id === h.id) ? ' ✓' : ''}</option>`).join('')}</select>
      </section>
      <section class="ab-card ${t('foe')}">
        <button class="ab-card-head" data-ab="tool" data-tool="foe"><span>🐉 Creatures</span><small>${st.setup.foes.length} placed</small></button>
        <input type="search" placeholder="Search ${FIGHTERS.length} creatures…" data-ab-input="foe-filter" value="${esc(st.foeFilter)}">
        <select data-ab-input="foe" class="ab-foes">${foeOptions()}</select>
        <select data-ab-input="side" title="Which side it fights on">${Object.entries(SIDES).map(([k, v]) => `<option value="${k}" ${st.side === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
        ${stat && !isSquare(footprintOf(stat)) ? `<select data-ab-input="lie" title="Which way its long body lies"><option value="ew" ${st.lie === 'ew' ? 'selected' : ''}>Lies east–west</option><option value="ns" ${st.lie === 'ns' ? 'selected' : ''}>Lies north–south</option></select>` : ''}
        <small class="muted">${stat ? `${esc(stat.size)}, ${sizeLabel(footprintOf(stat))} squares · CR ${stat.cr}` : ''}</small>
      </section>
      <section class="ab-card ${t('erase')}">
        <button class="ab-card-head" data-ab="tool" data-tool="erase"><span>✕ Remove</span><small>click a token or a piece</small></button>
      </section>
      ${st.setup.foes.length ? `<details class="ab-card ab-placed"><summary>Placed creatures (${st.setup.foes.length})</summary><ul class="plain small ab-foe-list">${st.setup.foes.map((f) => `<li>${esc(BESTIARY_BY_ID[f.statId]?.name)}${f.side && f.side !== 'enemy' ? ` <i>(${SIDES[f.side].toLowerCase()})</i>` : ''} <span class="muted">(${f.pos.x}, ${f.pos.y})</span> <button class="linkish" data-ab="remove-foe" data-uid="${f.uid}">remove</button></li>`).join('')}</ul></details>` : ''}`;
  }

  function redraw() { drawMap(); drawPanel(); save(); }

  host.innerHTML = `<div class="ab-top"></div><div class="ab-layout"><div class="ab-mapwrap"><div class="ab-map" aria-label="Arena map: click or drag to paint"></div>
    <p class="small muted">Tool: <b class="ab-tool"></b></p></div><aside class="ab-panel"></aside></div>`;

  const toolLabel = () => ({ prop: `Place ${PROPS[st.propPick]?.name}`, paint: `Paint ${TERRAINS[st.terrain].name}`, hero: `Place ${ctx.heroes.find((h) => h.id === st.heroPick)?.label.split(',')[0] ?? 'hero'}`, foe: `Place ${BESTIARY_BY_ID[st.foePick]?.name}`, erase: 'Remove a token' }[st.tool]);

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
    if (st.tool === 'prop') {
      const pr = { kind: st.propPick, x: c.x, y: c.y, rot: PROPS[st.propPick].w === PROPS[st.propPick].h ? 0 : st.propRot };
      const def = PROPS[pr.kind];
      const ok = propCells(pr).every((q) => (def.wall ? map.tiles[q.y]?.[q.x] !== undefined : standable(map, q.x, q.y) && !occupiedBy(q.x, q.y)) && (def.under || !(propAtCell(q.x, q.y) && !PROPS[propAtCell(q.x, q.y).kind].under)));
      if (!ok) { const d = propDims(pr); return ctx.notify?.(`${def.name} needs ${d.w}×${d.h} clear squares here (its top-left corner goes where you click).`, 'bad'); }
      (map.props ??= []).push(pr); clearPropIndex(map); drawMap(); save(); return;
    }
    if (st.tool === 'erase' && !here && propAtCell(c.x, c.y)) {
      const pr = propAtCell(c.x, c.y); map.props = map.props.filter((p) => p !== pr); clearPropIndex(map); drawMap(); save(); return;
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
    if (a === 'tool') st.tool = el.dataset.tool;
    if (a === 'terrain') { st.tool = 'paint'; st.terrain = el.dataset.id; }
    if (a === 'hero') { st.tool = 'hero'; st.heroPick = el.dataset.id; }
    if (a === 'prop') { st.tool = 'prop'; st.propPick = el.dataset.id; }
    if (a === 'prop-rot') { st.tool = 'prop'; st.propRot = (st.propRot + 90) % 360; }
    if (a === 'foe-tool') st.tool = 'foe';
    if (a === 'erase-tool') st.tool = 'erase';
    if (a === 'remove-foe') st.setup.foes = st.setup.foes.filter((f) => String(f.uid) !== el.dataset.uid);
    if (a === 'clear') { const { width: w, height: h } = st.setup.map; st.setup.map = createArenaMap(w, h); st.setup.foes = []; st.setup.heroes = []; }
    if (a === 'new') st.setup = defaultArena(st.setup.map.width, st.setup.map.height);
    if (a === 'save') {
      const list = loadArenas();
      const rec = { id: st.setup.id ?? `a${Date.now().toString(36)}`, name: st.setup.name.trim() || 'Arena', rows: encodeTerrain(st.setup.map), props: st.setup.map.props ?? [], heroes: st.setup.heroes, foes: st.setup.foes, updated: new Date().toISOString() };
      st.setup.id = rec.id;
      const i = list.findIndex((x) => x.id === rec.id); if (i >= 0) list[i] = rec; else list.push(rec);
      const ok = storeArenas(list);
      ctx.notify?.(ok ? `Saved "${rec.name}". Load it again any time from this list.` : 'Could not save: browser storage is unavailable.', ok ? 'ok' : 'bad');
    }
    if (a === 'load') {
      const rec = loadArenas().find((x) => x.id === el.dataset.id);
      if (rec) st.setup = { id: rec.id, name: rec.name, map: Object.assign(decodeArena(rec.rows), { props: (rec.props ?? []).filter((p) => PROPS[p.kind]) }), heroes: rec.heroes.filter((h) => ctx.heroes.some((x) => x.id === h.id)), foes: rec.foes.filter((f) => BESTIARY_BY_ID[f.statId]) };
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
    // Picking from a dropdown also picks up that tool.
    if (k === 'terrain') { st.terrain = e.target.value; st.tool = 'paint'; }
    if (k === 'prop') { st.propPick = e.target.value; st.tool = 'prop'; }
    if (k === 'hero') { st.heroPick = e.target.value; st.tool = 'hero'; }
    if (k === 'saved' && e.target.value) {
      const rec = loadArenas().find((x) => x.id === e.target.value);
      if (rec) { st.setup = { id: rec.id, name: rec.name, map: Object.assign(decodeArena(rec.rows), { props: (rec.props ?? []).filter((p) => PROPS[p.kind]) }), heroes: rec.heroes.filter((h) => ctx.heroes.some((x) => x.id === h.id)), foes: rec.foes.filter((f) => BESTIARY_BY_ID[f.statId]) }; ctx.notify?.(`Loaded "${rec.name}".`, 'ok'); redraw(); }
    }
    if (['terrain', 'prop', 'hero'].includes(k)) { host.querySelector('.ab-tool').textContent = toolLabel(); drawPanel(); }
  });
  host.addEventListener('input', (e) => {
    const k = e.target.dataset.abInput;
    if (k === 'name') { st.setup.name = e.target.value; save(); }
    if (k === 'foe-filter') {
      st.foeFilter = e.target.value; host.querySelector('.ab-foes').innerHTML = foeOptions();
      // The first match becomes the pick, so a search then a click on the map just works.
      const first = host.querySelector('.ab-foes option'); if (first) { st.foePick = first.value; st.tool = 'foe'; host.querySelector('.ab-tool').textContent = toolLabel(); }
    }
  });

  host.querySelector('.ab-tool').textContent = toolLabel();
  redraw();
}
