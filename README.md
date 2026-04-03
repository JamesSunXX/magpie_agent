# Magpie

Magpie 是一个面向工程场景的多模型 CLI。它把多 AI 代码评审、技术讨论、PRD 到 TRD、目标闭环执行，以及若干工程 workflow 统一到一个本地入口里。

当前 CLI 主入口在 `src/cli/`，运行时以 capability registry 为中心，已注册的能力包括：

- `review`
- `discuss`
- `trd`
- `quality unit-test-eval`
- `loop`
- `workflow issue-fix`
- `workflow harness`
- `workflow docs-sync`
- `workflow post-merge-regression`
- `tui`
- `init`
- `reviewers list`
- `stats`

## 核心能力

### 代码与工程协作

- `review`：多 AI 代码评审，支持 PR 编号、PR URL、本地 diff、分支 diff、指定文件，以及仓库级扫描
- `discuss`：多模型议题讨论，可选 `Devil's Advocate`
- `reviewers list`：查看当前配置里的 reviewer
- `tui`：任务工作台入口，优先突出新建任务，并展示可恢复会话与环境状态
- `stats`：当前仓库的评审统计入口，当前仍是占位实现

### 需求与设计

- `trd`：从 PRD Markdown 生成 TRD、领域划分草稿和开放问题清单
- `loop`：围绕目标和 PRD 的阶段化执行闭环，支持人工确认闸门、会话恢复、自动分支和自动提交

### 工程 workflow

- `workflow issue-fix`：问题修复工作流，产出 plan / execution / verification 结果
- `workflow harness`：harness 模式需求开发闭环，自动执行开发、模型对抗评审、单测与模型自确认
- `workflow docs-sync`：对照当前代码审查文档并生成更新报告，可选直接应用文档修改
- `workflow post-merge-regression`：执行回归命令并沉淀结果报告
- `quality unit-test-eval`：评估单测质量，可选运行测试命令

### Provider 与集成

- CLI provider：`claude-code`、`codex`、`gemini-cli`、`qwen-code`、`kiro`
- API provider：Anthropic、OpenAI、Google、MiniMax
- 通知集成：`macos`、`feishu-webhook`、`imessage`（`messages-applescript` / `bluebubbles`）

说明：

- `magpie init` 当前交互式初始化里可直接选择的 reviewer 是 `claude-code`、`codex`、`gemini-cli`、`kiro`、`claude-api`、`gpt`、`gemini`
- `qwen-code` provider 在代码里已支持，但当前不在 `init` 的交互式候选列表中

### Kiro agent 绑定

当某个角色使用 `model: kiro` 时，可以选择固定到一个 Kiro agent：

```yaml
reviewers:
  backend:
    model: kiro
    agent: go-reviewer
    prompt: |
      Review backend changes.
```

如果不写 `agent`，Magpie 会先尝试使用该配置项名称（例如 `backend`），找不到时回退到 `kiro_default`。
如果仓库里有 `agents/kiro-config`，Magpie 会在调用前检查它，并在版本或内容变化时同步到 `~/.kiro`。如果仓库里没有这套项目配置，Magpie 会直接复用当前机器上已经存在的 Kiro agent。

### CLI provider 超时控制

对于 `codex` 和 `kiro` 这类 CLI provider，建议配置超时，避免长时间无结果的挂起：

```bash
MAGPIE_CODEX_TIMEOUT_MS=120000 magpie loop run "Deliver checkout v2" --prd ./docs/prd.md --no-wait-human
```

说明：

- `MAGPIE_CODEX_TIMEOUT_MS`：`codex` 单次调用超时（毫秒），`0` 表示不启用超时
- `MAGPIE_KIRO_TIMEOUT_MS`：`kiro` 单次调用超时（毫秒），`0` 表示不启用超时

## 安装

前置依赖：

- Node.js 18+
- Git
- 如果要评审 GitHub PR 或发布评论，建议安装并登录 `gh`
- 如果使用 CLI provider，需要本机已安装对应 CLI 并完成登录

安装步骤：

```bash
npm install
npm run build
npm link
```

从源码运行：

