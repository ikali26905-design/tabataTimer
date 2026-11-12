/* =========================================================
   TABATA TIMER — sw.js (service worker)
   Le service worker est un script qui tourne en arrière-plan, entre l'appli
   et le réseau. Ici, il met tous les fichiers en cache à l'installation,
   puis les sert depuis le cache : l'appli fonctionne sans connexion.

   ⚠️ IMPORTANT : à chaque modification d'un fichier de l'appli, augmente
   CACHE_VERSION (v1 → v2…). Sinon les téléphones garderont l'ancienne version.
   ========================================================= */

const CACHE_VERSION = 'v4';
const CACHE_NAME = `tabata-timer-${CACHE_VERSION}`;

// Tous les fichiers nécessaires pour fonctionner hors ligne (chemins relatifs :
// ça marche aussi bien à la racine que dans un sous-dossier GitHub Pages).
const ASSETS = [
  './',
  './index.html',
  './css/style.css',
  './js/app.js',
  './manifest.json',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
  './fonts/chakra-petch-500.woff2',
  './fonts/chakra-petch-700.woff2',
  './fonts/chakra-petch-700-italic.woff2',
];

// 1. Installation : on télécharge et met en cache tous les fichiers
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())   // la nouvelle version s'active sans attendre
  );
});

// 2. Activation : on supprime les caches des anciennes versions
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => key.startsWith('tabata-timer-') && key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())  // prend le contrôle des pages déjà ouvertes
  );
});

// 3. Requêtes : stratégie "cache d'abord, réseau sinon"
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  event.respondWith(
    caches.match(event.request, { ignoreSearch: true }).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).catch(() =>
        // Hors ligne et fichier absent du cache : pour une page, on renvoie l'appli
        event.request.mode === 'navigate' ? caches.match('./index.html') : Response.error()
      );
    })
  );
});
