import type {Matcher} from './contract.js';
import type {CacheTierOptions, CacheTier} from './cache-tier.js';
import type {Coalescer} from './coalesce.js';
import type {BundleWindowOptions, BundleWindow} from './bundle-window.js';
import type {MessageHub} from './messages.js';

export interface InstallOptions {
  /** ServiceWorkerGlobalScope-like (injectable for tests). Default: `globalThis`. */
  scope?: {
    addEventListener(type: string, listener: (event: any) => void): void;
    skipWaiting?(): Promise<void> | void;
    clients?: {claim(): Promise<void>};
    registration?: {scope: string};
  };
  /** The app/asset version reported over the message contract. */
  version?: string;
  /** Which requests the SW handles at all. Default: same-origin non-navigation GETs. */
  match?: Matcher;
  cache?: CacheTierOptions;
  /** Enables transparent SW-side bundling for pages without double-meh. */
  bundler?: BundleWindowOptions & {match?: Matcher};
  fetch?: (request: Request) => Response | Promise<Response>;
  /** `clients.claim()` on activate. Default: true. */
  claim?: boolean;
}

export interface Installed {
  cacheTier: CacheTier;
  coalescer: Coalescer;
  bundle: BundleWindow | null;
  hub: MessageHub;
}

/**
 * Wires fetch/message/activate listeners on the scope: cache tier first, then transparent
 * bundling (client-wins for double-meh pages), then coalesced network. Everything degrades to
 * plain fetches — the SW must be a no-op-degradable adornment.
 */
export declare function install(options?: InstallOptions): Installed;
