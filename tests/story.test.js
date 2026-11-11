import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STORIES } from '../src/content/stories/index.js';
import { validateStory, startStory, choicesFor, choose, battleOver } from '../src/engine/story.js';
import { BESTIARY_BY_ID } from '../src/content/bestiary/index.js';
import { ITEMS_BY_ID } from '../src/content/items/catalogue.js';
import { SKILLS } from '../src/engine/skills.js';
import { TERRAINS } from '../src/engine/terrain.js';

const known = {
  creatures: new Set(Object.keys(BESTIARY_BY_ID)), items: new Set(Object.keys(ITEMS_BY_ID)),
  skills: new Set(SKILLS.map((s) => s.id)), terrains: new Set(Object.keys(TERRAINS)),
};

test('every story is sound: links, reachability, endings, creatures, items, skills', () => {
  for (const story of STORIES) assert.deepEqual(validateStory(story, known), [], story.id);
});

test('the validator catches broken stories', () => {
  const bad = {
    id: 'bad', title: 'Bad', start: 'a',
    scenes: {
      a: { text: 'A', choices: [{ text: 'go', to: 'nowhere' }, { text: 'look', check: { skill: 'staring', dc: 12 }, success: 'b', failure: 'b' }] },
      b: { text: 'B', battle: { foes: ['nobody'], win: 'c', lose: 'c' } },
      c: { text: 'C', choices: [{ text: 'again', to: 'c' }] },
      lost: { text: 'never', end: 'victory' },
    },
  };
  const issues = validateStory(bad, known).join('\n');
  for (const want of ['missing scene "nowhere"', 'unknown skill "staring"', 'unknown creature "nobody"', '"lost" can never be reached', '"c" can never reach an ending']) {
    assert.match(issues, new RegExp(want.replace(/[()]/g, '\\$&')));
  }
});

test('a story plays: flags open choices, checks branch, battles resolve', () => {
  const story = STORIES.find((s) => s.id === 'barrow-of-the-lost-king');
  let p = startStory(story);
  assert.equal(p.scene, 'downs');
  ({ progress: p } = choose(story, p, 0));
  assert.equal(p.scene, 'shepherd');
  ({ progress: p } = choose(story, p, 1));
  assert.ok(p.flags.includes('knows-name'));
  const pass = { rollCheck: () => ({ success: true, text: 'success' }) };
  const fail = { rollCheck: () => ({ success: false, text: 'failure' }) };
  ({ progress: p } = choose(story, p, 2)); // squeeze through
  assert.equal(p.scene, 'hall');
  assert.equal(choicesFor(story, p).length, 3, 'knowing the name opens a choice');
  const failed = choose(story, p, 0, fail);
  assert.equal(failed.progress.scene, 'hall-fight');
  ({ progress: p } = battleOver(story, failed.progress, true));
  assert.equal(p.scene, 'hall-won');
  const r = choose(story, p, 0, pass);
  assert.equal(r.progress.scene, 'tomb');
  const end = choose(story, r.progress, 1, pass);
  assert.equal(end.progress.ended, 'victory');
  assert.ok(end.effects.some((e) => e.xp));
});

test('without the flag the choice is hidden', () => {
  const story = STORIES[0];
  const p = { ...startStory(story), scene: 'hall' };
  assert.equal(choicesFor(story, p).length, 2);
  assert.throws(() => choose(story, p, 0));
});
