import json, math, sys
s = json.load(open(sys.argv[1]))
bld = s['bld']
def area(r):
    a = 0
    for i in range(len(r)):
        p, q = r[i], r[(i+1) % len(r)]
        a += p[0]*q[1] - q[0]*p[1]
    return abs(a)/2
def cen(r):
    return sum(p[0] for p in r)/len(r), sum(p[1] for p in r)/len(r)
rows = []
for i, b in enumerate(bld):
    r, h, fl, kind = b[0], b[1], b[2], b[3]
    meas = b[4] if len(b) > 4 else 0
    fp = b[5] if len(b) > 5 else 0
    roof = 'toit' if len(b) > 6 and b[6] else ''
    cx, cn = cen(r)
    d = math.hypot(cx, cn)
    rows.append((d, i, cx, cn, area(r), h, fl, kind, meas, fp, len(r), roof))
rows.sort()
print("Bâtiments à moins de 220 m de l'origine (d = distance, x est, n nord, A = surface m², h, étages, genre, mesuré, empreinte LiDAR, sommets)")
for d, i, cx, cn, A, h, fl, kind, meas, fp, nv, roof in rows:
    if d > 220: break
    tag = 'AJOUT LiDAR' if i >= 405 else ('remplacé' if fp else '')
    print(f"#{i:3d} d={d:5.0f} x={cx:6.0f} n={cn:6.0f} A={A:7.0f} h={h:5.1f} et={fl:2d} genre={kind} mes={meas} fp={fp} som={nv:2d} {roof} {tag}")
print()
print("Ajouts LiDAR (indices >= 405):")
for d, i, cx, cn, A, h, fl, kind, meas, fp, nv, roof in rows:
    if i >= 405:
        print(f"#{i:3d} d={d:5.0f} x={cx:6.0f} n={cn:6.0f} A={A:7.0f} h={h:5.1f} et={fl:2d} genre={kind}")
