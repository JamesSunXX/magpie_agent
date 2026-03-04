import { describe, expect, it } from 'vitest'
import { createCapabilityRegistry } from '../../../src/core/capability/registry.js'
import type { CapabilityModule } from '../../../src/core/capability/types.js'

const mockCapability: CapabilityModule<string, string, string, string> = {
  name: 'review',
  async prepare(input) { return input },
  async execute(prepared) { return prepared },
  async summarize(result) { return result },
  async report() {},
}

describe('capability registry', () => {
  it('registers and resolves capabilities', () => {
    const registry = createCapabilityRegistry([mockCapability])

    expect(registry.has('review')).toBe(true)
    expect(registry.get('review')).toBe(mockCapability)
    expect(registry.list()).toEqual(['review'])
  })

  it('throws on duplicate registration', () => {
    const registry = createCapabilityRegistry([mockCapability])
    expect(() => registry.register(mockCapability)).toThrow(/already registered/)
  })
})
