// ── Frisbee Track Service Worker ──
// Bump CACHE_VERSION on every deploy to guarantee update detection
const CACHE_VERSION = 'ft-v3';
const CACHE_NAME = `frisbee-track-${CACHE_VERSION}`;

const STATIC_ASSETS = [
  '/disc-load/',
  '/disc-load/index.html',
  '/disc-load/manifest.json',
  '/disc-load/icon-192.png',
  '/disc-load/icon-512.png',
];

// ── Install: cache static assets + skip waiting immediately ──
self.addEventListener('install', function(e) {
  e.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      return cache.addAll(STATIC_ASSETS);
    })
  );
  self.skipWaiting(); // activate immediately, don't wait for old tabs to close
});

// ── Activate: delete old caches + claim all open tabs ──
self.addEventListener('activate', function(e) {
  e.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys
          .filter(function(key) { return key !== CACHE_NAME; })
          .map(function(key) { return caches.delete(key); })
      );
    }).then(function() {
      return self.clients.claim(); // take control of all open tabs immediately
    })
  );
});

// ── Fetch: cache-first for static assets, network-only for API calls ──
self.addEventListener('fetch', function(e) {
  var url = e.request.url;

  // Always go to network for Supabase, Stripe, fonts, and analytics
  if (
    url.includes('supabase.co') ||
    url.includes('stripe.com') ||
    url.includes('googleapis.com') ||
    url.includes('gstatic.com') ||
    url.includes('anthropic') ||
    url.includes('generativelanguage')
  ) {
    return; // let browser handle normally
  }

  // Cache-first for everything else (static assets)
  e.respondWith(
    caches.match(e.request).then(function(cached) {
      if (cached) return cached;
      return fetch(e.request).then(function(response) {
        // Cache valid GET responses for our origin
        if (
          response &&
          response.status === 200 &&
          e.request.method === 'GET' &&
          url.startsWith(self.location.origin)
        ) {
          var clone = response.clone();
          caches.open(CACHE_NAME).then(function(cache) {
            cache.put(e.request, clone);
          });
        }
        return response;
      }).catch(function() {
        // Offline fallback — return cached index for navigation requests
        if (e.request.mode === 'navigate') {
          return caches.match('/disc-load/index.html');
        }
      });
    })
  );
});
