// Découpe src/app.jsx (un seul module de 9 000 lignes) en modules par domaine, sans changer le code:
// chaque déclaration de premier niveau est copiée telle quelle (avec ses commentaires) dans le module
// choisi, exportée, et les imports nécessaires sont calculés à partir des identifiants utilisés.
import fs from 'fs';
import path from 'path';
import * as espree from 'espree';
import * as eslintScope from 'eslint-scope';

let src = fs.readFileSync('src/app.jsx', 'utf8');
// Variable mutable partagée entre modules: un binding importé est en lecture seule, on passe par un objet.
src = src.replace('let activeWeatherRowDismiss = null;', 'const weatherRowDismiss = { current: null };');
src = src.replace(/\bactiveWeatherRowDismiss\b/g, 'weatherRowDismiss.current');

const parseOpts = { ecmaVersion: 2024, sourceType: 'module', ecmaFeatures: { jsx: true }, loc: true, range: true, comment: true, tokens: true };
const ast = espree.parse(src, parseOpts);

// --- Affectation des déclarations aux modules (par nom; un nom absent suit le module précédent) ---
const START = {
  useIsMobile: 'hooks/useIsMobile.js',
  supabase: 'lib/supabase.js',
  ELEV_GRID_PRECISION: 'weather/elevation.js',
  MAX_PROJECT_FILES_MB: 'projects/files.js',
  AuthContext: 'auth/AuthProvider.jsx',
  LangContext: 'i18n/LangProvider.jsx',
  TBL_USER_PROFILES: 'subscription/SubscriptionProvider.jsx',
  UpgradeModal: 'subscription/UpgradeModal.jsx',
  LoginScreen: 'auth/LoginScreen.jsx',
  MandateType: 'projects/constants.js',
  generateId: 'projects/helpers.js',
  formatDateShort: 'utils/dates.js',
  EDIT_LIST_DEFAULTS: 'projects/helpers.js',
  getDayAbbrev: 'utils/dates.js',
  ON_SITE_LEAD_MIN: 'weather/departure.js',
  weatherCodeIcon: 'weather/iconsLogic.js',
  GOOGLE_API_KEY: 'maps/google.js',
  WEATHER_SIM_KEY: 'weather/api.js',
  StoreContext: 'projects/StoreProvider.jsx',
  WeatherStatusContext: 'weather/WeatherStatusProvider.jsx',
  sunRays: 'components/icons/WeatherIcon.jsx',
  StarIcon: 'components/icons/misc.jsx',
  weatherRowDismiss: 'components/WeatherRow.jsx',
  useSwipeActions: 'hooks/useSwipeActions.js',
  ProjectCard: 'components/ProjectCard.jsx',
  EDIT_FONT: 'components/EditList.jsx',
  MONTHS_FR: 'components/pickers.jsx',
  linkifyPhonesInEditor: 'utils/linkify.js',
  ProjectDetail: 'components/ProjectDetail.jsx',
  NewProjectModal: 'components/NewProjectModal.jsx',
  Header: 'components/Header.jsx',
  KP_CACHE_KEY: 'weather/kp.js',
  GEO_CARD_W: 'components/GeoWeatherCard.jsx',
  FolderAccordion: 'components/TodoView.jsx',
  RetouchingView: 'components/RetouchingView.jsx',
  EditPrefNumber: 'components/PreferencesView.jsx',
  MobileNewProjectScreen: 'components/MobileNewProjectScreen.jsx',
  UndoToast: 'components/UndoToast.jsx',
  attachSmoothWheel: 'utils/smoothWheel.js',
  RT_CARD: 'components/route/RouteView.jsx',
  App: 'components/App.jsx',
};
const EXTERNAL = {
  React: { from: 'react', def: true },
  useState: 'react', useEffect: 'react', useRef: 'react', useCallback: 'react', createContext: 'react', useContext: 'react',
  ReactDOM: { from: 'react-dom', def: true },
  createRoot: 'react-dom/client',
  createClient: '@supabase/supabase-js',
  SunCalc: { from: 'suncalc', def: true },
  SUPABASE_URL: '@shared/config.js', SUPABASE_KEY: '@shared/config.js', LEMON_CHECKOUT_URL: '@shared/config.js',
  TRANSLATIONS: '@shared/translations.js', getDefaultLang: '@shared/translations.js',
};

