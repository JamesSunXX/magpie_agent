# Self-Healing Magpie TRD

## 目标

把 [`2026-04-12-self-healing-magpie-implementation-plan.md`](./2026-04-12-self-healing-magpie-implementation-plan.md) 里已经确定的拆域方案，继续收敛成可直接进入开发阶段的技术契约。

这一版 TRD 只回答 4 个问题：

1. Domain A 对 Domain C 暴露什么固定接口
2. `loop`、`harness`、`harness-server` 分别在什么时机上报失败事实
3. 失败记录要写到哪里、谁负责写、哪些字段必须稳定
4. 后续开发阶段按什么顺序推进，做到什么程度才算可交付

## 不在本阶段做的事

- 不重新拆 Domain A / B / C / D
- 不实现完整 `workflow_self_repair`
- 不把失败知识升级逻辑提前做到自动闭环
- 不改现有 CLI 入口和用户命令

## 相关输入

- 设计文档：[`2026-04-12-self-healing-magpie-design.md`](./2026-04-12-self-healing-magpie-design.md)
- 实施计划：[`2026-04-12-self-healing-magpie-implementation-plan.md`](./2026-04-12-self-healing-magpie-implementation-plan.md)
- 当前接入点：
  - [`src/capabilities/loop/application/execute.ts`](/Users/sunchenhui/.codex/worktrees/193a/magpie/src/capabilities/loop/application/execute.ts)
  - [`src/capabilities/workflows/harness/application/execute.ts`](/Users/sunchenhui/.codex/worktrees/193a/magpie/src/capabilities/workflows/harness/application/execute.ts)
  - [`src/capabilities/workflows/harness-server/runtime.ts`](/Users/sunchenhui/.codex/worktrees/193a/magpie/src/capabilities/workflows/harness-server/runtime.ts)
  - [`src/capabilities/workflows/shared/runtime.ts`](/Users/sunchenhui/.codex/worktrees/193a/magpie/src/capabilities/workflows/shared/runtime.ts)
  - [`src/state/types.ts`](/Users/sunchenhui/.codex/worktrees/193a/magpie/src/state/types.ts)

## Domain Partition 交接锁定

`domain_partition` 阶段已经在实施计划里固定两件事：

1. 四个 Domain 的主归属文件和直接验收项，以实施计划中“文件与验收归属表”为准。
2. 四个 Domain 与仓库分层、TRD 契约的关系，以实施计划中“架构与 TRD 对齐结果”为准。

这份 TRD 只继续细化接口、写盘职责和接入时机，不重新拆分 Domain A / B / C / D，也不改写文件归属。

## 固定契约

### 1. Domain C 上报给 Domain A 的最小事实

三条主路径不能直接构造最终账本记录，只能先上报统一事实。第一版统一成 `FailureFactInput` 语义，字段最少包含：

| 字段 | 说明 |
| --- | --- |
| `sessionId` | 失败关联的会话 id；服务级无会话时允许为空 |
| `capability` | `loop`、`harness`、`harness-server` 之一 |
| `stage` | 当前失败所在阶段或服务动作名 |
| `reason` | 原始失败摘要，保留人可读语义 |
| `rawError` | 原始错误文本、测试输出或异常消息 |
| `retryableHint` | 接入层已有的可重试判断，允许为空 |
| `lastReliablePoint` | 当前路径最后可靠点 |
| `evidencePaths` | 已落盘证据文件路径列表 |
| `metadata` | 与接入点强相关的补充上下文 |

约束：

- Domain C 只能上报事实，不得自己生成失败签名。
- Domain C 可以提供 `retryableHint`，但最终是否可重试由 Domain A 决定。
- `reason` 必须能单独读懂，不能只写“execution failed”这类空话。
- `evidencePaths` 必须只引用已经存在或当前调用栈即将写出的文件。

第一版保留以下 `metadata` 约定键，后续实现不要各自改名：

