/**
 * The campaign's world map: a painted map with the places the party knows, the roads between
 * them, the party's token and the quest journal. Click a place to travel there along the roads;
 * when you arrive, its picture and description appear with a button to go in. Each place is a
 * map of its own, played on the dungeon screen (see buildPlace).
 */
import { CAMPAIGNS_BY_ID } from '../content/campaigns/index.js';
import { newRun, travel, route, journal, questDone, npcView, npcChoose, locationEvent, parseLocation } from '../engine/campaign.js';
import { createStore, FORMATS } from '../engine/saves.js';
import { CODE, decodeArena } from '../engine/terrain.js';
import { play } from './audio.js';

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ICON = { tavern: '🍺', city: '🏘', palace: '🏰', church: '⛪', forest: '🌲', dungeon: '⛏', story: '🪦' };
const KIND = { tavern: 'Inn', city: 'Town', palace: 'Hall', church: 'Chapel', forest: 'Forest', dungeon: 'Dungeon', story: 'Tale' };

const store = () => createStore(localStorage, 'rpg.campaigns', FORMATS.campaigns);
export const loadRun = (id) => { try { return store().read()[id] ?? null; } catch { return null; } };
export function saveRun(id, run) { try { const all = store().read(); if (run) all[id] = run; else delete all[id]; store().write(all); } catch { /* storage blocked */ } }

/** The hooks a place on the dungeon screen uses to talk to the campaign (people, chests, quests). */
export function placeHooks(campaignId, locId) {
  const c = CAMPAIGNS_BY_ID[campaignId];
  const with_ = (fn) => { const run = loadRun(campaignId); const r = fn(run); if (r?.run) saveRun(campaignId, r.run); return r; };
  return {
    npcView: (npcId, wallet) => npcView(c, loadRun(campaignId), npcId, wallet),
    npcChoose: (npcId, i, wallet) => with_((run) => npcChoose(c, run, npcId, i, wallet)),
    event: (e) => with_((run) => locationEvent(c, run, locId, e))?.say ?? null,
  };
}

/** A place's map as an arena setup for the dungeon screen (people as 'npc', foes, chests, exits). */
export function buildPlace(campaignId, locId) {
  const c = CAMPAIGNS_BY_ID[campaignId]; const loc = c.locations[locId]; const run = loadRun(campaignId);
  const p = parseLocation(loc, (t) => CODE[t] ?? '.');
  const map = decodeArena(p.terrainRows);
  map.exit = p.exits[0] ?? null; map.exits = p.exits; // drawn on the map, and where the party leaves
  const heroes = run.party.map((id, i) => ({ id, pos: p.heroes[i] ?? nearSpot(map, p.heroes[0], i) }));
  const foes = [
    ...p.npcs.map((n) => ({ statId: n.stat, pos: n.pos, facing: n.facing, side: 'npc', npcId: n.id, name: n.name })),
    // Foes a place has already been cleared of stay gone.
    ...(run.flags.includes(`cleared:${locId}`) ? [] : p.foes),
  ];
  return {
    name: loc.name, map, heroes, foes, chests: p.chests.filter((ch) => !run.flags.includes(`opened:${locId}:${ch.id}`)),
    reveal: loc.reveal !== false, carry: run.wounds ? { members: run.wounds } : null,
    location: { id: locId, kind: loc.kind, music: loc.music, exits: p.exits },
  };
}
function nearSpot(map, from, i) {
  const ring = [[1, 0], [0, 1], [-1, 0], [1, 1], [-1, 1], [0, -1], [2, 0], [-2, 0]];
  for (const [dx, dy] of ring.slice(i - 1)) { const x = from.x + dx; const y = from.y + dy; if (map.tiles[y]?.[x] !== undefined && map.terrain[y][x] !== 'wall') return { x, y }; }
  return { ...from };
}

/**
 * @param ctx { campaignId, heroes: [{id, label, look}], onEnter(locId), onStory(storyId), onLeave(), notify }
 */
