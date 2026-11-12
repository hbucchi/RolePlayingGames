// Balance runs: node tools/sim/run.mjs [fights per scenario]
import { hero, monster, scenario } from './battle-sim.mjs';

const N = Number(process.argv[2] ?? 400);
const party1 = () => [hero(0, 1), hero(1, 1), hero(2, 1), hero(3, 1)];
const L20 = [
  [0, [['half-plate', { bonus: 1 }], 'iron-helm', 'steel-vambraces', ['longsword', { bonus: 2 }]]],
  [1, [['plate', { bonus: 3, material: 'dwarf-steel' }], 'great-helm', 'gauntlets', 'steel-greaves', 'steel-gorget', ['shield', { bonus: 2 }], ['longsword', { bonus: 3 }]]],
  [2, [['studded-leather', { bonus: 2 }], 'leather-cap', 'leather-gloves', ['rapier', { bonus: 3 }]]],
  [3, [['chain-shirt', { bonus: 1 }], ['rapier', { bonus: 1 }]]],
];
const party20 = () => L20.map(([i, g]) => hero(i, 20, g));
const many = (id, n, multi) => () => Array.from({ length: n }, () => monster(id, multi));
const mix = (list, multi) => () => list.flatMap(([id, n]) => Array.from({ length: n }, () => monster(id, multi)));

const rows = [];
const run = (name, heroes, foes) => rows.push(scenario(name, heroes, foes, N));
for (const multi of [true]) {
  const tag = '';
  run(`L1 party vs 4 goblins${tag}`, party1, many('goblin', 4, multi));
  run(`L1 party vs 6 pit-runts${tag}`, party1, many('pit-runt', 6, multi));
  run(`L1 party vs 4 wolves${tag}`, party1, many('wolf', 4, multi));
  run(`L1 party vs 3 orcs + 2 goblins${tag}`, party1, mix([['black-pit-orc', 3], ['goblin', 2]], multi));
  run(`L1 party vs 2 giant spiders${tag}`, party1, many('giant-spider', 2, multi));
  run(`L1 party vs ogre${tag}`, party1, many('ogre', 1, multi));
  run(`L1 party vs bugbear + 3 goblins${tag}`, party1, mix([['bugbear', 1], ['goblin', 3]], multi));
  run(`L1 party vs hill troll (CR4)${tag}`, party1, many('hill-troll', 1, multi));
  run(`L20 party vs 4 trolls${tag}`, party20, many('troll', 4, multi));
  run(`L20 party vs 2 stone giants + 2 war trolls${tag}`, party20, mix([['stone-giant', 2], ['shadow-bred-war-troll', 2]], multi));
  run(`L20 party vs adult red dragon${tag}`, party20, many('adult-red-dragon', 1, multi));
  run(`L20 party vs ancient red dragon${tag}`, party20, many('ancient-red-dragon', 1, multi));
  run(`L20 party vs Dread Sovereign + 2 knights${tag}`, party20, mix([['dread-sovereign-of-the-hooded-riders', 1], ['knight', 2]], multi));
  run(`L20 party vs pit fiend${tag}`, party20, many('pit-fiend', 1, multi));
  run(`L20 party vs tarrasque${tag}`, party20, many('tarrasque', 1, multi));
}
console.log('| Fight | Heroes win | Rounds (avg / median / 90%) | Endless | Heroes down | Party HP left | Crippled hero parts | Heroes\' blows | Foes\' blows |');
console.log('|---|---|---|---|---|---|---|---|---|');
for (const r of rows) console.log(`| ${r.name} | ${r.win}% | ${r.rounds} / ${r.median} / ${r.p90} | ${r.endless}% | ${r.down} | ${r.hpLeft}% | ${r.crips} | ${r.heroHits} | ${r.foeHits} |`);
// The heroes themselves, for reference.
const show = (h) => `${h.name}: HP ${h.maxHp}, Evasion ${h.ac}, block ${h.defence.block}%, ${h.weapon.name} ${h.weapon.toHit >= 0 ? '+' : ''}${h.weapon.toHit} ${h.weapon.damage} x${h.attacks}`;
console.log('\n' + [...party1(), ...party20()].map(show).join('\n'));
