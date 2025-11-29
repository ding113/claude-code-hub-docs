---
dimensions:
  type:
    primary: reference
    detail: api
  level: advanced
standard_title: Server Actions API
language: zh
---

# Server Actions API

Claude Code Hub 提供了完整的 REST API 层，通过 Server Actions 机制将所有管理功能暴露为 HTTP 端点，并自动生成 OpenAPI 文档。

## API 概述

### 端点统计

系统共提供 **39 个 REST API 端点**，覆盖以下功能模块：

| 模块 | 端点数量 | 说明 |
|------|----------|------|
| 用户管理 | 5 | 用户 CRUD 和限额查询 |
| 密钥管理 | 6 | API Key 生命周期管理 |
| 供应商管理 | 7 | 上游服务商配置和健康检查 |
| 模型价格 | 5 | 价格配置和同步 |
| 统计分析 | 1 | 使用统计数据 |
| 使用日志 | 4 | 请求日志查询 |
| 概览数据 | 1 | 首页实时数据 |
| 敏感词管理 | 6 | 内容过滤规则 |
| Session 管理 | 3 | 活跃会话监控 |
| 通知管理 | 3 | Webhook 配置 |

### API 文档访问

Claude Code Hub 自动生成 OpenAPI 3.1.0 规范文档，支持多种 UI 访问方式：

| 访问方式 | URL | 说明 |
|----------|-----|------|
| Swagger UI | `/api/actions/docs` | 传统 Swagger 风格界面 |
| Scalar UI | `/api/actions/scalar` | 现代化 API 文档界面（推荐） |
| OpenAPI JSON | `/api/actions/openapi.json` | 原始 OpenAPI 规范 |
| 健康检查 | `/api/actions/health` | API 服务健康状态 |

---

## 认证机制

### Admin 认证（Web UI）

通过 Web UI 登录后，系统会在 HTTP-only Cookie 中设置 `auth-token`，所有后续 API 请求自动携带该 Cookie 进行认证。

```bash
# Cookie 格式
auth-token=sk-xxxxxxxxxxxxxxxx
```

### API Key 认证

对于代理端点（`/v1/*`），使用 API Key 进行认证：

```bash
# 方式一：Authorization Header（推荐）
curl -H "Authorization: Bearer sk-your-api-key" \
  https://your-domain.com/v1/messages

# 方式二：x-api-key Header
curl -H "x-api-key: sk-your-api-key" \
  https://your-domain.com/v1/messages
```

### 权限模型

| 角色 | 权限范围 |
|------|----------|
| admin | 完整系统管理权限，可访问所有 API |
| user | 仅能访问自己的数据和统计 |

---

## 端点分类详解

### 用户管理 API

管理系统用户和权限配置。

| 方法 | 端点 | 说明 | 权限 |
|------|------|------|------|
| POST | `/api/actions/users/getUsers` | 获取用户列表 | admin |
| POST | `/api/actions/users/addUser` | 创建新用户 | admin |
| POST | `/api/actions/users/editUser` | 编辑用户信息 | admin |
| POST | `/api/actions/users/removeUser` | 删除用户 | admin |
| POST | `/api/actions/users/getUserLimitUsage` | 获取用户限额使用情况 | user/admin |

### 密钥管理 API

管理 API Key 的生命周期和限额配置。

| 方法 | 端点 | 说明 | 权限 |
|------|------|------|------|
| POST | `/api/actions/keys/getKeys` | 获取密钥列表 | user/admin |
| POST | `/api/actions/keys/addKey` | 创建新密钥 | user/admin |
| POST | `/api/actions/keys/editKey` | 编辑密钥信息 | user/admin |
| POST | `/api/actions/keys/removeKey` | 删除密钥 | user/admin |
| POST | `/api/actions/keys/getKeysWithStatistics` | 获取密钥统计信息 | user/admin |
| POST | `/api/actions/keys/getKeyLimitUsage` | 获取密钥限额使用情况 | user/admin |

### 供应商管理 API

配置上游 AI 服务提供商和健康监控。

