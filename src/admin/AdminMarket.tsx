import React, { useState, useEffect, useRef, useMemo } from 'react';
import { MapPin, RefreshCw, AlertTriangle, FileText, CheckCircle, XCircle } from 'lucide-react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { localMonthStr } from '../lib/dates';
import { monthLabel } from '../lib/targets';
import {
  DEPOTS, RADIUS_OPTIONS, Depot, KnownVillage, DepotAnalysis, UNKNOWN_VILLAGE,
  analyzeDepot, checkLocation, getDepot
} from '../lib/geo';
import {
  reverseGeocode, geoKey, loadGeoCache, saveGeoCache, fetchVillagesAround, GEOCODE_INTERVAL_MS
} from '../lib/geocode';

// Tipe data disalin dari App.tsx supaya file ini berdiri sendiri
// (bisa di-lazy-load terpisah tanpa ikut menyeret komponen lain).
interface User {
  id: string;
  name: string;
  role: 'admin' | 'pegawai' | 'owner';
  cabang: string;
}

interface Visit {
  id: string;
  date: string;
  time: string;
  shopName: string;
  cabang: string;
  lat: number | null;
  lng: number | null;
  status: string;
  pegawaiId: string;
  desa?: string;
  kecamatan?: string;
}

export interface GeoUpdate { id: string; desa: string; kecamatan: string; }

const Card = ({ children, className = '' }: { children: React.ReactNode, className?: string }) => (
  <div className={`bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden ${className}`}>
    {children}
  </div>
);

const Select = ({ label, value, onChange, options }: any) => (
  <div>
    <label className="block text-sm font-medium text-slate-600 mb-1.5">{label}</label>
    <select
      value={value} onChange={onChange}
      className="w-full bg-slate-50 border border-slate-200 text-slate-800 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all appearance-none"
    >
      {options.map((opt: any) => (
        <option key={opt.value ?? opt} value={opt.value ?? opt}>{opt.label ?? opt}</option>
      ))}
    </select>
  </div>
);

const KNOWN_RADIUS_KM = 20; // daftar desa selalu diambil sampai radius terbesar, lalu disaring lokal
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

type KnownState = { state: 'loading' | 'ok' | 'error'; list: KnownVillage[] };

