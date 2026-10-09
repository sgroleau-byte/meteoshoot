// Pilote minimal de Chrome sans fenêtre (protocole DevTools) pour capturer la vue 3D hors du panneau
// navigateur (qui ne dessine pas le WebGL quand il est masqué). Node 22+ (WebSocket intégré).
// Usage: import { launch } from './cdp.mjs'; const b = await launch(url); await b.eval('1+1'); await b.close();
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

export async function launch(url, { port = 9333, width = 1300, height = 860 } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'ms-sky-'));
  const proc = spawn(CHROME, [
    '--headless=new', `--remote-debugging-port=${port}`, '--use-angle=metal', '--ignore-gpu-blocklist',
    '--enable-gpu-rasterization', '--no-first-run', '--no-default-browser-check', `--user-data-dir=${dir}`,
    `--window-size=${width},${height}`, '--hide-scrollbars', '--autoplay-policy=no-user-gesture-required', url,
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  let errLog = ''; proc.stderr.on('data', d => { errLog += d; if (errLog.length > 20000) errLog = errLog.slice(-10000); });
  // Attendre le port de débogage puis la page.
  let targets = null;
  for (let i = 0; i < 100 && !targets; i++) {
    await new Promise(r => setTimeout(r, 150));
    try { const r = await fetch(`http://127.0.0.1:${port}/json`); const list = await r.json(); const pg = list.find(t => t.type === 'page'); if (pg) targets = pg; } catch (e) { /* pas encore prêt */ }
  }
  if (!targets) { proc.kill(); throw new Error('Chrome ne répond pas sur le port de débogage\n' + errLog); }
  const ws = new WebSocket(targets.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0; const pending = new Map(); const events = [];
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { const { res, rej } = pending.get(d.id); pending.delete(d.id); d.error ? rej(new Error(JSON.stringify(d.error))) : res(d.result); } else if (d.method) events.push(d); };
  const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
  await send('Runtime.enable'); await send('Page.enable'); await send('Log.enable');
  const consoleLines = [];
  const drain = () => { while (events.length) { const e = events.shift(); if (e.method === 'Runtime.consoleAPICalled') consoleLines.push(e.params.type + ': ' + e.params.args.map(a => a.value ?? a.description ?? '').join(' ')); else if (e.method === 'Runtime.exceptionThrown') consoleLines.push('EXCEPTION: ' + (e.params.exceptionDetails.exception?.description || e.params.exceptionDetails.text)); else if (e.method === 'Log.entryAdded') consoleLines.push(e.params.entry.level + ': ' + e.params.entry.text); } };
  const b = {
    proc, send,
    // Évalue une expression (une promesse est attendue) et renvoie sa valeur.
    async eval(expr) { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error('eval: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text)); return r.result.value; },
    async navigate(u) { await send('Page.navigate', { url: u }); },
    async setSize(w, h) { await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false }); },
    console() { drain(); return consoleLines.splice(0); },
    async screenshot(path) { const r = await send('Page.captureScreenshot', { format: 'png' }); const { writeFileSync } = await import('node:fs'); writeFileSync(path, Buffer.from(r.data, 'base64')); },
    async close() { try { ws.close(); } catch (e) { /* déjà fermé */ } proc.kill(); await new Promise(r => setTimeout(r, 200)); try { rmSync(dir, { recursive: true, force: true }); } catch (e) { /* laissé au système */ } },
    stderr: () => errLog,
  };
  return b;
}

export const sleep = (ms) => new Promise(r => setTimeout(r, ms));
