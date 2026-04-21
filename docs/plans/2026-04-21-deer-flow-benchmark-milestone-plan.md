# DeerFlow 对标能力落地 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不破坏 Magpie 现有命令体系的前提下，按里程碑补齐“执行更隔离、能力更按需、后台更可观测、权限更稳妥、飞书链路更闭环”的关键能力。

**Architecture:** 继续沿用现有分层：CLI 只负责入口和展示，能力层承接 `loop` / `harness` / `harness-server` 流程，核心层承接隔离、权限、观测和失败策略，平台层承接配置与飞书集成。每个里程碑都必须有独立开关、独立验证和明确回退方式，避免一次性大重构。

**Tech Stack:** TypeScript、Commander、Vitest、现有 Magpie capability runtime、仓库内 `.magpie/` 会话持久化、现有 Feishu IM 集成

---

## 实施完成标准

- 每个里程碑都能单独交付、单独验证、单独回退。
- 高风险能力默认关闭，必须显式开启后才执行。
- 后台长任务必须能保留现场、记录失败、支持恢复。
- 新增状态、产物和配置必须能通过 `status` / `inspect` / TUI 或文档找到。
- 命令、能力、配置或项目结构变化必须同步更新入口文档。
- 最终验收通过：`npm run test:run`、`npm run test:coverage`、`npm run build`、`npm run lint`、`npm run check:boundaries`、`npm run check:docs`。

## 当前范围冻结

本轮 DeerFlow 对标只保留 5 个方向：

1. 强化执行隔离，优先降低长任务误伤本地环境的风险。
2. 技能和工具按需加载，让任务只带必要能力。
3. 增强后台任务观测，能直接看到进度、失败点和资源消耗。
4. 完善权限、失败暂停和资源保护，避免无效重试或失控执行。
5. IM 只保留飞书链路，继续完善现有飞书发单、确认和状态回写。

明确不进入本轮范围：

- 不扩展 Slack、微信、企业微信、Telegram 等其他 IM 渠道。
- 不把 Magpie 改造成泛用内容生产平台。
- 不为对齐 DeerFlow 重写现有工程闭环架构。

## 现状基线

已经具备的能力：

- `doctor` 已提供环境与配置体检。
- `capabilities.safety.allow_dangerous_commands` 已默认关闭危险命令。
- `loop` / `harness` 已有会话目录、恢复现场、失败账本和上下文压缩。
- 能力启停已通过 `capabilities.<name>.enabled` 接入。
- 飞书链路已支持人工确认、文本发单、表单发单和状态回写。
- `harness-server` 已有后台队列、失败重试和服务状态持久化。

本计划不重复实现这些已有能力，只在其上补齐隔离、按需加载、观测、权限保护和飞书闭环。

## 里程碑总览

| 里程碑 | 目标 | 预计工期 | 完成判定 |
| --- | --- | --- | --- |
| M0 | 基线冻结与回退合同 | 0.5 天 | 范围、开关、验证命令和回退路径固定 |
| M1 | 执行隔离 | 2 天 | 长任务可选择隔离执行，失败后可恢复原现场 |
| M2 | 技能和工具按需加载 | 2 天 | 每个任务只加载声明需要的工具/技能 |
| M3 | 后台任务观测 | 2 天 | 能看到阶段进度、失败点、重试和资源摘要 |
| M4 | 权限、失败暂停和资源保护 | 2 天 | 权限决策、失败预算和资源上限可配置、可解释 |
| M5 | 飞书链路闭环 | 1.5 天 | 飞书线程里能完成发单、确认、状态查看和失败提示 |
| M6 | 总体验收与发布收口 | 1 天 | 文档、测试、构建、回退演练全部通过 |

## 依赖关系

- M0 是所有后续工作的入口。
- M1 是 M3、M4 的前置基础，因为观测和保护需要知道任务运行在哪个执行环境里。
- M2 可与 M1 并行设计，但落地时必须复用 M1 的执行上下文。
- M3 依赖 M1 的执行上下文和现有失败账本。
- M4 依赖 M1 的隔离配置、M2 的工具声明和 M3 的观测事件。
- M5 依赖 M3 的观测摘要和 M4 的权限结果。
- M6 依赖 M1 到 M5 全部完成。

