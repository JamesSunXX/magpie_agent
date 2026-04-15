# Magpie

Magpie 是一个面向工程协作的多模型 CLI。它把代码评审、技术讨论、TRD 生成、目标闭环执行和工程 workflow 收到一个本地入口里。

## 先看哪里

- 文档总览：[`docs/README.md`](./docs/README.md)
- 总体结构：[`ARCHITECTURE.md`](./ARCHITECTURE.md)
- 能力对照：[`docs/references/capabilities.md`](./docs/references/capabilities.md)
- 历史计划：[`docs/plans/`](./docs/plans/)

## 核心能力

- `review`：多 AI 代码评审
- `discuss`：多模型讨论
- `trd`：PRD 转 TRD，并产出可机读的约束文件
- `loop`：目标驱动的阶段化执行，简单任务会先过规则再先跑失败测试
- `harness`：需求到交付的闭环入口
- `harness-server`：后台托管 harness 队列
- `workflow issue-fix`、`docs-sync`、`post-merge-regression`
- `memory`：查看、编辑、提炼用户记忆和项目记忆
- `tui`：任务工作台
- `init`、`reviewers list`、`stats`

更细的命令入口和代码位置见 [`docs/references/capabilities.md`](./docs/references/capabilities.md)。

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
# 1) 生成或升级配置
magpie init

# 2) 打开任务入口
magpie tui

# 3) 评审本地改动
magpie review --local

# 4) 多模型讨论
magpie discuss "Should this repo fully migrate review to capability runtime?"

# 5) 生成 TRD
magpie trd ./docs/prd.md

# 6) 目标闭环执行
magpie loop run "Deliver checkout v2" --prd ./docs/prd.md

# 7) 启动后台 harness 队列（需要长期跑任务时）
magpie harness-server start

# 8) harness 闭环
magpie harness submit "Deliver checkout v2" --prd ./docs/prd.md

# 9) 查看后台状态或接回输出
magpie harness-server status
magpie harness attach <session-id>
magpie harness resume <session-id>
magpie harness status <session-id> --cycle 2
magpie harness status <session-id> --node build-ui
magpie harness approve <session-id> --node release-approval --by operator
magpie harness reject <session-id> --by operator --note "Need safer split"

前台运行的 `magpie harness submit` 如果被 `Ctrl+C`、终端挂断或系统终止打断，会先把当前会话改成可恢复状态，再退出；之后直接用 `magpie harness resume <session-id>` 接着跑。如果前台进程已经没了但会话还挂着“进行中”，`status`、`list`、`resume`、`attach` 和 `inspect` 也会先自动把它收成可恢复状态。

# 10) 需要后台托管时显式交给 tmux
magpie loop run "Deliver checkout v2" --prd ./docs/prd.md --host tmux

