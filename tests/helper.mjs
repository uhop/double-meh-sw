export const json = (data, init = {}) =>
  new Response(JSON.stringify(data), {
    status: init.status || 200,
    headers: {'content-type': 'application/json', ...(init.headers || {})}
  });

// Cache-API-shaped in-memory mock: url-keyed, no Vary logic — enough for tier semantics
export const mockCaches = () => {
  const stores = new Map();
  return {
    open: async name => {
      let store = stores.get(name);
      if (!store) stores.set(name, (store = new Map()));
      const keyOf = target => (typeof target === 'string' ? target : target.url);
      return {
        match: async target => {
          const hit = store.get(keyOf(target));
          return hit && hit.clone();
        },
        put: async (target, response) => void store.set(keyOf(target), response),
        delete: async target => store.delete(keyOf(target)),
        keys: async () => [...store.keys()].map(url => new Request(url))
      };
    }
  };
};

export const fakeScope = () => {
  const listeners = {};
  const scope = {
    addEventListener: (type, fn) => {
      (listeners[type] = listeners[type] || []).push(fn);
    },
    dispatch: (type, event) => {
      for (const fn of listeners[type] || []) fn(event);
      return event;
    },
    skipWaitingCalls: 0,
    skipWaiting() {
      ++this.skipWaitingCalls;
    },
    claimed: 0,
    clients: {
      claim: async () => void ++scope.claimed
    },
    registration: {scope: 'https://app.example.com/'}
  };
  return scope;
};

export const fetchEvent = (request, clientId = 'tab-1') => {
  const event = {
    request,
    clientId,
    response: undefined,
    waited: [],
    respondWith(promise) {
      this.response = Promise.resolve(promise);
    },
    waitUntil(promise) {
      this.waited.push(promise);
    }
  };
  return event;
};

export const upstreamOf = routes => {
  const calls = [];
  const fetcher = async request => {
    const url = new URL(request.url);
    calls.push(request.method + ' ' + url.pathname);
    const route = routes[url.pathname];
    return route ? route(request) : new Response('not found', {status: 404});
  };
  fetcher.calls = calls;
  return fetcher;
};

export const tick = () => new Promise(resolve => setTimeout(resolve, 0));
export const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
