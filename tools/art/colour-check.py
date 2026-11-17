"""How colourful is each creature on the map? Applies its CSS tint (art.tint) to its body sprite,
as the browser does, and prints the mean saturation of what is left, greyest first.

    node tools/art/colour-dump.mjs | python3 tools/art/colour-check.py [limit]

CSS filters are 3x3 matrices on (R, G, B) (the W3C filter-effects definitions), applied in order.
"""
import json, re, sys, math
import numpy as np
from PIL import Image

def grayscale(a): k = 1 - a; return np.array([[.2126 + .7874 * k, .7152 - .7152 * k, .0722 - .0722 * k], [.2126 - .2126 * k, .7152 + .2848 * k, .0722 - .0722 * k], [.2126 - .2126 * k, .7152 - .7152 * k, .0722 + .9278 * k]])
def sepia(a): k = 1 - a; return np.array([[.393 + .607 * k, .769 - .769 * k, .189 - .189 * k], [.349 - .349 * k, .686 + .314 * k, .168 - .168 * k], [.272 - .272 * k, .534 - .534 * k, .131 + .869 * k]])
def saturate(s): return np.array([[.213 + .787 * s, .715 - .715 * s, .072 - .072 * s], [.213 - .213 * s, .715 + .285 * s, .072 - .072 * s], [.213 - .213 * s, .715 - .715 * s, .072 + .928 * s]])
def hue(deg):
    c, s = math.cos(math.radians(deg)), math.sin(math.radians(deg))
    return np.array([[.213 + c * .787 - s * .213, .715 - c * .715 - s * .715, .072 - c * .072 + s * .928], [.213 - c * .213 + s * .143, .715 + c * .285 + s * .140, .072 - c * .072 - s * .283], [.213 - c * .213 - s * .787, .715 - c * .715 + s * .715, .072 + c * .928 + s * .072]])

def apply(rgb, tint):
    for name, arg in re.findall(r'([a-z-]+)\(([^)]*)\)', tint or ''):
        v = float(re.sub(r'[a-z%]+$', '', arg.split()[0])) if arg and name != 'drop-shadow' else 0
        if name == 'grayscale': rgb = rgb @ grayscale(min(v, 1)).T
        elif name == 'sepia': rgb = rgb @ sepia(min(v, 1)).T
        elif name == 'saturate': rgb = rgb @ saturate(v).T
        elif name == 'hue-rotate': rgb = rgb @ hue(v).T
        elif name == 'brightness': rgb = rgb * v
        elif name == 'contrast': rgb = (rgb - .5) * v + .5
        rgb = np.clip(rgb, 0, 1)
    return rgb

def look(body, tint):
    im = np.asarray(Image.open(f'assets/bodies/{body}.png').convert('RGBA')).astype(float) / 255
    rgb = apply(im[..., :3][im[..., 3] > .5], tint)
    mx, mn = rgb.max(1), rgb.min(1)
    sat = np.where(mx > 0, (mx - mn) / np.maximum(mx, 1e-6), 0)
    return float(sat.mean()), float(mx.mean())

if __name__ == '__main__':
    rows = [(*look(m['body'], m['tint']), m) for m in json.load(sys.stdin) if m.get('body')]
    for sat, val, m in sorted(rows, key=lambda r: r[0])[: int(sys.argv[1]) if len(sys.argv) > 1 else 60]:
        print(f"{sat:.2f} sat  {val:.2f} bright  {m['id']:38} {m['body']:26} {m['tint']}")
