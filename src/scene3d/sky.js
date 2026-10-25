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
uniform vec3 uHz[9]; /* couleur du ciel clair au ras de l'horizon, de 0 à 180° du soleil par pas de 22,5° (linéaire) */
uniform float uPixAng; /* taille angulaire d'un pixel (rad), pour le niveau de détail */
float gLod = 0.0; /* niveau de détail du bruit pour l'échantillon courant (0: plein détail, 1: champ moyen) */
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
/* Altitude d'un point de la scène au-dessus de la Terre ronde (centrée sous la caméra): la hauteur « plate » plus la chute de
   l'horizon, d²/2R. Les couches sont trouvées sur des coquilles sphériques (seg); sans ce terme, la densité était évaluée à
   l'altitude plate et, vers 90 km, un rayon à 3° se croyait 640 m sous la base d'une couche à 5 km: la couche s'arrêtait net à
   élévation constante (« fin très sèche comme les vieux 3D », Stéphane, 11 octobre 2026). */
float altC(vec3 p) { vec2 d = p.xz - uCamW.xz; return p.y + dot(d, d) * (0.5 / PR); }
/* Couleur du ciel clair au ras de l'horizon dans la direction rd (interpolée selon l'angle au soleil) */
vec3 hzCol(vec3 rd) {
  float la = length(rd.xz), lb = length(uSun.xz);
  float c = (la > 1e-4 && lb > 1e-4) ? dot(rd.xz, uSun.xz) / (la * lb) : 0.0;
  float x = acos(clamp(c, -1.0, 1.0)) / 0.39269908; int k = int(min(floor(x), 7.0));
  return mix(uHz[k], uHz[k + 1], clamp(x - float(k), 0.0, 1.0));
}
/* Part de brume entre la caméra et un point à la distance t: épaisseur optique de l'air traversé, dense près du sol (échelle
   de hauteur 1,5 km, 16 km d'extinction au sol). Un nuage au zénith à 5 km n'est presque pas voilé; une couche vue au ras de
   l'horizon, à 100 km, se fond dans la couleur de l'horizon: continûment, sans bord. */
