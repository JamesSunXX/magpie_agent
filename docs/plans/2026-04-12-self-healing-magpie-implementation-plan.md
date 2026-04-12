# Self-Healing Magpie Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给 `loop`、`harness`、`harness-server` 补齐统一失败账本、失败分类和自修触发前的最小恢复底座。

**Architecture:** 先不做完整自修流程，先把“谁在何时判失败、失败怎样落盘、如何聚合成统一视图”这条链补齐。第一版把失败观测和恢复决策抽到共享模块，再把 `loop`、`harness`、`harness-server` 接到同一套结构上，为后续独立自修支线做输入准备。

**Tech Stack:** TypeScript、Vitest、现有 capability runtime、仓库内 `.magpie/sessions/` 持久化、仓库级 `.magpie/` 元数据文件。

---

## 目标边界

- 只实现统一失败事件、失败账本、失败分类和基础恢复决策
- 只改 `loop`、`harness`、`harness-server` 三条主路径
- 只补“自修前置底座”，不在本计划内实现完整 `workflow_self_repair`
- 只增加仓库内可追踪的失败聚合，不引入外部服务

## 当前失败信号与接入点

### 现状结论

- `loop` 自己判内部阶段失败，并把 session 写成 `failed`
- `harness` 作为外层工作流控制器，接住 `loop` 结果并决定是 `blocked` 还是 `failed`
- `harness-server` 只负责排队、托管、少量重试和服务级异常恢复，不负责细分业务失败原因

### 第一批必须接入的现有位置

- [src/capabilities/loop/application/execute.ts](/Users/sunchenhui/.codex/worktrees/193a/magpie/src/capabilities/loop/application/execute.ts)
  - `markSessionFailed`
  - 红灯测试失败后的暂停分支
  - 绿灯测试失败后的修复 / 重试分支
- [src/capabilities/workflows/harness/application/execute.ts](/Users/sunchenhui/.codex/worktrees/193a/magpie/src/capabilities/workflows/harness/application/execute.ts)
  - `loop` 返回非完成状态时
  - review cycle 抛错时
  - 最终未获批准时
- [src/capabilities/workflows/harness-server/runtime.ts](/Users/sunchenhui/.codex/worktrees/193a/magpie/src/capabilities/workflows/harness-server/runtime.ts)
  - `runHarnessServerOnce` 中队列任务 claim 失败
  - `runCapability(harnessCapability, ...)` 抛错
  - `retryable` 与 `failed` 分支切换点

## 文件拆分

### 现有文件，预计修改

- `src/state/types.ts`
  - 增加统一失败事件、失败签名、恢复状态字段
- `src/capabilities/loop/application/execute.ts`
  - 接入统一失败记录与分类
- `src/capabilities/workflows/harness/application/execute.ts`
  - 把外层失败和内层 `loop` 失败映射到统一结构
- `src/capabilities/workflows/harness-server/runtime.ts`
  - 接入仓库级失败账本和服务级恢复决策
- `src/capabilities/workflows/shared/runtime.ts`
  - 增加 workflow 级失败事件持久化辅助能力
- `src/knowledge/runtime.ts`
  - 增强失败模式的升级入口，让重复失败可沉淀
- `docs/references/capabilities.md`
  - 更新失败观测与恢复职责说明
- `README.md`
  - 补充失败排查和恢复相关说明

### 新文件，建议创建

- `src/core/failures/types.ts`
  - 统一失败事件、失败分类、恢复动作结构
- `src/core/failures/classifier.ts`
  - 把现有失败信号归类为 `transient` / `environment` / `quality` / `prompt_or_parse` / `workflow_defect` / `unknown`
- `src/core/failures/ledger.ts`
  - 会话级失败写入与仓库级失败索引聚合
- `src/core/failures/recovery-policy.ts`
  - 第一版自动处理动作：重试、退避、诊断、降级、候选自修
- `src/core/failures/diagnostics.ts`
  - 环境与状态一致性最小诊断

### 测试文件，建议创建或扩充

- `tests/core/failures/classifier.test.ts`
- `tests/core/failures/ledger.test.ts`
- `tests/core/failures/recovery-policy.test.ts`
- `tests/capabilities/loop/loop.test.ts`
- `tests/capabilities/workflows/harness.test.ts`
- `tests/capabilities/workflows/harness-server.test.ts`
- `tests/state/state-manager.test.ts`

## Phase 1：统一失败结构

### Task 1：定义统一失败事件和恢复动作

**Files:**
- Create: `src/core/failures/types.ts`
- Modify: `src/state/types.ts`
- Test: `tests/core/failures/classifier.test.ts`
- Test: `tests/state/state-manager.test.ts`

- [ ] 定义 `FailureCategory`，固定只包含：
  - `transient`
  - `environment`
  - `quality`
  - `prompt_or_parse`
  - `workflow_defect`
  - `unknown`
