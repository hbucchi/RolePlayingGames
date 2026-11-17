// Every creature's body sprite and tint, as JSON (for colour-check.py).
import { BESTIARY } from '../../src/content/bestiary/index.js';
console.log(JSON.stringify(BESTIARY.map((m) => ({ id: m.id, type: m.type, body: m.art.body, tint: m.art.tint ?? '' }))));