| key | 使用位置 | 说明 |
| --- | --- | --- |
| `failureKind` | `loop` 测试失败 | 标记红灯失败、绿灯失败或命令前置失败 |
| `attemptNumber` | `loop` 测试失败 / 重试 | 标记当前是第几次修复或重试 |
| `sourceFailureSignature` | `harness` 派生失败 | 指向内层 `loop` 已经落盘的原始失败签名 |
| `countTowardFailureIndex` | `harness` 派生失败 | 固定为 `false`，避免同一根因被聚合两次 |
| `relatedSessionId` | `harness-server` 服务级失败 | 服务级失败后来定位到具体 session 时补关联，不回写旧记录 |

最小样例：

```json
{
  "sessionId": "loop-123",
  "capability": "loop",
  "stage": "code_development",
  "reason": "Green test still failing after repair attempt 2.",
  "rawError": "npm run test:run -- tests/capabilities/loop/loop.test.ts",
  "retryableHint": true,
  "lastReliablePoint": "planning_completed",
  "evidencePaths": [
    ".magpie/sessions/loop/loop-123/green-test-result.json"
  ],
  "metadata": {
    "failureKind": "green_test_failed",
    "attemptNumber": 2
  }
}
```

### 2. Domain A 返回给 Domain C 的固定结果

统一失败核心域对外只返回两类结果：

| 返回值 | 说明 |
| --- | --- |
| `FailureRecord` | 已完成分类、签名和标准化后的最终失败记录 |
| `RecoveryDecision` | 当前建议动作、是否可自动继续、是否为自修候选 |

第一版 `RecoveryDecision` 必须包含：

| 字段 | 说明 |
| --- | --- |
| `action` | 固定为实施计划定义的 6 个动作之一 |
| `retryable` | 布尔值，统一替代各路径零散重试判断 |
| `candidateForSelfRepair` | 是否具备升级为自修候选的最低条件 |
| `reason` | 给接入层和后续文档看的决策原因 |
| `diagnosticChecks` | 当动作是 `run_diagnostics` 时要执行的检查项 |

第一版 `FailureRecord` 至少固定以下字段，字段名与落盘 JSON 保持一致：

| 字段 | 说明 |
| --- | --- |
| `id` | 单条失败记录 id |
| `sessionId` | 关联会话 id；服务级失败允许为空 |
| `capability` | 失败来源 capability |
| `stage` | 失败阶段或服务动作名 |
| `timestamp` | 记录创建时间 |
| `signature` | 稳定失败签名 |
| `category` | 标准化失败分类 |
| `reason` | 人可读失败摘要 |
| `retryable` | 是否允许自动继续 |
| `selfHealCandidate` | 是否满足升级为自修候选的最低条件 |
| `lastReliablePoint` | 最后可靠点 |
| `evidencePaths` | 证据文件路径列表 |
| `metadata` | 补充上下文 |
| `recoveryAction` | 本次决策动作 |

派生失败样例：

```json
{
  "id": "f0e1d2c3b4a5",
  "sessionId": "harness-456",
  "capability": "harness",
  "stage": "code_development",
  "timestamp": "2026-04-12T10:00:00.000Z",
  "signature": "code_development|workflow_defect|loop_failed",
  "category": "workflow_defect",
  "reason": "Loop failed during code_development and requires manual follow-up.",
  "retryable": false,
  "selfHealCandidate": true,
  "lastReliablePoint": "planning_completed",
  "evidencePaths": [
    ".magpie/sessions/harness/harness-456/events.jsonl"
  ],
  "metadata": {
    "sourceFailureSignature": "code_development|workflow_defect|loop_failed",
    "countTowardFailureIndex": false,
    "loopSessionId": "loop-123"
  },
  "recoveryAction": "block_for_human"
}
```

约束：

