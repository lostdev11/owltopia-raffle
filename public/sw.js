// Minimal service worker stub. This app does not use service worker features.
// Exists so requests to /sw.js (e.g. from extensions or PWA probes) do not 404.
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', () => self.clients.claim())
