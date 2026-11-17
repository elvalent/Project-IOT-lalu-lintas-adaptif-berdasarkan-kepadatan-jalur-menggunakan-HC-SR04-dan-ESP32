# Pengatur Lalu Lintas Adaptif — ESP32, Wokwi, Dashboard, Node.js & SQLite

## Isi proyek
- `src/main.cpp`: program ESP32 untuk PlatformIO.
- `diagram.json`: rangkaian Wokwi.
- `wokwi-online/`: file untuk Wokwi web.
- `web/index.html`: dashboard monitoring dan kontrol.
- `server/server.js`: backend Node.js + API + penerima MQTT. Database memakai modul SQLite bawaan Node.js (`node:sqlite`), jadi tidak membutuhkan `better-sqlite3` atau Visual Studio C++ Build Tools.
- `server/data/lalin.db`: database SQLite otomatis dibuat saat server pertama dijalankan.

## Arsitektur
Dua sensor HC-SR04 mengukur jarak kendaraan pada Jalur A dan B. Jarak yang semakin kecil berarti antrean semakin padat. ESP32 menghitung persentase kepadatan, memprioritaskan jalur dengan antrean lebih padat, dan menentukan durasi hijau 5–20 detik. Selama fase hijau, estimasi antrean jalur tersebut berkurang 2 poin persentase per detik sebagai model pelayanan kendaraan; saat jalur merah, estimasi menyesuaikan pembacaan sensor secara bertahap. Pada penerapan nyata, penurunan antrean perlu dikalibrasi dengan posisi sensor dan pergerakan kendaraan. Data ESP32 dikirim melalui MQTT. Backend Node.js menerima data MQTT dan menyimpannya ke SQLite. Dashboard mengambil riwayat dari API backend.

Prefix MQTT yang digunakan pada firmware, dashboard, dan backend:
`lalin-adaptif-kiel-2026-7f3a`

Jangan gunakan prefix yang sama dengan kelompok lain. Jika mengganti prefix, samakan di:
- `src/main.cpp`
- `wokwi-online/sketch.ino`
- `web/index.html` (konstanta `P`)
- `server/server.js` (konstanta `PREFIX`)

## Cara menjalankan di Windows / VS Code

### 1. Jalankan backend dan database
1. Install Node.js 22.13 LTS atau lebih baru (versi 22.5–22.12 juga jalan, flag sqlite dipasang otomatis) dari https://nodejs.org/ jika belum tersedia.
2. Buka folder proyek `lalin-adaptif` di VS Code.
3. Buka terminal VS Code: **Terminal > New Terminal**.
4. Masuk ke folder backend:
   ```bash
   cd server
   ```
5. Install dependency:
   ```bash
   npm install
   ```
6. Jalankan server (database menggunakan SQLite bawaan Node.js, tanpa kompilasi native):
   ```bash
   npm start
   ```
7. Biarkan terminal tetap berjalan. Jika berhasil, terminal menampilkan `Dashboard aktif: http://localhost:3000`.
8. Buka browser ke http://localhost:3000. Jika halaman dibuka lewat Live Server/file://, dashboard otomatis mencari API di `http://localhost:3000`, tetapi server Node.js **tetap harus berjalan**.

Database SQLite dibuat otomatis di `server/data/lalin.db`. Tidak perlu membuat database atau tabel secara manual.

### 2. Jalankan simulasi Wokwi
1. Buka `diagram.json` dengan ekstensi Wokwi di VS Code, atau buat proyek ESP32 di https://wokwi.com/.
2. Untuk Wokwi web, salin isi `wokwi-online/sketch.ino`, `wokwi-online/diagram.json`, dan `wokwi-online/libraries.txt` ke proyek Wokwi.
3. Jalankan simulasi.
4. Klik masing-masing sensor HC-SR04 dan ubah nilai **Distance**. Nilai 180–200 cm menunjukkan jalur relatif lancar; nilai 20–40 cm menunjukkan antrean padat.
5. Pastikan ESP32 berhasil terhubung ke WiFi Wokwi dan broker MQTT publik.

