# AGENTS.md — double-meh-sw

> `double-meh-sw` — the service-worker sibling of double-meh: a shared Cache API tier,
> cross-tab request coalescing, transparent request bundling, an invalidation hub, and a
> version-upgrade flow — shipped as composable modules plus a ready `install()` assembly.
> Works with or without double-meh on the page. Zero runtime dependencies.

For project structure see [ARCHITECTURE.md](./ARCHITECTURE.md). The architecture — division of
labor, meta channels, client-wins ownership, the no-op-degradable invariant — is recorded in the
double-meh design record (`double-meh/dev-docs/design.md` § Service Worker); the bundle wire
format is shared with `double-meh-bundler`.

## Setup

This project uses a git submodule for the wiki:

```bash
git clone --recursive https://github.com/uhop/double-meh-sw.git
cd double-meh-sw
npm install
```

## Commands

- **Install:** `npm install`
- **Test:** `npm test`; also `npm run test:bun`, `npm run test:deno`
- **TypeScript check:** `npm run ts-check` · **JS check:** `npm run js-check`
- **Format check / fix:** `npm run lint` / `npm run lint:fix`

The gate before shipping: `lint` + `ts-check` + `js-check` + tests on Node, Bun, and Deno.

## Code style

- **ESM** throughout; no transpilation.
- **Prettier** (see `.prettierrc`): 100 char width, single quotes, no bracket spacing, no trailing
  commas, arrow parens "avoid".
- **No narrating comments** — _why_-markers only. No JSDoc in `.js`; types live in `.d.ts`
  sidecars referenced via `// @ts-self-types`.
- Prefer prefix `++i`/`--i`; `catch {` when the error binding is unused.

## Architecture rules

- **The product runs in a browser service worker** — there is no Node floor (`engines` is
  deliberately absent); Node/Bun/Deno appear only as test runtimes with injected `scope`,
  `fetch`, and `caches`.
- **Everything degrades to plain fetches.** The SW is a no-op-degradable adornment: bundler
  trouble, missing parts, and absent features must fall back to direct network — a SW must never
  break pages it did not have to touch.
- **Client-wins ownership**: pages announcing a library over `io:hello` own their bundling; the
  SW only passes their traffic through.
- **respondWith decisions are synchronous** — only the configured matcher may gate them.
- **Wire-format fidelity**: the bundle format is shared with double-meh and double-meh-bundler;
  changes land in all three plus the design record, in lockstep.
- Zero runtime dependencies; the core modules import nothing platform-specific.

## Testing

- `tape-six`; tests in `tests/test-*.mjs`, green on Node/Bun/Deno.
- Everything is tested through injected fakes (`scope`, `fetch`, mock `caches`); Deno additionally
  exercises the real Cache API (which lacks `keys()` there — the tier feature-detects).
- Keep the degradation paths covered: bundler failure, missing parts, lone-request windows,
  client-wins pass-through, `x-io-no-cache`, respondWith gating.
