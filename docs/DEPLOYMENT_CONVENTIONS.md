# 公司部署慣例對照

參考 [macacagames/aperelay](https://github.com/macacagames/aperelay)，唯讀 clone 於 `.work/references/aperelay`，核對 commit **fba03f4869d802fcc54d5b378dd58d5c4d3d0b0f**。沒有更動參考 repository 或 sibling 專案。

已閱讀該 commit 的 [README](https://github.com/macacagames/aperelay/blob/fba03f4869d802fcc54d5b378dd58d5c4d3d0b0f/README.md)、[QUICK_START](https://github.com/macacagames/aperelay/blob/fba03f4869d802fcc54d5b378dd58d5c4d3d0b0f/QUICK_START.md)、[GHCR workflow](https://github.com/macacagames/aperelay/blob/fba03f4869d802fcc54d5b378dd58d5c4d3d0b0f/.github/workflows/ghcr.yml)、Dockerfile、docker-compose.yml、.env.example。

| ApeRelay 操作方式 | Portal 的實作 |
|---|---|
| `.env.example` → `.env` | 非秘密 host 路徑／origin／Workspace domain；Google Web client JSON 獨立 RO mount |
| 根目錄 `docker-compose.yml` | extends 已稽核的 Synology service；`docker compose up -d` 可直接使用 |
| GitHub Actions → GHCR | main／master／v*／manual；PR 不 push；同一一般映像包含 raster + Selkies/Chromium，先整合測試及兩平台原生 synthetic RO／實際H.264，再發布已測 image／multi-platform manifest |
| 固定版本 tag | 同樣提供 branch／version／SHA／latest tags，部署記錄 manifest digest；保留舊 digest 回滾 |
| data volume 與設定外置 | `/state` 專用本機 SQLite RW、三份 JSON RO、指定 `.fig` root RO；原始設計不入映像／state |
| Quick Start | 根目錄 QUICK_START.md，列出環境變數、mount、檢查、更新與手動資訊 |
| package 可讀性 | 管理員設定 public／private read 權限；不自動改 visibility，不要求管理 PAT |
| 健康檢查 | live 與 ready 分開；NAS native gate 不通 ready503，不能把成功發布映像当 ACL 驗收 |

Portal 的 source、patch 和固定 upstream SHA 維持原有邊界。沒有套用 ApeRelay 的 unrestricted port、root runtime、缺少 state mount 等配置。沒有將其 Unraid 路徑當作 Synology 授權方案。

此次完整功能 workflow 修改仍待 GitHub runner／GHCR 實跑，沒有代操作員設定 package visibility。兩平台各使用原生 `ubuntu-24.04`／`ubuntu-24.04-arm`，避免把 QEMU Chromium sandbox 結果當原生驗收。既有 GitLab CI 保留，兩者都不能代替 live NAS matrix。已測 tar bundles 仍可供離線匯入，但使用一般 registry tag 不再需要另一份功能映像。

使用者已指定本機 Git remote `git@github.com:MacacaGames/OpenPencil-Viewer.git`；workflow 從 repository 自動取得小寫映像名稱 `ghcr.io/macacagames/openpencil-viewer`。本機提交準備完成後由使用者手動 push；沒有代替使用者推送。
