import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { AppError, type RootConfig } from '../../packages/contracts/index.ts'
const unescape = (s: string) =>
  s.replace(/\\([0-7]{3})/g, (_, octal: string) =>
    String.fromCharCode(parseInt(octal, 8))
  )
/** Prevent a local empty mountpoint from being accepted after reboot/mount loss. */
export function assertRemoteMount(
  roots: RootConfig[],
  expected: string | undefined,
  table?: string
) {
  if (!expected || roots.length !== 1)
    throw new AppError('remote-nas-mount-proof-required', 503)
  try {
    table ??= readFileSync('/proc/self/mountinfo', 'utf8')
  } catch {
    throw new AppError('remote-nas-mount-unavailable', 503)
  }
  // Ambiguous stacked mounts fail closed; fd mount-ID checks also prove the
  // scanner opened the exact approved mount, not a hidden/local overmount.
  const entries = table.split('\n').flatMap((line) => {
    const [left, right] = line.split(' - ')
    if (!right) return []
    const fields = left.split(' '),
      filesystem = right.split(' ')
    return unescape(fields[4] ?? '') === roots[0].path
      ? [{ fields, filesystem }]
      : []
  })
  const entry = entries[0]
  if (
    entries.length !== 1 ||
    !entry ||
    !/^\d+$/.test(entry.fields[0]) ||
    !entry.fields[5]?.split(',').some((o) => o === 'ro' || o === 'rw') ||
    !['cifs', 'nfs', 'nfs4'].includes(entry.filesystem[0]) ||
    unescape(entry.filesystem[1] ?? '') !== expected
  )
    throw new AppError('remote-nas-mount-unavailable', 503)
  const { fields, filesystem } = entry
  const address = filesystem[2]?.split(',').find((o) => o.startsWith('addr='))
  // Docker NFS volumes may expose only :/export as source. The actual server
  // address must then be part of the durable identity, not the transient dev.
  if (filesystem[0].startsWith('nfs') && (!address || address.length <= 5))
    throw new AppError('remote-nas-mount-unavailable', 503)
  return {
    mountId: Number(fields[0]),
    identity: createHash('sha256')
      .update(
        JSON.stringify([
          filesystem[0],
          unescape(filesystem[1]),
          unescape(fields[3]),
          address ?? ''
        ])
      )
      .digest('hex')
  }
}
