#!/usr/bin/env python3
"""Manual, metadata-only capability probe; never a DSM authorization provider.

No subprocess, network, identity switch, account database or source-byte reads.
Only --self-test creates files, exclusively in a temporary synthetic local tree.
"""

import argparse
import datetime
import errno
import json
import os
import platform
import re
import shutil
import stat
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest import mock


EXCLUDED = frozenset({"#recycle", "#snapshot", "@eaDir", "@SynologyDrive", ".git"})
COMMANDS = ("synoacltool", "synouser", "synogroup", "synoshare", "getfacl", "findmnt", "python3", "docker")
FIXED_COMMAND_DIRS = ("/usr/syno/bin", "/usr/syno/sbin", "/usr/bin", "/usr/sbin")


class ProbeError(Exception):
    def __init__(self, code):
        super().__init__(code)
        self.code = code


def capabilities():
    return {
        "open_dir_fd": os.open in os.supports_dir_fd,
        "stat_dir_fd": os.stat in os.supports_dir_fd,
        "stat_no_follow": os.stat in os.supports_follow_symlinks,
        "scandir_fd": os.scandir in os.supports_fd,
        "o_directory": hasattr(os, "O_DIRECTORY"),
        "o_nofollow": hasattr(os, "O_NOFOLLOW"),
    }


def validate_root(root):
    if not root.startswith("/") or "\x00" in root:
        raise ProbeError("absolute_isolated_root_required")
    parts = root.split("/")[1:]
    if any(p in ("", ".", "..") for p in parts):
        raise ProbeError("noncanonical_root_rejected")
    if len(parts) < 2 or re.fullmatch(r"volume\d+", "/".join(parts)):
        raise ProbeError("whole_host_or_volume_root_rejected")
    if parts[0] in {"etc", "dev", "proc", "sys", "run", "home", "homes"}:
        raise ProbeError("system_or_account_root_rejected")
    if root.startswith("/private/etc/") or root.startswith("/var/packages/"):
        raise ProbeError("system_or_account_root_rejected")
    return parts


def open_directory_chain(root):
    parts = validate_root(root)
    if not all(capabilities().values()):
        raise ProbeError("safe_descriptor_operations_unavailable")
    flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | getattr(os, "O_CLOEXEC", 0)
    current = os.open("/", flags)
    try:
        for part in parts:
            next_fd = os.open(part, flags, dir_fd=current)
            os.close(current)
            current = next_fd
        return current
    except BaseException:
        os.close(current)
        raise


def read_fixed_small_file(path, limit=65536):
    """Only callers' fixed non-secret OS metadata paths are used."""
    fd = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0))
    try:
        observed = os.fstat(fd)
        if not stat.S_ISREG(observed.st_mode) or observed.st_size > limit:
            return None
        chunks = []
        remaining = limit + 1
        while remaining:
            chunk = os.read(fd, min(4096, remaining))
            if not chunk:
                break
            chunks.append(chunk)
            remaining -= len(chunk)
        raw = b"".join(chunks)
        if len(raw) > limit:
            return None
        return raw.decode("utf-8", errors="strict")
    finally:
        os.close(fd)


def dsm_version():
    if platform.system() != "Linux":
        return {"status": "unavailable_on_this_platform"}
    for candidate in ("/etc.defaults/VERSION", "/etc/VERSION"):
        try:
            raw = read_fixed_small_file(candidate)
        except (OSError, UnicodeError):
            continue
        if raw is None:
            continue
        values = {}
        for key in ("majorversion", "minorversion", "productversion", "buildnumber", "smallfixnumber"):
            match = re.search(r"^" + key + r'="?([0-9.]+)"?\s*$', raw, re.MULTILINE)
            if match:
                values[key] = match.group(1)
        if values.get("majorversion") and values.get("buildnumber"):
            return {"status": "observed_from_version_file_not_attested", "version": values}
    return {"status": "unknown_version_metadata_unavailable"}


def mount_observation(root):
    """Never emit mountpoint, source, host, mount options containing paths, or IDs."""
    unknown = {"status": "unknown", "read_only": None, "filesystem_type": None,
               "nested_mounts_seen": None, "source_online_verified": False}
    if platform.system() != "Linux":
        return unknown, set()
    try:
        raw = read_fixed_small_file("/proc/self/mountinfo", 4 * 1024 * 1024)
    except (OSError, UnicodeError):
        return unknown, set()
    if raw is None:
        return unknown, set()
    records = []
    for line in raw.splitlines():
        fields = line.split()
        if "-" not in fields or len(fields) < 10:
            continue
        separator = fields.index("-")
        if separator + 3 >= len(fields):
            continue
        point = re.sub(r"\\([0-7]{3})", lambda m: chr(int(m.group(1), 8)), fields[4])
        fs_type = fields[separator + 1]
        if not re.fullmatch(r"[A-Za-z0-9_.-]+", fs_type):
            continue
        records.append((point, fields[5].split(","), fs_type))
    ancestors = [r for r in records if root == r[0] or root.startswith(r[0].rstrip("/") + "/")]
    nested = {r[0][len(root) + 1:] for r in records if r[0].startswith(root + "/")}
    if not ancestors:
        return unknown, nested
    selected = max(ancestors, key=lambda r: len(r[0]))
    return {"status": "observed_in_current_mount_namespace",
            "read_only": "ro" in selected[1], "filesystem_type": selected[2],
            "nested_mounts_seen": len(nested), "source_online_verified": False}, nested


