/**
 * Battle simulator: runs many fights headless with the game's own rules (engine/*), to see how
 * long fights last, who wins and how the new defence and injury systems play out.
 *
 *   node tools/sim/battle-sim.mjs
 *
 * What it models: initiative; d20 vs Evasion with advantage/disadvantage from injuries; shield
 * and parry blocks; d100 hit location on each creature's body map; armour per damage type and
 * layering; part health, multipliers to total HP, crippling (bleeding, lame, useless arms, dazed);
 * elemental extras through the armour's resistance; armour wear; Extra Attack for heroes; and
 * (optionally) monster Multiattack. Everyone stands toe to toe: no movement, cover or spells, and
 * monsters use their best melee weapon (their breath and spells are left out).
 */
import { premades } from '../../src/content/westlands/premades.js';
import { westlands } from '../../src/content/westlands/index.js';
import { deriveCharacter, ensureGear, syncBaseFromAssignment } from '../../src/engine/character.js';
import { BESTIARY_BY_ID } from '../../src/content/bestiary/index.js';
import { createMonster, resolveAttack, weaponFromHeroAttack } from '../../src/engine/combat.js';
import { strike, absorbed, afterResistance, blockChanceVs, wearArmour } from '../../src/engine/defence.js';
import { applyHit, injuryPenalties, crippledParts } from '../../src/engine/injury.js';
import { isPhysical } from '../../src/engine/materials.js';
import { makeItem, equipItem } from '../../src/engine/items.js';
import { averageRoll } from '../../src/engine/monsters.js';

const d = (n) => 1 + Math.floor(Math.random() * n);
const WORDS = { two: 2, three: 3, four: 4, five: 5 };

/** A hero at a level, optionally re-geared: gear = [item ids] or [[id, {bonus, material}]]. */
export function hero(premadeIdx, level, gear = null) {
  const draft = ensureGear(syncBaseFromAssignment(structuredClone({ ...premades[premadeIdx], level })), westlands);
  // Ability increases at levels 4, 8, 12, 16 and 19: the fighting ability first (to 20), then CON.
  const main = (draft.baseAbilities.str ?? 0) >= (draft.baseAbilities.dex ?? 0) ? 'str' : 'dex';
  draft.levelUps = Object.fromEntries([4, 8, 12, 16, 19].filter((lv) => lv <= level).map((lv, i) => [lv, { abilities: { [i < 4 ? main : 'con']: 2 }, skill: null }]));
  if (gear) {
    draft.inventory = []; draft.equipped = {};
    for (const g of gear) { const [id, extra] = Array.isArray(g) ? g : [g, {}]; const it = makeItem(id, 1, extra); draft.inventory.push(it); equipItem(draft, it.uid); }
  }
  const c = deriveCharacter(draft, westlands);
  const melee = c.attacks.find((a) => a.slot === 'mainHand') ?? c.attacks[0];
  return { name: `${c.name.split(' ')[0]} (L${level} ${c.cls.name})`, side: 'hero', isHero: true, hp: c.maxHp, maxHp: c.maxHp, ac: c.ac, defence: c.defence, bodyMap: 'humanoid', dexMod: c.mods.dex,
    weapon: { ...weaponFromHeroAttack(melee), extra: [] }, attacks: c.attacksPerAction ?? 1 };
}

/** A monster; `multi` gives it its stat block's Multiattack count. */
export function monster(id, multi = false) {
  const stat = BESTIARY_BY_ID[id];
  if (!stat) throw new Error(`no monster ${id}`);
  const m = createMonster(stat, `${id}-${Math.random()}`, { x: 0, y: 0 });
  const melee = m.weapons.filter((w) => w.melee).sort((a, b) => averageRoll(b.damage) - averageRoll(a.damage))[0] ?? m.weapons[0];
  const ma = stat.actions.find((a) => /multiattack/i.test(a.name));
  const n = ma ? (WORDS[(/makes (two|three|four|five)/i.exec(ma.text) ?? [])[1]] ?? 2) : 1;
  return { ...m, name: stat.name, side: 'foe', weapon: melee, attacks: multi ? n : 1 };
}

const stats = () => ({ swings: 0, dodged: 0, blocked: 0, landed: 0, raw: 0, dealt: 0, crips: 0, bleedDmg: 0 });

