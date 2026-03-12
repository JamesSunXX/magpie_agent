# Magpie

Magpie 是一个面向工程场景的多模型 CLI，当前同时包含两套运行方式：

- legacy 命令流：`review`、`discuss`、`trd`、`init`、`reviewers`、`stats`
- capability runner：`loop`、`quality unit-test-eval`、`workflow *`

它的核心目标不是单次问答，而是把多模型协作、评审、TRD 生成、阶段执行、通知和会话持久化整合到一个本地开发工作流里。

## 当前能力

### 代码与工程协作

- `review`：多 AI 代码评审，支持 PR、PR URL、本地 diff、分支 diff、文件集和仓库级扫描
- `discuss`：多模型议题讨论，可选 `Devil's Advocate`
- `reviewers list`：查看当前配置里的 reviewer
- `stats`：仓库评审统计占位命令

### 需求与设计

- `trd`：从 PRD Markdown 生成 TRD、领域划分草稿和开放问题清单
- `loop`：围绕 PRD 的阶段化执行闭环，支持人工确认闸门和恢复执行

### 工程工作流

- `workflow issue-fix`：问题修复工作流，产出 plan / execution / verification 结果
- `workflow docs-sync`：对照当前代码审查文档并生成更新简报，可选直接应用文档修改
- `workflow post-merge-regression`：执行回归命令并沉淀结果报告
- `quality unit-test-eval`：评估单测质量，可选运行测试命令

## 架构现状

当前仓库是一个混合架构：

- CLI 统一入口：`src/cli.ts` -> `src/cli/program.ts`
- `review` / `discuss` / `trd` 仍主要走 legacy command 实现
- `loop`、`quality unit-test-eval`、`workflow *` 已完整走 capability runtime
- capability 注册表中已经包含 `review` / `discuss` / `trd`，但 CLI 主路径还没有完全切换过去
- 配置文件仍以 `~/.magpie/config.yaml` 为入口，capability 侧会把 legacy 配置自动迁移成 `capabilities.*` 结构在内存中使用

### 目录结构

```text
src/
  cli/                   # Commander 命令注册
  commands/              # legacy 命令实现
  capabilities/          # capability 模块与 workflow
  core/                  # capability runtime / reporting / context / repo
  platform/              # v2 config、provider 和 integrations 适配
  providers/             # CLI / API provider 实现
  orchestrator/          # 多 reviewer 辩论编排
  context-gatherer/      # review 前上下文采集
  planner/               # feature / stage 规划
  feature-analyzer/      # repo feature 分析
  state/                 # 会话状态持久化
  reporter/              # markdown 报告输出

tests/                   # Vitest 测试
docs/plans/              # 设计与演进文档
dist/                    # tsc 构建产物，不手改
```

## 安装

```bash
cd magpie
npm install
npm run build
npm link
```

前置依赖：

- Node.js 18+
- Git
- 如果要评审 GitHub PR 或发布评论，建议安装并登录 `gh`
- 如果使用 CLI 型 provider，需要本机已经安装并完成登录

## 快速开始

```bash
# 1) 生成配置
magpie init
# 或直接使用默认 reviewer
magpie init -y

# 2) 评审一个 PR
magpie review 12345
magpie review https://github.com/owner/repo/pull/12345

# 3) 评审本地改动 / 分支 / 文件
magpie review --local
magpie review --branch main
magpie review --files src/index.ts tests/cli/program.test.ts

# 4) 多模型讨论
magpie discuss "Should this repo fully migrate review to capability runtime?"

# 5) 生成 TRD
magpie trd ./docs/prd.md

# 6) 运行单测质量评估
magpie quality unit-test-eval . --run-tests

# 7) 目标闭环执行
magpie loop run "Deliver checkout v2" --prd ./docs/prd.md

# 8) 工程 workflow
magpie workflow issue-fix "loop resume fails after human rejection"
magpie workflow docs-sync
magpie workflow post-merge-regression
```

## 命令一览

| 命令 | 作用 | 当前实现 |
| --- | --- | --- |
| `magpie init` | 初始化 `~/.magpie/config.yaml` | legacy |
| `magpie review` | 多 AI 代码评审 | legacy + orchestrator |
| `magpie discuss` | 多模型讨论/辩论 | legacy + orchestrator |
| `magpie trd` | PRD -> TRD | legacy |
| `magpie reviewers list` | 查看 reviewer 配置 | legacy |
| `magpie stats` | 查看评审统计（当前为占位） | legacy |
| `magpie quality unit-test-eval` | 单测质量评估 | capability |
| `magpie loop run/resume/list` | 目标驱动的阶段执行闭环 | capability |
| `magpie workflow issue-fix` | 问题修复工作流 | capability |
| `magpie workflow docs-sync` | 文档与代码同步检查/更新 | capability |
| `magpie workflow post-merge-regression` | 合并后回归检查 | capability |

## 常用参数

### `review`

```bash
magpie review [pr] [options]

-c, --config <path>
-r, --rounds <number>
-i, --interactive
-o, --output <file>
-f, --format <format>
--no-converge
-l, --local
-b, --branch [base]
--files <files...>
--git-remote <name>
--reviewers <ids>
-a, --all
--repo
--path <path>
--ignore <patterns...>
--quick
--deep
--plan-only
--reanalyze
--list-sessions
--session <id>
--export <file>
--skip-context
--no-post
```

说明：

