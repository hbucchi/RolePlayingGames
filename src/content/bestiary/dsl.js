/**
 * Tiny helpers for writing monster data compactly.
 *
 * Game mechanics (numbers) of the SRD creatures come from the System Reference Document 5.1
 * by Wizards of the Coast, licensed under CC-BY-4.0. All descriptive text (traits wording,
 * personalities, origins, tactics) in this project is original.
 */

/** Parse "2d6+3 slashing" or ["2d6+3 slashing", "1d6 fire"] into damage parts. */
function dmg(spec) {
  const list = Array.isArray(spec) ? spec : [spec];
  return list.filter(Boolean).map((s) => {
    const [dice, ...type] = s.trim().split(/\s+/);
    return { dice, type: type.join(' ') };
  });
}

/** Melee weapon attack. */
export const mw = (name, toHit, reach, damage, extra, opts = {}) => ({
  name, ...opts, attack: { kind: 'mw', toHit, reach, damage: dmg(damage), extra, targets: opts.targets },
});
/** Ranged weapon attack. range like "80/320". */
export const rw = (name, toHit, range, damage, extra, opts = {}) => ({
  name, ...opts, attack: { kind: 'rw', toHit, range, damage: dmg(damage), extra, targets: opts.targets },
});
/** Melee or ranged (thrown) weapon attack. */
export const mrw = (name, toHit, reach, range, damage, extra, opts = {}) => ({
  name, ...opts, attack: { kind: 'mrw', toHit, reach, range, damage: dmg(damage), extra, targets: opts.targets },
});
/** Melee / ranged spell attacks. */
export const ms = (name, toHit, reach, damage, extra, opts = {}) => ({
  name, ...opts, attack: { kind: 'ms', toHit, reach, damage: dmg(damage), extra, targets: opts.targets },
});
export const rs = (name, toHit, range, damage, extra, opts = {}) => ({
  name, ...opts, attack: { kind: 'rs', toHit, range, damage: dmg(damage), extra, targets: opts.targets },
});

/** Any other action / trait / reaction: name + text. opts: { recharge: '5-6', uses: '3/Day', cost } */
export const act = (name, text, opts = {}) => ({ name, text, ...opts });
export const trait = act;

export const multi = (text) => act('Multiattack', text);

/**
 * Spellcasting block.
 *   kind 'slots':  { ability, dc, toHit, level, slots: {1:4, 2:3}, spells: {0:[...], 1:[...]} }
 *   kind 'innate': { ability, dc, toHit, atWill: [...], perDay: { 3: [...], 1: [...] } }
 */
export const spells = (o) => ({ kind: o.perDay || o.atWill ? 'innate' : 'slots', ...o });

export const lore = (personality, origin, tactics) => ({ personality, origin, tactics });

/** Common trait shortcuts. */
export const T = {
  keenSmell: act('Keen Smell', 'Has advantage on Wisdom (Perception) checks that rely on smell.'),
  keenHearingSmell: act('Keen Hearing and Smell', 'Has advantage on Wisdom (Perception) checks that rely on hearing or smell.'),
  keenSight: act('Keen Sight', 'Has advantage on Wisdom (Perception) checks that rely on sight.'),
  keenHearingSight: act('Keen Hearing and Sight', 'Has advantage on Wisdom (Perception) checks that rely on hearing or sight.'),
  packTactics: act('Pack Tactics', 'Has advantage on attack rolls against a creature if at least one of its allies is within 5 feet of that creature and isn\'t incapacitated.'),
  sunlight: act('Sunlight Sensitivity', 'While in sunlight, has disadvantage on attack rolls and on Wisdom (Perception) checks that rely on sight.'),
  amphibious: act('Amphibious', 'Can breathe air and water.'),
  holdBreath: (mins) => act('Hold Breath', `Can hold its breath for ${mins} minutes.`),
  waterBreathing: act('Water Breathing', 'Can breathe only underwater.'),
  spiderClimb: act('Spider Climb', 'Can climb difficult surfaces, including upside down on ceilings, without needing an ability check.'),
  magicResistance: act('Magic Resistance', 'Has advantage on saving throws against spells and other magical effects.'),
  echolocation: act('Echolocation', 'Can\'t use its blindsight while deafened.'),
  flyby: act('Flyby', 'Doesn\'t provoke opportunity attacks when it flies out of an enemy\'s reach.'),
  undeadFort: act('Undead Fortitude', 'If damage reduces it to 0 hit points, it makes a Constitution saving throw with DC 5 + the damage taken, unless the damage is radiant or from a critical hit. On a success, it drops to 1 hit point instead.'),
  falseAppearance: (what) => act('False Appearance', `While it remains motionless, it is indistinguishable from ${what}.`),
  swarm: (size) => act('Swarm', `The swarm can occupy another creature's space and vice versa, and can move through any opening large enough for a ${size} creature. It can't regain hit points or gain temporary hit points.`),
  magicWeapons: act('Magic Weapons', 'Its weapon attacks are magical.'),
  legendaryResistance: (n) => act(`Legendary Resistance (${n}/Day)`, 'If it fails a saving throw, it can choose to succeed instead.'),
  turnResistance: act('Turn Resistance', 'Has advantage on saving throws against any effect that turns undead.'),
  incorporeal: act('Incorporeal Movement', 'Can move through other creatures and objects as if they were difficult terrain. It takes 5 (1d10) force damage if it ends its turn inside an object.'),
  aggressive: act('Aggressive', 'As a bonus action, it can move up to its speed toward a hostile creature that it can see.'),
  devilSight: act('Devil\'s Sight', 'Magical darkness doesn\'t impede its darkvision.'),
  immutableForm: act('Immutable Form', 'Is immune to any spell or effect that would alter its form.'),
  charge: (dist, dice, type, dc, effect) => act('Charge', `If it moves at least ${dist} feet straight toward a target and then hits it with an attack on the same turn, the target takes an extra ${dice} ${type} damage. ${effect ? `${effect} (DC ${dc}).` : ''}`.trim()),
  mimicry: (what) => act('Mimicry', `Can mimic ${what}. A creature that hears the sounds can tell they are imitations with a successful DC 10 Wisdom (Insight) check.`),
};
