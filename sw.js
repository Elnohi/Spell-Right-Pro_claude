// sw.js — Optimized caching strategy for SpellRightPro
// VERSION is injected automatically at deploy time by inject-version.js
const VERSION = '__SW_VERSION__';
const STATIC_CACHE = `static-${VERSION}`;
const HTML_CACHE = `html-${VERSION}`;

self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(caches.open(STATIC_CACHE));
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys
      .filter(k => k !== STATIC_CACHE && k !== HTML_CACHE)
      .map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', event => {
  const req = event.request;
  const url = req.url;

  // 🚫 Skip unsafe or third-party origins
  if (!url.startsWith('http') ||
      url.startsWith('chrome-extension://') ||
      url.includes('googletagmanager.com') ||
      url.includes('googlesyndication.com') ||
      url.includes('google-analytics.com') ||
      url.includes('gstatic.com') ||
      url.includes('firebaseinstallations.googleapis.com')) {
    return;
  }

  // 🧭 Network-first for navigations (HTML pages)
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const res = await fetch(req);
        const copy = res.clone();
        caches.open(HTML_CACHE).then(c => c.put(req, copy));
        return res;
      } catch {
        return (await caches.match(req)) || (await caches.match('/offline.html'));
      }
    })());
    return;
  }

  // 🧩 Stale-while-revalidate for assets (CSS, JS, images, fonts)
  const dest = req.destination;
  if (['script', 'style', 'image', 'font'].includes(dest)) {
    event.respondWith((async () => {
      const cache = await caches.open(STATIC_CACHE);
      const cached = await cache.match(req);
      const fetchPromise = fetch(req).then(res => {
        if (res && res.ok) cache.put(req, res.clone());
        return res;
      }).catch(() => undefined);
      return cached || fetchPromise || fetch(req);
    })());
  }
});
