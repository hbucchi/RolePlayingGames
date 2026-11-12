/**
 * The selling panel, shared by every trader: the Trading post between adventures, a caravan met in
 * a dungeon, and the campaign's shopkeepers. Prices and haggling rules live in engine/trade.js.
 *
 * `attr` is the data attribute the host listens to (data-dg in a dungeon, data-tr on the menu
 * pages), so the same buttons work in both places:
 *   ${attr}="trade-haggle"                       haggle once (Persuasion)
 *   ${attr}="trade-sell" data-uid data-qty       sell one, or the whole stack (qty "all")
 *   ${attr}="trade-sell-goods"                   sell every gem, trinket and raw material at once
 *   ${attr}="trade-tab" data-tab="buy|sell"      switch between buying and selling
 *   ${attr}="trade-shelf" data-shelf             show one shelf of goods (weapons, armour...)
 *   ${attr}="trade-buy" data-id                  buy a standard item (engine/shop.js)
 *   ${attr}="trade-buy-rare"                     buy this period's rare magic item
 *   ${attr}="trade-repair" data-uid              mend one piece of armour (no uid: everything)
 */
import { itemName, itemRarity, formatCoins } from '../engine/items.js';
import { ITEMS_BY_ID, CATEGORY_LABEL, RARITY_LABEL } from '../content/items/catalogue.js';
import { sellable, BASE_RATE } from '../engine/trade.js';
import { repairable, conditionOf } from '../engine/smith.js';
import { itemIcon, fmtValue } from './inventory-view.js';

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const signed = (n) => (n >= 0 ? `+${n}` : `−${Math.abs(n)}`);
/** Goods: things you carry only to sell (gems, trinkets, ores, hides, herbs...). */
export const GOODS = new Set(['gem', 'trinket', 'resource']);

/**
 * @param o { gear, rate, haggle: {text, rate} | null, persuasion, heroName, attr, trader }
 */
export function tradeHtml({ gear, rate = BASE_RATE, haggle = null, persuasion = 0, heroName = 'You', attr = 'data-dg', trader = 'The trader', tab = 'buy', stock = null, shelf = 'weapon', smith = false }) {
  const tabs = stock || smith ? `<div class="chips trade-tabs" role="tablist">
      ${stock ? `<button class="chip ${tab === 'buy' ? 'sel' : ''}" ${attr}="trade-tab" data-tab="buy" aria-pressed="${tab === 'buy'}">🛒 Buy</button>` : ''}
      <button class="chip ${tab === 'sell' ? 'sel' : ''}" ${attr}="trade-tab" data-tab="sell" aria-pressed="${tab === 'sell'}">💰 Sell</button>
      ${smith ? `<button class="chip ${tab === 'repair' ? 'sel' : ''}" ${attr}="trade-tab" data-tab="repair" aria-pressed="${tab === 'repair'}">🔨 Repair</button>` : ''}
    </div>` : '';
  const haggleBtn = `<button class="btn small" ${attr}="trade-haggle" ${haggle ? 'disabled' : ''} title="Charisma (Persuasion) check: every point over 10 adds 1% when you sell and takes 1% off when you buy (up to 25%). Once per visit.">🗣 ${haggle ? 'Haggled' : `Haggle (Persuasion ${signed(persuasion)})`}</button>`;
  const purse = `<p class="small muted trade-purse">${esc(heroName)}'s purse: <b>${esc(formatCoins(gear.coins ?? 0))}</b></p>`;
  if (smith && tab === 'repair') return `<div class="trade">${tabs}${repairHtml({ gear, attr })}${purse}</div>`;
  if (stock && tab === 'buy') return `<div class="trade">${tabs}${buyHtml({ gear, rate, haggle, attr, trader, stock, haggleBtn, shelf })}${purse}</div>`;
  const list = sellable(gear, rate).sort((a, b) => (!!a.why - !!b.why) || b.all - a.all);
  const goods = list.filter((x) => !x.why && GOODS.has(ITEMS_BY_ID[x.inst.id]?.cat));
  const goodsTotal = goods.reduce((n, x) => n + x.all, 0);
  const pct = Math.round(rate * 100);
  return `<div class="trade">${tabs}
    <div class="trade-head">
      <p class="small"><b>${esc(trader)}</b> pays <b class="trade-rate">${pct}%</b> of what things cost new.${haggle ? ` <span class="muted">${esc(haggle.text)}</span>` : ''}</p>
      ${haggleBtn}
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
    ${purse}
  </div>`;
}

/** The order the shelves are shown in. */
const SHELVES = ['weapon', 'armor', 'shield', 'ammo', 'consumable', 'tool', 'clothing', 'jewelry'];
const SHELF_LABEL = { weapon: 'Weapons', armor: 'Armour', shield: 'Shields', ammo: 'Ammunition', consumable: 'Potions and supplies', tool: 'Tools and gear', clothing: 'Cloaks', jewelry: 'Plain jewellery' };

