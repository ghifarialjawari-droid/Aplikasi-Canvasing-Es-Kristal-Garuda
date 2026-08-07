import React, { useState } from 'react';
import { FileText, TrendingUp, Award, AlertTriangle, Target as TargetIcon, Users as UsersIcon } from 'lucide-react';
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
  password?: string;
  target: { visits: number; newCustomers: number };
  status?: 'Aktif' | 'Nonaktif';
  lastLogin?: string;
  area?: string;
}

interface Visit {
  id: string;
  date: string;
  time: string;
  shopName: string;
  owner: string;
  phone: string;
  businessType: string;
  cabang: string;
  lat: number | null;
  lng: number | null;
  status: string;
  result: string;
  isNewCustomer: boolean;
  nextFollowUp?: string;
  pegawaiId: string;
  area?: string;
  photo?: string;
}

interface Attendance {
  id: string;
  pegawaiId: string;
  date: string;
  checkInTime: string;
  checkOutTime?: string;
  status: string;
}

interface Target {
  id: string;
  scope: 'pegawai' | 'cabang';
  scopeId: string;
  scopeLabel: string;
  period: 'harian' | 'mingguan' | 'bulanan';
  startDate: string;
  visitTarget: number;
  newCustomerTarget: number;
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

// Rentang tanggal (mulai-akhir) dari sebuah target, sesuai periodenya - sama seperti di AdminTargets.tsx
function getDateRangeForTarget(t: Target): { start: string, end: string } {
  const start = new Date(t.startDate + 'T00:00:00');
  if (t.period === 'harian') return { start: t.startDate, end: t.startDate };
  if (t.period === 'mingguan') {
    const day = start.getDay();
    const diffToMonday = day === 0 ? -6 : 1 - day;
    const monday = new Date(start);
    monday.setDate(start.getDate() + diffToMonday);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    return { start: monday.toISOString().split('T')[0], end: sunday.toISOString().split('T')[0] };
  }
  const firstDay = new Date(start.getFullYear(), start.getMonth(), 1);
  const lastDay = new Date(start.getFullYear(), start.getMonth() + 1, 0);
  return { start: firstDay.toISOString().split('T')[0], end: lastDay.toISOString().split('T')[0] };
}

function sumTargetRealisasi(matchingTargets: Target[], visits: Visit[], users: User[]) {
  let targetTotal = 0;
  let realisasiTotal = 0;
  matchingTargets.forEach((t) => {
    const { start, end } = getDateRangeForTarget(t);
    const relevant = visits.filter((v) => {
      if (v.date < start || v.date > end) return false;
      if (t.scope === 'pegawai') return v.pegawaiId === t.scopeId;
      const peg = users.find((u) => u.id === v.pegawaiId);
      return peg?.cabang === t.scopeId;
    });
    targetTotal += t.visitTarget;
    realisasiTotal += relevant.length;
  });
  return { target: targetTotal, realisasi: realisasiTotal };
}

const AdminDashboard = ({
  visits, users, attendance, targets
}: {
  visits: Visit[], users: User[], attendance: Attendance[], targets: Target[]
}) => {
  const [selectedCabang, setSelectedCabang] = useState('Semua');
  const todayStr = new Date().toISOString().split('T')[0];
  const thisMonth = todayStr.slice(0, 7); // "YYYY-MM"

  const cabangList = ['Semua', ...Array.from(new Set(users.filter(u => u.role === 'pegawai').map(u => u.cabang)))];
  const allCabang = Array.from(new Set(users.filter(u => u.role === 'pegawai').map(u => u.cabang)));

  const filteredVisits = selectedCabang === 'Semua' ? visits : visits.filter(v => v.cabang === selectedCabang);
  const activePegawaiList = users.filter(u => u.role === 'pegawai' && u.status === 'Aktif' && (selectedCabang === 'Semua' || u.cabang === selectedCabang));
  const activeEmployees = activePegawaiList.length;

  const totalVisits = filteredVisits.length;
  const newShops = filteredVisits.filter(v => v.isNewCustomer).length;
  const totalProspek = filteredVisits.filter(v => v.status === 'Prospek' || v.status === 'Follow Up').length;
  const visitsToday = filteredVisits.filter(v => v.date === todayStr).length;

  // Pegawai yang belum absen hari ini
  const belumAbsenCount = activePegawaiList.filter(
    (u) => !attendance.some((a) => a.pegawaiId === u.id && a.date === todayStr)
  ).length;

  // Target Hari Ini & Target Bulan (dari menu Target Canvasing)
  const relevantTargets = selectedCabang === 'Semua'
    ? targets
    : targets.filter((t) => t.scopeId === selectedCabang || users.find(u => u.id === t.scopeId)?.cabang === selectedCabang);
  const todayTargets = sumTargetRealisasi(relevantTargets.filter(t => t.period === 'harian'), visits, users);
  const monthTargets = sumTargetRealisasi(relevantTargets.filter(t => t.period === 'bulanan'), visits, users);

  // Progress target keseluruhan (pakai target bulanan bawaan tiap akun pegawai - selalu tersedia)
  const overallTarget = activePegawaiList.reduce((sum, u) => sum + (u.target?.visits || 0), 0);
  const overallRealisasi = activePegawaiList.reduce((sum, u) => sum + visits.filter(v => v.pegawaiId === u.id && v.date.slice(0, 7) === thisMonth).length, 0);
  const overallPct = overallTarget > 0 ? Math.min(100, Math.round((overallRealisasi / overallTarget) * 100)) : 0;

  // Depot terbaik & terendah (berdasarkan kunjungan bulan ini)
  const depotStats = allCabang.map((c) => ({
    cabang: c,
    visits: visits.filter(v => v.cabang === c && v.date.slice(0, 7) === thisMonth).length,
  })).sort((a, b) => b.visits - a.visits);
  const depotTerbaik = depotStats[0];
  const depotTerendah = depotStats[depotStats.length - 1];

  const ranking = [...activePegawaiList].map(user => {
    const userVisits = filteredVisits.filter(v => v.pegawaiId === user.id);
    const tokoBaru = userVisits.filter(v => v.isNewCustomer).length;
    return { name: user.name, cabang: user.cabang, visits: userVisits.length, tokoBaru };
  }).sort((a, b) => b.visits - a.visits);

  // Data trend 7 hari terakhir
  const dayNames = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];
  const chartDataHarian = Array.from({ length: 7 }).map((_, idx) => {
    const d = new Date();
    d.setDate(d.getDate() - (6 - idx));
    const dateStr = d.toISOString().split('T')[0];
    const dayVisits = filteredVisits.filter(v => v.date === dateStr);
    return { name: dayNames[d.getDay()], kunjungan: dayVisits.length, tokoBaru: dayVisits.filter(v => v.isNewCustomer).length };
  });

