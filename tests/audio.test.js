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

test('Amazons shout one of their four lines on about half of their wounds; each line has two takes', async () => {
  const { amazonHurtLine, AMAZON_HURT_LINES, variantsOf, isAmazon } = await import('../src/ui/audio.js');
  assert.equal(variantsOf('amazon-say-hurt'), 8);
  assert.equal(amazonHurtLine(() => 0.9), null, 'a plain grunt this time');
  const seq = (...v) => { let i = 0; return () => v[i++]; };
  assert.deepEqual(amazonHurtLine(seq(0.1, 0, 0.2)), { line: AMAZON_HURT_LINES[0], n: 1 });
  assert.deepEqual(amazonHurtLine(seq(0.1, 0.99, 0.7)), { line: "I'm gonna make you pay for this!", n: 8 });
  assert.ok(isAmazon('amazon-war-queen') && !isAmazon('orc'));
  for (let n = 1; n <= 8; n++) assert.ok(fs.existsSync(new URL(`../assets/sounds/amazon-say-hurt-${n}.mp3`, import.meta.url)), `take ${n}`);
});
