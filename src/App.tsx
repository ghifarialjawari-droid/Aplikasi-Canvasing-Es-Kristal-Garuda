import React, { useState, useEffect, useRef, lazy, Suspense } from 'react';
import {
  MapPin, Camera, CheckCircle, LogOut, Users,
  BarChart3, Home, PlusCircle, History, TrendingUp,
  Map, UserPlus, FileText, AlertCircle,
  Edit, Trash2, Key, Shield, Info, X, Power, PowerOff, RefreshCw, Store,
  Clock, ExternalLink, Download, Image as ImageIcon, LogIn, WifiOff, Target as TargetIcon
} from 'lucide-react';

// AdminDashboard (pakai recharts) dan AdminMap (pakai leaflet) sengaja
// dimuat "lazy" - hanya di-download saat Admin benar-benar membuka halaman
// itu. Pegawai (yang jumlahnya lebih banyak & sering buka dari HP) jadi
// tidak perlu mengunduh kedua library berat ini sama sekali.
const AdminDashboard = lazy(() => import('./admin/AdminDashboard'));
const AdminMap = lazy(() => import('./admin/AdminMap'));
const AdminTargets = lazy(() => import('./admin/AdminTargets'));

// ==========================================
// KONFIGURASI API GOOGLE APPS SCRIPT
// ==========================================
// Ganti string kosong di bawah dengan URL Web App Google Apps Script Anda saat siap integrasi.
// Selama kosong, aplikasi berjalan di mode Sandbox (menggunakan LocalStorage)
const GAS_API_URL = "https://script.google.com/macros/s/AKfycbw1WM795b0RuqMkb81m4GxBYsImwrfn9zwJYCq_scJp7e1rhIoZTZAkybXSwWiz9W7a/exec";

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
  status: string; // Prospek, Closing, Follow Up, Menolak
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

const DAY_NAMES_ID = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];

function timeToMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
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

const FETCH_TIMEOUT_MS = 10000;
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

