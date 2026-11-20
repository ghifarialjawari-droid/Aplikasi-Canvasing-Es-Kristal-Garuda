import React, { useState, useMemo } from 'react';
import { FileText, Printer, Clock, MapPin, AlertTriangle, X, ExternalLink, Building2 } from 'lucide-react';
import { localDateStr, localMonthStr, normalizeTimeStr } from '../lib/dates';
import { pickDailyRecord } from '../lib/records';
import { checkLocation, findInvalidVisits, parseLatLngText, getDepot, haversineKm } from '../lib/geo';
import { monthLabel } from '../lib/targets';

// Tipe data disalin dari App.tsx supaya file ini berdiri sendiri
// (bisa di-lazy-load terpisah tanpa ikut menyeret komponen lain).
interface User {
  id: string;
  name: string;
  role: 'admin' | 'pegawai' | 'owner';
  cabang: string;
  status?: 'Aktif' | 'Nonaktif';
}

interface Visit {
  id: string;
  date: string;
  time: string;
  shopName: string;
  cabang: string;
  status: string;
  isNewCustomer: boolean;
  pegawaiId: string;
  lat: number | null;
  lng: number | null;
  desa?: string;
  kecamatan?: string;
}

interface Attendance {
  id: string;
  pegawaiId: string;
  date: string;
  checkInTime: string;
  checkOutTime?: string;
  status: string;
}

const Card = ({ children, className = '' }: { children: React.ReactNode, className?: string }) => (
  <div className={`bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden ${className}`}>
    {children}
  </div>
);

const Button = ({ children, onClick, variant = 'primary', className = '', type = 'button', disabled = false }: any) => {
  const base = "w-full py-3 px-4 rounded-xl font-semibold transition-all flex items-center justify-center gap-2 active:scale-95";
  const variants = {
    primary: "bg-blue-600 text-white shadow-md shadow-blue-200 hover:bg-blue-700 disabled:bg-blue-300",
    secondary: "bg-blue-50 text-blue-700 hover:bg-blue-100",
    outline: "border-2 border-slate-200 text-slate-700 hover:border-blue-600 hover:text-blue-600",
    danger: "bg-red-50 text-red-600 hover:bg-red-100",
    success: "bg-emerald-50 text-emerald-600 hover:bg-emerald-100"
  };
  return (
    <button type={type} onClick={onClick} disabled={disabled} className={`${base} ${variants[variant as keyof typeof variants]} ${className}`}>
      {children}
    </button>
  );
};

const Select = ({ label, value, onChange, options }: any) => (
  <div>
    <label className="block text-sm font-medium text-slate-600 mb-1.5">{label}</label>
    <select
      value={value} onChange={onChange}
      className="w-full bg-slate-50 border border-slate-200 text-slate-800 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all appearance-none"
    >
      {options.map((opt: any) => (
        <option key={opt.value || opt} value={opt.value || opt}>{opt.label || opt}</option>
      ))}
    </select>
  </div>
);

const minutesToHHmm = (m: number) => {
  const t = Math.round(m);
  const h = Math.floor(t / 60) % 24;
  return `${h < 10 ? '0' : ''}${h}:${t % 60 < 10 ? '0' : ''}${t % 60}`;
};

const rawCoord = (v: unknown) => (v === null || v === undefined || (typeof v === 'number' && !isFinite(v)) ? '-' : String(v));

