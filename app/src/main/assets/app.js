'use strict';
/* Tonalize — editor de color grade que gera LUT 3D (.cube) */
(function () {

const N = 33, N2 = N * N, N3 = N * N * N;
const Native = window.Android || null;
const $ = (s, r) => (r || document).querySelector(s);
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const clamp01 = v => v < 0 ? 0 : v > 1 ? 1 : v;

function el(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  if (attrs) for (const k in attrs) {
    const v = attrs[k];
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'style') e.style.cssText = v;
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) {
    if (c == null || c === false) continue;
    e.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return e;
}

/* =====================================================================
   Matemática de cor
   ===================================================================== */
const s2l = v => v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
const l2s = v => v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
const LIN8 = new Float32Array(256);
for (let i = 0; i < 256; i++) LIN8[i] = s2l(i / 255);

const labF = t => t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116;
function linToLab(r, g, b, o) {
  const x = labF((0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047);
  const y = labF(0.2126729 * r + 0.7151522 * g + 0.0721750 * b);
  const z = labF((0.0193339 * r + 0.1191920 * g + 0.9503041 * b) / 1.08883);
  o[0] = 116 * y - 16; o[1] = 500 * (x - y); o[2] = 200 * (y - z);
  return o;
}
const rgbToLab = (r, g, b, o) => linToLab(s2l(r), s2l(g), s2l(b), o);
function labToRgb(L, a, b, o) {
  const fy = (L + 16) / 116, fx = a / 500 + fy, fz = fy - b / 200;
  const fi = t => { const t3 = t * t * t; return t3 > 0.008856 ? t3 : (t - 16 / 116) / 7.787; };
  const x = fi(fx) * 0.95047, y = fi(fy), z = fi(fz) * 1.08883;
  o[0] = l2s(clamp01(3.2404542 * x - 1.5371385 * y - 0.4985314 * z));
  o[1] = l2s(clamp01(-0.9692660 * x + 1.8760108 * y + 0.0415560 * z));
  o[2] = l2s(clamp01(0.0556434 * x - 0.2040259 * y + 1.0572252 * z));
  return o;
}
function rgbToHsl(r, g, b, o) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
  let h = 0, s = 0;
  if (d > 1e-6) {
    s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    if (mx === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
  }
  o[0] = h; o[1] = s; o[2] = l; return o;
}
function hue2(p, q, t) {
  if (t < 0) t += 1; if (t > 1) t -= 1;
  if (t < 1 / 6) return p + (q - p) * 6 * t;
  if (t < 1 / 2) return q;
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
  return p;
}
function hslToRgb(h, s, l, o) {
  if (s <= 0) { o[0] = o[1] = o[2] = l; return o; }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  o[0] = hue2(p, q, h + 1 / 3); o[1] = hue2(p, q, h); o[2] = hue2(p, q, h - 1 / 3);
  return o;
}

/* =====================================================================
   Parâmetros do editor manual
   ===================================================================== */
const HSL_BANDS = [
  ['Vermelhos', 0, '#e5484d'], ['Laranjas', 30, '#f76b15'], ['Amarelos', 60, '#ffc53d'],
  ['Verdes', 120, '#46a758'], ['Cianos', 180, '#12a594'], ['Azuis', 225, '#3e63dd'],
  ['Roxos', 275, '#8e4ec6'], ['Magentas', 320, '#d6409f']
];
const CX = [0, 0.25, 0.5, 0.75, 1];

function defaults() {
  return {
    exposure: 0, contrast: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0, fade: 0,
    temp: 0, tint: 0, saturation: 0, vibrance: 0,
    wheels: { sh: { h: 0, a: 0 }, mid: { h: 0, a: 0 }, hi: { h: 0, a: 0 } },
    curves: { m: CX.slice(), r: CX.slice(), g: CX.slice(), b: CX.slice() },
    hsl: HSL_BANDS.map(() => ({ h: 0, s: 0, l: 0 }))
  };
}
function mergeDefaults(p) {
  const d = defaults();
  if (!p) return d;
  for (const k in d) {
    if (typeof d[k] === 'number' && typeof p[k] === 'number') d[k] = p[k];
  }
  if (p.wheels) for (const k of ['sh', 'mid', 'hi']) if (p.wheels[k]) Object.assign(d.wheels[k], p.wheels[k]);
  if (p.curves) for (const k of ['m', 'r', 'g', 'b']) if (Array.isArray(p.curves[k]) && p.curves[k].length === 5) d.curves[k] = p.curves[k].slice();
  if (Array.isArray(p.hsl)) p.hsl.forEach((b, i) => { if (d.hsl[i] && b) Object.assign(d.hsl[i], b); });
  return d;
}

/* curvas: interpolação cúbica monotônica (Fritsch–Carlson) em 5 pontos */
const isIdent = ys => ys.every((y, i) => Math.abs(y - CX[i]) < 1e-4);
function curveTable(ys) {
  const n = 5, h = 0.25, d = [], m = new Array(n);
  for (let k = 0; k < n - 1; k++) d.push((ys[k + 1] - ys[k]) / h);
  m[0] = d[0]; m[n - 1] = d[n - 2];
  for (let k = 1; k < n - 1; k++) m[k] = d[k - 1] * d[k] <= 0 ? 0 : (d[k - 1] + d[k]) / 2;
  for (let k = 0; k < n - 1; k++) {
    if (Math.abs(d[k]) < 1e-9) { m[k] = m[k + 1] = 0; continue; }
    const a = m[k] / d[k], b = m[k + 1] / d[k], s = a * a + b * b;
    if (s > 9) { const t = 3 / Math.sqrt(s); m[k] = t * a * d[k]; m[k + 1] = t * b * d[k]; }
  }
  const T = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    const x = i / 255, k = Math.min(3, Math.floor(x / h));
    const t = (x - CX[k]) / h, t2 = t * t, t3 = t2 * t;
    T[i] = (2 * t3 - 3 * t2 + 1) * ys[k] + (t3 - 2 * t2 + t) * h * m[k] +
           (-2 * t3 + 3 * t2) * ys[k + 1] + (t3 - t2) * h * m[k + 1];
  }
  return T;
}
function ct(T, v) {
  v = clamp01(v) * 255;
  const i = Math.min(254, v | 0), f = v - i;
  return T[i] + (T[i + 1] - T[i]) * f;
}

function prepManual(P) {
  const c = {};
  const t = P.temp / 100, m = P.tint / 100, k = Math.pow(2, P.exposure);
  const kr = 1 + 0.3 * t, kg = 1 - 0.25 * m, kb = 1 - 0.3 * t;
  const lum = 0.2126 * kr + 0.7152 * kg + 0.0722 * kb;
  c.kr = kr / lum * k; c.kg = kg / lum * k; c.kb = kb / lum * k;
  c.lin = P.exposure !== 0 || t !== 0 || m !== 0;
  c.con = P.contrast / 100;
  c.sh = P.shadows / 100; c.hi = P.highlights / 100; c.wt = P.whites / 100; c.bk = P.blacks / 100;
  c.tone = !!(c.sh || c.hi || c.wt || c.bk);
  c.fade = P.fade / 100 * 0.18;
  const W = P.wheels;
  const vec = (w, s) => [Math.cos(w.h) * w.a * s, Math.cos(w.h - 2.094395) * w.a * s, Math.cos(w.h - 4.18879) * w.a * s];
  c.o0 = vec(W.sh, 0.16); c.o1 = vec(W.mid, 0.12); c.o2 = vec(W.hi, 0.16);
  c.wh = W.sh.a > 0 || W.mid.a > 0 || W.hi.a > 0;
  const C = P.curves;
  c.cm = isIdent(C.m) ? null : curveTable(C.m);
  c.cr = isIdent(C.r) ? null : curveTable(C.r);
  c.cg = isIdent(C.g) ? null : curveTable(C.g);
  c.cb = isIdent(C.b) ? null : curveTable(C.b);
  c.bands = P.hsl.map((b, i) => ({ c: HSL_BANDS[i][1] / 360, h: b.h / 100 * (30 / 360), s: b.s / 100, l: b.l / 100 }))
    .filter(b => b.h || b.s || b.l);
  c.sat = P.saturation / 100; c.vib = P.vibrance / 100;
  c.hsl = c.bands.length > 0 || !!c.sat || !!c.vib;
  return c;
}
const soft = x => x < 0.8 ? x : 0.8 + 0.2 * (1 - Math.exp(-(x - 0.8) / 0.2));
function con(v, k) {
  v = clamp01(v);
  if (k > 0) { const s = v < 0.5 ? 2 * v * v : 1 - 2 * (1 - v) * (1 - v); return v + k * (s - v); }
  return 0.5 + (v - 0.5) * (1 + k * 0.6);
}
const _h = [0, 0, 0];
function manual(r, g, b, c, o) {
  if (c.lin) {
    r = l2s(soft(Math.max(0, s2l(r) * c.kr)));
    g = l2s(soft(Math.max(0, s2l(g) * c.kg)));
    b = l2s(soft(Math.max(0, s2l(b) * c.kb)));
  }
  if (c.con) { r = con(r, c.con); g = con(g, c.con); b = con(b, c.con); }
  if (c.tone) {
    const l = clamp01(0.2126 * r + 0.7152 * g + 0.0722 * b), il = 1 - l;
    const d = 0.25 * (c.sh * 6.75 * l * il * il + c.hi * 6.75 * l * l * il) +
              0.2 * (c.wt * l * l * l * l + c.bk * il * il * il * il);
    r += d; g += d; b += d;
  }
  if (c.fade) { r = c.fade + r * (1 - c.fade); g = c.fade + g * (1 - c.fade); b = c.fade + b * (1 - c.fade); }
  if (c.wh) {
    const l = clamp01(0.2126 * r + 0.7152 * g + 0.0722 * b), il = 1 - l;
    const w0 = il * il, w1 = 4 * l * il, w2 = l * l;
    r += c.o0[0] * w0 + c.o1[0] * w1 + c.o2[0] * w2;
    g += c.o0[1] * w0 + c.o1[1] * w1 + c.o2[1] * w2;
    b += c.o0[2] * w0 + c.o1[2] * w1 + c.o2[2] * w2;
  }
  if (c.cm) { r = ct(c.cm, r); g = ct(c.cm, g); b = ct(c.cm, b); }
  if (c.cr) r = ct(c.cr, r);
  if (c.cg) g = ct(c.cg, g);
  if (c.cb) b = ct(c.cb, b);
  if (c.hsl) {
    rgbToHsl(clamp01(r), clamp01(g), clamp01(b), _h);
    let h = _h[0], s = _h[1], l = _h[2];
    if (c.bands.length) {
      let dh = 0, ds = 0, dl = 0;
      for (const bd of c.bands) {
        let d = Math.abs(h - bd.c); if (d > 0.5) d = 1 - d;
        if (d < 0.125) {
          const w = 0.5 + 0.5 * Math.cos(Math.PI * d / 0.125);
          dh += w * bd.h; ds += w * bd.s; dl += w * bd.l;
        }
      }
      h = (h + dh + 1) % 1;
      const s0 = s;
      s = s * (1 + ds);
      l = l + dl * 0.35 * s0 * (1 - Math.abs(2 * l - 1));
    }
    if (c.sat) s *= 1 + c.sat;
    if (c.vib) s *= 1 + c.vib * (1 - s);
    hslToRgb(h, clamp01(s), clamp01(l), _h);
    r = _h[0]; g = _h[1]; b = _h[2];
  }
  o[0] = clamp01(r); o[1] = clamp01(g); o[2] = clamp01(b);
}

/* =====================================================================
   Extração de look v2
   - 5 faixas tonais (pretos → brancos)
   - cor por faixa com média + covariância em a/b (transferência MKL):
     copia tingimento, saturação e "direção" das cores de cada faixa
   - casamento de histograma de luminância (curva de contraste)
   - ignora tarjas pretas (letterbox) e pixels estourados
   - paleta dominante e descrição do look para a interface
   ===================================================================== */
const BC = [8, 29, 50, 71, 92], BS = 12, NB = BC.length;
function bandW(L, o) {
  let s = 0;
  for (let k = 0; k < NB; k++) { const d = (L - BC[k]) / BS; o[k] = Math.exp(-0.5 * d * d); s += o[k]; }
  for (let k = 0; k < NB; k++) o[k] /= s;
  return o;
}

/* marca linhas/colunas quase pretas nas bordas (tarjas de cinema) */
function borderMask(d, w, h) {
  const rowMax = new Float32Array(h), colMax = new Float32Array(w);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4, v = d[i] + d[i + 1] + d[i + 2];
    if (v > rowMax[y]) rowMax[y] = v;
    if (v > colMax[x]) colMax[x] = v;
  }
  const T = 40;
  let top = 0, bot = h - 1, lef = 0, rig = w - 1;
  while (top < h * 0.3 && rowMax[top] < T) top++;
  while (bot > h * 0.7 && rowMax[bot] < T) bot--;
  while (lef < w * 0.3 && colMax[lef] < T) lef++;
  while (rig > w * 0.7 && colMax[rig] < T) rig--;
  return { top, bot, lef, rig };
}

function kmeans(pts, K) {
  const n = pts.length / 3;
  if (n < K * 4) return [];
  let seed = 12345;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const C = [], d2 = new Float64Array(n).fill(1e12);
  let j = Math.floor(rnd() * n);
  C.push([pts[j * 3], pts[j * 3 + 1], pts[j * 3 + 2]]);
  while (C.length < K) {
    const c = C[C.length - 1]; let s = 0;
    for (let i = 0; i < n; i++) {
      const dl = pts[i * 3] - c[0], da = pts[i * 3 + 1] - c[1], db = pts[i * 3 + 2] - c[2];
      const d = dl * dl * 0.5 + da * da + db * db;
      if (d < d2[i]) d2[i] = d; s += d2[i];
    }
    let r = rnd() * s; j = 0;
    while (j < n - 1 && (r -= d2[j]) > 0) j++;
    C.push([pts[j * 3], pts[j * 3 + 1], pts[j * 3 + 2]]);
  }
  const as = new Int32Array(n), cnt = new Float64Array(K);
  for (let it = 0; it < 12; it++) {
    const acc = C.map(() => [0, 0, 0]); cnt.fill(0);
    for (let i = 0; i < n; i++) {
      let best = 0, bd = 1e18;
      for (let k = 0; k < K; k++) {
        const dl = pts[i * 3] - C[k][0], da = pts[i * 3 + 1] - C[k][1], db = pts[i * 3 + 2] - C[k][2];
        const d = dl * dl * 0.5 + da * da + db * db;
        if (d < bd) { bd = d; best = k; }
      }
      as[i] = best; cnt[best]++;
      acc[best][0] += pts[i * 3]; acc[best][1] += pts[i * 3 + 1]; acc[best][2] += pts[i * 3 + 2];
    }
    for (let k = 0; k < K; k++) if (cnt[k]) C[k] = acc[k].map(v => v / cnt[k]);
  }
  const o = [0, 0, 0];
  return C.map((c, k) => {
    labToRgb(c[0], c[1], c[2], o);
    const hx = '#' + o.map(v => Math.round(v * 255).toString(16).padStart(2, '0')).join('');
    return { hex: hx, w: +(cnt[k] / n).toFixed(3), L: c[0] };
  }).filter(p => p.w >= 0.03).sort((a, b) => a.L - b.L).map(p => ({ hex: p.hex, w: p.w }));
}

/* frames: [{data, w, h}] */
function statsFromData(frames) {
  const hist = new Float64Array(256);
  const W = new Float64Array(NB), A = new Float64Array(NB), B = new Float64Array(NB);
  const AA = new Float64Array(NB), AB = new Float64Array(NB), BB = new Float64Array(NB);
  const GW = new Float64Array(NB), GA = new Float64Array(NB), GB = new Float64Array(NB), chist = new Float64Array(160);
  const w = new Float64Array(NB), lab = [0, 0, 0];
  let n = 0, nc = 0, ga = 0, gb = 0, gaa = 0, gab = 0, gbb = 0, sumC = 0;
  let total = 0; for (const f of frames) total += f.w * f.h;
  const step = Math.max(1, Math.ceil(total / 4000)), pal = [];
  let pc = 0;
  for (const f of frames) {
    const d = f.data, m = borderMask(d, f.w, f.h);
    for (let y = m.top; y <= m.bot; y++) for (let x = m.lef; x <= m.rig; x++) {
      const i = (y * f.w + x) * 4;
      linToLab(LIN8[d[i]], LIN8[d[i + 1]], LIN8[d[i + 2]], lab);
      const L = lab[0], a = lab[1], b = lab[2];
      hist[clamp(Math.round(L * 2.55), 0, 255)]++; n++;
      if (L < 3 || L > 97) continue;            // pretos/brancos estourados não dizem nada sobre cor
      bandW(L, w);
      const C = Math.hypot(a, b), gq = Math.exp(-C / 1.5);   // peso de "pixel quase neutro"
      for (let k = 0; k < NB; k++) {
        const q = w[k];
        W[k] += q; A[k] += q * a; B[k] += q * b; AA[k] += q * a * a; AB[k] += q * a * b; BB[k] += q * b * b;
        const g = q * gq; GW[k] += g; GA[k] += g * a; GB[k] += g * b;
      }
      chist[Math.min(159, Math.round(C))]++;
      ga += a; gb += b; gaa += a * a; gab += a * b; gbb += b * b; sumC += C; nc++;
      if (pc++ % step === 0) pal.push(L, a, b);
    }
  }
  if (!n) throw new Error('imagem vazia');
  const NC = Math.max(1, nc);
  ga /= NC; gb /= NC;
  const gca = Math.max(1, gaa / NC - ga * ga), gcb = gab / NC - ga * gb, gcc = Math.max(1, gbb / NC - gb * gb);
  const reg = 0.04 * NC, bands = [];
  for (let k = 0; k < NB; k++) {
    const Wk = W[k] + reg;
    const ma = (A[k] + reg * ga) / Wk, mb = (B[k] + reg * gb) / Wk;
    const caa = (AA[k] + reg * (gca + ga * ga)) / Wk - ma * ma;
    const cab = (AB[k] + reg * (gcb + ga * gb)) / Wk - ma * mb;
    const cbb = (BB[k] + reg * (gcc + gb * gb)) / Wk - mb * mb;
    bands.push({ a: +ma.toFixed(3), b: +mb.toFixed(3), caa: +Math.max(1, caa).toFixed(3), cab: +cab.toFixed(3), cbb: +Math.max(1, cbb).toFixed(3) });
  }
  const h = []; for (let i = 0; i < 256; i++) h.push(+(hist[i] / n).toFixed(6));
  // tingimento real do "grade": média dos pixels quase neutros em cada faixa (cinzas, brancos, pretos)
  const tint = [];
  for (let k = 0; k < NB; k++) {
    const wk = GW[k] + 1e-6 * NC;
    tint.push([+(GA[k] / wk).toFixed(3), +(GB[k] / wk).toFixed(3)]);
  }
  return { v: 2, hist: h, bands, meanC: +(sumC / NC).toFixed(2), palette: kmeans(new Float32Array(pal), 6),
    Q: quantiles(h), tint, C90: pctOf(chist, 0.9) };
}
function pctOf(hh, p) {
  let t = 0, s = 0;
  for (const v of hh) t += v;
  for (let i = 0; i < hh.length; i++) { s += hh[i]; if (s >= p * t) return i; }
  return hh.length - 1;
}
const QP = [0.005, 0.1, 0.5, 0.9, 0.995];
const quantiles = hist => QP.map(p => +(pctOf(hist, p) / 2.55).toFixed(2));

/* estatísticas antigas (v1: 3 faixas, só média) → v2 */
function upgradeStats(s) {
  if (!s || s.v === 2) return s;
  const C3 = [15, 50, 85], w = [0, 0, 0];
  const bw3 = L => { let t = 0; for (let k = 0; k < 3; k++) { const d = (L - C3[k]) / 18; w[k] = Math.exp(-0.5 * d * d); t += w[k]; } for (let k = 0; k < 3; k++) w[k] /= t; return w; };
  const v = Math.max(4, (s.spread || 16) * (s.spread || 16) / 2);
  const bands = BC.map(L => { const q = bw3(L); return { a: q[0] * s.a[0] + q[1] * s.a[1] + q[2] * s.a[2], b: q[0] * s.b[0] + q[1] * s.b[1] + q[2] * s.b[2], caa: v, cab: 0, cbb: v }; });
  return { v: 2, hist: s.hist, bands, meanC: null, palette: [], Q: quantiles(s.hist), tint: bands.map(b => [b.a * 0.5, b.b * 0.5]), C90: null };
}

/* mídia "neutra" típica, usada quando o usuário ainda não abriu a mídia dele */
const DEFAULT_SRC = (() => {
  const h = []; let s = 0;
  for (let i = 0; i < 256; i++) { const L = i / 2.55, d = (L - 50) / 24; const v = Math.exp(-0.5 * d * d); h.push(v); s += v; }
  return { v: 2, hist: h.map(v => v / s), bands: BC.map(() => ({ a: 0, b: 0, caa: 110, cab: 0, cbb: 110 })),
    Q: [1, 12, 45, 85, 99], tint: BC.map(() => [0, 2]), C90: 40 };
})();

/* cúbica monotônica por nós (Fritsch–Carlson) */
function monoFn(xs, ys) {
  const n = xs.length, d = [], m = new Array(n);
  for (let k = 0; k < n - 1; k++) d.push((ys[k + 1] - ys[k]) / (xs[k + 1] - xs[k]));
  m[0] = d[0]; m[n - 1] = d[n - 2];
  for (let k = 1; k < n - 1; k++) m[k] = d[k - 1] * d[k] <= 0 ? 0 : (d[k - 1] + d[k]) / 2;
  return x => {
    if (x <= xs[0]) return ys[0] + (x - xs[0]) * m[0];
    if (x >= xs[n - 1]) return ys[n - 1] + (x - xs[n - 1]) * m[n - 1];
    let k = 0; while (x > xs[k + 1]) k++;
    const h = xs[k + 1] - xs[k], t = (x - xs[k]) / h, t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[k] + (t3 - 2 * t2 + t) * h * m[k] + (-2 * t3 + 3 * t2) * ys[k + 1] + (t3 - t2) * h * m[k + 1];
  };
}

/* ---- álgebra 2×2 simétrica ---- */
function eig2(a, b, c) {             // [[a,b],[b,c]]
  const t = (a + c) / 2, d = Math.sqrt(Math.max(0, (a - c) * (a - c) / 4 + b * b));
  const l1 = t + d, l2 = t - d;
  let vx, vy;
  if (Math.abs(b) > 1e-9) { vx = l1 - c; vy = b; } else if (a >= c) { vx = 1; vy = 0; } else { vx = 0; vy = 1; }
  const n = Math.hypot(vx, vy); vx /= n; vy /= n;
  return [l1, l2, vx, vy];
}
function fn2(a, b, c, f) {           // aplica f aos autovalores
  const [l1, l2, x, y] = eig2(a, b, c), f1 = f(l1), f2 = f(l2);
  return [f1 * x * x + f2 * y * y, (f1 - f2) * x * y, f1 * y * y + f2 * x * x];
}
function mkl(s, r) {
  // T = S^-½ (S^½ R S^½)^½ S^-½ — leva a distribuição de cor da mídia para a da referência
  const Sh = fn2(s.caa, s.cab, s.cbb, v => Math.sqrt(Math.max(v, 1e-6)));
  const Si = fn2(s.caa, s.cab, s.cbb, v => 1 / Math.sqrt(Math.max(v, 1e-6)));
  const M = full(Sh), R = [[r.caa, r.cab], [r.cab, r.cbb]];
  const X = mm(mm(M, R), M);
  const Xh = fn2(X[0][0], (X[0][1] + X[1][0]) / 2, X[1][1], v => Math.sqrt(Math.max(v, 0)));
  const I = full(Si);
  const T = mm(mm(I, full(Xh)), I);
  // limita o ganho de saturação para não estourar
  return fn2(T[0][0], (T[0][1] + T[1][0]) / 2, T[1][1], v => clamp(v, 0.3, 2.4));
}
function full(s) { return [[s[0], s[1]], [s[1], s[2]]]; }
function mm(p, q) { return [[p[0][0] * q[0][0] + p[0][1] * q[1][0], p[0][0] * q[0][1] + p[0][1] * q[1][1]], [p[1][0] * q[0][0] + p[1][1] * q[1][0], p[1][0] * q[0][1] + p[1][1] * q[1][1]]]; }

function cdf(h) {
  const c = new Float64Array(256); let s = 0;
  for (let i = 0; i < 256; i++) { s += h[i] + 1e-4; c[i] = s; }
  for (let i = 0; i < 256; i++) c[i] /= s;
  return c;
}
function buildLmap(sh, rh) {
  const cs = cdf(sh), cr = cdf(rh), map = new Float32Array(256);
  let j = 0;
  for (let i = 0; i < 256; i++) {
    while (j < 255 && cr[j] < cs[i]) j++;
    let x = j;
    if (j > 0) { const c0 = cr[j - 1], c1 = cr[j]; x = j - 1 + (c1 > c0 ? clamp((cs[i] - c0) / (c1 - c0), 0, 1) : 1); }
    map[i] = clamp(x, 0, 255) / 2.55;
  }
  const sm = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    let s = 0, c = 0;
    for (let k = -6; k <= 6; k++) { const q = i + k; if (q >= 0 && q < 256) { s += map[q]; c++; } }
    sm[i] = 0.12 * (i / 2.55) + 0.88 * (s / c);
    if (i > 0 && sm[i] < sm[i - 1]) sm[i] = sm[i - 1];
  }
  return sm;
}
function sampleMap(m, L) {
  const x = clamp(L * 2.55, 0, 255), i = Math.min(254, x | 0), f = x - i;
  return m[i] + (m[i + 1] - m[i]) * f;
}