const AdminMarket = ({ visits, users, onSaveGeo }: {
  visits: Visit[], users: User[], onSaveGeo?: (items: GeoUpdate[]) => void
}) => {
  const [month, setMonth] = useState<string>(localMonthStr());
  const [depotFilter, setDepotFilter] = useState('Semua');
  const [radius, setRadius] = useState<string>('20');
  const [statusTab, setStatusTab] = useState<'semua' | 'sudah' | 'belum'>('semua');
  const [known, setKnown] = useState<Record<string, KnownState>>({});
  const [knownTick, setKnownTick] = useState(0);
  const [geo, setGeo] = useState<{ running: boolean; done: number; total: number; error: string }>({ running: false, done: 0, total: 0, error: '' });
  const [geoTick, setGeoTick] = useState(0);

  const radiusKm: number | null = radius === 'semua' ? null : Number(radius);

  const mapDivRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  const mountedRef = useRef(true);
  const runningRef = useRef(false);
  const onSaveGeoRef = useRef(onSaveGeo);
  onSaveGeoRef.current = onSaveGeo;
  const visitsRef = useRef(visits);
  visitsRef.current = visits;

  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);

  const shownDepots: Depot[] = depotFilter === 'Semua' ? DEPOTS : DEPOTS.filter(d => d.name === depotFilter);
  const depotOptions = ['Semua', ...DEPOTS.map(d => d.name)];
  const cabangTanpaTitik = Array.from(new Set(users.filter(u => u.role === 'pegawai').map(u => u.cabang))).filter(c => !getDepot(c));

  // ---------- Kenali desa dari GPS (reverse geocoding), sekali per titik ----------
  // Hanya kunjungan dengan koordinat VALID yang diproses. Hasil disimpan di HP (cache)
  // dan di database (kolom desa/kecamatan), jadi data lama pun terisi bertahap.
  const needSig = useMemo(
    () => visits.filter(v => !(v.desa && String(v.desa).trim()) && checkLocation(v.lat, v.lng).valid).map(v => v.id).join(','),
    [visits]
  );

  useEffect(() => {
    if (runningRef.current) return;
    const cache = loadGeoCache();
    const cacheHits: GeoUpdate[] = [];
    const todo: { id: string; lat: number; lng: number; key: string }[] = [];
    for (const v of visitsRef.current) {
      if (v.desa && String(v.desa).trim()) continue;
      const c = checkLocation(v.lat, v.lng);
      if (!c.valid) continue;
      const key = geoKey(c.lat as number, c.lng as number);
      const hit = cache[key];
      if (hit && hit.desa) cacheHits.push({ id: v.id, desa: hit.desa, kecamatan: hit.kecamatan });
      else if (hit && hit.miss) continue; // OSM memang tidak punya nama desa di titik ini
      else todo.push({ id: v.id, lat: c.lat as number, lng: c.lng as number, key });
    }
    if (cacheHits.length && onSaveGeoRef.current) onSaveGeoRef.current(cacheHits);
    if (todo.length === 0) return;

    runningRef.current = true;
    (async () => {
      setGeo({ running: true, done: 0, total: todo.length, error: '' });
      const batch: GeoUpdate[] = [];
      let failures = 0;
      let stopped = false;
      const flush = () => { if (batch.length && onSaveGeoRef.current) onSaveGeoRef.current(batch.splice(0, batch.length)); };

      for (let i = 0; i < todo.length; i++) {
        if (!mountedRef.current) { stopped = true; break; }
        const t = todo[i];
        let hit = cache[t.key];
        if (!hit) {
          try {
            const g = await reverseGeocode(t.lat, t.lng);
            hit = g.desa ? g : { ...g, miss: true };
            cache[t.key] = hit;
            saveGeoCache(cache);
            failures = 0;
          } catch {
            failures++;
            if (failures >= 3) {
              if (mountedRef.current) setGeo(s => ({ ...s, error: 'Layanan pengenal desa (OpenStreetMap) tidak dapat dihubungi. Periksa koneksi lalu coba lagi.' }));
              stopped = true;
              break;
            }
            i--; // ulangi titik yang sama
            await sleep(2500);
            continue;
          }
          await sleep(GEOCODE_INTERVAL_MS); // aturan pemakaian Nominatim: maks. 1 permintaan/detik
        }
        if (hit && hit.desa) batch.push({ id: t.id, desa: hit.desa, kecamatan: hit.kecamatan });
        if (batch.length >= 10) flush();
        if (mountedRef.current) setGeo(s => ({ ...s, done: i + 1 }));
      }
      flush();
      runningRef.current = false;
      if (mountedRef.current) {
        setGeo(s => ({ ...s, running: false }));
        if (!stopped) setGeoTick(x => x + 1); // cek ulang kalau ada data baru masuk selama proses
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needSig, geoTick]);

  // ---------- Daftar desa di sekitar tiap depot (untuk wilayah yang belum dikunjungi) ----------
  useEffect(() => {
    let cancelled = false;
    (async () => {
      for (const d of shownDepots) {
        if (cancelled) return;
        const cur = known[d.name];
        if (cur && (cur.state === 'ok' || cur.state === 'loading')) continue;
        setKnown(k => ({ ...k, [d.name]: { state: 'loading', list: [] } }));
        try {
          const list = await fetchVillagesAround(d.name, d.lat, d.lng, KNOWN_RADIUS_KM);
          if (!cancelled) setKnown(k => ({ ...k, [d.name]: { state: 'ok', list } }));
        } catch {
          if (!cancelled) setKnown(k => ({ ...k, [d.name]: { state: 'error', list: [] } }));
        }
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [depotFilter, knownTick]);

  // ---------- Perhitungan ----------
  const periodVisits = useMemo(
    () => (month ? visits.filter(v => String(v.date).slice(0, 7) === month) : visits),
    [visits, month]
  );

  const analyses: DepotAnalysis[] = useMemo(
    () => shownDepots.map(d => {
      const k = known[d.name];
      return analyzeDepot(d, periodVisits, radiusKm, k && k.state === 'ok' && k.list.length > 0 ? k.list : null);
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [periodVisits, radiusKm, known, depotFilter]
  );

  const totalValid = analyses.reduce((s, a) => s + a.total, 0);
  const totalInvalid = analyses.reduce((s, a) => s + a.invalid, 0);
  const totalUnresolved = analyses.reduce((s, a) => s + a.unresolved, 0);

  // ---------- Peta ----------
  useEffect(() => {
    if (!mapDivRef.current || mapRef.current) return;
    const map = L.map(mapDivRef.current).setView([-7.15, 108.0], 10);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 19,
    }).addTo(map);
    layerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    return () => { map.remove(); mapRef.current = null; layerRef.current = null; };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();
    const bounds: [number, number][] = [];

    analyses.forEach(a => {
      const d = a.depot;
      bounds.push([d.lat, d.lng]);
      if (a.radiusKm !== null) {
        L.circle([d.lat, d.lng], { radius: a.radiusKm * 1000, color: '#2563eb', weight: 1.5, fillColor: '#2563eb', fillOpacity: 0.05 }).addTo(layer);
        // ikut masuk ke batas tampilan supaya seluruh lingkaran terlihat
        const dLat = a.radiusKm / 111;
        bounds.push([d.lat - dLat, d.lng], [d.lat + dLat, d.lng]);
      }
      const depotIcon = L.divIcon({
        className: '',
        html: '<div style="background:#1d4ed8;width:20px;height:20px;border-radius:5px;border:3px solid white;box-shadow:0 2px 6px rgba(0,0,0,.45)"></div>',
        iconSize: [20, 20], iconAnchor: [10, 10],
      });
      L.marker([d.lat, d.lng], { icon: depotIcon }).bindTooltip(`Depot ${d.name}${d.approx ? ' (titik perkiraan)' : ''}`, { direction: 'top', offset: [0, -8] }).addTo(layer);

      // desa yang belum dikunjungi (titik tengah desa)
      a.rows.filter(r => !r.visited && r.centerLat !== undefined && r.centerLng !== undefined).forEach(r => {
        L.circleMarker([r.centerLat as number, r.centerLng as number], { radius: 5, color: '#64748b', weight: 2, fillColor: '#ffffff', fillOpacity: 1 })
          .bindTooltip(`${r.desa} - belum dikunjungi`, { direction: 'top' }).addTo(layer);
      });

      // kunjungan valid dalam radius (lokasi tidak valid tidak digambar)
      a.points.forEach(p => {
        L.circleMarker([p.lat, p.lng], { radius: 6, color: '#ffffff', weight: 2, fillColor: p.status === 'Closing' ? '#10b981' : '#f472b6', fillOpacity: 0.95 })
          .bindTooltip(`${p.desa} - ${p.km.toFixed(1)} km dari depot`, { direction: 'top' }).addTo(layer);
        bounds.push([p.lat, p.lng]);
      });
    });

    if (bounds.length > 0) map.fitBounds(L.latLngBounds(bounds), { padding: [30, 30], maxZoom: 14 });
    setTimeout(() => map.invalidateSize(), 50);
  }, [analyses]);

  // ---------- Export ----------
  const handleExportCSV = () => {
    const q = (s: unknown) => `"${String(s ?? '').replace(/"/g, '""')}"`;
    const lines = [['Depot', 'Desa/Kelurahan', 'Kecamatan', 'Kunjungan', 'Closing', 'Prospek', 'Rata-rata Jarak (km)', 'Status'].map(q).join(',')];
    analyses.forEach(a => a.rows.forEach(r => lines.push([
      q(a.depot.name), q(r.desa), q(r.kecamatan), r.visits, r.closing, r.prospek,
      q(r.avgKm === null ? '' : r.avgKm.toFixed(1)), q(r.visited ? 'Sudah dikunjungi' : 'Belum dikunjungi'),
    ].join(','))));
    const blob = new Blob(['\uFEFF' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `analisis-pasar-${month || 'semua'}-${radius === 'semua' ? 'semua-jarak' : radius + 'km'}.csv`;
    document.body.appendChild(link); link.click(); document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="p-6 md:p-8 space-y-6 bg-slate-50 min-h-screen">
      <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-slate-800">Analisis Pasar</h1>
          <p className="text-slate-500">Sebaran kunjungan canvasing per desa/kelurahan di sekitar tiap depot.</p>
        </div>
        <button onClick={handleExportCSV} className="px-3 py-2 bg-white border border-slate-200 text-slate-700 rounded-xl text-sm font-semibold hover:border-blue-600 hover:text-blue-600 flex items-center gap-1.5 shadow-sm w-fit">
          <FileText size={14} /> Export CSV
        </button>
      </div>

      <Card className="p-5">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium text-slate-600 mb-1.5">Bulan</label>
            <div className="flex gap-2">
              <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="flex-1 min-w-0 bg-slate-50 border border-slate-200 text-slate-800 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-blue-500" />
              <button onClick={() => setMonth(month ? '' : localMonthStr())} className="px-3 text-xs font-semibold text-blue-600 hover:text-blue-700 whitespace-nowrap">{month ? 'Semua waktu' : 'Bulan ini'}</button>
            </div>
          </div>
          <Select label="Depot" value={depotFilter} onChange={(e: any) => setDepotFilter(e.target.value)} options={depotOptions} />
          <Select label="Radius dari depot" value={radius} onChange={(e: any) => setRadius(e.target.value)}
            options={[...RADIUS_OPTIONS.map(r => ({ value: String(r), label: `${r} km` })), { value: 'semua', label: 'Semua jarak' }]} />
        </div>
        <p className="text-xs text-slate-400 mt-3">
          {month ? monthLabel(month) : 'Semua waktu'} - {radiusKm === null ? 'tanpa batas jarak' : `dalam radius ${radiusKm} km`} dari titik depot. Jarak dihitung dari koordinat GPS setiap kunjungan.
        </p>
      </Card>

      {shownDepots.some(d => d.approx) && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded-xl px-4 py-3 flex gap-2">
          <AlertTriangle size={18} className="flex-shrink-0 mt-0.5" />
          <span>Titik depot Tasikmalaya masih perkiraan (tengah Kecamatan Indihiang), jadi hasil radiusnya belum akurat. Ganti dengan koordinat pasti Jl. Ibrahim Adjie No.21 di <code>lib/geo.ts</code>.</span>
        </div>
      )}

      {geo.running && (
        <div className="bg-blue-50 border border-blue-100 text-blue-700 text-sm rounded-xl px-4 py-3 flex items-center gap-2">
          <RefreshCw size={16} className="animate-spin flex-shrink-0" />
          <span>Mengenali desa dari GPS: {geo.done}/{geo.total}. Proses berjalan di latar belakang dan hasilnya disimpan, jadi cukup sekali per titik.</span>
        </div>
      )}
      {geo.error && (
        <div className="bg-red-50 border border-red-100 text-red-700 text-sm rounded-xl px-4 py-3 flex items-center justify-between gap-3">
          <span>{geo.error}</span>
          <button onClick={() => { setGeo(s => ({ ...s, error: '' })); setGeoTick(x => x + 1); }} className="font-semibold underline whitespace-nowrap">Coba lagi</button>
        </div>
      )}

      {/* RINGKASAN */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="p-6 border-l-4 border-l-blue-500">
          <p className="text-slate-500 text-sm font-medium">Kunjungan Dihitung</p>
          <p className="text-3xl font-black text-slate-800 mt-2">{totalValid}</p>
        </Card>
        <Card className="p-6 border-l-4 border-l-emerald-500">
          <p className="text-slate-500 text-sm font-medium">Desa Sudah Dikunjungi</p>
          <p className="text-3xl font-black text-slate-800 mt-2">{analyses.reduce((s, a) => s + a.visitedCount, 0)}</p>
        </Card>
        <Card className="p-6 border-l-4 border-l-slate-400">
          <p className="text-slate-500 text-sm font-medium">Desa Belum Dikunjungi</p>
          <p className="text-3xl font-black text-slate-800 mt-2">{analyses.reduce((s, a) => s + a.unvisitedCount, 0)}</p>
        </Card>
        <Card className="p-6 border-l-4 border-l-red-500">
          <p className="text-slate-500 text-sm font-medium">Lokasi Tidak Valid (dikecualikan)</p>
          <p className="text-3xl font-black text-slate-800 mt-2">{totalInvalid}</p>
        </Card>
      </div>
      {totalUnresolved > 0 && !geo.running && (
        <p className="text-xs text-slate-500 -mt-2">{totalUnresolved} kunjungan ber-GPS valid belum/tidak terdeteksi desanya; ditampilkan pada baris "{UNKNOWN_VILLAGE}".</p>
      )}
      {cabangTanpaTitik.length > 0 && (
        <p className="text-xs text-slate-500 -mt-2">Depot tanpa titik koordinat (tidak ikut analisis radius): {cabangTanpaTitik.join(', ')}.</p>
      )}

      {/* PETA */}
      <Card className="p-0 relative h-[55vh] min-h-[360px] md:h-[520px]">
        <div ref={mapDivRef} className="w-full h-full z-0" />
        <div className="absolute top-3 left-3 z-[400] bg-white/90 p-3 rounded-xl shadow-md border border-white backdrop-blur text-xs font-medium space-y-1.5 pointer-events-none">
          <div className="flex items-center gap-2"><div className="w-3 h-3 rounded-sm bg-blue-700"></div> Depot</div>
          <div className="flex items-center gap-2"><div className="w-3 h-3 rounded-full bg-emerald-500"></div> Closing</div>
          <div className="flex items-center gap-2"><div className="w-3 h-3 rounded-full bg-pink-400"></div> Prospek</div>
          <div className="flex items-center gap-2"><div className="w-3 h-3 rounded-full border-2 border-slate-500 bg-white"></div> Desa belum dikunjungi</div>
        </div>
      </Card>

      {/* TABEL PER DEPOT */}
      <div className="flex gap-2 bg-slate-100 p-1 rounded-xl w-fit">
        {([['semua', 'Semua Desa'], ['sudah', 'Sudah Dikunjungi'], ['belum', 'Belum Dikunjungi']] as const).map(([k, label]) => (
          <button key={k} onClick={() => setStatusTab(k)} className={`px-3 py-2 rounded-lg text-sm font-semibold ${statusTab === k ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500'}`}>{label}</button>
        ))}
      </div>

      {analyses.map(a => {
        const k = known[a.depot.name];
        const rows = a.rows.filter(r => statusTab === 'semua' || (statusTab === 'sudah' ? r.visited : !r.visited));
        return (
          <Card key={a.depot.name} className="p-0">
            <div className="p-4 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <h3 className="font-bold text-slate-800 flex items-center gap-2"><MapPin size={18} className="text-blue-600" /> Depot {a.depot.name}</h3>
              <p className="text-xs text-slate-500">
                {a.total} kunjungan - {a.visitedCount} desa dikunjungi - {a.unvisitedCount} belum
                {a.outsideRadius > 0 && ` - ${a.outsideRadius} di luar radius`}
                {a.invalid > 0 && ` - ${a.invalid} lokasi tidak valid`}
              </p>
            </div>
            {k && k.state === 'loading' && <p className="px-4 pt-3 text-xs text-slate-400 flex items-center gap-1"><RefreshCw size={12} className="animate-spin" /> Memuat daftar desa di sekitar depot...</p>}
            {k && k.state === 'error' && (
              <p className="px-4 pt-3 text-xs text-amber-700">
                Daftar seluruh desa tidak dapat dimuat, jadi "belum dikunjungi" belum tersedia.{' '}
                <button className="font-semibold underline" onClick={() => { setKnown(s => { const n = { ...s }; delete n[a.depot.name]; return n; }); setKnownTick(x => x + 1); }}>Coba lagi</button>
              </p>
            )}
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm whitespace-nowrap">
                <thead className="bg-slate-100 text-slate-600 font-medium">
                  <tr>
                    <th className="p-3">Desa/Kelurahan</th><th className="p-3">Kecamatan</th>
                    <th className="p-3 text-right">Kunjungan</th><th className="p-3 text-right">Closing</th><th className="p-3 text-right">Prospek</th>
                    <th className="p-3 text-right">Jarak Rata-rata</th><th className="p-3">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.map(r => (
                    <tr key={r.key + r.desa} className="hover:bg-slate-50">
                      <td className="p-3 font-semibold text-slate-800">{r.desa}</td>
                      <td className="p-3 text-slate-600">{r.kecamatan || '-'}</td>
                      <td className="p-3 text-right font-bold">{r.visits}</td>
                      <td className="p-3 text-right text-emerald-600">{r.closing}</td>
                      <td className="p-3 text-right text-pink-500">{r.prospek}</td>
                      <td className="p-3 text-right text-slate-500">{r.avgKm === null ? '-' : `${r.avgKm.toFixed(1)} km`}</td>
                      <td className="p-3">
                        {r.visited
                          ? <span className="px-2 py-1 rounded-full text-xs font-bold bg-emerald-100 text-emerald-700 inline-flex items-center gap-1"><CheckCircle size={12} /> Sudah dikunjungi</span>
                          : <span className="px-2 py-1 rounded-full text-xs font-bold bg-slate-100 text-slate-600 inline-flex items-center gap-1"><XCircle size={12} /> Belum dikunjungi</span>}
                      </td>
                    </tr>
                  ))}
                  {rows.length === 0 && <tr><td colSpan={7} className="p-6 text-center text-slate-400">Tidak ada data untuk filter ini.</td></tr>}
                </tbody>
              </table>
            </div>
          </Card>
        );
      })}
    </div>
  );
};

export default AdminMarket;
