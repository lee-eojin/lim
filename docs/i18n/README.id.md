# LIM

**Less is more.** Plugin Claude Code yang kecil. Setiap plugin mengerjakan satu tugas dan menunjukkan hasil pengukuran di baliknya.

[![CI](https://github.com/lee-eojin/lim/actions/workflows/ci.yml/badge.svg)](https://github.com/lee-eojin/lim/actions/workflows/ci.yml)
[![review-loop](https://img.shields.io/github/v/tag/lee-eojin/lim?filter=review-loop--*&sort=semver&label=review-loop)](../../plugins/review-loop/CHANGELOG.md)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](../../LICENSE)

Ini adalah terjemahan dari [README bahasa Inggris](../../README.md) per 2026-10-19. Jika keduanya berbeda, README bahasa Inggris yang benar.

[English](../../README.md) | [한국어](README.ko.md) | [日本語](README.ja.md) | [简体中文](README.zh-CN.md) | [繁體中文](README.zh-TW.md) | [Español](README.es.md) | [Português (Brasil)](README.pt-BR.md) | [Français](README.fr.md) | [Deutsch](README.de.md) | [Русский](README.ru.md) | [Tiếng Việt](README.vi.md) | Bahasa Indonesia

## Mengapa LIM

Agent harness yang besar memuat banyak instruksi ke setiap sesi dan menjalankan hook pada banyak perintah. LIM membuat setiap plugin tetap kecil, opsional, dan terukur.

- **Satu plugin, satu tugas.** Pasang hanya yang kamu butuhkan. review-loop menambahkan sekitar 188 token ke satu sesi. Angka ini dilaporkan oleh `claude plugin details`.
- **Pemeriksaan dulu, opini kemudian.** Test, pemeriksaan tipe, dan lint milikmu berjalan sebelum review apa pun oleh model.
- **Hook bersifat opt-in.** Sebuah hook tidak melakukan apa pun sampai kamu menyalakannya untuk sebuah repository.
- **Bertanya sebelum memasang.** Semua yang dibutuhkan plugin dijelaskan lebih dulu: apa itu, apa yang diperbaikinya, di mana letaknya, dan cara menghapusnya.
- **Tunjukkan angkanya.** Setiap plugin disertai informasi tentang apa yang diukur dan apa yang tidak dicakup oleh pengukuran itu.

## Plugin

| Plugin | Status | Satu tugas |
|---|---|---|
| [review-loop](../../plugins/review-loop) | 0.2.0 | Me-review perubahanmu sebelum kamu commit, memperbaiki temuan P1 dan P2, me-review ulang, dan menyerahkan sisanya kepadamu. |
| forge | direncanakan | Mengubah komentar pull request dari seorang reviewer menjadi reviewer skill, dengan laporan tentang seberapa setia skill itu. |

## Mulai cepat

Kamu membutuhkan Claude Code, git, dan Node.js 18 atau lebih baru.

```
/plugin marketplace add lee-eojin/lim
/plugin install review-loop@lim
```

Jika Claude Code memintanya, mulai ulang Claude Code. Setelah itu, di git repository yang memiliki perubahan yang belum di-commit, jalankan perintah ini:

```
/review-loop:review-loop
```

Menambahkan marketplace hanya mendaftarkan katalog. Setiap plugin dipasang secara terpisah. Jadi kamu hanya mendapat yang kamu pilih.

## review-loop

Sebelum kamu commit, review-loop menjalankan satu loop pendek dan berhenti sendiri.

1. **Pemeriksaan.** review-loop menjalankan script `typecheck`, `lint`, dan `test` dari `package.json` milikmu. Pemeriksaan yang gagal menjadi temuan P1. `package.json` yang bukan JSON valid juga menjadi temuan P1. Jika sebuah pemeriksaan berjalan melewati batas waktunya, review-loop melaporkannya sebagai "belum terverifikasi", bukan gagal.
2. **Review baru.** Sebuah reviewer agent terpisah menerima diff dan ringkasan satu baris tentang tujuanmu. Agent ini tidak menerima penalaran Claude tentang perubahan itu. Agent ini dapat membaca kode di sekitarnya untuk memahami konteks. Agent ini memberi label P1 sampai P5 pada temuan. P1 dan P2 membutuhkan bukti: baris yang tepat, skenario kegagalan, dan alasan mengapa belum ada yang mencegahnya. review-loop menampilkan klaim tanpa bukti kepadamu sebagai belum terverifikasi.
3. **Perbaikan.** Claude menyebutkan apa yang akan diperbaikinya, lalu memperbaiki P1 dan P2. Jika sebuah perbaikan membutuhkan pilihan desain (ada lebih dari satu cara memperbaikinya, perubahan perilaku yang terlihat, penghapusan fitur, perubahan test), kamu memilih lebih dulu.
4. **Review ulang.** Reviewer baru hanya memeriksa perbaikan dan temuan yang masih terbuka. Maksimal 3 putaran.
5. **Berhenti.** Sebuah script yang memutuskan kapan berhenti, bukan model. Script menghentikan loop dalam kasus berikut: tidak ada P1 atau P2 yang tersisa, batas putaran tercapai, sebuah temuan tetap ada setelah dua perbaikan, temuan yang sudah selesai muncul lagi, P1 + P2 berhenti berkurang, atau sebuah perbaikan melemahkan test atau pemeriksaan.
6. **Putuskan.** Kamu memutuskan sisanya satu kali: semua P3 sampai P5, ditambah setiap P1 atau P2 yang masih terbuka atau tidak dapat diverifikasi. Untuk setiap temuan, kamu memilih: biarkan apa adanya, perbaiki untuk kali ini saja, atau jadikan aturan.
7. **Commit.** Claude bertanya sebelum commit, kecuali kamu memilih "berhenti bertanya di repo ini". Claude tidak pernah melakukan push. Jika kamu menyalakan commit gate, sebuah hook menjadikan ini aturan: commit Claude diblokir sampai sebuah review lolos.

### Commit gate

Commit gate adalah sebuah hook. Hook ini mati sampai kamu menyalakannya di sebuah repository. Di akhir review, Claude bertanya satu kali apakah hook ini perlu dinyalakan. Saat gate menyala, gate memeriksa terlebih dahulu setiap `git commit` yang dijalankan Claude:

| Situasi | Yang dilakukan gate |
|---|---|
| Tidak ada review, atau ada file berubah yang tidak dicakup review | Memblokir commit dan meminta Claude menjalankan review |
| Loop review sedang berjalan, atau masih ada keputusan yang tertunda | Memblokir commit |
| Review lolos | Bertanya kepadamu sebelum commit, atau mengizinkan commit jika kamu sudah mendelegasikan commit di repository ini |
| Setelah review, hanya file yang sudah di-review yang berubah | Bertanya kepadamu |
| `git push` atau force push | Selalu bertanya, bahkan dengan delegasi |
| Commit dengan `--no-verify` | Bertanya, bahkan dengan delegasi, dan tetap memblokir commit tanpa review yang lolos |

Untuk commit satu kali tanpa review, minta Claude untuk melewati review kali ini.

Setiap putaran berakhir dengan laporan:

```
Review round 2 of 3
Checks: test passed

Resolved since last round:
- F-1 [P1] Coupon total adds the discounted sum on top of the full subtotal

Trend (P1 + P2): 1 -> 0
Stopped: no P1 or P2 left in this change
Left for you: P3 1, P4 0, P5 0
```

### Tingkat keparahan

Tingkat ini berdasarkan aturan Pn publik dari Banksalad.

| Tingkat | Arti | Perilaku loop |
|---|---|---|
| P1 | Wajib diperbaiki: pemeriksaan yang gagal, kehilangan data, celah keamanan, crash, atau fitur yang diminta tidak berfungsi | Diperbaiki hanya jika ada bukti |
| P2 | Sebaiknya diperbaiki: bug yang dapat direproduksi oleh input tertentu, kebutuhan yang hilang, aturan proyek yang dilanggar | Diperbaiki hanya jika ada bukti |
| P3 | Layak diperbaiki: kemudahan pemeliharaan, nama yang menyesatkan, test yang hilang pada jalur minor | Kamu yang memutuskan |
| P4 | Opsional: preferensi struktur yang tidak disepakati semua orang | Kamu yang memutuskan |
| P5 | Sepele: salah ketik atau format | Kamu yang memutuskan |

### Terukur

[`evals/review-loop/behaviors.csv`](../../evals/review-loop/behaviors.csv) mencantumkan 49 perilaku pada enam sumbu: do, tell, ask, silence, stop, dan evidence. Unit test di CI mencakup 47 di antaranya. Unit test ini termasuk eksekusi pada git repository sementara yang nyata dan pada hook commit gate. 2 perilaku sisanya membutuhkan eksekusi dengan model dan direncanakan untuk `claude plugin eval`: bertanya tentang P3 sampai P5 satu kali dan menampilkan laporan sebelum pertanyaan apa pun.

review-loop me-review pull request milik LIM sendiri. [#8](https://github.com/lee-eojin/lim/pull/8) menunjukkan dua loop pada versi pertama review-loop. Salah satunya berhenti karena false positive pada pemeriksaan test yang dilemahkan milik review-loop sendiri. Kesalahan ini kemudian diperbaiki.

### Data

State, diff, log pemeriksaan, dan catatan keputusan disimpan di `.git/lim/review-loop/` di dalam repository milikmu. review-loop tidak menulis apa pun ke working tree milikmu. Hapus folder itu untuk mengatur ulang.

review-loop tidak melakukan panggilan jaringan sendiri. Claude dan reviewer membaca diff, temuan, dan output pemeriksaan seperti file lain di sesimu. Karena itu, konten tersebut dikirim ke penyedia model dengan cara yang sama seperti bagian lain dari sesi Claude Code milikmu.

### Batasan

- review-loop mendeteksi pemeriksaan hanya dari script di `package.json`.
- Setiap pemeriksaan mendapat waktu maksimal 5 menit. Semua pemeriksaan bersama-sama mendapat waktu maksimal 9 menit. Atur `LIM_CHECK_TIMEOUT_MS` untuk mengubah batas per pemeriksaan.
- Tanpa commit gate, bertanya sebelum commit adalah instruksi untuk Claude, bukan jaminan.
- Commit gate hanya memeriksa perintah yang dijalankan Claude melalui tool Bash miliknya. Commit yang kamu ketik di terminalmu sendiri tidak diperiksa. Alias git seperti `git ci` tidak dikenali.
- review-loop me-review semua yang akan dimasukkan oleh `git add -A`. review-loop tidak me-review kumpulan perubahan staged yang kamu pilih sendiri.

## FAQ

**Apakah review-loop mulai sendiri?**
Tidak selalu. Claude memulai sebuah skill hanya jika Claude memutuskan bahwa deskripsi skill itu cocok dengan percakapan. Jika kamu meminta Claude untuk me-review atau commit, Claude dapat memulai review-loop, tetapi ini tidak dijamin. Perintah `/review-loop:review-loop` selalu memulai review-loop. Jika kamu menyalakan commit gate, commit tanpa review diblokir. Lalu Claude diminta untuk menjalankan review-loop terlebih dahulu.

**Apakah review-loop akan melakukan push atau merge?**
Tidak pernah. review-loop bertanya sebelum setiap commit, kecuali kamu memilih "berhenti bertanya di repo ini". Kamu dapat mematikan pilihan itu lagi: minta Claude untuk mematikan delegasi commit milik review-loop.

**Apakah review-loop akan bentrok dengan plugin saya yang lain?**
review-loop menambahkan satu skill, satu agent, dan satu hook. Hook ini membaca perintah Bash dan hanya bertindak pada `git commit` dan `git push`. Jika kamu belum menyalakan commit gate di repository itu, hook ini tidak melakukan apa pun. Nama-namanya diawali dengan `review-loop:`. Karena itu, nama-nama ini tidak dapat bentrok dengan nama dari plugin lain. Jika kamu bertanya dengan kalimat biasa, Claude dapat memilih review skill lain. Perintah selalu memulai review-loop.

**Apa yang terjadi jika sesi berakhir di tengah loop?**
Jalankan perintah lagi. review-loop menawarkan dua pilihan: melanjutkan dari putaran dan langkah tempat review-loop berhenti, atau memulai dari awal.

**Bagaimana cara meng-uninstall-nya?**

```
claude plugin uninstall review-loop@lim
claude plugin marketplace remove lim
```

Lalu hapus `.git/lim/review-loop/` di setiap repository tempat kamu menjalankan review-loop.

## Cara LIM dibangun

- **Issue lebih dulu.** Setiap perubahan dimulai dari sebuah issue. Perubahan itu masuk melalui pull request, dan seorang maintainer melakukan squash-merge pada pull request itu.
- **Versi per plugin.** Setiap plugin mengikuti Semantic Versioning, memiliki `CHANGELOG.md` sendiri, dan diberi tag `<plugin>--v<version>`. Rilis minor dan major mendapat GitHub Release.
- **Sengaja dibuat kecil.** Sebuah plugin memiliki satu entry skill, satu `SKILL.md` di bawah 250 baris, dan hanya hook yang bersifat opt-in.

## Roadmap

- review-loop: opsi untuk mengonfirmasi setiap P2 sebelum memperbaikinya ([#4](https://github.com/lee-eojin/lim/issues/4)), pemeriksaan test yang dilemahkan yang lebih kuat ([#6](https://github.com/lee-eojin/lim/issues/6)), snapshot yang lebih cepat pada repository besar ([#7](https://github.com/lee-eojin/lim/issues/7))
- forge: laporan kesetiaan untuk reviewer skill yang disaring dari komentar pull request
- Eval tingkat model dengan `claude plugin eval` untuk perilaku yang tidak dapat dicakup oleh unit test

## Berkontribusi

Issue dan pull request dipersilakan. Mulailah dengan [CONTRIBUTING.md](../../CONTRIBUTING.md).

## Lisensi

MIT. Lihat [LICENSE](../../LICENSE).
