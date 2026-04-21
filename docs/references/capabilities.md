# Capability Reference

这份文档只回答三件事：每类能力是干嘛的、从哪个命令进、主要代码在哪。

补充约定：常用状态命令、列表、进度输出、统计报表和 TUI 事件里的展示时间统一按当前机器本地时区显示；持久化到 `.magpie/` 的会话与事件时间仍保留 ISO 时间戳。

## 核心命令

| 能力 | 命令入口 | 主要代码位置 | 备注 |
| --- | --- | --- | --- |
| 评审 | `magpie review` | `src/cli/commands/review.ts`、`src/capabilities/review/` | 支持 PR、本地改动、分支、文件、仓库级扫描；`review --repo` 会把每轮结果写到 `.magpie/state/<sessionId>/round_<N>.json`，启动或恢复时会先对齐已落盘轮次，再从最后一个成功轮次继续；只有全部轮次核齐后才生成最终总结 |
| 讨论 | `magpie discuss` | `src/cli/commands/discuss.ts`、`src/capabilities/discuss/` | 多模型讨论，可选对抗视角 |
| TRD 生成 | `magpie trd` | `src/cli/commands/trd.ts`、`src/capabilities/trd/` | 从 PRD Markdown 生成 TRD，并在仓库 `.magpie/constraints.json` 落一份可机读约束 |
| 闭环执行 | `magpie loop run|resume|confirm|inspect|list` | `src/cli/commands/loop.ts`、`src/capabilities/loop/` | 支持 `--host foreground|tmux`，可查看知识摘要；会话开始时会先生成并持久化一份 `document-plan.json`，把正式文档落点和保守回退目录固定下来；正式主线现在是 10 段正式阶段，其中 `milestone_planning` 会在实现前生成 `milestone-plan.json`，每段都会写一张结构化交接卡，`inspect` 会直接打印最新交接卡路径；正式阶段可通过 `capabilities.loop.stage_bindings` 分别配置 `primary / reviewer / rescue`，异常轮次默认继承当前阶段的 `rescue`；进入开发前会先过约束卡点；对适合的小任务会先确认失败测试，再继续实现；测试没过时会区分“继续修”和“执行事故”，按小次数重试后再停到人工介入；如果失败时已经留下可继续的工作区、测试/修复证据和下一步提示，会话会停在可恢复状态而不是直接作废，`loop resume` 会继续沿用原工作区；`unit_mock_test` 默认仍会跑 `unit_test + mock_test`，但如果配置了 `capabilities.loop.commands.unit_mock_test_steps`，会优先按项目自定义步骤执行；`integration_test` 默认跑仓库现有的 `tests/e2e`，也可以用 `capabilities.loop.commands.integration_test` 覆盖；当 `unit_mock_test`、`integration_test` 这类后置验证阶段也留下了原工作区、阶段产物和下一步提示，同样可以直接续跑；后置验证阶段如果仍要求继续修复，会保留现场并把问题重新交回执行节点，而不是直接判成终态失败；`capabilities.loop.human_confirmation.gate_policy = multi_model` 时，普通低把握阶段会先走多模型确认，只有模型明确要求人工、阶段评估直接要求人工，或命中危险命令拦截时才转人工确认；生效的评审人列表必须至少有 2 个不同评审人，`reviewer_ids` 不填时会回退到 `capabilities.discuss.reviewers`，`max_model_revisions` 控制模型要求补改的次数；阶段评估结果如果只是格式没读出来，会优先自动兜底继续，不再把这类格式问题误挂到人工确认；`confirm` 可直接批准或驳回最近一条待处理人工确认，批准后会自动续跑，驳回后会自动发起一轮 discuss 并生成新的短决策卡；确认状态以 loop 会话里的 `humanConfirmations` 为准，`human_confirmation.md` 只保留成摘要投影和旧会话兼容层；运行中如果 `codex` 在阶段执行或阶段评估时超时，当前阶段会自动改用 `kiro` 续跑并记事件；自动提交默认用 AI 生成中文提交信息，可用 `capabilities.loop.auto_commit_model` 覆盖模型；新开分支时会优先生成带语义的分支名，并保留时间戳后缀，默认配置走 `capabilities.loop.branch_naming.tool = claw`；`capabilities.loop.mr.enabled` 打开后，会在整条开发和验证成功结束后自动尝试创建 1 个 GitLab MR；如果 MR 创建失败，开发结果仍保持完成，但会单独记录并通知需要人工补做；会为当前会话按角色保存 provider 会话、角色信息和下一轮最小输入摘要；开启通知后会按阶段发摘要消息，飞书默认用卡片格式并附带项目名与项目路径；前台 `loop run|resume` 会实时打印关键进度（阶段进入、provider 重连错误、TRD 收敛轮次、阶段完成/回退）；`trd_generation` 默认带 `capabilities.loop.trd_convergence` 收敛循环（首轮生成、`discuss` 审查、仲裁 `approved/revise_trd/back_to_prd`、必要时自动回退 `prd_review`），每轮会把审查与仲裁结果落到会话目录，恢复时会从已完成轮次之后继续；`capabilities.loop.execution_timeout` 可按任务复杂度调整执行超时；长流程上下文超过预算时会自动压缩，并把压缩摘要写到会话 `knowledge/summaries/context-compacted.md`；会话已有阶段历史或处于人工确认暂停时，后续会优先使用这份压缩摘要继续执行；内部阶段失败会落到当前 loop 会话的 `failures/` 目录，并同步聚合到仓库 `.magpie/failure-index.json` |
| Harness | `magpie harness submit|resume|confirm|status|attach|inspect|approve|reject|list` | `src/cli/commands/harness.ts`、`src/capabilities/workflows/harness/` | 需求到交付的闭环入口；支持 `--host foreground|tmux`；进入 loop 前会先生成或复用会话级 `document-plan.json`，并把同一份文档模式传给内层 loop；后台服务运行时，`submit` 会入队而不是立刻前台执行；前台 `submit` 被 `Ctrl+C`、`SIGHUP` 或系统终止打断时，会先把会话改成可恢复状态再退出；如果前台进程已经没了但会话还挂着 `in_progress`，`status/list/resume/attach/inspect/approve/reject` 会先自动把它收成 `waiting_next_cycle`；默认评审人和每轮附加检查工具都可通过 `capabilities.harness` 配置，未配置时回退到内置默认值；评审、仲裁和附加检查命中已知的 Gemini 模型不存在错误时，会自动切到 Kiro 重试当前步骤；进入内层 `loop` 时会继续把内层确认策略压成 `manual_only`，避免和外层评审闭环重复；恢复时会跳过已完成的开发阶段或评审轮次；如果内层 loop 失败但已经留下可恢复检查点，外层 Harness 会停在 `blocked` 并保留原工作区、分支和文档，`resume` 会继续原开发阶段；如果内层 loop 是因为等人工处理而暂停，外层 Harness 也会保持在当前阶段暂停，不再直接记成失败，此时可直接用 `resume` 接着跑；旧会话就算外层自己已经写成 `failed`，只要关联的内层 loop 还保留着可信的继续线索，`harness resume` 也会直接接回原会话；`confirm` 会处理关联 loop 的最近一条待处理人工确认，批准后自动恢复 harness，驳回后自动发起 discuss 并生成新的短决策卡；关联的真实确认状态仍保存在 loop 会话里，`human_confirmation.md` 只保留成摘要和旧会话兼容层；重新执行同目标、同 PRD 的 `harness submit` 时，会自动接回最近一条可恢复会话，避免重复开单；每轮会保留参与者、评审结论、仲裁结果、开放问题和下一步，并按角色持久化可恢复的 provider 会话；`status/inspect` 支持 `--cycle` 回看指定轮次；图谱会话已经会显示图谱总览，并支持 `--node <id>` 查看单个节点；当前对 `docs/plans/2026-04-14-harness-loop-failure-recovery-document-first-plan.md` 这条特定文档链路还有一套额外的图谱展开规则，会把它映射成 5 个真实阶段节点，并把对应阶段文档路径带到节点详情；`approve/reject` 可以对整张图或指定节点写入批准结果；`list` 也会带出图谱简要状态；开启通知后会按外层阶段发摘要消息，飞书默认用卡片格式并附带项目名与项目路径 |
| Harness 后台服务 | `magpie harness-server start|status|stop` | `src/cli/commands/harness-server.ts`、`src/capabilities/workflows/harness-server/` | 常驻队列宿主；负责接单、串行执行当前仓库任务、失败重试和服务重启后的会话恢复；中断中的任务会重新入队并从上一个已保存节点继续；服务级异常会先统一分类，再决定是等待重试、直接失败还是转人工阻塞，相关记录仍会写回对应 harness 会话或仓库级失败索引；开启 `capabilities.resource_guard` 后会限制排队和并发，并在失败预算耗尽时暂停；`status` 会显示当前任务、下次重试、最近失败、最近事件和启用工具 |
| IM 回调服务 | `magpie im-server start|status|stop|run` | `src/cli/commands/im-server.ts`、`src/platform/integrations/im/` | 负责飞书回调入口；会读取 `integrations.im` 配置，验证飞书事件、按会话去重，并把人工确认动作转给现有 loop 确认逻辑，或把固定格式的 `/magpie task` 消息、`/magpie form` 表单入口和表单提交统一转成 `loop` / `harness` 新任务；任务线程支持 `/magpie status` 查询结构化状态、失败原因、下一步动作和 inspect 命令；新任务会先在用户当前发消息的群里创建线程并绑定对应会话；如果会话已经有现成线程，人工确认时会直接复用原线程；只有没有现成线程、或需要兜底时，才会用 `default_chat_id` 对应的默认群；白名单外确认动作会在线程里说明拒绝原因，并写入 `.magpie/im/events.jsonl`；表单字段是 `type / goal / prd / priority`，其中 `type`、`goal` 和 `prd` 都必填，`type` 只接受 `small / formal`，`priority` 只对 `formal` 任务有意义且只接受 `interactive / high / normal / background`，其他值会被拒绝；线程映射、去重事件、控制事件和服务状态保存在仓库 `.magpie/im/` |
| 统一状态 | `magpie status` | `src/cli/commands/status.ts`、`src/capabilities/workflows/shared/status-summary.ts`、`src/core/status/` | 聚合最近 loop / harness 任务，显示运行、等待、失败、完成、排队数量，以及每条任务的阶段、失败原因和下一步动作；飞书状态回复复用同一套摘要规则 |
| 技能管理 | `magpie skills list|inspect|enable|disable` | `src/cli/commands/skills.ts`、`src/core/skills/` | 管理本地内置任务技能；技能包含用途、适用能力和依赖工具；`loop` / `harness` 的 `tool-manifest.json` 会记录本次任务技能，缺少必需工具时会在任务开始前停止；全局技能默认关闭时，单独启用的技能也会参与任务前检查 |
| 飞书知识库同步 | 代码调用 | `src/platform/integrations/wiki/` | 读取和写入飞书知识库文档；用于把 TRD 等产物同步到对应的飞书文档；需要 `wiki:node:read`、`wiki:wiki`、`wiki:wiki:readonly` 权限；配置在 `integrations.wiki`；详见 [`docs/channels/feishu-wiki.md`](../channels/feishu-wiki.md) |
| Workflow | `magpie workflow issue-fix|docs-sync|harness|post-merge-regression` | `src/cli/commands/workflow.ts`、`src/capabilities/workflows/` | `workflow harness` 为兼容入口，`docs-sync` 依赖当前可用配置；`workflow issue-fix` 的规划和执行如果命中已知的 Gemini 模型不存在错误，也会自动切到 Kiro 重试当前步骤 |
| 记忆 | `magpie memory show|edit|promote` | `src/cli/commands/memory.ts`、`src/knowledge/`、`src/memory/` | 查看、编辑、提炼长期记忆；项目记忆和仓库知识按仓库统一归并，`loop`/`harness` 正式提炼出的内容会自动同步到项目记忆；同步前会过滤不稳定条目（例如 `maybe`/`TBD`/`待确认`/`可能` 等不确定表达） |
| TUI | `magpie tui` | `src/cli/commands/tui.ts`、`src/tui/` | 任务工作台；会显示 `harness` 会话的轮次摘要、协作模板、角色职责、短原因和选中后的补充摘要；带图谱的 `harness` 会话按 `Enter` 会进入独立图谱工作台，可在里面看整张图的状态分布、逐个浏览节点详情、看到评审/仲裁线索、查看当前注意项和最近事件，也会在节点详情里显示对应阶段文档路径，并直接执行常见批准/拒绝动作或跳到关联会话入口 |
| 初始化 | `magpie init` | `src/cli/commands/init.ts`、`src/platform/config/` | 生成或升级配置 |
| 环境体检 | `magpie doctor` | `src/cli/commands/doctor.ts`、`src/capabilities/stats/application/doctor.ts` | 检查配置文件、配置版本、配置合法性、所需 CLI 命令和 API 密钥，并输出可执行修复建议、整体可用状态和下一步动作 |
| 统计 | `magpie stats` | `src/cli/commands/stats.ts`、`src/capabilities/stats/` | 当前仍偏轻量 |

