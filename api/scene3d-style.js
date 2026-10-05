// Fonction serveur (Vercel): style 3D d'un bâtiment à partir des images du client (rendus, plans, photos).
// Claude regarde quelques images du projet et en tire, sans détail: la couleur du mur, du soubassement,
// du toit, un éventuel volume d'accent, le rythme des fenêtres, le nombre d'étages et la hauteur estimée.
// Le client enregistre le résultat dans le projet (style3d) et la vue 3D l'applique aux formes dessinées.
//
// POST /api/scene3d-style  { name, address, images: [{ media_type, data (base64) }] }  ->  style JSON
// Clé: variable d'environnement ANTHROPIC_API_KEY (Vercel); sans clé, réponse 503 explicite.

import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';

export const maxDuration = 60;

const StyleSchema = z.object({
  wallColor: z.string().describe('couleur dominante des murs, hexadécimal #rrggbb'),
  baseColor: z.string().describe('couleur du soubassement ou du bas des murs, hexadécimal; même valeur que wallColor si rien de distinct'),
  roofColor: z.string().describe('couleur de la bordure de toit ou du toit vu de côté, hexadécimal'),
  accentColor: z.string().nullable().describe('couleur d’un volume ou d’un élément d’accent marquant (entrée, bandeau), hexadécimal, sinon null'),
  material: z.enum(['brique', 'pierre', 'béton', 'métal', 'bois', 'verre', 'enduit', 'autre']),
  windowStyle: z.enum(['few', 'standard', 'large']).describe('few: façades surtout pleines; standard: fenêtres ordinaires; large: grandes baies vitrées'),
  storeys: z.number().int().min(1).max(60).describe('nombre d’étages visibles'),
  heightM: z.number().min(2).max(300).describe('hauteur totale estimée en mètres, parapet compris'),
  roof: z.enum(['plat', 'pente', 'autre']),
  notes: z.string().describe('une phrase en français sur l’aspect général, sans détail'),
});

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.statusCode = 204; res.end(); return; }
  if (req.method !== 'POST') { res.statusCode = 405; res.end(); return; }
  if (!process.env.ANTHROPIC_API_KEY) {
    res.statusCode = 503; res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'Analyse indisponible: clé API Claude absente du serveur (ANTHROPIC_API_KEY).' })); return;
  }
  let body = '';
  for await (const chunk of req) body += chunk;
  let payload;
  try { payload = JSON.parse(body || '{}'); } catch (e) { res.statusCode = 400; res.end('JSON invalide'); return; }
  const images = (payload.images || []).filter(i => i && i.data && /^image\/(jpeg|png|webp|gif)$/.test(i.media_type)).slice(0, 8);
  if (!images.length) { res.statusCode = 400; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ error: 'Aucune image à analyser.' })); return; }

  const client = new Anthropic();
  const content = [];
  images.forEach((img, i) => {
    content.push({ type: 'text', text: `Image ${i + 1}` });
    content.push({ type: 'image', source: { type: 'base64', media_type: img.media_type, data: img.data } });
  });
  content.push({ type: 'text', text:
    `Ces images décrivent le bâtiment du projet « ${payload.name || ''} » (${payload.address || ''}): rendus d’architecte, plans, ` +
    `photos ou maquettes. Certaines images peuvent montrer l’intérieur ou des plans sans façade: ignore-les. ` +
    `Décris l’enveloppe extérieure du bâtiment principal de façon sobre, pour une maquette 3D simplifiée: couleurs ` +
    `dominantes (pas les ombres ni la lumière du soleil), rythme des fenêtres, nombre d’étages et hauteur totale estimée ` +
    `(un étage d’école ou de bureau fait environ 4 m, un étage résidentiel environ 3 m, plus le parapet). ` +
    `Si les images montrent un agrandissement et un bâtiment existant, décris l’ensemble tel qu’il sera une fois livré.` });

  try {
    const response = await client.messages.parse({
      model: 'claude-opus-5-5',
      max_tokens: 4000,
      messages: [{ role: 'user', content }],
      output_config: { format: zodOutputFormat(StyleSchema) },
    });
    if (response.stop_reason === 'refusal' || !response.parsed_output) {
      res.statusCode = 502; res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'Analyse impossible sur ces images.' })); return;
    }
    const style = { ...response.parsed_output, analyzedAt: new Date().toISOString(), images: images.length };
    res.statusCode = 200; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(style));
  } catch (e) {
    console.error('[scene3d-style]', e);
    const status = e instanceof Anthropic.AuthenticationError ? 503 : e instanceof Anthropic.RateLimitError ? 429 : 502;
    res.statusCode = status; res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: status === 503 ? 'Clé API Claude refusée.' : status === 429 ? 'Trop de demandes, réessayer dans un moment.' : String(e && e.message || e) }));
  }
}
