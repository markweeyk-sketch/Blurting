const CACHE = 'blurt-v8';
const SHELL = [
  './',
  './index.html',
  './manifest.json',
  './android-chrome-192x192.png',
  './android-chrome-512x512.png',
];
// Third-party files the app needs offline. Their URLs are versioned, so a
// cached copy never goes stale and can be served without asking the network.
const CDN = [
  /^https:\/\/cdn\.quilljs\.com\/1\.3\.7\//,
  /^https:\/\/www\.gstatic\.com\/firebasejs\/10\.12\.0\//,
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

function put(req, res) {
  if (res && res.ok) {
    const copy = res.clone();
    caches.open(CACHE).then(c => c.put(req, copy));
  }
  return res;
}

// The page itself: network first so a deploy shows up on the next load, falling
// back to the cached copy when offline or when the network is too slow.
function networkFirst(req) {
  const network = fetch(req).then(res => put(req, res));
  const timeout = new Promise(resolve => setTimeout(resolve, 4000));
  const cached = () => caches.match(req, { ignoreSearch: true }).then(r => r || caches.match('./index.html'));
  return Promise.race([network, timeout.then(cached)])
    .then(res => res || network)
    .catch(() => cached().then(r => r || Response.error()));
}

// Icons and the manifest: serve the cached copy, refresh it in the background.
function staleWhileRevalidate(req) {
  return caches.match(req).then(cached => {
    const network = fetch(req).then(res => put(req, res)).catch(() => cached);
    return cached || network;
  });
}

function cacheFirst(req) {
  return caches.match(req).then(cached => cached || fetch(req).then(res => put(req, res)));
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin) {
    const isPage = req.mode === 'navigate' || url.pathname.endsWith('/') || url.pathname.endsWith('/index.html');
    e.respondWith(isPage ? networkFirst(req) : staleWhileRevalidate(req));
    return;
  }
  if (CDN.some(re => re.test(req.url))) e.respondWith(cacheFirst(req));
  // Everything else (Firestore, Google sign-in, ...) goes straight to the network.
});
