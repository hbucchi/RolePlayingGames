/**
 * Portraits and their look. Images were generated with ElevenLabs from each character's
 * description; every portrait has 4 variations. A hero's look is stored as choices
 * (which portrait, which variation, a style preset, a hue shift, a frame colour, a voice),
 * so it can be changed at any time without new images.
 */

export const PORTRAIT_VARIANTS = 4;
export const portraitUrl = (key, n = 1) => `assets/portraits/${key}-${n}.jpg`;

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

/** Monster portraits by bestiary id (more to come). */
export const MONSTER_PORTRAITS = {
  goblin: 'goblin', 'pit-runt': 'pit-runt', 'dark-wood-spiderling': 'spiderling', 'crag-bat': 'crag-bat',
  ...Object.fromEntries([
    'mountain-goblin', 'wolf', 'skeleton', 'giant-wolf-spider', 'black-pit-orc', 'orc-tracker', 'worg', 'dire-wolf',
    'giant-spider', 'shadow-wolf', 'sun-hardened-great-orc', 'hollow-hill-lurker', 'great-goblin-of-the-mountain-halls', 'wight',
    'weaver-of-the-nightwood', 'hill-troll', 'orc-captain', 'cairn-wight', 'stone-troll', 'snow-troll', 'shadow-wolf-chieftain',
    'herald-of-the-dark-tower', 'cave-troll', 'spirit-wolf-of-the-shadow', 'shadow-bred-war-troll', 'hooded-rider-of-the-shadow',
    'fallen-loremaster', 'dread-sovereign-of-the-hooded-riders',
  ].map((id) => [id, id])),
  orc: 'orc', ogre: 'ogre', 'shadowflame-tyrant': 'shadowflame-tyrant', balor: 'shadowflame-tyrant', 'winter-wolf': 'winter-wolf',
  'captive-princess': 'captive-princess', 'test-dragon': 'red-dragon',
  // Dragons share a few paintings by colour and age.
  'young-fire-drake': 'red-dragon', 'ember-wyrm': 'red-dragon', 'grey-ice-drake': 'white-dragon', pseudodragon: 'dragon-wyrmling',
  ...Object.fromEntries(['black', 'blue', 'brass', 'bronze', 'copper', 'gold', 'green', 'red', 'silver', 'white'].flatMap((c) => {
    const art = { white: 'white-dragon', silver: 'white-dragon', green: 'green-dragon', black: 'green-dragon', blue: 'white-dragon' }[c] ?? 'red-dragon';
    return [[`wyrmling-${c}-dragon`, 'dragon-wyrmling'], [`young-${c}-dragon`, art], [`adult-${c}-dragon`, art], [`ancient-${c}-dragon`, art]];
  })),
};
/**
 * Bodies seen from above (top-down sprites on transparent backgrounds), drawn on the map instead
 * of round tokens when the player picks "Bodies". Each faces north (head toward the top) and is
 * turned to the creature's facing. Heroes get the body of their kindred.
 */
