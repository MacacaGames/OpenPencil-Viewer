"""Read an operator-approved RO fixture mount. Never attempts a write."""
import hashlib
import importlib.util
import json
import os
import time

spec = importlib.util.spec_from_file_location('reader', '/app/tools/filesystem/reader.py')
reader = importlib.util.module_from_spec(spec)
spec.loader.exec_module(reader)
root = reader.root_open('/fixtures')
try:
    dev = os.fstat(root).st_dev
    records = [e for e in reader.scan(root, dev) if e['kind'] == 'file']
    rows = []
    for record in sorted(records, key=lambda r: r['relative']):
        fd, before = reader.safe_open(root, record['relative'], dev)
        try:
            start = time.monotonic()
            size = 0
            first = None
            sha = hashlib.sha256()
            while True:
                chunk = os.read(fd, 65536)
                if not chunk:
                    break
                if first is None:
                    first = time.monotonic() - start
                size += len(chunk)
                if size > before.st_size or size > 536870912:
                    raise ValueError('changed or exceeds limit')
                sha.update(chunk)
            after = os.fstat(fd)
            if size != before.st_size or reader.revision(before) != reader.revision(after):
                raise ValueError('source changed')
            rows.append({'relative': record['relative'], 'bytes': size, 'sha256': sha.hexdigest(), 'mtimeNs': before.st_mtime_ns, 'firstByteMs': round((first or 0)*1000, 2), 'totalMs': round((time.monotonic()-start)*1000, 2)})
        finally:
            os.close(fd)
    print(json.dumps({'kind': 'operator-approved-ro-fixture-linux-read', 'platform': os.uname().machine, 'fileCount': len(rows), 'rows': rows, 'notMeasured': ['DSM ACL', 'native decode/layout/GPU', 'NAS physical disk', 'LAN transfer']}))
finally:
    os.close(root)
