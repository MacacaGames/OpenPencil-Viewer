# Unraid Selkies OpenPencil：會話編輯，不寫回

一般 CI／GHCR 映像同時包含 raster viewer、Selkies 與 Chromium，使用既有 `latest`、`sha-*`、branch／version 標籤即可；由設定 `viewerMode: "selkies"` 選擇遠端模式，無需 Selkies 專用映像標籤。現有 raster viewer 仍可用獨立設定／部署，也可保留舊映像 digest 回復。身份採已接受的 Google Workspace `google-mount`：合格組織帳號共用設定的指定目錄。這不代表 DSM 個人 ACL 已完成；`dsm-strict` 的 fail closed 行為保留。

依操作員本次指示，Selkies 範例使用 `mode: "session-edit"`：原生 UI 可編輯物件、文字、屬性與頁面，修改只存在目前 Chromium 會話記憶體，重新載入、關閉或登出即清除。沒有儲存、匯出或 NAS 寫回；不要把它視為可保存工作的編輯器。`mode: "read-only"` 仍可鎖定遠端 UI，raster／一般 native viewer 維持唯讀。

## 交付與固定版本

一般 CI 與手動建置共用 [deploy/Dockerfile](../deploy/Dockerfile)，舊 `deploy/selkies/Dockerfile` 路徑只是同一檔案的連結。版本鎖為 [versions.json](../deploy/selkies/versions.json)。支援 `linux/amd64`／`linux/arm64`；本案 Unraid 使用 amd64。

| 元件 | 固定值 |
|---|---|
| LinuxServer Chromium 元件 index | `lscr.io/linuxserver/chromium@sha256:2d32e1b2b28aa92973aa0f58c433c0b045db6e1224d7001eeaa9cde1a474ce13` |
| amd64 元件 manifest | `sha256:35e67a28573b13269bb96f9e8464411b4b71467ce46a055a4d584ab5d2c0f06f` |
| arm64 元件 manifest | `sha256:30282ed89be588e4ff891a32c88f88876e697126494d0d745693a064c7210807` |
| LinuxServer build | `d759a0f5-ls56` |
| Chromium | `154.0.8037.57-1~deb13u1` |
| Mesa | `25.0.7-2+deb13u1` |
| Selkies / pixelflux | `2.0.0` / `2.1.0` |
| Node / Bun | `22.23.3` / `1.4.2` |
| OpenPencil | pristine `8c72b62da07ea1f7e82de84c7c837c3c78dfbf95`，v0.15.1 |
| runtime 額外 Debian 套件 | snapshot `20260930T000000Z`；映像內 `/app/runtime-packages.txt` |

在 repository 根目錄建置：

```sh
docker build --platform linux/amd64 -f deploy/Dockerfile \
  -t openpencil-viewer:0.1.0 .
docker image inspect openpencil-viewer:0.1.0 \
  --format '{{.Id}} {{.Architecture}} {{json .Config.User}}'
docker save -o openpencil-selkies-amd64.tar openpencil-viewer:0.1.0
sha256sum openpencil-selkies-amd64.tar
```

Dockerfile 使用 LSIO 映像作為元件來源，覆寫 entrypoint，以 `10001:10001` 啟動 Portal；不啟動其 root `/init`、nginx、終端、Docker daemon 或預設 Chromium wrapper。Node runtime 依 TARGETPLATFORM 取得，避免 ARM 建置主機將 ARM Node 放進 amd64 映像。建置 context 排除 `test_files/`、OAuth、state、`.work/`、原始 upstream checkout；建置時取得並驗證固定 upstream。

`npm run release:export:selkies` 可匯出映像及公開部署檔到 `.work/releases/selkies-amd64-<image id>/`，附 manifest、SHA256SUMS、版本鎖與實際驗證狀態，不包含FIG、OAuth或state。匯出的Dockerfile是來源參考，重建仍需repository完整來源；解壓後可直接按本手冊手動部署。

收到匯出目錄時，在其根目錄先執行 `sha256sum -c SHA256SUMS` 與 `docker load -i image.tar`，再進入 `deploy/selkies/` 填寫 `.env`／config並執行Compose；後文的 `openpencil-selkies-amd64.tar` 是自行建置匯出的示例檔名。

