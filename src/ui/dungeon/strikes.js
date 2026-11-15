/**
 * The weapon in the blow: for a moment the attacker's own weapon appears at the target and makes
 * its movement, drawn in the map's effects layer (.dg-fx, so redraws don't cut it short):
 *
 *   swing   swords, scimitars, axes, glaives, whips, tails: a sweep across the target
 *   smash   maces, hammers, clubs, staves: a heavier sweep that lands with a small bounce
 *   thrust  daggers, rapiers, spears, tridents, horns, stings, fists: driven in and pulled back
 *   rake    claws, talons, pincers: three talons swiped across
 *   snap    bites, beaks, jaws: two rows of teeth snapping shut
 *
 * A blocked blow stops short, with sparks where it met shield or blade; a miss passes beside the
 * target, fainter. Arrows and bolts already fly as themselves (render.js ARROW_SVG), and touches
 * and drains have no weapon to show. The blade's colour follows its metal (silver, mithral...).
 * Players who ask for reduced motion see nothing.
 */
const NS = 'http://www.w3.org/2000/svg';

/** The sound family a blow belongs to (attacks.js hitSound): slash, chop, thrust, smash, claws, bite or shot. */
export function strikeKind(weapon, ranged = false) {
  const n = (weapon?.name ?? '').toLowerCase();
  if (ranged && !weapon?.melee) return 'shot';
  if (/claw|talon|rake|pincer/.test(n)) return 'claws';
  if (/bite|fang|jaws|beak|maw|sting/.test(n)) return 'bite';
  if (/axe|cleaver|halberd|pick/.test(n)) return 'chop';
  if (weapon?.type === 'piercing' || /dagger|rapier|spear|trident|pike|lance|horn|tusk/.test(n)) return 'thrust';
  if (weapon?.type === 'bludgeoning' || /mace|hammer|club|maul|staff|fist|slam|tail|unarmed|flail/.test(n)) return 'smash';
  return 'slash';
}

/** Which weapon to draw for an attack (null: nothing to draw). */
export function weaponShape(weapon, ranged = false) {
  const n = (weapon?.name ?? '').toLowerCase();
  if (ranged && !weapon?.melee) return null; // the arrow, bolt or stone already flew
  if (/touch|drain|gaze|breath|spores?|engulf/.test(n) || weapon?.spell) return null;
  if (/claw|talon|rake|pincer|stabbing leg/.test(n)) return 'claw';
  if (/bite|beak|fang|jaw|maw/.test(n)) return 'jaws';
  if (/sting/.test(n)) return 'dagger';
  if (/horn|gore|tusk|antler/.test(n)) return 'horn';
  if (/tail|tentacle|pseudopod|constrict|whip|chain|lash|vine/.test(n)) return 'whip';
  if (/shield/.test(n)) return 'shield';
  if (/fist|slam|punch|grab|crush|hoof|hooves|stomp|ram\b|unarmed|beard/.test(n)) return 'fist';
  if (/greataxe|battleaxe|war pick|pick|halberd/.test(n)) return 'greataxe';
  if (/axe|cleaver/.test(n)) return 'axe';
  if (/glaive|scythe/.test(n)) return 'glaive';
  if (/trident/.test(n)) return 'trident';
  if (/spear|pike|javelin|lance/.test(n)) return 'spear';
  if (/rapier/.test(n)) return 'rapier';
  if (/dagger|knife|dart|dirk/.test(n)) return 'dagger';
  if (/scimitar|curved|sabre|saber|falchion|sickle/.test(n)) return 'curved';
  if (/shortsword|short sword/.test(n)) return 'shortsword';
  if (/warhammer|hammer|maul/.test(n)) return 'hammer';
  if (/mace|morningstar|flail/.test(n)) return 'mace';
  if (/club/.test(n)) return 'club';
  if (/staff/.test(n)) return 'staff';
  if (weapon?.type === 'bludgeoning') return 'mace';
  if (weapon?.type === 'piercing') return 'spear';
  return 'sword';
}