## Milestone 0: 基线冻结与回退合同

**Files:**
- Modify: `docs/plans/2026-04-21-deer-flow-benchmark-milestone-plan.md`
- Modify: `docs/references/capabilities.md`
- Modify: `README.md`

- [x] **Step 1: 固化范围与不做项**
  - 保留 5 个方向：执行隔离、按需加载、后台观测、权限保护、飞书链路。
  - 明确多 IM 渠道、泛内容生产、架构重写不进入本轮。

- [x] **Step 2: 建立配置开关清单**
  - `capabilities.execution_isolation.enabled`
  - `capabilities.tool_loading.enabled`
  - `capabilities.resource_guard.enabled`
  - `integrations.im.enabled`
  - 后台观测是只读增量，不改变执行路径；回退时忽略新增摘要，继续用原会话和失败记录排查。

- [x] **Step 3: 建立基线验证**
  - Run: `npm run test:run`
  - Run: `npm run build`
  - Run: `npm run check:docs`
  - Expected: PASS，作为后续里程碑回归基线。

- [x] **Step 4: 明确回退路径**
  - 任一里程碑异常时，先关闭对应开关，再用 `loop inspect` / `harness inspect` / `harness-server status` / 会话 `failures/` 定位。

**Milestone 0 exit:** 范围、开关、验证和回退合同固定，后续不新增同级目标。

## Milestone 1: 执行隔离

**Files:**
- Modify: `src/platform/config/types.ts`
- Modify: `src/platform/config/init.ts`
- Modify: `src/platform/config/loader.ts`
- Modify: `src/capabilities/workflows/shared/runtime.ts`
- Modify: `src/capabilities/loop/application/execute.ts`
- Modify: `src/capabilities/workflows/harness/application/execute.ts`
- Modify: `src/capabilities/workflows/harness-server/runtime.ts`
- Test: `tests/platform/config/loader.test.ts`
- Test: `tests/capabilities/workflows/shared/runtime.test.ts`
- Test: `tests/capabilities/loop/loop.test.ts`
- Test: `tests/capabilities/workflows/harness.test.ts`
- Test: `tests/capabilities/workflows/harness-server.test.ts`

- [x] **Step 1: 增加隔离配置**
  - 支持 `disabled`、`worktree`、`container` 三种模式。
  - 默认使用 `worktree` 或当前已有兼容路径，不默认启用容器模式。

- [x] **Step 2: 抽出统一执行上下文**
  - 在 shared runtime 里生成执行上下文，包含真实工作目录、会话目录、隔离模式、恢复路径和清理策略。
  - `loop`、`harness`、`harness-server` 只读取这份上下文，不各自拼路径。

- [x] **Step 3: 接入 `loop` 与 `harness`**
  - 新任务创建时记录隔离模式和工作目录。
  - 恢复时必须复用原隔离上下文，不能切到新目录。

- [x] **Step 4: 接入后台服务**
  - `harness-server` 入队、重试、恢复都带上隔离上下文。
  - 失败时记录隔离模式和最后可恢复路径。

- [x] **Step 5: 验证**
  - Run: `npm run test:run -- tests/platform/config/loader.test.ts tests/capabilities/workflows/shared/runtime.test.ts tests/capabilities/loop/loop.test.ts tests/capabilities/workflows/harness.test.ts tests/capabilities/workflows/harness-server.test.ts`
  - Expected: PASS

**Milestone 1 exit:** 长任务可以在明确的隔离上下文中运行，失败后能从同一现场恢复。

## Milestone 2: 技能和工具按需加载