float hazeW(vec3 ro, float altP, float t) {
  float a = max(altC(ro) - uGround, 0.0) / 1500.0, b = max(altP - uGround, 0.0) / 1500.0;
  float m = abs(b - a) < 1e-3 ? exp(-a) : (exp(-a) - exp(-b)) / (b - a);
  return 1.0 - exp(-t * m / 16000.0);
}
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
const float CM5[13] = float[13](0.27, 0.33, 0.353, 0.369, 0.384, 0.398, 0.412, 0.427, 0.446, 0.473, 0.498, 0.547, 1.0); /* recalibrée le 10 octobre 2026 (érosion du stratus réduite) */
const float CM0[13] = float[13](0.22, 0.237, 0.254, 0.269, 0.282, 0.295, 0.31, 0.327, 0.351, 0.389, 0.43, 0.502, 1.0);
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
  p.y = altC(p);
  float h = (p.y - base) / max(top - base, 1.0); hh = h;
  if (h <= 0.0 || h >= 1.0 || cov <= 0.002) return 0.0;
  vec3 q = p + uOff;
  /* Déformation du domaine: les textures de bruit sont périodiques (600 m, 4,5 km) et, vues en perspective sous un stratus,
     leurs cases faisaient un carrelage qui convergeait en rayons vers l'horizon (« gros cylindre avec une texture cheap »,
     Stéphane, 11 octobre 2026). Un déplacement lent (période 11 km, amplitude 2,2 km) tord le réseau: plus de motif régulier. */
  vec3 w = tex3(tNoise, vec3(q.x, q.y * 0.3, q.z) / 11000.0 + vec3(0.31, 0.57, 0.13), 128.0).rgb - vec3(0.5, 0.35, 0.3);
  vec2 qw = q.xz + w.xy * 2200.0;
  float anvW = cb * smoothstep(0.7, 0.9, h);
  float covL = covField(qw, cov, detail) + anvW * 0.45;
  if (covL <= 0.002) return 0.0;
  float sy = mix(1.0, 0.4, tower), sxz = mix(1.0, 0.45, anvW);
  vec3 qs = vec3(qw.x * sxz, (p.y - base) * sy + 1234.0, qw.y * sxz);
  vec4 n = tex3(tNoise, qs / 4500.0, 128.0); /* une seule lecture: la déformation du domaine suffit contre la répétition */
  float fb = n.g * 0.625 + n.b * 0.25 + n.a * 0.125;
  float shape = rmp(n.r, -(1.0 - fb), 1.0);
  shape = mix(0.92, shape, mix(0.45, 1.0, typ)); /* stratiforme: champ presque uniforme */
  float grad = smoothstep(0.0, mix(0.12, 0.05, typ), h) * (1.0 - smoothstep(mix(0.3, 0.6, typ), 1.0, h));
  if (cb > 0.001) grad = max(grad, smoothstep(0.7, 0.88, h) * (1.0 - smoothstep(0.95, 1.0, h)) * cb);
  float covP = covMap(covL, typ);
  float d = rmp(shape * grad, 1.0 - covP, 1.0) * covP;
  /* Niveau de détail: au loin et au ras de l'horizon, les cellules deviennent plus petites qu'un pixel et chaque pixel tirait
     un échantillon au hasard (du grain, du « sable »). Elles se fondent alors dans leur densité moyenne: une couche lointaine
     devient un banc continu, comme à l'oeil. */
  d = mix(d, covL * grad * 0.5, gLod);
  if (detail > 0.5 && gLod < 0.95 && d > 0.0 && d < 0.92) {
    vec3 qd = vec3(q.x + w.x * 260.0, q.y, q.z + w.y * 260.0); /* le détail suit la même déformation, à son échelle */
    vec3 dn = tex3(tDetail, (qd + vec3(0.0, 777.0, 0.0)) / 600.0, 64.0).rgb;
    float hf = dn.r * 0.625 + dn.g * 0.25 + dn.b * 0.125;
    float hfm = mix(hf, 1.0 - hf, clamp(h * 10.0, 0.0, 1.0));
    d = rmp(d, hfm * 0.6 * detail * (1.0 - gLod) * mix(0.25, 1.0, typ) * mix(0.3, 1.0, smoothstep(0.04, 0.35, h)), 1.0); /* base plate et dense, sommet bourgeonnant; stratus peu érodé; detail: poids continu selon la distance */
  }
  /* Densité pleine dès 45 % de la plage: le bord d'un cumulus passe du vide au plein en quelques dizaines de mètres (contour net,
     chou-fleur), un stratus garde sa transition douce. */
  return mix(d, smoothstep(0.0, 0.45, d), typ);
}
/* Couche moyenne. type: 0 altostratus (voile épais uniforme), 1 altocumulus (petits pelotons en nappe) */
float dMid(vec3 p, float detail, out float hh) {
  float base = uLay1.x, top = uLay1.y, cov = uLay1.z, typ = uLay1.w;
  p.y = altC(p);
  float h = (p.y - base) / max(top - base, 1.0); hh = h;
  if (h <= 0.0 || h >= 1.0 || cov <= 0.002) return 0.0;
  vec3 q = p + uOff * 0.6 + vec3(3100.0, 0.0, -2700.0);
  vec3 w = tex3(tNoise, vec3(q.x, q.y * 0.3, q.z) / 9000.0 + vec3(0.71, 0.23, 0.47), 128.0).rgb - vec3(0.5, 0.35, 0.3);
  q.xz += w.xy * 1600.0; /* déformation du domaine, comme la couche basse */
  /* Altocumulus: cellules de taille variable (0,7 à 1,3 fois) et bancs plus ou moins fournis par régions, sinon un motif
     uniforme qui lisait comme une texture plaquée (Stéphane, 11 octobre 2026). */
  float covL = covField(q.xz * 1.3, cov, detail) * mix(1.0, 0.55 + 0.55 * smoothstep(-0.3, 0.3, w.z + 0.3), typ);
  if (covL <= 0.002) return 0.0;
  float L = mix(6000.0, 2600.0, typ) * (0.7 + 0.6 * (w.x + 0.5));
  vec3 qs = vec3(q.x * 1.4, (p.y - base) * 1.5 + 321.0, q.z);
  vec4 n = tex3(tNoise, qs / L, 128.0);
  float fb = n.g * 0.625 + n.b * 0.25 + n.a * 0.125;
  float shape = rmp(n.r, -(1.0 - fb), 1.0);
  shape = mix(0.9, shape, mix(0.3, 1.0, typ));
  float grad = smoothstep(0.0, 0.15, h) * (1.0 - smoothstep(0.5, 1.0, h));
  float covP = covMap(covL, typ);
  float d = rmp(shape * grad, 1.0 - covP, 1.0) * covP;
  d = mix(d, covL * grad * 0.5, gLod); /* niveau de détail, comme la couche basse */
  if (detail > 0.5 && gLod < 0.95 && d > 0.0 && d < 0.92) {
    vec3 dn = tex3(tDetail, (q + vec3(w.x * 200.0, 555.0, w.y * 200.0)) / 500.0, 64.0).rgb;
    float hf = dn.r * 0.625 + dn.g * 0.25 + dn.b * 0.125;
    d = rmp(d, mix(hf, 1.0 - hf, clamp(h * 6.0, 0.0, 1.0)) * 0.3 * detail * (1.0 - gLod) * typ, 1.0);
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
  vec3 skyI = uAmbZ * 0.65 + uAmbH * 0.35; vec3 skyIrr = mix(skyI, vec3(dot(skyI, vec3(0.2126, 0.7152, 0.0722))), 0.4) * PI; /* tout l'hémisphère éclaire le dessus: moins bleu que le zénith (une base de stratus au lever sortait bleu marine) */
  vec3 diff = (sunRad * max(sd.y, 0.0) + skyIrr) / PI * 0.36 * trans;
  vec3 amb = uAmbG * (1.0 - h) * 0.35 * trans;
  vec3 L = (sunRad * sun + diff + amb) * (0.85 + 0.3 * (1.0 - dloc)); /* parties moins denses un peu plus claires: texture de la base */
  return L * mix(vec3(1.0), vec3(0.78, 0.84, 0.95), dark * (1.0 - trans));
}
/* Marche dans une couche: col/T accumulés (de l'avant vers l'arrière). layer 0: basse, 1: moyenne. */
/* Banc moyen (lointain): la couche entre t0 et t1 vue comme un milieu continu, sans tirage au hasard. Densité moyenne du
   champ de couverture à mi-hauteur, opacité par la longueur traversée, couleur calculée au point d'épaisseur optique 1, voilée
   par la brume de sa distance. Fonction lisse de la direction: pas de grain, et se raccorde à la marche quand les cellules
   deviennent plus petites qu'un pixel. */
void slab(vec3 ro, vec3 rd, int layer, float t0, float t1, vec4 lay, float sig, float thick, float covK, vec3 sunRad, float dark, vec3 hz, inout vec3 col, inout float T) {
  if (t1 <= t0 || T < 0.015) return;
  gLod = 1.0; float hh0;
  vec3 pm = ro + rd * t0; pm.y += lay.x + 0.35 * thick - altC(pm);
  float dm = layer == 0 ? dLow(pm, 0.0, covK, hh0) : dMid(pm, 0.0, hh0);
  if (dm <= 0.002) return;
  float ext = sig * dm * 0.7, A = 1.0 - exp(-(t1 - t0) * ext);
  float te = min(t0 + 1.0 / ext, t1);
  vec3 pe = ro + rd * te; float ae = clamp(altC(pe), lay.x + 0.08 * thick, lay.y - 0.08 * thick); pe.y += ae - altC(pe);
  /* mêmes paramètres que la marche au niveau de détail 1 (densité moyenne, colonne au-dessus comme dans la marche): les deux se
     raccordent sans bord */
  float dMeanS = sig * mix(0.85, 0.8, lay.w) * (0.5 + 0.5 * lay.z);
  vec3 S = scat(pe, rd, (ae - lay.x) / thick, dm, uSun, sunRad, sig, tauTo(pe, uSun, thick, covK, layer, 0.5), (lay.y - ae) * dMeanS / sig, lay.z, dark);
  col += T * mix(S, hz, hazeW(ro, ae, te)) * A; T *= 1.0 - A;
}
void marchLayer(vec3 ro, vec3 rd, int layer, float jit, float covK, float quality, inout vec3 col, inout float T, inout float tFirst) {
  vec4 lay = layer == 0 ? uLay0 : uLay1; if (lay.z <= 0.002) return;
  float hb = lay.x - uGround, ht = lay.y - uGround, thick = lay.y - lay.x;
  vec2 s = seg(ro, rd, hb, ht); if (s.y <= s.x) return;
  vec3 sunRad = layer == 0 ? uSunL : uSunM;
  float typ = lay.w, sig = layer == 0 ? mix(0.03, 0.07, typ) * clamp(uLay0b.z, 0.05, 1.0) : mix(0.015, 0.03, typ); /* uLay0b.z: nuages bas minces (classifyClouds) */
  float dMean = sig * mix(0.85, 0.8, typ) * (0.5 + 0.5 * lay.z), dark = layer == 0 ? uLay0b.w : 0.0;
  float Lf = layer == 0 ? 4500.0 : mix(6000.0, 2600.0, typ), ady = max(abs(rd.y), 0.02);
  vec3 hz = hzCol(rd);
  /* Partie marchée: jusqu'à la distance où le niveau de détail atteint 1 (empreinte d'un pixel = Lf / 6: la marche y est déjà
     passée progressivement au champ moyen), au plus 28 km (basse) ou 90 km (moyenne); le reste, jusqu'à la vraie sortie de la
     couche (400 km au plus au ras de l'horizon), en banc moyen calculé de la même façon: aucun raccord visible. */
  float sEnd = min(s.y, 400000.0), tLod = (Lf / 6.0) * ady / max(uPixAng, 1e-5);
  s.y = min(s.y, min(layer == 0 ? 28000.0 : 90000.0, tLod));
  if (s.y <= s.x) { slab(ro, rd, layer, s.x, sEnd, lay, sig, thick, covK, sunRad, dark, hz, col, T); return; }
  float sCap = s.y; /* fin de la portée de la marche: le banc moyen ne couvre que ce qui est au-delà */
  float nSteps = (layer == 0 ? 56.0 : 36.0) * quality;
  /* Pas: au plus un tiers de l'épaisseur de la couche (rayons rasants: la structure verticale reste échantillonnée),
     croissance lente avec la distance. */
  float len = s.y - s.x, dt0 = clamp(len / nSteps, layer == 0 ? 18.0 : 40.0, min(layer == 0 ? 140.0 : 400.0, 0.33 * thick));
  /* Marche à deux niveaux: pas grossiers sans détail dans le vide; au premier impact on recule d'un pas et on avance au
     quart du pas avec le détail. Un pas grossier a une épaisseur optique bien supérieure à 1: la couleur d'un pixel est
     décidée par son premier échantillon plein; si tous les pixels échantillonnent les mêmes altitudes, la base ondulée
     est quantifiée en terrasses, vues de côté comme des lignes horizontales. Le pas fin ramène les terrasses à quelques
     mètres et le tramage par pixel fait le reste. */
  float t = s.x + dt0 * jit, hh, dtPrev = 0.0, tauSun = 0.0; int empty = 0, fine = 0, lit = 0, hits = 0;
  for (int i = 0; i < 128; i++) {
    if (float(i) >= nSteps * (layer == 0 ? 2.3 : 3.4) || t > s.y || T < 0.015) break;
    float dtC = dt0 * (1.0 + t / 11000.0), dt = fine > 0 ? dtC * 0.25 : dtC;
    vec3 p = ro + rd * t; float det = fine > 0 ? 1.0 - 0.9 * smoothstep(8000.0, 18000.0, t) : 0.0; /* érosion fine surtout de près */
    gLod = smoothstep(Lf / 40.0, Lf / 6.0, uPixAng * t / ady); /* empreinte d'un pixel sur la couche, étirée au ras de l'horizon */
    float d = layer == 0 ? dLow(p, det, covK, hh) : dMid(p, det, hh);
    if (d > 0.002 && fine == 0) { t = max(s.x, t - dtPrev); fine = 16; empty = 0; lit = 0; dtPrev = 0.0; continue; } /* premier impact: recul d'un pas, phase fine */
    if (d > 0.002) {
      if (tFirst < 0.0) tFirst = t;
      /* Lumière vers le soleil recalculée à chacun des quatre premiers échantillons (c'est là que la couleur du pixel se décide),
         puis tous les quatre: réutilisée depuis la frange mince de la base, très éclairée par le soleil rasant, elle faisait
         sortir le coeur dense comme éclairé à travers (bande blanche à bord net au coucher, vers le soleil). */
      if (hits < 4 || lit <= 0) { tauSun = tauTo(p, uSun, thick, covK, layer, jit); lit = 4; }
      lit--; hits++;
      float ap = altC(p), tauUp = (lay.y - ap) * dMean / sig;
      vec3 S = scat(p, rd, hh, d, uSun, sunRad, sig, tauSun, tauUp, lay.z, dark);
      float ext = exp(-max(d, 0.0) * sig * max(dt, 0.0));
      col += T * mix(S, hz, hazeW(ro, ap, t)) * (1.0 - ext); T *= ext; empty = 0;
    } else { empty++; }
    if (fine > 0) { fine--; if (empty > 3) fine = 0; }
    dtPrev = dt * (fine == 0 && empty > 2 ? 1.6 : 1.0); t += dtPrev;
  }
  /* Le reste de la couche au-delà de la portée, en banc moyen. Jamais le trou laissé par une marche interrompue de près
     (plafond d'itérations dans des cumulus épars): rempli au champ moyen, un cumulus à 10 % couvrait 78 % du ciel. */
  slab(ro, rd, layer, sCap, sEnd, lay, sig, thick, covK, sunRad, dark, hz, col, T);
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
/* Bruit de gradient 2D calculé (pas lu dans une texture), valeurs dans [-0,7, 0,7] environ. Pour les fibres des cirrus: lues
   dans tNoise avec tex3, leur étirement (12 pour 1) agrandissait les paliers de la lecture lissée en dents régulières le long
   de chaque fibre (Stéphane, 25 octobre 2026: « saccadé »). */
vec2 h22(vec2 p) { vec3 q = fract(p.xyx * vec3(0.1031, 0.1030, 0.0973)); q += dot(q, q.yzx + 33.33); return fract((q.xx + q.yz) * q.zy) * 2.0 - 1.0; }
float gn2(vec2 p) {
  vec2 i = floor(p), f = fract(p), w = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float a = dot(h22(i), f), b = dot(h22(i + vec2(1.0, 0.0)), f - vec2(1.0, 0.0));
  float c = dot(h22(i + vec2(0.0, 1.0)), f - vec2(0.0, 1.0)), d = dot(h22(i + vec2(1.0, 1.0)), f - vec2(1.0, 1.0));
  return mix(mix(a, b, w.x), mix(c, d, w.x), w.y);
}
float gPix = 0.0; /* taille angulaire d'un pixel de la passe en cours (rad); 0: celle de l'image pleine résolution (uPixAng) */
/* Empreinte du pixel sur la couche des cirrus (gFl le long de la visée horizontale gHv, gPa en travers) comparée à un détail
   d'axe a, de taille La le long de a et Lb en travers: 1 si le détail est résolu, 0 s'il tombe sous le pixel (ramené à sa
   moyenne). Dans les deux directions: en vue rasante, un pixel couvre des kilomètres dans le sens de la visée, et un détail
   lissé seulement en travers moutonnait près de l'horizon. */
float gFl = 0.0, gPa = 0.0; vec2 gHv = vec2(1.0, 0.0);
float kfp(vec2 a, float La, float Lb) {
  float ca = dot(gHv, a), cb = gHv.y * a.x - gHv.x * a.y;
  float fa = sqrt(gFl * gFl * ca * ca + gPa * gPa * cb * cb), fb = sqrt(gFl * gFl * cb * cb + gPa * gPa * ca * ca);
  return 1.0 - smoothstep(0.3, 0.8, max(fa / La, fb / Lb));
}
/* Fibres le long de l'axe a (q: coordonnées le long, en travers): traînées larges (900 m) et stries fines (260 m); k: part résolue */
void fibres(vec2 q, vec2 a, out float fb, out float ff, out vec2 k) {
  float kb = kfp(a, 6000.0, 900.0), kb2 = kfp(a, 2500.0, 300.0), k1 = kfp(a, 2600.0, 260.0), k2 = kfp(a, 1100.0, 100.0);
  fb = 0.5 + 0.55 * kb * gn2(vec2(q.x / 6000.0, q.y / 900.0)) + 0.15 * kb2 * gn2(vec2(q.x / 2500.0 + 3.1, q.y / 300.0 + 7.7));
  ff = 0.5 + 0.6 * k1 * gn2(vec2(q.x / 2600.0, q.y / 260.0)) + 0.22 * k2 * gn2(vec2(q.x / 1100.0 + 1.7, q.y / 100.0 + 4.1));
  k = vec2(kb, k1);
}
/* Nuages hauts (cirrus, cirrostratus): voile à l'altitude uHi.z. Cirrus (couverture faible), calés sur sa banque de ciels
   (_PSD/_ciels/CIEL, photos 3, 11, 14, 73, 106, 108) et mesurés contre elle (contraste, finesse, parallélisme des fibres):
   bancs au coeur en voile diffus, fibres surtout visibles sur les bords effilés; faisceaux de fibres orientés un peu
   différemment les uns des autres (éventails), dans l'ensemble le long du vent en altitude (même sens que la dérive uOff);
   une seconde famille croisée à 34 degrés par endroits. Les fibres ondulent sans jamais se replier: l'ancien motif
   (déformation du domaine forte, fibres tournant avec elle) dessinait des tourbillons et des marbrures (Stéphane, 25 octobre
   2026: « forme un peu biz »); une première version aux fibres toutes parallèles faisait « coup de peigne ». Couverture: seuil
   ajusté pour que la part de la couche où le voile dépasse 5 % égale la couverture d'ICON. Pas de grain (« il n'y a jamais
   de grain dans les vrais nuages »). Cirrostratus (couverture forte): voile laiteux presque uniforme, variations douces à
   grande échelle seulement. Vers l'horizon, le voile se fond dans la brume au lieu de s'effacer. */
void cirrus(vec3 ro, vec3 rd, inout vec3 col, inout float T) {
  float cov = uHi.x, typ = uHi.y; if (cov <= 0.002 || T < 0.01) return;
  vec2 s = shell(ro, rd, uHi.z); float t = s.y; if (t <= 0.0 || rd.y < -0.06) return;
  vec3 p0 = ro + rd * t, p = p0 + uOff;
  vec3 nU = normalize(p0 - vec3(uCamW.x, uGround - PR, uCamW.z)), hd = rd - nU * dot(rd, nU);
  gHv = hd.xz / max(length(hd.xz), 1e-5); gPa = max(gPix, uPixAng) * t; gFl = gPa / max(dot(rd, nU), 0.03);
  const vec2 D = vec2(-0.929, 0.371), P = vec2(-0.371, -0.929), D2 = vec2(-0.5573, 0.8308);
  float u = dot(p.xz, D), v = dot(p.xz, P);
  float vv = v + 7000.0 * gn2(vec2(u / 40000.0, v / 60000.0)) + 600.0 * gn2(vec2(u / 11000.0 + 3.7, v / 5000.0 + 1.3)) + 3500.0 * gn2(vec2(u / 20000.0 + 2.9, v / 20000.0 + 8.3));
  float uu = u + 2000.0 * gn2(vec2(u / 20000.0 + 7.1, v / 9000.0)) + 3500.0 * gn2(vec2(u / 20000.0 + 5.5, v / 20000.0 + 1.9));
  float rg = 0.5 + 0.62 * gn2(vec2(uu / 42000.0, vv / 20000.0)) + 0.3 * gn2(vec2(uu / 15000.0 + 5.3, vv / 7000.0 + 2.9)) + 0.12 * kfp(D, 6000.0, 2500.0) * gn2(vec2(uu / 6000.0 + 8.1, vv / 2500.0 + 0.7));
  float region = smoothstep(0.0, 1.0, (rg - (0.6324 - 0.4978 * cov + 0.147 * cov * cov)) / 0.2), aCir = 0.0, aStr = 0.0;
  if (region > 0.0) {
    float fb, ff, fb2, ff2; vec2 k, k2;
    fibres(vec2(uu, vv), D, fb, ff, k);
    fibres(vec2(uu * 0.8253 - vv * 0.5646 + 777.0, uu * 0.5646 + vv * 0.8253 + 333.0), D2, fb2, ff2, k2);
    float xs = 0.5 * smoothstep(0.35, 0.75, 0.5 + 1.3 * gn2(vec2(uu / 18000.0 + 6.1, vv / 12000.0 + 2.4)));
    float sel = smoothstep(0.3, 0.7, 0.5 + 1.2 * gn2(vec2(uu / 25000.0 + 4.4, vv / 8000.0 + 9.9)));
    float f = mix(mix(fb, ff, sel), mix(fb2, ff2, sel), xs), kf = mix(mix(k.x, k.y, sel), mix(k2.x, k2.y, sel), xs);
    float st = mix(0.0122 + 0.0387 * region + 0.4283 * region * region, smoothstep(0.62 - 0.3 * region, 0.9 - 0.2 * region, f), kf);
    float cl = 0.75 + 0.5 * kfp(D, 5000.0, 1500.0) * gn2(vec2(uu / 5000.0 + 2.2, vv / 1500.0 + 5.5));
    aCir = clamp(region * mix(0.55 + 0.45 * st, 1.0, 0.7 * region * region) * cl, 0.0, 1.0) * 0.46;
  }
  if (typ < 0.999) {
    vec2 pv = p.xz * (1.0 / 14000.0);
    vec3 w = tex3(tNoise, vec3(pv * 0.35 + 0.17, 0.61), 128.0).rgb - vec3(0.5, 0.35, 0.3); pv += w.xy * 0.9;
    float n1 = tex3(tNoise, vec3(pv * 0.5 + 0.2, 0.11), 128.0).r;
    vec2 pr = vec2(pv.x * 0.35 + pv.y * 0.25, pv.y * 1.9 - pv.x * 0.5);
    float n2 = tex3(tNoise, vec3(pr * 1.7 + 0.3, 0.53), 128.0).r;
    aStr = 0.66 + 0.12 * smoothstep(0.3, 0.7, n1 * 0.6 + n2 * 0.4); /* cirrostratus: presque uniforme (un motif plus marqué faisait « texture plaquée ») */
  }
  float a = mix(aCir, aStr, 1.0 - typ) * uHi.w;
  if (a <= 0.002) return;
  /* Perspective atmosphérique: même brume que les couches (épaisseur d'air réellement traversée), couleur du ciel à l'horizon
     dans cette direction: le voile se fond dans l'horizon sans fin nette (« fin très sèche comme les vieux 3D »). */
  float cs = dot(rd, uSun);
  vec3 L = uSunH * (0.03 + 0.25 * hg(cs, 0.7) + 0.04 * hg(cs, -0.3)) * 2.0 + (uAmbZ * 0.8 + uAmbH * 0.2) * 0.9;
  L = mix(L, hzCol(rd), hazeW(ro, uHi.z, t));
  col += T * L * a; T *= 1.0 - a;
}
/* Tous les nuages pour un rayon: radiance prémultipliée et transmittance */
vec4 clouds(vec3 ro, vec3 rd, float jit, float quality) {
  vec3 col = vec3(0.0); float T = 1.0, tFirst = -1.0;
  float ga = acos(clamp(dot(rd, uSun), -1.0, 1.0)), gR = uGapR * (0.7 + 0.6 * tex3(tNoise, vec3(rd.xz * 3.0, 0.5), 128.0).g);
  float gp = 1.0 - smoothstep(0.35 * gR, gR, ga);
  /* Trouée refermée (caméra à l'ombre d'un nuage): la couche basse est épaissie autour du soleil pour le cacher. Sous un ciel
     déjà couvert (plus de 80 %), le soleil est caché de toute façon et l'épaississement dessinait un gros rond gris foncé qui
     suivait le soleil (Stéphane, 12 octobre 2026, v633.206): il s'efface avec la couverture. Lumière de la scène inchangée
     (la capture d'ambiance se fait sans trouée, voir envNow). */
  float covK = 1.0 + gp * (uSunGap > 0.0 ? -0.75 : 0.9 * (1.0 - smoothstep(0.55, 0.8, uLay0.z))) * abs(uSunGap);
  marchShaft(ro, rd, jit, col, T);
  marchLayer(ro, rd, 0, jit, covK, quality, col, T, tFirst);
  marchLayer(ro, rd, 1, jit, 1.0, quality, col, T, tFirst);
  cirrus(ro, rd, col, T);
  return vec4(col, T); /* la brume est appliquée à chaque échantillon (hazeW): plus de fondu global à seuil */
}`;

// Passe des nuages à résolution réduite: rayons reconstruits depuis la caméra, résultat dans une texture lue par la sphère du ciel.
export const CLOUD_PASS_FRAG = CLOUD_GLSL + `
uniform mat4 uProjInv; uniform mat3 uV2W; uniform vec2 uRes, uSub; uniform float uJit, uQual; varying vec2 vUv;
void main() {
  /* uSub: décalage sous-pixel et uJit: décalage du tramage, différents à chaque passe de l'accumulation (vue posée) */
  vec4 pv = uProjInv * vec4((vUv + uSub) * 2.0 - 1.0, 1.0, 1.0); vec3 rd = normalize(uV2W * (pv.xyz / pv.w));
  float jit = fract(ignoise(gl_FragCoord.xy) + uJit);
  vec4 pt = uProjInv * vec4(0.0, 1.0, 1.0, 1.0); gPix = 2.0 * abs(pt.y / pt.z) / uRes.y; /* pixel de cette passe (réduite en mouvement) */
  gl_FragColor = clouds(uCamW, rd, jit, uQual);
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
// Types de nuages bas des METAR: forme (0 stratus, 0,5 stratocumulus, 1 cumulus) et épaisseur typique (m)
const LOW_TYPES = { ST: { typ: 0.05, thick: 300 }, SF: { typ: 0.3, thick: 300 }, SC: { typ: 0.45, thick: 400 }, CF: { typ: 0.85, thick: 300 }, CU: { typ: 0.9, thick: 900 }, TCU: { typ: 1, thick: 2500 }, CB: { typ: 1, thick: 6000 }, NS: { typ: 0.1, thick: 2500 } };
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
  let cb = Math.max(storm, smooth(5000, 9000, cDepth) * (precip >= 0.1 ? 1 : 0.6)) * smooth(0.2, 0.6, low);
  let tower = Math.max(smooth(1500, 5000, cDepth), cb);
  let base, top, typ;
  // Couches observées à l'aéroport voisin (premières heures, src/weather/nowcast.js): type et base réels de la couche basse
  const obsL = Array.isArray(r.obsLayers) ? r.obsLayers : null;
  const oLow = obsL ? obsL.filter((l) => LOW_TYPES[l.type] != null && l.base < 2600).sort((a, b) => b.octas - a.octas)[0] : null;
  if (conv) { base = cBase; top = cBase + cDepth; typ = 1; }
  else if (bLow) { base = bLow.base; top = bLow.top; typ = low >= 0.9 && base < 500 ? 0 : low >= 0.65 ? 0.4 : 0.7; }
  else if (prof && cape <= 300) {
    // Profil sec (aucun niveau assez humide pour porter un nuage) et air stable (15 octobre 2026): les « nuages bas » d'ICON
    // sont alors des nuages partiels diagnostiqués sous la maille, qui portent très peu d'eau (son propre rayonnement les
    // traverse); on dessinait 900 m de cumulus, sombres au soleil bas. Couche mince de stratocumulus.
    base = r.lcl != null ? r.lcl : 700; top = base + (low >= 0.65 ? 500 : 400); typ = low >= 0.95 ? 0.1 : low >= 0.65 ? 0.4 : low >= 0.3 ? 0.55 : 0.75;
  } else { base = r.lcl != null ? r.lcl : 700; top = base + (low >= 0.65 ? 500 : 900); typ = low >= 0.95 ? 0.1 : low >= 0.65 ? 0.4 : 0.8; }
  if (cape > 300 && !conv) typ = Math.max(typ, 0.8); // air instable: cumulus
  // Peu de nuages observés (moins de 30 %): toujours des bancs détachés (un champ stratiforme à faible couverture se diluait en
  // un voile granuleux sur tout le ciel)
  if (oLow) {
    const T = LOW_TYPES[oLow.type]; base = oLow.base; typ = low < 0.3 ? Math.max(T.typ, 0.75) : T.typ; if (!conv || T.typ < 0.8) top = base + T.thick;
    // cumulus bourgeonnants et cumulonimbus observés: la tour et l'enclume avec (sinon simple « cumulus »)
    if (oLow.type === 'TCU') tower = Math.max(tower, 0.6);
    if (oLow.type === 'CB') { cb = Math.max(cb, 0.6); tower = 1; }
  }
  if (rain || snow) { typ = Math.min(typ, 0.15); top = Math.max(top, base + 2500); } // nimbostratus: couche épaisse et sombre
  if (fogCode) { typ = 0; base = Math.min(base, 120); top = Math.max(top, 400); }
  base = Math.max(120, Math.min(2600, base)); top = Math.max(base + 250, Math.min(cb > 0.3 ? 12500 : 4500, top));
  if (cb > 0.3) top = Math.max(top, 6000 + 5000 * cb); // cumulonimbus: tour jusqu'à l'enclume
  // Nuages bas minces (15 octobre 2026): si la part de l'heure au soleil prévue par ICON (pSun, direct rapporté au ciel clair)
  // dépasse la part du ciel libre de nuages bas, ces nuages laissent passer le soleil: transmission du direct
  // t = (pSun - (1 - f)) / f. ICON diagnostique souvent des nuages partiels presque sans eau (schéma sous la maille): on les
  // dessine minces et clairs (densité réduite jusqu'à 0,2) au lieu d'une base sombre. pSunLow: couverture basse de l'heure
  // où pSun a été mesuré (la rangée voisine au coucher).
  let thin = 1;
  const oConv = oLow && (oLow.type === 'CU' || oLow.type === 'TCU' || oLow.type === 'CB');
  if (r.pSun != null && !conv && !oConv && cb < 0.3 && !rain && !snow && !fogCode) {
    // Peu de nuages (moins de 20 %): petits nuages pleins (une couche diluée sur tout le ciel faisait un voile laiteux et granuleux)
    const f = Math.max(0.05, (r.pSunLow ?? r.cloudLow ?? 0) / 100), t = (r.pSun - (1 - f)) / f;
    if (t > 0) thin = 1 - 0.55 * Math.min(1, t / 0.6) * smooth(0.2, 0.4, f);
  }
  const lowL = { cov: low, base, top, type: typ, tower, cb, thin, dark: Math.max(cb, rain * 0.6, smooth(0.3, 0.05, iv) * smooth(0.6, 0.95, low) * 0.5) };
  // ---- couche moyenne
  let mBase, mTop, mTyp, mCov = mid;
  if (bMid) { mBase = bMid.base; mTop = bMid.top; } else { mBase = 3200; mTop = 4300; }
  const oMid = obsL ? obsL.filter((l) => (l.type === 'AC' || l.type === 'AS' || l.type === 'ACC') && l.base >= 2000).sort((a, b) => b.octas - a.octas)[0] : null;
  if (oMid) { mBase = oMid.base; mTop = Math.max(mTop, mBase + (oMid.type === 'AS' ? 1500 : 600)); }
  const mThick = mTop - mBase;
  mTyp = 1 - smooth(0.55, 0.85, mid) * smooth(800, 2000, mThick + 600 * (1 - iv)); // altostratus si couvert et épais
  if (oMid) mTyp = oMid.type === 'AS' ? 0 : 1;
  if (rain) { mTyp = 0; mCov = Math.max(mCov, low); mBase = Math.min(mBase, top + 200); } // nimbostratus prolongé
  mBase = Math.max(lowL.top + 100, Math.min(6500, mBase)); mTop = Math.max(mBase + 300, Math.min(7500, mTop));
  // Traces (moins de 8 %): rien. À si faible couverture, le champ des altocumulus se défaisait en un voile granuleux sur tout le
  // ciel au lieu de quelques bancs (cas du 15 octobre: « traces d'altocumulus » à l'aéroport).
  const midL = { cov: mCov < 0.08 ? 0 : mCov, base: mBase, top: mTop, type: mTyp };
  // ---- nuages hauts
  const oHigh = obsL ? obsL.filter((l) => l.type === 'CI' || l.type === 'CS' || l.type === 'CC').sort((a, b) => b.octas - a.octas)[0] : null;
  const hAlt = oHigh ? oHigh.base + 500 : bHigh ? bHigh.center : 9000;
  const hTyp = 1 - smooth(0.5, 0.85, high); // cirrostratus quand la couverture est forte
  const hThick = 0.55 + 0.45 * (1 - iv); // voile plus dense quand le soleil direct est faible
  const highL = { cov: high, type: hTyp, alt: Math.max(7000, Math.min(12000, hAlt)), thick: hThick };
  // ---- mots de la légende
  const names = [];
  if (low >= 0.05) names.push(cb >= 0.5 ? 'cumulonimbus' : rain || snow ? 'nimbostratus' : fogCode ? 'stratus' : typ >= 0.75 ? (tower >= 0.5 ? 'cumulus bourgeonnants' : 'cumulus') : typ >= 0.3 ? 'stratocumulus' : 'stratus');
  if (midL.cov >= 0.05 && !(rain && low >= 0.05) && !(storm >= 0.9 && high >= 0.05)) names.push(mTyp >= 0.5 ? 'altocumulus' : 'altostratus');
  if (high >= 0.05) names.push(storm >= 0.9 ? 'enclume' : hTyp >= 0.5 ? 'cirrus' : 'cirrostratus');
  return { low: lowL, mid: midL, high: highL, names, shaft: Math.max(storm, wc >= 80 ? 0.5 : 0, precip >= 0.5 ? 0.4 : 0) * smooth(0.1, 2, precip) };
}
