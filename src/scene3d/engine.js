// Vue 3D de la fiche projet: les bâtiments dessinés dans le projet et les environs (voisins avec leur
// hauteur, rues, arbres, parcs, eau), sous le ciel et la lumière d'une heure donnée.
// Le ciel est une seule fonction (nuages bas en cumulus, nuages moyens en couche, nuages hauts en voile,
// soleil plus ou moins voilé) vue par la caméra ET capturée pour éclairer la scène, donc une journée
// grise éclaire gris et un ciel bleu donne des ombres bleutées. Passes d'image: recoins (occlusion
// ambiante), tonalité, lissage des bords.
// Chargé à la demande (import dynamique), three.js ne pèse rien tant que la 3D n'est pas ouverte.
import * as THREE from 'three';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';
import SunCalc from 'suncalc';
import { DIRS, centroid, labelShapes, localRings, shapesSignature, signedArea } from './footprint.js';

const clamp = (x) => Math.max(0, Math.min(1, x));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const mixHex = (a, b, t) => { t = clamp(t); const p = (h) => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)); const A = p(a), B = p(b); return '#' + A.map((v, i) => Math.round(v + (B[i] - v) * t).toString(16).padStart(2, '0')).join(''); };
const mv = (a, b, t) => a.map((v, i) => v + (b[i] - v) * clamp(t));
const hsh = (x, n, k) => { const s = Math.sin(x * 12.9898 + n * 78.233 + k * 37.719) * 43758.5453; return s - Math.floor(s); };
const rgb = (h) => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255);
const L = (h) => new THREE.Color(h); // interprété comme sRGB, converti en linéaire par three

const SKY_GLSL = `uniform float uCum,uMid,uHigh,uDirect,uWarm,uTw,uNight,uGlow;uniform vec3 uSun,uSunCol;varying vec3 vDir;
float hash(vec2 p){p=fract(p*vec2(123.34,456.21));p+=dot(p,p+45.32);return fract(p.x*p.y);}
float noise(vec2 p){vec2 i=floor(p),f=fract(p);vec2 u=f*f*(3.0-2.0*f);return mix(mix(hash(i),hash(i+vec2(1.0,0.0)),u.x),mix(hash(i+vec2(0.0,1.0)),hash(i+vec2(1.0,1.0)),u.x),u.y);}
float fbm(vec2 p,float lod){float v=0.0,a=0.5;mat2 m=mat2(1.6,1.2,-1.2,1.6);for(int i=0;i<6;i++){float k=i<2?1.0:clamp(lod*2.0-float(i-2)*0.45,0.0,1.0);v+=a*(k*noise(p)+(1.0-k)*0.5);p=m*p;a*=0.5;}return v;}
void main(){vec3 rd=normalize(vDir);vec3 sd=normalize(uSun);
float y=rd.y,cg=dot(rd,sd),t=pow(clamp(y,0.0,1.0),0.45),anti=max(-cg,0.0),veil=max(uMid,uHigh),clr=1.0-veil*0.85,lod=smoothstep(0.0,0.35,y);
vec3 zen=vec3(0.20,0.40,0.72),hor=vec3(0.62,0.76,0.90);vec3 col=mix(hor,zen,t);col=mix(col,vec3(0.80,0.86,0.92),(1.0-smoothstep(0.0,0.22,y))*0.6);
float wm=uWarm*(1.0-t)*(0.35+0.65*pow(max(cg,0.0),2.0));col=mix(col,vec3(1.0,0.62,0.34),wm);col=mix(col,vec3(0.32,0.36,0.56),uWarm*t*0.55);
col=mix(col,vec3(0.92,0.68,0.66),uWarm*clr*pow(anti,1.2)*smoothstep(0.0,0.06,y)*(1.0-smoothstep(0.06,0.22,y))*0.6);
col=mix(col,vec3(0.45,0.50,0.62),uWarm*clr*pow(anti,1.2)*(1.0-smoothstep(0.0,0.05,y))*0.5);
col+=uSunCol*(0.28*pow(max(cg,0.0),14.0)+0.10*pow(max(cg,0.0),3.0));
float thick=1.0-uDirect;float blur=0.004+0.02*thick*veil;float disc=smoothstep(cos(0.014+blur),cos(0.010),cg)*step(0.0,y+0.002);
float dC=0.0,aMidG=0.0,aHighG=0.0;vec3 cC=vec3(0.0);
if(y>0.0){vec2 p=rd.xz/(y+0.08)*0.55;float n=fbm(p,lod)*0.74+fbm(p*2.7+vec2(5.0,9.0),lod)*0.26;float th=0.5+(0.5-uCum)*0.62;float sw=0.09+0.14*(1.0-lod);
dC=smoothstep(th,th+sw,n)*smoothstep(0.0,0.10,y)*step(0.02,uCum);
float n2=fbm(p+normalize(sd.xz+vec2(1e-4))*0.12,lod);float lit=clamp(0.55+(n-n2)*5.0,0.0,1.0);
vec3 shd=vec3(0.50,0.54,0.60),li=mix(vec3(1.0),uSunCol,0.55);cC=mix(shd,li,lit)*(1.0-0.22*smoothstep(0.62,0.85,n));cC=mix(cC,hor,0.5*(1.0-smoothstep(0.0,0.25,y)));}
col+=vec3(1.0,0.98,0.92)*disc*2.0*(1.0-dC);col+=uSunCol*pow(max(cg,0.0),40.0)*dC*(1.0-dC)*1.6;col=mix(col,cC,dC);
if(uMid>0.01){float yy=max(y,0.0);vec2 pm=rd.xz/(yy+0.07)*0.42;float nm=fbm(pm*0.9+vec2(3.1,7.7),lod);float cov=smoothstep(0.62-0.5*uMid,0.72,nm+0.1*uMid);
float a=uMid*mix(0.45*cov,0.96,thick*thick);aMidG=a;vec3 mc=mix(vec3(0.80,0.82,0.85),vec3(0.58,0.60,0.64),thick);mc=mix(mc,vec3(0.86,0.70,0.58),uWarm*0.45);mc*=1.0-0.12*smoothstep(0.7,0.95,nm);
mc+=uSunCol*(0.35*pow(max(cg,0.0),8.0))*uDirect;col=mix(col,mc,a*(1.0-dC));}
if(uHigh>0.01){float yy=max(y,0.0);vec2 pv=rd.xz/(yy+0.05)*0.3;vec2 pr=vec2(pv.x*0.35+pv.y*0.25,pv.y*1.9-pv.x*0.5);float nv=fbm(pr*1.3,lod);
float a=uHigh*mix(0.18+0.55*smoothstep(0.35,0.75,nv),0.97,thick*thick);aHighG=a;
vec3 vc=mix(vec3(0.88,0.89,0.90),vec3(0.64,0.66,0.69),thick);vc=mix(vc,mix(vec3(0.62,0.62,0.66),vec3(0.95,0.72,0.55),0.6),uWarm*0.5);
vc+=uSunCol*(0.55*pow(max(cg,0.0),6.0)+0.25*pow(max(cg,0.0),60.0))*uDirect;
float halo=exp(-pow((acos(clamp(cg,-1.0,1.0))-0.384)/0.012,2.0))*smoothstep(0.25,0.5,uDirect)*(1.0-uDirect)*0.5;
col=mix(col,vc,a*(1.0-dC))+halo*uHigh*vec3(0.9,0.88,0.85)*0.35;}
col+=vec3(1.0,0.96,0.88)*disc*veil*uDirect*1.2*(1.0-dC);
if(y<0.0){col=mix(col,hor*vec3(0.52,0.55,0.46),smoothstep(0.0,-0.08,y));}
// Heure bleue puis nuit: dégradé bleu profond, lueur chaude seulement à l'horizon côté soleil, nuages en silhouette.
vec3 bh=mix(vec3(0.11,0.24,0.50),vec3(0.03,0.07,0.21),t);
vec2 sh=normalize(sd.xz+vec2(1e-4));float cgh=max(dot(normalize(rd.xz+vec2(1e-4)),sh),0.0);
bh*=0.72+0.55*cgh*(1.0-0.7*t);
bh=mix(bh,vec3(0.92,0.52,0.30),pow(cgh,3.0)*pow(1.0-clamp(y*4.0,0.0,1.0),2.0)*uGlow*0.6);
vec3 night=mix(vec3(0.045,0.07,0.16),vec3(0.016,0.03,0.09),t)*(0.8+0.3*cgh*(1.0-0.7*t));
vec3 tw=mix(bh,night,uNight)*(1.0-0.45*dC-0.25*aMidG-0.15*aHighG);
col=mix(col,tw,uTw);
col=pow(max(col,0.0),vec3(2.2));gl_FragColor=vec4(col,1.0);}`;
const SKY_VERT = `varying vec3 vDir;void main(){vec4 wp=modelMatrix*vec4(position,1.0);vDir=wp.xyz-cameraPosition;gl_Position=projectionMatrix*viewMatrix*wp;}`;
const QV = `varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.0,1.0);}`;
const AO_FRAG = `uniform sampler2D tDepth;uniform vec2 uRes;uniform mat4 uProj,uProjInv;uniform float uR,uBias,uInt;uniform vec3 uK[12];varying vec2 vUv;
vec3 vp(vec2 uv){float z=texture2D(tDepth,uv).x;vec4 c=uProjInv*vec4(uv*2.0-1.0,z*2.0-1.0,1.0);return c.xyz/c.w;}
float ign(vec2 p){return fract(52.9829189*fract(0.06711056*p.x+0.00583715*p.y));}
void main(){float z0=texture2D(tDepth,vUv).x;if(z0>=0.99999){gl_FragColor=vec4(1.0);return;}
vec3 P=vp(vUv);vec2 px=1.0/uRes;vec3 Px1=vp(vUv+vec2(px.x,0.0)),Px2=vp(vUv-vec2(px.x,0.0)),Py1=vp(vUv+vec2(0.0,px.y)),Py2=vp(vUv-vec2(0.0,px.y));
vec3 dx=length(Px1-P)<length(P-Px2)?Px1-P:P-Px2;vec3 dy=length(Py1-P)<length(P-Py2)?Py1-P:P-Py2;vec3 n=normalize(cross(dx,dy));
float a=ign(gl_FragCoord.xy)*6.2831853;vec3 rv=vec3(cos(a),sin(a),0.0);vec3 t=normalize(rv-n*dot(rv,n));vec3 b=cross(n,t);
float occ=0.0;for(int i=0;i<12;i++){vec3 s=P+(t*uK[i].x+b*uK[i].y+n*uK[i].z)*uR;vec4 o=uProj*vec4(s,1.0);vec2 suv=o.xy/o.w*0.5+0.5;if(suv.x<0.0||suv.x>1.0||suv.y<0.0||suv.y>1.0)continue;float sz=vp(suv).z;float rc=smoothstep(0.0,1.0,uR/abs(P.z-sz));occ+=(sz>=s.z+uBias?1.0:0.0)*rc;}
gl_FragColor=vec4(vec3(clamp(1.0-uInt*occ/12.0,0.0,1.0)),1.0);}`;
const BLUR_FRAG = `uniform sampler2D tAO,tDepth;uniform vec2 uDir,uNF;varying vec2 vUv;
float lin(float z){return (2.0*uNF.x*uNF.y)/(uNF.y+uNF.x-(2.0*z-1.0)*(uNF.y-uNF.x));}
void main(){float d0=lin(texture2D(tDepth,vUv).x);float s=0.0,w=0.0;for(int i=-3;i<=3;i++){vec2 uv=vUv+uDir*float(i);float d=lin(texture2D(tDepth,uv).x);float k=exp(-float(i*i)/5.0)*(abs(d-d0)<0.06*d0?1.0:0.0);s+=texture2D(tAO,uv).r*k;w+=k;}gl_FragColor=vec4(vec3(s/max(w,1e-4)),1.0);}`;
const BRIGHT_FRAG = `uniform sampler2D tCol;uniform float uTh;varying vec2 vUv;void main(){vec3 c=texture2D(tCol,vUv).rgb;float l=dot(c,vec3(0.2126,0.7152,0.0722));gl_FragColor=vec4(c*smoothstep(uTh,uTh+0.4,l),1.0);}`;
const GBLUR_FRAG = `uniform sampler2D tSrc;uniform vec2 uDir;varying vec2 vUv;void main(){float w[5];w[0]=0.227;w[1]=0.195;w[2]=0.122;w[3]=0.054;w[4]=0.016;vec3 s=texture2D(tSrc,vUv).rgb*w[0];for(int i=1;i<5;i++){s+=texture2D(tSrc,vUv+uDir*float(i)).rgb*w[i];s+=texture2D(tSrc,vUv-uDir*float(i)).rgb*w[i];}gl_FragColor=vec4(s,1.0);}`;
const COMP_FRAG = `uniform sampler2D tCol,tAO,tBloom;uniform float uExp,uAO,uBloom;varying vec2 vUv;
vec3 aces(vec3 x){x*=uExp/0.6;return clamp((x*(2.51*x+0.03))/(x*(2.43*x+0.59)+0.14),0.0,1.0);}
void main(){vec3 c=texture2D(tCol,vUv).rgb;float ao=texture2D(tAO,vUv).r;c*=mix(1.0,ao,uAO);c+=texture2D(tBloom,vUv).rgb*uBloom;c=aces(c);gl_FragColor=vec4(pow(c,vec3(1.0/2.2)),1.0);}`;

