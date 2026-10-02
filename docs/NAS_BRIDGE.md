# NAS bridge：實作狀態與操作邊界

已實作 Portal → Unix socket → NAS broker 的即時身份、逐筆授權、stat 與內容串流通道。**DSM 本機帳號／有效 ACL 的 native adapter 尚未完成，正式環境仍拒絕存取。** tools/nas/native-adapter.example.py 是明確拒絕的介面範例，不是可用的 Synology provider。它沒有猜測 SYNO.API.*、解析未觀測的 CLI 輸出，或以 service UID 可讀性授權。

已知 DS1821+、DSM7.4.1-90080、Container Manager24.0.2-1706、DSM 本機帳號及員工不可自改 email 的政策。可信 directory 讀取入口、停用／身份重建識別、有效群組及 share／ACL schema 尚無實機證據。通道測試不能代替 native 行為。

## 實機帳號欄位觀測

操作員已提供目標 NAS 的 `synouser --help`，確認 `--get username`、`--getuid UID`、`--enum local` 存在。操作員隨後回傳遮蔽的 `--get` 輸出，已觀測字段：User Name、User Type、User uid、Primary gid、Fullname、User Dir、User Shell、Expired、User Mail、Alloc Size、Member Of，另有四行被遮蔽。所有值仍未知，尤其不能把 Expired 直接解釋為停用狀態，或把 Member Of 視為完整有效群組。帳號重建／generation 來源仍未知。

下一步由操作員手動執行下列唯讀查詢，將 `YOUR_DSM_ACCOUNT` 替換成自己的 DSM 本機帳號。只輸出冒號前的英文字段名稱，所有值與其他行都遮蔽；不列舉全體員工、不保存帳號紀錄。若工具回傳另一種格式，被遮蔽的行不能用來猜測 parser。

```sh
sudo /usr/syno/sbin/synouser --get YOUR_DSM_ACCOUNT | awk '
{
  colon = index($0, ":")
  label = substr($0, 1, colon - 1)
  gsub(/^[ \t]+|[ \t]+$/, "", label)
  if (colon > 0 && length(label) <= 48 && label ~ /^[A-Za-z][A-Za-z _-]*$/)
    print label ": [REDACTED]"
  else
    print "[REDACTED LINE]"
}'
```

此查詢只取得欄位格式；所有值均遮蔽，不能作為可信身份或存取權驗收結果。ACL 工具、有效權限、identity lifecycle 與 native adapter 仍待實機證據。

操作員另提供一個非主要帳號的完整查詢格式：值採 `[value]`；User Type 為 `[AUTH_LOCAL]`、Expired 為 `[false]`、User Mail 為 `[]`；Member Of 為 `[1]`，後接 `(numeric-gid) group-name` 一行。實際帳號名稱、UID、fullname、home path 與 group ID 不記錄。這確認單筆格式，不證明全部版本／停用／多群組格式，也不能由 `/sbin/nologin` 推論帳號已停用。空 email 不具備 Google email 對應條件。操作員另外確認非空 User Mail 同樣採 `[address]` 格式；真實範例地址不記錄。括號內完整 email 是待驗證的對應值，不由 username 推導，也不因看見該欄位就繞過 Google verified-email／hosted-domain／唯一啟用帳號與原生授權要求。有效群組閉包與帳號重建 generation 仍未知。

### 下一批唯讀觀測

只回傳 User Type 和 Expired 的值；其餘帳號、UID、email、群組與路徑不輸出：

```sh
sudo /usr/syno/sbin/synouser --get YOUR_DSM_ACCOUNT | awk '
/^[ \t]*(User Type|Expired)[ \t]*:/ { print }
'
```

ACL 工具尚無目標實機用法證據。以下只在兩個候選位置尋找可執行檔，無參數啟動以觀測其 usage；不傳入檔案、帳號或 ACL 操作。路徑及無參數行為尚待操作員結果確認：

```sh
for acl_tool in /usr/syno/bin/synoacltool /usr/syno/sbin/synoacltool; do
  if [ -x "$acl_tool" ]; then
    sudo "$acl_tool" 2>&1
    break
  fi
done
```

### 已觀測 ACL 查詢入口

