// Lecteur minimal de GeoTIFF optimisé pour le nuage (COG): en-tête et répertoires (TIFF classique ou BigTIFF),
// puis seulement les tuiles qui touchent la fenêtre demandée, lues par plages d'octets HTTP. Sert au relief
// (api/terrain.js) pour lire le modèle LiDAR de Ressources naturelles Canada (fichier de 1 To sur S3) sans
// télécharger son index complet (8 Mo par niveau) ni dépendre d'une bibliothèque.
// Limites: un seul échantillon par pixel, 32 bits flottants (ou entiers 8/16/32 bits), tuiles sans prédicteur,
// compression nulle, LZW, deflate (zlib de Node, 4 novembre 2026: cartes de couverture du sol ESA WorldCover et CCI) ou
// LERC (décodeur d'Esri, licence Apache 2.0, 4 novembre 2026: LiDAR américain USGS 3DEP servi par le Planetary Computer). Le décodage LZW suit celui de geotiff.js (EOX IT Services, licence MIT).

import { inflateSync } from 'zlib';
import * as Lerc from 'lerc';
import { decompress as zstdDecompress } from 'fzstd';

const TYPE_SIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8, 16: 8, 17: 8, 18: 8 };
const UA = 'MeteoShoot (www.meteoshoot.com)';

async function rangeFetch(url, a, b, retry = 1) {
  try {
    const r = await fetch(url, { headers: { Range: `bytes=${a}-${b}`, 'User-Agent': UA }, signal: AbortSignal.timeout(20000) }); // une lecture bloquée ne doit pas épuiser les 60 s de la fonction
    if (r.status !== 206 && r.status !== 200) throw new Error(`cog ${r.status} ${url.slice(-40)}`);
    return new Uint8Array(await r.arrayBuffer());
  } catch (e) {
    // Un second essai après une courte pause (échec réseau passager): sinon toute une couche du relief était perdue en silence.
    // Pas après le délai de 20 s dépassé: une lecture bloquée coûterait 40 s et la fonction dépasserait ses 60 s.
    const timedOut = e && (e.name === 'TimeoutError' || e.name === 'AbortError');
    if (retry > 0 && !timedOut) { await new Promise(res => setTimeout(res, 400)); return rangeFetch(url, a, b, retry - 1); }
    throw e;
  }
}

// ---------- LZW (TIFF): codes de 9 à 12 bits, bit de poids fort en premier, changement « précoce » de largeur.
function lzwDecode(input, outSize) {
  const out = new Uint8Array(outSize); let op = 0;
  const prefix = new Uint16Array(4096), suffix = new Uint8Array(4096), length = new Uint16Array(4096);
  for (let i = 0; i < 256; i++) { prefix[i] = 0xffff; suffix[i] = i; length[i] = 1; }
  let dictLen = 258, width = 9, pos = 0, old = -1;
  const total = input.length * 8;
  const next = () => {
    if (pos + width > total) return 257;
    let v = 0;
    for (let k = 0; k < width; k++) { const p = pos + k; v = (v << 1) | ((input[p >> 3] >> (7 - (p & 7))) & 1); }
    pos += width; return v;
  };
  const emit = (code) => { // écrit la chaîne du code (à l'envers depuis la fin), renvoie son premier octet
    const len = length[code]; let p = op + len - 1, c = code;
    if (op + len > out.length) { // sortie pleine: on tronque
      let cc = code, l = len; while (op + l > out.length) { cc = prefix[cc]; l--; } p = op + l - 1; c = cc; while (c !== 0xffff) { out[p--] = suffix[c]; c = prefix[c]; } op += l; return suffix[firstOf(code)];
    }
    while (c !== 0xffff) { out[p--] = suffix[c]; c = prefix[c]; }
    op += len; return out[op - len];
  };
  const firstOf = (code) => { let c = code; while (prefix[c] !== 0xffff) c = prefix[c]; return c; };
  const add = (pre, ch) => { if (dictLen >= 4096) return; prefix[dictLen] = pre; suffix[dictLen] = ch; length[dictLen] = length[pre] + 1; dictLen++; };
  for (;;) {
    let code = next();
    if (code === 257) break;
    if (code === 256) { dictLen = 258; width = 9; code = next(); while (code === 256) code = next(); if (code === 257) break; emit(code); old = code; }
    else if (code < dictLen) { const first = emit(code); if (old >= 0) add(old, first); old = code; }
    else { // code == dictLen: chaîne précédente + son premier caractère
      const first = suffix[firstOf(old)]; add(old, first); emit(code); old = code;
    }
    if (dictLen + 1 >= (1 << width) && width < 12) width++;
    if (op >= outSize) break;
  }
  return out;
}

