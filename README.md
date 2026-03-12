# Magpie

Magpie 是一个面向工程场景的多模型 CLI。它把多模型代码评审、技术讨论、PRD 到 TRD、目标闭环执行，以及文档/回归类工程工作流统一到一个本地开发入口里。

当前仓库已经进入 capability runtime 迁移阶段：

- `review`、`discuss`、`trd` 已通过 capability runtime 作为 CLI 主链路执行
- `quality unit-test-eval`、`loop`、`workflow *` 是 capability-native 能力
- 仓库中仍保留部分 legacy 模块，主要用于兼容和迁移承接

## 核心能力

### 代码与工程协作

- `review`：多 AI 代码评审，支持 PR 编号、PR URL、本地 diff、分支 diff、指定文件，以及仓库级扫描
- `discuss`：多模型议题讨论，可选 `Devil's Advocate`
- `reviewers list`：查看当前配置里的 reviewer
- `stats`：仓库评审统计入口，当前仍是占位实现

### 需求与设计

- `trd`：从 PRD Markdown 生成 TRD、领域划分草稿和开放问题清单
- `loop`：围绕 PRD 的阶段化执行闭环，支持人工确认闸门、会话恢复和分支自动创建

### 工程工作流

- `workflow issue-fix`：问题修复工作流，产出 plan / execution / verification 结果
- `workflow docs-sync`：对照当前代码审查文档并生成更新简报，可选直接应用文档修改
- `workflow post-merge-regression`：执行回归命令并沉淀结果报告
- `quality unit-test-eval`：评估单测质量，可选运行测试命令

### Provider 与集成

- 支持 CLI 型 provider：`claude-code`、`codex`、`gemini-cli`、`qwen-code`、`kiro`
- 支持 API 型 provider：Anthropic、OpenAI、Google、MiniMax
- 支持通知集成：`macos`、`feishu-webhook`、`imessage`

## 项目结构

```text
src/
  cli/                   # Commander 命令注册
  commands/              # legacy 命令实现
  capabilities/          # capability 模块与 workflow
  core/                  # capability runtime / reporting / context / repo
  platform/              # v2 config、provider、integration 适配
  providers/             # legacy provider 实现
  orchestrator/          # 多 reviewer 辩论编排
  context-gatherer/      # review 前上下文采集
  reporter/              # markdown 报告输出
  planner/               # feature / stage 规划
  feature-analyzer/      # repo feature 分析
  state/                 # 会话状态持久化

tests/                   # Vitest 测试
docs/plans/              # 设计与演进文档
dist/                    # tsc 构建产物，不手改
```

## 安装

前置依赖：

- Node.js 18+
- Git
- 如果要评审 GitHub PR 或发布评论，建议安装并登录 `gh`
- 如果使用 CLI 型 provider，需要本机已安装对应 CLI 并完成登录

安装步骤：

```bash
npm install
npm run build
npm link
```

也可以直接从源码运行：

```bash
npm run dev -- --help
```

## 快速开始

```bash
# 1) 生成配置
magpie init

# 无交互，直接生成默认配置（claude-code + codex）
magpie init -y

# 2) 评审一个 PR
magpie review 12345
magpie review https://github.com/owner/repo/pull/12345

# 3) 评审本地改动 / 分支 / 指定文件
magpie review --local
magpie review --branch main
magpie review --files src/cli/program.ts tests/cli/program.test.ts

# 4) 多模型讨论
magpie discuss "Should this repo fully migrate review to capability runtime?"

# 5) 生成 TRD
magpie trd ./docs/prd.md

# 6) 单测质量评估
magpie quality unit-test-eval . --run-tests

# 7) 目标驱动闭环执行
magpie loop run "Deliver checkout v2" --prd ./docs/prd.md

# 8) 工程 workflow
magpie workflow issue-fix "loop resume fails after human rejection"
magpie workflow docs-sync
magpie workflow post-merge-regression
```

## 命令总览

| 命令 | 作用 | 当前实现 |
| --- | --- | --- |
| `magpie init` | 初始化 `~/.magpie/config.yaml` | legacy |
| `magpie review` | 多 AI 代码评审 | capability runtime + orchestrator |
| `magpie discuss` | 多模型讨论/辩论 | capability runtime + orchestrator |
| `magpie trd` | PRD -> TRD | capability runtime |
| `magpie reviewers list` | 查看 reviewer 配置 | legacy |
| `magpie stats` | 查看评审统计 | legacy（占位） |
| `magpie quality unit-test-eval` | 单测质量评估 | capability |
| `magpie loop run/resume/list` | 目标驱动的阶段执行闭环 | capability |
| `magpie workflow issue-fix` | 问题修复工作流 | capability |
| `magpie workflow docs-sync` | 文档与代码同步检查/更新 | capability |
| `magpie workflow post-merge-regression` | 合并后回归检查 | capability |

## 常用命令与参数

### `review`

