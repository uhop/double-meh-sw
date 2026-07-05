import type {CacheTier} from './cache-tier.js';

export interface MessageHubOptions {
  /** The app/asset version reported to `io:version`. */
  version?: string;
  cacheTier?: CacheTier;
  /** ServiceWorkerGlobalScope-like: `skipWaiting` is the only member used. */
  scope?: {skipWaiting?(): Promise<void> | void};
  capabilities?: string[];
  /** BroadcastChannel name for `io:invalidated` fan-out. Default: "io". */
  channelName?: string;
  fetch?: (request: Request) => Response | Promise<Response>;
}

export interface MessageHub {
  /** Returns a promise for messages with async work (invalidate, upgrade, transport) — waitUntil it. */
  handleMessage(event: {
    data: unknown;
    source?: {id?: string; postMessage?(message: unknown): void} | null;
    ports?: ReadonlyArray<{postMessage(message: unknown, transfer?: unknown[]): void}>;
  }): Promise<void> | undefined;
  isLibraryClient(clientId: string | undefined): boolean;
  clients: Set<string>;
}

export declare function createMessageHub(options?: MessageHubOptions): MessageHub;
