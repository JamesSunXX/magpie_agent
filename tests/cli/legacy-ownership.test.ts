import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

function read(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf-8')
}

describe('CLI ownership cleanup', () => {
  it('keeps init/reviewers/stats as real cli modules, not re-export shells', () => {
    expect(read('src/cli/commands/init.ts')).not.toMatch(/^export \{ initCommand \} from /m)
    expect(read('src/cli/commands/reviewers.ts')).not.toMatch(/^export \{ reviewersCommand \} from /m)
    expect(read('src/cli/commands/stats.ts')).not.toMatch(/^export \{ statsCommand \} from /m)
  })
})
