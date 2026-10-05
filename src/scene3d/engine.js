// Vue 3D de la fiche projet: les bâtiments dessinés dans le projet et les environs (voisins avec leur
// hauteur, rues, arbres, parcs, eau), sous le ciel et la lumière d'une heure donnée.
// Le ciel est une seule fonction (nuages bas en cumulus, nuages moyens en couche, nuages hauts en voile,
// soleil plus ou moins voilé) vue par la caméra ET capturée pour éclairer la scène, donc une journée
// grise éclaire gris et un ciel bleu donne des ombres bleutées. Passes d'image: recoins (occlusion
// ambiante), tonalité, lissage des bords.
// Chargé à la demande (import dynamique), three.js ne pèse rien tant que la 3D n'est pas ouverte.
import * as THREE from 'three';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import SunCalc from 'suncalc';
import { DIRS, centroid, edgesOf, localRings, signedArea } from './footprint.js';

// Ombres PCSS (percentage-closer soft shadows) greffées sur le mode d'ombre « de base » de three (carte de profondeur en
// pleine précision, lue directement): pénombre nette au contact et de plus en plus large en s'éloignant de l'objet qui
// porte l'ombre (disque solaire de 0,5°), élargie sous le voile par shadow.radius. Remplace la méthode VSM (profondeur en
// demi-flottants: rayures et fuites de lumière). Constante 0,0149 = plage de profondeur 480 m x 2 tan(0,25°) / cadre 300 m
// (caméra d'ombre dans createScene3D), par unité de profondeur normalisée.
const PCSS_GLSL = `
		float pcssNoise( vec2 p ) { return fract( 52.9829189 * fract( dot( p, vec2( 0.06711056, 0.00583715 ) ) ) ); }
		vec2 pcssVogel( int i, int n, float phi ) { float r = sqrt( ( float( i ) + 0.5 ) / float( n ) ); float t = float( i ) * 2.399963229728653 + phi; return vec2( cos( t ), sin( t ) ) * r; }
		float getShadow( sampler2D shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, float shadowRadius, vec4 shadowCoord ) {
			shadowCoord.xyz /= shadowCoord.w;
			shadowCoord.z += shadowBias;
			bool inFrustum = shadowCoord.x >= 0.0 && shadowCoord.x <= 1.0 && shadowCoord.y >= 0.0 && shadowCoord.y <= 1.0;
			if ( ! inFrustum || shadowCoord.z > 1.0 ) return 1.0;
			float texel = 1.0 / shadowMapSize.x, zR = shadowCoord.z, k = 0.0149 * shadowRadius;
			float phi = pcssNoise( gl_FragCoord.xy ) * 6.2831853;
			float sRad = clamp( k * zR, 2.0 * texel, 0.03 ), bSum = 0.0, bN = 0.0;
			for ( int i = 0; i < 16; i ++ ) { float d = texture2D( shadowMap, shadowCoord.xy + pcssVogel( i, 16, phi ) * sRad ).r; if ( d < zR ) { bSum += d; bN += 1.0; } }
			if ( bN < 0.5 ) return 1.0;
			float pen = clamp( k * ( zR - bSum / bN ), texel, 0.025 ), sh = 0.0;
			for ( int i = 0; i < 24; i ++ ) { float d = texture2D( shadowMap, shadowCoord.xy + pcssVogel( i, 24, phi ) * pen ).r; sh += step( zR, d ); }
			return mix( 1.0, sh / 24.0, shadowIntensity );
		}
`;
let PCSS_OK = false;
(() => {
  const c = THREE.ShaderChunk.shadowmap_pars_fragment;
  const a = c.indexOf('#else\n\t\tfloat getShadow( sampler2D shadowMap'); if (a < 0) return;
  // Fin de la fonction de base: le #endif qui précède le bloc suivant (pas le #endif interne du tampon inversé).
  let b = c.indexOf('\n\t#endif\n\t#if NUM_SUN_LIGHT_SHADOWS', a); if (b < 0) b = c.indexOf('\n\t#endif\n\t#if NUM_POINT_LIGHT_SHADOWS', a); if (b < 0) return;
  THREE.ShaderChunk.shadowmap_pars_fragment = c.slice(0, a) + '#else' + PCSS_GLSL + c.slice(b + 1);
  PCSS_OK = true;
})();
if (!PCSS_OK) console.warn('[scene3d] chunk d’ombre de three inattendu: ombres PCF au lieu de PCSS');

const clamp = (x) => Math.max(0, Math.min(1, x));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const mixHex = (a, b, t) => { t = clamp(t); const p = (h) => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)); const A = p(a), B = p(b); return '#' + A.map((v, i) => Math.round(v + (B[i] - v) * t).toString(16).padStart(2, '0')).join(''); };
const mv = (a, b, t) => a.map((v, i) => v + (b[i] - v) * clamp(t));
const hsh = (x, n, k) => { const s = Math.sin(x * 12.9898 + n * 78.233 + k * 37.719) * 43758.5453; return s - Math.floor(s); };
const rgb = (h) => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255);
const L = (h) => new THREE.Color(h); // interprété comme sRGB, converti en linéaire par three
// Extinction atmosphérique de Preetham pour la direction du soleil (mêmes constantes que le ciel): donne la couleur du
// soleil direct (blanc haut dans le ciel, orange puis rouge au ras de l'horizon) et sa perte de force.
// Radiance du ciel de Preetham dans une direction (mêmes formules que le shader), en linéaire avant échelle: sert à caler
// le niveau du ciel (zénith) sur notre courbe d'exposition et à teinter le brouillard avec l'horizon réel.
function preethamRadiance(dir, sun, turb, ray) {
  const TR = [5.804542996261093e-6, 1.3562911419845635e-5, 3.0265902468824876e-5], MC = [1.8399918514433978e14, 2.7798023919660528e14, 4.0790479543861094e14];
  const bR = TR.map(v => v * ray), bM = MC.map(v => 0.434 * (0.2 * turb) * 1e-17 * v * 0.005);
  const za = Math.acos(Math.max(0.12, dir[1])), inv = 1 / (Math.cos(za) + 0.15 * Math.pow(93.885 - za * 57.29578, -1.253));
  const Fex = bR.map((b, i) => Math.exp(-(b * 8400 * inv + bM[i] * 1250 * inv)));
  const ct = dir[0] * sun[0] + dir[1] * sun[1] + dir[2] * sun[2], rPh = 0.05968310365946075 * (1 + Math.pow(ct * 0.5 + 0.5, 2)), mPh = 0.07957747154594767 * (0.36 / Math.pow(1.64 - 1.6 * ct, 1.5));
  const E = 1000 * Math.max(0, 1 - Math.exp(-((1.6110731556870734 - Math.acos(Math.max(-1, Math.min(1, sun[1])))) / 1.5))), w = Math.min(1, Math.pow(1 - sun[1], 5));
  return bR.map((b, i) => { const br = (b * rPh + bM[i] * mPh) / (b + bM[i]); let Lin = Math.pow(E * br * (1 - Fex[i]), 1.5); Lin *= (1 - w) + w * Math.sqrt(E * br * Fex[i]); return (Lin + 0.1 * Fex[i]) * 0.04; });
}
const LUM = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
function sunExtinction(y, turb, ray) {
  const TR = [5.804542996261093e-6, 1.3562911419845635e-5, 3.0265902468824876e-5], MC = [1.8399918514433978e14, 2.7798023919660528e14, 4.0790479543861094e14];
  const za = Math.acos(Math.max(0, y)), inv = 1 / (Math.cos(za) + 0.15 * Math.pow(93.885 - za * 57.29578, -1.253));
  return TR.map((r, i) => Math.exp(-(r * ray * 8400 * inv + 0.434 * (0.2 * turb) * 1e-17 * MC[i] * 0.005 * 1250 * inv)));
}

