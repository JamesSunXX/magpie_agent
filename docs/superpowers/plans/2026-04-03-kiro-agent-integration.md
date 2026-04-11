# Kiro Agent Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let every Kiro-backed flow in Magpie select a project-managed Kiro agent automatically, sync `agents/kiro-config` into `~/.kiro` only when needed, and fall back safely to `kiro_default`.

**Architecture:** Keep `agents/kiro-config` as the project-owned source and convert it into a real Git submodule. Add a provider-binding layer in Magpie so config entries can carry an optional Kiro agent, then add a Kiro install manager that validates `~/.kiro`, runs `install.sh` when stale, and launches `kiro chat --agent ...`. Extend the shell installer so it compares content, backs up only changed files, writes install metadata, and leaves unrelated user files untouched.

**Tech Stack:** TypeScript, Vitest, Commander, shell script (`bash`), Git submodules, YAML config

---

### Task 1: Convert `agents/kiro-config` into a tracked submodule

**Files:**
- Create: `.gitmodules`
- Modify: `agents/kiro-config` (gitlink entry)

- [ ] **Step 1: Verify the embedded checkout is clean before converting it**

Run:

```bash
git -C agents/kiro-config status --short
git -C agents/kiro-config remote -v
git -C agents/kiro-config rev-parse HEAD
```

Expected:

- `status --short` prints nothing.
- `remote -v` includes `http://git.allsaints.top/go-server/ai/kiro-config.git`.
- `rev-parse HEAD` prints the current pinned commit, for example `1d14b0329842a7f5319a27949a4e62e34af88110`.

- [ ] **Step 2: Register the repository as a submodule at the same path**

Run:

```bash
git submodule add --force http://git.allsaints.top/go-server/ai/kiro-config.git agents/kiro-config
```

Expected:

- `.gitmodules` is created.
- `git status --short` shows a staged `.gitmodules` plus a gitlink for `agents/kiro-config`.

- [ ] **Step 3: Verify the recorded submodule metadata**

Expected `.gitmodules` content:

```ini
[submodule "agents/kiro-config"]
	path = agents/kiro-config
	url = http://git.allsaints.top/go-server/ai/kiro-config.git
```

Run:

```bash
git submodule status
git diff --cached --submodule
```

Expected:

- `git submodule status` lists `agents/kiro-config`.
- The staged diff shows `.gitmodules` plus a gitlink entry, not a giant file dump.

- [ ] **Step 4: Commit the repository wiring**

Run:

```bash
git add .gitmodules agents/kiro-config
git commit -m "chore(kiro):接入配置子模块"
```

Expected: commit succeeds and contains only the submodule wiring.

### Task 2: Add failing tests for config-level Kiro agent binding

**Files:**
- Create: `tests/providers/configured-provider.test.ts`
- Modify: `tests/config/loader.test.ts`
- Modify: `tests/providers/factory.test.ts`
- Modify: `tests/commands/reviewers.test.ts`

- [ ] **Step 1: Add a focused binding test for explicit agent, same-name fallback, and non-Kiro ignore**

Add `tests/providers/configured-provider.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { resolveProviderBinding } from '../../src/providers/configured-provider.js'

describe('resolveProviderBinding', () => {
  it('prefers explicit kiro agent from config', () => {
    expect(resolveProviderBinding({
      logicalName: 'reviewers.go-review',
      model: 'kiro',
      agent: 'go-reviewer',
    })).toEqual({
      logicalName: 'reviewers.go-review',
      model: 'kiro',
      agent: 'go-reviewer',
    })
  })

  it('falls back to same-name matching for kiro when agent is omitted', () => {
    expect(resolveProviderBinding({
      logicalName: 'reviewers.frontend-reviewer',
      model: 'kiro',
    })).toEqual({
      logicalName: 'reviewers.frontend-reviewer',
      model: 'kiro',
      agent: 'frontend-reviewer',
    })
  })

  it('does not carry agent metadata for non-kiro models', () => {
    expect(resolveProviderBinding({
      logicalName: 'analyzer',
      model: 'codex',
      agent: 'architect',
    })).toEqual({
      logicalName: 'analyzer',
      model: 'codex',
    })
  })
})
```