操作員手動無參數執行 `/usr/syno/bin/synoacltool`，回傳目標 usage。確認 `-get-perm PATH USERNAME`（help 描述為 extract windows permission from ACL or Linux permission）、`-get PATH`、`-getace PATH` 與 `-check PATH [ACL Perm]` 存在。help 列出權限字元 `rwxpdDaARWcCo`，其中 r=read data、x=execute。這是查詢語法證據，不是完整使用者有效授權／共享限制／同物件開檔的驗收；不能以管理員自己的查詢結果授權其他帳號。

下一筆由操作員唯讀觀測已允許的 `/volume1/Gd`，USERNAME 使用操作員自己的 DSM 本機帳號：

```sh
sudo /usr/syno/bin/synoacltool -get-perm /volume1/Gd YOUR_DSM_ACCOUNT
```

只需回傳權限輸出與失敗訊息，若輸出含帳號／路徑，可替換為 `[USER]`／`[PATH]`。這個入口必須在指定 principal 下驗證群組／deny／繼承／祖先 traverse、share 限制與安全 descriptor 讀取；不解析 `-get` ACE 列表自行猜測完整有效權限。不得使用 help 中的 add/replace/del/copy/set/utime 操作診斷正式来源。

### 指定使用者的權限輸出與格式解析器

操作員回傳 `/volume1/Gd` 的 get-perm 結果，觀測完整順序：ACL version1、Archive flags、Owner、逐筆 ACE（含 level）、User/Group、Final permission。此次指定帳號包含 administrators；Final permission 為 `[rwxpdDaARWc--]`。root ACL 中的 users allow ACE 包含 r/x。操作員隨後使用先前查過的非管理員帳號重做同一 root 查詢，User/Group 僅列 users，Final permission 同為 `[rwxpdDaARWc--]`。這已觀測非管理員 root 查詢結果，但沒有實際以該帳號開檔或證明子檔案、祖先、share／服務限制；不能推論所有使用者／內容可讀。

新增 `tools/nas/dsm_query_format.py` 純格式函式 `parse_account(bytes, expected_username)`／`parse_permissions(bytes, expected_username)`。它不執行 CLI、不讀來源、不提供 ready／authorized／enabled／generation，不接入 blocked adapter。固定錯誤不回顯私人輸出；限制64KiB／UTF8／行數／欄位／群組數，核對 expected username、帳號類型、布林與數字格式、Member Of 數量、ACE 編號與權限字元位置、唯一 final permission。以 native final mask 作為觀測值，不從 ACE 自行算有效權限。未知格式拒絕，未驗證的多群組／true 分支只有合成測試，不宣稱實機通過。

格式 unit tests 及 CI：`python3 tests/nas/test_dsm_query_format.py`。它不是可部署的 native adapter；生命週期／停用語義／有效群組／祖先與 share／同物件授權開檔仍待完成。下一筆可用操作員已查過的非管理員帳號，對同一 root 做 get-perm，無需列舉／修改全體帳號。

### 非 root Docker-only 路徑評估

操作員詢問能否僅在 Docker 查詢。2026-10-02 再次查閱 [官方 File Station API guide](https://global.download.synology.com/download/Document/Software/DeveloperGuide/Package/FileStation/All/enu/Synology_File_Station_API_Guide.pdf)：API workflow 頁6–7 以登入後的 SID 發請求；頁27／33 的 perm.acl 為該 logged-in user 的 read/list／exec/traverse 資訊，頁27 還有 share 的 disable_list／disable_download；頁65 的 CheckPermission 只有已登入使用者的 write 查詢，不能虛構 arbitrary-user read 方法。

非 root Web 容器可以經 HTTPS 使用 DSM API，但代表各員工查詢／取內容的候選方式須取得每位員工自己的 DSM session，並由 File Station 在同一使用者 session 下執行 list/read。固定 admin 或 service session 不能代表 Google 登入者的 NAS 存取權。此路徑需要額外 DSM 身份/session 整合、撤銷與同一帳號讀取驗收；不是既有 Google-only flow 的已實作替代，也未實機測試。沒有因這次詢問改登入流程或啟用新 provider。

若保留 Google-only 與非 root 容器、不安裝 host helper，目前查閱的官方介面未建立可代表任意 mapped principal 的已驗證方案。不能僅把 synoacltool 複製進容器或使用 container/service UID 可讀性繞過這個身份邊界。

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