const PAL_RES = ['#8f4e3a', '#a0624c', '#7a4a3a', '#b07d5e', '#9c7a62', '#6e5a50', '#b8957a', '#d2c2a4', '#8c6b58'];
const ROOF = ['#57524d', '#5d5a55', '#514e4a', '#625e58'];
const TREE_PAL = ['#c4652b', '#d08a2e', '#b8973a', '#8e8f3e', '#6f8540', '#5b7a3a', '#a9552b', '#d9a441', '#7d8c3c'];
const GC = { park: '#66784d', pitch: '#5d8a47', play: '#b8a88e', grass: '#6f8552' };
// ---- géométrie 2D (x est, n nord); signedArea, centroid et les lettres des volumes viennent de footprint.js
function pointInRing(p, r) { let inside = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const a = r[i], b = r[j]; if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside; } return inside; }
function segsCross(a, b, c, d) { const o = (p, q, r) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])); return o(a, b, c) !== o(a, b, d) && o(c, d, a) !== o(c, d, b); }
function segHitsRing(a, b, r) { if (pointInRing(a, r) || pointInRing(b, r)) return true; for (let i = 0; i < r.length; i++) if (segsCross(a, b, r[i], r[(i + 1) % r.length])) return true; return false; }
function ringsOverlap(a, b) { if (pointInRing(centroid(a), b) || pointInRing(centroid(b), a)) return true; if (a.some(p => pointInRing(p, b)) || b.some(p => pointInRing(p, a))) return true; for (let i = 0; i < a.length; i++) for (let j = 0; j < b.length; j++) if (segsCross(a[i], a[(i + 1) % a.length], b[j], b[(j + 1) % b.length])) return true; return false; }

