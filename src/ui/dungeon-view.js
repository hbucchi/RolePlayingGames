/**
 * Dungeon delve: fog of war, line of sight, facing, and turn-based battles with goblins.
 *
 * The base map (textures, walls, grid) is drawn once per dungeon. Everything that changes
 * (doors, fog, highlights, tokens, damage numbers) lives in a light SVG overlay redrawn
 * after every step.
 *
 * This file holds the shared state `s`, setup, the party, vision, moving, loot and input. The
 * rest of the screen lives in ./dungeon/ (each part gets `ctx`, see below):
 *   render.js         tokens, bodies, doors, fog, highlights, effects on the map
 *   panels.js         the side panel: hero card, spells, rest, creatures, talking, nearby things
 *   actions.js        searching, items, locks, traps, checks, damage
 *   magic.js          spells and abilities, resting, sneaking
 *   attacks.js        weapon attacks, projectiles, blood
 *   monster-turns.js  monsters' and allies' turns, their powers, lingering ground
 *   endings.js        victory and defeat; mods (./mods/) can add defeat modes such as captivity
 */
import { generateDungeon, TILE } from '../engine/dungeon.js';
import { renderDungeonSVG } from '../engine/dungeon-render.js';
import { renderArenaSVG } from '../engine/arena-render.js';
import { cellsOf, blockDistance, dims, spanOf, centerOf } from '../engine/size.js';
import { reachableSquares, speedToSquares, cellKey } from '../engine/movement.js';
import { makeOpacity, visibleSquares, revealFrom, inFieldOfView, lineOfSight } from '../engine/vision.js';
import { facingToward, rotateFacing, chebyshev, weaponFromHeroAttack, rollInitiative, createMonster, entityDistance, covers, reachOf, immobile } from '../engine/combat.js';
import { BESTIARY_BY_ID } from '../content/bestiary/index.js';
import { monsterPortrait } from '../content/media.js';
import { play, preload, SOUND_KEYS } from './audio.js';
import { setMood } from './music.js';
import { getFigures, getSetting, setSetting, PACE_FACTOR } from './settings.js';
import { roll } from '../engine/dice.js';
import { placeFeatures, populateDungeon } from '../engine/features.js';
import { furnishDungeon } from '../engine/props.js';
import { sellItem, haggleRate, whyUnsellable, BASE_RATE } from '../engine/trade.js';
import { terrainCost } from '../engine/terrain.js';
import { GOODS } from './trade-view.js';
import { installCharacters } from './dungeon/characters.js';
import { rollMonsterLoot } from '../engine/loot.js';
import { makeItem as makeItemSafe, addItem, removeItem, itemName, itemDef, equipItem, unequipSlot, isEquipped, formatCoins } from '../engine/items.js';
import { freshResources, skillXp } from '../engine/magic.js';
import { DUNGEON_FOES } from '../content/westlands/dungeon-foes.js';
import { seededRng } from '../engine/dice.js';
import { installMonsterTurns } from './dungeon/monster-turns.js';
import { installAttacks } from './dungeon/attacks.js';
import { installEndings } from './dungeon/endings.js';
import './mods/index.js';
import { defeatMode } from './mods/registry.js';
import { installRender } from './dungeon/render.js';
import { installActions } from './dungeon/actions.js';
import { installMagic } from './dungeon/magic.js';
import { installPanels } from './dungeon/panels.js';

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
// Monster turns: a step of movement, and the pause after an action. The Monster turns setting
// stretches both (and the flight of arrows and spells) so the eye can follow.
let STEP_MS = 0; let PAUSE_MS = 0; let PACE = 1;
/** One square of your own heroes' walk, in milliseconds (tokens glide across it in this time). */
const HERO_STEP_MS = 400;
function applyPace() {
  PACE = PACE_FACTOR[getSetting('pace')] ?? 1.4;
  // One square of a monster's walk; tokens glide across it in exactly this time (render.js).
  STEP_MS = reduceMotion ? 0 : Math.round(300 * PACE);
  PAUSE_MS = reduceMotion ? 0 : Math.round(420 * PACE);
}
applyPace();
const pct = (p) => `${Math.round(p * 100)}%`;
const signed = (n) => (n >= 0 ? `+${n}` : `${n}`);

const FOE_POOL = DUNGEON_FOES.map((id) => BESTIARY_BY_ID[id]).filter(Boolean);

/**
 * @param {HTMLElement} host
 * @param {{heroes: {id:string,label:string}[], api: {load, derive, save}, initialSeed?: number}} opts
 *   api.load(id) -> the hero's draft (with gear); api.derive(draft) -> combat stats;
 *   api.save(draft) -> the saved draft (a ready-made hero is adopted on its first save).
 */
