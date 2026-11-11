/**
 * UI layer. Plain DOM rendering: every state change calls render(), which rebuilds the
 * view from `state`. All game rules live in src/engine; this file only displays them.
 */
import {
  ABILITIES, ABILITY_IDS, ABILITY_METHODS, POINT_BUY, abilityModifier, autoAssign,
  formatModifier, pointBuyScoreCost, pointBuyTotal,
} from '../engine/abilities.js';
import {
  STEPS, abilityPool, deriveCharacter, grantedSkills, isComplete, newDraft, pruneSkillChoices,
  resolveRace, setAbilityMethod, skillName, syncBaseFromAssignment, validateStep, makeId, ensureGear, gainXp, pendingLevelUps,
} from '../engine/character.js';
import { XP_FOR_LEVEL, xpProgress, startingWealth } from '../engine/progression.js';
import { slotsFor } from '../engine/magic.js';
import { equipItem, unequipSlot, removeItem, isEquipped, itemName, formatCoins } from '../engine/items.js';
import { ITEMS_BY_ID } from '../content/items/catalogue.js';
import { inventoryHtml, coinsHtml } from './inventory-view.js';
import { roll, rollAbilityScore, rollDie } from '../engine/dice.js';
import { SKILLS } from '../engine/skills.js';
import { createRoster, exportCharacter, importCharacter } from '../engine/storage.js';
import { DEFAULT_SETTING_ID, getSetting } from '../content/registry.js';
import { mountDungeon } from './dungeon-view.js';
import { mountArenaBuilder } from './arena-builder.js';
import { mountStory, resolveBattle, savedRun } from './story-view.js';
import { levelUpDialog } from './level-up.js';
import { bestiaryView, bestiaryResults, defaultBestiaryFilters, monsterView } from './bestiary-view.js';
import { BESTIARY_BY_ID } from '../content/bestiary/index.js';
import { setSetting, settingsControls } from './settings.js';
import { heroLook, resolveAppearance, PORTRAITS, PORTRAIT_VARIANTS, portraitUrl, STYLES, FRAMES, VOICES, appearanceFilter } from '../content/media.js';
import { play, isMuted, setMuted } from './audio.js';
import * as music from './music.js';

const setting = getSetting(DEFAULT_SETTING_ID);
const roster = createRoster();
const root = document.getElementById('app');
const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