此次 CI 修改發布成功後，Unraid GUI 的 Repository 直接填 `ghcr.io/macacagames/openpencil-viewer:latest`，或一般 `sha-<新commit>`／已驗證 digest。舊 `sha-4d2baff` 的建置未包含 Selkies runtime，需使用此次修改之後發布的新映像。CI 在兩種架構的原生 Linux runner 上先驗證 raster／唯讀來源、實際 CPU H.264、resize、會話隔離與登出清理，再發布同一已測映像；UID10001 和 Unraid UID99 均納入。這些合成測試不代替 Unraid GPU／正式 NAS 驗收。離線 tar 匯入仍可選用，並在 `.env` 的 `PORTAL_IMAGE` 填入匯入後的本機 tag。

## 資料與連線邊界

```mermaid
flowchart LR
  B[使用者瀏覽器] -->|HTTPS：Google 登入、文件列表| P[Portal :3000]
  B -->|已驗證 WebSocket：H.264 畫面與操作| P
  P -->|loopback :8086| S[Selkies / X11]
  S --> C[獨立 profile 的 Chromium]
  C -->|loopback :8085：短效內部 ticket| A[原生會話 adapter]
  A -->|受控唯讀開檔| N[指定 NAS CIFS / NFS 目錄]
```

外部 `/scene`、`/content` 繼續回應 410。內部文件路由只存在另一個 loopback listener；公開 listener 的 `/_remote/*`、`/remote-desktop` 回應 404。內部 ticket 與活動會話、Portal session、文件 revision 綁定，讀取前後重新驗證。不能把 8085、8086 發布到主機或代理。

外部瀏覽器使用官方 Selkies core 解碼 H.264；不解析 FIG、不接收 scene、不建立 OpenPencil 文件 graph。原生 UI 在伺服器 Chromium 内運作，切頁、縮放與平移使用保留的 renderer、圖片與字體狀態。內部 scene cache 有 64MiB 上限，超過上限的文件在重新建立會話時可能重新解析；現有原生圖片 cache 上限沿用 adapter，不是整個程序或 VRAM 上限。

## 部署參數與手動步驟

尚未取得實際 Unraid 版本、GPU PCI ID、share／本機儲存路徑；範例故意留白。使用操作員已核准的指定 share／子目錄，不掛載整個 NAS volume。NAS 掛載由操作員在 Unraid 管理，不由應用程式建立或改動。指定 NAS 掛載可由操作員選用 `rw` 或 `ro`，不再要求唯讀 mount bit；範例 `.env` 為 `NAS_READ_ONLY=false`。`rw` 表示容器身份有來源檔案系統寫入能力，應用仍無寫回路徑；它不等於 filesystem 唯讀。config／OAuth 與容器 root filesystem 仍唯讀，state/profile 則可寫且與 NAS 分離。

1. 把 `deploy/selkies/` 放到獨立的部署目錄；保留原 raster 部署。複製 `env.example` 為 `.env`，`config.example.json` 為專用 config 目錄中的 `config.json`。改 `origin`、`allowedHostedDomains`，沿用既有 OAuth JSON；callback 為 `https://你的網域/auth/google/callback`。
2. `.env` 填入 `PORTAL_CONFIG_DIR`、`GOOGLE_OAUTH_FILE`、`NAS_DESIGNS_PATH`、`LOCAL_STATE_PATH`。Unraid Compose 預設 `PORTAL_UID=99`／`PORTAL_GID=100`，可依需求設為10001:10001；state/profile 必須使用 Unraid 本機獨立儲存，既有資料需屬於選定 UID，config／OAuth／NAS 資料只需可讀。不要用 `chmod 777` 解決權限。
3. `NAS_EXPECTED_SOURCE` 填入容器 `/proc/self/mountinfo` 顯示的實際來源，例如 `//NAS/approved-share` 或 `NAS:/approved-export`；不是 Unraid 本機 mountpoint。啟動要求 `/data/designs` 是精確掛載點、檔案系統為 `cifs`、`nfs` 或 `nfs4` 且來源完全相符；`ro`／`rw` 均可；每次建立／續期／存取串流及 watchdog 都會重新檢查。來源 inode、revision、可讀性另由安全 index 驗證；NFS 必須可從 mountinfo 取得實際 `addr`，避免只有 `:/export` 時無法區分伺服器。
4. 匯入映像並先用 CPU／軟體渲染跑通登入與會話：`.env` 設 `GPU_ENCODER_MODE=cpu`、`GPU_RENDER_MODE=software`，使用主 Compose。主 Compose 不需要 DRM device。若使用 `auto` 且未提供 GPU，日誌明確顯示 CPU／software。
5. 反向代理參考 `nginx.example.conf`；TLS、Origin、WebSocket Upgrade、長連線 timeout 均需成立。範例只 listen 主機 `127.0.0.1:24681`，代理需在同主機可達此位址。若代理另在容器，操作員須設計專用網路／對應 listener，不能將內部端點一起公開。
6. 開始 GPU 診斷，填入精確 PCI 地址、DRM group 數值 GID，再加入 GPU overlay。正式手動部署命令如下：

