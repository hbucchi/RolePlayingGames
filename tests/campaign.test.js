import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CAMPAIGNS } from '../src/content/campaigns/index.js';
import { validateCampaign, newRun, travel, route, npcView, npcChoose, locationEvent, journal, questDone, parseLocation } from '../src/engine/campaign.js';
import { BESTIARY_BY_ID } from '../src/content/bestiary/index.js';
import { ITEMS_BY_ID } from '../src/content/items/catalogue.js';
import { STORIES_BY_ID } from '../src/content/stories/index.js';
import { CODE, decodeArena, standable } from '../src/engine/terrain.js';

const known = {
  creatures: new Set(Object.keys(BESTIARY_BY_ID)), items: new Set(Object.keys(ITEMS_BY_ID)), stories: new Set(Object.keys(STORIES_BY_ID)),
  codes: new Set(Object.values(CODE)), codeOf: (t) => CODE[t] ?? '?',
};

test('every campaign is sound: places, roads, maps, people, items, flags', () => {
  for (const c of CAMPAIGNS) assert.deepEqual(validateCampaign(c, known), [], c.id);
});

test('everyone and everything on a location map stands on open ground inside the walls', () => {
  for (const c of CAMPAIGNS) {
    for (const [id, loc] of Object.entries(c.locations)) {
      if (loc.story) continue;
      const p = parseLocation(loc, known.codeOf);
      const map = decodeArena(p.terrainRows);
      for (const at of [...p.heroes, ...p.exits, ...p.npcs.map((n) => n.pos), ...p.foes.map((f) => f.pos), ...p.chests.map((ch) => ch.pos)]) {
        assert.ok(standable(map, at.x, at.y), `${id}: something stands in a wall at ${at.x},${at.y}`);
      }
    }
  }
});

test('the Steward signet quest can be played from the inn to the reward', () => {
  const c = CAMPAIGNS.find((x) => x.id === 'ashford');
  let run = newRun(c);
  assert.equal(run.at, 'tavern');
  assert.deepEqual(run.discovered.sort(), ['tavern', 'town']);
  assert.equal(route(c, run, 'palace'), null, 'the Hall is not known yet');
  const talk = (npc, label, wallet = { coins: 1000, has: () => false }) => {
    const v = npcView(c, run, npc, wallet); const o = v.options.find((x) => x.label.startsWith(label));
    assert.ok(o, `${npc} offers "${label}"`);
    const r = npcChoose(c, run, npc, o.i, wallet); run = r.run; return r;
  };
  talk('maudie', 'Ask about the Steward');
  assert.equal(journal(c, run).find((s) => s.state === 'current').id, 'steward');
  ({ run } = travel(c, run, 'palace'));
  assert.deepEqual(route(c, { ...run, at: 'tavern' }, 'palace'), ['tavern', 'town', 'palace'], 'travel follows the roads');
  talk('steward', 'Offer your help');
  ({ run } = travel(c, run, 'forest'));
  talk('tamsin', 'Ask about the thieves');
  ({ run } = travel(c, run, 'mine'));
  ({ run } = locationEvent(c, run, 'mine', { kind: 'chest', id: 'goblin-hoard' }));
  assert.ok(run.flags.includes('found-signet'));
  ({ run } = travel(c, run, 'palace'));
  const refused = npcChoose(c, run, 'steward', npcView(c, run, 'steward', { has: () => false }).options[0].i, { has: () => false });
  assert.deepEqual(refused.effects, [], 'no ring, no reward');
  const r = talk('steward', 'Hand over', { coins: 0, has: (id) => id === 'stewards-signet' });
  assert.deepEqual(r.effects.map((e) => Object.keys(e)[0]).sort(), ['coins', 'takeItem', 'xp']);
  assert.ok(questDone(c, run));
  assert.ok(run.discovered.includes('downs'), 'the Steward points to the Barrow Downs');
});

test('shops and paid services check the purse', () => {
  const c = CAMPAIGNS[0]; const run = newRun(c);
  const poor = npcView(c, run, 'maudie', { coins: 10 }).options.find((o) => o.label.startsWith('Rent'));
  assert.equal(poor.why, 'not enough coin');
  const r = npcChoose(c, run, 'maudie', poor.i, { coins: 100 });
  assert.deepEqual(r.effects, [{ coins: -50 }, { rest: true }]); // a night's sleep: hit points and mana
});
