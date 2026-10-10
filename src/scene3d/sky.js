// Ciel de la vue 3D, nuages volumétriques (9 octobre 2026). Trois étages comme en météo: nuages bas (cumulus,
// stratocumulus, stratus, cumulonimbus), nuages moyens (altocumulus, altostratus), nuages hauts (cirrus, cirrostratus).
// Les deux premiers sont de vrais volumes tracés par rayons dans un bruit 3D (Perlin-Worley, comme dans les jeux
// récents), éclairés par le soleil calculé à leur altitude (après le coucher au sol, un nuage à 1 500 m voit encore
// le soleil pendant une dizaine de minutes: c'est ce qui allume les bases en orange), par le ciel et par le sol. Les
// cirrus restent un voile fibreux à 9 km. La forme des nuages vient du profil vertical d'ICON (classifyClouds).
// Ce module fournit: les textures de bruit (générées sur la carte graphique), le code GLSL commun (passe des nuages à
// résolution réduite, et sphère du ciel en mode « inline » pour la lumière d'ambiance), le soleil à une altitude donnée
// et le classement des nuages d'après la rangée horaire.
import * as THREE from 'three';

const QV = `varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.0,1.0);}`;

// ---- Bruit 3D tuilable (généré couche par couche dans une cible de rendu 3D)
const NOISE_GLSL = `
uniform float uZ, uN, uDetail; varying vec2 vUv;
vec3 hash3(vec3 p) { p = fract(p * vec3(0.1031, 0.1030, 0.0973)); p += dot(p, p.yxz + 33.33); return fract((p.xxy + p.yxx) * p.zyx); }
/* bruit de gradient (Perlin) tuilable de période per */
float gnoise(vec3 p, float per) {
  vec3 i = floor(p), f = fract(p), u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float n = 0.0;
  for (int k = 0; k < 8; k++) {
    vec3 c = vec3(float(k & 1), float((k >> 1) & 1), float((k >> 2) & 1));
    vec3 g = hash3(mod(i + c, per)) * 2.0 - 1.0;
    float v = dot(g, f - c);
    vec3 w = mix(1.0 - u, u, c);
    n += v * w.x * w.y * w.z;
  }
  return clamp(n * 0.9 + 0.5, 0.0, 1.0);
}
/* bruit cellulaire (Worley) tuilable, inversé: 1 au centre des cellules, 0 aux bords */
float worley(vec3 p, float per) {
  vec3 i = floor(p), f = fract(p); float md = 4.0;
  for (int x = -1; x <= 1; x++) for (int y = -1; y <= 1; y++) for (int z = -1; z <= 1; z++) {
    vec3 o = vec3(float(x), float(y), float(z)); vec3 r = o + hash3(mod(i + o, per)) - f; md = min(md, dot(r, r));
  }
  return clamp(1.0 - sqrt(md), 0.0, 1.0);
}
void main() {
  vec3 p = vec3(vUv, uZ);
  if (uDetail > 0.5) { gl_FragColor = vec4(worley(p * 2.0, 2.0), worley(p * 4.0, 4.0), worley(p * 8.0, 8.0), 1.0); return; }
  float pn = gnoise(p * 4.0, 4.0) * 0.5 + gnoise(p * 8.0, 8.0) * 0.25 + gnoise(p * 16.0, 16.0) * 0.125 + gnoise(p * 32.0, 32.0) * 0.0625;
  pn = pn / 0.9375;
  float w1 = worley(p * 4.0, 4.0), w2 = worley(p * 8.0, 8.0), w3 = worley(p * 16.0, 16.0);
  float wf = w1 * 0.625 + w2 * 0.25 + w3 * 0.125;
  float pw = clamp((pn + (1.0 - wf)) / 2.0, 0.0, 1.0); /* Perlin dilaté par Worley: bourgeons dans les masses */
  gl_FragColor = vec4(pw, w1, w2, w3);
}`;

export function makeNoiseTextures(R) {
  const mat = new THREE.ShaderMaterial({ uniforms: { uZ: { value: 0 }, uN: { value: 128 }, uDetail: { value: 0 } }, vertexShader: QV, fragmentShader: NOISE_GLSL });
  const sc = new THREE.Scene(), cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1), quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat); sc.add(quad);
  const gen = (n, detail) => {
    const rt = new THREE.WebGL3DRenderTarget(n, n, n, { type: THREE.HalfFloatType, depthBuffer: false, stencilBuffer: false, generateMipmaps: false }); // demi-flottants: en 8 bits, les marches de 1/255 faisaient des terrasses horizontales
    const t = rt.texture; t.wrapS = t.wrapT = t.wrapR = THREE.RepeatWrapping; t.minFilter = t.magFilter = THREE.LinearFilter; t.generateMipmaps = false;
    mat.uniforms.uN.value = n; mat.uniforms.uDetail.value = detail ? 1 : 0;
    for (let z = 0; z < n; z++) { mat.uniforms.uZ.value = (z + 0.5) / n; R.setRenderTarget(rt, z); R.render(sc, cam); }
    R.setRenderTarget(null);
    return rt;
  };
  const base = gen(128, false), detail = gen(64, true); // 64: 8 texels par cellule de 75 m (à 32, les cônes de Worley étaient des pyramides à facettes)
  quad.geometry.dispose(); mat.dispose();
  return { base: base.texture, detail: detail.texture, dispose() { base.dispose(); detail.dispose(); } };
}