```sh
docker compose --env-file .env -f compose.unraid.yml config
docker compose --env-file .env -f compose.unraid.yml pull
docker compose --env-file .env -f compose.unraid.yml up -d
docker compose -f compose.unraid.yml logs --tail 100 portal
# GPU 模式：設定 GID／PCI 與模式後重建；不要同時跑兩個部署爭用代理埠。
docker compose --env-file .env -f compose.unraid.yml -f compose.gpu.yml config
docker compose --env-file .env -f compose.unraid.yml -f compose.gpu.yml up -d --force-recreate
```

Compose 使用 root filesystem readonly、cap_drop ALL、no-new-privileges、數值 non-root（Unraid 預設99:100）、私有 IPC、512MiB `/tmp`、1GiB `/dev/shm`、12GiB RAM、512 pids。Portal／Chromium 不取得 Docker socket。需要更多大文件記憶體時由操作員按量測調整 mem_limit，不因此變更 NAS mount。

操作員也可選用 Unraid 常用的 `nobody:users` 數值身份 `99:100`：Docker CLI 將 `--user 10001:10001` 改為 `--user 99:100`，Compose 將 `user` 改為 `'99:100'`，並重建容器。此映像直接啟動 Node，沒有處理 `PUID`／`PGID` 的 root init；僅設定這兩個環境變數不會切換身份。專用本機 state 及其既有資料需屬於選定 UID，config／OAuth／NAS 來源需讓該身份可讀，DRM supplementary groups 仍須保留。`99:100` 的本機合成 SQLite 建立、`chmod 0600`、WAL 讀寫已驗證；完整 Unraid Chromium／GPU 會話仍待實機驗證。

### 使用 Docker NFS named volume

也可以由 Docker local driver 掛載操作員指定的 NFS export，再將 named volume 掛到 `/data/designs`；不需要 Portal 取得 mount capability。操作員目前已有 `openpencil_design`，其 driver 為 NFSv4／`rw`，可直接繼續使用；不需要另建 `openpencil_design_ro`。Unraid GUI 的 Design Host Path 填 `openpencil_design`、Container Path `/data/designs`、Access Mode Read/Write，CLI 對應 `-v openpencil_design:/data/designs:rw`。套用前確認實際 Docker 命令是 named volume，而不是新本機目錄。可自行選 Read Only，但不是新版程式的必要條件。

操作員已提供此容器 mountinfo 的 filesystem 為 `nfs4`、source 為 `:/volume1/Gd`；這次部署 `NAS_EXPECTED_SOURCE=:/volume1/Gd`。`addr=10.0.1.1` 是 NFS mount option，不能將 source 自行改写為 DNS 名稱。容器重建後，單独執行下列一行確認實際來源；指定 share 僅限已核准目錄，`/state` 仍使用 Unraid 本機專用儲存。

```sh
awk '$5=="/data/designs" {print}' /proc/self/mountinfo
```

config 必須同時有 `viewerMode: "selkies"` 與完整 `remote` 物件，見 `config.example.json`；普通映像包含 Selkies 不會自動切換部署模式。沒有 `viewerMode` 的 production config 仍使用 raster。Selkies 啟動及會話檢查保留精確 root、NFS/CIFS 與 expected source 驗證，支援 `ro`／`rw`。開放 UI 編輯要將 config 的 `mode` 設為 `"session-edit"`；此值只允許 Selkies＋google-mount，不允許 raster 或 dsm-strict。

若 `ls` 可列出文件，但 Portal 回503，先以實際掃描器檢查 metadata。將每個命令單獨貼到容器 Console，不把兩行接成同一行：

```sh
python3 /app/tools/filesystem/reader.py scan /data/designs | python3 -c 'import json,sys; x=json.load(sys.stdin); print({"identity":x["identity"],"entries":len(x["entries"])})'
```

成功後，查看實際使用的 config 與索引；命令不讀 OAuth 或 FIG 內容：

```sh
python3 -c 'import os,json,sqlite3; c=json.load(open(os.environ.get("PORTAL_CONFIG","/config/config.json"))); d=sqlite3.connect("file:"+c["statePath"]+"?mode=ro",uri=True); print({"mode":c["mode"],"viewer":c.get("viewerMode","raster"),"statePath":c["statePath"],"expectedSource":os.environ.get("NAS_EXPECTED_SOURCE"),"baseline":d.execute("SELECT id,path,identity FROM root_identity").fetchall()}); d.close()'
```

