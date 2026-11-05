// Keel service worker: lets Keel open with no connection.
// Network first, so a new deploy shows up on the next load; the cached copy is used only offline.
// Your data is not cached here: Firestore keeps its own offline copy, and local mode uses localStorage.

const CACHE = "keel-v1";
const SHELL = [
  "./", "index.html", "manifest.webmanifest",
  "assets/keel.css", "assets/keel.js", "assets/store.js", "assets/cloud.js", "assets/ai.js", "assets/today.js",
  "assets/app-bridge.js", "assets/firebase-config.js", "assets/icons/icon.svg", "assets/icons/icon-192.png",
  "apps/cleaning-rounds/index.html", "apps/house-upkeep-ledger/index.html", "apps/garden-planner/index.html",
  "apps/pantry-recipe-book/index.html", "apps/garage-logbook/index.html", "apps/cut-to-150/index.html",
  "apps/card-file/index.html",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;
  const fonts = url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com";
  if (!sameOrigin && !fonts) return; // Firebase, Anthropic and the rest go straight to the network
  e.respondWith((async () => {
    try {
      const res = await fetch(req);
      if (res.ok && (sameOrigin || res.type === "cors" || res.type === "opaque")) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
      }
      return res;
    } catch (err) {
      const hit = await caches.match(req, { ignoreSearch: true });
      if (hit) return hit;
      if (req.mode === "navigate") { const shell = await caches.match("index.html"); if (shell) return shell; }
      throw err;
    }
  })());
});
