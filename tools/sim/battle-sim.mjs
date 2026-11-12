/**
 * Battle simulator: runs many fights headless with the game's own rules (engine/*), to see how
 * long fights last, who wins and how the new defence and injury systems play out.
 *
 *   node tools/sim/battle-sim.mjs
 *
 * What it models: initiative; d20 vs Evasion with advantage/disadvantage from injuries, fear and
 * bonds; shield and parry blocks; d100 hit location on each creature's body map; armour per damage
 * type and layering; part health, multipliers to total HP, crippling (bleeding, lame, useless arms,
 * dazed); elemental extras through the armour's resistance; immunities and resistances; armour wear;
 * Extra Attack for heroes and Multiattack for monsters; breath weapons, spells and auras (with the
 * game's own choice of power, monster-turns.js); and, as an option, legendary actions (not yet in the
 * game). There is no map: everyone stands toe to toe, and an area catches each other hero by
 * chance (catchChance). Heroes only fight with weapons: no spells, healing or potions, so the
 * numbers are on the hard side for the party.
 */
import { premades } from '../../src/content/westlands/premades.js';
import { westlands } from '../../src/content/westlands/index.js';
import { deriveCharacter, ensureGear, syncBaseFromAssignment } from '../../src/engine/character.js';
import { BESTIARY_BY_ID } from '../../src/content/bestiary/index.js';
import { createMonster, resolveAttack, weaponFromHeroAttack, attacksThisTurn } from '../../src/engine/combat.js';
import { strike, absorbed, afterResistance, blockChanceVs, wearArmour, typeFactor } from '../../src/engine/defence.js';
import { applyHit, injuryPenalties, crippledParts } from '../../src/engine/injury.js';
import { isPhysical } from '../../src/engine/materials.js';
import { makeItem, equipItem } from '../../src/engine/items.js';
import { averageRoll } from '../../src/engine/monsters.js';
import { canUse, spend, rollRecharge } from '../../src/engine/monster-magic.js';
import { roll } from '../../src/engine/dice.js';

const d = (n) => 1 + Math.floor(Math.random() * n);

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
    weapon: { ...weaponFromHeroAttack(melee), extra: [], magic: !!melee.magic, metal: melee.metal }, attacks: c.attacksPerAction ?? 1,
    saves: Object.fromEntries(c.savingThrows.map((s) => [s.id, s.bonus])), evasionFeat: !!c.evasion, cond: {} };
}

/** A monster; `multi` gives it its stat block's Multiattack count. */
export function monster(id, multi = false) {
  const stat = BESTIARY_BY_ID[id];
  if (!stat) throw new Error(`no monster ${id}`);
  const m = createMonster(stat, `${id}-${Math.random()}`, { x: 0, y: 0 });
  const melee = m.weapons.filter((w) => w.melee).sort((a, b) => averageRoll(b.damage) - averageRoll(a.damage))[0] ?? m.weapons[0];
  // The game's own Multiattack (combat.js attacksThisTurn): a dragon's bite and two claws.
  return { ...m, name: stat.name, side: 'foe', weapon: melee, swings: multi ? attacksThisTurn(m, melee) : [melee], stat, cond: {}, saves: stat.saves ?? {}, mods: stat.mods };
}

const stats = () => ({ swings: 0, dodged: 0, blocked: 0, landed: 0, raw: 0, dealt: 0, crips: 0, bleedDmg: 0, magicDmg: 0, powers: 0, legendary: 0 });

