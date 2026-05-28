// Service Worker mínimo para que la app sea instalable y funcione offline (el chat sí necesita red).
const CACHE = 'calc-v1';
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './manifest.json',
  './js/config.js',
  './js/supabase-client.js',
  './js/calculator.js',
  './js/chat.js',
  './js/app.js',
  './icons/icon.svg'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // No cachear la API de Supabase
  if (url.hostname.endsWith('supabase.co')) return;
  e.respondWith(
    caches.match(e.request).then(r => r || fetch(e.request).catch(() => caches.match('./index.html')))
  );
});
