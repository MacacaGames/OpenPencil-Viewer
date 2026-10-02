import { loadRuntimeConfig } from './runtime-config.ts'
import { DsmStrictAuthorization } from '../../packages/authorization/index.ts'
try {
  const config = loadRuntimeConfig()
  console.log(
    JSON.stringify(
      {
        configuration: 'valid',
        origin: config.origin,
        hostedDomains: config.allowedHostedDomains,
        authorization: config.authorizationMode,
        sharedBrowseValidation: config.authorizationMode === 'google-mount',
        nativeBridgeConfigured: Boolean(config.nasBridge),
        releaseReady: new DsmStrictAuthorization().ready(),
        blockingReasons: [
          config.authorizationMode === 'google-mount'
            ? 'shared-browse-validation-does-not-enforce-dsm-acl'
            : config.nasBridge
              ? 'native-bridge-live-acceptance-not-checked'
              : 'native-dsm-provider-not-validated'
        ],
        checksNotRun: [
          'live-google',
          'live-nas-identity-acl',
          'mount-network-reboot',
          'representative-fig-performance'
        ]
      },
      null,
      2
    )
  )
  process.exitCode = config.authorizationMode === 'google-mount' ? 0 : 2
} catch (error) {
  console.error(
    error instanceof Error ? error.message : 'Configuration unavailable'
  )
  process.exitCode = 1
}