const db = {
  async get(collection: string) {
    if (GAS_API_URL) {
      try {
        const res = await fetchWithRetry(`${GAS_API_URL}?action=get&collection=${collection}`);
        return await res.json();
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
  async save(collection: string, data: any) {
    // Simpan salinan cadangan di HP ini juga, supaya data tidak hilang
    // kalau koneksi ke server terputus saat menyimpan.
    localStorage.setItem(`esgaruda_cache_${collection}`, JSON.stringify(data));

    if (GAS_API_URL) {
      try {
        await fetchWithRetry(GAS_API_URL, {
          method: 'POST',
          body: JSON.stringify({ action: 'save', collection, data }),
        });
      } catch (err) {
        console.error('API Error (save):', err);
      }
    } else {
      localStorage.setItem(`esgaruda_${collection}`, JSON.stringify(data));
    }
  }
};

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
  user, visits, attendanceToday, onCheckIn, onCheckOut, attendanceLoading, attendanceSettings
}: {
  user: User, visits: Visit[], attendanceToday: Attendance | null,
  onCheckIn: () => void, onCheckOut: () => void, attendanceLoading: boolean, attendanceSettings: AttendanceSettings
}) => {
  const myVisits = visits.filter(v => v.pegawaiId === user.id);
  const todayDate = new Date().toISOString().split('T')[0];
  const visitsToday = myVisits.filter(v => v.date === todayDate).length;
  const newCustomers = myVisits.filter(v => v.isNewCustomer).length;
  const targetVisits = user.target.visits || 1;
  const targetNew = user.target.newCustomers || 1;

  const progressVisits = Math.min(100, Math.round((myVisits.length / targetVisits) * 100));
  const progressNew = Math.min(100, Math.round((newCustomers / targetNew) * 100));

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
            <span className="font-bold">{myVisits.length} / {targetVisits}</span>
          </div>
          <div className="h-2 bg-black/20 rounded-full overflow-hidden mb-4">
            <div className="h-full bg-emerald-400 rounded-full transition-all duration-1000" style={{ width: `${progressVisits}%` }}></div>
          </div>

          <div className="flex justify-between text-sm mb-2">
            <span>Target Toko Baru</span>
            <span className="font-bold">{newCustomers} / {targetNew}</span>
          </div>
          <div className="h-2 bg-black/20 rounded-full overflow-hidden">
            <div className="h-full bg-yellow-400 rounded-full transition-all duration-1000" style={{ width: `${progressNew}%` }}></div>
          </div>
        </div>
      </div>

      <Card className="p-4">
        <h3 className="font-bold text-slate-800 mb-3 flex items-center gap-2"><Clock size={18} className="text-blue-600" /> Absensi Hari Ini</h3>
        {scheduleHint && (
          <div className="flex items-center gap-2 text-xs font-medium text-slate-500 bg-slate-50 border border-slate-100 p-2.5 rounded-lg mb-3">
            <Info size={14} className="flex-shrink-0" /> {scheduleHint}
          </div>
        )}
        {!attendanceToday ? (
          <Button variant="primary" onClick={onCheckIn} disabled={attendanceLoading}>
            <LogIn size={18} /> {attendanceLoading ? 'Mengambil Lokasi GPS...' : 'Absen Masuk'}
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

const CanvassingForm = ({ user, onSubmit }: { user: User, onSubmit: (v: any) => void }) => {
  const [formData, setFormData] = useState({
    shopName: '', owner: '', phone: '', businessType: '', status: '', result: '', nextFollowUp: ''
  });
  const [isNewCustomer, setIsNewCustomer] = useState(false);
  const [location, setLocation] = useState<{ lat: number, lng: number } | null>(null);
  const [locating, setLocating] = useState(false);
  const [locError, setLocError] = useState('');
  const [photo, setPhoto] = useState<string | null>(null);
  const [photoError, setPhotoError] = useState('');
  const [submitting, setSubmitting] = useState(false);

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
    const reader = new FileReader();
    reader.onload = () => setPhoto(reader.result as string);
    reader.onerror = () => setPhotoError('Gagal memuat foto, coba ambil ulang.');
    reader.readAsDataURL(file);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!location) {
      alert("Lokasi GPS WAJIB diambil sebelum submit form!");
      return;
    }
    if (!photo) {
      alert("Foto depan toko WAJIB diambil sebelum submit form!");
      return;
    }
    setSubmitting(true);
    const newVisit: Visit = {
      id: Date.now().toString(),
      date: new Date().toISOString().split('T')[0],
      time: new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }),
      ...formData,
      isNewCustomer,
      lat: location.lat,
      lng: location.lng,
      cabang: user.cabang,
      area: user.area || '',
      pegawaiId: user.id,
      photo: photo,
    };
    onSubmit(newVisit);
    alert("Data Kunjungan Canvassing berhasil disimpan!");
    setSubmitting(false);
  };

  const businessTypes = ['Warung', 'Agen', 'Rumah Makan', 'Cafe', 'Pedagang Minuman', 'Catering', 'Lainnya'];
  const statuses = ['Prospek', 'Follow Up', 'Closing', 'Menolak', 'Sudah Pakai Es', 'Belum Pakai Es', 'Tidak Beroperasi'];

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
          <Input label="Nama Pemilik" value={formData.owner} onChange={(e: any) => setFormData({ ...formData, owner: e.target.value })} placeholder="Cth: Bpk. Joko" />
          <Input label="Nomor WhatsApp/HP" type="tel" value={formData.phone} onChange={(e: any) => setFormData({ ...formData, phone: e.target.value })} placeholder="08..." />
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
            <label className="block text-sm font-medium text-slate-600 mb-1.5">Foto Depan Toko (Wajib) <span className="text-red-500">*</span></label>
            {photo ? (
              <div className="relative">
                <img src={photo} alt="Preview toko" className="w-full h-40 object-cover rounded-xl border border-slate-200" />
                <button type="button" onClick={() => setPhoto(null)} className="absolute top-2 right-2 bg-white/90 p-1.5 rounded-full shadow text-red-500 hover:bg-white">
                  <X size={16} />
                </button>
              </div>
            ) : (
              <div className="border-2 border-dashed border-slate-300 bg-slate-50 rounded-xl p-6 text-center cursor-pointer hover:bg-slate-100 transition-colors relative">
                <input type="file" accept="image/*" capture="environment" onChange={handlePhotoChange} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" />
                <Camera size={32} className="mx-auto text-slate-400 mb-2" />
                <span className="text-sm font-medium text-slate-600">Buka Kamera / Upload</span>
              </div>
            )}
            {photoError && <p className="text-red-500 text-xs mt-1">{photoError}</p>}
          </div>
        </Card>

        <Card className="p-5">
          <h3 className="font-bold text-slate-800 mb-4 border-b pb-2">Status & Laporan Kunjungan</h3>
          <Select label="Status Kunjungan Hari Ini" options={statuses} required value={formData.status} onChange={(e: any) => setFormData({ ...formData, status: e.target.value })} />

          {formData.status === 'Follow Up' && (
            <div className="bg-yellow-50 p-4 rounded-xl mb-4 border border-yellow-100 animate-in fade-in zoom-in duration-300">
              <Input label="Tanggal Janji Follow Up" type="date" required value={formData.nextFollowUp} onChange={(e: any) => setFormData({ ...formData, nextFollowUp: e.target.value })} />
            </div>
          )}

          <div className="mb-4">
            <label className="block text-sm font-medium text-slate-600 mb-1.5">Catatan Laporan Kunjungan <span className="text-red-500">*</span></label>
            <textarea
              required
              rows={4}
              value={formData.result}
              onChange={(e) => setFormData({ ...formData, result: e.target.value })}
              placeholder="Ceritakan hasil kunjungan. Cth: Toko tertarik, namun masih ada sisa stok es lama. Minta dihubungi lagi hari rabu..."
              className="w-full bg-slate-50 border border-slate-200 text-slate-800 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all resize-none"
            ></textarea>
          </div>
        </Card>

        <Button type="submit" variant="primary" disabled={submitting} className="py-4 text-lg mt-6 shadow-xl w-full sticky bottom-20 z-10">
          {submitting ? 'Menyimpan...' : 'Kirim Laporan Kunjungan'}
        </Button>
      </form>
    </div>
  );
};

