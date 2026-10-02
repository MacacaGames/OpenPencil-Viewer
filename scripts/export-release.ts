import { spawnSync } from 'node:child_process'
import {
  mkdirSync,
  cpSync,
  readFileSync,
  readdirSync,
  lstatSync,
  writeFileSync,
  createReadStream
} from 'node:fs'
import { createHash } from 'node:crypto'
import { resolve, relative } from 'node:path'
import { root, output } from './common.ts'
import { verifyUpstream } from './verify-upstream.ts'

verifyUpstream()
const image = process.argv[2]
if (!image) throw new Error('Usage: npm run release:export -- TESTED_IMAGE')
const inspection = JSON.parse(
  output('docker', ['image', 'inspect', '--format', '{{json .}}', image])
)
const lock = JSON.parse(
  readFileSync(resolve(root, 'upstream.lock.json'), 'utf8')
)
if (
  inspection.Os !== 'linux' ||
  !['arm64', 'amd64'].includes(inspection.Architecture) ||
  inspection.Config.User !== '10001:10001' ||
  inspection.Config.Labels?.['portal.upstream.sha'] !== lock.sha
)
  throw new Error('Unexpected image platform/user/upstream label')
const destination = resolve(
  root,
  '.work/releases',
  `${inspection.Architecture}-${inspection.Id.slice(7, 19)}`
)
mkdirSync(destination, { recursive: true })
// Allowlist only public deployment assets; no source roots, state or credentials.
for (const dir of ['deploy', 'docs']) {
  mkdirSync(resolve(destination, dir), { recursive: true })
  for (const name of readdirSync(resolve(root, dir))) {
    if (
      !(
        /\.example\.(json|conf)$/.test(name) ||
        /^compose\..+\.yml$/.test(name) ||
        name === 'Dockerfile' ||
        /\.(md|local\.json)$/.test(name)
      )
    )
      continue
    const source = resolve(root, dir, name)
    if (!lstatSync(source).isFile())
      throw new Error('Unexpected non-regular public asset')
    cpSync(source, resolve(destination, dir, name))
  }
}
for (const name of [
  'README.md',
  'QUICK_START.md',
  'docker-compose.yml',
  '.env.example',
  'upstream.lock.json',
  'ACL_ACCEPTANCE_MATRIX.md',
  'DEVELOPMENT_PLAN.md'
])
  cpSync(resolve(root, name), resolve(destination, name))
mkdirSync(resolve(destination, 'scripts'), { recursive: true })
cpSync(
  resolve(root, 'scripts/probe-nas.py'),
  resolve(destination, 'scripts/probe-nas.py')
)
cpSync(
  resolve(root, 'tests/container'),
  resolve(destination, 'tests/container'),
  { recursive: true, filter: (source) => !source.includes('__pycache__') }
)
const result = spawnSync(
  'docker',
  [
    'image',
    'save',
    '--output',
    resolve(destination, 'image.tar'),
    inspection.Id
  ],
  { stdio: 'inherit' }
)
if (result.status !== 0) throw new Error('Docker image export failed')
const checksums: Record<string, string> = {}
async function collect(path: string): Promise<void> {
  for (const name of readdirSync(path).sort()) {
    const child = resolve(path, name),
      stat = lstatSync(child)
    if (stat.isDirectory()) await collect(child)
    else if (stat.isFile() && !['manifest.json', 'SHA256SUMS'].includes(name)) {
      const hash = createHash('sha256')
      for await (const bytes of createReadStream(child)) hash.update(bytes)
      checksums[relative(destination, child)] = hash.digest('hex')
    } else if (!stat.isFile()) throw new Error('Unexpected artifact type')
  }
}
await collect(destination)
writeFileSync(
  resolve(destination, 'manifest.json'),
  JSON.stringify(
    {
      title: 'OpenPencil × Synology LAN Portal',
      version: '0.1.0',
      createdAt: new Date().toISOString(),
      imageId: inspection.Id,
      platform: `${inspection.Os}/${inspection.Architecture}`,
      upstream: lock,
      sourcePatchSHA256: createHash('sha256')
        .update(
          readFileSync(
            resolve(root, 'patches/open-pencil/0001-lan-readonly.patch')
          )
        )
        .digest('hex'),
      releaseReady: false,
      authorization: 'dsm-strict',
      blockedChecks: [
        'live NAS native identity/effective ACL',
        'trusted NAS mapping and real negative Google cases',
        'NAS mount/network/reboot',
        'NAS representative FIG/GPU performance'
      ],
      evidence:
        'docs/IMPLEMENTATION_STATUS.md records actual commands and scope; exporting does not perform or attest live acceptance.',
      files: checksums
    },
    null,
    2
  ) + '\n'
)
const manifestHash = createHash('sha256')
  .update(readFileSync(resolve(destination, 'manifest.json')))
  .digest('hex')
writeFileSync(
  resolve(destination, 'SHA256SUMS'),
  Object.entries({ ...checksums, 'manifest.json': manifestHash })
    .map(([name, hash]) => `${hash}  ${name}`)
    .join('\n') + '\n'
)
console.log(
  JSON.stringify({
    directory: destination,
    imageId: inspection.Id,
    platform: inspection.Architecture,
    releaseReady: false
  })
)
