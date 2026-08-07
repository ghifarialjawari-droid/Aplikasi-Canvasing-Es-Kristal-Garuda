import React, { useState } from 'react';
import { FileText, Printer, Award, TrendingUp, Building2 } from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from 'recharts';

// Tipe data disalin dari App.tsx supaya file ini berdiri sendiri
// (bisa di-lazy-load terpisah tanpa ikut menyeret komponen lain).
interface User {
  id: string;
  name: string;
  role: 'admin' | 'pegawai' | 'owner';
  cabang: string;
  target: { visits: number; newCustomers: number };
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

type PeriodType = 'hari' | 'minggu' | 'bulan' | 'tahun';

// Menentukan rentang tanggal berdasarkan jenis periode & tanggal acuan
function getRange(period: PeriodType, refDate: string): { start: string, end: string } {
  const ref = new Date(refDate + 'T00:00:00');
  if (period === 'hari') return { start: refDate, end: refDate };
  if (period === 'minggu') {
    const day = ref.getDay();
    const diffToMonday = day === 0 ? -6 : 1 - day;
    const monday = new Date(ref);
    monday.setDate(ref.getDate() + diffToMonday);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    return { start: monday.toISOString().split('T')[0], end: sunday.toISOString().split('T')[0] };
  }
  if (period === 'bulan') {
    const first = new Date(ref.getFullYear(), ref.getMonth(), 1);
    const last = new Date(ref.getFullYear(), ref.getMonth() + 1, 0);
    return { start: first.toISOString().split('T')[0], end: last.toISOString().split('T')[0] };
  }
  // tahun
  const first = new Date(ref.getFullYear(), 0, 1);
  const last = new Date(ref.getFullYear(), 11, 31);
  return { start: first.toISOString().split('T')[0], end: last.toISOString().split('T')[0] };
}

const AdminReports = ({ visits, users }: { visits: Visit[], users: User[] }) => {
  const todayStr = new Date().toISOString().split('T')[0];
  const [reportType, setReportType] = useState<'depot' | 'semua'>('depot');
  const [period, setPeriod] = useState<PeriodType>('bulan');
  const [refDate, setRefDate] = useState(todayStr);
  const [selectedCabangRaw, setSelectedCabang] = useState('');
  const [selectedPegawai, setSelectedPegawai] = useState('Semua');

  const cabangList = Array.from(new Set(users.filter(u => u.role === 'pegawai').map(u => u.cabang)));
  const selectedCabang = selectedCabangRaw || cabangList[0] || '';

  const { start, end } = getRange(period, refDate);
  const periodVisits = visits.filter(v => v.date >= start && v.date <= end);

  // ---------- LAPORAN PER DEPOT ----------
  const depotVisits = periodVisits.filter(v => v.cabang === selectedCabang);
  const pegawaiDepot = users.filter(u => u.role === 'pegawai' && u.cabang === selectedCabang);
  const pegawaiFilterList = ['Semua', ...pegawaiDepot.map(u => u.name)];
  const depotVisitsFiltered = selectedPegawai === 'Semua' ? depotVisits : depotVisits.filter(v => {
    const peg = users.find(u => u.id === v.pegawaiId);
    return peg?.name === selectedPegawai;
  });

  const totalKunjunganDepot = depotVisitsFiltered.length;
  const customerBaruDepot = depotVisitsFiltered.filter(v => v.isNewCustomer).length;
  const customerLamaDepot = totalKunjunganDepot - customerBaruDepot;
  const targetDepot = pegawaiDepot.reduce((sum, u) => sum + (u.target?.visits || 0), 0);
  const pctDepot = targetDepot > 0 ? Math.min(100, Math.round((totalKunjunganDepot / targetDepot) * 100)) : 0;

  const rankingDepot = pegawaiDepot.map(u => {
    const uv = depotVisits.filter(v => v.pegawaiId === u.id);
    return { name: u.name, visits: uv.length, tokoBaru: uv.filter(v => v.isNewCustomer).length };
  }).sort((a, b) => b.visits - a.visits);

  const dayNames = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];
  const grafikHarianDepot: { name: string, kunjungan: number }[] = [];
  {
    const startD = new Date(start + 'T00:00:00');
    const endD = new Date(end + 'T00:00:00');
    const diffDays = Math.min(31, Math.round((endD.getTime() - startD.getTime()) / 86400000) + 1);
    for (let i = 0; i < diffDays; i++) {
      const d = new Date(startD);
      d.setDate(startD.getDate() + i);
      const dateStr = d.toISOString().split('T')[0];
      grafikHarianDepot.push({
        name: `${d.getDate()} ${dayNames[d.getDay()]}`,
        kunjungan: depotVisits.filter(v => v.date === dateStr).length,
      });
    }
  }

