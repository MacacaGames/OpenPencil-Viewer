# 部署與正式啟用 gate

**Docker Desktop 的 Linux 容器驗證已執行，NAS 實測仍待進行。正式 dsm-strict readiness 現在固定失敗；不得更改為 mock／root-allowlist 提供正式文件。** 實際映像／平台／測試結果見 IMPLEMENTATION_STATUS；操作步驟見 OPERATOR_HANDOFF。不要把有登入畫面的容器當成完成 DSM ACL 整合。

## 同 NAS 首選

日常操作可用根目錄 `docker-compose.yml` 與 `.env`：`docker compose config --quiet`、`docker compose up -d`。它 extends 下列 Synology 定義，所有 mount／strict／non-root 限制共用。公用交付包同時包含這兩份 Compose。公司 ApeRelay 慣例與 GHCR 設定見 [QUICK_START](../QUICK_START.md)、[DEPLOYMENT_CONVENTIONS](DEPLOYMENT_CONVENTIONS.md)；registry 尚未發布，可先用已測 image.tar。

`deploy/Dockerfile` 固定 Node 22.23.3／Bun 1.4.2，從官方來源 fetch lock 中的精確 SHA，檢查 pristine，隔離套 patch，再建完整 App。runtime 僅帶 web assets、BFF、production dependencies 與唯讀 Python helper；專用 UID/GID 10001。CI 建置，不在 NAS 編譯。

```sh
docker build -f deploy/Dockerfile -t openpencil-lan:test .
PORTAL_TEST_IMAGE=openpencil-lan:test sh tests/container/readonly.sh
```

以上只對 Docker host 的**合成臨時 root**驗證非 root、mount/rootfs RO、Linux O_PATH／proc descriptor、特殊檔與 nested mount 拒絕、mounted OAuth JSON／domain，以及 strict 拒絕。已在 Docker Desktop 執行 arm64 測試；最終平台結果見實作狀態。固定 Node base manifest digest `sha256:43ac6c60b8f89723f746e8a92ce91abd5017e627ce1ddfe4238355d3a30b772c`；builder 在 BUILDPLATFORM 編譯平台無關的 web/JS，runtime 取得目標 Node/Python。production dependencies 目前全為 JS，build 拒絕 `.node` addons。Desktop 的 amd64 emulation 不代表真 NAS 的 kernel／ACL。正式 release 再記錄 SBOM／漏洞審查。

管理員手動建立獨立 config、local state 與**隔離測試**來源子目錄；只給 service UID 必需的 filesystem read/traverse。state 以 0700 及 UID 10001 所有權管理，JSON/env 管理員控制且不可由一般使用者寫入。不要遞迴 chmod、掛整個 volume、Docker socket、password database 或使用 privileged Web container。source RO 與每位 Google 使用者的 ACL 是不同層。

複製 `deploy/config.example.json` 成私密 config.json，填 exact origin、hd、roots。`directory.example.json` 刻意到期／空 principals，**不是可登入的假 directory**。可信 adapter 需提供唯一 principal key、generation、username、email、enabled、trustedEmail、groups，以及穩定 instanceId；普通使用者可改 email 的來源不能直接 trusted。snapshot 每次 API 讀取，observedAt 不能超過五分鐘，expiresAt 到期拒絕；這份程式未自動收集 DSM directory。

Compose settings 見 `.env.example`：Portal、directory、Google OAuth 各掛單一 JSON，domain 由 environment 提供；秘密檔不進映像。先只掛明確隔離 root，確認 host paths 存在；`create_host_path:false` 防空來源被自動建立。JSON 未知 key、重複 root、`/` root、正式非 HTTPS／非 Google／非 strict 一律拒絕。`node dist/api/check-config.js` exit 1 為 config 錯誤；valid 且 exit 2 表示正式 gate 未通過，不寫 session／source。它不代替 mount 或 live acceptance。

```sh
docker compose --env-file /private/operator/compose.env -f deploy/compose.synology.yml config --quiet
# 待 image、測試 root 與 NAS probe 具備後，由操作員手動啟動：
docker compose --env-file /private/operator/compose.env -f deploy/compose.synology.yml up -d
```

尚未授權／執行上述部署。BFF 綁 NAS loopback 3210，HTTPS 反向代理設 exact hostname、信任憑證、LAN subnet/VLAN allowlist；範例 nginx 設 `proxy_buffering off`、無 cache、超時與小 request body。不要把客戶端 X-Forwarded-For 當 firewall 身份；代理的實際 peer/firewall 和直接 BFF 路徑都要驗收。若 NAS 內建 proxy 無法做到這些限制，先修 proxy／network 設定，不擴大 bind。

rootfs RO、cap_drop ALL、no-new-privileges、限制 pids/memory/CPU、受控 tmpfs、可輪替 logs。SQLite 放本機 state volume，不放 SMB/NFS；原檔與 state 分開。沒有正式 document cache 或縮圖 volume。

## Native helper 與 mount 安全

現有 `tools/filesystem/reader.py` 只做 service account 的安全讀取，**不是 DSM ACL evaluator**。Linux O_PATH 在 I/O 前確認 regular file，固定 `/proc/self/fd` reopen 同 descriptor；fdinfo mount id 排除同 filesystem bind submount；不可用時拒絕。macOS 只供合成開發，沒有宣稱相同保障。Linux descriptor／mount-id 負向測試已在 Desktop synthetic container 執行；DSM syscall／device race 尚待實機驗證。索引 root dev:inode baseline 存 SQLite，重啟失聯保持 metadata 且 offline，替換 root 需管理員審查；它不是跨 reboot 永久 NAS 身份證明。

真正 bridge 需按 mapped NAS principal 驗證 traverse/list/read 並把授權與 descriptor 的同一文件綁定，處理群組 deny／Windows ACL／advanced share restriction。正式 authorization provider 目前未實作，沒有快速 filesystem fallback。詳見 AUTHORIZATION_ADR 和 ACL_ACCEPTANCE_MATRIX。

[Docker 官方 bind mount 文件](https://docs.docker.com/engine/storage/bind-mounts/)指出遞迴 read-only 的 kernel 差異。不得只相信 `:ro` 字串；實測 nested mounts、主 root 消失／空 mountpoint、NAS reboot、來源 revision、source hash/mtime。NAS root 有 mount identity 改變時停止讀取，操作員確認後才更新 baseline。

## Unraid

`compose.unraid.yml` 是**明確 blocked profile**，啟動只會 exit 2。沒有默默沿用遠端 SMB/NFS service UID。需另外驗證 remote mount、斷線空目錄、傳輸保密、NAS identity／effective ACL、跨主機 mTLS broker 與延迟，另寫 ADR 後才實作。

## 發布條件

M0 native capability、M2 real Google、M3 所有適用 live ACL matrix、M4 代表性大 FIG、M5 RO Docker/network/reboot 驗收都需證據。任何越權／寫入為 release blocker。GitLab mock job 不做 deploy；protected/manual image job 只跑 synthetic container，live gate 現在 exit 2。未通過前維持 unavailable。
