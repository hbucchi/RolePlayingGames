/**
 * The end of a fight: the victory card, and defeat with whatever the defeat mode adds.
 * Part of the dungeon screen (see ../dungeon-view.js): `ctx` gives access to the shared state `s`
 * and to the functions of the other parts.
 */
import { setMood, stinger } from '../music.js';
import { formatCoins } from '../../engine/items.js';
import { getSetting } from '../settings.js';
import { defeatMode } from '../mods/registry.js';

export function installEndings(ctx) {
  const { $, arena, esc, s } = ctx;

  function showEnd(kind) {
    s.mode = kind;
    setMood('dungeon');
    stinger(kind === 'victory' ? 'victory' : 'defeat');
    const el = $('.dg-endscreen');
    el.hidden = false;
    el.innerHTML = kind === 'victory'
      ? `<div class="dg-endcard"><h2>Depth ${s.depth} cleared</h2><p>Every foe on this floor of dungeon #${s.seed} has fallen. The stairs down still wait somewhere${s.exitSeen ? ' (you have seen them)' : ''}. ${esc(s.hero.name)} stands victorious with ${s.hero.hp} of ${s.hero.maxHp} hit points.</p>
        <p class="small">This delve: <b>${s.delve.kills}</b> foes slain · <b>${s.delve.xp.toLocaleString()}</b> XP · <b>${esc(formatCoins(s.delve.coins))}</b> · <b>${s.delve.items}</b> items looted. Bodies and chests you have not searched are still down there.</p><div class="row"><button class="btn primary" data-dg="close-end">Find the way down</button><button class="btn" data-dg="random">Start a new dungeon</button></div></div>`
      : defeatCard();
    // A defeat mode from a mod (see ../mods) may add its own scene, e.g. being taken captive.
    const mode = kind === 'defeat' && !arena ? defeatMode(getSetting('defeat')) : null;
    if (mode) mode(ctx);
  }

  /** The buttons after a defeat: study the frozen battle, or start again when you choose. */
  function defeatButtons() {
    return `<div class="row wrap">
      <button class="btn" data-dg="review">Look over the battlefield</button>
      ${arena ? '<button class="btn primary" data-dg="retry">Restart the bout</button><button class="btn ghost" data-dg="leave-arena">Back to the builder</button>'
    : '<button class="btn primary" data-dg="retry">Try this dungeon again</button><button class="btn ghost" data-dg="random">Try a new dungeon</button><button class="btn ghost" data-action="home">Return to the menu</button>'}
    </div>`;
  }

  function defeatCard() {
    const names = ctx.party().map((h) => h.name);
    return `<div class="dg-endcard"><h2>${esc(names.length > 1 ? 'The party has fallen' : `${names[0]} has fallen`)}</h2>
      <p>The dark claims another hero... but legends are stubborn. ${arena ? 'It was only practice.' : 'Your experience and the loot you carried out are kept.'}</p>
      <p class="small muted">Look over the battlefield to see how it ended: the map stays exactly as it was, and the battle log tells the story blow by blow.</p>
      ${defeatButtons()}</div>`;
  }

  return { showEnd, defeatButtons, defeatCard };
}
