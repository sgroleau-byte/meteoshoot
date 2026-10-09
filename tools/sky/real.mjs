// Captures de la vue 3D sur la prévision réelle du lieu (ICON): une image par heure choisie, avec la classification des nuages.
// Usage: node tools/sky/real.mjs <dossier de sortie> [pas en heures=3] [nombre=12] [--lat 47.01031 --lng -71.37338] [--day]
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { launch, sleep } from './cdp.mjs';
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const out = args[0]; const step = Number(args[1] && !args[1].startsWith('--') ? args[1] : 3), count = Number(args[2] && !args[2].startsWith('--') ? args[2] : 12);
const lat = opt('lat', 47.01031), lng = opt('lng', -71.37338), dayOnly = args.includes('--day');
mkdirSync(out, { recursive: true });
const b = await launch(`http://localhost:5173/tools/sky/harness.html?lat=${lat}&lng=${lng}`, { width: 1200, height: 750 });
try {
  await b.setSize(1200, 750);
  for (let i = 0; i < 200 && !(await b.eval('!!window.H')); i++) await sleep(100);
  await b.eval('window.H.ready');
  const rows = await b.eval('window.H.real()');
  const now = Date.now(); let i0 = rows.findIndex(r => new Date(r.time).getTime() >= now - 3600000); if (i0 < 0) i0 = 0;
  const picked = []; for (let i = i0; i < rows.length && picked.length < count; i += step) { const r = rows[i]; if (dayOnly && (r.sunFraction == null)) continue; picked.push(r); }
  const report = [];
  for (const r of picked) {
    await b.eval(`window.H.setRow(${JSON.stringify(r)})`); await sleep(1700);
    const data = await b.eval('window.H.capture()'); const d = await b.eval('window.H.dbg()');
    const name = r.time.replace('T', '_').replace(':', 'h'); writeFileSync(join(out, name + '.png'), Buffer.from(data.split(',')[1], 'base64'));
    const c = r.cls; const line = `${r.time} bas ${r.cloudLow}% moy ${r.cloudMid}% haut ${r.cloudHigh}% soleil ${r.sunFraction == null ? '-' : Math.round(r.sunFraction * 100) + '%'} wc ${r.wc} cape ${r.cape} lcl ${r.lcl} conv ${r.convBase}/${r.convDepth} prof ${JSON.stringify(r.prof)} | ${c.names.join(', ')} | bas ${Math.round(c.low.base)}-${Math.round(c.low.top)} m type ${c.low.type.toFixed(2)} | moy ${Math.round(c.mid.base)}-${Math.round(c.mid.top)} m type ${c.mid.type.toFixed(2)} | haut ${Math.round(c.high.alt)} m | ${d.info ? d.info.cond : ''}`;
    console.log(line); report.push({ time: r.time, row: r, info: d.info });
  }
  writeFileSync(join(out, 'rapport.json'), JSON.stringify(report, null, 1));
  const con = b.console().filter(l => !/\[vite\]|HMR/.test(l)); if (con.length) console.log('console:\n' + con.slice(-10).join('\n'));
} finally { await b.close(); }
