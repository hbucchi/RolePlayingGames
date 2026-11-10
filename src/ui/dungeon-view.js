/**
 * Dungeon explorer: shows a generated map and lets a hero move on the grid using 5e
 * movement. Owns its DOM inside `host`; the base map is drawn once per map/option change
 * and only the light overlay (reachable squares, route, token) is redrawn on interaction.
 */
import { generateDungeon, roomAt } from '../engine/dungeon.js';
import { renderDungeonSVG } from '../engine/dungeon-render.js';
import { reachableSquares, speedToSquares, DIAGONAL_RULES, cellKey } from '../engine/movement.js';

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/**
 * @param {HTMLElement} host
 * @param {{heroes: {id, name, speed, label}[], initialSeed?: number}} opts
 */
export function mountDungeon(host, { heroes, initialSeed = 7 }) {
  const s = {
    seed: initialSeed,
    map: null,
    grid: true,
    labels: true,
    rule: 'standard',
    heroId: heroes[0]?.id ?? null,
    pos: null,
    used: 0,
    dash: false,
    zoom: 0.5,
    hover: null,
    reach: new Map(),
  };

  host.innerHTML = `
    <div class="dg-toolbar">
      <div class="dg-group">
        <button class="btn small ghost" data-dg="seed-prev" aria-label="Previous dungeon">◀</button>
        <label class="dg-seed">Dungeon #<input type="number" min="1" max="999999" data-dg="seed" aria-label="Dungeon seed"></label>
        <button class="btn small ghost" data-dg="seed-next" aria-label="Next dungeon">▶</button>
        <button class="btn small" data-dg="random">New dungeon</button>
      </div>
      <div class="dg-group">
        <label class="dg-check"><input type="checkbox" data-dg="grid" checked> Grid</label>
        <label class="dg-check"><input type="checkbox" data-dg="labels" checked> Room numbers</label>
      </div>
      <div class="dg-group">
        <button class="btn small ghost" data-dg="zoom-out" aria-label="Zoom out">−</button>
        <button class="btn small ghost" data-dg="fit">Fit</button>
        <button class="btn small ghost" data-dg="zoom-in" aria-label="Zoom in">+</button>
      </div>
    </div>
    <div class="dg-layout">
      <div class="dg-viewport" tabindex="0" aria-label="Dungeon map">
        <div class="dg-stage">
          <div class="dg-base"></div>
          <svg class="dg-overlay" xmlns="http://www.w3.org/2000/svg"></svg>
        </div>
      </div>
      <aside class="dg-panel">
        <section>
          <h3>Hero</h3>
          ${heroes.length ? `<select data-dg="hero" aria-label="Hero">${heroes.map((h) => `<option value="${esc(h.id)}">${esc(h.label)}</option>`).join('')}</select>`
    : '<p class="muted small">Create or adopt a hero to explore.</p>'}
          <div class="dg-move"></div>
          <div class="row wrap">
            <button class="btn small" data-dg="dash" title="Dash: spend your action to gain extra movement equal to your speed">Dash</button>
            <button class="btn small primary" data-dg="end-turn">End turn</button>
            <button class="btn small ghost" data-dg="to-entrance">Back to stairs</button>
          </div>
          <label class="field small">Diagonal rule
            <select data-dg="rule">${Object.entries(DIAGONAL_RULES).map(([k, v]) => `<option value="${k}">${esc(v.name)}</option>`).join('')}</select>
          </label>
        </section>
        <section class="dg-info" aria-live="polite"></section>
        <section>
          <h3>Rooms</h3>
          <ol class="dg-rooms"></ol>
        </section>
      </aside>
    </div>`;

  const $ = (sel) => host.querySelector(sel);
  const viewport = $('.dg-viewport');
  const stage = $('.dg-stage');
  const base = $('.dg-base');
  const overlay = $('.dg-overlay');

  const hero = () => heroes.find((h) => h.id === s.heroId) ?? null;
  const budget = () => {
    const h = hero();
    if (!h) return 0;
    const sq = speedToSquares(h.speed, s.map.feetPerCell);
    return sq * (s.dash ? 2 : 1);
  };

  function newMap(seed) {
    s.seed = Math.max(1, Math.floor(seed) || 1);
    s.map = generateDungeon(s.seed);
    s.pos = { x: s.map.entrance.x, y: s.map.entrance.y };
    s.used = 0; s.dash = false; s.hover = null;
    $('[data-dg="seed"]').value = s.seed;
    drawBase();
    drawRooms();
    update();
  }

  function drawBase() {
    base.innerHTML = renderDungeonSVG(s.map, { grid: s.grid, labels: s.labels });
    const S = s.map.cellSize;
    overlay.setAttribute('viewBox', `0 0 ${s.map.width * S} ${s.map.height * S}`);
    applyZoom();
  }

  function drawRooms() {
    $('.dg-rooms').innerHTML = s.map.rooms.map((r) => `
      <li><button class="dg-room" data-dg="goto-room" data-room="${r.id}">
        <span class="n">${r.id}</span><span class="nm">${esc(r.name)}${r.entrance ? ' <small>(stairs)</small>' : ''}</span>
        <span class="sz">${r.w * s.map.feetPerCell}×${r.h * s.map.feetPerCell} ft</span></button></li>`).join('');
  }

  function applyZoom() {
    const px = s.map.width * s.map.cellSize * s.zoom;
    stage.style.width = `${px}px`;
    stage.style.height = `${px}px`;
  }

  function fit() {
    const avail = Math.min(viewport.clientWidth, Math.max(320, window.innerHeight - 220));
    s.zoom = Math.max(0.15, Math.min(1, (avail - 4) / (s.map.width * s.map.cellSize)));
    applyZoom();
  }

  function zoomBy(f) {
    // Keep the centre of the view fixed while zooming.
    const cx = (viewport.scrollLeft + viewport.clientWidth / 2) / s.zoom;
    const cy = (viewport.scrollTop + viewport.clientHeight / 2) / s.zoom;
    s.zoom = Math.max(0.15, Math.min(1.5, s.zoom * f));
    applyZoom();
    viewport.scrollLeft = cx * s.zoom - viewport.clientWidth / 2;
    viewport.scrollTop = cy * s.zoom - viewport.clientHeight / 2;
  }

  function update() {
    const remaining = Math.max(0, budget() - s.used);
    s.reach = hero() ? reachableSquares(s.map, s.pos, remaining, { diagonalRule: s.rule }) : new Map();
    drawOverlay();
    drawPanel();
  }

  function drawOverlay() {
    const S = s.map.cellSize;
    let out = '';
    for (const c of s.reach.values()) {
      if (c.cost === 0) continue;
      out += `<rect x="${c.x * S + 3}" y="${c.y * S + 3}" width="${S - 6}" height="${S - 6}" rx="6" class="dg-reach"/>`;
    }
    const target = s.hover && s.reach.get(cellKey(s.hover.x, s.hover.y));
    if (target && target.cost > 0) {
      const pts = target.path.map((p) => `${(p.x + 0.5) * S},${(p.y + 0.5) * S}`).join(' ');
      out += `<polyline points="${pts}" class="dg-path"/>`;
      out += `<rect x="${target.x * S + 2}" y="${target.y * S + 2}" width="${S - 4}" height="${S - 4}" rx="6" class="dg-target"/>`;
      out += `<text x="${(target.x + 0.5) * S}" y="${(target.y + 0.5) * S + 9}" class="dg-cost">${target.cost * s.map.feetPerCell}</text>`;
    } else if (s.hover) {
      out += `<rect x="${s.hover.x * S + 2}" y="${s.hover.y * S + 2}" width="${S - 4}" height="${S - 4}" rx="6" class="dg-hover"/>`;
    }
    const h = hero();
    if (h) {
      const cx = (s.pos.x + 0.5) * S; const cy = (s.pos.y + 0.5) * S;
      out += `<g class="dg-token"><circle cx="${cx}" cy="${cy}" r="${S * 0.4}"/><text x="${cx}" y="${cy + S * 0.13}">${esc(h.name[0])}</text></g>`;
    }
    overlay.innerHTML = out;
  }

  function drawPanel() {
    const h = hero();
    const total = budget();
    const left = Math.max(0, total - s.used);
    const ft = s.map.feetPerCell;
    $('.dg-move').innerHTML = h ? `
      <p class="dg-meter"><strong>${left}</strong> of ${total} squares left <span class="muted">(${left * ft} of ${total * ft} ft)</span></p>
      <div class="dg-bar"><span style="width:${total ? (left / total) * 100 : 0}%"></span></div>
      <p class="muted small">Speed ${h.speed} ft = ${speedToSquares(h.speed, ft)} squares${s.dash ? ', doubled by Dash' : ''}.</p>` : '';
    $('[data-dg="dash"]').disabled = !h || s.dash;

    const info = $('.dg-info');
    if (!s.hover) { info.innerHTML = '<p class="muted small">Hover over the map to inspect a square. Highlighted squares are within reach this turn.</p>'; return; }
    const room = roomAt(s.map, s.hover.x, s.hover.y);
    const tile = s.map.tiles[s.hover.y][s.hover.x];
    const kind = ['Solid rock', 'Floor', 'Corridor', 'Doorway'][tile];
    const c = s.reach.get(cellKey(s.hover.x, s.hover.y));
    info.innerHTML = `
      <p><strong>Square ${s.hover.x}, ${s.hover.y}</strong> · ${kind}</p>
      ${room ? `<p>Room ${room.id}: ${esc(room.name)} <span class="muted">(${room.w}×${room.h} squares)</span></p>` : ''}
      ${c ? `<p>${c.cost} square${c.cost === 1 ? '' : 's'} away (${c.cost * s.map.feetPerCell} ft)</p>`
    : tile ? '<p class="muted">Out of reach this turn.</p>' : ''}`;
  }

  function cellFromEvent(e) {
    const r = overlay.getBoundingClientRect();
    const x = Math.floor(((e.clientX - r.left) / r.width) * s.map.width);
    const y = Math.floor(((e.clientY - r.top) / r.height) * s.map.height);
    if (x < 0 || y < 0 || x >= s.map.width || y >= s.map.height) return null;
    return { x, y };
  }

  function scrollToCell(x, y) {
    const S = s.map.cellSize * s.zoom;
    viewport.scrollTo({ left: (x + 0.5) * S - viewport.clientWidth / 2, top: (y + 0.5) * S - viewport.clientHeight / 2, behavior: 'smooth' });
  }

  // ---- Events --------------------------------------------------------------
  overlay.addEventListener('pointermove', (e) => {
    const c = cellFromEvent(e);
    if (c && s.hover && c.x === s.hover.x && c.y === s.hover.y) return;
    s.hover = c; drawOverlay(); drawPanel();
  });
  overlay.addEventListener('pointerleave', () => { s.hover = null; drawOverlay(); drawPanel(); });
  overlay.addEventListener('click', (e) => {
    const c = cellFromEvent(e);
    const target = c && s.reach.get(cellKey(c.x, c.y));
    if (!target || target.cost === 0) return;
    s.pos = { x: target.x, y: target.y };
    s.used += target.cost;
    update();
  });

  host.addEventListener('click', (e) => {
    const el = e.target.closest('[data-dg]');
    if (!el || el.matches('input, select')) return;
    switch (el.dataset.dg) {
      case 'seed-prev': newMap(s.seed - 1); break;
      case 'seed-next': newMap(s.seed + 1); break;
      case 'random': newMap(1 + Math.floor(Math.random() * 99999)); fit(); break;
      case 'zoom-in': zoomBy(1.25); break;
      case 'zoom-out': zoomBy(0.8); break;
      case 'fit': fit(); break;
      case 'dash': s.dash = true; update(); break;
      case 'end-turn': s.used = 0; s.dash = false; update(); break;
      case 'to-entrance': s.pos = { x: s.map.entrance.x, y: s.map.entrance.y }; s.used = 0; s.dash = false; update(); scrollToCell(s.pos.x, s.pos.y); break;
      case 'goto-room': {
        const r = s.map.rooms.find((x) => x.id === Number(el.dataset.room));
        if (r) scrollToCell(r.x + r.w / 2, r.y + r.h / 2);
        break;
      }
      default:
    }
  });

  host.addEventListener('change', (e) => {
    const el = e.target;
    switch (el.dataset.dg) {
      case 'seed': newMap(Number(el.value)); break;
      case 'grid': s.grid = el.checked; drawBase(); break;
      case 'labels': s.labels = el.checked; drawBase(); break;
      case 'rule': s.rule = el.value; update(); break;
      case 'hero': s.heroId = el.value; s.used = 0; s.dash = false; update(); break;
      default:
    }
  });

  newMap(s.seed);
  requestAnimationFrame(fit);
}
