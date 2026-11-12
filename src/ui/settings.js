/**
 * Player settings that apply everywhere, kept in this browser.
 *
 * figures – how creatures are drawn on the map:
 *   'bodies' bodies seen from above where we have them (tokens otherwise), 'tokens' portrait tokens
 * pace    – how fast monsters move and strike on their turns: 'slow', 'normal' or 'fast'
 * dice    – which rolls are shown as tumbling dice: 'heroes', 'all' or 'off'
 * theme   – colours: 'auto' follows the device's light or dark mode, or force 'light' / 'dark'
 * defeat  – what happens when every hero falls (a mod setting):
 *   'death' the usual defeat screen, 'captive' the party is taken prisoner instead
 */
const KEYS = { theme: 'rpg.theme', figures: 'rpg.view', pace: 'rpg.pace', dice: 'rpg.dice', defeat: 'rpg.defeat', dmgType: 'rpg.cap.type', dmgPart: 'rpg.cap.part' };

export const SETTINGS = {
  theme: {
    legend: 'Colours', fallback: 'auto',
    choices: [
      { id: 'auto', label: 'Automatic', hint: 'Light or dark, following your device.' },
      { id: 'light', label: 'Light', hint: 'Parchment and ink.' },
      { id: 'dark', label: 'Dark', hint: 'Candlelight in a dark hall: easy on the eyes at night.' },
    ],
  },
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
  dice: {
    legend: 'Dice', fallback: 'heroes',
    choices: [
      { id: 'heroes', label: 'Show my rolls', hint: 'Watch your heroes\' dice tumble and land. Click the dice to skip.' },
      { id: 'all', label: 'Show every roll', hint: 'Monsters\' dice too: slower, but nothing is hidden.' },
      { id: 'off', label: 'No dice', hint: 'Results only, in the battle log.' },
    ],
  },
  // Toggles (checkboxes): the floating damage captions on the map ("Piercing / −4 / L leg").
  dmgType: {
    kind: 'toggle', group: 'Damage captions on the map', legend: 'Type of damage', fallback: 'on',
    hint: 'Show "Piercing", "Fire"... above the damage.', choices: [{ id: 'on' }, { id: 'off' }],
  },
  dmgPart: {
    kind: 'toggle', group: 'Damage captions on the map', legend: 'Body part hit', fallback: 'on',
    hint: 'Show "L leg", "Torso"... under the damage.', choices: [{ id: 'on' }, { id: 'off' }],
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
  if (name === 'theme') applyTheme(value);
}

/**
 * Colours. The stylesheet has a light and a dark palette: with no data-theme on <html> it follows
 * the device (prefers-color-scheme); data-theme="light" or "dark" overrides that either way.
 */
export function applyTheme(value = getSetting('theme')) {
  const root = document.documentElement;
  // Only undo a theme the game set itself (a host page may set its own data-theme).
  if (value === 'light' || value === 'dark') { root.dataset.theme = value; root.dataset.themeByGame = '1'; } else if (root.dataset.themeByGame) { delete root.dataset.theme; delete root.dataset.themeByGame; }
  const dark = value === 'dark' || (value !== 'light' && window.matchMedia?.('(prefers-color-scheme: dark)').matches);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#17130f' : '#3a2412');
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
  const out = []; let group = null;
  for (const name of names) {
    const def = SETTINGS[name]; const current = getSetting(name);
    if (def.kind === 'toggle') {
      // Toggles that share a group sit together in one box, as checkboxes.
      const box = `<label class="figure-opt toggle-opt"><input type="checkbox" name="${scope}-${name}" value="on" ${attr} data-setting="${name}" ${current === 'on' ? 'checked' : ''}>
        <span><b>${def.legend}</b><small>${def.hint}</small></span></label>`;
      if (group?.name === def.group) group.items.push(box); else { group = { name: def.group, items: [box] }; out.push(group); }
      continue;
    }
    group = null;
    out.push(`<fieldset class="figures-choice"><legend>${def.legend}</legend>
      ${def.choices.map((c) => `<label class="figure-opt"><input type="radio" name="${scope}-${name}" value="${c.id}" ${attr} data-setting="${name}" ${current === c.id ? 'checked' : ''}>
        <span><b>${c.label}</b><small>${c.hint}</small></span></label>`).join('')}
    </fieldset>`);
  }
  return out.map((x) => (typeof x === 'string' ? x : `<fieldset class="figures-choice"><legend>${x.name}</legend>${x.items.join('')}</fieldset>`)).join('');
}

/** The value a settings input stands for: a checkbox is "on" or "off", a radio its value. */
export const settingValue = (el) => (el.type === 'checkbox' ? (el.checked ? 'on' : 'off') : el.value);

/** Is the game showing dark colours right now (chosen, or following the device)? */
export const isDark = () => { const v = getSetting('theme'); return v === 'dark' || (v === 'auto' && !!window.matchMedia?.('(prefers-color-scheme: dark)').matches); };