const SKY_GLSL = `uniform float uCum,uMid,uHigh,uDirect,uWarm,uTw,uNight,uGlow,uTurb,uRay,uSkyK,uPhys,uSunL;uniform vec3 uSun,uSunCol;varying vec3 vDir;
const vec3 LUMW=vec3(0.2126,0.7152,0.0722);
// Ciel clair de Preetham (modèle analytique de lumière du jour, comme Sky.js de three): diffusion de Rayleigh (bleu du ciel) et de
// Mie (halo blanc autour du soleil, brume à l'horizon), extinction Fex le long du rayon. uTurb = turbidité (brume), uRay = part
// de Rayleigh, uSkyK = échelle vers notre exposition.
const vec3 TR=vec3(5.804542996261093e-6,1.3562911419845635e-5,3.0265902468824876e-5);
const vec3 MC=vec3(1.8399918514433978e14,2.7798023919660528e14,4.0790479543861094e14);
float sunE(float y){y=clamp(y,-1.0,1.0);return 1000.0*max(0.0,1.0-exp(-((1.6110731556870734-acos(y))/1.5)));}
vec3 preetham(vec3 dir,vec3 sd,out vec3 Fex){vec3 bR=TR*uRay,bM=0.434*(0.2*uTurb)*1e-17*MC*0.005;
float za=acos(max(0.12,dir.y));// épaisseur bornée: sous 7° d'élévation le ciel garde la couleur de 7° (pas de bande claire à l'horizon)float inv=1.0/(cos(za)+0.15*pow(93.885-za*57.29578,-1.253));Fex=exp(-(bR*8400.0*inv+bM*1250.0*inv));
float ct=dot(dir,sd);float rPh=0.05968310365946075*(1.0+pow(ct*0.5+0.5,2.0));float mPh=0.07957747154594767*(0.36/pow(1.64-1.6*ct,1.5));
float E=sunE(sd.y);vec3 br=(bR*rPh+bM*mPh)/(bR+bM);vec3 Lin=pow(E*br*(1.0-Fex),vec3(1.5));
Lin*=mix(vec3(1.0),pow(E*br*Fex,vec3(0.5)),clamp(pow(1.0-sd.y,5.0),0.0,1.0));return (Lin+0.1*Fex)*0.04*uSkyK;}
float hash(vec2 p){p=fract(p*vec2(123.34,456.21));p+=dot(p,p+45.32);return fract(p.x*p.y);}
float noise(vec2 p){vec2 i=floor(p),f=fract(p);vec2 u=f*f*(3.0-2.0*f);return mix(mix(hash(i),hash(i+vec2(1.0,0.0)),u.x),mix(hash(i+vec2(0.0,1.0)),hash(i+vec2(1.0,1.0)),u.x),u.y);}
float fbm(vec2 p,float lod){float v=0.0,a=0.5;mat2 m=mat2(1.6,1.2,-1.2,1.6);for(int i=0;i<6;i++){float k=i<2?1.0:clamp(lod*2.0-float(i-2)*0.45,0.0,1.0);v+=a*(k*noise(p)+(1.0-k)*0.5);p=m*p;a*=0.5;}return v;}
void main(){vec3 rd=normalize(vDir);vec3 sd=normalize(uSun);
float y=rd.y,cg=dot(rd,sd),t=pow(clamp(y,0.0,1.0),0.45),veil=max(uMid,uHigh),lod=smoothstep(0.0,0.35,y);
// Ciel clair physique en linéaire, épaule douce (l'horizon de Preetham est très lumineux), puis domaine d'affichage
// (gamme 2,2) pour le mélange des nuages, comme avant; l'heure bleue et la nuit restent traitées à part plus bas.
vec3 Fx,FxH;vec3 preL=preetham(rd,sd,Fx);preL/=1.0+0.5*dot(preL,LUMW);vec3 col=pow(max(preL,vec3(0.0)),vec3(1.0/2.2));
vec3 horL=preetham(normalize(vec3(rd.x,0.04,rd.z)),sd,FxH);horL/=1.0+0.5*dot(horL,LUMW);vec3 hor=pow(max(horL,vec3(0.0)),vec3(1.0/2.2));
float thick=1.0-uDirect;float blur=0.004+0.02*thick*veil;float disc=smoothstep(cos(0.014+blur),cos(0.010),cg)*step(0.0,y+0.002);
float dC=0.0,aMidG=0.0,aHighG=0.0;vec3 cC=vec3(0.0);
if(y>0.0){vec2 p=rd.xz/(y+0.08)*0.55;float n=fbm(p,lod)*0.74+fbm(p*2.7+vec2(5.0,9.0),lod)*0.26;float th=0.5+(0.5-uCum)*0.62;float sw=0.09+0.14*(1.0-lod);
dC=smoothstep(th,th+sw,n)*smoothstep(0.0,0.10,y)*step(0.02,uCum);
float n2=fbm(p+normalize(sd.xz+vec2(1e-4))*0.12,lod);float lit=clamp(0.55+(n-n2)*5.0,0.0,1.0);
vec3 shd=vec3(0.50,0.54,0.60),li=mix(vec3(1.0),uSunCol,0.55);cC=mix(shd,li,lit)*(1.0-0.22*smoothstep(0.62,0.85,n));cC=mix(cC,hor,0.5*(1.0-smoothstep(0.0,0.25,y)));}
col+=uSunCol*disc*2.0*(1.0-dC)*(1.0-uPhys);col+=uSunCol*pow(max(cg,0.0),40.0)*dC*(1.0-dC)*1.6;col=mix(col,cC,dC);
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
// Sous un ciel couvert, l'horizon n'est pas clair: les nuages lointains se superposent jusqu'au sol (sinon une bande
// pâle de ciel clair apparaît sous la couche sombre, là où les cumulus s'estompent).
float hz=1.0-smoothstep(0.0,0.14,y);vec3 hzc=mix(vec3(0.50,0.54,0.60),hor,0.3)*(1.0-0.25*thick);
col=mix(col,hzc,smoothstep(0.25,0.85,uCum)*hz*0.92);
if(y<0.0){col=mix(col,hor*vec3(0.52,0.55,0.46),smoothstep(0.0,-0.08,y));}
// Heure bleue puis nuit: dégradé bleu profond, lueur chaude seulement à l'horizon côté soleil, nuages en silhouette.
vec3 bh=mix(vec3(0.11,0.24,0.50),vec3(0.03,0.07,0.21),t);
vec2 sh=normalize(sd.xz+vec2(1e-4));float cgh=max(dot(normalize(rd.xz+vec2(1e-4)),sh),0.0);
bh*=0.72+0.55*cgh*(1.0-0.7*t);
bh=mix(bh,vec3(0.92,0.52,0.30),pow(cgh,3.0)*pow(1.0-clamp(y*4.0,0.0,1.0),2.0)*uGlow*0.6);
vec3 night=mix(vec3(0.045,0.07,0.16),vec3(0.016,0.03,0.09),t)*(0.8+0.3*cgh*(1.0-0.7*t));
vec3 tw=mix(bh,night,uNight)*(1.0-0.45*dC-0.25*aMidG-0.15*aHighG);
col=mix(col,tw,uTw);
col=pow(max(col,0.0),vec3(2.2));
// Carte d'environnement du rendu affiné (uPhys): disque solaire à la radiance physique (irradiance = soleil de la scène),
// derrière les cumulus; c'est lui qui fait les ombres douces du lancer de rayons.
if(uPhys>0.5){float dp=smoothstep(cos(0.0078),cos(0.0066),cg)*step(0.0,y);col+=uSunL*uSunCol*dp*(1.0-uTw);}
gl_FragColor=vec4(col,1.0);}`;
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

