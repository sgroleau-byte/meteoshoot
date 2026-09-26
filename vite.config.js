import { resolve } from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Compilation de production de MeteoShoot (React précompilé, Tailwind compilé, dépendances embarquées).
export default defineConfig({
  plugins: [react()],
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
