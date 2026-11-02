#!/usr/bin/env node
/**
 * Memecah data/quran.json menjadi file kecil per kebutuhan:
 *   website/data/surah-list.json  -> metadata ringan 114 surah (untuk halaman utama)
 *   website/data/surah/N.json     -> surah lengkap TANPA tafsir per-ayat (teks Arab, terjemahan, audio, meta)
 *   website/data/tafsir/N.json    -> tafsir per-ayat untuk surah N (array berurutan sesuai ayat), dimuat saat diminta
 * Tidak ada data yang dihapus: skrip memverifikasi bahwa surah/N.json + tafsir/N.json
 * bila digabung kembali identik dengan sumber. data/quran.json tidak pernah diubah.
 * Tanpa dependensi, hanya Node bawaan.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'data', 'quran.json');
const OUT = path.join(ROOT, 'website', 'data');
const MAX_META_BYTES = 400;

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const size = (v) => Buffer.byteLength(JSON.stringify(v));

function findSurahArray(root) {
  if (Array.isArray(root)) return root;
  if (isObj(root)) {
    for (const k of Object.keys(root)) {
      const v = root[k];
      if (Array.isArray(v) && v.length > 100 && v.every(isObj)) return v;
      if (isObj(v)) { const r = findSurahArray(v); if (r) return r; }
    }
  }
  return null;
}

function findVersesKey(surah) {
  if (Array.isArray(surah.verses) && surah.verses.every(isObj)) return 'verses';
  const cands = Object.keys(surah).filter(
    (k) => Array.isArray(surah[k]) && surah[k].length > 0 && surah[k].every(isObj)
  );
  if (!cands.length) throw new Error('Tidak ada field array-objek (ayat) pada surah');
  return cands.sort((a, b) => surah[b].length - surah[a].length)[0];
}

function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a), kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => Object.prototype.hasOwnProperty.call(b, k) && deepEqual(a[k], b[k]));
}


/* ---------- SEO: halaman statis per surah, sitemap, robots ---------- */

const SITE_URL = (process.env.SITE_URL || 'https://www.ayatnusa.com').replace(/\/+$/, '');
function readLegalConfig() {
  const d = { siteName: 'AyatNusa', developer: 'ISI-NAMA-PENGEMBANG', email: 'ISI-EMAIL@contoh.com', appId: 'com.ayatnusa', updated: '2 November 2026' };
  try { Object.assign(d, JSON.parse(fs.readFileSync(path.join(ROOT, 'site-config.json'), 'utf8'))); } catch (e) { /* pakai bawaan */ }
  return d;
}
const LEGAL_CFG = readLegalConfig();
const SITE_NAME = process.env.SITE_NAME || LEGAL_CFG.siteName || 'AyatNusa';
const WEB = path.join(ROOT, 'website');
const SEO_VERSES = 20; // sama dengan jumlah ayat yang langsung dirender aplikasi (CHUNK di app.js)
const HEAD_RE = /<!--seo:head-->[\s\S]*?<!--\/seo:head-->/;
const BODY_RE = /<!--seo:body-->[\s\S]*?<!--\/seo:body-->/;

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const txt = (v) => {
  if (typeof v === 'string') return v;
  if (isObj(v)) { if (typeof v.id === 'string') return v.id; if (typeof v.en === 'string') return v.en; }
  return '';
};
const ld = (o) => JSON.stringify(o).replace(/</g, '\\u003c');
const clip = (t, n) => (t.length <= n ? t : t.slice(0, n - 1).replace(/\s+\S*$/, '') + '…');
const fill = (tpl, head, body) => tpl
  .replace(HEAD_RE, () => `<!--seo:head-->\n${head}\n  <!--/seo:head-->`)
  .replace(BODY_RE, () => `<!--seo:body-->\n${body}\n  <!--/seo:body-->`);

