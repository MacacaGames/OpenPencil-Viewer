# 伺服器渲染 viewer

使用者於2026-10-03 明確改為只需要切換頁面、縮放和平移，瀏覽器不應載入完整場景。正式模式改為此 viewer；原生完整 editor 僅留在 development regression profile。正式 config 指定 native 會拒絕，`/auth/mode` 回覆 viewer:raster；原始 `/content` 與完整 `/scene` 正式端點均拒絕410，不降級傳送原檔或場景。

`GET /api/files/:id/viewer?revision=...` 只傳頁面 ID、名稱與邊界，JSON 最多2 MiB。`GET /api/files/:id/viewport?revision=...&page=...&x=...&y=...&scale=...&width=...&height=...` 只傳目前視窗的 WebP 圖片，單邊最多1536px、最多2,097,152像素、回應最多8 MiB。不是輸出整張巨大頁面後再讓瀏覽器裁切。縮放／平移先用現有影像回饋操作，再請求新的局部影像；圖片 Object URL 隨替換／登出／卸載釋放。

沿用 pinned OpenPencil renderer／CanvasKit 在伺服器 CPU 渲染，不另外解釋 FIG 繪圖格式。字型只從隨映像的固定字型清單讀取；renderer worker 禁止外部網路。文件解析與 layout 完成後鎖定 graph，不提供修改／寫回／匯出 API。沒有把 scene、原始圖片資源或原檔送進瀏覽器。

每個 portal 保留最多一份已解析文件的隔離 worker，閒置5分鐘後釋放；切換文件會替換 worker。原檔／解析結果不落盤。視窗圖片有64 MiB RAM LRU；所有命中仍重新檢查登入、身份、權限與 descriptor source revision，拒絕變更／撤權／失效來源。每次未快取工作只有一個，60秒 deadline，V8 old-generation上限512 MiB（不代表總 RSS 上限）。沿用解壓／檔案512 MiB上限與 non-root／RO mounts。worker 故障或取消會釋放該文件，不提供完整場景 fallback。

首次仍須在伺服器讀取／解析 FIG；這個方案消除瀏覽器完整文件傳輸，不保證首次 NAS 解析即時完成。跨文件並行使用目前會互相替換文件 worker，多使用者容量／NAS CPU記憶體仍待實測。已開放的影像可被使用者擷取，viewer 不提供 DRM。

手動更新時使用新驗證映像 `openpencil-viewer:raster-viewer`。現有 Google-only production config 不需新增欄位，保留目前 readonly 掛載；實際啟用依新 image 的 `/auth/mode` 判定。development 可明確設定 viewerMode:raster 供合成 OIDC／瀏覽器測試；預設 native 保留原有 graph immutability／UI regressions。這不改變 google-mount 的共用授權範圍，也不完成 dsm-strict 的原生 NAS ACL 驗收。

本機檢查與實測數字記於 IMPLEMENTATION_STATUS；NAS 新映像尚未由 agent 部署。不得將本機預覽證據當成正式 NAS fidelity／效能或 ACL acceptance。
