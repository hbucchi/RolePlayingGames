/**
 * Talking to creatures: parley, recruit, intimidate, taunt, mock, soothe.
 *
 * Every attempt is a CONTEST (5e "contested ability check"): the hero rolls d20 + a social skill
 * (Persuasion, Intimidation, Deception, Performance or Animal Handling) and the creature rolls
 * d20 + its Insight (its WIS modifier when it has no Insight skill) + its RESOLVE, a set of
 * modifiers for how unwilling it is. The hero must beat the creature's total; a tie keeps
 * things as they are (a failure). A natural 20 is a moment of real eloquence and adds +10,
 * so even a dragon can, very rarely, be talked round, while a goblin is far easier.
 *
 * Words need a shared language. Threats do not: you can intimidate without one, at disadvantage.
 */

/** How many times a creature will listen before it stops talking. */
export const PATIENCE = 2;

export const TALKS = {
  parley: { label: 'Parley', skill: 'persuasion', goal: 'calm', words: true, resolve: 0,
    desc: 'Talk it down: on a success it stops fighting and lets you be.' },
  recruit: { label: 'Recruit', skill: 'persuasion', goal: 'recruit', words: true, resolve: 10,
    desc: 'Win it over: on a success it fights beside you for the rest of this floor.' },
  intimidate: { label: 'Intimidate', skill: 'intimidation', goal: 'flee', words: false, resolve: 0,
    desc: 'Threaten it: on a success it is frightened and flees for 2 rounds.' },
  taunt: { label: 'Taunt', skill: 'deception', goal: 'taunt', words: true, resolve: -2,
    desc: 'Goad it: on a success it must come for you for 2 rounds, sparing your friends.' },
  mock: { label: 'Mock', skill: 'performance', goal: 'mock', words: true, resolve: -2,
    desc: 'Make a fool of it: on a success it has disadvantage on its next attack.' },
  soothe: { label: 'Soothe', skill: 'animal-handling', goal: 'calm', words: false, resolve: 2,
    desc: 'Calm a beast with a low voice and slow hands: on a success it stops fighting.' },
};

const SIZE_RANK = { Tiny: 0, Small: 1, Medium: 2, Large: 3, Huge: 4, Gargantuan: 5 };

/** Lower-case keywords for the languages a hero knows: "Elvish (Grey-tongue)" → "elvish". */
export function languageKeys(langs = []) {
  const keys = new Set();
  for (const l of langs) {
    const t = l.toLowerCase();
    if (t.includes('common')) keys.add('common');
    if (t.includes('elvish')) keys.add('elvish');
    if (t.includes('high-tongue')) keys.add('elder'); // the high elvish tongue is one of the elder tongues
    if (t.includes('dwarvish')) keys.add('dwarvish');
    if (t.includes('plains')) keys.add('plains');
    if (t.includes('dark tongue')) keys.add('dark tongue');
  }
  return keys;
}

/**
 * Which language (if any) the hero and the creature share. "Understands X but can't speak" still
 * counts, because talking at it is enough to persuade or goad it; "any languages" and "all"
 * mean Common is among them.
 */
export function sharedLanguage(heroLangs, stat) {
  const text = (stat.languages ?? '').toLowerCase();
  if (!text || text === '—' || text === '-') return null;
  const keys = languageKeys(heroLangs);
  if (/\b(all|any)\b/.test(text) && keys.has('common')) return 'Common Speech';
  const names = { common: 'Common Speech', elvish: 'Elvish', elder: 'the elder tongues', dwarvish: 'Dwarvish', plains: 'the Plains-tongue', 'dark tongue': 'the Dark Tongue' };
  for (const k of keys) if (text.includes(k)) return names[k];
  return null;
}

