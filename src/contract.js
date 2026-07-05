// @ts-self-types="./contract.d.ts"

export const CONTRACT_VERSION = 1;

export const MESSAGES = {
  hello: 'io:hello',
  invalidate: 'io:invalidate',
  invalidated: 'io:invalidated',
  version: 'io:version',
  upgrade: 'io:upgrade',
  fetch: 'io:fetch',
  result: 'io:result'
};

export const CHANNEL = 'io';

export const CAPABILITIES = ['cache', 'coalesce', 'bundle', 'invalidate', 'version', 'transport'];

// the per-request data plane: negotiated, stripped before the wire, harmless if leaked
export const ENRICHMENT_PREFIX = 'x-io-';

export const matches = (match, url) =>
  match == null ||
  (typeof match === 'string'
    ? url.startsWith(match)
    : match instanceof RegExp
      ? match.test(url)
      : !!match(url));

export const stripEnrichment = request => {
  let found = false;
  for (const key of request.headers.keys()) {
    if (key.startsWith(ENRICHMENT_PREFIX)) {
      found = true;
      break;
    }
  }
  if (!found) return request;
  const headers = new Headers();
  for (const [key, value] of request.headers) {
    if (!key.startsWith(ENRICHMENT_PREFIX)) headers.append(key, value);
  }
  return new Request(request.url, {method: request.method, headers});
};
