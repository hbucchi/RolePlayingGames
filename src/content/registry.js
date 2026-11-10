/** All available settings. Add a new world by creating a content pack and listing it here. */
import { westlands } from './westlands/index.js';

const SETTINGS = [westlands];

export const listSettings = () => SETTINGS;
export const getSetting = (id) => SETTINGS.find((s) => s.id === id) ?? null;
export const DEFAULT_SETTING_ID = westlands.id;
