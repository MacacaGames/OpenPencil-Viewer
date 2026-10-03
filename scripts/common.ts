import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { existsSync } from 'node:fs'
export const root = resolve(import.meta.dirname, '..')
function generatedDirectory(value: string) {
  if (!/^(dist|\.work\/[a-z0-9-]+)$/.test(value))
    throw new Error('Invalid generated directory')
  return resolve(root, value)
}
export const editorRoot = generatedDirectory(
  process.env.PORTAL_BUILD_DIRECTORY ?? '.work/editor'
)
export const outputRoot = generatedDirectory(
  process.env.PORTAL_OUTPUT_DIRECTORY ?? 'dist'
)
export const bun = existsSync(resolve(root, '.tools/node_modules/.bin/bun'))
  ? resolve(root, '.tools/node_modules/.bin/bun')
  : 'bun'
export function run(command: string, args: string[], cwd = root) {
  const result = spawnSync(command, args, {
    cwd,
    stdio: 'inherit',
    env: {
      ...process.env,
      PATH: resolve(root, '.tools/node_modules/.bin') + ':' + process.env.PATH
    }
  })
  if (result.status !== 0) throw new Error(command + ' failed')
}
export function output(command: string, args: string[], cwd = root) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8' })
  if (result.status !== 0) throw new Error(result.stderr)
  return result.stdout.trim()
}
