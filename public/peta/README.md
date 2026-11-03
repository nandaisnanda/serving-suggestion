# Peta Suara, Kemiskinan, dan Dapur MBG

#30DayMapChallenge 2026 · Hari 3 · Poligon. Peta oleh Ananda Gunawan.

Peta interaktif 38 provinsi: hasil Pilpres 2024, kemiskinan (Maret 2026), rata-rata lama sekolah, dan sebaran dapur MBG (SPPG, 8 Juni 2026).

## Sumber
- KPU, rekapitulasi resmi Pilpres 2024 (suara dalam negeri)
- BPS, Susenas Maret 2026 (kemiskinan)
- BPS, IPM (rata-rata lama sekolah)
- Badan Gizi Nasional, sebaran SPPG per 8 Juni 2026
- Batas wilayah: 38 Provinsi Indonesia (GeoJSON, properti `PROVINSI`)

## Jalankan lokal
```
python -m http.server
```
Buka http://localhost:8000/

## Deploy ke GitHub Pages
Settings → Pages → Deploy from branch `main` / root. Semua path relatif, jadi berjalan di `https://<user>.github.io/<repo>/`.

## Berkas
- `index.html`, `css/style.css`, `js/app.js`, `js/stats.js`
- `data/data_day3_provinsi.csv`, `data/provinsi_38.geojson`

Pustaka (CDN, versi tetap): Leaflet 1.9.4, Chart.js 4.4.1, PapaParse 5.4.1, html2canvas 1.4.1.
