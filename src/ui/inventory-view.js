/**
 * Inventory and paperdoll, shared by the character sheet and the dungeon. Pure rendering:
 * it returns HTML with data-inv attributes; the host wires the clicks to inventory actions.
 */
import { ITEMS_BY_ID, RARITY_LABEL, CATEGORY_LABEL } from '../content/items/catalogue.js';
import { SLOTS, JEWEL_SLOTS, SLOT_GROUPS, itemName, itemRarity, isMagic, itemValue, carriedWeight, carryCapacity, splitCoins, isEquipped, slotFor, loadLimits, bagUsed, BAG_SLOTS } from '../engine/items.js';
import { kg, kilos, metricText } from '../engine/units.js';
import { ARMOURS } from '../engine/defence.js';
import { METALS, metalOf, absorbFor, ARMOUR_FORM, FORMS } from '../engine/materials.js';

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const FILTERS = [
  { id: 'all', name: 'All' },
  { id: 'gear', name: 'Arms & armour', cats: ['weapon', 'armor', 'shield', 'ammo', 'clothing', 'jewelry'] },
  { id: 'use', name: 'Consumables', cats: ['consumable'] },
  { id: 'tools', name: 'Tools', cats: ['tool', 'trinket'] },
  { id: 'res', name: 'Resources', cats: ['resource', 'gem'] },
];

const SLOT_GLYPH = { mainHand: '⚔', offHand: '⛉', ranged: '🏹', body: '🛡', cloak: '🧥', neck: '📿', wrist1: '◯', wrist2: '◯', ring: '💍' };

/** A square item tile: the painted icon if we have one, else a glyph. */
export function itemIcon(inst, size = 'md') {
  const def = ITEMS_BY_ID[inst.id];
  const rarity = itemRarity(inst);
  // Metal gear is tinted by what it is forged from (materials.js): bronze, gold, mithral...
  const tint = METALS[metalOf(inst, def)]?.tint;
  return `<span class="item-icon ${size} r-${rarity} ${isMagic(inst) ? 'magic' : ''}">
    ${def?.icon ? `<img src="${esc(def.icon)}" alt="" loading="lazy"${tint && tint !== 'none' ? ` style="filter:${tint}"` : ''}>` : `<span class="glyph" aria-hidden="true">${def?.glyph ?? '•'}</span>`}
    ${(inst.qty ?? 1) > 1 ? `<span class="qty">${inst.qty}</span>` : ''}
  </span>`;
}

export function coinsHtml(cp) {
  const c = splitCoins(cp);
  const coin = (k, n, label) => `<span class="coin ${k}" title="${label}"><img src="assets/items/${k === 'gp' ? 'gold' : k === 'sp' ? 'silver' : 'copper'}.jpg" alt="">${n}<small>${k}</small></span>`;
  return `<span class="coins">${coin('gp', c.gp, 'gold pieces')}${coin('sp', c.sp, 'silver pieces')}${coin('cp', c.cp, 'copper pieces')}</span>`;
}

