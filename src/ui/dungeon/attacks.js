/**
 * Attacks: choosing weapons, rolling to hit, projectiles, lunges, blood and hit flashes.
 * Part of the dungeon screen (see ../dungeon-view.js): `ctx` gives access to the shared state `s`
 * and to the functions of the other parts.
 */
import { cellsOf } from '../../engine/size.js';
import { rangedCover } from '../../engine/vision.js';
import { attackOptions, facingToward, resolveAttack } from '../../engine/combat.js';
import { countOf, consume } from '../../engine/items.js';
import { absorbed, strike, wearArmour, partCover, resistance, typeFactor, afterResistance } from '../../engine/defence.js';
import { isPhysical } from '../../engine/materials.js';
import { partOf, shortName } from '../../engine/body.js';
import { getSetting } from '../settings.js';
import { rollDie, roll } from '../../engine/dice.js';
import { cellKey } from '../../engine/movement.js';
import { monsterVoice, voiceSound, heroSound, play, isAmazon, amazonHurtLine } from '../audio.js';
import { BESTIARY_BY_ID } from '../../content/bestiary/index.js';
import { dims, centerOf, spanOf } from '../../engine/size.js';
import { TILE } from '../../engine/dungeon.js';
import { rollDice, diceWanted, diceOf } from '../dice.js';
import { applyHit, ruleOf, CRIPPLED_TEXT } from '../../engine/injury.js';

