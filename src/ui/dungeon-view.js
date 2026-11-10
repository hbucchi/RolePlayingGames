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
import { setMood, stinger } from './music.js';
import { formatModifier } from '../engine/abilities.js';
import { sensesText } from '../engine/monsters.js';
import { rollDie, roll } from '../engine/dice.js';
import { placeFeatures, populateDungeon, skillCheck, checkChance } from '../engine/features.js';
import { rollMonsterLoot, rollChestLoot } from '../engine/loot.js';
import { makeItem as makeItemSafe, addItem, removeItem, countOf, consume, itemName, itemDef, equipItem, unequipSlot, isEquipped, findItem, formatCoins, itemRarity } from '../engine/items.js';
import { xpProgress } from '../engine/progression.js';
import { DUNGEON_FOES } from '../content/westlands/dungeon-foes.js';
import { inventoryHtml, lootHtml, coinsHtml, itemIcon } from './inventory-view.js';

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const STEP_MS = reduceMotion ? 0 : 110;
const PAUSE_MS = reduceMotion ? 0 : 420;
const pct = (p) => `${Math.round(p * 100)}%`;
const signed = (n) => (n >= 0 ? `+${n}` : `${n}`);

const FOE_POOL = DUNGEON_FOES.map((id) => BESTIARY_BY_ID[id]).filter(Boolean);

/**
 * @param {HTMLElement} host
 * @param {{heroes: {id:string,label:string}[], api: {load, derive, save}, initialSeed?: number}} opts
 *   api.load(id) -> the hero's draft (with gear); api.derive(draft) -> combat stats;
 *   api.save(draft) -> the saved draft (a ready-made hero is adopted on its first save).
 */
