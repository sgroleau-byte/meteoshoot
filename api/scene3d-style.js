// Fonction serveur (Vercel): style 3D d'un bâtiment à partir des images du client (rendus, plans, photos).
// Claude reçoit d'abord un croquis de l'empreinte dessinée dans MeteoShoot (vue du ciel, nord en haut, volumes
// lettrés A, B, C et côtés numérotés A1, A2..., rues voisines nommées), puis les documents du client. Il en tire:
// - l'orientation: quel volume des rendus correspond à quelle forme dessinée (plan d'implantation, noms de rues);
// - par volume: rôle (existant, agrandissement), étages, hauteur (cote lue sur une élévation ou estimation), couleurs;
// - par côté: les ouvertures visibles (fenêtres, portes, vitrages) avec leur position le long du mur et leur hauteur,
//   un niveau de confiance et, pour une façade non vue, rien du tout (pas d'invention).
// Le client enregistre le résultat dans le projet (style3d); la vue 3D l'applique aux formes dessinées et affiche
// la source de chaque hauteur et de chaque façade.
//
// POST /api/scene3d-style  { name, address, images: [{ media_type, data }], schematic: { media_type, data } | null,
//                            footprint: { sig, shapes: [{ label, areaM2, heightSetM, edges: [{ id, lenM, dir, bearing, street, streetDistM }] }] } | null }
// Clé: variable d'environnement ANTHROPIC_API_KEY (Vercel); sans clé, réponse 503 explicite.

import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';

export const maxDuration = 300;

const Hex = z.string().describe('couleur hexadécimale #rrggbb');
const Confidence = z.enum(['haute', 'moyenne', 'faible']);

const Opening = z.object({
  type: z.enum(['fenetre', 'porte', 'vitrage', 'garage']).describe('vitrage: mur-rideau ou grande baie sur un ou plusieurs niveaux'),
  x0: z.number().describe('début de l’ouverture, fraction 0 à 1 de la longueur du côté, depuis la gauche vue de l’extérieur'),
  x1: z.number().describe('fin de l’ouverture, fraction 0 à 1, plus grande que x0'),
  y0: z.number().describe('bas de l’ouverture, en mètres au-dessus du sol'),
  y1: z.number().describe('haut de l’ouverture, en mètres au-dessus du sol, plus grand que y0'),
  frame: Hex.nullable().describe('couleur des cadres ou meneaux si elle se distingue nettement (bleu, noir, blanc), sinon null'),
});
const Facade = z.object({
  edge: z.string().describe('identifiant du côté tel que listé, par exemple A3'),
  seenIn: z.array(z.number().int()).describe('numéros des images où ce côté est visible (liste vide si aucune)'),
  confidence: Confidence.describe('haute: côté identifié sans doute et vu clairement; moyenne: vu de biais ou en partie; faible: incertain, alors openings vide'),
  openings: z.array(Opening).describe('ouvertures de gauche à droite; vide si la façade n’est pas vue, est mitoyenne ou incertaine'),
  note: z.string().describe('une phrase: ce qu’on voit, ou pourquoi rien n’est donné'),
});
const Volume = z.object({
  shape: z.string().describe('lettre du volume dessiné: A, B, C...'),
  role: z.enum(['existant', 'agrandissement', 'nouveau', 'inconnu']),
  storeys: z.number().int().describe('nombre d’étages hors sol'),
  heightM: z.number().describe('hauteur totale en mètres, parapet compris'),
  heightSource: z.enum(['cote', 'estimation']).describe('cote: lue sur une élévation, une coupe ou un plan coté; estimation: déduite du nombre d’étages'),
  wallColor: Hex.nullable().describe('couleur des murs de ce volume si elle diffère de la couleur générale, sinon null'),
  baseColor: Hex.nullable(),
  roofColor: Hex.nullable(),
  confidence: Confidence.describe('confiance dans la correspondance entre ce volume dessiné et les documents'),
  note: z.string(),
});
const StyleSchema = z.object({
  wallColor: Hex.describe('couleur dominante des murs du bâtiment principal'),
  baseColor: Hex.describe('couleur du soubassement ou du bas des murs; même valeur que wallColor si rien de distinct'),
  roofColor: Hex.describe('couleur de la bordure de toit ou du toit vu de côté'),
  accentColor: Hex.nullable().describe('couleur d’un volume ou d’un élément d’accent marquant, sinon null'),
  material: z.enum(['brique', 'pierre', 'béton', 'métal', 'bois', 'verre', 'enduit', 'autre']),
  windowStyle: z.enum(['few', 'standard', 'large']).describe('few: façades surtout pleines; standard: fenêtres ordinaires; large: grandes baies vitrées'),
  storeys: z.number().int().describe('nombre d’étages du volume principal'),
  heightM: z.number().describe('hauteur du volume principal en mètres'),
  roof: z.enum(['plat', 'pente', 'autre']),
  notes: z.string().describe('une phrase en français sur l’aspect général'),
  orientation: z.object({
    matched: z.boolean().describe('vrai si les documents ont pu être reliés à l’empreinte dessinée'),
    confidence: Confidence,
    evidence: z.string().describe('deux phrases: les indices utilisés (noms de rues, forme en L, stationnement, nord du plan) et ce qui reste douteux'),
  }),
  volumes: z.array(Volume).describe('un élément par volume dessiné (A, B, C...)'),
  facades: z.array(Facade).describe('un élément par côté listé, dans l’ordre de la liste'),
});

