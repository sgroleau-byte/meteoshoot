// Trois projets exemples pour un compte qui n'a encore aucun projet (26 octobre 2026). Des lieux publics de Québec,
// jamais un client. Ils vivent seulement dans l'application (pas en base), s'affichent tant que la liste est vide et
// s'effacent au premier projet créé. Ils ne comptent pas dans la limite du gratuit et ne se modifient pas.
import { ProjectStatus } from './constants.js';

const SAMPLE_PREFIX = 'exemple-';
export const isSampleId = (id) => typeof id === 'string' && id.startsWith(SAMPLE_PREFIX);

const today = new Date();
today.setHours(9, 0, 0, 0);
const createdAt = today.toISOString();

const base = {
  status: ProjectStatus.TODO, isSample: true, isContest: false, deliveryDate: null, clientFolder: null,
  notes: '', links: [], buildings: [], travelTime: null, departureAddress: null, departureLat: null, departureLng: null,
  createdAt, shotAt: null,
};

export const SAMPLE_PROJECTS = [
  {
    ...base, id: SAMPLE_PREFIX + 'musee',
    name: { fr: 'Pavillon du musée', en: 'Museum pavilion' },
    address: '179 Grande Allée Ouest, Québec, QC G1R 2H1, Canada',
    lat: 46.80087, lng: -71.22536, mandates: ['EXT', 'DRONE'], orientation: ['PM'],
  },
  {
    ...base, id: SAMPLE_PREFIX + 'eglise',
    name: { fr: 'Église de la place', en: 'Church on the square' },
    address: '32 Rue Sous-le-Fort, Québec, QC G1K 4G2, Canada',
    lat: 46.81287, lng: -71.20272, mandates: ['EXT'], orientation: ['AM'],
  },
  {
    ...base, id: SAMPLE_PREFIX + 'hotel-de-ville',
    name: { fr: 'Hôtel de ville', en: 'City hall' },
    address: '2 Rue des Jardins, Québec, QC G1R 4S9, Canada',
    lat: 46.81388, lng: -71.20797, mandates: ['INT', 'EXT'], orientation: ['AM', 'PM'],
  },
];

// Les noms sont traduits au moment de l'affichage (la liste et la fiche attendent une chaîne).
export const sampleProjects = (lang) => SAMPLE_PROJECTS.map((p) => ({ ...p, name: p.name[lang === 'en' ? 'en' : 'fr'] }));
