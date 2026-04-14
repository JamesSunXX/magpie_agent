# Capability Reference

这份文档只回答三件事：每类能力是干嘛的、从哪个命令进、主要代码在哪。

## 核心命令

| 能力 | 命令入口 | 主要代码位置 | 备注 |
| --- | --- | --- | --- |
| 评审 | `magpie review` | `src/cli/commands/review.ts`、`src/capabilities/review/` | 支持 PR、本地改动、分支、文件、仓库级扫描；`review --repo` 会把每轮结果写到 `.magpie/state/<sessionId>/round_<N>.json`，启动或恢复时会先对齐已落盘轮次，再从最后一个成功轮次继续；只有全部轮次核齐后才生成最终总结 |
| 讨论 | `magpie discuss` | `src/cli/commands/discuss.ts`、`src/capabilities/discuss/` | 多模型讨论，可选对抗视角 |
| TRD 生成 | `magpie trd` | `src/cli/commands/trd.ts`、`src/capabilities/trd/` | 从 PRD Markdown 生成 TRD，并在仓库 `.magpie/constraints.json` 落一份可机读约束 |
| 闭环执行 | `magpie loop run|resume|inspect|list` | `src/cli/commands/loop.ts`、`src/capabilities/loop/` | 支持 `--host foreground|tmux`，可查看知识摘要；会话开始时会先生成并持久化一份 `document-plan.json`，把正式文档落点和保守回退目录固定下来；进入开发前会先过约束卡点；对适合的小任务会先确认失败测试，再继续实现；测试没过时会区分“继续修”和“执行事故”，按小次数重试后再停到人工介入；阶段评估结果如果只是格式没读出来，会优先自动兜底继续，不再把这类格式问题误挂到人工确认；`unit_mock_test` 遇到旧默认 `tests/mock` 目标但仓库里没有对应测试时会自动跳过，不再因此误判失败；`integration_test` 默认跑仓库现有的 `tests/e2e`，也可以用 `capabilities.loop.commands.integration_test` 覆盖；复杂任务需要独立工作区时会自动准备本地 `.worktrees/` 并写入本地 Git 忽略；自动提交默认用 AI 生成中文提交信息，可用 `capabilities.loop.auto_commit_model` 覆盖模型；新开分支时会优先生成带语义的分支名，并保留时间戳后缀，默认配置走 `capabilities.loop.branch_naming.tool = claw`；`capabilities.loop.mr.enabled` 打开后，会在整条开发和验证成功结束后自动尝试创建 1 个 GitLab MR；如果 MR 创建失败，开发结果仍保持完成，但会单独记录并通知需要人工补做；会为当前会话落角色信息和下一轮最小输入摘要；开启通知后会按阶段发摘要消息；`capabilities.loop.execution_timeout` 可按任务复杂度调整执行超时；内部阶段失败会落到当前 loop 会话的 `failures/` 目录，并同步聚合到仓库 `.magpie/failure-index.json` |
| Harness | `magpie harness submit|resume|status|attach|inspect|approve|reject|list` | `src/cli/commands/harness.ts`、`src/capabilities/workflows/harness/` | 需求到交付的闭环入口；支持 `--host foreground|tmux`；进入 loop 前会先生成或复用会话级 `document-plan.json`，并把同一份文档模式传给内层 loop；后台服务运行时，`submit` 会入队而不是立刻前台执行；前台 `submit` 被 `Ctrl+C` 或系统终止打断时，会先把会话改成可恢复状态再退出；默认评审人和每轮附加检查工具都可通过 `capabilities.harness` 配置，未配置时回退到内置默认值；评审、仲裁和附加检查命中已知的 Gemini 模型不存在错误时，会自动切到 Kiro 重试当前步骤；恢复时会跳过已完成的开发阶段或评审轮次；如果内层 loop 是因为等人工处理而暂停，外层 Harness 也会保持在当前阶段暂停，不再直接记成失败，此时可直接用 `resume` 接着跑；每轮会保留参与者、评审结论、仲裁结果、开放问题和下一步；`status/inspect` 支持 `--cycle` 回看指定轮次；图谱会话已经会显示图谱总览，并支持 `--node <id>` 查看单个节点；`approve/reject` 可以对整张图或指定节点写入批准结果；`list` 也会带出图谱简要状态；开启通知后会按外层阶段发摘要消息；外层 workflow 失败会写进当前 harness 会话的 `failures/`，并保留内层 loop 失败签名用于聚合 |
| Harness 后台服务 | `magpie harness-server start|status|stop` | `src/cli/commands/harness-server.ts`、`src/capabilities/workflows/harness-server/` | 常驻队列宿主；负责接单、串行执行当前仓库任务、失败重试和服务重启后的会话恢复；中断中的任务会重新入队并从上一个已保存节点继续；服务级异常会先统一分类，再决定是等待重试、直接失败还是转人工阻塞，相关记录仍会写回对应 harness 会话或仓库级失败索引 |
| Workflow | `magpie workflow issue-fix|docs-sync|harness|post-merge-regression` | `src/cli/commands/workflow.ts`、`src/capabilities/workflows/` | `workflow harness` 为兼容入口，`docs-sync` 依赖当前可用配置；`workflow issue-fix` 的规划和执行如果命中已知的 Gemini 模型不存在错误，也会自动切到 Kiro 重试当前步骤 |
| 记忆 | `magpie memory show|edit|promote` | `src/cli/commands/memory.ts`、`src/knowledge/`、`src/memory/` | 查看、编辑、提炼长期记忆 |
| TUI | `magpie tui` | `src/cli/commands/tui.ts`、`src/tui/` | 任务工作台；会显示 `harness` 会话的轮次摘要、短原因和选中后的补充摘要；带图谱的 `harness` 会话按 `Enter` 会进入独立图谱工作台，可在里面浏览节点详情、查看当前注意项和最近事件，并直接执行常见批准/拒绝动作或跳到关联会话入口 |
| 初始化 | `magpie init` | `src/cli/commands/init.ts`、`src/platform/config/` | 生成或升级配置 |
| 统计 | `magpie stats` | `src/cli/commands/stats.ts`、`src/capabilities/stats/` | 当前仍偏轻量 |

`trd`、`loop`、`harness` 以及 workflow 会话默认落到当前仓库 `.magpie/sessions/<capability>/<sessionId>/`；`loop` 和 `harness` 现在会在各自会话目录里额外保存 `document-plan.json`，当项目规则判断不稳时把正式文档回退到 `.magpie/project-docs/<sessionId>/`；`harness-server` 额外把后台状态写到 `.magpie/harness-server/state.json`；长期记忆和仓库级知识仍走全局 `~/.magpie/`。

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
