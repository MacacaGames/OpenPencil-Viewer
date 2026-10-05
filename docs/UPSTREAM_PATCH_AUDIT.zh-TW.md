# Patch 與 upstream 修正調查

> 2026-10-05 後續實作：使用者指定改用 MacacaGames fork。最新基準為 `a50444c2`；圖片修復分支為 `codex/fix-image-reading-memory`，Portal 最新 pin 為 `e4ef22826ff238bba57eeeb7bc769d4a2d355ce1`（包含 CONTRIBUTING 測試修正）。下方早期 `6a05e30`／舊 pin 比對保留為歷史；不能當成目前設定。


調查日期：2026-10-05，Asia/Taipei。結論是 **部分已有 upstream 修正；整套 patch 不能直接升級套用**。本次只新增調查文件、提報草稿與合成重現材料，沒有修改正式 submodule、pin、Portal runtime 或既有 patch。

## 比對基準與證據

- 現在 pin：`8c72b62da07ea1f7e82de84c7c837c3c78dfbf95`，`upstream.lock.json` 的版本為 0.15.1。
- 即時查詢的 `origin/master`：`6a05e30f15398de70d36deda011003b4347d1627`，比 pin 多 **57 commits**。用 `git ls-remote` 取得，完整歷史下載至 `.work/upstream-audit/source`；正式 submodule 未 fetch 或 checkout。
- 原始 `patch-reproduction-guide.zh-TW.md` 指的是另一個 VS Code host、SHA `6cf1748e…`。本專案真正採用的是 `patches/open-pencil/series` 的 0001–0005，不能把指南 A–Q 全當成現在的 patch。
- Git 歷史、程式差異和 GitHub API 的 PR merged 狀態交叉比對。查詢 CanvasKit、memory、resize、shader、font render、worker archive，包含 issues 與 PR、open 與 closed。前五個以外的 `font render` 搜尋只有第一批 100/118 筆；沒有聲稱搜尋涵蓋所有討論。
- 隔離 checkout 用自己的 frozen dependencies 完成 `bun run build:packages`。數值診斷使用 mock initializer／surface／renderer，證明程式生命週期，不能替代 browser pixels、實際 WASM/GPU 記憶體或原機 crash。

## 0003 真正修復的問題

