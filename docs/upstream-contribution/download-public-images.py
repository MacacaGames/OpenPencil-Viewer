"""Collect distinct CC0 JPEGs for a large, public OpenPencil reproducer.

Only The Met's public API and original-image host are read. No design file is
accepted. Cached bytes are verified before reuse; no padding or image variants.
"""

import concurrent.futures
import hashlib
import json
import struct
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

API = "https://collectionapi.metmuseum.org/public/collection/"
POLICY = "https://www.metmuseum.org/hubs/open-access"
LICENSE = "https://creativecommons.org/publicdomain/zero/1.0/"
TARGET = 400 * 1024 * 1024
MIN_IMAGES = 256
MAX_IMAGE = 3 * 1024 * 1024
OUTPUT = Path(sys.argv[1] if len(sys.argv) > 1 else "scratch/public-images")
OUTPUT.mkdir(parents=True, exist_ok=True)
(OUTPUT / "images").mkdir(exist_ok=True)
(OUTPUT / "records").mkdir(exist_ok=True)


class OversizedResponse(ValueError):
    pass


def fetch(url, maximum=16 * 1024 * 1024):
    for attempt in range(3):
        try:
            request = urllib.request.Request(
                url, headers={"User-Agent": "OpenPencil-public-reproduction/1.0"}
            )
            with urllib.request.urlopen(request, timeout=25) as response:
                if int(response.headers.get("Content-Length", 0)) > maximum:
                    raise OversizedResponse("Response exceeds size limit")
                data = response.read(maximum + 1)
            if len(data) > maximum:
                raise OversizedResponse("Response exceeds size limit")
            return data
        except OversizedResponse:
            raise
        except Exception:
            if attempt == 2:
                raise
            time.sleep(attempt + 1)


def jpeg_dimensions(data):
    if data[:2] != b"\xff\xd8" or data[-2:] != b"\xff\xd9":
        raise ValueError("Not a complete JPEG")
    position = 2
    while position < len(data):
        if data[position] != 255:
            raise ValueError("Invalid JPEG marker")
        while data[position] == 255:
            position += 1
        marker = data[position]
        position += 1
        if marker in (0xD8, 0xD9, 0x01) or 0xD0 <= marker <= 0xD7:
            continue
        length = struct.unpack_from(">H", data, position)[0]
        if marker in (0xC0, 0xC1, 0xC2):
            height, width = struct.unpack_from(">HH", data, position + 3)
            return width, height
        if marker == 0xDA:
            break
        position += length
    raise ValueError("No supported JPEG dimensions")


def object_record(object_id):
    path = OUTPUT / "records" / f"{object_id}.json"
    if not path.exists():
        path.write_bytes(fetch(f"{API}v1/objects/{object_id}"))
    return json.loads(path.read_text())


def asset(candidate):
    object_id, requested_url = candidate if isinstance(candidate, tuple) else (candidate, None)
    key = str(object_id) if requested_url is None else hashlib.sha256(requested_url.encode()).hexdigest()
    rejected = OUTPUT / "records" / f"{key}.rejected-3mib.json"
    if rejected.exists():
        return None
    try:
        record = object_record(object_id)
        url = requested_url or record.get("primaryImage", "")
        location = urllib.parse.urlparse(url)
        if (
            record.get("isPublicDomain") is not True
            or record.get("rightsAndReproduction")
            or location.scheme != "https"
            or location.hostname != "images.metmuseum.org"
            or not location.path.startswith("/CRDImages/")
            or "/original/" not in location.path
            or url not in [record.get("primaryImage"), *record.get("additionalImages", [])]
        ):
            return None
        url = urllib.parse.urlunparse(
            location._replace(path=urllib.parse.quote(location.path, safe="/%"))
        )
        cache = OUTPUT / "records" / f"{key}.asset.json"
        if cache.exists():
            entry = json.loads(cache.read_text())
            data = (OUTPUT / entry["file"]).read_bytes()
            if hashlib.sha256(data).hexdigest() != entry["sha256"]:
                raise ValueError("Cached image digest mismatch")
        else:
            data = fetch(url, maximum=MAX_IMAGE)
        width, height = jpeg_dimensions(data)
        if not 100_000 <= len(data) <= MAX_IMAGE or max(width, height) > 5000:
            rejected.write_text(json.dumps({"reason": "Image sizing filter"}) + "\n")
            return None
        sha1 = hashlib.sha1(data).hexdigest()
        filename = f"images/{sha1}.jpg"
        (OUTPUT / filename).write_bytes(data)
        entry = {
            "file": filename,
            "objectID": object_id,
            "title": record.get("title", ""),
            "artist": record.get("artistDisplayName", ""),
            "creditLine": record.get("creditLine", ""),
            "objectURL": record["objectURL"],
            "metadataURL": f"{API}v1/objects/{object_id}",
            "imageURL": url,
            "imageRole": "primary" if not requested_url or requested_url == record.get("primaryImage") else "additional",
            "isPublicDomain": True,
            "rightsAndReproduction": "",
            "license": "CC0-1.0",
            "licenseURL": LICENSE,
            "policyURL": POLICY,
            "bytes": len(data),
            "width": width,
            "height": height,
            "sha1": sha1,
            "sha256": hashlib.sha256(data).hexdigest(),
        }
        cache.write_text(json.dumps(entry, ensure_ascii=False, indent=2) + "\n")
        return entry
    except OversizedResponse:
        rejected.write_text(json.dumps({"reason": "Encoded JPEG exceeds 3 MiB"}) + "\n")
        return None
    except Exception as error:
        print(f"Skip object {object_id}: {error}", file=sys.stderr, flush=True)
        return None


