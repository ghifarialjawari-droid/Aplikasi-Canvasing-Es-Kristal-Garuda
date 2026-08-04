// Service Worker sederhana untuk App Canvasing Es Garuda
// Tujuannya: (1) mengizinkan aplikasi di-install ke HP, dan
// (2) menyimpan cache dasar supaya aplikasi tetap bisa terbuka
// walau sinyal internet sedang lemah/putus sesaat.

const CACHE_NAME = 'ekg-canvasing-v2';
const APP_SHELL = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/icon-192.png',
  '/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

// Strategi: network-first untuk data (biar selalu segar), fallback ke cache kalau offline.
self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => {
          // Jangan cache permintaan ke domain lain (mis. Google Apps Script / tile peta)
          if (request.url.startsWith(self.location.origin)) {
            cache.put(request, copy);
          }
        });
        return response;
      })
      .catch(() => caches.match(request))
  );
});
