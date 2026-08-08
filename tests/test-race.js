import test from 'tape-six';
import 'tape-six-fast-check';

import {install} from '../src/sw.js';
import {createCacheTier} from '../src/cache-tier.js';
import {createCoalescer} from '../src/coalesce.js';
import {createMessageHub} from '../src/messages.js';
import {MESSAGES} from '../src/contract.js';
import {json, mockCaches, fakeScope, fetchEvent} from './helper.js';

const BASE = 'https://app.example.com';

// every Cache API call fires at a scheduler-chosen moment, so the tier's own steps interleave too
const scheduledCaches = (s, inner) => ({
  open: async name => {
    const store = await inner.open(name);
    return {
      match: s.scheduleFunction(target => store.match(target)),
      put: s.scheduleFunction((target, response) => store.put(target, response)),
      delete: s.scheduleFunction(target => store.delete(target)),
      keys: s.scheduleFunction(() => store.keys())
    };
  }
});

test('race: interleaved tab arrivals never put two flights on the wire', async t => {
  await t.scheduler(async s => {
    const coalescer = createCoalescer();
    const request = new Request(BASE + '/api/a');
    const TABS = 4;
    let calls = 0,
      inWire = 0,
      concurrent = 0;
    const upstream = () => {
      const n = ++calls;
      ++inWire;
      concurrent = Math.max(concurrent, inWire);
      return s.schedule(Promise.resolve(json({n})), 'wire ' + n).then(response => {
        --inWire;
        return response;
      });
    };

    const arrivals = [];
    for (let i = 0; i < TABS; ++i) {
      arrivals.push(
        s.schedule(Promise.resolve(), 'tab ' + i).then(() => coalescer.run(request, upstream))
      );
    }
    const responses = await s.waitFor(Promise.all(arrivals));

    // reading every body proves the clones are independent: a shared response would already be used
    const bodies = await Promise.all(responses.map(response => response.json()));
    if (concurrent !== 1) return false;
    if (calls < 1 || calls > TABS) return false;
    if (coalescer.inFlight() !== 0) return false;
    return bodies.every(body => body.n <= calls);
  }, 'one flight at a time, own clone per tab, nothing left in flight');
});

test('race: invalidation evicts every match and nothing else', async t => {
  await t.scheduler(async s => {
    const caches = mockCaches();
    const before = createCacheTier({caches});
    await before.put(BASE + '/users/1', json({seeded: true}));
    await before.put(BASE + '/users/2', json({seeded: true}));
    await before.put(BASE + '/posts/1', json({seeded: true}));

    const tier = createCacheTier({caches: scheduledCaches(s, caches)});
    const broadcasts = [];
    const replies = [];
    const hub = createMessageHub({
      cacheTier: tier,
      channel: {postMessage: message => broadcasts.push(message)}
    });

    const writes = ['/posts/3', '/posts/4'].map(path =>
      s.schedule(Promise.resolve(), 'write ' + path).then(() => tier.put(BASE + path, json({})))
    );
    const invalidated = hub.handleMessage({
      data: {type: MESSAGES.invalidate, pattern: BASE + '/users/'},
      source: {id: 'tab-1', postMessage: message => replies.push(message)}
    });
    await s.waitFor(Promise.all([...writes, invalidated]));

    if (replies.length !== 1 || broadcasts.length !== 1) return false;
    if (replies[0].evicted !== 2) return false;
    const gone = await Promise.all(
      [BASE + '/users/1', BASE + '/users/2'].map(url => before.handleFetch(new Request(url)))
    );
    if (gone.some(Boolean)) return false;
    const kept = await Promise.all(
      [BASE + '/posts/1', BASE + '/posts/3', BASE + '/posts/4'].map(url =>
        before.handleFetch(new Request(url))
      )
    );
    return kept.every(Boolean);
  }, 'the reply, the broadcast and the eviction count all survive any interleaving');
});

test('race: a tab fetch always resolves, whatever the tier is doing around it', async t => {
  await t.scheduler(async s => {
    const scope = fakeScope();
    const upstream = s.scheduleFunction(async request => json({url: request.url}));
    const sw = install({
      scope,
      fetch: upstream,
      channel: null,
      cache: {caches: scheduledCaches(s, mockCaches()), store: () => true}
    });

    const paths = ['/api/a', '/api/b', '/api/a'];
    const events = paths.map((path, i) =>
      scope.dispatch('fetch', fetchEvent(new Request(BASE + path), 'tab-' + i))
    );
    const invalidated = sw.hub.handleMessage({
      data: {type: MESSAGES.invalidate, pattern: BASE + '/api/'},
      source: {id: 'tab-0', postMessage() {}}
    });
    const responses = await s.waitFor(Promise.all(events.map(event => event.response)));
    await s.waitFor(invalidated);

    // the no-op-degradable invariant: a SW must never break a page it did not have to touch
    if (responses.some(response => !response || response.status !== 200)) return false;
    const bodies = await Promise.all(responses.map(response => response.json()));
    return bodies.every((body, i) => body.url === BASE + paths[i]);
  }, 'every respondWith settles with the right response');
});
