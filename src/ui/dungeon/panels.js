/**
 * The side panel: hero card, spells, rest, creature info, talking, wrestling, nearby things, pop-ups.
 * Part of the dungeon screen (see ../dungeon-view.js): `ctx` gives access to the shared state `s`
 * and to the functions of the other parts.
 */
import { manaHtml } from '../mana-view.js';
import { manaCost } from '../../engine/magic.js';
import { tradeHtml } from '../trade-view.js';
import { morphInto } from '../morph.js';
import { FACINGS, facingAngle, woundState, escapeBonus, canWrestle, BOUND_TEXT, conditionLabels, attackOptions, chebyshev, covers } from '../../engine/combat.js';
import { coinsHtml, lootHtml, inventoryHtml } from '../inventory-view.js';
import { countOf, findItem, itemDef, formatCoins as formatCoinsShort, bagUsed, BAG_SLOTS, carriedWeight, loadLimits } from '../../engine/items.js';
import { DIAGONAL_RULES, cellKey } from '../../engine/movement.js';
import { BESTIARY_BY_ID } from '../../content/bestiary/index.js';
import { rollDie } from '../../engine/dice.js';
import { play } from '../audio.js';
import { skillXp } from '../../engine/magic.js';
import { formatModifier } from '../../engine/abilities.js';
import { sensesText } from '../../engine/monsters.js';
import { TALKS, resolveOf, insightOf, contestChance, talkOptions, PATIENCE, rollTalk } from '../../engine/talk.js';
import { cellsOf } from '../../engine/size.js';
import { TILE, roomAt } from '../../engine/dungeon.js';
import { checkChance, forceDc } from '../../engine/features.js';
import { xpProgress } from '../../engine/progression.js';
import { settingsControls } from '../settings.js';
import { monsterPortrait } from '../../content/media.js';
import { m as mtr, metricText } from '../../engine/units.js';
import { armourSummary } from '../../engine/defence.js';

