/**
 * Hero actions out of combat and in it: items, searching, locks, traps, noise, checks and damage.
 * Part of the dungeon screen (see ../dungeon-view.js): `ctx` gives access to the shared state `s`
 * and to the functions of the other parts.
 */
import { rollDice, diceWanted } from '../dice.js';
import { findItem, removeItem, itemDef, makeItem, itemName } from '../../engine/items.js';
import { play } from '../audio.js';
import { roll, rollDie } from '../../engine/dice.js';
import { skillXp, freshResources, monsterSave, sneakAttackDice, concentrationDC } from '../../engine/magic.js';
import { chebyshev, escapeBonus } from '../../engine/combat.js';
import { cellKey, reachableSquares } from '../../engine/movement.js';
import { blockDistance } from '../../engine/size.js';
import { rollChestLoot } from '../../engine/loot.js';
import { BESTIARY_BY_ID } from '../../content/bestiary/index.js';
import { skillCheck, forceDc, NOISE } from '../../engine/features.js';
import { lineOfSight } from '../../engine/vision.js';

export function installActions(ctx) {
  const { s, signed } = ctx;

  // ---------------------------------------------------------------------------
  // Skills: bandages, potions, searching, locks and traps
  // ---------------------------------------------------------------------------

  /** In combat most of these take your action; out of combat they just take a moment. */
  function spendAction(what) {
    if (s.busy) return false;
    if (s.mode === 'combat') {
      if (s.actionUsed) { ctx.banner(`${what} takes your action, and you have used it this turn.`); return false; }
      s.actionUsed = true;
    }
    return true;
  }

  const checkText = (label, c) => `${label}: ${c.d20s.length > 1 ? `d20 (${c.d20s.join(', ')} → ${c.d20})` : `d20 (${c.d20})`} ${signed(c.bonus)}${c.extra ?? ''} = ${c.total} vs DC ${c.dc}`;

  const hasTools = () => (s.draft.inventory.find((x) => x.id === 'thieves-tools' && (x.charges ?? 1) > 0) ?? null);

  function heal(amount, source) {
    const before = s.hero.hp;
    s.hero.hp = Math.min(s.hero.maxHp, s.hero.hp + Math.max(0, amount));
    ctx.float(s.hero.pos, `+${s.hero.hp - before}`, 'heal');
    return s.hero.hp - before;
  }

  /** Bandage (Ultima Online style healing): a Medicine check; success heals 1d6 + your Medicine bonus. */
  function bandage() {
    const inst = findItem(s.draft.inventory, 'bandage');
    if (!inst) { ctx.banner('You have no bandages.'); return; }
    if (s.hero.hp >= s.hero.maxHp) { ctx.banner('You are not wounded.'); return; }
    if (!spendAction('Bandaging')) return;
    const bonus = s.hero.skills.medicine ?? 0;
    const kit = !!findItem(s.draft.inventory, 'healers-kit');
    const c = heroCheck(bonus, 10, { mode: kit ? 'advantage' : 'normal' });
    removeItem(s.draft.inventory, inst.uid, 1);
    play('bandage', { volume: 0.8 });
    if (c.ok) {
      const r = roll('1d6');
      const got = heal(r.total + Math.max(0, bonus), 'bandage');
      ctx.log(`${s.hero.name} binds their wounds. ${checkText('Medicine', c)}${kit ? ' (healer\'s kit: advantage)' : ''}. Success: heals 1d6 (${r.total}) + ${Math.max(0, bonus)} = ${got} HP.`, 'heal');
      ctx.awardXp(skillXp(10, s.def.level), s.hero.pos);
    } else {
      ctx.log(`${s.hero.name} fumbles the bandage. ${checkText('Medicine', c)}. The bandage is wasted.`, 'info');
      ctx.float(s.hero.pos, 'fumbled', 'muted');
    }
    s.lastCheck = { text: `${checkText('Medicine', c)}: ${c.ok ? 'healed' : 'wasted'}`, ok: c.ok };
    ctx.persist(); ctx.redraw();
  }

  function useItem(uid) {
    const inst = s.draft.inventory.find((x) => x.uid === uid);
    const def = itemDef(inst);
    if (!def?.use) return;
    if (def.use.kind === 'bandage') { bandage(); return; }
    if (def.use.kind === 'light') { raisePhial(); return; }
    if (def.use.kind === 'heal') {
      if (s.hero.hp >= s.hero.maxHp) { ctx.banner('You are not wounded.'); return; }
      if (!spendAction(`Using ${def.name.toLowerCase()}`)) return;
      const r = roll(def.use.dice);
      removeItem(s.draft.inventory, uid, 1);
      play(def.cat === 'consumable' && /potion/.test(def.id) ? 'potion' : 'bandage', { volume: 0.8 });
      const got = heal(r.total);
      ctx.log(`${s.hero.name} uses ${def.name.toLowerCase()}: ${def.use.dice} = ${r.total}, regains ${got} HP.`, 'heal');
      ctx.persist(); ctx.redraw();
    }
  }

  /** Search: an Investigation check against every hidden trap and secret door nearby. */
  function search() {
    if (!spendAction('Searching')) return;
    // Look with your eyes (Perception) or reason it out (Investigation): whichever you are better at.
    const useInv = (s.hero.skills.investigation ?? 0) >= (s.hero.skills.perception ?? 0);
    const skillName = useInv ? 'Investigation' : 'Perception';
    const bonus = s.hero.skills[useInv ? 'investigation' : 'perception'] ?? 0;
    const c = heroCheck(bonus, 0, { mode: s.def.keenSearch ? 'advantage' : 'normal' });
    let xpFound = 0;
    play('dice', { volume: 0.6 });
    const found = []; let missed = 0;
    // Searching means turning round and looking everywhere: the whole room you stand in, and
    // anything within 6 squares, in every direction (not just the way you face), unless a wall
    // or a closed door hides it.
    const h = s.hero.pos;
    const inRoom = (p) => s.map.rooms.some((r) => h.x >= r.x && h.x < r.x + r.w && h.y >= r.y && h.y < r.y + r.h && p.x >= r.x && p.x < r.x + r.w && p.y >= r.y && p.y < r.y + r.h);
    const op = ctx.opaque();
    const searchable = (p) => (inRoom(p) || chebyshev(p, h) <= 6) && lineOfSight(h, p, op).visible;
    for (const t of s.features.traps) {
      if (t.found || t.sprung || !searchable(t)) continue;
      if (c.total >= t.dc) { t.found = true; s.revealed.add(cellKey(t.x, t.y)); found.push(`a ${t.name}`); xpFound += skillXp(t.dc, s.def.level); } else missed++;
    }
    for (const k of [...s.features.secretDoors]) {
      const [x, y] = k.split(',').map(Number);
      if (chebyshev({ x, y }, s.hero.pos) > 4) continue;
      if (c.total >= ctx.secretDC()) { ctx.revealSecret(k); found.push('a secret door'); xpFound += skillXp(ctx.secretDC(), s.def.level); } else missed++;
    }
    if (xpFound) ctx.awardXp(xpFound, s.hero.pos);
    const roll20 = `${skillName}${s.def.keenSearch ? ' (Burglar\'s Eye: advantage)' : ''}: ${c.d20s.length > 1 ? `d20 (${c.d20s.join(', ')} → ${c.d20})` : `d20 (${c.d20})`} ${signed(bonus)}${c.extra} = ${c.total}`;
    ctx.log(`${s.hero.name} searches the area. ${roll20}. ${found.length ? `Found ${found.join(', ')}!` : 'Nothing found.'}`, found.length ? 'good' : 'info');
    s.lastCheck = { text: `${roll20}: ${found.length ? `found ${found.join(', ')}` : 'nothing found here'}`, ok: !!found.length };
    if (!found.length) ctx.banner(missed ? 'You find nothing... yet something feels off.' : 'You find nothing hidden here.');
    ctx.redraw();
  }

  function raisePhial() {
    if (s.phialUsed) { ctx.banner('The phial\'s light needs time to gather again (once per delve).'); return; }
    s.phialUsed = true;
    const found = [];
    for (const t of s.features.traps) if (!t.found && s.visible.has(cellKey(t.x, t.y))) { t.found = true; found.push(t.name); }
    for (const k of [...s.features.secretDoors]) { const [x, y] = k.split(',').map(Number); if (chebyshev({ x, y }, s.hero.pos) <= 8) { ctx.revealSecret(k); found.push('secret door'); } }
    play('potion', { volume: 0.6 });
    ctx.log(`Silver light pours from the phial! ${found.length ? `It reveals: ${found.join(', ')}.` : 'Nothing is hidden nearby.'}`, 'good');
    ctx.redraw();
  }

  const lockLabel = (t) => (t.kind === 'chest' ? 'the chest' : t.kind === 'creature' ? 'the shackles' : 'the door');

  function lockOf(t) {
    if (t.kind === 'creature') { const m = s.monsters.find((x) => x.id === t.id); return m?.cond?.bound?.dc ? { dc: m.cond.bound.dc, obj: m } : null; }
    if (t.kind === 'chest') { const c = s.features.chests.find((x) => x.id === t.id); return c?.locked ? { dc: c.dc, obj: c } : null; }
    const l = s.features.locks.get(t.id); return l ? { dc: l.dc, material: l.material ?? 'wood', obj: l } : null;
  }

  function unlock(t) {
    if (t.kind === 'creature') { const m = s.monsters.find((x) => x.id === t.id); if (m) ctx.freeCreature(m); return; }
    if (t.kind === 'chest') s.features.chests.find((x) => x.id === t.id).locked = false;
    else s.features.locks.delete(t.id);
  }

  /** Pick a lock: DEX check, plus proficiency if trained with thieves' tools. A bad failure snaps a pick. */
  function pickLock(t) {
    const lock = lockOf(t); if (!lock) return;
    const tools = hasTools();
    if (!tools) { ctx.banner('You need thieves\' tools (with picks left) to pick a lock.'); return; }
    if (!spendAction('Picking a lock')) return;
    const bonus = s.def.toolBonus;
    const c = heroCheck(bonus, lock.dc);
    play('lockpick', { volume: 0.8 });
    let extra = '';
    if (c.ok) { unlock(t); ctx.awardXp(skillXp(lock.dc, s.def.level), s.hero.pos); }
    else if (c.margin <= -5) { tools.charges = (tools.charges ?? 10) - 1; extra = ` A pick snaps! (${tools.charges} left)`; }
    const text = `${checkText('Thieves\' tools (DEX)', c)}. ${c.ok ? `The lock of ${lockLabel(t)} clicks open.` : 'The lock resists.'}${extra}`;
    ctx.log(`${s.hero.name} picks the lock. ${text}`, c.ok ? 'good' : 'info');
    s.lastCheck = { text, ok: c.ok };
    ctx.persist(); ctx.redraw();
  }

  /** Force a lock: Strength (Athletics). A crowbar gives advantage. It is loud: nearby foes come to look. */
  /**
   * Force a lock with Athletics (features.js: forceDc). An oak door always gives way: success eases
   * it open quietly, failure splinters it open with a crash. Iron doors, chests and shackles open
   * only on a success. Any failure is loud: foes within 10 squares hear it, 15 on a natural 1.
   */
  function forceLock(t) {
    const lock = lockOf(t); if (!lock) return;
    if (!spendAction('Forcing a lock')) return;
    const bonus = s.hero.skills.athletics ?? 0;
    const bar = !!findItem(s.draft.inventory, 'crowbar');
    const dc = forceDc(lock, t.kind);
    const c = heroCheck(bonus, dc, { mode: bar ? 'advantage' : 'normal' });
    const wood = t.kind === 'door' && lock.material !== 'iron';
    const fumble = !c.ok && c.d20 === 1;
    const opens = c.ok || wood;
    play(opens ? 'door-open' : 'swing-miss', { volume: c.ok ? 0.6 : 0.95 });
    if (opens) unlock(t);
    if (c.ok) ctx.awardXp(skillXp(dc, s.def.level), s.hero.pos);
    const what = lockLabel(t); const What = `${what[0].toUpperCase()}${what.slice(1)}`;
    const outcome = c.ok
      ? (t.kind === 'door' ? `${What} gives way quietly.` : `${What} ${t.kind === 'creature' ? 'burst' : 'bursts'} open.`)
      : wood ? `${What} splinters open with a crash${fumble ? ' that echoes far down the halls' : ''}!`
        : `${What} holds, and the clang rings out${fumble ? ' far and wide' : ''}.`;
    const text = `${checkText(`Athletics${bar ? ' (crowbar: advantage)' : ''}`, c)}. ${outcome}`;
    ctx.log(`${s.hero.name} tries to force ${what}. ${text}`, c.ok ? 'good' : opens ? 'warn' : 'info');
    s.lastCheck = { text, ok: c.ok };
    if (!c.ok) makeNoise(fumble ? NOISE.fumble : NOISE.fail);
    ctx.persist(); ctx.redraw();
  }

  /** Which room an iron door leads into, for the key's name: "the Armoury door". */
  function doorName(k) {
    const [x, y] = k.split(',').map(Number);
    const room = s.map.rooms.find((r) => [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => x + dx >= r.x && x + dx < r.x + r.w && y + dy >= r.y && y + dy < r.y + r.h && !r.entrance))
      ?? s.map.rooms.find((r) => [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => x + dx >= r.x && x + dx < r.x + r.w && y + dy >= r.y && y + dy < r.y + r.h));
    return room?.name ? `${room.name} door` : 'an iron door';
  }
  /** The key for a door, if the hero carries it. */
  const keyFor = (k) => s.draft?.inventory.find((it) => it.id === 'iron-key' && it.door === k) ?? null;
  /** Turn the key: the door opens quietly, and the key stays in the lock (it opens nothing else). */
  function useKey(t) {
    const key = keyFor(t.id); if (!key) return;
    if (!spendAction('Unlocking a door')) return;
    s.draft.inventory = s.draft.inventory.filter((it) => it !== key);
    unlock(t);
    play('door-open', { volume: 0.6 });
    ctx.log(`${s.hero.name} turns the ${itemName(key).toLowerCase()} in the lock. The iron door swings open; the key stays in the lock.`, 'good');
    s.lastCheck = { text: 'Unlocked with its key', ok: true };
    ctx.persist(); ctx.redraw();
  }

  /** Noise wakes foes within `radius` squares: they come looking for you. */
  function makeNoise(radius, limit = Infinity) {
    // Only foes with a way to reach you come running (a walk of up to ~4 turns).
    const blocked = new Set([...ctx.terrainBlocked()]);
    const near = ctx.foes().filter((m) => !m.aware && !m.calm && ctx.edist(m, s.hero) <= radius);
    const woken = near.filter((m) => [...reachableSquares(s.map, m.pos, m.speed * 4, { blocked, size: m.size ?? 1 }).values()].some((c) => blockDistance(c, m.size ?? 1, s.hero.pos, 1) <= 1))
      .sort((a, b) => ctx.edist(a, s.hero) - ctx.edist(b, s.hero)).slice(0, limit);
    if (!woken.length) return 0;
    woken.forEach((m) => { m.aware = true; });
    ctx.log('The noise echoes through the halls... something stirs.', 'warn');
    ctx.banner('Something heard that!');
    ctx.enterCombat(woken);
    return woken.length;
  }

  function disarm(trap) {
    const tools = hasTools();
    if (!tools) { ctx.banner('You need thieves\' tools to disarm a trap.'); return; }
    if (!spendAction('Disarming a trap')) return;
    const c = heroCheck(s.def.toolBonus, trap.dc);
    play('lockpick', { volume: 0.7 });
    if (c.ok) {
      trap.disarmed = true;
      ctx.log(`${s.hero.name} disarms the ${trap.name}. ${checkText('Thieves\' tools (DEX)', c)}.`, 'good');
      s.lastCheck = { text: `${checkText('Thieves\' tools', c)}: disarmed`, ok: true };
      ctx.awardXp(skillXp(trap.dc, s.def.level) * 2, trap);
      s.target = null;
    } else if (c.margin <= -5) {
      ctx.log(`${s.hero.name} slips while disarming the ${trap.name}! ${checkText('Thieves\' tools (DEX)', c)}.`, 'bad');
      trap.found = false; ctx.springTrap(trap); s.target = null;
    } else {
      ctx.log(`${s.hero.name} cannot work out the ${trap.name}'s mechanism. ${checkText('Thieves\' tools (DEX)', c)}.`, 'info');
      s.lastCheck = { text: `${checkText('Thieves\' tools', c)}: not yet`, ok: false };
    }
    ctx.redraw();
  }

  function openChest(c) {
    if (c.locked) { ctx.banner('The chest is locked.'); return; }
    if (!c.opened) {
      c.opened = true;
      c.loot ??= rollChestLoot(s.def.level ?? 1); // a campaign chest holds what was put in it
      // The key to an iron door somewhere in this dungeon (features.js: one key, one door).
      if (c.keyFor && !c.loot.items.some((it) => it.door === c.keyFor)) c.loot.items.unshift(makeItem('iron-key', 1, { door: c.keyFor, label: doorName(c.keyFor) }));
      play('chest-open', { volume: 0.9 });
      ctx.log(`${s.hero.name} opens a chest.`, 'loot');
      const said = ctx.campaign?.event({ kind: 'chest', id: c.id });
      if (said) ctx.log(said, 'good');
    }
    s.target = { kind: 'chest', id: c.id };
    ctx.redraw();
  }

  // ---------------------------------------------------------------------------
  // Magic and class abilities
  // ---------------------------------------------------------------------------

  /** The numbers the rest/resource rules need about the hero. */
  const magicHero = () => ({
    level: s.def.level, casterType: s.def.magic?.type, abilities: s.def.magic?.abilities ?? [], cls: s.def.cls,
    hitDie: s.def.hitDie, conMod: s.def.conMod,
  });

  /** After a level-up: new slots and uses appear (already spent ones stay spent), +1 hit die. */
  function growResources() {
    const fresh = freshResources(magicHero());
    const r = s.res;
    const gained = fresh.maxSlots.map((n, i) => n - (r.maxSlots[i] ?? 0));
    r.slots = fresh.maxSlots.map((n, i) => Math.min(n, (r.slots[i] ?? 0) + Math.max(0, gained[i])));
    r.maxSlots = fresh.maxSlots;
    for (const [id, n] of Object.entries(fresh.uses)) if (r.uses[id] === undefined) r.uses[id] = n;
    r.hitDice = Math.min(s.def.level, r.hitDice + 1);
    if (s.def.cls === 'warden') r.pool += 5;
    r.level = s.def.level;
  }

  function refreshAC() {
    if (!s.hero || !s.def) return;
    s.hero.ac = s.def.ac + (s.buffs.shield ? 5 : 0) + (s.buffs.faith ? 2 : 0);
  }

  const helpless = (m) => !!(m.cond?.asleep || m.cond?.paralyzed || m.cond?.stun > 0);

  /** A monster's saving throw: d20 + its save bonus against a DC. */
  function monsterRoll(m, ability, dc) {
    const stat = BESTIARY_BY_ID[m.statId];
    const bonus = monsterSave(stat, ability);
    const d20 = rollDie(20);
    return { d20, bonus, total: d20 + bonus, dc, ok: d20 + bonus >= dc };
  }

  /** Conditions that cost a monster its turn. Returns true if it skips the turn. */
  async function conditionSkip(m) {
    const c = m.cond ??= {};
    if (m.surprised) { m.surprised = false; if (ctx.canSee(m)) ctx.log(`${m.name} is caught by surprise and loses its turn.`, 'good'); return true; }
    if (c.asleep) return true;
    if (c.petrified) { if (ctx.canSee(m)) ctx.log(`${m.name} stands frozen in stone.`, 'good'); return true; }
    if (c.grappled) {
      // Trying to break a grapple: its Athletics or Acrobatics against the DC set by the grapple.
      const st = BESTIARY_BY_ID[m.statId]; const r = rollDie(20) + escapeBonus(st); const dc = c.grappled.dc;
      if (r >= dc) { delete c.grappled; ctx.log(`${m.name} wrenches free of the grapple (${r} vs DC ${dc}).`, 'warn'); }
    }
    if (c.stun > 0) { c.stun--; if (ctx.canSee(m)) ctx.log(`${m.name} is stunned and cannot act.`, 'good'); return true; }
    if (c.paralyzed) {
      const sv = monsterRoll(m, 'wis', c.paralyzed);
      if (sv.ok) { delete c.paralyzed; ctx.log(`${m.name} breaks free of the hold (WIS save ${sv.total} vs DC ${sv.dc}).`, 'warn'); } else ctx.log(`${m.name} stays held fast (WIS save ${sv.total} vs DC ${sv.dc}).`, 'good');
      return true;
    }
    return false;
  }

  /** Attacking or harming a creature starts a fight. Creatures that had not noticed you are surprised. */
  function provoke(targets) {
    // Harming a calmed creature ends the truce; harming an enthralled one breaks the spell.
    for (const m of targets) {
      if (!m || m.dead) continue;
      if (m.calm) { m.calm = false; ctx.log(`${m.name} feels betrayed and attacks!`, 'warn'); }
      if (m.side === 'ally' && m.enthralled) ctx.endAlliance(m, `The pain breaks the spell on ${m.name}!`);
      else if (m.side) { m.hurtByParty = true; }
    }
    const hit = targets.filter((m) => m && !m.dead && !m.side);
    if (!hit.length) return;
    if (s.mode === 'combat') {
      const late = hit.filter((m) => !m.aware);
      late.forEach((m) => { m.aware = true; m.unnoticed = false; });
      if (late.length) ctx.enterCombat(late);
      return;
    }
    const group = ctx.foes().filter((m) => hit.includes(m) || (ctx.inSight(m) && !m.cond?.asleep && !m.calm));
    for (const m of group) { if (!m.aware) m.surprised = true; m.aware = true; m.unnoticed = false; }
    s.sneak = null;
    ctx.enterCombat(group);
  }

  /** Bless (+1d4 to attacks and saves) and an inspiration die (spent on the next roll). */
  function rollBoosts({ attack = false, save = false } = {}) {
    let total = 0; let text = '';
    if (s.buffs.bless && (attack || save)) { const r = rollDie(4); total += r; text += ` + bless ${r}`; }
    if (s.buffs.inspiration) {
      const sides = Number(s.buffs.inspiration.slice(1)); const r = rollDie(sides);
      total += r; text += ` + inspiration ${r}`; delete s.buffs.inspiration;
    }
    return { total, text };
  }

  /** A skill check or save by the hero, with boosts applied. */
  function heroCheck(bonus, dc, { mode = 'normal', save = false } = {}) {
    const c = skillCheck(bonus, dc, { mode });
    const b = rollBoosts({ save });
    c.total += b.total; c.extra = b.text; c.ok = c.total >= dc; c.margin = c.total - dc;
    // The dice play out beside the result (checks are told at once; the dice catch up).
    if (diceWanted(true) && c.d20s?.length) {
      const kept = c.d20s.indexOf(c.d20 ?? c.d20s[0]);
      rollDice({ groups: [{ dice: c.d20s.map((v, i) => ({ sides: 20, value: v, dropped: c.d20s.length > 1 && i !== kept })), caption: `${bonus >= 0 ? '+' : ''}${bonus}${b.total ? ` +${b.total}` : ''} vs DC ${dc}` }],
        verdict: c.ok ? 'Success' : 'Failure', verdictKind: c.ok ? 'good' : 'bad', parent: ctx.viewport.parentElement, fast: true });
    }
    return c;
  }

  /** Extra damage on a hero's weapon hit: Sneak Attack, Hunter's Mark, Warden's Wrath; Ensnaring Strike. */
  function hitExtras(target, weapon, opts, ranged, crit) {
    let total = 0; const text = [];
    const rollX = (dice) => roll(crit ? dice.replace(/^(\d+)d/, (_, n) => `${n * 2}d`) : dice).total;
    if (s.def.sneak && !s.sneakUsed && (weapon.finesse || ranged) && opts.mode === 'advantage') {
      const d = rollX(sneakAttackDice(s.def.level)); total += d; s.sneakUsed = true; text.push(`Sneak Attack +${d}`);
    }
    if (s.buffs.mark === target.id) { const d = rollX('1d6'); total += d; text.push(`Hunter's Mark +${d}`); }
    if (s.buffs.smite && !ranged) {
      const d = rollX(s.buffs.smite.dice); total += d; text.push(`Warden's Wrath +${d} radiant`); delete s.buffs.smite;
      play('spell-heal', { volume: 0.7 });
    }
    if (s.buffs.ensnare) {
      delete s.buffs.ensnare;
      const sv = monsterRoll(target, 'str', s.def.caster?.dc ?? 12);
      if (!sv.ok) { (target.cond ??= {}).restrained = s.def.caster?.dc ?? 12; text.push('thorns restrain it'); } else text.push('it shrugs off the thorns');
    }
    return { total, text };
  }

  /** Damage to the hero: temporary hit points first; Ward against Death; concentration checks. */
  function damageHero(n) {
    let left = Math.max(0, n);
    if (s.hero.tempHp) { const t = Math.min(s.hero.tempHp, left); s.hero.tempHp -= t; left -= t; }
    s.hero.hp = Math.max(0, s.hero.hp - left);
    ctx.bleed(s.hero, left);
    if (s.hero.hp === 0 && s.buffs.deathward) { s.hero.hp = 1; delete s.buffs.deathward; ctx.log('The Ward against Death flares: you drop to 1 hit point instead!', 'heal'); }
    if (left > 0 && s.res?.concentration && s.hero.hp > 0) {
      const dc = concentrationDC(left);
      const c = heroCheck(s.def.saves?.con ?? 0, dc, { save: true });
      if (!c.ok) { ctx.log(`Concentration broken! ${checkText('CON save', c)}.`, 'bad'); ctx.endConcentration(); }
    }
    return left;
  }

  function damageMonster(m, n) {
    if (m.cond?.petrified && n > 0) n = Math.floor(n / 2); // stone resists all damage
    m.hp = Math.max(0, m.hp - n);
    ctx.bleed(m, n);
    if (m.cond?.asleep && n > 0) { m.cond.asleep = false; if (m.hp > 0) ctx.log(`${m.name} wakes with a start!`, 'warn'); }
    if (m.hp <= 0) ctx.bleed(m, m.maxHp, true);
    return n;
  }

  function finishIfDead(m) {
    if (m.hp > 0 || m.dead) return;
    m.dead = true;
    play(ctx.cry(m, 'death'), { delay: 150 });
    if (s.selectedId === m.id) s.selectedId = null;
    ctx.onKill(m);
  }

  return { useKey, keyFor, doorName, spendAction, checkText, hasTools, heal, bandage, useItem, search, raisePhial, lockLabel, lockOf, unlock, pickLock, forceLock, makeNoise, disarm, openChest, magicHero, growResources, refreshAC, helpless, monsterRoll, conditionSkip, provoke, rollBoosts, heroCheck, hitExtras, damageHero, damageMonster, finishIfDead };
}
