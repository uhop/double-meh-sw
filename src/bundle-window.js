// @ts-self-types="./bundle-window.d.ts"
import {REQUEST_MIME, BUNDLE_MIME, buildDoc, toResponse} from './wire.js';

// SW-side transparent bundling for pages without double-meh: collect eligible GET fetch events
// in a micro-window, send one bundle, fan the parts back. Degrades to direct fetches on any
// bundler trouble — a SW must never break pages it did not have to touch.
export const createBundleWindow = (options = {}) => {
  const {
    url,
    fetch: upstream = globalThis.fetch,
    waitTime = 10,
    maxSize = 20,
    minSize = 2,
    onPart
  } = /** @type {import('./bundle-window.d.ts').BundleWindowOptions} */ (options);
  if (!url) throw new TypeError('double-meh-sw: the bundle window needs the bundler url');
  let pool = null;
  let counter = 0;

  const direct = waiter => waiter.resolve(Promise.resolve(upstream(waiter.request)));

  const flush = async () => {
    if (!pool) return;
    const {waiters, timer} = pool;
    pool = null;
    clearTimeout(timer);
    if (waiters.length < Math.max(Math.min(minSize, maxSize), 1)) {
      waiters.forEach(direct);
      return;
    }
    let doc;
    try {
      const response = await upstream(
        new Request(url, {
          method: 'PUT',
          headers: {'Content-Type': REQUEST_MIME, Accept: BUNDLE_MIME},
          body: JSON.stringify(buildDoc(waiters))
        })
      );
      if (!response.ok) throw new Error('bundler answered ' + response.status);
      doc = await response.json();
      if (!doc || !Array.isArray(doc.parts)) throw new Error('not a bundle payload');
    } catch {
      waiters.forEach(direct);
      return;
    }
    const byId = new Map(waiters.map(waiter => [waiter.id, waiter]));
    for (const part of doc.parts) {
      const waiter = part.id != null ? byId.get(part.id) : undefined;
      const response = toResponse(part);
      if (onPart && part.url && !part.synthetic) onPart(part, response.clone());
      if (waiter) {
        byId.delete(waiter.id);
        waiter.resolve(response);
      }
    }
    for (const waiter of byId.values()) direct(waiter);
  };

  const intake = request => {
    return new Promise(resolve => {
      const waiter = {id: 'w' + ++counter, request, resolve};
      if (!pool) pool = {waiters: [], timer: setTimeout(flush, waitTime)};
      pool.waiters.push(waiter);
      if (pool.waiters.length >= maxSize) flush();
    });
  };

  return {intake, flush, pending: () => (pool ? pool.waiters.length : 0)};
};
