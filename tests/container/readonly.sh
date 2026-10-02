#!/bin/sh
set -eu
: "${PORTAL_TEST_IMAGE:?set the locally built image tag}"
command -v docker >/dev/null
TASK_CONTAINER="portal-readonly-test-$$"
TASK_DIR="$(mktemp -d)"
TASK_VOLUME="portal-readonly-test-state-$$"
cleanup() { docker rm -f "$TASK_CONTAINER" >/dev/null 2>&1 || true; docker volume rm "$TASK_VOLUME" >/dev/null 2>&1 || true; rm -rf "$TASK_DIR"; }
trap cleanup EXIT INT TERM
mkdir "$TASK_DIR/source" "$TASK_DIR/config" "$TASK_DIR/outside" "$TASK_DIR/source/nested"
docker volume create "$TASK_VOLUME" >/dev/null
# Initialize only this synthetic state volume; the Web process stays non-root.
docker run --rm --read-only --user 0:0 --network none --mount "type=volume,src=$TASK_VOLUME,dst=/state" --entrypoint chown "$PORTAL_TEST_IMAGE" 10001:10001 /state
printf 'SYNTHETIC ONLY' > "$TASK_DIR/source/test.fig"
# Writable synthetic file ensures the RO mount, not host permissions, denies writes.
chmod 666 "$TASK_DIR/source/test.fig"
cp deploy/config.example.json "$TASK_DIR/config/config.json"
cp deploy/directory.example.json "$TASK_DIR/config/directory.json"
printf 'OUTSIDE' > "$TASK_DIR/outside/outside.fig"
printf 'HARDLINK' > "$TASK_DIR/source/hard.fig"
ln "$TASK_DIR/source/hard.fig" "$TASK_DIR/source/hard.txt"
ln -s /outside/outside.fig "$TASK_DIR/source/link.fig"
mkfifo "$TASK_DIR/source/pipe.fig"
printf '{"web":{"client_id":"synthetic","client_secret":"synthetic","redirect_uris":["https://design.corp.example/auth/google/callback"]}}' > "$TASK_DIR/config/google.json"
printf '{SYNTHETIC_CONFIG_SECRET_DO_NOT_LOG' > "$TASK_DIR/config/invalid.json"
cp "$TASK_DIR/config/config.json" "$TASK_DIR/config/unreadable.json"
chmod 000 "$TASK_DIR/config/unreadable.json"
mkfifo "$TASK_DIR/config/pipe.json"
dd if=/dev/zero of="$TASK_DIR/config/oversize.json" bs=262145 count=1 2>/dev/null
chmod 755 "$TASK_DIR" "$TASK_DIR/source" "$TASK_DIR/config" "$TASK_DIR/outside" "$TASK_DIR/source/nested"
docker run -d --name "$TASK_CONTAINER" --read-only --user 10001:10001 \
 --cap-drop ALL --security-opt no-new-privileges --pids-limit 64 \
 --tmpfs /tmp:rw,noexec,nosuid,nodev,size=64m \
 --mount "type=bind,src=$TASK_DIR/source,dst=/data/designs,readonly" \
 --mount "type=bind,src=$TASK_DIR/config,dst=/config,readonly" \
 --mount "type=bind,src=$TASK_DIR/outside,dst=/data/designs/nested,readonly" \
 --mount "type=bind,src=$TASK_DIR/outside,dst=/outside,readonly" \
 --mount "type=volume,src=$TASK_VOLUME,dst=/state" \
 -e GOOGLE_OAUTH_FILE=/config/google.json -e PORTAL_ORIGIN=https://design.corp.example \
 -e GOOGLE_HOSTED_DOMAINS=corp.example "$PORTAL_TEST_IMAGE" >/dev/null
TASK_ATTEMPT=0
until docker exec "$TASK_CONTAINER" node -e "fetch('http://127.0.0.1:3000/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"; do
 TASK_ATTEMPT=$((TASK_ATTEMPT+1)); [ "$TASK_ATTEMPT" -lt 15 ] || exit 1; sleep 1
done
docker exec "$TASK_CONTAINER" node -e "fetch('http://127.0.0.1:3000/health/ready').then(async r=>{const b=await r.json();if(r.status!==503 || b.ready!==false || b.authorization!=='dsm-strict')process.exit(1)})"
docker exec "$TASK_CONTAINER" python3 -c 'import os,errno; assert os.getuid()==10001
try: open("/data/designs/test.fig","wb")
except OSError as e: assert e.errno==errno.EROFS
else: raise AssertionError("source write allowed")'
[ "$(cat "$TASK_DIR/source/test.fig")" = 'SYNTHETIC ONLY' ]
[ "$(docker inspect -f '{{.HostConfig.ReadonlyRootfs}}' "$TASK_CONTAINER")" = true ]
[ "$(docker inspect -f '{{range .Mounts}}{{if eq .Destination "/data/designs"}}{{.RW}}{{end}}{{end}}' "$TASK_CONTAINER")" = false ]
docker exec -i "$TASK_CONTAINER" python3 - < tests/container/filesystem.py
TASK_STATUS=0
docker exec "$TASK_CONTAINER" node dist/api/check-config.js || TASK_STATUS=$?
[ "$TASK_STATUS" -eq 2 ]
docker exec -i "$TASK_CONTAINER" node --input-type=module - <<'JS'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
for (const label of ['PORTAL_CONFIG', 'GOOGLE_OAUTH_FILE']) {
 for (const [path, reason] of [
  ['/config', 'is a directory'],
  ['/config/missing.json', 'file was not found'],
  ['/config/invalid.json', 'contains invalid JSON'],
  ['/config/unreadable.json', 'file is not readable'],
  ['/config/pipe.json', 'must be a regular JSON file'],
  ['/config/oversize.json', 'exceeds the']
 ]) {
  const result = spawnSync(process.execPath, ['dist/api/check-config.js'], {
   env: { ...process.env, [label]: path }, encoding: 'utf8', timeout: 5000
  })
  assert.equal(result.error, undefined)
  assert.equal(result.status, 1)
  assert.ok(result.stderr.startsWith(label + ': '))
  assert.ok(result.stderr.includes(reason))
  assert.ok(!result.stderr.includes('SYNTHETIC_CONFIG_SECRET'))
  assert.ok(!result.stderr.includes('/config'))
 }
}
console.log('PASS: bounded mounted JSON diagnostics, UID10001 permissions, FIFO timeout and secret/path redaction')
JS
printf 'PASS: mounted OAuth JSON/domains, non-root, RO source/rootfs, Linux confinement, strict release gate; no live NAS ACL claim.\n'
