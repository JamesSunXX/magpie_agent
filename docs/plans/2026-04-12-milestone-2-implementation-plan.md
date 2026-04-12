# Milestone 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给 `trd` 和 `loop` 补齐“机器可读约束 + 测试先行 + 自动修复”的单任务质量闭环内核。

**Architecture:** 先把约束产物和状态结构固定下来，再把 `loop` 的执行流程拆成约束校验、红灯测试确认、实现生成、测试执行、失败修复五段。后台常驻、队列、并发和恢复调度不在本计划内，只复用这里定义的状态和产物。

**Tech Stack:** TypeScript、Vitest、现有 capability runtime、仓库内 `.magpie/sessions/` 会话目录。

---

## 目标边界

- 只覆盖 `magpie trd` 和 `magpie loop`
- 只做单任务质量闭环，不做 `harness-server`
- 只覆盖可本地验证的简单任务类型
- 共享状态命名和产物格式，供未来长期运行方案复用

## 文件拆分

### 现有文件，预计修改

- `src/capabilities/trd/types.ts`
  - 扩充 TRD 运行结果和约束产物描述
- `src/capabilities/trd/runtime/flow.ts`
  - 生成并落盘 `.magpie/constraints.json`
- `src/state/types.ts`
  - 扩充 `TrdSession`、`LoopSession` 的状态和产物字段
- `src/state/state-manager.ts`
  - 确保新增状态字段能稳定落盘和读取
- `src/capabilities/loop/types.ts`
  - 扩充 loop 执行结果和新增状态语义
- `src/capabilities/loop/application/execute.ts`
  - 接入约束校验、TDD 钩子、测试执行、修复重试
- `README.md`
  - 更新 `trd` / `loop` 的新行为说明
- `docs/references/capabilities.md`
  - 更新 `trd` / `loop` 的职责说明

### 新文件，建议创建

- `src/capabilities/trd/domain/constraints.ts`
  - 约束结构定义、最小规则映射、序列化
- `src/capabilities/loop/domain/constraints.ts`
  - `loop` 侧约束加载、计划层和结果层校验
- `src/capabilities/loop/domain/tdd.ts`
  - TDD 适用性判断、测试目标说明、红灯确认
- `src/capabilities/loop/domain/test-execution.ts`
  - 本地测试执行、结果结构化、失败证据提取
- `src/capabilities/loop/domain/repair.ts`
  - 修复重试计数、事故重试计数、状态推进

### 测试文件，建议创建或扩充

- `tests/capabilities/trd/constraints.test.ts`
- `tests/capabilities/trd/execute.test.ts`
- `tests/capabilities/loop/constraints.test.ts`
- `tests/capabilities/loop/tdd.test.ts`
- `tests/capabilities/loop/test-execution.test.ts`
- `tests/capabilities/loop/repair.test.ts`
- `tests/capabilities/loop/loop.test.ts`
- `tests/state/state-manager.test.ts`

## Phase 1：约束产物落地

### Task 1：定义约束数据结构

**Files:**
- Create: `src/capabilities/trd/domain/constraints.ts`
- Modify: `src/capabilities/trd/types.ts`
- Modify: `src/state/types.ts`
- Test: `tests/capabilities/trd/constraints.test.ts`

- [ ] 明确第一版约束对象结构：`version`、`sourceTrdPath`、`generatedAt`、`rules`
- [ ] 明确 `rule` 的最小字段：`id`、`category`、`description`、`severity`、`scope`、`checkType`、`expected`、`forbidden`
- [ ] 在 `TrdSession.artifacts` 里补一个约束产物路径字段，避免后续只能靠固定路径猜
- [ ] 先写 `constraints` 相关单元测试，覆盖：
  - 规则对象能序列化
  - 缺字段对象不会被当成有效约束
  - 最小规则集合能落成稳定 JSON
- [ ] 运行：`npm run test:run -- tests/capabilities/trd/constraints.test.ts`

### Task 2：让 `trd` 真正产出 `.magpie/constraints.json`

**Files:**
- Modify: `src/capabilities/trd/runtime/flow.ts`
- Modify: `src/capabilities/trd/application/execute.ts`
- Modify: `src/state/state-manager.ts`
- Test: `tests/capabilities/trd/execute.test.ts`
- Test: `tests/state/state-manager.test.ts`

- [ ] 在 `runTrdFlow` 里增加约束产物路径计算，统一落到当前仓库 `.magpie/constraints.json`
- [ ] 先写失败测试，验证 `executeTrd` 完成后能在仓库内找到约束文件路径
- [ ] 实现最小落盘逻辑，先覆盖第一版支持的 4 类规则：
  - 依赖限制
  - 路径规范
  - API 约束
  - 测试要求
