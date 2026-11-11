/**
 * Metric units for everything the player reads. The rules keep their own numbers (the 5e SRD
 * counts in feet and pounds, and monster abilities are read from that text), and only what is
 * shown is converted:
 *
 *   distance: one square is 5 ft = 1.5 m, so metres = feet x 0.3 (30 ft = 9 m, 60 ft = 18 m)
 *   weight:   1 lb = 0.4536 kg; shown rounded (55 lb = 25 kg, 0.05 lb = 0.02 kg)
 *
 * (The tabletop habit of 1 square = 1.5 m is not an exact conversion: 5 ft is 1.524 m. Using
 * 1.5 keeps every distance a tidy multiple of a square.)
 */
export const M_PER_FT = 0.3;
export const KG_PER_LB = 0.45359237;

const tidy = (n, places) => {
  const r = Math.round(n * 10 ** places) / 10 ** places;
  return r.toLocaleString('en', { maximumFractionDigits: places });
};

/** Feet as metres, e.g. 30 -> "9", 5 -> "1.5". */
export const metres = (ft) => tidy(ft * M_PER_FT, 1);
/** "9 m" */
export const m = (ft) => `${metres(ft)} m`;

/** Pounds as kilograms: one decimal, two for very light things (a ring), whole above 100. */
export function kilos(lb) {
  const k = lb * KG_PER_LB;
  return tidy(k, k >= 100 ? 0 : k < 0.1 ? 2 : 1);
}
/** "25 kg" */
export const kg = (lb) => `${kilos(lb)} kg`;

/**
 * Rewrite feet and pounds inside free text (descriptions, monster stat blocks, rules notes):
 * "within 30 feet" -> "within 9 m", "a 15-foot cone" -> "a 4.5-metre cone",
 * "range 80/320" -> "range 24/96 m", "weighs 10 lb." -> "weighs 4.5 kg.".
 */
export function metricText(text) {
  if (typeof text !== 'string' || !/\d/.test(text)) return text;
  // "ft." and "lb." may also end a sentence: keep that full stop.
  const stop = (dot, rest) => (dot && (/^\s+[A-Z(]/.test(rest) || /^['"`)]/.test(rest) || rest === '') ? '.' : '');
  return text
    .replace(/\b(range|thrown) (\d+)\/(\d+)\b(?! ?(?:ft|feet|m)\b)/g, (_, w, a, b) => `${w} ${metres(+a)}/${metres(+b)} m`)
    .replace(/(\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?) ?(?:ft(\.)?|feet)(?=\W|$)/g, (_, a, b, dot, at, s) => `${metres(+a)}/${metres(+b)} m${stop(dot, s.slice(at + _.length))}`)
    .replace(/(\d+(?:\.\d+)?)-(?:foot|feet)\b/g, (_, a) => `${metres(+a)}-metre`)
    .replace(/(\d+(?:,\d{3})*(?:\.\d+)?) ?(?:ft(\.)?|feet|foot)(?=\W|$)/g, (_, a, dot, at, s) => `${metres(+a.replace(/,/g, ''))} m${stop(dot, s.slice(at + _.length))}`)
    .replace(/(\d+(?:\.\d+)?) ?(?:lbs?(\.)?|pounds?)(?=\W|$)/g, (_, a, dot, at, s) => `${kg(+a)}${stop(dot, s.slice(at + _.length))}`);
}