### 3. Uji dashboard
1. Buka http://localhost:3000.
2. Tunggu status MQTT dan database tampil.
3. Saat ESP32 terhubung, dashboard menerima data sensor secara langsung dan backend menyimpan pembacaan ke SQLite.
4. Jika ESP32 belum terdeteksi, dashboard masuk ke mode demo dan slider kepadatan dapat digunakan. Data demo juga dikirim ke backend dan disimpan di SQLite.
5. Gunakan tombol Otomatis, Hijau A, Hijau B, dan Semua merah untuk menguji kontrol.
6. Tombol **Unduh CSV** mengunduh data pembacaan sensor dari database.

## Struktur data database
| Tabel | Isi |
|---|---|
| `sensor_readings` | Sumber data (ESP32/demo), kepadatan, jarak, fase, status sinyal, sisa waktu, mode, waktu pencatatan |
| `activity_logs` | Riwayat perubahan status dan aktivitas sistem |
| `command_logs` | Perintah kontrol, hasil/respons, waktu perintah |

API yang tersedia:
- `GET /api/health` — status backend, database, dan MQTT.
- `GET /api/history` — riwayat aktivitas, perintah, dan pembacaan sensor.
- `POST /api/telemetry` — menyimpan data simulasi demo.
- `POST /api/activity` — menyimpan aktivitas.
- `POST /api/command` — mencatat perintah kontrol.
- `GET /api/readings.csv` — mengunduh data sensor sebagai CSV.

## Skenario pengujian untuk video/laporan
| No. | Jarak A | Jarak B | Hasil yang diharapkan |
|---|---:|---:|---|
| 1 | 180 cm | 180 cm | Kedua jalur relatif lancar; hijau sekitar 6 detik |
| 2 | 40 cm | 180 cm | Jalur A padat; durasi hijau A lebih lama |
| 3 | 180 cm | 40 cm | Jalur B padat; durasi hijau B lebih lama |
| 4 | 20 cm | 20 cm | Kedua jalur padat; durasi hijau meningkat |

Tambahan: tekan Hijau A, Hijau B, Semua merah, lalu Otomatis. Tunjukkan perubahan LED dan indikator respons perintah.

## Catatan
- Durasi hijau simulasi: 5–20 detik; kuning 2 detik; jeda semua merah 1 detik.
- Status kepadatan dashboard: di bawah 35% = Lancar; 35–70% = Padat; di atas 70% = Macet.
- MQTT menggunakan broker publik untuk kebutuhan simulasi. Jangan mengirim data pribadi atau rahasia ke broker publik.
- Untuk menghentikan server tekan `Ctrl + C` di terminal. File database tetap tersimpan untuk dijalankan kembali.

## Troubleshooting "Database tidak terhubung"
| Gejala | Penyebab | Solusi |
|---|---|---|
| Badge Database merah "Tidak terhubung" | Server belum jalan / terminal ditutup | `cd server && npm start`, biarkan terminal terbuka |
| `Cannot find module 'express'` | `npm install` belum dijalankan | `cd server && npm install` |
| `node:sqlite` tidak ditemukan | Node.js lebih lama dari 22.5 | Install Node.js 22 LTS terbaru |
| `port 3000 sudah dipakai` | Server lama masih jalan | Tutup terminal lama, atau `set PORT=3001 && npm start` (Windows) |
| Badge menampilkan "server MQTT putus" | Jaringan memblokir broker.hivemq.com:1883 atau broker publik sedang tidak tersedia | Coba jaringan/hotspot lain. Dashboard mencoba HiveMQ lalu EMQX; firmware dan backend memakai HiveMQ TCP. Pastikan simulator Wokwi sedang berjalan dan WiFi Wokwi tersambung. |

Riwayat perbaikan v1.2: bug rekursi tak berujung `render()` ↔ `log()` di dashboard (membanjiri `activity_logs` dan menghentikan script sehingga `sensor_readings` tidak pernah terisi), CORS, bundle MQTT lokal, reconnect MQTT firmware non-blocking, perlindungan XSS pada riwayat.
