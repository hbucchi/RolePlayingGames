/**
 * UI layer. Plain DOM rendering: every state change calls render(), which rebuilds the
 * view from `state`. All game rules live in src/engine; this file only displays them.
 */
import { tradeHtml, GOODS } from './trade-view.js';
import { sellItem, haggleRate, whyUnsellable, BASE_RATE } from '../engine/trade.js';
import { stockFor, buyItem, period as shopPeriod } from '../engine/shop.js';
import { adventures, rareBought, markRareBought } from './shop-state.js';
import {
  ABILITIES, ABILITY_IDS, ABILITY_METHODS, POINT_BUY, abilityModifier, autoAssign,
  formatModifier, pointBuyScoreCost, pointBuyTotal,
} from '../engine/abilities.js';
import {
  STEPS, abilityPool, deriveCharacter, grantedSkills, isComplete, newDraft, pruneSkillChoices,
  resolveRace, setAbilityMethod, skillName, syncBaseFromAssignment, validateStep, makeId, ensureGear, gainXp, pendingLevelUps,
} from '../engine/character.js';
import { XP_FOR_LEVEL, xpProgress, startingWealth } from '../engine/progression.js';
import { manaFor, manaCost } from '../engine/magic.js';
import { manaHtml } from './mana-view.js';
import { equipItem, unequipSlot, removeItem, isEquipped, itemName, formatCoins, bagUsed, BAG_SLOTS } from '../engine/items.js';
import { ITEMS_BY_ID } from '../content/items/catalogue.js';
import { inventoryHtml, coinsHtml } from './inventory-view.js';
import { roll, rollAbilityScore, rollDie } from '../engine/dice.js';
import { SKILLS } from '../engine/skills.js';
import { createRoster, exportCharacter, importCharacter, defaultBackend } from '../engine/storage.js';
import { createDelveStore } from '../engine/delve.js';
import { healInTown, healCost, isHurt, woundsOf } from '../engine/healing.js';
import { createSafe, SAFE_SLOTS } from '../engine/safe.js';
const safe = createSafe(defaultBackend());
import { DEFAULT_SETTING_ID, getSetting } from '../content/registry.js';
import { mountDungeon } from './dungeon-view.js';
import { mountArenaBuilder } from './arena-builder.js';
import { mountStory, resolveBattle, savedRun } from './story-view.js';
import { levelUpDialog } from './level-up.js';
import { mountCampaign, buildPlace, placeHooks, leftPlace, loadRun as loadCampaignRun } from './campaign-view.js';
import { CAMPAIGNS } from '../content/campaigns/index.js';
import { playRange } from '../engine/range.js';
import { rollDice, diceWanted } from './dice.js';
import { bestiaryView, bestiaryResults, defaultBestiaryFilters, monsterView } from './bestiary-view.js';
import { BESTIARY_BY_ID } from '../content/bestiary/index.js';
import { setSetting, settingsControls, applyTheme } from './settings.js';
import { heroLook, resolveAppearance, PORTRAITS, PORTRAIT_VARIANTS, portraitUrl, STYLES, FRAMES, VOICES, appearanceFilter } from '../content/media.js';
import { play, isMuted, setMuted } from './audio.js';
import * as music from './music.js';
import { m as mtr } from '../engine/units.js';
import { coverage } from '../engine/defence.js';
import { repair } from '../engine/smith.js';
import { healParts } from '../engine/injury.js';

const setting = getSetting(DEFAULT_SETTING_ID);
const roster = createRoster();
const root = document.getElementById('app');
applyTheme(); // the Colours setting: automatic, light or dark
const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