  // ---------- LAPORAN SEMUA DEPOT ----------
  const rankingSemuaDepot = cabangList.map((c) => {
    const cv = periodVisits.filter(v => v.cabang === c);
    const pegawaiC = users.filter(u => u.role === 'pegawai' && u.cabang === c);
    const targetC = pegawaiC.reduce((sum, u) => sum + (u.target?.visits || 0), 0);
    return {
      cabang: c,
      visits: cv.length,
      tokoBaru: cv.filter(v => v.isNewCustomer).length,
      target: targetC,
      pct: targetC > 0 ? Math.round((cv.length / targetC) * 100) : 0,
    };
  }).sort((a, b) => b.visits - a.visits);

  const depotTerbaikSemua = rankingSemuaDepot[0];
  const totalKunjunganSemua = rankingSemuaDepot.reduce((s, d) => s + d.visits, 0);
  const totalTargetSemua = rankingSemuaDepot.reduce((s, d) => s + d.target, 0);

  let pegawaiTerbaikSemua: { name: string, cabang: string, visits: number } | null = null;
  users.filter(u => u.role === 'pegawai').forEach((u) => {
    const uv = periodVisits.filter(v => v.pegawaiId === u.id).length;
    if (!pegawaiTerbaikSemua || uv > pegawaiTerbaikSemua.visits) {
      pegawaiTerbaikSemua = { name: u.name, cabang: u.cabang, visits: uv };
    }
  });

  const handleExportCSV = () => {
    let headers: string[];
    let rows: string[][];
    if (reportType === 'depot') {
      headers = ['Nama Pegawai', 'Kunjungan', 'Toko Baru'];
      rows = rankingDepot.map(r => [r.name, String(r.visits), String(r.tokoBaru)]);
    } else {
      headers = ['Cabang/Depot', 'Kunjungan', 'Toko Baru', 'Target', 'Persentase'];
      rows = rankingSemuaDepot.map(r => [r.cabang, String(r.visits), String(r.tokoBaru), String(r.target), `${r.pct}%`]);
    }
    const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `laporan-${reportType}-${start}-${end}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handlePrint = () => window.print();

  return (
    <div className="p-6 md:p-8 space-y-6 bg-slate-50 min-h-screen">
      <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4 print:hidden">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-slate-800">Laporan Bulanan</h1>
          <p className="text-slate-500">Ringkasan performa canvasing per depot maupun seluruh depot.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" className="py-2 w-auto px-4" onClick={handleExportCSV}><FileText size={16} /> Export Excel (CSV)</Button>
          <Button variant="outline" className="py-2 w-auto px-4" onClick={handlePrint}><Printer size={16} /> Print / PDF</Button>
        </div>
      </div>

      <div className="flex gap-2 bg-slate-100 p-1 rounded-xl w-fit print:hidden">
        <button onClick={() => setReportType('depot')} className={`px-4 py-2 rounded-lg text-sm font-semibold ${reportType === 'depot' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500'}`}>Laporan Per Depot</button>
        <button onClick={() => setReportType('semua')} className={`px-4 py-2 rounded-lg text-sm font-semibold ${reportType === 'semua' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500'}`}>Laporan Semua Depot</button>
      </div>

      <Card className="p-5 print:hidden">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Select label="Periode" value={period} onChange={(e: any) => setPeriod(e.target.value)} options={[{ value: 'hari', label: 'Harian' }, { value: 'minggu', label: 'Mingguan' }, { value: 'bulan', label: 'Bulanan' }, { value: 'tahun', label: 'Tahunan' }]} />
          <div>
            <label className="block text-sm font-medium text-slate-600 mb-1.5">Tanggal Acuan</label>
            <input type="date" value={refDate} onChange={(e) => setRefDate(e.target.value)} className="w-full bg-slate-50 border border-slate-200 text-slate-800 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          {reportType === 'depot' && (
            <>
              <Select label="Depot/Cabang" value={selectedCabang} onChange={(e: any) => { setSelectedCabang(e.target.value); setSelectedPegawai('Semua'); }} options={cabangList} />
              <Select label="Pegawai" value={selectedPegawai} onChange={(e: any) => setSelectedPegawai(e.target.value)} options={pegawaiFilterList} />
            </>
          )}
        </div>
        <p className="text-xs text-slate-400 mt-3">Menampilkan data dari {start} sampai {end}</p>
      </Card>

