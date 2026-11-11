import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { heroSound, HERO_LINE_CHANCE, SOUND_KEYS, variantsOf } from '../src/ui/audio.js';

test('heroes mostly grunt; about 15% of attacks and hurts are spoken lines', () => {
  assert.equal(heroSound('low', 'attack', () => 0.05), 'hero-low-say-attack');
  assert.equal(heroSound('high', 'hurt', () => 0.1), 'hero-high-say-hurt');
  assert.equal(heroSound('low', 'attack', () => 0.5), 'hero-low-attack');
  assert.equal(heroSound('low', 'death', () => 0), 'hero-low-death', 'dying is always a scream');
  let said = 0; let seed = 1;
  const rng = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let i = 0; i < 10000; i++) if (heroSound('low', 'attack', rng).includes('-say-')) said++;
  assert.ok(Math.abs(said / 10000 - HERO_LINE_CHANCE) < 0.02, `spoken ${said / 100}%`);
});

test('every sound key has all its takes on disk', () => {
  const missing = [];
  for (const k of SOUND_KEYS) for (let n = 1; n <= variantsOf(k); n++) {
    if (!fs.existsSync(new URL(`../assets/sounds/${k}-${n}.mp3`, import.meta.url))) missing.push(`${k}-${n}`);
  }
  assert.deepEqual(missing, []);
});
