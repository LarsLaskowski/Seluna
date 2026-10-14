# 0004: TypeScript instead of Go

- **Status:** Accepted
- **Date:** 2026-10-14
- **Area:** —
- **Source:** Issue #2
- **Supersedes:** —

## Context

Seluna runs as a Cloudflare Worker on the free plan. The Workers runtime executes JavaScript and WebAssembly; the
project owner's other services are written in Go.

## Options considered

1. **Go compiled to WebAssembly** — one language across projects, but the Go runtime adds several MB to the bundle, startup cost and a thin, poorly documented Workers binding story; D1, `fetch` and `crypto.subtle` all go through JavaScript glue anyway.
2. **TypeScript** — the native language of Workers: first-class types for bindings (`wrangler types`), the official test pool, small bundles and no glue layer.

## Decision

Seluna is written in TypeScript (strict mode) and bundled by Wrangler. TypeScript is pinned to 6.0 for now because typescript-eslint, which the analyzer gate needs, does not support TypeScript 7 yet; move to 7 as soon as it does.

## Consequences

Contributors need TypeScript, not Go, knowledge. The Go profile of the template is not used. Moving to TypeScript 7 later is a dependency bump, not a decision.