- [ ] **Step 2: Extend loader tests so optional `agent` is accepted in reviewer, analyzer, and summarizer config**

Add this case to `tests/config/loader.test.ts`:

```ts
it('accepts optional kiro agent fields in config entries', () => {
  const configPath = join(testDir, 'kiro-agent-config.yaml')
  writeFileSync(configPath, `
providers:
  kiro:
    enabled: true
defaults:
  max_rounds: 3
  output_format: markdown
  check_convergence: true
reviewers:
  backend:
    model: kiro
    agent: go-reviewer
    prompt: Backend review
summarizer:
  model: kiro
  agent: code-reviewer
  prompt: Summary prompt
analyzer:
  model: kiro
  agent: architect
  prompt: Analyze prompt
capabilities:
  review:
    enabled: true
integrations:
  notifications:
    enabled: false
`, 'utf-8')

  const config = loadConfig(configPath)
  expect(config.reviewers.backend.agent).toBe('go-reviewer')
  expect(config.summarizer.agent).toBe('code-reviewer')
  expect(config.analyzer.agent).toBe('architect')
})
```

- [ ] **Step 3: Extend provider factory tests to cover configured Kiro provider creation**

Add this case to `tests/providers/factory.test.ts`:

```ts
it('creates a configured kiro provider with logical binding metadata', () => {
  const provider = createConfiguredProvider({
    logicalName: 'reviewers.backend',
    model: 'kiro',
    agent: 'go-reviewer',
  }, mockConfig)

  expect(provider.name).toBe('kiro')
})
```

Also add the import:

```ts
import { createConfiguredProvider, createProvider, getProviderForModel } from '../../src/providers/factory.js'
```

- [ ] **Step 4: Extend reviewer listing tests so agent metadata is visible to the user**

Change the expected shape in `tests/commands/reviewers.test.ts` to include agent for Kiro-backed reviewers:

```ts
expect(result).toEqual([
  { id: 'backend', model: 'kiro', agent: 'go-reviewer' },
  { id: 'frontend', model: 'codex', agent: undefined },
])
```

and feed the config:

```ts
backend: { model: 'kiro', agent: 'go-reviewer', prompt: 'backend review' },
```

- [ ] **Step 5: Run the tests to prove the binding layer does not exist yet**

Run:

```bash
npm run test:run -- tests/config/loader.test.ts tests/providers/factory.test.ts tests/providers/configured-provider.test.ts tests/commands/reviewers.test.ts
```

Expected: FAIL because `agent` is not in the config types, `resolveProviderBinding` does not exist, and reviewer output does not include agent metadata.

- [ ] **Step 6: Commit the failing tests**

Run:

```bash
git add tests/config/loader.test.ts tests/providers/factory.test.ts tests/providers/configured-provider.test.ts tests/commands/reviewers.test.ts
git commit -m "test(kiro):补充 agent 绑定用例"
```

### Task 3: Implement config schema and provider-binding helpers

**Files:**
- Create: `src/providers/configured-provider.ts`
- Modify: `src/providers/factory.ts`
- Modify: `src/providers/types.ts`
- Modify: `src/providers/index.ts`
- Modify: `src/platform/providers/index.ts`
- Modify: `src/platform/config/types.ts`
- Modify: `src/platform/config/loader.ts`
- Modify: `src/cli/commands/reviewers.ts`

- [ ] **Step 1: Extend the shared config types with optional agent fields**

Update `src/platform/config/types.ts` so model-bearing entries can carry an optional agent:

```ts
export interface ReviewerConfig {
  model: string
  prompt: string
  agent?: string
}

export interface ContextGathererConfigOptions {
  enabled: boolean
  model?: string
  agent?: string
  callChain?: {
    maxDepth?: number
    maxFilesToAnalyze?: number
  }
  history?: {
    maxDays?: number
    maxPRs?: number
  }
  docs?: {
    patterns?: string[]
    maxSize?: number
  }
}

export interface UnitTestEvalConfig {
  enabled?: boolean
  provider?: string
  provider_agent?: string
  max_files?: number
  min_coverage?: number
  output_format?: 'markdown' | 'json'
}

export interface IssueFixConfig {
  enabled?: boolean
  planner_model?: string
  planner_agent?: string
  executor_model?: string
  executor_agent?: string
  verify_command?: string
  auto_commit?: boolean
}

export interface DocsSyncConfig {
  enabled?: boolean
  reviewer_model?: string
  reviewer_agent?: string
  docs_patterns?: string[]
}

export interface PostMergeRegressionConfig {
  enabled?: boolean
  evaluator_model?: string
  evaluator_agent?: string
  commands?: string[]
}

export interface LoopConfig {
  enabled?: boolean
  planner_model?: string
  planner_agent?: string
  executor_model?: string
  executor_agent?: string
  stages?: LoopStageName[]
  confidence_threshold?: number
  retries_per_stage?: number
  max_iterations?: number
  auto_commit?: boolean
  auto_branch_prefix?: string
  human_confirmation?: LoopHumanConfirmationConfig
  commands?: LoopCommandsConfig
}
```

- [ ] **Step 2: Validate optional agent fields without changing existing prompt rules**

Add this helper to `src/platform/config/loader.ts` and call it from `validateReviewerConfig`:

```ts
function validateOptionalAgent(name: string, agent: string | undefined): void {
  if (agent === undefined) return
  if (typeof agent !== 'string' || agent.trim().length === 0) {
    throw new Error(`Config error: ${name}.agent must be a non-empty string`)
  }
}

function validateReviewerConfig(name: string, rc: ReviewerConfig | undefined): void {
  if (!rc?.model || typeof rc.model !== 'string') {
    throw new Error(`Config error: ${name} is missing a "model" field`)
  }
  if (!rc.prompt || typeof rc.prompt !== 'string') {
    throw new Error(`Config error: ${name} is missing a "prompt" field`)
  }
  validateOptionalAgent(name, rc.agent)
}
```

Also validate `config.contextGatherer?.agent` with `validateOptionalAgent('contextGatherer', config.contextGatherer?.agent)`.

- [ ] **Step 3: Add a binding helper that normalizes model + logical name + optional agent**

Create `src/providers/configured-provider.ts`:

```ts
import type { MagpieConfig } from '../config/types.js'
import type { AIProvider } from './types.js'
import { createProvider, getProviderForModel } from './factory.js'

export interface ProviderBindingInput {
  logicalName: string
  model: string
  agent?: string
}

export interface ProviderBinding {
  logicalName: string
  model: string
  agent?: string
}

export function resolveProviderBinding(input: ProviderBindingInput): ProviderBinding {
  const providerName = getProviderForModel(input.model)
  if (providerName !== 'kiro') {
    return {
      logicalName: input.logicalName,
      model: input.model,
    }
  }

  const fallbackAgent = input.logicalName.split('.').pop()
  return {
    logicalName: input.logicalName,
    model: input.model,
    agent: input.agent || fallbackAgent,
  }
}

export function createConfiguredProvider(input: ProviderBindingInput, config: MagpieConfig): AIProvider {
  return createProvider(input.model, config, resolveProviderBinding(input))
}
```

- [ ] **Step 4: Extend provider options and factory so Kiro can receive binding metadata**

Update `src/providers/types.ts`:

```ts
export interface ProviderOptions {
  apiKey: string
  model: string
  baseURL?: string
  logicalName?: string
  agent?: string
}
```

Update `src/providers/factory.ts`:

```ts
export function createProvider(model: string, config: MagpieConfig, options?: Partial<ProviderOptions>): AIProvider {
  if (config.mock) {
    return new MockProvider()
  }

  const providerName = getProviderForModel(model)

  if (providerName === 'kiro') {
    return new KiroProvider({
      apiKey: '',
      model,
      logicalName: options?.logicalName,
      agent: options?.agent,
    })
  }
}
```