def scan_metadata(root, max_entries=10000, max_depth=16, max_seconds=15):
    fd = open_directory_chain(root)
    try:
        root_stat = os.fstat(fd)
        mount, nested_mounts = mount_observation(root)
        counts = {"entries_observed": 0, "directories_scanned": 0, "regular_fig_metadata": 0,
                  "fig_metadata_bytes": 0, "symlinks_skipped": 0, "special_files_skipped": 0,
                  "hardlinked_figs_rejected": 0, "cross_device_directories_skipped": 0,
                  "nested_mounts_skipped": 0, "excluded_directories_skipped": 0,
                  "entry_errors": 0, "directory_identity_changes": 0}
        limit_reasons = set()
        start = time.monotonic()
        flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | getattr(os, "O_CLOEXEC", 0)

        def walk(directory_fd, depth, relative):
            if time.monotonic() - start >= max_seconds:
                limit_reasons.add("time_limit")
                return
            counts["directories_scanned"] += 1
            try:
                with os.scandir(directory_fd) as entries:
                    for entry in entries:
                        if counts["entries_observed"] >= max_entries:
                            limit_reasons.add("entry_limit")
                            return
                        if time.monotonic() - start >= max_seconds:
                            limit_reasons.add("time_limit")
                            return
                        counts["entries_observed"] += 1
                        try:
                            entry_relative = relative + "/" + entry.name if relative else entry.name
                            before = os.stat(entry.name, dir_fd=directory_fd, follow_symlinks=False)
                            if entry_relative in nested_mounts:
                                counts["nested_mounts_skipped"] += 1
                            elif stat.S_ISLNK(before.st_mode):
                                counts["symlinks_skipped"] += 1
                            elif stat.S_ISDIR(before.st_mode):
                                if entry.name in EXCLUDED:
                                    counts["excluded_directories_skipped"] += 1
                                elif before.st_dev != root_stat.st_dev:
                                    counts["cross_device_directories_skipped"] += 1
                                elif depth >= max_depth:
                                    limit_reasons.add("depth_limit")
                                else:
                                    child = os.open(entry.name, flags, dir_fd=directory_fd)
                                    try:
                                        after = os.fstat(child)
                                        if (before.st_dev, before.st_ino) != (after.st_dev, after.st_ino):
                                            counts["directory_identity_changes"] += 1
                                        else:
                                            walk(child, depth + 1, entry_relative)
                                    finally:
                                        os.close(child)
                            elif stat.S_ISREG(before.st_mode):
                                if entry.name.lower().endswith(".fig"):
                                    if before.st_nlink != 1:
                                        counts["hardlinked_figs_rejected"] += 1
                                    elif before.st_dev != root_stat.st_dev:
                                        counts["special_files_skipped"] += 1
                                    else:
                                        counts["regular_fig_metadata"] += 1
                                        counts["fig_metadata_bytes"] += before.st_size
                            else:
                                counts["special_files_skipped"] += 1
                        except OSError:
                            counts["entry_errors"] += 1
            except OSError:
                counts["entry_errors"] += 1

        walk(fd, 0, "")
        changed = os.fstat(fd)
        root_changed = (root_stat.st_mtime_ns, root_stat.st_ctime_ns) != (changed.st_mtime_ns, changed.st_ctime_ns)
        partial = bool(limit_reasons or counts["entry_errors"] or counts["directory_identity_changes"] or root_changed)
        return {"status": "partial" if partial else "completed_metadata_observation",
                "counts": counts, "limit_reasons": sorted(limit_reasons), "root_metadata_changed": root_changed,
                "source_bytes_read": 0, "source_writes_attempted": 0,
                "source_availability": "directory_accessible_by_probe_account_only", "mount": mount}
    finally:
        os.close(fd)