- Domain A 不直接改 session 状态。
- Domain A 不直接写 workflow event。
- Domain A 只给出分类、账本结果和动作建议；最终状态迁移由接入层负责。
- `signature` 第一版默认只包含 `stage`、`category` 和归一化后的关键报错；如果读到旧的 capability 前缀签名，shared runtime 和 ledger 要在读写时统一归一化；如果 `harness` 只是转述内层 `loop` 已有失败，则直接复用 `sourceFailureSignature`，再用 `countTowardFailureIndex=false` 避免同一根因重复累计。

### 3. 账本写入职责

第一版账本写入分两层：

| 层级 | 路径 | 写入责任 |
| --- | --- | --- |
| 会话级失败记录 | `<sessionDir>/failures/<failureId>.json` | 由 `ledger.ts` 统一写入 |
| 仓库级失败索引 | `.magpie/failure-index.json` | 由 `ledger.ts` 统一读改写 |
| 服务级无会话失败 | `.magpie/harness-server/failures/<failureId>.json` | 仍由 `ledger.ts` 写，但路径通过 shared runtime 提供 |

约束：

- `loop`、`harness`、`harness-server` 不得自己直接写 `.magpie/failure-index.json`。
- 会话目录路径由现有 session runtime 提供，不能在每个能力里重复拼字符串。
- 仓库级索引必须按 `signature` 聚合，而不是按 `failureId` 聚合。
- 只有显式复用源签名的跨 capability 派生失败，才会和原始失败落在同一聚合主题下；仓库级索引仍要保留 capability 计数明细。

路径归属示例：

| 场景 | failure record 路径 | index 路径 |
| --- | --- | --- |
| `loop` session 失败 | `.magpie/sessions/loop/<sessionId>/failures/<failureId>.json` | `.magpie/failure-index.json` |
| `harness` session 失败 | `.magpie/sessions/harness/<sessionId>/failures/<failureId>.json` | `.magpie/failure-index.json` |
| `harness-server` 绑定 `harness` session 的失败 | `.magpie/sessions/harness/<sessionId>/failures/<failureId>.json` | `.magpie/failure-index.json` |
| `harness-server` 无法绑定 session 的服务级失败 | `.magpie/harness-server/failures/<failureId>.json` | `.magpie/failure-index.json` |

## 三条主路径接入契约

### `loop`

`loop` 是最细粒度失败事实来源，必须在以下位置发出 `FailureFactInput`：

| 接入点 | 触发条件 | 必带上下文 | 预期分类优先级 |
| --- | --- | --- | --- |
| `markSessionFailed` | 阶段最终失败 | 当前 stage、`lastFailureReason`、事件文件 | 按分类器结果 |
| 红灯测试失败后暂停分支 | 测试命令没能形成有效红灯 | 测试结果文件、失败类型、重试次数 | `quality` 或 `environment` 或 `prompt_or_parse` |
| 绿灯测试修复 / 重试分支 | 绿灯测试没过，需要继续修复或执行重试 | 当前回合、测试结果文件、修复证据 | `quality` 或 `transient` |
| worktree / 约束 / 环境前置失败 | 进入实现前就失败 | 工作区模式、命令错误、约束快照 | `environment` 或 `workflow_defect` |

`loop` 额外要求：

- 必须把当前 `lastReliablePoint` 原样带入失败记录。
- 当失败来自测试执行时，`metadata` 要带 `failureKind`、`attemptNumber`。
- 当结果是“暂停等人工”时，不写失败账本，只允许写恢复语义。

### `harness`

`harness` 不重判 `loop` 已经判过的细粒度问题，但要补齐外层工作流失败：