```bash
npm run dev -- --help
```

说明：

- `npm install` 之后再执行 `npm run dev`、`npm run build`、`npm test`
- 全局安装后可直接使用 `magpie`

## 快速开始

```bash
# 1) 生成配置
magpie init

# 无交互生成默认配置（claude-code + codex）
magpie init -y

# 2) 打开任务工作台
magpie tui

# 3) 评审一个 PR
magpie review 12345
magpie review https://github.com/owner/repo/pull/12345

# 4) 评审本地改动 / 分支 / 指定文件 / 仓库
magpie review --local
magpie review --branch main
magpie review --files src/cli/program.ts tests/cli/program.test.ts
magpie review --repo --path src --ignore "**/*.generated.ts"

# 5) 多模型讨论
magpie discuss "Should this repo fully migrate review to capability runtime?"

# 6) 生成 TRD
magpie trd ./docs/prd.md

# 7) 单测质量评估
magpie quality unit-test-eval . --run-tests

# 8) 目标驱动闭环执行
magpie loop run "Deliver checkout v2" --prd ./docs/prd.md

# 9) 工程 workflow
magpie workflow issue-fix "loop resume fails after human rejection"
magpie workflow harness "Deliver checkout v2" --prd ./docs/prd.md
magpie workflow docs-sync --apply
magpie workflow post-merge-regression --command "npm run test:run" "npm run build"
```

## 命令总览

| 命令 | 作用 | 说明 |
| --- | --- | --- |
| `magpie init` | 初始化 `~/.magpie/config.yaml` | 支持交互式 reviewer/通知/planning/operations 配置 |
| `magpie review` | 多 AI 代码评审 | capability runtime + orchestrator |
| `magpie discuss` | 多模型讨论/辩论 | capability runtime + orchestrator |
| `magpie trd` | PRD -> TRD | capability runtime |
| `magpie quality unit-test-eval` | 单测质量评估 | capability |
| `magpie loop run/resume/list` | 目标驱动的阶段执行闭环 | capability |
| `magpie workflow issue-fix` | 问题修复工作流 | capability |
| `magpie workflow harness` | harness 闭环开发与模型自确认 | capability |
| `magpie workflow docs-sync` | 文档与代码同步检查/更新 | capability |
| `magpie workflow post-merge-regression` | 合并后回归检查 | capability |
| `magpie tui` | 任务工作台 | 新建任务、恢复会话、命令预览、TUI 内执行 |
| `magpie reviewers list` | 查看 reviewer 配置 | 直接读取配置 |
| `magpie stats` | 查看评审统计 | 当前仍为占位实现 |

### `tui`

```bash
magpie tui [options]
```

当前 MVP 能力：

- 首页优先展示 5 个新建任务入口：评审改动、评审 PR、生成 TRD、目标闭环 loop、问题修复
- 同屏展示 `Continue` 与 `Recent` 会话摘要
- 执行前统一展示命令预览
- 在 TUI 内执行已有 CLI 命令，并提取 `Session:`、`Plan:`、`Report:`、`Human confirmation file:` 等高信号输出
- 为避免 TUI 内子命令再次请求终端输入，评审类任务默认补全不会阻塞的参数：未指定 reviewer 时自动使用 `--all`，仓库级评审默认补 `--deep`

当前限制：

- 任务工作台当前只覆盖上述 5 个高频入口
- `discuss`、`docs-sync`、`post-merge-regression` 尚未提供新建任务向导
- provider 登录态只做轻量环境检查，不在启动时做重型探测

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
- `-l, --local`：评审本地未提交改动
- `-b, --branch [base]`：评审当前分支相对基线分支的改动，默认 `main`
- `--files <files...>`：仅评审指定文件
- `--git-remote <name>`：PR URL 推断时使用的远端名，默认 `origin`
- `--reviewers <ids>` / `-a, --all`：指定 reviewer 或启用全部 reviewer
- `--repo`：仓库级 review
- `--path <path>` / `--ignore <patterns...>`：仓库级 review 的范围控制
- `--quick`：仅输出架构概览
- `--deep`：执行完整分析
- `--plan-only`：只生成评审计划，不执行
- `--reanalyze`：忽略缓存，重新做 repo feature 分析
- `--list-sessions` / `--session <id>`：查看或恢复 review 会话
- `--export <file>`：导出已完成的 review
- `--skip-context`：跳过上下文采集
- `--no-post`：跳过 GitHub comment 等后处理