function facadeTex() {
  const c = document.createElement('canvas'); c.width = c.height = 256; const x = c.getContext('2d');
  x.fillStyle = '#ffffff'; x.fillRect(0, 0, 256, 256); x.fillStyle = '#d6d2cb'; x.fillRect(0, 0, 256, 9);
  const ww = 72, wh = 110, wx = 92, wy = 70; x.fillStyle = '#ebe8e2'; x.fillRect(wx - 7, wy - 7, ww + 14, wh + 14);
  const g = x.createLinearGradient(0, wy, 0, wy + wh); g.addColorStop(0, '#26323c'); g.addColorStop(1, '#56687a'); x.fillStyle = g; x.fillRect(wx, wy, ww, wh);
  x.fillStyle = 'rgba(255,255,255,0.07)'; x.fillRect(wx, wy, ww / 2, wh); x.fillStyle = '#ebe8e2'; x.fillRect(wx + ww / 2 - 2, wy, 4, wh); x.fillRect(wx, wy + wh / 2 - 2, ww, 4);
  const r = document.createElement('canvas'); r.width = r.height = 256; const y = r.getContext('2d'); y.fillStyle = 'rgb(0,238,0)'; y.fillRect(0, 0, 256, 256); y.fillStyle = 'rgb(0,60,0)'; y.fillRect(wx, wy, ww, wh);
  // Fenêtres allumées (émission chaude, dosée selon la hauteur du soleil)
  const e = document.createElement('canvas'); e.width = e.height = 256; const z = e.getContext('2d'); z.fillStyle = '#000'; z.fillRect(0, 0, 256, 256);
  z.save(); z.shadowColor = '#ffd9a0'; z.shadowBlur = 34; z.globalAlpha = 0.33; z.fillStyle = '#ffd9a0'; z.fillRect(wx, wy, ww, wh); z.restore();
  z.fillStyle = '#ffd9a0'; z.fillRect(wx, wy, ww, wh); z.fillStyle = '#5a4a30'; z.fillRect(wx + ww / 2 - 2, wy, 4, wh); z.fillRect(wx, wy + wh / 2 - 2, ww, 4);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  const rt = new THREE.CanvasTexture(r); rt.wrapS = rt.wrapT = THREE.RepeatWrapping;
  const et = new THREE.CanvasTexture(e); et.wrapS = et.wrapT = THREE.RepeatWrapping; et.colorSpace = THREE.SRGBColorSpace;
  return { map: t, rough: rt, emis: et };
}
// Façades détaillées d'après les images du client: une planche de textures par scène, un rectangle par mur à
// l'échelle (pixels par mètre), couleur du mur et du soubassement peintes (ce matériau n'a pas de couleur par
// sommet). Ouvertures: fenêtre (cadre, verre, meneaux), porte, vitrage (mur-rideau quadrillé), garage. Verre lisse
// dans la carte de rugosité (il reflète le ciel), une fenêtre sur deux allumée dans la carte d'émission.
function buildAtlas(dets) {
  if (!dets.length) return null;
  const W = 2048; let ppm = 14, rects, Hc;
  for (;;) {
    rects = []; let x = 0, y = 0, rowH = 0;
    const items = dets.map((d, i) => ({ i, w: Math.min(W, Math.ceil(d.e.len * ppm) + 2), h: Math.ceil(d.h * ppm) + 2 })).sort((a, b) => b.h - a.h);
    for (const it of items) { if (x + it.w > W) { x = 0; y += rowH; rowH = 0; } rects[it.i] = { x: x + 1, y: y + 1, w: it.w - 2, h: it.h - 2 }; x += it.w; rowH = Math.max(rowH, it.h); }
    Hc = y + rowH;
    if (Hc <= 2048 || ppm <= 3) break; ppm *= 0.8;
  }
  Hc = Math.min(2048, Math.max(2, Hc));
  const mk = () => { const c = document.createElement('canvas'); c.width = W; c.height = Hc; return [c, c.getContext('2d')]; };
  const [cc, g] = mk(), [cr, gr] = mk(), [ce, ge] = mk();
  g.fillStyle = '#000'; g.fillRect(0, 0, W, Hc); gr.fillStyle = 'rgb(0,238,0)'; gr.fillRect(0, 0, W, Hc); ge.fillStyle = '#000'; ge.fillRect(0, 0, W, Hc);
  dets.forEach((d, i) => {
    const r = rects[i], H = d.h, sx = r.w / d.e.len, sy = r.h / H;
    const px = (f) => r.x + f * r.w, py = (m) => r.y + (H - m) * sy; // m: mètres au-dessus du sol
    g.fillStyle = d.wall; g.fillRect(r.x, r.y, r.w, r.h);
    if (d.base) { g.fillStyle = d.base; g.fillRect(r.x, py(0.9), r.w, r.y + r.h - py(0.9)); }
    d.openings.forEach((o, k) => {
      const x0 = px(o.x0), x1 = px(o.x1), yT = py(Math.min(o.y1, H)), yB = py(Math.max(0, o.y0)), w = x1 - x0, h = yB - yT;
      if (w < 1 || h < 1) return;
      const fr = o.frame || (o.type === 'vitrage' ? '#cfd3d8' : '#e6e2da'), inset = Math.max(1, Math.min(0.08 * Math.min(w, h), 0.07 * sx));
      if (o.type === 'garage') {
        g.fillStyle = '#8d8f91'; g.fillRect(x0, yT, w, h); g.fillStyle = 'rgba(0,0,0,0.18)';
        for (let yy = yT + 0.5 * sy; yy < yB; yy += 0.5 * sy) g.fillRect(x0, yy, w, Math.max(1, 0.03 * sy));
        gr.fillStyle = 'rgb(0,200,0)'; gr.fillRect(x0, yT, w, h); return;
      }
      if (o.type === 'porte') {
        g.fillStyle = fr; g.fillRect(x0, yT, w, h); g.fillStyle = o.frame ? '#2e3338' : '#4a4642'; g.fillRect(x0 + inset, yT + inset, w - 2 * inset, h - inset);
        gr.fillStyle = 'rgb(0,170,0)'; gr.fillRect(x0, yT, w, h); return;
      }
      g.fillStyle = fr; g.fillRect(x0, yT, w, h);
      const gx = x0 + inset, gy = yT + inset, gw = w - 2 * inset, gh = h - 2 * inset; if (gw < 1 || gh < 1) return;
      const grd = g.createLinearGradient(0, gy, 0, gy + gh); grd.addColorStop(0, '#26323c'); grd.addColorStop(1, '#56687a'); g.fillStyle = grd; g.fillRect(gx, gy, gw, gh);
      g.fillStyle = 'rgba(255,255,255,0.07)'; g.fillRect(gx, gy, gw / 2, gh);
      gr.fillStyle = 'rgb(0,60,0)'; gr.fillRect(gx, gy, gw, gh);
      const mw = Math.max(1, 0.05 * sx); g.fillStyle = fr;
      if (o.type === 'vitrage') {
        const stepX = 1.5 * sx, stepY = 3.4 * sy;
        for (let xx = gx + stepX; xx < gx + gw - 1; xx += stepX) g.fillRect(xx - mw / 2, gy, mw, gh);
        for (let yy = gy + gh - stepY; yy > gy + 1; yy -= stepY) g.fillRect(gx, yy - mw / 2, gw, mw);
      } else if (gw > 0.9 * sx) { g.fillRect(gx + gw / 2 - mw / 2, gy, mw, gh); if (gh > 1.4 * sy) g.fillRect(gx, gy + gh / 2 - mw / 2, gw, mw); }
      if (hsh(d.seed * 100 + k, o.x0 * 1000, 3) < 0.5) {
        ge.save(); ge.shadowColor = '#ffd9a0'; ge.shadowBlur = Math.max(6, 0.6 * sx); ge.globalAlpha = 0.33; ge.fillStyle = '#ffd9a0'; ge.fillRect(gx, gy, gw, gh); ge.restore();
        ge.fillStyle = o.type === 'vitrage' ? '#9e8562' : '#ffd9a0'; ge.fillRect(gx, gy, gw, gh);
      }
    });
  });
  const tex = (c, srgb) => { const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t; };
  return { map: tex(cc, true), rough: tex(cr, false), emis: tex(ce, true), rects, W, H: Hc };
}
function groundTex() {
  const c = document.createElement('canvas'); c.width = c.height = 256; const x = c.getContext('2d'); const im = x.createImageData(256, 256), d = im.data;
  for (let i = 0; i < 65536; i++) { const px = i & 255, py = i >> 8; const n = 0.55 * hsh(px * 0.37, py * 0.41, 1) + 0.45 * hsh((px >> 3) * 1.3, (py >> 3) * 1.7, 2); const v = 150 + Math.round(n * 85); d[i * 4] = v; d[i * 4 + 1] = v; d[i * 4 + 2] = v; d[i * 4 + 3] = 255; }
  x.putImageData(im, 0, 0); const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(6600, 6600); t.anisotropy = 4; return t;
}
function lobes() {
  const parts = [[0, 0, 0, 1], [0.6, 0.2, 0.15, 0.62], [-0.55, 0.1, 0.35, 0.58], [0.1, -0.05, -0.6, 0.6], [-0.1, 0.62, -0.1, 0.55], [0.25, 0.45, 0.5, 0.5]]; const pos = [], uvs = [];
  parts.forEach(([x, y, z, r], k) => { const g = new THREE.IcosahedronGeometry(r, 2); const a = g.attributes.position.array, u = g.attributes.uv.array; for (let i = 0; i < a.length; i += 3) pos.push(a[i] + x, a[i + 1] + y, a[i + 2] + z); for (let i = 0; i < u.length; i += 2) uvs.push(u[i] * 2 + k * 0.37, u[i + 1] + k * 0.61); g.dispose(); });
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2)); g.computeVertexNormals(); return g;
}
// Masque du feuillage: le soleil passe entre les feuilles, l'ombre d'un arbre est parsemée, pas un bloc.
function leafTex() {
  const N = 256, c = document.createElement('canvas'); c.width = c.height = N; const x = c.getContext('2d'); const im = x.createImageData(N, N), d = im.data;
  const grid = (gx, gy, gs, k) => { const i0 = Math.floor(gx), j0 = Math.floor(gy), fx = gx - i0, fy = gy - j0, sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy); const v = (i, j) => hsh(((i % gs) + gs) % gs, ((j % gs) + gs) % gs, k); return (v(i0, j0) * (1 - sx) + v(i0 + 1, j0) * sx) * (1 - sy) + (v(i0, j0 + 1) * (1 - sx) + v(i0 + 1, j0 + 1) * sx) * sy; };
  for (let i = 0; i < N * N; i++) { const px = i & 255, py = i >> 8; const n = 0.3 * grid(px / 12, py / 12, 22, 11) + 0.4 * grid(px / 5, py / 5, 52, 12) + 0.3 * grid(px / 2.5, py / 2.5, 103, 13); const v = n > 0.5 ? 255 : 0; d[i * 4] = v; d[i * 4 + 1] = v; d[i * 4 + 2] = v; d[i * 4 + 3] = 255; }
  x.putImageData(im, 0, 0); const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
}
const shapeOf = (o, holes) => { const s = new THREE.Shape(o.map(p => new THREE.Vector2(p[0], p[1]))); (holes || []).forEach(h => s.holes.push(new THREE.Path(h.map(p => new THREE.Vector2(p[0], p[1]))))); return s; };

