
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

function getLatinName(surah) {
  return surah.name?.transliteration?.id
    || surah.name?.transliteration?.en
    || surah.name?.short
    || `Surah ${surah.number}`;
}

function getArabicName(surah) {
  return surah.name?.short || '';
}

function getAyahCount(surah) {
  return surah.numberOfVerses
    ?? surah.verses?.length
    ?? 0;
}

async function loadQuran() {
  const response = await fetch(QURAN_URL);

  if (!response.ok) {
    throw new Error('Gagal memuat data Al-Qur’an.');
  }

  const json = await response.json();
  quranData = getSurahs(json);

  if (!quranData.length) {
    throw new Error('Format data surah tidak ditemukan.');
  }

  return quranData;
}

function renderSurahList(keyword = '') {
  const list = document.getElementById('surah-list');
  if (!list) return;

  const search = keyword.toLowerCase().trim();

  const filtered = quranData.filter(surah => {
    const latin = getLatinName(surah).toLowerCase();
    const arabic = getArabicName(surah);
    const number = String(surah.number);

    return latin.includes(search)
      || arabic.includes(search)
      || number.includes(search);
  });

  if (!filtered.length) {
    list.innerHTML = `
      <li>
        <div class="item-content">
          <div class="item-inner">
            <div class="item-title text-color-gray">
              Surah tidak ditemukan.
            </div>
          </div>
        </div>
      </li>`;
    return;
  }

  list.innerHTML = filtered.map(surah => `
    <li>
      <a href="/surah/${Number(surah.number)}/"
         class="item-link item-content">
        <div class="item-media">
          <div style="
            width:42px;
            height:42px;
            display:flex;
            align-items:center;
            justify-content:center;
            background:#e8f1eb;
            color:#155b45;
            border-radius:12px;
            font-weight:bold;">
            ${escapeHTML(surah.number)}
          </div>
        </div>

        <div class="item-inner">
          <div class="item-title-row">
            <div class="item-title">
              ${escapeHTML(getLatinName(surah))}
            </div>
            <div class="item-after" style="font-size:20px;color:#155b45">
              ${escapeHTML(getArabicName(surah))}
            </div>
          </div>

          <div class="item-subtitle">
            ${escapeHTML(surah.translation || '')}
            · ${escapeHTML(getAyahCount(surah))} Ayat
          </div>
        </div>
      </a>
    </li>
  `).join('');
}

function renderSurahPage(number) {
  const surah = quranData.find(
    item => Number(item.number) === Number(number)
  );

  if (!surah) {
    return `
      <div class="page" data-name="not-found">
        <div class="navbar">
          <div class="navbar-inner">
            <div class="left">
              <a href="/" class="link back">Kembali</a>
            </div>
            <div class="title">Surah tidak ditemukan</div>
          </div>
        </div>
        <div class="page-content">
          <div class="block text-align-center">
            Surah tidak ditemukan.
          </div>
        </div>
      </div>`;
  }

  const verses = Array.isArray(surah.verses) ? surah.verses : [];

  const ayahHTML = verses.map((ayah, index) => {
    const ayahNumber = ayah.number?.inSurah
      ?? ayah.number
      ?? index + 1;

    const arabic = ayah.text?.arab
      ?? ayah.text
      ?? '';

    const translation = ayah.translation?.id
      ?? ayah.translation
      ?? '';

    return `
      <div class="card card-outline" style="border-radius:14px">
        <div class="card-content card-content-padding">

          <div class="display-flex justify-content-space-between align-items-center">
            <span class="badge color-green">
              Ayat ${escapeHTML(ayahNumber)}
            </span>
          </div>

          <div class="text-align-right"
               style="font-size:27px;line-height:2.1;margin-top:18px;direction:rtl">
            ${escapeHTML(arabic)}
          </div>

          <div class="margin-top">
            ${escapeHTML(translation)}
          </div>

        </div>
      </div>
    `;
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
          <div class="title">${escapeHTML(getLatinName(surah))}</div>
        </div>
      </div>

      <div class="page-content">

        <div class="block">
          <div class="card" style="background:#155b45;color:white;border-radius:18px">
            <div class="card-content card-content-padding text-align-center">
              <div style="font-size:30px;color:#f3d98c">
                ${escapeHTML(getArabicName(surah))}
              </div>
              <h2>${escapeHTML(getLatinName(surah))}</h2>
              <p>${escapeHTML(surah.translation || '')}</p>
              <p>${escapeHTML(getAyahCount(surah))} Ayat</p>
            </div>
          </div>
        </div>

        ${Number(surah.number) !== 1 && Number(surah.number) !== 9
          ? `<div class="block text-align-center" style="font-size:25px;direction:rtl">
               بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ
             </div>`
          : ''}

        <div class="block-title">Bacaan Surah</div>

        ${ayahHTML || '<div class="block">Ayat belum tersedia.</div>'}

        <div class="block">
          <div class="row">
            <div class="col">
              ${Number(surah.number) > 1
                ? `<a href="/surah/${Number(surah.number) - 1}/"
                     class="button button-outline button-round">
                     Surah Sebelumnya
                   </a>`
                : ''}
            </div>
            <div class="col">
              ${Number(surah.number) < 114
                ? `<a href="/surah/${Number(surah.number) + 1}/"
                     class="button button-fill button-round"
                     style="background:#155b45">
                     Surah Berikutnya
                   </a>`
                : ''}
            </div>
          </div>
        </div>

      </div>
    </div>
  `;
}

function initQuranApp() {
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
        async: async function ({ to, resolve, reject }) {
          try {
            if (!quranData.length) {
              await loadQuran();
            }

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

  app.on('pageInit', function (page) {
    if (page.name === 'home') {
      renderSurahList();

      const search = document.getElementById('surah-search');

      if (search && !search.dataset.bound) {
        search.dataset.bound = 'true';
        search.addEventListener('input', () => {
          renderSurahList(search.value);
        });
      }
    }
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  const errorBox = document.getElementById('home-error');

  try {
    await loadQuran();
    document.getElementById('surah-total').textContent =
      `${quranData.length} Surah`;

    initQuranApp();
  } catch (error) {
    console.error(error);

    if (errorBox) {
      errorBox.textContent = error.message;
    }

    const list = document.getElementById('surah-list');
    if (list) {
      list.innerHTML = `
        <li>
          <div class="item-content">
            <div class="item-inner">
              <div class="item-title text-color-red">
                Gagal memuat data Al-Qur'an.
              </div>
            </div>
          </div>
        </li>`;
    }
  }
});
