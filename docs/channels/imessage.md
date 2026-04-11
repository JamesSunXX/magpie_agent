# iMessage Notifications

`magpie` 可以通过通知平台层把 loop 事件投递到 iMessage。当前 provider 支持两种 transport：

- `bluebubbles`（远程桥接）
- `messages-applescript`（本机 Messages.app）

两者都通过现有 `NotificationProvider` / `NotificationRouter` 抽象接入，不需要修改 loop 业务代码。

## Transport 选择

### `messages-applescript`（本机）

- 直接通过 `osascript` 驱动 macOS Messages 发送。
- 适合个人开发机、本地值班提醒。
- 不依赖外部服务，但依赖本机 Apple ID 与 Messages 可用。

### `bluebubbles`（远程）

- 它是当前更稳定、可远程接入的 iMessage bridge，适合把 Magpie 的通知能力从本机扩展到团队设备。
- 通知场景只需要单向投递，BlueBubbles 的 REST API 已经足够，不需要引入完整的聊天机器人能力。
- provider 仍然通过 `integrations.notifications.routes` 被路由，后续新增 Slack/企业微信/钉钉时不需要改 loop 状态机。

## 前置条件

`messages-applescript`：

1. 运行环境是 macOS。
2. 本机可执行 `osascript`。
3. Messages.app 已登录并能向目标发送 iMessage。

`bluebubbles`：

1. 已部署可用的 BlueBubbles Server。
2. 已拿到 BlueBubbles API Password。
3. 已确认目标聊天存在，并能提供稳定的 `chat guid`。

## 配置示例

### 本机 Messages / AppleScript

```yaml
integrations:
  notifications:
    enabled: true
    routes:
      human_confirmation_required: [imessage_local]
      loop_failed: [imessage_local]
    providers:
      imessage_local:
        type: imessage
        transport: messages-applescript
        service: iMessage
        targets:
          - handle:+8613800138000
```

`targets` 说明：

- 推荐 `handle:<phone-or-email>`。
- 不加前缀时按 raw handle 处理。
- `chat_guid:*` 只适用于 `bluebubbles` transport，不适用于本机 AppleScript。

### BlueBubbles

```yaml
integrations:
  notifications:
    enabled: true
    default_timeout_ms: 5000
    routes:
      human_confirmation_required: [macos_local, imessage_ops]
      loop_failed: [imessage_ops]
      loop_completed: [imessage_ops]
    providers:
      macos_local:
        type: macos
        click_target: vscode
        terminal_notifier_bin: terminal-notifier
        fallback_osascript: true
      imessage_ops:
        type: imessage
        transport: bluebubbles
        server_url: ${BLUEBUBBLES_SERVER_URL}
        password: ${BLUEBUBBLES_PASSWORD}
        targets:
          - chat_guid:iMessage;-;+8613800138000
        method: private-api
```

## 配置字段

- `type`: 固定为 `imessage`。
- `transport`: `bluebubbles` 或 `messages-applescript`。默认 `bluebubbles`。
- `server_url`: BlueBubbles Server 地址，例如 `https://bluebubbles.example.com`（仅 `bluebubbles`）。
- `password`: BlueBubbles API Password（仅 `bluebubbles`）。
- `targets`: 目标聊天列表。
- `method`: BlueBubbles 发送方法，默认 `private-api`（仅 `bluebubbles`）。
- `service`: Messages 服务类型，`iMessage` 或 `SMS`，默认 `iMessage`（仅 `messages-applescript`）。

## `targets` 规则

推荐写法：

```yaml
targets:
  - chat_guid:iMessage;-;+8613800138000
```

也支持直接填写原始 BlueBubbles chat guid：

```yaml
targets:
  - iMessage;-;+8613800138000
```

`bluebubbles` 当前不自动支持手机号/邮箱句柄直发，也不会自动建新聊天。这样做是为了把通知层保持成稳定、可预测的投递能力；“查人建会话”这类不稳定逻辑后续如果需要，应作为独立 transport 能力追加。

## 发送内容

每条 iMessage 会包含：

- 事件级别和标题
- 事件正文
- 可选 `actionUrl`
- `sessionId`

适合用于：

- `human_confirmation_required`
- `stage_entered`
- `stage_completed`
- `stage_failed`
- `stage_paused`
- `stage_resumed`
- `loop_failed`
- `loop_completed`

## 失败语义

- provider 内部会对每个 `target` 单独发送。
- 只要至少一个目标投递成功，provider 结果就算成功。
- 所有目标都失败时，router 会保留失败结果，但不会阻断 loop 会话持久化。

## 验证方式

本地可以用以下命令做回归：

```bash
npm run test:run -- tests/platform/notifications/providers/imessage.test.ts
npm run test:run -- tests/platform/notifications/providers/imessage-applescript.test.ts
npm run test:run -- tests/platform/notifications/providers/feishu-webhook.test.ts
npm run test:run -- tests/platform/notifications/factory.test.ts
npm run build
```

真实通道 smoke test（默认读取 `~/.magpie/config.yaml`）：

```bash
# 事件可选: human_confirmation_required / stage_entered / stage_completed / stage_failed / stage_paused / stage_resumed / loop_failed / loop_completed / loop_paused / loop_resumed
npm run smoke:notifications -- human_confirmation_required

# 可选：用环境变量覆盖 config 里 BlueBubbles / Feishu 对应字段
export BLUEBUBBLES_SERVER_URL="https://your-bluebubbles.example.com"
export BLUEBUBBLES_PASSWORD="your-bluebubbles-password"
export BLUEBUBBLES_CHAT_GUID="iMessage;-;+8613800138000"
export FEISHU_WEBHOOK_URL="https://open.feishu.cn/open-apis/bot/v2/hook/xxx"
export FEISHU_WEBHOOK_SECRET="your-feishu-secret"

npm run smoke:notifications -- human_confirmation_required
```

说明：

- smoke 脚本会按 `integrations.notifications.routes.<event>` 读取并投递该事件对应 provider。
- 默认要求路由中的 provider 全部成功，任一失败会返回非 0 退出码。
- Feishu 会自动附带 `timestamp` 与 `sign`，用于通过 webhook 签名校验（规则见 [Feishu 自定义机器人文档](https://open.feishu.cn/document/client-docs/bot-v3/add-custom-bot?lang=zh-CN)）。

## 常见问题

### 1. 为什么不用手机号直接发

BlueBubbles 的稳定目标是已有聊天的 `chat guid`。直接手机号/邮箱需要额外的查会话或建会话逻辑，这一层现在故意不做。

### 2. 为什么 provider 成功但某些目标失败

provider 采用“任一目标送达即成功”的策略，便于一个 provider 同时扇出到多个值班目标。具体失败明细会保存在 provider 的原始结果里。

### 3. 是否支持本机 Messages / AppleScript 直连

支持。将 `transport` 设为 `messages-applescript` 即可。
