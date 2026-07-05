# double-meh-sw [![NPM version][npm-img]][npm-url]

[npm-img]: https://img.shields.io/npm/v/double-meh-sw.svg
[npm-url]: https://npmjs.org/package/double-meh-sw

The service-worker sibling of [double-meh](https://github.com/uhop/double-meh): one worker owning what only a service worker can — a **shared cache tier** served to every tab (and to code that has never heard of double-meh), **cross-tab request coalescing** (identical concurrent GETs collapse to one wire call), **transparent request bundling** for pages without the library, an **invalidation hub**, a **version-upgrade flow**, and the `io:fetch` **message transport** whose requests survive page navigation.

Composable modules plus a ready assembly — compose into an existing service worker, or deploy the assembly directly:

```js
// sw.js — served from your origin, registered with {type: 'module'}
import {install} from 'double-meh-sw/sw.js';

install({
  version: '2026.07.04',
  cache: {cacheName: 'app-shared'},
  bundler: {url: '/bundle', match: '/api/'} // transparent bundling via double-meh-bundler
});
```

Everything **degrades to plain fetches** by design: bundler trouble, missing parts, or the worker being absent entirely (first visit, hard reload) must be logically invisible — the whole package is a performance adornment, never a semantic layer. Pages running double-meh announce themselves over `io:hello` and keep ownership of their own bundling (the SW passes them through); pages without it get zero-integration acceleration.

## Install

```bash
npm i double-meh-sw
```

## The pieces

| Module                                 | What it owns                                                               |
| -------------------------------------- | -------------------------------------------------------------------------- |
| `double-meh-sw/sw.js`                  | `install(options)` — wires fetch/message/activate on the worker scope      |
| `double-meh-sw/cache-tier.js`          | The shared Cache API tier: serve-first, opt-in store, pattern invalidation |
| `double-meh-sw/coalesce.js`            | Cross-tab in-flight coalescing                                             |
| `double-meh-sw/bundle-window.js`       | Micro-window bundling (the double-meh wire format v1)                      |
| `double-meh-sw/messages.js`            | `io:hello` / `io:invalidate` / `io:version` / `io:upgrade` / `io:fetch`    |
| `double-meh-sw/contract.js`, `wire.js` | The message contract and the bundle wire format                            |

The ecosystem: [double-meh](https://github.com/uhop/double-meh) (the client), [double-meh-bundler](https://github.com/uhop/double-meh-bundler) (the server endpoint), and this worker between them — each useful alone, better together.

Zero runtime dependencies. ESM. Browser service workers are the product; Node ≥ 18, Bun, and Deno run the test suite (injected scope/fetch/caches).

## Release notes

- 1.0.0 — _(unreleased)_ The initial release: cache tier, coalescer, bundle window, message hub, `install()` assembly.

License: BSD-3-Clause.
