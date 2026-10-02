import { mkdtempSync, writeFileSync, truncateSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { mkdirSync } from 'node:fs'
import { performance } from 'node:perf_hooks'
import { FileIndex } from '../packages/filesystem/index.ts'
mkdirSync('.work', { recursive: true })
const root = mkdtempSync(resolve('.work/transport-benchmark-'))
try {
  for (let i = 0; i < 1000; i++)
    writeFileSync(root + '/metadata-' + i + '.fig', 'synthetic metadata')
  for (const mib of [50, 200, 500]) {
    writeFileSync(root + '/' + mib + '.fig', '')
    truncateSync(root + '/' + mib + '.fig', mib * 1048576)
  }
  const index = new FileIndex(
      [{ id: 'synthetic', path: root, label: 'synthetic' }],
      536870912
    ),
    start = performance.now()
  await index.scan()
  if (!index.online.get('synthetic')) throw new Error('scan failed')
  const scanMs = performance.now() - start
  const rows = []
  for (const mib of [50, 200, 500]) {
    const record = [...index.records.values()].find(
      (r) => r.relative === mib + '.fig'
    )
    if (!record) throw new Error('missing record')
    let received = 0,
      first = 0,
      peak = process.memoryUsage().rss
    const start = performance.now(),
      timer = setInterval(
        () => (peak = Math.max(peak, process.memoryUsage().rss)),
        10
      )
    try {
      const stream = await index.open(record, new AbortController().signal)
      for await (const chunk of stream) {
        if (!first) first = performance.now() - start
        received += chunk.length
        peak = Math.max(peak, process.memoryUsage().rss)
      }
    } finally {
      clearInterval(timer)
    }
    const totalMs = performance.now() - start
    if (received !== mib * 1048576) throw new Error('byte mismatch')
    rows.push({
      mib,
      bytes: received,
      firstByteMs: +first.toFixed(1),
      totalMs: +totalMs.toFixed(1),
      throughputMiBps: +((mib / totalMs) * 1000).toFixed(1),
      parentPeakRSSMiB: +(peak / 1048576).toFixed(1)
    })
  }
  const report = {
    kind: 'synthetic-sparse-raw-transport-only',
    at: new Date().toISOString(),
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    metadataEntries: index.records.size,
    scanMs: +scanMs.toFixed(1),
    rows,
    notMeasured: [
      'real FIG decode/layout/GPU',
      'browser RSS',
      'reader child RSS',
      'physical NAS disk',
      'LAN/proxy',
      'representative files'
    ]
  }
  writeFileSync(
    '.work/performance.json',
    JSON.stringify(report, null, 2) + '\n'
  )
  console.log(JSON.stringify(report, null, 2))
} finally {
  rmSync(root, { recursive: true, force: true })
}
