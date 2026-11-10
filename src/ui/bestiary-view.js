/** Bestiary screens: browsable catalogue and full stat blocks. Pure HTML builders. */
import { ABILITIES, ABILITY_IDS, formatModifier } from '../engine/abilities.js';
import { CREATURE_TYPES, filterMonsters, sensesText } from '../engine/monsters.js';
import { BESTIARY } from '../content/bestiary/index.js';

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const fmt = formatModifier;

export const CR_BANDS = {
  any: { label: 'Any challenge', min: 0, max: 30 },
  low: { label: 'CR 0 – 1', min: 0, max: 1 },
  mid: { label: 'CR 2 – 4', min: 2, max: 4 },
  hard: { label: 'CR 5 – 10', min: 5, max: 10 },
  epic: { label: 'CR 11 – 16', min: 11, max: 16 },
  legend: { label: 'CR 17 +', min: 17, max: 30 },
};

export const defaultBestiaryFilters = () => ({ text: '', type: '', band: 'any', source: '', westlands: false, sort: 'name' });

export function filteredMonsters(f) {
  const band = CR_BANDS[f.band] ?? CR_BANDS.any;
  let list = filterMonsters(BESTIARY, { text: f.text, type: f.type, minCr: band.min, maxCr: band.max, source: f.source });
  if (f.westlands) list = list.filter((m) => m.settings.includes('westlands'));
  if (f.sort === 'cr') list = [...list].sort((a, b) => a.crValue - b.crValue || a.name.localeCompare(b.name));
  return list;
}

// ---------------------------------------------------------------------------
// Catalogue
// ---------------------------------------------------------------------------

export function bestiaryView(f) {
  const opt = (value, label, current) => `<option value="${esc(value)}" ${value === current ? 'selected' : ''}>${esc(label)}</option>`;
  return `
    <section>
      <h1>Bestiary</h1>
      <p class="muted">${BESTIARY.length} creatures: the full 5e System Reference Document plus ${BESTIARY.filter((m) => m.source === 'Westlands').length} original foes of the Westlands.</p>
      <div class="bestiary-filters">
        <input type="search" data-filter="text" value="${esc(f.text)}" placeholder="Search by name or type…" aria-label="Search monsters">
        <select data-filter="type" aria-label="Creature type">${opt('', 'All types', f.type)}${CREATURE_TYPES.map((t) => opt(t, cap(t), f.type)).join('')}</select>
        <select data-filter="band" aria-label="Challenge rating">${Object.entries(CR_BANDS).map(([k, b]) => opt(k, b.label, f.band)).join('')}</select>
        <select data-filter="source" aria-label="Source">${opt('', 'All sources', f.source)}${opt('SRD 5.1', 'SRD 5.1', f.source)}${opt('Westlands', 'Westlands originals', f.source)}</select>
        <select data-filter="sort" aria-label="Sort">${opt('name', 'Sort: name', f.sort)}${opt('cr', 'Sort: challenge', f.sort)}</select>
        <label class="dg-check"><input type="checkbox" data-filter="westlands" ${f.westlands ? 'checked' : ''}> Fits the Westlands</label>
      </div>
      <div id="bestiary-results">${bestiaryResults(f)}</div>
    </section>`;
}

export function bestiaryResults(f) {
  const list = filteredMonsters(f);
  if (!list.length) return '<p class="muted empty">No creatures match those filters.</p>';
  return `<p class="muted small">${list.length} shown</p>
    <div class="card-grid monster-grid">${list.map(monsterCard).join('')}</div>`;
}

function monsterCard(m) {
  return `
    <button class="card monster-card ${m.source === 'Westlands' ? 'original' : ''}" data-action="view-monster" data-id="${esc(m.id)}">
      <span class="card-head"><span class="mc-name">${esc(m.name)}</span><span class="badge">CR ${esc(m.cr)}</span></span>
      <span class="mc-type">${esc(m.size)} ${esc(m.type)}${m.subtype ? ` (${esc(m.subtype)})` : ''}</span>
      <span class="mc-look">${esc(m.appearance)}</span>
      <span class="mc-foot"><span>AC ${m.ac} · HP ${m.hp}</span><span>${m.xp.toLocaleString()} XP</span>${m.source === 'Westlands' ? '<span class="tag">Westlands</span>' : ''}</span>
    </button>`;
}