- [ ] 把约束文件路径写进 `TrdSession.artifacts`
- [ ] 增加“没有可提取约束时也要落一个空规则文件”的分支测试，避免后续 `loop` 读不到文件
- [ ] 运行：
  - `npm run test:run -- tests/capabilities/trd/execute.test.ts tests/state/state-manager.test.ts`

## Phase 2：`loop` 约束卡点

### Task 3：补 `loop` 侧约束加载和校验器

**Files:**
- Create: `src/capabilities/loop/domain/constraints.ts`
- Modify: `src/capabilities/loop/types.ts`
- Modify: `src/state/types.ts`
- Test: `tests/capabilities/loop/constraints.test.ts`

- [ ] 定义 `ConstraintCheckResult`，固定只有 `pass`、`needs_revision`、`blocked`
- [ ] 先写失败测试，覆盖：
  - 无约束文件时返回“可继续但无规则”
  - 命中禁止依赖时返回 `blocked`
  - 命中模糊路径规则时返回 `needs_revision`
  - 全部满足时返回 `pass`
- [ ] 实现约束加载逻辑，固定从仓库内 `.magpie/constraints.json` 和当前任务快照读取
- [ ] 实现计划层校验和结果层校验的统一输出结构，避免后续 `execute.ts` 自己拼字符串
- [ ] 运行：`npm run test:run -- tests/capabilities/loop/constraints.test.ts`

### Task 4：把约束卡点接进 `loop` 执行流程

**Files:**
- Modify: `src/capabilities/loop/application/execute.ts`
- Modify: `src/state/types.ts`
- Modify: `src/state/state-manager.ts`
- Test: `tests/capabilities/loop/loop.test.ts`

- [ ] 先写失败测试，验证 `loop` 在真正改代码前会先做计划层约束校验
- [ ] 为 `LoopSession` 增加最小状态字段：
  - `constraintsValidated`
  - `constraintCheckStatus`
  - `lastReliablePoint`
  - `lastFailureReason`
- [ ] 当校验结果为 `needs_revision` 时，流程停在“继续生成更合规结果”，但不进入实现提交
- [ ] 当校验结果为 `blocked` 时，流程进入明确的人类介入状态，不得继续执行
- [ ] 补测试覆盖“产出后再次校验”的分支，防止先过计划层、后在结果层违反约束
- [ ] 运行：`npm run test:run -- tests/capabilities/loop/loop.test.ts`

## Phase 3：TDD 内核

### Task 5：补 TDD 适用性判断和红灯确认

**Files:**
- Create: `src/capabilities/loop/domain/tdd.ts`
- Modify: `src/capabilities/loop/application/execute.ts`
- Test: `tests/capabilities/loop/tdd.test.ts`
- Test: `tests/capabilities/loop/loop.test.ts`

- [ ] 定义第一版 TDD 适用范围判断：
  - 纯函数
  - 数据转换
  - 工具函数
  - 轻量服务层逻辑
- [ ] 先写失败测试，覆盖：
  - 适用任务会进入 TDD
  - 不适用任务不会被强制卡进 TDD
  - 测试初始即通过时，不会误判为“已经完成”
- [ ] 增加 `tdd/target.md` 产物，用来记录测试目标和成功标准
- [ ] 在 `loop` 执行里插入红灯确认步骤，只有“确认失败”后才允许继续实现
- [ ] 为 `LoopSession` 增加 `redTestConfirmed` 和 `tddEligible` 状态
- [ ] 运行：
  - `npm run test:run -- tests/capabilities/loop/tdd.test.ts tests/capabilities/loop/loop.test.ts`

### Task 6：补本地测试执行与结果结构化

**Files:**
- Create: `src/capabilities/loop/domain/test-execution.ts`
- Modify: `src/capabilities/loop/application/execute.ts`
- Modify: `src/state/types.ts`
- Test: `tests/capabilities/loop/test-execution.test.ts`
- Test: `tests/capabilities/loop/loop.test.ts`

- [ ] 先写失败测试，固定测试执行结果最小结构：
  - `command`
  - `startedAt`
  - `finishedAt`
  - `exitCode`
  - `status`
  - `failedTests`
  - `stderrSnippet`
  - `stdoutSnippet`
  - `evidencePath`
- [ ] 统一从项目默认命令或约束显式命令解析测试命令来源
- [ ] 把红灯测试结果和绿灯测试结果分别落到：
  - `tdd/red-test-result.json`
  - `tdd/green-test-result.json`
- [ ] 从失败输出里提炼：
  - 失败测试名
  - 首个关键报错
  - 相关文件路径
  - 问题归因（测试 / 实现 / 环境）
- [ ] 补一个“命令本身执行不了”的测试，后面 Phase 4 要用这条分支做事故重试
- [ ] 运行：
  - `npm run test:run -- tests/capabilities/loop/test-execution.test.ts tests/capabilities/loop/loop.test.ts`

## Phase 4：修复重试和可靠点

### Task 7：区分“继续修”和“执行事故”

