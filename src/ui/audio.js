/**
 * Sound effects (generated with ElevenLabs). Every sound has 4 variations and a random one
 * plays each time, so repeated hits don't sound mechanical. Browsers only allow audio after
 * the player has interacted with the page, which is always true by the time combat starts.
 */
import { packed } from '../content/asset-pack.js';

const VARIANTS = 4;
const KEY = 'rpg.sound.muted';

let muted = false;
try { muted = localStorage.getItem(KEY) === '1'; } catch { /* storage unavailable */ }

const last = new Map();

export function isMuted() { return muted; }
export function setMuted(v) {
  muted = !!v;
  try { localStorage.setItem(KEY, muted ? '1' : '0'); } catch { /* ignore */ }
}

/** Spoken hero lines have more takes than effects: 6 lines, each performed twice. */
export const variantsOf = (key) => TAKES[key] ?? (/-say-/.test(key) ? SAY_TAKES : VARIANTS);
const SAY_TAKES = 12;
const TAKES = { 'amazon-say-hurt': 8 };

/**
 * What an Amazon cries when wounded. Each line was recorded twice: line k is takes 2k-1 and 2k of
 * 'amazon-say-hurt'. She speaks on about half of the hits that don't drop her (a grunt otherwise),
 * and the words float over her head as well, for players who play without sound.
 */
export const AMAZON_HURT_LINES = ['Argh, this hurts!', "I can't let you do this to me!", "Ouch... you're hurting me!", "I'm gonna make you pay for this!"];
export const AMAZON_LINE_CHANCE = 0.5;
export const isAmazon = (statId) => /^amazon-/.test(statId ?? '');
/** A line and the take to play for it, or null for a plain grunt this time. `random` is for tests. */
export function amazonHurtLine(random = Math.random) {
  if (random() >= AMAZON_LINE_CHANCE) return null;
  const k = Math.floor(random() * AMAZON_HURT_LINES.length);
  return { line: AMAZON_HURT_LINES[k], n: 2 * k + 1 + (random() < 0.5 ? 0 : 1) };
}

/**
 * Play one variation of a sound, never the same variation twice in a row (or take `n` when given).
 * Returns the take played.
 */
export function play(key, { volume = 0.9, delay = 0, n: take = 0 } = {}) {
  if (muted || !key) return 0;
  const count = variantsOf(key);
  let n = take || 1 + Math.floor(Math.random() * count);
  if (!take && n === last.get(key)) n = (n % count) + 1;
  last.set(key, n);
  const start = () => {
    const a = new Audio(packed(`assets/sounds/${key}-${n}.mp3`));
    a.volume = volume;
    a.play().catch(() => { /* blocked or missing: stay silent */ });
  };
  if (delay) setTimeout(start, delay); else start();
  return n;
}

/** Warm the browser cache so the first hit isn't late. */
export function preload(keys) {
  for (const k of keys) {
    for (let n = 1; n <= variantsOf(k); n++) {
      const a = new Audio(); a.preload = 'auto'; a.src = packed(`assets/sounds/${k}-${n}.mp3`);
    }
  }
}

/**
 * Which voice a monster uses. Spiders hiss and bats screech; other small creatures reuse the
 * high goblin shrieks (a pit-runt is a goblin, after all), and big ones roar.
 */