/* descrição humana do look (para os "chips" da interface) */
function describe(st) {
  const out = [];
  if (!st || !st.bands) return out;
  const T = st.tint || st.bands.map(b => [b.a * 0.5, b.b * 0.5]);
  const warm = (T[1][1] + T[2][1] + T[3][1]) / 3, sh = (T[0][1] + T[1][1]) / 2, hi = (T[3][1] + T[4][1]) / 2;
  if (sh < -0.2 && hi > 2) out.push('Sombras frias, luzes quentes');
  else if (warm > 2.5) out.push('Tons quentes');
  else if (warm < -1) out.push('Tons frios');
  else if (sh < -0.8) out.push('Sombras frias');
  else out.push('Cor neutra');
  let m = 0, v = 0;
  st.hist.forEach((p, i) => { m += p * i / 2.55; });
  st.hist.forEach((p, i) => { const d = i / 2.55 - m; v += p * d * d; });
  const sd = Math.sqrt(v);
  out.push(sd > 27 ? 'Contraste alto' : sd < 17 ? 'Contraste suave' : 'Contraste médio');
  if (st.meanC != null) out.push(st.meanC > 30 ? 'Cores vivas' : st.meanC < 13 ? 'Cores dessaturadas' : 'Saturação natural');
  let c = 0, p2 = 0;
  for (let i = 0; i < 256; i++) { c += st.hist[i]; if (c >= 0.02) { p2 = i / 2.55; break; } }
  if (p2 > 11) out.push('Pretos lavados');
  return out;
}

