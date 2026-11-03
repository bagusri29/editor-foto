/* =====================================================================
 * worker.js — Image Processor (Web Worker klasik)
 *
 * Seluruh komputasi piksel yang berat dijalankan di sini agar main thread
 * (UI) tetap responsif. Buffer dikirim/diterima sebagai Transferable
 * sehingga tidak ada penyalinan memori.
 *
 * Protokol pesan
 *   main → worker : { id, task, payload }
 *   worker → main : { id, ok:true,  task, result, ms }
 *                   { id, ok:false, task, error }
 *
 * Task
 *   grade : matriks warna 3×3 + split-toning + black/white point
 *   grain : tekstur noise film (abu-abu 128 = netral untuk blend "overlay")
 *   dust  : debu, serat dan goresan pada layer RGBA transparan
 * ===================================================================== */
'use strict';

/* ───────────── util ───────────── */

/** PRNG deterministik (mulberry32) → hasil identik untuk seed yang sama. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

function assertSize(w, h) {
  if (!Number.isInteger(w) || !Number.isInteger(h) || w < 1 || h < 1 || w * h > 64e6) {
    throw new Error('Dimensi gambar tidak valid: ' + w + '×' + h);
  }
}

/* ───────────── task: grade ─────────────
 * Urutan per piksel:
 *   1. matriks warna 3×3 + offset
 *   2. split-toning: rgb += shadowTint·(1-L)² + highlightTint·L²
 *   3. black/white point: v = bp + v·(wp − bp)
 */
function taskGrade({ buffer, width, height, params }) {
  assertSize(width, height);
  if (!(buffer instanceof ArrayBuffer) || buffer.byteLength !== width * height * 4) {
    throw new Error('Ukuran buffer tidak cocok dengan dimensi gambar');
  }
  const d = new Uint8ClampedArray(buffer);
  const m = params.matrix;
  const o = params.offset;
  const st = params.shadowTint;
  const ht = params.highlightTint;
  const bal = params.splitBalance || 0;
  const bp = params.blackPoint || 0;
  const span = (params.whitePoint == null ? 1 : params.whitePoint) - bp;

  const m0 = m[0], m1 = m[1], m2 = m[2];
  const m3 = m[3], m4 = m[4], m5 = m[5];
  const m6 = m[6], m7 = m[7], m8 = m[8];

  for (let i = 0, n = d.length; i < n; i += 4) {
    const r = d[i] / 255;
    const g = d[i + 1] / 255;
    const b = d[i + 2] / 255;

    let nr = m0 * r + m1 * g + m2 * b + o[0];
    let ng = m3 * r + m4 * g + m5 * b + o[1];
    let nb = m6 * r + m7 * g + m8 * b + o[2];

    const l = clamp01(0.2126 * nr + 0.7152 * ng + 0.0722 * nb + bal);
    const ws = (1 - l) * (1 - l);
    const wh = l * l;
    nr += st[0] * ws + ht[0] * wh;
    ng += st[1] * ws + ht[1] * wh;
    nb += st[2] * ws + ht[2] * wh;

    // Uint8ClampedArray otomatis membulatkan dan membatasi ke 0–255.
    d[i] = (bp + nr * span) * 255;
    d[i + 1] = (bp + ng * span) * 255;
    d[i + 2] = (bp + nb * span) * 255;
    // alpha (d[i+3]) tidak diubah
  }
  return { result: { buffer, width, height }, transfer: [buffer] };
}

/* ───────────── task: grain ─────────────
 * Noise Gaussian (aproksimasi Irwin–Hall, 3 sampel) dibuat pada grid yang
 * lebih kecil lalu di-upscale bilinear sehingga "butir" berukuran `size` px.
 * Komponen luma dibagi ke semua kanal; `chroma` menambahkan noise warna.
 * Nilai 128 = netral untuk blend mode "overlay".
 */
function taskGrain({ width, height, size = 1.5, sigma = 0.17, chroma = 0.12, seed = 1 }) {
  assertSize(width, height);
  size = Math.min(6, Math.max(1, size));
  const rand = mulberry32(seed);
  const gauss = () => (rand() + rand() + rand() - 1.5) * 2; // ≈ N(0,1)

  const gw = Math.ceil(width / size) + 2;
  const gh = Math.ceil(height / size) + 2;
  const cells = gw * gh;
  const nL = new Float32Array(cells);
  const nR = new Float32Array(cells);
  const nG = new Float32Array(cells);
  const nB = new Float32Array(cells);
  for (let i = 0; i < cells; i++) {
    nL[i] = gauss();
    nR[i] = gauss();
    nG[i] = gauss();
    nB[i] = gauss();
  }

  // Interpolasi bilinear menurunkan deviasi standar ≈ 2/3 → kompensasi.
  const gain = (size > 1 ? 1.5 : 1) * sigma * 255;
  const lw = 1 - chroma;
  const out = new Uint8ClampedArray(width * height * 4);

  for (let y = 0; y < height; y++) {
    const fy = y / size;
    const y0 = Math.floor(fy);
    const ty = fy - y0;
    const row0 = y0 * gw;
    const row1 = (y0 + 1) * gw;
    for (let x = 0; x < width; x++) {
      const fx = x / size;
      const x0 = Math.floor(fx);
      const tx = fx - x0;
      const a = row0 + x0;
      const b = row1 + x0;
      const w00 = (1 - tx) * (1 - ty);
      const w10 = tx * (1 - ty);
      const w01 = (1 - tx) * ty;
      const w11 = tx * ty;

      const L = nL[a] * w00 + nL[a + 1] * w10 + nL[b] * w01 + nL[b + 1] * w11;
      const R = nR[a] * w00 + nR[a + 1] * w10 + nR[b] * w01 + nR[b + 1] * w11;
      const G = nG[a] * w00 + nG[a + 1] * w10 + nG[b] * w01 + nG[b + 1] * w11;
      const B = nB[a] * w00 + nB[a + 1] * w10 + nB[b] * w01 + nB[b + 1] * w11;

      const i = (y * width + x) * 4;
      out[i] = 128 + gain * (lw * L + chroma * R);
      out[i + 1] = 128 + gain * (lw * L + chroma * G);
      out[i + 2] = 128 + gain * (lw * L + chroma * B);
      out[i + 3] = 255;
    }
  }
  return { result: { buffer: out.buffer, width, height }, transfer: [out.buffer] };
}

