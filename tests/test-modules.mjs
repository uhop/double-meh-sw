import test from 'tape-six';

import {stripEnrichment} from '../src/contract.js';
import {buildDoc, toResponse} from '../src/wire.js';
import {createCacheTier} from '../src/cache-tier.js';
import {createCoalescer} from '../src/coalesce.js';
import {createBundleWindow} from '../src/bundle-window.js';
import {json, mockCaches, upstreamOf, sleep} from './helper.mjs';

const BASE = 'https://app.example.com';

test('contract: stripEnrichment removes only x-io-* headers', async t => {
  const request = new Request(BASE + '/a', {
    headers: {accept: 'application/json', 'x-io-bundle': 'grp', 'x-io-no-cache': '1'}
  });
  const stripped = stripEnrichment(request);
  t.equal(stripped.headers.get('accept'), 'application/json', 'real headers survive');
  t.equal(stripped.headers.get('x-io-bundle'), null, 'enrichment stripped');
  const plain = new Request(BASE + '/b', {headers: {accept: 'text/csv'}});
  t.equal(stripEnrichment(plain), plain, 'no enrichment: the same request comes back');
});

test('wire: doc build and part decode round the format', async t => {
  const doc = buildDoc([
    {
      id: 'w1',
      request: new Request(BASE + '/a', {
        headers: {accept: 'application/json', 'if-none-match': '"v1"', 'x-io-noise': 'no'}
      })
    }
  ]);
  t.equal(doc.v, 1, 'v1');
  t.deepEqual(
    doc.parts[0],
    {
      id: 'w1',
      url: BASE + '/a',
      method: 'GET',
      headers: {accept: 'application/json', 'if-none-match': '"v1"'}
    },
    'whitelisted headers only'
  );
  const ok = toResponse({url: BASE + '/a', status: 200, headers: {etag: '"x"'}, body: {a: 1}});
  t.deepEqual(await ok.json(), {a: 1}, 'inline JSON decodes');
  t.equal(ok.headers.get('etag'), '"x"', 'part headers ride');
  const notModified = toResponse({url: BASE + '/a', status: 304, headers: {etag: '"x"'}});
  t.equal(notModified.status, 304, '304 reconstructs bodyless');
});

test('cache tier: serve-first, opt-in store, pattern invalidation', async t => {
  const tier = createCacheTier({
    caches: mockCaches(),
    store: request => request.url.endsWith('/keep')
  });
  const request = new Request(BASE + '/a');
  t.equal(await tier.handleFetch(request), undefined, 'miss passes');
  t.ok(await tier.put(request, json({a: 1})), '2xx stored');
  t.notOk(await tier.put(BASE + '/bad', json({}, {status: 404})), 'non-2xx refused');
  const hit = await tier.handleFetch(request);
  t.deepEqual(await hit.json(), {a: 1}, 'hit serves');
  const optOut = new Request(BASE + '/a', {headers: {'x-io-no-cache': '1'}});
  t.equal(await tier.handleFetch(optOut), undefined, 'x-io-no-cache bypasses');
  t.notOk(await tier.maybeStore(new Request(BASE + '/drop'), json({})), 'store predicate gates');
  t.ok(await tier.maybeStore(new Request(BASE + '/keep'), json({})), 'store predicate admits');
  await tier.put(BASE + '/users/1', json({}));
  await tier.put(BASE + '/users/2', json({}));
  t.equal(await tier.invalidate(BASE + '/users/'), 2, 'prefix eviction counts');
  t.equal(await tier.handleFetch(new Request(BASE + '/users/1')), undefined, 'evicted');
});

test('coalescer: one upstream call, every caller its own body', async t => {
  const upstream = upstreamOf({'/a': () => json({n: 1})});
  const coalescer = createCoalescer();
  const request = new Request(BASE + '/a');
  const [first, second, third] = await Promise.all([
    coalescer.run(request, () => upstream(request)),
    coalescer.run(request, () => upstream(request)),
    coalescer.run(request, () => upstream(request))
  ]);
  t.equal(upstream.calls.length, 1, 'one wire call for three consumers');
  t.deepEqual(await first.json(), {n: 1}, 'first body');
  t.deepEqual(await second.json(), {n: 1}, 'second body — its own clone');
  t.deepEqual(await third.json(), {n: 1}, 'third body');
  await coalescer.run(request, () => upstream(request));
  t.equal(upstream.calls.length, 2, 'a later call flies fresh');
});