const declNames = (stmt) => {
  if (stmt.type === 'VariableDeclaration') return stmt.declarations.map(d => d.id.name).filter(Boolean);
  if (stmt.type === 'FunctionDeclaration' || stmt.type === 'ClassDeclaration') return [stmt.id.name];
  return [];
};
const chunks = []; // { stmt, names, text, module }
let prevEnd = 0, current = null, mountChunk = null;
for (const stmt of ast.body) {
  if (stmt.type === 'ImportDeclaration') { prevEnd = stmt.range[1]; continue; }
  const names = declNames(stmt);
  for (const n of names) if (Object.hasOwn(START, n)) current = START[n];
  const text = src.slice(prevEnd, stmt.range[1]);
  prevEnd = stmt.range[1];
  if (stmt.type === 'ExpressionStatement' && src.slice(stmt.range[0], stmt.range[1]).startsWith('createRoot(')) { mountChunk = text; continue; }
  if (!current) throw new Error('Déclaration avant le premier module: ' + names);
  let body = text;
  if (names.length) {
    const off = stmt.range[0] - (stmt.range[1] - text.length);
    body = text.slice(0, off) + 'export ' + text.slice(off);
  }
  chunks.push({ names, text: body, module: current, stmt });
}
const modules = {};
for (const c of chunks) (modules[c.module] = modules[c.module] || []).push(c);
const ownerOf = Object.create(null);
for (const [m, cs] of Object.entries(modules)) for (const c of cs) for (const n of c.names) ownerOf[n] = m;

const usedNames = (code) => {
  const t = espree.parse(code, parseOpts);
  const used = new Set();
  for (const tok of t.tokens) if (tok.type === 'Identifier' || tok.type === 'JSXIdentifier') used.add(tok.value);
  const sm = eslintScope.analyze(t, { ecmaVersion: 2024, sourceType: 'module' });
  const declared = new Set();
  const walk = (scope) => { for (const v of scope.variables) declared.add(v.name); scope.childScopes.forEach(walk); };
  walk(sm.globalScope);
  return { used, declared };
};
const relImport = (fromModule, toModule) => {
  let rel = path.relative(path.dirname(fromModule), toModule).replace(/\\/g, '/');
  if (!rel.startsWith('.')) rel = './' + rel;
  return rel;
};
const graph = {};
for (const [m, cs] of Object.entries(modules)) {
  const code = cs.map(c => c.text).join('');
  const { used, declared } = usedNames(code);
  const imports = {}; // from -> { def, names[] }
  const add = (from, name, def) => { const o = imports[from] || (imports[from] = { def: null, names: new Set() }); if (def) o.def = name; else o.names.add(name); };
  for (const n of used) {
    if (declared.has(n)) continue;
    if (Object.hasOwn(ownerOf, n) && ownerOf[n] !== m) { add(relImport(m, ownerOf[n]), n, false); graph[m] = graph[m] || new Set(); graph[m].add(ownerOf[n]); continue; }
    const ext = Object.hasOwn(EXTERNAL, n) ? EXTERNAL[n] : null;
    if (ext) { const from = typeof ext === 'string' ? ext : ext.from; const rel = from.startsWith('@shared/') ? relImport(m, 'shared/' + from.slice(8)) : from; add(rel, n, typeof ext === 'object' && ext.def); }
  }
  const lines = [];
  const order = Object.keys(imports).sort((a, b) => (a.startsWith('.') - b.startsWith('.')) || a.localeCompare(b));
  for (const from of order) {
    const { def, names } = imports[from]; const list = [...names].sort();
    if (def && list.length) lines.push(`import ${def}, { ${list.join(', ')} } from '${from}';`);
    else if (def) lines.push(`import ${def} from '${from}';`);
    else lines.push(`import { ${list.join(', ')} } from '${from}';`);
  }
  const out = (lines.length ? lines.join('\n') + '\n' : '') + code.replace(/^\n+/, '\n') + '\n';
  const file = path.join('src', m);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, out);
  console.log(`${file}: ${code.split('\n').length} lignes, ${cs.length} déclarations, ${lines.length} imports`);
}
fs.rmSync('src/app.jsx');
// main.jsx: montage
const main = fs.readFileSync('src/main.jsx', 'utf8').replace("import './app.jsx';\n", "import { mountApp } from './components/App.jsx';\n\nmountApp();\n");
fs.writeFileSync('src/main.jsx', main);
let app = fs.readFileSync('src/components/App.jsx', 'utf8');
app += "\n// Montage de l'application (ancienne fin du script de index.html).\nexport function mountApp() {\n  " + mountChunk.trim() + "\n}\n";
fs.writeFileSync('src/components/App.jsx', app);
// cycles d'import (information)
const cyc = []; const visit = (n, stack) => { if (stack.includes(n)) { cyc.push([...stack.slice(stack.indexOf(n)), n]); return; } for (const d of graph[n] || []) visit(d, [...stack, n]); };
for (const n of Object.keys(graph)) visit(n, []);
const uniq = [...new Set(cyc.map(c => c.join(' -> ')))];
console.log('\nCycles d\'import:', uniq.length); uniq.slice(0, 20).forEach(c => console.log('  ', c));
