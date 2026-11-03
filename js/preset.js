/* =====================================================================
 * presets.js — Definisi preset filter Aesthetic Lens (data murni).
 *
 * Setiap preset punya dua tahap yang dijalankan berurutan:
 *   1. cpu  → dihitung di Web Worker (matriks warna, split-toning, fade)
 *   2. gpu  → dijalankan glfx.js di WebGL (kurva, kontras, vibrance, vignette…)
 *
 * Semua nilai warna berada pada skala 0–1 (bukan 0–255) di ruang sRGB.
 * ===================================================================== */

const IDENTITY = [1, 0, 0, 0, 1, 0, 0, 0, 1];

/** Tahap CPU (Web Worker). Nilai default = tanpa perubahan. */
const cpu = (o = {}) => ({
  matrix: IDENTITY,          // 3×3 row-major: [rr rg rb, gr gg gb, br bg bb]
  offset: [0, 0, 0],         // penambah per kanal setelah matriks
  blackPoint: 0,             // mengangkat hitam (efek "fade/matte")
  whitePoint: 1,             // menurunkan putih maksimum
  shadowTint: [0, 0, 0],     // delta RGB pada bayangan (bobot = (1-L)²)
  highlightTint: [0, 0, 0],  // delta RGB pada highlight (bobot = L²)
  splitBalance: 0,           // menggeser titik tengah split-toning (-0.5…0.5)
  ...o,
});

/** Tahap GPU (glfx.js). Semua parameter bernilai -1…1 kecuali dinyatakan lain. */
const gpu = (o = {}) => ({
  brightness: 0,
  contrast: 0,
  hue: 0,
  saturation: 0,
  vibrance: 0,
  sepia: 0,                  // 0…1
  curves: null,              // { r:[[x,y]…], g:[…], b:[…] } titik 0…1
  vignette: null,            // { size: 0…1, amount: 0…1 }
  sharpen: null,             // { radius: px, strength: 0…5 } (unsharp mask)
  denoise: null,             // eksponen glfx; makin besar = makin lembut menjaga tepi
  ...o,
});

const rgb = (pts) => ({ r: pts, g: pts, b: pts });

export const CATEGORIES = [
  { id: 'cinematic', label: 'Cinematic' },
  { id: 'protone', label: 'Pro-Tone' },
  { id: 'aesthetic', label: 'Aesthetic' },
];

export const ORIGINAL = {
  id: 'original',
  name: 'Asli',
  category: '*',
  desc: 'Foto tanpa filter.',
  swatch: ['#2b2b30', '#5a5a62'],
  cpu: cpu(),
  gpu: gpu(),
  texture: { grain: 0, size: 1.5, dust: 0 },
};