test('bundle window: batches, settles by id, feeds the part hook', async t => {
  const parts = [];
  const upstream = upstreamOf({
    '/bundle': async request => {
      const doc = JSON.parse(await request.text());
      return new Response(
        JSON.stringify({
          v: 1,
          parts: doc.parts.map(part => ({
            id: part.id,
            url: part.url,
            status: 200,
            headers: {'content-type': 'application/json'},
            body: {from: new URL(part.url).pathname}
          }))
        }),
        {headers: {'content-type': 'application/vnd.double-meh.bundle+json'}}
      );
    }
  });
  const window = createBundleWindow({
    url: BASE + '/bundle',
    fetch: upstream,
    waitTime: 5,
    onPart: part => parts.push(part.url)
  });
  const [a, b] = await Promise.all([
    window.intake(new Request(BASE + '/a')),
    window.intake(new Request(BASE + '/b'))
  ]);
  t.deepEqual(await a.json(), {from: '/a'}, 'first part');
  t.deepEqual(await b.json(), {from: '/b'}, 'second part');
  t.deepEqual(upstream.calls, ['PUT /bundle'], 'one bundle PUT, no direct GETs');
  t.deepEqual(parts, [BASE + '/a', BASE + '/b'], 'the part hook saw both');
});

test('bundle window: a lone request degrades to a direct fetch', async t => {
  const upstream = upstreamOf({'/a': () => json({direct: true})});
  const window = createBundleWindow({url: BASE + '/bundle', fetch: upstream, waitTime: 5});
  const response = await window.intake(new Request(BASE + '/a'));
  t.deepEqual(await response.json(), {direct: true}, 'served directly');
  t.deepEqual(upstream.calls, ['GET /a'], 'no bundle attempted below minSize');
});

test('bundle window: bundler trouble falls back to direct fetches', async t => {
  const upstream = upstreamOf({
    '/bundle': () => json({boom: true}, {status: 500}),
    '/a': () => json({saved: 'a'}),
    '/b': () => json({saved: 'b'})
  });
  const window = createBundleWindow({url: BASE + '/bundle', fetch: upstream, waitTime: 5});
  const [a, b] = await Promise.all([
    window.intake(new Request(BASE + '/a')),
    window.intake(new Request(BASE + '/b'))
  ]);
  t.deepEqual(await a.json(), {saved: 'a'}, 'first fell back');
  t.deepEqual(await b.json(), {saved: 'b'}, 'second fell back');
  t.equal(upstream.calls[0], 'PUT /bundle', 'the bundle was attempted');
  t.ok(upstream.calls.includes('GET /a') && upstream.calls.includes('GET /b'), 'directs followed');
});

test('bundle window: a missing part falls back for its waiter only', async t => {
  const upstream = upstreamOf({
    '/bundle': async request => {
      const doc = JSON.parse(await request.text());
      const kept = doc.parts.filter(part => !part.url.endsWith('/b'));
      return new Response(
        JSON.stringify({
          v: 1,
          parts: kept.map(part => ({
            id: part.id,
            url: part.url,
            status: 200,
            headers: {'content-type': 'application/json'},
            body: {ok: true}
          }))
        }),
        {headers: {'content-type': 'application/vnd.double-meh.bundle+json'}}
      );
    },
    '/b': () => json({fallback: true})
  });
  const window = createBundleWindow({url: BASE + '/bundle', fetch: upstream, waitTime: 5});
  const [a, b] = await Promise.all([
    window.intake(new Request(BASE + '/a')),
    window.intake(new Request(BASE + '/b'))
  ]);
  t.deepEqual(await a.json(), {ok: true}, 'present part served');
  t.deepEqual(await b.json(), {fallback: true}, 'omitted part refetched directly');
});

test('bundle window: maxSize flushes early', async t => {
  const upstream = upstreamOf({
    '/bundle': async request => {
      const doc = JSON.parse(await request.text());
      return new Response(
        JSON.stringify({
          v: 1,
          parts: doc.parts.map(part => ({id: part.id, url: part.url, status: 204}))
        }),
        {headers: {'content-type': 'application/vnd.double-meh.bundle+json'}}
      );
    }
  });
  const window = createBundleWindow({
    url: BASE + '/bundle',
    fetch: upstream,
    waitTime: 1000,
    maxSize: 2
  });
  const settled = Promise.all([
    window.intake(new Request(BASE + '/a')),
    window.intake(new Request(BASE + '/b'))
  ]);
  await sleep(20);
  const [a, b] = await settled;
  t.equal(a.status, 204, 'flushed without waiting for the window');
  t.equal(b.status, 204, 'both parts back');
  t.deepEqual(upstream.calls, ['PUT /bundle'], 'one PUT at maxSize');
});
