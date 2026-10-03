# OpenPencil 修復項目與 Agent 復刻指南

這份文件讓另一個 agent 復刻本專案的 VS Code 整合、白畫布／閃爍修復與大型 `.fig` 效能修復。依據是 **2026-10-01 的目前工作目錄**，包含尚未提交的程式；只取得 Git HEAD 或只複製 `v0.15.1.patch`，不一定包含以下全部修復。範例節錄核心方法，完整實作與測試請依各項列出的檔案取得。

## 1 版本與修改邊界

| 層級 | 位置 | 復刻原則 |
| --- | --- | --- |
| 固定 upstream | `vendor/openpencil/` | 固定 commit `6cf1748e31a0e43d3794d43abbd003ce9caa3c6f`，保持乾淨 |
| 修改 upstream 既有檔案 | `patches/openpencil/v0.15.1.patch` | 只允許修改既有檔案，不可新增／刪除檔案 |
| Extension 自有模組 | `src/openpencil-extension/` | 新的整合功能放這裡，透過 `@openpencil-extension` alias 匯入 |
| Build overlay | `src/openpencil-extension/overlay/` | 靜態資源與宣告依相同路徑複製到 staging 根目錄 |
| npm 套件輸出修復 | `scripts/patch-*.cjs`、`vite.openpencil.config.mjs` | Vite transform 時套用，不直接改 `node_modules` |
| 既有 host／bridge／renderer | `src/fig-provider.js`、`src/bridge/`、`src/renderer/` 等 | 要一起移植；它們不在 upstream patch 裡 |
| 生成物 | `.openpencil-cache/`、`dist/` | 由 prepare／build 重建，不手動修改 |

目前主要套件為 `@open-pencil/core`／`vue`／`scene-graph` 等 `0.15.1`、CanvasKit `0.41.1`、Vue `3.5.41`。以 `package.json` 和 `package-lock.json` 為準，復刻使用 `npm ci`。

實際流程：`build.cjs` 建置 extension 與字型資源 → `build-openpencil-ui.cjs` 執行 prepare → 複製乾淨 upstream → check／apply patch → 複製 overlay → Vite transform npm 輸出並建置 UI。

## 2 修復總表

