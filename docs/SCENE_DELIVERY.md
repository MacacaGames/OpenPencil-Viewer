# 伺服器解析與原生唯讀 UI

> 2026-10-03 更新：正式 viewer 已改為伺服器渲染，只傳目前視窗 WebP 與頁面摘要；完整 `/scene` 在 production 回覆410。本文保留先前階段紀錄，最新部署與限制請見 [RASTER_VIEWER.md](RASTER_VIEWER.md)。

原始 `.fig` 只由伺服器透過既有授權／descriptor reader 讀取。正式模式的 `/api/files/:id/content` 不提供原始檔，GET／HEAD 均拒絕；前端使用 `/api/files/:id/scene`。既有原始 transport 僅保留於 development，供合成 confinement probes 使用。

伺服器在隔離的 Node worker 執行安全檢查、FIG 解碼與全部頁面場景建構，傳送版本化 ZIP 場景：JSON 結構、去重的 binary 圖片／幾何資源。原始 archive、Kiwi schema 與 lazy original-source context 不傳送。瀏覽器 worker 解開場景，原生 OpenPencil UI 準備字型／layout，鎖定 graph 後顯示。頁面、圖層、選取、縮放保留；不啟用編輯、匯出、持久化或外部文件流量。

這不是防擷取機制：可見的文字、圖片與場景資料仍會進入瀏覽器，使用者可取得已獲准的顯示內容。保證範圍是正式端點不提供原始 `.fig` archive。

每個 portal 同時最多一個未快取解析工作，60 秒 deadline；worker V8 old-generation 上限512 MiB，FIG／解壓內容／場景傳輸各最多512 MiB。V8 heap limit 不包含所有 native／ArrayBuffer 記憶體，因此不可解讀為總 RSS 上限。過大的文件、錯誤格式、取消或 worker 失敗均拒絕，沒有 raw FIG fallback。

快取只保存在程序記憶體，上限64 MiB、按最近使用淘汰、以 file ID＋revision 區分。超過64 MiB 的單份場景不快取；重啟清空。每次命中仍重新驗證登入、權限和來源 revision，快取不授予存取權。不另存原始檔、轉換場景或 secrets 到磁碟。

速度限制：首次仍須在 NAS 讀完整 FIG，解析後傳送完整場景與圖片；目前不是逐頁／按需圖片載入。場景大小未必比壓縮 FIG 小。記憶體快取可省去重複讀取與解析，不能宣稱所有首次開啟都更快。實測 NAS 的 CPU／磁碟／LAN 與瀏覽器時間應分開判讀。

本機三份已批准唯讀 fixtures 的 worker 實測（不含瀏覽器／NAS）：原始167,558 bytes → 場景220,911 bytes／250 ms；9,108,449 → 9,408,356／554 ms；409,977,351 → 410,736,973／6,729 ms。最大檔超過快取上限。PNG／JPEG／WebP 不重複 deflate，減少無益 CPU 工作。

同機瀏覽器單次 click-to-native-UI-ready：880／4,952／9,240 ms；舊流程紀錄1,060／6,229／11,049 ms。這是本機單次比較，未控制 NAS CPU／磁碟／LAN 或多次統計，不代表 NAS 效能承諾、視覺完整性或 DSM ACL live acceptance。三份來源 hash／mtime 保持相同，Pages／Layers／canvas 與唯讀流程通過。
