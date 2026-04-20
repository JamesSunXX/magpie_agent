# Capability Reference

这份文档只回答三件事：每类能力是干嘛的、从哪个命令进、主要代码在哪。

补充约定：常用状态命令、列表、进度输出、统计报表和 TUI 事件里的展示时间统一按当前机器本地时区显示；持久化到 `.magpie/` 的会话与事件时间仍保留 ISO 时间戳。

## 核心命令

| 能力 | 命令入口 | 主要代码位置 | 备注 |
| --- | --- | --- | --- |
| 评审 | `magpie review` | `src/cli/commands/review.ts`、`src/capabilities/review/` | 支持 PR、本地改动、分支、文件、仓库级扫描；`review --repo` 会把每轮结果写到 `.magpie/state/<sessionId>/round_<N>.json`，启动或恢复时会先对齐已落盘轮次，再从最后一个成功轮次继续；只有全部轮次核齐后才生成最终总结 |
| 讨论 | `magpie discuss` | `src/cli/commands/discuss.ts`、`src/capabilities/discuss/` | 多模型讨论，可选对抗视角 |
| TRD 生成 | `magpie trd` | `src/cli/commands/trd.ts`、`src/capabilities/trd/` | 从 PRD Markdown 生成 TRD，并在仓库 `.magpie/constraints.json` 落一份可机读约束 |
| 闭环执行 | `magpie loop run|resume|confirm|inspect|list` | `src/cli/commands/loop.ts`、`src/capabilities/loop/` | 支持 `--host foreground|tmux`，可查看知识摘要；会话开始时会先生成并持久化一份 `document-plan.json`，把正式文档落点和保守回退目录固定下来；进入开发前会先过约束卡点；对适合的小任务会先确认失败测试，再继续实现；测试没过时会区分“继续修”和“执行事故”，按小次数重试后再停到人工介入；如果失败时已经留下可继续的工作区、测试/修复证据和下一步提示，会话会停在可恢复状态而不是直接作废，`loop resume` 会继续沿用原工作区；现在 `unit_mock_test`、`integration_test` 这类后置验证阶段如果也留下了原工作区、阶段产物和下一步提示，同样可以直接续跑，不必从头新开；当这些后置验证阶段的结果仍要求继续修复时，会话会保留现场并把问题重新交回执行节点，而不是直接判成终态失败；`unit_mock_test` 默认仍会跑 `unit_test + mock_test`，但如果配置了 `capabilities.loop.commands.unit_mock_test_steps`，会优先按项目自定义步骤执行，更方便复用到 Java 或其他 Go 项目；`capabilities.loop.human_confirmation.gate_policy = multi_model` 时，普通低把握阶段会先走多模型确认，只有模型明确要求人工、阶段评估直接要求人工，或命中危险命令拦截时才转人工确认；`reviewer_ids` 不填时会回退到 `capabilities.discuss.reviewers`，`max_model_revisions` 控制模型要求补改的次数；阶段评估结果如果只是格式没读出来，会优先自动兜底继续，不再把这类格式问题误挂到人工确认；`confirm` 可直接批准或驳回最近一条待处理人工确认，批准后会自动续跑，驳回后会自动发起一轮 discuss 并生成新的短决策卡；确认状态以 loop 会话里的 `humanConfirmations` 为准，`human_confirmation.md` 只保留成摘要投影和旧会话兼容层；运行中如果 `codex` 在阶段执行或阶段评估时超时，当前阶段会自动改用 `kiro` 续跑并记事件；自动提交默认用 AI 生成中文提交信息，可用 `capabilities.loop.auto_commit_model` 覆盖模型；新开分支时会优先生成带语义的分支名，并保留时间戳后缀，默认配置走 `capabilities.loop.branch_naming.tool = claw`，读取 `claw` 的结构化输出避免把进度字样混进分支名；`capabilities.loop.mr.enabled` 打开后，会在整条开发和验证成功结束后自动尝试创建 1 个 GitLab MR；如果 MR 创建失败，开发结果仍保持完成，但会单独记录并通知需要人工补做；会为当前会话按角色保存 provider 会话、角色信息和下一轮最小输入摘要；开启通知后会按阶段发摘要消息，飞书默认用卡片格式并附带项目名与项目路径；`capabilities.loop.execution_timeout` 可按任务复杂度调整执行超时 |
| Harness | `magpie harness submit|resume|confirm|status|attach|inspect|approve|reject|list` | `src/cli/commands/harness.ts`、`src/capabilities/workflows/harness/` | 需求到交付的闭环入口；支持 `--host foreground|tmux`；进入 loop 前会先生成或复用会话级 `document-plan.json`，并把同一份文档模式传给内层 loop；后台服务运行时，`submit` 会入队而不是立刻前台执行；默认评审人和每轮附加检查工具都可通过 `capabilities.harness` 配置，未配置时回退到内置默认值；评审、仲裁和附加检查命中已知的 Gemini 模型不存在错误时，会自动切到 Kiro 重试当前步骤；内层 `loop` 如果遇到 `codex` 阶段超时，也会在当前阶段自动切到 `kiro` 续跑；进入内层 `loop` 时会继续把内层确认策略压成 `manual_only`，避免和外层评审闭环重复；恢复时会跳过已完成的开发阶段或评审轮次；如果内层 loop 失败但已经留下可恢复检查点，外层 Harness 会停在 `blocked` 并保留原工作区、分支和文档，`resume` 会继续原开发阶段；旧会话就算外层自己已经写成 `failed`，只要关联的内层 loop 还保留着可信的继续线索，`harness resume` 也会直接接回原会话；`confirm` 会处理关联 loop 的最近一条待处理人工确认，批准后自动恢复 harness，驳回后自动发起 discuss 并生成新的短决策卡；关联的真实确认状态仍保存在 loop 会话里，`human_confirmation.md` 只保留成摘要和旧会话兼容层；重新执行同目标、同 PRD 的 `harness submit` 时，会自动接回最近一条可恢复会话，避免重复开单；每轮会保留参与者、评审结论、仲裁结果、开放问题和下一步，并按角色持久化可恢复的 provider 会话；`status/inspect` 支持 `--cycle` 回看指定轮次；图谱会话已经会显示图谱总览，并支持 `--node <id>` 查看单个节点；当提交 `docs/plans/2026-04-14-harness-loop-failure-recovery-document-first-plan.md` 或对应源需求时，入队图谱会展开成 5 个真实阶段节点，并把对应阶段文档路径带到节点详情；`approve/reject` 可以对整张图或指定节点写入批准结果；`list` 也会带出图谱简要状态；开启通知后会按外层阶段发摘要消息，飞书默认用卡片格式并附带项目名与项目路径 |
| Harness 后台服务 | `magpie harness-server start|status|stop` | `src/cli/commands/harness-server.ts`、`src/capabilities/workflows/harness-server/` | 常驻队列宿主；负责接单、串行执行当前仓库任务、失败重试和服务重启后的会话恢复；中断中的任务会重新入队并从上一个已保存节点继续 |
| 闭环执行 | `magpie loop run|resume|inspect|list` | `src/cli/commands/loop.ts`、`src/capabilities/loop/` | 支持 `--host foreground|tmux`，可查看知识摘要；会话开始时会先生成并持久化一份 `document-plan.json`，把正式文档落点和保守回退目录固定下来；进入开发前会先过约束卡点；对适合的小任务会先确认失败测试，再继续实现；测试没过时会区分“继续修”和“执行事故”，按小次数重试后再停到人工介入；`capabilities.loop.human_confirmation.gate_policy = multi_model` 时，普通低把握阶段会先走多模型确认，只有模型明确要求人工、阶段评估直接要求人工，或命中危险命令拦截时才转人工文件确认；`reviewer_ids` 不填时会回退到 `capabilities.discuss.reviewers`，`max_model_revisions` 控制模型要求补改的次数；阶段评估结果如果只是格式没读出来，会优先自动兜底继续，不再把这类格式问题误挂到人工确认；`unit_mock_test` 遇到旧默认 `tests/mock` 目标但仓库里没有对应测试时会自动跳过，不再因此误判失败；`integration_test` 默认跑仓库现有的 `tests/e2e`，也可以用 `capabilities.loop.commands.integration_test` 覆盖；复杂任务需要独立工作区时会自动准备本地 `.worktrees/` 并写入本地 Git 忽略；自动提交默认用 AI 生成中文提交信息，可用 `capabilities.loop.auto_commit_model` 覆盖模型；新开分支时会优先生成带语义的分支名，并保留时间戳后缀，默认配置走 `capabilities.loop.branch_naming.tool = claw`；`capabilities.loop.mr.enabled` 打开后，会在整条开发和验证成功结束后自动尝试创建 1 个 GitLab MR；如果 MR 创建失败，开发结果仍保持完成，但会单独记录并通知需要人工补做；会为当前会话落角色信息和下一轮最小输入摘要；开启通知后会按阶段发摘要消息，`integrations.notifications.stage_ai.timeout_ms` 可以限制摘要生成等待时间，超时后自动回退到内置摘要；`capabilities.loop.execution_timeout` 可按任务复杂度调整执行超时；内部阶段失败会落到当前 loop 会话的 `failures/` 目录，并同步聚合到仓库 `.magpie/failure-index.json` |
| Harness | `magpie harness submit|resume|status|attach|inspect|approve|reject|list` | `src/cli/commands/harness.ts`、`src/capabilities/workflows/harness/` | 需求到交付的闭环入口；支持 `--host foreground|tmux`；进入 loop 前会先生成或复用会话级 `document-plan.json`，并把同一份文档模式传给内层 loop；后台服务运行时，`submit` 会入队而不是立刻前台执行；前台 `submit` 被 `Ctrl+C`、`SIGHUP` 或系统终止打断时，会先把会话改成可恢复状态再退出；如果前台进程已经没了但会话还挂着 `in_progress`，`status/list/resume/attach/inspect/approve/reject` 会先自动把它收成 `waiting_next_cycle`；默认评审人和每轮附加检查工具都可通过 `capabilities.harness` 配置，未配置时回退到内置默认值；评审、仲裁和附加检查命中已知的 Gemini 模型不存在错误时，会自动切到 Kiro 重试当前步骤；进入内层 `loop` 时会继续把内层确认策略压成 `manual_only`，避免和外层评审闭环重复；恢复时会跳过已完成的开发阶段或评审轮次；如果内层 loop 是因为等人工处理而暂停，外层 Harness 也会保持在当前阶段暂停，不再直接记成失败，此时可直接用 `resume` 接着跑；每轮会保留参与者、评审结论、仲裁结果、开放问题和下一步；`status/inspect` 支持 `--cycle` 回看指定轮次；图谱会话已经会显示图谱总览，并支持 `--node <id>` 查看单个节点；`approve/reject` 可以对整张图或指定节点写入批准结果；`list` 也会带出图谱简要状态；开启通知后会按外层阶段发摘要消息；外层 workflow 失败会写进当前 harness 会话的 `failures/`，并保留内层 loop 失败签名用于聚合 |
| Harness 后台服务 | `magpie harness-server start|status|stop` | `src/cli/commands/harness-server.ts`、`src/capabilities/workflows/harness-server/` | 常驻队列宿主；负责接单、串行执行当前仓库任务、失败重试和服务重启后的会话恢复；中断中的任务会重新入队并从上一个已保存节点继续；服务级异常会先统一分类，再决定是等待重试、直接失败还是转人工阻塞，相关记录仍会写回对应 harness 会话或仓库级失败索引 |
| IM 回调服务 | `magpie im-server start|status|stop|run` | `src/cli/commands/im-server.ts`、`src/platform/integrations/im/` | 负责飞书回调入口；会读取 `integrations.im` 配置，验证飞书事件、按会话去重，并把人工确认动作转给现有 loop 确认逻辑，或把固定格式的 `/magpie task` 消息、`/magpie form` 表单入口和表单提交统一转成 `loop` / `harness` 新任务；线程映射、去重事件和服务状态保存在仓库 `.magpie/im/` |
| Workflow | `magpie workflow issue-fix|docs-sync|harness|post-merge-regression` | `src/cli/commands/workflow.ts`、`src/capabilities/workflows/` | `workflow harness` 为兼容入口，`docs-sync` 依赖当前可用配置；`workflow issue-fix` 的规划和执行如果命中已知的 Gemini 模型不存在错误，也会自动切到 Kiro 重试当前步骤 |
| 记忆 | `magpie memory show|edit|promote` | `src/cli/commands/memory.ts`、`src/knowledge/`、`src/memory/` | 查看、编辑、提炼长期记忆；项目记忆和仓库知识按仓库统一归并，`loop`/`harness` 正式提炼出的内容会自动同步到项目记忆 |
| TUI | `magpie tui` | `src/cli/commands/tui.ts`、`src/tui/` | 任务工作台；会显示 `harness` 会话的轮次摘要、短原因和选中后的补充摘要；带图谱的 `harness` 会话按 `Enter` 会进入独立图谱工作台，可在里面看整张图的状态分布、逐个浏览节点详情、看到评审/仲裁线索、查看当前注意项和最近事件，也会在节点详情里显示对应阶段文档路径，并直接执行常见批准/拒绝动作或跳到关联会话入口 |
| 初始化 | `magpie init` | `src/cli/commands/init.ts`、`src/platform/config/` | 生成或升级配置 |
| 统计 | `magpie stats` | `src/cli/commands/stats.ts`、`src/capabilities/stats/` | 当前仍偏轻量 |

