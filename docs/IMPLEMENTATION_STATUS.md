# Implementation status — OpenPencil × Synology LAN Portal

Updated **2026-10-02 Asia/Taipei**. Local/mock evidence is distinct from live acceptance. The goal remains **blocked for formal NAS release**, not complete. No production deployment, SSH, NAS account/ACL changes, Drive API, NAS writes or second-stage editing occurred.

| Milestone | Actual status |
|---|---|
| M0 | Upstream audit/native boot + metadata-only probe delivered; live NAS capability blocked |
| M1 | **Local acceptance passed**: A/B lists → double-click FIG → complete native readonly UI |
| M2 | Real Google positive OIDC verified through user HTTPS proxy; trusted NAS mapping/live negative cases pending |
| M3 | **Blocked**: Portal/Unix broker and evidence/profile gate implemented; native DSM adapter and live acceptance runner still absent; no production grants |
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

1. Operator runs the bounded metadata-only NAS_PROBE manually on the explicitly authorized existing document source and supplies redacted capability evidence. A/B ACL and write-denial acceptance still uses isolated synthetic fixtures; local-account/email editability policy is supplied, native trust/refresh/lifecycle evidence remains pending.
2. Implement the supported native DSM directory/effective-access/same-object adapter from target evidence; Portal/broker transport is implemented, but strict stays gated until all applicable live matrix cases pass.
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

## Synology runtime config diagnostics — 2026-10-02 Asia/Taipei

Operator reported a repeating `PORTAL_CONFIG must be a bounded regular JSON file` startup error in Synology Container Manager, using `ghcr.io/macacagames/openpencil-viewer:sha-8856943`. Provided Compose maps an existing host config to `/config/config.json`, matching PORTAL_CONFIG; screenshot shows a 545-byte JSON file. This rules out the displayed file being oversized but does **not** prove the container can read the NAS mount or that its bytes are valid JSON. Actual NAS cause remains pending operator diagnostic output; UID10001 access, actual mount and JSON syntax must be checked. No NAS connection, ACL/account changes, source mount or deployment was performed by the agent.

Runtime loader now reports separate sanitized errors for missing/unreadable files, directories, symlinks, size overflow, changes during read, malformed JSON and non-object JSON. It keeps the same size bounds, descriptor consistency and no-follow checks; O_NONBLOCK prevents a FIFO mount from hanging startup before the regular-file check. No JSON contents, OAuth secrets or supplied private paths appear in diagnostics. Google OAuth JSON uses the same checks. No config defaults, permission bypass or authorization fallback added.

QUICK_START and OPERATOR_HANDOFF now explain manual JSON preparation, host source versus container target, and Container Manager UI checks. For the operator's existing image, a temporary `restart: no` / Node metadata command reports UID, regular-file/size/readability or a sanitized filesystem error without reading JSON contents. The updated loader requires a new build; no GHCR push or tag replacement occurred.

Actual commands, with PATH selecting Node **22.23.3** and local Bun **1.4.2**:

| Command actually run | Result |
|---|---|
| `node --import tsx --test tests/unit/runtime-config.test.ts` | **5 PASS**, including both mounted JSON labels, inclusive config size limit, permissions, no-follow, syntax/object rejection, secret/path redaction and FIFO timeout |
| `npm test` | First sandbox run **26 PASS / 1 FAIL** due solely to localhost `listen EPERM`; rerun with localhost permission **27 PASS / 0 FAIL**, no skipped tests |
| `npm run typecheck` | PASS |
| `npm run verify-upstream` | PASS, pristine exact locked SHA |
| `npm run format:check`, `git diff --check`, `sh -n tests/container/readonly.sh` | PASS |
| `npm run build` | PASS complete package/native Vite/API build; Vite **1m30s**, existing optional WebGPU/chunk/plugin warnings remain |
| `docker build --network none --pull=false -t openpencil-lan:config-diagnostics-test .work/config-diagnostics-context` | PASS; local test image derived from previously tested arm64 image with only newly compiled dist/api copied in, not a full release image rebuild |
| `PORTAL_TEST_IMAGE=openpencil-lan:config-diagnostics-test sh tests/container/readonly.sh` | PASS non-root/source+rootfs RO/confinement/strict503; added **12** compiled config-check negative cases (six causes for each JSON label), including UID10001 EACCES and bounded FIFO rejection |
| `npm run test:e2e -- --config .work/config-fix-playwright.config.ts tests/e2e/mock-flow.spec.ts` | **1 PASS / 13.5s**, test **7.0s**; existing installed Google Chrome selected via ignored temporary config because default Playwright browser cache is absent. Synthetic A/B/native UI/readonly/network/persistence/history/source integrity only |