命令执行安全由 `capabilities.safety` 控制，默认 `allow_dangerous_commands: false`，危险命令会直接拦截；`permission_policy` 可按命令类别、路径范围和工具类别配置放行、拒绝或确认。执行隔离由 `capabilities.execution_isolation` 控制，默认关闭，支持 `disabled / worktree / container` 三种模式；当前 `worktree` 会接入现有 worktree 执行路径，`container` 先作为可配置模式和会话上下文记录。工具按需加载由 `capabilities.tool_loading` 控制，默认关闭；开启后 `loop` / `harness` 会在会话目录写入 `tool-manifest.json`，并在必需工具被禁用或不可用时提前停止。技能管理由 `capabilities.skills` 控制，默认本地开发场景关闭，团队协作和后台托管场景会启用技能记录和门禁；如果通过 `magpie skills enable` 单独启用技能，该技能也会参与任务前检查。资源保护由 `capabilities.resource_guard` 控制，默认关闭；开启后后台 harness 会检查排队、并发和失败预算。

`review`、`discuss`、`trd`、`loop`、`harness`、`workflow` 下的扩展流程，以及 `quality unit-test-eval` 支持按能力开关（`capabilities.<name>.enabled`）控制；关闭时命令入口会给统一降级提示（当前关闭、开启方式、替代路径）。

