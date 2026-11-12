/**
 * The workshop in town: the forge, the workbench and the tannery (engine/crafting.js).
 * Pure HTML from state; the clicks are handled in app.js ([data-ws] buttons).
 */
import { RECIPES, SUPPLIES } from '../content/crafting/recipes.js';
import { ITEMS_BY_ID } from '../content/items/catalogue.js';
import { CRAFT_SKILLS, CRAFT_IDS, rankOf, effectiveSkill, targetSkill, chances, gainChance, needs, materialChoices, canAfford, toolProficient } from '../engine/crafting.js';
import { formatCoins, itemName, makeItem } from '../engine/items.js';
import { itemIcon } from './inventory-view.js';
import { SAFE_SLOTS } from '../engine/safe.js';

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pct = (x) => `${Math.round(x * 100)}%`;
/** Supplies come in handy bundles; the price is what they are worth. */
export const SUPPLY_BUNDLE = { coal: 5, 'iron-ore': 4, 'copper-ore': 4, 'tin-ore': 2, 'ash-log': 2, 'oak-log': 2, hide: 2, cloth: 2, feathers: 10 };
export const supplyPrice = (id) => (ITEMS_BY_ID[id]?.value ?? 1) * (SUPPLY_BUNDLE[id] ?? 1);

/**
 * @param o { heroes: [{id,label}], heroId, draft, sheet, safe, skill, picks: {recipeId: material}, last, onlyMakeable }
 */
