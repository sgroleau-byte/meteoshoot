# Compare les captures avant/après (même nom de fichier) et écrit une image de différence par écran.
import sys, os
from PIL import Image, ImageChops
import numpy as np
base = os.path.dirname(os.path.abspath(__file__))
before, after, out = [os.path.join(base, d) for d in (sys.argv[1] if len(sys.argv) > 1 else 'before', sys.argv[2] if len(sys.argv) > 2 else 'after', sys.argv[3] if len(sys.argv) > 3 else 'diff')]
os.makedirs(out, exist_ok=True)
names = sorted(f for f in os.listdir(before) if f.endswith('.png') and os.path.exists(os.path.join(after, f)))
print(f"{'écran':28s} {'taille avant':>14s} {'taille après':>14s} {'pixels diff.':>13s} {'% surface':>9s} {'diff max':>8s}")
for n in names:
    a = Image.open(os.path.join(before, n)).convert('RGB'); b = Image.open(os.path.join(after, n)).convert('RGB')
    size_note = ''
    if a.size != b.size:
        size_note = ' (tailles différentes, comparaison sur la zone commune)'
        w, h = min(a.width, b.width), min(a.height, b.height); a = a.crop((0, 0, w, h)); b = b.crop((0, 0, w, h))
    da = np.asarray(a).astype(int); db = np.asarray(b).astype(int)
    d = np.abs(da - db).max(axis=2)
    changed = int((d > 8).sum()); pct = 100.0 * changed / d.size
    Image.fromarray(((d > 8) * 255).astype('uint8')).save(os.path.join(out, n))
    print(f"{n:28s} {str(Image.open(os.path.join(before, n)).size):>14s} {str(Image.open(os.path.join(after, n)).size):>14s} {changed:13d} {pct:8.2f}% {int(d.max()):8d}{size_note}")
