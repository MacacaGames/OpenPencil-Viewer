# 部署時要準備什麼

部署網址：**https://openpencil.macaca.games**。Google Web OAuth JSON 已提供，檔案包含正確 callback。secret 僅由 BFF 讀取；Git、Docker context、映像與交付包都排除這份 JSON。

目前可以建置／啟動隔離測試容器。正式文件仍由 `dsm-strict` 拒絕，直到 NAS native provider 與 live ACL matrix 通過。`/health/live` 的 200 表示程式運行，`/health/ready` 現在應為 **503**；Docker health 顯示 unhealthy 是尚未通過授權 gate 的預期結果。

## 你需要提供的資料

| 項目 | 怎麼提供 | 目前情況 |
|---|---|---|
| Docker | 安裝並啟動 Docker Desktop | 已提供；arm64／amd64 容器驗證通過 |
| Web OAuth JSON | 從 Google Cloud 的 Web application client 下載，手動掛單一檔案；不要貼 secret | 已提供且 callback 格式通過 |
| Portal 網址 | `-e PORTAL_ORIGIN=https://openpencil.macaca.games`，沒有結尾 `/` | 已決定 |
| Workspace 網域 | `-e GOOGLE_HOSTED_DOMAINS=macaca.games`；多個用逗號分隔 | 已由你確認 `macaca.games` |
| NAS 環境 | 上 NAS 時提供型號、DSM／Container Manager 版本、CPU 架構、本機／AD／LDAP 帳號來源 | 延後至 NAS 驗收 |
| 指定來源子目錄 | `--mount type=bind,src=完整測試路徑,dst=/data/designs,readonly` | 本機已授權 test_files；NAS 先用隔離 root |
| NAS 身份與 ACL 證據 | 手動跑 NAS_PROBE，提供去識別化 JSON、可信 email 來源與 A/B 的同使用者基準 | NAS 上測，不以本機 Mock 代替 |
| LAN DNS／TLS | 內部 DNS 指至 NAS／代理私有 IP，配置員工信任的憑證與 LAN allowlist | 你的 HTTPS nginx 已驗通；正式 LAN／VPN 限制仍需部署驗收 |

Docker 的 `-m` 是記憶體限制；掛載用 `--mount` 或 `-v`。本專案例子統一用 `--mount ... readonly`，避免不存在的路徑被自動建成空目錄。

Synology Container Manager 的 Project 編輯器可使用獨立範本 [compose.synology.ui.example.yml](../deploy/compose.synology.ui.example.yml)，不需要 extends 或 `.env`。替換 image 的 placeholder 為 CI 成功後的 GHCR manifest digest，或把整個 image 值改成已匯入且符合 NAS 架構的本機 imageId。範例 host paths 位於 `/volume1/docker/openpencil-viewer`：private/config.json、private/directory.json、private/google-oauth.json、test_files、state，啟動前必須存在。config 與 directory 先用公用範本；Google JSON 手動複製，不能放進 Git。新的專用 state 目錄由 UID/GID 10001 擁有、mode0700；private 父目錄0700，只掛 UID10001 可讀的單一 JSON。測試 root 保持 RO。

此獨立範本預設 `127.0.0.1:24681:3000`，適用同 NAS 的反向代理。若現有 nginx 在另一台主機，改成 NAS 的指定私有 IP，限制 proxy 來源並更新 nginx upstream；不能假定目前 Mac 的 `10.0.1.31` 就是 NAS IP。domain／hd 已填入你的設定。Container Manager 專案檔本身不會設定 Google client、NAS 帳號／ACL 或執行實機驗收。

## 準備 JSON 與網域

`deploy/config.example.json` 是 Portal 設定；Google 下載的 OAuth JSON 是**另一份檔案**，格式必須含 `web.client_id`、`web.client_secret` 及精確 `web.redirect_uris`。Service account 或 installed-app JSON 不適用。程式忽略 JSON 內的 endpoint 欄位，固定使用 Google OIDC endpoints。

Google Cloud 的 Web client 應有 Authorized redirect URI：

```text
https://openpencil.macaca.games/auth/google/callback
```

