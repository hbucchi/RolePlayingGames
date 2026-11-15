/**
 * Strike marks: a subtle trace of each blow, drawn over the target for about a quarter of a
 * second on the map's effects layer (.dg-fx, so redraws don't cut it short), animated with the
 * Web Animations API. Each kind of weapon leaves its own mark:
 *
 *   slash   swords, scimitars, glaives: a silver crescent swept across the target
 *   chop    axes: one heavy diagonal stroke with a short shudder
 *   thrust  daggers, rapiers, spears, tridents: a streak driven along the line of attack
 *   smash   maces, hammers, clubs, fists, slams, tails: an impact star and a ring
 *   claws   claws and talons: three thin parallel rakes
 *   bite    bites, fangs, beaks: two arcs snapping shut
 *   shot    arrows, bolts, sling stones (the projectile already flew): a small impact star
 *
 * A blocked blow throws a few sparks where it met the shield or blade; a miss leaves a faint
 * whiff to one side. Players who ask for reduced motion get nothing.
 */
const NS = 'http://www.w3.org/2000/svg';

/** Which mark a weapon leaves (see above). `weapon` is an attack: { name, type, ranged?, melee? }. */
export function strikeKind(weapon, ranged = false) {
  const n = (weapon?.name ?? '').toLowerCase();
  if (ranged && !weapon?.melee) return 'shot';
  if (/claw|talon|rake/.test(n)) return 'claws';
  if (/bite|fang|jaws|beak|maw|sting/.test(n)) return 'bite';
  if (/axe|cleaver|halberd/.test(n)) return 'chop';
  if (weapon?.type === 'piercing' || /dagger|rapier|spear|trident|pike|lance|horn|tusk/.test(n)) return 'thrust';
  if (weapon?.type === 'bludgeoning' || /mace|hammer|club|maul|staff|fist|slam|tail|unarmed|flail/.test(n)) return 'smash';
  return 'slash';
}

const el = (tag, attrs) => { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; };

/**
 * Draw one mark. `at` and `from` are centres in squares; `span` is the target's size in squares;
 * `result` is 'hit', 'blocked' or 'miss'.
 */
export function drawStrike(fx, { kind, at, from, sz, span = 1, result = 'hit', crit = false }) {
  if (!fx || matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
  const r = sz * 0.42 * Math.max(1, Math.min(span, 3));
  const ang = Math.atan2(at.y - from.y, at.x - from.x) * 180 / Math.PI;
  const off = result === 'miss' ? r * 0.75 : 0; // a whiff passes beside the target
  const g = el('g', { class: `dg-strike ${kind} ${result}${crit ? ' crit' : ''}`, transform: `translate(${(at.x + 0.5) * sz} ${(at.y + 0.5) * sz}) rotate(${ang}) translate(0 ${off})` });
  const stroke = (d, w = 4) => el('path', { d, class: 'st-line', 'stroke-width': w, pathLength: 100, 'stroke-dasharray': 100, 'stroke-dashoffset': 100 });
  const parts = [];
  if (result === 'blocked') {
    for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; parts.push(stroke(`M ${-r * 0.55} 0 l ${Math.cos(a) * r * 0.32} ${Math.sin(a) * r * 0.32}`, 2.5)); }
    parts.forEach((p) => p.classList.add('spark'));
  } else if (kind === 'slash') parts.push(stroke(`M ${-r * 0.25} ${-r} Q ${r * 0.75} 0 ${-r * 0.25} ${r}`, crit ? 7 : 5));
  else if (kind === 'chop') parts.push(stroke(`M ${-r * 0.7} ${-r * 0.8} L ${r * 0.6} ${r * 0.75}`, crit ? 8 : 6));
  else if (kind === 'thrust') parts.push(stroke(`M ${-r * 1.3} 0 L ${r * 0.45} 0`, crit ? 6 : 4), el('path', { d: `M ${r * 0.45} 0 l ${-r * 0.22} ${-r * 0.1} l 0 ${r * 0.2} z`, class: 'st-tip' }));
  else if (kind === 'claws') for (const k of [-1, 0, 1]) parts.push(stroke(`M ${-r * 0.55 + k * r * 0.12} ${-r * 0.85} Q ${r * 0.25 + k * r * 0.25} ${k * r * 0.2} ${-r * 0.35 + k * r * 0.12} ${r * 0.85}`, 2.5));
  else if (kind === 'bite') parts.push(stroke(`M ${-r * 0.7} ${-r * 0.55} Q 0 ${-r * 0.05} ${r * 0.7} ${-r * 0.55}`, 3.5), stroke(`M ${-r * 0.7} ${r * 0.55} Q 0 ${r * 0.05} ${r * 0.7} ${r * 0.55}`, 3.5));
  else { // smash and shot: a ring and a star of short lines
    const k = kind === 'shot' ? 0.45 : 0.75;
    parts.push(el('circle', { r: r * 0.3 * k, class: 'st-ring' }));
    for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2 + 0.3; parts.push(stroke(`M ${Math.cos(a) * r * 0.32 * k} ${Math.sin(a) * r * 0.32 * k} L ${Math.cos(a) * r * 0.75 * k} ${Math.sin(a) * r * 0.75 * k}`, 3)); }
  }
  parts.forEach((p) => g.append(p));
  fx.append(g);
  const ms = kind === 'chop' || kind === 'smash' ? 300 : 260;
  for (const p of g.querySelectorAll('.st-line')) p.animate([{ strokeDashoffset: 100 }, { strokeDashoffset: 0, offset: 0.45 }, { strokeDashoffset: 0 }], { duration: ms, easing: 'ease-out', fill: 'forwards' });
  for (const p of g.querySelectorAll('.st-ring')) p.animate([{ transform: 'scale(.4)', opacity: 0.9 }, { transform: 'scale(2.2)', opacity: 0 }], { duration: ms, easing: 'ease-out', fill: 'forwards' });
  const fade = g.animate([{ opacity: result === 'miss' ? 0.45 : 1 }, { opacity: result === 'miss' ? 0.45 : 1, offset: 0.5 }, { opacity: 0 }], { duration: ms + 140, fill: 'forwards' });
  fade.onfinish = () => g.remove();
  setTimeout(() => g.remove(), ms + 600); // in case the animation never runs (hidden tab)
}

/**
 * The sound of a blow landing, by mark: the same steel ring played faster for a sharp thrust or
 * slower for a heavy chop, smash or bite (playback rate changes the pitch). { key, rate }.
 */
export function hitSound(kind) {
  if (kind === 'shot') return { key: 'arrow-hit', rate: 1 };
  return { key: 'sword-hit', rate: { thrust: 1.25, slash: 1, claws: 1.1, chop: 0.8, smash: 0.65, bite: 0.75 }[kind] ?? 1 };
}