`trd`、`loop`、`harness` 以及 workflow 会话默认落到当前仓库 `.magpie/sessions/<capability>/<sessionId>/`；`loop` 和 `harness` 现在会在各自会话目录里额外保存 `document-plan.json` 和 `tool-manifest.json`，当项目规则判断不稳时把正式文档回退到 `.magpie/project-docs/<sessionId>/`；`loop` 会在 `knowledge/summaries/context-compacted.md` 保存最近一次压缩后的上下文摘要，并在后续续跑时优先复用；`loop` 的 TRD 收敛循环会把状态快照写到 `trd-convergence/state.json`，并把每轮审查与仲裁写到 `trd-convergence/cycle-*/`（重新进场时会按 `pass-*` 分目录归档）；`harness-server` 额外把后台状态写到 `.magpie/harness-server/state.json`，并从会话 `events.jsonl`、`tool-manifest.json`、`failures/` 聚合观测摘要；`im-server` 会把线程映射、回调去重和服务状态写到 `.magpie/im/`；长期记忆和仓库级知识仍走全局 `~/.magpie/`。

灰度与回退建议：先小范围开启 `loop`/`harness`/`workflow`，并保持 `capabilities.safety.allow_dangerous_commands=false`；出现异常时优先把对应能力 `enabled` 改回 `false`，再用会话目录和 `failures/` 记录定位问题。

DeerFlow 对标里程碑只保留执行隔离、技能和工具按需加载、后台任务观测、权限与资源保护、飞书链路闭环这五项；IM 范围只包含飞书。新增能力按开关灰度：`capabilities.execution_isolation.enabled`、`capabilities.tool_loading.enabled`、`capabilities.resource_guard.enabled`、`integrations.im.enabled`。后台任务观测是只读增量，不改变任务执行；回退时直接忽略新增摘要，继续查看原会话目录。排查时先看 `loop inspect`、`harness inspect`、`harness-server status` 和会话 `failures/`。

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
