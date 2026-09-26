# Analyse des captures de sim-startup.sh: pour chaque image (nom = ms depuis le lancement), mesure la
# différence avec la dernière image (état final) et signale le premier instant où l'écran est stable.
import os, sys
from PIL import Image
import numpy as np
d = sys.argv[1]
files = sorted((int(f[:-4]), f) for f in os.listdir(d) if f.endswith('.png'))
final = np.asarray(Image.open(os.path.join(d, files[-1][1])).convert('RGB').resize((200, 434))).astype(int)
rows = []
for ms, f in files:
    im = np.asarray(Image.open(os.path.join(d, f)).convert('RGB').resize((200, 434))).astype(int)
    diff = float(np.abs(im - final).mean())
    rows.append((ms, diff))
first_final = next((ms for ms, diff in rows if diff < 2.0), None)
for ms, diff in rows: print(f'{ms:6d} ms  écart vs final {diff:6.1f}')
print('première image équivalente à l\'état final:', first_final, 'ms (délai de lancement du simulateur inclus)')