| 方法 | 端点 | 说明 | 权限 |
|------|------|------|------|
| POST | `/api/actions/providers/getProviders` | 获取供应商列表 | admin |
| POST | `/api/actions/providers/addProvider` | 创建新供应商 | admin |
| POST | `/api/actions/providers/editProvider` | 编辑供应商配置 | admin |
| POST | `/api/actions/providers/removeProvider` | 删除供应商 | admin |
| POST | `/api/actions/providers/getProvidersHealthStatus` | 获取熔断器健康状态 | admin |
| POST | `/api/actions/providers/resetProviderCircuit` | 重置熔断器状态 | admin |
| POST | `/api/actions/providers/getProviderLimitUsage` | 获取供应商限额使用情况 | admin |

### 模型价格 API

管理模型定价和成本计算。

| 方法 | 端点 | 说明 | 权限 |
|------|------|------|------|
| POST | `/api/actions/model-prices/getModelPrices` | 获取所有模型价格 | admin |
| POST | `/api/actions/model-prices/uploadPriceTable` | 上传价格表 | admin |
| POST | `/api/actions/model-prices/syncLiteLLMPrices` | 同步 LiteLLM 价格 | admin |
| POST | `/api/actions/model-prices/getAvailableModelsByProviderType` | 获取可用模型列表 | user/admin |
| POST | `/api/actions/model-prices/hasPriceTable` | 检查价格表状态 | user/admin |

### 统计数据 API

查询使用统计和分析数据。

| 方法 | 端点 | 说明 | 权限 |
|------|------|------|------|
| POST | `/api/actions/statistics/getUserStatistics` | 获取用户统计数据 | user/admin |

### 日志查询 API

查询和分析请求日志。

| 方法 | 端点 | 说明 | 权限 |
|------|------|------|------|
| POST | `/api/actions/usage-logs/getUsageLogs` | 获取使用日志 | user/admin |
| POST | `/api/actions/usage-logs/getModelList` | 获取模型列表 | user/admin |
| POST | `/api/actions/usage-logs/getStatusCodeList` | 获取状态码列表 | user/admin |
| POST | `/api/actions/usage-logs/getEndpointList` | 获取端点列表 | user/admin |

### 概览数据 API

获取首页实时统计数据。

| 方法 | 端点 | 说明 | 权限 |
|------|------|------|------|
| POST | `/api/actions/overview/getOverviewData` | 获取概览数据 | user/admin |

### 敏感词管理 API

配置内容过滤规则。

| 方法 | 端点 | 说明 | 权限 |
|------|------|------|------|
| POST | `/api/actions/sensitive-words/listSensitiveWords` | 获取敏感词列表 | admin |
| POST | `/api/actions/sensitive-words/createSensitiveWordAction` | 创建敏感词 | admin |
| POST | `/api/actions/sensitive-words/updateSensitiveWordAction` | 更新敏感词 | admin |
| POST | `/api/actions/sensitive-words/deleteSensitiveWordAction` | 删除敏感词 | admin |
| POST | `/api/actions/sensitive-words/refreshCacheAction` | 刷新缓存 | admin |
| POST | `/api/actions/sensitive-words/getCacheStats` | 获取缓存统计 | admin |

### Session 管理 API

监控活跃会话和并发控制。

| 方法 | 端点 | 说明 | 权限 |
|------|------|------|------|
| POST | `/api/actions/active-sessions/getActiveSessions` | 获取活跃 Session 列表 | user/admin |
| POST | `/api/actions/active-sessions/getSessionDetails` | 获取 Session 详情 | user/admin |
| POST | `/api/actions/active-sessions/getSessionMessages` | 获取 Session 消息内容 | user/admin |

### 通知管理 API

配置系统通知和 Webhook。

| 方法 | 端点 | 说明 | 权限 |
|------|------|------|------|
| POST | `/api/actions/notifications/getNotificationSettingsAction` | 获取通知设置 | admin |
| POST | `/api/actions/notifications/updateNotificationSettingsAction` | 更新通知设置 | admin |
| POST | `/api/actions/notifications/testWebhookAction` | 测试 Webhook | admin |

---

## 示例请求

### 创建用户

```bash
curl -X POST https://your-domain.com/api/actions/users/addUser \
  -H "Content-Type: application/json" \
  -H "Cookie: auth-token=sk-your-admin-token" \
  -d '{
    "name": "新用户",
    "note": "测试用户",
    "rpm": 60,
    "dailyQuota": 100,
    "providerGroup": "default"
  }'
```

