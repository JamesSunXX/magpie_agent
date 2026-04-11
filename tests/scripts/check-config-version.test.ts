import { describe, expect, it } from 'vitest'
import {
  CONFIG_VERSION_SOURCE_PATH,
  extractCurrentConfigVersion,
  shouldRequireConfigVersionBump,
} from '../../scripts/check-config-version.mjs'

describe('check-config-version', () => {
  it('extracts the current config version from loader source', () => {
    expect(extractCurrentConfigVersion('export const CURRENT_CONFIG_VERSION = 3')).toBe(3)
  })

  it('returns false when no config contract files are staged', () => {
    expect(shouldRequireConfigVersionBump({
      stagedFiles: ['README.md', 'tests/cli/program.test.ts'],
      previousVersion: 1,
      nextVersion: 1,
    })).toEqual({
      required: false,
    })
  })

  it('returns true when config contract files changed without a version bump', () => {
    expect(shouldRequireConfigVersionBump({
      stagedFiles: [CONFIG_VERSION_SOURCE_PATH, 'src/platform/config/init.ts'],
      previousVersion: 1,
      nextVersion: 1,
    })).toEqual({
      required: true,
      reason: 'Config contract files changed without a config version bump.',
    })
  })

  it('returns false when config contract files changed and the version increased', () => {
    expect(shouldRequireConfigVersionBump({
      stagedFiles: [CONFIG_VERSION_SOURCE_PATH, 'src/platform/config/init.ts'],
      previousVersion: 1,
      nextVersion: 2,
    })).toEqual({
      required: false,
    })
  })

  it('treats the first recorded version as acceptable when no previous version exists', () => {
    expect(shouldRequireConfigVersionBump({
      stagedFiles: [CONFIG_VERSION_SOURCE_PATH],
      previousVersion: null,
      nextVersion: 1,
    })).toEqual({
      required: false,
    })
  })
})
