# OpenPencil × Synology LAN Portal — 開發計畫

版本：1.0｜日期：2026-10-01｜供 Codex 執行的實作規格
狀態：已查閱官方文件與部分 upstream source；尚未在使用者 NAS 實測或部署。

## 0. 決策摘要

建立公司區域網路內的 `.fig` 瀏覽入口：Google Workspace 登入，對應相同 email 的 Synology 帳號，依其可存取範圍顯示 NAS 上的設計文件，雙擊後在自架的完整 OpenPencil UI 開啟。

**本次 MVP 採唯讀。** 前文「以唯唯為目標」暫按「以唯讀為目標」規劃；不把上一版方案中提過的 Save 自動算進本輪。若業主確認需要編輯存回，依第 14 節的第二階段規格啟用，不偷偷把 mount 改成 RW。

核心決策：

- 原始 `.fig` 留在 Synology 的指定共享資料夾；不匯入新的文件資料庫，不另存工作版本。
- Portal 可 Docker 部署。首選與檔案同一台 Synology，減少跨主機掛載與權限語意差異。
- Google 僅用於登入，不呼叫 Google Drive API、不安裝 Drive Plugin、不要求 Drive scopes。
- 同 email 是身份對應，不是 NAS 檔案授權。正式環境要求有效的 DSM 權限驗證。
- 原生 DSM 權限整合可能需要 NAS 端小型 helper；不能承諾一個普通 Docker bind mount 自動取得每位登入者的權限。
- OpenPencil 官方 repository 為 pristine Git submodule，固定 SHA；外層整合及少量 patch 分開維護。
- 第一版不做 Yjs、同步客戶端、Git LFS、桌面 App、VS Code extension、DSM/Drive Web UI patch。

優先順序：**不洩漏文件 > 不修改 NAS 原檔 > 正確呈現設計 > 區網效能 > upstream 維護便利。**

本文件中的架構、型別、參數與門檻是工程設計；[Sxx] 為一手來源。Codex 必須再核對實際固定的 upstream commit、DSM 版本與 NAS 環境。

## 1. 使用體驗與範圍

```text
員工瀏覽器
  → 開啟公司內部 Portal
  → 使用 Google Workspace 登入
  → 自動匹配已存在且啟用的 Synology 帳號
  → 只看到有權限的資料夾及 .fig
  → 雙擊文件
  → 原生 OpenPencil 介面：畫布、頁面、圖層、屬性
  → 縮放、平移、切換頁面、檢視設計
```

| 第一版必做 | 驗收定義 |
|---|---|
| Google 登入 | 不另設 Portal 密碼；只接受設定的 Workspace 組織 |
| 同 email 匹配 | 唯一、有效、管理員信任的 NAS 身份；未知或重複一律拒絕 |
| DSM 存取限制 | 沒權限的文件名稱、縮圖及 bytes 都不外洩 |
| 本機檔案目錄 | 只掃指定 roots，呈現 `.fig` 與必要的資料夾 |
| 雙擊開啟 | 保留完整 upstream 檢視介面，不以自製圖片 viewer 取代 |
| 唯讀 | 原檔 mount、API、Editor 三層均禁止修改原檔 |
| 大檔 | 列表不下載全檔；開啟進度、取消、失敗與資源限制清楚 |
| 可維護 | Docker、設定手冊、Mock、測試、submodule 更新流程 |

唯讀指不能修改原始文件，**不是 DRM**。瀏覽器要渲染 `.fig` 就會取得內容，不能承諾禁止下載、複製、截圖，或在撤銷權限後遠端抹除已取得的 bytes。這與「不自動建立另一份正式文件」並不衝突。

## 2. 架構與信任邊界

```text
Google Workspace ── OIDC ──► Portal BFF
                              │
Browser ── HTTPS/LAN ──► Web UI + 原生 OpenPencil
                              │
                       已驗證的應用 session
                              │
                    Identity Resolver + Authorization
                              │
                 NAS Identity / Effective Access Bridge
                              │
                 指定 NAS roots：列檔、檢查、讀取
                              │
                     原本 Synology .fig 文件

SQLite：session、身份綁定、metadata index、audit
Cache：可重建的縮圖，獨立於原始文件目錄
```

「本機方式」指 NAS 端從檔案系統讀取，而不是讓 browser 使用本機同步資料夾。Browser 仍透過 LAN 取得文件內容。

**資料路徑有兩個實作 profile：**

1. `local-filesystem`：Docker 內讀取 RO bind mount。僅在權限 provider 已可靠判定有效權限，且安全開檔路徑經驗證後使用。
2. `nas-brokered-read`：NAS helper 在授權的身份／範圍下開啟檔案並串流給 BFF。適用於 Docker 無法安全重現 NAS 身份與 ACL 的環境。仍是 NAS 本機 I/O，不經 Google、不使用第二套檔案庫。

