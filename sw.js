// Plak Arşivim — çevrimdışı açılış için uygulama dosyalarını önbelleğe alır
const CACHE = 'plak-arsivim-v4';
const SHELL = ['./', 'index.html', 'style.css', 'app.js', 'lookup.js', 'config.js', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
// Kendi dosyalarımız: önce ağ (güncel sürüm), ağ yoksa önbellek. Dış istekler (API, kapaklar, Firebase) olduğu gibi geçer.
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request).then(res => { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return res; })
      .catch(() => caches.match(e.request).then(r => r || caches.match('index.html')))
  );
});