Task-owned synthetic containers/volume and browser/server cleaned up by tests; local test image remains for reproduction. Existing staging container, original release images/bundles, upstream source and supplied designs unchanged. New amd64 release image, GHCR publication, actual NAS JSON access and all pending native provider/live ACL checks remain **NOT RUN**. Strict still fails closed. Adapter/editor implementation unchanged; no new real-document or live Google acceptance claimed.

## Standalone Synology Compose — 2026-10-02 Asia/Taipei

User requested a Synology Docker Compose. Added deploy/compose.synology.ui.example.yml as a standalone Container Manager Project template, no .env/extends required. Exact current origin/hd, same-NAS loopback port24681, explicit private single JSON mounts, isolated test_files RO, separate state RW, UID10001, RO rootfs/cap-drop/security/resource/log restrictions. Image digest remains an explicit operator placeholder; no registry availability/digest invented. OPERATOR_HANDOFF explains files, state UID/mode, image import alternative and remote nginx NAS-IP adjustment.

Read Synology official Container Manager Project documentation (kb.synology.com/en-global/DSM/help/ContainerManager/docker_project) to confirm upload/editor/project working-directory workflow. YAML parse + readonly/mount/domain assertions PASS. `docker compose -f .work/synology-ui-validation.yml config --quiet` PASS with only the image replaced by the already-tested local arm64 image ID. `npm run format:check`, `git diff --check` PASS. This validates schema, not real NAS paths, permissions or readiness; no container/NAS deployment was performed. API/editor implementation unchanged, full integration tests not rerun for this template/documentation change. Native NAS provider/matrix remain blocked; expected readiness503 and directory-unavailable remain intact. Local template commit prepared for the user's manual push; no push by the agent.

## Synology config EACCES confirmed — 2026-10-02 Asia/Taipei

Operator ran the previously supplied metadata-only command in the existing NAS container and returned `{ uid: 10001, code: 'EACCES' }`. This is live operator evidence of a config-path read/access permission failure for the container identity; it does not yet distinguish file-mode versus inherited ACL versus parent traversal, nor validate JSON syntax, OAuth access or state writes. The application has not passed startup/live readiness on this NAS.

Read current official Synology permission guidance: https://kb.synology.com/en-global/DSM/tutorial/Revert_to_Windows_ACL_permission warns that chmod on existing ACL-managed files/folders changes them to Unix permissions. Task Scheduler reference: https://kb.synology.com/en-global/DSM/help/DSM/AdminCenter/system_taskscheduler?version=7; official script-entry instructions also found at https://kb.synology.com/da-dk/DSM/tutorial/common_mistake_in_task_scheduler_script. Recommended manual remediation uses newly created dedicated private runtime JSON copies (root-owned, group10001 readable, mode0640) under a new mode0700 directory, then changes only the three JSON mount sources. Existing deployment originals/ACLs and state are preserved. No recursive chmod, NAS user creation, source-root permission changes, root Web runtime or authorization fallback proposed. Individual file mounts are retained; the new private parent is not mounted into the container.

OPERATOR_HANDOFF records the operator-only Task Scheduler/terminal procedure and follow-up metadata/config checks. No NAS mutation, SSH, script execution or container reconfiguration was performed by the agent. Actual chmod/chown/copy results, startup/state access and all native DSM provider/live ACL acceptance remain pending operator execution. This turn changes documentation only; runtime/container implementation unchanged, prior 27-test/build/container/browser evidence remains applicable. `git diff --check` is the local documentation check; no new full integration suite claimed.

## Synology application startup reported — 2026-10-02 Asia/Taipei

Operator supplied output from `sudo docker logs openpencil-viewer-portal-1`: a Node SQLite ExperimentalWarning followed by `Portal google-oidc/dsm-strict: https://openpencil.macaca.games`. The startup line is emitted by the HTTP listen callback after runtime config loading, Portal/SQLite initialization and the initial scan attempt. This is operator evidence that the earlier config-read crash no longer prevents application startup. The warning is nonfatal in this run. The operator has not reported the exact applied permission changes, current runtime UID, mount flags or image digest; none are inferred from the startup message.

Checked current `apps/api/server.ts` listen/log order and `apps/api/app.ts` health routes read-only. `/health/live` should return 200; `/health/ready` should remain 503 while the unimplemented native DSM provider fails closed. Suggested operator checks use the configured NAS loopback host port24681. Those HTTP requests, external HTTPS proxy access, new NAS Google login, trusted directory/ACL matrix, source RO/kernel/reboot and formal release remain unverified. The agent did not access or mutate the NAS. Only this evidence record changed; `git diff --check` PASS. No code changes or additional integration tests required for the log-status update.

