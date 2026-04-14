// ── Frisbee Track Service Worker ──
const CACHE_VERSION = 'ft-v3';
const CACHE_NAME = `frisbee-track-${CACHE_VERSION}`;

const STATIC_ASSETS = [
  '/disc-load/',
  '/disc-load/index.html',
  '/disc-load/manifest.json',
  '/disc-load/icon-192.png',
  '/disc-load/icon-512.png',
];

// ── Install: cache assets + activate immediately ──
self.addEventListener('install', function(e) {
  e.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      return cache.addAll(STATIC_ASSETS);
    })
  );
  self.skipWaiting();
});

// ── Activate: delete old caches + claim all tabs ──
self.addEventListener('activate', function(e) {
  e.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys.filter(function(k) { return k !== CACHE_NAME; })
            .map(function(k) { return caches.delete(k); })
      );
    }).then(function() { return self.clients.claim(); })
  );
});

// ── Fetch ──
self.addEventListener('fetch', function(e) {
  var url = e.request.url;

  // Always network for Supabase, Stripe, fonts, AI
  if (
    url.includes('supabase.co') ||
    url.includes('stripe.com') ||
    url.includes('googleapis.com') ||
    url.includes('gstatic.com') ||
    url.includes('anthropic') ||
    url.includes('generativelanguage')
  ) { return; }

  // ── index.html: network-first ──
  // Always fetch the latest — cache only used offline.
  // Means every deployment is live immediately, no version bumping needed.
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request).then(function(response) {
        var clone = response.clone();
        caches.open(CACHE_NAME).then(function(cache) { cache.put(e.request, clone); });
        return response;
      }).catch(function() {
        return caches.match('/disc-load/index.html');
      })
    );
    return;
  }

  // ── Other static assets (icons, manifest): cache-first ──
  e.respondWith(
    caches.match(e.request).then(function(cached) {
      if (cached) return cached;
      return fetch(e.request).then(function(response) {
        if (response && response.status === 200 && e.request.method === 'GET') {
          var clone = response.clone();
          caches.open(CACHE_NAME).then(function(cache) { cache.put(e.request, clone); });
        }
        return response;
      });
    })
  );
});