  // Data trend 6 bulan terakhir
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
  const chartDataBulanan = Array.from({ length: 6 }).map((_, idx) => {
    const d = new Date();
    d.setMonth(d.getMonth() - (5 - idx));
    const monthKey = d.toISOString().slice(0, 7);
    const monthVisits = filteredVisits.filter(v => v.date.slice(0, 7) === monthKey);
    return { name: monthNames[d.getMonth()], kunjungan: monthVisits.length, tokoBaru: monthVisits.filter(v => v.isNewCustomer).length };
  });

  // Perbandingan antar depot (selalu tampilkan semua cabang, tidak terpengaruh filter)
  const chartDataDepot = allCabang.map((c) => {
    const cabangVisits = visits.filter(v => v.cabang === c);
    return { name: c, kunjungan: cabangVisits.length, tokoBaru: cabangVisits.filter(v => v.isNewCustomer).length };
  });

  // Target vs Realisasi per depot (bulan ini, pakai target bawaan tiap pegawai)
  const chartDataTargetVsRealisasi = allCabang.map((c) => {
    const pegawaiCabang = users.filter(u => u.cabang === c && u.role === 'pegawai');
    const target = pegawaiCabang.reduce((sum, u) => sum + (u.target?.visits || 0), 0);
    const realisasi = pegawaiCabang.reduce((sum, u) => sum + visits.filter(v => v.pegawaiId === u.id && v.date.slice(0, 7) === thisMonth).length, 0);
    return { name: c, target, realisasi };
  });

