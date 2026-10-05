"""Stream original CC0 JPEGs into a freshly generated graph scaffold."""

import hashlib
import json
import sys
import zipfile
from pathlib import Path

source_dir = Path(sys.argv[1]).resolve()
output_dir = Path(sys.argv[2]).resolve()
sources = json.loads((source_dir / "sources.json").read_text())
layout = json.loads((output_dir / "layout.json").read_text())
assets = sources["assets"]
assert len(assets) == len({a["sha1"] for a in assets}) == layout["imageNodes"]
assert len(assets) >= sources["minimumUniqueImages"]
assert sum(a["bytes"] for a in assets) == sources["encodedImageBytes"]
assert sources["encodedImageBytes"] >= sources["targetEncodedImageBytes"]
scaffold = output_dir / "image-heavy-scaffold.fig"
assert hashlib.sha256(scaffold.read_bytes()).hexdigest() == layout["scaffoldSha256"]
destination = output_dir / "image-heavy-400mib.fig"
fixed_time = (2020, 1, 1, 0, 0, 0)
with zipfile.ZipFile(scaffold) as graph, zipfile.ZipFile(destination, "w") as result:
    assert set(graph.namelist()) == {"canvas.fig", "meta.json", "thumbnail.png"}
    for name in graph.namelist():
        result.writestr(zipfile.ZipInfo(name, fixed_time), graph.read(name))
    for asset in assets:
        assert asset["isPublicDomain"] is True and asset["license"] == "CC0-1.0"
        assert asset["rightsAndReproduction"] == ""
        assert asset["file"] == f"images/{asset['sha1']}.jpg"
        data = (source_dir / asset["file"]).read_bytes()
        assert len(data) == asset["bytes"]
        assert hashlib.sha1(data).hexdigest() == asset["sha1"]
        assert hashlib.sha256(data).hexdigest() == asset["sha256"]
        result.writestr(zipfile.ZipInfo(f"images/{asset['sha1']}", fixed_time), data)
with zipfile.ZipFile(destination) as result:
    assert result.testzip() is None
    assert len(result.namelist()) == len(assets) + 3
    assert sum(i.file_size for i in result.infolist() if i.filename.startswith("images/")) == sources["encodedImageBytes"]
digest = hashlib.sha256()
with destination.open("rb") as stream:
    for block in iter(lambda: stream.read(1024 * 1024), b""):
        digest.update(block)
manifest = {
    "filename": destination.name,
    "bytes": destination.stat().st_size,
    "sha256": digest.hexdigest(),
    **layout,
    "uniqueReferencedImages": len(assets),
    "encodedImageBytes": sources["encodedImageBytes"],
    "source": sources["source"],
    "policyURL": sources["policyURL"],
    "license": "CC0-1.0",
    "provenance": "Fresh graph and distinct, unmodified public CC0 JPEGs; no input design, padding or duplicate image variants.",
    "validation": {
        "zipCrcAndImageHashes": "PASS",
        "openPencilParsers": "Pending separate process runs",
        "figmaImport": "NOT RUN",
        "browserOom": "Pending separate browser run",
        "confidentialOriginalFailureMatch": "NOT ESTABLISHED",
    },
}
(output_dir / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
(output_dir / "sources.json").write_text(json.dumps(sources, ensure_ascii=False, indent=2) + "\n")
print(json.dumps(manifest, indent=2))
