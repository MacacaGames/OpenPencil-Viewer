Title: bug: concurrent getCanvasKit calls initialize separate WASM runtimes

### What happened?

Two callers that enter `getCanvasKit()` before its first initialization settles each call `CanvasKitInit()`. They receive different instances even though the module otherwise implements a singleton. Consumers creating scene and overlay surfaces concurrently can consequently use separate runtimes. The attached diagnostic demonstrates duplicate initialization; it does not claim to reproduce a particular GPU crash.

### Platform

Web / Vue SDK. The isolated diagnostic runs in Bun 1.4.2 on macOS arm64 with a mocked initializer.

### Steps to reproduce

1. Check out `6a05e30f15398de70d36deda011003b4347d1627` and install its locked dependencies.
2. Run `bun run probe-lifecycle.ts /absolute/path/to/checkout` in a fresh process.
3. The harness first rejects one initialization, then holds the next initialization pending while a second caller enters `getCanvasKit()`.
4. Observe `concurrentInitializations: 2` and `sameHeap: false`. Expected: one pending initialization shared by both callers, followed by the same instance.

### Affected area

Canvas rendering / SDK initialization.

### Version or build

Source checked at `6a05e30f15398de70d36deda011003b4347d1627`. The same code exists at `8c72b62da07ea1f7e82de84c7c837c3c78dfbf95`.

### Files, screenshots, or links

Attach `probe-lifecycle.ts` and the numeric result JSON. A `.fig` file is unnecessary for this race. The supplied source-only patch stores the pending promise and clears it after rejection so a later call can retry.

PR #823 fixes initialization before CanvasSurface supplies its element; this is a different race inside the Core singleton.

### Console output or logs

```json
{"concurrentInitializations":2,"sameHeap":false,"retrySucceeded":true}
```

With the attached CanvasKit-only patch applied to the same SHA:

```json
{"concurrentInitializations":1,"sameHeap":true,"retrySucceeded":true}
```

### Before submitting

Public issues and PRs were searched on 2026-10-05 using CanvasKit, memory, resize, shader, font render, and worker archive queries. No exact pending-initialization fix was found in the inspected results. Refresh this search before posting.
