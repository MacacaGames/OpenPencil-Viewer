# OpenPencil × Synology LAN Portal

Read DEVELOPMENT_PLAN.md, ACL_ACCEPTANCE_MATRIX.md, and docs/IMPLEMENTATION_STATUS.md.
This project is read-only. Do not develop write-back, Google Drive, or public collaboration.
Preserve sibling projects and the original handoff files. The official upstream submodule must stay pristine and pinned in upstream.lock.json. Read upstream ownership guides before making isolated build-tree patches.
Keep app internals in packages/upstream-adapter; retain the native UI. Enforce graph immutability and disable persistence and external document traffic, with tests.
Mock identities and ACLs are development-only. dsm-strict must fail closed until a native provider has passed the live NAS acceptance matrix. Do not infer user access from admin APIs or the service UID.
Do not SSH to a NAS, change accounts/ACLs, mount entire NAS volumes, or deploy production without explicit instructions. NAS probe scripts are read-only and manually run against isolated test roots.
Update docs/IMPLEMENTATION_STATUS.md with actual commands, results and blocked live checks at every milestone.
Run test, typecheck, verify-upstream, build and relevant browser tests for integration changes.
