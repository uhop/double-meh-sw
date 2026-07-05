import test from 'tape-six';

import {install} from '../src/sw.js';
import {createMessageHub} from '../src/messages.js';
import {createCacheTier} from '../src/cache-tier.js';
import {MESSAGES, CONTRACT_VERSION} from '../src/contract.js';
import {json, mockCaches, fakeScope, fetchEvent, upstreamOf, tick} from './helper.mjs';

const BASE = 'https://app.example.com';

const bundlerRoute = async request => {
  const doc = JSON.parse(await request.text());
  return new Response(
    JSON.stringify({
      v: 1,
      parts: doc.parts.map(part => ({
        id: part.id,
        url: part.url,
        status: 200,
        headers: {'content-type': 'application/json'},
        body: {via: 'bundle', path: new URL(part.url).pathname}
      }))
    }),
    {headers: {'content-type': 'application/vnd.double-meh.bundle+json'}}
  );
};

test('install: cache tier first, bundling second, coalesced network last', async t => {
  const scope = fakeScope();
  const upstream = upstreamOf({'/bundle': bundlerRoute, '/plain': () => json({net: true})});
  const sw = install({
    scope,
    fetch: upstream,
    cache: {caches: mockCaches()},
    bundler: {url: BASE + '/bundle', match: BASE + '/api/', waitTime: 5}
  });
  await sw.cacheTier.put(BASE + '/cached', json({hit: true}));

  const cachedEvent = scope.dispatch('fetch', fetchEvent(new Request(BASE + '/cached')));
  t.deepEqual(await (await cachedEvent.response).json(), {hit: true}, 'cache serves first');

  const apiA = scope.dispatch('fetch', fetchEvent(new Request(BASE + '/api/a')));
  const apiB = scope.dispatch('fetch', fetchEvent(new Request(BASE + '/api/b')));
  const [a, b] = await Promise.all([apiA.response, apiB.response]);
  t.deepEqual(await a.json(), {via: 'bundle', path: '/api/a'}, 'matched request bundled');
  t.deepEqual(await b.json(), {via: 'bundle', path: '/api/b'}, 'second part decoded');
  t.deepEqual(upstream.calls, ['PUT /bundle'], 'one bundle PUT so far');

  const plain = scope.dispatch('fetch', fetchEvent(new Request(BASE + '/plain')));
  t.deepEqual(await (await plain.response).json(), {net: true}, 'unmatched goes to the network');

  const bundledPart = await sw.cacheTier.handleFetch(new Request(BASE + '/api/a'));
  t.ok(bundledPart, 'parts landed in the shared tier');
  t.deepEqual(await bundledPart.json(), {via: 'bundle', path: '/api/a'}, 'with their bodies');
});

test('install: respondWith gating — non-GET, cross-origin, navigation pass', async t => {
  const scope = fakeScope();
  const upstream = upstreamOf({});
  install({scope, fetch: upstream, cache: {caches: mockCaches()}});
  const post = scope.dispatch(
    'fetch',
    fetchEvent(new Request(BASE + '/x', {method: 'POST', body: '{}'}))
  );
  t.equal(post.response, undefined, 'POST passes to the browser');
  const foreign = scope.dispatch(
    'fetch',
    fetchEvent(new Request('https://cdn.example.net/lib.js'))
  );
  t.equal(foreign.response, undefined, 'cross-origin passes');
  const nav = fetchEvent(new Request(BASE + '/page'));
  nav.request = Object.assign(new Request(BASE + '/page'), {});
  Object.defineProperty(nav.request, 'mode', {value: 'navigate'});
  const navEvent = scope.dispatch('fetch', nav);
  t.equal(navEvent.response, undefined, 'navigation passes');
  t.equal(upstream.calls.length, 0, 'nothing reached the upstream');
});

test('install: client-wins — a double-meh page is never SW-bundled', async t => {
  const scope = fakeScope();
  const upstream = upstreamOf({'/bundle': bundlerRoute, '/api/a': () => json({direct: true})});
  const sw = install({
    scope,
    fetch: upstream,
    cache: {caches: mockCaches()},
    bundler: {url: BASE + '/bundle', match: BASE + '/api/', waitTime: 5, minSize: 1}
  });
  sw.hub.handleMessage({
    data: {type: MESSAGES.hello, library: 'double-meh'},
    source: {id: 'tab-lib', postMessage() {}}
  });
  const event = scope.dispatch('fetch', fetchEvent(new Request(BASE + '/api/a'), 'tab-lib'));
  t.deepEqual(await (await event.response).json(), {direct: true}, 'served, not bundled');
  t.deepEqual(upstream.calls, ['GET /api/a'], 'a direct GET — the library owns bundling');
});