| 接入点 | 触发条件 | 必带上下文 | 预期动作 |
| --- | --- | --- | --- |
| `loop` 返回 `failed` | 内层开发未完成 | `loopSessionId`、`loopEventsPath`、当前 cycle | 通常 `block_for_human` 或 `spawn_self_repair_candidate` |
| review cycle 抛错 | 审查环节自身异常 | reviewer/validator 产物、cycle 编号 | `retry_with_backoff` 或 `run_diagnostics` |
| 最终未获批准 | 所有轮次跑完仍不通过 | `rounds.json`、单测结果、审查汇总 | `block_for_human` |
| 恢复点缺失 | 恢复开发或评审时上下文不完整 | 缺失字段列表、当前 session evidence | `run_diagnostics`，必要时升级 `workflow_defect` |

`harness` 额外要求：

- 如果内层 `loop` 是 `paused_for_human`，外层只能维持 `blocked`，不能新增失败记录。
- 如果外层失败是由内层同一签名引发，必须在 `metadata.sourceFailureSignature` 里保留原签名，并显式写 `countTowardFailureIndex=false`，但不能覆盖原记录。
- `HarnessResult` 必须暴露 failure artifact 路径，供 `inspect` 和后续知识提炼复用。

### `harness-server`

`harness-server` 只负责服务级恢复与托管异常，不重新解释业务失败：

| 接入点 | 触发条件 | 必带上下文 | 分类约束 |
| --- | --- | --- | --- |
| 队列任务 claim 后发现输入缺失 | `toQueuedEvidence` 失败或 queued metadata 缺失 | session id、缺失字段 | `workflow_defect` |
| `runCapability(harnessCapability, ...)` 抛错 | 托管执行本身异常 | retryCount、lastError、当前 stage | 交给分类器，但优先保留 `retryableHint` |
| 重启恢复时重新入队失败 | 中断会话不能恢复到待执行状态 | 上次可靠点、恢复 evidence | `workflow_defect` |
| 无法绑定 session 的服务级异常 | 没有可用 sessionId 的宿主错误 | server heartbeat、异常文本 | `environment` 或 `unknown` |

`harness-server` 额外要求：

- `waiting_retry` 和 `failed` 的切换必须由 `RecoveryDecision.retryable` 驱动，不再保留额外字符串分支。
- 正常中断恢复不记失败；只有恢复失败才记。
- 服务级失败如果后来定位到具体会话，不回写原记录，只通过 `metadata.relatedSessionId` 关联。

## 可靠点和状态约束

第一版不强制把现有所有可靠点枚举立刻改成同一组字符串，但要满足两个映射规则：

1. 接入层上报失败时，必须能给出“当前路径最后一个可恢复节点”。
2. 账本记录里的 `lastReliablePoint` 必须可被外层流程直接消费，不能是只有当前函数才懂的临时词。

开发阶段按下面的统一语义对齐：

| 统一语义 | 当前可能来源 |
| --- | --- |
| `queued` | harness queue created |
| `claimed` | harness-server picked up queued session |
| `planning_completed` | harness 完成计划准备，或 loop 完成约束检查 |
| `development_completed` | loop 完成实现并通过开发内必要校验 |
| `review_completed` | harness 完成轮次审查 |
| `verification_completed` | harness 最终验证通过 |
| `resume_ready` | 中断恢复后已经具备继续执行条件 |

要求：

- 代码里允许保留现有枚举，但对失败账本输出要统一翻译成上表语义。
- 如果某个路径拿不到可靠点，默认按 `workflow_defect` 处理，而不是吞掉。

## 仓库级索引结构

`.magpie/failure-index.json` 第一版至少要稳定以下结构：

| 字段 | 说明 |
| --- | --- |
| `version` | 索引版本，第一版固定为 `1` |
| `updatedAt` | 最近更新时间 |
| `entries` | 按 `signature` 聚合的失败主题列表 |

每个 `entry` 至少包含：

