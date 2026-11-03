# Planche avant / après: les contours de deux scènes du même lieu côte à côte sur l'imagerie Esri (640 m, voir overlay.py),
# rouge = ajout LiDAR, bleu = empreinte LiDAR, blanc = Overture. Léger (l'image JPEG embarquée deux fois, le reste en vecteur).
# Usage: python3 -I avant_apres.py avant.json nAjoutsAvant apres.json nAjoutsApres esri.jpg "titre" planche.svg
import json, math, sys, base64
sa, na, sb, nb, imgf, title, outf = sys.argv[1], int(sys.argv[2]), sys.argv[3], int(sys.argv[4]), sys.argv[5], sys.argv[6], sys.argv[7]
img = base64.b64encode(open(imgf, 'rb').read()).decode()
R = 320; PX = 1280; GAP = 20; TOP = 44
def P(x, n): return (x + R) / (2 * R) * PX, (R - n) / (2 * R) * PX
def ring(r): return ' '.join(f"{P(x,n)[0]:.1f},{P(x,n)[1]:.1f}" for x, n in r)
def panel(s, nAdd, X, label):
    out = [f'<svg x="{X}" y="{TOP}" width="{PX}" height="{PX}" viewBox="0 0 {PX} {PX}">', f'<image href="data:image/jpeg;base64,{img}" width="{PX}" height="{PX}"/>']
    nOv = len(s['bld']) - nAdd
    for i, b in enumerate(s['bld']):
        added = i >= nOv
        col = '#ff3030' if added else ('#30c8ff' if (len(b) > 5 and b[5]) else '#ffffff')
        out.append(f'<polygon points="{ring(b[0])}" fill="{col}" fill-opacity="{0.35 if added else 0.1}" stroke="{col}" stroke-width="{2 if added else 1}"/>')
    x0, y0 = P(0, 0); out.append(f'<circle cx="{x0}" cy="{y0}" r="6" fill="none" stroke="#ff0" stroke-width="2"/></svg>')
    out.append(f'<text x="{X + 8}" y="30" font-size="22" font-family="Helvetica" fill="#fff">{label}</text>')
    return out
A = json.load(open(sa)); B = json.load(open(sb))
W = 2 * PX + GAP; H = PX + TOP
svg = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}">', f'<rect width="100%" height="100%" fill="#111"/>']
svg += panel(A, na, 0, f'{title}, avant: {na} ajouts LiDAR (rouge)')
svg += panel(B, nb, PX + GAP, f'après: {nb} ajouts gardés')
svg.append('</svg>')
open(outf, 'w').write('\n'.join(svg))
