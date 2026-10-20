// Caches CEDAR's own code so it opens fast and installs as an app.
// Financial data is never cached: Google API requests always go to the network.
const VERSION = 'cedar-v1.6.4';
const SHELL = [
  './', 'index.html', 'manifest.webmanifest', 'css/styles.css',
  'js/app.js', 'js/config.js', 'js/util.js', 'js/google.js', 'js/store.js', 'js/categorize.js', 'js/importer.js', 'js/pdfparse.js',
  'js/periods.js', 'js/reports.js', 'js/ui.js', 'js/demo.js',
  'js/views/home.js', 'js/views/spending.js', 'js/views/add.js', 'js/views/accounts.js', 'js/views/settings.js', 'js/views/setup.js', 'js/views/txn-form.js', 'js/views/transfers.js', 'js/views/subscriptions.js', 'js/look.js', 'js/receipt.js', 'js/screenshot.js', 'js/accounts-model.js', 'js/goals-model.js', 'js/views/goals.js', 'js/lock.js', 'js/views/lock-screen.js', 'js/subs.js',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-512.png', 'icons/apple-touch-icon.png', 'icons/favicon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  // Network first so updates arrive promptly; fall back to cache offline.
  e.respondWith(
    fetch(e.request)
      .then((res) => { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(e.request, copy)); return res; })
      .catch(() => caches.match(e.request, { ignoreSearch: true })),
  );
});
