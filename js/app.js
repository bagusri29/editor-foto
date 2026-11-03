/* =====================================================================
 * app.js — Aesthetic Lens
 *
 * Arsitektur render (urutan per perubahan filter):
 *
 *   foto → [Web Worker: grade]  matriks warna, split-toning, fade
 *        → [glfx.js / WebGL]    kurva, kontras, vibrance, vignette, sharpen
 *        → canvas "graded"
 *
 *   Scene Fabric.js (lapisan, dari bawah ke atas):
 *     1. base    foto asli
 *     2. graded  hasil filter       opacity = slider intensitas (0–100%)
 *     3. grain   noise dari Worker  blend "overlay", opacity = slider grain
 *     4. dust    debu dari Worker   blend normal,    opacity = slider dust
 *
 *   Karena intensitas & opasitas tekstur hanyalah opacity layer Fabric,
 *   menggeser slider TIDAK memicu pemrosesan ulang → selalu real-time.
 * ===================================================================== */
import { PRESETS, CATEGORIES, ORIGINAL, DEFAULT_PRESET_ID, getPreset, isNeutralCpu } from './presets.js';

/* ───────────── konfigurasi ───────────── */

const CONFIG = {
  maxEdge: 2048,            // sisi terpanjang kerja/ekspor (px)
  exportQuality: 0.92,
  defaultIntensity: 85,
  grainSigma: 0.17,         // amplitudo noise (fraksi 0–1 dari 255)
  grainChroma: 0.12,        // porsi noise berwarna
  workerUrl: new URL('./worker.js', import.meta.url).href,
  /* Urutan percobaan: salinan lokal dulu (opsional), lalu CDN. */
  libs: {
    fabric: {
      global: 'fabric',
      urls: [
        new URL('../libs/fabric.min.js', import.meta.url).href,
        'https://cdn.jsdelivr.net/npm/fabric@5.3.0/dist/fabric.min.js',
        'https://cdnjs.cloudflare.com/ajax/libs/fabric.js/5.3.0/fabric.min.js',
      ],
    },
    glfx: {
      global: 'fx',
      urls: [
        new URL('../libs/glfx.js', import.meta.url).href,
        'https://cdn.jsdelivr.net/gh/evanw/glfx.js@master/glfx.js',
        'https://evanw.github.io/glfx.js/glfx.js',
      ],
    },
  },
};

/* ───────────── util ───────────── */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const debounce = (fn, ms) => {
  let t;
  return (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
};
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));

const ui = {
  app: $('#app'),
  stage: $('#stage'),
  stageInner: $('#stageInner'),
  busy: $('#busy'),
  busyText: $('#busyText'),
  toast: $('#toast'),
  fileInput: $('#fileInput'),
  cameraInput: $('#cameraInput'),
  btnUpload: $$('[data-action="upload"]'),
  btnCamera: $$('[data-action="camera"]'),
  btnExport: $('#btnExport'),
  btnCompare: $('#btnCompare'),
  btnReset: $$('[data-action="reset"]'),
  tabs: $$('#tabs [role="tab"]'),
  panels: $$('.tabpanel'),
  catTabs: $('#catTabs'),
  chips: $('#chips'),
  presetDesc: $('#presetDesc'),
  rngIntensity: $('#rngIntensity'),
  outIntensity: $('#outIntensity'),
  rngGrain: $('#rngGrain'),
  outGrain: $('#outGrain'),
  rngGrainSize: $('#rngGrainSize'),
  outGrainSize: $('#outGrainSize'),
  rngDust: $('#rngDust'),
  outDust: $('#outDust'),
  btnShuffle: $('#btnShuffle'),
  cam: {
    dialog: $('#cameraDialog'),
    video: $('#camVideo'),
    close: $('#camClose'),
    shutter: $('#camShutter'),
    flip: $('#camFlip'),
  },
};

/* ───────────── state ───────────── */

