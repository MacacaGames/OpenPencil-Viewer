# Implementation status — OpenPencil × Synology LAN Portal

Updated **2026-10-02 Asia/Taipei**. Local/mock evidence is distinct from live acceptance. The goal remains **blocked for formal NAS release**, not complete. No production deployment, SSH, NAS account/ACL changes, Drive API, NAS writes or second-stage editing occurred.

| Milestone | Actual status |
|---|---|
| M0 | Upstream audit/native boot + metadata-only probe delivered; live NAS capability blocked |
| M1 | **Local acceptance passed**: A/B lists → double-click FIG → complete native readonly UI |
| M2 | Real Google positive OIDC verified through user HTTPS proxy; trusted NAS mapping/live negative cases pending |
| M3 | **Blocked**: no validated native DSM effective-access/read broker; strict provider always rejects |
| M4 | Streaming/cancel/index/revision/limits + raw transport + three approved real FIG native browser loads pass; GPU memory/fidelity/NAS/LAN pending |
| M5 | arm64 and amd64 images built, container RO/confinement tested, portable exports delivered; HTTPS staging running; CI/NAS release pending |

## Preservation and source pin

Target initially held only DEVELOPMENT_PLAN.md and ACL_ACCEPTANCE_MATRIX.md, with the correct Synology title; there was no Git or AGENTS.md. Both handoff files retain their original paths/content. Created project Git + AGENTS. Sibling OpenPencil-GDrive had substantial staged/unstaged/untracked user work and was untouched. Reused bounded FIG validation and isolation/native composition ideas; no Drive auth/scopes/writeback/leases/drafts copied. The final FIG fixture is our own exported two-page blue rectangle/red circle, reproducible with `npm run fixture:create` after preparation.

Official submodule **0.15.1 / 8c72b62da07ea1f7e82de84c7c837c3c78dfbf95** is pristine. Initial local clone transport was replaced by official .gitmodules/origin URL; exact SHA detached. Root/src/core/scene-graph/vue/fig ownership guides read. Prepare archives tracked source, discards old disposable source while retaining package cache, checks/applies source patches and copies owned adapter; no compiled string patches or upstream commits. Removed-source marker test confirms no stale build source survives.

Actual native boot in `.work/native` observed two canvases and Pages/Layers/Design/Code/AI. Native MCP/port7600 attempts were observed and deliberately excluded from Portal. Task-owned native audit process and MCP child were shut down. Sibling services were not stopped.

## M0

Deliverables: UPSTREAM_AUDIT.md, UPSTREAM_ADAPTER_ADR.md, SYNOLOGY_CAPABILITY_AUDIT.md, AUTHORIZATION_ADR.md, NAS_PROBE.md, `scripts/probe-nas.py`. Probe only metadata/aggregate redacted counts, mount/command availability; no subprocess, network, impersonation, account/password database or source bytes. `dsm_strict_ready` is always false.

Actual `python3 scripts/probe-nas.py --self-test`: **13 PASS**. Missing-root invocation returned exit 2 / root_unavailable; `--help` exit 0. No NAS execution. Blocked: authorized isolated NAS, exact DSM/kernel/filesystem/directory profile, trustworthy email provenance and same-user File Station/SMB A/B baseline are unavailable. Command presence is not ACL equivalence.

## M1

Implemented mock identity/ACL A/B, exact trusted unique email binding + lifecycle checks, SQLite sessions/bindings/metadata/audit, root-scoped opaque paths, ancestor list/traverse/read policy, all list/search/metadata/thumbnail/GET+HEAD content checks. Unknown/unauthorized IDs are 404; source/provider unavailable checked uniformly before ID lookup. No design write API. Thumbnail is authorized 404/unavailable; first UI uses file/folder rows without derived previews.

Metadata-only bounded periodic reconciliation, regular single-link FIG filter, pinned no-follow descriptors, revision/size checks, cached root identity persisted across restart, retained offline index and refused empty replacement root. Linux reader adds O_PATH pre-I/O type validation + same-descriptor proc reopen and fdinfo mount-id rejection for same-filesystem bind mounts. Those Linux paths now pass Docker Desktop arm64 + emulated amd64 synthetic tests; **DSM remains untested**. macOS implementation is synthetic development only. The reader is not a DSM authorization broker.

