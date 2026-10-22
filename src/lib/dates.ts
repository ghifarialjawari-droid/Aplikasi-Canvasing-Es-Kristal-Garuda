// Tanggal & jam berdasarkan zona waktu perangkat (WIB untuk tim lapangan).
// JANGAN pakai toISOString() untuk tanggal "hari ini": itu memakai UTC, sehingga
// di WIB (UTC+7) tanggalnya mundur sehari untuk jam 00:00-06:59.

const pad = (n: number) => (n < 10 ? '0' : '') + n;

// "YYYY-MM-DD" menurut zona waktu lokal
export function localDateStr(d: Date = new Date()): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// "YYYY-MM" menurut zona waktu lokal
export function localMonthStr(d: Date = new Date()): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

// "HH:mm" 24 jam dengan titik dua - tidak bergantung pengaturan bahasa HP
export function formatHHmm(d: Date = new Date()): string {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Mengubah berbagai bentuk jam ("7:00:00", "07.15", "07:00") jadi "HH:mm".
// Mengembalikan null kalau bukan jam yang valid.
export function normalizeTimeStr(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const m = String(v).trim().match(/^(\d{1,2})[:.](\d{2})(?:[:.]\d{2})?\s*(AM|PM)?$/i);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  if (m[3]) {
    const isPm = m[3].toUpperCase() === 'PM';
    if (isPm && h < 12) h += 12;
    if (!isPm && h === 12) h = 0;
  }
  if (h > 23 || min > 59) return null;
  return `${pad(h)}:${pad(min)}`;
}
