export declare const REQUEST_MIME: string;
export declare const BUNDLE_MIME: string;

export interface BundlePart {
  id?: string;
  url: string;
  status?: number;
  statusText?: string;
  headers?: Record<string, string>;
  body?: unknown;
  encoding?: 'base64';
  synthetic?: boolean;
}

export declare function buildDoc(entries: ReadonlyArray<{id: string; request: Request}>): {
  v: 1;
  parts: object[];
};
export declare function toResponse(part: BundlePart): Response;
export declare function isBundlePayload(response: Response): boolean;