## Synology directory gate reported — 2026-10-02 Asia/Taipei

Operator returned `{"error":"directory-unavailable"}` after the reported NAS startup. Request URL/phase not yet supplied. Read apps/api/app.ts callback/directory order, packages/nas-identity snapshot freshness and packages/authorization strict provider. If this response is from Google callback, token exchange/signature/claims verification precedes this error; the same error can arise from other APIs, so this message alone is not yet a new confirmed live Google acceptance record. No principal/session success claimed.

The public directory.example.json is exactly **167 bytes**, matching the earlier screenshot's displayed size but not proving the NAS contents. It has zero timestamps and an empty principal list and intentionally expires. Actual local reproduction with Node22.23.3, `node --import tsx --input-type=module` calling parseDirectory/resolvePrincipal on this public template and a synthetic verified identity returned **directory-unavailable / 503**, with **strictReady=false**, exit0. No NAS file or employee identity was read. Other possible causes remain unreadable/missing mount, JSON/schema/source mismatch, or stale/future snapshot; exact live cause remains unverified.

Updated operator guidance to explain these triggers and that both automatic native directory and effective ACL/read bridge are still unimplemented. Editing timestamps or inventing static identities cannot complete M3. Requested operator request phase plus NAS model/DSM/Container Manager/account-source metadata; isolated probe and same-user ACL evidence still required before selecting a native provider. No fallback, provider enablement, NAS connection/mutation, production deployment or additional integration acceptance performed. This is documentation/diagnostic work only; `git diff --check` PASS, previous runtime tests remain the implementation evidence.

## Target NAS profile and probe preparation — 2026-10-02 Asia/Taipei

Operator supplied **DS1821+**, **DSM7.4.1-90080** and screenshot evidence of installed **Container Manager24.0.2-1706**, then explicitly confirmed **DSM local accounts**. Synology's official CPU table identifies this model as AMD Ryzen V1500B/x86_64, corresponding to Docker linux/amd64. Official DSM archive lists DSM_DS1821+_90080.pat under7.4.1-90080. The model-specific release-notes URL could not be retrieved; archive/source metadata does not attest the installed kernel, filesystem or local-account ACL behavior. No patch/install/upgrade was requested or performed.

Updated SYNOLOGY_CAPABILITY_AUDIT to distinguish supplied model/version/local-account profile from missing host/container/native identity/ACL evidence. NAS_PROBE now includes an operator-only temporary-container command reusing the exact existing Portal image via docker inspect, UID10001, no network/ports/secrets/state, RO rootfs and a single RO **separate approved synthetic root**. It does not probe the operator's existing document share. Container Python/command inventory is explicitly not host-native CLI/API evidence. Requested employee email editability/trust policy and an approved isolated test-root path; no account/password database or employee list requested.

Actual local checks:

- `python3 scripts/probe-nas.py --self-test`: **13 PASS /0.036s**, Darwin synthetic only.
- Analogous `docker run --rm --platform linux/amd64 --network none --read-only --user10001:10001 --cap-drop ALL --security-opt no-new-privileges --pids-limit64 --memory256m --cpus1 --mount <temporary synthetic root>:/data/probe:ro --entrypoint python3 openpencil-lan:0.1.0-amd64 /app/tools/probe-nas.py --root /data/probe --context container --ack-isolated-test-root --max-entries10000 --max-depth16 --max-seconds15`: **exit0 /PASS on Docker Desktop emulation**, no NAS connection. Python assertions confirmed x86_64, non-root, completed metadata observation, one synthetic FIG metadata record, mount read_only=true, source_bytes_read=0, source_writes_attempted=0 and dsm_strict_ready=false. Synthetic source contents unchanged; temporary container/source directory removed. Redacted local output kept in ignored `.work/ds1821-container-probe.local.json`.
- `git diff --check`: PASS.

Documentation-only increment; probe/runtime implementation unchanged, full app tests/build not repeated. Target NAS probe, trusted local-directory schema, effective ACL/read broker, same-user A/B matrix and formal release remain **NOT RUN /BLOCKED**. Knowing the model/DSM/package/local-account source does not enable strict authorization or justify an administrator/service-UID fallback.

## Existing document source authorized for metadata probe — 2026-10-02 Asia/Taipei

