/**
 * Rolling dice you can watch. The result is already decided by the game; this shows the dice
 * tumbling, the numbers flickering and slowing down, then landing on it. Click (or tap) the dice
 * to skip ahead. Shapes are plain SVG (easy to restyle): d4 triangle, d6 square, d8 diamond,
 * d10 kite, d12 pentagon, d20 hexagon with its facets.
 *
 * rollDice({ groups: [{ dice: [{ sides: 20, value: 17, dropped? }], caption }], label, verdict, parent })
 *   -> Promise that resolves when the dice have landed and been shown for a moment.
 */
import { getSetting } from './settings.js';

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const reduceMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** The outline of each die, in a 100 x 100 box centred on 0,0, with a few facet lines. */
const poly = (pts) => pts.map((p) => p.join(',')).join(' ');
const hex = [...Array(6)].map((_, i) => [Math.round(46 * Math.sin((i * Math.PI) / 3)), Math.round(-46 * Math.cos((i * Math.PI) / 3))]);
const pent = [...Array(5)].map((_, i) => [Math.round(46 * Math.sin((i * 2 * Math.PI) / 5)), Math.round(-46 * Math.cos((i * 2 * Math.PI) / 5)) + 3]);
export const DIE_SHAPES = {
  4: { body: poly([[0, -44], [44, 34], [-44, 34]]), facets: '', ty: 14 },
  6: { body: poly([[-38, -38], [38, -38], [38, 38], [-38, 38]]), facets: '', ty: 0, rx: 9 },
  8: { body: poly([[0, -47], [41, 0], [0, 47], [-41, 0]]), facets: 'M -41 0 L 41 0', ty: 0 },
  10: { body: poly([[0, -47], [43, -8], [0, 47], [-43, -8]]), facets: 'M -43 -8 L 0 14 L 43 -8 M 0 14 L 0 47', ty: -6 },
  12: { body: poly(pent), facets: '', ty: 2 },
  20: { body: poly(hex), facets: `M ${hex[0]} L ${hex[2]} L ${hex[4]} Z M ${hex[0]} L ${hex[1]} M ${hex[2]} L ${hex[3]} M ${hex[4]} L ${hex[5]}`, ty: 6 },
};

function dieSvg(sides, value, cls = '') {
  const sh = DIE_SHAPES[sides] ?? DIE_SHAPES[6];
  const font = sides === 4 ? 30 : String(value).length > 1 ? 32 : 38;
  return `<svg class="die d${sides} ${cls}" viewBox="-50 -50 100 100" role="img" aria-label="d${sides}: ${value}">
    <g class="die-spin">
      ${sides === 6 ? `<rect x="-38" y="-38" width="76" height="76" rx="${sh.rx}" class="die-body"/>` : `<polygon points="${sh.body}" class="die-body"/>`}
      ${sh.facets ? `<path d="${sh.facets.replace(/(-?\d+),(-?\d+)/g, '$1 $2')}" class="die-facet"/>` : ''}
      <text y="${sh.ty}" class="die-num" style="font-size:${font}px">${value}</text>
      <text y="${sh.ty + 34}" class="die-kind">d${sides}</text>
    </g></svg>`;
}

/** Should these dice be shown? The Dice setting: 'heroes' (default), 'all', or 'off'. */
export function diceWanted(byHero) {
  const m = getSetting('dice');
  return m === 'all' || (m === 'heroes' && byHero);
}

export function rollDice({ groups, label = '', verdict = '', verdictKind = '', parent = document.body, fast = false }) {
  if (reduceMotion()) return Promise.resolve();
  return new Promise((resolve) => {
    const tray = document.createElement('div');
    tray.className = `dice-tray ${parent === document.body ? 'floating' : ''}`;
    tray.setAttribute('role', 'status');
    tray.title = 'Click to skip';
    tray.innerHTML = `${label ? `<p class="dice-label">${esc(label)}</p>` : ''}
      ${groups.map((g, gi) => `<div class="dice-row" data-g="${gi}">${g.dice.map((d, i) => `<span class="die-slot" data-g="${gi}" data-i="${i}">${dieSvg(d.sides, '?', 'rolling')}</span>`).join('')}${g.caption ? `<span class="dice-caption">${esc(g.caption)}</span>` : ''}</div>`).join('')}
      <p class="dice-verdict"></p>`;
    parent.append(tray);
    let skip = false; let finished = false;
    const done = () => { if (finished) return; finished = true; tray.classList.add('leaving'); setTimeout(() => tray.remove(), 220); resolve(); };
    tray.addEventListener('pointerdown', (e) => { e.stopPropagation(); if (skip) done(); skip = true; });

    const spinMs = fast ? 450 : 900;
    (async () => {
      for (const [gi, g] of groups.entries()) {
        const start = performance.now(); let last = 0;
        // Numbers flicker quickly at first, then slower and slower (an easing on the interval).
        while (!skip && performance.now() - start < spinMs) {
          const t = (performance.now() - start) / spinMs;
          if (performance.now() - last > 40 + 160 * t * t) {
            last = performance.now();
            g.dice.forEach((d, i) => { const slot = tray.querySelector(`.die-slot[data-g="${gi}"][data-i="${i}"] .die-num`); if (slot) slot.textContent = 1 + Math.floor(Math.random() * d.sides); });
          }
          await new Promise((r) => requestAnimationFrame(r));
        }
        g.dice.forEach((d, i) => {
          const slot = tray.querySelector(`.die-slot[data-g="${gi}"][data-i="${i}"]`);
          const special = d.sides === 20 && !d.dropped ? (d.value === 20 ? 'nat20' : d.value === 1 ? 'nat1' : '') : '';
          slot.innerHTML = dieSvg(d.sides, d.value, `landed ${d.dropped ? 'dropped' : ''} ${special}`);
        });
      }
      const v = tray.querySelector('.dice-verdict');
      v.textContent = verdict; v.className = `dice-verdict ${verdictKind}`;
      setTimeout(done, skip ? 250 : fast ? 500 : 900);
    })();
  });
}

/** Dice for a roll like "2d6+3": its dice as {sides, value} from the rolled values. */
export function diceOf(notation, rolls) {
  const m = /(\d+)d(\d+)/.exec(notation ?? ''); const sides = m ? Number(m[2]) : 6;
  return (rolls ?? []).map((value) => ({ sides: [4, 6, 8, 10, 12, 20].includes(sides) ? sides : 6, value }));
}
