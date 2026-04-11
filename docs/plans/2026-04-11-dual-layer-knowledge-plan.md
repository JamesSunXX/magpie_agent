# Magpie 双层知识沉淀落地方案

## 目标

把 Magpie 当前已经存在的 session knowledge 能力，收敛成一套明确的双层模型：

- 任务层：服务“这次任务怎么继续做”
- 长期层：服务“以后同类任务别再从头来一遍”

本方案要解决的不是“做一个很大的知识库”，而是 3 个更具体的问题：

1. `loop` / `harness` 中断后，恢复执行时能快速对齐到最新状态
2. 同仓库里反复出现的决定和失败教训，能沉淀成长期可复用经验
3. 知识内容能持续清理，避免越积越乱

## 当前基线

仓库里已经有一套可用但还不够完整的 knowledge 基础：

- `src/knowledge/runtime.ts`
  - 已支持为每个 `loop` / `harness` session 创建 task knowledge
  - 已支持 `goal`、`plan`、`open-issues`、`evidence`、`stage-*`、`final`
  - 已支持把候选内容升级到仓库级 knowledge
- `src/capabilities/loop/application/execute.ts`
  - 已在 `loop run` 时创建 knowledge，并把 plan / stage summary / final summary 写回
  - 已把 task knowledge 注入阶段 prompt
- `src/capabilities/workflows/harness/application/execute.ts`
  - 已在 harness 执行中记录 plan / cycle summary / open issues / evidence / final
- `src/cli/commands/loop.ts` / `src/cli/commands/harness.ts`
  - 已有 session 级 `inspect` 入口

当前仓库级 knowledge 仍然偏轻：

- 候选类型只有 `decision` 和 `failure-pattern`
- 升级规则还比较隐式，更多依赖调用方自行约束
- 用户只能看 session 级摘要，缺少 repo 级 inspect / audit 能力
- 还没有“知识体检”动作，不能系统发现重复、冲突、过时和缺口

## 适用范围

本方案只覆盖以下范围：

- `loop` 和 `harness` 的知识写入、读取、升级与查看
- 仓库级长期 knowledge 的组织方式
- 最小可用的 repo inspect / audit 入口
- 提示词注入与用户可见摘要的收敛

本方案暂不覆盖：

- `review` / `discuss` / `trd` 的全面接入
- 对话全文存档或完整 wiki 化
- 自动联网检索和外部知识同步
- 很重的标签体系、图谱系统或向量检索系统

## 设计原则

1. 先服务续跑，再服务沉淀  
   优先保证“上次做到哪、为什么这么做、接下来干什么”这件事可靠。

2. 先双层分离，再扩展类型  
   先把任务层和长期层边界写死，再考虑是否继续扩充内容种类。

3. 长期层只收稳定内容  
   不把临时过程、推测、一次性判断直接塞进长期层。

4. 让升级规则显式化  
   哪些内容允许升级、哪些不允许升级，必须由统一规则判断，而不是散在不同 capability 里。

5. 默认轻量，定期体检  
   知识系统不追求“全收集”，而追求“少而稳、可回看、可清理”。

6. 先保证一致性，再增加入口  
   如果中断、重试或并发执行时会留下互相冲突的状态，再多 inspect / audit 入口也不可信。

## 目标模型

### 一、任务层（Task Knowledge）

任务层继续沿用 session 目录下的知识结构，但语义要固定下来。

必备摘要：

- `goal.md`
- `plan.md`
- `state.json`
- `open-issues.md`
- `evidence.md`
- `stage-*.md`
- `final.md`
- `candidates.json`
- `log.md`
- `index.md`

每类摘要的职责固定如下：

- `goal`：当前任务要交付什么，不记录过程
- `plan`：当前仍有效的执行路径，不是历史流水账
- `state`：只服务续跑，固定记录当前阶段、最后一次可信结果、下一步动作、当前阻塞
- `open-issues`：尚未拍板或尚未验证的问题
- `evidence`：影响判断的关键事实、验证结果或引用位置
- `stage-*`：阶段性结论，只在方向变化、风险变化、证据变化时更新
- `final`：任务结束时的收口总结
- `candidates`：从 final 中提炼出的长期候选项

