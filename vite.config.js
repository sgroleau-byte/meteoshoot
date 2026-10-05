import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Clé Google Maps selon la cible: 'web' (site) ou 'native' (apps Capacitor, MS_TARGET=native).
// La valeur vient d'abord de l'environnement (GOOGLE_MAPS_KEY_WEB ou GOOGLE_MAPS_KEY_NATIVE, définies
// sur Vercel), sinon du fichier local google-maps-keys.json, ignoré par git (modèle:
// google-maps-keys.example.json). Une clé Maps JavaScript est visible dans la page servie: sa protection
// est la restriction par référents et par API dans la console Google (docs/cle-google-maps.md).
const target = process.env.MS_TARGET === 'native' ? 'native' : 'web';
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

// Compilation de production de MeteoShoot (React précompilé, Tailwind compilé, dépendances embarquées).
export default defineConfig({
  plugins: [
    react(),
    { name: 'meteoshoot-google-maps-key', transformIndexHtml: (html) => html.replace(/__GOOGLE_MAPS_KEY__/g, mapsKey) },
  ],
  define: { __GOOGLE_MAPS_KEY__: JSON.stringify(mapsKey), __MS_TARGET__: JSON.stringify(target) },
  // /api -> fonction scene3d servie en local par scripts/scene3d-dev.mjs (npm run api).
  server: { port: 5173, strictPort: true, proxy: { '/api': 'http://localhost:3999' } },
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
});