`trd`、`loop`、`harness` 以及 workflow 会话默认落到当前仓库 `.magpie/sessions/<capability>/<sessionId>/`；`loop` 和 `harness` 现在会在各自会话目录里额外保存 `document-plan.json`，当项目规则判断不稳时把正式文档回退到 `.magpie/project-docs/<sessionId>/`；`harness-server` 额外把后台状态写到 `.magpie/harness-server/state.json`；`im-server` 会把线程映射、回调去重和服务状态写到 `.magpie/im/`；长期记忆和仓库级知识仍走全局 `~/.magpie/`。

统一失败账本约定：

- 会话级失败记录：`.magpie/sessions/<capability>/<sessionId>/failures/*.json`
- 仓库级聚合：`.magpie/failure-index.json`
- 查看顺序：先看具体会话 `failures/`，再看仓库级索引里的重复模式和恢复候选

## 支撑模块

| 模块 | 主要位置 | 负责什么 |
| --- | --- | --- |
| CLI 注册 | `src/cli/program.ts` | 统一挂载所有命令 |
| 运行基础 | `src/core/` | 上下文、状态、仓库访问、辩论等公共能力 |
| 平台集成 | `src/platform/` | 配置、provider、通知、规划、操作集成 |
| 知识与记忆 | `src/knowledge/`、`src/memory/` | 会话知识、长期记忆、提炼与展示 |
| 历史兼容 | `src/commands/`、`src/orchestrator/`、`src/providers/` | 旧路径和兼容逻辑 |

## 改动对照

- 新增或改命令：同时检查 `src/cli/commands/`、本文件、`README.md`
- 改能力行为、会话输出或入口参数：同时检查对应 `src/capabilities/`、本文件和 `ARCHITECTURE.md`
- 改 provider、通知、配置：同时检查 `src/platform/` 与相关说明
- 改知识卡、长期记忆或提炼流程：同时检查 `src/knowledge/`、`src/memory/` 与本文件
- 改较大流程：补 `docs/plans/` 新文档，不要只把结论埋在提交里