**Files:**
- Modify: `src/platform/config/types.ts`
- Modify: `src/platform/config/init.ts`
- Modify: `src/platform/config/loader.ts`
- Modify: `src/capabilities/routing/index.ts`
- Modify: `src/capabilities/loop/application/execute.ts`
- Modify: `src/capabilities/workflows/harness/application/prepare.ts`
- Modify: `src/capabilities/workflows/harness/application/execute.ts`
- Test: `tests/platform/config/loader.test.ts`
- Test: `tests/capabilities/routing/index.test.ts`
- Test: `tests/capabilities/loop/loop.test.ts`
- Test: `tests/capabilities/workflows/harness.test.ts`

- [x] **Step 1: 定义工具/技能声明格式**
  - 每个能力声明默认需要的工具、可选工具和禁止工具。
  - 配置允许按能力覆盖，不允许任务临时绕过禁用项。

- [x] **Step 2: 路由层生成任务工具清单**
  - `loop`、`harness`、`workflow` 在准备阶段生成本次任务的有效工具清单。
  - 关闭的工具不进入 provider 提示、执行上下文或推荐列表。

- [x] **Step 3: 接入执行阶段**
  - 执行时只把有效工具清单交给 provider 和操作路由。
  - 缺失必需工具时在任务开始前失败，并输出具体修复建议。

- [x] **Step 4: 接入文档与状态输出**
  - `status` / `inspect` 能看到本次任务实际启用的工具。
  - 能力文档说明默认工具和覆盖方式。

- [x] **Step 5: 验证**
  - Run: `npm run test:run -- tests/platform/config/loader.test.ts tests/capabilities/routing/index.test.ts tests/capabilities/loop/loop.test.ts tests/capabilities/workflows/harness.test.ts`
  - Expected: PASS

**Milestone 2 exit:** 每个任务都只加载必要工具，工具缺失或被禁用时能提前失败并说明原因。

## Milestone 3: 后台任务观测

**Files:**
- Modify: `src/core/failures/types.ts`
- Modify: `src/core/failures/ledger.ts`
- Modify: `src/capabilities/workflows/shared/runtime.ts`
- Modify: `src/capabilities/workflows/harness-server/runtime.ts`
- Modify: `src/cli/commands/harness-server.ts`
- Modify: `src/cli/commands/harness.ts`
- Modify: `src/tui/graph-workbench-loader.ts`
- Modify: `src/tui/components/graph-workbench.tsx`
- Test: `tests/core/failures/ledger.test.ts`
- Test: `tests/capabilities/workflows/harness-server.test.ts`
- Test: `tests/cli/harness-server-command.test.ts`
- Test: `tests/tui/graph-workbench-loader.test.ts`

- [x] **Step 1: 定义观测事件**
  - 事件覆盖入队、开始、阶段切换、工具调用摘要、重试、暂停、恢复、完成、失败。
  - 事件必须带 sessionId、阶段、隔离模式、工具清单、耗时和失败引用。

- [x] **Step 2: 后台服务写入观测摘要**
  - `harness-server` 每次状态变化都追加事件。
  - 会话目录保留本任务事件，仓库级状态保留队列摘要。

- [x] **Step 3: CLI 展示观测结果**
  - `harness-server status` 显示队列、当前运行、最近失败、下次重试。
  - `harness inspect` 显示最近阶段、失败点、重试次数和启用工具。

- [x] **Step 4: TUI 展示观测结果**
  - 图谱工作台显示任务状态分布、当前注意项、最近事件和失败摘要。
  - 不读取原始大日志，只读取结构化摘要。

- [x] **Step 5: 验证**
  - Run: `npm run test:run -- tests/core/failures/ledger.test.ts tests/capabilities/workflows/harness-server.test.ts tests/cli/harness-server-command.test.ts tests/tui/graph-workbench-loader.test.ts`
  - Expected: PASS

**Milestone 3 exit:** 后台任务不用翻原始日志，也能看清进度、失败点、重试状态和关键资源摘要。

## Milestone 4: 权限、失败暂停和资源保护