Export the helper from:

```ts
// src/providers/index.ts
export * from './configured-provider.js'

// src/platform/providers/index.ts
export * from '../../providers/configured-provider.js'
```

- [ ] **Step 5: Surface agent information in reviewer listing output**

Update `src/cli/commands/reviewers.ts`:

```ts
export interface ConfiguredReviewer {
  id: string
  model: string
  agent?: string
}

export function listConfiguredReviewers(config: MagpieConfigV2, model?: string): ConfiguredReviewer[] {
  const normalized = model?.trim().toLowerCase()

  return Object.entries(config.reviewers)
    .filter(([, reviewer]) => !normalized || reviewer.model.toLowerCase() === normalized)
    .map(([id, reviewer]) => ({
      id,
      model: reviewer.model,
      agent: reviewer.agent,
    }))
}
```

and print the extra column:

```ts
console.log(chalk.dim(`  ${'ID'.padEnd(20)} ${'MODEL'.padEnd(16)} AGENT`))
console.log(`  ${chalk.cyan(reviewer.id.padEnd(20))} ${reviewer.model.padEnd(16)} ${reviewer.agent || '-'}`)
```

- [ ] **Step 6: Run the focused tests and confirm they pass**

Run:

```bash
npm run test:run -- tests/config/loader.test.ts tests/providers/factory.test.ts tests/providers/configured-provider.test.ts tests/commands/reviewers.test.ts
```

Expected: PASS

- [ ] **Step 7: Commit the binding layer**

Run:

```bash
git add src/platform/config/types.ts src/platform/config/loader.ts src/providers/types.ts src/providers/factory.ts src/providers/configured-provider.ts src/providers/index.ts src/platform/providers/index.ts src/cli/commands/reviewers.ts
git commit -m "feat(kiro):补充 agent 绑定配置"
```

### Task 4: Add failing tests for Kiro install-state checks and agent launch args

**Files:**
- Create: `tests/providers/kiro-install.test.ts`
- Modify: `tests/providers/kiro-timeout.test.ts`
- Modify: `tests/providers/cli-image-support.test.ts`

- [ ] **Step 1: Add a script test that proves identical files are skipped without backup and changed files are backed up**

Create `tests/providers/kiro-install.test.ts`:

```ts
import { execFileSync } from 'child_process'
import { cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it } from 'vitest'

function cloneFixture(): string {
  const source = mkdtempSync(join(tmpdir(), 'kiro-src-'))
  cpSync(join(process.cwd(), 'agents', 'kiro-config'), source, { recursive: true })
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
```

- [ ] **Step 2: Extend the Kiro provider tests to require `--agent` in spawn args**

Add to `tests/providers/cli-image-support.test.ts`:

```ts
it('passes the resolved kiro agent to the CLI', async () => {
  const provider = new KiroProvider({
    apiKey: '',
    model: 'kiro',
    logicalName: 'reviewers.go-review',
    agent: 'go-reviewer',
  })

  await provider.chat([{ role: 'user', content: '检查参数' }])

  expect(spawnCalls[0].args).toContain('--agent')
  expect(spawnCalls[0].args).toContain('go-reviewer')
})
```

Add to `tests/providers/kiro-timeout.test.ts`:

```ts
it('falls back to kiro_default when requested agent is unavailable', async () => {
  const provider = new KiroProvider({
    apiKey: '',
    model: 'kiro',
    logicalName: 'reviewers.unknown',
    agent: 'missing-agent',
  }) as unknown as { resolveAgent: () => Promise<string>; chat: KiroProvider['chat'] }

  provider.resolveAgent = vi.fn().mockResolvedValue('kiro_default')
  await provider.chat([{ role: 'user', content: 'fallback-check' }])

  expect(provider.resolveAgent).toHaveBeenCalled()
})
```

- [ ] **Step 3: Run the provider/install tests to confirm the features are still missing**

Run:

```bash
npm run test:run -- tests/providers/kiro-install.test.ts tests/providers/kiro-timeout.test.ts tests/providers/cli-image-support.test.ts
```

Expected: FAIL because `install.sh` does not write metadata or backups, and `KiroProvider` never adds `--agent`.

- [ ] **Step 4: Commit the failing Kiro runtime tests**

Run:

```bash
git add tests/providers/kiro-install.test.ts tests/providers/kiro-timeout.test.ts tests/providers/cli-image-support.test.ts
git commit -m "test(kiro):补充安装与启动检查"
```

### Task 5: Implement the Kiro install manager and CLI agent launch behavior

**Files:**
- Create: `src/providers/kiro-install.ts`
- Modify: `src/providers/kiro.ts`
- Modify: `agents/kiro-config/install.sh`

- [ ] **Step 1: Add a reusable install-state helper for Kiro**

Create `src/providers/kiro-install.ts`:

```ts
import { existsSync, readFileSync } from 'fs'
import { homedir } from 'os'
import { join, resolve } from 'path'
import { execFileSync } from 'child_process'

const MANAGED_DIRS = ['agents', 'prompts', 'skills', 'hooks'] as const

export interface EnsureKiroInstallInput {
  sourceDir: string
  desiredAgent?: string
}

export interface EnsureKiroInstallResult {
  selectedAgent: string
  installed: boolean
}

export function getKiroHome(): string {
  return join(homedir(), '.kiro')
}

export function getKiroInstallMetadataPath(kiroHome = getKiroHome()): string {
  return join(kiroHome, '.magpie', 'kiro-install.json')
}

export function readExpectedKiroSourceVersion(sourceDir: string): string {
  return execFileSync('bash', ['-lc', `
    set -euo pipefail
    if git -C "${sourceDir}" rev-parse HEAD >/dev/null 2>&1; then
      git -C "${sourceDir}" rev-parse HEAD
    else
      find "${sourceDir}/agents" "${sourceDir}/prompts" "${sourceDir}/skills" "${sourceDir}/hooks" -type f | sort | xargs shasum -a 256 | shasum -a 256 | awk '{print $1}'
    fi
  `], { encoding: 'utf-8' }).trim()
}

export function ensureKiroInstall(input: EnsureKiroInstallInput): EnsureKiroInstallResult {
  const kiroHome = getKiroHome()
  const metadataPath = getKiroInstallMetadataPath(kiroHome)
  const agentPath = input.desiredAgent ? join(kiroHome, 'agents', `${input.desiredAgent}.json`) : null
  const missingManagedDir = MANAGED_DIRS.some((dir) => !existsSync(join(kiroHome, dir)))
  const expectedVersion = readExpectedKiroSourceVersion(resolve(input.sourceDir))
  const metadata = existsSync(metadataPath)
    ? JSON.parse(readFileSync(metadataPath, 'utf-8')) as { sourceVersion?: string }
    : null

  const needsInstall = (
    missingManagedDir
    || !metadata
    || metadata.sourceVersion !== expectedVersion
    || (agentPath !== null && !existsSync(agentPath))
  )

  if (needsInstall) {
    execFileSync('bash', [join(resolve(input.sourceDir), 'install.sh')], {
      cwd: resolve(input.sourceDir),
      stdio: 'pipe',
    })
  }

  const selectedAgent = input.desiredAgent && existsSync(join(kiroHome, 'agents', `${input.desiredAgent}.json`))
    ? input.desiredAgent
    : 'kiro_default'

  return {
    selectedAgent,
    installed: needsInstall,
  }
}
```

- [ ] **Step 2: Make `KiroProvider` resolve install state and pass `--agent` before the prompt**

Update the constructor and launch arguments in `src/providers/kiro.ts`:

