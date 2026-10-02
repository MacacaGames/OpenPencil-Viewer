# Synology capability audit — OpenPencil × Synology LAN Portal

Recorded 2026-10-01 (Asia/Taipei). Live NAS status: **blocked / not run**. No target NAS address, test access, identity directory, credentials, ACL fixtures or administrator-approved probe output has been supplied. No SSH, account/ACL changes, real NAS mounts or production deployment were performed.

## Evidence categories

| Capability | Status | Actual evidence / next step |
|---|---|---|
| Metadata-only manual probe | Implemented; local synthetic verification | `scripts/probe-nas.py`; bounded descriptor-relative traversal and redacted JSON. `--self-test` covers synthetic local trees. |
| Local descriptor API | Verified on development host only | Python 3.9.6, Darwin: `open`/`stat` support `dir_fd`; `stat` supports no-follow; `scandir` supports fd; `O_DIRECTORY`/`O_NOFOLLOW` present. This is not DSM/kernel evidence. |
| Fixed command inventory | Implemented, schema unknown | Presence check only; no CLI execution or parser. Native command presence cannot approve an evaluator. |
| DSM/kernel/CPU and package versions | Pending live | Probe collects redacted OS/kernel/CPU and whitelisted DSM version metadata when available. Container Manager/Drive Server versions remain manual observations. |
| Filesystem, mount/ACL profile | Pending live | Linux mount namespace observations are diagnostic. Native Windows ACL, share restrictions, nested RO mounts and expected-volume availability need actual target evidence. |
| Directory source, enabled state, groups | Pending live | No account/password database read or native resolver invented. Need supported read-only local/LDAP/AD source for the target profile. |
| Trusted NAS email and lifecycle | Pending live | Determine user email editability; establish administrator trust and identity generation/rebuild detection. Same email alone does not authorize bytes. |
| Mapped principal traverse/list/read | Unknown; unavailable in this implementation | Service-account metadata access is explicitly separate. No effective DSM ACL provider has passed the matrix. |
| File Station permission equivalence | Document boundary reviewed; live not run | Permission descriptions belong to the authenticated API user. An administrator result cannot stand in for A/B. |
| NAS native helper | Candidate; not installed/implemented | Select supported native evaluator or principal-isolated broker only after real capability and ACL evidence. Keep privilege out of the Web container. |
| Production `dsm-strict` | Blocked | No fallback to service UID, admin API, root allowlist or unverified CLI output. |

## Commands actually run

- `python3 scripts/probe-nas.py --self-test`: exit 0; 13 tests passed on Darwin/arm64, Python 3.9.6. Synthetic race and mount observations are tests, not live NAS evidence.
- `python3 scripts/probe-nas.py --root /private/tmp/portal-probe-missing/synthetic --context local-test --ack-isolated-test-root`: exit 2; redacted JSON with `root_unavailable`, DSM unavailable on this platform and `dsm_strict_ready: false`. No files were created at the missing path.
- `python3 scripts/probe-nas.py --help`: exit 0; operator flags documented.
- `git diff --check`: exit 0; no whitespace errors in tracked differences at that point.

Neither NAS-host/container invocation nor any live identity/ACL matrix row has run. Full Portal test/typecheck/upstream/build/browser checks are coordinated separately; these commands validate only this M0 probe increment.

## Primary-document review

The [Synology File Station Official API guide](https://global.download.synology.com/download/Document/Software/DeveloperGuide/Package/FileStation/All/enu/Synology_File_Station_API_Guide.pdf), reviewed 2026-10-01, describes `perm.acl` in terms of the logged-in API user (printed pages 27 and 33). Its `CheckPermission` section documents a `write` method tied to that session (printed page 65). Share-level download/list restrictions are also described (printed page 27). These documented boundaries do not supply a Google-only arbitrary-principal read authorization method. No API was contacted.

The [Synology CLI Administrator Guide](https://global.download.synology.com/download/Document/Software/DeveloperGuide/Firmware/DSM/All/enu/Synology_DiskStation_Administration_CLI_Guide.pdf) documents account/group/share administrative tools. This review does not establish a stable read-only email/directory JSON API or an effective ACL evaluator on the target DSM. Their actual supported invocation and schema remain unverified; the probe does not invoke them.

Python [descriptor-relative and no-follow filesystem operations](https://docs.python.org/3/library/os.html#files-and-directories) supply the local probe mechanism. Their presence on Darwin is local evidence only; DSM must report and test its own capabilities. The probe is metadata-only and is not a production safe opener.

## Required live acceptance record

The administrator supplies an isolated synthetic root and approved ordinary A/B users. Record exact DSM, kernel, architecture, Container Manager/Drive Server, filesystem/ACL mode, identity profile, source trust, Portal/upstream/native-provider versions and time. Run the manual probe per [NAS_PROBE.md](NAS_PROBE.md), then attach redacted per-user baseline and Portal outcomes for each applicable [matrix](../ACL_ACCEPTANCE_MATRIX.md) row. Do not treat host-service readability or administrator API results as user baseline.

For any native provider, document timeout/schema/change failure behavior, supplementary group handling, privilege lowering, identity lifecycle, share-level restrictions and descriptor-bound read identity. Distinguish local-user support from LDAP/AD; do not extrapolate one profile's pass to another. Record revocation freshness and already-streamed-byte limitations.

Current selection: production denies requests until verified native authorization exists; Mock is development-only. The eventual `local-filesystem` versus `nas-brokered-read` choice is unresolved and recorded in [AUTHORIZATION_ADR.md](AUTHORIZATION_ADR.md).