export function monsterVoice(stat) {
  if (!stat) return 'goblin';
  if (stat.voice) return stat.voice; // the creature's record says how it sounds
  // Otherwise guess from its name and kind (a new creature without a voice yet).
  const id = stat.id; const t = stat.type; const small = stat.size === 'Tiny' || stat.size === 'Small';
  // Creepy-crawlies hiss and click.
  if (/spider|ettercap|weaver|drider|scorpion|centipede|beetle|wasp|insect|ankheg|carrion|rust-monster|stirge|brood-queen/.test(id)) return 'spider';
  if (/(^|-)bats?(-|$)|crag-bat/.test(id)) return 'bat';
  // Women's voices: the Amazons, hags, medusae, dryads...
  if (/^amazon-|hag|medusa|lamia|harpy|dryad|succubus|erinyes|princess|merfolk|sprite|naga|gynosphinx/.test(id)) return 'hero-high';
  if (id === 'shadowflame-tyrant' || /demon|balor/.test(id)) return 'demon';
  if (t === 'fiend') return small ? 'goblin' : /hound|nightmare/.test(id) ? 'beast' : 'demon';
  if (t === 'dragon' || /dragon|drake|wyrm|wyvern|hydra|behir|basilisk|tarrasque|remorhaz|purple-worm|chimera/.test(id)) return 'dragon';
  if (/wolf|worg|warg|jackal|hyena|mastiff|death-dog|gnoll/.test(id)) return 'wolf';
  if (/orc|ogre|bugbear|hobgoblin|troll|ettin|oni|minotaur/.test(id)) return 'orc';
  if (/eagle|hawk|owl|raven|vulture|roc$|griffon|hippogriff|cockatrice|axe-beak|pteranodon|crows|couatl/.test(id)) return 'bird';
  if (t === 'undead') return 'undead';
  if (t === 'elemental' || /treant|tree|gargoyle/.test(id)) return 'elemental';
  if (t === 'construct') return 'construct';
  if (t === 'ooze' || t === 'aberration' || /shambling|shrub|fungus|shrieker|mimic|roper|piercer|darkmantle/.test(id)) return 'ooze';
  if (t === 'humanoid') return /goblin|kobold|pit-runt|grimlock|gnome|lizardfolk|sahuagin|creeper/.test(id) ? 'goblin' : 'hero-low';
  if (t === 'celestial' || t === 'fey') return 'hero-high';
  if (t === 'giant') return 'boss';
  if (t === 'beast' || t === 'monstrosity') return small ? 'bat' : 'beast';
  return small || stat.size === 'Medium' ? 'goblin' : 'boss';
}

export const SOUND_KEYS = [
  'sword-hit', 'swing-miss', 'bow-shot', 'arrow-hit', 'crit', 'door-open', 'dice',
  'hero-low-attack', 'hero-low-hurt', 'hero-low-death', 'hero-high-attack', 'hero-high-hurt', 'hero-high-death',
  'goblin-attack', 'goblin-hurt', 'goblin-death', 'boss-roar', 'boss-hurt',
  'spider-attack', 'spider-hurt', 'spider-death', 'bat-attack', 'bat-hurt', 'bat-death',
  'coins', 'level-up', 'lockpick', 'trap', 'bandage', 'chest-open', 'potion',
  'spell-fire', 'spell-arcane', 'spell-heal', 'spell-thunder',
  'whip-crack', 'goblin-laugh',
  'hero-low-say-attack', 'hero-low-say-hurt', 'hero-high-say-attack', 'hero-high-say-hurt', 'amazon-say-hurt',
  'beast-attack', 'beast-hurt', 'bird-attack', 'bird-hurt', 'undead-attack', 'undead-hurt', 'elemental-attack', 'elemental-hurt',
  'construct-attack', 'construct-hurt', 'ooze-attack', 'ooze-hurt',
  'dragon-attack', 'dragon-hurt', 'wolf-attack', 'wolf-hurt', 'wolf-death', 'orc-attack', 'orc-hurt', 'orc-death', 'demon-roar',
];

/**
 * A hero's sound when attacking or hurt. Grunts and screams most of the time; about one time in
 * seven (15%) a spoken line instead ("Take that!", "You almost got me!"), so words stay special.
 * `random` is there for tests.
 */
export const HERO_LINE_CHANCE = 0.15;
export function heroSound(voice, what, random = Math.random) {
  if ((what === 'attack' || what === 'hurt') && random() < HERO_LINE_CHANCE) return `hero-${voice}-say-${what}`;
  return `hero-${voice}-${what}`;
}

/** The sound for a voice family doing something; some families share one sound for several moments. */
export function voiceSound(voice, what) {
  if (voice.startsWith('hero')) return `${voice}-${what}`;
  if (voice === 'boss') return what === 'attack' ? 'boss-roar' : 'boss-hurt';
  if (voice === 'demon') return what === 'attack' ? 'demon-roar' : 'boss-hurt';
  if (voice === 'dragon') return what === 'attack' ? 'dragon-attack' : 'dragon-hurt';
  // The newer families have an attack and a hurt sound; dying uses the hurt one.
  if (['beast', 'bird', 'undead', 'elemental', 'construct', 'ooze'].includes(voice)) return `${voice}-${what === 'attack' ? 'attack' : 'hurt'}`;
  return `${voice}-${what}`;
}
