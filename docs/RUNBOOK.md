# 維運手冊

正式服務尚未 ready。先閱讀 IMPLEMENTATION_STATUS／DEPLOYMENT；操作只在經批准的隔離測試環境進行，沒有自動 SSH 或帳號／ACL 修改。

## 健康與故障

`/health/live` 只表示 BFF process 活著；`/health/ready` 還要求 provider mode 相符、native ready、fresh directory、所有 root online。現在 strict 503 是預期的 hard gate。不要用修改環境／切 mock 的方式消除它。缺 OAuth/config 時 startup 拒絕；API 回 generic code，不暴露 host path。

來源失联／scan 失敗／root dev:inode 改變：API 統一 unavailable，SQLite 保留 metadata，停止取 bytes；確認實際 mount、NAS 狀態及新身份來源，不把空 mountpoint 當正常。恢復同一 root 可重新 scan；重建／重新掛載需管理員核對 baseline。不要刪整份 SQLite 以恢復服務，因為 identity lifecycle binding 也會消失。現版無自動 baseline 重設工具，需審查 migration。

`directory-unavailable`／`identity-review-required`：snapshot 超過五分鐘或 expiresAt、schema/來源信任／唯一 email、帳號 generation／啟用、Google sub/email 等。先維持拒絕；由管理員查可信 directory，人工審核異動。沒有自動 account creation 或 alias 正規化。

`source-changed`／短串流：來源被外部工具改寫，等 reconciliation 更新 revision 後重新點開。沒有自動存回／合併。`download-busy` 429：同 principal 已一個或全域滿；cancel／關閉頁面後重試。超限 FIG 不列、解析 timeout／格式失敗顯示錯誤；不禁用安全限制處理。

## Session 撤銷

管理員在 BFF host 私密 shell，使用**實際既有 state.sqlite**與可信 principal key（不是 email 推導）：

```sh
node --import tsx scripts/revoke-session.ts /absolute/private/state/portal.sqlite 'EXACT_PRINCIPAL_KEY'
```

此 CLI 只刪該 principal 的 sessions、記 audit，不重設 bindings、不改 NAS。最長一小時／idle 二十分鐘，snapshot 異常 API 會 revoke。Google 停用不能保證即時清理 Portal session，必要時手動 revoke。已載入 browser 的內容無法遠端抹除；登出換帳號移除目前 viewer，沒有 persistent document cache。

## Logs／backup

不要記 token、OAuth code、原 bytes、真實 path／完整未授權列表。audit 只記時間、opaque principal/file key、login/read/deny/revoke。SQLite 的 metadata/identity 仍具敏感性，state volume 0700，logs 輪替。現版 audit 沒自動 retention/purge，營運前需按公司政策設保留期與有測試的維護工具。

備份 SQLite 時停止單實例 BFF（維持 source mount RO），備份整個 state（含 WAL/SHM），或使用 SQLite 一致 backup API；不要只熱拷 sqlite 主檔。還原需核對 NAS instance/generation/root baseline，重新驗證 trusted snapshot。thumbnail 暫無 cache；未來 cache 可重建，不是原檔來源。禁止把 SMB/NFS 當 SQLite state volume。

## Upstream 更新／rollback

在獨立 update branch 調整 submodule commit 與 upstream.lock.json，先讀新 upstream ownership guides。保持官方 submodule pristine；owned packages 及 patches 在外層。`prepare-upstream` archive→checked patch→copy adapter→frozen install，不讀 moving branch。

更新後必跑：native smoke、package/type/build、adapter commands/graph、valid FIG render、browser network/persistence/readonly、所有適用 live ACL、Docker mount／大檔。失敗留舊 SHA／image，不自動更新版本／部署。升級 readonly allowlist 逐函式 review；新增 mutator 預設拒絕。patch 更新只改 source diff，不能搜尋替換 compiled JS。

Rollback 用最後驗證的 immutable image digest 與匹配 config/state schema，先備份 state；保持 strict/read-only。沒有 production rollout 或可宣稱的 rollback 演練結果。不要以 rollback 解鎖 filesystem fallback。
