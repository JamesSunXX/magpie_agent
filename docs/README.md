# Magpie Docs

这里是项目文档入口。需要快速了解项目时，按下面顺序看。

## 阅读顺序

1. [`../README.md`](../README.md)：项目是什么，怎么安装，怎么跑常用命令
2. [`../ARCHITECTURE.md`](../ARCHITECTURE.md)：项目怎么分层，改动应该落到哪里
3. [`./references/capabilities.md`](./references/capabilities.md)：每类能力负责什么、主要代码在哪

## 文档地图

| 文档 | 作用 |
| --- | --- |
| [`../README.md`](../README.md) | 快速上手和常用命令 |
| [`../AGENTS.md`](../AGENTS.md) | 做事入口和最重要的工作规则 |
| [`../ARCHITECTURE.md`](../ARCHITECTURE.md) | 总体结构、边界和改动落点 |
| [`./references/capabilities.md`](./references/capabilities.md) | 核心能力与代码位置对照 |
| [`./plans/`](./plans/) | 设计和计划历史 |
| [`./plans/2026-04-21-deer-flow-benchmark-milestone-plan.md`](./plans/2026-04-21-deer-flow-benchmark-milestone-plan.md) | DeerFlow 对标里程碑计划与验收清单（含灰度发布与回退演练） |
| [`./plans/2026-04-13-multi-model-engine-progress-audit.md`](./plans/2026-04-13-multi-model-engine-progress-audit.md) | 当前“多模型工程协作流引擎”进展盘点 |
| [`./plans/2026-04-14-harness-loop-failure-recovery.md`](./plans/2026-04-14-harness-loop-failure-recovery.md) | 失败后继续开发与 provider 会话续跑方案，明确恢复规则、自动接回和遗留现场处理 |
| [`./plans/2026-04-14-harness-loop-failure-recovery-document-first-plan.md`](./plans/2026-04-14-harness-loop-failure-recovery-document-first-plan.md) | 这次失败恢复需求的总实施计划，当前已完成，可从这里看整体进度和阶段结果 |
| [`./plans/2026-04-14-loop-recovery-stage.md`](./plans/2026-04-14-loop-recovery-stage.md) | 第 1 阶段完成记录，说明 loop 如何保留可恢复失败并继续 |
| [`./plans/2026-04-14-harness-recovery-stage.md`](./plans/2026-04-14-harness-recovery-stage.md) | 第 2 阶段完成记录，说明 harness 如何承接 loop 的可恢复失败 |
| [`./plans/2026-04-14-submit-reconnect-stage.md`](./plans/2026-04-14-submit-reconnect-stage.md) | 第 3 阶段完成记录，说明 harness submit 如何自动接回旧会话 |
| [`./plans/2026-04-14-provider-session-reuse-stage.md`](./plans/2026-04-14-provider-session-reuse-stage.md) | 第 4 阶段完成记录，说明如何按角色保存和恢复对话上下文 |
| [`./plans/2026-04-14-verification-and-compat-stage.md`](./plans/2026-04-14-verification-and-compat-stage.md) | 第 5 阶段完成记录，说明兼容性、保留现场和最终验证结果 |
| [`./plans/2026-04-14-panoramic-workbench-continuation-plan.md`](./plans/2026-04-14-panoramic-workbench-continuation-plan.md) | 全景工作台现状、缺口和后续推进顺序 |
| [`./plans/2026-04-14-panoramic-workbench-interaction-spec.md`](./plans/2026-04-14-panoramic-workbench-interaction-spec.md) | 全景工作台交互规格，锁定浏览、详情、动作和事件区规则 |
| [`./plans/2026-04-14-panoramic-workbench-implementation-plan.md`](./plans/2026-04-14-panoramic-workbench-implementation-plan.md) | 全景工作台具体落地计划，按阶段拆到可执行任务和验证命令 |
| [`./channels/`](./channels/) | 渠道或集成的专项说明 |
| [`./channels/feishu-im.md`](./channels/feishu-im.md) | 飞书 IM 人工确认接入说明 |
| [`./superpowers/`](./superpowers/) | 更细的内部设计资料 |

## 什么时候更新哪份文档

- 改安装、启动方式、常用命令：更新 `README.md`
- 改项目结构、主路径、边界：更新 `ARCHITECTURE.md`
- 改能力入口、职责或主要文件位置：更新 `docs/references/capabilities.md`
- 改协作规则或最低交付要求：更新 `AGENTS.md`
- 做较大方案设计或实现规划：在 `docs/plans/` 追加新文档

## 最低要求

- `README.md`、`AGENTS.md`、`ARCHITECTURE.md`、`docs/README.md`、`docs/references/capabilities.md` 必须一直存在
- 这几份入口文档之间必须互相连得上
- 改文档结构后，运行 `npm run check:docs`
