'use strict';

const LIST_URL = '/data/surah-list.json';
const surahUrl = (n) => `/data/surah/${n}.json`;
const TOTAL = 114;
const CHUNK = 20;
const APP_TITLE = "Al-Qur'an Digital";
const GEAR = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>';

let app;
let surahList = [];
let rowsHTML = [];
let searchKeys = [];
let lastListHTML = null;
let listPromise = null;
const surahCache = new Map();
const surahPending = new Map();

/* ---------- pengaturan pengguna (disimpan di perangkat) ---------- */

const PREF_KEY = 'qd-prefs-v1';
const DEFAULTS = { theme: 'auto', dark: 'auto', arab: 28, tr: true, anim: true };
const AR_MIN = 22, AR_MAX = 48;

function loadPrefs() {
  let p = {};
  try { p = JSON.parse(localStorage.getItem(PREF_KEY) || '{}') || {}; } catch (e) { p = {}; }
  const out = { ...DEFAULTS, ...p };
  if (!['auto', 'ios', 'md'].includes(out.theme)) out.theme = 'auto';
  if (!['auto', 'light', 'dark'].includes(out.dark)) out.dark = 'auto';
  out.arab = Math.min(AR_MAX, Math.max(AR_MIN, Number(out.arab) || DEFAULTS.arab));
  out.tr = out.tr !== false;
  out.anim = ('anim' in p) ? p.anim !== false : !(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  return out;
}
let prefs = loadPrefs();
function savePrefs() { try { localStorage.setItem(PREF_KEY, JSON.stringify(prefs)); } catch (e) { /* abaikan */ } }

// Gaya antarmuka: hanya iOS atau Material (Android), tidak pernah Aurora.
function resolveTheme(p) {
  if (p === 'ios' || p === 'md') return p;
  const ua = navigator.userAgent || '';
  const ipad = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
  return (/iPhone|iPad|iPod/.test(ua) || ipad) ? 'ios' : 'md';
}

function applyAppearance() {
  const root = document.documentElement;
  const mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  const dark = prefs.dark === 'dark' || (prefs.dark === 'auto' && !!(mq && mq.matches));
  root.classList.toggle('theme-dark', dark);
  root.classList.toggle('hide-tr', !prefs.tr);
  root.style.setProperty('--ar-size', prefs.arab + 'px');
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', dark ? '#0f3d2f' : '#155b45');
}
applyAppearance();
if (window.matchMedia) {
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  const onChange = () => { if (prefs.dark === 'auto') applyAppearance(); };
  if (mq.addEventListener) mq.addEventListener('change', onChange);
}

/* ---------- util ---------- */

function escapeHTML(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
  })[c]);
}

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
        <div class="item-media"><div class="num">${n}</div></div>
        <div class="item-inner">
          <div class="item-title-row">
            <div class="item-title">${escapeHTML(latinName(s, n))}</div>
            <div class="item-after ar-text">${escapeHTML(arabicName(s))}</div>
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
      '<li><div class="item-content"><div class="item-inner text-align-center">Surah tidak ditemukan.</div></div></li>';
  }
  if (html !== lastListHTML) { list.innerHTML = html; lastListHTML = html; }
}

function verseHTML(a, i) {
  const num = (a.number && typeof a.number === 'object') ? a.number.inSurah : a.number;
  const number = num ?? i + 1;
  const arabic = a.text?.arab ?? txt(a.text);
  const translation = a.translation?.id ?? txt(a.translation);
  return `
    <div class="card card-outline verse-card">
      <div class="card-content card-content-padding">
        <span class="badge color-green">Ayat ${escapeHTML(number)}</span>
        <div class="verse-ar ar-text">${escapeHTML(arabic)}</div>
        <div class="verse-tr">${escapeHTML(translation)}</div>
      </div>
    </div>`;
}

// direct = halaman dibuka langsung lewat URL (belum ada riwayat), tombol kembali dipaksa ke beranda.
function navbarHTML(title, direct, withSettings) {
  return `
    <div class="navbar">
      <div class="navbar-bg"></div>
      <div class="navbar-inner">
        <div class="left">
          <a href="/" class="link back"${direct ? ' data-force="true"' : ''}>
            <i class="icon icon-back"></i><span class="if-not-md">Kembali</span>
          </a>
        </div>
        <div class="title">${escapeHTML(title)}</div>
        ${withSettings ? `<div class="right"><a href="/pengaturan/" class="link icon-only" aria-label="Pengaturan">${GEAR}</a></div>` : ''}
      </div>
    </div>`;
}

function messagePage(title, message, direct) {
  return `
    <div class="page" data-name="message">
      ${navbarHTML(title, direct, false)}
      <div class="page-content"><div class="block text-align-center">${escapeHTML(message)}</div></div>
    </div>`;
}

