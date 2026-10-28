import React, { useState, useEffect, useRef, lazy, Suspense } from 'react';
import {
  MapPin, Camera, CheckCircle, LogOut, Users,
  BarChart3, Home, PlusCircle, History, TrendingUp,
  Map, UserPlus, FileText, AlertCircle,
  Edit, Trash2, Key, Shield, Info, X, Power, PowerOff, RefreshCw, Store,
  Clock, ExternalLink, Download, Image as ImageIcon, LogIn, WifiOff, Target as TargetIcon, Database, Search, Phone
} from 'lucide-react';

import { localDateStr, localMonthStr, formatHHmm, normalizeTimeStr } from './lib/dates';
import { getTargetForMonth, buildTargetHistory } from './lib/targets';
import { OutboxOp, loadOutbox, saveOutbox, enqueueOp, applyOutbox, isPending } from './lib/outbox';
import { pickDailyRecord, uniqueDailyRecords, sortAttendanceDesc, sortVisitsDesc, sameList } from './lib/records';

// AdminDashboard (pakai recharts) dan AdminMap (pakai leaflet) sengaja
// dimuat "lazy" - hanya di-download saat Admin benar-benar membuka halaman
// itu. Pegawai (yang jumlahnya lebih banyak & sering buka dari HP) jadi
// tidak perlu mengunduh kedua library berat ini sama sekali.
const AdminDashboard = lazy(() => import('./admin/AdminDashboard'));
const AdminMap = lazy(() => import('./admin/AdminMap'));
const AdminTargets = lazy(() => import('./admin/AdminTargets'));
const AdminReports = lazy(() => import('./admin/AdminReports'));

// ==========================================
// KONFIGURASI API GOOGLE APPS SCRIPT
// ==========================================
// Ganti string kosong di bawah dengan URL Web App Google Apps Script Anda saat siap integrasi.
// Selama kosong, aplikasi berjalan di mode Sandbox (menggunakan LocalStorage)
const GAS_API_URL = "https://script.google.com/macros/s/AKfycbw1WM795b0RuqMkb81m4GxBYsImwrfn9zwJYCq_scJp7e1rhIoZTZAkybXSwWiz9W7a/exec";

// Kunci sederhana supaya endpoint Google Apps Script tidak bisa diakses
// sembarang orang yang kebetulan menemukan URL-nya. Ganti ke teks bebas
// milikmu sendiri, lalu gunakan teks yang SAMA PERSIS di variabel
// API_KEY pada Code.gs.
const GAS_API_KEY = "";

type Role = 'admin' | 'pegawai' | 'owner';

interface User {
  id: string;
  name: string;
  role: Role;
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
  status: string; // Closing atau Prospek
  result: string;
  isNewCustomer: boolean;
  nextFollowUp?: string;
  pegawaiId: string;
  area?: string;
  photo?: string; // base64 foto toko
}

interface Attendance {
  id: string;
  pegawaiId: string;
  date: string;
  checkInTime: string;
  checkInLat: number | null;
  checkInLng: number | null;
  checkOutTime?: string;
  checkOutLat?: number | null;
  checkOutLng?: number | null;
  status: 'Tepat Waktu' | 'Terlambat' | 'Tidak Valid';
}

// Pengaturan jadwal absensi - bisa diubah Admin lewat menu Pengaturan Absensi
interface AttendanceSettings {
  checkInStart: string;   // jam mulai boleh absen masuk, format "HH:mm"
  checkInEnd: string;     // batas akhir absen masuk
  checkOutStart: string;  // jam mulai boleh absen pulang
  checkOutEnd: string;    // batas akhir absen pulang
  toleranceMinutes: number; // toleransi keterlambatan (menit) sebelum status jadi "Terlambat"
  activeDays: string[];   // hari kerja aktif, cth: ['Senin','Selasa','Rabu','Kamis','Jumat','Sabtu']
  isActive: boolean;      // kalau dimatikan, absen tidak dibatasi jadwal sama sekali
}

const defaultAttendanceSettings: AttendanceSettings = {
  checkInStart: '07:00',
  checkInEnd: '09:00',
  checkOutStart: '16:00',
  checkOutEnd: '20:00',
  toleranceMinutes: 15,
  activeDays: ['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'],
  isActive: true,
};

// Merapikan pengaturan absensi dari sumber mana pun (server/cache/form) supaya
// jam selalu "HH:mm" yang valid. Nilai yang rusak diganti nilai bawaan, jadi
// aplikasi tidak pernah salah hitung jendela absen akibat data aneh.
function sanitizeAttendanceSettings(raw: any): AttendanceSettings {
  const d = defaultAttendanceSettings;
  const r = raw || {};
  let days: string[] = d.activeDays;
  if (Array.isArray(r.activeDays)) days = r.activeDays.map((x: any) => String(x).trim()).filter(Boolean);
  else if (typeof r.activeDays === 'string') days = r.activeDays.split(',').map((x: string) => x.trim()).filter(Boolean);
  const tol = Number(r.toleranceMinutes);
  return {
    checkInStart: normalizeTimeStr(r.checkInStart) || d.checkInStart,
    checkInEnd: normalizeTimeStr(r.checkInEnd) || d.checkInEnd,
    checkOutStart: normalizeTimeStr(r.checkOutStart) || d.checkOutStart,
    checkOutEnd: normalizeTimeStr(r.checkOutEnd) || d.checkOutEnd,
    toleranceMinutes: isFinite(tol) && r.toleranceMinutes !== '' && r.toleranceMinutes !== null && r.toleranceMinutes !== undefined ? Math.max(0, tol) : d.toleranceMinutes,
    activeDays: days,
    isActive: r.isActive === undefined ? d.isActive : (r.isActive === true || r.isActive === 'TRUE' || r.isActive === 'true'),
  };
}

function settingsEqual(a: AttendanceSettings, b: AttendanceSettings): boolean {
  return a.checkInStart === b.checkInStart && a.checkInEnd === b.checkInEnd &&
    a.checkOutStart === b.checkOutStart && a.checkOutEnd === b.checkOutEnd &&
    a.toleranceMinutes === b.toleranceMinutes && a.isActive === b.isActive &&
    a.activeDays.join('|') === b.activeDays.join('|');
}

const DAY_NAMES_ID = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];

// Sesi login otomatis kedaluwarsa setelah durasi ini (jam) demi keamanan -
// setelah itu pegawai/admin harus login ulang meskipun tidak logout manual.
const SESSION_TIMEOUT_HOURS = 12;

function timeToMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

// Target Kunjungan yang berlaku untuk seorang pegawai bulan ini: utamakan
// entri "Target Canvasing" (scope pegawai, periode bulanan, bulan berjalan)
// kalau ada; kalau belum ada, pakai target bawaan akun (User.target) sebagai
// cadangan. Ini menyatukan dua sistem target supaya selalu konsisten di
// mana pun ditampilkan (Kelola Pegawai, Dashboard Pegawai, dsb).
function getEffectiveTarget(u: User, targets: Target[]): { visits: number, newCustomers: number } {
  const t = getTargetForMonth(u, targets, localMonthStr());
  return { visits: t.visits, newCustomers: t.newCustomers };
}

// Target Canvasing - dibuat Admin, bisa untuk 1 pegawai atau seluruh cabang/depot
interface Target {
  id: string;
  scope: 'pegawai' | 'cabang';
  scopeId: string;        // ID pegawai kalau scope='pegawai', atau nama cabang kalau scope='cabang'
  scopeLabel: string;     // nama yang ditampilkan (nama pegawai / nama cabang)
  period: 'harian' | 'mingguan' | 'bulanan';
  startDate: string;      // tanggal acuan periode berlaku, format "YYYY-MM-DD"
  visitTarget: number;
  newCustomerTarget: number;
}

const defaultUsers: User[] = [
  { id: 'GARUDA1', password: 'ESKRISTALGARUDA', name: 'Admin Pusat', role: 'admin', cabang: 'Pusat', target: { visits: 0, newCustomers: 0 }, status: 'Aktif', lastLogin: '-' },
  { id: 'ESLIMBANGAN', password: 'ESLIMBANGAN', name: 'Sales Limbangan', role: 'pegawai', cabang: 'Limbangan', area: 'Limbangan Kota', target: { visits: 150, newCustomers: 20 }, status: 'Aktif', lastLogin: '-' },
  { id: 'ESWANARAJA', password: 'ESWANARAJA', name: 'Sales Wanaraja', role: 'pegawai', cabang: 'Wanaraja', area: 'Wanaraja Timur', target: { visits: 150, newCustomers: 20 }, status: 'Aktif', lastLogin: '-' },
  { id: 'ESTASIK', password: 'ESTASIK', name: 'Sales Tasikmalaya', role: 'pegawai', cabang: 'Tasikmalaya', area: 'Tasik Pusat', target: { visits: 200, newCustomers: 30 }, status: 'Aktif', lastLogin: '-' },
];

const defaultVisits: Visit[] = [
  { id: 'v1', date: '2026-07-21', time: '09:00', shopName: 'Warung Bu Ani', owner: 'Ani', phone: '0812', businessType: 'Warung', cabang: 'Limbangan', lat: -7.2131, lng: 107.8901, status: 'Closing', result: 'Order perdana, toko bersih', isNewCustomer: true, pegawaiId: 'ESLIMBANGAN' },
  { id: 'v2', date: '2026-07-21', time: '10:30', shopName: 'Cafe Senja', owner: 'Budi', phone: '0813', businessType: 'Cafe', cabang: 'Wanaraja', lat: -7.1755, lng: 107.9585, status: 'Prospek', result: 'Bawa tester, minggu depan mau coba', isNewCustomer: true, nextFollowUp: '2026-07-28', pegawaiId: 'ESWANARAJA' },
];

const defaultAttendance: Attendance[] = [];
const defaultTargets: Target[] = [];
const defaultBusinessTypes: string[] = ['Warung', 'Agen', 'Rumah Makan', 'Cafe', 'Pedagang Minuman', 'Catering', 'Lainnya'];

const FETCH_TIMEOUT_MS = 25000; // 25 detik - upload foto ke Google Drive lewat Apps Script bisa lambat
const MAX_RETRY = 2;

function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}

async function fetchWithRetry(url: string, options: RequestInit = {}, retriesLeft = MAX_RETRY): Promise<Response> {
  try {
    return await fetchWithTimeout(url, options);
  } catch (err) {
    if (retriesLeft > 0) {
      await new Promise((r) => setTimeout(r, 800));
      return fetchWithRetry(url, options, retriesLeft - 1);
    }
    throw err;
  }
}

// Menulis ke penyimpanan HP tanpa pernah melempar error. Kalau penuh, aplikasi
// tetap jalan (sebelumnya error ini bisa menggagalkan pengiriman data).
function safeSet(key: string, value: string) {
  try { localStorage.setItem(key, value); } catch { /* penyimpanan HP penuh */ }
}

// Foto base64 berukuran besar; jangan ikut disimpan di salinan cadangan.
function stripPhotos(arr: any): any {
  return Array.isArray(arr)
    ? arr.map((x: any) => (x && typeof x.photo === 'string' && x.photo.startsWith('data:') ? { ...x, photo: '' } : x))
    : arr;
}

// Salinan daftar di HP (cadangan kalau server tidak terjangkau; di mode lokal
// ini adalah penyimpanan utamanya).
function persistList(collection: string, list: any[]) {
  safeSet(`esgaruda_cache_${collection}`, JSON.stringify(stripPhotos(list)));
  if (!GAS_API_URL) safeSet(`esgaruda_${collection}`, JSON.stringify(list));
}

const db = {
  async get(collection: string) {
    if (GAS_API_URL) {
      try {
        const res = await fetchWithRetry(`${GAS_API_URL}?action=get&collection=${collection}&key=${encodeURIComponent(GAS_API_KEY)}`);
        const json = await res.json();
        if (json && json.error) { console.error('API Error (get):', json.error); return []; }
        return json;
      } catch (err) {
        console.error('API Error (get):', err);
        // Kalau gagal total (offline/timeout setelah beberapa kali coba),
        // pakai salinan cadangan terakhir yang tersimpan di HP ini.
        const cached = localStorage.getItem(`esgaruda_cache_${collection}`);
        return cached ? JSON.parse(cached) : [];
      }
    } else {
      const data = localStorage.getItem(`esgaruda_${collection}`);
      if (data) return JSON.parse(data);
      if (collection === 'users') return defaultUsers;
      if (collection === 'visits') return defaultVisits;
      if (collection === 'attendance') return defaultAttendance;
      return [];
    }
  },
  async save(collection: string, data: any): Promise<{ ok: boolean, error?: string }> {
    // Simpan salinan cadangan di HP ini juga, supaya data tidak hilang
    // kalau koneksi ke server terputus saat menyimpan.
    safeSet(`esgaruda_cache_${collection}`, JSON.stringify(data));

    if (GAS_API_URL) {
      try {
        const res = await fetchWithRetry(GAS_API_URL, {
          method: 'POST',
          body: JSON.stringify({ action: 'save', collection, data, key: GAS_API_KEY }),
        });
        const json = await res.json().catch(() => null);
        if (json && json.error) {
          console.error(`API Error (save "${collection}"):`, json.error);
          return { ok: false, error: json.error };
        }
        return { ok: true };
      } catch (err) {
        console.error(`API Error (save "${collection}"):`, err);
        return { ok: false, error: String(err) };
      }
    } else {
      safeSet(`esgaruda_${collection}`, JSON.stringify(data));
      return { ok: true };
    }
  },
  // Memperbarui SATU catatan yang sudah ada (dicari berdasarkan id), misalnya
  // mengisi jam pulang pada catatan absen masuk yang sudah tersimpan.
  async upsert(collection: string, fullArrayForCache: any[], item: any): Promise<{ ok: boolean, error?: string }> {
    safeSet(`esgaruda_cache_${collection}`, JSON.stringify(fullArrayForCache));

    if (GAS_API_URL) {
      try {
        const res = await fetchWithRetry(GAS_API_URL, {
          method: 'POST',
          body: JSON.stringify({ action: 'upsert', collection, item, key: GAS_API_KEY }),
        });
        const json = await res.json().catch(() => null);
        if (json && json.error) {
          console.error(`API Error (upsert "${collection}"):`, json.error);
          return { ok: false, error: json.error };
        }
        return { ok: true };
      } catch (err) {
        console.error(`API Error (upsert "${collection}"):`, err);
        return { ok: false, error: String(err) };
      }
    } else {
      safeSet(`esgaruda_${collection}`, JSON.stringify(fullArrayForCache));
      return { ok: true };
    }
  },
  // Mengambil data SEGAR langsung dari server (tanpa cadangan lokal), dipakai
  // untuk memastikan penyimpanan benar-benar sampai & untuk penyegaran
  // berkala. Beberapa koleksi diambil dalam satu permintaan (getMany); kalau
  // Code.gs di server masih versi lama, otomatis diambil satu per satu.
  async fetchFresh(collections: string[]): Promise<{ ok: boolean, data: Record<string, any[]>, error?: string }> {
    if (!GAS_API_URL) {
      const data: Record<string, any[]> = {};
      collections.forEach((c) => {
        try { data[c] = JSON.parse(localStorage.getItem(`esgaruda_${c}`) || '[]'); } catch { data[c] = []; }
      });
      return { ok: true, data };
    }
    const keyQ = `&key=${encodeURIComponent(GAS_API_KEY)}`;
    try {
      const res = await fetchWithRetry(`${GAS_API_URL}?action=getMany&collections=${collections.join(',')}${keyQ}`);
      const json = await res.json();
      if (json && !json.error && !Array.isArray(json)) return { ok: true, data: json };
    } catch (err) {
      return { ok: false, data: {}, error: String(err) };
    }
    try {
      const data: Record<string, any[]> = {};
      for (const c of collections) {
        const res = await fetchWithRetry(`${GAS_API_URL}?action=get&collection=${c}${keyQ}`);
        const json = await res.json();
        if (!Array.isArray(json)) return { ok: false, data: {}, error: (json && json.error) || 'Respons server tidak valid' };
        data[c] = json;
      }
      return { ok: true, data };
    } catch (err) {
      return { ok: false, data: {}, error: String(err) };
    }
  }
};