/** How each weapon moves, and how long it is (in target radii). */
const MOVE = {
  sword: ['swing', 1.75], shortsword: ['swing', 1.35], curved: ['swing', 1.6], rapier: ['thrust', 1.7], dagger: ['thrust', 1.15],
  axe: ['swing', 1.55], greataxe: ['swing', 1.95], glaive: ['swing', 2.3], spear: ['thrust', 2.3], trident: ['thrust', 2.2],
  mace: ['smash', 1.55], hammer: ['smash', 1.7], club: ['smash', 1.6], staff: ['smash', 2.1], whip: ['swing', 1.9],
  fist: ['thrust', 0.95], horn: ['thrust', 1.1], shield: ['thrust', 0.95], claw: ['rake', 1.2], jaws: ['snap', 1.1],
};

/** Blade colours by metal: [face, edge, shine]. */
const METAL = {
  steel: ['#c4ccd5', '#47505a', '#f3f7fb'], silver: ['#e4e9ef', '#6d7783', '#ffffff'], mithral: ['#d4e2f7', '#4d6a93', '#ffffff'],
  adamantine: ['#7f8c86', '#2c3532', '#c9d6cf'], bronze: ['#c08a46', '#5e3d17', '#f0c890'], iron: ['#9aa1a8', '#3b4046', '#d9dde1'],
  gold: ['#e0b64a', '#6e5212', '#fff0b8'],
};

/**
 * A weapon drawn pointing up (toward −y), its hand-hold at 0,0, `L` long. Natural weapons
 * (claws, jaws, horns, fists) are drawn the same way, in bone and leathery tones.
 */