function surahPage(n, entry, direct) {
  const s = entry.data;
  const verses = entry.verses;
  const name = latinName(s, n);
  const first = verses.slice(0, CHUNK).map(verseHTML).join('');
  const more = verses.length > CHUNK;

  return `
    <div class="page" data-name="surah" data-title="${escapeHTML(name)} - ${escapeHTML(APP_TITLE)}">
      ${navbarHTML(name, direct, true)}
      <div class="toolbar toolbar-bottom">
        <div class="toolbar-inner">
          ${n > 1 ? `<a href="/surah/${n - 1}/" class="link">Sebelumnya</a>` : '<a class="link disabled">Sebelumnya</a>'}
          ${n < TOTAL ? `<a href="/surah/${n + 1}/" class="link">Berikutnya</a>` : '<a class="link disabled">Berikutnya</a>'}
        </div>
      </div>
      <div class="page-content">
        <div class="block">
          <div class="card hero" style="margin:0">
            <div class="card-content card-content-padding text-align-center">
              <div class="gold ar-text" style="font-size:30px;line-height:2">${escapeHTML(arabicName(s))}</div>
              <h2 style="margin:4px 0">${escapeHTML(name)}</h2>
              <p style="margin:4px 0">${escapeHTML(translationOf(s))}</p>
              <p style="margin:4px 0">${verses.length} Ayat</p>
            </div>
          </div>
        </div>

        ${n !== 1 && n !== 9
          ? '<div class="block text-align-center bismillah ar-text">بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</div>'
          : ''}

        <div class="verses">${first || '<div class="block">Ayat belum tersedia.</div>'}</div>
        ${more ? '<div class="verses-sentinel block text-align-center text-color-gray">Memuat ayat...</div>' : ''}
      </div>
    </div>`;
}

function radioItem(name, value, label, current) {
  return `
    <li>
      <label class="item-radio item-radio-icon-start item-content">
        <input type="radio" name="${name}" value="${value}"${current === value ? ' checked' : ''}>
        <i class="icon icon-radio"></i>
        <div class="item-inner"><div class="item-title">${label}</div></div>
      </label>
    </li>`;
}

function toggleItem(id, label, on) {
  return `
    <li>
      <div class="item-content">
        <div class="item-inner">
          <div class="item-title">${label}</div>
          <div class="item-after"><label class="toggle"><input type="checkbox" id="${id}"${on ? ' checked' : ''}><span class="toggle-icon"></span></label></div>
        </div>
      </div>
    </li>`;
}

function settingsPage(direct) {
  return `
    <div class="page" data-name="settings" data-title="Pengaturan - ${escapeHTML(APP_TITLE)}">
      ${navbarHTML('Pengaturan', direct, false)}
      <div class="page-content">
        <div class="block-title">Gaya antarmuka</div>
        <div class="list inset"><ul>
          ${radioItem('theme', 'auto', 'Otomatis (sesuai perangkat)', prefs.theme)}
          ${radioItem('theme', 'md', 'Android (Material Design)', prefs.theme)}
          ${radioItem('theme', 'ios', 'iOS', prefs.theme)}
        </ul></div>
        <div class="block-footer">Halaman dimuat ulang otomatis saat gaya diganti.</div>

        <div class="block-title">Mode warna</div>
        <div class="list inset"><ul>
          ${radioItem('dark', 'auto', 'Otomatis (sesuai perangkat)', prefs.dark)}
          ${radioItem('dark', 'light', 'Terang', prefs.dark)}
          ${radioItem('dark', 'dark', 'Gelap', prefs.dark)}
        </ul></div>

        <div class="block-title">Bacaan</div>
        <div class="list inset"><ul>
          <li>
            <div class="item-content">
              <div class="item-inner">
                <div class="item-title">Ukuran huruf Arab</div>
                <div class="item-after" id="ar-size-val">${prefs.arab}</div>
              </div>
            </div>
          </li>
          <li>
            <div class="item-content item-input">
              <div class="item-inner"><div class="item-input-wrap"><div class="range-slider" id="ar-range"></div></div></div>
            </div>
          </li>
          <li>
            <div class="item-content">
              <div class="item-inner"><div class="verse-ar ar-text" id="ar-preview" style="width:100%;margin:8px 0">ٱلْحَمْدُ لِلَّهِ رَبِّ ٱلْعَـٰلَمِينَ</div></div>
            </div>
          </li>
          ${toggleItem('opt-tr', 'Tampilkan terjemahan', prefs.tr)}
          ${toggleItem('opt-anim', 'Animasi perpindahan halaman', prefs.anim)}
        </ul></div>
        <div class="block-footer">Matikan animasi bila terasa berat di HP lama.</div>

        <div class="block"><a href="#" class="button button-outline" id="reset-prefs">Atur ulang pengaturan</a></div>
      </div>
    </div>`;
}

/* ---------- halaman ---------- */

