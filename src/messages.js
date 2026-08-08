// @ts-self-types="./messages.d.ts"
import {CONTRACT_VERSION, MESSAGES, CHANNEL, CAPABILITIES, STREAM_CAPABILITY} from './contract.js';

let transferableStreams;

// a transferred stream is backed by a port pair: cancel the probe's clone or Deno never exits
export const supportsTransferableStreams = () => {
  if (transferableStreams === undefined) {
    try {
      const stream = new ReadableStream();
      structuredClone(stream, {transfer: [stream]}).cancel();
      transferableStreams = true;
    } catch {
      transferableStreams = false;
    }
  }
  return transferableStreams;
};

export const createMessageHub = (options = {}) => {
  const {
    version = '0',
    cacheTier,
    scope = globalThis,
    capabilities = supportsTransferableStreams()
      ? [...CAPABILITIES, STREAM_CAPABILITY]
      : CAPABILITIES,
    channelName = CHANNEL,
    channel: injectedChannel,
    fetch: upstream = globalThis.fetch
  } = /** @type {import('./messages.d.ts').MessageHubOptions} */ (options);
  const worker = /** @type {{skipWaiting?: () => void | Promise<void>}} */ (scope);
  // clients that announced a double-meh library take ownership of bundling (client-wins)
  const libraryClients = new Set();
  const channel =
    injectedChannel !== undefined
      ? injectedChannel
      : typeof BroadcastChannel !== 'undefined'
        ? new BroadcastChannel(channelName)
        : null;

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
      const shared = cacheTier && request.method === 'GET' ? response.clone() : null;
      // best-effort: a tier write must never fail a fetch the client already holds
      const store = () => (shared ? cacheTier.put(request, shared).catch(() => false) : null);
      const message = {
        type: MESSAGES.result,
        id: data.id,
        status: response.status,
        statusText: response.statusText,
        headers: [...response.headers]
      };
      // the body transfers, not copies — this is the navigation-surviving prefetch path
      if (data.stream && response.body && supportsTransferableStreams()) {
        // streamed: the tier drains its tee branch behind the client, which already has the body
        const stored = store();
        message.stream = true;
        message.body = response.body;
        port.postMessage(message, [message.body]);
        await stored;
        return;
      }
      // buffered: seeding the tier BEFORE the reply is what lets a prefetch survive a navigation
      await store();
      message.body = await response.arrayBuffer();
      port.postMessage(message, [message.body]);
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
