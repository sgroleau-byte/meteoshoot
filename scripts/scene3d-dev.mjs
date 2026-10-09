// Serveur local des fonctions /api/scene3d, /api/terrain, /api/horizon et /api/apple-snapshot pour le développement (npm run dev la joint par le
// proxy Vite: /api -> localhost:3999). En production, Vercel sert api/scene3d.js directement.
import http from 'http';
import handler from '../api/scene3d.js';
import terrain from '../api/terrain.js';
import horizon from '../api/horizon.js';
import appleSnapshot from '../api/apple-snapshot.js';

const port = Number(process.env.PORT) || 3999;
http.createServer((req, res) => {
  if (req.url.startsWith('/api/scene3d')) { handler(req, res); return; }
  if (req.url.startsWith('/api/terrain')) { terrain(req, res); return; }
  if (req.url.startsWith('/api/horizon')) { horizon(req, res); return; }
  if (req.url.startsWith('/api/apple-snapshot')) { appleSnapshot(req, res); return; }
  res.statusCode = 404; res.end('introuvable');
}).listen(port, () => console.log(`scene3d: http://localhost:${port}/api/scene3d?lat=46.8367&lng=-71.2336`));
