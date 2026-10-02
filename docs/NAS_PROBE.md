# Manual NAS capability probe

This M0 probe observes metadata using the current process account. It never authorizes a Google user, switches identity, executes a NAS command, reads `.fig` bytes, opens a network connection, changes ACLs/accounts, or writes into the source tree. Its JSON always reports effective DSM authorization as unknown and `dsm_strict_ready: false`.

The default CLI requires an administrator-approved isolated root containing synthetic fixtures. The operator has explicitly authorized using the existing `/volume1/Gd` document source for the bounded, read-only metadata observation below instead of creating a separate probe directory. That specific authorization does not extend to ACL changes, write tests or serving documents before native authorization passes. The operator has reported DS1821+/DSM7.4.1/Container Manager24.0.2 and application startup; no NAS capability-probe output has been supplied and Codex has not accessed the NAS. The probe does not create a NAS directory. Never use an entire volume, an account directory or SSH automation.

## Local verification

Python 3.9 or later and descriptor-relative `open`/`stat`/`scandir`, `O_DIRECTORY` and `O_NOFOLLOW` are required. The probe fails closed when these are unavailable. There are no pip dependencies.

```sh
python3 scripts/probe-nas.py --self-test
```

Self-tests create and remove a synthetic temporary local directory. The 13 tests cover redaction, symlinks at the root and intermediate path, stat/open symlink replacement, unsupported capabilities, nested mount skipping, metadata-only observation, unchanged source bytes/size/mtime, special files, hardlinks, excluded directories, limits, and missing/offline roots.

## Administrator-run test

Replace the example path with the approved, already-created synthetic test root. The supplied path must be absolute and have no symlink components, `.` or `..`. This example does not create a directory or alter its ACLs.

```sh
python3 scripts/probe-nas.py \
  --root /volume1/PortalProbe/synthetic \
  --context nas-host \
  --ack-isolated-test-root \
  --max-entries 10000 --max-depth 16 --max-seconds 15
```

The `--context` value is an operator declaration, not proof that the process is on a Synology host. Run the same command inside the intended non-root Web container using its exact isolated RO bind mount and `--context container` to compare the two environments. Do not mount the entire NAS, Docker socket or account database. Do not add privileges to make a failed probe pass.

Collect stdout in a protected evidence location outside the source root. The JSON omits hostnames, usernames, UID/GID values, email addresses, source paths, filenames and mount sources; aggregate counts and sizes are still internal operational evidence. Error messages use fixed reason codes and do not include paths. Review evidence before sharing it.

Exit `0` means the bounded metadata observation completed. It does **not** mean native permissions passed. Exit `2` means blocked/partial and must not be interpreted as an empty, healthy source. An inaccessible or missing root has no synthetic zero-file result. Entry/depth/time limits, metadata races and scan errors are partial observations. The time budget is checked between filesystem calls; an unavailable remote filesystem can block a system call longer than this budget. Use the operator's job watchdog when testing remote mounts.

## Container probe for the supplied DS1821+ deployment

依操作員最新指示，此次直接使用現有正式來源 `/volume1/Gd`，不另建測試目錄。操作員可手動使用 **目前正在執行的同一映像**，不需在 DSM 安裝 Python 或重新建置映像。映像內含 `/app/tools/probe-nas.py`；下方固定 Python wrapper 呼叫其 metadata report 函式，保留原本的路徑、安全 descriptor、排除規則與數量／深度／時間限制，並如實標記這次使用既有文件來源。沒有使用宣稱隔離合成資料的 `--ack-isolated-test-root`。