const cogs = new Map(); // url -> Promise<Cog>
const tileCache = new Map(); // clé -> Float32Array (tuiles décodées), bornée
const TILE_CACHE_MAX = 40;

export function openCog(url) {
  if (cogs.has(url)) return cogs.get(url);
  const p = (async () => {
    const head = await rangeFetch(url, 0, 65535);
    const le = head[0] === 0x49; const hv = new DataView(head.buffer, head.byteOffset, head.byteLength);
    const magic = hv.getUint16(2, le); const big = magic === 43;
    if (magic !== 42 && magic !== 43) throw new Error('cog: pas un TIFF');
    let off = big ? Number(hv.getBigUint64(8, le)) : hv.getUint32(4, le);
    const readAt = async (o, n) => (o + n <= head.length ? head.subarray(o, o + n) : rangeFetch(url, o, o + n - 1));
    const dvOf = (b) => new DataView(b.buffer, b.byteOffset, b.byteLength);
    const num = (dv, o, type) => type === 3 ? dv.getUint16(o, le) : type === 4 ? dv.getUint32(o, le) : type === 16 ? Number(dv.getBigUint64(o, le)) : type === 12 ? dv.getFloat64(o, le) : type === 1 ? dv.getUint8(o) : dv.getUint32(o, le);
    const levels = [];
    for (let guard = 0; off && guard < 20; guard++) {
      const cb = await readAt(off, big ? 8 : 2); const n = big ? Number(dvOf(cb).getBigUint64(0, le)) : dvOf(cb).getUint16(0, le);
      const esz = big ? 20 : 12, base = off + (big ? 8 : 2);
      const buf = await readAt(base, n * esz + (big ? 8 : 4)); const d = dvOf(buf);
      const L = { width: 0, height: 0, tw: 0, th: 0, comp: 1, pred: 1, bits: 32, fmt: 3, nodata: null, scale: null, tie: null, offs: null, counts: null, sub: 0 };
      for (let i = 0; i < n; i++) {
        const e = i * esz, tag = d.getUint16(e, le), type = d.getUint16(e + 2, le), count = big ? Number(d.getBigUint64(e + 4, le)) : d.getUint32(e + 4, le);
        const vo = e + (big ? 12 : 8), sz = (TYPE_SIZE[type] || 1) * count, inline = sz <= (big ? 8 : 4);
        const dataOff = inline ? base + vo : (big ? Number(d.getBigUint64(vo, le)) : d.getUint32(vo, le));
        const scalar = async () => inline ? num(d, vo, type) : num(dvOf(await readAt(dataOff, sz)), 0, type);
        const doubles = async () => { const b = await readAt(dataOff, sz), v = dvOf(b), out = []; for (let k = 0; k < count; k++) out.push(v.getFloat64(k * 8, le)); return out; };
        switch (tag) {
          case 254: L.sub = await scalar(); break;
          case 256: L.width = await scalar(); break;
          case 257: L.height = await scalar(); break;
          case 258: L.bits = inline ? num(d, vo, type) : num(dvOf(await readAt(dataOff, TYPE_SIZE[type])), 0, type); break;
          case 259: L.comp = await scalar(); break;
          case 317: L.pred = await scalar(); break;
          case 322: L.tw = await scalar(); break;
          case 323: L.th = await scalar(); break;
          case 324: L.offs = { off: dataOff, type, count }; break;
          case 325: L.counts = { off: dataOff, type, count }; break;
          case 339: L.fmt = inline ? num(d, vo, type) : num(dvOf(await readAt(dataOff, TYPE_SIZE[type])), 0, type); break;
          case 33550: L.scale = await doubles(); break;
          case 33922: L.tie = await doubles(); break;
          case 42113: { const b = inline ? buf.subarray(vo, vo + sz) : await readAt(dataOff, sz); L.nodata = parseFloat(Buffer.from(b).toString('latin1')); break; }
          default: break;
        }
      }
      if (!L.tw || !L.offs) throw new Error('cog: image non tuilée');
      L.across = Math.ceil(L.width / L.tw);
      levels.push(L);
      off = big ? Number(d.getBigUint64(n * esz, le)) : d.getUint32(n * esz, le);
    }
    // Géoréférencement: celui du niveau 0; les niveaux réduits (aperçus) en héritent avec leur facteur.
    const L0 = levels[0]; if (!L0.scale || !L0.tie) throw new Error('cog: géoréférencement absent');
    levels.forEach(L => { L.res = L0.scale[0] * L0.width / L.width; L.x0 = L0.tie[3] - L0.tie[0] * L0.scale[0]; L.y0 = L0.tie[4] + L0.tie[1] * L0.scale[1]; });
    return { url, le, levels, readAt, readTile: (lv, tx, ty) => readTile({ url, le, levels, readAt }, lv, tx, ty) };
  })();
  cogs.set(url, p); p.catch(() => cogs.delete(url));
  return p;
}

