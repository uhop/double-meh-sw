// @ts-self-types="./cache-tier.d.ts"

const urlOf = target => (typeof target === 'string' ? target : target.url);

export const createCacheTier = (options = {}) => {
  const {
    cacheName = 'io-shared',
    caches: cachesImpl,
    store
  } = /** @type {import('./cache-tier.d.ts').CacheTierOptions} */ (options);
  const open = () => (cachesImpl || globalThis.caches).open(cacheName);

  const handleFetch = async request => {
    if (request.headers.get('x-io-no-cache')) return undefined;
    const cache = await open();
    return cache.match(request);
  };

  const put = async (target, response) => {
    if (!response || response.status < 200 || response.status >= 300) return false;
    const cache = await open();
    await cache.put(urlOf(target), response);
    return true;
  };

  // network responses are stored only when the `store` predicate opts them in: the tier is
  // serve-first by design — writers are the bundle unpack, the transport, and page write-through
  const maybeStore = async (request, response) => {
    if (typeof store !== 'function' || !store(request, response)) return false;
    return put(request, response.clone());
  };

  const invalidate = async pattern => {
    const cache = await open();
    if (typeof cache.keys !== 'function') {
      // Deno CLI ships the Cache API without keys(): exact-URL eviction is the honest fallback
      return (await cache.delete(String(pattern))) ? 1 : 0;
    }
    const test =
      typeof pattern === 'function'
        ? pattern
        : pattern instanceof RegExp
          ? url => pattern.test(url)
          : url => url.startsWith(String(pattern));
    let evicted = 0;
    for (const request of await cache.keys()) {
      if (test(request.url)) {
        await cache.delete(request);
        ++evicted;
      }
    }
    return evicted;
  };

  return {cacheName, handleFetch, put, maybeStore, invalidate};
};