const state = {
  view: 'home', // home | start | wizard | sheet | dungeon | monster
  start: { mode: 'standard', level: 5 },
  inv: { selected: null, filter: 'all', dropArm: null },
  market: { heroId: null, haggles: {} }, // the Trading post: who is selling, and this visit's haggling
  tab: 'heroes', // heroes | adventures | bestiary
  bestiary: defaultBestiaryFilters(),
  monsterId: null,
  draft: null,
  step: 0,
  errors: [],
  dirty: false,
  sheet: null, // { draft, source: 'roster' | 'premade' }
  rolling: new Set(),
  diceLog: [],
  notice: null,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = formatModifier;
const stepId = () => STEPS[state.step].id;
const settingFor = (d) => getSetting(d.settingId) ?? setting;

/** A toast that does not re-render the page (the arena builder and dungeon keep their state). */
function toast(text, kind = 'ok') {
  root.querySelector('.toast')?.remove();
  const el = document.createElement('div');
  el.className = `toast ${kind}`; el.setAttribute('role', 'status'); el.textContent = text;
  root.appendChild(el);
  clearTimeout(toast.t); toast.t = setTimeout(() => el.remove(), 3500);
}

function notify(text, kind = 'ok') {
  state.notice = { text, kind };
  render();
  clearTimeout(notify.t);
  notify.t = setTimeout(() => {
    state.notice = null;
    // The dungeon view keeps its own state; don't rebuild it just to hide a toast.
    if (state.view === 'dungeon') root.querySelector('.toast')?.remove(); else render();
  }, 3500);
}

/**
 * In-page confirmation: the first click arms the action and shows a notice; a second click
 * on the same action within 4 seconds confirms it. (Browser confirm() dialogs are blocked
 * when the game runs inside a sandboxed frame.)
 */
let armed = { key: null, at: 0 };
function confirmTwice(key, message) {
  if (armed.key === key && Date.now() - armed.at < 4000) { armed = { key: null, at: 0 }; return true; }
  armed = { key, at: Date.now() };
  notify(`${message} Click again to confirm.`, 'warn');
  return false;
}

function download(filename, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const bonusList = (bonuses) => Object.entries(bonuses).filter(([, v]) => v)
  .map(([k, v]) => `${ABILITIES[k].short} ${fmt(v)}`).join(', ') || 'none';

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

/** A selector that identifies the same control after a re-render, so keyboard focus survives. */
function focusKey(el) {
  if (!el || el === document.body || !root.contains(el)) return null;
  if (el.dataset.field) return `[data-field="${el.dataset.field}"]`;
  if (!el.dataset.action) return null;
  return ['action', 'id', 'ability', 'index', 'step', 'delta', 'label', 'tab']
    .filter((k) => el.dataset[k] !== undefined)
    .map((k) => `[data-${k}="${CSS.escape(el.dataset[k])}"]`).join('');
}

/**
 * A delve left unfinished (the menu, closing the game, a crash): its gains were never made safe,
 * so the heroes go back to how they went in (engine/delve.js).
 */
function undoUnfinishedDelve() {
  if (['dungeon', 'campaign-place'].includes(state.view)) return;
  const delve = createDelveStore(defaultBackend());
  if (!delve.active()) return;
  const where = delve.get()?.where;
  const names = delve.restore((d) => roster.save(d));
  if (names.length) setTimeout(() => toast(`${names.join(', ')} left ${where || 'the dungeon'} without reaching an exit: the loot and experience from there are lost.`), 0);
}

function render() {
  undoUnfinishedDelve();
  const key = focusKey(document.activeElement);
  const views = {
    wizard: wizardView,
    start: startView,
    sheet: sheetView,
    dungeon: () => '<div id="dungeon-host" class="dungeon-host"></div>',
    market: marketView,
    arena: () => `<div class="row sheet-actions arena-head"><button class="btn ghost small" data-action="home">← Adventures</button><h1 class="arena-title">Arena</h1>
      <p class="muted small">Practice bouts: no risk, no XP, no loot.</p></div>
      <div id="arena-host"></div>`,
    'arena-fight': () => '<div id="dungeon-host" class="dungeon-host"></div>',
    story: () => '<div id="story-host"></div>',
    campaign: () => '<div id="campaign-host"></div>',
    'campaign-place': () => '<div id="dungeon-host" class="dungeon-host"></div>',
    'story-fight': () => '<div id="dungeon-host" class="dungeon-host"></div>',
    monster: () => `${monsterView(BESTIARY_BY_ID[state.monsterId])}${diceTray()}`,
  };
  renderInto((views[state.view] ?? homeView)());
  if (!['dungeon', 'arena-fight', 'story-fight', 'campaign-place'].includes(state.view)) music.setMood('menu');
  if (state.view === 'dungeon') mountDungeon(root.querySelector('#dungeon-host'), { heroes: explorerHeroes(), api: heroApi, onLeave: () => { Object.assign(state, { view: 'home', tab: 'adventures' }); render(); toast('Back in town. Your loot is in the safe; the next delve starts at depth 1.'); } });
  if (state.view === 'arena') {
    mountArenaBuilder(root.querySelector('#arena-host'), {
      heroes: explorerHeroes(), setup: state.arenaSetup,
      onChange: (setup) => { state.arenaSetup = setup; },
      onFight: (setup) => { state.arenaFight = setup; state.view = 'arena-fight'; render(); window.scrollTo(0, 0); },
      notify: toast,
    });
  }
  if (state.view === 'arena-fight') {
    mountDungeon(root.querySelector('#dungeon-host'), {
      heroes: explorerHeroes(), api: heroApi, arena: structuredClone(state.arenaFight),
      onLeave: () => { state.view = 'arena'; render(); },
    });
  }
  if (state.view === 'campaign') {
    mountCampaign(root.querySelector('#campaign-host'), {
      campaignId: state.campaignId, heroes: explorerHeroes(), notify: toast,
      onLeave: () => { Object.assign(state, { view: 'home', tab: 'adventures' }); render(); },
      onEnter: (locId) => { state.placeId = locId; state.view = 'campaign-place'; render(); window.scrollTo(0, 0); },
      onStory: (storyId) => { Object.assign(state, { view: 'story', storyId, storyReturn: 'campaign' }); render(); window.scrollTo(0, 0); },
    });
  }
  if (state.view === 'campaign-place') {
    mountDungeon(root.querySelector('#dungeon-host'), {
      heroes: explorerHeroes(), api: heroApi, arena: buildPlace(state.campaignId, state.placeId), campaign: placeHooks(state.campaignId, state.placeId),
      onLeave: (left) => { leftPlace(state.campaignId, state.placeId, left); state.view = 'campaign'; render(); window.scrollTo(0, 0); },
    });
  }
  if (state.view === 'story') {
    mountStory(root.querySelector('#story-host'), {
      storyId: state.storyId, heroes: explorerHeroes(), api: heroApi, notify: toast,
      onFight: (setup) => { state.storyFight = setup; state.view = 'story-fight'; render(); window.scrollTo(0, 0); },
      onLeave: () => { Object.assign(state, state.storyReturn === 'campaign' ? { view: 'campaign', storyReturn: null } : { view: 'home', tab: 'adventures' }); render(); },
    });
  }
  if (state.view === 'story-fight') {
    mountDungeon(root.querySelector('#dungeon-host'), {
      heroes: explorerHeroes(), api: heroApi, arena: structuredClone(state.storyFight),
      onLeave: () => { state.view = 'story'; render(); },
      onOutcome: async (won) => { await resolveBattle(state.storyId, won, heroApi); state.view = 'story'; render(); window.scrollTo(0, 0); },
    });
  }
  if (key) root.querySelector(key)?.focus({ preventScroll: true });
}

function renderInto(body) {
  root.innerHTML = `
    <header class="top">
      <button class="brand" data-action="home" aria-label="Back to home">
        <span class="brand-mark" aria-hidden="true">✦</span>
        <span><span class="brand-title">${esc(setting.name)}</span><span class="brand-sub">Hero Forge</span></span>
      </button>
 <div class="music-ctl">
        <button class="sound-toggle" data-action="toggle-music" aria-pressed="${music.state().enabled}" title="${esc(musicTitle())}">${music.state().enabled ? '🎵' : '🎵'}<span class="sr-only">${music.state().enabled ? 'Turn music off' : 'Turn music on'}</span></button>
        <input type="range" class="music-vol" min="0" max="100" value="${Math.round(music.state().volume * 100)}" data-music="volume" aria-label="Music volume" title="Music volume (each step is the same loudness change to the ear)" ${music.state().enabled ? '' : 'disabled'}>
      </div>
      <button class="sound-toggle" data-action="toggle-sound" aria-pressed="${!isMuted()}" title="${isMuted() ? 'Sound off' : 'Sound on'}">${isMuted() ? '🔇' : '🔊'}<span class="sr-only">${isMuted() ? 'Turn sound on' : 'Turn sound off'}</span></button>
      ${state.view === 'home' ? '<button class="sound-toggle" data-action="open-settings" title="Settings" aria-haspopup="dialog">⚙<span class="sr-only">Settings</span></button>' : ''}
      ${state.view === 'home' ? `
      <nav class="tabs" role="tablist">
        ${tabButton('heroes', 'Heroes')}${tabButton('adventures', 'Adventures')}${tabButton('bestiary', 'Bestiary')}
      </nav>` : ''}
    </header>
    <main>${body}</main>
    ${state.settingsOpen ? `<div class="settings-modal" role="dialog" aria-modal="true" aria-label="Settings" data-action="close-settings-bg">
      <div class="settings-card"><div class="row"><h2>⚙ Settings</h2><span class="spacer"></span><button class="btn icon small" data-action="close-settings" aria-label="Close">✕</button></div>
      <div class="home-settings-grid">${settingsControls('data-action="setting"', undefined, 'home')}</div></div></div>` : ''}
    ${state.notice ? `<div class="toast ${state.notice.kind}" role="status">${esc(state.notice.text)}</div>` : ''}
  `;
}

const tabButton = (id, label) => `<button role="tab" aria-selected="${state.tab === id}" class="tab ${state.tab === id ? 'active' : ''}" data-action="tab" data-tab="${id}">${label}</button>`;

// ---- Home ------------------------------------------------------------------

function homeView() {
  if (state.tab === 'adventures') return adventuresView();
  if (state.tab === 'bestiary') return bestiaryView(state.bestiary);
  const heroes = roster.list();
  const adopted = new Set(heroes.map((d) => d.premadeOf).filter(Boolean));
  const premades = setting.premades.filter((p) => !adopted.has(p.id)).map((p) => syncBaseFromAssignment(structuredClone(p)));
  return `
    <section class="home">
      <div class="home-banner">
        <div class="home-title"><p class="kicker">${esc(setting.name)}</p><h1>Forge your hero</h1><p class="home-sub">${esc(setting.subtitle)}</p></div>
        <div class="home-cta">
          <button class="btn primary big" data-action="new">⚔ Create a new hero</button>
          <button class="btn big" data-action="tab" data-tab="adventures">🗺 Adventures</button>
          <label class="btn">⬆ Import<input type="file" accept="application/json,.json" data-action="import" hidden></label>
        </div>
      </div>
      <div class="home-row-head"><h2>Choose your hero</h2><span class="muted small">${heroes.length ? `Your company (${heroes.length})${premades.length ? ' · then ready-made heroes' : ''}` : 'Ready-made heroes: adopt one to make it yours'}</span></div>
      <div class="hero-strip" role="list">
        ${heroes.map((d) => heroTile(d, 'roster')).join('')}
        ${premades.map((d) => heroTile(d, 'premade')).join('')}
      </div>
    </section>`;
}

/** A compact hero card for the home screen: portrait, name, kin and calling, HP/AC, actions. */
function heroTile(d, source) {
  const s = settingFor(d); const c = deriveCharacter(d, s); const complete = isComplete(d, s);
  return `<article class="hero-tile ${source}" role="listitem">
    ${portraitHtml(heroLook(d), 'md')}
    <div class="ht-body">
      <h3>${esc(c.name || 'Unnamed hero')}</h3>
      <p class="ht-kin">${esc(c.race?.name ?? '?')} · <b>${esc(c.cls?.name ?? '?')}</b></p>
      <p class="ht-stats"><span class="ht-lv">Lv ${c.level}</span>${complete ? `<span class="${d.wounds ? 'hurt' : ''}" title="${d.wounds ? 'Wounded: only potions and healing spells mend wounds' : 'Unhurt'}">❤ ${hpText(c, d)}</span><span>🛡 ${c.ac}</span>` : '<span class="warn">Incomplete</span>'}${source === 'premade' ? '<span class="ht-tag">Ready-made</span>' : ''}</p>
      ${c.concept ? `<p class="ht-concept">${esc(c.concept)}</p>` : ''}
    </div>
    <div class="ht-actions">
      <button class="btn small" data-action="view" data-source="${source}" data-id="${esc(d.id)}">Sheet</button>
      ${source === 'roster' ? `<button class="btn small" data-action="edit" data-id="${esc(d.id)}">Edit</button>` : `<button class="btn small primary" data-action="adopt" data-id="${esc(d.id)}">Adopt</button>`}
    </div>
  </article>`;
}

// ---- New hero: standard or sandbox -------------------------------------------

function startView() {
  const st = state.start;
  const card = (mode, title, tag, points) => `
    <button class="start-card ${st.mode === mode ? 'sel' : ''}" data-action="start-mode" data-id="${mode}" aria-pressed="${st.mode === mode}">
      <span class="start-tag">${tag}</span>
      <h2>${title}</h2>
      <ul>${points.map((p) => `<li>${p}</li>`).join('')}</ul>
    </button>`;
  return `
    <section class="start">
      <h1>How will your tale begin?</h1>
      <p class="muted">Choose how your new hero enters the Westlands. You can create as many heroes as you like, of either kind.</p>
      <div class="start-grid">
        ${card('standard', 'Standard adventure', 'Recommended', [
    'Begin at <b>level 1</b> with your calling\'s starting kit and 10 gold.',
    'Earn <b>experience</b> by defeating foes and disarming traps; level up as you go.',
    'Every coin, potion and blade is found or earned.'])}
        ${card('sandbox', 'Sandbox', 'Free play', [
    'Pick <b>any level from 1 to 20</b> to try a build or a hard dungeon.',
    'Start with the hit points, proficiency and wealth of a veteran at that level.',
    'Higher levels bring magic gear: enchanted arms and healing potions.'])}
      </div>
      ${st.mode === 'sandbox' ? `
      <div class="start-level">
        <label class="field" for="start-level">Starting level: <b class="lvl-out">${st.level}</b>
          <input id="start-level" type="range" min="1" max="20" value="${st.level}" data-action="start-level">
        </label>
        <p class="small muted">${levelBlurb(st.level)}</p>
      </div>` : ''}
      <div class="row"><button class="btn ghost" data-action="home">Cancel</button><span class="spacer"></span>
        <button class="btn primary big" data-action="start-go">Create a ${st.mode === 'sandbox' ? `level ${st.level} sandbox` : 'level 1'} hero</button></div>
    </section>`;
}

function levelBlurb(level) {
  const pb = 2 + Math.floor((level - 1) / 4);
  const tier = level <= 4 ? 'Local heroes: goblin warrens and haunted barrows.' : level <= 10 ? 'Heroes of the realm: orc war-bands, trolls and wights.' : level <= 16 ? 'Masters of the realm: great trolls and servants of the Shadow.' : 'Masters of the world: the darkest powers.';
  return `Proficiency bonus +${pb} · ${XP_FOR_LEVEL[level].toLocaleString()} XP · about ${formatCoins(startingWealth(level))} to start. ${tier}`;
}

/** A framed portrait with the hero's chosen style. */
function portraitHtml(look, size = 'md') {
  return `<div class="portrait ${size}" style="--frame:${look.frameColor}"><img src="${esc(look.url)}" alt="" style="filter:${look.filter}" loading="lazy"></div>`;
}

function heroCard(d, source) {
  const s = settingFor(d);
  const c = deriveCharacter(d, s);
  const complete = isComplete(d, s);
  return `
    <article class="card hero-card">
      <div class="hero-card-top">
        ${portraitHtml(heroLook(d), 'sm')}
        <div>
          <div class="card-head">
            <h3>${esc(c.name || 'Unnamed hero')}</h3>
            <span class="badge">Lv ${c.level}</span>${c.mode === 'sandbox' ? '<span class="badge soon">Sandbox</span>' : ''}
          </div>
          <p class="muted">${esc(c.race?.name ?? '?')} · ${esc(c.cls?.name ?? '?')}</p>
        </div>
      </div>
      ${c.concept ? `<p class="concept">${esc(c.concept)}</p>` : ''}
      ${complete && d.inventory ? `<div class="card-xp">${xpBarHtml(c)}${coinsHtml(c.coins)}</div>` : ''}
      ${complete ? `<dl class="mini-stats"><div><dt>HP</dt><dd class="${d.wounds ? 'hurt' : ''}">${hpText(c, d)}</dd></div><div><dt>EVA</dt><dd>${c.ac}</dd></div>
        ${ABILITY_IDS.map((id) => `<div><dt>${ABILITIES[id].short}</dt><dd>${c.scores[id]}</dd></div>`).join('')}</dl>`
    : '<p class="warn">Incomplete</p>'}
      <div class="row wrap">
        <button class="btn small" data-action="view" data-source="${source}" data-id="${esc(d.id)}">View sheet</button>
        ${source === 'roster' ? `
          <button class="btn small ghost" data-action="edit" data-id="${esc(d.id)}">Edit</button>
          <button class="btn small ghost" data-action="export" data-id="${esc(d.id)}">Export</button>
          <button class="btn small danger" data-action="delete" data-id="${esc(d.id)}">Delete</button>`
    : `<button class="btn small primary" data-action="adopt" data-id="${esc(d.id)}">Adopt</button>`}
      </div>
    </article>`;
}

/**
 * The Trading Post, between adventures: pick a hero, sell their loot (engine/trade.js). Haggling
 * is once per hero per visit; leaving and coming back starts a new visit.
 */
function marketView() {
  const heroes = explorerHeroes();
  const id = state.market.heroId ?? heroes[0]?.id;
  const d = marketDraft(id);
  const c = d ? deriveCharacter(d, settingFor(d)) : null;
  const persuasion = c?.skills.find((k) => k.id === 'persuasion')?.bonus ?? 0;
  const h = state.market.haggles[id];
  return `<section class="market">
    <div class="row sheet-actions arena-head"><button class="btn ghost small" data-action="home">← Adventures</button><h1 class="arena-title">The Trading Post</h1>
      <p class="muted small">Buy gear, sell loot and have armour mended at the forge between adventures.</p></div>
    <div class="chips market-heroes">${heroes.map((x) => `<button class="chip ${x.id === id ? 'sel' : ''}" data-action="market-hero" data-id="${esc(x.id)}" aria-pressed="${x.id === id}">${esc(x.label.split(',')[0])}</button>`).join('')}</div>
    ${d ? `<div class="card market-card-body">
      <div class="market-hero"><img src="${esc(heroLook(d).url ?? '')}" alt="" style="filter:${heroLook(d).filter ?? 'none'}"><div><h3>${esc(c.name)}</h3><p class="small muted">Level ${c.level} ${esc(c.race.name)} ${esc(c.cls.name)} · CHA ${c.scores.cha} (${c.mods.cha >= 0 ? '+' : ''}${c.mods.cha})</p></div></div>
      ${tradeHtml({ gear: d, rate: h?.rate ?? BASE_RATE, haggle: h ?? null, persuasion, heroName: c.name, attr: 'data-tr', trader: 'Marta the trader', tab: state.market.tab ?? 'buy', shelf: state.market.shelf, smith: true, stock: martaStock(c.level, h?.rate ?? BASE_RATE) })}
    </div>
    <div class="card market-heal">
      <h3>Rest and healing</h3>
      <p class="small">${isHurt(d) ? `${esc(c.name)} is hurt: <b>${c.maxHp - Math.min(woundsOf(d), c.maxHp - 1)} / ${c.maxHp} HP</b>${Object.values(d.injuries ?? {}).some((v) => v > 0) ? ', with injuries' : ''}.` : `${esc(c.name)} is whole: ${c.maxHp} / ${c.maxHp} HP.`}</p>
      <div class="row wrap">
        <button class="btn small" data-tr="heal-inn" ${isHurt(d) ? '' : 'disabled'}>🛏 The Golden Perch: a bed for the night (${esc(formatCoins(healCost(d, 'inn')))})</button>
        <button class="btn small" data-tr="heal-healer" ${isHurt(d) ? '' : 'disabled'}>✚ Sister Wynn, healer: mend now (${esc(formatCoins(healCost(d, 'healer')))}, 2 sp per HP)</button>
      </div>
      <p class="small muted">Both mend every wound and injury. The healer is cheaper for small wounds, the inn for deep ones.</p>
    </div>` : '<p class="muted">Make or adopt a hero first.</p>'}
  </section>`;
}

/** Marta's shelves for a hero of this level (engine/shop.js); her rare offer changes every 3 adventures. */
function martaStock(level, rate) {
  const n = adventures();
  return stockFor({ traderKey: 'marta', level, adventures: n, bought: rareBought('marta', shopPeriod(n).period), rate });
}

/**
 * The hero being served, loaded once per visit. (A ready-made hero's starting kit is made afresh,
 * with new item ids, every time it is loaded: re-loading on each click would lose track of items.)
 */
function marketDraft(id) {
  if (!id) return null;
  if (state.market.draft?.id !== id && state.market.draft?.premadeOf !== id) state.market.draft = heroApi.load(id);
  return state.market.draft;
}

/** Selling at the Trading Post: the hero's pack and purse are saved after every sale. */
root.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-tr]');
  if (!el || el.disabled || state.view !== 'market') return;
  const id = state.market.heroId; const d = marketDraft(id); if (!d) return;
  const c = deriveCharacter(d, settingFor(d));
  const keep = (saved) => { // a ready-made hero is adopted on their first sale: follow the new id
    if (saved?.id && saved.id !== id) { state.market.haggles[saved.id] = state.market.haggles[id]; state.market.heroId = saved.id; }
    if (saved) state.market.draft = saved;
  };
  if (el.dataset.tr === 'trade-haggle') {
    if (state.market.haggles[id]) return;
    const bonus = c.skills.find((k) => k.id === 'persuasion')?.bonus ?? 0;
    const r = rollDie(20); const total = r + bonus; const rate = haggleRate(total, r); const pct = Math.round(rate * 100);
    if (diceWanted(true)) await rollDice({ groups: [{ dice: [{ sides: 20, value: r }], caption: `${bonus >= 0 ? '+' : '−'} ${Math.abs(bonus)} = ${total}` }], label: 'Haggle (Persuasion)', verdict: `${pct}%`, verdictKind: rate > BASE_RATE ? 'good' : rate < BASE_RATE ? 'bad' : '' });
    state.market.haggles[id] = { rate, text: r === 1 ? `Natural 1: Marta is offended (${pct}%).` : `Persuasion ${total}${r === 20 ? ' (natural 20!)' : ''}: ${pct}%.` };
    notify(rate > BASE_RATE ? `Marta raises her price to ${pct}%.` : rate < BASE_RATE ? `Marta is offended: ${pct}% for this visit.` : 'Marta will not budge from half price.', rate >= BASE_RATE ? 'ok' : 'bad');
    render(); return;
  }
  const rate = state.market.haggles[id]?.rate ?? BASE_RATE;
  if (el.dataset.tr === 'trade-tab') { state.market.tab = el.dataset.tab; render(); return; }
  if (el.dataset.tr === 'trade-shelf') { state.market.shelf = el.dataset.shelf; render(); return; }
  if (el.dataset.tr === 'heal-inn' || el.dataset.tr === 'heal-healer') {
    const r = healInTown(d, el.dataset.tr === 'heal-inn' ? 'inn' : 'healer');
    if (!r.ok) { notify(r.message, 'bad'); return; }
    keep(heroApi.save(d)); notify(`${r.message} (${formatCoins(r.cost)})`, 'ok');
    render(); return;
  }
  if (el.dataset.tr === 'trade-repair') {
    const r = repair(d, el.dataset.uid || null);
    if (!r.ok) { notify(r.message, 'bad'); return; }
    keep(heroApi.save(d)); notify(`Mended ${r.mended.join(', ')} for ${formatCoins(r.cost)}.`, 'ok');
    render(); return;
  }
  if (el.dataset.tr === 'trade-buy' || el.dataset.tr === 'trade-buy-rare') {
    const stock = martaStock(c.level, rate);
    const rare = el.dataset.tr === 'trade-buy-rare';
    if (rare && !stock.rare) return;
    const r = buyItem(d, rare ? stock.rare.inst : el.dataset.id, rate, c.scores.str);
    if (!r.ok) { notify(r.message, 'bad'); return; }
    if (rare) markRareBought('marta', stock.period);
    keep(heroApi.save(d)); notify(`Bought ${(r.inst.qty ?? 1) > 1 ? `${r.inst.qty} × ` : ''}${itemName(r.inst)} for ${formatCoins(r.cost)}.`, 'ok');
    render(); return;
  }
  if (el.dataset.tr === 'trade-sell') {
    const inst = d.inventory.find((x) => x.uid === el.dataset.uid); const name = inst ? itemName(inst) : '';
    const r = sellItem(d, el.dataset.uid, rate, el.dataset.qty === 'all' ? null : 1);
    if (!r.ok) { notify(r.message, 'bad'); return; }
    keep(heroApi.save(d)); notify(`Sold ${r.sold > 1 ? `${r.sold} × ` : ''}${name} for ${formatCoins(r.coins)}.`, 'ok');
  }
  if (el.dataset.tr === 'trade-sell-goods') {
    let coins = 0; let n = 0;
    for (const inst of [...d.inventory]) { if (!GOODS.has(ITEMS_BY_ID[inst.id]?.cat) || whyUnsellable(d, inst)) continue; const r = sellItem(d, inst.uid, rate); if (r.ok) { coins += r.coins; n += r.sold; } }
    if (n) { keep(heroApi.save(d)); notify(`Sold ${n} goods for ${formatCoins(coins)}.`, 'ok'); }
  }
  render();
});

