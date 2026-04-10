# Harness 复杂度分级与模型路由

## 目标

给 `harness`、`loop`、`issue-fix`、`discuss` 增加统一的复杂度分级和模型路由能力。

- 简单任务走低成本模型
- 常规任务走默认执行模型
- 复杂任务自动切到高阶规划 / 审议角色
- 运行中遇到高风险、失败或反复打回时，只允许向上升档

## 分级规则

- `simple`
  - 优先 `gemini-cli`
- `standard`
  - 优先 `codex`
- `complex`
  - 规划 / 审议：`kiro` + `architect`
  - 执行 / 修复：`kiro` + `dev`

基础评分信号：

- 目标或 PRD 长度
- 计划任务数和依赖数
- 涉及阶段数
- 高风险关键词：`auth`、`payment`、`migration`、`security`、`database`、`public API`、`performance`、`concurrency`
- 是否跨多个子系统
- 是否包含回滚、兼容、数据变更、外部集成

默认阈值：

- `0-2` -> `simple`
- `3-5` -> `standard`
- `6+` -> `complex`

## 固定 reviewer

自动路由和手工 `discuss` 共用三组稳定 reviewer：

- `route-gemini`
- `route-codex`
- `route-architect`

对应关系：

- `route-gemini` -> `gemini-cli`
- `route-codex` -> `codex`
- `route-architect` -> `kiro` + `architect`

自动 reviewer pool：

- `simple` -> `route-gemini,route-codex`
- `standard` -> `route-codex,route-architect`
- `complex` -> `route-gemini,route-codex,route-architect`

## 链路接入

`workflow harness`

- 启动前做首轮复杂度判断
- 自动写出 `routing-decision.json`
- 开发和修复链路按 tier 绑定规划 / 执行模型
- 未手工传 `--models` 时，评审 reviewer pool 也自动跟随 tier
- 每轮评审后可按阻塞问题、失败测试和连续 `revise` 升档

`loop` / `issue-fix`

- 开启 `capabilities.routing.enabled` 后自动应用复杂度路由
- 支持 `--complexity` 手工覆盖
- 保留旧 `planner_model` / `executor_model` 作为关闭路由时回退

`discuss`

- 传了 `--reviewers` 就完全按手工指定
- 没传 `--reviewers` 且启用自动路由时，按 topic 复杂度自动选 reviewer pool

## 评审命令

```bash
magpie discuss ./docs/plans/2026-04-10-harness-complexity-routing.md \
  --reviewers route-gemini,route-codex,route-architect \
  --plan-report
```
