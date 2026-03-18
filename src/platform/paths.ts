import { homedir } from 'os'
import { join } from 'path'

/**
 * Resolve the Magpie data directory, allowing tests and sandboxes to override it.
 */
export function getMagpieHomeDir(): string {
  return process.env.MAGPIE_HOME || join(homedir(), '.magpie')
}

