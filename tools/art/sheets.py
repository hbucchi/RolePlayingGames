"""Art sheets: plan them, write their prompts, cut them into game files.

A sheet is one generated image holding a grid of creatures (4 x 3 = 12 per image is the cheapest
way to make many pictures). manifest.json keeps every sheet: its kind (portrait or body), grid
size, the family keys in reading order (left to right, top to bottom) and the prompt used.

  python3 tools/art/sheets.py plan portrait KEY KEY ...   add a sheet for these families, print its prompt
  python3 tools/art/sheets.py prompt NAME                 print a sheet's prompt again
  python3 tools/art/sheets.py cut NAME IMAGE.png          cut a generated sheet into game files
  python3 tools/art/sheets.py cut NAME IMAGE.png --only KEY --box X0 Y0 X1 Y1 [--soft]
                                                          re-cut one cell from a box inside it
                                                          (cell pixels), e.g. to drop a neighbour's wing

Portraits go to assets/portraits/fam-KEY-1..4.jpg (2 and 4 mirrored), bodies to
assets/bodies/body-fam-KEY.png. Then point the creature's record at them:
  art: { portrait: 'fam-KEY', body: 'body-fam-KEY', tint: '...' }
"""
import json, os, sys
from PIL import Image, ImageOps

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, HERE)
from cutout import body_from  # noqa: E402

MANIFEST = os.path.join(HERE, 'manifest.json')


def load(): return json.load(open(MANIFEST))
def save(m): json.dump(m, open(MANIFEST, 'w'), indent=1); print('manifest updated')


def prompt_for(m, kind, keys, cols, rows):
    head = m['templates'][kind].format(cols=cols, rows=rows, n=len(keys))
    suffix = ' seen from above' if kind == 'body' else ''
    out = [head]
    for r in range(rows):
        row = keys[r * cols:(r + 1) * cols]
        if row: out.append(f'Row {r + 1}, left to right: ' + '; '.join(m['families'][k][kind] + suffix for k in row) + '.')
    return ' '.join(out)


def plan(kind, keys):
    m = load()
    missing = [k for k in keys if kind not in m['families'].get(k, {})]
    if missing:
        sys.exit(f'Describe these first in manifest.json "families" (a "{kind}" line each): {missing}')
    cols = 4; rows = (len(keys) + cols - 1) // cols
    name = ('p' if kind == 'portrait' else 'b') + str(1 + sum(s['kind'] == kind for s in m['sheets']))
    sheet = {'kind': kind, 'name': name, 'cols': cols, 'rows': rows, 'keys': keys, 'prompt': prompt_for(m, kind, keys, cols, rows)}
    m['sheets'].append(sheet); save(m)
    print(f'\nSheet {name} ({cols}x{rows}). Generate a 1280x720 image with this prompt:\n\n{sheet["prompt"]}')


def cut(name, image, only=None, box=None, soft=False):
    m = load(); s = next(x for x in m['sheets'] if x['name'] == name)
    im = Image.open(image).convert('RGB'); W, H = im.size; cw, ch = W // s['cols'], H // s['rows']
    for i, key in enumerate(s['keys']):
        if only and key != only: continue
        r, c = divmod(i, s['cols']); x0, y0 = c * cw, r * ch
        if s['kind'] == 'portrait':
            side = ch - 8; cx = x0 + cw // 2
            p = im.crop((cx - side // 2, y0 + 4, cx + side // 2, y0 + 4 + side)).resize((320, 320), Image.LANCZOS)
            for v in (1, 2, 3, 4):
                (ImageOps.mirror(p) if v % 2 == 0 else p).save(os.path.join(ROOT, f'assets/portraits/fam-{key}-{v}.jpg'), quality=84)
        else:
            cell = im.crop((x0 + box[0], y0 + box[1], x0 + box[2], y0 + box[3]) if box else (x0, y0, x0 + cw, y0 + ch))
            body_from(cell, 'soft' if soft else 'hard').save(os.path.join(ROOT, f'assets/bodies/body-fam-{key}.png'), optimize=True)
        print('cut', key)


if __name__ == '__main__':
    a = sys.argv[1:]
    if not a: sys.exit(__doc__)
    if a[0] == 'plan': plan(a[1], a[2:])
    elif a[0] == 'prompt': print(next(x for x in load()['sheets'] if x['name'] == a[1])['prompt'])
    elif a[0] == 'cut':
        only = a[a.index('--only') + 1] if '--only' in a else None
        box = [int(v) for v in a[a.index('--box') + 1:a.index('--box') + 5]] if '--box' in a else None
        cut(a[1], a[2], only, box, '--soft' in a)
    else: sys.exit(__doc__)