任务层只服务两个动作：

1. 让 agent 在下一阶段继续往下做
2. 让最终收口时有稳定的候选素材可升级

`state.json` 建议固定包含：

- `currentStage`
- `lastReliableResult`
- `nextAction`
- `currentBlocker`
- `updatedAt`

这张状态卡不承担解释历史的职责，只承担“恢复执行时先看什么”的职责。

### 二、长期层（Repository Knowledge）

长期层存放在 `~/.magpie/knowledge/<repo-key>/` 下，建议整理为 3 类：

- `decisions/`
- `failure-patterns/`
- `workflow-rules/`

其中：

- `decisions`：长期有效的技术或流程取舍
- `failure-patterns`：重复出现、值得预防的失败教训
- `workflow-rules`：已经稳定下来的固定做法

`workflow-rules` 是本方案新增的长期类型。  
如果首版实现希望更稳，可以先在数据结构上引入该类型，并在 UI/输出层单独展示；目录和 index 可与现有实现同步升级。

### 三、候选项（Promotion Candidates）

当前 `KnowledgeCandidate` 需要补强，不再只包含“标题 + 摘要 + 类型”。

候选项至少应包含：

- `type`
- `title`
- `summary`
- `topicKey`
- `sourceSessionId`
- `evidencePath`
- `status`
- `whyPromotable`
- `stability`
- `scope`
- `appliesTo`
- `introducedAt`
- `lastUsedAt`
- `lifecycle`
- `supersededBy`

新增字段的目的：

- `whyPromotable`：说明为什么值得升级，减少“看起来像经验，但其实只是一次性判断”
- `stability`：区分临时结论和稳定规则
- `scope`：区分“只对当前任务有效”和“仓库内普遍适用”，必要时可带分支 / 版本边界
- `topicKey`：给“同一主题是否再次出现”一个稳定归并线索，避免只靠标题猜
- `appliesTo`：明确适用范围，至少支持 capability / 路径模式 / 关键文件边界
- `introducedAt`、`lastUsedAt`、`lifecycle`、`supersededBy`：支撑后续的过时判断、退役、替换和 audit

`topicKey` 不建议做成开放式标签体系。首版应是受约束的归并标识，而不是自由发挥的标签池。

### 四、仓库身份（Repository Identity）

长期层不能只依赖本地绝对路径识别同一个仓库。否则仓库换目录、换机器后，历史 knowledge 会像丢失一样。

建议 repo identity 的优先顺序为：

1. Git remote URL 的规范化结果
2. 仓库根目录的 Git 元数据指纹
3. 本地路径哈希（仅作为兜底）

## 写入规则

### 一、任务开始时

在创建 session knowledge 时固定写入：

- `goal`
- 初始 `plan`
- 初始 `state`
- 空的 `open-issues`
- 空的 `evidence`

要求：

- `goal` 必须是一句明确目标
- `plan` 必须是当前版本的计划摘要，而不是后续要 append 的日志
- `state` 必须回答“当前做到哪、下一步是什么、卡在哪里、最后一次可信结果是什么”
- 不能把长 PRD 原文直接抄进 knowledge

### 二、阶段推进时

只有触发以下事件时，才更新 `stage-*` / `open-issues` / `evidence`：

- 阶段完成
- 方向切换
- 失败重试
- 关键结论被推翻
- 新增阻塞问题
- 找到决定性证据

明确不记录：

- 每一次命令执行细节
- 所有中间聊天
- 不影响后续动作的临时观察

### 三、中断、失败、重试时的一致性规则

任务层最怕的问题不是“没写够”，而是“写得互相打架”。

需要固定最小更新顺序：

1. 先更新 `state`
2. 再更新 `open-issues` / `evidence`
3. 最后更新对应的 `stage-*`

如果任务在中途失败或被中断，至少要保证：

- `state` 是最新的
- `currentBlocker` 可读
- `lastReliableResult` 可读
- `final` 尚未生成时，不得提前把候选标记为已完成收口

### 四、任务结束时

结束时固定生成：

- `final`
- `candidates`

其中 `final` 负责概括：

- 最终结果
- 为什么是这个结果
- 是否还存在未关闭风险
- 哪些内容值得进入长期层