/** Mindless things (most undead and constructs, oozes) cannot be talked to at all. */
export function isMindless(stat) {
  return (stat.scores?.int ?? 10) <= 3 && stat.type !== 'beast'
    || (/can't speak|cannot speak/.test(stat.languages ?? '') && ['undead', 'construct', 'ooze'].includes(stat.type) && (stat.scores?.int ?? 10) <= 6);
}

/** Its Insight bonus (or WIS modifier): how hard it is to fool, charm or rattle. */
export const insightOf = (stat) => stat.skills?.insight ?? stat.mods?.wis ?? 0;

/**
 * RESOLVE: everything that makes a creature unwilling, as a list of [reason, modifier].
 *   alignment: evil +4, neutral +2 (good creatures are open to reason)
 *   already fighting you +2
 *   dragons are proud +4, fiends +6 (not for taunts and mockery: pride makes those easier, not harder)
 *   far stronger than you: + (its CR − your level), at most +6 (why bargain when it can just win?)
 *   much bigger than you: +2 per size step above Medium, for threats
 *   badly hurt (bloodied): −3, it wants to live
 *   outnumbered: −2
 */
export function resolveOf(stat, talkId, { heroLevel = 1, hostile = false, bloodied = false, outnumbered = false } = {}) {
  const t = TALKS[talkId];
  const parts = [];
  if (t.resolve) parts.push([t.label === 'Recruit' ? 'asking it to join you' : 'an easy provocation', t.resolve]);
  const al = (stat.alignment ?? '').toLowerCase();
  if (t.goal === 'calm' || t.goal === 'recruit') {
    if (al.includes('evil')) parts.push(['evil at heart', 4]);
    else if (al.includes('neutral') || al.includes('unaligned')) parts.push(['wary', 2]);
    if (hostile) parts.push(['already fighting you', 2]);
  }
  if (t.goal !== 'taunt' && t.goal !== 'mock') {
    if (stat.type === 'dragon') parts.push(['dragon pride', 4]);
    if (stat.type === 'fiend') parts.push(['fiendish malice', 6]);
  }
  if (t.goal !== 'taunt' && t.goal !== 'mock') {
    const gap = Math.min(6, Math.max(0, Math.floor((stat.crValue ?? 0) - heroLevel)));
    if (gap) parts.push(['far stronger than you', gap]);
  }
  if (t.goal === 'flee') {
    const big = Math.max(0, (SIZE_RANK[stat.size] ?? 2) - 2) * 2;
    if (big) parts.push(['towers over you', big]);
  }
  if (bloodied && t.goal !== 'taunt' && t.goal !== 'mock') parts.push(['badly hurt', -3]);
  if (outnumbered && t.goal !== 'taunt' && t.goal !== 'mock') parts.push(['outnumbered', -2]);
  return parts;
}

/**
 * Which talks this hero can try on this creature (at most 3), and why the others are closed.
 * A beast can only be soothed or scared; a creature with no shared language can only be scared.
 */
export function talkOptions(stat, { languages = [], skills = {} } = {}) {
  if (isMindless(stat)) return { options: [], why: 'It has no mind to reach: words are wasted on it.' };
  const frightImmune = (stat.conditionImmune ?? []).some((c) => /frighten/i.test(c));
  const scare = frightImmune ? [] : ['intimidate'];
  if (stat.type === 'beast' || (stat.scores?.int ?? 10) <= 3) return { options: ['soothe', ...scare], lang: null, why: 'A beast: it understands tone, not words.' };
  const lang = sharedLanguage(languages, stat);
  if (!lang) return { options: scare, lang: null, why: `You share no language (it speaks ${stat.languages}). Only threats need no words.` };
  // Goad it with whichever of your tongues is sharper: lies (Deception) or wit (Performance).
  const goad = (skills.performance ?? 0) > (skills.deception ?? 0) ? 'mock' : 'taunt';
  const third = (skills.intimidation ?? -9) >= Math.max(skills.performance ?? -9, skills.deception ?? -9) && scare.length ? 'intimidate' : goad;
  return { options: ['parley', 'recruit', third], lang };
}

/**
 * The exact chance that d20 + heroBonus (adding +10 on a natural 20) beats d20 + targetBonus.
 * mode 'disadvantage' rolls the hero's die twice and keeps the lower.
 * There are only 20 × 20 equally likely pairs of dice, so we simply count the winning ones.
 */
export function contestChance(heroBonus, targetBonus, mode = 'normal') {
  // Probability of each hero die face: plain 1/20; with disadvantage P(min = k) = ((21-k)² − (20-k)²) / 400.
  const pFace = (k) => (mode === 'disadvantage' ? ((21 - k) ** 2 - (20 - k) ** 2) / 400
    : mode === 'advantage' ? (k ** 2 - (k - 1) ** 2) / 400 : 1 / 20);
  let p = 0;
  for (let h = 1; h <= 20; h++) {
    const total = h + heroBonus + (h === 20 ? 10 : 0);
    let wins = 0;
    for (let t = 1; t <= 20; t++) if (total > t + targetBonus) wins++;
    p += pFace(h) * (wins / 20);
  }
  return p;
}

/** Roll the contest. rng(n) returns 0..n-1. */
export function rollTalk({ heroBonus, targetBonus, mode = 'normal', rng }) {
  const d = () => rng(20) + 1;
  const h1 = d(); const h2 = mode === 'normal' ? h1 : d();
  const hero = mode === 'disadvantage' ? Math.min(h1, h2) : mode === 'advantage' ? Math.max(h1, h2) : h1;
  const t = d();
  const heroTotal = hero + heroBonus + (hero === 20 ? 10 : 0);
  const targetTotal = t + targetBonus;
  return { heroDice: mode === 'normal' ? [h1] : [h1, h2], hero, t, heroTotal, targetTotal, ok: heroTotal > targetTotal, nat20: hero === 20, nat1: hero === 1 };
}
