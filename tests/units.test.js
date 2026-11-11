import { test } from 'node:test';
import assert from 'node:assert/strict';
import { m, kg, metricText } from '../src/engine/units.js';
import { ITEMS } from '../src/content/items/catalogue.js';
import { SPELLS, ABILITIES } from '../src/content/westlands/magic.js';
import { westlands } from '../src/content/westlands/index.js';

test('one square is 1.5 m; pounds become kilograms', () => {
  assert.equal(m(5), '1.5 m'); assert.equal(m(30), '9 m'); assert.equal(m(60), '18 m');
  assert.equal(kg(55), '24.9 kg'); assert.equal(kg(0.05), '0.02 kg'); assert.equal(kg(330), '150 kg');
});

test('free text: feet, foot-shapes, ranges and pounds', () => {
  assert.equal(metricText('within 30 feet of it'), 'within 9 m of it');
  assert.equal(metricText('a 15-foot cone'), 'a 4.5-metre cone');
  assert.equal(metricText('(finesse, thrown 20/60).'), '(finesse, thrown 6/18 m).');
  assert.equal(metricText('range 150/600 ft., one target.'), 'range 45/180 m, one target.');
  assert.equal(metricText('within 5 ft. The target'), 'within 1.5 m. The target');
  assert.equal(metricText('weighs 10 lb.'), 'weighs 4.5 kg.');
  assert.equal(metricText('1,000 feet'), '300 m');
  assert.equal(metricText('no numbers here'), 'no numbers here');
});

test('what players read about items, spells, classes and kin is metric', () => {
  const imperial = /\d\s?(ft|feet|foot|lb|lbs|pounds)\b|-foot\b/;
  const texts = [
    ...ITEMS.flatMap((i) => [i.name, i.desc]),
    ...[...SPELLS, ...ABILITIES].map((x) => x.desc),
    ...westlands.races.flatMap((r) => [...(r.traits ?? []), ...(r.subraces ?? []).flatMap((s) => s.traits ?? [])].map((t) => t.text)),
    ...westlands.classes.flatMap((c) => (c.features ?? []).map((f) => f.text)),
  ].filter(Boolean);
  assert.deepEqual(texts.filter((t) => imperial.test(t)), []);
});