// ---------------------------------------------------------------------------
// Stat block
// ---------------------------------------------------------------------------

const ordinal = (n) => `${n}${n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th'}`;
const ABILITY_NAME = { str: 'Strength', dex: 'Dexterity', con: 'Constitution', int: 'Intelligence', wis: 'Wisdom', cha: 'Charisma' };

function spellcastingHtml(m) {
  const s = m.spellcasting;
  if (!s) return '';
  const name = m.name.toLowerCase();
  const dc = s.dc ? `spell save DC ${s.dc}${s.toHit ? `, ${fmt(s.toHit)} to hit with spell attacks` : ''}` : 'no save DC';
  if (s.kind === 'innate') {
    const lines = [];
    if (s.atWill?.length) lines.push(`<li><i>At will:</i> ${esc(s.atWill.join(', '))}</li>`);
    for (const [n, list] of Object.entries(s.perDay ?? {}).sort((a, b) => b[0] - a[0])) lines.push(`<li><i>${n}/day${list.length > 1 ? ' each' : ''}:</i> ${esc(list.join(', '))}</li>`);
    return `<p><b><i>Innate Spellcasting.</i></b> The ${esc(name)}'s innate spellcasting ability is ${ABILITY_NAME[s.ability]} (${dc}). It can innately cast the following spells, requiring no material components:</p><ul class="spell-list">${lines.join('')}</ul>`;
  }
  const lines = Object.entries(s.spells).map(([lvl, list]) => (lvl === '0'
    ? `<li><i>Cantrips (at will):</i> ${esc(list.join(', '))}</li>`
    : `<li><i>${ordinal(Number(lvl))} level (${s.slots[lvl]} slot${s.slots[lvl] > 1 ? 's' : ''}):</i> ${esc(list.join(', '))}</li>`));
  return `<p><b><i>Spellcasting.</i></b> The ${esc(name)} is a ${ordinal(s.level)}-level spellcaster. Its spellcasting ability is ${ABILITY_NAME[s.ability]} (${dc}). It has the following spells prepared:</p><ul class="spell-list">${lines.join('')}</ul>`;
}

function rollButtons(m, a) {
  if (!a.attack) return '';
  const hit = `<button class="roll-chip" data-action="check" data-label="${esc(`${m.name}: ${a.name}`)}" data-bonus="${a.attack.toHit}" title="Roll to hit">🎲 ${fmt(a.attack.toHit)}</button>`;
  const dmg = (a.attack.damage ?? []).filter((d) => /d/.test(d.dice)).map((d) => `<button class="roll-chip" data-action="damage" data-label="${esc(`${a.name} ${d.type}`)}" data-notation="${esc(d.dice)}" title="Roll damage">${esc(d.dice)} ${esc(d.type)}</button>`).join('');
  return `<span class="roll-chips">${hit}${dmg}</span>`;
}

function actionList(m, list) {
  return list.map((a) => `<p class="sb-action"><b><i>${esc(a.name)}${a.recharge && !/Recharge/.test(a.name) ? ` (Recharge ${esc(a.recharge)})` : ''}${a.uses && !a.name.includes(a.uses) ? ` (${esc(a.uses)})` : ''}.</i></b> ${esc(a.text)} ${rollButtons(m, a)}</p>`).join('');
}

const listLine = (label, items) => (items && items.length ? `<p><b>${label}</b> ${esc(Array.isArray(items) ? items.join('; ') : items)}</p>` : '');