export function installPanels(ctx) {
  const { $, esc, host, pct, s, signed } = ctx;

  function drawPanel() {
    const h = s.hero;
    if (!h) { $('.dg-herocard').innerHTML = '<p class="muted">Create or adopt a hero to explore.</p>'; return; }
    const ft = s.map.feetPerCell;
    const total = h.speed * (s.dash ? 2 : 1);
    const combat = s.mode === 'combat';
    const heroTurn = combat && !s.busy;
    $('.dg-banner').classList.toggle('turn', heroTurn);
    morphInto($('.dg-herocard'), `${partyBar()}
      <div class="hc-head">
        <div><h3>${esc(h.name)}</h3><p class="muted small">${combat ? `Round ${s.round} · ${s.busy ? 'enemies are acting…' : 'your turn'}` : 'Exploring'}</p></div>
        <div class="hc-compass" title="Facing ${FACINGS[h.facing].name}">
          <button class="btn icon small" data-dg="turn-left" aria-label="Turn left (Q)">⟲</button>
          <svg viewBox="-20 -20 40 40" class="hc-dial" aria-hidden="true"><circle r="17" class="hc-dial-ring"/><g transform="rotate(${facingAngle(h.facing)})"><path d="M -6 -2 L 0 -16 L 6 -2 Z" class="hc-dial-front"/><path d="M -6 2 L 0 14 L 6 2 Z" class="hc-dial-back"/></g></svg>
          <button class="btn icon small" data-dg="turn-right" aria-label="Turn right (E)">⟳</button>
        </div>
      </div>
      <p class="hc-facing small">Facing <b>${FACINGS[h.facing].name}</b>. Enemies behind you (dark half) attack with advantage.</p>
      <div class="hc-stat"><span>Hit points</span><b>${h.hp} / ${h.maxHp}</b></div>
      <div class="hc-bar"><span class="${h.hp <= h.maxHp / 2 ? 'low' : ''}" style="width:${(h.hp / h.maxHp) * 100}%"></span></div>
      ${s.res?.maxMana ? `<div class="hc-mana">${manaHtml(s.res.mana, s.res.maxMana)}</div>` : ''}
      <div class="hc-stat"><span>Movement</span><b>${combat ? `${s.moveLeft} of ${total} squares (${mtr(s.moveLeft * ft)})` : `${h.speed} squares per move`}</b></div>
      ${combat ? `<div class="hc-bar move"><span style="width:${total ? (s.moveLeft / total) * 100 : 0}%"></span></div>` : ''}
      <div class="hc-row"><span class="pip ${ctx.canAttack() && !s.actionUsed ? 'on' : s.attacksLeft > 0 ? 'half' : ''}">Action${s.attacksLeft > 0 ? ` (${s.attacksLeft} attack${s.attacksLeft > 1 ? 's' : ''} left)` : ''}</span><span class="pip ${!s.bonusUsed ? 'on' : ''}">Bonus</span><span class="pip ${h.reaction ? 'on' : ''}">Reaction</span><span class="muted small">Evasion ${h.ac}${h.defence?.block ? ` · block ${h.defence.block}%` : ''}${h.tempHp ? ` · +${h.tempHp} temp HP` : ''}</span></div>
      ${xpBar()}
      <div class="hc-purse">${coinsHtml(s.draft?.coins ?? 0)}</div>

      ${s.lastCheck ? `<p class="study-result ${s.lastCheck.ok ? 'ok' : ''}">${esc(s.lastCheck.text)}</p>` : ''}
      ${magicPanel()}
      <h4>Weapons</h4>
      <div class="hc-weapons">${h.weapons.map((w, i) => `
        <button class="weapon ${i === s.weaponIdx ? 'sel' : ''}" data-dg="weapon" data-i="${i}" aria-pressed="${i === s.weaponIdx}">
          <b>${esc(w.name)}</b><span>${signed(w.toHit)} to hit · ${esc(w.damage)} ${esc(w.type)}${w.ammo ? ` · ${countOf(s.draft.inventory, w.ammo)} ${esc(w.ammo.replace('-', ' '))}` : ''}</span>
          <span class="muted">${w.melee ? 'melee 1.5 m' : ''}${w.melee && w.ranged ? ' · ' : ''}${w.ranged ? `${w.thrown ? 'thrown, ' : ''}reach ${w.long} squares` : ''}</span>
        </button>`).join('')}</div>
      <div class="row wrap">
        <button class="btn small ghost" data-dg="retry" title="Restart this dungeon">Restart</button>
      </div>
      <label class="field small" for="dg-rule">Diagonal rule
        <select id="dg-rule" data-dg="rule">${Object.entries(DIAGONAL_RULES).map(([k, v]) => `<option value="${k}" ${k === s.rule ? 'selected' : ''}>${esc(v.name)}</option>`).join('')}</select>
      </label>`);
    morphInto($('.dg-actionbar'), actionBar());
    drawTargetInfo();
    drawPop();
    drawNearby();
    if (s.invOpen) drawInventory();
    holdLayout();
    $('.dg-initiative').innerHTML = combat ? `<h3>Initiative</h3><ol class="init">${s.order.map((o) => {
      const e = o.hero ? ctx.party().find((x) => x.id === o.id) : s.monsters.find((m) => m.id === o.id);
      if (!e || e.dead || (o.hero && e.hp <= 0)) return '';
      return `<li class="${o.hero ? 'me' : ''} ${o.id === s.hero.id ? 'now' : ''}"><b>${o.init}</b> ${esc(e.name)}${e.side === 'ally' ? ' <span class="ally-tag">ally</span>' : ''}${o.hero || e.side === 'ally' ? ` <span class="muted small">${e.hp} HP</span>` : ` <span class="muted small">${ctx.canSee(e) ? woundState(e.hp, e.maxHp) : 'unseen'}</span>`}</li>`;
    }).join('')}</ol>` : '';
    $('.dg-log').innerHTML = s.log.map((l) => `<li class="${l.kind}">${esc(l.text)}</li>`).join('');
    $('.dg-zoom').textContent = `${Math.round(s.zoom * 100)}%`;
  }

  /**
   * Keep the page from getting shorter while playing. If the panel shrinks (a shorter log, a
   * closed info box), the browser would pull the page's scroll back and the map would jump under
   * a still mouse, so a click would land a few squares off. Heights only ever grow here.
   */
  function holdLayout() {
    for (const el of [host, $('.dg-actionbar')]) {
      const h = el.offsetHeight;
      if (h > (Number(el.dataset.minH) || 0)) { el.dataset.minH = String(h); el.style.minHeight = `${h}px`; }
    }
  }

  function magicPanel() {
    const d = s.def; const m = d?.magic;
    if (!m || (!m.spells.length && !m.abilities.length)) return '';
    const r = s.res;
    const usable = [...m.abilities.filter((a) => !a.passive), ...m.spells].sort((a, b) => (a.kind === b.kind ? (a.level ?? 0) - (b.level ?? 0) : a.kind === 'ability' ? -1 : 1));
    const btn = (it) => {
      const why = ctx.magicBlocked(it);
      const cost = it.kind === 'spell' ? (it.level === 0 ? 'free (cantrip)' : `${manaCost(it)} mana`) : Number.isFinite(it.maxUses) ? `${r.uses[it.id] ?? 0}/${it.maxUses}` : it.effect?.type === 'pool' ? `${r.pool} HP` : '';
      return `<button class="spell-btn ${it.kind} ${why ? 'off' : ''}" data-dg="cast" data-id="${it.id}" title="${esc(`${it.desc}${it.range ? ` Reach ${it.range} squares.` : ''} ${why ? `(${why})` : ''}`)}">
        <b>${esc(it.name)}</b><span class="muted">${esc(cost)} · ${ctx.timeLabel[it.time] ?? 'action'}${it.range > 1 ? ` · reach ${it.range}` : it.range === 1 ? ' · touch' : ''}${it.concentration ? ' · C' : ''}</span></button>`;
    };
    const slots = r.maxMana ? `<div class="mana-row">${manaHtml(r.mana, r.maxMana)}</div>` : '';
    const buffs = [s.res.concentration && `Concentrating: ${ctx.findMagic(s.res.concentration)?.name}`, s.buffs.shield && 'Ward of Iron +5 Evasion', s.buffs.smite && 'Wrath ready', s.buffs.ensnare && 'Ensnaring Strike ready',
      s.buffs.inspiration && `Inspiration ${s.buffs.inspiration}`, s.buffs.deathward && 'Ward against Death', s.hero.tempHp && `${s.hero.tempHp} temp HP`].filter(Boolean);
    return `<h4>Spells &amp; abilities</h4>
      ${d.caster ? `<p class="small muted">Spell save DC <b>${d.caster.dc}</b> · spell attack <b>${signed(d.caster.attack)}</b> (${d.caster.ability.toUpperCase()})</p>` : ''}
      ${slots}
      ${buffs.length ? `<p class="small buffs">${buffs.map(esc).join(' · ')}${s.res.concentration ? ' <button class="linkish" data-dg="end-conc">end</button>' : ''}</p>` : ''}
      <div class="spell-list">${usable.map(btn).join('')}</div>
      ${m.abilities.some((a) => a.passive) ? `<p class="small muted">Always on: ${m.abilities.filter((a) => a.passive).map((a) => `<span title="${esc(a.desc)}">${esc(a.name)}</span>`).join(', ')}</p>` : ''}`;
  }

  /**
   * The hero's actions, as big buttons across the top of the map so nobody misses them: what
   * the hero can do right now, with the keyboard shortcut and why a button is disabled.
   */
  function actionBar() {
    const h = s.hero; if (!h || !s.res || s.mode === 'defeat' || s.mode === 'victory') return '';
    const combat = s.mode === 'combat'; const myTurn = combat && !s.busy;
    const inv = s.draft?.inventory ?? [];
    const btn = (id, icon, label, { hint = '', why = '', primary = false, key = '', extra = '' } = {}) => `
      <button class="act-btn ${primary ? 'primary' : ''}" data-dg="${id}" ${why ? 'disabled' : ''} title="${esc(why ? `${label}: ${why}` : hint)}">
        <span class="act-ico" aria-hidden="true">${icon}</span><span class="act-label">${label}${extra ? ` <small>${extra}</small>` : ''}</span>${key ? `<kbd>${key}</kbd>` : ''}</button>`;
    const busy = s.busy ? 'wait for the enemies to finish' : '';
    const status = combat
      ? (s.busy ? '<b>Enemies are acting…</b>' : `<b>${esc(h.name)}'s turn</b><span>Round ${s.round}</span>`)
      : `<b>Exploring</b><span>${esc(h.name)} leads</span>`;
    return `<div class="act-status ${myTurn ? 'mine' : ''}">${status}</div>
      <div class="act-buttons">
        ${combat ? btn('dash', '💨', 'Dash', { why: busy || (s.actionUsed ? 'your action is spent' : ''), hint: 'Use your action to double your movement this turn' }) : ''}
        ${btn('search', '🔍', 'Search', { key: 'F', why: busy, hint: `Perception or Investigation (your better one) against hidden traps and secret doors nearby${combat ? '. Uses your action.' : ''}` })}
        ${btn('inventory', '🎒', 'Pack', { key: 'I', hint: 'Open your pack: equip, use potions, drop' })}
        ${btn('characters', '👤', 'Characters', { key: 'C', hint: 'Each hero at a glance: summary, abilities, and the body part by part' })}
        ${btn('bandage', '🩹', 'Bandage', { extra: `×${countOf(inv, 'bandage')}`, why: busy || (countOf(inv, 'bandage') ? '' : 'no bandages left'), hint: `Medicine check (DC 10): heal 1d6 + Medicine${combat ? '. Uses your action.' : ''}` })}
        ${btn('sneak', '👣', s.sneak ? `Sneaking (${s.sneak.total})` : 'Sneak', { why: combat ? 'not during a fight' : '', hint: 'Stealth check: foes whose passive Perception is lower will not notice you' })}
        ${combat ? btn('end-turn', '⏭', 'End turn', { primary: true, key: 'Space', why: busy, hint: 'Finish your turn: the next creature in the initiative order acts' }) : ''}
      </div>`;
  }

  // ---------------------------------------------------------------------------
  // Studying a foe: skill checks that reveal what you know about it
  // ---------------------------------------------------------------------------

  /** Which knowledge skill recalls lore about a creature type. */
  const LORE_SKILL = {
    humanoid: 'history', giant: 'history', beast: 'nature', plant: 'nature', monstrosity: 'nature',
    undead: 'religion', fiend: 'religion', celestial: 'religion',
    aberration: 'arcana', construct: 'arcana', dragon: 'arcana', elemental: 'arcana', fey: 'arcana', ooze: 'arcana',
  };

  const SKILL_LABEL = { insight: 'Insight', medicine: 'Medicine', perception: 'Perception', history: 'History', nature: 'Nature', religion: 'Religion', arcana: 'Arcana',
    persuasion: 'Persuasion', intimidation: 'Intimidation', deception: 'Deception', performance: 'Performance', 'animal-handling': 'Animal Handling', athletics: 'Athletics' };

  const STUDIES = (stat) => [
    { id: 'mind', skill: 'insight', ability: 'WIS', label: 'Read its intent', reveals: 'personality, tactics and morale' },
    { id: 'hp', skill: 'medicine', ability: 'WIS', label: 'Judge its wounds', reveals: 'exact hit points' },
    { id: 'gear', skill: 'perception', ability: 'WIS', label: 'Size up its gear', reveals: 'armour class and weapons' },
    { id: 'lore', skill: LORE_SKILL[stat.type] ?? 'arcana', ability: 'INT', label: 'Recall its lore', reveals: 'abilities, senses and traits' },
  ];

  /** DC for knowing about a creature: 10 + its challenge rating (rounded down). */
  const studyDC = (stat) => 10 + Math.floor(stat.crValue);

  const known = (m, id) => (id === 'hp' ? s.knownHp.has(m.id) : s.knowledge[m.statId]?.has(id));

  function study(m, studyId) {
    if (s.busy) return;
    if (s.mode === 'combat' && s.actionUsed) { ctx.banner('Studying a foe takes your action, and you have used it.'); return; }
    const stat = BESTIARY_BY_ID[m.statId];
    const st = STUDIES(stat).find((x) => x.id === studyId);
    const bonus = s.hero.skills[st.skill] ?? 0;
    const d20 = rollDie(20); const total = d20 + bonus; const dc = studyDC(stat);
    const ok = total >= dc;
    play('dice', { volume: 0.7 });
    if (ok) {
      if (studyId === 'hp') s.knownHp.add(m.id);
      else (s.knowledge[m.statId] ??= new Set()).add(studyId);
      ctx.awardXp(skillXp(dc, s.def.level), m.pos);
    }
    if (s.mode === 'combat') s.actionUsed = true;
    s.lastStudy = { id: m.id, studyId, ok, text: `${SKILL_LABEL[st.skill]}: d20 (${d20}) ${signed(bonus)} = ${total} vs DC ${dc}. ${ok ? 'Success!' : 'Not this time.'}` };
    ctx.log(`${s.hero.name} studies the ${m.name} (${SKILL_LABEL[st.skill]}): d20 (${d20}) ${signed(bonus)} = ${total} vs DC ${dc}. ${ok ? `Success: learns its ${st.reveals}.` : 'Fails to learn anything new.'}`, ok ? 'good' : 'info');
    ctx.redraw();
  }

  function revealedHtml(m, stat) {
    let out = '';
    if (known(m, 'mind')) {
      out += `<div class="reveal"><h4>Intent</h4><p>${esc(stat.lore.personality)}</p><p><b>Tactics:</b> ${esc(stat.lore.tactics)}</p>
        <p class="muted small">${m.hp <= m.maxHp / 2 ? 'It looks shaken and is thinking about escape.' : 'It is confident and eager to fight.'}</p></div>`;
    }
    if (known(m, 'gear')) {
      const weapons = stat.actions.filter((a) => a.attack);
      out += `<div class="reveal"><h4>Gear</h4><p><b>Evasion ${m.ac}</b>${m.defence?.block ? ` · <b>blocks ${m.defence.block}%</b> (${m.defence.blockWith === 'shield' ? 'shield' : 'parries'})` : ' · cannot block'}</p>
        <p class="small">${esc(m.defence ? armourSummary(m.defence) : `AC ${stat.ac}`)}</p>
        <ul class="plain small">${weapons.map((a) => `<li><b>${esc(a.name)}</b>: ${formatModifier(a.attack.toHit)} to hit, ${esc(a.attack.damage.map((d) => `${d.dice} ${d.type}`).join(' + '))}${a.attack.range ? `, range ${metricText(`${a.attack.range} ft`)}` : ''}</li>`).join('')}</ul></div>`;
    }
    if (known(m, 'lore')) {
      out += `<div class="reveal"><h4>Lore</h4><p class="small">${esc(stat.size)} ${esc(stat.type)}, challenge ${esc(stat.cr)} · speed ${esc(metricText(stat.speedText))} · ${esc(sensesText(stat))}</p>
        <p class="small">STR ${stat.scores.str} · DEX ${stat.scores.dex} · CON ${stat.scores.con} · INT ${stat.scores.int} · WIS ${stat.scores.wis} · CHA ${stat.scores.cha}</p>
        ${stat.traits.map((t) => `<p class="small"><b>${esc(t.name)}.</b> ${esc(metricText(t.text))}</p>`).join('')}
        <p class="small muted">${esc(stat.lore.origin)}</p></div>`;
    }
    return out;
  }

  // ---------------------------------------------------------------------------
  // Talking, shoving and grappling, freeing captives, commanding allies
  // ---------------------------------------------------------------------------

  /** The situation around a creature, for its resolve. */
  function talkContext(m) {
    const near = ctx.foes().filter((f) => !f.calm && ctx.edist(f, m) <= 6).length;
    return { heroLevel: s.def.level, hostile: !!m.aware && s.mode === 'combat', bloodied: m.hp <= m.maxHp / 2, outnumbered: ctx.partyAlive().length + ctx.allies().length > near };
  }

  /** Everything about one talk attempt: bonuses, the reasons behind the resolve, the chance. */
  function talkMath(m, id, lang) {
    const stat = BESTIARY_BY_ID[m.statId]; const T = TALKS[id];
    const parts = resolveOf(stat, id, talkContext(m));
    const insight = insightOf(stat); const resolve = parts.reduce((t, [, v]) => t + v, 0);
    const heroBonus = s.hero.skills[T.skill] ?? 0;
    const mode = id === 'intimidate' && !lang && stat.type !== 'beast' ? 'disadvantage' : 'normal';
    return { stat, T, parts, insight, resolve, heroBonus, mode, targetBonus: insight + resolve, chance: contestChance(heroBonus, insight + resolve, mode) };
  }

  function talkSection(m) {
    const stat = BESTIARY_BY_ID[m.statId];
    const t = talkOptions(stat, { languages: s.def.languages ?? [], skills: s.hero.skills });
    const left = PATIENCE - (m.talks ?? 0);
    const far = ctx.edist(s.hero, m) > 12 || !ctx.inSight(m);
    const blocked = s.busy || (s.mode === 'combat' && s.actionUsed) || left <= 0 || far || m.calm;
    const why = m.calm ? 'It has agreed to leave you be.' : left <= 0 ? 'It will not listen to you any more.' : far ? 'Too far to be heard (18 m) or out of sight.' : '';
    const buttons = t.options.map((id) => {
      const k = talkMath(m, id, t.lang);
      const tip = `${k.T.desc} Its roll: d20 + Insight ${signed(k.insight)}${k.parts.map(([r, v]) => ` ${signed(v)} (${r})`).join('')}.${k.mode === 'disadvantage' ? ' No shared language: disadvantage.' : ''}`;
      return `<button class="study talk" data-dg="talk" data-talk="${id}" ${blocked ? 'disabled' : ''} title="${esc(tip)}">
        <b>${k.T.label}</b> <span class="muted">${SKILL_LABEL[k.T.skill]} ${signed(k.heroBonus)} vs ${signed(k.targetBonus)}${k.mode === 'disadvantage' ? ' (dis.)' : ''} · <b>${pct(k.chance)}</b></span>
        <span>${esc(k.T.desc)}</span></button>`;
    }).join('');
    return `<h4>Talk <span class="muted small">${t.lang ? `in ${esc(t.lang)} · ` : ''}${Math.max(0, left)} of ${PATIENCE} tries left${s.mode === 'combat' ? ' · uses your action' : ''}</span></h4>
      ${t.why ? `<p class="small muted">${esc(t.why)}</p>` : ''}${why ? `<p class="small hint">${esc(why)}</p>` : ''}
      ${buttons ? `<div class="studies">${buttons}</div>` : ''}`;
  }

  /** Speak to a creature: a contest of your social skill against its Insight plus its resolve. */
  function talkTo(m, id) {
    const stat = BESTIARY_BY_ID[m.statId];
    const opts = talkOptions(stat, { languages: s.def.languages ?? [], skills: s.hero.skills });
    if (!opts.options.includes(id) || m.dead) return;
    if ((m.talks ?? 0) >= PATIENCE) { ctx.banner(`${m.name} will not listen any more.`); return; }
    if (ctx.edist(s.hero, m) > 12 || !ctx.inSight(m)) { ctx.banner('Too far away to be heard (18 m), or out of sight.'); return; }
    if (!ctx.spendAction('Talking')) return;
    const k = talkMath(m, id, opts.lang);
    const r = rollTalk({ heroBonus: k.heroBonus, targetBonus: k.targetBonus, mode: k.mode, rng: (n) => rollDie(n) - 1 });
    m.talks = r.nat1 ? PATIENCE : (m.talks ?? 0) + 1;
    play('dice', { volume: 0.5 });
    const verb = { parley: 'talk down', recruit: 'win over', intimidate: 'frighten', taunt: 'goad', mock: 'mock', soothe: 'soothe' }[id];
    const dice = r.heroDice.length > 1 ? `d20 (${r.heroDice.join(', ')} → ${r.hero})` : `d20 (${r.hero})`;
    let line = `${s.hero.name} tries to ${verb} the ${m.name.toLowerCase()}${opts.lang ? ` in ${opts.lang}` : ''}: ${SKILL_LABEL[k.T.skill]} ${dice} ${signed(k.heroBonus)}${r.nat20 ? ' +10 (natural 20!)' : ''} = ${r.heroTotal} vs its Insight d20 (${r.t}) ${signed(k.insight)}${k.resolve ? ` + resolve ${signed(k.resolve)}` : ''} = ${r.targetTotal}.`;
    if (r.ok) {
      const c = m.cond ??= {};
      if (k.T.goal === 'calm') {
        m.calm = true; m.aware = false; delete c.taunt;
        s.order = s.order.filter((o) => o.id !== m.id);
        line += ` ${m.name} lowers its guard and lets you be. Leave it in peace and it will not fight.`;
      } else if (k.T.goal === 'recruit') {
        line += ' Success!';
        ctx.joinParty(m, { reason: 'for the rest of this floor' });
      } else if (k.T.goal === 'flee') { c.flee = 2; line += ` ${m.name} is frightened and flees for 2 rounds!`; } else if (k.T.goal === 'taunt') { c.taunt = { id: s.hero.id, rounds: 2 }; line += ` ${m.name} roars and turns on ${s.hero.name}!`; } else if (k.T.goal === 'mock') { c.mock = true; line += ` ${m.name} is rattled: disadvantage on its next attack.`; }
      ctx.log(line, 'good');
      ctx.awardXp(skillXp(Math.max(5, k.targetBonus + 10), s.def.level), m.pos);
      // Winning a fight without blood still overcomes it: its XP, once.
      if ((k.T.goal === 'calm' || k.T.goal === 'recruit') && !m.xpGiven) { m.xpGiven = true; ctx.awardPartyXp(stat.xp, m.pos); }
      if (k.T.goal === 'flee' || k.T.goal === 'taunt' || k.T.goal === 'mock') ctx.provoke([m]);
      ctx.checkCombatOver();
    } else {
      line += r.nat1 ? ' A natural 1: you insult it badly. It will not listen again.' : ` It is not swayed.${(m.talks ?? 0) >= PATIENCE ? ' It has heard enough.' : ''}`;
      ctx.log(line, 'info');
      if (!m.aware || k.T.goal !== 'calm') { play(ctx.cry(m, 'attack'), { volume: 0.6 }); ctx.provoke([m]); }
    }
    s.target = null;
    ctx.redraw();
  }

  /** Shove (push 1.5 m or knock prone) or grapple: your Athletics against its Athletics or Acrobatics. */
  function wrestleSection(m) {
    const stat = BESTIARY_BY_ID[m.statId];
    const hb = s.hero.skills.athletics ?? 0; const tb = escapeBonus(stat);
    const near = ctx.edist(s.hero, m) <= 1;
    const ok = canWrestle(stat) && !m.cond?.petrified;
    const blocked = s.busy || (s.mode === 'combat' && s.actionUsed) || !near || !ok;
    const why = !ok ? 'Too big to shove or grapple (more than one size larger than you).' : !near ? 'Move next to it to shove or grapple.' : '';
    const pct2 = pct(wrestleChance(hb, tb));
    return `<h4>Shove or grapple <span class="muted small">Athletics ${signed(hb)} vs its ${signed(tb)} · ${pct2}${s.mode === 'combat' ? ' · uses your action' : ''}</span></h4>
      ${why ? `<p class="small muted">${esc(why)}</p>` : ''}
      <div class="row wrap">
        <button class="btn small" data-dg="wrestle" data-how="prone" ${blocked ? 'disabled' : ''} title="Knock it down: attacks within 1.5 m have advantage against it; it wastes half its move getting up.">Knock prone</button>
        <button class="btn small" data-dg="wrestle" data-how="push" ${blocked ? 'disabled' : ''} title="Push it one square (1.5 m) straight away from you (into a fire wall, perhaps).">Push 1.5 m</button>
        <button class="btn small" data-dg="wrestle" data-how="grapple" ${blocked || m.cond?.grappled ? 'disabled' : ''} title="Seize it: its speed is 0 while you stay next to it. It tries to break free each turn.">Grapple</button>
      </div>`;
  }

  /** Contest with no natural-20 bonus: P(d20 + a > d20 + b), ties to the defender. */
  function wrestleChance(a, b) {
    let w = 0; for (let h = 1; h <= 20; h++) for (let t = 1; t <= 20; t++) if (h + a > t + b) w++;
    return w / 400;
  }

  function wrestle(m, how) {
    const stat = BESTIARY_BY_ID[m.statId];
    if (ctx.edist(s.hero, m) > 1 || !canWrestle(stat)) return;
    if (!ctx.spendAction(how === 'grapple' ? 'Grappling' : 'Shoving')) return;
    const hb = s.hero.skills.athletics ?? 0; const tb = escapeBonus(stat);
    const h = rollDie(20); const t = rollDie(20);
    const ok = h + hb > t + tb;
    let line = `${s.hero.name} tries to ${how === 'grapple' ? 'grapple' : 'shove'} the ${m.name.toLowerCase()}: Athletics d20 (${h}) ${signed(hb)} = ${h + hb} vs its d20 (${t}) ${signed(tb)} = ${t + tb}.`;
    const c = m.cond ??= {};
    if (ok) {
      if (how === 'prone') { c.prone = true; line += ` ${m.name} crashes to the ground!`; }
      if (how === 'push') { const before = { ...m.pos }; pushAway(m, 1); line += m.pos.x !== before.x || m.pos.y !== before.y ? ` ${m.name} is pushed back.` : ' It is shoved against something solid and goes nowhere.'; }
      if (how === 'grapple') { c.grappled = { by: s.hero.id, dc: 8 + hb }; line += ` ${s.hero.name} has it in a hard grip: its speed is 0.`; }
      play('sword-hit', { volume: 0.6 });
      ctx.awardXp(skillXp(Math.max(5, tb + 10), s.def.level), m.pos);
    } else { line += ' It does not budge.'; play('swing-miss', { volume: 0.6 }); }
    ctx.log(line, ok ? 'good' : 'info');
    for (const fx of s.effects) if (fx.dice && ctx.inEffect(m, fx)) ctx.log(ctx.burnIn(m, fx), 'good');
    ctx.finishIfDead(m);
    s.target = null;
    ctx.provoke([m]);
    ctx.checkCombatOver();
    ctx.redraw();
  }

  /** Push a creature `n` squares straight away from the active hero, stopping at walls and others. */
  function pushAway(m, n) {
    const dx = Math.sign(m.pos.x - s.hero.pos.x); const dy = Math.sign(m.pos.y - s.hero.pos.y);
    const blocked = new Set([...ctx.occupied(m), ...ctx.terrainBlocked()]);
    for (let i = 0; i < n; i++) {
      const next = { x: m.pos.x + dx, y: m.pos.y + dy };
      const cells = cellsOf(next, m.size ?? 1);
      if (cells.some((q) => s.map.tiles[q.y]?.[q.x] === undefined || s.map.tiles[q.y][q.x] === TILE.ROCK || blocked.has(cellKey(q.x, q.y)) || (s.map.tiles[q.y][q.x] === TILE.DOOR && !s.doors.get(cellKey(q.x, q.y))))) break;
      m.pos = next;
    }
  }

  /** Shackles off: a captive is grateful and joins your company for good. */
  function freeCreature(m) {
    if (m.cond) delete m.cond.bound;
    if (m.side === 'captive') {
      ctx.log(`The shackles fall away. "${s.hero.name}, I owe you my life. I will see this through with you," says ${m.name}.`, 'good');
      ctx.joinParty(m, { permanent: true, reason: 'now that her chains are broken' });
      if (!m.xpGiven) { m.xpGiven = true; ctx.awardPartyXp(BESTIARY_BY_ID[m.statId].xp * 4, m.pos); }
    } else ctx.log(`${m.name} is free of its bonds.`, 'info');
  }

  /** Talking with someone in a campaign place: what they say, what you can ask, what they sell. */
  /** What a trader offers for the active hero's loot (trade-view.js), with haggling. */
  function sellSection(m) {
    const h = m.haggles?.[s.hero.id];
    return tradeHtml({ gear: s.draft, rate: ctx.tradeRate(m), haggle: h ?? null, persuasion: s.hero.skills.persuasion ?? 0, heroName: s.hero.name, attr: 'data-dg', trader: m.name.split(',')[0],
      tab: s.tradeTab ?? 'buy', shelf: s.tradeShelf, stock: ctx.traderStock(m) });
  }

  function npcPanel(m) {
    const close = '<button class="btn icon small" data-dg="close-loot" aria-label="Close">✕</button>';
    const pic = ctx.portraitOf(m);
    if (m.trader) {
      // A travelling trader met in a dungeon: sells gear and buys loot.
      const near = chebyshev(s.hero.pos, m.pos) <= 1;
      return `<div class="npc-card">
        <div class="foe-head">${pic ? `<img class="npc-pic" src="${esc(pic)}" alt="">` : ''}<h3>${esc(m.name)}</h3>${close}</div>
        <p class="npc-say">“${s.mode === 'combat' ? 'Not now! Deal with them first!' : 'Well met, well met. Bring out what you found down there; I pay fair coin, and I have wares of my own.'}”</p>
        ${!near ? '<p class="small muted">Walk up to the trader to trade.</p>' : s.mode === 'combat' ? '' : sellSection(m)}
      </div>`;
    }
    if (!ctx.campaign) return '';
    const near = chebyshev(s.hero.pos, m.pos) <= 1;
    const v = ctx.campaign.npcView(m.npcId, ctx.wallet());
    if (!v) return '';
    const said = s.npcSaid?.id === m.id ? s.npcSaid.text : `${m.name}: “${v.greet}”`;
    const shop = v.shop.map((id) => ({ id, def: itemDef({ id }) })).filter((x) => x.def);
    return `<div class="npc-card">
      <div class="foe-head">${pic ? `<img class="npc-pic" src="${esc(pic)}" alt="">` : ''}<h3>${esc(m.name)}</h3>${close}</div>
      <p class="npc-say">${esc(said)}</p>
      ${!near ? '<p class="small muted">Walk up to them to talk.</p>' : `
      ${v.options.length ? `<div class="npc-options">${v.options.map((o) => `<button class="btn npc-opt" data-dg="npc-opt" data-i="${o.i}" ${o.why ? `title="${esc(o.why)}"` : ''}>${esc(o.label)}${o.why ? ` <small>(${esc(o.why)})</small>` : ''}</button>`).join('')}</div>` : ''}
      ${shop.length ? `<h4>For sale</h4><ul class="shop">${shop.map(({ id, def }) => `<li><span>${def.glyph ?? '•'} ${esc(def.name)}</span><span class="muted small">${esc(formatCoinsShort(def.value))}</span>
        <button class="btn small" data-dg="npc-buy" data-id="${esc(id)}" ${(s.draft?.coins ?? 0) < def.value ? 'disabled title="Not enough coin"' : ''}>Buy</button></li>`).join('')}</ul>` : ''}
      ${shop.length ? `<h4>Sell</h4>${sellSection(m)}` : `<div class="small muted npc-purse">Purse (${esc(s.hero.name)}): ${coinsHtml(s.draft?.coins ?? 0)}</div>`}`}
    </div>`;
  }

  function captivePanel(m) {
    const bound = m.cond?.bound; const near = ctx.edist(s.hero, m) <= 1;
    const close = '<button class="btn icon small" data-dg="close-loot" aria-label="Close">✕</button>';
    const tools = ctx.hasTools(); const combatNote = s.mode === 'combat' ? ' · uses your action' : '';
    return `<div class="foe-card">
      <div class="foe-head">${ctx.portraitOf(m) ? `<img class="foe-portrait" src="${esc(ctx.portraitOf(m))}" alt="Portrait of ${esc(m.name)}">` : ''}
        <div><h3>${esc(m.name)}</h3><p class="small"><b>${esc(woundState(m.hp, m.maxHp))}</b> · ${bound ? esc(BOUND_TEXT[bound.to] ?? 'bound') : 'free'}</p>
        <p class="small muted">A prisoner of this place. ${bound ? 'Free her and she will join you.' : ''}</p></div>${close}</div>
      ${bound ? (near ? `<h4>Free her</h4><div class="studies">
        <button class="study" data-dg="pick-lock" ${tools ? '' : 'disabled'}><b>Pick the shackles</b> <span class="muted">DEX ${signed(s.def.toolBonus)} vs DC ${bound.dc} · ${Math.round(checkChance(s.def.toolBonus, bound.dc) * 100)}%</span><span>${tools ? `Thieves' tools${combatNote}` : 'Needs thieves\' tools'}</span></button>
        <button class="study" data-dg="force-lock"><b>Break the chain</b> <span class="muted">Athletics ${signed(s.hero.skills.athletics ?? 0)} vs DC ${bound.dc + 2}</span><span>Loud: nearby foes will hear${combatNote}</span></button>
      </div>` : '<p class="small muted">Move next to her to work on the shackles.</p>') : ''}
      <h4>Talk</h4><p class="small">"Quickly! The keys went with the guards. The lock is old, and the chain older."</p>
    </div>`;
  }

  function allyPanel(m) {
    const close = '<button class="btn icon small" data-dg="close-loot" aria-label="Close">✕</button>';
    const conds = conditionLabels(m);
    return `<div class="foe-card">
      <div class="foe-head">${ctx.portraitOf(m) ? `<img class="foe-portrait" src="${esc(ctx.portraitOf(m))}" alt="Portrait of ${esc(m.name)}">` : ''}
        <div><h3>${esc(m.name)} <span class="ally-tag">ally</span></h3><p class="small"><b>${m.hp} / ${m.maxHp} HP</b> · ${mtr(ctx.edist(s.hero, m) * 5)} away${conds.length ? ` · ${esc(conds.join(', '))}` : ''}</p>
        <p class="small muted">${m.permanent ? 'Sworn to your company: follows you down the stairs.' : m.allyRounds ? `Bound by a spell for ${m.allyRounds} more rounds.` : 'With you for the rest of this floor.'}</p></div>${close}</div>
      <h4>Orders</h4><div class="row wrap">
        <button class="btn small ${m.hold ? '' : 'primary'}" data-dg="ally-order" data-how="follow">Follow and fight</button>
        <button class="btn small ${m.hold ? 'primary' : ''}" data-dg="ally-order" data-how="hold">Hold this position</button>
        ${m.cond?.bound && ctx.edist(s.hero, m) <= 1 ? '<button class="btn small" data-dg="force-lock">Break the bonds</button>' : ''}
        ${!m.permanent ? '<button class="btn small" data-dg="ally-order" data-how="dismiss">Part ways</button>' : ''}
      </div>
      <p class="small muted">Allies act on their own initiative: they attack the nearest foe and keep close to you.</p>
    </div>`;
  }

  function foePanel(m) {
    const stat = BESTIARY_BY_ID[m.statId];
    const portrait = ctx.portraitOf(m);
    const conds = conditionLabels(m);
    const d = ctx.edist(s.hero, m);
    const combat = s.mode === 'combat';
    const health = s.knownHp.has(m.id) ? `${m.hp} / ${m.maxHp} HP` : woundState(m.hp, m.maxHp);
    const weapons = s.hero.weapons.map((w, i) => {
      const o = attackOptions({ attacker: s.hero, target: m, weapon: w, opaque: ctx.opaque(), occupied: ctx.occupied(), enemiesOf: ctx.enemiesOf });
      // Attacking outside a fight starts one (with surprise if it has not noticed you).
      const blocked = !o || !ctx.canAttack() || s.busy;
      const far = w.melee && !w.ranged && d > (w.reach ?? 1);
      const why = !o ? (far ? `Out of reach: ${d} squares away, and a ${w.name.toLowerCase()} reaches ${w.reach ?? 1}. Close in first.` : ctx.whyNot(m))
        : !ctx.canAttack() ? 'You have already used your action this turn.' : s.busy ? 'Wait for your turn.' : '';
      return `<button class="btn small ${o ? 'primary' : ''}" data-dg="attack-with" data-i="${i}" ${blocked ? 'disabled' : ''} title="${o && !blocked ? esc(`${pct(o.chance)} to get past its Evasion (${o.ac})${o.mode !== 'normal' ? `, ${o.mode}` : ''}${o.block ? `; it blocks ${pct(o.block)} of those (${m.defence?.blockWith === 'shield' ? 'shield' : 'parry'})` : o.unseen ? '; it cannot block this' : ''}: ${pct(o.land)} to land`) : esc(why)}">
        ${esc(w.name)}${o ? ` · ${pct(o.land)}` : far ? ' <small>(too far)</small>' : ''}</button>`;
    }).join('');
    // Nothing can reach it from here, but a melee weapon could after a few steps: walk in and strike.
    const melee = s.hero.weapons.findIndex((w) => w.melee);
    const anyShot = s.hero.weapons.some((w) => attackOptions({ attacker: s.hero, target: m, weapon: w, opaque: ctx.opaque(), occupied: ctx.occupied(), enemiesOf: ctx.enemiesOf }));
    const closeIn = !anyShot && melee >= 0 && ctx.canAttack() && !s.busy && ctx.strikeStep(m)
      ? `<button class="btn small primary" data-dg="close-in" title="Walk up to it and attack with your ${esc(s.hero.weapons[melee].name.toLowerCase())}">🏃 Close in and strike</button>` : '';
    const studies = STUDIES(stat).map((st) => {
      const done = known(m, st.id);
      return `<button class="study ${done ? 'done' : ''}" data-dg="study" data-study="${st.id}" ${s.busy || (combat && s.actionUsed) ? 'disabled' : ''}>
        <b>${SKILL_LABEL[st.skill]}</b> <span class="muted">${st.ability} ${signed(s.hero.skills[st.skill] ?? 0)}</span>
        <span>${done ? '✓ ' : ''}${esc(st.label)}</span></button>`;
    }).join('');
    const last = s.lastStudy?.id === m.id ? `<p class="study-result ${s.lastStudy.ok ? 'ok' : ''}">${esc(s.lastStudy.text)}</p>` : '';
    return `<div class="foe-card">
      <div class="foe-head">
        ${portrait ? `<img class="foe-portrait" src="${esc(portrait)}" alt="Portrait of a ${esc(m.name.toLowerCase())}">` : '<div class="foe-portrait none" aria-hidden="true">?</div>'}
        <div>
          <h3>${esc(m.name)}</h3>
          <p class="small"><b>${esc(health)}</b> · ${d} squares away · facing ${FACINGS[m.facing].name}</p>
          ${ctx.styleOf ? `<p class="small muted fight-style" title="How it fights: from its Intelligence, its magic and its nature">⚔ ${esc(ctx.styleOf(m).label)}</p>` : ''}
          ${conds.length || m.calm ? `<p class="small cond-line">${esc([m.calm ? 'calmed: leaves you be' : null, ...conds].filter(Boolean).join(' · '))}</p>` : ''}
          ${isBehindHero(m) ? '<p class="small hint">You are behind it: attacks have advantage.</p>' : ''}
        </div>
        <button class="btn icon small" data-dg="deselect" aria-label="Close">✕</button>
      </div>
      <h4>Attack</h4>
      <div class="row wrap">${weapons}${closeIn}</div>
      ${(() => {
    const targeted = [...(s.def.magic?.abilities ?? []), ...(s.def.magic?.spells ?? [])].filter((x) => !x.passive && (x.target === 'enemy' || x.target === 'point'));
    if (!targeted.length) return '';
    return `<h4>Cast at it</h4><div class="spell-list">${targeted.map((x) => {
      const why = ctx.magicBlocked(x) ?? (d > x.range ? `Out of reach (reach ${x.range} squares)` : null);
      return `<button class="spell-btn ${x.kind} ${why ? 'off' : ''}" data-dg="cast" data-id="${x.id}" title="${esc(`${x.desc} ${why ? `(${why})` : ''}`)}"><b>${esc(x.name)}</b><span class="muted">${x.kind === 'spell' ? (x.level ? ctx.ordinal(x.level) : 'cantrip') : `${s.res.uses[x.id] ?? ''}`} · ${x.range * 5} ft</span></button>`;
    }).join('')}</div>`;
  })()}
      ${!combat ? `<p class="small muted">${m.aware ? 'Attacks are made on your turn in combat.' : m.calm ? 'Attacking it breaks the truce.' : 'It has not noticed you: attacking now gets advantage and catches it by surprise.'}</p>` : !ctx.canAttack() ? '<p class="small muted">You have used your action this turn.</p>' : '<p class="small muted">Tip: Shift+click a foe to attack it at once with your best weapon.</p>'}
      ${talkSection(m)}
      ${wrestleSection(m)}
      <h4>Study it <span class="muted small">DC ${studyDC(stat)}${combat ? ' · uses your action' : ''}</span></h4>
      <div class="studies">${studies}</div>
      ${last}
      ${revealedHtml(m, stat)}
    </div>`;
  }

  const isBehindHero = (m) => {
    const f = FACINGS[m.facing];
    return Math.sign(s.hero.pos.x - m.pos.x) * f.dx + Math.sign(s.hero.pos.y - m.pos.y) * f.dy <= -1;
  };

  function xpBar() {
    const d = s.def; if (!d) return '';
    const p = xpProgress(d.xp, d.level);
    return `<div class="hc-xp" title="${d.level >= 20 ? 'Maximum level' : `${p.needed - p.into} XP to level ${d.level + 1}`}">
      <span class="lvl">Lv ${d.level}</span><span class="bar"><span style="width:${p.fraction * 100}%"></span></span>
      <span class="small muted">${d.xp.toLocaleString()} XP</span></div>`;
  }

  /** Things within reach you can interact with: bodies, chests, locked doors, traps. */
  function nearbyThings() {
    if (!s.hero || !s.features) return [];
    const list = [];
    if (ctx.onExit()) list.push(ctx.place ? { kind: 'stairs', id: 'down', label: 'Leave for the world map', glyph: '🗺' } : { kind: 'stairs', id: 'down', label: `Take the stairs down to depth ${s.depth + 1}`, glyph: '⬇' });
    for (const m of s.monsters) if (m.dead && m.loot && (m.loot.coins || m.loot.items.length) && cellsOf(m.pos, m.size ?? 1).some((c) => ctx.adjacent(c))) list.push({ kind: 'corpse', id: m.id, label: `Search the ${m.name.toLowerCase()}'s body`, glyph: '💰' });
    for (const c of s.features.chests) if (ctx.adjacent(c) && !(c.opened && !c.loot?.coins && !c.loot?.items.length)) list.push({ kind: 'chest', id: c.id, label: c.locked ? 'Locked chest' : c.opened ? 'Open chest' : 'Chest', glyph: c.locked ? '🔒' : '🧰' });
    for (const f of [s.features.totem, s.features.camp].filter(Boolean)) if (!f.used && ctx.adjacent(f)) list.push({ kind: f === s.features.totem ? 'totem' : 'camp', id: f === s.features.totem ? 'totem' : 'camp', label: f === s.features.totem ? 'Mana totem' : 'Sleep by the fire', glyph: f === s.features.totem ? '💎' : '🔥' });
    for (const [k] of s.features.locks) { const [x, y] = k.split(',').map(Number); if (ctx.adjacent({ x, y }) && s.revealed.has(k)) list.push({ kind: 'door', id: k, label: 'Locked door', glyph: '🔒' }); }
    for (const t of s.features.traps) if (t.found && !t.disarmed && !t.sprung && chebyshev(t, s.hero.pos) <= 1) list.push({ kind: 'trap', id: t.id, label: `${t.name[0].toUpperCase()}${t.name.slice(1)}`, glyph: '⚠' });
    return list;
  }

  function drawNearby() {
    const list = nearbyThings();
    morphInto($('.dg-nearby'), list.length ? `<h3>Within reach</h3><div class="nearby">${list.map((t) => `<button class="btn small ${s.target?.kind === t.kind && s.target.id === t.id ? 'primary' : ''}" data-dg="pick-target" data-kind="${t.kind}" data-id="${esc(t.id)}">${t.glyph} ${esc(t.label)}</button>`).join('')}</div>` : '');
  }

  /** Panel for a chest, locked door, trap or body. */
  function interactPanel(t) {
    if (t.kind === 'creature') {
      const m = s.monsters.find((x) => x.id === t.id && !x.dead);
      if (!m) return '';
      return m.side === 'npc' ? npcPanel(m) : m.side === 'captive' ? captivePanel(m) : m.side === 'ally' ? allyPanel(m) : foePanel(m);
    }
    const close = '<button class="btn icon small" data-dg="close-loot" aria-label="Close">✕</button>';
    const near = (p) => chebyshev(s.hero.pos, p) <= 1;
    const nearBody = (m) => cellsOf(m.pos, m.size ?? 1).some((c) => near(c));
    const combatNote = s.mode === 'combat' ? ' · uses your action' : '';
    const tools = ctx.hasTools();
    const lockButtons = (lock, kind = 'chest') => { const fdc = forceDc(lock, kind); const athl = s.hero.skills.athletics ?? 0; const wood = kind === 'door' && lock.material !== 'iron'; return `
      <div class="studies">
        <button class="study" data-dg="pick-lock" ${tools ? '' : 'disabled'}><b>Pick the lock</b> <span class="muted">DEX ${signed(s.def.toolBonus)} vs DC ${lock.dc} · ${Math.round(checkChance(s.def.toolBonus, lock.dc) * 100)}%</span><span>${tools ? `Thieves' tools (${tools.charges ?? '∞'} picks)${combatNote}` : 'Needs thieves\' tools'}</span></button>
        <button class="study" data-dg="force-lock"><b>Force it open</b> <span class="muted">Athletics ${signed(athl)} vs DC ${fdc} · ${Math.round(checkChance(athl, fdc) * 100)}%${findItem(s.draft.inventory, 'crowbar') ? ' · crowbar: advantage' : ''}</span><span>${wood ? 'It will give way: succeed to open it quietly, fail and it crashes open (foes within 10 squares hear)' : `Fail and foes within 10 squares hear the clang${kind === 'door' ? '. Iron: almost impossible' : ''}`}${combatNote}</span></button>
      </div>`; };
    if (t.kind === 'totem' || t.kind === 'camp') {
      const f = t.kind === 'totem' ? s.features.totem : s.features.camp; if (!f) return '';
      const casters = s.members.filter((m) => m.res?.maxMana);
      const missing = casters.reduce((n, m) => n + (m.res.maxMana - m.res.mana), 0);
      const title = t.kind === 'totem' ? '💎 Mana totem' : '🔥 The camp fire';
      const text = t.kind === 'totem'
        ? (f.used ? 'Its crystals are dark and cold: its power is spent for now.' : 'An old stone pillar crowned with blue crystals, humming softly. Touch it, and spent mana and abilities flow back to every hero. It answers once.')
        : (f.used ? 'You have slept here already. Move on.' : 'A ring of stones, warm embers and two bedrolls. Sleep here and mana and abilities come back, but not hit points: only potions and healing spells mend wounds. Once per visit.');
      return `<div class="loot-card"><div class="foe-head"><h3>${title}</h3>${close}</div><p class="small">${text}</p>
        ${casters.length ? `<div class="totem-party">${casters.map((m) => `<p class="small"><b>${esc(m.hero.name.split(' ')[0])}</b> ${manaHtml(m.res.mana, m.res.maxMana, { label: false })}</p>`).join('')}</div>` : ''}
        ${f.used ? '' : !near(f) ? '<p class="small muted">Walk up to it first.</p>' : s.mode === 'combat' ? '<p class="small muted">Not during a fight.</p>'
          : `<button class="btn primary" data-dg="${t.kind === 'totem' ? 'totem' : 'camp-sleep'}">${t.kind === 'totem' ? `Touch the totem${missing ? ` (+${missing} mana)` : ''}` : 'Sleep by the fire'}</button>`}</div>`;
    }
    if (t.kind === 'corpse-ask') {
      // Clicked a square with a body (or a pile of them): search, or just step there?
      const bodies = (t.ids ?? []).map((id) => s.monsters.find((x) => x.id === id)).filter(Boolean);
      if (!bodies.length) return '';
      const [x, y] = t.id.split(',').map(Number);
      const canStep = s.mode !== 'combat' || (s.reach.get(t.id)?.cost ?? 0) > 0;
      const names = bodies.length > 1 ? `${bodies.length} bodies lie here` : ctx.SPIRIT.test(bodies[0].statId ?? '') ? `What the ${bodies[0].name.toLowerCase()} left behind` : `${bodies[0].name}'s body`;
      return `<div class="loot-card corpse-ask"><div class="foe-head"><h3>☠ ${esc(names)}</h3>${close}</div>
        ${bodies.length > 1 ? `<p class="small muted">${esc(bodies.map((b) => b.name).join(', '))}, one over the other.</p>` : ''}
        <div class="ask-row">
          <button class="btn primary" data-dg="corpse-search">🔍 Search ${bodies.length > 1 ? 'the bodies' : 'the body'}</button>
          <button class="btn" data-dg="corpse-move" ${canStep ? '' : 'disabled'}>👣 Just move here</button>
        </div></div>`;
    }
    if (t.kind === 'fallen-hero') {
      const h = s.members.map((m) => m.hero).find((x) => x?.id === t.id && x.hp <= 0);
      if (!h) return '';
      return `<div class="loot-card"><div class="foe-head"><h3>☠ ${esc(h.name)} is down</h3>${close}</div>
        <p class="small">${esc(h.name.split(' ')[0])} has fallen and cannot act. A healing spell or a potion brings them back; if the party wins the fight, they come round with 1 hit point.</p></div>`;
    }
    if (t.kind === 'corpses') {
      // A pile of bodies, searched together: everything they carried in one list.
      const bodies = (t.ids ?? []).map((id) => s.monsters.find((x) => x.id === id)).filter(Boolean);
      if (!bodies.length) return '';
      if (!bodies.some((b) => nearBody(b))) return `<div class="loot-card"><div class="foe-head"><h3>Corpses</h3>${close}</div><p class="small muted">Move next to them to search them.</p></div>`;
      for (const b of bodies) b.searched = true;
      const coins = bodies.reduce((n, b) => n + (b.loot?.coins ?? 0), 0);
      const items = bodies.flatMap((b) => (b.loot?.items ?? []).map((it) => ({ ...it, from: b.name })));
      return lootHtml({ bag: bagState(),  title: `Corpses (${bodies.length})`, coins, items, note: bodies.map((b) => b.name).join(' · ') });
    }
    if (t.kind === 'corpse') {
      const m = s.monsters.find((x) => x.id === t.id);
      if (!m) return '';
      if (nearBody(m)) m.searched = true;
      const what = ctx.SPIRIT.test(m.statId ?? '') ? `What the ${m.name.toLowerCase()} left behind` : `${m.name}'s body`;
      if (!nearBody(m)) return `<div class="loot-card"><div class="foe-head"><h3>${esc(what)}</h3>${close}</div><p class="small muted">${s.mode === 'combat' ? 'Too far to reach this turn. Move next to it to search it.' : 'Move next to it to search it.'}</p></div>`;
      const loot = m.loot ?? { coins: 0, items: [] };
      if (!loot.coins && !loot.items.length) return `<div class="loot-card"><div class="foe-head"><h3>${esc(what)}</h3>${close}</div><p class="small muted">You search ${m.side ? 'your fallen friend' : 'it'} carefully. Nothing of value${m.side ? ' — only a last goodbye' : ''}.</p></div>`;
      return lootHtml({ bag: bagState(),  title: what, coins: loot.coins, items: loot.items });
    }
    if (t.kind === 'chest') {
      const c = s.features.chests.find((x) => x.id === t.id);
      if (!c) return '';
      if (!near(c)) return `<div class="loot-card"><div class="foe-head"><h3>Chest</h3>${close}</div><p class="small muted">Move next to the chest to open it.</p></div>`;
      if (c.locked) return `<div class="loot-card"><div class="foe-head"><h3>🔒 Locked chest</h3>${close}</div><p class="small">A heavy iron-bound chest with a stout lock.</p>${lockButtons(c)}</div>`;
      if (!c.opened) return `<div class="loot-card"><div class="foe-head"><h3>Chest</h3>${close}</div><button class="btn small primary" data-dg="open-chest">Open it</button></div>`;
      return lootHtml({ bag: bagState(),  title: 'Chest', coins: c.loot.coins, items: c.loot.items });
    }
    if (t.kind === 'door') {
      const lock = s.features.locks.get(t.id);
      if (!lock) return '';
      const [x, y] = t.id.split(',').map(Number);
      if (!near({ x, y })) return `<div class="loot-card"><div class="foe-head"><h3>🔒 Locked door</h3>${close}</div><p class="small muted">Move next to the door to work on its lock.</p></div>`;
      return `<div class="loot-card"><div class="foe-head"><h3>🔒 Locked ${lock.material === 'iron' ? 'iron door' : 'door'}</h3>${close}</div><p class="small">${lock.material === 'iron' ? `A door of solid iron, riveted and cold. Forcing it would take a giant's strength.${lock.key ? ' Its key must be somewhere in this dungeon.' : ''}` : 'An old oak door with a rusty lock. A good shoulder would break it, but not quietly.'}</p>
        ${ctx.keyFor?.(t.id) ? `<div class="studies"><button class="study key" data-dg="use-key"><b>🗝 Use the iron key</b><span class="muted">It fits. Opens quietly; the key stays in the lock.</span><span>${s.mode === 'combat' ? 'Uses your action' : 'Silent'}</span></button></div>` : ''}
        ${lockButtons(lock, 'door')}</div>`;
    }
    if (t.kind === 'trap') {
      const tr = s.features.traps.find((x) => x.id === t.id);
      if (!tr) return '';
      const state = tr.disarmed ? 'Disarmed: safe to cross.' : tr.sprung ? 'Already sprung.' : 'Armed. Your path will go around it.';
      return `<div class="loot-card"><div class="foe-head"><h3>⚠ ${esc(tr.name[0].toUpperCase() + tr.name.slice(1))}</h3>${close}</div>
        <p class="small">${state} Deals ${esc(tr.damage)} ${esc(tr.type)} (DEX save DC ${tr.saveDc} for half).</p>
        ${!tr.disarmed && !tr.sprung ? (near(tr) ? `<div class="studies"><button class="study" data-dg="disarm" ${tools ? '' : 'disabled'}><b>Disarm it</b> <span class="muted">DEX ${signed(s.def.toolBonus)} vs DC ${tr.dc} · ${Math.round(checkChance(s.def.toolBonus, tr.dc) * 100)}%</span><span>${tools ? `Fail by 5 or more and it goes off!${combatNote}` : 'Needs thieves\' tools'}</span></button></div>` : '<p class="small muted">Move next to it to try disarming it.</p>') : ''}</div>`;
    }
    return '';
  }

  /** The in-game settings menu: how creatures are drawn (and the grid). */
  function toggleSettings(open = $('.dg-settings').hidden) {
    const box = $('.dg-settings');
    box.hidden = !open;
    host.querySelector('[data-dg="settings"]').setAttribute('aria-expanded', String(open));
    if (!open) return;
    box.innerHTML = `<div class="dg-settings-card">
      <div class="foe-head"><h3>Settings</h3><button class="btn icon small" data-dg="close-settings" aria-label="Close settings">✕</button></div>
      ${settingsControls('data-dg="setting"', undefined, 'game')}
      <p class="small muted">Also set on the start screen. Creatures without a body yet keep their token.</p>
    </div>`;
  }

  /** Bodies, chests, doors and traps open as a pop-up in the middle of the screen. */
  /** The active hero's bag, for loot pop-ups (engine/items.js limits). */
  function bagState() {
    const str = s.def?.str ?? 10;
    return { used: bagUsed(s.draft), slots: BAG_SLOTS, load: carriedWeight(s.draft.inventory, s.draft.coins ?? 0), max: loadLimits(str).max };
  }

  function drawPop() {
    const box = $('.dg-pop');
    const html = s.target ? interactPanel(s.target) : '';
    if (s.target && !html) s.target = null;
    box.hidden = !html;
    if (!html) box.innerHTML = '';
    if (html) box.innerHTML = `<div class="dg-pop-card">${html}<p class="small muted pop-hint">Esc or click outside to close.</p></div>`;
  }

  /** Party roster: who is in the group, their health; while exploring, click to choose the leader. */
  function partyBar() {
    if (s.members.length < 2) return '';
    return `<div class="party-bar">${s.members.map((m, i) => {
      const h = m.hero; const me = h === s.hero;
      return `<button class="party-member ${me ? 'me' : ''} ${h.hp <= 0 ? 'down' : ''}" data-dg="pick-hero" data-i="${i}" ${s.mode === 'combat' || s.busy ? 'disabled' : ''} title="${esc(h.name)}${s.mode === 'combat' ? '' : ': click to lead the party'}">
        <img src="${esc(h.look?.url ?? '')}" alt="" style="filter:${h.look?.filter ?? 'none'};border-color:${h.look?.frameColor ?? '#c9a227'}">
        <span><b>${esc(h.name.split(' ')[0])}</b><span class="mini-hp"><span style="width:${Math.max(0, h.hp / h.maxHp) * 100}%"></span></span><small>${h.hp}/${h.maxHp}</small></span></button>`;
    }).join('')}</div>`;
  }

  function drawInventory() {
    const box = $('.dg-inv');
    box.hidden = !s.invOpen;
    if (!s.invOpen || !s.draft) return;
    box.innerHTML = `<div class="dg-inv-card">
      <button class="btn icon small dg-inv-close" data-inv="close" aria-label="Close inventory">✕</button>
      ${inventoryHtml(s.draft, { str: s.def.str, selected: s.invSel, filter: s.invFilter, doll: s.invDoll, combat: s.mode === 'combat', title: `${s.hero.name}'s pack` })}
      ${s.def.gearNotes?.length ? `<ul class="gear-notes small">${s.def.gearNotes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}
    </div>`;
  }

  function drawTargetInfo() {
    const box = $('.dg-target');
    const sel = s.selectedId && s.monsters.find((m) => m.id === s.selectedId && !m.dead && ctx.canSee(m));
    if (sel && s.target?.kind !== 'creature') { box.innerHTML = sel.side ? (sel.side === 'npc' ? npcPanel(sel) : sel.side === 'ally' ? allyPanel(sel) : captivePanel(sel)) : foePanel(sel); return; }
    if (sel) { box.innerHTML = `<p class="small muted">${esc(sel.name)}: choose what to do in the pop-up.</p>`; return; }

    const hov = s.hover;
    if (!hov || !s.hero) { box.innerHTML = '<p class="muted small">Click a creature to attack it, talk to it, shove it or study it (Shift+click attacks at once). Click chests, locked doors, traps and bodies next to you. Hover to check distances.</p>'; return; }
    const foe = ctx.alive().find((m) => covers(m, hov) && ctx.canSee(m));
    const fallen = !foe && s.monsters.find((m) => m.dead && covers(m, hov));
    if (fallen) {
      box.innerHTML = `<div class="foe-mini">${ctx.portraitOf(fallen) ? `<img src="${esc(ctx.portraitOf(fallen))}" alt="" style="filter:grayscale(.6)">` : ''}<div><h3>☠ ${esc(fallen.name)}</h3>
        <p class="small">${fallen.side === 'ally' ? 'Your fallen friend' : 'Slain'} · ${ctx.edist(s.hero, fallen)} squares away</p><p class="small muted">Click to search the body.</p></div></div>`;
      return;
    }
    if (foe && foe.side) {
      box.innerHTML = `<div class="foe-mini">${ctx.portraitOf(foe) ? `<img src="${esc(ctx.portraitOf(foe))}" alt="">` : ''}<div><h3>${esc(foe.name)}</h3>
        <p class="small">${foe.side === 'npc' ? 'Click to talk' : foe.side === 'ally' ? `Ally · ${foe.hp}/${foe.maxHp} HP` : 'A prisoner, in chains'} · ${ctx.edist(s.hero, foe)} squares away</p><p class="small muted">Click for orders${foe.side === 'captive' ? ' or to free her' : ''}.</p></div></div>`;
      return;
    }
    if (foe) {
      const plan = ctx.heroAttackPlan(foe);
      box.innerHTML = `<div class="foe-mini">${monsterPortrait(foe.statId) ? `<img src="${esc(monsterPortrait(foe.statId))}" alt="">` : ''}<div><h3>${esc(foe.name)}</h3>
        <p class="small">${woundState(foe.hp, foe.maxHp)} · ${ctx.edist(s.hero, foe)} squares away</p>
        ${plan ? `<p class="hit"><b>${pct(plan.opts.chance)}</b> to hit with ${esc(plan.weapon.name)}</p>` : `<p class="small">${esc(ctx.whyNot(foe))}</p>`}
        <p class="small muted">Click for everything you can do: attack, talk, shove, study, cast.</p></div></div>`;
      return;
    }
    const room = roomAt(s.map, hov.x, hov.y);
    const knownSq = s.revealAll || s.revealed.has(cellKey(hov.x, hov.y));
    const c = s.reach.get(cellKey(hov.x, hov.y));
    box.innerHTML = knownSq ? `<p class="small"><b>Square ${hov.x}, ${hov.y}</b>${room ? ` · ${esc(room.name)}` : ''}${s.visible.has(cellKey(hov.x, hov.y)) ? ' · in sight' : ' · remembered'}</p>
      ${c && c.cost > 0 ? `<p class="small">${c.cost} square${c.cost === 1 ? '' : 's'} away (${mtr(c.cost * s.map.feetPerCell)}). Click to move.${c.risky ? ' <b>The only way crosses a known trap: you will need an Acrobatics check.</b>' : ''}</p>` : ''}
      ${c && c.cost === 0 ? `<p class="small">${esc(s.hero.name)} stands here, facing ${FACINGS[s.hero.facing].name}.</p>` : ''}` : '<p class="small muted">Unexplored darkness.</p>';
  }

  return { drawPanel, magicPanel, actionBar, LORE_SKILL, SKILL_LABEL, STUDIES, studyDC, known, study, revealedHtml, talkContext, talkMath, talkSection, talkTo, wrestleSection, wrestleChance, wrestle, pushAway, freeCreature, captivePanel, allyPanel, foePanel, isBehindHero, xpBar, nearbyThings, drawNearby, interactPanel, toggleSettings, drawPop, partyBar, drawInventory, drawTargetInfo };
}
