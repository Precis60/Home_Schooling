import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const listeners = {};
const deletedCaches = [];
const sandbox = {
  self: {
    location: new URL('https://precis60.github.io/Home_Schooling/sw.js'),
    addEventListener(type, fn) { listeners[type] = fn; },
    skipWaiting() { sandbox.self.skipped = true; },
    clients: { claim() { return Promise.resolve(); } },
  },
  caches: {
    open() { return Promise.resolve({ put() { return Promise.resolve(); }, match() { return Promise.resolve(undefined); } }); },
    keys() { return Promise.resolve(['home-schooling-shell-v0', 'home-schooling-shell-v1', 'other-cache']); },
    delete(key) { deletedCaches.push(key); return Promise.resolve(true); },
    match() { return Promise.resolve(undefined); },
  },
  fetch() { return Promise.reject(new Error('network down')); },
  URL,
  Response,
  Request,
  Headers,
  console,
};

vm.runInNewContext(fs.readFileSync(new URL('./sw.js', import.meta.url), 'utf8'), sandbox, { filename: 'sw.js' });

const shouldCacheRequest = sandbox.shouldCacheRequest;
const origin = 'https://precis60.github.io';

function request(url, init) {
  return new Request(url, init);
}

test('precache is same-origin static shell only', () => {
  const urls = sandbox.precacheUrls();
  assert.ok(urls.includes('./index.html'));
  assert.ok(urls.includes('./manifest.webmanifest'));
  assert.ok(urls.includes('./sw.js') === false);
  for (const url of urls) {
    assert.equal(url.startsWith('./'), true, url);
    assert.equal(/supabase|https?:/i.test(url), false, url);
  }
});

test('supabase, signed storage, and cross-origin requests are never cacheable', () => {
  const blocked = [
    'https://rkmrzflpgrdqnfdexens.supabase.co/rest/v1/hs_documents?select=*',
    'https://rkmrzflpgrdqnfdexens.supabase.co/auth/v1/token?grant_type=password',
    'https://rkmrzflpgrdqnfdexens.supabase.co/storage/v1/object/sign/docs/file.pdf?token=secret',
    'https://rkmrzflpgrdqnfdexens.supabase.co/storage/v1/object/public/docs/file.pdf',
    'https://rkmrzflpgrdqnfdexens.supabase.co/realtime/v1/websocket?apikey=public',
    'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js',
    'https://fonts.googleapis.com/css2?family=Fraunces&display=swap',
    origin + '/Home_Schooling/icons/icon-192.png?token=signed',
    origin + '/Home_Schooling/file.png?X-Amz-Signature=abc',
  ];
  for (const url of blocked) {
    assert.equal(shouldCacheRequest(request(url)), false, url);
  }
  assert.equal(shouldCacheRequest({
    method: 'GET',
    url: 'wss://rkmrzflpgrdqnfdexens.supabase.co/realtime/v1/websocket',
    headers: new Headers(),
    destination: '',
    mode: 'cors',
    cache: 'default',
  }), false);
  assert.equal(shouldCacheRequest(request(origin + '/Home_Schooling/documents.js', { method: 'POST' })), false);
});

test('same-origin shell assets and navigations can be cached', () => {
  assert.equal(shouldCacheRequest(request(origin + '/Home_Schooling/documents.js')), true);
  assert.equal(shouldCacheRequest(request(origin + '/Home_Schooling/documents.css')), true);
  assert.equal(shouldCacheRequest(request(origin + '/Home_Schooling/manifest.webmanifest')), true);
  assert.equal(shouldCacheRequest(request(origin + '/Home_Schooling/icons/icon-512.png')), true);
  assert.equal(shouldCacheRequest(request(origin + '/Home_Schooling/')), false);
  assert.equal(shouldCacheRequest(request(origin + '/Home_Schooling/', {
    headers: { accept: 'text/html' },
  })), true);
});

