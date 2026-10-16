// Usage: node nowcast_replay.mjs <chemin absolu de src/weather/nowcast.js> bench_rows.csv
// (bench_rows.csv: rangées du banc exportées comme dans docs/nuages-verification.md, section du ciel observé)
// Rejoue la correction de l'app (src/weather/nowcast.js: nowcastWeights, calibSat) et l'ancienne (v633.214) sur les rangées
// du banc. Cas: aéroport au lieu, aéroport voisin (distance réelle), sans aéroport; satellite toujours présent.
import fs from 'node:fs';
const { nowcastWeights, calibSat } = await import(process.argv[2]);
const L = fs.readFileSync(process.argv[3], 'utf8').trim().split('\n'); const hd = L[0].split(',');
const rows = L.slice(1).map((l) => { const v = l.split(','); const o = {}; hd.forEach((k, i) => (o[k] = k === 'sid' ? v[i] : v[i] === '' ? null : +v[i])); return o; });
const acc = {};
const add = (key, e0, e1, e2) => { const a = acc[key] || (acc[key] = [0, 0, 0, 0]); a[0] += e0; a[1] += e1; a[2] += e2; a[3]++; };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
// ancienne correction: satellite poids 1 de jour (soleil > ~1°), 0,5 la nuit; aéroport e^(-d/40) jusqu'à 90 km; observé = moyenne
// pondérée; w = e^(-h/2,5) x min(1, somme); à h = 0 w = min(1, somme); âges supposés: satellite 15 min, aéroport 30 min
const old = (m, sat, ap, d, h, sunUp, satW = 1) => {
  const ws = sat == null ? 0 : (sunUp ? 1 : 0.5) * Math.exp(-0.25 / 2.5) * satW, wm = ap == null || d > 90 ? 0 : Math.exp(-d / 40) * Math.exp(-0.5 / 2.5);
  const W = ws + wm; if (W <= 0) return m;
  const o = (ws * (sat ?? 0) + wm * (ap ?? 0)) / W, w = (h === 0 ? 1 : Math.exp(-h / 2.5)) * Math.min(1, W);
  return m + w * (o - m);
};
for (const r of rows) {
  const day = r.sun > 5, sunUp = r.sun > 1;
  for (const cas of ['au lieu', 'voisin', 'sans aéroport']) {
    const d = cas === 'au lieu' ? 0 : cas === 'voisin' ? r.km : null;
    if (cas === 'voisin' && (r.nb == null)) continue;
    const ap = cas === 'au lieu' ? r.own : cas === 'voisin' ? r.nb : null, apL = cas === 'au lieu' ? r.ownL : cas === 'voisin' ? r.nbL : null;
    const dk = d == null || d >= 150 ? 'sans aéroport' : d === 0 ? 'au lieu' : d <= 60 ? '<60 km' : d <= 90 ? '60-90' : '90-150';
    // total
    const sv = calibSat('tot', day, r.tcf), w = nowcastWeights('tot', day, r.h, ap != null && d != null && d < 150 ? r.h : null, d);
    const pNew = clamp(r.m + w.ws * (sv - r.m) + w.wa * ((ap ?? r.m) - r.m), 0, 100);
    const pOld = clamp(old(r.m, r.tcf, ap, d ?? 999, r.h, sunUp), 0, 100);
    add(`tot|${r.h}|${day ? 'jour' : 'nuit'}|${dk}`, Math.abs(r.m - r.y), Math.abs(pOld - r.y), Math.abs(pNew - r.y));
    // nuages bas (satellite ignoré sous un voile d'altitude)
    if (r.yL != null && r.mL != null) {
      const sl = r.blind ? null : calibSat('low', day, r.sLow), wl = nowcastWeights('low', day, sl != null ? r.h : null, apL != null && d != null && d < 150 ? r.h : null, d);
      const qNew = clamp(r.mL + wl.ws * ((sl ?? r.mL) - r.mL) + wl.wa * ((apL ?? r.mL) - r.mL), 0, 100);
      const qOld = clamp(old(r.mL, r.blind ? null : r.sLow, apL, d ?? 999, r.h, sunUp), 0, 100);
      add(`low|${r.h}|${day ? 'jour' : 'nuit'}|${dk}`, Math.abs(r.mL - r.yL), Math.abs(qOld - r.yL), Math.abs(qNew - r.yL));
    }
  }
}
const out = Object.entries(acc).map(([k, a]) => { const [t, h, mo, dk] = k.split('|'); return { t, h: +h, mo, dk, n: a[3], prev: (a[0] / a[3]).toFixed(1), ancienne: (a[1] / a[3]).toFixed(1), nouvelle: (a[2] / a[3]).toFixed(1) }; });
const ord = ['au lieu', '<60 km', '60-90', '90-150', 'sans aéroport'];
out.sort((a, b) => a.t.localeCompare(b.t) || a.mo.localeCompare(b.mo) || a.h - b.h || ord.indexOf(a.dk) - ord.indexOf(b.dk));
for (const o of out) console.log([o.t, o.mo, 'h=' + o.h, o.dk.padEnd(14), 'n=' + o.n, 'prévision ' + o.prev, 'ancienne ' + o.ancienne, 'nouvelle ' + o.nouvelle].join('  '));
