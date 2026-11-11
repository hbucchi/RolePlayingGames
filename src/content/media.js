import { packed } from './asset-pack.js';
import { BESTIARY_BY_ID } from './bestiary/index.js';
/**
 * Portraits and their look. Images were generated with ElevenLabs from each character's
 * description; every portrait has 4 variations. A hero's look is stored as choices
 * (which portrait, which variation, a style preset, a hue shift, a frame colour, a voice),
 * so it can be changed at any time without new images.
 */

export const PORTRAIT_VARIANTS = 4;
export const portraitUrl = (key, n = 1) => packed(`assets/portraits/${key}-${n}.jpg`);

export const PORTRAITS = {
  halric: 'Halric Greyfell', brannoc: 'Brannoc Ironbrow', pippa: 'Pippa Underhedge', lirien: 'Lírien of the Wood',
  'kin-men-west': 'Men of the West', 'kin-men-plains': 'Riders of the Plains', 'kin-elf': 'Elves',
  'kin-dwarf': 'Dwarves', 'kin-halfling': 'Halflings',
};

const PREMADE = {
  'premade-halric': { portrait: 'halric', voice: 'low' },
  'premade-brannoc': { portrait: 'brannoc', voice: 'low' },
  'premade-pippa': { portrait: 'pippa', voice: 'high' },
  'premade-lirien': { portrait: 'lirien', voice: 'high' },
};
const KINDRED = { 'men-west': 'kin-men-west', 'men-plains': 'kin-men-plains', elf: 'kin-elf', dwarf: 'kin-dwarf', halfling: 'kin-halfling' };

/**
 * Creatures carry their own look in their bestiary record (`art` and `voice`, see the bestiary
 * files): art.portrait is a painting in assets/portraits, art.body a top-down figure in
 * assets/bodies, art.tint / art.portraitTint CSS filters that let kin share one picture.
 * Heroes' bodies come from their kindred.
 */
const HERO_BODIES = { 'men-west': 'body-man', 'men-plains': 'body-man', dwarf: 'body-dwarf', halfling: 'body-halfling', elf: 'body-elf' };
const artOf = (statId) => BESTIARY_BY_ID[statId]?.art ?? {};
const bodyKey = (key) => HERO_BODIES[key] ?? artOf(key).body;

/** Bodies whose picture includes a long weapon (spear, bow) are drawn larger, so the figure itself fills its square. */
export const BODY_SCALE = { 'body-amazon-spear': 1.55, 'body-amazon-queen': 1.5, 'body-amazon-archer': 1.35, 'body-amazon-huntress': 1.2, 'body-sorcerer': 1.15, 'body-necromancer': 1.15 };
export const bodyScale = (key) => BODY_SCALE[bodyKey(key)] ?? 1;
/** Body for a hero's kindred or a creature id (null when there is none: a round token is drawn). */
export const bodyUrl = (key) => (bodyKey(key) ? packed(`assets/bodies/${bodyKey(key)}.png`) : null);
export const bodyTint = (statId) => artOf(statId).tint || 'none';
export const portraitTint = (statId) => artOf(statId).portraitTint || 'none';
export const monsterPortrait = (statId, n = 1) => (artOf(statId).portrait ? portraitUrl(artOf(statId).portrait, n) : null);

/** Style presets are CSS filter chains applied on top of the painting. */
export const STYLES = {
  painted: { label: 'Painted', filter: '' },
  vivid: { label: 'Vivid', filter: 'saturate(1.45) contrast(1.08)' },
  ember: { label: 'Ember', filter: 'sepia(0.35) saturate(1.5) hue-rotate(-12deg) contrast(1.05)' },
  twilight: { label: 'Twilight', filter: 'saturate(0.8) hue-rotate(190deg) brightness(0.95)' },
  sepia: { label: 'Old parchment', filter: 'sepia(0.85) contrast(1.05) brightness(1.02)' },
  ink: { label: 'Ink sketch', filter: 'grayscale(1) contrast(1.6) brightness(1.1)' },
  noir: { label: 'Shadow', filter: 'grayscale(1) contrast(1.25) brightness(0.85)' },
};

export const FRAMES = {
  gold: '#c9a227', silver: '#b9c0ca', bronze: '#b0703c', crimson: '#a3271b', emerald: '#2f8a57', sapphire: '#2e5fa8', obsidian: '#2a2522',
};

export const VOICES = { low: 'Lower voice', high: 'Higher voice' };

/** The look a hero gets until the player changes it. */
export function defaultAppearance(draft) {
  const p = PREMADE[draft.id] ?? PREMADE[draft.premadeOf];
  return {
    portrait: p?.portrait ?? KINDRED[draft.raceId] ?? 'kin-men-west',
    variant: 1,
    style: 'painted',
    hue: 0,
    frame: 'gold',
    voice: p?.voice ?? 'low',
  };
}

/** Fill in any missing appearance fields (older saves have none). */
export function resolveAppearance(draft) {
  const base = defaultAppearance(draft);
  const a = { ...base, ...(draft.appearance ?? {}) };
  if (!PORTRAITS[a.portrait]) a.portrait = base.portrait;
  if (!STYLES[a.style]) a.style = 'painted';
  if (!FRAMES[a.frame]) a.frame = 'gold';
  if (!VOICES[a.voice]) a.voice = base.voice;
  a.variant = Math.min(PORTRAIT_VARIANTS, Math.max(1, Number(a.variant) || 1));
  a.hue = Math.max(-180, Math.min(180, Number(a.hue) || 0));
  return a;
}

export function appearanceFilter(a) {
  return [STYLES[a.style]?.filter, a.hue ? `hue-rotate(${a.hue}deg)` : ''].filter(Boolean).join(' ') || 'none';
}

/** Everything the UI needs to draw a hero's portrait. */
export function heroLook(draft) {
  const a = resolveAppearance(draft);
  return { ...a, url: portraitUrl(a.portrait, a.variant), filter: appearanceFilter(a), frameColor: FRAMES[a.frame] };
}