操作員此次輸出仍為 `read-only`／`raster`、`/state/google-mount.sqlite`、expectedSource=None、baseline85:256；當前掃描為138:256。這表示原先 Selkies config 尚未替換到 Docker 實際掛載的 config source。請修改映射到 `/config/config.json` 的主機檔案，而不是只新增環境變數或將另一份未掛載的檔案改名。它需包含 `mode: "session-edit"`、`viewerMode: "selkies"`、完整 `remote` 物件與本機 statePath；GUI 新增環境變數 `NAS_EXPECTED_SOURCE=:/volume1/Gd`，套用重建容器。預期 `/auth/mode` 回傳 session-edit／selkies／google-mount，`/health/ready` 為 ready=true。

新版在 production/google-mount 且明確設定 `NAS_EXPECTED_SOURCE` 時，以檔案系統、export、實際伺服器 addr、掛載子樹與來源 root inode 保存持久身份；NFS 每次掛載的 device／mount 編號只用於當次 descriptor 檢查。同一來源重掛後可重新掃描並更新 metadata/revision，不需要每次刪 SQLite。掃描前後都核對 mount，讀檔前後核對目前 mount，Linux scanner 回報實際 root descriptor 的 mount ID。來源消失、改成空本機目錄、換伺服器／export／root inode、掃描中改掛均拒絕；失敗保留離線索引，舊檔案 revision 的會話不能繼續讀取。`dsm-strict`、本機來源或沒有指定 expected source 的 raster 部署仍保留原數字身份防護。

首次升級時，既有 metadata 不作授權來源；只有核對明確設定的 NAS 掛載並成功完整掃描後才重新發布索引，session／DSM bindings 不會因此刪除或遷移。新版日誌 `source-index` 顯示 root id、狀態與索引檔案數，不印 host path／文件名；例如 online、root-identity-changed、source-identity-changed、source-mount-changed、remote-nas-mount-unavailable、source-offline。這些狀態可區分未套用設定、來源變更與 reader 失敗。

若操作員選擇本次全新的 Unraid `google-mount` 部署，可使用 `/state/unraid-google-mount.sqlite` 並重新 Google 登入，保留原 SQLite 檔；不需要遷移 DSM 身份。此選擇不代替持久 NAS 來源核對。NAS IP/export/root inode 的變更需要管理員確認並選擇新的部署 state，不能自行批准錯誤來源。真實 Unraid NFS 重掛／NAS 重啟／斷線仍需操作員驗收；本機 proof 模型測試不等於實機通過。

## Chromium sandbox 與主機相容性

Chromium 保留 sandbox，沒有 `--no-sandbox`、`--disable-seccomp-filter-sandbox`、`CAP_SYS_ADMIN` 或 privileged。此固定 Debian Chromium 使用 user namespace sandbox，基底沒有可用的 SUID chrome-sandbox。提供的 seccomp 源於官方 moby/profiles `6fe7deb1b9fb7c0397a4593480d7d22b9ee8caef` default profile，僅增加 sandbox 所需 `clone`、`unshare`、`setns`、`chroot`；`clone3` 保留 ENOSYS 行為。