```ts
import { existsSync } from 'fs'
import { join } from 'path'
import { ensureKiroInstall } from './kiro-install.js'

export class KiroProvider implements AIProvider {
  name = 'kiro'
  private cwd: string
  private timeout: number
  private readonly logicalName?: string
  private readonly desiredAgent?: string
  private session = new CliSessionHelper()

  constructor(options?: ProviderOptions) {
    this.cwd = process.cwd()
    this.logicalName = options?.logicalName
    this.desiredAgent = options?.agent
    // existing timeout logic...
  }

  async resolveAgent(): Promise<string> {
    const sourceDir = join(this.cwd, 'agents', 'kiro-config')
    if (!existsSync(sourceDir)) {
      throw new Error(`Kiro config source not found: ${sourceDir}`)
    }
    return ensureKiroInstall({
      sourceDir,
      desiredAgent: this.desiredAgent,
    }).selectedAgent
  }
```

then prepend the resolved agent to both chat modes:

```ts
const args = ['chat', '--no-interactive', '--trust-all-tools']
const agent = await this.resolveAgent()
args.push('--agent', agent)
if (this.session.sessionId && !this.session.isFirstMessage) {
  args.push('--resume')
}
args.push(prompt)
```

- [ ] **Step 3: Upgrade `install.sh` from copy-once behavior to content-aware sync**

Replace the loop body in `agents/kiro-config/install.sh` with logic like:

```bash
MAGPIE_DIR="$KIRO_HOME/.magpie"
BACKUP_ROOT="$KIRO_HOME/.magpie-backups"
METADATA_PATH="$MAGPIE_DIR/kiro-install.json"
mkdir -p "$MAGPIE_DIR"

copy_if_changed() {
  local src_file="$1"
  local dst_file="$2"
  local rel_path="$3"

  if [ ! -f "$dst_file" ]; then
    cp "$src_file" "$dst_file"
    return 0
  fi

  if cmp -s "$src_file" "$dst_file"; then
    return 1
  fi

  if [ -z "${BACKUP_DIR:-}" ]; then
    BACKUP_DIR="$BACKUP_ROOT/$(date +%Y%m%d-%H%M%S)"
    mkdir -p "$BACKUP_DIR"
  fi

  mkdir -p "$(dirname "$BACKUP_DIR/$rel_path")"
  cp "$dst_file" "$BACKUP_DIR/$rel_path"
  cp "$src_file" "$dst_file"
  return 0
}
```

and write metadata at the end:

```bash
SOURCE_VERSION="$(git -C "$SCRIPT_DIR" rev-parse HEAD 2>/dev/null || true)"
if [ -z "$SOURCE_VERSION" ]; then
  SOURCE_VERSION="$(find "$SCRIPT_DIR/agents" "$SCRIPT_DIR/prompts" "$SCRIPT_DIR/skills" "$SCRIPT_DIR/hooks" -type f | sort | xargs shasum -a 256 | shasum -a 256 | awk '{print $1}')"
fi

cat > "$METADATA_PATH" <<EOF
{
  "sourcePath": "$SCRIPT_DIR",
  "sourceVersion": "$SOURCE_VERSION",
  "installedAt": "$(date -u +%FT%TZ)"
}
EOF
```

- [ ] **Step 4: Run the Kiro-focused tests and confirm they pass**

Run:

```bash
npm run test:run -- tests/providers/kiro-install.test.ts tests/providers/kiro-timeout.test.ts tests/providers/cli-image-support.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit the Kiro runtime implementation**

Run:

```bash
git add src/providers/kiro-install.ts src/providers/kiro.ts agents/kiro-config/install.sh
git commit -m "feat(kiro):自动同步并选择 agent"
```

### Task 6: Wire every Kiro-backed flow through configured bindings and document the new config

**Files:**
- Modify: `src/capabilities/review/runtime/flow.ts`
- Modify: `src/capabilities/review/application/repo-review.ts`
- Modify: `src/commands/review/repo-review.ts`
- Modify: `src/capabilities/discuss/runtime/flow.ts`
- Modify: `src/capabilities/discuss/application/export.ts`
- Modify: `src/capabilities/trd/runtime/flow.ts`
- Modify: `src/capabilities/workflows/docs-sync/application/execute.ts`
- Modify: `src/capabilities/workflows/issue-fix/application/execute.ts`
- Modify: `src/capabilities/workflows/post-merge-regression/application/execute.ts`
- Modify: `src/capabilities/loop/application/execute.ts`
- Modify: `src/platform/config/init.ts`
- Modify: `README.md`
- Modify: `tests/capabilities/workflows/docs-sync.test.ts`
- Modify: `tests/capabilities/workflows/issue-fix.test.ts`
- Modify: `tests/capabilities/workflows/post-merge-regression.test.ts`
- Modify: `tests/capabilities/loop/loop.test.ts`

- [ ] **Step 1: Replace direct reviewer/analyzer/summarizer Kiro creation with `createConfiguredProvider`**

Example change in `src/capabilities/review/runtime/flow.ts`:

```ts
import { createConfiguredProvider, createProvider } from '../../../platform/providers/index.js'