**Files:**
- Modify: `src/platform/config/types.ts`
- Modify: `src/platform/config/init.ts`
- Modify: `src/platform/config/loader.ts`
- Modify: `src/capabilities/workflows/shared/runtime.ts`
- Modify: `src/core/failures/recovery-policy.ts`
- Modify: `src/capabilities/loop/application/execute.ts`
- Modify: `src/capabilities/workflows/harness/application/execute.ts`
- Modify: `src/capabilities/workflows/harness-server/runtime.ts`
- Test: `tests/platform/config/loader.test.ts`
- Test: `tests/capabilities/workflows/shared/runtime.test.ts`
- Test: `tests/core/failures/recovery-policy.test.ts`
- Test: `tests/capabilities/loop/loop.test.ts`
- Test: `tests/capabilities/workflows/harness-server.test.ts`

- [x] **Step 1: 定义权限策略**
  - 配置支持按命令类别、路径范围、工具类别决定允许、拒绝或要求确认。
  - 默认继续拒绝危险命令。

- [x] **Step 2: 定义失败预算**
  - 配置支持单阶段最大重试、单任务最大失败次数、同类失败熔断阈值。
  - 超过预算时进入暂停或人工确认，不继续自动重试。

- [x] **Step 3: 定义资源保护**
  - 配置支持单阶段超时、后台任务最长运行时间、最大并发和最大排队数量。
  - 后台服务在入队和执行前都检查资源限制。

- [x] **Step 4: 接入失败恢复策略**
  - `recovery-policy` 把权限拒绝、失败预算耗尽、资源限制命中区分成不同原因。
  - `status` / `inspect` 给出清楚的暂停原因和下一步动作。

- [x] **Step 5: 验证**
  - Run: `npm run test:run -- tests/platform/config/loader.test.ts tests/capabilities/workflows/shared/runtime.test.ts tests/core/failures/recovery-policy.test.ts tests/capabilities/loop/loop.test.ts tests/capabilities/workflows/harness-server.test.ts`
  - Expected: PASS

**Milestone 4 exit:** 系统能解释为什么放行、拒绝、暂停或重试，并能在失败过多或资源超限时自动停住。

## Milestone 5: 飞书链路闭环

**Files:**
- Modify: `src/platform/integrations/im/feishu/events.ts`
- Modify: `src/platform/integrations/im/feishu/task-command.ts`
- Modify: `src/platform/integrations/im/feishu/task-status.ts`
- Modify: `src/platform/integrations/im/feishu/confirmation-bridge.ts`
- Modify: `src/cli/commands/im-server.ts`
- Modify: `docs/channels/feishu-im.md`
- Test: `tests/platform/integrations/im/feishu/events.test.ts`
- Test: `tests/platform/integrations/im/feishu/task-command.test.ts`
- Test: `tests/platform/integrations/im/feishu/task-status.test.ts`
- Test: `tests/cli/im-server-command.test.ts`

- [x] **Step 1: 明确飞书唯一 IM 范围**
  - 文档和配置里只描述飞书链路。
  - 不新增其他 IM provider、字段或路由。

- [x] **Step 2: 增强飞书状态查询**
  - 飞书线程支持查询任务当前状态。
  - 回复内容来自 M3 结构化观测摘要，不直接拼原始日志。

- [x] **Step 3: 增强失败提示**
  - 任务暂停、失败、等待重试时，飞书回复包含原因、下一步动作和本地 inspect 命令。
  - 发送失败只记录，不影响底层任务状态。

- [x] **Step 4: 增强权限反馈**
  - 白名单外用户点击确认按钮时，飞书线程收到拒绝说明。
  - 权限结果写入事件，便于后续排查。

- [x] **Step 5: 验证**
  - Run: `npm run test:run -- tests/platform/im/feishu-events.test.ts tests/platform/im/feishu-task-command.test.ts tests/platform/im/feishu-task-status.test.ts tests/platform/im/confirmation-bridge.test.ts tests/cli/im-server-command.test.ts`
  - Expected: PASS

**Milestone 5 exit:** 飞书线程能完成发单、确认、状态查看和失败提示；IM 范围仍只保留飞书。

## Milestone 6: 总体验收与发布收口

**Files:**
- Modify: `README.md`
- Modify: `ARCHITECTURE.md`
- Modify: `docs/README.md`
- Modify: `docs/references/capabilities.md`
- Modify: `docs/channels/feishu-im.md`
- Modify: `docs/plans/2026-04-21-deer-flow-benchmark-milestone-plan.md`

