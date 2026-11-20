// Reverse geocoding (GPS -> desa/kelurahan) memakai OpenStreetMap Nominatim, dan
// daftar desa di sekitar depot memakai OpenStreetMap Overpass. Keduanya gratis
// tanpa kunci API, tetapi ada aturan pemakaian wajar (maks. 1 permintaan/detik),
// sehingga hasilnya disimpan (cache) di HP dan di database supaya tiap titik
// cukup dicari satu kali.

import { KnownVillage } from './geo';

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

const VILLAGE_CACHE_PREFIX = 'esgaruda_villages_v1_';
const VILLAGE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 hari

export function loadCachedVillages(depotName: string, lat: number, lng: number, radiusKm: number): KnownVillage[] | null {
  try {
    const raw = localStorage.getItem(`${VILLAGE_CACHE_PREFIX}${depotName}_${lat.toFixed(4)}_${lng.toFixed(4)}_${radiusKm}`);
    if (!raw) return null;
    const p = JSON.parse(raw);
    if (!p || Date.now() - p.at > VILLAGE_TTL_MS || !Array.isArray(p.list)) return null;
    return p.list;
  } catch { return null; }
}

// Mengambil desa/kelurahan (admin_level 7 di OSM Indonesia) dalam radius dari depot.
// Mengembalikan titik tengah tiap desa.
export async function fetchVillagesAround(depotName: string, lat: number, lng: number, radiusKm: number): Promise<KnownVillage[]> {
  const cached = loadCachedVillages(depotName, lat, lng, radiusKm);
  if (cached) return cached;

  const around = `(around:${Math.round(radiusKm * 1000)},${lat},${lng})`;
  const query = `[out:json][timeout:40];rel["boundary"="administrative"]["admin_level"="7"]${around};out tags center;`;
  const json = await fetchJson(`${OVERPASS}?data=${encodeURIComponent(query)}`, undefined, 45000);
  const seen = new Set<string>();
  const list: KnownVillage[] = [];
  for (const el of (json && json.elements) || []) {
    const name = el.tags && (el.tags.name || el.tags['name:id']);
    const c = el.center || (typeof el.lat === 'number' ? { lat: el.lat, lon: el.lon } : null);
    if (!name || !c) continue;
    const k = `${String(name).toLowerCase()}|${Number(c.lat).toFixed(3)}|${Number(c.lon).toFixed(3)}`;
    if (seen.has(k)) continue;
    seen.add(k);
    list.push({ name: String(name), lat: Number(c.lat), lng: Number(c.lon) });
  }
  try {
    localStorage.setItem(`${VILLAGE_CACHE_PREFIX}${depotName}_${lat.toFixed(4)}_${lng.toFixed(4)}_${radiusKm}`, JSON.stringify({ at: Date.now(), list }));
  } catch { /* abaikan */ }
  return list;
}
