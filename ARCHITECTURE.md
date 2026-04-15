# Magpie Architecture

Magpie 是一个面向工程协作的本地 CLI。它把评审、讨论、TRD 生成、闭环执行和工程 workflow 放到同一个入口里，同时把不同模型、外部集成和会话状态收拢到统一运行时。

## 从哪里看起

- 产品入口和常用命令：[`README.md`](./README.md)
- 文档总览：[`docs/README.md`](./docs/README.md)
- 能力说明与主要落点：[`docs/references/capabilities.md`](./docs/references/capabilities.md)

## 系统分层

### 1. CLI 入口

`src/cli/` 负责命令注册、参数解析和用户入口。这里决定用户能执行哪些命令，但不承接具体业务规则。

### 2. 能力层

`src/capabilities/` 是当前主干。每个能力围绕单一目标组织，例如 `review`、`discuss`、`trd`、`loop`、`workflows/*`，以及为长流程托管准备的 `workflows/harness-server`。

这一层负责：

- 接收标准化输入
- 组织能力内部流程
- 产出统一结果

### 3. 核心层

`src/core/` 放通用运行机制，例如上下文、辩论、状态、仓库访问、`src/core/roles/` 这类共享角色编排基础，以及共享失败分类、失败账本和恢复决策。它给能力层提供基础积木，不反向依赖具体能力。

### 4. 平台与集成层

`src/platform/` 负责外部世界，包括：

- provider 配置与加载
- 通知、规划、操作等集成
- 初始化与配置读写

### 5. 知识与记忆层

`src/knowledge/` 和 `src/memory/` 负责两类持续信息：

- 会话级知识：给 `loop`、`harness` 这类长流程提供可恢复的摘要和状态
- 长期记忆：把稳定结论沉淀到用户记忆和项目记忆里

### 6. 兼容与历史模块

仓库中还保留了 `src/commands/`、`src/orchestrator/`、`src/providers/` 等较早模块。当前新能力优先走 `src/cli/ + src/capabilities/ + src/core/ + src/platform/` 这条主路径；旧模块主要承担兼容、过渡或已有实现复用。

## 典型执行路径

1. 用户从 `magpie <command>` 进入 `src/cli/`
2. CLI 把请求路由到对应能力
3. 能力层按场景组织上下文、模型、状态和输出
4. 核心层、平台层、知识与记忆层提供基础能力、外部接入和持久信息
5. 结果回到 CLI 或会话存储，再由用户查看、恢复或继续执行

`harness` 现在有两种运行路径：

1. 直接执行：`magpie harness submit` 直接在当前命令里跑完整个闭环
2. 后台托管：`magpie harness-server start` 启动常驻服务后，`magpie harness submit` 只负责入队，后台服务按顺序取任务执行，并把状态持续写回仓库内 `.magpie/`

失败观测也走同一条分层：

- `loop` 只负责自己内部阶段的失败事实
- `harness` 只补外层 workflow 失败，不重写内层细粒度判定
- `harness-server` 只负责托管异常、重试和恢复问题
- 统一分类、失败落盘和仓库级聚合收敛到 `src/core/failures/` 与 workflow shared runtime

## 边界规则

仓库当前最重要的边界约束已经写成可执行检查，脚本在 [`scripts/check-boundaries.mjs`](./scripts/check-boundaries.mjs)。

它重点限制：

- `src/core/`、`src/platform/`、`src/shared/` 不直接依赖具体能力
- 各能力之间不直接互相依赖
- `src/cli/` 只能依赖允许的上层模块

这保证了 CLI、能力、核心和平台职责不会混在一起。

## 改动时怎么找位置

- 改命令入口：优先看 `src/cli/commands/`
- 改能力行为：优先看 `src/capabilities/`
- 改后台任务托管、重试或队列行为：优先看 `src/capabilities/workflows/harness-server/`
- 改公共运行机制：优先看 `src/core/`
- 改共享角色、轮次产物和交接记录：优先看 `src/core/roles/`
- 改 provider、通知、规划、配置：优先看 `src/platform/`
- 改会话摘要、inspect 视图、长期记忆：优先看 `src/knowledge/`、`src/memory/`
- 改历史实现或兼容逻辑：再看 `src/commands/`、`src/orchestrator/`、`src/providers/`

## 文档原则

这个仓库现在把 `docs/` 作为项目知识入口，而不是继续把所有说明都堆到 `README`。

- `README.md` 负责快速上手
- `AGENTS.md` 负责带路和最重要的工作规则
- `docs/README.md` 负责文档索引
- `docs/references/` 负责稳定参考信息
- `docs/plans/` 负责设计和计划历史