Workspace `hd` 已確認為 `macaca.games`。只要求 `openid email profile`；不需要 Drive、Directory、offline access 或 Secure LDAP。你已完成真實 Google 正常登入，後端有去識別化 `oidc-verified` 證據；NAS mapping／session 和真實負向案例尚未完成。

秘密檔放在 repository 外的私有父目錄（0700），只掛**單一檔案**。容器以 UID/GID 10001 運行，必須能讀 mounted file；可用 host 私有父目錄限制其他使用者，再讓單一被掛檔案可讀。不要把整個私有目錄、NAS volume、Docker socket 或帳號／密碼資料庫掛入。

Portal config 與 directory snapshot 由管理員控制；config 不保存 secret。`directory.example.json` 刻意過期且無 principals，請勿自行填成寬鬆 NAS 授權。NAS snapshot／native provider 是下一個實機里程碑的工作。

## Synology 啟動時出現 PORTAL_CONFIG 錯誤

`PORTAL_CONFIG must be a bounded regular JSON file` 表示設定檔讀取／JSON 解析失敗，發生在 Google 登入與 DSM 授權之前。舊映像把路徑不存在、目錄、symlink、權限不足、超過 262,144 bytes、JSON 語法錯誤與非 object 都顯示成這一則訊息；新建置會指出失敗類型，不輸出檔案內容、secret 或私密路徑。反覆出現相同堆疊是 `restart: unless-stopped` 重啟失敗程式。

在 Container Manager 先停止這個 Project，再用 File Station 核對部署檔案。獨立 Synology 範本的對應如下；若你改過 source，使用自己的實際 NAS 路徑：

```yaml
environment:
  PORTAL_CONFIG: /config/config.json
volumes:
  - type: bind
    source: /volume1/docker/openpencil-viewer/private/config.json
    target: /config/config.json
    read_only: true
    bind: { create_host_path: false }
```

`source` 是 NAS 上已存在的**檔案**，`PORTAL_CONFIG` 是容器內的 `target`，不能填 NAS host 路徑。映像不附操作員 config.json，也不會自動產生這三份部署 JSON。請將 [config.example.json](../deploy/config.example.json) 下載／複製到 File Station 的 `private` 目錄並命名為 `config.json`；directory 使用另一份 [directory.example.json](../deploy/directory.example.json)，Google OAuth JSON 也另放。不要把 Compose YAML 或 Google JSON 當 Portal config。

