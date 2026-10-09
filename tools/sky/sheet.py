#!/usr/bin/env python3
"""Planche contact des captures du banc du ciel.
Usage: sheet.py sortie.png dossier [dossier2] [--cols 3] [--w 600] [--only motif]
Avec deux dossiers, chaque condition montre avant (gauche) et après (droite)."""
import sys, os, glob
from PIL import Image, ImageDraw, ImageFont

args = sys.argv[1:]
def opt(k, d):
    if '--' + k in args:
        i = args.index('--' + k); v = args[i + 1]; del args[i:i + 2]; return v
    return d
cols = int(opt('cols', 3)); tw = int(opt('w', 600)); only = opt('only', None)
out, dirs = args[0], args[1:]
names = sorted(os.path.basename(p)[:-4] for p in glob.glob(os.path.join(dirs[0], '*.png')))
if only: names = [n for n in names if only in n]
try: font = ImageFont.truetype('/System/Library/Fonts/Helvetica.ttc', 15)
except Exception: font = ImageFont.load_default()
tiles = []
for n in names:
    ims = []
    for d in dirs:
        p = os.path.join(d, n + '.png')
        if os.path.exists(p): im = Image.open(p).convert('RGB')
        else: im = Image.new('RGB', (1200, 750), (40, 40, 40))
        im = im.resize((tw, round(im.height * tw / im.width)), Image.LANCZOS); ims.append(im)
    th = max(i.height for i in ims)
    tile = Image.new('RGB', (tw * len(ims) + 4 * (len(ims) - 1), th + 22), (20, 20, 20))
    x = 0
    for im in ims: tile.paste(im, (x, 22)); x += tw + 4
    ImageDraw.Draw(tile).text((4, 3), n + ('   (avant | après)' if len(ims) > 1 else ''), fill=(230, 230, 230), font=font)
    tiles.append(tile)
if not tiles: sys.exit('aucune capture')
W = tiles[0].width; H = tiles[0].height
rows = (len(tiles) + cols - 1) // cols
sheet = Image.new('RGB', (cols * W + (cols - 1) * 6, rows * H + (rows - 1) * 6), (10, 10, 10))
for i, t in enumerate(tiles): sheet.paste(t, ((i % cols) * (W + 6), (i // cols) * (H + 6)))
sheet.save(out, quality=88)
print(out, sheet.size)
