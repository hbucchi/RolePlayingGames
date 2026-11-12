"""
App icons (assets/app): the red dragon's painting, filling the whole square, with no ring or
frame, and a soft dark edge so it holds together on any home screen. Phones cut their own shape
(circle, squircle) out of the square, so the painting runs to every edge (the maskable icon
keeps the head inside the central 80% safe zone by zooming out a little).

    python3 tools/art/app-icons.py
"""
from PIL import Image, ImageDraw, ImageFilter

SRC = 'assets/portraits/red-dragon-1.jpg'


def vignette(im, strength=0.45):
    w, h = im.size
    mask = Image.new('L', (w, h), 0)
    ImageDraw.Draw(mask).ellipse((-w * 0.25, -h * 0.25, w * 1.25, h * 1.25), fill=255)
    mask = mask.filter(ImageFilter.GaussianBlur(w * 0.12))
    dark = Image.new('RGB', (w, h), (20, 14, 10))
    return Image.composite(im, Image.blend(im, dark, strength), mask)


def icon(size, zoom=1.0):
    src = Image.open(SRC).convert('RGB')
    s = src.width
    if zoom != 1.0:  # zoom out: the painting on a matching dark ground, edges feathered
        big = Image.new('RGB', (round(s / zoom), round(s / zoom)), (24, 16, 12))
        big.paste(src, ((big.width - s) // 2, (big.height - s) // 2))
        src = big
    return vignette(src.resize((size, size), Image.LANCZOS))


if __name__ == '__main__':
    icon(512).save('assets/app/icon-512.png', optimize=True)
    icon(192).save('assets/app/icon-192.png', optimize=True)
    icon(180).save('assets/app/apple-touch-icon.png', optimize=True)
    icon(512, zoom=0.86).save('assets/app/icon-maskable-512.png', optimize=True)
    print('icons written')
