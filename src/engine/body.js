/**
 * The body, part by part: what each part is, how likely a blow is to land there, and what a hero
 * wears over it. This is the groundwork for local injuries (a broken arm, a wounded leg) to come.
 *
 * Hit location as probability: when a blow lands, it strikes one part, chosen at random in
 * proportion to that part's `weight` (the weights sum to 100, so each is a percentage). The chest
 * is the biggest target (22%); a hand is small (4%). To pick one, roll d100 and walk the list,
 * adding up weights until the sum passes the roll: a cumulative distribution, read backwards.
 *
 * x and y place each part on the body figure (assets/ui/body-figure.jpg), as fractions of its width
 * and height. The figure faces you, so the hero's RIGHT side is on the picture's LEFT.
 */
import { equippedIn, itemDef, itemName, JEWEL_SLOTS } from './items.js';

export const BODY_PARTS = [
  { id: 'left-arm', name: 'Left arm', short: 'L arm', weight: 12, x: 0.71, y: 0.38 },
  { id: 'right-arm', name: 'Right arm', short: 'R arm', weight: 12, x: 0.29, y: 0.38 },
  { id: 'left-hand', name: 'Left hand', short: 'L hand', weight: 4, x: 0.8, y: 0.54 },
  { id: 'right-hand', name: 'Right hand', short: 'R hand', weight: 4, x: 0.2, y: 0.54 },
  { id: 'left-leg', name: 'Left leg', short: 'L leg', weight: 9, x: 0.59, y: 0.72 },
  { id: 'right-leg', name: 'Right leg', short: 'R leg', weight: 9, x: 0.41, y: 0.72 },
  { id: 'abdomen', name: 'Torso', weight: 15, x: 0.496, y: 0.4 },
  { id: 'chest', name: 'Chest', weight: 22, x: 0.496, y: 0.27 },
  { id: 'neck', name: 'Neck', weight: 3, x: 0.496, y: 0.19 },
  { id: 'head', name: 'Head', weight: 10, x: 0.496, y: 0.09 },
];
// Each part owns a stretch of the d100: left arm 1-12, right arm 13-24, ... head 91-100.
const stretch = (list) => { let n = 0; for (const p of list) { p.from = n + 1; p.to = n + p.weight; n = p.to; } return list; };
stretch(BODY_PARTS);

/**
 * Other bodies. Four-legged beasts (wolves, bears, horses, dragons) and many-legged arachnids
 * have their own map of the d100; ids shared with the humanoid map (head, neck, chest,
 * abdomen) mean the same thing.
 */
export const BODY_MAPS = {
  humanoid: BODY_PARTS,
  quadruped: stretch([
    { id: 'fore-left-leg', name: 'Left foreleg', short: 'L foreleg', weight: 8 },
    { id: 'fore-right-leg', name: 'Right foreleg', short: 'R foreleg', weight: 8 },
    { id: 'hind-left-leg', name: 'Left hind leg', short: 'L hind leg', weight: 8 },
    { id: 'hind-right-leg', name: 'Right hind leg', short: 'R hind leg', weight: 8 },
    { id: 'tail', name: 'Tail', weight: 5 },
    { id: 'hindquarters', name: 'Rump', weight: 13 },
    { id: 'abdomen', name: 'Torso', weight: 12 },
    { id: 'chest', name: 'Chest', weight: 18 },
    { id: 'neck', name: 'Neck', weight: 7 },
    { id: 'head', name: 'Head', weight: 13 },
  ]),
  arachnid: stretch([
    ...[1, 2, 3, 4, 5, 6, 7, 8].map((n) => ({ id: `leg-${n}`, name: `${n <= 4 ? 'Left' : 'Right'} leg ${((n - 1) % 4) + 1}`, short: `${n <= 4 ? 'L' : 'R'} leg ${((n - 1) % 4) + 1}`, weight: n % 2 ? 5 : 6 })),
    { id: 'abdomen', name: 'Torso', weight: 24 },
    { id: 'cephalothorax', name: 'Thorax', weight: 20 },
    { id: 'head', name: 'Head', weight: 12 },
  ]),
};
/** Humanoid parts by id (the hero's body); `partOf(map, id)` for any body. */
export const BODY_BY_ID = Object.fromEntries(BODY_PARTS.map((p) => [p.id, p]));
export const partOf = (map, id) => (BODY_MAPS[map] ?? BODY_PARTS).find((p) => p.id === id) ?? BODY_BY_ID[id];
/** The short name of a part, for captions on the map: "L arm", "Torso". */
export const shortName = (map, id) => { const p = partOf(map, id); return p ? (p.short ?? p.name) : id; };