export const PRESETS = [
  /* ───────────────────────── CINEMATIC ───────────────────────── */
  {
    id: 'teal-orange',
    name: 'Teal & Orange',
    category: 'cinematic',
    desc: 'Bayangan teal, highlight oranye hangat. Gaya film blockbuster.',
    swatch: ['#0f4a58', '#f0a15e'],
    cpu: cpu({
      matrix: [1.06, -0.03, -0.03, -0.02, 1.0, 0.02, -0.04, 0.02, 1.02],
      shadowTint: [-0.035, 0.012, 0.045],
      highlightTint: [0.045, 0.012, -0.04],
      blackPoint: 0.02,
      whitePoint: 0.985,
    }),
    gpu: gpu({
      contrast: 0.14,
      saturation: 0.06,
      vibrance: 0.15,
      curves: {
        r: [[0, 0], [0.25, 0.22], [0.5, 0.52], [0.75, 0.8], [1, 1]],
        g: [[0, 0], [0.25, 0.23], [0.5, 0.5], [0.75, 0.77], [1, 1]],
        b: [[0, 0.02], [0.25, 0.27], [0.5, 0.49], [0.75, 0.72], [1, 0.96]],
      },
      vignette: { size: 0.55, amount: 0.35 },
      sharpen: { radius: 1.6, strength: 0.5 },
    }),
    texture: { grain: 30, size: 1.5, dust: 15 },
  },
  {
    id: 'neo-noir',
    name: 'Neo Noir',
    category: 'cinematic',
    desc: 'Desaturasi dingin, kontras tinggi, hitam pekat.',
    swatch: ['#0b1118', '#6f8196'],
    cpu: cpu({
      matrix: [0.703, 0.243, 0.025, 0.074, 0.9, 0.025, 0.079, 0.265, 0.716],
      shadowTint: [-0.02, 0, 0.04],
      highlightTint: [0, 0.01, 0.025],
      whitePoint: 0.98,
    }),
    gpu: gpu({
      brightness: -0.05,
      contrast: 0.28,
      curves: rgb([[0, 0], [0.2, 0.13], [0.5, 0.48], [0.8, 0.87], [1, 1]]),
      vignette: { size: 0.45, amount: 0.6 },
      sharpen: { radius: 1.4, strength: 0.7 },
    }),
    texture: { grain: 45, size: 1.8, dust: 25 },
  },
  {
    id: 'golden-hour',
    name: 'Golden Hour',
    category: 'cinematic',
    desc: 'Cahaya senja keemasan dengan bayangan cokelat hangat.',
    swatch: ['#6b3a1a', '#ffc46b'],
    cpu: cpu({
      matrix: [1.06, 0.02, -0.04, 0.01, 1.0, -0.02, -0.06, -0.02, 0.94],
      shadowTint: [0.02, 0.005, -0.01],
      highlightTint: [0.05, 0.025, -0.03],
      blackPoint: 0.015,
      whitePoint: 0.99,
    }),
    gpu: gpu({
      brightness: 0.03,
      contrast: 0.1,
      saturation: 0.1,
      vibrance: 0.2,
      curves: rgb([[0, 0], [0.25, 0.23], [0.5, 0.52], [0.75, 0.79], [1, 1]]),
      vignette: { size: 0.55, amount: 0.3 },
      sharpen: { radius: 1.6, strength: 0.5 },
    }),
    texture: { grain: 25, size: 1.4, dust: 10 },
  },
  {
    id: 'silver-screen',
    name: 'Silver Screen',
    category: 'cinematic',
    desc: 'Bleach-bypass: warna pudar keperakan, kontras keras.',
    swatch: ['#2a3036', '#c9d0d6'],
    cpu: cpu({
      matrix: [0.646, 0.322, 0.033, 0.096, 0.872, 0.033, 0.096, 0.322, 0.583],
      highlightTint: [0, 0.005, 0.015],
    }),
    gpu: gpu({
      brightness: -0.02,
      contrast: 0.35,
      curves: rgb([[0, 0], [0.25, 0.17], [0.5, 0.5], [0.75, 0.84], [1, 1]]),
      vignette: { size: 0.5, amount: 0.4 },
      sharpen: { radius: 2.0, strength: 0.9 },
    }),
    texture: { grain: 40, size: 1.6, dust: 20 },
  },

  /* ───────────────────────── PRO-TONE ───────────────────────── */
  {
    id: 'clean-pro',
    name: 'Clean Pro',
    category: 'protone',
    desc: 'Netral dan bersih: kontras lembut, warna hidup, tajam.',
    swatch: ['#3a3f47', '#e8e4dc'],
    cpu: cpu({
      shadowTint: [-0.005, 0, 0.008],
      highlightTint: [0.006, 0.003, 0],
      blackPoint: 0.005,
    }),
    gpu: gpu({
      brightness: 0.02,
      contrast: 0.08,
      saturation: 0.03,
      vibrance: 0.2,
      curves: rgb([[0, 0], [0.25, 0.235], [0.5, 0.5], [0.75, 0.765], [1, 1]]),
      sharpen: { radius: 1.5, strength: 0.8 },
    }),
    texture: { grain: 0, size: 1.5, dust: 0 },
  },
  {
    id: 'portrait-glow',
    name: 'Portrait Glow',
    category: 'protone',
    desc: 'Kulit hangat dan halus, kontras lembut, tepi tetap terjaga.',
    swatch: ['#8a5a48', '#ffd9bd'],
    cpu: cpu({
      matrix: [1.03, 0, -0.02, 0, 1, 0, -0.02, 0, 0.97],
      shadowTint: [0.01, 0, 0],
      highlightTint: [0.02, 0.012, 0],
      blackPoint: 0.01,
    }),
    gpu: gpu({
      brightness: 0.05,
      contrast: 0.04,
      saturation: -0.04,
      vibrance: 0.1,
      curves: rgb([[0, 0.01], [0.25, 0.26], [0.5, 0.53], [0.75, 0.78], [1, 1]]),
      vignette: { size: 0.6, amount: 0.18 },
      sharpen: { radius: 1.2, strength: 0.35 },
      denoise: 22,
    }),
    texture: { grain: 0, size: 1.5, dust: 0 },
  },
  {
    id: 'landscape-pop',
    name: 'Landscape Pop',
    category: 'protone',
    desc: 'Warna pekat, langit dalam, detail dan "clarity" tinggi.',
    swatch: ['#1d5e7a', '#8fd16a'],
    cpu: cpu({
      shadowTint: [-0.01, 0, 0.015],
      highlightTint: [0.01, 0.005, 0],
    }),
    gpu: gpu({
      contrast: 0.2,
      saturation: 0.12,
      vibrance: 0.45,
      curves: rgb([[0, 0], [0.25, 0.2], [0.5, 0.5], [0.75, 0.8], [1, 1]]),
      sharpen: { radius: 3.5, strength: 0.9 },
    }),
    texture: { grain: 0, size: 1.5, dust: 0 },
  },
  {
    id: 'studio-bw',
    name: 'Studio B&W',
    category: 'protone',
    desc: 'Hitam-putih dengan filter merah ringan; kulit tampak bersih.',
    swatch: ['#111111', '#eeeeee'],
    cpu: cpu({
      matrix: [0.4, 0.45, 0.15, 0.4, 0.45, 0.15, 0.4, 0.45, 0.15],
    }),
    gpu: gpu({
      contrast: 0.22,
      curves: rgb([[0, 0], [0.25, 0.21], [0.5, 0.5], [0.75, 0.79], [1, 1]]),
      vignette: { size: 0.5, amount: 0.3 },
      sharpen: { radius: 1.6, strength: 0.9 },
    }),
    texture: { grain: 35, size: 1.6, dust: 0 },
  },

  /* ───────────────────────── AESTHETIC ───────────────────────── */
  {
    id: 'warm-film',
    name: 'Warm Film',
    category: 'aesthetic',
    desc: 'Film analog hangat: hitam terangkat, highlight kekuningan.',
    swatch: ['#7a4b2a', '#f5d08a'],
    cpu: cpu({
      matrix: [1.05, 0.02, -0.03, 0, 1, 0, -0.04, 0, 0.96],
      shadowTint: [0.015, 0, -0.01],
      highlightTint: [0.04, 0.025, -0.02],
      blackPoint: 0.04,
      whitePoint: 0.97,
    }),
    gpu: gpu({
      contrast: 0.06,
      saturation: 0.08,
      vibrance: 0.1,
      curves: {
        r: [[0, 0.03], [0.25, 0.27], [0.5, 0.52], [0.75, 0.78], [1, 0.99]],
        g: [[0, 0.02], [0.25, 0.25], [0.5, 0.5], [0.75, 0.76], [1, 0.98]],
        b: [[0, 0.02], [0.25, 0.22], [0.5, 0.46], [0.75, 0.72], [1, 0.93]],
      },
      vignette: { size: 0.6, amount: 0.25 },
    }),
    texture: { grain: 50, size: 1.8, dust: 30 },
  },
  {
    id: 'cool-pastel',
    name: 'Cool Pastel',
    category: 'aesthetic',
    desc: 'Ringan dan "airy": pastel kebiruan-kehijauan, kontras rendah.',
    swatch: ['#9fc7d6', '#e6f2ef'],
    cpu: cpu({
      matrix: [0.97, 0.01, 0.02, -0.02, 1.02, 0.02, 0, 0.03, 1.0],
      shadowTint: [-0.01, 0.015, 0.03],
      highlightTint: [-0.005, 0.01, 0.02],
      blackPoint: 0.06,
      whitePoint: 0.98,
    }),
    gpu: gpu({
      brightness: 0.07,
      contrast: -0.1,
      saturation: -0.08,
      vibrance: 0.15,
      curves: rgb([[0, 0.04], [0.25, 0.3], [0.5, 0.55], [0.75, 0.8], [1, 1]]),
    }),
    texture: { grain: 20, size: 1.2, dust: 0 },
  },
  {
    id: 'vintage-fade',
    name: 'Vintage Fade',
    category: 'aesthetic',
    desc: 'Cetakan lama yang memudar: sepia tipis, matte, vignette.',
    swatch: ['#6e5a45', '#e3cfa8'],
    cpu: cpu({
      matrix: [0.95, 0.05, 0, 0, 0.95, 0.05, 0, 0, 0.88],
      shadowTint: [0.03, 0.015, -0.01],
      highlightTint: [0.03, 0.02, -0.02],
      blackPoint: 0.08,
      whitePoint: 0.94,
    }),
    gpu: gpu({
      contrast: -0.08,
      saturation: -0.15,
      sepia: 0.25,
      curves: rgb([[0, 0.05], [0.25, 0.27], [0.5, 0.5], [0.75, 0.74], [1, 0.96]]),
      vignette: { size: 0.5, amount: 0.5 },
    }),
    texture: { grain: 55, size: 2.0, dust: 50 },
  },
  {
    id: 'instant-fade',
    name: 'Instant Fade',
    category: 'aesthetic',
    desc: 'Nuansa foto instan: kekuningan, bayangan kehijauan, memudar.',
    swatch: ['#4d6b55', '#f6e29a'],
    cpu: cpu({
      matrix: [1.02, 0, 0, 0, 1.0, 0, -0.02, 0.04, 0.9],
      shadowTint: [0, 0.02, 0.015],
      highlightTint: [0.04, 0.03, -0.03],
      blackPoint: 0.07,
      whitePoint: 0.96,
    }),
    gpu: gpu({
      brightness: 0.04,
      contrast: -0.05,
      saturation: 0.05,
      curves: rgb([[0, 0.04], [0.25, 0.26], [0.5, 0.5], [0.75, 0.76], [1, 0.97]]),
      vignette: { size: 0.45, amount: 0.45 },
    }),
    texture: { grain: 40, size: 2.0, dust: 35 },
  },
  {
    id: 'mono-matte',
    name: 'Mono Matte',
    category: 'aesthetic',
    desc: 'Hitam-putih matte dengan hitam terangkat; lembut dan artistik.',
    swatch: ['#2a2a2c', '#d8d6d0'],
    cpu: cpu({
      matrix: [0.33, 0.5, 0.17, 0.33, 0.5, 0.17, 0.33, 0.5, 0.17],
      shadowTint: [0.01, 0.005, 0],
      blackPoint: 0.09,
      whitePoint: 0.93,
    }),
    gpu: gpu({
      contrast: 0.05,
      curves: rgb([[0, 0], [0.25, 0.24], [0.5, 0.5], [0.75, 0.76], [1, 1]]),
      vignette: { size: 0.55, amount: 0.25 },
    }),
    texture: { grain: 50, size: 1.8, dust: 30 },
  },
];

export const DEFAULT_PRESET_ID = 'clean-pro';

export function getPreset(id) {
  return id === ORIGINAL.id ? ORIGINAL : PRESETS.find((p) => p.id === id) || ORIGINAL;
}

/** true bila tahap CPU tidak mengubah piksel sama sekali (worker dilewati). */
export function isNeutralCpu(c) {
  return (
    c.matrix.every((v, i) => v === IDENTITY[i]) &&
    c.offset.every((v) => v === 0) &&
    c.blackPoint === 0 &&
    c.whitePoint === 1 &&
    c.shadowTint.every((v) => v === 0) &&
    c.highlightTint.every((v) => v === 0)
  );
}
