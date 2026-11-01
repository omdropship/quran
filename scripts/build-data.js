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
}
main();