正式版本不得留一條不經授權的「快速 local-filesystem」fallback。helper 是待開發的自訂元件，不是 Synology 現成套件。

### 2.1 技術選擇

Web 及 upstream adapter 使用 TypeScript，沿用 upstream 的 Vue/Vite/Bun 工具鏈。BFF 建議 TypeScript + Hono，部署使用實作時受支援的 Node.js LTS，固定確切版本。SQLite 放單一實例的本機 state volume；不預設把 SQLite 放 SMB/NFS。

不為 MVP 加入 Redis、PostgreSQL、S3。NAS helper 的執行方式／語言由 M0 的能力驗證決定，並記錄 native dependency 與 DSM 相容範圍。

### 2.2 部署位置

首選 Synology Container Manager：原檔 NAS 本機掛載，BFF 與 helper 鄰近。映像在 CI 建置，不要求 NAS 編譯大型 upstream。

Unraid 部署另列 profile：前端/BFF 可在 Unraid，但必須顯式驗證 NAS→Unraid 傳输、remote mount 權限、斷線行為與 NAS helper 連線。不能把 NFS/SMB mount 的 service UID 當成 Google 登入者，也不能在 NFS 消失時把空 mountpoint 當正常資料夾。

## 3. M0 先驗證的兩個高風險前提

### 3.1 OpenPencil 的原生唯讀整合

目前 upstream 已有 app session、storage provider 與 local-first cache/outbox 分層。[S01][S02] 這些 app internals 不是穩定對外 SDK；固定 SHA 後重新確認。

交付 `docs/UPSTREAM_AUDIT.md`，記錄：

- 原生 App 如何建置、啟動、載入 `.fig` bytes、切換文件及釋放 renderer。
- 真正的唯讀／view mode 是否存在；哪些 command、hotkey、面板、拖放可修改 graph。
- 如何保留選取、頁面、圖層、屬性檢視與 zoom/pan，同時禁止設計修改。
- 如何停用 Save、Save As、autosave/outbox、上傳、拖入取代與持久化私密文件。
- P2P、AI、MCP/automation、analytics、遠端字型等外連入口及關閉方式。
- CanvasKit/WASM/worker/font 靜態資產路徑；缺字型與不支援節點如何呈現。

不假設已有 `<OpenPencilEditor />` 全功能元件，不為迴避少量 hook 而重寫整套 UI。OpenPencil 官方架構包含原生設計介面與 browser 渲染；私密 Portal 必須另外處理權限與網路邊界。[S03]

### 3.2 Google-only 登入如何取得真正的 DSM 授權

建立 `docs/SYNOLOGY_CAPABILITY_AUDIT.md`，在授權的測試環境查證：

- 實際 DSM、Drive Server、Container Manager、CPU 架構、檔案系統、共享資料夾與 ACL 模式。
- 帳號來源是 local、LDAP 還是 AD；如何只讀取得帳號識別、email、狀態及有效群組。
- 如何判定「指定 NAS 身份」對某共享資料夾／子目錄／文件的有效 traverse/list/read 權限。
- native filesystem 是否涵蓋該 NAS 的 Windows ACL、群組 deny、繼承及進階共享限制。
- 是否需 host helper；所需權限、可用 API/CLI、安裝與升級方法。
- 在測試帳號的 File Station／SMB 基準下，比對結果；差異逐項記錄，不能憑印象宣布等價。

官方 File Station API 的 `perm.acl` 描述的是**登入該 API session 的使用者**；`CheckPermission` 文件公開的 `write` 方法也不是任意 username 的通用 ACL evaluator。[S04] 因此管理員登入 API 後，加上前端傳來的 email，不能代替使用者授權。

官方 CLI guide 有 local user/group/share 管理工具，但文件年代較早；不保證現有 DSM 有某個未核對的 email 列舉命令或穩定 JSON schema。[S05] 禁止 Codex 杜撰 `SYNO.API.*` 方法，或把未驗證的 `synoacltool` 輸出當完整存取判定。

M0 結果必須包含「已驗證、待實機、不可用」三類，及權限 provider 的 ADR。沒有 NAS 存取權時先完成 Mock 與 probe 腳本，不假報真實整合成功。

## 4. Google Workspace 登入與 LAN 網路

### 4.1 OIDC

僅申請 `openid email profile`。登入後驗證簽章、issuer、audience、expiry、nonce、`email_verified` 及 `hd`。永久身份鍵使用 `(iss, sub)`；email 用於首次對應及異動檢查，不取代穩定 subject。[S06]

