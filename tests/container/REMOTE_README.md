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

串流開始可能先解碼預設1024×768的 bootstrap frame；第一張影片不代表尺寸同步完成。測試以 browser DPR2 開啟，等待實際解碼尺寸符合 Portal 回應的核准尺寸（允許8px capture 對齊），再驗證 Retina 與1080p像素上限；視窗resize、全螢幕與第二個帳號開啟也必須達到核准尺寸。沒有任意固定 sleep 或取消解析度檢查。

串流頁載入 adapter 的 `portal-client.js`，將 pinned Selkies core 送給 iframe 自己的 video-ready 事件，轉成固定的同源父視窗通知；外層依 Origin／iframe source 驗證後重送尺寸。初始 SETTINGS 也保留經上限限制的 manual width/height。若看到早期 `Cannot send resolution ... Connection not open`，需確認後續尺寸是否同步；若一直停在1024×768，仍屬失敗。`tests/e2e/remote.spec.ts` 另有 socket 晚於 iframe load 的合成回歸案例。

原生 UI 編輯與 reload 清除另由 tests/e2e/remote.spec.ts 驗證；此 H.264 gate 核對真實 Linux Chromium 啟動、串流、輸入、resize、隔離和清理，不能把它當作 Unraid GPU／所有編輯工具驗收。