/** The deepest floor reached and the bosses slain (dungeon-view.js noteRecord). */
function delveRecordHtml() {
  let r = {}; try { r = JSON.parse(localStorage.getItem('rpg.delve.best') ?? '{}'); } catch { /* storage blocked */ }
  return `<p class="small"><b>10 floors</b>, deeper is deadlier and richer; a boss waits on the last.${r.deepest ? ` Deepest reached: <b>floor ${r.deepest}</b>${r.bosses ? ` · bosses slain: <b>${r.bosses}</b>` : ''}.` : ''}</p>`;
}

function adventuresView() {
  return `
    <section>
      <h1>Adventures</h1>
      <p class="muted">Choose a tale and bring your company. Full adventures are on the way; the sandbox lets you explore generated dungeons now.</p>
      <div class="card-grid">
        ${CAMPAIGNS.map((cp) => `<article class="card adventure campaign-card">
          <div class="card-head"><h3>${esc(cp.title)}</h3><span class="badge">Campaign</span></div>
          <p>${esc(cp.blurb)}</p>
          <p class="muted small">Levels ${esc(cp.levels)} · a world map, 6 places, a quest</p>
          <button class="btn small primary" data-action="open-campaign" data-id="${esc(cp.id)}">${loadCampaignRun(cp.id) ? 'Continue the campaign' : 'Begin the campaign'}</button>
        </article>`).join('')}
        <article class="card adventure market-card">
          <div class="card-head"><h3>The Trading Post</h3><span class="badge">Playable</span></div>
          <p>Between adventures, buy arms, armour and supplies, and sell what you brought back. Traders pay half the price new; haggle with Charisma for a better deal. Now and then Marta has something magical.</p>
          <p class="muted small">Any level · buy gear, sell loot</p>
          <button class="btn small primary" data-action="open-market">Visit the trading post</button>
        </article>
        <article class="card adventure arena-card">
          <div class="card-head"><h3>The Arena</h3><span class="badge">Playable</span></div>
          <p>Build your own battlefield square by square (grass, mud, rivers, castle floors, walls), choose up to four heroes and any of the 356 creatures, place them, and fight. Save your arenas to use again.</p>
          <p class="muted small">Any level · practice bouts</p>
          <button class="btn small primary" data-action="open-arena">Open the arena</button>
        </article>
        ${setting.adventures.map((a) => {
    const playable = a.status === 'playable';
    return `
          <article class="card adventure">
            <div class="card-head"><h3>${esc(a.title)}</h3><span class="badge ${playable ? '' : 'soon'}">${playable ? 'Playable' : 'Coming soon'}</span></div>
            <p>${esc(a.blurb)}</p>
            <p class="muted small">Levels ${esc(a.levels)} · ${esc(a.length)}</p>
            ${a.story ? `<button class="btn small primary" data-action="start-story" data-id="${esc(a.story)}">${savedRun(a.story) ? 'Continue the tale' : 'Begin the tale'}</button>`
    : playable ? `${delveRecordHtml()}<button class="btn small primary" data-action="enter-dungeon" data-id="${esc(a.id)}">Enter</button>` : '<button class="btn small" disabled>Begin</button>'}
          </article>`;
  }).join('')}
      </div>
    </section>`;
}

