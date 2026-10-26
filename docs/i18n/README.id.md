# LIM

**Less is more.** Plugin Claude Code yang kecil. Setiap plugin mengerjakan satu tugas dan menunjukkan hasil pengukuran di baliknya.

[![CI](https://github.com/lee-eojin/lim/actions/workflows/ci.yml/badge.svg)](https://github.com/lee-eojin/lim/actions/workflows/ci.yml)
[![review-loop](https://img.shields.io/github/v/tag/lee-eojin/lim?filter=review-loop--*&sort=semver&label=review-loop)](../../plugins/review-loop/CHANGELOG.md)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](../../LICENSE)

Ini adalah terjemahan dari [README bahasa Inggris](../../README.md) per 2026-10-24. Jika keduanya berbeda, README bahasa Inggris yang benar.

[English](../../README.md) | [한국어](README.ko.md) | [日本語](README.ja.md) | [简体中文](README.zh-CN.md) | [繁體中文](README.zh-TW.md) | [Español](README.es.md) | [Português (Brasil)](README.pt-BR.md) | [Français](README.fr.md) | [Deutsch](README.de.md) | [Русский](README.ru.md) | [Tiếng Việt](README.vi.md) | Bahasa Indonesia

Coding agent menulis kode dengan cepat. Namun, mereka jauh lebih buruk dalam menyadari kesalahan mereka sendiri. Agent yang menulis sebuah perubahan adalah reviewer terlemah untuk perubahan itu, karena agent tersebut membacanya melalui penalarannya sendiri dan setuju dengan dirinya sendiri. Akibatnya, pekerjaan di-commit tanpa review, atau dengan review dari konteks yang sama yang menulisnya.

**LIM adalah jawaban saya: plugin kecil yang masing-masing mengerjakan satu tugas, disertai angka yang mendukungnya.** Plugin pertama adalah review-loop.

**review-loop membuat "siap di-commit" berarti sudah di-review.** Test, pemeriksaan tipe, dan lint milikmu berjalan lebih dulu. Lalu sebuah reviewer dengan konteks baru, yang tidak pernah melihat penalaran Claude, memberi label P1 sampai P5 pada temuan dan harus menunjukkan bukti untuk temuan yang serius. Claude memperbaiki P1 dan P2, reviewer baru memeriksa perbaikannya, dan sebuah script, bukan model, yang memutuskan kapan berhenti. Kamu memutuskan sisanya satu kali, di akhir.

**Komentar yang terus kamu ulangi menjadi aturan.** Saat kamu menandai sebuah temuan dengan "jadikan aturan", Claude menyusun draf aturan lint atau test, dan review-loop menjalankannya pada kode dari sebelum perbaikan untuk membuktikan bahwa draf itu menangkap kesalahannya. Perbaikan bug mendapat regression test dengan cara yang sama.

**Sengaja dibuat kecil.** review-loop menambahkan sekitar 212 token ke satu sesi. Hook-nya tidak melakukan apa pun sampai kamu menyalakannya di sebuah repository. Tidak ada yang dipasang tanpa memberitahumu apa itu dan cara menghapusnya.

Silakan fork, ubah, dan jadikan milikmu. Issue dan pull request dipersilakan.

## Plugin

| Plugin | Status | Satu tugas |
|---|---|---|
| [review-loop](../../plugins/review-loop) | 0.8.0 | Me-review perubahanmu sebelum kamu commit, memperbaiki temuan P1 dan P2, me-review ulang, dan menyerahkan sisanya kepadamu. |
| [clear-explain](../../plugins/clear-explain) | 0.1.0 | Menjelaskan konsep, kode, dan error dengan jawaban di awal, satu makna untuk setiap kata, dan istilah teknis dengan nama resmi berbahasa Inggris. |
| [verify](../../plugins/verify) | 0.3.0 | Membuktikan fitur-fiturmu berjalan dengan menjalankannya, lalu menyimpan perintah dan output-nya sebagai bukti. |

## Pemasangan

Kamu membutuhkan Claude Code, git, dan Node.js 18 atau lebih baru.

```
/plugin marketplace add lee-eojin/lim
/plugin install review-loop@lim
```

Jika Claude Code memintanya, mulai ulang Claude Code. Menambahkan marketplace hanya mendaftarkan katalog. Setiap plugin dipasang secara terpisah, jadi kamu hanya mendapat yang kamu pilih.

## Memulai

Dua langkah:

1. Pasang review-loop seperti di atas.
2. Di git repository yang memiliki perubahan yang belum di-commit, ketik:

```
/review-loop:review-loop
```

Hanya itu. review-loop menjalankan pemeriksaanmu, me-review perubahan, memperbaiki yang harus diperbaiki, dan menanyakan sisanya kepadamu. Di akhir, review-loop bertanya satu kali apakah commit gate perlu dinyalakan untuk repository ini, lalu apakah perubahan perlu di-commit.

Baru mulai? [Panduan](../../docs/guide/README.md) (dalam bahasa Inggris) membahas review pertama, cara memutuskan, commit gate, biaya, dan jebakan umum, dengan output asli.

## Penggunaan

### Cukup gunakan `/review-loop:review-loop`

Ketik perintah ini setiap kali kamu akan commit. Kamu bisa menambahkan keinginanmu dengan kalimat biasa setelah perintahnya:

```
/review-loop:review-loop I changed the coupon math. Check it before I commit.
```

```
/review-loop:review-loop confirm every P2 with me before you fix anything.
```

Claude juga dapat memulai review-loop sendiri saat kamu memintanya me-review atau commit, tetapi hanya jika Claude memutuskan bahwa skill itu cocok. Perintah ini selalu memulainya.

### Seperti apa satu putaran

Setiap putaran berakhir dengan laporan. Claude menampilkannya sebelum hal lain:

```
Review round 2 of 3 (reviewer: session model)
Checks: test (npm run test) passed

Resolved since last round:
- F-1 [P1] Coupon total adds the discounted sum on top of the full subtotal (fixed, inferred: the re-review read the fix)
  test: src/coupon.test.js (before the fix: caught, after: passed)

Trend (P1 + P2): 1 -> 0
Stopped: no P1 or P2 left in this change
Left for you: P3 1, P4 0, P5 0
```

Di sini, putaran 1 menemukan sebuah P1. Claude memperbaikinya dan menulis regression test, dan review-loop menunjukkan bahwa test itu gagal pada kode dari sebelum perbaikan. Putaran 2 mengonfirmasi perbaikannya, jadi loop berhenti. Satu P3 tersisa untukmu.

### Contoh

<details>
<summary>Semua prompt</summary>

```
review before commit:   /review-loop:review-loop
with intent:            /review-loop:review-loop I moved the retry logic into the client. Check it
                        before I commit.
confirm P2 first:       /review-loop:review-loop confirm every P2 with me before you fix anything.
confirm P1 and P2:      /review-loop:review-loop confirm every P1 and P2 with me before you fix anything.
stop confirming:        /review-loop:review-loop stop confirming findings with me before fixes.
continue a loop:        /review-loop:review-loop
                        (in a new session it offers to continue where the last loop stopped)
turn on the gate:       /review-loop:review-loop turn on the commit gate in this repo.
turn off the gate:      /review-loop:review-loop turn off the commit gate in this repo.
skip once:              /review-loop:review-loop commit this without a review, just this once.
delegate commits:       /review-loop:review-loop stop asking before commits in this repo.
take it back:           /review-loop:review-loop turn off commit delegation.
run unattended:         /review-loop:review-loop run unattended. I will read the summary in the morning.
reviewer model:         /review-loop:review-loop run the reviewer on sonnet in this repo.
```

</details>

## Cara review berjalan

Sebelum kamu commit, review-loop menjalankan satu loop pendek dan berhenti sendiri.

1. **Pemeriksaan.** review-loop menjalankan pemeriksaan `typecheck`, `lint`, dan `test` yang dideklarasikan proyekmu: script di `package.json`, target Makefile, atau bawaan untuk Go (`go.mod`), Rust (`Cargo.toml`), dan tool Python yang kamu konfigurasi. Pemeriksaan yang gagal, atau `package.json` yang bukan JSON valid, menjadi temuan P1. Pemeriksaan yang berjalan melewati batas waktunya, atau yang programnya tidak terpasang, dilaporkan sebagai "belum terverifikasi", bukan gagal.
2. **Review baru.** Sebuah reviewer agent terpisah menerima diff dan ringkasan satu baris tentang tujuanmu, tetapi tidak menerima penalaran Claude tentang perubahan itu. Agent ini dapat membaca kode di sekitarnya untuk memahami konteks. Agent ini memberi label P1 sampai P5 pada temuan. P1 dan P2 membutuhkan bukti: baris yang tepat, skenario kegagalan, dan alasan mengapa belum ada yang mencegahnya. Setiap temuan diberi label measured, inferred, atau guessed. P1 atau P2 tanpa bukti, atau yang berlabel guessed, ditampilkan kepadamu sebagai belum terverifikasi dan tidak diperbaiki.
3. **Perbaikan.** Claude menyebutkan apa yang akan diperbaikinya, lalu memperbaiki P1 dan P2. Jika sebuah perbaikan membutuhkan pilihan desain (ada lebih dari satu cara memperbaikinya, perubahan perilaku yang terlihat, penghapusan fitur, perubahan test), kamu memilih lebih dulu. Jika proyekmu punya script test, Claude menulis regression test dari skenario kegagalan setiap P1 atau P2 yang diperbaikinya, dan review-loop menunjukkan bahwa test itu gagal pada kode dari sebelum perbaikan.
4. **Review ulang.** Reviewer baru hanya memeriksa perbaikan dan temuan yang masih terbuka. Maksimal 3 putaran.
5. **Berhenti.** Sebuah script, bukan model, yang memutuskan kapan berhenti: tidak ada P1 atau P2 yang tersisa, batas putaran tercapai, sebuah temuan tetap ada setelah dua perbaikan, temuan yang sudah selesai muncul lagi, P1 + P2 berhenti berkurang, atau sebuah perbaikan melemahkan test atau pemeriksaan.
6. **Putuskan.** Kamu memutuskan sisanya satu kali: semua P3 sampai P5, ditambah setiap P1 atau P2 yang masih terbuka, tidak dapat diverifikasi, atau menyangkut file di luar diff yang di-review. Untuk setiap temuan, kamu memilih: biarkan apa adanya, perbaiki untuk kali ini saja, atau jadikan aturan. Temuan yang kamu biarkan apa adanya tidak ditanyakan lagi pada review berikutnya sampai baris yang dikutip berubah, dan laporan menghitungnya sebagai gantinya. Jika review sebelumnya di repository ini sudah mengangkat salah satu dari empat jenis yang dicari reviewer (seperti guard spekulatif) 3 kali atau lebih, Claude menyebutkannya dan merekomendasikan untuk menjadikannya aturan pada lapisan terkuat yang cocok: pertama perubahan tipe atau arsitektur, lalu aturan lint, lalu test.
7. **Commit.** Claude bertanya sebelum commit, kecuali kamu memilih "berhenti bertanya di repo ini". Claude tidak pernah melakukan push. Jika kamu menyalakan commit gate, sebuah hook menjadikan ini aturan: commit Claude diblokir sampai sebuah review lolos.

Saat Claude mengatakan sesuatu sudah diperbaiki, Claude juga menyebutkan bagaimana ia mengetahuinya: pemeriksaan yang sekarang lolos berarti measured, dan pembacaannya atas kode baru berarti inferred. Saat kamu membantah sebuah temuan, Claude memeriksa klaim itu lagi sebelum setuju, dan memberitahumu apa yang diperiksanya.

### Apa yang dicari reviewer

Reviewer mencari bug, kebutuhan yang hilang, aturan proyek yang dilanggar, dan hal lain yang akan membuat perubahan gagal mencapai apa yang kamu katakan sebagai tujuanmu. Reviewer tidak memperdebatkan tujuanmu. Reviewer juga mencari empat jenis kode yang ditambahkan agent ketika tidak mengetahui penyebab sebuah masalah, karena agent berikutnya akan menirunya:

<details>
<summary>Empat jenis itu</summary>

| Jenis | Apa itu | Tingkat keparahan |
|---|---|---|
| Guard spekulatif | Pemeriksaan, try/catch, fallback, atau nilai default untuk state yang tidak terbukti dapat terjadi | P2 jika menyembunyikan kegagalan, selain itu P3 |
| Komentar riwayat | Komentar tentang siapa meminta apa, mengapa versi sebelumnya berubah, atau instruksi untuk agent | P4 |
| Penanda jalan pintas | Komentar TODO, HACK, "temporary", atau "for now" tanpa tautan ke issue | P3 |
| Cara kedua | Helper, pola, atau dependensi untuk pekerjaan yang sudah dilakukan codebase dengan cara lain | P3 |

Guard sudah tepat di tempat state yang sah masuk ke kode: input pengguna, pembacaan dari jaringan atau file, atau nilai yang menurut dokumentasi API mungkin tidak ada. Pemeriksaan kedua di bagian yang lebih dalam, untuk state yang sudah ditangani, tetap spekulatif. Sebuah fixture di [`evals/review-loop/fixtures/reviewer-rubric/`](../../evals/review-loop/fixtures/reviewer-rubric/) berisi satu contoh dari setiap jenis dan memeriksa bahwa reviewer menandai semuanya.

</details>

### Tingkat keparahan

Tingkat ini berdasarkan aturan Pn publik dari Banksalad.

| Tingkat | Arti | Perilaku loop |
|---|---|---|
| P1 | Wajib diperbaiki: pemeriksaan yang gagal, kehilangan data, celah keamanan, crash, atau fitur yang diminta tidak berfungsi | Diperbaiki jika ada bukti |
| P2 | Sebaiknya diperbaiki: bug yang dapat direproduksi oleh input tertentu, kebutuhan yang hilang, aturan proyek yang dilanggar | Diperbaiki jika ada bukti |
| P3 | Layak diperbaiki: kemudahan pemeliharaan, nama yang menyesatkan, test yang hilang pada jalur minor | Kamu yang memutuskan |
| P4 | Opsional: preferensi struktur yang tidak disepakati semua orang | Kamu yang memutuskan |
| P5 | Sepele: salah ketik atau format | Kamu yang memutuskan |

P1 atau P2 tentang file yang tidak ada di diff yang di-review pada putaran itu tidak diperbaiki di dalam loop. Temuan itu sampai kepadamu di akhir, ditandai sebagai di luar diff yang di-review, dengan tingkat keparahan yang tetap.

### Aturan dan regression test

Komentar yang harus terus diulang oleh reviewer adalah tanda ada aturan yang belum dibuat. review-loop menghitungnya: setiap review mencatat jenis setiap temuan di sebuah file yang dipakai bersama oleh semua worktree di repository itu, dan temuan dari salah satu empat jenis di atas yang jenisnya sudah diangkat 3 kali atau lebih oleh review sebelumnya ditandai sebagai pengulangan. Label luas seperti correctness tetap dicatat, tetapi tidak pernah dihitung sebagai pengulangan. Saat kamu memilih "jadikan aturan" untuk sebuah temuan, Claude lebih dulu mencari aturan yang sudah ada di konfigurasi lint atau test milikmu yang seharusnya menangkapnya. Lalu Claude memilih bentuk pertama yang berhasil: menyalakan aturan lint yang sudah ada, menulis aturan kustom untuk linter yang sudah kamu pakai, atau menulis test. Draf itu tidak pernah ditaruh di file yang menjadi pokok temuan.

Setelah itu, review-loop membuktikan draf tersebut. review-loop menulis kode dari sebelum perbaikan ke folder sementara dan menjalankan pemeriksaanmu di sana, dengan dan tanpa draf:

| Hasil | Arti |
|---|---|
| `caught` | Sebuah pemeriksaan gagal hanya jika ada draf. Aturan itu menangkap kesalahannya. |
| `missed` | Semua pemeriksaan lolos meskipun ada draf. Claude merevisinya satu kali. |
| `unproven` | Sebuah pemeriksaan melewati batas waktu, atau juga gagal tanpa draf. Claude memberitahumu yang mana. |

Aturan membutuhkan pemeriksaan yang akan menjalankannya. Tanpa script `typecheck`, `lint`, atau `test`, pilihan itu dicatat sebagai "perbaiki untuk kali ini saja" dan Claude memberitahumu alasannya. Draf yang sudah terbukti masuk ke commit yang sama dengan perbaikannya, dan pesan commit menyebutkannya.

Setiap P1 atau P2 yang diperbaiki Claude mendapat regression test dengan cara yang sama, tanpa bertanya, jika proyekmu punya script test. Untuk regression test, hanya pemeriksaan test yang dihitung sebagai bukti: jika hanya lint yang gagal karena test itu, berarti test itu tidak menangkap bug-nya. Perbaikan tanpa test menyebutkan alasannya di laporan.

### Commit gate

Commit gate adalah sebuah hook yang mati sampai kamu menyalakannya di sebuah repository. Di akhir review, Claude bertanya satu kali apakah hook ini perlu dinyalakan. Saat gate menyala, setiap `git commit` yang dijalankan Claude diperiksa lebih dulu.

<details>
<summary>Yang dilakukan gate</summary>

| Situasi | Yang dilakukan gate |
|---|---|
| Tidak ada review, atau ada file berubah yang tidak dicakup review | Memblokir commit dan meminta Claude menjalankan review |
| Loop review sedang berjalan, atau masih ada keputusan yang tertunda | Memblokir commit |
| Review lolos | Bertanya kepadamu sebelum commit, atau mengizinkan commit jika kamu sudah mendelegasikan commit di repository ini |
| Setelah review, hanya file yang sudah di-review atau draf aturan dan regression test yang sudah diperiksa `loop rule` yang berubah | Bertanya kepadamu |
| `git push` atau force push | Selalu bertanya, bahkan dengan delegasi |
| Commit dengan `--no-verify` | Bertanya, bahkan dengan delegasi, dan tetap memblokir commit tanpa review yang lolos |
| Commit di folder yang tidak bisa dibaca gate, seperti `cd "$(...)"` atau path yang tidak ada | Bertanya kepadamu, bahkan dengan delegasi, jika gate aktif di repository tempat kamu memulai Claude Code |

Untuk commit satu kali tanpa review, minta Claude untuk melewati review kali ini. Pengaturan gate dan delegasi commit berlaku untuk seluruh repository, termasuk worktree yang tertaut. Setiap worktree punya review sendiri.

</details>

### Pengaturan

Lima pengaturan pertama berlaku untuk satu repository. Untuk mengubahnya, ketik permintaanmu setelah `/review-loop:review-loop`, agar Claude sudah memuat perintah dari skill tersebut. Batas waktu pemeriksaan adalah environment variable, jadi berlaku di mana pun kamu mengaturnya, dan total 9 menit bersifat tetap.

| Pengaturan | Default | Yang diketik |
|---|---|---|
| Konfirmasi sebelum perbaikan | Mati | "konfirmasi setiap P2 denganku" atau "konfirmasi setiap P1 dan P2 denganku" |
| Commit gate | Ditanyakan satu kali di akhir review pertama | "nyalakan (atau matikan) commit gate" |
| Delegasi commit | Bertanya sebelum setiap commit | "berhenti bertanya sebelum commit di repo ini" |
| Tanpa pengawasan | Mati | "jalankan tanpa pengawasan" untuk satu eksekusi, atau "nyalakan (atau matikan) mode tanpa pengawasan di repo ini". Claude tidak menanyakan apa pun, menunda hal yang membutuhkanmu, dan mengakhiri dengan ringkasan tentang apa yang sudah dilakukannya dan apa yang menunggumu |
| Model reviewer | Model sesimu | "jalankan reviewer dengan sonnet di repo ini" (atau opus, haiku, fable), atau "jalankan reviewer dengan model sesi". Bagian Terukur menunjukkan apa yang ditemukan tiap model dan berapa biayanya |
| Batas waktu pemeriksaan | 5 menit per pemeriksaan, total 9 menit | Atur `LIM_CHECK_TIMEOUT_MS` untuk mengubah batas per pemeriksaan |

## Terukur

[`evals/review-loop/behaviors.csv`](../../evals/review-loop/behaviors.csv) mencantumkan 196 perilaku pada enam sumbu: do, tell, ask, silence, stop, dan evidence. Unit test di CI mencakup 185 di antaranya, termasuk eksekusi pada git repository sementara yang nyata dan pada hook commit gate. 11 perilaku lainnya membutuhkan eksekusi dengan model: bertanya tentang P3 sampai P5 satu kali, menampilkan laporan sebelum pertanyaan apa pun, menyimpan setiap langkah di daftar tugas dengan alasan untuk setiap langkah yang dilewati, menulis regression test untuk setiap P1 atau P2 yang diperbaiki, memberi label measured, inferred, atau guessed pada setiap temuan, menyebutkan bagaimana sebuah perbaikan diketahui berhasil, memeriksa ulang sebuah temuan saat kamu membantahnya, merekomendasikan aturan untuk jenis temuan yang terus muncul kembali, tidak bertanya apa pun dalam eksekusi tanpa pengawasan, menjalankan reviewer dengan model yang kamu pilih, dan melaporkan kode yang ditambahkan tanpa penyebab yang diketahui. Perilaku terakhir memiliki fixture di [`evals/review-loop/fixtures/reviewer-rubric/`](../../evals/review-loop/fixtures/reviewer-rubric/), dan dua perilaku pertama memiliki eksekusi manual di [`evals/review-loop/manual-behaviors.md`](../../evals/review-loop/manual-behaviors.md).

Sebuah benchmark deteksi memberi reviewer perubahan di repository sementara yang namanya tidak menunjukkan bahwa itu adalah sebuah test. [`evals/review-loop/detection/`](../../evals/review-loop/detection/) berisi 12 perubahan yang masing-masing berisi satu bug yang sengaja ditanam dan 6 perubahan yang bersih. [`evals/review-loop/detection-hard/`](../../evals/review-loop/detection-hard/) berisi 10 bug yang lebih sulit, misalnya bug yang hanya terlihat di file yang tidak disentuh diff, bug yang hanya terlihat dengan menelusuri empat file, bug di dalam diff sepanjang 183 baris, race antara dua pencarian, buffer yang dikosongkan sebelum sebuah penulisan async membacanya, dan lock yang tidak dilepas di jalur error, serta 6 perubahan bersih yang terlihat mencurigakan. Hasil dengan 3 eksekusi per kasus, pada 2026-10-25 untuk set reguler dan 2026-10-26 untuk set lebih sulit:

| Model reviewer | Set reguler: bug yang ditemukan sebagai P1 atau P2 | Set reguler: P1 atau P2 palsu pada perubahan bersih | Set lebih sulit: bug yang ditemukan sebagai P1 atau P2 | Set lebih sulit: P1 atau P2 palsu pada perubahan bersih | Biaya set lebih sulit (48 eksekusi) |
|---|---|---|---|---|---|
| claude-opus-5-5 | 36 dari 36 | 0 dari 18 | 30 dari 30 | 0 dari 18 | $3,11 |
| claude-sonnet-5-5 | tidak dijalankan | tidak dijalankan | 29 dari 30 | 0 dari 18 | $1,14 |
| claude-haiku-5-5 | tidak dijalankan | tidak dijalankan | 30 dari 30 | 3 dari 18 | $0,09, menurut laporan Claude Code |

Secara default, reviewer berjalan dengan model sesimu. Opus menemukan setiap bug yang ditanam di kedua set, jadi benchmark ini belum bisa menunjukkan penurunan jumlah bug yang ditemukan untuknya. Untuk melihat apakah benchmark ini bisa menunjukkan `reviewer.md` yang lebih buruk sama sekali, Opus juga menjalankan set yang lebih sulit dengan `reviewer.md` yang dipangkas hingga tinggal format output-nya: Opus tetap menemukan 30 dari 30, menghasilkan 1 P2 palsu dari 18 eksekusi bersih, dan memunculkan 83 temuan P3 sampai P5, sementara reviewer lengkap memunculkan 55. Bagi Opus, menemukan bug-bug ini lebih bergantung pada model daripada pada instruksi, dan `reviewer.md` yang lebih buruk terlihat sebagai alarm palsu dan noise. Satu-satunya kegagalan Sonnet tidak mengembalikan temuan apa pun untuk buffer yang dikosongkan sebelum penulisan async. 3 alarm palsu Haiku semuanya terjadi pada satu kasus bersih yang sama, yang juga menghasilkan 1 P2 palsu dari 9 eksekusi Opus dengan reviewer lengkap selama dua hari. Sebuah temuan dihitung jika menyebut bug yang ditanam pada baris yang diubah, atau, untuk bug yang hanya terlihat di file lain, pada baris yang ditandai di file itu. Setelah eksekusi pertama, kata kunci ditambahkan di empat kasus ketika reviewer menyebut bug yang ditanam dengan kata-kata yang tidak diterima oleh penilaian, dan setiap eksekusi yang tersimpan dinilai ulang dengan kata kunci itu. Jalankan lagi dengan `node evals/review-loop/run-detection.mjs --runs 3`, dan tambahkan `--cases evals/review-loop/detection-hard` untuk set yang lebih sulit.

Tabel di atas menjadi dasar model default reviewer. Pada set lebih sulit, Opus menemukan 30 dari 30 tanpa P1 atau P2 palsu, Sonnet menemukan 29 dari 30 tanpa satu pun dengan biaya sekitar 37% dari Opus, dan Haiku menemukan 30 dari 30 dengan 3 P1 atau P2 palsu dari 18 eksekusi bersih. Jadi default tetap model sesi, dan Sonnet adalah pilihan yang lebih murah saat kamu ingin reviewer berjalan pada model yang berbeda dari model yang menulis perubahan.

<details>
<summary>Biaya</summary>

`claude plugin details` memperkirakan biaya review-loop sebagai berikut:

| Bagian | Selalu aktif, setiap sesi | Setiap kali berjalan |
|---|---|---|
| skill review-loop | sekitar 140 token | sekitar 5.600 token |
| reviewer agent | sekitar 70 token | sekitar 1.700 token, ditambah diff dan kode yang dibacanya |

Biaya skill dibayar satu kali per eksekusi. Biaya reviewer dibayar satu kali per putaran, dan satu loop berjalan maksimal 3 putaran. Model reviewer mengubah biaya itu; tabel benchmark di atas menunjukkannya untuk tiap model. Pemeriksaanmu berjalan di mesinmu sendiri dan tidak memakan token.

</details>

review-loop me-review pull request milik LIM sendiri. [#8](https://github.com/lee-eojin/lim/pull/8) menunjukkan dua loop pada versi pertamanya, termasuk satu loop yang berhenti karena false positive pada pemeriksaan test yang dilemahkan milik review-loop sendiri. Kesalahan ini kemudian diperbaiki. Pull request terbaru, seperti [#46](https://github.com/lee-eojin/lim/pull/46), menunjukkan laporan review-loop dan keputusan untuk setiap temuan.

## Mengapa cara kerjanya seperti ini

<details>
<summary>Mengapa reviewer baru?</summary>

Agent yang menulis sebuah perubahan tahu alasan setiap baris ada di sana, jadi agent itu membaca perubahannya sebagai sesuatu yang benar. Reviewer yang hanya menerima diff dan satu baris tujuan harus menemukan alasannya di dalam kode. Jika alasannya tidak ada di sana, itu adalah sebuah temuan. Setiap putaran memulai reviewer baru, jadi reviewer tidak pernah menilai putusannya sendiri dari putaran sebelumnya.

</details>

<details>
<summary>Mengapa script yang memutuskan kapan berhenti?</summary>

Model yang ditanya "apakah ini sudah selesai?" cenderung menjawab ya. Script review-loop menghitung saja: script berhenti saat tidak ada P1 atau P2 yang tersisa, setelah 3 putaran, saat sebuah temuan bertahan setelah dua perbaikan, saat temuan yang sudah selesai muncul lagi, saat P1 + P2 berhenti berkurang, atau saat sebuah perbaikan melemahkan test. Berhenti dengan temuan yang masih terbuka adalah hasil yang normal, dan Claude menyampaikannya.

</details>

<details>
<summary>Mengapa P1 dan P2 membutuhkan bukti?</summary>

Klaim yang terdengar yakin dan klaim yang terbukti terlihat sama di laporan. P1 atau P2 harus mengutip baris yang tepat, memberikan input yang menghasilkan hasil yang salah, dan menyebutkan mengapa belum ada yang mencegahnya. Tanpa ketiganya, atau jika reviewer memberinya label guessed, temuan itu ditampilkan sebagai belum terverifikasi dan Claude tidak mengubah kode karenanya.

</details>

<details>
<summary>Mengapa commit gate bersifat opt-in?</summary>

Hook yang memblokir commit mengubah cara kerjamu, jadi hook itu harus menjadi pilihanmu untuk setiap repository. Tanpa gate, "bertanya sebelum commit" adalah instruksi yang diikuti Claude. Dengan gate, hook memblokir `git commit` yang dijalankan Claude tanpa review yang lolos. Hook ini tidak bisa melihat semuanya: [Batasan](#batasan) mencantumkan apa yang terlewat olehnya, seperti commit yang kamu ketik di terminalmu sendiri.

</details>

<details>
<summary>Mengapa review-loop tidak pernah melakukan push?</summary>

Commit bersifat lokal dan mudah dibatalkan. Push tidak. review-loop berhenti di commit, dan gate bertanya sebelum setiap push meskipun kamu sudah mendelegasikan commit.

</details>

## Data

State, diff, log pemeriksaan, dan catatan keputusan disimpan di `.git/lim/review-loop/` di dalam repository milikmu. Claude menulis setiap review ke `.lim-review/` di working tree milikmu untuk sesaat; git mengabaikan folder itu melalui `.git/info/exclude`, dan review-loop menghapus file tersebut setelah membacanya. Untuk memeriksa aturan, review-loop menulis kode dari sebelum perbaikan ke folder sementara di luar repository milikmu, lalu menghapusnya setelah selesai. Hapus `.git/lim/review-loop/` untuk mengatur ulang.

review-loop tidak melakukan panggilan jaringan sendiri. Claude dan reviewer membaca diff, temuan, dan output pemeriksaan seperti file lain di sesimu. Karena itu, konten tersebut dikirim ke penyedia model dengan cara yang sama seperti bagian lain dari sesi Claude Code milikmu.

## Batasan

- review-loop mendeteksi pemeriksaan dari script di `package.json`, lalu target Makefile, lalu Go, Rust, dan tool Python yang dikonfigurasi (pytest, ruff, mypy), di root repository dan di proyek subfolder yang disentuh perubahan, paling banyak 4 per putaran.
- Setiap pemeriksaan mendapat waktu maksimal 5 menit, dan semua pemeriksaan bersama-sama maksimal 9 menit.
- Tanpa commit gate, bertanya sebelum commit adalah instruksi untuk Claude, bukan jaminan.
- Commit gate hanya memeriksa perintah yang dijalankan Claude melalui tool Bash miliknya. Commit yang kamu ketik di terminalmu sendiri tidak diperiksa. Commit melalui alias git seperti `git ci` diperiksa seperti `git commit`, alias shell (`!...`) yang melakukan commit akan ditanyakan karena gate tidak bisa melihat isinya, dan alias yang diatur langsung dengan `git -c alias.ci=commit` tidak dikenali.
- Jika kamu memulai Claude Code di folder yang bukan repository, gate tidak bisa memeriksa commit yang repository-nya tidak bisa ia kenali, misalnya setelah `cd "$(...)"`.
- review-loop me-review semua yang akan dimasukkan oleh `git add -A`, bukan kumpulan perubahan staged yang kamu pilih sendiri.
- Aturan dan regression test diperiksa di salinan sementara yang berisi file tracked milikmu dan tautan ke `node_modules` di root. File ignored lainnya, seperti `.env` atau `node_modules` bersarang, tidak ada di sana. Karena itu, pemeriksaan yang membutuhkannya melaporkan hasil belum terbukti, atau tertangkap karena alasan yang salah. Claude membaca kegagalannya untuk mengetahui yang mana.

## FAQ

**Apakah review-loop mulai sendiri?**
Tidak selalu. Claude memulai sebuah skill hanya jika Claude memutuskan bahwa deskripsi skill itu cocok dengan percakapan. Jika kamu meminta Claude untuk me-review atau commit, Claude dapat memulai review-loop, tetapi ini tidak dijamin. Perintah `/review-loop:review-loop` selalu memulai review-loop. Jika kamu menyalakan commit gate, commit tanpa review diblokir dan Claude diminta untuk menjalankan review-loop terlebih dahulu.

**Apakah review-loop akan melakukan push atau merge?**
Tidak pernah. review-loop bertanya sebelum setiap commit, kecuali kamu memilih "berhenti bertanya di repo ini". Kamu dapat mematikan pilihan itu lagi dengan meminta Claude mematikan delegasi commit milik review-loop.

**Apakah review-loop akan bentrok dengan plugin saya yang lain?**
review-loop menambahkan satu skill, satu agent, dan satu hook. Hook ini membaca perintah Bash, hanya bertindak pada `git commit` dan `git push`, dan tidak melakukan apa pun kecuali kamu sudah menyalakan commit gate di repository itu. Nama-namanya diawali dengan `review-loop:`, jadi tidak dapat bentrok dengan nama dari plugin lain. Jika kamu bertanya dengan kalimat biasa, Claude dapat memilih review skill lain. Perintah selalu memulai review-loop.

**Apa yang terjadi jika sesi berakhir di tengah loop?**
Jalankan perintah lagi. review-loop menawarkan untuk melanjutkan dari putaran dan langkah tempat ia berhenti, atau memulai dari awal.

**Bagaimana cara meng-uninstall-nya?**

```
claude plugin uninstall review-loop@lim
claude plugin marketplace remove lim
```

Lalu hapus `.git/lim/review-loop/` di setiap repository tempat kamu menjalankan review-loop, beserta baris `.lim-review/` di `.git/info/exclude` miliknya.

## Jadikan milikmu

review-loop bekerja dengan pemeriksaan yang sudah kamu punya. Semakin baik script `typecheck`, `lint`, dan `test` milikmu, semakin banyak bagian review yang diukur, bukan sekadar dibaca.

- Ingin melihat temuan yang serius sebelum ada yang berubah? Minta Claude untuk mengonfirmasi setiap P2, atau setiap P1 dan P2.
- Bosan menyetujui commit di repository yang kamu percaya? Delegasikan commit di sana. Jika commit gate menyala, push tetap ditanyakan.
- Terus mendapat komentar yang sama? Pilih "jadikan aturan", dan review berikutnya dimulai dengan kesalahan itu sudah ditangkap oleh linter atau test milikmu sendiri.
- Ingin alur yang berbeda? Fork plugin ini. Skill-nya adalah satu `SKILL.md` di bawah 250 baris, dan logika loop-nya ada di satu script, `plugins/review-loop/skills/review-loop/scripts/loop.mjs`.

## Cara LIM dibangun

- **Issue lebih dulu.** Setiap perubahan dimulai dari sebuah issue dan masuk melalui pull request yang di-squash-merge oleh seorang maintainer.
- **Di-review oleh dirinya sendiri.** Setiap pull request menjalankan review-loop pada diff-nya sendiri, dan deskripsinya menunjukkan laporan serta keputusan untuk setiap temuan.
- **Versi per plugin.** Setiap plugin mengikuti Semantic Versioning, memiliki `CHANGELOG.md` sendiri, dan diberi tag `<plugin>--v<version>`. Rilis minor dan major mendapat GitHub Release.
- **Sengaja dibuat kecil.** Sebuah plugin memiliki satu entry skill, satu `SKILL.md` di bawah 250 baris, dan hanya hook yang bersifat opt-in.

## Roadmap

- Eval tingkat model dengan `claude plugin eval` untuk perilaku yang tidak dapat dicakup oleh unit test, serta perbandingan buta atas kualitas dan biaya review

## Berkontribusi

Issue dan pull request dipersilakan. Mulailah dengan [CONTRIBUTING.md](../../CONTRIBUTING.md).

## Lisensi

MIT. Lihat [LICENSE](../../LICENSE).
