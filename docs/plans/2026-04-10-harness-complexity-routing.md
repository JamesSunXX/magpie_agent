# Harness 复杂度分级与模型路由

## 目标

给 `harness`、`loop`、`issue-fix`、`discuss` 增加统一的复杂度分级和模型路由能力，并补上“工具 + 工具内部模型 + `kiro` agent”三层选择。

- 简单任务走低成本工具
- 常规任务走默认执行工具
- 复杂任务自动切到高阶规划 / 审议角色
- 运行中遇到高风险、失败或反复打回时，只允许向上升档
- 每个档位都可以单独指定 `tool`、`model`、`agent`

## 分级规则

- `simple`
  - 默认 `tool: gemini`
- `standard`
  - 默认 `tool: codex`
- `complex`
  - 规划 / 审议：`tool: kiro` + `agent: architect`
  - 执行 / 修复：`tool: kiro` + `agent: dev`

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

## 绑定结构

路由绑定和 reviewer 配置统一使用下面的结构：

```yaml
tool: codex | gemini | claude | kiro | claw
model: gpt-5.4 | gemini-2.5-pro | claude-sonnet-4-6 | ...
agent: architect | dev | ...
```

规则：

- `tool` 选择 CLI 工具
- `model` 选择该工具内部实际运行的模型
- `agent` 目前只对 `kiro` 生效
- 如果只写 `tool`，则沿用工具自己的默认模型
- 如果没有 `tool`，则保留旧行为，按 `model` 字符串继续解释

工具别名：

- `claude` -> `claude-code`
- `gemini` -> `gemini-cli`
- `codex`、`kiro`、`claw` 保持不变

兼容规则：

- 新写法优先：`tool + model + agent`
- 老写法继续可用：`model: codex`、`model: gemini-cli`、`model: kiro`、`model: claw`
- 非 `kiro` 工具如果配置了 `agent`，配置加载阶段直接报错

## 固定 reviewer

自动路由和手工 `discuss` 共用三组稳定 reviewer：

- `route-gemini`
- `route-codex`
- `route-architect`

默认写法：

```yaml
reviewers:
  route-gemini:
    tool: gemini
  route-codex:
    tool: codex
  route-architect:
    tool: kiro
    agent: architect
```

自动 reviewer pool：

- `simple` -> `route-gemini,route-codex`
- `standard` -> `route-codex,route-architect`
- `complex` -> `route-gemini,route-codex,route-architect`

## 链路接入

`workflow harness`

- 启动前做首轮复杂度判断
- 自动写出 `routing-decision.json`
- 开发和修复链路按 tier 绑定规划 / 执行工具
- 未手工传 `--models` 时，评审 reviewer pool 也自动跟随 tier
- 每轮评审后可按阻塞问题、失败测试和连续 `revise` 升档

`loop` / `issue-fix`

- 开启 `capabilities.routing.enabled` 后自动应用复杂度路由
- 支持 `--complexity` 手工覆盖
- 保留旧 `planner_model` / `executor_model` 作为关闭路由时回退
- 路由命中时可额外写入 `planner_tool` / `executor_tool`

`discuss`

- 传了 `--reviewers` 就完全按手工指定
- 没传 `--reviewers` 且启用自动路由时，按 topic 复杂度自动选 reviewer pool

## 配置示例

```yaml
capabilities:
  routing:
    reviewer_pools:
      simple: [route-gemini, route-codex]
      standard: [route-codex, route-architect]
      complex: [route-gemini, route-codex, route-architect]
    stage_policies:
      planning:
        simple:
          tool: gemini
          model: gemini-2.5-flash
        standard:
          tool: codex
          model: gpt-5.4
        complex:
          tool: kiro
          model: claude-sonnet-4-6
          agent: architect
      execution:
        simple:
          tool: gemini
        standard:
          tool: codex
        complex:
          tool: kiro
          model: claude-sonnet-4-6
          agent: dev
    fallback_chain:
      planning:
        complex:
          - tool: codex
            model: gpt-5.4
          - tool: gemini
            model: gemini-2.5-pro
```

## 评审命令

```bash
magpie discuss ./docs/plans/2026-04-10-harness-complexity-routing.md \
  --reviewers route-gemini,route-codex,route-architect \
  --plan-report
```