function weaponSvg(shape, L, metal = 'steel') {
  const [face, edge, shine] = METAL[metal] ?? METAL.steel;
  const wood = '#6e4524'; const woodHi = '#9a6a3c'; const gold = '#b8903e';
  const blade = (w, from, to, tip = 0.07) => `<path d="M ${-w} ${-from} L ${-w * 0.8} ${-to + tip * L / L} L 0 ${-to - tip} L ${w * 0.8} ${-to + tip * L / L} L ${w} ${-from} Z" fill="${face}" stroke="${edge}" stroke-width="1.2" stroke-linejoin="round"/>
    <line x1="0" y1="${-from - 2}" x2="0" y2="${-to + 2}" stroke="${shine}" stroke-width="1.1" opacity=".9"/>`;
  const grip = (len, w = L * 0.03) => `<rect x="${-w}" y="${-len}" width="${2 * w}" height="${len + w}" rx="${w}" fill="${wood}" stroke="#2e1d0f" stroke-width=".8"/>`;
  const haft = (len, w = L * 0.022) => `<rect x="${-w}" y="${-len}" width="${2 * w}" height="${len * 1.08}" rx="${w}" fill="${wood}" stroke="#2e1d0f" stroke-width=".8"/><line x1="${-w * 0.3}" y1="${-len + 3}" x2="${-w * 0.3}" y2="${len * 0.05}" stroke="${woodHi}" stroke-width=".8" opacity=".7"/>`;
  switch (shape) {
    case 'sword': case 'shortsword': return `${grip(L * 0.2)}<circle cy="${L * 0.03}" r="${L * 0.045}" fill="${gold}" stroke="#4a3510" stroke-width=".8"/>
      <rect x="${-L * 0.15}" y="${-L * 0.235}" width="${L * 0.3}" height="${L * 0.04}" rx="${L * 0.015}" fill="${gold}" stroke="#4a3510" stroke-width=".8"/>${blade(L * 0.045, L * 0.22, L * 0.94)}`;
    case 'curved': return `${grip(L * 0.2)}<rect x="${-L * 0.12}" y="${-L * 0.235}" width="${L * 0.24}" height="${L * 0.035}" rx="${L * 0.015}" fill="${gold}" stroke="#4a3510" stroke-width=".8"/>
      <path d="M ${-L * 0.04} ${-L * 0.22} Q ${-L * 0.06} ${-L * 0.7} ${L * 0.16} ${-L * 1.0} Q ${L * 0.1} ${-L * 0.62} ${L * 0.045} ${-L * 0.22} Z" fill="${face}" stroke="${edge}" stroke-width="1.2"/>`;
    case 'rapier': return `${grip(L * 0.17, L * 0.022)}<path d="M ${-L * 0.09} ${-L * 0.17} Q 0 ${-L * 0.3} ${L * 0.09} ${-L * 0.17}" fill="none" stroke="${gold}" stroke-width="${L * 0.025}"/>${blade(L * 0.018, L * 0.18, L * 0.98, 0.03)}`;
    case 'dagger': return `${grip(L * 0.3, L * 0.04)}<rect x="${-L * 0.16}" y="${-L * 0.34}" width="${L * 0.32}" height="${L * 0.06}" rx="${L * 0.02}" fill="${gold}" stroke="#4a3510" stroke-width=".8"/>${blade(L * 0.075, L * 0.32, L * 0.95, 0.1)}`;
    case 'axe': return `${haft(L)}<path d="M ${L * 0.02} ${-L * 0.95} Q ${L * 0.34} ${-L * 0.98} ${L * 0.38} ${-L * 0.72} Q ${L * 0.3} ${-L * 0.62} ${L * 0.02} ${-L * 0.68} Z" fill="${face}" stroke="${edge}" stroke-width="1.2"/>
      <path d="M ${L * 0.36} ${-L * 0.93} Q ${L * 0.42} ${-L * 0.83} ${L * 0.37} ${-L * 0.72}" fill="none" stroke="${shine}" stroke-width="1.2"/>`;
    case 'greataxe': return `${haft(L)}${[1, -1].map((k) => `<path d="M ${k * L * 0.02} ${-L * 0.97} Q ${k * L * 0.36} ${-L * 1.0} ${k * L * 0.4} ${-L * 0.73} Q ${k * L * 0.32} ${-L * 0.6} ${k * L * 0.02} ${-L * 0.67} Z" fill="${face}" stroke="${edge}" stroke-width="1.2"/>`).join('')}`;
    case 'glaive': return `${haft(L * 0.78)}<path d="M ${-L * 0.03} ${-L * 0.74} Q ${L * 0.12} ${-L * 0.86} ${L * 0.02} ${-L * 1.02} Q ${-L * 0.09} ${-L * 0.86} ${-L * 0.03} ${-L * 0.74} Z" fill="${face}" stroke="${edge}" stroke-width="1.2"/>`;
    case 'spear': return `${haft(L * 0.82)}<path d="M 0 ${-L * 1.02} L ${L * 0.05} ${-L * 0.86} L 0 ${-L * 0.79} L ${-L * 0.05} ${-L * 0.86} Z" fill="${face}" stroke="${edge}" stroke-width="1.2"/><rect x="${-L * 0.025}" y="${-L * 0.8}" width="${L * 0.05}" height="${L * 0.04}" fill="#3a2a1b"/>`;
    case 'trident': return `${haft(L * 0.8)}<path d="M ${-L * 0.1} ${-L * 0.78} L ${L * 0.1} ${-L * 0.78} M ${-L * 0.1} ${-L * 0.78} L ${-L * 0.1} ${-L * 0.95} M 0 ${-L * 0.78} L 0 ${-L * 1.02} M ${L * 0.1} ${-L * 0.78} L ${L * 0.1} ${-L * 0.95}" stroke="${edge}" stroke-width="${L * 0.03}" stroke-linecap="round" fill="none"/>`;
    case 'mace': return `${haft(L * 0.75)}<circle cy="${-L * 0.84}" r="${L * 0.1}" fill="${face}" stroke="${edge}" stroke-width="1.2"/>${[0, 60, 120, 180, 240, 300].map((a) => `<path d="M 0 ${-L * 0.84} m ${Math.sin(a * Math.PI / 180) * L * 0.08} ${-Math.cos(a * Math.PI / 180) * L * 0.08} l ${Math.sin(a * Math.PI / 180) * L * 0.07} ${-Math.cos(a * Math.PI / 180) * L * 0.07}" stroke="${edge}" stroke-width="${L * 0.035}" stroke-linecap="round"/>`).join('')}`;
    case 'hammer': return `${haft(L * 0.8)}<rect x="${-L * 0.16}" y="${-L * 0.96}" width="${L * 0.32}" height="${L * 0.15}" rx="${L * 0.02}" fill="${face}" stroke="${edge}" stroke-width="1.2"/><line x1="${-L * 0.14}" y1="${-L * 0.93}" x2="${L * 0.14}" y2="${-L * 0.93}" stroke="${shine}" stroke-width="1"/>`;
    case 'club': return `<path d="M ${-L * 0.035} 0 L ${-L * 0.1} ${-L * 0.9} Q 0 ${-L * 1.04} ${L * 0.1} ${-L * 0.9} L ${L * 0.035} 0 Z" fill="${wood}" stroke="#2e1d0f" stroke-width="1"/><path d="M ${-L * 0.04} ${-L * 0.55} l ${L * 0.03} ${-L * 0.05} M ${L * 0.05} ${-L * 0.72} l ${-L * 0.03} ${-L * 0.05}" stroke="#2e1d0f" stroke-width="1"/>`;
    case 'staff': return `${haft(L * 0.95, L * 0.025)}<circle cy="${-L * 0.98}" r="${L * 0.05}" fill="${woodHi}" stroke="#2e1d0f" stroke-width="1"/>`;
    case 'whip': return `<path d="M 0 0 Q ${L * 0.25} ${-L * 0.35} ${-L * 0.05} ${-L * 0.65} Q ${-L * 0.25} ${-L * 0.85} ${L * 0.08} ${-L * 1.0}" fill="none" stroke="#5a3a20" stroke-width="${L * 0.035}" stroke-linecap="round"/>`;
    case 'shield': return `<circle cy="${-L * 0.5}" r="${L * 0.48}" fill="#7a5530" stroke="${edge}" stroke-width="${L * 0.05}"/><circle cy="${-L * 0.5}" r="${L * 0.12}" fill="${face}" stroke="${edge}" stroke-width="1"/>`;
    case 'fist': return `<rect x="${-L * 0.32}" y="${-L * 1.0}" width="${L * 0.64}" height="${L * 0.62}" rx="${L * 0.2}" fill="#b8865f" stroke="#4a2e1a" stroke-width="1.2"/>${[-0.16, 0, 0.16].map((x) => `<line x1="${x * L}" y1="${-L * 0.98}" x2="${x * L}" y2="${-L * 0.78}" stroke="#4a2e1a" stroke-width="1"/>`).join('')}`;
    case 'horn': return `<path d="M ${-L * 0.12} 0 Q ${-L * 0.16} ${-L * 0.6} ${L * 0.08} ${-L * 1.0} Q ${-L * 0.02} ${-L * 0.55} ${L * 0.12} 0 Z" fill="#e8dcc0" stroke="#6b5a3a" stroke-width="1.2"/>`;
    case 'claw': return [-1, 0, 1].map((k) => `<path d="M ${k * L * 0.22} 0 Q ${k * L * 0.26 - L * 0.06} ${-L * 0.6} ${k * L * 0.2 + L * 0.12} ${-L * 1.0} Q ${k * L * 0.2 - L * 0.02} ${-L * 0.55} ${k * L * 0.22 + L * 0.07} 0 Z" fill="#efe6d2" stroke="#5a4a32" stroke-width="1.1"/>`).join('');
    default: return '';
  }
}
/** Two rows of teeth (upper drawn; the lower is the same, mirrored). */
const jawSvg = (L) => `<path d="M ${-L * 0.5} 0 Q 0 ${-L * 0.32} ${L * 0.5} 0" fill="none" stroke="#5a4038" stroke-width="${L * 0.06}" stroke-linecap="round"/>
  ${[-0.36, -0.18, 0, 0.18, 0.36].map((x) => `<path d="M ${x * L - L * 0.05} ${-L * 0.14 + Math.abs(x) * L * 0.25} l ${L * 0.05} ${L * 0.16} l ${L * 0.05} ${-L * 0.16} Z" fill="#f4ecd8" stroke="#6b5a48" stroke-width=".8"/>`).join('')}`;