| 編號 | 問題／觸發 | 修正方法 | 實作與驗證入口 |
| --- | --- | --- | --- |
| A | VS Code webview 落在錯誤 route、出現額外 Home／Untitled／內部頁籤 | 偵測 VS Code runtime，使用單一 store，route 到 workspace，移除內部檔案導覽 | upstream patch、`vscode-bridge.ts`；Web Host 測試 |
| B | 儲存／匯出走瀏覽器下載，host 不知道是否完成 | `downloadBlob` 改非同步，委派 bridge 到 VS Code dialogs／`workspace.fs`，上層一併 await | upstream patch、`fig-provider.js`；`protocol.test.cjs` |
| C | 檔案每隔一段時間重新載入、選取消失 | VS Code 模式停用 upstream browser file watcher；synthetic File 固定 `lastModified` | upstream patch、bridge；`file-watch.test.cjs` |
| D | Git LFS 檔案仍可透過工具或快捷鍵編輯 | host 檢查 LFS；UI inert、快捷鍵守門、HAND tool、host 拒絕回寫 | upstream patch、`lfs.js`、`gitlab-lfs.js`、provider；LFS 測試 |
| E | WASM、字型、品牌圖片的 webview URL 錯誤 | `asWebviewUri`／base／meta 傳遞資源根；依 baseURI 組 URL；不註冊 PWA SW | upstream patch、Vite、provider、build scripts |
| F | npm worker 指向未提供的 `.ts` 入口 | 改 import 已發布 `.js?worker&inline`，並允許 blob worker | Vite、provider；build 與實際開檔 |
| G | Scene／overlay 同時初始化 CanvasKit，native resource 跨 heap 出錯 | 共用初始化中的 Promise，成功後共用 instance，失敗清掉 Promise 以便重試 | `patch-canvaskit.cjs`；`canvaskit-initialization.test.cjs` |
| H | Resize 重建 surface 導致白閃、重複載字型 | 80 ms debounce；尺寸為零或實體像素尺寸未變就略過 | Vite `openpencil-skip-noop-canvas-resizes`；build／UI 觀察 |
| I | 大量原尺寸圖片耗盡 WASM／native memory | 大文件啟用 viewport previews；分級縮圖、雙層快取預算、native 資源釋放 | `patch-image-memory.cjs`、`image-memory.mjs`、preview worker；image 測試 |
| J | 字型完成 callback 在 render 中同步重入，UI 卡住 | 所有 font callback 改標 dirty，交由 frame scheduler 合併繪製 | `patch-font-render.cjs`；`font-render.test.cjs` |
| K | FIG parse 在主執行緒預先複製數個完整 archive | File／Blob 傳入 worker 才讀 bytes；ArrayBuffer 路徑只建立一份 worker copy | `patch-fig-memory.cjs`；`fig-memory.test.cjs` |
| L | Lazy page population 被視為編輯，觸發大型匯出 | 非同步 navigation depth guard，並忽略 layout mutations | `navigation-load.mjs`、bridge；navigation／snapshot 測試 |
| M | 大文件或約 55 MB 字型 IPC 被拒絕 | 8 MiB stop-and-wait 分塊，限制 1 GiB，完整 header／順序／長度驗證 | `binary-transfer.mjs`、provider；binary／provider 測試 |
| N | 同一系統字型反覆 IPC、重複註冊、失敗重試風暴 | in-flight 去重、buffer identity、64 MiB LRU、60 秒失敗冷卻；catalog 只解析 metadata | `host-font-cache.mjs`、bridge、`system-fonts-node.js`；font 測試 |
| O | 開檔後 checkpoint 匯出整份 archive，幾秒後閃爍／配置失敗 | 分離 host dirty 與 unsent edits；共用 SnapshotQueue；無修改直接確認 flush | `snapshot-queue.mjs`、bridge；`snapshot-queue.test.cjs` |
| P | 大檔比較與 host 狀態保存產生不必要副本 | Uint32 view 比較；clean current／saved 共用 snapshot；整段 buffer 可直接傳 | `binary-equality.mjs`、provider、bridge；equality／provider 測試 |
| Q | 舊 state／snapshot echo 重匯入，Undo/Redo／Save sequencing 競態 | revision 守門、先建 waiter、optimistic lastSentBytes、flush-complete handshake、重匯入後恢復視圖 | bridge、provider；Web Host、navigation／snapshot 測試 |

表中 `vscode-bridge.ts` 是 `src/openpencil-extension/vscode-bridge.ts`；`.test.cjs` 都位於 `tests/unit/`。A–E 的完整 upstream diff 見下一節；F–Q 通常不能只靠 upstream patch 移植。

## 3 Upstream patch 的全部修改位置

`patches/openpencil/v0.15.1.patch` 目前修改 18 個既有檔案：

