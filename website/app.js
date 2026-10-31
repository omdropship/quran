
document.addEventListener('DOMContentLoaded', async () => {
  const list = document.getElementById('surah-list');

  if (!list) return;

  try {
    // Ambil data Al-Qur'an dari file lokal
    const response = await fetch('./data/quran.json');

    if (!response.ok) {
      throw new Error('Data Al-Qur’an gagal dimuat');
    }

    const result = await response.json();

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

    // Simpan data surah untuk digunakan saat dibuka
    window.quranSurahs = surahs;

    // Tampilkan daftar surah
    list.innerHTML = surahs.map(surah => {
      const number = Number(surah.number);
      const latin = surah.name?.transliteration?.id || 'Surah';
      const arabic = surah.name?.short || '';
      const totalAyat = surah.numberOfVerses || 0;

      return `
        <li>
          <a
            href="/surah/${number}/"
            class="item-link item-content surah-link"
            data-number="${number}"
          >
            <div class="item-media">
              <div class="item-after">${number}</div>
            </div>

            <div class="item-inner">
              <div class="item-title">
                ${latin}
                <div class="item-footer">
                  ${totalAyat} ayat
                </div>
              </div>

              <div class="item-after">
                ${arabic}
              </div>
            </div>
          </a>
        </li>
      `;
    }).join('');

    // Fungsi klik surah menggunakan Router Framework7
    list.addEventListener('click', event => {
      const link = event.target.closest('.surah-link');

      if (!link) return;

      event.preventDefault();

      const number = link.dataset.number;

      if (window.app?.views?.main?.router) {
        window.app.views.main.router.navigate(
          `/surah/${number}/`
        );
      } else {
        console.error('Framework7 Router belum tersedia');
      }
    });

    console.log('Berhasil memuat', surahs.length, 'surah');

  } catch (error) {
    console.error('Quran error:', error);

    list.innerHTML = `
      <li class="item-content">
        <div class="item-inner">
          <div class="item-title">
            ${error.message}
          </div>
        </div>
      </li>
    `;
  }
});
