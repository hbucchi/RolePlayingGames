/**
 * The level-up pop-up: shown the moment a hero gains a level. It lists what the new level brings
 * (hit points, proficiency, attacks, spell slots, new spells and abilities) and asks for the
 * choices the level offers: an Ability Score Improvement (+2 to one ability or +1 to two) and,
 * at some levels, a new skill. The summary updates as the player chooses; OK confirms.
 */
import { applyLevelUp, levelChoices, levelUpSummary, deriveCharacter } from '../engine/character.js';
import { ABILITY_IDS } from '../engine/abilities.js';
import { SKILLS } from '../engine/skills.js';
import { play } from './audio.js';

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ABILITY_NAMES = { str: 'Strength', dex: 'Dexterity', con: 'Constitution', int: 'Intelligence', wis: 'Wisdom', cha: 'Charisma' };

/** Open the pop-up. Resolves with the draft (choices recorded) when the player clicks OK. */
export function levelUpDialog({ draft, setting, from, to }) {
  const levels = [];
  for (let lv = from + 1; lv <= to; lv++) { const c = levelChoices(lv); if ((c.asi || c.skill) && !draft.levelUps?.[lv]) levels.push(lv); }
  const picks = Object.fromEntries(levels.map((lv) => [lv, { abilities: {}, skill: null }]));
  return new Promise((resolve) => {
    const back = document.createElement('div');
    back.className = 'lu-backdrop';
    back.innerHTML = '<div class="lu-card" role="dialog" aria-modal="true" aria-labelledby="lu-title"></div>';
    document.body.append(back);
    const card = back.querySelector('.lu-card');
    const prevFocus = document.activeElement;

    /** The draft with the choices made so far (for the live summary). */
    const preview = () => {
      const d = structuredClone(draft);
      d.levelUps = { ...(d.levelUps ?? {}) };
      for (const lv of levels) d.levelUps[lv] = { abilities: picks[lv].abilities, skill: picks[lv].skill };
      return d;
    };
    const pointsLeft = (lv) => 2 - Object.values(picks[lv].abilities).reduce((a, b) => a + b, 0);
    const complete = () => levels.every((lv) => {
      const c = levelChoices(lv);
      return (!c.asi || pointsLeft(lv) === 0) && (!c.skill || picks[lv].skill);
    });

    function render() {
      const d = preview();
      const sum = levelUpSummary(d, setting, from, to);
      const name = deriveCharacter(d, setting).name;
      card.innerHTML = `
        <header class="lu-head"><span class="lu-burst" aria-hidden="true">✦</span>
          <div><p class="lu-kicker">Level up!</p><h2 id="lu-title">${esc(name)} reaches level ${to}</h2></div></header>
        ${levels.map((lv) => choiceHtml(lv, d)).join('')}
        <section class="lu-summary"><h3>What changes</h3>
          ${sum.lines.length ? `<table class="lu-table"><tbody>${sum.lines.map((l) => `<tr><th>${esc(l.label)}</th><td>${esc(l.from)}</td><td aria-hidden="true">→</td><td><b>${esc(l.to)}</b></td></tr>`).join('')}</tbody></table>` : ''}
          ${sum.newMagic.length ? `<p><b>New spells and abilities:</b> ${sum.newMagic.map(esc).join(', ')}</p>` : ''}
          ${sum.newSkills.length ? `<p><b>New skills:</b> ${sum.newSkills.map(esc).join(', ')}</p>` : ''}
        </section>
        <footer class="lu-foot"><span class="muted small">${complete() ? 'All set.' : 'Make your choices above to continue.'}</span>
          <button class="btn primary big" data-lu="ok" ${complete() ? '' : 'disabled'}>OK</button></footer>`;
    }

    function choiceHtml(lv, d) {
      const c = levelChoices(lv);
      const before = deriveCharacter({ ...d, level: lv - 1, levelUps: { ...d.levelUps, [lv]: undefined } }, setting);
      let html = '';
      if (c.asi) {
        const left = pointsLeft(lv);
        html += `<section class="lu-choice"><h3>Level ${lv}: Ability Score Improvement</h3>
          <p class="small muted">Spend 2 points: +2 to one ability, or +1 to two. No score can go above 20.</p>
          <p class="lu-points">Points left: <b>${left}</b></p>
          <div class="lu-abilities">${ABILITY_IDS.map((id) => {
    const add = picks[lv].abilities[id] ?? 0; const now = before.scores[id];
    return `<div class="lu-ab ${add ? 'on' : ''}"><span class="lu-ab-name" title="${ABILITY_NAMES[id]}">${id.toUpperCase()}</span>
              <button class="btn icon small" data-lu="minus" data-lv="${lv}" data-id="${id}" ${add ? '' : 'disabled'} aria-label="Remove a point from ${ABILITY_NAMES[id]}">−</button>
              <b class="lu-score">${now + add}</b>
              <button class="btn icon small" data-lu="plus" data-lv="${lv}" data-id="${id}" ${left && add < 2 && now + add < 20 ? '' : 'disabled'} aria-label="Add a point to ${ABILITY_NAMES[id]}">+</button></div>`;
  }).join('')}</div></section>`;
      }
      if (c.skill) {
        const open = SKILLS.filter((sk) => !before.skills.find((x) => x.id === sk.id)?.proficient);
        html += `<section class="lu-choice"><h3>Level ${lv}: Train a new skill</h3>
          <p class="small muted">Your hero becomes proficient: add your proficiency bonus to it from now on.</p>
          <div class="lu-skills">${open.map((sk) => `<button class="btn small lu-skill ${picks[lv].skill === sk.id ? 'primary' : ''}" data-lu="skill" data-lv="${lv}" data-id="${sk.id}" aria-pressed="${picks[lv].skill === sk.id}">${esc(sk.name)} <small>${sk.ability.toUpperCase()}</small></button>`).join('')}</div></section>`;
      }
      return html;
    }

    card.addEventListener('click', (e) => {
      const el = e.target.closest('[data-lu]'); if (!el || el.disabled) return;
      const lv = Number(el.dataset.lv); const id = el.dataset.id;
      if (el.dataset.lu === 'plus') picks[lv].abilities[id] = (picks[lv].abilities[id] ?? 0) + 1;
      if (el.dataset.lu === 'minus') { picks[lv].abilities[id] -= 1; if (!picks[lv].abilities[id]) delete picks[lv].abilities[id]; }
      if (el.dataset.lu === 'skill') picks[lv].skill = id;
      if (el.dataset.lu === 'ok') {
        for (const l of levels) applyLevelUp(draft, setting, l, { abilities: levelChoices(l).asi ? picks[l].abilities : null, skill: picks[l].skill });
        back.remove(); prevFocus?.focus?.({ preventScroll: true });
        resolve(draft);
        return;
      }
      const sel = el.dataset.lu === 'ok' ? null : `[data-lu="${el.dataset.lu}"][data-lv="${lv}"][data-id="${id}"]`;
      render();
      card.querySelector(sel)?.focus();
    });
    render();
    play('level-up', { volume: 0.8 });
    card.querySelector('button:not([disabled])')?.focus();
  });
}