行为说明：

- `--local` 优先评审 `git diff HEAD`；如果没有未提交改动，会回退到最近一次 commit diff
- PR 模式会优先尝试用 `gh pr view` / `gh pr diff` 预取标题、描述和 diff
- `--repo` 会进入 repo scanner、feature analyzer、会话持久化等完整路径

### `discuss`

```bash
magpie discuss [topic] [options]
```

常见用法：

```bash
magpie discuss "Should we keep legacy commands?"
magpie discuss ./notes/topic.md --devil-advocate
magpie discuss "Should we migrate now?" --plan-report
magpie discuss --list
magpie discuss --resume <id>
magpie discuss --export <id> --plan-report
```

重要参数：

- `-r, --rounds <number>`
- `-i, --interactive`
- `-o, --output <file>`
- `-f, --format <format>`
- `--no-converge`
- `--reviewers <ids>` / `-a, --all`
- `-d, --devil-advocate`
- `--list`
- `--resume <id>`
- `--export <id>`
- `--conclusion`
- `--plan-report`：讨论结束后自动生成可实施计划报告；导出时也可单独生成，会额外调用一次模型，计划报告仅支持 Markdown

### `trd`

```bash
magpie trd [prd.md] [options]
```

常见用法：

```bash
magpie trd ./docs/prd.md
magpie trd ./docs/prd.md --domain-overview-only
magpie trd ./docs/prd.md --domains-file ./docs/domains.confirmed.yaml
magpie trd ./docs/prd.md --auto-accept-domains
magpie trd --list
magpie trd --resume <id> "补充支付失败重试流程"
```

重要参数：

- `-r, --rounds <number>`
- `-i, --interactive`
- `--no-converge`
- `--reviewers <ids>` / `-a, --all`
- `-o, --output <file>`
- `--questions-output <file>`
- `--domain-overview-only`
- `--domains-file <path>`
- `--auto-accept-domains`
- `--list`
- `--resume <id>`

输出行为：

- 默认在 PRD 同目录生成：
  - `*.domain-overview.md`
  - `*.domains.draft.yaml`
  - `*.domains.confirmed.yaml`
  - `*.trd.md`
  - `*.open-questions.md`
- 中间产物会写入 `~/.magpie/trd-sessions/<session-id>/artifacts/`
- 远程图片链接会作为多模态输入传给模型
- 本地图片路径存在时会加入输入，不存在时会输出 warning 并跳过

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

默认运行时配置来自代码：

- 阶段：`prd_review`、`domain_partition`、`trd_generation`、`code_development`、`unit_mock_test`、`integration_test`
- 默认自动提交：`true`
- 默认分支前缀：`sch/`
- 默认人工确认文件：`human_confirmation.md`
- 默认验证命令：
  - `unit_test`: `npm run test:run`
  - `mock_test`: `npm run test:run -- tests/mock`
  - `integration_test`: `npm run test:run -- tests/integration`

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
magpie workflow harness "Deliver checkout v2" --prd ./docs/prd.md
magpie workflow harness "Deliver checkout v2" --prd ./docs/prd.md --models gemini-cli kiro --max-cycles 4
magpie workflow docs-sync
magpie workflow docs-sync --apply
magpie workflow post-merge-regression
magpie workflow post-merge-regression --command "npm run test:run" "npm run build"
```

重要参数：

- `issue-fix --apply`：允许执行器直接落代码
- `issue-fix --verify-command <command>`：覆盖验证命令
- `harness --prd <path>`：指定需求 PRD，串行执行开发->评审->单测->自确认闭环
- `harness --models <models...>`：指定用于对抗确认的模型，默认 `gemini-cli kiro`
- `harness --max-cycles <number>`：最大修复轮次，默认 `3`
- `harness --review-rounds <number>`：每轮评审辩论轮次，默认 `3`
- `harness --test-command <command>`：覆盖单测命令
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

当前加载器只接受新 schema：

- 顶层必须包含 `capabilities`
- 顶层必须包含 `integrations`
- 旧版 legacy config 已不再支持；如果沿用旧配置，加载时会直接报错并提示重新执行 `magpie init`

### provider 路由规则

- CLI 型：`claude-code`、`codex`、`gemini-cli`、`qwen-code`、`kiro`
- API 型：
  - `claude*` -> Anthropic
  - `gpt*` -> OpenAI
  - `gemini*` -> Google
  - `minimax` -> MiniMax
- 调试：`mock` / `mock*`

### `magpie init` 生成模板的关键默认值

```yaml
defaults:
  max_rounds: 5
  output_format: markdown
  check_convergence: true

