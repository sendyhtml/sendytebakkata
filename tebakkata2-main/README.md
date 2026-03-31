# TebakKata v2 — Multiplayer Word Guessing

Game tebak kata multiplayer real-time berbasis Firebase + WebRTC voice chat.

---

## Setup (Wajib dilakukan sebelum deploy)

### 1. Buat Firebase Project

1. Buka https://console.firebase.google.com
2. Klik **Add project**
3. Beri nama (contoh: `tebakkata-game`)

### 2. Aktifkan Layanan

**Authentication:**
- Sidebar > Authentication > Get started
- Sign-in method > aktifkan **Anonymous**

**Realtime Database:**
- Sidebar > Realtime Database > Create database
- Pilih region (Asia Southeast 1 untuk Indonesia)
- Start in **test mode**

### 3. Isi Firebase Config

Buka `js/firebase-config.js` dan ganti semua `YOUR_...` dengan nilai dari:
Firebase Console > Project Settings (ikon gear) > Your apps > Web app

```js
const firebaseConfig = {
  apiKey: "ISI_DISINI",
  authDomain: "PROJECT_ID.firebaseapp.com",
  databaseURL: "https://PROJECT_ID-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "PROJECT_ID",
  storageBucket: "PROJECT_ID.appspot.com",
  messagingSenderId: "SENDER_ID",
  appId: "APP_ID"
};
```

### 4. Security Rules (Optional, Recommended)

Di Firebase Console > Realtime Database > Rules, paste isi `firebase-rules.json`

### 5. Deploy ke Vercel

```
1. Upload semua file ke GitHub repo baru
2. Buka vercel.com > New Project > Import repo
3. Framework Preset: Other
4. Build Command: (kosongkan)
5. Output Directory: . (titik)
6. Deploy!
```

HTTPS otomatis dari Vercel — diperlukan untuk WebRTC mic.

---

## Cara Main

1. Buka URL game
2. Masukkan nama → **Buat Room** atau **Gabung Room**
3. Host bagikan **Kode Room** 6 karakter ke teman
4. Setelah semua bergabung, host klik **Mulai Game**
5. Ronde pertama: host pilih kata dari template atau ketik sendiri
6. Pemain lain mengetik tebakan di chat
7. Host klik **Iya / Tidak / Bisa Jadi** untuk setiap tebakan
8. Klik **Iya** saat tebakan tepat → skor bertambah → ronde berikutnya
9. Setelah semua ronde selesai → papan skor akhir

---

## Fitur

| Fitur | Keterangan |
|-------|-----------|
| Multiplayer real-time | Via Firebase Realtime Database |
| Voice Chat | WebRTC P2P mesh, tidak butuh server tambahan |
| Visualizer Mic | Bar animasi saat berbicara |
| Template Kata | 8 kategori, 300+ kata dari file JSON |
| Custom Sound | Upload MP3 sendiri untuk tombol Iya/Tidak/Bisa Jadi |
| Admin Dashboard | Kelola template, suara, setting game, monitor room |
| Bubble Chat | Chat bergaya dengan animasi per pesan |
| Sistem Poin | Konfigurasi poin per jawaban benar |
| Mode Spectator | Penonton bisa bergabung saat game berlangsung |

---

## Struktur File

```
tebakkata/
├── index.html                    Halaman game utama
├── admin.html                    Dashboard admin
├── css/
│   ├── style.css                 Style utama
│   └── admin.css                 Style admin
├── js/
│   ├── firebase-config.js        ← WAJIB DIISI
│   ├── categories.js             Loader kategori kata
│   ├── sounds.js                 Manager suara tombol
│   ├── voice.js                  WebRTC voice chat
│   ├── game.js                   Logic game + Firebase
│   ├── app.js                    Controller halaman utama
│   └── admin.js                  Controller admin
├── data/
│   └── categories/
│       ├── index.json            Daftar kategori
│       ├── hewan.json
│       ├── buah.json
│       ├── profesi.json
│       ├── benda.json
│       ├── tempat.json
│       ├── makanan.json
│       ├── olahraga.json
│       └── negara.json
├── icons/
│   └── favicon.svg
└── firebase-rules.json
```

---

## Tambah Kategori Baru

Buat file baru di `data/categories/namafile.json`:

```json
{
  "name": "Nama Kategori",
  "icon": "",
  "words": ["Kata1", "Kata2", "Kata3"]
}
```

Tambahkan `"namafile"` ke array di `data/categories/index.json`.

Atau langsung dari **Admin Dashboard > Template Kata**.

---

## Catatan Penting

- **HTTPS wajib** untuk WebRTC mic (Vercel otomatis HTTPS)
- Suara custom disimpan di `localStorage` browser masing-masing user
- Template kata dari Admin Dashboard disimpan ke Firebase dan berlaku global
- Jika deploy di GitHub Pages, pastikan aktifkan HTTPS
