# Synology capability audit — OpenPencil × Synology LAN Portal

Recorded 2026-10-01; updated **2026-10-02 (Asia/Taipei)**. Native identity/ACL acceptance remains **blocked / not run**. The operator now reports **DS1821+, DSM7.4.1-90080** and supplies a screenshot showing **Container Manager24.0.2-1706** installed. Operator logs demonstrate application startup and a later directory-unavailable response; host/container capability probe, account-source/trust evidence and live ACL matrix are still pending. The agent has not connected to or modified the NAS, used SSH, changed accounts/ACLs or deployed a container there.

## Target profile supplied by the operator

| Item | Evidence | What remains unverified |
|---|---|---|
| Model | Operator: DS1821+ | Actual host inventory/probe |
| DSM | Operator:7.4.1-90080; [official archive](https://archive.synology.com/download/Os/DSM/7.4.1-90080) lists DSM_DS1821+_90080.pat | Installed VERSION/kernel output and patch level |
| Container Manager | Operator screenshot:24.0.2-1706 | Docker Engine/Compose runtime versions; package version is not a complete daemon/kernel inventory |
| CPU/image platform | [Synology CPU table](https://kb.synology.com/en-ca/DSM/tutorial/What_kind_of_CPU_does_my_NAS_have): AMD Ryzen V1500B, x86_64; corresponding Docker platform linux/amd64 | Actual running image architecture/digest |
| Identity source | Operator confirmed DSM local accounts and that employees cannot change their own email | Supported trusted directory/exporter, effective groups, enabled state and lifecycle/generation source; no local API/CLI schema verified yet |
| Metadata probe source | Operator explicitly authorized existing `/volume1/Gd`, using `-e NAS_TEST_ROOT` for its container path; no extra synthetic directory required for this observation | Manual bounded metadata-only result still pending; this is not native user authorization or permission-change/write-test approval |
| Native authorization | Broker/client implemented; verified native adapter unimplemented | Supported effective evaluator/read broker, same-object authorization and all applicable live matrix cases |

The operator's model-specific release-notes URL could not be opened by the web tool. The archive confirms the release artifact exists; it does not replace live installed-version evidence or establish ACL compatibility. No assumption about kernel version, Btrfs/ext4, identity backend or native syscall/API compatibility is made from the DSM version number.

## Evidence categories

| Capability | Status | Actual evidence / next step |
|---|---|---|
| Metadata-only manual probe | Implemented; local synthetic verification | `scripts/probe-nas.py`; bounded descriptor-relative traversal and redacted JSON. `--self-test` covers synthetic local trees. |
| Local descriptor API | Verified on development host and Docker Desktop; NAS pending | Darwin and previously recorded Linux container confinement tests are local evidence. Target DSM/kernel descriptor capability and read-path behavior still need the manual probe and acceptance matrix. |
| Fixed command inventory | Implemented, schema unknown | Presence check only; no CLI execution or parser. Native command presence cannot approve an evaluator. |
| DSM/kernel/CPU and package versions | Target model/DSM/Container Manager supplied; live probe pending | See target profile above. Actual kernel/filesystem, running image, Docker runtime and Drive Server (if relevant) remain unverified. |
| Filesystem, mount/ACL profile | Pending live | Linux mount namespace observations are diagnostic. Native Windows ACL, share restrictions, nested RO mounts and expected-volume availability need actual target evidence. |
| Directory source, enabled state, groups | DSM local profile supplied; resolver pending | No account/password database read or native resolver invented. Need a supported read-only local-account source for this target and its observed schema. AD/LDAP support is not inferred. |
| Trusted NAS email and lifecycle | Email editability policy supplied; native evidence pending | Operator states ordinary users cannot change email. Actual administrator-controlled source, uniqueness, refresh and identity generation/rebuild detection still need validation. Same email alone does not authorize bytes. |
| Mapped principal traverse/list/read | Unknown; unavailable in this implementation | Service-account metadata access is explicitly separate. No effective DSM ACL provider has passed the matrix. |
| File Station permission equivalence | Document boundary reviewed; live not run | Permission descriptions belong to the authenticated API user. An administrator result cannot stand in for A/B. |
| NAS native helper | Broker transport implemented; native adapter pending and no NAS installation | Select supported native evaluator or principal-isolated broker only after real capability and ACL evidence. Keep privilege out of the Web container. |
| Production `dsm-strict` | Blocked; bridge/live-evidence gate implemented | No fallback to service UID, admin API, root allowlist or unverified CLI output. |

## Bridge implementation increment

See [NAS_BRIDGE.md](NAS_BRIDGE.md) and IMPLEMENTATION_STATUS for the implemented transport, evidence/profile gate, strict native-source requirement and synthetic tests. No target-verified DSM adapter or automatic local-account exporter exists yet. The example adapter remains blocked.

## Commands actually run

- `python3 scripts/probe-nas.py --self-test`: exit 0; 13 tests passed on Darwin/arm64, Python 3.9.6. Synthetic race and mount observations are tests, not live NAS evidence.
- `python3 scripts/probe-nas.py --root /private/tmp/portal-probe-missing/synthetic --context local-test --ack-isolated-test-root`: exit 2; redacted JSON with `root_unavailable`, DSM unavailable on this platform and `dsm_strict_ready: false`. No files were created at the missing path.
- `python3 scripts/probe-nas.py --help`: exit 0; operator flags documented.
- `git diff --check`: exit 0; no whitespace errors in tracked differences at that point.

No NAS capability-probe invocation or live identity/ACL matrix evidence has been supplied. Operator startup logs are tracked separately in IMPLEMENTATION_STATUS. Full Portal test/typecheck/upstream/build/browser checks are coordinated separately; the commands above validate only the original M0 probe increment.

## Primary-document review

The [Synology File Station Official API guide](https://global.download.synology.com/download/Document/Software/DeveloperGuide/Package/FileStation/All/enu/Synology_File_Station_API_Guide.pdf), reviewed 2026-10-01, describes `perm.acl` in terms of the logged-in API user (printed pages 27 and 33). Its `CheckPermission` section documents a `write` method tied to that session (printed page 65). Share-level download/list restrictions are also described (printed page 27). These documented boundaries do not supply a Google-only arbitrary-principal read authorization method. No API was contacted.

The [Synology CLI Administrator Guide](https://global.download.synology.com/download/Document/Software/DeveloperGuide/Firmware/DSM/All/enu/Synology_DiskStation_Administration_CLI_Guide.pdf) documents account/group/share administrative tools. This review does not establish a stable read-only email/directory JSON API or an effective ACL evaluator on the target DSM. Their actual supported invocation and schema remain unverified; the probe does not invoke them.

Python [descriptor-relative and no-follow filesystem operations](https://docs.python.org/3/library/os.html#files-and-directories) supply the local probe mechanism. Their presence on Darwin is local evidence only; DSM must report and test its own capabilities. The probe is metadata-only and is not a production safe opener.

## Required live acceptance record

The operator has authorized the bounded metadata-only observation of the existing document source per [NAS_PROBE.md](NAS_PROBE.md). For the ACL acceptance matrix, the administrator still supplies isolated synthetic fixtures and approved ordinary A/B users; permission-change and write-denial tests do not use the formal document source. Record exact DSM, kernel, architecture, Container Manager/Drive Server, filesystem/ACL mode, identity profile, source trust, Portal/upstream/native-provider versions and time, then attach redacted per-user baseline and Portal outcomes for each applicable [matrix](../ACL_ACCEPTANCE_MATRIX.md) row. Do not treat host-service readability or administrator API results as user baseline.

For any native provider, document timeout/schema/change failure behavior, supplementary group handling, privilege lowering, identity lifecycle, share-level restrictions and descriptor-bound read identity. Distinguish local-user support from LDAP/AD; do not extrapolate one profile's pass to another. Record revocation freshness and already-streamed-byte limitations.

Current selection: production denies requests until verified native authorization exists; Mock is development-only. The eventual `local-filesystem` versus `nas-brokered-read` choice is unresolved and recorded in [AUTHORIZATION_ADR.md](AUTHORIZATION_ADR.md).
