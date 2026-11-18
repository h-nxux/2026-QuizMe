// QuizMe service worker: offline app shell. API calls are never cached.
const VERSION = 'quizme-v2-1';
const SHELL = ['/', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/icon.svg'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(VERSION).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin === self.location.origin && url.pathname.startsWith('/api/')) return;
  // Supabase and other APIs: always network.
  if (url.origin !== self.location.origin && !url.hostname.endsWith('jsdelivr.net')) return;

  // Navigations: network first (fresh deploys), fall back to the cached shell offline.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(res => {
          const copy = res.clone();
          caches.open(VERSION).then(c => c.put('/', copy));
          return res;
        })
        .catch(() => caches.match('/')),
    );
    return;
  }

  // Hashed assets and fonts: cache first, fill the cache on the way.
  event.respondWith(
    caches.match(request).then(hit => {
      if (hit) return hit;
      return fetch(request).then(res => {
        if (res.ok || res.type === 'opaque') {
          const copy = res.clone();
          caches.open(VERSION).then(c => c.put(request, copy));
        }
        return res;
      });
    }),
  );
});
