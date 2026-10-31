#!/usr/bin/env node
/**
 * Memecah data/quran.json menjadi:
 *   website/data/surah-list.json   -> metadata ringan 114 surah
 *   website/data/surah/N.json      -> objek surah LENGKAP (meta + semua ayat, tanpa kehilangan field)
 * Tidak mengasumsikan nama field: field ayat dideteksi (array berisi objek),
 * field meta "berat" (>MAX_META_BYTES saat di-serialize, mis. tafsir surah) hanya ada di N.json.
 * Sumber (data/quran.json) tidak pernah diubah. Tanpa dependensi, hanya Node bawaan.
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
  const cands = Object.keys(surah).filter(
    (k) => Array.isArray(surah[k]) && surah[k].length > 0 && surah[k].every(isObj)
  );
  if (!cands.length) throw new Error('Tidak ada field array-objek (ayat) pada surah');
  return cands.sort((a, b) => surah[b].length - surah[a].length)[0];
}

function main() {
  const raw = fs.readFileSync(SRC, 'utf8');
  const root = JSON.parse(raw);
  const surahs = findSurahArray(root);
  if (!surahs || surahs.length !== 114) {
    throw new Error('Diharapkan 114 surah, ditemukan: ' + (surahs ? surahs.length : 'tidak ada'));
  }

  fs.rmSync(path.join(OUT, 'surah'), { recursive: true, force: true });
  fs.mkdirSync(path.join(OUT, 'surah'), { recursive: true });

  const versesKey = findVersesKey(surahs[0]);
  const list = [];
  const movedFields = new Set();
  let totalVerses = 0, detailBytes = 0;

  surahs.forEach((s, i) => {
    const n = i + 1; // urutan array = nomor surah (diverifikasi di bawah bila field nomor ada)
    for (const k of ['number', 'sequence', 'nomor']) {
      if (Number.isInteger(s[k]) && k === 'number' && s[k] !== n) {
        throw new Error(`Nomor surah tidak sesuai urutan di indeks ${i}: ${s[k]}`);
      }
    }
    const meta = {};
    for (const k of Object.keys(s)) {
      if (k === versesKey) continue;
      if (size(s[k]) > MAX_META_BYTES) { movedFields.add(k); continue; }
      meta[k] = s[k];
    }
    if (!('verseCount' in meta)) meta.verseCount = s[versesKey].length;
    list.push(meta);
    totalVerses += s[versesKey].length;
    const body = JSON.stringify(s);
    detailBytes += Buffer.byteLength(body);
    fs.writeFileSync(path.join(OUT, 'surah', n + '.json'), body);
  });

  const listBody = JSON.stringify(list);
  fs.writeFileSync(path.join(OUT, 'surah-list.json'), listBody);

  // Verifikasi lossless: ayat per surah dan total sama dengan sumber
  surahs.forEach((s, i) => {
    const back = JSON.parse(fs.readFileSync(path.join(OUT, 'surah', (i + 1) + '.json'), 'utf8'));
    if (JSON.stringify(back) !== JSON.stringify(s)) throw new Error('Data surah ' + (i + 1) + ' tidak identik dengan sumber');
  });

  const kb = (b) => (b / 1024).toFixed(1) + ' KB';
  console.log('Field ayat terdeteksi :', versesKey);
  console.log('Field meta ke detail  :', [...movedFields].join(', ') || '(tidak ada)');
  console.log('Total ayat            :', totalVerses);
  console.log('Sumber quran.json     :', kb(Buffer.byteLength(raw)));
  console.log('surah-list.json       :', kb(Buffer.byteLength(listBody)));
  console.log('surah/N.json (total)  :', kb(detailBytes));
  console.log('OK: 114 surah, identik dengan sumber.');
}
main();
