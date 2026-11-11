/**
 * Stories written as data. A story is a graph of scenes: each scene has text, and either choices,
 * a battle, or an ending. Writers add stories in src/content/stories/ without touching code, and
 * validateStory (run by the tests for every story) catches broken links, unreachable scenes,
 * dead ends and unknown creatures, items or skills.
 *
 * Story:  { id, title, blurb, levels, length, start: sceneId, scenes: { [id]: Scene } }
 * Scene:  { text, effects?: Effect[], choices?: Choice[], battle?: Battle, end?: 'victory' | 'defeat' | 'retreat' }
 * Choice: { text, to?: sceneId,                         go straight to a scene
 *           check?: { skill, dc }, success?: sceneId, failure?: sceneId,   or roll a skill check
 *           requires?: { flag?, notFlag? }, set?: [flag], unset?: [flag] }
 * Battle: { foes: [creatureId], terrain?: 'cobbles' | 'grass' | ..., win: sceneId, lose: sceneId }
 * Effect: { xp: n } | { coins: copper } | { item: itemId, qty? } | { heal: 'all' }
 *
 * Progress is plain data too ({ storyId, scene, flags, visited, log }), so it can be saved and
 * resumed. The engine never touches heroes: it returns the effects and checks for the game to apply.
 */

export function startStory(story) {
  return { storyId: story.id, scene: story.start, flags: [], visited: [story.start], log: [], ended: null };
}

export const sceneOf = (story, progress) => story.scenes[progress.scene];

const allowed = (choice, flags) => (!choice.requires?.flag || flags.includes(choice.requires.flag))
  && (!choice.requires?.notFlag || !flags.includes(choice.requires.notFlag));

/** The choices open right now (choices whose requirements are not met are hidden). */
export function choicesFor(story, progress) {
  return (sceneOf(story, progress).choices ?? []).map((c, index) => ({ ...c, index })).filter((c) => allowed(c, progress.flags));
}

/**
 * Take a choice. `rollCheck(skill, dc)` is supplied by the game and returns { success, text }.
 * Returns the new progress (the old one is not changed) and the effects of the scene reached.
 */
export function choose(story, progress, index, { rollCheck } = {}) {
  const choice = sceneOf(story, progress).choices?.[index];
  if (!choice || !allowed(choice, progress.flags)) throw new Error(`No such choice: ${index}`);
  let to = choice.to; let note = choice.text;
  if (choice.check) {
    const r = rollCheck(choice.check.skill, choice.check.dc);
    to = r.success ? choice.success : choice.failure;
    note = `${choice.text}: ${r.text}`;
  }
  const flags = [...new Set([...progress.flags, ...(choice.set ?? [])])].filter((f) => !(choice.unset ?? []).includes(f));
  return arrive(story, { ...progress, flags, log: [...progress.log, note] }, to);
}

/** After a battle: go to its win or lose scene. */
export function battleOver(story, progress, won) {
  const b = sceneOf(story, progress).battle;
  return arrive(story, { ...progress, log: [...progress.log, won ? 'The battle is won.' : 'The battle is lost.'] }, won ? b.win : b.lose);
}

function arrive(story, progress, to) {
  const scene = story.scenes[to];
  const next = { ...progress, scene: to, visited: [...new Set([...progress.visited, to])], ended: scene.end ?? null };
  return { progress: next, effects: scene.effects ?? [] };
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/** Every scene id a scene can lead to. */
export function exitsOf(scene) {
  const out = [];
  for (const c of scene.choices ?? []) out.push(...[c.to, c.success, c.failure].filter(Boolean));
  if (scene.battle) out.push(scene.battle.win, scene.battle.lose);
  return out;
}

/**
 * Problems with a story, as readable sentences (empty when it is sound).
 * known: { creatures: Set, items: Set, skills: Set, terrains: Set }
 */
export function validateStory(story, known) {
  const issues = []; const say = (t) => issues.push(`${story.id}: ${t}`);
  for (const k of ['id', 'title', 'start', 'scenes']) if (!story[k]) say(`missing "${k}"`);
  if (!story.scenes) return issues;
  if (!story.scenes[story.start]) say(`start scene "${story.start}" does not exist`);
  const flagsSet = new Set(); const flagsNeeded = new Set();
  for (const [id, sc] of Object.entries(story.scenes)) {
    const where = `scene "${id}"`;
    if (!sc.text?.trim()) say(`${where} has no text`);
    const ways = Number(!!sc.choices?.length) + Number(!!sc.battle) + Number(!!sc.end);
    if (ways !== 1) say(`${where} needs exactly one of: choices, a battle, or an end`);
    if (sc.end && !['victory', 'defeat', 'retreat'].includes(sc.end)) say(`${where} has an unknown end "${sc.end}"`);
    for (const to of exitsOf(sc)) if (!story.scenes[to]) say(`${where} leads to missing scene "${to}"`);
    for (const [i, c] of (sc.choices ?? []).entries()) {
      const w = `${where}, choice ${i + 1}`;
      if (!c.text?.trim()) say(`${w} has no text`);
      if (c.check) {
        if (!known.skills.has(c.check.skill)) say(`${w} checks unknown skill "${c.check.skill}"`);
        if (!(c.check.dc >= 5 && c.check.dc <= 30)) say(`${w} has a DC outside 5-30`);
        if (!c.success || !c.failure) say(`${w} has a check but not both success and failure`);
        if (c.to) say(`${w} has both a check and "to"`);
      } else if (!c.to) say(`${w} leads nowhere`);
      for (const f of c.set ?? []) flagsSet.add(f);
      for (const f of [c.requires?.flag, c.requires?.notFlag].filter(Boolean)) flagsNeeded.add(f);
    }
    if (sc.battle) {
      if (!sc.battle.foes?.length) say(`${where} has a battle with no foes`);
      for (const f of sc.battle.foes ?? []) if (!known.creatures.has(f)) say(`${where} fights unknown creature "${f}"`);
      if (sc.battle.terrain && !known.terrains.has(sc.battle.terrain)) say(`${where} has unknown terrain "${sc.battle.terrain}"`);
    }
    for (const e of sc.effects ?? []) {
      if (e.item && !known.items.has(e.item)) say(`${where} gives unknown item "${e.item}"`);
      if (e.xp !== undefined && !(e.xp > 0)) say(`${where} gives a bad amount of XP`);
      if (e.coins !== undefined && !(e.coins > 0)) say(`${where} gives a bad amount of coins`);
    }
  }
  for (const f of flagsNeeded) if (!flagsSet.has(f)) say(`flag "${f}" is required but never set`);
  // Every scene must be reachable from the start, and every scene must be able to reach an end.
  const reach = new Set(); const todo = [story.start];
  while (todo.length) { const id = todo.pop(); if (reach.has(id) || !story.scenes[id]) continue; reach.add(id); todo.push(...exitsOf(story.scenes[id])); }
  for (const id of Object.keys(story.scenes)) if (!reach.has(id)) say(`scene "${id}" can never be reached`);
  const ends = new Set(Object.entries(story.scenes).filter(([, sc]) => sc.end).map(([id]) => id));
  let grew = true;
  while (grew) {
    grew = false;
    for (const [id, sc] of Object.entries(story.scenes)) if (!ends.has(id) && exitsOf(sc).some((to) => ends.has(to))) { ends.add(id); grew = true; }
  }
  for (const id of Object.keys(story.scenes)) if (!ends.has(id)) say(`scene "${id}" can never reach an ending (a loop with no way out)`);
  return issues;
}
