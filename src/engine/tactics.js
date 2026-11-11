/**
 * How a creature fights, read from its stat block: its mind (Intelligence), its gifts (spells,
 * breath) and its nature (beasts bolt, the mindless never do).
 *
 * Intelligence in 5e runs 1-30; 10 is an ordinary person. We sort minds into four bands:
 *   0 mindless or animal (INT 1-3)   charges the nearest foe; never takes cover
 *   1 dim (INT 4-7)                  charges the nearest foe; throws what it has
 *   2 average (INT 8-11)             shoots from cover, moves from cover to cover when it can't reach you
 *   3 cunning (INT 12+)              as average, and picks off the weakest, backs away to cast,
 *                                    and runs when the fight is lost
 * Spellcasters and dragons prefer magic; casters with a mind keep out of sword reach.
 */
export const MINDS = ['mindless', 'dim', 'average', 'cunning'];

const FEARLESS = /undead|construct|ooze|plant/;

export function fightingStyle(stat, powers = []) {
  const int = stat?.scores?.int ?? 10;
  const mind = int <= 3 ? 0 : int <= 7 ? 1 : int <= 11 ? 2 : 3;
  const type = String(stat?.type ?? '');
  const caster = !!stat?.spellcasting || powers.some((p) => p.spell) || (stat?.actions ?? []).some((a) => a.attack?.kind === 'rs');
  const breath = powers.some((p) => p.breath);
  const fearless = FEARLESS.test(type) || (stat?.conditionImmune ?? []).some((c) => /frightened/i.test(String(c)));
  const beast = /beast/.test(type);
  const style = {
    mind,
    caster,
    breath,
    seeksCover: mind >= 2,
    focusWeak: mind >= 3,
    keepsDistance: caster && mind >= 2,
    // Below this share of its hit points it tries to escape (0 = fights to the death).
    fleeAt: fearless ? 0 : beast ? 0.25 : mind >= 3 ? 0.2 : 0,
    // How often it chooses magic over its weapons: casters and dragons almost always.
    magicFromAfar: caster || breath || type === 'dragon' ? 0.95 : 0.7,
    magicUpClose: caster || type === 'dragon' ? 0.75 : 0.4,
  };
  style.label = styleLabel(style, type);
  return style;
}

function styleLabel(st, type) {
  const bits = [];
  if (st.caster) bits.push(st.keepsDistance ? 'casts first and keeps out of reach' : 'prefers magic');
  else if (st.breath || type === 'dragon') bits.push('breathes whenever it can');
  if (st.mind === 0) bits.push('charges the nearest foe');
  else if (st.mind === 1) bits.push('brutish: rushes in without a plan');
  else if (st.mind === 2) bits.push('uses cover when it cannot reach you');
  else bits.push('cunning: picks off the weakest, fights from cover');
  if (st.fleeAt) bits.push('flees when badly hurt');
  return `${MINDS[st.mind][0].toUpperCase()}${MINDS[st.mind].slice(1)} · ${bits.join(', ')}`;
}

/** Cover as a number: none 0, half 1, three-quarters 2, total 3. */
export const COVER_RANK = { none: 0, half: 1, 'three-quarters': 2, total: 3 };

/**
 * Pick whom to go for. The dim and the mindless take the nearest; the cunning prefer a foe they
 * can see and reach who is hurt the most (fewest hit points left), and then the nearest.
 */
export function pickTarget(style, targets, { dist, sees, reachable = () => true }) {
  if (!targets.length) return null;
  const near = [...targets].sort((a, b) => (sees(b) - sees(a)) || dist(a) - dist(b));
  if (!style?.focusWeak) return near[0];
  const prey = near.filter((t) => sees(t) && reachable(t));
  if (!prey.length) return near[0];
  return prey.sort((a, b) => a.hp - b.hp || dist(a) - dist(b))[0];
}
