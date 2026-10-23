// ---------- Offline support ----------
// IMPORTANT: change this number every time you edit any app file,
// so phones download the new version.
const CACHE = "expense-tracker-v8";

const FILES = [
  "./",
  "./index.html",
  "./manifest.json",
  "./css/style.css",
  "./js/boot.js",
  "./js/crypto.js",
  "./js/db.js",
  "./js/charts.js",
  "./js/app.js",
  "./js/settings.js",
  "./js/recurring.js",
  "./js/goals.js",
  "./js/insights.js",
  "./js/lock.js",
  "./lib/dexie.min.js",
  "./lib/chart.umd.min.js",
  "./icons/icon-192.png",
  "./icons/icon-512.png"
];

// Save all files when the app is first installed
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(FILES))
  );
  self.skipWaiting();
});

// Delete old saved versions
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
      )
  );
  self.clients.claim();
});

// Serve from the saved copy first, so it works with no internet
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  event.respondWith(
    caches.match(event.request).then((saved) => saved || fetch(event.request))
  );
});