| upstream 路徑 | 改法與目的 |
| --- | --- |
| `src/app.css` | `data-host-syncing=true` 顯示同步遮罩並擋住編輯 |
| `src/app/document/export/create.ts` | `DownloadBlob` 型別接受 `Promise<void>` |
| `src/app/document/export/files.ts` | 同步擴充型別，`saveExportedFile` await download |
| `src/app/document/io/browser.ts` | download 優先呼叫 `__OPENPENCIL_VSCODE_BRIDGE__.saveExport` |
| `src/app/document/io/save.ts` | Save 分支 await download |
| `src/app/document/io/watch.ts` | VS Code 模式直接略過 browser watcher |
| `src/app/editor/fonts/browser-fetch.ts` | 由 WASM meta URI 取得 web font fetch origin |
| `src/app/runtime/config.ts` | 新增 `vscode` 判斷及 `isVscodeDocumentEditable` |
| `src/app/shell/keyboard/registry.ts` | 移除 New／Open／Close bindings；read-only 擋快捷鍵與 global handlers |
| `src/app/shell/menu/app-menu.ts` | 隱藏 host 管理的檔案操作與 autosave；清掉多餘 separator |
| `src/app/shell/menu/files.ts` | Open dialog 優先交給 bridge |
| `src/components/LayersPanel.vue` | readOnly prop 與 inert，阻擋可改設計的區域 |
| `src/components/brand/BrandMark.vue` | 品牌 SVG 改依 `document.baseURI` 解析 |
| `src/components/editor/EditorWorkspace.vue` | 傳遞 readOnly；Toolbar／PropertiesPanel 設 inert |
| `src/main.ts` | 移除這個嵌入版本的 PWA service-worker 註冊 |
| `src/router.ts` | VS Code runtime 強制進 workspace `/` route |
| `src/views/WorkspaceView.vue` | 啟停 bridge；隱藏 Home／內部 TabBar／FileApiBanner；顯示唯讀狀態 |
| `tsconfig.json` | 使用 staging app 的 `@/*` paths／include，移除 monorepo source aliases 等設定 |

可用 `git apply --stat patches/openpencil/v0.15.1.patch` 重新確認檔案清單，避免把數量當作版本契約。

### Sample 非同步下載與停用輪詢

```ts
// 節錄 browser.ts：保留原有 standalone fallback。
export async function downloadBlob(data: Uint8Array, filename: string, mime: string) {
  const bridge = (window as Window & {
    __OPENPENCIL_VSCODE_BRIDGE__?: {
      saveExport(data: Uint8Array, filename: string, mime: string): Promise<boolean>
    }
  }).__OPENPENCIL_VSCODE_BRIDGE__
  if (bridge) {
    await bridge.saveExport(data, filename, mime)
    return
  }
  // 原有瀏覽器下載程式接在這裡。
}

// 節錄 watch.ts，放在 startWatchingFile 的入口。
if (appRuntimeConfig.vscode) return
```

只改 download implementation 不夠：`DownloadBlob` 型別、export caller 與 save caller 都要允許／等待 Promise。Synthetic File 另用 `lastModified: 0`，但真正阻斷週期 reload 的修復是停用 upstream watcher。

## 4 Vite 套件修復方法與範例

### 4.1 CanvasKit 共用初始化

`scripts/patch-canvaskit.cjs` 修改 `@open-pencil/core/dist/canvaskit.js`。核心方法：

```js
let instance = null;
let initialization = null;

async function initCanvasKit(options) {
  if (instance) return instance;
  if (initialization) return initialization;
  initialization = CanvasKitInit({ locateFile: options?.locateFile ?? defaultLocate })
    .then(value => { instance = value; return value; })
    .catch(error => { initialization = null; throw error; });
  instance = await initialization;
  return instance;
}
```

Scene 與 overlay 必須共用同一個 native heap。驗收要同時呼叫初始化並確認只執行一次 CanvasKitInit；另外測第一次失敗後可再嘗試。

### 4.2 Worker 入口與資源路徑

Vite 對 core 的 session client 與 FIG export 改用發布套件內的 JS：

```js
import FigSessionWorker from './worker.js?worker&inline';
// 取代 new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
const worker = new FigSessionWorker();
```

Export 同樣使用 `export-worker.js?worker&inline`。FIG memory patch 也必須掛進 `worker.plugins`，否則 worker 本體不一定經過主 bundle 的 transform。CSP 的 `worker-src` 包含 `blob:`。

WASM 從 meta `openpencil-canvaskit` 找 URL；bundled font 從 meta `openpencil-font-root` 找 root。`@acemir/cssom` alias 到 `lib/index.js`，因原 browser bundle 缺 `parse()`。`.md`／`.kiwi` transform 成字串 export，overlay 的 `raw-markdown.ts` 支援宣告。CanvasKit WASM 從 npm dependency 複製到 staging public，不加入 submodule 或 patch。

### 4.3 Canvas resize 與字型 render

