import { run, bun } from './common.ts'
process.env.GIT_LFS_SKIP_SMUDGE = '1'
run('git', ['submodule', 'update', '--init'])
run(bun, ['install', '--frozen-lockfile'])
run(process.execPath, ['--import', 'tsx', 'scripts/prepare-upstream.ts'])
