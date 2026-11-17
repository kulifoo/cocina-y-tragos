// Service worker: guarda la app para abrirla rápido y sin señal.
// Cambiá la versión cuando subas cambios para forzar la actualización.
const VERSION = 'cyt-v1';
const BASE = ['./', 'index.html', 'config.js', 'styles.css', 'app.js', 'store.js', 'util.js', 'seed.json', 'manifest.webmanifest', 'icon-192.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(BASE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  // Datos de Supabase: siempre de la red
  if (url.hostname.endsWith('supabase.co') && !url.pathname.includes('/storage/')) return;
  // Archivos de la app: red primero, caché si no hay señal
  if (url.origin === location.origin) {
    e.respondWith(fetch(e.request).then(r => { const c = r.clone(); caches.open(VERSION).then(k => k.put(e.request, c)); return r; }).catch(() => caches.match(e.request)));
    return;
  }
  // Fotos, fuentes y librerías: caché primero
  e.respondWith(caches.match(e.request).then(m => m || fetch(e.request).then(r => { if (r.ok || r.type === 'opaque') { const c = r.clone(); caches.open(VERSION).then(k => k.put(e.request, c)); } return r; })));
});