if len(sys.argv) > 2 and sys.argv[2] == "--inventory":
    inventory = json.loads(Path(sys.argv[3]).read_text())
    assert inventory["license"] == "CC0-1.0"
    for entry in inventory["assets"]:
        assert entry["isPublicDomain"] is True and entry["license"] == "CC0-1.0"
        location = urllib.parse.urlparse(entry["imageURL"])
        assert location.scheme == "https" and location.hostname == "images.metmuseum.org"
        assert location.path.startswith("/CRDImages/") and "/original/" in location.path
        assert entry["file"] == f"images/{entry['sha1']}.jpg"
        path = OUTPUT / entry["file"]
        data = path.read_bytes() if path.exists() else fetch(entry["imageURL"], maximum=MAX_IMAGE)
        assert hashlib.sha256(data).hexdigest() == entry["sha256"]
        assert hashlib.sha1(data).hexdigest() == entry["sha1"]
        assert len(data) == entry["bytes"]
        path.write_bytes(data)
    (OUTPUT / "sources.json").write_text(json.dumps(inventory, ensure_ascii=False, indent=2) + "\n")
    print("Frozen public inventory restored and every image hash verified")
    sys.exit(0)

entries = []
digests = set()
seen_objects = set()
total = 0
offset = 0
cached_mode = len(sys.argv) > 2 and sys.argv[2] == "--cached"
if cached_mode:
    # No metadata API calls. Existing provenance is kept and additional image
    # URLs must be named by the same eligible public-domain record.
    previous = json.loads((OUTPUT / "sources.json").read_text())
    entries = previous["assets"]
    digests = {a["sha1"] for a in entries}
    total = sum(a["bytes"] for a in entries)
    candidates = []
    records = [json.loads(p.read_text()) for p in sorted((OUTPUT / "records").glob("*.json")) if p.stem.isdigit()]
    for field in ["additionalImages", "primaryImage"]:
        for record in records:
            if record.get("isPublicDomain") is not True or record.get("rightsAndReproduction"):
                continue
            urls = record.get(field, []) if field == "additionalImages" else [record.get(field, "")]
            candidates.extend((record["objectID"], url) for url in urls if url)
    existing_urls = {a["imageURL"] for a in entries}
    candidates = [c for c in candidates if c[1] not in existing_urls]
with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
    while total < TARGET or len(entries) < MIN_IMAGES:
        if cached_mode:
            object_ids = candidates
        else:
            query = urllib.parse.urlencode(
                {"hasImages": "true", "q": "landscape", "limit": 500, "offset": offset}
            )
            search = json.loads(fetch(f"{API}v1.1/search?{query}"))
            object_ids = search.get("objectIDs") or []
        if not object_ids:
            raise RuntimeError("Not enough eligible images")
        # Batches bound requests and overshoot. pool.map preserves search order.
        for start in range(0, len(object_ids), 8):
            batch = [i for i in object_ids[start : start + 8] if i not in seen_objects]
            seen_objects.update(batch)
            for entry in pool.map(asset, batch):
                if entry is None or entry["sha1"] in digests:
                    continue
                entries.append(entry)
                digests.add(entry["sha1"])
                total += entry["bytes"]
                manifest = {
                    "source": "The Metropolitan Museum of Art Open Access",
                    "policyURL": POLICY,
                    "license": "CC0-1.0",
                    "targetEncodedImageBytes": TARGET,
                    "minimumUniqueImages": MIN_IMAGES,
                    "encodedImageBytes": total,
                    "uniqueImages": len(entries),
                    "transformation": "None; distinct original JPEG bytes, no padding.",
                    "assets": entries,
                }
                (OUTPUT / "sources.json").write_text(
                    json.dumps(manifest, ensure_ascii=False, indent=2) + "\n"
                )
                if len(entries) % 20 == 0:
                    print(f"{len(entries)} images, {total / 1024**2:.1f} MiB", flush=True)
                if total >= TARGET and len(entries) >= MIN_IMAGES:
                    break
            if total >= TARGET and len(entries) >= MIN_IMAGES:
                break
        offset += len(object_ids)
        if cached_mode and (total < TARGET or len(entries) < MIN_IMAGES):
            raise RuntimeError("Cached public metadata exhausted before target size")
print(json.dumps({"images": len(entries), "encodedBytes": total, "output": str(OUTPUT)}))