Resize guard 位於 Vite，font callback patch 位於 `scripts/patch-font-render.cjs`，兩者都針對 `@open-pencil/vue/dist/canvas/CanvasRoot.js`。

```js
// resizeCanvas 的前置條件；有 renderer 才略過同尺寸。
const dpr = IS_BROWSER ? window.devicePixelRatio || 1 : 1;
const width = Math.floor(canvas.clientWidth * dpr);
const height = Math.floor(canvas.clientHeight * dpr);
if (width <= 0 || height <= 0) return;
if (state.renderer && canvas.width === width && canvas.height === height) return;

// 字型完成時，原本是 loadFonts(renderNow)。
state.renderer.loadFonts(() => renderLoop.markDirty());
```

還要修 surface recreate 的 `loadFonts(surface.renderNow)` 與 font-demand settle 的 `renderNow()`；只改初次載入會漏掉後續觸發。ResizeObserver 改 80 ms debounce，createSurface 也略過零尺寸。圖片預覽 ready callback 以 100 ms 合併後標 dirty。

### 4.4 大圖記憶體與背景預覽

完整移植 `scripts/patch-image-memory.cjs`、`src/renderer/image-memory.mjs`、`src/openpencil-extension/image-preview-worker.js`，以及 Vite 的 helper 匯入與 preview-ready hook。

判斷大文件：原始壓縮圖片總量 **大於 32 MiB** 或圖片數 **大於 128**。Viewport 按 `max(node.width, node.height) × zoom × dpr` 選 128／256／512／1024／2048 邊長，最大 2048。Worker 串行解碼，等比例縮小且不放大，PNG encode 前關閉原 bitmap，以 transfer list 回傳 buffer。

```js
// preview worker 核心；錯誤清理請保留完整檔案的 try/finally。
const bitmap = await createImageBitmap(source);
const scale = Math.min(1, edge / Math.max(bitmap.width, bitmap.height));
const canvas = new OffscreenCanvas(
  Math.max(1, Math.round(bitmap.width * scale)),
  Math.max(1, Math.round(bitmap.height * scale)),
);
canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
bitmap.close();
const bytes = await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer();
self.postMessage({ bytes }, [bytes]);
```

必須保留的細節：

- `graph.images` 保留原始壓縮資料，preview 不覆寫原圖；傳 worker 的 Blob 不 detach 原 buffer。
- Native decoded image LRU 約 128 MiB，以 `ceil(width × height × 4 × 4/3)` 計入 mipmap 成本；delete／clear 各 native handle 只釋放一次。單張超預算圖會單獨保留，避免剛借出的 handle 被刪掉。
- Encoded preview cache 約 64 MiB；native eviction 後重用 encoded preview，不重解原圖。等待更清楚版本時先顯示已存在的層級。
- 大文件避免 retained picture／effect scene 路徑；換頁 invalidate pictures 並 clear native image cache。
- TILE preview 保留原始尺寸比例；`setShader` 後用 finally 釋放 wrapper，Paint 仍持有 native shader reference。
- `renderSceneToCanvas` 暫停 preview mode 並 finally 恢復，使該匯出路徑使用原尺寸資料。

這些快取預算不等於整個程序／GPU 記憶體上限。大文件效果與輸出保真仍需依樣本檢查，不能只測「沒有 crash」。

### 4.5 FIG archive 少複製

`scripts/patch-fig-memory.cjs` 修改 core `io/formats/fig/read.js` 與 `kiwi/fig/session/worker.js`：

```js
// 節錄 parseViaWorker；request 其餘欄位保留原實作。
const sourceFile = buffer instanceof Blob ? buffer : undefined;
const workerBuffer = sourceFile ? undefined : buffer.slice(0);
const archiveBuffer = workerBuffer;
// File 路徑只 transfer port；ArrayBuffer 路徑只 transfer 一份 copy 和 port。
worker.postMessage(request, workerBuffer ? [workerBuffer, channel.port2] : [channel.port2]);

// worker 中才讀 sourceFile；request handler 改成 async。
originalArchive = request.sourceFile ?? new Uint8Array(request.archiveBuffer);
const parseBuffer = request.sourceFile
  ? await request.sourceFile.arrayBuffer() : request.originalBuffer;
```