const ALL_DAY_NAMES = ['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu', 'Minggu'];

const AttendanceScheduleForm = ({ settings, onSave }: { settings: AttendanceSettings, onSave: (s: AttendanceSettings) => void }) => {
  const [form, setForm] = useState<AttendanceSettings>(settings);
  const [saved, setSaved] = useState(false);

  const toggleDay = (day: string) => {
    setForm((prev) => ({
      ...prev,
      activeDays: prev.activeDays.includes(day)
        ? prev.activeDays.filter((d) => d !== day)
        : [...prev.activeDays, day],
    }));
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(form);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
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

      <Button type="submit" variant="primary">{saved ? 'Tersimpan ✓' : 'Simpan Pengaturan Jadwal'}</Button>
    </form>
  );
};

const AdminAttendance = ({
  attendance, users, attendanceSettings, onUpdateSettings
}: {
  attendance: Attendance[], users: User[], attendanceSettings: AttendanceSettings, onUpdateSettings: (s: AttendanceSettings) => void
}) => {
  const todayStr = new Date().toISOString().split('T')[0];
  const [innerTab, setInnerTab] = useState<'rekap' | 'jadwal'>('rekap');
  const [filterCabang, setFilterCabang] = useState('Semua');
  const [filterDate, setFilterDate] = useState(todayStr);

  const cabangList = ['Semua', ...Array.from(new Set(users.filter(u => u.role === 'pegawai').map(u => u.cabang)))];

  const activePegawai = users.filter(u => u.role === 'pegawai' && u.status === 'Aktif' && (filterCabang === 'Semua' || u.cabang === filterCabang));

  const dayRecords = attendance.filter(a => {
    if (a.date !== filterDate) return false;
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
      <div>
        <h1 className="text-2xl md:text-3xl font-bold text-slate-800">Absensi Karyawan</h1>
        <p className="text-slate-500">Rekap kehadiran pegawai lapangan berbasis GPS.</p>
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

const AdminEmployees = ({ users, setUsers, addAuditLog }: { users: User[], setUsers: any, addAuditLog: any }) => {
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
      setFormData({ ...user });
    } else if (type === 'reset') {
      setFormData({ password: '', confirm: '' });
    }
    setShowModal(type);
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (showModal === 'add') {
      if (users.find(u => u.id === formData.id)) return alert("ID Login sudah digunakan!");
      if (formData.password !== formData.confirm) return alert("Password tidak cocok!");

      const newUser: User = {
        ...formData,
        target: { visits: 100, newCustomers: 20 },
        lastLogin: '-'
      };
      setUsers([...users, newUser]);
      addAuditLog('Tambah Akun', `Menambahkan pegawai baru: ${newUser.name} (${newUser.id})`);
    } else if (showModal === 'edit' && selectedUser) {
      if (formData.id !== selectedUser.id && users.find(u => u.id === formData.id)) return alert("ID Login sudah digunakan user lain!");

      setUsers(users.map(u => u.id === selectedUser.id ? { ...u, ...formData } : u));
      addAuditLog('Edit Akun', `Mengubah profil/cabang pegawai: ${formData.name}`);
    } else if (showModal === 'reset' && selectedUser) {
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
                  <td className="p-4 text-slate-600 font-medium">{u.target?.visits || 0} Toko/Bulan</td>
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

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [visits, setVisits] = useState<Visit[]>([]);
  const [attendance, setAttendance] = useState<Attendance[]>([]);
  const [targets, setTargets] = useState<Target[]>([]);
  const [attendanceSettings, setAttendanceSettings] = useState<AttendanceSettings>(defaultAttendanceSettings);
  const [currentTab, setCurrentTab] = useState<'home' | 'canvassing' | 'history'>('home');
  const [adminTab, setAdminTab] = useState<'dashboard' | 'map' | 'employees' | 'attendance' | 'targets'>('dashboard');
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [initialized, setInitialized] = useState(false);
  const [attendanceLoading, setAttendanceLoading] = useState(false);
  const [isOnline, setIsOnline] = useState(true);

  // Pantau status koneksi supaya bisa tampil peringatan "Sedang Offline"
  // dan otomatis menyegarkan data begitu koneksi kembali (reconnect otomatis).
  useEffect(() => {
    setIsOnline(navigator.onLine);
    const goOnline = () => {
      setIsOnline(true);
      db.get('visits').then((v) => setVisits(v.length > 0 ? v : defaultVisits));
      db.get('attendance').then((a) => setAttendance(a || []));
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

    // Layar login cuma butuh data 'users', jadi begitu itu selesai,
    // langsung tampilkan layar login tanpa menunggu data lainnya.
    usersPromise.then((loadedUsers) => {
      const finalUsers = loadedUsers.length > 0 ? loadedUsers : defaultUsers;
      setUsers(finalUsers);
      setInitialized(true);

      // Auto-login: kalau ada sesi tersimpan dari login sebelumnya dan
      // akunnya masih aktif, langsung masuk tanpa perlu login ulang.
      const savedSessionId = localStorage.getItem('esgaruda_session');
      if (savedSessionId) {
        const savedUser = finalUsers.find((u: User) => u.id === savedSessionId && u.status !== 'Nonaktif');
        if (savedUser) setUser(savedUser);
        else localStorage.removeItem('esgaruda_session');
      }
    });
    visitsPromise.then((loadedVisits) => {
      setVisits(loadedVisits.length > 0 ? loadedVisits : defaultVisits);
    });
    attendancePromise.then((loadedAttendance) => {
      setAttendance(loadedAttendance || []);
    });
    settingsPromise.then((loadedSettings) => {
      setAttendanceSettings(loadedSettings && loadedSettings.length > 0 ? loadedSettings[0] : defaultAttendanceSettings);
    });
    targetsPromise.then((loadedTargets) => {
      setTargets(loadedTargets || []);
    });

    Promise.allSettled([usersPromise, visitsPromise, attendancePromise, settingsPromise, targetsPromise]).then(() => setSyncing(false));
  }, []);

  const syncToDB = async (collection: string, data: any) => {
    setSyncing(true);
    await db.save(collection, data);
    setSyncing(false);
  };

  const handleUsersUpdate = (newUsers: User[]) => {
    setUsers(newUsers);
    syncToDB('users', newUsers);
  };

  const handleUpdateAttendanceSettings = (newSettings: AttendanceSettings) => {
    setAttendanceSettings(newSettings);
    syncToDB('settings', [newSettings]);
  };

  const handleUpdateTargets = (newTargets: Target[]) => {
    setTargets(newTargets);
    syncToDB('targets', newTargets);
  };

  const addAuditLog = (action: string, detail: string) => {
    const log = { time: new Date().toISOString(), action, detail, admin: user?.name };
    setAuditLogs(prev => [log, ...prev]);
    console.log("[AUDIT LOG]", log);
  };

  const handleLogin = (loggedInUser: User) => {
    setUser(loggedInUser);
    localStorage.setItem('esgaruda_session', loggedInUser.id);
    const updatedUsers = users.map(u => u.id === loggedInUser.id ? { ...u, lastLogin: new Date().toLocaleString('id-ID') } : u);
    handleUsersUpdate(updatedUsers);
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

  const handleAddVisit = (newVisit: Visit) => {
    const updatedVisits = [newVisit, ...visits];
    setVisits(updatedVisits);
    syncToDB('visits', updatedVisits);
    setCurrentTab('home');
  };

  const todayStr = new Date().toISOString().split('T')[0];
  const attendanceToday = user ? attendance.find(a => a.pegawaiId === user.id && a.date === todayStr) || null : null;

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
      (pos) => {
        const now = new Date();
        const timeStr = now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
        let status: Attendance['status'] = 'Tepat Waktu';
        if (attendanceSettings.isActive) {
          const nowMinutes = now.getHours() * 60 + now.getMinutes();
          const startMinutes = timeToMinutes(attendanceSettings.checkInStart);
          status = nowMinutes > startMinutes + attendanceSettings.toleranceMinutes ? 'Terlambat' : 'Tepat Waktu';
        }
        const newAtt: Attendance = {
          id: Date.now().toString(),
          pegawaiId: user.id,
          date: now.toISOString().split('T')[0],
          checkInTime: timeStr,
          checkInLat: pos.coords.latitude,
          checkInLng: pos.coords.longitude,
          status,
        };
        const updated = [newAtt, ...attendance];
        setAttendance(updated);
        syncToDB('attendance', updated);
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
        const timeStr = new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
        const updated = attendance.map(a => a.id === attendanceToday.id
          ? { ...a, checkOutTime: timeStr, checkOutLat: pos.coords.latitude, checkOutLng: pos.coords.longitude }
          : a);
        setAttendance(updated);
        syncToDB('attendance', updated);
        setAttendanceLoading(false);
      },
      () => { alert('Gagal mengambil lokasi GPS. Pastikan GPS aktif.'); setAttendanceLoading(false); },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  if (!initialized) return <div className="min-h-screen flex items-center justify-center bg-slate-50 font-bold text-slate-500">Memuat Sistem...</div>;

  if (!user) {
    return <LoginScreen onLogin={handleLogin} users={users} />;
  }

  if (user.role === 'admin' || user.role === 'owner') {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col md:flex-row">
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
            <button onClick={() => setAdminTab('map')} className={`flex items-center gap-3 w-full p-3 rounded-xl transition-colors text-left ${adminTab === 'map' ? 'bg-blue-600 text-white shadow-md' : 'hover:bg-blue-600/50 text-blue-100'}`}><Map size={20} /> Peta Wilayah GPS</button>
            <button onClick={() => setAdminTab('attendance')} className={`flex items-center gap-3 w-full p-3 rounded-xl transition-colors text-left ${adminTab === 'attendance' ? 'bg-blue-600 text-white shadow-md' : 'hover:bg-blue-600/50 text-blue-100'}`}><Clock size={20} /> Absensi Karyawan</button>
            <button onClick={() => setAdminTab('targets')} className={`flex items-center gap-3 w-full p-3 rounded-xl transition-colors text-left ${adminTab === 'targets' ? 'bg-blue-600 text-white shadow-md' : 'hover:bg-blue-600/50 text-blue-100'}`}><TargetIcon size={20} /> Target Canvasing</button>
            <button onClick={() => setAdminTab('employees')} className={`flex items-center gap-3 w-full p-3 rounded-xl transition-colors text-left ${adminTab === 'employees' ? 'bg-blue-600 text-white shadow-md' : 'hover:bg-blue-600/50 text-blue-100'}`}><Users size={20} /> Kelola Akun Pegawai</button>
          </nav>
          <div className="p-4 hidden md:block border-t border-blue-600">
            {syncing && <div className="text-xs text-blue-200 mb-2 flex items-center gap-1 justify-center"><RefreshCw size={12} className="animate-spin" /> Sinkronisasi Database...</div>}
            {!isOnline && <div className="text-xs text-yellow-200 mb-2 flex items-center gap-1 justify-center"><WifiOff size={12} /> Sedang Offline</div>}
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
            {adminTab === 'dashboard' && <AdminDashboard visits={visits} users={users} />}
            {adminTab === 'map' && <AdminMap visits={visits} users={users} />}
            {adminTab === 'targets' && <AdminTargets visits={visits} users={users} targets={targets} onUpdateTargets={handleUpdateTargets} />}
          </Suspense>
          {adminTab === 'attendance' && <AdminAttendance attendance={attendance} users={users} attendanceSettings={attendanceSettings} onUpdateSettings={handleUpdateAttendanceSettings} />}
          {adminTab === 'employees' && <AdminEmployees users={users} setUsers={handleUsersUpdate} addAuditLog={addAuditLog} />}
        </main>

        {/* Menu mobile - sebelumnya menu ini tidak ada sama sekali di layar kecil/PWA */}
        <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 flex justify-around p-2 pb-safe z-20">
          <button onClick={() => setAdminTab('dashboard')} className={`flex flex-col items-center gap-1 p-2 flex-1 transition-colors ${adminTab === 'dashboard' ? 'text-blue-600' : 'text-slate-400'}`}>
            <BarChart3 size={22} />
            <span className="text-[10px] font-medium">Dashboard</span>
          </button>
          <button onClick={() => setAdminTab('map')} className={`flex flex-col items-center gap-1 p-2 flex-1 transition-colors ${adminTab === 'map' ? 'text-blue-600' : 'text-slate-400'}`}>
            <Map size={22} />
            <span className="text-[10px] font-medium">Peta</span>
          </button>
          <button onClick={() => setAdminTab('attendance')} className={`flex flex-col items-center gap-1 p-2 flex-1 transition-colors ${adminTab === 'attendance' ? 'text-blue-600' : 'text-slate-400'}`}>
            <Clock size={22} />
            <span className="text-[10px] font-medium">Absensi</span>
          </button>
          <button onClick={() => setAdminTab('targets')} className={`flex flex-col items-center gap-1 p-2 flex-1 transition-colors ${adminTab === 'targets' ? 'text-blue-600' : 'text-slate-400'}`}>
            <TargetIcon size={22} />
            <span className="text-[10px] font-medium">Target</span>
          </button>
          <button onClick={() => setAdminTab('employees')} className={`flex flex-col items-center gap-1 p-2 flex-1 transition-colors ${adminTab === 'employees' ? 'text-blue-600' : 'text-slate-400'}`}>
            <Users size={22} />
            <span className="text-[10px] font-medium">Pegawai</span>
          </button>
        </nav>
      </div>
    );
  }

  // Pegawai View (Mobile First)
  return (
    <div className="min-h-screen bg-slate-50 flex justify-center">
      <div className="w-full max-w-md bg-slate-50 relative min-h-screen flex flex-col shadow-2xl">

        <header className="bg-white px-4 py-3 flex items-center justify-between shadow-sm z-10 sticky top-0">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center text-white"><LogoIcon size={20} /></div>
            <span className="font-bold text-slate-800 text-sm">Canvasing Garuda</span>
          </div>
          <div className="flex items-center gap-3">
            {syncing && <RefreshCw size={16} className="text-slate-400 animate-spin" />}
            {!isOnline && <WifiOff size={16} className="text-yellow-500" />}
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
            />
          )}
          {currentTab === 'canvassing' && <CanvassingForm user={user} onSubmit={handleAddVisit} />}
          {currentTab === 'history' && (
            <div className="p-4 pb-24 space-y-4">
              <h2 className="text-xl font-bold text-slate-800 mb-4">Riwayat Kunjungan Saya</h2>
              {visits.filter(v => v.pegawaiId === user.id).map(v => (
                <Card key={v.id} className="p-4 flex flex-col gap-2 border-l-4 border-l-blue-500">
                  <div className="flex justify-between items-start">
                    <div>
                      <h4 className="font-bold text-slate-800 flex items-center gap-1">
                        {v.shopName} {v.isNewCustomer && <span className="bg-yellow-100 text-yellow-700 text-[10px] px-2 py-0.5 rounded-full ml-1 font-bold">Baru</span>}
                      </h4>
                      <p className="text-xs text-slate-500 flex items-center gap-1 mt-1"><MapPin size={12} /> {v.businessType}</p>
                    </div>
                    <span className={`text-[10px] px-2 py-1 rounded-full font-bold uppercase ${v.status === 'Closing' ? 'bg-emerald-100 text-emerald-700' : v.status === 'Prospek' ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-600'}`}>
                      {v.status}
                    </span>
                  </div>
                  <div className="text-xs text-slate-400 mt-2 border-t pt-2 flex justify-between">
                    <span>{v.date} &bull; {v.time}</span>
                    {v.nextFollowUp && <span className="text-yellow-600 font-medium">Follow Up: {v.nextFollowUp}</span>}
                  </div>
                </Card>
              ))}
              {visits.filter(v => v.pegawaiId === user.id).length === 0 && (
                <p className="text-sm text-slate-400 text-center py-8">Belum ada riwayat kunjungan.</p>
              )}
            </div>
          )}
        </main>

        <nav className="fixed bottom-0 w-full max-w-md bg-white border-t border-slate-200 flex justify-around p-2 pb-safe z-20">
          <button
            onClick={() => setCurrentTab('home')}
            className={`flex flex-col items-center gap-1 p-2 w-20 transition-colors ${currentTab === 'home' ? 'text-blue-600' : 'text-slate-400 hover:text-slate-600'}`}
          >
            <Home size={24} className={currentTab === 'home' ? 'fill-blue-100' : ''} />
            <span className="text-[10px] font-medium">Dashboard</span>
          </button>

          <button
            onClick={() => setCurrentTab('canvassing')}
            className="relative -top-6 flex flex-col items-center justify-center w-16 h-16 bg-blue-600 text-white rounded-full shadow-lg shadow-blue-300 border-4 border-slate-50 hover:bg-blue-700 transition-transform active:scale-95"
          >
            <PlusCircle size={32} />
          </button>

          <button
            onClick={() => setCurrentTab('history')}
            className={`flex flex-col items-center gap-1 p-2 w-20 transition-colors ${currentTab === 'history' ? 'text-blue-600' : 'text-slate-400 hover:text-slate-600'}`}
          >
            <History size={24} className={currentTab === 'history' ? 'fill-blue-100' : ''} />
            <span className="text-[10px] font-medium">Riwayat</span>
          </button>
        </nav>
      </div>
    </div>
  );
}