// ---- Wizard ----------------------------------------------------------------

function wizardView() {
  const d = state.draft;
  const s = settingFor(d);
  const furthest = furthestReachableStep(d, s);
  const views = { concept: conceptStep, race: raceStep, class: classStep, abilities: abilitiesStep, skills: skillsStep, review: reviewStep };
  const last = state.step === STEPS.length - 1;
  return `
    <ol class="stepper">
      ${STEPS.map((st, i) => `
        <li class="${i === state.step ? 'current' : ''} ${i < state.step ? 'done' : ''}">
          <button data-action="goto" data-step="${i}" ${i > furthest ? 'disabled' : ''} ${i === state.step ? 'aria-current="step"' : ''}>
            <span class="num">${i + 1}</span><span class="label">${st.title}</span>
          </button>
        </li>`).join('')}
    </ol>
    <section class="step-body">${views[stepId()](d, s)}</section>
    ${state.errors.length ? `<div class="errors" role="alert"><ul>${state.errors.map((e) => `<li>${esc(e)}</li>`).join('')}</ul></div>` : ''}
    <footer class="wizard-nav">
      <button class="btn ghost" data-action="cancel">Cancel</button>
      <span class="spacer"></span>
      ${state.step > 0 ? '<button class="btn" data-action="back">Back</button>' : ''}
      ${last ? '<button class="btn primary" data-action="save">Save hero</button>' : '<button class="btn primary" data-action="next">Next</button>'}
    </footer>`;
}

function furthestReachableStep(d, s) {
  for (let i = 0; i < STEPS.length - 1; i++) if (validateStep(STEPS[i].id, d, s).length) return i;
  return STEPS.length - 1;
}

function conceptStep(d) {
  return `
    <h2>Who is your hero?</h2>
    <p class="muted">Every tale begins with a name. A one-line concept helps you (and later, the Narrator) know who they are.</p>
    <label class="field">Name
      <input type="text" data-field="name" maxlength="40" value="${esc(d.name)}" placeholder="e.g. Aldric of the Greyfells" autocomplete="off">
    </label>
    <label class="field">Concept <span class="muted">(optional)</span>
      <textarea data-field="concept" rows="3" maxlength="300" placeholder="e.g. A disgraced guard captain seeking to win back her honour.">${esc(d.concept)}</textarea>
    </label>
    <div class="mode-note">${d.mode === 'sandbox'
    ? `<label class="field" for="wiz-level">Sandbox hero, level
        <select id="wiz-level" data-action="set-level" ${d.inventory ? 'disabled title="The level of a saved hero changes through experience."' : ''}>${Array.from({ length: 20 }, (_, i) => `<option value="${i + 1}" ${d.level === i + 1 ? 'selected' : ''}>${i + 1}</option>`).join('')}</select></label>
       <p class="small muted">${levelBlurb(d.level ?? 1)}</p>`
    : `<p class="small"><span class="badge">Standard</span> Begins at level 1 and grows through experience.</p>`}</div>`;
}

function xpBarHtml(c) {
  const p = xpProgress(c.xp, c.level);
  return `<div class="hc-xp" title="${c.level >= 20 ? 'Maximum level' : `${(p.needed - p.into).toLocaleString()} XP to level ${c.level + 1}`}"><span class="lvl">Lv ${c.level}</span><span class="bar"><span style="width:${p.fraction * 100}%"></span></span><span class="small muted">${c.xp.toLocaleString()} XP</span></div>`;
}

function choiceCard({ action, id, selected, title, tagline, meta }) {
  return `
    <button class="card choice ${selected ? 'selected' : ''}" data-action="${action}" data-id="${id}" aria-pressed="${selected}">
      <span class="choice-title">${esc(title)}</span>
      <span class="choice-tag">${esc(tagline)}</span>
      ${meta ? `<span class="choice-meta">${meta}</span>` : ''}
    </button>`;
}

function raceStep(d, s) {
  const race = s.races.find((r) => r.id === d.raceId);
  const resolved = race && resolveRace(s, d.raceId, d.subraceId);
  return `
    <h2>Choose your kindred</h2>
    <p class="muted">Your kindred (race in D&D terms) adds bonuses to your ability scores and grants innate traits.</p>
    <div class="card-grid choices">
      ${s.races.map((r) => choiceCard({ action: 'pick-race', id: r.id, selected: r.id === d.raceId, title: r.name, tagline: r.tagline, meta: esc(bonusList(r.abilityBonuses)) })).join('')}
    </div>
    ${race ? `
      <div class="detail">
        <h3>${esc(race.name)}</h3>
        <p>${esc(race.description)}</p>
        ${race.subraces?.length ? `
          <h4>Which people do you hail from?</h4>
          <div class="card-grid choices two">
            ${race.subraces.map((sr) => choiceCard({ action: 'pick-subrace', id: sr.id, selected: sr.id === d.subraceId, title: sr.name, tagline: sr.description, meta: esc(bonusList(sr.abilityBonuses)) })).join('')}
          </div>` : ''}
        <dl class="facts">
          <div><dt>Ability bonuses</dt><dd>${esc(bonusList(resolved.abilityBonuses))}</dd></div>
          <div><dt>Speed</dt><dd>${mtr(resolved.speed)}</dd></div>
          <div><dt>Size</dt><dd>${esc(resolved.size)}</dd></div>
          <div><dt>Languages</dt><dd>${esc(resolved.languages.join(', '))}</dd></div>
          ${resolved.skillProficiencies.length ? `<div><dt>Skill</dt><dd>${esc(resolved.skillProficiencies.map(skillName).join(', '))}</dd></div>` : ''}
        </dl>
        <h4>Traits</h4>
        ${traitList(resolved.traits)}
      </div>` : ''}`;
}

const traitList = (traits) => `<ul class="traits">${traits.map((t) => `<li><strong>${esc(t.name)}.</strong> ${esc(t.text)}</li>`).join('')}</ul>`;

function classStep(d, s) {
  const cls = s.classes.find((c) => c.id === d.classId);
  return `
    <h2>Choose your calling</h2>
    <p class="muted">Your calling (class) sets your hit points, what you are trained in, and your special abilities.</p>
    <div class="card-grid choices">
      ${s.classes.map((c) => choiceCard({ action: 'pick-class', id: c.id, selected: c.id === d.classId, title: c.name, tagline: c.tagline, meta: `d${c.hitDie} hit die · ${c.primary.map((a) => ABILITIES[a].short).join(' / ')}` })).join('')}
    </div>
    ${cls ? `
      <div class="detail">
        <h3>${esc(cls.name)}</h3>
        <p>${esc(cls.description)}</p>
        <dl class="facts">
          <div><dt>Hit die</dt><dd>d${cls.hitDie} <span class="muted">(level 1 HP = ${cls.hitDie} + CON modifier)</span></dd></div>
          <div><dt>Key abilities</dt><dd>${cls.primary.map((a) => ABILITIES[a].name).join(', ')}</dd></div>
          <div><dt>Saving throws</dt><dd>${cls.savingThrows.map((a) => ABILITIES[a].name).join(', ')}</dd></div>
          <div><dt>Armour</dt><dd>${esc(cls.armorProficiencies.join(', ') || 'None')}</dd></div>
          <div><dt>Weapons</dt><dd>${esc(cls.weaponProficiencies.join(', '))}</dd></div>
          <div><dt>Skills</dt><dd>Choose ${cls.skillChoices.count}</dd></div>
          <div><dt>Equipment</dt><dd>${esc(cls.equipment.map((e) => e.name).join(', '))}</dd></div>
        </dl>
        <h4>Features</h4>
        ${traitList(cls.features)}
      </div>` : ''}`;
}

function dieFace(value, dropped = false, tumbling = false) {
  return `<span class="die ${dropped ? 'dropped' : ''} ${tumbling ? 'tumbling' : ''}" aria-hidden="true">${value ?? '?'}</span>`;
}

