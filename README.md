# Magpie

Magpie 是一个面向工程协作的多模型 CLI。它把代码评审、技术讨论、TRD 生成、目标闭环执行和若干工程 workflow 收到一个本地入口里。

## 先看哪里

- 文档总览：[`docs/README.md`](./docs/README.md)
- 总体结构：[`ARCHITECTURE.md`](./ARCHITECTURE.md)
- 能力对照：[`docs/references/capabilities.md`](./docs/references/capabilities.md)
- 历史计划：[`docs/plans/`](./docs/plans/)

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
- `harness`：harness 模式需求开发闭环主入口，支持提交、查看状态、查看事件流和列出会话
- `workflow harness`：兼容旧入口，仍可直接触发 harness 运行
- `workflow docs-sync`：对照当前代码审查文档并生成更新报告，可选直接应用文档修改
- `workflow post-merge-regression`：执行回归命令并沉淀结果报告
- `memory`：查看和维护用户记忆、项目记忆，并把 loop/harness 里的稳定结论提炼进项目记忆
- `quality unit-test-eval`：评估单测质量，可选运行测试命令

### Provider 与集成

- CLI provider：`claude-code`、`codex`、`claw`、`gemini-cli`、`qwen-code`、`kiro`
- API provider：Anthropic、OpenAI、Google、MiniMax
- 通知集成：`macos`、`feishu-webhook`、`imessage`（`messages-applescript` / `bluebubbles`）

说明：

- `magpie init` 当前交互式初始化里可直接选择的 reviewer 是 `claude-code`、`codex`、`claw`、`gemini-cli`、`kiro`、`claude-api`、`gpt`、`gemini`
- `qwen-code` provider 在代码里已支持，但当前不在 `init` 的交互式候选列表中

### Kiro agent 绑定

当某个角色使用 `model: kiro` 时，可以选择固定到一个 Kiro agent：

```yaml
reviewers:
  backend:
    tool: kiro
    model: claude-sonnet-4-6
    agent: go-reviewer
    prompt: |
      Review backend changes.
```

如果不写 `agent`，Magpie 会先尝试使用该配置项名称（例如 `backend`），找不到时回退到 `kiro_default`。
如果仓库里有 `agents/kiro-config`，Magpie 会在调用前检查它，并在版本或内容变化时同步到 `~/.kiro`。如果仓库里没有这套项目配置，Magpie 会直接复用当前机器上已经存在的 Kiro agent。

### 自动复杂度路由

开启 `capabilities.routing.enabled: true` 后，`harness`、`loop`、`issue-fix`、`discuss` 会按任务复杂度自动选模型。

- `simple`：优先 `gemini-cli`
- `standard`：优先 `codex`
- `complex`：优先 `kiro`
  - 规划 / 审议：`kiro` + `architect`
  - 执行 / 修复：`kiro` + `dev`

默认内置三组稳定 reviewer，可直接用于 `discuss` 或自动路由：

```yaml
reviewers:
  route-gemini:
    tool: gemini
  route-codex:
    tool: codex
  route-architect:
    tool: kiro
    agent: architect
```

如果你想固定某个 CLI 工具内部的具体模型，也可以同时写 `tool + model`：

```yaml
capabilities:
  routing:
    stage_policies:
      planning:
        simple:
          tool: gemini
          model: gemini-2.5-flash
        standard:
          tool: codex
          model: gpt-5.4
        complex:
          tool: kiro
          model: claude-sonnet-4-6
          agent: architect
      execution:
        complex:
          tool: kiro
          model: claude-sonnet-4-6
          agent: dev
```

兼容规则：

- 新写法优先：`tool + model + agent`
- 老写法 `model: codex`、`model: gemini-cli`、`model: kiro` 继续可用
- `agent` 目前只对 `kiro` 生效

如果手工传了 `--reviewers`、`--models` 或 `--complexity`，这些显式参数优先于自动路由。
如果当前档位的首选模型不可用，路由会先按 `fallback_chain` 在同一条链路里换到下一个可用模型，并记录到 `routing-decision.json`。

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
- 如果要使用 CLI provider，需要本机已安装对应 CLI 并完成登录

安装步骤：

```bash
npm install
npm run build
npm link
```

启用仓库自带提交钩子：

```bash
./scripts/setup_git_hooks.sh
```

## 快速开始