/** The buying side: the rare offer (if any), then the standard goods, one shelf at a time. */
function buyHtml({ gear, rate, haggle, attr, trader, stock, haggleBtn, shelf }) {
  const coins = gear.coins ?? 0;
  const pct = Math.round((1 - (rate - BASE_RATE)) * 100);
  const short = (price) => (coins < price ? `need ${fmtValue(price - coins)} more` : '');
  const r = stock.rare;
  const rare = r ? `<div class="trade-rare">
      <p class="small"><b>✨ Something special</b> <span class="muted">(magic goods cost three times their worth)</span></p>
      <div class="trade-rare-item">${itemIcon(r.inst, 'md')}
        <div><b class="r-text-${itemRarity(r.inst)}">${esc(itemName(r.inst))}</b> <small class="muted">${esc(RARITY_LABEL[itemRarity(r.inst)] ?? '')}</small>
          <p class="small muted">${esc(ITEMS_BY_ID[r.inst.id]?.desc ?? '')}${r.inst.bonus ? ` Enchanted: +${r.inst.bonus}.` : ''}</p></div>
        <span class="trade-btns"><span class="trade-price">${esc(fmtValue(r.price))}</span>
          <button class="btn small primary" ${attr}="trade-buy-rare" ${coins < r.price ? `disabled title="${esc(short(r.price))}"` : ''}>Buy</button></span>
      </div>
      ${coins < r.price ? `<p class="small muted">${esc(short(r.price))}.</p>` : ''}
    </div>`
    : `<p class="small muted trade-norare">No magic goods today. ${esc(trader)} may have something special after ${stock.nextIn} more adventure${stock.nextIn === 1 ? '' : 's'} (a 1 in 10 chance).</p>`;
  const open = SHELVES.filter((cat) => stock.standard.some((x) => x.def.cat === cat));
  const cur = open.includes(shelf) ? shelf : open[0];
  const goods = stock.standard.filter((x) => x.def.cat === cur).sort((a, b) => a.price - b.price);
  const shelves = `<div class="chips trade-shelf-tabs">${open.map((cat) => `<button class="chip ${cat === cur ? 'sel' : ''}" ${attr}="trade-shelf" data-shelf="${cat}" aria-pressed="${cat === cur}">${esc(SHELF_LABEL[cat] ?? CATEGORY_LABEL[cat])}</button>`).join('')}</div>
      <ul class="trade-list trade-shelf">${goods.map(({ id, qty, price, def }) => `<li title="${esc(def.desc ?? '')}">${itemIcon({ id, qty }, 'sm')}
        <span class="trade-name">${esc(def.name)}${qty > 1 ? ` <small>×${qty}</small>` : ''}</span>
        <span class="trade-price ${coins < price ? 'dear' : ''}">${esc(fmtValue(price))}</span>
        <span class="trade-btns"><button class="btn small" ${attr}="trade-buy" data-id="${esc(id)}" ${coins < price ? `disabled title="${esc(short(price))}"` : ''}>Buy</button></span>
      </li>`).join('')}</ul>`;
  const later = stock.later.length ? `<p class="small muted">Too dear for now (stocked for heroes of level ${[...new Set(stock.later.map((x) => x.from))].sort((a, b) => a - b).join(' and ')}): ${esc(stock.later.map((x) => `${x.def.name} (level ${x.from})`).join(', '))}.</p>` : '';
  return `<div class="trade-head">
      <p class="small"><b>${esc(trader)}</b> sells at <b class="trade-rate">${pct}%</b> of the price.${haggle ? ` <span class="muted">${esc(haggle.text)}</span>` : ''}</p>
      ${haggleBtn}
    </div>
    ${rare}
    <div class="trade-shelves">${shelves}</div>
    ${later}`;
}

/**
 * The smith's work: every worn piece of armour with its condition and the price to make it whole
 * (engine/smith.js: price new x damage x 1/2).
 */
export function repairHtml({ gear, attr = 'data-dg', smithName = 'The smith' }) {
  const list = repairable(gear);
  const total = list.reduce((n, x) => n + x.cost, 0);
  if (!list.length) return `<p class="small muted">${esc(smithName)} looks over your gear: nothing needs mending.</p>`;
  return `<p class="small"><b>${esc(smithName)}</b> mends armour for half the price of what was lost.</p>
    <button class="btn small primary" ${attr}="trade-repair" ${(gear.coins ?? 0) < total ? 'disabled' : ''}>Mend everything for ${esc(fmtValue(total))}</button>
    <ul class="trade-list">${list.map(({ inst, cost }) => `<li>${itemIcon(inst, 'sm')}
      <span class="trade-name">${esc(itemName(inst))} <small class="${conditionOf(inst) < 50 ? 'bad' : 'muted'}">condition ${conditionOf(inst)}%</small></span>
      <span class="trade-price">${esc(fmtValue(cost))}</span>
      <span class="trade-btns"><button class="btn small" ${attr}="trade-repair" data-uid="${esc(inst.uid)}" ${(gear.coins ?? 0) < cost ? 'disabled title="Not enough coin"' : ''}>Repair</button></span></li>`).join('')}</ul>`;
}
