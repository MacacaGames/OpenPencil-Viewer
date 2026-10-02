# Manual NAS capability probe

This M0 probe observes metadata using the current process account. It never authorizes a Google user, switches identity, executes a NAS command, reads `.fig` bytes, opens a network connection, changes ACLs/accounts, or writes into the source tree. Its JSON always reports effective DSM authorization as unknown and `dsm_strict_ready: false`.

Run it manually only on an administrator-approved isolated root containing synthetic fixtures. No NAS access has been supplied or attempted by Codex. The probe does not create this NAS root. Do not use a production design share, an entire volume, an account directory, or an SSH automation to collect this evidence.

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

## What the output can establish

The script records OS/kernel/CPU/Python, available descriptor operations, command **presence** only, and directory metadata access by the probe account. On Linux it reads fixed, bounded OS version/mount metadata and emits only whitelisted version fields, filesystem type and current-namespace read-only status. NAS package versions, identity source and email trust require manual evidence; unavailable fields stay unknown.

Directory traversal uses already-open descriptors, rejects symlink components, checks directory identity before/after open, excludes special/system directories, skips nested Linux mounts and different-device directories, and rejects hardlinked `.fig` metadata. It never opens source files or consumes compressed designs. Same-device mounts on platforms without readable Linux mount metadata, mount changes during traversal and concurrent directory relocation remain unproven. This is an administrative metadata probe, **not** the production safe byte opener or an ACL evaluator. A readable directory or `ro` flag does not attest that the expected NAS volume is online, nor that nested mounts are read-only.

The script never runs `synoacltool`, `synouser`, `synogroup`, `synoshare`, `getfacl` or Docker. A discovered executable has no verified method, output schema, supported version or DSM semantics. No invented `SYNO.API.*` method is used.

## Remaining live work

Record the target DSM/Container Manager/Drive Server versions, filesystem and ACL profile, local/LDAP/AD identity source, ordinary-user email editability, administrator trust source and identity lifecycle identifier. Determine a supported read-only resolver/evaluator on that exact NAS; record its actual documentation and observed schema before writing an adapter.

Using existing approved A/B test users and synthetic data, perform every applicable row of [ACL_ACCEPTANCE_MATRIX.md](../ACL_ACCEPTANCE_MATRIX.md). Compare each user's File Station/SMB behavior with the Portal, including group allow + user deny, non-inheritance, traverse without list, share/download restrictions, cache revocation, identity rebuild, unavailable helper, root unmount and symlink races. Keep each user's baseline separate from administrator observations. Include timestamp, upstream/Portal/provider versions, API/UI outcomes and redacted evidence.

No successful probe result enables production `dsm-strict`. M3 stays blocked until a native provider and safe read path pass the target NAS matrix. See [SYNOLOGY_CAPABILITY_AUDIT.md](SYNOLOGY_CAPABILITY_AUDIT.md) and [AUTHORIZATION_ADR.md](AUTHORIZATION_ADR.md).