export function createScene3D(container, opts = {}) {
  const onInfo = opts.onInfo || (() => {});
  const DPR = Math.min(2, window.devicePixelRatio || 1);
  let W = Math.max(2, container.clientWidth), H = Math.max(2, container.clientHeight);
  const R = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
  R.setPixelRatio(DPR); R.setSize(W, H); R.shadowMap.enabled = true; R.shadowMap.type = THREE.VSMShadowMap;
  R.outputColorSpace = THREE.LinearSRGBColorSpace; R.toneMapping = THREE.NoToneMapping; R.autoClear = true;
  R.domElement.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;cursor:grab;touch-action:none';
  container.appendChild(R.domElement);

  // ---- ciel, environnement lumineux
  const skyMat = new THREE.ShaderMaterial({ side: THREE.BackSide, depthWrite: false, uniforms: { uCum: { value: 0 }, uMid: { value: 0 }, uHigh: { value: 0 }, uDirect: { value: 1 }, uWarm: { value: 0 }, uTw: { value: 0 }, uNight: { value: 0 }, uGlow: { value: 0 }, uSun: { value: new THREE.Vector3(0, 1, 0) }, uSunCol: { value: new THREE.Vector3(1, 1, 1) } }, vertexShader: SKY_VERT, fragmentShader: SKY_GLSL });
  const S = new THREE.Scene();
  const cam = new THREE.PerspectiveCamera(44, W / H, 1, 60000);
  const skyGeo = new THREE.SphereGeometry(5500, 40, 20);
  const sky = new THREE.Mesh(skyGeo, skyMat); sky.renderOrder = -1; S.add(sky);
  const skyScene = new THREE.Scene(); skyScene.add(new THREE.Mesh(skyGeo, skyMat));
  const cubeRT = new THREE.WebGLCubeRenderTarget(64, { type: THREE.HalfFloatType }); const cubeCam = new THREE.CubeCamera(1, 9000, cubeRT); skyScene.add(cubeCam);
  const pmrem = new THREE.PMREMGenerator(R); pmrem.compileCubemapShader(); let envRT = null;
  function updateEnv() { cubeCam.update(R, skyScene); const nrt = pmrem.fromCubemap(cubeRT.texture); if (envRT) envRT.dispose(); envRT = nrt; S.environment = nrt.texture; }
  const fog = new THREE.Fog(0xcccccc, 300, 1600); S.fog = fog;
  const gndTex = groundTex();
  const gnd = new THREE.Mesh(new THREE.PlaneGeometry(60000, 60000), new THREE.MeshStandardMaterial({ color: L('#5c6b42'), roughness: 1, envMapIntensity: 0.75, map: gndTex })); gnd.rotation.x = -Math.PI / 2; gnd.receiveShadow = true; S.add(gnd);
  const FT = facadeTex();
  const wallMat = new THREE.MeshStandardMaterial({ vertexColors: true, map: FT.map, roughnessMap: FT.rough, roughness: 1, metalness: 0, envMapIntensity: 0.75, emissive: 0xffffff, emissiveMap: FT.emis, emissiveIntensity: 0 });
  wallMat.onBeforeCompile = (sh) => {
    sh.vertexShader = 'attribute float aSeed;varying float vSeed;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvSeed=aSeed;');
    sh.fragmentShader = 'varying float vSeed;\n' + sh.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance*=step(0.5,fract(sin(dot(floor(vEmissiveMapUv)+vec2(vSeed,vSeed*0.37),vec2(12.9898,78.233)))*43758.5453));');
  };
  const roofMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0, envMapIntensity: 0.75 });
  const trunkMat = new THREE.MeshStandardMaterial({ color: L('#4a3b2e'), roughness: 0.95, envMapIntensity: 0.75 });
  const leafMask = leafTex();
  const crownMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, envMapIntensity: 0.75, alphaMap: leafMask, alphaTest: 0.5, side: THREE.DoubleSide });
  const waterMat = new THREE.MeshStandardMaterial({ color: L('#2a3b48'), roughness: 0.12, metalness: 0, envMapIntensity: 1, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const crownGeo = lobes(), trunkGeo = new THREE.CylinderGeometry(0.16, 0.26, 1, 6);
  const flat = (h, y) => new THREE.MeshStandardMaterial({ color: L(h), roughness: 0.95, side: THREE.DoubleSide, envMapIntensity: 0.75, polygonOffset: true, polygonOffsetFactor: -y, polygonOffsetUnits: -y });
  const flatMats = { road: flat('#4f5255', 3), rail: flat('#8a8378', 3), walk: flat('#b3afa3', 4), asphalt: flat('#4e5154', 2) };
  Object.keys(GC).forEach(k => { flatMats[k] = flat(GC[k], 1); });

  // ---- soleil et ombres de nuages
  const sunL = new THREE.DirectionalLight(0xffffff, 10); sunL.castShadow = true; sunL.shadow.mapSize.set(4096, 4096);
  const sc = sunL.shadow.camera; sc.left = -440; sc.right = 440; sc.top = 440; sc.bottom = -440; sc.near = 1; sc.far = 2000; sunL.shadow.bias = -0.0002; sunL.shadow.blurSamples = 12;
  const T0 = new THREE.Vector3(0, 0, 0); S.add(sunL); S.add(sunL.target);
  // Lumière neutre des nuages: sous un cumulus ou un voile, l'ombre est éclairée par un ciel en partie blanc, pas
  // seulement par le bleu; sans ce complément, les ombres de nuages tirent sur le bleu marine.
  const fill = new THREE.AmbientLight(0xffffff, 0.2); S.add(fill);
  // Heure bleue: le côté où le soleil s'est couché reste plus clair, comme une grande boîte à lumière.
  const twL = new THREE.DirectionalLight(0xffffff, 0); S.add(twL); S.add(twL.target);
  let seed = 11; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const pos = []; for (let i = 0; i < 60; i++) { const gx = (rnd() - 0.5) * 1800, gz = (rnd() - 0.5) * 1800; pos.push({ gx, gz, k: (Math.hypot(gx, gz) < 260 ? 1 : 0) + rnd() * 0.9 }); } pos.sort((a, b) => a.k - b.k);
  const cloudMat = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false }), sg = new THREE.SphereGeometry(1, 12, 8);
  const blobs = pos.map(p => { const g = new THREE.Group(); const n = 3 + Math.floor(rnd() * 3); for (let j = 0; j < n; j++) { const m = new THREE.Mesh(sg, cloudMat); const r = 60 + rnd() * 40; m.scale.set(r, r * 0.3, r); m.position.set((rnd() - 0.5) * 160, 0, (rnd() - 0.5) * 120); m.castShadow = true; g.add(m); } g.userData = p; S.add(g); return g; });

  // ---- passes d'image
  let PW = 0, PH = 0, sceneRT, aoRT, aoRT2, compRT, bloomA, bloomB, BW = 0, BH = 0;
  function alloc() {
    PW = Math.round(W * DPR); PH = Math.round(H * DPR); [sceneRT, aoRT, aoRT2, compRT, bloomA, bloomB].forEach(r => r && r.dispose());
    const dt = new THREE.DepthTexture(PW, PH); dt.type = THREE.UnsignedIntType;
    sceneRT = new THREE.WebGLRenderTarget(PW, PH, { type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthTexture: dt, depthBuffer: true, stencilBuffer: false });
    const o = { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false, stencilBuffer: false };
    aoRT = new THREE.WebGLRenderTarget(PW, PH, o); aoRT2 = new THREE.WebGLRenderTarget(PW, PH, o); compRT = new THREE.WebGLRenderTarget(PW, PH, o);
    BW = Math.max(2, Math.round(PW / 4)); BH = Math.max(2, Math.round(PH / 4)); const ob = { ...o, type: THREE.HalfFloatType }; bloomA = new THREE.WebGLRenderTarget(BW, BH, ob); bloomB = new THREE.WebGLRenderTarget(BW, BH, ob);
  }
  alloc();
  const qScene = new THREE.Scene(), qCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1), quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2)); qScene.add(quad);
  function pass(mat, rt) { quad.material = mat; R.setRenderTarget(rt); R.render(qScene, qCam); }
  const kern = []; for (let i = 0; i < 12; i++) { const v = new THREE.Vector3(hsh(i, 3, 1) * 2 - 1, hsh(i, 3, 2) * 2 - 1, 0.15 + 0.85 * hsh(i, 3, 3)).normalize(); const s = i / 12; v.multiplyScalar(0.12 + 0.88 * s * s); kern.push(v); }
  const aoMat = new THREE.ShaderMaterial({ uniforms: { tDepth: { value: null }, uRes: { value: new THREE.Vector2() }, uProj: { value: new THREE.Matrix4() }, uProjInv: { value: new THREE.Matrix4() }, uR: { value: 2.4 }, uBias: { value: 0.04 }, uInt: { value: 1.6 }, uK: { value: kern } }, vertexShader: QV, fragmentShader: AO_FRAG });
  const blurMat = new THREE.ShaderMaterial({ uniforms: { tAO: { value: null }, tDepth: { value: null }, uDir: { value: new THREE.Vector2() }, uNF: { value: new THREE.Vector2(1, 60000) } }, vertexShader: QV, fragmentShader: BLUR_FRAG });
  const compMat = new THREE.ShaderMaterial({ uniforms: { tCol: { value: null }, tAO: { value: null }, tBloom: { value: null }, uExp: { value: 1 }, uAO: { value: 0.9 }, uBloom: { value: 0 } }, vertexShader: QV, fragmentShader: COMP_FRAG });
  const brightMat = new THREE.ShaderMaterial({ uniforms: { tCol: { value: null }, uTh: { value: 0.3 } }, vertexShader: QV, fragmentShader: BRIGHT_FRAG });
  const gblurMat = new THREE.ShaderMaterial({ uniforms: { tSrc: { value: null }, uDir: { value: new THREE.Vector2() } }, vertexShader: QV, fragmentShader: GBLUR_FRAG });
  const fxMat = new THREE.ShaderMaterial({ uniforms: THREE.UniformsUtils.clone(FXAAShader.uniforms), vertexShader: FXAAShader.vertexShader, fragmentShader: FXAAShader.fragmentShader });

  // ---- état: lieu, heure, météo, caméra
  let lat = 46.8, lng = -71.2, origin = null, projLocal = [], orientation = [], style = null, data = null, dateMs = Date.now();
  const tg = { cum: 0, mid: 0, high: 0, iv: 1 }, cur = { ...tg };
  let az = Math.PI * 1.2, camH = 1.7, Rr = 75; const ct = new THREE.Vector3(0, 10, 0);
  let statics = [], treesI = null, dirty = true, running = true, envKey = '', envAt = 0, drag = null, lastInfo = '', weatherRow = null;
  let detMat = null, detTex = null, stale = false, projInfo = []; // façades détaillées et statut des côtés du projet (légende)
  function disposeDet() { if (detTex) { detTex.map.dispose(); detTex.rough.dispose(); detTex.emis.dispose(); detTex = null; } if (detMat) { detMat.dispose(); detMat = null; } }

  function clearStatics() { statics.forEach(m => { S.remove(m); m.geometry && m.geometry.dispose(); }); statics = []; treesI = null; }
  function addFlat(shapes, mat, y) { if (!shapes.length) return; const g = new THREE.ShapeGeometry(shapes); g.rotateX(-Math.PI / 2); const m = new THREE.Mesh(g, mat); m.position.y = y; m.receiveShadow = true; S.add(m); statics.push(m); }
  function ribbons(list, y, mat) {
    const v = []; const T = (a, b, c) => v.push(a[0], 0, -a[1], b[0], 0, -b[1], c[0], 0, -c[1]);
    list.forEach(r => { const w = r.w / 2, P = r.p; for (let i = 0; i < P.length - 1; i++) { const [x1, n1] = P[i], [x2, n2] = P[i + 1]; const dx = x2 - x1, dn = n2 - n1, l = Math.hypot(dx, dn) || 1, ox = -dn / l * w, on = dx / l * w; const A = [x1 + ox, n1 + on], B = [x1 - ox, n1 - on], C = [x2 - ox, n2 - on], D = [x2 + ox, n2 + on]; T(A, B, C); T(A, C, D); }
      P.forEach(([x, n]) => { for (let k = 0; k < 10; k++) { const a1 = k / 10 * Math.PI * 2, a2 = (k + 1) / 10 * Math.PI * 2; T([x, n], [x + Math.cos(a1) * w, n + Math.sin(a1) * w], [x + Math.cos(a2) * w, n + Math.sin(a2) * w]); } }); });
    if (!v.length) return; const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3)); g.computeVertexNormals(); const m = new THREE.Mesh(g, mat); m.position.y = y; m.receiveShadow = true; S.add(m); statics.push(m);
  }
  function blocks(list) {
    const P = [], N = [], U = [], C = [], SD = [], RP = [], RN = [], RC = [];
    list.forEach(b => {
      // Contour en sens trigonométrique (vu du ciel): l'extérieur est à droite du sens de parcours, ce qui vaut
      // aussi pour les formes concaves (en L, en U), contrairement à un test sur le centre de la forme.
      const pts = signedArea(b.p) < 0 ? b.p.slice().reverse() : b.p, h = b.h, lv = Math.max(1, b.fl), col = b.col, rc = b.rc; let u0 = 0; const seed0 = Math.floor(hsh(pts[0][0], pts[0][1], 9) * 900);
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i], c = pts[(i + 1) % pts.length]; const ax = a[0], azz = -a[1], bx = c[0], bz = -c[1]; const ex = bx - ax, ez = bz - azz, len = Math.hypot(ex, ez); if (len < 0.05) continue;
        if (b.skip && b.skip.has(i)) continue; // ce mur est une façade détaillée (detailedWalls)
        const nx = -ez / len, nz = ex / len;
        const u1 = u0 + len / (b.bay || 4.8); const q = [[ax, 0, azz, u0, 0], [bx, 0, bz, u1, 0], [bx, h, bz, u1, lv], [ax, h, azz, u0, lv]];
        [[0, 1, 2], [0, 2, 3]].forEach(t => t.forEach(k => { const v = q[k]; P.push(v[0], v[1], v[2]); N.push(nx, 0, nz); U.push(v[3], v[4]); C.push(col.r, col.g, col.b); SD.push(seed0 + i); })); u0 = u1;
      }
      const rg = new THREE.ShapeGeometry(shapeOf(pts)); rg.rotateX(-Math.PI / 2); const ra = rg.toNonIndexed().attributes.position.array; for (let i = 0; i < ra.length; i += 3) { RP.push(ra[i], h, ra[i + 2]); RN.push(0, 1, 0); RC.push(rc.r, rc.g, rc.b); } rg.dispose();
    });
    if (!P.length) return;
    const wg = new THREE.BufferGeometry(); wg.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); wg.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3)); wg.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2)); wg.setAttribute('color', new THREE.Float32BufferAttribute(C, 3)); wg.setAttribute('aSeed', new THREE.Float32BufferAttribute(SD, 1));
    const wm = new THREE.Mesh(wg, wallMat); wm.castShadow = true; wm.receiveShadow = true; S.add(wm); statics.push(wm);
    const rgm = new THREE.BufferGeometry(); rgm.setAttribute('position', new THREE.Float32BufferAttribute(RP, 3)); rgm.setAttribute('normal', new THREE.Float32BufferAttribute(RN, 3)); rgm.setAttribute('color', new THREE.Float32BufferAttribute(RC, 3));
    const rm = new THREE.Mesh(rgm, roofMat); rm.castShadow = true; rm.receiveShadow = true; S.add(rm); statics.push(rm);
  }
  // Soubassement: bandeau de 0,9 m au pied des bâtiments du projet, dans la couleur du bas des murs.
  function band(list, col, hh, skip) {
    const P = [], N = [], C = [];
    list.forEach(pts => { const r = signedArea(pts) < 0 ? pts.slice().reverse() : pts;
      for (let i = 0; i < r.length; i++) { const a = r[i], c = r[(i + 1) % r.length]; const ax = a[0], az = -a[1], bx = c[0], bz = -c[1]; const ex = bx - ax, ez = bz - az, len = Math.hypot(ex, ez); if (len < 0.05) continue;
        if (skip && skip.has(i)) continue;
        const nx = -ez / len, nz = ex / len, o = 0.06; const q = [[ax + nx * o, 0, az + nz * o], [bx + nx * o, 0, bz + nz * o], [bx + nx * o, hh, bz + nz * o], [ax + nx * o, hh, az + nz * o]];
        [[0, 1, 2], [0, 2, 3]].forEach(t => t.forEach(k => { const v = q[k]; P.push(v[0], v[1], v[2]); N.push(nx, 0, nz); C.push(col.r, col.g, col.b); })); } });
    if (!P.length) return; const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
    const m = new THREE.Mesh(g, roofMat); m.receiveShadow = true; S.add(m); statics.push(m);
  }
  // Murs du projet dont la façade est connue d'après les images: un rectangle de la planche par mur, à l'échelle.
  function detailedWalls(dets) {
    disposeDet();
    if (!dets.length) return;
    const A = buildAtlas(dets); if (!A) return; detTex = A;
    detMat = new THREE.MeshStandardMaterial({ map: A.map, roughnessMap: A.rough, roughness: 1, metalness: 0, envMapIntensity: 0.75, emissive: 0xffffff, emissiveMap: A.emis, emissiveIntensity: wallMat.emissiveIntensity });
    const P = [], N = [], U = [];
    dets.forEach((d, i) => {
      const r = A.rects[i], e = d.e, ax = e.a[0], az = -e.a[1], bx = e.b[0], bz = -e.b[1], h = d.h, nx = e.nrm[0], nz = -e.nrm[1];
      const u0 = r.x / A.W, u1 = (r.x + r.w) / A.W, v0 = 1 - (r.y + r.h) / A.H, v1 = 1 - r.y / A.H;
      const q = [[ax, 0, az, u0, v0], [bx, 0, bz, u1, v0], [bx, h, bz, u1, v1], [ax, h, az, u0, v1]];
      [[0, 1, 2], [0, 2, 3]].forEach(t => t.forEach(k => { const v = q[k]; P.push(v[0], v[1], v[2]); N.push(nx, 0, nz); U.push(v[3], v[4]); }));
    });
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
    const m = new THREE.Mesh(g, detMat); m.castShadow = true; m.receiveShadow = true; S.add(m); statics.push(m);
  }
  function trees(list) {
    if (!list.length) return;
    const NT = list.length, trunkI = new THREE.InstancedMesh(trunkGeo, trunkMat, NT), crownI = new THREE.InstancedMesh(crownGeo, crownMat, NT), o3 = new THREE.Object3D();
    list.forEach(([x, n], i) => {
      const h = 7 + 6 * hsh(x, n, 1), cr = 2.1 + 1.5 * hsh(x, n, 2), th = Math.max(2.5, h - cr * 1.4);
      o3.position.set(x, th / 2, -n); o3.scale.set(1, th, 1); o3.rotation.set(0, 0, 0); o3.updateMatrix(); trunkI.setMatrixAt(i, o3.matrix);
      o3.position.set(x, th + cr * 0.85, -n); o3.scale.set(cr, cr * 1.05, cr); o3.rotation.set(0, hsh(x, n, 3) * 6.28, 0); o3.updateMatrix(); crownI.setMatrixAt(i, o3.matrix); crownI.setColorAt(i, L(TREE_PAL[Math.floor(hsh(x, n, 4) * TREE_PAL.length)]));
    });
    [trunkI, crownI].forEach(m => { m.castShadow = true; m.receiveShadow = true; S.add(m); statics.push(m); }); treesI = [trunkI, crownI];
  }

  // Point de vue: à hauteur d'oeil, côté soleil du créneau (AM: sud-est, PM: sud-ouest), dans l'espace libre,
  // avec vue dégagée sur le bâtiment principal.
  function pickView(target, others, roads, treePts) {
    if (!target.length) return;
    const tc = centroid(target); let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
    target.forEach(p => { minx = Math.min(minx, p[0]); miny = Math.min(miny, p[1]); maxx = Math.max(maxx, p[0]); maxy = Math.max(maxy, p[1]); });
    const corners = [[minx, miny], [maxx, maxy], [minx, maxy], [maxx, miny]];
    const pref = orientation.includes('PM') && !orientation.includes('AM') ? 215 : orientation.includes('AM') && !orientation.includes('PM') ? 140 : 180;
    const size = Math.max(maxx - minx, maxy - miny); const radPref = Math.max(40, Math.min(110, size * 1.0 + 25));
    let best = null;
    const near = others.filter(r => Math.hypot(centroid(r)[0] - tc[0], centroid(r)[1] - tc[1]) < 260);
    for (let bea = pref - 80; bea <= pref + 80; bea += 5) {
      for (let rad = Math.max(30, radPref - 40); rad <= radPref + 50; rad += 6) {
        const px = tc[0] + Math.sin(bea * Math.PI / 180) * rad, py = tc[1] + Math.cos(bea * Math.PI / 180) * rad, p = [px, py];
        if (near.some(r => pointInRing(p, r)) || pointInRing(p, target)) continue;
        if (near.some(r => segHitsRing(p, tc, r))) continue;
        // Pas dans un arbre ni le nez dans une couronne: on s'éloigne des troncs proches.
        let treePen = 0; for (const t of treePts) { const dt = Math.hypot(t[0] - px, t[1] - py); if (dt < 5) { treePen = 1e9; break; } if (dt < 12) treePen += (12 - dt) * 3; }
        if (treePen > 1e8) continue;
        const blocked = corners.filter(c => near.some(r => segHitsRing(p, c, r))).length;
        let roadD = Infinity; roads.forEach(r => { if (r.k !== 0) return; const P = r.p; for (let i = 0; i < P.length - 1; i++) { const a = P[i], b = P[i + 1]; const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy || 1; let t = ((px - a[0]) * dx + (py - a[1]) * dy) / l2; t = Math.max(0, Math.min(1, t)); roadD = Math.min(roadD, Math.hypot(px - a[0] - t * dx, py - a[1] - t * dy)); } });
        const score = -Math.abs(bea - pref) * 0.6 - Math.abs(rad - radPref) * 0.8 - blocked * 25 + (roadD < 7 ? 8 : 0) - treePen;
        if (!best || score > best.s) best = { s: score, px, py };
      }
    }
    if (!best) { best = { px: tc[0] + Math.sin(pref * Math.PI / 180) * radPref, py: tc[1] + Math.cos(pref * Math.PI / 180) * radPref }; }
    ct.set(tc[0], Math.min(14, 4 + size * 0.1), -tc[1]); T0.set(tc[0], 0, -tc[1]); sunL.target.position.copy(T0);
    az = Math.atan2(best.px - tc[0], best.py - tc[1]); Rr = Math.hypot(best.px - tc[0], best.py - tc[1]); camH = 1.7;
  }

  function rebuild() {
    clearStatics();
    if (!origin) return;
    // Formes dessinées, lettrées comme dans l'analyse des images (footprint.js): A = la plus grande au sol.
    const shapesAll = labelShapes(localRings(projLocal, origin));
    const drawn = shapesAll.map(sh => sh.ring);
    // Style tiré des images du client. Les volumes et façades analysés ne valent que pour les formes analysées
    // (signature) et si l'orientation a pu être établie; sinon on garde les couleurs et un rythme générique.
    const st = style || {}, sig = shapesSignature(projLocal);
    const oriOk = !st.orientation || st.orientation.confidence !== 'faible';
    stale = !!style && !!(st.shapes && st.shapes.sig && st.shapes.sig !== sig);
    const stOk = !!style && oriOk && !stale;
    const volOf = (l) => (stOk && Array.isArray(st.volumes)) ? st.volumes.find(v => v.shape === l && v.confidence !== 'faible') || null : null;
    const facOf = (id) => (stOk && Array.isArray(st.facades)) ? st.facades.find(f => f.edge === id) || null : null;
    const legacy = stOk && !Array.isArray(st.volumes); // analyse d'avant les volumes: une hauteur et un nombre d'étages globaux
    const wallC0 = st.wallColor || '#7a3f33', roofC0 = st.roofColor || '#5a5650', baseC0 = st.baseColor || null;
    const bay = st.windowStyle === 'few' ? 9 : st.windowStyle === 'large' ? 4.5 : 6;
    const list = [], dets = [], bands = []; projInfo = [];
    shapesAll.forEach(sh => {
      const d = sh.ring, v = volOf(sh.label);
      const hits = data ? data.bld.filter(([p, , , k]) => k !== 2 && ringsOverlap(d.p, p)) : [];
      const measured = hits.length ? Math.max(...hits.map(x => x[1])) : null;
      // Hauteur, par ordre de confiance: cote lue sur les plans, estimation d'après les images (étages comptés sur
      // les rendus), puis, sans analyse: valeur réglée dans le projet, mesure Overture (parfois fausse: 3 m pour une
      // école de deux étages), 9 m par défaut. La légende dit toujours la source.
      let h, src;
      if (v && v.heightSource === 'cote' && v.heightM > 0) { h = v.heightM; src = 'lue sur les plans'; }
      else if (v && v.heightM > 0) { h = v.heightM; src = 'estimée d’après les images'; }
      else if (!v && legacy && st.heightM > 0) { h = st.heightM; src = 'estimée d’après les images'; }
      else if (!d.def) { h = d.h; src = 'réglée dans le projet'; }
      else if (measured != null) { h = measured; src = 'mesurée (Overture)'; }
      else { h = 9; src = 'par défaut'; }
      h = Math.max(3, h);
      const storeys = v && v.storeys ? v.storeys : legacy && st.storeys ? st.storeys : 0;
      const fl = storeys ? Math.max(1, Math.min(storeys, Math.round(h / 2.6))) : h < 6 ? 1 : h <= 16 ? 2 : Math.round(h / 4.5);
      const wallHex = (v && v.wallColor) || wallC0, roofHex = (v && v.roofColor) || roofC0, baseHex0 = (v && v.baseColor) || baseC0;
      const baseHex = baseHex0 && baseHex0.toLowerCase() !== wallHex.toLowerCase() ? baseHex0 : null;
      const skip = new Set();
      sh.edges.forEach(e => {
        const f = facOf(e.id), ok = !!(f && f.confidence !== 'faible' && f.openings && f.openings.length);
        const status = ok ? (f.confidence === 'haute' ? 'images' : 'probable') : stale ? 'stale' : stOk && f ? 'unseen' : style ? 'generic' : 'none';
        projInfo.push({ id: e.id, dir: e.dir, len: e.len, mid: e.mid, nrm: e.nrm, label: sh.label, h, src, status });
        if (ok) { skip.add(e.j); dets.push({ e, h, wall: wallHex, base: baseHex, openings: f.openings, seed: hsh(e.a[0], e.a[1], 7) }); }
      });
      list.push({ p: d.p, h, fl, bay, col: L(wallHex), rc: L(roofHex), skip });
      if (baseHex) bands.push({ p: d.p, col: L(baseHex), skip });
    });
    bands.forEach(b => band([b.p], b.col, 0.9, b.skip));
    const others = [];
    if (data) {
      data.bld.forEach(([p, h, fl, k]) => {
        // Un voisin recouvert par un bâtiment dessiné disparaît: c'est le même édifice.
        const c = centroid(p);
        if (drawn.some(d => ringsOverlap(d.p, p))) return;
        others.push(p);
        const q = p[0], r = hsh(q[0], q[1], 5); const hh = k === 0 ? Math.max(h, 6.2) : h;
        list.push({ p, h: hh, fl: k === 0 ? Math.max(fl, Math.round(hh / 3.1)) : fl, col: L(k === 2 ? '#9a9a94' : k === 1 ? '#cfc7b8' : PAL_RES[Math.floor(r * PAL_RES.length)]), rc: L(ROOF[Math.floor(hsh(q[0], q[1], 6) * ROOF.length)]) });
      });
      Object.keys(GC).forEach(k => addFlat(data.green.filter(p => p.k === k).map(p => shapeOf(p.p)), flatMats[k], 0.03));
      addFlat(data.asphalt.map(p => shapeOf(p)), flatMats.asphalt, 0.05);
      addFlat(data.water.map(w => shapeOf(w.o, w.h)), waterMat, 0.05);
      ribbons(data.roads.filter(r => r.k === 0), 0.08, flatMats.road); ribbons(data.roads.filter(r => r.k === 2), 0.1, flatMats.rail); ribbons(data.roads.filter(r => r.k === 1), 0.12, flatMats.walk);
      trees(data.trees);
    }
    blocks(list);
    detailedWalls(dets);
    pickView(drawn.length ? drawn[0].p : [], others, data ? data.roads : [], data ? data.trees : []);
    dirty = true;
  }

  // ---- interaction: glisser pour tourner, molette pour s'approcher
  const el = R.domElement;
  el.addEventListener('pointerdown', e => { drag = { x: e.clientX, y: e.clientY, id: e.pointerId }; el.setPointerCapture(e.pointerId); el.style.cursor = 'grabbing'; });
  el.addEventListener('pointermove', e => { if (!drag || e.pointerId !== drag.id) return; az += (e.clientX - drag.x) * 0.008; camH = Math.max(1.2, Math.min(320, camH + (e.clientY - drag.y) * 0.6)); drag = { x: e.clientX, y: e.clientY, id: drag.id }; dirty = true; });
  const endDrag = e => { if (drag && (!e || e.pointerId === drag.id)) { drag = null; el.style.cursor = 'grab'; } };
  el.addEventListener('pointerup', endDrag); el.addEventListener('pointercancel', endDrag);
  el.addEventListener('wheel', e => { e.preventDefault(); Rr = Math.max(20, Math.min(400, Rr * Math.exp(e.deltaY * 0.0015))); dirty = true; }, { passive: false });

  const vF = new THREE.Vector3(); let last = performance.now(), raf = 0;
  function frame(now) {
    if (!running) return; raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    const a = 1 - Math.exp(-dt * 3.5); let moving = false;
    ['cum', 'mid', 'high', 'iv'].forEach(k => { const d = tg[k] - cur[k]; if (Math.abs(d) > 0.0005) { cur[k] += d * a; moving = true; } else cur[k] = tg[k]; });
    if (!dirty && !moving && now - envAt > 400) return; // rien à redessiner: on laisse le processeur tranquille
    dirty = false;
    const cum = cur.cum, mid = cur.mid, high = cur.high, iv = cur.iv, veil = Math.max(mid, high);
    const sp = SunCalc.getPosition(new Date(dateMs), lat, lng); const bearing = sp.azimuth + Math.PI; // azimut depuis le nord, sens horaire
    const realDeg = sp.altitude * 180 / Math.PI, el = Math.max(sp.altitude, 0.6 * Math.PI / 180), eld = el * 180 / Math.PI;
    const d = new THREE.Vector3(Math.sin(bearing) * Math.cos(el), Math.sin(el), -Math.cos(bearing) * Math.cos(el));
    const night = realDeg < -0.8, twi = smooth(2, -5, realDeg), nightF = smooth(-7, -15, realDeg), glow = 1 - smooth(-5, -10, realDeg);
    const fe = Math.exp(-0.05 / Math.max(Math.sin(el), 0.01)), Idir = night ? 0 : 10 * fe * iv; sunL.intensity = Idir;
    const warm = clamp(1 - (eld - 2) / 28), sc0 = mixHex(mixHex('#fff1dc', '#ff9a52', Math.pow(warm, 1.5)), '#eeebe4', (1 - iv) * 0.6); sunL.color.copy(L(sc0));
    const dist = 300 + 150 / Math.max(d.y, 0.08); sunL.position.copy(T0).addScaledVector(d, dist); sc.far = dist + 700; sc.updateProjectionMatrix(); sunL.shadow.radius = 1 + 12 * (1 - iv) + 1.5 * cum;
    fill.intensity = (0.2 + 1.1 * Math.max(cum, veil) * Math.min(1, Math.sin(el) / 0.3)) * (1 - 0.5 * twi);
    const ambB = (0.3 + 0.55 * Math.min(1, Math.sin(el) / 0.5)) * (1 + 0.3 * Math.max(cum, veil)); const tot = (Idir / Math.PI * 0.5 + ambB) / 2.2;
    compMat.uniforms.uExp.value = Math.max(0.5, Math.min(1.15 - 0.4 * twi, 0.64 * Math.pow(1 / Math.max(0.05, Math.min(1, tot)), 0.3)));
    const nb = Math.min(60, Math.round(cum * 110)), hh = 150 / Math.max(d.y, 0.08); blobs.forEach((g, i) => { g.visible = i < nb; const u = g.userData; g.position.set(T0.x + u.gx + d.x * hh, 150, T0.z + u.gz + d.z * hh); });
    cam.position.set(ct.x + Math.sin(az) * Rr, camH, ct.z - Math.cos(az) * Rr); cam.lookAt(ct); cam.updateMatrixWorld(); cam.getWorldDirection(vF); sky.position.copy(cam.position);
    const U = skyMat.uniforms, dk = 0.5 + 0.5 * clamp((realDeg + 1) / 14), uW = clamp(1 - (realDeg - 1) / 22);
    U.uCum.value = cum; U.uMid.value = mid; U.uHigh.value = high; U.uDirect.value = iv; U.uWarm.value = uW; U.uTw.value = twi; U.uNight.value = nightF; U.uGlow.value = glow;
    wallMat.emissiveIntensity = 0.55 * smooth(1, -4, realDeg); if (detMat) detMat.emissiveIntensity = wallMat.emissiveIntensity;
    const soft = twi * (1 - nightF); twL.intensity = 1.8 * soft; twL.color.copy(L(mixHex('#9fb0e0', '#e8bc92', glow * 0.5)));
    twL.target.position.copy(T0); twL.position.copy(T0).add(new THREE.Vector3(Math.sin(bearing) * Math.cos(0.17), Math.sin(0.17), -Math.cos(bearing) * Math.cos(0.17)).multiplyScalar(400));
    const sDir = new THREE.Vector3(Math.sin(bearing) * Math.cos(sp.altitude), Math.sin(sp.altitude), -Math.cos(bearing) * Math.cos(sp.altitude)); U.uSun.value.copy(sDir); const sc1 = rgb(sc0); U.uSunCol.value.set(sc1[0], sc1[1], sc1[2]);
    const key = [cum, mid, high, iv, uW, dk, sDir.x, sDir.y].map(v => v.toFixed(2)).join(','); if (key !== envKey && now - envAt > 120) { envKey = key; envAt = now; updateEnv(); }
    const cgv = Math.max(0, new THREE.Vector3(vF.x, 0, vF.z).normalize().dot(sDir)), thick = 1 - iv;
    let hc = [0.728, 0.82, 0.912]; hc = mv(hc, [1, 0.62, 0.34], uW * (0.35 + 0.65 * cgv * cgv)); let vc = mv([0.88, 0.89, 0.90], [0.64, 0.66, 0.69], thick); vc = mv(vc, mv([0.62, 0.62, 0.66], [0.95, 0.72, 0.55], 0.6), uW * 0.5);
    hc = mv(hc, vc, veil * (0.45 + 0.52 * thick * thick)); hc = mv(hc, [0.62, 0.65, 0.69], cum * 0.5); hc = mv(hc, [0.11, 0.24, 0.50].map(v => v * (0.72 + 0.55 * cgv)), twi); hc = mv(hc, [0.045, 0.07, 0.16].map(v => v * (0.8 + 0.3 * cgv)), nightF); fog.color.setRGB(hc[0], hc[1], hc[2], THREE.SRGBColorSpace); fog.near = 250 + camH * 4; fog.far = 1500 + camH * 14;
    R.setRenderTarget(sceneRT); R.render(S, cam);
    aoMat.uniforms.tDepth.value = sceneRT.depthTexture; aoMat.uniforms.uRes.value.set(PW, PH); aoMat.uniforms.uProj.value.copy(cam.projectionMatrix); aoMat.uniforms.uProjInv.value.copy(cam.projectionMatrixInverse); pass(aoMat, aoRT);
    blurMat.uniforms.tDepth.value = sceneRT.depthTexture; blurMat.uniforms.tAO.value = aoRT.texture; blurMat.uniforms.uDir.value.set(1 / PW, 0); pass(blurMat, aoRT2); blurMat.uniforms.tAO.value = aoRT2.texture; blurMat.uniforms.uDir.value.set(0, 1 / PH); pass(blurMat, aoRT);
    const glowK = wallMat.emissiveIntensity > 0.01 ? 0.5 * smooth(1, -4, realDeg) : 0; compMat.uniforms.uBloom.value = glowK;
    if (glowK > 0) { brightMat.uniforms.tCol.value = sceneRT.texture; pass(brightMat, bloomA); gblurMat.uniforms.tSrc.value = bloomA.texture; gblurMat.uniforms.uDir.value.set(1.5 / BW, 0); pass(gblurMat, bloomB); gblurMat.uniforms.tSrc.value = bloomB.texture; gblurMat.uniforms.uDir.value.set(0, 1.5 / BH); pass(gblurMat, bloomA); }
    compMat.uniforms.tCol.value = sceneRT.texture; compMat.uniforms.tAO.value = aoRT.texture; compMat.uniforms.tBloom.value = bloomA.texture; pass(compMat, compRT);
    fxMat.uniforms.tDiffuse.value = compRT.texture; fxMat.uniforms.resolution.value.set(1 / PW, 1 / PH); pass(fxMat, null);
    // Légende: condition de lumière, parts de nuages, position du soleil
    const w = weatherRow || {}; const low = w.cloudLow ?? null, alt = Math.max(w.cloudMid ?? 0, w.cloudHigh ?? 0), sun = w.sunFraction != null ? Math.round(w.sunFraction * 100) : null;
    const vt = tg.iv >= 0.45 ? 'Voile d’altitude léger : soleil filtré, ombres douces' : tg.iv >= 0.2 ? 'Voile épais : ombres à peine marquées' : 'Lumière plate : presque plus d’ombres';
    const cond = realDeg < -12 ? 'Nuit' : night ? 'Heure bleue : ciel bleu profond, bâtiments en silhouette' : realDeg < 0.5 ? 'Soleil à l’horizon' : tg.cum >= 0.7 ? 'Nuages bas nombreux : soleil par éclaircies seulement' : Math.max(tg.mid, tg.high) >= 0.3 ? vt + (tg.cum >= 0.15 ? ', quelques nuages bas' : '') : tg.cum >= 0.15 ? 'Nuages bas épars : plein soleil entre les ombres de nuages' : 'Ciel dégagé : soleil franc, ombres nettes';
    const parts = low == null ? '' : `Nuages bas ${low} %, nuages d’altitude ${Math.round(alt)} %, soleil direct ${sun == null ? 0 : sun} %`;
    const where = night ? 'Soleil sous l’horizon' : `Soleil à ${Math.max(0, Math.round(realDeg))}° au-dessus de l’horizon, plein ${DIRS[Math.round(((bearing * 180 / Math.PI) % 360) / 45) % 8]}`;
    const est = (0.38 + 0.36 * Math.max(veil * (0.4 + 0.6 * thick), cum * 0.5)) * dk;
    // Côté du projet le plus en face de la caméra: d'où vient sa façade (images du client ou rythme générique) et sa hauteur.
    let fac = null, best = -Infinity;
    projInfo.forEach(e => { if (e.len < 2.5) return; const dx = cam.position.x - e.mid[0], dz = cam.position.z + e.mid[1], dist = Math.hypot(dx, dz) || 1; const facing = (e.nrm[0] * dx - e.nrm[1] * dz) / dist; if (facing < 0.15) return; const scv = facing * Math.sqrt(e.len) / Math.sqrt(dist); if (scv > best) { best = scv; fac = e; } });
    const FAC = { images: 'd’après les images du client', probable: 'd’après les images du client, probable', unseen: 'pas vue dans les images, rythme générique', stale: 'formes modifiées depuis l’analyse, rythme générique', generic: 'rythme générique', none: 'rythme générique (pas d’analyse)' };
    const facade = fac ? `Façade ${fac.dir} (${fac.id}) : ${FAC[fac.status]}` : '', height = fac ? `Hauteur ${fac.label} : ${Math.round(fac.h)} m, ${fac.src}` : '';
    const info = cond + '|' + parts + '|' + where + '|' + facade + '|' + height + '|' + (est > 0.55 ? 'dark' : 'light');
    if (info !== lastInfo) { lastInfo = info; onInfo({ cond, parts, where, facade, height, light: est <= 0.55, northDeg: (Math.atan2(vF.x, -vF.z) * 180 / Math.PI) }); }
  }
  raf = requestAnimationFrame(frame);
  const ro = new ResizeObserver(() => resize()); ro.observe(container);

  function resize() {
    const w = Math.max(2, container.clientWidth), h = Math.max(2, container.clientHeight); if (w === W && h === H) return;
    W = w; H = h; R.setSize(W, H); cam.aspect = W / H; cam.updateProjectionMatrix(); alloc(); dirty = true;
  }
  return {
    setProject({ lat: la, lng: ln, buildings, orientation: ori, style: sty }) {
      lat = la; lng = ln; projLocal = buildings || []; orientation = ori || []; style = sty || null;
      if (!data) origin = [la, ln];
      rebuild();
    },
    setData(scene) { data = scene; if (scene && scene.origin) origin = scene.origin; rebuild(); },
    setTime(ms) { if (ms !== dateMs) { dateMs = ms; dirty = true; } },
    setWeather(row) {
      weatherRow = row || null;
      const s = row?.sunFraction == null ? 0.02 : row.sunFraction, cum = (row?.cloudLow ?? 0) / 100;
      tg.cum = cum; tg.mid = (row?.cloudMid ?? 0) / 100; tg.high = (row?.cloudHigh ?? 0) / 100; tg.iv = clamp(s / Math.max(0.1, 1 - cum));
      if (!row) { tg.cum = 0; tg.mid = 0; tg.high = 0; tg.iv = 1; }
      dirty = true;
    },
    resize,
    getView() { return { az, camH, Rr, ct: ct.toArray(), time: new Date(dateMs).toString().slice(0, 24) }; },
    dispose() {
      running = false; cancelAnimationFrame(raf); ro.disconnect(); clearStatics(); disposeDet();
      [sceneRT, aoRT, aoRT2, compRT, cubeRT, envRT].forEach(r => r && r.dispose()); pmrem.dispose();
      [skyMat, aoMat, blurMat, compMat, brightMat, gblurMat, fxMat, wallMat, roofMat, trunkMat, crownMat, waterMat, cloudMat, ...Object.values(flatMats)].forEach(m => m.dispose());
      [skyGeo, crownGeo, trunkGeo, sg, gnd.geometry, quad.geometry].forEach(g => g.dispose()); FT.map.dispose(); FT.rough.dispose(); FT.emis.dispose(); gndTex.dispose(); leafMask.dispose();
      R.dispose(); R.forceContextLoss(); if (el.parentNode) el.parentNode.removeChild(el);
    },
  };
}