      {reportType === 'depot' ? (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
            <Card className="p-6 border-l-4 border-l-blue-500">
              <p className="text-slate-500 text-sm font-medium">Total Kunjungan</p>
              <p className="text-3xl font-black text-slate-800 mt-2">{totalKunjunganDepot}</p>
            </Card>
            <Card className="p-6 border-l-4 border-l-emerald-500">
              <p className="text-slate-500 text-sm font-medium">Customer Baru</p>
              <p className="text-3xl font-black text-slate-800 mt-2">{customerBaruDepot}</p>
            </Card>
            <Card className="p-6 border-l-4 border-l-indigo-500">
              <p className="text-slate-500 text-sm font-medium">Customer Lama</p>
              <p className="text-3xl font-black text-slate-800 mt-2">{customerLamaDepot}</p>
            </Card>
            <Card className="p-6 border-l-4 border-l-purple-500">
              <p className="text-slate-500 text-sm font-medium">Target / Realisasi</p>
              <p className="text-2xl font-black text-slate-800 mt-2">{totalKunjunganDepot}/{targetDepot} <span className="text-sm text-slate-400">({pctDepot}%)</span></p>
            </Card>
          </div>

          <Card className="p-6">
            <h3 className="font-bold text-slate-800 mb-6 text-lg">Grafik Kunjungan Harian</h3>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={grafikHarianDepot}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                  <XAxis dataKey="name" axisLine={false} tickLine={false} interval={Math.ceil(grafikHarianDepot.length / 10)} />
                  <YAxis axisLine={false} tickLine={false} allowDecimals={false} />
                  <Tooltip cursor={{ fill: '#f1f5f9' }} />
                  <Bar dataKey="kunjungan" fill="#2563eb" radius={[4, 4, 0, 0]} name="Kunjungan" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>

          <Card className="p-6">
            <h3 className="font-bold text-slate-800 mb-6 text-lg flex items-center gap-2"><TrendingUp className="text-blue-500" /> Ranking Pegawai - {selectedCabang}</h3>
            <div className="space-y-3">
              {rankingDepot.map((r, i) => (
                <div key={i} className="flex items-center justify-between p-3 rounded-xl bg-slate-50 border border-slate-100">
                  <div className="flex items-center gap-3">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm ${i === 0 ? 'bg-yellow-100 text-yellow-600' : 'bg-slate-200 text-slate-600'}`}>#{i + 1}</div>
                    <p className="font-semibold text-slate-800 text-sm">{r.name}</p>
                  </div>
                  <div className="text-right">
                    <p className="font-bold text-blue-600">{r.visits} Kunjungan</p>
                    <p className="text-xs text-emerald-600 font-medium">+{r.tokoBaru} Toko Baru</p>
                  </div>
                </div>
              ))}
              {rankingDepot.length === 0 && <p className="text-sm text-slate-400 text-center py-4">Belum ada pegawai di depot ini.</p>}
            </div>
          </Card>
        </>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
            <Card className="p-6 border-l-4 border-l-blue-500">
              <p className="text-slate-500 text-sm font-medium">Total Kunjungan (Semua)</p>
              <p className="text-3xl font-black text-slate-800 mt-2">{totalKunjunganSemua}</p>
            </Card>
            <Card className="p-6 border-l-4 border-l-purple-500">
              <p className="text-slate-500 text-sm font-medium">Total Target</p>
              <p className="text-3xl font-black text-slate-800 mt-2">{totalTargetSemua}</p>
            </Card>
            <Card className="p-6 border-l-4 border-l-emerald-500">
              <p className="text-slate-500 text-sm font-medium flex items-center gap-1"><Award size={14} /> Depot Terbaik</p>
              <p className="text-lg font-black text-slate-800 mt-2 truncate">{depotTerbaikSemua ? `${depotTerbaikSemua.cabang} (${depotTerbaikSemua.visits})` : '-'}</p>
            </Card>
            <Card className="p-6 border-l-4 border-l-yellow-500">
              <p className="text-slate-500 text-sm font-medium flex items-center gap-1"><Award size={14} /> Pegawai Terbaik</p>
              <p className="text-lg font-black text-slate-800 mt-2 truncate">{pegawaiTerbaikSemua ? `${(pegawaiTerbaikSemua as any).name}` : '-'}</p>
            </Card>
          </div>

          <Card className="p-6">
            <h3 className="font-bold text-slate-800 mb-6 text-lg flex items-center gap-2"><Building2 className="text-blue-500" /> Ranking Depot</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm whitespace-nowrap">
                <thead className="bg-slate-100 text-slate-600 font-medium">
                  <tr>
                    <th className="p-3">#</th>
                    <th className="p-3">Depot/Cabang</th>
                    <th className="p-3">Kunjungan</th>
                    <th className="p-3">Toko Baru</th>
                    <th className="p-3">Target</th>
                    <th className="p-3">Persentase</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rankingSemuaDepot.map((r, i) => (
                    <tr key={r.cabang}>
                      <td className="p-3 font-bold text-slate-400">#{i + 1}</td>
                      <td className="p-3 font-semibold text-slate-800">{r.cabang}</td>
                      <td className="p-3">{r.visits}</td>
                      <td className="p-3 text-emerald-600 font-medium">+{r.tokoBaru}</td>
                      <td className="p-3">{r.target}</td>
                      <td className="p-3">
                        <span className={`px-2 py-1 rounded-full text-xs font-bold ${r.pct >= 100 ? 'bg-emerald-100 text-emerald-700' : r.pct >= 70 ? 'bg-yellow-100 text-yellow-700' : 'bg-red-100 text-red-700'}`}>{r.pct}%</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </div>
  );
};

export default AdminReports;