**Files:**
- Create: `src/capabilities/loop/domain/repair.ts`
- Modify: `src/capabilities/loop/application/execute.ts`
- Modify: `src/state/types.ts`
- Test: `tests/capabilities/loop/repair.test.ts`
- Test: `tests/capabilities/loop/loop.test.ts`

- [ ] 先写失败测试，覆盖两类分支：
  - 测试失败或约束失败 -> `revising`
  - 超时、断连、命令不可执行 -> `retrying_execution`
- [ ] 为 `LoopSession` 增加计数和状态字段：
  - `repairAttemptCount`
  - `executionRetryCount`
  - `currentLoopState`
  - `lastFailureReason`
- [ ] 固定第一版阈值：
  - 修复回合最多 3 次
  - 执行事故原地重试最多 2 次
- [ ] 超阈值后进入 `blocked_for_human`，并把原因写到 `repairs/open-issues.md`
- [ ] 每次失败都落 `repairs/attempt-*.json` 和 `repairs/evidence/*.txt`
- [ ] 运行：
  - `npm run test:run -- tests/capabilities/loop/repair.test.ts tests/capabilities/loop/loop.test.ts`

### Task 8：固定最后可靠点和恢复语义

**Files:**
- Modify: `src/state/types.ts`
- Modify: `src/state/state-manager.ts`
- Modify: `src/capabilities/loop/application/execute.ts`
- Test: `tests/state/state-manager.test.ts`
- Test: `tests/capabilities/loop/loop.test.ts`

- [ ] 先写失败测试，覆盖只允许从完整节点恢复，不允许从半截输出猜状态
- [ ] 固定第一版可靠点枚举：
  - `constraints_validated`
  - `red_test_confirmed`
  - `implementation_generated`
  - `test_result_recorded`
  - `completed`
- [ ] 每次推进可靠点后，立刻落盘 `session.json`
- [ ] 增加测试覆盖“红灯确认后中断再恢复”和“测试结果落盘后中断再恢复”
- [ ] 运行：
  - `npm run test:run -- tests/state/state-manager.test.ts tests/capabilities/loop/loop.test.ts`

## Phase 5：收口与文档

### Task 9：补端到端样例和回归保护

**Files:**
- Modify: `tests/capabilities/loop/loop.test.ts`
- Optionally Create: `tests/capabilities/loop/tdd-kernel.integration.test.ts`

- [ ] 增加一个最小端到端样例：
  - 明确的纯函数需求
  - 先生成失败测试
  - 再生成实现
  - 自动把测试跑绿
- [ ] 增加一个约束冲突样例：
  - 明确禁止依赖
  - 任务在执行前被卡住
- [ ] 增加一个执行事故样例：
  - 测试命令不可执行
  - 进入 `retrying_execution`
  - 超阈值后停到人工介入
- [ ] 运行：`npm run test:run -- tests/capabilities/loop/loop.test.ts`

### Task 10：更新文档和命令说明

**Files:**
- Modify: `README.md`
- Modify: `docs/references/capabilities.md`
- Reference: `docs/plans/2026-04-12-milestone-2-constraint-engine-and-tdd-kernel.md`

- [ ] 在 `README.md` 写清：
  - `trd` 会生成约束文件
  - `loop` 在适用任务上会先走测试先行
  - 失败后会自动修复到阈值，超过后停下
- [ ] 在 `docs/references/capabilities.md` 写清：
  - `trd` 新增机器可读约束产物
  - `loop` 新增约束卡点和 TDD 内核
- [ ] 运行：`npm run check:docs`

## 最终验证

- [ ] 跑核心测试：
  - `npm run test:run -- tests/capabilities/trd/constraints.test.ts tests/capabilities/trd/execute.test.ts tests/capabilities/loop/constraints.test.ts tests/capabilities/loop/tdd.test.ts tests/capabilities/loop/test-execution.test.ts tests/capabilities/loop/repair.test.ts tests/capabilities/loop/loop.test.ts tests/state/state-manager.test.ts`
- [ ] 跑全量测试：`npm run test:run`
- [ ] 跑覆盖率：`npm run test:coverage`
- [ ] 跑构建：`npm run build`
- [ ] 跑文档检查：`npm run check:docs`

## 需求覆盖检查

- R1 TRD 约束产物
  - Task 1、Task 2
- R2 执行前约束卡点
  - Task 3、Task 4
- R3 TDD 钩子
  - Task 5
- R4 本地测试执行与失败证据提取
  - Task 6
- R5 修复重试策略
  - Task 7
- R6 单任务状态与产物
  - Task 4、Task 6、Task 7、Task 8

## 提交建议

- Task 1-2 一组提交
- Task 3-4 一组提交
- Task 5-6 一组提交
- Task 7-8 一组提交
- Task 9-10 一组提交

每组提交后都跑对应测试，不要攒到最后一次性排错。
