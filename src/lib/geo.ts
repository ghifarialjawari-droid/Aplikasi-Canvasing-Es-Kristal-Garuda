// Perhitungan lokasi: titik depot, jarak (Haversine), validasi koordinat GPS,
// dan pengelompokan kunjungan per desa/kelurahan. Semua fungsi di sini murni
// (tanpa jaringan) supaya hasilnya bisa diuji dan konsisten di semua halaman.

export interface Depot {
  name: string;        // harus sama dengan kolom "cabang" pada data kunjungan/pegawai
  lat: number;
  lng: number;
  source: string;      // asal koordinat (untuk catatan)
  approx?: boolean;    // true = koordinat masih perkiraan, ganti dengan titik pasti
}

// TITIK PUSAT DEPOT (dipakai sebagai pusat perhitungan radius).
// Limbangan & Cibatu: dihitung dari Plus Code resmi Google Maps (ketelitian ~14 m).
// Tasikmalaya: GANTI dengan koordinat pasti Jl. Ibrahim Adjie No.21 (klik kanan di
// Google Maps > salin angka koordinat), lalu hapus baris `approx: true`.
export const DEPOTS: Depot[] = [
  { name: 'Limbangan', lat: -7.034563, lng: 107.982563, source: 'Plus Code XX8M+52R (Jl. Raya Limbangan Tengah, Balubur Limbangan)' },
  { name: 'Cibatu', lat: -7.097687, lng: 107.983688, source: 'Plus Code WX2M+WF8 (Jl. Arif Rahman Hakim, Keresek, Cibatu)' },
  { name: 'Tasikmalaya', lat: -7.291111, lng: 108.196667, approx: true, source: 'PERKIRAAN: titik tengah Kec. Indihiang (belum titik pasti Jl. Ibrahim Adjie No.21)' },
];

export const RADIUS_OPTIONS = [5, 10, 15, 20] as const;

const norm = (s: unknown) => String(s ?? '').trim().toLowerCase();

export function getDepot(name: string | undefined | null): Depot | null {
  const n = norm(name);
  return DEPOTS.find(d => norm(d.name) === n) || null;
}

// Batas kasar wilayah Indonesia. Koordinat di luar kotak ini pasti salah
// (mis. lat/lng tertukar, atau 0,0 dari GPS yang gagal).
const ID_LAT: [number, number] = [-11.5, 6.5];
const ID_LNG: [number, number] = [94.5, 141.5];

export type LocReason = 'kosong' | 'tidak_terbaca' | 'di_luar_rentang' | 'nol' | 'di_luar_indonesia' | 'tertukar';

export interface LocCheck {
  valid: boolean;
  lat: number | null;
  lng: number | null;
  reason?: LocReason;
  message?: string;
}

const REASON_TEXT: Record<LocReason, string> = {
  kosong: 'Koordinat kosong',
  tidak_terbaca: 'Koordinat tidak terbaca (bukan angka)',
  di_luar_rentang: 'Koordinat di luar rentang GPS',
  nol: 'Koordinat 0,0 (GPS gagal)',
  di_luar_indonesia: 'Koordinat di luar wilayah Indonesia',
  tertukar: 'Lintang/bujur tertukar',
};

const isBlank = (v: unknown) => v === null || v === undefined || (typeof v === 'string' && v.trim() === '');

// Mengubah "-7,2131" / " -7.2131 " / -7.2131 menjadi angka; null kalau tidak bisa.
export function parseCoord(v: unknown): number | null {
  if (isBlank(v)) return null;
  if (typeof v === 'number') return isFinite(v) ? v : null;
  const n = Number(String(v).trim().replace(',', '.'));
  return isFinite(n) ? n : null;
}

export function checkLocation(latRaw: unknown, lngRaw: unknown): LocCheck {
  const fail = (reason: LocReason, lat: number | null = null, lng: number | null = null): LocCheck =>
    ({ valid: false, lat, lng, reason, message: REASON_TEXT[reason] });

  if (isBlank(latRaw) || isBlank(lngRaw)) return fail('kosong');
  const lat = parseCoord(latRaw);
  const lng = parseCoord(lngRaw);
  if (lat === null || lng === null) return fail('tidak_terbaca');
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    // Kalau ditukar dan hasilnya masuk akal, beri tahu penyebab yang tepat.
    if (Math.abs(lng) <= 90 && Math.abs(lat) <= 180 && inIndonesia(lng, lat)) return fail('tertukar', lat, lng);
    return fail('di_luar_rentang', lat, lng);
  }
  if (lat === 0 && lng === 0) return fail('nol', lat, lng);
  if (!inIndonesia(lat, lng)) {
    if (inIndonesia(lng, lat)) return fail('tertukar', lat, lng);
    return fail('di_luar_indonesia', lat, lng);
  }
  return { valid: true, lat, lng };
}

function inIndonesia(lat: number, lng: number): boolean {
  return lat >= ID_LAT[0] && lat <= ID_LAT[1] && lng >= ID_LNG[0] && lng <= ID_LNG[1];
}

export function isValidCoord(lat: unknown, lng: unknown): boolean {
  return checkLocation(lat, lng).valid;
}

const EARTH_RADIUS_KM = 6371.0088;
const rad = (d: number) => (d * Math.PI) / 180;

// Jarak lingkaran besar (km) antara dua titik GPS.
export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLat = rad(lat2 - lat1);
  const dLng = rad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

// ---------- Nama desa ----------