如果任务失败、超时或中途终止，仍然可以生成候选，但这些候选默认不能直接升级。它们必须带上更保守的 `stability` 和明确的 `lifecycle` 状态。

## 升级规则

长期层升级由统一规则控制，不允许每个 capability 自己发散解释。

### 一、升级到 `decisions`

至少满足以下 2 条：

- 已在当前任务中真实采用
- 会影响后续同类任务的做法
- 不是当前任务的临时 workaround
- 能明确说明为什么这么定

### 二、升级到 `failure-patterns`

至少满足以下 2 条：

- 不是一次性偶发事故
- 已出现重复迹象，或很可能反复出现
- 下次提前知道能明显节省时间或规避返工

对失败模式继续保留“重复两次再正式升级”的思路，但应把这条规则写进 runtime，而不是隐含在实现里。

这里需要额外补一条：

- `deferred` 的失败候选不能只留在 session 内

否则跨任务时无法稳定判断“这是第二次出现”。建议为 repo 级 deferred 候选保留一个轻量 registry，至少能按 `topicKey` 累积计数和来源 session。

### 三、升级到 `workflow-rules`

至少满足以下 2 条：

- 已被真实任务证明有效
- 适用范围可以说清
- 换一个 agent 或 reviewer 继续执行时仍然成立

### 四、禁止升级

以下内容禁止直接升级到长期层：

- 临时猜测
- 未验证结论
- 只针对一次特殊问题的应急处理
- 纯聊天过程
- 缺少依据的偏好表达

### 五、生命周期与退役

长期层不能只定义“怎么进”，还要定义“怎么退”。

建议最小生命周期状态至少包含：

- `active`
- `deferred`
- `superseded`
- `retired`

同时明确两类动作：

- 替换：旧条目被新条目接替，但保留来源关系
- 退役：旧条目不再建议使用，但保留历史记录

### 六、并发与统一写入

同一仓库下可能同时存在多个 `loop` / `harness` session，因此长期层写入必须统一收口。

需要固定两条规则：

1. session 不能直接覆盖现有长期条目
2. 同一 `topicKey` 的归并、升级、替换、退役只能由统一 runtime 判断

首版即使不做复杂锁机制，也应保证：

- 新候选先进入统一判定入口
- 发现同主题现有条目时，优先归并或标记冲突，而不是直接覆盖
- inspect / audit 至少能看到“谁覆盖了谁”或“谁与谁冲突”

## 读取规则

### 一、任务继续执行前的预读

任何 `loop resume`、新阶段执行、或 harness 新 cycle 开始前，都先读取并压缩以下上下文：

- goal
- state
- latest summary
- open issues
- evidence
- 最相关的长期 knowledge 摘要

目标不是把所有历史塞进 prompt，而是提供“接着做”所需的最小上下文。

### 二、repo 级长期知识的注入方式

长期层默认只注入最相关的少量条目，建议限制为：

- 最多 3 条 decision
- 最多 3 条 failure-pattern
- 最多 3 条 workflow-rule

匹配原则首版可保持简单：

- capability 类型
- `appliesTo` 与当前任务边界是否匹配
- `topicKey` / 标题关键词
- 最近一次使用时间

先不要在这一阶段引入重型检索系统。

### 三、冲突时的优先级

为避免长期层反过来误导当前任务，优先级必须写死：

1. 当前用户指令
2. 当前任务里已验证的新证据与最新状态卡
3. 当前任务目标与计划
4. 仓库长期 knowledge

也就是说，长期 knowledge 只能作为默认参考，不能覆盖当前任务里已经验证的新事实。

## 用户可见入口

### 一、保留并增强现有 session inspect

现有：

- `magpie loop inspect <sessionId>`
- `magpie harness inspect <sessionId>`

建议增强输出内容：

- Goal
- State
- Latest summary
- Open issues
- Evidence
- Promoted / deferred candidates
- Related repository knowledge（如果存在）

### 二、补一个 repo 级 inspect 入口

建议新增统一入口，例如：

- `magpie knowledge inspect`

用于查看当前仓库长期 knowledge 的摘要：

- decisions
- failure-patterns
- workflow-rules
- 最近新增项
- 待清理项