// Mengirim SATU operasi dari antrean ke server. Dianggap berhasil hanya kalau
// server membalas {success:true}.
async function sendOp(op: OutboxOp): Promise<{ ok: boolean, error?: string }> {
  if (!GAS_API_URL) return { ok: true }; // mode lokal: data sudah tersimpan di HP ini
  const body = op.action === 'delete'
    ? { action: 'delete', collection: op.collection, id: op.itemId, key: GAS_API_KEY }
    : { action: op.action, collection: op.collection, item: op.item, key: GAS_API_KEY };
  try {
    const res = await fetchWithRetry(GAS_API_URL, { method: 'POST', body: JSON.stringify(body) });
    const json = await res.json().catch(() => null);
    if (!json) return { ok: false, error: 'Respons server tidak dapat dibaca' };
    if (json.error) return { ok: false, error: String(json.error) };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

// Hasil menyimpan pengaturan, ditampilkan ke Admin
type SaveStatus = { status: 'ok' | 'warn' | 'error', message: string };

function targetsEqual(a: Target[], b: Target[]): boolean {
  if (a.length !== b.length) return false;
  const key = (t: Target) => [t.id, t.scope, t.scopeId, t.period, t.startDate, t.visitTarget, t.newCustomerTarget].join('|');
  const ka = a.map(key).sort();
  const kb = b.map(key).sort();
  return ka.every((k, i) => k === kb[i]);
}

// Logo motor kurir - dipakai di layar login, sidebar admin, dan header pegawai
const LogoIcon = ({ size = 24, className = '' }: { size?: number, className?: string }) => (
  <svg width={size} height={size} viewBox="0 0 60 42" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
    <rect x="0" y="0" width="18" height="15" rx="2" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
    <circle cx="14" cy="32" r="8.5" stroke="currentColor" strokeWidth="4" />
    <circle cx="52" cy="32" r="8.5" stroke="currentColor" strokeWidth="4" />
    <path d="M14 32 L26 32 L36 15 L48 15" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M14 32 L18 15" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M30 22 L36 15" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M30 22 L38 22" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M48 15 L52 32" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M48 15 L58 15" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const AdminSectionLoading = () => (
  <div className="p-6 md:p-8 min-h-screen flex items-center justify-center bg-slate-50">
    <div className="flex flex-col items-center gap-3 text-slate-400">
      <RefreshCw size={28} className="animate-spin" />
      <span className="text-sm font-medium">Memuat halaman...</span>
    </div>
  </div>
);

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

const Input = ({ label, type = 'text', value, onChange, placeholder, required = false, icon: Icon, minLength }: any) => (
  <div className="mb-4">
    <label className="block text-sm font-medium text-slate-600 mb-1.5">{label} {required && <span className="text-red-500">*</span>}</label>
    <div className="relative">
      {Icon && <Icon className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-5 h-5" />}
      <input
        type={type} value={value} onChange={onChange} placeholder={placeholder} required={required} minLength={minLength}
        autoCapitalize="off" autoCorrect="off" spellCheck={false}
        className={`w-full bg-slate-50 border border-slate-200 text-slate-800 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all ${Icon ? 'pl-10' : ''}`}
      />
    </div>
  </div>
);

const Select = ({ label, value, onChange, options, required = false }: any) => (
  <div className="mb-4">
    <label className="block text-sm font-medium text-slate-600 mb-1.5">{label} {required && <span className="text-red-500">*</span>}</label>
    <select
      value={value} onChange={onChange} required={required}
      className="w-full bg-slate-50 border border-slate-200 text-slate-800 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all appearance-none"
    >
      <option value="">Pilih {label}...</option>
      {options.map((opt: any) => (
        <option key={opt.value || opt} value={opt.value || opt}>{opt.label || opt}</option>
      ))}
    </select>
  </div>
);

const LoginScreen = ({ onLogin, users }: { onLogin: (u: User) => void, users: User[] }) => {
  const [id, setId] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    const typedId = id.trim().toUpperCase();
    const typedPassword = password.trim();
    const user = users.find(u => u.id.trim().toUpperCase() === typedId);
    if (user && user.password === typedPassword) {
      if (user.status === 'Nonaktif') {
        setError('Akun Anda dinonaktifkan oleh Admin.');
      } else {
        onLogin(user);
      }
    } else {
      setError('ID User atau Password salah. (Periksa akses cabang Anda)');
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="w-20 h-20 bg-blue-600 rounded-2xl flex items-center justify-center mx-auto shadow-xl shadow-blue-200 mb-4 transform rotate-3">
            <LogoIcon size={44} className="text-white -rotate-3" />
          </div>
          <h1 className="text-2xl font-bold text-slate-800">App Canvasing Es Garuda</h1>
          <p className="text-slate-500 mt-2">Sistem Monitoring Kunjungan & Prospek</p>
        </div>

        <Card className="p-6">
          <form onSubmit={handleLogin}>
            {error && <div className="p-3 bg-red-50 text-red-600 text-sm rounded-lg mb-4 flex items-center gap-2"><AlertCircle size={16} /> {error}</div>}
            <Input label="ID Login" value={id} onChange={(e: any) => setId(e.target.value)} icon={Users} placeholder="ID Pegawai (mis: ESLIMBANGAN)" required />
            <Input label="Password" type="password" value={password} onChange={(e: any) => setPassword(e.target.value)} placeholder="Masukkan Password" required />
            <Button type="submit" className="mt-2">Masuk ke Sistem</Button>
          </form>
        </Card>
        <p className="text-center text-slate-400 text-xs mt-6">v2.1 &bull; Realtime Canvassing Monitoring</p>
      </div>
    </div>
  );
};

const PegawaiDashboard = ({
  user, visits, attendanceToday, onCheckIn, onCheckOut, attendanceLoading, attendanceSettings, targets, attendanceLoaded, attendancePending
}: {
  user: User, visits: Visit[], attendanceToday: Attendance | null,
  onCheckIn: () => void, onCheckOut: () => void, attendanceLoading: boolean, attendanceSettings: AttendanceSettings, targets: Target[],
  attendanceLoaded: boolean, attendancePending: boolean
}) => {
  const myVisits = visits.filter(v => v.pegawaiId === user.id);
  const todayDate = localDateStr();
  const thisMonthStr = todayDate.slice(0, 7);
  const visitsToday = myVisits.filter(v => v.date === todayDate).length;
  const newCustomers = myVisits.filter(v => v.isNewCustomer).length;

  // Realisasi bulan ini (sebelumnya salah hitung semua kunjungan sepanjang waktu)
  const monthlyVisits = myVisits.filter(v => v.date.slice(0, 7) === thisMonthStr);
  const realisasiVisits = monthlyVisits.length;
  const realisasiNew = monthlyVisits.filter(v => v.isNewCustomer).length;

  // Target bulan ini dari menu "Target Canvasing" (Admin). Kalau Admin belum
  // memperbarui target bulan ini, target terakhir tetap berlaku.
  const currentTarget = getTargetForMonth(user, targets, thisMonthStr);
  const targetVisits = currentTarget.visits;
  const targetNew = currentTarget.newCustomers;

  // Riwayat pencapaian bulan-bulan sebelumnya
  const targetHistory = buildTargetHistory(user, myVisits, targets);

  const progressVisits = targetVisits > 0 ? Math.min(100, Math.round((realisasiVisits / targetVisits) * 100)) : 0;
  const progressNew = targetNew > 0 ? Math.min(100, Math.round((realisasiNew / targetNew) * 100)) : 0;

  // Hitung status jadwal absen saat ini supaya pegawai lihat info-nya
  // tanpa harus klik tombol dulu.
  const now = new Date();
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const todayName = DAY_NAMES_ID[now.getDay()];
  let scheduleHint: string | null = null;
  if (attendanceSettings.isActive) {
    if (!attendanceSettings.activeDays.includes(todayName)) {
      scheduleHint = `Hari ini (${todayName}) bukan hari kerja aktif untuk absensi.`;
    } else if (!attendanceToday) {
      const startMinutes = timeToMinutes(attendanceSettings.checkInStart);
      const endMinutes = timeToMinutes(attendanceSettings.checkInEnd);
      if (nowMinutes < startMinutes) scheduleHint = `Absen masuk dibuka mulai pukul ${attendanceSettings.checkInStart}.`;
      else if (nowMinutes > endMinutes) scheduleHint = `Absen masuk sudah ditutup (batas ${attendanceSettings.checkInEnd}).`;
    } else if (!attendanceToday.checkOutTime) {
      const startMinutes = timeToMinutes(attendanceSettings.checkOutStart);
      const endMinutes = timeToMinutes(attendanceSettings.checkOutEnd);
      if (nowMinutes < startMinutes) scheduleHint = `Absen pulang dibuka mulai pukul ${attendanceSettings.checkOutStart}.`;
      else if (nowMinutes > endMinutes) scheduleHint = `Absen pulang sudah ditutup (batas ${attendanceSettings.checkOutEnd}).`;
    }
  }

  return (
    <div className="p-4 space-y-6 pb-24">
      <div className="bg-blue-600 -mx-4 -mt-4 p-6 pt-8 rounded-b-3xl shadow-md text-white">
        <div className="flex justify-between items-center mb-4">
          <div>
            <h2 className="text-xl font-bold">Halo, {user.name}</h2>
            <p className="text-blue-100 text-sm mt-1 flex items-center gap-1"><MapPin size={12} /> Cabang {user.cabang}</p>
          </div>
          <div className="w-12 h-12 bg-white/20 rounded-full flex items-center justify-center backdrop-blur-sm">
            <Store size={24} className="text-white" />
          </div>
        </div>

        <div className="mt-4 bg-white/10 p-4 rounded-2xl backdrop-blur-sm border border-white/20">
          <div className="flex justify-between text-sm mb-2">
            <span>Target Kunjungan (Bulan Ini)</span>
            <span className="font-bold">{realisasiVisits} / {targetVisits}</span>
          </div>
          <div className="h-2 bg-black/20 rounded-full overflow-hidden mb-4">
            <div className="h-full bg-emerald-400 rounded-full transition-all duration-1000" style={{ width: `${progressVisits}%` }}></div>
          </div>

          <div className="flex justify-between text-sm mb-2">
            <span>Target Toko Baru</span>
            <span className="font-bold">{realisasiNew} / {targetNew}</span>
          </div>
          <div className="h-2 bg-black/20 rounded-full overflow-hidden">
            <div className="h-full bg-yellow-400 rounded-full transition-all duration-1000" style={{ width: `${progressNew}%` }}></div>
          </div>
        </div>
      </div>

      {targetHistory.length > 0 && (
        <Card className="p-4">
          <h3 className="font-bold text-slate-800 mb-3 flex items-center gap-2"><History size={18} className="text-blue-600" /> Riwayat Target Bulan Sebelumnya</h3>
          {!targetHistory[0].achieved && (
            <div className="flex items-start gap-2 text-xs font-medium text-red-700 bg-red-50 border border-red-100 p-3 rounded-xl mb-3">
              <AlertCircle size={16} className="flex-shrink-0 mt-0.5" />
              <span>Bulan lalu ({targetHistory[0].label}) target tidak tercapai. Ayo kejar target bulan ini!</span>
            </div>
          )}
          <div className="space-y-2">
            {targetHistory.map((h) => (
              <div key={h.month} className={`p-3 rounded-xl border ${h.achieved ? 'bg-emerald-50 border-emerald-100' : 'bg-red-50 border-red-100'}`}>
                <div className="flex justify-between items-center gap-2 mb-1.5">
                  <span className="font-semibold text-slate-800 text-sm">{h.label}</span>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase ${h.achieved ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
                    {h.achieved ? 'Tercapai' : 'Tidak mencapai target'}
                  </span>
                </div>
                <div className="flex justify-between gap-2 text-xs text-slate-600">
                  <span>Kunjungan: <b>{h.realVisits}/{h.targetVisits}</b> ({h.pctVisits}%)</span>
                  <span>Toko baru: <b>{h.realNew}/{h.targetNew}</b> ({h.pctNew}%)</span>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card className="p-4">
        <h3 className="font-bold text-slate-800 mb-3 flex items-center gap-2"><Clock size={18} className="text-blue-600" /> Absensi Hari Ini</h3>
        {scheduleHint && (
          <div className="flex items-center gap-2 text-xs font-medium text-slate-500 bg-slate-50 border border-slate-100 p-2.5 rounded-lg mb-3">
            <Info size={14} className="flex-shrink-0" /> {scheduleHint}
          </div>
        )}
        {!attendanceToday ? (
          <Button variant="primary" onClick={onCheckIn} disabled={attendanceLoading || !attendanceLoaded}>
            <LogIn size={18} /> {attendanceLoading ? 'Mengambil Lokasi GPS...' : !attendanceLoaded ? 'Memuat data absensi...' : 'Absen Masuk'}
          </Button>
        ) : !attendanceToday.checkOutTime ? (
          <div className="space-y-3">
            <div className={`flex items-center gap-2 text-sm font-medium p-3 rounded-xl border ${attendanceToday.status === 'Terlambat' ? 'bg-yellow-50 text-yellow-700 border-yellow-100' : 'bg-emerald-50 text-emerald-700 border-emerald-100'}`}>
              <CheckCircle size={18} /> Masuk pukul {attendanceToday.checkInTime} &bull; {attendanceToday.status}
            </div>
            <Button variant="secondary" onClick={onCheckOut} disabled={attendanceLoading}>
              <Clock size={18} /> {attendanceLoading ? 'Mengambil Lokasi GPS...' : 'Absen Pulang'}
            </Button>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-emerald-700 text-sm font-medium bg-emerald-50 p-3 rounded-xl border border-emerald-100">
              <CheckCircle size={18} /> Masuk: {attendanceToday.checkInTime} ({attendanceToday.status})
            </div>
            <div className="flex items-center gap-2 text-blue-700 text-sm font-medium bg-blue-50 p-3 rounded-xl border border-blue-100">
              <CheckCircle size={18} /> Pulang: {attendanceToday.checkOutTime}
            </div>
          </div>
        )}
        {attendanceToday && (
          attendancePending ? (
            <div className="mt-3 flex items-center gap-2 text-xs font-medium text-amber-700 bg-amber-50 border border-amber-100 p-2.5 rounded-lg">
              <RefreshCw size={14} className="flex-shrink-0 animate-spin" /> Menunggu terkirim ke server. Dicoba ulang otomatis, pastikan internet aktif.
            </div>
          ) : (
            <p className="mt-3 text-xs font-medium text-emerald-600 flex items-center gap-1"><CheckCircle size={12} /> Tersimpan di server</p>
          )
        )}
      </Card>

      <div className="grid grid-cols-2 gap-4">
        <Card className="p-4 flex flex-col items-center text-center">
          <div className="w-12 h-12 bg-blue-50 text-blue-600 rounded-full flex items-center justify-center mb-3">
            <MapPin size={24} />
          </div>
          <span className="text-3xl font-black text-slate-800">{visitsToday}</span>
          <span className="text-xs font-medium text-slate-500 mt-1">Kunjungan Hari Ini</span>
        </Card>
        <Card className="p-4 flex flex-col items-center text-center">
          <div className="w-12 h-12 bg-emerald-50 text-emerald-600 rounded-full flex items-center justify-center mb-3">
            <Store size={24} />
          </div>
          <span className="text-3xl font-black text-slate-800">{newCustomers}</span>
          <span className="text-xs font-medium text-slate-500 mt-1">Total Toko Baru</span>
        </Card>
      </div>

      <Card className="p-4 bg-blue-50 border-blue-100">
        <h3 className="font-bold text-blue-800 mb-2 flex items-center gap-2">
          <TrendingUp size={18} /> Ringkasan Aktivitas Anda
        </h3>
        <p className="text-sm text-blue-700">
          Terus tingkatkan kunjungan Anda. Konsistensi canvassing adalah kunci mendapatkan pelanggan tetap.
          Pastikan semua data kunjungan tercatat dengan valid menggunakan GPS.
        </p>
      </Card>
    </div>
  );
};

// Mengecilkan/mengompres foto sebelum disimpan - foto asli dari kamera HP
// bisa beberapa MB dan bikin proses kirim/unggah ke server sangat lambat.
// Dipakai baik saat input kunjungan baru maupun saat edit foto belakangan.
function compressImageFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const MAX_DIMENSION = 1280;
        let { width, height } = img;
        if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
          if (width > height) {
            height = Math.round((height * MAX_DIMENSION) / width);
            width = MAX_DIMENSION;
          } else {
            width = Math.round((width * MAX_DIMENSION) / height);
            height = MAX_DIMENSION;
          }
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) { reject(new Error('Canvas tidak didukung di browser ini.')); return; }
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', 0.7));
      };
      img.onerror = () => reject(new Error('Gagal memuat foto.'));
      img.src = reader.result as string;
    };
    reader.onerror = () => reject(new Error('Gagal membaca file foto.'));
    reader.readAsDataURL(file);
  });
}

const CanvassingForm = ({ user, onSubmit, businessTypes }: { user: User, onSubmit: (v: any) => void, businessTypes: string[] }) => {
  const [formData, setFormData] = useState({
    shopName: '', phone: '', businessType: '', status: ''
  });
  const [isNewCustomer, setIsNewCustomer] = useState(false);
  const [location, setLocation] = useState<{ lat: number, lng: number } | null>(null);
  const [locating, setLocating] = useState(false);
  const [locError, setLocError] = useState('');
  const [photo, setPhoto] = useState<string | null>(null);
  const [photoError, setPhotoError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [compressingPhoto, setCompressingPhoto] = useState(false);

  const getLocation = () => {
    setLocating(true);
    setLocError('');
    if ('geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          setLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude });
          setLocating(false);
        },
        () => {
          setLocError('Gagal mendapat lokasi. Pastikan GPS/Location service aktif di HP Anda.');
          setLocating(false);
        },
        { enableHighAccuracy: true, timeout: 10000 }
      );
    } else {
      setLocError('Browser tidak mendukung GPS.');
      setLocating(false);
    }
  };

  const handlePhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setPhotoError('');
    setCompressingPhoto(true);
    compressImageFile(file)
      .then(setPhoto)
      .catch(() => setPhotoError('Gagal memproses foto, coba ambil ulang.'))
      .finally(() => setCompressingPhoto(false));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!location) {
      alert("Lokasi GPS WAJIB diambil sebelum submit form!");
      return;
    }
    if (!formData.shopName.trim()) {
      alert("Nama toko wajib diisi.");
      return;
    }
    setSubmitting(true);
    const newVisit: Visit = {
      id: Date.now().toString(),
      date: localDateStr(),
      time: formatHHmm(),
      shopName: formData.shopName.trim(),
      owner: '',
      phone: formData.phone.trim(),
      businessType: formData.businessType,
      status: formData.status,
      result: '',
      isNewCustomer,
      lat: location.lat,
      lng: location.lng,
      cabang: user.cabang,
      area: user.area || '',
      pegawaiId: user.id,
      photo: photo || '',
    };
    onSubmit(newVisit);
    alert("Data Kunjungan Canvassing berhasil disimpan!");
    setSubmitting(false);
  };

  const statuses = ['Closing', 'Prospek'];

  return (
    <div className="p-4 pb-24">
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-slate-800">Canvasing Baru</h2>
        <p className="text-slate-500 text-sm">Catat detail kunjungan Anda ke toko/pelanggan.</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <Card className="p-5">
          <h3 className="font-bold text-slate-800 mb-4 border-b pb-2 flex items-center gap-2"><Store size={18} /> Informasi Toko</h3>

          <div className="flex items-center gap-3 mb-4 p-3 bg-blue-50 border border-blue-100 rounded-xl">
            <input type="checkbox" id="isNew" checked={isNewCustomer} onChange={(e) => setIsNewCustomer(e.target.checked)} className="w-5 h-5 text-blue-600 rounded" />
            <label htmlFor="isNew" className="font-semibold text-blue-800 text-sm">Tandai sebagai Toko Baru (Pelanggan Baru)</label>
          </div>

          <Input label="Nama Toko/Usaha" required value={formData.shopName} onChange={(e: any) => setFormData({ ...formData, shopName: e.target.value })} placeholder="Cth: Warung Makmur" />
          <Input label="Nomor WhatsApp/HP (Opsional, bisa diisi belakangan)" type="tel" value={formData.phone} onChange={(e: any) => setFormData({ ...formData, phone: e.target.value })} placeholder="08..." />
          <Select label="Jenis Usaha" options={businessTypes} required value={formData.businessType} onChange={(e: any) => setFormData({ ...formData, businessType: e.target.value })} />
        </Card>

        <Card className="p-5">
          <h3 className="font-bold text-slate-800 mb-4 border-b pb-2 flex items-center gap-2">
            <MapPin size={18} className="text-red-500" /> Bukti Kunjungan (GPS & Foto)
          </h3>

          <div className="mb-4">
            <label className="block text-sm font-medium text-slate-600 mb-1.5">Titik GPS (Wajib) <span className="text-red-500">*</span></label>
            {location ? (
              <div className="bg-emerald-50 text-emerald-700 p-3 rounded-xl border border-emerald-200 flex items-center gap-2 text-sm font-medium">
                <CheckCircle size={18} /> Lokasi Terkunci ({location.lat.toFixed(4)}, {location.lng.toFixed(4)})
              </div>
            ) : (
              <Button variant="outline" onClick={getLocation} disabled={locating} className="border-blue-200 text-blue-700 bg-blue-50 hover:bg-blue-100">
                <MapPin size={18} /> {locating ? 'Mencari Satelit GPS...' : 'Ambil Lokasi GPS Saat Ini'}
              </Button>
            )}
            {locError && <p className="text-red-500 text-xs mt-1">{locError}</p>}
          </div>

          <div className="mb-4">
            <label className="block text-sm font-medium text-slate-600 mb-1.5">Foto Depan Toko (Opsional, bisa ditambah belakangan)</label>
            {compressingPhoto ? (
              <div className="border-2 border-dashed border-slate-300 bg-slate-50 rounded-xl p-6 text-center">
                <RefreshCw size={28} className="mx-auto text-slate-400 mb-2 animate-spin" />
                <span className="text-sm font-medium text-slate-600">Memproses foto...</span>
              </div>
            ) : photo ? (
              <div className="relative">
                <img src={photo} alt="Preview toko" className="w-full h-40 object-cover rounded-xl border border-slate-200" />
                <button type="button" onClick={() => setPhoto(null)} className="absolute top-2 right-2 bg-white/90 p-1.5 rounded-full shadow text-red-500 hover:bg-white">
                  <X size={16} />
                </button>
              </div>
            ) : (
              <div className="border-2 border-dashed border-slate-300 bg-slate-50 rounded-xl p-6 text-center cursor-pointer hover:bg-slate-100 transition-colors relative">
                <input type="file" accept="image/*" onChange={handlePhotoChange} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" />
                <Camera size={32} className="mx-auto text-slate-400 mb-2" />
                <span className="text-sm font-medium text-slate-600">Buka Kamera / Upload</span>
              </div>
            )}
            {photoError && <p className="text-red-500 text-xs mt-1">{photoError}</p>}
          </div>
        </Card>

        <Card className="p-5">
          <h3 className="font-bold text-slate-800 mb-4 border-b pb-2">Status Kunjungan</h3>
          <Select label="Status Kunjungan Hari Ini" options={statuses} required value={formData.status} onChange={(e: any) => setFormData({ ...formData, status: e.target.value })} />
        </Card>

        <Button type="submit" variant="primary" disabled={submitting || compressingPhoto} className="py-4 text-lg mt-6 shadow-xl w-full sticky bottom-20 z-10">
          {compressingPhoto ? 'Memproses foto...' : submitting ? 'Menyimpan...' : 'Kirim Laporan Kunjungan'}
        </Button>
      </form>
    </div>
  );
};

