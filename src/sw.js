// @ts-self-types="./sw.d.ts"
import {matches, stripEnrichment} from './contract.js';
import {BUNDLE_MIME} from './wire.js';
import {createCacheTier} from './cache-tier.js';
import {createCoalescer} from './coalesce.js';
import {createBundleWindow} from './bundle-window.js';
import {createMessageHub} from './messages.js';

const sameOrigin = (url, base) => {
  try {
    return new URL(url).origin === new URL(base).origin;
  } catch {
    return false;
  }
};

export const install = (rawOptions = {}) => {
  const options = /** @type {import('./sw.d.ts').InstallOptions} */ (rawOptions);
  const scope =
    /** @type {NonNullable<import('./sw.d.ts').InstallOptions['scope']> & {clients?: {claim(): Promise<void>}, registration?: {scope: string}}} */ (
      options.scope || /** @type {unknown} */ (globalThis)
    );
  const upstream = options.fetch || (request => globalThis.fetch(request));
  const cacheTier = createCacheTier(options.cache);
  const coalescer = createCoalescer();
  const hub = createMessageHub({
    version: options.version,
    cacheTier,
    scope,
    fetch: upstream
  });
  const bundler = options.bundler;
  const bundle = bundler
    ? createBundleWindow({
        ...bundler,
        fetch: upstream,
        // claimed and unclaimed parts alike land in the shared tier — that is the tier's point
        onPart: (part, response) => void cacheTier.put(part.url, response).catch?.(() => {})
      })
    : null;

  // deciding respondWith is synchronous: the matcher is the only gate the SW may consult
  const handles = request => {
    if (request.method !== 'GET') return false;
    if (options.match !== undefined) return matches(options.match, request.url);
    return (
      sameOrigin(request.url, scope.registration?.scope || request.url) &&
      request.mode !== 'navigate'
    );
  };

  const bundleEligible = (request, event) => {
    if (!bundle || !matches(bundler.match, request.url)) return false;
    if ((request.headers.get('accept') || '').startsWith(BUNDLE_MIME)) return false;
    if (request.url === bundler.url) return false;
    // client-wins: pages running double-meh own their bundling; the SW only passes through
    return !hub.isLibraryClient(event.clientId);
  };

  const serve = async (request, event) => {
    const cached = await cacheTier.handleFetch(request);
    if (cached) return cached;
    if (bundleEligible(request, event)) return bundle.intake(stripEnrichment(request));
    const outgoing = stripEnrichment(request);
    const response = await coalescer.run(outgoing, () => upstream(outgoing));
    await cacheTier.maybeStore(request, response);
    return response;
  };

  scope.addEventListener('fetch', event => {
    if (!handles(event.request)) return;
    event.respondWith(serve(event.request, event));
  });

  scope.addEventListener('message', event => {
    const pending = hub.handleMessage(event);
    if (pending && typeof event.waitUntil === 'function') event.waitUntil(pending);
  });

  scope.addEventListener('activate', event => {
    if (options.claim === false) return;
    const claim = scope.clients && scope.clients.claim && scope.clients.claim();
    if (claim && typeof event.waitUntil === 'function') event.waitUntil(claim);
  });

  return {cacheTier, coalescer, bundle, hub};
};
