# Loop 阶段与工具沟通设计

## 背景

当前 `loop` 的默认阶段是：

1. `prd_review`
2. `domain_partition`
3. `trd_generation`
4. `code_development`
5. `unit_mock_test`
6. `integration_test`

这套阶段名能表达大方向，但存在三个明显问题：

1. 前三段边界偏虚，分别该交付什么不够清楚。
2. `code_development` 过于臃肿，把准备开发、确认失败基线、真正改代码、实现后补修和继续判断都混在一起。
3. 后两段虽然名义上是验证阶段，但失败后又会继续返工，阶段身份和返工语义不够清楚。

同时，当前工具分工也偏隐含：

- `claude-code` 默认承担 planner / 阶段评估职责
- `codex` 默认承担 executor / 开发执行职责
- `gemini-cli` 主要出现在 reviewer / challenge 路径
- `kiro-cli` 主要出现在超时兜底或异常接管路径

这使得“每个阶段如何在工具之间交接”难以清晰表达，也不利于后续做按阶段配置。

## 目标

本次设计要达到下面几个目标：

1. 保留前置三段，但把每段交付物说清楚。
2. 把 `code_development` 拆成更明确的正式阶段。
3. 保留后置验证阶段“允许返工”的能力，但明确返工语义。
4. 把 `claude-code`、`codex`、`gemini-cli`、`kiro-cli` 的默认沟通模型固定下来。
5. 支持按正式阶段配置工具，不在第一版里为异常分支单独配一套规则。
6. 让下一个工具默认只接收结构化交接卡和必要证据，而不是无边界地继承整段上下文。

## 非目标

本次明确不做：

1. 不重构 `harness` 外层流程。
2. 不把四个工具做成完全对等、任意动态切换的协作系统。
3. 不在第一版里给“超时接管”“开发返工”“验证返工”等异常分支单独加配置层。
4. 不直接改具体实现，只先收敛阶段和沟通设计。

## 核心决策

### 1. 前三段保留，但改成“决策卡”风格

前置三段不合并：

- `prd_review`
- `domain_partition`
- `trd_generation`

但每段都必须产出一张可交接给下一阶段的结构化卡片，而不是泛泛的长文说明。

### 2. `code_development` 拆成四段

原来的 `code_development` 拆成：

1. `dev_preparation`
2. `red_test_confirmation`
3. `implementation`
4. `green_fixup`

这四段分别承接：

- 确认约束和本轮入口
- 确认失败基线
- 真正实施改动
- 实现后的补修与交棒准备

### 3. 后置验证继续允许返工，但返工身份不再模糊

后置验证保留：

- `unit_mock_test`
- `integration_test`

它们失败后仍允许继续补修，但要明确记录成：

- 验证返工
- 联调返工

而不是把失败重新冲淡成普通开发阶段。

### 4. 工具沟通模型采用“主执行 + 复核 + 救援”

默认沟通模型为：

- `claude-code`：前三段决策卡 + 阶段裁定
- `codex`：开发主执行
- `gemini-cli`：关键阶段复核、挑战、争议判断
- `kiro-cli`：开发返工、异常轮次接管、救援

但这不是写死绑定。第一版支持按正式阶段配置：

- `primary`
- `reviewer`
- `rescue`

异常分支先继承所属正式阶段的配置。

## 新阶段骨架

新的 `loop` 正式阶段定义为 9 段：

| 阶段 | 目标 | 主要交付物 |
| --- | --- | --- |
| `prd_review` | 明确需求事实和验收口径 | 需求决策卡 |
| `domain_partition` | 拆分子任务、边界、依赖 | 拆分卡 |
| `trd_generation` | 固化执行方案、验证方式、回退策略 | 执行卡 |
| `dev_preparation` | 明确本轮改动范围和开发入口 | 开发入口卡 |
| `red_test_confirmation` | 证明问题存在、测试入口可用 | 失败基线卡 |
| `implementation` | 进行主要代码改动 | 实现结果卡 |
| `green_fixup` | 实现后补修、自检、整理交接 | 补修交接卡 |
| `unit_mock_test` | 执行近距离验证 | 验证结果卡 |
| `integration_test` | 执行更高层验证 | 联调结果卡 |

