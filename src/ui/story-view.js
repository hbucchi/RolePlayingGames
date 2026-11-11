/**
 * Playing a story (src/content/stories): scene text, choices as buttons, skill checks rolled with
 * the party's best bonus, rewards for the party, and battles fought on the arena engine.
 * Progress is saved per story (versioned, engine/saves.js), so a tale can be left and resumed.
 */
import { STORIES_BY_ID } from '../content/stories/index.js';
import { startStory, sceneOf, choicesFor, choose, battleOver } from '../engine/story.js';
import { createStore, FORMATS } from '../engine/saves.js';
import { SKILLS } from '../engine/skills.js';
import { createArenaMap } from '../engine/terrain.js';
import { rollDie } from '../engine/dice.js';
import { makeItem, addItem, formatCoins, itemName } from '../engine/items.js';
import { play } from './audio.js';

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const skillName = (id) => SKILLS.find((s) => s.id === id)?.name ?? id;
const store = () => createStore(localStorage, 'rpg.stories', FORMATS.stories);
const loadAll = () => { try { return store().read(); } catch { return {}; } };
const saveRun = (id, run) => { const all = loadAll(); if (run) all[id] = run; else delete all[id]; try { store().write(all); } catch { /* storage blocked */ } };
export const savedRun = (id) => loadAll()[id] ?? null;

/** Apply a scene's rewards: XP to every hero, coins and items to the leader. Returns lines for the page. */
async function applyEffects(effects, partyIds, api) {
  if (!effects.length) return [];
  const drafts = partyIds.map((id) => api.load(id)).filter(Boolean);
  const lines = [];
  for (const e of effects) {
    if (e.xp) {
      for (const d of drafts) { const r = api.gainXp(d, e.xp); if (r.to > r.from) await api.levelUp?.(d, r.from, r.to); }
      lines.push(`Each hero gains ${e.xp} XP.`);
    }
    if (e.coins && drafts[0]) { drafts[0].coins = (drafts[0].coins ?? 0) + e.coins; lines.push(`${drafts[0].name} takes ${formatCoins(e.coins)}.`); }
    if (e.item && drafts[0]) { addItem(drafts[0].inventory ??= [], makeItem(e.item, e.qty ?? 1)); lines.push(`${drafts[0].name} takes ${itemName({ id: e.item })}.`); }
  }
  const saved = drafts.map((d) => api.save(d));
  return { lines, ids: saved.map((d, i) => d?.id ?? partyIds[i]) };
}

/** The battle of a scene, as an arena setup: party along the south wall, foes along the north. */
export function battleSetup(story, run) {
  const b = sceneOf(story, run.progress).battle;
  const w = 12; const h = 10;
  const map = createArenaMap(w, h, b.terrain ?? 'cobbles');
  const heroes = run.party.map((id, i) => ({ id, pos: { x: 4 + i, y: h - 3 } }));
  const foes = b.foes.map((statId, i) => ({ uid: i + 1, statId, pos: { x: Math.round((w / (b.foes.length + 1)) * (i + 1)), y: 2 }, facing: 4, side: 'enemy' }));
  return { name: story.title, map, heroes, foes, story: true };
}

/** A battle ended: go to the scene for winning or losing, and apply its rewards. */
export async function resolveBattle(storyId, won, api) {
  const story = STORIES_BY_ID[storyId]; const run = savedRun(storyId);
  if (!story || !run) return;
  const { progress, effects } = battleOver(story, run.progress, won);
  const r = await applyEffects(effects, run.party, api);
  saveRun(storyId, { ...run, progress, party: r.ids ?? run.party, gained: r.lines ?? [] });
}

/**
 * @param ctx { storyId, heroes: [{id, label, look}], api: {load, derive, save, gainXp}, onFight(setup), onLeave(), notify }
 */
