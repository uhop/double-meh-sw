// @ts-self-types="./wire.d.ts"
// The double-meh bundle wire format v1 — deliberately library-independent; the normative spec
// lives in the double-meh design record and the double-meh-bundler wiki.

export const REQUEST_MIME = 'application/vnd.double-meh.bundle-request+json';
export const BUNDLE_MIME = 'application/vnd.double-meh.bundle+json';

const PART_HEADERS = ['accept', 'accept-language', 'if-none-match', 'if-modified-since'];

export const buildDoc = entries => ({
  v: 1,
  parts: entries.map(({id, request}) => {
    const headers = {};
    for (const name of PART_HEADERS) {
      const value = request.headers.get(name);
      if (value != null) headers[name] = value;
    }
    return {id, url: request.url, method: 'GET', headers};
  })
});

const decodeBody = part => {
  if (part.body == null) return null;
  if (part.encoding === 'base64')
    return Uint8Array.from(atob(String(part.body)), c => c.charCodeAt(0));
  if (typeof part.body === 'string') return part.body;
  return JSON.stringify(part.body);
};

export const toResponse = part => {
  const status = part.status || 200;
  const body = status === 204 || status === 304 ? null : decodeBody(part);
  return new Response(body, {
    status,
    statusText: part.statusText || '',
    headers: part.headers || {}
  });
};

export const isBundlePayload = response =>
  ((response && response.headers.get('content-type')) || '').startsWith(BUNDLE_MIME);
