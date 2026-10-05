Title: fix(canvas): bound image decoding for large Figma documents

### Summary

Image-heavy `.fig` files can exhaust CanvasKit's heap because the renderer retains full-resolution decoded images and mipmaps. This change bounds decoded-image ownership and uses screen-resolution previews for large documents, so the public 400 MiB reproduction renders and switches pages without the observed CanvasKit abort. Original encoded images remain available for full-resolution export.

### What changed

- Reuse Core's owning `ResourceCache` for a 128 MiB decoded-image budget and a 64 MiB encoded-preview budget. Oversized rejected native images remain caller-owned and are released after the paint acquires its shader reference.
- Inject a Vue/browser decoder using `createImageBitmap` and `OffscreenCanvas`, outside the CanvasKit heap. Serialize decoding, cap pending work, discard stale document results and release browser resources on teardown. Interactive preview tiers follow zoom/DPR and cap the longest edge at 2,048 pixels; fills and strokes share the existing shader path, including original TILE dimensions.
- For large interactive documents, render visible content without retained scene/effect pictures that would keep evicted images alive. Invalidate native caches on document/page/mode changes; full-resolution scene export disables previews and restores renderer state in `finally`.

### AI assistance

Models: GPT-6 (Codex).

### Validation

- `bun run format` and explicit `oxfmt --check` for the new image unit tests: passed. The root format script does not include `packages/core/tests`.
- `bun run test:unit`: 4,838 passed, 1 platform skip, 0 failures across 838 files, including image budgets, serialized decoding, stale completions, disposal and export-state restoration.
- `bun run test tests/e2e/canvas/image-previews-visual.spec.ts tests/e2e/canvas/fill-modes-visual.spec.ts tests/e2e/canvas/stroke-paint-visual.spec.ts tests/e2e/export/basic.spec.ts --project=openpencil`: 18 passed. New committed canvas snapshot was visually inspected and rerun without updating snapshots.
- Image renderer/surface type-aware lint: 0 warnings/errors. Architecture, test placement, changelog, docs, package quality, dependencies, critical dependency audit, secrets, monorepo, type shapes, native-test types, tooling checks/tests and duplication checks passed. Commit-range lint passed all three commits.
- Public 401.3 MiB / 262-JPEG reproduction, fresh Chrome 154 profile: base `a50444c2` aborts on page 1 after 78 cached images at 2 GiB WASM capacity; this branch completes pages 1 → 2 → 3 → 2 → 1 with no errors and 128 MiB WASM capacity. Capacity is not live residency, process RSS or GPU memory.
- `bun run check` / full app typecheck: blocked by the same five AI provider `FetchFunction` / `fetch.preconnect` errors observed on an unmodified baseline with the frozen dependencies. Remaining checks were run individually; the changed image renderer/surface passes its targeted type-aware checks. Native Tauri and live Figma import were not run.
- `bun run test --max-failures=10`: 61 passed, 10 failed, 616 not run after reaching the failure limit. Eight snapshot failures reproduced on unmodified `a50444c2` with the same browser settings. The demo-loading timing failure also occurs on baseline; a three-repeat run fails 3/3 there and passes 3/3 on this branch. Menu sequencing also fails on baseline. The complete browser suite is not claimed as passing. No unrelated snapshots or tolerances were changed.
- Changelog: updated under Unreleased / Fixed.

No large binary fixture was added to Git/LFS.
