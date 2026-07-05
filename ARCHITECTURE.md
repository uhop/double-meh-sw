# Architecture

`double-meh-sw` is the browser-side sibling of double-meh: one service worker owning what only a
service worker can — a cross-tab shared cache, cross-tab request coalescing, transparent
bundling, invalidation fan-out, and the version-upgrade flow.

## Project layout

```
double-meh-sw
├── src/
│   ├── contract.js       # Message contract (io:*), capabilities, x-io-* enrichment stripping
│   ├── wire.js           # Bundle wire format v1: doc builder, part → Response
│   ├── cache-tier.js     # Shared Cache API tier: serve-first, opt-in store, pattern invalidation
│   ├── coalesce.js       # Cross-tab in-flight GET coalescing (one wire call, N clones)
│   ├── bundle-window.js  # Micro-window transparent bundling with direct-fetch degradation
│   ├── messages.js       # Control plane: hello/invalidate/version/upgrade + the io:fetch transport
│   ├── sw.js             # install(options) — wires fetch/message/activate on a scope
│   └── index.js          # Barrel re-exports
├── tests/                # Injected scope/fetch/caches fakes; Deno also runs the real Cache API
└── examples/             # A deployable sw.js + page-side registration
```

## Core concepts

- **Two intakes, one machinery**: fetch events (interception) and messages (the `io:fetch`
  transport) feed the same cache tier; the transport also serves _uncontrolled_ pages and
  completes requests that outlive their page (navigation-surviving prefetch).
- **Serve order**: cache tier → bundle window (when configured, matched, and the client is not a
  double-meh page) → coalesced network. The respondWith decision itself is synchronous and gated
  only by the matcher (default: same-origin non-navigation GETs).
- **Client-wins**: an `io:hello` with a `library` claim marks that client; its requests are never
  SW-bundled — the page library has more context (named bundles, explicit flush).
- **Degradation is the design**: bundler failure or omission falls back to direct fetches per
  waiter; a lone request skips bundling; the whole SW disappearing must be logically invisible.
- **Meta channels**: `x-io-*` request headers are the per-request data plane (stripped before the
  wire); postMessage/BroadcastChannel is the control plane.

## Module dependency graph

```
src/contract.js           (leaf)
src/wire.js               (leaf)
src/cache-tier.js         (leaf)
src/coalesce.js           (leaf)
src/bundle-window.js      → src/wire.js
src/messages.js           → src/contract.js
src/sw.js                 → all of the above
```
