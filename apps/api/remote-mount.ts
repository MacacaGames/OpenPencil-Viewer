import { readFileSync } from 'node:fs'
import { AppError, type RootConfig } from '../../packages/contracts/index.ts'
const unescape = (s: string) =>
  s.replace(/\\([0-7]{3})/g, (_, octal: string) =>
    String.fromCharCode(parseInt(octal, 8))
  )
/** Prevent a local empty mountpoint from being accepted after reboot/mount loss. */
export function assertRemoteMount(
  roots: RootConfig[],
  expected: string | undefined,
  table = readFileSync('/proc/self/mountinfo', 'utf8')
) {
  if (!expected || roots.length !== 1)
    throw new AppError('remote-nas-mount-proof-required', 503)
  const valid = table.split('\n').some((line) => {
    const [left, right] = line.split(' - ')
    if (!right) return false
    const fields = left.split(' '),
      filesystem = right.split(' ')
    return (
      unescape(fields[4] ?? '') === roots[0].path &&
      fields[5]?.split(',').includes('ro') &&
      ['cifs', 'nfs', 'nfs4'].includes(filesystem[0]) &&
      unescape(filesystem[1] ?? '') === expected
    )
  })
  if (!valid) throw new AppError('remote-nas-mount-unavailable', 503)
}
