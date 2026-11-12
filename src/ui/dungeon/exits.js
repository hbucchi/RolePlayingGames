/**
 * The ways out of a dungeon floor: the stairs (go deeper, or leave), the safe in town, the
 * checkpoint that keeps gains only at an exit (engine/delve.js), and the boss of the tenth floor
 * (engine/depths.js). Part of the dungeon screen (see ../dungeon-view.js): `ctx` gives access to
 * the shared state `s` and to the functions of the other parts.
 */
import { createMonster } from '../../engine/combat.js';
import { seededRng } from '../../engine/dice.js';
import { MAX_DEPTH, isBossFloor, depthReward, pickBoss } from '../../engine/depths.js';
import { SAFE_SLOTS } from '../../engine/safe.js';
import { formatCoins, isEquipped, bagUsed, BAG_SLOTS, itemName } from '../../engine/items.js';
import { play } from '../audio.js';

export function installExits(ctx) {
  const { $, esc, s } = ctx;

  /**
   * The tenth floor: the master of the deep on its throne at the far end of the hall, perhaps
   * with two guards, and its hoard in two chests beside it (engine/depths.js pickBoss).
   */
  function placeBoss(level) {
    const rng = seededRng(((s.seed * 69069) ^ 0x5bd1e995) >>> 0);
    const { boss, guards } = pickBoss(s.pool ?? ctx.FOE_POOL, level, Math.max(1, s.members.length), rng);
    const th = s.map.throne;
    const m = { ...createMonster(boss, 'boss', { ...th }, 4), aware: false };
    m.boss = true; m.name = `${boss.name}, Master of the Deep`;
    m.legendary = m.legendary ?? bossLegendary(m);
    s.monsters = [m];
    guards.forEach((g, i) => s.monsters.push({ ...createMonster(g, `guard${i + 1}`, { x: th.x + (i ? 4 : -3), y: th.y + 2 }, 4), aware: false }));
    s.features = {
      chests: [{ id: 'hoard1', x: th.x - 3, y: s.map.rooms[0].y, locked: false, opened: false, loot: null, hoard: true },
        { id: 'hoard2', x: th.x + 4, y: s.map.rooms[0].y, locked: false, opened: false, loot: null, hoard: true }],
      traps: [], secretDoors: new Set(), locks: new Map(), totem: null,
    };
  }

  /** A boss with no legendary actions of its own gets one: a blow with its best melee weapon. */
  function bossLegendary(m) {
    const w = [...m.weapons].filter((x) => x.melee).sort((a, b) => avgDmg(b.damage) - avgDmg(a.damage))[0];
    return w ? { count: 1, options: [{ name: w.name, cost: 1, weapon: w }] } : null;
  }
  const avgDmg = (d) => { const r = /(\d+)d(\d+)([+-]\d+)?/.exec(d ?? ''); return r ? r[1] * (Number(r[2]) + 1) / 2 + Number(r[3] ?? 0) : Number(d) || 0; };

  const bossAlive = () => s.map?.boss && s.monsters.some((m) => m.boss && !m.dead);

  /** The record of the deepest floor reached and bosses slain, shown on the menu. */
  function noteRecord(patch) {
    try { const r = JSON.parse(localStorage.getItem('rpg.delve.best') ?? '{}'); const n = { deepest: Math.max(r.deepest ?? 0, patch.deepest ?? 0), bosses: (r.bosses ?? 0) + (patch.boss ? 1 : 0) }; localStorage.setItem('rpg.delve.best', JSON.stringify(n)); } catch { /* storage blocked */ }
  }
  /** The master of the deep falls: a great reward, and the way out opens. */
  function bossSlain(m) {
    const bonus = 100 * MAX_DEPTH * (s.def?.level ?? 1);
    ctx.log(`${m.name} is slain! The hall falls silent; behind the throne the way out stands open. +${Math.round(bonus * ctx.xpRate())} XP for the deed.`, 'good');
    ctx.awardPartyXp(bonus, m.pos);
    noteRecord({ deepest: MAX_DEPTH, boss: true });
  }


  /** Every hero's saved choices and gear, as they stand now. */
  function memberDrafts() { ctx.saveActive(); return s.members.map((m, i) => (i === s.active ? s.draft : m.draft)).filter(Boolean); }
  /** An exit reached: what the party carries now is theirs to keep (engine/delve.js). */
  function keepGains() {
    if (!ctx.keepsCheckpoint) return;
    ctx.saveActive(); ctx.saveParty();
    const back = s.active; const list = [];
    for (let i = 0; i < s.members.length; i++) { ctx.activate(i); list.push(structuredClone(s.draft)); }
    ctx.activate(back);
    ctx.delve.commit(list);
  }
  /** Defeat, or walking away: every hero back to the checkpoint; the floor's gains are lost. */
  function loseDelve() {
    if (!ctx.keepsCheckpoint || !ctx.delve.active()) return [];
    return ctx.delve.restore((d) => ctx.api.restore?.(d));
  }

  /**
   * At the stairs: go deeper (what you carry is safe so far, and the next floor is harder and
   * richer), or leave the dungeon, put the loot in the safe in town, and start again from depth 1.
   */
  function atStairs() {
    if (!ctx.onExit() || s.busy) return;
    if (ctx.place) { ctx.leavePlace(); return; }
    if (s.mode === 'combat') { ctx.banner('You cannot slip away down the stairs while foes are on you.'); return; }
    if (bossAlive()) { ctx.banner('The way out is sealed while the master of this hall lives.'); return; }
    keepGains();
    const el = $('.dg-endscreen'); el.hidden = false;
    if (isBossFloor(s.depth)) {
      el.innerHTML = `<div class="dg-endcard"><h2>The way out</h2>
        <p>The deepest floor is conquered. Stairs behind the throne wind up and up to the daylight. Everything the party carries is safe.</p>
        <p class="small muted">This delve: <b>${s.delve.kills}</b> foes slain · <b>${s.delve.xp.toLocaleString()}</b> XP · <b>${esc(formatCoins(s.delve.coins))}</b> · <b>${s.delve.items}</b> items.</p>
        <div class="row wrap"><button class="btn primary" data-dg="leave-dungeon">Climb out with the treasure</button><button class="btn ghost" data-dg="close-end">Not yet</button></div></div>`;
      return;
    }
    const next = s.depth + 1;
    el.innerHTML = `<div class="dg-endcard"><h2>The way down</h2>
      <p>Stone steps lead into the dark, to ${isBossFloor(next) ? `the last floor (${next} of ${MAX_DEPTH}): one great hall, and the master of the deep waiting in it` : `depth ${next} of ${MAX_DEPTH}`}. What the party carries is safe now: experience, loot and coins are kept even if you fall further down.</p>
      <p class="small">Down there foes are stronger, and everything pays more: ×${depthReward(next).toFixed(2).replace(/\.?0+$/, '')} the experience and coins of the first floor. Or climb out: store your loot in the safe in town and start again from depth 1.</p>
      <p class="small muted">This delve: <b>${s.delve.kills}</b> foes slain · <b>${s.delve.xp.toLocaleString()}</b> XP · <b>${esc(formatCoins(s.delve.coins))}</b> · <b>${s.delve.items}</b> items.</p>
      <div class="row wrap"><button class="btn primary" data-dg="go-deeper">${isBossFloor(next) ? 'Face the master of the deep' : `Go down to depth ${next}`}</button>
      <button class="btn" data-dg="leave-dungeon">Leave the dungeon</button>
      <button class="btn ghost" data-dg="close-end">Not yet</button></div></div>`;
  }

  /** Leaving the dungeon: a strongbox in town (engine/ctx.safe.js), then back to the start. */
  function showSafe(msg = '') {
    keepGains();
    const el = $('.dg-endscreen'); el.hidden = false;
    ctx.saveActive();
    const rows = s.members.map((m, i) => {
      const d = i === s.active ? s.draft : m.draft; if (!d) return '';
      const loot = (d.inventory ?? []).filter((x) => !isEquipped(d, x.uid));
      return `<div class="safe-hero"><h4>${esc(m.hero.name)} <span class="muted small">${bagUsed(d)}/${BAG_SLOTS} in the bag</span></h4>
        ${loot.length ? `<ul class="safe-list">${loot.map((x) => `<li><span>${esc(itemName(x))}${(x.qty ?? 1) > 1 ? ` × ${x.qty}` : ''}</span><button class="btn small" data-dg="safe-store" data-m="${i}" data-uid="${esc(x.uid)}">Store</button></li>`).join('')}</ul>` : '<p class="small muted">Nothing in the bag but what is worn.</p>'}
        ${loot.length ? `<button class="btn small" data-dg="safe-store-all" data-m="${i}">Store all</button>` : ''}</div>`;
    }).join('');
    el.innerHTML = `<div class="dg-endcard safe-card"><h2>The safe</h2>
      <p>Out in the daylight. A strongbox in town keeps what you do not want to carry: ${ctx.safe.used()} of ${SAFE_SLOTS} slots used. Worn and wielded things stay on the heroes; coins stay in their purses.</p>
      ${msg ? `<p class="small warn">${esc(msg)}</p>` : ''}
      <div class="safe-heroes">${rows}</div>
      <div class="row wrap"><button class="btn primary" data-dg="leave-done">Back to town</button></div>
      <p class="small muted">The next time you enter, you start again from depth 1.</p></div>`;
  }
  function safeStore(memberIdx, uid) {
    const back = s.active; ctx.activate(memberIdx);
    const ids = uid ? [uid] : (s.draft.inventory ?? []).filter((x) => !isEquipped(s.draft, x.uid)).map((x) => x.uid);
    let msg = '';
    for (const u of ids) { const r = ctx.safe.store(s.draft, u); if (!r.ok) { msg = r.message; break; } }
    ctx.persist(); ctx.refreshHero();
    ctx.activate(back);
    keepGains();
    play('coins', { volume: 0.5 });
    showSafe(msg);
  }
  function leaveDungeon() {
    keepGains(); ctx.delve.end();
    s.depth = 1;
    ctx.log('The party climbs out into the daylight.', 'good');
    if (ctx.onLeave) ctx.onLeave(); else { $('.dg-endscreen').hidden = true; ctx.newDungeon(1 + Math.floor(Math.random() * 99999)); }
  }

  return { placeBoss, bossLegendary, bossAlive, noteRecord, bossSlain, memberDrafts, keepGains, loseDelve, atStairs, showSafe, safeStore, leaveDungeon };
}
