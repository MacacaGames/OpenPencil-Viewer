#!/bin/sh
# Synthetic data only. Test the exact release candidate before registry push.
set -eu
: "${PORTAL_TEST_IMAGE:?set the locally built release candidate}"
cd "$(dirname "$0")/../.."
TASK_ARCH=$(docker image inspect --format '{{.Architecture}}' "$PORTAL_TEST_IMAGE")
TASK_NATIVE=$(docker info --format '{{.Architecture}}')
case "$TASK_NATIVE" in
  aarch64|arm64) TASK_NATIVE=arm64 ;;
  x86_64|amd64) TASK_NATIVE=amd64 ;;
  *) printf 'Unsupported Docker host architecture: %s\n' "$TASK_NATIVE" >&2; exit 1 ;;
esac
[ "$TASK_ARCH" = "${REMOTE_TEST_EXPECT_ARCH:-$TASK_NATIVE}" ]
[ "$TASK_ARCH" = "$TASK_NATIVE" ] || {
  printf 'Chromium sandbox acceptance needs a native %s Linux Docker host, not emulation.\n' "$TASK_ARCH" >&2
  exit 1
}
[ "$(docker image inspect --format '{{.Os}}' "$PORTAL_TEST_IMAGE")" = linux ]
[ "$(docker image inspect --format '{{.Config.User}}' "$PORTAL_TEST_IMAGE")" = 10001:10001 ]
TASK_IMAGE="openpencil-viewer:synthetic-stream-$$"
TASK_CONTAINER=''
TASK_LOG=''
TASK_LOG_DIR=.work/selkies-ci
mkdir -p "$TASK_LOG_DIR"
cleanup() {
  TASK_STATUS=$?
  trap - EXIT INT TERM
  if [ -n "$TASK_CONTAINER" ]; then
    docker logs "$TASK_CONTAINER" > "$TASK_LOG" 2>&1 || true
    docker rm -f "$TASK_CONTAINER" >/dev/null 2>&1 || true
  fi
  docker image rm "$TASK_IMAGE" >/dev/null 2>&1 || true
  exit "$TASK_STATUS"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

# No host state, source files, GPU or secrets enter these probes.
for TASK_IDENTITY in 10001:10001 99:100; do
  TASK_UID=${TASK_IDENTITY%:*}
  TASK_GID=${TASK_IDENTITY#*:}
  docker run --rm -i --network none --read-only --user "$TASK_IDENTITY" \
    --cap-drop ALL --security-opt no-new-privileges:true \
    --tmpfs "/config:rw,noexec,nosuid,nodev,size=1m,uid=$TASK_UID,gid=$TASK_GID,mode=700" \
    --tmpfs "/state:rw,noexec,nosuid,nodev,size=16m,uid=$TASK_UID,gid=$TASK_GID,mode=700" \
    --entrypoint node "$PORTAL_TEST_IMAGE" --input-type=module - <<'JS'
import assert from 'node:assert/strict'
import { accessSync, constants, existsSync, chmodSync, statSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { spawnSync } from 'node:child_process'
for (const binary of ['/usr/lib/chromium/chromium', '/usr/bin/Xvfb', '/usr/bin/openbox', '/lsiopy/bin/selkies', '/usr/bin/ffmpeg', '/usr/bin/vainfo', '/usr/bin/glxinfo'])
  accessSync(binary, constants.X_OK)
accessSync('/usr/share/selkies/selkies-dashboard/src/selkies-core.js', constants.R_OK)
accessSync('/etc/chromium/policies/managed/portal.json', constants.R_OK)
accessSync('/app/tools/nas/bridge.py', constants.R_OK)
assert.equal(existsSync('/app/container-harness.mjs'), false)
assert.equal(existsSync('/app/tests'), false)
assert.equal(process.version, 'v22.23.3')
assert.notEqual(process.getuid(), 0)
const versions = spawnSync('/lsiopy/bin/python', ['-c', 'import importlib.metadata as m; assert m.version("selkies")=="2.0.0"; assert m.version("pixelflux")=="2.1.0"'], {encoding:'utf8'})
assert.equal(versions.status, 0, versions.stderr)
const selected = spawnSync('python3', ['/app/tools/remote/gpu.py', '--select'], {encoding:'utf8', env:{...process.env,GPU_RENDER_MODE:'software',GPU_ENCODER_MODE:'cpu'}})
assert.equal(selected.status, 0, selected.stderr)
assert.equal(JSON.parse(selected.stdout).encoder, 'cpu')
const forced = spawnSync('python3', ['/app/tools/remote/gpu.py', '--select'], {encoding:'utf8', env:{...process.env,GPU_RENDER_MODE:'software',GPU_ENCODER_MODE:'vaapi'}})
assert.equal(forced.status, 2)
assert.match(forced.stdout, /Forced VA-API failed/)
const path = '/state/uid-probe.sqlite'
const db = new DatabaseSync(path)
chmodSync(path, 0o600)
db.exec('PRAGMA journal_mode=WAL; CREATE TABLE probe(value INTEGER); INSERT INTO probe VALUES(1)')
assert.equal(db.prepare('SELECT value FROM probe').get().value, 1)
const stat = statSync(path)
assert.equal(stat.uid, process.getuid())
assert.equal(stat.gid, process.getgid())
assert.equal(stat.mode & 0o777, 0o600)
db.close()
console.log(JSON.stringify({result:'PASS',uid:process.getuid(),gid:process.getgid(),components:'raster + Selkies/Chromium',sqliteMode:'0600',encoder:'cpu; forced VA-API fails without GPU'}))
JS
done

PORTAL_SYNTHETIC_IMAGE="$TASK_IMAGE" node --import tsx scripts/build-remote-test.ts
for TASK_IDENTITY in 10001:10001 99:100; do
  TASK_UID=${TASK_IDENTITY%:*}
  TASK_GID=${TASK_IDENTITY#*:}
  TASK_CONTAINER="portal-stream-ci-$$-$TASK_UID"
  TASK_LOG="$TASK_LOG_DIR/runtime-$TASK_UID.log"
  docker run -d --name "$TASK_CONTAINER" --user "$TASK_IDENTITY" \
    --read-only --cap-drop ALL --init --security-opt no-new-privileges:true \
    --security-opt seccomp=./deploy/selkies/seccomp-chromium.json \
    --tmpfs /tmp:rw,noexec,nosuid,nodev,size=512m,mode=1777 \
    --tmpfs /run:rw,noexec,nosuid,nodev,size=32m,mode=1777 \
    --tmpfs "/config:rw,noexec,nosuid,nodev,size=1m,uid=$TASK_UID,gid=$TASK_GID,mode=700" \
    --tmpfs "/state:rw,noexec,nosuid,nodev,size=1g,uid=$TASK_UID,gid=$TASK_GID,mode=700" \
    --shm-size=1g --pids-limit 512 --memory 4g \
    -p 127.0.0.1:24682:24682 "$TASK_IMAGE" >/dev/null
  TASK_ATTEMPT=0
  until curl -fsS http://127.0.0.1:24682/health/ready >/dev/null 2>&1; do
    TASK_ATTEMPT=$((TASK_ATTEMPT + 1))
    [ "$TASK_ATTEMPT" -lt 40 ] || exit 1
    sleep 1
  done
  [ "$(docker inspect --format '{{.HostConfig.ReadonlyRootfs}}' "$TASK_CONTAINER")" = true ]
  [ "$(docker exec "$TASK_CONTAINER" node -p 'process.getuid()+":"+process.getgid()')" = "$TASK_IDENTITY" ]
  node_modules/.bin/playwright test -c tests/container/playwright.config.ts \
    > "$TASK_LOG_DIR/browser-$TASK_UID.log" 2>&1 || {
      cat "$TASK_LOG_DIR/browser-$TASK_UID.log"
      exit 1
    }
  cat "$TASK_LOG_DIR/browser-$TASK_UID.log"
  docker exec "$TASK_CONTAINER" python3 -c 'import psutil; names={"chromium","Xvfb","openbox","selkies"}; leftover=[p.info for p in psutil.process_iter(["name"]) if p.info["name"] in names]; assert not leftover, leftover'
  docker stop --time 30 "$TASK_CONTAINER" >/dev/null
  docker logs "$TASK_CONTAINER" > "$TASK_LOG" 2>&1
  node --input-type=module - "$TASK_LOG" <<'JS'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const reports = readFileSync(process.argv[2], 'utf8').split('\n').filter(line => line.startsWith('{"event":"remote-stream-info"')).map(line => JSON.parse(line))
assert.equal(new Set(reports.map(report => report.lease)).size, 2, 'both isolated Google users must receive actual stream_info')
for (const {info} of reports) {
  assert.equal(info.codec, 'h264')
  assert.equal(info.hardware, false)
  assert.equal(info.zero_copy, false)
  assert.equal(info.encoder, 'x264')
}
console.log('PASS: actual CPU H.264; source integrity, dynamic resize, isolated profiles and logout cleanup')
JS
  docker rm "$TASK_CONTAINER" >/dev/null
  TASK_CONTAINER=''
done
printf 'PASS: native %s release candidate, UID10001 and Unraid UID99; GPU/NAS live acceptance remains pending.\n' "$TASK_ARCH"
