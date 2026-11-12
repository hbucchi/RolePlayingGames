"""Cut top-down sprites out of a flat grey background.

The background is removed by a flood fill that starts at the image border and spreads through
pixels close to the background colour, so grey inside a figure (a steel helm) is kept because it is
not connected to the border. The edge of the mask is then softened by a small blur.
"""
import sys
from collections import deque
import numpy as np
from PIL import Image, ImageFilter

import os
KEEP = float(os.environ.get('KEEP', '0.04'))


def cut(img, tol=26):
    a = np.asarray(img.convert('RGB')).astype(int)
    h, w, _ = a.shape
    border = np.concatenate([a[0], a[-1], a[:, 0], a[:, -1]])
    bg = np.median(border, axis=0)
    close = np.abs(a - bg).max(axis=2) <= tol
    seen = np.zeros((h, w), bool)
    q = deque()
    for x in range(w):
        for y in (0, h - 1):
            if close[y, x] and not seen[y, x]: seen[y, x] = True; q.append((y, x))
    for y in range(h):
        for x in (0, w - 1):
            if close[y, x] and not seen[y, x]: seen[y, x] = True; q.append((y, x))
    while q:
        y, x = q.popleft()
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            ny, nx = y + dy, x + dx
            if 0 <= ny < h and 0 <= nx < w and close[ny, nx] and not seen[ny, nx]:
                seen[ny, nx] = True; q.append((ny, nx))
    # Pockets of pure background enclosed by the figure (between a bow and its string): remove the
    # larger ones, matched with a tighter tolerance so textured grey (steel) survives.
    tight = (np.abs(a - bg).max(axis=2) <= tol // 2) & ~seen
    lab = np.zeros((h, w), int); n = 0
    for y0 in range(h):
        for x0 in range(w):
            if tight[y0, x0] and not lab[y0, x0]:
                n += 1; comp = [(y0, x0)]; lab[y0, x0] = n; k = 0
                while k < len(comp):
                    y, x = comp[k]; k += 1
                    for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                        ny, nx = y + dy, x + dx
                        if 0 <= ny < h and 0 <= nx < w and tight[ny, nx] and not lab[ny, nx]:
                            lab[ny, nx] = n; comp.append((ny, nx))
                if len(comp) > 120:
                    for y, x in comp: seen[y, x] = True
    # Keep the figure: drop opaque specks (slivers of the neighbouring cell) much smaller than it.
    solid = ~seen; comp_id = np.zeros((h, w), int); sizes = [0]; n2 = 0
    for y0 in range(h):
        for x0 in range(w):
            if solid[y0, x0] and not comp_id[y0, x0]:
                n2 += 1; comp_id[y0, x0] = n2; stack = [(y0, x0)]; cnt = 0
                while stack:
                    y, x = stack.pop(); cnt += 1
                    for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                        ny, nx = y + dy, x + dx
                        if 0 <= ny < h and 0 <= nx < w and solid[ny, nx] and not comp_id[ny, nx]:
                            comp_id[ny, nx] = n2; stack.append((ny, nx))
                sizes.append(cnt)
    if n2:
        biggest = max(sizes)
        keep = np.array([s >= biggest * KEEP for s in sizes]); keep[0] = False
        # EDGE_DROP: pieces touching the cell's edge that are much smaller than the figure are a
        # neighbour's sliver, not a dropped weapon (those lie inside the cell).
        if os.environ.get('EDGE_DROP'):
            edge = set(np.unique(np.concatenate([comp_id[0], comp_id[-1], comp_id[:, 0], comp_id[:, -1]])))
            for c in edge:
                if c and sizes[c] < biggest * 0.3: keep[c] = False
        seen = ~keep[comp_id]
    alpha = Image.fromarray(np.where(seen, 0, 255).astype('uint8')).filter(ImageFilter.MinFilter(3)).filter(ImageFilter.GaussianBlur(1.2))
    out = img.convert('RGBA'); out.putalpha(alpha)
    return out


def defringe(cut_img, src, width=5, tol=62):
    """Lift the pale halo a painter's soft shadow leaves round a cut-out: within `width` px of the
    transparent area, pixels still close to the background grey become transparent. Grey steel
    deeper inside the figure is untouched."""
    a = np.asarray(src.convert('RGB')).astype(int)
    bg = np.median(np.concatenate([a[0], a[-1], a[:, 0], a[:, -1]]), axis=0)
    out = np.asarray(cut_img).copy()
    clear = Image.fromarray(np.where(out[..., 3] < 128, 255, 0).astype('uint8')).filter(ImageFilter.MaxFilter(2 * width + 1))
    near = np.asarray(clear) > 0
    greyish = np.abs(a - bg).max(axis=2) <= tol
    out[..., 3] = np.where(near & greyish, 0, out[..., 3])
    alpha = Image.fromarray(out[..., 3]).filter(ImageFilter.GaussianBlur(0.8))
    res = Image.fromarray(out, 'RGBA'); res.putalpha(alpha)
    return res


def trim(img, pad=6):
    box = img.getchannel('A').point(lambda v: 255 if v > 20 else 0).getbbox()
    x0, y0, x1, y1 = box
    return img.crop((max(0, x0 - pad), max(0, y0 - pad), min(img.width, x1 + pad), min(img.height, y1 + pad)))


def square(img, size):
    """Centre on a transparent square canvas, scaled so the longer side fits."""
    s = max(img.width, img.height)
    c = Image.new('RGBA', (s, s), (0, 0, 0, 0)); c.paste(img, ((s - img.width) // 2, (s - img.height) // 2), img)
    return c.resize((size, size), Image.LANCZOS)



def soft(img):
    """For see-through creatures (ghosts, whirlwinds) a hard cut erases them. Instead, opacity grows
    with each pixel's distance from the background colour, and the true colour is recovered from
    the blending equation C = a*F + (1-a)*B  =>  F = B + (C - B) / a."""
    a = np.asarray(img.convert('RGB')).astype(float)
    bg = np.median(np.concatenate([a[0], a[-1], a[:, 0], a[:, -1]]), axis=0)
    d = np.sqrt(((a - bg) ** 2).sum(2)); al = np.clip((d - 6) * 7, 0, 255)
    rgb = np.clip(bg + (a - bg) / np.maximum(al / 255, 1e-3)[..., None], 0, 255)
    return Image.fromarray(np.dstack([rgb, al]).astype('uint8'), 'RGBA')


def body_from(img, mode='hard'):
    """A 256 px square body sprite from one cell or crop."""
    return square(trim(soft(img) if mode == 'soft' else cut(img)), 256)