`readFigFile` 優先送 File；worker 失敗且不是 abort 時，只讀一次 arrayBuffer 並直接同步 parse，不再重試另一個 worker。Main-thread fallback 註冊 original archive 的延後讀取 callback。ArrayBuffer API 不 detach caller 的原資料。

### 4.6 Transform 失配必須停止

```js
function replaceRequired(code, needle, replacement) {
  if (!code.includes(needle)) throw new Error(`Patch no longer matches: ${needle}`);
  return code.replace(needle, replacement);
}
```

目前 CanvasKit／image／font-render／FIG-memory 和 canvas lifecycle replacements 有這類 guard。Vite 裡部分 URL／worker replacements 仍是直接 replace；移植或升版時另查 replacement 是否命中。Build 成功不能單獨證明所有直接 replace 生效。

## 5 Bridge 與 host 修復方法與範例

### 5.1 Navigation 與 layout 不排快照

```ts
const pageLoadGuard = new NavigationLoadGuard()
const switchPage = store.switchPage.bind(store)
store.switchPage = (...args) => pageLoadGuard.run(() => switchPage(...args))

const scheduleSnapshot = (immediate = false) => {
  if (disposed || !loaded || opening || suppressSnapshotEvents ||
      pageLoadGuard.active || store.graph.isApplyingLayout) return
  snapshots.markChanged()
  // 原實作接著使用 180 ms debounce，或 immediate flush。
}
```

Guard 用 depth 計數，`finally` 減回，不用單一 boolean；同時切頁或失敗時才不會提前解除。回復 host state 時先 `await store.switchPage(previousView.pageId)`，再恢復 pan／zoom／仍存在的 selectedIds；page type 接受 `PAGE` 和 `CANVAS`。

### 5.2 大資料與系統字型分塊

兩端共用 `src/bridge/binary-transfer.mjs`，大於 8 MiB 時送 `binary-begin` → 連續 `binary-chunk` → `binary-end`，每一步等 ack。允許的 logical types 包含 `state`、`snapshot`、`save-as`、`save-export`、`system-font-data-result`。

```js
// provider 的 font response 必須包含這個 byteLength。
await send({
  type: 'system-font-data-result', requestId: message.requestId,
  ok: true, byteLength: bytes.byteLength, bytes,
});
```

漏掉 font type 或 byteLength，就會在大型字型出現 `Invalid binary transfer size/type`。每個 header 仍需要合法 requestId，組裝後保留原 requestId 給 font waiter。兩端保留 documentId／sessionId scope、最大 1 GiB、chunk offset 連續性、長度檢查、30 秒 transport timeout，以及 dispose／不完整傳輸清理。小訊息 `send` 也回傳 Promise，因 VS Code API 的 postMessage 可能回傳 void。

### 5.3 Host 字型去重與按需抽取

移植 `HostFontCache` 與 bridge 兩個入口：`queryLocalFonts().blob()` 和 `fontManager.setHostFontLoader`。兩者使用同一個 font ID cache。

```ts
const fontData = new HostFontCache(async (fontId: string) => {
  const loaded = await request('system-font-data', { fontId }, 120000)
  if (loaded.ok === false || !(loaded.bytes instanceof ArrayBuffer)) {
    throw new Error(loaded.error || '無法載入系統字體。')
  }
  return loaded.bytes
})
// 匹配 family/style 後：先重用已註冊資料，再查 host cache。
return fontManager.loadedData(family, style) ?? await fontData.get(face.id)
```

Cache 合併 pending request 並回傳同一個 ArrayBuffer object，讓 CanvasKit 的 buffer 去重有效。LRU 64 MiB、失敗冷卻 60 秒。Node catalog `parseFontFaces(bytes, { metadataOnly: true })` 仍讀檔，但不抽取每個 TTC／OTC face；load 只抽 `{ faceIndex: entry.index }`，轉 standalone SFNT。Provider 的 font file／face 上限是 64 MiB。Web／remote 沒有 desktop provider 時使用 bundled font fallback。