async function initHome(e, page) {
  const err = page.el.querySelector('#home-error');

  // Searchbar bawaan Framework7; pencarian dikerjakan sendiri (customSearch) agar ringan.
  const sbEl = page.el.querySelector('.searchbar');
  if (sbEl && app.searchbar) {
    let t;
    const run = (q) => { clearTimeout(t); t = setTimeout(() => renderSurahList(q || ''), 120); };
    app.searchbar.create({
      el: sbEl,
      customSearch: true,
      on: {
        search(sb, query) { run(query); },
        clear() { run(''); },
        disable() { run(''); }
      }
    });
  }

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
      io.unobserve(sentinel); io.observe(sentinel);
    }, { root, rootMargin: '800px 0px' });
    io.observe(sentinel);
    page.el.__io = io;
  } else if (entry && sentinel) {
    page.el.querySelector('.verses').insertAdjacentHTML('beforeend',
      entry.verses.slice(CHUNK).map((a, i) => verseHTML(a, CHUNK + i)).join(''));
    sentinel.remove();
  }

  const c = navigator.connection;
  const slow = c && (c.saveData || /(^|-)2g$/.test(c.effectiveType || ''));
  if (!slow && n < TOTAL) {
    const idle = window.requestIdleCallback || ((f) => setTimeout(f, 1500));
    idle(() => getSurah(n + 1).catch(() => {}));
  }
}

function initSettings(page) {
  const el = page.el;

  el.querySelectorAll('input[name="theme"]').forEach((r) => r.addEventListener('change', () => {
    if (!r.checked) return;
    prefs.theme = r.value; savePrefs();
    location.reload(); // gaya iOS/Material ditentukan saat Framework7 dibuat
  }));

  el.querySelectorAll('input[name="dark"]').forEach((r) => r.addEventListener('change', () => {
    if (!r.checked) return;
    prefs.dark = r.value; savePrefs(); applyAppearance();
  }));

  const val = el.querySelector('#ar-size-val');
  const preview = el.querySelector('#ar-preview');
  if (app.range) {
    app.range.create({
      el: el.querySelector('#ar-range'),
      min: AR_MIN, max: AR_MAX, step: 2, value: prefs.arab,
      on: {
        change(range, v) {
          const size = Math.min(AR_MAX, Math.max(AR_MIN, Number(v) || prefs.arab));
          prefs.arab = size; savePrefs(); applyAppearance();
          if (val) val.textContent = size;
        }
      }
    });
  }
  if (preview) preview.style.fontSize = 'var(--ar-size)';

  const tr = el.querySelector('#opt-tr');
  if (tr) tr.addEventListener('change', () => { prefs.tr = tr.checked; savePrefs(); applyAppearance(); });

  const anim = el.querySelector('#opt-anim');
  if (anim) anim.addEventListener('change', () => {
    prefs.anim = anim.checked; savePrefs();
    try { app.views.main.router.params.animate = prefs.anim; } catch (e) { /* berlaku setelah muat ulang */ }
  });

  const reset = el.querySelector('#reset-prefs');
  if (reset) reset.addEventListener('click', (ev) => {
    ev.preventDefault();
    try { localStorage.removeItem(PREF_KEY); } catch (e) { /* abaikan */ }
    location.reload();
  });
}

/* ---------- rute ---------- */

const isDirect = (router) => !router || !router.history || router.history.length === 0;

function surahRoute({ to, resolve, router }) {
  const direct = isDirect(router);
  const n = Number(to.params.number);
  if (!Number.isInteger(n) || n < 1 || n > TOTAL) {
    resolve({ content: messagePage('Surah tidak ditemukan', 'Surah tidak ditemukan.', direct) });
    return;
  }
  const pre = (router && router.app && router.app.preloader) || (app && app.preloader);
  if (pre) pre.show();
  getSurah(n)
    .then((entry) => resolve({ content: surahPage(n, entry, direct) }))
    .catch((error) => {
      console.error(error);
      resolve({ content: messagePage('Gagal memuat', 'Surah gagal dimuat. Periksa koneksi lalu coba lagi.', direct) });
    })
    .finally(() => { if (pre) pre.hide(); });
}

function initApp() {
  app = new Framework7({
    el: '#app',
    name: APP_TITLE,
    theme: resolveTheme(prefs.theme),
    darkMode: false, // mode gelap dikelola sendiri (lihat applyAppearance)
    init: false,
    view: {
      browserHistory: true,
      browserHistorySeparator: '',
      animate: prefs.anim
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
        path: '/pengaturan/',
        async({ resolve, router }) { resolve({ content: settingsPage(isDirect(router)) }); },
        on: { pageInit: (e, page) => initSettings(page) }
      },
      {
        path: '(.*)',
        async({ resolve, router }) { resolve({ content: messagePage('Tidak ditemukan', 'Halaman tidak ditemukan.', isDirect(router)) }); }
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
