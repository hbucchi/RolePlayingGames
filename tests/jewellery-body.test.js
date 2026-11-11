import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { makeItem, equipItem, tidyEquipped, JEWEL_SLOTS, SLOT_GROUPS, gearStats } from '../src/engine/items.js';
import { ITEMS } from '../src/content/items/catalogue.js';
import { BODY_PARTS, hitLocation, bodyReport } from '../src/engine/body.js';
import { STORIES } from '../src/content/stories/index.js';
import { battleSetup } from '../src/ui/story-view.js';
import { propCells } from '../src/engine/props.js';

const ctx = { mods: { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 }, scores: { str: 10 }, pb: 2, weaponProfs: [], armorProfs: [] };

test('one necklace, two bracelets and ten rings', () => {
  assert.equal(SLOT_GROUPS.ring.length, 10);
  assert.equal(SLOT_GROUPS.wrist.length, 2);
  assert.equal(SLOT_GROUPS.neck.length, 1);
  const gear = { inventory: [], equipped: {} };
  const rings = Array.from({ length: 11 }, () => makeItem('ruby-ring'));
  gear.inventory.push(...rings);
  rings.slice(0, 10).forEach((r) => assert.ok(equipItem(gear, r.uid).ok));
  assert.equal(SLOT_GROUPS.ring.filter((sl) => gear.equipped[sl]).length, 10, 'every finger filled');
  assert.equal(gearStats(gear, ctx).hpBonus ?? null, gearStats(gear, ctx).hpBonus); // computes without error
  // An eleventh ring replaces the first finger's; a ring can be put on a chosen finger.
  equipItem(gear, rings[10].uid, 'ring7');
  assert.equal(gear.equipped.ring7, rings[10].uid);
  const b1 = makeItem('copper-bangle'); const b2 = makeItem('silver-bracelet'); gear.inventory.push(b1, b2);
  equipItem(gear, b1.uid); equipItem(gear, b2.uid);
  assert.deepEqual([gear.equipped.wrist1, gear.equipped.wrist2], [b1.uid, b2.uid]);
  // Old saves had one "ring" slot: it moves to the left thumb.
  const old = { inventory: [makeItem('gold-ring')], equipped: {} }; old.equipped.ring = old.inventory[0].uid;
  tidyEquipped(old); assert.equal(old.equipped.ring1, old.inventory[0].uid); assert.equal(old.equipped.ring, undefined);
});

test('jewellery has its pictures', () => {
  for (const it of ITEMS.filter((x) => ['ring', 'wrist', 'neck'].includes(x.slot) && x.icon)) assert.ok(existsSync(new URL(`../${it.icon}`, import.meta.url)), it.id);
  assert.ok(existsSync(new URL('../assets/ui/body-figure.jpg', import.meta.url)));
});

test('hit locations: weights are percentages and every roll lands somewhere', () => {
  assert.equal(BODY_PARTS.reduce((a, p) => a + p.weight, 0), 100);
  const count = {};
  for (let r = 1; r <= 100; r++) count[hitLocation(r)] = (count[hitLocation(r)] ?? 0) + 1;
  for (const p of BODY_PARTS) assert.equal(count[p.id], p.weight, p.id);
  const gear = { inventory: [makeItem('chain-mail'), makeItem('gold-ring'), makeItem('silver-pendant')], equipped: {} };
  for (const it of gear.inventory) equipItem(gear, it.uid);
  const rep = bodyReport(gear);
  assert.ok(rep.chest.worn.some((w) => w.kind === 'armour'));
  assert.ok(rep['left-hand'].worn.some((w) => w.kind === 'jewel'));
  assert.ok(rep.neck.worn.length);
  assert.equal(rep.head.state, 'Unhurt');
});

test('story battle furniture stays clear of everyone', () => {
  for (const st of STORIES) for (const [id, sc] of Object.entries(st.scenes)) {
    if (!sc.battle?.props) continue;
    const setup = battleSetup(st, { progress: { scene: id }, party: ['a', 'b', 'c', 'd'] });
    const people = [...setup.heroes.map((h) => h.pos), ...setup.foes.map((f) => f.pos)];
    for (const pr of setup.map.props) for (const q of propCells(pr)) {
      if (pr.kind === 'wall-torch') continue;
      assert.ok(q.x > 0 && q.y > 0 && q.x < setup.map.width - 1 && q.y < setup.map.height - 1, `${id}: ${pr.kind} in the wall`);
      assert.ok(!people.some((o) => o.x === q.x && o.y === q.y), `${id}: ${pr.kind} on someone`);
    }
  }
});
