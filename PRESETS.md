# Aesthetic Lens — Spesifikasi Preset

Dokumen ini dibuat otomatis dari `js/presets.js` sehingga selalu sama dengan kode.

## Cara kerja nilai preset

Setiap preset dijalankan dalam dua tahap berurutan, lalu dicampur dengan foto asli sesuai slider intensitas.

```
foto → [Tahap CPU · Web Worker] → [Tahap GPU · glfx.js] → layer "graded"
tampilan akhir = lerp(foto asli, graded, intensitas%) + grain (overlay) + dust (normal)
```

**Tahap CPU** (per piksel, skala 0–1, ruang sRGB):

1. `rgb' = M · rgb + offset` — M adalah matriks 3×3 (baris: R', G', B').
2. Split-toning: `rgb' += shadowTint · (1−L)² + highlightTint · L²`, dengan L = 0.2126R + 0.7152G + 0.0722B (+ `splitBalance`). Nilai tint adalah delta RGB.
3. Black/white point: `v = bp + v · (wp − bp)` — menaikkan hitam (efek matte/fade) dan menurunkan putih.

**Tahap GPU** (glfx.js), urutan eksekusi: denoise → curves → brightnessContrast → hueSaturation → vibrance → sepia → vignette → unsharpMask. Brightness, contrast, hue, saturation, dan vibrance bernilai −1…1. Kurva memakai titik kontrol (input, output) pada skala 0–1 dan diinterpolasi spline oleh glfx.

**Intensitas 0–100%** adalah opacity layer graded di atas foto asli, jadi tepat sama dengan interpolasi linier antara asli dan hasil filter. Tekstur memakai opacity layer sendiri.

## 1. Tahap CPU (Web Worker)

| Kategori | Preset | Matriks warna (baris R / G / B) | Shadow tint (ΔRGB) | Highlight tint (ΔRGB) | Black pt | White pt |
|---|---|---|---|---|---|---|
| Cinematic | **Teal & Orange** | [1.06 -0.03 -0.03 / -0.02 1 0.02 / -0.04 0.02 1.02] | [-0.035, 0.012, 0.045] | [0.045, 0.012, -0.04] | 0.02 | 0.985 |
| Cinematic | **Neo Noir** | [0.703 0.243 0.025 / 0.074 0.9 0.025 / 0.079 0.265 0.716] | [-0.02, 0, 0.04] | [0, 0.01, 0.025] | 0 | 0.98 |
| Cinematic | **Golden Hour** | [1.06 0.02 -0.04 / 0.01 1 -0.02 / -0.06 -0.02 0.94] | [0.02, 0.005, -0.01] | [0.05, 0.025, -0.03] | 0.015 | 0.99 |
| Cinematic | **Silver Screen** | [0.646 0.322 0.033 / 0.096 0.872 0.033 / 0.096 0.322 0.583] | — | [0, 0.005, 0.015] | 0 | 1 |
| Pro-Tone | **Clean Pro** | identitas | [-0.005, 0, 0.008] | [0.006, 0.003, 0] | 0.005 | 1 |
| Pro-Tone | **Portrait Glow** | [1.03 0 -0.02 / 0 1 0 / -0.02 0 0.97] | [0.01, 0, 0] | [0.02, 0.012, 0] | 0.01 | 1 |
| Pro-Tone | **Landscape Pop** | identitas | [-0.01, 0, 0.015] | [0.01, 0.005, 0] | 0 | 1 |
| Pro-Tone | **Studio B&W** | [0.4 0.45 0.15 / 0.4 0.45 0.15 / 0.4 0.45 0.15] | — | — | 0 | 1 |
| Aesthetic | **Warm Film** | [1.05 0.02 -0.03 / 0 1 0 / -0.04 0 0.96] | [0.015, 0, -0.01] | [0.04, 0.025, -0.02] | 0.04 | 0.97 |
| Aesthetic | **Cool Pastel** | [0.97 0.01 0.02 / -0.02 1.02 0.02 / 0 0.03 1] | [-0.01, 0.015, 0.03] | [-0.005, 0.01, 0.02] | 0.06 | 0.98 |
| Aesthetic | **Vintage Fade** | [0.95 0.05 0 / 0 0.95 0.05 / 0 0 0.88] | [0.03, 0.015, -0.01] | [0.03, 0.02, -0.02] | 0.08 | 0.94 |
| Aesthetic | **Instant Fade** | [1.02 0 0 / 0 1 0 / -0.02 0.04 0.9] | [0, 0.02, 0.015] | [0.04, 0.03, -0.03] | 0.07 | 0.96 |
| Aesthetic | **Mono Matte** | [0.33 0.5 0.17 / 0.33 0.5 0.17 / 0.33 0.5 0.17] | [0.01, 0.005, 0] | — | 0.09 | 0.93 |

## 2. Tahap GPU (glfx.js)

| Preset | Bright | Contrast | Hue | Sat | Vibrance | Sepia | Vignette (size, amount) | Unsharp (radius px, strength) | Denoise |
|---|---|---|---|---|---|---|---|---|---|
| **Teal & Orange** | 0 | 0.14 | 0 | 0.06 | 0.15 | 0 | 0.55, 0.35 | 1.6, 0.5 | — |
| **Neo Noir** | -0.05 | 0.28 | 0 | 0 | 0 | 0 | 0.45, 0.6 | 1.4, 0.7 | — |
| **Golden Hour** | 0.03 | 0.1 | 0 | 0.1 | 0.2 | 0 | 0.55, 0.3 | 1.6, 0.5 | — |
| **Silver Screen** | -0.02 | 0.35 | 0 | 0 | 0 | 0 | 0.5, 0.4 | 2, 0.9 | — |
| **Clean Pro** | 0.02 | 0.08 | 0 | 0.03 | 0.2 | 0 | — | 1.5, 0.8 | — |
| **Portrait Glow** | 0.05 | 0.04 | 0 | -0.04 | 0.1 | 0 | 0.6, 0.18 | 1.2, 0.35 | 22 |
| **Landscape Pop** | 0 | 0.2 | 0 | 0.12 | 0.45 | 0 | — | 3.5, 0.9 | — |
| **Studio B&W** | 0 | 0.22 | 0 | 0 | 0 | 0 | 0.5, 0.3 | 1.6, 0.9 | — |
| **Warm Film** | 0 | 0.06 | 0 | 0.08 | 0.1 | 0 | 0.6, 0.25 | — | — |
| **Cool Pastel** | 0.07 | -0.1 | 0 | -0.08 | 0.15 | 0 | — | — | — |
| **Vintage Fade** | 0 | -0.08 | 0 | -0.15 | 0 | 0.25 | 0.5, 0.5 | — | — |
| **Instant Fade** | 0.04 | -0.05 | 0 | 0.05 | 0 | 0 | 0.45, 0.45 | — | — |
| **Mono Matte** | 0 | 0.05 | 0 | 0 | 0 | 0 | 0.55, 0.25 | — | — |

> Denoise memakai eksponen glfx: makin besar, makin menjaga tepi (penghalusan lebih lemah).

## 3. Kurva tonal (titik kontrol input→output)

| Preset | Kanal | Titik kontrol |
|---|---|---|
| **Teal & Orange** | R | (0,0) (0.25,0.22) (0.5,0.52) (0.75,0.8) (1,1) |
|  | G | (0,0) (0.25,0.23) (0.5,0.5) (0.75,0.77) (1,1) |
|  | B | (0,0.02) (0.25,0.27) (0.5,0.49) (0.75,0.72) (1,0.96) |
| **Neo Noir** | RGB | (0,0) (0.2,0.13) (0.5,0.48) (0.8,0.87) (1,1) |
| **Golden Hour** | RGB | (0,0) (0.25,0.23) (0.5,0.52) (0.75,0.79) (1,1) |
| **Silver Screen** | RGB | (0,0) (0.25,0.17) (0.5,0.5) (0.75,0.84) (1,1) |
| **Clean Pro** | RGB | (0,0) (0.25,0.235) (0.5,0.5) (0.75,0.765) (1,1) |
| **Portrait Glow** | RGB | (0,0.01) (0.25,0.26) (0.5,0.53) (0.75,0.78) (1,1) |
| **Landscape Pop** | RGB | (0,0) (0.25,0.2) (0.5,0.5) (0.75,0.8) (1,1) |
| **Studio B&W** | RGB | (0,0) (0.25,0.21) (0.5,0.5) (0.75,0.79) (1,1) |
| **Warm Film** | R | (0,0.03) (0.25,0.27) (0.5,0.52) (0.75,0.78) (1,0.99) |
|  | G | (0,0.02) (0.25,0.25) (0.5,0.5) (0.75,0.76) (1,0.98) |
|  | B | (0,0.02) (0.25,0.22) (0.5,0.46) (0.75,0.72) (1,0.93) |
| **Cool Pastel** | RGB | (0,0.04) (0.25,0.3) (0.5,0.55) (0.75,0.8) (1,1) |
| **Vintage Fade** | RGB | (0,0.05) (0.25,0.27) (0.5,0.5) (0.75,0.74) (1,0.96) |
| **Instant Fade** | RGB | (0,0.04) (0.25,0.26) (0.5,0.5) (0.75,0.76) (1,0.97) |
| **Mono Matte** | RGB | (0,0) (0.25,0.24) (0.5,0.5) (0.75,0.76) (1,1) |

## 4. Rekomendasi tekstur

Diterapkan otomatis ke slider saat preset dipilih, selama pengguna belum menggeser slider tekstur secara manual. Grain 0–100% = opacity layer overlay; ukuran dalam piksel kerja; dust 0–100% = opacity layer.

| Preset | Grain | Ukuran grain | Dust |
|---|---|---|---|
| **Teal & Orange** | 30% | 1.5 px | 15% |
| **Neo Noir** | 45% | 1.8 px | 25% |
| **Golden Hour** | 25% | 1.4 px | 10% |
| **Silver Screen** | 40% | 1.6 px | 20% |
| **Clean Pro** | 0% | 1.5 px | 0% |
| **Portrait Glow** | 0% | 1.5 px | 0% |
| **Landscape Pop** | 0% | 1.5 px | 0% |
| **Studio B&W** | 35% | 1.6 px | 0% |
| **Warm Film** | 50% | 1.8 px | 30% |
| **Cool Pastel** | 20% | 1.2 px | 0% |
| **Vintage Fade** | 55% | 2 px | 50% |
| **Instant Fade** | 40% | 2 px | 35% |
| **Mono Matte** | 50% | 1.8 px | 30% |

## 5. Parameter tekstur di Worker

| Parameter | Nilai | Keterangan |
|---|---|---|
| Grain sigma | 0.17 | Simpangan baku noise (≈ 43 level dari 255) sebelum diskalakan opacity |
| Grain chroma | 0.12 | Porsi noise berwarna; sisanya noise luma |
| Grain blend | overlay | Abu-abu 128 netral, jadi tidak menggeser kecerahan |
| Dust | ≈150 bintik, 10 serat, 4 goresan per megapiksel | Diskalakan terhadap sisi terpanjang gambar |
| Seed | acak per sesi | Tombol "Acak pola tekstur" membuat seed baru |