# 11) 查看长期记忆
magpie memory show --project
```

`trd` 会把当前仓库可执行的最小约束落到 `.magpie/constraints.json`。`loop` 在进入开发前会先读取这份约束；对适合的小任务，会先确认测试先失败，再继续往下做。后面如果测试还是没过，它会先按小次数继续尝试；超过阈值后才停下来等人处理。复杂任务如果需要独立工作区，`loop` 现在会自动准备本地 `.worktrees/` 目录，并把它写进本地 Git 忽略，不再要求先手工创建。

`loop` 现在默认先走多模型确认：阶段只是低把握或普通失败时，会先让配置里的评审模型给出“通过 / 继续修改 / 必须人工确认”的判断，再决定是否继续。只有模型明确要求人工、阶段评估直接要求人工，或者命中危险命令拦截这类高风险情况时，才会真的落 `human_confirmation.md`。`--no-wait-human` 的语义不变，只影响这种“必须人拍板”的场景；多模型确认仍会在当前执行里直接跑完。相关配置在 `capabilities.loop.human_confirmation`，默认 `gate_policy` 为 `multi_model`，`reviewer_ids` 不填时会回退到 `capabilities.discuss.reviewers`。

`loop` 在自动提交时会用 AI 生成中文提交信息；默认跟随执行模型，也可通过 `capabilities.loop.auto_commit_model` 单独覆盖。默认的联调阶段会跑 `tests/e2e`，如果仓库有自己的联调命令，可以在 `capabilities.loop.commands.integration_test` 里改掉。

`loop` 在需要新开分支时也会优先让 AI 生成带语义的分支名，并自动在末尾保留时间戳；默认走 `capabilities.loop.branch_naming.tool = claw`，也可以单独关闭或改成别的工具/模型。

`loop` 也可以通过 `capabilities.loop.mr.enabled` 控制是否在整条开发和验证成功结束后自动创建 1 个 GitLab MR。MR 创建失败不会把开发结果改成失败，但会把“需要人工补做 MR”的结果单独落盘并发通知。

`harness` 的默认评审人和每轮附加检查工具可以放在 `capabilities.harness` 里配置；如果没配，才会回退到代码内置默认值。评审、仲裁和附加检查如果命中已知的 Gemini 模型不存在错误，会自动切到 Kiro 重试当前步骤，避免整轮直接挂掉。`harness` 进入内层 `loop` 前仍会把内层确认策略压成 `manual_only`，避免外层多模型评审和内层阶段确认叠两次。每一轮会把参与者、评审结论、仲裁结果和下一步单独落盘，所以 `status`、`inspect`、`attach` 和 TUI 都能直接看最近一轮，`status/inspect` 也可以用 `--cycle` 指定回看某一轮。图谱会话已经能在 `status`、`inspect` 和 `list` 里看到图谱总览；需要钻到单个节点时，可以用 `status --node <id>` 或 `inspect --node <id>`。现在在 `magpie tui` 里选中带图谱的 harness 会话后按 `Enter`，会进入独立图谱工作台：可以切换节点、看节点详情、区分“当前要注意什么”和“最近发生了什么”，还可以直接批准/拒绝等待中的 gate，或者跳到关联 loop/harness 会话的现有入口。如果图谱卡在“等批准”，也可以继续用 `harness approve` 或 `harness reject` 对整张图或指定节点写入决定，结果会落盘并立刻影响后续可运行节点。

如果开启阶段通知里的 `stage_ai` 摘要，可以用 `integrations.notifications.stage_ai.timeout_ms` 控制它最长等多久；超时后会直接回退到内置摘要，不会卡住主流程。

`trd`、`loop`、`harness` 以及 workflow 会话产物默认写到当前仓库的 `.magpie/sessions/<capability>/<sessionId>/`，便于在仓库内查看、续跑和交给 TUI 展示。`review --repo` 的多轮评审会把每一轮结果额外落到 `.magpie/state/<sessionId>/round_<N>.json`；中断后重新启动会先对齐这些轮次文件，再从最后一个成功轮次继续。`harness-server` 的后台状态会落到 `.magpie/harness-server/state.json`。

失败职责现在也固定下来了：`loop` 负责判断自己内部阶段失败，`harness` 负责补齐整个交付流程的外层失败，`harness-server` 只负责后台托管、重试和服务级恢复。三者都会把失败细节落到各自会话目录下的 `failures/`，并把仓库级聚合写到 `.magpie/failure-index.json`，排查时先看会话目录，再看仓库索引。

从源码运行：

```bash
npm run dev -- --help
```

## 仓库结构

- `src/cli/`：命令入口和参数解析
- `src/capabilities/`：当前主干能力实现
- `src/core/`：公共运行基础
- `src/platform/`：provider、配置与外部集成
- `src/knowledge/`、`src/memory/`：会话知识和长期记忆
- `src/tui/`：任务工作台
- `tests/`：测试
- `docs/`：项目文档和设计历史
- `dist/`：编译产物，不手改

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

改命令、结构或主要能力时，至少同步更新对应入口文档，并运行：

```bash
npm run check:docs
```
