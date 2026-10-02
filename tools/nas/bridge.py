#!/usr/bin/env python3
"""Protected, evidence-gated Unix broker for a separately verified DSM adapter.

No NAS command guesses, service-UID authorization, account edits or local-read
fallback. A native adapter must provide directory/authorize/open_authorized.
"""
import argparse
import contextlib
import fcntl
import hashlib
import http.server
import json
import os
import platform
import signal
import socket
import socketserver
import stat
import struct
import sys
import time
from pathlib import Path

CASES = {f"{prefix}{i:02}" for prefix, count in (("I", 12), ("A", 15), ("R", 10)) for i in range(1, count + 1)}
MAX_JSON = 4 * 1024 * 1024


class Blocked(Exception):
    pass


def canonical(path):
    if not isinstance(path, str) or not path.startswith("/") or path == "/" or "\x00" in path or "\\" in path:
        raise Blocked()
    if any(p in ("", ".", "..") for p in path.split("/")[1:]):
        raise Blocked()
    return path


def protected_bytes(path, limit, production):
    canonical(path)
    fd = os.open("/", os.O_RDONLY | os.O_DIRECTORY)
    try:
        components = path.split("/")[1:]
        for idx, component in enumerate(components):
            info = os.fstat(fd)
            if production and (info.st_uid != 0 or info.st_mode & 0o022):
                raise Blocked()
            flags = os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK
            if idx < len(components) - 1:
                flags |= os.O_DIRECTORY
            following = os.open(component, flags, dir_fd=fd)
            os.close(fd)
            fd = following
        before = os.fstat(fd)
        if not stat.S_ISREG(before.st_mode) or before.st_nlink != 1 or before.st_size > limit:
            raise Blocked()
        if production and (before.st_uid != 0 or before.st_mode & 0o022):
            raise Blocked()
        chunks = []
        size = 0
        while size <= limit:
            chunk = os.read(fd, min(65536, limit + 1 - size))
            if not chunk:
                break
            size += len(chunk)
            chunks.append(chunk)
        after = os.fstat(fd)
        if size != before.st_size or (before.st_size, before.st_mtime_ns, before.st_ctime_ns) != (after.st_size, after.st_mtime_ns, after.st_ctime_ns):
            raise Blocked()
        return b"".join(chunks)
    finally:
        os.close(fd)


def revision(info):
    return ":".join(str(v) for v in (info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns, info.st_ctime_ns))