/* =====================================================================
   Estado
   ===================================================================== */
const REF_DEFAULT = { amount: 100, tone: 75, color: 100, skin: 40, mode: 'essencia' };
const S = {
  P: defaults(),
  refCfg: Object.assign({}, REF_DEFAULT),
  ref: null,          // {kind:'ref', name, thumb, stats, src} | {kind:'cube', name, base:Float32Array}
  base: null,
  lut: new Float32Array(N3 * 3),
  tex: new Uint8Array(N3 * 4),
  name: 'Sem título',
  id: null,
  media: null,
  compare: false, split: 0.5, before: false,
  curveCh: 'm', hslSel: 0, tab: 'look',
  active: false, edited: false
};

function computeBase() {
  const R = S.ref;
  if (!R) { S.base = null; return; }
  if (R.kind === 'cube') { S.base = R.base; return; }
  const src = upgradeStats(R.src) || DEFAULT_SRC, ref = upgradeStats(R.stats);
  if (S.refCfg.mode !== 'fiel') { S.base = essenceBase(src, ref); return; }
  const tone = S.refCfg.tone / 100, col = S.refCfg.color / 100, skin = S.refCfg.skin / 100;
  const map = buildLmap(src.hist, ref.hist);
  const T = src.bands.map((s, k) => mkl(s, ref.bands[k]));
  const base = new Float32Array(N3 * 3), ws = new Float64Array(NB), wr = new Float64Array(NB), o = [0, 0, 0], lab = [0, 0, 0];
  const inv = 1 / (N - 1);
  let i = 0;
  for (let b = 0; b < N; b++) for (let g = 0; g < N; g++) for (let r = 0; r < N; r++, i++) {
    rgbToLab(r * inv, g * inv, b * inv, lab);
    const L = lab[0], a0 = lab[1], b0 = lab[2];
    const L2 = L + (sampleMap(map, L) - L) * tone;
    bandW(L, ws); bandW(L2, wr);
    let a2 = 0, b2 = 0;
    for (let k = 0; k < NB; k++) {
      const s = src.bands[k], t = T[k], da = a0 - s.a, db = b0 - s.b;
      a2 += ws[k] * (t[0] * da + t[1] * db) + wr[k] * ref.bands[k].a;
      b2 += ws[k] * (t[1] * da + t[2] * db) + wr[k] * ref.bands[k].b;
    }
    // limite suave de croma
    const C2 = Math.hypot(a2, b2), Cmax = 95;
    if (C2 > Cmax) { const f = (Cmax + (C2 - Cmax) * 0.25) / C2; a2 *= f; b2 *= f; }
    const ce = col * (1 - skin * 0.75 * skinW(L, a0, b0));
    labToRgb(L2, a0 + (a2 - a0) * ce, b0 + (b2 - b0) * ce, o);
    base[i * 3] = o[0]; base[i * 3 + 1] = o[1]; base[i * 3 + 2] = o[2];
  }
  S.base = base;
}

/* quanto uma cor parece tom de pele (0..1) — para proteger rostos */
function skinW(L, a, b) {
  const C = Math.hypot(a, b);
  if (C <= 6 || L <= 20) return 0;
  let hd = Math.atan2(b, a) * 57.29578 - 52; if (hd > 180) hd -= 360; if (hd < -180) hd += 360;
  return Math.exp(-0.5 * (hd / 16) * (hd / 16)) * clamp((C - 6) / 8, 0, 1) * clamp((60 - C) / 15, 0, 1);
}

/* Modo Essência: copia o TRATAMENTO de cor, não o conteúdo da referência.
   - pontos de preto/branco (fade, brancos apagados) + um pouco do contraste
   - tingimento por faixa medido nos tons quase neutros (split toning)
   - nível geral de saturação                                                */
const TW = [1, 0.15, 0.05, 0.15, 1];
function essenceBase(src, ref) {
  const t = S.refCfg.tone / 75, col = S.refCfg.color / 100, skin = S.refCfg.skin / 100;
  const xs = [0], ys = [0];
  src.Q.forEach((q, k) => { xs.push(q); ys.push(q + (ref.Q[k] - q) * clamp(TW[k] * t, 0, 1)); });
  xs.push(100); ys.push(100);
  for (let k = 1; k < xs.length; k++) { if (xs[k] < xs[k - 1] + 0.5) xs[k] = xs[k - 1] + 0.5; if (ys[k] < ys[k - 1] + 0.5) ys[k] = ys[k - 1] + 0.5; }
  const f = monoFn(xs, ys);
  const ratio = ref.C90 && src.C90 ? ref.C90 / Math.max(5, src.C90) : 1;
  const sat = Math.pow(clamp(Math.pow(ratio, 0.7), 0.55, 1.5), col);
  const base = new Float32Array(N3 * 3), ws = new Float64Array(NB), wr = new Float64Array(NB), o = [0, 0, 0], lab = [0, 0, 0];
  const inv = 1 / (N - 1);
  let i = 0;
  for (let b = 0; b < N; b++) for (let g = 0; g < N; g++) for (let r = 0; r < N; r++, i++) {
    rgbToLab(r * inv, g * inv, b * inv, lab);
    const L = lab[0], a0 = lab[1], b0 = lab[2], L2 = clamp(f(L), 0, 100);
    bandW(L, ws); bandW(L2, wr);
    let sa = 0, sb = 0, ra = 0, rb = 0;
    for (let k = 0; k < NB; k++) { sa += ws[k] * src.tint[k][0]; sb += ws[k] * src.tint[k][1]; ra += wr[k] * ref.tint[k][0]; rb += wr[k] * ref.tint[k][1]; }
    const a2 = (a0 - sa) * sat + ra * 0.9, b2 = (b0 - sb) * sat + rb * 0.9;
    const ce = col * (1 - skin * 0.75 * skinW(L, a0, b0));
    labToRgb(L2, a0 + (a2 - a0) * ce, b0 + (b2 - b0) * ce, o);
    base[i * 3] = o[0]; base[i * 3 + 1] = o[1]; base[i * 3 + 2] = o[2];
  }
  return base;
}

function computeLUT() {
  const c = prepManual(S.P), base = S.base, amt = base ? S.refCfg.amount / 100 : 0;
  const out = S.lut, tex = S.tex, o = [0, 0, 0], inv = 1 / (N - 1);
  let i = 0;
  for (let b = 0; b < N; b++) for (let g = 0; g < N; g++) for (let r = 0; r < N; r++, i++) {
    let R = r * inv, G = g * inv, B = b * inv;
    if (amt > 0) { const j = i * 3; R += (base[j] - R) * amt; G += (base[j + 1] - G) * amt; B += (base[j + 2] - B) * amt; }
    manual(R, G, B, c, o);
    out[i * 3] = o[0]; out[i * 3 + 1] = o[1]; out[i * 3 + 2] = o[2];
    const t = (g * N2 + b * N + r) * 4;
    tex[t] = Math.round(o[0] * 255); tex[t + 1] = Math.round(o[1] * 255); tex[t + 2] = Math.round(o[2] * 255); tex[t + 3] = 255;
  }
}

/* =====================================================================
   .cube
   ===================================================================== */
function buildCube(title) {
  const lines = [
    '# Criado com Tonalize',
    'TITLE "' + String(title || 'Tonalize').replace(/"/g, "'") + '"',
    'LUT_3D_SIZE ' + N,
    'DOMAIN_MIN 0.0 0.0 0.0',
    'DOMAIN_MAX 1.0 1.0 1.0'
  ];
  const L = S.lut;
  for (let i = 0; i < N3; i++) lines.push(L[i * 3].toFixed(6) + ' ' + L[i * 3 + 1].toFixed(6) + ' ' + L[i * 3 + 2].toFixed(6));
  return lines.join('\n') + '\n';
}
function parseCube(text) {
  let size = 0, dmin = [0, 0, 0], dmax = [1, 1, 1];
  const vals = [];
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t[0] === '#') continue;
    const u = t.toUpperCase();
    if (u.startsWith('LUT_1D_SIZE')) throw new Error('LUT 1D não é suportado, use um LUT 3D');
    if (u.startsWith('LUT_3D_SIZE')) { size = parseInt(t.split(/\s+/)[1], 10); continue; }
    if (u.startsWith('DOMAIN_MIN')) { dmin = t.split(/\s+/).slice(1, 4).map(Number); continue; }
    if (u.startsWith('DOMAIN_MAX')) { dmax = t.split(/\s+/).slice(1, 4).map(Number); continue; }
    if (/^[A-Z_]/.test(u)) continue;
    const p = t.split(/\s+/);
    if (p.length >= 3) vals.push(+p[0], +p[1], +p[2]);
  }
  if (!size || size < 2 || size > 128 || vals.length < size * size * size * 3) throw new Error('arquivo .cube inválido');
  const base = new Float32Array(N3 * 3), S1 = size - 1, inv = 1 / (N - 1);
  const at = (r, g, b, ch) => vals[((b * size + g) * size + r) * 3 + ch];
  let i = 0;
  for (let b = 0; b < N; b++) for (let g = 0; g < N; g++) for (let r = 0; r < N; r++, i++) {
    const p = [r * inv, g * inv, b * inv].map((v, k) => clamp((v - dmin[k]) / ((dmax[k] - dmin[k]) || 1), 0, 1) * S1);
    const r0 = Math.min(S1 - 1, Math.floor(p[0])), g0 = Math.min(S1 - 1, Math.floor(p[1])), b0 = Math.min(S1 - 1, Math.floor(p[2]));
    const fr = p[0] - r0, fg = p[1] - g0, fb = p[2] - b0;
    for (let ch = 0; ch < 3; ch++) {
      const c00 = at(r0, g0, b0, ch) * (1 - fr) + at(r0 + 1, g0, b0, ch) * fr;
      const c10 = at(r0, g0 + 1, b0, ch) * (1 - fr) + at(r0 + 1, g0 + 1, b0, ch) * fr;
      const c01 = at(r0, g0, b0 + 1, ch) * (1 - fr) + at(r0 + 1, g0, b0 + 1, ch) * fr;
      const c11 = at(r0, g0 + 1, b0 + 1, ch) * (1 - fr) + at(r0 + 1, g0 + 1, b0 + 1, ch) * fr;
      const c0 = c00 * (1 - fg) + c10 * fg, c1 = c01 * (1 - fg) + c11 * fg;
      base[i * 3 + ch] = clamp01(c0 * (1 - fb) + c1 * fb);
    }
  }
  return base;
}

