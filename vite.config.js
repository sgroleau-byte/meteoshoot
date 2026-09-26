import { readFileSync } from 'fs';
import { resolve } from 'path';
import { defineConfig } from 'vite';

// Clé Google Maps selon la cible: 'web' (site) ou 'native' (apps Capacitor, MS_TARGET=native).
// Les deux valeurs vivent dans google-maps-keys.json (clés publiques, restreintes côté Google).
const mapsKeys = JSON.parse(readFileSync(resolve(__dirname, 'google-maps-keys.json'), 'utf8'));
const target = process.env.MS_TARGET === 'native' ? 'native' : 'web';
const mapsKey = mapsKeys[target];
import react from '@vitejs/plugin-react';

// Compilation de production de MeteoShoot (React précompilé, Tailwind compilé, dépendances embarquées).
export default defineConfig({
  plugins: [
    react(),
    { name: 'meteoshoot-google-maps-key', transformIndexHtml: (html) => html.replace(/__GOOGLE_MAPS_KEY__/g, mapsKey) },
  ],
  define: { __GOOGLE_MAPS_KEY__: JSON.stringify(mapsKey), __MS_TARGET__: JSON.stringify(target) },
  server: { port: 5173, strictPort: true },
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
