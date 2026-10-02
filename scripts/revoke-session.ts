import { State } from '../apps/api/state.ts'
import { existsSync } from 'node:fs'
const [path, principal, ...extra] = process.argv.slice(2)
if (!path || !principal || extra.length || !existsSync(path))
  throw new Error(
    'Usage: revoke-session.ts EXISTING_STATE_SQLITE EXACT_PRINCIPAL_KEY'
  )
const state = new State(path)
try {
  console.log(JSON.stringify({ revoked: state.revokePrincipal(principal) }))
} finally {
  state.close()
}
