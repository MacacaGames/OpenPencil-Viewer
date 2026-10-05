"""Extract hash-verified JPEGs from the generated public reproduction only."""

import hashlib
import json
import sys
import zipfile
from pathlib import Path

bundle = Path(sys.argv[1]).resolve()
output = Path(sys.argv[2]).resolve()
manifest = json.loads((bundle / "manifest.json").read_text())
sources = json.loads((bundle / "sources.json").read_text())
assert manifest["sha256"] == "36b759d00fe266d074620af0cbf619e5c090c8da29c74947358b422bca9d78ea"
fig = bundle / "image-heavy-400mib.fig"
digest = hashlib.sha256()
with fig.open("rb") as stream:
    for block in iter(lambda: stream.read(1024 * 1024), b""):
        digest.update(block)
assert digest.hexdigest() == manifest["sha256"]
(output / "images").mkdir(parents=True, exist_ok=True)
with zipfile.ZipFile(fig) as archive:
    for asset in sources["assets"]:
        assert asset["isPublicDomain"] is True and asset["license"] == "CC0-1.0"
        assert asset["file"] == f"images/{asset['sha1']}.jpg"
        data = archive.read(f"images/{asset['sha1']}")
        assert hashlib.sha1(data).hexdigest() == asset["sha1"]
        assert hashlib.sha256(data).hexdigest() == asset["sha256"]
        (output / asset["file"]).write_bytes(data)
(output / "sources.json").write_text(json.dumps(sources, ensure_ascii=False, indent=2) + "\n")
print(f"Extracted {len(sources['assets'])} verified public JPEGs; no input design used")
