# Self-Driven Harness (Loop) Spec

## Goal

把当前 `workflow harness` 升级为“自驱动长期运行系统”：

- 开发、评审、测试、修复都能自动循环
- 模型之间自己确认是否通过，不需要人工闸门
- 支持长任务稳定运行、可恢复、可并发、可追踪

本次范围覆盖 5 个能力缺口：`1/3/4/5/7`

- 1: 统一中枢进程
- 3: 长任务记忆压缩
- 4: 技能仓库
- 5: 持续清理机制
- 7: 规模化调度

## Current Baseline

当前仓库已有：

- `workflow harness` 一键闭环（开发 -> 对抗评审 -> 单测 -> 自动修复循环）
- 默认模型对抗（`gemini-cli` + `kiro`）
- 每轮产物持久化到 `~/.magpie/workflow-sessions/harness/*`

当前不足：

- 流程仍是“命令一次执行”，不是常驻服务
- 任务长时间运行时上下文会膨胀
- 缺少技能版本治理
- 缺少自动卫生修复流水线
- 缺少任务队列、并发与重试策略

## Non-Goals

- 不做 UI 大改（TUI/网页只做最小接线）
- 不引入外部大型平台（先用本地可控实现）
- 不在本轮覆盖 monthly/yearly 调度

## Product Requirements

### R1. Harness Hub (中枢进程)

- 提供常驻进程管理任务
- CLI 变为“提交任务 + 订阅日志 + 查询状态”
- 进程/终端断开后任务继续运行
- 支持 `attach` 恢复实时输出

### R2. Context Compaction (记忆压缩)

- 每轮完成后自动生成“轮次摘要”
- 对超长日志做截断与关键片段保留
- 下轮只注入：目标、最新摘要、未解决清单、关键失败证据
- 保证单轮输入上下文可控

### R3. Skills Registry (技能仓库)

- 定义技能包元数据：`id`、`version`、`entry`、`compatibility`
- 运行时按任务阶段装载技能（planning/dev/review/test/hygiene）
- 支持固定版本与回滚

### R4. Hygiene Autopilot (持续清理)

- 后台周期扫描代码卫生规则
- 自动创建“低风险清理任务”
- 清理任务也走 harness 对抗流程
- 记录修复结果与回归风险

### R5. Scheduler & Queue (规模化调度)

- 任务进入统一队列
- 支持优先级队列（interactive/high/normal/background）
- 支持并发上限、仓库互斥、自动重试、失败入队列
- 支持基础 SLO 指标：等待时长、执行时长、成功率

## Architecture (Target)

### A. Runtime Components

- `Harness Hub`：常驻进程，维护任务生命周期
- `Task Queue`：排队、限流、重试、死信
- `Loop Runner`：执行单个任务的多轮状态机
- `Compaction Service`：回合总结、证据提取、上下文压缩
- `Skills Registry`：技能包解析、版本锁定、运行时装载
- `Hygiene Scanner`：规则扫描与自动修复任务生成
- `Telemetry`：事件日志与指标

### B. Persistent Artifacts

- `session.json`：任务主状态
- `rounds/*.json`：每轮细节
- `compaction/*.md`：压缩摘要
- `evidence/*.txt`：失败证据片段
- `skills.lock.yaml`：技能锁定文件

## Loop Plan (Execution by Stages)

### Loop 0: Spec Freeze

目标：冻结需求和验收标准，明确边界。  
产物：

- 本文件（spec）
- 任务拆分清单（Issue 列表）

完成标准：

- 关键术语定义完成
- 各 loop 输入/输出明确

### Loop 1: Harness Hub

目标：把 harness 从“单命令流程”升级为“常驻服务 + 任务提交”。

交付：

- 新命令：`magpie harness-server start|stop|status`
- 新命令：`magpie harness submit|attach|list`
- 基础状态持久化和恢复

验收：

- 关闭提交命令后任务仍继续运行
- `attach` 可恢复日志

验证命令：

```bash
npm run test:run -- tests/capabilities/workflows/harness.test.ts tests/cli/program.test.ts
npm run build
```

### Loop 2: Scheduler & Queue

目标：支持多任务并行与资源保护。

交付：

- 优先级队列
- 仓库互斥锁
- 重试与失败队列
- 并发配置（全局与每仓库）

验收：

- 同仓库并发提交不会同时改代码
- 失败任务按策略重试

验证命令：

```bash
npm run test:run -- tests/capabilities/workflows/harness-queue.test.ts
npm run build
```

### Loop 3: Context Compaction

目标：长任务稳定，避免上下文失控。

交付：

- 回合摘要器
- 长日志截断策略
- 未解决问题清单抽取

验收：

- 多轮任务下输入上下文大小维持在阈值内
- 关键失败信息不会丢

验证命令：

```bash
npm run test:run -- tests/capabilities/workflows/harness-compaction.test.ts
npm run build
```

### Loop 4: Skills Registry

目标：能力可复用、可版本化、可回滚。

交付：

- 技能元数据规范
- 技能加载器与锁文件
- 阶段 -> 技能映射配置

验收：

- 指定版本技能可稳定复现
- 回滚后行为可恢复

验证命令：

```bash
npm run test:run -- tests/capabilities/workflows/harness-skills.test.ts
npm run build
```

### Loop 5: Hygiene Autopilot

目标：持续自动清理，减少技术债累积。

交付：

- 卫生规则扫描器
- 自动清理任务创建器
- 清理任务运行策略（低风险自动，高风险对抗确认）

验收：

- 定时任务可生成清理任务
- 清理任务走完整 harness 流程并可追踪

验证命令：

```bash
npm run test:run -- tests/capabilities/workflows/harness-hygiene.test.ts
npm run build
```

### Loop 6: E2E Hardening

目标：把以上能力串成可长期运行版本。

交付：

- 端到端测试（提交 -> 调度 -> 多轮 -> 完成）
- 运行指标和告警阈值
- 发布说明

验收：

- 连续 50 个任务无致命中断
- 失败任务可恢复率 >= 95%

验证命令：

```bash
npm run test:run -- tests/e2e/harness-e2e.test.ts
npm run test:coverage
npm run lint
npm run build
```

## Metrics & Gates

- `approval_rate`: 模型最终通过率
- `mean_cycles_to_approve`: 平均通过轮次
- `retry_rate`: 重试占比
- `queue_wait_p95`: 排队 P95
- `session_recovery_success_rate`: 断线恢复成功率

发布门槛：

- 新增/修改文件行覆盖率 >= 80%
- 无 P0/P1 阻塞问题
- e2e 与 build 全通过

## Risks & Mitigations

- 风险：模型结论漂移  
  缓解：双模型一致性规则 + 结构化判定 schema

- 风险：并发任务相互污染  
  缓解：仓库级互斥 + 分支隔离

- 风险：长任务成本失控  
  缓解：压缩摘要 + 输出截断 + 轮次上限

- 风险：自动清理误伤  
  缓解：规则分级，默认只自动执行低风险清理

## How To Run With Existing Loop

在功能尚未全部落地前，可以先用现有 loop 驱动本 spec 的实施：

```bash
magpie loop run "Deliver self-driven harness v2" \
  --prd ./docs/plans/2026-04-03-self-driven-harness-loop-spec.md \
  --no-wait-human
```

每个 loop 完成后，用同一 session 继续推进，直到 Loop 6。

