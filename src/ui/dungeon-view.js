/**
 * Dungeon delve: fog of war, line of sight, facing, and turn-based battles with goblins.
 *
 * The base map (textures, walls, grid) is drawn once per dungeon. Everything that changes
 * (doors, fog, highlights, tokens, damage numbers) lives in a light SVG overlay redrawn
 * after every step.
 */
import { generateDungeon, roomAt, TILE } from '../engine/dungeon.js';
import { renderDungeonSVG } from '../engine/dungeon-render.js';
import { renderArenaSVG } from '../engine/arena-render.js';
import { cellsOf, blockDistance, centerOf } from '../engine/size.js';
import { reachableSquares, speedToSquares, DIAGONAL_RULES, cellKey } from '../engine/movement.js';
import { makeOpacity, visibleSquares, revealFrom } from '../engine/vision.js';
import {
  FACINGS, facingToward, rotateFacing, facingAngle, chebyshev, weaponFromHeroAttack, placeMonsters,
  rollInitiative, planMonsterTurn, attackOptions, resolveAttack, woundState, createMonster, entityDistance, covers, reachOf, bestSight,
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
import { lineOfSight } from '../engine/vision.js';
import {
  freshResources, lowestSlot, spellDice, spellCount, addDice, sneakAttackDice, inspirationDie, monsterSave, concentrationDC,
  skillXp, shortRest, longRest, wanderingCheck, arcaneRecovery, slotsFor,
} from '../engine/magic.js';
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
export function mountDungeon(host, { heroes, api, initialSeed = 7, arena = null, onLeave = null }) {
  const s = {
    seed: initialSeed, map: null, grid: true, revealAll: !!arena, rule: 'standard', zoom: 0.5,
    partyIds: arena ? arena.heroes.map((h) => h.id) : heroes.slice(0, 1).map((h) => h.id), members: [], active: 0,
    hero: null, monsters: [],
    doors: new Map(), revealed: new Set(), visible: new Set(),
    mode: 'explore', round: 0, order: [], turnIdx: 0,
    moveLeft: 0, actionUsed: false, dash: false, weaponIdx: 0,
    hover: null, busy: false, log: [], floats: [], reach: new Map(),
    selectedId: null, knowledge: {}, knownHp: new Set(), lunge: null, flash: new Set(), projectile: null, lastStudy: null,
    draft: null, def: null, features: null, target: null, invOpen: false, invSel: null, invFilter: 'all',
    ammoSpent: {}, delve: { xp: 0, coins: 0, items: 0, kills: 0 }, lastCheck: null, phialUsed: false,
    vfx: [], effects: [],
    res: null, buffs: {}, bonusUsed: false, attacksLeft: 0, sneakUsed: false, disengaged: false, sneak: null, pending: null, blast: null, longRested: false,
  };

  host.innerHTML = `
    <div class="dg-topbar">
      <div class="dg-group dg-partypick" ${arena ? 'hidden' : ''}>
        <span class="small muted">Party (up to 4):</span>
        ${heroes.map((h) => `<label class="chip party-chip"><input type="checkbox" data-dg="party" value="${esc(h.id)}" ${h === heroes[0] ? 'checked' : ''}> ${esc(h.label)}</label>`).join('')}
      </div>
      <div class="dg-group dg-arenabar" ${arena ? '' : 'hidden'}>
        <b>${esc(arena?.name ?? 'Arena')}</b>
        <button class="btn small" data-dg="leave-arena">← Back to the builder</button>
        <button class="btn small ghost" data-dg="retry">Restart bout</button>
      </div>
      <div class="dg-group" ${arena ? 'hidden' : ''}>
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
      <div class="dg-group" ${arena ? 'hidden' : ''}>
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
    <div class="dg-inv" hidden role="dialog" aria-label="Inventory"></div>
    <div class="dg-pop" hidden role="dialog" aria-modal="true"></div>`;

  const $ = (sel) => host.querySelector(sel);
  const viewport = $('.dg-viewport'); const stage = $('.dg-stage');
  const base = $('.dg-base'); const overlay = $('.dg-overlay');
  const S = () => s.map.cellSize;

  // ---------------------------------------------------------------------------
  // Setup
  // ---------------------------------------------------------------------------

  // ---------------------------------------------------------------------------
  // The party. Each member keeps its own copy of the per-hero state below; the member whose
  // turn it is (or who leads while exploring) is "active", and its state lives directly on `s`.
  // Switching members saves those fields into the old member and loads the new one's.
  // ---------------------------------------------------------------------------
  const MKEYS = ['draft', 'def', 'hero', 'res', 'buffs', 'actionUsed', 'bonusUsed', 'attacksLeft', 'moveLeft', 'dash', 'sneakUsed', 'disengaged',
    'weaponIdx', 'ammoSpent', 'pending', 'phialUsed', 'invSel'];
  function saveActive() { const m = s.members[s.active]; if (m) for (const k of MKEYS) m[k] = s[k]; }
  function activate(i) {
    if (!s.members[i] || (i === s.active && s.members[i].hero === s.hero)) return;
    saveActive(); s.active = i;
    for (const k of MKEYS) s[k] = s.members[i][k];
  }
  const party = () => s.members.map((m) => m.hero).filter(Boolean);
  const partyAlive = () => party().filter((h) => h.hp > 0);
  const memberIndex = (hero) => s.members.findIndex((m) => m.hero === hero);
  const partyDown = () => s.members.length > 0 && partyAlive().length === 0;

  /** Free squares near a point (breadth-first), for placing the party at the stairs. */
  function freeNear(p, n) {
    const out = []; const seen = new Set([cellKey(p.x, p.y)]); const q = [p];
    const taken = new Set(s.monsters.map((m) => cellKey(m.pos.x, m.pos.y)));
    while (q.length && out.length < n) {
      const c = q.shift();
      if (isFloor(c.x, c.y) && !taken.has(cellKey(c.x, c.y))) out.push(c);
      for (const [dx, dy] of [[0, -1], [1, 0], [-1, 0], [0, 1], [1, -1], [-1, -1], [1, 1], [-1, 1]]) {
        const k = cellKey(c.x + dx, c.y + dy);
        if (!seen.has(k) && isFloor(c.x + dx, c.y + dy)) { seen.add(k); q.push({ x: c.x + dx, y: c.y + dy }); }
      }
    }
    return out;
  }
  const isFloor = (x, y) => s.map.tiles[y]?.[x] !== undefined && s.map.tiles[y][x] !== TILE.ROCK && s.map.tiles[y][x] !== TILE.DOOR
    && !(s.map.terrain && s.map.terrain[y][x] === 'river');

  /** Build one member: load the hero's saved draft (gear, coins, XP) and derive combat stats. */
  function makeMember(i, id, pos, carried) {
    s.draft = api.load(id);
    s.def = s.draft ? api.derive(s.draft) : null;
    const h = s.def;
    if (!h) return null;
    const weapons = heroWeapons(h);
    s.hero = {
      id: `hero${i}`, isHero: true, name: h.name, pos, facing: 0,
      hp: h.maxHp, maxHp: h.maxHp, ac: h.ac, dexMod: h.dexMod, speed: speedToSquares(h.speed, s.map.feetPerCell),
      weapons, reaction: true, aware: true, tempHp: 0,
      look: h.look, voice: h.look?.voice ?? 'low', skills: h.skills ?? {},
    };
    if (carried) s.hero.hp = Math.min(s.hero.maxHp, carried.hp);
    s.weaponIdx = Math.max(0, weapons.findIndex((w) => w.melee));
    // Spell slots, ability uses and hit dice last for the whole delve and come back with rests.
    s.res = carried?.res ?? { ...freshResources(magicHero()), level: h.level };
    s.buffs = carried?.buffs ?? {};
    s.ammoSpent = {}; s.pending = null; s.phialUsed = false; s.invSel = null;
    s.actionUsed = false; s.bonusUsed = false; s.attacksLeft = 0; s.moveLeft = s.hero.speed; s.dash = false; s.sneakUsed = false; s.disengaged = false;
    refreshAC();
    const m = {}; for (const k of MKEYS) m[k] = s[k];
    return m;
  }

  /** Load every member of the party. `positions` (arena) or a cluster around the stairs. */
  function loadParty(carry, positions = null) {
    s.members = []; s.active = 0;
    const spots = positions ?? freeNear(s.map.entrance, s.partyIds.length);
    s.partyIds.forEach((id, i) => {
      const m = makeMember(i, id, { ...(spots[i] ?? s.map.entrance) }, carry?.members?.[i]);
      if (m) s.members.push(m);
    });
    s.active = 0;
    if (s.members[0]) for (const k of MKEYS) s[k] = s.members[0][k];
  }

  const heroWeapons = (def) => (def?.attacks ?? []).map((a) => ({ ...weaponFromHeroAttack(a), ammo: a.ammo, uid: a.uid, slot: a.slot, finesse: (a.properties ?? []).includes('finesse') }));

  /** Save the hero after loot, XP or gear changes. A ready-made hero is adopted into your company. */
  function persist() {
    if (!s.draft || arena) return; // arena bouts are practice: nothing is saved
    const saved = api.save(s.draft);
    if (saved && saved.id !== s.draft.id) {
      const box = host.querySelector(`[data-dg="party"][value="${CSS.escape(s.draft.id)}"]`);
      const h = heroes.find((x) => x.id === s.draft.id);
      if (h) { h.id = saved.id; h.label = h.label.replace(' (ready-made)', ''); }
      if (box) { box.value = saved.id; box.parentElement.lastChild.textContent = ` ${h?.label ?? saved.name}`; }
      s.partyIds = s.partyIds.map((x) => (x === s.draft.id ? saved.id : x));
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
    if (s.res && s.res.level !== d.level) growResources();
    refreshAC();
    s.weaponIdx = Math.min(s.weaponIdx, Math.max(0, s.hero.weapons.length - 1));
  }

  function newDungeon(seed, carry = null) {
    if (!carry) s.depth = 1;
    s.seed = Math.max(1, Math.floor(seed) || 1);
    s.map = arena ? arena.map : generateDungeon(s.seed);
    $('#dg-seed').value = s.seed;
    base.innerHTML = arena ? renderArenaSVG(s.map, { grid: s.grid }) : renderDungeonSVG(s.map, { grid: s.grid, labels: true, doors: false });
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
    s.monsters = [];
    if (arena) {
      loadParty(null, arena.heroes.map((h) => ({ ...h.pos })));
      s.features = { chests: [], traps: [], secretDoors: new Set(), locks: new Map() };
      s.monsters = arena.foes.map((f, i) => {
        const stat = BESTIARY_BY_ID[f.statId];
        return { ...createMonster(stat, `m${i + 1}`, { ...f.pos }, f.facing ?? 4), aware: true };
      }).filter(Boolean);
    } else {
      loadParty(carry);
      // Its secrets are fixed by the dungeon's number; its inhabitants are matched to the party's
      // level and size, and every two floors deeper the danger rises as if a level higher.
      const lv = party().length ? Math.round(s.members.reduce((t, m) => t + m.def.level, 0) / s.members.length) : 1;
      const level = Math.min(20, lv + Math.floor(((s.depth ?? 1) - 1) / 2));
      s.features = placeFeatures(s.map, s.seed, level);
      const avoid = new Set([...s.features.chests.map((c) => cellKey(c.x, c.y)), cellKey(s.map.exit.x, s.map.exit.y), ...party().map((h) => cellKey(h.pos.x, h.pos.y))]);
      s.monsters = populateDungeon(s.map, s.seed, level, FOE_POOL, { avoid, partySize: Math.max(1, s.members.length) });
    }
    s.sneak = null; s.longRested = false; s.effects = []; s.vfx = [];
    s.doors = new Map(); s.revealed = new Set(); s.log = []; s.floats = [];
    s.selectedId = null; s.knowledge = {}; s.knownHp = new Set(); s.lastStudy = null; s.target = null; s.lastCheck = null;
    s.delve = carry?.delve ?? { xp: 0, coins: 0, items: 0, kills: 0, deepest: 1 }; s.invOpen = false;
    s.mode = 'explore'; s.order = []; s.round = 0; s.busy = false; s.exitSeen = false;
    $('.dg-endscreen').hidden = true; $('.dg-inv').hidden = true; $('.dg-pop').hidden = true;
    setMood(arena ? 'combat' : 'dungeon');
    startHeroTurn();
    const names = party().map((h) => h.name).join(', ') || 'Your hero';
    if (arena) {
      log(`The arena gates open. ${names} face ${s.monsters.map((m) => m.name).join(', ')}. A practice bout: no XP or loot is kept.`, 'info');
      updateVision(); redraw();
      startArenaFight();
      return;
    }
    const kinds = [...new Set(s.monsters.map((m) => m.name))];
    log(`${names} ${carry ? (s.members.length > 1 ? 'climb down' : 'climbs down') : (s.members.length > 1 ? 'descend the stairs' : 'descends the stairs')} into dungeon #${s.seed}, depth ${s.depth}. Somewhere here: ${s.monsters.length} foes (${kinds.join(', ') || 'none'}), ${s.features.chests.length} chests, traps, and stairs leading further down. Find them.`, 'info');
    $('.dg-depth').textContent = `Depth ${s.depth}`;
    updateVision();
    redraw();
  }

  // ---------------------------------------------------------------------------
  // Vision and fog
  // ---------------------------------------------------------------------------

  const opaque = () => makeOpacity(s.map, s.doors);
  const alive = () => s.monsters.filter((m) => !m.dead);
  const occupied = (except) => new Set([...partyAlive(), ...alive()].filter((e) => e && e !== except).flatMap((e) => cellsOf(e.pos, e.size ?? 1).map((c) => cellKey(c.x, c.y))));
  const edist = (a, b) => entityDistance(a, b);
  const edistP = (e, p) => blockDistance(e.pos, e.size ?? 1, p, 1);
  /** Can the party actually see it? (Not the narrator's Reveal map view.) */
  const inSight = (m) => cellsOf(m.pos, m.size ?? 1).some((c) => s.visible.has(cellKey(c.x, c.y)));
  const canSee = (m) => s.revealAll || inSight(m);

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
  const corpseAt = (x, y) => s.monsters.find((m) => m.dead && covers(m, { x, y }) && m.loot && (m.loot.coins || m.loot.items.length)) ?? null;
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
      if (t.found || t.sprung || !s.visible.has(cellKey(t.x, t.y)) || chebyshev(t, s.hero.pos) > 2) continue;
      // Only the very watchful spot a trap without looking for it: passive Perception must beat its DC by 5.
      if (pp >= t.dc + 5) { t.found = true; found.push(`a ${t.name}`); }
    }
    for (const k of [...s.features.secretDoors]) {
      const [x, y] = k.split(',').map(Number);
      if (chebyshev({ x, y }, s.hero.pos) > 2) continue;
      if (pp >= secretDC() + 5) { revealSecret(k); found.push('a secret door'); }
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
    // The party sees what any of its members sees.
    if (arena) { s.visible = new Set(); for (let y = 0; y < s.map.height; y++) for (let x = 0; x < s.map.width; x++) s.visible.add(cellKey(x, y)); } else {
      const op = opaque(); s.visible = new Set();
      for (const h of (partyAlive().length ? partyAlive() : [s.hero])) for (const k of visibleSquares(s.map, h.pos, op)) s.visible.add(k);
    }
    if (s.features) passiveNotice();
    if (s.map.exit && !s.exitSeen && s.visible.has(cellKey(s.map.exit.x, s.map.exit.y))) {
      s.exitSeen = true;
      if (s.log.length) { log('You spot a stairway leading further down!', 'good'); banner('Stairs down!'); }
    }
    revealFrom(s.map, s.visible, s.revealed);
    const spotted = [];
    for (const m of alive()) {
      if (m.aware || !inSight(m) || m.cond?.asleep) continue;
      if (s.sneak) {
        // Stealth vs passive Perception: if your roll beats it, the creature does not notice you.
        if (m.unnoticed) continue;
        const pp = BESTIARY_BY_ID[m.statId].passivePerception;
        if (pp < s.sneak.total) {
          m.unnoticed = true;
          log(`The ${m.name.toLowerCase()} has not noticed you (its passive Perception ${pp} vs your Stealth ${s.sneak.total}).`, 'good');
          if (!m.sneakXp) { m.sneakXp = true; awardXp(skillXp(pp, s.def.level), m.pos); }
          continue;
        }
        log(`The ${m.name.toLowerCase()} notices you despite your care (passive Perception ${pp} vs Stealth ${s.sneak.total}).`, 'warn');
      }
      m.aware = true; spotted.push(m);
    }
    return spotted;
  }

  // ---------------------------------------------------------------------------
  // Turns
  // ---------------------------------------------------------------------------

  function startHeroTurn() {
    s.moveLeft = s.hero ? s.hero.speed : 0;
    s.actionUsed = false; s.dash = false; s.bonusUsed = false; s.attacksLeft = 0; s.sneakUsed = false; s.disengaged = false;
    if (s.hero) {
      s.hero.reaction = true;
      if (s.buffs.shield) { delete s.buffs.shield; }
      // Song of Heroes: temporary hit points equal to your spellcasting modifier each turn.
      if (s.buffs.heroism) s.hero.tempHp = Math.max(s.hero.tempHp ?? 0, s.def?.caster?.mod ?? 1);
      refreshAC();
    }
  }

  function enterCombat(spotted) {
    const kinds = [...new Set(spotted.map((m) => m.name.toLowerCase()))];
    const names = spotted.length === 1 ? `A ${kinds[0]}` : `${spotted.length} foes (${kinds.join(', ')})`;
    const isNew = s.mode !== 'combat';
    if (isNew) {
      s.mode = 'combat'; s.round = 1;
      setMood('combat');
      if (s.sneak) { s.sneak = null; }
      s.order = []; const rolls = [];
      for (const h of partyAlive()) {
        const r = rollInitiative(h.dexMod);
        s.order.push({ id: h.id, hero: true, init: r.total, roll: r.d20 });
        rolls.push(`${h.name}: d20 (${r.d20}) ${signed(h.dexMod)} = ${r.total}`);
      }
      log(`${names} spotted! Roll for initiative. ${rolls.join('; ')}.`, 'warn');
    } else {
      log(`${names} join the fight!`, 'warn');
    }
    for (const m of spotted) {
      const r = rollInitiative(m.dexMod);
      s.order.push({ id: m.id, init: r.total, roll: r.d20 });
    }
    s.order.sort((a, b) => b.init - a.init || (a.hero ? -1 : 1));
    if (isNew) {
      // New combat: whoever rolled highest goes first. Monsters ahead of every hero act now.
      if (s.order[0].hero) { activate(memberIndex(party().find((h) => h.id === s.order[0].id))); startHeroTurn(); keepInView(s.hero.pos); } else runMonsterTurns(true);
    }
  }

  function checkCombatOver() {
    if (s.mode === 'combat' && !alive().some((m) => m.aware)) {
      s.mode = 'explore'; s.order = [];
      setMood('dungeon');
      log('The fight is over. You can explore freely again.', 'good');
      // Fallen companions are patched up by their friends and come round with 1 hit point.
      for (const h of party()) if (h.hp <= 0) { h.hp = 1; log(`${h.name} comes round, battered but alive (1 HP).`, 'heal'); }
      recoverAmmo();
      startHeroTurn();
      if (!alive().length) showEnd('victory');
    }
  }

  /** Arena: everyone is aware from the first moment; roll initiative for all. */
  function startArenaFight() {
    for (const m of s.monsters) m.aware = true;
    enterCombat(alive());
    redraw();
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
    s.busy = true; saveActive(); redraw();
    const heroIdx = s.order.findIndex((o) => o.id === s.hero?.id);
    let i = fromStart ? 0 : heroIdx + 1;
    let next = null;
    for (let guard = 0; guard < s.order.length * 2 + 2; guard++, i++) {
      if (i >= s.order.length) {
        i = 0; s.round++;
        for (const fx of s.effects) fx.rounds--;
        const gone = s.effects.filter((fx) => fx.rounds <= 0);
        if (gone.length) { s.effects = s.effects.filter((fx) => fx.rounds > 0); log('The wall of fire gutters out.', 'info'); }
      }
      const slot = s.order[i];
      if (slot.hero) {
        const h = partyAlive().find((x) => x.id === slot.id);
        if (h) { next = h; break; }
        continue;
      }
      const m = s.monsters.find((x) => x.id === slot.id);
      if (!m || m.dead || !m.aware) continue;
      for (const fx of s.effects) if (inEffect(m, fx)) { log(burnIn(m, fx), 'good'); await sleep(PAUSE_MS / 2); }
      if (m.dead) continue;
      if (await conditionSkip(m)) continue;
      // Each monster goes for the nearest hero it can see (or the nearest at all).
      const targets = partyAlive();
      if (!targets.length) break;
      const sees = (h) => lineOfSight(m.pos, h.pos, opaque()).visible;
      targets.sort((a, b) => (sees(b) - sees(a)) || edist(a, m) - edist(b, m));
      activate(memberIndex(targets[0]));
      const acted = await monsterTurn(m);
      if (m.cond?.flee > 0) m.cond.flee--;
      if (m.cond?.restrained) { const sv = monsterRoll(m, 'str', m.cond.restrained); if (sv.ok) { delete m.cond.restrained; log(`${m.name} tears free of the thorns.`, 'info'); } }
      if (s.hero.hp <= 0) {
        if (partyDown()) { s.busy = false; showEnd('defeat'); return; }
        log(`${s.hero.name} falls, unconscious! The others fight on.`, 'bad');
      }
      // A hunter that can neither reach nor see you for two rounds loses interest.
      if (!acted && !canSee(m)) { m.idle = (m.idle ?? 0) + 1; if (m.idle >= 2) { m.aware = false; m.idle = 0; log(`Somewhere in the dark, a ${m.name.toLowerCase()} gives up the hunt.`, 'info'); } } else m.idle = 0;
    }
    s.order = s.order.filter((o) => { const m = s.monsters.find((x) => x.id === o.id); return (o.hero && partyAlive().some((h) => h.id === o.id)) || (m && !m.dead && m.aware); });
    s.busy = false;
    if (next) activate(memberIndex(next));
    startHeroTurn();
    banner(s.members.length > 1 ? `Round ${s.round}: ${s.hero.name}'s turn` : `Round ${s.round}: your turn`);
    keepInView(s.hero.pos);
    // Goblins that noticed the hero during the enemy turns join the fight now.
    const late = alive().filter((m) => m.aware && !s.order.some((o) => o.id === m.id));
    if (late.length) enterCombat(late);
    checkCombatOver();
    redraw();
  }

  async function monsterTurn(m) {
    m.reaction = true; m.burnedThisTurn = false;
    banner(`${m.name}'s turn`);
    const plan = planMonsterTurn({ m, hero: s.hero, map: s.map, opaque: opaque(), blocked: new Set([...occupied(m), ...terrainBlocked()]) });
    let disengaged = false;
    if (plan.length === 1 && plan[0].type === 'wait') return false;
    for (const step of plan) {
      if (step.type === 'flee') { disengaged = !!m.nimble; if (canSee(m)) log(`${m.name} panics and flees!`, 'info'); }
      if (step.type === 'disengage') { disengaged = true; if (canSee(m)) log(`${m.name} slips away nimbly (Nimble Escape: Disengage).`, 'info'); }
      if (step.type === 'move' && m.cond?.restrained) { if (canSee(m)) log(`${m.name} strains against the thorns but cannot move.`, 'info'); continue; }
      if (step.type === 'move') {
        for (const p of step.path.slice(1)) {
          const wasAdjacent = edist(m, s.hero) <= 1;
          m.facing = facingToward(m.pos, p);
          m.pos = { x: p.x, y: p.y };
          openDoorAt(p);
          for (const fx of s.effects) if (inEffect(m, fx) && !m.burnedThisTurn) { m.burnedThisTurn = true; log(burnIn(m, fx), 'good'); }
          if (m.dead) return true;
          if (wasAdjacent && edist(m, s.hero) > 1 && !disengaged && !m.flyby && !m.cond?.flee && s.hero.reaction) await heroOpportunityAttack(m);
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

  /** The active hero dropped to 0 HP on their own turn (a trap, an opportunity attack, their own fireball). */
  function heroFell() {
    if (partyDown()) { showEnd('defeat'); return; }
    log(`${s.hero.name} falls, unconscious!`, 'bad');
    if (s.mode === 'combat') { s.busy = false; endHeroTurn(); return; }
    activate(memberIndex(partyAlive()[0]));
    redraw();
  }

  async function moveHero(target) {
    s.busy = true;
    const costAt = (p) => s.reach.get(cellKey(p.x, p.y))?.cost ?? target.cost;
    for (const p of target.path.slice(1)) {
      const before = { ...s.hero.pos };
      const threats = s.disengaged ? [] : alive().filter((m) => m.aware && m.reaction && !helpless(m) && edistP(m, before) <= reachOf(m));
      s.hero.facing = facingToward(before, p);
      s.hero.pos = { x: p.x, y: p.y };
      // Exploring: the others follow in single file, each stepping where the one ahead just was.
      if (s.mode !== 'combat') {
        let prev = before;
        for (const h of partyAlive()) {
          if (h === s.hero) continue;
          const old = { ...h.pos };
          if (chebyshev(old, prev) > 0) { h.facing = facingToward(old, prev) >= 0 ? facingToward(old, prev) : h.facing; h.pos = { ...prev }; }
          prev = old;
        }
      }
      openDoorAt(p);
      for (const fx of s.effects) if (inEffect(s.hero, fx)) { log(burnIn(s.hero, fx), 'bad'); if (s.hero.hp <= 0) { s.busy = false; heroFell(); return; } }
      for (const m of threats) {
        if (edist(m, s.hero) > reachOf(m)) await monsterOpportunityAttack(m);
        if (s.hero.hp <= 0) { s.busy = false; heroFell(); return; }
      }
      const trap = trapAt(p.x, p.y);
      let sprang = false;
      if (trap && trap.found && !trap.disarmed && !trap.sprung) {
        // Crossing a trap you know about: Acrobatics against its DC to step around the trigger.
        const c = heroCheck(s.hero.skills.acrobatics ?? 0, trap.dc);
        log(`${s.hero.name} edges past the ${trap.name}. ${checkText('Acrobatics', c)}. ${c.ok ? 'Safely across.' : 'A misstep!'}`, c.ok ? 'good' : 'bad');
        if (!c.ok) sprang = true; else awardXp(skillXp(trap.dc, s.def.level), p);
      }
      if (trap && (sprang || (!trap.found && !trap.disarmed && !trap.sprung))) {
        await springTrap(trap);
        if (s.hero.hp <= 0) { s.busy = false; heroFell(); return; }
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
    const save = heroCheck(dexSave, t.saveDc, { save: true });
    const dmg = roll(t.damage);
    // Evasion (burglar 7): no damage on a successful DEX save, half on a failure.
    const taken = s.def.evasion ? (save.ok ? 0 : Math.floor(dmg.total / 2)) : (save.ok ? Math.floor(dmg.total / 2) : dmg.total);
    damageHero(taken);
    float(s.hero.pos, `−${taken}`, 'bad', !save.ok);
    flashHit(s.hero);
    if (taken) play(cry(s.hero, s.hero.hp > 0 ? 'hurt' : 'death'), { delay: 150 });
    banner(t.text);
    log(`${t.text} ${s.hero.name} springs a ${t.name}! DEX save: d20 (${save.d20}) ${signed(dexSave)}${save.extra} = ${save.total} vs DC ${t.saveDc}. ${s.def.evasion ? (save.ok ? 'Evasion: no damage' : 'Evasion: half damage') : save.ok ? 'Half damage' : 'Full damage'}: ${taken} ${t.type} [${dmg.rolls.join(', ')}].`, 'bad');
    redraw(); await sleep(PAUSE_MS);
  }

  // ---------------------------------------------------------------------------
  // Attacks
  // ---------------------------------------------------------------------------

  const enemiesOf = (who) => (who.isHero ? alive().filter((m) => m.aware) : partyAlive());

  /** Pick the hero weapon to use against a target: the selected one if it works, else any that does. */
  function heroAttackPlan(target) {
    const args = (w) => ({ attacker: s.hero, target, weapon: w, opaque: opaque(), occupied: occupied(), enemiesOf });
    const sel = s.hero.weapons[s.weaponIdx];
    const order = [sel, ...s.hero.weapons.filter((w) => w !== sel)];
    const adjacent = edist(s.hero, target) <= 1;
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
    if (w.melee && target && edist(s.hero, target) <= (w.reach ?? 1)) return true;
    return countOf(s.draft.inventory, w.ammo) > 0;
  }

  function whyNot(target) {
    if (s.hero.weapons.some((w) => w.ammo && !hasAmmo(w, target)) && !s.hero.weapons.some((w) => w.melee) ) return 'Out of ammunition.';
    const d = edist(s.hero, target);
    const maxRange = Math.max(0, ...s.hero.weapons.filter((w) => w.ranged).map((w) => w.long));
    if (!s.visible.has(cellKey(target.pos.x, target.pos.y))) return 'You can\'t see it.';
    if (d > 1 && !maxRange) return 'Too far for a melee weapon. Move next to it first.';
    if (d > maxRange) return `Out of range (${d * 5} ft).`;
    return 'No clear line of sight.';
  }

  /** Can the hero make a weapon attack now? (Extra Attack lets one action hold several attacks.) */
  const canAttack = () => s.mode !== 'combat' || !s.actionUsed || s.attacksLeft > 0;

  async function heroAttack(target, weaponIdx = null) {
    if (!canAttack()) { banner('You have already used your action this turn.'); return; }
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
    s.sneak = null;
    await doAttack(s.hero, target, plan.weapon);
    if (s.mode === 'combat') {
      if (s.attacksLeft > 0) s.attacksLeft--; else { s.actionUsed = true; s.attacksLeft = (s.def.attacksPerAction ?? 1) - 1; }
      if (s.attacksLeft > 0) banner(`Extra Attack: ${s.attacksLeft} more this action.`);
    }
    s.busy = false;
    provoke([target]);
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
  async function shootProjectile(from, to, color = null) {
    const frames = reduceMotion ? 1 : 9;
    for (let i = 1; i <= frames; i++) {
      s.projectile = { from, to, t: i / frames, color };
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
    if (ranged) { play('bow-shot', { volume: 0.8 }); await shootProjectile(centerOf(attacker.pos, attacker.size ?? 1), centerOf(target.pos, target.size ?? 1)); } else { await lunge(attacker, target); }

    // Bless and inspiration add dice to the hero's attack roll.
    const boost = attacker === s.hero ? rollBoosts({ attack: true }) : { total: 0, text: '' };
    const w = boost.total ? { ...weapon, toHit: weapon.toHit + boost.total } : weapon;
    const autoCrit = !!target.cond?.paralyzed && !ranged && edist(attacker, target) <= 1;
    const r = resolveAttack({ weapon: w, ac: opts.ac, mode: opts.mode, autoCrit });
    if (attacker.cond?.mock) delete attacker.cond.mock;
    const who = attacker === s.hero ? s.hero.name : attacker.name;
    const whom = target === s.hero ? s.hero.name : target.name;
    const dice = r.d20s.length > 1 ? `d20 (${r.d20s.join(', ')} → ${r.d20})` : `d20 (${r.d20})`;
    const why = [...opts.adv.map((a) => `advantage: ${a}`), ...opts.dis.map((d) => `disadvantage: ${d}`), opts.cover === 'half' ? 'half cover +2 AC' : null].filter(Boolean);
    let line = `${who} ${ranged ? 'shoots' : 'attacks'} ${whom} with ${weapon.name}: ${dice} ${signed(weapon.toHit)}${boost.text} = ${r.total} vs AC ${opts.ac}${why.length ? ` (${why.join('; ')})` : ''}.`;
    if (r.hit) {
      let dmg = r.damage; const bits = [];
      if (attacker === s.hero) {
        const x = hitExtras(target, weapon, opts, ranged, r.crit);
        dmg += x.total; bits.push(...x.text);
      }
      if (target === s.hero && s.def.uncanny && s.hero.reaction && dmg > 1) {
        dmg = Math.floor(dmg / 2); s.hero.reaction = false; bits.push('Uncanny Dodge halves it');
      }
      if (target === s.hero) damageHero(dmg); else damageMonster(target, dmg);
      line += ` ${r.crit ? 'CRITICAL HIT! ' : 'Hit! '}${dmg} ${weapon.type} damage${r.damageRoll ? ` [${r.damageRoll.rolls.join(', ')}${r.damageRoll.modifier ? ` ${signed(r.damageRoll.modifier)}` : ''}]` : ''}${bits.length ? ` (${bits.join('; ')})` : ''}.`;
      float(target.pos, `−${dmg}`, target === s.hero ? 'bad' : 'good', r.crit);
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
    saveActive();
    const carry = { delve: s.delve, members: s.members.map((m) => ({ hp: Math.max(1, m.hero.hp), res: m.res, buffs: m.buffs })) };
    carry.delve.deepest = Math.max(carry.delve.deepest ?? 1, s.depth + 1);
    play('door-open', { volume: 0.6 });
    const next = ((s.seed * 7919 + s.depth * 104729) % 99991) + 1;
    s.depth += 1;
    newDungeon(next, carry);
    log(`New depth reached: +${bonus} XP for finding the way down.`, 'good');
    awardPartyXp(bonus);
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
    if (arena) { m.loot = { coins: 0, items: [] }; log(`${m.name} falls!`, 'good'); awardPartyXp(stat.xp, m.pos); return; }
    log(`${m.name} falls! +${stat.xp} XP.${n ? ' It carried something: click the body to search it.' : ''}`, 'good');
    awardPartyXp(stat.xp, m.pos);
  }

  /** Experience for the whole party is split evenly (5e); a skill's XP goes to whoever used it. */
  function awardPartyXp(xp, pos) {
    if (arena) { if (xp) float(pos ?? s.hero.pos, 'practice', 'muted'); return; }
    const alivePeople = s.members.map((m, i) => i).filter((i) => s.members[i].hero.hp > 0 || s.members[i].hero === s.hero);
    if (alivePeople.length <= 1) { awardXp(xp, pos); return; }
    const share = Math.floor(xp / alivePeople.length);
    const back = s.active;
    for (const i of alivePeople) { activate(i); awardXp(share, s.hero.pos, true); }
    activate(back);
    s.delve.xp += share * alivePeople.length;
    log(`${xp} XP shared by ${alivePeople.length}: ${share} each.`, 'info');
  }

  function awardXp(xp, pos, shared = false) {
    if (!xp || !s.draft || arena) return;
    const r = api.gainXp(s.draft, xp);
    if (!shared) s.delve.xp += xp;
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
    const n = e.size ?? 1;
    const sz = S(); const r = sz * (n > 1 ? 0.44 : 0.36) * n; const R = r + 4;
    const state = woundState(e.hp, e.maxHp);
    const off = s.lunge?.id === e.id ? { x: s.lunge.dx * sz * 0.28, y: s.lunge.dy * sz * 0.28 } : { x: 0, y: 0 };
    const cx = (e.pos.x + n / 2) * sz + off.x; const cy = (e.pos.y + n / 2) * sz + off.y;
    const img = hero ? e.look?.url : monsterPortrait(e.statId);
    const filter = hero ? (e.look?.filter ?? 'none') : 'none';
    const ring = hero ? (e.look?.frameColor ?? '#e9c46a') : '#c94a3a';
    const hpFrac = Math.max(0, e.hp / e.maxHp);
    const cls = `tk ${hero ? `tk-hero${e === s.hero && s.members.length > 1 ? ' tk-active' : ''}${e.hp <= 0 ? ' tk-down' : ''}` : `tk-foe tk-${state}`}${s.flash.has(e.id) ? ' tk-flash' : ''}${s.selectedId === e.id ? ' tk-selected' : ''}`;
    return `<g class="${cls}" transform="translate(${cx} ${cy})">
      ${s.selectedId === e.id ? `<circle r="${R + 9}" class="tk-selring"/>` : ''}
      ${hero && e === s.hero && s.members.length > 1 ? `<circle r="${R + 8}" class="tk-activering"/>` : ''}
      <g transform="rotate(${facingAngle(e.facing)})">
        <path d="M ${R} 0 A ${R} ${R} 0 0 1 ${-R} 0" class="tk-backarc"/>
        <path d="M ${-R} 0 A ${R} ${R} 0 0 1 ${R} 0" class="tk-frontarc" style="stroke:${ring}"/>
        <path d="M ${-r * 0.42} ${-R - 2} L 0 ${-R - sz * 0.17} L ${r * 0.42} ${-R - 2} Z" class="tk-nose" style="fill:${ring}"/>
      </g>
      ${img ? `<image href="${esc(img)}" x="${-r}" y="${-r}" width="${r * 2}" height="${r * 2}" clip-path="url(#tk-clip-${n})" preserveAspectRatio="xMidYMid slice" style="filter:${filter}"/>`
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
    const sz = S(); let out = `<defs>${[1, 2, 3, 4].map((n) => `<clipPath id="tk-clip-${n}" clipPathUnits="userSpaceOnUse"><circle r="${sz * (n > 1 ? 0.44 : 0.36) * n}"/></clipPath>`).join('')}</defs>`;
    out += drawDoors();
    // Reachable squares
    for (const c of s.reach.values()) if (c.cost > 0) out += `<rect x="${c.x * sz + 4}" y="${c.y * sz + 4}" width="${sz - 8}" height="${sz - 8}" rx="7" class="dg-reach"/>`;
    out += drawFog();
    out += drawFeatures();
    // Hover: path preview, or attack preview on a monster
    const hov = s.hover;
    const foe = hov && alive().find((m) => covers(m, hov) && canSee(m));
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
      if (m.dead) { const c = centerOf(m.pos, m.size ?? 1); if (canSee(m) || s.revealed.has(cellKey(m.pos.x, m.pos.y))) out += `<text x="${(c.x + 0.5) * sz}" y="${(c.y + 0.5) * sz + 10}" class="tk-dead" style="font-size:${30 * (m.size ?? 1)}px">✕</text>`; continue; }
      if (canSee(m)) out += token(m);
    }
    for (const h of party()) if (h !== s.hero) out += token(h, { hero: true });
    if (s.hero) out += token(s.hero, { hero: true });
    // Arrow in flight
    if (s.projectile) {
      const { from, to, t } = s.projectile;
      const x0 = (from.x + 0.5) * sz; const y0 = (from.y + 0.5) * sz; const x1 = (to.x + 0.5) * sz; const y1 = (to.y + 0.5) * sz;
      const x = x0 + (x1 - x0) * t; const y = y0 + (y1 - y0) * t; const ang = Math.atan2(y1 - y0, x1 - x0) * 180 / Math.PI;
      if (s.projectile.color) out += `<circle cx="${x}" cy="${y}" r="12" class="dg-bolt" style="fill:${s.projectile.color}"/>`;
      else out += `<g transform="translate(${x} ${y}) rotate(${ang})" class="dg-arrow"><line x1="-34" y1="0" x2="0" y2="0"/><path d="M 0 0 L -12 -6 L -12 6 Z"/><path d="M -34 0 L -42 -6 M -34 0 L -42 6"/></g>`;
    }
    for (const fx of s.effects) for (const c of fx.cells) {
      out += `<image href="assets/vfx/firewall-${((c.x * 7 + c.y * 3) % 4) + 1}.jpg" x="${c.x * sz - sz * 0.15}" y="${c.y * sz - sz * 0.35}" width="${sz * 1.3}" height="${sz * 1.3}" class="vfx vfx-persist" preserveAspectRatio="xMidYMid slice"/>`;
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
      const item = findMagic(s.pending.id); const r = item?.range ?? 0;
      out += `<rect x="${(s.hero.pos.x - r) * sz}" y="${(s.hero.pos.y - r) * sz}" width="${(2 * r + 1) * sz}" height="${(2 * r + 1) * sz}" class="dg-range"/>`;
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
    $('.dg-herocard').innerHTML = `${partyBar()}
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
      <div class="hc-row"><span class="pip ${canAttack() && !s.actionUsed ? 'on' : s.attacksLeft > 0 ? 'half' : ''}">Action${s.attacksLeft > 0 ? ` (${s.attacksLeft} attack${s.attacksLeft > 1 ? 's' : ''} left)` : ''}</span><span class="pip ${!s.bonusUsed ? 'on' : ''}">Bonus</span><span class="pip ${h.reaction ? 'on' : ''}">Reaction</span><span class="muted small">AC ${h.ac}${h.tempHp ? ` · +${h.tempHp} temp HP` : ''}</span></div>
      ${xpBar()}
      <div class="hc-purse">${coinsHtml(s.draft?.coins ?? 0)}</div>
      <div class="hc-actions">
        <button class="btn small" data-dg="inventory" title="Open your pack (I)">🎒 Pack</button>
        <button class="btn small" data-dg="bandage" ${countOf(s.draft?.inventory ?? [], 'bandage') && !s.busy ? '' : 'disabled'} title="Medicine check (DC 10): heal 1d6 + Medicine${s.mode === 'combat' ? '. Uses your action.' : ''}">🩹 Bandage <span class="muted">${countOf(s.draft?.inventory ?? [], 'bandage')}</span> <span class="muted">${signed(h.skills.medicine ?? 0)}</span></button>
        <button class="btn small" data-dg="search" ${s.busy ? 'disabled' : ''} title="Perception or Investigation (your better one) against hidden traps and secret doors nearby${s.mode === 'combat' ? '. Uses your action.' : ''}">🔍 Search <span class="muted">${signed(Math.max(h.skills.investigation ?? 0, h.skills.perception ?? 0))}</span></button>
      </div>
      ${restPanel()}
      ${s.lastCheck ? `<p class="study-result ${s.lastCheck.ok ? 'ok' : ''}">${esc(s.lastCheck.text)}</p>` : ''}
      ${magicPanel()}
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
    drawPop();
    drawNearby();
    if (s.invOpen) drawInventory();
    $('.dg-initiative').innerHTML = combat ? `<h3>Initiative</h3><ol class="init">${s.order.map((o) => {
      const e = o.hero ? party().find((x) => x.id === o.id) : s.monsters.find((m) => m.id === o.id);
      if (!e || e.dead || (o.hero && e.hp <= 0)) return '';
      return `<li class="${o.hero ? 'me' : ''} ${o.id === s.hero.id ? 'now' : ''}"><b>${o.init}</b> ${esc(e.name)}${o.hero ? ` <span class="muted small">${e.hp} HP</span>` : ` <span class="muted small">${canSee(e) ? woundState(e.hp, e.maxHp) : 'unseen'}</span>`}</li>`;
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
  const checkText = (label, c) => `${label}: ${c.d20s.length > 1 ? `d20 (${c.d20s.join(', ')} → ${c.d20})` : `d20 (${c.d20})`} ${signed(c.bonus)}${c.extra ?? ''} = ${c.total} vs DC ${c.dc}`;
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
    const c = heroCheck(bonus, 10, { mode: kit ? 'advantage' : 'normal' });
    removeItem(s.draft.inventory, inst.uid, 1);
    play('bandage', { volume: 0.8 });
    if (c.ok) {
      const r = roll('1d6');
      const got = heal(r.total + Math.max(0, bonus), 'bandage');
      log(`${s.hero.name} binds their wounds. ${checkText('Medicine', c)}${kit ? ' (healer\'s kit: advantage)' : ''}. Success: heals 1d6 (${r.total}) + ${Math.max(0, bonus)} = ${got} HP.`, 'heal');
      awardXp(skillXp(10, s.def.level), s.hero.pos);
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
    // Look with your eyes (Perception) or reason it out (Investigation): whichever you are better at.
    const useInv = (s.hero.skills.investigation ?? 0) >= (s.hero.skills.perception ?? 0);
    const skillName = useInv ? 'Investigation' : 'Perception';
    const bonus = s.hero.skills[useInv ? 'investigation' : 'perception'] ?? 0;
    const c = heroCheck(bonus, 0, { mode: s.def.keenSearch ? 'advantage' : 'normal' });
    let xpFound = 0;
    play('dice', { volume: 0.6 });
    const found = []; let missed = 0;
    for (const t of s.features.traps) {
      if (t.found || t.sprung || chebyshev(t, s.hero.pos) > 6 || !s.visible.has(cellKey(t.x, t.y))) continue;
      if (c.total >= t.dc) { t.found = true; found.push(`a ${t.name}`); xpFound += skillXp(t.dc, s.def.level); } else missed++;
    }
    for (const k of [...s.features.secretDoors]) {
      const [x, y] = k.split(',').map(Number);
      if (chebyshev({ x, y }, s.hero.pos) > 4) continue;
      if (c.total >= secretDC()) { revealSecret(k); found.push('a secret door'); xpFound += skillXp(secretDC(), s.def.level); } else missed++;
    }
    if (xpFound) awardXp(xpFound, s.hero.pos);
    const roll20 = `${skillName}${s.def.keenSearch ? ' (Burglar\'s Eye: advantage)' : ''}: ${c.d20s.length > 1 ? `d20 (${c.d20s.join(', ')} → ${c.d20})` : `d20 (${c.d20})`} ${signed(bonus)}${c.extra} = ${c.total}`;
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
    const c = heroCheck(bonus, lock.dc);
    play('lockpick', { volume: 0.8 });
    let extra = '';
    if (c.ok) { unlock(t); awardXp(skillXp(lock.dc, s.def.level), s.hero.pos); }
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
    const c = heroCheck(bonus, lock.dc + 2, { mode: bar ? 'advantage' : 'normal' });
    play(c.ok ? 'door-open' : 'swing-miss', { volume: 0.9 });
    if (c.ok) { unlock(t); awardXp(skillXp(lock.dc + 2, s.def.level), s.hero.pos); }
    const text = `${checkText(`Athletics${bar ? ' (crowbar: advantage)' : ''}`, c)}. ${c.ok ? `${lockLabel(t)[0].toUpperCase()}${lockLabel(t).slice(1)} bursts open with a crash!` : 'It holds.'}`;
    log(`${s.hero.name} tries to force ${lockLabel(t)}. ${text}`, c.ok ? 'good' : 'info');
    s.lastCheck = { text, ok: c.ok };
    makeNoise(8);
    persist(); redraw();
  }

  /** Noise wakes foes within `radius` squares: they come looking for you. */
  function makeNoise(radius, limit = Infinity) {
    // Only foes with a way to reach you come running (a walk of up to ~4 turns).
    const blocked = new Set([...terrainBlocked()]);
    const near = alive().filter((m) => !m.aware && edist(m, s.hero) <= radius);
    const woken = near.filter((m) => [...reachableSquares(s.map, m.pos, m.speed * 4, { blocked, size: m.size ?? 1 }).values()].some((c) => blockDistance(c, m.size ?? 1, s.hero.pos, 1) <= 1))
      .sort((a, b) => edist(a, s.hero) - edist(b, s.hero)).slice(0, limit);
    if (!woken.length) return 0;
    woken.forEach((m) => { m.aware = true; });
    log('The noise echoes through the halls... something stirs.', 'warn');
    banner('Something heard that!');
    enterCombat(woken);
    return woken.length;
  }

  function disarm(trap) {
    const tools = hasTools();
    if (!tools) { banner('You need thieves\' tools to disarm a trap.'); return; }
    if (!spendAction('Disarming a trap')) return;
    const c = heroCheck(s.def.toolBonus, trap.dc);
    play('lockpick', { volume: 0.7 });
    if (c.ok) {
      trap.disarmed = true;
      log(`${s.hero.name} disarms the ${trap.name}. ${checkText('Thieves\' tools (DEX)', c)}.`, 'good');
      s.lastCheck = { text: `${checkText('Thieves\' tools', c)}: disarmed`, ok: true };
      awardXp(skillXp(trap.dc, s.def.level) * 2, trap);
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
  // Magic and class abilities
  // ---------------------------------------------------------------------------

  /** The numbers the rest/resource rules need about the hero. */
  const magicHero = () => ({
    level: s.def.level, casterType: s.def.magic?.type, abilities: s.def.magic?.abilities ?? [], cls: s.def.cls,
    hitDie: s.def.hitDie, conMod: s.def.conMod,
  });

  /** After a level-up: new slots and uses appear (already spent ones stay spent), +1 hit die. */
  function growResources() {
    const fresh = freshResources(magicHero());
    const r = s.res;
    const gained = fresh.maxSlots.map((n, i) => n - (r.maxSlots[i] ?? 0));
    r.slots = fresh.maxSlots.map((n, i) => Math.min(n, (r.slots[i] ?? 0) + Math.max(0, gained[i])));
    r.maxSlots = fresh.maxSlots;
    for (const [id, n] of Object.entries(fresh.uses)) if (r.uses[id] === undefined) r.uses[id] = n;
    r.hitDice = Math.min(s.def.level, r.hitDice + 1);
    if (s.def.cls === 'warden') r.pool += 5;
    r.level = s.def.level;
  }

  function refreshAC() {
    if (!s.hero || !s.def) return;
    s.hero.ac = s.def.ac + (s.buffs.shield ? 5 : 0) + (s.buffs.faith ? 2 : 0);
  }

  const helpless = (m) => !!(m.cond?.asleep || m.cond?.paralyzed || m.cond?.stun > 0);

  /** A monster's saving throw: d20 + its save bonus against a DC. */
  function monsterRoll(m, ability, dc) {
    const stat = BESTIARY_BY_ID[m.statId];
    const bonus = monsterSave(stat, ability);
    const d20 = rollDie(20);
    return { d20, bonus, total: d20 + bonus, dc, ok: d20 + bonus >= dc };
  }

  /** Conditions that cost a monster its turn. Returns true if it skips the turn. */
  async function conditionSkip(m) {
    const c = m.cond ??= {};
    if (m.surprised) { m.surprised = false; if (canSee(m)) log(`${m.name} is caught by surprise and loses its turn.`, 'good'); return true; }
    if (c.asleep) return true;
    if (c.stun > 0) { c.stun--; if (canSee(m)) log(`${m.name} is stunned and cannot act.`, 'good'); return true; }
    if (c.paralyzed) {
      const sv = monsterRoll(m, 'wis', c.paralyzed);
      if (sv.ok) { delete c.paralyzed; log(`${m.name} breaks free of the hold (WIS save ${sv.total} vs DC ${sv.dc}).`, 'warn'); } else log(`${m.name} stays held fast (WIS save ${sv.total} vs DC ${sv.dc}).`, 'good');
      return true;
    }
    return false;
  }

  /** Attacking or harming a creature starts a fight. Creatures that had not noticed you are surprised. */
  function provoke(targets) {
    const hit = targets.filter((m) => m && !m.dead);
    if (!hit.length) return;
    if (s.mode === 'combat') {
      const late = hit.filter((m) => !m.aware);
      late.forEach((m) => { m.aware = true; m.unnoticed = false; });
      if (late.length) enterCombat(late);
      return;
    }
    const group = alive().filter((m) => hit.includes(m) || (inSight(m) && !m.cond?.asleep));
    for (const m of group) { if (!m.aware) m.surprised = true; m.aware = true; m.unnoticed = false; }
    s.sneak = null;
    enterCombat(group);
  }

  /** Bless (+1d4 to attacks and saves) and an inspiration die (spent on the next roll). */
  function rollBoosts({ attack = false, save = false } = {}) {
    let total = 0; let text = '';
    if (s.buffs.bless && (attack || save)) { const r = rollDie(4); total += r; text += ` + bless ${r}`; }
    if (s.buffs.inspiration) {
      const sides = Number(s.buffs.inspiration.slice(1)); const r = rollDie(sides);
      total += r; text += ` + inspiration ${r}`; delete s.buffs.inspiration;
    }
    return { total, text };
  }

  /** A skill check or save by the hero, with boosts applied. */
  function heroCheck(bonus, dc, { mode = 'normal', save = false } = {}) {
    const c = skillCheck(bonus, dc, { mode });
    const b = rollBoosts({ save });
    c.total += b.total; c.extra = b.text; c.ok = c.total >= dc; c.margin = c.total - dc;
    return c;
  }

  /** Extra damage on a hero's weapon hit: Sneak Attack, Hunter's Mark, Warden's Wrath; Ensnaring Strike. */
  function hitExtras(target, weapon, opts, ranged, crit) {
    let total = 0; const text = [];
    const rollX = (dice) => roll(crit ? dice.replace(/^(\d+)d/, (_, n) => `${n * 2}d`) : dice).total;
    if (s.def.sneak && !s.sneakUsed && (weapon.finesse || ranged) && opts.mode === 'advantage') {
      const d = rollX(sneakAttackDice(s.def.level)); total += d; s.sneakUsed = true; text.push(`Sneak Attack +${d}`);
    }
    if (s.buffs.mark === target.id) { const d = rollX('1d6'); total += d; text.push(`Hunter's Mark +${d}`); }
    if (s.buffs.smite && !ranged) {
      const d = rollX(s.buffs.smite.dice); total += d; text.push(`Warden's Wrath +${d} radiant`); delete s.buffs.smite;
      play('spell-heal', { volume: 0.7 });
    }
    if (s.buffs.ensnare) {
      delete s.buffs.ensnare;
      const sv = monsterRoll(target, 'str', s.def.caster?.dc ?? 12);
      if (!sv.ok) { (target.cond ??= {}).restrained = s.def.caster?.dc ?? 12; text.push('thorns restrain it'); } else text.push('it shrugs off the thorns');
    }
    return { total, text };
  }

  /** Damage to the hero: temporary hit points first; Ward against Death; concentration checks. */
  function damageHero(n) {
    let left = Math.max(0, n);
    if (s.hero.tempHp) { const t = Math.min(s.hero.tempHp, left); s.hero.tempHp -= t; left -= t; }
    s.hero.hp = Math.max(0, s.hero.hp - left);
    if (s.hero.hp === 0 && s.buffs.deathward) { s.hero.hp = 1; delete s.buffs.deathward; log('The Ward against Death flares: you drop to 1 hit point instead!', 'heal'); }
    if (left > 0 && s.res?.concentration && s.hero.hp > 0) {
      const dc = concentrationDC(left);
      const c = heroCheck(s.def.saves?.con ?? 0, dc, { save: true });
      if (!c.ok) { log(`Concentration broken! ${checkText('CON save', c)}.`, 'bad'); endConcentration(); }
    }
    return left;
  }

  function damageMonster(m, n) {
    m.hp = Math.max(0, m.hp - n);
    if (m.cond?.asleep && n > 0) { m.cond.asleep = false; if (m.hp > 0) log(`${m.name} wakes with a start!`, 'warn'); }
    return n;
  }

  function finishIfDead(m) {
    if (m.hp > 0 || m.dead) return;
    m.dead = true;
    play(cry(m, 'death'), { delay: 150 });
    if (s.selectedId === m.id) s.selectedId = null;
    onKill(m);
  }

  /** End the spell you are concentrating on, removing what it was doing. */
  function endConcentration() {
    const id = s.res?.concentration;
    if (!id) return;
    for (const k of ['bless', 'faith', 'trace', 'heroism', 'mark']) delete s.buffs[k];
    for (const m of s.monsters) if (m.cond?.paralyzed && m.cond.heldBy === 'hero') { delete m.cond.paralyzed; }
    s.res.concentration = null;
    s.effects = s.effects.filter((fx) => fx.owner !== 'hero' || fx.id !== id);
    refreshAC();
  }

  const timeLabel = { action: 'action', bonus: 'bonus action', reaction: 'reaction', free: 'free' };
  /** Why a spell or ability cannot be used right now (or null if it can). */
  function magicBlocked(item) {
    if (s.busy) return 'Wait for the current action to finish.';
    if (item.passive) return 'This works automatically.';
    if (item.kind === 'spell' && item.level > 0 && lowestSlot(s.res, item.level) < 0) return `No spell slots of level ${item.level} or higher left. Rest to recover them.`;
    if (item.kind === 'ability' && Number.isFinite(item.maxUses) && !(s.res.uses[item.id] > 0)) return `No uses left (${item.period === 'short' ? 'back after a short rest' : 'back after a long rest'}).`;
    if (item.effect?.type === 'pool' && !(s.res.pool > 0)) return 'Your healing pool is empty.';
    if (item.outOfCombat && s.mode === 'combat') return 'Not during a fight.';
    if (item.effect?.type === 'recover' && !s.res.slots.some((n, i) => n < s.res.maxSlots[i])) return 'You have not spent any spell slots.';
    if (['heal', 'pool'].includes(item.effect?.type) && s.hero.hp >= s.hero.maxHp) return 'You are not wounded.';
    if (s.mode === 'combat') {
      if (item.time === 'action' && s.actionUsed) return 'You have used your action this turn.';
      if (item.time === 'bonus' && s.bonusUsed) return 'You have used your bonus action this turn.';
      if (item.time === 'reaction' && !s.hero.reaction) return 'You have used your reaction this round.';
    }
    if (item.effect?.type === 'surge' && s.mode !== 'combat') return 'Only useful in a fight.';
    if (['dash', 'disengage'].includes(item.effect?.type) && s.mode !== 'combat') return 'Only useful in a fight.';
    return null;
  }

  function spendTime(time) {
    if (s.mode !== 'combat') return;
    if (time === 'action') { s.actionUsed = true; s.attacksLeft = 0; }
    if (time === 'bonus') s.bonusUsed = true;
    if (time === 'reaction') s.hero.reaction = false;
  }

  const findMagic = (id) => s.def.magic?.spells.find((x) => x.id === id) ?? s.def.magic?.abilities.find((x) => x.id === id);

  /** Click on a spell or ability: check it, find its target, then resolve it. */
  async function useMagic(id) {
    const item = findMagic(id);
    if (!item) return;
    const why = magicBlocked(item);
    if (why) { banner(why); return; }
    let target = null;
    if (item.target === 'enemy' || item.target === 'point') {
      target = s.selectedId && alive().find((m) => m.id === s.selectedId && canSee(m));
      if (!target) { banner(`Select a target first: click a foe, then cast ${item.name}.`); return; }
      if (edist(s.hero, target) > item.range) { banner(`${target.name} is out of range (${item.range * 5} ft).`); return; }
      if (!lineOfSight(s.hero.pos, target.pos, opaque()).visible) { banner('You need a clear line of sight.'); return; }
      if (item.effect.humanoidOnly && BESTIARY_BY_ID[target.statId].type !== 'humanoid') { banner(`${item.name} only works on humanoids.`); return; }
    }
    if ((item.target === 'cone' || item.target === 'around') && !areaTargets(item.effect.shape, item.effect.size, s.hero.pos).length) {
      banner(item.target === 'cone' ? `No foe in the cone in front of you (${item.effect.size * 5} ft). Turn to face them (Q / E).` : 'No foe is close enough.');
      return;
    }
    if (item.target === 'square') { s.pending = { id: item.id }; banner(`${item.name}: click a free square you can see, up to ${item.range * 5} ft away. Esc cancels.`); redraw(); return; }
    await resolveMagic(item, target);
  }

  /** Pay for a spell/ability: slot or use, the action economy, concentration. Returns the slot level. */
  function payFor(item) {
    spendTime(item.time);
    let slot = 0;
    if (item.kind === 'spell' && item.level > 0) { slot = lowestSlot(s.res, item.level); s.res.slots[slot - 1]--; }
    if (item.kind === 'ability' && Number.isFinite(item.maxUses)) s.res.uses[item.id]--;
    if (item.concentration) { endConcentration(); s.res.concentration = item.id; }
    return slot;
  }

  /** Every creature caught by an area. */
  function areaTargets(shape, size, center) {
    const f = FACINGS[s.hero.facing];
    return alive().filter((m) => {
      if (!canSee(m)) return false;
      if (shape === 'radius') return edistP(m, center) <= size;
      if (shape === 'around') return edist(m, s.hero) <= size;
      if (shape === 'cone') {
        const dx = m.pos.x - s.hero.pos.x; const dy = m.pos.y - s.hero.pos.y;
        if (edist(m, s.hero) > size || (!dx && !dy)) return false;
        // Inside the cone if the angle to the creature is within ~45° of where you face: cos >= 0.7.
        return (dx * f.dx + dy * f.dy) / (Math.hypot(dx, dy) * Math.hypot(f.dx, f.dy)) >= 0.7;
      }
      return false;
    });
  }

  /** Which painted effect fits a spell: fire, ice, lightning, arcane, healing, thunder, poison, radiant. */
  const VFX_BY_TYPE = { fire: 'fire', cold: 'ice', lightning: 'lightning', force: 'arcane', psychic: 'arcane', thunder: 'thunder', necrotic: 'poison', poison: 'poison', radiant: 'radiant', acid: 'poison' };
  function vfxFor(item) {
    const e = item.effect ?? {};
    if (e.type === 'heal' || e.type === 'pool' || e.type === 'inspire') return 'heal';
    if (e.type === 'reveal' || ['bless', 'faith', 'smite', 'deathward', 'heroism'].includes(e.buff)) return 'radiant';
    if (e.type === 'wall') return 'firewall';
    return VFX_BY_TYPE[e.damageType] ?? 'arcane';
  }

  /** Flash an effect sprite over an area (centre + radius in squares) for a moment. */
  async function showVfx(kind, center, radius = 0, ms = 650) {
    const fx = { kind, x: center.x, y: center.y, r: radius, n: 1 + Math.floor(Math.random() * 4), id: Math.random() };
    s.vfx.push(fx); drawOverlay();
    await sleep(reduceMotion ? 150 : ms);
    s.vfx = s.vfx.filter((v) => v !== fx); drawOverlay();
  }

  async function showBlast(center, radius, color, kind = 'arcane') {
    await showVfx(kind, center, radius, 520);
  }

  async function resolveMagic(item, target) {
    const slot = payFor(item);
    const e = item.effect;
    const lvl = s.def.level; const mod = s.def.caster?.mod ?? 0;
    const dc = s.def.caster?.dc ?? 8 + s.def.proficiencyBonus + Math.max(s.def.mods.int, s.def.mods.wis);
    const label = `${item.name}${slot > item.level ? ` (${ordinal(slot)}-level slot)` : ''}`;
    const affected = [];
    s.busy = true;
    play(item.sound ?? 'spell-arcane', { volume: 0.85 });
    if (target) s.hero.facing = facingToward(s.hero.pos, target.pos);
    switch (e.type) {
      case 'heal': {
        let amount; let how;
        if (e.flat) { amount = e.flat + (item.upcast?.flat ?? 0) * Math.max(0, slot - item.level); how = `${amount}`; } else {
          const dice = item.kind === 'spell' ? spellDice(item, slot, lvl) : e.dice;
          const r = roll(dice); amount = r.total + (e.addMod ? mod : 0) + (e.addLevel ? lvl : 0);
          how = `${dice} (${r.total})${e.addMod ? ` + ${mod}` : ''}${e.addLevel ? ` + ${lvl}` : ''}`;
        }
        const got = heal(amount);
        showVfx('heal', s.hero.pos, 0.6);
        log(`${s.hero.name} uses ${label}: heals ${how} = ${got} HP.`, 'heal');
        break;
      }
      case 'pool': {
        const got = heal(Math.min(s.res.pool, s.hero.maxHp - s.hero.hp));
        s.res.pool -= got;
        log(`${s.hero.name} lays on healing hands: +${got} HP (${s.res.pool} left in the pool).`, 'heal');
        break;
      }
      case 'buff': {
        s.buffs[e.buff] = e.buff === 'smite' ? { dice: spellDice(item, slot, lvl) } : true;
        if (e.buff === 'heroism') s.hero.tempHp = Math.max(s.hero.tempHp ?? 0, mod);
        refreshAC();
        showVfx(vfxFor(item), s.hero.pos, 0.6);
        log(`${s.hero.name} casts ${label}. ${item.desc}`, 'good');
        break;
      }
      case 'wall': {
        // A line of flame at right angles to the caster's line of sight, centred on the chosen spot.
        const c = centerOf(target.pos, target.size ?? 1);
        const across = Math.abs(c.x - s.hero.pos.x) >= Math.abs(c.y - s.hero.pos.y);
        const cx = Math.round(c.x); const cy = Math.round(c.y); const half = Math.floor(e.length / 2);
        const cells = [];
        for (let i = -half; i <= half; i++) {
          const q = across ? { x: cx, y: cy + i } : { x: cx + i, y: cy };
          if (s.map.tiles[q.y]?.[q.x] !== undefined && s.map.tiles[q.y][q.x] !== TILE.ROCK) cells.push(q);
        }
        const dice = spellDice(item, slot, lvl);
        s.effects.push({ id: item.id, kind: 'firewall', cells, rounds: e.rounds, dc, dice, save: e.save, damageType: e.damageType, owner: 'hero' });
        await showVfx('fire', c, half, 500);
        const lines = [];
        for (const m of alive().filter((m) => cellsOf(m.pos, m.size ?? 1).some((q) => cells.some((w) => w.x === q.x && w.y === q.y)))) {
          lines.push(burnIn(m, s.effects[s.effects.length - 1]));
          affected.push(m);
        }
        log(`${s.hero.name} raises a ${label}: ${cells.length} squares of roaring flame for ${e.rounds} rounds.${lines.length ? ` ${lines.join('; ')}.` : ''}`, 'good');
        break;
      }
      case 'mark':
        s.buffs.mark = target.id;
        log(`${s.hero.name} marks the ${target.name.toLowerCase()} as quarry (Hunter's Mark: +1d6 on each weapon hit).`, 'good');
        break;
      case 'inspire': {
        s.buffs.inspiration = inspirationDie(lvl);
        log(`${s.hero.name} sings a few bars of an old song: inspiration die ${s.buffs.inspiration} for the next attack, check or save.`, 'good');
        break;
      }
      case 'surge': s.actionUsed = false; s.attacksLeft = 0; log(`${s.hero.name} surges forward: one more action this turn!`, 'good'); break;
      case 'dash': s.moveLeft += s.hero.speed; s.dash = true; log(`${s.hero.name} darts ahead (Cunning Action: Dash).`, 'info'); break;
      case 'disengage': s.disengaged = true; log(`${s.hero.name} slips out of reach (Cunning Action: Disengage). No opportunity attacks this turn.`, 'info'); break;
      case 'recover': {
        const got = arcaneRecovery(s.res, lvl);
        log(`${s.hero.name} studies their notes and recovers spell slots: ${got.map(ordinal).join(', ') || 'none'}.`, 'good');
        break;
      }
      case 'reveal': {
        const found = [];
        for (const t of s.features.traps) if (!t.found && !t.sprung && chebyshev(t, s.hero.pos) <= e.radius) { t.found = true; found.push(t.name); }
        for (const k of [...s.features.secretDoors]) { const [x, y] = k.split(',').map(Number); if (chebyshev({ x, y }, s.hero.pos) <= e.radius) { revealSecret(k); found.push('secret door'); } }
        await showBlast(s.hero.pos, e.radius, item.color, vfxFor(item));
        log(`${label}: sunlight floods the halls. ${found.length ? `Revealed: ${found.join(', ')}.` : 'Nothing hidden nearby.'}`, 'good');
        break;
      }
      case 'attack': {
        const rays = spellCount(item, slot, 'rays');
        const dice = spellDice(item, slot, lvl);
        for (let i = 0; i < rays && !target.dead; i++) {
          const pseudo = { name: item.name, toHit: s.def.caster.attack, damage: dice, type: e.damageType, ranged: true, melee: false, normal: item.range, long: item.range };
          const opts = attackOptions({ attacker: s.hero, target, weapon: pseudo, opaque: opaque(), occupied: occupied(), enemiesOf });
          if (!opts) break;
          await shootProjectile(s.hero.pos, centerOf(target.pos, target.size ?? 1), item.color);
          const boost = rollBoosts({ attack: true });
          const r = resolveAttack({ weapon: { ...pseudo, toHit: pseudo.toHit + boost.total }, ac: opts.ac, mode: opts.mode });
          const head = `${s.hero.name} casts ${label}${rays > 1 ? ` (ray ${i + 1})` : ''} at the ${target.name.toLowerCase()}: spell attack d20 (${r.d20s.join(', ')}) ${signed(pseudo.toHit)}${boost.text} = ${r.total} vs AC ${opts.ac}.`;
          if (r.hit) {
            damageMonster(target, r.damage); flashHit(target); float(target.pos, `−${r.damage}`, 'good', r.crit);
            showVfx(vfxFor(item), centerOf(target.pos, target.size ?? 1), (target.size ?? 1) / 2);
            log(`${head} ${r.crit ? 'CRITICAL! ' : 'Hit! '}${r.damage} ${e.damageType} damage.`, 'good');
            if (target.hp > 0) play(cry(target, 'hurt'), { delay: 120 });
          } else { float(target.pos, 'miss', 'muted'); log(`${head} Miss.`, 'info'); }
          finishIfDead(target);
          await sleep(PAUSE_MS / 2);
        }
        affected.push(target);
        break;
      }
      case 'darts': {
        const n = spellCount(item, slot, 'count');
        let total = 0; const rolls = [];
        for (let i = 0; i < n; i++) {
          if (target.dead) break;
          await shootProjectile(s.hero.pos, centerOf(target.pos, target.size ?? 1), item.color);
          const r = roll(e.dice); total += r.total; rolls.push(r.total);
          damageMonster(target, r.total); flashHit(target); float(target.pos, `−${r.total}`, 'good');
          showVfx('arcane', centerOf(target.pos, target.size ?? 1), 0.3, 300);
          finishIfDead(target);
        }
        log(`${s.hero.name} casts ${label}: ${rolls.length} darts strike the ${target.name.toLowerCase()} for ${rolls.join(' + ')} = ${total} force damage.`, 'good');
        affected.push(target);
        break;
      }
      case 'sleep': {
        const pool = roll(addDice(e.pool, item.upcast?.pool, slot - item.level));
        let left = pool.total; const slept = [];
        const near = alive().filter((m) => edist(m, target) <= e.radius && BESTIARY_BY_ID[m.statId].type !== 'undead' && !m.cond?.asleep).sort((a, b) => a.hp - b.hp);
        for (const m of near) { if (m.hp > left) break; left -= m.hp; (m.cond ??= {}).asleep = true; slept.push(m.name); }
        await showBlast(centerOf(target.pos, target.size ?? 1), e.radius, item.color, vfxFor(item));
        log(`${s.hero.name} casts ${label}: ${e.pool} = ${pool.total} hit points of slumber. ${slept.length ? `Asleep: ${slept.join(', ')}.` : 'Nobody falls asleep: they are too hale.'}`, slept.length ? 'good' : 'info');
        // Sleeping creatures do not raise the alarm; the others nearby do.
        affected.push(...near.filter((m) => !m.cond?.asleep));
        break;
      }
      case 'save': {
        const center = item.target === 'point' ? target.pos : s.hero.pos;
        const targets = e.shape ? areaTargets(e.shape, e.size, center) : [target];
        const dice = item.kind === 'spell' ? spellDice(item, slot, lvl) : null;
        const dmgRoll = dice ? roll(dice) : null;
        if (e.shape === 'cone') { const f = FACINGS[s.hero.facing]; await showBlast({ x: s.hero.pos.x + f.dx * (e.size + 1) / 2, y: s.hero.pos.y + f.dy * (e.size + 1) / 2 }, (e.size - 1) / 2 + 0.5, item.color, vfxFor(item)); } else if (e.shape) await showBlast(item.target === 'point' ? centerOf(target.pos, target.size ?? 1) : center, e.size, item.color, vfxFor(item));
        else if (target) { await shootProjectile(s.hero.pos, centerOf(target.pos, target.size ?? 1), item.color); showVfx(vfxFor(item), centerOf(target.pos, target.size ?? 1), (target.size ?? 1) / 2); }
        const lines = [];
        for (const m of targets) {
          const sv = monsterRoll(m, e.save, dc);
          let dmg = 0;
          if (dmgRoll) dmg = sv.ok ? (e.half ? Math.floor(dmgRoll.total / 2) : 0) : dmgRoll.total;
          if (dmg) { damageMonster(m, dmg); flashHit(m); float(m.pos, `−${dmg}`, 'good'); }
          if (!sv.ok) applyRider(e.onFail, m, dc);
          lines.push(`${m.name}: ${e.save.toUpperCase()} save ${sv.total} vs DC ${dc} ${sv.ok ? 'saves' : 'fails'}${dmgRoll ? `, ${dmg} ${e.damageType}` : ''}${!sv.ok && e.onFail ? ` (${riderText[e.onFail]})` : ''}`);
          finishIfDead(m);
          affected.push(m);
        }
        // A fireball in a corridor hurts its caster too.
        if (item.target === 'point' && e.shape === 'radius' && chebyshev(s.hero.pos, center) <= e.size && dmgRoll) {
          const c = heroCheck(s.def.saves?.[e.save] ?? 0, dc, { save: true });
          const evade = s.def.evasion && e.save === 'dex';
          const dmg = evade ? (c.ok ? 0 : Math.floor(dmgRoll.total / 2)) : (c.ok ? Math.floor(dmgRoll.total / 2) : dmgRoll.total);
          damageHero(dmg); float(s.hero.pos, `−${dmg}`, 'bad');
          lines.push(`${s.hero.name} is caught in the blast! ${checkText(`${e.save.toUpperCase()} save`, c)}: ${dmg} damage`);
        }
        log(`${s.hero.name} uses ${label}${dmgRoll ? ` (${dice} = ${dmgRoll.total})` : ''}. ${lines.join('; ') || 'It catches no one'}.`, 'good');
        break;
      }
      default:
    }
    s.busy = false;
    if (s.hero.hp <= 0) { heroFell(); return; }
    if (affected.length) provoke(affected);
    checkCombatOver();
    redraw();
  }

  /** A creature caught in a lasting effect: save for half damage. Returns a log fragment. */
  function burnIn(m, fx) {
    const isHero = !!m.isHero;
    let sv;
    if (isHero) { const back = s.active; activate(memberIndex(m)); sv = heroCheck(s.def.saves?.[fx.save] ?? 0, fx.dc, { save: true }); activate(back); } else sv = monsterRoll(m, fx.save, fx.dc);
    const r = roll(fx.dice);
    const dmg = sv.ok ? Math.floor(r.total / 2) : r.total;
    if (isHero) { const back = s.active; activate(memberIndex(m)); damageHero(dmg); activate(back); } else { damageMonster(m, dmg); finishIfDead(m); }
    float(m.pos, `−${dmg}`, isHero ? 'bad' : 'good'); flashHit(m);
    return `${m.name} burns: ${fx.save.toUpperCase()} save ${sv.total} vs DC ${fx.dc}, ${dmg} ${fx.damageType}`;
  }
  const inEffect = (e, fx) => cellsOf(e.pos, e.size ?? 1).some((q) => fx.cells.some((w) => w.x === q.x && w.y === q.y));

  const riderText = { mock: 'disadvantage on its next attack', flee: 'flees in terror', push: 'pushed back', stun: 'stunned', paralyze: 'paralysed', restrain: 'restrained' };
  function applyRider(kind, m, dc) {
    const c = m.cond ??= {};
    if (kind === 'mock') c.mock = true;
    if (kind === 'flee') c.flee = 2;
    if (kind === 'stun') c.stun = 1;
    if (kind === 'paralyze') { c.paralyzed = dc; c.heldBy = 'hero'; }
    if (kind === 'restrain') c.restrained = dc;
    if (kind === 'push') {
      // Shove it up to 2 squares straight away from you, stopping at walls and other creatures.
      const dx = Math.sign(m.pos.x - s.hero.pos.x); const dy = Math.sign(m.pos.y - s.hero.pos.y);
      const blocked = new Set([...occupied(m), ...terrainBlocked()]);
      for (let i = 0; i < 2; i++) {
        const n = { x: m.pos.x + dx, y: m.pos.y + dy };
        if (s.map.tiles[n.y]?.[n.x] === undefined || s.map.tiles[n.y][n.x] === TILE.ROCK || blocked.has(cellKey(n.x, n.y))) break;
        if (s.map.tiles[n.y][n.x] === TILE.DOOR && !s.doors.get(cellKey(n.x, n.y))) break;
        m.pos = n;
      }
    }
  }
  const ordinal = (n) => `${n}${n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th'}`;

  /** Misty Step: finish the teleport on the clicked square. */
  function finishTeleport(c) {
    const item = findMagic(s.pending.id);
    const k = cellKey(c.x, c.y);
    const ok = s.visible.has(k) && s.map.tiles[c.y][c.x] !== TILE.ROCK && !occupied().has(k) && !terrainBlocked().has(k) && chebyshev(c, s.hero.pos) <= item.range
      && !(s.map.tiles[c.y][c.x] === TILE.DOOR && !s.doors.get(k));
    if (!ok) { banner('Choose a free square you can see, within range.'); return; }
    s.pending = null;
    payFor(item);
    play(item.sound, { volume: 0.8 });
    const from = { ...s.hero.pos };
    s.hero.pos = { x: c.x, y: c.y };
    s.hero.facing = facingToward(from, c) >= 0 ? facingToward(from, c) : s.hero.facing;
    float(from, '✦', 'muted'); float(c, '✦', 'good');
    log(`${s.hero.name} steps into silver mist and reappears ${chebyshev(from, c) * 5} ft away.`, 'good');
    const spotted = updateVision();
    if (spotted.length) enterCombat(spotted);
    redraw();
  }

  // ---------------------------------------------------------------------------
  // Rests and stealth
  // ---------------------------------------------------------------------------

  /**
   * Short rest: spend Hit Dice to heal and recover short-rest abilities. Long rest: everything
   * back, once per floor. Either can be interrupted by wandering monsters.
   */
  function rest(kind) {
    if (s.mode === 'combat' || s.busy) { banner('You cannot rest with enemies nearby.'); return; }
    if (kind === 'long' && s.longRested) { banner('You have already taken a long rest on this floor. Go deeper first.'); return; }
    const w = wanderingCheck(kind);
    const what = kind === 'long' ? 'a long rest' : 'a short rest';
    if (w.interrupted) {
      log(`${s.hero.name} settles down for ${what}... Wandering monster check: d6 = ${w.d6}. Something is coming!`, 'warn');
      if (!makeNoise(99, 2)) log('...whatever it was passes by, but the rest is spoiled.', 'info');
      if (kind === 'long') s.longRested = true;
      redraw(); return;
    }
    const back = s.active;
    for (let i = 0; i < s.members.length; i++) {
      activate(i);
      if (kind === 'short') {
        const before = s.res.hitDice;
        if (s.hero.hp <= 0) s.hero.hp = 1;
        const r = shortRest(s.res, magicHero(), s.hero.hp, s.hero.maxHp);
        s.hero.hp += r.healed;
        log(`${s.hero.name} takes a short rest (wandering check d6 = ${w.d6}, all quiet). ${r.rolls.length ? `Spends ${before - s.res.hitDice} Hit Dice: d${s.def.hitDie} rolls ${r.rolls.join(', ')} + CON each = +${r.healed} HP.` : 'No Hit Dice spent.'} Short-rest abilities recovered.`, 'heal');
      } else {
        longRest(s.res, magicHero());
        s.hero.hp = s.hero.maxHp; s.hero.tempHp = 0;
        endConcentration(); s.buffs = {}; refreshAC();
        log(`${s.hero.name} sleeps through a long rest (wandering check d6 = ${w.d6}, all quiet). Hit points, spell slots and abilities are restored.`, 'heal');
      }
    }
    activate(back);
    if (kind === 'long') s.longRested = true;
    play('spell-heal', { volume: 0.6 });
    redraw();
  }

  /** Sneak: one Stealth check; creatures whose passive Perception is lower do not notice you. */
  function sneak() {
    if (s.mode === 'combat') { banner('Too late to hide: they have seen you.'); return; }
    if (s.sneak) { s.sneak = null; log(`${s.hero.name} stops sneaking.`, 'info'); redraw(); return; }
    // A party sneaks only as well as its clumsiest member: everyone rolls, the lowest roll counts.
    const back = s.active; const rolls = [];
    for (let i = 0; i < s.members.length; i++) {
      activate(i);
      if (s.hero.hp <= 0) continue;
      const bonus = (s.hero.skills.stealth ?? 0) + (s.buffs.trace ? 10 : 0);
      const c = heroCheck(bonus, 0, { mode: s.def.stealthDis ? 'disadvantage' : 'normal' });
      rolls.push({ name: s.hero.name, total: c.total, text: `${s.hero.name}${s.def.stealthDis ? ' (noisy armour: disadvantage)' : ''}${s.buffs.trace ? ' (Pass without Trace)' : ''}: ${c.d20s.length > 1 ? `d20 (${c.d20s.join(', ')} → ${c.d20})` : `d20 (${c.d20})`} ${signed(bonus)}${c.extra} = ${c.total}` });
    }
    activate(back);
    const worst = rolls.reduce((a, b) => (b.total < a.total ? b : a));
    s.sneak = { total: worst.total };
    for (const m of s.monsters) m.unnoticed = false;
    log(`${rolls.length > 1 ? 'The party moves' : `${worst.name} moves`} into the shadows. Stealth: ${rolls.map((r) => r.text).join('; ')}.${rolls.length > 1 ? ` The party is only as quiet as ${worst.name}: ${worst.total}.` : ''}`, 'info');
    redraw();
  }

  function magicPanel() {
    const d = s.def; const m = d?.magic;
    if (!m || (!m.spells.length && !m.abilities.length)) return '';
    const r = s.res;
    const usable = [...m.abilities.filter((a) => !a.passive), ...m.spells].sort((a, b) => (a.kind === b.kind ? (a.level ?? 0) - (b.level ?? 0) : a.kind === 'ability' ? -1 : 1));
    const btn = (it) => {
      const why = magicBlocked(it);
      const cost = it.kind === 'spell' ? (it.level === 0 ? 'cantrip' : `${ordinal(it.level)}`) : Number.isFinite(it.maxUses) ? `${r.uses[it.id] ?? 0}/${it.maxUses}` : it.effect?.type === 'pool' ? `${r.pool} HP` : '';
      return `<button class="spell-btn ${it.kind} ${why ? 'off' : ''}" data-dg="cast" data-id="${it.id}" title="${esc(`${it.desc}${it.range ? ` Range ${it.range * 5} ft.` : ''} ${why ? `(${why})` : ''}`)}">
        <b>${esc(it.name)}</b><span class="muted">${esc(cost)} · ${timeLabel[it.time] ?? 'action'}${it.concentration ? ' · C' : ''}</span></button>`;
    };
    const slots = r.maxSlots.length ? `<div class="slots">${r.maxSlots.map((n, i) => `<span class="slot-lvl" title="${ordinal(i + 1)}-level spell slots">${ordinal(i + 1)} ${'●'.repeat(r.slots[i])}${'○'.repeat(n - r.slots[i])}</span>`).join('')}</div>` : '';
    const buffs = [s.res.concentration && `Concentrating: ${findMagic(s.res.concentration)?.name}`, s.buffs.shield && 'Ward of Iron +5 AC', s.buffs.smite && 'Wrath ready', s.buffs.ensnare && 'Ensnaring Strike ready',
      s.buffs.inspiration && `Inspiration ${s.buffs.inspiration}`, s.buffs.deathward && 'Ward against Death', s.hero.tempHp && `${s.hero.tempHp} temp HP`].filter(Boolean);
    return `<h4>Spells &amp; abilities</h4>
      ${d.caster ? `<p class="small muted">Spell save DC <b>${d.caster.dc}</b> · spell attack <b>${signed(d.caster.attack)}</b> (${d.caster.ability.toUpperCase()})</p>` : ''}
      ${slots}
      ${buffs.length ? `<p class="small buffs">${buffs.map(esc).join(' · ')}${s.res.concentration ? ' <button class="linkish" data-dg="end-conc">end</button>' : ''}</p>` : ''}
      <div class="spell-list">${usable.map(btn).join('')}</div>
      ${m.abilities.some((a) => a.passive) ? `<p class="small muted">Always on: ${m.abilities.filter((a) => a.passive).map((a) => `<span title="${esc(a.desc)}">${esc(a.name)}</span>`).join(', ')}</p>` : ''}`;
  }

  function restPanel() {
    if (!s.res) return '';
    const combat = s.mode === 'combat';
    return `<div class="hc-actions rest-row">
      <button class="btn small" data-dg="sneak" ${combat ? 'disabled' : ''} title="Stealth check: foes whose passive Perception is lower will not notice you">${s.sneak ? `👣 Sneaking (${s.sneak.total})` : '👣 Sneak'}</button>
      <button class="btn small" data-dg="rest-short" ${combat ? 'disabled' : ''} title="Spend Hit Dice to heal; short-rest abilities return. 1 in 6 chance of wandering monsters.">☾ Short rest <span class="muted">${s.res.hitDice} HD</span></button>
      <button class="btn small" data-dg="rest-long" ${combat || s.longRested ? 'disabled' : ''} title="Full recovery, once per floor. 1 in 3 chance of wandering monsters.">☀ Long rest</button>
    </div>`;
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
      awardXp(skillXp(dc, s.def.level), m.pos);
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
    const d = edist(s.hero, m);
    const combat = s.mode === 'combat';
    const health = s.knownHp.has(m.id) ? `${m.hp} / ${m.maxHp} HP` : woundState(m.hp, m.maxHp);
    const weapons = s.hero.weapons.map((w, i) => {
      const o = attackOptions({ attacker: s.hero, target: m, weapon: w, opaque: opaque(), occupied: occupied(), enemiesOf });
      const blocked = !o || !canAttack() || s.busy || !combat;
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
      ${(() => {
    const targeted = [...(s.def.magic?.abilities ?? []), ...(s.def.magic?.spells ?? [])].filter((x) => !x.passive && (x.target === 'enemy' || x.target === 'point'));
    if (!targeted.length) return '';
    return `<h4>Cast at it</h4><div class="spell-list">${targeted.map((x) => {
      const why = magicBlocked(x) ?? (d > x.range ? `Out of range (${x.range * 5} ft)` : null);
      return `<button class="spell-btn ${x.kind} ${why ? 'off' : ''}" data-dg="cast" data-id="${x.id}" title="${esc(`${x.desc} ${why ? `(${why})` : ''}`)}"><b>${esc(x.name)}</b><span class="muted">${x.kind === 'spell' ? (x.level ? ordinal(x.level) : 'cantrip') : `${s.res.uses[x.id] ?? ''}`} · ${x.range * 5} ft</span></button>`;
    }).join('')}</div>`;
  })()}
      ${!combat ? `<p class="small muted">${m.aware ? 'Attacks are made on your turn in combat.' : 'It has not noticed you: attacking now gets advantage and catches it by surprise.'}</p>` : !canAttack() ? '<p class="small muted">You have used your action this turn.</p>' : '<p class="small muted">Tip: click the selected foe again to attack with your best weapon.</p>'}
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

  /** Bodies, chests, doors and traps open as a pop-up in the middle of the screen. */
  function drawPop() {
    const box = $('.dg-pop');
    const html = s.target ? interactPanel(s.target) : '';
    if (s.target && !html) s.target = null;
    box.hidden = !html;
    if (html) box.innerHTML = `<div class="dg-pop-card">${html}<p class="small muted pop-hint">Esc or click outside to close.</p></div>`;
  }

  /** Party roster: who is in the group, their health; while exploring, click to choose the leader. */
  function partyBar() {
    if (s.members.length < 2) return '';
    return `<div class="party-bar">${s.members.map((m, i) => {
      const h = m.hero; const me = h === s.hero;
      return `<button class="party-member ${me ? 'me' : ''} ${h.hp <= 0 ? 'down' : ''}" data-dg="pick-hero" data-i="${i}" ${s.mode === 'combat' || s.busy ? 'disabled' : ''} title="${esc(h.name)}${s.mode === 'combat' ? '' : ': click to lead the party'}">
        <img src="${esc(h.look?.url ?? '')}" alt="" style="filter:${h.look?.filter ?? 'none'};border-color:${h.look?.frameColor ?? '#c9a227'}">
        <span><b>${esc(h.name.split(' ')[0])}</b><span class="mini-hp"><span style="width:${Math.max(0, h.hp / h.maxHp) * 100}%"></span></span><small>${h.hp}/${h.maxHp}</small></span></button>`;
    }).join('')}</div>`;
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

    const hov = s.hover;
    if (!hov || !s.hero) { box.innerHTML = '<p class="muted small">Click a foe to see its portrait, attack it or study it. Click chests, locked doors, traps and bodies next to you. Hover to check distances.</p>'; return; }
    const foe = alive().find((m) => covers(m, hov) && canSee(m));
    if (foe) {
      const plan = heroAttackPlan(foe);
      box.innerHTML = `<div class="foe-mini">${monsterPortrait(foe.statId) ? `<img src="${esc(monsterPortrait(foe.statId))}" alt="">` : ''}<div><h3>${esc(foe.name)}</h3>
        <p class="small">${woundState(foe.hp, foe.maxHp)} · ${edist(s.hero, foe) * 5} ft away</p>
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
    if (s.pending) { finishTeleport(c); return; }
    const foe = alive().find((m) => covers(m, c) && canSee(m));
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
    if (body) { approachThen(body.pos, () => { s.target = { kind: 'corpse', id: body.id }; }); return; }
    const chest = known && chestAt(c.x, c.y);
    if (chest) {
      approachThen(chest, () => { if (!chest.locked && !chest.opened) openChest(chest); else s.target = { kind: 'chest', id: chest.id }; });
      return;
    }
    if (known && isLocked(k)) { approachThen(c, () => { s.target = { kind: 'door', id: k }; }); return; }
    const trap = trapAt(c.x, c.y);
    if (trap && trap.found && !trap.disarmed && !trap.sprung) { s.target = { kind: 'trap', id: trap.id }; redraw(); return; }
    const t = s.reach.get(k);
    if (t && t.cost > 0) { s.target = null; moveHero(t); }
  }

  /** Walk next to something (if needed and possible), then open its pop-up. */
  async function approachThen(pos, open) {
    if (chebyshev(s.hero.pos, pos) > 1) {
      const step = [...s.reach.values()].filter((r) => r.cost > 0 && chebyshev(r, pos) <= 1).sort((a, b) => a.cost - b.cost)[0];
      if (step) await moveHero(step);
    }
    if (s.mode === 'defeat') return;
    open();
    redraw();
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

  host.addEventListener('click', (e) => { if (e.target.classList?.contains('dg-pop')) { s.target = null; redraw(); } });
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
      case 'pick-hero': if (s.mode !== 'combat' && !s.busy && s.members[Number(el.dataset.i)]?.hero.hp > 0) { activate(Number(el.dataset.i)); startHeroTurn(); redraw(); centerOn(s.hero.pos); } break;
      case 'leave-arena': onLeave?.(); break;
      case 'cast': useMagic(el.dataset.id); break;
      case 'end-conc': { const n = findMagic(s.res.concentration)?.name; endConcentration(); log(`${s.hero.name} lets ${n} end.`, 'info'); redraw(); break; }
      case 'sneak': sneak(); break;
      case 'rest-short': rest('short'); break;
      case 'rest-long': rest('long'); break;
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
      case 'party': {
        const boxes = [...host.querySelectorAll('[data-dg="party"]')];
        let ids = boxes.filter((b) => b.checked).map((b) => b.value);
        if (ids.length > 4) { el.checked = false; banner('A party can have up to 4 heroes.'); break; }
        if (!ids.length) { el.checked = true; ids = [el.value]; banner('Someone has to go!'); }
        s.partyIds = ids; resetDelve(); centerOn(s.hero.pos);
        break;
      }
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
    else if (e.key === 'Escape' && s.target) { s.target = null; redraw(); }
    else if (e.key === 'Escape' && s.pending) { s.pending = null; banner('Cancelled.'); redraw(); }
    else if (e.key === 'Escape' && s.invOpen) { s.invOpen = false; redraw(); }
    else if (e.key === 'Escape' && (s.selectedId || s.target)) { s.selectedId = null; s.target = null; redraw(); }
  };
  window.addEventListener('keydown', onKey);

  if (!heroes.length) { host.querySelector('.dg-help').textContent = 'Create or adopt a hero first.'; }
  preload(SOUND_KEYS);
  newDungeon(s.seed);
}