function attack(a, t, st, weapon = a.weapon) {
  st.swings++;
  const pen = injuryPenalties(a);
  const tp = injuryPenalties(t);
  const dis = pen.attackDis.length || a.cond?.frightened || a.cond?.restrained;
  const adv = t.cond?.restrained;
  const mode = dis && !adv ? 'disadvantage' : adv && !dis ? 'advantage' : 'normal';
  const r = resolveAttack({ weapon, ac: t.ac + tp.evasion, mode });
  if (!r.hit) { st.dodged++; return; }
  const armless = (t.defence?.blockWith === 'shield' && tp.noShield) || (t.defence?.blockWith === 'parry' && tp.noParry);
  const b = armless ? 0 : blockChanceVs(t.defence, {});
  if (!r.crit && Math.random() < b) { st.blocked++; return; }
  st.landed++;
  const extra = {}; for (const x of r.extras ?? []) extra[x.type] = (extra[x.type] ?? 0) + x.total;
  let main = r.damage - Object.values(extra).reduce((s, v) => s + v, 0);
  if (!isPhysical(weapon.type)) { extra[weapon.type] = (extra[weapon.type] ?? 0) + main; main = 0; }
  let total = 0;
  if (main > 0) {
    const at = strike(t.defence, d(100), weapon.type);
    const got = Math.round(absorbed(main, at.pct) * typeFactor(t.defence, weapon.type, { magic: !!weapon.magic, silver: weapon.metal === 'silver' }));
    st.raw += main; st.dealt += got;
    for (const p of at.pieces) wearArmour(p, r.crit);
    const inj = applyHit(t, at.part, got);
    if (inj.crippledNow) st.crips++;
    total += inj.total;
  }
  for (const [type, n] of Object.entries(extra)) { const got = afterResistance(t.defence, n, type); st.raw += n; st.dealt += got; total += got; }
  t.hp -= total;
}


// ---- Monster magic: breath, spells, auras, legendary actions ----------------------------------
// No map here, so an area catches each other hero by chance: a 60-ft cone or a wide burst
// usually catches most of a party standing round a monster; a line only one or two.
function catchChance(p) {
  if (p.kind !== 'area') return 0;
  if (p.shape === 'cone') return p.size >= 6 ? 0.7 : 0.5;
  if (p.shape === 'line') return 0.35;
  if (p.shape === 'radius') return p.size >= 3 ? 0.7 : 0.45;
  return p.size >= 2 ? 0.8 : 0.6; // around the monster: everyone in melee
}
const avg = (dice) => (dice ? averageRoll(dice) : 0);
function save(e, ability, dc) {
  const bonus = e.isHero ? (e.saves[ability] ?? 0) : (e.saves?.[ability] ?? e.mods?.[ability] ?? 0);
  return d(20) + bonus >= dc;
}
function hurtBy(t, n, type, st) { const got = afterResistance(t.defence, n, type); t.hp -= got; st.magicDmg += got; return got; }
function rider(t, p) {
  if (p.rider === 'flee') t.cond.frightened = { dc: p.dc, save: 'wis' };
  if (p.rider === 'restrain') t.cond.restrained = { dc: p.dc, save: 'str' };
}
/** Use a power: area (everyone caught saves), single-target save, a spell attack, or darts. */
function usePower(m, p, target, heroes, st) {
  st.powers++;
  if (p.kind === 'bolt') { attack(m, target, st, { name: p.name, toHit: p.toHit, damage: p.dice, type: p.type, ranged: true, extra: [] }); return; }
  if (p.kind === 'darts') { for (let i = 0; i < p.count; i++) hurtBy(target, roll(p.dice).total, p.type, st); return; }
  const caught = p.kind === 'area' ? heroes.filter((h) => h === target || Math.random() < catchChance(p)) : [target];
  const dmg = p.dice ? roll(p.dice).total : 0;
  for (const h of caught) {
    const ok = save(h, p.save, p.dc);
    let n = ok ? (p.half ? Math.floor(dmg / 2) : 0) : dmg;
    if (h.evasionFeat && p.save === 'dex') n = ok ? 0 : Math.floor(dmg / 2);
    if (n > 0) hurtBy(h, n, p.type, st);
    if (!ok && p.rider) rider(h, p);
  }
}
const powerScore = (p, nHeroes) => (p.kind === 'area' ? (1 + (nHeroes - 1) * catchChance(p)) : 1) * (p.kind === 'darts' ? p.count * avg(p.dice) : p.dice ? avg(p.dice) * 0.7 : 4);
/** The game's choice (monster-turns.js choosePower): a ready breath always; else magic often. */
function choosePower(m, heroes) {
  const ready = (m.powers ?? []).filter((p) => canUse(p, m.uses) && p.kind !== 'wall');
  if (!ready.length) return null;
  const best = ready.map((p) => ({ p, s: powerScore(p, heroes.length) + (p.level > 0 ? 2 : 0) })).sort((a, b) => b.s - a.s)[0].p;
  if (best.recharge) return best;
  return Math.random() < (m.style?.magicUpClose ?? 0.4) ? best : null;
}
/** One legendary action at the end of a hero's turn, if it has the points. */
function legendaryAction(m, heroes, st) {
  if (!m.legendary || !(m.legPoints > 0) || m.hp <= 0) return;
  const opts = m.legendary.options.filter((o) => o.cost <= m.legPoints);
  if (!opts.length) return;
  // Save points for the big one when it is worth more than single blows.
  const val = (o) => (o.weapon ? averageRoll(o.weapon.damage) * 0.6 : powerScore(o.power, heroes.length)) / o.cost;
  const o = opts.sort((a, b) => val(b) - val(a))[0];
  m.legPoints -= o.cost; st.legendary++;
  const t = heroes[Math.floor(Math.random() * heroes.length)];
  if (o.weapon) attack(m, t, st, o.weapon); else usePower(m, o.power, t, heroes, st);
}

