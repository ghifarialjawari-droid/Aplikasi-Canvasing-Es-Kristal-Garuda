import React, { useState } from 'react';
import { Clock, AlertTriangle, MapPin, ExternalLink, CalendarDays, RefreshCw } from 'lucide-react';
import { localDateStr, formatHHmm } from '../lib/dates';
import { uniqueDailyRecords } from '../lib/records';

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

const AdminDashboard = ({
  visits, users, attendance, onRefresh, lastSynced
}: {
  visits: Visit[], users: User[], attendance: Attendance[],
  onRefresh?: () => Promise<void> | void, lastSynced?: Date | null
}) => {
  const [refreshing, setRefreshing] = useState(false);
  const doRefresh = async () => { if (!onRefresh) return; setRefreshing(true); try { await onRefresh(); } finally { setRefreshing(false); } };
  const todayStr = localDateStr();
  const [canvasDate, setCanvasDate] = useState(todayStr);
  const isToday = canvasDate === todayStr;

  const openInGoogleMaps = (lat: number | null, lng: number | null) => {
    if (lat === null || lat === undefined || lng === null || lng === undefined) return;
    window.open(`https://www.google.com/maps?q=${lat},${lng}`, '_blank', 'noopener,noreferrer');
  };

  const activePegawai = users.filter(u => u.role === 'pegawai' && u.status === 'Aktif');
  // Satu catatan per pegawai (baris ganda dari absen di dua HP dirapikan)
  const todayAttendance = uniqueDailyRecords(attendance, todayStr);
  const hadirCount = todayAttendance.length;
  const terlambatCount = todayAttendance.filter(a => a.status === 'Terlambat').length;
  const belumAbsenCount = Math.max(0, activePegawai.length - hadirCount);

  const todayVisits = visits
    .filter(v => v.date === canvasDate)
    .sort((a, b) => (a.time < b.time ? 1 : -1));
  const closingHariIni = todayVisits.filter(v => v.status === 'Closing').length;
  const prospekHariIni = todayVisits.filter(v => v.status === 'Prospek').length;
  const tokoBaruHariIni = todayVisits.filter(v => v.isNewCustomer).length;

  return (
    <div className="p-6 md:p-8 space-y-8 bg-slate-50 min-h-screen">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-slate-800">Dashboard</h1>
          <p className="text-slate-500">Ringkasan absensi & canvasing hari ini.</p>
        </div>
        {onRefresh && (
          <div className="flex items-center gap-3">
            {lastSynced && <span className="text-xs text-slate-400">Diperbarui {formatHHmm(lastSynced)}</span>}
            <button onClick={doRefresh} disabled={refreshing} className="px-3 py-2 bg-white border border-slate-200 text-slate-700 rounded-xl text-sm font-semibold hover:border-blue-600 hover:text-blue-600 flex items-center gap-1.5 shadow-sm disabled:opacity-60">
              <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} /> Segarkan
            </button>
          </div>
        )}
      </div>

      {/* ABSENSI KARYAWAN */}
      <div>
        <h2 className="font-bold text-slate-800 text-lg mb-3 flex items-center gap-2"><Clock size={20} className="text-blue-600" /> Absensi Karyawan Hari Ini</h2>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
          <Card className="p-6 border-l-4 border-l-emerald-500">
            <p className="text-slate-500 text-sm font-medium">Hadir</p>
            <p className="text-3xl font-black text-slate-800 mt-2">{hadirCount}</p>
          </Card>
          <Card className="p-6 border-l-4 border-l-yellow-500">
            <p className="text-slate-500 text-sm font-medium">Terlambat</p>
            <p className="text-3xl font-black text-slate-800 mt-2">{terlambatCount}</p>
          </Card>
          <Card className="p-6 border-l-4 border-l-red-500">
            <p className="text-slate-500 text-sm font-medium flex items-center gap-1"><AlertTriangle size={14} /> Belum Absen</p>
            <p className="text-3xl font-black text-slate-800 mt-2">{belumAbsenCount}</p>
          </Card>
        </div>

        <Card className="p-0 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm whitespace-nowrap">
              <thead className="bg-slate-100 text-slate-600 font-medium">
                <tr>
                  <th className="p-3">Nama Pegawai</th>
                  <th className="p-3">Cabang</th>
                  <th className="p-3">Jam Masuk</th>
                  <th className="p-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {activePegawai.map((u) => {
                  const rec = todayAttendance.find((a) => a.pegawaiId === u.id);
                  return (
                    <tr key={u.id} className="hover:bg-slate-50 transition-colors">
                      <td className="p-3 font-semibold text-slate-800">{u.name}</td>
                      <td className="p-3 text-slate-600">{u.cabang}</td>
                      <td className="p-3 text-slate-600">{rec ? rec.checkInTime : '-'}</td>
                      <td className="p-3">
                        {rec ? (
                          <span className={`px-2 py-1 rounded-full text-xs font-bold ${rec.status === 'Terlambat' ? 'bg-yellow-100 text-yellow-700' : 'bg-emerald-100 text-emerald-700'}`}>
                            {rec.status}
                          </span>
                        ) : (
                          <span className="px-2 py-1 rounded-full text-xs font-bold bg-red-100 text-red-700">Belum Absen</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {activePegawai.length === 0 && (
                  <tr><td colSpan={4} className="p-6 text-center text-slate-400">Belum ada pegawai aktif.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      {/* DATA CANVASING HARI INI */}
      <div>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-3">
          <h2 className="font-bold text-slate-800 text-lg flex items-center gap-2">
            <MapPin size={20} className="text-blue-600" /> Data Canvasing {isToday ? 'Hari Ini' : canvasDate}
          </h2>
          <div className="flex items-center gap-2">
            <CalendarDays size={18} className="text-slate-400" />
            <input
              type="date"
              value={canvasDate}
              max={todayStr}
              onChange={(e) => setCanvasDate(e.target.value || todayStr)}
              className="bg-white border border-slate-200 text-slate-800 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 shadow-sm"
            />
            {!isToday && (
              <button onClick={() => setCanvasDate(todayStr)} className="text-xs font-semibold text-blue-600 hover:text-blue-700 px-2 py-2">
                Hari Ini
              </button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
          <Card className="p-6 border-l-4 border-l-blue-500">
            <p className="text-slate-500 text-sm font-medium">Total Kunjungan</p>
            <p className="text-3xl font-black text-slate-800 mt-2">{todayVisits.length}</p>
          </Card>
          <Card className="p-6 border-l-4 border-l-emerald-500">
            <p className="text-slate-500 text-sm font-medium">Closing</p>
            <p className="text-3xl font-black text-slate-800 mt-2">{closingHariIni}</p>
          </Card>
          <Card className="p-6 border-l-4 border-l-pink-400">
            <p className="text-slate-500 text-sm font-medium">Prospek</p>
            <p className="text-3xl font-black text-slate-800 mt-2">{prospekHariIni}</p>
          </Card>
          <Card className="p-6 border-l-4 border-l-indigo-500">
            <p className="text-slate-500 text-sm font-medium">Toko Baru</p>
            <p className="text-3xl font-black text-slate-800 mt-2">{tokoBaruHariIni}</p>
          </Card>
        </div>

        <Card className="p-0 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm whitespace-nowrap">
              <thead className="bg-slate-100 text-slate-600 font-medium">
                <tr>
                  <th className="p-3">Jam Kunjungan</th>
                  <th className="p-3">Nama Toko</th>
                  <th className="p-3">Sales</th>
                  <th className="p-3">Depot Canvasing</th>
                  <th className="p-3">Status</th>
                  <th className="p-3 text-center">Lokasi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {todayVisits.map((v) => {
                  const peg = users.find((u) => u.id === v.pegawaiId);
                  return (
                    <tr key={v.id} className="hover:bg-slate-50 transition-colors">
                      <td className="p-3 text-slate-500">{v.time}</td>
                      <td className="p-3 font-semibold text-slate-800">
                        {v.shopName} {v.isNewCustomer && <span className="ml-1 text-[10px] bg-yellow-100 text-yellow-700 px-1.5 py-0.5 rounded-full font-bold">Baru</span>}
                      </td>
                      <td className="p-3 text-slate-600">{peg?.name || '-'}</td>
                      <td className="p-3 text-slate-600">{v.cabang}</td>
                      <td className="p-3">
                        <span className={`px-2 py-1 rounded-full text-xs font-bold ${v.status === 'Closing' ? 'bg-emerald-100 text-emerald-700' : 'bg-pink-100 text-pink-700'}`}>
                          {v.status}
                        </span>
                      </td>
                      <td className="p-3 text-center">
                        {v.lat !== null && v.lat !== undefined && v.lng !== null && v.lng !== undefined ? (
                          <button
                            onClick={() => openInGoogleMaps(v.lat, v.lng)}
                            className="p-2 bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100 inline-flex items-center gap-1 text-xs font-semibold"
                            title={`${Number(v.lat).toFixed(5)}, ${Number(v.lng).toFixed(5)}`}
                          >
                            <ExternalLink size={14} /> Buka Maps
                          </button>
                        ) : '-'}
                      </td>
                    </tr>
                  );
                })}
                {todayVisits.length === 0 && (
                  <tr><td colSpan={6} className="p-6 text-center text-slate-400">{isToday ? 'Belum ada kunjungan hari ini.' : 'Tidak ada data kunjungan pada tanggal ini.'}</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </div>
  );
};

export default AdminDashboard;
