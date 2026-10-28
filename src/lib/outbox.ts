// Antrean kirim (outbox): setiap kunjungan/absensi baru atau perubahan dimasukkan
// dulu ke antrean yang disimpan di HP, lalu dikirim ke server dan dicoba ulang
// otomatis sampai berhasil. Dengan begitu data tidak hilang walau sinyal putus
// atau aplikasi ditutup di tengah jalan.

export type OutboxCollection = 'visits' | 'attendance';

export interface OutboxOp {
  id: string;
  action: 'append' | 'upsert' | 'delete';
  collection: OutboxCollection;
  itemId: string;
  item?: any;
  createdAt: number;
}

export const OUTBOX_KEY = 'esgaruda_outbox_v1';

export function loadOutbox(): OutboxOp[] {
  try {
    const raw = localStorage.getItem(OUTBOX_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveOutbox(ops: OutboxOp[]): void {
  try {
    localStorage.setItem(OUTBOX_KEY, JSON.stringify(ops));
  } catch {
    // penyimpanan HP penuh: antrean tetap berjalan di memori
  }
}

// Menambah operasi ke antrean. Operasi untuk data yang sama digabung supaya
// yang terkirim hanya versi terbaru. `inflightId` = operasi yang sedang dikirim
// (tidak boleh diubah).
export function enqueueOp(
  ops: OutboxOp[],
  op: Omit<OutboxOp, 'id' | 'createdAt'>,
  inflightId: string | null,
  now: number = Date.now()
): OutboxOp[] {
  const full: OutboxOp = { ...op, id: `${now}-${Math.random().toString(36).slice(2, 8)}`, createdAt: now };
  const same = (o: OutboxOp) => o.collection === op.collection && o.itemId === op.itemId;
  const editable = (o: OutboxOp) => o.id !== inflightId;

  if (op.action === 'delete') {
    // Data yang belum pernah terkirim cukup dibuang dari antrean (tidak perlu dihapus di server)
    const hadUnsentAppend = ops.some(o => same(o) && editable(o) && o.action === 'append');
    const kept = ops.filter(o => !(same(o) && editable(o) && (o.action === 'append' || o.action === 'upsert')));
    return hadUnsentAppend ? kept : [...kept, full];
  }

  const idx = ops.findIndex(o => same(o) && editable(o) && (o.action === 'append' || o.action === 'upsert'));
  if (idx >= 0) return ops.map((o, i) => (i === idx ? { ...o, item: op.item } : o));
  return [...ops, full];
}

// Keadaan akhir yang diharapkan = data dari server + semua perubahan yang masih
// mengantre. Dipakai setiap kali data dimuat ulang dari server, supaya data
// yang belum terkirim tidak hilang dari layar.
export function applyOutbox<T extends { id: string }>(server: T[], ops: OutboxOp[], collection: OutboxCollection): T[] {
  const list = server.slice();
  for (const op of ops) {
    if (op.collection !== collection) continue;
    const idx = list.findIndex(x => x.id === op.itemId);
    if (op.action === 'delete') {
      if (idx >= 0) list.splice(idx, 1);
    } else if (idx >= 0) {
      list[idx] = op.item;
    } else {
      list.unshift(op.item);
    }
  }
  return list;
}

export function isPending(ops: OutboxOp[], collection: OutboxCollection, itemId: string): boolean {
  return ops.some(o => o.collection === collection && o.itemId === itemId && o.action !== 'delete');
}
