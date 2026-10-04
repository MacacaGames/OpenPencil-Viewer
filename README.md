# OpenPencil × Synology LAN Portal

raster／一般 native viewer 是唯讀；Unraid Selkies 另支援操作員授權的會話編輯（修改不儲存）。原始 `.fig` 保留在 NAS；Google 僅做 OIDC 登入。完整原生 OpenPencil UI 位於乾淨、固定 SHA 的官方 submodule，Portal 的 patch 僅套入 `.work/editor`。

**目前可用：本機 Mock A/B → 不同列表 → 雙擊 → 原生 canvas/pages/layers/properties 唯讀檢視，以及已測 arm64／amd64 Docker 映像、HTTPS staging 與真實 Google 正常登入驗證。正式 NAS 尚不可用：dsm-strict native provider 待實作與實機 ACL 驗證，現在 fail closed。** 原檔 RO／Linux confinement／大 FIG headless 格式解析已測；三份真實 FIG 的原生瀏覽器載入已測；NAS、GPU 記憶體與視覺 fidelity 驗收仍待進行。詳見 [實作狀態](docs/IMPLEMENTATION_STATUS.md) 與 [手動部署清單](docs/OPERATOR_HANDOFF.md)。

需要 Git、Node **22.23.3**、Bun **1.4.2**、Python 3.9+。不要在正式 NAS 上執行 Mock 或測試 fixture 腳本。

Docker 操作員先看 [QUICK_START](QUICK_START.md)：已依公司 [ApeRelay](https://github.com/macacagames/aperelay) 加入根目錄 Compose、`.env`、GitHub Actions／GHCR 兩平台發布流程。已有 tar 映像及舊 GHCR 版本；此次完整功能映像的 workflow 修改仍待 GitHub 實跑與發布。詳見 [部署慣例對照](docs/DEPLOYMENT_CONVENTIONS.md)。

Unraid 遠端方案請看 [Selkies 部署與換卡手冊](docs/UNRAID_SELKIES.zh-TW.md)：一般 CI 映像包含固定 Selkies／Chromium，原生 UI 留在伺服器，瀏覽器只接收已授權 H.264 串流。使用一般 `latest`／`sha-*`／版本標籤，由 `viewerMode` 選 raster 或 Selkies，無需另選功能標籤。Selkies 範例使用 `mode: "session-edit"` 開放物件／屬性／頁面編輯，修改只存在伺服器會話記憶體；NAS mount 可 RO／RW，沒有儲存／匯出／NAS 寫回，reload／logout 清除修改。兩平台 image job 在原生 runner 上驗證 raster 和實際 CPU 串流、UID10001／99、resize／隔離／清理，再 push 已測映像；此次 workflow 修改仍待 GitHub 實跑。提供獨立 Compose、PCI 裝置選擇、VA-API／CPU 診斷與可選離線匯出；Unraid／R7 250／NAS 掛載及真實效能仍需操作員手動驗收。原 raster 部署保留，`dsm-strict` 未因此取得原生 ACL 驗收。

```sh
git submodule update --init --recursive
bun install --frozen-lockfile
npm run bootstrap
npm run build
npm run dev:mock
```

開啟 `http://127.0.0.1:3210`，選 Mock 身份 A 或 B。合成檔案及 SQLite 位於 `.work/`。Mock 僅接受 loopback development 設定，不提供 LAN 共用模式。

```sh
npm test
npm run typecheck
npm run typecheck:editor
npm run test:adapter
bunx --no-install playwright install chromium
npm run test:e2e
python3 scripts/probe-nas.py --self-test
npm run verify-upstream
npm run benchmark
npm run test:nas  # 現在應 exit 2 / BLOCKED；不能用 Mock 取代
```

讀取 [原生整合稽核](docs/UPSTREAM_AUDIT.md)、[NAS probe 手冊](docs/NAS_PROBE.md)、[Google 設定](docs/GOOGLE_SETUP.md)、[部署](docs/DEPLOYMENT.md)、[測試](docs/TESTING.md)、[效能](docs/PERFORMANCE.md)、[維運](docs/RUNBOOK.md)。原交接 [開發計畫](DEVELOPMENT_PLAN.md) 及 [ACL 驗收矩陣](ACL_ACCEPTANCE_MATRIX.md) 保留原位；相鄰 Google Drive 專案未更動。

不提供 Drive scope、NAS password 登入、寫入 API、Save/outbox、公共 P2P、AI/MCP 或編輯存回。唯讀不是 DRM；瀏覽器取得可顯示的 bytes，無法追回已讀內容。新 Google 登入仍需外網。
