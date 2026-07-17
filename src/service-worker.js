/// <reference types="@sveltejs/kit" />
/**
 * SectorTV PWA service worker.
 *  - Precaches the app shell (hashed build assets + static files).
 *  - Hashed assets: cache-first (they never change for a given URL).
 *  - Navigations/other same-origin GETs: network-first with cache fallback.
 *  - API + cross-origin (streams/proxy): always network, never cached.
 */
import { build, files, version } from '$service-worker';

const CACHE = `sectortv-${version}`;
const PRECACHE = [...build, ...files];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // streams/proxy: leave to network
  if (url.pathname.startsWith('/api/')) return; // dynamic data: always network
  if (url.pathname.startsWith('/live/')) return; // live manifests/segments: always network

  // Hashed build assets are immutable -> cache-first.
  if (PRECACHE.includes(url.pathname)) {
    event.respondWith(caches.match(request).then((hit) => hit || fetch(request)));
    return;
  }

  // Pages/other: network-first, fall back to cache when offline.
  event.respondWith(
    fetch(request)
      .then((res) => {
        if (res.ok && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(request, copy));
        }
        return res;
      })
      .catch(() => caches.match(request).then((hit) => hit || caches.match('/')))
  );
});
