// @ts-self-types="./messages.d.ts"
import {CONTRACT_VERSION, MESSAGES, CHANNEL, CAPABILITIES} from './contract.js';

export const createMessageHub = (options = {}) => {
  const {
    version = '0',
    cacheTier,
    scope = globalThis,
    capabilities = CAPABILITIES,
    channelName = CHANNEL,
    fetch: upstream = globalThis.fetch
  } = /** @type {import('./messages.d.ts').MessageHubOptions} */ (options);
  const worker = /** @type {{skipWaiting?: () => void | Promise<void>}} */ (scope);
  // clients that announced a double-meh library take ownership of bundling (client-wins)
  const libraryClients = new Set();
  const channel =
    typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(channelName) : null;

  const isLibraryClient = clientId => libraryClients.has(clientId);

  const reply = (event, payload) => {
    const target = (event.ports && event.ports[0]) || event.source;
    if (target && typeof target.postMessage === 'function') target.postMessage(payload);
  };

  const transport = async (event, data) => {
    const port = event.ports && event.ports[0];
    if (!port) return;
    try {
      const request = new Request(data.url, {
        method: data.method || 'GET',
        headers: data.headers || {}
      });
      const response = await upstream(request);
      if (cacheTier && request.method === 'GET') await cacheTier.put(request, response.clone());
      const body = await response.arrayBuffer();
      const message = {
        type: MESSAGES.result,
        id: data.id,
        status: response.status,
        statusText: response.statusText,
        headers: [...response.headers],
        body
      };
      // the body transfers, not copies — this is the navigation-surviving prefetch path
      port.postMessage(message, [body]);
    } catch (error) {
      port.postMessage({
        type: MESSAGES.result,
        id: data.id,
        error: String(error?.message || error)
      });
    }
  };

  const handleMessage = event => {
    const data = event.data;
    if (!data || typeof data.type !== 'string') return undefined;
    switch (data.type) {
      case MESSAGES.hello: {
        const clientId = (event.source && event.source.id) || data.clientId;
        if (data.library && clientId) libraryClients.add(clientId);
        reply(event, {
          type: MESSAGES.hello,
          v: CONTRACT_VERSION,
          version,
          capabilities: [...capabilities]
        });
        return undefined;
      }
      case MESSAGES.invalidate:
        return (async () => {
          const evicted = cacheTier ? await cacheTier.invalidate(data.pattern ?? '') : 0;
          const note = {type: MESSAGES.invalidated, pattern: data.pattern, evicted};
          if (channel) channel.postMessage(note);
          reply(event, note);
        })();
      case MESSAGES.version:
        reply(event, {type: MESSAGES.version, current: version, v: CONTRACT_VERSION});
        return undefined;
      case MESSAGES.upgrade:
        return Promise.resolve(worker.skipWaiting && worker.skipWaiting()).then(() => {
          reply(event, {type: MESSAGES.upgrade, done: true});
        });
      case MESSAGES.fetch:
        return transport(event, data);
    }
    return undefined;
  };

  return {handleMessage, isLibraryClient, clients: libraryClients};
};