function headHTML({ title, desc, url, graph }) {
  const img = `${SITE_URL}/og-image.png`;
  return [
    `  <title>${esc(title)}</title>`,
    `  <meta name="description" content="${esc(desc)}">`,
    `  <meta name="robots" content="index, follow, max-image-preview:large">`,
    `  <link rel="canonical" href="${url}">`,
    `  <meta property="og:type" content="website">`,
    `  <meta property="og:site_name" content="${esc(SITE_NAME)}">`,
    `  <meta property="og:locale" content="id_ID">`,
    `  <meta property="og:title" content="${esc(title)}">`,
    `  <meta property="og:description" content="${esc(desc)}">`,
    `  <meta property="og:url" content="${url}">`,
    `  <meta property="og:image" content="${img}">`,
    `  <meta property="og:image:width" content="1200">`,
    `  <meta property="og:image:height" content="630">`,
    `  <meta name="twitter:card" content="summary_large_image">`,
    `  <meta name="twitter:title" content="${esc(title)}">`,
    `  <meta name="twitter:description" content="${esc(desc)}">`,
    `  <meta name="twitter:image" content="${img}">`,
    `  <script type="application/ld+json">${ld({ '@context': 'https://schema.org', '@graph': graph })}</script>`
  ].join('\n');
}