export const BODIES = {
  'men-west': 'body-man', 'men-plains': 'body-man', dwarf: 'body-dwarf', halfling: 'body-halfling', elf: 'body-elf',
  goblin: 'body-goblin', 'mountain-goblin': 'body-goblin', 'pit-runt': 'body-goblin-archer',
  'test-dragon': 'body-test-dragon',
  // Trolls, ogres, witches, sorcerers, the dead, vampires and demons.
  troll: 'body-troll', 'hill-troll': 'body-troll', 'cave-troll': 'body-troll', 'shadow-bred-war-troll': 'body-troll',
  'stone-troll': 'body-troll', 'snow-troll': 'body-troll',
  ogre: 'body-ogre', 'ogre-zombie': 'body-ogre',
  'green-hag': 'body-witch', 'sea-hag': 'body-witch', 'night-hag': 'body-witch',
  mage: 'body-sorcerer', archmage: 'body-sorcerer', 'fallen-loremaster': 'body-sorcerer',
  cultist: 'body-necromancer', 'cult-fanatic': 'body-necromancer', 'herald-of-the-dark-tower': 'body-necromancer', lich: 'body-necromancer',
  skeleton: 'body-skeleton',
  vampire: 'body-vampire', 'vampire-spawn': 'body-vampire',
  glabrezu: 'body-demon', hezrou: 'body-demon', vrock: 'body-demon', nalfeshnee: 'body-demon', 'pit-fiend': 'body-demon',
  'horned-devil': 'body-demon', 'barbed-devil': 'body-demon', 'bone-devil': 'body-demon', 'ice-devil': 'body-demon', marilith: 'body-demon',
  'shadowflame-tyrant': 'body-balrog', balor: 'body-balrog',
  // Every dragon by colour, at every age (wings folded: long bodies), and their kin.
  ...Object.fromEntries(['black', 'blue', 'brass', 'bronze', 'copper', 'gold', 'green', 'red', 'silver', 'white'].flatMap((c) =>
    ['wyrmling', 'young', 'adult', 'ancient'].map((age) => [`${age}-${c}-dragon`, `body-dragon-${c}`]))),
  'young-fire-drake': 'body-dragon-red', 'ember-wyrm': 'body-dragon-gold', 'grey-ice-drake': 'body-dragon-white',
  'long-worm-of-the-burning-fens': 'body-dragon-green', pseudodragon: 'body-dragon-red',
  wyvern: 'body-dragon-bronze', 'dragon-turtle': 'body-dragon-green', // stand-ins until they get bodies of their own
  // The rest of the dungeon dwellers (everything in the first twenty floors has a body).
  'dark-wood-spiderling': 'body-spider', 'giant-wolf-spider': 'body-spider', 'giant-spider': 'body-spider', 'weaver-of-the-nightwood': 'body-spider',
  'crag-bat': 'body-bat',
  wolf: 'body-wolf', worg: 'body-wolf', 'dire-wolf': 'body-wolf', 'shadow-wolf': 'body-wolf', 'shadow-wolf-chieftain': 'body-wolf',
  'spirit-wolf-of-the-shadow': 'body-wolf', 'winter-wolf': 'body-wolf',
  orc: 'body-orc', 'black-pit-orc': 'body-orc', 'orc-tracker': 'body-orc', 'sun-hardened-great-orc': 'body-orc', 'orc-captain': 'body-orc-captain',
  'great-goblin-of-the-mountain-halls': 'body-goblin',
  'hollow-hill-lurker': 'body-lurker',
  wight: 'body-wight', 'cairn-wight': 'body-wight',
  'hooded-rider-of-the-shadow': 'body-wraith', 'dread-sovereign-of-the-hooded-riders': 'body-wraith',
};
/** Colour shifts so one body serves several kinds (a grey stone troll, a pale snow troll...). */
export const BODY_TINT = {
  'stone-troll': 'grayscale(0.85) brightness(0.95)', 'snow-troll': 'grayscale(0.7) brightness(1.35)', 'cave-troll': 'brightness(0.8) saturate(0.7)',
  'shadow-bred-war-troll': 'brightness(0.6) contrast(1.2)', 'ogre-zombie': 'grayscale(0.6) hue-rotate(60deg) brightness(0.85)',
  'sea-hag': 'hue-rotate(60deg)', 'night-hag': 'hue-rotate(200deg) brightness(0.8)',
  archmage: 'hue-rotate(60deg) saturate(1.3)', 'fallen-loremaster': 'grayscale(0.5) brightness(0.8)',
  'cult-fanatic': 'sepia(0.4) hue-rotate(-30deg)', lich: 'grayscale(0.4) brightness(1.1)', 'vampire-spawn': 'grayscale(0.4)',
  hezrou: 'hue-rotate(80deg) saturate(0.8)', vrock: 'grayscale(0.6) brightness(0.9)', 'ice-devil': 'hue-rotate(180deg) saturate(0.7) brightness(1.2)',
  'bone-devil': 'grayscale(0.8) brightness(1.2)', 'pit-fiend': 'saturate(1.3) brightness(0.9)',
  'ember-wyrm': 'saturate(1.4) hue-rotate(-15deg)', wyvern: 'sepia(0.6) brightness(0.8)', 'dragon-turtle': 'hue-rotate(40deg) brightness(0.8)', 'grey-ice-drake': 'grayscale(0.6) brightness(0.9)', 'long-worm-of-the-burning-fens': 'sepia(0.5) hue-rotate(-20deg)',
  'dark-wood-spiderling': 'sepia(0.5) brightness(1.1)', 'giant-wolf-spider': 'sepia(0.8) saturate(1.3) brightness(1.15)', 'weaver-of-the-nightwood': 'brightness(0.7) contrast(1.3)',
  worg: 'sepia(0.6) brightness(0.75)', 'dire-wolf': 'brightness(0.7)', 'shadow-wolf': 'brightness(0.45) contrast(1.3)', 'shadow-wolf-chieftain': 'grayscale(1) brightness(1.15)',
  'spirit-wolf-of-the-shadow': 'brightness(0.35) contrast(1.5) drop-shadow(0 0 6px #6a0dad)', 'winter-wolf': 'grayscale(1) brightness(1.6)',
  'orc-tracker': 'sepia(0.6) brightness(0.95)', 'sun-hardened-great-orc': 'brightness(1.1) contrast(1.1)', orc: 'hue-rotate(40deg) saturate(1.3)',
  'great-goblin-of-the-mountain-halls': 'saturate(0.7) brightness(0.9)', 'cairn-wight': 'grayscale(0.6) brightness(0.8)',
  'dread-sovereign-of-the-hooded-riders': 'contrast(1.3) drop-shadow(0 0 5px #b8c4ff)',
};
export const bodyUrl = (key) => (BODIES[key] ? `assets/bodies/${BODIES[key]}.png` : null);

export const monsterPortrait = (statId, n = 1) => (MONSTER_PORTRAITS[statId] ? portraitUrl(MONSTER_PORTRAITS[statId], n) : null);

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
