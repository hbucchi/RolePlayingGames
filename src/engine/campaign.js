/**
 * Campaigns: a world map of locations joined by roads, each location a map of its own with people,
 * foes and chests, and quests that move forward through flags. Everything is data (see
 * src/content/campaigns/); this engine runs it and checks it.
 *
 * Campaign: { id, title, blurb, levels, map: { image, w, h }, start, locations: { [id]: Location },
 *             roads: [[a, b]], quest: { title, steps: [{ id, text, done: flag, shown?: flag }] } }
 * Location: { name, kind, x, y (in % of the world map), vignette, blurb, discovered?,
 *             rows: [...terrain codes and markers], legend: { char: Marker }, reveal?, music? }
 * Marker:   { on: terrain, hero?: true, exit?: true, npc?: Npc, foe?: statId, chest?: Chest }
 * Npc:      { id, name, stat, greet: [Line], options?: [Option], shop?: [itemId] }
 * Line:     { if?: Cond, say }   (the first line whose condition holds is said)
 * Option:   { label, if?: Cond, say, set?, discover?, needItem?, takeItem?, price?, give?: Reward,
 *             heal?: true, once?: flag }   (an option with `once` disappears after its flag is set)
 * Chest:    { id, coins?, items?: [itemId], event?: { set?, discover?, say } }
 * Cond:     { flag?, notFlag?, flags?: [...] }
 * Reward:   { xp?, coins?, items?: [itemId] }   (coins in copper: 100 cp = 1 gp)
 *
 * A run (saved progress) is plain data: { at, discovered, visited, flags, party, log }.
 */

export function newRun(c) {
  const discovered = Object.entries(c.locations).filter(([, l]) => l.discovered).map(([id]) => id);
  return { campaignId: c.id, at: c.start, discovered: [...new Set([c.start, ...discovered])], visited: [c.start], flags: [], party: [], log: [] };
}

export const holds = (cond, run) => !cond
  || ((!cond.flag || run.flags.includes(cond.flag)) && (!cond.notFlag || !run.flags.includes(cond.notFlag))
    && (cond.flags ?? []).every((f) => run.flags.includes(f)));

/** Roads between discovered places. Returns the shortest route from the current place, or null. */
export function route(c, run, to) {
  if (!run.discovered.includes(to)) return null;
  const prev = new Map([[run.at, null]]); const queue = [run.at];
  while (queue.length) {
    const here = queue.shift();
    if (here === to) break;
    for (const [a, b] of c.roads) {
      const next = a === here ? b : b === here ? a : null;
      if (next && !prev.has(next) && run.discovered.includes(next)) { prev.set(next, here); queue.push(next); }
    }
  }
  if (!prev.has(to)) return null;
  const path = []; for (let p = to; p; p = prev.get(p)) path.unshift(p);
  return path;
}

export function travel(c, run, to) {
  const path = route(c, run, to);
  if (!path) return { run, path: null };
  return { run: { ...run, at: to, visited: [...new Set([...run.visited, to])] }, path };
}

const apply = (run, { set = [], discover = [], say = null } = {}) => ({
  ...run,
  flags: [...new Set([...run.flags, ...set])],
  discovered: [...new Set([...run.discovered, ...discover])],
  log: say ? [...run.log, say] : run.log,
});

// ---------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------

export function npcOf(c, npcId) {
  for (const [locId, loc] of Object.entries(c.locations)) {
    for (const m of Object.values(loc.legend ?? {})) if (m.npc?.id === npcId) return { ...m.npc, locId };
  }
  return null;
}

/** What a person says now and what you can ask or do: { greet, options: [{ i, label, price, why }], shop }. */
export function npcView(c, run, npcId, wallet = {}) {
  const npc = npcOf(c, npcId); if (!npc) return null;
  const greet = (npc.greet ?? []).find((l) => holds(l.if, run))?.say ?? '';
  const options = (npc.options ?? []).map((o, i) => ({ ...o, i }))
    .filter((o) => holds(o.if, run) && !(o.once && run.flags.includes(o.once)))
    .map((o) => ({ i: o.i, label: o.label, price: o.price ?? 0,
      why: o.needItem && !wallet.has?.(o.needItem) ? 'you do not have it' : o.price && (wallet.coins ?? 0) < o.price ? 'not enough coin' : '' }));
  return { name: npc.name, stat: npc.stat, greet, options, shop: npc.shop ?? [] };
}

