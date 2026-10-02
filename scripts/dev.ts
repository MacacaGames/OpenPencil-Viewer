import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { run } from './common.ts'
if (!existsSync('dist/web/index.html'))
  run(process.execPath, ['--import', 'tsx', 'scripts/build.ts'])
const mode = process.argv[2] === 'google' ? 'google' : 'mock'
const server = spawn(
  process.execPath,
  [
    ...(mode === 'google' && existsSync('.env.google')
      ? ['--env-file=.env.google']
      : []),
    '--import',
    'tsx',
    'apps/api/server.ts'
  ],
  { stdio: 'inherit', env: { ...process.env, PORTAL_PROFILE: mode } }
)
for (const signal of ['SIGTERM', 'SIGINT'] as const)
  process.on(signal, () => server.kill(signal))
server.on('exit', (code) => process.exit(code ?? 1))
