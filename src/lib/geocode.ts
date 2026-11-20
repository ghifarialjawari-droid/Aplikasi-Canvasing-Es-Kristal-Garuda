// Reverse geocoding (GPS -> desa/kelurahan) memakai OpenStreetMap Nominatim, dan
// daftar desa di sekitar depot memakai OpenStreetMap Overpass. Keduanya gratis
// tanpa kunci API, tetapi ada aturan pemakaian wajar (maks. 1 permintaan/detik),
// sehingga hasilnya disimpan (cache) di HP dan di database supaya tiap titik
// cukup dicari satu kali.

import { KnownVillage, haversineKm, normalizeVillage } from './geo';

export interface GeoName { desa: string; kecamatan: string; }

const NOMINATIM = 'https://nominatim.openstreetmap.org/reverse';
const OVERPASS = 'https://overpass-api.de/api/interpreter';

export const GEOCODE_INTERVAL_MS = 1100;

// Titik dibulatkan 4 desimal (~11 m) sebagai kunci cache.
export const geoKey = (lat: number, lng: number) => `${lat.toFixed(4)},${lng.toFixed(4)}`;

const CACHE_KEY = 'esgaruda_geocache_v1';

type Cache = Record<string, GeoName & { miss?: boolean }>;

export function loadGeoCache(): Cache {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    const p = raw ? JSON.parse(raw) : {};
    return p && typeof p === 'object' ? p : {};
  } catch { return {}; }
}

export function saveGeoCache(c: Cache) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(c)); } catch { /* penyimpanan penuh */ }
}

// Memilih nama desa & kecamatan dari alamat Nominatim. Di Indonesia, desa/kelurahan
// biasanya muncul sebagai village (kadang suburb), dan kecamatan sebagai county/
// city_district/municipality.
export function pickNames(address: Record<string, string> | undefined): GeoName {
  const a = address || {};
  const desa = a.village || a.suburb || a.hamlet || a.quarter || a.neighbourhood || '';
  const kecamatan = a.county || a.city_district || a.municipality || a.district || a.subdistrict ||
    (a.village && a.suburb ? a.suburb : '') || '';
  return { desa: desa.trim(), kecamatan: kecamatan.trim() };
}

async function fetchJson(url: string, init: RequestInit | undefined, timeoutMs: number): Promise<any> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...(init || {}), signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally { clearTimeout(t); }
}

// Satu permintaan reverse geocoding. Melempar error kalau jaringan/server gagal
// (supaya tidak dianggap "desa tidak ada"); mengembalikan desa '' kalau OSM memang
// tidak punya nama desa untuk titik itu.
export async function reverseGeocode(lat: number, lng: number): Promise<GeoName> {
  const url = `${NOMINATIM}?format=jsonv2&zoom=16&addressdetails=1&accept-language=id&lat=${lat}&lon=${lng}`;
  const json = await fetchJson(url, { headers: { Accept: 'application/json' } }, 15000);
  if (json && json.error) return { desa: '', kecamatan: '' };
  return pickNames(json && json.address);
}

// ---------- Daftar desa di sekitar depot (untuk "wilayah belum dikunjungi") ----------

const VILLAGE_CACHE_PREFIX = 'esgaruda_villages_v2_';
const VILLAGE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 hari

// Beberapa server Overpass; kalau satu sibuk/menolak, dicoba yang berikutnya.
export const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];

const villageCacheKey = (depotName: string, lat: number, lng: number, radiusKm: number) =>
  `${VILLAGE_CACHE_PREFIX}${depotName}_${lat.toFixed(4)}_${lng.toFixed(4)}_${radiusKm}`;

export function loadCachedVillages(depotName: string, lat: number, lng: number, radiusKm: number): KnownVillage[] | null {
  try {
    const raw = localStorage.getItem(villageCacheKey(depotName, lat, lng, radiusKm));
    if (!raw) return null;
    const p = JSON.parse(raw);
    if (!p || Date.now() - p.at > VILLAGE_TTL_MS || !Array.isArray(p.list) || p.list.length === 0) return null;
    return p.list;
  } catch { return null; }
}

async function overpassQuery(query: string): Promise<any> {
  let lastErr: unknown = null;
  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      // application/x-www-form-urlencoded = permintaan "sederhana" (tanpa preflight CORS)
      return await fetchJson(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'data=' + encodeURIComponent(query),
      }, 30000);
    } catch (e) { lastErr = e; }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

// Mengambil desa/kelurahan di sekitar depot dari titik place=village/suburb di OSM
// (kotak koordinat, ringan, lalu disaring jaraknya di sini). Mengembalikan titik
// tengah tiap desa. Hasil kosong dianggap gagal (tidak disimpan di cache).
export async function fetchVillagesAround(depotName: string, lat: number, lng: number, radiusKm: number): Promise<KnownVillage[]> {
  const cached = loadCachedVillages(depotName, lat, lng, radiusKm);
  if (cached) return cached;

  const dLat = radiusKm / 111.195;
  const dLng = radiusKm / (111.195 * Math.cos((lat * Math.PI) / 180));
  const bbox = [lat - dLat, lng - dLng, lat + dLat, lng + dLng].map(n => n.toFixed(5)).join(',');
  const query = `[out:json][timeout:25];(node["place"~"^(village|suburb)$"]["name"](${bbox}););out;`;
  const json = await overpassQuery(query);

  const byName = new Map<string, KnownVillage>();
  for (const el of (json && json.elements) || []) {
    const name = el.tags && (el.tags.name || el.tags['name:id']);
    const elLat = typeof el.lat === 'number' ? el.lat : el.center && el.center.lat;
    const elLng = typeof el.lon === 'number' ? el.lon : el.center && el.center.lon;
    if (!name || typeof elLat !== 'number' || typeof elLng !== 'number') continue;
    if (haversineKm(lat, lng, elLat, elLng) > radiusKm) continue;
    const key = normalizeVillage(name);
    if (key && !byName.has(key)) byName.set(key, { name: String(name), lat: elLat, lng: elLng });
  }
  const list = Array.from(byName.values());
  if (list.length === 0) throw new Error('Server peta tidak mengembalikan daftar desa');
  try { localStorage.setItem(villageCacheKey(depotName, lat, lng, radiusKm), JSON.stringify({ at: Date.now(), list })); } catch { /* abaikan */ }
  return list;
}