/* =====================================================================
   Renderizador WebGL (aplica o LUT na GPU)
   ===================================================================== */
const VS = 'attribute vec2 p;varying vec2 v;void main(){v=vec2((p.x+1.0)*0.5,(1.0-p.y)*0.5);gl_Position=vec4(p,0.0,1.0);}';
const FS = [
  '#ifdef GL_FRAGMENT_PRECISION_HIGH', 'precision highp float;', '#else', 'precision mediump float;', '#endif',
  'varying vec2 v;uniform sampler2D src;uniform sampler2D lut;uniform float split;',
  'const float N=' + N.toFixed(1) + ';',
  'vec3 look(vec3 c){',
  ' c=clamp(c,0.0,1.0);',
  ' float bz=c.b*(N-1.0);float b0=floor(bz);float b1=min(b0+1.0,N-1.0);float f=bz-b0;',
  ' float x=c.r*(N-1.0)+0.5;float y=(c.g*(N-1.0)+0.5)/N;',
  ' vec3 a=texture2D(lut,vec2((b0*N+x)/(N*N),y)).rgb;',
  ' vec3 b=texture2D(lut,vec2((b1*N+x)/(N*N),y)).rgb;',
  ' return mix(a,b,f);}',
  'void main(){vec3 c=texture2D(src,v).rgb;float s=step(split,v.x);gl_FragColor=vec4(mix(c,look(c),s),1.0);}'
].join('\n');

class Renderer {
  constructor(canvas, preserve) {
    const o = { alpha: false, antialias: false, depth: false, premultipliedAlpha: false, preserveDrawingBuffer: !!preserve };
    const gl = canvas.getContext('webgl', o) || canvas.getContext('experimental-webgl', o);
    if (!gl) throw new Error('WebGL indisponível neste aparelho');
    this.gl = gl; this.canvas = canvas;
    const sh = (type, src) => {
      const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    };
    const pr = gl.createProgram();
    gl.attachShader(pr, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(pr);
    if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(pr));
    gl.useProgram(pr);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(pr, 'p');
    gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    this.uSplit = gl.getUniformLocation(pr, 'split');
    gl.uniform1i(gl.getUniformLocation(pr, 'src'), 0);
    gl.uniform1i(gl.getUniformLocation(pr, 'lut'), 1);
    const mk = () => {
      const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return t;
    };
    this.srcTex = mk(); this.lutTex = mk();
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    this.maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE);
  }
  setLut(u8) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.lutTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, N2, N, 0, gl.RGBA, gl.UNSIGNED_BYTE, u8);
  }
  setSource(elm) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.srcTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, elm);
  }
  draw(split) {
    const gl = this.gl;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.uniform1f(this.uSplit, split);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
  dispose() {
    const ext = this.gl.getExtension('WEBGL_lose_context');
    if (ext) ext.loseContext();
  }
}

/* =====================================================================
   Ícones
   ===================================================================== */
const ICONS = {
  back: '<path d="M15 18l-6-6 6-6"/>',
  spark: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M19 15l.7 2.3L22 18l-2.3.7L19 21l-.7-2.3L16 18l2.3-.7z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4L6 18M18 6l1.4-1.4"/>',
  drop: '<path d="M12 3.2s6.2 6.6 6.2 11.2a6.2 6.2 0 01-12.4 0C5.8 9.8 12 3.2 12 3.2z"/>',
  wheel: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="2.5"/><path d="M12 3v6.5M12 14.5V21"/>',
  curve: '<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M6 18c5 0 6.5-12 12-12"/>',
  palette: '<circle cx="8" cy="9" r="3.2"/><circle cx="16" cy="9" r="3.2"/><circle cx="12" cy="15.5" r="3.2"/>',
  split: '<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M12 3v18"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/>',
  play: '<path d="M7 4.5v15l12-7.5z"/>',
  pause: '<path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="9" cy="10" r="1.8"/><path d="M21 16l-5-5-8 9"/>',
  film: '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4"/>',
  cube: '<path d="M12 2.8l8 4.6v9.2l-8 4.6-8-4.6V7.4z"/><path d="M4 7.4l8 4.6 8-4.6M12 12v9.2"/>',
  save: '<path d="M6 3h12v18l-6-4-6 4z"/>',
  chev: '<path d="M9 6l6 6-6 6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 7.8v.4"/>',
  swap: '<path d="M7 7h11l-3-3M17 17H6l3 3"/>'
};
function icon(name) {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('class', 'i'); s.setAttribute('aria-hidden', 'true');
  s.innerHTML = ICONS[name] || '';
  return s;
}
document.querySelectorAll('[data-icon]').forEach(b => b.prepend(icon(b.dataset.icon)));

/* =====================================================================
   Mídia
   ===================================================================== */
function loadImage(url) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => rej(new Error('formato de imagem não suportado'));
    img.src = url;
  });
}
function loadVideo(url) {
  return new Promise((res, rej) => {
    const v = document.createElement('video');
    v.playsInline = true; v.setAttribute('playsinline', ''); v.preload = 'auto'; v.muted = true;
    const to = setTimeout(() => rej(new Error('o vídeo demorou demais para abrir')), 20000);
    v.onloadeddata = () => { clearTimeout(to); res(v); };
    v.onerror = () => { clearTimeout(to); rej(new Error('formato de vídeo não suportado')); };
    v.src = url; v.load();
  });
}
function seekTo(v, t) {
  return new Promise(res => {
    let done = false;
    const fin = () => { if (done) return; done = true; v.removeEventListener('seeked', fin); res(); };
    v.addEventListener('seeked', fin);
    setTimeout(fin, 4000);
    v.currentTime = t;
  });
}
function scaledCanvas(src, w, h, maxSide) {
  const s = Math.min(1, maxSide / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w * s)); c.height = Math.max(1, Math.round(h * s));
  c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
  return c;
}
const pixelsOf = (src, w, h) => { const c = scaledCanvas(src, w, h, 240); return { data: c.getContext('2d').getImageData(0, 0, c.width, c.height).data, w: c.width, h: c.height }; };
const thumbOf = (src, w, h) => scaledCanvas(src, w, h, 200).toDataURL('image/jpeg', 0.82);
const isVideoFile = f => (f.type || '').startsWith('video') || /\.(mp4|mov|m4v|webm|3gp|mkv)$/i.test(f.name || '');

async function sampleVideo(v, count, onp) {
  const frames = [], d = v.duration && isFinite(v.duration) ? v.duration : 0;
  let thumb = null;
  for (let i = 0; i < count; i++) {
    if (d > 0) await seekTo(v, d * (i + 0.5) / count);
    frames.push(pixelsOf(v, v.videoWidth, v.videoHeight));
    if (i === Math.floor(count / 2)) thumb = thumbOf(v, v.videoWidth, v.videoHeight);
    if (onp) onp((i + 1) / count);
    if (!d) break;
  }
  return { frames, thumb };
}

function sampleChart() {
  const w = 1200, h = 1500, c = document.createElement('canvas');
  c.width = w; c.height = h;
  const x = c.getContext('2d');
  const sky = x.createLinearGradient(0, 0, 0, h * 0.55);
  sky.addColorStop(0, '#3f6fae'); sky.addColorStop(0.65, '#e9b98a'); sky.addColorStop(1, '#f6dcb4');
  x.fillStyle = sky; x.fillRect(0, 0, w, h * 0.55);
  const sun = x.createRadialGradient(w * 0.7, h * 0.4, 4, w * 0.7, h * 0.4, 170);
  sun.addColorStop(0, 'rgba(255,248,225,1)'); sun.addColorStop(0.25, 'rgba(255,224,160,.9)'); sun.addColorStop(1, 'rgba(255,200,140,0)');
  x.fillStyle = sun; x.fillRect(0, 0, w, h * 0.55);
  x.fillStyle = '#2f4a3a';
  x.beginPath(); x.moveTo(0, h * 0.55);
  for (let i = 0; i <= w; i += 20) x.lineTo(i, h * 0.46 - Math.sin(i / 140) * 34 - Math.sin(i / 57) * 11);
  x.lineTo(w, h * 0.55); x.fill();
  x.fillStyle = '#1b2a22';
  x.beginPath(); x.moveTo(0, h * 0.55);
  for (let i = 0; i <= w; i += 20) x.lineTo(i, h * 0.52 - Math.sin(i / 90 + 2) * 18);
  x.lineTo(w, h * 0.55); x.fill();
  // "pele" (círculos em tons de pele)
  const skins = ['#8d5524', '#c68642', '#e0ac69', '#f1c27d', '#ffdbac'];
  skins.forEach((s, i) => { x.fillStyle = s; x.beginPath(); x.arc(w * (0.12 + i * 0.19), h * 0.62, 70, 0, Math.PI * 2); x.fill(); });
  for (let i = 0; i < w; i += 2) {
    const g = x.createLinearGradient(0, h * 0.69, 0, h * 0.83), hue = i / w * 360;
    g.addColorStop(0, `hsl(${hue},90%,78%)`); g.addColorStop(0.5, `hsl(${hue},85%,50%)`); g.addColorStop(1, `hsl(${hue},80%,18%)`);
    x.fillStyle = g; x.fillRect(i, h * 0.69, 2, h * 0.14);
  }
  const gr = x.createLinearGradient(0, 0, w, 0);
  gr.addColorStop(0, '#000'); gr.addColorStop(1, '#fff');
  x.fillStyle = gr; x.fillRect(0, h * 0.83, w, h * 0.05);
  const cc = ['#735244', '#c29682', '#627a9d', '#576c43', '#8580b1', '#67bdaa', '#d67e2c', '#505ba6', '#c15a63', '#5e3c6c', '#9dbc40', '#e0a32e',
              '#383d96', '#469449', '#af363c', '#e7c71f', '#bb5695', '#0885a1', '#f3f3f2', '#c8c8c8', '#a0a0a0', '#7a7a79', '#555555', '#343434'];
  const pw = w / 12, ph = h * 0.06;
  cc.forEach((col, i) => { x.fillStyle = col; x.fillRect((i % 12) * pw, h * 0.88 + Math.floor(i / 12) * ph, pw + 1, ph + 1); });
  return c;
}

/* =====================================================================
   Navegação entre telas
   ===================================================================== */
const home = $('#home'), editor = $('#editor');
function showEditor(tab) {
  home.classList.add('hidden'); editor.classList.remove('hidden');
  S.active = true;
  if (tab) setTab(tab);
  layout(); refreshUI(); drawRefPane();
}
function showHome() {
  if (S.active && S.edited && (S.ref || S.id)) saveToLibrary(false, true);
  flushSave();
  S.active = false;
  const m = S.media; if (m && m.kind === 'video') m.el.pause();
  editor.classList.add('hidden'); home.classList.remove('hidden');
  drawHome();
}

