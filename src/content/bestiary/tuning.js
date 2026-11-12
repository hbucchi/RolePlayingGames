/**
 * Balance tuning: creatures whose stat blocks hit too hard for their challenge rating under this
 * game's rules (Multiattack every turn, armour that absorbs, body parts). Found with the battle
 * simulator (tools/sim/sweep.mjs): each was fought by the party its XP is meant for, at "hard",
 * and won far less often than a hard fight should be (about two times in three or more).
 *
 *   damage   scales the number of damage dice of every attack (6d6+9 x0.75 -> 5d6+9)
 *   hp       scales the number of hit dice (the CON bonus follows)
 *   multi    a new Multiattack text
 *   why      the reason, for whoever tunes next
 */
import { slugify } from '../../engine/monsters.js';

export const TUNING = {
  'storm-giant': { damage: 0.6, hp: 0.7, why: 'two 6d6+9 greatswords a turn at +14' },
  'fire-giant': { damage: 0.7, hp: 0.8, why: 'two 6d6+7 greatswords, in plate, behind a shield' },
  'cloud-giant': { damage: 0.8 },
  'frost-giant': { damage: 0.8 },
  'hill-giant': { damage: 0.8 },
  'war-mammoth-of-the-southern-host': { damage: 0.75, hp: 0.75, why: '330 hit points' },
  'lurker-of-the-black-mere': { multi: 'Makes two tentacle attacks.', hp: 0.8, why: 'four tentacles a turn' },
  gladiator: { hp: 0.85, multi: 'Makes two melee attacks.', why: '112 HP and three spear attacks behind a shield, at CR 5' },
  drider: { damage: 0.8, hp: 0.75 },
  'bandit-captain': { multi: 'Makes two melee attacks: one with its scimitar and one with its dagger.', why: 'three attacks at CR 2' },
  otyugh: { hp: 0.75 },
  'shambling-mound': { hp: 0.8 },
  chuul: { hp: 0.8 },
  centaur: { hp: 0.85 },
};

const scaleDice = (dice, f) => String(dice).replace(/^(\d+)d/, (_, n) => `${Math.max(1, Math.round(Number(n) * f))}d`);

/** Apply the tuning to a raw stat block (before buildMonster), so the printed text follows. */
export function tune(raw) {
  const id = raw.id ?? raw.name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const t = TUNING[id];
  if (!t) return raw;
  const out = structuredClone(raw);
  if (t.damage) for (const a of out.actions ?? []) for (const d of a.attack?.damage ?? []) d.dice = scaleDice(d.dice, t.damage);
  if (t.hp && /d/.test(out.hp)) {
    const [, n, s, mod] = /^(\d+)d(\d+)([+-]\d+)?$/.exec(out.hp.replace(/ /g, ''));
    const per = Number(mod ?? 0) / Number(n); const k = Math.max(1, Math.round(Number(n) * t.hp));
    out.hp = `${k}d${s}${per ? (per > 0 ? '+' : '') + per * k : ''}`;
  }
  if (t.multi) { const m = (out.actions ?? []).find((a) => a.name === 'Multiattack'); if (m) m.text = t.multi; }
  out.tuned = true;
  return out;
}
