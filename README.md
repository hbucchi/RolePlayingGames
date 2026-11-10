# Westlands Hero Forge

A browser-based tabletop RPG built on 5th-edition-style rules (from the 5e System Reference Document).
Players pick an adventure, build or choose heroes, and play on demand.

This first milestone is **character creation** for *Tales of the Westlands*, a setting inspired by
Tolkien's Middle-earth.

## Run it

Needs Node 20+ and no dependencies.

```bash
npm start      # http://localhost:5173
npm test       # rules-engine tests
```

## What's in it

- **Six-step creation wizard:** name & concept → kindred (race) → calling (class) → abilities →
  background & skills → review.
- **Three ways to set ability scores:** roll 4d6 and drop the lowest (animated dice), the standard
  array, or 27-point buy. You place rolled values onto abilities yourself, or let "auto-place" sort
  them by your calling's priorities.
- **A calculated character sheet:** AC, HP, saving throws, skills, attacks, features. Click anything
  to roll a d20 in the dice tray.
- **Roster:** heroes are saved in browser storage. You can export or import them as JSON, or adopt one
  of four ready-made heroes.
- **Adventures tab:** placeholder adventures, plus a playable **Dungeon Sandbox**.
- **Dungeon generator:** procedural 32×32-square dungeons (each square = 5 ft, 64 px, for a 2048×2048 board),
  with 14–20 small, medium and large rooms joined by doors and corridors. Every dungeon is reproducible
  from its seed number.
- **Grid movement:** speed ÷ 5 ft = squares per turn. Supports the standard and the 5-10-5 diagonal rules,
  no corner-cutting, and Dash.

### Exporting a dungeon board

```bash
node tools/export-dungeon.mjs 7 first-delve
```

This writes `assets/dungeons/first-delve.json` (the grid data), plus `-board.jpg` (painted, no grid) and
`-grid.jpg` (with grid, room numbers and coordinates), both 2048×2048. Floor, rock and door textures in
`assets/textures/` were generated with ElevenLabs image generation and made seamless; the renderer applies
them square by square from the grid data, so the art always lines up with the grid.

## Layout

```
src/
  engine/              pure rules, no DOM: easy to test and reuse on a server later
    dungeon.js         room placement, MST + A* corridors, doors, connectivity checks
    dungeon-render.js  grid data -> layered SVG board (textures, walls, grid, doors, labels)
    movement.js        Dijkstra reachability, diagonal rules, paths
    dice.js            unbiased RNG, dice notation ("4d6kh3", "1d20+5"), seeded RNG for tests
    abilities.js       scores, modifiers, standard array, point buy
    skills.js          the 18 skills
    character.js       draft model, per-step validation, derived sheet (HP, AC, bonuses...)
    storage.js         roster persistence + import/export
  content/
    registry.js        list of installed settings
    westlands/         races, classes, backgrounds, premade heroes, adventure stubs
  ui/                  rendering + events (vanilla JS, no framework); dungeon-view.js = explorer
assets/textures/       AI-generated, seamless floor / rock / door textures
assets/dungeons/       exported boards
tools/                 export scripts
tests/                 node:test suites for the engine
```

**Design rule:** a saved character stores only the player's *choices* (race id, class id, base scores,
picked skills). Every number on the sheet is *derived* from those choices each time it's shown.
Fixing a rule or rebalancing a class therefore updates every existing hero automatically.

To add a new world, create `src/content/<world>/` with the same shape as `westlands/` and list it in
`registry.js`.

## Rules reference (the maths)

| Concept | Formula |
|---|---|
| Ability modifier | `floor((score − 10) / 2)` |
| Proficiency bonus | `2 + floor((level − 1) / 4)` |
| Skill / save bonus | ability modifier (+ proficiency bonus if trained) |
| Level-1 HP | hit-die maximum + CON modifier |
| Armour Class | armour base + DEX mod (capped by armour type) + 2 with a shield; unarmoured = 10 + DEX |
| Attack bonus | STR or DEX modifier + proficiency bonus |
| Passive Perception | 10 + Perception bonus |
