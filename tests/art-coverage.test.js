/**
 * Every creature must have a painting, a body seen from above and a voice whose sounds exist.
 * When you add a creature, give its record `art` and `voice` (see the bestiary files) and add
 * the pictures with tools/art (see tools/art/README.md); this test tells you what is missing.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { BESTIARY } from '../src/content/bestiary/index.js';
import { monsterVoice, voiceSound, SOUND_KEYS } from '../src/ui/audio.js';

const has = (p) => fs.existsSync(new URL(`../${p}`, import.meta.url));

test('every creature has a portrait file', () => {
  const missing = BESTIARY.filter((m) => !m.art.portrait || !has(`assets/portraits/${m.art.portrait}-1.jpg`))
    .map((m) => `${m.id} (${m.art.portrait ?? 'no art.portrait'})`);
  assert.deepEqual(missing, []);
});

test('every creature has a body file', () => {
  const missing = BESTIARY.filter((m) => !m.art.body || !has(`assets/bodies/${m.art.body}.png`))
    .map((m) => `${m.id} (${m.art.body ?? 'no art.body'})`);
  assert.deepEqual(missing, []);
});

test('winged creatures that spread their wings have the open body file', () => {
  const missing = BESTIARY.filter((m) => m.art.bodyOpen && !has(`assets/bodies/${m.art.bodyOpen}.png`)).map((m) => `${m.id} (${m.art.bodyOpen})`);
  assert.deepEqual(missing, []);
  assert.ok(BESTIARY.filter((m) => m.art.bodyOpen).length >= 40, 'every chromatic and metallic dragon');
});

test('every creature declares a voice, and its sounds exist', () => {
  assert.deepEqual(BESTIARY.filter((m) => !m.voice).map((m) => m.id), []);
  const missing = new Set();
  for (const m of BESTIARY) {
    for (const what of ['attack', 'hurt', 'death']) {
      const key = voiceSound(monsterVoice(m), what);
      if (!SOUND_KEYS.includes(key)) missing.add(`${m.id}: ${key} is not in SOUND_KEYS`);
      for (let n = 1; n <= 4; n++) if (!has(`assets/sounds/${key}-${n}.mp3`)) missing.add(`assets/sounds/${key}-${n}.mp3`);
    }
  }
  assert.deepEqual([...missing], []);
});

test('tints are CSS filter chains', () => {
  const ok = /^((grayscale|sepia|saturate|brightness|contrast|hue-rotate|opacity|invert|drop-shadow|blur)\([^)]*(\([^)]*\))?[^)]*\)\s*)+$/;
  const bad = BESTIARY.flatMap((m) => [m.art.tint, m.art.portraitTint].filter((t) => t && !ok.test(t)).map((t) => `${m.id}: ${t}`));
  assert.deepEqual(bad, []);
});

test('every body has a slain version lying on its side (assets/dead), heroes included', async () => {
  const { HERO_BODIES, deadKey } = await import('../src/content/media.js');
  const bodies = new Set([...BESTIARY.map((m) => m.art.body).filter(Boolean), ...Object.values(HERO_BODIES)]);
  const missing = [...bodies].filter((b) => !has(`assets/dead/${deadKey(b)}.png`));
  assert.deepEqual(missing, [], `no dead picture for: ${missing.join(', ')}`);
});