/**
 * Choose an option. Returns { run, say, effects } where effects are for the game to apply to the
 * party: { coins: n } (negative = pay), { item }, { takeItem }, { xp }, { heal: true }.
 */
export function npcChoose(c, run, npcId, i, wallet = {}) {
  const npc = npcOf(c, npcId); const o = npc?.options?.[i];
  if (!o || !holds(o.if, run) || (o.once && run.flags.includes(o.once))) return { run, say: null, effects: [] };
  if (o.needItem && !wallet.has?.(o.needItem)) return { run, say: o.missing ?? `${npc.name} looks at you expectantly. You do not have it.`, effects: [] };
  if (o.price && (wallet.coins ?? 0) < o.price) return { run, say: `You cannot afford it (${o.price} cp).`, effects: [] };
  const effects = [];
  if (o.price) effects.push({ coins: -o.price });
  if (o.takeItem) effects.push({ takeItem: o.needItem });
  if (o.heal) effects.push({ heal: true });
  if (o.give?.coins) effects.push({ coins: o.give.coins });
  for (const it of o.give?.items ?? []) effects.push({ item: it });
  if (o.give?.xp) effects.push({ xp: o.give.xp });
  const say = `${npc.name}: “${o.say}”`;
  return { run: apply(run, { set: [...(o.set ?? []), ...(o.once ? [o.once] : [])], discover: o.discover, say }), say, effects };
}

/** Something happened in a location (a chest opened, a creature killed): run its event, if any. */
export function locationEvent(c, run, locId, e) {
  const loc = c.locations[locId]; if (!loc) return { run, say: null };
  if (e.kind === 'chest') {
    const chest = Object.values(loc.legend ?? {}).find((m) => m.chest?.id === e.id)?.chest;
    if (chest?.event && !(chest.event.once && run.flags.includes(chest.event.once))) {
      return { run: apply(run, { ...chest.event, set: [...(chest.event.set ?? [])] }), say: chest.event.say ?? null };
    }
  }
  if (e.kind === 'cleared' && loc.onCleared && holds(loc.onCleared.if, run)) return { run: apply(run, loc.onCleared), say: loc.onCleared.say ?? null };
  return { run, say: null };
}

/** The quest journal: each step with done / current / hidden. */
export function journal(c, run) {
  let current = false;
  return (c.quest?.steps ?? []).map((st) => {
    const done = run.flags.includes(st.done);
    const shown = done || !st.shown || run.flags.includes(st.shown);
    const state = done ? 'done' : shown && !current ? 'current' : 'later';
    if (state === 'current') current = true;
    return { ...st, state };
  }).filter((st) => st.state !== 'later' || !st.hidden);
}

export const questDone = (c, run) => (c.quest?.steps ?? []).every((st) => run.flags.includes(st.done));

// ---------------------------------------------------------------------------
// Location maps: rows of terrain codes with markers from the legend
// ---------------------------------------------------------------------------

/** Parse a location's rows into { terrainRows, hero: [cells], exits, npcs, foes, chests }. */
export function parseLocation(loc, codeOf) {
  const out = { terrainRows: [], heroes: [], exits: [], npcs: [], foes: [], chests: [] };
  loc.rows.forEach((row, y) => {
    let line = '';
    [...row].forEach((ch, x) => {
      const m = loc.legend?.[ch];
      if (!m) { line += ch; return; }
      line += codeOf(m.on ?? 'floor');
      const at = { x, y };
      if (m.hero) out.heroes.push(at);
      if (m.exit) out.exits.push(at);
      if (m.npc) out.npcs.push({ ...m.npc, pos: at, facing: m.facing ?? 4 });
      if (m.foe) out.foes.push({ statId: m.foe, pos: at, facing: m.facing ?? 4 });
      if (m.chest) out.chests.push({ ...m.chest, pos: at });
    });
    out.terrainRows.push(line);
  });
  return out;
}

