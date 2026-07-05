// Manual real-browser E2E: real Chromium -> real registered SW (this repo's src) -> intercepted
// fetches bundled through the real double-meh-bundler -> real upstream HTTP hop; plus the whole
// message contract over real postMessage/MessageChannel/BroadcastChannel.
// Prerequisites (not CI-able until the packages publish): sibling checkouts of double-meh-bundler
// and double-meh (for playwright + its Chromium) next to this repo. Run: node e2e/manual-e2e.mjs
import {fileURLToPath} from 'node:url';
import {dirname, resolve} from 'node:path';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {join, extname} from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const SIBLINGS = resolve(HERE, '../..');
const {createBundler} = await import(SIBLINGS + '/double-meh-bundler/src/index.js');
const {toNodeHandler} = await import(SIBLINGS + '/double-meh-bundler/src/node.js');
const {chromium} = await import(SIBLINGS + '/double-meh/node_modules/playwright/index.mjs');

const SW_ROOT = resolve(HERE, '..');
const MIME = {'.js': 'text/javascript', '.html': 'text/html', '.mjs': 'text/javascript'};
const counters = {bundlePuts: 0, apiDirect: {}, internal: {}};

const json = data => JSON.stringify(data);
const bump = (map, key) => (map[key] = (map[key] || 0) + 1);

let PORT = 0;
const bundle = toNodeHandler(
  createBundler({
    isUrlAcceptable: url => new URL(url, 'http://x').pathname.startsWith('/api/'),
    resolveUrl: url =>
      new URL(
        new URL(url, 'http://x').pathname.replace('/api/', '/internal/'),
        `http://127.0.0.1:${PORT}`
      ).href
    // upstream fetch: the default global fetch — a REAL second HTTP hop
  })
);

const PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>sw e2e</title></head><body>ok</body></html>`;
const SW = `import {install} from '/src/sw.js';
install({
  version: 'e2e-1',
  cache: {cacheName: 'e2e-shared'},
  bundler: {url: '/bundle', match: self.location.origin + '/api/'}
});`;

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const path = url.pathname;
  if (path === '/bundle') {
    ++counters.bundlePuts;
    return void bundle(req, res);
  }
  if (path.startsWith('/internal/')) {
    bump(counters.internal, path.slice('/internal/'.length));
    res.setHeader('content-type', 'application/json');
    return void res.end(json({route: path, hop: 'internal', n: counters.internal[path.slice(10)]}));
  }
  if (path.startsWith('/api/')) {
    bump(counters.apiDirect, path.slice('/api/'.length));
    res.setHeader('content-type', 'application/json');
    return void res.end(json({route: path, hop: 'direct'}));
  }
  if (path === '/e2e/page.html') {
    res.setHeader('content-type', 'text/html');
    return void res.end(PAGE);
  }
  if (path === '/e2e/sw.js') {
    res.setHeader('content-type', 'text/javascript');
    return void res.end(SW);
  }
  try {
    const body = await readFile(join(SW_ROOT, path));
    res.setHeader('content-type', MIME[extname(path)] || 'application/octet-stream');
    res.end(body);
  } catch {
    res.statusCode = 404;
    res.end('nf');
  }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
PORT = server.address().port;
const base = `http://127.0.0.1:${PORT}`;

const browser = await chromium.launch();
const page = await browser.newPage();
page.on('console', message => console.log('[page]', message.text()));
page.on('pageerror', error => console.log('[pageerror]', error.message));
await page.goto(base + '/e2e/page.html');

const results = {};

// register + wait for control
results.controlled = await page.evaluate(async () => {
  await navigator.serviceWorker.register('/e2e/sw.js', {type: 'module', scope: '/e2e/'});
  await navigator.serviceWorker.ready;
  if (!navigator.serviceWorker.controller) {
    await new Promise(resolve =>
      navigator.serviceWorker.addEventListener('controllerchange', resolve, {once: true})
    );
  }
  return !!navigator.serviceWorker.controller;
});

// A: a burst from a library-less page gets SW-bundled through the real bundler
results.burst = await page.evaluate(async () => {
  const [a, b] = await Promise.all([
    fetch('/api/a').then(r => r.json()),
    fetch('/api/b').then(r => r.json())
  ]);
  return {a, b};
});
results.afterBurst = structuredClone(counters);

// B: the shared tier serves the repeat without a wire hit
results.repeat = await page.evaluate(() => fetch('/api/a').then(r => r.json()));
results.afterRepeat = structuredClone(counters);

// C: hello + version + invalidate over the real message plumbing
results.messages = await page.evaluate(async () => {
  const post = message => navigator.serviceWorker.controller.postMessage(message);
  const once = () =>
    new Promise(resolve =>
      navigator.serviceWorker.addEventListener('message', event => resolve(event.data), {
        once: true
      })
    );
  const helloReply = once();
  post({type: 'io:hello'});
  const hello = await helloReply;
  const broadcast = new Promise(resolve => {
    const channel = new BroadcastChannel('io');
    channel.onmessage = event => resolve(event.data);
  });
  const invalidateReply = once();
  post({type: 'io:invalidate', pattern: location.origin + '/api/'});
  const invalidated = await invalidateReply;
  const broadcasted = await broadcast;
  return {hello, invalidated, broadcasted};
});

// D: after eviction a lone request degrades to a direct fetch (minSize) — and is real again
results.afterInvalidate = await page.evaluate(() => fetch('/api/a').then(r => r.json()));
results.afterInvalidateCounters = structuredClone(counters);

// E: the io:fetch transport over a real MessageChannel, body transferred
results.transport = await page.evaluate(async () => {
  const channel = new MessageChannel();
  const reply = new Promise(resolve => (channel.port1.onmessage = event => resolve(event.data)));
  navigator.serviceWorker.controller.postMessage(
    {type: 'io:fetch', id: 't1', url: location.origin + '/api/prefetched'},
    [channel.port2]
  );
  const result = await reply;
  return {
    id: result.id,
    status: result.status,
    body: JSON.parse(new TextDecoder().decode(result.body))
  };
});
results.prefetchServed = await page.evaluate(() => fetch('/api/prefetched').then(r => r.json()));
results.finalCounters = structuredClone(counters);

// F: client-wins — announce a library; the page is never SW-bundled again
results.clientWins = await page.evaluate(async () => {
  navigator.serviceWorker.controller.postMessage({type: 'io:hello', library: 'double-meh'});
  await new Promise(resolve => setTimeout(resolve, 50));
  const [x, y] = await Promise.all([
    fetch('/api/x').then(r => r.json()),
    fetch('/api/y').then(r => r.json())
  ]);
  return {x, y};
});
results.afterClientWins = structuredClone(counters);

await browser.close();
server.close();
console.log(JSON.stringify(results, null, 2));