// Tuile de façade (une travée sur un étage): fenêtre moderne, plus large que haute, cadre fin anthracite, un seul
// meneau décalé au tiers, verre sombre et réfléchissant; carte de rugosité (verre lisse) et carte d'émission
// (fenêtre allumée la nuit, lueur douce). La tuile se répète un nombre entier de fois par mur (voir blocks).
function facadeTex() {
  const c = document.createElement('canvas'); c.width = c.height = 256; const x = c.getContext('2d');
  x.fillStyle = '#ffffff'; x.fillRect(0, 0, 256, 256);
  const ww = 118, wh = 112, wx = 69, wy = 64, fr = 4, mull = Math.round(wx + ww * 0.36);
  x.fillStyle = '#2d3033'; x.fillRect(wx - fr, wy - fr, ww + 2 * fr, wh + 2 * fr); // cadre
  const g = x.createLinearGradient(wx, wy, wx + ww * 0.6, wy + wh); g.addColorStop(0, '#4a5c6e'); g.addColorStop(0.45, '#26323c'); g.addColorStop(1, '#3a4856'); x.fillStyle = g; x.fillRect(wx, wy, ww, wh);
  x.fillStyle = 'rgba(255,255,255,0.08)'; x.fillRect(wx, wy, ww, Math.round(wh * 0.4)); // reflet du ciel en haut
  x.fillStyle = '#2d3033'; x.fillRect(mull - 2, wy, 4, wh); // meneau
  x.fillStyle = '#d8d4cc'; x.fillRect(wx - fr - 2, wy + wh + fr, ww + 2 * fr + 4, 4); // appui discret
  const r = document.createElement('canvas'); r.width = r.height = 256; const y = r.getContext('2d'); y.fillStyle = 'rgb(0,238,0)'; y.fillRect(0, 0, 256, 256); y.fillStyle = 'rgb(0,60,0)'; y.fillRect(wx, wy, ww, wh);
  // Fenêtres allumées (émission chaude, dosée selon la hauteur du soleil)
  const e = document.createElement('canvas'); e.width = e.height = 256; const z = e.getContext('2d'); z.fillStyle = '#000'; z.fillRect(0, 0, 256, 256);
  z.save(); z.shadowColor = '#ffd9a0'; z.shadowBlur = 34; z.globalAlpha = 0.33; z.fillStyle = '#ffd9a0'; z.fillRect(wx, wy, ww, wh); z.restore();
  z.fillStyle = '#ffd9a0'; z.fillRect(wx, wy, ww, wh); z.fillStyle = '#3a3226'; z.fillRect(mull - 2, wy, 4, wh);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  const rt = new THREE.CanvasTexture(r); rt.wrapS = rt.wrapT = THREE.RepeatWrapping;
  const et = new THREE.CanvasTexture(e); et.wrapS = et.wrapT = THREE.RepeatWrapping; et.colorSpace = THREE.SRGBColorSpace;
  return { map: t, rough: rt, emis: et };
}
function groundTex() {
  const c = document.createElement('canvas'); c.width = c.height = 256; const x = c.getContext('2d'); const im = x.createImageData(256, 256), d = im.data;
  for (let i = 0; i < 65536; i++) { const px = i & 255, py = i >> 8; const n = 0.55 * hsh(px * 0.37, py * 0.41, 1) + 0.45 * hsh((px >> 3) * 1.3, (py >> 3) * 1.7, 2); const v = 150 + Math.round(n * 85); d[i * 4] = v; d[i * 4 + 1] = v; d[i * 4 + 2] = v; d[i * 4 + 3] = 255; }
  x.putImageData(im, 0, 0); const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(6600, 6600); t.anisotropy = 4; return t;
}
function lobes(detail = 2) {
  const parts = [[0, 0, 0, 1], [0.6, 0.2, 0.15, 0.62], [-0.55, 0.1, 0.35, 0.58], [0.1, -0.05, -0.6, 0.6], [-0.1, 0.62, -0.1, 0.55], [0.25, 0.45, 0.5, 0.5]]; const pos = [], uvs = [];
  parts.forEach(([x, y, z, r], k) => { const g = new THREE.IcosahedronGeometry(r, detail); const a = g.attributes.position.array, u = g.attributes.uv.array; for (let i = 0; i < a.length; i += 3) pos.push(a[i] + x, a[i + 1] + y, a[i + 2] + z); for (let i = 0; i < u.length; i += 2) uvs.push(u[i] * 2 + k * 0.37, u[i + 1] + k * 0.61); g.dispose(); });
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
  R.setPixelRatio(DPR); R.setSize(W, H); R.shadowMap.enabled = true; R.shadowMap.type = PCSS_OK ? THREE.BasicShadowMap : THREE.PCFShadowMap;
  R.outputColorSpace = THREE.LinearSRGBColorSpace; R.toneMapping = THREE.NoToneMapping; R.autoClear = true;
  R.domElement.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;cursor:grab;touch-action:none';
  container.appendChild(R.domElement);

  // ---- ciel, environnement lumineux
  const skyMat = new THREE.ShaderMaterial({ side: THREE.BackSide, depthWrite: false, uniforms: { uCum: { value: 0 }, uMid: { value: 0 }, uHigh: { value: 0 }, uDirect: { value: 1 }, uWarm: { value: 0 }, uTw: { value: 0 }, uNight: { value: 0 }, uGlow: { value: 0 }, uTurb: { value: 2.5 }, uRay: { value: 1.5 }, uSkyK: { value: 0.2 }, uPhys: { value: 0 }, uSunL: { value: 0 }, uSun: { value: new THREE.Vector3(0, 1, 0) }, uSunCol: { value: new THREE.Vector3(1, 1, 1) } }, vertexShader: SKY_VERT, fragmentShader: SKY_GLSL });
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
  const crownGeo = lobes(), crownGeoLow = lobes(1), trunkGeo = new THREE.CylinderGeometry(0.16, 0.26, 1, 6); // couronne simplifiée pour le lancer de rayons
  const flat = (h, y) => new THREE.MeshStandardMaterial({ color: L(h), roughness: 0.95, side: THREE.DoubleSide, envMapIntensity: 0.75, polygonOffset: true, polygonOffsetFactor: -y, polygonOffsetUnits: -y });
  const flatMats = { road: flat('#4f5255', 3), rail: flat('#8a8378', 3), walk: flat('#b3afa3', 4), asphalt: flat('#4e5154', 2) };
  Object.keys(GC).forEach(k => { flatMats[k] = flat(GC[k], 1); });

  // ---- soleil et ombres de nuages
  const sunL = new THREE.DirectionalLight(0xffffff, 10); sunL.castShadow = true; sunL.shadow.mapSize.set(4096, 4096);
  const sc = sunL.shadow.camera; sc.left = -150; sc.right = 150; sc.top = 150; sc.bottom = -150; // 300 m autour du projet: 7 cm par pixel d'ombre sc.near = 300; sc.far = 780; sunL.shadow.bias = -0.0006; sunL.shadow.normalBias = 0.5; // décalage le long de la normale: plus de bandes en escalier sur les murs frôlés par le soleil
  const T0 = new THREE.Vector3(0, 0, 0); S.add(sunL); S.add(sunL.target);
  // Lumière neutre des nuages: sous un cumulus ou un voile, l'ombre est éclairée par un ciel en partie blanc, pas
  // seulement par le bleu; sans ce complément, les ombres de nuages tirent sur le bleu marine.
  // Appoint hémisphérique: le ciel par le haut, et par le bas la lumière renvoyée par le sol et les voisins (teinte herbe et
  // asphalte), plus forte au soleil: le bas des façades à l'ombre n'est plus uniforme.
  const GROUND_TINT = new THREE.Color(0.46, 0.50, 0.37);
  const fill = new THREE.HemisphereLight(0xffffff, 0x8a9270, 0.2); S.add(fill);
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
  let projInfo = [], lastInfoObj = {}; // côtés des formes du projet avec hauteur et source (légende)

  // ---- Rendu affiné, à la demande: lancer de rayons progressif (three-gpu-pathtracer) quand rien ne bouge. La scène
  // du traceur partage géométries et matériaux avec la scène dessinée (couronnes d'arbres simplifiées, autour du projet);
  // toute la lumière vient du ciel capturé en cube avec un disque solaire physique: ombres douces vraies, lumière
  // indirecte, fenêtres allumées qui éclairent la nuit. Tant que la caméra, l'heure ou la météo bougent, le rendu
  // direct reste affiché; le résultat affiné se raffine ensuite échantillon après échantillon.
  let pt = null, ptScene = null, ptCubes = null, ptCubeCam = null, ptCubeK = 0, ptOn = false, ptReady = false, ptBuilding = false;
  let ptStillAt = 0, ptViewKey = '', ptLightKey = '', ptEnvKey = '', ptCamDirty = true, ptMsg = '';
  const PT_R = 0.0072, PT_OMEGA = 2 * Math.PI * (1 - Math.cos(PT_R)); // disque de 0,8° (1,5 fois le vrai soleil: converge plus vite)
  const PT_MAX = 200; // échantillons par image, puis la carte graphique se repose
  async function ptEnable(on) {
    ptOn = on; dirty = true;
    if (!on) return;
    if (!pt) {
      try {
        const m = await import('three-gpu-pathtracer');
        if (!running) return;
        const P = new m.WebGLPathTracer(R);
        P.renderToCanvas = false; P.rasterizeScene = false; P.dynamicLowRes = false; P.renderDelay = 0; P.minSamples = 1; P.bounces = 4; P.filterGlossyFactor = 0.5; P.tiles.set(1, 1);
        pt = P;
        ptCubes = [0, 1].map(() => new THREE.WebGLCubeRenderTarget(512, { type: THREE.HalfFloatType })); // puissance de deux obligatoire (conversion en équirectangulaire 2048 x 1024)
        ptCubeCam = new THREE.CubeCamera(1, 9000, ptCubes[0]); skyScene.add(ptCubeCam);
        if (import.meta.env.DEV) { window.__pt = P; window.__scene3dDbg = { R, ptCubes, ptCubeCam, skyScene, skyMat, cubeRT, THREE, lib: m }; } // inspection en développement
      } catch (e) { console.error('[scene3d] lancer de rayons indisponible:', e); ptMsg = 'Rendu affiné indisponible ici'; ptOn = false; dirty = true; return; }
    }
    await ptBuild();
  }
  function ptEnvRender() {
    const U = skyMat.uniforms; U.uPhys.value = 1; U.uSunL.value = sunL.intensity / PT_OMEGA;
    ptCubeK ^= 1; ptCubeCam.renderTarget = ptCubes[ptCubeK]; ptCubeCam.update(R, skyScene); U.uPhys.value = 0;
    if (ptScene) { ptScene.environment = ptCubes[ptCubeK].texture; ptScene.background = ptScene.environment; }
  }
  let ptOwned = []; // géométries et matériaux créés pour le traceur seulement
  function ptDisposeOwned() { ptOwned.forEach(o => o.dispose()); ptOwned = []; }
  // Le traceur attend les mêmes attributs sur toutes les géométries: couleur par sommet blanche là où il n'y en a pas.
  function ensureColor(g) { if (!g.attributes.color) { const n = g.attributes.position.count; g.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(n * 3).fill(1), 3)); } return g; }
  async function ptBuild() {
    if (!pt || ptBuilding) return;
    ptBuilding = true; ptReady = false; ptMsg = 'Rendu affiné : préparation'; dirty = true;
    ptDisposeOwned();
    const sc = new THREE.Scene();
    statics.forEach(m => { if (m.isInstancedMesh || !m.userData.pt) return; const c = new THREE.Mesh(ensureColor(m.geometry), m.material); c.position.copy(m.position); c.rotation.copy(m.rotation); c.scale.copy(m.scale); sc.add(c); });
    const g2 = new THREE.Mesh(ensureColor(gnd.geometry), gnd.material); g2.rotation.copy(gnd.rotation); sc.add(g2);
    if (treeNear.length) {
      const o3 = new THREE.Object3D(), crowns = [], trunks = [];
      treeNear.forEach(t => {
        const g = crownGeoLow.clone(); o3.position.set(t.x, t.th + t.cr * 0.85, -t.n); o3.scale.set(t.cr, t.cr * 1.05, t.cr); o3.rotation.set(0, t.rot, 0); o3.updateMatrix(); g.applyMatrix4(o3.matrix);
        const c = L(t.col), n = g.attributes.position.count, arr = new Float32Array(n * 3); for (let i = 0; i < n; i++) { arr[3 * i] = c.r; arr[3 * i + 1] = c.g; arr[3 * i + 2] = c.b; } g.setAttribute('color', new THREE.Float32BufferAttribute(arr, 3)); crowns.push(g);
        const tg = trunkGeo.clone(); o3.position.set(t.x, t.th / 2, -t.n); o3.scale.set(1, t.th, 1); o3.rotation.set(0, 0, 0); o3.updateMatrix(); tg.applyMatrix4(o3.matrix); trunks.push(ensureColor(tg));
      });
      const cg = mergeGeometries(crowns, false), tg = mergeGeometries(trunks, false); crowns.forEach(g => g.dispose()); trunks.forEach(g => g.dispose());
      const cm = crownMat.clone(); cm.vertexColors = true; ptOwned.push(cg, tg, cm);
      sc.add(new THREE.Mesh(cg, cm)); sc.add(new THREE.Mesh(tg, trunkMat));
    }
    ptScene = sc; ptEnvRender();
    try { await pt.setSceneAsync(sc, cam); }
    catch (e) {
      console.warn('[scene3d] construction asynchrone indisponible, construction directe:', e);
      try { pt.setScene(sc, cam); } catch (e2) { console.error('[scene3d] rendu affiné:', e2); ptMsg = 'Rendu affiné indisponible ici'; ptOn = false; ptBuilding = false; dirty = true; return; }
    }
    ptBuilding = false; if (!running) return;
    ptReady = true; ptEnvKey = ''; ptCamDirty = true; ptMsg = ''; dirty = true;
  }

  // Zone proche (rayon NEAR autour du projet, à l'origine): c'est elle que le rendu affiné calcule (userData.pt) et où
  // les arbres gardent tout leur détail; au-delà, la scène directe garde les voisins et des arbres simplifiés, et le
  // brouillard ferme l'horizon. Comme dans un jeu: tout le détail près du sujet, peu au loin.
  const NEAR = 230;
  const nearXY = (x, n) => Math.hypot(x, n) < NEAR;
  let treeNear = [];
  function clearStatics() { statics.forEach(m => { S.remove(m); m.geometry && m.geometry.dispose(); }); statics = []; treesI = null; treeNear = []; }
  function addMesh(g, mat, y, near, shadows) { const m = new THREE.Mesh(g, mat); m.position.y = y; m.receiveShadow = true; if (shadows) m.castShadow = true; m.userData.pt = !!near; S.add(m); statics.push(m); return m; }
  // Surfaces au sol (parcs, asphalte, eau): items = [{ o: contour, h: trous }], séparés proche/loin.
  function addFlat(items, mat, y) {
    [true, false].forEach(near => {
      const part = items.filter(it => { const c = centroid(it.o); return nearXY(c[0], c[1]) === near; });
      if (!part.length) return;
      const g = new THREE.ShapeGeometry(part.map(it => shapeOf(it.o, it.h))); g.rotateX(-Math.PI / 2); addMesh(g, mat, y, near, false);
    });
  }
  function ribbons(list, y, mat) {
    [true, false].forEach(near => {
      const part = list.filter(r => r.p.some(q => nearXY(q[0], q[1])) === near); if (!part.length) return;
      const v = []; const T = (a, b, c) => v.push(a[0], 0, -a[1], b[0], 0, -b[1], c[0], 0, -c[1]);
      part.forEach(r => { const w = r.w / 2, P = r.p; for (let i = 0; i < P.length - 1; i++) { const [x1, n1] = P[i], [x2, n2] = P[i + 1]; const dx = x2 - x1, dn = n2 - n1, l = Math.hypot(dx, dn) || 1, ox = -dn / l * w, on = dx / l * w; const A = [x1 + ox, n1 + on], B = [x1 - ox, n1 - on], C = [x2 - ox, n2 - on], D = [x2 + ox, n2 + on]; T(A, B, C); T(A, C, D); }
        P.forEach(([x, n]) => { for (let k = 0; k < 10; k++) { const a1 = k / 10 * Math.PI * 2, a2 = (k + 1) / 10 * Math.PI * 2; T([x, n], [x + Math.cos(a1) * w, n + Math.sin(a1) * w], [x + Math.cos(a2) * w, n + Math.sin(a2) * w]); } }); });
      if (!v.length) return; const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3)); g.computeVertexNormals(); addMesh(g, mat, y, near, false);
    });
  }
  function blocks(list) {
    [true, false].forEach(near => {
      const part = list.filter(b => { const c = centroid(b.p); return nearXY(c[0], c[1]) === near; }); if (!part.length) return;
      const P = [], N = [], U = [], C = [], SD = [], RP = [], RN = [], RC = [];
      part.forEach(b => {
        // Contour en sens trigonométrique (vu du ciel): l'extérieur est à droite du sens de parcours, ce qui vaut
        // aussi pour les formes concaves (en L, en U), contrairement à un test sur le centre de la forme.
        const pts = signedArea(b.p) < 0 ? b.p.slice().reverse() : b.p, h = b.h, lv = Math.max(1, b.fl), col = b.col, rc = b.rc; let u0 = 0; const seed0 = Math.floor(hsh(pts[0][0], pts[0][1], 9) * 900);
        for (let i = 0; i < pts.length; i++) {
          const a = pts[i], c = pts[(i + 1) % pts.length]; const ax = a[0], azz = -a[1], bx = c[0], bz = -c[1]; const ex = bx - ax, ez = bz - azz, len = Math.hypot(ex, ez); if (len < 0.05) continue;
          const nx = -ez / len, nz = ex / len;
          // Nombre entier de travées par mur (fenêtres centrées, jamais coupées dans un coin); mur trop court: plein.
          const nb = Math.round(len / (b.bay || 4.8)); const u1 = u0 + nb; const q = [[ax, 0, azz, u0, 0], [bx, 0, bz, u1, 0], [bx, h, bz, u1, lv], [ax, h, azz, u0, lv]];
          [[0, 1, 2], [0, 2, 3]].forEach(t => t.forEach(k => { const v = q[k]; P.push(v[0], v[1], v[2]); N.push(nx, 0, nz); U.push(v[3], v[4]); C.push(col.r, col.g, col.b); SD.push(seed0 + i); })); u0 = u1;
        }
        const rg = new THREE.ShapeGeometry(shapeOf(pts)); rg.rotateX(-Math.PI / 2); const ra = rg.toNonIndexed().attributes.position.array; for (let i = 0; i < ra.length; i += 3) { RP.push(ra[i], h, ra[i + 2]); RN.push(0, 1, 0); RC.push(rc.r, rc.g, rc.b); } rg.dispose();
      });
      if (!P.length) return;
      const wg = new THREE.BufferGeometry(); wg.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); wg.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3)); wg.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2)); wg.setAttribute('color', new THREE.Float32BufferAttribute(C, 3)); wg.setAttribute('aSeed', new THREE.Float32BufferAttribute(SD, 1));
      addMesh(wg, wallMat, 0, near, true);
      const rgm = new THREE.BufferGeometry(); rgm.setAttribute('position', new THREE.Float32BufferAttribute(RP, 3)); rgm.setAttribute('normal', new THREE.Float32BufferAttribute(RN, 3)); rgm.setAttribute('color', new THREE.Float32BufferAttribute(RC, 3));
      addMesh(rgm, roofMat, 0, near, true);
    });
  }
  // Soubassement: bandeau de 0,9 m au pied des bâtiments du projet, dans la couleur du bas des murs.
  function band(list, col, hh) {
    const P = [], N = [], C = [];
    list.forEach(pts => { const r = signedArea(pts) < 0 ? pts.slice().reverse() : pts;
      for (let i = 0; i < r.length; i++) { const a = r[i], c = r[(i + 1) % r.length]; const ax = a[0], az = -a[1], bx = c[0], bz = -c[1]; const ex = bx - ax, ez = bz - az, len = Math.hypot(ex, ez); if (len < 0.05) continue;
        const nx = -ez / len, nz = ex / len, o = 0.06; const q = [[ax + nx * o, 0, az + nz * o], [bx + nx * o, 0, bz + nz * o], [bx + nx * o, hh, bz + nz * o], [ax + nx * o, hh, az + nz * o]];
        [[0, 1, 2], [0, 2, 3]].forEach(t => t.forEach(k => { const v = q[k]; P.push(v[0], v[1], v[2]); N.push(nx, 0, nz); C.push(col.r, col.g, col.b); })); } });
    if (!P.length) return; const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
    addMesh(g, roofMat, 0, true, false);
  }
  // Arbres: couronnes détaillées jusqu'à 160 m, simplifiées au-delà (deux lots instanciés); ceux de la zone proche
  // sont gardés en liste pour le rendu affiné, qui les fusionne en un seul maillage.
  function trees(list) {
    if (!list.length) return;
    const o3 = new THREE.Object3D(), lots = [[], []];
    list.forEach(([x, n]) => {
      const h = 7 + 6 * hsh(x, n, 1), cr = 2.1 + 1.5 * hsh(x, n, 2), th = Math.max(2.5, h - cr * 1.4), rot = hsh(x, n, 3) * 6.28, col = TREE_PAL[Math.floor(hsh(x, n, 4) * TREE_PAL.length)];
      const t = { x, n, th, cr, rot, col }; lots[Math.hypot(x, n) < 160 ? 0 : 1].push(t); if (nearXY(x, n)) treeNear.push(t);
    });
    treesI = [];
    lots.forEach((lot, k) => {
      if (!lot.length) return;
      const trunkI = new THREE.InstancedMesh(trunkGeo, trunkMat, lot.length), crownI = new THREE.InstancedMesh(k ? crownGeoLow : crownGeo, crownMat, lot.length);
      lot.forEach((t, i) => {
        o3.position.set(t.x, t.th / 2, -t.n); o3.scale.set(1, t.th, 1); o3.rotation.set(0, 0, 0); o3.updateMatrix(); trunkI.setMatrixAt(i, o3.matrix);
        o3.position.set(t.x, t.th + t.cr * 0.85, -t.n); o3.scale.set(t.cr, t.cr * 1.05, t.cr); o3.rotation.set(0, t.rot, 0); o3.updateMatrix(); crownI.setMatrixAt(i, o3.matrix); crownI.setColorAt(i, L(t.col));
      });
      [trunkI, crownI].forEach(m => { m.castShadow = true; m.receiveShadow = true; S.add(m); statics.push(m); treesI.push(m); });
    });
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
    // Formes dessinées (Forme 1, Forme 2... dans l'ordre du projet), en mètres autour de l'origine.
    const drawn = localRings(projLocal, origin);
    // Hauteur: valeur réglée dans la pastille FORME, sinon hauteur mesurée Overture du même édifice (30 m est le défaut du
    // dessin, jamais une vraie hauteur: Stéphane ne la connaît pas), sinon 9 m. Couleur des murs: choisie dans la pastille,
    // sinon brique. Fenêtres sobres: deux rangées jusqu'à 16 m, puis 4,5 m par étage, une par 6 m.
    const list = []; projInfo = [];
    drawn.forEach((d, i) => {
      const hits = data ? data.bld.filter(([p, , , k]) => k !== 2 && ringsOverlap(d.p, p)) : [];
      const measured = hits.length ? Math.max(...hits.map(x => x[1])) : null;
      let h, src;
      if (!d.def) { h = d.h; src = 'réglée dans le projet'; } else if (measured != null) { h = measured; src = 'mesurée (Overture)'; } else { h = 9; src = 'par défaut'; }
      h = Math.max(3, h);
      const fl = h < 6 ? 1 : h <= 16 ? 2 : Math.round(h / 4.5);
      const wallHex = (projLocal[d.i] && projLocal[d.i].wallColor) || '#7a3f33';
      edgesOf(d.p).forEach(e => projInfo.push({ dir: e.dir, len: e.len, mid: e.mid, nrm: e.nrm, label: `Forme ${i + 1}`, h, src }));
      list.push({ p: d.p, h, fl, bay: 6, col: L(wallHex), rc: L('#5a5650') });
    });
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
      Object.keys(GC).forEach(k => addFlat(data.green.filter(p => p.k === k).map(p => ({ o: p.p })), flatMats[k], 0.03));
      addFlat(data.asphalt.map(p => ({ o: p })), flatMats.asphalt, 0.05);
      addFlat(data.water.map(w => ({ o: w.o, h: w.h })), waterMat, 0.05);
      ribbons(data.roads.filter(r => r.k === 0), 0.08, flatMats.road); ribbons(data.roads.filter(r => r.k === 2), 0.1, flatMats.rail); ribbons(data.roads.filter(r => r.k === 1), 0.12, flatMats.walk);
      trees(data.trees);
    }
    blocks(list);
    pickView(drawn.length ? drawn[0].p : [], others, data ? data.roads : [], data ? data.trees : []);
    dirty = true;
    if (ptOn && pt) { ptReady = false; ptBuild(); }
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
    const ptLive = ptOn && ptReady && pt && pt.samples < PT_MAX && now - ptStillAt > 350 && !document.hidden;
    if (!dirty && !moving && now - envAt > 400 && !ptLive) return; // rien à redessiner: on laisse le processeur tranquille
    dirty = false;
    const cum = cur.cum, mid = cur.mid, high = cur.high, iv = cur.iv, veil = Math.max(mid, high);
    const sp = SunCalc.getPosition(new Date(dateMs), lat, lng); const bearing = sp.azimuth + Math.PI; // azimut depuis le nord, sens horaire
    const realDeg = sp.altitude * 180 / Math.PI, el = Math.max(sp.altitude, 0.6 * Math.PI / 180), eld = el * 180 / Math.PI;
    const d = new THREE.Vector3(Math.sin(bearing) * Math.cos(el), Math.sin(el), -Math.cos(bearing) * Math.cos(el));
    const night = realDeg < -0.8, twi = smooth(2, -5, realDeg), nightF = smooth(-7, -15, realDeg), glow = 1 - smooth(-5, -10, realDeg);
    // Brume (turbidité) un peu plus forte sous le voile; extinction du soleil direct selon sa hauteur.
    const turb = 2.3 + 2.0 * high + 0.8 * mid, Fx = sunExtinction(Math.sin(el), turb, 1.5), fxm = Math.max(Fx[0], Fx[1], Fx[2], 1e-4);
    const fe = Math.pow(0.2126 * Fx[0] + 0.7152 * Fx[1] + 0.0722 * Fx[2], 0.7), Idir = night ? 0 : 10 * fe * iv; sunL.intensity = Idir;
    // Couleur du soleil direct: extinction adoucie (Preetham rougit trop au ras de l'horizon) et un peu de blanc gardé.
    const sunRGB = Fx.map(v => 0.85 * Math.pow(v / fxm, 0.45) + 0.15), sc0 = mixHex('#' + sunRGB.map(v => Math.round(v * 255).toString(16).padStart(2, '0')).join(''), '#eeebe4', (1 - iv) * 0.6); sunL.color.copy(L(sc0));
    skyMat.uniforms.uTurb.value = turb;
    // Niveau du ciel: le modèle donne les couleurs et leur répartition, notre courbe donne la luminance du zénith
    // (0,17 en plein jour, encore 0,04 au ras de l'horizon), sinon le zénith s'éteint au soleil bas et l'horizon blanchit.
    const sunV = [Math.sin(bearing) * Math.cos(el), Math.sin(el), -Math.cos(bearing) * Math.cos(el)];
    const zenTarget = 0.035 + 0.14 * Math.pow(clamp(Math.sin(el) / 0.45), 0.55), zenLum = LUM(preethamRadiance([0, 1, 0], sunV, turb, 1.5));
    const skyK = zenTarget / Math.max(1e-5, zenLum); skyMat.uniforms.uSkyK.value = skyK;
    // Caméra d'ombre serrée en profondeur (la carte VSM garde la profondeur en demi-flottants: plus la plage est courte, moins
    // les surfaces s'auto-ombrent en rayures au soleil bas): lumière à 520 m, plage de 300 à 780 m.
    const dist = 520; sunL.position.copy(T0).addScaledVector(d, dist); sc.near = 300; sc.far = 780; sc.updateProjectionMatrix(); sunL.shadow.radius = 1 + 7 * Math.pow(1 - iv, 1.3) + 1.5 * cum; // taille apparente du soleil pour la pénombre: vraie au soleil franc, élargie sous le voile et les nuages
    fill.intensity = (0.2 + 1.1 * Math.max(cum, veil) * Math.min(1, Math.sin(el) / 0.3)) * (1 - 0.5 * twi);
    fill.color.setRGB(0.86, 0.90, 1.0).lerp(new THREE.Color(0.9, 0.9, 0.9), Math.max(cum, veil)); // ciel bleuté, gris sous les nuages
    fill.groundColor.copy(GROUND_TINT).multiplyScalar((0.5 + 1.3 * iv * Math.min(1, Math.sin(el) / 0.5)) * (1 - 0.6 * twi)); // rebond du sol
    const ambB = (0.3 + 0.55 * Math.min(1, Math.sin(el) / 0.5)) * (1 + 0.3 * Math.max(cum, veil)); const tot = (Idir / Math.PI * 0.5 + ambB) / 2.2;
    compMat.uniforms.uExp.value = Math.max(0.5, Math.min(1.15 - 0.4 * twi, 0.64 * Math.pow(1 / Math.max(0.05, Math.min(1, tot)), 0.3)));
    const nb = Math.min(60, Math.round(cum * 110)), hh = 150 / Math.max(d.y, 0.08); blobs.forEach((g, i) => { g.visible = i < nb; const u = g.userData; g.position.set(T0.x + u.gx + d.x * hh, 150, T0.z + u.gz + d.z * hh); });
    cam.position.set(ct.x + Math.sin(az) * Rr, camH, ct.z - Math.cos(az) * Rr); cam.lookAt(ct); cam.updateMatrixWorld(); cam.getWorldDirection(vF); sky.position.copy(cam.position);
    const U = skyMat.uniforms, dk = 0.5 + 0.5 * clamp((realDeg + 1) / 14), uW = clamp(1 - (realDeg - 1) / 22);
    U.uCum.value = cum; U.uMid.value = mid; U.uHigh.value = high; U.uDirect.value = iv; U.uWarm.value = uW; U.uTw.value = twi; U.uNight.value = nightF; U.uGlow.value = glow;
    wallMat.emissiveIntensity = 0.55 * smooth(1, -4, realDeg);
    const soft = twi * (1 - nightF); twL.intensity = 1.8 * soft; twL.color.copy(L(mixHex('#9fb0e0', '#e8bc92', glow * 0.5)));
    twL.target.position.copy(T0); twL.position.copy(T0).add(new THREE.Vector3(Math.sin(bearing) * Math.cos(0.17), Math.sin(0.17), -Math.cos(bearing) * Math.cos(0.17)).multiplyScalar(400));
    const sDir = new THREE.Vector3(Math.sin(bearing) * Math.cos(sp.altitude), Math.sin(sp.altitude), -Math.cos(bearing) * Math.cos(sp.altitude)); U.uSun.value.copy(sDir); const sc1 = rgb(sc0); U.uSunCol.value.set(sc1[0], sc1[1], sc1[2]);
    const key = [cum, mid, high, iv, uW, dk, sDir.x, sDir.y].map(v => v.toFixed(2)).join(','); if (key !== envKey && now - envAt > 120) { envKey = key; envAt = now; updateEnv(); }
    const cgv = Math.max(0, new THREE.Vector3(vF.x, 0, vF.z).normalize().dot(sDir)), thick = 1 - iv;
    // Brouillard: couleur de l'horizon du même ciel physique dans la direction regardée (épaule comme dans le shader),
    // puis voile, cumulus, heure bleue et nuit comme le ciel; tout en linéaire.
    const fdir = new THREE.Vector3(vF.x, 0.04, vF.z).normalize(), lin = (c) => c.map(v => Math.pow(v, 2.2));
    // Le sol lointain est nettement plus sombre que le ciel juste au-dessus de l'horizon (sinon brume blanche): 0,45 fois l'horizon;
    // sous un voile ou des cumulus, la base grise des nuages, comme dans le ciel.
    let hc = preethamRadiance([fdir.x, fdir.y, fdir.z], sunV, turb, 1.5).map(v => v * skyK); const hl = LUM(hc); hc = hc.map(v => 0.45 * v / (1 + 0.5 * hl));
    let vc = mv([0.88, 0.89, 0.90], [0.64, 0.66, 0.69], thick); vc = mv(vc, mv([0.62, 0.62, 0.66], [0.95, 0.72, 0.55], 0.6), uW * 0.5);
    hc = mv(hc, lin(vc).map(v => v * 0.55), veil * (0.45 + 0.52 * thick * thick)); hc = mv(hc, lin([0.50, 0.54, 0.60]).map(v => v * 0.65), smooth(0.25, 0.85, cum)); hc = mv(hc, lin([0.11, 0.24, 0.50]).map(v => v * (0.72 + 0.55 * cgv)), twi); hc = mv(hc, lin([0.045, 0.07, 0.16]).map(v => v * (0.8 + 0.3 * cgv)), nightF); fog.color.setRGB(hc[0], hc[1], hc[2]); fog.near = 250 + camH * 4; fog.far = 1500 + camH * 14;
    // Rendu affiné: dès que caméra, heure et météo sont stables, le traceur accumule et remplace l'image directe.
    if (ptOn && ptReady && pt) {
      const vk = [az, camH, Rr, ct.x, ct.z].map(v => v.toFixed(3)).join(','), lk = [dateMs, cum, mid, high, iv].map(v => (+v).toFixed(3)).join(',');
      if (vk !== ptViewKey) { ptViewKey = vk; ptCamDirty = true; ptStillAt = now; }
      if (lk !== ptLightKey) { ptLightKey = lk; ptStillAt = now; }
      if (now - ptStillAt > 350) {
        if (ptEnvKey !== lk) { ptEnvKey = lk; ptEnvRender(); pt.updateMaterials(); pt.updateEnvironment(); }
        if (ptCamDirty) { ptCamDirty = false; pt.updateCamera(); }
        if (pt.samples < PT_MAX && !document.hidden) { pt.renderSample(); pt.renderSample(); }
        if (pt.samples >= 1) {
          compMat.uniforms.tCol.value = pt.target.texture; compMat.uniforms.tAO.value = aoRT.texture; compMat.uniforms.tBloom.value = bloomA.texture; compMat.uniforms.uAO.value = 0; compMat.uniforms.uBloom.value = 0;
          pass(compMat, null); compMat.uniforms.uAO.value = 0.9;
          const rt = pt.samples >= PT_MAX ? `Rendu affiné : terminé (${PT_MAX} échantillons)` : `Rendu affiné : ${Math.round(pt.samples)} échantillons`;
          if (rt !== lastInfo) { lastInfo = rt; onInfo({ ...lastInfoObj, rt }); }
          return;
        }
      }
    }
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
    // Forme du projet la plus en face de la caméra: sa hauteur et d'où elle vient (réglée, mesurée, par défaut).
    let fac = null, best = -Infinity;
    projInfo.forEach(e => { if (e.len < 2.5) return; const dx = cam.position.x - e.mid[0], dz = cam.position.z + e.mid[1], dist = Math.hypot(dx, dz) || 1; const facing = (e.nrm[0] * dx - e.nrm[1] * dz) / dist; if (facing < 0.15) return; const scv = facing * Math.sqrt(e.len) / Math.sqrt(dist); if (scv > best) { best = scv; fac = e; } });
    const height = fac ? `${fac.label}, côté ${fac.dir} : ${Math.round(fac.h)} m, hauteur ${fac.src}` : '';
    const info = cond + '|' + parts + '|' + where + '|' + height + '|' + (est > 0.55 ? 'dark' : 'light');
    const rt = ptMsg || (ptOn ? (ptReady ? 'Rendu affiné : en attente que tout soit immobile' : 'Rendu affiné : préparation') : '');
    if (info + '|' + rt !== lastInfo) { lastInfo = info + '|' + rt; lastInfoObj = { cond, parts, where, height, light: est <= 0.55, northDeg: (Math.atan2(vF.x, -vF.z) * 180 / Math.PI) }; onInfo({ ...lastInfoObj, rt }); }
  }
  raf = requestAnimationFrame(frame);
  const ro = new ResizeObserver(() => resize()); ro.observe(container);

  function resize() {
    const w = Math.max(2, container.clientWidth), h = Math.max(2, container.clientHeight); if (w === W && h === H) return;
    W = w; H = h; R.setSize(W, H); cam.aspect = W / H; cam.updateProjectionMatrix(); alloc(); dirty = true;
  }
  return {
    setProject({ lat: la, lng: ln, buildings, orientation: ori }) {
      lat = la; lng = ln; projLocal = buildings || []; orientation = ori || [];
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
    setView(v) { if (v.az != null) az = v.az; if (v.camH != null) camH = v.camH; if (v.Rr != null) Rr = v.Rr; dirty = true; },
    setRayTracing(on) { ptEnable(!!on); },
    dispose() {
      running = false; cancelAnimationFrame(raf); ro.disconnect(); clearStatics();
      if (pt) { try { pt.dispose(); } catch (e) { /* déjà libéré */ } pt = null; } if (ptCubes) ptCubes.forEach(c => c.dispose()); ptDisposeOwned();
      [sceneRT, aoRT, aoRT2, compRT, cubeRT, envRT].forEach(r => r && r.dispose()); pmrem.dispose();
      [skyMat, aoMat, blurMat, compMat, brightMat, gblurMat, fxMat, wallMat, roofMat, trunkMat, crownMat, waterMat, cloudMat, ...Object.values(flatMats)].forEach(m => m.dispose());
      [skyGeo, crownGeo, crownGeoLow, trunkGeo, sg, gnd.geometry, quad.geometry].forEach(g => g.dispose()); FT.map.dispose(); FT.rough.dispose(); FT.emis.dispose(); gndTex.dispose(); leafMask.dispose();
      R.dispose(); R.forceContextLoss(); if (el.parentNode) el.parentNode.removeChild(el);
    },
  };
}
