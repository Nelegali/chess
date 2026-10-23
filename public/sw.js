// Офлайн-режим: файлы приложения кэшируются, обновления подтягиваются в фоне.
// VERSION совпадает с версией приложения (js/version.js) — при выпуске обновления меняй обе.
const VERSION = '1.13.2';
const CACHE = `chess-openings-${VERSION}`;
const SHELL = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/app.css',
  'js/app.js',
  'js/board.js',
  'js/openings.js',
  'js/store.js',
  'js/sound.js',
  'js/lichess.js',
  'js/theory.js',
  'js/coach.js',
  'js/alternatives.js',
  'js/version.js',
  'js/popularity.js',
  'data/popularity.json',
  'vendor/chess.js',
  'vendor/chessground.js',
  'vendor/qrcode.js',
  'vendor/chessground.base.css',
  'vendor/chessground.brown.css',
  'vendor/chessground.cburnett.css',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  // cache: 'reload' — берём файлы с сервера, а не из HTTP-кэша браузера, иначе можно закэшировать старую версию.
  e.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // version.json всегда берём из сети: по нему приложение узнаёт, что вышло обновление.
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.includes('/api/') || url.pathname.endsWith('version.json')) return;
  // stale-while-revalidate: сразу отдаём из кэша, а в фоне обновляем.
  e.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const key = e.request.mode === 'navigate' ? 'index.html' : e.request;
      const cached = await cache.match(key, { ignoreSearch: true });
      // no-cache: сверяемся с сервером, а не с HTTP-кэшем браузера. Иначе сразу после выхода версии
      // в кэш приложения мог записаться старый файл (GitHub Pages разрешает хранить их 10 минут),
      // и получалась смесь: новый код со старыми стилями.
      const network = fetch(e.request, { cache: 'no-cache' })
        .then((res) => {
          if (res.ok) cache.put(key, res.clone());
          return res;
        })
        .catch(() => cached);
      return cached || network;
    }),
  );
});