| 本地修復                                                             | 最新 upstream 狀態 | 判斷與處理方式                                                                                                                                                                                                                                                                        |
| -------------------------------------------------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CanvasKit in-flight singleton（指南 G）                              | **未修**           | 最新 Core 仍只保存 resolved instance。兩個 concurrent callers 各啟動一次 initializer；已用 diagnostic 重現。失敗後能 retry 本來就存在，本地新增的是共用 pending promise 並保留 retry。                                                                                                |
| zero/no-op resize（H）                                               | **未修**           | 最新 `resizeCanvas` 沒有這兩個 guard。mock 測試各多建一次 surface。本地與 upstream 現在都保留 rAF throttle；不移植指南的 80ms debounce。                                                                                                                                              |
| image shader wrapper 釋放（I 的一部分）                              | **已修**           | [PR #868](https://github.com/open-pencil/open-pencil/pull/868)，merge [d2e380ea9](https://github.com/open-pencil/open-pencil/commit/d2e380ea9d76dc090d81ee606ccf840015d89b72)。TILE／其他 image branches 現在都會在 Paint 接手後 delete wrapper；亦處理多種 gradient/pattern shader。 |
| decoded image byte-budget LRU（I）                                   | **未修**           | 最新 `SkiaRenderer.imageCache` 仍為普通 Map；目前沒有該 cache 的 byte-budget eviction。已核對 source，尚未量測合成檔的實際 OOM。                                                                                                                                                      |
| serialized worker previews／encoded preview LRU／保留 TILE 週期（I） | **未修**           | 最新沒有本地 `ImagePreviewCache`、tier decoder 或本地 large-document policy。已有其他 retained-backing/cache 優化，不等於這項修復。                                                                                                                                                   |
| font callback 交 scheduler、避免 synchronous reentry（J）            | **未修**           | 最新 surface 的 font callback 仍呼叫 `renderNow`。mock font completion 在 draw 中觸發時，depth 為 2；本地 patch 為 1。                                                                                                                                                                |
| disposal 後阻擋 late frame（0003 額外項目）                          | **未修**           | 最新 loop `pause()` 解除事件訂閱並取消當下 frame，但 `markDirty()` 仍可新排 frame。source 呼叫 pause 的地方是 teardown；本地 paused guard 阻擋此路徑。                                                                                                                                |
| full-resolution render 的 finally 恢復                               | **未修成本地形式** | 本地恢復 viewport／preview mode；最新還沒有 preview mode，不能把兩段程式直接視為同一個 upstream bugfix。移植預覽時必須保留完整解析度路徑與例外清理。                                                                                                                                  |

相關但不是同一個問題：

- [#823 / 7fff3de1b](https://github.com/open-pencil/open-pencil/commit/7fff3de1ba68a0c346816db029df1e8ddc9f64d1) 已修「CanvasSurface 提供 element 的時機晚於 CanvasRoot mount」。這不是 Core simultaneous initialization，也不是 no-op resize。兩者可並存。
- [#880 / de0c48f47](https://github.com/open-pencil/open-pencil/commit/de0c48f47d17ef073b799f32f327c91436b189fa) 已修未修改的 worker-opened FIG 保存卡住的 MessagePort listener。Portal 禁止 save／write-back；它沒有取代本地 renderer 修復。
- [#863](https://github.com/open-pencil/open-pencil/pull/863) **open、merged=false**，限制 fallback scene picture 的記錄範圍；關聯 [#580](https://github.com/open-pencil/open-pencil/issues/580)。不是 decoded image LRU，但與本地 preview mode 繞過 scene-picture 的策略相鄰，應先協調。
- [#587](https://github.com/open-pencil/open-pencil/issues/587) 仍 open，討論換頁後記憶體成長。可優先補上 synthetic evidence，但未證實所有症狀共用一個原因。較早的 [#500](https://github.com/open-pencil/open-pencil/issues/500) 已 closed，不代表目前 image cache 問題消失。

## 可重現的 source 診斷

命令：`bun run docs/upstream-contribution/probe-lifecycle.ts <isolated-checkout>`，每次使用新 Bun process，避免 module mocks 互相污染。

| 觀測                              | 最新未 patch upstream | 最新 + CanvasKit-only 草稿 | 現在 pin + 完整 patch |
| --------------------------------- | --------------------: | -------------------------: | --------------------: |
| 同時 initializer 次數             |                     2 |                          1 |                     1 |
| 兩個 caller 是否取得同一 instance |                 false |                       true |                  true |
| 初次失敗後 retry                  |                  PASS |                       PASS |                  PASS |
| pause 後 markDirty 排入的 frames  |                     1 |                          1 |                     0 |
| 相同尺寸多建立的 surfaces         |                     1 |                          1 |                     0 |
| 零尺寸多建立的 surfaces           |                     1 |                          1 |                     0 |
| font callback 最大 draw depth     |                     2 |                          2 |                     1 |

最新的診斷在安裝其 frozen dependencies 後重跑，結果一致。這些是 deterministic contract observations；沒有假稱已重現 Test (3).fig 的白畫布／OOM 或修復全部視覺問題。

## 與現狀的衝突

### 文字套用結果

現在 pin 的 archive 上，按 series 順序 `git apply --check` 後 apply：**0001–0005 全部 PASS**。

最新 upstream 的 archive 上，真正按 series 順序檢查：**0001 就 FAIL，停止**。因此未聲稱 0004／0005 已完成最新 sequential integration。

另對未 patch 的最新 source 做單份檢查，供定位：

| Patch                | 獨立 check | 衝突位置／限制                                                                                                                                    |
| -------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0001 LAN readonly    | FAIL       | `document/io/source.ts`、Core editor `create.ts`、FIG `read.ts`、collab `use.ts`、`EditorWorkspace.vue`、`PropertiesPanel.vue`、`CodePanel.vue`。 |
| 0002 scene transfer  | PASS       | 只是 textual apply；FIG reader/session/serialized graph 已改，不能當 runtime 相容通過。                                                           |
| 0003 renderer memory | FAIL       | `fills.ts`、renderer `lifecycle.ts`、`pipeline.ts`、`renderer.ts`。CanvasKit 與 Vue lifecycle/render-loop hunks 在此 standalone check 沒報錯。    |
| 0004 remote desktop  | FAIL       | `router.ts`；它依賴 0001 先改 router，單份失敗不能獨自推論是新增 upstream regression。                                                            |
| 0005 session edit    | FAIL       | Properties／Pages／Code panels；也依賴 0001，不能把獨立結果當最終 rebase 結果。                                                                   |

### 必須保留的語意

1. **shader 的 `paint` 參數。** #868 讓 fill helper 同時服務 fillPaint／strokePaint。本地舊版直接寫 `r.fillPaint`；若硬貼回最新，可能使 image stroke 錯繪。沿用 upstream target Paint 與現有 shader disposal，去掉本地重複 release；不可 delete 兩次。#868 依賴 [#864 的 Stroke extends Fill](https://github.com/open-pencil/open-pencil/commit/f55b887d2bdb3ea9a623cf271a82582b0580126c)，不是可隨意 cherry-pick 的兩行修正。
2. **renderer 新功能。** 最新 lifecycle 多了 transient previews 清理，pipeline 多了 `hasTransientPreviews` 等 uncached conditions。重建 0003 時要合併條件並保留清理。若 owning cache 的 `clear()` 自行 delete native handles，要去掉 upstream 手動 delete loop，避免雙重釋放。
3. **已存在的 cache abstraction。** upstream Core 的 `cache/resource.ts:ResourceCache` 已提供 bounded owning LRU；upstream PR 應延伸它，不直接搬 Portal 的 Map subclass。它拒收單張超過預算的資源，ownership 留給 caller；本地卻保留一張 oversized image。因此必須明確設計 draw borrow／暫存資源清理，不能只換類別名稱。
4. **確定的 adapter API 不相容。** [#692 / 418457bfb](https://github.com/open-pencil/open-pencil/commit/418457bfb5f9de0de109b4c2e1594548de9f3c73) 把 `prepareForExport()` 改為 `Promise<void>`，在函式內完成 text measurer scope。現在 `packages/upstream-adapter/server-renderer.ts:64` 仍接收 `restore` 並在下一段呼叫它；直接升級會 typecheck 失敗，或在未經型別檢查的 bundle 路徑出現 `restore is not a function`。這是 source/API 已確認的不相容，本次未建置整套升級 Portal 來重現 runtime exception。
5. **FIG reader/session。** [68c2af560](https://github.com/open-pencil/open-pencil/commit/68c2af560017de428b91b595d9a791b6bb8d65a2) 改為 occurrence-scoped reader，serialized graph 移除 `lazyFigImport`。目前 server parser 的 `delete data.lazyFigImport` 要重新對齊型別；仍須確保 archive/schema/recovery payload 不送出。0001 的 `allowMainThreadFallback:false` 要合併新版的 ReaderSemanticError 判斷，而非覆寫它或允許 unbounded fallback。
6. **新增 app mutation／外部入口。** 最新加入 slots、CLI/MCP document controls、live lint fixes、Code tab 與 canvas 同步等。這些不是已驗證的 Portal 安全整合。重建 guard 要檢查新 editor actions，保持 readonly graph immutability；session-edit 仍禁止 persistence、export、外部文件流量。
7. **readonly helper 與通用 editor 的差異。** 本地 image-size policy 以 graph identity memoize，偏向不變文件；upstream 支援新增／替換圖片與多種 image stroke。提交一般性 preview 功能前必須測 image source revision、edit invalidation、TILE transforms、效果、色彩、retained pictures、完整解析度輸出，以及高 zoom 清晰度。2048px cap 和 128/64MiB 都是本地策略，不能自動當 upstream 的產品政策。

**建議目前維持 pin。** 已解決的 shader 部分沒有必要重報 issue；若短期只想補 gradient/pattern shader release，可提出獨立 backport，保留現有本地 image release。完整升版應另建 candidate，更新 adapter、重建 series，再跑專案既有 test/typecheck/verify-upstream/build/adapter/browser gates；不能只改 lock SHA。

## issue／PR 的準備順序

1. CanvasKit singleton 是最小、已 deterministic 重現的第一個 PR。已有不含 Portal import 的 source-only patch、英文 issue 和 PR description 草稿。先轉成 Core owning-domain 的 regression test，涵蓋 concurrent resolve／shared rejection／retry／resolved reuse；使用隔離 mock process，避免污染其他 suite。
2. Resize／font scheduling／terminal disposal 分別提交小型修改；新增 package-local tests 並延伸既有 render-loop 測試領域，依 current testing architecture 決定是否需整個 domain 移位。不要新增 `tests/engine` 的新 test home。
3. 先量測 synthetic image files，再將證據補進 #587 或建立精確的新 issue。先做 decoded image ownership/budget，之後才做 previews，並先與 #863 協調 retained picture 路徑。尚未有 browser/OOM 證據的 image issue 草稿不應直接送出。
4. 提報遵守 [CONTRIBUTING.md](https://github.com/open-pencil/open-pencil/blob/6a05e30f15398de70d36deda011003b4347d1627/CONTRIBUTING.md)：英文、Conventional Commit PR title、保留 template 的 Summary／What changed／AI assistance／Validation；加入適當 Fixed/Performance changelog，列實際跑過的命令。AI 模型揭露放 PR，不加 AI co-author。
5. 提交前重新搜尋現有討論，跑 upstream `bun run check`、`bun run format`、`bun run test:unit`、`bun run test`。像素變更需要 committed visual snapshots 並在 update 後重跑。涉及 FIG 格式改動須經 live Figma round-trip；fixtures 放 upstream `tests/fixtures/` 時遵守 Git LFS。

本次未建立 GitHub issue／PR、未 push。草稿是準備材料，不是已完成 upstream contribution gates 的 PR。

原始指南其餘項目的界線：A–E 是 VS Code host 的 route／save／watcher／LFS／資源 URL 整合；M–Q 是 host binary/font IPC、snapshot 與 revision 協議。這些並不是目前 Portal series 內的通用修復，不應整包投稿。F 的 published-package worker 入口問題在本專案 source/Vite build 路徑也不能直接照搬。K 的少複製 FIG parse **沒有移植到現在的 patch**，最新 browser parse 仍建立 fallback copy 和兩份 worker buffers；若要另提優化，必須配合新的 reader recovery／original-archive 契約，不能拿 #880 的 listener 修正當作 K 已完成。L 的 VS Code navigation-snapshot 行為則因 Portal persistence 被停用，不是現在的回寫問題。

## 不含機密的 FIG

採 **全新 SceneGraph**，完全不讀／裁切／改名 Test (3).fig。首版用 procedural PNG；使用者確認無法重現後，改為數百張公開 CC0 JPEG，實際嵌入資料累積約400MiB。只刪圖層或遮字仍可能留下 embedded images、thumbnail、原始 schema、library/component references 或其他 metadata；從零建立可排除原檔資料。

最新版在 `.work/upstream-repro-large/output/image-heavy-400mib.fig`：**420,822,973 bytes／401.3MiB、262張不同JPEG、3頁（88/88/86個圖片節點）**。真正圖片內容為420,741,689 bytes，沒有 padding 或重複圖片變體。素材來自 [The Met Open Access](https://www.metmuseum.org/hubs/open-access)，只收錄 API `isPublicDomain=true` 且 copyright credit 為空的項目；154張 primary image、108張 additional image。`sources.json` 保留逐張 artwork／artist／credit／來源 URL／metadata URL／CC0／尺寸／雜湊，JPEG 原始 bytes 未改動。

FIG SHA-256：`36b759d00fe266d074620af0cbf619e5c090c8da29c74947358b422bca9d78ea`。全部JPEG結構與像素解碼PASS；pinned與latest parser均PASS（266 nodes、262 referenced images、0 text nodes，每張image hash符合公開inventory）。由相同inventory重新生成，FIG hash完全相同。

**最新 upstream 的真實 WebGL renderer 已觸發記憶體壓力下的中止。** 三次獨立Chrome測試都在第一頁 `Aborted()`；詳細trace記錄78張decoded cache與WASM heap達到2,147,483,648 bytes後失敗。CanvasKit0.41.1 binary memory section的上限確為2GiB，未由harness人為降低。失敗位置附近23張相同JPEG另建3頁控制檔後，全部正常繪製、0 errors，heap capacity691,404,800 bytes；支持累積記憶體耗盡而非單張壞圖。環境為macOS arm64／Chrome154／ANGLE Metal Apple M1 Max／DPR1。Chrome程序仍存活，失敗是caught CanvasKit abort。RGBA+mipmap合計8,982,841,814 bytes只是估算，不是測得RSS／VRAM。

這是直接使用未修改upstream parser／renderer的獨立browser harness，沒有啟動app storage、autosave或collaboration。**仍未驗證**完整app的worker/import路徑、目前Portal整合執行、live Figma import，以及與保密原檔完全相同的硬體／stack。不得把上述renderer結果擴大成所有部署環境已驗收。

大檔超過 [GitHub一般附件25MB上限](https://docs.github.com/en/get-started/writing-on-github/working-with-advanced-formatting/attaching-files)，準備以公開reproduction repository的Release asset提供（[每個asset需小於2GiB](https://docs.github.com/en/repositories/releasing-projects-on-github/about-releases)），issue附小型inventory／SHA256SUMS／generator／sanitized log。尚未上傳或提交issue／PR。

先前三份小控制檔保留在 `.work/upstream-repro/`；使用者確認它們無法重現原問題：

| 檔案                   |             大小 | 素材                                                | 用途                                                                                                                                                 |
| ---------------------- | ---------------: | --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `repaint-fit-tile.fig` |     39,789 bytes | 1 個512² PNG、32個 image nodes、2 pages             | repeated repaint／FIT-TILE／resize／page-switch 的小控制組。                                                                                         |
| `many-images.fig`      |  1,353,378 bytes | 129 個 distinct512² PNG、129個 image nodes、2 pages | 每個資源都有引用，跨本地 `>128 images` preview threshold；RGBA+mipmap 合計估計172MiB。                                                               |
| `large-images.fig`     | 12,944,719 bytes | 16 個 distinct4096² PNG、16個 image nodes、2 pages  | 少數高解析圖片的 decoded-cache 壓力；估計合計1.33GiB。encoded 約12.3MiB，所以**不會**跨本地32MiB/128張 preview threshold，適合獨立觀察 decoded LRU。 |

以上估計不是 total RSS/GPU 上限，也不是測得的峰值。全部通過 pinned exporter/importer、最新 upstream parser、ZIP CRC、PNG CRC/尺寸/解壓長度、image SHA-1、archive SHA-256 與固定 meta allowlist；latest parser 確認 image references、2 pages、0 text nodes。沒有真人文字、字型、網址、library bindings 或原始 document metadata。

最終 generator 再生成一次，三個 archive SHA-256 與 manifest 均相同。generator 與 diagnostic 在最新 checkout 的 package exports 上通過 standalone strict TypeScript 檢查。

小型 `repaint-fit-tile.fig` 已於新browser harness正常繪製；其餘兩份僅保留parser／integrity驗證。**仍未驗證：** live Figma import／重新 Save local copy、與原檔相同 failure signature、最小化到最少圖片數。不能因為 parser PASS 就稱原問題已成功重現；大型公開檔的實測結果另列於上方。

若 Figma 拒收 OpenPencil exporter 的 FIG，解出這些 synthetic PNG，在一份全新的 Figma 文件重建同樣2頁與尺寸，再 Save local copy。仍只使用新素材，不以原機密檔為母版。先確認實際 failure，再逐步二分降低圖片數／解析度／頁面數；CanvasKit concurrency 和 disposal race 用 code diagnostic 即可，不勉強塞進 FIG。

公開包只包含上述 FIG、manifest、scripts、source-only patch、英文草稿與無路徑的 numeric evidence JSON。上傳前記錄 OS/browser/GPU/DPR、SHA、cache計數、JS/WASM/RSS分項、page-switch/reopen步驟；所有截图與 log 只使用這些合成文件。

## 後續實作與最終驗證（2026-10-05）

使用者 fork／官方 master 已共同推進至 `a50444c2`，圖片問題仍未修復。現已在 [MacacaGames 修復分支](https://github.com/MacacaGames/open-pencil/tree/codex/fix-image-reading-memory) 實作 native Core/Vue fix，Portal pin 為 `91228ec1`。以現有 ResourceCache 取代 adapter 的 Map subclass；browser decoder 位於 Vue，Core 無 DOM 依賴。Portal 既有 patch 重新移植，保留 readonly／session-edit no-persistence 邊界，另補新版 save-to-path 禁用與 page-background readonly clone。

公開 400 MB FIG 的最新版 before/after 結果：原始版本第一頁於 78 cached images／2 GiB WASM capacity abort；修復版本完成三頁與來回換頁、0 errors，WASM capacity 最大 128 MiB。Fork 全部 unit tests 4,838 pass／1 skip／0 fail，相關 browser tests 18 pass；Portal 58 tests、13 adapter tests、4 browser tests 均 pass（另 1 real-fixture opt-in skip），build／root+editor typecheck／format／pristine pin 驗證通過。完整 fork check 剩 baseline 的 5 個 AI-provider `fetch.preconnect` 型別錯誤；native/Tauri／Figma import／live NAS 不在這次通過範圍。

[Issue 範本](upstream-contribution/issue-image-memory.md) 與 [PR 範本](upstream-contribution/pr-image-memory.md) 已更新為實測版本，交由使用者手動建立並附公開 FIG。相關 PR #863 仍 open，#868 已 merged，#587 仍 open（2026-10-05 GitHub API 再核對）；本次沒有發布任何 issue、PR 或 FIG。