const state = {
  fabric: null,             // fabric.Canvas
  glfx: null,               // canvas WebGL milik glfx.js (null bila tak tersedia)
  worker: null,             // WorkerClient
  W: 0,
  H: 0,
  layers: null,             // canvas 2D per layer (lihat loadSource)
  objs: null,               // objek Fabric per layer

  category: 'protone',
  presetId: DEFAULT_PRESET_ID,
  intensity: CONFIG.defaultIntensity,
  grainAmount: 0,
  grainSize: 1.5,
  dustAmount: 0,
  seed: 1,
  texturesTouched: false,   // true setelah pengguna menggeser slider tekstur
  grainStale: true,
  dustStale: true,
  comparing: false,
  tokens: { look: 0, grain: 0, dust: 0 }, // membatalkan hasil async yang usang
  stream: null,
  facing: 'environment',
};

/* ───────────── UI helpers ───────────── */

let toastTimer;
function toast(msg, ms = 3600) {
  ui.toast.textContent = msg;
  ui.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ui.toast.classList.remove('show'), ms);
}

let busyCount = 0;
let busyTimer;
/** Tampilkan overlay "memproses" (muncul setelah 150 ms agar tidak berkedip). */
function beginBusy(text) {
  busyCount++;
  ui.busyText.textContent = text;
  clearTimeout(busyTimer);
  busyTimer = setTimeout(() => {
    if (busyCount > 0) ui.busy.hidden = false;
  }, 150);
  let done = false;
  return () => {
    if (done) return;
    done = true;
    busyCount = Math.max(0, busyCount - 1);
    if (busyCount === 0) {
      clearTimeout(busyTimer);
      ui.busy.hidden = true;
    }
  };
}

function paintRange(input) {
  const min = +input.min;
  const max = +input.max;
  input.style.setProperty('--fill', ((+input.value - min) / (max - min)) * 100 + '%');
}
function setRange(input, out, value, fmt) {
  input.value = value;
  paintRange(input);
  out.textContent = fmt(+value);
}

/* ───────────── pemuat library ───────────── */

function loadScript(url, timeout = 10000) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    const timer = setTimeout(() => {
      s.remove();
      reject(new Error('timeout'));
    }, timeout);
    s.src = url;
    s.async = true;
    s.onload = () => {
      clearTimeout(timer);
      resolve();
    };
    s.onerror = () => {
      clearTimeout(timer);
      s.remove();
      reject(new Error('gagal memuat'));
    };
    document.head.appendChild(s);
  });
}

async function loadLib(name) {
  const lib = CONFIG.libs[name];
  if (window[lib.global]) return true;
  for (const url of lib.urls) {
    try {
      await loadScript(url);
      if (window[lib.global]) return true;
    } catch (_) {
      /* coba sumber berikutnya */
    }
  }
  return false;
}

/* ───────────── klien Web Worker ───────────── */

class WorkerClient {
  constructor(url) {
    this.seq = 0;
    this.pending = new Map();
    this.worker = new Worker(url);
    this.worker.onmessage = (e) => {
      const { id, ok, result, error } = e.data;
      const p = this.pending.get(id);
      if (!p) return;
      this.pending.delete(id);
      ok ? p.resolve(result) : p.reject(new Error(error));
    };
    this.worker.onerror = (e) => {
      const err = new Error(e.message || 'Worker error');
      this.pending.forEach((p) => p.reject(err));
      this.pending.clear();
    };
  }
  /** Kirim task; `transfer` = daftar ArrayBuffer yang dipindahkan (zero-copy). */
  request(task, payload, transfer = []) {
    return new Promise((resolve, reject) => {
      const id = ++this.seq;
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ id, task, payload }, transfer);
    });
  }
}

/* ───────────── UI preset ───────────── */

function buildCategoryTabs() {
  ui.catTabs.replaceChildren(
    ...CATEGORIES.map((c) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = c.label;
      b.dataset.cat = c.id;
      b.setAttribute('aria-pressed', String(c.id === state.category));
      b.addEventListener('click', () => {
        state.category = c.id;
        buildCategoryTabs();
        buildChips();
      });
      return b;
    })
  );
}

