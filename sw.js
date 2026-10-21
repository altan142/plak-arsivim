// Plak Arşivim — çevrimdışı açılış için uygulama dosyalarını önbelleğe alır.
// Yeni sürüm yayınlanınca VERSION değişir; tarayıcı bu dosyayı her açılışta denetler.
const VERSION = '9';
const CACHE = 'plak-arsivim-v' + VERSION;
const SHELL = ['./', 'index.html', 'style.css', 'app.js', 'lookup.js', 'config.js', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE)
    .then(c => Promise.all(SHELL.map(u => fetch(u, { cache: 'no-cache' }).then(r => r.ok && c.put(u, r)))))
    .then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
// Kendi dosyalarımız: her seferinde sunucuya "değişti mi?" diye sorulur (değişmediyse 304, çok hızlı).
// İnternet yoksa önbellekteki sürüm açılır. Dış istekler (API, kapaklar, Firebase) olduğu gibi geçer.
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request.url, { cache: 'no-cache', credentials: 'same-origin' })
      .then(res => { if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); } return res; })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match('index.html')))
  );
});
