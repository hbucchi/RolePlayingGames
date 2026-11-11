/**
 * Attacks: choosing weapons, rolling to hit, projectiles, lunges, blood and hit flashes.
 * Part of the dungeon screen (see ../dungeon-view.js): `ctx` gives access to the shared state `s`
 * and to the functions of the other parts.
 */
import { attackOptions, facingToward, resolveAttack } from '../../engine/combat.js';
import { countOf, consume } from '../../engine/items.js';
import { cellKey } from '../../engine/movement.js';
import { monsterVoice, voiceSound, heroSound, play } from '../audio.js';
import { BESTIARY_BY_ID } from '../../content/bestiary/index.js';
import { dims, centerOf, spanOf } from '../../engine/size.js';

export function installAttacks(ctx) {
  const { S, overlay, reduceMotion, s, signed, sleep, viewport } = ctx;

  // ---------------------------------------------------------------------------
  // Attacks
  // ---------------------------------------------------------------------------

  const enemiesOf = (who) => (who.isHero || who.side === 'ally' ? ctx.fighting() : [...ctx.partyAlive(), ...ctx.allies()]);

  /** Pick the hero weapon to use against a target: the selected one if it works, else any that does. */
  function heroAttackPlan(target) {
    const args = (w) => ({ attacker: s.hero, target, weapon: w, opaque: ctx.opaque(), occupied: ctx.occupied(), enemiesOf });
    const sel = s.hero.weapons[s.weaponIdx];
    const order = [sel, ...s.hero.weapons.filter((w) => w !== sel)];
    const adjacent = ctx.edist(s.hero, target) <= 1;
    // Next to the target, prefer a melee weapon (shooting point-blank has disadvantage).
    if (adjacent) order.sort((a, b) => Number(b.melee) - Number(a.melee) || (a === sel ? -1 : 1));
    for (const w of order) {
      if (!hasAmmo(w, target)) continue;
      const o = attackOptions(args(w));
      if (o) return { weapon: w, opts: o };
    }
    return null;
  }

  /** Bows need arrows (slings need stones). Point-blank melee and thrown weapons need none. */
  function hasAmmo(w, target) {
    if (!w.ammo || !s.draft) return true;
    if (w.melee && target && ctx.edist(s.hero, target) <= (w.reach ?? 1)) return true;
    return countOf(s.draft.inventory, w.ammo) > 0;
  }

  function whyNot(target) {
    if (s.hero.weapons.some((w) => w.ammo && !hasAmmo(w, target)) && !s.hero.weapons.some((w) => w.melee) ) return 'Out of ammunition.';
    const d = ctx.edist(s.hero, target);
    const maxRange = Math.max(0, ...s.hero.weapons.filter((w) => w.ranged).map((w) => w.long));
    if (!s.visible.has(cellKey(target.pos.x, target.pos.y))) return 'You can\'t see it.';
    if (d > 1 && !maxRange) return 'Too far for a melee weapon. Move next to it first.';
    if (d > maxRange) return `Out of range (${d * 5} ft).`;
    return 'No clear line of sight.';
  }

  /** Can the hero make a weapon attack now? (Extra Attack lets one action hold several attacks.) */
  const canAttack = () => s.mode !== 'combat' || !s.actionUsed || s.attacksLeft > 0;

  async function heroAttack(target, weaponIdx = null) {
    if (!canAttack()) { ctx.banner('You have already used your action this turn.'); return; }
    let plan = heroAttackPlan(target);
    if (weaponIdx !== null) {
      const w = s.hero.weapons[weaponIdx];
      if (!hasAmmo(w, target)) { ctx.banner(`No ${w.ammo.replace('-', ' ')} left for your ${w.name.toLowerCase()}.`); return; }
      const o = attackOptions({ attacker: s.hero, target, weapon: w, opaque: ctx.opaque(), occupied: ctx.occupied(), enemiesOf });
      plan = o ? { weapon: w, opts: o } : null;
    }
    if (!plan) { ctx.banner(whyNot(target)); return; }
    s.busy = true;
    s.hero.facing = facingToward(s.hero.pos, target.pos);
    s.sneak = null;
    await doAttack(s.hero, target, plan.weapon);
    if (s.mode === 'combat') {
      if (s.attacksLeft > 0) s.attacksLeft--; else { s.actionUsed = true; s.attacksLeft = (s.def.attacksPerAction ?? 1) - 1; }
      if (s.attacksLeft > 0) ctx.banner(`Extra Attack: ${s.attacksLeft} more this action.`);
    }
    s.busy = false;
    ctx.provoke([target]);
    ctx.checkCombatOver();
    ctx.redraw();
  }

  async function heroOpportunityAttack(m) {
    const melee = s.hero.weapons.find((w) => w.melee);
    if (!melee) return;
    s.hero.reaction = false;
    ctx.log(`${m.name} moves away; ${s.hero.name} takes an opportunity attack!`, 'info');
    await doAttack(s.hero, m, melee, { reaction: true, from: { ...m.pos } });
  }

  async function monsterOpportunityAttack(m) {
    const melee = m.weapons.find((w) => w.melee);
    if (!melee) return;
    m.reaction = false;
    ctx.log(`${s.hero.name} leaves ${m.name}'s reach: opportunity attack!`, 'warn');
    await doAttack(m, s.hero, melee, { reaction: true });
  }

  /** Voice family for sounds: the hero's chosen voice, or goblin / boss by monster size. */
  // Every hero (not only the active one) speaks with their own voice.
  const voiceOf = (e) => (e.isHero ? `hero-${e.voice ?? 'low'}` : monsterVoice(BESTIARY_BY_ID[e.statId]));

  // Heroes mostly grunt and scream; now and then they speak a line instead (see heroSound).
  const cry = (e, what) => { const v = voiceOf(e); return v.startsWith('hero-') ? heroSound(v.slice(5), what) : voiceSound(v, what); };

  /** Animate an arrow flying from one square to another. */
  /**
   * Something flies from one square to another: an arrow, a thrown spear or a bolt of magic.
   * It travels at a steady, readable speed (about 8 squares a second, never quicker than
   * 0.45 s nor slower than 1.4 s), leaving a fading trail so you can see where it came from.
   * The map is drawn once; each animation frame only moves the projectile.
   */
  async function shootProjectile(from, to, color = null, shape = 'arrow') {
    if (reduceMotion) return;
    const dist = Math.hypot(to.x - from.x, to.y - from.y);
    const ms = Math.min(1400, Math.max(450, dist * 125)) * Math.min(ctx.PACE, 1.4);
    s.projectile = { from, to, t: 0, color, shape };
    ctx.drawOverlay();
    const head = overlay.querySelector('.dg-proj-head'); const trail = overlay.querySelector('.dg-proj-trail');
    const sz = S();
    const x0 = (from.x + 0.5) * sz; const y0 = (from.y + 0.5) * sz; const x1 = (to.x + 0.5) * sz; const y1 = (to.y + 0.5) * sz;
    const ang = Math.atan2(y1 - y0, x1 - x0) * 180 / Math.PI;
    const t0 = performance.now();
    await new Promise((done) => {
      const step = (now) => {
        const t = Math.min(1, (now - t0) / ms);
        const x = x0 + (x1 - x0) * t; const y = y0 + (y1 - y0) * t;
        head?.setAttribute('transform', `translate(${x} ${y}) rotate(${ang})`);
        // The trail reaches back at most 2.5 squares behind the head.
        const back = Math.max(0, t - (2.5 / Math.max(dist, 0.01)));
        trail?.setAttribute('x1', x0 + (x1 - x0) * back); trail?.setAttribute('y1', y0 + (y1 - y0) * back);
        trail?.setAttribute('x2', x); trail?.setAttribute('y2', y);
        if (t < 1 && head?.isConnected) requestAnimationFrame(step); else done();
      };
      requestAnimationFrame(step);
    });
    s.projectile = null;
  }

  /** Magic thrown by monsters: its colour, the burst it makes and its sound, by damage type. */
  const BOLT = {
    fire: { color: '#ff8a3d', vfx: 'fire', sound: 'spell-fire' }, cold: { color: '#9fdcff', vfx: 'ice', sound: 'spell-arcane' },
    lightning: { color: '#cfe6ff', vfx: 'lightning', sound: 'spell-thunder' }, thunder: { color: '#e6e0ff', vfx: 'thunder', sound: 'spell-thunder' },
    poison: { color: '#9be564', vfx: 'poison', sound: 'spell-arcane' }, acid: { color: '#b9f55a', vfx: 'poison', sound: 'spell-arcane' },
    radiant: { color: '#fff1a8', vfx: 'radiant', sound: 'spell-heal' },
  };

  const boltFor = (type) => BOLT[type] ?? { color: '#c9a8ff', vfx: 'arcane', sound: 'spell-arcane' };

  /** Lean the attacker toward its target for a moment. */
  async function lunge(attacker, target) {
    if (reduceMotion) return;
    const dx = Math.sign(target.pos.x - attacker.pos.x); const dy = Math.sign(target.pos.y - attacker.pos.y);
    s.lunge = { id: attacker.id, dx, dy }; ctx.drawOverlay(); await sleep(Math.round(120 * (attacker.isHero ? 1 : ctx.PACE)));
    s.lunge = null; ctx.drawOverlay();
  }

  /**
   * Blood on the floor. Every wound leaves a splash on one of the creature's squares (bigger
   * wounds, bigger splashes); a death leaves a pool. Bloodless things (undead, constructs,
   * elementals, oozes, stone) leave nothing. Splashes stay for the whole floor.
   */
  const BLOODLESS = new Set(['undead', 'construct', 'elemental', 'ooze', 'plant']);

  function bleed(e, n, death = false) {
    if (!(n > 0) || !s.map) return;
    if (!e.isHero && (BLOODLESS.has(BESTIARY_BY_ID[e.statId]?.type) || e.cond?.petrified)) return;
    const { w, h } = dims(e.size ?? 1);
    const share = Math.min(1, n / Math.max(1, e.maxHp));
    const count = death ? w * h : 1 + (share >= 0.25 ? 1 : 0);
    for (let i = 0; i < count; i++) {
      const x = e.pos.x + (death ? i % w : Math.floor(Math.random() * w));
      const y = e.pos.y + (death ? Math.floor(i / w) : Math.floor(Math.random() * h));
      s.blood.push({
        x, y, ox: (Math.random() - 0.5) * 0.5, oy: (Math.random() - 0.5) * 0.5,
        r: death ? 0.55 + Math.random() * 0.2 : 0.18 + share * 0.5 + Math.random() * 0.1,
        rot: Math.floor(Math.random() * 360), n: 1 + Math.floor(Math.random() * 4),
      });
    }
    if (s.blood.length > 400) s.blood.splice(0, s.blood.length - 400);
  }

  function drawBlood() {
    const sz = S(); let out = '';
    for (const b of s.blood) {
      if (!s.revealAll && !s.revealed.has(cellKey(b.x, b.y))) continue;
      const cx = (b.x + 0.5 + b.ox) * sz; const cy = (b.y + 0.5 + b.oy) * sz; const w = b.r * 2 * sz;
      out += `<image href="assets/terrain/blood-${b.n}.jpg" x="${cx - w / 2}" y="${cy - w / 2}" width="${w}" height="${w}" mask="url(#blood-mask)" class="blood" transform="rotate(${b.rot} ${cx} ${cy})" preserveAspectRatio="xMidYMid slice"/>`;
    }
    return out;
  }

  function flashHit(e) {
    s.flash.add(e.id); ctx.drawOverlay();
    setTimeout(() => { s.flash.delete(e.id); ctx.drawOverlay(); }, 450);
    if (e === s.hero && !reduceMotion) {
      viewport.classList.remove('shake'); void viewport.offsetWidth; viewport.classList.add('shake');
      setTimeout(() => viewport.classList.remove('shake'), 450);
    }
  }

  /** Roll an attack with sound and motion, apply damage, write the log, float a number. */
  async function doAttack(attacker, target, weapon, { reaction = false } = {}) {
    let opts = attackOptions({ attacker, target, weapon, opaque: ctx.opaque(), occupied: ctx.occupied(), enemiesOf });
    if (!opts && reaction) opts = { ac: target.ac, mode: 'normal', adv: [], dis: [], cover: 'none', chance: 0 }; // reach was valid a moment ago
    if (!opts) return;
    const ranged = opts.ranged || (weapon.ranged && !weapon.melee);
    if (attacker === s.hero && ranged && weapon.ammo) {
      consume(s.draft.inventory, weapon.ammo, 1);
      s.ammoSpent[weapon.ammo] = (s.ammoSpent[weapon.ammo] ?? 0) + 1;
    }
    // Wind-up: battle cry, then the weapon.
    if (attacker === s.hero || Math.random() < 0.6) play(cry(attacker, 'attack'), { volume: 0.75 });
    if (ranged) {
      // Take aim for a moment, then loose: the shot is easy to follow from shooter to target.
      const from = centerOf(attacker.pos, attacker.size ?? 1); const to = centerOf(target.pos, target.size ?? 1);
      attacker.facing = facingToward(attacker.pos, target.pos);
      s.aiming = attacker.id; ctx.drawOverlay(); await sleep(reduceMotion ? 0 : Math.round(280 * ctx.PACE)); s.aiming = null;
      if (weapon.spell) {
        const b = boltFor(weapon.type);
        play(b.sound, { volume: 0.8 });
        await shootProjectile(from, to, b.color);
        ctx.showVfx(b.vfx, to, spanOf(target.size ?? 1) / 2, 500);
      } else {
        const stone = /rock|boulder|stone/i.test(weapon.name);
        play(stone ? 'swing-miss' : 'bow-shot', { volume: 0.8 });
        await shootProjectile(from, to, null, stone ? 'stone' : 'arrow');
      }
    } else { await lunge(attacker, target); }

    // Bless and inspiration add dice to the hero's attack roll.
    const boost = attacker === s.hero ? ctx.rollBoosts({ attack: true }) : { total: 0, text: '' };
    const w = boost.total ? { ...weapon, toHit: weapon.toHit + boost.total } : weapon;
    const autoCrit = !!target.cond?.paralyzed && !ranged && ctx.edist(attacker, target) <= 1;
    const r = resolveAttack({ weapon: w, ac: opts.ac, mode: opts.mode, autoCrit });
    if (attacker.cond?.mock) delete attacker.cond.mock;
    const who = attacker === s.hero ? s.hero.name : attacker.name;
    const whom = target === s.hero ? s.hero.name : target.name;
    const dice = r.d20s.length > 1 ? `d20 (${r.d20s.join(', ')} → ${r.d20})` : `d20 (${r.d20})`;
    const why = [...opts.adv.map((a) => `advantage: ${a}`), ...opts.dis.map((d) => `disadvantage: ${d}`), opts.cover === 'half' ? 'half cover +2 AC' : null].filter(Boolean);
    const hurled = ranged && (weapon.spell || weapon.melee || /rock|boulder|stone/i.test(weapon.name));
    let line = `${hurled ? `${who} hurls ${weapon.name} at ${whom}` : `${who} ${ranged ? 'shoots' : 'attacks'} ${whom} with ${weapon.name}`}: ${dice} ${signed(weapon.toHit)}${boost.text} = ${r.total} vs AC ${opts.ac}${why.length ? ` (${why.join('; ')})` : ''}.`;
    if (r.hit) {
      let dmg = r.damage; const bits = [];
      if (attacker === s.hero) {
        const x = ctx.hitExtras(target, weapon, opts, ranged, r.crit);
        dmg += x.total; bits.push(...x.text);
      }
      if (target === s.hero && s.def.uncanny && s.hero.reaction && dmg > 1) {
        dmg = Math.floor(dmg / 2); s.hero.reaction = false; bits.push('Uncanny Dodge halves it');
      }
      if (target === s.hero) ctx.damageHero(dmg); else dmg = ctx.damageMonster(target, dmg);
      line += ` ${r.crit ? 'CRITICAL HIT! ' : 'Hit! '}${dmg} ${weapon.type} damage${r.damageRoll ? ` [${r.damageRoll.rolls.join(', ')}${r.damageRoll.modifier ? ` ${signed(r.damageRoll.modifier)}` : ''}]` : ''}${bits.length ? ` (${bits.join('; ')})` : ''}.`;
      ctx.float(target.pos, `−${dmg}`, target === s.hero ? 'bad' : 'good', r.crit);
      play(ranged ? 'arrow-hit' : 'sword-hit');
      if (r.crit) play('crit', { volume: 0.9 });
      if (target.hp > 0) play(cry(target, 'hurt'), { delay: 120, volume: 0.85 });
      flashHit(target);
    } else {
      line += r.d20 === 1 ? ' Natural 1: a clumsy miss.' : ' Miss.';
      ctx.float(target.pos, 'miss', 'muted');
      if (!ranged) play('swing-miss', { volume: 0.7 });
    }
    ctx.log(line, target === s.hero ? (r.hit ? 'bad' : 'info') : (r.hit ? 'good' : 'info'));
    if (target !== s.hero && target.hp <= 0) {
      target.dead = true;
      play(cry(target, 'death'), { delay: 150 });
      if (s.selectedId === target.id) s.selectedId = null;
      ctx.onKill(target);
    }
    if (target === s.hero && target.hp <= 0) play(cry(target, 'death'), { delay: 150 });
    ctx.redraw();
    await sleep(ctx.PAUSE_MS);
  }

  return { enemiesOf, heroAttackPlan, hasAmmo, whyNot, canAttack, heroAttack, heroOpportunityAttack, monsterOpportunityAttack, voiceOf, cry, shootProjectile, BOLT, boltFor, lunge, BLOODLESS, bleed, drawBlood, flashHit, doAttack };
}
