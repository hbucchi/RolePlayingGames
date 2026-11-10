/**
 * Dungeon delve: fog of war, line of sight, facing, and turn-based battles with goblins.
 *
 * The base map (textures, walls, grid) is drawn once per dungeon. Everything that changes
 * (doors, fog, highlights, tokens, damage numbers) lives in a light SVG overlay redrawn
 * after every step.
 */
import { generateDungeon, roomAt, TILE } from '../engine/dungeon.js';
import { renderDungeonSVG } from '../engine/dungeon-render.js';
import { reachableSquares, speedToSquares, DIAGONAL_RULES, cellKey } from '../engine/movement.js';
import { makeOpacity, visibleSquares, revealFrom } from '../engine/vision.js';
import {
  FACINGS, facingToward, rotateFacing, facingAngle, chebyshev, weaponFromHeroAttack, placeMonsters,
  rollInitiative, planMonsterTurn, attackOptions, resolveAttack, woundState,
} from '../engine/combat.js';
import { BESTIARY_BY_ID } from '../content/bestiary/index.js';
import { monsterPortrait } from '../content/media.js';
import { play, preload, monsterVoice, SOUND_KEYS } from './audio.js';
import { formatModifier } from '../engine/abilities.js';
import { sensesText } from '../engine/monsters.js';
import { rollDie } from '../engine/dice.js';

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const STEP_MS = reduceMotion ? 0 : 110;
const PAUSE_MS = reduceMotion ? 0 : 420;
const pct = (p) => `${Math.round(p * 100)}%`;
const signed = (n) => (n >= 0 ? `+${n}` : `${n}`);

/**
 * @param {HTMLElement} host
 * @param {{heroes: object[], initialSeed?: number}} opts
 */