`chroot` 的許可供Chromium在隔離user namespace內使用，不賦予主機root capability。Mesa軟體WebGL在此容器被Chromium預設blocklist拒絕，因此固定launcher使用 `--ignore-gpu-blocklist`，讓已選定的Mesa路徑可用；這不關閉sandbox。內部URL白名單使用 [Chromium官方前綴格式](https://www.chromium.org/administrators/url-blocklist-filter-format/) `http://127.0.0.1:8085/`，不使用會被當成字面路徑的 `/*`。

操作員須核對 Unraid Docker、libseccomp、核心 user namespace 與 GPU 驅動版本。若主機拒絕 user namespace 或 seccomp profile 的 syscall，會話失敗並保留錯誤日誌；本交付不修改主機核心參數或替換驅動，也不提供關閉 sandbox 的繞過方式。可先跑：

```sh
docker run --rm --user 10001:10001 --cap-drop ALL \
  --security-opt no-new-privileges:true --security-opt seccomp=./seccomp-chromium.json \
  --entrypoint /usr/bin/unshare ghcr.io/macacagames/openpencil-viewer:latest -Ur -n id
```

輸出的 namespace 內 UID 0 只表示成功建立隔離 namespace；容器主程序仍為 10001。舊 Docker/libseccomp 如無法解析 profile，應先與操作員核對相容版本並用匹配的官方 default profile 重產同樣四項例外，不能直接改 `seccomp=unconfined`。

### Unraid GUI：No usable sandbox

操作員此次已確認沒有 Extra Parameters；Chromium 日誌為 `No usable sandbox`。先套用交付的自訂 seccomp，再確認主機 namespace 能力。Docker 預設 profile 的 namespace 限制與 Chromium 啟動無 GPU 編碼是兩個獨立問題；設定 GPU 不會解除 sandbox 限制。

1. 將本套件 `seccomp-chromium.json` 複製到 **Unraid 主機**的部署資料夾。Docker CLI 先讀這份檔案再建立容器；不是容器內 `/config/...` 路徑，也不只靠 volume 掛入即可套用。[Docker 官方說明](https://docs.docker.com/engine/security/seccomp/)
2. 在 Unraid 編輯容器，切換 **Advanced View**，於 **Extra Parameters** 加入下列設定。把 `UNRAID_HOST_PROFILE_PATH` 整段換成你實際存放 JSON 的 Unraid 完整路徑；它是佔位符，不是環境變數：

   ```text
   --security-opt no-new-privileges:true --security-opt seccomp=UNRAID_HOST_PROFILE_PATH
   ```

   例如**你選擇把檔案放在** `/mnt/user/appdata/openpencil-viewer/seccomp-chromium.json` 時，第二個參數為 `--security-opt seccomp=/mnt/user/appdata/openpencil-viewer/seccomp-chromium.json`。這是建議的放置位置，不代表已確認你的主機有這個路徑。保持既有 non-root 身份與其他部署參數。
3. 按 **Apply** 重新建立容器，讓建立時的 security options 生效，再開文件。在 Console 可先單獨執行下面一行測試：

   ```sh
   /usr/bin/unshare -Ur -n id
   ```

   成功時 namespace 內會顯示 uid=0；這是映射到容器原本 non-root UID 的隔離身份，沒有把 Portal 改為主機 root。若仍是 Operation not permitted，需要操作員回報實際 Docker SecurityOpt、user namespace sysctl／核心支援／LSM；不要修改主機核心參數或關閉 sandbox 來跳過驗證。

本機相同固定 runtime、UID10001、readonly rootfs、cap-drop ALL、no-new-privileges、無網路／無資料掛載的兩次對照：Docker default profile 下 unshare 以 EPERM 失敗；交付 profile 下成功。這是 local native arm64 Docker Desktop 證據，Unraid amd64 是否通過需套用後回報。沒有新應用程式 build 要求，seccomp 是操作員建立容器時的設定。

### 清理日誌與原始錯誤

`Received SIGTERM`、openbox 的 X connection broken、Selkies 的 display connection closed/refused 可在會話清理時一起出現。程序啟動失敗、文件載入失敗／逾時、登入／来源驗證失敗、沒有串流連線超過寬限時間、登出或服務停止均可觸發清理，不能只依最後幾行判斷原因。`No display clients connected` 也不能單獨證明反向代理/WebSocket 失敗：原生畫面準備好之前，外部瀏覽器尚未取得串流 URL。

操作員需提供本次開檔從 `remote-device-plan` 至 SIGTERM **之前**的日誌與網頁錯誤文字；保留第一個 Chromium／parse／document／stream 錯誤，排除 OAuth、Cookie、internal ticket 與 credentials。僅清理訊息不足以判定 sandbox 修正已生效或需要更换 GPU。

### 已呈現畫面但沒有串流連線：Nginx Upgrade

此次 Unraid 小檔案 software／CPU 對照有 `remote-presentation`、`ready:true`，NAS 讀檔約5.6ms、解析約300.4ms、原生載入約5904.2ms，其中首張呈現等待約5150.4ms。這確認此檔案的內部解析／呈現成功；並未驗證外部瀏覽器收到畫面。此時沒有 display client，接續 SIGTERM，不應將 DBus 訊息當成文件失敗原因。本機已成功解碼 H.264 的測試也有同樣 DBus 訊息。

操作員提供的 Nginx 設定含 `proxy_set_header Connection keep-alive;`。WebSocket Upgrade 需要同時傳遞 `Upgrade` 與 `Connection: upgrade`，固定 keep-alive 會阻止握手。最小修正是將該行改為：

```nginx
proxy_set_header Connection "upgrade";
```

完整部署範例 `deploy/selkies/nginx.example.conf` 使用 `map`，讓一般 HTTP 與 WebSocket 分別設定 Connection；`map` 必須放在 `http` context，與 `server` 同層。現有部署保留後端 `http://10.0.1.9:3000` 與操作員的憑證路徑即可。另建議 `proxy_buffering off`、`proxy_read_timeout 180s`、`proxy_send_timeout 180s`。只代理 Portal 公開連接埠，內部8085／8086不對外開放。依 [Nginx 官方 WebSocket 文件](https://nginx.org/en/docs/http/websocket.html) 核對。

在實際執行 Nginx 的主機／容器手動執行 `nginx -t`，成功後依原部署方式 reload。先保持 `GPU_RENDER_MODE=software`、`GPU_ENCODER_MODE=cpu`，重新開小檔案；瀏覽器 Network → WS 的 `/stream/…/api/websockets` 應為 **101**，伺服器應有 `remote-stream-info` 與 `remote-first-stream-packet`。外部畫面成功後再恢復渲染裝置 `auto`；R7沒有已驗證 H.264 encode entrypoint，CPU編碼仍需保留。

新增診斷日誌將 `remote-session-ready`、`remote-stream-http`（page／core／manifest）、`remote-stream-attempt`、`remote-stream-connected`／`remote-stream-rejected`、`remote-stream-closed` 與 `remote-session-stop` 分開記錄。停止原因区分 startup-failed、stream-disconnected、lease-expired、worker-exited、validation-failed、logout／shutdown；原15秒沒有連線的寬限期不變。拒絕紀錄只含固定階段與內部錯誤碼，不記 Cookie、串流憑證、internal ticket、任意路徑或 exception message。新版應用日誌要在此次變更提交並經CI發布後才會出現；Nginx修正可先套用，不依赖新映像。

## R7 250 起步與 GPU 診斷

R7 250 名稱不足以判斷 ASIC、驅動或 H.264 encode 能力。先在 Unraid 手動執行 repository 的 `sh scripts/probe-remote-gpu.sh`，收集 Unraid/kernel/Docker、`lspci -nnk` 的實際 PCI ID／核心名稱、driver、render node 與數值 GID。腳本只讀系統資訊，不更動驅動、ACL 或檔案。

GPU overlay 將 `/dev/dri` 提供給容器，程式按 `GPU_RENDER_PCI`／`GPU_ENCODE_PCI` 解析真正節點；不把 `renderD128` 視為特定卡。`auto` 優先 AMD，編碼預設選同一張渲染 GPU。多 GPU 時建議填完整 PCI 地址，避免猜錯裝置。

在活動會話中執行：

```sh
docker compose -f compose.unraid.yml -f compose.gpu.yml exec -e DISPLAY=:1 portal \
  python3 /app/tools/remote/gpu.py --diagnose > gpu-report.json
docker compose -f compose.unraid.yml -f compose.gpu.yml logs --tail 200 portal
```

`gpu-report.json` 包含 EGL／OpenGL、套件版本、DRM／PCI／driver、`vainfo` 完整節錄，以及生成 1280×720、30 frame 合成畫面後實際執行 `h264_vaapi`、ffprobe 確認 H.264／30 frames 的結果。暫存只寫 `/tmp` 並清理，不讀寫正式 FIG。未掛載 `/host-version` 時，容器無法讀 Unraid 發行版，須使用前述 host report；不要將 unavailable 當成版本相容通過。

| 模式 | 行為 |
|---|---|
| `GPU_ENCODER_MODE=auto` | 必須同時具備 H.264 `VAEntrypointEncSlice`／`EncSliceLP` 及實際 encode 成功才請求 VA-API；否則 CPU，記錄原因 |
| `GPU_ENCODER_MODE=vaapi` | 以上任一步失敗就拒絕；Selkies 最終 stream_info 若非硬體 VA-API，也拒絕並關閉會話 |
| `GPU_ENCODER_MODE=cpu` | 強制 CPU；診斷仍可獨立測 GPU 能力 |
| `GPU_RENDER_MODE=auto` | 按 PCI 啟動 Xvfb glamor，讀實際 GL renderer；X11 啟動失敗重試 software 並記錄原因 |
| `GPU_RENDER_MODE=software` | 明確 llvmpipe／software；不宣稱 GPU 渲染成功 |

`vainfo` 只有 `VAEntrypointVLD` 是解碼能力，不能算編碼通過。啟動日誌 `remote-device-plan` 是請求與 probe 結果；`remote-renderer` 是活動 X11 GL 結果；`remote-stream-info` 才是 Selkies 最終 encoder、hardware、capture、zero_copy、driver、encode_node 與 fallback 原因。CPU 或 software 不能列成 VA-API 成功。合成測試的 hwupload 也不是零拷貝證据；同卡僅是必要配置選擇，零拷貝需實際 `stream_info.zero_copy`／實測確認。

初期採固定版本已核對的 X11 路徑。R7 的實機 glamor／DRI 相容性仍需 Unraid 測試；本版本未提供 Wayland 部署，不能推論換 Wayland 必然修正旧卡問題。

## 換成 RX 5600／5700

1. 結束使用者會話、停止串流容器，依主機正常程序換卡。
2. 操作員確認現有核心驅動與 `/dev/dri`，重新跑 host probe。更新完整 PCI 地址與 GID；裝置可能不再是原 render node。
3. 用相同映像、Portal、OAuth、FIG 格式重建容器，跑診斷與合成 encode，再建立會話檢查最终 stream_info。
4. 自動模式通過後可用強制 VA-API 做負向／成功驗收。不承諾執行中熱切換。

GPU 主要影響 Chromium render、capture、encode；NAS 讀檔、FIG 解壓／解析、graph 建立與部分 layout 仍消耗 CPU／RAM。10GbE、PCIe x4 與128GB RAM不保證冷啟動即時。零拷貝未成立時 capture/upload 也有成本。

## 解析度、畫質與效能紀錄

基準單會話、H.264、30fps、1920×1080／2,073,600 pixels、DPI上限192。使用 Selkies2.0的自動遠端 resize，`use_css_scaling=false`，傳送範圍受 Portal 驗證。全螢幕會重算遠端尺寸並重新排版。超過上限時以等比例限制像素；上限會限制高DPI文字細節，若要1440p／4K需在 config同步增加maxWidth/maxHeight/maxPixels并先測資源。

初期鎖定 `video_fullcolor=false`，避免 AMD H.264 全色彩模式要求4:4:4後退回CPU；启用 Selkies現有 paint-over 靜態品質改善。保留官方增量H.264／壓縮、背壓及 frame ACK，並非每次縮放下載新FIG／完整PNG。H.264文字細邊和顏色仍需實際評估；不承諾低位元率與無損文字可同時成立。只有WebSocket傳輸，這版沒有WebRTC/TURN/HEVC。

結構化日誌：

| event | 量測 |
|---|---|
| `remote-parse` | NAS讀檔與FIG解析時間 |
| `remote-scene` | scene bytes、取得時間；cache命中不重新解析 |
| `remote-presentation` | scene hydration、文件實體化、layout、首張原生畫面 |
| `remote-first-stream-packet` | WS連線後第一個串流packet到proxy；不是使用者首張解碼呈現 |
| `remote-stream-info` | 實際backend／capture／renderer／encoder／硬體／零拷貝／fallback |
| `remote-stream-stats` | 約每5秒CPU、RAM、GPU／VRAM、encode/pipeline/RTT及累積傳輸bytes（可用欄位依runtime） |

Unraid手動量測每個檔案至少冷開、同會話切頁與連續縮放／平移、關閉後重開三次。記錄文件大小/hash/mtime、解析度DPI、host/CPU/GPU/driver版本、CPU/RAM/GPU/VRAM、以上各階段與瀏覽器首次解碼時間、位元率和文字清晰度。文件warm reopen超過64MiB scene cache時不一定命中；同一活動會話的縮放應沒有新 `remote-parse`。

另用 `docker stats --no-stream` 量測容器CPU／RAM與pids；Selkies的resource stats是runtime可見的系統資訊，不能直接當成Chromium RSS或cgroup峰值。GPU／VRAM不可用時要標示unavailable，不能記作0。

本機Mac／DockerDesktop結果另記於 `docs/IMPLEMENTATION_STATUS.md`；不得當作5950X／R7／Unraid效能。伺服器packet時間與RTT不能推算精確單向傳輸時間，需瀏覽器requestVideoFrameCallback或同步量測補足。

## 會話、編輯與來源完整性驗收

第一階段一個活動会话，其他帳號得到明確忙碌提示。每次新會話有獨立Chromium profile、X display與encoder。stream cookie有效90秒，與Portal session及lease綁定；每30秒renew不延長Portal idle expiry。WS握手驗證Origin／雙cookie，1秒watchdog檢查session/文件/worker；斷線15秒清理。登出／撤銷／到期會終止stream，TERM/KILL子程序並刪除profile。不能把不同使用者共用同一Chromium畫面。

Selkies proxy轉送頁面/zoom/pan操作與ACK；session-edit另允許文字、刪除、undo/redo與編輯快捷鍵，以每條WS的modifier狀態阻擋瀏覽器／桌面逃逸快捷鍵。阻擋命令、剪貼簿、檔案傳輸、音訊、webcam與二進位上傳，其他HTTP路由不代理。Chromiumpolicy停用下載／列印／檔案選擇／DevTools／外部URL／擴充套件。native adapter在read-only保留graph immutability；session-edit保留可變記憶體graph並啟用屬性面板、頁面新增／更名與原生編輯。兩種模式均禁止save/autosave/export/source binding/external document traffic，IndexedDB改成每次會話的記憶體實作，避免上游帳密store初始化錯誤與文件落盤。

手動驗收：

- 未登入不能開stream HTML、core或WS；錯Origin／到期credential／其他使用者不能接線，重複開啟收到busy。
- 開文件前後核對原FIG SHA256及mtime；`rw`掛載時也須在UI編輯後保持不變。DevTools中外部頁面只有文件列表、stream core與WS，沒有FIG或scene response。
- session-edit能新增／更名頁面、修改屬性與文字、刪除物件及undo/redo；Ctrl+S與匯出不得保存資料，重新載入應恢復原FIG。
- 切頁、縮放、平移、全螢幕、DPI及視窗resize正常；確認遠端xrandr尺寸跟隨且受上限約束，沒有持續拉伸固定桌面。
- 登出後畫面清除，WS關閉，`/state/remote/<lease>`被清理，下一個帳號使用新profile，不能看到舊畫面。正常停止容器也需清理。
- 用同一組操作核對只出現一次parse；檢查renderer/encoder、fallback與資源峰值。R7無編碼時CPU模式可繼續，但單獨標示。
- NAS掛載失效／來源替換後文件與會話被拒絕；不要在正式source上修改ACL或删除文件做負向測試。

## 故障排查與回復

| 現象 | 檢查 |
|---|---|
| `remote-nas-mount-proof-required/unavailable` | source字串、CIFS/NFS、精確target（ro／rw均可）；空本機目录不符合 |
| config/OAuth EACCES | 選定數值UID（Unraid預設99）讀取與父目錄traverse，不改NAS員工ACL |
| state/profile EACCES | Unraid本機state owner／mount可寫；config保持RO |
| SQLite `chmod EPERM` | 核對已建立容器的 `.Config.User`、`/state` host source／RW、檔案數值 owner 與 filesystem。GUI `--user 99:100` 不會自動改既有檔案 owner；本機專用 state 的 SQLite／WAL／SHM 須屬於99。若 owner 已99仍失敗，查 filesystem／掛載限制；不略過0600限制或改NAS ACL |
| sandbox/zygote/seccomp錯誤 | 主機usernamespace/libseccomp相容性；不得關閉sandbox；ARM模擬amd64結果不能代表實體Unraid |
| `remote-display-failed`／software fallback | 所選PCI/node、GID、R7驅動及X11GL；查看actualrenderer |
| `remote-forced-vaapi-*` | entrypoint／實際encode／stream_info，先用明確CPU測其他流程 |
| 有UI但黑畫面/WS失敗 | TLS、安全context/WebCodecs、proxy Upgrade、Origin、streamcredential与Selkieslog |
| 冷開慢、縮放慢 | 分開讀檔／parse／layout／GL／capture／encode／network；GPU只加速部分階段 |
| cleanup失敗 | 新lease保持blocked；保存日誌後正常重建容器，不把另一帳號接到殘留display |

回復：先停止 `openpencil-selkies`，將代理切回原獨立raster容器與原config/state；使用原 `deploy/compose.synology.yml`／既有操作紀錄。不要將Selkies的session-edit config直接交給raster／舊映像；改回mode read-only、移除remote設定，並將raster容器的NASmount設為唯讀，保留GoogleWorkspace設定。raster同樣拒絕公開FIG／scene，以viewportPNG工作。回復不需要轉換FIG、更新OAuth或變更NAS ACL。

官方依據：[AMD／GPU與全色彩限制](https://docs.linuxserver.io/selkies/user-guide/gpu/)、[Selkies設定](https://docs.linuxserver.io/selkies/user-guide/configuration/)、[Chromium映像](https://docs.linuxserver.io/images/docker-chromium/)。實作核對的是上述固定版source與映像，不將moving latest能力當作已支援。