export function monsterView(m) {
  const saves = Object.entries(m.saves).map(([k, v]) => `${ABILITIES[k].short.charAt(0)}${ABILITIES[k].short.slice(1).toLowerCase()} ${fmt(v)}`).join(', ');
  const skills = Object.entries(m.skills).map(([k, v]) => `${cap(k.replace(/-/g, ' '))} ${fmt(v)}`).join(', ');
  const prompt = `${m.appearance} Fantasy illustration, dramatic lighting, detailed, painterly style.`;
  return `
    <div class="row sheet-actions">
      <button class="btn ghost" data-action="bestiary-back">← Bestiary</button>
      <span class="spacer"></span>
      <button class="btn small" data-action="copy-prompt" data-prompt="${esc(prompt)}">Copy image prompt</button>
    </div>
    <div class="monster-layout">
      <article class="statblock">
        <h2>${esc(m.name)}</h2>
        <p class="sb-meta">${esc(m.size)} ${esc(m.type)}${m.subtype ? ` (${esc(m.subtype)})` : ''}, ${esc(m.alignment)}</p>
        <div class="sb-rule"></div>
        <p><b>Armor Class</b> ${m.ac}${m.armor ? ` (${esc(m.armor)})` : ''}</p>
        <p><b>Hit Points</b> ${m.hp}${m.hitDice ? ` (${esc(m.hitDice.replace(/([+-])/, ' $1 '))})` : ''}
          ${m.hitDice ? `<button class="roll-chip" data-action="damage" data-label="${esc(`${m.name} hit points`)}" data-notation="${esc(m.hitDice)}" title="Roll hit points">🎲</button>` : ''}</p>
        <p><b>Speed</b> ${esc(m.speedText)}</p>
        <div class="sb-rule"></div>
        <div class="sb-abilities">
          ${ABILITY_IDS.map((id) => `<button class="sb-ab" data-action="check" data-label="${esc(`${m.name}: ${ABILITIES[id].short} check`)}" data-bonus="${m.mods[id]}"><b>${ABILITIES[id].short}</b><span>${m.scores[id]} (${fmt(m.mods[id])})</span></button>`).join('')}
        </div>
        <div class="sb-rule"></div>
        ${saves ? `<p><b>Saving Throws</b> ${esc(saves)}</p>` : ''}
        ${skills ? `<p><b>Skills</b> ${esc(skills)}</p>` : ''}
        ${listLine('Damage Vulnerabilities', m.vulnerable)}
        ${listLine('Damage Resistances', m.resist)}
        ${listLine('Damage Immunities', m.immune)}
        ${listLine('Condition Immunities', m.conditionImmune.join(', '))}
        <p><b>Senses</b> ${esc(sensesText(m))}</p>
        <p><b>Languages</b> ${esc(m.languages)}</p>
        <p><b>Challenge</b> ${esc(m.cr)} (${m.xp.toLocaleString()} XP) <span class="muted">· Proficiency Bonus ${fmt(m.proficiencyBonus)}</span></p>
        <div class="sb-rule"></div>
        ${m.traits.map((t) => `<p><b><i>${esc(t.name)}.</i></b> ${esc(t.text)}</p>`).join('')}
        ${spellcastingHtml(m)}
        ${m.actions.length ? `<h3>Actions</h3>${actionList(m, m.actions)}` : ''}
        ${m.bonusActions.length ? `<h3>Bonus Actions</h3>${actionList(m, m.bonusActions)}` : ''}
        ${m.reactions.length ? `<h3>Reactions</h3>${actionList(m, m.reactions)}` : ''}
        ${m.legendary ? `<h3>Legendary Actions</h3><p>The ${esc(m.name.toLowerCase())} can take ${m.legendary.count} legendary actions, choosing from the options below. Only one legendary action can be used at a time and only at the end of another creature's turn. It regains spent legendary actions at the start of its turn.</p>${actionList(m, m.legendary.actions)}` : ''}
        <p class="sb-source muted small">Source: ${esc(m.source)}${m.source === 'SRD 5.1' ? ' (game mechanics, CC-BY-4.0); description original' : ''}</p>
      </article>
      <aside class="lore-panel">
        <section><h3>Appearance</h3><p>${esc(m.appearance)}</p></section>
        <section><h3>Personality</h3><p>${esc(m.lore.personality)}</p></section>
        <section><h3>Origin</h3><p>${esc(m.lore.origin)}</p></section>
        <section><h3>Tactics</h3><p>${esc(m.lore.tactics)}</p></section>
        ${m.habitat.length ? `<section><h3>Found in</h3><p>${m.habitat.map((h) => `<span class="tag">${esc(h)}</span>`).join(' ')}</p></section>` : ''}
      </aside>
    </div>`;
}