function generateSeo(surahs, versesKey) {
  const indexPath = path.join(WEB, 'index.html');
  if (!fs.existsSync(indexPath)) { console.log('SEO dilewati: website/index.html tidak ada'); return; }
  const src = fs.readFileSync(indexPath, 'utf8');
  if (!HEAD_RE.test(src) || !BODY_RE.test(src)) {
    console.log('SEO dilewati: penanda <!--seo:head--> / <!--seo:body--> tidak ada di website/index.html');
    return;
  }
  const tpl = fill(src, '', '');
  const site = { '@type': 'WebSite', name: SITE_NAME, url: SITE_URL + '/', inLanguage: 'id' };
  const info = surahs.map((s, i) => ({
    n: i + 1,
    latin: txt(s.name && s.name.transliteration) || `Surah ${i + 1}`,
    arab: (s.name && typeof s.name.short === 'string') ? s.name.short : '',
    mean: txt(s.name && s.name.translation) || txt(s.translation),
    rev: txt(s.revelation),
    count: s.numberOfVerses || s[versesKey].length
  }));

  // Beranda
  const homeTitle = `${SITE_NAME} - Al-Qur'an Digital Online, Terjemahan & Audio Murottal`;
  const homeDesc = `Baca Al-Qur'an online 114 surah lengkap dengan teks Arab, terjemahan Bahasa Indonesia, tafsir, dan audio murottal per ayat. Ringan dan cepat di HP.`;
  const homeBody = `  <div id="seo">
    <h1>${esc(SITE_NAME)} - Al-Qur'an Digital</h1>
    <p>${esc(homeDesc)}</p>
    <h2>Daftar Surah</h2>
    <ol>
${info.map((x) => `      <li><a href="/surah/${x.n}/">${esc(x.latin)}</a> (${esc(x.mean)}) - ${x.count} ayat</li>`).join('\n')}
    </ol>
    <p>${LEGAL.map(([sl, t]) => `<a href="/${sl}/">${esc(t)}</a>`).join(' · ')}</p>
  </div>`;
  fs.writeFileSync(indexPath, fill(src, headHTML({ title: homeTitle, desc: homeDesc, url: SITE_URL + '/', graph: [{ ...site, description: homeDesc }] }), homeBody));

  // Satu halaman statis per surah (isi sama dengan yang dirender aplikasi, jadi bukan konten berbeda)
  fs.rmSync(path.join(WEB, 'surah'), { recursive: true, force: true });
  info.forEach((x, i) => {
    const s = surahs[i];
    const url = `${SITE_URL}/surah/${x.n}/`;
    const title = `Surah ${x.latin} - Arti, Terjemahan & Audio | ${SITE_NAME}`;
    const desc = clip(`Baca Surah ${x.latin}${x.mean ? ` (${x.mean})` : ''} lengkap: ${x.count} ayat dengan teks Arab, terjemahan Indonesia, tafsir, dan audio murottal. Surah ke-${x.n}${x.rev ? `, ${x.rev}` : ''}.`, 158);
    const verses = s[versesKey].slice(0, SEO_VERSES);
    const prev = x.n > 1 ? `<a href="/surah/${x.n - 1}/">&laquo; ${esc(info[i - 1].latin)}</a>` : '';
    const next = x.n < info.length ? `<a href="/surah/${x.n + 1}/">${esc(info[i + 1].latin)} &raquo;</a>` : '';
    const body = `  <div id="seo">
    <nav aria-label="Navigasi"><a href="/">Beranda</a> ${prev} ${next}</nav>
    <h1>Surah ${esc(x.latin)}${x.arab ? ` (<span lang="ar">${esc(x.arab)}</span>)` : ''}</h1>
    <p>${esc(x.mean)}${x.mean ? ' · ' : ''}${x.count} ayat${x.rev ? ' · ' + esc(x.rev) : ''} · Surah ke-${x.n}</p>
${verses.map((v, k) => {
    const num = (v.number && typeof v.number === 'object') ? v.number.inSurah : (v.number ?? k + 1);
    const arab = String((v.text && v.text.arab) ?? txt(v.text)).replace(/\ufeff/g, '');
    return `    <section>
      <h2>${esc(x.latin)} ayat ${esc(num)}</h2>
      <p lang="ar" dir="rtl">${esc(arab)}</p>
      <p>${esc((v.translation && v.translation.id) ?? txt(v.translation))}</p>
    </section>`;
  }).join('\n')}
    <p>Baca seluruh ${x.count} ayat, dengarkan audio, dan buka tafsir di aplikasi ${esc(SITE_NAME)}.</p>
  </div>`;
    const graph = [
      { '@type': 'BreadcrumbList', itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Beranda', item: SITE_URL + '/' },
        { '@type': 'ListItem', position: 2, name: `Surah ${x.latin}`, item: url }
      ] },
      { '@type': 'WebPage', name: title, url, description: desc, inLanguage: 'id', isPartOf: site }
    ];
    const dir = path.join(WEB, 'surah', String(x.n));
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'index.html'), fill(tpl, headHTML({ title, desc, url, graph }), body));
  });

  // sitemap.xml dan robots.txt
  const today = new Date().toISOString().slice(0, 10);
  const urls = [SITE_URL + '/', ...info.map((x) => `${SITE_URL}/surah/${x.n}/`), ...LEGAL.map(([sl]) => `${SITE_URL}/${sl}/`)];
  fs.writeFileSync(path.join(WEB, 'sitemap.xml'),
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `  <url><loc>${u}</loc><lastmod>${today}</lastmod></url>`).join('\n')}\n</urlset>\n`);
  fs.writeFileSync(path.join(WEB, 'robots.txt'),
    `User-agent: *\nAllow: /\nDisallow: /pengaturan/\n\nSitemap: ${SITE_URL}/sitemap.xml\n`);
  console.log(`SEO: beranda + ${info.length} halaman surah, sitemap (${urls.length} alamat), robots.txt untuk ${SITE_URL}`);
}


/* ---------- Halaman legal (syarat Play Store): privasi, syarat, tentang ---------- */

const LEGAL = [
  ['privasi', 'Kebijakan Privasi'],
  ['syarat', 'Syarat & Ketentuan'],
  ['tentang', 'Tentang & Kontak']
];

function legalVal(v) {
  return /^ISI-/.test(String(v || '')) ? '<mark>[isi di site-config.json]</mark>' : esc(v);
}

function legalPageHTML({ slug, title, desc, body }) {
  const url = `${SITE_URL}/${slug}/`;
  return `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="#155b45">
  <title>${esc(title)} | ${esc(SITE_NAME)}</title>
  <meta name="description" content="${esc(desc)}">
  <meta name="robots" content="index, follow">
  <link rel="canonical" href="${url}">
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="icon" href="/icon-192.png" sizes="192x192" type="image/png">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="${esc(SITE_NAME)}">
  <meta property="og:title" content="${esc(title)} | ${esc(SITE_NAME)}">
  <meta property="og:description" content="${esc(desc)}">
  <meta property="og:url" content="${url}">
  <meta property="og:image" content="${SITE_URL}/og-image.png">
  <style>
    :root{--bg:#faf6ea;--fg:#1c2b25;--em:#155b45;--mut:#5a6b63}
    @media (prefers-color-scheme:dark){:root{--bg:#0d1612;--fg:#e8efe9;--em:#4cc39a;--mut:#9fb5aa}}
    *{box-sizing:border-box}
    body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.75 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
    header{background:#155b45;padding:14px 16px}
    header a{color:#f3d98c;text-decoration:none;font-weight:700;font-size:1.1rem}
    main{max-width:760px;margin:0 auto;padding:20px 16px 8px}
    h1{color:var(--em);font-size:1.6rem;line-height:1.3;margin:.2em 0}
    h2{color:var(--em);font-size:1.15rem;margin:1.6em 0 .3em}
    a{color:var(--em)}
    .meta{color:var(--mut);font-size:.9rem}
    ul{padding-left:1.3em}
    mark{background:#ffe08a;color:#000;padding:0 .25em}
    footer{max-width:760px;margin:12px auto 0;padding:16px;color:var(--mut);font-size:.9rem;border-top:1px solid rgba(128,128,128,.3)}
    footer a{margin-right:12px}
  </style>
</head>
<body>
  <header><a href="/">${esc(SITE_NAME)}</a></header>
  <main>
    <h1>${esc(title)}</h1>
    <p class="meta">Terakhir diperbarui: ${esc(LEGAL_CFG.updated)}</p>
${body}
  </main>
  <footer>
    ${LEGAL.map(([s, t]) => `<a href="/${s}/">${esc(t)}</a>`).join('\n    ')}
    <p>&copy; ${esc(SITE_NAME)}</p>
  </footer>
</body>
</html>
`;
}

function generateLegalPages() {
  const c = LEGAL_CFG;
  const dev = legalVal(c.developer);
  const mail = /^ISI-/.test(String(c.email || '')) ? legalVal(c.email) : `<a href="mailto:${esc(c.email)}">${esc(c.email)}</a>`;
  const app = `${esc(SITE_NAME)}${c.appId ? ` (<code>${esc(c.appId)}</code>)` : ''}`;
  const site = `<a href="${SITE_URL}/">${esc(SITE_URL.replace(/^https?:\/\//, ''))}</a>`;
  const contact = `<p>${dev}<br>Email: ${mail}</p>`;

  const pages = [
    {
      slug: 'privasi',
      title: 'Kebijakan Privasi',
      desc: `Kebijakan privasi ${SITE_NAME}: tanpa akun, tanpa iklan, tanpa pelacak, dan tidak mengumpulkan data pribadi.`,
      body: `    <h2>Ringkasan</h2>
    <p>${esc(SITE_NAME)} tidak meminta dan tidak mengumpulkan data pribadi Anda. Tidak ada pendaftaran atau login, tidak ada iklan, dan tidak ada pelacak atau alat analitik di dalam aplikasi maupun situs ini.</p>

    <h2>Cakupan</h2>
    <p>Kebijakan ini berlaku untuk situs web ${site} dan aplikasi Android ${app}, yang dikelola oleh ${dev}.</p>

    <h2>Informasi yang kami kumpulkan</h2>
    <p>Kami tidak mengumpulkan nama, alamat email, nomor telepon, lokasi, kontak, foto, atau data pribadi lainnya.</p>

    <h2>Data yang tersimpan di perangkat Anda</h2>
    <p>Pengaturan tampilan dan bacaan (gaya antarmuka, mode warna, ukuran huruf Arab, tampil atau sembunyikan terjemahan, animasi, putar otomatis, kecepatan audio, dan pengulangan) disimpan secara lokal di penyimpanan peramben atau aplikasi di perangkat Anda. Data ini tidak dikirim ke server kami. Anda dapat menghapusnya kapan saja lewat tombol &ldquo;Atur ulang pengaturan&rdquo; di halaman Pengaturan, atau dengan menghapus data situs atau data aplikasi di perangkat Anda.</p>

    <h2>Log teknis pada hosting</h2>
    <p>Situs ini dilayani oleh penyedia hosting (Vercel). Seperti layanan web pada umumnya, server hosting dapat mencatat log teknis standar, misalnya alamat IP, jenis perangkat atau peramben, serta waktu dan halaman yang diakses, untuk keperluan keamanan dan operasional. Kami tidak menggunakan data tersebut untuk membuat profil pengguna atau untuk iklan.</p>

    <h2>Layanan pihak ketiga</h2>
    <p>Beberapa fitur menghubungkan perangkat Anda ke pihak ketiga, dan alamat IP Anda dapat terlihat oleh mereka:</p>
    <ul>
      <li><strong>Audio murottal</strong> diputar (streaming) dari server pihak ketiga yang alamatnya tercantum pada data ayat, misalnya cdn.alquran.cloud dan cdn.islamic.network. Audio hanya diunduh setelah Anda menekan tombol putar.</li>
      <li><strong>Versi web</strong> memuat pustaka tampilan (Framework7) dari jsDelivr (cdn.jsdelivr.net). Pada aplikasi Android, pustaka ini sudah ada di dalam aplikasi.</li>
      <li><strong>Aplikasi Android</strong> dapat mengambil tafsir dari situs kami (${site}) bila tafsir tidak disertakan di dalam aplikasi.</li>
    </ul>
    <p>Kebijakan privasi masing-masing pihak tersebut berlaku untuk layanan mereka.</p>

    <h2>Izin aplikasi Android</h2>
    <p>Aplikasi hanya memerlukan akses Internet untuk memutar audio dan mengambil tafsir. Aplikasi tidak meminta akses lokasi, kamera, mikrofon, kontak, atau penyimpanan.</p>

    <h2>Cookie</h2>
    <p>Kami tidak menggunakan cookie pelacak.</p>

    <h2>Anak-anak</h2>
    <p>Kami tidak mengumpulkan data pribadi dari siapa pun, termasuk anak-anak.</p>

    <h2>Keamanan</h2>
    <p>Situs dan pengambilan data memakai koneksi terenkripsi (HTTPS).</p>

    <h2>Hak Anda dan penghapusan data</h2>
    <p>Karena tidak ada akun dan tidak ada data pribadi yang kami simpan di server, tidak ada data pribadi yang perlu dihapus. Data lokal dapat Anda hapus sendiri seperti dijelaskan di atas. Jika ada pertanyaan, hubungi kami.</p>

    <h2>Perubahan kebijakan</h2>
    <p>Kebijakan ini dapat diperbarui dari waktu ke waktu. Tanggal pembaruan terakhir tertera di bagian atas halaman ini.</p>

    <h2>Kontak</h2>
    ${contact}`
    },
    {
      slug: 'syarat',
      title: 'Syarat & Ketentuan',
      desc: `Syarat dan ketentuan penggunaan ${SITE_NAME}: tujuan layanan, akurasi konten, hak kekayaan intelektual, dan batas tanggung jawab.`,
      body: `    <h2>Penerimaan syarat</h2>
    <p>Dengan menggunakan situs ${site} dan aplikasi ${app}, Anda menyetujui syarat dan ketentuan ini. Jika tidak setuju, mohon berhenti menggunakan layanan.</p>

    <h2>Tujuan layanan</h2>
    <p>${esc(SITE_NAME)} adalah sarana gratis untuk membaca dan mempelajari Al-Qur'an, dilengkapi terjemahan Bahasa Indonesia, tafsir, dan audio murottal.</p>

    <h2>Akurasi konten</h2>
    <p>Teks Arab, terjemahan, tafsir, dan audio bersumber dari Kementerian Agama Republik Indonesia dan sumber data terbuka pihak ketiga. Kami berupaya menampilkannya dengan benar, namun kesalahan penyalinan atau tampilan tetap mungkin terjadi. Untuk rujukan resmi, gunakan mushaf Al-Qur'an standar dan konsultasikan dengan ulama atau ahli yang berkompeten. Jika menemukan kesalahan, mohon laporkan melalui kontak di bawah.</p>

    <h2>Penggunaan yang diperbolehkan</h2>
    <p>Layanan ini untuk penggunaan pribadi dan non-komersial. Anda tidak diperkenankan mengganggu atau membebani layanan, memakainya untuk tujuan melanggar hukum, atau menggunakan tampilan dan kode kami dengan cara yang menyesatkan.</p>

    <h2>Hak kekayaan intelektual</h2>
    <p>Teks Al-Qur'an, terjemahan, tafsir, dan audio tetap menjadi hak masing-masing pemiliknya. Desain dan kode aplikasi ${esc(SITE_NAME)} dimiliki oleh pengembang, kecuali ditentukan lain. Pustaka sumber terbuka yang dipakai (misalnya Framework7 dan Capacitor) mengikuti lisensinya masing-masing.</p>

    <h2>Layanan pihak ketiga dan ketersediaan</h2>
    <p>Audio dan sebagian sumber data berasal dari pihak ketiga yang dapat berubah atau tidak tersedia sewaktu-waktu. Kami tidak menjamin layanan selalu tersedia tanpa gangguan.</p>

    <h2>Penafian dan batas tanggung jawab</h2>
    <p>Layanan disediakan &ldquo;sebagaimana adanya&rdquo; tanpa jaminan apa pun. Sejauh diizinkan hukum, kami tidak bertanggung jawab atas kerugian yang timbul dari penggunaan layanan atau dari kesalahan konten.</p>

    <h2>Perubahan</h2>
    <p>Syarat ini dapat diperbarui dari waktu ke waktu. Penggunaan layanan setelah pembaruan berarti Anda menyetujui syarat yang baru.</p>

    <h2>Hukum yang berlaku</h2>
    <p>Syarat ini tunduk pada hukum Republik Indonesia.</p>

    <h2>Kontak</h2>
    ${contact}`
    },
    {
      slug: 'tentang',
      title: 'Tentang & Kontak',
      desc: `Tentang ${SITE_NAME}: Al-Qur'an digital ringan dengan terjemahan Indonesia, tafsir, dan audio murottal per ayat. Sumber data dan kontak pengembang.`,
      body: `    <h2>Tentang ${esc(SITE_NAME)}</h2>
    <p>${esc(SITE_NAME)} adalah Al-Qur'an digital yang ringan dan cepat, dirancang agar nyaman dibuka di HP dengan koneksi lambat. Fitur utama: 114 surah lengkap, terjemahan Bahasa Indonesia, tafsir, audio murottal per ayat, tampilan gaya Android atau iOS, mode gelap, dan di aplikasi Android daftar surah serta ayat dapat dibaca tanpa internet.</p>

    <h2>Sumber data</h2>
    <ul>
      <li>Terjemahan dan tafsir Bahasa Indonesia: Kementerian Agama Republik Indonesia (quran.kemenag.go.id), melalui basis data terbuka proyek quran-api (lisensi MIT).</li>
      <li>Teks Arab dan audio murottal (Syekh Mishary Rashid Alafasy): layanan Al Quran Cloud (alquran.cloud) dan mitra distribusinya.</li>
    </ul>

    <h2>Teknologi</h2>
    <p>Tampilan dibangun dengan Framework7 dan dibungkus menjadi aplikasi Android dengan Capacitor.</p>

    <h2>Kontak, saran, dan laporan kesalahan</h2>
    ${contact}
    <p>Jika menemukan kesalahan teks, terjemahan, atau tafsir, sebutkan nomor surah dan ayatnya agar mudah kami periksa.</p>

    <h2>Informasi lain</h2>
    <ul>
      <li><a href="/privasi/">Kebijakan Privasi</a></li>
      <li><a href="/syarat/">Syarat &amp; Ketentuan</a></li>
    </ul>`
    }
  ];

  for (const p of pages) {
    const dir = path.join(WEB, p.slug);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'index.html'), legalPageHTML({ ...p, title: p.title }));
  }
  const todo = ['developer', 'email'].filter((k) => /^ISI-/.test(String(c[k] || '')));
  console.log(`Legal: ${pages.length} halaman (${pages.map((p) => '/' + p.slug + '/').join(', ')})`);
  if (todo.length) console.log(`PERINGATAN: isi ${todo.join(' dan ')} di site-config.json sebelum dipakai untuk Play Store.`);
}

function main() {
  const raw = fs.readFileSync(SRC, 'utf8');
  const surahs = findSurahArray(JSON.parse(raw));
  if (!surahs || surahs.length !== 114) {
    throw new Error('Diharapkan 114 surah, ditemukan: ' + (surahs ? surahs.length : 'tidak ada'));
  }

  for (const d of ['surah', 'tafsir']) {
    fs.rmSync(path.join(OUT, d), { recursive: true, force: true });
    fs.mkdirSync(path.join(OUT, d), { recursive: true });
  }

  const versesKey = findVersesKey(surahs[0]);
  const list = [];
  const movedFields = new Set();
  let totalVerses = 0, surahBytes = 0, tafsirBytes = 0, maxSurah = [0, 0];

  surahs.forEach((s, i) => {
    const n = i + 1;
    if (Number.isInteger(s.number) && s.number !== n) {
      throw new Error(`Nomor surah tidak sesuai urutan di indeks ${i}: ${s.number}`);
    }
    const verses = s[versesKey];
    totalVerses += verses.length;

    // Tafsir per-ayat dipisah (besar, dan hanya dibutuhkan saat pengguna membuka tafsir).
    const tafsirList = verses.map((v) => (v && 'tafsir' in v ? v.tafsir : null));
    const slimVerses = verses.map((v) => {
      if (!v || !('tafsir' in v)) return v;
      const { tafsir, ...rest } = v;
      return rest;
    });
    const slim = { ...s, [versesKey]: slimVerses };

    const surahBody = JSON.stringify(slim);
    const tafsirBody = JSON.stringify(tafsirList);
    fs.writeFileSync(path.join(OUT, 'surah', n + '.json'), surahBody);
    fs.writeFileSync(path.join(OUT, 'tafsir', n + '.json'), tafsirBody);
    surahBytes += Buffer.byteLength(surahBody);
    tafsirBytes += Buffer.byteLength(tafsirBody);
    if (Buffer.byteLength(surahBody) > maxSurah[1]) maxSurah = [n, Buffer.byteLength(surahBody)];

    const meta = {};
    for (const k of Object.keys(s)) {
      if (k === versesKey) continue;
      if (size(s[k]) > MAX_META_BYTES) { movedFields.add(k); continue; }
      meta[k] = s[k];
    }
    if (!('verseCount' in meta)) meta.verseCount = verses.length;
    list.push(meta);
  });

  const listBody = JSON.stringify(list);
  fs.writeFileSync(path.join(OUT, 'surah-list.json'), listBody);

  // Verifikasi tanpa kehilangan data: gabungkan kembali dan bandingkan dengan sumber.
  surahs.forEach((s, i) => {
    const n = i + 1;
    const back = JSON.parse(fs.readFileSync(path.join(OUT, 'surah', n + '.json'), 'utf8'));
    const tf = JSON.parse(fs.readFileSync(path.join(OUT, 'tafsir', n + '.json'), 'utf8'));
    back[versesKey] = back[versesKey].map((v, k) => (tf[k] === null ? v : { ...v, tafsir: tf[k] }));
    if (!deepEqual(back, s)) throw new Error('Data surah ' + n + ' tidak identik dengan sumber setelah digabung');
  });

  const kb = (b) => (b / 1024).toFixed(1) + ' KB';
  console.log('Field ayat terdeteksi     :', versesKey);
  console.log('Field meta ke file surah  :', [...movedFields].join(', ') || '(tidak ada)');
  console.log('Total ayat                :', totalVerses);
  console.log('Sumber quran.json         :', kb(Buffer.byteLength(raw)));
  console.log('surah-list.json           :', kb(Buffer.byteLength(listBody)), '(diunduh di halaman utama)');
  console.log('surah/N.json (total)      :', kb(surahBytes), '| terbesar: surah', maxSurah[0], kb(maxSurah[1]));
  console.log('tafsir/N.json (total)     :', kb(tafsirBytes), '(hanya diunduh saat tafsir dibuka)');
  console.log('OK: 114 surah, gabungan identik dengan sumber.');
  generateSeo(surahs, versesKey);
  generateLegalPages();
}
main();