**响应示例：**

```json
{
  "ok": true,
  "data": null
}
```

### 获取供应商列表

```bash
curl -X POST https://your-domain.com/api/actions/providers/getProviders \
  -H "Content-Type: application/json" \
  -H "Cookie: auth-token=sk-your-admin-token" \
  -d '{}'
```

**响应示例：**

```json
{
  "ok": true,
  "data": [
    {
      "id": 1,
      "name": "Anthropic Official",
      "url": "https://api.anthropic.com",
      "maskedKey": "sk-ant-***...***abc",
      "isEnabled": true,
      "weight": 100,
      "priority": 1,
      "providerType": "anthropic"
    }
  ]
}
```

### 查询使用日志

```bash
curl -X POST https://your-domain.com/api/actions/usage-logs/getUsageLogs \
  -H "Content-Type: application/json" \
  -H "Cookie: auth-token=sk-your-admin-token" \
  -d '{
    "startDate": "2024-01-01T00:00:00Z",
    "endDate": "2024-01-31T23:59:59Z",
    "model": "claude-sonnet-4-20250514",
    "pageSize": 20,
    "page": 1
  }'
```

**响应示例：**

```json
{
  "ok": true,
  "data": {
    "logs": [
      {
        "id": 12345,
        "userId": 1,
        "userName": "admin",
        "model": "claude-sonnet-4-20250514",
        "inputTokens": 1500,
        "outputTokens": 500,
        "costUsd": 0.015,
        "statusCode": 200,
        "durationMs": 2340,
        "createdAt": "2024-01-15T10:30:00Z"
      }
    ],
    "total": 150,
    "page": 1,
    "pageSize": 20
  }
}
```

### 创建 API Key

```bash
curl -X POST https://your-domain.com/api/actions/keys/addKey \
  -H "Content-Type: application/json" \
  -H "Cookie: auth-token=sk-your-admin-token" \
  -d '{
    "userId": 1,
    "name": "production-key",
    "expiresAt": "2025-12-31",
    "canLoginWebUi": false,
    "limitDailyUsd": 50,
    "limitConcurrentSessions": 5
  }'
```

**响应示例：**

```json
{
  "ok": true,
  "data": {
    "generatedKey": "sk-a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6",
    "name": "production-key"
  }
}
```

---

## 响应格式

所有 API 响应遵循统一格式：

### 成功响应

```json
{
  "ok": true,
  "data": { ... }
}
```

### 失败响应

```json
{
  "ok": false,
  "error": "错误消息描述"
}
```

### HTTP 状态码

| 状态码 | 说明 |
|--------|------|
| 200 | 操作成功 |
| 400 | 请求错误（参数验证失败或业务逻辑错误） |
| 401 | 未认证（需要登录） |
| 403 | 权限不足 |
| 500 | 服务器内部错误 |

---

## 技术实现

### OpenAPI 集成

API 层基于以下技术栈构建：

- **Hono**: 高性能 Web 框架，提供路由和中间件支持
- **@hono/zod-openapi**: 自动从 Zod Schema 生成 OpenAPI 文档
- **@hono/swagger-ui**: Swagger UI 集成
- **@scalar/hono-api-reference**: 现代化 API 文档界面

### Server Actions 适配器

系统通过 `createActionRoute` 函数将 Next.js Server Actions 转换为 REST API 端点：

```typescript
const { route, handler } = createActionRoute(
  "users",           // 模块名
  "addUser",         // Action 名称
  userActions.addUser,  // Server Action 函数
  {
    requestSchema: CreateUserSchema,  // Zod 请求验证
    description: "创建新用户",
    tags: ["用户管理"],
    requiredRole: "admin",
  }
);

app.openapi(route, handler);
```

### 请求验证

所有请求参数通过 Zod Schema 进行严格验证：

```typescript
const CreateUserSchema = z.object({
  name: z.string().min(1).max(255),
  note: z.string().optional(),
  rpm: z.number().int().positive().default(60),
  dailyQuota: z.number().positive().default(100),
  providerGroup: z.string().optional(),
});
```

---

## 相关文档

- [系统架构](/docs/architecture) - 了解整体系统设计
- [用户管理](/docs/user-management) - 用户和权限管理详解
- [供应商管理](/docs/provider-management) - 上游服务商配置指南
