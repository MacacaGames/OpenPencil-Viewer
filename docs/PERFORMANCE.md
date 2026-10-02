# 效能與資源限制

已測 **合成 sparse raw transport** 與你提供的三份真實 FIG（headless 格式／graph + 原生瀏覽器載入），未測 GPU 記憶體／視覺 fidelity、NAS 磁碟或 LAN。原始數據 `performance.local.json` 與 `performance.fixtures.local.json`；命令 `npm run benchmark` 只在 disposable `.work/transport-benchmark-*` 建立合成檔，結束刪除，沒有開 NAS 或網路。

2026-10-02 Asia/Taipei，macOS arm64，Node 22.23.3；1000 小 metadata 檔 + 50/200/500 MiB sparse 檔，索引 1004 筆（含 root），scan **52.8 ms**。以下是 Python descriptor reader → Node 消耗後丟棄，沒有 FIG decode、browser allocation 或 UI。

| Raw size | First byte | Total | Throughput | Parent peak RSS |
|---|---:|---:|---:|---:|
| 50 MiB | 38.3 ms | 70.2 ms | 712.6 MiB/s | 115.3 MiB |
| 200 MiB | 36.3 ms | 116.7 ms | 1714.5 MiB/s | 117.5 MiB |
| 500 MiB | 37.6 ms | 203.9 ms | 2452.6 MiB/s | 125.0 MiB |

Sparse holes/page cache 使吞吐非常高；不能用來預估 NAS 實體磁碟／SMB/NFS／LAN／TLS。RSS 只量 parent process，未量 Python child、瀏覽器、GPU、檔案 page cache。合成 E2E 的小型兩頁 `.fig` 可正確渲染，不代表 500 MiB FIG 可用。

## 操作員批准的真實 fixtures

2026-10-02，你授權 sibling test_files 唯讀測試。`tests/container/fixtures.sh` 在 Docker Desktop arm64 及 emulated amd64 以 pinned Linux descriptors 讀取三檔；與 host 前後 sha256／size／mtime 完全相同。未對 supplied files 嘗試寫入；mount 寫入拒絕只在 synthetic fixture 上測試。

`bun tests/adapter/inspect-fixture.ts /absolute/approved/file.fig` 使用 bounded safety、真實 native `parseFigFile(populate:all)`、readonly graph lock；原始檔不變。每檔獨立 process，報告不含設計名稱或內容。

| Bytes | Pages / nodes | Safety | Native parse | Process peak RSS |
|---:|---:|---:|---:|---:|
| 167,558 | 1 / 322 | 13.0 ms | 33.9 ms | 84.5 MiB |
| 9,108,449 | 1 / 378 | 123.3 ms | 91.3 ms | 139.1 MiB |
| 409,977,351 | 3 / 1,586 | 2599.4 ms | 302.1 ms | 1843.2 MiB |

391 MiB 檔在 arm64 Linux raw read **356.68 ms**；這是 Desktop 共享 host 檔案與 cache，不是 HTTP/LAN 或 NAS 磁碟。Headless graph parse 不含 browser buffers／worker copy／layout／CanvasKit／GPU；不要用 1.8 GiB 推算真實 browser 記憶體或聲稱完整視覺 fidelity 已過。

## 真實 FIG 的原生瀏覽器載入

`REAL_FIG_FIXTURE_ROOT=/Users/agent01/git/OpenPencil-GDrive/test_files npm run test:e2e`（Node 22.23.3／Chromium、1440×960）共 **2 PASS / 28.1 秒**，包含原有 A/B 唯讀驗收與 opt-in 真實檔測試。後者在 localhost Mock 介面替換已批准 metadata／bytes，短暫 loopback streaming endpoint 避免 Playwright base64 字串限制；不是 NAS 授權或 BFF throughput 測試。每檔獨立 browser context，real documents 不保存 screenshot／trace／video。

| Bytes | Native pages | 點開至 native UI ready |
|---:|---:|---:|
| 167,558 | 1 | 1,060 ms |
| 9,108,449 | 1 | 6,229 ms |
| 409,977,351 | 3 | 11,049 ms |

Native canvas／layers／pages 出現、新增頁面 disabled、AI 不顯示，無 page／console runtime errors、無外部 HTTP／WS，來源 hash／mtime 前後相同。公開報告 `performance.browser.local.json` 不含原始名稱或內容。變數面板的 readonly watcher 問題已修復並以實際 Vue panel／graph regression 驗證。

這是指定主機／瀏覽器／三份文件的實測，沒有量 GPU memory、像素 fidelity、NAS／LAN、反覆切換或 soak；391 MiB 成功不表示任意 512 MiB FIG 都可用。

## 已實作限制

- BFF 只定期索引 metadata；每次列表不掃全目錄、不下載全部設計。當前為 bounded periodic reconciliation（預設 60 秒），**沒有 incremental watcher**。
- 每 root 最多 100000 observed entries、depth 64，subprocess scan/stat 30 秒、JSON 32 MiB。失敗保留 metadata 並 offline，沒有 zero-file 成功 fallback。
- raw `.fig` 最大 512 MiB；列表不發布超限 file。單 principal 一個串流，全域預設四個、上限十六，超限 429。授權在開檔前重新檢查，不跨身份快取 bytes。
- Python 64 KiB chunks、descriptor revision/root identity 前後比對；最後 block 等檢查完成才送出。stream 有 backpressure、HTTP/reader cancel 釋放；進行中修改可能已有部分 bytes 送出，**不保證原子 snapshot**，client 對短／超長結果拒絕。
- UI 依 metadata 精確分配 bytes，檢查 Content-Length、download limit／revision／結束長度，有 progress/cancel。Range 暫不支援（416），沒有 resume。
- bounded FIG preflight worker 與 FIG session worker，整個 decode/preparation deadline 60 秒；無 main-thread fallback。全頁 materialize/layout 再 readonly，換文件／登出是完整 navigation + dispose，清理 worker/GPU。

Browser 的 raw buffer、preflight copy、FIG archive、解壓資料、scene graph、CanvasKit/GPU 會同時佔記憶體，遠高於 raw file。512 MiB 只是 configured maximum，**不是已證實支援的實用大小**。4 GiB container example 也不是量測完成的容量保證。可保守降低 maxFileBytes；需要實測後設定 timeout/memory，不能因 timeout 開回不受限 parser。

## 待驗收

繼續使用已批准的真實 fixtures，補充去敏／合成且結構有代表性的有效 50/200/500 MiB FIG（含 pages/layers/images/text/variables），記 sha256、節點／影像數、source revision。分別測列表 scan/搜尋、click→first byte→download complete→parse→layout→first presentation、主 process/child/browser/GPU peak、取消各階段、切換十次、24 小時穩定、來源改寫、網路斷線。以目標 NAS、瀏覽器/GPU、LAN速率、TLS/proxy buffering 條件執行並記完整結果；目前 **blocked：native NAS provider／目標 NAS 不可用**。
