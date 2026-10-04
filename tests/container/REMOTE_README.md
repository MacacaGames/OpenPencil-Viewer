# 合成 Linux 串流驗收

此 harness 使用 Selkies session-edit，建立簽章假 OIDC 和 repository 的合成 FIG，測試來源只在臨時 `/state`。它不是正式服務入口；不得給它正式 OAuth、NAS mount 或對外發布。production image 不含此入口。需要 native Linux Docker；ARM 模擬 amd64 的 Chromium seccomp-bpf 失敗不能代表實體 Unraid。

先建置正式固定映像，再在 repository 根目錄：

CI 自動使用一般 `deploy/Dockerfile` 的 release candidate，不需要功能專用 tag；amd64 和 arm64 均在對應原生 Linux runner 上測試。完整 gate 可手動重現：

```sh
PORTAL_TEST_IMAGE=你的已建置映像 sh tests/container/readonly.sh
PORTAL_TEST_IMAGE=你的已建置映像 npm run test:image:features
```

第二個指令檢查 production 元件、UID10001／99 的 SQLite0600／WAL，再建立僅含合成 fixture 的衍生測試映像，分別驗證兩種執行身份的實際 H.264／resize／隔離／登出清理。衍生測試映像與容器會清除，日誌留在 `.work/selkies-ci/`。Docker host 架構必須與候選映像相同；CI 不以 QEMU 結果替代 Chromium sandbox 驗收。以下是單次手動 harness 操作：

```sh
node --import tsx scripts/build-remote-test.ts
docker run -d --name openpencil-selkies-synthetic-test \
  --user 10001:10001 --read-only --cap-drop ALL \
  --security-opt no-new-privileges:true \
  --security-opt seccomp=./deploy/selkies/seccomp-chromium.json --init \
  --tmpfs /tmp:rw,noexec,nosuid,nodev,size=512m,mode=1777 \
  --tmpfs /run:rw,noexec,nosuid,nodev,size=32m,mode=1777 \
  --tmpfs /state:rw,noexec,nosuid,nodev,size=1g,uid=10001,gid=10001,mode=700 \
  --shm-size=1g --pids-limit 512 --memory 12g \
  -p 127.0.0.1:24682:24682 openpencil-viewer:selkies-synthetic-test
npm run test:remote:container
docker logs openpencil-selkies-synthetic-test
docker stop openpencil-selkies-synthetic-test
docker rm openpencil-selkies-synthetic-test
```

Playwright Chromium 未安裝時，可指定 `REMOTE_TEST_BROWSER` 為已安裝 Chrome 完整路徑。CPU／軟體結果與 GPU 驗收分開。測試核對 actual H.264 decode、動態 video resolution、公開頁沒有FIG/scene請求、登出profile清理、合成來源hash/mtime。啟動即註冊 requestVideoFrameCallback，避免靜態畫面第一張已呈現後才等待「下一張」造成假 timeout。

原生 UI 編輯與 reload 清除另由 tests/e2e/remote.spec.ts 驗證；此 H.264 gate 核對真實 Linux Chromium 啟動、串流、輸入、resize、隔離和清理，不能把它當作 Unraid GPU／所有編輯工具驗收。