export function workshopHtml(o) {
  const { heroes, heroId, draft, sheet, safe, skill = 'smithing', picks = {}, last = null, onlyMakeable = false } = o;
  const head = `<div class="row sheet-actions arena-head"><button class="btn ghost small" data-action="home">← Adventures</button><h1 class="arena-title">The Workshop</h1>
    <p class="muted small">Forge, carve and stitch your own gear from what you bring back. Resources come from your bag and from the safe (${safe.used()} / ${SAFE_SLOTS}).</p></div>
    <div class="chips market-heroes">${heroes.map((x) => `<button class="chip ${x.id === heroId ? 'sel' : ''}" data-ws="hero" data-id="${esc(x.id)}" aria-pressed="${x.id === heroId}">${esc(x.label.split(',')[0])}</button>`).join('')}</div>`;
  if (!draft) return `<section class="market workshop">${head}<p class="muted">Make or adopt a hero first.</p></section>`;

  const skills = CRAFT_IDS.map((id) => {
    const r = rankOf(draft, id); const k = CRAFT_SKILLS[id];
    return `<button class="ws-skill ${id === skill ? 'sel' : ''}" data-ws="station" data-skill="${id}" aria-pressed="${id === skill}">
      <span class="ws-skill-name">${esc(k.station)}</span><b>${esc(k.name)} ${r.toFixed(1)}</b>
      <span class="bar"><span style="width:${r}%"></span></span>
      <span class="small muted">${r >= 100 ? 'Grandmaster' : r >= 90 ? 'Master' : r >= 60 ? 'Expert' : r >= 30 ? 'Journeyman' : 'Apprentice'}${toolProficient(sheet, id) ? ' · knows the tools (+5)' : ''}</span></button>`;
  }).join('');

  const eff = effectiveSkill(sheet, draft, skill);
  const rank = rankOf(draft, skill);
  const list = RECIPES.filter((r) => r.skill === skill);
  const groups = [...new Set(list.map((r) => r.group))];
  const row = (r) => {
    const choices = materialChoices(r, draft, safe);
    const mat = r.slot ? (picks[r.id] ?? choices.find((c) => c.have >= r.slot.qty)?.id ?? choices[0].id) : null;
    const target = targetSkill(r, mat); const c = chances(eff, target);
    const ok = canAfford(r, mat, draft, safe) && c.success > 0;
    if (onlyMakeable && !ok) return '';
    const out = makeItem(r.output.id, r.output.qty, mat ? { material: mat } : {});
    const parts = needs(r, mat, draft, safe).map((i) => `<span class="${i.have >= i.qty ? '' : 'lack'}">${i.qty} ${esc(itemName({ id: i.id }))} <small>(${i.have})</small></span>`).join(' · ');
    const select = r.slot ? `<select data-ws="material" data-recipe="${esc(r.id)}" aria-label="Made of">${choices.map((m) => `<option value="${m.id}" ${m.id === mat ? 'selected' : ''}>${esc(m.name)}${m.have ? ` (${m.have})` : ''} · skill ${targetSkill(r, m.id)}</option>`).join('')}</select>` : '';
    const learn = gainChance(rank, c.success);
    return `<li class="ws-recipe ${ok ? '' : 'cant'}">
      ${itemIcon(out, 'sm')}
      <div class="ws-what"><b>${esc(itemName(out))}${r.output.qty > 1 ? ` × ${r.output.qty}` : ''}</b><span class="small">${parts || '<span class="muted">nothing else</span>'}</span></div>
      <div class="ws-how">${select}<span class="small">${c.success > 0 ? `skill ${target} · <b>${pct(c.success)}</b> success · ${pct(c.superior)} superior · ${learn ? `${pct(learn)} to learn` : 'too easy to learn from'}` : `<span class="lack">too difficult yet: needs ${target - 50}+</span>`}</span></div>
      <button class="btn small ${ok ? 'primary' : ''}" data-ws="craft" data-recipe="${esc(r.id)}" ${ok ? '' : 'disabled'}>Craft</button></li>`;
  };
  const recipes = groups.map((g) => { const rows = list.filter((r) => r.group === g).map(row).join(''); return rows ? `<h4 class="ws-group">${esc(g)}</h4><ul class="ws-list">${rows}</ul>` : ''; }).join('');

  const supplies = `<div class="ws-supplies"><span class="small"><b>Supplies</b> (${esc(formatCoins(draft.coins ?? 0))}):</span>
    ${SUPPLIES.map((id) => `<button class="btn small ghost" data-ws="buy" data-id="${id}" ${(draft.coins ?? 0) < supplyPrice(id) ? 'disabled' : ''}>${SUPPLY_BUNDLE[id]} ${esc(itemName({ id }).toLowerCase())} · ${esc(formatCoins(supplyPrice(id)))}</button>`).join('')}
    <span class="small muted">Silver, gold, mithral, fine woods and pelts are found, not sold.</span></div>`;

  const result = last ? `<div class="ws-result ${last.outcome}" aria-live="polite">
    <b>${{ superior: '★ Superior!', success: 'Success', fail: 'Failed' }[last.outcome]}</b>
    Rolled ${last.d100} on d100: ${pct(last.chance)} to succeed${last.superiorChance ? `, ${pct(last.superiorChance)} superior` : ''}. ${esc(last.message)}
    ${last.lost?.length && last.outcome === 'fail' ? `<span class="small muted">Lost: ${last.lost.map((l) => `${l.qty} ${esc(itemName({ id: l.id }).toLowerCase())}`).join(', ')}.</span>` : ''}
    ${last.gain ? `<span class="small"><b>${esc(CRAFT_SKILLS[last.skill].name)} +${last.gain}</b> (now ${rankOf(draft, last.skill).toFixed(1)}).</span>` : `<span class="small muted">No gain this time (${pct(last.gainChance)} chance).</span>`}</div>` : '';

  return `<section class="market workshop">${head}
    <div class="card market-card-body">
      <div class="ws-skills">${skills}</div>
      ${result}
      ${supplies}
      <label class="small ws-filter"><input type="checkbox" data-ws="only" ${onlyMakeable ? 'checked' : ''}> Only what I can make now</label>
      <div class="ws-recipes">${recipes || '<p class="muted small">Nothing you can make with what you have. Buy supplies, or bring back ore, hides and wood.</p>'}</div>
      <p class="small muted">Your chance depends only on your trade skill: 50% at a recipe's skill, +1% per point above it, certain 50 points above; 50 below, you cannot try it yet. A <b>superior</b> piece (1% per 2 points above, up to 25%) has +1 to hit and damage or +5% absorption and is worth twice as much (double for ingots and arrows). A failure loses half the materials. Every attempt may teach you something: most from hard work while you are green, nothing from what you cannot fail. Crafting never gives a hero experience.</p>
    </div></section>`;
}
