# Google Workspace OIDC 設定

程式已實作，**真實 Google 正常登入已驗證**（2026-10-02，見 IMPLEMENTATION_STATUS 的去識別化 audit 時間）。NAS snapshot 未就緒，callback 預期 directory-unavailable，沒有 Portal session／NAS grant。dsm-strict 尚未實作有效 DSM 授權；真實負向／停用測試仍待 NAS acceptance。

1. 在組織管理的 Google Cloud project 建 OAuth consent screen；依公司政策使用 Internal，建立 Web application OAuth client。
2. 選公司控制的正式 DNS，例如 `design.corp.example`，內部 DNS 解析至 NAS／代理私有 IP；配置員工信任的 TLS 憑證。沒有公開 inbound 的需求仍需實測 Workspace policy、split DNS 與回呼。
3. 精確註冊 `https://design.corp.example/auth/google/callback`。`config.origin` 要完全相同的 scheme/hostname/port，沒有 path 或結尾 `/`。正式 profile 不接受 HTTP。
4. 本次 `PORTAL_ORIGIN=https://openpencil.macaca.games`、`GOOGLE_HOSTED_DOMAINS=macaca.games`。Google Web application client JSON 掛到 `/run/secrets/google-oauth.json`，設定 `GOOGLE_OAUTH_FILE`。程式驗下載檔有精確 callback，拒絕 service-account／installed client，忽略可自填 endpoints；不把 secret 放 `VITE_*`、repository 或前端。舊的 server-only `GOOGLE_CLIENT_ID`／`GOOGLE_CLIENT_SECRET` env 方式仍支援，但不能和 JSON 同時使用。參考 OPERATOR_HANDOFF 與 `.env.example`。
5. 先使用隔離 NAS root、經管理員批准且有期限的 directory snapshot，完成 M0／M3 後才能對正式文件放行。不得把 email suffix、login hint 或自填 NAS username 當驗證。

`GET /auth/google/start` 建 state、nonce、S256 PKCE；state 哈希存 SQLite，與 HttpOnly browser proof cookie 綁定且五分鐘到期。callback 消耗一次 state 後換 code，驗 Google RS256 signature、iss、aud、exp、iat、nonce、email_verified、hd。issuer 正規化為 `https://accounts.google.com`，永久身份鍵 `(iss,sub)`。

僅要求 `openid email profile`，沒有 Drive、Directory、offline access 或 refresh token。換 token 只走固定 Google endpoint，token 不回前端、不記錄、不保存。Google JWK 取得與 code exchange 是 BFF 外連；editor 的 connect-src 限本來源，字型／WASM／workers 由 LAN 自架。

Session 最長一小時、idle 二十分鐘；HTTPS 用 `__Host-portal`、Secure、HttpOnly、SameSite=Lax。logout 需 exact Origin 與 CSRF header。每次 API 重新檢查 NAS identity generation／啟用／snapshot freshness；新 sub、email 異動、NAS 身份重建或重複匹配都需人工審核。Google 帳號停用不保證立即撤銷既有 Portal session，管理員可依 RUNBOOK revoke。

實機驗收：正常登入、錯誤 Workspace、未驗證 email、nonce/state 重放、錯誤 browser proof、callback URI、TLS、帳號 A→B、Google 及 NAS 停用、snapshot 過期。結果逐項寫入 IMPLEMENTATION_STATUS；本機 RSA 簽署 token 測試只代表 verifier 負向測試。

依據：[Google OpenID Connect](https://developers.google.com/identity/openid-connect/openid-connect)、[Web server OAuth 與 redirect URI 規則](https://developers.google.com/identity/protocols/oauth2/web-server)。沒有宣稱 air-gapped。