// ---- GLSL commun: couches de nuages et leur lumière. Rayon (ro, rd) en coordonnées de la scène (y vers le haut, sol du
// projet à uGround). Sortie: radiance linéaire prémultipliée (rgb) et transmittance (a).
// Unités: altitudes en mètres de la scène, radiance comme le reste du moteur (soleil de midi = 10 en éclairement).
export const CLOUD_GLSL = `
uniform sampler3D tNoise, tDetail;
uniform vec3 uSun, uSunL, uSunM, uSunH, uAmbZ, uAmbH, uAmbG, uOff, uCamW;
uniform vec4 uLay0, uLay0b, uLay1, uHi;
uniform float uGround, uSunGap, uGapR, uSteps, uShaft;
const float PR = 6371000.0;
const float PI = 3.14159265;
float hg(float c, float g) { float g2 = g * g; return (1.0 - g2) / (4.0 * PI * pow(max(1.0 + g2 - 2.0 * g * c, 1e-4), 1.5)); }
float rmp(float v, float a, float b) { return clamp((v - a) / max(b - a, 1e-5), 0.0, 1.0); }
float ignoise(vec2 p) { return fract(52.9829189 * fract(0.06711056 * p.x + 0.00583715 * p.y)); }
/* Lecture lissée d'une texture 3D (n texels par période): l'interpolation trilinéaire est continue mais cassée à chaque
   texel; vue par la tranche (nuages de côté, près de l'horizon), chaque plan de cassure faisait une ligne horizontale.
   On arrondit la position dans le texel (courbe quintique) avant la lecture: interpolation lisse, même coût. */
vec4 tex3(sampler3D s, vec3 p, float n) { vec3 u = p * n - 0.5; vec3 i = floor(u), f = fract(u); f = f * f * f * (f * (f * 6.0 - 15.0) + 10.0); return texture(s, (i + 0.5 + f) / n); }
/* Rotations (axe vertical, et dans le plan) pour une seconde lecture à une autre échelle: deux champs périodiques tournés
   l'un par rapport à l'autre ne se répètent plus ensemble (le carrelage du motif disparaît). */
vec3 rotY(vec3 v, float c, float s) { return vec3(c * v.x - s * v.z, v.y, s * v.x + c * v.z); }
vec2 rot2(vec2 v, float c, float s) { return vec2(c * v.x - s * v.y, s * v.x + c * v.y); }
/* Coquille sphérique à l'altitude hAlt au-dessus du sol (Terre de rayon PR centrée sous la caméra): racines (entrée, sortie) */
vec2 shell(vec3 ro, vec3 rd, float hAlt) {
  /* |oc|^2 - r^2 sous forme factorisée (sinon différence de deux carrés de 6 371 km: perte totale de précision en 32 bits)
     et racines stables (q = -(b + signe(b) s), t2 = c / q) */
  float h = ro.y - uGround, R0 = PR + h;
  float b = R0 * rd.y, c = (h - hAlt) * (2.0 * PR + h + hAlt), d = b * b - c;
  if (d < 0.0) return vec2(-1.0);
  float s = sqrt(d), q = -(b + (b >= 0.0 ? s : -s));
  if (abs(q) < 1e-6) return vec2(-1.0);
  float t1 = q, t2 = c / q; return vec2(min(t1, t2), max(t1, t2));
}
/* Portion du rayon dans la couche d'altitudes [hb, ht]: (t0, t1), vide si t1 <= t0 */
vec2 seg(vec3 ro, vec3 rd, float hb, float ht) {
  float h = ro.y - uGround; vec2 tb = shell(ro, rd, hb), tt = shell(ro, rd, ht); float t0, t1;
  if (h < hb) { if (rd.y < -0.01) return vec2(1.0, 0.0); t0 = tb.y; t1 = tt.y; }
  else if (h < ht) { t0 = 0.0; t1 = tb.x > 0.0 ? tb.x : (rd.y < -0.002 ? (h - hb) / -rd.y : tt.y); }
  else { if (tt.x < 0.0) return vec2(1.0, 0.0); t0 = tt.x; t1 = tb.x > 0.0 ? tb.x : (rd.y < -0.002 ? (h - hb) / -rd.y : tt.y); }
  return vec2(max(t0, 0.0), t1);
}
/* Couverture visée -> paramètre interne du champ de densité. Mesuré au banc (tools/sky, octobre 2026): la part du ciel
   couverte par la couche est une sigmoïde très raide du paramètre brut (cumulus: 11 % à 0,40, 54 % à 0,50, 87 % à 0,60);
   ces tables (13 noeuds: 0, 0,1 ... 0,9, 0,95, 0,98, 1) l'inversent pour que 40 % de nuages couvrent bien 40 % du ciel. */
const float CM1[13] = float[13](0.33, 0.40, 0.425, 0.447, 0.468, 0.49, 0.514, 0.54, 0.572, 0.617, 0.66, 0.75, 1.0);
const float CM5[13] = float[13](0.27, 0.325, 0.352, 0.373, 0.393, 0.413, 0.435, 0.46, 0.49, 0.53, 0.575, 0.65, 1.0);
const float CM0[13] = float[13](0.22, 0.263, 0.287, 0.306, 0.324, 0.343, 0.363, 0.386, 0.415, 0.462, 0.51, 0.6, 1.0);
float covKnot(int i, float typ) { float a = CM0[i], b = CM5[i], c = CM1[i]; return typ < 0.5 ? mix(a, b, typ * 2.0) : mix(b, c, typ * 2.0 - 1.0); }
float covMap(float c, float typ) {
  c = clamp(c, 0.0, 1.0);
  float x; int i;
  if (c < 0.9) { x = c * 10.0; i = int(floor(x)); x -= float(i); }
  else if (c < 0.95) { i = 9; x = (c - 0.9) / 0.05; }
  else if (c < 0.98) { i = 10; x = (c - 0.95) / 0.03; }
  else { i = 11; x = (c - 0.98) / 0.02; }
  return mix(covKnot(i, typ), covKnot(i + 1, typ), x);
}
/* Champ de couverture locale (xz): régions plus ou moins nuageuses, amplitude nulle aux extrêmes (0 % et 100 %) */
float covField(vec2 xz, float cov, float full) {
  float cv = tex3(tNoise, vec3(xz * (1.0 / 16000.0), 0.37), 128.0).r;
  if (full > 0.5) cv = cv * 0.6 + tex3(tNoise, vec3(rot2(xz, 0.8746, 0.4848) * (1.0 / 5300.0) + 0.5, 0.71), 128.0).r * 0.4;
  return clamp(cov + (cv - 0.5) * 2.2 * cov * (1.0 - cov), 0.0, 1.0);
}
/* Couche basse. type: 0 stratus, 0,5 stratocumulus, 1 cumulus; tour: bourgeonnement vertical; cb: cumulonimbus (enclume).
   detail > 0,5: érosion fine. covK: facteur de couverture du rayon (trouée autour du soleil). hh: hauteur relative (sortie). */
float dLow(vec3 p, float detail, float covK, out float hh) {
  float base = uLay0.x, top = uLay0.y, cov = clamp(uLay0.z * covK, 0.0, 1.0), typ = uLay0.w, tower = uLay0b.x, cb = uLay0b.y;
  float h = (p.y - base) / max(top - base, 1.0); hh = h;
  if (h <= 0.0 || h >= 1.0 || cov <= 0.002) return 0.0;
  vec3 q = p + uOff;
  float anvW = cb * smoothstep(0.7, 0.9, h);
  float covL = covField(q.xz, cov, detail) + anvW * 0.45;
  if (covL <= 0.002) return 0.0;
  float sy = mix(1.0, 0.4, tower), sxz = mix(1.0, 0.45, anvW);
  vec3 qs = vec3(q.x * sxz, (p.y - base) * sy + 1234.0, q.z * sxz);
  /* pas grossiers et lumière (detail = 0): une seule lecture; phase fine: seconde lecture tournée contre la répétition */
  vec4 n = tex3(tNoise, qs / 4500.0, 128.0);
  if (detail > 0.5) n = mix(n, tex3(tNoise, rotY(qs * vec3(1.0, 0.8, 1.0) + vec3(0.0, 311.0, 0.0), 0.7986, 0.6018) / 6900.0, 128.0), 0.4);
  n.r = clamp((n.r - 0.5) * 1.25 + 0.5, 0.0, 1.0); /* contraste rendu après le mélange des deux lectures */
  float fb = n.g * 0.625 + n.b * 0.25 + n.a * 0.125;
  float shape = rmp(n.r, -(1.0 - fb), 1.0);
  shape = mix(0.92, shape, mix(0.45, 1.0, typ)); /* stratiforme: champ presque uniforme */
  float grad = smoothstep(0.0, mix(0.12, 0.05, typ), h) * (1.0 - smoothstep(mix(0.3, 0.6, typ), 1.0, h));
  if (cb > 0.001) grad = max(grad, smoothstep(0.7, 0.88, h) * (1.0 - smoothstep(0.95, 1.0, h)) * cb);
  float covP = covMap(covL, typ);
  float d = rmp(shape * grad, 1.0 - covP, 1.0) * covP;
  if (detail > 0.5 && d > 0.0 && d < 0.92) {
    vec3 dn = mix(tex3(tDetail, (q + vec3(0.0, 777.0, 0.0)) / 600.0, 64.0).rgb, tex3(tDetail, rotY(q, 0.5, 0.866) / 437.0 + 0.3, 64.0).rgb, 0.4);
    float hf = dn.r * 0.625 + dn.g * 0.25 + dn.b * 0.125;
    float hfm = mix(hf, 1.0 - hf, clamp(h * 10.0, 0.0, 1.0));
    d = rmp(d, hfm * 0.6 * detail * mix(0.25, 1.0, typ) * mix(0.3, 1.0, smoothstep(0.04, 0.35, h)), 1.0); /* base plate et dense, sommet bourgeonnant; stratus peu érodé; detail: poids continu selon la distance */
  }
  /* Densité pleine dès 45 % de la plage: le bord d'un cumulus passe du vide au plein en quelques dizaines de mètres (contour net,
     chou-fleur), un stratus garde sa transition douce. */
  return mix(d, smoothstep(0.0, 0.45, d), typ);
}
/* Couche moyenne. type: 0 altostratus (voile épais uniforme), 1 altocumulus (petits pelotons en nappe) */
float dMid(vec3 p, float detail, out float hh) {
  float base = uLay1.x, top = uLay1.y, cov = uLay1.z, typ = uLay1.w;
  float h = (p.y - base) / max(top - base, 1.0); hh = h;
  if (h <= 0.0 || h >= 1.0 || cov <= 0.002) return 0.0;
  vec3 q = p + uOff * 0.6 + vec3(3100.0, 0.0, -2700.0);
  float covL = covField(q.xz * 1.3, cov, detail);
  if (covL <= 0.002) return 0.0;
  float L = mix(6000.0, 2600.0, typ);
  vec3 qs = vec3(q.x * 1.4, (p.y - base) * 1.5 + 321.0, q.z);
  vec4 n = tex3(tNoise, qs / L, 128.0);
  if (detail > 0.5) n = mix(n, tex3(tNoise, rotY(qs + vec3(0.0, 97.0, 0.0), 0.8988, 0.4384) / (L * 1.53), 128.0), 0.4);
  n.r = clamp((n.r - 0.5) * 1.25 + 0.5, 0.0, 1.0);
  float fb = n.g * 0.625 + n.b * 0.25 + n.a * 0.125;
  float shape = rmp(n.r, -(1.0 - fb), 1.0);
  shape = mix(0.9, shape, mix(0.3, 1.0, typ));
  float grad = smoothstep(0.0, 0.15, h) * (1.0 - smoothstep(0.5, 1.0, h));
  float covP = covMap(covL, typ);
  float d = rmp(shape * grad, 1.0 - covP, 1.0) * covP;
  if (detail > 0.5 && d > 0.0 && d < 0.92) {
    vec3 dn = mix(tex3(tDetail, (q + vec3(0.0, 555.0, 0.0)) / 500.0, 64.0).rgb, tex3(tDetail, rotY(q, 0.5, 0.866) / 371.0 + 0.6, 64.0).rgb, 0.4);
    float hf = dn.r * 0.625 + dn.g * 0.25 + dn.b * 0.125;
    d = rmp(d, mix(hf, 1.0 - hf, clamp(h * 6.0, 0.0, 1.0)) * 0.3 * detail * typ, 1.0);
  }
  return d;
}
/* Profondeur optique (sans sigma) vers le soleil: 5 pas croissants puis un échantillon lointain */
float tauTo(vec3 p, vec3 sd, float thick, float covK, int layer, float jit) {
  float st = thick * 0.09, t = st * (jit - 0.5), tau = 0.0, hh;
  for (int i = 0; i < 4; i++) { float ds = st * (float(i) + 1.0); t += ds; vec3 q = p + sd * max(t, 0.0); tau += (layer == 0 ? dLow(q, 0.0, covK, hh) : dMid(q, 0.0, hh)) * ds; }
  vec3 q = p + sd * thick * 1.8; tau += (layer == 0 ? dLow(q, 0.0, covK, hh) : dMid(q, 0.0, hh)) * thick * 0.6;
  return tau;
}
/* Lumière diffusée en un point du nuage: soleil (diffusion simple et multiple, fonction de phase avant et arrière), lumière
   transmise à travers l'épaisseur (ciel couvert clair, base d'orage sombre), ciel et rebond du sol */
vec3 scat(vec3 p, vec3 rd, float h, float dloc, vec3 sd, vec3 sunRad, float sig, float tauSun, float tauUp, float cov, float dark) {
  float cs = dot(rd, sd);
  float ts = tauSun * sig; vec3 sun = vec3(0.0); float a = 1.0, b = 1.0, c = 1.0;
  for (int o = 0; o < 3; o++) { float ph = 0.5 * hg(cs, 0.65 * c) + 0.5 * hg(cs, -0.35 * c); sun += a * exp(-ts * b) * ph; a *= 0.5; b *= 0.5; c *= 0.5; }
  float powder = 1.0 - exp(-dloc * 5.0);
  sun *= mix(1.0, powder, 0.2) * 1.6;
  float tauD = min(tauUp, tauSun) * sig;
  float trans = 1.0 / (1.0 + 0.22 * tauD);
  vec3 skyIrr = (uAmbZ * 0.65 + uAmbH * 0.35) * PI;
  vec3 diff = (sunRad * max(sd.y, 0.0) + skyIrr) / PI * 0.27 * trans;
  vec3 amb = uAmbG * (1.0 - h) * 0.35 * trans;
  vec3 L = (sunRad * sun + diff + amb) * (0.85 + 0.3 * (1.0 - dloc)); /* parties moins denses un peu plus claires: texture de la base */
  return L * mix(vec3(1.0), vec3(0.78, 0.84, 0.95), dark * (1.0 - trans));
}
/* Marche dans une couche: col/T accumulés (de l'avant vers l'arrière). layer 0: basse, 1: moyenne. */
void marchLayer(vec3 ro, vec3 rd, int layer, float jit, float covK, float quality, inout vec3 col, inout float T, inout float tFirst) {
  vec4 lay = layer == 0 ? uLay0 : uLay1; if (lay.z <= 0.002) return;
  float hb = lay.x - uGround, ht = lay.y - uGround, thick = lay.y - lay.x;
  vec2 s = seg(ro, rd, hb, ht); float maxT = layer == 0 ? 28000.0 : 60000.0;
  s.y = min(s.y, maxT); if (s.y <= s.x) return;
  vec3 sunRad = layer == 0 ? uSunL : uSunM;
  float typ = lay.w, sig = layer == 0 ? mix(0.03, 0.07, typ) : mix(0.015, 0.03, typ);
  float dMean = sig * mix(0.85, 0.8, typ) * (0.5 + 0.5 * lay.z);
  float nSteps = (layer == 0 ? 56.0 : 36.0) * quality;
  /* Pas: au plus un tiers de l'épaisseur de la couche (rayons rasants: la structure verticale reste échantillonnée),
     croissance lente avec la distance; au-delà du nombre d'itérations, le lointain reste dans la brume. */
  float len = s.y - s.x, dt0 = clamp(len / nSteps, layer == 0 ? 18.0 : 40.0, min(layer == 0 ? 140.0 : 400.0, 0.33 * thick));
  /* Marche à deux niveaux: pas grossiers sans détail dans le vide; au premier impact on recule d'un pas et on avance au
     quart du pas avec le détail. Un pas grossier a une épaisseur optique bien supérieure à 1: la couleur d'un pixel est
     décidée par son premier échantillon plein; si tous les pixels échantillonnent les mêmes altitudes, la base ondulée
     est quantifiée en terrasses, vues de côté comme des lignes horizontales. Le pas fin ramène les terrasses à quelques
     mètres et le tramage par pixel fait le reste. */
  float t = s.x + dt0 * jit, hh, dtPrev = 0.0, tauSun = 0.0; int empty = 0, fine = 0, lit = 0;
  for (int i = 0; i < 128; i++) {
    if (float(i) >= nSteps * 2.3 || t > s.y || T < 0.015) break;
    float dtC = dt0 * (1.0 + t / 11000.0), dt = fine > 0 ? dtC * 0.25 : dtC;
    vec3 p = ro + rd * t; float det = fine > 0 ? 1.0 - 0.9 * smoothstep(8000.0, 18000.0, t) : 0.0; /* érosion fine surtout de près (au loin elle fait du grain), poids continu */
    float d = layer == 0 ? dLow(p, det, covK, hh) : dMid(p, det, hh);
    if (d > 0.002 && fine == 0) { t = max(s.x, t - dtPrev); fine = 16; empty = 0; lit = 0; dtPrev = 0.0; continue; } /* premier impact: recul d'un pas, phase fine */
    if (d > 0.002) {
      if (tFirst < 0.0) tFirst = t;
      if (lit <= 0) { tauSun = tauTo(p, uSun, thick, covK, layer, jit); lit = 4; } /* lumière vers le soleil recalculée tous les quatre pas fins */
      lit--;
      float tauUp = (lay.y - p.y) * dMean / sig;
      vec3 S = scat(p, rd, hh, d, uSun, sunRad, sig, tauSun, tauUp, lay.z, layer == 0 ? uLay0b.w : 0.0);
      float ext = exp(-max(d, 0.0) * sig * max(dt, 0.0));
      col += T * S * (1.0 - ext); T *= ext; empty = 0;
    } else { empty++; }
    if (fine > 0) { fine--; if (empty > 3) fine = 0; }
    dtPrev = dt * (fine == 0 && empty > 2 ? 1.6 : 1.0); t += dtPrev;
  }
}
/* Rideaux de pluie sous la base (averses, orage): voile gris sous les régions les plus couvertes */
void marchShaft(vec3 ro, vec3 rd, float jit, inout vec3 col, inout float T) {
  if (uShaft <= 0.002 || uLay0.z <= 0.002) return;
  float hb = uLay0.x - uGround; vec2 s = seg(ro, rd, 2.0, hb); s.y = min(s.y, 15000.0); if (s.y <= s.x) return;
  float dt = (s.y - s.x) / 10.0, t = s.x + dt * jit;
  vec3 grey = (uAmbH * 0.6 + uAmbZ * 0.4) * 0.1 + uAmbG * 0.15; /* lumière sous une base d'averse: faible */
  for (int i = 0; i < 10; i++) {
    vec3 p = ro + rd * t; float cv = covField(p.xz + uOff.xz, uLay0.z, 0.0);
    float d = uShaft * smoothstep(0.45, 0.95, cv) * (0.5 + 0.5 * clamp((p.y - uGround) / max(hb, 1.0), 0.0, 1.0));
    float ext = exp(-d * 0.00035 * dt); col += T * grey * (1.0 - ext); T *= ext; t += dt;
  }
}
/* Nuages hauts (cirrus, cirrostratus): voile fibreux à l'altitude uHi.z */
void cirrus(vec3 ro, vec3 rd, inout vec3 col, inout float T) {
  float cov = uHi.x, typ = uHi.y; if (cov <= 0.002 || T < 0.01) return;
  vec2 s = shell(ro, rd, uHi.z); float t = s.y; if (t <= 0.0 || rd.y < -0.02) return;
  vec3 p = ro + rd * t + uOff; vec2 pv = p.xz * (1.0 / 14000.0);
  /* bancs de cirrus (grande échelle, trous de ciel bleu entre eux) puis filaments étirés dans une direction */
  float n1 = mix(tex3(tNoise, vec3(pv * 0.5 + 0.2, 0.11), 128.0).r, tex3(tNoise, vec3(rot2(pv, 0.9063, 0.4226) * 0.31 + 0.7, 0.19), 128.0).r, 0.4);
  float region = smoothstep(0.64 - 0.56 * cov, 0.8 - 0.45 * cov, n1);
  vec2 pr = vec2(pv.x * 0.35 + pv.y * 0.25, pv.y * 1.9 - pv.x * 0.5);
  float n2 = tex3(tNoise, vec3(pr * 1.7 + 0.3, 0.53), 128.0).g, n3 = tex3(tNoise, vec3(pr * 5.0 + 0.6, 0.83), 128.0).b;
  float fib = mix(tex3(tNoise, vec3(pr.x * 14.0, pr.y * 1.2, 0.29), 128.0).a, tex3(tNoise, vec3(pr.x * 9.3 + 0.4, pr.y * 0.8 + 0.2, 0.47), 128.0).a, 0.45); /* fibres étirées, deux échelles */
  float wisp = smoothstep(0.3, 0.8, n2 * 0.55 + n3 * 0.15 + fib * 0.45);
  float cs = dot(rd, uSun);
  float aCir = region * wisp * 0.6, aStr = (0.3 + 0.45 * smoothstep(0.3, 0.7, n2 * 0.7 + n3 * 0.3)) * mix(region, 1.0, 0.5);
  float a = mix(aCir, aStr, 1.0 - typ) * uHi.w;
  a *= smoothstep(-0.02, 0.08, rd.y); /* fondu au ras de l'horizon */
  if (a <= 0.002) return;
  vec3 L = uSunH * (0.03 + 0.25 * hg(cs, 0.7) + 0.04 * hg(cs, -0.3)) * 2.0 + (uAmbZ * 0.8 + uAmbH * 0.2) * 0.9;
  col += T * L * a; T *= 1.0 - a;
}
/* Tous les nuages pour un rayon: radiance prémultipliée et transmittance */
vec4 clouds(vec3 ro, vec3 rd, float jit, float quality) {
  vec3 col = vec3(0.0); float T = 1.0, tFirst = -1.0;
  float ga = acos(clamp(dot(rd, uSun), -1.0, 1.0)), gR = uGapR * (0.7 + 0.6 * tex3(tNoise, vec3(rd.xz * 3.0, 0.5), 128.0).g);
  float gp = 1.0 - smoothstep(0.35 * gR, gR, ga);
  float covK = 1.0 + gp * (uSunGap > 0.0 ? -0.75 : 0.9) * abs(uSunGap);
  marchShaft(ro, rd, jit, col, T);
  marchLayer(ro, rd, 0, jit, covK, quality, col, T, tFirst);
  marchLayer(ro, rd, 1, jit, 1.0, quality, col, T, tFirst);
  cirrus(ro, rd, col, T);
  /* perspective atmosphérique: les nuages lointains se fondent dans la brume de l'horizon */
  if (tFirst > 0.0) { float f = 1.0 - exp(-tFirst / 15000.0); col = mix(col, uAmbH * (1.0 - T), f); }
  return vec4(col, T);
}`;

