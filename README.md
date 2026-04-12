# Magpie

Magpie 是一个面向工程协作的多模型 CLI。它把代码评审、技术讨论、TRD 生成、目标闭环执行和工程 workflow 收到一个本地入口里。

## 先看哪里

- 文档总览：[`docs/README.md`](./docs/README.md)
- 总体结构：[`ARCHITECTURE.md`](./ARCHITECTURE.md)
- 能力对照：[`docs/references/capabilities.md`](./docs/references/capabilities.md)
- 历史计划：[`docs/plans/`](./docs/plans/)

## 核心能力

- `review`：多 AI 代码评审
- `discuss`：多模型讨论
- `trd`：PRD 转 TRD，并产出可机读的约束文件
- `loop`：目标驱动的阶段化执行，简单任务会先过规则再先跑失败测试
- `harness`：需求到交付的闭环入口
- `workflow issue-fix`、`docs-sync`、`post-merge-regression`
- `memory`：查看、编辑、提炼用户记忆和项目记忆
- `tui`：任务工作台
- `init`、`reviewers list`、`stats`

更细的命令入口和代码位置见 [`docs/references/capabilities.md`](./docs/references/capabilities.md)。

## 安装

前置依赖：

- Node.js 18+
- Git
- 如果要评审 GitHub PR 或发布评论，建议安装并登录 `gh`
- 如果要使用 CLI provider，需要本机已安装对应 CLI 并完成登录

安装步骤：

```bash
npm install
npm run build
npm link
```

启用仓库自带提交钩子：

```bash
./scripts/setup_git_hooks.sh
```

## 快速开始

```bash
# 1) 生成或升级配置
magpie init

# 2) 打开任务入口
magpie tui

# 3) 评审本地改动
magpie review --local

# 4) 多模型讨论
magpie discuss "Should this repo fully migrate review to capability runtime?"

# 5) 生成 TRD
magpie trd ./docs/prd.md

# 6) 目标闭环执行
magpie loop run "Deliver checkout v2" --prd ./docs/prd.md

# 7) harness 闭环
magpie harness submit "Deliver checkout v2" --prd ./docs/prd.md

# 8) 需要后台托管时显式交给 tmux
magpie loop run "Deliver checkout v2" --prd ./docs/prd.md --host tmux

# 9) 查看长期记忆
magpie memory show --project
```

`trd` 会把当前仓库可执行的最小约束落到 `.magpie/constraints.json`。`loop` 在进入开发前会先读取这份约束；对适合的小任务，会先确认测试先失败，再继续往下做。后面如果测试还是没过，它会先按小次数继续尝试；超过阈值后才停下来等人处理。

`loop` 在自动提交时会用 AI 生成中文提交信息；默认跟随执行模型，也可通过 `capabilities.loop.auto_commit_model` 单独覆盖。

`trd`、`loop`、`harness` 以及 workflow 会话产物默认写到当前仓库的 `.magpie/sessions/<capability>/<sessionId>/`，便于在仓库内查看、续跑和交给 TUI 展示。

从源码运行：

```bash
npm run dev -- --help
```

## 仓库结构

- `src/cli/`：命令入口和参数解析
- `src/capabilities/`：当前主干能力实现
- `src/core/`：公共运行基础
- `src/platform/`：provider、配置与外部集成
- `src/knowledge/`、`src/memory/`：会话知识和长期记忆
- `src/tui/`：任务工作台
- `tests/`：测试
- `docs/`：项目文档和设计历史
- `dist/`：编译产物，不手改

更细的职责说明见 [`ARCHITECTURE.md`](./ARCHITECTURE.md)。

## 常用开发命令

```bash
npm run dev -- review 12345
npm run test:run
npm run test:coverage
npm run build
npm run lint
npm run check:boundaries
npm run check:docs
```

## 文档约定

- 快速上手和常用命令放在 `README.md`
- 做事入口和最低规则放在 `AGENTS.md`
- 项目结构和边界放在 `ARCHITECTURE.md`
- 能力说明放在 `docs/references/`
- 设计和计划历史放在 `docs/plans/`

改命令、结构或主要能力时，至少同步更新对应入口文档，并运行：

```bash
npm run check:docs
```
