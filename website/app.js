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
const DEFAULTS = { theme: 'auto', dark: 'auto', arab: 28, tr: true, anim: true, autonext: true, autosurah: true, speed: 1, repeat: 'off' };
const AR_MIN = 22, AR_MAX = 48;

function loadPrefs() {
  let p = {};
  try { p = JSON.parse(localStorage.getItem(PREF_KEY) || '{}') || {}; } catch (e) { p = {}; }
  const out = { ...DEFAULTS, ...p };
  if (!['auto', 'ios', 'md'].includes(out.theme)) out.theme = 'auto';
  if (!['auto', 'light', 'dark'].includes(out.dark)) out.dark = 'auto';
  out.arab = Math.min(AR_MAX, Math.max(AR_MIN, Number(out.arab) || DEFAULTS.arab));
  out.tr = out.tr !== false;
  out.autonext = out.autonext !== false;
  out.autosurah = out.autosurah !== false;
  out.speed = [0.75, 1, 1.25, 1.5, 2].includes(Number(out.speed)) ? Number(out.speed) : 1;
  if (!['off', 'x3', 'loop'].includes(out.repeat)) out.repeat = 'off';
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
          <div class="item-subtitle">${escapeHTML(translationOf(s))} · ${escapeHTML(countOf(s))} Ayat${txt(s.revelation) ? ' · ' + escapeHTML(txt(s.revelation)) : ''}</div>
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

/* ---------- tafsir (diunduh hanya saat tombol Tafsir ditekan) ---------- */

const tafsirCache = new Map();
// Pada aplikasi Android, tafsir yang tidak dibungkus diambil dari situs (alamat disuntikkan saat build).
const REMOTE = (typeof window !== 'undefined' && window.QURAN_REMOTE) ? String(window.QURAN_REMOTE).replace(/\/$/, '') : '';

function getTafsir(n) {
  if (tafsirCache.has(n)) return Promise.resolve(tafsirCache.get(n));
  const path = `/data/tafsir/${n}.json`;
  return fetchJSON(path).catch((e) => {
    if (!REMOTE) throw e;
    return fetchJSON(REMOTE + path);
  }).then((arr) => {
    if (!Array.isArray(arr)) throw new Error('Format tafsir tidak dikenal');
    tafsirCache.set(n, arr);
    return arr;
  });
}

function paragraphs(str) {
  return String(str || '').split(/\n{2,}/).map((t) => t.trim()).filter(Boolean)
    .map((t) => `<p>${escapeHTML(t).replace(/\n/g, '<br>')}</p>`).join('');
}

function tafsirPopupHTML(n, idx, entry, t) {
  const v = entry.verses[idx];
  const src = (t && typeof t === 'object' && t.id) ? t.id : t;
  const short = src && typeof src.short === 'string' ? src.short : '';
  const long = src && typeof src.long === 'string' ? src.long : '';
  const num = (v.number && typeof v.number === 'object') ? v.number.inSurah : (v.number ?? idx + 1);
  const arabic = String(v.text?.arab ?? txt(v.text)).replace(/\ufeff/g, '');
  return `
    <div class="popup">
      <div class="page">
        <div class="navbar">
          <div class="navbar-bg"></div>
          <div class="navbar-inner">
            <div class="title">${escapeHTML(latinName(entry.data, n))} : ${escapeHTML(num)}</div>
            <div class="right"><a class="link popup-close">Tutup</a></div>
          </div>
        </div>
        <div class="page-content">
          <div class="block">
            <div class="verse-ar ar-text">${escapeHTML(arabic)}</div>
            <div class="verse-tr">${escapeHTML(v.translation?.id ?? txt(v.translation))}</div>
          </div>
          ${short ? `<div class="block-title">Ringkasan</div><div class="block">${paragraphs(short)}</div>` : ''}
          ${long ? `<div class="block-title">Tafsir lengkap</div><div class="block">${paragraphs(long)}</div>` : ''}
          ${!short && !long ? '<div class="block text-align-center">Tafsir ayat ini tidak tersedia.</div>' : ''}
        </div>
      </div>
    </div>`;
}

async function openTafsir(n, idx) {
  const entry = surahCache.get(n);
  if (!entry || !app || !app.popup) return;
  const pre = app.preloader;
  if (pre) pre.show();
  try {
    const arr = await getTafsir(n);
    app.popup.create({
      content: tafsirPopupHTML(n, idx, entry, arr[idx]),
      swipeToClose: true,
      on: { closed(p) { p.destroy(); } }
    }).open();
  } catch (e) {
    console.error(e);
    audioToast('Tafsir gagal dimuat. Periksa koneksi internet.');
  } finally {
    if (pre) pre.hide();
  }
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


/* ---------- audio per ayat ---------- */

const ICON_PLAY = '<svg class="i-play" width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>';
const svgI = (path) => `<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${path}</svg>`;
const ICON_PREV = svgI('<path d="M6 6h2v12H6zm3.5 6 8.5 6V6z"/>');
const ICON_NEXT = svgI('<path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/>');
const ICON_MORE = svgI('<circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/>');
const ICON_CLOSE = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
const ICON_PAUSE = '<svg class="i-pause" width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg>';

function isSlowNet() {
  const c = navigator.connection;
  return !!(c && (c.saveData || /(^|-)[23]g$/.test(c.effectiveType || '')));
}

// Daftar alamat audio dari data ayat (primary, lalu secondary). Koneksi lambat: utamakan versi 64 kbps.
function audioList(a) {
  const au = a && a.audio;
  const out = [];
  const push = (u) => { if (typeof u === 'string' && u && !out.includes(u)) out.push(u); };
  if (typeof au === 'string') push(au);
  else if (au && typeof au === 'object') {
    push(au.primary);
    if (Array.isArray(au.secondary)) au.secondary.forEach(push);
    Object.values(au).forEach((v) => { if (typeof v === 'string' && /^https?:/.test(v)) push(v); });
  }
  if (isSlowNet()) {
    const i = out.findIndex((u) => /\/64\//.test(u));
    if (i > 0) out.unshift(out.splice(i, 1)[0]);
  }
  return out;
}
const audioUrl = (a) => audioList(a)[0] || '';

const player = new Audio();
player.preload = 'none'; // tidak mengunduh apa pun sebelum tombol ditekan
const audioState = { page: null, entry: null, n: 0, idx: -1, url: '', list: [], k: 0, rep: 0 };
let preAudio = null;
let mediaSessionReady = false;
let pendingPlay = null; // dipakai saat lanjut otomatis ke surah berikutnya
let sleepTimer = null;
let sleepMin = 0;

const verseNo = (v, i) => ((v && v.number && typeof v.number === 'object') ? v.number.inSurah : (v && v.number)) ?? i + 1;

function fmt(sec) {
  if (!isFinite(sec) || sec < 0) return '0:00';
  const m = Math.floor(sec / 60), r = Math.floor(sec % 60);
  return m + ':' + String(r).padStart(2, '0');
}

function setCurrent(idx, playing) {
  const el = audioState.page && audioState.page.el;
  if (!el) return;
  el.querySelectorAll('.verse-card.current, .verse-card.playing').forEach((c) => c.classList.remove('current', 'playing'));
  if (idx < 0) return;
  const card = el.querySelector(`.verse-card[data-i="${idx}"]`);
  if (card) { card.classList.add('current'); if (playing) card.classList.add('playing'); }
}

function audioToast(text) {
  try { if (app && app.toast) app.toast.create({ text, position: 'center', closeTimeout: 2500 }).open(); } catch (e) { /* abaikan */ }
}

function applySpeed() {
  try { player.defaultPlaybackRate = prefs.speed; player.playbackRate = prefs.speed; } catch (e) { /* abaikan */ }
}

/* ---------- bilah pemutar (mini player) ---------- */

function barEls() {
  const el = audioState.page && audioState.page.el;
  const bar = el && el.querySelector('.player-bar');
  if (!bar) return null;
  return {
    bar,
    pc: el.querySelector('.page-content'),
    seek: bar.querySelector('.pb-seek'),
    title: bar.querySelector('.pb-title'),
    time: bar.querySelector('.pb-time')
  };
}

function hideBar(b) {
  if (!b) return;
  b.bar.classList.remove('show', 'is-playing');
  if (b.pc) b.pc.classList.remove('has-player');
}

function infoSuffix() {
  const parts = [];
  if (prefs.speed !== 1) parts.push(prefs.speed + '×');
  if (prefs.repeat === 'x3') parts.push(`ulang ${Math.min(audioState.rep + 1, 3)}/3`);
  if (prefs.repeat === 'loop') parts.push('ulang ∞');
  if (sleepMin) parts.push(`timer ${sleepMin} mnt`);
  return parts.length ? ' · ' + parts.join(' · ') : '';
}

function updateTime() {
  const b = barEls();
  if (!b || !audioState.url) return;
  const d = player.duration;
  const ct = player.currentTime || 0;
  if (b.seek && b.seek.dataset.drag !== '1') b.seek.value = (d && isFinite(d)) ? Math.round(ct / d * 1000) : 0;
  if (b.time) b.time.textContent = `${fmt(ct)} / ${fmt(d)}${infoSuffix()}`;
}

function updateBar() {
  const b = barEls();
  if (!b) return;
  const active = audioState.idx >= 0 && !!audioState.url;
  b.bar.classList.toggle('show', active);
  if (b.pc) b.pc.classList.toggle('has-player', active);
  if (!active) return;
  b.bar.classList.toggle('is-playing', !player.paused);
  const v = audioState.entry.verses[audioState.idx];
  if (b.title) b.title.textContent = `${latinName(audioState.entry.data, audioState.n)} · Ayat ${verseNo(v, audioState.idx)}`;
  updateTime();
}

function stopAudio() {
  clearTimeout(sleepTimer);
  sleepMin = 0;
  const b = barEls();
  player.pause();
  setCurrent(-1, false);
  hideBar(b);
  audioState.url = '';
  audioState.list = [];
  audioState.k = 0;
  audioState.rep = 0;
  audioState.idx = -1;
  audioState.page = null;
  audioState.entry = null;
  player.removeAttribute('src');
  try { player.load(); } catch (e) { /* abaikan */ }
  if ('mediaSession' in navigator) { try { navigator.mediaSession.playbackState = 'none'; } catch (e) { /* abaikan */ } }
}

function setSleep(min) {
  clearTimeout(sleepTimer);
  sleepMin = min;
  if (min > 0) {
    sleepTimer = setTimeout(() => {
      sleepMin = 0;
      if (audioState.url) { stopAudio(); audioToast('Timer selesai, audio dihentikan.'); }
    }, min * 60000);
  }
  updateTime();
}

/* ---------- media session (kontrol layar kunci) ---------- */

function setupMediaSession() {
  if (mediaSessionReady || !('mediaSession' in navigator)) return;
  mediaSessionReady = true;
  const set = (name, fn) => { try { navigator.mediaSession.setActionHandler(name, fn); } catch (e) { /* tidak didukung */ } };
  set('play', () => player.play().catch(playFail));
  set('pause', () => player.pause());
  set('nexttrack', () => { if (audioState.entry) advance(); });
  set('previoustrack', () => { if (audioState.entry) prevVerse(); });
}

function updateMediaSession(idx) {
  if (!('mediaSession' in navigator) || typeof MediaMetadata === 'undefined') return;
  try {
    const s = audioState.entry.data;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: `${latinName(s, audioState.n)} - Ayat ${verseNo(audioState.entry.verses[idx], idx)}`,
      artist: 'Murottal',
      album: APP_TITLE
    });
    setupMediaSession();
  } catch (e) { /* abaikan */ }
}

function setPlaybackState(state) {
  if ('mediaSession' in navigator) { try { navigator.mediaSession.playbackState = state; } catch (e) { /* abaikan */ } }
}

/* ---------- pemutaran ---------- */

function playFail(e) {
  if (e && e.name === 'AbortError') return; // terjadi saat berpindah ayat cepat, bukan kesalahan
  onAudioError();
}

function onAudioError() {
  if (!audioState.url) return;
  if (audioState.k + 1 < audioState.list.length) { // coba server audio cadangan
    audioState.k += 1;
    audioState.url = audioState.list[audioState.k];
    player.src = audioState.url;
    applySpeed();
    const pr = player.play();
    if (pr && pr.catch) pr.catch(() => {});
    return;
  }
  setCurrent(audioState.idx, false);
  updateBar();
  audioToast('Audio gagal diputar. Periksa koneksi internet.');
}

function playVerse(idx) {
  const { page, entry } = audioState;
  if (!page || !entry) return;
  if (idx < 0) idx = 0;
  if (idx >= entry.verses.length) { nextSurahOrStop(); return; }
  const list = audioList(entry.verses[idx]);
  const url = list[0];
  if (!url) {
    if (prefs.autonext && idx + 1 < entry.verses.length) { audioState.idx = idx; playVerse(idx + 1); } else audioToast('Audio ayat ini tidak tersedia.');
    return;
  }
  if (page.el.__renderUntil) page.el.__renderUntil(idx);
  audioState.idx = idx;
  audioState.rep = 0;
  if (audioState.url !== url) { audioState.list = list; audioState.k = 0; audioState.url = url; player.src = url; }
  applySpeed();
  const pr = player.play();
  if (pr && pr.catch) pr.catch(playFail);
  setCurrent(idx, true);
  updateBar();
  const card = page.el.querySelector(`.verse-card[data-i="${idx}"]`);
  if (card && card.scrollIntoView) card.scrollIntoView({ behavior: 'smooth', block: 'center' });
  updateMediaSession(idx);

  // Siapkan ayat berikutnya hanya bila koneksi bukan 2G/hemat data.
  const c = navigator.connection;
  const slow = c && (c.saveData || /(^|-)2g$/.test(c.effectiveType || ''));
  const nu = !slow && prefs.autonext ? audioUrl(entry.verses[idx + 1]) : '';
  if (nu) { preAudio = new Audio(); preAudio.preload = 'auto'; preAudio.src = nu; }
}

function advance() {
  const next = audioState.idx + 1;
  if (next < audioState.entry.verses.length) playVerse(next); else nextSurahOrStop();
}

function prevVerse() {
  if (player.currentTime > 3 || audioState.idx <= 0) {
    player.currentTime = 0;
    const pr = player.play();
    if (pr && pr.catch) pr.catch(playFail);
  } else playVerse(audioState.idx - 1);
}

// Akhir surah: lanjut ke surah berikutnya (bila diaktifkan), jika tidak berhenti.
function nextSurahOrStop() {
  const n = audioState.n;
  if (prefs.autosurah && n < TOTAL && app && app.views && app.views.main) {
    pendingPlay = { n: n + 1, t: Date.now() };
    setCurrent(-1, false);
    hideBar(barEls());
    app.views.main.router.navigate(`/surah/${n + 1}/`);
    return;
  }
  stopAudio();
}

player.addEventListener('ended', () => {
  if (!audioState.url) return;
  const mode = prefs.repeat;
  if (mode === 'loop' || (mode === 'x3' && audioState.rep + 1 < 3)) {
    audioState.rep += 1;
    player.currentTime = 0;
    const pr = player.play();
    if (pr && pr.catch) pr.catch(playFail);
    updateTime();
    return;
  }
  audioState.rep = 0;
  if (prefs.autonext) advance(); else { setCurrent(audioState.idx, false); updateBar(); }
});
player.addEventListener('pause', () => {
  if (!player.ended && audioState.url) { setCurrent(audioState.idx, false); updateBar(); setPlaybackState('paused'); }
});
player.addEventListener('play', () => {
  if (audioState.url) { setCurrent(audioState.idx, true); updateBar(); setPlaybackState('playing'); }
});
player.addEventListener('timeupdate', updateTime);
player.addEventListener('loadedmetadata', updateTime);
player.addEventListener('error', onAudioError);

/* ---------- opsi audio (ulang, kecepatan, timer) ---------- */

function audioOptionsHTML() {
  const radios = (name, items, cur) => items.map(([v, l]) => radioItem(name, v, l, String(cur))).join('');
  return `
    <div class="popup">
      <div class="page">
        <div class="navbar">
          <div class="navbar-bg"></div>
          <div class="navbar-inner">
            <div class="title">Opsi audio</div>
            <div class="right"><a class="link popup-close">Selesai</a></div>
          </div>
        </div>
        <div class="page-content">
          <div class="block-title">Ulangi ayat</div>
          <div class="list inset"><ul>${radios('rep', [['off', 'Tidak diulang'], ['x3', 'Ulangi 3×'], ['loop', 'Ulangi terus']], prefs.repeat)}</ul></div>
          <div class="block-title">Kecepatan</div>
          <div class="list inset"><ul>${radios('spd', [['0.75', '0.75×'], ['1', 'Normal (1×)'], ['1.25', '1.25×'], ['1.5', '1.5×'], ['2', '2×']], prefs.speed)}</ul></div>
          <div class="block-title">Matikan audio otomatis</div>
          <div class="list inset"><ul>${radios('slp', [['0', 'Tidak'], ['15', '15 menit'], ['30', '30 menit'], ['60', '60 menit']], sleepMin)}</ul></div>
        </div>
      </div>
    </div>`;
}

function openAudioOptions() {
  if (!app || !app.popup) return;
  app.popup.create({
    content: audioOptionsHTML(),
    swipeToClose: true,
    on: {
      opened(p) {
        const on = (name, fn) => p.el.querySelectorAll(`input[name="${name}"]`).forEach((r) => r.addEventListener('change', () => { if (r.checked) fn(r.value); }));
        on('rep', (v) => { prefs.repeat = v; audioState.rep = 0; savePrefs(); updateTime(); });
        on('spd', (v) => { prefs.speed = Number(v); savePrefs(); applySpeed(); updateTime(); });
        on('slp', (v) => setSleep(Number(v)));
      },
      closed(p) { p.destroy(); }
    }
  }).open();
}

/* ---------- tombol di halaman surah ---------- */

function bindAudio(page, n, entry) {
  const el = page.el;
  const ensure = () => {
    if (audioState.page && audioState.page.el !== el) stopAudio();
    if (!audioState.page) Object.assign(audioState, { page, entry, n, idx: -1, url: '', list: [], k: 0, rep: 0 });
  };

  const seek = el.querySelector('.pb-seek');
  if (seek) {
    seek.addEventListener('input', () => {
      seek.dataset.drag = '1';
      const d = player.duration;
      if (d && isFinite(d)) player.currentTime = d * seek.value / 1000;
    });
    seek.addEventListener('change', () => { seek.dataset.drag = '0'; });
  }

  el.addEventListener('click', (ev) => {
    const t = ev.target;
    if (!t || !t.closest) return;

    const tb = t.closest('.tafsir-btn');
    if (tb) { ev.preventDefault(); openTafsir(n, Number(tb.dataset.i)); return; }

    const pb = t.closest('.pb-btn');
    if (pb) {
      ev.preventDefault();
      if (!audioState.url || audioState.page.el !== el) return;
      if (pb.classList.contains('pb-toggle')) {
        if (player.paused) { const pr = player.play(); if (pr && pr.catch) pr.catch(playFail); } else player.pause();
      } else if (pb.classList.contains('pb-prev')) prevVerse();
      else if (pb.classList.contains('pb-next')) advance();
      else if (pb.classList.contains('pb-opts')) openAudioOptions();
      else if (pb.classList.contains('pb-close')) stopAudio();
      return;
    }

    const btn = t.closest('.audio-btn');
    const all = t.closest('.play-all');
    if (!btn && !all) return;
    ev.preventDefault();
    ensure();
    const idx = btn ? Number(btn.dataset.i) : 0;
    if (idx === audioState.idx && audioState.url) {
      if (player.paused) { const pr = player.play(); if (pr && pr.catch) pr.catch(playFail); } else player.pause();
      return;
    }
    playVerse(idx);
  });
}

function verseHTML(a, i) {
  const num = (a.number && typeof a.number === 'object') ? a.number.inSurah : a.number;
  const number = num ?? i + 1;
  const arabic = String(a.text?.arab ?? txt(a.text)).replace(/\ufeff/g, '');
  const translation = a.translation?.id ?? txt(a.translation);
  const hasAudio = !!audioUrl(a);
  return `
    <div class="card card-outline verse-card" data-i="${i}">
      <div class="card-content card-content-padding">
        <div class="display-flex justify-content-space-between align-items-center">
          <span class="badge color-green">Ayat ${escapeHTML(number)}</span>
          <div class="display-flex align-items-center" style="gap:8px">
            <a class="button button-small button-round button-outline tafsir-btn" role="button" data-i="${i}" aria-label="Tafsir ayat ${escapeHTML(number)}">Tafsir</a>
            ${hasAudio ? `<a class="button button-small button-round button-outline audio-btn" role="button" data-i="${i}" aria-label="Putar ayat ${escapeHTML(number)}">${ICON_PLAY}${ICON_PAUSE}</a>` : ''}
          </div>
        </div>
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
  const hasAudioAny = verses.some((a) => audioUrl(a));
  const hasPB = ('preBismillah' in s) ? !!s.preBismillah : (n !== 1 && n !== 9);
  const pbText = String(s.preBismillah?.text?.arab || 'بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ').replace(/\ufeff/g, '');

  return `
    <div class="page" data-name="surah" data-title="${escapeHTML(name)} - ${escapeHTML(APP_TITLE)}">
      ${navbarHTML(name, direct, true)}
      <div class="toolbar toolbar-bottom">
        <div class="toolbar-inner">
          ${n > 1 ? `<a href="/surah/${n - 1}/" class="link">Sebelumnya</a>` : '<a class="link disabled">Sebelumnya</a>'}
          ${n < TOTAL ? `<a href="/surah/${n + 1}/" class="link">Berikutnya</a>` : '<a class="link disabled">Berikutnya</a>'}
        </div>
      </div>
      ${hasAudioAny ? `
      <div class="player-bar">
        <input type="range" class="pb-seek" min="0" max="1000" value="0" aria-label="Posisi audio">
        <div class="pb-row">
          <a class="pb-btn pb-toggle" role="button" aria-label="Putar atau jeda">${ICON_PLAY.replace('width="18" height="18"', 'width="22" height="22"')}${ICON_PAUSE.replace('width="18" height="18"', 'width="22" height="22"')}</a>
          <div class="pb-info"><div class="pb-title"></div><div class="pb-time">0:00 / 0:00</div></div>
          <a class="pb-btn pb-prev" role="button" aria-label="Ayat sebelumnya">${ICON_PREV}</a>
          <a class="pb-btn pb-next" role="button" aria-label="Ayat berikutnya">${ICON_NEXT}</a>
          <a class="pb-btn pb-opts" role="button" aria-label="Opsi audio">${ICON_MORE}</a>
          <a class="pb-btn pb-close" role="button" aria-label="Tutup pemutar">${ICON_CLOSE}</a>
        </div>
      </div>` : ''}
      <div class="page-content">
        <div class="block">
          <div class="card hero" style="margin:0">
            <div class="card-content card-content-padding text-align-center">
              <div class="gold ar-text" style="font-size:30px;line-height:2">${escapeHTML(arabicName(s))}</div>
              <h2 style="margin:4px 0">${escapeHTML(name)}</h2>
              <p style="margin:4px 0">${escapeHTML(translationOf(s))}</p>
              <p style="margin:4px 0">${verses.length} Ayat</p>
              ${hasAudioAny ? `<div class="margin-top-half"><a class="button button-small button-fill btn-gold play-all" role="button" style="display:inline-flex;align-items:center;gap:6px;padding:0 18px">${ICON_PLAY} Putar Surah</a></div>` : ''}
            </div>
          </div>
        </div>

        ${hasPB ? `<div class="block text-align-center bismillah ar-text">${escapeHTML(pbText)}</div>` : ''}

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
          ${toggleItem('opt-autonext', 'Putar ayat berikutnya otomatis', prefs.autonext)}
          ${toggleItem('opt-autosurah', 'Lanjut ke surah berikutnya otomatis', prefs.autosurah)}
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
  if (!entry) return;
  const box = page.el.querySelector('.verses');
  const sentinel = page.el.querySelector('.verses-sentinel');
  const root = page.el.querySelector('.page-content');
  let next = CHUNK;
  let io = null;

  const finish = () => { if (io) io.disconnect(); if (sentinel) sentinel.remove(); };
  const renderChunk = () => {
    box.insertAdjacentHTML('beforeend',
      entry.verses.slice(next, next + CHUNK).map((a, i) => verseHTML(a, next + i)).join(''));
    next += CHUNK;
    if (next >= entry.verses.length) finish();
  };
  // Dipakai pemutar audio agar ayat yang sedang diputar selalu sudah ada di layar.
  page.el.__renderUntil = (idx) => { while (next <= idx && next < entry.verses.length) renderChunk(); };

  if (sentinel) {
    if ('IntersectionObserver' in window) {
      io = new IntersectionObserver((items) => {
        if (!items[0].isIntersecting) return;
        renderChunk();
        if (sentinel.isConnected) { io.unobserve(sentinel); io.observe(sentinel); }
      }, { root, rootMargin: '800px 0px' });
      io.observe(sentinel);
      page.el.__io = io;
    } else {
      page.el.__renderUntil(entry.verses.length);
    }
  }

  bindAudio(page, n, entry);

  // Lanjut otomatis dari akhir surah sebelumnya.
  if (pendingPlay && pendingPlay.n === n && Date.now() - pendingPlay.t < 30000) {
    pendingPlay = null;
    Object.assign(audioState, { page, entry, n, idx: -1, url: '', list: [], k: 0, rep: 0 });
    playVerse(0);
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

  const autoNext = el.querySelector('#opt-autonext');
  if (autoNext) autoNext.addEventListener('change', () => { prefs.autonext = autoNext.checked; savePrefs(); });

  const autoSurah = el.querySelector('#opt-autosurah');
  if (autoSurah) autoSurah.addEventListener('change', () => { prefs.autosurah = autoSurah.checked; savePrefs(); });

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
          pageBeforeOut: (e, page) => { if (audioState.page && audioState.page.el === page.el && !pendingPlay) stopAudio(); },
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