// Passe des nuages à résolution réduite: rayons reconstruits depuis la caméra, résultat dans une texture lue par la sphère du ciel.
export const CLOUD_PASS_FRAG = CLOUD_GLSL + `
uniform mat4 uProjInv; uniform mat3 uV2W; uniform vec2 uRes; varying vec2 vUv;
void main() {
  vec4 pv = uProjInv * vec4(vUv * 2.0 - 1.0, 1.0, 1.0); vec3 rd = normalize(uV2W * (pv.xyz / pv.w));
  float jit = ignoise(gl_FragCoord.xy) * 0.8 + 0.1; /* tramage sur presque tout le pas: casse les structures régulières (lissé ensuite par les quatre lectures) */
  gl_FragColor = clouds(uCamW, rd, jit, 1.0);
}`;

// ---- Soleil vu depuis une altitude h (m au-dessus du sol): extinction le long du rayon vers le soleil dans une atmosphère
// sphérique (densité de l'air exponentielle: 8,4 km pour la diffusion de Rayleigh, 1,25 km pour les aérosols), et visibilité
// (la Terre cache le soleil quand le point le plus bas du rayon passe sous le sol; bord adouci). el: hauteur du soleil au sol
// (rad). Renvoie { rgb: transmittance par couleur, vis: 0 à 1, dip: hauteur du soleil sous laquelle il se couche à cette altitude }.
// Aérosols (brume, poussières): épaisseur optique verticale de 0,06 x (turbidité - 1) à 550 nm (0,08 par air rural propre,
// 0,24 sous un voile, plus sous la fumée), dépendance spectrale d'Ångström (exposant 1,3). Sans eux (le terme de Mie de
// Preetham est 50 fois trop faible), la lumière rasante d'après le coucher, qui traverse deux fois les basses couches,
// sortait rouge pur et teintait les nuages en rose; avec eux, les nuages bas s'allument orangé au moment du coucher puis
// s'éteignent en quelques minutes, et seuls les nuages hauts gardent une lueur rouge plus longtemps (Stéphane, 9 octobre
// 2026: « c'est rare les effets roses »).
const TR = [5.804542996261093e-6, 1.3562911419845635e-5, 3.0265902468824876e-5];
const AER = [0.76, 1.0, 1.34]; // (680, 550, 440 nm / 550 nm) ^ -1,3
export function sunAtAltitude(el0, h, turb, ray = 1.5) {
  // Réfraction atmosphérique: le soleil paraît plus haut d'environ 0,9 degré au ras de l'horizon (rayon rasant: réfraction des
  // deux côtés du point bas; nulle à 20 degrés), ce qui allonge d'autant la fenêtre où les nuages restent éclairés après le coucher au sol.
  const el = el0 + 0.0157 * Math.max(0, 1 - Math.max(el0, 0) / 0.35);
  const R = 6371000, HR = 8400, HM = 1250, r0 = R + Math.max(0, h), se = Math.sin(el);
  const aod = 0.06 * Math.max(0.5, turb - 1), bR = TR.map(v => v * ray), bM = AER.map(v => v * aod / HM);
  let tauR = 0, tauM = 0, s = 0; const N = 64;
  for (let i = 0; i < N; i++) {
    const s1 = 700000 * Math.pow((i + 1) / N, 2), sm = 0.5 * (s + s1), ds = s1 - s;
    const r = Math.sqrt(r0 * r0 + sm * sm + 2 * sm * r0 * se), a = Math.max(0, r - R);
    tauR += Math.exp(-a / HR) * ds; tauM += Math.exp(-a / HM) * ds; s = s1;
  }
  const rgb = bR.map((b, i) => Math.exp(-(b * tauR + bM[i] * tauM)));
  const dip = Math.acos(R / r0); // hauteur (négative) du soleil quand il touche l'horizon vu de h
  const aMin = el >= 0 ? h : r0 * Math.cos(el) - R; // altitude du point le plus bas du rayon (rayon horizontal ou descendant)
  const vis = Math.max(0, Math.min(1, (aMin + 500) / 1000)); // ombre de la Terre, bord adouci sur 1 km (diamètre du soleil, pénombre)
  return { rgb, vis, dip: -dip };
}