```bash
# 1) 生成配置
magpie init

# 2) 查看入口
magpie tui

# 3) 评审改动
magpie review --local

# 4) 多模型讨论
magpie discuss "Should this repo fully migrate review to capability runtime?"

# 5) 生成 TRD
magpie trd ./docs/prd.md

# 6) 目标闭环执行
magpie loop run "Deliver checkout v2" --prd ./docs/prd.md

# 7) harness 闭环
magpie harness submit "Deliver checkout v2" --prd ./docs/prd.md
# 8) 需要后台托管时显式交给 tmux
magpie loop run "Deliver checkout v2" --prd ./docs/prd.md --host tmux
magpie harness status harness-abc123
magpie harness attach harness-abc123
magpie harness list
magpie workflow docs-sync --apply
magpie workflow post-merge-regression --command "npm run test:run" "npm run build"

# 10) 长期记忆
magpie memory show
magpie memory edit --project
magpie memory promote loop-abc123
```

补充说明：

- `loop run` 和 `harness submit` 支持 `--host foreground|tmux`
- 命中 `complex` 的 `loop` 运行会优先尝试在 `.worktrees/` 或 `worktrees/` 里隔离执行
- `harness status` 和 `harness attach` 会显示实际工作目录和 tmux 会话信息

| 命令 | 作用 | 说明 |
| --- | --- | --- |
| `magpie init` | 初始化 `~/.magpie/config.yaml` | 支持交互式 reviewer/通知/planning/operations 配置 |
| `magpie review` | 多 AI 代码评审 | capability runtime + orchestrator |
| `magpie discuss` | 多模型讨论/辩论 | capability runtime + orchestrator |
| `magpie trd` | PRD -> TRD | capability runtime |
| `magpie quality unit-test-eval` | 单测质量评估 | capability |
| `magpie loop run/resume/list` | 目标驱动的阶段执行闭环 | capability |
| `magpie harness submit/status/attach/list` | harness 闭环开发与会话查看 | capability + 持久化会话 |
| `magpie workflow issue-fix` | 问题修复工作流 | capability |
| `magpie workflow harness` | harness 旧兼容入口 | capability |
| `magpie workflow docs-sync` | 文档与代码同步检查/更新 | capability |
| `magpie workflow post-merge-regression` | 合并后回归检查 | capability |
| `magpie memory show/edit/promote` | 查看、编辑、提炼长期记忆 | 用户记忆 + 项目记忆 |
| `magpie tui` | 任务工作台 | 新建任务、恢复会话、命令预览、TUI 内执行 |
| `magpie reviewers list` | 查看 reviewer 配置 | 直接读取配置 |
| `magpie stats` | 查看评审统计 | 当前仍为占位实现 |

## TUI 任务工作台

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
magpie discuss "Review @file:src/cli/program.ts and @project-memory before we rename commands"
magpie discuss ./notes/topic.md --devil-advocate
magpie discuss "Should we migrate now?" --plan-report
magpie discuss ./docs/plans/2026-04-10-harness-complexity-routing.md --reviewers route-gemini,route-codex,route-architect --plan-report
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
- `--complexity <tier>`：覆盖自动复杂度分级，可选 `simple|standard|complex`
- `-d, --devil-advocate`
- `--list`
- `--resume <id>`
- `--export <id>`
- `--conclusion`
- `--plan-report`：讨论结束后自动生成可实施计划报告；导出时也可单独生成，会额外调用一次模型，计划报告仅支持 Markdown

上下文引用：

- `discuss` 支持在输入里直接引用上下文：`@file:<path>`、`@dir:<path>`、`@diff[:base]`、`@url:<https-url>`、`@project-memory`、`@user-memory`
- 第一版只展开显式引用，不会自动回忆历史会话

### `trd`

```bash
magpie trd [prd.md] [options]
```

常见用法：

```bash
magpie trd ./docs/prd.md
magpie trd ./docs/prd-with-context.md
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

- PRD 内容里也支持 `@file:<path>`、`@dir:<path>`、`@diff[:base]`、`@url:<https-url>`、`@project-memory`、`@user-memory`
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
  - `mock_test`: 默认跳过；如果项目有单独的 mock 检查，再在配置里显式填写
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
magpie workflow issue-fix "fix flaky tests in notifications" --complexity standard
magpie workflow issue-fix "fix flaky tests in notifications" --apply --verify-command "npm run test:run"
magpie harness submit "Deliver checkout v2" --prd ./docs/prd.md
magpie harness submit "Deliver checkout v2" --prd ./docs/prd.md --complexity complex
magpie harness submit "Deliver checkout v2" --prd ./docs/prd.md --models gemini-cli kiro --max-cycles 4
magpie harness status harness-abc123
magpie harness attach harness-abc123
magpie harness list
magpie workflow docs-sync
magpie workflow docs-sync --apply
magpie workflow post-merge-regression
magpie workflow post-merge-regression --command "npm run test:run" "npm run build"
```

重要参数：

