/**
 * Playtests in a real browser: the game is served, a party goes down, and we check what a player
 * would see. Slower than the unit tests (about a minute), so they run on their own:
 *
 *   npm run test:e2e
 *
 * Needs Playwright with Chromium (npm i --no-save playwright && npx playwright install chromium).
 * The ?debug hooks (window.__dungeon, dungeon-view.js) stand in for clicking every square.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = await import('playwright')); }

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const PORT = 5199;
const URL_ = `http://localhost:${PORT}/?debug`;
let server; let browser;

before(async () => {
  server = spawn(process.execPath, ['server.mjs'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });
  for (let i = 0; i < 50; i++) { try { await fetch(`http://localhost:${PORT}/`); break; } catch { await new Promise((r) => setTimeout(r, 100)); } }
  browser = await chromium.launch();
});
after(async () => { await browser?.close(); server?.kill(); });

/** A fresh page with empty storage, the console's errors collected. */
async function fresh() {
  const p = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  p.errors = []; p.on('pageerror', (e) => p.errors.push(e.message));
  await p.goto(URL_); await p.evaluate(() => localStorage.clear()); await p.reload();
  return p;
}
const enter = async (p) => { await p.click('[data-tab="adventures"]'); await p.click('[data-action="enter-dungeon"]'); await p.waitForSelector('.tk-hero'); };
const roster = (p) => p.evaluate(() => { const r = JSON.parse(localStorage.getItem('rpg.roster.v1')); const list = r?.data ?? r; return Array.isArray(list) ? list : []; });
const delveActive = (p) => p.evaluate(() => !!JSON.parse(localStorage.getItem('rpg.delve.v1') ?? 'null'));
const clearFloor = (p) => p.evaluate(() => { const s = window.__dungeon.state(); s.monsters.forEach((m) => { if (!m.side) { m.dead = true; m.hp = 0; } }); s.mode = 'explore'; });
/** Stand next to the stairs and click them (as the "nearby" panel's button does). */
const toStairs = (p) => p.evaluate(() => {
  const s = window.__dungeon.state(); s.revealAll = true; const e = s.map.exit;
  for (const [dx, dy] of [[0, 1], [1, 0], [-1, 0], [0, -1], [1, 1], [-1, 1]]) { if (s.map.tiles[e.y + dy]?.[e.x + dx]) { s.hero.pos = { x: e.x + dx, y: e.y + dy }; break; } }
  const b = document.createElement('button'); b.dataset.dg = 'pick-target'; b.dataset.kind = 'stairs';
  const pop = document.querySelector('.dg-pop'); pop.hidden = false; pop.appendChild(b); b.click();
});

test('a delve: XP at the dungeon rate, the stairs choice, the safe, back to town', async () => {
  const p = await fresh(); await enter(p);
  assert.equal(await delveActive(p), true, 'a checkpoint is taken on the way in');
  await p.evaluate(() => window.__dungeon.giveXp(400));
  assert.equal((await roster(p))[0].xp, 100, 'generated dungeons pay a quarter');
  await clearFloor(p); await toStairs(p); await p.waitForTimeout(300);
  const buttons = await p.$$eval('.dg-endscreen button', (bs) => bs.map((x) => x.textContent.trim()));
  assert.ok(buttons.includes('Leave the dungeon') && buttons.some((b) => /depth 2/.test(b)), buttons.join(' | '));
  await p.click('[data-dg="leave-dungeon"]');
  await p.click('[data-dg="safe-store-all"]');
  const stored = await p.evaluate(() => JSON.parse(localStorage.getItem('rpg.safe.v1')).items.length);
  assert.ok(stored > 0, 'loot went into the safe');
  await p.click('[data-dg="leave-done"]'); await p.waitForTimeout(400);
  assert.equal(await delveActive(p), false, 'out of the dungeon: nothing left to undo');
  assert.equal((await roster(p))[0].xp, 100, 'the XP was kept');
  assert.deepEqual(p.errors, []);
  await p.close();
});

test('defeat, or closing the game mid-floor, undoes the floor', async () => {
  const p = await fresh(); await enter(p);
  await p.evaluate(() => window.__dungeon.giveXp(400)); // adopts the ready-made hero: 100 XP
  await clearFloor(p); await toStairs(p); await p.waitForTimeout(300); // the stairs keep it
  await p.click('[data-dg="close-end"]');
  await p.evaluate(() => window.__dungeon.giveXp(4000));
  await p.evaluate(() => window.__dungeon.forceDefeat()); await p.waitForTimeout(600);
  assert.equal((await roster(p))[0].xp, 100, 'defeat: back to the last stairs');
  assert.match(await p.textContent('.dg-endcard'), /is lost/);
  await p.evaluate(() => document.querySelector('.dg-endscreen [data-dg="retry"]').click()); await p.waitForTimeout(500);
  await p.evaluate(() => window.__dungeon.giveXp(4000));
  await p.reload(); await p.waitForTimeout(600);
  assert.equal((await roster(p))[0].xp, 100, 'closing the game mid-floor counts as walking away');
  assert.equal(await delveActive(p), false);
  assert.deepEqual(p.errors, []);
  await p.close();
});

test('the tenth floor: one hall, a boss fit for one hero (no legendary blow), the way out sealed until it falls', async () => {
  const p = await fresh(); await enter(p);
  await p.evaluate(() => window.__dungeon.floor(10)); await p.waitForTimeout(400);
  const lair = await p.evaluate(() => { const s = window.__dungeon.state(); const b = s.monsters.find((m) => m.boss); return { rooms: s.map.rooms.length, boss: b?.name, legendary: !!b?.legendary }; });
  assert.equal(lair.rooms, 1); assert.match(lair.boss, /Master of the Deep/);
  assert.equal(lair.legendary, false, 'against a lone hero the boss takes no legendary actions (depths.js)');
  await toStairs(p); await p.waitForTimeout(300);
  assert.equal(await p.evaluate(() => document.querySelector('.dg-endscreen').hidden), true, 'sealed while the boss lives');
  await p.evaluate(() => window.__dungeon.wound(9999)); await p.waitForTimeout(1500);
  const record = await p.evaluate(() => JSON.parse(localStorage.getItem('rpg.delve.best')));
  assert.equal(record.bosses, 1); assert.equal(record.deepest, 10);
  await p.evaluate(() => document.querySelector('[data-dg="close-end"]')?.click());
  await toStairs(p); await p.waitForTimeout(300);
  assert.match(await p.textContent('.dg-endscreen'), /The way out/);
  assert.deepEqual(p.errors, []);
  await p.close();
});

test('the trading post: the inn and the healer mend wounds for coin', async () => {
  const p = await fresh(); await enter(p);
  await p.evaluate(() => window.__dungeon.giveXp(40)); // adopt the hero
  await clearFloor(p); await toStairs(p); await p.click('[data-dg="leave-dungeon"]'); await p.click('[data-dg="leave-done"]'); await p.waitForTimeout(300);
  await p.evaluate(() => { const r = JSON.parse(localStorage.getItem('rpg.roster.v1')); const list = r.data ?? r; list[0].wounds = 4; list[0].coins = 1000; localStorage.setItem('rpg.roster.v1', JSON.stringify(r)); });
  await p.reload(); await p.click('[data-tab="adventures"]'); await p.click('[data-action="open-market"]');
  await p.click('[data-tr="heal-healer"]'); await p.waitForTimeout(200);
  const h = (await roster(p))[0];
  assert.equal(h.wounds, 0); assert.equal(h.coins, 1000 - 4 * 20);
  assert.deepEqual(p.errors, []);
  await p.close();
});
