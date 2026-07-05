import test from 'tape-six';

import {createCacheTier} from '../src/cache-tier.js';
import {json} from './helper.mjs';

const hasCaches = typeof caches !== 'undefined';
const BASE = 'https://real-caches.example.com';

test('cache tier: against the real Cache API', {skip: !hasCaches}, async t => {
  const tier = createCacheTier({cacheName: 'io-sw-test'});
  await tier.put(BASE + '/a', json({real: true}, {headers: {etag: '"r1"'}}));
  const hit = await tier.handleFetch(new Request(BASE + '/a'));
  t.ok(hit, 'stored and matched through the platform');
  t.deepEqual(await hit.json(), {real: true}, 'body intact');
  t.equal(hit.headers.get('etag'), '"r1"', 'headers intact');
  t.equal(await tier.invalidate(BASE + '/a'), 1, 'platform eviction works (prefix or exact)');
  await caches.delete('io-sw-test').catch(() => {});
});
