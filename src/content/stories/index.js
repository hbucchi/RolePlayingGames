// Every story. Add a story file next to this one and list it here; the story test checks it.
import { barrowOfTheLostKing } from './barrow-of-the-lost-king.js';

export const STORIES = [barrowOfTheLostKing];
export const STORIES_BY_ID = Object.fromEntries(STORIES.map((s) => [s.id, s]));