function buildChips() {
  const list = [ORIGINAL, ...PRESETS.filter((p) => p.category === state.category)];
  ui.chips.replaceChildren(
    ...list.map((p) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip';
      b.dataset.id = p.id;
      b.setAttribute('aria-pressed', String(p.id === state.presetId));
      const sw = document.createElement('span');
      sw.className = 'chip-swatch';
      sw.style.background = `linear-gradient(135deg, ${p.swatch[0]}, ${p.swatch[1]})`;
      const label = document.createElement('span');
      label.className = 'chip-label';
      label.textContent = p.name;
      b.append(sw, label);
      b.addEventListener('click', () => selectPreset(p.id));
      return b;
    })
  );
  ui.presetDesc.textContent = getPreset(state.presetId).desc;
}

function updateChipSelection() {
  $$('.chip', ui.chips).forEach((c) => c.setAttribute('aria-pressed', String(c.dataset.id === state.presetId)));
  ui.presetDesc.textContent = getPreset(state.presetId).desc;
}

/** Terapkan rekomendasi tekstur preset ke slider (hanya jika belum diubah manual). */
function applySuggestedTextures(preset) {
  const t = preset.texture || ORIGINAL.texture;
  if (t.size !== state.grainSize) state.grainStale = true;
  state.grainAmount = t.grain;
  state.grainSize = t.size;
  state.dustAmount = t.dust;
  syncTextureSliders();
}

function syncTextureSliders() {
  setRange(ui.rngGrain, ui.outGrain, state.grainAmount, (v) => v + '%');
  setRange(ui.rngGrainSize, ui.outGrainSize, state.grainSize * 10, (v) => (v / 10).toFixed(1) + ' px');
  setRange(ui.rngDust, ui.outDust, state.dustAmount, (v) => v + '%');
}

/* ───────────── scene Fabric.js ───────────── */

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

/** Perbarui visibilitas & opasitas semua layer dari state (satu-satunya tempat). */
function refreshLayers() {
  const o = state.objs;
  if (!o) return;
  const L = state.layers;
  const fx = !state.comparing;
  o.graded.set({
    visible: fx && state.presetId !== 'original' && L.hasGraded,
    opacity: state.intensity / 100,
  });
  o.grain.set({ visible: fx && state.grainAmount > 0 && L.hasGrain, opacity: state.grainAmount / 100 });
  o.dust.set({ visible: fx && state.dustAmount > 0 && L.hasDust, opacity: state.dustAmount / 100 });
  state.fabric.requestRenderAll();
}

function fitStage() {
  if (!state.fabric || !state.W) return;
  const r = ui.stageInner.getBoundingClientRect();
  const s = Math.min(r.width / state.W, r.height / state.H);
  if (!(s > 0)) return;
  const w = Math.floor(state.W * s) + 'px';
  const h = Math.floor(state.H * s) + 'px';
  // Ukuran tampilan (CSS) saja; resolusi logis kanvas tetap W×H untuk ekspor.
  state.fabric.setDimensions({ width: w, height: h }, { cssOnly: true });
  // Sabuk pengaman: pastikan elemen DOM Fabric ikut terukur di semua versi.
  [state.fabric.wrapperEl, state.fabric.lowerCanvasEl, state.fabric.upperCanvasEl].forEach((el) => {
    if (el) {
      el.style.width = w;
      el.style.height = h;
    }
  });
}

/**
 * Muat foto baru: skala ke maxEdge, siapkan canvas per layer, bangun scene.
 * `source` boleh ImageBitmap / HTMLImageElement / HTMLCanvasElement.
 */