/** One fight. Returns { won, rounds, heroesDown, heroHpLeft, ... }. */
export function fight(makeHeroes, makeFoes, { maxRounds = 40, magic = true, legendary = true } = {}) {
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
      if (e.side === 'foe') {
        e.legPoints = legendary ? e.legendary?.count ?? 0 : 0;
        if (magic) {
          rollRecharge(e.powers ?? [], e.uses, (n) => Math.floor(Math.random() * n));
          if (e.aura) for (const h of enemies) if (Math.random() < 0.6) hurtBy(h, roll(e.aura.dice).total, e.aura.type, st.foe);
          const p = choosePower(e, enemies);
          if (p) { spend(p, e.uses); usePower(e, p, t, alive(heroes), st.foe); continue; }
        }
      }
      const swings = e.swings ?? Array.from({ length: e.attacks }, () => e.weapon);
      for (const w of swings) { if (t.hp <= 0) break; attack(e, t, st[e.side], w); }
      if (e.side === 'hero') {
        // End of a hero's turn: shake off fear or bonds; then legendary monsters may act.
        for (const [k, c] of Object.entries(e.cond)) if (save(e, c.save, c.dc)) delete e.cond[k];
        for (const f of alive(foes)) { const hs = alive(heroes); if (hs.length) legendaryAction(f, hs, st.foe); }
      }
    }
  }
  const won = !alive(foes).length;
  return { won, rounds: round, endless: round >= maxRounds, heroesDown: heroes.filter((h) => h.hp <= 0).length,
    heroHpLeft: heroes.reduce((s, h) => s + Math.max(0, h.hp), 0) / heroes.reduce((s, h) => s + h.maxHp, 0),
    crippledHeroes: heroes.reduce((s, h) => s + crippledParts(h).length, 0), st };
}

/** Run a scenario many times and summarise. */
export function scenario(name, makeHeroes, makeFoes, n = 400, opts = {}) {
  const runs = Array.from({ length: n }, () => fight(makeHeroes, makeFoes, opts));
  const avg = (f) => runs.reduce((s, r) => s + f(r), 0) / n;
  const sum = (side, k) => runs.reduce((s, r) => s + r.st[side][k], 0);
  const pct = (a, b) => (b ? Math.round((100 * a) / b) : 0);
  const rounds = runs.map((r) => r.rounds).sort((a, b) => a - b);
  return {
    name, win: pct(runs.filter((r) => r.won).length, n), rounds: avg((r) => r.rounds).toFixed(1), median: rounds[n >> 1], p90: rounds[Math.floor(n * 0.9)],
    endless: pct(runs.filter((r) => r.endless).length, n), down: avg((r) => r.heroesDown).toFixed(2), hpLeft: Math.round(100 * avg((r) => r.heroHpLeft)),
    crips: (runs.reduce((s, r) => s + r.crippledHeroes, 0) / n).toFixed(2),
    magicShare: pct(sum('foe', 'magicDmg'), sum('foe', 'magicDmg') + sum('foe', 'dealt')),
    heroHits: `${pct(sum('hero', 'landed'), sum('hero', 'swings'))}% land, ${pct(sum('hero', 'blocked'), sum('hero', 'swings'))}% blocked, armour keeps ${100 - pct(sum('hero', 'dealt'), sum('hero', 'raw'))}%`,
    foeHits: `${pct(sum('foe', 'landed'), sum('foe', 'swings'))}% land, ${pct(sum('foe', 'blocked'), sum('foe', 'swings'))}% blocked, armour keeps ${100 - pct(sum('foe', 'dealt'), sum('foe', 'raw'))}%`,
  };
}
