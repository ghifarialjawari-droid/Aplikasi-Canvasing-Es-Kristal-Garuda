import { localMonthStr } from './dates';

// Tipe minimal supaya modul ini bisa dipakai App.tsx maupun halaman admin
// tanpa saling bergantung.
export interface TargetEntry {
  id: string;
  scope: 'pegawai' | 'cabang';
  scopeId: string;
  period: 'harian' | 'mingguan' | 'bulanan';
  startDate: string; // "YYYY-MM-DD"
  visitTarget: number;
  newCustomerTarget: number;
}

export interface TargetUser {
  id: string;
  cabang: string;
  target?: { visits: number; newCustomers: number };
}

export interface VisitLike {
  pegawaiId: string;
  date: string;
  isNewCustomer: boolean;
}

export const MONTH_NAMES_ID = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];

export function monthLabel(month: string): string {
  const [y, m] = month.split('-');
  return `${MONTH_NAMES_ID[parseInt(m, 10) - 1] || m} ${y}`;
}

export interface ResolvedTarget {
  visits: number;
  newCustomers: number;
  // bulan (YYYY-MM) dari entri Target Canvasing yang dipakai; null = memakai target bawaan akun
  sourceMonth: string | null;
  source: 'pegawai' | 'cabang' | 'bawaan';
}

// Target bulanan yang berlaku untuk seorang pegawai pada bulan tertentu.
// Aturan: target ditetapkan sebulan sekali lewat Target Canvasing. Kalau untuk
// bulan itu belum ada target baru, target terakhir sebelumnya tetap berlaku.
// Entri pada bulan yang lebih baru menang; kalau bulannya sama, target pribadi
// pegawai menang atas target depot. Kalau belum ada entri sama sekali, dipakai
// target bawaan akun.
export function getTargetForMonth(u: TargetUser, targets: TargetEntry[], month: string): ResolvedTarget {
  const candidates = targets.filter(t =>
    t.period === 'bulanan' &&
    t.startDate.slice(0, 7) <= month &&
    ((t.scope === 'pegawai' && t.scopeId === u.id) || (t.scope === 'cabang' && t.scopeId === u.cabang))
  );
  if (candidates.length > 0) {
    candidates.sort((a, b) => {
      const ma = a.startDate.slice(0, 7), mb = b.startDate.slice(0, 7);
      if (ma !== mb) return ma < mb ? 1 : -1;
      if (a.scope !== b.scope) return a.scope === 'pegawai' ? -1 : 1;
      return a.startDate < b.startDate ? 1 : -1;
    });
    const t = candidates[0];
    return { visits: t.visitTarget, newCustomers: t.newCustomerTarget, sourceMonth: t.startDate.slice(0, 7), source: t.scope };
  }
  return { visits: u.target?.visits || 0, newCustomers: u.target?.newCustomers || 0, sourceMonth: null, source: 'bawaan' };
}

export interface MonthResult {
  month: string;        // "YYYY-MM"
  label: string;        // "September 2026"
  targetVisits: number;
  realVisits: number;
  targetNew: number;
  realNew: number;
  pctVisits: number;
  pctNew: number;
  achieved: boolean;    // semua target yang ditetapkan tercapai
}

// Riwayat pencapaian target bulan-bulan SEBELUM bulan berjalan (terbaru dulu).
// Mulai dari bulan pertama pegawai itu punya aktivitas kunjungan atau target
// khusus, maksimal `maxMonths` bulan ke belakang.
export function buildTargetHistory(
  u: TargetUser, visits: VisitLike[], targets: TargetEntry[], now: Date = new Date(), maxMonths = 6
): MonthResult[] {
  const currentMonth = localMonthStr(now);
  const myVisits = visits.filter(v => v.pegawaiId === u.id);

  const starts: string[] = [];
  myVisits.forEach(v => starts.push(v.date.slice(0, 7)));
  targets.forEach(t => {
    if (t.period === 'bulanan' && ((t.scope === 'pegawai' && t.scopeId === u.id) || (t.scope === 'cabang' && t.scopeId === u.cabang))) {
      starts.push(t.startDate.slice(0, 7));
    }
  });
  if (starts.length === 0) return [];
  const firstMonth = starts.sort()[0];

  const results: MonthResult[] = [];
  let y = now.getFullYear();
  let m = now.getMonth() + 1; // 1-12, bulan berjalan
  for (let i = 0; i < maxMonths; i++) {
    m -= 1;
    if (m === 0) { m = 12; y -= 1; }
    const month = `${y}-${m < 10 ? '0' : ''}${m}`;
    if (month < firstMonth || month >= currentMonth) break;

    const tgt = getTargetForMonth(u, targets, month);
    if (tgt.visits <= 0 && tgt.newCustomers <= 0) continue;

    const mv = myVisits.filter(v => v.date.slice(0, 7) === month);
    const realVisits = mv.length;
    const realNew = mv.filter(v => v.isNewCustomer).length;
    const pctVisits = tgt.visits > 0 ? Math.round((realVisits / tgt.visits) * 100) : 100;
    const pctNew = tgt.newCustomers > 0 ? Math.round((realNew / tgt.newCustomers) * 100) : 100;
    const achieved = (tgt.visits <= 0 || realVisits >= tgt.visits) && (tgt.newCustomers <= 0 || realNew >= tgt.newCustomers);

    results.push({ month, label: monthLabel(month), targetVisits: tgt.visits, realVisits, targetNew: tgt.newCustomers, realNew, pctVisits, pctNew, achieved });
  }
  return results;
}
