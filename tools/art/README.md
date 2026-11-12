# Art and sound pipeline

How creature pictures and voices are made, so any new creature can get them the same way.

## Where things live

| What | Where |
|---|---|
| A creature's look and voice | its bestiary record: `art: { portrait, body, tint, portraitTint }, voice` |
| Paintings (tokens, bestiary) | `assets/portraits/<key>-1..4.jpg` (320 px; 2 and 4 are mirrored) |
| Bodies seen from above | `assets/bodies/<key>.png` (256 px square, transparent, facing up) |
| Slain bodies, lying on their side | `assets/dead/dead-<body>.png` (head to the right, longest side 320 px) |
| Voices and effects | `assets/sounds/<key>-1..4.mp3` (4 takes, one picked at random) |
| Every sheet ever generated, its grid and prompt | `tools/art/manifest.json` |
| The generated sheets themselves | `tools/art/sheets/*.webp` (re-cut without paying again) |

`tint` and `portraitTint` are CSS filter chains (`hue-rotate(60deg) brightness(.8)`), so kin share one
picture: the sea hag is the green hag's painting turned blue. Each filter is a small matrix applied
to every pixel's (R, G, B), which is why it costs nothing at run time.

## Adding a creature

1. Write its record in `src/content/bestiary/*.js`. If an existing picture fits, point at it with
   `art` and a tint, give it a `voice`, and you are done.
2. Otherwise describe its family in `manifest.json` under `families`:
   `"owlbear": { "portrait": "a shaggy owlbear with ...", "body": "a shaggy owlbear ..." }`.
3. See what is missing: `node tools/art/missing.mjs` (also `npm test`, whose art-coverage test fails
   until every creature has its files).
4. Plan a sheet (up to 12 families per image, one image costs the same as one picture):
   `python3 tools/art/sheets.py plan portrait owlbear ...` and the same with `body`.
   It prints the prompt; generate a 1280x720 image with it (ElevenLabs, gpt-image).
5. Save the image as `tools/art/sheets/<name>.webp` and cut it:
   `python3 tools/art/sheets.py cut p12 tools/art/sheets/p12.webp`.
6. Look at the bodies. If a neighbour's wing crept into a cell, re-cut that one from a box inside
   its cell: `... cut b11 tools/art/sheets/b11.webp --only owlbear --box 40 0 320 230`.
   For see-through creatures (ghosts, whirlwinds) add `--soft`.

### Slain bodies
Every body has a dead twin, `body-X` → `assets/dead/dead-X.png` (the art-coverage test checks it). Dead
sheets name body files and reuse each body's description, "lying dead" (a family can say what it leaves
instead: `"dead": "a smoking heap of embers..."`):
`python3 tools/art/sheets.py plan dead fam-owlbear man ...`, then cut with
`KEEP=0.005 EDGE_DROP=1 python3 tools/art/sheets.py cut d1 tools/art/sheets/d1.webp`
(small loose weapons kept; neighbour slivers touching the cell edge dropped). Bodies that spill
over their cell: `--box` may reach past it (`--box -40 0 320 240`); white creatures: `TOL=10`.
The ten dead dragons are one painting recoloured: `python3 tools/art/open-wings.py dead`.

### How the body cutout works (`cutout.py`)
- **Flood fill from the border.** It spreads from the image edge through pixels close to the grey
  background, so grey inside a figure (a steel helm) survives: it isn't connected to the edge.
- **Enclosed pockets.** Larger pockets of pure background inside the figure (between a bow and its
  string) are removed with a tighter tolerance.
- **Neighbour specks.** Pieces much smaller than the figure (less than 4%; the `KEEP` environment
  variable) are dropped.
- **Soft edges.** The edge of the mask is shrunk by a pixel and blurred, so figures don't look
  pasted on.
- **See-through creatures (`--soft`).** Opacity grows with distance from the background colour,
  and the true colour comes from solving the blending equation C = a·F + (1 − a)·B for F.

## Adding a voice or a sound

Generate four takes of the effect, then
`python3 tools/art/sound.py beast-attack 1.6 a.mp3 b.mp3 c.mp3 d.mp3`
and add the key to `SOUND_KEYS` in `src/ui/audio.js`. For a new voice family, also teach
`voiceSound` which key each moment (attack, hurt, death) uses.

## Publishing

`npm run build` bundles the pictures and sounds into a few pack files for the hosted page (see
`tools/build.mjs`); nothing here needs to change for that.
