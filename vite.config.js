import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// Clé Google Maps selon la cible: 'web' (site) ou 'native' (apps Capacitor, MS_TARGET=native).
// La valeur vient d'abord de l'environnement (GOOGLE_MAPS_KEY_WEB ou GOOGLE_MAPS_KEY_NATIVE, définies
// sur Vercel), sinon du fichier local google-maps-keys.json, ignoré par git (modèle:
// google-maps-keys.example.json). Une clé Maps JavaScript est visible dans la page servie: sa protection
// est la restriction par référents et par API dans la console Google (docs/cle-google-maps.md).
const target = process.env.MS_TARGET === 'native' ? 'native' : 'web';
// Cible du proxy /api en développement: variable MS_API_PROXY (environnement ou .env.local, ignoré par git), sinon le
// serveur local des fonctions (npm run api).
const apiProxy = process.env.MS_API_PROXY || loadEnv('development', __dirname, 'MS_').MS_API_PROXY || 'http://localhost:3999';
const mapsKey = readMapsKey(target);

function readMapsKey(target) {
  const envName = target === 'native' ? 'GOOGLE_MAPS_KEY_NATIVE' : 'GOOGLE_MAPS_KEY_WEB';
  if (process.env[envName]) return process.env[envName];
  const file = resolve(__dirname, 'google-maps-keys.json');
  if (existsSync(file)) {
    const key = JSON.parse(readFileSync(file, 'utf8'))[target];
    if (key) return key;
  }
  throw new Error(
    `Clé Google Maps introuvable pour la cible « ${target} »: définir la variable ${envName} ` +
      'ou créer google-maps-keys.json à la racine (modèle: google-maps-keys.example.json).',
  );
}

// Jetons Plans d'Apple (MapKit JS) pour le bouton SAT2. Apple fait un jeton par site (restriction par domaine): on
// injecte donc une table { nom d'hôte: jeton } et la page prend celui de son site. Source: variable
// APPLE_MAPS_TOKENS_WEB ou APPLE_MAPS_TOKENS_NATIVE (texte JSON de cette table), sinon le fichier local
// apple-maps-token.json, ignoré par git (modèle: apple-maps-token.example.json). Le champ « local » (jeton sans
// restriction, 7 jours) ne sert qu'au serveur de développement et n'entre jamais dans une compilation. Sans jeton,
// tout passe: SAT2 est simplement masqué.
function readAppleMapsTokens(target, command) {
  const envName = target === 'native' ? 'APPLE_MAPS_TOKENS_NATIVE' : 'APPLE_MAPS_TOKENS_WEB';
  const usable = (t) => typeof t === 'string' && t && !t.startsWith('COLLER_ICI');
  const table = {};
  let file = {};
  const path = resolve(__dirname, 'apple-maps-token.json');
  if (existsSync(path)) file = JSON.parse(readFileSync(path, 'utf8'));
  const source = process.env[envName] ? JSON.parse(process.env[envName]) : file[target];
  if (source && typeof source === 'object') {
    for (const [host, t] of Object.entries(source)) if (usable(t)) table[host] = t;
  } else if (usable(source)) {
    table['*'] = source;
  }
  if (command === 'serve' && usable(file.local)) table['*'] = file.local;
  return table;
}

// Compilation de production de MeteoShoot (React précompilé, Tailwind compilé, dépendances embarquées).
export default defineConfig(({ command }) => ({
  plugins: [
    react(),
    { name: 'meteoshoot-google-maps-key', transformIndexHtml: (html) => html.replace(/__GOOGLE_MAPS_KEY__/g, mapsKey) },
  ],
  define: {
    __GOOGLE_MAPS_KEY__: JSON.stringify(mapsKey),
    __APPLE_MAPS_TOKENS__: JSON.stringify(readAppleMapsTokens(target, command)),
    __MS_TARGET__: JSON.stringify(target),
  },
  // /api -> fonctions serveur jouées en local par scripts/scene3d-dev.mjs (npm run api), ou un déploiement Vercel
  // d'aperçu si MS_API_PROXY le donne (l'analyse des images a besoin de la clé Claude, qui ne vit que sur Vercel).
  server: { port: 5173, strictPort: true, proxy: { '/api': { target: apiProxy, changeOrigin: true } } },
  build: {
    // Compatibilité large (Safari 14, Chrome 87...): l'ancienne page transpilait tout avec Babel.
    target: ['es2019', 'safari14', 'chrome87', 'firefox78', 'edge88'],
    outDir: 'dist',
    emptyOutDir: true,
    // Application multi-pages: l'application principale et les pages de compte.
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        login: resolve(__dirname, 'site/login.html'),
        signup: resolve(__dirname, 'site/signup.html'),
        account: resolve(__dirname, 'site/account.html'),
        dieu: resolve(__dirname, 'site/dieu.html'),
      },
    },
  },
}));
