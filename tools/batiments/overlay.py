import json, math, sys, base64
s = json.load(open(sys.argv[1]))
img = base64.b64encode(open(sys.argv[2], 'rb').read()).decode()
R = 320; PX = 1280
def P(x, n): return (x + R) / (2 * R) * PX, (R - n) / (2 * R) * PX
def ring(r): return ' '.join(f"{P(x,n)[0]:.1f},{P(x,n)[1]:.1f}" for x, n in r)
out = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{PX}" height="{PX}" viewBox="0 0 {PX} {PX}">',
       f'<image href="data:image/jpeg;base64,{img}" width="{PX}" height="{PX}"/>']
for road in s['roads']:
    pts = ' '.join(f"{P(x,n)[0]:.1f},{P(x,n)[1]:.1f}" for x, n in road['p'])
    out.append(f'<polyline points="{pts}" fill="none" stroke="#ffd94a" stroke-width="1" opacity="0.6"/>')
nOv = len(s['bld']) - 36
for i, b in enumerate(s['bld']):
    r, h = b[0], b[1]
    added = i >= nOv
    col = '#ff3030' if added else ('#30c8ff' if (len(b) > 5 and b[5]) else '#ffffff')
    out.append(f'<polygon points="{ring(r)}" fill="{col}" fill-opacity="{0.35 if added else 0.12}" stroke="{col}" stroke-width="{2 if added else 1.2}"/>')
    cx = sum(p[0] for p in r) / len(r); cn = sum(p[1] for p in r) / len(r)
    if added or math.hypot(cx, cn) < 230:
        x, y = P(cx, cn)
        out.append(f'<text x="{x:.0f}" y="{y:.0f}" font-size="13" font-family="Helvetica" fill="{col}" text-anchor="middle" stroke="#000" stroke-width="0.4">#{i} {h:.0f}m</text>')
x0, y0 = P(0, 0)
out.append(f'<circle cx="{x0}" cy="{y0}" r="6" fill="none" stroke="#ff0" stroke-width="2"/>')
out.append('</svg>')
open(sys.argv[3], 'w').write('\n'.join(out))
