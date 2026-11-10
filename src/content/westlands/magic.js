/**
 * Spells and class abilities of the Westlands. Mechanics follow the 5e SRD 5.1 (CC-BY-4.0),
 * slightly simplified for the grid; descriptions are original. Magic is rare in this world:
 * only loremasters and minstrels are full casters; rangers and wardens learn a little from
 * level 2; warriors and burglars rely on trained abilities.
 *
 * Ranges are in squares (1 square = 5 ft). Shapes: 'single' target, 'radius' around the chosen
 * foe, 'cone' in front of you, 'around' you. time: action | bonus | reaction | free.
 */

const S = (o) => ({ kind: 'spell', time: 'action', concentration: false, ...o });
const A = (o) => ({ kind: 'ability', time: 'action', ...o });

export const SPELLS = [
  // ---- Cantrips (level 0): unlimited; damage grows at character levels 5, 11 and 17 ----
  S({ id: 'fire-bolt', name: 'Fire Bolt', level: 0, classes: ['loremaster'], range: 24, target: 'enemy', sound: 'spell-fire', color: '#ff8a3d',
    effect: { type: 'attack', dice: '1d10', damageType: 'fire', cantrip: true },
    desc: 'Hurl a mote of fire. Spell attack; 1d10 fire. More dice at levels 5, 11 and 17.' }),
  S({ id: 'vicious-mockery', name: 'Cutting Verse', level: 0, classes: ['minstrel'], range: 12, target: 'enemy', sound: 'spell-thunder', color: '#c9a0ff',
    effect: { type: 'save', save: 'wis', dice: '1d4', damageType: 'psychic', half: false, onFail: 'mock', cantrip: true },
    desc: 'A verse sharp enough to wound. WIS save or 1d4 psychic, and its next attack has disadvantage.' }),
  // ---- Level 1 ----
  S({ id: 'magic-missile', name: 'Darts of Light', level: 1, classes: ['loremaster'], range: 24, target: 'enemy', sound: 'spell-arcane', color: '#9ad7ff',
    effect: { type: 'darts', count: 3, dice: '1d4+1', damageType: 'force' }, upcast: { count: 1 },
    desc: 'Three glowing darts that never miss: 1d4+1 force each. One more dart per slot level above 1st.' }),
  S({ id: 'sleep', name: 'Sleep', level: 1, classes: ['loremaster', 'minstrel'], range: 18, target: 'point', sound: 'spell-arcane', color: '#b8a8ff',
    effect: { type: 'sleep', pool: '5d8', radius: 4 }, upcast: { pool: '2d8' },
    desc: 'Roll 5d8: creatures within 20 ft of the target fall asleep, weakest first, until their hit points use up the total. Sleepers wake when hurt.' }),
  S({ id: 'shield', name: 'Ward of Iron', level: 1, classes: ['loremaster'], time: 'reaction', range: 0, target: 'self', sound: 'spell-arcane', color: '#9ad7ff',
    effect: { type: 'buff', buff: 'shield', ac: 5, rounds: 1 },
    desc: 'An unseen barrier: +5 AC until the start of your next turn. Uses your reaction.' }),
  S({ id: 'burning-hands', name: 'Burning Hands', level: 1, classes: ['loremaster'], range: 0, target: 'cone', sound: 'spell-fire', color: '#ff7a2f',
    effect: { type: 'save', save: 'dex', dice: '3d6', damageType: 'fire', half: true, shape: 'cone', size: 3 }, upcast: { dice: '1d6' },
    desc: 'A fan of flame, 15 ft in front of you. DEX save: 3d6 fire, half on a success. +1d6 per slot level above 1st.' }),
  S({ id: 'thunderwave', name: 'Thunderclap', level: 1, classes: ['loremaster', 'minstrel'], range: 0, target: 'around', sound: 'spell-thunder', color: '#cfe3ff',
    effect: { type: 'save', save: 'con', dice: '2d8', damageType: 'thunder', half: true, shape: 'around', size: 1, onFail: 'push' }, upcast: { dice: '1d8' },
    desc: 'A wave of force from you. Each adjacent foe makes a CON save: 2d8 thunder and pushed 10 ft back, or half damage.' }),
  S({ id: 'cure-wounds', name: 'Cure Wounds', level: 1, classes: ['minstrel', 'warden', 'ranger'], range: 1, target: 'self', sound: 'spell-heal', color: '#8ef0a2',
    effect: { type: 'heal', dice: '1d8', addMod: true }, upcast: { dice: '1d8' },
    desc: 'Heal 1d8 + your spellcasting modifier. +1d8 per slot level above 1st.' }),
  S({ id: 'healing-word', name: 'Word of Healing', level: 1, classes: ['minstrel'], time: 'bonus', range: 12, target: 'self', sound: 'spell-heal', color: '#8ef0a2',
    effect: { type: 'heal', dice: '1d4', addMod: true }, upcast: { dice: '1d4' },
    desc: 'A quick word that mends: 1d4 + your modifier, as a bonus action. +1d4 per slot level above 1st.' }),
  S({ id: 'dissonant-whispers', name: 'Dread Whispers', level: 1, classes: ['minstrel'], range: 12, target: 'enemy', sound: 'spell-thunder', color: '#c9a0ff',
    effect: { type: 'save', save: 'wis', dice: '3d6', damageType: 'psychic', half: true, onFail: 'flee' }, upcast: { dice: '1d6' },
    desc: 'A whisper only the target hears. WIS save: 3d6 psychic and it flees from you in terror; half damage on a success.' }),
  S({ id: 'hunters-mark', name: 'Hunter\'s Mark', level: 1, classes: ['ranger'], time: 'bonus', range: 18, target: 'enemy', concentration: true, sound: 'spell-arcane', color: '#ffd166',
    effect: { type: 'mark', dice: '1d6' },
    desc: 'Mark your quarry: your weapon hits deal an extra 1d6 to it. Concentration.' }),
  S({ id: 'bless', name: 'Blessing of the West', level: 1, classes: ['warden'], range: 0, target: 'self', concentration: true, sound: 'spell-heal', color: '#ffe28a',
    effect: { type: 'buff', buff: 'bless', die: '1d4' },
    desc: 'Add 1d4 to your attack rolls and saving throws while it lasts. Concentration.' }),
  S({ id: 'shield-of-faith', name: 'Shield of Faith', level: 1, classes: ['warden'], time: 'bonus', range: 0, target: 'self', concentration: true, sound: 'spell-heal', color: '#ffe28a',
    effect: { type: 'buff', buff: 'faith', ac: 2 },
    desc: 'A shimmering field: +2 AC while it lasts. Concentration.' }),
  S({ id: 'wrathful-smite', name: 'Warden\'s Wrath', level: 1, classes: ['warden'], time: 'bonus', range: 0, target: 'self', sound: 'spell-heal', color: '#fff2b0',
    effect: { type: 'buff', buff: 'smite', dice: '2d8', damageType: 'radiant' }, upcast: { dice: '1d8' },
    desc: 'Your next melee hit blazes with light: +2d8 radiant (+1d8 per slot level above 1st).' }),
  S({ id: 'ensnaring-strike', name: 'Ensnaring Strike', level: 1, classes: ['ranger'], time: 'bonus', range: 0, target: 'self', sound: 'spell-arcane', color: '#7fd17f',
    effect: { type: 'buff', buff: 'ensnare' },
    desc: 'Your next weapon hit sprouts grasping thorns: STR save or the target is restrained (cannot move; attacks against it have advantage).' }),
  // ---- Level 2 ----
  S({ id: 'scorching-ray', name: 'Scorching Ray', level: 2, classes: ['loremaster'], range: 24, target: 'enemy', sound: 'spell-fire', color: '#ff6a2f',
    effect: { type: 'attack', dice: '2d6', damageType: 'fire', rays: 3 }, upcast: { rays: 1 },
    desc: 'Three rays of fire, each a spell attack for 2d6 fire. One more ray per slot level above 2nd.' }),
  S({ id: 'misty-step', name: 'Misty Step', level: 2, classes: ['loremaster', 'minstrel'], time: 'bonus', range: 6, target: 'square', sound: 'spell-arcane', color: '#cde',
    effect: { type: 'teleport' },
    desc: 'Vanish in silver mist and reappear on a visible free square up to 30 ft away. Bonus action.' }),
  S({ id: 'shatter', name: 'Shatter', level: 2, classes: ['loremaster', 'minstrel'], range: 12, target: 'point', sound: 'spell-thunder', color: '#cfe3ff',
    effect: { type: 'save', save: 'con', dice: '3d8', damageType: 'thunder', half: true, shape: 'radius', size: 2 }, upcast: { dice: '1d8' },
    desc: 'A painful ringing burst. CON save: 3d8 thunder to all within 10 ft of the target, half on a success.' }),
  S({ id: 'hold-person', name: 'Hold Person', level: 2, classes: ['loremaster', 'minstrel', 'warden'], range: 12, target: 'enemy', concentration: true, sound: 'spell-arcane', color: '#b8a8ff',
    effect: { type: 'save', save: 'wis', onFail: 'paralyze', humanoidOnly: true },
    desc: 'A humanoid makes a WIS save or is paralysed: it cannot act, attacks against it have advantage and melee hits are critical. It repeats the save each turn. Concentration.' }),
  S({ id: 'pass-without-trace', name: 'Pass without Trace', level: 2, classes: ['ranger'], range: 0, target: 'self', concentration: true, sound: 'spell-arcane', color: '#7fd17f',
    effect: { type: 'buff', buff: 'trace', stealth: 10 },
    desc: 'Shadows cling to you: +10 to Stealth checks. Concentration.' }),
  S({ id: 'heroism', name: 'Song of Heroes', level: 2, classes: ['minstrel', 'warden'], range: 0, target: 'self', concentration: true, sound: 'spell-heal', color: '#ffe28a',
    effect: { type: 'buff', buff: 'heroism', tempHpMod: true },
    desc: 'Courage floods you: you gain temporary hit points equal to your spellcasting modifier at the start of each of your turns. Concentration.' }),
  // ---- Level 3 ----
  S({ id: 'fireball', name: 'Fireball', level: 3, classes: ['loremaster'], range: 30, target: 'point', sound: 'spell-fire', color: '#ff5a1f',
    effect: { type: 'save', save: 'dex', dice: '8d6', damageType: 'fire', half: true, shape: 'radius', size: 4 }, upcast: { dice: '1d6' },
    desc: 'A bead of flame that blooms into a 20-ft blast. DEX save: 8d6 fire, half on a success. Careful: you are not immune.' }),
  S({ id: 'mass-healing-word', name: 'Chorus of Healing', level: 3, classes: ['minstrel'], time: 'bonus', range: 0, target: 'self', sound: 'spell-heal', color: '#8ef0a2',
    effect: { type: 'heal', dice: '2d4', addMod: true }, upcast: { dice: '1d4' },
    desc: 'A swelling chorus: heal 2d4 + your modifier as a bonus action.' }),
  S({ id: 'daylight', name: 'Daylight', level: 3, classes: ['warden', 'ranger', 'loremaster'], range: 0, target: 'self', sound: 'spell-heal', color: '#fff6c0',
    effect: { type: 'reveal', radius: 12 },
    desc: 'Sunlight fills the halls around you, revealing every trap and secret door within 60 ft.' }),
  // ---- Level 4-9 (for veteran heroes) ----
  S({ id: 'ice-storm', name: 'Ice Storm', level: 4, classes: ['loremaster'], range: 30, target: 'point', sound: 'spell-thunder', color: '#bfe8ff',
    effect: { type: 'save', save: 'dex', dice: '6d6', damageType: 'cold', half: true, shape: 'radius', size: 4 }, upcast: { dice: '1d6' },
    desc: 'Hail and freezing rain hammer a 20-ft area. DEX save: 6d6 cold and bludgeoning, half on a success.' }),
  S({ id: 'death-ward', name: 'Ward against Death', level: 4, classes: ['warden'], range: 0, target: 'self', sound: 'spell-heal', color: '#fff2b0',
    effect: { type: 'buff', buff: 'deathward' },
    desc: 'The first time you would drop to 0 hit points, you drop to 1 instead.' }),
  S({ id: 'cone-of-cold', name: 'Cone of Cold', level: 5, classes: ['loremaster'], range: 0, target: 'cone', sound: 'spell-thunder', color: '#bfe8ff',
    effect: { type: 'save', save: 'con', dice: '8d8', damageType: 'cold', half: true, shape: 'cone', size: 6 }, upcast: { dice: '1d8' },
    desc: 'A blast of killing cold, 30 ft in front of you. CON save: 8d8 cold, half on a success.' }),
  S({ id: 'mass-cure-wounds', name: 'Healing Tide', level: 5, classes: ['minstrel', 'warden'], range: 0, target: 'self', sound: 'spell-heal', color: '#8ef0a2',
    effect: { type: 'heal', dice: '3d8', addMod: true }, upcast: { dice: '1d8' },
    desc: 'A wave of restoring light: heal 3d8 + your modifier.' }),
  S({ id: 'disintegrate', name: 'Unmaking', level: 6, classes: ['loremaster'], range: 12, target: 'enemy', sound: 'spell-arcane', color: '#7dffb0',
    effect: { type: 'save', save: 'dex', dice: '10d6+40', damageType: 'force', half: false }, upcast: { dice: '3d6' },
    desc: 'A thin green ray. DEX save or take 10d6 + 40 force; nothing on a success.' }),
  S({ id: 'heal', name: 'Great Healing', level: 6, classes: ['minstrel'], range: 0, target: 'self', sound: 'spell-heal', color: '#8ef0a2',
    effect: { type: 'heal', flat: 70 }, upcast: { flat: 10 },
    desc: 'Restore 70 hit points.' }),
  S({ id: 'finger-of-death', name: 'Word of Ending', level: 7, classes: ['loremaster'], range: 12, target: 'enemy', sound: 'spell-thunder', color: '#5aff8a',
    effect: { type: 'save', save: 'con', dice: '7d8+30', damageType: 'necrotic', half: true },
    desc: 'A word that unmakes life. CON save: 7d8 + 30 necrotic, half on a success.' }),
  S({ id: 'sunburst', name: 'Sunburst', level: 8, classes: ['loremaster', 'minstrel'], range: 30, target: 'point', sound: 'spell-heal', color: '#fff2b0',
    effect: { type: 'save', save: 'con', dice: '12d6', damageType: 'radiant', half: true, shape: 'radius', size: 12 },
    desc: 'Blinding sunlight in a 60-ft radius. CON save: 12d6 radiant, half on a success.' }),
  S({ id: 'meteor-swarm', name: 'Fall of Stars', level: 9, classes: ['loremaster'], range: 60, target: 'point', sound: 'spell-fire', color: '#ff5a1f',
    effect: { type: 'save', save: 'dex', dice: '40d6', damageType: 'fire', half: true, shape: 'radius', size: 8 },
    desc: 'Burning stars crash down in a 40-ft radius. DEX save: 40d6 fire and bludgeoning, half on a success.' }),
];

