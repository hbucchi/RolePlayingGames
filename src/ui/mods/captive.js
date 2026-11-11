/**
 * Mod: taken captive. Chosen in Settings ("When all heroes fall"): instead of the plain defeat
 * card, the party wakes in a goblin gaol. Escaping will be the next chapter.
 */
import { bodyUrl } from '../../content/media.js';
import { play } from '../audio.js';
import { registerDefeatMode } from './registry.js';

/**
 * Taken captive (a mod setting): the party wakes in chains in a goblin jailer's cell. A short
 * scene plays: the jailer's whip cracks, a hero cries out, the goblin cackles. Escaping will be
 * the next chapter.
 */
export async function showCaptured(ctx) {
  const { $, s, esc, sleep, party, defeatButtons } = ctx;
  const el = $('.dg-endscreen');
  const heroesIn = party().slice(0, 4);
  const sz = 64; const W = 7; const H = 5; const run = Symbol('captive');
  s.captiveRun = run;
  const xs = heroesIn.map((_, i) => 1 + (i + 0.5) * (5 / heroesIn.length));
  const heroSvg = heroesIn.map((h, i) => {
    const cx = xs[i] * sz; const cy = 1.55 * sz; const body = s.view === 'bodies' ? bodyUrl(h.race) : null;
    const pic = body
      ? `<image href="${esc(body)}" x="${-sz * 0.65}" y="${-sz * 0.65}" width="${sz * 1.3}" height="${sz * 1.3}" class="cap-body"/>`
      : `<clipPath id="cap-c${i}"><circle r="${sz * 0.4}"/></clipPath><image href="${esc(h.look?.url ?? '')}" x="${-sz * 0.4}" y="${-sz * 0.4}" width="${sz * 0.8}" height="${sz * 0.8}" clip-path="url(#cap-c${i})"/>`;
    return `<line x1="${cx - 14}" y1="${sz}" x2="${cx - 10}" y2="${cy - 8}" class="tk-chain"/><line x1="${cx + 14}" y1="${sz}" x2="${cx + 10}" y2="${cy - 8}" class="tk-chain"/>
      <g class="cap-hero" data-i="${i}" transform="translate(${cx} ${cy})">${pic}<circle r="${sz * 0.45}" class="cap-flash"/></g>`;
  }).join('');
  const goblin = bodyUrl('goblin');
  el.innerHTML = `<div class="dg-endcard captive"><h2>Taken captive</h2>
    <p>You wake in chains, hanging from the wall of a goblin gaol. Your weapons are gone. A grinning jailer uncoils his whip.</p>
    <svg class="cap-scene" viewBox="0 0 ${W * sz} ${H * sz}" role="img" aria-label="The party chained to a dungeon wall while a goblin jailer cracks his whip">
      <image href="assets/textures/floor-flagstone.jpg" x="0" y="0" width="${W * sz}" height="${H * sz}" preserveAspectRatio="xMidYMid slice"/>
      <image href="assets/textures/rock-bedrock.jpg" x="0" y="0" width="${W * sz}" height="${sz}" preserveAspectRatio="xMidYMid slice"/>
      <rect x="0" y="${sz - 6}" width="${W * sz}" height="10" fill="rgba(0,0,0,.45)"/>
      ${heroSvg}
      <path class="cap-whip" d="M 0 0"/>
      <g class="cap-goblin" transform="translate(${3.5 * sz} ${4 * sz})"><image href="${esc(goblin)}" x="${-sz * 0.6}" y="${-sz * 0.6}" width="${sz * 1.2}" height="${sz * 1.2}"/></g>
      <rect width="${W * sz}" height="${H * sz}" class="cap-vignette"/>
    </svg>
    <ol class="cap-log small"></ol>
    <div class="row wrap"><button class="btn" disabled title="Coming in a later update">Try to escape (coming soon)</button></div>
    ${defeatButtons()}</div>`;
  const svg = el.querySelector('.cap-scene'); const logEl = el.querySelector('.cap-log');
  const say = (t) => { const li = document.createElement('li'); li.textContent = t; logEl.prepend(li); };
  const lashes = Math.min(6, Math.max(3, heroesIn.length * 2));
  const still = () => s.captiveRun === run && !el.hidden && s.mode === 'defeat';
  const verbs = ['cracks the whip across', 'lashes', 'brings the whip down on', 'strikes'];
  for (let k = 0; k < lashes; k++) {
    await sleep(900);
    if (!still()) return;
    const i = k % heroesIn.length; const h = heroesIn[i];
    const gx = xs[i] * sz; const gy = 3.1 * sz;
    svg.querySelector('.cap-goblin').setAttribute('transform', `translate(${gx} ${gy})`);
    await sleep(500);
    if (!still()) return;
    const whip = svg.querySelector('.cap-whip');
    whip.setAttribute('d', `M ${gx + 10} ${gy - 20} Q ${gx + 60} ${gy - 120} ${gx} ${1.55 * sz + 6}`);
    whip.classList.remove('crack'); void whip.getBoundingClientRect(); whip.classList.add('crack');
    play('whip-crack', { volume: 0.9 });
    await sleep(160);
    const hero = svg.querySelector(`.cap-hero[data-i="${i}"]`);
    hero.classList.remove('hit'); void hero.getBoundingClientRect(); hero.classList.add('hit');
    play(`hero-${h.voice ?? 'low'}-hurt`, { volume: 0.9 });
    if (k % 2 === 1) play('goblin-laugh', { delay: 500, volume: 0.8 });
    say(`The jailer ${verbs[k % verbs.length]} ${h.name}. ${k % 2 === 1 ? 'He cackles.' : ''}`);
  }
  await sleep(900);
  if (!still()) return;
  svg.querySelector('.cap-goblin').setAttribute('transform', `translate(${6.5 * sz} ${4.6 * sz})`);
  play('goblin-laugh', { volume: 0.7 });
  say('Bored at last, the jailer wanders off laughing, his keys jangling at his belt... Somewhere, a guard snores. (Escaping comes in a later update.)');
}

registerDefeatMode('captive', showCaptured);