```bash
magpie review [pr] [options]
```

常见用法：

```bash
magpie review 12345
magpie review --local
magpie review --branch main
magpie review --files src/index.ts tests/cli/program.test.ts
magpie review --repo --path src --ignore "**/*.generated.ts"
magpie review --list-sessions
magpie review --session <id>
magpie review --export ./review.md
```

重要参数：

- `-r, --rounds <number>`：最大辩论轮次
- `-i, --interactive`：交互模式
- `-f, --format <format>`：输出格式，`markdown|json`
- `--reviewers <ids>` / `-a, --all`：指定或直接启用全部 reviewer
- `--repo`：仓库级 review
- `--quick`：仅做架构概览
- `--deep`：执行完整分析
- `--plan-only`：只生成评审计划，不执行
- `--skip-context`：跳过上下文采集
- `--no-post`：跳过 GitHub 评论等后处理

说明：

- `--local` 会优先评审未提交改动；如果没有未提交改动，会回退到最近一次 commit diff
- PR 模式会尽量通过 `gh pr view` / `gh pr diff` 预取标题、描述和 diff
- `--repo` 会走 feature 分析、缓存和会话持久化逻辑

### `discuss`

```bash
magpie discuss [topic] [options]
```

常见用法：

```bash
magpie discuss "Should we keep legacy commands?"
magpie discuss ./notes/topic.md --devil-advocate
magpie discuss --list
magpie discuss --resume <id>
```

重要参数：

- `-r, --rounds <number>`
- `-f, --format <format>`
- `--reviewers <ids>` / `-a, --all`
- `-d, --devil-advocate`
- `--list`
- `--resume <id>`

### `trd`

```bash
magpie trd [prd.md] [options]
```

常见用法：

```bash
magpie trd ./docs/prd.md
magpie trd ./docs/prd.md --domain-overview-only
magpie trd ./docs/prd.md --domains-file ./docs/domains.yaml
magpie trd --list
magpie trd --resume <id> "补充支付失败重试流程"
```

重要参数：

- `-r, --rounds <number>`
- `-i, --interactive`
- `-o, --output <file>`
- `--questions-output <file>`
- `--domain-overview-only`
- `--domains-file <path>`
- `--auto-accept-domains`
- `--list`
- `--resume <id>`

图片输入行为：

- 远程图片链接会作为多模态输入直接传给模型
- 本地图片路径存在时会加入输入，不存在时给出 warning 并跳过

### `quality`

```bash
magpie quality unit-test-eval [path] [options]
```

常见用法：

```bash
magpie quality unit-test-eval .
magpie quality unit-test-eval . --run-tests
magpie quality unit-test-eval . --run-tests --test-command "npm run test:run"
```

重要参数：

- `--max-files <number>`
- `--min-coverage <number>`：范围 `0..1`
- `-f, --format markdown|json`
- `--run-tests`
- `--test-command <command>`

### `loop`

```bash
magpie loop run <goal> --prd <path> [options]
magpie loop resume <sessionId> [options]
magpie loop list [options]
```

常见用法：

```bash
magpie loop run "Deliver checkout v2" --prd ./docs/prd.md
magpie loop run "Refactor notifications module" --prd ./docs/prd.md --no-wait-human
magpie loop resume <sessionId>
magpie loop list
```

重要参数：

- `--prd <path>`：`run` 必填
- `--wait-human` / `--no-wait-human`
- `--dry-run`
- `--max-iterations <number>`：仅 `run` 支持

说明：

- `loop` 会输出 session、状态、分支名以及人工确认文件路径
- 默认自动分支前缀为 `sch/`

### `workflow`

```bash
magpie workflow issue-fix <issue> [options]
magpie workflow docs-sync [options]
magpie workflow post-merge-regression [options]
```

常见用法：

```bash
magpie workflow issue-fix "loop resume fails after human rejection"
magpie workflow issue-fix "fix flaky tests in notifications" --apply --verify-command "npm run test:run"
magpie workflow docs-sync
magpie workflow docs-sync --apply
magpie workflow post-merge-regression
magpie workflow post-merge-regression --command "npm run test:run" "npm run build"
```

重要参数：

- `issue-fix --apply`：允许执行器直接落代码
- `issue-fix --verify-command <command>`：覆盖验证命令
- `docs-sync --apply`：允许直接更新文档
- `post-merge-regression --command <command...>`：覆盖回归命令列表

### `reviewers`

```bash
magpie reviewers list [options]
```

常见用法：

```bash
magpie reviewers list
magpie reviewers list --model codex
magpie reviewers list --json
```

### `stats`

```bash
magpie stats --since 30
```

当前仍是占位命令，主要用于后续仓库评审统计汇总。

## 配置

默认路径：

```text
~/.magpie/config.yaml
```

推荐方式是先生成模板，再按需调整：

```bash
magpie init
# 或
magpie init -y
```

`init` 生成的模板已经包含：

