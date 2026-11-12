/**
 * The Characters window: open it at any time in a delve (button or C). One tab per hero; for each,
 * a Summary (who they are, how they stand, what they can do) and a Body view (each part, what is
 * worn over it and its state; the groundwork for local injuries).
 */
import { manaHtml } from '../mana-view.js';
import { absorbed } from '../../engine/defence.js';
import { bodyReport, BODY_PARTS, BODY_BY_ID } from '../../engine/body.js';
import { conditionLabels } from '../../engine/combat.js';
import { XP_FOR_LEVEL } from '../../engine/progression.js';

const ABILITY_NAMES = { str: 'Strength', dex: 'Dexterity', con: 'Constitution', int: 'Intelligence', wis: 'Wisdom', cha: 'Charisma' };
const signed = (n) => (n >= 0 ? `+${n}` : `−${Math.abs(n)}`);

export function installCharacters(ctx) {
  const { s, esc } = ctx;

  function summaryHtml(m) {
    const d = m.def?.sheet ?? m.def; const h = m.hero;
    if (!d || !h) return '<p class="muted">No hero here.</p>';
    const next = XP_FOR_LEVEL[d.level + 1];
    const conds = conditionLabels(h);
    const skills = (Array.isArray(d.skills) ? d.skills : []).filter((k) => k.proficient).sort((a, b) => b.bonus - a.bonus);
    return `<div class="ch-summary">
      <div class="ch-head">
        <img src="${esc(h.look?.url ?? '')}" alt="" style="filter:${h.look?.filter ?? 'none'};border-color:${h.look?.frameColor ?? '#c9a227'}">
        <div><h3>${esc(d.name)}</h3>
          <p class="small">Level ${d.level} ${esc(d.race?.name ?? '')} ${esc(d.cls?.name ?? '')}${d.background ? ` · ${esc(d.background.name)}` : ''}</p>
          ${d.concept ? `<p class="small muted"><i>${esc(d.concept)}</i></p>` : ''}
          <p class="small">${h.hp <= 0 ? '<b class="bad">Down</b>' : conds.length ? `<b>${esc(conds.join(', '))}</b>` : 'Ready'}</p>
        </div>
      </div>
      <div class="ch-stats">
        <div><b>${Math.max(0, h.hp)}/${h.maxHp}</b><span>Hit points</span><span class="mini-hp"><span style="width:${Math.max(0, h.hp / h.maxHp) * 100}%"></span></span></div>
        <div><b>${h.ac}</b><span>Evasion</span></div>
        <div><b>${h.defence?.block ?? 0}%</b><span>Block (${h.defence?.blockWith ?? 'none'})</span></div>
        <div><b>${h.speed}</b><span>Squares per move</span></div>
        <div><b>${signed(d.initiative ?? h.dexMod ?? 0)}</b><span>Initiative</span></div>
        <div><b>${d.passivePerception ?? '—'}</b><span>Passive Perception</span></div>
        <div><b>${d.xp}${next ? `/${next}` : ''}</b><span>Experience</span></div>
      </div>
      ${m.res?.maxMana ? `<h4>Mana</h4><p>${manaHtml(m.res.mana, m.res.maxMana)}</p>` : ''}
      <h4>Abilities</h4>
      <div class="ch-abilities">${Object.keys(ABILITY_NAMES).map((k) => {
        const sv = d.savingThrows?.find((x) => x.ability === k) ?? { bonus: d.mods?.[k] ?? 0 };
        return `<div title="${ABILITY_NAMES[k]}: score ${d.scores[k]}, modifier ${signed(d.mods[k])}; saving throw ${signed(sv.bonus)}${sv.proficient ? ' (proficient)' : ''}">
          <span>${k.toUpperCase()}</span><b>${d.scores[k]}</b><small>${signed(d.mods[k])} · save ${signed(sv.bonus)}${sv.proficient ? '●' : ''}</small></div>`;
      }).join('')}</div>
      <h4>Trained skills</h4>
      <p class="small">${skills.map((k) => `${esc(k.name)} <b>${signed(k.bonus)}</b>`).join(' · ') || '<span class="muted">None</span>'}</p>
      <h4>Weapons</h4>
      <ul class="plain small">${h.weapons.map((w) => `<li><b>${esc(w.name)}</b> ${signed(w.toHit)} to hit · ${esc(w.damage)} ${esc(w.type)} · ${w.ranged ? `reach ${w.long}` : 'melee'}</li>`).join('')}</ul>
      ${d.magic?.spells?.length ? `<h4>Spells</h4><p class="small">${d.magic.spells.map((x) => esc(x.name)).join(' · ')}</p>` : ''}
      ${d.gearNotes?.length ? `<p class="small muted">${d.gearNotes.map(esc).join(' ')}</p>` : ''}
    </div>`;
  }

  function bodyHtml(m) {
    const armour = m.hero?.defence?.armour ?? null;
    const coverAt = (part) => armour?.cover?.[part] ?? 0;
    const armourAt = (part) => (coverAt(part) ? armour.pct : 0);
    const rep = bodyReport(m.draft ?? { inventory: [], equipped: {} }, m.hero?.injuries ?? {});
    const sel = rep[s.charPart] ?? rep.chest;
    const dots = BODY_PARTS.map((p) => {
      const r = rep[p.id];
      return `<button class="bp-dot ${r.injuries.length ? 'hurt' : ''} ${sel.id === p.id ? 'sel' : ''} ${r.worn.length ? 'covered' : ''}" data-dg="char-part" data-part="${p.id}"
        style="left:${p.x * 100}%;top:${p.y * 100}%" title="${esc(`${p.name}: ${r.state}${r.worn.length ? ` · ${r.worn.map((w) => w.label).join(', ')}` : ''}`)}"><span>${esc(p.name)}</span></button>`;
    }).join('');
    return `<div class="ch-body">
      <div class="bp-figure"><img src="assets/ui/body-figure.jpg" alt="The body, seen from the front">${dots}</div>
      <div class="bp-detail">
        <h4>${esc(sel.name)}</h4>
        <p class="small"><b>${esc(sel.state)}</b></p>
        <p class="small muted">A blow that lands strikes here ${sel.weight}% of the time.</p>
        <p class="small">On the d100 this part is <b>${BODY_BY_ID[sel.id].from}–${BODY_BY_ID[sel.id].to}</b>.</p>
        <p class="small">${coverAt(sel.id)
    ? `<b>${esc(armour.name)}</b> covers <b>${BODY_BY_ID[sel.id].from}–${BODY_BY_ID[sel.id].from + coverAt(sel.id) - 1}</b> (${coverAt(sel.id)} of ${sel.weight} points) and absorbs <b>${armour.pct}%</b>${armour.condition < 100 ? ` (condition ${armour.condition}%)` : ''}: a 10-point blow there does ${absorbed(10, armour.pct)}.${coverAt(sel.id) < sel.weight ? ` Rolls ${BODY_BY_ID[sel.id].from + coverAt(sel.id)}–${BODY_BY_ID[sel.id].to} find a gap.` : ''}`
    : '<b>Bare</b>: nothing between this and a blade.'}</p>
        <h5>Worn here</h5>
        ${sel.worn.length ? `<ul class="plain small">${sel.worn.map((w) => `<li>${w.kind === 'armour' ? '🛡' : w.kind === 'shield' ? '⛉' : w.kind === 'jewel' ? '💍' : w.kind === 'cloak' ? '🧥' : '✋'} ${esc(w.label)}</li>`).join('')}</ul>` : '<p class="small muted">Nothing: this part is bare.</p>'}
        <table class="bp-table small"><tbody>${BODY_PARTS.map((p) => `<tr class="${sel.id === p.id ? 'sel' : ''}"><td><button class="linkish" data-dg="char-part" data-part="${p.id}">${esc(p.name)}</button></td><td>${esc(rep[p.id].state)}</td><td class="muted">${p.from}–${p.to}</td><td>${coverAt(p.id) ? `<b>${coverAt(p.id)}/${p.weight}</b> · ${armour.pct}%` : '—'}</td><td class="muted">${rep[p.id].worn.length ? esc(rep[p.id].worn.map((w) => w.label.replace(/ \(.*\)$/, '')).join(', ')) : 'bare'}</td></tr>`).join('')}</tbody></table>
      </div>
    </div>`;
  }

  /** Draw (or hide) the Characters window. */
  function drawCharacters() {
    const box = ctx.$('.dg-chars'); if (!box) return;
    box.hidden = !s.charsOpen;
    if (!s.charsOpen) { box.innerHTML = ''; return; }
    const i = Math.min(s.charIdx ?? 0, s.members.length - 1);
    const m = s.members[i];
    const tab = s.charTab ?? 'summary';
    box.innerHTML = `<div class="dg-chars-card">
      <div class="foe-head"><h3>Characters</h3><button class="btn icon small" data-dg="chars-close" aria-label="Close">✕</button></div>
      <div class="ch-heroes" role="tablist">${s.members.map((x, k) => `<button class="chip ${k === i ? 'sel' : ''}" data-dg="char-hero" data-i="${k}" aria-pressed="${k === i}">${esc(x.hero?.name?.split(' ')[0] ?? '?')}${x.hero?.hp <= 0 ? ' ☠' : ''}</button>`).join('')}</div>
      <div class="ch-tabs" role="tablist">
        <button class="chip ${tab === 'summary' ? 'sel' : ''}" data-dg="char-tab" data-tab="summary" aria-pressed="${tab === 'summary'}">📜 Summary</button>
        <button class="chip ${tab === 'body' ? 'sel' : ''}" data-dg="char-tab" data-tab="body" aria-pressed="${tab === 'body'}">🫀 Body</button>
      </div>
      ${tab === 'body' ? bodyHtml(m) : summaryHtml(m)}
    </div>`;
  }

  return { drawCharacters };
}
