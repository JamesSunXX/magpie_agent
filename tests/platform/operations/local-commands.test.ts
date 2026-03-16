import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { LocalCommandsOperationsProvider } from '../../../src/platform/integrations/operations/providers/local-commands.js'

describe('LocalCommandsOperationsProvider', () => {
  it('collects operation evidence from configured commands', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'magpie-ops-'))
    const provider = new LocalCommandsOperationsProvider('local_main', {
      type: 'local-commands',
    })

    const result = await provider.collectEvidence({
      cwd: dir,
      commands: ['node --version', 'node --bad-option'],
    })

    expect(result.runs).toHaveLength(2)
    expect(result.summary).toContain('node --version')
    expect(result.runs[0]?.passed).toBe(true)
    expect(result.runs[1]?.passed).toBe(false)
  })
})