## 每阶段默认工具接力

### 前置三段

| 阶段 | 默认 primary | 默认 reviewer | 默认 rescue | 默认输出 |
| --- | --- | --- | --- | --- |
| `prd_review` | `claude-code` | `gemini-cli` | `kiro-cli` | 需求决策卡 |
| `domain_partition` | `claude-code` | `gemini-cli` | `kiro-cli` | 拆分卡 |
| `trd_generation` | `claude-code` | `gemini-cli` | `kiro-cli` | 执行卡 |

默认规则：

1. `claude-code` 主导卡片生成。
2. `gemini-cli` 负责挑战、补充风险和疑点。
3. 阶段进入下一棒前，由阶段裁定逻辑确认卡片可交接。

### 中间四段

| 阶段 | 默认 primary | 默认 reviewer | 默认 rescue | 默认输出 |
| --- | --- | --- | --- | --- |
| `dev_preparation` | `claude-code` | `codex` | `kiro-cli` | 开发入口卡 |
| `red_test_confirmation` | `codex` | `claude-code` | `kiro-cli` | 失败基线卡 |
| `implementation` | `codex` | `gemini-cli` | `kiro-cli` | 实现结果卡 |
| `green_fixup` | `codex` | `claude-code` | `kiro-cli` | 补修交接卡 |

默认规则：

1. `dev_preparation` 由 `claude-code` 把执行卡进一步压缩成本轮开发入口。
2. `red_test_confirmation` 和 `implementation` 以 `codex` 为主执行。
3. `gemini-cli` 不默认深度参与每个开发动作，而是在关键开发阶段承担挑战和复核。
4. `kiro-cli` 既是超时兜底，也承担返工或异常轮次接管。

### 后置两段

| 阶段 | 默认 primary | 默认 reviewer | 默认 rescue | 默认输出 |
| --- | --- | --- | --- | --- |
| `unit_mock_test` | 阶段配置决定 | `gemini-cli` | `kiro-cli` | 验证结果卡 |
| `integration_test` | 阶段配置决定 | `gemini-cli` | `kiro-cli` | 联调结果卡 |

默认规则：

1. 后置验证仍按正式阶段执行，不退化成“附属步骤”。
2. 验证失败时允许继续补修，但必须记录为验证返工或联调返工。
3. `claude-code` 继续负责阶段裁定，避免验证失败后工具自己无限续跑。

## 阶段交接卡

### 基本原则

每个阶段结束时，都必须产出一张结构化交接卡。

下一个工具默认只接收：

1. 当前阶段交接卡
2. 必要证据
3. 被明确标记为“下一阶段最少输入”的补充上下文

默认不把上一阶段的完整长上下文无约束传给下一个工具。

这样做的目的不是单纯压缩输入，而是降低工具在脏上下文里各自展开、互相污染判断的风险。

### 交接卡最少字段

每张交接卡至少包含：

1. `stage`：当前阶段名
2. `goal`：这一阶段想解决什么
3. `work_done`：实际做了什么
4. `result`：`passed` / `rework` / `blocked`
5. `next_stage`：下一阶段是谁
6. `next_input_minimum`：下一阶段最少需要知道什么
7. `open_risks`：未解决风险
8. `evidence_refs`：证据路径或摘要

### 阶段特定补充字段

不同阶段可在固定字段之外追加内容：

- `prd_review`：范围、验收口径、主要疑点
- `domain_partition`：子任务、边界、依赖、优先级
- `trd_generation`：执行方案、验证方式、回退方案
- `dev_preparation`：目标文件、改动范围、入口命令
- `red_test_confirmation`：失败命令、失败摘要、失败证据
- `implementation`：关键改动点、受影响文件、未完成点
- `green_fixup`：补修结果、自检结论、建议验证顺序
- `unit_mock_test`：验证通过项、失败项、返工建议
- `integration_test`：联调通过项、阻塞项、返工建议