contextGatherer:
  enabled: true

trd:
  max_rounds: 3
  language: zh
  include_project_context: true
  include_traceability: true

capabilities:
  review:
    enabled: true
    max_rounds: 5
    check_convergence: true
  discuss:
    enabled: true
    max_rounds: 5
    check_convergence: true
  quality:
    unitTestEval:
      enabled: true
      max_files: 50
      min_coverage: 0.8
      output_format: markdown
  issue_fix:
    enabled: true
    executor_model: codex
    verify_command: "npm run test:run"
    auto_commit: false
  docs_sync:
    enabled: true
  post_merge_regression:
    enabled: true
    commands: ["npm run test:run", "npm run build"]
  loop:
    enabled: true
    executor_model: codex
    auto_commit: true
    auto_branch_prefix: "sch/"
    human_confirmation:
      file: "human_confirmation.md"
      gate_policy: "exception_or_low_confidence"
```

说明：

- 默认 reviewer 由 `init` 选择结果决定；`-y` 时默认是 `claude-code` + `codex`
- `init` 会在已有配置存在时自动备份旧文件为 `config.yaml.bak-<timestamp>`
- 通知配置会同时生成 `macos_local`、`feishu_team`、`imessage_local`、`imessage_remote` provider 模板
- `init` 交互模式会额外引导填写 `integrations.planning` 和 `integrations.operations` 的默认 provider 与关键字段

## 通知集成

当前内置通知 provider：

- `macos`
- `feishu-webhook`
- `imessage` via `messages-applescript`
- `imessage` via `bluebubbles`

配置入口示例：

```yaml
integrations:
  notifications:
    enabled: false
    default_timeout_ms: 5000
    routes:
      human_confirmation_required: [macos_local, feishu_team]
      loop_failed: [feishu_team]
      loop_completed: [feishu_team]
    providers:
      macos_local:
        type: "macos"
        click_target: "vscode"
      feishu_team:
        type: "feishu-webhook"
        webhook_url: ${FEISHU_WEBHOOK_URL}
        secret: ${FEISHU_WEBHOOK_SECRET}
      imessage_local:
        type: "imessage"
        transport: "messages-applescript"
        targets:
          - "handle:+8613800138000"
      imessage_remote:
        type: "imessage"
        transport: "bluebubbles"
        server_url: ${BLUEBUBBLES_SERVER_URL}
        password: ${BLUEBUBBLES_PASSWORD}
        targets:
          - "chat_guid:${BLUEBUBBLES_CHAT_GUID}"