| 字段 | 说明 |
| --- | --- |
| `signature` | 稳定失败签名 |
| `category` | 当前主分类 |
| `count` | 总出现次数 |
| `capabilities` | 各 capability 次数，固定为 `{ "loop"?: number, "harness"?: number, "harness-server"?: number }` |
| `latestReason` | 最近一次原因摘要 |
| `lastSeenAt` | 最近出现时间 |
| `latestEvidencePaths` | 最近一次证据路径 |
| `selfHealCandidateCount` | 被标成自修候选的次数 |

第一版额外固定以下字段，避免知识层和后续 inspect 再猜：

| 字段 | 说明 |
| --- | --- |
| `categories` | 这个签名历史上出现过的分类列表 |
| `firstSeenAt` | 第一次出现时间 |
| `lastSessionId` | 最近一次命中的 session id |
| `recentSessionIds` | 最近三次命中的 session id |
| `recentEvidencePaths` | 最近三次命中的唯一路径，使用扁平字符串数组 |
| `candidateForSelfRepair` | 当前是否满足自修候选条件 |
| `lastRecoveryAction` | 最近一次恢复动作 |

约束：

- 并发写入时以“读最新、改内存、原子回写”为最低保证。
- `.magpie/failure-index.lock` 的等待必须有上限；第一版超过 5 秒还拿不到锁时，当前写入直接失败，不能无限挂起。
- 允许保留最近一次原因摘要，但不能覆盖累计次数。
- 知识层只消费这个索引，不直接扫每个 session 的失败目录做聚合。

索引样例：

```json
{
  "version": 1,
  "updatedAt": "2026-04-12T10:00:00.000Z",
  "entries": [
    {
      "signature": "workflow_defect|resume-checkpoint",
      "category": "workflow_defect",
      "categories": [
        "workflow_defect"
      ],
      "count": 2,
      "firstSeenAt": "2026-04-12T09:10:00.000Z",
      "lastSeenAt": "2026-04-12T10:00:00.000Z",
      "lastSessionId": "loop-b",
      "recentSessionIds": [
        "loop-a",
        "loop-b"
      ],
      "capabilities": {
        "loop": 2
      },
      "latestReason": "Cannot safely resume because no reliable checkpoint was recorded.",
      "latestEvidencePaths": [
        ".magpie/sessions/loop/loop-b/events.jsonl"
      ],
      "recentEvidencePaths": [
        ".magpie/sessions/loop/loop-a/events.jsonl",
        ".magpie/sessions/loop/loop-b/events.jsonl"
      ],
      "selfHealCandidateCount": 1,
      "candidateForSelfRepair": true,
      "lastRecoveryAction": "run_diagnostics"
    }
  ]
}
```

## 知识升级接口

这一阶段不实现自动升级，但要提前固定输入：

- `knowledge/runtime.ts` 后续只从 `.magpie/failure-index.json` 读聚合结果。
- 满足下面条件之一的聚合 entry，可在下一阶段转成 `failure-pattern` 候选：
  - `workflow_defect` 且重复出现
  - `prompt_or_parse` 在不同 session 多次重复
  - `selfHealCandidateCount` 超过 1

为了让后续接得上，`ledger.ts` 写索引时必须保留：

- 最近三次会话 id
- 最近三次 evidence 路径
- 最近一次决策动作

## 计划对照与开工检查

下面这张表只做一件事：让后续执行者不用翻两份文档猜“计划里的哪一段已经被 TRD 定死了”。

| 实施计划里的交接点 | 这份 TRD 的固定位置 | 开工前必须确认什么 |
| --- | --- | --- |
| Domain A 与 Domain C 的接口细化 | “固定契约” + “三条主路径接入契约” | 事实输入、标准记录、恢复决策的字段名和责任边界已经固定 |
| 写盘约束 | “账本写入职责” + “仓库级索引结构” | session 级、repo 级、服务级三条路径没有重复写入口 |
| 三条主路径接入边界 | “`loop` / `harness` / `harness-server`” 三节 | 每个失败入口都能回指唯一上报时机 |
| 知识升级输入 | “知识升级接口” | `knowledge/runtime.ts` 只依赖索引，不反扫 session 目录 |
| 开发顺序 | “开发顺序” | 不跨过 Domain A / B 先在接入层散改字段 |