def root_identity(path):
    canonical(path)
    components = path.split("/")[1:]
    if len(components) < 2 or components[0] in ("etc", "proc", "sys", "dev", "run", "home", "homes"):
        raise Blocked()
    fd = os.open("/", os.O_RDONLY | os.O_DIRECTORY)
    try:
        for component in components:
            following = os.open(component, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
            os.close(fd)
            fd = following
        info = os.fstat(fd)
        return f"{info.st_dev}:{info.st_ino}"
    finally:
        os.close(fd)


def fields(value, expected):
    if not isinstance(value, dict) or set(value) != set(expected):
        raise Blocked()


def bounded_text(value, limit=256):
    if not isinstance(value, str) or not 0 < len(value) <= limit or "\x00" in value:
        raise Blocked()
    return value


class Broker:
    def __init__(self, path):
        # Root-owned production config/module/evidence; development never claims live.
        raw = protected_bytes(path, 65536, False)
        self.config = json.loads(raw)
        fields(self.config, ("version", "environment", "socketPath", "instanceId", "providerId", "adapterPath", "acceptancePath", "roots", "maxFileBytes"))
        if self.config["version"] != 1 or self.config["environment"] not in ("production", "development"):
            raise Blocked()
        self.production = self.config["environment"] == "production"
        self.config_path, self.config_bytes = path, raw
        if self.production:
            if os.geteuid() != 0 or platform.system() != "Linux":
                raise Blocked()
            if protected_bytes(path, 65536, True) != raw:
                raise Blocked()
        for key in ("instanceId", "providerId"):
            bounded_text(self.config[key])
        for key in ("socketPath", "adapterPath", "acceptancePath"):
            canonical(self.config[key])
        if not isinstance(self.config["roots"], list) or not 1 <= len(self.config["roots"]) <= 64:
            raise Blocked()
        root_ids = []
        for root in self.config["roots"]:
            fields(root, ("id", "path"))
            root_ids.append(bounded_text(root["id"]))
            canonical(root["path"])
            if not self.production and not (root["path"].startswith("/private/tmp/") or root["path"].startswith("/tmp/") or "/.work/" in root["path"]):
                raise Blocked()
        if len(set(root_ids)) != len(root_ids) or type(self.config["maxFileBytes"]) is not int or not 1 <= self.config["maxFileBytes"] <= 536870912:
            raise Blocked()
        self.adapter_bytes = protected_bytes(self.config["adapterPath"], 1048576, self.production)
        self.broker_bytes = protected_bytes(str(Path(__file__).absolute()), 1048576, self.production)
        # Execute exactly the checked bytes: no re-open/import TOCTOU or .pyc writes.
        namespace = {"__name__": "portal_native_adapter", "__file__": self.config["adapterPath"]}
        exec(compile(self.adapter_bytes, self.config["adapterPath"], "exec"), namespace)
        self.adapter = namespace["NativeAdapter"](self.config)

    def profile(self):
        if protected_bytes(self.config_path, 65536, self.production) != self.config_bytes or protected_bytes(str(Path(__file__).absolute()), 1048576, self.production) != self.broker_bytes:
            raise Blocked()
        native = self.adapter.profile()
        fields(native, ("dsmVersion", "directorySourceId", "authorizationSourceId", "identityLifecycle", "effectiveAcl", "shareRestrictions", "sameObjectRead"))
        if any(native[key] is not True for key in ("identityLifecycle", "effectiveAcl", "shareRestrictions", "sameObjectRead")):
            raise Blocked()
        for key in ("dsmVersion", "directorySourceId", "authorizationSourceId"):
            bounded_text(native[key])
        current_adapter = protected_bytes(self.config["adapterPath"], 1048576, self.production)
        if current_adapter != self.adapter_bytes:
            raise Blocked()
        roots = [{"id": r["id"], "identity": root_identity(r["path"])} for r in self.config["roots"]]
        return {"instanceId": self.config["instanceId"], "providerId": self.config["providerId"],
                "system": platform.system(), "kernel": platform.release(), "architecture": platform.machine(),
                "brokerSha256": hashlib.sha256(self.broker_bytes).hexdigest(),
                "adapterSha256": hashlib.sha256(self.adapter_bytes).hexdigest(), "native": native,
                "roots": roots, "maxFileBytes": self.config["maxFileBytes"]}

    def acceptance(self):
        raw = protected_bytes(self.config["acceptancePath"], 1048576, self.production)
        evidence = json.loads(raw)
        fields(evidence, ("version", "kind", "profile", "observedAt", "expiresAt", "cases"))
        kind = "live-nas" if self.production else "synthetic"
        now = int(time.time() * 1000)
        if evidence["version"] != 1 or evidence["kind"] != kind or evidence["profile"] != self.profile():
            raise Blocked()
        if type(evidence["observedAt"]) is not int or type(evidence["expiresAt"]) is not int or not now - 90 * 86400000 <= evidence["observedAt"] <= now + 30000 or not now < evidence["expiresAt"] <= evidence["observedAt"] + 90 * 86400000:
            raise Blocked()
        if not isinstance(evidence["cases"], list) or len(evidence["cases"]) != len(CASES):
            raise Blocked()
        seen = set()
        for case in evidence["cases"]:
            fields(case, ("id", "passed", "evidenceRef"))
            bounded_text(case["evidenceRef"])
            if case["id"] not in CASES or case["id"] in seen or case["passed"] is not True:
                raise Blocked()
            seen.add(case["id"])
        return hashlib.sha256(raw).hexdigest(), kind

    def status(self):
        now = int(time.time() * 1000)
        result = {"version": 1, "ready": False, "instanceId": self.config["instanceId"],
                  "providerId": self.config["providerId"], "acceptanceSha256": None, "evidenceKind": None,
                  "observedAt": now, "expiresAt": now + 10000, "roots": []}
        try:
            digest, kind = self.acceptance()
            result.update(ready=True, acceptanceSha256=digest, evidenceKind=kind, roots=self.profile()["roots"])
        except (Blocked, OSError, ValueError, KeyError, RuntimeError):
            pass
        return result

    def directory(self):
        self.acceptance()
        snapshot = self.adapter.directory()
        fields(snapshot, ("version", "instanceId", "source", "observedAt", "expiresAt", "principals"))
        now = int(time.time() * 1000)
        if snapshot["version"] != 1 or snapshot["instanceId"] != self.config["instanceId"] or snapshot["source"] != "native-dsm" or type(snapshot["observedAt"]) is not int or type(snapshot["expiresAt"]) is not int or not now - 300000 <= snapshot["observedAt"] <= now + 30000 or not now < snapshot["expiresAt"] <= snapshot["observedAt"] + 300000:
            raise Blocked()
        if not isinstance(snapshot["principals"], list) or len(snapshot["principals"]) > 10000:
            raise Blocked()
        keys = set()
        for principal in snapshot["principals"]:
            fields(principal, ("key", "generation", "username", "email", "enabled", "trustedEmail", "system", "groups"))
            for key in ("key", "generation", "username", "email"):
                bounded_text(principal[key])
            if principal["key"] in keys or any(type(principal[key]) is not bool for key in ("enabled", "trustedEmail", "system")) or not isinstance(principal["groups"], list) or len(principal["groups"]) > 256:
                raise Blocked()
            for group in principal["groups"]:
                bounded_text(group)
            keys.add(principal["key"])
        return snapshot

    def target(self, value):
        fields(value, ("version", "instanceId", "principalKey", "generation", "rootId", "rootIdentity", "relative", "kind", "size", "revision", "maxFileBytes"))
        if value["version"] != 1 or value["instanceId"] != self.config["instanceId"] or value["kind"] not in ("file", "folder") or type(value["size"]) is not int or not 0 <= value["size"] <= self.config["maxFileBytes"] or value["maxFileBytes"] != self.config["maxFileBytes"]:
            raise Blocked()
        for key in ("principalKey", "generation", "rootId", "rootIdentity", "revision"):
            bounded_text(value[key])
        relative = value["relative"]
        if not isinstance(relative, str) or len(relative) > 4096 or any(c in relative for c in ("\\", "%", "\x00")) or relative and any(p in ("", ".", "..", "#recycle", "#snapshot", "@eaDir", "@SynologyDrive", ".git") for p in relative.split("/")):
            raise Blocked()
        if value["kind"] == "file" and (not relative.lower().endswith(".fig") or not relative):
            raise Blocked()
        root = next((r for r in self.config["roots"] if r["id"] == value["rootId"]), None)
        if root is None or root_identity(root["path"]) != value["rootIdentity"]:
            raise Blocked()
        matches = [p for p in self.directory()["principals"] if p["key"] == value["principalKey"]]
        if len(matches) != 1:
            raise Blocked()
        principal = matches[0]
        if principal["generation"] != value["generation"] or principal["enabled"] is not True or principal["trustedEmail"] is not True or principal["system"] is not False or principal["username"].lower() in ("root", "admin", "guest"):
            raise Blocked()
        # The adapter resolves native credentials itself. UID/groups are never
        # taken from this request, and every operation rechecks live identity.
        return principal

    @contextlib.contextmanager
    def open_authorized(self, value):
        principal = self.target(value)
        if value["kind"] != "file":
            raise Blocked()
        if self.adapter.authorize(principal, value) is not True:
            raise Blocked()
        # There is deliberately no os.open(path) fallback in the broker.
        with self.adapter.open_authorized(principal, value) as (fd, rootfd):
            info = os.fstat(fd)
            rootinfo = os.fstat(rootfd)
            if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or info.st_dev != rootinfo.st_dev or not stat.S_ISDIR(rootinfo.st_mode) or f"{rootinfo.st_dev}:{rootinfo.st_ino}" != value["rootIdentity"] or info.st_size != value["size"] or revision(info) != value["revision"] or fcntl.fcntl(fd, fcntl.F_GETFL) & os.O_ACCMODE != os.O_RDONLY:
                raise Blocked()
            yield fd, info


class Handler(http.server.BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.0"

    def log_message(self, *args):
        pass

    def do_POST(self):
        signal.alarm(30)
        started = False
        try:
            self.connection.settimeout(15)
            pid, uid, gid = struct.unpack("3i", self.connection.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, struct.calcsize("3i")))
            expected_uid = 10001 if self.server.broker.production else os.geteuid()
            if uid != expected_uid or self.path not in ("/status", "/directory", "/authorize", "/stat", "/read") or self.headers.get("Transfer-Encoding") or self.headers.get("Content-Type") != "application/json":
                raise Blocked()
            size = int(self.headers.get("Content-Length", "0"))
            if not 0 < size <= 16384:
                raise Blocked()
            value = json.loads(self.rfile.read(size))
            if self.path in ("/status", "/directory"):
                fields(value, ("version",))
                if value["version"] != 1:
                    raise Blocked()
                result = self.server.broker.status() if self.path == "/status" else self.server.broker.directory()
            elif self.path == "/authorize":
                principal = self.server.broker.target(value)
                allowed = self.server.broker.adapter.authorize(principal, value)
                if type(allowed) is not bool:
                    raise Blocked()
                result = {"version": 1, "allowed": allowed}
            else:
                with self.server.broker.open_authorized(value) as (fd, before):
                    result = {key: value[key] for key in ("principalKey", "generation", "rootId", "rootIdentity", "relative", "size", "revision")}
                    result["version"] = 1
                    if self.path == "/stat":
                        self.json_response(result)
                        return
                    header = json.dumps(result, separators=(",", ":")).encode() + b"\n"
                    self.send_response(200)
                    self.send_header("Content-Type", "application/octet-stream")
                    self.send_header("Content-Length", str(len(header) + before.st_size))
                    self.end_headers()
                    started = True
                    self.wfile.write(header)
                    pending = os.read(fd, min(65536, before.st_size + 1))
                    received = len(pending)
                    while True:
                        following = os.read(fd, 65536)
                        received += len(following)
                        if received > before.st_size or revision(os.fstat(fd)) != revision(before):
                            raise Blocked()
                        if not following:
                            break
                        self.wfile.write(pending)
                        pending = following
                    if received != before.st_size or revision(os.fstat(fd)) != revision(before):
                        raise Blocked()
                    self.wfile.write(pending)
                    return
            self.json_response(result)
        except (Exception, BrokenPipeError):
            if not started:
                self.json_response({"error": "native-bridge-unavailable"}, 503)
            self.close_connection = True
        finally:
            signal.alarm(0)

    def json_response(self, value, status=200):
        raw = json.dumps(value, separators=(",", ":")).encode()
        if len(raw) > MAX_JSON:
            raise Blocked()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)


class Server(socketserver.ForkingMixIn, socketserver.UnixStreamServer):
    max_children = 16
    block_on_close = False


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", required=True)
    parser.add_argument("--profile", action="store_true", help="print current binding profile, never generates passing evidence")
    args = parser.parse_args()
    broker = Broker(args.config)
    if args.profile:
        print(json.dumps(broker.profile(), sort_keys=True))
        return
    if platform.system() != "Linux":
        raise Blocked()
    path = broker.config["socketPath"]
    parent = Path(path).parent
    if not parent.is_dir() or parent.is_symlink() or parent.stat().st_mode & 0o022 or broker.production and parent.stat().st_uid != 0:
        raise Blocked()
    # A stale/unexpected socket is an operator problem: never unlink it blindly.
    with Server(path, Handler) as server:
        server.broker = broker
        if broker.production:
            os.chown(path, 0, 10001)
        os.chmod(path, 0o660)
        try:
            server.serve_forever()
        finally:
            os.unlink(path)


if __name__ == "__main__":
    try:
        main()
    except (Exception, KeyboardInterrupt):
        sys.stderr.write("native-bridge-unavailable\n")
        sys.exit(2)
