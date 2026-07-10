// Weebji Studio dashboard SW — v1
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(clients.claim()));
self.addEventListener('fetch', () => {}); // network passthrough; present for installability

self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data.json(); } catch { /* noop */ }
  e.waitUntil(self.registration.showNotification(d.title || 'Weebji Studio', {
    body: d.body || '',
    icon: 'icon-192.png',
    badge: 'icon-192.png',
    data: { url: d.url || './dashboard.html' },
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || './dashboard.html';
  e.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    for (const c of list) {
      if (c.url.includes('dashboard') && 'focus' in c) return c.focus();
    }
    return clients.openWindow(url);
  }));
});
