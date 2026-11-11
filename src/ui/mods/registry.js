/**
 * Extension points for mods: optional rules and scenes that plug into the game without changing
 * its core. A mod is a module in this folder that registers itself here; mods/index.js loads them.
 *
 * Defeat modes: what happens when every hero falls, beyond the defeat card. The id is the value of
 * the "When all heroes fall" setting (settings.js); the handler gets the dungeon screen's ctx
 * (state `s`, `party()`, `defeatButtons()`, `$`...) and may draw into the end screen.
 */
const DEFEAT_MODES = new Map();
export function registerDefeatMode(id, handler) { DEFEAT_MODES.set(id, handler); }
export const defeatMode = (id) => DEFEAT_MODES.get(id) ?? null;