/**
 * Class abilities. uses: a number or a function of level; per: 'short' (back after a short or
 * long rest) or 'long'. passive abilities have no button; the engine applies them.
 */
export const ABILITIES = [
  // Warrior
  A({ id: 'second-wind', name: 'Second Wind', class: 'warrior', minLevel: 1, time: 'bonus', uses: 1, per: 'short', sound: 'spell-heal',
    effect: { type: 'heal', dice: '1d10', addLevel: true }, desc: 'Catch your breath mid-fight: heal 1d10 + your level. Bonus action, once per short rest.' }),
  A({ id: 'action-surge', name: 'Action Surge', class: 'warrior', minLevel: 2, time: 'free', uses: (l) => (l >= 17 ? 2 : 1), per: 'short', sound: 'hero-low-attack',
    effect: { type: 'surge' }, desc: 'Push past your limits: take one more action this turn. Once per short rest (twice from level 17).' }),
  A({ id: 'extra-attack', name: 'Extra Attack', class: 'warrior', minLevel: 5, passive: true,
    desc: 'Attack twice when you take the Attack action (three times from level 11, four from level 20).' }),
  A({ id: 'indomitable', name: 'Indomitable', class: 'warrior', minLevel: 9, passive: true, desc: 'Once per rest, reroll a failed saving throw (applied automatically).' }),
  // Ranger
  A({ id: 'archery', name: 'Archery Style', class: 'ranger', minLevel: 2, passive: true, desc: '+2 to attack rolls with ranged weapons.' }),
  A({ id: 'ranger-extra-attack', name: 'Extra Attack', class: 'ranger', minLevel: 5, passive: true, desc: 'Attack twice when you take the Attack action.' }),
  // Burglar
  A({ id: 'sneak-attack', name: 'Sneak Attack', class: 'burglar', minLevel: 1, passive: true,
    desc: 'Once per turn, deal extra damage (1d6 at level 1, +1d6 every two levels) when you hit with a finesse or ranged weapon and have advantage.' }),
  A({ id: 'cunning-dash', name: 'Cunning Action: Dash', class: 'burglar', minLevel: 2, time: 'bonus', uses: Infinity, per: 'turn',
    effect: { type: 'dash' }, desc: 'Dash as a bonus action: double your movement this turn.' }),
  A({ id: 'cunning-disengage', name: 'Cunning Action: Disengage', class: 'burglar', minLevel: 2, time: 'bonus', uses: Infinity, per: 'turn',
    effect: { type: 'disengage' }, desc: 'Disengage as a bonus action: your movement provokes no opportunity attacks this turn.' }),
  A({ id: 'uncanny-dodge', name: 'Uncanny Dodge', class: 'burglar', minLevel: 5, passive: true, desc: 'When an attack hits you, use your reaction to halve its damage (automatic).' }),
  A({ id: 'evasion', name: 'Evasion', class: 'burglar', minLevel: 7, passive: true, desc: 'When a DEX save would halve damage (traps, fire), you take none on a success and half on a failure.' }),
  // Loremaster
  A({ id: 'words-of-command', name: 'Words of Command', class: 'loremaster', minLevel: 1, uses: (l) => (l >= 11 ? 4 : l >= 5 ? 3 : 2), per: 'long', range: 6, target: 'enemy', sound: 'spell-arcane',
    effect: { type: 'save', save: 'wis', onFail: 'stun' }, desc: 'Speak a word of power: a creature within 30 ft makes a WIS save or is stunned until the end of its next turn.' }),
  A({ id: 'arcane-recovery', name: 'Arcane Recovery', class: 'loremaster', minLevel: 1, time: 'free', uses: 1, per: 'long', outOfCombat: true, sound: 'spell-arcane',
    effect: { type: 'recover' }, desc: 'Out of combat, recover spent spell slots whose levels add up to half your level (rounded up). Once per long rest.' }),
  // Minstrel
  A({ id: 'song-of-heartening', name: 'Song of Heartening', class: 'minstrel', minLevel: 1, time: 'bonus', uses: (l, m) => Math.max(1, m.cha), per: (l) => (l >= 5 ? 'short' : 'long'), sound: 'spell-heal',
    effect: { type: 'inspire' }, desc: 'Gain an inspiration die (d6; d8 at 5, d10 at 10, d12 at 15) added to your next attack roll, check or save. Uses = CHA modifier; back on a short rest from level 5.' }),
  // Warden
  A({ id: 'healing-hands', name: 'Healing Hands', class: 'warden', minLevel: 1, uses: Infinity, per: 'long', sound: 'spell-heal',
    effect: { type: 'pool' }, desc: 'A pool of 5 × your level hit points, restored on a long rest. Use your action to heal yourself from it.' }),
  A({ id: 'warden-extra-attack', name: 'Extra Attack', class: 'warden', minLevel: 5, passive: true, desc: 'Attack twice when you take the Attack action.' }),
];

export const SPELLS_BY_ID = Object.fromEntries(SPELLS.map((s) => [s.id, s]));
export const ABILITIES_BY_ID = Object.fromEntries(ABILITIES.map((a) => [a.id, a]));
