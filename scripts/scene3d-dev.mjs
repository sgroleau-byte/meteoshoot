// Serveur local de la fonction /api/scene3d pour le développement (npm run dev la joint par le
// proxy Vite: /api -> localhost:3999). En production, Vercel sert api/scene3d.js directement.
import http from 'http';
import handler from '../api/scene3d.js';
import styleHandler from '../api/scene3d-style.js';

const port = Number(process.env.PORT) || 3999;
http.createServer((req, res) => {
  if (req.url.startsWith('/api/scene3d-style')) { styleHandler(req, res); return; } // 503 sans ANTHROPIC_API_KEY dans l'environnement
  if (req.url.startsWith('/api/scene3d')) { handler(req, res); return; }
  res.statusCode = 404; res.end('introuvable');
}).listen(port, () => console.log(`scene3d: http://localhost:${port}/api/scene3d?lat=46.8367&lng=-71.2336`));
