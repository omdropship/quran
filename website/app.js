
document.addEventListener('DOMContentLoaded', async () => {
  const list = document.getElementById('surah-list');

  try {
    // Membaca data lokal hasil deployment Vercel
    const response = await fetch('./data/quran.json');

    if (!response.ok) {
      throw new Error('Data Al-Qur’an gagal dimuat');
    }

    const result = await response.json();

    // Membaca berbagai kemungkinan struktur JSON
    const surahs = Array.isArray(result)
      ? result
      : Array.isArray(result.data)
        ? result.data
        : Array.isArray(result.surahs)
          ? result.surahs
          : null;

    if (!surahs) {
      throw new Error('Format data surah tidak ditemukan');
    }

    // Tampilkan daftar surah
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

  } catch (error) {
    console.error(error);

    list.innerHTML = `
      <li>
        <div class="item-content">
          <div class="item-inner">
            <div class="item-title">
              ${error.message}
            </div>
          </div>
        </div>
      </li>
    `;
  }
});