// ---- Classement des nuages d'après la rangée horaire (ICON): couches basse, moyenne et haute avec leur forme.
// Hauteurs en mètres au-dessus du sol. names: mots de la légende. Sans profil (rangée ancienne, GFS): règles simples sur
// les parts bas/moyen/haut, le nuage convectif et le code météo.
export function classifyClouds(row) {
  const r = row || {};
  const low = (r.cloudLow ?? 0) / 100, mid = (r.cloudMid ?? 0) / 100, high = (r.cloudHigh ?? 0) / 100;
  const wc = r.wc ?? 0, cape = r.cape ?? 0, precip = r.precip ?? 0, iv = r.sunFraction == null ? 0.02 : r.sunFraction;
  const elev = r.elev ?? 0;
  const cBase = r.convBase > 0 ? Math.max(150, r.convBase - elev) : 0, cDepth = r.convDepth ?? 0;
  const prof = Array.isArray(r.prof) && r.prof.length === 12 ? r.prof : null, profZ = Array.isArray(r.profZ) ? r.profZ : null;
  // Bande d'un étage dans le profil: base et sommet des niveaux nuageux (au moins 5 %), étendus d'un demi-écart.
  const band = (z0, z1) => {
    if (!prof || !profZ) return null;
    let lo = null, hi = null, w = 0, zc = 0;
    for (let i = 0; i < 12; i++) {
      const z = profZ[i], c = prof[i]; if (z == null || z < z0 || z >= z1 || c < 5) continue;
      const zp = i > 0 && profZ[i - 1] != null ? profZ[i - 1] : z - 400, zn = i < 11 && profZ[i + 1] != null ? profZ[i + 1] : z + 600;
      const b = z - 0.5 * (z - zp), t = z + 0.5 * (zn - z);
      lo = lo == null ? b : Math.min(lo, b); hi = hi == null ? t : Math.max(hi, t); w += c; zc += c * z;
    }
    return lo == null ? null : { base: lo, top: hi, center: zc / w };
  };
  const bLow = band(0, 2500), bMid = band(2500, 7000), bHigh = band(7000, 20000);
  const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const storm = wc >= 95 ? 1 : wc === 82 ? 0.9 : wc === 81 ? 0.75 : wc === 80 ? 0.6 : 0;
  const rain = (wc >= 61 && wc <= 67) || (wc >= 51 && wc <= 57) ? 1 : 0, snow = wc >= 71 && wc <= 77 ? 1 : 0, fogCode = wc === 45 || wc === 48 ? 1 : 0;
  // ---- couche basse
  const conv = cDepth > 0 && cBase > 0 && cBase < 3200;
  const cb = Math.max(storm, smooth(5000, 9000, cDepth) * (precip >= 0.1 ? 1 : 0.6)) * smooth(0.2, 0.6, low);
  const tower = Math.max(smooth(1500, 5000, cDepth), cb);
  let base, top, typ;
  if (conv) { base = cBase; top = cBase + cDepth; typ = 1; }
  else if (bLow) { base = bLow.base; top = bLow.top; typ = low >= 0.9 && base < 500 ? 0 : low >= 0.65 ? 0.4 : 0.7; }
  else { base = r.lcl != null ? r.lcl : 700; top = base + (low >= 0.65 ? 500 : 900); typ = low >= 0.95 ? 0.1 : low >= 0.65 ? 0.4 : 0.8; }
  if (cape > 300 && !conv) typ = Math.max(typ, 0.8); // air instable: cumulus
  if (rain || snow) { typ = Math.min(typ, 0.15); top = Math.max(top, base + 2500); } // nimbostratus: couche épaisse et sombre
  if (fogCode) { typ = 0; base = Math.min(base, 120); top = Math.max(top, 400); }
  base = Math.max(120, Math.min(2600, base)); top = Math.max(base + 250, Math.min(cb > 0.3 ? 12500 : 4500, top));
  if (cb > 0.3) top = Math.max(top, 6000 + 5000 * cb); // cumulonimbus: tour jusqu'à l'enclume
  const lowL = { cov: low, base, top, type: typ, tower, cb, dark: Math.max(cb, rain * 0.6, smooth(0.3, 0.05, iv) * smooth(0.6, 0.95, low) * 0.5) };
  // ---- couche moyenne
  let mBase, mTop, mTyp, mCov = mid;
  if (bMid) { mBase = bMid.base; mTop = bMid.top; } else { mBase = 3200; mTop = 4300; }
  const mThick = mTop - mBase;
  mTyp = 1 - smooth(0.55, 0.85, mid) * smooth(800, 2000, mThick + 600 * (1 - iv)); // altostratus si couvert et épais
  if (rain) { mTyp = 0; mCov = Math.max(mCov, low); mBase = Math.min(mBase, top + 200); } // nimbostratus prolongé
  mBase = Math.max(lowL.top + 100, Math.min(6500, mBase)); mTop = Math.max(mBase + 300, Math.min(7500, mTop));
  const midL = { cov: mCov, base: mBase, top: mTop, type: mTyp };
  // ---- nuages hauts
  const hAlt = bHigh ? bHigh.center : 9000;
  const hTyp = 1 - smooth(0.5, 0.85, high); // cirrostratus quand la couverture est forte
  const hThick = 0.55 + 0.45 * (1 - iv); // voile plus dense quand le soleil direct est faible
  const highL = { cov: high, type: hTyp, alt: Math.max(7000, Math.min(12000, hAlt)), thick: hThick };
  // ---- mots de la légende
  const names = [];
  if (low >= 0.05) names.push(cb >= 0.5 ? 'cumulonimbus' : rain || snow ? 'nimbostratus' : fogCode ? 'stratus' : typ >= 0.75 ? (tower >= 0.5 ? 'cumulus bourgeonnants' : 'cumulus') : typ >= 0.3 ? 'stratocumulus' : 'stratus');
  if (mCov >= 0.05 && !(rain && low >= 0.05) && !(storm >= 0.9 && high >= 0.05)) names.push(mTyp >= 0.5 ? 'altocumulus' : 'altostratus');
  if (high >= 0.05) names.push(storm >= 0.9 ? 'enclume' : hTyp >= 0.5 ? 'cirrus' : 'cirrostratus');
  return { low: lowL, mid: midL, high: highL, names, shaft: Math.max(storm, wc >= 80 ? 0.5 : 0, precip >= 0.5 ? 0.4 : 0) * smooth(0.1, 2, precip) };
}
