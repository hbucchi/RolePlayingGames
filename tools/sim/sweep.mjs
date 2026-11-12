/**
 * Every monster in the bestiary against the party it is meant for, by the 5e encounter budget
 * (progression.js): the highest party level for which the monster alone is a "hard" fight; weak
 * monsters come in a group that adds up to "hard" for level 1. A hard fight should be won most of
 * the time, at a real cost. Prints the ones that stray far from that.
 *
 *   node tools/sim/sweep.mjs [fights per monster] [--all]
 */
import { BESTIARY_BY_ID } from '../../src/content/bestiary/index.js';
import { THRESHOLDS } from '../../src/engine/progression.js';
import { matchFor } from './match.mjs';
import { scenario } from './battle-sim.mjs';
import { partyAt, many } from './party.mjs';
import { monster } from './battle-sim.mjs';

const N = Number(process.argv[2] ?? 150);
const ALL = process.argv.includes('--all');

/** Why a monster is hard to hurt or deadly: its natural armour, weapon resistance, attacks, breath. */
function traits(stat, m) {
  const d = m.defence; const bits = [];
  if (d.armour) bits.push(d.armour.form === 'natural' ? `natural armour ${d.armour.absorb}%` : d.armour.name.toLowerCase());
  if (d.block) bits.push(`blocks ${d.block}%`);
  if (d.affinity?.mundane) bits.push(`${d.affinity.mundane} to plain weapons`);
  if (m.multi) bits.push(`${m.multi.names.length || m.multi.count} attacks`);
  if (m.powers.some((p) => p.breath)) bits.push('breath');
  if (m.powers.some((p) => p.spell)) bits.push('spells');
  return bits.join(', ');
}

const rows = [];
for (const stat of Object.values(BESTIARY_BY_ID)) {
  if (/^test-/.test(stat.id) || !stat.actions?.some((a) => a.attack?.damage?.length)) continue;
  const { level, count, beyond } = matchFor(stat);
  const r = scenario(stat.id, partyAt(level), many(stat.id, count), N, { legendary: false });
  const verdict = r.win < 60 ? 'TOO STRONG' : r.win >= 99 && r.hpLeft >= 85 ? 'too weak' : r.endless > 5 || r.median > 14 ? 'SLOG' : '';
  rows.push({ id: stat.id, cr: stat.cr, level, count, beyond, ...r, verdict, why: traits(stat, monster(stat.id, true)) });
}
rows.sort((a, b) => a.win - b.win);
const show = ALL ? rows : rows.filter((r) => r.verdict);
console.log(`${rows.length} monsters; ${rows.filter((r) => r.verdict === 'TOO STRONG').length} too strong, ${rows.filter((r) => r.verdict === 'too weak').length} too weak, ${rows.filter((r) => r.verdict === 'SLOG').length} slogs\n`);
console.log('| Monster | CR | Party | Heroes win | Rounds (median) | Heroes down | Party HP left | Magic share | Verdict | What it has |');
console.log('|---|---|---|---|---|---|---|---|---|---|');
for (const r of show) console.log(`| ${r.id}${r.count > 1 ? ` x${r.count}` : ''} | ${r.cr} | L${r.level}${r.beyond ? ' (beyond deadly)' : ''} | ${r.win}% | ${r.median} | ${r.down} | ${r.hpLeft}% | ${r.magicShare}% | ${r.verdict} | ${r.why} |`);
const by = (f) => rows.filter(f);
const mean = (list, k) => (list.reduce((s, r) => s + Number(r[k]), 0) / (list.length || 1)).toFixed(0);
console.log(`\nAverage win: L1-4 ${mean(by((r) => r.level <= 4), 'win')}%, L5-10 ${mean(by((r) => r.level >= 5 && r.level <= 10), 'win')}%, L11-16 ${mean(by((r) => r.level >= 11 && r.level <= 16), 'win')}%, L17-20 ${mean(by((r) => r.level >= 17), 'win')}%`);
