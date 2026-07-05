import type {BundlePart} from './wire.js';

export interface BundleWindowOptions {
  /** The bundler endpoint. Required. */
  url: string;
  /** Upstream fetch — also the fallback path when the bundler misbehaves. Default: `globalThis.fetch`. */
  fetch?: (request: Request) => Response | Promise<Response>;
  /** Micro-window, ms; fetch events arriving within it share one bundle. Default: 10. */
  waitTime?: number;
  /** A window reaching this flushes immediately. Default: 20. */
  maxSize?: number;
  /** Below this a flush degrades to direct fetches. Default: 2. */
  minSize?: number;
  /** Observes every non-synthetic part (claimed or not) — the cache write-through hook. */
  onPart?: (part: BundlePart, response: Response) => void;
}

export interface BundleWindow {
  /** Parks the request in the current window; resolves with its part (or a direct-fetch fallback). */
  intake(request: Request): Promise<Response>;
  flush(): Promise<void>;
  pending(): number;
}

export declare function createBundleWindow(options: BundleWindowOptions): BundleWindow;
