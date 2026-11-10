/**
 * Player settings that apply everywhere, kept in this browser.
 *
 * figures – how creatures are drawn on the map:
 *   'bodies' bodies seen from above where we have them (tokens otherwise), 'tokens' portrait tokens
 * pace    – how fast monsters move and strike on their turns: 'slow', 'normal' or 'fast'
 * defeat  – what happens when every hero falls (a mod setting):
 *   'death' the usual defeat screen, 'captive' the party is taken prisoner instead
 */
const KEYS = { figures: 'rpg.view', pace: 'rpg.pace', defeat: 'rpg.defeat' };

export const SETTINGS = {
  figures: {
    legend: 'Creatures on the map', fallback: 'bodies',
    choices: [
      { id: 'bodies', label: 'Bodies seen from above', hint: 'Creatures drawn as figures on the floor, turned the way they face.' },
      { id: 'tokens', label: 'Portrait tokens', hint: 'Round tokens with each creature\'s painted portrait.' },
    ],
  },
  pace: {
    legend: 'Monster turns', fallback: 'normal',
    choices: [
      { id: 'slow', label: 'Slow', hint: 'Every step, shot and spell is easy to follow.' },
      { id: 'normal', label: 'Normal', hint: 'A steady pace.' },
      { id: 'fast', label: 'Fast', hint: 'For veterans who know what is coming.' },
    ],
  },
  defeat: {
    legend: 'When all heroes fall (mod)', fallback: 'death',
    choices: [
      { id: 'death', label: 'Defeat', hint: 'The delve ends; study the battlefield, then try again.' },
      { id: 'captive', label: 'Taken captive', hint: 'The monsters drag the party to their cells instead. Escaping comes in a later update.' },
    ],
  },
};

export function getSetting(name) {
  const def = SETTINGS[name];
  try {
    const v = localStorage.getItem(KEYS[name]);
    return def.choices.some((c) => c.id === v) ? v : def.fallback;
  } catch { return def.fallback; }
}
export function setSetting(name, value) {
  if (!SETTINGS[name]?.choices.some((c) => c.id === value)) return;
  try { localStorage.setItem(KEYS[name], value); } catch { /* storage blocked: lasts this visit only */ }
}
export const getFigures = () => getSetting('figures');
export const setFigures = (v) => setSetting('figures', v);

/** How much longer monster turns take: slow 1.8x, normal 1.4x, fast 1x (the old pace). */
export const PACE_FACTOR = { slow: 1.8, normal: 1.4, fast: 1 };

/**
 * Radio groups for every setting. `attr(name)` gives the attribute that wires the inputs:
 * on the start screen data-action="setting", in the game data-dg="setting".
 */
export function settingsControls(attr, names = Object.keys(SETTINGS), scope = 'x') {
  return names.map((name) => {
    const def = SETTINGS[name]; const current = getSetting(name);
    return `<fieldset class="figures-choice"><legend>${def.legend}</legend>
      ${def.choices.map((c) => `<label class="figure-opt"><input type="radio" name="${scope}-${name}" value="${c.id}" ${attr} data-setting="${name}" ${current === c.id ? 'checked' : ''}>
        <span><b>${c.label}</b><small>${c.hint}</small></span></label>`).join('')}
    </fieldset>`;
  }).join('');
}