// ---------- Form perbaikan lokasi (admin) ----------
const FixLocationModal = ({ visit, onClose, onSave }: {
  visit: Visit, onClose: () => void, onSave: (lat: number, lng: number) => void
}) => {
  const [latText, setLatText] = useState(visit.lat === null || visit.lat === undefined || !isFinite(Number(visit.lat)) ? '' : String(visit.lat));
  const [lngText, setLngText] = useState(visit.lng === null || visit.lng === undefined || !isFinite(Number(visit.lng)) ? '' : String(visit.lng));
  const [pasteText, setPasteText] = useState('');

  const check = checkLocation(latText, lngText);
  const depot = getDepot(visit.cabang);
  const distKm = check.valid && depot ? haversineKm(depot.lat, depot.lng, check.lat as number, check.lng as number) : null;

  const applyPaste = (text: string) => {
    setPasteText(text);
    const p = parseLatLngText(text);
    if (p) { setLatText(String(p.lat)); setLngText(String(p.lng)); }
  };

  const inputCls = "w-full bg-slate-50 border border-slate-200 text-slate-800 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white";

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[600] flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-between items-start mb-4">
          <div>
            <h3 className="font-bold text-slate-800 text-lg">Perbaiki Lokasi</h3>
            <p className="text-xs text-slate-500">{visit.shopName} - {visit.cabang} - {visit.date}</p>
          </div>
          <button onClick={onClose} className="p-1 bg-slate-100 rounded-full hover:bg-slate-200"><X size={16} /></button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-slate-600 mb-1.5">Tempel koordinat dari Google Maps (opsional)</label>
            <input value={pasteText} onChange={(e) => applyPaste(e.target.value)} placeholder="-7.0346, 107.9826" className={inputCls} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-slate-600 mb-1.5">Latitude</label>
              <input value={latText} onChange={(e) => setLatText(e.target.value)} inputMode="decimal" placeholder="-7.xxxxx" className={inputCls} />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-600 mb-1.5">Longitude</label>
              <input value={lngText} onChange={(e) => setLngText(e.target.value)} inputMode="decimal" placeholder="107.xxxxx" className={inputCls} />
            </div>
          </div>
          <button type="button" onClick={() => { const a = latText; setLatText(lngText); setLngText(a); }} className="text-xs font-semibold text-blue-600 hover:text-blue-700">
            Tukar Latitude / Longitude
          </button>

          <div className={`text-sm rounded-xl p-3 border ${check.valid ? 'bg-emerald-50 border-emerald-100 text-emerald-700' : 'bg-red-50 border-red-100 text-red-700'}`}>
            {check.valid
              ? <>Koordinat valid.{distKm !== null && <> Jarak ke depot {visit.cabang}: <b>{distKm.toFixed(1)} km</b>.</>}</>
              : <>{check.message || 'Koordinat belum diisi.'}</>}
          </div>

          <div className="flex gap-2 pt-1">
            <Button variant="outline" className="py-2 text-sm" disabled={!check.valid}
              onClick={() => check.valid && window.open(`https://www.google.com/maps?q=${check.lat},${check.lng}`, '_blank', 'noopener,noreferrer')}>
              <ExternalLink size={14} /> Cek di Maps
            </Button>
            <Button className="py-2 text-sm" disabled={!check.valid} onClick={() => check.valid && onSave(check.lat as number, check.lng as number)}>
              Simpan
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

const AdminReports = ({ visits, users, attendance, onEditVisit }: {
  visits: Visit[], users: User[], targets?: unknown, attendance?: Attendance[],
  onEditVisit?: (id: string, updates: Partial<Visit>) => void
}) => {
  const [month, setMonth] = useState(localMonthStr());
  const [selectedCabang, setSelectedCabang] = useState('Semua');
  const [fixing, setFixing] = useState<Visit | null>(null);
  const [notice, setNotice] = useState('');

  const attList: Attendance[] = attendance || [];
  const cabangList = useMemo(() => Array.from(new Set(users.filter(u => u.role === 'pegawai').map(u => u.cabang))), [users]);
  const depotRows = selectedCabang === 'Semua' ? cabangList : [selectedCabang];

  // ---------- Jumlah data canvasing ----------
  const monthVisits = useMemo(() => visits.filter(v => String(v.date).slice(0, 7) === month), [visits, month]);
  const visitsByDepot = depotRows.map(c => ({ cabang: c, count: monthVisits.filter(v => v.cabang === c).length }));
  const totalVisits = visitsByDepot.reduce((s, r) => s + r.count, 0);

  // ---------- Absensi ----------
  const pegawaiScope = users.filter(u => u.role === 'pegawai' && (selectedCabang === 'Semua' || u.cabang === selectedCabang));
  const attendanceRows = useMemo(() => {
    const monthAtt = attList.filter(a => String(a.date).slice(0, 7) === month);
    return pegawaiScope.map(u => {
      const dates = Array.from(new Set(monthAtt.filter(a => a.pegawaiId === u.id).map(a => a.date)));
      // satu catatan per hari (baris ganda dari dua HP dirapikan)
      const recs = dates.map(d => pickDailyRecord(monthAtt, u.id, d)).filter((r): r is Attendance => r !== null);
      const tepat = recs.filter(r => r.status === 'Tepat Waktu').length;
      const terlambat = recs.filter(r => r.status === 'Terlambat').length;
      const mins = recs
        .map(r => normalizeTimeStr(r.checkInTime))
        .filter((t): t is string => !!t)
        .map(t => { const [h, m] = t.split(':').map(Number); return h * 60 + m; });
      const avg = mins.length ? mins.reduce((s, x) => s + x, 0) / mins.length : null;
      return { id: u.id, name: u.name, cabang: u.cabang, hadir: recs.length, tepat, terlambat, avgMin: avg, sumMin: mins.reduce((s, x) => s + x, 0), nMin: mins.length };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attList, month, selectedCabang, users]);
  const totalTepat = attendanceRows.reduce((s, r) => s + r.tepat, 0);
  const totalTerlambat = attendanceRows.reduce((s, r) => s + r.terlambat, 0);
  const sumMin = attendanceRows.reduce((s, r) => s + r.sumMin, 0);
  const nMin = attendanceRows.reduce((s, r) => s + r.nMin, 0);
  const avgMasukAll = nMin ? minutesToHHmm(sumMin / nMin) : '-';

  // ---------- Lokasi tidak valid ----------
  const scopedVisits = useMemo(
    () => monthVisits.filter(v => selectedCabang === 'Semua' || v.cabang === selectedCabang),
    [monthVisits, selectedCabang]
  );
  const invalidList = useMemo(() => findInvalidVisits(scopedVisits), [scopedVisits]);
  const invalidAllTime = useMemo(() => findInvalidVisits(visits).length, [visits]);

  const handleSaveFix = (lat: number, lng: number) => {
    if (!fixing || !onEditVisit) return;
    // desa/kecamatan dikosongkan agar dikenali ulang dari koordinat yang baru
    onEditVisit(fixing.id, { lat, lng, desa: '', kecamatan: '' });
    setNotice(`Lokasi "${fixing.shopName}" diperbaiki.`);
    setFixing(null);
    setTimeout(() => setNotice(''), 3500);
  };

  const handleExportCSV = () => {
    const q = (s: string) => `"${String(s).replace(/"/g, '""')}"`;
    const lines: string[] = [];
    lines.push(['Laporan Bulanan', monthLabel(month), selectedCabang].map(q).join(','));
    lines.push('');
    lines.push(['Depot', 'Jumlah Canvasing'].map(q).join(','));
    visitsByDepot.forEach(r => lines.push([q(r.cabang), r.count].join(',')));
    lines.push([q('Total'), totalVisits].join(','));
    lines.push('');
    lines.push(['Pegawai', 'Depot', 'Hadir', 'Tepat Waktu', 'Terlambat', 'Rata-rata Jam Masuk'].map(q).join(','));
    attendanceRows.forEach(r => lines.push([q(r.name), q(r.cabang), r.hadir, r.tepat, r.terlambat, q(r.avgMin === null ? '-' : minutesToHHmm(r.avgMin))].join(',')));
    lines.push('');
    lines.push([q('Lokasi Tidak Valid'), invalidList.length].join(','));
    invalidList.forEach(({ visit, check }) => lines.push([q(visit.date), q(visit.shopName), q(visit.cabang), q(check.message || '')].join(',')));
    const blob = new Blob(['\uFEFF' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `laporan-bulanan-${month}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="p-6 md:p-8 space-y-6 bg-slate-50 min-h-screen">
      <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4 print:hidden">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-slate-800">Laporan Bulanan</h1>
          <p className="text-slate-500">Canvasing, absensi, dan kualitas data lokasi per bulan.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" className="py-2 w-auto px-4" onClick={handleExportCSV}><FileText size={16} /> Export Excel (CSV)</Button>
          <Button variant="outline" className="py-2 w-auto px-4" onClick={() => window.print()}><Printer size={16} /> Print / PDF</Button>
        </div>
      </div>

      <Card className="p-5 print:hidden">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-slate-600 mb-1.5">Bulan</label>
            <input type="month" value={month} onChange={(e) => setMonth(e.target.value || localMonthStr())} max={localDateStr().slice(0, 7)} className="w-full bg-slate-50 border border-slate-200 text-slate-800 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <Select label="Depot/Cabang" value={selectedCabang} onChange={(e: any) => setSelectedCabang(e.target.value)} options={['Semua', ...cabangList]} />
        </div>
        <p className="text-xs text-slate-400 mt-3">Menampilkan data {monthLabel(month)}{selectedCabang !== 'Semua' ? ` - depot ${selectedCabang}` : ' - semua depot'}</p>
      </Card>

      {notice && <div className="bg-emerald-50 border border-emerald-100 text-emerald-700 text-sm rounded-xl px-4 py-3 print:hidden">{notice}</div>}

      {/* JUMLAH DATA CANVASING */}
      <div>
        <h2 className="font-bold text-slate-800 text-lg mb-3 flex items-center gap-2"><Building2 size={20} className="text-blue-600" /> Jumlah Data Canvasing</h2>
        <Card className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm whitespace-nowrap">
              <thead className="bg-slate-100 text-slate-600 font-medium">
                <tr><th className="p-3">Depot/Cabang</th><th className="p-3 text-right">Jumlah Canvasing</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {visitsByDepot.map(r => (
                  <tr key={r.cabang}><td className="p-3 font-semibold text-slate-800">{r.cabang}</td><td className="p-3 text-right">{r.count}</td></tr>
                ))}
                {visitsByDepot.length === 0 && <tr><td colSpan={2} className="p-6 text-center text-slate-400">Belum ada depot.</td></tr>}
              </tbody>
              <tfoot className="bg-blue-50 text-blue-800 font-bold">
                <tr><td className="p-3">Total {selectedCabang === 'Semua' ? 'Seluruh Depot' : selectedCabang}</td><td className="p-3 text-right">{totalVisits}</td></tr>
              </tfoot>
            </table>
          </div>
        </Card>
      </div>

      {/* ABSENSI */}
      <div>
        <h2 className="font-bold text-slate-800 text-lg mb-3 flex items-center gap-2"><Clock size={20} className="text-blue-600" /> Absensi Karyawan</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
          <Card className="p-6 border-l-4 border-l-emerald-500">
            <p className="text-slate-500 text-sm font-medium">Tepat Waktu</p>
            <p className="text-3xl font-black text-slate-800 mt-2">{totalTepat}</p>
          </Card>
          <Card className="p-6 border-l-4 border-l-yellow-500">
            <p className="text-slate-500 text-sm font-medium">Terlambat</p>
            <p className="text-3xl font-black text-slate-800 mt-2">{totalTerlambat}</p>
          </Card>
          <Card className="p-6 border-l-4 border-l-blue-500">
            <p className="text-slate-500 text-sm font-medium">Rata-rata Jam Masuk</p>
            <p className="text-3xl font-black text-slate-800 mt-2">{avgMasukAll}</p>
          </Card>
        </div>
        <Card className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm whitespace-nowrap">
              <thead className="bg-slate-100 text-slate-600 font-medium">
                <tr>
                  <th className="p-3">Pegawai</th><th className="p-3">Depot</th>
                  <th className="p-3 text-right">Hadir</th><th className="p-3 text-right">Tepat Waktu</th>
                  <th className="p-3 text-right">Terlambat</th><th className="p-3 text-right">Rata-rata Jam Masuk</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {attendanceRows.map(r => (
                  <tr key={r.id}>
                    <td className="p-3 font-semibold text-slate-800">{r.name}</td>
                    <td className="p-3 text-slate-600">{r.cabang}</td>
                    <td className="p-3 text-right">{r.hadir}</td>
                    <td className="p-3 text-right text-emerald-600 font-medium">{r.tepat}</td>
                    <td className="p-3 text-right text-yellow-600 font-medium">{r.terlambat}</td>
                    <td className="p-3 text-right">{r.avgMin === null ? '-' : minutesToHHmm(r.avgMin)}</td>
                  </tr>
                ))}
                {attendanceRows.length === 0 && <tr><td colSpan={6} className="p-6 text-center text-slate-400">Belum ada pegawai.</td></tr>}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      {/* LOKASI TIDAK VALID */}
      <div>
        <h2 className="font-bold text-slate-800 text-lg mb-3 flex items-center gap-2"><MapPin size={20} className="text-blue-600" /> Lokasi Tidak Valid</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
          <Card className="p-6 border-l-4 border-l-red-500">
            <p className="text-slate-500 text-sm font-medium flex items-center gap-1"><AlertTriangle size={14} /> Bulan & depot ini</p>
            <p className="text-3xl font-black text-slate-800 mt-2">{invalidList.length}</p>
          </Card>
          <Card className="p-6 border-l-4 border-l-slate-400">
            <p className="text-slate-500 text-sm font-medium">Seluruh waktu & depot</p>
            <p className="text-3xl font-black text-slate-800 mt-2">{invalidAllTime}</p>
          </Card>
        </div>
        <p className="text-xs text-slate-400 mb-3">Data ini tidak dihapus, hanya tidak ikut perhitungan radius dan peta sampai lokasinya diperbaiki.</p>
        <Card className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm whitespace-nowrap">
              <thead className="bg-slate-100 text-slate-600 font-medium">
                <tr>
                  <th className="p-3">Tanggal</th><th className="p-3">Nama Toko</th><th className="p-3">Depot</th><th className="p-3">Sales</th>
                  <th className="p-3">Lat / Lng</th><th className="p-3">Masalah</th><th className="p-3 text-center print:hidden">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {invalidList.map(({ visit, check }) => (
                  <tr key={visit.id} className="hover:bg-slate-50">
                    <td className="p-3 text-slate-500">{visit.date}</td>
                    <td className="p-3 font-semibold text-slate-800">{visit.shopName}</td>
                    <td className="p-3 text-slate-600">{visit.cabang}</td>
                    <td className="p-3 text-slate-600">{users.find(u => u.id === visit.pegawaiId)?.name || '-'}</td>
                    <td className="p-3 text-slate-500">{rawCoord(visit.lat)} / {rawCoord(visit.lng)}</td>
                    <td className="p-3"><span className="px-2 py-1 rounded-full text-xs font-bold bg-red-100 text-red-700">Lokasi Tidak Valid</span> <span className="text-xs text-slate-400">{check.message}</span></td>
                    <td className="p-3 text-center print:hidden">
                      {onEditVisit && <button onClick={() => setFixing(visit)} className="px-3 py-1.5 bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100 text-xs font-semibold">Perbaiki</button>}
                    </td>
                  </tr>
                ))}
                {invalidList.length === 0 && <tr><td colSpan={7} className="p-6 text-center text-slate-400">Tidak ada lokasi tidak valid pada bulan & depot ini.</td></tr>}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      {fixing && <FixLocationModal visit={fixing} onClose={() => setFixing(null)} onSave={handleSaveFix} />}
    </div>
  );
};

export default AdminReports;
