# Capability Reference

这份文档只回答三件事：每类能力是干嘛的、从哪个命令进、主要代码在哪。

## 核心命令

| 能力 | 命令入口 | 主要代码位置 | 备注 |
| --- | --- | --- | --- |
| 评审 | `magpie review` | `src/cli/commands/review.ts`、`src/capabilities/review/` | 支持 PR、本地改动、分支、文件、仓库级扫描 |
| 讨论 | `magpie discuss` | `src/cli/commands/discuss.ts`、`src/capabilities/discuss/` | 多模型讨论，可选对抗视角 |
| TRD 生成 | `magpie trd` | `src/cli/commands/trd.ts`、`src/capabilities/trd/` | 从 PRD Markdown 生成 TRD |
| 闭环执行 | `magpie loop run|resume|inspect|list` | `src/cli/commands/loop.ts`、`src/capabilities/loop/` | 支持 `--host foreground|tmux`，可查看知识摘要；自动提交默认用 AI 生成中文提交信息，可用 `capabilities.loop.auto_commit_model` 覆盖模型；开启通知后会按阶段发摘要消息 |
| Harness | `magpie harness submit|status|attach|inspect|list` | `src/cli/commands/harness.ts`、`src/capabilities/workflows/harness/` | 需求到交付的闭环入口；支持 `--host foreground|tmux`；后台服务运行时，`submit` 会入队而不是立刻前台执行；默认评审人和每轮附加检查工具都可通过 `capabilities.harness` 配置，未配置时回退到内置默认值；恢复时会跳过已完成的开发阶段或评审轮次 |
| Harness 后台服务 | `magpie harness-server start|status|stop` | `src/cli/commands/harness-server.ts`、`src/capabilities/workflows/harness-server/` | 常驻队列宿主；负责接单、串行执行当前仓库任务、失败重试和服务重启后的会话恢复；中断中的任务会重新入队并从上一个已保存节点继续 |
| Workflow | `magpie workflow issue-fix|docs-sync|harness|post-merge-regression` | `src/cli/commands/workflow.ts`、`src/capabilities/workflows/` | `workflow harness` 为兼容入口，`docs-sync` 依赖当前可用配置 |
| 记忆 | `magpie memory show|edit|promote` | `src/cli/commands/memory.ts`、`src/knowledge/`、`src/memory/` | 查看、编辑、提炼长期记忆 |
| TUI | `magpie tui` | `src/cli/commands/tui.ts`、`src/tui/` | 任务工作台 |
| 初始化 | `magpie init` | `src/cli/commands/init.ts`、`src/platform/config/` | 生成或升级配置 |
| 统计 | `magpie stats` | `src/cli/commands/stats.ts`、`src/capabilities/stats/` | 当前仍偏轻量 |

`trd`、`loop`、`harness` 以及 workflow 会话默认落到当前仓库 `.magpie/sessions/<capability>/<sessionId>/`；`harness-server` 额外把后台状态写到 `.magpie/harness-server/state.json`；长期记忆和仓库级知识仍走全局 `~/.magpie/`。

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
