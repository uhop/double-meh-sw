import type {Matcher} from './contract.js';

export interface CacheStorageLike {
  open(name: string): Promise<{
    match(request: Request | string): Promise<Response | undefined>;
    put(request: Request | string, response: Response): Promise<void>;
    delete(request: Request | string): Promise<boolean> | Promise<void>;
    keys(): Promise<Request[]>;
  }>;
}

export interface CacheTierOptions {
  /** The Cache API cache name. Default: "io-shared". */
  cacheName?: string;
  /** Injectable Cache API implementation (tests, non-browser runtimes). Default: `globalThis.caches`. */
  caches?: CacheStorageLike;
  /** Opt-in predicate for storing plain network responses; the tier is serve-first by default. */
  store?: (request: Request, response: Response) => boolean;
}

export interface CacheTier {
  cacheName: string;
  /** Undefined = pass (miss or `x-io-no-cache`). */
  handleFetch(request: Request): Promise<Response | undefined>;
  /** Stores 2xx responses only; returns whether it stored. */
  put(target: Request | string, response: Response): Promise<boolean>;
  maybeStore(request: Request, response: Response): Promise<boolean>;
  /** Prefix string, RegExp, or predicate over URLs; returns the eviction count. */
  invalidate(pattern: Matcher): Promise<number>;
}

export declare function createCacheTier(options?: CacheTierOptions): CacheTier;
