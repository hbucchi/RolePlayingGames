/**
 * The workshop in town: the forge, the workbench and the tannery (engine/crafting.js).
 * Pure HTML from state; the clicks are handled in app.js ([data-ws] buttons).
 */
import { RECIPES, SUPPLIES } from '../content/crafting/recipes.js';
import { ITEMS_BY_ID } from '../content/items/catalogue.js';
import { CRAFT_SKILLS, CRAFT_IDS, tradeLevel, tradeXp, tradeTitle, TRADE_XP, TRADE_MAX, craftBonus, recipeDc, minLevel, chances, tradeXpFor, needs, materialChoices, canAfford, toolProficient } from '../engine/crafting.js';
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
    const lv = tradeLevel(draft, id); const xp = tradeXp(draft, id); const k = CRAFT_SKILLS[id];
    const lo = TRADE_XP[lv]; const hi = TRADE_XP[Math.min(TRADE_MAX, lv + 1)];
    const fill = lv >= TRADE_MAX ? 100 : Math.round(100 * (xp - lo) / (hi - lo));
    return `<button class="ws-skill ${id === skill ? 'sel' : ''}" data-ws="station" data-skill="${id}" aria-pressed="${id === skill}">
      <span class="ws-skill-name">${esc(k.station)}</span><b>${esc(k.name)}, level ${lv}</b>
      <span class="bar"><span style="width:${fill}%"></span></span>
      <span class="small muted">${tradeTitle(lv)} · ${lv >= TRADE_MAX ? `${xp.toLocaleString()} XP` : `${xp.toLocaleString()} / ${hi.toLocaleString()} XP`}${toolProficient(sheet, id) ? ' · knows the tools (+2)' : ''}</span></button>`;
  }).join('');

  const level = tradeLevel(draft, skill);
  const bonus = craftBonus(sheet, draft, skill);
  const list = RECIPES.filter((r) => r.skill === skill);
  const groups = [...new Set(list.map((r) => r.group))];
  const row = (r) => {
    const choices = materialChoices(r, draft, safe);
    const mat = r.slot ? (picks[r.id] ?? choices.find((c) => c.have >= r.slot.qty)?.id ?? choices[0].id) : null;
    const dc = recipeDc(r, mat); const need = minLevel(r, mat); const c = chances(bonus, dc);
    const open = level >= need;
    const ok = canAfford(r, mat, draft, safe) && open;
    if (onlyMakeable && !ok) return '';
    const out = makeItem(r.output.id, r.output.qty, mat ? { material: mat } : {});
    const parts = needs(r, mat, draft, safe).map((i) => `<span class="${i.have >= i.qty ? '' : 'lack'}">${i.qty} ${esc(itemName({ id: i.id }))} <small>(${i.have})</small></span>`).join(' · ');
    const select = r.slot ? `<select data-ws="material" data-recipe="${esc(r.id)}" aria-label="Made of">${choices.map((m) => `<option value="${m.id}" ${m.id === mat ? 'selected' : ''}>${esc(m.name)}${m.have ? ` (${m.have})` : ''} · level ${minLevel(r, m.id)}+</option>`).join('')}</select>` : '';
    const xpGain = tradeXpFor(dc, true, c.success);
    return `<li class="ws-recipe ${ok ? '' : 'cant'}">
      ${itemIcon(out, 'sm')}
      <div class="ws-what"><b>${esc(itemName(out))}${r.output.qty > 1 ? ` × ${r.output.qty}` : ''}</b><span class="small">${parts || '<span class="muted">nothing else</span>'}</span></div>
      <div class="ws-how">${select}<span class="small">${open ? `DC ${dc} · <b>${pct(c.success)}</b> success · ${pct(c.superior)} superior · ${xpGain ? `+${xpGain} XP` : 'too easy to learn from'}` : `<span class="lack">needs ${esc(CRAFT_SKILLS[r.skill].name.toLowerCase())} level ${need}</span> · DC ${dc}`}</span></div>
      <button class="btn small ${ok ? 'primary' : ''}" data-ws="craft" data-recipe="${esc(r.id)}" ${ok ? '' : 'disabled'}>Craft</button></li>`;
  };
  const recipes = groups.map((g) => { const rows = list.filter((r) => r.group === g).map(row).join(''); return rows ? `<h4 class="ws-group">${esc(g)}</h4><ul class="ws-list">${rows}</ul>` : ''; }).join('');

  const supplies = `<div class="ws-supplies"><span class="small"><b>Supplies</b> (${esc(formatCoins(draft.coins ?? 0))}):</span>
    ${SUPPLIES.map((id) => `<button class="btn small ghost" data-ws="buy" data-id="${id}" ${(draft.coins ?? 0) < supplyPrice(id) ? 'disabled' : ''}>${SUPPLY_BUNDLE[id]} ${esc(itemName({ id }).toLowerCase())} · ${esc(formatCoins(supplyPrice(id)))}</button>`).join('')}
    <span class="small muted">Silver, gold, mithral, fine woods and pelts are found, not sold.</span></div>`;

  const result = last ? `<div class="ws-result ${last.outcome}" aria-live="polite">
    <b>${{ superior: '★ Superior!', success: 'Success', fail: 'Failed' }[last.outcome]}</b>
    d20 ${last.d20} + ${last.bonus} = ${last.total} vs DC ${last.dc}. ${esc(last.message)}
    ${last.lost?.length && last.outcome === 'fail' ? `<span class="small muted">Lost: ${last.lost.map((l) => `${l.qty} ${esc(itemName({ id: l.id }).toLowerCase())}`).join(', ')}.</span>` : ''}
    ${last.gain ? `<span class="small"><b>+${last.gain} ${esc(CRAFT_SKILLS[last.skill].name.toLowerCase())} XP</b>${last.levelUp ? ` · <b>level ${last.levelUp}!</b> Harder work opens, and old work gets easier.` : ''}</span>` : '<span class="small muted">Too easy to learn from.</span>'}</div>` : '';

  return `<section class="market workshop">${head}
    <div class="card market-card-body">
      <div class="ws-skills">${skills}</div>
      ${result}
      ${supplies}
      <label class="small ws-filter"><input type="checkbox" data-ws="only" ${onlyMakeable ? 'checked' : ''}> Only what I can make now</label>
      <div class="ws-recipes">${recipes || '<p class="muted small">Nothing you can make with what you have. Buy supplies, or bring back ore, hides and wood.</p>'}</div>
      <p class="small muted">Roll d20 + your trade level (+2 with the trade's tools) against the DC. Each recipe and material needs a trade level (DC − 12): there you succeed about 45% of the time, and every level above adds 5%. A natural 20, or an 11+ on the die that beats the DC by 10, makes a <b>superior</b> piece (+1 to hit and damage or +5% absorption, worth twice as much; double for ingots and arrows). A natural 1 or a miss loses half the materials. Every attempt gives trade XP (the DC, half on a failure, none for work you cannot fail); trades have their own levels 1 to 20 and never give a hero experience.</p>
    </div></section>`;
}
