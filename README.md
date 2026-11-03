# Aesthetic Lens

Editor foto berbasis browser: filter berlapis (Cinematic, Pro-Tone, Aesthetic), tekstur grain & dust,
slider intensitas 0–100%, kamera/unggah foto. Semua diproses lokal di perangkat.

## Menjalankan

Web Worker dan kamera tidak berfungsi dari `file://`. Jalankan lewat server lokal:

```bash
cd aesthetic-lens
python3 -m http.server 8080      # atau: npx serve .
# buka http://localhost:8080
```

Kamera (`getUserMedia`) hanya berjalan di `https://` atau `localhost`. Untuk menguji di ponsel,
gunakan tunnel HTTPS (mis. Cloudflare Tunnel atau ngrok) atau deploy ke hosting statis.
Tanpa izin kamera, tombol kamera jatuh kembali ke `<input capture>` bawaan perangkat.

## Struktur proyek

```
aesthetic-lens/
├── index.html          kerangka UI + kontainer kanvas
├── css/styles.css      tema gelap, mobile-first
├── js/
│   ├── app.js          UI, scene Fabric.js, pipeline glfx.js, klien Worker
│   ├── presets.js      data preset (satu-satunya tempat mengubah "look")
│   └── worker.js       Web Worker: grade, grain, dust
├── libs/               (opsional) salinan lokal fabric.min.js & glfx.js
├── PRESETS.md          tabel nilai preset (dibuat dari presets.js)
└── README.md
```

## Arsitektur

```
 UI thread                                    Web Worker
 ─────────                                    ──────────
 foto → canvas kerja (maks 2048 px)
   │  getImageData → buffer ──transfer──▶     grade: matriks warna, split-tone, fade
   │  ◀──────────────transfer── buffer
   ▼
 glfx.js (WebGL): curves, contrast, vibrance, vignette, sharpen
   ▼
 Fabric.js scene:  base ▸ graded (opacity = intensitas)
                        ▸ grain  (overlay)  ◀── Worker: noise Gaussian + upscale bilinear
                        ▸ dust   (normal)   ◀── Worker: bintik, serat, goresan
```

- **Slider real-time.** Intensitas, grain, dan dust hanyalah opacity layer Fabric, jadi tidak memicu
  pemrosesan ulang. Pemrosesan hanya terjadi saat preset berganti, ukuran grain berubah, atau foto baru dimuat.
- **UI tidak terblokir.** Buffer piksel dipindahkan ke Worker (zero-copy) dan hasil lama tetap tampil
  sampai hasil baru siap. Hasil usang dibuang lewat token per pekerjaan.
- **Degradasi halus.** Tanpa WebGL atau glfx.js, tahap CPU tetap berjalan. Tanpa Worker, aplikasi
  menampilkan pesan yang menjelaskan cara menjalankannya.

## Menambah atau mengubah preset

Edit `js/presets.js`: salin satu entri di `PRESETS`, ubah `id`, `name`, `category`, dan nilai
`cpu` / `gpu` / `texture`. Parameter dijelaskan di `PRESETS.md`. Tabel itu dibuat ulang dari
`presets.js` bila Anda mengubah nilai.

## Catatan teknis

- Foto dikecilkan ke sisi terpanjang 2048 px (`CONFIG.maxEdge`); hasil simpan memakai resolusi yang sama (JPEG 92%).
- Orientasi EXIF dihormati lewat `createImageBitmap(..., { imageOrientation: 'from-image' })`.
- Pencampuran intensitas terjadi di ruang sRGB (bukan linear), sehingga perilakunya seperti opacity layer di editor foto umumnya.
- Format HEIC hanya terbuka bila browser mendukungnya (umumnya Safari).
- Mode debug: tambahkan `?debug` pada URL untuk membuka objek `window.AL`.