// ---------------------------------------------------------------------------
// Validation (run by the tests for every campaign)
// ---------------------------------------------------------------------------

export function validateCampaign(c, known) {
  const issues = []; const say = (t) => issues.push(`${c.id}: ${t}`);
  if (!c.locations[c.start]) say(`start "${c.start}" is not a location`);
  for (const [a, b] of c.roads) for (const id of [a, b]) if (!c.locations[id]) say(`road to unknown place "${id}"`);
  const flagsSet = new Set(); const flagsUsed = new Set();
  const cond = (cd) => { for (const f of [cd?.flag, cd?.notFlag, ...(cd?.flags ?? [])].filter(Boolean)) flagsUsed.add(f); };
  const discoverable = new Set([c.start, ...Object.entries(c.locations).filter(([, l]) => l.discovered).map(([id]) => id)]);
  for (const [id, loc] of Object.entries(c.locations)) {
    const where = `location "${id}"`;
    if (!(loc.x >= 0 && loc.x <= 100 && loc.y >= 0 && loc.y <= 100)) say(`${where} is off the world map`);
    if (!c.roads.some(([a, b]) => a === id || b === id)) say(`${where} has no road`);
    if (loc.story) { if (!known.stories.has(loc.story)) say(`${where} opens unknown story "${loc.story}"`); continue; } // a tale, not a map
    for (const k of ['name', 'kind', 'rows']) if (!loc[k]) say(`${where} has no ${k}`);
    const w = loc.rows?.[0]?.length;
    if (loc.rows?.some((r) => r.length !== w)) say(`${where}: map rows have different lengths`);
    for (const ch of new Set((loc.rows ?? []).join(''))) if (!loc.legend?.[ch] && !known.codes.has(ch)) say(`${where}: unknown map symbol "${ch}"`);
    const p = parseLocation(loc, (t) => known.codeOf(t));
    if (!p.heroes.length) say(`${where} has no starting square (hero)`);
    if (!p.exits.length) say(`${where} has no way out (exit)`);
    for (const n of p.npcs) {
      if (!known.creatures.has(n.stat)) say(`${where}: ${n.name} uses unknown creature "${n.stat}"`);
      for (const it of n.shop ?? []) if (!known.items.has(it)) say(`${where}: ${n.name} sells unknown item "${it}"`);
      for (const l of n.greet ?? []) cond(l.if);
      if (!(n.greet ?? []).some((l) => !l.if)) say(`${where}: ${n.name} needs a greeting with no condition`);
      for (const o of n.options ?? []) {
        cond(o.if); for (const f of o.set ?? []) flagsSet.add(f); if (o.once) flagsSet.add(o.once);
        for (const d of o.discover ?? []) { if (!c.locations[d]) say(`${where}: ${n.name} reveals unknown place "${d}"`); discoverable.add(d); }
        for (const it of [o.needItem, ...(o.give?.items ?? [])].filter(Boolean)) if (!known.items.has(it)) say(`${where}: ${n.name} uses unknown item "${it}"`);
        if (!o.say) say(`${where}: ${n.name}'s option "${o.label}" says nothing`);
      }
    }
    for (const f of p.foes) if (!known.creatures.has(f.statId)) say(`${where}: unknown foe "${f.statId}"`);
    for (const ch of p.chests) {
      for (const it of ch.items ?? []) if (!known.items.has(it)) say(`${where}: chest "${ch.id}" holds unknown item "${it}"`);
      for (const f of ch.event?.set ?? []) flagsSet.add(f);
      for (const d of ch.event?.discover ?? []) discoverable.add(d);
    }
    for (const f of loc.onCleared?.set ?? []) flagsSet.add(f);
    for (const d of loc.onCleared?.discover ?? []) discoverable.add(d);
  }
  for (const f of flagsUsed) if (!flagsSet.has(f)) say(`flag "${f}" is checked but never set`);
  for (const st of c.quest?.steps ?? []) if (!flagsSet.has(st.done)) say(`quest step "${st.id}" can never be done (flag "${st.done}" is never set)`);
  for (const id of Object.keys(c.locations)) if (!discoverable.has(id)) say(`location "${id}" can never be found`);
  return issues;
}