### 5.4 Checkpoint 共用 queue 與事件參數修復

```ts
// 錯誤：node ID/object 被當成 immediate=true。
// store.onEditorEvent('node:updated', scheduleSnapshot)

const scheduleNodeSnapshot = () => scheduleSnapshot()
store.onEditorEvent('node:updated', scheduleNodeSnapshot)
// created/deleted/reparented/reordered/graph:replaced 同樣包一層。
store.onEditorEvent('history:changed', () => scheduleSnapshot(true))

// 所有 Save／checkpoint 呼叫共用一個 SnapshotQueue。
await snapshots.flush()
if (flushRequestId) post({
  type: 'flush-complete', requestId: crypto.randomUUID(), flushRequestId,
})
```

Queue 用 `version`／`syncedVersion` 判斷 unsent canvas edits；host `dirty` 表示與磁碟不同，不能拿它決定是否重新 export。沒有新編輯的 checkpoint 直接完成。多個 flush 共用 running Promise，export 期間又發生編輯再補一次。Host reload 用 epoch reset 讓舊 export 結果失效。

Export／allocation／transport failure 保留 unsent edits，回報錯誤，**不可因此 request-state 重匯入舊圖**。目前只有收到 snapshot 的 host rejection ack 時才 `requestCurrentState()`；host 的過期 revision snapshot rejection 是其中一條路徑。

### 5.5 Revision、ack 與視圖保留

```ts
// 舊／重複 state 在 openFigFile 前就擋下；forced reload 例外。
if (!forceReload && loaded && typeof next.revision === 'number' &&
    next.revision <= hostRevision) {
  // 略過這份 state，繼續處理 queuedHostState。
}

// request waiter 要先註冊，才 post，避免快速 ack 找不到 pending。
pending.set(requestId, { resolve, reject, timer })
post({ type, ...extra, requestId })
```

Snapshot post 前先把 `lastSentBytes` 指向 outgoing bytes，避免 host 同步 state echo 被當新 archive；失敗回復 previousBytes。真正不同的新 state 才 openFigFile，import 期間只留最新 queued state。VS Code Undo／Redo 接管文件 history，node-edit state 仍使用 upstream local history。

Host `flush-request` 的完成要由 webview 回 `flush-complete`，不能以「host 已 post ack」就放行 Save／Undo。Import 期間可立即確認 flush，因 host 已持有 authoritative bytes；仍要擋住使用者編輯並在 import 後保留視圖。

### 5.6 大檔比較與 copy ownership

`sameBinaryBytes` 在兩個 offset 都 4-byte aligned 時使用共享 `Uint32Array` views，比較剩餘 tail bytes；unaligned 回到 byte loop。不要 `.every()` 每 byte callback，也不要為比較 slice 大檔。

```js
function bytesBuffer(bytes) {
  if (bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength) return bytes.buffer;
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

// 新 filesystem read 可用 takeOwnership；clean/saved 共用不變 snapshot。
this.bytes = takeOwnership ? bytes : copyBytes(bytes);
this.savedBytes = this.bytes;
```

共用 snapshot 的前提是更新時 replace、不原地修改。這次修復減少 clean open／markSaved／snapshot posting 的副本，**目前 host edit history、applySnapshot 和 restore 仍有完整 copies**，不要描述為大型 Undo／Save 已完全零複製。

## 6 Agent 復刻順序與 patch 生成 Sample