- reviewer 配置
- `analyzer` / `summarizer`
- `contextGatherer`
- `trd`
- `capabilities.loop`
- `integrations.notifications`

常见配置片段如下。

### 1. 使用 CLI provider

```yaml
providers: {}

reviewers:
  claude-code:
    model: claude-code
    prompt: |
      You are a thorough code reviewer.

  codex:
    model: codex
    prompt: |
      You are a thorough code reviewer.

analyzer:
  model: claude-code
  prompt: |
    You are a senior engineer providing PR context analysis.

summarizer:
  model: claude-code
  prompt: |
    You are a neutral technical reviewer.
```

### 2. 使用 API provider

```yaml
providers:
  anthropic:
    api_key: ${ANTHROPIC_API_KEY}
  openai:
    api_key: ${OPENAI_API_KEY}
  google:
    api_key: ${GOOGLE_API_KEY}
  minimax:
    api_key: ${MINIMAX_API_KEY}
```

模型解析规则：

- CLI 型：`claude-code`、`codex`、`gemini-cli`、`qwen-code`、`kiro`
- API 型：
  - `claude*` -> Anthropic
  - `gpt*` -> OpenAI
  - `gemini*` -> Google
  - `minimax` -> MiniMax
- 调试：`mock` / `mock*`

### 3. capability 配置

```yaml
defaults:
  max_rounds: 5
  output_format: markdown
  check_convergence: true
  language: zh

contextGatherer:
  enabled: true

trd:
  default_reviewers: [claude-code, codex]
  max_rounds: 3
  language: zh

capabilities:
  loop:
    enabled: true
    planner_model: claude-code
    executor_model: codex
    auto_branch_prefix: "sch/"
    human_confirmation:
      file: "human_confirmation.md"
      gate_policy: "exception_or_low_confidence"
  issue_fix:
    enabled: true
    planner_model: claude-code
    executor_model: codex
    verify_command: "npm run test:run"
  docs_sync:
    enabled: true
    reviewer_model: claude-code
  post_merge_regression:
    enabled: true
    evaluator_model: claude-code
    commands:
      - "npm run test:run"
      - "npm run build"
  quality:
    unitTestEval:
      enabled: true
      min_coverage: 0.8
      output_format: markdown
```

说明：

- 配置文件入口仍是 `~/.magpie/config.yaml`
- capability 侧会把 legacy 配置自动迁移为 `capabilities.*` 结构并在内存中使用
- 仓库里仍有 legacy / v2 并存代码，文档优先描述当前 CLI 主链路

## 通知集成

当前内置通知 provider：

- `macos`
- `feishu-webhook`
- `imessage` via `messages-applescript`
- `imessage` via `bluebubbles`

配置入口：

```yaml
integrations:
  notifications:
    enabled: false
    default_timeout_ms: 5000
    routes:
      human_confirmation_required: [macos_local, feishu_team]
      loop_failed: [feishu_team]
      loop_completed: [feishu_team]
```

详细说明见 [docs/channels/imessage.md](docs/channels/imessage.md)。

## 会话与产物存储

- repo review 会话：`<repo>/.magpie/sessions/`
- repo feature 缓存：`<repo>/.magpie/cache/`
- discuss 会话：`~/.magpie/discussions/`
- trd 会话：`~/.magpie/trd-sessions/`
- loop 会话：`~/.magpie/loop-sessions/`
- workflow 会话：`~/.magpie/workflow-sessions/<capability>/<session-id>/`
- loop 人工确认文件：默认 `<repo>/human_confirmation.md`

## 开发

```bash
# 从源码运行 CLI
npm run dev -- review 12345

# 查看帮助
npm run dev -- --help

# watch 模式测试
npm test

# 单次测试
npm run test:run

# TypeScript 构建
npm run build

# 架构边界检查
npm run check:boundaries

# 通知 smoke test
npm run smoke:notifications -- human_confirmation_required
```

提交前至少执行：

```bash
npm run test:run
npm run build
```

## 相关文档

- [docs/channels/imessage.md](docs/channels/imessage.md)
- [docs/plans/2026-03-04-capability-architecture-v2.md](docs/plans/2026-03-04-capability-architecture-v2.md)
- [docs/plans/2026-03-05-prd-review-workflow.md](docs/plans/2026-03-05-prd-review-workflow.md)
- [docs/plans/2026-01-26-magpie-design.md](docs/plans/2026-01-26-magpie-design.md)
- [docs/plans/2026-01-26-magpie-implementation.md](docs/plans/2026-01-26-magpie-implementation.md)
- [human_confirmation.example.md](human_confirmation.example.md)
- [magpie_sequence_diagrams.md](magpie_sequence_diagrams.md)

## 当前已知状态

- `review`、`discuss`、`trd` 的 CLI 入口已切到 capability runtime
- `stats` 仍是轻量占位命令
- 仓库中仍保留较多 V1/V2 并存模块，重构还在继续

## License

ISC
