Title: fix(core): share pending CanvasKit initialization

Local preparation draft: the source change and diagnostic are ready for review. Add a package-owned regression test and run the upstream contribution checks before submitting a PR.

### Summary

Concurrent callers previously initialized separate CanvasKit runtimes while the singleton was still loading. Share the pending initialization promise so both callers receive the same instance, and clear a rejected promise so later calls can retry.

### What changed

- Cache an in-flight initialization promise alongside the resolved singleton.
- Set the singleton on success and clear the pending promise on failure.
- Preserve `locateFile` behavior: the first active initialization owns the options, as the resolved singleton already does.

### AI assistance

Models: GPT-6 (Codex).

### Validation

- Source patch checked and applied against `6a05e30f15398de70d36deda011003b4347d1627` in a disposable checkout.
- Standalone strict TypeScript compilation of the patched CanvasKit module passed against that checkout's installed dependencies.
- Isolated Bun 1.4.2 diagnostic: concurrent initialization changes from two calls/different instances to one call/the same instance; retry after an initial rejection succeeds.
- Surface resize, font scheduling, and late disposal scheduling retain their baseline results; this patch changes only initialization.
- Upstream `bun run check`, `bun run format`, `bun run test:unit`, and `bun run test` have not been run for this candidate. The diagnostic is not a replacement for a committed regression test or these checks.
- Changelog: a `Fixed` entry is still required before submission.