export function mountDungeon(host, { heroes, initialSeed = 7 }) {
  const goblinStat = BESTIARY_BY_ID.goblin;
  const s = {
    seed: initialSeed, map: null, grid: true, revealAll: false, rule: 'standard', zoom: 0.5,
    heroId: heroes[0]?.id ?? null, hero: null, monsters: [],
    doors: new Map(), revealed: new Set(), visible: new Set(),
    mode: 'explore', round: 0, order: [], turnIdx: 0,
    moveLeft: 0, actionUsed: false, dash: false, weaponIdx: 0,
    hover: null, busy: false, log: [], floats: [], reach: new Map(),
    selectedId: null, knowledge: {}, knownHp: new Set(), lunge: null, flash: new Set(), projectile: null, lastStudy: null,
  };

  host.innerHTML = `
    <div class="dg-topbar">
      <div class="dg-group">
        ${heroes.length ? `<select id="dg-hero" data-dg="hero" aria-label="Hero">${heroes.map((h) => `<option value="${esc(h.id)}">${esc(h.label)}</option>`).join('')}</select>` : ''}
      </div>
      <div class="dg-group">
        <button class="btn small ghost" data-dg="seed-prev" aria-label="Previous dungeon">◀</button>
        <label class="dg-seed" for="dg-seed">Dungeon #</label><input id="dg-seed" type="number" min="1" max="999999" data-dg="seed">
        <button class="btn small ghost" data-dg="seed-next" aria-label="Next dungeon">▶</button>
        <button class="btn small" data-dg="random">New dungeon</button>
      </div>
      <div class="dg-group">
        <button class="btn small ghost" data-dg="zoom-out" aria-label="Zoom out">−</button>
        <span class="dg-zoom" aria-live="polite"></span>
        <button class="btn small ghost" data-dg="zoom-in" aria-label="Zoom in">+</button>
        <button class="btn small ghost" data-dg="fit">Fit</button>
        <button class="btn small ghost" data-dg="center">Find hero</button>
      </div>
      <div class="dg-group">
        <label class="dg-check"><input id="dg-grid" type="checkbox" data-dg="grid" checked> Grid</label>
        <label class="dg-check" title="Narrator view: show the whole map and every monster"><input id="dg-reveal" type="checkbox" data-dg="reveal"> Reveal map</label>
      </div>
    </div>
    <div class="dg-layout">
      <div class="dg-mapwrap">
        <div class="dg-banner" aria-live="polite"></div>
        <div class="dg-viewport" tabindex="0" aria-label="Dungeon map. Drag to pan, scroll or pinch to zoom.">
          <div class="dg-stage">
            <div class="dg-base"></div>
            <svg class="dg-overlay" xmlns="http://www.w3.org/2000/svg"></svg>
          </div>
        </div>
        <p class="dg-help muted small">Click a lit square to move · click a goblin to select it, click again to attack · drag to pan · scroll or pinch to zoom · Q / E turn your hero</p>
      </div>
      <aside class="dg-panel">
        <section class="dg-herocard"></section>
        <section class="dg-target" aria-live="polite"></section>
        <section class="dg-initiative"></section>
        <section class="dg-logbox"><h3>Battle log</h3><ol class="dg-log"></ol></section>
      </aside>
    </div>
    <div class="dg-endscreen" hidden></div>`;

  const $ = (sel) => host.querySelector(sel);
  const viewport = $('.dg-viewport'); const stage = $('.dg-stage');
  const base = $('.dg-base'); const overlay = $('.dg-overlay');
  const S = () => s.map.cellSize;

  // ---------------------------------------------------------------------------
  // Setup
  // ---------------------------------------------------------------------------

  function heroDef() { return heroes.find((h) => h.id === s.heroId) ?? heroes[0]; }

  function newDungeon(seed) {
    s.seed = Math.max(1, Math.floor(seed) || 1);
    s.map = generateDungeon(s.seed);
    $('#dg-seed').value = s.seed;
    base.innerHTML = renderDungeonSVG(s.map, { grid: s.grid, labels: true, doors: false });
    overlay.setAttribute('viewBox', `0 0 ${s.map.width * S()} ${s.map.height * S()}`);
    resetDelve();
    // Start close to the hero: a fresh map is mostly unexplored darkness anyway.
    requestAnimationFrame(() => { setZoom(0.9); centerOn(s.hero.pos, false); });
  }

  function resetDelve() {
    const h = heroDef();
    const weapons = (h?.attacks ?? []).map(weaponFromHeroAttack);
    s.hero = h ? {
      id: 'hero', name: h.name, pos: { x: s.map.entrance.x, y: s.map.entrance.y }, facing: 0,
      hp: h.maxHp, maxHp: h.maxHp, ac: h.ac, dexMod: h.dexMod, speed: speedToSquares(h.speed, s.map.feetPerCell),
      weapons, reaction: true, aware: true,
      look: h.look, voice: h.look?.voice ?? 'low', skills: h.skills ?? {},
    } : null;
    s.weaponIdx = Math.max(0, weapons.findIndex((w) => w.melee));
    s.monsters = placeMonsters(s.map, goblinStat, s.seed);
    s.doors = new Map(); s.revealed = new Set(); s.log = []; s.floats = [];
    s.selectedId = null; s.knowledge = {}; s.knownHp = new Set(); s.lastStudy = null;
    s.mode = 'explore'; s.order = []; s.round = 0; s.busy = false;
    $('.dg-endscreen').hidden = true;
    startHeroTurn();
    log(`${s.hero?.name ?? 'Your hero'} descends the stairs into dungeon #${s.seed}. ${s.monsters.length} goblins lurk somewhere below.`, 'info');
    updateVision();
    redraw();
  }

  // ---------------------------------------------------------------------------
  // Vision and fog
  // ---------------------------------------------------------------------------

  const opaque = () => makeOpacity(s.map, s.doors);
  const alive = () => s.monsters.filter((m) => !m.dead);
  const occupied = (except) => new Set([s.hero, ...alive()].filter((e) => e && e !== except).map((e) => cellKey(e.pos.x, e.pos.y)));
  const canSee = (m) => s.revealAll || s.visible.has(cellKey(m.pos.x, m.pos.y));

  /** Recompute what the hero sees; returns monsters that just noticed the hero. */
  function updateVision() {
    s.visible = visibleSquares(s.map, s.hero.pos, opaque());
    revealFrom(s.map, s.visible, s.revealed);
    const spotted = [];
    for (const m of alive()) {
      if (!m.aware && s.visible.has(cellKey(m.pos.x, m.pos.y))) { m.aware = true; spotted.push(m); }
    }
    return spotted;
  }

  // ---------------------------------------------------------------------------
  // Turns
  // ---------------------------------------------------------------------------

  function startHeroTurn() {
    s.moveLeft = s.hero ? s.hero.speed : 0;
    s.actionUsed = false; s.dash = false;
    if (s.hero) s.hero.reaction = true;
  }

  function enterCombat(spotted) {
    const names = spotted.length === 1 ? 'A goblin' : `${spotted.length} goblins`;
    const isNew = s.mode !== 'combat';
    if (isNew) {
      s.mode = 'combat'; s.round = 1;
      const heroInit = rollInitiative(s.hero.dexMod);
      s.order = [{ id: 'hero', init: heroInit.total, roll: heroInit.d20 }];
      log(`${names} spotted! Roll for initiative. ${s.hero.name}: d20 (${heroInit.d20}) ${signed(s.hero.dexMod)} = ${heroInit.total}.`, 'warn');
    } else {
      log(`${names} join the fight!`, 'warn');
    }
    for (const m of spotted) {
      const r = rollInitiative(m.dexMod);
      s.order.push({ id: m.id, init: r.total, roll: r.d20 });
    }
    s.order.sort((a, b) => b.init - a.init || (a.id === 'hero' ? -1 : 1));
    if (isNew) {
      // New combat: monsters that beat the hero's initiative act first.
      startHeroTurn();
      if (s.order[0].id !== 'hero') runMonsterTurns(true);
    }
  }

  function checkCombatOver() {
    if (s.mode === 'combat' && !alive().some((m) => m.aware)) {
      s.mode = 'explore'; s.order = [];
      log('The fight is over. You can explore freely again.', 'good');
      startHeroTurn();
      if (!alive().length) showEnd('victory');
    }
  }

  async function endHeroTurn() {
    if (s.mode !== 'combat' || s.busy) return;
    await runMonsterTurns();
  }

  /**
   * Run monster turns in initiative order until it is the hero's turn again.
   * fromStart: begin at the top of the order (a fresh combat where goblins won initiative);
   * otherwise begin just after the hero. Wrapping past the end starts a new round.
   */
  async function runMonsterTurns(fromStart = false) {
    s.busy = true; redraw();
    const heroIdx = s.order.findIndex((o) => o.id === 'hero');
    let i = fromStart ? 0 : heroIdx + 1;
    for (let guard = 0; guard < s.order.length; guard++, i++) {
      if (i >= s.order.length) { i = 0; s.round++; }
      const slot = s.order[i];
      if (slot.id === 'hero') break;
      const m = s.monsters.find((x) => x.id === slot.id);
      if (!m || m.dead || !m.aware) continue;
      await monsterTurn(m);
      if (s.hero.hp <= 0) { s.busy = false; showEnd('defeat'); return; }
    }
    s.order = s.order.filter((o) => o.id === 'hero' || !s.monsters.find((m) => m.id === o.id)?.dead);
    s.busy = false;
    startHeroTurn();
    banner(`Round ${s.round}: your turn`);
    // Goblins that noticed the hero during the enemy turns join the fight now.
    const late = alive().filter((m) => m.aware && !s.order.some((o) => o.id === m.id));
    if (late.length) enterCombat(late);
    checkCombatOver();
    redraw();
  }

  async function monsterTurn(m) {
    m.reaction = true;
    banner(`${m.name}'s turn`);
    const plan = planMonsterTurn({ m, hero: s.hero, map: s.map, opaque: opaque(), blocked: occupied(m) });
    let disengaged = false;
    for (const step of plan) {
      if (step.type === 'disengage') { disengaged = true; if (canSee(m)) log(`${m.name} slips away nimbly (Nimble Escape: Disengage).`, 'info'); }
      if (step.type === 'move') {
        for (const p of step.path.slice(1)) {
          const wasAdjacent = chebyshev(m.pos, s.hero.pos) <= 1;
          m.facing = facingToward(m.pos, p);
          m.pos = { x: p.x, y: p.y };
          openDoorAt(p);
          if (wasAdjacent && chebyshev(m.pos, s.hero.pos) > 1 && !disengaged && s.hero.reaction) await heroOpportunityAttack(m);
          if (m.dead) return;
          updateVision(); redraw(); await sleep(STEP_MS);
        }
      }
      if (step.type === 'attack') {
        m.facing = facingToward(m.pos, s.hero.pos);
        await doAttack(m, s.hero, step.weapon);
        if (s.hero.hp <= 0) return;
      }
    }
    await sleep(PAUSE_MS / 2);
  }

  // ---------------------------------------------------------------------------
  // Movement
  // ---------------------------------------------------------------------------

  function openDoorAt(p) {
    if (s.map.tiles[p.y][p.x] === TILE.DOOR && !s.doors.get(cellKey(p.x, p.y))) {
      s.doors.set(cellKey(p.x, p.y), true);
      play('door-open', { volume: 0.7 });
    }
  }

  function heroReach() {
    if (!s.hero || s.busy || s.mode === 'defeat') return new Map();
    const blocked = occupied(s.hero);
    if (!s.revealAll) {
      // You can only walk into squares you have discovered.
      for (let y = 0; y < s.map.height; y++) for (let x = 0; x < s.map.width; x++) if (!s.revealed.has(cellKey(x, y))) blocked.add(cellKey(x, y));
    }
    return reachableSquares(s.map, s.hero.pos, s.moveLeft, { diagonalRule: s.rule, blocked });
  }

  async function moveHero(target) {
    s.busy = true;
    const costAt = (p) => s.reach.get(cellKey(p.x, p.y))?.cost ?? target.cost;
    for (const p of target.path.slice(1)) {
      const before = { ...s.hero.pos };
      const threats = alive().filter((m) => m.aware && m.reaction && chebyshev(m.pos, before) <= 1);
      s.hero.facing = facingToward(before, p);
      s.hero.pos = { x: p.x, y: p.y };
      openDoorAt(p);
      for (const m of threats) {
        if (chebyshev(m.pos, s.hero.pos) > 1) await monsterOpportunityAttack(m);
        if (s.hero.hp <= 0) { s.busy = false; showEnd('defeat'); return; }
      }
      const spotted = updateVision();
      redraw(); await sleep(STEP_MS);
      if (spotted.length) {
        s.moveLeft = Math.max(0, s.moveLeft - costAt(p));
        s.busy = false;
        enterCombat(spotted);
        redraw();
        return;
      }
    }
    s.moveLeft = s.mode === 'combat' ? Math.max(0, s.moveLeft - target.cost) : s.hero.speed;
    s.busy = false;
    redraw();
    keepInView(s.hero.pos);
  }

  // ---------------------------------------------------------------------------
  // Attacks
  // ---------------------------------------------------------------------------

  const enemiesOf = (who) => (who === s.hero ? alive().filter((m) => m.aware) : [s.hero]);

  /** Pick the hero weapon to use against a target: the selected one if it works, else any that does. */
  function heroAttackPlan(target) {
    const args = (w) => ({ attacker: s.hero, target, weapon: w, opaque: opaque(), occupied: occupied(), enemiesOf });
    const sel = s.hero.weapons[s.weaponIdx];
    const order = [sel, ...s.hero.weapons.filter((w) => w !== sel)];
    const adjacent = chebyshev(s.hero.pos, target.pos) <= 1;
    // Next to the target, prefer a melee weapon (shooting point-blank has disadvantage).
    if (adjacent) order.sort((a, b) => Number(b.melee) - Number(a.melee) || (a === sel ? -1 : 1));
    for (const w of order) {
      const o = attackOptions(args(w));
      if (o) return { weapon: w, opts: o };
    }
    return null;
  }

  function whyNot(target) {
    const d = chebyshev(s.hero.pos, target.pos);
    const maxRange = Math.max(0, ...s.hero.weapons.filter((w) => w.ranged).map((w) => w.long));
    if (!s.visible.has(cellKey(target.pos.x, target.pos.y))) return 'You can\'t see it.';
    if (d > 1 && !maxRange) return 'Too far for a melee weapon. Move next to it first.';
    if (d > maxRange) return `Out of range (${d * 5} ft).`;
    return 'No clear line of sight.';
  }

  async function heroAttack(target, weaponIdx = null) {
    if (s.actionUsed) { banner('You have already used your action this turn.'); return; }
    let plan = heroAttackPlan(target);
    if (weaponIdx !== null) {
      const w = s.hero.weapons[weaponIdx];
      const o = attackOptions({ attacker: s.hero, target, weapon: w, opaque: opaque(), occupied: occupied(), enemiesOf });
      plan = o ? { weapon: w, opts: o } : null;
    }
    if (!plan) { banner(whyNot(target)); return; }
    s.busy = true;
    s.hero.facing = facingToward(s.hero.pos, target.pos);
    await doAttack(s.hero, target, plan.weapon);
    target.aware = true;
    s.actionUsed = s.mode === 'combat';
    s.busy = false;
    checkCombatOver();
    redraw();
  }

  async function heroOpportunityAttack(m) {
    const melee = s.hero.weapons.find((w) => w.melee);
    if (!melee) return;
    s.hero.reaction = false;
    log(`${m.name} moves away; ${s.hero.name} takes an opportunity attack!`, 'info');
    await doAttack(s.hero, m, melee, { reaction: true, from: { ...m.pos } });
  }

  async function monsterOpportunityAttack(m) {
    const melee = m.weapons.find((w) => w.melee);
    if (!melee) return;
    m.reaction = false;
    log(`${s.hero.name} leaves ${m.name}'s reach: opportunity attack!`, 'warn');
    await doAttack(m, s.hero, melee, { reaction: true });
  }

  /** Voice family for sounds: the hero's chosen voice, or goblin / boss by monster size. */
  const voiceOf = (e) => (e === s.hero ? `hero-${s.hero.voice}` : monsterVoice(BESTIARY_BY_ID[e.statId]?.size));
  const cry = (e, what) => {
    const v = voiceOf(e);
    if (v.startsWith('hero')) return `${v}-${what}`;
    if (v === 'goblin') return `goblin-${what}`;
    return what === 'attack' ? 'boss-roar' : 'boss-hurt';
  };

  /** Animate an arrow flying from one square to another. */
  async function shootProjectile(from, to) {
    const frames = reduceMotion ? 1 : 9;
    for (let i = 1; i <= frames; i++) {
      s.projectile = { from, to, t: i / frames };
      drawOverlay();
      await sleep(reduceMotion ? 0 : 26);
    }
    s.projectile = null;
  }

  /** Lean the attacker toward its target for a moment. */
  async function lunge(attacker, target) {
    if (reduceMotion) return;
    const dx = Math.sign(target.pos.x - attacker.pos.x); const dy = Math.sign(target.pos.y - attacker.pos.y);
    s.lunge = { id: attacker.id, dx, dy }; drawOverlay(); await sleep(120);
    s.lunge = null; drawOverlay();
  }

  function flashHit(e) {
    s.flash.add(e.id); drawOverlay();
    setTimeout(() => { s.flash.delete(e.id); drawOverlay(); }, 450);
    if (e === s.hero && !reduceMotion) {
      viewport.classList.remove('shake'); void viewport.offsetWidth; viewport.classList.add('shake');
      setTimeout(() => viewport.classList.remove('shake'), 450);
    }
  }

  /** Roll an attack with sound and motion, apply damage, write the log, float a number. */
  async function doAttack(attacker, target, weapon, { reaction = false } = {}) {
    let opts = attackOptions({ attacker, target, weapon, opaque: opaque(), occupied: occupied(), enemiesOf });
    if (!opts && reaction) opts = { ac: target.ac, mode: 'normal', adv: [], dis: [], cover: 'none', chance: 0 }; // reach was valid a moment ago
    if (!opts) return;
    const ranged = opts.ranged || (weapon.ranged && !weapon.melee);
    // Wind-up: battle cry, then the weapon.
    if (attacker === s.hero || Math.random() < 0.6) play(cry(attacker, 'attack'), { volume: 0.75 });
    if (ranged) { play('bow-shot', { volume: 0.8 }); await shootProjectile(attacker.pos, target.pos); } else { await lunge(attacker, target); }

    const r = resolveAttack({ weapon, ac: opts.ac, mode: opts.mode });
    const who = attacker === s.hero ? s.hero.name : attacker.name;
    const whom = target === s.hero ? s.hero.name : target.name;
    const dice = r.d20s.length > 1 ? `d20 (${r.d20s.join(', ')} → ${r.d20})` : `d20 (${r.d20})`;
    const why = [...opts.adv.map((a) => `advantage: ${a}`), ...opts.dis.map((d) => `disadvantage: ${d}`), opts.cover === 'half' ? 'half cover +2 AC' : null].filter(Boolean);
    let line = `${who} ${ranged ? 'shoots' : 'attacks'} ${whom} with ${weapon.name}: ${dice} ${signed(weapon.toHit)} = ${r.total} vs AC ${opts.ac}${why.length ? ` (${why.join('; ')})` : ''}.`;
    if (r.hit) {
      target.hp = Math.max(0, target.hp - r.damage);
      line += ` ${r.crit ? 'CRITICAL HIT! ' : 'Hit! '}${r.damage} ${weapon.type} damage${r.damageRoll ? ` [${r.damageRoll.rolls.join(', ')}${r.damageRoll.modifier ? ` ${signed(r.damageRoll.modifier)}` : ''}]` : ''}.`;
      float(target.pos, `−${r.damage}`, target === s.hero ? 'bad' : 'good', r.crit);
      play(ranged ? 'arrow-hit' : 'sword-hit');
      if (r.crit) play('crit', { volume: 0.9 });
      if (target.hp > 0) play(cry(target, 'hurt'), { delay: 120, volume: 0.85 });
      flashHit(target);
    } else {
      line += r.d20 === 1 ? ' Natural 1: a clumsy miss.' : ' Miss.';
      float(target.pos, 'miss', 'muted');
      if (!ranged) play('swing-miss', { volume: 0.7 });
    }
    log(line, target === s.hero ? (r.hit ? 'bad' : 'info') : (r.hit ? 'good' : 'info'));
    if (target !== s.hero && target.hp <= 0) {
      target.dead = true;
      play(cry(target, 'death'), { delay: 150 });
      log(`${target.name} falls!`, 'good');
      if (s.selectedId === target.id) s.selectedId = null;
    }
    if (target === s.hero && target.hp <= 0) play(cry(target, 'death'), { delay: 150 });
    redraw();
    await sleep(PAUSE_MS);
  }

  // ---------------------------------------------------------------------------
  // Log, banner, floating numbers, end screens
  // ---------------------------------------------------------------------------

  function log(text, kind = 'info') {
    s.log.unshift({ text, kind, id: Math.random() });
    s.log = s.log.slice(0, 60);
  }

  let bannerTimer;
  function banner(text) {
    const el = $('.dg-banner');
    el.textContent = text; el.classList.add('show');
    clearTimeout(bannerTimer);
    bannerTimer = setTimeout(() => el.classList.remove('show'), 1800);
  }

  function float(pos, text, kind, big = false) {
    const f = { x: pos.x, y: pos.y, text, kind, big, id: Math.random() };
    s.floats.push(f);
    setTimeout(() => { s.floats = s.floats.filter((x) => x !== f); drawOverlay(); }, reduceMotion ? 600 : 1300);
  }

  function showEnd(kind) {
    s.mode = kind;
    const el = $('.dg-endscreen');
    el.hidden = false;
    el.innerHTML = kind === 'victory'
      ? `<div class="dg-endcard"><h2>Dungeon cleared</h2><p>Every goblin in dungeon #${s.seed} has fallen. ${esc(s.hero.name)} stands victorious with ${s.hero.hp} of ${s.hero.maxHp} hit points.</p><div class="row"><button class="btn primary" data-dg="random">Delve into a new dungeon</button><button class="btn ghost" data-dg="close-end">Keep exploring</button></div></div>`
      : `<div class="dg-endcard"><h2>${esc(s.hero.name)} has fallen</h2><p>The goblins drag away the spoils. Rest, and try again.</p><div class="row"><button class="btn primary" data-dg="retry">Try this dungeon again</button><button class="btn ghost" data-dg="random">Try a new dungeon</button></div></div>`;
  }

  // ---------------------------------------------------------------------------
  // Drawing
  // ---------------------------------------------------------------------------

  function redraw() {
    s.reach = s.mode === 'combat' && s.order.length && !s.busy ? heroReach() : s.mode === 'explore' && !s.busy ? heroReach() : new Map();
    drawOverlay();
    drawPanel();
  }

  /** A round token: the portrait in the middle, a coloured front arc + arrow, a dark back arc. */
  function token(e, { hero = false } = {}) {
    const sz = S(); const r = sz * 0.36; const R = r + 4;
    const state = woundState(e.hp, e.maxHp);
    const off = s.lunge?.id === e.id ? { x: s.lunge.dx * sz * 0.28, y: s.lunge.dy * sz * 0.28 } : { x: 0, y: 0 };
    const cx = (e.pos.x + 0.5) * sz + off.x; const cy = (e.pos.y + 0.5) * sz + off.y;
    const img = hero ? s.hero.look?.url : monsterPortrait(e.statId);
    const filter = hero ? (s.hero.look?.filter ?? 'none') : 'none';
    const ring = hero ? (s.hero.look?.frameColor ?? '#e9c46a') : '#c94a3a';
    const hpFrac = Math.max(0, e.hp / e.maxHp);
    const cls = `tk ${hero ? 'tk-hero' : `tk-foe tk-${state}`}${s.flash.has(e.id) ? ' tk-flash' : ''}${s.selectedId === e.id ? ' tk-selected' : ''}`;
    return `<g class="${cls}" transform="translate(${cx} ${cy})">
      ${s.selectedId === e.id ? `<circle r="${R + 9}" class="tk-selring"/>` : ''}
      <g transform="rotate(${facingAngle(e.facing)})">
        <path d="M ${R} 0 A ${R} ${R} 0 0 1 ${-R} 0" class="tk-backarc"/>
        <path d="M ${-R} 0 A ${R} ${R} 0 0 1 ${R} 0" class="tk-frontarc" style="stroke:${ring}"/>
        <path d="M ${-r * 0.42} ${-R - 2} L 0 ${-R - sz * 0.17} L ${r * 0.42} ${-R - 2} Z" class="tk-nose" style="fill:${ring}"/>
      </g>
      ${img ? `<image href="${esc(img)}" x="${-r}" y="${-r}" width="${r * 2}" height="${r * 2}" clip-path="url(#tk-clip)" preserveAspectRatio="xMidYMid slice" style="filter:${filter}"/>`
    : `<circle r="${r}" class="tk-back"/><text y="${sz * 0.12}" class="tk-letter">${esc(e.name[0])}</text>`}
      <circle r="${r}" class="tk-hitflash"/>
      ${hero || state !== 'unhurt' ? `<rect x="${-r}" y="${-R - 16}" width="${r * 2}" height="7" rx="3" class="tk-hpbg"/><rect x="${-r}" y="${-R - 16}" width="${r * 2 * hpFrac}" height="7" rx="3" class="tk-hp ${hpFrac <= 0.5 ? 'low' : ''}"/>` : ''}
    </g>`;
  }

  function drawDoors() {
    const sz = S(); let out = '';
    for (const d of s.map.doors) {
      if (!s.revealAll && !s.revealed.has(cellKey(d.x, d.y))) continue;
      const open = s.doors.get(cellKey(d.x, d.y));
      const cx = (d.x + 0.5) * sz; const cy = (d.y + 0.5) * sz;
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
    const sz = S(); let out = `<defs><clipPath id="tk-clip" clipPathUnits="userSpaceOnUse"><circle r="${sz * 0.36}"/></clipPath></defs>`;
    out += drawDoors();
    // Reachable squares
    for (const c of s.reach.values()) if (c.cost > 0) out += `<rect x="${c.x * sz + 4}" y="${c.y * sz + 4}" width="${sz - 8}" height="${sz - 8}" rx="7" class="dg-reach"/>`;
    out += drawFog();
    // Hover: path preview, or attack preview on a monster
    const hov = s.hover;
    const foe = hov && alive().find((m) => m.pos.x === hov.x && m.pos.y === hov.y && canSee(m));
    if (foe && !s.busy) {
      const plan = heroAttackPlan(foe);
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
    for (const m of s.monsters) {
      if (m.dead) { if (canSee(m) || s.revealed.has(cellKey(m.pos.x, m.pos.y))) out += `<text x="${(m.pos.x + 0.5) * sz}" y="${(m.pos.y + 0.5) * sz + 10}" class="tk-dead">✕</text>`; continue; }
      if (canSee(m)) out += token(m);
    }
    out += token(s.hero, { hero: true });
    // Arrow in flight
    if (s.projectile) {
      const { from, to, t } = s.projectile;
      const x0 = (from.x + 0.5) * sz; const y0 = (from.y + 0.5) * sz; const x1 = (to.x + 0.5) * sz; const y1 = (to.y + 0.5) * sz;
      const x = x0 + (x1 - x0) * t; const y = y0 + (y1 - y0) * t; const ang = Math.atan2(y1 - y0, x1 - x0) * 180 / Math.PI;
      out += `<g transform="translate(${x} ${y}) rotate(${ang})" class="dg-arrow"><line x1="-34" y1="0" x2="0" y2="0"/><path d="M 0 0 L -12 -6 L -12 6 Z"/><path d="M -34 0 L -42 -6 M -34 0 L -42 6"/></g>`;
    }
    // Floating numbers
    for (const f of s.floats) out += `<text x="${(f.x + 0.5) * sz}" y="${f.y * sz}" class="dg-float ${f.kind} ${f.big ? 'big' : ''}">${esc(f.text)}</text>`;
    overlay.innerHTML = out;
  }

  function drawPanel() {
    const h = s.hero;
    if (!h) { $('.dg-herocard').innerHTML = '<p class="muted">Create or adopt a hero to explore.</p>'; return; }
    const ft = s.map.feetPerCell;
    const total = h.speed * (s.dash ? 2 : 1);
    const combat = s.mode === 'combat';
    const heroTurn = combat && !s.busy;
    $('.dg-banner').classList.toggle('turn', heroTurn);
    $('.dg-herocard').innerHTML = `
      <div class="hc-head">
        <div><h3>${esc(h.name)}</h3><p class="muted small">${combat ? `Round ${s.round} · ${s.busy ? 'enemies are acting…' : 'your turn'}` : 'Exploring'}</p></div>
        <div class="hc-compass" title="Facing ${FACINGS[h.facing].name}">
          <button class="btn icon small" data-dg="turn-left" aria-label="Turn left (Q)">⟲</button>
          <svg viewBox="-20 -20 40 40" class="hc-dial" aria-hidden="true"><circle r="17" class="hc-dial-ring"/><g transform="rotate(${facingAngle(h.facing)})"><path d="M -6 -2 L 0 -16 L 6 -2 Z" class="hc-dial-front"/><path d="M -6 2 L 0 14 L 6 2 Z" class="hc-dial-back"/></g></svg>
          <button class="btn icon small" data-dg="turn-right" aria-label="Turn right (E)">⟳</button>
        </div>
      </div>
      <p class="hc-facing small">Facing <b>${FACINGS[h.facing].name}</b>. Enemies behind you (dark half) attack with advantage.</p>
      <div class="hc-stat"><span>Hit points</span><b>${h.hp} / ${h.maxHp}</b></div>
      <div class="hc-bar"><span class="${h.hp <= h.maxHp / 2 ? 'low' : ''}" style="width:${(h.hp / h.maxHp) * 100}%"></span></div>
      <div class="hc-stat"><span>Movement</span><b>${combat ? `${s.moveLeft} of ${total} squares (${s.moveLeft * ft} ft)` : `${h.speed} squares per move`}</b></div>
      ${combat ? `<div class="hc-bar move"><span style="width:${total ? (s.moveLeft / total) * 100 : 0}%"></span></div>` : ''}
      <div class="hc-row"><span class="pip ${!s.actionUsed ? 'on' : ''}">Action</span><span class="pip ${h.reaction ? 'on' : ''}">Reaction</span><span class="muted small">AC ${h.ac}</span></div>
      <h4>Weapons</h4>
      <div class="hc-weapons">${h.weapons.map((w, i) => `
        <button class="weapon ${i === s.weaponIdx ? 'sel' : ''}" data-dg="weapon" data-i="${i}" aria-pressed="${i === s.weaponIdx}">
          <b>${esc(w.name)}</b><span>${signed(w.toHit)} to hit · ${esc(w.damage)} ${esc(w.type)}</span>
          <span class="muted">${w.melee ? 'melee 5 ft' : ''}${w.melee && w.ranged ? ' · ' : ''}${w.ranged ? `range ${w.normal * 5}/${w.long * 5} ft` : ''}</span>
        </button>`).join('')}</div>
      <div class="row wrap">
        ${combat ? `<button class="btn small" data-dg="dash" ${s.actionUsed || s.busy ? 'disabled' : ''} title="Use your action to double your movement this turn">Dash</button>
        <button class="btn small primary" data-dg="end-turn" ${s.busy ? 'disabled' : ''}>End turn</button>` : ''}
        <button class="btn small ghost" data-dg="retry" title="Restart this dungeon">Restart</button>
      </div>
      <label class="field small" for="dg-rule">Diagonal rule
        <select id="dg-rule" data-dg="rule">${Object.entries(DIAGONAL_RULES).map(([k, v]) => `<option value="${k}" ${k === s.rule ? 'selected' : ''}>${esc(v.name)}</option>`).join('')}</select>
      </label>`;
    drawTargetInfo();
    $('.dg-initiative').innerHTML = combat ? `<h3>Initiative</h3><ol class="init">${s.order.map((o) => {
      const e = o.id === 'hero' ? h : s.monsters.find((m) => m.id === o.id);
      if (!e || e.dead) return '';
      return `<li class="${o.id === 'hero' ? 'me' : ''}"><b>${o.init}</b> ${esc(e.name)}${o.id === 'hero' ? '' : ` <span class="muted small">${canSee(e) ? woundState(e.hp, e.maxHp) : 'unseen'}</span>`}</li>`;
    }).join('')}</ol>` : '';
    $('.dg-log').innerHTML = s.log.map((l) => `<li class="${l.kind}">${esc(l.text)}</li>`).join('');
    $('.dg-zoom').textContent = `${Math.round(s.zoom * 100)}%`;
  }

  // ---------------------------------------------------------------------------
  // Studying a foe: skill checks that reveal what you know about it
  // ---------------------------------------------------------------------------

  /** Which knowledge skill recalls lore about a creature type. */
  const LORE_SKILL = {
    humanoid: 'history', giant: 'history', beast: 'nature', plant: 'nature', monstrosity: 'nature',
    undead: 'religion', fiend: 'religion', celestial: 'religion',
    aberration: 'arcana', construct: 'arcana', dragon: 'arcana', elemental: 'arcana', fey: 'arcana', ooze: 'arcana',
  };
  const SKILL_LABEL = { insight: 'Insight', medicine: 'Medicine', perception: 'Perception', history: 'History', nature: 'Nature', religion: 'Religion', arcana: 'Arcana' };
  const STUDIES = (stat) => [
    { id: 'mind', skill: 'insight', ability: 'WIS', label: 'Read its intent', reveals: 'personality, tactics and morale' },
    { id: 'hp', skill: 'medicine', ability: 'WIS', label: 'Judge its wounds', reveals: 'exact hit points' },
    { id: 'gear', skill: 'perception', ability: 'WIS', label: 'Size up its gear', reveals: 'armour class and weapons' },
    { id: 'lore', skill: LORE_SKILL[stat.type] ?? 'arcana', ability: 'INT', label: 'Recall its lore', reveals: 'abilities, senses and traits' },
  ];
  /** DC for knowing about a creature: 10 + its challenge rating (rounded down). */
  const studyDC = (stat) => 10 + Math.floor(stat.crValue);
  const known = (m, id) => (id === 'hp' ? s.knownHp.has(m.id) : s.knowledge[m.statId]?.has(id));

  function study(m, studyId) {
    if (s.busy) return;
    if (s.mode === 'combat' && s.actionUsed) { banner('Studying a foe takes your action, and you have used it.'); return; }
    const stat = BESTIARY_BY_ID[m.statId];
    const st = STUDIES(stat).find((x) => x.id === studyId);
    const bonus = s.hero.skills[st.skill] ?? 0;
    const d20 = rollDie(20); const total = d20 + bonus; const dc = studyDC(stat);
    const ok = total >= dc;
    play('dice', { volume: 0.7 });
    if (ok) {
      if (studyId === 'hp') s.knownHp.add(m.id);
      else (s.knowledge[m.statId] ??= new Set()).add(studyId);
    }
    if (s.mode === 'combat') s.actionUsed = true;
    s.lastStudy = { id: m.id, studyId, ok, text: `${SKILL_LABEL[st.skill]}: d20 (${d20}) ${signed(bonus)} = ${total} vs DC ${dc}. ${ok ? 'Success!' : 'Not this time.'}` };
    log(`${s.hero.name} studies the ${m.name} (${SKILL_LABEL[st.skill]}): d20 (${d20}) ${signed(bonus)} = ${total} vs DC ${dc}. ${ok ? `Success: learns its ${st.reveals}.` : 'Fails to learn anything new.'}`, ok ? 'good' : 'info');
    redraw();
  }

  function revealedHtml(m, stat) {
    let out = '';
    if (known(m, 'mind')) {
      out += `<div class="reveal"><h4>Intent</h4><p>${esc(stat.lore.personality)}</p><p><b>Tactics:</b> ${esc(stat.lore.tactics)}</p>
        <p class="muted small">${m.hp <= m.maxHp / 2 ? 'It looks shaken and is thinking about escape.' : 'It is confident and eager to fight.'}</p></div>`;
    }
    if (known(m, 'gear')) {
      const weapons = stat.actions.filter((a) => a.attack);
      out += `<div class="reveal"><h4>Gear</h4><p><b>AC ${stat.ac}</b>${stat.armor ? ` (${esc(stat.armor)})` : ''}</p>
        <ul class="plain small">${weapons.map((a) => `<li><b>${esc(a.name)}</b>: ${formatModifier(a.attack.toHit)} to hit, ${esc(a.attack.damage.map((d) => `${d.dice} ${d.type}`).join(' + '))}${a.attack.range ? `, range ${a.attack.range} ft` : ''}</li>`).join('')}</ul></div>`;
    }
    if (known(m, 'lore')) {
      out += `<div class="reveal"><h4>Lore</h4><p class="small">${esc(stat.size)} ${esc(stat.type)}, challenge ${esc(stat.cr)} · speed ${esc(stat.speedText)} · ${esc(sensesText(stat))}</p>
        <p class="small">STR ${stat.scores.str} · DEX ${stat.scores.dex} · CON ${stat.scores.con} · INT ${stat.scores.int} · WIS ${stat.scores.wis} · CHA ${stat.scores.cha}</p>
        ${stat.traits.map((t) => `<p class="small"><b>${esc(t.name)}.</b> ${esc(t.text)}</p>`).join('')}
        <p class="small muted">${esc(stat.lore.origin)}</p></div>`;
    }
    return out;
  }

  function foePanel(m) {
    const stat = BESTIARY_BY_ID[m.statId];
    const portrait = monsterPortrait(m.statId);
    const d = chebyshev(s.hero.pos, m.pos);
    const combat = s.mode === 'combat';
    const health = s.knownHp.has(m.id) ? `${m.hp} / ${m.maxHp} HP` : woundState(m.hp, m.maxHp);
    const weapons = s.hero.weapons.map((w, i) => {
      const o = attackOptions({ attacker: s.hero, target: m, weapon: w, opaque: opaque(), occupied: occupied(), enemiesOf });
      const blocked = !o || s.actionUsed || s.busy || !combat;
      return `<button class="btn small ${o ? 'primary' : ''}" data-dg="attack-with" data-i="${i}" ${blocked ? 'disabled' : ''} title="${o ? `${pct(o.chance)} to hit${o.mode !== 'normal' ? ` (${o.mode})` : ''}` : esc(whyNot(m))}">
        ${esc(w.name)}${o ? ` · ${pct(o.chance)}` : ''}</button>`;
    }).join('');
    const studies = STUDIES(stat).map((st) => {
      const done = known(m, st.id);
      return `<button class="study ${done ? 'done' : ''}" data-dg="study" data-study="${st.id}" ${s.busy || (combat && s.actionUsed) ? 'disabled' : ''}>
        <b>${SKILL_LABEL[st.skill]}</b> <span class="muted">${st.ability} ${signed(s.hero.skills[st.skill] ?? 0)}</span>
        <span>${done ? '✓ ' : ''}${esc(st.label)}</span></button>`;
    }).join('');
    const last = s.lastStudy?.id === m.id ? `<p class="study-result ${s.lastStudy.ok ? 'ok' : ''}">${esc(s.lastStudy.text)}</p>` : '';
    return `<div class="foe-card">
      <div class="foe-head">
        ${portrait ? `<img class="foe-portrait" src="${esc(portrait)}" alt="Portrait of a ${esc(m.name.toLowerCase())}">` : '<div class="foe-portrait none" aria-hidden="true">?</div>'}
        <div>
          <h3>${esc(m.name)}</h3>
          <p class="small"><b>${esc(health)}</b> · ${d * 5} ft away · facing ${FACINGS[m.facing].name}</p>
          ${isBehindHero(m) ? '<p class="small hint">You are behind it: attacks have advantage.</p>' : ''}
        </div>
        <button class="btn icon small" data-dg="deselect" aria-label="Close">✕</button>
      </div>
      <h4>Attack</h4>
      <div class="row wrap">${weapons}</div>
      ${!combat ? '<p class="small muted">Attacks are made on your turn in combat.</p>' : s.actionUsed ? '<p class="small muted">You have used your action this turn.</p>' : '<p class="small muted">Tip: click the selected goblin again to attack with your best weapon.</p>'}
      <h4>Study it <span class="muted small">DC ${studyDC(stat)}${combat ? ' · uses your action' : ''}</span></h4>
      <div class="studies">${studies}</div>
      ${last}
      ${revealedHtml(m, stat)}
    </div>`;
  }

  const isBehindHero = (m) => {
    const f = FACINGS[m.facing];
    return Math.sign(s.hero.pos.x - m.pos.x) * f.dx + Math.sign(s.hero.pos.y - m.pos.y) * f.dy <= -1;
  };

  function drawTargetInfo() {
    const box = $('.dg-target');
    const sel = s.selectedId && s.monsters.find((m) => m.id === s.selectedId && !m.dead && canSee(m));
    if (sel) { box.innerHTML = foePanel(sel); return; }
    const hov = s.hover;
    if (!hov || !s.hero) { box.innerHTML = '<p class="muted small">Click a goblin to see its portrait, attack it or study it. Hover over squares to check distances.</p>'; return; }
    const foe = alive().find((m) => m.pos.x === hov.x && m.pos.y === hov.y && canSee(m));
    if (foe) {
      const plan = heroAttackPlan(foe);
      box.innerHTML = `<div class="foe-mini">${monsterPortrait(foe.statId) ? `<img src="${esc(monsterPortrait(foe.statId))}" alt="">` : ''}<div><h3>${esc(foe.name)}</h3>
        <p class="small">${woundState(foe.hp, foe.maxHp)} · ${chebyshev(s.hero.pos, foe.pos) * 5} ft away</p>
        ${plan ? `<p class="hit"><b>${pct(plan.opts.chance)}</b> to hit with ${esc(plan.weapon.name)}</p>` : `<p class="small">${esc(whyNot(foe))}</p>`}
        <p class="small muted">Click to select it and see more.</p></div></div>`;
      return;
    }
    const room = roomAt(s.map, hov.x, hov.y);
    const knownSq = s.revealAll || s.revealed.has(cellKey(hov.x, hov.y));
    const c = s.reach.get(cellKey(hov.x, hov.y));
    box.innerHTML = knownSq ? `<p class="small"><b>Square ${hov.x}, ${hov.y}</b>${room ? ` · ${esc(room.name)}` : ''}${s.visible.has(cellKey(hov.x, hov.y)) ? ' · in sight' : ' · remembered'}</p>
      ${c && c.cost > 0 ? `<p class="small">${c.cost} square${c.cost === 1 ? '' : 's'} away (${c.cost * s.map.feetPerCell} ft). Click to move.</p>` : ''}
      ${c && c.cost === 0 ? `<p class="small">${esc(s.hero.name)} stands here, facing ${FACINGS[s.hero.facing].name}.</p>` : ''}` : '<p class="small muted">Unexplored darkness.</p>';
  }

  // ---------------------------------------------------------------------------
  // Camera: zoom, pan, fit
  // ---------------------------------------------------------------------------

  const mapPx = () => s.map.width * S();
  function setZoom(z, clientX, clientY) {
    const rect = viewport.getBoundingClientRect();
    const fx = clientX ?? rect.left + rect.width / 2; const fy = clientY ?? rect.top + rect.height / 2;
    const contentX = (viewport.scrollLeft + fx - rect.left) / s.zoom;
    const contentY = (viewport.scrollTop + fy - rect.top) / s.zoom;
    s.zoom = Math.max(0.15, Math.min(2, z));
    stage.style.width = `${mapPx() * s.zoom}px`;
    stage.style.height = `${mapPx() * s.zoom}px`;
    viewport.scrollLeft = contentX * s.zoom - (fx - rect.left);
    viewport.scrollTop = contentY * s.zoom - (fy - rect.top);
    $('.dg-zoom').textContent = `${Math.round(s.zoom * 100)}%`;
  }
  function fit() {
    const avail = Math.min(viewport.clientWidth, viewport.clientHeight || viewport.clientWidth);
    setZoom((avail - 4) / mapPx());
  }
  function centerOn(pos, smooth = true) {
    const sz = S() * s.zoom;
    viewport.scrollTo({ left: (pos.x + 0.5) * sz - viewport.clientWidth / 2, top: (pos.y + 0.5) * sz - viewport.clientHeight / 2, behavior: smooth && !reduceMotion ? 'smooth' : 'auto' });
  }
  function keepInView(pos) {
    const sz = S() * s.zoom; const px = (pos.x + 0.5) * sz; const py = (pos.y + 0.5) * sz; const m = sz * 2.5;
    if (px < viewport.scrollLeft + m || px > viewport.scrollLeft + viewport.clientWidth - m
      || py < viewport.scrollTop + m || py > viewport.scrollTop + viewport.clientHeight - m) centerOn(pos);
  }

  // Wheel zoom toward the cursor.
  viewport.addEventListener('wheel', (e) => {
    e.preventDefault();
    setZoom(s.zoom * Math.exp(-e.deltaY * 0.0015), e.clientX, e.clientY);
  }, { passive: false });

  // Pointer: drag to pan, two fingers to pinch-zoom, a tap/click acts on a square.
  const pointers = new Map();
  let drag = null; let pinch = null;
  viewport.addEventListener('pointerdown', (e) => {
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    viewport.setPointerCapture(e.pointerId);
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y), zoom: s.zoom };
      drag = null;
    } else {
      drag = { x: e.clientX, y: e.clientY, sl: viewport.scrollLeft, st: viewport.scrollTop, moved: false };
    }
  });
  viewport.addEventListener('pointermove', (e) => {
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      setZoom(pinch.zoom * (Math.hypot(a.x - b.x, a.y - b.y) / pinch.dist), (a.x + b.x) / 2, (a.y + b.y) / 2);
      return;
    }
    if (drag && pointers.size === 1) {
      const dx = e.clientX - drag.x; const dy = e.clientY - drag.y;
      if (!drag.moved && Math.hypot(dx, dy) > 6) { drag.moved = true; viewport.classList.add('panning'); }
      if (drag.moved) { viewport.scrollLeft = drag.sl - dx; viewport.scrollTop = drag.st - dy; return; }
    }
    const c = cellFromEvent(e);
    if (!c && !s.hover) return;
    if (c && s.hover && c.x === s.hover.x && c.y === s.hover.y) return;
    s.hover = c; drawOverlay();
    if (!s.selectedId) drawTargetInfo();
  });
  const endPointer = (e) => {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    viewport.classList.remove('panning');
    if (drag && !drag.moved && e.type === 'pointerup') handleClick(cellFromEvent(e));
    drag = null;
  };
  viewport.addEventListener('pointerup', endPointer);
  viewport.addEventListener('pointercancel', endPointer);
  viewport.addEventListener('pointerleave', () => { if (!pointers.size) { s.hover = null; drawOverlay(); drawTargetInfo(); } });

  function cellFromEvent(e) {
    const r = overlay.getBoundingClientRect();
    const x = Math.floor(((e.clientX - r.left) / r.width) * s.map.width);
    const y = Math.floor(((e.clientY - r.top) / r.height) * s.map.height);
    if (x < 0 || y < 0 || x >= s.map.width || y >= s.map.height) return null;
    return { x, y };
  }

  function handleClick(c) {
    if (!c || !s.hero || s.busy || s.mode === 'defeat' || s.mode === 'victory') return;
    const foe = alive().find((m) => m.pos.x === c.x && m.pos.y === c.y && canSee(m));
    if (foe) {
      // First click selects (and shows the portrait); clicking the selected foe again attacks.
      if (s.selectedId === foe.id) heroAttack(foe);
      else { s.selectedId = foe.id; redraw(); }
      return;
    }
    if (s.selectedId) { s.selectedId = null; }
    const t = s.reach.get(cellKey(c.x, c.y));
    if (t && t.cost > 0) moveHero(t);
  }

  // ---------------------------------------------------------------------------
  // Controls
  // ---------------------------------------------------------------------------

  host.addEventListener('click', (e) => {
    const el = e.target.closest('[data-dg]');
    if (!el || el.matches('input, select')) return;
    switch (el.dataset.dg) {
      case 'seed-prev': newDungeon(s.seed - 1); break;
      case 'seed-next': newDungeon(s.seed + 1); break;
      case 'random': newDungeon(1 + Math.floor(Math.random() * 99999)); break;
      case 'retry': resetDelve(); centerOn(s.hero.pos); break;
      case 'close-end': $('.dg-endscreen').hidden = true; s.mode = 'explore'; redraw(); break;
      case 'zoom-in': setZoom(s.zoom * 1.25); break;
      case 'zoom-out': setZoom(s.zoom / 1.25); break;
      case 'fit': fit(); break;
      case 'center': centerOn(s.hero.pos); break;
      case 'turn-left': if (!s.busy) { s.hero.facing = rotateFacing(s.hero.facing, -1); redraw(); } break;
      case 'turn-right': if (!s.busy) { s.hero.facing = rotateFacing(s.hero.facing, 1); redraw(); } break;
      case 'weapon': s.weaponIdx = Number(el.dataset.i); redraw(); break;
      case 'dash':
        if (s.mode === 'combat' && !s.actionUsed && !s.busy) { s.dash = true; s.actionUsed = true; s.moveLeft += s.hero.speed; log(`${s.hero.name} dashes, gaining ${s.hero.speed} extra squares of movement.`, 'info'); redraw(); }
        break;
      case 'end-turn': endHeroTurn(); break;
      case 'deselect': s.selectedId = null; redraw(); break;
      case 'attack-with': {
        const m = s.monsters.find((x) => x.id === s.selectedId);
        if (m) heroAttack(m, Number(el.dataset.i));
        break;
      }
      case 'study': {
        const m = s.monsters.find((x) => x.id === s.selectedId);
        if (m) study(m, el.dataset.study);
        break;
      }
      default:
    }
  });

  host.addEventListener('change', (e) => {
    const el = e.target;
    switch (el.dataset.dg) {
      case 'seed': newDungeon(Number(el.value)); break;
      case 'grid':
        s.grid = el.checked;
        base.innerHTML = renderDungeonSVG(s.map, { grid: s.grid, labels: true, doors: false });
        break;
      case 'reveal': s.revealAll = el.checked; redraw(); break;
      case 'rule': s.rule = el.value; redraw(); break;
      case 'hero': s.heroId = el.value; resetDelve(); centerOn(s.hero.pos); break;
      default:
    }
  });

  const onKey = (e) => {
    if (!host.isConnected) { window.removeEventListener('keydown', onKey); return; }
    if (e.target.matches?.('input, select, textarea')) return;
    if (e.key === 'q' || e.key === 'Q') host.querySelector('[data-dg="turn-left"]')?.click();
    else if (e.key === 'e' || e.key === 'E') host.querySelector('[data-dg="turn-right"]')?.click();
    else if (e.key === '+' || e.key === '=') setZoom(s.zoom * 1.25);
    else if (e.key === '-') setZoom(s.zoom / 1.25);
    else if (e.key === 'Escape' && s.selectedId) { s.selectedId = null; redraw(); }
  };
  window.addEventListener('keydown', onKey);

  if (!heroes.length) { host.querySelector('.dg-help').textContent = 'Create or adopt a hero first.'; }
  preload(SOUND_KEYS);
  newDungeon(s.seed);
}