async function loadSource(source) {
  const sw = source.naturalWidth || source.videoWidth || source.width;
  const sh = source.naturalHeight || source.videoHeight || source.height;
  if (!sw || !sh) throw new Error('Gambar tidak valid');
  const scale = Math.min(1, CONFIG.maxEdge / Math.max(sw, sh));
  const W = Math.max(1, Math.round(sw * scale));
  const H = Math.max(1, Math.round(sh * scale));

  const L = {
    src: makeCanvas(W, H),
    cpu: makeCanvas(W, H),
    graded: makeCanvas(W, H),
    grain: makeCanvas(W, H),
    dust: makeCanvas(W, H),
    hasGraded: false,
    hasGrain: false,
    hasDust: false,
  };
  L.srcCtx = L.src.getContext('2d', { willReadFrequently: true });
  L.srcCtx.imageSmoothingQuality = 'high';
  L.srcCtx.drawImage(source, 0, 0, W, H);
  if (typeof source.close === 'function') source.close();
  L.cpuCtx = L.cpu.getContext('2d');
  L.gradedCtx = L.graded.getContext('2d');
  L.grainCtx = L.grain.getContext('2d');
  L.dustCtx = L.dust.getContext('2d');

  // batalkan semua pekerjaan async milik foto sebelumnya
  state.tokens.look++;
  state.tokens.grain++;
  state.tokens.dust++;
  state.layers = L;
  state.W = W;
  state.H = H;
  state.grainStale = true;
  state.dustStale = true;
  state.comparing = false;

  const fc = state.fabric;
  fc.clear();
  fc.setDimensions({ width: W, height: H }); // resolusi logis = resolusi ekspor
  const mk = (el, extra) =>
    new fabric.Image(el, {
      left: 0,
      top: 0,
      originX: 'left',
      originY: 'top',
      selectable: false,
      evented: false,
      hasControls: false,
      hasBorders: false,
      objectCaching: false,
      ...extra,
    });
  state.objs = {
    base: mk(L.src),
    graded: mk(L.graded, { visible: false }),
    grain: mk(L.grain, { visible: false, globalCompositeOperation: 'overlay' }),
    dust: mk(L.dust, { visible: false }),
  };
  fc.add(state.objs.base, state.objs.graded, state.objs.grain, state.objs.dust);

  ui.app.dataset.state = 'ready';
  [ui.btnExport, ui.btnCompare, ...ui.btnReset].forEach((b) => (b.disabled = false));
  fitStage();

  if (!state.texturesTouched) applySuggestedTextures(getPreset(state.presetId));
  refreshLayers();
  await Promise.all([renderLook(), syncTextures()]);
}

/* ───────────── pipeline filter: Worker (CPU) → glfx.js (GPU) ───────────── */

function runGpuStage(input, g, outCtx) {
  const gl = state.glfx;
  outCtx.clearRect(0, 0, state.W, state.H);
  if (!gl) {
    outCtx.drawImage(input, 0, 0); // tanpa WebGL: hanya tahap CPU
    return;
  }
  const tex = gl.texture(input);
  try {
    gl.draw(tex);
    if (g.denoise != null) gl.denoise(g.denoise);
    if (g.curves) gl.curves(g.curves.r, g.curves.g, g.curves.b);
    if (g.brightness || g.contrast) gl.brightnessContrast(g.brightness, g.contrast);
    if (g.hue || g.saturation) gl.hueSaturation(g.hue, g.saturation);
    if (g.vibrance) gl.vibrance(g.vibrance);
    if (g.sepia) gl.sepia(g.sepia);
    if (g.vignette) gl.vignette(g.vignette.size, g.vignette.amount);
    if (g.sharpen) gl.unsharpMask(g.sharpen.radius, g.sharpen.strength);
    gl.update();
    outCtx.drawImage(gl, 0, 0); // salin segera, sebelum buffer WebGL berganti
  } finally {
    tex.destroy();
  }
}

async function renderLook() {
  const L = state.layers;
  if (!L) return;
  const preset = getPreset(state.presetId);
  const token = ++state.tokens.look;
  if (preset.id === 'original') {
    refreshLayers();
    return;
  }

  const end = beginBusy('Menerapkan filter…');
  try {
    let input = L.src;
    if (!isNeutralCpu(preset.cpu)) {
      if (!state.worker) throw new Error('Web Worker tidak tersedia');
      // getImageData menghasilkan salinan → aman dipindahkan ke worker
      const img = L.srcCtx.getImageData(0, 0, state.W, state.H);
      const res = await state.worker.request(
        'grade',
        { buffer: img.data.buffer, width: state.W, height: state.H, params: preset.cpu },
        [img.data.buffer]
      );
      if (token !== state.tokens.look) return;
      L.cpuCtx.putImageData(new ImageData(new Uint8ClampedArray(res.buffer), state.W, state.H), 0, 0);
      input = L.cpu;
    }
    await nextFrame(); // biarkan overlay "memproses" tampil sebelum blok GPU
    if (token !== state.tokens.look) return;
    runGpuStage(input, preset.gpu, L.gradedCtx);
    L.hasGraded = true;
    refreshLayers();
  } catch (err) {
    console.error(err);
    toast('Gagal menerapkan filter: ' + err.message);
  } finally {
    end();
  }
}

