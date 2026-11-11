// What art is still missing? Lists creatures without a portrait, body or voice, and the family
// keys they point at that have no file yet.   node tools/art/missing.mjs
import fs from 'node:fs';
import { BESTIARY } from '../../src/content/bestiary/index.js';

const has = (p) => fs.existsSync(new URL(`../../${p}`, import.meta.url));
const rows = [];
for (const m of BESTIARY) {
  const gaps = [];
  if (!m.art.portrait) gaps.push('no art.portrait');
  else if (!has(`assets/portraits/${m.art.portrait}-1.jpg`)) gaps.push(`portrait file ${m.art.portrait}`);
  if (!m.art.body) gaps.push('no art.body');
  else if (!has(`assets/bodies/${m.art.body}.png`)) gaps.push(`body file ${m.art.body}`);
  if (!m.voice) gaps.push('no voice (a guess is used)');
  if (gaps.length) rows.push(`${m.id}: ${gaps.join(', ')}`);
}
console.log(rows.length ? rows.join('\n') : `All ${BESTIARY.length} creatures have a portrait, a body and a voice.`);
const famKeys = (k) => [...new Set(BESTIARY.map((m) => m.art[k]).filter((v) => v?.startsWith(k === 'body' ? 'body-fam-' : 'fam-')))];
const needP = famKeys('portrait').filter((v) => !has(`assets/portraits/${v}-1.jpg`)).map((v) => v.slice(4));
const needB = famKeys('body').filter((v) => !has(`assets/bodies/${v}.png`)).map((v) => v.slice(9));
if (needP.length) console.log(`\nPortrait sheets needed for: ${needP.join(' ')}\n  python3 tools/art/sheets.py plan portrait ${needP.slice(0, 12).join(' ')}`);
if (needB.length) console.log(`\nBody sheets needed for: ${needB.join(' ')}\n  python3 tools/art/sheets.py plan body ${needB.slice(0, 12).join(' ')}`);
