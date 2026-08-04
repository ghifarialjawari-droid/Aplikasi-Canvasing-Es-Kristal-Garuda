import React, { useState } from 'react';
import { FileText, TrendingUp } from 'lucide-react';
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

const AdminDashboard = ({ visits, users }: { visits: Visit[], users: User[] }) => {
  const [selectedCabang, setSelectedCabang] = useState('Semua');

  const cabangList = ['Semua', ...Array.from(new Set(users.filter(u => u.role === 'pegawai').map(u => u.cabang)))];

  const filteredVisits = selectedCabang === 'Semua' ? visits : visits.filter(v => v.cabang === selectedCabang);
  const activeEmployees = users.filter(u => u.role === 'pegawai' && u.status === 'Aktif' && (selectedCabang === 'Semua' || u.cabang === selectedCabang)).length;

  const totalVisits = filteredVisits.length;
  const newShops = filteredVisits.filter(v => v.isNewCustomer).length;
  const totalProspek = filteredVisits.filter(v => v.status === 'Prospek' || v.status === 'Follow Up').length;

  const ranking = [...users.filter(u => u.role === 'pegawai' && u.status === 'Aktif' && (selectedCabang === 'Semua' || u.cabang === selectedCabang))].map(user => {
    const userVisits = filteredVisits.filter(v => v.pegawaiId === user.id);
    const tokoBaru = userVisits.filter(v => v.isNewCustomer).length;
    return { name: user.name, cabang: user.cabang, visits: userVisits.length, tokoBaru };
  }).sort((a, b) => b.visits - a.visits);

  // Data trend 7 hari terakhir dihitung dari data kunjungan asli (bukan simulasi)
  const dayNames = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];
  const chartData = Array.from({ length: 7 }).map((_, idx) => {
    const d = new Date();
    d.setDate(d.getDate() - (6 - idx));
    const dateStr = d.toISOString().split('T')[0];
    const dayVisits = filteredVisits.filter(v => v.date === dateStr);
    return {
      name: dayNames[d.getDay()],
      kunjungan: dayVisits.length,
      tokoBaru: dayVisits.filter(v => v.isNewCustomer).length
    };
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
      <div className="flex flex-col md:flex-row justify-between md:items-center gap-4 mb-8">
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
          <p className="text-slate-500 text-sm font-medium">Total Kunjungan Canvasing</p>
          <p className="text-3xl font-black text-slate-800 mt-2">{totalVisits}</p>
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

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mt-6">
        <Card className="p-6 lg:col-span-2">
          <h3 className="font-bold text-slate-800 mb-6 text-lg">Trend Kunjungan & Toko Baru (7 Hari Terakhir)</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData}>
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
    </div>
  );
};


export default AdminDashboard;