/* ───────────── tekstur: Grain & Dust (Web Worker) ───────────── */

async function buildTexture(kind) {
  const L = state.layers;
  if (!L || !state.worker) return;
  const token = ++state.tokens[kind];
  state[kind + 'Stale'] = false;
  const end = beginBusy(kind === 'grain' ? 'Membuat grain…' : 'Membuat dust…');
  try {
    const payload =
      kind === 'grain'
        ? { width: state.W, height: state.H, size: state.grainSize, sigma: CONFIG.grainSigma, chroma: CONFIG.grainChroma, seed: state.seed }
        : { width: state.W, height: state.H, seed: state.seed + 7919 };
    const res = await state.worker.request(kind, payload);
    if (token !== state.tokens[kind] || L !== state.layers) return;
    const ctx = kind === 'grain' ? L.grainCtx : L.dustCtx;
    ctx.putImageData(new ImageData(new Uint8ClampedArray(res.buffer), state.W, state.H), 0, 0);
    L[kind === 'grain' ? 'hasGrain' : 'hasDust'] = true;
    refreshLayers();
  } catch (err) {
    console.error(err);
    state[kind + 'Stale'] = true;
    toast('Gagal membuat tekstur: ' + err.message);
  } finally {
    end();
  }
}

/** Buat ulang tekstur yang usang — hanya bila amount > 0 (lazy). */
async function syncTextures() {
  if (!state.layers) return;
  refreshLayers();
  const jobs = [];
  if (state.grainAmount > 0 && state.grainStale) jobs.push(buildTexture('grain'));
  if (state.dustAmount > 0 && state.dustStale) jobs.push(buildTexture('dust'));
  await Promise.all(jobs);
}

/* ───────────── aksi pengguna ───────────── */

function selectPreset(id) {
  state.presetId = id;
  updateChipSelection();
  if (!state.texturesTouched) applySuggestedTextures(getPreset(id));
  if (!state.layers) return; // filter diterapkan saat foto dimuat
  renderLook();
  syncTextures();
}

function setCompare(on) {
  if (!state.objs || state.comparing === on) return;
  state.comparing = on;
  ui.btnCompare.classList.toggle('is-active', on);
  refreshLayers();
}

function resetAll() {
  state.texturesTouched = false;
  state.presetId = DEFAULT_PRESET_ID;
  state.category = getPreset(DEFAULT_PRESET_ID).category;
  state.intensity = CONFIG.defaultIntensity;
  setRange(ui.rngIntensity, ui.outIntensity, state.intensity, (v) => v + '%');
  buildCategoryTabs();
  buildChips();
  applySuggestedTextures(getPreset(state.presetId));
  renderLook();
  syncTextures();
}

async function exportImage() {
  if (!state.layers) return;
  const wasComparing = state.comparing;
  setCompare(false);
  const end = beginBusy('Menyiapkan file…');
  try {
    state.fabric.renderAll(); // render sinkron pada resolusi logis penuh
    const blob = await new Promise((res) => state.fabric.lowerCanvasEl.toBlob(res, 'image/jpeg', CONFIG.exportQuality));
    if (!blob) throw new Error('Canvas terlalu besar untuk diekspor di perangkat ini');
    const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
    const file = new File([blob], `aesthetic-lens-${stamp}.jpg`, { type: 'image/jpeg' });

    const coarse = matchMedia('(pointer: coarse)').matches;
    if (coarse && navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: 'Aesthetic Lens' });
        return;
      } catch (e) {
        if (e.name === 'AbortError') return; // pengguna menutup sheet berbagi
      }
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(file);
    a.download = file.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    toast('Foto disimpan');
  } catch (err) {
    console.error(err);
    toast('Gagal menyimpan: ' + err.message);
  } finally {
    end();
    setCompare(wasComparing);
  }
}

