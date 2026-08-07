// @ts-nocheck
import React, { useState, useMemo, useEffect } from "react";
import {
  Snowflake, Settings, Download, X, Trash2, PlusCircle, MinusCircle,
  ArrowDownCircle, ArrowUpCircle, Wallet, PackageSearch, Printer,
  LogIn, LogOut, Users, ShieldCheck, Eye, EyeOff, Pencil, Smartphone, Database, WifiOff, RefreshCw, Info, AlertTriangle, Search, FileSpreadsheet, Camera
} from "lucide-react";

const GAS_URL = "https://script.google.com/macros/s/AKfycbxMiMaPV76CrWqiAmRPnSHp9IrxAJHFPuMhUyfmxZIbHa33idwjyV9HdSCZrpQHIgdc/exec"; 

const pad = (n) => String(n).padStart(2, "0");
const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const currentMonthStr = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; };
const formatRupiah = (n) => "Rp " + Math.round(n || 0).toLocaleString("id-ID");
const formatQty = (n) => Number(parseFloat(n || 0).toFixed(2));

// Mengecilkan ukuran foto (resize + kompres ke JPEG) sebelum dikirim ke server,
// supaya upload dari HP tetap cepat meski foto aslinya beresolusi besar.
function compressImageFile(file, maxDimension = 800, quality = 0.55) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Gagal membaca file gambar."));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("File bukan gambar yang valid."));
      img.onload = () => {
        let { width, height } = img;
        if (width > maxDimension || height > maxDimension) {
          if (width > height) { height = Math.round((height * maxDimension) / width); width = maxDimension; }
          else { width = Math.round((width * maxDimension) / height); height = maxDimension; }
        }
        const canvas = document.createElement("canvas");
        canvas.width = width; canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, width, height);
        const dataUrl = canvas.toDataURL("image/jpeg", quality);
        resolve(dataUrl);
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}


const KATEGORI_PENGELUARAN_OWNER = ["Gaji", "Operasional", "Tempat", "Modal Es", "Transport", "Marketing", "Overhead", "Bonus", "Admin", "Lain-lain"];
const KATEGORI_PEMASUKAN_OWNER = ["Pemasukan", "Tambahan Modal", "Bonus", "Lain-lain"];

const getSafeDate = (val) => { 
  if (!val) return ""; 
  const strVal = String(val);
  try {
    const d = new Date(val);
    if (!isNaN(d.getTime())) return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  } catch(e) {}
  if (strVal.includes("T")) return strVal.split("T")[0];
  return strVal.substring(0, 10); 
};
const formatTanggal = (iso) => { 
  if (!iso) return "-"; 
  const aman = getSafeDate(iso);
  const parts = aman.split("-"); 
  if(parts.length === 3) return `${parts[2]}/${parts[1]}/${parts[0]}`;
  return aman;
};

function hitungHargaEs(jumlahInput) {
  const q = parseFloat(jumlahInput); if (!q || q <= 0) return 0;
  const whole = Math.floor(q + 1e-9); let frac = Math.round((q - whole) * 100) / 100;
  let total = whole * 20000;
  if (frac > 0.001) {
    const special = { 0.7: 15000, 0.5: 13000, 0.3: 10000, 0.25: 7000, 0.15: 5000 };
    const matchedKey = Object.keys(special).find((k) => Math.abs(frac - parseFloat(k)) < 0.005);
    if (matchedKey) total += special[matchedKey];
    else total += Math.round(frac / 0.1) * 2000;
  }
  return total;
}

function computeStockData(stockRecords, sales) {
  const byCabang = {};
  stockRecords.forEach((r) => { byCabang[r.cabang] = byCabang[r.cabang] || []; byCabang[r.cabang].push(r); });
  let result = [];
  Object.keys(byCabang).forEach((cabang) => {
    const recs = byCabang[cabang].slice().sort((a, b) => getSafeDate(a.tanggal).localeCompare(getSafeDate(b.tanggal)));
    let prevSisaActual = 0;
    recs.forEach((r, idx) => {
      const esMasuk = parseFloat(r.esMasukHariIni) || 0;
      const sisaActual = parseFloat(r.sisaEsActual) || 0;
      const terjual = sales.filter((s) => s.cabang === cabang && getSafeDate(s.tanggal) === getSafeDate(r.tanggal)).reduce((sum, s) => sum + parseFloat(s.jumlah || 0), 0);
      const sisaKemarin = idx === 0 ? 0 : prevSisaActual;
      const jumlahEsMasuk = esMasuk + sisaKemarin;
      const sisaSistem = +(jumlahEsMasuk - terjual).toFixed(2);
      const susut = +(sisaSistem - sisaActual).toFixed(2);
      
      result.push({ ...r, esMasuk, sisaActual, terjual, sisaKemarin, jumlahEsMasuk, sisaSistem, susut });
      prevSisaActual = sisaActual;
    });
  });
  return result.sort((a, b) => (getSafeDate(b.tanggal) + b.cabang).localeCompare(getSafeDate(a.tanggal) + a.cabang));
}

const CustomDialog = ({ dialog, closeDialog }) => {
  const [inputValue, setInputValue] = useState("");

  useEffect(() => {
    if (dialog.show && dialog.type === "prompt") setInputValue("");
  }, [dialog.show, dialog.type]);

  if (!dialog.show) return null;

  const handleConfirm = () => {
    if (dialog.type === "prompt") dialog.onConfirm(inputValue);
    else if (dialog.onConfirm) dialog.onConfirm();
    else closeDialog();
  };

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-[100] p-4 animate-in fade-in duration-200">
      <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-2xl animate-in zoom-in-95 duration-200">
        <h3 className={`font-bold text-lg mb-2 flex items-center gap-2 ${dialog.type === 'error' || dialog.isDestructive ? 'text-red-600' : 'text-slate-800'}`}>
          {dialog.type === 'error' || dialog.isDestructive ? <AlertTriangle className="w-5 h-5"/> : <Info className="w-5 h-5 text-sky-500"/>}
          {dialog.title || "Informasi"}
        </h3>
        <p className="text-slate-600 text-sm mb-5 leading-relaxed">{dialog.msg}</p>
        
        {dialog.type === "prompt" && (
          <input autoFocus type="text" placeholder="Ketik di sini..." className="w-full border-2 border-slate-200 rounded-xl px-4 py-3 text-sm mb-5 focus:outline-none focus:border-sky-500 focus:ring-4 focus:ring-sky-500/20 transition-all" value={inputValue} onChange={e => setInputValue(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleConfirm()} />
        )}
        
        <div className="flex justify-end gap-3">
          {dialog.type !== "alert" && dialog.type !== "error" && (
            <button onClick={closeDialog} className="px-5 py-2.5 text-sm font-bold text-slate-500 hover:bg-slate-100 rounded-xl transition-colors">Batal</button>
          )}
          <button onClick={handleConfirm} className={`px-5 py-2.5 text-sm font-bold text-white rounded-xl transition-all shadow-lg ${dialog.type === 'error' || dialog.isDestructive ? 'bg-red-500 hover:bg-red-600 shadow-red-500/30' : 'bg-sky-500 hover:bg-sky-600 shadow-sky-500/30'}`}>
            {dialog.type === "alert" || dialog.type === "error" ? "Mengerti" : "Konfirmasi"}
          </button>
        </div>
      </div>
    </div>
  );
};

