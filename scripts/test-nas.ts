// This gate must never accept mock/probe evidence as effective DSM authorization.
import { DsmStrictAuthorization } from '../packages/authorization/index.ts'
const provider = new DsmStrictAuthorization()
if (!provider.ready()) {
  console.error(
    'BLOCKED: bridge transport is implemented, but no validated DSM native adapter or live acceptance runner exists. Collect the supported target-native identity/ACL schema, implement the adapter, then run every applicable live ACL_ACCEPTANCE_MATRIX case on isolated synthetic fixtures. The authorized existing-source metadata probe and Mock tests cannot satisfy this gate.'
  )
  process.exitCode = 2
} else {
  // A future bridge must replace this with live tests, not just a ready flag.
  throw new Error('Live NAS acceptance runner not implemented')
}