1. 先讀 `AGENTS.md`、本文件與目前 source；記錄 `git status --short`，保留既有未提交修改。
2. 初始化固定 submodule，安裝 lockfile dependencies；取得上述工作目錄中的未提交／untracked 修復檔案。
3. 套用 upstream patch，移植 extension／host／helper／overlay，保留 Vite aliases 和資源建置。
4. 接上所有 npm transforms，包含 worker build 的 FIG patch。
5. 依序驗證 G–K renderer/parser、L–N navigation/transport/fonts、O–Q snapshot/history；不要以單一 debounce 取代 queue／revision 保護。
6. 執行下面驗收；測大型檔案時用副本與新 webview，避免舊 bundle 或尚未儲存的使用者畫布干擾。

要調整 upstream 既有檔案，可在獨立暫存 clone 生成 patch。以下是操作 sample，執行時把需要的程式修改放在註解指定的位置：

```sh
# 在此專案根目錄操作；vendor 與 generated staging 都不編輯。
patch_project_root="$PWD"
patch_work_dir=$(mktemp -d /tmp/openpencil-patch.XXXXXX)
git clone --no-hardlinks "$patch_project_root/vendor/openpencil" "$patch_work_dir/source"
git -C "$patch_work_dir/source" checkout --detach 6cf1748e31a0e43d3794d43abbd003ce9caa3c6f
git -C "$patch_work_dir/source" apply --unidiff-zero "$patch_project_root/patches/openpencil/v0.15.1.patch"
# 只在 "$patch_work_dir/source" 修改 upstream 已存在檔案。
git -C "$patch_work_dir/source" diff --name-status HEAD
# 確認沒有 A/D/rename，再生成完整 diff；新 extension 檔案放回專案 src/。
git -C "$patch_work_dir/source" diff --binary HEAD > "$patch_work_dir/candidate.patch"
# 在檢閱 candidate.patch 後才覆蓋。
cp "$patch_work_dir/candidate.patch" "$patch_project_root/patches/openpencil/v0.15.1.patch"
npm run prepare:openpencil
git -C vendor/openpencil status --short
```

`prepare:openpencil` 會拒絕 dirty／錯誤 pin 的 vendor，以及含新增／刪除檔案的 patch。生成後還要查 untracked files，因未追蹤檔案不會出現在普通 `git diff`；它們不該被漏掉或放入 upstream patch。

## 7 驗收指令與通過條件

```sh
git submodule update --init --recursive
npm ci
npm run prepare:openpencil
npm run typecheck
npm run test:unit
npm run build
npm run test:web
npm run package
```

注意 `npm run typecheck` 目前是 `node --check` JavaScript 語法檢查，不是 Vue／TypeScript 的完整語意型別檢查。Unit test 的 npm pre-script 會自動 prepare。

真實檔案與效能驗證需要另外提供 sample；不能用 synthetic probe 的 PASS 代表大型設計檔案通過。

```sh
# test-web 會複製 sample 到暫存 workspace；正常 suite 涵蓋 edit/save/history/LFS。
OPENPENCIL_FIG_SAMPLE='/path/to/small-real.fig' npm run test:web

# 大型檔案先驗證開啟；此模式不等於 Save/Undo 驗證。
OPENPENCIL_FIG_SAMPLE='/path/to/Test.fig' OPENPENCIL_FIG_OPEN_ONLY=1 npm run test:web

node scripts/benchmark-page-load.cjs '/path/to/Test.fig' UI
node scripts/benchmark-host-fonts.cjs '/path/to/Test.fig' UI
OPENPENCIL_BENCHMARK_CHECKPOINTS=1 node scripts/benchmark-host-fonts.cjs '/path/to/Test (3).fig' UI
```

CI 或離線環境可用 `OPENPENCIL_VSCODE_COMMIT` 指定可用的 cached VS Code test-host commit。Benchmark 另需其腳本使用的 Chromium／Playwright 環境；host-font benchmark 需要 Node desktop font provider 與本機字型。