// Menyeragamkan nama desa supaya "Desa Keresek", "keresek", "Kel. Keresek" dianggap sama.
export function normalizeVillage(name: unknown): string {
  return String(name ?? '')
    .toLowerCase()
    .replace(/\b(desa|kelurahan|kel|ds)\b\.?/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export interface GeoVisit {
  id: string;
  date: string;
  cabang: string;
  status: string;
  lat: number | null;
  lng: number | null;
  desa?: string;
  kecamatan?: string;
}

export interface VillageRow {
  key: string;            // nama ter-normalisasi
  desa: string;           // nama untuk ditampilkan
  kecamatan: string;
  visits: number;
  closing: number;
  prospek: number;
  avgKm: number | null;   // rata-rata jarak kunjungan dari depot
  visited: boolean;
  centerLat?: number;     // titik tengah desa (hanya dari daftar desa wilayah)
  centerLng?: number;
}

export interface KnownVillage { name: string; lat: number; lng: number; }

export interface DepotAnalysis {
  depot: Depot;
  radiusKm: number | null;      // null = tanpa batas
  total: number;                // kunjungan valid dalam radius
  outsideRadius: number;        // kunjungan valid tapi di luar radius
  invalid: number;              // lokasi tidak valid (tidak dihitung di atas)
  unresolved: number;           // valid, tapi desanya belum/tidak terdeteksi
  rows: VillageRow[];           // desa dikunjungi + (jika ada daftar desa) yang belum
  visitedCount: number;
  unvisitedCount: number;
  points: { id: string; lat: number; lng: number; status: string; km: number; desa: string }[];
}

export const UNKNOWN_VILLAGE = '(Desa tidak terdeteksi)';

// Analisis satu depot: hanya kunjungan ber-GPS valid, jarak dihitung dari titik depot.
// `known` = daftar desa di sekitar depot (opsional) untuk menentukan wilayah yang belum dikunjungi.
export function analyzeDepot(
  depot: Depot, visits: GeoVisit[], radiusKm: number | null, known: KnownVillage[] | null
): DepotAnalysis {
  const mine = visits.filter(v => norm(v.cabang) === norm(depot.name));
  const map = new Map<string, VillageRow & { _km: number }>();
  const points: DepotAnalysis['points'] = [];
  let invalid = 0, outside = 0, total = 0, unresolved = 0;

  for (const v of mine) {
    const c = checkLocation(v.lat, v.lng);
    if (!c.valid) { invalid++; continue; }
    const km = haversineKm(depot.lat, depot.lng, c.lat as number, c.lng as number);
    if (radiusKm !== null && km > radiusKm) { outside++; continue; }
    total++;
    const rawName = (v.desa || '').trim();
    if (!rawName) unresolved++;
    const display = rawName || UNKNOWN_VILLAGE;
    const key = rawName ? normalizeVillage(rawName) : '__unknown__';
    let row = map.get(key);
    if (!row) {
      row = { key, desa: display, kecamatan: (v.kecamatan || '').trim(), visits: 0, closing: 0, prospek: 0, avgKm: null, visited: true, _km: 0 };
      map.set(key, row);
    }
    row.visits++;
    row._km += km;
    if (v.status === 'Closing') row.closing++;
    else if (v.status === 'Prospek') row.prospek++;
    if (!row.kecamatan && v.kecamatan) row.kecamatan = String(v.kecamatan).trim();
    points.push({ id: v.id, lat: c.lat as number, lng: c.lng as number, status: v.status, km, desa: display });
  }

  const rows: VillageRow[] = [];
  map.forEach(r => { rows.push({ ...r, avgKm: r.visits ? r._km / r.visits : null }); });

  let unvisitedCount = 0;
  if (known) {
    for (const k of known) {
      const km = haversineKm(depot.lat, depot.lng, k.lat, k.lng);
      if (radiusKm !== null && km > radiusKm) continue;
      const key = normalizeVillage(k.name);
      const hit = rows.find(r => r.key === key);
      if (hit) { hit.centerLat = k.lat; hit.centerLng = k.lng; continue; }
      rows.push({ key, desa: k.name, kecamatan: '', visits: 0, closing: 0, prospek: 0, avgKm: null, visited: false, centerLat: k.lat, centerLng: k.lng });
      unvisitedCount++;
    }
  }

  rows.sort((a, b) => (b.visits - a.visits) || a.desa.localeCompare(b.desa, 'id'));
  const visitedCount = rows.filter(r => r.visited && r.key !== '__unknown__').length;
  return { depot, radiusKm, total, outsideRadius: outside, invalid, unresolved, rows, visitedCount, unvisitedCount, points };
}

// Daftar kunjungan ber-lokasi tidak valid (tidak dihapus, hanya ditandai).
export function findInvalidVisits<T extends { lat: unknown; lng: unknown }>(visits: T[]): { visit: T, check: LocCheck }[] {
  const out: { visit: T, check: LocCheck }[] = [];
  for (const v of visits) {
    const check = checkLocation(v.lat, v.lng);
    if (!check.valid) out.push({ visit: v, check });
  }
  return out;
}

// Membaca teks yang ditempel dari Google Maps, mis. "-7.0346, 107.9826".
export function parseLatLngText(text: string): { lat: number, lng: number } | null {
  const m = String(text || '').trim().match(/(-?\d+(?:[.,]\d+)?)\s*[,;\s]\s*(-?\d+(?:[.,]\d+)?)/);
  if (!m) return null;
  const lat = parseCoord(m[1]);
  const lng = parseCoord(m[2]);
  return lat === null || lng === null ? null : { lat, lng };
}