/* =====================================================================
   Pré-visualização
   ===================================================================== */
const view = $('#view'), stage = $('#stage');
let R = null;
try { R = new Renderer(view, true); } catch (e) { setTimeout(() => toast(e.message, true), 300); }

function setMedia(m) {
  const old = S.media;
  if (old && old.kind === 'video') { old.el.pause(); old.el.removeAttribute('src'); old.el.load(); }
  if (old && old.url) URL.revokeObjectURL(old.url);
  S.media = m; S.srcCache = null;
  drawMediaChip();
  $('#videoBar').classList.toggle('hidden', m.kind !== 'video');
  if (m.kind === 'video') bindVideo(m.el);
  srcDirty = true;
  layout();
}
function drawMediaChip() {
  const c = $('#mediaChip'), m = S.media;
  c.innerHTML = '';
  if (!m || m.kind === 'sample') c.append(icon('plus'), el('span', null, 'Adicionar sua mídia'));
  else c.append(icon(m.kind === 'video' ? 'film' : 'image'), el('span', null, m.name), el('em', null, 'Trocar'));
}

let srcDirty = true, raf = 0, dirty = true, baseDirty = true;
function changed(base, silent) {
  if (base) baseDirty = true;
  dirty = true;
  if (!silent && S.active) S.edited = true;
  schedule();
  scheduleSave();
}
function schedule() { if (!raf) raf = requestAnimationFrame(tick); }
function tick() {
  raf = 0;
  if (baseDirty) { baseDirty = false; computeBase(); }
  if (dirty) { dirty = false; computeLUT(); if (R) R.setLut(S.tex); }
  render();
  const m = S.media;
  if (m && m.kind === 'video' && !m.el.paused) { srcDirty = true; schedule(); }
}
function render() {
  if (!R || !S.media || editor.classList.contains('hidden')) return;
  if (srcDirty) { R.setSource(S.media.el); srcDirty = false; }
  R.draw(S.before ? 2 : S.compare ? S.split : -1);
}

function layout() {
  const m = S.media; if (!m) return;
  const sw = stage.clientWidth, sh = stage.clientHeight - 14;
  if (!sw || !sh) return;
  const ar = m.w / m.h;
  let w = sw, h = sw / ar;
  if (h > sh) { h = sh; w = sh * ar; }
  view.style.width = Math.round(w) + 'px'; view.style.height = Math.round(h) + 'px';
  view.style.marginBottom = '14px';
  const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
  let pw = w * dpr, ph = h * dpr;
  const cap = 1800 / Math.max(pw, ph);
  if (cap < 1) { pw *= cap; ph *= cap; }
  view.width = Math.max(1, Math.round(pw)); view.height = Math.max(1, Math.round(ph));
  srcDirty = true;
  placeSplit();
  schedule();
}
function placeSplit() {
  const line = $('#splitLine');
  line.classList.toggle('hidden', !S.compare);
  if (!S.compare) return;
  const r = view.getBoundingClientRect(), sr = stage.getBoundingClientRect();
  line.style.left = (r.left - sr.left + S.split * r.width - 1) + 'px';
  line.style.top = (r.top - sr.top) + 'px'; line.style.height = r.height + 'px';
}
new ResizeObserver(layout).observe(stage);

$('#btnCompare').addEventListener('click', () => {
  S.compare = !S.compare;
  $('#btnCompare').classList.toggle('on', S.compare);
  placeSplit(); schedule();
  if (S.compare) toast('Arraste na imagem para mover a divisão');
});
const beforeBtn = $('#btnBefore');
const setBefore = v => { S.before = v; beforeBtn.classList.toggle('on', v); schedule(); };
beforeBtn.addEventListener('pointerdown', e => { e.preventDefault(); setBefore(true); });
['pointerup', 'pointercancel', 'pointerleave'].forEach(t => beforeBtn.addEventListener(t, () => setBefore(false)));
beforeBtn.addEventListener('contextmenu', e => e.preventDefault());
beforeBtn.addEventListener('click', () => { if (!S.before) toast('Segure para ver o original'); });
stage.addEventListener('pointerdown', e => {
  if (!S.compare || e.target.closest('button,input,.videobar')) return;
  const move = ev => {
    const r = view.getBoundingClientRect();
    S.split = clamp((ev.clientX - r.left) / r.width, 0, 1); placeSplit(); schedule();
  };
  move(e);
  stage.setPointerCapture(e.pointerId);
  const up = () => { stage.removeEventListener('pointermove', move); stage.removeEventListener('pointerup', up); stage.removeEventListener('pointercancel', up); };
  stage.addEventListener('pointermove', move); stage.addEventListener('pointerup', up); stage.addEventListener('pointercancel', up);
});

/* vídeo */
const fmtT = t => { t = Math.max(0, t || 0); const m = Math.floor(t / 60), s = Math.floor(t % 60); return m + ':' + String(s).padStart(2, '0'); };
let seeking = false;
function setPlayIcon(playing) { const b = $('#btnPlay'); b.innerHTML = ''; b.append(icon(playing ? 'pause' : 'play')); b.setAttribute('aria-label', playing ? 'Pausar' : 'Reproduzir'); }
function bindVideo(v) {
  v.muted = false;
  v.onplay = () => { setPlayIcon(true); schedule(); };
  v.onpause = () => setPlayIcon(false);
  v.onended = () => setPlayIcon(false);
  v.onseeked = () => { srcDirty = true; schedule(); };
  v.ontimeupdate = () => {
    if (!seeking && v.duration) $('#seek').value = Math.round(v.currentTime / v.duration * 1000);
    $('#vtime').textContent = fmtT(v.currentTime);
  };
  setPlayIcon(false);
  $('#seek').value = 0; $('#vtime').textContent = '0:00';
}
$('#btnPlay').addEventListener('click', () => {
  const m = S.media; if (!m || m.kind !== 'video') return;
  if (m.el.paused) { if (m.el.ended) m.el.currentTime = 0; m.el.play().catch(() => {}); } else m.el.pause();
});
$('#seek').addEventListener('input', () => {
  const m = S.media; if (!m || m.kind !== 'video' || !m.el.duration) return;
  seeking = true; m.el.currentTime = $('#seek').value / 1000 * m.el.duration;
});
$('#seek').addEventListener('change', () => { seeking = false; });

/* =====================================================================
   Painéis
   ===================================================================== */
const refreshers = [];
const refreshUI = () => { refreshers.forEach(f => f()); $('#btnName').textContent = S.name; };

function slider(parent, o) {
  const val = el('span', { class: 'val' });
  const inp = el('input', { type: 'range', min: o.min, max: o.max, step: o.step || 1, class: o.cls || null, 'aria-label': o.label });
  const def = o.def != null ? o.def : 0;
  const fmt = v => o.fmt ? o.fmt(v) : (v > 0 && o.min < 0 ? '+' : '') + Math.round(v);
  const paint = () => {
    const v = o.get(), span = o.max - o.min, p = (v - o.min) / span * 100, z = ((o.min < 0 ? 0 : o.min) - o.min) / span * 100;
    inp.style.setProperty('--a', Math.min(p, z) + '%'); inp.style.setProperty('--b', Math.max(p, z) + '%');
    val.textContent = fmt(v); val.classList.toggle('mod', Math.abs(v - def) > 1e-6);
  };
  const sync = () => { inp.value = o.get(); paint(); };
  inp.addEventListener('input', () => { o.set(parseFloat(inp.value)); paint(); changed(o.base); });
  const lab = el('div', { class: 'lab' }, el('span', null, o.label), val);
  let last = 0;
  lab.addEventListener('click', () => {
    const now = Date.now();
    if (now - last < 350) { o.set(def); sync(); changed(o.base); }
    last = now;
  });
  parent.append(el('div', { class: 'row' }, lab, inp));
  refreshers.push(sync); sync();
  return sync;
}
function paneHead(pane, title, onReset) {
  pane.append(el('div', { class: 'pane-head' }, el('h4', null, title),
    onReset ? el('button', { class: 'link', onclick: () => { onReset(); refreshUI(); changed(true); toast(title + ' redefinido'); } }, 'Redefinir') : null));
}
const panel = $('#panel');
const panes = {};
for (const k of ['look', 'luz', 'cor', 'rodas', 'curvas', 'hsl']) { panes[k] = el('div', { class: 'pane' + (k === 'look' ? ' on' : '') }); panel.append(panes[k]); }
function setTab(t) {
  S.tab = t;
  document.querySelectorAll('#tabs button').forEach(x => x.classList.toggle('on', x.dataset.tab === t));
  Object.keys(panes).forEach(k => panes[k].classList.toggle('on', k === t));
  panel.scrollTop = 0;
  if (t === 'curvas') drawCurve();
  if (t === 'rodas') wheelDraws.forEach(f => f());
}
$('#tabs').addEventListener('click', e => { const b = e.target.closest('button[data-tab]'); if (b) setTab(b.dataset.tab); });

/* --- Look (referência) --- */
const lookBox = el('div');
panes.look.append(lookBox);
const refSliders = el('div');
slider(refSliders, { label: 'Intensidade', min: 0, max: 100, def: 100, fmt: v => Math.round(v) + '%', get: () => S.refCfg.amount, set: v => S.refCfg.amount = v });
const refFine = el('div');
slider(refFine, { label: 'Luz e contraste', min: 0, max: 100, def: REF_DEFAULT.tone, base: true, fmt: v => Math.round(v) + '%', get: () => S.refCfg.tone, set: v => S.refCfg.tone = v });
slider(refFine, { label: 'Cores', min: 0, max: 100, def: 100, base: true, fmt: v => Math.round(v) + '%', get: () => S.refCfg.color, set: v => S.refCfg.color = v });
slider(refFine, { label: 'Proteger tons de pele', min: 0, max: 100, def: REF_DEFAULT.skin, base: true, fmt: v => Math.round(v) + '%', get: () => S.refCfg.skin, set: v => S.refCfg.skin = v });
refSliders.append(refFine);

function drawRefPane() {
  lookBox.innerHTML = '';
  const r = S.ref;
  if (!r) {
    lookBox.append(el('div', { class: 'empty-look' },
      el('div', { class: 'ico' }, icon('spark')),
      el('b', null, 'Copie um look'),
      el('p', null, 'Escolha a foto ou o vídeo com a cor que você quer. O app extrai a luz, o contraste e as cores automaticamente.'),
      el('button', { class: 'btn primary block', onclick: () => pick('#fileRef') }, 'Escolher referência'),
      el('div', { class: 'two', style: 'margin-top:8px' },
        el('button', { class: 'btn ghost', onclick: () => pick('#fileCube') }, 'Importar .cube'),
        el('button', { class: 'btn ghost', onclick: () => setTab('luz') }, 'Ajustar à mão'))));
    return;
  }
  const isCube = r.kind === 'cube';
  lookBox.append(el('div', { class: 'pane-head' }, el('h4', null, 'Look'),
    el('button', { class: 'link', onclick: () => { S.ref = null; drawRefPane(); changed(true); toast('Referência removida'); } }, 'Remover')));
  lookBox.append(el('div', { class: 'ref-card' },
    isCube ? el('div', { class: 'cube' }, '.cube') : r.thumb ? el('img', { src: r.thumb, alt: '' }) : el('div', { class: 'cube' }, 'Look'),
    el('div', { class: 'meta' }, el('b', null, r.name || 'Referência'),
      el('small', null, isCube ? 'LUT importado' : (r.src ? 'Adaptado à sua mídia' : 'Adicione sua mídia para adaptar melhor'))),
    el('button', { class: 'btn ghost sm', onclick: () => pick(isCube ? '#fileCube' : '#fileRef') }, 'Trocar')));
  if (!isCube) {
    const st = upgradeStats(r.stats), dna = el('div', { class: 'dna' });
    if (st.palette && st.palette.length) {
      const sw = el('div', { class: 'swatches' });
      st.palette.forEach(p => sw.append(el('i', { style: 'background:' + p.hex + ';flex:' + p.w })));
      dna.append(el('div', { class: 'dna-label' }, el('span', null, 'DNA do look'), el('span', null, 'cores dominantes')), sw);
    }
    const tags = el('div', { class: 'tags' });
    describe(st).forEach(t => tags.append(el('span', null, t)));
    dna.append(tags);
    lookBox.append(dna);
    const modes = el('div', { class: 'choice', style: 'margin:14px 0 4px' });
    [['essencia', 'Essência'], ['fiel', 'Cópia fiel']].forEach(([k, t]) => modes.append(el('button', {
      class: (S.refCfg.mode || 'essencia') === k ? 'on' : null,
      onclick: () => { S.refCfg.mode = k; drawRefPane(); changed(true); }
    }, t)));
    lookBox.append(modes, el('p', { class: 'hint' }, (S.refCfg.mode || 'essencia') === 'essencia'
      ? 'Copia o tratamento de cor (tons, contraste, saturação) sem puxar as cores da cena da referência.'
      : 'Deixa sua mídia com as mesmas cores da referência. Funciona melhor quando as duas cenas são parecidas.'));
  }
  refFine.classList.toggle('hidden', isCube);
  lookBox.append(refSliders);
}