使用後端 Authorization Code Flow，state 一次性、防 CSRF，redirect URI 精確註冊；依選用官方相容 library 核對 PKCE 支援。Google token 不進 localStorage、前端 bundle、URL 或 log。

因為只需登入，MVP 不要求 offline access、不保存 Google refresh token，不取得 Google Drive／Directory API 的權限。BFF 建立可撤銷的自有 session cookie：HttpOnly、Secure、合適 SameSite；改動 session／設定的 API 有 CSRF/Origin 保護。

### 4.2 LAN only 不等於離線

Portal 不開放外網 ingress，但新登入仍需要 browser 及 BFF 可連 Google 驗證端點。不能把本案描述成斷網仍可 Google 登入。

採公司控制的正式 DNS 網域，例如 `https://design.example.com/auth/google/callback`，以內部 DNS 解析至私有 IP；使用員工瀏覽器信任的 TLS 憑證。不要以 `http://design.local` 或私有 IP 當正式 Google OAuth Web redirect URI。[S07]

Authorization code 經使用者瀏覽器返回 Portal，再由 BFF 對 Google 換取 token。依此流程，設計可以不開公網 inbound；仍需實測 Workspace policy、網域設定、TLS 與 split DNS。

只允許明確 LAN subnet/VLAN，其他來源由反向代理與 firewall 阻擋；不可只依 `X-Forwarded-For` 判信任網段。信任代理名單、直接存取 BFF 的路徑都要測試。

### 4.3 帳號停用

DSM 帳號／群組狀態由 bridge 定期刷新，遇到停用、刪除或 mapping 異常即撤銷 Portal session。Google 帳號停用不保證即時撤銷已建立的 Portal session；MVP 以短 session、重新登入與管理員 revoke 控制，不宣稱具備 SCIM 或 Workspace 群組同步。

預設設計值：session 最長 1 小時、idle 20 分鐘；directory refresh 60 秒、超過 5 分鐘未更新就拒絕存取。這些是待調整的政策，不是供應商保證。

## 5. 同 email 的安全身份對應

### 5.1 對應模型

```text
Google verified (iss, sub, email, hd)
         ↓
管理員信任的 NAS Directory Snapshot / live resolver
         ↓
唯一、啟用的 NAS principal
         ↓
NAS instance + 身份來源 + native identity + lifecycle/generation
         ↓
每個 root/檔案的授權判定
```

NAS directory records 最少包含：principal key、來源、username、email、enabled、群組識別、觀測時間。UID/GID 只在 native provider 確認需要時使用，不把純數字 UID 視為永不重用的身份。

### 5.2 規則

- 只從管理員控制、受信任的 NAS directory adapter 匹配；不得讓使用者在表單輸入 NAS username。
- 先確認 NAS 普通使用者能否自行改 email。若能，該 email 欄位不能單獨作自動綁定信任來源，需管理員維護的可信對照或首次批准。
- 只對唯一匹配綁定；缺 email、重複、停用、非支援 directory、管理帳號或系統帳號均拒絕。
- 不以 email 前綴推導 username，不自動去掉 `+tag` 或 Gmail 點號，不推測 alias。
- 大小寫／正規化政策按組織已知規則實作，偵測 collision；不以無條件 lower-case 掩蓋歧義。
- 首次成功後綁定 subject 與 NAS principal；email 變更、同 email 新 subject、NAS user 重建／UID 重用時暫停，要求管理員確認，不靜默繼承舊身份。
- 不自動建立、修改 NAS 帳號，不改 password、群組、DSM ACL，不把管理員當未匹配使用者的 fallback。

自動 directory 收集優先採經 M0 證實的只讀入口。靜態 JSON/CSV 可作 Mock／管理員批准的過渡資料來源，但必須標示不是 live directory sync，並有有效期限及停用處理。

## 6. 授權設計：正式環境不能只做 UI 過濾

### 6.1 正式模式：`dsm-strict`

```text
可讀範圍 = 設定的 Portal roots
         ∩ 已驗證 Google / NAS 綁定且 NAS 啟用
         ∩ 該 NAS principal 的有效 traverse/list/read
         ∩ Portal 唯讀限制
```

目標是尊重指定共享資料夾及檔案 ACL，而不是複製 Synology Drive 虛擬分享連結、Office 文件分享或第三方應用所有規則。若來源有禁下載／服務層限制，需明確涵蓋或拒絕該來源，不能使用 local read 繞過。DSM 有 Windows ACL 與進階共享等多層設定，不能只檢查 `stat.mode`。[S08]

