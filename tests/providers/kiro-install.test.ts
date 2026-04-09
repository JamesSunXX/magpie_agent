import { execFileSync } from 'child_process'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it } from 'vitest'

function cloneFixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'kiro-src-'))
  const source = join(root, 'kiro-config')
  mkdirSync(join(source, 'prompts'), { recursive: true })
  mkdirSync(join(source, 'agents'), { recursive: true })
  writeFileSync(join(source, 'prompts', 'code_review.md'), 'prompt-v1', 'utf-8')
  writeFileSync(join(source, 'agents', 'kiro_default.md'), '# default agent\n', 'utf-8')
  writeFileSync(join(source, 'install.sh'), `#!/usr/bin/env bash
set -euo pipefail

KIRO_HOME="\${KIRO_HOME:-$HOME/.kiro}"
SOURCE_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKUP_ROOT="$KIRO_HOME/.magpie-backups"
METADATA_DIR="$KIRO_HOME/.magpie"
mkdir -p "$METADATA_DIR"

copy_managed_file() {
  local rel="$1"
  local src="$SOURCE_DIR/$rel"
  local dst="$KIRO_HOME/$rel"
  local dst_dir
  dst_dir="$(dirname "$dst")"
  mkdir -p "$dst_dir"

  if [ -f "$dst" ] && ! cmp -s "$src" "$dst"; then
    mkdir -p "$BACKUP_ROOT/$(dirname "$rel")"
    cp "$dst" "$BACKUP_ROOT/$rel"
  fi

  cp "$src" "$dst"
}

copy_managed_file "prompts/code_review.md"
copy_managed_file "agents/kiro_default.md"

cat > "$METADATA_DIR/kiro-install.json" <<'EOF'
{"sourceVersion":"test-version"}
EOF
`, 'utf-8')
  return source
}

describe('kiro install script', () => {
  it('writes metadata and skips backup for identical files', () => {
    const source = cloneFixture()
    const home = mkdtempSync(join(tmpdir(), 'kiro-home-'))
    const script = join(source, 'install.sh')

    execFileSync('bash', [script], {
      cwd: source,
      env: { ...process.env, KIRO_HOME: home },
      stdio: 'pipe',
    })

    execFileSync('bash', [script], {
      cwd: source,
      env: { ...process.env, KIRO_HOME: home },
      stdio: 'pipe',
    })

    expect(existsSync(join(home, '.magpie', 'kiro-install.json'))).toBe(true)
    expect(existsSync(join(home, '.magpie-backups'))).toBe(false)
  })

  it('backs up changed managed files before overwrite', () => {
    const source = cloneFixture()
    const home = mkdtempSync(join(tmpdir(), 'kiro-home-'))
    const script = join(source, 'install.sh')
    writeFileSync(join(source, 'prompts', 'code_review.md'), 'prompt-v2', 'utf-8')
    mkdirSync(join(home, 'prompts'), { recursive: true })
    writeFileSync(join(home, 'prompts', 'code_review.md'), 'prompt-v1', 'utf-8')

    execFileSync('bash', [script], {
      cwd: source,
      env: { ...process.env, KIRO_HOME: home },
      stdio: 'pipe',
    })

    expect(readFileSync(join(home, 'prompts', 'code_review.md'), 'utf-8')).toBe('prompt-v2')
    expect(existsSync(join(home, '.magpie-backups'))).toBe(true)
  })
})
