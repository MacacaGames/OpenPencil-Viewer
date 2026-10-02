# ADR 002 — Native App composition and a guarded design graph

Status: implemented for the pinned SHA, subject to browser/graph gates. Scope: read-only LAN MVP.

The actual upstream exposes a native App and internal session/document APIs. It does not provide the component or whole-document readonly hook implied by a generic viewer integration. Compose `EditorWorkspace` with its native activated tab/store, and load bytes through actual FIG import/preparation. Preserve canvas, pages, layers and property inspector instead of recreating them.

Outer adapter owns the portal UI, transport, safety worker, readonly policy and disabled collaboration. A checked patch modifies isolated source entry points to call these policies and remove persistence/network runtimes. Core remains framework-neutral: readonly.ts has no Vue/app imports and its SceneGraph import is type-only. App-specific methods stay in app-guard.ts. The adapter uses actual source entry points only within this documented internal boundary. Upstream remains clean, including its native authoring source; there is no local upstream commit, submodule working edit or compiled-JS rewrite.

Lock after import and page preparation. Design arrays and node objects become readonly proxies; old node references cannot mutate the retained graph because protected nodes are cloned. Only layer expansion and text rendering cache are mutable view state. Core/app methods deny by default after lock, so new upstream mutation functions are not automatically permitted. The Vue registry gates direct command calls as well as enabled controls; pointer selection uses native hit tests without opening edit transactions. UI tests must verify scene pixels and source hash/mtime under attempted edits, not merely absence of Save.

Default-deny does require careful maintenance: newly introduced navigation/read functions must be audited and allowed explicitly. All-page preparation costs memory and time and is a deliberate MVP choice; it makes post-lock page layout stable. Large representative import and font fidelity remain unverified. Render cache/view state is excluded from graph invariance assertions, but design properties, hierarchy and bytes are not.

Update gate: pin candidate SHA → read ownership guides → archive candidate → checked patch application → package/native build → typecheck → adapter graph test → fixture browser render and readonly actions → external network test. Any failure keeps the old pin. No `submodule update --remote` in deployment. Roll back outer patch and lock together.

Native selected-node inspection uses a SHA-specific hook in `packages/vue/src/editor/selection-state/nodes.ts`: shallow Core copies contain nested readonly proxies, so `cloneReadonlyValue` unwraps into an independent structured clone. No mutable graph target is returned. The native Design/Code tabs remain inspectable; field edits/code live preview are disabled. Core/Vue tests and browser property-panel acceptance cover this boundary.