| 驗證 | 最低通過條件 |
| --- | --- |
| CanvasKit | concurrent init 同一 instance；失敗可 retry |
| Image | native LRU eviction／replacement 各 delete 一次；shader wrapper 釋放後仍能 render；preview 升級不中斷舊層級 |
| Font render | 通知 burst 合併 frame，render 內通知不造成同步重入；dispose 取消 frame |
| FIG | File path 不在 webview 先 arrayBuffer；ArrayBuffer caller 資料保留；worker failure 只 fallback 一次 |
| Navigation | 多個 async 切頁的 depth 正確歸零；navigation／layout 不排 snapshots |
| Binary | >256 MiB round trip；font reply chunked；錯序／超量／不完整不 deliver；dispose 釋放等待 |
| Host fonts | 同 font 並發一次 load、同 buffer identity；LRU；失敗 cooldown；TTC 按需抽單 face |
| Snapshot | unchanged flush export=0；burst 共用 export；途中新 edits 補 export；失敗 pending 保留；reload 使舊結果失效 |
| Provider | clean/saved snapshot 不被後續 edit 污染；backup 還原 dirty；large font header 完整 |
| Real Web Host | 小真實檔 render/edit/save/Undo/Redo/re-edit/inactive Save All/LFS write protection |
| Benchmarks | 預覽出現；沒有 ≥2 秒 task；font benchmark 無 transfer error／navigation snapshots；checkpoint 模式三次 flush、沒有設計編輯時零 snapshot/reimport |

歷史 benchmark 的輸入、數據與限制詳見 [page-load-performance.md](page-load-performance.md)。這些是指定 Chromium／檔案／字型環境的證據，不代表所有 VS Code／GitLab 或大型 Save／Undo 都已通過。本次整理的實測結果附在文件末尾。

## 8 可直接交給另一個 Agent 的提示詞

```text
請復刻 OpenPencil VS Code 專案目前工作目錄的修復。
先讀 AGENTS.md 與 docs/patch-reproduction-guide.zh-TW.md，逐項完成 A–Q。
本次來源包含未提交／untracked 的修復；請取得實際 source，不要只使用 Git HEAD。

固定 upstream commit 6cf1748e31a0e43d3794d43abbd003ce9caa3c6f 與 lockfile。
vendor/openpencil 保持乾淨；upstream 既有檔修改生成 patches/openpencil/v0.15.1.patch。
新 extension 程式放 src/openpencil-extension，build resources 放 overlay。
不要手改 .openpencil-cache、dist 或 node_modules。

必須一起復刻 upstream diff、Vite/npm transforms、bridge/renderer/host helpers、build 接線與測試。
重點是 CanvasKit 共用 heap、worker 入口、大圖 worker previews/資源釋放、
font dirty scheduling、FIG 少複製、navigation/layout guard、8 MiB binary IPC、
host font identity/cache/cooldown、SnapshotQueue、node callback 包裝、
snapshot failure 保留畫布，以及 revision/ack/flush sequencing。

請以本次 source 與 tests 為準；部分舊 audit docs 記載 workers disabled 等舊狀態。
先跑 typecheck/unit/build，再用實際小檔跑 Web Host save/history/LFS。
若提供大型 sample，跑 page-load、host-font、checkpoint benchmarks。
回報修改檔案、每項驗證結果與未驗證項目；沒有 sample 就明列未跑，勿把 build PASS 當作大檔 Save/Undo PASS。
```

## 9 本次整理的驗證紀錄

2026-10-01 在目前工作目錄執行：

- `npm run test:unit`：61 tests 全數通過，無 skip；pre-script 成功重建 staging 並套用 upstream patch。
- `npm run typecheck`：26 個 JavaScript 檔案語法檢查通過。
- `npm run build`：extension 與 Vite production UI 成功建置，4532 modules transformed，沒有觸發 guarded patch 失配錯誤。仍有 dependency externalization、CSSOM direct eval、dynamic import chunking 警告。
- `git apply --stat`：確認 upstream patch 修改 18 個既有檔案。
- `git diff --check` 通過；`vendor/openpencil` 狀態乾淨，pin 符合指定 commit。

本次未重跑 Web Host、package 與真實大型檔案 benchmarks；本次成功建置和 unit tests 不取代這些驗證。這次交付修改交接文件與 README 索引，既有修復程式及使用者未提交修改保留。