所有 list、search、metadata、thumbnail、HEAD、content 及 cache validation 均在後端授權。已知 opaque fileId 不代表有權限；未授權及不存在資源對外可統一 404，避免 existence leak。

- 不把容器 service account 的 `fs.access()` 當使用者權限。
- 不把父目錄可讀推定為所有子檔都可讀。
- 不把 `acl` 的簡單 allow/deny 列表當作已完整重現 Windows ACL。
- 權限來源超時／未知／schema 不符一律拒絕，不回傳未過濾列表。
- 每次開內容重新驗證有效權限；已開啟串流的撤銷延遲要明確記錄，不能保證追回已傳資料。

### 6.2 NAS helper 的最小邊界

以 M0 驗證結果為準，可以使用受支援的 native evaluator，或隔離 worker 以 NAS 身份執行安全開檔。若採 identity worker，必須正確處理 supplementary groups、UID/GID、權限降低及服務層限制；不在共享的 Node process 中來回 `setuid`。

helper 只允許固定操作：取得目錄身份資訊、授權列檔／查檔、讀取核准 `.fig`。不提供任意 shell、sudo、任意 path、任意 UID、修改 ACL 或檔案寫入。

同機以受保護 Unix socket 連線；跨主機以雙向驗證／短效憑證及來源限制保護。principal 由 BFF 的已驗證綁定取得，不相信 browser 自帶的 username。helper 的 socket 及 config 不可由一般 Portal 使用者寫入。

若只能在 NAS host 正確處理 native ACL，將 privileged 邊界隔離在小型 helper，而不是讓整個 Web container 使用 `privileged: true`。需明確揭露：這種 profile 除了 Docker App 外，還要安裝／維護 NAS helper。

### 6.3 非等價模式：`root-allowlist`

可為 Mock 或獨立測試 root 實作：管理員對 Portal principals 指定 allowed roots。這是第二套 Portal 規則，**不是沿用 DSM ACL**。

正式 `dsm-strict` 未完成時，不自動降級到此模式讀取正式資料。若日後業主明確接受 root-allowlist 作正式替代，需獨立 ADR、設定與驗收，不能悄悄改變原需求。

## 7. 本機目錄索引與 .fig 瀏覽

### 7.1 Roots 與資料模型

只掛載明確的共享子目錄，例如 NAS 的 `/volume1/Designs` 對應 `/data/designs`；以上路徑是範例，實際值由管理員設定。不能預設掃 `/volume1`、`homes` 或整台 NAS。

root 使用固定內部 id。file record 包含 opaque id、rootId、相對路徑、大小、mtime/ctime、觀測到的 revision、index state。Frontend 只收到授權後的名稱、相對顯示路徑與資訊，不收到 `/volume1/...` 真實 host path。

第一版 path-based 文件身份即可；改名／搬移可視為新位置，舊 deep link 明確失效。不以 `inode` 保證跨替換、回收或搬移的永久 File ID；需要搬移追蹤再另設計。

### 7.2 掃描

- 使用 bounded-concurrency 目錄遍歷，只索引 regular `.fig` 檔案及必要父目錄，副檔名比較可不分大小寫。
- 排除 recycle/snapshot/system/暫存目錄，例如 `#recycle`、`#snapshot`、`@eaDir`、`@SynologyDrive`、`.git`；依實際 NAS 設定調整。
- 預設不追 symbolic link；對特殊檔案、socket、device、FIFO、跨 root mount、可疑 hardlink 採拒絕或經驗證政策。
- 列表只用 metadata，不解析或下載每份完整 `.fig`。
- 不做每次 HTTP request 重新遞迴全目錄；使用 incremental scan + 定期 reconciliation。
- fs watcher 只作加速提示，overflow、NAS reboot、SMB/NFS 外部修改都需補掃。掃描失敗不得當空目錄刪除整份索引。
- NAS 尚未掛載／volume unavailable 時顯示離線，停止對該 root 發布新索引。

搜尋按授權後的名稱／相對路徑，不做設計內容全文搜尋。分頁、總數、資料夾子項計數及最近開啟名單都不能洩露不可見檔案。可授權的資料夾保留導航，沒有可見 `.fig` 的資料夾是否隱藏由 UI 策略決定。

### 7.3 安全開檔

禁止把使用者 query 直接拼成 filesystem path。路徑防護必須處理 `..`、雙重 encoding、absolute path、NUL、分隔符、symlink 及 check/open 競爭。

只做 `realpath()` + 字串 prefix 檢查不夠。M0 選擇系統可用的 root-confined、no-follow 開檔方式；較舊 DSM kernel 不具備某 syscall 時，選擇經測試的 descriptor-relative 替代或拒絕不安全路徑，不靜默降級。