Native PortalWorkspace composes upstream tabs/session/EditorWorkspace and true parseFigFile/applyImportedDocument. All pages prepared before graph lock. Default-deny Core/app facade and Vue command.run; nested design proxies/map guards; pre-lock node references detached; view fields remain render state. Native selected-node inspection clones independent values, including shallow Core copies whose nested fields are proxies. Select/zoom/pan/pages/Design+Code remain native. Property edits/code live preview/drawing/drag/text/delete/paste/drop/undo/redo/Save are blocked. No recovery document IndexedDB, autosave/outbox, SW, public P2P, AI/MCP runtime or remote font/library fetching. CSP restricts content traffic to same origin.

Actual final local validation uses **Node 22.23.3**, Bun **1.4.2**, Python **3.9.6**, Chromium (Playwright **1.63.0**). Earlier host Node 26 runs were superseded by pinned Node tests. Node archive was SHA256 checked against its official release checksums; runtimes installed only under ignored .tools.

| Command actually run | Result |
|---|---|
| `npm test` | **24 PASS, 0 FAIL**; API, JWT/mapping/session/config/mounted OAuth JSON/FIG safety/download/filesystem/restart/real localhost HTTP cancel |
| `npm run test:adapter` | **3 PASS, 0 FAIL, 54 expect assertions**, actual patched Core/SceneGraph/Vue commands + selected inspector copies |
| `npm run test:e2e` | **2 PASS / 28.1 s** with operator fixture opt-in: A/B + native two-page readonly/network/persistence/logout; all three approved real FIG browser loads |
| `npm run typecheck` | PASS |
| `npm run typecheck:editor` | PASS |
| `npm run build` | package artifacts + Vite production + BFF PASS; final isolated rebuild/marker cleanup verified |
| `npm run verify-upstream` | PASS exact SHA, pristine source, official origin/.gitmodules |
| `npm run format:check` | PASS owned source/config formatting |
| `git diff --check` | PASS |

Browser screenshot `.work/portal-native.png` visually inspected: two pages, layers, selected blue rectangle and native x/y/width/height/fill/stroke/effects properties, readonly header. Final E2E **1 PASS / 6.6 s** validates page 2 circle → page 1 rectangle, no pre-open content downloads, one content request per opened file (A then Shared: two total), source hash/mtime unchanged, no external HTTP/WS, document DB or SW, no old A canvas after B login or browser back history. pagehide disposes the editor and clears DOM; BFCache pageshow reloads to reauthorize. Fresh expected 401 no longer shows an expired-login alert; readonly header identifies source/loaded state. Canvas comparison restores selection because selection guides are legitimate view changes. Screenshot/video/trace contain only synthetic data; trace/video disabled. An absent document-title locator during the strengthened history assertion was corrected to count only A-specific titles; no privacy assertion was removed.

Real failures found and repaired: wrong testId selector; eager recovery DB creation despite disabled recovery; clone(proxy)/nested-proxy inspector error; pointer guard inserted too broadly; lazy stream destroy leaked child/listener; growing file exceeded advertised length; unbounded ignored scan entries; offline ID response difference; metadata loss/baseline reset on offline restart; multiline Vue event expressions after formatting. Each final check passes; earlier failures are not counted as successful acceptance.

Build emits upstream optional WebGPU vendor/LFS asset missing warnings, large chunks/dynamic-import/plugin timing warnings. Local standard CanvasKit WASM/WebGL works. No WebGPU or arbitrary FIG fidelity claim.

## M2

Google Authorization Code + one-time browser-bound state, nonce, S256 PKCE, fixed token/JWK endpoints, RS256 signature/iss/aud/exp/iat/azp/nonce/email_verified/hd, canonical `(iss,sub)`, exact callback, scopes only openid/email/profile, no offline/Drive/Directory token storage. Bounded token response, timeout, token discard. Own HttpOnly/Secure/SameSite session one-hour max/20-minute idle, Origin+CSRF logout, rotate/revoke, admin revoke CLI. Directory freshness/unique trusted email/disabled/system/lifecycle/new subject all fail closed every API.

**Real positive Google OIDC now passed**. User provided a Web OAuth client JSON with exact callback, confirmed hd `macaca.games`, and configured nginx HTTPS → `10.0.1.31:24681`. Operator completed Google login and reported `directory-unavailable`. Read-only audit query confirmed `oidc-verified` at **2026-10-02 04:31:40.418 and 04:32:04.217 UTC**, with **0 Portal sessions**. The phase is recorded only after exchange + signature/claims/nonce/hd verification, without email/token. Directory failure is expected; no fake NAS identity or file grant was created. Real negative Workspace/disable cases and **trusted NAS mapping remain unrun**. NAS snapshot provenance/live refresh unresolved; admin-approved JSON is explicitly not live directory sync. No Secure LDAP subscription or account-system changes.

