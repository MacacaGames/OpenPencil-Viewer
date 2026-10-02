"""Synthetic broker checks; never native DSM or live acceptance evidence."""
import importlib.util
import http.client
import json
import os
import stat
import socket
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path

BASE = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("portal_bridge", BASE / "tools/nas/bridge.py")
bridge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge)

ADAPTER = '''import contextlib,os,time
class NativeAdapter:
    def __init__(self,config): self.config=config
    def profile(self):
        return {"dsmVersion":"synthetic-only","directorySourceId":"synthetic-only","authorizationSourceId":"synthetic-only","identityLifecycle":True,"effectiveAcl":True,"shareRestrictions":True,"sameObjectRead":True}
    def directory(self):
        now=int(time.time()*1000)
        return {"version":1,"instanceId":"synthetic-nas","source":"native-dsm","observedAt":now,"expiresAt":now+60000,"principals":[{"key":"A","generation":"synthetic-1","username":"alice","email":"alice@mock.example","enabled":True,"trustedEmail":True,"system":False,"groups":[]}]}
    def authorize(self,principal,target): return target["relative"] in ("","A.fig")
    @contextlib.contextmanager
    def open_authorized(self,principal,target):
        rootfd=os.open(self.config["roots"][0]["path"],os.O_RDONLY|os.O_DIRECTORY)
        fd=os.open(target["relative"],os.O_RDONLY|os.O_NOFOLLOW,dir_fd=rootfd)
        try: yield fd,rootfd
        finally: os.close(fd);os.close(rootfd)
'''


class SyntheticBrokerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="portal-broker-synthetic-", dir="/private/tmp" if Path("/private/tmp").is_dir() else "/tmp")
        self.base = Path(self.temp.name)
        self.root = self.base / "source"
        self.root.mkdir()
        self.source = self.root / "A.fig"
        self.source.write_bytes(b"synthetic fixture")
        self.adapter = self.base / "adapter.py"
        self.adapter.write_text(ADAPTER)
        self.evidence_path = self.base / "acceptance.json"
        self.config_path = self.base / "config.json"
        self.config = {"version": 1, "environment": "development", "socketPath": str(self.base / "bridge.sock"),
                       "instanceId": "synthetic-nas", "providerId": "synthetic-only", "adapterPath": str(self.adapter),
                       "acceptancePath": str(self.evidence_path), "roots": [{"id": "designs", "path": str(self.root)}], "maxFileBytes": 536870912}
        self.config_path.write_text(json.dumps(self.config))
        self.broker = bridge.Broker(str(self.config_path))
        now = int(time.time() * 1000)
        self.evidence = {"version": 1, "kind": "synthetic", "profile": self.broker.profile(), "observedAt": now, "expiresAt": now + 60000,
                         "cases": [{"id": case, "passed": True, "evidenceRef": "synthetic-unittest-only"} for case in sorted(bridge.CASES)]}
        self.write_evidence()
        info = self.source.stat()
        self.target = {"version": 1, "instanceId": "synthetic-nas", "principalKey": "A", "generation": "synthetic-1",
                       "rootId": "designs", "rootIdentity": bridge.root_identity(str(self.root)), "relative": "A.fig", "kind": "file",
                       "size": info.st_size, "revision": bridge.revision(info), "maxFileBytes": 536870912}

    def write_evidence(self):
        self.evidence_path.write_text(json.dumps(self.evidence))

    def tearDown(self):
        self.temp.cleanup()

    def test_synthetic_gate_and_opened_object_unchanged(self):
        self.assertTrue(self.broker.status()["ready"])
        self.assertEqual(self.broker.status()["evidenceKind"], "synthetic")
        before = self.source.stat()
        with self.broker.open_authorized(self.target) as (fd, info):
            self.assertEqual(os.read(fd, 4096), b"synthetic fixture")
        self.assertEqual((before.st_size, before.st_mtime_ns), (self.source.stat().st_size, self.source.stat().st_mtime_ns))

    def test_missing_expired_incomplete_duplicate_failed_or_live_evidence_denies(self):
        original = json.dumps(self.evidence)
        for mode in ("expired", "incomplete", "duplicate", "failed", "live"):
            self.evidence = json.loads(original)
            if mode == "expired": self.evidence["expiresAt"] = 0
            elif mode == "incomplete": self.evidence["cases"].pop()
            elif mode == "duplicate": self.evidence["cases"][-1] = self.evidence["cases"][0]
            elif mode == "failed": self.evidence["cases"][0]["passed"] = False
            elif mode == "live": self.evidence["kind"] = "live-nas"
            self.write_evidence()
            self.assertFalse(self.broker.status()["ready"], mode)
        self.evidence_path.unlink()
        self.assertFalse(self.broker.status()["ready"])

    def test_code_config_root_or_native_profile_change_denies(self):
        self.adapter.write_text(ADAPTER + "\n# changed\n")
        self.assertFalse(self.broker.status()["ready"])
        self.adapter.write_text(ADAPTER)
        self.config_path.write_text(json.dumps({**self.config, "providerId": "changed"}))
        self.assertFalse(self.broker.status()["ready"])
        self.config_path.write_text(json.dumps(self.config))
        self.root.rename(self.base / "old-source")
        self.root.mkdir()
        self.assertFalse(self.broker.status()["ready"])

    def test_stale_generation_unknown_root_traversal_or_caller_uid_denies(self):
        for change in ({"generation": "rebuilt"}, {"rootId": "other"}, {"relative": "../A.fig"}, {"uid": 0}, {"rootIdentity": "0:0"}):
            with self.assertRaises(bridge.Blocked): self.broker.target({**self.target, **change})

    def test_replaced_object_or_hardlink_cannot_use_old_authorization(self):
        self.source.rename(self.root / "old.fig")
        self.source.write_bytes(b"synthetic fixture")
        with self.assertRaises(bridge.Blocked):
            with self.broker.open_authorized(self.target): pass
        self.target["revision"] = bridge.revision(self.source.stat())
        os.link(self.source, self.root / "link.fig")
        with self.assertRaises(bridge.Blocked):
            with self.broker.open_authorized(self.target): pass

    def test_symlink_adapter_and_unvalidated_example_remain_blocked(self):
        self.adapter.rename(self.base / "original.py")
        self.adapter.symlink_to(self.base / "original.py")
        with self.assertRaises(OSError): bridge.Broker(str(self.config_path))
        self.adapter.unlink()
        self.adapter.write_bytes((BASE / "tools/nas/native-adapter.example.py").read_bytes())
        blocked = bridge.Broker(str(self.config_path))
        self.assertFalse(blocked.status()["ready"])

    def test_development_formal_root_and_unsafe_or_writable_source_rejected(self):
        self.config["roots"][0]["path"] = "/volume1/Gd"
        self.config_path.write_text(json.dumps(self.config))
        with self.assertRaises(bridge.Blocked): bridge.Broker(str(self.config_path))
        for path in ("/", "/volume1", "/etc/accounts", "relative/path", str(self.root) + "/../source"):
            with self.assertRaises(bridge.Blocked): bridge.root_identity(path)

    @unittest.skipUnless(sys.platform == "linux", "Linux peer credentials required")
    def test_linux_unix_socket_protocol_and_bound_read(self):
        process = subprocess.Popen([sys.executable, str(BASE / "tools/nas/bridge.py"), "--config", str(self.config_path)], stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
        path = self.config["socketPath"]
        try:
            deadline = time.monotonic() + 5
            while not Path(path).exists() and time.monotonic() < deadline and process.poll() is None:
                time.sleep(0.01)
            self.assertTrue(Path(path).is_socket())

            def request(operation, value):
                connection = http.client.HTTPConnection("localhost", timeout=5)
                connection.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
                connection.sock.settimeout(5)
                connection.sock.connect(path)
                connection.request("POST", "/" + operation, json.dumps(value), {"Content-Type": "application/json"})
                response = connection.getresponse()
                status, body = response.status, response.read()
                connection.close()
                return status, body

            status, body = request("status", {"version": 1})
            self.assertEqual(status, 200)
            self.assertEqual(json.loads(body)["evidenceKind"], "synthetic")
            status, body = request("read", self.target)
            self.assertEqual(status, 200)
            header, contents = body.split(b"\n", 1)
            self.assertEqual(json.loads(header)["revision"], self.target["revision"])
            self.assertEqual(contents, b"synthetic fixture")
            status, body = request("write", self.target)
            self.assertEqual(status, 503)
            self.assertNotIn(str(self.root).encode(), body)
            self.evidence["expiresAt"] = 0
            self.write_evidence()
            status, body = request("read", self.target)
            self.assertEqual(status, 503)
            self.assertEqual(self.source.read_bytes(), b"synthetic fixture")
        finally:
            process.terminate()
            process.wait(timeout=5)
            process.stderr.close()


if __name__ == "__main__":
    unittest.main(verbosity=2)