function statLine(inst) {
  const def = ITEMS_BY_ID[inst.id];
  const b = inst.bonus ?? def.bonus ?? 0;
  if (def.weapon) {
    const w = def.weapon;
    const metal = metalOf(inst, def); const mw = METALS[metal]?.weapon;
    const forgedText = metal ? ` · ${METALS[metal].name.toLowerCase()}${mw?.toHit ? ` (${mw.toHit > 0 ? '+' : ''}${mw.toHit} to hit)` : ''}${mw?.damage ? ` (${mw.damage > 0 ? '+' : ''}${mw.damage} damage)` : ''}${mw?.bane ? ` (+${mw.bane.dice} ${mw.bane.type} against ${mw.bane.types.join(' and ')})` : ''}` : '';
    return `${w.damage}${b ? `+${b}` : ''} ${w.type}${forgedText}${b ? ` · +${b} to hit` : ''}${w.versatile ? ` · ${w.versatile} two-handed` : ''}${w.range ? ` · range ${metricText(`range ${w.range}`).slice(6)}` : ''}${w.thrown ? ` · thrown ${metricText(`thrown ${w.thrown}`).slice(7)}` : ''}`;
  }
  if (def.armor) {
    const a = ARMOURS[def.id];
    const pts = a ? Object.values(a.cover).reduce((x, y) => x + y, 0) : 0;
    const cond = inst.condition ?? 100;
    const metal = metalOf(inst, def);
    const h = Math.round((a?.hinder ?? 0) * (METALS[metal]?.hinder ?? 1)); const sq = h >= 4 ? 2 : h >= 2 ? 1 : 0;
    const abs = a ? Object.fromEntries(Object.entries(a.abs).map(([k, v]) => [k, v + 5 * b])) : null;
    const by = (type) => (abs ? absorbFor({ abs, metal, condition: cond }, type) : 0);
    const bonus = Object.entries(METALS[metal]?.resist ?? {}).map(([x, v]) => `${x} +${v}`);
    const elems = [[`elements ${by('force')}%`], ...(bonus.length ? [[`(${bonus.join(', ')})`]] : [])];
    return `${FORMS[ARMOUR_FORM[def.id]]?.label ?? 'armour'}${metal ? ` of ${METALS[metal].name.toLowerCase()}` : ''} · edge ${by('slashing')}% · point ${by('piercing')}% · blunt ${by('bludgeoning')}%${` · ${elems.map(([x]) => x).join(' ')}`} · covers ${pts}/100 · condition ${cond}% · hindrance ${h}${h ? ` (−${h} Evasion${sq ? `, −${sq * 1.5} m move` : ''})` : ''}`;
  }
  if (def.cat === 'shield') return `Blocks blows and arrows: 15% + 5% × proficiency${b ? ` + ${5 * b}%` : ''}`;
  if (def.use?.kind === 'heal') return `Heals ${def.use.dice}`;
  if (def.charges) return `${inst.charges ?? def.charges} picks left`;
  return '';
}

/**
 * @param gear  { inventory, equipped, coins }
 * @param o     { str, selected, filter, editable, combat }
 */
