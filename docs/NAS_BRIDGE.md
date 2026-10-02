# NAS bridge：實作狀態與操作邊界

已實作 Portal → Unix socket → NAS broker 的即時身份、逐筆授權、stat 與內容串流通道。**DSM 本機帳號／有效 ACL 的 native adapter 尚未完成，正式環境仍拒絕存取。** tools/nas/native-adapter.example.py 是明確拒絕的介面範例，不是可用的 Synology provider。它沒有猜測 SYNO.API.*、解析未觀測的 CLI 輸出，或以 service UID 可讀性授權。

已知 DS1821+、DSM7.4.1-90080、Container Manager24.0.2-1706、DSM 本機帳號及員工不可自改 email 的政策。可信 directory 讀取入口、停用／身份重建識別、有效群組及 share／ACL schema 尚無實機證據。通道測試不能代替 native 行為。

## Portal 設定

保留既有 config.json；新增 nasBridge JSON object，或使用下列完整環境變數組。來源互斥、缺項拒絕啟動。這是 native 驗收完成後的設定，placeholder 不可直接部署。

```yaml
environment:
  NAS_BRIDGE_SOCKET: /run/openpencil-bridge/bridge.sock
  NAS_INSTANCE_ID: replace-with-verified-stable-nas-instance
  NAS_PROVIDER_ID: replace-with-verified-native-provider-revision
  NAS_ACCEPTANCE_SHA256: replace-with-sha256-of-reviewed-live-evidence
volumes:
  - type: bind
    source: /run/openpencil-bridge
    target: /run/openpencil-bridge
    read_only: true
    bind: { create_host_path: false }
```

Socket 父目錄為 root-owned、不可 group／other write；socket 為 root:10001、0660，Web 保持 UID10001。client 檢查 owner／mode／symlink，helper 用 Linux SO_PEERCRED 檢查 UID10001。父目錄 RO bind，不掛 Docker socket、帳號資料庫或整個 volume。Unix 權限仍需在 DSM ACL／bind 環境確認，不以 chmod 改既有來源 ACL。

設定 bridge 後只接受其 native-dsm directory；過期、失聯、schema／實例／provider／evidence digest 不符均拒絕，不讀 directory.json fallback。未設定 bridge 的舊部署保留 admin-approved JSON 行為，strict gate 仍拒絕。NAS_TEST_ROOT 仍是 probe／既有 Compose source 參數，不是 native 授權設定。

## Helper 與 adapter

tools/nas/bridge.py 需要 Python3.9+、Linux Unix socket／peer credentials／fork。正式 config、broker、adapter、acceptance 及其父目錄為 root-owned、不可 group／other write、無 symlink。讀取有大小與變動檢查；adapter 執行已檢查的 bytes，不重開路徑／寫 .pyc。每次操作核對 code/config、root identity 與驗收 profile。

[nas-bridge.example.json](../deploy/nas-bridge.example.json) 使用操作員允許的 /volume1/Gd。helper 不建立來源、修改帳號／ACL，限制16個 child、每次30秒、request16KiB、JSON4MiB，沒有 Web port、shell、任意 command 或 local open fallback。

| Adapter 方法 | native 實作要求 |
|---|---|
| profile() | 已觀測 dsmVersion／directorySourceId／authorizationSourceId、identityLifecycle／effectiveAcl／shareRestrictions／sameObjectRead；未知或 false 都拒絕 |
| directory() | 即時可信 principal、enabled、管理員控制的唯一 email、有效群組與可靠 generation；DirectorySnapshot，source=native-dsm |
| authorize(principal, target) | 該 principal 的祖先 traverse/list、目標 list/read、共享／服務限制；未知拒絕，admin API 不能代替 |
| open_authorized(principal, target) | context manager 回傳 (filefd, rootfd)；核對 live principal／generation，在同一 pinned object 上 native 授權及 RO 開檔；降權 worker 正確設定 supplementary groups 並不可回升 |

Caller 只提供 instanceId、principalKey、generation、rootId、rootIdentity、relative、kind、size、revision、maxFileBytes，沒有 caller UID／username／groups／host path。adapter 重新解析 native credentials。broker 核對 live 身份及 descriptor 的 root identity、dev／inode／size／mtime／ctime、regular／single-link／RO mode。**root confinement、mount／symlink race 和 DSM native 授權仍由 adapter 實作並驗收；broker 不開本機路徑 fallback。**

內部 Unix HTTP POST 操作只有 /status、/directory、/authorize、/stat、/read。read 為一行 JSON descriptor header 加 bytes；Portal 核對 principal／generation／root／relative／size／revision、限制長度與 timeout、支援取消，最後一塊延至完整性確認才送出。已傳 bytes 無法追回；進行中撤銷延遲以30秒 operation 上限及實機驗收為準。

## 啟用證據

[nas-acceptance.example.json](../deploy/nas-acceptance.example.json) 刻意空白且過期，不能啟用。native adapter 完成後，操作員可手動取得 profile：

```sh
python3 /opt/openpencil-bridge/bridge.py --config /opt/openpencil-bridge/config.json --profile
```

命令不生成 passing evidence；blocked adapter exit2。profile 綁定 NAS instance／provider、OS／kernel／architecture、broker／adapter SHA256、native source／能力、root identities 與檔案上限。acceptance 必須 kind=live-nas、profile 完全相符且未過期，包含 [ACL矩陣](../ACL_ACCEPTANCE_MATRIX.md) 的37個 I/A/R case 各一筆 {id, passed: true, evidenceRef}，附獨立可審查的 live 證據。缺項、重複、failed、synthetic、過期或 profile 變更均拒絕。root-owned artifact 是管理員驗收聲明；程式不會證明 evidenceRef 的測試內容或製造通過結果。

Portal NAS_ACCEPTANCE_SHA256 固定為核准檔的 SHA256。development helper 只接受 synthetic evidence 與 /tmp、/private/tmp、.work 合成 roots；正式 helper 不接受 synthetic。Portal 只有 loopback Mock 開發設定能使用 synthetic；Google／production 拒絕。

驗收完成後才由操作員配置 host service、啟動 helper、確認重啟／owner／socket stale 行為。helper 不盲目 unlink 既有 socket，沒有自動安裝、SSH、service 配置或 NAS ACL 變更。

## 本機驗證

python3 tests/nas/test_bridge.py 與 npm test 的 fixture／synthetic artifact 只驗證橋接邊界。CI 已加入 broker 檢查；Linux socket／peer credentials／fork 路徑以 Docker 合成環境驗證。完整 test／typecheck／upstream／build／browser 結果及未完成事項見 [IMPLEMENTATION_STATUS](IMPLEMENTATION_STATUS.md)。
