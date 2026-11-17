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

test('each weapon leaves its own strike mark and its own pitch of hit sound', async () => {
  const { strikeKind, hitSound } = await import('../src/ui/dungeon/strikes.js');
  assert.equal(strikeKind({ name: 'Longsword', type: 'slashing' }), 'slash');
  assert.equal(strikeKind({ name: 'Battleaxe', type: 'slashing' }), 'chop');
  assert.equal(strikeKind({ name: 'Rapier', type: 'piercing' }), 'thrust');
  assert.equal(strikeKind({ name: 'Warhammer', type: 'bludgeoning' }), 'smash');
  assert.equal(strikeKind({ name: 'Claws', type: 'slashing' }), 'claws');
  assert.equal(strikeKind({ name: 'Bite', type: 'piercing' }), 'bite');
  assert.equal(strikeKind({ name: 'Longbow', type: 'piercing', ranged: true }, true), 'shot');
  assert.equal(strikeKind({ name: 'Spear', type: 'piercing', ranged: true, melee: true }, true), 'thrust', 'a thrown spear is still a spear');
  assert.ok(hitSound('smash').rate < hitSound('slash').rate && hitSound('thrust').rate > hitSound('slash').rate);
  const { weaponShape } = await import('../src/ui/dungeon/strikes.js');
  const shape = (name, type = 'slashing', ranged = false) => weaponShape({ name, type }, ranged);
  assert.equal(shape('Longsword'), 'sword'); assert.equal(shape('Scimitar'), 'curved'); assert.equal(shape('Greataxe'), 'greataxe');
  assert.equal(shape('Handaxe'), 'axe'); assert.equal(shape('Rapier', 'piercing'), 'rapier'); assert.equal(shape('Dagger', 'piercing'), 'dagger');
  assert.equal(shape('Spear', 'piercing'), 'spear'); assert.equal(shape('Warhammer', 'bludgeoning'), 'hammer'); assert.equal(shape('Morningstar', 'piercing'), 'mace');
  assert.equal(shape('Greatclub', 'bludgeoning'), 'club'); assert.equal(shape('Quarterstaff', 'bludgeoning'), 'staff');
  assert.equal(shape('Claw'), 'claw'); assert.equal(shape('Bite', 'piercing'), 'jaws'); assert.equal(shape('Tail', 'bludgeoning'), 'whip');
  assert.equal(shape('Slam', 'bludgeoning'), 'fist'); assert.equal(shape('Gore', 'piercing'), 'horn');
  assert.equal(shape('Longbow', 'piercing', true), null, 'the arrow already flew');
  assert.equal(shape('Life Drain', 'necrotic'), null, 'nothing to show for a touch');
});

test('a rescue: the hero says one of three lines, the captive answers one of three; every take exists', async () => {
  const { spokenLine, RESCUE_HERO_LINES, RESCUE_CAPTIVE_LINES, variantsOf, SOUND_KEYS } = await import('../src/ui/audio.js');
  const seq = (...v) => { let i = 0; return () => v[i++]; };
  assert.deepEqual(spokenLine(RESCUE_HERO_LINES, seq(0.9, 0.7)), { line: RESCUE_HERO_LINES[2], n: 6 });
  assert.deepEqual(spokenLine(RESCUE_CAPTIVE_LINES, seq(0, 0.1)), { line: RESCUE_CAPTIVE_LINES[0], n: 1 });
  for (const key of ['rescue-hero-low', 'rescue-hero-high', 'rescue-captive']) {
    assert.ok(SOUND_KEYS.includes(key)); assert.equal(variantsOf(key), 6);
    for (let n = 1; n <= 6; n++) assert.ok(fs.existsSync(new URL(`../assets/sounds/${key}-${n}.mp3`, import.meta.url)), `${key}-${n}`);
  }
});
