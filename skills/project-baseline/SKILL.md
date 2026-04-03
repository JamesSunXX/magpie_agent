# Project Baseline Skill (Magpie)

## Purpose

这个技能定义本项目默认执行规则，目标是减少人工确认，按固定方式自驱动推进。

## Default Rules

1. `loop run` 默认使用 `codex`
2. 默认关闭人工等待：`--no-wait-human`
3. 运行时必须做实时监控，不允许“只发命令不跟踪”
4. 非高风险收尾动作直接执行，不重复询问

## Standard Execution Command

```bash
MAGPIE_CODEX_TIMEOUT_MS=120000 magpie loop run "<goal>" --prd <spec-or-prd-path> --no-wait-human --config <config-path>
```

要求：配置里 `capabilities.loop.planner_model` 与 `executor_model` 都设为 `codex`。

如果本机 `codex` 全局命令异常，使用应用内二进制优先：

```bash
PATH="/Applications/Codex.app/Contents/Resources:$PATH" MAGPIE_CODEX_TIMEOUT_MS=120000 magpie loop run "<goal>" --prd <spec-or-prd-path> --no-wait-human --config <config-path>
```

## Real-Time Monitoring Checklist

执行后必须同时监控：

1. 进程是否存活
2. `~/.magpie/loop-sessions/` 是否创建新会话目录
3. 会话文件/事件文件是否持续更新
4. 是否生成 `human_confirmation.md`（若策略误开）

推荐命令：

```bash
ps -axo pid,etime,command | rg "src/cli.ts loop run|codex exec"
ls -lt ~/.magpie/loop-sessions | head
find ~/.magpie/loop-sessions -maxdepth 2 -type f | head
```

项目内置脚本（推荐）：

```bash
./scripts/loop-monitor.sh
```

## Failure Handling (No User Ping by Default)

若 `codex` 健康检查失败（例如服务 5xx、认证失败、长时间无响应）：

1. 立即记录错误摘要
2. 自动停止当前阻塞执行
3. 保留现场（命令、时间、错误输出）
4. 自动重试一次（短间隔）
5. 若仍失败，再返回汇报

## Reporting Format

汇报必须包含：

1. 执行了什么
2. 当前状态（进行中/已完成/失败）
3. 失败时的明确原因
4. 下一步自动动作或阻塞点