```sh
PORTAL_PROBE_IMAGE="$(sudo docker inspect --format '{{.Image}}' openpencil-viewer-portal-1)"
sudo docker run --rm --network none --read-only --user 10001:10001 \
  --cap-drop ALL --security-opt no-new-privileges \
  --pids-limit 64 --memory 256m --cpus 1 \
  --mount type=bind,src=/volume1/Gd,dst=/data/designs,readonly \
  -e NAS_TEST_ROOT=/data/designs \
  --entrypoint python3 "$PORTAL_PROBE_IMAGE" -c '
import json, os, runpy, sys
root = os.environ.get("NAS_TEST_ROOT")
if not root:
    sys.exit("NAS_TEST_ROOT is required")
probe = runpy.run_path("/app/tools/probe-nas.py")
result = probe["report"](root, "container", max_entries=10000, max_depth=16, max_seconds=15)
result["operator_declared_root_usage"] = "existing_document_source_metadata_only"
print(json.dumps(result, indent=2, sort_keys=True))
sys.exit(0 if result["service_account_metadata_observation"]["status"] == "completed_metadata_observation" else 2)
'
```

`/volume1/Gd` 是 NAS 的 bind source，`-e NAS_TEST_ROOT=/data/designs` 是掛載後容器內的探測路徑；名稱中的 TEST 不要求另建測試目錄。環境變數缺少或為空會退出，不會套用預設來源。此例的 NAS_TEST_ROOT 只供 probe wrapper 使用，Portal 服務的 roots 仍由 config.json 設定，Compose .env 的 NAS_TEST_ROOT 則是既有 bind source 設定。

The temporary container has no OAuth/config/state mounts or Web ports. The command observes metadata and command presence only and prints redacted JSON for review: no document names, source paths, account identifiers or file contents. A permission denial remains a valid blocked result; do not elevate the probe to root to force a pass. It reports the NAS kernel as seen by the container, but its Python/userspace and missing DSM tools describe the image, not the NAS host. DSM version may be unknown inside this container. Host-native directory/ACL capability still requires a separate approved host observation; no host system directories are mounted into the Web/probe container. Source permission changes, write-denial tests and A/B ACL fixtures remain restricted to isolated synthetic data.

## What the output can establish

The script records OS/kernel/CPU/Python, available descriptor operations, command **presence** only, and directory metadata access by the probe account. On Linux it reads fixed, bounded OS version/mount metadata and emits only whitelisted version fields, filesystem type and current-namespace read-only status. NAS package versions, identity source and email trust require manual evidence; unavailable fields stay unknown.

Directory traversal uses already-open descriptors, rejects symlink components, checks directory identity before/after open, excludes special/system directories, skips nested Linux mounts and different-device directories, and rejects hardlinked `.fig` metadata. It never opens source files or consumes compressed designs. Same-device mounts on platforms without readable Linux mount metadata, mount changes during traversal and concurrent directory relocation remain unproven. This is an administrative metadata probe, **not** the production safe byte opener or an ACL evaluator. A readable directory or `ro` flag does not attest that the expected NAS volume is online, nor that nested mounts are read-only.

The script never runs `synoacltool`, `synouser`, `synogroup`, `synoshare`, `getfacl` or Docker. A discovered executable has no verified method, output schema, supported version or DSM semantics. No invented `SYNO.API.*` method is used.

## Remaining live work

Record the target DSM/Container Manager/Drive Server versions, filesystem and ACL profile, local/LDAP/AD identity source, ordinary-user email editability, administrator trust source and identity lifecycle identifier. Determine a supported read-only resolver/evaluator on that exact NAS; record its actual documentation and observed schema before writing an adapter.

Using existing approved A/B test users and synthetic data, perform every applicable row of [ACL_ACCEPTANCE_MATRIX.md](../ACL_ACCEPTANCE_MATRIX.md). Compare each user's File Station/SMB behavior with the Portal, including group allow + user deny, non-inheritance, traverse without list, share/download restrictions, cache revocation, identity rebuild, unavailable helper, root unmount and symlink races. Keep each user's baseline separate from administrator observations. Include timestamp, upstream/Portal/provider versions, API/UI outcomes and redacted evidence.

No successful probe result enables production `dsm-strict`. M3 stays blocked until a native provider and safe read path pass the target NAS matrix. See [SYNOLOGY_CAPABILITY_AUDIT.md](SYNOLOGY_CAPABILITY_AUDIT.md) and [AUTHORIZATION_ADR.md](AUTHORIZATION_ADR.md).
