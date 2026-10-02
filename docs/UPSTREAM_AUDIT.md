# Upstream audit — OpenPencil × Synology LAN Portal

Audited 2026-10-01/02 (Asia/Taipei). Official OpenPencil 0.15.1 is pinned at `8c72b62da07ea1f7e82de84c7c837c3c78dfbf95`, [official commit](https://github.com/open-pencil/open-pencil/commit/8c72b62da07ea1f7e82de84c7c837c3c78dfbf95). `upstream/open-pencil` is a pristine Git submodule; no upstream commits or design files are changed. Root/src/core/scene-graph/vue/fig AGENTS.md were read. The handoff's plan title is the Synology LAN plan, and both root handoff files remain intact. The sibling Google Drive project has staged/unstaged/untracked work and remains untouched.

## Actual native entry points

At the pinned SHA, `src/main.ts` runs the support gate, then `src/boot.ts` mounts App + router. `src/views/WorkspaceView.vue` creates native tabs, installs keyboard, collaboration and automation. `src/components/editor/EditorWorkspace.vue` composes native LayersPanel, CanvasSplitRoot/EditorCanvas and PropertiesPanel. It is not an exported `<OpenPencilEditor />` component.

`src/app/editor/session/create.ts:createEditorStore` assembles reactive state, Core `createEditor`, document IO and pane/preparation services. `src/app/tabs/index.ts:createTab` activates the store; its dispose path releases graph workers/archive/layout, preparation and canvas resources. App's `provideEditor` supplies the active store to the native UI.

Bytes entry: `@open-pencil/core/io/formats/fig:parseFigFile(ArrayBuffer, options)` creates the FIG session worker, decodes the archive and returns SceneGraph. `src/app/document/io/imported-document.ts:applyImportedDocument(editor, imported, load)` prepares through a staging editor then replaces the active graph. Core `preparePage/commitPageSwitch/switchPage` handle pages. The adapter uses these exact functions, prepares all pages before locking design data, fits viewport, and waits for native presentation. Worker failure must not silently fall back to unbounded main-thread parsing (isolated patch adds `allowMainThreadFallback:false`).

## Readonly findings and integration

There is no audited whole-document viewer/readonly capability at this SHA. `readOnly` mentions for library assets or chat history do not provide document immutability. UI actions exist at Core editor facade, Vue command registry, direct graph methods, nested node properties and pointer handlers. Merely hiding Save is insufficient.

The isolated patch and adapter enforce:

- Default-deny Core/app action facade once the imported graph is locked. Explicitly audited selection, viewport, page and lifecycle methods remain usable. Vue commands gate both enabled state and direct `run()` calls.
- Immutable node design properties, nested arrays/objects, graph mutation methods and design maps. Per-node clones remove pre-lock references. `expanded` and `textPicture` remain view/render state. Page layouts are prepared before locking. No original archive export/writeback is wired.
- Native canvas selection stays active; drag/text/drawing mutations, paste/drop, undo/redo and tool changes beyond Select/Hand cannot edit designs. Property information remains native; Design/Code tabs and zoom remain usable, design controls and code edits are disabled. Native selection inspection receives independent snapshots instead of cloning readonly proxies. Safe selection/zoom/page commands remain available.
- Save/Save As return false; recovery and autosave have no writable source; recovery persistence is disabled and the browser store is memory-only, so even an empty recovery IndexedDB is not created. App does not start storage sync, recovery/settings/library dialogs or public routes.
- Collaboration hook is an inert adapter, not a Yjs session; AI tab is unavailable, automation browser bridge and Vite MCP plugin are disabled, SW/PWA registration is removed. Font providers and library refresh are disabled. Static CanvasKit/Yoga/font assets are served locally. Strict `connect-src 'self'` and local image/font/worker policies prevent document URLs causing external fetch.

See [integration ADR](UPSTREAM_ADAPTER_ADR.md). The adapter is an internal SHA-specific boundary, not a stable upstream SDK. Compiled JavaScript is never string-rewritten. Patch generation/disposable tree are separate from the submodule.

## Commands and actual observations

- `git ... submodule add` used an available local clone as a transport optimization, then set `.gitmodules` and origin to the official URL and detached at the pinned SHA. No remote branch update during build.
- In `.work/native`: `bun install --frozen-lockfile`, `bun run build:packages`, `bun run dev --host 127.0.0.1 --port 3211` with Bun 1.4.2 in PATH. Browser synthetic native smoke observed **2 canvases, Pages/Layers/Design/Code/AI**. Its default MCP startup attempted port 7600 health/CORS checks; this confirms a runtime to disable in Portal. Earlier smoke attempts timed out during first Vite load; they were not counted as passes.
- LAN `prepare-upstream` archives only tracked pristine source, `git apply --check` then `git apply` in `.work/editor`, copies owned packages, and installs frozen upstream dependencies. `build:packages` plus Vite production build succeeded after path fixes. Package build logs and browser results are recorded in IMPLEMENTATION_STATUS.
- Bun adapter test uses the actual patched Core createEditor and SceneGraph: direct update/delete/duplicate/tool/undo/redo, nested property mutation are blocked; selection, zoom and page switching pass.

WebGPU vendor LFS assets are unavailable in this environment; normal CanvasKit WASM is supplied by the pinned npm dependency. Retained WebGL canvas is used; no WebGPU compatibility claim. Unknown fonts are reported through the native font status banner; online font retrieval is disabled. Synthetic fixture rendering does not demonstrate arbitrary Figma fidelity. Representative large/import stress and actual target browser/GPU profiles remain to be measured.