- `issue-fix --apply`：允许执行器直接落代码
- `issue-fix --verify-command <command>`：覆盖验证命令
- `issue-fix --complexity <tier>`：覆盖自动复杂度分级
- `harness submit --prd <path>`：指定需求 PRD，执行开发->评审->单测->自确认闭环
- `harness submit --models <models...>`：指定用于对抗确认的模型，默认 `gemini-cli kiro`
- `harness submit --complexity <tier>`：覆盖自动复杂度分级；如果同时传了 `--models`，只覆盖开发/修复链路，不改手工指定的评审模型
- `harness submit --max-cycles <number>`：最大修复轮次，默认 `3`
- `harness submit --review-rounds <number>`：每轮评审辩论轮次，默认 `3`
- `harness submit --test-command <command>`：覆盖单测命令
- `harness status <session-id>`：查看会话当前状态、阶段和摘要
- `harness attach <session-id>`：查看持久化事件流
- `harness list`：列出本机已有 harness 会话
- `docs-sync --apply`：允许直接更新文档
- `post-merge-regression --command <command...>`：覆盖回归命令列表

安全提示：

- `loop`、`workflow issue-fix`、`workflow post-merge-regression` 在执行明显危险的命令前会单独确认
- 非交互执行时，命中这类命令会直接拦下，不会继续跑

### `memory`

```bash
magpie memory <show|edit|promote> [options]
```

常见用法：

```bash
magpie memory show
magpie memory show --project
magpie memory edit --user
magpie memory promote loop-abc123
```

说明：

- `show`：查看用户记忆和项目记忆
- `edit`：创建目标文件，并在有 `EDITOR` / `VISUAL` 时直接打开
- `promote`：把 loop 或 harness 会话里已经沉淀出的稳定结论提炼进项目记忆
- 用户记忆和项目记忆默认都使用本地 Markdown 文件保存

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

当前模板会写入 `config_version`。后续执行命令时，如果本地配置版本落后，CLI 会先提示你运行升级命令，但不会直接拦截当前命令。

如果你改了配置契约相关代码，提交时还会额外检查：这类改动必须同步更新 `CURRENT_CONFIG_VERSION`。启用仓库钩子后，这个检查会在 `git commit` 前自动执行。

推荐方式是先生成模板，再按需调整：

```bash
magpie init
# 或
magpie init -y
```

如果你已经有一份 v2 配置，推荐直接走升级入口：

```bash
# 先预览，不落盘
magpie init --upgrade --dry-run

# 确认后再真正写回
magpie init --upgrade

# 指定项目内的配置文件
magpie init --upgrade --config ./project/.magpie/config.yaml
```

当前加载器只接受新 schema：

- 顶层必须包含 `capabilities`
- 顶层必须包含 `integrations`
- 旧版 legacy config 已不再支持；如果沿用旧配置，加载时会直接报错并提示重新执行 `magpie init`

### provider 路由规则

- CLI 型：`claude-code`、`codex`、`claw`、`gemini-cli`、`qwen-code`、`kiro`
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
    reuse_current_branch: false
    auto_branch_prefix: "sch/"
    human_confirmation:
      file: "human_confirmation.md"
      gate_policy: "exception_or_low_confidence"
```

说明：

- 默认 reviewer 由 `init` 选择结果决定；`-y` 时默认是 `claude-code` + `codex`
- `capabilities.loop.reuse_current_branch: true` 时，如果当前已经在非 `main/master` 分支上，loop/harness 会直接沿用当前分支并继续按阶段自动提交；如果当前在 `main/master`，仍会自动新建 `sch/...` 分支
- `init` 会在已有配置存在时自动备份旧文件为 `config.yaml.bak-<timestamp>`
- `init --upgrade` 当前会补齐自动路由默认项、修正常见旧 binding（例如 `codex-cli`），并保留已有 reviewer / prompt / 通知配置
- `init --upgrade` 当前只支持已经是 v2 schema 的配置；如果是更老的 legacy 配置，仍建议直接重新生成
- `init --upgrade` 会提示你复查仓库相关的校验命令；一期版本不会自动判断仓库是 Go、Node 还是 Python
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
- 用户记忆：`~/.magpie/memories/USER.md`
- 项目记忆：`~/.magpie/memories/projects/<repo-key>/PROJECT.md`
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
```

更细的职责说明见 [`ARCHITECTURE.md`](./ARCHITECTURE.md)。

## 常用开发命令

```bash
npm run dev -- review 12345
npm run test:run
npm run test:coverage
npm run build
npm run lint
npm run check:boundaries
npm run check:docs
```

## 文档约定

- 快速上手和常用命令放在 `README.md`
- 做事入口和最低规则放在 `AGENTS.md`
- 项目结构和边界放在 `ARCHITECTURE.md`
- 能力说明放在 `docs/references/`
- 设计和计划历史放在 `docs/plans/`

改命令、结构或主要能力时，至少同步更新相关入口文档，并运行：

```bash
npm run check:docs
```