def report(root, context, **limits):
    observed_commands = {}
    for command in COMMANDS:
        present = shutil.which(command) is not None or any(
            os.path.isfile(directory + "/" + command) and os.access(directory + "/" + command, os.X_OK)
            for directory in FIXED_COMMAND_DIRS)
        observed_commands[command] = {"present": present, "executed": False, "schema_verified": False}
    result = {
        "schema_version": 1,
        "observed_at_utc": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "operator_declared_context": context,
        "environment": {"system": platform.system(), "kernel_release": platform.release(),
                        "cpu_architecture": platform.machine(), "python_version": platform.python_version(),
                        "probe_account_is_root": hasattr(os, "geteuid") and os.geteuid() == 0,
                        "supplementary_group_count": len(os.getgroups()) if hasattr(os, "getgroups") else None,
                        "dsm": dsm_version(), "container_manager_version": "not_observed",
                        "drive_server_version": "not_observed", "directory_source": "not_observed"},
        "descriptor_capabilities": capabilities(),
        "command_presence_only": observed_commands,
        "effective_dsm_authorization": {"status": "unknown", "mapped_principal_evaluated": False,
                                        "native_acl_schema_verified": False, "live_matrix_passed": False,
                                        "dsm_strict_ready": False},
        "redaction": {"root_paths": "omitted", "file_names": "omitted", "host_names": "omitted",
                      "account_ids_names_emails": "omitted", "mount_sources": "omitted"},
        "scope": {"network_requests": 0, "commands_executed": 0, "identity_switches": 0,
                  "account_database_reads": 0, "production_authorization_evidence": False},
    }
    try:
        result["service_account_metadata_observation"] = scan_metadata(root, **limits)
    except ProbeError as error:
        result["service_account_metadata_observation"] = {"status": "blocked", "reason": error.code}
    except OSError as error:
        reason = {errno.ENOENT: "root_unavailable", errno.EACCES: "probe_account_denied",
                  errno.EPERM: "probe_account_denied", errno.ELOOP: "symlink_rejected",
                  errno.ENOTDIR: "nondirectory_or_symlink_rejected"}.get(error.errno, "filesystem_error")
        result["service_account_metadata_observation"] = {"status": "blocked", "reason": reason}
    return result


