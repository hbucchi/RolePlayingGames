/**
 * Drawing the map overlay: tokens and bodies, doors, features, fog, highlights and effects.
 * Part of the dungeon screen (see ../dungeon-view.js): `ctx` gives access to the shared state `s`
 * and to the functions of the other parts.
 */
import { dims, orientFor, spanOf, isSquare, centerOf } from '../../engine/size.js';
import { bodyUrl, bodyScale, bodyTint, portraitTint } from '../../content/media.js';
import { woundState, facingAngle, FACINGS, covers } from '../../engine/combat.js';
import { TILE } from '../../engine/dungeon.js';
import { cellKey } from '../../engine/movement.js';

export function installRender(ctx) {
  const { S, esc, overlay, s } = ctx;

  // ---------------------------------------------------------------------------
  // Drawing
  // ---------------------------------------------------------------------------

  function redraw() {
    s.reach = s.mode === 'combat' && s.order.length && !s.busy ? ctx.heroReach() : s.mode === 'explore' && !s.busy ? ctx.heroReach() : new Map();
    drawOverlay();
    ctx.drawPanel();
  }

  /**
   * A token. Square blocks (1x1, 2x2...) get a round token: the portrait in the middle, a coloured
   * front arc + arrow and a dark back arc. Rectangular blocks (a 3x2 dragon) get a rounded
   * rectangle of the same proportions, so the painting is never squashed: it is cropped to fit,
   * and an arrow on the edge shows which way the creature faces.
   */
  /** A number from an id, so each body lies at its own fixed angle. */
  const hashOf = (id) => [...String(id)].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) % 9973, 7);

  /**
   * What a fallen creature leaves: its body on its side in its own blood, darkened; a spirit
   * (ghost, wraith...) fades away and leaves only its cloak and mail on the floor. Click to search.
   */
  function remains(m, hero = false) {
    const sz = S(); const d = dims(m.size ?? 1); const h = hashOf(m.id);
    const cx = (m.pos.x + d.w / 2) * sz; const cy = (m.pos.y + d.h / 2) * sz;
    const sel = s.selectedId === m.id || (s.target?.kind === 'corpse' && s.target.id === m.id);
    if (!hero && ctx.SPIRIT.test(m.statId ?? '')) {
      const k = Math.min(d.w, d.h) * sz;
      return `<g class="remains garb" transform="translate(${cx} ${cy}) rotate(${h % 360})">
        ${sel ? `<circle r="${k * 0.55}" class="tk-selring"/>` : ''}
        <image href="assets/items/hooded-cloak.jpg" x="${-k * 0.42}" y="${-k * 0.36}" width="${k * 0.8}" height="${k * 0.8}" mask="url(#blood-mask)" preserveAspectRatio="xMidYMid slice" style="filter:grayscale(.6) brightness(.7)"/>
        <image href="assets/items/chain-mail.jpg" x="${-k * 0.12}" y="${-k * 0.2}" width="${k * 0.5}" height="${k * 0.5}" mask="url(#blood-mask)" preserveAspectRatio="xMidYMid slice" transform="rotate(35)" style="filter:brightness(.75)"/>
      </g>`;
    }
    const tokensView = s.view !== 'bodies';
    const url = tokensView ? null : bodyUrl(hero ? m.race : m.statId);
    const turn = facingAngle(m.facing ?? 0) + (h % 2 ? 90 : -90) + ((h % 41) - 20);
    const blood = hero ? 'red' : ctx.bloodOf(m) ?? null;
    const own = hero ? 'none' : bodyTint(m.statId);
    const look = `${own === 'none' ? '' : `${own} `}brightness(.85) saturate(.9)`;
    const id = `cm-${esc(m.id)}`;
    // Blood painted on the body itself (the sprite's own outline masks it), in its own colour.
    const smears = (w, hgt) => (blood ? [0, 1, 2, 3, 4].map((k) => {
      const q = (h >> (k * 3)) % 97; return `<circle cx="${((q % 10) / 10 - 0.45) * w}" cy="${((q % 7) / 7 - 0.45) * hgt}" r="${(0.1 + (q % 5) * 0.03) * Math.min(w, hgt)}"/>`;
    }).join('') : '');
    let pic;
    if (url) {
      const north = dims(orientFor(m.size ?? 1, 0));
      const scale = (spanOf(m.size ?? 1) === 1 ? 1.2 : 1) * bodyScale(hero ? m.race : m.statId);
      const bw = north.w * sz * scale; const bh = north.h * sz * scale;
      pic = `<mask id="${id}" style="mask-type:alpha"><image href="${esc(url)}" x="${-bw / 2}" y="${-bh / 2}" width="${bw}" height="${bh}" preserveAspectRatio="xMidYMid meet"/></mask>
        <image href="${esc(url)}" x="${-bw / 2}" y="${-bh / 2}" width="${bw}" height="${bh}" preserveAspectRatio="xMidYMid meet" style="filter:${look}"/>
        <g mask="url(#${id})" fill="url(#bl-${blood ?? 'red'})" opacity=".85">${smears(bw, bh)}</g>`;
    } else {
      // Tokens: the creature's own round portrait, toppled, bloodied and marked as slain.
      const img = hero ? m.look?.url : ctx.portraitOf(m); const r = Math.min(d.w, d.h) * sz * 0.38;
      pic = `<clipPath id="${id}"><circle r="${r}"/></clipPath>
        ${img ? `<image href="${esc(img)}" x="${-r}" y="${-r}" width="${2 * r}" height="${2 * r}" clip-path="url(#${id})" preserveAspectRatio="xMidYMid slice" style="filter:${hero || portraitTint(m.statId) === 'none' ? '' : `${portraitTint(m.statId)} `}grayscale(.5) brightness(.7)"/>` : `<circle r="${r}" class="tk-back"/>`}
        <g clip-path="url(#${id})" fill="url(#bl-${blood ?? 'red'})" opacity=".8">${smears(2 * r, 2 * r)}</g>
        <circle r="${r}" class="remains-ring"/><text y="${r * 0.35}" class="remains-skull" style="font-size:${r}px">☠</text>`;
    }
    return `<g class="remains ${hero ? 'fallen-hero' : ''}" transform="translate(${cx} ${cy})">
      ${sel ? `<ellipse rx="${d.w * sz * 0.5}" ry="${d.h * sz * 0.5}" class="tk-selring"/>` : ''}
      <g transform="rotate(${turn}) scale(1 .9)">${pic}</g>
    </g>`;
  }

  function token(e, { hero = false } = {}) {
    if (hero && e.hp <= 0) return remains(e, true); // a fallen hero lies where they dropped
    const d = dims(e.size ?? 1);
    const body = s.view === 'bodies' ? bodyUrl(hero ? e.race : e.statId) : null;
    if (body) return bodyToken(e, d, body, hero);
    if (d.w !== d.h) return rectToken(e, d);
    const n = d.w;
    const sz = S(); const r = sz * (n > 1 ? 0.44 : 0.36) * n; const R = r + 4;
    const state = woundState(e.hp, e.maxHp);
    const off = s.lunge?.id === e.id ? { x: s.lunge.dx * sz * 0.28, y: s.lunge.dy * sz * 0.28 } : { x: 0, y: 0 };
    const cx = (e.pos.x + n / 2) * sz + off.x; const cy = (e.pos.y + n / 2) * sz + off.y;
    const { img, filter, ring, hpFrac, cls } = tokenLook(e, hero, state);
    return `<g class="${cls}" transform="translate(${cx} ${cy})">
      ${s.selectedId === e.id ? `<circle r="${R + 9}" class="tk-selring"/>` : ''}
      ${s.aiming === e.id ? `<circle r="${R + 6}" class="tk-aim"/>` : ''}
      ${auraSvg(e, R, R)}
      ${hero && e === s.hero && s.members.length > 1 ? `<circle r="${R + 8}" class="tk-activering"/>` : ''}
      <g transform="rotate(${facingAngle(e.facing)})">
        <path d="M ${R} 0 A ${R} ${R} 0 0 1 ${-R} 0" class="tk-backarc"/>
        <path d="M ${-R} 0 A ${R} ${R} 0 0 1 ${R} 0" class="tk-frontarc" style="stroke:${ring}"/>
        <path d="M ${-r * 0.42} ${-R - 2} L 0 ${-R - sz * 0.17} L ${r * 0.42} ${-R - 2} Z" class="tk-nose" style="fill:${ring}"/>
      </g>
      ${img && hero ? `<image href="${esc(img)}" x="${-r}" y="${-r}" width="${r * 2}" height="${r * 2}" clip-path="url(#tk-clip-${n})" preserveAspectRatio="xMidYMid slice" style="filter:${filter}"/>`
    : img ? zoomedOut(img, -r, -r, 2 * r, 2 * r, `url(#tk-clip-${n})`, filter)
      : `<circle r="${r}" class="tk-back"/><text y="${sz * 0.12}" class="tk-letter">${esc(e.name[0])}</text>`}
      <circle r="${r}" class="tk-hitflash"/>
      ${chainSvg(e, r)}
      ${hero || state !== 'unhurt' ? hpBar(-r, -R - 16, r * 2, hpFrac) : ''}
    </g>`;
  }

  /**
   * A monster's painting, zoomed out so its whole shape shows: a blurred, darkened copy fills the
   * token, and the full painting sits on top at a smaller scale with softly faded edges.
   */
  function zoomedOut(img, x, y, w, h, clip, filter) {
    const side = Math.min(w, h) * 0.86; // the whole square painting fits inside
    const ix = x + (w - side) / 2; const iy = y + (h - side) / 2;
    return `<g clip-path="${clip}">
      <image href="${esc(img)}" x="${x}" y="${y}" width="${w}" height="${h}" preserveAspectRatio="xMidYMid slice" filter="url(#tk-blur)" style="opacity:.75"/>
      <image href="${esc(img)}" x="${ix}" y="${iy}" width="${side}" height="${side}" mask="url(#tk-feather)" style="filter:${filter}"/>
    </g>`;
  }

  /**
   * A body seen from above: the sprite faces north and is turned to the creature's facing, with a
   * soft shadow so it stands out from the floor. A thin ring of its side's colour lies under it.
   */
  function bodyToken(e, d, url, hero) {
    const sz = S(); const state = woundState(e.hp, e.maxHp);
    const { ring, hpFrac, cls } = tokenLook(e, hero, state);
    const off = s.lunge?.id === e.id ? { x: s.lunge.dx * sz * 0.28, y: s.lunge.dy * sz * 0.28 } : { x: 0, y: 0 };
    const cx = (e.pos.x + d.w / 2) * sz + off.x; const cy = (e.pos.y + d.h / 2) * sz + off.y;
    // The sprite's own box when facing north (wing-spread bodies are wider than long).
    const north = dims(orientFor(e.size ?? 1, 0));
    const scale = (spanOf(e.size ?? 1) === 1 ? 1.3 : 1.04) * bodyScale(hero ? e.race : e.statId);
    const bw = north.w * sz * scale; const bh = north.h * sz * scale;
    const rx = d.w * sz * 0.46; const ry = d.h * sz * 0.46;
    const petrified = e.cond?.petrified ? 'grayscale(1) brightness(0.85)' : (hero ? 'none' : bodyTint(e.statId));
    return `<g class="${cls} tk-body" transform="translate(${cx} ${cy})">
      ${s.selectedId === e.id ? `<ellipse rx="${rx + 8}" ry="${ry + 8}" class="tk-selring"/>` : ''}
      ${s.aiming === e.id ? `<ellipse rx="${rx + 5}" ry="${ry + 5}" class="tk-aim"/>` : ''}
      ${hero && e === s.hero && s.members.length > 1 ? `<ellipse rx="${rx + 6}" ry="${ry + 6}" class="tk-activering"/>` : ''}
      <ellipse rx="${rx}" ry="${ry}" class="body-base" style="stroke:${ring}"/>
      ${auraSvg(e, rx, ry)}
      <g class="body-shadow"><g transform="rotate(${facingAngle(e.facing)})">
        <image href="${esc(url)}" x="${-bw / 2}" y="${-bh / 2}" width="${bw}" height="${bh}" class="body-img" preserveAspectRatio="xMidYMid meet" style="filter:${petrified}"/>
      </g></g>
      <ellipse rx="${rx * 0.8}" ry="${ry * 0.8}" class="tk-hitflash"/>
      ${chainSvg(e, Math.min(rx, ry))}
      ${hero || state !== 'unhurt' || e.side ? hpBar(-Math.max(rx, sz * 0.36), -ry - 16, 2 * Math.max(rx, sz * 0.36), hpFrac) : ''}
    </g>`;
  }

  function tokenLook(e, hero, state) {
    return {
      img: hero ? e.look?.url : ctx.portraitOf(e),
      filter: hero ? (e.look?.filter ?? 'none') : e.cond?.petrified ? 'grayscale(1) brightness(0.85) contrast(1.2)' : (e.portrait ? 'none' : portraitTint(e.statId)),
      ring: hero ? (e.look?.frameColor ?? '#e9c46a') : e.side === 'ally' ? '#5fbf6a' : e.side === 'captive' ? '#d4b35a' : e.calm ? '#9aa3ad' : '#c94a3a',
      hpFrac: Math.max(0, e.hp / e.maxHp),
      cls: `tk ${hero ? `tk-hero${e === s.hero && s.members.length > 1 ? ' tk-active' : ''}${e.hp <= 0 ? ' tk-down' : ''}` : `${e.side === 'ally' ? 'tk-ally' : e.side === 'captive' ? 'tk-captive' : 'tk-foe'} tk-${state}${e.cond?.petrified ? ' tk-stone' : ''}${e.calm ? ' tk-calm' : ''}`}${s.flash.has(e.id) ? ' tk-flash' : ''}${s.selectedId === e.id ? ' tk-selected' : ''}${e.size && !isSquare(e.size) ? ' tk-rect' : ''}`,
    };
  }

  const hpBar = (x, y, w, frac) => `<rect x="${x}" y="${y}" width="${w}" height="7" rx="3" class="tk-hpbg"/><rect x="${x}" y="${y}" width="${w * frac}" height="7" rx="3" class="tk-hp ${frac <= 0.5 ? 'low' : ''}"/>`;

  function auraSvg(e, hw, hh) {
    if (!e.aura || e.dead) return '';
    const sz = S(); const ex = sz * e.aura.size * 0.6;
    return `<image href="assets/vfx/${ctx.boltFor(e.aura.type).vfx}-${(Math.floor(Date.now() / 400) % 4) + 1}.jpg" x="${-(hw + ex)}" y="${-(hh + ex)}" width="${2 * (hw + ex)}" height="${2 * (hh + ex)}" class="vfx vfx-aura" preserveAspectRatio="none" mask="url(#tk-feather)"/>`;
  }

  /** A rounded-rectangle token for a long body (w x h squares). */
  function rectToken(e, d) {
    const sz = S(); const state = woundState(e.hp, e.maxHp);
    const hw = (d.w * sz) / 2 - 6; const hh = (d.h * sz) / 2 - 6; const rx = Math.min(hw, hh) * 0.4;
    const off = s.lunge?.id === e.id ? { x: s.lunge.dx * sz * 0.28, y: s.lunge.dy * sz * 0.28 } : { x: 0, y: 0 };
    const cx = (e.pos.x + d.w / 2) * sz + off.x; const cy = (e.pos.y + d.h / 2) * sz + off.y;
    const { img, filter, ring, hpFrac, cls } = tokenLook(e, false, state);
    // Facing: where a ray from the centre in the facing direction leaves the rectangle.
    const f = FACINGS[e.facing]; const len = Math.hypot(f.dx, f.dy); const ux = f.dx / len; const uy = f.dy / len;
    const t = 1 / Math.max(Math.abs(ux) / hw, Math.abs(uy) / hh);
    const nx = ux * t; const ny = uy * t; const nose = sz * 0.2; const wing = sz * 0.14;
    const box = (pad, cl) => `<rect x="${-hw - pad}" y="${-hh - pad}" width="${2 * (hw + pad)}" height="${2 * (hh + pad)}" rx="${rx + pad}" class="${cl}"/>`;
    const clip = `tkc-${e.id}`;
    return `<g class="${cls}" transform="translate(${cx} ${cy})">
      ${s.selectedId === e.id ? box(9, 'tk-selring') : ''}
      ${s.aiming === e.id ? box(6, 'tk-aim') : ''}
      ${auraSvg(e, hw, hh)}
      ${box(4, 'tk-rectback')}
      <clipPath id="${clip}" clipPathUnits="userSpaceOnUse"><rect x="${-hw}" y="${-hh}" width="${2 * hw}" height="${2 * hh}" rx="${rx}"/></clipPath>
      ${img ? zoomedOut(img, -hw, -hh, 2 * hw, 2 * hh, `url(#${clip})`, filter)
    : `<rect x="${-hw}" y="${-hh}" width="${2 * hw}" height="${2 * hh}" rx="${rx}" class="tk-back"/><text y="${sz * 0.12}" class="tk-letter">${esc(e.name[0])}</text>`}
      ${box(0, 'tk-rectframe').replace('class=', `style="stroke:${ring}" class=`)}
      <path d="M ${nx + ux * nose} ${ny + uy * nose} L ${nx - uy * wing} ${ny + ux * wing} L ${nx + uy * wing} ${ny - ux * wing} Z" class="tk-nose" style="fill:${ring}"/>
      ${box(0, 'tk-hitflash')}
      ${chainSvg(e, Math.min(hw, hh))}
      ${state !== 'unhurt' || e.side ? hpBar(-hw, -hh - 16, hw * 2, hpFrac) : ''}
    </g>`;
  }

  /** Chains for a bound creature: to the nearest wall, or a ring of shackles on the floor. */
  function chainSvg(e, r) {
    const b = e.cond?.bound; if (!b) return '';
    const sz = S(); const { w, h } = dims(e.size ?? 1);
    if (b.to === 'wall') {
      const dirs = [[0, -1], [1, 0], [0, 1], [-1, 0], [1, -1], [1, 1], [-1, 1], [-1, -1]];
      const wall = dirs.find(([dx, dy]) => { const x = e.pos.x + (dx > 0 ? w : dx), y = e.pos.y + (dy > 0 ? h : dy); return s.map.tiles[y]?.[x] === TILE.ROCK || s.map.terrain?.[y]?.[x] === 'wall'; });
      if (wall) {
        const [dx, dy] = wall; const len = sz * (dx ? w : h) / 2 + 4; const ex = dx * len; const ey = dy * len;
        return `<line x1="${dx * r * 0.5}" y1="${dy * r * 0.5}" x2="${ex}" y2="${ey}" class="tk-chain"/><line x1="${-dx * r * 0.2 + dy * r * 0.6}" y1="${-dy * r * 0.2 + dx * r * 0.6}" x2="${ex + dy * 8}" y2="${ey + dx * 8}" class="tk-chain"/>`;
      }
    }
    return `<circle r="${r + 6}" class="tk-chain tk-chain-ring"/>`;
  }

  function drawDoors() {
    const sz = S(); let out = '';
    for (const d of s.map.doors) {
      const k = cellKey(d.x, d.y);
      const cx = (d.x + 0.5) * sz; const cy = (d.y + 0.5) * sz;
      if (ctx.isSecret(k)) {
        // An undiscovered secret door looks like solid rock (the narrator view shows it dashed).
        out += `<rect x="${d.x * sz}" y="${d.y * sz}" width="${sz}" height="${sz}" class="secret-cover" style="fill:url(#dg-rock)"/>`;
        if (s.revealAll) out += `<rect x="${d.x * sz + 6}" y="${d.y * sz + 6}" width="${sz - 12}" height="${sz - 12}" rx="6" class="secret-hint"/>`;
        continue;
      }
      if (!s.revealAll && !s.revealed.has(k)) continue;
      if (ctx.isLocked(k)) out += `<text x="${cx}" y="${cy - sz * 0.32}" class="lock-glyph">🔒</text>`;
      const open = s.doors.get(k);
      // Door 'h' is walked through east-west: the slab stands north-south when closed.
      if (!open) {
        const vertical = d.orientation === 'h';
        const w = vertical ? sz * 0.26 : sz * 0.94; const h = vertical ? sz * 0.94 : sz * 0.26;
        out += `<rect x="${cx - w / 2}" y="${cy - h / 2}" width="${w}" height="${h}" rx="3" class="door-closed"/>`;
        out += vertical ? `<line x1="${cx}" y1="${cy - h / 2 + 6}" x2="${cx}" y2="${cy + h / 2 - 6}" class="door-plank"/>` : `<line x1="${cx - w / 2 + 6}" y1="${cy}" x2="${cx + w / 2 - 6}" y2="${cy}" class="door-plank"/>`;
      } else {
        // Open: the slab swings against the wall at one edge of the doorway.
        const vertical = d.orientation === 'h';
        const x = vertical ? cx - sz * 0.47 : cx - sz * 0.47; const y = vertical ? cy - sz * 0.47 : cy - sz * 0.47;
        out += vertical ? `<rect x="${x}" y="${y}" width="${sz * 0.94}" height="${sz * 0.14}" rx="3" class="door-open"/>` : `<rect x="${x}" y="${y}" width="${sz * 0.14}" height="${sz * 0.94}" rx="3" class="door-open"/>`;
      }
    }
    return out;
  }

  /** Chests, known traps, and searchable bodies. */
  function drawFeatures() {
    const sz = S(); let out = '';
    const shown = (x, y) => s.revealAll || s.revealed.has(cellKey(x, y));
    for (const c of s.features.chests) {
      if (!shown(c.x, c.y)) continue;
      const x = c.x * sz; const y = c.y * sz; const empty = c.opened && !c.loot?.coins && !c.loot?.items.length;
      out += `<g class="chest ${c.opened ? 'open' : ''} ${empty ? 'empty' : ''} ${s.target?.kind === 'chest' && s.target.id === c.id ? 'sel' : ''}" transform="translate(${x} ${y})">
        <rect x="${sz * 0.14}" y="${sz * 0.36}" width="${sz * 0.72}" height="${sz * 0.44}" rx="5" class="chest-body"/>
        ${c.opened ? `<rect x="${sz * 0.14}" y="${sz * 0.16}" width="${sz * 0.72}" height="${sz * 0.18}" rx="4" class="chest-lid"/>`
    : `<path d="M ${sz * 0.14} ${sz * 0.4} Q ${sz * 0.5} ${sz * 0.1} ${sz * 0.86} ${sz * 0.4} Z" class="chest-lid"/>`}
        <rect x="${sz * 0.14}" y="${sz * 0.5}" width="${sz * 0.72}" height="${sz * 0.07}" class="chest-band"/>
        ${c.locked ? `<rect x="${sz * 0.44}" y="${sz * 0.46}" width="${sz * 0.12}" height="${sz * 0.16}" rx="2" class="chest-lock"/>` : ''}
        ${!empty && c.opened ? `<circle cx="${sz * 0.5}" cy="${sz * 0.32}" r="${sz * 0.07}" class="chest-gold"/>` : ''}
      </g>`;
    }
    for (const t of s.features.traps) {
      if (!(t.found || s.revealAll) || !shown(t.x, t.y)) continue;
      const cx = (t.x + 0.5) * sz; const cy = (t.y + 0.5) * sz; const r = sz * 0.3;
      const cls = t.disarmed ? 'disarmed' : t.sprung ? 'sprung' : t.found ? 'armed' : 'hidden';
      out += `<g class="trap ${cls} ${s.target?.kind === 'trap' && s.target.id === t.id ? 'sel' : ''}"><path d="M ${cx} ${cy - r} L ${cx + r} ${cy + r * 0.8} L ${cx - r} ${cy + r * 0.8} Z" class="trap-tri"/>
        <text x="${cx}" y="${cy + r * 0.55}" class="trap-mark">${t.disarmed ? '✓' : t.sprung ? '✕' : '!'}</text></g>`;
    }
    for (const m of s.monsters) {
      if (!m.dead || !m.loot || (!m.loot.coins && !m.loot.items.length) || !shown(m.pos.x, m.pos.y)) continue;
      out += `<text x="${(m.pos.x + 0.78) * sz}" y="${(m.pos.y + 0.35) * sz}" class="loot-sack">💰</text>`;
    }
    return out;
  }

  function drawFog() {
    if (s.revealAll) return '';
    const sz = S(); const W = s.map.width; const H = s.map.height;
    const shown = (x, y) => {
      if (s.revealed.has(cellKey(x, y))) return true;
      if (s.map.tiles[y][x] !== TILE.ROCK) return false;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx; const ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < W && ny < H && s.map.tiles[ny][nx] !== TILE.ROCK && s.revealed.has(cellKey(nx, ny))) return true;
      }
      return false;
    };
    let dark = ''; let dim = '';
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const k = cellKey(x, y);
        if (!shown(x, y)) dark += `M${x * sz} ${y * sz}h${sz}v${sz}h${-sz}z`;
        else if (!s.visible.has(k) && s.map.tiles[y][x] !== TILE.ROCK) dim += `M${x * sz} ${y * sz}h${sz}v${sz}h${-sz}z`;
      }
    }
    return `<path d="${dim}" class="fog-dim"/><path d="${dark}" class="fog-dark"/>`;
  }

  function drawOverlay() {
    if (!s.hero) { overlay.innerHTML = ''; return; }
    const sz = S(); let out = `<defs>${[1, 2, 3, 4].map((n) => `<clipPath id="tk-clip-${n}" clipPathUnits="userSpaceOnUse"><circle r="${sz * (n > 1 ? 0.44 : 0.36) * n}"/></clipPath>`).join('')}
      <filter id="tk-blur" x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur stdDeviation="7"/><feComponentTransfer><feFuncR type="linear" slope=".55"/><feFuncG type="linear" slope=".55"/><feFuncB type="linear" slope=".55"/></feComponentTransfer></filter>
      <radialGradient id="tk-feather-grad"><stop offset=".62" stop-color="#fff"/><stop offset="1" stop-color="#000"/></radialGradient>
      <mask id="tk-feather" maskContentUnits="objectBoundingBox"><rect width="1" height="1" fill="url(#tk-feather-grad)"/></mask>
      <radialGradient id="blood-grad"><stop offset="0" stop-color="#fff" stop-opacity="1"/><stop offset="0.55" stop-color="#fff" stop-opacity="0.85"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
      <radialGradient id="bl-red"><stop offset="0" stop-color="#a3121a"/><stop offset=".65" stop-color="#7a0910"/><stop offset="1" stop-color="#4d0408" stop-opacity=".85"/></radialGradient>
      <radialGradient id="bl-black"><stop offset="0" stop-color="#2c2427"/><stop offset=".65" stop-color="#151012"/><stop offset="1" stop-color="#080607" stop-opacity=".85"/></radialGradient>
      <radialGradient id="bl-green"><stop offset="0" stop-color="#6b8f1f"/><stop offset=".65" stop-color="#456614"/><stop offset="1" stop-color="#25380a" stop-opacity=".85"/></radialGradient>
      <mask id="blood-mask" maskContentUnits="objectBoundingBox"><ellipse cx="0.5" cy="0.5" rx="0.5" ry="0.36" fill="url(#blood-grad)"/><ellipse cx="0.62" cy="0.42" rx="0.22" ry="0.3" fill="url(#blood-grad)"/></mask></defs>`;
    out += ctx.drawBlood();
    for (const fx of s.effects) {
      if (fx.kind !== 'ice' && fx.kind !== 'rubble') continue;
      for (const c of fx.cells) {
        if (!s.revealAll && !s.revealed.has(cellKey(c.x, c.y))) continue;
        const n = ((c.x * 7 + c.y * 3) % 4) + 1;
        out += fx.kind === 'ice'
          ? `<image href="assets/terrain/snow-${n}.jpg" x="${c.x * sz}" y="${c.y * sz}" width="${sz}" height="${sz}" class="ground-ice" preserveAspectRatio="xMidYMid slice"/>`
          : `<image href="assets/textures/rock-bedrock.jpg" x="${c.x * sz - sz * 0.1}" y="${c.y * sz - sz * 0.1}" width="${sz * 1.2}" height="${sz * 1.2}" mask="url(#blood-mask)" class="ground-rubble" transform="rotate(${(c.x * 53 + c.y * 31) % 360} ${(c.x + 0.5) * sz} ${(c.y + 0.5) * sz})" preserveAspectRatio="xMidYMid slice"/>`;
      }
    }
    out += drawDoors();
    // Reachable squares
    for (const c of s.reach.values()) if (c.cost > 0) out += `<rect x="${c.x * sz + 4}" y="${c.y * sz + 4}" width="${sz - 8}" height="${sz - 8}" rx="7" class="dg-reach"/>`;
    out += drawFog();
    out += drawFeatures();
    // Hover: path preview, or attack preview on a monster
    const hov = s.hover;
    const foe = hov && ctx.foes().find((m) => covers(m, hov) && ctx.canSee(m));
    if (foe && !s.busy) {
      const plan = ctx.heroAttackPlan(foe);
      out += `<rect x="${foe.pos.x * sz + 2}" y="${foe.pos.y * sz + 2}" width="${sz - 4}" height="${sz - 4}" rx="9" class="${plan && !s.actionUsed ? 'dg-attack' : 'dg-noattack'}"/>`;
      if (plan) out += `<line x1="${(s.hero.pos.x + 0.5) * sz}" y1="${(s.hero.pos.y + 0.5) * sz}" x2="${(foe.pos.x + 0.5) * sz}" y2="${(foe.pos.y + 0.5) * sz}" class="dg-aim"/>`;
    } else if (hov) {
      const t = s.reach.get(cellKey(hov.x, hov.y));
      if (t && t.cost > 0) {
        out += `<polyline points="${t.path.map((p) => `${(p.x + 0.5) * sz},${(p.y + 0.5) * sz}`).join(' ')}" class="dg-path"/>`;
        out += `<rect x="${t.x * sz + 2}" y="${t.y * sz + 2}" width="${sz - 4}" height="${sz - 4}" rx="7" class="dg-target-sq"/>`;
        out += `<text x="${(t.x + 0.5) * sz}" y="${(t.y + 0.5) * sz + 9}" class="dg-cost">${t.cost * s.map.feetPerCell}</text>`;
      } else if (s.revealed.has(cellKey(hov.x, hov.y)) || s.revealAll) {
        out += `<rect x="${hov.x * sz + 2}" y="${hov.y * sz + 2}" width="${sz - 4}" height="${sz - 4}" rx="7" class="dg-hover"/>`;
      }
    }
    // Tokens
    // The fallen first, so the living stand over them.
    for (const m of s.monsters) if (m.dead && (ctx.canSee(m) || s.revealAll || s.revealed.has(cellKey(m.pos.x, m.pos.y)))) out += remains(m);
    for (const m of s.monsters) if (!m.dead && ctx.canSee(m)) out += token(m);
    for (const h of ctx.party()) if (h !== s.hero) out += token(h, { hero: true });
    if (s.hero) out += token(s.hero, { hero: true });
    // Arrow in flight
    if (s.projectile) {
      const { from, to, t, color, shape } = s.projectile;
      const x0 = (from.x + 0.5) * sz; const y0 = (from.y + 0.5) * sz; const x1 = (to.x + 0.5) * sz; const y1 = (to.y + 0.5) * sz;
      const x = x0 + (x1 - x0) * t; const y = y0 + (y1 - y0) * t; const ang = Math.atan2(y1 - y0, x1 - x0) * 180 / Math.PI;
      out += `<line x1="${x0}" y1="${y0}" x2="${x}" y2="${y}" class="dg-proj-trail ${color ? 'magic' : ''}" style="${color ? `stroke:${color}` : ''}"/>`;
      if (color) out += `<g class="dg-proj-head" transform="translate(${x} ${y}) rotate(${ang})"><circle r="20" class="dg-bolt-glow" style="fill:${color}"/><circle r="11" class="dg-bolt" style="fill:${color}"/><circle r="5" fill="#fff"/></g>`;
      else if (shape === 'stone') out += `<g class="dg-proj-head" transform="translate(${x} ${y}) rotate(${ang})"><ellipse rx="15" ry="13" class="dg-stone"/><ellipse rx="5" ry="4" cx="-4" cy="-4" fill="#9a9389"/></g>`;
      else out += `<g class="dg-proj-head dg-arrow" transform="translate(${x} ${y}) rotate(${ang})"><line x1="-34" y1="0" x2="0" y2="0"/><path d="M 0 0 L -12 -6 L -12 6 Z"/><path d="M -34 0 L -42 -6 M -34 0 L -42 6"/></g>`;
    }
    for (const fx of s.effects) for (const c of fx.cells) {
      const n = ((c.x * 7 + c.y * 3) % 4) + 1;
      if (fx.kind === 'firewall') out += `<image href="assets/vfx/firewall-${n}.jpg" x="${c.x * sz - sz * 0.15}" y="${c.y * sz - sz * 0.35}" width="${sz * 1.3}" height="${sz * 1.3}" class="vfx vfx-persist" preserveAspectRatio="xMidYMid slice"/>`;
      else if (fx.kind === 'fire') out += `<image href="assets/vfx/fire-${n}.jpg" x="${c.x * sz - sz * 0.1}" y="${c.y * sz - sz * 0.1}" width="${sz * 1.2}" height="${sz * 1.2}" class="vfx vfx-persist vfx-embers" preserveAspectRatio="xMidYMid slice"/>`;
      else if (fx.kind === 'poison') out += `<image href="assets/vfx/poison-${n}.jpg" x="${c.x * sz - sz * 0.2}" y="${c.y * sz - sz * 0.2}" width="${sz * 1.4}" height="${sz * 1.4}" class="vfx vfx-persist vfx-cloud" preserveAspectRatio="xMidYMid slice"/>`;
    }
    if (s.areaFx) for (const c of s.areaFx.cells) {
      out += `<image href="assets/vfx/${s.areaFx.kind}-${((c.x * 5 + c.y * 3) % 4) + 1}.jpg" x="${c.x * sz - sz * 0.2}" y="${c.y * sz - sz * 0.2}" width="${sz * 1.4}" height="${sz * 1.4}" class="vfx vfx-burst" preserveAspectRatio="xMidYMid slice"/>`;
    }
    for (const v of s.vfx) {
      const span = (2 * v.r + 1.4) * sz;
      out += `<image href="assets/vfx/${v.kind}-${v.n}.jpg" x="${(v.x + 0.5) * sz - span / 2}" y="${(v.y + 0.5) * sz - span / 2}" width="${span}" height="${span}" class="vfx vfx-burst" preserveAspectRatio="xMidYMid slice"/>`;
    }
    if (s.blast) {
      const b = s.blast;
      out += `<rect x="${(b.x - b.r) * sz}" y="${(b.y - b.r) * sz}" width="${(2 * b.r + 1) * sz}" height="${(2 * b.r + 1) * sz}" rx="${sz}" class="dg-blast" style="fill:${b.color};stroke:${b.color}"/>`;
    }
    if (s.pending) {
      const item = ctx.findMagic(s.pending.id); const r = item?.range ?? 0;
      out += `<rect x="${(s.hero.pos.x - r) * sz}" y="${(s.hero.pos.y - r) * sz}" width="${(2 * r + 1) * sz}" height="${(2 * r + 1) * sz}" class="dg-range"/>`;
    }
    // Floating numbers
    for (const f of s.floats) out += `<text x="${(f.x + 0.5) * sz}" y="${f.y * sz}" class="dg-float ${f.kind} ${f.big ? 'big' : ''}">${esc(f.text)}</text>`;
    overlay.innerHTML = out;
  }

  return { redraw, token, zoomedOut, bodyToken, tokenLook, hpBar, auraSvg, rectToken, chainSvg, drawDoors, drawFeatures, drawFog, drawOverlay };
}
