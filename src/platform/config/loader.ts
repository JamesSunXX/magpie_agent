import {
  expandEnvVars,
  getConfigPath,
  loadConfig as loadLegacyConfig,
} from '../../config/loader.js'
import type { MagpieConfig as LegacyMagpieConfig } from '../../config/types.js'
import { migrateConfigToV2 } from './migration.js'
import type { MagpieConfigV2 } from './types.js'

export { expandEnvVars, getConfigPath }

export function loadConfigV2(configPath?: string): MagpieConfigV2 {
  const legacy = loadLegacyConfig(configPath) as LegacyMagpieConfig
  return migrateConfigToV2(legacy)
}

export function loadConfig(configPath?: string): MagpieConfigV2 {
  return loadConfigV2(configPath)
}
