import React from 'react';

interface Props {
  children: React.ReactNode;
}

interface State {
  hasError: boolean;
}

// Menangkap error yang tidak terduga saat aplikasi berjalan, supaya yang
// muncul adalah halaman "Terjadi Kesalahan" dengan tombol coba lagi -
// bukan halaman putih kosong yang membingungkan.
export default class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: unknown, info: unknown) {
    console.error('Terjadi kesalahan pada aplikasi:', error, info);
  }

  handleReload = () => {
    this.setState({ hasError: false });
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
          <div className="w-full max-w-sm bg-white rounded-2xl shadow-sm border border-slate-100 p-6 text-center">
            <div className="w-14 h-14 bg-red-50 text-red-500 rounded-full flex items-center justify-center mx-auto mb-4 text-2xl font-bold">!</div>
            <h2 className="text-lg font-bold text-slate-800 mb-2">Terjadi Kesalahan</h2>
            <p className="text-sm text-slate-500 mb-5">
              Aplikasi mengalami gangguan tak terduga. Coba muat ulang halaman ini.
            </p>
            <button
              onClick={this.handleReload}
              className="w-full py-3 px-4 rounded-xl font-semibold bg-blue-600 text-white shadow-md shadow-blue-200 hover:bg-blue-700 transition-all"
            >
              Muat Ulang Aplikasi
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
