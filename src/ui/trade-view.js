/**
 * The selling panel, shared by every trader: the Trading post between adventures, a caravan met in
 * a dungeon, and the campaign's shopkeepers. Prices and haggling rules live in engine/trade.js.
 *
 * `attr` is the data attribute the host listens to (data-dg in a dungeon, data-tr on the menu
 * pages), so the same buttons work in both places:
 *   ${attr}="trade-haggle"                       haggle once (Persuasion)
 *   ${attr}="trade-sell" data-uid data-qty       sell one, or the whole stack (qty "all")
 *   ${attr}="trade-sell-goods"                   sell every gem, trinket and raw material at once
 */
import { itemName, itemRarity, formatCoins } from '../engine/items.js';
import { ITEMS_BY_ID } from '../content/items/catalogue.js';
import { sellable, BASE_RATE } from '../engine/trade.js';
import { itemIcon, fmtValue } from './inventory-view.js';

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const signed = (n) => (n >= 0 ? `+${n}` : `−${Math.abs(n)}`);
/** Goods: things you carry only to sell (gems, trinkets, ores, hides, herbs...). */
export const GOODS = new Set(['gem', 'trinket', 'resource']);

/**
 * @param o { gear, rate, haggle: {text, rate} | null, persuasion, heroName, attr, trader }
 */
export function tradeHtml({ gear, rate = BASE_RATE, haggle = null, persuasion = 0, heroName = 'You', attr = 'data-dg', trader = 'The trader' }) {
  const list = sellable(gear, rate).sort((a, b) => (!!a.why - !!b.why) || b.all - a.all);
  const goods = list.filter((x) => !x.why && GOODS.has(ITEMS_BY_ID[x.inst.id]?.cat));
  const goodsTotal = goods.reduce((n, x) => n + x.all, 0);
  const pct = Math.round(rate * 100);
  return `<div class="trade">
    <div class="trade-head">
      <p class="small"><b>${esc(trader)}</b> pays <b class="trade-rate">${pct}%</b> of what things cost new.${haggle ? ` <span class="muted">${esc(haggle.text)}</span>` : ''}</p>
      <button class="btn small" ${attr}="trade-haggle" ${haggle ? 'disabled' : ''} title="Charisma (Persuasion) check: every point over 10 adds 1% (up to 75%). Once per visit.">🗣 ${haggle ? 'Haggled' : `Haggle (Persuasion ${signed(persuasion)})`}</button>
    </div>
    ${goods.length ? `<button class="btn small primary trade-goods" ${attr}="trade-sell-goods">Sell all goods (${goods.length}) for ${esc(fmtValue(goodsTotal))}</button>` : ''}
    ${list.length ? `<ul class="trade-list">${list.map(({ inst, why, each, all }) => {
      const qty = inst.qty ?? 1;
      return `<li class="${why ? 'no' : ''}">${itemIcon(inst, 'sm')}
        <span class="trade-name r-text-${itemRarity(inst)}">${esc(itemName(inst))}${qty > 1 ? ` <small>×${qty}</small>` : ''}</span>
        ${why ? `<span class="muted small">${esc(why)}</span>` : `<span class="trade-price">${esc(fmtValue(each))}${qty > 1 ? '<small> each</small>' : ''}</span>
        <span class="trade-btns">${qty > 1 ? `<button class="btn small" ${attr}="trade-sell" data-uid="${esc(inst.uid)}" data-qty="1">Sell 1</button><button class="btn small" ${attr}="trade-sell" data-uid="${esc(inst.uid)}" data-qty="all">All ${esc(fmtValue(all))}</button>` : `<button class="btn small" ${attr}="trade-sell" data-uid="${esc(inst.uid)}" data-qty="1">Sell</button>`}</span>`}
      </li>`;
    }).join('')}</ul>` : '<p class="muted small">Nothing to sell.</p>'}
    <p class="small muted trade-purse">${esc(heroName)}'s purse: <b>${esc(formatCoins(gear.coins ?? 0))}</b></p>
  </div>`;
}
