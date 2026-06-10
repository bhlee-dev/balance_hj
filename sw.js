const CACHE = 'balance-v1';

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(['./'])).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // 앱 셸: 네트워크 우선, 실패 시 캐시 (오프라인 실행)
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request)
        .then(r => {
          const copy = r.clone();
          caches.open(CACHE).then(c => c.put('./', copy));
          return r;
        })
        .catch(() => caches.match('./'))
    );
    return;
  }

  // CDN 정적 리소스(폰트, Firebase SDK): 캐시 우선
  const cdn = url.hostname.endsWith('jsdelivr.net') ||
              url.hostname === 'fonts.googleapis.com' ||
              url.hostname === 'fonts.gstatic.com' ||
              url.hostname === 'www.gstatic.com';
  if (cdn && e.request.method === 'GET') {
    e.respondWith(
      caches.match(e.request).then(hit =>
        hit || fetch(e.request).then(r => {
          const copy = r.clone();
          caches.open(CACHE).then(c => c.put(e.request, copy));
          return r;
        })
      )
    );
  }
  // Firestore/GAS 요청은 가로채지 않음
});
