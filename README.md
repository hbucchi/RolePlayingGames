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

- **Two ways to start:** *Standard* heroes begin at level 1 and earn their way up. *Sandbox* heroes pick
  any level from 1 to 20 and get the hit points, wealth and magic gear of a veteran.
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
- **Rewards:** foes give XP (5e table, levels 1-20, with level-up fanfare). Their bodies can be searched
  for coins (gold, silver and copper, after the DMG individual-treasure tables) and items.
- **Items (inspired by Ultima Online):** ~150 items: SRD weapons and armour, enchanted gear named by power
  ("Longsword of Might / Power / Vanquishing", armour "of Defense / Hardening / Invulnerability"), named magic
  items, potions, bandages, tools (thieves' tools, crowbar, rope, pickaxe...), and crafting resources: logs
  from oak to goldenwood, ores from copper to mithral, hides, silk, herbs and gems.
- **Drop tables:** each kind of creature carries different things (goblins: arrows, scimitars, ore;
  spiders: silk and venom; wolves: pelts; undead: bones and grave goods). Magic is the rarest drop.
- **Inventory:** paperdoll slots (main hand, off hand, ranged, armour, cloak, neck, ring), backpack with
  filters, weight vs carrying capacity (STR × 15 lb), equip/unequip any time (armour not mid-fight), use
  and drop. Bows use up arrows; you recover half after a fight.
- **Dungeon skills:** pick locks (thieves' tools, DEX) or force them (Athletics, loud), search for traps and
  secret doors (Investigation, plus passive Perception as you walk), disarm traps, bind wounds with
  bandages (Medicine), drink potions. Chests, locked doors, traps and secret doors are seeded per dungeon.
- **Stairs down:** every dungeon has a way deeper, in the room farthest from the entrance (by walking
  distance). Take it to reach the next depth, a new dungeon, keeping your wounds and loot. Every two
  floors the foes get tougher.
- **Music:** public-domain (CC0) background music from OpenGameArt.org that follows the action
  (menu, dungeon, battle, victory and defeat), with cross-fades, an on/off button and volume.
- **Leveled encounters:** each room's foes are picked from 31 Westlands creatures using the DMG encounter
  budget for your level (level 1 meets pit-runts, spiderlings and crag bats; level 20 meets trolls and
  Hooded Riders).

- **Bestiary:** 356 creatures. That is the complete 5e SRD monster list (318) plus 38 original foes of the
  Westlands, such as the pit-runt, the crag bat, the Shadowflame Tyrant, the Ember-Wyrm, stone and cave trolls, Hooded Riders, cairn-wights,
  shadow-wolves and the Brood-Queen of the Dark Pass. Every creature has full stats, traits, actions,
  spells, legendary actions where relevant, a personality, an origin, tactics, habitats, and an
  image-ready **appearance** description. You can search and filter by type, challenge, source and
  "fits the Westlands", click any attack to roll it, and copy an image prompt.

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
    monsters.js        CR table (XP, proficiency), stat-block text, validation, filtering
    dice.js            unbiased RNG, dice notation ("4d6kh3", "1d20+5"), seeded RNG for tests
    abilities.js       scores, modifiers, standard array, point buy
    skills.js          the 18 skills
    character.js       draft model, per-step validation, derived sheet (HP, AC, bonuses...), gear, XP
    items.js           inventory, stacking, coins, weight, equipping, AC and attacks from gear
    loot.js            coin tables, drop rolls, magic items
    progression.js     XP levels, encounter budgets, sandbox starting wealth
    features.js        chests, traps, secret and locked doors, skill checks, leveled monster placement
    storage.js         roster persistence + import/export
  content/
    registry.js        list of installed settings
    westlands/         races, classes, backgrounds, premade heroes, adventure stubs
    items/             item catalogue and per-creature loot tables
    bestiary/          monster data by creature type (+ westlands.js originals), dsl.js helpers
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
| Skill check | d20 + bonus ≥ DC; P(success) = (21 − DC + bonus) / 20 |
| Encounter difficulty | sum of monster XP × crowd multiplier (1: ×1, 2: ×1.5, 3-6: ×2) vs the level's thresholds |
| Loot | each drop is an independent chance p; expected drops = Σp; P(≥1 magic in k kills) = 1 − (1 − p)^k |
| Carrying capacity | STR score × 15 lb (50 coins = 1 lb) |

## Licences and credits

- **Music** (all CC0 / public domain, from [OpenGameArt.org](https://opengameart.org)); credits given with thanks:
  RandomMind: *Medieval: Exploration*, *Medieval: Minstrel Dance*, *Fantasy: Lament for a Warrior's Soul*,
  *Medieval: Battle*, *Medieval: Victory Theme*, *Medieval: Defeat Theme*; yd: *Dungeon Ambience*;
  Paul Wortmann: *Dark Cavern Ambient*.

- Game mechanics of creatures marked "SRD 5.1" come from the *System Reference Document 5.1* by
  Wizards of the Coast LLC, available at https://dnd.wizards.com/resources/systems-reference-document,
  and licensed under the Creative Commons Attribution 4.0 International licence (CC-BY-4.0).
  Descriptive text in this project (personalities, origins, tactics, appearances) is original.
- *Tales of the Westlands* and its creatures are original works inspired by the themes of
  J.R.R. Tolkien's Middle-earth; no text or named characters from his books are used.
