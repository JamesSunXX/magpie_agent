# Feishu IM Control

`magpie` 现在支持用飞书线程处理人工确认，也支持两种方式发起新任务：固定格式消息和消息卡片表单。

当前范围覆盖：

- `loop` 进入人工确认后的飞书线程推送
- 飞书里的批准 / 驳回
- 驳回原因和额外继续说明
- 用固定格式消息发起 `loop` / `harness` 任务
- 用 `/magpie form` 打开卡片表单发起 `loop` / `harness` 任务
- 任务线程里的接收、排队、完成、失败状态回写
- `magpie im-server` 回调服务

## 前置条件

1. 已创建可接收事件回调的飞书应用。
2. 已拿到应用的 `app_id`、`app_secret`、`verification_token`。
3. 已准备一个只在没有现成线程、或需要兜底时才会用到的默认群，并拿到 `chat_id`。
4. Magpie 运行机器可以被飞书事件回调访问到对应端口。

## 配置

在 `~/.magpie/config.yaml` 或仓库内 `.magpie/config.yaml` 打开：

```yaml
integrations:
  im:
    enabled: true
    default_provider: feishu_main
    providers:
      feishu_main:
        type: feishu-app
        app_id: ${FEISHU_APP_ID}
        app_secret: ${FEISHU_APP_SECRET}
        verification_token: ${FEISHU_VERIFICATION_TOKEN}
        encrypt_key: ${FEISHU_ENCRYPT_KEY}
        default_chat_id: ${FEISHU_DEFAULT_CHAT_ID}
        approval_whitelist_open_ids:
          - ou_xxx_operator
        callback_port: 9321
        callback_path: /callbacks/feishu
```

字段说明：

- `default_chat_id`：只在没有现成线程、或需要兜底时才会使用的默认群。
- `approval_whitelist_open_ids`：只有这些飞书用户可以批准或驳回。
- `callback_port` / `callback_path`：本地回调服务监听地址。

## 飞书后台配置清单

先打开飞书开放平台应用后台：

