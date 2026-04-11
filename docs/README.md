# Magpie Docs

这里是项目文档入口。需要快速了解项目时，按下面顺序看。

## 阅读顺序

1. [`../README.md`](../README.md)：项目是什么，怎么安装，怎么跑常用命令
2. [`../ARCHITECTURE.md`](../ARCHITECTURE.md)：项目怎么分层，改动应该落到哪里
3. [`./references/capabilities.md`](./references/capabilities.md)：每类能力负责什么、主要代码在哪

## 文档地图

| 文档 | 作用 |
| --- | --- |
| [`../README.md`](../README.md) | 快速上手和常用命令 |
| [`../AGENTS.md`](../AGENTS.md) | 做事入口和最重要的工作规则 |
| [`../ARCHITECTURE.md`](../ARCHITECTURE.md) | 总体结构、边界和改动落点 |
| [`./references/capabilities.md`](./references/capabilities.md) | 核心能力与代码位置对照 |
| [`./plans/`](./plans/) | 设计和计划历史 |
| [`./channels/`](./channels/) | 渠道或集成的专项说明 |
| [`./superpowers/`](./superpowers/) | 更细的内部设计资料 |

## 什么时候更新哪份文档

- 改安装、启动方式、常用命令：更新 `README.md`
- 改项目结构、主路径、边界：更新 `ARCHITECTURE.md`
- 改能力入口、职责或主要文件位置：更新 `docs/references/capabilities.md`
- 改协作规则或最低交付要求：更新 `AGENTS.md`
- 做较大方案设计或实现规划：在 `docs/plans/` 追加新文档

## 最低要求

- `README.md`、`AGENTS.md`、`ARCHITECTURE.md`、`docs/README.md`、`docs/references/capabilities.md` 必须一直存在
- 这几份入口文档之间必须互相连得上
- 改文档结构后，运行 `npm run check:docs`
