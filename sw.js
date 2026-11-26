// App-shell cache for the Home Schooling hub.
// Bump CACHE_NAME when the precache list or this strategy changes.
// Network responses from Supabase (and any other origin) are never stored.

const CACHE_NAME = 'home-schooling-shell-v1';

function precacheUrls() {
  return [
    './',
    './index.html',
    './documents.css',
    './documents.js',
    './lesson-documents.js',
    './pwa.js',
    './vendor/hs-editor.js',
    './favicon.svg',
    './manifest.webmanifest',
    './icons/icon-192.png',
    './icons/icon-512.png',
    './icons/icon-512-maskable.png',
    './icons/apple-touch-icon.png',
  ];
}

function isSupabaseHost(hostname) {
  return hostname === 'supabase.co' || hostname.endsWith('.supabase.co');
}

function isSignedUrl(url) {
  if (url.pathname.indexOf('/storage/v1/') !== -1) return true;
  const signedParams = [
    'token',
    'signature',
    'X-Amz-Signature',
    'X-Amz-Credential',
    'X-Goog-Signature',
    'X-Goog-Credential',
  ];
  for (let i = 0; i < signedParams.length; i++) {
    if (url.searchParams.has(signedParams[i])) return true;
  }
  return false;
}

// Only same-origin static files and document navigations are cacheable.
// Cross-origin calls (Supabase REST, auth, storage, realtime, CDNs) fall through
// to the browser untouched. WebSocket upgrades are not fetch events.
function shouldCacheRequest(request) {
  if (!request || request.method !== 'GET') return false;
  let url;
  try {
    url = new URL(request.url);
  } catch (error) {
    return false;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  if (isSupabaseHost(url.hostname)) return false;
  if (isSignedUrl(url)) return false;
  if (url.origin !== self.location.origin) return false;
  if (request.cache === 'only-if-cached' && request.mode !== 'same-origin') return false;
  if (request.headers && request.headers.has('range')) return false;
  if (url.pathname.endsWith('/sw.js')) return false;

  if (request.mode === 'navigate') return true;
  const destination = request.destination || '';
  if (
    destination === 'document' ||
    destination === 'script' ||
    destination === 'style' ||
    destination === 'image' ||
    destination === 'font' ||
    destination === 'manifest'
  ) {
    return true;
  }
  const accept = (request.headers && request.headers.get('accept')) || '';
  if (accept.indexOf('text/html') !== -1) return true;
  return /\.(?:html?|js|mjs|css|webmanifest|svg|png|ico|txt|woff2?)$/i.test(url.pathname);
}

function isCacheableResponse(response) {
  return !!(response && response.ok && response.type === 'basic');
}

async function putFresh(cache, request, response) {
  if (!isCacheableResponse(response)) return;
  // Cache Storage rejects redirected responses. Store a copy with the same body.
  if (response.redirected) {
    const copy = new Response(await response.clone().blob(), {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
    await cache.put(request, copy);
    return;
  }
  await cache.put(request, response.clone());
}

async function fromNetwork(request) {
  // GitHub Pages sets max-age=600. Reload skips that browser cache so a deploy
  // is picked up on the next visit instead of waiting out the HTTP cache.
  // Navigate requests reject a non-empty RequestInit, so rebuild those.
  if (request.mode === 'navigate') {
    return fetch(request.url, {
      cache: 'reload',
      credentials: 'same-origin',
      redirect: 'follow',
      headers: { accept: request.headers.get('accept') || 'text/html' },
    });
  }
  return fetch(new Request(request, { cache: 'reload' }));
}

async function networkFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fromNetwork(request);
    await putFresh(cache, request, response);
    return response;
  } catch (error) {
    const cached = await cache.match(request);
    if (cached) return cached;
    if (request.mode === 'navigate' || ((request.headers.get('accept') || '').indexOf('text/html') !== -1)) {
      const shell = (await cache.match('./index.html')) || (await cache.match('./'));
      if (shell) return shell;
    }
    throw error;
  }
}

async function precacheShell() {
  const cache = await caches.open(CACHE_NAME);
  const urls = precacheUrls();
  await Promise.all(urls.map(async (url) => {
    const response = await fetch(new Request(url, { cache: 'reload' }));
    if (!response.ok) throw new Error('Precache failed for ' + url + ' (' + response.status + ')');
    await cache.put(url, response);
  }));
}

self.addEventListener('install', (event) => {
  event.waitUntil(precacheShell());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  if (!shouldCacheRequest(event.request)) return;
  event.respondWith(networkFirst(event.request));
});
