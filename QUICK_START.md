# OpenPencil Portal — Docker / Synology Quick Start

部署入口沿用公司 [ApeRelay](https://github.com/macacagames/aperelay) 的習慣：固定版本映像、`.env`、Docker Compose、外部設定與獨立持久化 volume。現在可部署**隔離測試**；NAS native provider 尚待實作／ACL 驗收，正式文件仍拒絕存取。

## 1. 取得映像

目前已有測過的 arm64／amd64 `image.tar`，依 [OPERATOR_HANDOFF](docs/OPERATOR_HANDOFF.md) 檢查 SHA256SUMS 並 `docker image load --input image.tar`，將 manifest.json 的 imageId 設為 `PORTAL_IMAGE`。

GitHub repository 已指定為 [MacacaGames/OpenPencil-Viewer](https://github.com/MacacaGames/OpenPencil-Viewer)，本機 `origin` 使用 `git@github.com:MacacaGames/OpenPencil-Viewer.git`。GitHub Actions 已準備好：main／master／版本 tag 會在整合與兩平台 synthetic RO 測試通過後發布 `ghcr.io/macacagames/openpencil-viewer`；PR 只建置與測試。**這個專案尚未推送 GitHub、執行 Actions 或發布 GHCR**。正式啟用還需 live NAS gate，CI 不代替 ACL。

未來 registry 部署使用 Actions 發布的 manifest digest；它自動選擇 arm64／amd64：

```sh
export PORTAL_IMAGE='ghcr.io/macacagames/openpencil-viewer@sha256:replace-with-verified-manifest-digest'
docker pull "$PORTAL_IMAGE"
```

tag 方便選版本；digest 固定實際內容，更新／回滾都保留上一個測過的 digest。私有 package 由操作員在 Docker host 登入有 `read:packages` 權限的帳號；token 不放 `.env`、OAuth JSON 或容器內。

## 2. 準備設定與 state

在 Docker host 建立**新的專用部署目錄**，把公用範本複製成自己管理的 JSON。Google Web OAuth JSON 另外存放，不要貼 secret 或 commit。

| Host 設定 | 容器位置 | 掛載 |
|---|---|---|
| `PORTAL_CONFIG_JSON` | `/config/config.json` | 單一檔案 RO |
| `PORTAL_DIRECTORY_JSON` | `/config/directory.json` | 單一檔案 RO；範本到期且沒有身份 |
| `GOOGLE_OAUTH_JSON` | `/run/secrets/google-oauth.json` | 單一秘密檔案 RO |
| `NAS_TEST_ROOT` | `/data/designs` | 已批准的隔離測試子目錄 RO |
| `PORTAL_STATE_DIR` | `/state` | 專用本機 state 目錄 RW |

`/state` 只保存 session／mapping／metadata／audit。SQLite 不放 SMB/NFS；原始 `.fig` 不放 state。logs 使用 Docker 的限額輪替，不需掛 `/app/logs`。

Web 固定 UID/GID 10001；新的 state 目錄由操作員建立為該 UID/GID、權限 0700。JSON 必須能由容器讀取，host 私密父目錄採 0700；只掛單一檔案，不掛整個秘密目錄。不要更改 NAS 帳號／ACL 或遞迴 chmod。詳細 named-volume 初始化例子在 OPERATOR_HANDOFF。

```sh
cp .env.example .env
```

`.env` 只填非秘密路徑與設定：

```dotenv
PORTAL_IMAGE=sha256:replace-with-loaded-tested-image-id
PORTAL_ORIGIN=https://openpencil.macaca.games
GOOGLE_HOSTED_DOMAINS=macaca.games
GOOGLE_OAUTH_JSON=/absolute/private/google-web-oauth.json
PORTAL_CONFIG_JSON=/absolute/private/config.json
PORTAL_DIRECTORY_JSON=/absolute/private/directory.json
NAS_TEST_ROOT=/absolute/approved/isolated-test-root
PORTAL_STATE_DIR=/absolute/local/portal-state
PORTAL_BIND_ADDRESS=127.0.0.1
PORTAL_HOST_PORT=3210
```

設定範本在 `deploy/config.example.json`、`deploy/directory.example.json`。Google Cloud Web application 的 callback 必須精確是 `https://openpencil.macaca.games/auth/google/callback`。Google JSON、Portal config、directory 是三份不同檔案。

你的現有 nginx upstream 為 `http://10.0.1.31:24681`；**本機 staging** 使用 `PORTAL_BIND_ADDRESS=10.0.1.31`、`PORTAL_HOST_PORT=24681`。同 NAS proxy 預設 loopback 3210；proxy 在另一台時只綁指定 LAN interface 並限制來源。HTTPS 入口需要 LAN／VPN 限制；不要使用 `0.0.0.0` 自動公開。

## 3. 啟動與檢查

根目錄 `docker-compose.yml` 重用 `deploy/compose.synology.yml`，兩份檔案都要帶到部署目錄。使用預建映像，不在 NAS 編譯 OpenPencil。

```sh
docker compose config --quiet
docker compose up -d
docker compose logs --tail 100 portal
docker compose exec portal node dist/api/check-config.js
```

現在 config check 應是 `configuration=valid`、`releaseReady=false`、**exit 2**。`/health/live` 為 200；`/health/ready` 為 503、Docker unhealthy 表示 NAS 授權 gate 未通過。啟動畫面不是正式 ACL 驗收。

Google 真實正常登入已測過；目前 callback 的 `directory-unavailable` 是 NAS 身份來源未就緒的預期結果，沒有 Portal session 或文件授權。不要手填寬鬆 directory／切成 mock 來開正式文件。

## 4. GitHub / GHCR 操作員準備

1. 本機 Git 已準備為 `main`，含 gitlink／lock／patch／workflow；OAuth JSON、實際 `.env`、state 與操作員提供的 fixtures 均不納入。`tests/fixtures/basic.fig` 是本專案可重建的合成測試檔。由你在 repository 根目錄手動執行：

   ```sh
   git push -u origin main
   ```

   這會觸發驗證與 GHCR 發布 workflow；不會部署到 NAS。registry 尚無已驗證 digest，需等 workflow 成功後填入。
2. 啟用 Actions，允許 workflow 的 `GITHUB_TOKEN` 寫入該 repository 的 Packages。無需將 Google secret 或 NAS credentials 加入 Actions。
3. main／master 或 `v*` tag 觸發驗證與發布；確認 verify、兩平台 image、manifest 全部通過。首次 workflow 尚未實跑，失敗需保留紀錄再修正。
4. GHCR package 的可見性與讀取權限由管理員設定。workflow 不自動改為 public，也不需要 `GHCR_ADMIN_TOKEN`；NAS 只需要能 pull 映像。
5. 記錄 manifest digest、來源 commit、upstream SHA 和測試紀錄。registry 映像不包含 Google JSON、NAS `.fig` 或 SQLite；這些在 Docker host 各自提供。

## 5. 更新／回滾

記錄舊 digest，停止單實例 Portal 並一致備份整個 state（含 WAL/SHM），修改 `.env` 的 `PORTAL_IMAGE`，再 pull／重建。從 tar 匯入則以新 imageId 替換；三份 JSON 和 state 路徑保持由操作員管理。

```sh
docker compose stop portal
# 操作員在 host 上一致備份自己的專用 state。
docker compose pull portal
docker compose up -d --no-deps portal
```

更新後核對 config、live／ready、Google、唯讀與適用 live ACL 驗收。回滾用舊 digest 與相容的 config／state schema；不刪 state、不改來源 RO。不能用回滾繞過 strict gate。

## 6. 上 NAS 還需要提供

你已提供 Docker、測試檔、HTTPS 網址、Workspace domain、OAuth JSON。到 NAS 時，請依 [NAS_PROBE](docs/NAS_PROBE.md) 手動跑唯讀 probe，提供去識別化結果、型號／DSM／Container Manager／架構、帳號來源與 email 是否可自改，以及測試身份 A/B 各自的 File Station／SMB 基準。不要提供密碼、token 或帳號資料庫。

這些證據用來實作並驗證 native identity／effective ACL bridge；完成 [ACL 矩陣](ACL_ACCEPTANCE_MATRIX.md) 前維持 fail closed。Unraid 遠端 NAS profile 仍 blocked，沒有沿用 service UID 當使用者權限。