Operator confirmed that ordinary employees cannot change their DSM account email and requested the probe root be supplied through Docker `-e`. The later explicit instruction says no separate test directory is needed and to use the formal source. This authorizes the bounded, manually run, read-only **metadata observation of the existing `/volume1/Gd` source** for this probe, superseding the earlier isolated-root requirement for this observation only. It does not authorize production document serving, ACL/account changes, source write tests, NAS SSH or a whole-volume mount. Native identity provenance/uniqueness/refresh/lifecycle still needs actual supported source evidence; the reported email policy alone does not supply that source.

Updated NAS_PROBE, SYNOLOGY_CAPABILITY_AUDIT and OPERATOR_HANDOFF accordingly. The command reuses the running Portal image, mounts only `/volume1/Gd` to `/data/designs:ro`, passes `-e NAS_TEST_ROOT=/data/designs` and calls the existing probe's report function through a fixed Python driver. It records `operator_declared_root_usage=existing_document_source_metadata_only`, without falsely acknowledging an isolated synthetic root. The original CLI, probe implementation and image are unchanged. The driver retains canonical/no-follow/whole-volume rejection and bounded traversal through the same report/scan functions. Missing or empty environment input exits before loading the probe. No OAuth/config/state mounts, ports or network; UID10001/rootfs RO/cap-drop/security/resource limits retained. A/B ACL fixtures and permission-change/write-denial tests remain on synthetic isolated data.

Actual local verification, all using synthetic temporary files on the development host:

- Extracted the exact shell command/Python driver from NAS_PROBE: `sh -n` and Python `compile` **PASS**.
- `docker run --rm --platform linux/amd64 --network none --read-only --user 10001:10001 --cap-drop ALL --security-opt no-new-privileges --pids-limit 64 --memory 256m --cpus 1 --mount <local synthetic source>:/data/designs:ro -e NAS_TEST_ROOT=/data/designs --entrypoint python3 openpencil-lan:0.1.0-amd64 -c <documented driver>`: **exit0 /PASS** on Docker Desktop emulation. Assertions verified completed observation, one FIG metadata record, non-root/x86_64, RO mount, source_bytes_read=0, source_writes_attempted=0, redacted paths/names and strictReady=false. Original synthetic bytes/size/mtime unchanged. Local JSON kept only in ignored `.work/ds1821-existing-root-env-probe.local.json`; temporary containers/source removed.
- Same driver with missing environment and empty environment: **exit1 /PASS**, no report, fixed `NAS_TEST_ROOT is required` message. With `/volume1`: **exit2 /PASS**, `whole_host_or_volume_root_rejected`; with a missing subdirectory: **exit2 /PASS**, `root_unavailable`. No failure was converted into an empty successful observation.
- `python3 scripts/probe-nas.py --self-test`: **13 PASS /0.029s**, exit0, local synthetic only.
- `git diff --check`: **PASS**.

Documentation/command increment only; no runtime/provider/editor implementation change, new image, publication or NAS action. Full application tests/typecheck/build/browser tests were not repeated. The actual target NAS probe result, native directory/effective ACL/read bridge and all pending live matrix checks remain **NOT RUN /BLOCKED**; `directory-unavailable` and strict fail-closed behavior are not repaired by this diagnostic command.

## Portal/native broker integration — 2026-10-02 Asia/Taipei

Operator asked to proceed through implementation with fewer test round trips. Implemented the available Portal/helper integration and concentrated required validation. This is **not completion of the native DSM adapter or the overall NAS goal**: the exact trusted local-account/lifecycle source, effective ACL/share semantics and supported output schema have still not been supplied. Rechecked primary Synology CLI/3rd-party integration documentation; it does not establish the target7.4.1 native read/query schema. No invented API/CLI parser, admin-permission grant or service-UID authorization was added.

Delivered packages/nas-bridge, async Portal directory/identity/ready handling, bounded no-follow static snapshot reads, complete/exclusive environment-or-JSON bridge config, provider transport integration and broker-only content/stat when configured. Fixed IPC operations are status/directory/authorize/stat/read over a protected Unix socket; no caller host paths, UID/groups or shell. Native source must be fresh and `native-dsm`; instance/provider/reviewed acceptance SHA256/root identities must agree, with no old JSON/local-byte fallback. Header binds principal/generation/root/path/revision/size, streams enforce length/timeout/cancel and hold final data until completeness checks pass. Snapshot/group/principal sizes and freshness are bounded.