/* --- Luz --- */
paneHead(panes.luz, 'Luz', () => { const d = defaults(); for (const k of ['exposure', 'contrast', 'highlights', 'shadows', 'whites', 'blacks', 'fade']) S.P[k] = d[k]; });
slider(panes.luz, { label: 'Exposição', min: -2, max: 2, step: 0.05, fmt: v => (v > 0 ? '+' : '') + v.toFixed(2), get: () => S.P.exposure, set: v => S.P.exposure = v });
slider(panes.luz, { label: 'Contraste', min: -100, max: 100, get: () => S.P.contrast, set: v => S.P.contrast = v });
slider(panes.luz, { label: 'Altas luzes', min: -100, max: 100, get: () => S.P.highlights, set: v => S.P.highlights = v });
slider(panes.luz, { label: 'Sombras', min: -100, max: 100, get: () => S.P.shadows, set: v => S.P.shadows = v });
slider(panes.luz, { label: 'Brancos', min: -100, max: 100, get: () => S.P.whites, set: v => S.P.whites = v });
slider(panes.luz, { label: 'Pretos', min: -100, max: 100, get: () => S.P.blacks, set: v => S.P.blacks = v });
slider(panes.luz, { label: 'Fade', min: 0, max: 100, get: () => S.P.fade, set: v => S.P.fade = v });
panes.luz.append(el('p', { class: 'hint' }, 'Toque duas vezes no nome de um ajuste para zerar.'));

/* --- Cor --- */
paneHead(panes.cor, 'Cor', () => { for (const k of ['temp', 'tint', 'saturation', 'vibrance']) S.P[k] = 0; });
slider(panes.cor, { label: 'Temperatura', min: -100, max: 100, cls: 'temp', get: () => S.P.temp, set: v => S.P.temp = v });
slider(panes.cor, { label: 'Tonalidade', min: -100, max: 100, cls: 'tint', get: () => S.P.tint, set: v => S.P.tint = v });
slider(panes.cor, { label: 'Saturação', min: -100, max: 100, cls: 'sat', get: () => S.P.saturation, set: v => S.P.saturation = v });
slider(panes.cor, { label: 'Vibração', min: -100, max: 100, get: () => S.P.vibrance, set: v => S.P.vibrance = v });

/* --- Rodas de cor --- */
paneHead(panes.rodas, 'Rodas de cor', () => { S.P.wheels = defaults().wheels; });
const wheelRow = el('div', { class: 'wheels' });
panes.rodas.append(wheelRow, el('p', { class: 'hint', style: 'margin-top:12px' }, 'Arraste o ponto para tingir cada faixa de luz. Toque duas vezes para zerar.'));
const wheelDraws = [];
[['sh', 'Sombras'], ['mid', 'Meios-tons'], ['hi', 'Altas luzes']].forEach(([key, label]) => {
  const cv = el('canvas', { width: 216, height: 216, 'aria-label': 'Roda de ' + label });
  const info = el('small');
  wheelRow.append(el('div', { class: 'wheel' }, cv, el('b', null, label), info));
  const ctx = cv.getContext('2d');
  const draw = () => {
    const W = S.P.wheels[key], s = cv.width, c = s / 2, rad = c - 12;
    ctx.clearRect(0, 0, s, s);
    ctx.save();
    ctx.beginPath(); ctx.arc(c, c, rad, 0, Math.PI * 2); ctx.clip();
    if (ctx.createConicGradient) {
      const g = ctx.createConicGradient(0, c, c);
      for (let i = 0; i <= 12; i++) g.addColorStop(i / 12, `hsl(${i * 30},70%,55%)`);
      ctx.fillStyle = g;
    } else ctx.fillStyle = '#888';
    ctx.fillRect(0, 0, s, s);
    const rg = ctx.createRadialGradient(c, c, 0, c, c, rad);
    rg.addColorStop(0, 'rgba(27,27,31,1)'); rg.addColorStop(1, 'rgba(27,27,31,0)');
    ctx.fillStyle = rg; ctx.fillRect(0, 0, s, s);
    ctx.restore();
    ctx.strokeStyle = 'rgba(255,255,255,.12)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(c, c, rad, 0, Math.PI * 2); ctx.stroke();
    const px = c + Math.cos(W.h) * W.a * rad, py = c + Math.sin(W.h) * W.a * rad;
    ctx.shadowColor = 'rgba(0,0,0,.5)'; ctx.shadowBlur = 8;
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(px, py, 12, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;
    info.textContent = W.a > 0.005 ? Math.round(W.a * 100) + '%' : '—';
  };
  let last = 0;
  cv.addEventListener('pointerdown', e => {
    const now = Date.now();
    if (now - last < 320) { S.P.wheels[key] = { h: 0, a: 0 }; draw(); changed(); last = 0; return; }
    last = now;
    cv.setPointerCapture(e.pointerId);
    const mv = ev => {
      const r = cv.getBoundingClientRect(), rad = r.width / 2 - 12 * r.width / cv.width;
      const dx = ev.clientX - r.left - r.width / 2, dy = ev.clientY - r.top - r.height / 2;
      S.P.wheels[key] = { h: Math.atan2(dy, dx), a: Math.min(1, Math.hypot(dx, dy) / rad) };
      draw(); changed();
    };
    mv(e);
    const up = () => { cv.removeEventListener('pointermove', mv); cv.removeEventListener('pointerup', up); cv.removeEventListener('pointercancel', up); };
    cv.addEventListener('pointermove', mv); cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
  });
  wheelDraws.push(draw); refreshers.push(draw); draw();
});

/* --- Curvas --- */
paneHead(panes.curvas, 'Curvas', () => { S.P.curves = defaults().curves; });
const seg = el('div', { class: 'seg' });
[['m', 'RGB'], ['r', 'Vermelho'], ['g', 'Verde'], ['b', 'Azul']].forEach(([k, t]) =>
  seg.append(el('button', { 'data-c': k, class: k === 'm' ? 'on' : null, onclick: () => {
    S.curveCh = k; seg.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.c === k)); drawCurve();
  } }, t)));
const curveCv = el('canvas', { id: 'curve', 'aria-label': 'Editor de curvas' });
panes.curvas.append(seg, curveCv,
  el('div', { class: 'two', style: 'margin-top:10px' }, el('button', { class: 'btn ghost sm', onclick: () => { S.P.curves[S.curveCh] = CX.slice(); drawCurve(); changed(); } }, 'Zerar este canal')),
  el('p', { class: 'hint' }, 'Arraste os pontos para cima ou para baixo.'));
const CURVE_COL = { m: '#f4f4f5', r: '#ff6b6b', g: '#5fcf80', b: '#6f8fff' };
function drawCurve() {
  const r = curveCv.getBoundingClientRect(); if (!r.width) return;
  const dpr = window.devicePixelRatio || 1;
  curveCv.width = Math.round(r.width * dpr); curveCv.height = Math.round(r.height * dpr);
  const x = curveCv.getContext('2d'), W = curveCv.width, H = curveCv.height, pad = 14 * dpr;
  const X = v => pad + v * (W - 2 * pad), Y = v => H - pad - v * (H - 2 * pad);
  x.clearRect(0, 0, W, H);
  x.strokeStyle = '#222226'; x.lineWidth = 1 * dpr;
  for (let i = 0; i <= 4; i++) { x.beginPath(); x.moveTo(X(i / 4), Y(0)); x.lineTo(X(i / 4), Y(1)); x.moveTo(X(0), Y(i / 4)); x.lineTo(X(1), Y(i / 4)); x.stroke(); }
  x.setLineDash([4 * dpr, 4 * dpr]); x.strokeStyle = '#34343a'; x.beginPath(); x.moveTo(X(0), Y(0)); x.lineTo(X(1), Y(1)); x.stroke(); x.setLineDash([]);
  for (const k of ['m', 'r', 'g', 'b']) {
    if (k !== S.curveCh && isIdent(S.P.curves[k])) continue;
    const T = curveTable(S.P.curves[k]);
    x.strokeStyle = CURVE_COL[k]; x.globalAlpha = k === S.curveCh ? 1 : 0.3; x.lineWidth = (k === S.curveCh ? 2.5 : 1.5) * dpr;
    x.beginPath();
    for (let i = 0; i < 256; i++) { const px = X(i / 255), py = Y(clamp01(T[i])); i ? x.lineTo(px, py) : x.moveTo(px, py); }
    x.stroke();
  }
  x.globalAlpha = 1;
  const ys = S.P.curves[S.curveCh];
  CX.forEach((cx, i) => { x.fillStyle = '#fff'; x.beginPath(); x.arc(X(cx), Y(ys[i]), 7 * dpr, 0, Math.PI * 2); x.fill(); });
}
curveCv.addEventListener('pointerdown', e => {
  const r = curveCv.getBoundingClientRect(), pad = 14;
  const fx = (e.clientX - r.left - pad) / (r.width - 2 * pad);
  let idx = 0, best = 9;
  CX.forEach((cx, i) => { const d = Math.abs(cx - fx); if (d < best) { best = d; idx = i; } });
  curveCv.setPointerCapture(e.pointerId);
  const mv = ev => {
    const fy = 1 - (ev.clientY - r.top - pad) / (r.height - 2 * pad);
    S.P.curves[S.curveCh][idx] = clamp01(fy); drawCurve(); changed();
  };
  mv(e);
  const up = () => { curveCv.removeEventListener('pointermove', mv); curveCv.removeEventListener('pointerup', up); curveCv.removeEventListener('pointercancel', up); };
  curveCv.addEventListener('pointermove', mv); curveCv.addEventListener('pointerup', up); curveCv.addEventListener('pointercancel', up);
});
refreshers.push(drawCurve);

/* --- HSL --- */
paneHead(panes.hsl, 'HSL por cor', () => { S.P.hsl = defaults().hsl; });
const bandRow = el('div', { class: 'bands' });
const bandName = el('p', { class: 'hint', style: 'margin:8px 0 0;font-weight:600;color:var(--text)' });
panes.hsl.append(bandRow, bandName);
const bandBtns = HSL_BANDS.map(([name, , col], i) => {
  const b = el('button', { class: 'band', style: 'background:' + col, 'aria-label': name, onclick: () => { S.hslSel = i; refreshUI(); } });
  bandRow.append(b); return b;
});
slider(panes.hsl, { label: 'Matiz', min: -100, max: 100, get: () => S.P.hsl[S.hslSel].h, set: v => S.P.hsl[S.hslSel].h = v });
slider(panes.hsl, { label: 'Saturação', min: -100, max: 100, get: () => S.P.hsl[S.hslSel].s, set: v => S.P.hsl[S.hslSel].s = v });
slider(panes.hsl, { label: 'Luminância', min: -100, max: 100, get: () => S.P.hsl[S.hslSel].l, set: v => S.P.hsl[S.hslSel].l = v });
const syncBands = () => {
  bandBtns.forEach((b, i) => { const x = S.P.hsl[i]; b.classList.toggle('on', i === S.hslSel); b.classList.toggle('mod', !!(x.h || x.s || x.l)); });
  bandName.textContent = HSL_BANDS[S.hslSel][0];
};
refreshers.push(syncBands);
panes.hsl.addEventListener('input', syncBands);

/* =====================================================================
   Arquivos
   ===================================================================== */
