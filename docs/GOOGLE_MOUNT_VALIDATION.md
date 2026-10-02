# Google 登入後共用瀏覽驗證

操作員於2026-10-03 明確要求先略過 NAS 身份對應／權限分流，只要合法 Google 登入即可瀏覽掛載來源並驗證開啟 .fig。新增明確設定 `authorizationMode: google-mount`；原有 dsm-strict 不會自動降級。

這個模式接受設定內 allowedHostedDomains 的 Google Workspace 身份（目前 macaca.games），仍檢查 Google RS256 簽章、issuer、audience、expiry、nonce、email_verified、hd 與 OAuth state／PKCE。不是任意 Gmail、匿名或 Mock 登入。每位合法登入者可瀏覽全部設定 roots 的資料夾與合格 .fig；沒有 DSM 個別權限或 NAS 帳號綁定。UID10001 仍須能讀取掛載來源，無法繞過容器本身的 EACCES。

內容沿用原來的唯讀來源／安全開檔、regular／single-link／symlink／mount confinement、大小與 revision、取消／並行上限，以及 native UI／圖形不可變／不保存文件／不做外部文件請求。只支援索引內的 .fig；不提供其他副檔名的通用下載或完整檔案管理。

## Synology 手動切換

1. 使用新建的 **linux/amd64** 驗證映像 `openpencil-viewer:google-mount-validation`。舊 GHCR `sha-8856943` 不識別新模式，單改環境變數不會更新程式。若採離線匯入，先解壓驗證 ZIP；在解壓資料夾執行 `gunzip -c image.tar.gz > image.tar`，再在 Container Manager → 映像 → 新增 → 從檔案新增選 image.tar；檢查匯入後 repository/tag 與上述一致。
2. 將 [config.google-mount.example.json](../deploy/config.google-mount.example.json) 另存為 NAS `/volume1/Manager/DockerCompose/Openpencil/config.google-mount.json`，確保容器 UID10001 可讀。它使用獨立 `/state/google-mount.sqlite`，不混用原 NAS bindings。保留原 config.json 供回復。
3. 使用 [compose.google-mount.synology.example.yml](../deploy/compose.google-mount.synology.example.yml)，其來源／port／domain 已採操作員提供的值。它不需要 directory.json、NAS bridge 或 root helper，來源與 rootfs 保持 read_only，Web 為10001:10001。
4. 由操作員更新既有 Container Manager 專案以採用新 Compose／映像。既有反向代理與 Google callback `https://openpencil.macaca.games/auth/google/callback` 沿用。沒有由 agent 操作 NAS、修改帳號／ACL 或部署。
5. 查看 logs 應為 `Portal google-oidc/google-mount: https://openpencil.macaca.games`；`/health/ready` 應為 ready:true、authorization:google-mount、nasAclEnforced:false。健康檢查不是 Google 實際登入／FIG 成功的證據。
6. 以 macaca.games 的 Google 帳號登入，確認資料夾瀏覽、雙擊 .fig、Pages／Layers、切頁／選取、唯讀與登出。介面標示「共用瀏覽驗證 · 不套用 DSM 個別權限」。若已有舊 cookie，重新登入；跨模式 session 拒絕，不沿用 NAS 授權。

如只修改既有 config 而不採用新範例，也可在**新映像**加入 `PORTAL_AUTHORIZATION_MODE: google-mount`，但建議使用獨立 statePath。此 env 是明確模式選擇，未知值拒絕啟動；橋接設定與該模式互斥。`directoryPath` 可省略且不讀 directory.json。

`config:check` 在 google-mount 設定有效時 exit0，輸出 sharedBrowseValidation:true；releaseReady 仍 false，因為這不是 DSM ACL 正式驗收。切回原映像/config 可回到 dsm-strict；共用模式不會被視為原生 ACL acceptance。

## 本機證據與尚未執行

Integration tests 使用 loopback 開發環境的合成 RS256 keys／token exchange；生產 config 與 LAN 綁定拒絕注入 test keys，映像不包含 test server。Browser tests 走相同 callback、session、列表、唯讀 native UI，但不是實際 Google／NAS acceptance。實際命令、結果與 image ID 見 IMPLEMENTATION_STATUS；NAS 的來源可讀性、Google 登入與真實 .fig 載入仍由操作員實機確認。
