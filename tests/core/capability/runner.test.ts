import { describe, expect, it } from 'vitest'
import { createCapabilityContext } from '../../../src/core/capability/context.js'
import { runCapability } from '../../../src/core/capability/runner.js'
import type { CapabilityModule } from '../../../src/core/capability/types.js'

describe('runCapability', () => {
  it('runs lifecycle in order', async () => {
    const calls: string[] = []

    const module: CapabilityModule<number, number, number, number> = {
      name: 'discuss',
      async prepare(input) {
        calls.push('prepare')
        return input + 1
      },
      async execute(prepared) {
        calls.push('execute')
        return prepared + 1
      },
      async summarize(result) {
        calls.push('summarize')
        return result + 1
      },
      async report() {
        calls.push('report')
      },
    }

    const output = await runCapability(module, 1, createCapabilityContext())

    expect(calls).toEqual(['prepare', 'execute', 'summarize', 'report'])
    expect(output.prepared).toBe(2)
    expect(output.result).toBe(3)
    expect(output.output).toBe(4)
  })
})
