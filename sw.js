'use strict';
// Offline shell + last schedule, and web push.
const CACHE = 'svitlo-v9';
const META = 'svitlo-meta'; // the page keeps its current push endpoint here for the handler below
const API = location.hostname.endsWith('github.io') ? 'https://clockweather.duckdns.org/svitlo/api/' : new URL('api/', self.registration.scope).href;
const SHELL = ['./', 'index.html', 'style.css', 'i18n.js', 'app.js', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/badge-96.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE && k !== META).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  const isState = url.pathname.endsWith('/api/state');
  if (e.request.method !== 'GET' || (url.origin !== location.origin && !isState)) return;
  if (url.pathname.includes('/api/') && !isState) return; // address lists etc.: network only
  // network first (fresh schedule and fresh code), the cache when offline
  e.respondWith(fetch(e.request).then((r) => {
    if (r.ok) { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
    return r;
  }).catch(() => caches.match(e.request).then((r) => r || (e.request.mode === 'navigate' ? caches.match('index.html') : Response.error()))));
});

self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data.json(); } catch { d = {title: 'Світло', body: e.data && e.data.text()}; }
  e.waitUntil(self.registration.showNotification(d.title || 'Світло', {
    body: d.body || '', tag: d.tag, renotify: !!d.tag, icon: 'icons/icon-192.png', badge: 'icons/badge-96.png', data: {url: d.url || './'},
  }));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const target = new URL(e.notification.data?.url || './', self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({type: 'window', includeUncontrolled: true}).then((list) => {
    for (const c of list) if (c.url.startsWith(self.registration.scope) && 'focus' in c) return c.focus();
    return self.clients.openWindow(target);
  }));
});

// The browser may replace a push subscription on its own (expiry, key rotation). Hand the new one to the server,
// which moves the addresses and settings over from the old endpoint, so notifications keep coming without opening the page.
// Chrome and Firefox fire this event; Safari does not (there the page re-sends the subscription whenever it is opened).
const b64 = (s) => { const p = '='.repeat((4 - s.length % 4) % 4); const r = atob((s + p).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(r, (c) => c.charCodeAt(0)); };
self.addEventListener('pushsubscriptionchange', (e) => {
  e.waitUntil((async () => {
    const meta = await caches.open(META);
    const saved = await meta.match('endpoint').then((r) => r && r.text()).catch(() => null);
    const oldEndpoint = (e.oldSubscription && e.oldSubscription.endpoint) || saved;
    if (!oldEndpoint) return;
    let sub = e.newSubscription;
    if (!sub) {
      const key = (e.oldSubscription && e.oldSubscription.options && e.oldSubscription.options.applicationServerKey)
        || b64((await (await fetch(API + 'vapid')).json()).key);
      sub = await self.registration.pushManager.subscribe({userVisibleOnly: true, applicationServerKey: key});
    }
    const r = await fetch(API + 'resubscribe', {method: 'POST', headers: {'content-type': 'application/json'},
      body: JSON.stringify({oldEndpoint, subscription: sub.toJSON()})});
    if (r.ok) await meta.put('endpoint', new Response(sub.endpoint));
  })().catch(() => {}));
});