// Une tuile décodée en Float32Array (tw*th), NaN pour « sans donnée » et hors image. Deux lecteurs simultanés de la
// même tuile (hauteurs des bâtiments et arbres, lancés ensemble) partagent la même lecture.
const pending = new Map();
function readTile(cog, lv, tx, ty) {
  const key = `${cog.url}#${lv}/${tx}/${ty}`;
  if (tileCache.has(key)) { const v = tileCache.get(key); tileCache.delete(key); tileCache.set(key, v); return Promise.resolve(v); }
  if (pending.has(key)) return pending.get(key);
  const p = decodeTile(cog, lv, tx, ty, key).finally(() => pending.delete(key));
  pending.set(key, p);
  return p;
}
async function decodeTile(cog, lv, tx, ty, key) {
  const L = cog.levels[lv];
  const n = L.tw * L.th, out = new Float32Array(n);
  if (tx < 0 || ty < 0 || tx >= L.across || ty >= Math.ceil(L.height / L.th)) { out.fill(NaN); return out; }
  const idx = ty * L.across + tx, es = TYPE_SIZE[L.offs.type], cs = TYPE_SIZE[L.counts.type];
  const [ob, cb] = await Promise.all([cog.readAt(L.offs.off + idx * es, es), cog.readAt(L.counts.off + idx * cs, cs)]);
  const rd = (b, t) => { const v = new DataView(b.buffer, b.byteOffset, b.byteLength); return t === 16 ? Number(v.getBigUint64(0, cog.le)) : t === 3 ? v.getUint16(0, cog.le) : v.getUint32(0, cog.le); };
  const off = rd(ob, L.offs.type), cnt = rd(cb, L.counts.type);
  const bpp = L.bits / 8, raw = cnt ? await rangeFetch(cog.url, off, off + cnt - 1) : null;
  let bytes;
  if (!raw || !cnt) { out.fill(L.nodata == null ? NaN : L.nodata); bytes = null; }
  else if (L.comp === 1) bytes = raw;
  else if (L.comp === 5) bytes = lzwDecode(raw, n * bpp);
  else if (L.comp === 8 || L.comp === 32946) bytes = new Uint8Array(inflateSync(raw));
  else if (L.comp === 34887 || L.comp === 34925 || L.comp === 34926) { // LERC (3DEP: blob LERC compressé en zstd, fzstd en JS pur): flottants décodés directement, masque de validité
    if (!Lerc.isLoaded()) await Lerc.load();
    const blob = raw[0] === 0x28 && raw[1] === 0xb5 && raw[2] === 0x2f && raw[3] === 0xfd ? zstdDecompress(raw) : raw[0] === 0x78 ? new Uint8Array(inflateSync(raw)) : raw;
    const d = Lerc.decode(blob), px = d.pixels[0], m = d.mask;
    for (let i = 0; i < n; i++) out[i] = i < px.length && (!m || m[i]) ? px[i] : NaN;
    bytes = null;
  }
  else throw new Error('cog: compression ' + L.comp + ' non gérée');
  if (L.pred === 3 && bytes) fpPredictor(bytes, L.tw, bpp, cog.le); // prédicteur flottant (USGS 1 m, 4 novembre 2026)
  else if (L.pred !== 1 && bytes) throw new Error('cog: prédicteur ' + L.pred + ' non géré');
  if (bytes) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const le = cog.le;
    for (let i = 0; i < n; i++) {
      const o = i * bpp; if (o + bpp > bytes.length) { out[i] = NaN; continue; }
      out[i] = L.fmt === 3 ? (bpp === 4 ? dv.getFloat32(o, le) : dv.getFloat64(o, le)) : L.fmt === 2 ? (bpp === 1 ? dv.getInt8(o) : bpp === 2 ? dv.getInt16(o, le) : dv.getInt32(o, le)) : (bpp === 1 ? dv.getUint8(o) : bpp === 2 ? dv.getUint16(o, le) : dv.getUint32(o, le));
    }
  }
  if (L.nodata != null) for (let i = 0; i < n; i++) if (out[i] === L.nodata || out[i] < -30000) out[i] = NaN;
  tileCache.set(key, out); if (tileCache.size > TILE_CACHE_MAX) tileCache.delete(tileCache.keys().next().value);
  return out;
}

