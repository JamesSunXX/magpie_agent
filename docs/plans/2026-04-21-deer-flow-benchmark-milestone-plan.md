# DeerFlow 对标能力落地 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不破坏 Magpie 现有命令体系的前提下，分阶段补齐“上手更快、默认更安全、长流程更稳、扩展更可控”的关键能力。

**Architecture:** 以现有分层为边界推进：CLI 只负责入口，能力层承接业务流程，核心层承接通用机制，平台层承接配置和外部集成。每个里程碑都先补测试，再做最小改动，避免一次性大重构。

**Tech Stack:** TypeScript、Commander、Vitest、现有 Magpie capability runtime、仓库内 `.magpie/` 会话持久化

---

## 实施完成标准

- 新增或改动能力都能在命令行直接使用，并且有对应帮助说明。
- 高风险能力默认关闭，必须显式开启后才能执行。
- 会话产物目录可按会话隔离，恢复时不会混用旧现场。
- 长流程在上下文接近上限时能自动收敛，不影响继续执行。
- 关键入口文档与能力映射文档同步更新并通过文档检查。
- 全量验证通过：`npm run test:run`、`npm run test:coverage`、`npm run build`、`npm run check:docs`。

## 里程碑总览

| 里程碑 | 目标 | 预计工期 | 完成判定 |
| --- | --- | --- | --- |
| M0 | 锁定范围与基线 | 0.5 天 | 有冻结的目标清单、影响面清单、回退策略 |
| M1 | 上手引导与体检入口 | 1.5 天 | 初始化后可一键检查环境并给出可执行修复建议 |
| M2 | 默认安全护栏 | 1.5 天 | 高风险执行默认不可用，显式开启后才运行 |
| M3 | 会话隔离工作区 | 2 天 | 每个会话有独立输入/输出/临时目录，恢复不串场 |
| M4 | 扩展开关与按需加载 | 2 天 | 能力可配置启停，关闭后不参与执行与提示 |
| M5 | 长流程上下文收敛与记忆沉淀 | 2 天 | 长流程自动压缩上下文并保留关键决策 |
| M6 | 文档收口与发布验收 | 1 天 | 文档齐全、回归通过、可灰度发布 |

## 依赖关系

- M1 依赖 M0。
- M2 可与 M3 并行，但都依赖 M1 的配置骨架。
- M4 依赖 M2 与 M3 的配置和目录约定。
- M5 依赖 M3 的会话隔离与 M4 的能力加载机制。
- M6 依赖前五个里程碑全部通过。

## Milestone 0: 锁定范围与基线

**Files:**
- Modify: `docs/plans/2026-04-21-deer-flow-benchmark-milestone-plan.md`
- Modify: `docs/references/capabilities.md`

- [ ] **Step 1: 固化借鉴目标与不做项**
  - 输出“要做 6 项、暂不做 3 项”的边界清单，避免后续扩散范围。

- [ ] **Step 2: 建立现状基线快照**
  - 记录当前 `init`、`loop`、`harness`、`im-server` 的行为和已知限制，作为后续回归对照。

- [ ] **Step 3: 明确回退开关**
  - 为每个后续里程碑定义一个可快速关闭的配置开关，确保上线可控。

- [ ] **Step 4: 跑一次全量基线验证**
  - Run: `npm run test:run`
  - Run: `npm run build`
  - Expected: PASS，生成基线记录。

**Milestone 0 exit:** 范围冻结，后续开发不再新增同级目标。

## Milestone 1: 上手引导与体检入口

**Files:**
- Modify: `src/cli/program.ts`
- Modify: `src/cli/commands/init.ts`
- Create: `src/cli/commands/doctor.ts`
- Create: `src/capabilities/stats/application/doctor.ts`
- Modify: `src/platform/config/loader.ts`
- Test: `tests/cli/init-command.test.ts`
- Create: `tests/cli/doctor-command.test.ts`

