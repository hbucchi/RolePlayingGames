/**
 * Sound effects (generated with ElevenLabs). Every sound has 4 variations and a random one
 * plays each time, so repeated hits don't sound mechanical. Browsers only allow audio after
 * the player has interacted with the page, which is always true by the time combat starts.
 */
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
    const a = new Audio(`assets/sounds/${key}-${n}.mp3`);
    a.volume = volume;
    a.play().catch(() => { /* blocked or missing: stay silent */ });
  };
  if (delay) setTimeout(start, delay); else start();
}

/** Warm the browser cache so the first hit isn't late. */
export function preload(keys) {
  for (const k of keys) {
    for (let n = 1; n <= VARIANTS; n++) {
      const a = new Audio(); a.preload = 'auto'; a.src = `assets/sounds/${k}-${n}.mp3`;
    }
  }
}

/**
 * Which voice a monster uses. Spiders hiss and bats screech; other small creatures reuse the
 * high goblin shrieks (a pit-runt is a goblin, after all), and big ones roar.
 */
export function monsterVoice(stat) {
  if (!stat) return 'goblin';
  if (/spider|ettercap|weaver/i.test(stat.id)) return 'spider';
  if (/bat/.test(stat.id)) return 'bat';
  if (stat.id === 'shadowflame-tyrant' || /demon|balor/.test(stat.id)) return 'demon';
  if (stat.type === 'dragon' || /dragon|drake|wyrm/.test(stat.id)) return 'dragon';
  if (/wolf|worg|warg/.test(stat.id)) return 'wolf';
  if (/orc|ogre/.test(stat.id)) return 'orc';
  return stat.size === 'Tiny' || stat.size === 'Small' || stat.size === 'Medium' ? 'goblin' : 'boss';
}

export const SOUND_KEYS = [
  'sword-hit', 'swing-miss', 'bow-shot', 'arrow-hit', 'crit', 'door-open', 'dice',
  'hero-low-attack', 'hero-low-hurt', 'hero-low-death', 'hero-high-attack', 'hero-high-hurt', 'hero-high-death',
  'goblin-attack', 'goblin-hurt', 'goblin-death', 'boss-roar', 'boss-hurt',
  'spider-attack', 'spider-hurt', 'spider-death', 'bat-attack', 'bat-hurt', 'bat-death',
  'coins', 'level-up', 'lockpick', 'trap', 'bandage', 'chest-open', 'potion',
  'spell-fire', 'spell-arcane', 'spell-heal', 'spell-thunder',
  'dragon-attack', 'dragon-hurt', 'wolf-attack', 'wolf-hurt', 'wolf-death', 'orc-attack', 'orc-hurt', 'orc-death', 'demon-roar',
];

/** The sound for a voice family doing something; some families share one sound for several moments. */
export function voiceSound(voice, what) {
  if (voice.startsWith('hero')) return `${voice}-${what}`;
  if (voice === 'boss') return what === 'attack' ? 'boss-roar' : 'boss-hurt';
  if (voice === 'demon') return what === 'attack' ? 'demon-roar' : 'boss-hurt';
  if (voice === 'dragon') return what === 'attack' ? 'dragon-attack' : 'dragon-hurt';
  return `${voice}-${what}`;
}
