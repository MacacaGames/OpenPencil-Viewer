# 測試與驗收

原 `ACL_ACCEPTANCE_MATRIX.md` 是規格，不能當已通過紀錄。`npm test`／adapter／browser 的 **Mock**、實機 **live**、**未測／blocked** 分別記錄在 IMPLEMENTATION_STATUS。

## 可重現的本機檢查

使用 Node 22.23.3、Bun 1.4.2、Python 3.9+。先依 README bootstrap。`/scene` 整合測試會使用建置出的 `dist/api/scene-parser.js`；乾淨 checkout 必須先執行完整 build，再跑 `npm test`，不能依賴本機殘留的 dist。以下順序也用於 GitHub／GitLab CI。

```sh
npm run verify-upstream
python3 scripts/probe-nas.py --self-test
npm run typecheck
npm run build
npm test
npm run typecheck:editor
npm run test:adapter
bunx --no-install playwright install chromium
npm run test:e2e
npm run benchmark
npm run test:nas
```

最後一項現在應 **exit 2 / BLOCKED**。它不是成功的 live runner，不接受 probe／mock 證據。真實 native provider 實作後還需建全矩陣 runner；不能只改 ready() 或移除 gate。

API tests 使用獨立臨時合成 root、mock principals 和 root-scoped ACL：A/B 列表／search total、猜 ID、metadata／thumbnail／GET+HEAD、read、write route 拒絕、來源 hash/mtime、不跨權限快取、directory/identity lifecycle、來源離線／root replacement。SQLite 重啟保留 metadata 與原 baseline；新空 root 不表示 zero files。HTTP cancellation test 實際啟動 localhost ephemeral server，取消大串流後下一份文件必須可下載，證明全域／principal slot 釋放。

Filesystem tests 拒絕 traversal／encoding／symlink／hardlink／特殊來源，取消未消耗的 reader 釋放 abort listener，來源索引後變更或串流中增長拒絕、bytes 不超過 indexed size。Linux mount-id/O_PATH／proc pinned read 與 nested mount、FIFO 等負向測試已在 arm64 和 emulated amd64 Desktop container 通過；DSM 尚未測，Desktop 不代表 DSM 安全語意。

OIDC tests 用本機 RSA 簽署 JWT + JOSE 驗證 signature／issuer／audience／expiry／nonce／email_verified／hd，trusted unique email、expired snapshot、new subject、NAS lifecycle/instance、once-only state/browser proof、session max/idle expiry 與 admin revoke。這些不是 Google live login。另有操作員完成的真實正向 Google 驗證，見 IMPLEMENTATION_STATUS audit 時間；NAS mapping／session 未建立，真實負向案例未測。

Adapter test 在 `.work/editor` 以實際 patched Core、SceneGraph 及 Vue commands 執行：default-deny mutators／direct command.run／nested node arrays／pre-lock references；selection、zoom、page navigation 可用。Native selected-node inspector 用獨立 clone，不能修改 locked graph。實際 Vue variables panel 在鎖定後仍能讀取集合／數值與刷新；nested variable／mode 修改及 mutators 均無效。

同一命令也跑 renderer／surface regressions：並發 CanvasKit 初始化與失敗重試、native image LRU／mipmap 成本／一次性釋放、preview 串行與去重／原圖保留／encoded cache／dispose、font 通知合併與禁止同步重入、零尺寸與同尺寸 surface 保留、full-resolution render 的 finally 還原。Mocks 以獨立 Bun process 執行，避免影響真實唯讀 graph 測試。

`tests/e2e/renderer.spec.ts` 用 129 個合成圖片資源觸發 viewport previews，先確認實際紅色像素與 worker 啟動，再對 FIT／TILE、resize、換頁、重開比對已保存的 canvas snapshot。調整像素行為時先用 `npm run test:e2e -- tests/e2e/renderer.spec.ts --update-snapshots` 更新並視覺檢查，再移除該旗標重跑。這不代表真實大型文件的 GPU／記憶體或保真驗收。

Playwright E2E 使用獨立 port 3212、`.work/e2e-*`，一個 Chromium worker：首頁不取任何 content；A/B 名稱不同；double click 只載一份文件；保留兩頁導航、layers 選取與 native properties Design/Code；code readonly／AI 不顯示。Ctrl/Cmd+S、paste/drop、delete、draw tool、drag 後重新選取，比較 canvas pixels，hash/mtime 不變；無外部 HTTP/WS、document IndexedDB／SW、換帳號舊 canvas。Trace/video 預設 off；`.work/portal-native.png` 只有合成設計。

FIG safety tests 包括合法合成 FIG、archive bomb／malformed nested/schema／truncated payload；workers 有 abort/timeout，拒絕無 worker 的 main-thread fallback。大檔實際 parse/layout/GPU 資源仍需 live 代表性測試；輸入限制不等於所有 parser 漏洞已排除。

Opt-in 真實 fixtures：`REAL_FIG_FIXTURE_ROOT=/absolute/approved/test_files npm run test:e2e`。只讀明確批准的 regular single-link FIG，最多十份／每份512 MiB；local Mock UI routes 替換 metadata／bytes，短暫 loopback stream，不代表 NAS 授權。各自 browser context，檢查 native canvas/pages/layers、readonly controls、無外連／runtime error、原始 hash／mtime不變；real-file screenshot/trace/video disabled。現在三份（最大391 MiB）已通過；report 見 PERFORMANCE。未設定 env 時跳過 real fixtures，CI 只跑 synthetic acceptance。

## Live 與 CI

GitLab `verify_mock` 固定 runtime，frozen install、upstream clean、probe self-test、API/types/build/native graph/browser。`image_synthetic` 只在 protected branch 手動由 Docker build runner 執行，沒有掛 NAS。`nas_live_gate` protected/manual 明確 blocked，不會 SSH／變更帳號／ACL／部署。CI 定義尚未在 GitLab 真實 runner 跑過。

GitHub `.github/workflows/ghcr.yml` 採公司 ApeRelay 入口：main/master/v*、PR/manual；驗證後各平台 image synthetic RO 測試，再推 GHCR／合成多平台 manifest。PR 不 push、沒有自動部署或 NAS mounts，沒有 package visibility 更動。操作員提供的 runner 紀錄中 upstream／NAS synthetic 檢查通過，但建置前的兩個 `/scene` 測試失敗；已修正建置順序並分開步驟，修正版 GitHub runner／GHCR 結果仍待重新執行。

現場先獲得授權的測試 NAS root 與 A/B 普通帳號。依 NAS_PROBE 記 DSM/kernel/directory/email 管理政策、Windows ACL/群組deny/advanced share、same-user File Station/SMB baseline；逐項記 I01–I12、A01–A15、R01–R10 的 timestamp、Portal/API/UI 及 redacted native 證據。不能以 admin File Station session 或 service UID filesystem readability 作對照。

Docker R02、proxy/LAN ingress/egress、source mount offline/reboot、Google policy/TLS/callback、代表性大檔及跨身份持久資料，未測前都是 release blocker。來源 ACL 變動後每個新請求重新驗證；已取得 bytes 無法收回、開啟中的串流不宣稱即時撤銷。
