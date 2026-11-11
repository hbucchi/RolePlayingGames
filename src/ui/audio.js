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

/** Play one variation of a sound, never the same variation twice in a row. */
export function play(key, { volume = 0.9, delay = 0 } = {}) {
  if (muted || !key) return;
  let n = 1 + Math.floor(Math.random() * VARIANTS);
  if (n === last.get(key)) n = (n % VARIANTS) + 1;
  last.set(key, n);
  const start = () => {
    const a = new Audio(packed(`assets/sounds/${key}-${n}.mp3`));
    a.volume = volume;
    a.play().catch(() => { /* blocked or missing: stay silent */ });
  };
  if (delay) setTimeout(start, delay); else start();
}

/** Warm the browser cache so the first hit isn't late. */
export function preload(keys) {
  for (const k of keys) {
    for (let n = 1; n <= VARIANTS; n++) {
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
  'beast-attack', 'beast-hurt', 'bird-attack', 'bird-hurt', 'undead-attack', 'undead-hurt', 'elemental-attack', 'elemental-hurt',
  'construct-attack', 'construct-hurt', 'ooze-attack', 'ooze-hurt',
  'dragon-attack', 'dragon-hurt', 'wolf-attack', 'wolf-hurt', 'wolf-death', 'orc-attack', 'orc-hurt', 'orc-death', 'demon-roar',
];

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