export function mountDungeon(host, { heroes, api, initialSeed = 7, arena = null, onLeave = null, onOutcome = null, campaign = null }) {
  // A place in a campaign (arena.location) is a real outing: XP, loot and wounds count, people
  // can be talked to, and the way out leads back to the world map. A plain arena bout is practice.
  const place = arena?.location ?? null;
  const practice = !!arena && !place;
  const s = {
    seed: initialSeed, map: null, grid: true, revealAll: !!arena && arena.reveal !== false, rule: 'standard', zoom: 0.5,
    partyIds: arena ? arena.heroes.map((h) => h.id) : heroes.slice(0, 1).map((h) => h.id), members: [], active: 0,
    hero: null, monsters: [],
    doors: new Map(), revealed: new Set(), visible: new Set(),
    mode: 'explore', round: 0, order: [], turnIdx: 0,
    moveLeft: 0, actionUsed: false, dash: false, weaponIdx: 0,
    hover: null, busy: false, log: [], floats: [], reach: new Map(),
    selectedId: null, knowledge: {}, knownHp: new Set(), lunge: null, flash: new Set(), projectile: null, lastStudy: null,
    draft: null, def: null, features: null, target: null, invOpen: false, invSel: null, invFilter: 'all',
    ammoSpent: {}, delve: { xp: 0, coins: 0, items: 0, kills: 0 }, lastCheck: null, phialUsed: false,
    vfx: [], effects: [], blood: [],
    view: getFigures(),
    res: null, buffs: {}, bonusUsed: false, attacksLeft: 0, sneakUsed: false, disengaged: false, sneak: null, pending: null, blast: null, longRested: false,
  };

  /** Whether rooms show their numbers (remembered between visits; on unless turned off). */
  function roomNumbersPref() { try { return localStorage.getItem('rpg.roomNumbers') !== '0'; } catch { return true; } }
  s.roomNumbers = roomNumbersPref();

  host.innerHTML = `
    <div class="dg-topbar">
      <div class="dg-group dg-partypick" ${arena ? 'hidden' : ''}>
        <span class="small muted">Party (up to 4):</span>
        ${heroes.map((h) => `<label class="chip party-chip"><input type="checkbox" data-dg="party" value="${esc(h.id)}" ${h === heroes[0] ? 'checked' : ''}> ${esc(h.label)}</label>`).join('')}
      </div>
      <div class="dg-group dg-arenabar" ${arena ? '' : 'hidden'}>
        <b>${esc(arena?.name ?? 'Arena')}</b>
        <button class="btn small" data-dg="leave-arena">${place ? '← World map' : arena?.story ? '← Back to the story' : '← Back to the builder'}</button>
        ${place ? '' : '<button class="btn small ghost" data-dg="retry">Restart bout</button>'}
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
        <button class="btn small ghost" data-dg="settings" aria-expanded="false" aria-controls="dg-settings">⚙ Settings</button>
      </div>
      <div class="dg-group" ${arena ? 'hidden' : ''}>
        <label class="dg-check"><input id="dg-grid" type="checkbox" data-dg="grid" checked> Grid</label>
        <label class="dg-check" title="Show the number of each room on the map"><input id="dg-roomnums" type="checkbox" data-dg="room-numbers" ${roomNumbersPref() ? 'checked' : ''}> Room numbers</label>
        <label class="dg-check" title="Narrator view: show the whole map and every monster"><input id="dg-reveal" type="checkbox" data-dg="reveal"> Reveal map</label>
      </div>
    </div>
    <div class="dg-layout">
      <div class="dg-mapwrap">
        <div class="dg-actionbar" role="toolbar" aria-label="Hero actions"></div>
        <div class="dg-banner" aria-live="polite"></div>
        <div class="dg-reviewbar" hidden role="status"><span>☠ <b>Defeated.</b> The battle is frozen: drag, zoom and hover to study it, and read the battle log.</span><button class="btn small primary" data-dg="end-again">Options</button></div>
        <div class="dg-viewport" tabindex="0" aria-label="Dungeon map. Drag to pan, scroll or pinch to zoom.">
          <div class="dg-stage">
            <div class="dg-base"></div>
            <svg class="dg-overlay" xmlns="http://www.w3.org/2000/svg"></svg>
            <svg class="dg-fx" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"></svg>
          </div>
        </div>
        <p class="dg-help muted small">Click a lit square to move · click a creature for everything you can do (attack, talk, shove…) · Shift+click a foe to attack at once · click chests, doors, traps and bodies next to you · I opens your pack · Q / E turn · drag to pan, scroll to zoom</p>
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
    <div class="dg-chars" hidden role="dialog" aria-label="Characters"></div>
    <div class="dg-pop" hidden role="dialog" aria-modal="true"></div>
    <div class="dg-settings" id="dg-settings" hidden role="dialog" aria-label="Settings"></div>`;

  const $ = (sel) => host.querySelector(sel);
  const viewport = $('.dg-viewport'); const stage = $('.dg-stage');
  const base = $('.dg-base'); const overlay = $('.dg-overlay');
  const S = () => s.map.cellSize;

  // The screen's parts live in ./dungeon/*.js. They reach the shared state and each other's
  // functions through ctx (getters, so they always see the current value).
  const ctx = {};
  Object.defineProperties(ctx, {
    $: { get: () => $ },
    PACE: { get: () => PACE, set: (v) => { PACE = v; } },
    PAUSE_MS: { get: () => PAUSE_MS, set: (v) => { PAUSE_MS = v; } },
    S: { get: () => S },
    STEP_MS: { get: () => STEP_MS, set: (v) => { STEP_MS = v; } },
    HERO_STEP_MS: { get: () => HERO_STEP_MS },
    reduceMotion: { get: () => reduceMotion },
    activate: { get: () => activate },
    addGround: { get: () => addGround },
    adjacent: { get: () => adjacent },
    alive: { get: () => alive },
    allies: { get: () => allies },
    arena: { get: () => arena },
    awardPartyXp: { get: () => awardPartyXp },
    awardXp: { get: () => awardXp },
    banner: { get: () => banner },
    bleed: { get: () => bleed },
    boltFor: { get: () => boltFor },
    burnIn: { get: () => burnIn },
    canAttack: { get: () => canAttack },
    canSee: { get: () => canSee },
    checkCombatOver: { get: () => checkCombatOver },
    checkText: { get: () => checkText },
    conditionSkip: { get: () => conditionSkip },
    cry: { get: () => cry },
    damageHero: { get: () => damageHero },
    damageMonster: { get: () => damageMonster },
    doAttack: { get: () => doAttack },
    drawBlood: { get: () => drawBlood },
    drawOverlay: { get: () => drawOverlay },
    drawPanel: { get: () => drawPanel },
    edist: { get: () => edist },
    edistP: { get: () => edistP },
    endAlliance: { get: () => endAlliance },
    endConcentration: { get: () => endConcentration },
    enemiesOf: { get: () => enemiesOf },
    styleOf: { get: () => styleOf },
    keyFor: { get: () => keyFor },
    tradeRate: { get: () => tradeRate },
    enterCombat: { get: () => enterCombat },
    esc: { get: () => esc },
    drawCharacters: { get: () => drawCharacters },
    fighting: { get: () => fighting },
    findMagic: { get: () => findMagic },
    finishIfDead: { get: () => finishIfDead },
    flashHit: { get: () => flashHit },
    float: { get: () => float },
    foes: { get: () => foes },
    freeCreature: { get: () => freeCreature },
    hasTools: { get: () => hasTools },
    heal: { get: () => heal },
    heroAttackPlan: { get: () => heroAttackPlan },
    heroCheck: { get: () => heroCheck },
    heroFell: { get: () => heroFell },
    heroOpportunityAttack: { get: () => heroOpportunityAttack },
    heroReach: { get: () => heroReach },
    hitExtras: { get: () => hitExtras },
    host: { get: () => host },
    inBounds: { get: () => inBounds },
    inEffect: { get: () => inEffect },
    inSight: { get: () => inSight },
    isFloor: { get: () => isFloor },
    isLocked: { get: () => isLocked },
    isSecret: { get: () => isSecret },
    joinParty: { get: () => joinParty },
    keepInView: { get: () => keepInView },
    log: { get: () => log },
    magicBlocked: { get: () => magicBlocked },
    magicHero: { get: () => magicHero },
    makeNoise: { get: () => makeNoise },
    memberIndex: { get: () => memberIndex },
    monsterRoll: { get: () => monsterRoll },
    occupied: { get: () => occupied },
    onExit: { get: () => onExit },
    onKill: { get: () => onKill },
    opaque: { get: () => opaque },
    openDoorAt: { get: () => openDoorAt },
    ordinal: { get: () => ordinal },
    overlay: { get: () => overlay },
    party: { get: () => party },
    campaign: { get: () => campaign },
    place: { get: () => place },
    wallet: { get: () => wallet },
    SPIRIT: { get: () => SPIRIT },
    bloodOf: { get: () => bloodOf },
    onOutcome: { get: () => onOutcome },
    defeatButtons: { get: () => defeatButtons }, // for defeat-mode mods
    partyAlive: { get: () => partyAlive },
    partyDown: { get: () => partyDown },
    pct: { get: () => pct },
    persist: { get: () => persist },
    portraitOf: { get: () => portraitOf },
    provoke: { get: () => provoke },
    redraw: { get: () => redraw },
    reduceMotion: { get: () => reduceMotion },
    refreshAC: { get: () => refreshAC },
    revealSecret: { get: () => revealSecret },
    riderText: { get: () => riderText },
    rollBoosts: { get: () => rollBoosts },
    s: { get: () => s },
    saveActive: { get: () => saveActive },
    secretDC: { get: () => secretDC },
    shootProjectile: { get: () => shootProjectile },
    showEnd: { get: () => showEnd },
    showVfx: { get: () => showVfx },
    signed: { get: () => signed },
    sleep: { get: () => sleep },
    spendAction: { get: () => spendAction },
    springTrap: { get: () => springTrap },
    startHeroTurn: { get: () => startHeroTurn },
    terrainBlocked: { get: () => terrainBlocked },
    timeLabel: { get: () => timeLabel },
    updateVision: { get: () => updateVision },
    viewport: { get: () => viewport },
    whyNot: { get: () => whyNot },
  });
  const { runMonsterTurns, monsterTurn, styleOf, syncGround, addGround, saveOf, hurt, riderOn, heroEndOfTurnSaves, inBounds, creaturesIn, avgDice, powerCells, choosePower, castPower, turnBody, startOfMonsterTurn, allyTurn, tickAllyTime, endAlliance, joinParty, endOfTurnSaves } = installMonsterTurns(ctx);
  const { drawCharacters } = installCharacters(ctx);
  const { enemiesOf, heroAttackPlan, hasAmmo, whyNot, canAttack, heroAttack, heroOpportunityAttack, monsterOpportunityAttack, voiceOf, cry, shootProjectile, BOLT, boltFor, lunge, BLOODLESS, bloodOf, SPIRIT, bleed, drawBlood, flashHit, doAttack } = installAttacks(ctx);
  const { showEnd, defeatButtons, defeatCard } = installEndings(ctx);
  const { redraw, token, zoomedOut, bodyToken, tokenLook, hpBar, auraSvg, rectToken, chainSvg, drawDoors, drawFeatures, drawFog, drawOverlay } = installRender(ctx);
  const { useKey, keyFor, doorName, spendAction, checkText, hasTools, heal, bandage, useItem, search, raisePhial, lockLabel, lockOf, unlock, pickLock, forceLock, makeNoise, disarm, openChest, magicHero, growResources, refreshAC, helpless, monsterRoll, conditionSkip, provoke, rollBoosts, heroCheck, hitExtras, damageHero, damageMonster, finishIfDead } = installActions(ctx);
  const { endConcentration, timeLabel, magicBlocked, spendTime, findMagic, useMagic, payFor, areaTargets, VFX_BY_TYPE, vfxFor, showVfx, showBlast, resolveMagic, burnIn, inEffect, riderText, applyRider, ordinal, finishTeleport, rest, sneak } = installMagic(ctx);
  const { drawPanel, magicPanel, actionBar, LORE_SKILL, SKILL_LABEL, STUDIES, studyDC, known, study, revealedHtml, talkContext, talkMath, talkSection, talkTo, wrestleSection, wrestleChance, wrestle, pushAway, freeCreature, captivePanel, allyPanel, foePanel, isBehindHero, xpBar, nearbyThings, drawNearby, interactPanel, toggleSettings, drawPop, partyBar, drawInventory, drawTargetInfo } = installPanels(ctx);

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
      look: h.look, voice: h.look?.voice ?? 'low', skills: h.skills ?? {}, race: h.race,
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
    if (!s.draft || practice) return; // arena bouts are practice: nothing is saved
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
    base.innerHTML = arena ? renderArenaSVG(s.map, { grid: s.grid }) : renderDungeonSVG(s.map, { grid: s.grid, labels: true, roomNumbers: s.roomNumbers, doors: false });
    overlay.setAttribute('viewBox', `0 0 ${s.map.width * S()} ${s.map.height * S()}`);
    $('.dg-fx').setAttribute('viewBox', `0 0 ${s.map.width * S()} ${s.map.height * S()}`); // blood spray and other quick effects
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
      loadParty(arena.carry ?? null, arena.heroes.map((h) => ({ ...h.pos })));
      // A place's chests hold what the campaign put in them.
      s.features = { chests: (arena.chests ?? []).map((ch) => ({ id: ch.id, x: ch.pos.x, y: ch.pos.y, locked: false, opened: false,
        loot: { coins: ch.coins ?? 0, items: (ch.items ?? []).map((id) => makeItemSafe(id)) } })), traps: [], secretDoors: new Set(), locks: new Map() };
      if (place) s.map.exit = place.exits[0] ?? null;
      s.monsters = arena.foes.map((f, i) => {
        const stat = BESTIARY_BY_ID[f.statId];
        const m = { ...createMonster(stat, `m${i + 1}`, { ...f.pos }, f.facing ?? 4), aware: !place };
        // People of a place: they talk, trade and help, and never join a fight.
        if (f.side === 'npc') Object.assign(m, { side: 'npc', npcId: f.npcId, name: f.name, aware: false });
        // Sides from the builder: allies fight for you; bound creatures start chained where they stand.
        if (f.side === 'ally') { m.side = 'ally'; m.permanent = true; }
        if (f.side === 'bound-captive') { m.side = 'captive'; m.aware = false; m.cond = { bound: { to: nextToWall(m.pos, m.size) ? 'wall' : 'floor', dc: 13 } }; }
        if (f.side === 'bound-enemy') m.cond = { bound: { to: nextToWall(m.pos, m.size) ? 'wall' : 'floor', dc: 13 } };
        return m;
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
      placeCaptive(avoid);
      placeTrader(avoid);
      // Friends who came down the stairs with you.
      const spots = freeNear(s.map.entrance, (carry?.allies?.length ?? 0) + s.members.length).slice(s.members.length);
      (carry?.allies ?? []).forEach((a, i) => {
        const stat = BESTIARY_BY_ID[a.statId]; if (!stat || !spots[i]) return;
        const m = { ...createMonster(stat, `ally${i + 1}`, { ...spots[i] }, 0), name: a.name, portrait: a.portrait, hp: a.hp, side: 'ally', permanent: true, aware: true };
        s.monsters.push(m);
      });
      // Furniture for each room (props.js), kept clear of chests, stairs, traps and creatures.
      const busy = new Set([...avoid, ...(s.features.traps ?? []).map((t) => cellKey(t.x, t.y)), ...s.monsters.flatMap((m) => cellsOf(m.pos, m.size ?? 1).map((c) => cellKey(c.x, c.y)))]);
      furnishDungeon(s.map, s.seed, busy);
      base.innerHTML = renderDungeonSVG(s.map, { grid: s.grid, labels: true, roomNumbers: s.roomNumbers, doors: false });
    }
    s.sneak = null; s.longRested = false; s.effects = []; s.vfx = []; s.blood = []; s.map.temp = new Map(); s.areaFx = null;
    s.doors = new Map(); s.revealed = new Set(); s.log = []; s.floats = [];
    s.selectedId = null; s.knowledge = {}; s.knownHp = new Set(); s.lastStudy = null; s.target = null; s.lastCheck = null;
    s.delve = carry?.delve ?? { xp: 0, coins: 0, items: 0, kills: 0, deepest: 1 }; s.invOpen = false;
    s.mode = 'explore'; s.order = []; s.round = 0; s.busy = false; s.exitSeen = false;
    $('.dg-endscreen').hidden = true; $('.dg-inv').hidden = true; $('.dg-pop').hidden = true; $('.dg-reviewbar').hidden = true; s.captiveRun = null;
    setMood(place ? (place.music ?? 'dungeon') : arena ? 'combat' : 'dungeon');
    startHeroTurn();
    const names = party().map((h) => h.name).join(', ') || 'Your hero';
    if (place) {
      const people = s.monsters.filter((m) => m.side === 'npc').map((m) => m.name);
      log(`${names} ${s.members.length > 1 ? 'arrive at' : 'arrives at'} ${arena.name}.${people.length ? ` Here: ${people.join(', ')}. Walk up to someone and click them to talk.` : ''}`, 'info');
      updateVision(); redraw();
      return;
    }
    if (arena) {
      log(`The arena gates open. ${names} face ${s.monsters.map((m) => m.name).join(', ')}. A practice bout: no XP or loot is kept.`, 'info');
      updateVision(); redraw();
      startArenaFight();
      return;
    }
    const kinds = [...new Set(foes().map((m) => m.name))];
    const friends = allies();
    const prisoner = s.monsters.some((m) => m.side === 'captive');
    log(`${names}${friends.length ? ` and ${friends.map((a) => a.name).join(', ')}` : ''} ${carry ? (s.members.length + friends.length > 1 ? 'climb down' : 'climbs down') : (s.members.length + friends.length > 1 ? 'descend the stairs' : 'descends the stairs')} into dungeon #${s.seed}, depth ${s.depth}. Somewhere here: ${foes().length} foes (${kinds.join(', ') || 'none'}), ${s.features.chests.length} chests, traps, and stairs leading further down.${prisoner ? ' Rumour says a prisoner is held on this floor.' : ''} Find them.`, 'info');
    $('.dg-depth').textContent = `Depth ${s.depth}`;
    updateVision();
    redraw();
  }

  /** Is a creature's block next to a wall (for chaining it)? */
  function nextToWall(pos, n = 1) {
    const { w, h } = dims(n);
    for (let y = pos.y - 1; y <= pos.y + h; y++) for (let x = pos.x - 1; x <= pos.x + w; x++) {
      if (s.map.tiles[y]?.[x] === TILE.ROCK || s.map.terrain?.[y]?.[x] === 'wall') return true;
    }
    return false;
  }

  /**
   * Some floors hold a prisoner: a princess chained to the wall of a far room, often with her
   * guards nearby. Free her (pick or break the shackles) and she joins the party for good.
   * Seeded, like everything else on the floor: about half the floors have one.
   */
  function placeCaptive(avoid) {
    const rng = seededRng(((s.seed * 48271) ^ (s.depth * 2654435761)) >>> 0);
    if (rng(100) >= 50) return;
    const ent = s.map.entrance;
    const rooms = s.map.rooms.filter((r) => !r.entrance).sort((a, b) => (Math.abs(b.x - ent.x) + Math.abs(b.y - ent.y)) - (Math.abs(a.x - ent.x) + Math.abs(a.y - ent.y)));
    const taken = new Set([...avoid, ...s.monsters.flatMap((m) => cellsOf(m.pos, m.size ?? 1).map((c) => cellKey(c.x, c.y)))]);
    for (const r of rooms.slice(0, 3)) {
      const cells = [];
      for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) if (isFloor(x, y) && !taken.has(cellKey(x, y)) && nextToWall({ x, y }) && s.map.tiles[y][x] !== TILE.DOOR) cells.push({ x, y });
      if (!cells.length) continue;
      const pos = cells[rng(cells.length)];
      const stat = BESTIARY_BY_ID['captive-princess'];
      const names = ['Princess Aelwen of the Westmarch', 'Princess Idril of Dol Harrow', 'Princess Mirien of the White Hills'];
      const m = { ...createMonster(stat, 'captive1', pos, rng(8)), name: names[rng(names.length)], side: 'captive', aware: false, cond: { bound: { to: 'wall', dc: 12 + Math.floor(s.depth / 2) } } };
      m.hp = Math.max(3, Math.floor(m.maxHp / 2)); // hurt and hungry
      s.monsters.push(m);
      return;
    }
  }

  /**
   * A travelling trader's caravan, camped in a quiet room on some floors (about one in three):
   * it buys your loot (engine/trade.js). Seeded, so the same floor always has it or not.
   */
  function placeTrader(avoid) {
    const rng = seededRng(((s.seed * 69069) ^ (s.depth * 40503)) >>> 0);
    if (rng(100) >= 35) return;
    const busy = new Set([...avoid, ...s.monsters.flatMap((m) => cellsOf(m.pos, m.size ?? 1).map((c) => cellKey(c.x, c.y)))]);
    // A room nobody lives in, not too far from the stairs.
    const ent = s.map.entrance;
    const rooms = s.map.rooms.filter((r) => !r.entrance && !s.monsters.some((m) => m.pos.x >= r.x - 1 && m.pos.x <= r.x + r.w && m.pos.y >= r.y - 1 && m.pos.y <= r.y + r.h))
      .sort((a, b) => (Math.abs(a.x - ent.x) + Math.abs(a.y - ent.y)) - (Math.abs(b.x - ent.x) + Math.abs(b.y - ent.y)));
    for (const r of rooms.slice(0, 4)) {
      const cells = [];
      for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) if (isFloor(x, y) && !busy.has(cellKey(x, y)) && s.map.tiles[y][x] !== TILE.DOOR && terrainCostAt(x, y) < Infinity) cells.push({ x, y });
      if (!cells.length) continue;
      const pos = cells[rng(cells.length)];
      const names = ['Odo Tallowby, a travelling trader', 'Gerda of the Grey Caravan', 'Bram Stonehand, a dwarf pedlar'];
      s.monsters.push({ ...createMonster(BESTIARY_BY_ID.commoner, 'trader1', pos, rng(8)), name: names[rng(names.length)], side: 'npc', trader: true, aware: false, haggles: {} });
      return;
    }
  }
  const terrainCostAt = (x, y) => terrainCost(s.map, x, y);

  // ---------------------------------------------------------------------------
  // Vision and fog
  // ---------------------------------------------------------------------------

  const opaque = () => makeOpacity(s.map, s.doors);
  const alive = () => s.monsters.filter((m) => !m.dead);
  /** Creatures on the other side (calmed ones included: they still are not your friends). */
  const foes = () => alive().filter((m) => !m.side);
  /** Foes that are actually fighting. */
  const fighting = () => foes().filter((m) => m.aware && !m.calm);
  /** NPCs fighting for the party, and captives waiting to be freed. */
  const allies = () => alive().filter((m) => m.side === 'ally');
  const portraitOf = (m) => m.portrait ?? monsterPortrait(m.statId);
  const occupied = (except) => new Set([...partyAlive(), ...alive()].filter((e) => e && e !== except).flatMap((e) => cellsOf(e.pos, e.size ?? 1).map((c) => cellKey(c.x, c.y))));
  const edist = (a, b) => entityDistance(a, b);
  const edistP = (e, p) => blockDistance(e.pos, e.size ?? 1, p, 1);
  /** Can the party actually see it? (Not the narrator's Reveal map view.) */
  const inSight = (m) => cellsOf(m.pos, m.size ?? 1).some((c) => s.visible.has(cellKey(c.x, c.y)));
  const canSee = (m) => s.revealAll || inSight(m);
  /** Does a creature see one of the party: a clear line, and the hero in front of it (or right beside it)? */
  function noticesParty(m) {
    const op = opaque(); const c = centerOf(m.pos, m.size ?? 1); const at = { x: Math.round(c.x), y: Math.round(c.y) };
    return partyAlive().some((h) => (edist(h, m) <= 1 || inFieldOfView(at, m.facing, h.pos)) && cellsOf(m.pos, m.size ?? 1).some((q) => lineOfSight(q, h.pos, op).visible));
  }

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
  // Every fallen creature leaves something to search (a body, or a spirit's empty garb).
  const corpseAt = (x, y) => s.monsters.find((m) => m.dead && covers(m, { x, y })) ?? null;
  /** Every body lying on a square, plus any body that overlaps one of them: a pile searched together. */
  function corpsesAt(x, y) {
    const pile = s.monsters.filter((m) => m.dead && covers(m, { x, y }));
    for (const a of [...pile]) for (const m of s.monsters) if (m.dead && !pile.includes(m) && cellsOf(m.pos, m.size ?? 1).some((q) => covers(a, q))) pile.push(m);
    return pile;
  }
  /** Walk next to a body (or a pile) and open it. */
  function searchBodies(ids) {
    const bodies = ids.map((id) => s.monsters.find((m) => m.id === id)).filter(Boolean);
    if (!bodies.length) return;
    approachThen(bodies[0].pos, () => { s.target = bodies.length > 1 ? { kind: 'corpses', id: bodies[0].id, ids: bodies.map((m) => m.id) } : { kind: 'corpse', id: bodies[0].id }; });
  }
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
    if (arena && arena.reveal !== false) { s.visible = new Set(); for (let y = 0; y < s.map.height; y++) for (let x = 0; x < s.map.width; x++) s.visible.add(cellKey(x, y)); } else {
      const op = opaque(); s.visible = new Set();
      // Each hero sees only what is in front and to the sides (vision.js: inFieldOfView); turn with Q / E.
      for (const h of (partyAlive().length ? partyAlive() : [s.hero])) for (const k of visibleSquares(s.map, h.pos, op)) {
        const [x, y] = k.split(',').map(Number);
        if (inFieldOfView(h.pos, h.facing, { x, y })) s.visible.add(k);
      }
    }
    if (s.features) passiveNotice();
    if (s.map.exit && !s.exitSeen && s.visible.has(cellKey(s.map.exit.x, s.map.exit.y))) {
      s.exitSeen = true;
      if (s.log.length && !place) { log('You spot a stairway leading further down!', 'good'); banner('Stairs down!'); }
    }
    revealFrom(s.map, s.visible, s.revealed);
    const spotted = [];
    for (const m of foes()) {
      // A creature notices you when IT can see you: in its line of sight and in front of it.
      // One facing away does not notice you, and you get advantage on your first strike.
      if (m.aware || m.calm || !noticesParty(m) || m.cond?.asleep || m.cond?.petrified) continue;
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
      if (s.hero.cond?.prone && s.mode === 'combat') { delete s.hero.cond.prone; s.moveLeft = Math.floor(s.moveLeft / 2); log(`${s.hero.name} gets back up (half movement).`, 'info'); }
      if (s.mode === 'combat') for (const fx of s.effects) if (fx.dice && inEffect(s.hero, fx)) log(burnIn(s.hero, fx), 'bad');
      if (s.buffs.shield) { delete s.buffs.shield; }
      // Song of Heroes: temporary hit points equal to your spellcasting modifier each turn.
      if (s.buffs.heroism) s.hero.tempHp = Math.max(s.hero.tempHp ?? 0, s.def?.caster?.mod ?? 1);
      refreshAC();
    }
  }

  function enterCombat(spotted) {
    spotted = spotted.filter((m) => !m.side);
    if (!spotted.length) return;
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
    // Allies join the order too (once).
    for (const m of [...spotted, ...allies()]) {
      if (s.order.some((o) => o.id === m.id)) continue;
      const r = rollInitiative(m.dexMod);
      s.order.push({ id: m.id, init: r.total, roll: r.d20, ally: m.side === 'ally' });
    }
    s.order.sort((a, b) => b.init - a.init || (a.hero ? -1 : 1));
    if (isNew) {
      // New combat: whoever rolled highest goes first. Monsters ahead of every hero act now.
      if (s.order[0].hero) { activate(memberIndex(party().find((h) => h.id === s.order[0].id))); startHeroTurn(); keepInView(s.hero.pos); } else runMonsterTurns(true);
    }
  }

  function checkCombatOver() {
    if (s.mode === 'combat' && !fighting().length) {
      s.mode = 'explore'; s.order = [];
      setMood('dungeon');
      log('The fight is over. You can explore freely again.', 'good');
      // Fallen companions are patched up by their friends and come round with 1 hit point.
      for (const h of party()) if (h.hp <= 0) { h.hp = 1; log(`${h.name} comes round, battered but alive (1 HP).`, 'heal'); }
      recoverAmmo();
      startHeroTurn();
      for (const m of allies()) if (m.cond?.taunt) delete m.cond.taunt;
      if (!foes().filter((m) => !m.calm).length) {
        if (place) { const said = campaign?.event({ kind: 'cleared' }); if (said) log(said, 'good'); } else showEnd('victory');
      }
    }
  }

  /** Arena: everyone is aware from the first moment; roll initiative for all. */
  function startArenaFight() {
    for (const m of foes()) m.aware = true;
    enterCombat(fighting());
    redraw();
  }

  async function endHeroTurn() {
    if (s.mode !== 'combat' || s.busy) return;
    heroEndOfTurnSaves();
    await runMonsterTurns();
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
    const budget = immobile(s.hero) ? 0 : s.moveLeft;
    const all = reachableSquares(s.map, s.hero.pos, budget, { diagonalRule: s.rule, blocked });
    if (!traps.length) return all;
    const safe = reachableSquares(s.map, s.hero.pos, budget, { diagonalRule: s.rule, blocked: new Set([...blocked, ...traps]) });
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

  /** Walk the hero along a path. While walking, the map keeps its movement squares (no flicker). */
  async function moveHero(target) {
    s.walking = true;
    try { await walkHero(target); } finally { s.walking = false; for (const h of [...party(), ...allies()]) delete h.glide; redraw(); }
  }

  async function walkHero(target) {
    s.busy = true;
    const costAt = (p) => s.reach.get(cellKey(p.x, p.y))?.cost ?? target.cost;
    const steps = target.path.slice(1);
    for (const [i, p] of steps.entries()) {
      // How this step glides: speed up, keep going, slow down (render.js: EASE).
      const phase = steps.length === 1 ? 'single' : i === 0 ? 'start' : i === steps.length - 1 ? 'end' : 'mid';
      for (const h of [...party(), ...allies()]) h.glide = phase;
      const before = { ...s.hero.pos };
      const threats = s.disengaged ? [] : fighting().filter((m) => m.reaction && !helpless(m) && !m.cond?.petrified && edistP(m, before) <= reachOf(m));
      s.hero.facing = facingToward(before, p);
      s.hero.pos = { x: p.x, y: p.y };
      // Exploring: the others follow in single file, each stepping where the one ahead just was.
      if (s.mode !== 'combat') {
        let prev = before;
        // Allies of one square join the end of the line; bigger ones catch up afterwards.
        for (const h of [...partyAlive(), ...allies().filter((a) => spanOf(a.size ?? 1) === 1 && !a.hold && !immobile(a))]) {
          if (h === s.hero) continue;
          const old = { ...h.pos };
          if (chebyshev(old, prev) > 0) { h.facing = facingToward(old, prev) >= 0 ? facingToward(old, prev) : h.facing; h.pos = { ...prev }; }
          prev = old;
        }
      }
      openDoorAt(p);
      for (const fx of s.effects) if (fx.dice && inEffect(s.hero, fx)) { log(burnIn(s.hero, fx), 'bad'); if (s.hero.hp <= 0) { s.busy = false; heroFell(); return; } }
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
      redraw(); await sleep(reduceMotion ? 0 : HERO_STEP_MS); // a brisk but smooth walk: the token glides the whole time
      if (spotted.length) {
        s.moveLeft = Math.max(0, s.moveLeft - costAt(p));
        s.busy = false;
        enterCombat(spotted);
        redraw();
        return;
      }
    }
    s.moveLeft = s.mode === 'combat' ? Math.max(0, s.moveLeft - target.cost) : s.hero.speed;
    if (s.mode !== 'combat') catchUpAllies();
    s.busy = false;
    redraw();
    keepInView(s.hero.pos);
  }

  /** Big allies (and any left behind) walk to the party after it moves while exploring. */
  function catchUpAllies() {
    for (const a of allies()) {
      if (a.hold || immobile(a) || edist(a, s.hero) <= 3) continue;
      const blocked = new Set([...occupied(a), ...terrainBlocked()]);
      const reach = reachableSquares(s.map, a.pos, a.speed * 3, { blocked, size: a.size ?? 1 });
      const best = [...reach.values()].filter((c) => blockDistance(c, a.size ?? 1, s.hero.pos, 1) >= 1)
        .sort((p, q) => blockDistance(p, a.size ?? 1, s.hero.pos, 1) - blockDistance(q, a.size ?? 1, s.hero.pos, 1) || p.cost - q.cost)[0];
      if (best) { a.facing = facingToward(a.pos, best); a.pos = { x: best.x, y: best.y }; }
    }
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
  // The way down
  // ---------------------------------------------------------------------------

  const onExit = () => s.map?.exit && chebyshev(s.hero.pos, s.map.exit) <= 1 && (s.revealAll || s.revealed.has(cellKey(s.map.exit.x, s.map.exit.y)));

  /** Take the stairs: a deeper floor (a new dungeon), with your wounds, loot and tally carried along. */
  /** Leave a campaign place for the world map, taking wounds and spent magic along. */
  function leavePlace() {
    if (!place) { onLeave?.(); return; }
    if (s.mode === 'combat') { banner('You cannot leave while foes are on you.'); return; }
    saveActive();
    for (let i = 0; i < s.members.length; i++) { activate(i); persist(); }
    onLeave?.({
      members: s.members.map((m) => ({ hp: Math.max(1, m.hero.hp), res: m.res, buffs: {} })),
      ids: s.members.map((m) => m.draft?.id ?? m.id),
      // Chests emptied stay empty, and a place cleared of foes stays cleared.
      opened: s.features.chests.filter((c) => c.opened && !c.loot?.coins && !c.loot?.items?.length).map((c) => c.id),
      cleared: !foes().length,
    });
  }

  // ---- People of a place: talking, trading, services ----------------------------------------
  const npcTalking = () => s.monsters.find((m) => m.side === 'npc' && s.target?.kind === 'creature' && s.target.id === m.id);
  /** What the party can pay with and what it carries (the active hero holds the purse). */
  const wallet = () => ({ coins: s.draft?.coins ?? 0, has: (id) => s.members.some((mm, i) => (i === s.active ? s.draft : mm.draft)?.inventory?.some((x) => x.id === id)) });
  function applyCampaignEffects(effects) {
    for (const e of effects) {
      if (e.coins) { s.draft.coins = Math.max(0, (s.draft.coins ?? 0) + e.coins); if (e.coins > 0) { float(s.hero.pos, `+${formatCoins(e.coins)}`, 'xp'); play('coins', { volume: 0.8 }); } }
      if (e.item) { addItem(s.draft.inventory ??= [], makeItemSafe(e.item)); log(`${s.hero.name} receives ${itemName({ id: e.item })}.`, 'loot'); }
      if (e.takeItem) {
        for (let i = 0; i < s.members.length; i++) {
          const d = i === s.active ? s.draft : s.members[i].draft; const inst = d?.inventory?.find((x) => x.id === e.takeItem);
          if (inst) { removeItem(d.inventory, inst.uid, 1); break; }
        }
      }
      if (e.heal) { for (const h of party()) h.hp = h.maxHp; for (const m of s.members) if (m.res) m.res.slots = [...m.res.maxSlots]; s.res && (s.res.slots = [...s.res.maxSlots]); play('spell-heal', { volume: 0.7 }); log('The party is rested and whole again.', 'heal'); }
      if (e.xp) { const back = s.active; for (let i = 0; i < s.members.length; i++) { activate(i); awardXp(e.xp, s.hero.pos, true); } activate(back); log(`Each hero gains ${e.xp} XP.`, 'good'); }
    }
    persist();
  }
  function npcOption(i) {
    const m = npcTalking(); if (!m || !campaign) return;
    const r = campaign.npcChoose(m.npcId, i, wallet());
    if (r.say) { s.npcSaid = { id: m.id, text: r.say }; log(r.say, 'talk'); }
    applyCampaignEffects(r.effects ?? []);
    redraw();
  }
  function npcBuy(id) {
    const m = npcTalking(); const def = itemDef({ id }); if (!m || !def) return;
    if ((s.draft.coins ?? 0) < def.value) { banner(`Not enough coin for ${def.name}.`); return; }
    s.draft.coins -= def.value; addItem(s.draft.inventory ??= [], makeItemSafe(id));
    play('coins', { volume: 0.7 }); log(`${s.hero.name} buys ${def.name} from ${m.name} for ${formatCoins(def.value)}.`, 'loot');
    persist(); redraw();
  }

  // ---------------------------------------------------------------------------
  // Selling to a trader (a caravan in the dungeon, or a campaign shopkeeper): engine/trade.js
  // ---------------------------------------------------------------------------

  /** The rate this trader gives the active hero: 50%, or what their haggling earned this visit. */
  const tradeRate = (m) => m?.haggles?.[s.hero.id]?.rate ?? BASE_RATE;
  function traderHaggle() {
    const m = npcTalking(); if (!m) return;
    m.haggles ??= {};
    if (m.haggles[s.hero.id]) return;
    const bonus = s.hero.skills.persuasion ?? 0;
    const c = heroCheck(bonus, 10);
    const rate = haggleRate(c.total, c.d20);
    const pct = Math.round(rate * 100);
    const text = c.d20 === 1 ? `Natural 1: ${m.name.split(',')[0]} takes offence (${pct}%).`
      : `Persuasion ${c.total}${c.d20 === 20 ? ' (natural 20!)' : ''}: ${pct}%.`;
    m.haggles[s.hero.id] = { rate, text };
    play(rate > BASE_RATE ? 'coins' : 'swing-miss', { volume: 0.5 });
    log(`${s.hero.name} haggles with ${m.name.split(',')[0]}: ${checkText('Persuasion', c)}. ${rate > BASE_RATE ? `The price rises to ${pct}%.` : rate < BASE_RATE ? `Offended, the trader drops to ${pct}%.` : 'The trader will not budge from half price.'}`, rate >= BASE_RATE ? 'good' : 'warn');
    redraw();
  }
  function traderSell(uid, qty) {
    const m = npcTalking(); if (!m) return;
    const inst = s.draft.inventory.find((x) => x.uid === uid); if (!inst) return;
    const name = itemName(inst);
    const r = sellItem(s.draft, uid, tradeRate(m), qty);
    if (!r.ok) { banner(r.message); return; }
    play('coins', { volume: 0.7 });
    log(`${s.hero.name} sells ${r.sold > 1 ? `${r.sold} × ` : ''}${name} to ${m.name.split(',')[0]} for ${formatCoins(r.coins)}.`, 'loot');
    persist(); refreshHero(); redraw();
  }
  function traderSellGoods() {
    const m = npcTalking(); if (!m) return;
    const rate = tradeRate(m); let coins = 0; let n = 0;
    for (const inst of [...s.draft.inventory]) {
      if (!GOODS.has(itemDef(inst)?.cat) || whyUnsellable(s.draft, inst)) continue;
      const r = sellItem(s.draft, inst.uid, rate); if (r.ok) { coins += r.coins; n += r.sold; }
    }
    if (!n) return;
    play('coins', { volume: 0.8 });
    log(`${s.hero.name} sells ${n} goods to ${m.name.split(',')[0]} for ${formatCoins(coins)}.`, 'loot');
    persist(); refreshHero(); redraw();
  }

  function descend() {
    if (!onExit() || s.busy) return;
    if (place) { leavePlace(); return; }
    if (s.mode === 'combat') { banner('You cannot slip away down the stairs while foes are on you.'); return; }
    const bonus = 25 * s.depth * (s.def?.level ?? 1);
    saveActive();
    const carry = { delve: s.delve, members: s.members.map((m) => ({ hp: Math.max(1, m.hero.hp), res: m.res, buffs: m.buffs })),
      // Sworn friends follow you down; those only with you for a while stay behind.
      allies: allies().filter((a) => a.permanent).map((a) => ({ statId: a.statId, name: a.name, portrait: a.portrait, hp: Math.max(1, a.hp) })) };
    const left = allies().filter((a) => !a.permanent);
    if (left.length) log(`${left.map((a) => a.name).join(', ')} will not follow you any deeper.`, 'info');
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
    if (m.side) { m.loot = { coins: 0, items: [] }; log(`${m.name} falls! You have lost ${m.side === 'ally' ? 'a friend' : 'the one you came to save'}.`, 'bad'); return; }
    m.loot = rollMonsterLoot(stat);
    s.delve.kills++;
    const n = m.loot.items.length + (m.loot.coins ? 1 : 0);
    if (practice) { m.loot = { coins: 0, items: [] }; log(`${m.name} falls!`, 'good'); awardPartyXp(stat.xp, m.pos); return; }
    log(`${m.name} falls! +${stat.xp} XP.${n ? ' It carried something: click the body to search it.' : ''}`, 'good');
    awardPartyXp(stat.xp, m.pos);
  }

  /** Experience for the whole party is split evenly (5e); a skill's XP goes to whoever used it. */
  function awardPartyXp(xp, pos) {
    if (practice) { if (xp) float(pos ?? s.hero.pos, 'practice', 'muted'); return; }
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
    if (!xp || !s.draft || practice) return;
    const r = api.gainXp(s.draft, xp);
    if (!shared) s.delve.xp += xp;
    float(pos ?? s.hero.pos, `+${xp} XP`, 'xp');
    refreshHero();
    if (r.to > r.from) {
      banner(`Level ${r.to}! ${s.hero.name} grows stronger.`);
      log(`LEVEL UP! ${s.hero.name} reaches level ${r.to}: ${s.hero.maxHp} hit points, proficiency bonus +${s.def.proficiencyBonus}.`, 'level');
      levelUpNow(s.draft, r.from, r.to);
    }
    persist();
  }

  /**
   * The level-up pop-up (choices and a summary) opens right away. Several heroes levelling at once
   * get theirs one after another. The choices go into that hero's sheet and their stats refresh.
   */
  let levelQueue = Promise.resolve();
  function levelUpNow(draft, from, to) {
    if (!api.levelUp) return;
    const slot = s.active; // the hero levelling up is the active one while XP is handed out
    levelQueue = levelQueue.then(() => api.levelUp(structuredClone(draft), from, to)).then((chosen) => {
      if (!host.isConnected || !s.members[slot]) return;
      const back = s.active;
      activate(slot);
      // Saving may have given the hero a new sheet (a ready-made hero is adopted), so copy the
      // choices onto whatever sheet the hero has now.
      s.draft.levelUps = { ...(s.draft.levelUps ?? {}), ...(chosen.levelUps ?? {}) };
      persist(); refreshHero(); activate(back);
      redraw();
    }).catch(() => { /* a closed screen: the choices wait on the hero sheet */ });
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
















































































  // ---------------------------------------------------------------------------
  // Camera: zoom, pan, fit
  // ---------------------------------------------------------------------------

  // The map's size in pixels at zoom 1. Width and height differ for arenas and campaign places
  // (a 20 x 12 tavern); using the width for both made the stage square, the map was drawn
  // letterboxed inside it, and clicks landed squares above or below where the player aimed.
  const mapPx = () => s.map.width * S();
  const mapPxH = () => s.map.height * S();
  /**
   * Room around the map. The stage gets a transparent border (s.padX, s.padY) of about 30% of the
   * view on each side, more when the map is smaller than the view (so it sits centred). You can
   * drag any edge or corner of the map to the middle of the screen, and zoomed out you see all
   * four borders. A border, not padding or margins: everything inside the stage (the map, the
   * overlay, the click maths) keeps its own coordinates, and browsers always scroll over borders.
   */
  function frame() {
    const vw = viewport.clientWidth; const vh = viewport.clientHeight || vw;
    const w = mapPx() * s.zoom; const h = mapPxH() * s.zoom;
    s.padX = Math.round(Math.max(vw * 0.3, (vw - w) / 2));
    s.padY = Math.round(Math.max(vh * 0.3, (vh - h) / 2));
    stage.style.width = `${w}px`; stage.style.height = `${h}px`;
    stage.style.borderWidth = `${s.padY}px ${s.padX}px`;
  }
  function setZoom(z, clientX, clientY) {
    const rect = viewport.getBoundingClientRect();
    const fx = clientX ?? rect.left + rect.width / 2; const fy = clientY ?? rect.top + rect.height / 2;
    // The map point under the cursor (or the centre) stays put while zooming.
    const contentX = (viewport.scrollLeft + fx - rect.left - (s.padX ?? 0)) / s.zoom;
    const contentY = (viewport.scrollTop + fy - rect.top - (s.padY ?? 0)) / s.zoom;
    s.zoom = Math.max(0.15, Math.min(2, z));
    frame();
    viewport.scrollLeft = contentX * s.zoom + s.padX - (fx - rect.left);
    viewport.scrollTop = contentY * s.zoom + s.padY - (fy - rect.top);
    $('.dg-zoom').textContent = `${Math.round(s.zoom * 100)}%`;
  }
  /** The whole map in view, with a little room around it. */
  function fit() {
    const vw = viewport.clientWidth; const vh = viewport.clientHeight || vw;
    setZoom(Math.min((vw - 48) / mapPx(), (vh - 48) / mapPxH()));
    viewport.scrollLeft = s.padX + (mapPx() * s.zoom - vw) / 2;
    viewport.scrollTop = s.padY + (mapPxH() * s.zoom - vh) / 2;
  }
  function centerOn(pos, smooth = true) {
    const sz = S() * s.zoom;
    viewport.scrollTo({ left: (s.padX ?? 0) + (pos.x + 0.5) * sz - viewport.clientWidth / 2, top: (s.padY ?? 0) + (pos.y + 0.5) * sz - viewport.clientHeight / 2, behavior: smooth && !reduceMotion ? 'smooth' : 'auto' });
  }
  function keepInView(pos) {
    const sz = S() * s.zoom; const px = (s.padX ?? 0) + (pos.x + 0.5) * sz; const py = (s.padY ?? 0) + (pos.y + 0.5) * sz; const m = sz * 2.5;
    if (px < viewport.scrollLeft + m || px > viewport.scrollLeft + viewport.clientWidth - m
      || py < viewport.scrollTop + m || py > viewport.scrollTop + viewport.clientHeight - m) centerOn(pos);
  }

  // A new window size or a turned phone: recompute the room around the map.
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => { if (s.map) frame(); }).observe(viewport);

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
      // The square is fixed when the button goes down: if the page shifts before it comes up,
      // the click still lands where the player aimed.
      drag = { x: e.clientX, y: e.clientY, sl: viewport.scrollLeft, st: viewport.scrollTop, moved: false, cell: cellFromEvent(e) };
    }
  });
  // Where the mouse last was, so the highlighted square can follow when the map or page scrolls
  // under a mouse that is not moving.
  let lastPointer = null;
  const rehover = () => {
    if (!lastPointer || !host.isConnected) return;
    const c = cellFromEvent(lastPointer);
    if ((c?.x ?? -1) === (s.hover?.x ?? -1) && (c?.y ?? -1) === (s.hover?.y ?? -1)) return;
    s.hover = c; drawOverlay();
  };
  window.addEventListener('scroll', rehover, { passive: true });
  viewport.addEventListener('scroll', rehover, { passive: true });
  viewport.addEventListener('pointermove', (e) => {
    lastPointer = { clientX: e.clientX, clientY: e.clientY };
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
    if (drag && !drag.moved && e.type === 'pointerup') handleClick(drag.cell ?? cellFromEvent(e), e.shiftKey);
    drag = null;
  };
  viewport.addEventListener('pointerup', endPointer);
  viewport.addEventListener('pointercancel', endPointer);
  viewport.addEventListener('pointerleave', () => { lastPointer = null; if (!pointers.size) { s.hover = null; drawOverlay(); drawTargetInfo(); } });

  function cellFromEvent(e) {
    const r = overlay.getBoundingClientRect();
    const x = Math.floor(((e.clientX - r.left) / r.width) * s.map.width);
    const y = Math.floor(((e.clientY - r.top) / r.height) * s.map.height);
    if (x < 0 || y < 0 || x >= s.map.width || y >= s.map.height) return null;
    return { x, y };
  }

  function handleClick(c, shift = false) {
    if (!c || !s.hero || s.busy || s.mode === 'defeat' || s.mode === 'victory') return;
    if (s.pending) { finishTeleport(c); return; }
    const foe = alive().find((m) => covers(m, c) && canSee(m));
    if (foe) {
      // A click opens the creature's pop-up with everything you can do; Shift+click attacks at once.
      s.selectedId = foe.id;
      if (shift && !foe.side) { s.target = null; heroAttack(foe); return; }
      if ((foe.side === 'captive' || foe.side === 'npc') && s.mode !== 'combat') { approachThen(foe.pos, () => { s.target = { kind: 'creature', id: foe.id }; }); return; }
      s.target = { kind: 'creature', id: foe.id };
      redraw();
      return;
    }
    if (s.selectedId) { s.selectedId = null; }
    const k = cellKey(c.x, c.y);
    const known = s.revealAll || s.revealed.has(k);
    if (s.map.exit && c.x === s.map.exit.x && c.y === s.map.exit.y && onExit() && s.mode !== 'combat') { descend(); return; }
    // A body on the floor: ask whether to search it or just step onto the square
    // (bodies that were already emptied are simply walked over).
    const pile = corpsesAt(c.x, c.y);
    if (pile.length) {
      const t = s.reach.get(k);
      const worth = pile.some((m) => !m.searched || m.loot?.coins || m.loot?.items?.length);
      if (!worth && t && t.cost > 0) { s.target = null; moveHero(t); return; }
      s.target = { kind: 'corpse-ask', id: k, ids: pile.map((m) => m.id) }; redraw(); return;
    }
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
      // Out of combat the hero walks any distance: plan across the whole known map.
      if (s.mode !== 'combat') { const saved = s.moveLeft; s.moveLeft = 999; s.reach = heroReach(); s.moveLeft = saved; }
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
      case 'doll': s.invDoll = el.dataset.doll; break;
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
      case 'review': s.captiveRun = null; $('.dg-endscreen').hidden = true; $('.dg-reviewbar').hidden = false; fit(); break;
      case 'end-again': $('.dg-reviewbar').hidden = true; $('.dg-endscreen').hidden = false; if (onOutcome) { showEnd('defeat'); break; } { const mode = arena ? null : defeatMode(getSetting('defeat')); $('.dg-endscreen').innerHTML = defeatCard(); if (mode) mode(ctx); } break;
      case 'close-end': $('.dg-endscreen').hidden = true; s.mode = 'explore'; redraw(); break;
      case 'zoom-in': setZoom(s.zoom * 1.25); break;
      case 'zoom-out': setZoom(s.zoom / 1.25); break;
      case 'fit': fit(); break;
      case 'center': centerOn(s.hero.pos); break;
      case 'turn-left': case 'turn-right': if (!s.busy) {
        // Turning is free, and changes what you see (the blind half behind you, vision.js).
        s.hero.facing = rotateFacing(s.hero.facing, el.dataset.dg === 'turn-left' ? -1 : 1);
        const spotted = updateVision();
        if (spotted.length) enterCombat(spotted);
        redraw();
      } break;
      case 'weapon': s.weaponIdx = Number(el.dataset.i); redraw(); break;
      case 'dash':
        if (s.mode === 'combat' && !s.actionUsed && !s.busy) { s.dash = true; s.actionUsed = true; s.moveLeft += s.hero.speed; log(`${s.hero.name} dashes, gaining ${s.hero.speed} extra squares of movement.`, 'info'); redraw(); }
        break;
      case 'end-turn': endHeroTurn(); break;
      case 'deselect': s.selectedId = null; if (s.target?.kind === 'creature') s.target = null; redraw(); break;
      case 'attack-with': {
        const m = s.monsters.find((x) => x.id === s.selectedId);
        s.target = null; $('.dg-pop').hidden = true; // close the pop-up so the blow can be seen
        if (m) heroAttack(m, Number(el.dataset.i));
        break;
      }
      case 'talk': { const m = s.monsters.find((x) => x.id === s.selectedId); if (m) talkTo(m, el.dataset.talk); break; }
      case 'wrestle': { const m = s.monsters.find((x) => x.id === s.selectedId); if (m) wrestle(m, el.dataset.how); break; }
      case 'ally-order': {
        const m = s.monsters.find((x) => x.id === s.selectedId); if (!m) break;
        if (el.dataset.how === 'hold') { m.hold = true; log(`${m.name} holds this position.`, 'info'); }
        if (el.dataset.how === 'follow') { m.hold = false; log(`${m.name} follows you.`, 'info'); }
        if (el.dataset.how === 'dismiss') { s.target = null; endAlliance(m, `${m.name} nods and goes its own way.`); }
        redraw(); break;
      }
      case 'study': {
        const m = s.monsters.find((x) => x.id === s.selectedId);
        if (m) study(m, el.dataset.study);
        break;
      }
      case 'inventory': s.invOpen = !s.invOpen; redraw(); break;
      case 'characters': s.charsOpen = !s.charsOpen; if (s.charsOpen) s.charIdx = s.active; drawCharacters(); break;
      case 'chars-close': s.charsOpen = false; drawCharacters(); break;
      case 'char-hero': s.charIdx = Number(el.dataset.i); drawCharacters(); break;
      case 'char-tab': s.charTab = el.dataset.tab; drawCharacters(); break;
      case 'char-part': s.charPart = el.dataset.part; drawCharacters(); break;
      case 'pick-hero': if (s.mode !== 'combat' && !s.busy && s.members[Number(el.dataset.i)]?.hero.hp > 0) { activate(Number(el.dataset.i)); startHeroTurn(); redraw(); centerOn(s.hero.pos); } break;
      case 'leave-arena': leavePlace(); break;
      case 'npc-opt': npcOption(Number(el.dataset.i)); break;
      case 'npc-buy': npcBuy(el.dataset.id); break;
      case 'trade-haggle': traderHaggle(); break;
      case 'trade-sell': traderSell(el.dataset.uid, el.dataset.qty === 'all' ? null : Number(el.dataset.qty) || 1); break;
      case 'trade-sell-goods': traderSellGoods(); break;
      case 'story-continue': onOutcome?.(s.mode === 'victory'); break;
      case 'cast': if (s.target?.kind === 'creature') { s.target = null; $('.dg-pop').hidden = true; } useMagic(el.dataset.id); break;
      case 'end-conc': { const n = findMagic(s.res.concentration)?.name; endConcentration(); log(`${s.hero.name} lets ${n} end.`, 'info'); redraw(); break; }
      case 'sneak': sneak(); break;
      case 'rest-short': rest('short'); break;
      case 'rest-long': rest('long'); break;
      case 'bandage': bandage(); break;
      case 'search': search(); break;
      case 'pick-target': if (el.dataset.kind === 'stairs') { descend(); break; } s.selectedId = null; s.target = { kind: el.dataset.kind, id: el.dataset.id }; if (el.dataset.kind === 'chest') { const c = s.features.chests.find((x) => x.id === el.dataset.id); if (c && !c.locked && !c.opened) { openChest(c); break; } } redraw(); break;
      case 'close-loot': s.target = null; redraw(); break;
      case 'settings': toggleSettings(); break;
      case 'close-settings': toggleSettings(false); break;
      case 'open-chest': { const c = s.features.chests.find((x) => x.id === s.target?.id); if (c) openChest(c); break; }
      case 'pick-lock': if (s.target) pickLock(s.target); break;
      case 'force-lock': if (s.target) forceLock(s.target); break;
      case 'use-key': if (s.target) useKey(s.target); break;
      case 'disarm': { const t = s.features.traps.find((x) => x.id === s.target?.id); if (t) disarm(t); break; }
      case 'corpse-search': { const ids = s.target?.ids ?? []; s.target = null; searchBodies(ids); break; }
      case 'corpse-move': {
        const [x, y] = (s.target?.id ?? '').split(',').map(Number); s.target = null;
        if (s.mode !== 'combat') { const saved = s.moveLeft; s.moveLeft = 999; s.reach = heroReach(); s.moveLeft = saved; }
        const t = s.reach.get(cellKey(x, y));
        if (t && t.cost > 0) moveHero(t);
        redraw(); break;
      }
      case 'take': case 'take-all': {
        if (s.target?.kind === 'corpses') {
          // A pile: coins come from every body; an item from the body that holds it.
          const bodies = s.target.ids.map((id) => s.monsters.find((m) => m.id === id)).filter((m) => m?.loot);
          const uid = el.dataset.dg === 'take-all' ? null : el.dataset.uid;
          for (const b of bodies) if (uid === null || uid === 'coins' ? true : b.loot.items.some((it) => it.uid === uid)) takeLoot(b, uid);
          break;
        }
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
        base.innerHTML = renderDungeonSVG(s.map, { grid: s.grid, labels: true, roomNumbers: s.roomNumbers, doors: false });
        break;
      case 'room-numbers':
        s.roomNumbers = el.checked;
        try { localStorage.setItem('rpg.roomNumbers', el.checked ? '1' : '0'); } catch { /* storage blocked: still works for this visit */ }
        base.innerHTML = renderDungeonSVG(s.map, { grid: s.grid, labels: true, roomNumbers: s.roomNumbers, doors: false });
        break;
      case 'reveal': s.revealAll = el.checked; redraw(); break;
      case 'rule': s.rule = el.value; redraw(); break;
      case 'setting':
        setSetting(el.dataset.setting, el.value);
        if (el.dataset.setting === 'figures') { s.view = el.value; redraw(); }
        if (el.dataset.setting === 'pace') applyPace();
        break;
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

  // Developer hook for automated tests (only with ?debug in the address): end the fight in defeat.
  if (/[?&]debug\b/.test(location.search)) window.__dungeon = { forceDefeat() { for (const h of party()) h.hp = 0; redraw(); showEnd('defeat'); }, giveXp(n) { awardXp(n); redraw(); }, state: () => s, wound(n) { for (const m of foes()) { s.hitFrom = { x: s.hero.pos.x + 0.5, y: s.hero.pos.y + 0.5 }; damageMonster(m, n); finishIfDead(m); } redraw(); } };

  const onKey = (e) => {
    if (!host.isConnected) { window.removeEventListener('keydown', onKey); return; }
    // Escape closes the settings menu even while one of its options has focus.
    if (e.key === 'Escape' && !$('.dg-settings').hidden) { toggleSettings(false); host.querySelector('[data-dg="settings"]')?.focus(); return; }
    if (e.target.matches?.('input, select, textarea')) return;
    if (e.key === 'q' || e.key === 'Q') host.querySelector('[data-dg="turn-left"]')?.click();
    else if (e.key === 'e' || e.key === 'E') host.querySelector('[data-dg="turn-right"]')?.click();
    else if (e.key === '+' || e.key === '=') setZoom(s.zoom * 1.25);
    else if (e.key === '-') setZoom(s.zoom / 1.25);
    else if (e.key === 'i' || e.key === 'I') { s.invOpen = !s.invOpen; redraw(); }
    else if (e.key === 'c' || e.key === 'C') { s.charsOpen = !s.charsOpen; if (s.charsOpen) s.charIdx = s.active; drawCharacters(); }
    else if (e.key === 'Escape' && s.charsOpen) { s.charsOpen = false; drawCharacters(); }
    else if (e.key === ' ' && s.mode === 'combat') { e.preventDefault(); host.querySelector('[data-dg="end-turn"]:not([disabled])')?.click(); }
    else if (e.key === 'f' || e.key === 'F') host.querySelector('.dg-actionbar [data-dg="search"]:not([disabled])')?.click();
    else if (e.key === 'Escape' && !$('.dg-settings').hidden) toggleSettings(false);
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