/* ───────────── task: dust ─────────────
 * Layer RGBA transparan berisi:
 *   • bintik (70% terang, 30% gelap)
 *   • serat/rambut melengkung (kurva Bézier kuadratik)
 *   • goresan vertikal tipis
 * Semua ukuran diskalakan terhadap sisi terpanjang gambar.
 */
function taskDust({ width: w, height: h, seed = 1 }) {
  assertSize(w, h);
  const buf = new Uint8ClampedArray(w * h * 4);
  const rand = mulberry32((seed ^ 0x9e3779b9) >>> 0);
  const k = Math.max(0.6, Math.max(w, h) / 1600);
  const mp = (w * h) / 1e6;
  const LIGHT = [255, 248, 236];
  const DARK = [26, 22, 20];

  // Stempel lingkaran beranti-alias; menyimpan alpha tertinggi (tidak menumpuk gelap).
  function stamp(cx, cy, r, a, col) {
    const x0 = Math.max(0, Math.floor(cx - r - 1));
    const x1 = Math.min(w - 1, Math.ceil(cx + r + 1));
    const y0 = Math.max(0, Math.floor(cy - r - 1));
    const y1 = Math.min(h - 1, Math.ceil(cy + r + 1));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const dx = x + 0.5 - cx;
        const dy = y + 0.5 - cy;
        const cov = r + 0.5 - Math.sqrt(dx * dx + dy * dy);
        if (cov <= 0) continue;
        const A = (cov > 1 ? 1 : cov) * a * 255;
        const i = (y * w + x) * 4;
        if (A > buf[i + 3]) {
          buf[i] = col[0];
          buf[i + 1] = col[1];
          buf[i + 2] = col[2];
          buf[i + 3] = A;
        }
      }
    }
  }

  // 1) Bintik
  const specks = Math.round(150 * mp);
  for (let n = 0; n < specks; n++) {
    const r = (0.5 + Math.pow(rand(), 4) * 2.8) * k;
    stamp(rand() * w, rand() * h, r, 0.45 + 0.55 * rand(), rand() < 0.3 ? DARK : LIGHT);
  }

  // 2) Serat / rambut
  const hairs = Math.round(10 * mp);
  for (let n = 0; n < hairs; n++) {
    const len = (25 + rand() * 80) * k;
    const ang = rand() * Math.PI * 2;
    const x0 = rand() * w;
    const y0 = rand() * h;
    const x2 = x0 + Math.cos(ang) * len;
    const y2 = y0 + Math.sin(ang) * len;
    const bend = (rand() - 0.5) * len * 0.8;
    const cx = (x0 + x2) / 2 - Math.sin(ang) * bend;
    const cy = (y0 + y2) / 2 + Math.cos(ang) * bend;
    const r = (0.55 + rand() * 0.35) * k;
    const a = 0.5 + 0.4 * rand();
    const col = rand() < 0.5 ? DARK : LIGHT;
    const steps = Math.ceil(len * 1.2);
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const u = 1 - t;
      stamp(u * u * x0 + 2 * u * t * cx + t * t * x2, u * u * y0 + 2 * u * t * cy + t * t * y2, r, a, col);
    }
  }

  // 3) Goresan vertikal
  const scratches = Math.round(4 * mp);
  for (let n = 0; n < scratches; n++) {
    const len = (0.15 + rand() * 0.5) * h;
    const x0 = rand() * w;
    const y0 = rand() * Math.max(1, h - len);
    const tilt = (rand() - 0.5) * 0.06;
    const amp = 1.5 * k;
    const phase = rand() * 6.28;
    const a = 0.18 + rand() * 0.3;
    for (let s = 0; s < len; s++) {
      stamp(x0 + s * tilt + Math.sin(s / 40 + phase) * amp, y0 + s, 0.5 * k, a, LIGHT);
    }
  }

  return { result: { buffer: buf.buffer, width: w, height: h }, transfer: [buf.buffer] };
}

/* ───────────── dispatcher ───────────── */

const TASKS = { grade: taskGrade, grain: taskGrain, dust: taskDust };

self.onmessage = function (e) {
  const { id, task, payload } = e.data;
  const t0 = performance.now();
  try {
    const fn = TASKS[task];
    if (!fn) throw new Error('Task tidak dikenal: ' + task);
    const { result, transfer } = fn(payload);
    self.postMessage({ id, ok: true, task, result, ms: Math.round(performance.now() - t0) }, transfer || []);
  } catch (err) {
    self.postMessage({ id, ok: false, task, error: String((err && err.message) || err) });
  }
};
