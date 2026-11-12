// Balance runs: node tools/sim/run.mjs [fights per scenario]
import { scenario } from './battle-sim.mjs';

const N = Number(process.argv[2] ?? 400);

import { partyAt, many, mix } from './party.mjs';

const rows = [];
const run = (name, heroes, foes, opts) => rows.push(scenario(name, heroes, foes, N, opts));
const W = { magic: false, legendary: false };
const M = { magic: true, legendary: false };
const L1 = partyAt(1);
run('L1 vs 4 goblins', L1, many('goblin', 4));
run('L1 vs 6 pit-runts', L1, many('pit-runt', 6));
run('L1 vs 4 wolves', L1, many('wolf', 4));
run('L1 vs 2 orcs', L1, many('black-pit-orc', 2));
run('L1 vs 3 orcs + 2 goblins', L1, mix([['black-pit-orc', 3], ['goblin', 2]]));
run('L1 vs 2 giant spiders', L1, many('giant-spider', 2));
run('L1 vs ogre', L1, many('ogre', 1));
run('L1 vs bugbear + 3 goblins', L1, mix([['bugbear', 1], ['goblin', 3]]));
for (const [lv, id] of [[15, 'adult-red-dragon'], [20, 'ancient-red-dragon'], [20, 'tarrasque'], [20, 'lich'], [20, 'pit-fiend'], [20, 'dread-sovereign-of-the-hooded-riders']]) {
  run(`L${lv} vs ${id}, weapons only`, partyAt(lv), many(id, 1), W);
  run(`L${lv} vs ${id}, + breath/spells`, partyAt(lv), many(id, 1), M);
  run(`L${lv} vs ${id}, + legendary`, partyAt(lv), many(id, 1));
}
run('L20 vs 2 stone giants + 2 war trolls', partyAt(20), mix([['stone-giant', 2], ['shadow-bred-war-troll', 2]]));

console.log('| Fight | Heroes win | Rounds (avg / median / 90%) | Heroes down | Party HP left | Crippled hero parts | Foe damage from magic | Heroes\' blows | Foes\' blows |');
console.log('|---|---|---|---|---|---|---|---|---|');
for (const r of rows) console.log(`| ${r.name} | ${r.win}% | ${r.rounds} / ${r.median} / ${r.p90} | ${r.down} | ${r.hpLeft}% | ${r.crips} | ${r.magicShare}% | ${r.heroHits} | ${r.foeHits} |`);
