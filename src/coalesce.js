// @ts-self-types="./coalesce.d.ts"

// cross-tab in-flight coalescing: every tab's fetches pass through one SW, so identical
// concurrent GETs collapse to a single upstream request; each consumer gets its own clone
export const createCoalescer = () => {
  const flying = new Map();

  const keyOf = request =>
    request.method + ' ' + request.url + ' ' + (request.headers.get('accept') || '');

  const run = (request, fn) => {
    const key = keyOf(request);
    let shared = flying.get(key);
    if (!shared) {
      shared = Promise.resolve()
        .then(fn)
        .finally(() => flying.delete(key));
      flying.set(key, shared);
    }
    return shared.then(response => response.clone());
  };

  return {run, inFlight: () => flying.size};
};
