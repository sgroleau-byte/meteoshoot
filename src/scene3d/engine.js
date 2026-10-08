// Vue 3D de la fiche projet: les bâtiments dessinés dans le projet et les environs (voisins avec leur
// hauteur, rues, arbres, parcs, eau), sous le ciel et la lumière d'une heure donnée.
// Le ciel est une seule fonction (nuages bas en cumulus, nuages moyens en couche, nuages hauts en voile,
// soleil plus ou moins voilé) vue par la caméra ET capturée pour éclairer la scène, donc une journée
// grise éclaire gris et un ciel bleu donne des ombres bleutées. Passes d'image: recoins (occlusion
// ambiante), tonalité, lissage des bords.
// Le sol est le relief réel (LiDAR ou modèle d'élévation du Canada, voir terrain.js): rues, parcs et eau y sont drapés,
// bâtiments et arbres posés à la hauteur du terrain, la caméra à hauteur d'oeil sur la pente, et les collines ou
// montagnes jusqu'à 9 km vers le soleil portent leur ombre sur le site.
// Chargé à la demande (import dynamique), three.js ne pèse rien tant que la 3D n'est pas ouverte.
import * as THREE from 'three';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { SAT_CREDIT, satMesh } from './satDrape.js';
RectAreaLightUniformsLib.init(); // tables des lumières surfaciques (façades allumées la nuit)
import SunCalc from 'suncalc';
import { DIRS, centroid, edgesOf, localRings, signedArea } from './footprint.js';
import { TEX_PERIOD, flatTerrain, makeTerrain } from './terrain.js';
import { prisms, fitTree, reachOf, sheetCellBlocked, sheetTriTooClose, LOBE_PARTS, CON_TIERS, CON_TIERS_LOW } from './clearance.js';

// Ombres PCSS (percentage-closer soft shadows) greffées sur le mode d'ombre « de base » de three (carte de profondeur en
// pleine précision, lue directement): pénombre nette au contact et de plus en plus large en s'éloignant de l'objet qui
// porte l'ombre (disque solaire de 0,5°), élargie sous le voile par shadow.radius. Remplace la méthode VSM (profondeur en
// demi-flottants: rayures et fuites de lumière). Constante 0,3056 = plage de profondeur SHADOW_SPAN (10 km) x 2 tan(0,25°) /
// cadre 300 m (caméra d'ombre dans createScene3D), par unité de profondeur normalisée; 0,0224 = profondeur normalisée type
// du sujet (0,46 quand la plage faisait 480 m, ramenée à 10 km) pour le rayon de recherche des objets qui portent l'ombre.
const PCSS_GLSL = `
		float pcssNoise( vec2 p ) { return fract( 52.9829189 * fract( dot( p, vec2( 0.06711056, 0.00583715 ) ) ) ); }
		vec2 pcssVogel( int i, int n, float phi ) { float r = sqrt( ( float( i ) + 0.5 ) / float( n ) ); float t = float( i ) * 2.399963229728653 + phi; return vec2( cos( t ), sin( t ) ) * r; }
		float getShadow( sampler2D shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, float shadowRadius, vec4 shadowCoord ) {
			shadowCoord.xyz /= shadowCoord.w;
			shadowCoord.z += shadowBias;
			bool inFrustum = shadowCoord.x >= 0.0 && shadowCoord.x <= 1.0 && shadowCoord.y >= 0.0 && shadowCoord.y <= 1.0;
			if ( ! inFrustum || shadowCoord.z > 1.0 ) return 1.0;
			float texel = 1.0 / shadowMapSize.x, zR = shadowCoord.z, k = 0.3056 * shadowRadius;
			float phi = pcssNoise( gl_FragCoord.xy ) * 6.2831853;
			float sRad = clamp( k * 0.0224, 2.0 * texel, 0.03 ), bSum = 0.0, bN = 0.0;
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
const SHADOW_SPAN = 10000; // plage de profondeur de la carte d'ombre (mètres vers le soleil): le relief lointain porte son ombre
// Orage et percées de soleil (8 octobre 2026; voir setWeather et frame).
const SUN_ON = 0.2;    // percée: part de l'heure au soleil (direct rapporté au ciel clair) dès laquelle le projet est montré au soleil
const BRK_R = 60;      // rayon minimal (m) du dégagement autour du projet pendant une percée; fixe pour une scène (ne suit pas le zoom)
const BRK_M = 12;      // marge (m) autour des ombres de nuages (pénombre des ombres douces à hauteur d'oeil)
const AMB_CUT = 0.55;  // baisse de la lumière d'ambiance sous une base d'orage (pleine force)
const RAIN_BRK = 0.85; // gouttes retirées pendant une percée (soleil entre les averses; le sol reste mouillé)
const dniClear = (h) => 950 - 710 * Math.exp(-h / 20.2); // direct normal par ciel clair (W/m²) selon la hauteur du soleil (degrés), ICON, Québec, été 2025

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

const SKY_GLSL = `uniform float uCum,uMid,uHigh,uDirect,uWarm,uTw,uNight,uGlow,uTurb,uRay,uSkyK,uZen,uSmoke,uStorm,uSunGap,uGapR;uniform vec3 uSun,uSunCol;varying vec3 vDir;
const vec3 LUMW=vec3(0.2126,0.7152,0.0722);
// Ciel clair de Preetham (modèle analytique de lumière du jour, comme Sky.js de three): diffusion de Rayleigh (bleu du ciel) et de
// Mie (halo blanc autour du soleil, brume à l'horizon), extinction Fex le long du rayon. uTurb = turbidité (brume), uRay = part
// de Rayleigh, uSkyK = échelle vers notre exposition.
const vec3 TR=vec3(5.804542996261093e-6,1.3562911419845635e-5,3.0265902468824876e-5);
const vec3 MC=vec3(1.8399918514433978e14,2.7798023919660528e14,4.0790479543861094e14);
float sunE(float y){y=clamp(y,-1.0,1.0);return 1000.0*max(0.0,1.0-exp(-((1.6110731556870734-acos(y))/1.5)));}
vec3 preetham(vec3 dir,vec3 sd,out vec3 Fex){vec3 bR=TR*uRay,bM=0.434*(0.2*uTurb)*1e-17*MC*0.005;
float za=acos(max(0.12,dir.y));/* épaisseur bornée: sous 7° d'élévation le ciel garde la couleur de 7° (pas de bande claire à l'horizon) */float inv=1.0/(cos(za)+0.15*pow(93.885-za*57.29578,-1.253));Fex=exp(-(bR*8400.0*inv+bM*1250.0*inv));
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
vec3 Fx,FxH;vec3 preP=preetham(rd,sd,Fx);
// Ciel clair: chromaticité du modèle physique adoucie (la diffusion seule est trop saturée: « bleu flashy »), luminance
// dessinée (zénith uZen selon la hauteur du soleil, horizon 2,4 fois plus clair, blanc de brume vers le bas) et halo de
// Mie autour du soleil. Sans ce calage, la radiance physique sature en blanc dès 30° d'élévation (« ciel gris ») et
// s'effondre au lever (« ciel noir »).
float yy=clamp(y,0.0,1.0);float lp=max(dot(preP,LUMW),1e-6);vec3 chroma=mix(preP/lp,vec3(1.0),0.35+0.35*pow(1.0-yy,2.0));
float Lsky=uZen*(1.0+1.4*pow(1.0-yy,2.2))*(1.0+0.6*pow(max(cg,0.0),6.0)+1.5*pow(max(cg,0.0),40.0));
vec3 preL=chroma*Lsky;preL/=1.0+0.5*dot(preL,LUMW);vec3 col=pow(max(preL,vec3(0.0)),vec3(1.0/2.2));
vec3 horP=preetham(normalize(vec3(rd.x,0.04,rd.z)),sd,FxH);float lh=max(dot(horP,LUMW),1e-6);vec3 horL=mix(horP/lh,vec3(1.0),0.7)*uZen*2.4;horL/=1.0+0.5*dot(horL,LUMW);vec3 hor=pow(max(horL,vec3(0.0)),vec3(1.0/2.2));
float thick=1.0-uDirect;float blur=0.004+0.02*thick*veil;float disc=smoothstep(cos(0.014+blur),cos(0.010),cg)*step(0.0,y+0.002);
/* Trouée autour du soleil (8 octobre 2026): ouverte quand la caméra est au soleil, refermée quand un nuage l'ombrage (uSunGap +1 ou -1), bord irrégulier. */
float ga=acos(clamp(cg,-1.0,1.0)),gR=uGapR*(0.7+0.6*noise(rd.xz/(max(y,0.0)+0.08)*9.0)),gp=1.0-smoothstep(0.35*gR,gR,ga),gpo=max(uSunGap,0.0)*gp;disc*=1.0-max(-uSunGap,0.0);
float dC=0.0,aMidG=0.0,aHighG=0.0;vec3 cC=vec3(0.0);
if(y>0.0){vec2 p=rd.xz/(y+0.08)*0.55;float n=fbm(p,lod)*0.74+fbm(p*2.7+vec2(5.0,9.0),lod)*0.26;float th=0.5+(0.5-uCum)*0.62;th-=0.18*uStorm*(1.0-smoothstep(0.15,0.6,y));th+=gp*uSunGap*(uSunGap>0.0?0.5:0.4);float sw=0.09+0.14*(1.0-lod);
dC=smoothstep(th,th+sw,n)*smoothstep(0.0,0.10,y)*step(0.02,uCum);dC*=1.0-gpo;dC=max(dC,max(-uSunGap,0.0)*gp*smoothstep(0.0,0.03,y));
float n2=fbm(p+normalize(sd.xz+vec2(1e-4))*0.12,lod);float dep=smoothstep(th,th+0.30,n);float lit=clamp(0.55+(n-n2)*5.0-0.65*uStorm*dep,0.0,1.0);
vec3 shd=mix(vec3(0.50,0.54,0.60),vec3(0.30,0.34,0.39)*(1.0-0.25*dep),uStorm),li=mix(vec3(1.0),uSunCol,0.55);cC=mix(shd,li,lit)*(1.0-0.22*(1.0-uStorm)*smoothstep(0.62,0.85,n));cC=mix(cC,hor,0.5*(1.0-0.85*uStorm)*(1.0-smoothstep(0.0,0.25,y)));}
col+=uSunCol*disc*2.0*(1.0-dC);col+=uSunCol*pow(max(cg,0.0),40.0)*dC*(1.0-dC)*1.6;col=mix(col,cC,dC);
if(uMid>0.01){float yy=max(y,0.0);vec2 pm=rd.xz/(yy+0.07)*0.42;float nm=fbm(pm*0.9+vec2(3.1,7.7),lod);float cov=smoothstep(0.62-0.5*uMid,0.72,nm+0.1*uMid);
float a=uMid*mix(0.45*cov,0.96,max(thick*thick,0.75*uStorm))*(1.0-gpo*uStorm);aMidG=a;vec3 mc=mix(vec3(0.80,0.82,0.85),vec3(0.58,0.60,0.64),thick);mc=mix(mc,vec3(0.86,0.70,0.58),uWarm*0.45);mc*=1.0-0.12*smoothstep(0.7,0.95,nm);mc=mix(mc,vec3(0.33,0.36,0.41),0.8*uStorm);
mc+=uSunCol*(0.35*pow(max(cg,0.0),8.0))*uDirect;col=mix(col,mc,a*(1.0-dC));}
if(uHigh>0.01){float yy=max(y,0.0);vec2 pv=rd.xz/(yy+0.05)*0.3;vec2 pr=vec2(pv.x*0.35+pv.y*0.25,pv.y*1.9-pv.x*0.5);float nv=fbm(pr*1.3,lod);
float a=uHigh*mix(0.18+0.55*smoothstep(0.35,0.75,nv),0.97,thick*thick);aHighG=a;
vec3 vc=mix(vec3(0.88,0.89,0.90),vec3(0.64,0.66,0.69),thick);vc=mix(vc,mix(vec3(0.62,0.62,0.66),vec3(0.95,0.72,0.55),0.6),uWarm*0.5);vc=mix(vc,vec3(0.48,0.51,0.55),0.5*uStorm);
vc+=uSunCol*(0.55*pow(max(cg,0.0),6.0)+0.25*pow(max(cg,0.0),60.0))*uDirect;
float halo=exp(-pow((acos(clamp(cg,-1.0,1.0))-0.384)/0.012,2.0))*smoothstep(0.25,0.5,uDirect)*(1.0-uDirect)*0.5;
col=mix(col,vc,a*(1.0-dC))+halo*uHigh*vec3(0.9,0.88,0.85)*0.35;}
col+=vec3(1.0,0.96,0.88)*disc*veil*uDirect*1.2*(1.0-dC);
// Sous un ciel couvert, l'horizon n'est pas clair: les nuages lointains se superposent jusqu'au sol (sinon une bande
// pâle de ciel clair apparaît sous la couche sombre, là où les cumulus s'estompent).
float hz=1.0-smoothstep(0.0,0.14,y);vec3 hzc=mix(vec3(0.50,0.54,0.60),hor,0.3)*(1.0-0.25*thick);hzc=mix(hzc*(1.0-0.35*uStorm),hor,0.55*uStorm*(1.0-smoothstep(0.70,0.95,uCum)));
col=mix(col,hzc,smoothstep(0.25,0.85,uCum)*hz*0.92*(1.0-gpo));
if(y<0.0){col=mix(col,hor*vec3(0.52,0.55,0.46),smoothstep(0.0,-0.08,y));}
// Heure bleue puis nuit: dégradé bleu profond, lueur chaude seulement à l'horizon côté soleil, nuages en silhouette.
vec3 bh=mix(vec3(0.11,0.24,0.50),vec3(0.03,0.07,0.21),t);
vec2 sh=normalize(sd.xz+vec2(1e-4));float cgh=max(dot(normalize(rd.xz+vec2(1e-4)),sh),0.0);
bh*=0.72+0.55*cgh*(1.0-0.7*t);
bh=mix(bh,vec3(0.92,0.52,0.30),pow(cgh,3.0)*pow(1.0-clamp(y*4.0,0.0,1.0),2.0)*uGlow*0.6);
vec3 night=mix(vec3(0.045,0.07,0.16),vec3(0.016,0.03,0.09),t)*(0.8+0.3*cgh*(1.0-0.7*t));
vec3 tw=mix(bh,night,uNight)*(1.0-0.45*dC-0.25*aMidG-0.15*aHighG);
col=mix(col,tw,uTw);
col=mix(col,dot(col,LUMW)*vec3(1.12,0.9,0.66),uSmoke*0.75)*(1.0-0.2*uSmoke);
col=pow(max(col,0.0),vec3(2.2));
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
// Flou vertical du reflet des flaques: moyenne des seuls voisins mouillés (poids dans l'alpha), remise au poids du pixel
// lui-même: le reflet ne déborde pas sur le gazon ni sur les murs voisins.
const RBLUR_FRAG = `uniform sampler2D tSrc;uniform vec2 uDir;varying vec2 vUv;void main(){vec4 c0=texture2D(tSrc,vUv);if(c0.a<=0.0){gl_FragColor=vec4(0.0);return;}float w[5];w[0]=0.227;w[1]=0.195;w[2]=0.122;w[3]=0.054;w[4]=0.016;vec4 s=c0*w[0];for(int i=1;i<5;i++){s+=texture2D(tSrc,vUv+uDir*float(i))*w[i];s+=texture2D(tSrc,vUv-uDir*float(i))*w[i];}gl_FragColor=vec4(s.rgb/max(s.a,1e-4)*c0.a,c0.a);}`;
const GBLUR_FRAG = `uniform sampler2D tSrc;uniform vec2 uDir;varying vec2 vUv;void main(){float w[5];w[0]=0.227;w[1]=0.195;w[2]=0.122;w[3]=0.054;w[4]=0.016;vec3 s=texture2D(tSrc,vUv).rgb*w[0];for(int i=1;i<5;i++){s+=texture2D(tSrc,vUv+uDir*float(i)).rgb*w[i];s+=texture2D(tSrc,vUv-uDir*float(i)).rgb*w[i];}gl_FragColor=vec4(s,1.0);}`;
// Reflet des flaques (octobre 2026, seulement après beaucoup de pluie: voir setWeather), à demi-résolution: pour chaque pixel tourné vers le ciel et marqué réfléchissant
// par son matériau (alpha de l'image de la scène: asphalte, trottoir, toit plat), un rayon part en miroir de la vue et avance dans la
// profondeur de la scène; là où il touche un objet (façade, arbre, fenêtre allumée), on garde sa couleur, affaiblie par
// le facteur de Fresnel (fort en vue rasante); un rayon qui ne touche rien, qui sort du cadre ou qui va loin reflète le
// ciel (carte cubique déjà rendue pour l'éclairage), sinon les bâtiments reflétés sortiraient plus clairs que le ciel.
// Sur une rue en pente, si le miroir vertical plongerait sous le sol, on prend la normale de la surface; un impact sur
// un sol (surface tournée vers le ciel) à peine au-dessus du sol de départ n'est que le même sol plus loin (bosse du
// relief): on garde le ciel. Une façade touchée est toujours gardée, même loin. L'eau forme des
// flaques par plaques (bruit dans le plan du sol, en mètres), de 30 % de la surface à 75 % sous très forte pluie.
// Sortie prémultipliée (couleur fois poids, poids). Seulement quand le sol est mouillé, et seulement aux images complètes.
// Le départ de chaque rayon est décalé d'une fraction de pas, au hasard par pixel (un motif régulier laisserait des bandes).
const REFL_FRAG = `uniform sampler2D tCol,tDepth;uniform samplerCube tSky;uniform mat4 uProj,uProjInv;uniform mat3 uV2W;uniform vec3 uUp,uCamW;uniform vec2 uTx;uniform float uPud;varying vec2 vUv;
float hh(vec2 i){return fract(sin(dot(i,vec2(127.1,311.7)))*43758.5453);}
float vn(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);return mix(mix(hh(i),hh(i+vec2(1.0,0.0)),f.x),mix(hh(i+vec2(0.0,1.0)),hh(i+vec2(1.0,1.0)),f.x),f.y);}
vec3 vp(vec2 uv){float z=texture2D(tDepth,uv).x;vec4 c=uProjInv*vec4(uv*2.0-1.0,z*2.0-1.0,1.0);return c.xyz/c.w;}
vec2 sp(vec3 q){vec4 c=uProj*vec4(q,1.0);return c.xy/c.w*0.5+0.5;}
vec3 nrm(vec2 uv){vec3 c=vp(uv),a=vp(uv+vec2(uTx.x,0.0)),b=vp(uv-vec2(uTx.x,0.0)),e=vp(uv+vec2(0.0,uTx.y)),f=vp(uv-vec2(0.0,uTx.y));vec3 dx=length(a-c)<length(c-b)?a-c:c-b,dy=length(e-c)<length(c-f)?e-c:c-f;vec3 m=normalize(cross(dx,dy));return dot(m,c)>0.0?-m:m;}
void main(){gl_FragColor=vec4(0.0);float z0=texture2D(tDepth,vUv).x;if(z0>=0.99999)return;
vec3 P=vp(vUv),Px1=vp(vUv+vec2(uTx.x,0.0)),Px2=vp(vUv-vec2(uTx.x,0.0)),Py1=vp(vUv+vec2(0.0,uTx.y)),Py2=vp(vUv-vec2(0.0,uTx.y));
vec3 dx=length(Px1-P)<length(P-Px2)?Px1-P:P-Px2;vec3 dy=length(Py1-P)<length(P-Py2)?Py1-P:P-Py2;vec3 n=normalize(cross(dx,dy));if(dot(n,P)>0.0)n=-n;
float upW=smoothstep(0.8,0.92,dot(n,uUp));if(upW<=0.0)return;
float paved=clamp(texture2D(tCol,vUv).a,0.0,1.0)*upW;if(paved<=0.0)return;
vec2 xz=(uV2W*P+uCamW).xz;float nz=0.65*vn(xz/7.0)+0.35*vn(xz/2.0),cov=mix(0.3,0.75,uPud);paved*=smoothstep(1.0-cov,1.12-cov,nz);if(paved<=0.0)return;
vec3 V=normalize(P),Rd=reflect(V,uUp);if(dot(Rd,n)<=0.0)Rd=reflect(V,n);
float fres=0.04+0.96*pow(1.0-clamp(dot(-V,uUp),0.0,1.0),5.0),w=fres*paved;
vec3 sky=textureCube(tSky,uV2W*Rd).rgb;gl_FragColor=vec4(sky*w,w);
float st=0.15-P.z*0.012;vec3 Q=P+n*(0.01-0.001*P.z)+Rd*st*hh(gl_FragCoord.xy),Qp=Q;bool hit=false;
for(int i=0;i<28;i++){Qp=Q;Q+=Rd*st;st*=1.12;vec2 uv=sp(Q);if(uv.x<0.0||uv.x>1.0||uv.y<0.0||uv.y>1.0)break;
float d=vp(uv).z-Q.z;if(d>0.0&&d<max(1.5,st*1.5)){hit=true;break;}}
if(!hit)return;
for(int i=0;i<5;i++){vec3 m=(Qp+Q)*0.5;if(vp(sp(m)).z-m.z>0.0)Q=m;else Qp=m;}
vec2 h=sp(Q);if(texture2D(tDepth,h).x>=0.99999)return;
if(dot(nrm(h),uUp)>0.7&&dot(Q-P,n)<0.05*length(Q-P)+0.05)return;
float k=smoothstep(0.0,0.1,min(min(h.x,1.0-h.x),min(h.y,1.0-h.y)))*smoothstep(80.0,20.0,length(Q-P));
gl_FragColor=vec4(mix(sky,texture2D(tCol,h).rgb,k)*w,w);}`;
// Composition: recoins, lueur des fenêtres, flare du soleil bas, tonalité (ACES) et gamma, avec un léger bruit contre les bandes.
// Flare « photo de drone » quand le soleil est bas: halo serré (presque blanc), lueur moyenne et voile large (couleur du
// soleil) qui relève les noirs de toute l'image, étoile de 16 branches quand le disque est visible. La visibilité du disque
// est lue dans la profondeur (le ciel laisse la profondeur vide) sur un petit disque autour du soleil: derrière une crête, un
// bâtiment ou des arbres, l'étoile s'éteint et le voile ne garde qu'une part (lumière diffusée par l'air). Soleil hors cadre:
// uVis (relief seulement, calculé dans frame). uFlare, uRays et uVeilW viennent de la hauteur du soleil et de la météo.
// Bleu du ciel désaturé à l'heure bleue et la nuit (réglage Photoshop de Stéphane, Teinte/Saturation: teinte -3, saturation
// -24): appliqué sur l'image finale, au ciel et au lointain pris dans le brouillard (part du brouillard lue dans la
// profondeur), aux tons bleus seulement (lueur du couchant, fenêtres et lampadaires intacts); uDs = 0 le jour.
// Pluie (octobre 2026): traînées de gouttes dessinées sur l'image finale, en cinq nappes de 2,5 à 40 m de la caméra; une
// nappe est cachée là où un objet plus proche la masque (profondeur). Longueur, largeur et vitesse à l'écran suivent la
// distance (chute d'environ 9 m/s, pose d'environ 1/50 s); uRain règle le nombre de gouttes, uRainCol leur teinte (un peu
// plus claire que l'horizon). Seule cette passe est refaite à chaque image quand il pleut et que rien d'autre ne bouge.
// uTime boucle sur 60 s: chaque nappe avance alors d'exactement 1000 rangées de cellules (vitesse 9 m/s, cellule de
// 0,54 m), et le hachage lit la rangée modulo 1000: bouclage invisible. Un temps sans fin perdrait sa précision (nombres
// à 32 bits) et, après une vingtaine de minutes, les gouttes s'aligneraient en colonnes identiques.
// Brouillard et brume (octobre 2026): extinction uFogSig (1/m, d'après la visibilité prévue) sous le haut de la nappe
// uFogTop (hauteur dans la scène: sol du projet plus l'épaisseur prévue, 600 m sans nappe mesurée; bord adouci sur 25 m). On mesure la
// longueur de chaque rayon de vue passée sous ce niveau: d'en haut (drone), on voit la nappe et ce qui en sort; dedans,
// le lointain et le ciel disparaissent. Appliqué avant la lueur des fenêtres et le flare (leurs halos restent visibles).
// Même calcul pour la fumée de feux (uSmk*): voile brun-orangé épais de 2500 m, extinction d'après la fumée au sol.
// Sous la fumée, le soleil reste un disque net (uSunDisc, rayon uSunR): la fumée absorbe plus le bleu que le rouge, il
// rougit, et ne s'éteint qu'au ras de l'horizon; dessiné seulement sur le ciel (un relief ou un bâtiment le cache).
// Reflet des flaques (reflRT, déjà flouté à la verticale dans frame: une flaque troublée par la pluie ne fait pas un
// miroir net, et les traînées de nuages près de l'horizon s'y fondent) ajouté tel quel.
const COMP_FRAG = `uniform sampler2D tCol,tAO,tBloom,tDepth;uniform float uExp,uAO,uBloom,uAspect,uFlare,uRays,uVeilW,uVis,uDs,uRain,uTime,uFocal,uSlant,uRefl,uFogSig,uFogTop,uSmkSig,uSmkTop,uSunR;uniform vec2 uSunUV,uFog,uNF;uniform vec3 uSunC,uRainCol,uFogCol,uSmkCol,uCamW,uSunDisc;uniform mat3 uV2W;uniform mat4 uProjInv;uniform sampler2D tRefl;varying vec2 vUv;
vec3 lfog(vec3 c,float sig,float top,vec3 col){if(sig<=0.0)return c;float z=texture2D(tDepth,vUv).x;vec4 pv=uProjInv*vec4(vUv*2.0-1.0,z*2.0-1.0,1.0);vec3 P=pv.xyz/pv.w;
vec3 d=uV2W*normalize(P);float dist=z>=0.99999?1e5:length(P);float hc=uCamW.y,hp=hc+d.y*dist,lo=min(hc,hp),hi=max(hc,hp),sp=max(hi-lo,1e-3);
float L=dist*0.5*(clamp((top-lo)/sp,0.0,1.0)+clamp((top+25.0-lo)/sp,0.0,1.0));return mix(c,col,1.0-exp(-sig*L));}
float lz(float z){return (2.0*uNF.x*uNF.y)/(uNF.y+uNF.x-(2.0*z-1.0)*(uNF.y-uNF.x));}
float h21(vec2 p){p=fract(p*vec2(123.34,456.21));p+=dot(p,p+45.32);return fract(p.x*p.y);}
float drops(vec2 px,float D,float zs,float sd){if(zs<D)return 0.0;
float L=0.18*uFocal/D,wd=max(1.0,0.004*uFocal/D),cw=max(4.0,0.2*uFocal/D),ch=L*3.0;
vec2 q=vec2(px.x+px.y*uSlant,px.y+uTime*9.0*uFocal/D);vec2 cell=floor(q/vec2(cw,ch));vec2 f=q-cell*vec2(cw,ch);
vec2 hc=vec2(cell.x,cell.y>=1000.0?cell.y-1000.0:cell.y)+sd;
if(h21(hc)>0.05+0.9*uRain)return 0.0;
float x0=(0.15+0.7*h21(hc+7.1))*cw,t=(f.y-h21(hc+3.3)*(ch-L))/L;
if(t<0.0||t>1.0)return 0.0;return smoothstep(wd,0.0,abs(f.x-x0))*sin(t*3.14159);}
vec3 rain(vec3 g){if(uRain<=0.0)return g;float z=texture2D(tDepth,vUv).x,zs=z>=0.99999?1e9:lz(z);vec2 px=gl_FragCoord.xy;
float a=drops(px,2.5,zs,1.0)*0.55+drops(px,5.0,zs,2.0)*0.5+drops(px,10.0,zs,3.0)*0.42+drops(px,20.0,zs,4.0)*0.34+drops(px,40.0,zs,5.0)*0.26;
return mix(g,uRainCol,clamp(a*(0.55+0.45*uRain),0.0,1.0));}
vec3 rgb2hsl(vec3 c){float mx=max(c.r,max(c.g,c.b)),mn=min(c.r,min(c.g,c.b)),l=(mx+mn)*0.5,d=mx-mn;if(d<1e-5)return vec3(0.0,0.0,l);
float h=mx==c.r?mod((c.g-c.b)/d,6.0):mx==c.g?(c.b-c.r)/d+2.0:(c.r-c.g)/d+4.0;return vec3(h/6.0,d/(1.0-abs(2.0*l-1.0)),l);}
vec3 hsl2rgb(vec3 h){vec3 k=clamp(abs(mod(h.x*6.0+vec3(0.0,4.0,2.0),6.0)-3.0)-1.0,0.0,1.0);return h.z+h.y*(k-0.5)*(1.0-abs(2.0*h.z-1.0));}
vec3 desat(vec3 g){if(uDs<=0.0)return g;float z=texture2D(tDepth,vUv).x;
float w=z>=0.99999?1.0:smoothstep(uFog.x,uFog.y,lz(z));
vec3 h=rgb2hsl(g);float hd=h.x*360.0;w*=uDs*smoothstep(140.0,165.0,hd)*(1.0-smoothstep(285.0,310.0,hd));if(w<=0.0)return g;
h.x=fract(h.x-3.0/360.0);h.y*=0.76;return mix(g,hsl2rgb(h),w);}
vec3 aces(vec3 x){x*=uExp/0.6;return clamp((x*(2.51*x+0.03))/(x*(2.43*x+0.59)+0.14),0.0,1.0);}
float ign(vec2 p){return fract(52.9829189*fract(0.06711056*p.x+0.00583715*p.y));}
vec3 flare(){if(uFlare<=0.0)return vec3(0.0);
vec2 q=(vUv-uSunUV)*vec2(uAspect,1.0);float d=length(q),vis=uVis;
if(uSunUV.x>0.0&&uSunUV.x<1.0&&uSunUV.y>0.0&&uSunUV.y<1.0){float v=0.0;for(int i=0;i<12;i++){float r=sqrt((float(i)+0.5)/12.0),a=float(i)*2.39996;v+=step(0.99999,texture2D(tDepth,uSunUV+vec2(cos(a)/uAspect,sin(a))*r*0.014).x);}vis=v/12.0;}
vec3 warm=uSunC*vec3(1.0,0.76,0.5),core=mix(uSunC,vec3(1.0),0.55);float w=uVeilW;
float hCore=exp(-pow(d/(0.05*w),1.3)),hMid=exp(-d/(0.15*w)),hWide=1.0/(1.0+pow(d/0.5,2.0));
vec3 f=core*hCore*1.8*vis+warm*hMid*0.5*(0.3+0.7*vis)+warm*hWide*0.085*(0.5+0.5*vis);
float a=atan(q.y,q.x),r1=pow(abs(cos(4.0*a+0.2)),110.0),r2=0.5*pow(abs(cos(4.0*a+0.5927)),140.0);
float rays=(r1+r2)*(0.65+0.35*cos(3.0*a+1.7))*exp(-d/0.17)*smoothstep(0.0,0.02,d);
f+=core*rays*0.7*uRays*vis*vis;return f*uFlare*(0.6/uExp);}
void main(){vec3 c=texture2D(tCol,vUv).rgb;float ao=texture2D(tAO,vUv).r;c*=mix(1.0,ao,uAO);
if(uRefl>0.0){float zr=texture2D(tDepth,vUv).x;c+=texture2D(tRefl,vUv).rgb*uRefl*(1.0-smoothstep(uFog.x,uFog.y,lz(zr)));}c=lfog(c,uFogSig,uFogTop,uFogCol);c=lfog(c,uSmkSig,uSmkTop,uSmkCol);
if(uSunR>0.0&&texture2D(tDepth,vUv).x>=0.99999)c+=uSunDisc*smoothstep(uSunR,uSunR*0.8,length((vUv-uSunUV)*vec2(uAspect,1.0)));
c+=texture2D(tBloom,vUv).rgb*uBloom;c+=flare();c=aces(c);gl_FragColor=vec4(rain(desat(pow(c,vec3(1.0/2.2))))+(ign(gl_FragCoord.xy)-0.5)/255.0,1.0);}`;

const PAL_RES = ['#8f4e3a', '#a0624c', '#7a4a3a', '#b07d5e', '#9c7a62', '#6e5a50', '#b8957a', '#d2c2a4', '#8c6b58'];
const ROOF = ['#57524d', '#5d5a55', '#514e4a', '#625e58'];
const TREE_PAL = ['#c4652b', '#d08a2e', '#b8973a', '#8e8f3e', '#6f8540', '#5b7a3a', '#a9552b', '#d9a441', '#7d8c3c'];
const CONIFER_PAL = ['#2f4a33', '#3a5638', '#33503a', '#445e3c']; // sapins, épinettes, pins: vert foncé toute l'année
const GC = { park: '#66784d', pitch: '#5d8a47', play: '#b8a88e', grass: '#6f8552' };
// ---- géométrie 2D (x est, n nord); signedArea, centroid et les lettres des volumes viennent de footprint.js
function pointInRing(p, r) { let inside = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const a = r[i], b = r[j]; if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside; } return inside; }
function segsCross(a, b, c, d) { const o = (p, q, r) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])); return o(a, b, c) !== o(a, b, d) && o(c, d, a) !== o(c, d, b); }
// Surfaces pavées d'après l'imagerie (contours tracés sur une grille de 0,4 m, marches de 2 à 3 m): mise au net en
// polygones aux côtés droits. 1) rééchantillonnage au mètre et moyenne glissante sur ±4 m (efface les marches);
// 2) Douglas-Peucker à 1,2 m (segments droits); 3) directions dominantes (histogramme des angles modulo 180°, cases de
// 5°, pondéré par la longueur; pics portant au moins 10 % du périmètre ou 12 m; la perpendiculaire de la principale est
// ajoutée); 4) chaque côté à moins de 12° d'une direction dominante y est aligné; 5) côtés consécutifs presque
// parallèles (< 15°) fusionnés; 6) sommets = intersections des côtés voisins (jonction par projection si l'intersection
// part trop loin). Les formes restent approximatives (voir docs/vue-3d.md), mais nettes plutôt qu'organiques.
function smoothRing(r, step = 1, half = 4) {
  if (r.length < 3) return r;
  const pts = [];
  for (let i = 0; i < r.length; i++) { const a = r[i], b = r[(i + 1) % r.length]; const l = Math.hypot(b[0] - a[0], b[1] - a[1]); const n = Math.max(1, Math.round(l / step)); for (let k = 0; k < n; k++) { const t = k / n; pts.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]); } }
  const N = pts.length; if (N < 8) return r;
  const w = Math.min(Math.round(half / step), Math.floor((N - 1) / 2)), out = [];
  for (let i = 0; i < N; i++) { let x = 0, n = 0; for (let k = -w; k <= w; k++) { const q = pts[(i + k + N) % N]; x += q[0]; n += q[1]; } out.push([x / (2 * w + 1), n / (2 * w + 1)]); }
  return out;
}
const segDist = (p, a, b) => { const dx = b[0] - a[0], dn = b[1] - a[1], l2 = dx * dx + dn * dn || 1e-9; const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dn) / l2)); return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dn); };
function dpClosed(r, eps) { // Douglas-Peucker sur un contour fermé (coupé au point le plus éloigné du premier)
  const n = r.length; if (n < 4) return r;
  let far = 1, fd = 0; for (let i = 1; i < n; i++) { const d = Math.hypot(r[i][0] - r[0][0], r[i][1] - r[0][1]); if (d > fd) { fd = d; far = i; } }
  const pts = r.concat([r[0]]), keep = new Uint8Array(n + 1); keep[0] = keep[far] = keep[n] = 1;
  const st = [[0, far], [far, n]];
  while (st.length) { const [a, b] = st.pop(); let best = 0, bi = -1; for (let k = a + 1; k < b; k++) { const d = segDist(pts[k], pts[a], pts[b]); if (d > best) { best = d; bi = k; } } if (best > eps) { keep[bi] = 1; st.push([a, bi], [bi, b]); } }
  const out = []; for (let i = 0; i < n; i++) if (keep[i]) out.push(r[i]); return out;
}
const angDiff = (a, b) => { const d = Math.abs(a - b) % 180; return Math.min(d, 180 - d); };
const meanAng = (items) => { let x = 0, y = 0; items.forEach(([a, w]) => { x += Math.cos(2 * a * Math.PI / 180) * w; y += Math.sin(2 * a * Math.PI / 180) * w; }); return ((Math.atan2(y, x) * 180 / Math.PI) / 2 + 180) % 180; };
function regularizeRing(r, eps = 1.2, tol = 12) {
  const P = dpClosed(smoothRing(r), eps), n = P.length; if (n < 3) return r;
  const ang = [], len = []; let total = 0;
  for (let i = 0; i < n; i++) { const a = P[i], b = P[(i + 1) % n]; const dx = b[0] - a[0], dn = b[1] - a[1], l = Math.hypot(dx, dn); len.push(l); total += l; ang.push(((Math.atan2(dn, dx) * 180 / Math.PI) % 180 + 180) % 180); }
  const bins = Array.from({ length: 36 }, () => []); for (let i = 0; i < n; i++) bins[Math.floor(ang[i] / 5) % 36].push([ang[i], len[i]]);
  const w = bins.map(b => b.reduce((s, x) => s + x[1], 0)), sm = w.map((v, i) => v + w[(i + 35) % 36] + w[(i + 1) % 36]);
  const dirs = [];
  for (let i = 0; i < 36; i++) if (sm[i] >= sm[(i + 35) % 36] && sm[i] > sm[(i + 1) % 36] && sm[i] >= Math.max(12, total * 0.1)) dirs.push({ th: meanAng([...bins[(i + 35) % 36], ...bins[i], ...bins[(i + 1) % 36]]), w: sm[i] });
  if (!dirs.length) return P;
  dirs.sort((a, b) => b.w - a.w); const perp = (dirs[0].th + 90) % 180; if (!dirs.some(d => angDiff(d.th, perp) < tol)) dirs.push({ th: perp, w: 0 });
  const lines = [];
  for (let i = 0; i < n; i++) {
    let th = ang[i], bd = tol; dirs.forEach(d => { const dd = angDiff(ang[i], d.th); if (dd < bd) { bd = dd; th = d.th; } });
    const a = P[i], b = P[(i + 1) % n]; lines.push({ x: (a[0] + b[0]) / 2, n: (a[1] + b[1]) / 2, th, len: len[i], i1: (i + 1) % n, parts: [[th, len[i]]] });
  }
  let changed = true;
  while (changed && lines.length > 3) {
    changed = false;
    for (let i = 0; i < lines.length && lines.length > 3; i++) {
      const A = lines[i], B = lines[(i + 1) % lines.length]; if (angDiff(A.th, B.th) >= 15) continue;
      const wt = A.len + B.len; A.x = (A.x * A.len + B.x * B.len) / wt; A.n = (A.n * A.len + B.n * B.len) / wt; A.parts = A.parts.concat(B.parts); A.th = meanAng(A.parts); A.len = wt; A.i1 = B.i1;
      lines.splice((i + 1) % lines.length, 1); changed = true; break;
    }
  }
  if (lines.length < 3) return P;
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const A = lines[i], B = lines[(i + 1) % lines.length], V = P[A.i1];
    const ta = A.th * Math.PI / 180, tb = B.th * Math.PI / 180, ax = Math.cos(ta), an = Math.sin(ta), bx = Math.cos(tb), bn = Math.sin(tb), det = ax * bn - an * bx;
    let ok = false;
    if (Math.abs(det) > 1e-6) { const t = ((B.x - A.x) * bn - (B.n - A.n) * bx) / det, px = A.x + ax * t, pn = A.n + an * t; if (Math.hypot(px - V[0], pn - V[1]) <= Math.max(6, 0.75 * Math.max(A.len, B.len))) { out.push([px, pn]); ok = true; } }
    if (!ok) { const pa = (V[0] - A.x) * ax + (V[1] - A.n) * an, pb = (V[0] - B.x) * bx + (V[1] - B.n) * bn; out.push([A.x + ax * pa, A.n + an * pa], [B.x + bx * pb, B.n + bn * pb]); }
  }
  const res = []; for (const p of out) { const q = res[res.length - 1]; if (!q || Math.hypot(p[0] - q[0], p[1] - q[1]) > 0.4) res.push(p); }
  if (res.length > 3 && Math.hypot(res[0][0] - res[res.length - 1][0], res[0][1] - res[res.length - 1][1]) <= 0.4) res.pop();
  return res.length >= 3 ? res : P;
}
function segHitsRing(a, b, r) { if (pointInRing(a, r) || pointInRing(b, r)) return true; for (let i = 0; i < r.length; i++) if (segsCross(a, b, r[i], r[(i + 1) % r.length])) return true; return false; }
function ringsOverlap(a, b) { if (pointInRing(centroid(a), b) || pointInRing(centroid(b), a)) return true; if (a.some(p => pointInRing(p, b)) || b.some(p => pointInRing(p, a))) return true; for (let i = 0; i < a.length; i++) for (let j = 0; j < b.length; j++) if (segsCross(a[i], a[(i + 1) % a.length], b[j], b[(j + 1) % b.length])) return true; return false; }

