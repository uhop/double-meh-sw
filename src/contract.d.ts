export declare const CONTRACT_VERSION: number;
export declare const MESSAGES: {
  hello: string;
  invalidate: string;
  invalidated: string;
  version: string;
  upgrade: string;
  fetch: string;
  result: string;
};
export declare const CHANNEL: string;
export declare const CAPABILITIES: string[];
export declare const ENRICHMENT_PREFIX: string;

export type Matcher = string | RegExp | ((url: string) => boolean);

export declare function matches(match: Matcher | null | undefined, url: string): boolean;
/** Returns the request unchanged when it carries no `x-io-*` headers. */
export declare function stripEnrichment(request: Request): Request;