test('the fetch handler uses the cache strategy for same-origin shell files', async () => {
  let responded = false;
  listeners.fetch({
    request: request(origin + '/Home_Schooling/documents.css'),
    respondWith(result) {
      responded = true;
      return Promise.resolve(result).catch(() => {});
    },
  });
  assert.equal(responded, true);
});

test('the fetch handler does not respond for Supabase', () => {
  let responded = false;
  listeners.fetch({
    request: request('https://abc.supabase.co/rest/v1/hs_documents'),
    respondWith() { responded = true; },
  });
  assert.equal(responded, false);
});

test('activate drops caches from older versions', async () => {
  let claim = false;
  sandbox.self.clients.claim = () => { claim = true; return Promise.resolve(); };
  let done;
  listeners.activate({ waitUntil(p) { done = p; } });
  await done;
  assert.deepEqual(deletedCaches.sort(), ['home-schooling-shell-v0', 'other-cache']);
  assert.equal(claim, true);
});

test('a waiting worker skips waiting when asked to update', () => {
  listeners.message({ data: { type: 'SKIP_WAITING' } });
  assert.equal(sandbox.self.skipped, true);
});

test('manifest meets installable requirements for the Pages subpath', () => {
  const manifest = JSON.parse(fs.readFileSync(new URL('./manifest.webmanifest', import.meta.url), 'utf8'));
  assert.equal(manifest.name, 'Home Schooling');
  assert.equal(manifest.short_name, 'Home School');
  assert.equal(manifest.start_url, './');
  assert.equal(manifest.scope, './');
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.orientation, 'any');
  assert.equal(manifest.theme_color, '#f3f1eb');
  assert.equal(manifest.background_color, '#f3f1eb');
  const icons = manifest.icons;
  assert.ok(icons.some((icon) => icon.sizes === '192x192' && icon.type === 'image/png' && icon.purpose === 'any'));
  assert.ok(icons.some((icon) => icon.sizes === '512x512' && icon.purpose === 'any'));
  assert.ok(icons.some((icon) => icon.sizes === '512x512' && icon.purpose === 'maskable'));
  for (const icon of icons) assert.equal(icon.src.startsWith('http'), false);
});

function pngSize(buffer) {
  assert.equal(buffer.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  assert.equal(buffer.toString('ascii', 12, 16), 'IHDR');
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

test('committed icons are opaque PNGs at the required sizes', () => {
  const expected = {
    'icons/icon-192.png': [192, 192],
    'icons/icon-512.png': [512, 512],
    'icons/icon-512-maskable.png': [512, 512],
    'icons/apple-touch-icon.png': [180, 180],
  };
  for (const [file, size] of Object.entries(expected)) {
    const buffer = fs.readFileSync(new URL('./' + file, import.meta.url));
    assert.deepEqual([pngSize(buffer).width, pngSize(buffer).height], size, file);
    const colorType = buffer[25];
    assert.equal(colorType === 2 || colorType === 6, true, file + ' color type ' + colorType);
  }
});

test('index.html links the manifest, apple icon, and service worker', () => {
  const html = fs.readFileSync(new URL('./index.html', import.meta.url), 'utf8');
  assert.match(html, /rel="manifest" href="manifest\.webmanifest"/);
  assert.match(html, /rel="apple-touch-icon" href="icons\/apple-touch-icon\.png"/);
  assert.match(html, /apple-mobile-web-app-capable/);
  assert.match(html, /viewport-fit=cover/);
  assert.match(html, /src="pwa\.js"/);
  const pwa = fs.readFileSync(new URL('./pwa.js', import.meta.url), 'utf8');
  assert.match(pwa, /register\('\.\/sw\.js', \{ scope: '\.\/'/);
  assert.match(html, /data-pwa-install/);
  assert.match(html, /id="pwaUpdate"/);
  assert.match(html, /id="pwaReload"/);
});
