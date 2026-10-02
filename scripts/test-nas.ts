// This gate must never accept mock/probe evidence as effective DSM authorization.
import { DsmStrictAuthorization } from '../packages/authorization/index.ts'
const provider = new DsmStrictAuthorization()
if (!provider.ready()) {
  console.error(
    'BLOCKED: dsm-strict has no validated native evaluator. Run the manual M0 probe on an authorized isolated NAS, implement the supported bridge, then execute every applicable live ACL_ACCEPTANCE_MATRIX case. Mock tests cannot satisfy this gate.'
  )
  process.exitCode = 2
} else {
  // A future bridge must replace this with live tests, not just a ready flag.
  throw new Error('Live NAS acceptance runner not implemented')
}