export function mountStory(host, ctx) {
  const story = STORIES_BY_ID[ctx.storyId];
  let run = savedRun(story.id);
  let pick = new Set(ctx.heroes.slice(0, 1).map((h) => h.id));
  let lastRoll = null;

  const best = (skill) => {
    let top = null;
    for (const id of run.party) {
      const d = ctx.api.load(id); if (!d) continue;
      const st = ctx.api.derive(d); const bonus = st.skills?.[skill] ?? 0;
      if (!top || bonus > top.bonus) top = { name: st.name, bonus };
    }
    return top ?? { name: 'The party', bonus: 0 };
  };

  function render() {
    if (!run) { host.innerHTML = startHtml(); return; }
    const scene = sceneOf(story, run.progress);
    const choices = choicesFor(story, run.progress);
    host.innerHTML = `<article class="story">
      <header class="story-head"><h1>${esc(story.title)}</h1>
        <div class="row wrap"><button class="btn small ghost" data-st="leave">← Adventures</button><button class="btn small ghost" data-st="restart">Start over</button></div></header>
      ${run.progress.log.length ? `<details class="story-log"><summary>The tale so far (${run.progress.log.length})</summary><ol>${run.progress.log.map((l) => `<li>${esc(l)}</li>`).join('')}</ol></details>` : ''}
      ${lastRoll ? `<p class="story-roll ${lastRoll.success ? 'good' : 'bad'}">🎲 ${esc(lastRoll.text)}</p>` : ''}
      <div class="story-text"><p>${esc(scene.text)}</p></div>
      ${run.gained?.length ? `<ul class="story-gains">${run.gained.map((g) => `<li>✦ ${esc(g)}</li>`).join('')}</ul>` : ''}
      <div class="story-choices">
        ${choices.map((c) => {
    const check = c.check ? (() => { const b = best(c.check.skill); return `<small>${esc(skillName(c.check.skill))} check, DC ${c.check.dc} · ${esc(b.name)} rolls (${b.bonus >= 0 ? '+' : ''}${b.bonus})</small>`; })() : '';
    return `<button class="btn story-choice" data-st="choose" data-i="${c.index}"><span>${esc(c.text)}</span>${check}</button>`;
  }).join('')}
        ${scene.battle ? `<button class="btn primary big story-choice" data-st="fight"><span>⚔ Fight: ${esc(scene.battle.foes.join(', ').replace(/-/g, ' '))}</span></button>` : ''}
        ${scene.end ? `<div class="story-end ${scene.end}"><h2>${{ victory: 'The tale is told', defeat: 'Defeated', retreat: 'You turned back' }[scene.end]}</h2>
          <div class="row wrap"><button class="btn primary" data-st="restart">Play it again</button><button class="btn" data-st="leave">Back to Adventures</button></div></div>` : ''}
      </div></article>`;
  }

  function startHtml() {
    return `<article class="story">
      <header class="story-head"><h1>${esc(story.title)}</h1><button class="btn small ghost" data-st="leave">← Adventures</button></header>
      <p class="story-text">${esc(story.blurb)}</p>
      <p class="muted small">Levels ${esc(story.levels)} · ${esc(story.length)}</p>
      <fieldset class="story-party"><legend>Who goes? (up to 4)</legend>
        ${ctx.heroes.map((h) => `<label class="btn party-pick ${pick.has(h.id) ? 'on' : ''}"><input type="checkbox" data-st="pick" value="${esc(h.id)}" ${pick.has(h.id) ? 'checked' : ''}> ${esc(h.label)}</label>`).join('')}
      </fieldset>
      <button class="btn primary big" data-st="begin" ${pick.size ? '' : 'disabled'}>Begin the tale</button></article>`;
  }

  host.addEventListener('change', (e) => {
    const el = e.target.closest('[data-st="pick"]'); if (!el) return;
    if (el.checked && pick.size >= 4) { el.checked = false; ctx.notify?.('Four heroes at most.'); return; }
    if (el.checked) pick.add(el.value); else pick.delete(el.value);
    render();
  });
  host.addEventListener('click', async (e) => {
    const el = e.target.closest('[data-st]'); if (!el || el.dataset.st === 'pick') return;
    const a = el.dataset.st;
    if (a === 'leave') { ctx.onLeave?.(); return; }
    if (a === 'restart') { saveRun(story.id, null); run = null; lastRoll = null; render(); return; }
    if (a === 'begin') { run = { progress: startStory(story), party: [...pick], gained: [] }; saveRun(story.id, run); render(); return; }
    if (a === 'fight') { ctx.onFight?.(battleSetup(story, run)); return; }
    if (a === 'choose') {
      lastRoll = null;
      const rollCheck = (skill, dc) => {
        const b = best(skill); const d = rollDie(20); const total = d + b.bonus; const success = total >= dc;
        play('dice', { volume: 0.6 });
        lastRoll = { success, text: `${b.name}: ${skillName(skill)} d20 (${d}) ${b.bonus >= 0 ? '+' : '−'} ${Math.abs(b.bonus)} = ${total} vs DC ${dc}: ${success ? 'success' : 'failure'}` };
        return { success, text: success ? 'success' : 'failure' };
      };
      const { progress, effects } = choose(story, run.progress, Number(el.dataset.i), { rollCheck });
      const r = await applyEffects(effects, run.party, ctx.api);
      run = { ...run, progress, party: r.ids ?? run.party, gained: r.lines ?? [] };
      saveRun(story.id, run); render();
      host.scrollIntoView?.({ block: 'start' });
    }
  });
  render();
}
