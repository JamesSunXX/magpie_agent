# 仓库评审断点恢复方案

## 目标

让 `magpie review --repo` 在限流、进程中断或机器重启后，能够从上一个已经完成并落盘的轮次继续，而不是重复前面的轮次，也不会在轮次没核齐时提前生成最终总结。

## Skill Definition

### 名称

`review-checkpoint-supervisor`

### 触发时机

- 启动仓库级评审时
- 恢复已有评审会话时
- 生成最终总结前

### 责任

1. 扫描未完成会话
2. 读取 `.magpie/state/<session_id>/round_<N>.json`
3. 如果老会话只有 `session.json` 进度，没有轮次文件，则从已保存进度补写缺失轮次
4. 只按“连续、已完成、featureId 对得上”的轮次来恢复进度
5. 只有全部轮次都核齐后，才允许生成最终总结

### 约束

- 每一轮 reviewer 调用都必须是独立会话，不复用上一轮上下文
- 每轮完成后先写 `round_<N>.json`，再更新 `session.json`
- 最终总结不能把 `session.json` 里的“自报完成”当成真完成，必须看轮次文件

## State Schema

### 会话主文件

位置：`.magpie/sessions/<session_id>.json`

新增字段：

```json
{
  "checkpointing": {
    "stateDir": ".magpie/state/<session_id>",
    "totalRounds": 8,
    "lastCompletedRound": 3,
    "lastVerifiedRound": 3,
    "finalSummaryVerifiedAt": "2026-04-12T12:34:56.000Z"
  }
}
```

### 逐轮文件

位置：`.magpie/state/<session_id>/round_<N>.json`

```json
{
  "schemaVersion": 1,
  "sessionId": "64fbe573-cd83-4374-a75f-69f7d5fb01c9",
  "roundNumber": 4,
  "featureId": "harness",
  "featureName": "Harness",
  "status": "completed",
  "origin": "live",
  "focusAreas": ["security", "performance"],
  "filePaths": ["src/capabilities/workflows/harness/application/execute.ts"],
  "reviewerOutputs": [
    {
      "reviewerId": "codex",
      "provider": "codex",
      "startedAt": "2026-04-12T12:30:00.000Z",
      "completedAt": "2026-04-12T12:31:12.000Z",
      "output": "raw reviewer output",
      "issuesParsed": 2
    }
  ],
  "result": {
    "featureId": "harness",
    "issues": [],
    "summary": "Found 2 issues in Harness",
    "reviewedAt": "2026-04-12T12:31:12.000Z"
  },
  "completedAt": "2026-04-12T12:31:12.000Z"
}
```

### `origin` 含义

- `live`：本轮真实执行结束后立刻写入
- `recovered_from_session`：老会话没有轮次文件，启动监督器时从旧进度补写

## 恢复流程

1. 启动 `review --repo`
2. 监督器扫描未完成会话
3. 如果找到历史会话：
   - 先读轮次文件
   - 不足时从旧进度补写缺失轮次
   - 只认连续成功的轮次
4. 把 `currentFeatureIndex` 对齐到最后一个成功轮次
5. 从下一轮继续执行
6. 全部轮次都核齐后才生成最终总结