### 三、补一个 audit 入口

建议新增：

- `magpie knowledge audit`

首版只做只读检查，输出以下 5 类问题：

- 重复项
- 冲突项
- 过时项
- 孤儿项
- 缺失高频主题

## 体检机制（Knowledge Hygiene）

体检分两层：

### 一、轻量体检

触发时机：

- 每次任务结束后

检查内容：

- 当前 session 产出的候选项是否重复
- 是否存在无依据的候选项
- 是否存在已过时但仍被引用的长期项
- 是否出现“状态卡已更新，但摘要未跟上”的明显不一致

### 二、仓库级体检

触发时机：

- 手动执行 `magpie knowledge audit`
- 后续再考虑接入定期 workflow

检查内容：

- 相似标题或摘要导致的重复
- 对同一主题给出相反建议的冲突
- 长期未被引用且明显过时的条目
- 某类问题反复出现但没有长期规则覆盖的缺口

首版 audit 建议分两层落地：

- 第一层先做高置信度问题：明显重复、明显冲突
- 第二层再做依赖生命周期信息的问题：过时、孤儿、缺口

## 分阶段落地顺序

### Phase 0：冻结双层模型与命名

目标：先把“记什么、升什么、怎么读”写死，避免后续边做边漂。

范围：

- 明确 task knowledge 各文件职责
- 固定 `state.json` contract
- 扩展 candidate contract
- 固定 `topicKey`、`appliesTo`、生命周期字段
- 引入 `workflow-rule` 类型
- 固定 repo identity 生成规则
- 固定长期层目录和 index 结构

涉及文件：

- `src/knowledge/runtime.ts`
- `src/state/types.ts`
- `tests/knowledge/runtime.test.ts`
- `docs/plans/2026-04-11-dual-layer-knowledge-plan.md`

验收：

- 任务层和长期层术语在代码、测试、文档中一致
- 老 session 数据仍可读取
- 新类型不会破坏现有 decision / failure-pattern 流程
- 仓库换路径时有明确兜底规则

### Phase 1：补强任务层写入规则

目标：让 task knowledge 真正稳定服务续跑。

范围：

- 把 stage summary 的写入时机收紧到关键事件
- 增加 `state.json` 的生成与更新
- 明确 `plan`、`open-issues`、`evidence` 的更新职责
- 明确失败、中断、重试时的最小落盘顺序
- 让 loop / harness 都输出更稳定的 final summary

涉及文件：

- `src/capabilities/loop/application/execute.ts`
- `src/capabilities/workflows/harness/application/execute.ts`
- `src/knowledge/runtime.ts`
- `tests/capabilities/loop/loop.test.ts`
- `tests/capabilities/workflows/harness.test.ts`

验收：

- 同一 session 内不会出现明显重复或互相冲突的摘要
- `loop inspect` / `harness inspect` 能稳定看到目标、状态、最新总结、未决问题、证据
- 失败重试后仍能看出当前真实状态
- 中途打断后仍能恢复到最后一次可信状态

### Phase 2：把升级门槛收口到统一 runtime

目标：长期层升级不再由调用方自由发挥。

范围：

- 将 promotion gate 集中到 knowledge runtime
- 将 deferred 候选的 repo 级累积收口到统一位置
- 把 decision / failure-pattern / workflow-rule 的规则写成统一入口
- 保留 failure-pattern 的重复门槛
- 明确生命周期迁移：`active` / `deferred` / `superseded` / `retired`

涉及文件：

- `src/knowledge/runtime.ts`
- `tests/knowledge/runtime.test.ts`
- `tests/capabilities/loop/loop.test.ts`
- `tests/capabilities/workflows/harness.test.ts`

验收：

- 同一类候选在不同 capability 下行为一致
- 不满足条件的候选只能停留在 deferred
- 长期层目录和索引能正确反映三类内容
- 同一 `topicKey` 能跨任务稳定累积

### Phase 3：补齐读取入口与用户可见摘要

目标：让用户和 agent 都能看懂“现在有什么知识可用”。

范围：

- 增强 session inspect 输出
- 新增 repo inspect 命令
- 在 run / status / attach 输出中补充高价值 knowledge 信号
- 让输出能解释“为什么推荐这条长期 knowledge”