授權、檔案身份與實際讀取對象必須一致。優先由安全 opener/broker 開出 descriptor，對該 descriptor `fstat` 並 stream，避免重新按 path 開到其他文件。

## 8. OpenPencil UI：完整介面、明確唯讀

保留 upstream 畫布、layers、pages、屬性資訊與導航；頂部加入「返回文件列表」、文件名稱、目前 NAS 來源狀態與 `唯讀` 提示。

只允許不改變設計內容的操作：選取、zoom/pan、切換頁面、檢查屬性。修改文字、移動節點、paste、drop、刪除、建立節點、undo/redo 寫入、AI command 等均由 command/capability 層阻擋。

第一版關閉 Save、Save As、遠端 outbox、雲端 storage integration、本機文件 autosave、public P2P、AI/MCP 執行入口。不能只移除 Save 按鈕而仍背景寫入。

若 upstream 沒有正式 view mode，透過最小 patch 實作能力限制，建立 graph 不變測試。若暫時只能做到「不存回 NAS、可在記憶體修改」，必須標成預覽模式，不能把它當真正唯讀驗收通過。

每次切換文件清理舊的 editor session、fetch、worker、GPU resources、object URL。登入帳號改變時不能顯示前一帳號的圖層、preview 或最近文件。

私密 `.fig` 預設只在 memory，避免新增跨帳號 IndexedDB 草稿。Service Worker 只允許靜態資產 cache；禁止 cache 私密 API response。這是本案對 upstream local-first 行為的刻意縮減，不是刪除 upstream 功能。

## 9. 大檔與縮圖策略

### 9.1 HTTP 與版本

流程：授權 metadata → 安全開啟 file → streaming bytes → OpenPencil import → render。

BFF 不讀整份檔案到 Buffer、不轉 base64 JSON；保留 backpressure，browser 取消要中止讀檔。反向代理不可意外 buffer 完整大檔才送出。

預設一份文件一次載入。HTTP Range 可以作傳輸能力，但不保證 OpenPencil 支援只載入單一頁面；不把 Range 宣稱為「不用傳完整 `.fig`」。

外部 writer 可能正透過 SMB／Drive Client 修改文件。metadata-before/after、同 descriptor 的 stat 檢查、穩定時間窗可偵測部分變動，但不能保證對原地修改的一份大檔取得原子快照。偵測變動即捨棄結果、提示重載；若要求強一致讀取，另驗證 NAS snapshot 或受控 writer 流程。

以 size/mtime/ctime 建立的 fingerprint 只作 weak revision，不冒充內容 strong ETag。`If-Range` 或跨 request resume 需有真正足夠的版本驗證，否則重新下載，避免拼接兩個版本。

### 9.2 列表、縮圖

第一版列表和搜尋可先只有文件 icon。縮圖是 M4 的非阻塞功能：由受控 worker 讀 `.fig` 的可用 preview 或 headless render，保存於獨立 cache，不修改來源、不假設每份 `.fig` 都有 thumbnail。

生成時限制 CPU/RAM／時間／併發；異常檔案顯示 fallback，不阻止其他列表。worker 不取得 Google credential，網路預設禁止。縮圖 key 包含文件 revision 與 renderer 版本；對每次 thumbnail request 仍做授權，cache filename 不能當存取權。

清除所有 index/thumbnail 都可以重建，不影響原始設計文件。不要為快取而在 NAS 原目錄寫 sidecar `.png`。

### 9.3 性能驗證目標

使用合法、具代表性的 50 MiB、200 MiB、500 MiB `.fig`，較大檔作壓力測試，不預先承諾一定支援。分開量測 raw LAN download、import、首個可操作畫面、頁面切換、GPU/RAM 峰值及多次開關後記憶體是否回收。

前端可限制同時開啟文件數，BFF 對每使用者／全域 download concurrency 設上限。列表不得因其中一份 500 MiB 文件而先抓其 bytes。

LAN 能去除 Google Drive WAN 資料路徑，但不會消除完整下載、解壓、解析、字型與 browser memory 成本。若 raw download 很快而 import 很慢，優化 upstream import/render，而不是繼續換 storage provider。

## 10. 目錄、API 與設定契約

### 10.1 Repository

```text
openpencil-synology-portal/
├── AGENTS.md
├── upstream/open-pencil/        # official pristine submodule
├── apps/portal/                 # file browser、OIDC entry、原生 editor shell
├── apps/api/                    # session、file metadata、read pipeline
├── packages/upstream-adapter/
├── packages/nas-identity/
├── packages/authorization/
├── packages/filesystem/
├── tools/nas-bridge/            # 只在 M0 判定需要時開發
├── patches/open-pencil/
├── scripts/
├── tests/{unit,integration,e2e,fixtures}/
├── docs/
├── deploy/
├── .work/                      # ignored build tree
├── .gitmodules
├── .gitlab-ci.yml
└── .env.example
```

