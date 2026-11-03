# Planche de zooms sur l'imagerie Esri, un par ajout LiDAR (tri à l'œil: bâtiment, doublon, arbre). Chaque case fait
# `cote` mètres de côté autour du centre de l'ajout; rouge = l'ajout, orange = les autres ajouts, bleu = empreinte LiDAR,
# blanc = Overture. L'image n'est embarquée qu'une fois (<use> d'un groupe) et chaque case est un <svg> à sa propre viewBox.
# Usage: python3 -I planche.py scene.json esri.jpg nombre_d_ajouts planche.svg [cote m, 70] [colonnes, 8] [indices a,b,c ou -] [demi-côté de l'image m, 320]
import json, math, sys, base64
s = json.load(open(sys.argv[1]))
img = base64.b64encode(open(sys.argv[2], 'rb').read()).decode()
nAdd = int(sys.argv[3]); outf = sys.argv[4]
side = float(sys.argv[5]) if len(sys.argv) > 5 else 70
cols = int(sys.argv[6]) if len(sys.argv) > 6 else 8
only = [int(v) for v in sys.argv[7].split(',')] if len(sys.argv) > 7 and sys.argv[7] != '-' else None
R = float(sys.argv[8]) if len(sys.argv) > 8 else 320; PX = 1280; CELL = 300
def P(x, n): return (x + R) / (2 * R) * PX, (R - n) / (2 * R) * PX
def ring(r): return ' '.join(f"{P(x,n)[0]:.1f},{P(x,n)[1]:.1f}" for x, n in r)
def area(r): return abs(sum(r[i][0]*r[(i+1)%len(r)][1] - r[(i+1)%len(r)][0]*r[i][1] for i in range(len(r)))) / 2
bld = s['bld']; nOv = len(bld) - nAdd
adds = [i for i in range(nOv, len(bld)) if only is None or i in only]
rows = math.ceil(len(adds) / cols)
out = [f'<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="{cols*CELL}" height="{rows*(CELL+22)}" viewBox="0 0 {cols*CELL} {rows*(CELL+22)}">',
       '<defs><g id="base">', f'<image href="data:image/jpeg;base64,{img}" width="{PX}" height="{PX}"/>']
for i, b in enumerate(bld):
    if i >= nOv: continue
    col = '#30c8ff' if (len(b) > 5 and b[5]) else '#ffffff'
    out.append(f'<polygon points="{ring(b[0])}" fill="none" stroke="{col}" stroke-width="1.2"/>')
for i in range(nOv, len(bld)):
    out.append(f'<polygon points="{ring(bld[i][0])}" fill="none" stroke="#ff9a30" stroke-width="1.2" stroke-dasharray="3,2"/>')
out.append('</g></defs>')
w = side / (2 * R) * PX
for k, i in enumerate(adds):
    b = bld[i]; r = b[0]
    cx = sum(p[0] for p in r) / len(r); cn = sum(p[1] for p in r) / len(r)
    x, y = P(cx, cn); X = (k % cols) * CELL; Y = (k // cols) * (CELL + 22)
    out.append(f'<svg x="{X}" y="{Y}" width="{CELL}" height="{CELL}" viewBox="{x - w/2:.1f} {y - w/2:.1f} {w:.1f} {w:.1f}">')
    out.append('<use xlink:href="#base"/>')
    out.append(f'<polygon points="{ring(r)}" fill="#ff3030" fill-opacity="0.18" stroke="#ff3030" stroke-width="1.6"/>')
    out.append('</svg>')
    out.append(f'<text x="{X+4}" y="{Y+CELL+16}" font-size="14" font-family="Helvetica" fill="#fff">#{i}  {area(r):.0f} m²  {b[1]:.0f} m  ({cx:.0f}, {cn:.0f})</text>')
out.append('</svg>')
open(outf, 'w').write('\n'.join(out).replace('<defs>', '<rect width="100%" height="100%" fill="#111"/><defs>', 1))
