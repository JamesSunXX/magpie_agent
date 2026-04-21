import { createCapabilityRegistry } from '../core/capability/registry.js'
import type { AnyCapabilityModule } from '../core/capability/types.js'
import { loadConfig } from '../platform/config/loader.js'
import type { MagpieConfigV2 } from '../platform/config/types.js'
import { discussCapability } from './discuss/index.js'
import { isRuntimeCapabilityEnabled, type RuntimeCapabilityId } from './routing/index.js'
import { docsSyncCapability } from './workflows/docs-sync/index.js'
import { harnessCapability } from './workflows/harness/index.js'
import { issueFixCapability } from './workflows/issue-fix/index.js'
import { loopCapability } from './loop/index.js'
import { postMergeRegressionCapability } from './workflows/post-merge-regression/index.js'
import { unitTestEvalCapability } from './quality/unit-test-eval/index.js'
import { reviewCapability } from './review/index.js'
import { statsCapability } from './stats/index.js'
import { trdCapability } from './trd/index.js'

export { reviewCapability } from './review/index.js'
export { discussCapability } from './discuss/index.js'
export { trdCapability } from './trd/index.js'
export { statsCapability } from './stats/index.js'
export { issueFixCapability } from './workflows/issue-fix/index.js'
export { docsSyncCapability } from './workflows/docs-sync/index.js'
export { postMergeRegressionCapability } from './workflows/post-merge-regression/index.js'
export { harnessCapability } from './workflows/harness/index.js'
export { unitTestEvalCapability } from './quality/unit-test-eval/index.js'
export { loopCapability } from './loop/index.js'

interface RuntimeCapabilityRegistration {
  id: RuntimeCapabilityId
  module: AnyCapabilityModule
}

export interface CreateDefaultCapabilityRegistryOptions {
  config?: MagpieConfigV2
  configPath?: string
}

const RUNTIME_CAPABILITY_REGISTRATIONS: RuntimeCapabilityRegistration[] = [
  { id: 'review', module: reviewCapability },
  { id: 'discuss', module: discussCapability },
  { id: 'trd', module: trdCapability },
  { id: 'stats', module: statsCapability },
  { id: 'issue-fix', module: issueFixCapability },
  { id: 'docs-sync', module: docsSyncCapability },
  { id: 'post-merge-regression', module: postMergeRegressionCapability },
  { id: 'harness', module: harnessCapability },
  { id: 'quality/unit-test-eval', module: unitTestEvalCapability },
  { id: 'loop', module: loopCapability },
]

function resolveRegistryConfig(options?: CreateDefaultCapabilityRegistryOptions): MagpieConfigV2 | undefined {
  if (options?.config) {
    return options.config
  }
  if (!options) {
    return undefined
  }

  try {
    return loadConfig(options.configPath)
  } catch {
    return undefined
  }
}

export function createDefaultCapabilityRegistry(options?: CreateDefaultCapabilityRegistryOptions) {
  const config = resolveRegistryConfig(options)
  const modules = RUNTIME_CAPABILITY_REGISTRATIONS
    .filter(({ id }) => !config || isRuntimeCapabilityEnabled(config, id))
    .map(({ module }) => module)

  return createCapabilityRegistry(modules)
}