Submodule 固定 SHA，正式 build 不跑 remote update。[S09] `prepare-upstream` 從乾淨來源產生隔離建置樹，以 `git apply --check` 驗證 patch，再接外層模組。不要在官方 submodule 建只存在本機的 commit，也不要修改 compiled JS 字串。

每次更新 upstream：update branch → pin 新 SHA → patch check → native viewer smoke → readonly graph test → `.fig` fixture render → security network test → MR。失敗維持舊版，不自動部署。

### 10.2 API（本專案設計，非 Synology API）

| Endpoint | 功能 |
|---|---|
| `GET /auth/google/start`、`GET /auth/google/callback` | OIDC |
| `POST /auth/logout` | 撤銷 session |
| `GET /api/me` | 已驗證的本人身份、mapping 狀態、Portal 能力 |
| `GET /api/roots` | 僅本人可見 roots |
| `GET /api/files?parentId=...&cursor=...` | 授權後的 `.fig` / folder 列表 |
| `GET /api/search?q=...&cursor=...` | 授權後搜尋 |
| `GET /api/files/:id` | 授權 metadata |
| `GET /api/files/:id/content` | 授權 streaming read |
| `GET /api/files/:id/thumbnail` | 授權衍生 preview |
| `GET /health/live`、`GET /health/ready` | 不含機密的健康狀態 |

第一版沒有 file PUT/PATCH/DELETE、upload、rename、move API。對原檔的變更請求全部拒絕；不要留下「隱藏但可呼叫」的路由。

### 10.3 建議設定

```yaml
mode: read-only
identity:
  provider: google-oidc
  allowedHostedDomains: [workspace-domain.example]
nas:
  instanceId: primary-nas
  identitySource: synology-bridge
  authorizationMode: dsm-strict
roots:
  - id: designs
    label: Design Library
    path: /data/designs
    extensions: [fig]
    followSymlinks: false
features:
  save: false
  publicCollaboration: false
  ai: false
  persistentDocumentCache: false
```

以上是計畫中的設定 schema，Codex 需實作 validator。未知設定、missing roots、schema 不符或 `dsm-strict` 未配置完成時 readiness 失敗，不對真實資料放行。

## 11. Docker、安全與維運

### 11.1 Volume 與權限

資料目錄 read-only，state/cache 分離。Docker 官方支援唯讀 bind mount；巢狀掛載的 read-only 行為亦受 kernel 能力影響，需在實機驗證。[S10]

概念配置，不是已可啟動的 compose：

```yaml
volumes:
  - /volume1/Designs:/data/designs:ro
  - /volume1/docker/openpencil-portal/state:/state
  - /volume1/docker/openpencil-portal/cache:/cache
```

服務以專用非 root 帳號、固定 numeric UID/GID 運作，原檔目錄只給所需讀取／traverse 能力。不為解 permission denied 而 `chmod -R 777`。RO mount 可防寫，但不提供每個 web user 的隔離；這仍由授權層負責。

rootfs 唯讀、capabilities drop、no-new-privileges、受控 tmpfs；不掛 Docker socket、宿主 `/`、`/etc/shadow` 或 NAS 整套 account DB。helper 的需要權限另外最小化，不讓 Web App 繼承。

### 11.2 外連與機密

登入所需的 Google egress 由 BFF 控制。Editor runtime 的遠端 P2P、AI、自動更新、analytics 及外部字型請求停用；WASM/worker/可合法部署的字型自架。Google profile image 可用姓名縮寫替代，避免無必要外連。

CSP、Referrer-Policy、Cookie、CORS/Origin policy 依實際 runtime 設定，禁止任意 image/file URL proxy。`.fig` 內容中的外部 URL 不得觸發無限制 backend fetch。

Session secrets 與 OAuth client secret 由部署 secrets 注入，不用 `VITE_` 前綴。Log 不含 token、身份目錄全量、文件 bytes、完整私密路徑；audit 以 principal/file opaque id、結果與時間為主。

### 11.3 維運

交付 NAS 掛載／helper／OIDC 設定、backup/restore、session revoke、directory 過期、ACL 誤差、索引重建、cache purge、proxy timeout、memory limit 與 upstream rollback 手冊。

NAS 原有 Drive／備份不由 Portal 改設定。對原目錄只有讀取；不承諾額外產生 Drive 歷史版本。SQLite metadata/state 與 cache 的備份政策分開，cache 可丟棄。

## 12. 里程碑與完成條件

