"""
Open-wing dragon bodies (assets/bodies/body-dragon-<colour>-open.png), seen from above.

The one painted open-wing dragon (body-test-dragon.png, red) is recoloured to match each closed-
wing dragon body: its hue is shifted, and its saturation and brightness scaled, to the closed
sprite's own averages (measured over its opaque pixels). The map shows the open body while a
dragon attacks, breathes or beats its wings (src/ui/dungeon/render.js).

    python3 tools/art/open-wings.py
"""
import colorsys
import numpy as np
from PIL import Image

COLOURS = ['red', 'black', 'blue', 'brass', 'bronze', 'copper', 'gold', 'green', 'silver', 'white']
SRC = 'assets/bodies/body-test-dragon.png'
WIDTH = 480  # the closed bodies are about 120 x 360; the open one spans much wider


def stats(rgba):
    """Mean hue (circular), saturation and value of the opaque pixels."""
    a = rgba.astype(float) / 255
    rgb = a[..., :3][a[..., 3] > 0.5]
    rgb = rgb[:: max(1, len(rgb) // 5000)]
    hsv = np.array([colorsys.rgb_to_hsv(*c) for c in rgb])
    ang = hsv[:, 0] * 2 * np.pi
    return (np.arctan2(np.sin(ang).mean(), np.cos(ang).mean()) / (2 * np.pi)) % 1, hsv[:, 1].mean(), hsv[:, 2].mean()


def rgb_to_hsv(rgb):
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    mx = rgb.max(-1); mn = rgb.min(-1); d = mx - mn
    h = np.zeros_like(mx)
    safe = np.where(d == 0, 1, d)
    h = np.where(mx == r, ((g - b) / safe) % 6, h)
    h = np.where(mx == g, (b - r) / safe + 2, h)
    h = np.where(mx == b, (r - g) / safe + 4, h)
    h = np.where(d == 0, 0, h) / 6
    s = np.where(mx == 0, 0, d / np.where(mx == 0, 1, mx))
    return np.stack([h % 1, s, mx], -1)


def hsv_to_rgb(hsv):
    h, s, v = hsv[..., 0] * 6, hsv[..., 1], hsv[..., 2]
    i = np.floor(h).astype(int) % 6; f = h - np.floor(h)
    p, q, t = v * (1 - s), v * (1 - s * f), v * (1 - s * (1 - f))
    r = np.choose(i, [v, q, p, p, t, v]); g = np.choose(i, [t, v, v, q, p, p]); b = np.choose(i, [p, p, t, v, v, q])
    return np.stack([r, g, b], -1)


def main():
    src = Image.open(SRC).convert('RGBA')
    src = src.resize((WIDTH, round(src.height * WIDTH / src.width)), Image.LANCZOS)
    a = np.asarray(src).astype(float) / 255
    h0, s0, v0 = stats(np.asarray(Image.open(SRC).convert('RGBA')))
    hsv = rgb_to_hsv(a[..., :3])
    for c in COLOURS:
        h1, s1, v1 = stats(np.asarray(Image.open(f'assets/bodies/body-dragon-{c}.png').convert('RGBA')))
        out = hsv.copy()
        out[..., 0] = (out[..., 0] + (h1 - h0)) % 1
        out[..., 1] = np.clip(out[..., 1] * (s1 / s0), 0, 1)
        out[..., 2] = np.clip(out[..., 2] * (v1 / v0), 0, 1)
        rgba = np.concatenate([hsv_to_rgb(out), a[..., 3:4]], -1)
        Image.fromarray((rgba * 255).round().astype(np.uint8), 'RGBA').save(f'assets/bodies/body-dragon-{c}-open.png', optimize=True)
        print(c, 'done')


if __name__ == '__main__':
    main()