- [ ] **Step 1: 先补失败测试**
  - 为“缺配置、缺鉴权、缺依赖”三类场景写命令级测试，先看到失败结果。

- [ ] **Step 2: 增加 `magpie doctor` 命令**
  - 命令输出三段结果：通过项、失败项、下一步命令。

- [ ] **Step 3: 让 `magpie init` 增加引导跳转**
  - 初始化结束后直接提示并可选择执行体检命令。

- [ ] **Step 4: 输出可执行修复建议**
  - 每个失败项都给一条可复制执行的命令，不输出空泛建议。

- [ ] **Step 5: 验证**
  - Run: `npm run test:run -- tests/cli/init-command.test.ts tests/cli/doctor-command.test.ts`
  - Expected: PASS

**Milestone 1 exit:** 新用户执行 `init -> doctor` 能得到明确的下一步动作。

## Milestone 2: 默认安全护栏

**Files:**
- Modify: `src/platform/config/types.ts`
- Modify: `src/platform/config/loader.ts`
- Modify: `src/capabilities/loop/application/execute.ts`
- Modify: `src/capabilities/workflows/harness/application/execute.ts`
- Modify: `src/platform/operations/router.ts`
- Test: `tests/platform/config/loader.test.ts`
- Test: `tests/platform/operations/router.test.ts`
- Test: `tests/capabilities/loop/loop.test.ts`

- [ ] **Step 1: 定义安全开关默认值**
  - 高风险动作改为默认关闭，只有显式开启才允许执行。

- [ ] **Step 2: 在执行入口统一拦截**
  - 对危险命令和敏感目录写操作做统一前置拦截，不在多个能力里重复判断。

- [ ] **Step 3: 给用户明确拒绝原因**
  - 被拦截时返回“为什么被拒绝 + 如何开启 + 风险提示”三段信息。

- [ ] **Step 4: 验证**
  - Run: `npm run test:run -- tests/platform/config/loader.test.ts tests/platform/operations/router.test.ts tests/capabilities/loop/loop.test.ts`
  - Expected: PASS

**Milestone 2 exit:** 默认配置下不会误执行高风险动作。

## Milestone 3: 会话隔离工作区

**Files:**
- Modify: `src/capabilities/workflows/shared/runtime.ts`
- Modify: `src/capabilities/loop/application/session.ts`
- Modify: `src/capabilities/workflows/harness/application/session.ts`
- Modify: `src/platform/paths.ts`
- Test: `tests/capabilities/workflows/shared/runtime.test.ts`
- Test: `tests/capabilities/loop/loop.test.ts`
- Test: `tests/capabilities/workflows/harness.test.ts`

- [ ] **Step 1: 设计统一目录约定**
  - 每个会话固定 `workspace / uploads / outputs / temp` 四类目录。

- [ ] **Step 2: 会话创建时一次性建目录**
  - 保证目录缺失时自动补齐，不依赖人工准备。

- [ ] **Step 3: 恢复流程复用原会话目录**
  - 续跑时必须锁定原目录，禁止切到新目录造成串场。

- [ ] **Step 4: 清理策略最小化**
  - 只清理临时目录，保留核心证据与产物目录。

- [ ] **Step 5: 验证**
  - Run: `npm run test:run -- tests/capabilities/workflows/shared/runtime.test.ts tests/capabilities/loop/loop.test.ts tests/capabilities/workflows/harness.test.ts`
  - Expected: PASS

**Milestone 3 exit:** 多会话并行时现场互不干扰，失败后可原地恢复。

## Milestone 4: 扩展开关与按需加载

**Files:**
- Modify: `src/platform/config/types.ts`
- Modify: `src/platform/config/loader.ts`
- Modify: `src/cli/program.ts`
- Modify: `src/capabilities/routing/`
- Test: `tests/platform/config/loader.test.ts`
- Test: `tests/cli/program.test.ts`
- Test: `tests/capabilities/routing/`（新增对应测试）