/* ───────────── input foto: unggah, drop, kamera ───────────── */

async function fileToSource(file) {
  if ('createImageBitmap' in window) {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' }); // hormati EXIF
    } catch (_) {
      /* jatuh ke <img> */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }
}

async function handleFile(file) {
  if (!file) return;
  if (!file.type.startsWith('image/')) return toast('Berkas harus berupa gambar');
  const end = beginBusy('Membuka foto…');
  try {
    await loadSource(await fileToSource(file));
  } catch (err) {
    console.error(err);
    toast('Foto tidak dapat dibuka (format mungkin tidak didukung browser ini)');
  } finally {
    end();
  }
}

async function startStream() {
  stopStream();
  state.stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: { ideal: state.facing }, width: { ideal: 2560 }, height: { ideal: 1440 } },
    audio: false,
  });
  ui.cam.video.srcObject = state.stream;
  ui.cam.video.classList.toggle('mirror', state.facing === 'user');
  await ui.cam.video.play();
}
function stopStream() {
  if (state.stream) state.stream.getTracks().forEach((t) => t.stop());
  state.stream = null;
  ui.cam.video.srcObject = null;
}

async function openCamera() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    ui.cameraInput.click(); // fallback: kamera bawaan lewat <input capture>
    return;
  }
  try {
    ui.cam.dialog.showModal();
    await startStream();
  } catch (err) {
    ui.cam.dialog.close();
    stopStream();
    toast(err.name === 'NotAllowedError' ? 'Izin kamera ditolak' : 'Kamera tidak dapat dibuka');
  }
}

async function capturePhoto() {
  const v = ui.cam.video;
  if (!v.videoWidth) return;
  const c = makeCanvas(v.videoWidth, v.videoHeight);
  c.getContext('2d').drawImage(v, 0, 0);
  ui.cam.dialog.close();
  await loadSource(c);
}

/* ───────────── event binding ───────────── */

