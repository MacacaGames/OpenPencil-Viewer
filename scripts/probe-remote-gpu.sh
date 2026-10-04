#!/bin/sh
# Read-only host inventory. Run on Unraid manually; does not change drivers/ACLs.
set -eu
printf 'Unraid / kernel / Docker versions\n'
[ ! -f /etc/unraid-version ] || cat /etc/unraid-version
uname -a
docker version --format '{{json .Server}}'
printf '\nDisplay PCI devices\n'
lspci -nnk | awk '/VGA|Display|3D controller/ {show=4} show > 0 {print; show--}'
printf '\nDRM nodes and numeric access groups\n'
for entry in /sys/class/drm/renderD*; do
  [ -e "$entry/device" ] || continue
  node="/dev/dri/$(basename "$entry")"
  printf '%s -> %s\n' "$node" "$(readlink -f "$entry/device")"
  stat -c '%n mode=%a uid=%u gid=%g' "$node"
  readlink -f "$entry/device/driver"
done
printf '\nContainer diagnostics: execute the following with your Compose env file\n'
printf '%s\n' 'docker compose -f compose.unraid.yml -f compose.gpu.yml exec -e DISPLAY=:1 portal python3 /app/tools/remote/gpu.py --diagnose'
printf '%s\n' 'Run it after a native viewer session is active to include actual X11 OpenGL information.'