- [x] **Step 1: 更新入口文档**
  - README 说明新增开关、推荐启用顺序、回退方式和飞书唯一 IM 范围。
  - capability reference 更新命令入口、状态文件和主要代码位置。

- [x] **Step 2: 更新架构说明**
  - ARCHITECTURE 说明隔离、按需工具、观测、权限保护分别属于哪一层。
  - 文档明确不引入新的 IM 抽象主线。

- [x] **Step 3: 跑总体验收**
  - Run: `npm run test:run`
  - Run: `npm run test:coverage`
  - Run: `npm run build`
  - Run: `npm run lint`
  - Run: `npm run check:boundaries`
  - Run: `npm run check:docs`
  - Expected: 全部 PASS。

- [x] **Step 4: 回退演练**
  - 分别关闭 M1 到 M5 的开关。
  - 确认旧命令路径仍能给出清晰降级提示或回到原行为。

回退演练记录：

| 范围 | 回退方式 | 预期结果 | 覆盖验证 |
| --- | --- | --- | --- |
| M1 执行隔离 | `capabilities.execution_isolation.enabled=false` 或 `mode=disabled` | loop / harness 回到当前工作区执行，并保留旧会话兼容 | `tests/capabilities/workflows/shared/runtime.test.ts`、`tests/capabilities/loop/loop.test.ts`、`tests/capabilities/workflows/harness.test.ts` |
| M2 工具按需加载 | `capabilities.tool_loading.enabled=false` | 不生成强制工具门禁，继续使用原 provider 选择路径 | `tests/capabilities/routing/routing.test.ts`、`tests/capabilities/loop/loop.test.ts`、`tests/capabilities/workflows/harness.test.ts` |
| M3 后台观测 | 不需要关闭；这是只读摘要 | 任务执行不受影响，旧会话仍可从原会话目录和失败记录排查 | `tests/capabilities/workflows/harness-server.test.ts`、`tests/cli/harness-server-command.test.ts`、`tests/tui/graph-workbench-loader.test.ts` |
| M4 权限与资源保护 | `capabilities.resource_guard.enabled=false`，危险命令继续保持默认拦截 | 后台队列不执行新增资源限制；高风险命令仍由 safety 默认保护 | `tests/platform/config/loader.test.ts`、`tests/capabilities/workflows/shared/runtime.test.ts`、`tests/capabilities/workflows/harness-server.test.ts` |
| M5 飞书链路 | `integrations.im.enabled=false` | 飞书入口停止发布状态，底层 loop / harness 会话不受影响 | `tests/platform/im/feishu-task-status.test.ts`、`tests/cli/im-server-command.test.ts` |

**Milestone 6 exit:** 功能、文档、验证和回退全部闭环，可进入灰度。

## 风险与应对

| 风险 | 影响 | 应对 |
| --- | --- | --- |
| 隔离模式影响旧会话恢复 | 旧任务不能续跑 | 恢复时优先读取旧会话 artifacts，缺字段时回退到当前工作区 |
| 工具按需加载误关必要工具 | 任务提前失败 | 必需工具缺失时在准备阶段失败并给出修复建议 |
| 观测事件过多 | 状态文件膨胀 | 保留结构化摘要，原始日志继续放在现有会话目录 |
| 权限策略过严 | 自动化效率下降 | 默认保守，允许按能力显式放开，并输出拒绝原因 |
| 飞书发送失败 | 用户看不到状态 | 发送失败只影响展示，底层会话状态不被回滚 |

## 推荐实施顺序

1. M0 固定范围、开关和回退合同。
2. M1 先补执行隔离，作为后续安全与观测基础。
3. M2 接工具/技能按需加载，减少任务输入和执行面。
4. M3 补后台观测，让长任务能看清状态。
5. M4 补权限、失败暂停和资源保护，让系统能及时停住。
6. M5 收口飞书链路，只增强现有飞书入口。
7. M6 做总体验收、文档和回退演练。