- `--local` 会优先评审未提交改动；如果没有未提交改动，会回退到最近一次 commit diff
- PR 模式会尽量通过 `gh pr view` / `gh pr diff` 预取标题、描述和 diff
- `--repo` 走仓库级 feature 分析和会话持久化逻辑

### `discuss`

```bash
magpie discuss [topic] [options]

-c, --config <path>
-r, --rounds <number>
-i, --interactive
-o, --output <file>
-f, --format <format>
--no-converge
--reviewers <ids>
-a, --all
--list
--resume <id>
--devil-advocate
```

### `trd`

```bash
magpie trd [prd.md] [options]

-c, --config <path>
-r, --rounds <number>
-i, --interactive
-o, --output <file>
--questions-output <file>
--no-converge
--reviewers <ids>
-a, --all
--list
--resume <id>
--domain-overview-only
--domains-file <path>
--auto-accept-domains
```

图片输入行为：

- 远程图片链接会作为多模态输入直接传给模型
- 本地图片路径存在时会加入输入，不存在时给出 warning 并跳过
- 当前没有 OCR 开关，README 不再保留旧的 `--no-ocr` 说法

### `quality`

```bash
magpie quality unit-test-eval [path] [options]

-c, --config <path>
--max-files <number>
--min-coverage <number>
-f, --format markdown|json
--run-tests
--test-command "npm run test:run"
```

### `loop`

```bash
magpie loop run <goal> --prd <path> [options]
magpie loop resume <sessionId> [options]
magpie loop list

-c, --config <path>
--wait-human / --no-wait-human
--dry-run
--max-iterations <number>
```

### `workflow`

```bash
magpie workflow issue-fix <issue> [options]
magpie workflow docs-sync [options]
magpie workflow post-merge-regression [options]

# issue-fix
-c, --config <path>
--apply
--verify-command <command>

# docs-sync
-c, --config <path>
--apply

# post-merge-regression
-c, --config <path>
--command <command...>
```

### `reviewers`

```bash
magpie reviewers list [options]

-c, --config <path>
-m, --model <model>
--json
```

## 配置

默认路径：`~/.magpie/config.yaml`

最小可用示例：

```yaml
providers:
  openai:
    api_key: ${OPENAI_API_KEY}

defaults:
  max_rounds: 5
  output_format: markdown
  check_convergence: true
  language: zh
  diff_exclude:
    - "*.pb.go"
    - "*generated*"

reviewers:
  claude:
    model: claude-code
    prompt: |
      You are a senior code reviewer. Focus on correctness, security, architecture, and simplicity.

summarizer:
  model: claude-code
  prompt: |
    Summarize consensus, disagreements and action items.

analyzer:
  model: claude-code
  prompt: |
    Analyze PR context before debate.

contextGatherer:
  enabled: true

trd:
  default_reviewers: [claude]
  max_rounds: 3
  language: zh
  include_project_context: true
  include_traceability: true
  output:
    same_dir_as_prd: true
    trd_suffix: ".trd.md"
    open_questions_suffix: ".open-questions.md"
  preprocess:
    chunk_chars: 6000
    max_chars: 120000
  domain:
    require_human_confirmation: true
    overview_required: true

capabilities:
  loop:
    enabled: true
    planner_model: claude-code
    executor_model: codex
  quality:
    unitTestEval:
      enabled: true
      min_coverage: 0.7
  issue_fix:
    enabled: true
  docs_sync:
    enabled: true
  post_merge_regression:
    enabled: true

integrations:
  notifications:
    enabled: false
```

说明：

- legacy 命令主要读取顶层字段，例如 `reviewers`、`summarizer`、`analyzer`、`trd`
- capability 命令会在内存中把 legacy 配置补全成 `capabilities.*` 结构
- `magpie init` 会生成更完整的模板，包含 `loop` 和通知集成示例

### Provider 映射

`model` 字段按以下规则解析：

- CLI 型：`claude-code`、`codex`、`gemini-cli`、`qwen-code`、`kiro`
- API 型：
  - `claude*` -> Anthropic
  - `gpt*` -> OpenAI
  - `gemini*` -> Google
  - `minimax` -> MiniMax
- 调试：`mock` / `mock*`

### 通知集成

当前内置通知 provider：

- `macos`
- `feishu-webhook`
- `imessage` via `bluebubbles`
- `imessage` via `messages-applescript`

详细接入说明见 [docs/channels/imessage.md](/Users/sunchenhui/Documents/AI/magpie/docs/channels/imessage.md)。

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

## 相关文档

- [2026-03-04-capability-architecture-v2.md](/Users/sunchenhui/Documents/AI/magpie/docs/plans/2026-03-04-capability-architecture-v2.md)
- [2026-03-05-prd-review-workflow.md](/Users/sunchenhui/Documents/AI/magpie/docs/plans/2026-03-05-prd-review-workflow.md)
- [2026-01-26-magpie-design.md](/Users/sunchenhui/Documents/AI/magpie/docs/plans/2026-01-26-magpie-design.md)
- [2026-01-26-magpie-implementation.md](/Users/sunchenhui/Documents/AI/magpie/docs/plans/2026-01-26-magpie-implementation.md)

## 当前已知状态

- `review` / `discuss` / `trd` 的 capability 版本已注册，但 CLI 主链路仍以 legacy 实现为主
- `stats` 仍是轻量占位命令
- 仓库中保留了较多 V1/V2 并存模块，重构还在继续

## License

ISC