```

## Planning / Operations 集成

`integrations.planning` 用于把 `loop` / `workflow issue-fix` 产出的计划或执行摘要同步到外部项目系统；`integrations.operations` 用于让 `workflow post-merge-regression` 通过统一 provider 采集命令执行证据。

当 `integrations.planning.enabled: true` 时，`loop run` 和 `workflow issue-fix` 会先尝试拉取远端 planning context，再把它注入本地 planner prompt。默认会从 `issue` / `goal` / `PRD` 路径里推断类似 `ENG-123` 的条目标识；如果需要显式指定，可使用：

- `magpie loop run "<goal>" --prd <path> --planning-project ENG --planning-item ENG-123`
- `magpie workflow issue-fix "<issue>" --planning-project ENG --planning-item ENG-123`

最小配置示例：

```yaml
integrations:
  planning:
    enabled: false
    default_provider: "jira_main"
    providers:
      jira_main:
        type: "jira"
        base_url: "https://your-company.atlassian.net"
        project_key: "ENG"
        auth_mode: "cloud"
        email: ${JIRA_EMAIL}
        api_token: ${JIRA_API_TOKEN}
      feishu_project:
        type: "feishu-project"
        base_url: "https://project.feishu.cn"
        project_key: "ENG"
        app_id: ${FEISHU_PROJECT_APP_ID}
        app_secret: ${FEISHU_PROJECT_APP_SECRET}
  operations:
    enabled: false
    default_provider: "local_main"
    providers:
      local_main:
        type: "local-commands"
        timeout_ms: 600000
        max_buffer_bytes: 10485760
```

Jira Cloud 使用 `auth_mode: "cloud"`，凭证字段为 `email` / `api_token`。

Jira Server/Data Center（例如 8.8.1）可使用：

```yaml
integrations:
  planning:
    enabled: true
    default_provider: "jira_main"
    providers:
      jira_main:
        type: "jira"
        base_url: "https://jira.example.com"
        project_key: "ENG"
        auth_mode: "basic"
        username: ${JIRA_USERNAME}
        password: ${JIRA_PASSWORD}
```

## 会话与产物存储

- repo review 会话：`<repo>/.magpie/sessions/`
- repo feature 缓存：`<repo>/.magpie/cache/`
- history：`<repo>/.magpie/history/`
- discuss 会话：`~/.magpie/discussions/`
- trd 会话：`~/.magpie/trd-sessions/`
- loop 会话：`~/.magpie/loop-sessions/`
- workflow 会话：`~/.magpie/workflow-sessions/<capability>/<session-id>/`
- loop 人工确认文件：默认 `<repo>/human_confirmation.md`

## 项目结构

```text
src/
  cli/                   # Commander CLI 入口与命令注册
  capabilities/          # capability 与 workflow 实现
  core/                  # capability runtime / debate / repo / context 等核心逻辑
  platform/              # config、provider、integration 适配
  providers/             # provider 实现
  orchestrator/          # 多 reviewer 辩论编排
  context-gatherer/      # review 前上下文采集
  reporter/              # markdown 报告输出
  planner/               # feature / stage 规划
  feature-analyzer/      # repo feature 分析
  state/                 # 会话状态持久化
  commands/              # 历史/兼容命令入口，仍保留少量桥接

tests/                   # Vitest 测试
docs/plans/              # 设计与演进文档
dist/                    # tsc 构建产物，不手改
```

## 开发

```bash
# 从源码运行 CLI
npm run dev -- review 12345

# 查看帮助
npm run dev -- --help

# watch 模式测试
npm test

# 代码质量检查
npm run lint

# 单次测试
npm run test:run

# 覆盖率
npm run test:coverage

# TypeScript 构建
npm run build

# 架构边界检查
npm run check:boundaries

# 通知 smoke test
npm run smoke:notifications -- human_confirmation_required
```

提交前至少执行：

```bash
npm run lint
npm run test:run
npm run test:coverage
npm run build
npm run check:boundaries
```

## 相关文档

- [docs/plans/2026-03-04-capability-architecture-v2.md](docs/plans/2026-03-04-capability-architecture-v2.md)
- [docs/plans/2026-01-26-magpie-design.md](docs/plans/2026-01-26-magpie-design.md)
- [docs/plans/2026-01-26-magpie-implementation.md](docs/plans/2026-01-26-magpie-implementation.md)
- [human_confirmation.example.md](human_confirmation.example.md)
- [magpie_sequence_diagrams.md](magpie_sequence_diagrams.md)

## 当前状态

- `review`、`discuss`、`trd`、`quality`、`loop`、`workflow *` 已注册到 capability runtime
- `init`、`reviewers list`、`stats` 通过当前 CLI 入口直接暴露
- `stats` 仍是轻量占位命令
- `src/commands/` 仍保留部分历史/兼容入口，尚未完全收敛

## License

MIT
