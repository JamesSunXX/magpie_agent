# Magpie

Magpie 是一个面向工程协作的多模型 CLI。它把代码评审、技术讨论、TRD 生成、目标闭环执行、测试质量检查和工程 workflow 收进一个本地入口里。

## 先看哪里

- 文档总览：[`docs/README.md`](./docs/README.md)
- 总体结构：[`ARCHITECTURE.md`](./ARCHITECTURE.md)
- 能力对照：[`docs/references/capabilities.md`](./docs/references/capabilities.md)
- 历史计划：[`docs/plans/`](./docs/plans/)

## 核心能力

- `review`：多 AI 代码评审
- `reviewers`：查看当前配置里的评审人
- `discuss`：多模型讨论
- `trd`：PRD 转 TRD，并产出可机读的约束文件
- `quality unit-test-eval`：检查单测质量，可选顺手跑测试
- `loop`：目标驱动的阶段化执行，按 10 段正式阶段推进；其中 `trd_generation` 默认会自动收敛循环，`milestone_planning` 会在实现前生成里程碑计划，每段都会留下交接卡和可恢复现场，长流程会自动压缩上下文并优先复用压缩摘要
- `harness`：需求到交付的闭环入口
- `harness-server`：后台托管 harness 队列
- `im-server`：接收飞书回调并驱动人工确认、命令发单和表单发单
- `status`：查看最近任务状态、失败原因和下一步动作
- `skills`：查看和启停本地任务技能
- `workflow issue-fix`、`docs-sync`、`post-merge-regression`
- `memory`：查看、编辑、提炼用户记忆和项目记忆；只会沉淀稳定结论
- `tui`：任务工作台
- `init`、`doctor`、`stats`

更细的命令入口和代码位置见 [`docs/references/capabilities.md`](./docs/references/capabilities.md)。

常用状态命令、列表、进度输出、统计报表和 TUI 事件里的展示时间默认按当前机器本地时区显示；会话文件和事件落盘仍保留原始 ISO 时间戳，便于续跑和排查。

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

# 2) 体检当前环境和配置
magpie doctor

# 3) 查看当前任务状态
magpie status

# 4) 查看可用技能
magpie skills list

# 5) 打开任务入口
magpie tui

# 6) 看当前配置里的评审人
magpie reviewers list

# 5) 评审本地改动
magpie review --local

# 6) 多模型讨论
magpie discuss "Should this repo fully migrate review to capability runtime?"

# 7) 生成 TRD
magpie trd ./docs/prd.md

# 8) 评估当前仓库的单测质量
magpie quality unit-test-eval . --run-tests

# 9) 目标闭环执行
magpie loop run "Deliver checkout v2" --prd ./docs/prd.md

# 10) 启动后台 harness 队列（需要长期跑任务时）
magpie harness-server start

# 11) harness 闭环
magpie harness submit "Deliver checkout v2" --prd ./docs/prd.md

# 12) 查看后台状态或接回输出
magpie harness-server status
magpie harness attach <session-id>
magpie harness resume <session-id>
magpie harness confirm <session-id> --approve
magpie harness confirm <session-id> --reject --reason "Need stronger rollback evidence"
magpie harness status <session-id> --cycle 2
magpie harness status <session-id> --node build-ui
magpie harness approve <session-id> --node release-approval --by operator
magpie harness reject <session-id> --by operator --note "Need safer split"

# 13) 前台 harness 被打断后可直接恢复
前台运行的 `magpie harness submit` 如果被 `Ctrl+C`、终端挂断或系统终止打断，会先把当前会话改成可恢复状态，再退出；之后直接用 `magpie harness resume <session-id>` 接着跑。如果前台进程已经没了但会话还挂着“进行中”，`status`、`list`、`resume`、`attach` 和 `inspect` 也会先自动把它收成可恢复状态。

# 14) 启动飞书 IM 回调服务
magpie im-server start --foreground

# 15) 需要后台托管时显式交给 tmux
magpie loop run "Deliver checkout v2" --prd ./docs/prd.md --host tmux

# 16) 跑工程 workflow
magpie workflow docs-sync

