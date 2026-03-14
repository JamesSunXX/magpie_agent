import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'fs'
import { resolve, join } from 'path'

function read(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf-8')
}

function walkTs(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = join(dir, entry.name)
    if (entry.isDirectory()) return walkTs(fullPath)
    return entry.name.endsWith('.ts') ? [fullPath] : []
  })
}

describe('capability direct import cleanup', () => {
  it('keeps capability sources free of direct src/commands imports', () => {
    const capabilityFiles = walkTs(resolve(process.cwd(), 'src/capabilities'))

    for (const file of capabilityFiles) {
      const content = readFileSync(file, 'utf-8')
      expect(content, file).not.toMatch(/from\s+'(?:\.\.\/)+commands\//)
    }
  })

  it('keeps review presentation modules as real implementations, not re-export shells', () => {
    expect(read('src/capabilities/review/presentation/interactive.ts')).not.toMatch(/^export \* from /m)
    expect(read('src/capabilities/review/presentation/session-cmds.ts')).not.toMatch(/^export \* from /m)
  })

  it('keeps discuss runtime support local to capability/core, not commands discussion helpers', () => {
    expect(read('src/capabilities/discuss/domain/runner.ts')).not.toMatch(/^export \* from /m)
  })
})