Delivered tools/nas/bridge.py: root-owned/no-follow code/config/evidence, same checked adapter bytes, current code/config/profile checks, Linux peer UID10001, bounded fork workers and30-second operations. It rechecks live identity and native authorization, requires adapter-authorized RO descriptors, compares actual object/root/dev/revision/size/link/type, and exposes no local open fallback. Evidence binds actual DSM version/source IDs, instance/provider, kernel/architecture, broker/adapter hashes, roots and size limit; all37 I/A/R cases need unique passing live evidence references. The artifact is a root-controlled administrator acceptance statement, not automatic proof of the referenced tests. Synthetic evidence only works in development helper with synthetic roots and loopback Mock Portal, never Google/production.

**tools/nas/native-adapter.example.py deliberately remains blocked.** The actual DSM directory/effective evaluator/identity worker/confinement adapter and live matrix runner remain unimplemented; this broker contract does not implement those native semantics. Empty/expired acceptance and native bridge config examples cannot enable production. NAS_BRIDGE/AUTHORIZATION_ADR/OPERATOR_HANDOFF/capability audit distinguish delivered transport from this gap. Public helper is included in Dockerfile/release-export allowlist; CI adds Python broker checks. No helper installed on NAS, accounts/ACLs changed, SSH or source mutations performed.

Actual verification:

| Command | Result |
|---|---|
| `npm test` with Node22.23.3 | **32 PASS /0 FAIL /0 SKIP, 1.345s**. Includes synthetic Unix bridge A/B list/HEAD/read with local stat/open deliberately forbidden, disable/rebuild/stale/schema/source/unavailable revoke, digest/synthetic gate and mismatched/truncated/oversized streams |
| `python3 tests/nas/test_bridge.py` on Darwin | **7 PASS /1 Linux-only SKIP, 0.026s** final; initial7-test run also passed |
| `docker run --rm --platform linux/amd64 --network none --read-only --user10001:10001 --cap-drop ALL --security-opt no-new-privileges --pids-limit64 --memory256m --cpus1 --tmpfs /tmp:rw,noexec,nosuid,nodev,size=64m,mode=1777 --mount <workspace>:/repo:ro --entrypoint python3 openpencil-lan:nas-bridge-candidate-amd64 /repo/tests/nas/test_bridge.py` | **8 PASS /0 SKIP, 0.284s** final; includes actual Linux socket/peer/fork/header+bytes, unknown operation and expired-evidence rejection. Earlier container invocation omitted tmpfs and failed EROFS before fixtures; corrected command passed, no production source writes |
| `npm run typecheck` | **PASS** after annotating the provider interface; initial optional-method union errors repaired |
| `npm run verify-upstream` | **PASS**, official source pristine at8c72b62da07ea1f7e82de84c7c837c3c78dfbf95 |
| `npm run format:check`, `git diff --check` | **PASS** |
| `npm run build` | **PASS**, full packages/Vite/API, Vite1m23s; known optional WebGPU/vendor/chunk/dynamic-import/plugin warnings remain |
| `npm run test:e2e -- --config .work/config-fix-playwright.config.ts tests/e2e/mock-flow.spec.ts` | **1 PASS /11.4s**, test4.9s; installed Chrome, synthetic native UI/readonly/network/persistence/A-B/source integrity only |
| `PORTAL_TEST_IMAGE=openpencil-lan:nas-bridge-candidate-amd64 sh tests/container/readonly.sh` | **PASS** new API/rootfs/source RO/UID10001, Linux confinement, mounted JSON/domain diagnostics and strict503; temporary volume/container/source cleaned |
| Candidate helper packaged-file Python AST check | **PASS** |
| `npm run test:nas` | **exit2 /BLOCKED**, no native/live acceptance falsely promoted |

Locally built **amd64 candidate** `openpencil-lan:nas-bridge-candidate-amd64`, ID **sha256:32d263a8d73659b0b6acef24be757e9935a1bcb8ce2d569860fe695db7ba79cf**, user10001:10001. This reuses the previously tested amd64 runtime/dependencies and copies this turn's complete built dist + public NAS helper. It is a local derived candidate, not a fresh full Dockerfile/release rebuild or a published GHCR artifact. Root Dockerfile and future public exporter include helper; actual exporter/publication were not run this turn. Local logs are ignored .work/nas-bridge-*.log. Existing staging, original release images/bundles, official upstream, original handoff plans and sibling designs preserved.

**Remaining:** target native account/email/enabled/groups/lifecycle schema, principal-specific effective ACL/share semantics and safe descriptor adapter; actual NAS helper/service/socket/permissions install and lifecycle; live matrix/API/UI evidence, same-NAS filesystem/RO/network/reboot/performance; formal image/release publication. Current NAS deployment has not been changed. `directory-unavailable` is **not yet repaired on the NAS**, and formal release remains blocked. No further mock tests can supply the missing native source or replace live acceptance.
