/**
 * Monster and ally turns: movement, powers and spells, lingering ground, conditions.
 * Part of the dungeon screen (see ../dungeon-view.js): `ctx` gives access to the shared state `s`
 * and to the functions of the other parts.
 */
import { lineOfSight } from '../../engine/vision.js';
import { immobile, planMonsterTurn, facingToward, rollInitiative } from '../../engine/combat.js';
import { GROUND, areaCells, canUse, powerRange, spend, rollRecharge } from '../../engine/monster-magic.js';
import { cellKey } from '../../engine/movement.js';
import { TILE } from '../../engine/dungeon.js';
import { cellsOf, centerOf, spanOf, dims, rotated, blockDistance } from '../../engine/size.js';
import { play } from '../audio.js';
import { roll, rollDie } from '../../engine/dice.js';

export function installMonsterTurns(ctx) {
  const { reduceMotion, s, sleep } = ctx;

  /**
   * Run monster turns in initiative order until it is the hero's turn again.
   * fromStart: begin at the top of the order (a fresh combat where goblins won initiative);
   * otherwise begin just after the hero. Wrapping past the end starts a new round.
   */
  async function runMonsterTurns(fromStart = false) {
    s.busy = true; ctx.saveActive(); ctx.redraw();
    const heroIdx = s.order.findIndex((o) => o.id === s.hero?.id);
    let i = fromStart ? 0 : heroIdx + 1;
    let next = null;
    for (let guard = 0; guard < s.order.length * 2 + 2; guard++, i++) {
      if (i >= s.order.length) {
        i = 0; s.round++;
        for (const fx of s.effects) fx.rounds--;
        const gone = s.effects.filter((fx) => fx.rounds <= 0);
        if (gone.length) {
          s.effects = s.effects.filter((fx) => fx.rounds > 0); syncGround();
          const kinds = [...new Set(gone.map((fx) => fx.kind))];
          ctx.log(kinds.map((k) => ({ firewall: 'The wall of fire gutters out.', fire: 'The burning ground dies down to embers.', ice: 'The ice melts away.', rubble: 'The dust settles; the broken ground is passable again.', poison: 'The poison cloud thins and is gone.' }[k] ?? '')).join(' '), 'info');
        }
      }
      const slot = s.order[i];
      if (slot.hero) {
        const h = ctx.partyAlive().find((x) => x.id === slot.id);
        if (h) { next = h; break; }
        continue;
      }
      const m = s.monsters.find((x) => x.id === slot.id);
      if (!m || m.dead || (!m.aware && m.side !== 'ally') || m.calm) continue;
      for (const fx of s.effects) if (ctx.inEffect(m, fx)) { const t = ctx.burnIn(m, fx); if (t) { ctx.log(t, 'good'); await sleep(ctx.PAUSE_MS / 2); } }
      if (m.dead) continue;
      tickAllyTime(m);
      if (await ctx.conditionSkip(m)) { endOfTurnSaves(m); continue; }
      if (m.side === 'ally') { await allyTurn(m); endOfTurnSaves(m); continue; }
      // Each monster goes for the nearest hero or ally it can see (or the nearest at all);
      // a taunted one goes for whoever taunted it.
      const targets = [...ctx.partyAlive(), ...ctx.allies()];
      if (!ctx.partyAlive().length) break;
      const sees = (h) => lineOfSight(m.pos, h.pos, ctx.opaque()).visible;
      targets.sort((a, b) => (sees(b) - sees(a)) || ctx.edist(a, m) - ctx.edist(b, m));
      const taunter = m.cond?.taunt && ctx.partyAlive().find((h) => h.id === m.cond.taunt.id);
      const target = taunter ?? targets[0];
      ctx.activate(ctx.memberIndex(target.isHero ? target : [...ctx.partyAlive()].sort((a, b) => ctx.edist(a, m) - ctx.edist(b, m))[0]));
      const acted = await monsterTurn(m, target);
      if (m.cond?.taunt && --m.cond.taunt.rounds <= 0) delete m.cond.taunt;
      endOfTurnSaves(m);
      if (s.hero.hp <= 0 || ctx.partyDown()) {
        if (ctx.partyDown()) { s.busy = false; ctx.showEnd('defeat'); return; }
        ctx.log(`${s.hero.name} falls, unconscious! The others fight on.`, 'bad');
      }
      // A hunter that can neither reach nor see you for two rounds loses interest.
      if (!acted && !ctx.canSee(m)) { m.idle = (m.idle ?? 0) + 1; if (m.idle >= 2) { m.aware = false; m.idle = 0; ctx.log(`Somewhere in the dark, a ${m.name.toLowerCase()} gives up the hunt.`, 'info'); } } else m.idle = 0;
    }
    s.order = s.order.filter((o) => { const m = s.monsters.find((x) => x.id === o.id); return (o.hero && ctx.partyAlive().some((h) => h.id === o.id)) || (m && !m.dead && !m.calm && (m.aware || m.side === 'ally')); });
    s.busy = false;
    if (next) ctx.activate(ctx.memberIndex(next));
    ctx.startHeroTurn();
    ctx.banner(s.members.length > 1 ? `Round ${s.round}: ${s.hero.name}'s turn` : `Round ${s.round}: your turn`);
    ctx.keepInView(s.hero.pos);
    // Goblins that noticed the hero during the enemy turns join the fight now.
    const late = ctx.fighting().filter((m) => !s.order.some((o) => o.id === m.id));
    if (late.length) ctx.enterCombat(late);
    ctx.checkCombatOver();
    ctx.redraw();
  }

  async function monsterTurn(m, target = s.hero, { moveOnly = false } = {}) {
    m.reaction = true; m.burnedThisTurn = false;
    ctx.banner(`${m.name}'s turn`);
    await startOfMonsterTurn(m);
    if (m.dead) return true;
    if (target && !immobile(m)) turnBody(m, target.pos);
    if (!moveOnly && target && target.hp > 0) {
      const power = choosePower(m, target);
      if (power) { await castPower(m, power, target); await sleep(ctx.PAUSE_MS / 2); return true; }
    }
    // Prone: standing up costs half its movement. Bound, grappled or restrained: it cannot move at all.
    let speed = m.speed;
    if (m.cond?.prone) { delete m.cond.prone; speed = Math.floor(speed / 2); if (ctx.canSee(m)) ctx.log(`${m.name} gets back to its feet.`, 'info'); }
    if (immobile(m)) speed = 0;
    let plan = planMonsterTurn({ m: { ...m, speed }, hero: target, map: s.map, opaque: ctx.opaque(), blocked: new Set([...ctx.occupied(m), ...ctx.terrainBlocked()]) });
    if (moveOnly) plan = plan.filter((p) => p.type === 'move');
    let disengaged = false;
    if (!plan.length || (plan.length === 1 && plan[0].type === 'wait')) return false;
    for (const step of plan) {
      if (step.type === 'flee') { disengaged = !!m.nimble; if (ctx.canSee(m)) ctx.log(`${m.name} panics and flees!`, 'info'); }
      if (step.type === 'disengage') { disengaged = true; if (ctx.canSee(m)) ctx.log(`${m.name} slips away nimbly (Nimble Escape: Disengage).`, 'info'); }
      if (step.type === 'move' && immobile(m)) { if (ctx.canSee(m) && step.path.length > 1) ctx.log(`${m.name} strains against its bonds but cannot move.`, 'info'); continue; }
      if (step.type === 'move') {
        for (const p of step.path.slice(1)) {
          const wasAdjacent = ctx.edist(m, s.hero) <= 1;
          m.facing = facingToward(m.pos, p);
          m.pos = { x: p.x, y: p.y };
          ctx.openDoorAt(p);
          for (const fx of s.effects) if (fx.dice && ctx.inEffect(m, fx) && !m.burnedThisTurn) { m.burnedThisTurn = true; const t = ctx.burnIn(m, fx); if (t) ctx.log(t, 'good'); }
          if (m.dead) return true;
          if (!m.side && wasAdjacent && ctx.edist(m, s.hero) > 1 && !disengaged && !m.flyby && !m.cond?.flee && s.hero.reaction) await ctx.heroOpportunityAttack(m);
          if (m.dead) return;
          ctx.updateVision(); ctx.redraw(); await sleep(ctx.STEP_MS);
        }
      }
      if (step.type === 'attack') {
        m.facing = facingToward(m.pos, target.pos);
        await ctx.doAttack(m, target, step.weapon);
        if (target.hp <= 0) return true;
      }
    }
    await sleep(ctx.PAUSE_MS / 2);
    return true;
  }

  // ---------------------------------------------------------------------------
  // Magic changes the ground for a while: fire burns, ice and rubble slow, poison chokes
  // ---------------------------------------------------------------------------

  /** Recompute which squares are slow to cross because of lingering magic. */
  function syncGround() {
    s.map.temp = new Map();
    for (const fx of s.effects) {
      const cost = GROUND[fx.kind]?.cost ?? 1;
      if (cost > 1) for (const c of fx.cells) s.map.temp.set(cellKey(c.x, c.y), Math.max(cost, s.map.temp.get(cellKey(c.x, c.y)) ?? 1));
    }
    s.reach = ctx.heroReach();
  }

  function addGround(kind, cells, rounds, { dc = 12, owner = null } = {}) {
    if (!cells.length || !rounds) return;
    const g = GROUND[kind] ?? {};
    s.effects.push({ id: `${kind}-${Math.random().toString(36).slice(2, 7)}`, kind, cells: cells.filter((c) => ctx.isFloor(c.x, c.y)), rounds, dc, dice: g.dice ?? null, save: g.save ?? null, damageType: g.type ?? null, owner });
    syncGround();
  }

  /** A hero's own saving throw (switching to that hero for a moment). */
  function saveOf(e, ability, dc) {
    if (!e.isHero) return ctx.monsterRoll(e, ability, dc);
    const back = s.active; ctx.activate(ctx.memberIndex(e));
    const c = ctx.heroCheck(s.def.saves?.[ability] ?? 0, dc, { save: true });
    const evasion = !!s.def.evasion && ability === 'dex';
    ctx.activate(back);
    return { ok: c.ok, total: c.total, dc, evasion };
  }

  function hurt(e, n) {
    if (!(n > 0)) return 0;
    if (e.isHero) { const back = s.active; ctx.activate(ctx.memberIndex(e)); ctx.damageHero(n); ctx.activate(back); } else { n = ctx.damageMonster(e, n); ctx.finishIfDead(e); }
    ctx.float(e.pos, `−${n}`, e.isHero || e.side ? 'bad' : 'good'); ctx.flashHit(e);
    return n;
  }

  /** Conditions a monster's magic puts on a hero or anyone else. */
  function riderOn(e, rider, dc) {
    const c = e.cond ??= {};
    if (rider === 'flee') { if (e.isHero) c.frightened = { dc, save: 'wis' }; else c.flee = 2; }
    if (rider === 'restrain') c.restrained = dc;
    if (rider === 'mock') c.mock = true;
    if (rider === 'prone') c.prone = true;
  }

  /** End of a hero's turn: a save to shake off fear or bonds. */
  function heroEndOfTurnSaves() {
    const c = s.hero?.cond; if (!c) return;
    if (c.frightened) { const sv = saveOf(s.hero, 'wis', c.frightened.dc); if (sv.ok) { delete c.frightened; ctx.log(`${s.hero.name} masters the fear (WIS save ${sv.total} vs DC ${sv.dc}).`, 'good'); } }
    if (c.restrained) { const sv = saveOf(s.hero, 'str', c.restrained); if (sv.ok) { delete c.restrained; ctx.log(`${s.hero.name} breaks free (STR save ${sv.total} vs DC ${sv.dc}).`, 'good'); } }
  }

  // ---------------------------------------------------------------------------
  // Monster magic: spells, breath weapons, roars, fiery auras
  // ---------------------------------------------------------------------------

  const inBounds = (x, y) => ctx.isFloor(x, y) || (s.map.tiles[y]?.[x] === TILE.DOOR && s.doors.get(cellKey(x, y)));

  /** Everyone standing in some squares (heroes, allies, other monsters), except `not`. */
  function creaturesIn(cells, not) {
    const keys = new Set(cells.map((c) => cellKey(c.x, c.y)));
    return [...ctx.partyAlive(), ...ctx.alive()].filter((e) => e !== not && cellsOf(e.pos, e.size ?? 1).some((c) => keys.has(cellKey(c.x, c.y))));
  }

  const avgDice = (d) => { const m = /(\d+)d(\d+)([+-]\d+)?/.exec(d ?? ''); return m ? Number(m[1]) * (Number(m[2]) + 1) / 2 + Number(m[3] ?? 0) : 0; };

  /** The squares a power would cover, aimed at a target; cut off by walls (line of sight from the caster). */
  function powerCells(m, p, target) {
    const aim = p.shape === 'radius' ? centerOf(target.pos, target.size ?? 1) : centerOf(target.pos, target.size ?? 1);
    const at = { x: Math.round(aim.x), y: Math.round(aim.y) };
    const from = centerOf(m.pos, m.size ?? 1);
    const origin = p.shape === 'radius' ? at : { x: Math.round(from.x), y: Math.round(from.y) };
    return areaCells(p, m, at, inBounds).filter((c) => lineOfSight(origin, c, ctx.opaque()).visible || (c.x === origin.x && c.y === origin.y));
  }

  /**
   * Pick a power for this turn, or null to fight with weapons. Breath weapons are used whenever
   * they are ready and would catch an enemy; spellcasters prefer magic (especially from afar),
   * choosing what does the most expected harm to enemies without burning their own side.
   */
  function choosePower(m, target) {
    if (!m.powers?.length || m.cond?.flee > 0 || m.cond?.petrified) return null;
    const enemies = new Set(ctx.enemiesOf(m));
    const sees = lineOfSight(m.pos, target.pos, ctx.opaque()).visible;
    if (!sees) return null;
    const d = ctx.edist(m, target);
    let best = null;
    for (const p of m.powers) {
      if (!canUse(p, m.uses)) continue;
      if (d > powerRange(p) + (p.shape === 'radius' ? 0 : 0)) continue;
      let score;
      if (p.kind === 'area') {
        const hit = creaturesIn(powerCells(m, p, target), m);
        const foesHit = hit.filter((e) => enemies.has(e)).length; const friendsHit = hit.length - foesHit;
        if (!foesHit || friendsHit > (p.breath ? foesHit : 0)) continue;
        score = foesHit * (p.dice ? avgDice(p.dice) * (p.half ? 0.75 : 0.6) : 6) - friendsHit * 5;
      } else if (p.kind === 'wall') score = avgDice(p.dice) * 1.5;
      else if (p.kind === 'darts') score = p.count * avgDice(p.dice);
      else score = p.dice ? avgDice(p.dice) * 0.6 : 5;
      if (p.level > 0) score += 2; // spend the good stuff
      if (!best || score > best.score) best = { p, score };
    }
    if (!best) return null;
    if (best.p.recharge) return best.p;
    const melee = m.weapons.some((w) => w.melee) && d <= 1;
    // Up close a caster still prefers its weapon now and then; from afar it casts most of the time.
    const want = melee ? 0.45 : 0.85;
    return Math.random() < want ? best.p : null;
  }

  async function castPower(m, p, target) {
    spend(p, m.uses);
    const look = ctx.boltFor(p.type);
    m.facing = facingToward(m.pos, target.pos);
    ctx.banner(`${m.name}: ${p.name}!`);
    s.aiming = m.id; ctx.drawOverlay(); await sleep(reduceMotion ? 0 : Math.round(420 * ctx.PACE)); s.aiming = null;
    play(p.breath ? ctx.cry(m, 'attack') : look.sound, { volume: 0.85 });
    const from = centerOf(m.pos, m.size ?? 1); const to = centerOf(target.pos, target.size ?? 1);
    const verb = p.spell ? 'casts' : 'uses';
    if (p.kind === 'bolt') {
      await ctx.doAttack(m, target, { name: p.name, toHit: p.toHit, damage: p.dice, type: p.type, ranged: true, melee: false, normal: p.range, long: p.range, spell: true });
      return;
    }
    if (p.kind === 'darts') {
      const bits = [];
      for (let i = 0; i < p.count && target.hp > 0; i++) { await ctx.shootProjectile(from, to, look.color); const r = roll(p.dice); bits.push(hurt(target, r.total)); }
      ctx.showVfx('arcane', to, spanOf(target.size ?? 1) / 2, 400);
      ctx.log(`${m.name} casts ${p.name}: ${bits.length} darts strike ${target.name} for ${bits.join(' + ')} = ${bits.reduce((a, b) => a + b, 0)} force damage.`, 'bad');
      return;
    }
    if (p.kind === 'save') {
      await ctx.shootProjectile(from, to, look.color);
      ctx.showVfx(look.vfx, to, spanOf(target.size ?? 1) / 2, 500);
      const sv = saveOf(target, p.save, p.dc);
      const r = p.dice ? roll(p.dice) : null;
      const dmg = r ? (sv.ok ? (p.half ? Math.floor(r.total / 2) : 0) : r.total) : 0;
      hurt(target, dmg);
      if (!sv.ok && p.rider) riderOn(target, p.rider, p.dc);
      ctx.log(`${m.name} ${verb} ${p.name} on ${target.name}: ${p.save.toUpperCase()} save ${sv.total} vs DC ${p.dc} ${sv.ok ? 'saves' : 'fails'}${r ? `, ${dmg} ${p.type} damage` : ''}${!sv.ok && p.rider ? ` (${ctx.riderText[p.rider === 'flee' ? 'flee' : p.rider] ?? p.rider})` : ''}.`, target.isHero || target.side ? 'bad' : 'info');
      return;
    }
    if (p.kind === 'wall') {
      const c = centerOf(target.pos, target.size ?? 1);
      const across = Math.abs(c.x - from.x) >= Math.abs(c.y - from.y);
      const cx = Math.round(c.x); const cy = Math.round(c.y); const half = Math.floor(p.length / 2); const cells = [];
      for (let i = -half; i <= half; i++) { const q = across ? { x: cx, y: cy + i } : { x: cx + i, y: cy }; if (ctx.isFloor(q.x, q.y)) cells.push(q); }
      await ctx.shootProjectile(from, c, look.color);
      s.effects.push({ id: `wall-${m.id}`, kind: 'firewall', cells, rounds: p.lingerRounds ?? 10, dc: p.dc, dice: p.dice, save: p.save, damageType: p.type, owner: m.id });
      syncGround();
      await ctx.showVfx('fire', c, half, 500);
      const lines = creaturesIn(cells, m).map((e) => ctx.burnIn(e, s.effects[s.effects.length - 1])).filter(Boolean);
      ctx.log(`${m.name} casts ${p.name}: a roaring line of flame, ${cells.length} squares long, for ${p.lingerRounds ?? 10} rounds.${lines.length ? ` ${lines.join('; ')}.` : ''}`, 'bad');
      return;
    }
    // Area: a cone, a line, a burst or a ring. Everyone inside makes the save.
    const cells = powerCells(m, p, target);
    if (p.shape === 'radius') await ctx.shootProjectile(from, to, look.color);
    s.areaFx = { cells, kind: look.vfx }; ctx.drawOverlay();
    await sleep(reduceMotion ? 100 : 700);
    s.areaFx = null;
    const r = p.dice ? roll(p.dice) : null;
    const lines = [];
    for (const e of creaturesIn(cells, m)) {
      const sv = saveOf(e, p.save, p.dc);
      let dmg = r ? (sv.ok ? (p.half ? Math.floor(r.total / 2) : 0) : r.total) : 0;
      if (sv.evasion && r) dmg = sv.ok ? 0 : Math.floor(r.total / 2);
      dmg = hurt(e, dmg);
      if (!sv.ok && p.rider) riderOn(e, p.rider, p.dc);
      lines.push(`${e.name}: ${p.save.toUpperCase()} ${sv.total} ${sv.ok ? 'saves' : 'fails'}${r ? `, ${dmg} ${p.type}` : ''}${!sv.ok && p.rider ? ` (${p.rider === 'flee' ? 'frightened' : p.rider === 'restrain' ? 'restrained' : p.rider})` : ''}`);
    }
    if (p.linger) addGround(p.linger, cells, p.lingerRounds ?? 2, { dc: p.dc, owner: m.id });
    ctx.log(`${m.name} ${verb} ${p.name}${r ? ` (${p.dice} = ${r.total})` : ''}! ${lines.join('; ') || 'It catches no one'}.${p.linger ? ` ${GROUND[p.linger].label[0].toUpperCase()}${GROUND[p.linger].label.slice(1)} for ${p.lingerRounds ?? 2} rounds.` : ''}`, 'bad');
    ctx.redraw();
  }

  /**
   * A long body (3x2, 4x3...) swings round to lie along the line toward what it is after,
   * keeping its centre where it was, if the turned block fits (walls, other creatures).
   */
  function turnBody(m, toward) {
    const d = dims(m.size ?? 1); if (d.w === d.h) return;
    const c = centerOf(m.pos, d);
    let wantEW = Math.abs(toward.x - c.x) >= Math.abs(toward.y - c.y);
    if (d.across) wantEW = !wantEW; // wings spread across the way it faces
    if (wantEW === d.w > d.h) return;
    const nd = rotated(d);
    const pos = { x: Math.round(c.x - (nd.w - 1) / 2), y: Math.round(c.y - (nd.h - 1) / 2) };
    const blocked = new Set([...ctx.occupied(m), ...ctx.terrainBlocked()]);
    if (!cellsOf(pos, nd).every((q) => ctx.isFloor(q.x, q.y) && !blocked.has(cellKey(q.x, q.y)))) return;
    m.size = nd; m.pos = pos;
    m.facing = facingToward(c, toward);
    if (ctx.canSee(m)) { ctx.redraw(); }
  }

  /** Start of its turn: recharge rolls, and a fiery aura scorching everyone close by. */
  async function startOfMonsterTurn(m) {
    if (m.powers?.length) for (const p of rollRecharge(m.powers, m.uses, (n) => rollDie(n) - 1)) if (ctx.canSee(m)) ctx.log(`${m.name}'s ${p.name} is ready again.`, 'warn');
    if (m.aura) {
      const near = [...ctx.partyAlive(), ...ctx.alive()].filter((e) => e !== m && blockDistance(m.pos, m.size ?? 1, e.pos, e.size ?? 1) <= m.aura.size);
      if (near.length) {
        ctx.showVfx(ctx.boltFor(m.aura.type).vfx, centerOf(m.pos, m.size ?? 1), spanOf(m.size ?? 1) / 2 + m.aura.size, 500);
        const r = roll(m.aura.dice);
        ctx.log(`${m.name}'s ${m.aura.name} scorches ${near.map((e) => `${e.name} (${hurt(e, r.total)})`).join(', ')}: ${m.aura.dice} = ${r.total} ${m.aura.type}.`, 'bad');
        await sleep(ctx.PAUSE_MS / 2);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Allies: NPCs who fight beside the party (rescued captives for good, recruits and
  // enthralled creatures for a while)
  // ---------------------------------------------------------------------------

  /** An ally's turn: attack the nearest foe that is fighting; otherwise keep close to the party. */
  async function allyTurn(m) {
    const enemies = ctx.fighting().filter((f) => !f.dead).sort((a, b) => ctx.edist(a, m) - ctx.edist(b, m));
    const foe = enemies.find((f) => lineOfSight(m.pos, f.pos, ctx.opaque()).visible) ?? enemies[0];
    if (foe && !m.hold) { await monsterTurn(m, foe); return; }
    if (foe && m.hold) {
      // Holding position: strike only what comes within reach.
      const w = m.weapons.find((x) => x.melee && ctx.edist(m, foe) <= (x.reach ?? 1)) ?? m.weapons.find((x) => x.ranged && ctx.edist(m, foe) <= x.long);
      if (w) { m.facing = facingToward(m.pos, foe.pos); await ctx.doAttack(m, foe, w); }
      return;
    }
    if (!m.hold && ctx.edist(m, s.hero) > 2) await monsterTurn(m, s.hero, { moveOnly: true });
  }

  /** Temporary allies count down; when time is up they go their own way. */
  function tickAllyTime(m) {
    if (m.side !== 'ally' || !m.allyRounds) return;
    if (--m.allyRounds > 0) return;
    endAlliance(m, `${m.name} shakes off the spell and remembers who you are!`);
  }

  /** A temporary ally leaves: enthralled ones turn hostile again, recruits simply leave. */
  function endAlliance(m, text) {
    const wasEnthralled = m.enthralled;
    m.side = null; m.allyRounds = 0; m.enthralled = false; m.temporary = false;
    if (wasEnthralled) { m.aware = true; m.calm = false; } else { m.calm = true; m.aware = false; }
    ctx.log(text, wasEnthralled ? 'warn' : 'info');
    if (s.res?.concentration && wasEnthralled && m.heldBy === 'hero') ctx.endConcentration();
    if (wasEnthralled && s.mode === 'combat' && !s.order.some((o) => o.id === m.id)) ctx.enterCombat([m]);
  }

  /** Make a creature an ally. permanent: a friend for the whole delve (follows you downstairs). */
  function joinParty(m, { permanent = false, rounds = 0, enthralled = false, reason = '' } = {}) {
    m.side = 'ally'; m.calm = false; m.aware = true; m.surprised = false; m.permanent = permanent;
    m.allyRounds = rounds; m.enthralled = enthralled; m.temporary = !permanent;
    if (m.cond) { delete m.cond.flee; delete m.cond.taunt; delete m.cond.mock; }
    if (s.mode === 'combat' && !s.order.some((o) => o.id === m.id)) {
      const r = rollInitiative(m.dexMod);
      s.order.push({ id: m.id, init: r.total, roll: r.d20, ally: true });
    }
    ctx.log(`${m.name} ${permanent ? 'joins your company' : rounds ? `fights beside you for ${rounds} rounds` : 'fights beside you for now'}${reason ? ` ${reason}` : ''}.`, 'good');
    ctx.banner(`${m.name} is on your side!`);
    ctx.checkCombatOver();
  }

  /** Bound creatures may shrug off magical bonds (STR save at the end of their turns); chains need help. */
  function endOfTurnSaves(m) {
    const c = m.cond; if (!c || m.dead) return;
    if (c.flee > 0) c.flee--;
    if (c.restrained) { const sv = ctx.monsterRoll(m, 'str', c.restrained); if (sv.ok) { delete c.restrained; ctx.log(`${m.name} tears free of the thorns.`, 'info'); } }
    if (c.bound?.save) {
      const sv = ctx.monsterRoll(m, 'str', c.bound.save);
      if (sv.ok) { delete c.bound; ctx.log(`${m.name} shatters the chains of force (STR save ${sv.total} vs DC ${sv.dc}).`, 'warn'); } else if (ctx.canSee(m)) ctx.log(`${m.name} strains against the chains (STR save ${sv.total} vs DC ${sv.dc}).`, 'good');
    }
    if (c.petrified) {
      c.petrified--;
      if (c.petrified <= 0) { delete c.petrified; ctx.log(`The stone cracks and falls from ${m.name}: it can move again.`, 'warn'); }
    }
    if (c.grappled) {
      const holder = ctx.partyAlive().find((h) => h.id === c.grappled.by);
      if (!holder || ctx.edist(holder, m) > 1) delete c.grappled;
    }
  }

  return { runMonsterTurns, monsterTurn, syncGround, addGround, saveOf, hurt, riderOn, heroEndOfTurnSaves, inBounds, creaturesIn, avgDice, powerCells, choosePower, castPower, turnBody, startOfMonsterTurn, allyTurn, tickAllyTime, endAlliance, joinParty, endOfTurnSaves };
}