# 17) 查看长期记忆
magpie memory show --project
```

`magpie init` 现在会先选择使用场景：本地开发、团队协作、后台托管。默认是本地开发；后台托管会打开更适合长任务的隔离、技能和资源保护默认值。`magpie doctor` 会在检查项之外给出“能不能开始跑任务”和下一步建议。

`magpie status` 会聚合最近的 loop / harness 任务，直接显示任务现在处于运行、等待、失败、完成还是排队，以及下一步该看哪里。飞书里的 `/magpie status` 使用同一套状态摘要，避免本地和飞书看到的说法不一致。

`magpie skills` 管理本地任务技能。技能描述任务需要的能力、适用入口和依赖工具；`loop` / `harness` 会把本次任务实际技能和工具写入会话里的 `tool-manifest.json`。团队协作和后台托管场景会默认启用技能记录和门禁；本地开发场景下，单独启用某个技能也会让它参与任务开始前检查。当前技能只来自本地内置目录和配置，不做远程市场或在线安装。

`trd` 会把当前仓库可执行的最小约束落到 `.magpie/constraints.json`。`loop` 现在把开发主线拆成 10 个正式阶段。前三段分别产出需求决策卡、拆分卡和执行卡；随后 `milestone_planning` 会在动代码前写出里程碑计划；开发中段拆成准备开发、确认失败基线、实施改动、实现后补修；后两段保留为正式验证阶段，失败时会明确标记成验证返工或联调返工。正式阶段可以按 `primary/reviewer/rescue` 配置工具，异常轮次会继承当前阶段的 `rescue`。每个阶段结束后都会留下结构化交接卡，`loop inspect` 也能直接看到最新交接卡路径，方便接着跑。

前台执行 `magpie loop run|resume` 时，终端会实时打印关键进度（阶段进入、provider 重连错误、TRD 收敛轮次、阶段完成/回退），便于判断是否在正常推进。

如果想把 `unit_mock_test` 复用到 Java、Go 或别的项目，不一定非要沿用默认的 `unit_test` / `mock_test` 命令名。现在可以直接在 `capabilities.loop.commands.unit_mock_test_steps` 里按顺序写项目自己的检查步骤，每一步自己起名字、自己填命令；只有没配这组步骤时，才会回退到原来的旧配置。

`loop` 现在默认先走多模型确认：阶段只是低把握或普通失败时，会先让配置里的评审模型给出“通过 / 继续修改 / 必须人工确认”的判断，再决定是否继续。只有模型明确要求人工、阶段评估直接要求人工，或者命中危险命令拦截这类高风险情况时，才会真的落人工确认。`--no-wait-human` 的语义不变，只影响这种“必须人拍板”的场景；多模型确认仍会在当前执行里直接跑完。相关配置在 `capabilities.loop.human_confirmation`，默认 `gate_policy` 为 `multi_model`；生效的评审人列表必须至少有 2 个不同评审人，否则配置会直接报错。`reviewer_ids` 不填时会回退到 `capabilities.discuss.reviewers`。现在可以直接用 `magpie loop confirm <session-id> --approve` 或 `--reject --reason "..."` 处理最近一条待决确认：批准后会自动续跑；驳回后会自动发起一轮 discuss，并把结果重新压成新的短决策卡，不需要手改文件。真正的确认状态保存在 loop 会话里，`human_confirmation.md` 只保留成便于查看和兼容旧会话的摘要投影。

危险命令现在默认会被拦截。只有显式把 `capabilities.safety.allow_dangerous_commands` 设为 `true` 后，才允许继续走确认执行。`capabilities.safety.permission_policy` 还能按命令类别、路径和工具类别设置放行、拒绝或确认。

执行隔离从 `capabilities.execution_isolation` 配置。默认是关闭状态，并预置 `mode: worktree` 作为灰度选择；显式开启后，`loop` 会优先沿用现有 worktree 执行路径，并在会话产物里记录隔离模式和恢复路径。`container` 目前只作为可配置模式和上下文记录，不会默认启用。

工具按需加载从 `capabilities.tool_loading` 配置。默认关闭；显式开启后，`loop` 和 `harness` 会在开始前生成本次任务实际需要的工具清单，写到会话目录的 `tool-manifest.json`。如果必需工具被禁用或对应 provider 不可用，任务会在真正执行前停止，避免后续流程带着错误工具配置继续跑。

资源保护从 `capabilities.resource_guard` 配置。默认关闭；开启后，后台 harness 会限制排队数量和并发数量，失败达到预算时会暂停，不再自动重试。

大部分主干能力都支持独立启停（`capabilities.<name>.enabled`）。关闭后，对应命令会在入口直接提示“当前关闭、怎么开启、可替代命令”，不会继续执行。

`loop` 的 `trd_generation` 阶段现在默认带自动收敛循环：会先生成 TRD，再用 `discuss` 做多模型审查，由统一仲裁给出 `approved / revise_trd / back_to_prd`。遇到 `revise_trd` 会自动接着同一条 TRD 会话补充，再进下一轮审查；遇到 `back_to_prd` 或超过 `max_cycles` 仍未收敛，会自动回退到 `prd_review`。这一段默认配置在 `capabilities.loop.trd_convergence`：`enabled=true`、`max_cycles=5`、`discuss_rounds=2`、`auto_back_to_prd=true`，`reviewer_ids` 不填时会回退到 `capabilities.discuss.reviewers`。每轮审查和仲裁都会落盘到 loop 会话目录，`loop resume` 会从已完成轮次之后继续。

`loop` 在自动提交时会用 AI 生成中文提交信息；默认跟随执行模型，也可通过 `capabilities.loop.auto_commit_model` 单独覆盖。默认的联调阶段会跑 `tests/e2e`，如果仓库有自己的联调命令，可以在 `capabilities.loop.commands.integration_test` 里改掉。

`loop` 在需要新开分支时也会优先让 AI 生成带语义的分支名，并自动在末尾保留时间戳；默认走 `capabilities.loop.branch_naming.tool = claw`，读取 `claw` 的结构化输出避免把进度字样混进分支名，也可以单独关闭或改成别的工具/模型。

`loop` 也可以通过 `capabilities.loop.mr.enabled` 控制是否在整条开发和验证成功结束后自动创建 1 个 GitLab MR。MR 创建失败不会把开发结果改成失败，但会把“需要人工补做 MR”的结果单独落盘并发通知。

`loop` 每次阶段执行都会按 6000 字符预算生成任务知识上下文；超过预算时会自动压缩并保留关键段落（目标、当前状态、保留结论、待办、证据、长期记忆）。压缩结果会写到会话目录 `knowledge/summaries/context-compacted.md`。会话已经有阶段历史，或处于人工确认暂停时，后续执行会优先使用这份压缩摘要，减少长流程续跑时的上下文膨胀。

`memory` 同步项目记忆时会过滤不稳定条目。带有明显不确定表达（例如 `maybe`、`possible`、`TBD`、`待确认`、`可能`）或标记为低稳定性的内容，不会写入项目记忆；只有稳定且可复用的结论才会被沉淀。

`harness` 的默认评审人和每轮附加检查工具可以放在 `capabilities.harness` 里配置；如果没配，才会回退到代码内置默认值。评审、仲裁和附加检查如果命中已知的 Gemini 模型不存在错误，会自动切到 Kiro 重试当前步骤，避免整轮直接挂掉。`harness` 进入内层 `loop` 前仍会把内层确认策略压成 `manual_only`，避免外层多模型评审和内层阶段确认叠两次。现在如果内层 `loop` 失败但已经留下可继续的工作区和下一步线索，外层 `harness` 会停在 `blocked`，后续直接 `harness resume` 就会沿用同一个开发现场继续；重新执行同样的 `harness submit` 也会优先接回最近一条同目标、同 PRD 的可恢复会话，而不是再开一条重复会话。人工确认不再要求手改 `human_confirmation.md`：可以直接用 `magpie harness confirm <session-id> --approve` 或 `--reject --reason "..."` 处理关联的内层 loop 决策，批准后会自动恢复 harness，驳回后会自动发起 discuss 并生成新的短决策卡。真正的确认状态保存在关联 loop 会话里，`human_confirmation.md` 只保留成摘要和旧会话兼容层。每一轮会把参与者、评审结论、仲裁结果和下一步单独落盘，所以 `status`、`inspect`、`attach` 和 TUI 都能直接看最近一轮；TUI 选中 harness 会话时也会显示协作模板和角色职责，`status/inspect` 可以用 `--cycle` 指定回看某一轮。图谱会话已经能在 `status`、`inspect` 和 `list` 里看到图谱总览；需要钻到单个节点时，可以用 `status --node <id>` 或 `inspect --node <id>`。现在在 `magpie tui` 里选中带图谱的 harness 会话后按 `Enter`，会进入独立图谱工作台：可以切换节点、看节点详情、区分“当前要注意什么”和“最近发生了什么”，还可以直接批准/拒绝等待中的 gate，或者跳到关联 loop/harness 会话的现有入口。如果图谱卡在“等批准”，也可以继续用 `harness approve` 或 `harness reject` 对整张图或指定节点写入决定，结果会落盘并立刻影响后续可运行节点。

如果开启阶段通知里的 `stage_ai` 摘要，可以用 `integrations.notifications.stage_ai.timeout_ms` 控制它最长等多久；超时后会直接回退到内置摘要，不会卡住主流程。

`trd`、`loop`、`harness` 以及 workflow 会话产物默认写到当前仓库的 `.magpie/sessions/<capability>/<sessionId>/`，便于在仓库内查看、续跑和交给 TUI 展示。`loop` 和 `harness` 会记录 `tool-manifest.json`，用于查看本次任务实际启用、禁用和缺失的工具。`review --repo` 的多轮评审会把每一轮结果额外落到 `.magpie/state/<sessionId>/round_<N>.json`；中断后重新启动会先对齐这些轮次文件，再从最后一个成功轮次继续。`harness-server` 的后台状态会落到 `.magpie/harness-server/state.json`，`harness-server status` 会聚合显示当前任务、最近事件、最近失败、下次重试和启用工具；`im-server` 的线程映射、回调去重和服务状态会落到 `.magpie/im/`。

## 灰度发布与回退

建议把发布拆成“先灰度、再全量”两步：

1. 灰度阶段只对小范围仓库开启 `loop` / `harness` / `workflow`，先观察至少一个完整闭环（提交、恢复、验证、人工确认）。
2. 灰度期间保持 `capabilities.safety.allow_dangerous_commands=false`，避免高风险命令误放开。
3. 如果灰度期间出现异常，立刻把相关能力开关改回 `false`（例如 `capabilities.loop.enabled=false`、`capabilities.harness.enabled=false`），并保留当前 `.magpie/sessions/` 现场用于排查。
4. 回退后优先使用 `magpie loop inspect`、`magpie harness inspect` 和会话 `failures/` 目录确认失败原因，再决定是否重新灰度。

## DeerFlow 对标实施范围

近期对标只做五件事：执行隔离、技能和工具按需加载、后台任务观测、权限与资源保护、飞书链路闭环。IM 只保留飞书，不扩 Slack、微信、企业微信、Telegram 等其他渠道，也不把 Magpie 改造成泛用内容生产平台。

后续里程碑按下面方式灰度和回退：

- `capabilities.execution_isolation.enabled`
- `capabilities.tool_loading.enabled`
- `capabilities.resource_guard.enabled`
- `integrations.im.enabled`
- 后台观测是只读增量，不改变任务执行；回退时继续用原会话目录和旧状态命令排查即可

任一里程碑出问题时，先关闭对应开关，再用 `magpie loop inspect`、`magpie harness inspect`、`magpie harness-server status` 和会话目录里的 `failures/` 排查。

## Feishu IM 控制

现在飞书线程支持四类动作：

- 处理人工确认
- 用固定格式消息直接发起新任务
- 用消息卡片表单直接发起新任务
- 用 `/magpie status` 查询当前任务状态

当前做法是：

1. 在配置里打开 `integrations.im`
2. 配好飞书应用的 `app_id`、`app_secret`、`verification_token`
3. 配好允许批准/驳回人工确认的 `approval_whitelist_open_ids`
4. 配一个只在没有现成线程、或需要兜底时才会用到的默认群 `default_chat_id`
5. 启动回调服务：`magpie im-server start --foreground`

发起新任务时，在群里发送固定格式消息：

```text
/magpie task
type: small
goal: Fix login timeout
prd: docs/plans/login-timeout.md
```

或：

```text
/magpie task
type: formal
goal: Deliver payment retry flow
prd: docs/plans/payment-retry.md
priority: high
```

规则是：

- `type: small` 走 `loop`
- `type: formal` 走 `harness`
- `type`、`goal` 和 `prd` 都必填
- `type` 只接受 `small / formal`
- `priority` 只对 `formal` 任务有意义，且只接受 `interactive / high / normal / background`
- 一条任务对应一条飞书线程
- 任务被接收后，线程里会继续收到排队、运行、完成或失败的状态回写

也可以先发：

```text
/magpie form
```

系统会回一张表单卡片。表单字段固定是 `type / goal / prd / priority`。填写后提交，后面的建线程、起任务和状态回写会走和文本命令完全相同的流程。`type`、`goal` 和 `prd` 都必填；`type` 只接受 `small / formal`；`priority` 只对 `formal` 任务有意义，且只接受 `interactive / high / normal / background`，其他值会被拒绝。

任务发起后，可以在同一条任务线程里发送 `/magpie status` 查看当前状态、失败原因、下一步动作和本地 inspect 命令。

人工确认场景下，Magpie 会：

- 新任务会先在用户当前发消息的群里创建线程
- 如果这个会话已经绑过线程，就复用原线程
- 只有没有现成线程、或需要兜底时，才会使用 `default_chat_id` 对应的默认群
- 把当前确认卡点发到这条线程里
- 允许白名单里的飞书用户直接批准或拒绝
- 把补充说明一并写回原任务，再继续跑

更完整的接入说明见 [`docs/channels/feishu-im.md`](./docs/channels/feishu-im.md)。

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