- [ ] 定义 `RecoveryAction`，固定只包含：
  - `retry_same_step`
  - `retry_with_backoff`
  - `run_diagnostics`
  - `degrade_path`
  - `spawn_self_repair_candidate`
  - `block_for_human`
- [ ] 定义 `FailureRecord` 最小字段：
  - `id`
  - `sessionId`
  - `capability`
  - `stage`
  - `timestamp`
  - `signature`
  - `category`
  - `reason`
  - `retryable`
  - `selfHealCandidate`
  - `lastReliablePoint`
  - `evidencePaths`
  - `metadata`
- [ ] 给 `LoopSession` 增加失败产物路径字段：
  - `artifacts.failureLogDir`
  - `artifacts.failureIndexPath`
- [ ] 给 `WorkflowSession.artifacts` 增加同类字段，确保 `harness` 和 `harness-server` 也能落统一失败记录
- [ ] 运行：
  - `npm run test:run -- tests/state/state-manager.test.ts`

## Phase 2：失败分类器

### Task 2：把现有失败信号映射到统一分类

**Files:**
- Create: `src/core/failures/classifier.ts`
- Modify: `src/capabilities/loop/domain/test-execution.ts`
- Test: `tests/core/failures/classifier.test.ts`
- Test: `tests/capabilities/loop/test-execution.test.ts`

- [ ] 先写分类测试，覆盖：
  - 包含 `timeout` / `timed out` -> `transient`
  - 包含 `429` / `rate limit` -> `transient`
  - 包含 `command not found` / `enoent` -> `environment`
  - 测试失败但命令正常执行 -> `quality`
  - 解析 JSON 失败 / 格式缺失 -> `prompt_or_parse`
  - 恢复点缺失 / 状态不一致 -> `workflow_defect`
  - 其余 -> `unknown`
- [ ] 复用 `loop` 现有测试结果分类，不重复造一套判断
- [ ] 增加失败签名生成规则，第一版由以下字段拼出稳定摘要：
  - `capability`
  - `stage`
  - `category`
  - 归一化后的首个关键报错
- [ ] 保证签名能把“同类重复失败”归到一起，但不会把不同问题混成一类
- [ ] 运行：
  - `npm run test:run -- tests/core/failures/classifier.test.ts tests/capabilities/loop/test-execution.test.ts`

## Phase 3：失败账本

### Task 3：实现会话级失败落盘和仓库级聚合

**Files:**
- Create: `src/core/failures/ledger.ts`
- Modify: `src/capabilities/workflows/shared/runtime.ts`
- Test: `tests/core/failures/ledger.test.ts`

- [ ] 先写失败账本测试，覆盖：
  - 单条失败能落到 session 目录
  - 同一仓库的失败能更新 `.magpie/failure-index.json`
  - 重复签名会累加计数而不是重复建独立主题
  - 不同 capability 的相同签名也能聚合
- [ ] 统一第一版落盘位置：
  - session 级：`<sessionDir>/failures/<failureId>.json`
  - repo 级：`.magpie/failure-index.json`
- [ ] 为仓库级索引增加最小聚合字段：
  - `signature`
  - `count`
  - `firstSeenAt`
  - `lastSeenAt`
  - `lastSessionId`
  - `categories`
  - `candidateForSelfRepair`
- [ ] 为 `appendWorkflowEvent` 所在路径补一个失败写入辅助函数，避免 `loop`、`harness`、`harness-server` 各自拼路径
- [ ] 运行：
  - `npm run test:run -- tests/core/failures/ledger.test.ts`

## Phase 4：把 loop 接到统一失败账本

### Task 4：给 loop 的主要失败点统一写失败记录

**Files:**
- Modify: `src/capabilities/loop/application/execute.ts`
- Test: `tests/capabilities/loop/loop.test.ts`

- [ ] 在 `markSessionFailed` 里写统一失败记录，至少带上：
  - 当前 stage
  - 原因
  - 最后可靠点
  - 当前关键产物路径
- [ ] 在红灯测试命令无法正常执行时，记录一条 `environment` 或 `transient` 失败，而不是只暂停
- [ ] 在绿灯测试失败进入 `repair_required` / `execution_retry_required` 时，也记录失败条目，不能只写 repair artifact
- [ ] 在恢复校验失败时，统一记为 `workflow_defect`
- [ ] 保持现有 `paused_for_human` / `failed` 语义不变，不在这一步改变外部行为
- [ ] 运行：
  - `npm run test:run -- tests/capabilities/loop/loop.test.ts`

## Phase 5：把 harness 接到统一失败账本

### Task 5：让 harness 能区分“loop 失败”和“harness 自己失败”

**Files:**
- Modify: `src/capabilities/workflows/harness/application/execute.ts`
- Test: `tests/capabilities/workflows/harness.test.ts`