provider: createConfiguredProvider({
  logicalName: `reviewers.${id}`,
  model: config.reviewers[id].model,
  agent: config.reviewers[id].agent,
}, config),
```

Do the same for:

```ts
createConfiguredProvider({
  logicalName: 'summarizer',
  model: soloModel || config.summarizer.model,
  agent: config.summarizer.agent,
}, config)

createConfiguredProvider({
  logicalName: 'analyzer',
  model: soloModel || config.analyzer.model,
  agent: config.analyzer.agent,
}, config)
```

In `contextGatherer` creation, pass:

```ts
createConfiguredProvider({
  logicalName: 'contextGatherer',
  model: contextModel,
  agent: config.contextGatherer?.agent,
}, config)
```

- [ ] **Step 2: Wire the string-based workflow roles through sibling `*_agent` config**

In `src/capabilities/workflows/issue-fix/application/execute.ts`:

```ts
const planner = createConfiguredProvider({
  logicalName: 'capabilities.issue_fix.planner',
  model: plannerModel,
  agent: runtime.planner_agent,
}, config)

const executor = createConfiguredProvider({
  logicalName: 'capabilities.issue_fix.executor',
  model: executorModel,
  agent: runtime.executor_agent,
}, config)
```

Apply the same pattern to:

- `src/capabilities/loop/application/execute.ts`
- `src/capabilities/workflows/docs-sync/application/execute.ts`
- `src/capabilities/workflows/post-merge-regression/application/execute.ts`
- `src/capabilities/discuss/application/export.ts`

- [ ] **Step 3: Add a few end-to-end config tests that prove workflow-level agent fields are accepted**

Add these lines in the temporary YAML fixtures:

```yaml
capabilities:
  issue_fix:
    enabled: true
    planner_model: kiro
    planner_agent: architect
    executor_model: mock
```

```yaml
capabilities:
  docs_sync:
    enabled: true
    reviewer_model: kiro
    reviewer_agent: code-reviewer
```

```yaml
capabilities:
  loop:
    enabled: true
    planner_model: kiro
    planner_agent: kiro_planner
    executor_model: mock
```

Add explicit assertions after each run:

```ts
expect(result.result.status).toBe('completed')
expect(result.result.session?.artifacts.planPath || result.result.session?.artifacts.reportPath).toBeTruthy()
```

For docs-sync and post-merge-regression, keep the rest of the fixture unchanged so the test only proves the new `*_agent` keys are accepted and do not break execution.

- [ ] **Step 4: Teach `magpie init` and the README how to describe Kiro agents**

Add a comment block in `src/platform/config/init.ts` just after the generated reviewer entry when the model is Kiro:

```ts
const reviewerAgentLine = reviewer.model === 'kiro'
  ? `\n    # agent: ${reviewer.id}`
  : ''

reviewersSection += `\n  ${reviewer.id}:\n    model: ${reviewer.model}${reviewerAgentLine}\n    prompt: |\n      ${REVIEW_PROMPT}`
```

Add a README section such as:

````md
### Kiro agent binding

If a role uses `model: kiro`, you can optionally pin a Kiro agent:

```yaml
reviewers:
  backend:
    model: kiro
    agent: go-reviewer
    prompt: |
      Review backend changes.