| 階段 | 實作工作 | 可驗收產物 |
|---|---|---|
| **M0：能力稽核** | 固定 upstream；跑 native app；查唯讀入口；NAS 身份/ACL probe；網路設定 | UPSTREAM_AUDIT、SYNOLOGY_CAPABILITY_AUDIT、AUTHORIZATION ADR；明確 provider 選擇 |
| **M1：無外部依賴的唯讀 Portal** | Mock identities/ACL、fixtures、本機 `.fig` 列表、雙擊 native UI、RO 強制 | 不用 Google/NAS 即可完整 list→open→view；原檔無改動 |
| **M2：Google 與身份匹配** | OIDC、hd/sub 驗證、NAS directory adapter、唯一匹配、session/revoke | 測試帳號成功與未匹配/重複/停用/重建拒絕；live 與 mock 分開 |
| **M3：NAS 有效權限與安全讀檔** | 選定 native/bridge 實作、授權各 endpoint、safe opener、cross-user tests | 真實 NAS ACL matrix；無權名稱/縮圖/bytes 均不可取；這是正式上線硬門檻 |
| **M4：大檔與 UX** | streaming/cancel、檔案變動提示、索引同步、可選 thumbnail、resource cleanup | raw vs import 分段性能報告；列表不抓原檔；大檔不造成全站失效 |
| **M5：部署與試用** | Docker/CI、受保護實網 job、runbook、LAN ingress/egress 驗證 | fresh deploy 重現、NAS reboot/revoke 測試、唯讀驗收、已跑/未跑紀錄 |

M0 的 NAS 驗證不阻擋 M1 的本機開發；但 M3 未完成不可讓真實文件以寬鬆 ACL 上線。每個 milestone 必須有可運作增量，不只產出空介面。

## 13. 測試與驗收

### 13.1 每次提交的 Mock / local tests

Auth：wrong hd、email 未驗證、錯 issuer/aud、過期／重放 state、未知 Google subject。

Mapping：缺 email、重複、可自行修改 email、alias、subject 變更、NAS user 停用/重建/UID 重用。

Authorization：A 看得到而 B 看不到；猜 ID、查 HEAD、縮圖、搜尋總數、cache hit、登入切換與已撤權 session。

Filesystem：path traversal、encoded separator、symlink swap、特殊檔、`.fig` 目錄、同名檔、root 離線、index 過期、watcher overflow。

Viewer：雙擊開檔、原生 layers/pages、唯讀 shortcut、paste/drop/AI 全部不修改 graph；原檔 checksum/mtime 在測試前後不變。

Performance/safety：列表沒有 content download、取消中止 read、反覆開關回收資源、malformed/decompression-bomb `.fig` 受限失敗、無外部設計內容傳送。

### 13.2 真實環境驗收

另見 `ACL_ACCEPTANCE_MATRIX.md`。至少兩位普通使用者與一個受控測試管理者；測試使用合成資料和隔離 root，不改正式 ACL。

測試 `group allow + user deny`、巢狀 deny、不繼承、可 traverse 不可 list、共享層限制、停用／刪除、變更後 cache。比對同一使用者在 NAS 的預期結果，不以 admin 結果作基準。

測試 Google callback 的 LAN DNS/TLS、無公網 ingress、Google 暫時不可達、NAS helper 不可達、NAS/container restart、volume 未掛載。

缺 Google/NAS credentials 時標為 `not-run/blocked`；不能用 mock 成功替代 live pass。實網測試只在 protected/manual job 執行，不在不受信任 MR 放 secrets，不錄下私密 HAR/影片。

### 13.3 最終 release gate

- 唯讀 mount、API、Editor 三層皆有負向測試；原始檔案未修改。
- 同 email 自動匹配有唯一性、來源信任與 lifecycle 防護。
- `dsm-strict` 已通過目標 NAS 的 ACL matrix；provider 有明確版本相容與失效拒絕行為。
- 非授權使用者看不到名稱、縮圖、搜尋資訊與 bytes。
- 一份大 `.fig` 不拖慢全部列表；memory/取消/錯誤行為有紀錄。
- 原生 OpenPencil 顯示有 fixture 驗證；缺字型/不支援內容有提示，不假稱全格式相容。
- submodule clean、固定 SHA、patch 可重現、upstream 更新 gate 可用。
- 完成設定／維運手冊；未實測項目明列，不以「可行」代替「已通過」。

## 14. 第二階段：編輯並存回 NAS（預設不啟用）

必須先取得業主確認，再新增 write profile、write API 與原生 Editor 的可編輯能力。不能把 RO 改 RW 當功能完成。

必要設計包括：