function abilitiesStep(d, s) {
  const race = resolveRace(s, d.raceId, d.subraceId);
  const cls = s.classes.find((c) => c.id === d.classId);
  const pool = abilityPool(d);
  const usesPool = d.abilityMethod !== 'pointbuy';
  const rolledAll = d.abilityRolls.every(Boolean);
  const anyRolled = d.abilityRolls.some(Boolean);

  const methodTabs = Object.entries(ABILITY_METHODS).map(([id, m]) => `
    <button class="seg ${d.abilityMethod === id ? 'active' : ''}" data-action="method" data-id="${id}" aria-pressed="${d.abilityMethod === id}">${m.name}</button>`).join('');

  const rollTray = d.abilityMethod !== 'roll' ? '' : `
    <div class="roll-tray">
      ${d.abilityRolls.map((r, i) => {
    const tumbling = state.rolling.has(i);
    return `
        <div class="roll-slot ${r ? 'rolled' : ''}" data-index="${i}">
          <div class="dice">${[0, 1, 2, 3].map((k) => dieFace(tumbling ? '?' : r?.rolls[k], !tumbling && r?.droppedIndices.includes(k), tumbling)).join('')}</div>
          <div class="roll-total">${tumbling ? '…' : r ? r.total : '—'}</div>
          ${r || tumbling ? '' : `<button class="btn small" data-action="roll-one" data-index="${i}">Roll</button>`}
        </div>`;
  }).join('')}
    </div>
    <div class="row">
      ${rolledAll ? '' : `<button class="btn primary" data-action="roll-all" ${state.rolling.size ? 'disabled' : ''}>Roll ${anyRolled ? 'the rest' : 'all six'}</button>`}
      ${anyRolled ? `<button class="btn ghost" data-action="reroll" ${state.rolling.size ? 'disabled' : ''}>Start over</button>` : ''}
    </div>`;

  const spent = d.abilityMethod === 'pointbuy' ? pointBuyTotal(d.baseAbilities) : 0;
  const rows = ABILITY_IDS.map((id) => {
    const base = d.baseAbilities[id];
    const bonus = race?.abilityBonuses[id] ?? 0;
    const final = base === null ? null : Math.min(20, base + bonus);
    const primary = cls?.primary.includes(id);
    let control;
    if (usesPool) {
      const taken = new Set(ABILITY_IDS.filter((o) => o !== id).map((o) => d.abilityAssignment[o]));
      control = `<select data-action="assign" data-ability="${id}" aria-label="Score for ${ABILITIES[id].name}" ${pool.some((v) => v !== null) ? '' : 'disabled'}>
        <option value="">—</option>
        ${pool.map((v, i) => (v === null || taken.has(i) ? '' : `<option value="${i}" ${d.abilityAssignment[id] === i ? 'selected' : ''}>${v}</option>`)).join('')}
      </select>`;
    } else {
      const nextCost = base < POINT_BUY.max ? pointBuyScoreCost(base + 1) - pointBuyScoreCost(base) : Infinity;
      control = `<span class="stepper-ctl">
        <button class="btn icon" data-action="pb" data-ability="${id}" data-delta="-1" ${base <= POINT_BUY.min ? 'disabled' : ''} aria-label="Lower ${ABILITIES[id].name}">−</button>
        <span class="pb-val">${base}</span>
        <button class="btn icon" data-action="pb" data-ability="${id}" data-delta="1" ${spent + nextCost > POINT_BUY.budget ? 'disabled' : ''} aria-label="Raise ${ABILITIES[id].name}">+</button>
      </span>`;
    }
    return `
      <tr class="${primary ? 'primary' : ''}">
        <th scope="row"><span class="ab-name">${ABILITIES[id].name}${primary ? ' <span class="star" title="Key ability for your calling">★</span>' : ''}</span><span class="ab-blurb">${ABILITIES[id].blurb}</span></th>
        <td>${control}</td>
        <td class="num">${bonus ? fmt(bonus) : '—'}</td>
        <td class="num strong">${final ?? '—'}</td>
        <td class="num mod">${final === null ? '—' : fmt(abilityModifier(final))}</td>
      </tr>`;
  }).join('');

  return `
    <h2>Determine your abilities</h2>
    <div class="segmented" role="group" aria-label="Score method">${methodTabs}</div>
    <p class="muted">${ABILITY_METHODS[d.abilityMethod].blurb}</p>
    ${rollTray}
    ${d.abilityMethod === 'pointbuy' ? `<p class="points">Points remaining: <strong>${POINT_BUY.budget - spent}</strong> / ${POINT_BUY.budget}</p>` : ''}
    ${usesPool && cls ? `<div class="row"><button class="btn small ghost" data-action="auto-assign" ${pool.every((v) => v !== null) ? '' : 'disabled'}>Auto-place for a ${esc(cls.name)}</button></div>` : ''}
    <table class="ability-table">
      <thead><tr><th>Ability</th><th>Base</th><th>${esc(race?.race.name ?? 'Kindred')}</th><th>Score</th><th>Modifier</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <details class="explain">
      <summary>How do scores and modifiers work?</summary>
      <p>Scores run from 3 to 18 for a new hero (20 is the limit). What you actually add to dice rolls is the
      <strong>modifier</strong>: <code>floor((score − 10) ÷ 2)</code>. So 10–11 gives +0, 12–13 gives +1, 8–9 gives −1.</p>
      <p><strong>Rolling 4d6, dropping the lowest</strong> averages about 12.2 per score, a little above the 10.5 you'd get
      from just 3d6, and it makes very low scores rare. Throwing away the lowest die pushes the results upward.
      The standard array and point buy give everyone the same total power; rolling is more exciting but less fair.</p>
    </details>`;
}

function skillsStep(d, s) {
  const cls = s.classes.find((c) => c.id === d.classId);
  const granted = new Set(grantedSkills(d, s));
  const race = resolveRace(s, d.raceId, d.subraceId);
  const bg = s.backgrounds.find((b) => b.id === d.backgroundId);
  const chosen = new Set(d.skillChoices);
  const full = chosen.size >= cls.skillChoices.count;
  const c = deriveCharacter(d, s);

  const skillRows = SKILLS.map((sk) => {
    const isGranted = granted.has(sk.id);
    const offered = cls.skillChoices.from.includes(sk.id);
    const checked = isGranted || chosen.has(sk.id);
    const disabled = isGranted || !offered || (!checked && full);
    const from = race?.skillProficiencies.includes(sk.id) ? race.race.name : bg?.skills.includes(sk.id) ? bg.name : null;
    const bonus = c.skills.find((x) => x.id === sk.id).bonus;
    return `
      <label class="skill ${disabled && !checked ? 'off' : ''} ${checked ? 'on' : ''}">
        <input type="checkbox" data-action="skill" data-id="${sk.id}" ${checked ? 'checked' : ''} ${disabled ? 'disabled' : ''}>
        <span class="skill-name">${esc(sk.name)}</span>
        <span class="skill-ab">${ABILITIES[sk.ability].short}</span>
        <span class="skill-bonus">${fmt(bonus)}</span>
        ${from ? `<span class="tag">${esc(from)}</span>` : offered ? '' : '<span class="tag dim">not offered</span>'}
      </label>`;
  }).join('');

  return `
    <h2>Background</h2>
    <p class="muted">What did your hero do before adventure found them? A background grants two skills and a useful feature.</p>
    <div class="card-grid choices">
      ${s.backgrounds.map((b) => choiceCard({ action: 'pick-bg', id: b.id, selected: b.id === d.backgroundId, title: b.name, tagline: b.description, meta: esc(b.skills.map(skillName).join(', ')) })).join('')}
    </div>
    ${bg ? `<div class="detail"><strong>${esc(bg.feature.name)}.</strong> ${esc(bg.feature.text)}</div>` : ''}
    <h2>Skills</h2>
    <p class="muted">As a ${esc(cls.name)}, choose <strong>${cls.skillChoices.count}</strong> skills (${chosen.size} chosen).
      Being trained ("proficient") adds your proficiency bonus (+${c.proficiencyBonus}) to that skill.</p>
    <div class="skill-list">${skillRows}</div>`;
}

function reviewStep(d, s) {
  return `
    <h2>Review your hero</h2>
    <p class="muted">Everything below is calculated from your choices. Click any ability, save, skill or attack to try a roll.</p>
    ${appearanceEditor(d)}
    ${sheetHtml(deriveCharacter(d, s), heroLook(d))}
    ${diceTray()}`;
}

/** Portrait, colours, style and voice: all choices layered on the generated paintings. */
function appearanceEditor(d) {
  const a = resolveAppearance(d);
  const look = heroLook(d);
  const own = Object.keys(PORTRAITS);
  return `
    <section class="look-editor" aria-label="Portrait and voice">
      <div class="look-preview">${portraitHtml(look, 'lg')}</div>
      <div class="look-controls">
        <h3>Portrait &amp; voice</h3>
        <label class="field small" for="look-portrait">Portrait
          <select id="look-portrait" data-action="look-portrait">${own.map((k) => `<option value="${k}" ${k === a.portrait ? 'selected' : ''}>${esc(PORTRAITS[k])}</option>`).join('')}</select>
        </label>
        <div class="look-variants" role="group" aria-label="Variation">
          ${Array.from({ length: PORTRAIT_VARIANTS }, (_, i) => i + 1).map((n) => `
            <button class="look-variant ${n === a.variant ? 'sel' : ''}" data-action="look-variant" data-n="${n}" aria-pressed="${n === a.variant}" aria-label="Variation ${n}">
              <img src="${esc(portraitUrl(a.portrait, n))}" alt="" style="filter:${appearanceFilter(a)}" loading="lazy">
            </button>`).join('')}
        </div>
        <div class="look-row"><span class="look-label">Style</span>
          <div class="chips">${Object.entries(STYLES).map(([k, v]) => `<button class="chip ${k === a.style ? 'sel' : ''}" data-action="look-style" data-id="${k}" aria-pressed="${k === a.style}">${esc(v.label)}</button>`).join('')}</div>
        </div>
        <label class="look-row" for="look-hue"><span class="look-label">Colour shift</span>
          <input id="look-hue" type="range" min="-180" max="180" step="5" value="${a.hue}" data-look="hue" aria-label="Colour shift in degrees">
          <span class="muted small look-hue-val">${a.hue}°</span>
        </label>
        <div class="look-row"><span class="look-label">Frame</span>
          <div class="chips">${Object.entries(FRAMES).map(([k, v]) => `<button class="swatch ${k === a.frame ? 'sel' : ''}" style="--sw:${v}" data-action="look-frame" data-id="${k}" aria-pressed="${k === a.frame}" aria-label="${k} frame"></button>`).join('')}</div>
        </div>
        <div class="look-row"><span class="look-label">Battle voice</span>
          <div class="chips">${Object.entries(VOICES).map(([k, v]) => `<button class="chip ${k === a.voice ? 'sel' : ''}" data-action="look-voice" data-id="${k}" aria-pressed="${k === a.voice}">${esc(v)}</button>`).join('')}
            <button class="chip" data-action="look-hear">▶ Hear it</button></div>
        </div>
      </div>
    </section>`;
}

// ---- Character sheet -------------------------------------------------------

function rollBtn(label, bonus, text) {
  return `<button class="roll-btn" data-action="check" data-label="${esc(label)}" data-bonus="${bonus}">${text}</button>`;
}

