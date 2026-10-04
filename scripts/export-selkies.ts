import { spawnSync } from 'node:child_process'
import {
  mkdirSync,
  cpSync,
  readFileSync,
  writeFileSync,
  createReadStream,
  readdirSync,
  lstatSync
} from 'node:fs'
import { createHash } from 'node:crypto'
import { resolve, relative } from 'node:path'
import { root, output } from './common.ts'
import { verifyUpstream } from './verify-upstream.ts'
verifyUpstream()
const image = process.argv[2] ?? 'openpencil-viewer:0.1.0'
const info = JSON.parse(
  output('docker', ['image', 'inspect', '--format', '{{json .}}', image])
)
const lock = JSON.parse(
  readFileSync(resolve(root, 'upstream.lock.json'), 'utf8')
)
if (
  info.Os !== 'linux' ||
  info.Architecture !== 'amd64' ||
  info.Config.User !== '10001:10001' ||
  info.Config.Labels?.['portal.upstream.sha'] !== lock.sha ||
  !(
    info.Config.Labels?.['portal.features']?.split(',').includes('selkies') ||
    info.Config.Labels?.['org.opencontainers.image.version'] === '0.1.0-selkies'
  )
)
  throw new Error('Unexpected Selkies image platform/user/version/upstream')
const destination = resolve(
  root,
  '.work/releases',
  'selkies-amd64-' + info.Id.slice(7, 19)
)
mkdirSync(destination, { recursive: true })
mkdirSync(resolve(destination, 'scripts'), { recursive: true })
mkdirSync(resolve(destination, 'docs'), { recursive: true })
mkdirSync(resolve(destination, 'deploy/selkies'), { recursive: true })
// Explicit public allowlist. No FIG, config credentials, source tree or state.
for (const name of [
  'Dockerfile',
  'versions.json',
  'chromium-policy.json',
  'seccomp-chromium.json',
  'compose.unraid.yml',
  'compose.gpu.yml',
  'config.example.json',
  'env.example',
  'nginx.example.conf'
])
  cpSync(
    resolve(root, 'deploy/selkies', name),
    resolve(destination, 'deploy/selkies', name),
    { dereference: true }
  )
for (const name of ['UNRAID_SELKIES.zh-TW.md', 'IMPLEMENTATION_STATUS.md'])
  cpSync(resolve(root, 'docs', name), resolve(destination, 'docs', name))
cpSync(
  resolve(root, 'scripts/probe-remote-gpu.sh'),
  resolve(destination, 'scripts/probe-remote-gpu.sh')
)
cpSync(
  resolve(root, 'upstream.lock.json'),
  resolve(destination, 'upstream.lock.json')
)
const result = spawnSync(
  'docker',
  ['image', 'save', '--output', resolve(destination, 'image.tar'), image],
  { stdio: 'inherit' }
)
if (result.status !== 0) throw new Error('Image export failed')
const checksums: Record<string, string> = {}
async function collect(path: string) {
  for (const name of readdirSync(path).sort()) {
    const child = resolve(path, name),
      stat = lstatSync(child)
    if (stat.isDirectory()) await collect(child)
    else if (stat.isFile() && !['manifest.json', 'SHA256SUMS'].includes(name)) {
      const hash = createHash('sha256')
      for await (const bytes of createReadStream(child)) hash.update(bytes)
      checksums[relative(destination, child)] = hash.digest('hex')
    } else if (!stat.isFile())
      throw new Error('Unexpected non-regular artifact')
  }
}
await collect(destination)
writeFileSync(
  resolve(destination, 'manifest.json'),
  JSON.stringify(
    {
      title: 'OpenPencil Selkies manual deployment',
      createdAt: new Date().toISOString(),
      image,
      imageId: info.Id,
      platform: 'linux/amd64',
      upstream: lock,
      authorization: 'google-mount',
      productionAcceptance: false,
      pending: [
        'Unraid/Docker/libseccomp/kernel compatibility',
        'actual R7 250 / RX 5600 / RX 5700 renderer and encode diagnostics',
        'approved CIFS/NFS source and outage checks (operator-selected RO/RW)',
        'real Google Workspace callback/proxy',
        'Unraid representative FIG performance, DPI and text quality'
      ],
      evidence:
        'docs/IMPLEMENTATION_STATUS.md; export does not attest live acceptance',
      files: checksums
    },
    null,
    2
  ) + '\n'
)
checksums['manifest.json'] = createHash('sha256')
  .update(readFileSync(resolve(destination, 'manifest.json')))
  .digest('hex')
writeFileSync(
  resolve(destination, 'SHA256SUMS'),
  Object.entries(checksums)
    .map(([name, hash]) => `${hash}  ${name}`)
    .join('\n') + '\n'
)
console.log(
  JSON.stringify(
    { destination, image, imageId: info.Id, productionAcceptance: false },
    null,
    2
  )
)