  const handleExport = () => {
    const headers = ['Tanggal', 'Waktu', 'Nama Toko', 'Pemilik', 'No HP', 'Jenis Usaha', 'Cabang', 'Status', 'Toko Baru', 'Sales', 'Catatan'];
    const rows = filteredVisits.map(v => {
      const peg = users.find(u => u.id === v.pegawaiId);
      const catatan = (v.result || '').replace(/"/g, '""');
      return [v.date, v.time, v.shopName, v.owner, v.phone, v.businessType, v.cabang, v.status, v.isNewCustomer ? 'Ya' : 'Tidak', peg?.name || '-', `"${catatan}"`];
    });
    const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `laporan-canvasing-${selectedCabang}-${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="p-6 md:p-8 space-y-6 bg-slate-50 min-h-screen">
      <div className="flex flex-col md:flex-row justify-between md:items-center gap-4 mb-2">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-slate-800">Dashboard Pusat Canvasing</h1>
          <p className="text-slate-500">Monitor Aktivitas Kunjungan Es Kristal Garuda</p>
        </div>
        <div className="flex flex-col sm:flex-row gap-3">
          <select
            value={selectedCabang}
            onChange={(e) => setSelectedCabang(e.target.value)}
            className="bg-white border border-slate-200 text-slate-800 rounded-xl px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 shadow-sm font-medium"
          >
            {cabangList.map(c => <option key={c} value={c}>Cabang: {c}</option>)}
          </select>
          <Button variant="outline" className="py-2" onClick={handleExport}><FileText size={16} /> Export Laporan</Button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="p-6 border-l-4 border-l-blue-500">
          <p className="text-slate-500 text-sm font-medium">Kunjungan Hari Ini</p>
          <p className="text-3xl font-black text-slate-800 mt-2">{visitsToday}</p>
        </Card>
        <Card className="p-6 border-l-4 border-l-emerald-500">
          <p className="text-slate-500 text-sm font-medium">Akuisisi Toko Baru</p>
          <p className="text-3xl font-black text-slate-800 mt-2">{newShops}</p>
        </Card>
        <Card className="p-6 border-l-4 border-l-yellow-500">
          <p className="text-slate-500 text-sm font-medium">Dalam Prospek & Follow Up</p>
          <p className="text-3xl font-black text-slate-800 mt-2">{totalProspek}</p>
        </Card>
        <Card className="p-6 border-l-4 border-l-indigo-500">
          <p className="text-slate-500 text-sm font-medium">Pegawai Lapangan Aktif</p>
          <p className="text-3xl font-black text-slate-800 mt-2">{activeEmployees}</p>
        </Card>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="p-6 border-l-4 border-l-red-400">
          <p className="text-slate-500 text-sm font-medium flex items-center gap-1"><AlertTriangle size={14} /> Pegawai Belum Absen</p>
          <p className="text-3xl font-black text-slate-800 mt-2">{belumAbsenCount}</p>
        </Card>
        <Card className="p-6 border-l-4 border-l-purple-400">
          <p className="text-slate-500 text-sm font-medium flex items-center gap-1"><TargetIcon size={14} /> Target Hari Ini</p>
          <p className="text-2xl font-black text-slate-800 mt-2">{todayTargets.realisasi} / {todayTargets.target || '-'}</p>
        </Card>
        <Card className="p-6 border-l-4 border-l-sky-400">
          <p className="text-slate-500 text-sm font-medium flex items-center gap-1"><TargetIcon size={14} /> Target Bulan Ini</p>
          <p className="text-2xl font-black text-slate-800 mt-2">{monthTargets.realisasi} / {monthTargets.target || '-'}</p>
        </Card>
        <Card className="p-6 border-l-4 border-l-emerald-400">
          <p className="text-slate-500 text-sm font-medium flex items-center gap-1"><Award size={14} /> Depot Terbaik</p>
          <p className="text-lg font-black text-slate-800 mt-2 truncate">{depotTerbaik ? `${depotTerbaik.cabang} (${depotTerbaik.visits})` : '-'}</p>
        </Card>
      </div>

      <Card className="p-6">
        <div className="flex justify-between items-center mb-3">
          <h3 className="font-bold text-slate-800 flex items-center gap-2"><UsersIcon size={18} className="text-blue-500" /> Progress Target Keseluruhan (Bulan Ini)</h3>
          <span className="text-sm font-bold text-slate-600">{overallRealisasi} / {overallTarget} ({overallPct}%)</span>
        </div>
        <div className="h-3 bg-slate-100 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-700 ${overallPct >= 100 ? 'bg-emerald-500' : overallPct >= 70 ? 'bg-yellow-500' : 'bg-red-500'}`}
            style={{ width: `${Math.min(100, overallPct)}%` }}
          ></div>
        </div>
        {depotTerendah && depotStats.length > 1 && (
          <p className="text-xs text-slate-400 mt-3">Depot dengan kunjungan terendah bulan ini: <b className="text-slate-600">{depotTerendah.cabang} ({depotTerendah.visits} kunjungan)</b></p>
        )}
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="p-6 lg:col-span-2">
          <h3 className="font-bold text-slate-800 mb-6 text-lg">Kunjungan per Hari (7 Hari Terakhir)</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartDataHarian}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                <XAxis dataKey="name" axisLine={false} tickLine={false} />
                <YAxis axisLine={false} tickLine={false} allowDecimals={false} />
                <Tooltip cursor={{ fill: '#f1f5f9' }} />
                <Legend />
                <Bar dataKey="kunjungan" fill="#2563eb" radius={[4, 4, 0, 0]} name="Total Kunjungan" />
                <Bar dataKey="tokoBaru" fill="#10b981" radius={[4, 4, 0, 0]} name="Toko Baru" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card className="p-6">
          <h3 className="font-bold text-slate-800 mb-6 text-lg flex items-center gap-2">
            <TrendingUp className="text-blue-500" /> Ranking Kinerja Pegawai
          </h3>
          <div className="space-y-4">
            {ranking.slice(0, 5).map((r, i) => (
              <div key={i} className="flex items-center justify-between p-3 rounded-xl bg-slate-50 border border-slate-100">
                <div className="flex items-center gap-3">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm ${i === 0 ? 'bg-yellow-100 text-yellow-600' : 'bg-slate-200 text-slate-600'}`}>
                    #{i + 1}
                  </div>
                  <div>
                    <p className="font-semibold text-slate-800 text-sm">{r.name}</p>
                    <p className="text-xs text-slate-500">{r.cabang}</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="font-bold text-blue-600">{r.visits} Kunjungan</p>
                  <p className="text-xs text-emerald-600 font-medium">+{r.tokoBaru} Toko Baru</p>
                </div>
              </div>
            ))}
            {ranking.length === 0 && <p className="text-sm text-slate-400 text-center py-4">Belum ada data pegawai.</p>}
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="p-6">
          <h3 className="font-bold text-slate-800 mb-6 text-lg">Kunjungan per Bulan (6 Bulan Terakhir)</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartDataBulanan}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                <XAxis dataKey="name" axisLine={false} tickLine={false} />
                <YAxis axisLine={false} tickLine={false} allowDecimals={false} />
                <Tooltip cursor={{ fill: '#f1f5f9' }} />
                <Legend />
                <Bar dataKey="kunjungan" fill="#2563eb" radius={[4, 4, 0, 0]} name="Total Kunjungan" />
                <Bar dataKey="tokoBaru" fill="#10b981" radius={[4, 4, 0, 0]} name="Toko Baru" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card className="p-6">
          <h3 className="font-bold text-slate-800 mb-6 text-lg">Perbandingan Depot (Sepanjang Waktu)</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartDataDepot}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                <XAxis dataKey="name" axisLine={false} tickLine={false} />
                <YAxis axisLine={false} tickLine={false} allowDecimals={false} />
                <Tooltip cursor={{ fill: '#f1f5f9' }} />
                <Legend />
                <Bar dataKey="kunjungan" fill="#6366f1" radius={[4, 4, 0, 0]} name="Total Kunjungan" />
                <Bar dataKey="tokoBaru" fill="#f59e0b" radius={[4, 4, 0, 0]} name="Toko Baru" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      <Card className="p-6">
        <h3 className="font-bold text-slate-800 mb-6 text-lg">Target vs Realisasi per Depot (Bulan Ini)</h3>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartDataTargetVsRealisasi}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
              <XAxis dataKey="name" axisLine={false} tickLine={false} />
              <YAxis axisLine={false} tickLine={false} allowDecimals={false} />
              <Tooltip cursor={{ fill: '#f1f5f9' }} />
              <Legend />
              <Bar dataKey="target" fill="#cbd5e1" radius={[4, 4, 0, 0]} name="Target" />
              <Bar dataKey="realisasi" fill="#10b981" radius={[4, 4, 0, 0]} name="Realisasi" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>
    </div>
  );
};

export default AdminDashboard;