function pick(sel) { const i = $(sel); i.value = ''; i.click(); }
$('#mediaChip').addEventListener('click', () => pick('#fileMedia'));
$('#fileMedia').addEventListener('change', e => { const f = e.target.files[0]; if (f) openMedia(f); });
$('#fileRef').addEventListener('change', e => { const f = e.target.files[0]; if (f) attachRef(f); });
$('#fileCube').addEventListener('change', e => { const f = e.target.files[0]; if (f) importCube(f); });

async function openMedia(file) {
  busy('Abrindo ' + (isVideoFile(file) ? 'vídeo' : 'foto') + '…');
  const url = URL.createObjectURL(file);
  try {
    if (isVideoFile(file)) {
      const v = await loadVideo(url);
      await seekTo(v, Math.min(0.05, (v.duration || 1) / 2));
      setMedia({ kind: 'video', el: v, url, name: file.name, w: v.videoWidth, h: v.videoHeight });
    } else {
      const img = await loadImage(url);
      const prev = scaledCanvas(img, img.naturalWidth, img.naturalHeight, Math.min(2048, R ? R.maxTex : 2048));
      setMedia({ kind: 'image', el: prev, full: img, url, name: file.name, w: img.naturalWidth, h: img.naturalHeight });
    }
    if (S.ref && S.ref.kind === 'ref') {
      busyText('Adaptando o look à sua mídia…');
      S.ref.src = await mediaStats();
      drawRefPane(); changed(true);
      toast('Look adaptado à sua mídia');
    } else toast('Mídia aberta');
  } catch (e) { URL.revokeObjectURL(url); toast('Não consegui abrir: ' + e.message, true); }
  finally { unbusy(); }
}

async function mediaStats() {
  const m = S.media;
  if (!m || m.kind === 'sample') return null;
  if (S.srcCache) return S.srcCache;
  if (m.kind === 'image') S.srcCache = statsFromData([pixelsOf(m.el, m.el.width, m.el.height)]);
  else {
    const v = await loadVideo(m.url);
    const { frames } = await sampleVideo(v, 8);
    v.removeAttribute('src'); v.load();
    S.srcCache = statsFromData(frames);
  }
  return S.srcCache;
}

async function attachRef(file) {
  busy('Lendo as cores da referência…');
  const url = URL.createObjectURL(file);
  try {
    let frames, thumb;
    if (isVideoFile(file)) {
      const v = await loadVideo(url);
      const out = await sampleVideo(v, 16, p => progress(p * 0.8));
      frames = out.frames; thumb = out.thumb;
      v.removeAttribute('src'); v.load();
    } else {
      const img = await loadImage(url);
      frames = [pixelsOf(img, img.naturalWidth, img.naturalHeight)];
      thumb = thumbOf(img, img.naturalWidth, img.naturalHeight);
    }
    busyText('Extraindo o look…');
    await new Promise(r => setTimeout(r, 30));
    const stats = statsFromData(frames);
    const src = await mediaStats();
    progress(1);
    const fresh = !S.active;
    if (fresh) applyRecord(null);
    S.ref = { kind: 'ref', name: file.name.replace(/\.[^.]+$/, ''), thumb, stats, src };
    S.refCfg = Object.assign({}, REF_DEFAULT);
    if (S.name === 'Sem título') S.name = 'Look ' + S.ref.name;
    if (fresh) showEditor('look'); else { setTab('look'); refreshUI(); drawRefPane(); }
    changed(true);
    toast('Look extraído');
  } catch (e) { toast('Não consegui analisar: ' + e.message, true); }
  finally { URL.revokeObjectURL(url); unbusy(); }
}
async function importCube(file) {
  busy('Lendo LUT…');
  try {
    const text = await file.text();
    const base = parseCube(text);
    const fresh = !S.active;
    if (fresh) applyRecord(null);
    S.ref = { kind: 'cube', name: file.name.replace(/\.cube$/i, ''), base };
    S.refCfg.amount = 100;
    if (S.name === 'Sem título') S.name = S.ref.name;
    if (fresh) showEditor('look'); else { setTab('look'); refreshUI(); drawRefPane(); }
    changed(true);
    toast('LUT importado');
  } catch (e) { toast('Não consegui importar: ' + e.message, true); }
  finally { unbusy(); }
}