function sheetHtml(c, look) {
  return `
    <article class="sheet">
      <header class="sheet-head">
        ${look ? portraitHtml(look, 'md') : ''}
        <div>
          <h2>${esc(c.name)}</h2>
          <p class="muted">Level ${c.level} ${esc(c.race?.name)} ${esc(c.cls?.name)} · ${esc(c.background?.name ?? '')}</p>
          ${c.concept ? `<p class="concept">${esc(c.concept)}</p>` : ''}
        </div>
      </header>
      <section class="vitals">
        ${[['Evasion', c.ac], ['Block', `${c.defence?.block ?? 0}%`], ['Armour', c.defence?.pieces?.length ? `${coverage(c.defence)}/100 covered` : '—'], ['Hit Points', hpText(c, state.sheet?.draft ?? {})], ['Speed', mtr(c.speed)], ['Initiative', fmt(c.initiative)],
    ['Proficiency', fmt(c.proficiencyBonus)], ['Passive Perception', c.passivePerception], ['Hit Die', `1d${c.hitDie}`]]
    .map(([k, v]) => `<div class="vital"><span class="v">${v}</span><span class="k">${k}</span></div>`).join('')}
      </section>
      <section class="ability-boxes">
        ${ABILITY_IDS.map((id) => `
          <button class="ability-box" data-action="check" data-label="${ABILITIES[id].name} check" data-bonus="${c.mods[id]}">
            <span class="k">${ABILITIES[id].short}</span>
            <span class="v">${fmt(c.mods[id])}</span>
            <span class="score">${c.scores[id]}</span>
          </button>`).join('')}
      </section>
      <div class="sheet-cols">
        <section class="panel">
          <h3>Saving throws</h3>
          <ul class="checklist">${c.savingThrows.map((st) => `<li class="${st.proficient ? 'prof' : ''}">${rollBtn(`${ABILITIES[st.ability].name} save`, st.bonus, `<span class="dot"></span><span>${ABILITIES[st.ability].name}</span><span class="b">${fmt(st.bonus)}</span>`)}</li>`).join('')}</ul>
          <h3>Skills</h3>
          <ul class="checklist">${c.skills.map((sk) => `<li class="${sk.proficient ? 'prof' : ''}">${rollBtn(sk.name, sk.bonus, `<span class="dot"></span><span>${esc(sk.name)} <small>(${ABILITIES[sk.ability].short})</small></span><span class="b">${fmt(sk.bonus)}</span>`)}</li>`).join('')}</ul>
        </section>
        <section class="panel">
          <h3>Attacks</h3>
          <table class="attacks">
            <thead><tr><th>Weapon</th><th>To hit</th><th>Damage</th></tr></thead>
            <tbody>${c.attacks.map((a) => `
              <tr><td>${esc(a.name)}${a.properties.length ? `<br><small class="muted">${esc(a.properties.map(playRangeText).join(', '))}</small>` : ''}</td>
              <td>${rollBtn(`${a.name} attack`, a.toHit, fmt(a.toHit))}</td>
              <td><button class="roll-btn" data-action="damage" data-label="${esc(a.name)} damage" data-notation="${esc(a.damage)}">${esc(a.damage)} ${esc(a.damageType)}</button></td></tr>`).join('')}
            </tbody>
          </table>
          ${c.gearNotes.length ? `<ul class="gear-notes small">${c.gearNotes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}
          <h3>Languages</h3>
          <p>${esc(c.languages.join(', '))}</p>
          <h3>Training</h3>
          <p><strong>Armour:</strong> ${esc(c.armorProficiencies.join(', ') || 'None')}<br><strong>Weapons:</strong> ${esc(c.weaponProficiencies.join(', '))}</p>
        </section>
      </div>
      ${magicSheet(c)}
      <section class="panel">
        <h3>Features &amp; traits</h3>
        <ul class="traits">${c.features.map((f) => `<li><strong>${esc(f.name)}</strong> <span class="tag">${esc(f.source)}</span><br>${esc(f.text)}</li>`).join('')}</ul>
      </section>
    </article>`;
}

/** Spells and abilities on the sheet: what you can do now, and what each level will bring. */
function magicSheet(c) {
  const m = c.magic;
  if (!m || (!m.spells.length && !m.abilities.length && !m.locked.length)) return '';
  const ord = (n) => `${n}${n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th'}`;
  const mana = c.caster ? manaFor(c.caster.type, c.level) : 0;
  const row = (x) => `<li><strong>${esc(x.name)}</strong> <span class="tag">${x.kind === 'spell' ? (x.level ? `${ord(x.level)}-circle spell · ${manaCost(x)} mana` : 'cantrip · free') : x.passive ? 'always on' : Number.isFinite(x.maxUses) ? `${x.maxUses} uses (back at a totem, inn or camp)` : 'ability'}</span>${x.concentration ? ' <span class="tag">concentration</span>' : ''}<br>${esc(x.desc)}</li>`;
  return `<section class="panel sheet-magic">
    <h3>Spells &amp; abilities</h3>
    ${c.caster ? `<p>Spellcasting ability <b>${c.caster.ability.toUpperCase()}</b> · save DC <b>${c.caster.dc}</b> (8 + proficiency + modifier) · spell attack <b>${fmt(c.caster.attack)}</b></p>
      ${mana ? `<p class="mana-row">${manaHtml(mana, mana)}</p><p class="small muted">Spells cost mana (cantrips are free; the mightiest cost 7). It comes back at a mana totem, an inn or a camp.</p>` : '<p class="muted small">Mana arrives at level 2.</p>'}` : ''}
    ${c.attacksPerAction > 1 ? `<p>Attacks per Attack action: <b>${c.attacksPerAction}</b></p>` : ''}
    <ul class="traits">${[...m.abilities, ...m.spells].map(row).join('')}</ul>
    ${m.locked.length ? `<details><summary>Coming at higher levels (${m.locked.length})</summary><ul class="traits locked">${m.locked.map((x) => `<li><strong>Level ${x.unlock}: ${esc(x.name)}</strong> <span class="tag">${x.kind === 'spell' ? (x.level ? `${ord(x.level)}-circle spell · ${manaCost(x)} mana` : 'cantrip · free') : 'ability'}</span><br>${esc(x.desc)}</li>`).join('')}</ul></details>` : ''}
  </section>`;
}

function diceTray() {
  return `
    <aside class="dice-log" aria-live="polite">
      <div class="row"><strong>Dice tray</strong><span class="spacer"></span>
        ${[4, 6, 8, 10, 12, 20].map((n) => `<button class="btn small" data-action="free-roll" data-sides="${n}" title="Roll a d${n}">d${n}</button>`).join('')}
        ${state.diceLog.length ? '<button class="btn small ghost" data-action="clear-log">Clear</button>' : ''}</div>
      ${state.diceLog.length ? `<ol>${state.diceLog.map((e) => `<li class="${e.crit}"><span>${esc(e.label)}</span><span class="calc">${esc(e.calc)}</span><strong>${e.total}</strong></li>`).join('')}</ol>`
    : '<p class="muted small">Click a skill, save or attack to roll a d20 and add the bonus.</p>'}
    </aside>`;
}

function sheetView() {
  const { draft, source } = state.sheet;
  const c = deriveCharacter(draft, settingFor(draft));
  return `
    <div class="row sheet-actions">
      <button class="btn ghost" data-action="home">← All heroes</button>
      <span class="spacer"></span>
      ${source === 'roster' ? `
        <button class="btn" data-action="edit" data-id="${esc(draft.id)}">Edit</button>
        <button class="btn" data-action="export" data-id="${esc(draft.id)}">Export</button>`
    : `<button class="btn primary" data-action="adopt" data-id="${esc(draft.id)}">Adopt this hero</button>`}
    </div>
    ${source === 'roster' && pendingLevelUps(draft).length ? `<div class="lu-waiting" role="status"><span>✦ <b>Level-up choices are waiting</b> (level ${pendingLevelUps(draft).join(', ')}): improve your abilities or train a new skill.</span>
      <button class="btn primary" data-action="level-choices" data-id="${esc(draft.id)}">Choose now</button></div>` : ''}
    ${sheetHtml(c, heroLook(draft))}
    ${source === 'roster' ? `<section class="panel sheet-inv">${xpBarHtml(c)}${inventoryHtml(draft, { str: c.scores.str, selected: state.inv.selected, filter: state.inv.filter, doll: state.inv.doll, title: 'Inventory', safe: { items: safe.items(), slots: SAFE_SLOTS } })}</section>`
    : `<section class="panel"><h3>Starting gear</h3><ul class="plain">${c.equipment.map((e) => `<li>${esc(e.name)}${e.qty > 1 ? ` ×${e.qty}` : ''}${e.equipped ? ' <span class="tag">equipped</span>' : ''}</li>`).join('')}</ul></section>`}
    ${diceTray()}`;
}

// ---- Dungeon explorer -------------------------------------------------------

/** Heroes that can walk the dungeon: your complete heroes first, then ready-made ones you have not adopted. */
function explorerHeroes() {
  const mine = roster.list().filter((d) => isComplete(d, settingFor(d)));
  const adopted = new Set(mine.map((d) => d.premadeOf).filter(Boolean));
  const premade = setting.premades.filter((p) => !adopted.has(p.id)).map((p) => syncBaseFromAssignment(structuredClone(p)));
  return [...mine.map((d) => ({ d, tag: '' })), ...premade.map((d) => ({ d, tag: ' (ready-made)' }))].map(({ d, tag }) => {
    const c = deriveCharacter(d, settingFor(d));
    return { id: d.id, label: `${c.name}, level ${c.level} ${c.race.name} ${c.cls.name}${tag}`, look: heroLook(d) };
  });
}

/** What the dungeon needs from a hero: combat numbers derived from the saved choices and gear. */
function dungeonStats(d) {
  const c = deriveCharacter(d, settingFor(d));
  return {
    id: d.id, name: c.name, level: c.level, xp: c.xp, proficiencyBonus: c.proficiencyBonus,
    speed: c.speed, ac: c.ac, defence: c.defence, maxHp: c.maxHp, dexMod: c.mods.dex, str: c.scores.str, attacks: c.attacks,
    look: heroLook(d), skills: Object.fromEntries(c.skills.map((sk) => [sk.id, sk.bonus])),
    saves: Object.fromEntries(c.savingThrows.map((st) => [st.ability, st.bonus])),
    race: c.race?.id, languages: c.languages, wis: c.mods.wis, int: c.mods.int, toolBonus: c.toolBonus, gearNotes: c.gearNotes,
    keenSearch: c.features.some((f) => /Burglar's Eye/.test(f.name)), // advantage when searching
    magic: c.magic, caster: c.caster, attacksPerAction: c.attacksPerAction, cls: c.cls?.id, hitDie: c.hitDie, conMod: c.mods.con, mods: c.mods,
    sneak: c.cls?.id === 'burglar', uncanny: c.cls?.id === 'burglar' && c.level >= 5, evasion: c.cls?.id === 'burglar' && c.level >= 7,
    stealthDis: c.gearNotes.some((n) => /noisy/.test(n)),
    sheet: c, // the full character sheet, for the in-game Characters window
  };
}

/** Hit points as they stand: wounds last between adventures until a potion or spell mends them. */
function hpText(c, d) {
  const w = Math.min(Math.max(0, d?.wounds ?? 0), c.maxHp - 1);
  return w ? `${c.maxHp - w}/${c.maxHp}` : `${c.maxHp}`;
}

const heroApi = {
  load(id) {
    const d = roster.get(id) ?? findHero('premade', id);
    return d ? ensureGear(structuredClone(d), settingFor(d)) : null;
  },
  derive: dungeonStats,
  gainXp,
  /** Put a hero back exactly as saved at a checkpoint (engine/delve.js). */
  restore: (d) => roster.save(d),
  /** The level-up pop-up: choices for the new level and what changed. Resolves when OK is clicked. */
  levelUp: (d, from, to) => levelUpDialog({ draft: d, setting: settingFor(d), from, to }),
  /** Save progress. A ready-made hero is adopted into the company the first time. */
  save(d) {
    d.adventured = true;
    if (d.id.startsWith('premade-')) {
      const copy = { ...d, id: makeId(), premadeOf: d.id, createdAt: new Date().toISOString(), appearance: resolveAppearance(d) };
      return roster.save(copy);
    }
    return roster.save(d);
  },
};

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

function openWizard(draft, step = 0) {
  Object.assign(state, { view: 'wizard', draft, step, errors: [], dirty: false, rolling: new Set(), diceLog: [] });
  render();
  window.scrollTo(0, 0);
  root.querySelector('[data-field="name"]')?.focus();
}

function goToStep(i) {
  state.step = Math.max(0, Math.min(STEPS.length - 1, i));
  state.errors = [];
  render();
  window.scrollTo({ top: 0, behavior: reducedMotion ? 'auto' : 'smooth' });
}

function touch() { state.dirty = true; state.errors = []; }

function findHero(source, id) {
  if (source === 'premade') {
    const p = setting.premades.find((x) => x.id === id);
    return p && syncBaseFromAssignment(structuredClone(p));
  }
  return roster.get(id);
}

/** Roll ability sets with a short tumbling animation. The result is decided first; the animation is cosmetic. */
function rollAbilitySlots(indices) {
  const d = state.draft;
  const results = new Map(indices.map((i) => [i, rollAbilityScore()]));
  indices.forEach((i) => state.rolling.add(i));
  render();
  const duration = reducedMotion ? 0 : 700;
  const timer = setInterval(() => {
    root.querySelectorAll('.die.tumbling').forEach((el) => { el.textContent = rollDie(6); });
  }, 60);
  setTimeout(() => {
    clearInterval(timer);
    for (const [i, r] of results) { d.abilityRolls[i] = r; state.rolling.delete(i); }
    syncBaseFromAssignment(d);
    touch();
    render();
  }, duration);
}

/** "range 150/600" as the game plays it (engine/range.js): "reach 12 squares". */
function playRangeText(p) {
  const m = /^(range|thrown) (\d+)\/(\d+)/.exec(p);
  if (!m) return p;
  const [r] = playRange(Number(m[2]) / 5, Number(m[3]) / 5, { thrown: m[1] === 'thrown' });
  return `${m[1] === 'thrown' ? 'thrown, ' : ''}reach ${r} squares`;
}

async function logRoll(label, bonus) {
  const r = rollDie(20);
  if (diceWanted(true)) await rollDice({ groups: [{ dice: [{ sides: 20, value: r }], caption: `${bonus >= 0 ? '+' : '−'} ${Math.abs(bonus)} = ${r + bonus}` }], label, verdict: r === 20 ? 'Natural 20!' : r === 1 ? 'Natural 1' : `${r + bonus}`, verdictKind: r === 20 ? 'good' : r === 1 ? 'bad' : '' });
  const crit = r === 20 ? 'crit' : r === 1 ? 'fumble' : '';
  state.diceLog.unshift({ label, calc: `d20 (${r}) ${bonus >= 0 ? '+' : '−'} ${Math.abs(bonus)}`, total: r + bonus, crit });
  state.diceLog = state.diceLog.slice(0, 8);
  render();
}

const actions = {
  /** Bodies or tokens on the map (start screen); remembered in this browser. */
  setting(el) { setSetting(el.dataset.setting, el.value); toast('Setting saved.'); },
  home() {
    if (state.view === 'wizard' && state.dirty && !confirmTwice('leave', 'Leave without saving this hero?')) return;
    if (['dungeon', 'arena', 'arena-fight', 'story', 'story-fight', 'campaign', 'campaign-place'].includes(state.view)) state.tab = 'adventures';
    Object.assign(state, { view: 'home', draft: null, sheet: null, diceLog: [] });
    render();
  },
  tab(el) { state.tab = el.dataset.tab; render(); },
  'view-monster'(el) {
    if (!BESTIARY_BY_ID[el.dataset.id]) return;
    state.listScroll = window.scrollY;
    Object.assign(state, { view: 'monster', monsterId: el.dataset.id, diceLog: [] });
    render();
    window.scrollTo(0, 0);
  },
  'bestiary-back'() {
    Object.assign(state, { view: 'home', tab: 'bestiary', diceLog: [] });
    render();
    window.scrollTo(0, state.listScroll ?? 0);
  },
  async 'copy-prompt'(el) {
    try { await navigator.clipboard.writeText(el.dataset.prompt); el.textContent = 'Copied!'; } catch { el.textContent = 'Copy failed'; }
    setTimeout(() => { el.textContent = 'Copy image prompt'; }, 1500);
  },
  'look-portrait'(el) { setLook({ portrait: el.value, variant: 1 }); },
  'look-variant'(el) { setLook({ variant: Number(el.dataset.n) }); },
  'look-style'(el) { setLook({ style: el.dataset.id }); },
  'look-frame'(el) { setLook({ frame: el.dataset.id }); },
  'look-voice'(el) { setLook({ voice: el.dataset.id }); play(`hero-${el.dataset.id}-attack`); },
  'look-hear'() { const v = resolveAppearance(state.draft).voice; play(`hero-${v}-attack`); play(`hero-${v}-hurt`, { delay: 900 }); },
  'toggle-music'(el) {
    music.setEnabled(!music.state().enabled);
    // Update in place: a re-render would reset a dungeon in progress.
    el.setAttribute('aria-pressed', String(music.state().enabled));
    el.innerHTML = `${music.state().enabled ? '🎵' : '🎵'}<span class="sr-only">${music.state().enabled ? 'Turn music off' : 'Turn music on'}</span>`;
    const vol = root.querySelector('.music-vol'); if (vol) vol.disabled = !music.state().enabled;
  },
  'toggle-sound'(el) {
    setMuted(!isMuted());
    // Update the button in place: re-rendering would reset a dungeon in progress.
    el.setAttribute('aria-pressed', String(!isMuted()));
    el.title = isMuted() ? 'Sound off' : 'Sound on';
    el.innerHTML = `${isMuted() ? '🔇' : '🔊'}<span class="sr-only">${isMuted() ? 'Turn sound on' : 'Turn sound off'}</span>`;
    if (!isMuted()) play('dice', { volume: 0.5 });
  },
  async 'level-choices'(el) {
    const d = roster.get(el.dataset.id); if (!d) return;
    const pend = pendingLevelUps(d); if (!pend.length) return;
    await levelUpDialog({ draft: d, setting: settingFor(d), from: pend[0] - 1, to: d.level });
    state.sheet = { ...state.sheet, draft: roster.save(d) };
    render();
  },
  'open-settings'() { state.settingsOpen = true; render(); },
  'close-settings'() { state.settingsOpen = false; render(); },
  'close-settings-bg'(el, e) { if (e?.target === el) { state.settingsOpen = false; render(); } },
  'open-campaign'(el) { Object.assign(state, { view: 'campaign', campaignId: el.dataset.id }); render(); window.scrollTo(0, 0); },
  'start-story'(el) { Object.assign(state, { view: 'story', storyId: el.dataset.id }); render(); window.scrollTo(0, 0); },
  'open-market'() { Object.assign(state, { view: 'market', market: { heroId: explorerHeroes()[0]?.id ?? null, haggles: {}, draft: null, tab: 'buy' } }); render(); window.scrollTo(0, 0); },
  'market-hero'(el) { state.market.heroId = el.dataset.id; state.market.draft = null; render(); },
  'open-arena'() { Object.assign(state, { view: 'arena' }); render(); window.scrollTo(0, 0); },
  'enter-dungeon'() {
    Object.assign(state, { view: 'dungeon' });
    render();
    window.scrollTo(0, 0);
  },
  new() { Object.assign(state, { view: 'start' }); render(); window.scrollTo(0, 0); },
  'start-mode'(el) { state.start.mode = el.dataset.id; render(); },
  'start-level'(el) { state.start.level = Number(el.value); render(); },
  'start-go'() {
    const d = newDraft(setting.id);
    d.mode = state.start.mode;
    d.level = d.mode === 'sandbox' ? state.start.level : 1;
    d.xp = XP_FOR_LEVEL[d.level];
    openWizard(d);
  },
  'set-level'(el) {
    const d = state.draft;
    if (!d || d.inventory) return;
    d.level = Number(el.value); d.xp = XP_FOR_LEVEL[d.level]; touch(); render();
  },
  edit(el) {
    const d = roster.get(el.dataset.id);
    if (d) openWizard(structuredClone(d), isComplete(d, settingFor(d)) ? STEPS.length - 1 : 0);
  },
  view(el) {
    const d = findHero(el.dataset.source, el.dataset.id);
    if (!d) return;
    if (el.dataset.source === 'roster' && !d.inventory) roster.save(ensureGear(d, settingFor(d)));
    Object.assign(state, { view: 'sheet', inv: { selected: null, filter: 'all', dropArm: null }, sheet: { draft: d, source: el.dataset.source }, diceLog: [] });
    render();
    window.scrollTo(0, 0);
  },
  adopt(el) {
    const d = findHero('premade', el.dataset.id);
    if (!d) return;
    const copy = ensureGear({ ...d, id: makeId(), premadeOf: d.id, createdAt: new Date().toISOString(), appearance: resolveAppearance(d) }, settingFor(d));
    roster.save(copy);
    Object.assign(state, { view: 'sheet', sheet: { draft: copy, source: 'roster' } });
    notify(`${copy.name} has joined your company.`);
  },
  export(el) {
    const d = roster.get(el.dataset.id);
    if (!d) return;
    const json = exportCharacter(d);
    download(`${d.name.replace(/[^\w-]+/g, '_') || 'hero'}.json`, json);
    navigator.clipboard?.writeText(json).then(() => notify(`${d.name} exported. The hero file is also copied to your clipboard.`), () => {});
  },
  delete(el) {
    const d = roster.get(el.dataset.id);
    if (d && confirmTwice(`delete-${d.id}`, `Delete ${d.name}? This cannot be undone.`)) { roster.remove(d.id); notify(`${d.name} has been removed.`); }
  },
  async import(el) {
    const file = el.files?.[0];
    el.value = '';
    if (!file) return;
    try {
      const d = importCharacter(await file.text());
      if (!getSetting(d.settingId)) throw new Error('This hero belongs to a world that is not installed.');
      roster.save(d);
      notify(`Imported ${d.name}.`);
    } catch (err) {
      notify(err.message, 'bad');
    }
  },

  // Wizard navigation
  cancel() { actions.home(); },
  back() { goToStep(state.step - 1); },
  goto(el) { goToStep(Number(el.dataset.step)); },
  next() {
    const errors = validateStep(stepId(), state.draft, settingFor(state.draft));
    if (errors.length) { state.errors = errors; render(); return; }
    goToStep(state.step + 1);
  },
  save() {
    const d = state.draft;
    const errors = validateStep('review', d, settingFor(d));
    if (errors.length) { state.errors = errors; render(); return; }
    d.name = d.name.trim();
    // A new hero (or one whose calling or background changed before adventuring) gets its starting kit.
    const kit = `${d.classId}|${d.backgroundId}`;
    if (d.inventory && d.kitFor && d.kitFor !== kit && !d.adventured) delete d.inventory;
    d.kitFor = kit;
    ensureGear(d, settingFor(d));
    const saved = roster.save(d);
    Object.assign(state, { view: 'sheet', sheet: { draft: saved, source: 'roster' }, draft: null, dirty: false, diceLog: [] });
    notify(`${saved.name} is ready for adventure.`);
    window.scrollTo(0, 0);
  },

  // Choices
  'pick-race'(el) {
    const d = state.draft;
    if (d.raceId !== el.dataset.id) { d.raceId = el.dataset.id; d.subraceId = null; }
    pruneSkillChoices(d, settingFor(d)); touch(); render();
  },
  'pick-subrace'(el) { state.draft.subraceId = el.dataset.id; touch(); render(); },
  'pick-class'(el) {
    const d = state.draft;
    d.classId = el.dataset.id;
    pruneSkillChoices(d, settingFor(d)); touch(); render();
  },
  'pick-bg'(el) {
    const d = state.draft;
    d.backgroundId = el.dataset.id;
    pruneSkillChoices(d, settingFor(d)); touch(); render();
  },
  skill(el) {
    const d = state.draft;
    const set = new Set(d.skillChoices);
    if (el.checked) set.add(el.dataset.id); else set.delete(el.dataset.id);
    d.skillChoices = [...set];
    pruneSkillChoices(d, settingFor(d)); touch(); render();
  },

  // Abilities
  method(el) {
    const d = state.draft;
    if (d.abilityMethod === el.dataset.id) return;
    setAbilityMethod(d, el.dataset.id); touch(); render();
  },
  'roll-one'(el) { rollAbilitySlots([Number(el.dataset.index)]); },
  'roll-all'() {
    const idx = state.draft.abilityRolls.map((r, i) => (r ? null : i)).filter((i) => i !== null);
    if (idx.length) rollAbilitySlots(idx);
  },
  reroll() {
    if (!confirmTwice('reroll', 'Throw away all six rolls and start again?')) return;
    const d = state.draft;
    d.abilityRolls = Array(6).fill(null);
    setAbilityMethod(d, 'roll'); touch(); render();
  },
  assign(el) {
    const d = state.draft;
    d.abilityAssignment[el.dataset.ability] = el.value === '' ? null : Number(el.value);
    syncBaseFromAssignment(d); touch(); render();
  },
  'auto-assign'() {
    const d = state.draft;
    const cls = settingFor(d).classes.find((c) => c.id === d.classId);
    d.abilityAssignment = autoAssign(abilityPool(d), cls?.abilityPriority ?? ABILITY_IDS);
    syncBaseFromAssignment(d); touch(); render();
  },
  pb(el) {
    const d = state.draft;
    const id = el.dataset.ability;
    const next = d.baseAbilities[id] + Number(el.dataset.delta);
    if (next < POINT_BUY.min || next > POINT_BUY.max) return;
    const trial = { ...d.baseAbilities, [id]: next };
    if (pointBuyTotal(trial) > POINT_BUY.budget) return;
    d.baseAbilities = trial; touch(); render();
  },

  // Dice tray
  check(el) { logRoll(el.dataset.label, Number(el.dataset.bonus)); },
  damage(el) {
    const r = roll(el.dataset.notation);
    const mod = r.modifier ? ` ${r.modifier > 0 ? '+' : '−'} ${Math.abs(r.modifier)}` : '';
    state.diceLog.unshift({ label: el.dataset.label, calc: `${el.dataset.notation}: [${r.rolls.join(', ')}]${mod}`, total: r.total, crit: '' });
    state.diceLog = state.diceLog.slice(0, 8);
    render();
  },
  async 'free-roll'(el) {
    const n = Number(el.dataset.sides) || 20;
    if (n === 20) { logRoll('d20', 0); return; }
    const r = rollDie(n);
    if (diceWanted(true)) await rollDice({ groups: [{ dice: [{ sides: n, value: r }] }], label: `d${n}`, verdict: String(r) });
    state.diceLog.unshift({ label: `d${n}`, calc: `d${n} (${r})`, total: r, crit: '' });
    state.diceLog = state.diceLog.slice(0, 8);
    render();
  },
  'clear-log'() { state.diceLog = []; render(); },
};

// ---------------------------------------------------------------------------
// Event wiring (delegated: one listener handles every button, even after re-render)
// ---------------------------------------------------------------------------

root.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el || el.disabled || el.matches('select, input')) return;
  actions[el.dataset.action]?.(el, e);
});