## 配置模型

### 配置原则

第一版只按正式阶段配置工具，不按异常分支单独配置。

每个正式阶段支持 3 个角色：

- `primary`
- `reviewer`
- `rescue`

其中：

- `primary`：主说或主执行
- `reviewer`：复核、挑战、争议判断
- `rescue`：超时接管、返工接管、异常接管

### 建议配置形态

```yaml
loop:
  stages:
    prd_review:
      primary: claude-code
      reviewer: gemini-cli
      rescue: kiro-cli
    implementation:
      primary: codex
      reviewer: gemini-cli
      rescue: kiro-cli
    integration_test:
      primary: codex
      reviewer: gemini-cli
      rescue: kiro-cli
```

这意味着：

1. 正常主线只看正式阶段配置。
2. 异常处理优先继承当前正式阶段的 `rescue` 配置。
3. 如果某阶段需要完全换人，只改该阶段绑定，不必改整套 loop 的全局 planner / executor 定义。

## 异常与返工规则

### 1. 超时或执行事故

处理规则：

1. 先交给当前阶段的 `rescue` 工具接管。
2. `rescue` 接管后仍要产出同一种交接卡。
3. 如果 `rescue` 也无法完成，再由阶段裁定逻辑决定：
   - 继续返工
   - 标记阻塞
   - 转人工确认

### 2. 开发返工

开发返工不再退回模糊的“大开发阶段”。

应按原因回流到：

- `implementation`
- `green_fixup`

并继续沿用该正式阶段的配置。

### 3. 验证返工

后置验证失败后：

1. 阶段身份保持不变。
2. 会话中明确标记为验证返工或联调返工。
3. 返工完成后仍回到当前验证阶段重新确认，不伪装成普通开发完成。

## 与当前实现的差异

这套设计相对当前实现的主要差异是：

1. 阶段数从 6 段变成 9 段。
2. 取消单一笼统的 `code_development`，改为四个正式阶段。
3. 把前三段的输出从“说明性内容”提升为结构化交接卡。
4. 把工具绑定从当前的偏全局 planner / executor，改为按正式阶段读取。
5. 把异常处理从“遇到问题再临时换路”，收敛成继承正式阶段 `rescue` 的规则。

## 落地边界

### 文档侧

需要同步更新的内容：

1. `loop` 能力说明文档
2. 新阶段与交接卡字段说明
3. 按阶段配置 `primary / reviewer / rescue` 的配置说明

### 实现侧

预计涉及：

1. 阶段枚举与阶段执行顺序
2. 当前 planner / executor 的读取方式
3. 阶段交接卡的持久化结构
4. fallback / rescue 接管逻辑
5. 后置验证返工语义

## 风险与控制

### 风险

1. 阶段数增加后，状态机会更复杂。
2. 按阶段配置工具会让配置读取链更长。
3. 交接卡字段如果定义不稳，容易变成另一套松散文档。

### 控制

1. 只给正式阶段加配置，不给异常分支额外开新层。
2. 所有异常轮次先继承正式阶段规则。
3. 交接卡固定最少字段，阶段只允许追加少量专属字段。
4. 保持“阶段先行”，不做完全动态化的工具调度。

## 验证建议

方案落地后，至少要验证：

1. 阶段顺序是否能覆盖当前 loop 主线。
2. 按阶段配置是否能覆盖默认 `claude-code / codex / gemini-cli / kiro-cli` 分工。
3. `rescue` 是否能正确继承正式阶段配置。
4. 开发返工与验证返工是否能保持清晰的阶段身份。
5. 交接卡是否足够支撑下一个工具继续执行，而不需要重新读取整段旧上下文。
