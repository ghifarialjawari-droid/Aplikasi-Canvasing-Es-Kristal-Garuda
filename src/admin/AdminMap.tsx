import React, { useState, useRef, useEffect } from 'react';
import { MapPin, X, ExternalLink, Image as ImageIcon } from 'lucide-react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

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

const statusColorHex: Record<string, string> = {
  'Closing': '#10b981',
  'Prospek': '#2563eb',
  'Follow Up': '#eab308',
  'Menolak': '#ef4444',
};
const getStatusHex = (status: string) => statusColorHex[status] || '#94a3b8';

const getStatusColorClasses = (status: string) => {
  switch (status) {
    case 'Closing': return 'bg-emerald-500 border-emerald-200';
    case 'Prospek': return 'bg-blue-500 border-blue-200';
    case 'Follow Up': return 'bg-yellow-500 border-yellow-200';
    case 'Menolak': return 'bg-red-500 border-red-200';
    default: return 'bg-slate-400 border-slate-200';
  }
};

const AdminMap = ({ visits, users }: { visits: Visit[], users: User[] }) => {
  const [filterCabang, setFilterCabang] = useState('Semua');
  const [filterPegawai, setFilterPegawai] = useState('Semua');
  const [filterStatus, setFilterStatus] = useState('Semua');
  const [selectedMarker, setSelectedMarker] = useState<Visit | null>(null);
  const [showPhoto, setShowPhoto] = useState(false);

  const mapDivRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markersRef = useRef<L.Marker[]>([]);

  const cabangList = ['Semua', ...Array.from(new Set(users.filter(u => u.role === 'pegawai').map(u => u.cabang)))];
  const pegawaiList = ['Semua', ...users.filter(u => u.role === 'pegawai' && (filterCabang === 'Semua' || u.cabang === filterCabang)).map(u => u.name)];
  const statusList = ['Semua', 'Prospek', 'Closing', 'Follow Up', 'Menolak', 'Sudah Pakai Es', 'Belum Pakai Es'];

  const filteredVisits = visits.filter(v => {
    const peg = users.find(u => u.id === v.pegawaiId);
    if (filterCabang !== 'Semua' && peg?.cabang !== filterCabang) return false;
    if (filterPegawai !== 'Semua' && peg?.name !== filterPegawai) return false;
    if (filterStatus !== 'Semua' && v.status !== filterStatus) return false;
    return v.lat !== null && v.lng !== null;
  });

  // Inisialisasi peta sekali saat komponen pertama kali muncul
  useEffect(() => {
    if (!mapDivRef.current || mapRef.current) return;
    const map = L.map(mapDivRef.current).setView([-7.15, 107.95], 11);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 19,
    }).addTo(map);
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Update marker setiap kali data/filter berubah
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    markersRef.current.forEach(m => m.remove());
    markersRef.current = [];

    filteredVisits.forEach(v => {
      const color = getStatusHex(v.status);
      const icon = L.divIcon({
        className: '',
        html: `<div style="background:${color};width:18px;height:18px;border-radius:50%;border:3px solid white;box-shadow:0 2px 6px rgba(0,0,0,0.4)"></div>`,
        iconSize: [18, 18],
        iconAnchor: [9, 9],
      });
      const marker = L.marker([v.lat as number, v.lng as number], { icon }).addTo(map);
      marker.bindTooltip(v.shopName, { direction: 'top', offset: [0, -8] });
      marker.on('click', () => setSelectedMarker(v));
      markersRef.current.push(marker);
    });

    if (filteredVisits.length > 0) {
      const bounds = L.latLngBounds(filteredVisits.map(v => [v.lat as number, v.lng as number]));
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 15 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visits, filterCabang, filterPegawai, filterStatus]);

  const openInGoogleMaps = (lat: number, lng: number) => {
    window.open(`https://www.google.com/maps?q=${lat},${lng}`, '_blank', 'noopener,noreferrer');
  };

  return (
    <div className="p-6 md:p-8 space-y-6 bg-slate-50 min-h-screen">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold text-slate-800">Peta Sebaran Canvasing</h1>
        <p className="text-slate-500">Tracking GPS real-time dari aktivitas lapangan pegawai.</p>
      </div>

      <Card className="p-5">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Select label="Filter Cabang" value={filterCabang} onChange={(e: any) => { setFilterCabang(e.target.value); setFilterPegawai('Semua'); }} options={cabangList} />
          <Select label="Filter Pegawai" value={filterPegawai} onChange={(e: any) => setFilterPegawai(e.target.value)} options={pegawaiList} />
          <Select label="Status Kunjungan" value={filterStatus} onChange={(e: any) => setFilterStatus(e.target.value)} options={statusList} />
          <div className="flex items-end pb-4">
            <Button variant="outline" className="w-full" onClick={() => { setFilterCabang('Semua'); setFilterPegawai('Semua'); setFilterStatus('Semua'); }}>Reset Filter</Button>
          </div>
        </div>
      </Card>

      <Card className="p-0 overflow-hidden relative h-[600px]">
        <div ref={mapDivRef} className="w-full h-full z-0" />

        <div className="absolute top-4 left-4 z-[400] bg-white/90 p-4 rounded-xl shadow-md border border-white backdrop-blur text-sm font-medium space-y-2 pointer-events-none">
          <div className="flex items-center gap-2"><div className="w-3 h-3 rounded-full bg-emerald-500"></div> Sukses/Closing</div>
          <div className="flex items-center gap-2"><div className="w-3 h-3 rounded-full bg-blue-500"></div> Prospek Baru</div>
          <div className="flex items-center gap-2"><div className="w-3 h-3 rounded-full bg-yellow-500"></div> Perlu Follow Up</div>
          <div className="flex items-center gap-2"><div className="w-3 h-3 rounded-full bg-red-500"></div> Menolak</div>
        </div>

        {selectedMarker && (
          <div className="absolute top-4 right-4 w-80 bg-white rounded-2xl shadow-2xl border border-slate-200 z-[500] p-4 animate-in fade-in slide-in-from-right-8">
            <div className="flex justify-between items-start mb-4">
              <div>
                <h3 className="font-bold text-slate-800 text-lg">{selectedMarker.shopName}</h3>
                <p className="text-xs text-slate-500 flex items-center gap-1"><MapPin size={12} /> {selectedMarker.cabang} {selectedMarker.area && `(${selectedMarker.area})`}</p>
              </div>
              <button onClick={() => setSelectedMarker(null)} className="p-1 bg-slate-100 rounded-full hover:bg-slate-200"><X size={16} /></button>
            </div>

            <div className="space-y-3 text-sm">
              <div className="flex justify-between border-b pb-2"><span className="text-slate-500">Pemilik</span> <span className="font-medium text-slate-800">{selectedMarker.owner}</span></div>
              <div className="flex justify-between border-b pb-2"><span className="text-slate-500">No HP</span> <span className="font-medium text-slate-800">{selectedMarker.phone}</span></div>
              <div className="flex justify-between border-b pb-2"><span className="text-slate-500">Pegawai (Sales)</span> <span className="font-medium text-blue-600">{users.find(u => u.id === selectedMarker.pegawaiId)?.name}</span></div>
              <div className="flex justify-between border-b pb-2"><span className="text-slate-500">Toko Baru?</span> <span className="font-medium text-slate-800">{selectedMarker.isNewCustomer ? 'Ya' : 'Tidak'}</span></div>
              <div className="flex justify-between border-b pb-2"><span className="text-slate-500">Status</span>
                <span className={`px-2 py-0.5 rounded-full text-xs font-bold text-white ${getStatusColorClasses(selectedMarker.status).split(' ')[0]}`}>{selectedMarker.status}</span>
              </div>
              <div className="flex justify-between border-b pb-2"><span className="text-slate-500">Tgl Kunjungan</span> <span className="font-medium text-slate-800">{selectedMarker.date} {selectedMarker.time}</span></div>
              {selectedMarker.nextFollowUp && (
                <div className="flex justify-between border-b pb-2"><span className="text-slate-500 font-bold text-yellow-600">Janji Follow Up</span> <span className="font-bold text-slate-800">{selectedMarker.nextFollowUp}</span></div>
              )}
              <div>
                <span className="text-slate-500 block mb-1">Catatan Laporan:</span>
                <p className="bg-slate-50 p-2 rounded-lg text-slate-700 italic border border-slate-100">{selectedMarker.result}</p>
              </div>
              <div className="flex gap-2 mt-4">
                <Button variant="outline" className="w-1/2 py-2 text-sm" onClick={() => setShowPhoto(true)} disabled={!selectedMarker.photo}>
                  <ImageIcon size={16} /> Lihat Foto
                </Button>
                <Button
                  variant="primary" className="w-1/2 py-2 text-sm"
                  onClick={() => selectedMarker.lat !== null && selectedMarker.lng !== null && openInGoogleMaps(selectedMarker.lat, selectedMarker.lng)}
                >
                  <ExternalLink size={16} /> Buka Maps
                </Button>
              </div>
            </div>
          </div>
        )}

        {showPhoto && selectedMarker && (
          <div className="fixed inset-0 bg-slate-900/70 backdrop-blur-sm z-[600] flex items-center justify-center p-4" onClick={() => setShowPhoto(false)}>
            <div className="max-w-lg w-full" onClick={(e) => e.stopPropagation()}>
              <div className="flex justify-end mb-2">
                <button onClick={() => setShowPhoto(false)} className="p-2 bg-white rounded-full shadow hover:bg-slate-100"><X size={18} /></button>
              </div>
              {selectedMarker.photo ? (
                <img src={selectedMarker.photo} alt={selectedMarker.shopName} className="w-full rounded-2xl shadow-2xl" />
              ) : (
                <div className="bg-white rounded-2xl p-8 text-center text-slate-500">Foto tidak tersedia untuk kunjungan ini.</div>
              )}
            </div>
          </div>
        )}
      </Card>
    </div>
  );
};

export default AdminMap;
