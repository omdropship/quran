
const QURAN_URL = '/data/quran.json';

let quranData = [];
let app;

function getSurahs(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.data)) return data.data;
  if (Array.isArray(data?.surahs)) return data.surahs;
  return [];
}

function escapeHTML(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  })[char]);
}

function latinName(s) {
  return s.name?.transliteration?.id
    || s.name?.transliteration?.en
    || `Surah ${s.number}`;
}

function arabicName(s) {
  return s.name?.short || '';
}

async function loadQuran() {
  const response = await fetch(QURAN_URL);

  if (!response.ok) {
    throw new Error(`Data Quran gagal dimuat: ${response.status}`);
  }

  const json = await response.json();
  quranData = getSurahs(json);

  if (!quranData.length) {
    throw new Error('Data surah tidak ditemukan.');
  }
}

function renderSurahList(keyword = '') {
  const list = document.getElementById('surah-list');
  if (!list) return;

  const key = keyword.toLowerCase().trim();

  const filtered = quranData.filter(s => {
    return latinName(s).toLowerCase().includes(key)
      || arabicName(s).includes(key)
      || String(s.number).includes(key);
  });

  if (!filtered.length) {
    list.innerHTML = '<li><div class="item-content"><div class="item-inner">Surah tidak ditemukan.</div></div></li>';
    return;
  }

  list.innerHTML = filtered.map(s => `
    <li>
      <a href="/surah/${Number(s.number)}/" class="item-link item-content">
        <div class="item-media">
          <div style="width:42px;height:42px;display:flex;align-items:center;justify-content:center;background:#e8f1eb;color:#155b45;border-radius:12px;font-weight:bold">
            ${escapeHTML(s.number)}
          </div>
        </div>
        <div class="item-inner">
          <div class="item-title-row">
            <div class="item-title">${escapeHTML(latinName(s))}</div>
            <div class="item-after" style="font-size:20px;color:#155b45">
              ${escapeHTML(arabicName(s))}
            </div>
          </div>
          <div class="item-subtitle">
            ${escapeHTML(s.translation || '')}
            · ${escapeHTML(s.numberOfVerses ?? s.verses?.length ?? 0)} Ayat
          </div>
        </div>
      </a>
    </li>
  `).join('');
}

function renderSurahPage(number) {
  const s = quranData.find(x => Number(x.number) === Number(number));

  if (!s) {
    return `
      <div class="page">
        <div class="navbar">
          <div class="navbar-inner">
            <div class="left"><a href="/" class="link">Kembali</a></div>
            <div class="title">Surah tidak ditemukan</div>
          </div>
        </div>
        <div class="page-content">
          <div class="block">Surah tidak ditemukan.</div>
        </div>
      </div>`;
  }

  const verses = Array.isArray(s.verses) ? s.verses : [];

  const ayatHTML = verses.map((a, i) => {
    const number = a.number?.inSurah ?? a.number ?? i + 1;
    const arabic = a.text?.arab ?? a.text ?? '';
    const translation = a.translation?.id ?? a.translation ?? '';

    return `
      <div class="card card-outline" style="border-radius:14px">
        <div class="card-content card-content-padding">
          <span class="badge color-green">Ayat ${escapeHTML(number)}</span>
          <div style="font-size:28px;line-height:2.1;text-align:right;direction:rtl;margin:18px 0">
            ${escapeHTML(arabic)}
          </div>
          <div>${escapeHTML(translation)}</div>
        </div>
      </div>`;
  }).join('');

  return `
    <div class="page" data-name="surah">
      <div class="navbar">
        <div class="navbar-inner">
          <div class="left">
            <a href="/" class="link">
              <i class="icon f7-icons">arrow_left</i>
            </a>
          </div>
          <div class="title">${escapeHTML(latinName(s))}</div>
        </div>
      </div>

      <div class="page-content">
        <div class="block">
          <div class="card" style="background:#155b45;color:white;border-radius:18px">
            <div class="card-content card-content-padding text-align-center">
              <div style="font-size:30px;color:#f3d98c">${escapeHTML(arabicName(s))}</div>
              <h2>${escapeHTML(latinName(s))}</h2>
              <p>${escapeHTML(s.translation || '')}</p>
              <p>${verses.length} Ayat</p>
            </div>
          </div>
        </div>

        ${Number(s.number) !== 1 && Number(s.number) !== 9
          ? '<div class="block text-align-center" style="font-size:26px;direction:rtl">بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</div>'
          : ''}

        ${ayatHTML || '<div class="block">Ayat belum tersedia.</div>'}

        <div class="block">
          <div class="row">
            <div class="col">
              ${Number(s.number) > 1
                ? `<a href="/surah/${Number(s.number) - 1}/" class="button button-outline">Sebelumnya</a>`
                : ''}
            </div>
            <div class="col">
              ${Number(s.number) < 114
                ? `<a href="/surah/${Number(s.number) + 1}/" class="button button-fill" style="background:#155b45">Berikutnya</a>`
                : ''}
            </div>
          </div>
        </div>
      </div>
    </div>`;
}

function initApp() {
  app = new Framework7({
    el: '#app',
    name: "Al-Qur'an Digital",
    theme: 'auto',
    routes: [
      {
        path: '/',
        content: document.querySelector('.page[data-name="home"]').outerHTML
      },
      {
        path: '/surah/:number/',
        async: function ({ to, resolve, reject }) {
          try {
            resolve({
              content: renderSurahPage(to.params.number)
            });
          } catch (error) {
            console.error(error);
            reject();
          }
        }
      }
    ]
  });

  // Render langsung setelah aplikasi dibuat.
  renderSurahList();

  // Aktifkan pencarian.
  const search = document.getElementById('surah-search');

  if (search) {
    search.addEventListener('input', function () {
      renderSurahList(this.value);
    });
  }
}

document.addEventListener('DOMContentLoaded', async function () {
  try {
    await loadQuran();

    document.getElementById('surah-total').textContent =
      `${quranData.length} Surah`;

    initApp();
  } catch (error) {
    console.error(error);

    document.getElementById('home-error').textContent = error.message;

    document.getElementById('surah-list').innerHTML =
      '<li><div class="item-content"><div class="item-inner">Gagal memuat daftar surah.</div></div></li>';
  }
});