- [ ] 在 `loopResult.result.status !== 'completed'` 分支里增加失败映射：
  - `paused` / `paused_for_human` 不记为失败
  - `failed` 需要把 `loop` 的失败摘要写成一条 `harness` 级失败记录，并带上 `loopSessionId`
- [ ] review cycle 抛错时，记一条 `workflow_defect` 或 `unknown` 失败
- [ ] 最终多轮未获批准时，记一条 `quality` 失败，而不是只给最终摘要
- [ ] 如果 `harness` 是因为 `loop` 连续相同签名失败而失败，保留源签名到 metadata，方便仓库级聚合
- [ ] 运行：
  - `npm run test:run -- tests/capabilities/workflows/harness.test.ts`

## Phase 6：把 harness-server 接到统一失败账本

### Task 6：补 server 级失败聚合与服务级恢复决策

**Files:**
- Modify: `src/capabilities/workflows/harness-server/runtime.ts`
- Create: `src/core/failures/recovery-policy.ts`
- Create: `src/core/failures/diagnostics.ts`
- Test: `tests/core/failures/recovery-policy.test.ts`
- Test: `tests/capabilities/workflows/harness-server.test.ts`

- [ ] 先写恢复决策测试，固定第一版规则：
  - `transient` -> `retry_with_backoff`
  - `environment` -> `run_diagnostics`
  - `quality` -> `block_for_human`
  - `prompt_or_parse` 重复出现 -> `spawn_self_repair_candidate`
  - `workflow_defect` -> `spawn_self_repair_candidate`
- [ ] 在 `runHarnessServerOnce` 的异常分支里，不再只靠 `isRetryableHarnessError`
- [ ] 对服务级错误先走统一分类，再由恢复决策决定：
  - `waiting_retry`
  - `failed`
  - `blocked`
- [ ] 给 `run_diagnostics` 留最小实现，至少检查：
  - 配置是否存在
  - 会话输入元数据是否存在
  - 当前 repo 的关键路径是否还在
- [ ] 当恢复决策给出 `spawn_self_repair_candidate` 时，第一版只落一条候选记录到索引，不直接开修复任务
- [ ] 运行：
  - `npm run test:run -- tests/core/failures/recovery-policy.test.ts tests/capabilities/workflows/harness-server.test.ts`

## Phase 7：长期失败模式升级

### Task 7：把重复失败升级为稳定失败模式

**Files:**
- Modify: `src/knowledge/runtime.ts`
- Test: `tests/knowledge/runtime.test.ts`

- [ ] 明确“重复失败”的第一版门槛：
  - 同一签名累计至少 2 次
  - 且最近一次仍未解决
- [ ] 从 `.magpie/failure-index.json` 生成可升级的 `failure-pattern` 候选
- [ ] 把 `candidateForSelfRepair` 一并带入候选摘要，方便后续自修工作流读取
- [ ] 保持现有 `decision` / `failure-pattern` 规则兼容，不破坏旧路径
- [ ] 运行：
  - `npm run test:run -- tests/knowledge/runtime.test.ts`

## Phase 8：文档与入口说明

### Task 8：更新对外说明，讲清“谁判失败、谁托管、谁恢复”

**Files:**
- Modify: `README.md`
- Modify: `docs/references/capabilities.md`

- [ ] 在 `README.md` 补一段简洁说明：
  - `loop` 自己判内部失败
  - `harness` 负责整体工作流状态
  - `harness-server` 负责后台托管、排队和服务级恢复
- [ ] 在 `docs/references/capabilities.md` 增加统一失败账本与恢复职责说明
- [ ] 运行：
  - `npm run check:docs`

## 建议验证顺序

按下面顺序跑，避免一次性排查太多问题：

1. `npm run test:run -- tests/core/failures/classifier.test.ts tests/core/failures/ledger.test.ts tests/core/failures/recovery-policy.test.ts`
2. `npm run test:run -- tests/capabilities/loop/loop.test.ts tests/capabilities/workflows/harness.test.ts tests/capabilities/workflows/harness-server.test.ts`
3. `npm run test:run -- tests/knowledge/runtime.test.ts tests/state/state-manager.test.ts`
4. `npm run build`
5. `npm run check:docs`

## 交付顺序建议

建议严格按这个顺序执行，不要跳步：

1. 统一类型
2. 分类器
3. 失败账本
4. loop 接入
5. harness 接入
6. harness-server 接入
7. 长期失败模式升级
8. 文档更新

## 暂不实现的内容

以下内容明确不在本计划内：

- 自动创建并执行 `workflow_self_repair`
- 自动创建分支、提交和合并
- 自修后的自动回滚
- 跨仓库失败聚合

先把失败观测和恢复底座做稳，再往上叠完整自修流程。