New runtime loader supports RO-mounted Google Web client JSON (`GOOGLE_OAUTH_FILE`) and `PORTAL_ORIGIN` / `GOOGLE_HOSTED_DOMAINS` environment overrides. Bounded regular/no-follow JSON reads, exact callback, no installed/service-account JSON, no credential-source ambiguity, no JSON-defined endpoints or secret-bearing parser errors. Legacy server-only client-id/secret env supported independently. Original secret file chmod 0600; private mounted copy is 0444 under a 0700 parent. Credentials are Git/context ignored, not in runtime/static assets or release exports. `config:check` validates without creating sessions/index, exits 2 while strict native gate remains blocked.

## M3

Typed provider contract + DsmStrictAuthorization remains ready=false/canRead=false. Production config requires HTTPS+Google+dsm-strict, unknown fields reject. No fallback to admin/service UID/root allowlist. `npm run test:nas` actually returned **exit 2 / BLOCKED**, as required; no empty/mock evidence promoted to live.

Effective DSM evaluator, identity/lifecycle source, same-object auth/read helper, supplementary groups/Windows ACL/advanced share semantics and all applicable live I/A/R matrix cases await the authorized NAS. Linux confinement changes do not satisfy these ACL requirements.

## M4

HTTP backpressure/cancel/progress, per-principal 1/global configured slots, bounded worker preflight/decode and no main-thread fallback, revision detection, offline/restart retention delivered. Local HTTP cancel releases slot and next file reads successfully. A fresh 1000-file metadata list loads no document bodies. Current index is periodic reconciliation; **no incremental watcher or thumbnails**.

Actual `npm run benchmark`: synthetic sparse 50/200/500 MiB raw bytes exactly read, metadata scan 1004 records / **52.8 ms**. First-byte **38.3/36.3/37.6 ms**, parent peak RSS **115.3/117.5/125.0 MiB**. Data copied to performance.local.json/PERFORMANCE.md. User subsequently authorized sibling `test_files` as RO fixtures. All three (**167,558 / 9,108,449 / 409,977,351 bytes**) passed Linux container pinned reads, matching host hashes/size/mtime before/after on arm64 and emulated amd64. The test never attempts a write on supplied files; only synthetic files are used for write-denial tests. No changes to sibling source/project.

Actual Bun `tests/adapter/inspect-fixture.ts` on each approved original: bounded ZIP/Kiwi safety → native `parseFigFile(populate:all)` → graph readonly lock → hash/size/mtime unchanged. Smallest **1 page / 322 nodes**, 9 MiB **1 / 378**, 391 MiB **3 / 1,586**. Large safety **2,599.4 ms**, native parse **302.1 ms**, process peak RSS **1,843.2 MiB**. These are headless format/graph checks, **not browser layout/GPU/fidelity or LAN/NAS disk measurements**. Results in performance.fixtures.local.json, without design names/bytes. The later opt-in browser run passed these three files (details below); NAS performance/GPU memory/fidelity remain pending. 512 MiB is a bound, not a universal practical browser capacity. In-progress read is not atomic and already sent bytes cannot be reclaimed.

## M5

Delivered Dockerfile pinned runtimes/base manifest digest/fixed official source, explicit build source allowlist, native BUILDPLATFORM compiler + target runtime, JS-only production dependencies, runtime non-root, RO same-NAS compose with single JSON mounts/domain env, explicit blocked Unraid profile, strict example config/expired directory, LAN nginx example, .env.example, synthetic and approved-fixture container tests, portable release exporter, GitLab verify + protected/manual image/live gates. README + GOOGLE_SETUP/DEPLOYMENT/TESTING/PERFORMANCE/RUNBOOK/OPERATOR_HANDOFF complete. CLI revoke only own session DB, no NAS mutations.

Actual Docker Desktop **4.93.0 / Engine 29.8.1**, Compose **5.5.1**, buildx **0.37.1**, Linux/arm64. `docker build --platform linux/arm64` and `linux/amd64` PASS. `tests/container/readonly.sh` PASS on both; RO original/rootfs + non-root + traversal/symlink/hardlink/FIFO/nested-mount negatives + JSON/domain config + strict readiness 503. `tests/container/fixtures.sh` PASS on both; three original files unchanged. `docker compose --env-file .work/operator-compose.env -f deploy/compose.synology.yml config --quiet` PASS. `sh -n` both scripts PASS; Python compile uses ignored .work cache. No privileged Web or socket/password mounts.

Current exact image IDs:

- arm64: `sha256:95e67bf39e01c10d442496b08f43761ef872d30dd2cb46abd5130bba77080733`
- amd64: `sha256:e0bb19cb886208b9e4757aaed0b12cc561f992e9e0147fcf41f2de7a7bd56b7a`