function LoginPage({ onLogin, installPrompt, isOnline, showToast }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const submit = async () => {
    if (!username.trim() || !password.trim()) { setError("Masukkan username dan password!"); return; }
    setIsLoading(true); setError("");
    try {
      if (GAS_URL) {
        const res = await fetch(GAS_URL, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify({ action: "login", data: { username: username.trim(), password: password } }) });
        const data = await res.json();
        if (data.success) { showToast("Berhasil Login", "success"); onLogin(data.user); } else { setError(data.error || "Username atau password salah."); }
      } else {
        const localUsers = JSON.parse(localStorage.getItem("es_kristal_users") || "[]");
        if (localUsers.length === 0) {
          localUsers.push({ id: "u1", username: "admin", password: "admin123", nama: "Super Admin", role: "admin", cabang: "Pusat" });
          localStorage.setItem("es_kristal_users", JSON.stringify(localUsers));
        }
        const user = localUsers.find((u) => u.username === username.trim() && u.password === password);
        if (user) { showToast("Login Mode Lokal Berhasil", "success"); onLogin(user); } else { setError("Username atau password salah (Mode Lokal)."); }
      }
    } catch (err) { setError("Gagal terhubung ke server. Periksa koneksi internet Anda."); } finally { setIsLoading(false); }
  };

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-gradient-to-br from-slate-900 via-sky-900 to-sky-700 p-4 relative overflow-hidden">
      <div className="absolute top-[-10%] left-[-10%] w-96 h-96 bg-sky-500/20 rounded-full blur-3xl"></div>
      <div className="absolute bottom-[-10%] right-[-10%] w-96 h-96 bg-blue-500/20 rounded-full blur-3xl"></div>
      <div className="w-full max-w-sm relative z-10">
        <div className="text-center mb-8 flex flex-col items-center">
         <div className="bg-white/10 p-4 rounded-2xl backdrop-blur-md mb-4 shadow-xl border border-white/20"><img src="/logo192.png" alt="Es Kristal Garuda" className="w-16 h-16 object-contain" /></div>
          <h1 className="text-2xl font-bold text-white tracking-wide">Es Kristal Garuda</h1>
          <div className="flex items-center justify-center gap-2 mt-2">
            {isOnline ? (<span className="flex items-center gap-1.5 text-xs font-medium bg-emerald-500/20 text-emerald-300 px-3 py-1 rounded-full border border-emerald-500/30"><Database className="w-3.5 h-3.5" /> Tersambung Cloud</span>) : (<span className="flex items-center gap-1.5 text-xs font-medium bg-amber-500/20 text-amber-300 px-3 py-1 rounded-full border border-amber-500/30"><WifiOff className="w-3.5 h-3.5" /> Mode Lokal Offline</span>)}
          </div>
        </div>
        <div onKeyDown={(e) => e.key === "Enter" && submit()} className="bg-white/95 backdrop-blur-xl rounded-2xl shadow-2xl p-7 space-y-5 border border-white/50">
          <div><label className="block text-xs font-bold text-slate-600 mb-1.5 uppercase tracking-wide">Username</label><input value={username} onChange={(e) => setUsername(e.target.value)} disabled={isLoading} className="w-full border-2 border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-4 focus:ring-sky-500/20 focus:border-sky-50 transition-all bg-slate-50" placeholder="Masukkan username" autoComplete="username" /></div>
          <div><label className="block text-xs font-bold text-slate-600 mb-1.5 uppercase tracking-wide">Password</label>
            <div className="relative"><input type={showPw ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)} disabled={isLoading} className="w-full border-2 border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-4 focus:ring-sky-500/20 focus:border-sky-50 transition-all bg-slate-50 pr-12" placeholder="********" autoComplete="current-password" /><button type="button" onClick={() => setShowPw((s) => !s)} disabled={isLoading} className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-sky-600 transition-colors">{showPw ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}</button></div>
          </div>
          {error && (<p className="text-red-600 text-xs font-semibold bg-red-50 border border-red-200 rounded-lg px-3 py-2.5 flex items-center gap-2">! {error}</p>)}
          <button type="button" onClick={submit} disabled={isLoading} className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-sky-500 to-blue-600 hover:from-sky-600 hover:to-blue-700 shadow-lg shadow-sky-500/30 transition-all text-white text-sm font-bold rounded-xl py-3.5 disabled:opacity-70 disabled:cursor-not-allowed">
            {isLoading ? <RefreshCw className="w-5 h-5 animate-spin" /> : <LogIn className="w-5 h-5" />}{isLoading ? "Memverifikasi..." : "Masuk ke Sistem"}
          </button>
          {installPrompt && (<button type="button" onClick={installPrompt} className="w-full flex items-center justify-center gap-2 bg-slate-100 hover:bg-slate-200 text-slate-700 transition-all text-sm font-semibold rounded-xl py-3 mt-2 border border-slate-300"><Smartphone className="w-4 h-4" /> Install Aplikasi (PWA)</button>)}
        </div>
      </div>
    </div>
  );
}
export default function App() {
  const isOnline = Boolean(GAS_URL);
  const [appLoading, setAppLoading] = useState(false);

  const [dialog, setDialog] = useState({ show: false, type: "", msg: "", title: "", onConfirm: null, isDestructive: false });
  const closeDialog = () => setDialog({ show: false, type: "", msg: "", title: "", onConfirm: null, isDestructive: false });
  const [toast, setToast] = useState({ show: false, msg: "", type: "info" });
  const showToast = (msg, type = "info") => { setToast({ show: true, msg, type }); setTimeout(() => setToast({ show: false, msg: "", type: "info" }), 3500); };
  const showAlert = (msg, title = "Perhatian", isError = false) => { setDialog({ show: true, type: isError ? "error" : "alert", msg, title }); };

  const [tab, setTab] = useState("kasir");

  const [cabangList, setCabangList] = useState(() => {
    try { const saved = localStorage.getItem("es_kristal_cabang"); if (saved) return JSON.parse(saved); } catch(e){}
    return ["Limbangan", "Wanaraja", "Ciawitali", "Tasik", "Ciamis"];
  });
  
  const [kategoriList, setKategoriList] = useState(() => {
    try { const saved = localStorage.getItem("es_kristal_kategori"); if (saved) return JSON.parse(saved); } catch(e){}
    return ["Transport", "Maintenance", "Marketing", "Bensin", "Gaji", "Bonus"];
  });

  useEffect(() => { localStorage.setItem("es_kristal_cabang", JSON.stringify(cabangList)); }, [cabangList]);
  useEffect(() => { localStorage.setItem("es_kristal_kategori", JSON.stringify(kategoriList)); }, [kategoriList]);

  const [users, setUsers] = useState([]);
  const [sales, setSales] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [stockRecords, setStockRecords] = useState([]);

  const [currentUser, setCurrentUser] = useState(null);
  const isAdmin = currentUser?.role === "admin";
  const myCabang = currentUser?.cabang || "";

  const [showSettings, setShowSettings] = useState(false);
  const [settingsTab, setSettingsTab] = useState("cabang");
  const [newCabang, setNewCabang] = useState("");
  const [newKategori, setNewKategori] = useState("");
  const [showExportModal, setShowExportModal] = useState(false);
  const [exportMonth, setExportMonth] = useState(currentMonthStr());
  const [showUserModal, setShowUserModal] = useState(false);
  const [editingUser, setEditingUser] = useState(null);
  const [deferredPrompt, setDeferredPrompt] = useState(null);

  const [filterDate, setFilterDate] = useState(todayStr());
  const [filterCabang, setFilterCabang] = useState("Semua Cabang");
  const [formTab, setFormTab] = useState("penjualan");
  const [histTab, setHistTab] = useState("pemasukan");

  const emptySaleForm = { id: null, tanggal: todayStr(), cabang: "", customer: "", jumlah: "", hargaEs: "", ongkir: "", diskon: "" };
  const [saleForm, setSaleForm] = useState(emptySaleForm);
  const emptyExpenseForm = { id: null, tanggal: todayStr(), cabang: "", kategori: "", jumlah: "", keterangan: "", fotoBukti: "" };
  const [expenseForm, setExpenseForm] = useState(emptyExpenseForm);
  const [expensePhotoFile, setExpensePhotoFile] = useState(null);
  const [expensePhotoPreview, setExpensePhotoPreview] = useState("");
  const [isUploadingPhoto, setIsUploadingPhoto] = useState(false);
  const [stockFilterDate, setStockFilterDate] = useState(todayStr());
  const [stockFilterCabang, setStockFilterCabang] = useState("Semua Cabang");
  const emptyStockForm = { id: null, tanggal: todayStr(), cabang: "", esMasukHariIni: "", sisaEsActual: "" };
  const [stockForm, setStockForm] = useState(emptyStockForm);
  
  const [reportMonth, setReportMonth] = useState(currentMonthStr());

  // ==========================================
  // KAS OWNER: Arus Kas (dulu "Catatan Transaksi Rahasia")
  // ==========================================
  const [ownerNotes, setOwnerNotes] = useState([]);
  const [ownerSubTab, setOwnerSubTab] = useState("ringkasan");
  const [ownerReportMonth, setOwnerReportMonth] = useState(currentMonthStr());
  const emptyOwnerForm = { id: null, tanggal: todayStr(), cabang: "Semua Cabang", keterangan: "", jumlah: "", jenis: "keluar", kategori: "" };
  const [ownerForm, setOwnerForm] = useState(emptyOwnerForm);

  const [ownerFilterDate, setOwnerFilterDate] = useState("");
  const [ownerFilterCabang, setOwnerFilterCabang] = useState("Semua Cabang");
  const [ownerFilterJenis, setOwnerFilterJenis] = useState("semua");

  const filteredOwnerNotes = useMemo(() => {
    return ownerNotes.filter((n) => {
      const matchDate = !ownerFilterDate || getSafeDate(n.tanggal) === ownerFilterDate;
      const matchCabang = ownerFilterCabang === "Semua Cabang" || n.cabang === ownerFilterCabang;
      const matchJenis = ownerFilterJenis === "semua" || n.jenis === ownerFilterJenis;
      return matchDate && matchCabang && matchJenis;
    });
  }, [ownerNotes, ownerFilterDate, ownerFilterCabang, ownerFilterJenis]);

  const filteredOwnerMasuk = filteredOwnerNotes.filter(n => n.jenis === "masuk").reduce((a,n)=>a+parseFloat(n.jumlah||0),0);
  const filteredOwnerKeluar = filteredOwnerNotes.filter(n => n.jenis === "keluar").reduce((a,n)=>a+parseFloat(n.jumlah||0),0);

  const addOwnerNote = () => {
    if (!ownerForm.keterangan.trim() || !ownerForm.jumlah || parseFloat(ownerForm.jumlah) <= 0 || !ownerForm.kategori) {
      return showAlert("Harap lengkapi Kategori, Keterangan, dan Jumlah.", "Data Belum Lengkap", true);
    }
    const newNote = {
      id: ownerForm.id || "own_" + Date.now(),
      tanggal: ownerForm.tanggal,
      cabang: ownerForm.cabang || "Semua Cabang",
      keterangan: ownerForm.keterangan.trim(),
      jumlah: parseFloat(ownerForm.jumlah) || 0,
      jenis: ownerForm.jenis,
      kategori: ownerForm.kategori,
    };
    dbSave("OwnerNotes", newNote, "Arus Kas");
    setOwnerForm(emptyOwnerForm);
  };

  const removeOwnerNote = (id) => {
    setDialog({ show: true, type: "confirm", isDestructive: true, title: "Hapus Catatan", msg: "Yakin hapus catatan Arus Kas ini?", onConfirm: () => { dbDelete("OwnerNotes", id, "Arus Kas"); closeDialog(); } });
  };

  const exportOwnerNotesCSV = () => {
    if (ownerNotes.length === 0) return showAlert("Tidak ada data Arus Kas.", "Kosong", true);
    let csv = "Tanggal,Depot,Keterangan,Jenis,Kategori,Jumlah\n";
    ownerNotes.forEach((n) => { csv += `"${formatTanggal(n.tanggal)}","${n.cabang || "Semua Cabang"}","${n.keterangan}","${n.jenis === "masuk" ? "Pemasukan" : "Pengeluaran"}","${n.kategori || "-"}",${n.jumlah}\n`; });
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" }); const link = document.createElement("a");
    link.href = URL.createObjectURL(blob); link.download = `Arus_Kas_Es_Garuda.csv`;
    document.body.appendChild(link); link.click(); document.body.removeChild(link);
  };

  const realProfitByCabang = useMemo(() => {
    return cabangList.map((cabang) => {
      const cSales = sales.filter((s) => s.cabang === cabang && getSafeDate(s.tanggal).startsWith(ownerReportMonth));
      const cExpenses = expenses.filter((e) => e.cabang === cabang && getSafeDate(e.tanggal).startsWith(ownerReportMonth));
      const cOwnerNotes = ownerNotes.filter((n) => n.cabang === cabang && getSafeDate(n.tanggal).startsWith(ownerReportMonth));
      const pemasukan = cSales.reduce((a, s) => a + s.total, 0);
      const pengeluaranPegawai = cExpenses.reduce((a, e) => a + parseFloat(e.jumlah || 0), 0);
      const kasKeluar = cOwnerNotes.filter((n) => n.jenis === "keluar").reduce((a, n) => a + parseFloat(n.jumlah || 0), 0);
      const kasMasuk = cOwnerNotes.filter((n) => n.jenis === "masuk").reduce((a, n) => a + parseFloat(n.jumlah || 0), 0);
      const labaKotor = pemasukan - pengeluaranPegawai;
      const labaRiil = labaKotor - kasKeluar + kasMasuk;
      return { cabang, pemasukan, pengeluaranPegawai, kasKeluar, kasMasuk, labaKotor, labaRiil };
    });
  }, [sales, expenses, ownerNotes, cabangList, ownerReportMonth]);

  const generalOwnerNotes = useMemo(() => ownerNotes.filter((n) => (n.cabang === "Semua Cabang" || !n.cabang) && getSafeDate(n.tanggal).startsWith(ownerReportMonth)), [ownerNotes, ownerReportMonth]);
  const generalKasKeluar = generalOwnerNotes.filter((n) => n.jenis === "keluar").reduce((a, n) => a + parseFloat(n.jumlah || 0), 0);
  const generalKasMasuk = generalOwnerNotes.filter((n) => n.jenis === "masuk").reduce((a, n) => a + parseFloat(n.jumlah || 0), 0);

  const totalLabaKotorSemua = realProfitByCabang.reduce((a, r) => a + r.labaKotor, 0);
  const totalLabaRiilSemua = realProfitByCabang.reduce((a, r) => a + r.labaRiil, 0) + generalKasMasuk - generalKasKeluar;

  // ==========================================
  // HUTANG PIUTANG (dalam Kas Owner)
  // ==========================================
  const [hutangPiutangList, setHutangPiutangList] = useState([]);
  const emptyHutangForm = { id: null, nama: "", jenis: "Hutang", jumlah: "", tanggal: todayStr(), keterangan: "", status: "Belum Lunas" };
  const [hutangForm, setHutangForm] = useState(emptyHutangForm);
  const [hutangSearch, setHutangSearch] = useState("");
  const [hutangFilterStatus, setHutangFilterStatus] = useState("Semua");
  const [hutangFilterDateFrom, setHutangFilterDateFrom] = useState("");
  const [hutangFilterDateTo, setHutangFilterDateTo] = useState("");

  const addHutang = () => {
    if (!hutangForm.nama.trim() || !hutangForm.jumlah || parseFloat(hutangForm.jumlah) <= 0) {
      return showAlert("Nama dan Jumlah wajib diisi.", "Data Belum Lengkap", true);
    }
    const item = {
      id: hutangForm.id || "hp_" + Date.now(),
      nama: hutangForm.nama.trim(),
      jenis: hutangForm.jenis,
      jumlah: parseFloat(hutangForm.jumlah) || 0,
      tanggal: hutangForm.tanggal,
      keterangan: hutangForm.keterangan.trim() || "-",
      status: hutangForm.status,
      updatedAt: new Date().toISOString(),
    };
    dbSave("HutangPiutang", item, "Hutang Piutang");
    setHutangForm(emptyHutangForm);
  };

  const editHutang = (item) => {
    setHutangForm({ ...item, tanggal: getSafeDate(item.tanggal) });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const removeHutang = (id) => {
    setDialog({ show: true, type: "confirm", isDestructive: true, title: "Hapus Data", msg: "Yakin hapus data Hutang Piutang ini?", onConfirm: () => { dbDelete("HutangPiutang", id, "Hutang Piutang"); closeDialog(); } });
  };

  const toggleHutangStatus = (item) => {
    dbSave("HutangPiutang", { ...item, status: item.status === "Lunas" ? "Belum Lunas" : "Lunas", updatedAt: new Date().toISOString() }, "Hutang Piutang");
  };

  const filteredHutangPiutang = useMemo(() => {
    return hutangPiutangList.filter((h) => {
      const matchSearch = !hutangSearch || h.nama.toLowerCase().includes(hutangSearch.toLowerCase()) || (h.keterangan || "").toLowerCase().includes(hutangSearch.toLowerCase());
      const matchStatus = hutangFilterStatus === "Semua" || h.status === hutangFilterStatus;
      const d = getSafeDate(h.tanggal);
      const matchFrom = !hutangFilterDateFrom || d >= hutangFilterDateFrom;
      const matchTo = !hutangFilterDateTo || d <= hutangFilterDateTo;
      return matchSearch && matchStatus && matchFrom && matchTo;
    });
  }, [hutangPiutangList, hutangSearch, hutangFilterStatus, hutangFilterDateFrom, hutangFilterDateTo]);

  const exportHutangCSV = () => {
    if (hutangPiutangList.length === 0) return showAlert("Tidak ada data Hutang Piutang.", "Kosong", true);
    let csv = "Nama,Jenis,Jumlah,Tanggal,Keterangan,Status\n";
    hutangPiutangList.forEach((h) => { csv += `"${h.nama}","${h.jenis}",${h.jumlah},"${formatTanggal(h.tanggal)}","${h.keterangan}","${h.status}"\n`; });
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" }); const link = document.createElement("a");
    link.href = URL.createObjectURL(blob); link.download = `Hutang_Piutang_Es_Garuda.csv`;
    document.body.appendChild(link); link.click(); document.body.removeChild(link);
  };

  // ==========================================
  // SALDO REKENING BANK - REAL-TIME OTOMATIS
  // Saldo = (Penjualan + Kas Owner Masuk) - (Pengeluaran + Kas Owner Keluar) - Hutang/Piutang Belum Lunas
  // ==========================================
  const totalPemasukanSemua = useMemo(() => {
    const dariPenjualan = sales.reduce((a, s) => a + (s.total || 0), 0);
    const dariKasOwnerMasuk = ownerNotes.filter((n) => n.jenis === "masuk").reduce((a, n) => a + parseFloat(n.jumlah || 0), 0);
    return dariPenjualan + dariKasOwnerMasuk;
  }, [sales, ownerNotes]);

  const totalPengeluaranSemua = useMemo(() => {
    const dariOperasional = expenses.reduce((a, e) => a + parseFloat(e.jumlah || 0), 0);
    const dariKasOwnerKeluar = ownerNotes.filter((n) => n.jenis === "keluar").reduce((a, n) => a + parseFloat(n.jumlah || 0), 0);
    return dariOperasional + dariKasOwnerKeluar;
  }, [expenses, ownerNotes]);

  const totalHutangPiutangBelumLunas = useMemo(() => {
    return hutangPiutangList.filter((h) => h.status === "Belum Lunas").reduce((a, h) => a + parseFloat(h.jumlah || 0), 0);
  }, [hutangPiutangList]);

  const saldoRekeningOtomatis = totalPemasukanSemua - totalPengeluaranSemua - totalHutangPiutangBelumLunas;

  useEffect(() => {
    const handleBeforeInstall = (e) => { e.preventDefault(); setDeferredPrompt(e); };
    window.addEventListener("beforeinstallprompt", handleBeforeInstall);
    return () => window.removeEventListener("beforeinstallprompt", handleBeforeInstall);
  }, []);

  const installPWA = () => {
    if (deferredPrompt) { deferredPrompt.prompt(); deferredPrompt.userChoice.then(() => setDeferredPrompt(null)); } 
    else { showAlert("Gunakan menu 'Add to Home Screen' pada browser HP Anda untuk menginstal.", "Cara Install"); }
  };

  const loadData = async () => {
    setAppLoading(true);
    try {
      if (GAS_URL) {
        const res = await fetch(`${GAS_URL}?t=${new Date().getTime()}`, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify({ action: "getData", data: { role: currentUser?.role } }) });
        const resData = await res.json();
        if (resData.success) {
          setUsers(resData.users || []); setSales(resData.sales || []); setExpenses(resData.expenses || []); setStockRecords(resData.stocks || []);
          setOwnerNotes(resData.ownerNotes || []); setHutangPiutangList(resData.hutangPiutang || []);
          localStorage.setItem("es_kristal_users", JSON.stringify(resData.users || []));
          localStorage.setItem("es_kristal_sales", JSON.stringify(resData.sales || []));
          localStorage.setItem("es_kristal_expenses", JSON.stringify(resData.expenses || []));
          localStorage.setItem("es_kristal_stocks", JSON.stringify(resData.stocks || []));
          if (resData.ownerNotes) localStorage.setItem("es_kristal_owner_notes", JSON.stringify(resData.ownerNotes));
          if (resData.hutangPiutang) localStorage.setItem("es_kristal_hutang_piutang", JSON.stringify(resData.hutangPiutang));
        } else {
          showAlert(resData.error || "Gagal mengambil data dari Google Spreadsheet.", "Sinkronisasi Gagal", true);
        }
      } else {
        setUsers(JSON.parse(localStorage.getItem("es_kristal_users") || "[]"));
        setSales(JSON.parse(localStorage.getItem("es_kristal_sales") || "[]"));
        setExpenses(JSON.parse(localStorage.getItem("es_kristal_expenses") || "[]"));
        setStockRecords(JSON.parse(localStorage.getItem("es_kristal_stocks") || "[]"));
        if (currentUser?.role === "admin") {
          setOwnerNotes(JSON.parse(localStorage.getItem("es_kristal_owner_notes") || "[]"));
          setHutangPiutangList(JSON.parse(localStorage.getItem("es_kristal_hutang_piutang") || "[]"));
        }
      }
    } catch (e) {
      showAlert("Gagal terhubung ke Google Spreadsheet. Memuat data cadangan offline. Periksa koneksi internet atau URL Apps Script.", "Koneksi Bermasalah", true);
      setUsers(JSON.parse(localStorage.getItem("es_kristal_users") || "[]")); setSales(JSON.parse(localStorage.getItem("es_kristal_sales") || "[]"));
      setExpenses(JSON.parse(localStorage.getItem("es_kristal_expenses") || "[]")); setStockRecords(JSON.parse(localStorage.getItem("es_kristal_stocks") || "[]"));
      if (currentUser?.role === "admin") {
        setOwnerNotes(JSON.parse(localStorage.getItem("es_kristal_owner_notes") || "[]"));
        setHutangPiutangList(JSON.parse(localStorage.getItem("es_kristal_hutang_piutang") || "[]"));
      }
    } finally { setAppLoading(false); }
  };

  useEffect(() => { if (currentUser) loadData(); }, [currentUser]);

  const dbSave = async (table, item, labelSukses) => {
    const tableMap = { Users: setUsers, Sales: setSales, Expenses: setExpenses, Stocks: setStockRecords, OwnerNotes: setOwnerNotes, HutangPiutang: setHutangPiutangList };
    const localKey = { Users: "es_kristal_users", Sales: "es_kristal_sales", Expenses: "es_kristal_expenses", Stocks: "es_kristal_stocks", OwnerNotes: "es_kristal_owner_notes", HutangPiutang: "es_kristal_hutang_piutang" };
    tableMap[table]((prev) => {
      const exists = prev.find((x) => x.id === item.id);
      const newData = exists ? prev.map((x) => (x.id === item.id ? item : x)) : [...prev, item];
      localStorage.setItem(localKey[table], JSON.stringify(newData));
      return newData;
    });
    if (!GAS_URL) { showToast((labelSukses || "Data") + " tersimpan (mode lokal, tidak tersambung Google Sheet)", "info"); return; }
    try {
      const res = await fetch(GAS_URL, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify({ action: "save", table, data: item }) });
      const result = await res.json();
      if (!result.success) throw new Error(result.error || "Gagal server");
      showToast((labelSukses || "Data") + " tersimpan & tersinkron ke Google Spreadsheet", "success");
    } catch (e) {
      showToast("Tersimpan lokal, GAGAL sinkron ke Google Spreadsheet: " + e.message, "error");
    }
  };

  const dbDelete = async (table, id, labelSukses) => {
    const tableMap = { Users: setUsers, Sales: setSales, Expenses: setExpenses, Stocks: setStockRecords, OwnerNotes: setOwnerNotes, HutangPiutang: setHutangPiutangList };
    const localKey = { Users: "es_kristal_users", Sales: "es_kristal_sales", Expenses: "es_kristal_expenses", Stocks: "es_kristal_stocks", OwnerNotes: "es_kristal_owner_notes", HutangPiutang: "es_kristal_hutang_piutang" };
    tableMap[table]((prev) => {
      const newData = prev.filter((x) => x.id !== id);
      localStorage.setItem(localKey[table], JSON.stringify(newData));
      return newData;
    });
    if (!GAS_URL) { showToast((labelSukses || "Data") + " dihapus (mode lokal)", "info"); return; }
    try {
      const res = await fetch(GAS_URL, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify({ action: "delete", table, data: { id } }) });
      const result = await res.json();
      if (!result.success) throw new Error(result.error || "Gagal server");
      showToast((labelSukses || "Data") + " dihapus & tersinkron ke Google Spreadsheet", "success");
    } catch (e) {
      showToast("Terhapus lokal, GAGAL sinkron hapus ke Google Spreadsheet: " + e.message, "error");
    }
  };

  const handleCabangSelect = (val, form, setForm, syncFilterSetter = null) => {
    if (val === "__new__") {
      setDialog({ show: true, type: "prompt", msg: "Masukkan nama cabang baru:", title: "Cabang Baru",
        onConfirm: (name) => {
          if (name && name.trim()) {
            const trimmed = name.trim();
            setCabangList((prev) => prev.includes(trimmed) ? prev : [...prev, trimmed]);
            setForm({ ...form, cabang: trimmed });
            if (syncFilterSetter) syncFilterSetter(trimmed);
          }
          closeDialog();
        }
      });
    } else {
      setForm({ ...form, cabang: val });
      if (syncFilterSetter) syncFilterSetter(val);
    }
  };

  const handleKategoriSelect = (val, form, setForm) => {
    if (val === "__new__") {
      setDialog({ show: true, type: "prompt", msg: "Masukkan nama kategori baru:", title: "Kategori Baru",
        onConfirm: (name) => {
          if (name && name.trim()) {
            const trimmed = name.trim();
            setKategoriList((prev) => prev.includes(trimmed) ? prev : [...prev, trimmed]);
            setForm({ ...form, kategori: trimmed });
          }
          closeDialog();
        }
      });
    } else { setForm({ ...form, kategori: val }); }
  };

  const addSale = () => {
    const cabangValue = isAdmin ? saleForm.cabang : myCabang;
    if (!cabangValue || !saleForm.jumlah || parseFloat(saleForm.jumlah) <= 0) {
      return showAlert("Harap lengkapi isian Cabang dan Jumlah Qty.", "Data Belum Lengkap", true);
    }
    const jumlah = formatQty(saleForm.jumlah);
    const hargaEs = parseFloat(saleForm.hargaEs) || 0;
    const ongkir = parseFloat(saleForm.ongkir) || 0;
    const diskon = parseFloat(saleForm.diskon) || 0;
    const totalBayar = hargaEs + ongkir - diskon;

    const newSale = {
      id: saleForm.id || "s_" + Date.now(),
      tanggal: saleForm.tanggal,
      cabang: cabangValue,
      customer: saleForm.customer.trim() || "-",
      jumlah,
      hargaEs,
      ongkir,
      diskon,
      total: totalBayar,
    };
    dbSave("Sales", newSale, "Penjualan");
    setSaleForm({ ...emptySaleForm, tanggal: saleForm.tanggal, cabang: isAdmin ? saleForm.cabang : "" });
  };

  const editSale = (item) => {
    setTab("kasir"); setFormTab("penjualan");
    setSaleForm({ 
      id: item.id, 
      tanggal: getSafeDate(item.tanggal), 
      cabang: item.cabang, 
      customer: item.customer, 
      jumlah: item.jumlah, 
      hargaEs: item.hargaEs, 
      ongkir: item.ongkir || "",
      diskon: item.diskon || "" 
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleExpensePhotoSelect = async (file) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) return showAlert("File harus berupa gambar.", "Format Salah", true);
    try {
      const compressedDataUrl = await compressImageFile(file);
      setExpensePhotoFile(file);
      setExpensePhotoPreview(compressedDataUrl);
    } catch (e) {
      showAlert("Gagal memproses foto: " + e.message, "Gagal", true);
    }
  };

  const removeExpensePhoto = () => {
    setExpensePhotoFile(null);
    setExpensePhotoPreview("");
    setExpenseForm((prev) => ({ ...prev, fotoBukti: "" }));
  };

  const addExpense = async () => {
    const cabangValue = isAdmin ? expenseForm.cabang : myCabang;
    if (!cabangValue || !expenseForm.kategori || !expenseForm.jumlah || parseFloat(expenseForm.jumlah) <= 0) {
      return showAlert("Harap lengkapi isian Cabang, Kategori, dan Nominal.", "Data Belum Lengkap", true);
    }

    let fotoUrl = expenseForm.fotoBukti || "";
    let fotoGagalUpload = false;

    if (expensePhotoPreview && !fotoUrl) {
      if (!GAS_URL) {
        showToast("Mode lokal: foto tidak diupload (butuh koneksi Google Sheet).", "info");
      } else {
        setIsUploadingPhoto(true);
        try {
          const base64Only = expensePhotoPreview.split(",")[1];
          const res = await fetch(GAS_URL, {
            method: "POST",
            headers: { "Content-Type": "text/plain;charset=utf-8" },
            body: JSON.stringify({ action: "uploadFile", data: { base64: base64Only, mimeType: "image/jpeg", filename: `bukti_${Date.now()}.jpg` } }),
          });
          const result = await res.json();
          if (!result.success) throw new Error(result.error || "Gagal upload foto");
          fotoUrl = result.url;
        } catch (e) {
          // Upload foto gagal, TAPI transaksinya tetap lanjut disimpan tanpa foto,
          // supaya data pengeluaran tidak pernah gagal tersimpan hanya gara-gara foto.
          fotoGagalUpload = true;
          fotoUrl = "";
        }
        setIsUploadingPhoto(false);
      }
    }

    const newExp = {
      id: expenseForm.id || "e_" + Date.now(),
      tanggal: expenseForm.tanggal, cabang: cabangValue, kategori: expenseForm.kategori,
      jumlah: parseFloat(expenseForm.jumlah) || 0, keterangan: expenseForm.keterangan.trim() || "-",
      fotoBukti: fotoUrl,
    };
    dbSave("Expenses", newExp, "Pengeluaran");
    if (fotoGagalUpload) {
      showToast("Data pengeluaran tersimpan, TAPI foto gagal diupload. Coba edit transaksi ini nanti untuk tambah fotonya lagi.", "error");
    }
    setExpenseForm({ ...emptyExpenseForm, tanggal: expenseForm.tanggal, cabang: isAdmin ? expenseForm.cabang : "" });
    setExpensePhotoFile(null);
    setExpensePhotoPreview("");
  };

  const addStock = () => {
    const cabangValue = isAdmin ? stockForm.cabang : myCabang;
    if (!cabangValue) return showAlert("Cabang harus diisi.", "Peringatan", true);
    const rec = {
      id: stockForm.id || "stk_" + Date.now(),
      tanggal: stockForm.tanggal, cabang: cabangValue,
      esMasukHariIni: formatQty(stockForm.esMasukHariIni),
      sisaEsActual: formatQty(stockForm.sisaEsActual),
    };
    dbSave("Stocks", rec, "Stok");
    setStockForm({ ...emptyStockForm, tanggal: stockForm.tanggal, cabang: isAdmin ? stockForm.cabang : "" });
  };

  const editStock = (item) => {
    setTab("stok");
    setStockForm({
      id: item.id,
      tanggal: getSafeDate(item.tanggal),
      cabang: item.cabang,
      esMasukHariIni: item.esMasukHariIni,
      sisaEsActual: item.sisaEsActual
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const saveUser = (data) => {
    if (!data.nama.trim() || !data.username.trim()) return showAlert("Nama dan Username Wajib Diisi.", "Gagal", true);
    const isNew = !data.id;
    if (isNew && !data.password.trim()) return showAlert("Password Wajib Diisi.", "Gagal", true);
    const uId = isNew ? "u_" + Date.now() : data.id;
    const existing = users.find((u) => u.id === data.id);
    const updatedUser = { id: uId, username: data.username, nama: data.nama, role: data.role, cabang: data.role === "admin" ? null : data.cabang, password: isNew || data.password ? data.password : existing?.password };
    dbSave("Users", updatedUser, "Pengguna"); setShowUserModal(false); setEditingUser(null);
  };

  const removeUser = (id) => {
    if (currentUser && id === currentUser.id) return showAlert("Tidak bisa hapus akun Anda sendiri.", "Ditolak", true);
    setDialog({ show: true, type: "confirm", isDestructive: true, title: "Hapus Pengguna", msg: "Yakin hapus akun ini?", onConfirm: () => { dbDelete("Users", id, "Pengguna"); closeDialog(); } });
  };

  const confirmDeleteData = (table, id) => {
    setDialog({ show: true, type: "confirm", isDestructive: true, title: "Hapus Data", msg: "Yakin hapus data ini?", onConfirm: () => { dbDelete(table, id); closeDialog(); } });
  };

  const effectiveFilterCabang = isAdmin ? filterCabang : myCabang;
  const filteredSales = useMemo(() => sales.filter((s) => getSafeDate(s.tanggal) === filterDate && (effectiveFilterCabang === "Semua Cabang" || s.cabang === effectiveFilterCabang)), [sales, filterDate, effectiveFilterCabang]);
  const filteredExpenses = useMemo(() => expenses.filter((e) => getSafeDate(e.tanggal) === filterDate && (effectiveFilterCabang === "Semua Cabang" || e.cabang === effectiveFilterCabang)), [expenses, filterDate, effectiveFilterCabang]);
  
  const totalEsTerjual = formatQty(filteredSales.reduce((a, s) => a + parseFloat(s.jumlah || 0), 0));
  const totalPemasukan = filteredSales.reduce((a, s) => a + s.total, 0);
  const totalPengeluaran = filteredExpenses.reduce((a, e) => a + parseFloat(e.jumlah || 0), 0);
  const labaBersih = totalPemasukan - totalPengeluaran;

  const computedStock = useMemo(() => computeStockData(stockRecords, sales), [stockRecords, sales]);
  const effectiveStockCabang = isAdmin ? stockFilterCabang : myCabang;
  const filteredStock = computedStock.filter((r) => getSafeDate(r.tanggal) === stockFilterDate && (effectiveStockCabang === "Semua Cabang" || r.cabang === effectiveStockCabang));

  const monthlySummary = useMemo(() => {
    const monthSales = sales.filter((s) => getSafeDate(s.tanggal).startsWith(reportMonth));
    return cabangList.map((cabang) => {
      const data = monthSales.filter((s) => s.cabang === cabang);
      return {
        cabang, esTerjual: formatQty(data.reduce((a, s) => a + parseFloat(s.jumlah || 0), 0)),
        customer: new Set(data.map((s) => s.customer)).size, pendapatan: data.reduce((a, s) => a + s.total, 0),
      };
    });
  }, [sales, reportMonth, cabangList]);

  const totalRingkasan = monthlySummary.reduce((acc, r) => ({ esTerjual: formatQty(acc.esTerjual + r.esTerjual), customer: acc.customer + r.customer, pendapatan: acc.pendapatan + r.pendapatan }), { esTerjual: 0, customer: 0, pendapatan: 0 });

  const exportCSV = (month) => {
    const monthSales = sales.filter((s) => getSafeDate(s.tanggal).startsWith(month));
    const monthExpenses = expenses.filter((e) => getSafeDate(e.tanggal).startsWith(month));
    if (monthSales.length === 0 && monthExpenses.length === 0) return showAlert("Tidak ada data.", "Kosong", true);
    
    let csv = `LAPORAN BULANAN ES KRISTAL GARUDA\nBulan:,${month}\n\nRINGKASAN PER CABANG\nCabang,Jumlah Es Terjual,Jumlah Customer,Total Pendapatan (Rp),Total Pengeluaran (Rp),Laba Bersih (Rp)\n`;
    const cabangsInMonth = [...new Set([...monthSales.map((s) => s.cabang), ...monthExpenses.map((e) => e.cabang)])];
    let tEs = 0, tCust = 0, tPend = 0, tPeng = 0, tLaba = 0;
    cabangsInMonth.forEach((cabang) => {
      const cSales = monthSales.filter((s) => s.cabang === cabang); const cExp = monthExpenses.filter((e) => e.cabang === cabang);
      const es = cSales.reduce((a, s) => a + parseFloat(s.jumlah || 0), 0); const cust = new Set(cSales.map((s) => s.customer)).size;
      const pend = cSales.reduce((a, s) => a + s.total, 0); const peng = cExp.reduce((a, e) => a + parseFloat(e.jumlah || 0), 0);
      const laba = pend - peng;
      csv += `"${cabang}",${formatQty(es)},${cust},${pend},${peng},${laba}\n`;
      tEs += es; tCust += cust; tPend += pend; tPeng += peng; tLaba += laba;
    });
    csv += `"TOTAL",${formatQty(tEs)},${tCust},${tPend},${tPeng},${tLaba}\n\nDETAIL PENJUALAN\nTanggal,Cabang,Customer,Jumlah Es,Harga Es (Rp),Ongkir (Rp),Diskon (Rp),Total Harga (Rp)\n`;
    monthSales.sort((a, b) => getSafeDate(a.tanggal).localeCompare(getSafeDate(b.tanggal))).forEach((s) => (csv += `"${formatTanggal(s.tanggal)}","${s.cabang}","${s.customer}",${formatQty(s.jumlah)},${s.hargaEs},${s.ongkir || 0},${s.diskon || 0},${s.total}\n`));
    if (monthExpenses.length > 0) {
      csv += "\nDETAIL PENGELUARAN\nTanggal,Cabang,Kategori,Keterangan,Jumlah (Rp)\n";
      monthExpenses.sort((a, b) => getSafeDate(a.tanggal).localeCompare(getSafeDate(b.tanggal))).forEach((e) => (csv += `"${formatTanggal(e.tanggal)}","${e.cabang}","${e.kategori}","${e.keterangan}",${e.jumlah}\n`));
    }
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" }); const link = document.createElement("a");
    link.href = URL.createObjectURL(blob); link.download = `Laporan_Es_Garuda_${month}.csv`;
    document.body.appendChild(link); link.click(); document.body.removeChild(link);
  };

  const handleDownloadStruk = (item) => {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");

    let height = 430;
    if (parseFloat(item.ongkir) > 0) height += 30;
    if (parseFloat(item.diskon) > 0) height += 30;

    canvas.width = 400;
    canvas.height = height;

    const logo = new Image();
    logo.crossOrigin = "anonymous";
    logo.onload = () => {
      drawStruk();
    };
    logo.onerror = () => {
      drawStruk();
    };
    logo.src = "/logo192.png";

    const drawStruk = () => {
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      ctx.fillStyle = "#000000";

      // Logo hitam putih di atas struk
      if (logo.complete && logo.naturalWidth > 0) {
        const logoSize = 60;
        ctx.save();
        ctx.filter = "grayscale(100%) contrast(1.1)";
        ctx.drawImage(logo, (canvas.width - logoSize) / 2, 15, logoSize, logoSize);
        ctx.restore();
      }

      const topOffset = 65;

      ctx.font = "bold 22px monospace";
      ctx.textAlign = "center";
      ctx.fillText("ES KRISTAL GARUDA", 200, topOffset + 20);

      ctx.font = "14px monospace";
      ctx.fillText(`Cabang: ${item.cabang}`, 200, topOffset + 45);
      ctx.fillText("----------------------------------", 200, topOffset + 65);

      ctx.textAlign = "left";
      ctx.fillText(`Tgl   : ${formatTanggal(item.tanggal)}`, 20, topOffset + 90);
      ctx.fillText(`Plgn  : ${item.customer}`, 20, topOffset + 115);

      ctx.textAlign = "center";
      ctx.fillText("----------------------------------", 200, topOffset + 140);

      ctx.textAlign = "left";
      ctx.fillText("Item", 20, topOffset + 165);
      ctx.textAlign = "right";
      ctx.fillText("Subtotal", 380, topOffset + 165);

      ctx.textAlign = "left";
      ctx.fillText(`Es Kristal (${formatQty(item.jumlah)} Bks)`, 20, topOffset + 195);
      ctx.textAlign = "right";
      ctx.fillText(formatRupiah(item.hargaEs), 380, topOffset + 195);

      let currentY = topOffset + 225;

      if (parseFloat(item.ongkir) > 0) {
        ctx.textAlign = "left";
        ctx.fillText("Ongkos Kirim", 20, currentY);
        ctx.textAlign = "right";
        ctx.fillText(formatRupiah(item.ongkir), 380, currentY);
        currentY += 30;
      }

      if (parseFloat(item.diskon) > 0) {
        ctx.textAlign = "left";
        ctx.fillText("Diskon", 20, currentY);
        ctx.textAlign = "right";
        ctx.fillText(`-${formatRupiah(item.diskon)}`, 380, currentY);
        currentY += 30;
      }

      ctx.textAlign = "center";
      ctx.fillText("----------------------------------", 200, currentY);
      currentY += 30;

      ctx.textAlign = "left";
      ctx.font = "bold 18px monospace";
      ctx.fillText("TOTAL BAYAR", 20, currentY);
      ctx.textAlign = "right";
      ctx.fillText(formatRupiah(item.total), 380, currentY);

      currentY += 40;
      ctx.textAlign = "center";
      ctx.font = "italic 14px monospace";
      ctx.fillText("Hatur Nuhun,", 200, currentY);
      currentY += 20;
      ctx.fillText("Sing Laris Sareng Baroqah Usahana \u{1F64F}", 200, currentY);

      const link = document.createElement("a");
      link.download = `Struk_${(item.customer || "Pelanggan").replace(/\s+/g, '_')}_${item.tanggal}.png`;
      link.href = canvas.toDataURL("image/png");
      link.click();
      showToast("Struk berhasil diunduh!", "success");
    };
  };

  if (!currentUser) return <LoginPage onLogin={setCurrentUser} installPrompt={deferredPrompt ? installPWA : null} isOnline={isOnline} showToast={showToast} />;

  const navItems = isAdmin ? [["kasir", "Kasir"], ["stok", "Stok"], ["laporan", "Laporan"], ["users", "Pengguna"], ["owner", "Kas Owner"]] : [["kasir", "Kasir"], ["stok", "Stok"]];
  const tabBtnClass = (active) => `flex items-center gap-2 px-4 py-3 text-sm font-bold border-b-2 transition ${active ? "border-sky-500 text-sky-600 bg-sky-50" : "border-transparent text-slate-400 hover:text-slate-600 hover:bg-slate-50"}`;
  const inputClass = "w-full border-2 border-slate-200 rounded-xl px-4 py-2.5 text-sm font-medium focus:outline-none focus:ring-4 focus:ring-sky-500/20 focus:border-sky-500 transition-all bg-white";
  const labelClass = "block text-xs font-bold text-slate-500 mb-1.5 uppercase tracking-wide";
  const ownerSubTabClass = (active) => `px-4 py-2.5 rounded-xl text-sm font-bold transition ${active ? "bg-sky-500 text-white shadow-sm" : "bg-white text-slate-500 hover:bg-slate-100 border border-slate-200"}`;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 font-sans selection:bg-sky-200 pb-20">
      <CustomDialog dialog={dialog} closeDialog={closeDialog} />
      {toast.show && (
        <div className={`fixed top-20 right-6 z-[90] px-5 py-3 rounded-xl shadow-2xl text-sm font-bold flex items-center gap-2 animate-in slide-in-from-right-8 duration-300 max-w-sm ${toast.type === "error" ? "bg-red-600 text-white" : toast.type === "success" ? "bg-emerald-600 text-white" : "bg-slate-800 text-white"}`}>
          {toast.type === "error" ? <AlertTriangle className="w-4 h-4 flex-shrink-0" /> : <Info className="w-4 h-4 flex-shrink-0" />} <span>{toast.msg}</span>
        </div>
      )}

      {/* HEADER */}
      <header className="bg-gradient-to-r from-sky-700 to-blue-800 text-white px-4 sm:px-6 py-3 flex items-center justify-between flex-wrap gap-4 shadow-md sticky top-0 z-40 print:hidden">
        <div className="flex items-center gap-3 font-bold text-lg tracking-wide"><div className="bg-white/10 p-1.5 rounded-lg"><img src="/logo192.png" alt="Es Kristal Garuda" className="w-8 h-8 object-contain" /></div> Es Kristal Garuda</div>
        <nav className="flex gap-1.5 bg-white/10 rounded-xl p-1.5 flex-wrap overflow-x-auto">
          {navItems.map(([key, label]) => (
            <button key={key} onClick={() => setTab(key)} className={`px-4 py-2 rounded-lg text-sm font-bold transition whitespace-nowrap ${tab === key ? "bg-white text-sky-700 shadow-sm" : "text-sky-100 hover:bg-white/20"}`}>{label}</button>
          ))}
        </nav>
        <div className="flex items-center gap-2.5 flex-wrap">
          {appLoading && <RefreshCw className="w-4 h-4 text-sky-200 animate-spin" />}
          {isAdmin && (<button onClick={() => setShowSettings(true)} className="flex items-center gap-1.5 bg-white/20 hover:bg-white/30 px-3 py-2 rounded-lg text-sm font-bold"><Settings className="w-4 h-4" /><span className="hidden sm:inline">Seting</span></button>)}
          {isAdmin && (<button onClick={() => setShowExportModal(true)} className="flex items-center gap-1.5 bg-emerald-500 hover:bg-emerald-600 px-4 py-2 rounded-lg text-sm font-bold"><Download className="w-4 h-4" /><span className="hidden sm:inline">CSV</span></button>)}
          <div className="flex items-center gap-2 bg-slate-900/40 rounded-lg px-3 py-2 text-sm"><span className="font-bold">{currentUser.nama}</span><span className="text-[10px] bg-sky-400 text-sky-950 font-bold px-2 py-0.5 rounded-md">{myCabang || "Admin"}</span></div>
          <button onClick={() => setDialog({ show: true, type: "confirm", msg: "Keluar aplikasi?", onConfirm: () => { setCurrentUser(null); closeDialog(); } })} className="bg-red-500 hover:bg-red-600 p-2 rounded-lg"><LogOut className="w-5 h-5" /></button>
        </div>
      </header>

      {/* MAIN CONTENT */}
      <main className="max-w-7xl mx-auto p-4 sm:p-6">
        
        {/* TAB KASIR / DASHBOARD */}
        {tab === "kasir" && (
          <div className="animate-in fade-in duration-500">
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5 mb-6 flex flex-wrap gap-5 items-end">
              <div><label className={labelClass}>Tanggal</label><input type="date" value={filterDate} onChange={(e) => { const v = e.target.value; setFilterDate(v); setSaleForm((prev) => ({ ...prev, tanggal: v })); setExpenseForm((prev) => ({ ...prev, tanggal: v })); }} className={inputClass} /></div>
              <div><label className={labelClass}>Cabang</label>
                {isAdmin ? (
                  <select value={filterCabang} onChange={(e) => { const v = e.target.value; setFilterCabang(v); if (v !== "Semua Cabang") { setSaleForm((prev) => ({ ...prev, cabang: v })); setExpenseForm((prev) => ({ ...prev, cabang: v })); } }} className={`${inputClass} min-w-[150px]`}><option>Semua Cabang</option>{cabangList.map((c) => (<option key={c}>{c}</option>))}</select>
                ) : (<div className={`${inputClass} bg-slate-100 text-slate-500`}>{myCabang}</div>)}
              </div>
              <button onClick={() => loadData()} className="ml-auto bg-sky-100 text-sky-700 hover:bg-sky-200 px-5 py-2.5 rounded-xl font-bold flex items-center gap-2 text-sm">
                <RefreshCw className={`w-4 h-4 ${appLoading ? "animate-spin" : ""}`} /> Refresh Data
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5 mb-8">
              <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm relative overflow-hidden">
                <div className="absolute -right-4 -top-4 opacity-5"><Snowflake className="w-24 h-24" /></div>
                <div className="text-sky-600 text-sm font-bold uppercase mb-3 flex gap-2"><Snowflake className="w-5 h-5" /> Es Terjual</div>
                <p className="text-4xl font-black text-slate-800">{totalEsTerjual} <span className="text-lg text-slate-400">Bks</span></p>
              </div>
              <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm">
                <div className="text-emerald-600 text-sm font-bold uppercase mb-3 flex gap-2"><ArrowDownCircle className="w-5 h-5" /> Pemasukan</div>
                <p className="text-3xl font-black text-slate-800">{formatRupiah(totalPemasukan)}</p>
              </div>
              <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm">
                <div className="text-red-500 text-sm font-bold uppercase mb-3 flex gap-2"><ArrowUpCircle className="w-5 h-5" /> Pengeluaran</div>
                <p className="text-3xl font-black text-slate-800">{formatRupiah(totalPengeluaran)}</p>
              </div>
              <div className="bg-slate-800 rounded-2xl p-5 shadow-lg border border-slate-700 relative overflow-hidden">
                <div className="absolute right-0 top-0 w-32 h-32 bg-sky-500/10 rounded-full blur-2xl"></div>
                <div className="text-sky-400 text-sm font-bold uppercase mb-3 flex gap-2"><Wallet className="w-5 h-5" /> Laba Bersih</div>
                <p className="text-3xl font-black text-white">{formatRupiah(labaBersih)}</p>
              </div>
            </div>

            {isAdmin && (
              <div className="bg-gradient-to-r from-slate-800 to-slate-900 rounded-2xl p-5 mb-8 shadow-lg flex items-center justify-between flex-wrap gap-3">
                <div className="flex items-center gap-3">
                  <div className="bg-sky-500/20 p-2.5 rounded-xl"><Wallet className="w-6 h-6 text-sky-300" /></div>
                  <div>
                    <div className="text-sky-300 text-xs font-bold uppercase">Saldo Rekening (Real-time, Khusus Admin)</div>
                    <p className="text-2xl font-black text-white">{formatRupiah(saldoRekeningOtomatis)}</p>
                  </div>
                </div>
                <span className="text-[11px] text-slate-400">Otomatis dari seluruh Pemasukan - Pengeluaran - Hutang/Piutang Belum Lunas</span>
              </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              <div className="lg:col-span-5 bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                <div className="flex border-b border-slate-200 bg-slate-50">
                  <button onClick={() => { setFormTab("penjualan"); setSaleForm(emptySaleForm); }} className={`flex-1 ${tabBtnClass(formTab === "penjualan")}`}><PlusCircle className="w-4 h-4" /> Jual Es</button>
                  <button onClick={() => { setFormTab("pengeluaran"); setExpenseForm(emptyExpenseForm); setExpensePhotoFile(null); setExpensePhotoPreview(""); }} className={`flex-1 ${tabBtnClass(formTab === "pengeluaran")}`}><MinusCircle className="w-4 h-4" /> Pengeluaran</button>
                </div>
                <div className="p-6">
                  {formTab === "penjualan" ? (
                    <div className="space-y-4">
                      {saleForm.id && (
                        <div className="bg-amber-100 text-amber-800 px-4 py-2 rounded-lg text-sm font-bold flex items-center justify-between">
                          <span>Sedang Mengedit Data...</span>
                          <button onClick={() => setSaleForm(emptySaleForm)} className="text-amber-800 hover:text-red-600"><X className="w-4 h-4"/></button>
                        </div>
                      )}
                      <div className="grid grid-cols-2 gap-4">
                        <div><label className={labelClass}>Tanggal</label><input type="date" value={saleForm.tanggal} onChange={(e) => { const v = e.target.value; setSaleForm({ ...saleForm, tanggal: v }); setFilterDate(v); setExpenseForm((prev) => ({ ...prev, tanggal: v })); }} className={inputClass} /></div>
                        <div><label className={labelClass}>Cabang</label>
                          {isAdmin ? (
                            <select value={saleForm.cabang} onChange={(e) => handleCabangSelect(e.target.value, saleForm, setSaleForm, setFilterCabang)} className={inputClass}>
                              <option value="">Pilih...</option>{cabangList.map((c) => (<option key={c} value={c}>{c}</option>))}<option value="__new__">+ Cabang Baru</option>
                            </select>
                          ) : (<input type="text" value={myCabang} disabled className={`${inputClass} bg-slate-100 text-slate-400`} />)}
                        </div>
                      </div>
                      <div><label className={labelClass}>Customer</label><input type="text" placeholder="Mis: Warung Bu Ani" value={saleForm.customer} onChange={(e) => setSaleForm({ ...saleForm, customer: e.target.value })} className={inputClass} /></div>
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className={labelClass}>Qty (Bks)</label>
                          <input type="number" step="0.01" value={saleForm.jumlah} onChange={(e) => { const v = e.target.value; setSaleForm({ ...saleForm, jumlah: v, hargaEs: v ? hitungHargaEs(v) : "" }); }} className={inputClass} />
                        </div>
                        <div><label className={labelClass}>Harga (Rp)</label><input type="number" value={saleForm.hargaEs} onChange={(e) => setSaleForm({ ...saleForm, hargaEs: e.target.value })} className={inputClass} /></div>
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div><label className={labelClass}>Ongkir (Rp)</label><input type="number" placeholder="0" value={saleForm.ongkir} onChange={(e) => setSaleForm({ ...saleForm, ongkir: e.target.value })} className={inputClass} /></div>
                        <div><label className={labelClass}>Diskon (Rp)</label><input type="number" placeholder="0" value={saleForm.diskon} onChange={(e) => setSaleForm({ ...saleForm, diskon: e.target.value })} className={`${inputClass} text-red-600 focus:border-red-500 focus:ring-red-500/20 border-red-200`} /></div>
                      </div>
                      <div className="bg-sky-50 border-2 border-sky-100 rounded-xl p-4 flex justify-between items-center mt-2">
                        <span className="text-xs font-black text-sky-600 uppercase">Total Bayar</span>
                        <span className="text-2xl font-black text-slate-800">{formatRupiah((parseFloat(saleForm.hargaEs) || 0) + (parseFloat(saleForm.ongkir) || 0) - (parseFloat(saleForm.diskon) || 0))}</span>
                      </div>
                      <button onClick={addSale} className="w-full bg-sky-500 hover:bg-sky-600 text-white font-bold py-3.5 rounded-xl transition-all shadow-lg shadow-sky-500/30">
                        {saleForm.id ? "Update Penjualan" : "Simpan Penjualan"}
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-4">
                       {expenseForm.id && (
                        <div className="bg-amber-100 text-amber-800 px-4 py-2 rounded-lg text-sm font-bold flex items-center justify-between">
                          <span>Sedang Mengedit Data...</span><button onClick={() => { setExpenseForm(emptyExpenseForm); setExpensePhotoFile(null); setExpensePhotoPreview(""); }} className="text-amber-800 hover:text-red-600"><X className="w-4 h-4"/></button>
                        </div>
                      )}
                      <div className="grid grid-cols-2 gap-4">
                        <div><label className={labelClass}>Tanggal</label><input type="date" value={expenseForm.tanggal} onChange={(e) => { const v = e.target.value; setExpenseForm({ ...expenseForm, tanggal: v }); setFilterDate(v); setSaleForm((prev) => ({ ...prev, tanggal: v })); }} className={inputClass} /></div>
                        <div><label className={labelClass}>Cabang</label>
                          {isAdmin ? (
                            <select value={expenseForm.cabang} onChange={(e) => handleCabangSelect(e.target.value, expenseForm, setExpenseForm, setFilterCabang)} className={inputClass}>
                              <option value="">Pilih...</option>{cabangList.map((c) => (<option key={c} value={c}>{c}</option>))}<option value="__new__">+ Cabang Baru</option>
                            </select>
                          ) : (<input value={myCabang} disabled className={`${inputClass} bg-slate-100`} />)}
                        </div>
                      </div>
                      <div><label className={labelClass}>Kategori</label>
                        <select value={expenseForm.kategori} onChange={(e) => handleKategoriSelect(e.target.value, expenseForm, setExpenseForm)} className={inputClass}>
                          <option value="">Pilih...</option>{kategoriList.map((k) => (<option key={k} value={k}>{k}</option>))}<option value="__new__">+ Kategori Baru</option>
                        </select>
                      </div>
                      <div><label className={labelClass}>Nominal (Rp)</label><input type="number" value={expenseForm.jumlah} onChange={(e) => setExpenseForm({ ...expenseForm, jumlah: e.target.value })} className={inputClass} /></div>
                      <div><label className={labelClass}>Keterangan</label><input type="text" value={expenseForm.keterangan} onChange={(e) => setExpenseForm({ ...expenseForm, keterangan: e.target.value })} className={inputClass} /></div>
                      <div>
                        <label className={labelClass}>Foto Bukti <span className="normal-case font-medium text-slate-400">(opsional)</span></label>
                        {(expensePhotoPreview || expenseForm.fotoBukti) ? (
                          <div className="relative w-fit">
                            <img src={expensePhotoPreview || expenseForm.fotoBukti} alt="Bukti pengeluaran" className="h-28 w-28 object-cover rounded-xl border-2 border-slate-200" />
                            <button type="button" onClick={removeExpensePhoto} className="absolute -top-2 -right-2 bg-red-500 hover:bg-red-600 text-white rounded-full p-1 shadow-lg"><X className="w-3.5 h-3.5" /></button>
                          </div>
                        ) : (
                          <label className="flex items-center justify-center gap-2 border-2 border-dashed border-slate-300 rounded-xl h-24 cursor-pointer text-slate-400 hover:border-sky-400 hover:text-sky-500 transition-colors">
                            <Camera className="w-5 h-5" />
                            <span className="text-sm font-semibold">Tap untuk ambil/pilih foto</span>
                            <input type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => handleExpensePhotoSelect(e.target.files?.[0])} />
                          </label>
                        )}
                      </div>
                      <button onClick={addExpense} disabled={isUploadingPhoto} className="w-full bg-red-500 hover:bg-red-600 text-white font-bold py-3.5 rounded-xl transition-all shadow-lg mt-2 disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2">
                         {isUploadingPhoto && <RefreshCw className="w-4 h-4 animate-spin" />}
                         {isUploadingPhoto ? "Mengupload foto..." : (expenseForm.id ? "Update Pengeluaran" : "Simpan Pengeluaran")}
                      </button>
                    </div>
                  )}
                </div>
              </div>

              <div className="lg:col-span-7 bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                <div className="flex border-b border-slate-200 bg-slate-50">
                  <button onClick={() => setHistTab("pemasukan")} className={`flex-1 ${tabBtnClass(histTab === "pemasukan")}`}>Riwayat Masuk</button>
                  <button onClick={() => setHistTab("pengeluaran")} className={`flex-1 ${tabBtnClass(histTab === "pengeluaran")}`}>Riwayat Keluar</button>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm text-left">
                    <thead className="bg-slate-50 border-b border-slate-200">
                      <tr className="text-[11px] uppercase tracking-wider text-slate-500">
                        <th className="px-5 py-3 font-bold">Cabang</th>
                        <th className="px-5 py-3 font-bold">{histTab === "pemasukan" ? "Customer" : "Kategori"}</th>
                        <th className="px-5 py-3 font-bold">{histTab === "pemasukan" ? "Qty" : "Keterangan"}</th>
                        <th className="px-5 py-3 font-bold">Nominal</th>
                        <th className="px-5 py-3"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {(histTab === "pemasukan" ? filteredSales : filteredExpenses).length === 0 && (
                        <tr><td colSpan={5} className="text-center text-slate-400 py-12">Belum ada transaksi hari ini.</td></tr>
                      )}
                      {(histTab === "pemasukan" ? filteredSales : filteredExpenses).map((item) => (
                        <tr key={item.id} className="hover:bg-slate-50">
                          <td className="px-5 py-4 font-bold text-sky-600">{item.cabang}</td>
                          <td className="px-5 py-4 font-medium">
                            {histTab === "pemasukan" ? item.customer : item.kategori}
                            {histTab === "pemasukan" && item.diskon > 0 && <div className="text-[10px] text-red-500 bg-red-50 px-1.5 py-0.5 rounded inline-block mt-1">Diskon: {formatRupiah(item.diskon)}</div>}
                          </td>
                          <td className="px-5 py-4 text-slate-600">
                            {histTab === "pemasukan" ? (<span className="bg-slate-100 px-2 py-1 rounded font-mono">{formatQty(item.jumlah)}</span>) : (
                              <div className="flex items-center gap-2">
                                <span>{item.keterangan}</span>
                                {item.fotoBukti && (
                                  <a href={item.fotoBukti} target="_blank" rel="noopener noreferrer" title="Lihat foto bukti" className="text-sky-500 hover:text-sky-700 flex-shrink-0">
                                    <Camera className="w-4 h-4" />
                                  </a>
                                )}
                              </div>
                            )}
                          </td>
                          <td className={`px-5 py-4 font-black ${histTab === "pemasukan" ? "text-emerald-600" : "text-red-500"}`}>
                            {formatRupiah(histTab === "pemasukan" ? item.total : item.jumlah)}
                          </td>
                          <td className="px-5 py-4 text-right">
                            {(isAdmin || item.cabang === myCabang) && (
                              <div className="flex justify-end gap-1.5">
                                {histTab === "pemasukan" && (
                                  <button onClick={() => handleDownloadStruk(item)} title="Cetak Struk" className="p-1.5 hover:bg-emerald-50 rounded-lg text-slate-400 hover:text-emerald-600">
                                    <Printer className="w-4 h-4" />
                                  </button>
                                )}
                                <button onClick={() => { if (histTab === "pemasukan") { editSale(item); } else { setExpenseForm({ ...item, fotoBukti: item.fotoBukti || "" }); setExpensePhotoFile(null); setExpensePhotoPreview(""); setFormTab("pengeluaran"); } }} className="p-1.5 hover:bg-sky-50 rounded-lg text-slate-400 hover:text-sky-600">
                                  <Pencil className="w-4 h-4" />
                                </button>
                                <button onClick={() => confirmDeleteData(histTab === "pemasukan" ? "Sales" : "Expenses", item.id)} className="p-1.5 hover:bg-red-50 rounded-lg text-slate-400 hover:text-red-500">
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </div>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB STOK */}
        {tab === "stok" && (
          <div className="animate-in fade-in duration-500">
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5 mb-6 flex flex-wrap gap-5 print:hidden">
              <div><label className={labelClass}>Tanggal Data</label><input type="date" value={stockFilterDate} onChange={(e) => { const v = e.target.value; setStockFilterDate(v); setStockForm((prev) => ({ ...prev, tanggal: v })); }} className={inputClass} /></div>
              <div><label className={labelClass}>Cabang Aktif</label>
                {isAdmin ? (
                  <select value={stockFilterCabang} onChange={(e) => { const v = e.target.value; setStockFilterCabang(v); if (v !== "Semua Cabang") setStockForm((prev) => ({ ...prev, cabang: v })); }} className={`${inputClass} min-w-[200px]`}>
                    <option>Semua Cabang</option>{cabangList.map((c) => (<option key={c}>{c}</option>))}
                  </select>
                ) : (<div className="border-2 border-slate-200 bg-slate-100 rounded-xl px-4 py-2.5 text-sm font-bold text-slate-500">{myCabang}</div>)}
              </div>
              <button onClick={() => window.print()} className="ml-auto bg-slate-800 text-white px-5 rounded-xl text-sm font-bold flex items-center gap-2"><Printer className="w-4 h-4" /> Cetak</button>
            </div>

            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 mb-8 relative overflow-hidden">
              <div className="absolute top-0 left-0 w-1.5 h-full bg-sky-500"></div>
              <div className="flex items-center gap-2 font-black text-slate-800 text-lg mb-5 flex-wrap">
                <PackageSearch className="w-6 h-6 text-sky-500" /> Input Opname Stok 
                {stockForm.id && <span className="text-xs bg-amber-100 text-amber-800 px-3 py-1 rounded-full font-bold flex items-center gap-2 ml-2">Mode Edit <button onClick={()=>setStockForm(emptyStockForm)}><X className="w-3 h-3 hover:text-red-500"/></button></span>}
              </div>
              <div className="grid grid-cols-1 md:grid-cols-5 gap-5 items-end">
                <div><label className={labelClass}>Tanggal</label><input type="date" value={stockForm.tanggal} onChange={(e) => { const v = e.target.value; setStockForm({ ...stockForm, tanggal: v }); setStockFilterDate(v); }} className={inputClass} /></div>
                <div><label className={labelClass}>Cabang</label>
                  {isAdmin ? (
                    <select value={stockForm.cabang} onChange={(e) => handleCabangSelect(e.target.value, stockForm, setStockForm, setStockFilterCabang)} className={inputClass}>
                      <option value="">Pilih...</option>{cabangList.map((c) => (<option key={c} value={c}>{c}</option>))}<option value="__new__">+ Baru</option>
                    </select>
                  ) : (<input value={myCabang} disabled className={`${inputClass} bg-slate-100`} />)}
                </div>
                <div><label className={labelClass}>Es Masuk (Hari Ini)</label><input type="number" step="0.01" value={stockForm.esMasukHariIni} onChange={(e) => setStockForm({ ...stockForm, esMasukHariIni: e.target.value })} className={inputClass} /></div>
                <div><label className={labelClass}>Sisa Aktual (Fisik)</label><input type="number" step="0.01" value={stockForm.sisaEsActual} onChange={(e) => setStockForm({ ...stockForm, sisaEsActual: e.target.value })} className={inputClass} /></div>
                <button onClick={addStock} className="w-full bg-sky-500 hover:bg-sky-600 text-white font-bold py-3 rounded-xl">{stockForm.id ? "Update Stok" : "Simpan Stok"}</button>
              </div>
            </div>

            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
              <div className="p-5 border-b border-slate-200 bg-slate-50"><h3 className="font-black text-lg">Rekonsiliasi Stok & Susut</h3></div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-left">
                  <thead className="bg-slate-100 border-b border-slate-200">
                    <tr className="text-[11px] uppercase tracking-wider text-slate-600">
                      <th className="px-4 py-3">Tanggal</th><th className="px-4 py-3">Cabang</th><th className="px-4 py-3">Sisa Kemarin</th><th className="px-4 py-3 text-sky-700">Masuk Hr Ini</th>
                      <th className="px-4 py-3">Jmlh Masuk</th><th className="px-4 py-3">Terjual</th><th className="px-4 py-3 bg-slate-200/50">Sisa Sistem</th>
                      <th className="px-4 py-3 text-sky-700">Sisa Aktual</th><th className="px-4 py-3">Susut</th><th className="px-4 py-3"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredStock.map((r) => (
                      <tr key={r.id} className="hover:bg-slate-50">
                        <td className="px-4 py-3 text-slate-600">{formatTanggal(r.tanggal)}</td>
                        <td className="px-4 py-3 font-bold text-sky-600">{r.cabang}</td>
                        <td className="px-4 py-3">{formatQty(r.sisaKemarin)}</td>
                        <td className="px-4 py-3 font-bold text-sky-600 bg-sky-50/30">{formatQty(r.esMasukHariIni)}</td>
                        <td className="px-4 py-3">{formatQty(r.jumlahEsMasuk)}</td>
                        <td className="px-4 py-3">{formatQty(r.terjual)}</td>
                        <td className="px-4 py-3 font-black bg-slate-50">{formatQty(r.sisaSistem)}</td>
                        <td className="px-4 py-3 font-black text-sky-600">{formatQty(r.sisaActual)}</td>
                        <td className="px-4 py-3">
                          <span className={`px-2 py-1 rounded text-xs font-bold ${r.susut > 0 ? "bg-red-100 text-red-700" : r.susut < 0 ? "bg-emerald-100 text-emerald-700" : "bg-slate-100"}`}>
                            {r.susut > 0 ? "+" : ""}{formatQty(r.susut)}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right flex justify-end gap-1.5">
                          {(isAdmin || r.cabang === myCabang) && (
                            <>
                              <button onClick={() => editStock(r)} className="p-1 hover:bg-sky-50 rounded text-slate-300 hover:text-sky-600"><Pencil className="w-4 h-4" /></button>
                              <button onClick={() => confirmDeleteData("Stocks", r.id)} className="p-1 hover:bg-red-50 rounded text-slate-300 hover:text-red-500"><Trash2 className="w-4 h-4" /></button>
                            </>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* TAB LAPORAN - HANYA ADMIN */}
        {tab === "laporan" && isAdmin && (
          <div className="animate-in fade-in duration-500">
            <div className="bg-gradient-to-r from-slate-800 to-slate-900 rounded-2xl p-5 mb-6 shadow-lg flex items-center justify-between flex-wrap gap-3">
              <div className="flex items-center gap-3">
                <div className="bg-sky-500/20 p-2.5 rounded-xl"><Wallet className="w-6 h-6 text-sky-300" /></div>
                <div>
                  <div className="text-sky-300 text-xs font-bold uppercase">Saldo Rekening (Real-time)</div>
                  <p className="text-2xl font-black text-white">{formatRupiah(saldoRekeningOtomatis)}</p>
                </div>
              </div>
            </div>
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5 mb-6 flex flex-wrap gap-5">
              <div><label className={labelClass}>Bulan</label><input type="month" value={reportMonth} onChange={(e) => setReportMonth(e.target.value)} className={inputClass} /></div>
              <button onClick={() => window.print()} className="ml-auto mt-auto bg-slate-800 text-white px-5 py-2.5 rounded-xl text-sm font-bold flex gap-2"><Printer className="w-4 h-4" /> Cetak PDF</button>
            </div>
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden mb-6">
              <div className="p-5 border-b border-slate-200 bg-slate-50"><h3 className="font-black text-lg">Ringkasan Omset - {reportMonth}</h3></div>
              <table className="w-full text-sm text-left">
                <thead className="bg-slate-100 border-b border-slate-200">
                  <tr className="text-[11px] uppercase text-slate-500"><th className="px-5 py-3">Cabang</th><th className="px-5 py-3">Es Terjual</th><th className="px-5 py-3">Customer</th><th className="px-5 py-3">Pendapatan</th></tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {monthlySummary.map((r) => (
                    <tr key={r.cabang}>
                      <td className="px-5 py-3 font-bold text-sky-600">{r.cabang}</td>
                      <td className="px-5 py-3">{r.esTerjual}</td><td className="px-5 py-3">{r.customer}</td>
                      <td className="px-5 py-3 font-black text-emerald-600">{formatRupiah(r.pendapatan)}</td>
                    </tr>
                  ))}
                  <tr className="bg-slate-800 text-white font-black">
                    <td className="px-5 py-3">TOTAL</td><td className="px-5 py-3">{totalRingkasan.esTerjual}</td><td className="px-5 py-3">{totalRingkasan.customer}</td><td className="px-5 py-3 text-emerald-400">{formatRupiah(totalRingkasan.pendapatan)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        )}

        {tab === "users" && isAdmin && (
          <div className="animate-in fade-in duration-500">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-xl font-black text-slate-800">Manajemen Pengguna</h2>
              <button onClick={() => { setEditingUser(null); setShowUserModal(true); }} className="flex items-center gap-2 bg-sky-500 hover:bg-sky-600 text-white px-5 py-2.5 rounded-xl text-sm font-bold"><PlusCircle className="w-4 h-4" /> Tambah Akun</button>
            </div>
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
              <table className="w-full text-sm text-left">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr className="text-[11px] uppercase text-slate-500"><th className="px-5 py-3">Nama</th><th className="px-5 py-3">Username</th><th className="px-5 py-3">Role</th><th className="px-5 py-3">Cabang</th><th className="px-5 py-3"></th></tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {users.map((u) => (
                    <tr key={u.id}>
                      <td className="px-5 py-4 font-bold">{u.nama}</td><td className="px-5 py-4 text-slate-500">@{u.username}</td>
                      <td className="px-5 py-4"><span className={`px-2 py-1 rounded text-[10px] font-bold uppercase ${u.role === "admin" ? "bg-emerald-100 text-emerald-700" : "bg-sky-100 text-sky-700"}`}>{u.role}</span></td>
                      <td className="px-5 py-4">{u.role === "admin" ? "-" : u.cabang}</td>
                      <td className="px-5 py-4 text-right">
                        <button onClick={() => { setEditingUser(u); setShowUserModal(true); }} className="p-1.5 text-slate-400 hover:text-sky-600"><Pencil className="w-4 h-4" /></button>{" "}
                        <button onClick={() => removeUser(u.id)} className="p-1.5 text-slate-400 hover:text-red-500"><Trash2 className="w-4 h-4" /></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* TAB KAS OWNER - HANYA ADMIN */}
        {tab === "owner" && isAdmin && (
          <div className="animate-in fade-in duration-500">
            <div className="bg-amber-50 border-2 border-amber-200 rounded-2xl p-4 mb-6 flex items-center gap-3">
              <ShieldCheck className="w-6 h-6 text-amber-600 flex-shrink-0" />
              <p className="text-sm text-amber-800 font-semibold">Halaman ini rahasia - hanya Super Admin yang bisa melihat. Data tidak pernah dikirim ke akun Pegawai.</p>
            </div>

            <div className="flex gap-2 mb-6 flex-wrap">
              <button onClick={() => setOwnerSubTab("ringkasan")} className={ownerSubTabClass(ownerSubTab === "ringkasan")}>Ringkasan & Saldo</button>
              <button onClick={() => setOwnerSubTab("aruskas")} className={ownerSubTabClass(ownerSubTab === "aruskas")}>Arus Kas</button>
              <button onClick={() => setOwnerSubTab("hutangpiutang")} className={ownerSubTabClass(ownerSubTab === "hutangpiutang")}>Hutang Piutang</button>
            </div>

            {/* SUB TAB: RINGKASAN & SALDO */}
            {ownerSubTab === "ringkasan" && (
              <div className="animate-in fade-in duration-300">
                <div className="bg-slate-800 rounded-2xl p-6 shadow-lg mb-6 relative overflow-hidden">
                  <div className="absolute right-0 top-0 w-40 h-40 bg-sky-500/10 rounded-full blur-2xl"></div>
                  <div className="text-sky-400 text-sm font-bold uppercase mb-2 flex items-center gap-2"><Wallet className="w-5 h-5" /> Saldo Rekening Bank Saat Ini (Real-time)</div>
                  <p className="text-4xl font-black text-white mb-4">{formatRupiah(saldoRekeningOtomatis)}</p>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                    <div className="bg-white/10 rounded-xl p-3">
                      <div className="text-emerald-300 font-bold uppercase mb-1">Total Pemasukan</div>
                      <div className="text-white font-black text-base">{formatRupiah(totalPemasukanSemua)}</div>
                    </div>
                    <div className="bg-white/10 rounded-xl p-3">
                      <div className="text-red-300 font-bold uppercase mb-1">Total Pengeluaran</div>
                      <div className="text-white font-black text-base">{formatRupiah(totalPengeluaranSemua)}</div>
                    </div>
                    <div className="bg-white/10 rounded-xl p-3">
                      <div className="text-amber-300 font-bold uppercase mb-1">Hutang/Piutang Belum Lunas</div>
                      <div className="text-white font-black text-base">{formatRupiah(totalHutangPiutangBelumLunas)}</div>
                    </div>
                  </div>
                  <p className="text-[11px] text-slate-400 mt-4">Saldo dihitung otomatis dan real-time dari seluruh Penjualan, Pengeluaran, Arus Kas, dan Hutang/Piutang. Tidak perlu refresh halaman.</p>
                </div>

                <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5 mb-6 flex flex-wrap gap-5 items-end">
                  <div><label className={labelClass}>Bulan Laporan Laba Riil</label><input type="month" value={ownerReportMonth} onChange={(e) => setOwnerReportMonth(e.target.value)} className={inputClass} /></div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 mb-6">
                  <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm">
                    <div className="text-sky-600 text-sm font-bold uppercase mb-3">Laba Kotor (Sebelum Gaji/Arus Kas)</div>
                    <p className="text-3xl font-black text-slate-800">{formatRupiah(totalLabaKotorSemua)}</p>
                  </div>
                  <div className="bg-slate-800 rounded-2xl p-5 shadow-lg">
                    <div className="text-sky-400 text-sm font-bold uppercase mb-3">Laba Bersih Riil (Semua Depot)</div>
                    <p className="text-3xl font-black text-white">{formatRupiah(totalLabaRiilSemua)}</p>
                  </div>
                </div>

                <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden mb-6">
                  <div className="p-5 border-b border-slate-200 bg-slate-50"><h3 className="font-black text-lg">Laba Bersih Riil per Depot - {ownerReportMonth}</h3></div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm text-left">
                      <thead className="bg-slate-100 border-b border-slate-200">
                        <tr className="text-[11px] uppercase text-slate-600">
                          <th className="px-4 py-3">Cabang</th>
                          <th className="px-4 py-3">Pemasukan</th>
                          <th className="px-4 py-3">Peng. Pegawai</th>
                          <th className="px-4 py-3 bg-slate-200/50">Laba Kotor</th>
                          <th className="px-4 py-3 text-red-600">Pengeluaran Kas</th>
                          <th className="px-4 py-3 text-emerald-600">Pemasukan Kas</th>
                          <th className="px-4 py-3 font-black">Laba Riil</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {realProfitByCabang.map((r) => (
                          <tr key={r.cabang} className="hover:bg-slate-50">
                            <td className="px-4 py-3 font-bold text-sky-600">{r.cabang}</td>
                            <td className="px-4 py-3">{formatRupiah(r.pemasukan)}</td>
                            <td className="px-4 py-3 text-red-500">{formatRupiah(r.pengeluaranPegawai)}</td>
                            <td className="px-4 py-3 font-bold bg-slate-50">{formatRupiah(r.labaKotor)}</td>
                            <td className="px-4 py-3 text-red-600">{formatRupiah(r.kasKeluar)}</td>
                            <td className="px-4 py-3 text-emerald-600">{formatRupiah(r.kasMasuk)}</td>
                            <td className="px-4 py-3 font-black text-slate-800">{formatRupiah(r.labaRiil)}</td>
                          </tr>
                        ))}
                        {(generalKasKeluar > 0 || generalKasMasuk > 0) && (
                          <tr className="bg-amber-50">
                            <td className="px-4 py-3 font-bold text-amber-700" colSpan={4}>Biaya Umum (Semua Cabang)</td>
                            <td className="px-4 py-3 text-red-600">{formatRupiah(generalKasKeluar)}</td>
                            <td className="px-4 py-3 text-emerald-600">{formatRupiah(generalKasMasuk)}</td>
                            <td className="px-4 py-3 font-black">{formatRupiah(generalKasMasuk - generalKasKeluar)}</td>
                          </tr>
                        )}
                        <tr className="bg-slate-800 text-white font-black">
                          <td className="px-4 py-3" colSpan={3}>TOTAL SEMUA DEPOT</td>
                          <td className="px-4 py-3">{formatRupiah(totalLabaKotorSemua)}</td>
                          <td className="px-4 py-3" colSpan={2}></td>
                          <td className="px-4 py-3 text-sky-300">{formatRupiah(totalLabaRiilSemua)}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}

            {/* SUB TAB: ARUS KAS */}
            {ownerSubTab === "aruskas" && (
              <div className="animate-in fade-in duration-300">
                <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 mb-6">
                  <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
                    <h3 className="font-black text-lg">Catat Arus Kas</h3>
                    <button onClick={exportOwnerNotesCSV} className="flex items-center gap-2 bg-emerald-500 hover:bg-emerald-600 text-white px-4 py-2 rounded-xl text-xs font-bold"><FileSpreadsheet className="w-4 h-4" /> Export Excel</button>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-4 items-end">
                    <div><label className={labelClass}>Tanggal</label><input type="date" value={ownerForm.tanggal} onChange={(e) => setOwnerForm({ ...ownerForm, tanggal: e.target.value })} className={inputClass} /></div>
                    <div><label className={labelClass}>Depot Terkait</label>
                      <select value={ownerForm.cabang} onChange={(e) => setOwnerForm({ ...ownerForm, cabang: e.target.value })} className={inputClass}>
                        <option value="Semua Cabang">Semua Cabang (Umum)</option>
                        {cabangList.map((c) => (<option key={c} value={c}>{c}</option>))}
                      </select>
                    </div>
                    <div><label className={labelClass}>Jenis</label>
                      <select value={ownerForm.jenis} onChange={(e) => setOwnerForm({ ...ownerForm, jenis: e.target.value, kategori: "" })} className={inputClass}>
                        <option value="keluar">- Kurangi (Pengeluaran Kas)</option>
                        <option value="masuk">+ Tambah (Pemasukan Kas)</option>
                      </select>
                    </div>
                    <div><label className={labelClass}>Kategori</label>
                      <select value={ownerForm.kategori} onChange={(e) => setOwnerForm({ ...ownerForm, kategori: e.target.value })} className={inputClass}>
                        <option value="">Pilih Kategori...</option>
                        {(ownerForm.jenis === "masuk" ? KATEGORI_PEMASUKAN_OWNER : KATEGORI_PENGELUARAN_OWNER).map((k) => (<option key={k} value={k}>{k}</option>))}
                      </select>
                    </div>
                    <div><label className={labelClass}>Jumlah (Rp)</label><input type="number" value={ownerForm.jumlah} onChange={(e) => setOwnerForm({ ...ownerForm, jumlah: e.target.value })} className={inputClass} /></div>
                    <button onClick={addOwnerNote} className="w-full bg-slate-800 hover:bg-slate-900 text-white font-bold py-3 rounded-xl">{ownerForm.id ? "Update" : "Simpan"}</button>
                  </div>
                  <div className="mt-4"><label className={labelClass}>Keterangan</label><input type="text" placeholder="Mis: Gaji Karyawan Depot Limbangan Bulan Juli" value={ownerForm.keterangan} onChange={(e) => setOwnerForm({ ...ownerForm, keterangan: e.target.value })} className={inputClass} /></div>
                  {ownerForm.id && (
                    <button onClick={() => setOwnerForm(emptyOwnerForm)} className="mt-3 text-xs font-bold text-slate-400 hover:text-red-500">Batal edit, buat catatan baru</button>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 mb-6">
                  <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm">
                    <div className="text-emerald-600 text-sm font-bold uppercase mb-3">Total Pemasukan (Sesuai Filter)</div>
                    <p className="text-3xl font-black text-slate-800">{formatRupiah(filteredOwnerMasuk)}</p>
                  </div>
                  <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm">
                    <div className="text-red-500 text-sm font-bold uppercase mb-3">Total Pengeluaran (Sesuai Filter)</div>
                    <p className="text-3xl font-black text-slate-800">{formatRupiah(filteredOwnerKeluar)}</p>
                  </div>
                </div>

                <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                  <div className="p-5 border-b border-slate-200 bg-slate-50 flex flex-wrap gap-4 items-end justify-between">
                    <h3 className="font-black text-lg">Riwayat Arus Kas</h3>
                    <div className="flex flex-wrap gap-3">
                      <div><label className="block text-[10px] font-bold text-slate-500 mb-1 uppercase">Tanggal</label><input type="date" value={ownerFilterDate} onChange={(e) => setOwnerFilterDate(e.target.value)} className="border-2 border-slate-200 rounded-lg px-3 py-1.5 text-xs font-medium" /></div>
                      <div><label className="block text-[10px] font-bold text-slate-500 mb-1 uppercase">Depot</label>
                        <select value={ownerFilterCabang} onChange={(e) => setOwnerFilterCabang(e.target.value)} className="border-2 border-slate-200 rounded-lg px-3 py-1.5 text-xs font-medium">
                          <option>Semua Cabang</option>{cabangList.map((c) => (<option key={c}>{c}</option>))}
                        </select>
                      </div>
                      <div><label className="block text-[10px] font-bold text-slate-500 mb-1 uppercase">Jenis</label>
                        <select value={ownerFilterJenis} onChange={(e) => setOwnerFilterJenis(e.target.value)} className="border-2 border-slate-200 rounded-lg px-3 py-1.5 text-xs font-medium">
                          <option value="semua">Semua</option><option value="masuk">Pemasukan</option><option value="keluar">Pengeluaran</option>
                        </select>
                      </div>
                      {(ownerFilterDate || ownerFilterCabang !== "Semua Cabang" || ownerFilterJenis !== "semua") && (
                        <button onClick={() => { setOwnerFilterDate(""); setOwnerFilterCabang("Semua Cabang"); setOwnerFilterJenis("semua"); }} className="self-end text-xs font-bold text-slate-400 hover:text-red-500 px-2 py-1.5">Reset</button>
                      )}
                    </div>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm text-left">
                      <thead className="bg-slate-50 border-b border-slate-200">
                        <tr className="text-[11px] uppercase tracking-wider text-slate-500">
                          <th className="px-5 py-3 font-bold">Tanggal</th>
                          <th className="px-5 py-3 font-bold">Depot</th>
                          <th className="px-5 py-3 font-bold">Keterangan</th>
                          <th className="px-5 py-3 font-bold">Jenis</th>
                          <th className="px-5 py-3 font-bold">Kategori</th>
                          <th className="px-5 py-3 font-bold">Jumlah</th>
                          <th className="px-5 py-3"></th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {filteredOwnerNotes.length === 0 && (
                          <tr><td colSpan={7} className="text-center text-slate-400 py-12">Tidak ada catatan sesuai filter.</td></tr>
                        )}
                        {filteredOwnerNotes.slice().sort((a,b)=>getSafeDate(b.tanggal).localeCompare(getSafeDate(a.tanggal))).map((n) => (
                          <tr key={n.id} className="hover:bg-slate-50">
                            <td className="px-5 py-4 text-slate-600">{formatTanggal(n.tanggal)}</td>
                            <td className="px-5 py-4 font-bold text-sky-600">{n.cabang || "Semua Cabang"}</td>
                            <td className="px-5 py-4 font-medium">{n.keterangan}</td>
                            <td className="px-5 py-4">
                              <span className={`px-2 py-1 rounded text-[10px] font-bold uppercase ${n.jenis === "masuk" ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"}`}>{n.jenis === "masuk" ? "Pemasukan" : "Pengeluaran"}</span>
                            </td>
                            <td className="px-5 py-4 text-slate-600">{n.kategori || "-"}</td>
                            <td className={`px-5 py-4 font-black ${n.jenis === "masuk" ? "text-emerald-600" : "text-red-500"}`}>{formatRupiah(n.jumlah)}</td>
                            <td className="px-5 py-4 text-right">
                              <button onClick={() => setOwnerForm({ ...n, tanggal: getSafeDate(n.tanggal) })} className="p-1.5 hover:bg-sky-50 rounded-lg text-slate-400 hover:text-sky-600"><Pencil className="w-4 h-4" /></button>
                              <button onClick={() => removeOwnerNote(n.id)} className="p-1.5 hover:bg-red-50 rounded-lg text-slate-400 hover:text-red-500"><Trash2 className="w-4 h-4" /></button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}

            {/* SUB TAB: HUTANG PIUTANG */}
            {ownerSubTab === "hutangpiutang" && (
              <div className="animate-in fade-in duration-300">
                <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 mb-6">
                  <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
                    <h3 className="font-black text-lg">Catat Hutang / Piutang</h3>
                    <div className="flex gap-2">
                      <button onClick={exportHutangCSV} className="flex items-center gap-2 bg-emerald-500 hover:bg-emerald-600 text-white px-4 py-2 rounded-xl text-xs font-bold"><FileSpreadsheet className="w-4 h-4" /> Export Excel</button>
                      <button onClick={() => window.print()} className="flex items-center gap-2 bg-slate-800 hover:bg-slate-900 text-white px-4 py-2 rounded-xl text-xs font-bold"><Printer className="w-4 h-4" /> Cetak</button>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-4 items-end">
                    <div><label className={labelClass}>Nama</label><input type="text" placeholder="Nama orang/pihak" value={hutangForm.nama} onChange={(e) => setHutangForm({ ...hutangForm, nama: e.target.value })} className={inputClass} /></div>
                    <div><label className={labelClass}>Jenis</label>
                      <select value={hutangForm.jenis} onChange={(e) => setHutangForm({ ...hutangForm, jenis: e.target.value })} className={inputClass}>
                        <option value="Hutang">Hutang</option>
                        <option value="Piutang">Piutang</option>
                      </select>
                    </div>
                    <div><label className={labelClass}>Jumlah (Rp)</label><input type="number" value={hutangForm.jumlah} onChange={(e) => setHutangForm({ ...hutangForm, jumlah: e.target.value })} className={inputClass} /></div>
                    <div><label className={labelClass}>Tanggal</label><input type="date" value={hutangForm.tanggal} onChange={(e) => setHutangForm({ ...hutangForm, tanggal: e.target.value })} className={inputClass} /></div>
                    <div><label className={labelClass}>Status</label>
                      <select value={hutangForm.status} onChange={(e) => setHutangForm({ ...hutangForm, status: e.target.value })} className={inputClass}>
                        <option value="Belum Lunas">Belum Lunas</option>
                        <option value="Lunas">Lunas</option>
                      </select>
                    </div>
                    <button onClick={addHutang} className="w-full bg-slate-800 hover:bg-slate-900 text-white font-bold py-3 rounded-xl">{hutangForm.id ? "Update" : "Simpan"}</button>
                  </div>
                  <div className="mt-4"><label className={labelClass}>Keterangan</label><input type="text" placeholder="Catatan tambahan" value={hutangForm.keterangan} onChange={(e) => setHutangForm({ ...hutangForm, keterangan: e.target.value })} className={inputClass} /></div>
                  {hutangForm.id && (
                    <button onClick={() => setHutangForm(emptyHutangForm)} className="mt-3 text-xs font-bold text-slate-400 hover:text-red-500">Batal edit, buat data baru</button>
                  )}
                </div>

                <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                  <div className="p-5 border-b border-slate-200 bg-slate-50 flex flex-wrap gap-4 items-end justify-between">
                    <h3 className="font-black text-lg">Daftar Hutang & Piutang</h3>
                    <div className="flex flex-wrap gap-3">
                      <div className="relative">
                        <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                        <input type="text" placeholder="Cari nama..." value={hutangSearch} onChange={(e) => setHutangSearch(e.target.value)} className="border-2 border-slate-200 rounded-lg pl-8 pr-3 py-1.5 text-xs font-medium" />
                      </div>
                      <select value={hutangFilterStatus} onChange={(e) => setHutangFilterStatus(e.target.value)} className="border-2 border-slate-200 rounded-lg px-3 py-1.5 text-xs font-medium">
                        <option value="Semua">Semua Status</option>
                        <option value="Belum Lunas">Belum Lunas</option>
                        <option value="Lunas">Lunas</option>
                      </select>
                      <input type="date" value={hutangFilterDateFrom} onChange={(e) => setHutangFilterDateFrom(e.target.value)} className="border-2 border-slate-200 rounded-lg px-3 py-1.5 text-xs font-medium" title="Dari tanggal" />
                      <input type="date" value={hutangFilterDateTo} onChange={(e) => setHutangFilterDateTo(e.target.value)} className="border-2 border-slate-200 rounded-lg px-3 py-1.5 text-xs font-medium" title="Sampai tanggal" />
                    </div>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm text-left">
                      <thead className="bg-slate-50 border-b border-slate-200">
                        <tr className="text-[11px] uppercase tracking-wider text-slate-500">
                          <th className="px-5 py-3 font-bold">Nama</th>
                          <th className="px-5 py-3 font-bold">Jenis</th>
                          <th className="px-5 py-3 font-bold">Tanggal</th>
                          <th className="px-5 py-3 font-bold">Keterangan</th>
                          <th className="px-5 py-3 font-bold">Jumlah</th>
                          <th className="px-5 py-3 font-bold">Status</th>
                          <th className="px-5 py-3"></th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {filteredHutangPiutang.length === 0 && (
                          <tr><td colSpan={7} className="text-center text-slate-400 py-12">Tidak ada data.</td></tr>
                        )}
                        {filteredHutangPiutang.slice().sort((a,b)=>getSafeDate(b.tanggal).localeCompare(getSafeDate(a.tanggal))).map((h) => (
                          <tr key={h.id} className="hover:bg-slate-50">
                            <td className="px-5 py-4 font-bold text-slate-800">{h.nama}</td>
                            <td className="px-5 py-4">
                              <span className={`px-2 py-1 rounded text-[10px] font-bold uppercase ${h.jenis === "Piutang" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>{h.jenis}</span>
                            </td>
                            <td className="px-5 py-4 text-slate-600">{formatTanggal(h.tanggal)}</td>
                            <td className="px-5 py-4 text-slate-600">{h.keterangan}</td>
                            <td className="px-5 py-4 font-black text-slate-800">{formatRupiah(h.jumlah)}</td>
                            <td className="px-5 py-4">
                              <button onClick={() => toggleHutangStatus(h)} className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase flex items-center gap-1.5 w-fit ${h.status === "Lunas" ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"}`}>
                                <span className={`w-2 h-2 rounded-full ${h.status === "Lunas" ? "bg-emerald-500" : "bg-red-500"}`}></span>
                                {h.status}
                              </button>
                            </td>
                            <td className="px-5 py-4 text-right">
                              <button onClick={() => editHutang(h)} className="p-1.5 hover:bg-sky-50 rounded-lg text-slate-400 hover:text-sky-600"><Pencil className="w-4 h-4" /></button>
                              <button onClick={() => removeHutang(h.id)} className="p-1.5 hover:bg-red-50 rounded-lg text-slate-400 hover:text-red-500"><Trash2 className="w-4 h-4" /></button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </main>

      {/* MODALS */}
      {showSettings && (
        <div className="fixed inset-0 bg-slate-900/60 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
            <div className="flex justify-between items-center p-5 border-b border-slate-100 bg-slate-50"><h3 className="font-black text-lg">Pengaturan Data</h3><button onClick={() => setShowSettings(false)} className="p-1 hover:bg-slate-200 rounded-full"><X className="w-5 h-5 text-slate-500" /></button></div>
            <div className="flex border-b border-slate-200">
              <button onClick={() => setSettingsTab("cabang")} className={`flex-1 py-3 text-sm font-bold border-b-2 ${settingsTab === "cabang" ? "border-sky-500 text-sky-600" : "border-transparent text-slate-500"}`}>Cabang</button>
              <button onClick={() => setSettingsTab("kategori")} className={`flex-1 py-3 text-sm font-bold border-b-2 ${settingsTab === "kategori" ? "border-sky-500 text-sky-600" : "border-transparent text-slate-500"}`}>Kategori</button>
            </div>
            <div className="p-6 max-h-[60vh] overflow-y-auto">
              {settingsTab === "cabang" ? (
                <div>
                  <div className="flex gap-2 mb-5"><input value={newCabang} onChange={(e) => setNewCabang(e.target.value)} placeholder="Cabang Baru" className={inputClass} /><button onClick={() => { if (newCabang.trim()) { setCabangList((p) => [...p, newCabang.trim()]); setNewCabang(""); } }} className="bg-slate-800 text-white px-5 rounded-xl font-bold">Tambah</button></div>
                  <div className="space-y-2">
                    {cabangList.map((c) => (
                      <div key={c} className="flex justify-between bg-slate-50 border border-slate-100 rounded-xl px-4 py-3"><span className="font-semibold">{c}</span><button onClick={() => setCabangList(cabangList.filter((x) => x !== c))} className="text-slate-400 hover:text-red-500"><Trash2 className="w-4 h-4" /></button></div>
                    ))}
                  </div>
                </div>
              ) : (
                <div>
                  <div className="flex gap-2 mb-5"><input value={newKategori} onChange={(e) => setNewKategori(e.target.value)} placeholder="Kategori Baru" className={inputClass} /><button onClick={() => { if (newKategori.trim()) { setKategoriList((p) => [...p, newKategori.trim()]); setNewKategori(""); } }} className="bg-slate-800 text-white px-5 rounded-xl font-bold">Tambah</button></div>
                  <div className="space-y-2">
                    {kategoriList.map((k) => (
                      <div key={k} className="flex justify-between bg-slate-50 border border-slate-100 rounded-xl px-4 py-3"><span className="font-semibold">{k}</span><button onClick={() => setKategoriList(kategoriList.filter((x) => x !== k))} className="text-slate-400 hover:text-red-500"><Trash2 className="w-4 h-4" /></button></div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {showExportModal && (
        <div className="fixed inset-0 bg-slate-900/60 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-sm">
            <div className="flex justify-between items-center mb-5"><h3 className="font-black text-lg">Export CSV</h3><button onClick={() => setShowExportModal(false)} className="p-1 hover:bg-slate-200 rounded-full"><X className="w-5 h-5 text-slate-500" /></button></div>
            <label className={labelClass}>Pilih Bulan</label><input type="month" value={exportMonth} onChange={(e) => setExportMonth(e.target.value)} className={`${inputClass} mb-6`} />
            <button onClick={() => { exportCSV(exportMonth); setShowExportModal(false); }} className="w-full bg-emerald-500 hover:bg-emerald-600 text-white font-bold py-3.5 rounded-xl flex items-center justify-center gap-2"><Download className="w-5 h-5" /> Download CSV</button>
          </div>
        </div>
      )}

      {showUserModal && (
        <div className="fixed inset-0 bg-slate-900/60 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
            <div className="flex justify-between items-center p-5 border-b border-slate-100 bg-slate-50"><h3 className="font-black text-lg">{editingUser ? "Edit User" : "User Baru"}</h3><button onClick={() => { setShowUserModal(false); setEditingUser(null); }} className="p-1 hover:bg-slate-200 rounded-full"><X className="w-5 h-5 text-slate-500" /></button></div>
            <UserForm data={editingUser} cabangList={cabangList} onSave={saveUser} />
          </div>
        </div>
      )}
    </div>
  );
}

// Sub-Component User Form
function UserForm({ data, cabangList, onSave }) {
  const [form, setForm] = useState({ id: data?.id || null, nama: data?.nama || "", username: data?.username || "", password: "", role: data?.role || "pegawai", cabang: data?.cabang || cabangList[0] || "" });
  const inputClass = "w-full border-2 border-slate-200 rounded-xl px-4 py-2.5 text-sm font-medium focus:outline-none focus:ring-4 focus:ring-sky-500/20 focus:border-sky-500 transition-all";
  const labelClass = "block text-xs font-bold text-slate-500 mb-1.5 uppercase tracking-wide";
  return (
    <div className="p-6 space-y-4">
      <div><label className={labelClass}>Nama Lengkap</label><input className={inputClass} value={form.nama} onChange={(e) => setForm({ ...form, nama: e.target.value })} /></div>
      <div><label className={labelClass}>Username Login</label><input className={inputClass} value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} /></div>
      <div><label className={labelClass}>{data ? "Password (Kosong jika tidak diganti)" : "Password"}</label><input type="password" placeholder="********" className={inputClass} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></div>
      <div><label className={labelClass}>Level Akses</label><select className={inputClass} value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}><option value="pegawai">Pegawai Cabang</option><option value="admin">Super Admin</option></select></div>
      {form.role === "pegawai" && (<div><label className={labelClass}>Penempatan Cabang</label><select className={inputClass} value={form.cabang} onChange={(e) => setForm({ ...form, cabang: e.target.value })}>{cabangList.map((c) => (<option key={c} value={c}>{c}</option>))}</select></div>)}
      <button onClick={() => onSave(form)} className="w-full bg-sky-500 hover:bg-sky-600 text-white font-bold py-3.5 rounded-xl mt-6">Simpan Akses</button>
    </div>
  );
}