const state = {
  view: 'home', // home | start | wizard | sheet | dungeon | monster
  start: { mode: 'standard', level: 5 },
  inv: { selected: null, filter: 'all', dropArm: null },
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

function render() {
  const key = focusKey(document.activeElement);
  const views = {
    wizard: wizardView,
    start: startView,
    sheet: sheetView,
    dungeon: () => '<div id="dungeon-host" class="dungeon-host"></div>',
    arena: () => `<div class="row sheet-actions"><button class="btn ghost" data-action="home">← Adventures</button><h1 class="arena-title">Arena</h1></div>
      <p class="muted">Build a battlefield, choose who fights, and play a practice bout. Arena bouts never cost your heroes anything, and give no XP or loot.</p>
      <div id="arena-host"></div>`,
    'arena-fight': () => '<div id="dungeon-host" class="dungeon-host"></div>',
    story: () => '<div id="story-host"></div>',
    'story-fight': () => '<div id="dungeon-host" class="dungeon-host"></div>',
    monster: () => `${monsterView(BESTIARY_BY_ID[state.monsterId])}${diceTray()}`,
  };
  renderInto((views[state.view] ?? homeView)());
  if (!['dungeon', 'arena-fight', 'story-fight'].includes(state.view)) music.setMood('menu');
  if (state.view === 'dungeon') mountDungeon(root.querySelector('#dungeon-host'), { heroes: explorerHeroes(), api: heroApi });
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
  if (state.view === 'story') {
    mountStory(root.querySelector('#story-host'), {
      storyId: state.storyId, heroes: explorerHeroes(), api: heroApi, notify: toast,
      onFight: (setup) => { state.storyFight = setup; state.view = 'story-fight'; render(); window.scrollTo(0, 0); },
      onLeave: () => { Object.assign(state, { view: 'home', tab: 'adventures' }); render(); },
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
      ${state.view === 'home' ? `
      <nav class="tabs" role="tablist">
        ${tabButton('heroes', 'Heroes')}${tabButton('adventures', 'Adventures')}${tabButton('bestiary', 'Bestiary')}
      </nav>` : ''}
    </header>
    <main>${body}</main>
    ${state.notice ? `<div class="toast ${state.notice.kind}" role="status">${esc(state.notice.text)}</div>` : ''}
  `;
}

const tabButton = (id, label) => `<button role="tab" aria-selected="${state.tab === id}" class="tab ${state.tab === id ? 'active' : ''}" data-action="tab" data-tab="${id}">${label}</button>`;

// ---- Home ------------------------------------------------------------------

function homeView() {
  if (state.tab === 'adventures') return adventuresView();
  if (state.tab === 'bestiary') return bestiaryView(state.bestiary);
  const heroes = roster.list();
  return `
    <section class="hero-banner">
      <h1>Forge a hero for the Westlands</h1>
      <p>${esc(setting.subtitle)}</p>
      <div class="row">
        <button class="btn primary big" data-action="new">Create a new hero</button>
        <label class="btn ghost">Import hero file<input type="file" accept="application/json,.json" data-action="import" hidden></label>
      </div>
      <details class="home-settings" open><summary>⚙ Settings</summary><div class="home-settings-grid">${settingsControls('data-action="setting"', undefined, 'home')}</div></details>
    </section>

    <section>
      <h2>Your company</h2>
      ${heroes.length ? `<div class="card-grid">${heroes.map((d) => heroCard(d, 'roster')).join('')}</div>`
    : '<p class="muted empty">No heroes yet. Create one, or adopt a ready-made hero below.</p>'}
    </section>

    <section>
      <h2>Ready-made heroes</h2>
      <p class="muted">Jump straight in. Adopting a hero copies it into your company so you can change it.</p>
      <div class="card-grid">${setting.premades.map((p) => heroCard(syncBaseFromAssignment(structuredClone(p)), 'premade')).join('')}</div>
    </section>`;
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
      ${complete ? `<dl class="mini-stats"><div><dt>HP</dt><dd>${c.maxHp}</dd></div><div><dt>AC</dt><dd>${c.ac}</dd></div>
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

function adventuresView() {
  return `
    <section>
      <h1>Adventures</h1>
      <p class="muted">Choose a tale and bring your company. Full adventures are on the way; the sandbox lets you explore generated dungeons now.</p>
      <div class="card-grid">
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
    : playable ? `<button class="btn small primary" data-action="enter-dungeon" data-id="${esc(a.id)}">Enter</button>` : '<button class="btn small" disabled>Begin</button>'}
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
          <div><dt>Speed</dt><dd>${resolved.speed} ft</dd></div>
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
        ${[['Armour Class', c.ac], ['Hit Points', c.maxHp], ['Speed', `${c.speed} ft`], ['Initiative', fmt(c.initiative)],
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
              <tr><td>${esc(a.name)}${a.properties.length ? `<br><small class="muted">${esc(a.properties.join(', '))}</small>` : ''}</td>
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
  const slots = c.caster ? slotsFor(c.caster.type, c.level) : [];
  const row = (x) => `<li><strong>${esc(x.name)}</strong> <span class="tag">${x.kind === 'spell' ? (x.level ? `${ord(x.level)}-level spell` : 'cantrip') : x.passive ? 'always on' : Number.isFinite(x.maxUses) ? `${x.maxUses} per ${x.period} rest` : 'ability'}</span>${x.concentration ? ' <span class="tag">concentration</span>' : ''}<br>${esc(x.desc)}</li>`;
  return `<section class="panel sheet-magic">
    <h3>Spells &amp; abilities</h3>
    ${c.caster ? `<p>Spellcasting ability <b>${c.caster.ability.toUpperCase()}</b> · save DC <b>${c.caster.dc}</b> (8 + proficiency + modifier) · spell attack <b>${fmt(c.caster.attack)}</b></p>
      ${slots.length ? `<p class="slots">${slots.map((n, i) => `<span class="slot-lvl">${ord(i + 1)}: ${'●'.repeat(n)}</span>`).join('')}</p>` : '<p class="muted small">Spell slots arrive at level 2.</p>'}` : ''}
    ${c.attacksPerAction > 1 ? `<p>Attacks per Attack action: <b>${c.attacksPerAction}</b></p>` : ''}
    <ul class="traits">${[...m.abilities, ...m.spells].map(row).join('')}</ul>
    ${m.locked.length ? `<details><summary>Coming at higher levels (${m.locked.length})</summary><ul class="traits locked">${m.locked.map((x) => `<li><strong>Level ${x.unlock}: ${esc(x.name)}</strong> <span class="tag">${x.kind === 'spell' ? (x.level ? `${ord(x.level)}-level spell` : 'cantrip') : 'ability'}</span><br>${esc(x.desc)}</li>`).join('')}</ul></details>` : ''}
  </section>`;
}

function diceTray() {
  return `
    <aside class="dice-log" aria-live="polite">
      <div class="row"><strong>Dice tray</strong><span class="spacer"></span>
        <button class="btn small ghost" data-action="free-roll" data-notation="1d20">d20</button>
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
    ${source === 'roster' ? `<section class="panel sheet-inv">${xpBarHtml(c)}${inventoryHtml(draft, { str: c.scores.str, selected: state.inv.selected, filter: state.inv.filter, title: 'Inventory' })}</section>`
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
    speed: c.speed, ac: c.ac, maxHp: c.maxHp, dexMod: c.mods.dex, str: c.scores.str, attacks: c.attacks,
    look: heroLook(d), skills: Object.fromEntries(c.skills.map((sk) => [sk.id, sk.bonus])),
    saves: Object.fromEntries(c.savingThrows.map((st) => [st.ability, st.bonus])),
    race: c.race?.id, languages: c.languages, wis: c.mods.wis, int: c.mods.int, toolBonus: c.toolBonus, gearNotes: c.gearNotes,
    keenSearch: c.features.some((f) => /Burglar's Eye/.test(f.name)), // advantage when searching
    magic: c.magic, caster: c.caster, attacksPerAction: c.attacksPerAction, cls: c.cls?.id, hitDie: c.hitDie, conMod: c.mods.con, mods: c.mods,
    sneak: c.cls?.id === 'burglar', uncanny: c.cls?.id === 'burglar' && c.level >= 5, evasion: c.cls?.id === 'burglar' && c.level >= 7,
    stealthDis: c.gearNotes.some((n) => /noisy/.test(n)),
  };
}

const heroApi = {
  load(id) {
    const d = roster.get(id) ?? findHero('premade', id);
    return d ? ensureGear(structuredClone(d), settingFor(d)) : null;
  },
  derive: dungeonStats,
  gainXp,
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

function logRoll(label, bonus) {
  const r = rollDie(20);
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
    if (['dungeon', 'arena', 'arena-fight', 'story', 'story-fight'].includes(state.view)) state.tab = 'adventures';
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
  'start-story'(el) { Object.assign(state, { view: 'story', storyId: el.dataset.id }); render(); window.scrollTo(0, 0); },
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
  'free-roll'() { logRoll('d20', 0); },
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
    case 'select': state.inv.selected = uid || null; state.inv.dropArm = null; break;
    case 'equip': { const r = equipItem(d, uid, el.dataset.slot); notify(r.message, r.ok ? 'ok' : 'bad'); break; }
    case 'unequip': { const slot = Object.entries(d.equipped ?? {}).find(([, u]) => u === uid)?.[0]; if (slot) unequipSlot(d, slot); break; }
    case 'use': notify(ITEMS_BY_ID[inst?.id]?.use?.kind === 'heal' || ITEMS_BY_ID[inst?.id]?.use?.kind === 'bandage' ? 'You are at full health between adventures. Use it in a dungeon.' : 'Use it in a dungeon.'); return;
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