Running **staging only**: `openpencil-lan-staging` on `10.0.1.31:24681`, user HTTPS origin `https://openpencil.macaca.games`. RO mounts of explicitly approved test_files + three JSON files; dedicated staging SQLite volume initialized separately. /health/live 200, /health/ready 503, /auth/mode google-oidc, native HTML/CSP self, OAuth redirect exact callback + identity-only scopes + S256 + Secure cookie all verified through HTTP upstream and HTTPS nginx. Docker `unhealthy` is expected while readiness is blocked. No real NAS root is mounted and no document session exists.

Actual `npm run release:export -- openpencil-lan:0.1.0-arm64` and `-- openpencil-lan:0.1.0-amd64` PASS. Public deployment bundles at `.work/releases/arm64-95e67bf39e01/` and `.work/releases/amd64-e0bb19cb8862/`: image.tar, public templates/docs/probe/tests, manifest and SHA256SUMS. No actual OAuth JSON, SQLite, supplied FIGs or private .work config copied. Manifest keeps releaseReady=false. Transfer/import/hash commands in OPERATOR_HANDOFF; target DSM import is still unrun.

**GitLab runner, real NAS RO/kernel/ACL/reboot, LAN-only firewall policy and formal release NOT RUN**. Formal roots must not be served yet. NAS evaluator/bridge is still unimplemented, not merely missing a configuration value. User explicitly deferred ACL validation to NAS; no fallback was enabled.

## Next steps requiring external evidence

1. Operator runs NAS_PROBE manually on an approved isolated NAS test root and supplies redacted capability + same-user A/B baseline/email trust policy.
2. Implement the supported native directory/effective-access/descriptor bridge from that evidence; keep strict hard gate until all applicable live matrix cases pass.
3. Real positive Google/HTTPS is complete; run real negative/disable cases and trusted NAS mapping with the native provider.
4. Run Docker synthetic + actual same-NAS RO/network/reboot acceptance, representative large valid FIG measurements, protected CI and internal release review. Only then expose formal documents.

Current persistent test service is HTTPS staging above. No separate loopback Mock server is left running; `npm run dev:mock` starts synthetic local acceptance when needed. Overall formal NAS goal remains **blocked**; staged deployment artifacts do not bypass M3.

## ApeRelay deployment alignment and final native fixture validation

Read-only reference: `git ls-remote https://github.com/macacagames/aperelay.git HEAD`, `git clone --depth 1 ... .work/references/aperelay`; commit **fba03f4869d802fcc54d5b378dd58d5c4d3d0b0f**. Inspected README, QUICK_START, .env.example, root Compose/Dockerfile and .github/workflows/ghcr.yml. Web fetch returned cache miss; Git transport succeeded. Reference files unchanged.

Added root `docker-compose.yml` extending the audited Synology service, root QUICK_START, DEPLOYMENT_CONVENTIONS, and `.github/workflows/ghcr.yml`. Actions verify frozen dependencies/native UI/graph/API/browser, build and test arm64/amd64 synthetic RO images, push only already-tested images for non-PR events, assemble GHCR branch/version/SHA/latest manifests from checked digests. No deployment job or automatic package visibility change. No Google/NAS secrets given to CI. GitLab definition retained. Repository had no remote at this stage; GitHub runner/GHCR publication NOT RUN. Operator instructions specify company repository, Actions/Packages rights and host-only registry read credentials.

Actual `docker compose --env-file .work/operator-compose.env -f docker-compose.yml config --quiet` PASS; JSON comparison of resolved portal service against deploy/compose.synology.yml identical. YAML parse PASS; official **actionlint v1.7.12** binary checksum verified, `actionlint -shellcheck= .github/workflows/ghcr.yml` PASS (ShellCheck not run). Formatting includes root Compose/workflow.

Opt-in real FIG browser test initially failed because `*` glob missed content; corrected to `**`. Playwright base64 fulfilment then exceeded V8 string limit for 391 MiB; replaced with a short-lived unpredictable-path localhost streaming endpoint. Test routes substitute approved bytes/metadata only for native browser validation, NOT NAS authorization. Captures/trace/video disabled for real documents. Small FIG uncovered a native variables watcher TypeError after graph lock: Core/app guard had denied read-only variable queries. Reviewed pinned variables implementation and added explicit read-only query allowlist; values/collections remain graph-protected, mutations still denied. Added actual Vue reactive panel regression with variables and nested modification attempts. No upstream source edits.

Actual final commands:

- `npm test`: **24 PASS / 0 FAIL**. First sandbox run had localhost listen EPERM; rerun with localhost permission passed, not counted as code success until rerun.
- `npm run test:adapter`: **3 PASS / 54 assertions** (variables + original graph/commands).
- `npm run typecheck`, `typecheck:editor`, `format:check`, `verify-upstream`, `git diff --check`: PASS.
- `npm run build`: full host package/Vite/API PASS (Vite 1m43s; known optional WebGPU warnings remain).
- `REAL_FIG_FIXTURE_ROOT=/Users/agent01/git/OpenPencil-GDrive/test_files npm run test:e2e` with approved Playwright browser cache: **2 PASS / 28.1 s**. M1 synthetic 5.3 s; three-real-fixture test 20.8 s.
- Native browser-ready measurements: **167,558 B → 1 page / 1,060 ms; 9,108,449 B → 1 / 6,229 ms; 409,977,351 B → 3 / 11,049 ms**. Native canvas/layers/pages present, add-page disabled, AI absent; no page/console runtime errors or external HTTP/WS; source sha256/mtime unchanged. Browser bytes come through test-only localhost stream, not real NAS BFF authorization. No GPU memory, pixel fidelity, NAS disk/LAN or soak acceptance. Public data: performance.browser.local.json.
- Rebuilt final arm64/amd64 images above. `tests/container/readonly.sh` and `fixtures.sh` on EACH PASS; supplied originals not written. Dedicated HTTPS staging container replaced with new arm64 image, same source/JSON RO and existing state volume preserved.
- Final tar `docker image load` passed on Docker Desktop for both platforms, returning the exact current image IDs above; target DSM archive import remains unrun. Final bundles regenerated and checksums validated below.

No separate loopback Mock or fixture server remains after Playwright cleanup. The persistent service remains isolated Google/strict staging. NAS native bridge implementation/live matrix remain blocked; publication infrastructure does not enable formal documents.

Final delivery verification: both regenerated bundles have **35 public files + manifest/SHA256SUMS**, include QUICK_START/root Compose and safe public performance reports. `shasum -a 256 -c SHA256SUMS` all PASS for both; exported file inventory excludes actual secrets, FIG, SQLite and .env. HTTPS recheck after replacement: /health/live **200**, /health/ready **503 strict**, /auth/mode **google-oidc**. Read-only SQLite count confirms **2 oidc-verified / 0 sessions** retained. Source/mount restrictions and strict gate remain unchanged.

## Git handoff — 2026-10-02 Asia/Taipei

User explicitly requested origin `git@github.com:MacacaGames/OpenPencil-Viewer.git`, local Git preparation, and manual push by the user. `git remote add origin ...` succeeded; main is the local branch. Read-only HTTPS `git ls-remote ... HEAD refs/heads/main refs/heads/master` and the follow-up `git ls-remote --heads ...` both returned no refs (empty target); no remote fetch/merge was needed. Existing configured Git author identity is used. No push, tag, package publication or production deployment performed.

Updated public .env.example/QUICK_START/OPERATOR_HANDOFF/DEPLOYMENT_CONVENTIONS with actual expected GHCR namespace `ghcr.io/macacagames/openpencil-viewer` and manual `git push -u origin main`. Workflow already derives the lowercase image name from github.repository. Main push will trigger CI and conditional image publication, not NAS deployment.

Git preparation checks: upstream pristine/pin PASS, actionlint PASS, staged diff/format and secret/fixture inventory checked before local commit. Actual Web OAuth client ID/secret are compared in memory against staged blobs; no values printed. Credentials, actual .env, SQLite, builds/caches and supplied real FIGs excluded. Only reproducible synthetic tests/fixtures/basic.fig is tracked; upstream remains a 160000 gitlink. This turn changes Git/public deployment documentation only; API/native/container integration tests were not rerun because implementation is unchanged, prior final results above remain the evidence. NAS bridge/live matrix and GitHub runner/GHCR remain unrun/blocked as described above.

First full staged `git diff --cached --check` reported the literal one-space blank context lines required by the stored unified patch. Added scoped .gitattributes `patches/open-pencil/*.patch whitespace=-blank-at-eol` without changing the patch bytes. `git -C upstream/open-pencil apply --check --whitespace=error ../../patches/open-pencil/0001-lan-readonly.patch` PASS validates the actual added source; cached diff check then PASS. FIG marked binary, with no LFS filter. Format and workflow lint PASS. Staged source inventory is approximately 0.4 MiB plus the fixed upstream gitlink, not the built images or supplied designs. Local initial commit and final clean-tree checks are reported in the handoff response; user performs the push.