const ALL_DAY_NAMES = ['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu', 'Minggu'];

const AttendanceScheduleForm = ({ settings, onSave }: { settings: AttendanceSettings, onSave: (s: AttendanceSettings) => Promise<SaveStatus> | void }) => {
  const [form, setForm] = useState<AttendanceSettings>(settings);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<SaveStatus | null>(null);

  // Ikuti pengaturan terbaru dari server (mis. dimuat setelah form terbuka,
  // atau diubah Admin lain). Hanya berubah kalau isinya memang berbeda.
  useEffect(() => { setForm(settings); }, [settings]);

  const toggleDay = (day: string) => {
    setForm((prev) => ({
      ...prev,
      activeDays: prev.activeDays.includes(day)
        ? prev.activeDays.filter((d) => d !== day)
        : [...prev.activeDays, day],
    }));
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    if (timeToMinutes(form.checkInEnd) < timeToMinutes(form.checkInStart)) {
      setResult({ status: 'error', message: 'Batas akhir jam masuk tidak boleh lebih awal dari jam masuk.' });
      return;
    }
    if (timeToMinutes(form.checkOutEnd) < timeToMinutes(form.checkOutStart)) {
      setResult({ status: 'error', message: 'Batas akhir jam pulang tidak boleh lebih awal dari jam pulang.' });
      return;
    }
    if (form.isActive && form.activeDays.length === 0) {
      setResult({ status: 'error', message: 'Pilih minimal satu hari kerja aktif.' });
      return;
    }
    setSaving(true);
    setResult(null);
    const res = await onSave(form);
    setSaving(false);
    setResult(res || { status: 'ok', message: 'Tersimpan.' });
  };

  return (
    <form onSubmit={handleSave} className="space-y-4">
      <Card className="p-5">
        <div className="flex items-center justify-between mb-4 pb-3 border-b">
          <div>
            <h3 className="font-bold text-slate-800">Status Aturan Jadwal</h3>
            <p className="text-xs text-slate-500 mt-0.5">Kalau dimatikan, pegawai bisa absen kapan saja tanpa batasan jam.</p>
          </div>
          <button
            type="button"
            onClick={() => setForm({ ...form, isActive: !form.isActive })}
            className={`px-4 py-2 rounded-xl font-semibold text-sm flex items-center gap-2 ${form.isActive ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-500'}`}
          >
            {form.isActive ? <Power size={16} /> : <PowerOff size={16} />}
            {form.isActive ? 'Aktif' : 'Nonaktif'}
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4">
          <Input label="Jam Masuk" type="time" value={form.checkInStart} onChange={(e: any) => setForm({ ...form, checkInStart: e.target.value })} required />
          <Input label="Batas Akhir Jam Masuk" type="time" value={form.checkInEnd} onChange={(e: any) => setForm({ ...form, checkInEnd: e.target.value })} required />
          <Input label="Jam Pulang" type="time" value={form.checkOutStart} onChange={(e: any) => setForm({ ...form, checkOutStart: e.target.value })} required />
          <Input label="Batas Akhir Jam Pulang" type="time" value={form.checkOutEnd} onChange={(e: any) => setForm({ ...form, checkOutEnd: e.target.value })} required />
        </div>
        <Input
          label="Toleransi Keterlambatan (menit)" type="number" value={form.toleranceMinutes}
          onChange={(e: any) => setForm({ ...form, toleranceMinutes: Math.max(0, Number(e.target.value)) })}
        />

        <div className="mb-2">
          <label className="block text-sm font-medium text-slate-600 mb-2">Hari Kerja Aktif</label>
          <div className="flex flex-wrap gap-2">
            {ALL_DAY_NAMES.map((day) => (
              <button
                type="button" key={day} onClick={() => toggleDay(day)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold border ${form.activeDays.includes(day) ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-500 border-slate-200'}`}
              >
                {day}
              </button>
            ))}
          </div>
        </div>
      </Card>

      <Button type="submit" variant="primary" disabled={saving}>{saving ? 'Menyimpan & memeriksa ke server...' : 'Simpan Pengaturan Jadwal'}</Button>
      {result && (
        <div className={`p-3 rounded-xl text-sm font-medium border ${result.status === 'ok' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : result.status === 'warn' ? 'bg-amber-50 text-amber-800 border-amber-200' : 'bg-red-50 text-red-700 border-red-200'}`}>
          {result.status === 'ok' ? '✓ ' : '⚠ '}{result.message}
        </div>
      )}
    </form>
  );
};

const AdminAttendance = ({
  attendance, users, attendanceSettings, onUpdateSettings, onRefresh, lastSynced
}: {
  attendance: Attendance[], users: User[], attendanceSettings: AttendanceSettings, onUpdateSettings: (s: AttendanceSettings) => Promise<SaveStatus> | void,
  onRefresh: () => Promise<void> | void, lastSynced: Date | null
}) => {
  const todayStr = localDateStr();
  const [refreshing, setRefreshing] = useState(false);
  const doRefresh = async () => { setRefreshing(true); try { await onRefresh(); } finally { setRefreshing(false); } };
  const [innerTab, setInnerTab] = useState<'rekap' | 'jadwal'>('rekap');
  const [filterCabang, setFilterCabang] = useState('Semua');
  const [filterDate, setFilterDate] = useState(todayStr);

  const cabangList = ['Semua', ...Array.from(new Set(users.filter(u => u.role === 'pegawai').map(u => u.cabang)))];

  const activePegawai = users.filter(u => u.role === 'pegawai' && u.status === 'Aktif' && (filterCabang === 'Semua' || u.cabang === filterCabang));

  // Satu catatan per pegawai per hari (baris ganda dari absen di dua HP dirapikan)
  const dayRecords = uniqueDailyRecords(attendance, filterDate).filter(a => {
    const peg = users.find(u => u.id === a.pegawaiId);
    if (filterCabang !== 'Semua' && peg?.cabang !== filterCabang) return false;
    return true;
  });

  const hadirCount = dayRecords.length;
  const terlambatCount = dayRecords.filter(a => a.status === 'Terlambat').length;
  const belumAbsenCount = Math.max(0, activePegawai.length - hadirCount);

  const openInGoogleMaps = (lat: number | null | undefined, lng: number | null | undefined) => {
    if (lat === null || lat === undefined || lng === null || lng === undefined) return;
    window.open(`https://www.google.com/maps?q=${lat},${lng}`, '_blank', 'noopener,noreferrer');
  };

  return (
    <div className="p-6 md:p-8 space-y-6 bg-slate-50 min-h-screen">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-slate-800">Absensi Karyawan</h1>
          <p className="text-slate-500">Rekap kehadiran pegawai lapangan berbasis GPS.</p>
        </div>
        <div className="flex items-center gap-3">
          {lastSynced && <span className="text-xs text-slate-400">Diperbarui {formatHHmm(lastSynced)}</span>}
          <button onClick={doRefresh} disabled={refreshing} className="px-3 py-2 bg-white border border-slate-200 text-slate-700 rounded-xl text-sm font-semibold hover:border-blue-600 hover:text-blue-600 flex items-center gap-1.5 shadow-sm disabled:opacity-60">
            <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} /> Segarkan
          </button>
        </div>
      </div>

      <div className="flex gap-2 bg-slate-100 p-1 rounded-xl w-fit">
        <button onClick={() => setInnerTab('rekap')} className={`px-4 py-2 rounded-lg text-sm font-semibold ${innerTab === 'rekap' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500'}`}>Rekap Kehadiran</button>
        <button onClick={() => setInnerTab('jadwal')} className={`px-4 py-2 rounded-lg text-sm font-semibold ${innerTab === 'jadwal' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500'}`}>Pengaturan Jadwal</button>
      </div>

      {innerTab === 'jadwal' ? (
        <AttendanceScheduleForm settings={attendanceSettings} onSave={onUpdateSettings} />
      ) : (
        <>
          <Card className="p-5">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Select label="Filter Cabang" value={filterCabang} onChange={(e: any) => setFilterCabang(e.target.value)} options={cabangList} />
              <Input label="Tanggal" type="date" value={filterDate} onChange={(e: any) => setFilterDate(e.target.value)} />
              <div className="flex items-end pb-4">
                <Button variant="outline" className="w-full" onClick={() => { setFilterCabang('Semua'); setFilterDate(todayStr); }}>Reset ke Hari Ini</Button>
              </div>
            </div>
          </Card>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Card className="p-6 border-l-4 border-l-emerald-500">
              <p className="text-slate-500 text-sm font-medium">Hadir</p>
              <p className="text-3xl font-black text-slate-800 mt-2">{hadirCount}</p>
            </Card>
            <Card className="p-6 border-l-4 border-l-yellow-500">
              <p className="text-slate-500 text-sm font-medium">Terlambat</p>
              <p className="text-3xl font-black text-slate-800 mt-2">{terlambatCount}</p>
            </Card>
            <Card className="p-6 border-l-4 border-l-red-500">
              <p className="text-slate-500 text-sm font-medium">Belum Absen</p>
              <p className="text-3xl font-black text-slate-800 mt-2">{belumAbsenCount}</p>
            </Card>
          </div>

          <Card className="p-0 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm whitespace-nowrap">
                <thead className="bg-slate-100 text-slate-600 font-medium">
                  <tr>
                    <th className="p-4">Nama Pegawai</th>
                    <th className="p-4">Cabang</th>
                    <th className="p-4">Jam Masuk</th>
                    <th className="p-4">Status</th>
                    <th className="p-4">Jam Pulang</th>
                    <th className="p-4 text-center">Lokasi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {activePegawai.map(u => {
                    const rec = dayRecords.find(a => a.pegawaiId === u.id);
                    return (
                      <tr key={u.id} className="hover:bg-slate-50 transition-colors">
                        <td className="p-4 font-semibold text-slate-800">{u.name}</td>
                        <td className="p-4 text-slate-600">{u.cabang}</td>
                        <td className="p-4 text-slate-600">{rec ? rec.checkInTime : '-'}</td>
                        <td className="p-4">
                          {rec ? (
                            <span className={`px-3 py-1 rounded-full text-xs font-bold ${rec.status === 'Terlambat' ? 'bg-yellow-100 text-yellow-700' : rec.status === 'Tidak Valid' ? 'bg-slate-200 text-slate-600' : 'bg-emerald-100 text-emerald-700'}`}>
                              {rec.status}
                            </span>
                          ) : (
                            <span className="px-3 py-1 rounded-full text-xs font-bold bg-red-100 text-red-700">Belum Absen</span>
                          )}
                        </td>
                        <td className="p-4 text-slate-600">{rec?.checkOutTime || (rec ? 'Belum Pulang' : '-')}</td>
                        <td className="p-4 text-center">
                          {rec ? (
                            <button onClick={() => openInGoogleMaps(rec.checkInLat, rec.checkInLng)} className="p-2 bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100 inline-flex" title="Lihat lokasi absen masuk">
                              <ExternalLink size={16} />
                            </button>
                          ) : '-'}
                        </td>
                      </tr>
                    );
                  })}
                  {activePegawai.length === 0 && (
                    <tr><td colSpan={6} className="p-6 text-center text-slate-400">Belum ada pegawai aktif untuk cabang ini.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </div>
  );
};

const AdminEmployees = ({ users, setUsers, addAuditLog, targets, onUpdateTargets, businessTypes, onUpdateBusinessTypes }: { users: User[], setUsers: any, addAuditLog: any, targets: Target[], onUpdateTargets: (t: Target[]) => void, businessTypes: string[], onUpdateBusinessTypes: (b: string[]) => void }) => {
  const [newBusinessType, setNewBusinessType] = useState('');
  const [showModal, setShowModal] = useState<'add' | 'edit' | 'reset' | null>(null);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [formData, setFormData] = useState<any>({});

  const cabangs = ['Pusat', 'Limbangan', 'Wanaraja', 'Tasikmalaya', 'Garut Kota', 'Ciawi'];
  const roles = ['admin', 'pegawai'];

  const handleOpenModal = (type: 'add' | 'edit' | 'reset', user: User | null = null) => {
    setSelectedUser(user);
    if (type === 'add') {
      setFormData({ id: '', name: '', password: '', confirm: '', cabang: '', area: '', role: 'pegawai', status: 'Aktif' });
    } else if (type === 'edit' && user) {
      const effective = getEffectiveTarget(user, targets);
      setFormData({ ...user, visitTarget: effective.visits, newCustomerTarget: effective.newCustomers });
    } else if (type === 'reset') {
      setFormData({ password: '', confirm: '' });
    }
    setShowModal(type);
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanId = (formData.id || '').trim().toUpperCase();
    const cleanName = (formData.name || '').trim();

    if (showModal === 'add') {
      if (!cleanId || !cleanName) return alert("ID Login dan Nama wajib diisi.");
      if (users.find(u => u.id.toUpperCase() === cleanId)) return alert("ID Login sudah digunakan!");
      if (formData.password.length < 8) return alert("Password minimal 8 karakter.");
      if (formData.password !== formData.confirm) return alert("Password tidak cocok!");

      const newUser: User = {
        ...formData,
        id: cleanId,
        name: cleanName,
        target: { visits: 100, newCustomers: 20 },
        lastLogin: '-'
      };
      setUsers([...users, newUser]);
      addAuditLog('Tambah Akun', `Menambahkan pegawai baru: ${newUser.name} (${newUser.id})`);
    } else if (showModal === 'edit' && selectedUser) {
      if (!cleanId || !cleanName) return alert("ID Login dan Nama wajib diisi.");
      if (cleanId !== selectedUser.id.toUpperCase() && users.find(u => u.id.toUpperCase() === cleanId)) return alert("ID Login sudah digunakan user lain!");

      const visitTarget = Math.max(0, Number(formData.visitTarget) || 0);
      const newCustomerTarget = Math.max(0, Number(formData.newCustomerTarget) || 0);

      setUsers(users.map(u => u.id === selectedUser.id
        ? { ...u, ...formData, id: cleanId, name: cleanName, target: { visits: visitTarget, newCustomers: newCustomerTarget } }
        : u));

      // Samakan dengan Target Canvasing bulan ini: perbarui kalau sudah ada, buat baru kalau belum.
      const thisMonthStr = localMonthStr();
      const existingTarget = targets.find(t => t.period === 'bulanan' && t.scope === 'pegawai' && t.scopeId === selectedUser.id && t.startDate.slice(0, 7) === thisMonthStr);
      if (existingTarget) {
        onUpdateTargets(targets.map(t => t.id === existingTarget.id ? { ...t, visitTarget, newCustomerTarget, scopeLabel: cleanName } : t));
      } else {
        const newTarget: Target = {
          id: Date.now().toString(),
          scope: 'pegawai',
          scopeId: cleanId,
          scopeLabel: cleanName,
          period: 'bulanan',
          startDate: localDateStr(),
          visitTarget,
          newCustomerTarget,
        };
        onUpdateTargets([newTarget, ...targets]);
      }

      addAuditLog('Edit Akun', `Mengubah profil/target pegawai: ${cleanName}`);
    } else if (showModal === 'reset' && selectedUser) {
      if (formData.password.length < 8) return alert("Password minimal 8 karakter.");
      if (formData.password !== formData.confirm) return alert("Password tidak cocok!");

      setUsers(users.map(u => u.id === selectedUser.id ? { ...u, password: formData.password } : u));
      addAuditLog('Reset Password', `Mereset sandi untuk: ${selectedUser.name}`);
    }
    setShowModal(null);
  };

  const toggleStatus = (user: User) => {
    const newStatus = user.status === 'Aktif' ? 'Nonaktif' : 'Aktif';
    setUsers(users.map(u => u.id === user.id ? { ...u, status: newStatus } : u));
    addAuditLog('Ubah Status', `Mengubah status ${user.name} menjadi ${newStatus}`);
  };

  const handleDelete = (user: User) => {
    if (confirm(`Yakin ingin menghapus permanen akun ${user.name}? Data kunjungannya akan tetap ada namun anonim.`)) {
      setUsers(users.filter(u => u.id !== user.id));
      addAuditLog('Hapus Akun', `Menghapus akun pegawai: ${user.name} (${user.id})`);
    }
  };

  return (
    <div className="p-6 md:p-8 space-y-6 bg-slate-50 min-h-screen relative">
      <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-slate-800">Kelola Akun Pegawai</h1>
          <p className="text-slate-500">Manajemen akses aplikasi canvasing</p>
        </div>
        <Button onClick={() => handleOpenModal('add')} variant="primary" className="py-2.5 w-auto px-6"><UserPlus size={18} /> Tambah Pegawai</Button>
      </div>

      <Card className="p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm whitespace-nowrap">
            <thead className="bg-slate-100 text-slate-600 font-medium">
              <tr>
                <th className="p-4">ID Login</th>
                <th className="p-4">Nama Pegawai</th>
                <th className="p-4">Cabang</th>
                <th className="p-4">Target Kunjungan</th>
                <th className="p-4">Status</th>
                <th className="p-4 text-center">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {users.map((u) => (
                <tr key={u.id} className="hover:bg-slate-50 transition-colors">
                  <td className="p-4 font-bold text-slate-800">{u.id}</td>
                  <td className="p-4">
                    <p className="font-semibold text-slate-800">{u.name}</p>
                    <p className="text-xs text-slate-500 uppercase">{u.role}</p>
                  </td>
                  <td className="p-4 text-slate-600">{u.cabang} {u.area && `(${u.area})`}</td>
                  <td className="p-4 text-slate-600 font-medium">{getEffectiveTarget(u, targets).visits} Toko/Bulan</td>
                  <td className="p-4">
                    <span className={`px-3 py-1 rounded-full text-xs font-bold ${u.status === 'Aktif' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
                      {u.status}
                    </span>
                  </td>
                  <td className="p-4 flex items-center justify-center gap-2">
                    <button onClick={() => handleOpenModal('edit', u)} className="p-2 bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100" title="Edit Profil"><Edit size={16} /></button>
                    <button onClick={() => handleOpenModal('reset', u)} className="p-2 bg-yellow-50 text-yellow-600 rounded-lg hover:bg-yellow-100" title="Reset Sandi"><Key size={16} /></button>
                    <button onClick={() => toggleStatus(u)} className={`p-2 rounded-lg ${u.status === 'Aktif' ? 'bg-orange-50 text-orange-600 hover:bg-orange-100' : 'bg-emerald-50 text-emerald-600 hover:bg-emerald-100'}`} title={u.status === 'Aktif' ? 'Nonaktifkan' : 'Aktifkan'}>
                      {u.status === 'Aktif' ? <PowerOff size={16} /> : <Power size={16} />}
                    </button>
                    {u.id !== 'GARUDA1' && <button onClick={() => handleDelete(u)} className="p-2 bg-red-50 text-red-600 rounded-lg hover:bg-red-100" title="Hapus"><Trash2 size={16} /></button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card className="p-6">
        <h3 className="font-bold text-slate-800 mb-1">Kelola Jenis Usaha</h3>
        <p className="text-xs text-slate-500 mb-4">Daftar pilihan "Jenis Usaha" yang muncul di form Canvasing pegawai. Tambah atau hapus sesuai kebutuhan.</p>
        <div className="flex flex-wrap gap-2 mb-4">
          {businessTypes.map((bt) => (
            <span key={bt} className="flex items-center gap-1.5 bg-blue-50 text-blue-700 text-sm font-medium px-3 py-1.5 rounded-full">
              {bt}
              <button
                onClick={() => onUpdateBusinessTypes(businessTypes.filter((x) => x !== bt))}
                className="text-blue-400 hover:text-red-500"
                title={`Hapus ${bt}`}
              >
                <X size={14} />
              </button>
            </span>
          ))}
          {businessTypes.length === 0 && <p className="text-sm text-slate-400">Belum ada jenis usaha. Tambahkan minimal satu.</p>}
        </div>
        <div className="flex gap-2">
          <input
            value={newBusinessType}
            onChange={(e) => setNewBusinessType(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                const v = newBusinessType.trim();
                if (v && !businessTypes.includes(v)) onUpdateBusinessTypes([...businessTypes, v]);
                setNewBusinessType('');
              }
            }}
            placeholder="Tambah jenis usaha baru, cth: Toko Kelontong"
            className="flex-1 bg-slate-50 border border-slate-200 text-slate-800 rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            onClick={() => {
              const v = newBusinessType.trim();
              if (v && !businessTypes.includes(v)) onUpdateBusinessTypes([...businessTypes, v]);
              setNewBusinessType('');
            }}
            className="px-4 py-2.5 bg-blue-600 text-white rounded-xl font-semibold hover:bg-blue-700 flex items-center gap-2"
          >
            <PlusCircle size={16} /> Tambah
          </button>
        </div>
      </Card>

      {/* MODALS */}
      {showModal && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <Card className="w-full max-w-xl p-6 animate-in fade-in zoom-in-95">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-xl font-bold text-slate-800">
                {showModal === 'add' ? 'Tambah Pegawai Baru' : showModal === 'edit' ? 'Edit Profil Pegawai' : 'Reset Password'}
              </h2>
              <button onClick={() => setShowModal(null)} className="p-2 text-slate-400 hover:text-red-500"><X size={20} /></button>
            </div>
            <form onSubmit={handleSave} className="space-y-4">
              {showModal !== 'reset' && (
                <>
                  <div className="grid grid-cols-2 gap-4">
                    <Input label="ID Login" value={formData.id} onChange={(e: any) => setFormData({ ...formData, id: e.target.value })} placeholder="Unik & Tanpa Spasi" required />
                    <Input label="Nama Lengkap" value={formData.name} onChange={(e: any) => setFormData({ ...formData, name: e.target.value })} required />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <Select label="Cabang" value={formData.cabang} onChange={(e: any) => setFormData({ ...formData, cabang: e.target.value })} options={cabangs} required />
                    <Select label="Role/Jabatan" value={formData.role} onChange={(e: any) => setFormData({ ...formData, role: e.target.value })} options={roles} required />
                  </div>
                  <Input label="Area Operasional" value={formData.area || ''} onChange={(e: any) => setFormData({ ...formData, area: e.target.value })} placeholder="Opsional (Cth: Cibiuk)" />

                  {showModal === 'edit' && formData.role === 'pegawai' && (
                    <div className="bg-emerald-50 p-4 rounded-xl border border-emerald-100 space-y-4">
                      <h3 className="font-semibold text-emerald-800 text-sm flex items-center gap-2"><TargetIcon size={16} /> Target Bulan Ini (tersinkron dengan Target Canvasing)</h3>
                      <div className="grid grid-cols-2 gap-4">
                        <Input label="Target Kunjungan" type="number" value={formData.visitTarget} onChange={(e: any) => setFormData({ ...formData, visitTarget: Math.max(0, Number(e.target.value)) })} />
                        <Input label="Target Toko Baru" type="number" value={formData.newCustomerTarget} onChange={(e: any) => setFormData({ ...formData, newCustomerTarget: Math.max(0, Number(e.target.value)) })} />
                      </div>
                    </div>
                  )}
                </>
              )}

              {(showModal === 'add' || showModal === 'reset') && (
                <div className="bg-blue-50 p-4 rounded-xl border border-blue-100 mt-4 space-y-4">
                  <h3 className="font-semibold text-blue-800 text-sm mb-2 flex items-center gap-2"><Shield size={16} /> Autentikasi Keamanan</h3>
                  <Input label="Password Baru" type="password" value={formData.password} onChange={(e: any) => setFormData({ ...formData, password: e.target.value })} required minLength={8} />
                  <Input label="Konfirmasi Password" type="password" value={formData.confirm} onChange={(e: any) => setFormData({ ...formData, confirm: e.target.value })} required minLength={8} />
                </div>
              )}

              <div className="flex gap-3 pt-4 border-t mt-6">
                <Button variant="outline" onClick={() => setShowModal(null)} className="flex-1">Batal</Button>
                <Button type="submit" variant="primary" className="flex-1">Simpan Data</Button>
              </div>
            </form>
          </Card>
        </div>
      )}
    </div>
  );
}

const PegawaiHistory = ({
  user, visits, businessTypes, onEditVisit, onDeleteVisit
}: {
  user: User, visits: Visit[], businessTypes: string[],
  onEditVisit: (visitId: string, updates: Partial<Visit>) => void,
  onDeleteVisit: (visitId: string) => void
}) => {
  const [editingVisit, setEditingVisit] = useState<Visit | null>(null);
  const [editForm, setEditForm] = useState({ shopName: '', phone: '', businessType: '', status: 'Prospek', isNewCustomer: false });
  const [editPhoto, setEditPhoto] = useState<string | null>(null);
  const [compressing, setCompressing] = useState(false);
  const [photoError, setPhotoError] = useState('');

  const myVisits = visits.filter(v => v.pegawaiId === user.id);
  const statuses = ['Prospek', 'Closing'];

  const openEdit = (v: Visit) => {
    setEditingVisit(v);
    setEditForm({
      shopName: v.shopName,
      phone: v.phone || '',
      businessType: v.businessType,
      status: v.status,
      isNewCustomer: v.isNewCustomer,
    });
    setEditPhoto(v.photo || null);
    setPhotoError('');
  };

  const handleEditPhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setPhotoError('');
    setCompressing(true);
    compressImageFile(file)
      .then(setEditPhoto)
      .catch(() => setPhotoError('Gagal memproses foto, coba ambil ulang.'))
      .finally(() => setCompressing(false));
  };

  const handleSaveEdit = () => {
    if (!editingVisit) return;
    if (!editForm.shopName.trim()) { alert('Nama toko wajib diisi.'); return; }
    onEditVisit(editingVisit.id, {
      shopName: editForm.shopName.trim(),
      phone: editForm.phone.trim(),
      businessType: editForm.businessType,
      status: editForm.status,
      isNewCustomer: editForm.isNewCustomer,
      photo: editPhoto || '',
    });
    setEditingVisit(null);
  };

  const handleDelete = (v: Visit) => {
    if (confirm(`Hapus data kunjungan "${v.shopName}"? Tindakan ini tidak bisa dibatalkan.`)) {
      onDeleteVisit(v.id);
    }
  };

  return (
    <div className="p-4 pb-24 space-y-4">
      <h2 className="text-xl font-bold text-slate-800 mb-4">Riwayat Kunjungan Saya</h2>
      {myVisits.map(v => (
        <Card key={v.id} className="p-4 flex flex-col gap-2 border-l-4 border-l-blue-500">
          <div className="flex justify-between items-start">
            <div>
              <h4 className="font-bold text-slate-800 flex items-center gap-1">
                {v.shopName} {v.isNewCustomer && <span className="bg-yellow-100 text-yellow-700 text-[10px] px-2 py-0.5 rounded-full ml-1 font-bold">Baru</span>}
              </h4>
              <p className="text-xs text-slate-500 flex items-center gap-1 mt-1"><MapPin size={12} /> {v.businessType}</p>
              {v.phone && <p className="text-xs text-slate-400 mt-0.5">{v.phone}</p>}
            </div>
            <span className={`text-[10px] px-2 py-1 rounded-full font-bold uppercase ${v.status === 'Closing' ? 'bg-emerald-100 text-emerald-700' : 'bg-pink-100 text-pink-700'}`}>
              {v.status}
            </span>
          </div>
          <div className="flex items-center justify-between mt-2 border-t pt-2">
            <span className="text-xs text-slate-400">{v.date} &bull; {v.time}</span>
            <div className="flex items-center gap-3">
              <button onClick={() => openEdit(v)} className="text-xs font-semibold text-blue-600 flex items-center gap-1 hover:text-blue-700">
                <Edit size={12} /> Edit
              </button>
              <button onClick={() => handleDelete(v)} className="text-xs font-semibold text-red-500 flex items-center gap-1 hover:text-red-600">
                <Trash2 size={12} /> Hapus
              </button>
            </div>
          </div>
        </Card>
      ))}
      {myVisits.length === 0 && (
        <p className="text-sm text-slate-400 text-center py-8">Belum ada riwayat kunjungan.</p>
      )}

      {editingVisit && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4 overflow-y-auto">
          <Card className="w-full max-w-sm p-6 my-8">
            <div className="flex justify-between items-center mb-4">
              <h3 className="font-bold text-slate-800">Edit Kunjungan</h3>
              <button onClick={() => setEditingVisit(null)} className="p-1 text-slate-400 hover:text-red-500"><X size={18} /></button>
            </div>

            <div className="flex items-center gap-3 mb-4 p-3 bg-blue-50 border border-blue-100 rounded-xl">
              <input type="checkbox" id="editIsNew" checked={editForm.isNewCustomer} onChange={(e) => setEditForm({ ...editForm, isNewCustomer: e.target.checked })} className="w-5 h-5 text-blue-600 rounded" />
              <label htmlFor="editIsNew" className="font-semibold text-blue-800 text-sm">Toko Baru (Pelanggan Baru)</label>
            </div>

            <Input label="Nama Toko/Usaha" required value={editForm.shopName} onChange={(e: any) => setEditForm({ ...editForm, shopName: e.target.value })} />
            <Input label="Nomor WhatsApp/HP" type="tel" value={editForm.phone} onChange={(e: any) => setEditForm({ ...editForm, phone: e.target.value })} placeholder="08..." />
            <Select label="Jenis Usaha" options={businessTypes} value={editForm.businessType} onChange={(e: any) => setEditForm({ ...editForm, businessType: e.target.value })} />
            <Select label="Status Kunjungan" options={statuses} value={editForm.status} onChange={(e: any) => setEditForm({ ...editForm, status: e.target.value })} />

            <div className="mb-2">
              <label className="block text-sm font-medium text-slate-600 mb-1.5">Foto Depan Toko</label>
              {compressing ? (
                <div className="border-2 border-dashed border-slate-300 bg-slate-50 rounded-xl p-6 text-center">
                  <RefreshCw size={24} className="mx-auto text-slate-400 mb-2 animate-spin" />
                  <span className="text-sm font-medium text-slate-600">Memproses foto...</span>
                </div>
              ) : editPhoto ? (
                <div className="relative">
                  <img src={editPhoto} alt="Preview toko" className="w-full h-40 object-cover rounded-xl border border-slate-200" />
                  <button type="button" onClick={() => setEditPhoto(null)} className="absolute top-2 right-2 bg-white/90 p-1.5 rounded-full shadow text-red-500 hover:bg-white">
                    <X size={16} />
                  </button>
                </div>
              ) : (
                <div className="border-2 border-dashed border-slate-300 bg-slate-50 rounded-xl p-6 text-center cursor-pointer hover:bg-slate-100 transition-colors relative">
                  <input type="file" accept="image/*" onChange={handleEditPhotoChange} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" />
                  <Camera size={28} className="mx-auto text-slate-400 mb-2" />
                  <span className="text-sm font-medium text-slate-600">Ambil Foto / Pilih dari Galeri</span>
                </div>
              )}
              {photoError && <p className="text-red-500 text-xs mt-1">{photoError}</p>}
            </div>

            <div className="flex gap-3 pt-4 border-t mt-4">
              <Button variant="outline" onClick={() => setEditingVisit(null)} className="flex-1">Batal</Button>
              <Button variant="primary" onClick={handleSaveEdit} disabled={compressing} className="flex-1">Simpan</Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
};

const AdminCanvasing = ({
  user, users, businessTypes, visits, targets, onAddVisit, onEditVisit, onDeleteVisit, onUpdateTargets
}: {
  user: User, users: User[], businessTypes: string[], visits: Visit[], targets: Target[],
  onAddVisit: (v: Visit) => void,
  onEditVisit: (visitId: string, updates: Partial<Visit>) => void,
  onDeleteVisit: (visitId: string) => void,
  onUpdateTargets: (t: Target[]) => void
}) => {
  const [innerTab, setInnerTab] = useState<'baru' | 'riwayat' | 'pengaturan'>('baru');

  const tabClass = (t: string) =>
    `px-4 py-2 rounded-lg text-sm font-semibold whitespace-nowrap ${innerTab === t ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500'}`;

  return (
    <div className="p-6 md:p-8 bg-slate-50 min-h-screen">
      <div className="mb-4">
        <h1 className="text-2xl md:text-3xl font-bold text-slate-800">Canvasing</h1>
        <p className="text-slate-500">Input kunjungan canvasing dan atur target canvasing.</p>
      </div>

      <div className="flex gap-2 bg-slate-100 p-1 rounded-xl w-fit max-w-full overflow-x-auto mb-6">
        <button onClick={() => setInnerTab('baru')} className={tabClass('baru')}>Input Baru</button>
        <button onClick={() => setInnerTab('riwayat')} className={tabClass('riwayat')}>Riwayat Saya</button>
        <button onClick={() => setInnerTab('pengaturan')} className={tabClass('pengaturan')}>Pengaturan Target</button>
      </div>

      {innerTab === 'pengaturan' ? (
        <Suspense fallback={<AdminSectionLoading />}>
          <AdminTargets visits={visits} users={users} targets={targets} onUpdateTargets={onUpdateTargets} />
        </Suspense>
      ) : (
        <div className="max-w-lg mx-auto md:mx-0">
          {innerTab === 'baru' ? (
            <CanvassingForm user={user} onSubmit={onAddVisit} businessTypes={businessTypes} />
          ) : (
            <PegawaiHistory user={user} visits={visits} businessTypes={businessTypes} onEditVisit={onEditVisit} onDeleteVisit={onDeleteVisit} />
          )}
        </div>
      )}
    </div>
  );
};

// Database Customer: daftar toko/pelanggan unik yang dirangkum dari data
// kunjungan canvasing. Satu toko = satu baris; info terbaru yang tersedia
// (no telp, foto, titik GPS) diambil dari kunjungan terbaru yang punya datanya.
const CustomerDatabase = ({
  visits, users, isAdmin
}: {
  visits: Visit[], users: User[], isAdmin: boolean
}) => {
  const [filterCabang, setFilterCabang] = useState('Semua');
  const [search, setSearch] = useState('');
  const [photoView, setPhotoView] = useState<{ url: string, name: string } | null>(null);

  const cabangList = ['Semua', ...Array.from(new Set(users.filter(u => u.role === 'pegawai').map(u => u.cabang)))];

  // Urutkan dari kunjungan terbaru ke terlama, lalu gabungkan per nama toko.
  const sorted = [...visits].sort((a, b) => ((a.date + ' ' + a.time) < (b.date + ' ' + b.time) ? 1 : -1));
  const grouped: Record<string, { shopName: string, cabang: string, phone: string, photo: string, lat: number | null, lng: number | null, lastDate: string }> = {};
  sorted.forEach((v) => {
    const key = (v.shopName || '').trim().toLowerCase();
    if (!key) return;
    const g = grouped[key];
    if (!g) {
      grouped[key] = {
        shopName: v.shopName.trim(), cabang: v.cabang, phone: v.phone || '', photo: v.photo || '',
        lat: v.lat ?? null, lng: v.lng ?? null, lastDate: v.date,
      };
    } else {
      if (!g.phone && v.phone) g.phone = v.phone;
      if (!g.photo && v.photo) g.photo = v.photo;
      if ((g.lat === null || g.lng === null) && v.lat !== null && v.lat !== undefined && v.lng !== null && v.lng !== undefined) {
        g.lat = v.lat; g.lng = v.lng;
      }
    }
  });

  let customers = Object.values(grouped);
  if (isAdmin && filterCabang !== 'Semua') customers = customers.filter(c => c.cabang === filterCabang);
  if (search.trim()) customers = customers.filter(c => c.shopName.toLowerCase().includes(search.trim().toLowerCase()));
  customers.sort((a, b) => a.shopName.localeCompare(b.shopName));

  const openMaps = (lat: number | null, lng: number | null) => {
    if (lat === null || lng === null) return;
    window.open(`https://www.google.com/maps?q=${lat},${lng}`, '_blank', 'noopener,noreferrer');
  };

  return (
    <div className={isAdmin ? 'p-6 md:p-8 space-y-6 bg-slate-50 min-h-screen' : 'p-4 pb-24 space-y-4'}>
      <div>
        <h1 className={isAdmin ? 'text-2xl md:text-3xl font-bold text-slate-800' : 'text-xl font-bold text-slate-800'}>Data Customer</h1>
        <p className="text-slate-500 text-sm">{customers.length} toko tercatat{isAdmin ? '' : ' dari kunjungan Anda'}.</p>
      </div>

      <div className={`flex gap-3 ${isAdmin ? 'flex-col sm:flex-row' : 'flex-col'}`}>
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Cari nama toko..."
            className="w-full bg-white border border-slate-200 text-slate-800 rounded-xl pl-9 pr-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500 shadow-sm"
          />
        </div>
        {isAdmin && (
          <select
            value={filterCabang}
            onChange={(e) => setFilterCabang(e.target.value)}
            className="bg-white border border-slate-200 text-slate-800 rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500 shadow-sm font-medium"
          >
            {cabangList.map(c => <option key={c} value={c}>Depot: {c}</option>)}
          </select>
        )}
      </div>

      <div className={isAdmin ? 'grid grid-cols-1 lg:grid-cols-2 gap-3' : 'space-y-3'}>
        {customers.map((c) => (
          <Card key={c.shopName.toLowerCase()} className="p-4 flex items-center gap-3">
            {c.photo ? (
              <button onClick={() => setPhotoView({ url: c.photo, name: c.shopName })} className="flex-shrink-0">
                <img src={c.photo} alt={c.shopName} className="w-16 h-16 object-cover rounded-xl border border-slate-200" />
              </button>
            ) : (
              <div className="w-16 h-16 flex-shrink-0 rounded-xl bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-300">
                <Camera size={22} />
              </div>
            )}
            <div className="flex-1 min-w-0">
              <h4 className="font-bold text-slate-800 truncate">{c.shopName}</h4>
              {isAdmin && <p className="text-xs text-slate-500 truncate">{c.cabang}</p>}
              {c.phone ? (
                <a href={`tel:${c.phone}`} className="text-sm text-blue-600 flex items-center gap-1 mt-0.5"><Phone size={12} /> {c.phone}</a>
              ) : (
                <p className="text-xs text-slate-400 mt-0.5">No telp belum diisi</p>
              )}
            </div>
            <div className="flex flex-col gap-1.5 flex-shrink-0">
              {c.lat !== null && c.lng !== null ? (
                <button onClick={() => openMaps(c.lat, c.lng)} className="px-2.5 py-1.5 bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100 text-xs font-semibold flex items-center gap-1">
                  <MapPin size={12} /> Lokasi
                </button>
              ) : (
                <span className="text-xs text-slate-300 px-2.5 py-1.5">Tanpa GPS</span>
              )}
            </div>
          </Card>
        ))}
        {customers.length === 0 && (
          <Card className="p-8 text-center text-slate-400 col-span-full">
            <Database size={28} className="mx-auto mb-2 text-slate-300" />
            {search.trim() ? 'Tidak ada toko yang cocok dengan pencarian.' : 'Belum ada data customer. Data otomatis muncul dari kunjungan canvasing.'}
          </Card>
        )}
      </div>

      {photoView && (
        <div className="fixed inset-0 bg-slate-900/70 backdrop-blur-sm z-[600] flex items-center justify-center p-4" onClick={() => setPhotoView(null)}>
          <div className="max-w-lg w-full" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-2">
              <span className="text-white font-semibold text-sm truncate">{photoView.name}</span>
              <button onClick={() => setPhotoView(null)} className="p-2 bg-white rounded-full shadow hover:bg-slate-100"><X size={18} /></button>
            </div>
            <img src={photoView.url} alt={photoView.name} className="w-full rounded-2xl shadow-2xl" />
          </div>
        </div>
      )}
    </div>
  );
};

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [visits, setVisits] = useState<Visit[]>([]);
  const [attendance, setAttendance] = useState<Attendance[]>([]);
  const [targets, setTargets] = useState<Target[]>([]);
  const [businessTypes, setBusinessTypes] = useState<string[]>(defaultBusinessTypes);
  const [attendanceSettings, setAttendanceSettings] = useState<AttendanceSettings>(defaultAttendanceSettings);
  const [currentTab, setCurrentTab] = useState<'home' | 'canvassing' | 'history' | 'customers' | 'map'>('home');
  const [adminTab, setAdminTab] = useState<'dashboard' | 'map' | 'employees' | 'attendance' | 'reports' | 'canvasing' | 'customers'>('dashboard');
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [initialized, setInitialized] = useState(false);
  const [attendanceLoading, setAttendanceLoading] = useState(false);
  const [isOnline, setIsOnline] = useState(true);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ type: 'success' | 'warning', text: string } | null>(null);

  // Pelacak penyimpanan lokal, supaya penyegaran otomatis dari server tidak
  // menimpa perubahan yang baru saja dibuat dan masih dalam proses dikirim.
  const pendingWritesRef = useRef(0);
  const lastLocalWriteRef = useRef(0);
  const refreshingRef = useRef(false);
  const lastRefreshRef = useRef(0);
  const refreshDataRef = useRef<(force?: boolean) => Promise<void>>(async () => {});

  // Antrean kirim: perubahan kunjungan/absensi disimpan di HP lebih dulu, lalu
  // dikirim ke server dan dicoba ulang otomatis sampai benar-benar berhasil.
  const [outbox, setOutbox] = useState<OutboxOp[]>(() => loadOutbox());
  const outboxRef = useRef<OutboxOp[]>(outbox);
  const flushingRef = useRef(false);
  const inflightIdRef = useRef<string | null>(null);
  const opsDoneRef = useRef(0);
  const flushOutboxRef = useRef<() => Promise<void>>(async () => {});
  const [outboxError, setOutboxError] = useState<string | null>(null);
  const [lastSynced, setLastSynced] = useState<Date | null>(null);
  const [attendanceLoaded, setAttendanceLoaded] = useState(false);

  const showNotice = (type: 'success' | 'warning', text: string) => {
    setNotice({ type, text });
    setTimeout(() => setNotice(null), type === 'success' ? 4000 : 9000);
  };

  // Pantau status koneksi supaya bisa tampil peringatan "Sedang Offline"
  // dan otomatis menyegarkan data begitu koneksi kembali (reconnect otomatis).
  useEffect(() => {
    setIsOnline(navigator.onLine);
    const goOnline = () => {
      setIsOnline(true);
      flushOutboxRef.current();
      refreshDataRef.current(true);
    };
    const goOffline = () => setIsOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  useEffect(() => {
    // Ambil data users, visits, attendance, settings, dan targets SEKALIGUS
    // secara paralel (bukan satu-satu berurutan) supaya total waktu tunggu
    // jauh lebih singkat, terutama kalau sumber datanya Google Sheets/Apps Script.
    setSyncing(true);
    const usersPromise = db.get('users');
    const visitsPromise = db.get('visits');
    const attendancePromise = db.get('attendance');
    const settingsPromise = db.get('settings');
    const targetsPromise = db.get('targets');
    const businessTypesPromise = db.get('businessTypes');

    // Layar login cuma butuh data 'users', jadi begitu itu selesai,
    // langsung tampilkan layar login tanpa menunggu data lainnya.
    usersPromise.then((loadedUsers) => {
      const finalUsers = loadedUsers.length > 0 ? loadedUsers : defaultUsers;
      setUsers(finalUsers);
      setInitialized(true);

      // Auto-login: kalau ada sesi tersimpan dari login sebelumnya, akunnya
      // masih aktif, DAN sesinya belum kedaluwarsa, langsung masuk tanpa
      // perlu login ulang. Sesi kedaluwarsa demi keamanan (mis. HP hilang/dipinjam).
      try {
        const savedSessionRaw = localStorage.getItem('esgaruda_session');
        if (savedSessionRaw) {
          const savedSession = JSON.parse(savedSessionRaw);
          const isExpired = Date.now() - savedSession.loginAt > SESSION_TIMEOUT_HOURS * 60 * 60 * 1000;
          const savedUser = finalUsers.find((u: User) => u.id === savedSession.id && u.status !== 'Nonaktif');
          if (savedUser && !isExpired) setUser(savedUser);
          else localStorage.removeItem('esgaruda_session');
        }
      } catch {
        localStorage.removeItem('esgaruda_session');
      }
    });
    visitsPromise.then((loadedVisits) => {
      const base = loadedVisits.length > 0 ? loadedVisits : (GAS_API_URL ? [] : defaultVisits);
      setVisits(sortVisitsDesc(applyOutbox(base as Visit[], outboxRef.current, 'visits')));
    });
    attendancePromise.then((loadedAttendance) => {
      setAttendance(sortAttendanceDesc(applyOutbox((loadedAttendance || []) as Attendance[], outboxRef.current, 'attendance')));
      setAttendanceLoaded(true);
    });
    settingsPromise.then((loadedSettings) => {
      setAttendanceSettings(loadedSettings && loadedSettings.length > 0 ? sanitizeAttendanceSettings(loadedSettings[0]) : defaultAttendanceSettings);
    });
    targetsPromise.then((loadedTargets) => {
      setTargets(loadedTargets || []);
    });
    businessTypesPromise.then((loadedTypes) => {
      const names = (loadedTypes || []).map((t: any) => t.name).filter(Boolean);
      setBusinessTypes(names.length > 0 ? names : defaultBusinessTypes);
    });

    Promise.allSettled([usersPromise, visitsPromise, attendancePromise, settingsPromise, targetsPromise, businessTypesPromise]).then(() => setSyncing(false));
  }, []);

  // Membungkus setiap penyimpanan ke server supaya penyegaran otomatis tahu
  // kapan ada perubahan lokal yang sedang dikirim.
  const trackWrite = async <T,>(fn: () => Promise<T>): Promise<T> => {
    pendingWritesRef.current += 1;
    lastLocalWriteRef.current = Date.now();
    setSyncing(true);
    try {
      return await fn();
    } finally {
      pendingWritesRef.current -= 1;
      lastLocalWriteRef.current = Date.now();
      setSyncing(false);
    }
  };

  const reportSaveFailure = (collection: string, verb = 'menyimpan') => {
    setSyncError(`Gagal ${verb} "${collection}" ke server. Data tersimpan sementara di HP ini, coba sinkron ulang nanti.`);
    setTimeout(() => setSyncError(null), 7000);
  };

  const syncToDB = async (collection: string, data: any) => {
    const result = await trackWrite(() => db.save(collection, data));
    if (!result.ok) reportSaveFailure(collection);
    return result;
  };

  // ===== Antrean kirim (outbox) =====
  const commitOutbox = (ops: OutboxOp[]) => {
    outboxRef.current = ops;
    saveOutbox(ops);
    setOutbox(ops);
  };

  // Mengirim semua operasi antrean ke server satu per satu, berurutan. Kalau
  // ada yang gagal, berhenti dan dicoba lagi otomatis (tiap 15 detik, saat
  // internet kembali, atau saat aplikasi dibuka lagi).
  const flushOutbox = async () => {
    if (flushingRef.current) return;
    if (outboxRef.current.length === 0) return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
    flushingRef.current = true;
    setSyncing(true);
    try {
      while (outboxRef.current.length > 0) {
        const op = outboxRef.current[0];
        inflightIdRef.current = op.id;
        const res = await sendOp(op);
        inflightIdRef.current = null;
        if (!res.ok) {
          setOutboxError(res.error || 'gagal mengirim');
          break;
        }
        opsDoneRef.current += 1;
        setOutboxError(null);
        commitOutbox(outboxRef.current.filter((o) => o.id !== op.id));
      }
    } finally {
      inflightIdRef.current = null;
      flushingRef.current = false;
      setSyncing(false);
    }
  };
  flushOutboxRef.current = flushOutbox;

  // Memasukkan perubahan ke antrean lalu langsung mencoba mengirim
  const queueWrite = (op: { action: 'append' | 'upsert' | 'delete', collection: 'visits' | 'attendance', itemId: string, item?: any }) => {
    commitOutbox(enqueueOp(outboxRef.current, op, inflightIdRef.current));
    flushOutboxRef.current();
  };

  // Penyegaran data dari server: kunjungan & absensi (digabung dengan perubahan
  // yang masih mengantre, jadi tidak pernah menimpa data yang belum terkirim)
  // serta pengaturan Admin (jadwal absen, target, jenis usaha).
  const refreshData = async (force = false) => {
    if (!GAS_API_URL) return; // mode lokal: tidak ada server bersama untuk disinkronkan
    if (refreshingRef.current) return;
    if (!force && Date.now() - lastRefreshRef.current < 15000) return;
    refreshingRef.current = true;
    const startedAt = Date.now();
    const doneAtStart = opsDoneRef.current;
    const res = await db.fetchFresh(['settings', 'targets', 'businessTypes', 'attendance', 'visits']);
    refreshingRef.current = false;
    lastRefreshRef.current = Date.now();
    if (!res.ok) return;
    setLastSynced(new Date());
    const data = res.data;

    // Dilewati kalau antrean sedang/baru saja mengirim (data server bisa belum
    // memuat kiriman itu); diterapkan pada penyegaran berikutnya.
    if (!flushingRef.current && opsDoneRef.current === doneAtStart) {
      if (Array.isArray(data.attendance)) {
        const next = sortAttendanceDesc(applyOutbox(data.attendance as Attendance[], outboxRef.current, 'attendance'));
        setAttendance((prev) => (sameList(prev, next) ? prev : next));
        setAttendanceLoaded(true);
      }
      if (Array.isArray(data.visits)) {
        const next = sortVisitsDesc(applyOutbox(data.visits as Visit[], outboxRef.current, 'visits'));
        setVisits((prev) => (sameList(prev, next) ? prev : next));
      }
    }

    // Pengaturan: jangan timpa kalau ada penyimpanan lokal yang sedang/baru berjalan
    if (pendingWritesRef.current > 0 || lastLocalWriteRef.current >= startedAt) return;
    if (data.settings && data.settings.length > 0) {
      const next = sanitizeAttendanceSettings(data.settings[0]);
      setAttendanceSettings((prev) => (settingsEqual(prev, next) ? prev : next));
    }
    if (Array.isArray(data.targets)) {
      const next = data.targets as Target[];
      setTargets((prev) => (targetsEqual(prev, next) ? prev : next));
    }
    if (Array.isArray(data.businessTypes)) {
      const names = data.businessTypes.map((t: any) => t.name).filter(Boolean);
      if (names.length > 0) setBusinessTypes((prev) => (prev.join('|') === names.join('|') ? prev : names));
    }
  };
  refreshDataRef.current = refreshData;

  const handleUsersUpdate = (newUsers: User[]) => {
    setUsers(newUsers);
    syncToDB('users', newUsers);
  };

  const handleUpdateAttendanceSettings = async (newSettings: AttendanceSettings): Promise<SaveStatus> => {
    const clean = sanitizeAttendanceSettings(newSettings);
    setAttendanceSettings(clean); // langsung aktif di akun ini
    const result = await syncToDB('settings', [clean]);
    if (!result.ok) {
      return { status: 'error', message: 'Gagal menyimpan ke server. Pengaturan baru hanya aktif di perangkat ini. Periksa koneksi lalu simpan lagi.' };
    }
    // Pastikan benar-benar tersimpan: ambil ulang dari server & bandingkan
    const fresh = await db.fetchFresh(['settings']);
    if (!fresh.ok) {
      return { status: 'warn', message: 'Terkirim, tetapi belum bisa dipastikan tersimpan di server (koneksi bermasalah). Coba buka ulang halaman ini untuk memeriksa.' };
    }
    const rows = fresh.data.settings || [];
    if (rows.length === 0 || !settingsEqual(clean, sanitizeAttendanceSettings(rows[0]))) {
      return { status: 'warn', message: 'Terkirim ke server, tetapi isi yang tersimpan di Google Sheets berbeda dari yang Anda isi. Pastikan Code.gs versi terbaru sudah di-deploy (Deploy > Manage deployments > New version).' };
    }
    showNotice('success', 'Pengaturan absensi tersimpan & langsung aktif.');
    return { status: 'ok', message: 'Tersimpan di server dan langsung aktif. Akun lain menerimanya otomatis (paling lama sekitar 1 menit, atau seketika saat aplikasinya dibuka).' };
  };

  const handleUpdateTargets = async (newTargets: Target[]): Promise<SaveStatus> => {
    setTargets(newTargets); // langsung aktif di akun ini
    const result = await syncToDB('targets', newTargets);
    if (!result.ok) {
      return { status: 'error', message: 'Gagal menyimpan target ke server. Perubahan hanya aktif di perangkat ini. Periksa koneksi lalu coba lagi.' };
    }
    const fresh = await db.fetchFresh(['targets']);
    if (!fresh.ok) {
      return { status: 'warn', message: 'Target terkirim, tetapi belum bisa dipastikan tersimpan di server (koneksi bermasalah).' };
    }
    if (!targetsEqual(newTargets, (fresh.data.targets || []) as Target[])) {
      return { status: 'warn', message: 'Target terkirim, tetapi isi yang tersimpan di Google Sheets berbeda. Pastikan Code.gs versi terbaru sudah di-deploy (Deploy > Manage deployments > New version).' };
    }
    showNotice('success', 'Target tersimpan & langsung aktif di semua akun.');
    return { status: 'ok', message: 'Target tersimpan di server dan langsung aktif. Akun karyawan menerimanya otomatis (paling lama sekitar 1 menit, atau saat aplikasinya dibuka).' };
  };

  const handleUpdateBusinessTypes = (newTypes: string[]) => {
    setBusinessTypes(newTypes);
    syncToDB('businessTypes', newTypes.map(name => ({ name })));
  };

  const addAuditLog = (action: string, detail: string) => {
    const log = { time: new Date().toISOString(), action, detail, admin: user?.name };
    setAuditLogs(prev => [log, ...prev]);
    console.log("[AUDIT LOG]", log);
  };

  const handleLogin = (loggedInUser: User) => {
    setUser(loggedInUser);
    localStorage.setItem('esgaruda_session', JSON.stringify({ id: loggedInUser.id, loginAt: Date.now() }));
    // Hanya baris pengguna ini yang diperbarui. Sebelumnya SELURUH daftar pengguna
    // ditimpa dari data di HP ini - kalau HP itu belum memuat pegawai baru yang
    // ditambah Admin, pegawai baru tersebut ikut terhapus dari spreadsheet.
    const stamped = { ...loggedInUser, lastLogin: new Date().toLocaleString('id-ID') };
    const updatedUsers = users.map(u => u.id === loggedInUser.id ? stamped : u);
    setUsers(updatedUsers);
    db.upsert('users', updatedUsers, stamped);
  };

  const handleLogout = () => {
    setUser(null);
    setCurrentTab('home');
    setAdminTab('dashboard');
    localStorage.removeItem('esgaruda_session');
  };

  const confirmLogout = () => {
    if (window.confirm('Yakin ingin logout dari aplikasi?')) {
      handleLogout();
    }
  };

  // Kalau Admin menonaktifkan akun ini dari perangkat lain, paksa logout
  // begitu data pegawai tersinkron ulang - jangan biarkan sesi lama tetap jalan.
  useEffect(() => {
    if (user) {
      const stillActive = users.find(u => u.id === user.id);
      if (stillActive && stillActive.status === 'Nonaktif') {
        alert('Akun Anda telah dinonaktifkan oleh Admin. Anda akan keluar dari aplikasi.');
        handleLogout();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [users]);

  // Cek berkala kalau-kalau sesi sudah kedaluwarsa saat aplikasi tetap terbuka lama
  useEffect(() => {
    const interval = setInterval(() => {
      try {
        const savedSessionRaw = localStorage.getItem('esgaruda_session');
        if (user && savedSessionRaw) {
          const savedSession = JSON.parse(savedSessionRaw);
          const isExpired = Date.now() - savedSession.loginAt > SESSION_TIMEOUT_HOURS * 60 * 60 * 1000;
          if (isExpired) {
            alert('Sesi Anda telah berakhir. Silakan login kembali.');
            handleLogout();
          }
        }
      } catch {
        // abaikan
      }
    }, 5 * 60 * 1000); // cek tiap 5 menit
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const handleAddVisit = (newVisit: Visit) => {
    const updatedVisits = [newVisit, ...visits];
    setVisits(updatedVisits);
    persistList('visits', updatedVisits);
    queueWrite({ action: 'append', collection: 'visits', itemId: newVisit.id, item: newVisit });
    setCurrentTab('home');
  };

  // Pegawai bisa mengubah data kunjungan yang sudah tersimpan (termasuk
  // status, jenis usaha, foto, no HP) lewat menu Riwayat.
  const handleEditVisit = (visitId: string, updates: Partial<Visit>) => {
    const existing = visits.find(v => v.id === visitId);
    if (!existing) return;
    const merged = { ...existing, ...updates };
    const updatedVisits = visits.map(v => v.id === visitId ? merged : v);
    setVisits(updatedVisits);
    persistList('visits', updatedVisits);
    queueWrite({ action: 'upsert', collection: 'visits', itemId: visitId, item: merged });
  };

  const handleDeleteVisit = (visitId: string) => {
    const updatedVisits = visits.filter(v => v.id !== visitId);
    setVisits(updatedVisits);
    persistList('visits', updatedVisits);
    queueWrite({ action: 'delete', collection: 'visits', itemId: visitId });
  };

  const todayStr = localDateStr();
  const attendanceToday = user ? pickDailyRecord(attendance, user.id, todayStr) : null;
  const attendancePending = !!user && outbox.some(o => o.collection === 'attendance' && o.action !== 'delete' && o.item && o.item.pegawaiId === user.id && o.item.date === todayStr);

  const handleCheckIn = () => {
    if (!user) return;
    if (!('geolocation' in navigator)) { alert('Browser tidak mendukung GPS.'); return; }

    if (attendanceSettings.isActive) {
      const now = new Date();
      const todayName = DAY_NAMES_ID[now.getDay()];
      if (!attendanceSettings.activeDays.includes(todayName)) {
        alert(`Hari ini (${todayName}) bukan hari kerja aktif untuk absensi.`);
        return;
      }
      const nowMinutes = now.getHours() * 60 + now.getMinutes();
      const startMinutes = timeToMinutes(attendanceSettings.checkInStart);
      const endMinutes = timeToMinutes(attendanceSettings.checkInEnd);
      if (nowMinutes < startMinutes) {
        alert(`Waktu absensi masuk belum dibuka. Absen masuk dibuka mulai pukul ${attendanceSettings.checkInStart}.`);
        return;
      }
      if (nowMinutes > endMinutes) {
        alert(`Waktu absensi masuk sudah ditutup (batas ${attendanceSettings.checkInEnd}). Hubungi Admin kalau ada kendala.`);
        return;
      }
    }

    setAttendanceLoading(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        // Pastikan belum tercatat (mis. sudah absen dari HP lain, atau data di HP
        // ini belum diperbarui) supaya tidak terjadi absen ganda.
        const fresh = await db.fetchFresh(['attendance']);
        if (fresh.ok) {
          const serverList = (fresh.data.attendance || []) as Attendance[];
          const existing = pickDailyRecord(serverList, user.id, localDateStr());
          if (existing) {
            setAttendance(sortAttendanceDesc(applyOutbox(serverList, outboxRef.current, 'attendance')));
            setAttendanceLoading(false);
            alert(`Anda sudah absen masuk hari ini pukul ${existing.checkInTime}.`);
            return;
          }
        }

        const now = new Date();
        const timeStr = formatHHmm(now);
        let status: Attendance['status'] = 'Tepat Waktu';
        if (attendanceSettings.isActive) {
          const nowMinutes = now.getHours() * 60 + now.getMinutes();
          const startMinutes = timeToMinutes(attendanceSettings.checkInStart);
          status = nowMinutes > startMinutes + attendanceSettings.toleranceMinutes ? 'Terlambat' : 'Tepat Waktu';
        }
        const newAtt: Attendance = {
          id: Date.now().toString(),
          pegawaiId: user.id,
          date: localDateStr(now),
          checkInTime: timeStr,
          checkInLat: pos.coords.latitude,
          checkInLng: pos.coords.longitude,
          status,
        };
        setAttendance((prev) => {
          const next = [newAtt, ...prev];
          persistList('attendance', next);
          return next;
        });
        queueWrite({ action: 'append', collection: 'attendance', itemId: newAtt.id, item: newAtt });
        setAttendanceLoading(false);
      },
      () => { alert('Gagal mengambil lokasi GPS. Pastikan GPS aktif.'); setAttendanceLoading(false); },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  const handleCheckOut = () => {
    if (!user || !attendanceToday) return;
    if (!('geolocation' in navigator)) { alert('Browser tidak mendukung GPS.'); return; }

    if (attendanceSettings.isActive) {
      const now = new Date();
      const nowMinutes = now.getHours() * 60 + now.getMinutes();
      const startMinutes = timeToMinutes(attendanceSettings.checkOutStart);
      const endMinutes = timeToMinutes(attendanceSettings.checkOutEnd);
      if (nowMinutes < startMinutes) {
        alert(`Waktu absensi pulang belum dibuka. Absen pulang dibuka mulai pukul ${attendanceSettings.checkOutStart}.`);
        return;
      }
      if (nowMinutes > endMinutes) {
        alert(`Waktu absensi pulang sudah ditutup (batas ${attendanceSettings.checkOutEnd}). Hubungi Admin kalau ada kendala.`);
        return;
      }
    }

    setAttendanceLoading(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const timeStr = formatHHmm();
        const updatedRecord = { ...attendanceToday, checkOutTime: timeStr, checkOutLat: pos.coords.latitude, checkOutLng: pos.coords.longitude };
        setAttendance((prev) => {
          const next = prev.map(a => a.id === attendanceToday.id ? updatedRecord : a);
          persistList('attendance', next);
          return next;
        });
        queueWrite({ action: 'upsert', collection: 'attendance', itemId: attendanceToday.id, item: updatedRecord });
        setAttendanceLoading(false);
      },
      () => { alert('Gagal mengambil lokasi GPS. Pastikan GPS aktif.'); setAttendanceLoading(false); },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  // Setelah login: segarkan pengaturan dari server, lalu ulangi saat aplikasi
  // kembali dibuka/difokuskan dan setiap 1 menit selama layar aktif. Dengan
  // begitu perubahan jadwal absen/target dari Admin langsung berlaku di semua akun.
  useEffect(() => {
    if (!user) return;
    flushOutboxRef.current();
    refreshDataRef.current(true);
    const onVisible = () => {
      if (document.visibilityState === 'visible') { flushOutboxRef.current(); refreshDataRef.current(); }
    };
    const onFocus = () => { flushOutboxRef.current(); refreshDataRef.current(); };
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') refreshDataRef.current(true);
    }, 45000);
    const retry = setInterval(() => flushOutboxRef.current(), 15000);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onFocus);
    return () => {
      clearInterval(interval);
      clearInterval(retry);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onFocus);
    };
  }, [user?.id]);

  if (!initialized) return <div className="min-h-screen flex items-center justify-center bg-slate-50 font-bold text-slate-500">Memuat Sistem...</div>;

  if (!user) {
    return <LoginScreen onLogin={handleLogin} users={users} />;
  }

  if (user.role === 'admin' || user.role === 'owner') {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col md:flex-row">
        {syncError && (
          <div className="fixed bottom-20 md:bottom-4 left-1/2 -translate-x-1/2 z-[999] bg-red-600 text-white text-xs font-medium px-4 py-2 rounded-full shadow-lg max-w-[90%] text-center">
            {syncError}
          </div>
        )}
        {notice && !syncError && (
          <div className={`fixed bottom-20 md:bottom-4 left-1/2 -translate-x-1/2 z-[999] ${notice.type === 'success' ? 'bg-emerald-600' : 'bg-amber-500'} text-white text-xs font-medium px-4 py-2 rounded-full shadow-lg max-w-[90%] text-center`}>
            {notice.text}
          </div>
        )}
        <aside className="bg-blue-700 text-white w-full md:w-64 flex-shrink-0 flex flex-col">
          <div className="p-6 flex items-center justify-between md:justify-center border-b border-blue-600">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-white rounded-lg flex items-center justify-center text-blue-700"><LogoIcon size={20} /></div>
              <span className="font-bold text-lg hidden md:block">Pusat Canvasing</span>
            </div>
            <button onClick={confirmLogout} className="md:hidden p-2 text-red-200 hover:text-white"><LogOut size={20} /></button>
          </div>
          <nav className="p-4 flex-1 hidden md:flex flex-col gap-2">
            <button onClick={() => setAdminTab('dashboard')} className={`flex items-center gap-3 w-full p-3 rounded-xl transition-colors text-left ${adminTab === 'dashboard' ? 'bg-blue-600 text-white shadow-md' : 'hover:bg-blue-600/50 text-blue-100'}`}><BarChart3 size={20} /> Dashboard Kunjungan</button>
            <button onClick={() => setAdminTab('canvasing')} className={`flex items-center gap-3 w-full p-3 rounded-xl transition-colors text-left ${adminTab === 'canvasing' ? 'bg-blue-600 text-white shadow-md' : 'hover:bg-blue-600/50 text-blue-100'}`}><PlusCircle size={20} /> Canvasing</button>
            <button onClick={() => setAdminTab('map')} className={`flex items-center gap-3 w-full p-3 rounded-xl transition-colors text-left ${adminTab === 'map' ? 'bg-blue-600 text-white shadow-md' : 'hover:bg-blue-600/50 text-blue-100'}`}><Map size={20} /> Peta Wilayah GPS</button>
            <button onClick={() => setAdminTab('customers')} className={`flex items-center gap-3 w-full p-3 rounded-xl transition-colors text-left ${adminTab === 'customers' ? 'bg-blue-600 text-white shadow-md' : 'hover:bg-blue-600/50 text-blue-100'}`}><Database size={20} /> Data Customer</button>
            <button onClick={() => setAdminTab('attendance')} className={`flex items-center gap-3 w-full p-3 rounded-xl transition-colors text-left ${adminTab === 'attendance' ? 'bg-blue-600 text-white shadow-md' : 'hover:bg-blue-600/50 text-blue-100'}`}><Clock size={20} /> Absensi Karyawan</button>
            <button onClick={() => setAdminTab('reports')} className={`flex items-center gap-3 w-full p-3 rounded-xl transition-colors text-left ${adminTab === 'reports' ? 'bg-blue-600 text-white shadow-md' : 'hover:bg-blue-600/50 text-blue-100'}`}><FileText size={20} /> Laporan Bulanan</button>
            <button onClick={() => setAdminTab('employees')} className={`flex items-center gap-3 w-full p-3 rounded-xl transition-colors text-left ${adminTab === 'employees' ? 'bg-blue-600 text-white shadow-md' : 'hover:bg-blue-600/50 text-blue-100'}`}><Users size={20} /> Kelola Akun Pegawai</button>
          </nav>
          <div className="p-4 hidden md:block border-t border-blue-600">
            {syncing && <div className="text-xs text-blue-200 mb-2 flex items-center gap-1 justify-center"><RefreshCw size={12} className="animate-spin" /> Sinkronisasi Database...</div>}
            {!isOnline && <div className="text-xs text-yellow-200 mb-2 flex items-center gap-1 justify-center"><WifiOff size={12} /> Sedang Offline</div>}
            {outbox.length > 0 && <button onClick={() => flushOutboxRef.current()} className="text-xs text-amber-200 mb-2 w-full flex items-center gap-1 justify-center hover:text-white">{outbox.length} data menunggu terkirim (ketuk untuk kirim)</button>}
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-blue-500 flex items-center justify-center font-bold">{user.name.charAt(0)}</div>
              <div>
                <p className="text-sm font-bold truncate max-w-[120px]">{user.name}</p>
                <p className="text-xs text-blue-300 capitalize">{user.role}</p>
              </div>
            </div>
            <Button variant="danger" onClick={confirmLogout} className="w-full py-2 bg-red-600 hover:bg-red-700 text-white shadow-none border border-red-500"><LogOut size={16} /> Logout</Button>
          </div>
        </aside>

        <main className="flex-1 overflow-y-auto pb-20 md:pb-0">
          <Suspense fallback={<AdminSectionLoading />}>
            {adminTab === 'dashboard' && <AdminDashboard visits={visits} users={users} attendance={attendance} onRefresh={() => refreshDataRef.current(true)} lastSynced={lastSynced} />}
            {adminTab === 'map' && <AdminMap visits={visits} users={users} />}
            {adminTab === 'reports' && <AdminReports visits={visits} users={users} targets={targets} />}
          </Suspense>
          {adminTab === 'attendance' && <AdminAttendance attendance={attendance} users={users} attendanceSettings={attendanceSettings} onUpdateSettings={handleUpdateAttendanceSettings} onRefresh={() => refreshDataRef.current(true)} lastSynced={lastSynced} />}
          {adminTab === 'employees' && <AdminEmployees users={users} setUsers={handleUsersUpdate} addAuditLog={addAuditLog} targets={targets} onUpdateTargets={handleUpdateTargets} businessTypes={businessTypes} onUpdateBusinessTypes={handleUpdateBusinessTypes} />}
          {adminTab === 'customers' && <CustomerDatabase visits={visits} users={users} isAdmin={true} />}
          {adminTab === 'canvasing' && <AdminCanvasing user={user} users={users} businessTypes={businessTypes} visits={visits} targets={targets} onAddVisit={handleAddVisit} onEditVisit={handleEditVisit} onDeleteVisit={handleDeleteVisit} onUpdateTargets={handleUpdateTargets} />}
        </main>

        {/* Menu mobile - sebelumnya menu ini tidak ada sama sekali di layar kecil/PWA */}
        <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 flex justify-around p-1.5 pb-safe z-20 overflow-x-auto">
          <button onClick={() => setAdminTab('dashboard')} className={`flex flex-col items-center gap-1 p-1.5 flex-1 min-w-[48px] transition-colors ${adminTab === 'dashboard' ? 'text-blue-600' : 'text-slate-400'}`}>
            <BarChart3 size={20} />
            <span className="text-[9px] font-medium">Dashboard</span>
          </button>
          <button onClick={() => setAdminTab('canvasing')} className={`flex flex-col items-center gap-1 p-1.5 flex-1 min-w-[48px] transition-colors ${adminTab === 'canvasing' ? 'text-blue-600' : 'text-slate-400'}`}>
            <PlusCircle size={20} />
            <span className="text-[9px] font-medium">Canvasing</span>
          </button>
          <button onClick={() => setAdminTab('map')} className={`flex flex-col items-center gap-1 p-1.5 flex-1 min-w-[48px] transition-colors ${adminTab === 'map' ? 'text-blue-600' : 'text-slate-400'}`}>
            <Map size={20} />
            <span className="text-[9px] font-medium">Peta</span>
          </button>
          <button onClick={() => setAdminTab('customers')} className={`flex flex-col items-center gap-1 p-1.5 flex-1 min-w-[48px] transition-colors ${adminTab === 'customers' ? 'text-blue-600' : 'text-slate-400'}`}>
            <Database size={20} />
            <span className="text-[9px] font-medium">Customer</span>
          </button>
          <button onClick={() => setAdminTab('attendance')} className={`flex flex-col items-center gap-1 p-1.5 flex-1 min-w-[48px] transition-colors ${adminTab === 'attendance' ? 'text-blue-600' : 'text-slate-400'}`}>
            <Clock size={20} />
            <span className="text-[9px] font-medium">Absensi</span>
          </button>
          <button onClick={() => setAdminTab('reports')} className={`flex flex-col items-center gap-1 p-1.5 flex-1 min-w-[48px] transition-colors ${adminTab === 'reports' ? 'text-blue-600' : 'text-slate-400'}`}>
            <FileText size={20} />
            <span className="text-[9px] font-medium">Laporan</span>
          </button>
          <button onClick={() => setAdminTab('employees')} className={`flex flex-col items-center gap-1 p-1.5 flex-1 min-w-[48px] transition-colors ${adminTab === 'employees' ? 'text-blue-600' : 'text-slate-400'}`}>
            <Users size={20} />
            <span className="text-[9px] font-medium">Pegawai</span>
          </button>
        </nav>
      </div>
    );
  }

  // Pegawai View (Mobile First)
  return (
    <div className="min-h-screen bg-slate-50 flex justify-center">
      <div className="w-full max-w-md bg-slate-50 relative min-h-screen flex flex-col shadow-2xl">
        {syncError && (
          <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-[999] bg-red-600 text-white text-xs font-medium px-4 py-2 rounded-full shadow-lg max-w-[90%] text-center">
            {syncError}
          </div>
        )}

        <header className="bg-white px-4 py-3 flex items-center justify-between shadow-sm z-10 sticky top-0">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center text-white"><LogoIcon size={20} /></div>
            <span className="font-bold text-slate-800 text-sm">Canvasing Garuda</span>
          </div>
          <div className="flex items-center gap-3">
            {syncing && <RefreshCw size={16} className="text-slate-400 animate-spin" />}
            {!isOnline && <WifiOff size={16} className="text-yellow-500" />}
            {outbox.length > 0 && (
              <button onClick={() => flushOutboxRef.current()} title={outboxError || 'Ketuk untuk mengirim sekarang'} className="text-[10px] font-bold text-amber-700 bg-amber-50 border border-amber-200 px-2 py-1 rounded-full">
                {outbox.length} menunggu kirim
              </button>
            )}
            <button onClick={confirmLogout} className="p-2 text-red-500 hover:text-red-600 hover:bg-red-50 transition-colors rounded-full">
              <LogOut size={20} />
            </button>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto bg-slate-50">
          {currentTab === 'home' && (
            <PegawaiDashboard
              user={user} visits={visits}
              attendanceToday={attendanceToday}
              onCheckIn={handleCheckIn}
              onCheckOut={handleCheckOut}
              attendanceLoading={attendanceLoading}
              attendanceSettings={attendanceSettings}
              targets={targets}
              attendanceLoaded={attendanceLoaded}
              attendancePending={attendancePending}
            />
          )}
          {currentTab === 'canvassing' && <CanvassingForm user={user} onSubmit={handleAddVisit} businessTypes={businessTypes} />}
          {currentTab === 'history' && (
            <PegawaiHistory user={user} visits={visits} businessTypes={businessTypes} onEditVisit={handleEditVisit} onDeleteVisit={handleDeleteVisit} />
          )}
          {currentTab === 'customers' && (
            <CustomerDatabase visits={visits.filter(v => v.pegawaiId === user.id)} users={users} isAdmin={false} />
          )}
          {currentTab === 'map' && (
            <Suspense fallback={<AdminSectionLoading />}>
              <AdminMap visits={visits} users={users} restrictCabang={user.cabang} />
            </Suspense>
          )}
        </main>

        <nav className="fixed bottom-0 w-full max-w-md bg-white border-t border-slate-200 flex items-center p-2 pb-safe z-20">
          <div className="flex-1 flex justify-around">
            <button
              onClick={() => setCurrentTab('home')}
              className={`flex flex-col items-center gap-1 p-2 w-16 transition-colors ${currentTab === 'home' ? 'text-blue-600' : 'text-slate-400 hover:text-slate-600'}`}
            >
              <Home size={24} className={currentTab === 'home' ? 'fill-blue-100' : ''} />
              <span className="text-[10px] font-medium">Dashboard</span>
            </button>
            <button
              onClick={() => setCurrentTab('history')}
              className={`flex flex-col items-center gap-1 p-2 w-16 transition-colors ${currentTab === 'history' ? 'text-blue-600' : 'text-slate-400 hover:text-slate-600'}`}
            >
              <History size={24} className={currentTab === 'history' ? 'fill-blue-100' : ''} />
              <span className="text-[10px] font-medium">Riwayat</span>
            </button>
          </div>

          <button
            onClick={() => setCurrentTab('canvassing')}
            className="relative -top-6 flex flex-col items-center justify-center w-16 h-16 flex-shrink-0 bg-blue-600 text-white rounded-full shadow-lg shadow-blue-300 border-4 border-slate-50 hover:bg-blue-700 transition-transform active:scale-95"
          >
            <PlusCircle size={32} />
          </button>

          <div className="flex-1 flex justify-around">
            <button
              onClick={() => setCurrentTab('map')}
              className={`flex flex-col items-center gap-1 p-2 w-16 transition-colors ${currentTab === 'map' ? 'text-blue-600' : 'text-slate-400 hover:text-slate-600'}`}
            >
              <Map size={24} className={currentTab === 'map' ? 'fill-blue-100' : ''} />
              <span className="text-[10px] font-medium">Peta</span>
            </button>
            <button
              onClick={() => setCurrentTab('customers')}
              className={`flex flex-col items-center gap-1 p-2 w-16 transition-colors ${currentTab === 'customers' ? 'text-blue-600' : 'text-slate-400 hover:text-slate-600'}`}
            >
              <Database size={24} className={currentTab === 'customers' ? 'fill-blue-100' : ''} />
              <span className="text-[10px] font-medium">Customer</span>
            </button>
          </div>
        </nav>
      </div>
    </div>
  );
}