/** Inventory on the character sheet: equip, unequip and drop between adventures. */
root.addEventListener('click', (e) => {
  const el = e.target.closest('[data-inv]');
  if (!el || el.disabled || state.view !== 'sheet' || state.sheet?.source !== 'roster') return;
  const d = state.sheet.draft; const uid = el.dataset.uid;
  const inst = d.inventory?.find((x) => x.uid === uid);
  switch (el.dataset.inv) {
    case 'filter': state.inv.filter = el.dataset.filter; break;
    case 'doll': state.inv.doll = el.dataset.doll; break;
    case 'select': state.inv.selected = uid || null; state.inv.dropArm = null; break;
    case 'equip': { const r = equipItem(d, uid, el.dataset.slot); notify(r.message, r.ok ? 'ok' : 'bad'); break; }
    case 'unequip': {
      const slot = Object.entries(d.equipped ?? {}).find(([, u]) => u === uid)?.[0];
      if (slot && bagUsed(d) >= BAG_SLOTS) { notify(`Your pack is full (${BAG_SLOTS} of ${BAG_SLOTS}): drop or sell something first.`, 'bad'); return; }
      if (slot) unequipSlot(d, slot); break;
    }
    case 'use': {
      // Wounds stay between adventures; a potion (or herb, or waybread) can be taken at any time.
      const use = ITEMS_BY_ID[inst?.id]?.use;
      if (use?.kind !== 'heal') { notify(use?.kind === 'bandage' ? 'Bandages are applied in the field: use them in a dungeon.' : 'Use it in a dungeon.'); return; }
      if (!d.wounds) { notify('You are not wounded.'); return; }
      const r = roll(use.dice); const got = Math.min(d.wounds, r.total);
      d.wounds -= got; removeItem(d.inventory, uid, 1);
      if (d.injuries) { const e = { parts: d.injuries }; healParts(e, r.total); d.injuries = e.parts; }
      notify(`${itemName(inst)}: ${use.dice} = ${r.total}. Regained ${got} HP${d.wounds ? ` (still ${d.wounds} down)` : ' (whole again)'}.`, 'ok');
      break;
    }
    case 'to-safe': { const r = safe.store(d, uid); if (!r.ok) { notify(r.message, 'bad'); return; } state.inv.selected = null; notify(`${itemName(inst)} is in the safe.`, 'ok'); break; }
    case 'from-safe': {
      const it = safe.items().find((x) => x.uid === uid);
      const r = safe.take(d, uid, Infinity, deriveCharacter(d, settingFor(d)).scores.str);
      notify(r.ok ? `${itemName(it)} taken from the safe.` : r.message, r.ok ? 'ok' : 'bad'); if (!r.ok) return; break;
    }
    case 'drop':
      if (state.inv.dropArm !== uid) { state.inv.dropArm = uid; notify(`Click Drop again to throw away the ${itemName(inst).toLowerCase()}.`); return; }
      if (isEquipped(d, uid)) unequipSlot(d, Object.entries(d.equipped).find(([, u]) => u === uid)[0]);
      removeItem(d.inventory, uid); state.inv.selected = null; state.inv.dropArm = null;
      break;
    default:
  }
  state.sheet.draft = roster.save(d);
  render();
});

