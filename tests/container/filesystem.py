"""Executed only in the synthetic readonly.sh container, never a NAS root."""
import importlib.util
import os
import sys

assert sys.platform == 'linux'
spec = importlib.util.spec_from_file_location('reader', '/app/tools/filesystem/reader.py')
reader = importlib.util.module_from_spec(spec)
spec.loader.exec_module(reader)
root = reader.root_open('/data/designs')
try:
    dev = os.fstat(root).st_dev
    assert reader.mount_id(root) > 0
    entries = reader.scan(root, dev)
    assert [e['relative'] for e in entries] == ['test.fig'], entries
    fd, info = reader.safe_open(root, 'test.fig', dev)
    try:
        assert os.read(fd, 65536) == b'SYNTHETIC ONLY'
        assert info.st_size == 14
    finally:
        os.close(fd)
    for path in ['../outside/outside.fig', 'link.fig', 'hard.fig', 'pipe.fig', 'nested/outside.fig']:
        try:
            fd, _ = reader.safe_open(root, path, dev)
        except (OSError, ValueError):
            continue
        else:
            os.close(fd)
            raise AssertionError('unsafe path accepted: ' + path)
    print('PASS: Linux O_PATH/proc pinned read, traversal/symlink/hardlink/FIFO/nested mount rejection')
finally:
    os.close(root)
