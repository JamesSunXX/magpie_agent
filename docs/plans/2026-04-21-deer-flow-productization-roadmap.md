# DeerFlow 借鉴需求产品化迭代记录

这轮不扩展飞书以外的聊天入口，也不重写 Magpie 架构。目标是把已有的隔离、观测、恢复和飞书能力做成更好上手、更好控制、更好理解的入口。

## 已落地范围

- `magpie init` 增加使用场景：本地开发、团队协作、后台托管。
- `magpie doctor` 增加整体可用状态和下一步动作。
- 新增 `magpie status`，聚合最近 loop / harness 任务状态、失败原因和下一步动作。
- 新增 `magpie skills`，支持查看、检查、启用、禁用本地任务技能。
- `loop` / `harness` 的 `tool-manifest.json` 增加技能记录；技能依赖缺失时会在任务开始前停止。
- 新增多助手协作模板，用于说明小任务、正式需求、故障修复、文档同步里的角色职责。
- `harness inspect` 和 TUI 都会展示 harness 会话的协作模板、参与角色、结论和下一步。
- 飞书状态回复复用统一状态摘要规则。

## 不做项

- 不新增 Slack、微信、企业微信、Telegram 等 IM。
- 不做远程技能市场或在线安装。
- 不做复杂可视化编排。
- 不替换现有 `loop` / `harness` 主流程。

## 验证

- 新增和调整的行为由 CLI、技能、状态、角色模板和飞书状态测试覆盖。
- 收口验证继续按仓库规则执行 `npm run test:run`、`npm run test:coverage`、`npm run build`、`npm run lint`、`npm run check:boundaries`、`npm run check:docs`。
