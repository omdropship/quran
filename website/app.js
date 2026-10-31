document.addEventListener('DOMContentLoaded', async () => {
  const list = document.getElementById('surah-list');

  try {
    const response = await fetch(
      'https://raw.githubusercontent.com/omdropship/quran/main/data/quran.json'
    );

    if (!response.ok) {
      throw new Error('Gagal mengambil data Al-Qur’an');
    }

    const result = await response.json();

    // Sesuaikan dengan struktur data repositori
    const surahs = Array.isArray(result)
      ? result
      : result.data;

    if (!Array.isArray(surahs)) {
      throw new Error('Format data surah tidak ditemukan');
    }

    list.innerHTML = surahs.map(surah => `
      <li>
        <a href="#" class="item-link item-content">
          <div class="item-media">
            <div class="item-after">
              ${surah.number}
            </div>
          </div>
          <div class="item-inner">
            <div class="item-title">
              <div class="item-title">${surah.name?.transliteration?.id || 'Surah'}</div>
              <div class="item-footer">
                ${surah.numberOfVerses} ayat
              </div>
            </div>
            <div class="item-after">
              ${surah.name?.short || ''}
            </div>
          </div>
        </a>
      </li>
    `).join('');

  } catch (error) {
    list.innerHTML = `
      <li>
        <div class="item-content">
          <div class="item-inner">
            <div class="item-title">${error.message}</div>
          </div>
        </div>
      </li>
    `;
  }
});
