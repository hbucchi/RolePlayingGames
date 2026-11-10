import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sharedLanguage, talkOptions, resolveOf, insightOf, contestChance, rollTalk, isMindless } from '../src/engine/talk.js';
import { attackOptions, immobile, conditionLabels, canWrestle, escapeBonus } from '../src/engine/combat.js';
import { BESTIARY_BY_ID as B } from '../src/content/bestiary/index.js';
import { seededRng } from '../src/engine/dice.js';

const hero = { languages: ['Common Speech', 'Elvish (Grey-tongue)'], skills: { persuasion: 5, intimidation: 1, deception: 3, performance: 0 } };
const total = (stat, id, ctx) => insightOf(stat) + resolveOf(stat, id, ctx).reduce((t, [, v]) => t + v, 0);

test('a shared language is needed to talk; beasts are soothed; the mindless cannot be reached', () => {
  assert.equal(sharedLanguage(hero.languages, B.orc), 'Common Speech');
  assert.equal(sharedLanguage(['Dwarvish (secret tongue)'], B.orc), null);
  assert.equal(sharedLanguage(hero.languages, B['shadowflame-tyrant']), null);
  assert.equal(sharedLanguage(['Common Speech', 'Elvish (High-tongue)'], B['shadowflame-tyrant']), 'the elder tongues');
  assert.deepEqual(talkOptions(B.orc, hero).options, ['parley', 'recruit', 'taunt']);
  assert.deepEqual(talkOptions(B.orc, { languages: ['Dwarvish'], skills: {} }).options, ['intimidate']);
  assert.deepEqual(talkOptions(B.wolf, hero).options, ['soothe', 'intimidate']);
  assert.ok(isMindless(B.skeleton));
  assert.equal(talkOptions(B.skeleton, hero).options.length, 0);
});

test('contest maths: exact counting, natural 20 keeps hope alive', () => {
  // Equal bonuses: P(hero > target) = 190/400 without the nat-20 bonus; with it a little more.
  assert.ok(Math.abs(contestChance(0, 0) - (190 + 1) / 400) < 1e-9); // the nat 20 also wins when the target rolled 20
  assert.ok(contestChance(5, 0) > contestChance(0, 0));
  assert.ok(contestChance(0, 0, 'disadvantage') < contestChance(0, 0));
  assert.ok(contestChance(0, 40) === 0); // beyond even a natural 20 (+10)
  const r = rollTalk({ heroBonus: 5, targetBonus: 3, rng: seededRng(1) });
  assert.equal(r.ok, r.heroTotal > r.targetTotal);
});

test('recruiting an orc is very hard, a dragon harder still, but neither impossible', () => {
  const ctx = { heroLevel: 5, hostile: true };
  const orc = contestChance(hero.skills.persuasion, total(B.orc, 'recruit', ctx));
  const dragon = contestChance(hero.skills.persuasion, total(B['adult-red-dragon'], 'recruit', ctx));
  const parleyOrc = contestChance(hero.skills.persuasion, total(B.orc, 'parley', ctx));
  assert.ok(orc > 0.03 && orc < 0.15, `orc ${orc}`);
  assert.ok(dragon > 0 && dragon < orc / 2, `dragon ${dragon}`);
  assert.ok(parleyOrc > orc * 2, `parley ${parleyOrc}`);
  // Bloodied and outnumbered foes listen more readily.
  assert.ok(total(B.orc, 'parley', { ...ctx, bloodied: true, outnumbered: true }) === total(B.orc, 'parley', ctx) - 5);
});

test('position effects: bound and prone change the odds; big creatures cannot be shoved', () => {
  const w = { name: 'Sword', toHit: 5, melee: true, reach: 1 };
  const a = { pos: { x: 1, y: 1 }, size: 1, cond: {} };
  const t = { pos: { x: 2, y: 1 }, size: 1, ac: 14, facing: 6, aware: true, cond: { bound: { to: 'wall' } } };
  const o = attackOptions({ attacker: a, target: t, weapon: w, opaque: () => false, occupied: new Set(), enemiesOf: () => [] });
  assert.equal(o.mode, 'advantage');
  assert.ok(immobile(t));
  assert.deepEqual(conditionLabels(t), ['chained to the wall']);
  const prone = { ...t, cond: { prone: true } };
  const shot = { name: 'Bow', toHit: 5, ranged: true, normal: 16, long: 64 };
  const far = { ...prone, pos: { x: 6, y: 1 } };
  assert.equal(attackOptions({ attacker: a, target: far, weapon: shot, opaque: () => false, occupied: new Set(), enemiesOf: () => [] }).mode, 'disadvantage');
  assert.ok(canWrestle(B.ogre) && !canWrestle(B['adult-red-dragon']));
  assert.equal(escapeBonus(B.goblin), 2); // goblin: Acrobatics (DEX +2) beats Athletics (STR −1)
});