- [https://open.feishu.cn/app](https://open.feishu.cn/app)

然后按下面顺序配置。

### 1. 创建或打开企业自建应用

- 进入目标应用详情页。
- 后续所有配置都在这个应用里完成。

### 2. 打开机器人能力

- 在应用能力或功能配置里，打开机器人能力。
- 只有打开机器人能力后，应用才能收消息、发消息、回消息卡片。

### 3. 在权限管理里添加权限

建议按“最小可用”先开这些：

- `获取与发送单聊、群组消息 (im:message)`
- `获取群聊中所有的用户聊天消息 (im:message.group_msg:readonly)`

按需再加：

- `读取用户发给机器人的单聊消息 (im:message.p2p_msg:readonly)`：只有想支持机器人单聊命令时才需要。

说明：

- `im:message` 用来发送消息和回复消息。
- `im:message.group_msg:readonly` 用来接收群里的文本命令。当前 `magpie` 示例是直接在群里发送 `/magpie task` 和 `/magpie form`，不是必须先 `@` 机器人，所以建议开“群聊所有用户消息”的只读权限。
- 如果你的飞书后台没有 `im:message`，也可以改开 `以应用的身份发消息 (im:message:send_as_bot)`，效果也能满足当前 `magpie` 的发消息需求。

### 4. 在事件与回调里配置请求地址

- 进入“事件与回调”页面。
- 选择把事件/回调发送到开发者服务器。
- 把请求网址配成 `magpie im-server` 实际对外可访问的地址。

如果配置里是：

```yaml
callback_port: 9321
callback_path: /callbacks/feishu
```

并且你的公网域名是 `https://magpie.example.com`，那这里应填写：

```text
https://magpie.example.com/callbacks/feishu
```

注意：

- 飞书访问到的必须是公网可达地址，不能只填本机回环地址。
- `verification_token` 和 `encrypt_key` 要和 `config.yaml` 里保持一致。

### 5. 在事件与回调里添加事件

先添加这个事件：

- `接收消息 v2.0`

它对应的事件类型是：

- `im.message.receive_v1`

这条事件用于：

- 接收群里发来的 `/magpie task`
- 接收群里发来的 `/magpie form`
- 可选地接收机器人单聊里的文本命令

### 6. 在事件与回调里添加回调

再添加这个回调：

- `卡片回传交互`

如果你的后台展示的是旧名字，也可能看到：

- `消息卡片回传交互（旧）`

这类回调用于：

- 点击批准 / 驳回按钮
- 提交任务表单卡片

### 7. 发布应用版本

- 改完能力、权限、事件或回调后，要发布新版本。
- 企业自建应用里，这些改动通常在发布并生效后才真正可用。

### 8. 启动本地服务并联调

先启动 `magpie` 的回调服务：

```bash
magpie im-server start --foreground
```

再在飞书里做两类验证：

1. 在群里发送 `/magpie form`，确认能收到任务表单卡片。
2. 点击确认卡片上的按钮或提交表单，确认 `magpie` 能收到回调并继续处理。

## 启动方式

前台运行：

```bash
magpie im-server start --foreground
```

后台运行：

```bash
magpie im-server start
magpie im-server status
magpie im-server stop
```

## 当前交互方式

### 1. 直接发起任务

现在支持两个入口，但两条入口最后都会走同一套任务创建流程。

#### 方式 A：固定格式消息

在飞书群里发送固定格式消息：

```text
/magpie task
type: small
goal: Fix login timeout
prd: docs/plans/login-timeout.md
```

或：

```text
/magpie task
type: formal
goal: Deliver payment retry flow
prd: docs/plans/payment-retry.md
priority: high
```

规则：

- `type: small` 走 `loop`
- `type: formal` 走 `harness`
- `type`、`goal` 和 `prd` 都必填
- `type` 只接受 `small / formal`
- `priority` 只对 `formal` 任务有意义，且只接受 `interactive / high / normal / background`，其他值会被拒绝

#### 方式 B：消息卡片表单

先在飞书群里发送：

```text
/magpie form
```

Magpie 会在当前对话里回一张表单卡片。填写后点击提交。

表单字段：

- `type`
- `goal`
- `prd`
- `priority`

规则和文本命令完全一致：

- `type: small` 走 `loop`
- `type: formal` 走 `harness`
- `type`、`goal` 和 `prd` 都必填
- `type` 只接受 `small / formal`
- `priority` 只对 `formal` 任务有意义，且只接受 `interactive / high / normal / background`，其他值会被拒绝

发起后，Magpie 会：

1. 在用户当前发消息的群里创建一条新的任务线程。
2. 把任务绑定到新建的 `loop` 或 `harness` 会话。
3. 在线程里回写接收结果。
4. 在后续继续回写排队、运行、完成或失败状态。

### 2. 人工确认

1. 如果这个会话已经绑过线程，Magpie 会直接复用原线程。
2. 如果没有现成线程，或当前流程需要兜底，才会使用 `default_chat_id` 对应的默认群。
3. 线程里会收到一张确认卡片。
4. 白名单用户可以直接批准或驳回。
5. 驳回原因和补充说明会一起回写到原确认记录里。
6. `magpie` 继续沿用原会话和原工作区往下跑。

## 数据落点

这套飞书控制数据都保存在仓库内：

- 线程映射：`.magpie/im/thread-mappings.json`
- 已处理回调去重：`.magpie/im/processed-events.json`
- 服务状态：`.magpie/im/server-state.json`

真正的任务状态仍保存在原来的 loop / harness 会话里；飞书线程只是控制入口和展示层。

## 常见问题

### 1. 为什么飞书里能看到卡片，但点了没反应

先检查：

- `magpie im-server` 是否已经启动
- 飞书回调地址是否真的能访问到本机端口
- 操作人是否在 `approval_whitelist_open_ids` 里

### 2. 为什么同一个任务会一直回到同一条线程

这是当前设计要求：一个任务对应一条线程，避免确认、补充说明和状态更新串线。

### 3. 为什么发起任务后没有被接收

先检查：

- 文本命令是不是严格以 `/magpie task` 开头，或表单入口是不是用了 `/magpie form`
- 是否写了 `type`、`goal`、`prd`
- `type` 是否只用了 `small` 或 `formal`
- `magpie im-server` 是否已经启动

### 4. 如果飞书发消息失败，会不会把任务弄坏

不会。任务状态还是以 `.magpie/` 里的会话为准。飞书发消息失败只会影响展示，不会改坏底层任务状态。

### 5. 为什么在权限页里找不到 `im.message.action.trigger`

因为它不是权限名。

它是卡片交互对应的事件/回调类型，应该去“事件与回调”里配置，而不是去“权限管理”里找。

可以这样理解：

- 权限：决定应用“有没有资格”收消息、发消息。
- 事件：决定飞书“要不要把异步消息推给你”。
- 回调：决定飞书“要不要把用户刚刚点按钮这类同步交互推给你”。

对当前 `magpie` 来说：

- 群里发 `/magpie task` 或 `/magpie form` 依赖“接收消息”事件。
- 点卡片按钮、提交表单依赖“卡片回传交互”回调。