/**
 * What body a creature has. Spiders and scorpions: arachnid; beasts that walk on four legs
 * (and dragons): quadruped; everyone else (people, giants, undead...): humanoid.
 */
const ARACHNID = /spider|scorpion|weaver|ettercap-mount/i;
const QUADRUPED = /wolf|worg|warg|hound|dog|jackal|hyena|bear|boar|horse|pony|mule|camel|elk|deer|ox|bull|goat|lion|tiger|panther|leopard|cat|lynx|rat|badger|wolverine|weasel|crocodile|lizard|basilisk|dragon|drake|wyvern|hydra|griffon|hippogriff|manticore|chimera|behir|bulette|rhino|elephant|mammoth|mastiff/i;
export function bodyMapOf(stat) {
  if (stat?.bodyMap) return stat.bodyMap;
  const name = `${stat?.name ?? ''} ${stat?.id ?? ''}`;
  if (ARACHNID.test(name)) return 'arachnid';
  if (/beast|monstrosity|dragon/i.test(stat?.type ?? '') && QUADRUPED.test(name)) return 'quadruped';
  return 'humanoid';
}

/**
 * Where a d100 roll (1-100) lands on a body: the part, and how far into that part's stretch it
 * is (1 = the part's first point). Armour covers a number of points from the start of each
 * stretch, so `offset` <= coverage means the blow meets the armour; beyond it, it finds a gap.
 */
export function strikeAt(d100, map = 'humanoid') {
  const list = BODY_MAPS[map] ?? BODY_PARTS;
  const p = list.find((x) => d100 >= x.from && d100 <= x.to) ?? list[list.length - 1];
  return { part: p.id, offset: d100 - p.from + 1 };
}
/** Pick the part a blow lands on from a d100 roll (1-100). */
export const hitLocation = (d100, map = 'humanoid') => strikeAt(d100, map).part;

/** Which parts armour covers: light protects the trunk, medium the arms too, heavy almost everything. */
const ARMOUR_COVERS = {
  light: ['chest', 'abdomen'],
  medium: ['chest', 'abdomen', 'right-arm', 'left-arm'],
  heavy: ['chest', 'abdomen', 'right-arm', 'left-arm', 'right-leg', 'left-leg', 'neck'],
};
/** Where jewellery sits: the necklace on the neck, bracelets on the wrists, rings on the fingers. */
const JEWEL_PART = (slot) => (slot === 'neck' ? 'neck' : slot === 'wrist1' ? 'left-arm' : slot === 'wrist2' ? 'right-arm'
  : /^ring([1-5])$/.test(slot) ? 'left-hand' : /^ring/.test(slot) ? 'right-hand' : null);

/**
 * For each part: what the hero wears over it (armour, shield, cloak, jewellery) and its state.
 * `injuries` (part id -> list) is where wounds will be kept; for now every part is unhurt.
 */
export function bodyReport(gear, injuries = {}) {
  const out = Object.fromEntries(BODY_PARTS.map((p) => [p.id, { ...p, worn: [], injuries: injuries[p.id] ?? [] }]));
  const put = (part, label, kind) => out[part]?.worn.push({ label, kind });
  const body = equippedIn(gear, 'body'); const bd = itemDef(body);
  if (bd?.armor) for (const part of [...(ARMOUR_COVERS[bd.armor.type] ?? ARMOUR_COVERS.light), ...(bd.id === 'plate' ? ['head'] : [])]) put(part, itemName(body), 'armour');
  const off = equippedIn(gear, 'offHand'); const od = itemDef(off);
  if (od?.cat === 'shield') put('left-arm', itemName(off), 'shield');
  const main = equippedIn(gear, 'mainHand'); if (main) put('right-hand', itemName(main), 'held');
  if (off && od?.cat !== 'shield') put('left-hand', itemName(off), 'held');
  const cloak = equippedIn(gear, 'cloak'); if (cloak) put('chest', itemName(cloak), 'cloak');
  for (const j of JEWEL_SLOTS) { const inst = equippedIn(gear, j.id); if (inst) put(JEWEL_PART(j.id), `${itemName(inst)} (${j.name.toLowerCase()})`, 'jewel'); }
  for (const p of Object.values(out)) p.state = p.injuries.length ? p.injuries.map((w) => w.name ?? w).join(', ') : 'Unhurt';
  return out;
}