进入 `code_development` 前，执行者应逐条复核下面 5 项：

1. 已确认 `sourceFailureSignature`、`countTowardFailureIndex`、`relatedSessionId` 这三个跨层字段名不再变化。
2. 已确认 `.magpie/failure-index.json` 需要额外稳定 `recentSessionIds`、`recentEvidencePaths`、`lastRecoveryAction`。
3. 已确认 `paused_for_human`、正常恢复、真正失败三类情况只落各自语义，不会重复记账。
4. 已确认 `harness-server` 的 `waiting_retry` / `failed` 切换只看恢复决策，不再保留第二套字符串判断。
5. 如果要新增文件或字段，先回补实施计划里的“文件与验收归属表”，再开始写代码。

## 开发顺序

后续 `code_development` 阶段必须按下面顺序推进：

1. 先落 `src/core/failures/types.ts`、`classifier.ts`、`recovery-policy.ts`
2. 再补 `src/state/types.ts`、`src/capabilities/workflows/shared/runtime.ts`、`src/capabilities/workflows/harness/types.ts`
3. 然后按 `loop` -> `harness` -> `harness-server` 接入
4. 最后补 `src/core/failures/ledger.ts` 与 `src/knowledge/runtime.ts` 的消费接口
5. 最后再更新 `README.md`、`docs/references/capabilities.md`

不允许的顺序：

- 先改 `harness-server` 再倒逼失败核心域补字段
- 在 `loop`、`harness`、`harness-server` 里各自维护第二套签名生成逻辑
- 在没有统一账本前先做知识升级

## 测试与验收

进入开发阶段前，这份 TRD 的最低验收标准是：

1. 每个接入点都能映射到唯一的上报时机，不存在“失败但没人写记录”的空档。
2. 会话级路径、仓库级索引路径、服务级路径的所有权已经写清楚。
3. `paused_for_human`、正常中断恢复、真正失败三者的边界已经明确，不会互相混淆。
4. `waiting_retry` 与 `failed` 的切换依据已经统一到恢复决策，不再依赖零散判断。

开发阶段完成后，至少要跑下面这些验证：

- `npm run test:run -- tests/core/failures/classifier.test.ts tests/core/failures/ledger.test.ts tests/core/failures/recovery-policy.test.ts`
- `npm run test:run -- tests/capabilities/loop/test-execution.test.ts tests/capabilities/loop/loop.test.ts tests/capabilities/workflows/harness.test.ts tests/capabilities/workflows/harness-server.test.ts tests/state/state-manager.test.ts`
- `npm run test:run`
- `npm run test:coverage`
- `npm run build`
- `npm run check:boundaries`
- `npm run check:docs`

## `trd_generation` 阶段出口检查表

只有下面 4 项同时满足，这一阶段才算真正结束，可进入 `code_development`：

1. `FailureFactInput`、`FailureRecord`、`RecoveryDecision` 的字段名和责任边界已经固定，开发阶段不再重新定义接口。
2. 三条主路径各自的失败上报时机，以及 `paused_for_human`、正常恢复、真正失败的边界已经固定，不会再把恢复语义误记成失败。
3. 会话级、仓库级、服务级三类失败写盘路径和 `.magpie/failure-index.lock` 约束已经写清楚，不会在实现阶段再冒出第二套写入口。
4. 开发顺序、开工检查项和最低验收标准已经和实施计划对齐；如果后续要新增字段或文件，必须先回补实施计划里的归属表。

## 开发阶段交接结论

这份 TRD 已经把 `trd_generation` 阶段需要定死的边界写清楚。后续如果实现过程中发现字段不够，优先回补 Domain A / Domain B 契约，再修改接入层，不允许反过来先把接入层做散。
