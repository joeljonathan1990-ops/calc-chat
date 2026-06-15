// Service Worker: instalable + offline + notificaciones push + caché de stickers.
const CACHE = 'calc-v6';
const STICKER_CACHE = 'stickers-v1';
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './manifest.json',
  './js/config.js',
  './js/supabase-client.js',
  './js/calculator.js',
  './js/stickers.js',
  './js/sounds.js',
  './js/chat.js',
  './js/app.js',
  './icons/icon.svg'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE && k !== STICKER_CACHE).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  // No cachear la API de Supabase (mensajes, fotos: siempre frescos)
  if (url.hostname.endsWith('supabase.co')) return;

  // Stickers animados de Google: cache-first en su propio caché (quedan "descargados")
  if (url.hostname === 'fonts.gstatic.com') {
    e.respondWith(
      caches.open(STICKER_CACHE).then(async (c) => {
        const hit = await c.match(e.request);
        if (hit) return hit;
        const resp = await fetch(e.request);
        if (resp.ok || resp.type === 'opaque') c.put(e.request, resp.clone());
        return resp;
      }).catch(() => fetch(e.request))
    );
    return;
  }

  e.respondWith(
    caches.match(e.request).then(r => r || fetch(e.request).catch(() => caches.match('./index.html')))
  );
});

// ===== Notificaciones push (app cerrada o en segundo plano) =====
self.addEventListener('push', (e) => {
  e.waitUntil((async () => {
    // Si la app está a la vista, el aviso suena adentro (no duplicar)
    const wins = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (wins.some(w => w.visibilityState === 'visible')) return;

    // Texto discreto: no delata que es un chat
    await self.registration.showNotification('Calculadora', {
      body: 'Tenés un resultado pendiente',
      icon: './icons/icon-192.png',
      badge: './icons/icon-192.png',
      tag: 'calc-msg',
      data: { url: './' }
    });
  })());
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      for (const w of wins) {
        if ('focus' in w) return w.focus();
      }
      return clients.openWindow('./');
    })
  );
});
