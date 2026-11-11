/**
 * Spells and abilities, their areas and effects, resting and sneaking.
 * Part of the dungeon screen (see ../dungeon-view.js): `ctx` gives access to the shared state `s`
 * and to the functions of the other parts.
 */
import { rangedCover } from '../../engine/vision.js';
import { spellDice, inspirationDie, arcaneRecovery, spellCount, addDice, manaCost, replenish } from '../../engine/magic.js';
import { lineOfSight } from '../../engine/vision.js';
import { BESTIARY_BY_ID } from '../../content/bestiary/index.js';
import { FACINGS, facingToward, chebyshev, attackOptions, resolveAttack } from '../../engine/combat.js';
import { play } from '../audio.js';
import { roll } from '../../engine/dice.js';
import { centerOf, cellsOf, spanOf } from '../../engine/size.js';
import { TILE } from '../../engine/dungeon.js';
import { areaCells, GROUND } from '../../engine/monster-magic.js';
import { cellKey } from '../../engine/movement.js';

export function installMagic(ctx) {
  const { reduceMotion, s, signed, sleep } = ctx;

  /** End the spell you are concentrating on, removing what it was doing. */
  function endConcentration() {
    const id = s.res?.concentration;
    if (!id) return;
    for (const k of ['bless', 'faith', 'trace', 'heroism', 'mark']) delete s.buffs[k];
    for (const m of s.monsters) {
      if (m.cond?.paralyzed && m.cond.heldBy === 'hero') delete m.cond.paralyzed;
      if (m.cond?.bound?.heldBy === 'hero') delete m.cond.bound;
      if (m.cond?.petrified && m.cond.heldBy === 'hero') delete m.cond.petrified;
      if (m.enthralled && m.heldBy === 'hero' && m.side === 'ally') { m.heldBy = null; ctx.endAlliance(m, `Your concentration slips: ${m.name} is itself again!`); }
    }
    s.res.concentration = null;
    s.effects = s.effects.filter((fx) => fx.owner !== 'hero' || fx.id !== id);
    ctx.refreshAC();
  }

  const timeLabel = { action: 'action', bonus: 'bonus action', reaction: 'reaction', free: 'free' };

  /** Why a spell or ability cannot be used right now (or null if it can). */
  function magicBlocked(item) {
    if (s.busy) return 'Wait for the current action to finish.';
    if (item.passive) return 'This works automatically.';
    if (item.kind === 'spell' && manaCost(item) > (s.res.mana ?? 0)) return `Not enough mana: ${item.name} needs ${manaCost(item)}, you have ${s.res.mana ?? 0}. A mana totem, an inn or a camp restores it.`;
    if (item.kind === 'ability' && Number.isFinite(item.maxUses) && !(s.res.uses[item.id] > 0)) return 'No uses left: they come back at a mana totem, an inn or a camp.';
    if (item.effect?.type === 'pool' && !(s.res.pool > 0)) return 'Your healing pool is empty.';
    if (item.outOfCombat && s.mode === 'combat') return 'Not during a fight.';
    if (item.effect?.type === 'recover' && s.res.mana >= s.res.maxMana) return 'Your mana is full.';
    if (['heal', 'pool'].includes(item.effect?.type) && s.hero.hp >= s.hero.maxHp) return 'You are not wounded.';
    if (s.mode === 'combat') {
      if (item.time === 'action' && s.actionUsed) return 'You have used your action this turn.';
      if (item.time === 'bonus' && s.bonusUsed) return 'You have used your bonus action this turn.';
      if (item.time === 'reaction' && !s.hero.reaction) return 'You have used your reaction this round.';
    }
    if (item.effect?.type === 'surge' && s.mode !== 'combat') return 'Only useful in a fight.';
    if (['dash', 'disengage'].includes(item.effect?.type) && s.mode !== 'combat') return 'Only useful in a fight.';
    return null;
  }

  function spendTime(time) {
    if (s.mode !== 'combat') return;
    if (time === 'action') { s.actionUsed = true; s.attacksLeft = 0; }
    if (time === 'bonus') s.bonusUsed = true;
    if (time === 'reaction') s.hero.reaction = false;
  }

  const findMagic = (id) => s.def.magic?.spells.find((x) => x.id === id) ?? s.def.magic?.abilities.find((x) => x.id === id);

  /** Click on a spell or ability: check it, find its target, then resolve it. */
  async function useMagic(id) {
    const item = findMagic(id);
    if (!item) return;
    const why = magicBlocked(item);
    if (why) { ctx.banner(why); return; }
    let target = null;
    if (item.target === 'enemy' || item.target === 'point') {
      target = s.selectedId && ctx.alive().find((m) => m.id === s.selectedId && ctx.canSee(m));
      if (!target) { ctx.banner(`Select a target first: click a foe, then cast ${item.name}.`); return; }
      if (ctx.edist(s.hero, target) > item.range) { ctx.banner(`${target.name} is out of reach (reach ${item.range} squares).`); return; }
      if (!lineOfSight(s.hero.pos, target.pos, ctx.opaque()).visible) { ctx.banner('You need a clear line of sight.'); return; }
      // A spell aimed at a far target cannot pass through someone standing in the way.
      if (item.target === 'enemy' && item.range > 1 && rangedCover(cellsOf(s.hero.pos, 1), cellsOf(target.pos, target.size ?? 1), ctx.opaque(), ctx.occupied()) === 'total') { ctx.banner(`Someone is in the way: no clear shot at ${target.name}.`); return; }
      if (item.effect.humanoidOnly && BESTIARY_BY_ID[target.statId].type !== 'humanoid') { ctx.banner(`${item.name} only works on humanoids.`); return; }
      if (item.effect.onFail === 'enthrall' && !['humanoid', 'beast'].includes(BESTIARY_BY_ID[target.statId].type)) { ctx.banner(`${item.name} only works on humanoids and beasts.`); return; }
      if (item.effect.onFail === 'enthrall' && target.side) { ctx.banner('It is already on your side.'); return; }
    }
    if ((item.target === 'cone' || item.target === 'around') && !areaTargets(item.effect.shape, item.effect.size, s.hero.pos).length) {
      ctx.banner(item.target === 'cone' ? `No foe in the cone in front of you (${item.effect.size * 5} ft). Turn to face them (Q / E).` : 'No foe is close enough.');
      return;
    }
    if (item.target === 'square') { s.pending = { id: item.id }; ctx.banner(`${item.name}: click a free square you can see, up to ${item.range} squares away. Esc cancels.`); ctx.redraw(); return; }
    await resolveMagic(item, target);
  }

  /** Pay for a spell/ability: mana or a use, the action economy, concentration. Returns the spell's level. */
  function payFor(item) {
    spendTime(item.time);
    const slot = item.kind === 'spell' ? item.level : 0; // spells are cast at their own circle (no upcasting)
    if (item.kind === 'spell') { s.res.mana -= manaCost(item); s.manaFlash = { at: Date.now(), n: manaCost(item) }; }
    if (item.kind === 'ability' && Number.isFinite(item.maxUses)) s.res.uses[item.id]--;
    if (item.concentration) { endConcentration(); s.res.concentration = item.id; }
    return slot;
  }

  /** Every creature caught by an area. */
  function areaTargets(shape, size, center) {
    const f = FACINGS[s.hero.facing];
    return ctx.alive().filter((m) => {
      if (!ctx.canSee(m)) return false;
      if (shape === 'radius') return ctx.edistP(m, center) <= size;
      if (shape === 'around') return ctx.edist(m, s.hero) <= size;
      if (shape === 'cone') {
        const dx = m.pos.x - s.hero.pos.x; const dy = m.pos.y - s.hero.pos.y;
        if (ctx.edist(m, s.hero) > size || (!dx && !dy)) return false;
        // Inside the cone if the angle to the creature is within ~45° of where you face: cos >= 0.7.
        return (dx * f.dx + dy * f.dy) / (Math.hypot(dx, dy) * Math.hypot(f.dx, f.dy)) >= 0.7;
      }
      return false;
    });
  }

  /** Which painted effect fits a spell: fire, ice, lightning, arcane, healing, thunder, poison, radiant. */
  const VFX_BY_TYPE = { fire: 'fire', cold: 'ice', lightning: 'lightning', force: 'arcane', psychic: 'arcane', thunder: 'thunder', necrotic: 'poison', poison: 'poison', radiant: 'radiant', acid: 'poison' };

  function vfxFor(item) {
    const e = item.effect ?? {};
    if (e.type === 'heal' || e.type === 'pool' || e.type === 'inspire') return 'heal';
    if (e.type === 'reveal' || ['bless', 'faith', 'smite', 'deathward', 'heroism'].includes(e.buff)) return 'radiant';
    if (e.type === 'wall') return 'firewall';
    return VFX_BY_TYPE[e.damageType] ?? 'arcane';
  }

  /** Flash an effect sprite over an area (centre + radius in squares) for a moment. */
  async function showVfx(kind, center, radius = 0, ms = 650) {
    const fx = { kind, x: center.x, y: center.y, r: radius, n: 1 + Math.floor(Math.random() * 4), id: Math.random() };
    s.vfx.push(fx); ctx.drawOverlay();
    await sleep(reduceMotion ? 150 : ms);
    s.vfx = s.vfx.filter((v) => v !== fx); ctx.drawOverlay();
  }

  async function showBlast(center, radius, color, kind = 'arcane') {
    await showVfx(kind, center, radius, 520);
  }

  async function resolveMagic(item, target) {
    const slot = payFor(item);
    const e = item.effect;
    const lvl = s.def.level; const mod = s.def.caster?.mod ?? 0;
    const dc = s.def.caster?.dc ?? 8 + s.def.proficiencyBonus + Math.max(s.def.mods.int, s.def.mods.wis);
    const label = `${item.name}${slot > item.level ? ` (${ordinal(slot)}-level slot)` : ''}`;
    const affected = [];
    s.busy = true;
    play(item.sound ?? 'spell-arcane', { volume: 0.85 });
    if (target) s.hero.facing = facingToward(s.hero.pos, target.pos);
    switch (e.type) {
      case 'heal': {
        let amount; let how;
        if (e.flat) { amount = e.flat + (item.upcast?.flat ?? 0) * Math.max(0, slot - item.level); how = `${amount}`; } else {
          const dice = item.kind === 'spell' ? spellDice(item, slot, lvl) : e.dice;
          const r = roll(dice); amount = r.total + (e.addMod ? mod : 0) + (e.addLevel ? lvl : 0);
          how = `${dice} (${r.total})${e.addMod ? ` + ${mod}` : ''}${e.addLevel ? ` + ${lvl}` : ''}`;
        }
        const got = ctx.heal(amount);
        showVfx('heal', s.hero.pos, 0.6);
        ctx.log(`${s.hero.name} uses ${label}: heals ${how} = ${got} HP.`, 'heal');
        break;
      }
      case 'pool': {
        const got = ctx.heal(Math.min(s.res.pool, s.hero.maxHp - s.hero.hp));
        s.res.pool -= got;
        ctx.log(`${s.hero.name} lays on healing hands: +${got} HP (${s.res.pool} left in the pool).`, 'heal');
        break;
      }
      case 'buff': {
        s.buffs[e.buff] = e.buff === 'smite' ? { dice: spellDice(item, slot, lvl) } : true;
        if (e.buff === 'heroism') s.hero.tempHp = Math.max(s.hero.tempHp ?? 0, mod);
        ctx.refreshAC();
        showVfx(vfxFor(item), s.hero.pos, 0.6);
        ctx.log(`${s.hero.name} casts ${label}. ${item.desc}`, 'good');
        break;
      }
      case 'wall': {
        // A line of flame at right angles to the caster's line of sight, centred on the chosen spot.
        const c = centerOf(target.pos, target.size ?? 1);
        const across = Math.abs(c.x - s.hero.pos.x) >= Math.abs(c.y - s.hero.pos.y);
        const cx = Math.round(c.x); const cy = Math.round(c.y); const half = Math.floor(e.length / 2);
        const cells = [];
        for (let i = -half; i <= half; i++) {
          const q = across ? { x: cx, y: cy + i } : { x: cx + i, y: cy };
          if (s.map.tiles[q.y]?.[q.x] !== undefined && s.map.tiles[q.y][q.x] !== TILE.ROCK) cells.push(q);
        }
        const dice = spellDice(item, slot, lvl);
        s.effects.push({ id: item.id, kind: 'firewall', cells, rounds: e.rounds, dc, dice, save: e.save, damageType: e.damageType, owner: 'hero' });
        await showVfx('fire', c, half, 500);
        const lines = [];
        for (const m of ctx.alive().filter((m) => cellsOf(m.pos, m.size ?? 1).some((q) => cells.some((w) => w.x === q.x && w.y === q.y)))) {
          lines.push(burnIn(m, s.effects[s.effects.length - 1]));
          affected.push(m);
        }
        ctx.log(`${s.hero.name} raises a ${label}: ${cells.length} squares of roaring flame for ${e.rounds} rounds.${lines.length ? ` ${lines.join('; ')}.` : ''}`, 'good');
        break;
      }
      case 'mark':
        s.buffs.mark = target.id;
        ctx.log(`${s.hero.name} marks the ${target.name.toLowerCase()} as quarry (Hunter's Mark: +1d6 on each weapon hit).`, 'good');
        break;
      case 'inspire': {
        s.buffs.inspiration = inspirationDie(lvl);
        ctx.log(`${s.hero.name} sings a few bars of an old song: inspiration die ${s.buffs.inspiration} for the next attack, check or save.`, 'good');
        break;
      }
      case 'surge': s.actionUsed = false; s.attacksLeft = 0; ctx.log(`${s.hero.name} surges forward: one more action this turn!`, 'good'); break;
      case 'dash': s.moveLeft += s.hero.speed; s.dash = true; ctx.log(`${s.hero.name} darts ahead (Cunning Action: Dash).`, 'info'); break;
      case 'disengage': s.disengaged = true; ctx.log(`${s.hero.name} slips out of reach (Cunning Action: Disengage). No opportunity attacks this turn.`, 'info'); break;
      case 'recover': {
        const got = arcaneRecovery(s.res, lvl);
        ctx.log(`${s.hero.name} studies their notes and recovers ${got} mana.`, 'good');
        break;
      }
      case 'reveal': {
        const found = [];
        for (const t of s.features.traps) if (!t.found && !t.sprung && chebyshev(t, s.hero.pos) <= e.radius) { t.found = true; found.push(t.name); }
        for (const k of [...s.features.secretDoors]) { const [x, y] = k.split(',').map(Number); if (chebyshev({ x, y }, s.hero.pos) <= e.radius) { ctx.revealSecret(k); found.push('secret door'); } }
        await showBlast(s.hero.pos, e.radius, item.color, vfxFor(item));
        ctx.log(`${label}: sunlight floods the halls. ${found.length ? `Revealed: ${found.join(', ')}.` : 'Nothing hidden nearby.'}`, 'good');
        break;
      }
      case 'attack': {
        const rays = spellCount(item, slot, 'rays');
        const dice = spellDice(item, slot, lvl);
        for (let i = 0; i < rays && !target.dead; i++) {
          const pseudo = { name: item.name, toHit: s.def.caster.attack, damage: dice, type: e.damageType, ranged: true, melee: false, normal: item.range, long: item.range };
          const opts = attackOptions({ attacker: s.hero, target, weapon: pseudo, opaque: ctx.opaque(), occupied: ctx.occupied(), enemiesOf: ctx.enemiesOf });
          if (!opts) break;
          await ctx.shootProjectile(s.hero.pos, centerOf(target.pos, target.size ?? 1), item.color);
          const boost = ctx.rollBoosts({ attack: true });
          const r = resolveAttack({ weapon: { ...pseudo, toHit: pseudo.toHit + boost.total }, ac: opts.ac, mode: opts.mode });
          const head = `${s.hero.name} casts ${label}${rays > 1 ? ` (ray ${i + 1})` : ''} at the ${target.name.toLowerCase()}: spell attack d20 (${r.d20s.join(', ')}) ${signed(pseudo.toHit)}${boost.text} = ${r.total} vs AC ${opts.ac}.`;
          if (r.hit) {
            ctx.damageMonster(target, r.damage); ctx.flashHit(target); ctx.float(target.pos, `−${r.damage}`, 'good', r.crit);
            showVfx(vfxFor(item), centerOf(target.pos, target.size ?? 1), spanOf(target.size ?? 1) / 2);
            ctx.log(`${head} ${r.crit ? 'CRITICAL! ' : 'Hit! '}${r.damage} ${e.damageType} damage.`, 'good');
            if (target.hp > 0) play(ctx.cry(target, 'hurt'), { delay: 120 });
          } else { ctx.float(target.pos, 'miss', 'muted'); ctx.log(`${head} Miss.`, 'info'); }
          ctx.finishIfDead(target);
          await sleep(ctx.PAUSE_MS / 2);
        }
        affected.push(target);
        break;
      }
      case 'darts': {
        const n = spellCount(item, slot, 'count');
        let total = 0; const rolls = [];
        for (let i = 0; i < n; i++) {
          if (target.dead) break;
          await ctx.shootProjectile(s.hero.pos, centerOf(target.pos, target.size ?? 1), item.color);
          const r = roll(e.dice); total += r.total; rolls.push(r.total);
          ctx.damageMonster(target, r.total); ctx.flashHit(target); ctx.float(target.pos, `−${r.total}`, 'good');
          showVfx('arcane', centerOf(target.pos, target.size ?? 1), 0.3, 300);
          ctx.finishIfDead(target);
        }
        ctx.log(`${s.hero.name} casts ${label}: ${rolls.length} darts strike the ${target.name.toLowerCase()} for ${rolls.join(' + ')} = ${total} force damage.`, 'good');
        affected.push(target);
        break;
      }
      case 'sleep': {
        const pool = roll(addDice(e.pool, item.upcast?.pool, slot - item.level));
        let left = pool.total; const slept = [];
        const near = ctx.alive().filter((m) => ctx.edist(m, target) <= e.radius && BESTIARY_BY_ID[m.statId].type !== 'undead' && !m.cond?.asleep).sort((a, b) => a.hp - b.hp);
        for (const m of near) { if (m.hp > left) break; left -= m.hp; (m.cond ??= {}).asleep = true; slept.push(m.name); }
        await showBlast(centerOf(target.pos, target.size ?? 1), e.radius, item.color, vfxFor(item));
        ctx.log(`${s.hero.name} casts ${label}: ${e.pool} = ${pool.total} hit points of slumber. ${slept.length ? `Asleep: ${slept.join(', ')}.` : 'Nobody falls asleep: they are too hale.'}`, slept.length ? 'good' : 'info');
        // Sleeping creatures do not raise the alarm; the others nearby do.
        affected.push(...near.filter((m) => !m.cond?.asleep));
        break;
      }
      case 'save': {
        const center = item.target === 'point' ? target.pos : s.hero.pos;
        const targets = e.shape ? areaTargets(e.shape, e.size, center) : [target];
        const dice = item.kind === 'spell' ? spellDice(item, slot, lvl) : null;
        const dmgRoll = dice ? roll(dice) : null;
        if (e.shape === 'cone') { const f = FACINGS[s.hero.facing]; await showBlast({ x: s.hero.pos.x + f.dx * (e.size + 1) / 2, y: s.hero.pos.y + f.dy * (e.size + 1) / 2 }, (e.size - 1) / 2 + 0.5, item.color, vfxFor(item)); } else if (e.shape) await showBlast(item.target === 'point' ? centerOf(target.pos, target.size ?? 1) : center, e.size, item.color, vfxFor(item));
        else if (target) { await ctx.shootProjectile(s.hero.pos, centerOf(target.pos, target.size ?? 1), item.color); showVfx(vfxFor(item), centerOf(target.pos, target.size ?? 1), spanOf(target.size ?? 1) / 2); }
        const lines = [];
        for (const m of targets) {
          const sv = ctx.monsterRoll(m, e.save, dc);
          let dmg = 0;
          if (dmgRoll) dmg = sv.ok ? (e.half ? Math.floor(dmgRoll.total / 2) : 0) : dmgRoll.total;
          if (dmg) { ctx.damageMonster(m, dmg); ctx.flashHit(m); ctx.float(m.pos, `−${dmg}`, 'good'); }
          if (!sv.ok) applyRider(e.onFail, m, dc, e.rounds);
          lines.push(`${m.name}: ${e.save.toUpperCase()} save ${sv.total} vs DC ${dc} ${sv.ok ? 'saves' : 'fails'}${dmgRoll ? `, ${dmg} ${e.damageType}` : ''}${!sv.ok && e.onFail ? ` (${riderText[e.onFail]})` : ''}`);
          ctx.finishIfDead(m);
          if (!(e.onFail === 'enthrall' && !sv.ok)) affected.push(m); // a new friend is not provoked
        }
        // A fireball in a corridor hurts its caster too.
        if (item.target === 'point' && e.shape === 'radius' && chebyshev(s.hero.pos, center) <= e.size && dmgRoll) {
          const c = ctx.heroCheck(s.def.saves?.[e.save] ?? 0, dc, { save: true });
          const evade = s.def.evasion && e.save === 'dex';
          const dmg = evade ? (c.ok ? 0 : Math.floor(dmgRoll.total / 2)) : (c.ok ? Math.floor(dmgRoll.total / 2) : dmgRoll.total);
          ctx.damageHero(dmg); ctx.float(s.hero.pos, `−${dmg}`, 'bad');
          lines.push(`${s.hero.name} is caught in the blast! ${ctx.checkText(`${e.save.toUpperCase()} save`, c)}: ${dmg} damage`);
        }
        // Fire scorches the floor, cold leaves ice, thunder cracks the stone: for a few rounds.
        if (e.linger && e.shape) {
          const f = FACINGS[s.hero.facing];
          const aim = e.shape === 'radius' ? { x: Math.round(center.x), y: Math.round(center.y) } : { x: s.hero.pos.x + f.dx * e.size, y: s.hero.pos.y + f.dy * e.size };
          const origin = e.shape === 'radius' ? aim : s.hero.pos;
          const cells = areaCells({ shape: e.shape, size: e.size }, s.hero, aim, ctx.inBounds).filter((c) => lineOfSight(origin, c, ctx.opaque()).visible || (c.x === origin.x && c.y === origin.y));
          ctx.addGround(e.linger, cells, e.lingerRounds ?? 2, { dc, owner: 'hero' });
          lines.push(`${GROUND[e.linger].label} for ${e.lingerRounds ?? 2} round${(e.lingerRounds ?? 2) > 1 ? 's' : ''}`);
        }
        ctx.log(`${s.hero.name} uses ${label}${dmgRoll ? ` (${dice} = ${dmgRoll.total})` : ''}. ${lines.join('; ') || 'It catches no one'}.`, 'good');
        break;
      }
      default:
    }
    s.busy = false;
    if (s.hero.hp <= 0) { ctx.heroFell(); return; }
    if (affected.length) ctx.provoke(affected);
    ctx.checkCombatOver();
    ctx.redraw();
  }

  /** A creature caught in a lasting effect: save for half damage. Returns a log fragment. */
  function burnIn(m, fx) {
    if (!fx.dice) return null;
    const isHero = !!m.isHero;
    let sv;
    if (isHero) { const back = s.active; ctx.activate(ctx.memberIndex(m)); sv = ctx.heroCheck(s.def.saves?.[fx.save] ?? 0, fx.dc, { save: true }); ctx.activate(back); } else sv = ctx.monsterRoll(m, fx.save, fx.dc);
    const r = roll(fx.dice);
    const dmg = sv.ok ? Math.floor(r.total / 2) : r.total;
    if (isHero) { const back = s.active; ctx.activate(ctx.memberIndex(m)); ctx.damageHero(dmg); ctx.activate(back); } else { ctx.damageMonster(m, dmg); ctx.finishIfDead(m); }
    ctx.float(m.pos, `−${dmg}`, isHero ? 'bad' : 'good'); ctx.flashHit(m);
    return `${m.name} ${fx.damageType === 'poison' ? 'chokes in the cloud' : 'burns'}: ${fx.save.toUpperCase()} save ${sv.total} vs DC ${fx.dc}, ${dmg} ${fx.damageType}`;
  }

  const inEffect = (e, fx) => cellsOf(e.pos, e.size ?? 1).some((q) => fx.cells.some((w) => w.x === q.x && w.y === q.y));

  const riderText = { mock: 'disadvantage on its next attack', flee: 'flees in terror', push: 'pushed back', stun: 'stunned', paralyze: 'paralysed', restrain: 'restrained',
    bind: 'shackled to the floor', petrify: 'turned to stone', enthrall: 'now fights for you' };

  function applyRider(kind, m, dc, rounds = 10) {
    const c = m.cond ??= {};
    if (kind === 'bind') c.bound = { to: 'force', save: dc, heldBy: 'hero' };
    if (kind === 'petrify') { c.petrified = rounds; c.heldBy = 'hero'; }
    if (kind === 'enthrall' && !m.side) { ctx.joinParty(m, { rounds, enthralled: true, reason: 'under your spell' }); m.heldBy = 'hero'; }
    if (kind === 'mock') c.mock = true;
    if (kind === 'flee') c.flee = 2;
    if (kind === 'stun') c.stun = 1;
    if (kind === 'paralyze') { c.paralyzed = dc; c.heldBy = 'hero'; }
    if (kind === 'restrain') c.restrained = dc;
    if (kind === 'push') {
      // Shove it up to 2 squares straight away from you, stopping at walls and other creatures.
      const dx = Math.sign(m.pos.x - s.hero.pos.x); const dy = Math.sign(m.pos.y - s.hero.pos.y);
      const blocked = new Set([...ctx.occupied(m), ...ctx.terrainBlocked()]);
      for (let i = 0; i < 2; i++) {
        const n = { x: m.pos.x + dx, y: m.pos.y + dy };
        if (s.map.tiles[n.y]?.[n.x] === undefined || s.map.tiles[n.y][n.x] === TILE.ROCK || blocked.has(cellKey(n.x, n.y))) break;
        if (s.map.tiles[n.y][n.x] === TILE.DOOR && !s.doors.get(cellKey(n.x, n.y))) break;
        m.pos = n;
      }
    }
  }

  const ordinal = (n) => `${n}${n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th'}`;

  /** Misty Step: finish the teleport on the clicked square. */
  function finishTeleport(c) {
    const item = findMagic(s.pending.id);
    const k = cellKey(c.x, c.y);
    const ok = s.visible.has(k) && s.map.tiles[c.y][c.x] !== TILE.ROCK && !ctx.occupied().has(k) && !ctx.terrainBlocked().has(k) && chebyshev(c, s.hero.pos) <= item.range
      && !(s.map.tiles[c.y][c.x] === TILE.DOOR && !s.doors.get(k));
    if (!ok) { ctx.banner('Choose a free square you can see, within range.'); return; }
    s.pending = null;
    payFor(item);
    play(item.sound, { volume: 0.8 });
    const from = { ...s.hero.pos };
    s.hero.pos = { x: c.x, y: c.y };
    s.hero.facing = facingToward(from, c) >= 0 ? facingToward(from, c) : s.hero.facing;
    ctx.float(from, '✦', 'muted'); ctx.float(c, '✦', 'good');
    ctx.log(`${s.hero.name} steps into silver mist and reappears ${chebyshev(from, c) * 5} ft away.`, 'good');
    const spotted = ctx.updateVision();
    if (spotted.length) ctx.enterCombat(spotted);
    ctx.redraw();
  }

  // ---------------------------------------------------------------------------
  // Rests and stealth
  // ---------------------------------------------------------------------------

  /**
   * A mana totem (once per floor), an inn's bed or a camp by the fire: every hero's mana and
   * ability uses come back (engine/magic.js replenish). `heal` also restores hit points (sleep).
   */
  function replenishParty(source, { heal = false } = {}) {
    const back = s.active; const lines = [];
    for (let i = 0; i < s.members.length; i++) {
      ctx.activate(i);
      const got = replenish(s.res, ctx.magicHero());
      if (heal) { s.hero.hp = s.hero.maxHp; s.hero.tempHp = 0; }
      if (got || heal) lines.push(`${s.hero.name}${got ? ` +${got} mana` : ''}${heal ? ' (rested)' : ''}`);
    }
    ctx.activate(back);
    play('spell-heal', { volume: 0.6 });
    ctx.log(`${source}${lines.length ? ` ${lines.join(', ')}.` : ''} Mana and abilities are restored.`, 'heal');
    ctx.redraw();
  }

  /** Sneak: one Stealth check; creatures whose passive Perception is lower do not notice you. */
  function sneak() {
    if (s.mode === 'combat') { ctx.banner('Too late to hide: they have seen you.'); return; }
    if (s.sneak) { s.sneak = null; ctx.log(`${s.hero.name} stops sneaking.`, 'info'); ctx.redraw(); return; }
    // A party sneaks only as well as its clumsiest member: everyone rolls, the lowest roll counts.
    const back = s.active; const rolls = [];
    for (let i = 0; i < s.members.length; i++) {
      ctx.activate(i);
      if (s.hero.hp <= 0) continue;
      const bonus = (s.hero.skills.stealth ?? 0) + (s.buffs.trace ? 10 : 0);
      const c = ctx.heroCheck(bonus, 0, { mode: s.def.stealthDis ? 'disadvantage' : 'normal' });
      rolls.push({ name: s.hero.name, total: c.total, text: `${s.hero.name}${s.def.stealthDis ? ' (noisy armour: disadvantage)' : ''}${s.buffs.trace ? ' (Pass without Trace)' : ''}: ${c.d20s.length > 1 ? `d20 (${c.d20s.join(', ')} → ${c.d20})` : `d20 (${c.d20})`} ${signed(bonus)}${c.extra} = ${c.total}` });
    }
    ctx.activate(back);
    const worst = rolls.reduce((a, b) => (b.total < a.total ? b : a));
    s.sneak = { total: worst.total };
    for (const m of s.monsters) m.unnoticed = false;
    ctx.log(`${rolls.length > 1 ? 'The party moves' : `${worst.name} moves`} into the shadows. Stealth: ${rolls.map((r) => r.text).join('; ')}.${rolls.length > 1 ? ` The party is only as quiet as ${worst.name}: ${worst.total}.` : ''}`, 'info');
    ctx.redraw();
  }

  return { endConcentration, timeLabel, magicBlocked, spendTime, findMagic, useMagic, payFor, areaTargets, VFX_BY_TYPE, vfxFor, showVfx, showBlast, resolveMagic, burnIn, inEffect, riderText, applyRider, ordinal, finishTeleport, replenishParty, sneak };
}
