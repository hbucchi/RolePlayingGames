/**
 * Player settings that apply everywhere, kept in this browser.
 *
 * figures: how creatures are drawn on the map.
 *   'bodies' – bodies seen from above (top-down sprites) where we have them, tokens otherwise
 *   'tokens' – round portrait tokens for everyone (rounded rectangles for long bodies)
 */
const KEY = 'rpg.view';
export const FIGURE_CHOICES = [
  { id: 'bodies', label: 'Bodies seen from above', hint: 'Creatures drawn as figures on the floor, turned the way they face.' },
  { id: 'tokens', label: 'Portrait tokens', hint: 'Round tokens with each creature\'s painted portrait.' },
];

export function getFigures() {
  try { return localStorage.getItem(KEY) === 'tokens' ? 'tokens' : 'bodies'; } catch { return 'bodies'; }
}
export function setFigures(v) {
  try { localStorage.setItem(KEY, v === 'tokens' ? 'tokens' : 'bodies'); } catch { /* storage blocked: lasts this visit only */ }
}

/** A small radio group for the figures setting (used on the start screen and in the game's settings menu). */
export function figuresControl(current, attr = 'data-action="figures"') {
  return `<fieldset class="figures-choice"><legend>Creatures on the map</legend>
    ${FIGURE_CHOICES.map((c) => `<label class="figure-opt"><input type="radio" name="figures-${attr.length}" value="${c.id}" ${attr} ${current === c.id ? 'checked' : ''}>
      <span><b>${c.label}</b><small>${c.hint}</small></span></label>`).join('')}
  </fieldset>`;
}
