# ADR 001 — Fail-closed DSM authorization and evidence-gated native reads

Date: 2026-10-01; updated 2026-10-02 (Asia/Taipei). Status: accepted fail-closed boundary; broker transport implemented, native provider selection blocked pending target NAS evidence.

## Context

The product requires Google-only Workspace authentication, a trusted unique same-email mapping to an existing NAS principal, and the principal's effective NAS permissions on each `.fig`. Google subject/email proves identity; it does not prove NAS access. A RO bind mount prevents original-file writes but grants the service account its own filesystem view. The development Mock demonstrates Portal behavior and cannot demonstrate DSM permission equivalence.

No target NAS native directory/ACL output is available for M0/M3. The operator supplied DS1821+/DSM7.4.1-90080/Container Manager24.0.2-1706, local accounts and non-editable employee email policy. The [File Station API documentation](https://global.download.synology.com/download/Document/Software/DeveloperGuide/Package/FileStation/All/enu/Synology_File_Station_API_Guide.pdf) ties permissions to the authenticated NAS API user. Its published `CheckPermission.write` cannot be assumed to evaluate an arbitrary Google-mapped principal's read rights. No supported arbitrary-principal API, trusted directory schema or native ACL command has been established.

## Decision

Production mode is `dsm-strict`, with readiness and file access denied until a native identity/authorization provider and safe read path have passed all applicable rows of the target [ACL matrix](../ACL_ACCEPTANCE_MATRIX.md). Unknown, stale, disabled, ambiguous, rebuilt or untrusted directory identity and unavailable/unparseable authorization evidence deny access. There is no fallback to administrator File Station permission, process UID, Unix mode bits, parent-folder allow, Mock ACL or root allowlist.

Apply authorization to list/search, counts, roots, metadata, thumbnail/cache validation, HEAD and content. Known opaque IDs confer no access. Follow the conservative matrix policy for traverse-without-list: refuse navigation and descendant direct URLs through that directory. A permitted parent is not a permitted child. Recheck authorization for a new content request and bind the decision to the actual securely opened object.

M0 provides a manual read-only metadata probe, not an authorization bridge. Native identity APIs, CLI invocations and output schemas must come from observed supported capabilities on the exact target version. No NAS commands, account changes, email edits, privilege grants, SSH, new ACLs or production deployment are authorized by this ADR.

## Native integration options awaiting evidence

The Portal/broker boundary is implemented as described in [NAS_BRIDGE.md](NAS_BRIDGE.md): protected Unix socket, fresh native directory, per-record authorization and brokered streams, bound to reviewed live evidence and the current NAS/provider/root profile. The blocked adapter example is not a native DSM provider. The actual native mechanism still requires supported target evidence; this transport does not enable production.

1. **Local-filesystem:** a verified native provider evaluates the mapped principal's traverse/list/read and all applicable share restrictions, then a tested root-confined opener supplies a descriptor for that same object. Approval cannot use the Web service account's `access()` result. Old-kernel fallback must retain confinement, no-follow, regular-file checks and race protection or refuse reads.
2. **NAS-brokered-read:** a small host helper evaluates/opens/streams as the mapped native principal through a supported mechanism. Principal-isolated workers must establish correct supplementary groups, UID/GID and lowered privileges; a shared Node process must not switch identities. The helper must account for share/service restrictions, not merely POSIX reads. Expose only fixed read-only operations and configured roots via a protected local socket, or an authenticated protected LAN connection for the separate Unraid profile.

Neither option is selected as workable without live evidence. If the NAS can enforce permissions only on its host, choose a broker and document its narrow privilege/upgrade boundary after acceptance. Do not grant the Web container `privileged`, mount the entire volume, expose Docker socket/account databases or use broad chmod. Do not install a helper based on a guessed `synoacltool` parser.

## Trust and lifecycle requirements

Use verified Google `(iss, sub)` and independently trusted NAS identity provenance. Map only an enabled unique principal with an administrator-controlled email trust source and a lifecycle/generation identifier. A user-editable NAS email cannot independently acquire another principal. New subject, changed email, recreated NAS identity/UID, duplicates and unresolved directory profile need manual review. Never request a NAS password from employees or introduce Directory/Drive scopes, offline Google access or a new LDAP subscription for this MVP.

Directory and permission evidence need bounded freshness; unavailability is not an empty directory. Refresh/revoke behavior and interrupted-stream policy must be measured on the native provider. Previously rendered bytes cannot be recalled. SQLite stores mapping/session/index/audit metadata only; disposable thumbnails cannot become an alternate design source.

## Consequences and validation

M1 may progress with synthetic fixtures while live NAS is blocked. M2 can implement offline validation and mapping failures; real Google/NAS outcomes remain separately not run. M3 is the production hard gate. M5 may deliver Docker/CI/runbooks while production release remains denied.

Accept a native profile only with redacted per-user NAS baseline and Portal API/UI evidence for allow/deny/inheritance/share restrictions, revoke/cache, disabled/recreated identities, source/helper failure, mount confinement and races. All original content remains RO with no write API. Native versions and the precise local/LDAP/AD support scope must be recorded in [SYNOLOGY_CAPABILITY_AUDIT.md](SYNOLOGY_CAPABILITY_AUDIT.md).

Rejected shortcuts: administrator-session `perm.acl`, filesystem service UID, standalone mode-bit/ACL-text parsers without equivalence proof, and implicit `root-allowlist` downgrade. If the user later authorizes a different production policy, it requires a separate decision and acceptance record.