// Prédicteur flottant du TIFF (3): dans chaque rangée de la tuile, les octets sont d'abord des différences (chaque octet
// s'ajoute au précédent), puis rangés par plans (tous les octets de poids fort des pixels, puis les suivants, gros-boutiste).
// On remet les pixels dans l'ordre d'octets du fichier (comme geotiff.js). Modifie bytes en place.
function fpPredictor(bytes, tw, bpp, le) {
  const rowLen = tw * bpp, rows = Math.floor(bytes.length / rowLen), copy = new Uint8Array(rowLen);
  for (let r = 0; r < rows; r++) {
    const o = r * rowLen;
    for (let i = 1; i < rowLen; i++) bytes[o + i] = (bytes[o + i] + bytes[o + i - 1]) & 255;
    copy.set(bytes.subarray(o, o + rowLen));
    for (let i = 0; i < tw; i++) for (let b = 0; b < bpp; b++) bytes[o + bpp * i + b] = copy[(le ? bpp - 1 - b : b) * tw + i];
  }
}

// Fenêtre en pixels d'un niveau [c0, r0, c1, r1) -> { w, h, data: Float32Array, c0, r0 }, lue par tuiles en parallèle.
export async function readWindow(cog, lv, c0, r0, c1, r1, limit = 8) {
  const L = cog.levels[lv]; const w = c1 - c0, h = r1 - r0, data = new Float32Array(w * h).fill(NaN);
  const tx0 = Math.floor(c0 / L.tw), tx1 = Math.floor((c1 - 1) / L.tw), ty0 = Math.floor(r0 / L.th), ty1 = Math.floor((r1 - 1) / L.th);
  const jobs = []; for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) jobs.push([tx, ty]);
  let k = 0;
  const worker = async () => {
    while (k < jobs.length) {
      const [tx, ty] = jobs[k++]; const t = await cog.readTile(lv, tx, ty);
      const px0 = tx * L.tw, py0 = ty * L.th;
      const ca = Math.max(c0, px0), cb = Math.min(c1, px0 + L.tw), ra = Math.max(r0, py0), rb = Math.min(r1, py0 + L.th);
      for (let r = ra; r < rb; r++) { const so = (r - py0) * L.tw + (ca - px0), dof = (r - r0) * w + (ca - c0); data.set(t.subarray(so, so + (cb - ca)), dof); }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, jobs.length) }, worker));
  return { w, h, data, c0, r0, tiles: jobs.length };
}