export function mountDungeon(host, { heroes, api, initialSeed = 7 }) {
  const s = {
    seed: initialSeed, map: null, grid: true, revealAll: false, rule: 'standard', zoom: 0.5,
    heroId: heroes[0]?.id ?? null, hero: null, monsters: [],
    doors: new Map(), revealed: new Set(), visible: new Set(),
    mode: 'explore', round: 0, order: [], turnIdx: 0,
    moveLeft: 0, actionUsed: false, dash: false, weaponIdx: 0,
    hover: null, busy: false, log: [], floats: [], reach: new Map(),
    selectedId: null, knowledge: {}, knownHp: new Set(), lunge: null, flash: new Set(), projectile: null, lastStudy: null,
    draft: null, def: null, features: null, target: null, invOpen: false, invSel: null, invFilter: 'all',
    ammoSpent: {}, delve: { xp: 0, coins: 0, items: 0, kills: 0 }, lastCheck: null, phialUsed: false,
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
        <span class="dg-depth badge" title="How deep you are. Every two floors, foes get tougher.">Depth 1</span>
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
        <p class="dg-help muted small">Click a lit square to move · click a foe to select it, click again to attack · click chests, doors, traps and bodies next to you · I opens your pack · Q / E turn · drag to pan, scroll to zoom</p>
      </div>
      <aside class="dg-panel">
        <section class="dg-herocard"></section>
        <section class="dg-target" aria-live="polite"></section>
        <section class="dg-nearby"></section>
        <section class="dg-initiative"></section>
        <section class="dg-logbox"><h3>Battle log</h3><ol class="dg-log"></ol></section>
      </aside>
    </div>
    <div class="dg-endscreen" hidden></div>
    <div class="dg-inv" hidden role="dialog" aria-label="Inventory"></div>`;

  const $ = (sel) => host.querySelector(sel);
  const viewport = $('.dg-viewport'); const stage = $('.dg-stage');
  const base = $('.dg-base'); const overlay = $('.dg-overlay');
  const S = () => s.map.cellSize;

  // ---------------------------------------------------------------------------
  // Setup
  // ---------------------------------------------------------------------------

  /** Load the chosen hero's saved draft (inventory, coins, XP) and derive its combat stats. */
  function loadHero() {
    const id = heroes.some((h) => h.id === s.heroId) ? s.heroId : heroes[0]?.id;
    s.draft = id ? api.load(id) : null;
    s.def = s.draft ? api.derive(s.draft) : null;
  }

  const heroWeapons = (def) => (def?.attacks ?? []).map((a) => ({ ...weaponFromHeroAttack(a), ammo: a.ammo, uid: a.uid, slot: a.slot }));

  /** Save the hero after loot, XP or gear changes. A ready-made hero is adopted into your company. */
  function persist() {
    if (!s.draft) return;
    const saved = api.save(s.draft);
    if (saved && saved.id !== s.draft.id) {
      const opt = host.querySelector(`#dg-hero option[value="${CSS.escape(s.draft.id)}"]`);
      const h = heroes.find((x) => x.id === s.draft.id);
      if (h) h.id = saved.id;
      if (opt) { opt.value = saved.id; opt.textContent = opt.textContent.replace(' (ready-made)', ''); }
      s.heroId = saved.id;
      log(`${saved.name} joins your company, so their loot and experience are kept.`, 'info');
    }
    s.draft = saved ?? s.draft;
  }

  /** Re-derive stats after equipping, levelling up or carrying more; keeps position and wounds. */
  function refreshHero() {
    const prevMax = s.hero.maxHp;
    s.def = api.derive(s.draft);
    const d = s.def;
    Object.assign(s.hero, {
      maxHp: d.maxHp, ac: d.ac, dexMod: d.dexMod, speed: speedToSquares(d.speed, s.map.feetPerCell),
      weapons: heroWeapons(d), look: d.look, voice: d.look?.voice ?? 'low', skills: d.skills ?? {},
    });
    if (d.maxHp > prevMax) s.hero.hp += d.maxHp - prevMax;
    s.hero.hp = Math.min(s.hero.hp, s.hero.maxHp);
    s.weaponIdx = Math.min(s.weaponIdx, Math.max(0, s.hero.weapons.length - 1));
  }

  function newDungeon(seed, carry = null) {
    if (!carry) s.depth = 1;
    s.seed = Math.max(1, Math.floor(seed) || 1);
    s.map = generateDungeon(s.seed);
    $('#dg-seed').value = s.seed;
    base.innerHTML = renderDungeonSVG(s.map, { grid: s.grid, labels: true, doors: false });
    overlay.setAttribute('viewBox', `0 0 ${s.map.width * S()} ${s.map.height * S()}`);
    resetDelve(carry);
    // Start close to the hero: a fresh map is mostly unexplored darkness anyway.
    requestAnimationFrame(() => { setZoom(0.9); centerOn(s.hero.pos, false); });
  }

  /**
   * Start (or restart) the current dungeon. `carry` = { hp, delve } when arriving by the stairs:
   * wounds and the running tally come along; everything else on the new floor is fresh.
   */
  function resetDelve(carry = null) {
    loadHero();
    const h = s.def;
    const weapons = heroWeapons(h);
    s.hero = h ? {
      id: 'hero', name: h.name, pos: { x: s.map.entrance.x, y: s.map.entrance.y }, facing: 0,
      hp: h.maxHp, maxHp: h.maxHp, ac: h.ac, dexMod: h.dexMod, speed: speedToSquares(h.speed, s.map.feetPerCell),
      weapons, reaction: true, aware: true,
      look: h.look, voice: h.look?.voice ?? 'low', skills: h.skills ?? {},
    } : null;
    s.weaponIdx = Math.max(0, weapons.findIndex((w) => w.melee));
    if (carry && s.hero) s.hero.hp = Math.min(s.hero.maxHp, carry.hp);
    // The dungeon's secrets are fixed by its number; its inhabitants are matched to the hero's level,
    // and every two floors deeper the danger rises as if the hero were a level higher.
    const level = Math.min(20, (h?.level ?? 1) + Math.floor(((s.depth ?? 1) - 1) / 2));
    s.features = placeFeatures(s.map, s.seed, level);
    const avoid = new Set([...s.features.chests.map((c) => cellKey(c.x, c.y)), cellKey(s.map.exit.x, s.map.exit.y)]);
    s.monsters = populateDungeon(s.map, s.seed, level, FOE_POOL, { avoid });
    s.doors = new Map(); s.revealed = new Set(); s.log = []; s.floats = [];
    s.selectedId = null; s.knowledge = {}; s.knownHp = new Set(); s.lastStudy = null; s.target = null; s.lastCheck = null;
    s.ammoSpent = {}; s.delve = carry?.delve ?? { xp: 0, coins: 0, items: 0, kills: 0, deepest: 1 }; s.phialUsed = false; s.invOpen = false;
    s.mode = 'explore'; s.order = []; s.round = 0; s.busy = false; s.exitSeen = false;
    $('.dg-endscreen').hidden = true; $('.dg-inv').hidden = true;
    setMood('dungeon');
    startHeroTurn();
    const kinds = [...new Set(s.monsters.map((m) => m.name))];
    log(`${s.hero?.name ?? 'Your hero'} (level ${h?.level ?? 1}) ${carry ? 'climbs down' : 'descends the stairs'} into dungeon #${s.seed}, depth ${s.depth}. Somewhere here: ${s.monsters.length} foes (${kinds.join(', ') || 'none'}), ${s.features.chests.length} chests, traps, and stairs leading further down. Find them.`, 'info');
    $('.dg-depth').textContent = `Depth ${s.depth}`;
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

  // Squares nobody can walk through: undiscovered secret doors, locked doors, chests.
  const isSecret = (k) => s.features?.secretDoors.has(k);
  const isLocked = (k) => s.features?.locks.has(k);
  function terrainBlocked() {
    const b = new Set();
    if (!s.features) return b;
    for (const k of s.features.secretDoors) b.add(k);
    for (const k of s.features.locks.keys()) b.add(k);
    for (const c of s.features.chests) b.add(cellKey(c.x, c.y));
    return b;
  }
  const chestAt = (x, y) => s.features?.chests.find((c) => c.x === x && c.y === y) ?? null;
  const trapAt = (x, y) => s.features?.traps.find((t) => t.x === x && t.y === y) ?? null;
  const corpseAt = (x, y) => s.monsters.find((m) => m.dead && m.pos.x === x && m.pos.y === y && m.loot && (m.loot.coins || m.loot.items.length)) ?? null;
  const doorAt = (x, y) => s.map.doors.find((d) => d.x === x && d.y === y) ?? null;
  const adjacent = (p) => chebyshev(s.hero.pos, p) <= 1;

  /**
   * Passive Perception: as you move, you notice hidden things whose DC is at most
   * 10 + your Perception bonus, if they are close (traps within 3 squares, secret doors within 2).
   */
  function passiveNotice() {
    const pp = 10 + (s.hero.skills.perception ?? 0);
    const found = [];
    for (const t of s.features.traps) {
      if (t.found || t.sprung || !s.visible.has(cellKey(t.x, t.y)) || chebyshev(t, s.hero.pos) > 3) continue;
      if (pp >= t.dc) { t.found = true; found.push(`a ${t.name}`); }
    }
    for (const k of [...s.features.secretDoors]) {
      const [x, y] = k.split(',').map(Number);
      if (chebyshev({ x, y }, s.hero.pos) > 2) continue;
      if (pp >= secretDC()) { revealSecret(k); found.push('a secret door'); }
    }
    if (found.length) { log(`${s.hero.name}'s sharp eyes notice ${found.join(' and ')} (passive Perception ${pp}).`, 'good'); banner(`You notice ${found.join(' and ')}!`); }
  }
  const secretDC = () => 13 + Math.floor((s.def?.level ?? 1) / 3);
  function revealSecret(k) {
    s.features.secretDoors.delete(k);
    const [x, y] = k.split(',').map(Number);
    float({ x, y }, 'secret door!', 'good');
  }

  /** Recompute what the hero sees; returns monsters that just noticed the hero. */
  function updateVision() {
    s.visible = visibleSquares(s.map, s.hero.pos, opaque());
    if (s.features) passiveNotice();
    if (s.map.exit && !s.exitSeen && s.visible.has(cellKey(s.map.exit.x, s.map.exit.y))) {
      s.exitSeen = true;
      if (s.log.length) { log('You spot a stairway leading further down!', 'good'); banner('Stairs down!'); }
    }
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
    const kinds = [...new Set(spotted.map((m) => m.name.toLowerCase()))];
    const names = spotted.length === 1 ? `A ${kinds[0]}` : `${spotted.length} foes (${kinds.join(', ')})`;
    const isNew = s.mode !== 'combat';
    if (isNew) {
      s.mode = 'combat'; s.round = 1;
      setMood('combat');
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
      setMood('dungeon');
      log('The fight is over. You can explore freely again.', 'good');
      recoverAmmo();
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
      const acted = await monsterTurn(m);
      if (s.hero.hp <= 0) { s.busy = false; showEnd('defeat'); return; }
      // A hunter that can neither reach nor see you for two rounds loses interest.
      if (!acted && !canSee(m)) { m.idle = (m.idle ?? 0) + 1; if (m.idle >= 2) { m.aware = false; m.idle = 0; log(`Somewhere in the dark, a ${m.name.toLowerCase()} gives up the hunt.`, 'info'); } } else m.idle = 0;
    }
    s.order = s.order.filter((o) => { const m = s.monsters.find((x) => x.id === o.id); return o.id === 'hero' || (m && !m.dead && m.aware); });
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
    const plan = planMonsterTurn({ m, hero: s.hero, map: s.map, opaque: opaque(), blocked: new Set([...occupied(m), ...terrainBlocked()]) });
    let disengaged = false;
    if (plan.length === 1 && plan[0].type === 'wait') return false;
    for (const step of plan) {
      if (step.type === 'flee') { disengaged = !!m.nimble; if (canSee(m)) log(`${m.name} panics and flees!`, 'info'); }
      if (step.type === 'disengage') { disengaged = true; if (canSee(m)) log(`${m.name} slips away nimbly (Nimble Escape: Disengage).`, 'info'); }
      if (step.type === 'move') {
        for (const p of step.path.slice(1)) {
          const wasAdjacent = chebyshev(m.pos, s.hero.pos) <= 1;
          m.facing = facingToward(m.pos, p);
          m.pos = { x: p.x, y: p.y };
          openDoorAt(p);
          if (wasAdjacent && chebyshev(m.pos, s.hero.pos) > 1 && !disengaged && !m.flyby && s.hero.reaction) await heroOpportunityAttack(m);
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
    return true;
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
    const blocked = new Set([...occupied(s.hero), ...terrainBlocked()]);
    if (!s.revealAll) {
      // You can only walk into squares you have discovered.
      for (let y = 0; y < s.map.height; y++) for (let x = 0; x < s.map.width; x++) if (!s.revealed.has(cellKey(x, y))) blocked.add(cellKey(x, y));
    }
    // Paths go around known traps when they can; squares only reachable across a trap are
    // still offered, and crossing it takes an Acrobatics check.
    const traps = (s.features?.traps ?? []).filter((t) => t.found && !t.disarmed && !t.sprung).map((t) => cellKey(t.x, t.y));
    const all = reachableSquares(s.map, s.hero.pos, s.moveLeft, { diagonalRule: s.rule, blocked });
    if (!traps.length) return all;
    const safe = reachableSquares(s.map, s.hero.pos, s.moveLeft, { diagonalRule: s.rule, blocked: new Set([...blocked, ...traps]) });
    for (const [k, c] of all) if (!safe.has(k)) safe.set(k, { ...c, risky: true });
    return safe;
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
      const trap = trapAt(p.x, p.y);
      let sprang = false;
      if (trap && trap.found && !trap.disarmed && !trap.sprung) {
        // Crossing a trap you know about: Acrobatics against its DC to step around the trigger.
        const c = skillCheck(s.hero.skills.acrobatics ?? 0, trap.dc);
        log(`${s.hero.name} edges past the ${trap.name}. ${checkText('Acrobatics', c)}. ${c.ok ? 'Safely across.' : 'A misstep!'}`, c.ok ? 'good' : 'bad');
        if (!c.ok) sprang = true;
      }
      if (trap && (sprang || (!trap.found && !trap.disarmed && !trap.sprung))) {
        await springTrap(trap);
        if (s.hero.hp <= 0) { s.busy = false; showEnd('defeat'); return; }
        s.moveLeft = s.mode === 'combat' ? Math.max(0, s.moveLeft - costAt(p)) : s.hero.speed;
        updateVision(); s.busy = false; redraw();
        return; // the trap stops you in your tracks
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

  /** A hidden trap goes off: Dexterity saving throw for half damage. */
  async function springTrap(t) {
    t.found = true; t.sprung = true;
    play('trap', { volume: 0.9 });
    const dexSave = s.def.saves?.dex ?? s.hero.dexMod;
    const save = skillCheck(dexSave, t.saveDc);
    const dmg = roll(t.damage);
    const taken = save.ok ? Math.floor(dmg.total / 2) : dmg.total;
    s.hero.hp = Math.max(0, s.hero.hp - taken);
    float(s.hero.pos, `−${taken}`, 'bad', !save.ok);
    flashHit(s.hero);
    if (taken) play(cry(s.hero, s.hero.hp > 0 ? 'hurt' : 'death'), { delay: 150 });
    banner(t.text);
    log(`${t.text} ${s.hero.name} springs a ${t.name}! DEX save: d20 (${save.d20}) ${signed(dexSave)} = ${save.total} vs DC ${t.saveDc}. ${save.ok ? 'Half damage' : 'Full damage'}: ${taken} ${t.type} [${dmg.rolls.join(', ')}].`, 'bad');
    redraw(); await sleep(PAUSE_MS);
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
      if (!hasAmmo(w, target)) continue;
      const o = attackOptions(args(w));
      if (o) return { weapon: w, opts: o };
    }
    return null;
  }

  /** Bows need arrows (slings need stones). Point-blank melee and thrown weapons need none. */
  function hasAmmo(w, target) {
    if (!w.ammo || !s.draft) return true;
    if (w.melee && target && chebyshev(s.hero.pos, target.pos) <= 1) return true;
    return countOf(s.draft.inventory, w.ammo) > 0;
  }

  function whyNot(target) {
    if (s.hero.weapons.some((w) => w.ammo && !hasAmmo(w, target)) && !s.hero.weapons.some((w) => w.melee) ) return 'Out of ammunition.';
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
      if (!hasAmmo(w, target)) { banner(`No ${w.ammo.replace('-', ' ')} left for your ${w.name.toLowerCase()}.`); return; }
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
  const voiceOf = (e) => (e === s.hero ? `hero-${s.hero.voice}` : monsterVoice(BESTIARY_BY_ID[e.statId]));
  const cry = (e, what) => {
    const v = voiceOf(e);
    if (v.startsWith('hero')) return `${v}-${what}`;
    if (v === 'boss') return what === 'attack' ? 'boss-roar' : 'boss-hurt';
    return `${v}-${what}`;
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
    if (attacker === s.hero && ranged && weapon.ammo) {
      consume(s.draft.inventory, weapon.ammo, 1);
      s.ammoSpent[weapon.ammo] = (s.ammoSpent[weapon.ammo] ?? 0) + 1;
    }
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
      if (s.selectedId === target.id) s.selectedId = null;
      onKill(target);
    }
    if (target === s.hero && target.hp <= 0) play(cry(target, 'death'), { delay: 150 });
    redraw();
    await sleep(PAUSE_MS);
  }

  // ---------------------------------------------------------------------------
  // The way down
  // ---------------------------------------------------------------------------

  const onExit = () => s.map?.exit && chebyshev(s.hero.pos, s.map.exit) <= 1 && (s.revealAll || s.revealed.has(cellKey(s.map.exit.x, s.map.exit.y)));

  /** Take the stairs: a deeper floor (a new dungeon), with your wounds, loot and tally carried along. */
  function descend() {
    if (!onExit() || s.busy) return;
    if (s.mode === 'combat') { banner('You cannot slip away down the stairs while foes are on you.'); return; }
    const bonus = 25 * s.depth * (s.def?.level ?? 1);
    const carry = { hp: s.hero.hp, delve: s.delve };
    carry.delve.deepest = Math.max(carry.delve.deepest ?? 1, s.depth + 1);
    play('door-open', { volume: 0.6 });
    const next = ((s.seed * 7919 + s.depth * 104729) % 99991) + 1;
    s.depth += 1;
    newDungeon(next, carry);
    log(`New depth reached: +${bonus} XP for finding the way down.`, 'good');
    awardXp(bonus);
    banner(`Depth ${s.depth}`);
    redraw();
  }

  // ---------------------------------------------------------------------------
  // Rewards: experience and loot
  // ---------------------------------------------------------------------------

  /** A foe falls: award its XP at once, and roll what it carried (searched later from its body). */
  function onKill(m) {
    const stat = BESTIARY_BY_ID[m.statId];
    m.loot = rollMonsterLoot(stat);
    s.delve.kills++;
    const n = m.loot.items.length + (m.loot.coins ? 1 : 0);
    log(`${m.name} falls! +${stat.xp} XP.${n ? ' It carried something: search the body.' : ''}`, 'good');
    awardXp(stat.xp, m.pos);
  }

  function awardXp(xp, pos) {
    if (!xp || !s.draft) return;
    const r = api.gainXp(s.draft, xp);
    s.delve.xp += xp;
    float(pos ?? s.hero.pos, `+${xp} XP`, 'xp');
    refreshHero();
    if (r.to > r.from) {
      play('level-up', { delay: 500 });
      banner(`Level ${r.to}! ${s.hero.name} grows stronger.`);
      log(`LEVEL UP! ${s.hero.name} reaches level ${r.to}: ${s.hero.maxHp} hit points, proficiency bonus +${s.def.proficiencyBonus}.`, 'level');
    }
    persist();
  }

  /** Move loot from a body or chest into the pack. uid 'coins' takes the money; null takes everything. */
  function takeLoot(src, uid = null) {
    const loot = src.loot;
    let got = [];
    if ((uid === null || uid === 'coins') && loot.coins) {
      s.draft.coins = (s.draft.coins ?? 0) + loot.coins; s.delve.coins += loot.coins;
      got.push(formatCoins(loot.coins)); loot.coins = 0; play('coins', { volume: 0.8 });
    }
    for (const it of [...loot.items]) {
      if (uid !== null && it.uid !== uid) continue;
      addItem(s.draft.inventory, it);
      loot.items = loot.items.filter((x) => x !== it);
      s.delve.items++;
      got.push(`${itemName(it)}${(it.qty ?? 1) > 1 ? ` ×${it.qty}` : ''}`);
    }
    if (!got.length) return;
    if (uid !== 'coins') play('dice', { volume: 0.25 });
    log(`${s.hero.name} takes ${got.join(', ')}.`, 'loot');
    persist(); refreshHero(); redraw();
  }

  /** After a fight you can find about half of the arrows you shot (5e). */
  function recoverAmmo() {
    for (const [ammo, n] of Object.entries(s.ammoSpent)) {
      const back = Math.floor(n / 2);
      if (back) { addItem(s.draft.inventory, makeItemSafe(ammo, back)); log(`${s.hero.name} recovers ${back} of the ${n} ${ammo.replace('-', ' ')} shot.`, 'loot'); }
    }
    s.ammoSpent = {}; persist();
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
    setMood('dungeon');
    stinger(kind === 'victory' ? 'victory' : 'defeat');
    const el = $('.dg-endscreen');
    el.hidden = false;
    el.innerHTML = kind === 'victory'
      ? `<div class="dg-endcard"><h2>Depth ${s.depth} cleared</h2><p>Every foe on this floor of dungeon #${s.seed} has fallen. The stairs down still wait somewhere${s.exitSeen ? ' (you have seen them)' : ''}. ${esc(s.hero.name)} stands victorious with ${s.hero.hp} of ${s.hero.maxHp} hit points.</p>
        <p class="small">This delve: <b>${s.delve.kills}</b> foes slain · <b>${s.delve.xp.toLocaleString()}</b> XP · <b>${esc(formatCoins(s.delve.coins))}</b> · <b>${s.delve.items}</b> items looted. Bodies and chests you have not searched are still down there.</p><div class="row"><button class="btn primary" data-dg="close-end">Find the way down</button><button class="btn" data-dg="random">Start a new dungeon</button></div></div>`
      : `<div class="dg-endcard"><h2>${esc(s.hero.name)} has fallen</h2><p>The dark claims another hero... but legends are stubborn. Your experience and the loot you carried out are kept. Rest, and try again.</p><div class="row"><button class="btn primary" data-dg="retry">Try this dungeon again</button><button class="btn ghost" data-dg="random">Try a new dungeon</button></div></div>`;
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
      const k = cellKey(d.x, d.y);
      const cx = (d.x + 0.5) * sz; const cy = (d.y + 0.5) * sz;
      if (isSecret(k)) {
        // An undiscovered secret door looks like solid rock (the narrator view shows it dashed).
        out += `<rect x="${d.x * sz}" y="${d.y * sz}" width="${sz}" height="${sz}" class="secret-cover" style="fill:url(#dg-rock)"/>`;
        if (s.revealAll) out += `<rect x="${d.x * sz + 6}" y="${d.y * sz + 6}" width="${sz - 12}" height="${sz - 12}" rx="6" class="secret-hint"/>`;
        continue;
      }
      if (!s.revealAll && !s.revealed.has(k)) continue;
      if (isLocked(k)) out += `<text x="${cx}" y="${cy - sz * 0.32}" class="lock-glyph">🔒</text>`;
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
    const sz = S(); let out = `<defs><clipPath id="tk-clip" clipPathUnits="userSpaceOnUse"><circle r="${sz * 0.36}"/></clipPath></defs>`;
    out += drawDoors();
    // Reachable squares
    for (const c of s.reach.values()) if (c.cost > 0) out += `<rect x="${c.x * sz + 4}" y="${c.y * sz + 4}" width="${sz - 8}" height="${sz - 8}" rx="7" class="dg-reach"/>`;
    out += drawFog();
    out += drawFeatures();
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
      ${xpBar()}
      <div class="hc-purse">${coinsHtml(s.draft?.coins ?? 0)}</div>
      <div class="hc-actions">
        <button class="btn small" data-dg="inventory" title="Open your pack (I)">🎒 Pack</button>
        <button class="btn small" data-dg="bandage" ${countOf(s.draft?.inventory ?? [], 'bandage') && !s.busy ? '' : 'disabled'} title="Medicine check (DC 10): heal 1d6 + Medicine${s.mode === 'combat' ? '. Uses your action.' : ''}">🩹 Bandage <span class="muted">${countOf(s.draft?.inventory ?? [], 'bandage')}</span> <span class="muted">${signed(h.skills.medicine ?? 0)}</span></button>
        <button class="btn small" data-dg="search" ${s.busy ? 'disabled' : ''} title="Investigation check against hidden traps and secret doors nearby${s.mode === 'combat' ? '. Uses your action.' : ''}">🔍 Search <span class="muted">${signed(h.skills.investigation ?? 0)}</span></button>
      </div>
      ${s.lastCheck ? `<p class="study-result ${s.lastCheck.ok ? 'ok' : ''}">${esc(s.lastCheck.text)}</p>` : ''}
      <h4>Weapons</h4>
      <div class="hc-weapons">${h.weapons.map((w, i) => `
        <button class="weapon ${i === s.weaponIdx ? 'sel' : ''}" data-dg="weapon" data-i="${i}" aria-pressed="${i === s.weaponIdx}">
          <b>${esc(w.name)}</b><span>${signed(w.toHit)} to hit · ${esc(w.damage)} ${esc(w.type)}${w.ammo ? ` · ${countOf(s.draft.inventory, w.ammo)} ${esc(w.ammo.replace('-', ' '))}` : ''}</span>
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
    drawNearby();
    if (s.invOpen) drawInventory();
    $('.dg-initiative').innerHTML = combat ? `<h3>Initiative</h3><ol class="init">${s.order.map((o) => {
      const e = o.id === 'hero' ? h : s.monsters.find((m) => m.id === o.id);
      if (!e || e.dead) return '';
      return `<li class="${o.id === 'hero' ? 'me' : ''}"><b>${o.init}</b> ${esc(e.name)}${o.id === 'hero' ? '' : ` <span class="muted small">${canSee(e) ? woundState(e.hp, e.maxHp) : 'unseen'}</span>`}</li>`;
    }).join('')}</ol>` : '';
    $('.dg-log').innerHTML = s.log.map((l) => `<li class="${l.kind}">${esc(l.text)}</li>`).join('');
    $('.dg-zoom').textContent = `${Math.round(s.zoom * 100)}%`;
  }

  // ---------------------------------------------------------------------------
  // Skills: bandages, potions, searching, locks and traps
  // ---------------------------------------------------------------------------

  /** In combat most of these take your action; out of combat they just take a moment. */
  function spendAction(what) {
    if (s.busy) return false;
    if (s.mode === 'combat') {
      if (s.actionUsed) { banner(`${what} takes your action, and you have used it this turn.`); return false; }
      s.actionUsed = true;
    }
    return true;
  }
  const checkText = (label, c) => `${label}: ${c.d20s.length > 1 ? `d20 (${c.d20s.join(', ')} → ${c.d20})` : `d20 (${c.d20})`} ${signed(c.bonus)} = ${c.total} vs DC ${c.dc}`;
  const hasTools = () => (s.draft.inventory.find((x) => x.id === 'thieves-tools' && (x.charges ?? 1) > 0) ?? null);

  function heal(amount, source) {
    const before = s.hero.hp;
    s.hero.hp = Math.min(s.hero.maxHp, s.hero.hp + Math.max(0, amount));
    float(s.hero.pos, `+${s.hero.hp - before}`, 'heal');
    return s.hero.hp - before;
  }

  /** Bandage (Ultima Online style healing): a Medicine check; success heals 1d6 + your Medicine bonus. */
  function bandage() {
    const inst = findItem(s.draft.inventory, 'bandage');
    if (!inst) { banner('You have no bandages.'); return; }
    if (s.hero.hp >= s.hero.maxHp) { banner('You are not wounded.'); return; }
    if (!spendAction('Bandaging')) return;
    const bonus = s.hero.skills.medicine ?? 0;
    const kit = !!findItem(s.draft.inventory, 'healers-kit');
    const c = skillCheck(bonus, 10, { mode: kit ? 'advantage' : 'normal' });
    removeItem(s.draft.inventory, inst.uid, 1);
    play('bandage', { volume: 0.8 });
    if (c.ok) {
      const r = roll('1d6');
      const got = heal(r.total + Math.max(0, bonus), 'bandage');
      log(`${s.hero.name} binds their wounds. ${checkText('Medicine', c)}${kit ? ' (healer\'s kit: advantage)' : ''}. Success: heals 1d6 (${r.total}) + ${Math.max(0, bonus)} = ${got} HP.`, 'heal');
    } else {
      log(`${s.hero.name} fumbles the bandage. ${checkText('Medicine', c)}. The bandage is wasted.`, 'info');
      float(s.hero.pos, 'fumbled', 'muted');
    }
    s.lastCheck = { text: `${checkText('Medicine', c)}: ${c.ok ? 'healed' : 'wasted'}`, ok: c.ok };
    persist(); redraw();
  }

  function useItem(uid) {
    const inst = s.draft.inventory.find((x) => x.uid === uid);
    const def = itemDef(inst);
    if (!def?.use) return;
    if (def.use.kind === 'bandage') { bandage(); return; }
    if (def.use.kind === 'light') { raisePhial(); return; }
    if (def.use.kind === 'heal') {
      if (s.hero.hp >= s.hero.maxHp) { banner('You are not wounded.'); return; }
      if (!spendAction(`Using ${def.name.toLowerCase()}`)) return;
      const r = roll(def.use.dice);
      removeItem(s.draft.inventory, uid, 1);
      play(def.cat === 'consumable' && /potion/.test(def.id) ? 'potion' : 'bandage', { volume: 0.8 });
      const got = heal(r.total);
      log(`${s.hero.name} uses ${def.name.toLowerCase()}: ${def.use.dice} = ${r.total}, regains ${got} HP.`, 'heal');
      persist(); redraw();
    }
  }

  /** Search: an Investigation check against every hidden trap and secret door nearby. */
  function search() {
    if (!spendAction('Searching')) return;
    const bonus = s.hero.skills.investigation ?? 0;
    const c = skillCheck(bonus, 0, { mode: s.def.keenSearch ? 'advantage' : 'normal' });
    play('dice', { volume: 0.6 });
    const found = []; let missed = 0;
    for (const t of s.features.traps) {
      if (t.found || t.sprung || chebyshev(t, s.hero.pos) > 6 || !s.visible.has(cellKey(t.x, t.y))) continue;
      if (c.total >= t.dc) { t.found = true; found.push(`a ${t.name}`); } else missed++;
    }
    for (const k of [...s.features.secretDoors]) {
      const [x, y] = k.split(',').map(Number);
      if (chebyshev({ x, y }, s.hero.pos) > 4) continue;
      if (c.total >= secretDC()) { revealSecret(k); found.push('a secret door'); } else missed++;
    }
    const roll20 = `Investigation${s.def.keenSearch ? ' (Burglar\'s Eye: advantage)' : ''}: ${c.d20s.length > 1 ? `d20 (${c.d20s.join(', ')} → ${c.d20})` : `d20 (${c.d20})`} ${signed(bonus)} = ${c.total}`;
    log(`${s.hero.name} searches the area. ${roll20}. ${found.length ? `Found ${found.join(', ')}!` : 'Nothing found.'}`, found.length ? 'good' : 'info');
    s.lastCheck = { text: `${roll20}: ${found.length ? `found ${found.join(', ')}` : 'nothing found here'}`, ok: !!found.length };
    if (!found.length) banner(missed ? 'You find nothing... yet something feels off.' : 'You find nothing hidden here.');
    redraw();
  }

  function raisePhial() {
    if (s.phialUsed) { banner('The phial\'s light needs time to gather again (once per delve).'); return; }
    s.phialUsed = true;
    const found = [];
    for (const t of s.features.traps) if (!t.found && s.visible.has(cellKey(t.x, t.y))) { t.found = true; found.push(t.name); }
    for (const k of [...s.features.secretDoors]) { const [x, y] = k.split(',').map(Number); if (chebyshev({ x, y }, s.hero.pos) <= 8) { revealSecret(k); found.push('secret door'); } }
    play('potion', { volume: 0.6 });
    log(`Silver light pours from the phial! ${found.length ? `It reveals: ${found.join(', ')}.` : 'Nothing is hidden nearby.'}`, 'good');
    redraw();
  }

  const lockLabel = (t) => (t.kind === 'chest' ? 'the chest' : 'the door');
  function lockOf(t) {
    if (t.kind === 'chest') { const c = s.features.chests.find((x) => x.id === t.id); return c?.locked ? { dc: c.dc, obj: c } : null; }
    const l = s.features.locks.get(t.id); return l ? { dc: l.dc, obj: l } : null;
  }
  function unlock(t) {
    if (t.kind === 'chest') s.features.chests.find((x) => x.id === t.id).locked = false;
    else s.features.locks.delete(t.id);
  }

  /** Pick a lock: DEX check, plus proficiency if trained with thieves' tools. A bad failure snaps a pick. */
  function pickLock(t) {
    const lock = lockOf(t); if (!lock) return;
    const tools = hasTools();
    if (!tools) { banner('You need thieves\' tools (with picks left) to pick a lock.'); return; }
    if (!spendAction('Picking a lock')) return;
    const bonus = s.def.toolBonus;
    const c = skillCheck(bonus, lock.dc);
    play('lockpick', { volume: 0.8 });
    let extra = '';
    if (c.ok) unlock(t);
    else if (c.margin <= -5) { tools.charges = (tools.charges ?? 10) - 1; extra = ` A pick snaps! (${tools.charges} left)`; }
    const text = `${checkText('Thieves\' tools (DEX)', c)}. ${c.ok ? `The lock of ${lockLabel(t)} clicks open.` : 'The lock resists.'}${extra}`;
    log(`${s.hero.name} picks the lock. ${text}`, c.ok ? 'good' : 'info');
    s.lastCheck = { text, ok: c.ok };
    persist(); redraw();
  }

  /** Force a lock: Strength (Athletics). A crowbar gives advantage. It is loud: nearby foes come to look. */
  function forceLock(t) {
    const lock = lockOf(t); if (!lock) return;
    if (!spendAction('Forcing a lock')) return;
    const bonus = s.hero.skills.athletics ?? 0;
    const bar = !!findItem(s.draft.inventory, 'crowbar');
    const c = skillCheck(bonus, lock.dc + 2, { mode: bar ? 'advantage' : 'normal' });
    play(c.ok ? 'door-open' : 'swing-miss', { volume: 0.9 });
    if (c.ok) unlock(t);
    const text = `${checkText(`Athletics${bar ? ' (crowbar: advantage)' : ''}`, c)}. ${c.ok ? `${lockLabel(t)[0].toUpperCase()}${lockLabel(t).slice(1)} bursts open with a crash!` : 'It holds.'}`;
    log(`${s.hero.name} tries to force ${lockLabel(t)}. ${text}`, c.ok ? 'good' : 'info');
    s.lastCheck = { text, ok: c.ok };
    makeNoise(8);
    persist(); redraw();
  }

  /** Noise wakes foes within `radius` squares: they come looking for you. */
  function makeNoise(radius) {
    // Only foes with a way to reach you come running (a walk of up to ~4 turns).
    const blocked = new Set([...terrainBlocked()]);
    const near = alive().filter((m) => !m.aware && chebyshev(m.pos, s.hero.pos) <= radius);
    const woken = near.filter((m) => [...reachableSquares(s.map, m.pos, m.speed * 4, { blocked }).values()].some((c) => chebyshev(c, s.hero.pos) <= 1));
    if (!woken.length) return;
    woken.forEach((m) => { m.aware = true; });
    log('The noise echoes through the halls... something stirs.', 'warn');
    banner('Something heard that!');
    enterCombat(woken);
  }

  function disarm(trap) {
    const tools = hasTools();
    if (!tools) { banner('You need thieves\' tools to disarm a trap.'); return; }
    if (!spendAction('Disarming a trap')) return;
    const c = skillCheck(s.def.toolBonus, trap.dc);
    play('lockpick', { volume: 0.7 });
    if (c.ok) {
      trap.disarmed = true;
      log(`${s.hero.name} disarms the ${trap.name}. ${checkText('Thieves\' tools (DEX)', c)}.`, 'good');
      s.lastCheck = { text: `${checkText('Thieves\' tools', c)}: disarmed`, ok: true };
      awardXp(10 * (s.def.level ?? 1), trap);
      s.target = null;
    } else if (c.margin <= -5) {
      log(`${s.hero.name} slips while disarming the ${trap.name}! ${checkText('Thieves\' tools (DEX)', c)}.`, 'bad');
      trap.found = false; springTrap(trap); s.target = null;
    } else {
      log(`${s.hero.name} cannot work out the ${trap.name}'s mechanism. ${checkText('Thieves\' tools (DEX)', c)}.`, 'info');
      s.lastCheck = { text: `${checkText('Thieves\' tools', c)}: not yet`, ok: false };
    }
    redraw();
  }

  function openChest(c) {
    if (c.locked) { banner('The chest is locked.'); return; }
    if (!c.opened) {
      c.opened = true;
      c.loot = rollChestLoot(s.def.level ?? 1);
      play('chest-open', { volume: 0.9 });
      log(`${s.hero.name} opens a chest.`, 'loot');
    }
    s.target = { kind: 'chest', id: c.id };
    redraw();
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
      ${!combat ? '<p class="small muted">Attacks are made on your turn in combat.</p>' : s.actionUsed ? '<p class="small muted">You have used your action this turn.</p>' : '<p class="small muted">Tip: click the selected foe again to attack with your best weapon.</p>'}
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

  function xpBar() {
    const d = s.def; if (!d) return '';
    const p = xpProgress(d.xp, d.level);
    return `<div class="hc-xp" title="${d.level >= 20 ? 'Maximum level' : `${p.needed - p.into} XP to level ${d.level + 1}`}">
      <span class="lvl">Lv ${d.level}</span><span class="bar"><span style="width:${p.fraction * 100}%"></span></span>
      <span class="small muted">${d.xp.toLocaleString()} XP</span></div>`;
  }

  /** Things within reach you can interact with: bodies, chests, locked doors, traps. */
  function nearbyThings() {
    if (!s.hero || !s.features) return [];
    const list = [];
    if (onExit()) list.push({ kind: 'stairs', id: 'down', label: `Take the stairs down to depth ${s.depth + 1}`, glyph: '⬇' });
    for (const m of s.monsters) if (m.dead && m.loot && (m.loot.coins || m.loot.items.length) && adjacent(m.pos)) list.push({ kind: 'corpse', id: m.id, label: `Search the ${m.name.toLowerCase()}'s body`, glyph: '💰' });
    for (const c of s.features.chests) if (adjacent(c) && !(c.opened && !c.loot?.coins && !c.loot?.items.length)) list.push({ kind: 'chest', id: c.id, label: c.locked ? 'Locked chest' : c.opened ? 'Open chest' : 'Chest', glyph: c.locked ? '🔒' : '🧰' });
    for (const [k] of s.features.locks) { const [x, y] = k.split(',').map(Number); if (adjacent({ x, y }) && s.revealed.has(k)) list.push({ kind: 'door', id: k, label: 'Locked door', glyph: '🔒' }); }
    for (const t of s.features.traps) if (t.found && !t.disarmed && !t.sprung && chebyshev(t, s.hero.pos) <= 1) list.push({ kind: 'trap', id: t.id, label: `${t.name[0].toUpperCase()}${t.name.slice(1)}`, glyph: '⚠' });
    return list;
  }

  function drawNearby() {
    const list = nearbyThings();
    $('.dg-nearby').innerHTML = list.length ? `<h3>Within reach</h3><div class="nearby">${list.map((t) => `<button class="btn small ${s.target?.kind === t.kind && s.target.id === t.id ? 'primary' : ''}" data-dg="pick-target" data-kind="${t.kind}" data-id="${esc(t.id)}">${t.glyph} ${esc(t.label)}</button>`).join('')}</div>` : '';
  }

  /** Panel for a chest, locked door, trap or body. */
  function interactPanel(t) {
    const close = '<button class="btn icon small" data-dg="close-loot" aria-label="Close">✕</button>';
    const near = (p) => chebyshev(s.hero.pos, p) <= 1;
    const combatNote = s.mode === 'combat' ? ' · uses your action' : '';
    const tools = hasTools();
    const lockButtons = (lock) => `
      <div class="studies">
        <button class="study" data-dg="pick-lock" ${tools ? '' : 'disabled'}><b>Pick the lock</b> <span class="muted">DEX ${signed(s.def.toolBonus)} vs DC ${lock.dc} · ${Math.round(checkChance(s.def.toolBonus, lock.dc) * 100)}%</span><span>${tools ? `Thieves' tools (${tools.charges ?? '∞'} picks)${combatNote}` : 'Needs thieves\' tools'}</span></button>
        <button class="study" data-dg="force-lock"><b>Force it open</b> <span class="muted">Athletics ${signed(s.hero.skills.athletics ?? 0)} vs DC ${lock.dc + 2}${findItem(s.draft.inventory, 'crowbar') ? ' · crowbar: advantage' : ''}</span><span>Loud: nearby foes will hear${combatNote}</span></button>
      </div>`;
    if (t.kind === 'corpse') {
      const m = s.monsters.find((x) => x.id === t.id);
      if (!m) return '';
      if (!near(m.pos)) return `<div class="loot-card"><div class="foe-head"><h3>${esc(m.name)}'s body</h3>${close}</div><p class="small muted">Move next to the body to search it.</p></div>`;
      return lootHtml({ title: `${m.name}'s body`, coins: m.loot.coins, items: m.loot.items });
    }
    if (t.kind === 'chest') {
      const c = s.features.chests.find((x) => x.id === t.id);
      if (!c) return '';
      if (!near(c)) return `<div class="loot-card"><div class="foe-head"><h3>Chest</h3>${close}</div><p class="small muted">Move next to the chest to open it.</p></div>`;
      if (c.locked) return `<div class="loot-card"><div class="foe-head"><h3>🔒 Locked chest</h3>${close}</div><p class="small">A heavy iron-bound chest with a stout lock.</p>${lockButtons(c)}</div>`;
      if (!c.opened) return `<div class="loot-card"><div class="foe-head"><h3>Chest</h3>${close}</div><button class="btn small primary" data-dg="open-chest">Open it</button></div>`;
      return lootHtml({ title: 'Chest', coins: c.loot.coins, items: c.loot.items });
    }
    if (t.kind === 'door') {
      const lock = s.features.locks.get(t.id);
      if (!lock) return '';
      const [x, y] = t.id.split(',').map(Number);
      if (!near({ x, y })) return `<div class="loot-card"><div class="foe-head"><h3>🔒 Locked door</h3>${close}</div><p class="small muted">Move next to the door to work on its lock.</p></div>`;
      return `<div class="loot-card"><div class="foe-head"><h3>🔒 Locked door</h3>${close}</div><p class="small">An oak door bound in iron. It will not budge.</p>${lockButtons(lock)}</div>`;
    }
    if (t.kind === 'trap') {
      const tr = s.features.traps.find((x) => x.id === t.id);
      if (!tr) return '';
      const state = tr.disarmed ? 'Disarmed: safe to cross.' : tr.sprung ? 'Already sprung.' : 'Armed. Your path will go around it.';
      return `<div class="loot-card"><div class="foe-head"><h3>⚠ ${esc(tr.name[0].toUpperCase() + tr.name.slice(1))}</h3>${close}</div>
        <p class="small">${state} Deals ${esc(tr.damage)} ${esc(tr.type)} (DEX save DC ${tr.saveDc} for half).</p>
        ${!tr.disarmed && !tr.sprung ? (near(tr) ? `<div class="studies"><button class="study" data-dg="disarm" ${tools ? '' : 'disabled'}><b>Disarm it</b> <span class="muted">DEX ${signed(s.def.toolBonus)} vs DC ${tr.dc} · ${Math.round(checkChance(s.def.toolBonus, tr.dc) * 100)}%</span><span>${tools ? `Fail by 5 or more and it goes off!${combatNote}` : 'Needs thieves\' tools'}</span></button></div>` : '<p class="small muted">Move next to it to try disarming it.</p>') : ''}</div>`;
    }
    return '';
  }

  function drawInventory() {
    const box = $('.dg-inv');
    box.hidden = !s.invOpen;
    if (!s.invOpen || !s.draft) return;
    box.innerHTML = `<div class="dg-inv-card">
      <button class="btn icon small dg-inv-close" data-inv="close" aria-label="Close inventory">✕</button>
      ${inventoryHtml(s.draft, { str: s.def.str, selected: s.invSel, filter: s.invFilter, combat: s.mode === 'combat', title: `${s.hero.name}'s pack` })}
      ${s.def.gearNotes?.length ? `<ul class="gear-notes small">${s.def.gearNotes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}
    </div>`;
  }

  function drawTargetInfo() {
    const box = $('.dg-target');
    const sel = s.selectedId && s.monsters.find((m) => m.id === s.selectedId && !m.dead && canSee(m));
    if (sel) { box.innerHTML = foePanel(sel); return; }
    if (s.target) { const html = interactPanel(s.target); if (html) { box.innerHTML = html; return; } s.target = null; }
    const hov = s.hover;
    if (!hov || !s.hero) { box.innerHTML = '<p class="muted small">Click a foe to see its portrait, attack it or study it. Click chests, locked doors, traps and bodies next to you. Hover to check distances.</p>'; return; }
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
      ${c && c.cost > 0 ? `<p class="small">${c.cost} square${c.cost === 1 ? '' : 's'} away (${c.cost * s.map.feetPerCell} ft). Click to move.${c.risky ? ' <b>The only way crosses a known trap: you will need an Acrobatics check.</b>' : ''}</p>` : ''}
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
    const k = cellKey(c.x, c.y);
    const known = s.revealAll || s.revealed.has(k);
    if (s.map.exit && c.x === s.map.exit.x && c.y === s.map.exit.y && onExit() && s.mode !== 'combat') { descend(); return; }
    const body = corpseAt(c.x, c.y);
    if (body && chebyshev(s.hero.pos, body.pos) <= 1) { s.target = { kind: 'corpse', id: body.id }; redraw(); return; }
    const chest = known && chestAt(c.x, c.y);
    if (chest) {
      if (adjacent(chest) && !chest.locked && !chest.opened) { openChest(chest); return; }
      s.target = { kind: 'chest', id: chest.id }; redraw(); return;
    }
    if (known && isLocked(k)) { s.target = { kind: 'door', id: k }; redraw(); return; }
    const trap = trapAt(c.x, c.y);
    if (trap && trap.found && !trap.disarmed && !trap.sprung) { s.target = { kind: 'trap', id: trap.id }; redraw(); return; }
    const t = s.reach.get(k);
    if (t && t.cost > 0) { s.target = null; moveHero(t); }
  }

  function handleInventory(el) {
    const uid = el.dataset.uid;
    const inst = s.draft.inventory.find((x) => x.uid === uid);
    switch (el.dataset.inv) {
      case 'close': s.invOpen = false; $('.dg-inv').hidden = true; viewport.focus(); return;
      case 'filter': s.invFilter = el.dataset.filter; break;
      case 'select': s.invSel = uid || null; s.dropArm = null; break;
      case 'equip': {
        const r = equipItem(s.draft, uid, el.dataset.slot);
        if (r.ok) { play('sword-hit', { volume: 0.25 }); log(`${s.hero.name}: ${r.message}`, 'info'); persist(); refreshHero(); } else banner(r.message);
        break;
      }
      case 'unequip': {
        const slot = Object.entries(s.draft.equipped ?? {}).find(([, u]) => u === uid)?.[0];
        if (slot) { unequipSlot(s.draft, slot); log(`${s.hero.name} puts away the ${itemName(inst).toLowerCase()}.`, 'info'); persist(); refreshHero(); }
        break;
      }
      case 'use': useItem(uid); break;
      case 'drop':
        if (s.dropArm !== uid) { s.dropArm = uid; banner(`Click Drop again to leave the ${itemName(inst).toLowerCase()} behind.`); return; }
        if (isEquipped(s.draft, uid)) { const slot = Object.entries(s.draft.equipped).find(([, u]) => u === uid)[0]; unequipSlot(s.draft, slot); }
        removeItem(s.draft.inventory, uid);
        log(`${s.hero.name} drops the ${itemName(inst).toLowerCase()}.`, 'info');
        s.invSel = null; s.dropArm = null; persist(); refreshHero();
        break;
      default:
    }
    redraw();
  }

  host.addEventListener('click', (e) => {
    const el = e.target.closest('[data-inv]');
    if (el && !el.disabled && s.draft) handleInventory(el);
  });

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
      case 'inventory': s.invOpen = !s.invOpen; redraw(); break;
      case 'bandage': bandage(); break;
      case 'search': search(); break;
      case 'pick-target': if (el.dataset.kind === 'stairs') { descend(); break; } s.selectedId = null; s.target = { kind: el.dataset.kind, id: el.dataset.id }; if (el.dataset.kind === 'chest') { const c = s.features.chests.find((x) => x.id === el.dataset.id); if (c && !c.locked && !c.opened) { openChest(c); break; } } redraw(); break;
      case 'close-loot': s.target = null; redraw(); break;
      case 'open-chest': { const c = s.features.chests.find((x) => x.id === s.target?.id); if (c) openChest(c); break; }
      case 'pick-lock': if (s.target) pickLock(s.target); break;
      case 'force-lock': if (s.target) forceLock(s.target); break;
      case 'disarm': { const t = s.features.traps.find((x) => x.id === s.target?.id); if (t) disarm(t); break; }
      case 'take': case 'take-all': {
        const src = s.target?.kind === 'corpse' ? s.monsters.find((m) => m.id === s.target.id) : s.target?.kind === 'chest' ? s.features.chests.find((c) => c.id === s.target.id) : null;
        if (src?.loot) takeLoot(src, el.dataset.dg === 'take-all' ? null : el.dataset.uid);
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
    else if (e.key === 'i' || e.key === 'I') { s.invOpen = !s.invOpen; redraw(); }
    else if (e.key === 'Escape' && s.invOpen) { s.invOpen = false; redraw(); }
    else if (e.key === 'Escape' && (s.selectedId || s.target)) { s.selectedId = null; s.target = null; redraw(); }
  };
  window.addEventListener('keydown', onKey);

  if (!heroes.length) { host.querySelector('.dg-help').textContent = 'Create or adopt a hero first.'; }
  preload(SOUND_KEYS);
  newDungeon(s.seed);
}
