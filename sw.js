// MERIDIES — Service Worker
// Version du cache : incrémenter à chaque déploiement majeur
const CACHE_NAME = 'meridies-v1';

// Ressources à mettre en cache immédiatement (app shell)
const PRECACHE = [
  '/',
  '/index.html'
];

// ─── Installation : mise en cache de l'app shell ─────────────
self.addEventListener('install', function(event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      return cache.addAll(PRECACHE);
    })
  );
  self.skipWaiting();
});

// ─── Activation : nettoyage des anciens caches ───────────────
self.addEventListener('activate', function(event) {
  event.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys
          .filter(function(k) { return k !== CACHE_NAME; })
          .map(function(k) { return caches.delete(k); })
      );
    })
  );
  self.clients.claim();
});

// ─── Fetch : stratégie Network-first avec fallback cache ─────
// Pour les appels Supabase/API : réseau uniquement (pas de cache)
// Pour le reste : réseau d'abord, cache si hors-ligne
self.addEventListener('fetch', function(event) {
  var url = event.request.url;

  // Ne pas intercepter les appels Supabase, API Vercel, CDN externes
  if (
    url.includes('supabase.co') ||
    url.includes('/api/') ||
    url.includes('googleapis.com') ||
    url.includes('jsdelivr.net') ||
    url.includes('chart.js')
  ) {
    return; // laisser passer sans cache
  }

  // Pour les ressources locales : Network-first, fallback sur cache
  event.respondWith(
    fetch(event.request)
      .then(function(response) {
        // Mettre à jour le cache avec la réponse fraîche
        if (response && response.status === 200 && event.request.method === 'GET') {
          var responseClone = response.clone();
          caches.open(CACHE_NAME).then(function(cache) {
            cache.put(event.request, responseClone);
          });
        }
        return response;
      })
      .catch(function() {
        // Hors-ligne : servir depuis le cache
        return caches.match(event.request).then(function(cached) {
          if (cached) return cached;
          // Fallback ultime : retourner l'index.html mis en cache
          return caches.match('/') || caches.match('/index.html');
        });
      })
  );
});