export function mountCampaign(host, ctx) {
  const c = CAMPAIGNS_BY_ID[ctx.campaignId];
  let run = loadRun(c.id);
  const pick = new Set(ctx.heroes.slice(0, 1).map((h) => h.id));
  let selected = run?.at ?? null; let moving = false;

  const pos = (id) => c.locations[id];
  const look = () => ctx.heroes.find((h) => h.id === run?.party?.[0])?.look;

  function render() {
    if (!run) { host.innerHTML = startHtml(); return; }
    const known = run.discovered.filter((id) => pos(id));
    const roads = c.roads.filter(([a, b]) => known.includes(a) && known.includes(b));
    const here = pos(run.at); const sel = selected && pos(selected);
    const steps = journal(c, run);
    host.innerHTML = `<div class="cmp">
      <header class="cmp-head">
        <div><p class="cmp-kicker">Campaign</p><h1>${esc(c.title)}</h1></div>
        <div class="row wrap"><button class="btn small ghost" data-cm="leave">← Adventures</button><button class="btn small ghost" data-cm="restart">Start over</button></div>
      </header>
      <div class="cmp-body">
        <div class="cmp-map" style="aspect-ratio:${c.map.w}/${c.map.h}">
          <img src="${esc(c.map.image)}" alt="Painted map of the lands around Ashford" draggable="false">
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" class="cmp-roads" aria-hidden="true">
            ${roads.map(([a, b]) => `<line x1="${pos(a).x}" y1="${pos(a).y}" x2="${pos(b).x}" y2="${pos(b).y}"/>`).join('')}
          </svg>
          ${known.map((id) => { const l = pos(id); return `<button class="cmp-pin ${id === run.at ? 'here' : ''} ${id === selected ? 'sel' : ''} ${run.visited.includes(id) ? '' : 'new'}" style="left:${l.x}%;top:${l.y}%" data-cm="pick" data-id="${id}" aria-label="${esc(l.name)}">
            <span class="cmp-ico">${ICON[l.kind] ?? '•'}</span><span class="cmp-name">${esc(l.name)}</span></button>`; }).join('')}
          <div class="cmp-party" style="left:${here.x}%;top:${here.y}%">${look()?.url ? `<img src="${esc(look().url)}" alt="Your party">` : '★'}</div>
        </div>
        <aside class="cmp-side">
          ${sel ? `<section class="cmp-place">
            <img src="${esc(sel.vignette)}" alt="">
            <div class="cmp-place-text"><p class="cmp-kicker">${KIND[sel.kind] ?? ''}${selected === run.at ? ' · you are here' : ''}</p><h2>${esc(sel.name)}</h2><p>${esc(sel.blurb)}</p>
            ${selected === run.at
    ? `<button class="btn primary big" data-cm="enter">${sel.story ? 'Begin the tale' : `Enter ${esc(sel.name)}`}</button>`
    : route(c, run, selected) ? `<button class="btn primary big" data-cm="travel">Travel here</button><p class="small muted">By road: ${route(c, run, selected).map((id) => esc(pos(id).name)).join(' → ')}</p>`
      : '<p class="small muted">No known road leads there yet.</p>'}</div>
          </section>` : '<p class="muted">Click a place on the map.</p>'}
          <section class="cmp-quest"><h3>📜 ${esc(c.quest.title)}</h3>
            <ol>${steps.map((st) => `<li class="${st.state}">${st.state === 'done' ? '✔' : st.state === 'current' ? '➤' : '·'} ${esc(st.text)}</li>`).join('')}</ol>
            ${questDone(c, run) ? '<p class="cmp-done">Quest complete! The Barrow Downs await, if you dare.</p>' : ''}
          </section>
          ${run.log.length ? `<details class="cmp-log"><summary>What you have heard (${run.log.length})</summary><ol>${run.log.slice().reverse().map((l) => `<li>${esc(l)}</li>`).join('')}</ol></details>` : ''}
        </aside>
      </div></div>`;
  }

  function startHtml() {
    return `<div class="cmp cmp-start">
      <header class="cmp-head"><div><p class="cmp-kicker">Campaign · levels ${esc(c.levels)}</p><h1>${esc(c.title)}</h1></div><button class="btn small ghost" data-cm="leave">← Adventures</button></header>
      <img class="cmp-start-map" src="${esc(c.map.image)}" alt="">
      <p class="cmp-blurb">${esc(c.blurb)}</p>
      <fieldset class="story-party"><legend>Who goes? (up to 4)</legend>
        ${ctx.heroes.map((h) => `<label class="btn party-pick ${pick.has(h.id) ? 'on' : ''}"><input type="checkbox" data-cm="pick-hero" value="${esc(h.id)}" ${pick.has(h.id) ? 'checked' : ''}> ${esc(h.label)}</label>`).join('')}
      </fieldset>
      <button class="btn primary big" data-cm="begin" ${pick.size ? '' : 'disabled'}>Set out</button></div>`;
  }

  /** Walk the party token along the route, square by square of the painted map. */
  async function walk(path) {
    moving = true;
    const token = host.querySelector('.cmp-party');
    for (const id of path.slice(1)) {
      const l = pos(id); token.style.left = `${l.x}%`; token.style.top = `${l.y}%`;
      play('door-open', { volume: 0.15 });
      await new Promise((r) => setTimeout(r, 650));
    }
    moving = false;
  }

  host.addEventListener('change', (e) => {
    const el = e.target.closest('[data-cm="pick-hero"]'); if (!el) return;
    if (el.checked && pick.size >= 4) { el.checked = false; ctx.notify?.('Four heroes at most.'); return; }
    if (el.checked) pick.add(el.value); else pick.delete(el.value);
    render();
  });
  host.addEventListener('click', async (e) => {
    const el = e.target.closest('[data-cm]'); if (!el || moving || el.dataset.cm === 'pick-hero') return;
    const a = el.dataset.cm;
    if (a === 'leave') ctx.onLeave?.();
    if (a === 'restart') { saveRun(c.id, null); run = null; selected = null; render(); }
    if (a === 'begin') { run = { ...newRun(c), party: [...pick] }; saveRun(c.id, run); selected = run.at; render(); }
    if (a === 'pick') { selected = el.dataset.id; render(); }
    if (a === 'travel') {
      const r = travel(c, run, selected); if (!r.path) return;
      await walk(r.path); run = r.run; saveRun(c.id, run); render();
    }
    if (a === 'enter') {
      const loc = pos(run.at);
      if (loc.story) ctx.onStory?.(loc.story); else ctx.onEnter?.(run.at);
    }
  });
  render();
}

/** After a place: remember wounds, and which chests were opened and foes cleared. */
export function leftPlace(campaignId, locId, state) {
  const run = loadRun(campaignId); if (!run || !state) return;
  const { opened = [], cleared = false } = state;
  run.wounds = state.members ?? run.wounds;
  if (state.ids?.length) run.party = state.ids; // a ready-made hero adopted on the way has a new id
  run.flags = [...new Set([...run.flags, ...opened.map((id) => `opened:${locId}:${id}`), ...(cleared ? [`cleared:${locId}`] : [])])];
  saveRun(campaignId, run);
}