export function installAttacks(ctx) {
  const { S, host, overlay, reduceMotion, s, signed, sleep, viewport } = ctx;

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
    if (d > maxRange) return `Out of reach: it is ${d} squares away; your reach is ${maxRange}.`;
    // Visible and in reach, but no shot: is someone standing in the way?
    if (rangedCover(cellsOf(s.hero.pos, 1), cellsOf(target.pos, target.size ?? 1), ctx.opaque()) !== 'total') return `Someone is in the way: no clear shot at ${target.name}.`;
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

  /** A wounded creature's cry. Amazons often shout a line (audio.js), and it floats over them. */
  function hurtCry(e, opts = {}) {
    const said = !e.isHero && isAmazon(e.statId) ? amazonHurtLine() : null;
    if (!said) { play(cry(e, 'hurt'), opts); return; }
    play('amazon-say-hurt', { ...opts, n: said.n });
    setTimeout(() => ctx.float(e.pos, `“${said.line}”`, 'say'), opts.delay ?? 0);
    ctx.log(`${e.name}: “${said.line}”`, 'info');
  }

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
  const BLOODLESS = new Set(['construct', 'elemental']);
  /**
   * What a creature bleeds: red blood for most, black ichor for fiends, aberrations and the
   * walking dead, green for insects, plants and oozes; nothing for bones, spirits, constructs and
   * elementals (null). A creature's record may say it outright with `blood`.
   */
  function bloodOf(e) {
    if (e.isHero) return 'red';
    const st = BESTIARY_BY_ID[e.statId]; if (!st || e.cond?.petrified) return null;
    if (st.blood !== undefined) return st.blood;
    if (BLOODLESS.has(st.type) || SPIRIT.test(st.id) || /skelet|bone|lich|mummy/.test(st.id)) return null;
    if (st.type === 'undead' || st.type === 'fiend' || st.type === 'aberration') return 'black';
    if (st.type === 'ooze' || st.type === 'plant' || /spider|beetle|centipede|scorpion|wasp|ankheg|ettercap|insect|crawler|stirge|weaver|brood/.test(st.id)) return 'green';
    return 'red';
  }
  const SPIRIT = /ghost|specter|spectre|wraith|shadow(?!-?bred|flame|-wolf)|banshee|will-o|poltergeist|hooded-rider|dread-sovereign|wisp|phantom|spirit-(?!wolf)/;
  /** CSS filters that turn the red blood pictures into ichor or sap. */
  const BLOOD_FILTER = { red: 'none', black: 'grayscale(1) brightness(.32) contrast(1.3)', green: 'hue-rotate(95deg) saturate(.75) brightness(.62)' };
  const SPRAY_COLOR = { red: '#8d0b0b', black: '#151012', green: '#3e5a12' };

  /** Pools and splatters on the floor, and a spray of drops flying away from the blow. */
  function bleed(e, n, death = false) {
    if (!(n > 0) || !s.map) return;
    const blood = bloodOf(e); if (!blood) return;
    const { w, h } = dims(e.size ?? 1);
    const share = Math.min(1, n / Math.max(1, e.maxHp));
    // Which way the blood flies: away from whoever struck the blow.
    const c = { x: e.pos.x + w / 2, y: e.pos.y + h / 2 };
    const from = s.hitFrom ?? { x: c.x, y: c.y + 1 };
    let dx = c.x - from.x; let dy = c.y - from.y; const len = Math.hypot(dx, dy) || 1; dx /= len; dy /= len;
    const pools = death ? w * h + 1 : 1 + (share >= 0.25 ? 1 : 0);
    for (let i = 0; i < pools; i++) {
      const x = e.pos.x + (death ? i % w : Math.floor(Math.random() * w));
      const y = e.pos.y + (death ? Math.floor(i / w) % h : Math.floor(Math.random() * h));
      s.blood.push({ x, y, ox: (Math.random() - 0.5) * 0.5, oy: (Math.random() - 0.5) * 0.5, color: blood,
        r: death ? 0.6 + Math.random() * 0.25 : 0.2 + share * 0.55 + Math.random() * 0.1, rot: Math.floor(Math.random() * 360), n: 1 + Math.floor(Math.random() * 4) });
    }
    // Splatter: small drops thrown a square or so beyond the target, more for harder blows.
    const drops = 2 + Math.round(share * 6) + (death ? 3 : 0);
    for (let i = 0; i < drops; i++) {
      const spread = (Math.random() - 0.5) * 1.4; const dist = w / 2 + 0.2 + Math.random() * (0.6 + share * 1.2);
      const px = c.x + (dx * Math.cos(spread) - dy * Math.sin(spread)) * dist; const py = c.y + (dy * Math.cos(spread) + dx * Math.sin(spread)) * dist;
      const x = Math.floor(px); const y = Math.floor(py);
      if (!s.map.tiles[y]?.[x] || s.map.tiles[y][x] === TILE.ROCK) continue;
      s.blood.push({ x, y, ox: px - x - 0.5, oy: py - y - 0.5, color: blood, r: 0.06 + Math.random() * 0.1, rot: Math.floor(Math.random() * 360), n: 1 + Math.floor(Math.random() * 4) });
    }
    if (s.blood.length > 700) s.blood.splice(0, s.blood.length - 700);
    spray(c, dx, dy, blood, share, death);
  }

  /** A burst of drops flying from the wound (an animation on its own layer, gone in a moment). */
  function spray(c, dx, dy, blood, share, death) {
    const fx = host.querySelector('.dg-fx'); if (!fx || reduceMotion) return;
    const sz = S(); const count = Math.round(8 + share * 22 + (death ? 14 : 0));
    const ns = 'http://www.w3.org/2000/svg';
    for (let i = 0; i < count; i++) {
      const dot = document.createElementNS(ns, 'circle');
      const r = sz * (0.025 + Math.random() * 0.05);
      dot.setAttribute('r', r); dot.setAttribute('cx', c.x * sz); dot.setAttribute('cy', c.y * sz);
      dot.setAttribute('fill', SPRAY_COLOR[blood]);
      fx.append(dot);
      const spread = (Math.random() - 0.5) * (death ? 3.2 : 1.6); const dist = sz * (0.3 + Math.random() * (0.8 + share * 1.4));
      const tx = (dx * Math.cos(spread) - dy * Math.sin(spread)) * dist; const ty = (dy * Math.cos(spread) + dx * Math.sin(spread)) * dist;
      const ms = 280 + Math.random() * 320;
      dot.animate([
        { transform: 'translate(0,0) scale(1)', opacity: 1 },
        { transform: `translate(${tx * 0.6}px,${ty * 0.6 - sz * 0.12}px) scale(1.1)`, opacity: 1, offset: 0.55 },
        { transform: `translate(${tx}px,${ty}px) scale(.6)`, opacity: 0 },
      ], { duration: ms, easing: 'cubic-bezier(.2,.7,.4,1)' }).onfinish = () => dot.remove();
    }
  }

  /** A splat's shape: a main pool and satellite drops, made once so it stays the same. */
  function splatShape(big) {
    const blobs = [[0, 0, 1]];
    const n = big ? 7 + Math.floor(Math.random() * 6) : 3 + Math.floor(Math.random() * 4);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2; const d = 0.55 + Math.random() * (big ? 0.75 : 0.6);
      blobs.push([Math.cos(a) * d, Math.sin(a) * d, 0.12 + Math.random() * (big ? 0.42 : 0.3)]);
    }
    return blobs;
  }

  /** Blood on the floor, drawn as wet-looking splats in the creature's own colour. */
  function drawBlood() {
    const sz = S(); let out = '';
    for (const b of s.blood) {
      if (!s.revealAll && !s.revealed.has(cellKey(b.x, b.y))) continue;
      b.blobs ??= splatShape(b.r > 0.3);
      const cx = (b.x + 0.5 + b.ox) * sz; const cy = (b.y + 0.5 + b.oy) * sz; const r = b.r * sz * 0.62;
      out += `<g class="blood" transform="translate(${cx} ${cy}) rotate(${b.rot}) scale(1 .78)" fill="url(#bl-${b.color ?? 'red'})">${b.blobs.map(([x, y, k]) => `<circle cx="${(x * r).toFixed(1)}" cy="${(y * r).toFixed(1)}" r="${(k * r).toFixed(1)}"/>`).join('')}</g>`;
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
    { const d = dims(attacker.size ?? 1); s.hitFrom = { x: attacker.pos.x + d.w / 2, y: attacker.pos.y + d.h / 2 }; } // blood flies away from the blow
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
    // Watch the dice land before the result is told (the Dice setting decides whose rolls).
    if (diceWanted(!!attacker.isHero)) {
      const kept = r.d20s.indexOf(r.d20);
      const groups = [{ dice: r.d20s.map((v, i) => ({ sides: 20, value: v, dropped: r.d20s.length > 1 && i !== kept })), caption: `${signed(w.toHit)} vs Evasion ${opts.ac}${opts.mode !== 'normal' ? ` (${opts.mode})` : ''}` }];
      if (r.hit && r.damageRoll?.rolls?.length) groups.push({ dice: diceOf(w.damage, r.damageRoll.rolls), caption: `${r.damage} ${weapon.type}` });
      await rollDice({ groups, label: `${who} → ${whom}`, verdict: r.hit ? (r.crit ? 'Critical hit!' : 'Past their guard') : r.d20 === 1 ? 'Natural 1!' : 'Dodged', verdictKind: r.hit ? 'good' : 'bad', parent: viewport.parentElement, fast: !attacker.isHero });
    }
    const dice = r.d20s.length > 1 ? `d20 (${r.d20s.join(', ')} → ${r.d20})` : `d20 (${r.d20})`;
    const why = [...opts.adv.map((a) => `advantage: ${a}`), ...opts.dis.map((d) => `disadvantage: ${d}`), opts.cover === 'half' ? 'half cover +2' : opts.cover === 'three-quarters' ? 'three-quarters cover +5' : null].filter(Boolean);
    const hurled = ranged && (weapon.spell || weapon.melee || /rock|boulder|stone/i.test(weapon.name));
    let line = `${hurled ? `${who} hurls ${weapon.name} at ${whom}` : `${who} ${ranged ? 'shoots' : 'attacks'} ${whom} with ${weapon.name}`}: ${dice} ${signed(weapon.toHit)}${boost.text} = ${r.total} vs Evasion ${opts.ac}${why.length ? ` (${why.join('; ')})` : ''}.`;
    // Past Evasion: the defender may still block it (shield, or a parry with a trained weapon).
    let crippled = null;
    const blocked = r.hit && !r.crit && (opts.block ?? 0) > 0 && Math.random() < opts.block;
    if (blocked) {
      const def = target.defence;
      line += ` It would land, but ${whom} ${def?.blockWith === 'shield' ? 'catches it on the shield' : 'parries it'}! (${Math.round(opts.block * 100)}% block)`;
      ctx.float(target.pos, def?.blockWith === 'shield' ? 'blocked' : 'parried', 'muted');
      play('sword-hit', { volume: 0.35 });
    } else if (r.hit) {
      const bits = [];
      // Split the blow by damage type (materials.js): the weapon's own type plus any extra dice
      // (a fire rider, poison on a bite). Your own extras (sneak attack, smiting) share the weapon's type.
      const extraByType = {};
      for (const x of r.extras ?? []) extraByType[x.type] = (extraByType[x.type] ?? 0) + x.total;
      let main = r.damage - Object.values(extraByType).reduce((a, b) => a + b, 0);
      if (attacker === s.hero) {
        const x = ctx.hitExtras(target, weapon, opts, ranged, r.crit);
        main += x.total; bits.push(...x.text);
      }
      // A silver blade against the undead (or a fiend): its bane dice.
      if (weapon.bane && weapon.bane.types.includes(BESTIARY_BY_ID[target.statId]?.type)) {
        const b = roll(weapon.bane.dice); extraByType[weapon.bane.type] = (extraByType[weapon.bane.type] ?? 0) + b.total; bits.push(`silver bites: +${b.total} ${weapon.bane.type}`);
      }
      if (!isPhysical(weapon.type)) { extraByType[weapon.type] = (extraByType[weapon.type] ?? 0) + main; main = 0; }
      let dmg = 0; let where = '';
      // Physical: lands on a body part (d100 on the creature's body map), meets the armour there or a gap.
      if (main > 0) {
        const roll100 = rollDie(100);
        const at = strike(target.defence, roll100, weapon.type);
        const pct = at.pct;
        let part = absorbed(main, pct);
        const map = target.bodyMap ?? 'humanoid';
        const partName = partOf(map, at.part)?.name.toLowerCase() ?? at.part;
        where = ` to the ${partName} (d100 ${roll100})`;
        if (pct) {
          bits.push(`${at.pieces.map((p) => p.name.toLowerCase()).join(' + ')} absorb${at.pieces.length > 1 ? '' : 's'} ${pct}% of ${weapon.type}: ${main} → ${part}`);
          for (const p of at.pieces) { const cond = wearArmour(p, r.crit); if (target === s.hero) ctx.wearHeroArmour?.(p.uid, cond); }
        } else if (partCover(target.defence, at.part) > 0) bits.push('through a gap in the armour');
        if (target === s.hero && s.def.uncanny && s.hero.reaction && part > 1) {
          part = Math.floor(part / 2); s.hero.reaction = false; bits.push('Uncanny Dodge halves it');
        }
        // The part takes what got through; total HP takes it times the part's multiplier (injury.js).
        // The creature's own nature: immune, resistant, vulnerable (mundane blades v a balor...).
        const f = typeFactor(target.defence, weapon.type, { magic: !!weapon.magic, silver: weapon.metal === 'silver' });
        if (f !== 1) { bits.push(f === 0 ? `immune to ${weapon.type}` : f < 1 ? `resists ${weapon.type}` : `vulnerable to ${weapon.type}`); part = Math.round(part * f); }
        const inj = applyHit(target, at.part, part);
        if (inj.mult !== 1) bits.push(`${partName} ×${inj.mult}: ${part} → ${inj.total} HP`);
        bits.push(`${partName} ${inj.partLeft}/${inj.partMax}`);
        if (inj.crippledNow) crippled = at.part;
        dmg += inj.total;
        target.lastHit = { part: at.part, roll: roll100, covered: at.covered, raw: main, dealt: part, pct };
      }
      // Fire, cold, poison...: straight to total HP, less the armour's overall resistance to it.
      for (const [type, amount] of Object.entries(extraByType)) {
        if (amount <= 0) continue;
        const res = resistance(target.defence, type);
        const got = afterResistance(target.defence, amount, type);
        dmg += got;
        bits.push(`${got} ${type}${res ? ` (armour resists ${res}%: ${amount} → ${got})` : ''}`);
      }
      dmg = Math.max(0, dmg);
      if (target === s.hero) ctx.damageHero(dmg); else dmg = ctx.damageMonster(target, dmg);
      line += ` ${r.crit ? 'CRITICAL HIT' : 'Hit'}${where}! ${dmg} damage${r.damageRoll ? ` [${r.damageRoll.rolls.join(', ')}${r.damageRoll.modifier ? ` ${signed(r.damageRoll.modifier)}` : ''}]` : ''}${bits.length ? ` (${bits.join('; ')})` : ''}.`;
      // A Tibia-style caption: the kind of blow (small), the damage (big), where it landed (small).
      const kinds = [...(main > 0 ? [weapon.type] : []), ...Object.keys(extraByType).filter((k) => extraByType[k] > 0)];
      const top = getSetting('dmgType') === 'on' && kinds.length ? `${r.crit ? 'Critical! ' : ''}${kinds.map((k, i) => (i ? k : `${k[0].toUpperCase()}${k.slice(1)}`)).join(' + ')}` : r.crit ? 'Critical!' : '';
      const bottom = getSetting('dmgPart') === 'on' && target.lastHit && main > 0 ? shortName(target.bodyMap ?? 'humanoid', target.lastHit.part) : '';
      ctx.float(target.pos, { top, main: `−${dmg}`, bottom }, target === s.hero ? 'bad' : 'good', r.crit);
      play(ranged ? 'arrow-hit' : 'sword-hit');
      if (r.crit) play('crit', { volume: 0.9 });
      if (target.hp > 0) hurtCry(target, { delay: 120, volume: 0.85 });
      flashHit(target);
    } else {
      line += r.d20 === 1 ? ' Natural 1: a clumsy miss.' : ` ${whom} dodges it.`;
      ctx.float(target.pos, 'miss', 'muted');
      if (!ranged) play('swing-miss', { volume: 0.7 });
    }
    const landed = r.hit && !blocked;
    ctx.log(line, target === s.hero ? (landed ? 'bad' : 'info') : (landed ? 'good' : 'info'));
    if (crippled && target.hp > 0) {
      const kind = ruleOf(target, crippled).crippled;
      ctx.log(`${whom}'s ${(partOf(target.bodyMap ?? 'humanoid', crippled)?.name ?? crippled).toLowerCase()} is crippled: ${CRIPPLED_TEXT[kind]}.`, target === s.hero ? 'bad' : 'good');
      ctx.float(target.pos, kind === 'bleeding' ? 'bleeding!' : 'crippled!', target === s.hero ? 'bad' : 'good');
    }
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

  return { enemiesOf, heroAttackPlan, hasAmmo, whyNot, canAttack, heroAttack, heroOpportunityAttack, monsterOpportunityAttack, voiceOf, cry, hurtCry, shootProjectile, BOLT, boltFor, lunge, BLOODLESS, bloodOf, SPIRIT, bleed, drawBlood, flashHit, doAttack };
}
