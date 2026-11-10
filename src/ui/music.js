/**
 * Background music. All tracks are public domain (CC0) from OpenGameArt.org; credits below
 * are not required by the licence but are given gladly.
 *
 * The game sets a *mood* (menu, dungeon, combat); each mood is a small playlist. Changing mood
 * cross-fades: the old track's volume ramps down while the new one ramps up, so the switch
 * into battle feels like a film cut rather than a hard stop. Short "stingers" (victory, defeat)
 * duck the music, play once, then let the mood resume.
 *
 * Browsers refuse to play sound until the player has clicked or pressed a key, so the first
 * mood request waits for that gesture.
 */
export const TRACKS = {
  exploration: { title: 'Medieval: Exploration', author: 'RandomMind', url: 'https://opengameart.org/content/medieval-exploration' },
  'minstrel-dance': { title: 'Medieval: Minstrel Dance', author: 'RandomMind', url: 'https://opengameart.org/content/medieval-minstrel-dance' },
  lament: { title: 'Fantasy: Lament for a Warrior\'s Soul', author: 'RandomMind', url: 'https://opengameart.org/content/fantasy-lament-for-a-warriors-soul' },
  'dungeon-ambience': { title: 'Dungeon Ambience', author: 'yd', url: 'https://opengameart.org/content/dungeon-ambience' },
  'dark-cavern': { title: 'Dark Cavern Ambient', author: 'Paul Wortmann', url: 'https://opengameart.org/content/dark-cavern-ambient' },
  battle: { title: 'Medieval: Battle', author: 'RandomMind', url: 'https://opengameart.org/content/medieval-battle' },
  victory: { title: 'Medieval: Victory Theme', author: 'RandomMind', url: 'https://opengameart.org/content/medieval-victory-theme' },
  defeat: { title: 'Medieval: Defeat Theme', author: 'RandomMind', url: 'https://opengameart.org/content/medieval-defeat-theme' },
};

export const MOODS = {
  menu: ['exploration', 'minstrel-dance', 'lament'],
  dungeon: ['dungeon-ambience', 'dark-cavern'],
  combat: ['battle'],
};

const KEY_ON = 'rpg.music.on'; const KEY_LEVEL = 'rpg.music.level';
const load = (k, d) => { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch { return d; } };
const store = (k, v) => { try { localStorage.setItem(k, String(v)); } catch { /* storage unavailable */ } };

let enabled = load(KEY_ON, '1') === '1';
/**
 * Loudness is perceived on a logarithmic scale: halving the signal sounds only a little quieter
 * (-6 dB). A linear slider therefore crams all the useful quiet settings into its bottom tenth.
 * So the slider position (0-1) is mapped to decibels instead: 0 = silent, then -40 dB ... 0 dB,
 * and gain = 10^(dB / 20). Each tenth of the slider is the same 4 dB step to the ear.
 */
export const DB_RANGE = 40;
export const levelToGain = (level) => (level <= 0 ? 0 : 10 ** ((DB_RANGE * (Math.min(1, level) - 1)) / 20));
let volume = Math.min(1, Math.max(0, Number(load(KEY_LEVEL, '0.7')))); // slider position, not gain
let mood = null; let index = 0; let current = null; let unlocked = false; let duck = 1; let stingerAudio = null;
const listeners = new Set();
const notify = () => listeners.forEach((fn) => fn(state()));

export const state = () => ({ enabled, volume, mood, track: current ? TRACKS[current.key] : null });
export const onChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };

/** Ramp an element's volume to `to` over `ms`, then call done. */
function fade(audio, to, ms, done) {
  clearInterval(audio._fade);
  const from = audio.volume; const steps = Math.max(1, Math.round(ms / 50)); let i = 0;
  audio._fade = setInterval(() => {
    i++;
    audio.volume = Math.min(1, Math.max(0, from + (to - from) * (i / steps)));
    if (i >= steps) { clearInterval(audio._fade); done?.(); }
  }, 50);
}

const target = () => levelToGain(volume) * duck;

function start(key) {
  const old = current;
  if (old) fade(old.audio, 0, 1800, () => { old.audio.pause(); old.audio.src = ''; });
  const audio = new Audio(`assets/music/${key}.mp3`);
  audio.volume = 0;
  audio.addEventListener('ended', () => { if (current?.audio === audio) next(); });
  current = { key, audio };
  audio.play().then(() => fade(audio, target(), 1800)).catch(() => { /* blocked until a gesture */ });
  notify();
}

function next() {
  const list = MOODS[mood];
  if (!list) return;
  index = (index + 1) % list.length;
  start(list[index]);
}

/** Switch to a mood's playlist (no-op if it's already playing). */
export function setMood(m) {
  if (m === mood && current) return;
  mood = m;
  if (!enabled || !unlocked) { notify(); return; }
  const list = MOODS[m];
  if (!list) return;
  index = Math.floor(Math.random() * list.length);
  start(list[index]);
}

/** Play a one-off theme over a ducked mood (victory, defeat). */
export function stinger(key) {
  if (!enabled || !unlocked) return;
  stopStinger();
  duck = 0.15;
  if (current) fade(current.audio, target(), 600);
  const a = new Audio(`assets/music/${key}.mp3`);
  a.volume = stingerGain();
  stingerAudio = a;
  a.play().catch(() => {});
  a.addEventListener('ended', () => { if (stingerAudio === a) stingerAudio = null; duck = 1; if (current) fade(current.audio, target(), 1500); });
}
/** Stingers sit about 4 dB above the music (they are short), but follow the same slider. */
const stingerGain = () => Math.min(1, levelToGain(volume) * 1.6);
function stopStinger() {
  if (!stingerAudio) return;
  const a = stingerAudio; stingerAudio = null; fade(a, 0, 400, () => a.pause());
  duck = 1;
}

export function setEnabled(on) {
  enabled = !!on; store(KEY_ON, enabled ? '1' : '0');
  if (!enabled) stopStinger();
  if (!enabled && current) { const old = current; current = null; fade(old.audio, 0, 600, () => old.audio.pause()); }
  if (enabled && mood && unlocked) { const m = mood; mood = null; setMood(m); }
  notify();
}

export function setVolume(v) {
  volume = Math.min(1, Math.max(0, v)); store(KEY_LEVEL, volume);
  if (current) { clearInterval(current.audio._fade); current.audio.volume = target(); }
  if (stingerAudio) { clearInterval(stingerAudio._fade); stingerAudio.volume = stingerGain(); }
  notify();
}

// Wait for the first click or key press, then start whatever mood was requested.
function unlock() {
  if (unlocked) return;
  unlocked = true;
  window.removeEventListener('pointerdown', unlock); window.removeEventListener('keydown', unlock);
  if (enabled && mood) { const m = mood; mood = null; setMood(m); }
}
window.addEventListener('pointerdown', unlock); window.addEventListener('keydown', unlock);
