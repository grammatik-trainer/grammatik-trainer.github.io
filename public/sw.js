// Offline-Unterstützung für Der Die Das Sprint.
//
// Navigationen laufen bewusst network-first: ein Cache-first-HTML würde nach
// einem Deploy monatelang die alte Seite ausliefern. Dateien unter /assets/
// tragen einen Hash im Namen und sind damit unveränderlich — die dürfen aus
// dem Cache kommen.

const SHELL_CACHE = "ddd-sprint-shell-v1";
const ASSET_CACHE = "ddd-sprint-assets-v1";
const APP_SHELL = "/";
// Diese Datei ändert sich zwischen Deploys nicht, also läuft kein activate, das
// aufräumen könnte. Ohne Obergrenze sammeln sich die gehashten Dateien jedes
// jemals besuchten Deploys an.
const ASSET_LIMIT = 80;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.add(APP_SHELL)).catch(() => undefined),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  const keep = new Set([SHELL_CACHE, ASSET_CACHE]);
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => !keep.has(key)).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

async function trimCache(cache, limit) {
  const keys = await cache.keys();
  if (keys.length <= limit) return;
  await Promise.all(keys.slice(0, keys.length - limit).map((key) => cache.delete(key)));
}

async function networkFirst(event, allowShellFallback) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const response = await fetch(event.request);
    if (response.ok) event.waitUntil(cache.put(event.request, response.clone()));
    return response;
  } catch (error) {
    const hit = await cache.match(event.request);
    if (hit) return hit;
    // Nur Navigationen dürfen die Startseite bekommen. Ein RSC- oder Bild-Request
    // würde sonst HTML mit Status 200 erhalten und am Parser scheitern, statt
    // sauber als Netzwerkfehler durchzufallen.
    if (allowShellFallback) {
      const shell = await cache.match(APP_SHELL);
      if (shell) return shell;
    }
    throw error;
  }
}

async function cacheFirst(event) {
  const cache = await caches.open(ASSET_CACHE);
  const hit = await cache.match(event.request);
  if (hit) return hit;
  const response = await fetch(event.request);
  if (response.ok) {
    event.waitUntil(cache.put(event.request, response.clone()).then(() => trimCache(cache, ASSET_LIMIT)));
  }
  return response;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  // Fremde Hosts — etwa das Analytics-Beacon — bleiben unberührt.
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(networkFirst(event, true));
    return;
  }

  event.respondWith(url.pathname.startsWith("/assets/") ? cacheFirst(event) : networkFirst(event, false));
});
