// Penyeragaman catatan absensi/kunjungan.

export interface DailyAttendanceLike {
  pegawaiId: string;
  date: string;
  checkInTime: string;
  checkOutTime?: string;
  checkOutLat?: number | null;
  checkOutLng?: number | null;
}

// Satu pegawai seharusnya satu catatan per hari, tapi baris ganda bisa muncul
// (mis. absen dari dua HP). Yang dipakai: absen masuk paling awal; jam pulang
// diambil dari baris mana pun yang punya jam pulang.
export function pickDailyRecord<T extends DailyAttendanceLike>(records: T[], pegawaiId: string, date: string): T | null {
  const mine = records.filter(r => r.pegawaiId === pegawaiId && r.date === date);
  if (mine.length === 0) return null;
  const sorted = [...mine].sort((a, b) => ((a.checkInTime || '99:99') < (b.checkInTime || '99:99') ? -1 : 1));
  const primary = sorted[0];
  if (primary.checkOutTime) return primary;
  const withOut = sorted.find(r => r.checkOutTime);
  return withOut ? { ...primary, checkOutTime: withOut.checkOutTime, checkOutLat: withOut.checkOutLat, checkOutLng: withOut.checkOutLng } : primary;
}

// Satu catatan per pegawai untuk tanggal tertentu.
export function uniqueDailyRecords<T extends DailyAttendanceLike>(records: T[], date: string): T[] {
  const ids = Array.from(new Set(records.filter(r => r.date === date).map(r => r.pegawaiId)));
  return ids.map(id => pickDailyRecord(records, id, date)).filter((r): r is T => r !== null);
}

export function sortAttendanceDesc<T extends { date: string, checkInTime: string }>(list: T[]): T[] {
  return [...list].sort((a, b) => {
    const ka = a.date + ' ' + (a.checkInTime || ''), kb = b.date + ' ' + (b.checkInTime || '');
    return ka < kb ? 1 : ka > kb ? -1 : 0;
  });
}

export function sortVisitsDesc<T extends { date: string, time: string }>(list: T[]): T[] {
  return [...list].sort((a, b) => {
    const ka = a.date + ' ' + (a.time || ''), kb = b.date + ' ' + (b.time || '');
    return ka < kb ? 1 : ka > kb ? -1 : 0;
  });
}

// Membandingkan dua daftar supaya layar tidak dirender ulang kalau isinya sama.
export function sameList<T>(a: T[], b: T[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (JSON.stringify(a[i]) !== JSON.stringify(b[i])) return false;
  }
  return true;
}