const ease = (t) => 1 - (1 - t) ** 3; // fast start, soft landing
const lerp = (a, b, t) => a + (b - a) * t;

/**
 * Show the weapon's blow. `at` and `from` are centres in squares; `span` the target's size in
 * squares; `result` 'hit', 'blocked' or 'miss'. `weapon` is the attack ({ name, type, metal }).
 */
export function drawStrike(fx, { weapon, ranged = false, at, from, sz, span = 1, result = 'hit', crit = false }) {
  if (!fx || globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
  const shape = weaponShape(weapon, ranged); if (!shape) return;
  const [move, len] = MOVE[shape];
  const r = sz * 0.5 * Math.max(1, Math.min(span, 3)); const L = r * len;
  const ang = Math.atan2(at.y - from.y, at.x - from.x) * 180 / Math.PI;
  const side = result === 'miss' ? r * 0.85 : 0; // a miss passes beside the target
  const outer = el('g', { class: `dg-weapon ${shape} ${result}${crit ? ' crit' : ''}`, transform: `translate(${(at.x + 0.5) * sz} ${(at.y + 0.5) * sz}) rotate(${ang}) translate(0 ${side})` });
  const g = el('g', {}); g.innerHTML = move === 'snap' ? `<g class="jaw-up">${jawSvg(L)}</g><g class="jaw-down" transform="scale(1 -1)">${jawSvg(L)}</g>` : weaponSvg(shape, L, weapon?.metal);
  outer.append(g); fx.append(outer);
  const stop = result === 'blocked' ? 0.55 : 1; // a blocked blow stops partway
  const ms = { swing: 300, smash: 320, thrust: 260, rake: 260, snap: 240 }[move];
  // Where the weapon is at time t (0..1 of its stroke): returns a transform for the inner group.
  const pose = (t) => {
    const k = ease(Math.min(t, stop));
    if (move === 'swing') return `translate(${-r * 0.95} 0) rotate(${lerp(20, 160, k)})`;
    if (move === 'smash') { const bounce = t > 0.82 ? Math.sin((t - 0.82) / 0.18 * Math.PI) * 6 : 0; return `translate(${-r * 0.95} 0) rotate(${lerp(-10, 92, k) - bounce})`; }
    if (move === 'thrust') { const out = t < 0.6 ? ease(Math.min(t / 0.6, stop)) : stop - (t - 0.6) / 0.4 * 0.35; return `translate(${lerp(-r * 1.1 - L, -L * 0.95 + r * 0.25, out)} 0) rotate(90)`; }
    if (move === 'rake') return `translate(${lerp(-r * 0.6, r * 0.35, k)} ${lerp(-r * 0.75, r * 0.6, k)}) rotate(${lerp(140, 110, k)})`;
    return ''; // snap: the jaws move, below
  };
  const jaws = move === 'snap' ? [g.querySelector('.jaw-up'), g.querySelector('.jaw-down')] : null;
  const t0 = performance.now(); const total = ms + 160;
  const step = (now) => {
    const e = Math.min(1, (now - t0) / ms);
    if (jaws) { const gap = lerp(r * 0.75, r * 0.1, ease(Math.min(e, stop))); jaws[0].setAttribute('transform', `translate(0 ${-gap})`); jaws[1].setAttribute('transform', `translate(0 ${gap}) scale(1 -1)`); }
    else g.setAttribute('transform', pose(e));
    const fade = (now - t0) > ms ? 1 - ((now - t0) - ms) / 160 : Math.min(1, (now - t0) / 60);
    outer.setAttribute('opacity', String(Math.max(0, fade) * (result === 'miss' ? 0.55 : 1)));
    if (now - t0 < total && outer.isConnected) requestAnimationFrame(step); else outer.remove();
  };
  requestAnimationFrame(step);
  if (result === 'blocked') sparks(fx, at, from, sz, r);
  setTimeout(() => outer.remove(), total + 500); // a hidden tab never runs the frames
}

/** A few sparks where a blow met a shield or a parrying blade. */
function sparks(fx, at, from, sz, r) {
  const ang = Math.atan2(at.y - from.y, at.x - from.x) * 180 / Math.PI;
  const g = el('g', { class: 'dg-sparks', transform: `translate(${(at.x + 0.5) * sz} ${(at.y + 0.5) * sz}) rotate(${ang}) translate(${-r * 0.5} 0)` });
  for (let i = 0; i < 7; i++) { const a = (i / 7) * Math.PI * 2; g.append(el('line', { x1: Math.cos(a) * r * 0.08, y1: Math.sin(a) * r * 0.08, x2: Math.cos(a) * r * 0.32, y2: Math.sin(a) * r * 0.32 })); }
  fx.append(g);
  g.animate?.([{ opacity: 1, transform: 'scale(.6)' }, { opacity: 0, transform: 'scale(1.3)' }], { duration: 380, delay: 150, easing: 'ease-out', fill: 'forwards' });
  setTimeout(() => g.remove(), 700);
}

const el = (tag, attrs) => { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; };

/**
 * The sound of a blow landing: the same steel ring played faster for a sharp thrust or slower
 * for a heavy chop, smash or bite (playback rate changes the pitch). { key, rate }.
 */
export function hitSound(kind) {
  if (kind === 'shot') return { key: 'arrow-hit', rate: 1 };
  return { key: 'sword-hit', rate: { thrust: 1.25, slash: 1, claws: 1.1, chop: 0.8, smash: 0.65, bite: 0.75 }[kind] ?? 1 };
}