1. 明確 NAS 寫入身份、檔案和父目錄權限、audit；Google 身份匹配仍不等於可寫。
2. Portal 中央 lease + fencing + save queue，不能用同步 `.lock` 檔充當可靠全域鎖。
3. 固定編輯 revision 的 immutable export，避免上傳期間的新修改被舊結果標為已保存。
4. 有大小／空間限制的串流寫入、同 filesystem 暫存、校驗、fsync、最終替換；crash recovery 與不明結果處理。
5. **替換新 inode 可能影響 owner、group、ACL、xattr、hardlink 及 Drive 索引／歷史。** 必須選用經驗證的 NAS 支援寫入方式或完整保留策略。不得只寫「atomic rename」便宣稱權限與版本全保留。
6. 外部 SMB／Drive Client writer 不受 Portal 租約控制。mtime 檢查不是原子 compare-and-swap；不承諾能阻止所有外部覆蓋。
7. 僅在 Portal 是受控唯一寫者或另有驗證過的 writer coordination 時宣稱單寫者保證；否則清楚揭露外部競爭限制。
8. `.fig` round-trip、實際 metadata/ACL、NAS 斷電／磁碟滿、半傳輸、同時存檔及 Drive 行為的完整測試。

Yjs 若另行採用，最新工作狀態會有新的持久化來源，必須重新定義 SSOT。不是單純替換 filesystem provider，本輪不開發。

## 15. Codex 執行契約

先閱讀 repo `AGENTS.md`、本文件及 upstream 區域規則。保留現有未提交變更，不刪掉 Google Drive 舊方案；可搬到 legacy docs，但不要把兩套 spec 混用。

建議交付命令：`bootstrap`、`prepare-upstream`、`verify-upstream`、`dev:mock`、`dev:google`、`test`、`test:e2e`、`test:nas`、`probe:nas`、`build`。這些是待實作命令，不代表目前已存在。

本輪終點是 M0–M5 的唯讀 Portal。Missing secrets 不阻止離線程式與測試；native ACL 尚未核對則標為 blocked，不以弱驗證讀取正式資料。

必須交付：

```text
docs/UPSTREAM_AUDIT.md
docs/SYNOLOGY_CAPABILITY_AUDIT.md
docs/AUTHORIZATION_ADR.md
docs/GOOGLE_SETUP.md
docs/DEPLOYMENT.md
docs/TESTING.md
docs/PERFORMANCE.md
docs/RUNBOOK.md
docs/IMPLEMENTATION_STATUS.md
```

每階段回報修改檔案、實際跑過的命令／測試、未跑原因及下一步。不假造 source symbol、NAS API、已部署環境或已通過的 ACL/效能結果。

## 16. 一手參考資料

查閱日期 2026-10-01。moving branch 只作發現入口，實作稽核必須使用固定 SHA permalink。下列資料不代表已在使用者 NAS 實測。

- **S01：OpenPencil app ownership / integration boundaries**
  `https://raw.githubusercontent.com/open-pencil/open-pencil/master/src/AGENTS.md`
- **S02：OpenPencil storage types**
  `https://raw.githubusercontent.com/open-pencil/open-pencil/master/src/app/integrations/storage/types.ts`
- **S03：OpenPencil architecture**
  `https://openpencil.dev/development/architecture`
- **S04：Synology File Station Official API**，尤其文件第 33、65 頁；已檢視頁面影像。
  `https://global.download.synology.com/download/Document/Software/DeveloperGuide/Package/FileStation/All/enu/Synology_File_Station_API_Guide.pdf`
- **S05：Synology CLI Administrator Guide**，local users/groups/share 設定；較舊文件，命令與權限須核對現場。
  `https://global.download.synology.com/download/Document/Software/DeveloperGuide/Firmware/DSM/All/enu/Synology_DiskStation_Administration_CLI_Guide.pdf`
- **S06：Google OpenID Connect**，subject、hd、claims 驗證。
  `https://developers.google.com/identity/openid-connect/openid-connect`
- **S07：Google OAuth 2.0 for Web Server Applications**，流程及 Redirect URI validation rules。
  `https://developers.google.com/identity/protocols/oauth2/web-server`
- **S08：Synology DSM specifications**，帳號、Windows ACL、advanced share permissions 等。
  `https://www.synology.com/en-us/dsm/7.3/software_spec/dsm`
- **S09：Git submodules**
  `https://git-scm.com/docs/gitsubmodules`
- **S10：Docker bind mounts**，read-only 與遞迴 mount 限制。
  `https://docs.docker.com/engine/storage/bind-mounts/`
- **S11：OpenPencil official source**，功能與 license 依固定版本核對。
  `https://github.com/open-pencil/open-pencil`