root.addEventListener('change', (e) => {
  const el = e.target.closest('[data-action]');
  if (el?.matches('select, input')) actions[el.dataset.action]?.(el, e);
});

/** Change part of the hero's look; it is saved with the hero. */
function setLook(patch) {
  if (!state.draft) return;
  state.draft.appearance = { ...resolveAppearance(state.draft), ...patch };
  touch(); render();
}

/** The colour slider updates the previews live without a re-render, so dragging stays smooth. */
root.addEventListener('input', (e) => {
  if (e.target.dataset?.look !== 'hue' || !state.draft) return;
  state.draft.appearance = { ...resolveAppearance(state.draft), hue: Number(e.target.value) };
  state.dirty = true;
  const f = appearanceFilter(state.draft.appearance);
  root.querySelectorAll('.look-editor img, .sheet-head .portrait img').forEach((img) => { img.style.filter = f; });
  const v = root.querySelector('.look-hue-val'); if (v) v.textContent = `${e.target.value}°`;
});

function musicTitle() {
  const st = music.state();
  if (!st.enabled) return 'Music off';
  return st.track ? `Now playing: ${st.track.title} by ${st.track.author} (CC0, OpenGameArt.org)` : 'Music on (starts after your first click)';
}
music.onChange(() => { const b = root.querySelector('[data-action="toggle-music"]'); if (b) b.title = musicTitle(); });
root.addEventListener('input', (e) => { if (e.target.dataset?.music === 'volume') music.setVolume(Number(e.target.value) / 100); });

/** Bestiary filters re-render only the results list, so the search box keeps focus. */
function updateBestiaryFilter(el) {
  const key = el.dataset.filter;
  state.bestiary[key] = el.type === 'checkbox' ? el.checked : el.value;
  const box = root.querySelector('#bestiary-results');
  if (box) box.innerHTML = bestiaryResults(state.bestiary);
}
root.addEventListener('input', (e) => { if (e.target.dataset?.filter) updateBestiaryFilter(e.target); });
root.addEventListener('change', (e) => { if (e.target.dataset?.filter && e.target.type !== 'search') updateBestiaryFilter(e.target); });

// Text fields update the draft without re-rendering, so typing keeps focus.
root.addEventListener('input', (e) => {
  const field = e.target.dataset?.field;
  if (field && state.draft) { state.draft[field] = e.target.value; state.dirty = true; }
});

root.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.matches('input[data-field]')) { e.preventDefault(); actions.next(); }
});

window.addEventListener('beforeunload', (e) => {
  if (state.view === 'wizard' && state.dirty) e.preventDefault();
});

render();
