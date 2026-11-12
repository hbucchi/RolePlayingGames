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
    // Defeat undoes the floor: every hero is back as they came in (engine/delve.js).
    s.lost = kind === 'defeat' ? ctx.loseDelve() : [];
    if (kind === 'victory') ctx.finishAdventure();
    setMood('dungeon');
    stinger(kind === 'victory' ? 'victory' : 'defeat');
    const el = $('.dg-endscreen');
    el.hidden = false;
    if (ctx.onOutcome) { // a battle inside a story: the story goes on either way
      el.innerHTML = `<div class="dg-endcard"><h2>${kind === 'victory' ? 'Victory!' : 'Defeated'}</h2>
        <p>${kind === 'victory' ? 'The last foe falls.' : 'The dark closes in...'} The tale goes on.</p>
        <div class="row wrap"><button class="btn primary" data-dg="story-continue">Continue the story</button>
        ${kind === 'victory' ? '' : '<button class="btn" data-dg="review">Look over the battlefield</button><button class="btn ghost" data-dg="retry">Fight it again</button>'}</div></div>`;
      return;
    }
    el.innerHTML = kind === 'victory' && s.map?.boss
      ? `<div class="dg-endcard"><h2>The master of the deep is dead</h2><p>The tenth floor is yours. Its hoard lies in the chests beside the throne, and behind it the way out to the daylight stands open.</p>
        <p class="small">This delve: <b>${s.delve.kills}</b> foes slain · <b>${s.delve.xp.toLocaleString()}</b> XP · <b>${esc(formatCoins(s.delve.coins))}</b> · <b>${s.delve.items}</b> items looted.</p><div class="row"><button class="btn primary" data-dg="close-end">Claim the hoard</button></div></div>`
      : kind === 'victory'
      ? `<div class="dg-endcard"><h2>Depth ${s.depth} of ${ctx.MAX_DEPTH} cleared</h2><p>Every foe on this floor of dungeon #${s.seed} has fallen. The stairs down still wait somewhere${s.exitSeen ? ' (you have seen them)' : ''}. ${esc(s.hero.name)} stands victorious with ${s.hero.hp} of ${s.hero.maxHp} hit points.</p>
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
      ${ctx.place ? '<button class="btn primary" data-dg="retry">Try again</button><button class="btn ghost" data-dg="leave-arena">Back to the world map</button>' : arena ? '<button class="btn primary" data-dg="retry">Restart the bout</button><button class="btn ghost" data-dg="leave-arena">Back to the builder</button>'
    : '<button class="btn primary" data-dg="retry">Try this dungeon again</button><button class="btn ghost" data-dg="random">Try a new dungeon</button><button class="btn ghost" data-action="home">Return to the menu</button>'}
    </div>`;
  }

  function defeatCard() {
    const names = ctx.party().map((h) => h.name);
    return `<div class="dg-endcard"><h2>${esc(names.length > 1 ? 'The party has fallen' : `${names[0]} has fallen`)}</h2>
      <p>The dark claims another hero... but legends are stubborn. ${arena && !ctx.place ? 'It was only practice.' : ctx.keepsCheckpoint ? `Everything won ${ctx.place ? 'here' : 'since the last stairs'} is lost: the experience, the loot and the coins. Back to how ${esc(names.length > 1 ? 'the party' : names[0])} stood ${ctx.place ? 'on arriving' : 'at the last way down'}.` : 'The tale goes on.'}</p>
      <p class="small muted">Look over the battlefield to see how it ended: the map stays exactly as it was, and the battle log tells the story blow by blow.</p>
      ${defeatButtons()}</div>`;
  }

  return { showEnd, defeatButtons, defeatCard };
}
