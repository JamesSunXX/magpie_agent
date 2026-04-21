# Feishu Wiki 知识库同步

`magpie` 支持把 TRD 等产物读取或写入飞书知识库文档。

当前范围覆盖：

- 查看知识空间节点信息
- 读取文档内容（docx block 模型）
- 创建新文档到指定知识空间
- 更新已有文档内容

## 前置条件

1. 已创建飞书企业自建应用，拿到 `app_id`、`app_secret`。
2. 应用已开通以下权限范围：
   - `wiki:node:read` — 查看知识空间节点信息
   - `wiki:wiki` — 查看、编辑和管理知识库
   - `wiki:wiki:readonly` — 查看知识库（只读场景可只开这个）
3. 应用已被添加为目标知识空间的成员（至少编辑者权限）。

## 配置

在 `~/.magpie/config.yaml` 或仓库内 `.magpie/config.yaml`：

```yaml
integrations:
  wiki:
    enabled: true
    default_provider: "feishu_wiki"
    providers:
      feishu_wiki:
        type: "feishu-wiki"
        app_id: ${FEISHU_APP_ID}
        app_secret: ${FEISHU_APP_SECRET}
        default_space_id: ${FEISHU_WIKI_SPACE_ID}
```

字段说明：

- `app_id` / `app_secret`：飞书应用凭证，可复用 IM 集成的同一个应用。
- `default_space_id`：创建新文档时的默认知识空间 ID。更新已有文档时不需要。

## 飞书后台配置

### 1. 添加权限

在飞书开放平台应用后台 → 权限管理，添加：

- `wiki:node:read`
- `wiki:wiki`（如果需要写入）
- `wiki:wiki:readonly`（如果只需要读取）

### 2. 把应用加入知识空间

在飞书知识库设置里，把应用添加为目标知识空间的成员，并给予编辑者权限。

### 3. 发布应用版本

权限变更后需要发布新版本才能生效。

## 代码调用

```typescript
import { syncToWiki, createWikiClient } from '../platform/integrations/wiki/runtime.js'

// 同步内容到飞书文档（有 nodeToken 则更新，无则新建）
const result = await syncToWiki(config, {
  title: 'TRD: Payment Retry',
  content: trdMarkdown,
  nodeToken: existingNodeToken, // 可选
  parentNodeToken: parentToken, // 可选，新建时指定父节点
})

// 直接用 client 读取
const client = createWikiClient(config)
if (client) {
  const node = await client.getNode('some_node_token')
  const doc = await client.getDocContent(node.objToken)
}
```

## 主要代码位置

- 类型定义：`src/platform/integrations/wiki/types.ts`
- 飞书 Wiki 客户端：`src/platform/integrations/wiki/feishu/client.ts`
- 运行时入口：`src/platform/integrations/wiki/runtime.ts`
- 配置类型：`src/platform/config/types.ts`（`WikiIntegrationConfig`）
