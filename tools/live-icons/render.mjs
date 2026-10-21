// Rend les icônes météo de l'app (src/components/icons/WeatherIcon.jsx) en blanc, sur fond transparent, pour
// l'activité en direct « Shooting du jour » (ios/App/MeteoShootWidget/Images/weather-<code>.png, 96 px de côté).
// La maquette Live.psd de Stéphane (4 octobre 2026) reprend ces icônes en blanc; le widget les affiche réduites.
// Rendu SVG par qlmanage (WebKit, fond noir) puis la luminance devient la transparence (icônes monochromes).
// Usage: node tools/live-icons/render.mjs   (depuis la racine du dépôt; esbuild et react-dom sont déjà installés)
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PNG } from 'pngjs';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const out = path.join(root, 'ios/App/MeteoShootWidget/Images');
const work = mkdtempSync(path.join(tmpdir(), 'live-icons-'));
const SIZE = 96;
const types = ['sunny-bright', 'sunny', 'sunny-few-clouds', 'mostly-sunny', 'partly-cloudy', 'mostly-cloudy', 'cloudy-glimpse', 'cloudy',
  'sunny-veil-1', 'sunny-veil-2', 'sunny-veil-3', 'sunny-veil-4', 'sunny-veil-5', 'sun-smoke-1', 'sun-smoke-2', 'sun-smoke-3',
  'rain', 'snow', 'thunderstorm', 'moon-bright', 'moon', 'moon-few-clouds', 'moon-mostly-clear', 'moon-partly-cloudy',
  'moon-mostly-cloudy', 'moon-cloudy-glimpse', 'moon-cloudy'];

// 1. Les composants React deviennent des chaînes SVG (rendu côté serveur).
const entry = path.join(root, 'tools/live-icons/.entry.jsx');
writeFileSync(entry, `import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { WeatherIcon } from '../../src/components/icons/WeatherIcon.jsx';
const out = {};
for (const t of ${JSON.stringify(types)}) out[t] = renderToStaticMarkup(<WeatherIcon type={t} className="" />);
process.stdout.write(JSON.stringify(out));
`);
const bundle = path.join(work, 'render.cjs');
execFileSync(path.join(root, 'node_modules/esbuild/bin/esbuild'), [entry, '--bundle', '--platform=node', '--format=cjs', '--jsx=automatic', `--outfile=${bundle}`, '--log-level=warning'], { cwd: root });
rmSync(entry);
const svgs = JSON.parse(execFileSync('node', [bundle]).toString());

// 2. Tout en blanc (les noirs des masques restent noirs), traits au facteur demandé (1 = trait de l'app), fond noir.
const whiten = (svg, strokeScale) => svg
  .replace(/(stroke|fill)="(#(?!000\b)[0-9a-fA-F]{3,6})"/g, '$1="#fff"')
  .replace(/stroke-width="([0-9.]+)"/g, (_, w) => `stroke-width="${(parseFloat(w) * strokeScale).toFixed(2)}"`)
  // Nuage réduit (scale) au trait « non-scaling »: qlmanage le rend de façon imprévisible, on retire l'attribut et on
  // divise le trait par l'échelle du groupe pour retrouver la même épaisseur que le soleil.
  .replace(/ vector-effect="non-scaling-stroke"/g, '')
  .replace(/(<g transform="translate\([^)]*\) scale\(([0-9.]+)\)">)(.*?)(<\/g>)/g, (_, open, sc, inner, close) =>
    open + inner.replace(/stroke-width="([0-9.]+)"/g, (__, w) => `stroke-width="${(parseFloat(w) / parseFloat(sc)).toFixed(2)}"`) + close)
  // Sans width ni height: qlmanage étire alors la viewBox à la taille demandée (avec, il rend à un pixel par unité).
  .replace(/<svg /, '<svg xmlns="http://www.w3.org/2000/svg" style="background:#000" ')
  .replace(/ class=""/g, '');
mkdirSync(out, { recursive: true });
// Petites icônes des pourcentages: le soleil et le nuage de la rangée des jours (WeatherIcon.jsx), en blanc plein, trait
// normal de l'app (Stéphane, 21 octobre 2026: « tu prends ces icônes-là, mais en blanc seulement »).
// Trait normal de l'app partout (Stéphane, 21 octobre 2026: la grande icône épaissie à 1,6 était « ultra grasse »).
const jobs = types.map((t) => [`weather-${t}`, t, 1.0]).concat([['small-cloud', 'cloudy', 1.0], ['small-sun', 'sunny', 1.0]]);
for (const [name, t, strokeScale] of jobs) {
  const file = path.join(work, `${name}.svg`);
  writeFileSync(file, whiten(svgs[t], strokeScale));
  if (process.env.LIVE_ICONS_DUMP) writeFileSync(path.join(process.env.LIVE_ICONS_DUMP, `${name}.svg`), whiten(svgs[t], strokeScale));
  execFileSync('qlmanage', ['-t', '-s', String(SIZE), '-o', work, file], { stdio: 'ignore' });
  const png = PNG.sync.read(readFileSync(file + '.png'));
  if (png.width !== SIZE || png.height !== SIZE) throw new Error(`taille inattendue pour ${t}: ${png.width}x${png.height}`);
  // 3. Luminance -> transparence, couleur blanche.
  for (let i = 0; i < png.data.length; i += 4) {
    const lum = Math.max(png.data[i], png.data[i + 1], png.data[i + 2]);
    png.data[i] = png.data[i + 1] = png.data[i + 2] = 255;
    png.data[i + 3] = lum;
  }
  writeFileSync(path.join(out, `${name}.png`), PNG.sync.write(png));
}
rmSync(work, { recursive: true });
console.log(`${jobs.length} icônes écrites dans ${path.relative(root, out)}`);
