import { describe, expect, it } from 'vitest'
import { trdCommand } from '../../src/commands/trd.js'

describe('trd command help', () => {
  it('does not expose removed OCR option', () => {
    const help = trdCommand.helpInformation()
    expect(help).not.toContain('--no-ocr')
  })
})
