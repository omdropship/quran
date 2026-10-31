'use strict';

const LIST_URL = '/data/surah-list.json';
const surahUrl = (n) => `/data/surah/${n}.json`;
const TOTAL = 114;
const CHUNK = 20;
const APP_TITLE = "Al-Qur'an Digital";

let app;
let surahList = [];
let rowsHTML = [];
let searchKeys = [];
let lastListHTML = null;
let listPromise = null;
const surahCache = new Map();
const surahPending = new Map();

/* ---------- util ---------- */

function escapeHTML(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
  })[c]);
}

// Nilai bisa string atau objek {id, en}; selalu kembalikan string.
function txt(v) {
  if (typeof v === 'string') return v;
  if (v && typeof v === 'object') {
    if (typeof v.id === 'string') return v.id;
    if (typeof v.en === 'string') return v.en;
  }
  return '';
}

function norm(v) {
  return String(v ?? '').toLowerCase().normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\u0600-\u06ff]/g, '');
}

const latinName = (s, n) => txt(s.name?.transliteration) || `Surah ${n ?? s.number}`;
const arabicName = (s) => (typeof s.name?.short === 'string' ? s.name.short : '');
const translationOf = (s) => txt(s.translation) || txt(s.name?.translation);
const countOf = (s) => s.numberOfVerses ?? s.verseCount ?? 0;

function versesOf(d) {
  if (Array.isArray(d?.verses)) return d.verses;
  for (const k of Object.keys(d || {})) {
    const v = d[k];
    if (Array.isArray(v) && v.length && typeof v[0] === 'object') return v;
  }
  return [];
}

/* ---------- data (dimuat sesuai kebutuhan, di-cache di memori) ---------- */