export function inventoryHtml(gear, { str = 10, selected = null, filter = 'all', editable = true, combat = false, title = 'Inventory', doll: dollTab = 'arms' } = {}) {
  const weight = carriedWeight(gear.inventory, gear.coins ?? 0);
  const cap = carryCapacity(str);
  const { burdened } = loadLimits(str);
  const used = bagUsed(gear);
  const f = FILTERS.find((x) => x.id === filter) ?? FILTERS[0];
  // The bag shows what is in it; worn and wielded things are on the figure (click them there).
  const list = gear.inventory.filter((x) => !isEquipped(gear, x.uid) && (!f.cats || f.cats.includes(ITEMS_BY_ID[x.id]?.cat)));
  const sel = gear.inventory.find((x) => x.uid === selected) ?? null;

  // A selected ring, bracelet or necklace can be put straight onto an empty finger, wrist or neck.
  const selGroup = sel && editable ? ITEMS_BY_ID[sel.id]?.slot : null;
  const slotBtn = (s, short = s.name) => {
    const inst = gear.inventory.find((x) => x.uid === gear.equipped?.[s.id]);
    const target = !inst && selGroup && SLOT_GROUPS[selGroup]?.includes(s.id);
    if (target) return `<button class="slot target" data-inv="equip" data-slot="${s.id}" data-uid="${esc(sel.uid)}" title="Wear ${esc(itemName(sel))} here (${esc(s.name.toLowerCase())})"><span class="slot-empty" aria-hidden="true">＋</span><span class="slot-name">${esc(short)}</span></button>`;
    return `<button class="slot ${inst ? 'filled' : ''} ${sel && inst?.uid === sel.uid ? 'sel' : ''}" data-inv="select" data-uid="${inst ? esc(inst.uid) : ''}" ${inst ? '' : 'disabled'} title="${esc(s.name)}${inst ? `: ${esc(itemName(inst))}` : ' (empty)'}">
      ${inst ? itemIcon(inst, 'sm') : `<span class="slot-empty" aria-hidden="true">${SLOT_GLYPH[s.id] ?? SLOT_GLYPH.ring}</span>`}
      <span class="slot-name">${esc(short)}</span>
    </button>`;
  };
  const jewels = Object.values(gear.equipped ?? {}).filter((u) => JEWEL_SLOTS.some((j) => gear.equipped[j.id] === u)).length;
  const hand = (h) => JEWEL_SLOTS.filter((j) => j.group === 'ring').slice(h * 5, h * 5 + 5).map((j) => slotBtn(j, j.name.split(' ').slice(1).join(' ').replace(' finger', ''))).join('');
  const dollTabs = `<div class="doll-tabs" role="tablist">
      <button class="chip ${dollTab === 'arms' ? 'sel' : ''}" data-inv="doll" data-doll="arms" aria-pressed="${dollTab === 'arms'}">⚔ Arms &amp; armour</button>
      <button class="chip ${dollTab === 'jewels' ? 'sel' : ''}" data-inv="doll" data-doll="jewels" aria-pressed="${dollTab === 'jewels'}">💍 Jewellery${jewels ? ` (${jewels})` : ''}</button></div>`;
  const doll = dollTab === 'jewels'
    ? `<div class="jewel-doll">
        <div class="jd-row">${slotBtn(JEWEL_SLOTS[0])}</div>
        <div class="jd-row">${slotBtn(JEWEL_SLOTS[1])}${slotBtn(JEWEL_SLOTS[2])}</div>
        <div class="jd-hands"><div class="jd-hand"><h5>Left hand</h5>${hand(0)}</div><div class="jd-hand"><h5>Right hand</h5>${hand(1)}</div></div>
      </div>`
    : SLOTS.map((s) => slotBtn(s)).join('');

  // Each tile is a bag slot; with no filter the free slots show as empty squares.
  const tiles = list.map((x) => `
    <button class="inv-tile ${x.uid === selected ? 'sel' : ''}" data-inv="select" data-uid="${esc(x.uid)}" title="${esc(itemName(x))}${(x.qty ?? 1) > 1 ? ` ×${x.qty}` : ''}">
      ${itemIcon(x)}
    </button>`).join('') + (f.cats ? (list.length ? '' : '<p class="muted small">Nothing of this kind in the bag.</p>')
    : Array.from({ length: Math.max(0, BAG_SLOTS - used) }, () => '<span class="inv-tile empty" aria-hidden="true"></span>').join(''));

  let detail = '<p class="muted small">Select an item to see what it does.</p>';
  if (sel) {
    const def = ITEMS_BY_ID[sel.id];
    const eq = isEquipped(gear, sel.uid);
    const canEquip = !!def.slot;
    const armourLocked = combat && (def.cat === 'armor');
    const offOk = def.weapon && def.weapon.light && !def.weapon.ranged && !eq;
    const r = itemRarity(sel);
    detail = `
      <div class="inv-detail-head">${itemIcon(sel, 'lg')}<div>
        <h4 class="r-text-${r}">${esc(itemName(sel))}${(sel.qty ?? 1) > 1 ? ` <span class="muted">×${sel.qty}</span>` : ''}</h4>
        <p class="small muted">${esc(RARITY_LABEL[r])} ${esc(CATEGORY_LABEL[def.cat] ?? def.cat)}${isMagic(sel) ? ' · magical' : ''}</p>
        ${statLine(sel) ? `<p class="small"><b>${esc(statLine(sel))}</b></p>` : ''}
      </div></div>
      <p class="small">${esc(def.desc)}</p>
      <p class="small muted">Weight ${kg(def.weight * (sel.qty ?? 1))} · worth ${esc(fmtValue(itemValue(sel)))}</p>
      ${editable ? `<div class="row wrap">
        ${canEquip && !eq ? `<button class="btn small primary" data-inv="equip" data-uid="${esc(sel.uid)}" ${armourLocked ? 'disabled title="Putting on armour takes minutes: not during a fight."' : ''}>Equip</button>` : ''}
        ${offOk && slotFor(sel, 'offHand') ? `<button class="btn small" data-inv="equip" data-slot="offHand" data-uid="${esc(sel.uid)}">Off hand</button>` : ''}
        ${eq ? `<button class="btn small" data-inv="unequip" data-uid="${esc(sel.uid)}" ${armourLocked ? 'disabled title="Taking off armour takes minutes: not during a fight."' : ''}>Unequip</button>` : ''}
        ${def.use ? `<button class="btn small primary" data-inv="use" data-uid="${esc(sel.uid)}">${def.use.kind === 'bandage' ? 'Bandage wounds' : def.use.kind === 'light' ? 'Raise the light' : 'Use'}${combat ? ' (action)' : ''}</button>` : ''}
        <button class="btn small danger ghost" data-inv="drop" data-uid="${esc(sel.uid)}">Drop</button>
      </div>` : ''}`;
  }

  return `<div class="inventory">
    <div class="inv-top">
      <h3>${esc(title)}</h3>
      ${coinsHtml(gear.coins ?? 0)}
      <div class="inv-weight ${used >= BAG_SLOTS ? 'over' : ''}" title="The bag holds ${BAG_SLOTS} things. A stack of the same thing shares one slot; what you wear is not in the bag.">
        <span>🎒 Bag: <b>${used} / ${BAG_SLOTS}</b> slots</span><span class="bar"><span style="width:${Math.min(100, (used / BAG_SLOTS) * 100)}%"></span></span>
      </div>
      <div class="inv-weight ${weight > cap ? 'over' : weight > burdened ? 'heavy' : ''}" title="Everything you carry counts, worn gear and coins too. Over ${kg(burdened)} (Strength × 4.5 kg) you are burdened: −3 m speed. ${kg(cap)} (Strength × 6.8 kg) is all you can carry.">
        <span>⚖ ${kilos(weight)} / ${kg(cap)}${weight > cap ? ' · overloaded' : weight > burdened ? ' · burdened' : ''}</span><span class="bar"><span style="width:${Math.min(100, (weight / cap) * 100)}%"></span><i style="left:${(burdened / cap) * 100}%"></i></span>
      </div>
    </div>
    <div class="inv-body">
      <div class="paperdoll ${dollTab === 'jewels' ? 'jewels' : ''}" aria-label="Equipped">${dollTabs}${doll}</div>
      <div class="inv-bag">
        <div class="chips" role="tablist">${FILTERS.map((x) => `<button class="chip ${x.id === f.id ? 'sel' : ''}" data-inv="filter" data-filter="${x.id}" aria-pressed="${x.id === f.id}">${esc(x.name)}</button>`).join('')}</div>
        <div class="inv-grid">${tiles}</div>
      </div>
      <div class="inv-detail" aria-live="polite">${detail}</div>
    </div>
  </div>`;
}