/* salvar arquivos (galeria / Downloads) */
function blobToB64(blob) {
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(String(fr.result).split(',')[1] || '');
    fr.onerror = () => rej(fr.error);
    fr.readAsDataURL(blob);
  });
}
async function saveBlob(blob, name, kind, mime, onp) {
  if (!Native) {
    const a = el('a', { href: URL.createObjectURL(blob), download: name });
    document.body.append(a); a.click(); a.remove();
    return 'Downloads/' + name;
  }
  const tok = Native.fileBegin(name, mime, kind);
  if (!tok) throw new Error(Native.lastError() || 'não consegui criar o arquivo');
  try {
    const CH = 768 * 1024;
    for (let off = 0; off < blob.size; off += CH) {
      const b64 = await blobToB64(blob.slice(off, off + CH));
      if (!Native.fileAppend(tok, b64)) throw new Error(Native.lastError() || 'falha ao gravar');
      if (onp) onp(Math.min(1, (off + CH) / blob.size));
    }
    const where = Native.fileEnd(tok);
    if (!where) throw new Error(Native.lastError() || 'falha ao finalizar');
    return where;
  } catch (e) { Native.fileAbort(tok); throw e; }
}
const safeName = s => (String(s || 'Tonalize').replace(/[\\/:*?"<>|]+/g, '').trim() || 'Tonalize').slice(0, 60);
const stamp = () => { const d = new Date(), p = n => String(n).padStart(2, '0'); return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds()); };

async function exportCube() {
  busy('Gerando .cube…');
  try {
    if (dirty || baseDirty) tick();
    const txt = buildCube(S.name);
    const where = await saveBlob(new Blob([txt], { type: 'application/octet-stream' }), safeName(S.name) + '.cube', 'download', 'application/octet-stream');
    toast('LUT salvo em ' + where);
  } catch (e) { toast('Erro ao salvar: ' + e.message, true); }
  finally { unbusy(); }
}

async function exportPhoto() {
  const m = S.media; if (!m) return;
  busy('Exportando foto…');
  let r2 = null;
  try {
    if (dirty || baseDirty) tick();
    const src = m.kind === 'image' ? m.full : m.el;
    const w = m.kind === 'image' ? src.naturalWidth : src.width, h = m.kind === 'image' ? src.naturalHeight : src.height;
    const cap = Math.min(R ? R.maxTex : 4096, 8192);
    const input = Math.max(w, h) > cap ? scaledCanvas(src, w, h, cap) : src;
    const cv = document.createElement('canvas');
    cv.width = input.naturalWidth || input.width; cv.height = input.naturalHeight || input.height;
    r2 = new Renderer(cv, true);
    r2.setLut(S.tex); r2.setSource(input); r2.draw(-1);
    const blob = await new Promise(res => cv.toBlob(res, 'image/jpeg', 0.95));
    if (!blob) throw new Error('não consegui gerar a imagem');
    const where = await saveBlob(blob, safeName(S.name) + '-' + stamp() + '.jpg', 'image', 'image/jpeg', p => progress(p));
    toast('Foto salva em ' + where);
  } catch (e) { toast('Erro ao exportar: ' + e.message, true); }
  finally { if (r2) r2.dispose(); unbusy(); }
}

function pickRecorderType() {
  if (!window.MediaRecorder) return null;
  const opts = [
    ['video/mp4;codecs=avc1.640028,mp4a.40.2', 'mp4'], ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'mp4'],
    ['video/mp4;codecs=avc1,mp4a', 'mp4'], ['video/mp4', 'mp4'],
    ['video/webm;codecs=vp9,opus', 'webm'], ['video/webm;codecs=vp8,opus', 'webm'], ['video/webm', 'webm']
  ];
  for (const o of opts) if (MediaRecorder.isTypeSupported(o[0])) return o;
  return null;
}

let cancelExport = null;
async function exportVideo(maxSide, bitrate) {
  const m = S.media; if (!m || m.kind !== 'video') return;
  const type = pickRecorderType();
  if (!type) { toast('Este aparelho não grava vídeo pelo app. Exporte o .cube.', true); return; }
  if (m.el && !m.el.paused) m.el.pause();
  busy('Preparando vídeo…', true);
  let r2 = null, actx = null, cv = null, v = null, canceled = false;
  if (Native) Native.keepAwake(true);
  try {
    if (dirty || baseDirty) tick();
    v = await loadVideo(m.url);
    v.muted = false;
    const vw = v.videoWidth, vh = v.videoHeight, s = Math.min(1, maxSide / Math.max(vw, vh));
    cv = document.createElement('canvas');
    cv.width = Math.round(vw * s / 2) * 2; cv.height = Math.round(vh * s / 2) * 2;
    cv.style.cssText = 'position:fixed;left:-20000px;top:0;width:8px;height:8px;pointer-events:none';
    document.body.append(cv);
    r2 = new Renderer(cv, false);
    r2.setLut(S.tex);
    const stream = cv.captureStream(30);
    try {
      actx = new (window.AudioContext || window.webkitAudioContext)();
      const node = actx.createMediaElementSource(v), dest = actx.createMediaStreamDestination();
      node.connect(dest);
      dest.stream.getAudioTracks().forEach(t => stream.addTrack(t));
      if (actx.state === 'suspended') await actx.resume();
    } catch (e) { /* sem áudio */ }
    const rec = new MediaRecorder(stream, { mimeType: type[0], videoBitsPerSecond: bitrate, audioBitsPerSecond: 192000 });
    const chunks = [];
    rec.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
    const stopped = new Promise(res => { rec.onstop = res; });
    await seekTo(v, 0);
    r2.setSource(v); r2.draw(-1);
    busyText('Exportando vídeo… mantenha o app aberto');
    cancelExport = () => { canceled = true; v.pause(); if (rec.state !== 'inactive') rec.stop(); };
    const frame = () => {
      if (canceled || v.ended) return;
      r2.setSource(v); r2.draw(-1);
      if (v.duration) progress(v.currentTime / v.duration);
      if (v.requestVideoFrameCallback) v.requestVideoFrameCallback(frame); else requestAnimationFrame(frame);
    };
    v.onended = () => { r2.setSource(v); r2.draw(-1); setTimeout(() => { if (rec.state !== 'inactive') rec.stop(); }, 250); };
    rec.start(1000);
    await v.play();
    frame();
    await stopped;
    cancelExport = null;
    if (canceled) { toast('Exportação cancelada'); return; }
    busyText('Salvando na galeria…', false);
    const blob = new Blob(chunks, { type: type[0].split(';')[0] });
    const where = await saveBlob(blob, safeName(S.name) + '-' + stamp() + '.' + type[1], 'video', type[0].split(';')[0], p => progress(p));
    toast('Vídeo salvo em ' + where + (type[1] === 'webm' ? ' (formato WebM)' : ''));
  } catch (e) { toast('Erro ao exportar vídeo: ' + e.message, true); }
  finally {
    cancelExport = null;
    if (Native) Native.keepAwake(false);
    if (v) { v.pause(); v.removeAttribute('src'); v.load(); }
    if (actx) actx.close().catch(() => {});
    if (r2) r2.dispose();
    if (cv) cv.remove();
    unbusy();
  }
}
$('#busyCancel').addEventListener('click', () => { if (cancelExport) cancelExport(); });

/* =====================================================================
   Biblioteca "Meus looks"
   ===================================================================== */
function f32ToB64(f) {
  const u = new Uint16Array(f.length);
  for (let i = 0; i < f.length; i++) u[i] = Math.round(clamp01(f[i]) * 65535);
  const bytes = new Uint8Array(u.buffer);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
function b64ToF32(b64) {
  const s = atob(b64), bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  const u = new Uint16Array(bytes.buffer), f = new Float32Array(u.length);
  for (let i = 0; i < u.length; i++) f[i] = u[i] / 65535;
  return f;
}
function record() {
  const r = { v: 2, name: S.name, P: S.P, refCfg: S.refCfg, ref: null };
  if (S.ref) r.ref = S.ref.kind === 'cube'
    ? { kind: 'cube', name: S.ref.name, base: f32ToB64(S.ref.base) }
    : { kind: 'ref', name: S.ref.name, thumb: S.ref.thumb, stats: S.ref.stats, src: S.ref.src || null };
  return r;
}
function applyRecord(r, id) {
  S.P = mergeDefaults(r && r.P);
  S.refCfg = Object.assign({}, REF_DEFAULT, r && r.refCfg);
  S.name = (r && r.name) || 'Sem título';
  S.id = id || null;
  S.ref = null;
  if (r && r.ref) S.ref = r.ref.kind === 'cube' ? { kind: 'cube', name: r.ref.name, base: b64ToF32(r.ref.base) } : Object.assign({}, r.ref);
  // se há mídia aberta, o look se adapta a ela
  if (S.ref && S.ref.kind === 'ref' && S.srcCache) S.ref.src = S.srcCache;
  S.edited = false;
  refreshUI(); drawRefPane(); changed(true, true);
}
const Store = {
  list() {
    try {
      if (Native) return JSON.parse(Native.lutList() || '[]');
      return JSON.parse(localStorage.getItem('tonalize.lib') || '[]');
    } catch (e) { return []; }
  },
  save(meta, data) {
    if (Native) { if (!Native.lutSave(meta.id, JSON.stringify(meta), JSON.stringify(data))) throw new Error(Native.lastError() || 'falha ao salvar'); return; }
    const l = Store.list().filter(x => x.id !== meta.id); l.unshift(meta);
    localStorage.setItem('tonalize.lib', JSON.stringify(l));
    localStorage.setItem('tonalize.lut.' + meta.id, JSON.stringify(data));
  },
  load(id) {
    const t = Native ? Native.lutLoad(id) : localStorage.getItem('tonalize.lut.' + id);
    if (!t) throw new Error('look não encontrado');
    return JSON.parse(t);
  },
  del(id) {
    if (Native) { Native.lutDelete(id); return; }
    localStorage.setItem('tonalize.lib', JSON.stringify(Store.list().filter(x => x.id !== id)));
    localStorage.removeItem('tonalize.lut.' + id);
  }
};
function viewThumb() {
  try { render(); return scaledCanvas(view, view.width, view.height, 280).toDataURL('image/jpeg', 0.8); }
  catch (e) { return ''; }
}
function saveToLibrary(asNew, quiet) {
  try {
    if (dirty || baseDirty) tick();
    const id = (!asNew && S.id) || ('l' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6));
    const meta = { id, name: S.name, date: Date.now(), thumb: viewThumb() };
    Store.save(meta, record());
    S.id = id; S.edited = false;
    toast("Salvo em Meus looks");
    return true;
  } catch (e) { toast('Não consegui salvar: ' + e.message, true); return false; }
}

/* sessão atual (retoma de onde parou) */
let saveT = 0;
function flushSave() {
  clearTimeout(saveT); saveT = 0;
  if (!S.active) return;
  try { localStorage.setItem('tonalize.session', JSON.stringify(Object.assign(record(), { id: S.id, thumb: viewThumb() }))); } catch (e) { /* cheio */ }
}
function scheduleSave() { if (!S.active) return; clearTimeout(saveT); saveT = setTimeout(flushSave, 900); }
window.addEventListener('pagehide', flushSave);
document.addEventListener('visibilitychange', () => { if (document.hidden) flushSave(); });
window.appPause = flushSave;

/* =====================================================================
   Tela inicial
   ===================================================================== */
function readSession() { try { return JSON.parse(localStorage.getItem('tonalize.session') || 'null'); } catch (e) { return null; } }
function drawHome() {
  const res = $('#resume'); res.innerHTML = '';
  const s = readSession();
  if (s && (s.ref || JSON.stringify(s.P) !== JSON.stringify(defaults()))) {
    res.append(el('button', { class: 'resume', onclick: () => { applyRecord(s, s.id); showEditor(s.ref ? 'look' : 'luz'); } },
      s.thumb ? el('img', { src: s.thumb, alt: '' }) : el('span', { class: 'ph' }),
      el('div', null, el('small', null, 'Continuar editando'), el('b', null, s.name || 'Sem título')),
      icon('chev')));
  }
  const grid = $('#libGrid'); grid.innerHTML = '';
  const list = Store.list();
  $('#libCount').textContent = list.length ? list.length + (list.length === 1 ? ' look' : ' looks') : '';
  if (!list.length) { grid.append(el('div', { class: 'empty' }, 'Seus looks salvos aparecem aqui.')); return; }
  list.forEach(meta => grid.append(el('button', { class: 'item', onclick: () => libItem(meta) },
    meta.thumb ? el('img', { src: meta.thumb, alt: '' }) : el('span', { class: 'ph' }),
    el('div', null, meta.name), el('small', null, new Date(meta.date).toLocaleDateString('pt-BR')))));
}
$('#hRef').addEventListener('click', () => pick('#fileRef'));
$('#hImport').addEventListener('click', () => pick('#fileCube'));
$('#hBlank').addEventListener('click', () => { applyRecord(null); showEditor('luz'); });
$('#btnBack').addEventListener('click', showHome);

/* =====================================================================
   Folhas (Exportar / Nome / Look salvo)
   ===================================================================== */
const sheet = $('#sheet'), sheetBody = $('#sheetBody');
function openSheet(build) { sheetBody.innerHTML = ''; build(sheetBody); sheet.classList.remove('hidden'); }
function closeSheet() { sheet.classList.add('hidden'); }
sheet.addEventListener('click', e => { if (e.target === sheet) closeSheet(); });
const opt = (ic, title, sub, onclick, main) => el('button', { class: 'opt' + (main ? ' main' : ''), onclick },
  el('span', { class: 'ic' }, icon(ic)), el('div', null, el('b', null, title), el('small', null, sub)), icon('chev'));

$('#btnName').addEventListener('click', () => openSheet(b => {
  const inp = el('input', { class: 'field', value: S.name, maxlength: 60, 'aria-label': 'Nome do look' });
  b.append(el('h3', null, 'Nome do look'), el('p', { class: 'sub' }, 'É o nome do arquivo .cube e do look em Meus looks.'), inp,
    el('button', { class: 'btn primary block', style: 'margin-top:12px', onclick: () => { S.name = inp.value.trim() || 'Sem título'; S.edited = true; refreshUI(); scheduleSave(); closeSheet(); } }, 'Salvar'));
  setTimeout(() => inp.focus(), 60);
}));

const EXP = { res: 1920, rate: 12e6 };
function openExport() {
  const m = S.media;
  openSheet(b => {
    b.append(el('h3', null, 'Exportar'), el('p', { class: 'sub' }, S.name));
    b.append(opt('cube', 'LUT (.cube)', 'CapCut PC, Premiere, DaVinci, Lightroom', () => { closeSheet(); exportCube(); }, true));
    if (m && m.kind === 'image') b.append(opt('image', 'Foto com o look', 'JPG em alta qualidade na galeria', () => { closeSheet(); exportPhoto(); }));
    if (m && m.kind === 'video') b.append(opt('film', 'Vídeo com o look', 'Com áudio, salvo na galeria', openVideoExport));
    b.append(opt('save', S.id ? 'Atualizar em Meus looks' : 'Salvar em Meus looks', 'Para reutilizar depois', () => { if (saveToLibrary(false)) closeSheet(); }));
    if (S.id) b.append(opt('plus', 'Salvar como novo look', 'Mantém o original', () => { if (saveToLibrary(true)) closeSheet(); }));
    b.append(el('div', { class: 'note' }, icon('info'),
      el('span', null, 'O CapCut do celular não importa .cube. Lá, exporte o vídeo já com o look. No CapCut do computador, importe o .cube em Ajustar → LUT.')));
  });
}
function openVideoExport() {
  openSheet(b => {
    const choice = (list, key) => {
      const row = el('div', { class: 'choice' });
      list.forEach(([label, val]) => row.append(el('button', { class: EXP[key] === val ? 'on' : null, onclick: e => { EXP[key] = val; row.querySelectorAll('button').forEach(c => c.classList.remove('on')); e.target.classList.add('on'); } }, label)));
      return row;
    };
    const t = pickRecorderType();
    b.append(el('h3', null, 'Vídeo com o look'),
      el('p', { class: 'sub' }, 'A exportação acontece em tempo real: 1 minuto de vídeo leva cerca de 1 minuto. ' + (t ? 'Formato ' + t[1].toUpperCase() + '.' : 'Este aparelho não grava vídeo pelo app.')),
      el('div', { class: 'sec' }, 'Resolução'), choice([['720p', 1280], ['1080p', 1920], ['Original', 4096]], 'res'),
      el('div', { class: 'sec' }, 'Qualidade'), choice([['Padrão', 12e6], ['Alta', 24e6]], 'rate'),
      el('button', { class: 'btn primary lg', style: 'margin-top:20px', onclick: () => { closeSheet(); exportVideo(EXP.res, EXP.rate * (EXP.res <= 1280 ? 0.6 : EXP.res > 1920 ? 2 : 1)); } }, 'Exportar vídeo'),
      el('button', { class: 'btn quiet block', onclick: openExport }, 'Voltar'));
  });
}
$('#btnExport').addEventListener('click', openExport);

function libItem(meta) {
  openSheet(b => {
    b.append(el('h3', null, meta.name), el('p', { class: 'sub' }, 'Salvo em ' + new Date(meta.date).toLocaleDateString('pt-BR')));
    b.append(
      opt('spark', 'Abrir e editar', 'Aplica o look na sua mídia', () => { try { const r = Store.load(meta.id); applyRecord(r, meta.id); closeSheet(); showEditor(r.ref ? 'look' : 'luz'); } catch (e) { toast(e.message, true); } }, true),
      opt('cube', 'Exportar .cube', 'Direto para Downloads/Tonalize', async () => { try { applyRecord(Store.load(meta.id), meta.id); closeSheet(); await exportCube(); } catch (e) { toast(e.message, true); } }),
      el('button', { class: 'btn quiet block', style: 'margin-top:10px;color:var(--bad)', onclick: () => confirmDel(meta) }, 'Apagar look'));
  });
}
function confirmDel(meta) {
  openSheet(b => {
    b.append(el('h3', null, 'Apagar “' + meta.name + '”?'), el('p', { class: 'sub' }, 'Isso não pode ser desfeito.'),
      el('div', { class: 'two' },
        el('button', { class: 'btn ghost', onclick: () => libItem(meta) }, 'Cancelar'),
        el('button', { class: 'btn danger', onclick: () => { Store.del(meta.id); if (S.id === meta.id) S.id = null; closeSheet(); toast('Look apagado'); drawHome(); } }, 'Apagar')));
  });
}

/* =====================================================================
   Avisos
   ===================================================================== */
let toastT = 0;
function toast(msg, err) {
  const t = $('#toast');
  t.textContent = msg; t.classList.toggle('err', !!err); t.classList.add('show');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), err ? 4200 : 2400);
}
function busy(text, cancellable) {
  $('#busyText').textContent = text; $('#busyBar').style.width = '0';
  $('#busyCancel').classList.toggle('hidden', !cancellable);
  $('#busy').classList.remove('hidden');
}
function busyText(t, cancellable) { $('#busyText').textContent = t; if (cancellable === false) $('#busyCancel').classList.add('hidden'); }
function progress(p) { $('#busyBar').style.width = Math.round(clamp01(p) * 100) + '%'; }
function unbusy() { $('#busy').classList.add('hidden'); }

/* botão voltar do Android */
window.appBack = function () {
  if (!sheet.classList.contains('hidden')) { closeSheet(); return true; }
  if (!editor.classList.contains('hidden')) { showHome(); return true; }
  return false;
};

/* =====================================================================
   Início
   ===================================================================== */
const chart = sampleChart();
setMedia({ kind: 'sample', el: chart, name: 'Imagem de exemplo', w: chart.width, h: chart.height });
refreshUI(); drawRefPane(); drawHome();
changed(true, true);

/* para testes automatizados */
window.__tonalize = { S, computeLUT, computeBase, buildCube, parseCube, tick, manual, prepManual, statsFromData, describe, upgradeStats, attachRef, openMedia, showEditor, showHome, applyRecord, setTab, openExport };

})();