function attack(a, t, st) {
  st.swings++;
  const pen = injuryPenalties(a);
  const tp = injuryPenalties(t);
  const mode = pen.attackDis.length ? 'disadvantage' : 'normal';
  const r = resolveAttack({ weapon: a.weapon, ac: t.ac + tp.evasion, mode });
  if (!r.hit) { st.dodged++; return; }
  const armless = (t.defence?.blockWith === 'shield' && tp.noShield) || (t.defence?.blockWith === 'parry' && tp.noParry);
  const b = armless ? 0 : blockChanceVs(t.defence, {});
  if (!r.crit && Math.random() < b) { st.blocked++; return; }
  st.landed++;
  const extra = {}; for (const x of r.extras ?? []) extra[x.type] = (extra[x.type] ?? 0) + x.total;
  let main = r.damage - Object.values(extra).reduce((s, v) => s + v, 0);
  if (!isPhysical(a.weapon.type)) { extra[a.weapon.type] = (extra[a.weapon.type] ?? 0) + main; main = 0; }
  let total = 0;
  if (main > 0) {
    const at = strike(t.defence, d(100), a.weapon.type);
    const got = absorbed(main, at.pct);
    st.raw += main; st.dealt += got;
    for (const p of at.pieces) wearArmour(p, r.crit);
    const inj = applyHit(t, at.part, got);
    if (inj.crippledNow) st.crips++;
    total += inj.total;
  }
  for (const [type, n] of Object.entries(extra)) { const got = afterResistance(t.defence, n, type); st.raw += n; st.dealt += got; total += got; }
  t.hp -= Math.max(1, total);
}

/** One fight. Returns { won, rounds, heroesDown, heroHpLeft, ... }. */
export function fight(makeHeroes, makeFoes, { maxRounds = 40 } = {}) {
  const heroes = makeHeroes(); const foes = makeFoes();
  const all = [...heroes, ...foes];
  for (const e of all) e.init = d(20) + (e.dexMod ?? 0);
  all.sort((a, b) => b.init - a.init);
  const st = { hero: stats(), foe: stats() };
  let round = 0;
  const alive = (list) => list.filter((e) => e.hp > 0);
  while (alive(heroes).length && alive(foes).length && round < maxRounds) {
    round++;
    for (const e of all) {
      if (e.hp <= 0) continue;
      if (injuryPenalties(e).bleeding) { e.hp -= 1; st[e.side].bleedDmg++; if (e.hp <= 0) continue; }
      const enemies = alive(e.side === 'hero' ? foes : heroes);
      if (!enemies.length) break;
      // Heroes focus the weakest foe; monsters pick at random.
      const t = e.side === 'hero' ? enemies.sort((x, y) => x.hp - y.hp)[0] : enemies[Math.floor(Math.random() * enemies.length)];
      for (let i = 0; i < e.attacks && t.hp > 0; i++) attack(e, t, st[e.side]);
    }
  }
  const won = !alive(foes).length;
  return { won, rounds: round, endless: round >= maxRounds, heroesDown: heroes.filter((h) => h.hp <= 0).length,
    heroHpLeft: heroes.reduce((s, h) => s + Math.max(0, h.hp), 0) / heroes.reduce((s, h) => s + h.maxHp, 0),
    crippledHeroes: heroes.reduce((s, h) => s + crippledParts(h).length, 0), st };
}

/** Run a scenario many times and summarise. */
export function scenario(name, makeHeroes, makeFoes, n = 400) {
  const runs = Array.from({ length: n }, () => fight(makeHeroes, makeFoes));
  const avg = (f) => runs.reduce((s, r) => s + f(r), 0) / n;
  const sum = (side, k) => runs.reduce((s, r) => s + r.st[side][k], 0);
  const pct = (a, b) => (b ? Math.round((100 * a) / b) : 0);
  const rounds = runs.map((r) => r.rounds).sort((a, b) => a - b);
  return {
    name, win: pct(runs.filter((r) => r.won).length, n), rounds: avg((r) => r.rounds).toFixed(1), median: rounds[n >> 1], p90: rounds[Math.floor(n * 0.9)],
    endless: pct(runs.filter((r) => r.endless).length, n), down: avg((r) => r.heroesDown).toFixed(2), hpLeft: Math.round(100 * avg((r) => r.heroHpLeft)),
    crips: avg((r) => r.crippledHeroes).toFixed(2),
    heroHits: `${pct(sum('hero', 'landed'), sum('hero', 'swings'))}% land, ${pct(sum('hero', 'blocked'), sum('hero', 'swings'))}% blocked, armour keeps ${100 - pct(sum('hero', 'dealt'), sum('hero', 'raw'))}%`,
    foeHits: `${pct(sum('foe', 'landed'), sum('foe', 'swings'))}% land, ${pct(sum('foe', 'blocked'), sum('foe', 'swings'))}% blocked, armour keeps ${100 - pct(sum('foe', 'dealt'), sum('foe', 'raw'))}%`,
  };
}