// Tuile de façade (une travée sur un étage): fenêtre moderne, plus large que haute, cadre fin anthracite, un seul
// meneau décalé au tiers, verre sombre et réfléchissant; carte de rugosité (verre lisse) et carte d'émission
// (fenêtre allumée la nuit, lueur douce). La tuile se répète un nombre entier de fois par mur (voir blocks).
// Version de jour (mapDay, 7 octobre 2026): les fenêtres ne sont pas celles du vrai bâtiment, donc discrètes le jour:
// un simple vitrage à peine plus foncé que le mur, dans sa teinte, sans cadre ni reflet. Le matériau passe de l'une
// à l'autre avec la tombée du jour (uNight): la nuit reste exactement comme avant.
const WIN_DAY = '#cfcdc9'; // vitrage de jour: environ 80 % de la teinte du mur
const LAMP_LIGHT = 0.5; // force de la lumière des lampadaires sur le sol, les murs et les arbres, la nuit
const LAMP_SIGMA = 12; // m: étalement de la lumière d'un lampadaire (diffuse: les voisins se fondent le long des rues)
const LAMP_HALF = 460, LAMP_N = 512; // carte de lumière des lampadaires: ±460 m autour du projet, 1,8 m par case
const CITY_FILL = 0.07; // lumière d'ambiance ajoutée la nuit en ville (rebond des rues éclairées)
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
  z.save(); z.shadowColor = '#ffd9a0'; z.shadowBlur = 40; z.globalAlpha = 0.4; z.fillStyle = '#ffd9a0'; z.fillRect(wx, wy, ww, wh); z.restore();
  z.fillStyle = '#ffe2b0'; z.fillRect(wx, wy, ww, wh); z.fillStyle = '#3a3226'; z.fillRect(mull - 2, wy, 4, wh);
  const dc = document.createElement('canvas'); dc.width = dc.height = 256; const dx = dc.getContext('2d');
  dx.fillStyle = '#ffffff'; dx.fillRect(0, 0, 256, 256); dx.fillStyle = WIN_DAY; dx.fillRect(wx, wy, ww, wh);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  const dt = new THREE.CanvasTexture(dc); dt.wrapS = dt.wrapT = THREE.RepeatWrapping; dt.colorSpace = THREE.SRGBColorSpace; dt.anisotropy = 8;
  const rt = new THREE.CanvasTexture(r); rt.wrapS = rt.wrapT = THREE.RepeatWrapping;
  const et = new THREE.CanvasTexture(e); et.wrapS = et.wrapT = THREE.RepeatWrapping; et.colorSpace = THREE.SRGBColorSpace;
  return { map: t, mapDay: dt, rough: rt, emis: et };
}
function groundTex() {
  const c = document.createElement('canvas'); c.width = c.height = 256; const x = c.getContext('2d'); const im = x.createImageData(256, 256), d = im.data;
  for (let i = 0; i < 65536; i++) { const px = i & 255, py = i >> 8; const n = 0.55 * hsh(px * 0.37, py * 0.41, 1) + 0.45 * hsh((px >> 3) * 1.3, (py >> 3) * 1.7, 2); const v = 150 + Math.round(n * 85); d[i * 4] = v; d[i * 4 + 1] = v; d[i * 4 + 2] = v; d[i * 4 + 3] = 255; }
  x.putImageData(im, 0, 0); const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(6600, 6600); t.anisotropy = 4; return t;
}
function lobes(detail = 2, nParts = 6) {
  const parts = LOBE_PARTS.slice(0, nParts); const pos = [], uvs = []; // mêmes lobes que ceux que clearance.js teste contre les bâtiments
  parts.forEach(([x, y, z, r], k) => { const g = new THREE.IcosahedronGeometry(r, detail); const a = g.attributes.position.array, u = g.attributes.uv.array; for (let i = 0; i < a.length; i += 3) pos.push(a[i] + x, a[i + 1] + y, a[i + 2] + z); for (let i = 0; i < u.length; i += 2) uvs.push(u[i] * 2 + k * 0.37, u[i + 1] + k * 0.61); g.dispose(); });
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2)); g.computeVertexNormals(); return g;
}
// Conifère: cônes ouverts empilés en étages (hauteur 0 à 1, rayon 1), bord inférieur dentelé, facettes plates comme les
// lobes; coordonnées de texture à l'échelle du masque des feuillus.
function conifer(seg = 10, tiers = CON_TIERS) {
  const pos = [], uvs = [];
  tiers.forEach(([y0, y1, r], k) => {
    for (let i = 0; i < seg; i++) {
      const a0 = i / seg * Math.PI * 2, a1 = (i + 1) / seg * Math.PI * 2, d0 = i % 2 ? 0.08 : 0, d1 = (i + 1) % 2 ? 0.08 : 0;
      pos.push(Math.cos(a0) * r, y0 - d0 * (y1 - y0), Math.sin(a0) * r, 0, y1, 0, Math.cos(a1) * r, y0 - d1 * (y1 - y0), Math.sin(a1) * r);
      const u0 = i / seg * 3 + k * 0.37, u1 = (i + 1) / seg * 3 + k * 0.37, v0 = k * 0.61, v1 = v0 + 1.4 * (y1 - y0) / r;
      uvs.push(u0, v0, (u0 + u1) / 2, v1, u1, v0);
    }
  });
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2)); g.computeVertexNormals(); return g;
}
// Masque du feuillage: le soleil passe entre les feuilles, l'ombre d'un arbre est parsemée, pas un bloc. th plus bas:
// feuillage plus dense (conifères).
function leafTex(th = 0.5) {
  const N = 256, c = document.createElement('canvas'); c.width = c.height = N; const x = c.getContext('2d'); const im = x.createImageData(N, N), d = im.data;
  const grid = (gx, gy, gs, k) => { const i0 = Math.floor(gx), j0 = Math.floor(gy), fx = gx - i0, fy = gy - j0, sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy); const v = (i, j) => hsh(((i % gs) + gs) % gs, ((j % gs) + gs) % gs, k); return (v(i0, j0) * (1 - sx) + v(i0 + 1, j0) * sx) * (1 - sy) + (v(i0, j0 + 1) * (1 - sx) + v(i0 + 1, j0 + 1) * sx) * sy; };
  const f = new Float32Array(N * N), leaf = [], rank = new Uint8Array(N * N);
  for (let i = 0; i < N * N; i++) { const px = i & 255, py = i >> 8; f[i] = 0.3 * grid(px / 12, py / 12, 22, 11) + 0.4 * grid(px / 5, py / 5, 52, 12) + 0.3 * grid(px / 2.5, py / 2.5, 103, 13); if (f[i] > th) leaf.push(i); }
  // Canal rouge: rang de chaque pixel de feuille (1 à 255, du bord des trous au coeur des taches). L'effacement près de
  // l'objectif (nearFade) agrandit les trous dans ce même motif; three ne lit que le vert (transparence et ombre).
  leaf.sort((a, b) => f[a] - f[b]); leaf.forEach((i, k) => { rank[i] = Math.max(1, Math.round(255 * (k + 1) / leaf.length)); });
  for (let i = 0; i < N * N; i++) { const v = f[i] > th ? 255 : 0; d[i * 4] = rank[i]; d[i * 4 + 1] = v; d[i * 4 + 2] = v; d[i * 4 + 3] = 255; }
  x.putImageData(im, 0, 0); const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
}
// Tache de lumière ronde et douce (alpha seulement): flaques des lampadaires et têtes lumineuses.
function glowTex() {
  const c = document.createElement('canvas'); c.width = c.height = 128; const x = c.getContext('2d');
  const g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
  for (let k = 0; k <= 16; k++) { const o = k / 16; g.addColorStop(o, `rgba(255,255,255,${(Math.exp(-4.5 * o * o) - Math.exp(-4.5)) / (1 - Math.exp(-4.5))})`); } // décroissance douce, sans bord
  x.fillStyle = g; x.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
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
  const skyMat = new THREE.ShaderMaterial({ side: THREE.BackSide, depthWrite: false, uniforms: { uCum: { value: 0 }, uMid: { value: 0 }, uHigh: { value: 0 }, uDirect: { value: 1 }, uWarm: { value: 0 }, uTw: { value: 0 }, uNight: { value: 0 }, uGlow: { value: 0 }, uSmoke: { value: 0 }, uTurb: { value: 2.5 }, uRay: { value: 1.5 }, uSkyK: { value: 0.2 }, uZen: { value: 0.1 }, uStorm: { value: 0 }, uSunGap: { value: 0 }, uGapR: { value: 0.1 }, uSun: { value: new THREE.Vector3(0, 1, 0) }, uSunCol: { value: new THREE.Vector3(1, 1, 1) } }, vertexShader: SKY_VERT, fragmentShader: SKY_GLSL });
  const S = new THREE.Scene();
  const cam = new THREE.PerspectiveCamera(44, W / H, 1, 60000);
  if (import.meta.env.DEV) window.__scene3dCore = { R, S, cam, THREE }; // inspection en développement seulement
  const skyGeo = new THREE.SphereGeometry(5500, 40, 20);
  const sky = new THREE.Mesh(skyGeo, skyMat); sky.renderOrder = -1; S.add(sky);
  const skyScene = new THREE.Scene(); skyScene.add(new THREE.Mesh(skyGeo, skyMat));
  const cubeRT = new THREE.WebGLCubeRenderTarget(64, { type: THREE.HalfFloatType }); const cubeCam = new THREE.CubeCamera(1, 9000, cubeRT); skyScene.add(cubeCam);
  // Ciel des flaques: plus fin (le reflet rasant l'étire beaucoup: à 64, chaque pixel du ciel y faisait une bande), rendu
  // seulement sous forte pluie, sans le traitement de l'éclairage (qui coûterait 20 à 50 ms à cette taille).
  const skyRT = new THREE.WebGLCubeRenderTarget(256, { type: THREE.HalfFloatType }); const skyCam = new THREE.CubeCamera(1, 9000, skyRT); skyScene.add(skyCam); let skyFresh = false, skyGap = 0;
  const pmrem = new THREE.PMREMGenerator(R); pmrem.compileCubemapShader(); let envRT = null;
  function updateEnv() { skyFresh = false; cubeCam.update(R, skyScene); const nrt = pmrem.fromCubemap(cubeRT.texture); if (envRT) envRT.dispose(); envRT = nrt; S.environment = nrt.texture; }
  const fog = new THREE.Fog(0xcccccc, 300, 1600); S.fog = fog;
  const gndTex = groundTex();
  // Sol en deux pièces: le relief (maillage non uniforme de terrain.js: 2 m au centre, 20 km de rayon; plat et maillé à
  // 50 m en attendant les données, voir buildGround), puis la plaine jusqu'à l'horizon, sous le point le plus bas.
  const gndTexNear = gndTex.clone(); gndTexNear.repeat.set(1, 1); // coordonnées de texture en mètres / TEX_PERIOD
  const gndMat = new THREE.MeshStandardMaterial({ color: L('#5c6b42'), roughness: 1, envMapIntensity: 0.75, map: gndTexNear }), gndMatFar = gndMat.clone(); gndMatFar.map = gndTex;
  let gnd = null;
  const gndFar = new THREE.Mesh(new THREE.PlaneGeometry(60000, 60000, 8, 8), gndMatFar); gndFar.rotation.x = -Math.PI / 2; gndFar.position.y = -0.3; gndFar.receiveShadow = true; S.add(gndFar);
  const FT = facadeTex();
  const wallMat = new THREE.MeshStandardMaterial({ vertexColors: true, map: FT.map, roughnessMap: FT.rough, roughness: 1, metalness: 0, envMapIntensity: 0.75, emissive: 0xffffff, emissiveMap: FT.emis, emissiveIntensity: 0 });
  const uNight = { value: 0 }; // 0 le jour (fenêtres discrètes), 1 la nuit (fenêtres d'origine): voir frame
  wallMat.onBeforeCompile = (sh) => {
    sh.uniforms.mapDay = { value: FT.mapDay }; sh.uniforms.uNight = uNight;
    sh.vertexShader = 'attribute float aSeed;varying float vSeed;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvSeed=aSeed;');
    sh.fragmentShader = 'varying float vSeed;uniform sampler2D mapDay;uniform float uNight;\n' + sh.fragmentShader
      .replace('#include <map_fragment>', 'diffuseColor*=mix(texture2D(mapDay,vMapUv),texture2D(map,vMapUv),uNight);')
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor=roughness*mix(0.933,texture2D(roughnessMap,vRoughnessMapUv).g,uNight);')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance*=vSeed<0.0?1.0:step(0.5,fract(sin(dot(floor(vEmissiveMapUv)+vec2(vSeed,vSeed*0.37),vec2(12.9898,78.233)))*43758.5453));');
  };
  const roofMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0, envMapIntensity: 0.75 });
  const trunkMat = new THREE.MeshStandardMaterial({ color: L('#4a3b2e'), roughness: 0.95, envMapIntensity: 0.75 });
  const leafMask = leafTex();
  // Couronnes vues d'un seul côté (8 octobre 2026): par les trous on voit le ciel ou ce qui est derrière, pas l'intérieur
  // sombre des lobes (environ un quart de la lumière passe, comme un feuillage d'octobre); l'ombre garde les deux côtés.
  const crownMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, envMapIntensity: 0.75, alphaMap: leafMask, alphaTest: 0.5, side: THREE.FrontSide, shadowSide: THREE.DoubleSide });
  // Doublure d'ombre des feuillus proches: n'écrit rien à l'image (ni couleur, ni alpha, ni profondeur), porte seulement
  // l'ombre, trouée par le même masque. three.js choisit les objets de la carte d'ombre avec les couches de la caméra
  // principale: une couche à part n'y entrerait jamais.
  const shadowMat = new THREE.MeshBasicMaterial({ alphaMap: leafMask, alphaTest: 0.5, side: THREE.DoubleSide, colorWrite: false, depthWrite: false });
  const conMask = leafTex(0.44), conMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, envMapIntensity: 0.75, alphaMap: conMask, alphaTest: 0.5, side: THREE.DoubleSide });
  // Sous-bois des massifs: nappe de feuillage sombre sous les cimes (on ne voit plus le gazon ni les troncs entre les
  // arbres d'une forêt fermée) et lisière feuillue en bordure (bande haute, troncs visibles dessous), trouée.
  const fillMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, envMapIntensity: 0.6 }); // vue du dessus seulement: d'en bas, on voit les couronnes, pas un plafond
  const edgeMask = leafTex(0.55), edgeMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, envMapIntensity: 0.6, alphaMap: edgeMask, alphaTest: 0.5, side: THREE.DoubleSide }); // plus trouée que les couronnes
  const waterMat = new THREE.MeshStandardMaterial({ color: L('#2a3b48'), roughness: 0.12, metalness: 0, envMapIntensity: 1, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  // L'eau a déjà son reflet de ciel brillant: alpha 0 dans l'image de la scène, la passe des flaques l'ignore.
  waterMat.onBeforeCompile = (sh) => { sh.fragmentShader = sh.fragmentShader.replace('#include <opaque_fragment>', '#include <opaque_fragment>\ngl_FragColor.a=0.0;'); };
  waterMat.customProgramCacheKey = () => 'eau';
  // Arbres en trois anneaux de détail (moins de 150 m, 150 à 250 m, au-delà): feuillus en 6 lobes, 3 lobes simplifiés,
  // puis une boule à facettes; conifères en 3 étages de 10 côtés, puis 2 étages de 6; tronc à 6 faces, puis 3.
  // crownGeoShadow: doublure simplifiée qui porte l'ombre des feuillus proches.
  const crownGeo = lobes(), crownGeoMid = lobes(1, 3), crownGeoFar = new THREE.IcosahedronGeometry(1, 1), crownGeoShadow = lobes(1);
  const conGeo = conifer(), conGeoLow = conifer(6, CON_TIERS_LOW);
  const trunkGeo = new THREE.CylinderGeometry(0.16, 0.26, 1, 6), trunkGeoLow = new THREE.CylinderGeometry(0.16, 0.26, 1, 3, 1, true);
  // Éclairage de nuit (7 octobre 2026): lampadaires peints (flaque de lumière au sol, tête lumineuse) et lueur de la
  // ville; ils s'allument avec les fenêtres. Pas de vraies sources de lumière: des centaines resteraient légères.
  const LAMP_COL = new THREE.Color(1.0, 0.7, 0.42); // blanc chaud (DEL d'environ 3000 K), en linéaire
  const GLOW = glowTex();
  // Lumière des lampadaires: carte vue du dessus (intensité, et hauteur du sol pour l'éteindre en hauteur), lue par les
  // matériaux du sol, des rues, des murs et des arbres. Diffuse: chaque surface la reçoit dans sa propre couleur.
  const lampU = { uLampMap: { value: new THREE.DataTexture(new Uint16Array(4), 1, 1, THREE.RGFormat, THREE.HalfFloatType) }, uLampK: { value: 0 }, uLampHalf: { value: LAMP_HALF }, uLampCol: { value: LAMP_COL }, uWet: { value: 0 } };
  lampU.uLampMap.value.needsUpdate = true;
  // Sol mouillé (pluie de l'heure ou des trois précédentes, uWet de 0 à 1): dark = assombrissement à pleine pluie, gloss =
  // rugosité visée sur les faces tournées vers le ciel (une rue mouillée reflète le ciel, le gazon à peine, un mur pas).
  // Le ciel s'y reflète par la lumière d'environnement (un sol très lisse deviendrait gris pâle sous un ciel couvert:
  // lustre modéré, l'assombrissement domine); les façades, les arbres et les fenêtres, par la passe de reflet. refl = part
  // du reflet, écrite dans l'alpha de l'image de la scène: les flaques sur l'asphalte, un peu sur les trottoirs et les
  // toits plats (qui s'égouttent), rien sur le gazon (la couleur ne suffit pas à les distinguer la nuit).
  const WET = { 'plat-road': [0.42, 0.72, 1], 'plat-asphalt': [0.42, 0.72, 1], 'plat-walk': [0.36, 0.75, 0.6], 'plat-rail': [0.3, 0.78, 0.4], toit: [0.3, 0.8, 0.25], mur: [0.2, 1, 0], tronc: [0.35, 1, 0], feuillage: [0.12, 0.9, 0], 'sous-bois': [0.12, 0.9, 0], lisiere: [0.12, 0.9, 0] };
  const lampLit = (mat, key) => {
    const prev = mat.onBeforeCompile, [wDark, wGloss, wRefl] = WET[key] || [0.3, 0.9, 0];
    mat.onBeforeCompile = (sh, r) => {
      if (prev) prev.call(mat, sh, r);
      Object.assign(sh.uniforms, lampU);
      sh.fragmentShader = sh.fragmentShader.replace('#include <lights_physical_fragment>',
        `float wetK=0.0;if(uWet>0.0){float upF=smoothstep(0.55,0.9,dot(normal,normalize((viewMatrix*vec4(0.0,1.0,0.0,0.0)).xyz)));wetK=uWet*upF;diffuseColor.rgb*=1.0-${wDark.toFixed(2)}*uWet;roughnessFactor=mix(roughnessFactor,${wGloss.toFixed(2)},wetK);}\n#include <lights_physical_fragment>`)
        .replace('#include <opaque_fragment>', `#include <opaque_fragment>\ngl_FragColor.a=${wRefl.toFixed(2)};`);
      sh.vertexShader = 'varying vec3 vLampW;\n' + sh.vertexShader.replace('#include <project_vertex>', '#include <project_vertex>\nvec4 lampWP=vec4(transformed,1.0);\n#ifdef USE_INSTANCING\nlampWP=instanceMatrix*lampWP;\n#endif\nvLampW=(modelMatrix*lampWP).xyz;');
      sh.fragmentShader = 'uniform sampler2D uLampMap;uniform float uLampK,uLampHalf,uWet;uniform vec3 uLampCol;varying vec3 vLampW;\n' + sh.fragmentShader.replace('#include <aomap_fragment>',
        '{vec2 luv=vec2(vLampW.x,-vLampW.z)/(2.0*uLampHalf)+0.5;if(uLampK>0.0&&luv.x>0.0&&luv.x<1.0&&luv.y>0.0&&luv.y<1.0){vec2 lm=texture2D(uLampMap,luv).rg;totalEmissiveRadiance+=diffuseColor.rgb*uLampCol*(lm.r*uLampK*smoothstep(14.0,2.0,vLampW.y-lm.g))*(1.0+2.2*wetK);}}\n#include <aomap_fragment>');
    };
    mat.customProgramCacheKey = () => 'lamp-' + key; // un programme par matériau (les fonctions se ressemblent)
  };
  const lampHeadMat = new THREE.PointsMaterial({ map: GLOW, color: LAMP_COL, size: 2.2, sizeAttenuation: true, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
  const CITY_GLOW = new THREE.Color(0.62, 0.47, 0.33); // rebond chaud des rues éclairées sur les murs et les arbres
  let lampMeshes = [], urban = 0; // urban: 0 en campagne, 1 en ville (densité des bâtiments)
  // Surfaces au sol: pas d'écriture de profondeur et un ordre de rendu par couche (gazon, asphalte, pavé, rails, rues,
  // trottoirs), sinon des surfaces à quelques millimètres l'une de l'autre scintillent à 200 m (triangles qui clignotent).
  const flat = (h, y) => new THREE.MeshStandardMaterial({ color: L(h), roughness: 0.95, side: THREE.DoubleSide, envMapIntensity: 0.75, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 * y });
  // Gris foncés (rues, surfaces pavées) pour trancher avec le gazon et les toits (#5a5650); trottoirs un peu plus clairs.
  const flatMats = { road: flat('#383b3e', 3), rail: flat('#7d766c', 3), walk: flat('#9b978d', 4), asphalt: flat('#3a3d40', 2) };
  Object.keys(GC).forEach(k => { flatMats[k] = flat(GC[k], 1); });
  // Matériaux qui reçoivent la lumière des lampadaires (le toit, au-dessus des lampes, n'en reçoit presque pas).
  [[wallMat, 'mur'], [roofMat, 'toit'], [trunkMat, 'tronc'], [crownMat, 'feuillage'], [conMat, 'feuillage'], [fillMat, 'sous-bois'], [edgeMat, 'lisiere'], [gndMat, 'sol'], [gndMatFar, 'sol-loin'], ...Object.entries(flatMats).map(([k, m]) => [m, 'plat-' + k])].forEach(([m, k]) => lampLit(m, k));
  // Feuillage et troncs tout près de l'objectif (8 octobre 2026, « les arbres foncent dans la caméra »): effacés en douceur
  // par les trous du feuillage de 10 m à 3 m de la caméra (troncs de 4 m à 1 m, en trame). La carte d'ombre ne voit pas ce
  // retrait (three ne recopie pas onBeforeCompile dans son matériau de profondeur): les ombres sur la façade et au sol restent.
  const NEAR_LEAF = [3, 10], NEAR_TRUNK = [1, 4], nearU = { value: 1 };
  const nearFade = (mat, key, [r0, r1], leaf) => {
    const prev = mat.onBeforeCompile;
    mat.onBeforeCompile = (sh, r) => {
      prev.call(mat, sh, r); sh.uniforms.uNearOn = nearU;
      sh.fragmentShader = 'uniform float uNearOn;\n' + sh.fragmentShader.replace('#include <alphatest_fragment>', `#include <alphatest_fragment>\n{float nf=uNearOn*(1.0-smoothstep(${r0.toFixed(1)},${r1.toFixed(1)},distance(vLampW,cameraPosition)));`
        + (leaf ? 'if(nf>0.002&&texture2D(alphaMap,vAlphaMapUv).r<nf*1.004)discard;}' : 'if(nf>0.002&&fract(52.9829189*fract(dot(gl_FragCoord.xy,vec2(0.06711056,0.00583715))))<nf)discard;}'));
    };
    mat.customProgramCacheKey = () => 'lamp-' + key + '-proche';
  };
  nearFade(crownMat, 'couronne', NEAR_LEAF, true); nearFade(conMat, 'conifere', NEAR_LEAF, true); nearFade(edgeMat, 'lisiere', NEAR_LEAF, true); nearFade(trunkMat, 'tronc', NEAR_TRUNK, false);
  if (import.meta.env.DEV && window.__scene3dCore) window.__scene3dCore.nearU = nearU; // vérification en développement
  // Nappe du sous-bois vue nettement de son dessus seulement (plus de 7 à 13° au-dessus de sa surface, qui suit la pente;
  // transition en trame; effacée de près comme le feuillage, voir nearFade), quelle que
  // soit l'orientation de ses triangles (le bord décalé au hasard en replie quelques-uns): en vue de drone, elle comble les
  // trous entre les couronnes; d'en bas ou presque à l'horizontale, elle ferait un plafond ou une planche suspendue, et les
  // couronnes qui se chevauchent suffisent. Les pans de plus de 53° (saut de hauteur de la canopée d'une case à l'autre)
  // sont écartés: vus de côté, ils faisaient des murs sombres en l'air (déjà visibles avant, caméra à 6 m). Et la caméra doit
  // être nettement au-dessus d'elle (2 à 6 m, plus 15 % de la distance): à hauteur d'oeil, une pente tournée vers soi
  // restait une planche.
  fillMat.side = THREE.DoubleSide;
  { const prev = fillMat.onBeforeCompile; fillMat.onBeforeCompile = (sh, r) => { prev.call(fillMat, sh, r); sh.fragmentShader = sh.fragmentShader.replace('#include <alphatest_fragment>', '#include <alphatest_fragment>\n{vec3 nv=cameraPosition-vLampW,nn=normalize(cross(dFdx(vLampW),dFdy(vLampW)));nn*=nn.y<0.0?-1.0:1.0;float nk=clamp((dot(nv,nn)/max(length(nv),0.01)-0.12)*10.0,0.0,1.0)*smoothstep(3.0,10.0,length(nv))*step(0.6,nn.y)*smoothstep(2.0,6.0,nv.y+0.15*length(nv));if(nk<1.0&&nk<=fract(52.9829189*fract(dot(gl_FragCoord.xy,vec2(0.06711056,0.00583715)))))discard;}'); }; fillMat.customProgramCacheKey = () => 'lamp-sous-bois-dessus'; }

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
  // Ombre de nuage en un point P: le rayon vers le soleil d traverse-t-il un ellipsoïde du groupe g (rayons r, 0,3 r, r, groupe
  // sans rotation, comme dans la carte d'ombre)? m: marge en mètres (pénombre).
  function blobHit(g, P, d, m) {
    for (const s of g.children) {
      const r = s.scale.x + m, ry = s.scale.y + 0.4 * m;
      const qx = (P.x - g.position.x - s.position.x) / r, qy = (P.y - g.position.y - s.position.y) / ry, qz = (P.z - g.position.z - s.position.z) / r;
      const dx = d.x / r, dy = d.y / ry, dz = d.z / r, A = dx * dx + dy * dy + dz * dz, B = qx * dx + qy * dy + qz * dz, C = qx * qx + qy * qy + qz * qz - 1, D = B * B - A * C;
      if (D >= 0 && -B + Math.sqrt(D) > 0) return true;
    }
    return false;
  }

  // ---- passes d'image
  let PW = 0, PH = 0, sceneRT, aoRT, aoRT2, compRT, bloomA, bloomB, reflRT, reflRT2, BW = 0, BH = 0;
  function alloc() {
    PW = Math.round(W * DPR); PH = Math.round(H * DPR); [sceneRT, aoRT, aoRT2, compRT, bloomA, bloomB, reflRT, reflRT2].forEach(r => r && r.dispose());
    const dt = new THREE.DepthTexture(PW, PH); dt.type = THREE.UnsignedIntType;
    sceneRT = new THREE.WebGLRenderTarget(PW, PH, { type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthTexture: dt, depthBuffer: true, stencilBuffer: false });
    const o = { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false, stencilBuffer: false };
    aoRT = new THREE.WebGLRenderTarget(PW, PH, o); aoRT2 = new THREE.WebGLRenderTarget(PW, PH, o); compRT = new THREE.WebGLRenderTarget(PW, PH, o);
    BW = Math.max(2, Math.round(PW / 4)); BH = Math.max(2, Math.round(PH / 4)); const ob = { ...o, type: THREE.HalfFloatType }; bloomA = new THREE.WebGLRenderTarget(BW, BH, ob); bloomB = new THREE.WebGLRenderTarget(BW, BH, ob);
    reflRT = new THREE.WebGLRenderTarget(Math.max(2, Math.round(PW / 2)), Math.max(2, Math.round(PH / 2)), ob); reflRT2 = reflRT.clone(); // reflet des flaques, et passe de flou
  }
  alloc();
  const qScene = new THREE.Scene(), qCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1), quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2)); qScene.add(quad);
  function pass(mat, rt) { quad.material = mat; R.setRenderTarget(rt); R.render(qScene, qCam); }
  const kern = []; for (let i = 0; i < 12; i++) { const v = new THREE.Vector3(hsh(i, 3, 1) * 2 - 1, hsh(i, 3, 2) * 2 - 1, 0.15 + 0.85 * hsh(i, 3, 3)).normalize(); const s = i / 12; v.multiplyScalar(0.12 + 0.88 * s * s); kern.push(v); }
  const aoMat = new THREE.ShaderMaterial({ uniforms: { tDepth: { value: null }, uRes: { value: new THREE.Vector2() }, uProj: { value: new THREE.Matrix4() }, uProjInv: { value: new THREE.Matrix4() }, uR: { value: 2.4 }, uBias: { value: 0.04 }, uInt: { value: 1.6 }, uK: { value: kern } }, vertexShader: QV, fragmentShader: AO_FRAG });
  const blurMat = new THREE.ShaderMaterial({ uniforms: { tAO: { value: null }, tDepth: { value: null }, uDir: { value: new THREE.Vector2() }, uNF: { value: new THREE.Vector2(1, 60000) } }, vertexShader: QV, fragmentShader: BLUR_FRAG });
  const compMat = new THREE.ShaderMaterial({ uniforms: { tCol: { value: null }, tAO: { value: null }, tBloom: { value: null }, tDepth: { value: null }, uExp: { value: 1 }, uAO: { value: 0.9 }, uBloom: { value: 0 }, uAspect: { value: 1 }, uFlare: { value: 0 }, uRays: { value: 0 }, uVeilW: { value: 1 }, uVis: { value: 1 }, uSunUV: { value: new THREE.Vector2(0.5, 0.5) }, uSunC: { value: new THREE.Vector3(1, 1, 1) }, uDs: { value: 0 }, uFog: { value: new THREE.Vector2(300, 1600) }, uNF: { value: new THREE.Vector2(1, 60000) }, uRain: { value: 0 }, uTime: { value: 0 }, uFocal: { value: 1000 }, uSlant: { value: 0.1 }, uRainCol: { value: new THREE.Vector3(0.6, 0.6, 0.6) }, tRefl: { value: null }, uRefl: { value: 0 }, uFogSig: { value: 0 }, uFogTop: { value: 9000 }, uFogCol: { value: new THREE.Vector3(0.5, 0.5, 0.5) }, uSmkSig: { value: 0 }, uSmkTop: { value: 2500 }, uSmkCol: { value: new THREE.Vector3(0.5, 0.4, 0.3) }, uSunR: { value: 0 }, uSunDisc: { value: new THREE.Vector3() }, uCamW: { value: new THREE.Vector3() }, uV2W: { value: new THREE.Matrix3() }, uProjInv: { value: new THREE.Matrix4() } }, vertexShader: QV, fragmentShader: COMP_FRAG });
  const rblurMat = new THREE.ShaderMaterial({ uniforms: { tSrc: { value: null }, uDir: { value: new THREE.Vector2() } }, vertexShader: QV, fragmentShader: RBLUR_FRAG });
  const reflMat = new THREE.ShaderMaterial({ uniforms: { tCol: { value: null }, tDepth: { value: null }, uProj: { value: new THREE.Matrix4() }, uProjInv: { value: new THREE.Matrix4() }, uUp: { value: new THREE.Vector3(0, 1, 0) }, uTx: { value: new THREE.Vector2() }, tSky: { value: skyRT.texture }, uV2W: { value: new THREE.Matrix3() }, uCamW: { value: new THREE.Vector3() }, uPud: { value: 0 } }, vertexShader: QV, fragmentShader: REFL_FRAG });
  const brightMat = new THREE.ShaderMaterial({ uniforms: { tCol: { value: null }, uTh: { value: 0.3 } }, vertexShader: QV, fragmentShader: BRIGHT_FRAG });
  const gblurMat = new THREE.ShaderMaterial({ uniforms: { tSrc: { value: null }, uDir: { value: new THREE.Vector2() } }, vertexShader: QV, fragmentShader: GBLUR_FRAG });
  const fxMat = new THREE.ShaderMaterial({ uniforms: THREE.UniformsUtils.clone(FXAAShader.uniforms), vertexShader: FXAAShader.vertexShader, fragmentShader: FXAAShader.fragmentShader });

  // ---- état: lieu, heure, météo, caméra
  let lat = 46.8, lng = -71.2, origin = null, projLocal = [], orientation = [], style = null, data = null, dateMs = Date.now();
  const tg = { cum: 0, mid: 0, high: 0, iv: 1, rain: 0, wet: 0, pud: 0, fogK: 0, fogTh: 600, smk: 0, storm: 0, brk: 0, pSun: 0 }, cur = { ...tg };
  let smokeUg = null; // fumée de feux au sol (microgrammes par mètre cube, FireWork) à l'heure affichée
  let az = Math.PI * 1.2, camH = 1.7, Rr = 75; const ct = new THREE.Vector3(0, 10, 0);
  let rMin = 20; const R_MAX = 450; const clampR = (r) => Math.max(rMin, Math.min(R_MAX, r)); // distance caméra: hors du bâtiment visé, au plus 450 m
  let rainAt = 0; // dernière image de pluie seule (voir frame)
  // Percée (voir frame): rayon du disque dégagé autour du projet (fixé par pickView), groupes d'ombre retirés, trouée du ciel
  // autour du soleil (+1 ouverte, -1 refermée, 0 motif libre) et son état lissé.
  let brkR = BRK_R, brkKey = '', brkHide = new Set(), gapS = 0;
  let treeEnv = []; // arbres dessinés (voir trees()): enveloppes pour le flare près de l'objectif
  let statics = [], treesI = null, dirty = true, running = true, envKey = '', envAt = 0, drag = null, lastInfo = '', weatherRow = null;
  let projInfo = []; // côtés des formes du projet avec hauteur et source (légende)
  // Modèle d'architecte importé (GLB allégé, voir modelImport.js). Placement: x, n (mètres autour de l'origine), rot (degrés,
  // sens horaire depuis le nord), dy (mètres au-dessus de la pose au sol). Pose au sol: le bas du modèle au point le plus bas
  // du relief sous son emprise; à flanc de colline, l'arrière s'enfonce et le relief cache la partie enterrée.
  let model = null, modelPl = null, modelDrag = null, modelTimer = 0;
  // Calque satellite temporaire (satDrape.js): image drapée sur le relief, arbres masqués tant qu'il est allumé.
  let sat = null, satObj = null;
  const satTrees = () => { (treesI || []).forEach(m => { m.visible = !sat; }); statics.forEach(m => { if (m.material === fillMat || m.material === edgeMat) m.visible = !sat; }); dirty = true; };
  function placeSat() {
    if (satObj) { S.remove(satObj); satObj.geometry.dispose(); satObj.material.map.dispose(); satObj.material.dispose(); satObj = null; }
    if (sat && origin) { const mLng = 111320 * Math.cos(origin[0] * Math.PI / 180); satObj = satMesh(terrain, sat, (sat.lng - origin[1]) * mLng, (sat.lat - origin[0]) * 111320); S.add(satObj); }
    satTrees();
  }
  const onModel = opts.onModel || (() => {});
  let terrain = flatTerrain(), cloudLift = 150; // relief (plat en attendant /api/terrain); hauteur des nuages au-dessus du site
  function buildGround() {
    if (gnd) { S.remove(gnd); gnd.geometry.dispose(); gnd = null; }
    const { ax, H, N } = terrain; const P = new Float32Array(N * N * 3), UV = new Float32Array(N * N * 2);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const k = j * N + i; P[3 * k] = ax[i]; P[3 * k + 1] = H[k]; P[3 * k + 2] = -ax[j]; UV[2 * k] = ax[i] / TEX_PERIOD; UV[2 * k + 1] = ax[j] / TEX_PERIOD; }
    // Deux triangles par cellule, diagonale du coin bas-gauche au coin haut-droit (comme terrain.hTri), face vers le ciel.
    const I = new Uint32Array((N - 1) * (N - 1) * 6); let q = 0;
    for (let j = 0; j < N - 1; j++) for (let i = 0; i < N - 1; i++) { const a = j * N + i, b = a + 1, c = a + N, d = c + 1; I[q++] = a; I[q++] = b; I[q++] = d; I[q++] = a; I[q++] = d; I[q++] = c; }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(P, 3)); g.setAttribute('uv', new THREE.BufferAttribute(UV, 2)); g.setIndex(new THREE.BufferAttribute(I, 1)); g.computeVertexNormals();
    gnd = new THREE.Mesh(g, gndMat); gnd.receiveShadow = true; gnd.castShadow = !terrain.flat; S.add(gnd);
    gndFar.position.y = terrain.hMin - 1;
  }
  buildGround();
  // Sol sous une empreinte: hauteur du relief à ses sommets et à son centre (min pour enterrer le pied, moyenne pour le toit).
  function groundOf(ring) { const c = centroid(ring); const hs = ring.map(p => terrain.hTri(p[0], p[1])); hs.push(terrain.hTri(c[0], c[1])); let mn = Infinity, s = 0; hs.forEach(v => { if (v < mn) mn = v; s += v; }); return { min: mn, mean: s / hs.length }; }

  // Zone proche (rayon NEAR autour du projet, à l'origine, drapeau userData.pt): les arbres y gardent tout leur détail; au-delà, la scène directe garde les voisins et des arbres simplifiés, et le
  // brouillard ferme l'horizon. Comme dans un jeu: tout le détail près du sujet, peu au loin.
  const NEAR = 230;
  const nearXY = (x, n) => Math.hypot(x, n) < NEAR;
  let winLights = [];
  function clearStatics() { statics.forEach(m => { S.remove(m); if (!m.userData.sharedGeo) m.geometry && m.geometry.dispose(); if (m.isInstancedMesh) m.dispose(); }); statics = []; treesI = null; winLights.forEach(l => { S.remove(l); l.dispose && l.dispose(); }); winLights = []; lampMeshes = []; urban = 0; }
  function addMesh(g, mat, y, near, shadows, order = 0) { const m = new THREE.Mesh(g, mat); m.position.y = y; m.renderOrder = order; m.receiveShadow = true; if (shadows) m.castShadow = true; m.userData.pt = !!near; S.add(m); statics.push(m); return m; }
  // Surfaces au sol (parcs, asphalte, eau): items = [{ o: contour, h: trous }], séparés proche/loin, triangulées en 2D
  // puis drapées sur le relief (chaque morceau dans le plan du maillage du sol, voir terrain.drape).
  const dedupe = (r) => (r.length > 1 && r[0][0] === r[r.length - 1][0] && r[0][1] === r[r.length - 1][1] ? r.slice(0, -1) : r);
  function flatTris(o, holes) {
    const O = dedupe(o), HS = (holes || []).map(dedupe).filter(h => h.length >= 3), all = [...O, ...HS.flat()];
    const V2 = (r) => r.map(p => new THREE.Vector2(p[0], p[1]));
    try { return THREE.ShapeUtils.triangulateShape(V2(O), HS.map(V2)).map(([a, b, c]) => [all[a], all[b], all[c]]); } catch (e) { return []; }
  }
  // lots = [{ tris, hFn, nFn }]: chaque lot drapé avec sa fonction de hauteur et de normale (relief lissé, ou surface
  // lisse et normale verticale d'un plan d'eau), le tout en un maillage.
  function drapedMesh(lots, mat, y, near, order) {
    const parts = lots.map(l => terrain.drape(l.tris, l.hFn, l.nFn)).filter(p => p.pos.length); if (!parts.length) return;
    const n = parts.reduce((t, p) => t + p.pos.length, 0), pos = new Float32Array(n), nrm = new Float32Array(n); let o = 0; parts.forEach(p => { pos.set(p.pos, o); nrm.set(p.nrm, o); o += p.pos.length; });
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3)); addMesh(g, mat, y, near, false, order);
  }
  function addFlat(items, mat, y, order = 0) {
    [true, false].forEach(near => {
      const part = items.filter(it => { const c = centroid(it.o); return nearXY(c[0], c[1]) === near; });
      if (!part.length) return;
      drapedMesh(part.map(it => ({ tris: flatTris(it.o, it.h), hFn: it.hFn, nFn: it.nFn })), mat, y, near, order);
    });
  }
  function ribbons(list, y, mat, order = 0) {
    [true, false].forEach(near => {
      const part = list.filter(r => r.p.some(q => nearXY(q[0], q[1])) === near); if (!part.length) return;
      const tris = []; const T = (a, b, c) => tris.push([a, b, c]);
      part.forEach(r => { const w = r.w / 2, P = r.p; for (let i = 0; i < P.length - 1; i++) { const [x1, n1] = P[i], [x2, n2] = P[i + 1]; const dx = x2 - x1, dn = n2 - n1, l = Math.hypot(dx, dn) || 1, ox = -dn / l * w, on = dx / l * w; const A = [x1 + ox, n1 + on], B = [x1 - ox, n1 - on], C = [x2 - ox, n2 - on], D = [x2 + ox, n2 + on]; T(A, B, C); T(A, C, D); }
        P.forEach(([x, n]) => { for (let k = 0; k < 10; k++) { const a1 = k / 10 * Math.PI * 2, a2 = (k + 1) / 10 * Math.PI * 2; T([x, n], [x + Math.cos(a1) * w, n + Math.sin(a1) * w], [x + Math.cos(a2) * w, n + Math.sin(a2) * w]); } }); });
      if (!tris.length) return; drapedMesh([{ tris }], mat, y, near, order);
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
        // Sur une pente: toit à h au-dessus du sol moyen de l'empreinte, murs descendus jusque sous le point le plus bas
        // (rien ne flotte côté aval, le pied s'enterre côté amont); étages recomptés sur la hauteur réelle du mur.
        const gb = b.g || groundOf(pts), yb = gb.min - 0.5, top = gb.mean + h, lvw = Math.max(1, Math.round(lv * (top - yb) / h));
        for (let i = 0; i < pts.length; i++) {
          const a = pts[i], c = pts[(i + 1) % pts.length]; const ax = a[0], azz = -a[1], bx = c[0], bz = -c[1]; const ex = bx - ax, ez = bz - azz, len = Math.hypot(ex, ez); if (len < 0.05) continue;
          const nx = -ez / len, nz = ex / len;
          // Nombre entier de travées par mur (fenêtres centrées, jamais coupées dans un coin); mur trop court: plein.
          const nb = Math.round(len / (b.bay || 6.5)); const u1 = u0 + nb; const q = [[ax, yb, azz, u0, 0], [bx, yb, bz, u1, 0], [bx, top, bz, u1, lvw], [ax, top, azz, u0, lvw]];
          [[0, 1, 2], [0, 2, 3]].forEach(t => t.forEach(k => { const v = q[k]; P.push(v[0], v[1], v[2]); N.push(nx, 0, nz); U.push(v[3], v[4]); C.push(col.r, col.g, col.b); SD.push(b.allLit ? -1 : seed0 + i); })); u0 = u1;
        }
        const rg = new THREE.ShapeGeometry(shapeOf(pts)); rg.rotateX(-Math.PI / 2); const ra = rg.toNonIndexed().attributes.position.array; for (let i = 0; i < ra.length; i += 3) { RP.push(ra[i], top, ra[i + 2]); RN.push(0, 1, 0); RC.push(rc.r, rc.g, rc.b); } rg.dispose();
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
  // Lampadaires le long des rues (pas de relevé réel: positions tirées des rues): un tous les 38 m environ, en
  // alternant les côtés, au bord de la chaussée, sans doublon aux intersections; jusqu'à 420 m du projet. Chaque
  // flaque suit le relief (petite grille drapée), la tête lumineuse est un point à 7,5 m.
  function lamps(roads, bld) {
    urban = clamp((bld.filter(b => Math.hypot(...centroid(b[0])) < 300).length - 15) / 200);
    const pos = [], grid = new Map(), cell = (x, n) => Math.round(x / 16) + ',' + Math.round(n / 16);
    const taken = (x, n) => { const gx = Math.round(x / 16), gn = Math.round(n / 16); for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) { const l = grid.get((gx + a) + ',' + (gn + b)); if (l && l.some(([px, pn]) => Math.hypot(px - x, pn - n) < 17)) return true; } return false; };
    roads.filter(r => r.k === 0 && r.w >= 6).sort((a, b) => b.w - a.w).forEach(r => {
      const P = r.p; let acc = 10, side = 1;
      for (let i = 0; i < P.length - 1; i++) {
        const a = P[i], b = P[i + 1], len = Math.hypot(b[0] - a[0], b[1] - a[1]); if (len < 0.01) continue;
        const ux = (b[0] - a[0]) / len, un = (b[1] - a[1]) / len;
        while (acc <= len) {
          const off = r.w / 2 + 1.2, x = a[0] + ux * acc - un * off * side, n = a[1] + un * acc + ux * off * side;
          if (Math.hypot(x, n) < 420 && !taken(x, n)) { pos.push([x, n, -un * side, ux * side]); const k = cell(x, n); if (!grid.has(k)) grid.set(k, []); grid.get(k).push([x, n]); }
          acc += 38; side = -side;
        }
        acc -= len;
      }
    });
    if (!pos.length) return;
    // Carte de lumière: somme de taches gaussiennes centrées 3 m vers la chaussée (la lumière tombe surtout sur la
    // rue), plafonnée là où plusieurs se recouvrent; canal vert: hauteur du sol, pour éteindre la lumière en hauteur.
    const N = LAMP_N, cellM = 2 * LAMP_HALF / N, I = new Float32Array(N * N), rad = 3 * LAMP_SIGMA, k2 = 1 / (2 * LAMP_SIGMA * LAMP_SIGMA);
    pos.forEach(([x, n, sx, sn]) => {
      const cx = x - sx * 3, cn = n - sn * 3;
      const i0 = Math.max(0, Math.floor((cx - rad + LAMP_HALF) / cellM)), i1 = Math.min(N - 1, Math.ceil((cx + rad + LAMP_HALF) / cellM));
      const j0 = Math.max(0, Math.floor((cn - rad + LAMP_HALF) / cellM)), j1 = Math.min(N - 1, Math.ceil((cn + rad + LAMP_HALF) / cellM));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { const dx = -LAMP_HALF + (i + 0.5) * cellM - cx, dn = -LAMP_HALF + (j + 0.5) * cellM - cn; I[j * N + i] += Math.exp(-(dx * dx + dn * dn) * k2); }
    });
    const half = new Uint16Array(N * N * 2), toH = THREE.DataUtils.toHalfFloat;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const q = j * N + i; half[q * 2] = toH(Math.min(1.3, I[q])); half[q * 2 + 1] = I[q] > 0.002 ? toH(terrain.hTri(-LAMP_HALF + (i + 0.5) * cellM, -LAMP_HALF + (j + 0.5) * cellM)) : 0; }
    const tex = new THREE.DataTexture(half, N, N, THREE.RGFormat, THREE.HalfFloatType); tex.magFilter = tex.minFilter = THREE.LinearFilter; tex.needsUpdate = true;
    if (lampU.uLampMap.value) lampU.uLampMap.value.dispose();
    lampU.uLampMap.value = tex;
    const hp = new Float32Array(pos.length * 3); pos.forEach(([x, n], i) => { hp[i * 3] = x; hp[i * 3 + 1] = terrain.hTri(x, n) + 7.5; hp[i * 3 + 2] = -n; });
    const hg = new THREE.BufferGeometry(); hg.setAttribute('position', new THREE.BufferAttribute(hp, 3));
    const heads = new THREE.Points(hg, lampHeadMat); heads.renderOrder = 9; heads.visible = false; S.add(heads); statics.push(heads); lampMeshes.push(heads);
  }
  // Arbres: mesurés par LiDAR ([x, n, h, r, k]: hauteur, rayon de couronne, k 1 conifère; près d'un bâtiment, plus
  // dx, dn (centre réel de la couronne) et o (feuillage mesuré au-dessus du toit)) ou, à défaut, points d'Overture
  // ([x, n], taille tirée au sort comme avant). Trois anneaux de détail autour du projet. Les feuillus proches portent
  // leur ombre par une doublure simplifiée qui n'écrit rien à l'image (shadowMat), avec le même masque: la lumière reste
  // en taches. Rien ne traverse un bâtiment (clearance.js). Au toucher (iPad), 1500 arbres au plus: les proches, puis
  // les grands.
  const TREE_CAP = (window.matchMedia && window.matchMedia('(hover: none)').matches) ? 1500 : 4000;
  // Feuillu (8 octobre 2026, Stéphane: « moins larges, un peu plus écrasés »): surface vue du ciel ramenée à 85 % de la
  // couronne mesurée (le partage des eaux du LiDAR réunit souvent deux ou trois couronnes voisines), couronne moins
  // profonde et un peu plus large que haute (jamais plus écrasée qu'aux 3/4: sy au moins 0,75 sx), dont le bas remonte: on voit les troncs,
  // et une maison d'un ou deux étages reste lisible. Dans un peuplement (carte écoforestière), environ 38 % de la hauteur;
  // isolé (pelouse, rue), 45 %. Lobes: rayon visible 1,24 fois l'échelle, sommet à 1,17 fois au-dessus du centre (1 fois
  // pour 3 lobes et la boule du lointain), bas à 1 fois dessous, jamais sous 2,5 m (35 % de la hauteur d'un petit arbre).
  const AREA_K = [0.915, 0.941, 1], CROWN_NARROW = 0.85; // sx qui redonne la surface mesurée (6 lobes, 3 lobes, boule), puis rétrécie
  const crownY = (h, sx, top, stand) => Math.min(Math.max((stand ? 0.75 : 0.85) * sx, (stand ? 0.38 : 0.45) * h / (top + 1)), 1.8 * sx, (h - Math.min(2.5, 0.35 * h)) / (top + 1));
  // Forme dessinée d'un arbre avant dégagement (clearance.js la teste et l'ajuste telle quelle). Conifère: base des
  // branches à 12 à 25 % de la hauteur, sommet à la hauteur mesurée, rayon d'environ un septième de la hauteur (sapins et
  // épinettes de forêt: 3 à 5 m de diamètre; le rayon mesuré à mi-hauteur déborde sur les voisins en forêt dense), borné
  // par la mesure. Tronc jusqu'au centre de la couronne (au quart de la hauteur pour un conifère), plus épais pour un
  // grand arbre (21 cm de rayon au pied pour 18,7 m).
  function treeShape(t) {
    const k = Math.max(0.6, Math.min(1.1, 0.35 + t.h / 40)), tr = 0.26 * k;
    if (t.con) {
      const base = Math.max(0.8, (0.12 + 0.13 * hsh(t.x, t.n, 5)) * t.h), rb = Math.max(0.8, Math.min(t.h * (0.13 + 0.05 * t.c), t.r * 1.1));
      return { kind: 'con', cx: t.x, cn: t.n, base, rb, tiers: t.ring ? CON_TIERS_LOW : CON_TIERS, th: t.h * 0.25, k, tr };
    }
    const off = Math.hypot(t.dx, t.dn);
    // Centre mesuré de la couronne, à 0,7 fois sa largeur dessinée du tronc au plus (comme les essais de fitTree): le
    // haut du tronc reste dans la couronne, même pour un arbre bas et large dessiné plus étroit que sa couronne mesurée.
    const at = sx => { const f = off > 0.7 * sx ? 0.7 * sx / off : 1; return [t.x + t.dx * f, t.n + t.dn * f]; };
    const top = t.ring === 0 ? 1.17 : 1, sx0 = CROWN_NARROW * (t.lidar ? AREA_K[t.ring] * t.r : t.ring === 2 ? t.r : t.r / 1.2);
    const sy = crownY(t.h, sx0, top, t.stand), sx = Math.min(sx0, sy / 0.75), th = Math.max(1.5, t.h - top * sy), [cx, cn] = at(sx);
    if (t.ring === 2) return { kind: 'ball', cx, cn, sx, sy, top: 1, nl: 1, th, k, tr };
    return { kind: 'lobes', cx, cn, sx, sy, top, nl: t.ring === 1 ? 3 : 6, th, k, tr };
  }
  // P: prismes des bâtiments (formes du projet et voisins, clearance.js); cg: peuplements (decodeCanopy). Retourne, pour le
  // point de vue et le flare, chaque arbre dessiné: [x, n] du centre de la couronne, portée, sol, bas de la couronne,
  // sommet, [x, n] du tronc, rayon du tronc, haut du tronc, 1 pour un conifère.
  function trees(list, P, cg) {
    if (!list.length) return [];
    let all = list.map(t => {
      const [x, n] = t; let h, r, con = false, dx = 0, dn = 0, over;
      if (t.length >= 5) { h = t[2]; r = t[3]; con = t[4] === 1; if (t.length >= 8) { over = t[7]; if (!con) { dx = t[5]; dn = t[6]; } } } // rayon d'après la surface de la couronne mesurée (voir treeShape)
      else { const cr = 2.1 + 1.5 * hsh(x, n, 2); h = Math.max(2.5, 7 + 6 * hsh(x, n, 1) - cr * 1.4) + 2.08 * cr; r = 1.2 * cr; } // mêmes arbres qu'avant le LiDAR
      const d = Math.hypot(x, n);
      return { x, n, h: Math.max(2.5, h), r: Math.max(0.8, r), con, d, ring: d < 150 ? 0 : d < 250 ? 1 : 2, y: terrain.hTri(x, n), rot: hsh(x, n, 3) * 6.28, c: hsh(x, n, 4), dx, dn, over, lidar: t.length >= 5, stand: t.length >= 5 && !!cg && cg.at(x, n) > 0 };
    });
    const pr = t => (t.d < 150 ? 2 : 0) + (t.h >= 15 ? 1 : 0) + t.h / 100;
    const cap = (arr, m) => { if (arr.length <= m) return arr; arr.sort((a, b) => pr(b) - pr(a)); return arr.slice(0, m); };
    // Dégagement avant le plafond (qui ne compte alors que des arbres dessinés), sur 30 % de plus que le plafond
    // seulement: l'iPad n'ajuste pas 4000 arbres pour en dessiner 1500.
    all = cap(all, Math.ceil(TREE_CAP * 1.3)).filter(t => (t.s = fitTree(t, treeShape(t), P)) !== null);
    all = cap(all, TREE_CAP);
    const o3 = new THREE.Object3D(), rings = [[], [], []];
    all.forEach(t => rings[t.ring].push(t));
    treesI = [];
    const inst = (geo, mat, lot, place, cast) => {
      if (!lot.length) return;
      const m = new THREE.InstancedMesh(geo, mat, lot.length);
      lot.forEach((t, i) => { place(t); o3.updateMatrix(); m.setMatrixAt(i, o3.matrix); if (mat !== trunkMat && mat !== shadowMat) m.setColorAt(i, L(t.con ? CONIFER_PAL[Math.floor(t.c * CONIFER_PAL.length)] : TREE_PAL[Math.floor(t.c * TREE_PAL.length)])); });
      m.castShadow = cast; m.receiveShadow = mat !== shadowMat; m.userData.sharedGeo = true;
      // Doublure d'ombre: dessinée dans la carte d'ombre seulement (aucune instance dans la passe principale, où elle
      // n'écrivait rien de toute façon).
      if (mat === shadowMat) { const n = lot.length; m.computeBoundingSphere(); m.onBeforeRender = () => { m.count = 0; }; m.onAfterRender = () => { m.count = n; }; }
      S.add(m); statics.push(m); treesI.push(m);
    };
    const placeCrown = t => { const s = t.s; o3.position.set(s.cx, t.y + t.h - s.top * s.sy, -s.cn); o3.scale.set(s.sx, s.sy, s.sx); o3.rotation.set(0, t.rot, 0); }; // 6 lobes, 3 lobes ou boule
    const placeCon = t => { const s = t.s; o3.position.set(s.cx, t.y + s.base, -s.cn); o3.scale.set(s.rb, t.h - s.base, s.rb); o3.rotation.set(0, t.rot, 0); };
    const placeTrunk = t => { const s = t.s; o3.position.set(t.x, t.y + s.th / 2, -t.n); o3.scale.set(s.k, s.th, s.k); o3.rotation.set(0, 0, 0); };
    rings.forEach((lot, k) => {
      const broad = lot.filter(t => !t.con), con = lot.filter(t => t.con);
      inst(k ? trunkGeoLow : trunkGeo, trunkMat, lot, placeTrunk, true);
      if (k === 0) { inst(crownGeo, crownMat, broad, placeCrown, false); inst(crownGeoShadow, shadowMat, broad, placeCrown, true); }
      else inst(k === 1 ? crownGeoMid : crownGeoFar, crownMat, broad, placeCrown, true);
      inst(k ? conGeoLow : conGeo, conMat, con, placeCon, true);
    });
    return all.map(t => { const s = t.s; return [s.cx, s.cn, reachOf(s), t.y, s.kind === 'con' ? t.y + s.base : t.y + t.h - (s.top + 1) * s.sy, t.y + t.h, t.x, t.n, s.tr, t.y + s.th, s.kind === 'con' ? 1 : 0]; });
  }

  // Sous-bois: grille de canopée des massifs (api/trees.js, demi-mètres, zéros par plages) en nappe à 72 % de la hauteur
  // des cimes voisines, dans le tiers bas des couronnes de peuplement (voir crownY: vue d'en haut, elle comble les trous
  // entre les couronnes; d'en bas, elle est invisible), au contour décalé au hasard (pas de marches de 3 m), plus une
  // lisière trouée au bord, du bas des couronnes à la nappe. Teinte de l'intérieur du
  // feuillage, plus verte là où les conifères dominent. La nappe ne porte pas d'ombre (elle ferait un bloc au bord du
  // boisé): les cimes et la lisière, trouées, s'en chargent.
  const NAPPE_K = 0.72, EDGE_K = 0.75; // nappe dans le tiers bas des couronnes de peuplement (de 62 % à 100 % de la hauteur), lisière juste sous leur bas
  function decodeCanopy(cn) {
    const N = cn.n, res = cn.res, half = cn.half, bin = atob(cn.d), v = new Uint8Array(N * N);
    for (let p = 0, k = 0; p < bin.length && k < N * N; p++) { const b = bin.charCodeAt(p); if (b) v[k++] = b; else k += bin.charCodeAt(++p); }
    const at = (x, n) => { const i = Math.floor((x + half) / res), j = Math.floor((n + half) / res); return i < 0 || j < 0 || i >= N || j >= N ? 0 : v[j * N + i]; };
    return { N, res, half, v, at };
  }
  function canopyFill(cg, treeList, P) {
    const { N, res, half, v } = cg;
    // Part de conifères par case de 12 m, d'après les arbres mesurés.
    const share = new Map(), key = (x, n) => `${Math.floor(x / 12)},${Math.floor(n / 12)}`;
    treeList.forEach(t => { if (t.length < 5) return; const k = key(t[0], t[1]), c = share.get(k) || [0, 0]; c[0]++; c[1] += t[4]; share.set(k, c); });
    const BROAD = [L('#454826'), L('#4d4427'), L('#3c4a2a')], CON = L('#253826'), cc = new THREE.Color();
    const pos = [], col = [], ind = [], idx = new Int32Array(N * N).fill(-1), top = new Float32Array(N * N), gy = new Float32Array(N * N), cells = [];
    const at0 = (i, j) => (i < 0 || j < 0 || i >= N || j >= N) ? 0 : v[j * N + i];
    // Rentrée d'une case (3 m): la canopée mesurée déborde un peu des couronnes dessinées, la nappe doit rester dessous.
    const at = (i, j) => at0(i, j) && at0(i - 1, j) && at0(i + 1, j) && at0(i, j - 1) && at0(i, j + 1) ? v[j * N + i] : 0;
    const vert = (i, j) => {
      const k = j * N + i; if (idx[k] >= 0) return idx[k];
      const x = -half + (i + 0.5) * res, n = -half + (j + 0.5) * res; let m = 0, c9 = 0;
      for (let b = -1; b <= 1; b++) for (let a = -1; a <= 1; a++) { const u = at(i + a, j + b); if (u) { m += u; c9++; } }
      m /= c9 || 1; // moyenne des cases boisées voisines: la nappe reste sous la cime d'un petit arbre voisin d'un grand
      gy[k] = terrain.hTri(x, n); top[k] = gy[k] + NAPPE_K * m / 2;
      const c = share.get(key(x, n)), f = c ? c[1] / c[0] : 0;
      cc.copy(BROAD[Math.floor(hsh(x, n, 7) * BROAD.length)]).lerp(CON, f).multiplyScalar(0.55 + 0.4 * hsh(x, n, 6)); // taches claires et sombres
      pos.push(x, top[k], -n); col.push(cc.r, cc.g, cc.b); cells.push([i, j, m]); idx[k] = pos.length / 3 - 1; return idx[k];
    };
    // Pas de sous-bois dans un bâtiment ni contre ses murs (formes du projet comprises, que le serveur ne connaît pas):
    // cases à moins de 0,6 m d'une empreinte retirées; la nappe s'ouvre autour d'une maison du boisé et sa lisière en
    // fait le tour.
    const quad = (i, j) => i >= 0 && j >= 0 && i < N - 1 && j < N - 1 && at(i, j) && at(i + 1, j) && at(i + 1, j + 1) && at(i, j + 1);
    const blk = new Uint8Array(N * N);
    for (let j = 0; j < N - 1; j++) for (let i = 0; i < N - 1; i++) if (quad(i, j) && sheetCellBlocked(-half + (i + 1) * res, -half + (j + 1) * res, res, P)) blk[j * N + i] = 1;
    const filled = (i, j) => quad(i, j) && !blk[j * N + i];
    for (let j = 0; j < N - 1; j++) for (let i = 0; i < N - 1; i++) if (filled(i, j)) { const a = vert(i, j), b = vert(i + 1, j), c = vert(i + 1, j + 1), d = vert(i, j + 1); ind.push(a, b, c, a, c, d); }
    if (!ind.length) return;
    // Bord: sommet touché par une case vide, déplacé jusqu'à 1,3 m dans une direction tirée au sort (à la même hauteur:
    // abaissé, le bord faisait une pente raide dont on voyait le dessus depuis une clairière).
    const place = (q, dist) => {
      const [i, j, m] = cells[q], k = j * N + i, x = -half + (i + 0.5) * res, n = -half + (j + 0.5) * res, a = hsh(x, n, 8) * 6.28;
      pos[q * 3] = x + Math.cos(a) * dist; pos[q * 3 + 2] = -(n + Math.sin(a) * dist);
      gy[k] = terrain.hTri(pos[q * 3], -pos[q * 3 + 2]); top[k] = gy[k] + NAPPE_K * m / 2; pos[q * 3 + 1] = top[k];
    };
    const moved = new Uint8Array(cells.length);
    cells.forEach(([i, j], q) => {
      if (filled(i - 1, j - 1) && filled(i, j - 1) && filled(i - 1, j) && filled(i, j)) return;
      place(q, 1.3 * hsh(-half + (i + 0.5) * res, -half + (j + 0.5) * res, 9)); moved[q] = 1;
    });
    // Un sommet déplacé qui amène un triangle à moins de 0,3 m d'un bâtiment revient au centre de sa case (à 0,6 m au
    // moins); la lisière suit, elle est bâtie sur ces mêmes sommets.
    for (let pass = 0, changed = 1; changed && pass < 4; pass++) {
      changed = 0;
      for (let t = 0; t < ind.length; t += 3) {
        const a = ind[t], b = ind[t + 1], c = ind[t + 2]; if (moved[a] !== 1 && moved[b] !== 1 && moved[c] !== 1) continue;
        if (!sheetTriTooClose([[pos[a * 3], -pos[a * 3 + 2]], [pos[b * 3], -pos[b * 3 + 2]], [pos[c * 3], -pos[c * 3 + 2]]], P)) continue;
        for (const q of [a, b, c]) if (moved[q] === 1) { place(q, 0); moved[q] = 2; changed++; }
      }
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setIndex(ind); g.computeVertexNormals();
    const m = new THREE.Mesh(g, fillMat); m.receiveShadow = true; S.add(m); statics.push(m);
    // Lisière: chaque côté de case remplie qui borde une case vide.
    const ep = [], ec = [], eu = [], ei = [];
    const side = (i0, j0, i1, j1) => {
      const k0 = j0 * N + i0, k1 = j1 * N + i1, p0 = idx[k0] * 3, p1 = idx[k1] * 3, b = ep.length / 3;
      const x0 = pos[p0], z0 = pos[p0 + 2], x1 = pos[p1], z1 = pos[p1 + 2], u0 = (x0 - z0) / 4, u1 = (x1 - z1) / 4;
      // Bande de feuillage dans le haut seulement (du bas des couronnes à la nappe): on voit les troncs dessous, comme
      // à la lisière d'un vrai boisé; une lisière pleine jusqu'au sol faisait un mur de haie vu de près.
      const b0 = gy[k0] + EDGE_K * (top[k0] - gy[k0]), b1 = gy[k1] + EDGE_K * (top[k1] - gy[k1]);
      ep.push(x0, b0, z0, x1, b1, z1, x1, top[k1], z1, x0, top[k0], z0);
      for (const q of [p0, p1, p1, p0]) ec.push(col[q] * 1.3, col[q + 1] * 1.3, col[q + 2] * 1.3);
      eu.push(u0, 0, u1, 0, u1, (top[k1] - b1) / 4, u0, (top[k0] - b0) / 4);
      ei.push(b, b + 1, b + 2, b, b + 2, b + 3);
    };
    for (let j = 0; j < N - 1; j++) for (let i = 0; i < N - 1; i++) {
      if (!filled(i, j)) continue;
      if (!filled(i, j - 1)) side(i, j, i + 1, j);
      if (!filled(i + 1, j)) side(i + 1, j, i + 1, j + 1);
      if (!filled(i, j + 1)) side(i + 1, j + 1, i, j + 1);
      if (!filled(i - 1, j)) side(i, j + 1, i, j);
    }
    if (!ei.length) return;
    const ge = new THREE.BufferGeometry(); ge.setAttribute('position', new THREE.Float32BufferAttribute(ep, 3)); ge.setAttribute('color', new THREE.Float32BufferAttribute(ec, 3)); ge.setAttribute('uv', new THREE.Float32BufferAttribute(eu, 2)); ge.setIndex(ei); ge.computeVertexNormals();
    const me = new THREE.Mesh(ge, edgeMat); me.castShadow = true; me.receiveShadow = true; S.add(me); statics.push(me);
  }

  // Point de vue: à hauteur d'oeil, côté soleil du créneau (AM: sud-est, PM: sud-ouest), dans l'espace libre,
  // avec vue dégagée sur le bâtiment principal.
  function pickView(target, others, roads, treePts, subj = [], focusH = 9) {
    if (!target.length) { const b0 = terrain.hTri(0, 0); ct.set(0, b0 + 10, 0); T0.set(0, b0, 0); sunL.target.position.copy(T0); brkR = BRK_R; return; }
    const tc = centroid(target), base = groundOf(target).mean; let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
    target.forEach(p => { minx = Math.min(minx, p[0]); miny = Math.min(miny, p[1]); maxx = Math.max(maxx, p[0]); maxy = Math.max(maxy, p[1]); });
    const corners = [[minx, miny], [maxx, maxy], [minx, maxy], [maxx, miny]];
    const pref = orientation.includes('PM') && !orientation.includes('AM') ? 215 : orientation.includes('AM') && !orientation.includes('PM') ? 140 : 180;
    const size = Math.max(maxx - minx, maxy - miny); const radPref = Math.max(40, Math.min(110, size * 1.0 + 25)), aimY = base + Math.min(14, 4 + size * 0.1);
    rMin = Math.max(15, Math.hypot(maxx - minx, maxy - miny) / 2 + 8); // on ne peut pas s'approcher au point d'entrer dans le bâtiment (8 m de marge)
    let best = null, bestUnder = null;
    const near = others.filter(r => Math.hypot(centroid(r)[0] - tc[0], centroid(r)[1] - tc[1]) < 260);
    // Arbres dessinés (trees()): couronne, tronc et genre. Visées: le centre, le haut du toit (bande de ciel) et les coins au pied.
    const tp = treePts.filter(t => Math.hypot(t[0] - tc[0], t[1] - tc[1]) < radPref + 80);
    const aims = [[tc[0], tc[1], aimY], [tc[0], tc[1], base + Math.max(3, focusH) + 2], ...corners.map(([x, y]) => [x, y, base + 1.5])];
    const hd = Math.max(...corners.map(([x, y]) => Math.hypot(x - tc[0], y - tc[1]))); // écart maximal entre une visée et le centre
    for (let bea = pref - 80; bea <= pref + 80; bea += 5) {
      for (let rad = Math.max(30, radPref - 40); rad <= radPref + 50; rad += 6) {
        const px = tc[0] + Math.sin(bea * Math.PI / 180) * rad, py = tc[1] + Math.cos(bea * Math.PI / 180) * rad, p = [px, py];
        if (near.some(r => pointInRing(p, r)) || pointInRing(p, target) || subj.some(r => pointInRing(p, r))) continue; // jamais dans le sujet (socle, aile) non plus
        if (near.some(r => segHitsRing(p, tc, r))) continue;
        // Pas dans un arbre ni le nez dans une couronne (portée dessinée), et le moins d'arbres possible entre
        // la caméra et le bâtiment. En forêt dense, aucun point n'est libre: on garde le moins encombré, vu de plus haut.
        // Une couronne ne cache le bâtiment que si la ligne de visée la traverse (on voit sous une couronne haute).
        // Distance de l'oeil à l'enveloppe d'une couronne mesurée comme l'effacement près de l'objectif (nearFade): sous 3 m
        // elle serait effacée, jusqu'à 10 m en partie; tronc à moins de 1,2 m ou sous la jupe d'un conifère: trop près.
        let treePen = 0, under = false, screen = 0, screenC = 0, trunkHit = 0;
        const eye = terrain.hTri(px, py) + 1.7;
        const AL = aims.map(([ax, an, ay]) => { const dx = ax - px, dy = an - py; return [dx, dy, dx * dx + dy * dy || 1, ay]; });
        const gx = tc[0] - px, gy = tc[1] - py, g2 = gx * gx + gy * gy || 1;
        for (const t of tp) {
          const r = t[2], dt = Math.hypot(t[0] - px, t[1] - py), dv = Math.max(eye - t[5], t[4] - eye, 0), de = Math.hypot(Math.max(dt - r, 0), dv), dk = Math.hypot(t[6] - px, t[7] - py) - t[8];
          if (de < NEAR_LEAF[0] || dk < 1.2 || (t[10] && dt < r + 0.5 && eye < t[5])) under = true; else if (de < NEAR_LEAF[1]) treePen += (NEAR_LEAF[1] - de) * 4;
          // Aucune ligne de visée à portée de cet arbre (chacune reste à moins de hd de la ligne vers le centre): suivant.
          const w = clamp(((t[0] - px) * gx + (t[1] - py) * gy) / g2);
          if (Math.hypot(px + w * gx - t[0], py + w * gy - t[1]) > Math.max(r, Math.hypot(t[0] - t[6], t[1] - t[7]) + t[8] + 0.1) + hd) continue;
          for (let k = 0; k < AL.length; k++) {
            const [dx, dy, l2, ay] = AL[k];
            const u = clamp(((t[0] - px) * dx + (t[1] - py) * dy) / l2), ly = eye + (ay - eye) * u;
            if (Math.hypot(px + u * dx - t[0], py + u * dy - t[1]) < 0.8 * r && ly > t[4] && ly < t[5]) { screen += 1 / AL.length; if (k === 0) screenC++; } // screenC: couronnes sur la ligne du centre
            const v = clamp(((t[6] - px) * dx + (t[7] - py) * dy) / l2), lv = eye + (ay - eye) * v;
            if (v > 0.03 && v < 0.9 && Math.hypot(px + v * dx - t[6], py + v * dy - t[7]) < t[8] + 0.1 && lv < Math.min(t[4], t[9])) trunkHit += 1 / aims.length; // tronc devant la façade
          }
        }
        const blocked = corners.filter(c => near.some(r => segHitsRing(p, c, r))).length;
        const hidden = terrain.blocked(px, py, terrain.hTri(px, py) + 1.7, tc[0], tc[1], aimY) ? 1 : 0; // le relief cache le bâtiment
        let roadD = Infinity; roads.forEach(r => { if (r.k !== 0) return; const P = r.p; for (let i = 0; i < P.length - 1; i++) { const a = P[i], b = P[i + 1]; const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy || 1; let t = ((px - a[0]) * dx + (py - a[1]) * dy) / l2; t = Math.max(0, Math.min(1, t)); roadD = Math.min(roadD, Math.hypot(px - a[0] - t * dx, py - a[1] - t * dy)); } });
        const score = -Math.abs(bea - pref) * 0.6 - Math.abs(rad - radPref) * 0.8 - blocked * 25 - hidden * 40 + (roadD < 7 ? 8 : 0) - treePen - Math.min(screen, 8) * 12 - trunkHit * 30;
        if (under) { if (!bestUnder || score > bestUnder.s) bestUnder = { s: score, px, py, screen, screenC, under }; }
        else if (!best || score > best.s) best = { s: score, px, py, screen, screenC };
      }
    }
    if (!best) best = bestUnder;
    if (!best) { best = { px: tc[0] + Math.sin(pref * Math.PI / 180) * radPref, py: tc[1] + Math.cos(pref * Math.PI / 180) * radPref, screen: 0, under: true }; } // point non vérifié: au-dessus des cimes voisines
    // Vue bouchée par les arbres (lot en forêt): au-dessus des cimes voisines plutôt qu'à hauteur d'oeil.
    let lift = 1.7;
    if (best.under || best.screenC >= 3) { const g0 = terrain.hTri(best.px, best.py); let top = 0; for (const t of tp) if (Math.hypot(t[0] - best.px, t[1] - best.py) < 25) top = Math.max(top, t[5] - g0); lift = Math.max(lift, Math.min(80, top + 5)); }
    ct.set(tc[0], aimY, -tc[1]); T0.set(tc[0], base, -tc[1]); sunL.target.position.copy(T0);
    az = Math.atan2(best.px - tc[0], best.py - tc[1]); Rr = clampR(Math.hypot(best.px - tc[0], best.py - tc[1])); camH = lift;
    brkR = Math.min(120, Math.max(BRK_R, rMin, Rr)); // percée: le point de vue de départ est dans le disque dégagé
  }

  // ---- modèle importé
  const rotXY = (x, n, deg) => { const r = -deg * Math.PI / 180, c = Math.cos(r), sn = Math.sin(r); return [x * c - n * sn, x * sn + n * c]; }; // sens horaire vu du ciel
  // Centre de surface (formule du lacet), pas la moyenne des sommets: un arc découpé en 24 segments ne le tire pas vers lui.
  const areaCenter = (r) => { let a = 0, cx = 0, cn = 0; for (let i = 0; i < r.length; i++) { const p = r[i], q = r[(i + 1) % r.length], k = p[0] * q[1] - q[0] * p[1]; a += k; cx += (p[0] + q[0]) * k; cn += (p[1] + q[1]) * k; } return Math.abs(a) > 1e-6 ? [cx / (3 * a), cn / (3 * a)] : centroid(r); };
  // Enveloppe allégée: sommets à moins de 5 cm de la droite de leurs voisins retirés (arrondi au centimètre sur un mur en biais).
  const slimHull = (h) => { const s = h && h.length >= 4 ? dpClosed(h, 0.05) : h; return s && s.length >= 3 ? s : h; };
  // Ombre reçue par le modèle: décalage le long de la normale plafonné (environ 0,7 pixel d'ombre, 5 cm de près; celui du
  // décor, 0,5 m et plus, effacerait l'ombre d'un avant-toit ou d'une embrasure), normale tournée vers la caméra sur les
  // faces vues des deux côtés (une face à l'envers au soleil ne se fait plus d'ombre à elle-même). Voir frame pour uMdlNB.
  // Biais de profondeur: celui du décor (sunL.shadow.bias, environ 0,29 m le long des rayons) efface aussi l'ombre d'une
  // fenêtre en retrait de 15 cm ou la bande sous un avant-toit. Le point lu dans la carte d'ombre recule donc vers l'opposé
  // du soleil de (biais du décor moins biais du modèle): la caméra d'ombre est orthographique et regarde le long des rayons,
  // ce recul ne change que la profondeur, pas le pixel lu. Reste le biais du modèle: 2 cm, plus un demi-pixel d'ombre x
  // tan(angle entre la normale et le soleil) (écart de profondeur d'une face en biais dans un pixel), tangente plafonnée à 6,
  // jamais plus que celui du décor. Normale déjà tournée vers la caméra (faces vues des deux côtés); le soleil est la seule
  // lumière directionnelle qui porte ombre. Voir frame pour uMdlSun (vers le soleil), uMdlGB et uMdlHT (en mètres).
  const mdlNB = { value: 0.05 }, mdlSun = { value: new THREE.Vector3(0, 1, 0) }, mdlGB = { value: 0 }, mdlHT = { value: 0.02 };
  const MDL_DIR_COORD = 'vDirectionalShadowCoord[ i ] = directionalShadowMatrix[ i ] * shadowWorldPosition;';
  const MDL_SHADOW_HEAD = 'uniform float uMdlNB;\nuniform float uMdlGB;\nuniform float uMdlHT;\nuniform vec3 uMdlSun;\n' +
    'vec3 mdlSunBack( vec3 n ) { float c = clamp( dot( n, uMdlSun ), 0.0, 1.0 ); float t = min( 6.0, sqrt( 1.0 - c * c ) / max( c, 1e-3 ) ); return - uMdlSun * ( uMdlGB - min( uMdlGB, 0.02 + uMdlHT * t ) ); }\n';
  const MDL_SHADOW_VERT = THREE.ShaderChunk.shadowmap_vertex
    .replace(/directionalLightShadows\[ i \]\.shadowNormalBias/g, 'min( directionalLightShadows[ i ].shadowNormalBias, uMdlNB )')
    .replace('vec4 shadowWorldPosition;', 'vec4 shadowWorldPosition;\n#ifdef DOUBLE_SIDED\nif ( dot( shadowWorldNormal, cameraPosition - worldPosition.xyz ) < 0.0 ) shadowWorldNormal = - shadowWorldNormal;\n#endif')
    .replace(MDL_DIR_COORD, '#if UNROLLED_LOOP_INDEX == 0\n\t\t\tshadowWorldPosition.xyz += mdlSunBack( shadowWorldNormal );\n\t\t\t#endif\n\t\t\t' + MDL_DIR_COORD); // le soleil seulement (seule lumière qui porte ombre: indice 0)
  if (MDL_SHADOW_VERT.split('mdlSunBack').length !== 2 || !MDL_SHADOW_VERT.includes('uMdlNB') || !MDL_SHADOW_VERT.includes('DOUBLE_SIDED')) console.warn('[scene3d] chunk d’ombre de three inattendu: biais d’ombre du modèle importé incomplet');
  const modelShadow = (mat, key) => {
    const prev = mat.onBeforeCompile;
    mat.onBeforeCompile = (sh, r) => {
      if (prev) prev.call(mat, sh, r);
      Object.assign(sh.uniforms, { uMdlNB: mdlNB, uMdlGB: mdlGB, uMdlHT: mdlHT, uMdlSun: mdlSun });
      sh.vertexShader = MDL_SHADOW_HEAD + sh.vertexShader.replace('#include <shadowmap_vertex>', MDL_SHADOW_VERT);
    };
    mat.customProgramCacheKey = () => key; // programme propre au modèle: le décor garde son biais
  };
  function modelRing(pl = modelPl) { if (!model || !pl) return null; return model.hull.map(([x, n]) => { const q = rotXY(x, n, pl.rot); return [pl.x + q[0], pl.n + q[1]]; }); }
  function modelBase(pl = modelPl) { // sol sous le modèle: point le plus bas du relief sous l'emprise (sommets et grille de 2 m)
    const ring = modelRing(pl); if (!ring) return 0;
    let mn = Infinity, minx = Infinity, maxx = -Infinity, minn = Infinity, maxn = -Infinity;
    ring.forEach(q => { mn = Math.min(mn, terrain.hTri(q[0], q[1])); minx = Math.min(minx, q[0]); maxx = Math.max(maxx, q[0]); minn = Math.min(minn, q[1]); maxn = Math.max(maxn, q[1]); });
    for (let x = minx + 1; x < maxx; x += 2) for (let n = minn + 1; n < maxn; n += 2) if (pointInRing([x, n], ring)) mn = Math.min(mn, terrain.hTri(x, n));
    return mn;
  }
  function placeModel() {
    if (!model || !modelPl) return;
    model.group.position.set(modelPl.x, modelBase() + modelPl.dy, -modelPl.n); model.group.rotation.set(0, -modelPl.rot * Math.PI / 180, 0); model.group.updateMatrixWorld(true);
    dirty = true;
  }
  // Axe principal d'un contour (côté long du plus petit rectangle qui l'entoure), en degrés depuis le nord, modulo 180.
  function mainAxis(ring) {
    let best = null;
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length], L0 = Math.hypot(b[0] - a[0], b[1] - a[1]); if (L0 < 0.3) continue;
      const ux = (b[0] - a[0]) / L0, un = (b[1] - a[1]) / L0; let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
      ring.forEach(q => { const u = q[0] * ux + q[1] * un, v = -q[0] * un + q[1] * ux; u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v); });
      const area = (u1 - u0) * (v1 - v0); if (!best || area < best.area) best = { area, deg: (Math.atan2(u1 - u0 >= v1 - v0 ? ux : -un, u1 - u0 >= v1 - v0 ? un : ux) * 180 / Math.PI + 360) % 180 };
    }
    return best ? best.deg : 0;
  }
  // Placement par défaut: calé sur la première forme dessinée (sinon l'édifice Overture sous le point du projet): centres
  // superposés, et parmi les quatre rotations qui alignent les axes principaux, celle qui recouvre le mieux la forme. Sans
  // forme: la géolocalisation du fichier si elle tombe à moins de 2 km du projet, sinon le point du projet. Toujours au sol.
  function defaultPlacement() {
    const drawn = origin ? localRings(projLocal, origin) : [];
    let target = drawn.length ? drawn[0].p : null;
    if (!target && data) { const under = data.bld.filter(b => b[3] !== 2).find(([q]) => pointInRing([0, 0], q)); if (under) target = under[0]; }
    if (target) {
      const tc = areaCenter(target), ta = mainAxis(target), ma = mainAxis(model.hull);
      let best = null;
      for (let k = 0; k < 4; k++) {
        const rot = (((ta - ma + 90 * k) % 360) + 360) % 360, r0 = modelRing({ x: 0, n: 0, rot }), hc = areaCenter(r0), pl = { x: tc[0] - hc[0], n: tc[1] - hc[1], rot, dy: 0 }, ring = modelRing(pl);
        let minx = Infinity, maxx = -Infinity, minn = Infinity, maxn = -Infinity; [...ring, ...target].forEach(q => { minx = Math.min(minx, q[0]); maxx = Math.max(maxx, q[0]); minn = Math.min(minn, q[1]); maxn = Math.max(maxn, q[1]); });
        let both = 0, any = 0; for (let x = minx; x <= maxx; x += 0.5) for (let n = minn; n <= maxn; n += 0.5) { const a = pointInRing([x, n], ring), b = pointInRing([x, n], target); if (a && b) both++; if (a || b) any++; }
        const iou = any ? both / any : 0; if (!best || iou > best.iou + 1e-6) best = { iou, pl };
      }
      return best.pl;
    }
    const g = model.geo;
    if (g && origin) {
      const mLng = 111320 * Math.cos(origin[0] * Math.PI / 180), gx = (g.lon - origin[1]) * mLng, gn = (g.lat - origin[0]) * 111320;
      if (Math.hypot(gx, gn) < 2000) { const o = rotXY(model.offset[0], model.offset[1], g.heading || 0); return { x: gx + o[0], n: gn + o[1], rot: ((g.heading || 0) % 360 + 360) % 360, dy: 0 }; }
    }
    return { x: 0, n: 0, rot: 0, dy: 0 };
  }
  const gltfLoader = new GLTFLoader();
  async function modelGroup(glb) {
    const gltf = await gltfLoader.parseAsync(glb, '');
    const group = new THREE.Group(); group.add(gltf.scene);
    const done = new Set(), win = []; // matériaux déjà préparés (un matériau peut servir à plusieurs maillages); vitres « -fenetre »
    gltf.scene.traverse(o => {
      if (!o.isMesh) return;
      // Normales plates calculées au chargement (le fichier n'en porte pas): ombrage net et biais d'ombre le long de la normale.
      if (o.geometry.index) { const g = o.geometry.toNonIndexed(); o.geometry.dispose(); o.geometry = g; }
      o.geometry.computeVertexNormals();
      const m = o.material;
      if (!done.has(m)) {
        done.add(m); m.flatShading = false; m.envMapIntensity = 0.75;
        if (m.transparent) {
          // Verre libre: l'alpha de l'image de la scène (masque des flaques) reste celui de ce qui est derrière.
          m.depthWrite = false; m.blending = THREE.CustomBlending; m.blendSrc = THREE.SrcAlphaFactor; m.blendDst = THREE.OneMinusSrcAlphaFactor; m.blendSrcAlpha = THREE.ZeroFactor; m.blendDstAlpha = THREE.OneFactor;
          modelShadow(m, 'verre-modele');
        } else {
          lampLit(m, 'modele'); modelShadow(m, 'lamp-modele');
          // Vitre de fenêtre: allumée la nuit comme les fenêtres des murs (même teinte, même courbe, voir frame).
          if (/-fenetre$/.test(m.name || '')) { m.emissive.set('#ffe2b0'); m.emissiveIntensity = 0; win.push(m); }
        }
      }
      o.castShadow = !m.transparent; if (m.transparent) o.renderOrder = 2;
      o.receiveShadow = true;
    });
    return { group, win };
  }
  function dropModel() {
    modelDrag = null;
    if (!model) return;
    S.remove(model.group); model.group.traverse(o => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } }); model = null;
  }
  // Après un déplacement: voisins, formes et arbres sous la maison recalculés (sans bouger la caméra), un peu plus tard.
  function modelChanged() { clearTimeout(modelTimer); modelTimer = setTimeout(() => { if (running) rebuild(true, true); }, 350); }

  // modelOnly: seul le modèle a changé (place, rotation, hauteur, ajout, retrait): relief et eau gardés tels quels.
  function rebuild(keepView, modelOnly) {
    clearStatics();
    if (!modelOnly) { terrain.carveWater(data ? data.water : []); buildGround(); } // le relief est creusé sous les plans d'eau connus
    if (!origin) return;
    if (model) placeModel();
    // La maison importée remplace la forme dessinée et l'édifice Overture qu'elle recouvre; les arbres sous elle disparaissent.
    const mRing = model ? modelRing() : null, underModel = (ring) => !!mRing && ringsOverlap(mRing, ring);
    const treeFree = ([x, n]) => !mRing || (!pointInRing([x, n], mRing) && !mRing.some((q, i) => segDist([x, n], q, mRing[(i + 1) % mRing.length]) < 2));
    // Formes dessinées (Forme 1, Forme 2... dans l'ordre du projet), en mètres autour de l'origine.
    const drawn = localRings(projLocal, origin);
    // Hauteur: valeur réglée dans la pastille FORME, sinon hauteur mesurée Overture du même édifice (30 m est le défaut du
    // dessin, jamais une vraie hauteur: Stéphane ne la connaît pas), sinon 9 m. Couleur des murs: choisie dans la pastille,
    // sinon brique. Fenêtres sobres: une rangée par étage de 3,6 m, une travée par 8 m.
    const list = []; projInfo = [];
    drawn.forEach((d, i) => {
      if (underModel(d.p)) return;
      const hits = data ? data.bld.filter(([p, , , k]) => k !== 2 && ringsOverlap(d.p, p)) : [];
      const top = hits.length ? hits.reduce((a, b) => (b[1] > a[1] ? b : a)) : null; // le plus haut des bâtiments recouverts
      const measured = top ? top[1] : null;
      let h, src;
      if (!d.def) { h = d.h; src = 'réglée dans le projet'; } else if (measured != null) { h = measured; src = top[4] ? 'mesurée (LiDAR)' : 'estimée (OpenStreetMap)'; } else { h = 9; src = 'par défaut'; }
      h = Math.max(3, h); d.hEff = h; // hauteur dessinée (sert aussi à la visée du toit dans pickView)
      const fl = Math.max(1, Math.floor(h / 3.6)); // une rangée de fenêtres par étage de 3,6 m environ (jamais étirée)
      const wallHex = (projLocal[d.i] && projLocal[d.i].wallColor) || '#7a3f33', base = groundOf(d.p).mean;
      edgesOf(d.p).forEach(e => projInfo.push({ dir: e.dir, len: e.len, mid: e.mid, nrm: e.nrm, label: `Forme ${i + 1}`, h, src, base }));
      list.push({ p: d.p, h, fl, bay: 8, col: L(wallHex), rc: L('#5a5650'), allLit: true, unmapped: !hits.length }); // l'édifice photographié: toutes les fenêtres allumées la nuit; unmapped: absent d'Overture (clearance.js)
    });
    // Les façades allumées éclairent les alentours: une lumière surfacique chaude par façade (les plus longues d'abord),
    // devant le mur, à mi-hauteur, dirigée vers l'extérieur; intensité suivant celle des fenêtres (voir frame).
    const walls = []; projInfo.forEach(e => { if (e.len >= 4) walls.push(e); });
    // La maison importée aussi: côtés de son enveloppe, sur la hauteur du modèle, depuis sa pose au sol.
    if (mRing) { const r = signedArea(mRing) < 0 ? mRing.slice().reverse() : mRing, base = model.group.position.y; edgesOf(r).forEach(e => { if (e.len >= 4) walls.push({ ...e, h: model.h, base }); }); }
    walls.sort((a, b) => b.len - a.len);
    walls.slice(0, (window.matchMedia && window.matchMedia('(hover: none)').matches) ? 6 : 12).forEach(e => {
      const l = new THREE.RectAreaLight(0xffd9a0, 0, e.len * 0.9, e.h * 0.7); const nx = e.nrm[0], nz = -e.nrm[1];
      l.position.set(e.mid[0] + nx * 0.4, e.base + e.h * 0.5, -e.mid[1] + nz * 0.4); l.lookAt(l.position.x + nx, l.position.y, l.position.z + nz); l.visible = false; S.add(l); winLights.push(l);
    });
    const others = []; let kept = []; treeEnv = [];
    if (data) {
      data.bld.forEach(([p, h, fl, k, lid]) => {
        // Un voisin recouvert par un bâtiment dessiné disparaît: c'est le même édifice.
        const c = centroid(p);
        if (drawn.some(d => ringsOverlap(d.p, p)) || underModel(p)) return;
        others.push(p);
        const q = p[0], r = hsh(q[0], q[1], 5); const hh = k === 0 && !lid ? Math.max(h, 6.2) : h; // hauteur mesurée (LiDAR): telle quelle
        list.push({ p, h: hh, fl: Math.max(1, Math.min(k === 0 ? Math.max(fl, Math.round(hh / 3.1)) : fl, Math.floor(hh / 3.2))), col: L(k === 2 ? '#9a9a94' : k === 1 ? '#cfc7b8' : PAL_RES[Math.floor(r * PAL_RES.length)]), rc: L(ROOF[Math.floor(hsh(q[0], q[1], 6) * ROOF.length)]) });
      });
      Object.keys(GC).forEach(k => addFlat(data.green.filter(p => p.k === k).map(p => ({ o: p.p })), flatMats[k], 0.03, 1));
      addFlat(data.asphalt.map(p => ({ o: p })), flatMats.asphalt, 0.05, 2);
      // Surfaces pavées vues sur l'imagerie satellite (stationnements, aires, cours): même gris que l'asphalte, un cran dessous.
      addFlat((data.paved || []).map(p => { const v = p.o ? p : { o: p, h: [] }; return { o: regularizeRing(v.o), h: (v.h || []).map(h => regularizeRing(h)) }; }), flatMats.asphalt, 0.045, 3);
      addFlat(data.water.map(w => ({ o: w.o, h: w.h, hFn: terrain.waterSurface(w), nFn: terrain.upNormal })), waterMat, 0.05); // surface lisse calée sur les rives
      ribbons(data.roads.filter(r => r.k === 2), 0.1, flatMats.rail, 4); ribbons(data.roads.filter(r => r.k === 0), 0.08, flatMats.road, 5); ribbons(data.roads.filter(r => r.k === 1), 0.12, flatMats.walk, 6);
      // Formes du projet et voisins, tels que blocks() les dessine, plus la maison importée (prisme de son enveloppe, de sa
      // pose à son faîte, sans surplomb permis): ni arbre ni sous-bois ne la traversent.
      const mPrism = mRing ? [{ p: signedArea(mRing) < 0 ? mRing.slice().reverse() : mRing, h: model.h, g: { min: model.group.position.y, mean: model.group.position.y }, unmapped: true }] : [];
      const P = prisms([...list, ...mPrism], groundOf);
      if (import.meta.env.DEV && window.__scene3dCore) window.__scene3dCore.P = P; // vérification en développement
      const cg = data.canopy ? decodeCanopy(data.canopy) : null; // peuplements de la carte écoforestière (sous-bois, forme des couronnes)
      kept = trees(mRing ? data.trees.filter(treeFree) : data.trees, P, cg);
      if (cg) canopyFill(cg, data.trees, P);
      treeEnv = kept;
      lamps(data.roads, data.bld);
    }
    blocks(list);
    // Point de vue sur la première forme dessinée; sans forme, sur l'édifice (Overture) sous le point du projet, sinon le plus proche à moins de 60 m.
    let focus = mRing || (drawn.length ? drawn[0].p : null), focusH = mRing ? model.h : drawn.length ? (drawn[0].hEff ?? 9) : 9;
    if (!focus && data) {
      const cand = data.bld.filter(b => b[3] !== 2);
      const under = cand.find(([p]) => pointInRing([0, 0], p)) || cand.map(b => ({ b, d: Math.hypot(...centroid(b[0])) })).sort((a, b) => a.d - b.d).find(x => x.d < 60)?.b;
      if (under) { focus = under[0]; focusH = under[1]; }
    }
    // Les autres formes du projet comptent comme obstacles, sauf celles qui chevauchent la première (tour sur un socle,
    // bâtiment en L dessiné en deux rectangles): c'est le même sujet, on ne place pas la caméra dedans, mais il ne bouche
    // pas la vue sur lui-même. Avec une maison importée, la forme qu'elle recouvre fait partie du sujet.
    const subj = focus ? drawn.map(d => d.p).filter(r => r !== focus && ringsOverlap(r, focus)) : [];
    if (!keepView) pickView(focus || [], [...others, ...drawn.map(d => d.p)].filter(r => r !== focus && !subj.includes(r)), data ? data.roads : [], kept, subj, focusH);
    if (sat) { if (!modelOnly || !satObj) placeSat(); else satTrees(); }
    cloudLift = Math.max(150, terrain.maxWithin(1000) - T0.y + 60); // les nuages passent au-dessus des collines voisines
    dirty = true;
  }

  // ---- interaction: un doigt (ou la souris) tourne et monte, deux doigts pincent pour s'approcher, molette ou
  // trackpad aussi; les boutons + et - de la fenêtre passent par zoom(). Distance bornée par clampR.
  const el = R.domElement; const ptrs = new Map(); let pinch = null;
  // La maison importée se déplace en la glissant; ailleurs, la vue tourne. Le déplacement à l'écran devient un déplacement
  // au sol: gauche-droite le long de la droite de la caméra, haut-bas le long de son avant (vers le haut = plus loin), à
  // l'échelle de la maison saisie (distance / focale en pixels). Pas de plan à la hauteur du point saisi: à hauteur d'oeil,
  // il passe au-dessus de la caméra (sens inversé, maison figée ou projetée à des centaines de mètres).
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), rtV = new THREE.Vector3();
  const pickModel = (e) => { if (!model) return null; const r = el.getBoundingClientRect(); ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1); ray.setFromCamera(ndc, cam); const h = ray.intersectObject(model.group, true); return h.length ? h[0] : null; };
  const startModelDrag = (e, hit) => {
    const f = el.getBoundingClientRect().height / (2 * Math.tan(cam.fov * Math.PI / 360)); // focale en pixels (CSS)
    rtV.setFromMatrixColumn(cam.matrixWorld, 0); rtV.y = 0; if (rtV.lengthSq() < 1e-8) rtV.set(1, 0, 0); rtV.normalize();
    // Droite et avant horizontaux en (est, nord): three z = -n, avant = vertical x droite.
    return { id: e.pointerId, x0: e.clientX, y0: e.clientY, lx: e.clientX, ly: e.clientY, moved: false, k: Math.max(5, cam.position.distanceTo(hit.point)) / f, rt: [rtV.x, -rtV.z], fw: [rtV.z, rtV.x], pl0: { ...modelPl } };
  };
  // Glisser annulé (Échap, deuxième doigt, pointeur perdu): la maison revient à sa place d'avant, rien n'est enregistré.
  const cancelModelDrag = () => {
    const md = modelDrag; if (!md) return; modelDrag = null;
    if (md.moved && model && modelPl) { modelPl.x = md.pl0.x; modelPl.n = md.pl0.n; placeModel(); }
    el.style.cursor = 'grab';
  };
  el.addEventListener('pointerdown', e => {
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY }); try { el.setPointerCapture(e.pointerId); } catch (err) { /* pointeur déjà parti */ }
    if (ptrs.size >= 2) { cancelModelDrag(); const [a, b] = [...ptrs.values()]; pinch = { d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, r0: Rr }; drag = null; return; }
    const hit = e.button === 0 ? pickModel(e) : null;
    if (hit) { modelDrag = startModelDrag(e, hit); el.style.cursor = 'move'; return; }
    drag = { x: e.clientX, y: e.clientY, id: e.pointerId }; el.style.cursor = 'grabbing';
  });
  el.addEventListener('pointermove', e => {
    const p = ptrs.get(e.pointerId); if (p) { p.x = e.clientX; p.y = e.clientY; }
    if (modelDrag && e.pointerId === modelDrag.id) {
      const md = modelDrag;
      if (!md.moved) { if (Math.hypot(e.clientX - md.x0, e.clientY - md.y0) < 4) return; md.moved = true; } // simple clic: rien ne bouge
      let dx = e.clientX - md.lx, dy = e.clientY - md.ly; md.lx = e.clientX; md.ly = e.clientY;
      const l = Math.hypot(dx, dy); if (l > 80) { dx *= 80 / l; dy *= 80 / l; } // garde: un saut du pointeur ne projette pas la maison au loin
      let x = modelPl.x + (dx * md.rt[0] - dy * md.fw[0]) * md.k, n = modelPl.n + (dx * md.rt[1] - dy * md.fw[1]) * md.k;
      const ox = x - md.pl0.x, on = n - md.pl0.n, d = Math.hypot(ox, on); if (d > 400) { x = md.pl0.x + ox * 400 / d; n = md.pl0.n + on * 400 / d; } // au plus 400 m par geste
      modelPl.x = x; modelPl.n = n; placeModel();
      return;
    }
    if (!ptrs.size && model) el.style.cursor = pickModel(e) ? 'move' : 'grab';
    if (pinch && ptrs.size >= 2) { const [a, b] = [...ptrs.values()]; const d = Math.hypot(a.x - b.x, a.y - b.y) || 1; Rr = clampR(pinch.r0 * pinch.d0 / d); dirty = true; return; }
    if (!drag || e.pointerId !== drag.id) return;
    az += (e.clientX - drag.x) * 0.008; camH = Math.max(1.2, Math.min(320, camH + (e.clientY - drag.y) * 0.6)); drag = { x: e.clientX, y: e.clientY, id: drag.id }; dirty = true;
  });
  const endPtr = (e, cancel) => {
    if (modelDrag && e.pointerId === modelDrag.id) {
      if (cancel) cancelModelDrag();
      else { const moved = modelDrag.moved; modelDrag = null; if (moved) { rebuild(true, true); onModel({ ...modelPl }); } } // validé seulement s'il a bougé
    }
    ptrs.delete(e.pointerId); if (ptrs.size < 2) pinch = null; if (drag && e.pointerId === drag.id) drag = null;
    if (ptrs.size === 1 && !drag) { const [[id, p]] = [...ptrs.entries()]; drag = { x: p.x, y: p.y, id }; } // le doigt restant continue à tourner
    if (!ptrs.size) el.style.cursor = 'grab';
  };
  el.addEventListener('pointerup', e => endPtr(e, false)); el.addEventListener('pointercancel', e => endPtr(e, true));
  // Capture perdue en plein glisser (elle est relâchée d'office après pointerup, le glisser est alors déjà fini): annulé.
  el.addEventListener('lostpointercapture', e => { if (modelDrag && e.pointerId === modelDrag.id) cancelModelDrag(); });
  // Échap pendant le glisser: annulé, et la touche ne va pas plus loin (elle fermerait la carte plein écran).
  const onKey = (e) => { if (e.key === 'Escape' && modelDrag) { e.preventDefault(); e.stopPropagation(); cancelModelDrag(); } };
  window.addEventListener('keydown', onKey, true);
  el.addEventListener('wheel', e => { e.preventDefault(); Rr = clampR(Rr * Math.exp(e.deltaY * 0.0015)); dirty = true; }, { passive: false });

  const vF = new THREE.Vector3(); let last = performance.now(), raf = 0;
  function frame(now) {
    if (!running) return; raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    const a = 1 - Math.exp(-dt * 3.5); let moving = false;
    ['cum', 'mid', 'high', 'iv', 'rain', 'wet', 'pud', 'fogK', 'fogTh', 'smk', 'storm', 'brk'].forEach(k => { const d = tg[k] - cur[k]; if (Math.abs(d) > 0.0005) { cur[k] += d * a; moving = true; } else cur[k] = tg[k]; });
    if (!dirty && !moving && now - envAt > 400) {
      // Rien d'autre ne bouge: sous la pluie, seules les gouttes avancent (composition et lissage refaits, pas la scène),
      // 30 fois par seconde au plus (environ 1,5 ms de calcul graphique chaque fois), et seulement si la 3D est à l'écran.
      if (cur.rain * (1 - RAIN_BRK * cur.brk) > 0.005 && compRT && onScreen && now - rainAt >= 32) { rainAt = now; compMat.uniforms.uTime.value = (now / 1000) % 60; pass(compMat, compRT); pass(fxMat, null); }
      return; // sinon rien à redessiner: on laisse le processeur tranquille
    }
    dirty = false;
    const cum = cur.cum, mid = cur.mid, high = cur.high, iv = cur.iv, veil = Math.max(mid, high);
    const sp = SunCalc.getPosition(new Date(dateMs), lat, lng); const bearing = sp.azimuth + Math.PI; // azimut depuis le nord, sens horaire
    const realDeg = sp.altitude * 180 / Math.PI, el = Math.max(sp.altitude, 0.6 * Math.PI / 180), eld = el * 180 / Math.PI;
    const d = new THREE.Vector3(Math.sin(bearing) * Math.cos(el), Math.sin(el), -Math.cos(bearing) * Math.cos(el));
    const night = realDeg < -0.8, twi = smooth(2, -5, realDeg), nightF = smooth(-7, -15, realDeg), glow = 1 - smooth(-5, -10, realDeg);
    // Brume (turbidité) un peu plus forte sous le voile; extinction du soleil direct selon sa hauteur.
    // Fumée de feux (smk, 0 à 1): air plus trouble (soleil plus rouge, ciel plus blanc), soleil direct affaibli selon
    // l'épaisseur de fumée traversée (épaisseur optique d'environ 0,008 par microgramme, 3 au plus), lumière plus chaude.
    const smk = cur.smk, smokeT = smk > 0 && smokeUg > 0 ? Math.exp(-Math.min(3, 0.008 * smokeUg) * smk / Math.max(Math.sin(el), 0.05)) : 1;
    const turb = Math.min(10, 2.3 + 2.0 * high + 0.8 * mid + 6 * smk), Fx = sunExtinction(Math.sin(el), turb, 1.5), fxm = Math.max(Fx[0], Fx[1], Fx[2], 1e-4);
    // Brouillard: nappe posée sur le sol du projet, 600 m au plus (sans nappe mesurée: brume de 600 m). Sous une nappe, la lumière d'ambiance
    // devient grise comme sous un ciel couvert (cumS), selon l'épaisseur traversée à la verticale.
    const fogSig = cur.fogK / 1000, g0 = terrain.hTri(0, 0), fogThick = cur.fogTh, fogTopW = g0 + fogThick;
    const fogT = fogSig > 0 ? Math.exp(-fogSig * fogThick / Math.max(Math.sin(el), 0.05)) : 1;
    const cumS = Math.max(cum, fogSig > 0 ? 1 - Math.exp(-fogSig * fogThick) : 0);
    const fe = Math.pow(0.2126 * Fx[0] + 0.7152 * Fx[1] + 0.0722 * Fx[2], 0.7), Idir = night ? 0 : 10 * fe * iv * fogT * smokeT; sunL.intensity = Idir;
    // Couleur du soleil direct: extinction adoucie (Preetham rougit trop au ras de l'horizon) et un peu de blanc gardé.
    const sunRGB = Fx.map((v, i) => (0.85 * Math.pow(v / fxm, 0.45) + 0.15) * (1 - [0, 0.18, 0.4][i] * smk)), sc0 = mixHex('#' + sunRGB.map(v => Math.round(v * 255).toString(16).padStart(2, '0')).join(''), '#eeebe4', (1 - iv) * 0.6); sunL.color.copy(L(sc0));
    skyMat.uniforms.uTurb.value = turb; skyMat.uniforms.uSmoke.value = smk;
    // Niveau du ciel: le modèle donne les couleurs et leur répartition, notre courbe donne la luminance du zénith
    // (0,17 en plein jour, encore 0,04 au ras de l'horizon), sinon le zénith s'éteint au soleil bas et l'horizon blanchit.
    const sunV = [Math.sin(bearing) * Math.cos(el), Math.sin(el), -Math.cos(bearing) * Math.cos(el)];
    const zenTarget = 0.035 + 0.14 * Math.pow(clamp(Math.sin(el) / 0.45), 0.55), zenLum = LUM(preethamRadiance([0, 1, 0], sunV, turb, 1.5));
    const skyK = zenTarget / Math.max(1e-5, zenLum); skyMat.uniforms.uSkyK.value = skyK; skyMat.uniforms.uZen.value = zenTarget;
    // Zone d'ombre qui suit la caméra: 300 m autour du projet à hauteur d'oeil (7 cm par pixel d'ombre), jusqu'à 1 400 m
    // en vue haute ou lointaine (sinon, au-delà du carré, ni les bâtiments ni les nuages n'ont d'ombre: « ça coupe net »).
    // Paliers de 50 m pour que la grille d'ombre ne tremble pas à chaque mouvement; profondeur, biais et pénombre suivent.
    const SR = Math.ceil(Math.max(150, Math.min(700, 0.9 * Rr + 0.8 * camH + 60)) / 50) * 50;
    sc.left = -SR; sc.right = SR; sc.top = SR; sc.bottom = -SR;
    // Profondeur: plage fixe SHADOW_SPAN (10 km) vers le soleil, pour qu'une colline ou une montagne jusqu'à 9 km dans sa
    // direction porte son ombre sur le site (texture de profondeur 24 bits: moins d'un millimètre par pas); le biais garde
    // sa valeur en mètres et le shader PCSS est calé sur cette plage.
    const dist = SHADOW_SPAN + 200; sunL.position.copy(T0).addScaledVector(d, dist); sc.far = dist + 1.75 * SR; sc.near = sc.far - SHADOW_SPAN; sc.updateProjectionMatrix();
    sunL.shadow.bias = -0.0006 * 487.5 / SHADOW_SPAN; sunL.shadow.normalBias = 0.5 * Math.min(2.5, SR / 150);
    mdlNB.value = Math.max(0.04, 1.4 * SR / sunL.shadow.mapSize.x); // modèle importé: 0,7 pixel d'ombre, 4 cm au moins
    // Modèle importé (voir modelShadow): direction du soleil, biais du décor en mètres (profondeur normalisée x plage de la
    // caméra d'ombre, environ 0,29 m) et demi-pixel d'ombre en mètres (4 à 17 cm selon la zone).
    sunL.shadow.radius = (1 + 7 * Math.pow(1 - iv, 1.3) + 1.5 * cum) * Math.max(0.35, 150 / SR); // taille apparente du soleil pour la pénombre: vraie au soleil franc, élargie sous le voile et les nuages; en texels, donc ramenée quand la zone s'élargit
    // Biais propre au modèle: demi-texel d'ombre multiplié par le rayon de pénombre (le filtre PCSS lit jusque-là), après le calcul du rayon.
    mdlSun.value.copy(d); mdlGB.value = -sunL.shadow.bias * (sc.far - sc.near); mdlHT.value = 0.5 * (sc.right - sc.left) / sunL.shadow.mapSize.x * Math.max(1, sunL.shadow.radius);
    // Orage sans percée (soleil moins du cinquième de l'heure): tous les groupes d'ombre, le projet est à l'ombre des nuages.
    const nb = tg.storm >= 0.45 && !tg.brk ? 60 : Math.min(60, Math.round(cum * 110)), hh = cloudLift / Math.max(d.y, 0.08); blobs.forEach((g, i) => { g.visible = i < nb; const u = g.userData; g.position.set(T0.x + u.gx + d.x * hh, T0.y + cloudLift, T0.z + u.gz + d.z * hh); });
    // Caméra à hauteur camH au-dessus du sol sous elle: elle suit la pente en tournant autour du sujet.
    const cx = ct.x + Math.sin(az) * Rr, cz = ct.z - Math.cos(az) * Rr; cam.position.set(cx, terrain.hTri(cx, -cz) + camH, cz); cam.lookAt(ct); cam.updateMatrixWorld(); cam.getWorldDirection(vF); sky.position.copy(cam.position);
    // Percée (8 octobre 2026): si la prévision donne du soleil au moins le cinquième de l'heure, les groupes dont l'ombre
    // toucherait le projet ou le disque de rayon brkR autour de lui sont retirés; les autres restent (la percée est locale,
    // le lointain reste à l'ombre). Le disque ne suit ni le zoom ni la caméra: tourner ne fait naître aucune ombre.
    let camSun = 1, subjSun = 1;
    if (nb > 0 && !night) {
      const bk = [tg.brk, nb, brkR, d.x.toFixed(3), d.y.toFixed(3), d.z.toFixed(3), T0.x.toFixed(1), T0.y.toFixed(1), T0.z.toFixed(1), ct.y.toFixed(1)].join(',');
      if (bk !== brkKey) {
        brkKey = bk; brkHide = new Set();
        if (tg.brk) {
          const pts = [new THREE.Vector3(T0.x, T0.y + 2, T0.z), ct.clone(), new THREE.Vector3(T0.x, T0.y + Math.max(2, 2 * (ct.y - T0.y)), T0.z)];
          for (let k = 0; k < 16; k++) { const q = k * Math.PI / 8, x = T0.x + Math.sin(q) * brkR, z = T0.z - Math.cos(q) * brkR; pts.push(new THREE.Vector3(x, terrain.hTri(x, -z) + 1.7, z)); }
          blobs.forEach((g, i) => { if (i < nb && pts.some(P => blobHit(g, P, d, BRK_M))) brkHide.add(i); });
        }
      }
      brkHide.forEach(i => { blobs[i].visible = false; });
      camSun = blobs.some(g => g.visible && blobHit(g, cam.position, d, 0)) ? 0 : 1;
      subjSun = blobs.some(g => g.visible && blobHit(g, ct, d, 0)) ? 0 : 1;
    }
    // Caméra à l'ombre d'un nuage: un nuage cache le soleil dans le ciel (trouée refermée, disque, flare et disque dans la
    // fumée éteints). Percée prévue et caméra au soleil: trouée ouverte autour du soleil. Sinon, le ciel d'avant.
    const gapT = nb > 0 && !night ? (!camSun ? -1 : tg.brk ? 1 : 0) : 0;
    if (Math.abs(gapT - gapS) > 0.002) { gapS += (gapT - gapS) * a; dirty = true; } else gapS = gapT;
    const sunVis = 1 + Math.min(0, gapS); // comme le disque du ciel (disc *= 1 - max(-uSunGap, 0))
    // Sous une base d'orage, peu de lumière vient du ciel (la base épaisse ne laisse passer que quelques pour cent): ambiance
    // réduite et teintée ardoise, le soleil direct de la percée reste entier, d'où le contraste. Exposition pour le projet:
    // au soleil s'il y est, pour l'ombre si un nuage d'orage le couvre.
    const ambK = 1 - AMB_CUT * cur.storm;
    fill.intensity = (0.2 + 1.1 * Math.max(cumS, veil) * Math.min(1, Math.sin(el) / 0.3)) * (1 - 0.5 * twi) * ambK;
    fill.color.setRGB(0.86, 0.90, 1.0).lerp(new THREE.Color(0.9, 0.9, 0.9), Math.max(cumS, veil)).lerp(new THREE.Color(0.78, 0.84, 0.95), 0.6 * cur.storm).lerp(new THREE.Color(1.0, 0.86, 0.68), 0.6 * smk); // ciel bleuté, gris sous les nuages ou le brouillard, ardoise sous l'orage, chaud sous la fumée
    fill.groundColor.copy(GROUND_TINT).multiplyScalar((0.5 + 1.3 * iv * (subjSun ? 1 : 1 - 0.7 * cur.storm) * Math.min(1, Math.sin(el) / 0.5)) * (1 - 0.6 * twi)); // rebond du sol
    const ambB = (0.3 + 0.55 * Math.min(1, Math.sin(el) / 0.5)) * (1 + 0.3 * Math.max(cumS, veil)) * ambK, IdirE = Idir * (subjSun ? 1 : 1 - 0.8 * cur.storm); const tot = (IdirE / Math.PI * 0.5 + ambB) / 2.2;
    compMat.uniforms.uExp.value = Math.max(0.5, Math.min(1.15 - 0.4 * twi, 0.64 * Math.pow(1 / Math.max(0.05, Math.min(1, tot)), 0.3)));
    const U = skyMat.uniforms, dk = 0.5 + 0.5 * clamp((realDeg + 1) / 14), uW = clamp(1 - (realDeg - 1) / 22);
    U.uCum.value = cam.position.y > fogTopW + 10 ? cum : cumS; U.uMid.value = mid; U.uHigh.value = high; U.uDirect.value = iv; U.uWarm.value = uW; U.uTw.value = twi; U.uNight.value = nightF; U.uGlow.value = glow; // au-dessus de la nappe, le ciel reste celui des nuages
    U.uStorm.value = cur.storm; U.uSunGap.value = gapS > 0 ? gapS * smooth(0.05, 0.3, iv) : gapS; U.uGapR.value = 0.07 + 0.12 * Math.sin(el); // trouée de 4° au ras de l'horizon à 11° haut dans le ciel
    wallMat.emissiveIntensity = 0.62 * smooth(1, -4, realDeg); // fenêtres chaudes, pas blanches
    uNight.value = smooth(1, -4, realDeg); // fenêtres discrètes le jour, d'origine dès la tombée du jour
    winLights.forEach(l => { l.intensity = 0.32 * wallMat.emissiveIntensity / 0.62; l.visible = l.intensity > 0.01; }); // lumière des fenêtres sur le sol, les arbres et les voisins
    if (model) model.win.forEach(m => { m.emissiveIntensity = wallMat.emissiveIntensity; }); // vitres du modèle importé
    // Lampadaires et lueur de la ville: même allumage que les fenêtres, à petite dose (on devine les rues et les volumes).
    const lampK = uNight.value, city = urban * lampK;
    lampU.uLampK.value = LAMP_LIGHT * lampK; lampHeadMat.opacity = lampK; lampMeshes.forEach(m => { m.visible = lampK > 0.01; });
    fill.intensity += CITY_FILL * city; fill.groundColor.lerp(CITY_GLOW, 0.55 * city);
    const soft = twi * (1 - nightF); twL.intensity = 1.8 * soft; twL.color.copy(L(mixHex('#9fb0e0', '#e8bc92', glow * 0.5)));
    twL.target.position.copy(T0); twL.position.copy(T0).add(new THREE.Vector3(Math.sin(bearing) * Math.cos(0.17), Math.sin(0.17), -Math.cos(bearing) * Math.cos(0.17)).multiplyScalar(400));
    const sDir = new THREE.Vector3(Math.sin(bearing) * Math.cos(sp.altitude), Math.sin(sp.altitude), -Math.cos(bearing) * Math.cos(sp.altitude)); U.uSun.value.copy(sDir); const sc1 = rgb(sc0); U.uSunCol.value.set(sc1[0], sc1[1], sc1[2]);
    const key = [cumS, mid, high, iv, uW, dk, sDir.x, sDir.y, smk, cur.storm].map(v => v.toFixed(2)).join(','); if (key !== envKey && now - envAt > 120) { envKey = key; envAt = now; const uc = U.uCum.value, ug = U.uSunGap.value; U.uCum.value = cumS; U.uSunGap.value = 0; updateEnv(); U.uCum.value = uc; U.uSunGap.value = ug; } // la trouée autour du soleil ne compte pas dans la lumière d'ambiance
    const cgv = Math.max(0, new THREE.Vector3(vF.x, 0, vF.z).normalize().dot(sDir)), thick = 1 - iv;
    // Brouillard: couleur de l'horizon du même ciel physique dans la direction regardée (épaule comme dans le shader),
    // puis voile, cumulus, heure bleue et nuit comme le ciel; tout en linéaire.
    const fdir = new THREE.Vector3(vF.x, 0.04, vF.z).normalize(), lin = (c) => c.map(v => Math.pow(v, 2.2));
    // Le sol lointain est nettement plus sombre que le ciel juste au-dessus de l'horizon (sinon brume blanche): 0,45 fois l'horizon;
    // sous un voile ou des cumulus, la base grise des nuages, comme dans le ciel.
    // Brouillard: même horizon que le ciel (chromaticité adoucie à 70 %, luminance 2,4 fois le zénith), un peu plus sombre (0,45).
    const hp = preethamRadiance([fdir.x, fdir.y, fdir.z], sunV, turb, 1.5), lph = Math.max(LUM(hp), 1e-6); let hc = hp.map(v => (v / lph * 0.3 + 0.7) * zenTarget * 2.4); const hl = LUM(hc); hc = hc.map(v => 0.45 * v / (1 + 0.5 * hl)); const hc0 = hc.slice();
    let vc = mv([0.88, 0.89, 0.90], [0.64, 0.66, 0.69], thick); vc = mv(vc, mv([0.62, 0.62, 0.66], [0.95, 0.72, 0.55], 0.6), uW * 0.5);
    hc = mv(hc, lin(vc).map(v => v * 0.55), veil * (0.45 + 0.52 * thick * thick)); hc = mv(hc, lin([0.50, 0.54, 0.60]).map(v => v * 0.65), smooth(0.25, 0.85, cumS)); if (cur.storm > 0) hc = mv(hc.map(v => v * (1 - 0.35 * cur.storm)), hc0, 0.55 * cur.storm * (1 - smooth(0.70, 0.95, cumS))); hc = mv(hc, lin([0.11, 0.24, 0.50]).map(v => v * (0.72 + 0.55 * cgv)), twi); hc = mv(hc, lin([0.045, 0.07, 0.16]).map(v => v * (0.8 + 0.3 * cgv)), nightF); hc = mv(hc, lin([0.30, 0.21, 0.13]).map(v => v * 0.5), 0.28 * urban * nightF); fog.color.setRGB(hc[0], hc[1], hc[2]); fog.near = 250 + camH * 4; fog.far = 1500 + camH * 14; // dernier mélange: pollution lumineuse au loin, en ville
    if (cur.smk > 0) { const sl = LUM([fog.color.r, fog.color.g, fog.color.b]); fog.color.lerp(new THREE.Color(sl * 1.15, sl * 0.85, sl * 0.55), 0.6 * cur.smk); } // fumée: le voile du lointain prend aussi la teinte brun-orangé
    const rainK = cur.rain * (1 - RAIN_BRK * cur.brk); if (rainK > 0) { fog.near *= 1 - 0.6 * rainK; fog.far *= 1 - 0.5 * rainK; fog.color.lerp(new THREE.Color().setScalar(fog.color.r * 0.2126 + fog.color.g * 0.7152 + fog.color.b * 0.0722), 0.5 * rainK); } // pluie: visibilité réduite, grisaille
    lampU.uWet.value = cur.wet;
    R.setRenderTarget(sceneRT); R.render(S, cam);
    aoMat.uniforms.tDepth.value = sceneRT.depthTexture; aoMat.uniforms.uRes.value.set(PW, PH); aoMat.uniforms.uProj.value.copy(cam.projectionMatrix); aoMat.uniforms.uProjInv.value.copy(cam.projectionMatrixInverse); pass(aoMat, aoRT);
    blurMat.uniforms.tDepth.value = sceneRT.depthTexture; blurMat.uniforms.tAO.value = aoRT.texture; blurMat.uniforms.uDir.value.set(1 / PW, 0); pass(blurMat, aoRT2); blurMat.uniforms.tAO.value = aoRT2.texture; blurMat.uniforms.uDir.value.set(0, 1 / PH); pass(blurMat, aoRT);
    const glowK = wallMat.emissiveIntensity > 0.01 ? 0.55 * smooth(1, -4, realDeg) : 0; compMat.uniforms.uBloom.value = glowK;
    if (glowK > 0) { brightMat.uniforms.tCol.value = sceneRT.texture; pass(brightMat, bloomA); gblurMat.uniforms.tSrc.value = bloomA.texture; gblurMat.uniforms.uDir.value.set(1.8 / BW, 0); pass(gblurMat, bloomB); gblurMat.uniforms.tSrc.value = bloomB.texture; gblurMat.uniforms.uDir.value.set(0, 1.8 / BH); pass(gblurMat, bloomA); }
    // Flare du soleil bas (voile chaud, halo, étoile), comme sur une photo de drone: plein sous 4°, nul au-delà de 22° et
    // juste après le coucher; aussi quand le soleil est un peu hors cadre (jusqu'à 0,8 hauteur d'image). Météo: les
    // nuages bas l'éteignent, le voile d'altitude élargit la lueur et éteint l'étoile. Hors cadre, l'occultation par le
    // relief est estimée ici (dans le cadre, le shader lit la profondeur).
    const fwd = sDir.dot(vF); let kFl = 0, sunPx = 0.5, sunPy = 0.5, visCPU = 1;
    if (fwd > 0.08 && realDeg > -1.5) {
      const pS = new THREE.Vector3().copy(sDir).multiplyScalar(3000).add(cam.position).project(cam); sunPx = (pS.x + 1) / 2; sunPy = (pS.y + 1) / 2;
      const outX = Math.max(0, Math.abs(sunPx - 0.5) - 0.5) * (W / H), outY = Math.max(0, Math.abs(sunPy - 0.5) - 0.5);
      kFl = smooth(22, 4, realDeg) * smooth(-1.5, -0.3, realDeg) * smooth(0.8, 0, Math.hypot(outX, outY));
      if (kFl > 0) visCPU = terrain.blocked(cam.position.x, -cam.position.z, cam.position.y, cam.position.x + sDir.x * 9000, -cam.position.z - sDir.z * 9000, cam.position.y + sDir.y * 9000) ? 0 : 1;
    }
    // Arbre effacé tout près de l'objectif (nearFade) qui cache le soleil: le flare et le disque perdent la part que son
    // feuillage arrête vraiment (environ les trois quarts), sinon l'étoile passerait à travers un arbre réel.
    let treeSun = 1;
    if (!sat && nearU.value > 0 && (kFl > 0 || (smk > 0.1 && fwd > 0.08))) { // SOL SAT allumé: arbres cachés, rien ne fait écran
      const ex = cam.position.x, ey = cam.position.y, en = -cam.position.z, ux = sDir.x, uy = sDir.y, un = -sDir.z;
      for (const t of treeEnv) {
        const r = t[2], cy = 0.5 * (t[4] + t[5]), ry = Math.max(0.5, 0.5 * (t[5] - t[4]));
        if (Math.hypot(t[0] - ex, t[1] - en) - r > NEAR_LEAF[1] || ey < t[4] - NEAR_LEAF[1] || ey > t[5] + NEAR_LEAF[1]) continue;
        const qx = (ex - t[0]) / r, qy = (ey - cy) / ry, qn = (en - t[1]) / r, dx = ux / r, dy = uy / ry, dn = un / r;
        const A = dx * dx + dy * dy + dn * dn, B = qx * dx + qy * dy + qn * dn, C = qx * qx + qy * qy + qn * qn - 1, D = B * B - A * C;
        if (D < 0 || (-B + Math.sqrt(D)) / A <= 0) continue;
        treeSun *= 1 - 0.75 * (1 - smooth(NEAR_LEAF[0], NEAR_LEAF[1], Math.max(0, (-B - Math.sqrt(D)) / A))); // distance au feuillage le long du rayon
      }
    }
    // Reflet des flaques (beaucoup de pluie seulement): calculé ici (images complètes); les images de gouttes seules
    // réutilisent reflRT.
    const reflK = cur.pud > 0.01 ? 0.8 * cur.pud : 0;
    if (reflK > 0) { if (!skyFresh || skyGap !== U.uSunGap.value) { const uc = skyMat.uniforms.uCum.value; skyMat.uniforms.uCum.value = cumS; skyCam.update(R, skyScene); skyMat.uniforms.uCum.value = uc; skyFresh = true; skyGap = U.uSunGap.value; } // les flaques reflètent le ciel affiché, trouée comprise const RU = reflMat.uniforms; RU.tCol.value = sceneRT.texture; RU.tDepth.value = sceneRT.depthTexture; RU.uProj.value.copy(cam.projectionMatrix); RU.uProjInv.value.copy(cam.projectionMatrixInverse); RU.uUp.value.set(0, 1, 0).transformDirection(cam.matrixWorldInverse); RU.uV2W.value.setFromMatrix4(cam.matrixWorld); RU.uCamW.value.copy(cam.position); RU.uPud.value = cur.pud; RU.uTx.value.set(4 / PW, 4 / PH); pass(reflMat, reflRT2); // normale du sol mesurée sur 4 pixels: au loin, la profondeur arrondie la ferait hésiter d'une ligne à l'autre
      rblurMat.uniforms.tSrc.value = reflRT2.texture; rblurMat.uniforms.uDir.value.set(0, 1.8 / reflRT.height); pass(rblurMat, reflRT); } // flou vertical d'environ ±7 lignes
    const CU = compMat.uniforms; CU.tRefl.value = reflRT.texture; CU.uRefl.value = reflK; CU.tDepth.value = sceneRT.depthTexture; CU.uSunUV.value.set(sunPx, sunPy); CU.uAspect.value = W / H; CU.uFlare.value = kFl * (0.35 + 0.65 * iv) * (1 - 0.85 * cum) * sunVis * treeSun * (1 - 0.5 * rainK) * Math.sqrt(smokeT) * (fogSig > 0 ? Math.exp(-fogSig * Math.max(0, fogTopW - cam.position.y) / Math.max(Math.sin(el), 0.05)) : 1); CU.uRays.value = iv * iv * (1 - 0.7 * veil); CU.uVeilW.value = 1 + 1.2 * high + 0.5 * mid; CU.uVis.value = visCPU;
    CU.uDs.value = smooth(1, -4, realDeg); CU.uFog.value.set(fog.near, fog.far); // bleu désaturé: heure bleue et nuit
    // Brouillard en nappe: gris neutre plus clair que le voile habituel (lumière du ciel diffusée), lueur de la ville la nuit.
    CU.uFogSig.value = fogSig; CU.uFogTop.value = fogTopW; CU.uCamW.value.copy(cam.position); CU.uV2W.value.setFromMatrix4(cam.matrixWorld); CU.uProjInv.value.copy(cam.projectionMatrixInverse);
    // Voile de fumée: 4 m² par gramme (environ 10 km de visibilité à 100 microgrammes), brun-orangé plus clair au soleil.
    CU.uSmkSig.value = smk > 0 && smokeUg > 0 ? 4e-6 * smokeUg * smk : 0; CU.uSmkTop.value = g0 + 2500;
    // Disque du soleil dans la fumée: transmission par couleur (le bleu s'éteint 1,6 fois plus vite que le vert, le rouge
    // 0,7 fois), brillance plafonnée pour rester regardable; taille réelle (0,27 degré de rayon) un peu grossie.
    CU.uSunR.value = 0;
    if (smk > 0.1 && smokeUg > 0 && fwd > 0.08 && realDeg > -0.5) {
      // Jamais à travers les nuages, le brouillard ou la pluie (comme le flare): pas de soleil direct, pas de disque.
      const fogSunT = fogSig > 0 ? Math.exp(-fogSig * Math.max(0, fogTopW - cam.position.y) / Math.max(Math.sin(el), 0.05)) : 1;
      const tau = Math.min(3, 0.008 * smokeUg) * smk, sn = Math.max(Math.sin(sp.altitude), 0.02), T = [0.7, 1, 1.6].map(k => Math.exp(-tau * k / sn)), mx = Math.max(...T), br = Math.min(5, 3e4 * mx) * smooth(0.1, 0.4, smk) * iv * (1 - cum) * sunVis * treeSun * fogSunT * (1 - rainK);
      if (br > 0.01) { CU.uSunR.value = 1.3 * Math.tan(0.0047) / (2 * Math.tan(cam.fov * Math.PI / 360)); CU.uSunDisc.value.set(T[0] / mx * br, T[1] / mx * br, T[2] / mx * br); }
    }
    if (CU.uSmkSig.value > 0) { const scl = LUM([fog.color.r, fog.color.g, fog.color.b]) * (1.25 + 0.5 * (1 - twi)); CU.uSmkCol.value.set(scl * 1.15, scl * 0.85, scl * 0.55); }
    if (fogSig > 0) { const fcl = LUM([fog.color.r, fog.color.g, fog.color.b]); CU.uFogCol.value.set(fog.color.r, fog.color.g, fog.color.b).lerp(new THREE.Vector3(fcl, fcl, fcl), 0.65).multiplyScalar(1.6); }
    // Gouttes: un peu plus claires que l'horizon (teinte du brouillard, en affichage), penchées selon le vent.
    CU.uRain.value = rainK > 0.005 ? rainK : 0; CU.uTime.value = (now / 1000) % 60; CU.uFocal.value = PH / (2 * Math.tan(cam.fov * Math.PI / 360)); CU.uSlant.value = 0.06 + 0.22 * clamp((weatherRow?.wind ?? 10) / 50);
    if (rainK > 0) { const fl = Math.pow(fog.color.r * 0.2126 + fog.color.g * 0.7152 + fog.color.b * 0.0722, 1 / 2.2); CU.uRainCol.value.setScalar(Math.min(1, fl * 1.5 + 0.1)); }
    const sl = rgb(sc0).map(v => Math.pow(v, 2.2)); CU.uSunC.value.set(sl[0], sl[1], sl[2]);
    compMat.uniforms.tCol.value = sceneRT.texture; compMat.uniforms.tAO.value = aoRT.texture; compMat.uniforms.tBloom.value = bloomA.texture; pass(compMat, compRT);
    fxMat.uniforms.tDiffuse.value = compRT.texture; fxMat.uniforms.resolution.value.set(1 / PW, 1 / PH); pass(fxMat, null);
    if (import.meta.env.DEV && window.__scene3dCore) window.__scene3dCore.dbg = { storm: cur.storm, brk: cur.brk, pSun: tg.pSun, camSun, subjSun, gap: gapS, uExp: compMat.uniforms.uExp.value, hidden: brkHide.size }; // vérification en développement
    if (import.meta.env.DEV && window.__scene3dCore && window.__scene3dCore.afterFrame) window.__scene3dCore.afterFrame(PW, PH); // mesure en développement
    // Légende: condition de lumière, parts de nuages, position du soleil
    const w = weatherRow || {}; const low = w.cloudLow ?? null, alt = Math.max(w.cloudMid ?? 0, w.cloudHigh ?? 0), sun = w.sunFraction != null ? Math.round(w.sunFraction * 100) : null;
    const vt = tg.iv >= 0.45 ? 'Voile d’altitude léger : soleil filtré, ombres douces' : tg.iv >= 0.2 ? 'Voile épais : ombres à peine marquées' : 'Lumière plate : presque plus d’ombres';
    const mm = tg.rain > 0 ? (w.precip >= 10 ? String(Math.round(w.precip)) : String(Math.round(w.precip * 10) / 10).replace('.', ',')) : null;
    // Seuils d'Environnement Canada: faible sous 2,5 mm/h, modérée jusqu'à 7,5 mm/h, forte au-delà.
    const rainTxt = mm == null ? '' : `Pluie ${w.precip >= 7.5 ? 'forte' : w.precip >= 2.5 ? 'modérée' : 'faible'}, ${mm} mm en une heure`;
    const noSun = tg.iv < 0.05 || (weatherRow != null && w.sunFraction == null); // soleil direct nul ou trop faible pour être mesuré
    // Brouillard (visibilité sous 1 km) ou brume (1 à 5 km), et épaisseur de la nappe au-dessus du projet.
    const vis = w.visibility, fogRel = w.fogThick ?? null;
    // « Risque »: le brouillard est mal prévu par les modèles, on le dit.
    const fogTxt = tg.fogK > 0 && vis != null && vis < 5000 ? (vis < 1000 ? `Risque de brouillard, visibilité prévue ${Math.max(50, Math.round(vis / 50) * 50)} m` : `Risque de brume, visibilité prévue ${String(Math.round(vis / 100) / 10).replace('.', ',')} km`)
      + (fogRel == null ? '' : fogRel >= 600 ? ', nappe épaisse' : `, nappe d’environ ${Math.max(10, Math.round(fogRel / 10) * 10)} m au-dessus du sol`) : '';
    // Orage ou averses (base épaisse et sombre): « très sombres » réservé à l'orage; avec la percée, la part de l'heure au soleil
    // reste qualitative (une estimation, pas un pourcentage).
    const wcv = w.wc ?? 0, orage = wcv >= 95, stType = orage ? 'Orage' : wcv >= 80 && wcv <= 82 ? 'Averses' : 'Gros cumulus';
    const sunWords = tg.pSun >= 0.7 ? 'soleil la plupart du temps' : tg.pSun >= 0.45 ? 'soleil souvent' : 'percées de soleil par moments';
    const stormTxt = tg.storm >= 0.45 && realDeg >= 0.5 ? `${stType} : ${orage ? 'nuages très sombres' : 'base sombre des nuages'}, ` + (tg.brk ? sunWords : noSun ? 'aucune ombre' : !subjSun ? 'projet à l’ombre des nuages' : 'soleil rare') : '';
    const cond0 = stormTxt ? stormTxt + (rainTxt ? ' · ' + rainTxt : '') : rainTxt && realDeg >= 0.5 ? rainTxt + (noSun ? ' : ciel couvert, aucune ombre' : !subjSun ? ' : projet à l’ombre des nuages' : tg.iv >= 0.45 ? ' : soleil entre les averses' : ' : ombres très douces') : rainTxt ? rainTxt + (realDeg < -0.8 ? ', rues mouillées' : '') : realDeg < -12 ? 'Nuit' : night ? 'Heure bleue : ciel bleu profond, bâtiments en silhouette' : realDeg < 0.5 ? 'Soleil à l’horizon' : !subjSun && !noSun && tg.cum >= 0.15 ? 'Nuages bas : projet à l’ombre des nuages, soleil rare' : tg.cum >= 0.7 ? (noSun ? 'Ciel couvert : aucune ombre' : tg.brk ? 'Nuages bas nombreux : éclaircie sur le projet, ' + sunWords : 'Nuages bas nombreux : soleil par éclaircies seulement') : Math.max(tg.mid, tg.high) >= 0.3 ? vt + (tg.cum >= 0.15 ? ', quelques nuages bas' : '') : tg.cum >= 0.15 ? 'Nuages bas épars : plein soleil entre les ombres de nuages' : 'Ciel dégagé : soleil franc, ombres nettes';
    const fogSun = realDeg < 0.5 ? '' : fogT < 0.1 ? ' : soleil caché, aucune ombre' : fogT < 0.5 ? ' : soleil voilé, ombres douces' : '';
    const cond1 = !fogTxt ? cond0 : rainTxt ? cond0 + ' · ' + fogTxt : fogTxt + fogSun + (stormTxt ? ` · ${stType} : ${orage ? 'nuages très sombres' : 'base sombre des nuages'}` : '');
    // Fumée de feux (mêmes niveaux que l'icône du soleil de l'app), seulement quand elle est dessinée (20 microgrammes et
    // plus). La phrase sur le soleil seulement s'il y a vraiment du soleil direct; sinon, la condition du ciel suit.
    const smokeSun = realDeg >= 0.5 && !rainTxt && !fogTxt && !stormTxt && tg.iv >= 0.45 && tg.cum < 0.7;
    const smokeTxt = tg.smk > 0 && smokeUg != null ? `Fumée de feux ${smokeUg >= 60 ? 'dense' : 'modérée'} prévue (FireWork, Environnement Canada)` + (smokeSun ? (smokeT < 0.4 ? ' : soleil orangé, ombres douces' : ' : soleil légèrement voilé') : '') : '';
    const cond = smokeTxt ? (smokeSun ? smokeTxt : smokeTxt + ' · ' + cond1) : cond1;
    const parts = low == null ? '' : `Nuages bas ${low} %, nuages d’altitude ${Math.round(alt)} %, soleil direct ${sun == null ? 0 : sun} %`;
    const where = night ? 'Soleil sous l’horizon' : `Soleil à ${Math.max(0, Math.round(realDeg))}° au-dessus de l’horizon, plein ${DIRS[Math.round(((bearing * 180 / Math.PI) % 360) / 45) % 8]}`;
    const est = (0.38 + 0.36 * Math.max(veil * (0.4 + 0.6 * thick), cum * 0.5)) * dk * (1 - 0.45 * cur.storm); // ciel d'orage sombre: texte clair
    // Forme du projet la plus en face de la caméra: sa hauteur et d'où elle vient (réglée, mesurée, par défaut).
    let fac = null, best = -Infinity;
    projInfo.forEach(e => { if (e.len < 2.5) return; const dx = cam.position.x - e.mid[0], dz = cam.position.z + e.mid[1], dist = Math.hypot(dx, dz) || 1; const facing = (e.nrm[0] * dx - e.nrm[1] * dz) / dist; if (facing < 0.15) return; const scv = facing * Math.sqrt(e.len) / Math.sqrt(dist); if (scv > best) { best = scv; fac = e; } });
    const height = fac ? `${fac.label}, côté ${fac.dir} : ${Math.round(fac.h)} m, hauteur ${fac.src}` : '';
    const hLidar = !!(data && data.lidarBld > 0), hLine = 'Hauteurs des bâtiments LiDAR (Ressources naturelles Canada)';
    const relief = terrain.flat ? (hLidar ? hLine : '') : terrain.src.lidar >= 0.5 ? `Relief LiDAR ${terrain.src.lidarRes || 2} m${hLidar ? ' et hauteurs des bâtiments LiDAR' : ''} (Ressources naturelles Canada)` : 'Relief du modèle d’élévation du Canada (20 m)' + (hLidar ? ' · ' + hLine : '');
    const pavedLine = data && data.paved && data.paved.length ? `Surfaces pavées d’après l’imagerie satellite (${data.pavedSrc || 'Esri'}), approximatives` : '';
    const ts = data && data.treesSrc, treeLine = ts && ts.n ? `Arbres LiDAR, conifères estimés d’après ${ts.essences && ts.essences.length ? ts.essences.join(' et ') : 'la forme des cimes'}` : '';
    const srcLine = [relief, treeLine, pavedLine, sat ? SAT_CREDIT : ''].filter(Boolean).join(' · ');
    const info = cond + '|' + parts + '|' + where + '|' + height + '|' + srcLine + '|' + (est > 0.55 ? 'dark' : 'light');
    if (info !== lastInfo) { lastInfo = info; onInfo({ cond, parts, where, height, srcLine, light: est <= 0.55, northDeg: (Math.atan2(vF.x, -vF.z) * 180 / Math.PI) }); }
  }
  raf = requestAnimationFrame(frame);
  const ro = new ResizeObserver(() => resize()); ro.observe(container);
  // Pluie: pas d'animation quand la 3D est hors de l'écran (page défilée); un onglet caché arrête déjà tout.
  let onScreen = true; const io = new IntersectionObserver(([en]) => { onScreen = en.isIntersecting; }); io.observe(container);

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
    setTerrain(t) { terrain = makeTerrain(t); rebuild(); },
    setTime(ms) { if (ms !== dateMs) { dateMs = ms; dirty = true; } },
    // Fumée de feux au sol à l'heure affichée (FireWork, microgrammes par mètre cube), ou null. Dessinée à partir de
    // 20 seulement (prudence: la couche mêle le fond urbain, 5 à 15 en ville), entière vers 150.
    setSmoke(ug) {
      smokeUg = ug != null && ug >= 0 ? ug : null;
      tg.smk = smokeUg != null && smokeUg >= 20 ? clamp(Math.log10(smokeUg / 20) / Math.log10(7.5)) : 0;
      dirty = true;
    },
    setWeather(row) {
      weatherRow = row || null;
      const s = row?.sunFraction == null ? 0.02 : row.sunFraction, cum = (row?.cloudLow ?? 0) / 100;
      tg.cum = cum; tg.mid = (row?.cloudMid ?? 0) / 100; tg.high = (row?.cloudHigh ?? 0) / 100; tg.iv = clamp(s / Math.max(0.1, 1 - cum));
      // Pluie: nombre de gouttes de 0,1 mm/h (quelques-unes) à 8 mm/h (le maximum), en échelle logarithmique. Sous zéro ou
      // icône de neige: rien (la neige viendra à part). Sol mouillé: pluie de l'heure, ou des trois précédentes qui sèche.
      const rk = (h) => h && h.precip >= 0.1 && !(h.temp <= 0) && h.icon !== 'snow' ? clamp(Math.log10(1 + h.precip * 4) / Math.log10(33)) : 0;
      const pv = row?.prev || []; tg.rain = rk(row); tg.wet = Math.max(tg.rain, 0.75 * rk(pv[0]), 0.5 * rk(pv[1]), 0.3 * rk(pv[2]));
      // Flaques (reflets): seulement avec beaucoup d'eau. Pluie tombée dans l'heure et les trois précédentes, l'eau
      // s'écoulant peu à peu: sous 4 mm, le sol est seulement plus foncé; reflet complet à partir de 12 mm.
      const mmOf = (h) => rk(h) > 0 ? h.precip : 0, acc = mmOf(row) + 0.75 * mmOf(pv[0]) + 0.5 * mmOf(pv[1]) + 0.3 * mmOf(pv[2]);
      tg.pud = smooth(4, 12, acc);
      // Orage ou averses (8 octobre 2026), d'après ICON: code météo, sinon épaisseur du nuage convectif (atténuée sans pluie),
      // fois la couverture de la couche qui porte la base (la couche moyenne si la base est à 2500 m ou plus). Presque nul pour
      // la pluie ordinaire, le crachin et le couvert gris (été 2025 à Québec: 2 % des heures de pluie au-dessus de 0,45).
      const wc = row?.wc ?? 0, Dc = row?.convDepth ?? 0, cb = row?.convBase ?? 0;
      const sCode = wc >= 95 ? 1 : wc === 82 ? 0.9 : wc === 81 ? 0.75 : wc === 80 ? 0.6 : 0;
      const conv = Math.max(sCode, smooth(3000, 8000, Dc) * ((row?.precip ?? 0) >= 0.1 ? 1 : 0.7));
      const layer = cb >= 2500 ? Math.max(row?.cloudLow ?? 0, row?.cloudMid ?? 0) : (row?.cloudLow ?? 0);
      tg.storm = conv * smooth(25, 70, layer);
      // Part de l'heure au soleil: direct normal moyen rapporté à celui d'un ciel clair (au soleil, un point reçoit tout le
      // direct; à l'ombre d'un nuage, presque rien), soleil au milieu de l'heure précédente (moyenne d'Open-Meteo). Percée:
      // le projet est montré au soleil, comme la légende le dit (voir frame).
      const tMid = row?.time ? new Date(row.time).getTime() - 1800000 : dateMs, hMid = SunCalc.getPosition(new Date(tMid), lat, lng).altitude * 180 / Math.PI;
      tg.pSun = row?.direct != null && hMid >= 2 ? clamp(row.direct / Math.sin(hMid * Math.PI / 180) / dniClear(hMid)) : 0;
      tg.brk = tg.pSun >= SUN_ON && tg.iv >= 0.3 ? 1 : 0;
      // Brouillard et brume, par prudence (Stéphane: « ne pas montrer du faux brouillard »): il faut que les deux modèles
      // s'accordent: GFS (et HRRR) prévoit une visibilité sous 5 km avec de l'air saturé au sol (une nappe est mesurée),
      // et ICON voit des nuages bas à 80 % ou plus (un brouillard est un nuage posé au sol); et qu'il ne pleuve pas (la
      // pluie réduit déjà la visibilité). Effet entier sous 1 km (brouillard au sens météo). Extinction 3,912 /
      // visibilité, ici par km (40 m au plus dense); épaisseur de la nappe au-dessus du sol, 600 m au plus.
      const V = row?.visibility, sat = row?.fogThick != null, lowOk = (row?.cloudLow ?? 0) >= 80;
      tg.fogK = V != null && V >= 0 && sat && lowOk && !(tg.rain > 0) ? 3912 / Math.max(V, 40) * smooth(5000, 1000, V) : 0; tg.fogTh = Math.min(row?.fogThick ?? 600, 600);
      if (!row) { tg.cum = 0; tg.mid = 0; tg.high = 0; tg.iv = 1; tg.rain = 0; tg.wet = 0; tg.pud = 0; tg.fogK = 0; tg.fogTh = 600; tg.storm = 0; tg.pSun = 1; tg.brk = 0; }
      // L'épaisseur ne glisse pas pendant que le brouillard apparaît ou disparaît (sinon la vue drone se noie un instant).
      if (!(tg.fogK > 0)) tg.fogTh = cur.fogTh; else if (cur.fogK < 1e-3) cur.fogTh = tg.fogTh;
      dirty = true;
    },
    resize,
    getView() { return { az, camH, Rr, ct: ct.toArray(), time: new Date(dateMs).toString().slice(0, 24) }; },
    setView(v) { if (v.az != null) az = v.az; if (v.camH != null) camH = v.camH; if (v.Rr != null) Rr = v.Rr; dirty = true; },
    zoom(f) { Rr = clampR(Rr * f); dirty = true; }, // f < 1: on s'approche
    // Modèle importé: glb (ArrayBuffer) et info de modelImport.js, placement gardé ou null (placement par défaut). Renvoie le placement.
    async setModel(glb, info, placement) {
      dropModel();
      if (!glb) { modelPl = null; rebuild(true, true); return null; }
      const { group, win } = await modelGroup(glb);
      if (!running) return null;
      const h = info.size && info.size[2] > 0 ? info.size[2] : 6; // hauteur du modèle (lumières de façade la nuit)
      dropModel(); model = { group, win, h, hull: slimHull(info.hull), geo: info.geo || null, offset: info.offset || [0, 0] }; S.add(group);
      modelPl = placement ? { x: 0, n: 0, rot: 0, dy: 0, ...placement } : defaultPlacement();
      rebuild(false, true);
      return { ...modelPl };
    },
    setModelPlacement(p) { if (!model) return null; modelPl = { ...modelPl, ...p }; placeModel(); modelChanged(); return { ...modelPl }; },
    autoPlaceModel() { if (!model) return null; modelPl = defaultPlacement(); rebuild(true, true); return { ...modelPl }; },
    getModelPlacement() { return modelPl ? { ...modelPl } : null; },
    // Calque satellite: image de loadSatImage (satDrape.js) ou null pour l'éteindre.
    setSatellite(s) { sat = s || null; placeSat(); return !!satObj; },
    dispose() {
      running = false; cancelAnimationFrame(raf); ro.disconnect(); io.disconnect(); window.removeEventListener('keydown', onKey, true); clearStatics(); clearTimeout(modelTimer); dropModel(); sat = null; placeSat();
      [sceneRT, aoRT, aoRT2, compRT, reflRT, reflRT2, cubeRT, skyRT, envRT].forEach(r => r && r.dispose()); pmrem.dispose();
      [skyMat, aoMat, blurMat, compMat, reflMat, rblurMat, brightMat, gblurMat, fxMat, wallMat, roofMat, trunkMat, crownMat, shadowMat, conMat, fillMat, edgeMat, waterMat, cloudMat, lampHeadMat, ...Object.values(flatMats)].forEach(m => m.dispose()); GLOW.dispose(); if (lampU.uLampMap.value) lampU.uLampMap.value.dispose();
      [skyGeo, crownGeo, crownGeoMid, crownGeoFar, crownGeoShadow, conGeo, conGeoLow, trunkGeo, trunkGeoLow, sg, gnd && gnd.geometry, gndFar.geometry, quad.geometry].forEach(g => g && g.dispose()); FT.map.dispose(); FT.rough.dispose(); FT.emis.dispose(); gndTex.dispose(); gndTexNear.dispose(); gndMat.dispose(); gndMatFar.dispose(); leafMask.dispose(); conMask.dispose(); edgeMask.dispose();
      R.dispose(); R.forceContextLoss(); if (el.parentNode) el.parentNode.removeChild(el);
    },
  };
}