function bindEvents() {
  ui.btnUpload.forEach((b) => b.addEventListener('click', () => ui.fileInput.click()));
  ui.btnCamera.forEach((b) => b.addEventListener('click', openCamera));
  [ui.fileInput, ui.cameraInput].forEach((inp) =>
    inp.addEventListener('change', () => {
      const f = inp.files && inp.files[0];
      inp.value = '';
      handleFile(f);
    })
  );

  // drag & drop
  ['dragenter', 'dragover'].forEach((t) =>
    ui.stage.addEventListener(t, (e) => {
      e.preventDefault();
      ui.stage.classList.add('drop');
    })
  );
  ['dragleave', 'drop'].forEach((t) =>
    ui.stage.addEventListener(t, (e) => {
      e.preventDefault();
      ui.stage.classList.remove('drop');
    })
  );
  ui.stage.addEventListener('drop', (e) => handleFile(e.dataTransfer.files[0]));

  // tab panel
  ui.tabs.forEach((t) =>
    t.addEventListener('click', () => {
      ui.tabs.forEach((x) => x.setAttribute('aria-selected', String(x === t)));
      ui.panels.forEach((p) => (p.hidden = p.dataset.panel !== t.dataset.tab));
    })
  );

  // slider intensitas — real-time, hanya mengubah opacity layer
  ui.rngIntensity.addEventListener('input', () => {
    state.intensity = +ui.rngIntensity.value;
    paintRange(ui.rngIntensity);
    ui.outIntensity.textContent = state.intensity + '%';
    refreshLayers();
  });

  // slider tekstur
  ui.rngGrain.addEventListener('input', () => {
    state.texturesTouched = true;
    state.grainAmount = +ui.rngGrain.value;
    paintRange(ui.rngGrain);
    ui.outGrain.textContent = state.grainAmount + '%';
    refreshLayers();
    syncTextures();
  });
  const regrain = debounce(() => {
    state.grainStale = true;
    syncTextures();
  }, 220);
  ui.rngGrainSize.addEventListener('input', () => {
    state.texturesTouched = true;
    state.grainSize = +ui.rngGrainSize.value / 10;
    paintRange(ui.rngGrainSize);
    ui.outGrainSize.textContent = state.grainSize.toFixed(1) + ' px';
    regrain();
  });
  ui.rngDust.addEventListener('input', () => {
    state.texturesTouched = true;
    state.dustAmount = +ui.rngDust.value;
    paintRange(ui.rngDust);
    ui.outDust.textContent = state.dustAmount + '%';
    refreshLayers();
    syncTextures();
  });
  ui.btnShuffle.addEventListener('click', () => {
    state.seed = (Math.random() * 2 ** 31) | 0;
    state.grainStale = state.dustStale = true;
    syncTextures();
  });

  // bandingkan: tahan untuk melihat foto asli
  const hold = (el) => {
    el.addEventListener('pointerdown', (e) => {
      if (!state.layers) return;
      try {
        el.setPointerCapture(e.pointerId); // agar pointerup tetap diterima di luar elemen
      } catch (_) {
        /* pointer tidak aktif: abaikan */
      }
      setCompare(true);
    });
    ['pointerup', 'pointercancel', 'lostpointercapture'].forEach((t) => el.addEventListener(t, () => setCompare(false)));
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  };
  hold(ui.btnCompare);
  hold(ui.stageInner);

  ui.btnExport.addEventListener('click', exportImage);
  ui.btnReset.forEach((b) => b.addEventListener('click', resetAll));

  // kamera
  ui.cam.shutter.addEventListener('click', capturePhoto);
  ui.cam.close.addEventListener('click', () => ui.cam.dialog.close());
  ui.cam.dialog.addEventListener('close', stopStream);
  ui.cam.flip.addEventListener('click', async () => {
    state.facing = state.facing === 'user' ? 'environment' : 'user';
    try {
      await startStream();
    } catch (_) {
      toast('Tidak bisa berganti kamera');
    }
  });

  new ResizeObserver(fitStage).observe(ui.stageInner);
}

/* ───────────── boot ───────────── */

async function boot() {
  state.category = getPreset(DEFAULT_PRESET_ID).category;
  buildCategoryTabs();
  buildChips();
  applySuggestedTextures(getPreset(DEFAULT_PRESET_ID));
  setRange(ui.rngIntensity, ui.outIntensity, state.intensity, (v) => v + '%');
  bindEvents();

  // Worker dibuat paralel dengan pemuatan library
  try {
    state.worker = new WorkerClient(CONFIG.workerUrl);
  } catch (err) {
    console.error(err);
    toast('Web Worker gagal dibuat. Jalankan lewat server lokal (bukan file://).', 8000);
  }

  const [fabricOk, glfxOk] = await Promise.all([loadLib('fabric'), loadLib('glfx')]);

  if (!fabricOk) {
    ui.app.dataset.state = 'error';
    $('#errorText').textContent =
      'Fabric.js gagal dimuat. Periksa koneksi internet atau letakkan fabric.min.js di folder libs/.';
    return;
  }
  state.fabric = new fabric.Canvas('stageCanvas', {
    width: 1,
    height: 1,
    selection: false,
    renderOnAddRemove: false,
    enableRetinaScaling: false, // resolusi logis = resolusi ekspor
    preserveObjectStacking: true,
  });

  if (glfxOk) {
    try {
      state.glfx = fx.canvas();
    } catch (_) {
      toast('WebGL tidak tersedia — hanya tahap CPU yang dipakai.', 6000);
    }
  } else {
    toast('glfx.js gagal dimuat — filter GPU dinonaktifkan.', 6000);
  }

  ui.btnUpload.concat(ui.btnCamera).forEach((b) => (b.disabled = false));

  if (new URLSearchParams(location.search).has('debug')) {
    window.AL = { state, loadSource, selectPreset, syncTextures, refreshLayers, ui };
  }
  document.dispatchEvent(new CustomEvent('al:ready'));
}

boot();
