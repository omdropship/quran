
document.addEventListener('DOMContentLoaded', async () => {
  const list = document.getElementById('surah-list');

  if (!list) {
    console.error('Elemen surah-list tidak ditemukan');
    return;
  }

  list.innerHTML = `
    <li class="item-content">
      <div class="item-inner">
        <div class="item-title">Memuat daftar surah...</div>
      </div>
    </li>
  `;

  try {
    const response = await fetch('./data/quran.json');

    if (!response.ok) {
      throw new Error('Gagal memuat data Al-Qur’an');
    }

    const result = await response.json();

    const surahs = Array.isArray(result)
      ? result
      : result.data || result.surahs;

    if (!Array.isArray(surahs)) {
      throw new Error('Format JSON tidak sesuai');
    }

    window.quranSurahs = surahs;

    list.innerHTML = surahs.map(surah => `
      <li>
        <a href="#" class="item-link item-content"
           data-number="${Number(surah.number)}">
          <div class="item-media">
            <div class="item-after">${surah.number}</div>
          </div>
          <div class="item-inner">
            <div class="item-title">
              ${surah.name?.transliteration?.id || 'Surah'}
              <div class="item-footer">
                ${surah.numberOfVerses || 0} ayat
              </div>
            </div>
            <div class="item-after">
              ${surah.name?.short || ''}
            </div>
          </div>
        </a>
      </li>
    `).join('');

    console.log('Berhasil memuat', surahs.length, 'surah');

  } catch (error) {
    console.error(error);

    list.innerHTML = `
      <li class="item-content">
        <div class="item-inner">
          <div class="item-title">${error.message}</div>
        </div>
      </li>
    `;
  }
});
