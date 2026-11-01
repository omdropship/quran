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
const SITE_NAME = process.env.SITE_NAME || 'AyatNusa';
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
  const urls = [SITE_URL + '/', ...info.map((x) => `${SITE_URL}/surah/${x.n}/`)];
  fs.writeFileSync(path.join(WEB, 'sitemap.xml'),
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `  <url><loc>${u}</loc><lastmod>${today}</lastmod></url>`).join('\n')}\n</urlset>\n`);
  fs.writeFileSync(path.join(WEB, 'robots.txt'),
    `User-agent: *\nAllow: /\nDisallow: /pengaturan/\n\nSitemap: ${SITE_URL}/sitemap.xml\n`);
  console.log(`SEO: beranda + ${info.length} halaman surah, sitemap (${urls.length} alamat), robots.txt untuk ${SITE_URL}`);
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
}
main();