若 `config.json` 實際是目錄，先核對內容並更名保留，再放入真正的檔案。[Docker 的短格式 `-v` 掛載](https://docs.docker.com/engine/storage/bind-mounts/)會將不存在的來源建成目錄；長格式與 `create_host_path: false` 可避免自動建立。只確認副檔名不夠。

檔案必須是 UTF-8 JSON object（第一個非空白字元為 `{`）、不超過 256 KiB，且容器 UID10001 可讀。使用管理員控制的專用部署檔案；不要更改 NAS 原始文件 ACL、放寬整個 private 目錄或改成 root。JSON 語法合法仍需通過 Portal schema；公用 config 範本已具備 Google／HTTPS／dsm-strict 的結構。

操作員若已有 Docker host 終端，可使用 [一次性 Compose run](https://docs.docker.com/reference/cli/docker/compose/run/) 檢查，不依賴正在反覆重啟的容器，也不啟動 Web port 或寫 state：

```sh
# 在你的部署目錄執行；獨立範本若命名為 compose.yml，使用 -f compose.yml。
docker compose run --rm --no-deps --entrypoint node portal dist/api/check-config.js
```

只使用 Container Manager UI 時，可暫時將該 Project 的 `portal` service 改成以下兩個欄位，重新建立測試容器後看 logs：

```yaml
restart: 'no'
command: ['node', 'dist/api/check-config.js']
```

若目前映像仍只回報舊的通用錯誤，可改用下列 `command` 先確認 UID10001 的檔案讀取權限。它只輸出 metadata 與錯誤代碼，不輸出 JSON／OAuth 內容：

```yaml
restart: 'no'
command:
  - node
  - -e
  - |
    const fs = require('node:fs');
    try {
      const p = process.env.PORTAL_CONFIG;
      const s = fs.lstatSync(p);
      fs.accessSync(p, fs.constants.R_OK);
      console.log({uid: process.getuid(), regularFile: s.isFile(), bytes: s.size, readable: true});
    } catch (e) {
      console.error({uid: process.getuid(), code: e.code || 'CHECK_FAILED'});
      process.exitCode = 1;
    }
```

`EACCES`／`EPERM` 表示該容器使用者的檔案／父路徑讀取權限不足；`ENOENT`／`ENOTDIR` 表示容器路徑不存在或掛載不符；`regularFile: false` 表示掛載不是 regular file。若 regularFile/readable 都是 true 且 bytes 不超標，再檢查 JSON 語法與 object 格式。

執行 `dist/api/check-config.js` 時，成功檢查會輸出 `configuration: valid`、`releaseReady: false` 並 **exit 2**；這是 strict 尚未通過 NAS 驗收的預期結果。設定錯誤為 exit 1。完成後移除暫時的 `command`，恢復 `restart: unless-stopped`，重新建立該隔離測試 Project。正常啟動後 `/health/live` 應為 200、`/health/ready` 仍為 503。修復這個設定檔錯誤不會啟用 NAS 身份或 ACL provider。

## 先啟動隔離測試容器

以下在 **Docker host** 上手動執行。把四個絕對路徑與 Workspace domain 換成自己的值；來源必須是已批准的測試子目錄。`PORTAL_IMAGE` 使用交付 manifest 的 image ID／已測 registry digest。

```sh
export PORTAL_IMAGE='sha256:替換為交付映像ID'
export PORTAL_CONFIG_JSON='/absolute/private/config.json'
export PORTAL_DIRECTORY_JSON='/absolute/private/directory.json'
export GOOGLE_OAUTH_JSON='/absolute/private/google-web-oauth.json'
export NAS_TEST_ROOT='/absolute/isolated/test-root'
export GOOGLE_HOSTED_DOMAINS='macaca.games'

docker volume create openpencil-lan-test-state
# 僅初始化新的專用 state volume；不改來源目錄或 NAS 帳號／ACL。
docker run --rm --read-only --network none --user 0:0 \
  --mount type=volume,src=openpencil-lan-test-state,dst=/state \
  --entrypoint chown "$PORTAL_IMAGE" 10001:10001 /state

docker run -d --name openpencil-lan-test --init \
  --read-only --user 10001:10001 --cap-drop ALL \
  --security-opt no-new-privileges --pids-limit 128 \
  --memory 4g --cpus 2 --tmpfs /tmp:rw,noexec,nosuid,nodev,size=64m \
  -p 127.0.0.1:3210:3000 \
  --mount "type=bind,src=$PORTAL_CONFIG_JSON,dst=/config/config.json,readonly" \
  --mount "type=bind,src=$PORTAL_DIRECTORY_JSON,dst=/config/directory.json,readonly" \
  --mount "type=bind,src=$GOOGLE_OAUTH_JSON,dst=/run/secrets/google-oauth.json,readonly" \
  --mount "type=bind,src=$NAS_TEST_ROOT,dst=/data/designs,readonly" \
  --mount type=volume,src=openpencil-lan-test-state,dst=/state \
  -e PORTAL_CONFIG=/config/config.json \
  -e GOOGLE_OAUTH_FILE=/run/secrets/google-oauth.json \
  -e PORTAL_ORIGIN=https://openpencil.macaca.games \
  -e GOOGLE_HOSTED_DOMAINS "$PORTAL_IMAGE"

docker exec openpencil-lan-test node dist/api/check-config.js
# 現在預期 configuration=valid、releaseReady=false、exit 2。
curl --fail http://127.0.0.1:3210/health/live
curl -i http://127.0.0.1:3210/health/ready
```

若讀不到 secret，修正**專用部署檔案**的可讀性；不要使用 privileged、改 Web 為 root 或修改 NAS 來源 ACL 來繞過問題。資料來源 ACL 與 Docker UID 可讀性不是同一件事。

Compose 版本用 `.env.example` 裡的非秘密 host settings，設定 `GOOGLE_OAUTH_JSON`、`PORTAL_ORIGIN`、`GOOGLE_HOSTED_DOMAINS` 等；OAuth JSON 仍獨立 RO mount。先跑 `docker compose --env-file /absolute/private/compose.env -f deploy/compose.synology.yml config --quiet`。設定檢查不等於 NAS 正式啟用。

你目前 nginx upstream 是 `http://10.0.1.31:24681`。本機隔離測試使用 `-p 10.0.1.31:24681:3000`，其餘 mount／security flags 同上；Compose 可設 `PORTAL_BIND_ADDRESS=10.0.1.31`、`PORTAL_HOST_PORT=24681`。正式同 NAS 預設仍是 loopback 3210；若 proxy 位於另一台主機，只綁指定 LAN interface，防火牆限制 proxy 來源，nginx 入口限 LAN／VPN。不要發布至公網。

NAS directory 未就緒時，Google callback 可能回 `directory-unavailable`；這表示流程進到 NAS mapping 階段，仍沒有 Portal session 或文件授權。SQLite audit 的 `oidc-verified` 只記錄 Google token 驗證階段（無 email／token），不能當成 NAS acceptance。

## 上 NAS 的手動驗收

1. 在已授權的合成測試 root 手動執行 [NAS_PROBE.md](NAS_PROBE.md) 的命令；stdout 保存到 root 外的私有 evidence 目錄。提供去識別化輸出，不提供密碼、token、NAS 帳號資料庫或正式文件。
2. 記錄本機／AD／LDAP directory、普通使用者能否自行改 email、身份停用與重建識別來源。若 email 可自改，不可直接 trusted。
3. 依 [ACL_ACCEPTANCE_MATRIX.md](../ACL_ACCEPTANCE_MATRIX.md) 比較 **A/B 各自**的 File Station／SMB 行為；管理員結果不能代替。native bridge 需按該環境實作並通過，不能用手填 allowlist 開正式文件。
4. 在 LAN DNS／TLS 配好後完成真實 Google 登入、錯誤 Workspace、A→B、停用、snapshot 過期等驗收；將結果寫入 IMPLEMENTATION_STATUS。
5. 完成 NAS RO mount、重啟／離線、代表性大 FIG、proxy／network 測試，才掛正式指定 roots。

映像的 arm64／amd64 測試範圍與 image ID 以交付 manifest 和實作狀態為準；Docker Desktop 的 Linux VM 測試不證明 Synology kernel／ACL 相容。沒有自動 SSH、NAS ACL 變更或正式部署。

## 將映像帶到 NAS

若習慣 ApeRelay 的部署方式，可先看根目錄 [QUICK_START](../QUICK_START.md)：`.env` + `docker compose up -d`，或使用 GitHub Actions／GHCR 的固定 digest。repository 已指定 `git@github.com:MacacaGames/OpenPencil-Viewer.git`，映像名稱為 `ghcr.io/macacagames/openpencil-viewer`。workflow 已準備；本機 commit 由操作員手動 `git push -u origin main`，尚未推送／執行／發布。需操作員確認 Actions／Packages 權限；OAuth／NAS secrets 不提供給 CI。

本機已分別建置 `openpencil-lan:0.1.0-arm64` 和 `openpencil-lan:0.1.0-amd64`。`npm run release:export -- 映像名稱` 產生 `.work/releases/平台-ID/`，只含 image.tar、公用設定範本／手冊／probe／測試與 manifest／SHA256SUMS；**不含 OAuth JSON、SQLite、來源設計檔**。

在 NAS Container Manager 檢查 CPU 平台後，帶入相符平台的整個交付目錄，手動檢查並載入：

```sh
cd /absolute/private/交付目錄
sha256sum -c SHA256SUMS
docker image load --input image.tar
# 將 manifest.json 的 imageId 填入 PORTAL_IMAGE，再照上面的 mount/env 啟動隔離測試。
```

macOS 可用 `shasum -a 256 -c SHA256SUMS`。載入映像不會帶入你的 secrets／state／test_files；這些必須分開手動準備。x86 NAS 使用 amd64，ARM NAS 使用 arm64；不支援未驗證架構。正式 NAS bridge 還需依 probe 結果實作，不能只改 directory JSON 把 strict gate 打開。

參考：[Docker bind mounts](https://docs.docker.com/engine/storage/bind-mounts/)、[Docker multi-platform builds](https://docs.docker.com/build/building/multi-platform/)、[Google OIDC](https://developers.google.com/identity/openid-connect/openid-connect)。
