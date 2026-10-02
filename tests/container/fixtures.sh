#!/bin/sh
set -eu
: "${PORTAL_TEST_IMAGE:?set the tested image}"
: "${PORTAL_FIXTURE_ROOT:?set the operator-approved fixture directory, never an entire NAS}"
TASK_DIR="$(mktemp -d)"
trap 'rm -rf "$TASK_DIR"' EXIT INT TERM
python3 - "$PORTAL_FIXTURE_ROOT" "$TASK_DIR/before.json" <<'PY'
import hashlib,json,os,stat,sys
root,out=sys.argv[1:]
rows=[]
for base,dirs,files in os.walk(root,followlinks=False):
 dirs[:]=[d for d in dirs if not os.path.islink(os.path.join(base,d))]
 for name in files:
  path=os.path.join(base,name);s=os.stat(path,follow_symlinks=False)
  if not name.lower().endswith('.fig') or not stat.S_ISREG(s.st_mode) or s.st_nlink!=1: continue
  h=hashlib.sha256()
  with open(path,'rb') as f:
   for b in iter(lambda:f.read(65536),b''):h.update(b)
  rows.append({'relative':os.path.relpath(path,root),'bytes':s.st_size,'mtimeNs':s.st_mtime_ns,'sha256':h.hexdigest()})
json.dump(rows,open(out,'w'))
PY
docker run --rm --read-only --network none --user 10001:10001 \
 --cap-drop ALL --security-opt no-new-privileges --memory 1g --pids-limit 32 \
 --mount "type=bind,src=$PORTAL_FIXTURE_ROOT,dst=/fixtures,readonly" \
 --entrypoint python3 -i "$PORTAL_TEST_IMAGE" - < tests/container/fixtures.py > "$TASK_DIR/inside.json"
python3 - "$PORTAL_FIXTURE_ROOT" "$TASK_DIR/before.json" "$TASK_DIR/inside.json" <<'PY'
import hashlib,json,os,sys
root,before,inside=sys.argv[1:];baseline=json.load(open(before));report=json.load(open(inside))
actual={r['relative']:r for r in report['rows']}
assert len(baseline)==len(actual)>0
for expected in baseline:
 r=actual[expected['relative']]
 assert all(r[k]==expected[k] for k in ('bytes','mtimeNs','sha256'))
 path=os.path.join(root,expected['relative']);s=os.stat(path,follow_symlinks=False);h=hashlib.sha256()
 with open(path,'rb') as f:
  for b in iter(lambda:f.read(65536),b''):h.update(b)
 assert h.hexdigest()==expected['sha256'] and s.st_size==expected['bytes'] and s.st_mtime_ns==expected['mtimeNs']
# Public measurement omits private design names, paths and document bytes.
for i,r in enumerate(report['rows']): r.pop('relative');r['fixtureOrdinal']=i+1
print(json.dumps(report,indent=2))
print('PASS: container pinned reads match host; original hash/size/mtime unchanged; no write attempt on supplied files.')
PY