涉及文件：

- `src/cli/commands/knowledge.ts`
- `src/cli/commands/loop.ts`
- `src/cli/commands/harness.ts`
- 如需新增命令，再补对应 CLI 注册文件
- `tests/cli/loop-command.test.ts`
- `tests/cli/harness-command.test.ts`

验收：

- 用户能区分“这次任务的知识”和“仓库长期知识”
- inspect 输出里能直接看出已升级项和待升级项
- 不需要翻 session 目录也能知道知识现状
- 用户能看出当前推荐的长期 knowledge 是基于什么边界命中的

### Phase 4：增加知识体检

目标：防止长期层持续膨胀后失真。

范围：

- 新增 repo 级 audit 逻辑
- Phase 4A 先检查重复、冲突
- Phase 4B 再检查过时、孤儿和缺口
- 输出只读报告，先不做自动修复

涉及文件：

- `src/knowledge/runtime.ts` 或新增 `src/knowledge/audit.ts`
- `src/cli/commands/knowledge.ts` 或新增 top-level command
- `tests/knowledge/runtime.test.ts` 或新增 `tests/knowledge/audit.test.ts`

验收：

- 能针对一个已有 repo knowledge 目录输出结构化 audit 结果
- Phase 4A 至少能识别明显重复和明显冲突
- Phase 4B 基于生命周期信息识别明显过时项
- audit 不修改现有内容，只做提示

### Phase 5：逐步向其他 capability 扩展

目标：在双层模型稳定后，再考虑扩到 `review` / `discuss` / `trd`。

前置条件：

- 前四个阶段已经稳定
- session inspect / repo inspect / audit 已经可用
- 长期层没有明显失控增长

这一步不在当前实施范围内，只保留接口兼容性考虑。

## 验收指标

最小成功标准：

1. `loop` 和 `harness` 都能稳定输出结构一致的 task knowledge
2. 长期层至少支持 `decision`、`failure-pattern`、`workflow-rule`
3. 用户可以分别查看 session knowledge 和 repo knowledge
4. 系统可以发现重复、冲突、过时和缺口中的至少一部分
5. 任务异常中断后，恢复执行不依赖人工重新翻完整历史

建议观测指标：

- 单个 session 的 knowledge 摘要条目数是否稳定
- promoted / deferred 比例是否合理
- repo knowledge 被后续任务引用的频率
- audit 报告中的重复项是否持续下降
- 恢复执行时是否优先命中状态卡而不是回看大量摘要

## 风险与缓解

- 风险：把过程写得太重，反而拖慢执行  
  缓解：任务层只保留关键摘要，不记录流水账

- 风险：长期层门槛过低，导致垃圾沉淀  
  缓解：统一 promotion gate，默认保守升级

- 风险：长期层门槛过高，导致积累过慢  
  缓解：保留 deferred 状态，让候选先留下，再按体检和复现情况升级

- 风险：新增 `workflow-rule` 后结构变复杂  
  缓解：首版先保证语义独立，UI/目录按最小可用实现推进

- 风险：同一仓库多任务并发写入导致长期层互相覆盖  
  缓解：把长期层写入收口到统一 runtime，并在同主题归并前禁止直接覆盖

- 风险：仓库换目录后历史 knowledge 丢失  
  缓解：优先使用稳定 repo identity，不把本地路径作为唯一身份

- 风险：长期经验与当前任务新证据冲突，反而误导执行  
  缓解：固定优先级，当前任务已验证的新证据始终高于长期经验

## 最小实施建议

如果只做最有价值的第一批工作，建议按下面顺序推进：

1. Phase 0：冻结双层模型、补齐 candidate contract
2. Phase 1：收紧 task knowledge 写入规则
3. Phase 2：统一升级门槛
4. Phase 3：补 repo inspect
5. Phase 4A：先补高置信度 audit
6. Phase 4B：再补依赖生命周期的 audit

这条顺序的核心原因是：

- 没有统一模型，后面的 inspect / audit 都会失真
- 没有稳定写入，长期层升级出来的内容会不可信
- 没有 inspect，用户看不到价值
- 没有分层 audit，首版很容易承诺过多、误报过多
