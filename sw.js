const CACHE_NAME = 'jeffrey-v1';
const URLS = ['/', '/jeffrey-dashboard/', '/jeffrey-dashboard/index.html'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE_NAME).then(c => c.addAll(URLS)));
});

self.addEventListener('fetch', e => {
  e.respondWith(
    fetch(e.request).catch(() => caches.match(e.request))
  );
});