export function fmtValue(cp) {
  const c = splitCoins(cp);
  if (c.gp) return `${c.gp.toLocaleString()} gp${c.sp ? ` ${c.sp} sp` : ''}`;
  if (c.sp) return `${c.sp} sp${c.cp ? ` ${c.cp} cp` : ''}`;
  return `${c.cp} cp`;
}

/** A compact list of loot (a body or chest) with take buttons. */
export function lootHtml({ title, coins, items, note = '', closeAttr = 'data-dg="close-loot"', bag = null }) {
  const empty = !coins && !items.length;
  const full = bag && bag.used >= bag.slots;
  return `<div class="loot-card">
    <div class="foe-head"><h3>${esc(title)}</h3><button class="btn icon small" ${closeAttr} aria-label="Close">✕</button></div>
    ${note ? `<p class="small muted">${esc(note)}</p>` : ''}
    ${bag && !empty ? `<p class="small loot-bag ${full ? 'bad' : ''}">🎒 Your bag: <b>${bag.used} / ${bag.slots}</b> slots${full ? ' (full: only coins, and more of what you already carry, still fit)' : ''} · ⚖ ${kilos(bag.load)} / ${kg(bag.max)}</p>` : ''}
    ${empty ? '<p class="muted small">Nothing left to take.</p>' : `
    <ul class="loot-list">
      ${coins ? `<li><span class="item-icon sm"><img src="assets/items/gold.jpg" alt=""></span><span>${esc(fmtValue(coins))}</span><button class="btn small" data-dg="take" data-uid="coins">Take</button></li>` : ''}
      ${items.map((x) => `<li>${itemIcon(x, 'sm')}<span class="r-text-${itemRarity(x)}">${esc(itemName(x))}${(x.qty ?? 1) > 1 ? ` ×${x.qty}` : ''}${x.from ? ` <small class="muted">· ${esc(x.from)}</small>` : ''}</span><button class="btn small" data-dg="take" data-uid="${esc(x.uid)}">Take</button></li>`).join('')}
    </ul>
    <button class="btn small primary" data-dg="take-all">Take everything</button>`}
  </div>`;
}