- [x] **Step 1: 增加能力启停配置**
  - 支持按能力开关，不改动已有命令名。

- [x] **Step 2: 路由层按配置装配能力**
  - 关闭能力时不注册入口，也不出现在推荐清单里。

- [x] **Step 3: 输出统一降级提示**
  - 调用被关闭能力时返回“当前关闭 + 开启方式 + 替代路径”。

- [x] **Step 4: 验证**
  - Run: `npm run test:run -- tests/platform/config/loader.test.ts tests/cli/program.test.ts`
  - Expected: PASS

**Milestone 4 exit:** 核心主线保持精简，扩展能力按需启用。

## Milestone 5: 长流程上下文收敛与记忆沉淀

**Files:**
- Modify: `src/core/debate/`（上下文裁剪接入点）
- Modify: `src/knowledge/runtime.ts`
- Modify: `src/memory/`
- Modify: `src/capabilities/loop/application/execute.ts`
- Test: `tests/knowledge/runtime.test.ts`
- Test: `tests/state/state-manager.test.ts`
- Create: `tests/capabilities/loop/context-compaction.test.ts`

- [x] **Step 1: 增加上下文长度阈值策略**
  - 达到阈值时自动生成阶段摘要，保留决策和待办，压缩冗余对话。

- [x] **Step 2: 关键结论沉淀到长期记忆**
  - 仅沉淀稳定事实和约束，不沉淀临时推测。

- [x] **Step 3: 续跑时优先加载摘要而非原始长上下文**
  - 控制输入体积，保证执行稳定性。

- [x] **Step 4: 验证**
  - Run: `npm run test:run -- tests/knowledge/runtime.test.ts tests/state/state-manager.test.ts tests/capabilities/loop/context-compaction.test.ts`
  - Expected: PASS

**Milestone 5 exit:** 长流程可持续运行，不因上下文膨胀而失稳。

## Milestone 6: 文档收口与发布验收

**Files:**
- Modify: `README.md`
- Modify: `ARCHITECTURE.md`
- Modify: `docs/README.md`
- Modify: `docs/references/capabilities.md`
- Modify: `AGENTS.md`（如新增协作规则）

- [x] **Step 1: 更新用户入口文档**
  - 补齐新命令、新默认行为、风险提示和推荐用法。

- [x] **Step 2: 更新架构与能力映射**
  - 把新增职责放到正确分层，避免后续维护混乱。

- [x] **Step 3: 跑完整体验收**
  - Run: `npm run test:run`
  - Run: `npm run test:coverage`
  - Run: `npm run build`
  - Run: `npm run check:docs`
  - Run: `npm run lint`
  - Expected: 全部 PASS，覆盖率达到仓库要求。

- [x] **Step 4: 灰度发布与回退演练**
  - 在文档中固化灰度流程：小范围开启能力、保持危险命令默认关闭、异常时能力开关一键回退。
  - 回退定位路径固定为 `loop/harness inspect + 会话 failures/`，确保可复盘。

**Milestone 6 exit:** 文档、测试、构建、回退全部闭环，可进入常规迭代。

## 风险与应对

| 风险 | 影响 | 应对 |
| --- | --- | --- |
| 里程碑并行导致配置冲突 | 集成回归失败 | 先冻结配置字段命名，合并前统一校验 |
| 安全拦截过严影响可用性 | 用户体验下降 | 提供显式开启路径和清晰提示 |
| 会话隔离改动触发兼容问题 | 旧会话无法恢复 | 增加兼容读取与回退到旧路径机制 |
| 文档不同步 | 使用方误操作 | M6 设为发布硬门槛，未通过不发布 |

## 执行顺序建议

1. 先完成 M0、M1，确保入口清晰。
2. 再完成 M2、M3，确保安全和稳定底座。
3. 随后完成 M4、M5，提升扩展性和长流程质量。
4. 最后完成 M6，统一发布与验收。
