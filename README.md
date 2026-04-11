# Magpie

Magpie 是一个面向工程协作的多模型 CLI。它把代码评审、技术讨论、TRD 生成、目标闭环执行和若干工程 workflow 收到一个本地入口里。

## 先看哪里

- 文档总览：[`docs/README.md`](./docs/README.md)
- 总体结构：[`ARCHITECTURE.md`](./ARCHITECTURE.md)
- 能力对照：[`docs/references/capabilities.md`](./docs/references/capabilities.md)
- 历史计划：[`docs/plans/`](./docs/plans/)

## 核心能力

- `review`：多 AI 代码评审
- `discuss`：多模型讨论
- `trd`：PRD 转 TRD
- `loop`：目标驱动的阶段化执行
- `harness`：需求到交付的闭环入口
- `workflow issue-fix`、`docs-sync`、`post-merge-regression`
- `tui`：任务工作台
- `init`、`reviewers list`、`stats`

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
# 1) 生成配置
magpie init

# 2) 查看入口
magpie tui

# 3) 评审改动
magpie review --local

# 4) 多模型讨论
magpie discuss "Should this repo fully migrate review to capability runtime?"

# 5) 生成 TRD
magpie trd ./docs/prd.md

# 6) 目标闭环执行
magpie loop run "Deliver checkout v2" --prd ./docs/prd.md

# 7) harness 闭环
magpie harness submit "Deliver checkout v2" --prd ./docs/prd.md
```

从源码运行：

```bash
npm run dev -- --help
```

## 仓库结构

- `src/cli/`：命令入口和参数解析
- `src/capabilities/`：当前主干能力实现
- `src/core/`：公共运行基础
- `src/platform/`：provider、配置与外部集成
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

改命令、结构或主要能力时，至少同步更新相关入口文档，并运行：

```bash
npm run check:docs
```