const DIRS_TXT = { nord: 'nord', 'nord-est': 'nord-est', est: 'est', 'sud-est': 'sud-est', sud: 'sud', 'sud-ouest': 'sud-ouest', ouest: 'ouest', 'nord-ouest': 'nord-ouest' };

function footprintText(fp) {
  if (!fp || !Array.isArray(fp.shapes) || !fp.shapes.length) return '';
  const lines = fp.shapes.map(s => {
    const edges = (s.edges || []).map(e => `${e.id}: ${Math.round(e.lenM)} m, façade orientée ${DIRS_TXT[e.dir] || e.dir}` +
      (e.street ? `, donne sur ${e.street} (à ${Math.round(e.streetDistM)} m)` : '')).join('; ');
    return `Volume ${s.label} (${Math.round(s.areaM2)} m² au sol${s.heightSetM ? `, hauteur réglée à ${s.heightSetM} m par le photographe, valeur incertaine` : ''}): ${edges}.`;
  });
  return lines.join('\n');
}

function sanitize(out, fp) {
  const ids = new Set(((fp && fp.shapes) || []).flatMap(s => (s.edges || []).map(e => e.id)));
  const cl = (v, a, b) => Math.max(a, Math.min(b, Number(v) || 0));
  out.facades = (out.facades || []).filter(f => !ids.size || ids.has(f.edge)).map(f => ({
    ...f,
    openings: (f.openings || []).map(o => ({ ...o, x0: cl(o.x0, 0, 1), x1: cl(o.x1, 0, 1), y0: cl(o.y0, 0, 200), y1: cl(o.y1, 0, 200) }))
      .filter(o => o.x1 - o.x0 >= 0.004 && o.y1 - o.y0 >= 0.2).slice(0, 80),
  }));
  out.volumes = (out.volumes || []).filter(v => typeof v.shape === 'string');
  return out;
}

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
  const okImg = (i) => i && i.data && /^image\/(jpeg|png|webp|gif)$/.test(i.media_type);
  const images = (payload.images || []).filter(okImg).slice(0, 10);
  if (!images.length) { res.statusCode = 400; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ error: 'Aucune image à analyser.' })); return; }
  const schematic = okImg(payload.schematic) ? payload.schematic : null;
  const fp = payload.footprint && Array.isArray(payload.footprint.shapes) ? payload.footprint : null;
  const fpText = footprintText(fp);

  const client = new Anthropic();
  const content = [];
  let n = 0;
  if (schematic && fpText) {
    n++;
    content.push({ type: 'text', text: `Image ${n} (croquis MeteoShoot, pas un document du client)` });
    content.push({ type: 'image', source: { type: 'base64', media_type: schematic.media_type, data: schematic.data } });
  }
  const firstClient = n + 1;
  images.forEach(img => { n++; content.push({ type: 'text', text: `Image ${n} (document du client)` }); content.push({ type: 'image', source: { type: 'base64', media_type: img.media_type, data: img.data } }); });

  const intro = `Projet « ${payload.name || ''} » (${payload.address || ''}). Les images ${firstClient} à ${n} sont les documents du client: ` +
    `rendus d’architecte, plans d’implantation, élévations, coupes, photos ou maquettes. Les images d’intérieur ou sans façade ne servent qu’aux cotes.\n\n`;
  const sketch = schematic && fpText ?
    `L’image 1 est un croquis: l’empreinte du bâtiment telle que le photographe l’a dessinée dans MeteoShoot sur la carte satellite, vue du ciel, ` +
    `nord en haut, avec les rues voisines (nommées quand le nom est connu) et les bâtiments voisins en gris clair. Chaque volume dessiné porte une ` +
    `lettre (A = le plus grand au sol). Les côtés d’un volume sont numérotés A1, A2... dans le sens antihoraire vu du ciel; le côté Ak va du sommet ak ` +
    `au sommet ak+1 et, vu de l’extérieur, debout devant la façade, le sommet ak est à GAUCHE et le sommet ak+1 à DROITE. Les fractions x0 et x1 ` +
    `d’une ouverture se mesurent dans ce sens, de gauche à droite vu de l’extérieur.\n\nCôtés dessinés:\n${fpText}\n\n` : '';
  const tasks =
    `Travail, en trois temps.\n` +
    `1. Orientation: relie les documents à l’empreinte dessinée. Indices: noms de rues sur le plan d’implantation, forme des volumes (en L, en barre), ` +
    `position du stationnement et de la cour, flèche du nord, proportions des côtés, orientation de chaque côté donnée dans la liste. Les rendus ` +
    `(axonométries, perspectives) montrent souvent le bâtiment depuis plusieurs coins: pour chaque rendu, établis d’abord d’où l’on regarde (par exemple ` +
    `« vu depuis le sud-ouest, la rue au premier plan »), puis les façades visibles sur ce rendu sont les côtés dont l’orientation fait face à ce point ` +
    `de vue. Dis dans orientation.evidence ce qui t’a permis de conclure et ce qui reste douteux; confidence « haute » seulement si la correspondance ` +
    `est sans ambiguïté. Si tu ne peux pas orienter, matched = false et confidence « faible »: les façades resteront génériques, ce qui vaut mieux ` +
    `qu’une erreur.\n` +
    `2. Volumes: un élément par lettre dessinée. Rôle (existant, agrandissement, nouveau), étages, hauteur totale parapet compris. heightSource « cote » ` +
    `uniquement si une cote lisible (élévation, coupe, plan coté) donne la hauteur; sinon « estimation » (étage d’école ou de bureau environ 4 m, ` +
    `résidentiel environ 3 m, plus le parapet). Couleurs propres au volume seulement si elles diffèrent du reste.\n` +
    `3. Façades: un élément par côté listé, tous les volumes, dans l’ordre. Si le côté est visible dans au moins une image, liste ses ouvertures de ` +
    `gauche à droite (vu de l’extérieur) avec leur type, x0 < x1 en fraction de la longueur du côté, y0 < y1 en mètres du sol, en respectant le nombre ` +
    `réel d’ouvertures (par exemple neuf fenêtres par rangée: neuf éléments) et leur rythme; les bandes vitrées continues ou murs-rideaux sont un seul ` +
    `élément « vitrage ». frame = couleur des cadres si elle ressort (par exemple bleu), sinon null. seenIn = numéros des images où le côté se voit. ` +
    `Dès que l’orientation est établie (matched vrai, confiance haute ou moyenne), donne les ouvertures de CHAQUE côté visible dans au moins une image: ` +
    `confiance « haute » si tout concorde et que le côté est vu clairement, « moyenne » si l’attribution repose sur l’orientation d’ensemble ou sur une vue ` +
    `de biais (l’app affichera « probable »). Réserve « faible » avec openings = [] aux côtés qu’aucune image ne montre, aux murs mitoyens d’un autre ` +
    `volume, et au cas où l’orientation n’a pas pu être établie; la note l’explique. Le photographe veut toutes les façades, mais jamais une ouverture ` +
    `que les documents ne montrent pas.\n` +
    `Les couleurs sont celles des matériaux, sans l’ombre ni la lumière du soleil. Si les documents montrent un agrandissement et un bâtiment existant, ` +
    `décris l’ensemble tel qu’il sera une fois livré.`;
  content.push({ type: 'text', text: intro + sketch + tasks });

  try {
    const response = await client.messages.parse({
      model: 'claude-opus-5-5',
      max_tokens: 16000,
      thinking: { type: 'adaptive' },
      messages: [{ role: 'user', content }],
      output_config: { format: zodOutputFormat(StyleSchema) },
    });
    if (response.stop_reason === 'refusal' || !response.parsed_output) {
      res.statusCode = 502; res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'Analyse impossible sur ces images.' })); return;
    }
    const style = sanitize({ ...response.parsed_output }, fp);
    style.analyzedAt = new Date().toISOString(); style.images = images.length;
    style.shapes = fp ? { sig: fp.sig || null, labels: fp.shapes.map(s => s.label), firstClientImage: firstClient } : null;
    style.usage = response.usage ? { input: response.usage.input_tokens, output: response.usage.output_tokens } : null;
    res.statusCode = 200; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(style));
  } catch (e) {
    console.error('[scene3d-style]', e);
    const status = e instanceof Anthropic.AuthenticationError ? 503 : e instanceof Anthropic.RateLimitError ? 429 : 502;
    res.statusCode = status; res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: status === 503 ? 'Clé API Claude refusée.' : status === 429 ? 'Trop de demandes, réessayer dans un moment.' : String(e && e.message || e) }));
  }
}