class SyntheticTests(unittest.TestCase):
    def setUp(self):
        temporary_parent = "/private/tmp" if Path("/private/tmp").is_dir() else "/tmp"
        self.temp = tempfile.TemporaryDirectory(prefix="portal-probe-self-test-", dir=temporary_parent)
        self.root = Path(self.temp.name) / "isolated"
        self.root.mkdir()

    def tearDown(self):
        self.temp.cleanup()

    def scan(self, **limits):
        return scan_metadata(str(self.root), **limits)

    def test_metadata_only_and_source_unchanged(self):
        source = self.root / "private-customer.fig"
        source.write_bytes(b"synthetic test bytes")
        before = source.stat()
        observed = self.scan()
        after = source.stat()
        self.assertEqual(observed["counts"]["regular_fig_metadata"], 1)
        self.assertEqual(observed["source_bytes_read"], 0)
        self.assertEqual((before.st_size, before.st_mtime_ns), (after.st_size, after.st_mtime_ns))
        self.assertEqual(source.read_bytes(), b"synthetic test bytes")

    def test_symlinks_never_followed(self):
        outside = Path(self.temp.name) / "outside"
        outside.mkdir()
        (outside / "secret.fig").write_bytes(b"outside")
        (self.root / "link").symlink_to(outside, target_is_directory=True)
        (self.root / "link.fig").symlink_to(outside / "secret.fig")
        observed = self.scan()["counts"]
        self.assertEqual(observed["regular_fig_metadata"], 0)
        self.assertEqual(observed["symlinks_skipped"], 2)

    def test_special_files_and_fig_directories(self):
        os.mkfifo(self.root / "pipe.fig")
        (self.root / "directory.fig").mkdir()
        observed = self.scan()["counts"]
        self.assertEqual(observed["regular_fig_metadata"], 0)
        self.assertEqual(observed["special_files_skipped"], 1)

    def test_hardlinks_rejected(self):
        source = self.root / "one.fig"
        source.write_bytes(b"fixture")
        os.link(source, self.root / "two.fig")
        observed = self.scan()["counts"]
        self.assertEqual(observed["regular_fig_metadata"], 0)
        self.assertEqual(observed["hardlinked_figs_rejected"], 2)

    def test_excluded_system_directories(self):
        for directory in EXCLUDED:
            child = self.root / directory
            child.mkdir()
            (child / "secret.fig").write_bytes(b"fixture")
        self.assertEqual(self.scan()["counts"]["regular_fig_metadata"], 0)

    def test_root_and_intermediate_symlinks_rejected(self):
        link = Path(self.temp.name) / "link"
        link.symlink_to(self.root, target_is_directory=True)
        for root in (str(link), str(link / "nested")):
            self.assertEqual(report(root, "local-test")["service_account_metadata_observation"]["status"], "blocked")

    def test_missing_source_is_blocked_not_empty(self):
        observed = report(str(self.root / "missing"), "local-test")["service_account_metadata_observation"]
        self.assertEqual(observed, {"status": "blocked", "reason": "root_unavailable"})

    def test_missing_safe_capability_is_blocked(self):
        unsupported = capabilities()
        unsupported["o_nofollow"] = False
        with mock.patch(__name__ + ".capabilities", return_value=unsupported):
            observed = report(str(self.root), "local-test")["service_account_metadata_observation"]
        self.assertEqual(observed, {"status": "blocked", "reason": "safe_descriptor_operations_unavailable"})

    def test_directory_swapped_to_symlink_during_open_is_partial(self):
        child = self.root / "child"
        child.mkdir()
        outside = Path(self.temp.name) / "outside"
        outside.mkdir()
        (outside / "secret.fig").write_bytes(b"outside")
        real_open = os.open
        supported = capabilities()

        def raced_open(path, flags, *args, **kwargs):
            if path == "child" and "dir_fd" in kwargs:
                child.rename(Path(self.temp.name) / "moved")
                child.symlink_to(outside, target_is_directory=True)
            return real_open(path, flags, *args, **kwargs)

        with mock.patch(__name__ + ".capabilities", return_value=supported), mock.patch.object(os, "open", side_effect=raced_open):
            observed = self.scan()
        self.assertEqual(observed["status"], "partial")
        self.assertEqual(observed["counts"]["regular_fig_metadata"], 0)
        self.assertGreaterEqual(observed["counts"]["entry_errors"], 1)

    def test_nested_same_device_mount_files_are_skipped(self):
        (self.root / "mounted.fig").write_bytes(b"fixture")
        with mock.patch(__name__ + ".mount_observation", return_value=({"status": "synthetic"}, {"mounted.fig"})):
            observed = self.scan()["counts"]
        self.assertEqual(observed["regular_fig_metadata"], 0)
        self.assertEqual(observed["nested_mounts_skipped"], 1)

    def test_unsafe_roots_rejected(self):
        for root in ("/", "/volume1", "/etc/passwords", "/dev/fd", "relative/path", str(self.root) + "/../outside"):
            with self.assertRaises(ProbeError):
                validate_root(root)

    def test_entry_and_depth_limits_are_partial(self):
        for i in range(3):
            (self.root / (str(i) + ".fig")).write_bytes(b"fixture")
        self.assertEqual(self.scan(max_entries=1)["status"], "partial")
        (self.root / "child").mkdir()
        self.assertEqual(self.scan(max_depth=0)["limit_reasons"], ["depth_limit"])

    def test_output_redacts_private_names_paths_and_never_grants(self):
        (self.root / "private-customer.fig").write_bytes(b"SECRET-FILE-BYTES")
        observed = report(str(self.root), "local-test")
        serialized = json.dumps(observed)
        for secret in (str(self.root), "private-customer", "SECRET-FILE-BYTES"):
            self.assertNotIn(secret, serialized)
        self.assertFalse(observed["effective_dsm_authorization"]["dsm_strict_ready"])
        self.assertFalse(observed["effective_dsm_authorization"]["mapped_principal_evaluated"])
        self.assertTrue(all(not c["executed"] for c in observed["command_presence_only"].values()))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", help="absolute, canonical isolated synthetic test root (never emitted)")
    parser.add_argument("--context", choices=("nas-host", "container", "local-test"), help="operator declaration, not attestation")
    parser.add_argument("--ack-isolated-test-root", action="store_true")
    parser.add_argument("--max-entries", type=int, default=10000)
    parser.add_argument("--max-depth", type=int, default=16)
    parser.add_argument("--max-seconds", type=int, default=15)
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    if args.self_test:
        if args.root or args.context or args.ack_isolated_test_root:
            parser.error("self-test cannot be combined with a source root")
        suite = unittest.defaultTestLoader.loadTestsFromTestCase(SyntheticTests)
        return 0 if unittest.TextTestRunner(verbosity=2).run(suite).wasSuccessful() else 1
    if not args.root or not args.context or not args.ack_isolated_test_root:
        parser.error("--root, --context and --ack-isolated-test-root are required")
    if not (1 <= args.max_entries <= 100000 and 0 <= args.max_depth <= 64 and 1 <= args.max_seconds <= 60):
        parser.error("limits must be entries 1..100000, depth 0..64, seconds 1..60")
    observed = report(args.root, args.context, max_entries=args.max_entries,
                      max_depth=args.max_depth, max_seconds=args.max_seconds)
    print(json.dumps(observed, indent=2, sort_keys=True))
    return 0 if observed["service_account_metadata_observation"]["status"] == "completed_metadata_observation" else 2


if __name__ == "__main__":
    sys.exit(main())
