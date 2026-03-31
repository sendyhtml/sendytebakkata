// js/categories.js — Load word categories from JSON files

let _cache = null;

/**
 * Load all categories from data/categories/*.json
 * Falls back to embedded defaults if fetch fails (e.g. file:// protocol)
 */
export async function loadCategories() {
  if (_cache) return _cache;

  try {
    const indexRes = await fetch('./data/categories/index.json');
    if (!indexRes.ok) throw new Error('index not found');
    const index = await indexRes.json();

    const results = {};
    await Promise.all(
      index.categories.map(async (slug) => {
        try {
          const res = await fetch(`./data/categories/${slug}.json`);
          if (!res.ok) return;
          const data = await res.json();
          results[data.name] = { words: data.words, icon: data.icon || '' };
        } catch (e) {
          console.warn(`Failed to load category: ${slug}`, e);
        }
      })
    );

    if (Object.keys(results).length > 0) {
      _cache = results;
      return _cache;
    }
  } catch (e) {
    console.warn('Category fetch failed, using defaults:', e);
  }

  // Embedded fallback
  _cache = FALLBACK_CATEGORIES;
  return _cache;
}

export function clearCategoryCache() { _cache = null; }

export const FALLBACK_CATEGORIES = {
  'Hewan': {
    icon: '',
    words: ['Sapi','Kucing','Anjing','Harimau','Singa','Gajah','Kuda','Kelinci',
      'Ayam','Bebek','Ular','Buaya','Monyet','Burung','Ikan','Kambing',
      'Kerbau','Macan','Beruang','Panda','Zebra','Jerapah','Kanguru','Lumba-lumba']
  },
  'Buah': {
    icon: '',
    words: ['Mangga','Apel','Jeruk','Pisang','Anggur','Semangka','Nanas',
      'Rambutan','Durian','Pepaya','Strawberry','Melon','Alpukat',
      'Jambu','Manggis','Salak','Duku','Leci','Sawo','Belimbing','Kiwi']
  },
  'Profesi': {
    icon: '',
    words: ['Dokter','Guru','Polisi','Pilot','Chef','Petani','Programmer',
      'Insinyur','Arsitek','Fotografer','Penulis','Penyanyi','Aktor',
      'Atlet','Perawat','Apoteker','Hakim','Pengacara','Akuntan','Musisi']
  },
  'Benda': {
    icon: '',
    words: ['Kursi','Meja','Lampu','Tas','Sepatu','Topi','Payung','Kunci',
      'Buku','Pensil','Telepon','Laptop','Kamera','Jam tangan','Kacamata',
      'Panci','Wajan','Sendok','Garpu','Pisau','Gelas','Piring','Mangkuk']
  },
  'Tempat': {
    icon: '',
    words: ['Pantai','Gunung','Mall','Sekolah','Rumah Sakit','Bandara','Stasiun',
      'Pasar','Restoran','Hotel','Museum','Perpustakaan','Kantor','Pabrik',
      'Kebun binatang','Taman','Lapangan','Stadion','Bioskop','Cafe','Masjid']
  },
  'Makanan': {
    icon: '',
    words: ['Nasi Goreng','Sate','Rendang','Bakso','Mie Goreng','Soto',
      'Pempek','Gado-gado','Rawon','Opor Ayam','Tongseng','Ayam Geprek',
      'Bubur Ayam','Martabak','Terang Bulan','Klepon','Onde-onde','Batagor']
  },
  'Olahraga': {
    icon: '',
    words: ['Sepak Bola','Basket','Voli','Badminton','Tenis','Renang',
      'Tinju','Karate','Judo','Taekwondo','Silat','Golf','Baseball',
      'Renang','Lari','Senam','Yoga','Surfing','Skateboard']
  },
  'Negara': {
    icon: '',
    words: ['Indonesia','Malaysia','Singapura','Thailand','Vietnam','Filipina',
      'Amerika Serikat','Inggris','Prancis','Jerman','Italia','Spanyol',
      'China','Jepang','Korea Selatan','India','Australia','Brasil','Rusia']
  }
};