async function fetchJSON(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Data gagal dimuat (${r.status})`);
  return r.json();
}

function rowHTML(s, n) {
  return `
    <li>
      <a href="/surah/${n}/" class="item-link item-content">
        <div class="item-media">
          <div style="width:42px;height:42px;display:flex;align-items:center;justify-content:center;background:#e8f1eb;color:#155b45;border-radius:12px;font-weight:bold">${n}</div>
        </div>
        <div class="item-inner">
          <div class="item-title-row">
            <div class="item-title">${escapeHTML(latinName(s, n))}</div>
            <div class="item-after" style="font-size:20px;color:#155b45">${escapeHTML(arabicName(s))}</div>
          </div>
          <div class="item-subtitle">${escapeHTML(translationOf(s))} · ${escapeHTML(countOf(s))} Ayat</div>
        </div>
      </a>
    </li>`;
}

function loadList() {
  if (!listPromise) {
    listPromise = fetchJSON(LIST_URL).then((json) => {
      const arr = Array.isArray(json) ? json : (json?.data || json?.surahs);
      if (!Array.isArray(arr) || !arr.length) throw new Error('Data surah tidak ditemukan.');
      surahList = arr;
      // Bangun HTML baris dan kunci pencarian sekali saja.
      rowsHTML = arr.map((s, i) => rowHTML(s, i + 1));
      searchKeys = arr.map((s, i) =>
        [norm(latinName(s, i + 1)), arabicName(s), i + 1, norm(translationOf(s))].join('|'));
      return arr;
    }).catch((e) => { listPromise = null; throw e; });
  }
  return listPromise;
}

function getSurah(n) {
  if (surahCache.has(n)) return Promise.resolve(surahCache.get(n));
  if (surahPending.has(n)) return surahPending.get(n);
  const p = fetchJSON(surahUrl(n)).then((data) => {
    const entry = { data, verses: versesOf(data) };
    surahCache.set(n, entry);
    return entry;
  }).finally(() => surahPending.delete(n));
  surahPending.set(n, p);
  return p;
}

/* ---------- tampilan ---------- */

function renderSurahList(keyword = '') {
  const list = document.getElementById('surah-list');
  if (!list) return;
  const key = norm(keyword);
  let html;
  if (!key) {
    html = rowsHTML.join('');
  } else {
    const out = [];
    for (let i = 0; i < searchKeys.length; i++) {
      if (searchKeys[i].includes(key)) out.push(rowsHTML[i]);
    }
    html = out.join('') ||
      '<li><div class="item-content"><div class="item-inner">Surah tidak ditemukan.</div></div></li>';
  }
  if (html !== lastListHTML) { list.innerHTML = html; lastListHTML = html; }
}

function verseHTML(a, i) {
  const num = (a.number && typeof a.number === 'object') ? a.number.inSurah : a.number;
  const number = num ?? i + 1;
  const arabic = a.text?.arab ?? txt(a.text);
  const translation = a.translation?.id ?? txt(a.translation);
  return `
    <div class="card card-outline verse-card" style="border-radius:14px">
      <div class="card-content card-content-padding">
        <span class="badge color-green">Ayat ${escapeHTML(number)}</span>
        <div style="font-size:28px;line-height:2.1;text-align:right;direction:rtl;margin:18px 0">${escapeHTML(arabic)}</div>
        <div>${escapeHTML(translation)}</div>
      </div>
    </div>`;
}

const BACK_ICON = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>';

function shellPage(title, body, extra = '') {
  return `
    <div class="page" data-name="surah" ${extra}>
      <div class="navbar">
        <div class="navbar-inner">
          <div class="left"><a href="/" class="link back" data-force="true" aria-label="Kembali">${BACK_ICON}</a></div>
          <div class="title">${escapeHTML(title)}</div>
        </div>
      </div>
      <div class="page-content">${body}</div>
    </div>`;
}

function messagePage(title, message) {
  return shellPage(title, `<div class="block text-align-center">${escapeHTML(message)}</div>`);
}

function surahPage(n, entry) {
  const s = entry.data;
  const verses = entry.verses;
  const name = latinName(s, n);
  const first = verses.slice(0, CHUNK).map(verseHTML).join('');
  const more = verses.length > CHUNK;

  const body = `
    <div class="block">
      <div class="card" style="background:#155b45;color:white;border-radius:18px">
        <div class="card-content card-content-padding text-align-center">
          <div style="font-size:30px;color:#f3d98c">${escapeHTML(arabicName(s))}</div>
          <h2>${escapeHTML(name)}</h2>
          <p>${escapeHTML(translationOf(s))}</p>
          <p>${verses.length} Ayat</p>
        </div>
      </div>
    </div>

    ${n !== 1 && n !== 9
      ? '<div class="block text-align-center" style="font-size:26px;direction:rtl">بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</div>'
      : ''}

    <div class="verses">${first || '<div class="block">Ayat belum tersedia.</div>'}</div>
    ${more ? '<div class="verses-sentinel block text-align-center text-color-gray">Memuat ayat...</div>' : ''}

    <div class="block">
      <div class="row">
        <div class="col">
          ${n > 1 ? `<a href="/surah/${n - 1}/" class="button button-outline">Sebelumnya</a>` : ''}
        </div>
        <div class="col">
          ${n < TOTAL ? `<a href="/surah/${n + 1}/" class="button button-fill" style="background:#155b45">Berikutnya</a>` : ''}
        </div>
      </div>
    </div>`;

  return shellPage(name, body, `data-title="${escapeHTML(name)} - ${escapeHTML(APP_TITLE)}"`);
}

/* ---------- halaman ---------- */

async function initHome(e, page) {
  const err = page.el.querySelector('#home-error');
  try {
    await loadList();
  } catch (error) {
    console.error(error);
    if (err) err.textContent = error.message;
    const list = page.el.querySelector('#surah-list');
    if (list) list.innerHTML =
      '<li><div class="item-content"><div class="item-inner">Gagal memuat daftar surah. Periksa koneksi lalu muat ulang.</div></div></li>';
    return;
  }
  const total = page.el.querySelector('#surah-total');
  if (total) total.textContent = `${surahList.length} Surah`;
  renderSurahList();

  const search = page.el.querySelector('#surah-search');
  if (search) {
    let t;
    const run = () => { clearTimeout(t); t = setTimeout(() => renderSurahList(search.value), 120); };
    search.addEventListener('input', run);
    search.addEventListener('search', run);
  }
}

function initSurahPage(page) {
  const n = Number(page.route.params.number);
  const entry = surahCache.get(n);
  const sentinel = page.el.querySelector('.verses-sentinel');

  if (entry && sentinel && 'IntersectionObserver' in window) {
    const box = page.el.querySelector('.verses');
    const root = page.el.querySelector('.page-content');
    let next = CHUNK;
    const io = new IntersectionObserver((items) => {
      if (!items[0].isIntersecting) return;
      box.insertAdjacentHTML('beforeend',
        entry.verses.slice(next, next + CHUNK).map((a, i) => verseHTML(a, next + i)).join(''));
      next += CHUNK;
      if (next >= entry.verses.length) { io.disconnect(); sentinel.remove(); return; }
      io.unobserve(sentinel); io.observe(sentinel); // cek ulang bila masih terlihat
    }, { root, rootMargin: '800px 0px' });
    io.observe(sentinel);
    page.el.__io = io;
  } else if (entry && sentinel) {
    // Tanpa IntersectionObserver: tampilkan sisa ayat sekaligus.
    page.el.querySelector('.verses').insertAdjacentHTML('beforeend',
      entry.verses.slice(CHUNK).map((a, i) => verseHTML(a, CHUNK + i)).join(''));
    sentinel.remove();
  }

  // Prefetch surah berikutnya saat idle, kecuali hemat data / koneksi sangat lambat.
  const c = navigator.connection;
  const slow = c && (c.saveData || /(^|-)2g$/.test(c.effectiveType || ''));
  if (!slow && n < TOTAL) {
    const idle = window.requestIdleCallback || ((f) => setTimeout(f, 1500));
    idle(() => getSurah(n + 1).catch(() => {}));
  }
}

function surahRoute({ to, resolve, router }) {
  const n = Number(to.params.number);
  if (!Number.isInteger(n) || n < 1 || n > TOTAL) {
    resolve({ content: messagePage('Surah tidak ditemukan', 'Surah tidak ditemukan.') });
    return;
  }
  const pre = (router && router.app && router.app.preloader) || (app && app.preloader);
  if (pre) pre.show();
  getSurah(n)
    .then((entry) => resolve({ content: surahPage(n, entry) }))
    .catch((error) => {
      console.error(error);
      resolve({ content: messagePage('Gagal memuat', 'Surah gagal dimuat. Periksa koneksi lalu coba lagi.') });
    })
    .finally(() => { if (pre) pre.hide(); });
}

function initApp() {
  app = new Framework7({
    el: '#app',
    name: APP_TITLE,
    theme: 'auto',
    init: false,
    view: {
      browserHistory: true,
      browserHistorySeparator: ''
    },
    routes: [
      {
        path: '/',
        content: document.getElementById('home-tpl').innerHTML,
        keepAlive: true,
        on: { pageInit: initHome }
      },
      {
        path: '/surah/:number/',
        async: surahRoute,
        on: {
          pageInit: (e, page) => initSurahPage(page),
          pageBeforeRemove: (e, page) => { if (page.el.__io) page.el.__io.disconnect(); }
        }
      },
      {
        path: '(.*)',
        content: messagePage('Tidak ditemukan', 'Halaman tidak ditemukan.')
      }
    ]
  });

  app.on('pageBeforeIn', (page) => {
    document.title = page.el.dataset.title || APP_TITLE;
  });
  app.on('pageInit', () => {
    const splash = document.getElementById('splash');
    if (splash) splash.remove();
  });

  app.init();
}

// Mulai unduh daftar surah secepat mungkin, paralel dengan inisialisasi framework.
loadList().catch(() => {});

document.addEventListener('DOMContentLoaded', initApp);
