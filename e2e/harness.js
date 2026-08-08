// Real Chromium -> the real registered SW (this repo's src) -> intercepted fetches bundled through
// the real double-meh-bundler -> a real second upstream HTTP hop. Every wire is real; the counters
// are what make each hop observable from the assertions.
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {dirname, resolve, join, extname} from 'node:path';

import {createBundler} from 'double-meh-bundler';
import {toNodeHandler} from 'double-meh-bundler/node.js';
import {chromium} from 'playwright';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const MIME = {'.js': 'text/javascript', '.html': 'text/html', '.json': 'application/json'};

const PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>sw e2e</title></head><body>ok</body></html>`;

export const SW_SOURCE = `import {install} from '/src/sw.js';
install({
  version: 'e2e-1',
  cache: {cacheName: 'e2e-shared'},
  bundler: {url: '/bundle', match: self.location.origin + '/api/'}
});`;

const json = data => JSON.stringify(data);
const bump = (map, key) => (map[key] = (map[key] || 0) + 1);

export const snapshot = counters => structuredClone(counters);

export const withPage = async body => {
  const counters = {bundlePuts: 0, apiDirect: {}, internal: {}};
  let port = 0;
  const bundle = toNodeHandler(
    createBundler({
      isUrlAcceptable: url => new URL(url, 'http://x').pathname.startsWith('/api/'),
      resolveUrl: url =>
        new URL(
          new URL(url, 'http://x').pathname.replace('/api/', '/internal/'),
          `http://127.0.0.1:${port}`
        ).href
      // upstream fetch: the default global fetch — a REAL second HTTP hop
    })
  );

  const server = createServer(async (request, response) => {
    const path = new URL(request.url, `http://${request.headers.host}`).pathname;
    if (path === '/bundle') {
      ++counters.bundlePuts;
      return void bundle(request, response);
    }
    if (path.startsWith('/internal/')) {
      const key = path.slice('/internal/'.length);
      bump(counters.internal, key);
      response.setHeader('content-type', 'application/json');
      return void response.end(json({route: path, hop: 'internal', n: counters.internal[key]}));
    }
    if (path.startsWith('/api/')) {
      bump(counters.apiDirect, path.slice('/api/'.length));
      response.setHeader('content-type', 'application/json');
      return void response.end(json({route: path, hop: 'direct'}));
    }
    if (path === '/e2e/page.html') {
      response.setHeader('content-type', 'text/html');
      return void response.end(PAGE);
    }
    if (path === '/e2e/sw.js') {
      response.setHeader('content-type', 'text/javascript');
      return void response.end(SW_SOURCE);
    }
    try {
      const file = await readFile(join(ROOT, path));
      response.setHeader('content-type', MIME[extname(path)] || 'application/octet-stream');
      response.end(file);
    } catch {
      response.statusCode = 404;
      response.end('nf');
    }
  });

  await new Promise(done => server.listen(0, '127.0.0.1', done));
  port = server.address().port;
  const base = `http://127.0.0.1:${port}`;

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    page.on('pageerror', error => console.log('[pageerror]', error.message));
    await page.goto(base + '/e2e/page.html');
    const controlled = await page.evaluate(async () => {
      await navigator.serviceWorker.register('/e2e/sw.js', {type: 'module', scope: '/e2e/'});
      await navigator.serviceWorker.ready;
      if (!navigator.serviceWorker.controller) {
        await new Promise(done =>
          navigator.serviceWorker.addEventListener('controllerchange', done, {once: true})
        );
      }
      return !!navigator.serviceWorker.controller;
    });
    return await body({page, base, counters, controlled});
  } finally {
    await browser.close();
    await new Promise(done => server.close(done));
  }
};