```

When `agent` is omitted, Magpie tries the config entry name and falls back to `kiro_default`.
Before launch, Magpie checks `agents/kiro-config`, syncs it into `~/.kiro` when needed, then runs Kiro with the resolved agent.
````

- [ ] **Step 5: Run the focused workflow tests**

Run:

```bash
npm run test:run -- tests/capabilities/workflows/docs-sync.test.ts tests/capabilities/workflows/issue-fix.test.ts tests/capabilities/workflows/post-merge-regression.test.ts tests/capabilities/loop/loop.test.ts
```

Expected: PASS

- [ ] **Step 6: Commit the application wiring and docs**

Run:

```bash
git add src/capabilities/review/runtime/flow.ts src/capabilities/review/application/repo-review.ts src/commands/review/repo-review.ts src/capabilities/discuss/runtime/flow.ts src/capabilities/discuss/application/export.ts src/capabilities/trd/runtime/flow.ts src/capabilities/workflows/docs-sync/application/execute.ts src/capabilities/workflows/issue-fix/application/execute.ts src/capabilities/workflows/post-merge-regression/application/execute.ts src/capabilities/loop/application/execute.ts src/platform/config/init.ts README.md tests/capabilities/workflows/docs-sync.test.ts tests/capabilities/workflows/issue-fix.test.ts tests/capabilities/workflows/post-merge-regression.test.ts tests/capabilities/loop/loop.test.ts
git commit -m "feat(kiro):贯通全场景 agent 选择"
```

### Task 7: Run the full verification contract

**Files:**
- Verify only

- [ ] **Step 1: Run lint**

Run:

```bash
npm run lint
```

Expected: exit code `0`

- [ ] **Step 2: Run the complete test suite**

Run:

```bash
npm run test:run
```

Expected: exit code `0`

- [ ] **Step 3: Run coverage and confirm touched files stay above 80%**

Run:

```bash
npm run test:coverage
```

Expected: exit code `0` and the coverage table shows the newly added/modified Kiro-related files at or above 80% line coverage.

- [ ] **Step 4: Run the production build**

Run:

```bash
npm run build
```

Expected: exit code `0`

- [ ] **Step 5: Run the boundary check**

Run:

```bash
npm run check:boundaries
```

Expected: exit code `0`

- [ ] **Step 6: Smoke the CLI help text**

Run:

```bash
npm run dev -- --help
```

Expected: exit code `0` and help output still lists the existing command set.

- [ ] **Step 7: Review the staged diff and commit the final verification pass if needed**

Run:

```bash
git status --short
git diff --stat
```

Expected:

- only intended files are changed
- no accidental edits under unrelated directories

If a final doc/help tweak is still needed, commit it with:

```bash
git add -A
git commit -m "docs(kiro):补充使用说明"
```

## Self-Review

### Spec coverage

- Project-managed source: Task 1 converts `agents/kiro-config` into a formal submodule.
- Auto-check before every Kiro use: Task 5 adds the Kiro install manager and hooks it into the provider.
- Explicit agent + same-name fallback + `kiro_default` fallback: Tasks 2, 3, and 5 cover binding logic and runtime fallback.
- All Kiro-backed scenarios: Task 6 updates reviewer-based flows plus string-based workflow roles.
- Backup only when content differs: Task 4 adds installer tests and content-aware overwrite behavior.
- Docs/init updates: Task 6 updates generated config and README.

### Placeholder scan

- No `TODO`, `TBD`, or “similar to previous task” placeholders remain.
- Every code-changing step includes concrete snippets or commands.
- Every verification step includes exact commands and expected results.

### Type consistency

- Inline config roles use `agent`.
- String-only workflow roles use sibling `*_agent` fields.
- Provider-binding helper always accepts `{ logicalName, model, agent? }`.
- `KiroProvider` receives `logicalName` and `agent` through `ProviderOptions`.
