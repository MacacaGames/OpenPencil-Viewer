# 合成 Linux 串流驗收

此 harness 建立簽章假 OIDC 和 repository 的合成 FIG，測試來源只在臨時 `/state`。它不是正式服務入口；不得給它正式 OAuth、NAS mount 或對外發布。production image 不含此入口。需要 native Linux Docker；ARM 模擬 amd64 的 Chromium seccomp-bpf 失敗不能代表實體 Unraid。

先建置正式固定映像，再在 repository 根目錄：

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
