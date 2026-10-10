// Captures de la vue 3D pour une liste de conditions (banc du ciel).
// Usage: node tools/sky/shoot.mjs <dossier de sortie> [liste.json | nom de jeu] [--w 1200 --h 750 --url http://localhost:5173/tools/sky/harness.html]
// La liste: tableau de { name, time, view, weather, smoke, wait }. Sans liste: le jeu « base ».
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { launch, sleep } from './cdp.mjs';
import { SETS } from './scenarios.mjs';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const out = args[0]; if (!out) { console.error('dossier de sortie manquant'); process.exit(1); }
const listArg = args[1] && !args[1].startsWith('--') ? args[1] : 'base';
const list = listArg.endsWith('.json') ? JSON.parse(readFileSync(listArg, 'utf8')) : SETS[listArg];
if (!list) { console.error('jeu inconnu:', listArg, 'connus:', Object.keys(SETS).join(', ')); process.exit(1); }
const W = Number(opt('w', 1200)), H = Number(opt('h', 750));
const url = opt('url', 'http://localhost:5173/tools/sky/harness.html');
mkdirSync(out, { recursive: true });

const DPR = Number(opt('dpr', 1));
const b = await launch(url, { width: W, height: H });
try {
  await b.setSize(W, H, DPR); if (DPR !== 1) { await b.navigate(url); await sleep(400); } // le moteur lit devicePixelRatio à sa création
  const t0 = Date.now();
  for (let i = 0; i < 200 && !(await b.eval('!!window.H')); i++) await sleep(100); // le module de la page se charge
  if (!(await b.eval('!!window.H'))) { console.error('harness absent; console:\n' + b.console().join('\n')); process.exit(2); }
  const st = await b.eval('window.H.ready');
  console.log('scène prête en', ((Date.now() - t0) / 1000).toFixed(1), 's:', JSON.stringify(st));
  const report = [];
  for (const sc of list) {
    await b.eval(`window.H.set(${JSON.stringify(sc)})`);
    await sleep(sc.wait ?? 1700); // la météo du moteur s'interpole sur environ 1 s
    const tc = Date.now();
    const data = await b.eval('window.H.capture()');
    const dbg = await b.eval('window.H.dbg()');
    const st = args.includes('--stats') ? await b.eval('window.H.stats()') : null;
    const file = join(out, sc.name + '.png');
    writeFileSync(file, Buffer.from(data.split(',')[1], 'base64'));
    const line = `${sc.name}: ${((Date.now() - tc) / 1000).toFixed(2)} s, ${dbg.info ? dbg.info.cond : ''}` + (st ? ` | scène [${st.scene.mn}, ${st.scene.mx}] moy ${st.scene.mean} nan ${st.scene.nan + st.scene.inf} | cubes min ${Math.min(...[0, 1, 2, 3, 4, 5].map(f => st['cube' + f].mn))} max ${Math.max(...[0, 1, 2, 3, 4, 5].map(f => st['cube' + f].mx))} | env [${st.env && st.env.mn}, ${st.env && st.env.mx}] nan ${st.env && st.env.nan + st.env.inf} | nuages [${st.cloud.mn}, ${st.cloud.mx}] rgb ${st.cloud.rgb}` : '');
    console.log(line); report.push({ name: sc.name, cond: dbg.info && dbg.info.cond, parts: dbg.info && dbg.info.parts, view: dbg.view, dbg: dbg.dbg, stats: st });
  }
  writeFileSync(join(out, 'rapport.json'), JSON.stringify(report, null, 1));
  const con = b.console().filter(l => !/\[vite\]|HMR|Download the React/.test(l));
  if (con.length) console.log('console:\n' + con.slice(-30).join('\n'));
} finally { await b.close(); }
