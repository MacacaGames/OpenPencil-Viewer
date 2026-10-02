# NAS 身份與 ACL 驗收矩陣

適用範圍：本交接包的唯讀 Synology LAN Portal；本檔是測試規格，**不是已完成的驗證紀錄**。

## 1. 環境與證據

使用隔離測試 root、合成 `.fig`、普通帳號 A/B 及受控測試管理者。不在正式設計目錄上測試權限變更、刪檔或惡意檔案。

先記錄：NAS/DSM/kernel、Container Manager、filesystem、ACL 模式、directory 來源、upstream SHA、Portal commit、authz provider/version、測試時間。任何 OS/API/CLI 結果要去除 token、密碼及真實員工資料。

比較基準是**同一使用者**在目標 NAS 的有效行為，不是 administrator session。Portal 可有更保守的 root 範圍；但任何比 NAS 允許範圍更寬的結果均視為失敗。只支援的 identity/ACL profile 才可上線，不能由 local-user 測試推論 LDAP/AD 也正常。

證據至少包括：授權設定截圖或去識別化輸出、A/B 實際 NAS 行為、Portal API 結果、UI 結果、thumbnail/content 是否取得、負向測試及時間戳。Mock、live、未測三類分列。

## 2. 身份測試

| ID | 情境 | 預期 |
|---|---|---|
| I01 | 已驗證公司 Google email 唯一匹配啟用 NAS account | 建立受審計綁定，仍需逐檔授權 |
| I02 | Google hd 不符或 email 未驗證 | 拒絕，不建立 session/mapping |
| I03 | NAS 沒有該 email | 顯示未匹配，不猜 email 前綴 |
| I04 | NAS 兩個帳號有相同 email | 拒絕，要求管理員修正 |
| I05 | NAS 帳號停用/刪除 | 拒絕；現有 session 按已定義刷新時限撤銷 |
| I06 | 普通 NAS 使用者可更改自己的 email | 不允許以未經批准的欄位取得新的身份綁定 |
| I07 | 原 email 出現不同 Google sub | 不靜默承接舊 principal；要求審核 |
| I08 | NAS UID/username 被刪除後重用 | 不視為原綁定仍有效 |
| I09 | email alias、+tag、點號變體 | 不推測等價；依管理員明確政策 |
| I10 | directory source 過期/超時/schema 改變 | fail closed，不切成 allow-all |
| I11 | mapping 到 admin/root/system user | 預設拒絕，不取得管理員 fallback |
| I12 | 帳號 A 登出後帳號 B 登入同瀏覽器 | 不顯示 A 的 cache、最近檔案或內容 |

## 3. 檔案權限測試

| ID | NAS 情境 | Portal 預期 |
|---|---|---|
| A01 | A 對 root 和檔案可讀；B 不可讀 | A 可列/開，B 無名稱、metadata、縮圖、bytes |
| A02 | 群組允許，但個人明確拒絕 | 不因群組允許而繞過個人拒絕 |
| A03 | 父目錄允許，子檔明確拒絕 | 子檔不回傳，猜 id 也失敗 |
| A04 | 中間目錄不可 traverse | 不能開後代文件 |
| A05 | 可 traverse 但不能 list | 不列同層內容；本 Portal 採需可導航的保守策略，拒絕穿越此目錄的 direct file URL，並記錄此策略比 NAS 可能更嚴格 |
| A06 | 非繼承 ACL 的單一文件 | 不套用不適用的父目錄快取 |
| A07 | 群組新增／移除，使用者已登入 | 在已定義 policy refresh 時限內更新；不 indefinite cache |
| A08 | 共享層無存取或進階禁下載 | 不因本地 service UID 可讀就放行；未知規則拒絕該來源 |
| A09 | API 的 administrator session 可讀，使用者不可讀 | Portal 仍拒絕；證明未用 admin ACL 判定 |
| A10 | 已開過檔案後撤銷權限 | 新請求/thumbnail/cache validation 不再放行；不宣稱能回收先前 bytes |
| A11 | 猜 fileId、HEAD、搜尋總數、thumbnail key | 不洩漏存在性或其他使用者資料 |
| A12 | helper 無回應或 native ACL parser 失敗 | 服務不可用/拒絕；無快速路徑繞過 |
| A13 | symbolic link 指向 root 外或在檢查後被交換 | 不讀取 root 外內容 |
| A14 | 來源被卸載、scan 失敗 | 標示離線，不清空原索引並誤稱沒有檔案 |
| A15 | 同名 .fig 在另一個 root | 不混用身份、權限或內容 cache |

## 4. 唯讀與資料路徑

| ID | 測試 | 預期 |
|---|---|---|
| R01 | file PUT/PATCH/DELETE、rename/upload | 無可用 route 或明確拒絕 |
| R02 | container 對原檔嘗試寫入 | RO mount／權限拒絕，不改檔 |
| R03 | Cmd/Ctrl+S、paste/drop、delete、node drag、文字輸入 | 不修改設計 graph、不發背景 Save |
| R04 | 停用 UI 後直接呼叫 command | command/capability 層仍阻擋 |
| R05 | 前後原檔 hash、size、mtime | 相同；不把讀取造成的 atime 變化當寫入 |
| R06 | 公開 P2P、AI、MCP、雲端 storage | 沒有對外文件內容請求 |
| R07 | 列出數千份 .fig | 列表不下載全部 `.fig` 本體 |
| R08 | 使用者取消下載 | reader/HTTP pipeline 釋放資源 |
| R09 | 切換文件/登出/換帳號 | 清理舊 UI、memory/object URLs，不留跨身份持久草稿 |
| R10 | 來源文件正由其他工具改寫 | 可偵測的變更拒絕本次結果並提示重載；對未能保證原子讀取的限制做明確記錄 |

## 5. 通過條件

所有適用測試有 live 證據；不適用項目標示原因與支援範圍；未驗證的 DSM profile 不提供正式資料。任何越權或來源檔案被寫入是 release blocker。

若 native/bridge 方案在 NAS 上無法證實安全，交付可用 Mock 與受控測試 profile，維持正式 `dsm-strict` readiness 失敗；不得自動把正式模式改成 root-allowlist。