test('messages: hello, version, upgrade, invalidate broadcast', async t => {
  const scope = fakeScope();
  const tier = createCacheTier({caches: mockCaches()});
  await tier.put(BASE + '/users/1', json({}));
  const hub = createMessageHub({version: '7.7.7', cacheTier: tier, scope});
  const replies = [];
  const source = {id: 'tab-1', postMessage: message => replies.push(message)};

  hub.handleMessage({data: {type: MESSAGES.hello, library: 'double-meh'}, source});
  t.equal(replies[0].type, MESSAGES.hello, 'hello answered');
  t.equal(replies[0].v, CONTRACT_VERSION, 'contract version rides');
  t.ok(replies[0].capabilities.includes('bundle'), 'capabilities announced');
  t.ok(hub.isLibraryClient('tab-1'), 'library client recorded');

  hub.handleMessage({data: {type: MESSAGES.version}, source});
  t.equal(replies[1].current, '7.7.7', 'version answered');

  await hub.handleMessage({data: {type: MESSAGES.upgrade}, source});
  t.equal(scope.skipWaitingCalls, 1, 'upgrade calls skipWaiting');

  await hub.handleMessage({data: {type: MESSAGES.invalidate, pattern: BASE + '/users/'}, source});
  const note = replies.find(reply => reply.type === MESSAGES.invalidated);
  t.equal(note.evicted, 1, 'invalidation evicted and reported');
  t.equal(await tier.handleFetch(new Request(BASE + '/users/1')), undefined, 'entry gone');
});

test('messages: the io:fetch transport replies over the port and seeds the tier', async t => {
  const tier = createCacheTier({caches: mockCaches()});
  const upstream = upstreamOf({'/prefetch': () => json({later: true}, {headers: {etag: '"p1"'}})});
  const hub = createMessageHub({cacheTier: tier, fetch: upstream});
  const messages = [];
  const port = {postMessage: (message, transfer) => messages.push({message, transfer})};
  await hub.handleMessage({
    data: {type: MESSAGES.fetch, id: 'f1', url: BASE + '/prefetch'},
    ports: [port]
  });
  const {message, transfer} = messages[0];
  t.equal(message.type, MESSAGES.result, 'result message');
  t.equal(message.id, 'f1', 'correlated by id');
  t.equal(message.status, 200, 'status rides');
  t.deepEqual(JSON.parse(new TextDecoder().decode(message.body)), {later: true}, 'body rides');
  t.equal(transfer[0], message.body, 'the body transfers, not copies');
  const seeded = await tier.handleFetch(new Request(BASE + '/prefetch'));
  t.ok(seeded, 'the tier was seeded — the navigation-surviving prefetch');
  t.equal(seeded.headers.get('etag'), '"p1"', 'with its headers');
});

test('messages: transport failure reports over the port', async t => {
  const hub = createMessageHub({
    fetch: () => {
      throw new Error('offline');
    }
  });
  const messages = [];
  await hub.handleMessage({
    data: {type: MESSAGES.fetch, id: 'f2', url: BASE + '/x'},
    ports: [{postMessage: message => messages.push(message)}]
  });
  t.equal(messages[0].id, 'f2', 'correlated');
  t.ok(/offline/.test(messages[0].error), 'the failure message rides');
});

test('install: activate claims clients; message events waitUntil async work', async t => {
  const scope = fakeScope();
  install({scope, cache: {caches: mockCaches()}, fetch: upstreamOf({})});
  const activate = {
    waited: [],
    waitUntil(promise) {
      this.waited.push(promise);
    }
  };
  scope.dispatch('activate', activate);
  await Promise.all(activate.waited);
  t.equal(scope.claimed, 1, 'clients claimed on activate');
  const message = {
    data: {type: MESSAGES.invalidate, pattern: BASE + '/'},
    source: {id: 't', postMessage() {}},
    waited: [],
    waitUntil(promise) {
      this.waited.push(promise);
    }
  };
  scope.dispatch('message', message);
  t.equal(message.waited.length, 1, 'async message work is waitUntil-ed');
  await Promise.all(message.waited);
  await tick();
});
