import React, { useState } from 'react';
import { Target as TargetIcon, PlusCircle, Trash2, Edit, X, TrendingUp } from 'lucide-react';

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
  pegawaiId: string;
  isNewCustomer: boolean;
  [key: string]: any;
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

const Input = ({ label, type = 'text', value, onChange, placeholder, required = false, minLength }: any) => (
  <div className="mb-4">
    <label className="block text-sm font-medium text-slate-600 mb-1.5">{label} {required && <span className="text-red-500">*</span>}</label>
    <input
      type={type} value={value} onChange={onChange} placeholder={placeholder} required={required} minLength={minLength}
      className="w-full bg-slate-50 border border-slate-200 text-slate-800 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all"
    />
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

// Menentukan rentang tanggal (mulai-akhir) dari sebuah target, sesuai periodenya
function getDateRangeForTarget(t: Target): { start: string, end: string } {
  const start = new Date(t.startDate + 'T00:00:00');

  if (t.period === 'harian') {
    return { start: t.startDate, end: t.startDate };
  }

  if (t.period === 'mingguan') {
    const day = start.getDay(); // 0 = Minggu
    const diffToMonday = day === 0 ? -6 : 1 - day;
    const monday = new Date(start);
    monday.setDate(start.getDate() + diffToMonday);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    return { start: monday.toISOString().split('T')[0], end: sunday.toISOString().split('T')[0] };
  }

  // bulanan
  const firstDay = new Date(start.getFullYear(), start.getMonth(), 1);
  const lastDay = new Date(start.getFullYear(), start.getMonth() + 1, 0);
  return { start: firstDay.toISOString().split('T')[0], end: lastDay.toISOString().split('T')[0] };
}

function computeRealisasi(t: Target, visits: Visit[], users: User[]) {
  const { start, end } = getDateRangeForTarget(t);
  const relevant = visits.filter((v) => {
    if (v.date < start || v.date > end) return false;
    if (t.scope === 'pegawai') return v.pegawaiId === t.scopeId;
    const peg = users.find((u) => u.id === v.pegawaiId);
    return peg?.cabang === t.scopeId;
  });
  return {
    visits: relevant.length,
    newCustomers: relevant.filter((v) => v.isNewCustomer).length,
  };
}

function getProgressStyle(pct: number) {
  if (pct >= 100) return { bar: 'bg-emerald-500', text: 'text-emerald-600', bg: 'bg-emerald-50', label: 'Tercapai' };
  if (pct >= 70) return { bar: 'bg-yellow-500', text: 'text-yellow-600', bg: 'bg-yellow-50', label: 'Hampir Tercapai' };
  return { bar: 'bg-red-500', text: 'text-red-600', bg: 'bg-red-50', label: 'Belum Tercapai' };
}

const periodLabel: Record<string, string> = { harian: 'Harian', mingguan: 'Mingguan', bulanan: 'Bulanan' };

const AdminTargets = ({
  visits, users, targets, onUpdateTargets
}: {
  visits: Visit[], users: User[], targets: Target[], onUpdateTargets: (t: Target[]) => void
}) => {
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [filterPeriod, setFilterPeriod] = useState('Semua');

  const todayStr = new Date().toISOString().split('T')[0];
  const pegawaiList = users.filter((u) => u.role === 'pegawai');
  const cabangList = Array.from(new Set(pegawaiList.map((u) => u.cabang)));

  const emptyForm = {
    scope: 'pegawai' as 'pegawai' | 'cabang',
    scopeId: '',
    period: 'bulanan' as 'harian' | 'mingguan' | 'bulanan',
    startDate: todayStr,
    visitTarget: 30,
    newCustomerTarget: 5,
  };
  const [form, setForm] = useState(emptyForm);

  const openAddModal = () => {
    setEditingId(null);
    setForm(emptyForm);
    setShowModal(true);
  };

  const openEditModal = (t: Target) => {
    setEditingId(t.id);
    setForm({
      scope: t.scope, scopeId: t.scopeId, period: t.period,
      startDate: t.startDate, visitTarget: t.visitTarget, newCustomerTarget: t.newCustomerTarget,
    });
    setShowModal(true);
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.scopeId) { alert('Pilih pegawai atau cabang tujuan target.'); return; }

    const scopeLabel = form.scope === 'pegawai'
      ? (pegawaiList.find((u) => u.id === form.scopeId)?.name || form.scopeId)
      : form.scopeId;

    if (editingId) {
      onUpdateTargets(targets.map((t) => t.id === editingId ? { ...t, ...form, scopeLabel } : t));
    } else {
      const newTarget: Target = { id: Date.now().toString(), ...form, scopeLabel };
      onUpdateTargets([newTarget, ...targets]);
    }
    setShowModal(false);
  };

  const handleDelete = (t: Target) => {
    if (confirm(`Hapus target untuk ${t.scopeLabel} (${periodLabel[t.period]})?`)) {
      onUpdateTargets(targets.filter((x) => x.id !== t.id));
    }
  };

  const filteredTargets = filterPeriod === 'Semua' ? targets : targets.filter((t) => t.period === filterPeriod);

  return (
    <div className="p-6 md:p-8 space-y-6 bg-slate-50 min-h-screen">
      <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-slate-800">Target Canvasing</h1>
          <p className="text-slate-500">Kelola target per pegawai atau per cabang/depot.</p>
        </div>
        <Button onClick={openAddModal} variant="primary" className="py-2.5 w-auto px-6"><PlusCircle size={18} /> Tambah Target</Button>
      </div>

      <div className="flex gap-2 bg-slate-100 p-1 rounded-xl w-fit flex-wrap">
        {['Semua', 'harian', 'mingguan', 'bulanan'].map((p) => (
          <button
            key={p} onClick={() => setFilterPeriod(p)}
            className={`px-4 py-2 rounded-lg text-sm font-semibold capitalize ${filterPeriod === p ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500'}`}
          >
            {p}
          </button>
        ))}
      </div>

      {filteredTargets.length === 0 ? (
        <Card className="p-10 text-center text-slate-400">
          <TargetIcon size={32} className="mx-auto mb-3 text-slate-300" />
          Belum ada target dibuat. Klik "Tambah Target" untuk mulai.
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filteredTargets.map((t) => {
            const realisasi = computeRealisasi(t, visits, users);
            const pctVisit = t.visitTarget > 0 ? Math.round((realisasi.visits / t.visitTarget) * 100) : 0;
            const pctNew = t.newCustomerTarget > 0 ? Math.round((realisasi.newCustomers / t.newCustomerTarget) * 100) : 0;
            const style = getProgressStyle(Math.min(pctVisit, pctVisit === 0 && pctNew === 0 ? 0 : pctVisit));
            const sisaVisit = Math.max(0, t.visitTarget - realisasi.visits);

            return (
              <Card key={t.id} className="p-5">
                <div className="flex justify-between items-start mb-3">
                  <div>
                    <h3 className="font-bold text-slate-800">{t.scopeLabel}</h3>
                    <p className="text-xs text-slate-500 capitalize">{t.scope === 'pegawai' ? 'Target Pegawai' : 'Target Cabang/Depot'} &bull; {periodLabel[t.period]}</p>
                  </div>
                  <span className={`px-2.5 py-1 rounded-full text-xs font-bold ${style.bg} ${style.text}`}>{style.label}</span>
                </div>

                <div className="mb-3">
                  <div className="flex justify-between text-xs mb-1 text-slate-600">
                    <span>Kunjungan</span>
                    <span className="font-bold">{realisasi.visits} / {t.visitTarget} ({pctVisit}%)</span>
                  </div>
                  <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                    <div className={`h-full ${getProgressStyle(pctVisit).bar} rounded-full transition-all duration-700`} style={{ width: `${Math.min(100, pctVisit)}%` }}></div>
                  </div>
                </div>

                <div className="mb-4">
                  <div className="flex justify-between text-xs mb-1 text-slate-600">
                    <span>Toko Baru</span>
                    <span className="font-bold">{realisasi.newCustomers} / {t.newCustomerTarget} ({pctNew}%)</span>
                  </div>
                  <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                    <div className={`h-full ${getProgressStyle(pctNew).bar} rounded-full transition-all duration-700`} style={{ width: `${Math.min(100, pctNew)}%` }}></div>
                  </div>
                </div>

                <div className="flex justify-between items-center text-xs text-slate-500 border-t pt-3">
                  <span>Sisa target kunjungan: <b className="text-slate-700">{sisaVisit}</b></span>
                  <div className="flex gap-1">
                    <button onClick={() => openEditModal(t)} className="p-1.5 bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100"><Edit size={14} /></button>
                    <button onClick={() => handleDelete(t)} className="p-1.5 bg-red-50 text-red-600 rounded-lg hover:bg-red-100"><Trash2 size={14} /></button>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {showModal && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <Card className="w-full max-w-lg p-6">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2"><TrendingUp size={20} className="text-blue-600" /> {editingId ? 'Edit Target' : 'Tambah Target Baru'}</h2>
              <button onClick={() => setShowModal(false)} className="p-2 text-slate-400 hover:text-red-500"><X size={20} /></button>
            </div>
            <form onSubmit={handleSave} className="space-y-1">
              <div className="grid grid-cols-2 gap-4">
                <Select label="Untuk" required value={form.scope} onChange={(e: any) => setForm({ ...form, scope: e.target.value, scopeId: '' })} options={[{ value: 'pegawai', label: 'Pegawai' }, { value: 'cabang', label: 'Cabang/Depot' }]} />
                <Select
                  label={form.scope === 'pegawai' ? 'Pilih Pegawai' : 'Pilih Cabang'} required value={form.scopeId}
                  onChange={(e: any) => setForm({ ...form, scopeId: e.target.value })}
                  options={form.scope === 'pegawai' ? pegawaiList.map((u) => ({ value: u.id, label: u.name })) : cabangList}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <Select label="Periode" required value={form.period} onChange={(e: any) => setForm({ ...form, period: e.target.value })} options={[{ value: 'harian', label: 'Harian' }, { value: 'mingguan', label: 'Mingguan' }, { value: 'bulanan', label: 'Bulanan' }]} />
                <Input label="Tanggal Mulai Berlaku" type="date" required value={form.startDate} onChange={(e: any) => setForm({ ...form, startDate: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <Input label="Target Kunjungan" type="number" required value={form.visitTarget} onChange={(e: any) => setForm({ ...form, visitTarget: Math.max(0, Number(e.target.value)) })} />
                <Input label="Target Toko Baru" type="number" required value={form.newCustomerTarget} onChange={(e: any) => setForm({ ...form, newCustomerTarget: Math.max(0, Number(e.target.value)) })} />
              </div>
              <div className="flex gap-3 pt-4 border-t mt-4">
                <Button variant="outline" onClick={() => setShowModal(false)} className="flex-1">Batal</Button>
                <Button type="submit" variant="primary" className="flex-1">Simpan Target</Button>
              </div>
            </form>
          </Card>
        </div>
      )}
    </div>
  );
};

export default AdminTargets;
