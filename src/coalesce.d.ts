export interface Coalescer {
  /** Shares one in-flight upstream call per method+url+accept; every caller gets a clone. */
  run(request: Request, fn: () => Response | Promise<Response>): Promise<Response>;
  inFlight(): number;
}

export declare function createCoalescer(): Coalescer;
