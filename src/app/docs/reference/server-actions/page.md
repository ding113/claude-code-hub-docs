---
dimensions:
  type:
    primary: reference
    detail: api-reference
  level: advanced
standard_title: Server Actions API
language: zh
---

# Server Actions API

Claude Code Hub 提供了完整的 REST API，基于 Next.js Server Actions 自动生成 OpenAPI 3.1.0 规范文档。所有管理操作均通过统一的 API 层暴露，支持 Swagger UI 和 Scalar UI 两种交互式文档界面。

{% callout title="API 设计理念" type="note" %}
CCH 的 API 采用 **Server Actions + OpenAPI** 架构：所有业务逻辑封装在 Server Actions 中，通过 `@hono/zod-openapi` 自动生成 REST 端点和 API 文档。这种设计确保了类型安全和文档自动同步。
{% /callout %}

---

## API 文档访问

CCH 提供三种方式访问 API 文档：

| 访问方式 | 地址 | 说明 |
| --- | --- | --- |
| **Scalar UI** (推荐) | `/api/actions/scalar` | 现代化交互界面，支持深色模式 |
| **Swagger UI** | `/api/actions/docs` | 经典 Swagger 界面 |
| **OpenAPI JSON** | `/api/actions/openapi.json` | 原始 OpenAPI 规范文件 |

{% callout title="生产环境配置" type="warning" %}
建议配置 `APP_URL` 环境变量，确保 OpenAPI 文档中的 `servers` 地址正确指向您的部署域名。
{% /callout %}

---

## 认证方式

### Admin Token 认证

所有管理 API 需要管理员权限，通过 Cookie 进行身份验证：

1. 访问 Web UI 登录页面
2. 输入 `ADMIN_TOKEN` 环境变量中配置的令牌
3. 登录成功后，服务器设置 HTTP-only Cookie
4. 后续请求自动携带 Cookie 进行认证

### 权限级别

| 角色 | 权限范围 |
| --- | --- |
| **admin** | 完整系统管理权限，可访问所有 API |
| **user** | 仅能查看和管理自己的数据（密钥、统计等） |

### 响应格式

所有 API 响应遵循统一格式：

```json
// 成功响应
{
  "ok": true,
  "data": { ... }
}

// 错误响应
{
  "ok": false,
  "error": "错误消息",
  "errorCode": "ERROR_CODE"  // 可选，用于国际化
}
```

### HTTP 状态码

| 状态码 | 含义 |
| --- | --- |
| `200` | 操作成功 |
| `400` | 请求错误（参数验证失败或业务逻辑错误） |
| `401` | 未认证（需要登录） |
| `403` | 权限不足 |
| `500` | 服务器内部错误 |

---

## 用户管理 API

用户管理相关的 CRUD 操作和限额查询。

### API 端点列表

| 端点 | 方法 | 说明 | 权限 |
| --- | --- | --- | --- |
| `/api/actions/users/getUsers` | POST | 获取用户列表 | admin |
| `/api/actions/users/addUser` | POST | 创建新用户 | admin |
| `/api/actions/users/editUser` | POST | 编辑用户信息 | admin |
| `/api/actions/users/removeUser` | POST | 删除用户 | admin |
| `/api/actions/users/getUserLimitUsage` | POST | 获取用户限额使用情况 | admin/self |

### 创建用户

```bash
POST /api/actions/users/addUser
Content-Type: application/json

{
  "name": "developer1",
  "note": "开发团队成员",
  "providerGroup": "default",
  "rpm": 60,
  "dailyQuota": 100,
  "limit5hUsd": 10,
  "limitWeeklyUsd": 50,
  "limitMonthlyUsd": 200,
  "limitConcurrentSessions": 5
}
```

**响应示例：**

```json
{
  "ok": true
}
```

{% callout title="自动创建密钥" type="note" %}
创建用户时会自动生成一个名为 `default` 的 API 密钥。
{% /callout %}

### 编辑用户

```bash
POST /api/actions/users/editUser
Content-Type: application/json

{
  "userId": 1,
  "name": "developer1-updated",
  "rpm": 120,
  "dailyQuota": 200
}
```

### 获取用户限额使用情况

```bash
POST /api/actions/users/getUserLimitUsage
Content-Type: application/json

{
  "userId": 1
}
```

**响应示例：**

```json
{
  "ok": true,
  "data": {
    "rpm": {
      "current": 0,
      "limit": 60,
      "window": "per_minute"
    },
    "dailyCost": {
      "current": 15.5,
      "limit": 100,
      "resetAt": "2024-01-02T00:00:00.000Z"
    }
  }
}
```

---

## 密钥管理 API

API 密钥的创建、编辑、删除和限额查询。

### API 端点列表

| 端点 | 方法 | 说明 | 权限 |
| --- | --- | --- | --- |
| `/api/actions/keys/getKeys` | POST | 获取用户的密钥列表 | admin/self |
| `/api/actions/keys/addKey` | POST | 创建新密钥 | admin/self |
| `/api/actions/keys/editKey` | POST | 编辑密钥信息 | admin/self |
| `/api/actions/keys/removeKey` | POST | 删除密钥 | admin/self |
| `/api/actions/keys/getKeyLimitUsage` | POST | 获取密钥限额使用情况 | admin/self |

### 创建密钥

```bash
POST /api/actions/keys/addKey
Content-Type: application/json

{
  "userId": 1,
  "name": "production-key",
  "expiresAt": "2025-12-31",
  "canLoginWebUi": false,
  "limit5hUsd": 5,
  "limitWeeklyUsd": 30,
  "limitMonthlyUsd": 100,
  "limitConcurrentSessions": 3
}
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

{% callout title="密钥安全" type="warning" %}
生成的密钥只会返回一次，请妥善保存。密钥在数据库中以 SHA-256 哈希形式存储。
{% /callout %}

### 获取密钥限额使用情况

```bash
POST /api/actions/keys/getKeyLimitUsage
Content-Type: application/json

{
  "keyId": 1
}
```

**响应示例：**

```json
{
  "ok": true,
  "data": {
    "cost5h": {
      "current": 2.5,
      "limit": 5,
      "resetAt": "2024-01-01T05:00:00.000Z"
    },
    "costDaily": {
      "current": 8.0,
      "limit": 20,
      "resetAt": "2024-01-02T00:00:00.000Z"
    },
    "costWeekly": {
      "current": 25.0,
      "limit": 30,
      "resetAt": "2024-01-08T00:00:00.000Z"
    },
    "costMonthly": {
      "current": 80.0,
      "limit": 100,
      "resetAt": "2024-02-01T00:00:00.000Z"
    },
    "concurrentSessions": {
      "current": 2,
      "limit": 3
    }
  }
}
```

---

## 供应商管理 API

供应商的 CRUD 操作、健康状态监控和熔断器管理。

### API 端点列表

| 端点 | 方法 | 说明 | 权限 |
| --- | --- | --- | --- |
| `/api/actions/providers/getProviders` | POST | 获取供应商列表 | admin |
| `/api/actions/providers/addProvider` | POST | 创建新供应商 | admin |
| `/api/actions/providers/editProvider` | POST | 编辑供应商信息 | admin |
| `/api/actions/providers/removeProvider` | POST | 删除供应商 | admin |
| `/api/actions/providers/getProvidersHealthStatus` | POST | 获取供应商健康状态 | admin |
| `/api/actions/providers/resetProviderCircuit` | POST | 重置熔断器状态 | admin |
| `/api/actions/providers/getProviderLimitUsage` | POST | 获取供应商限额使用情况 | admin |

### 创建供应商

```bash
POST /api/actions/providers/addProvider
Content-Type: application/json

{
  "name": "Anthropic Official",
  "url": "https://api.anthropic.com",
  "key": "sk-ant-xxxxx",
  "is_enabled": true,
  "weight": 100,
  "priority": 1,
  "cost_multiplier": 1.0,
  "provider_type": "claude",
  "group_tag": "official",
  "limit_5h_usd": 50,
  "limit_daily_usd": 100,
  "circuit_breaker_failure_threshold": 5,
  "circuit_breaker_open_duration": 1800000,
  "first_byte_timeout_streaming_ms": 30000,
  "streaming_idle_timeout_ms": 60000,
  "request_timeout_non_streaming_ms": 120000
}
```

### 获取供应商健康状态

```bash
POST /api/actions/providers/getProvidersHealthStatus
```

**响应示例：**

```json
{
  "ok": true,
  "data": [
    {
      "providerId": 1,
      "providerName": "Anthropic Official",
      "state": "CLOSED",
      "failureCount": 0,
      "successCount": 150,
      "lastFailureTime": null,
      "lastSuccessTime": "2024-01-01T12:00:00.000Z"
    },
    {
      "providerId": 2,
      "providerName": "Backup Provider",
      "state": "OPEN",
      "failureCount": 5,
      "successCount": 10,
      "lastFailureTime": "2024-01-01T11:55:00.000Z",
      "openUntil": "2024-01-01T12:25:00.000Z"
    }
  ]
}
```

### 重置熔断器

```bash
POST /api/actions/providers/resetProviderCircuit
Content-Type: application/json

{
  "providerId": 2
}
```

---

## 统计分析 API

使用统计数据查询，支持多种时间范围和维度。

### API 端点列表

| 端点 | 方法 | 说明 | 权限 |
| --- | --- | --- | --- |
| `/api/actions/statistics/getUserStatistics` | POST | 获取用户统计数据 | admin/user |
| `/api/actions/overview/getOverviewData` | POST | 获取首页概览数据 | admin/user |

### 获取用户统计数据

```bash
POST /api/actions/statistics/getUserStatistics
Content-Type: application/json

{
  "timeRange": "day",
  "userId": 1
}
```

**时间范围选项：**

| 值 | 说明 |
| --- | --- |
| `hour` | 最近 1 小时 |
| `day` | 最近 24 小时 |
| `week` | 最近 7 天 |
| `month` | 最近 30 天 |

**响应示例：**

```json
{
  "ok": true,
  "data": {
    "chartData": [
      {
        "date": "2024-01-01T00:00:00.000Z",
        "user-1_cost": 5.5,
        "user-1_calls": 120
      }
    ],
    "users": [
      {
        "id": 1,
        "name": "developer1",
        "dataKey": "user-1"
      }
    ],
    "timeRange": "day",
    "resolution": "hour",
    "mode": "users"
  }
}
```

### 获取首页概览数据

```bash
POST /api/actions/overview/getOverviewData
```

**响应示例：**

```json
{
  "ok": true,
  "data": {
    "concurrentSessions": 5,
    "todayRequests": 1500,
    "todayCost": 45.5,
    "avgResponseTime": 2500,
    "todayErrorRate": 0.5
  }
}
```

---

## 使用日志 API

请求日志查询和筛选。

### API 端点列表

| 端点 | 方法 | 说明 | 权限 |
| --- | --- | --- | --- |
| `/api/actions/usage-logs/getUsageLogs` | POST | 获取使用日志 | admin/user |
| `/api/actions/usage-logs/getModelList` | POST | 获取日志中的模型列表 | admin/user |
| `/api/actions/usage-logs/getStatusCodeList` | POST | 获取日志中的状态码列表 | admin/user |

### 获取使用日志

```bash
POST /api/actions/usage-logs/getUsageLogs
Content-Type: application/json

{
  "startDate": "2024-01-01T00:00:00.000Z",
  "endDate": "2024-01-02T00:00:00.000Z",
  "model": "claude-sonnet-4-20250514",
  "statusCode": 200,
  "pageSize": 50,
  "page": 1
}
```

**响应包含字段：**

- `sessionId` - Session ID
- `userId` / `userName` - 用户信息
- `providerId` / `providerName` - 供应商信息
- `model` - 使用的模型
- `inputTokens` / `outputTokens` - Token 统计
- `costUsd` - 成本（美元）
- `durationMs` - 响应时间（毫秒）
- `statusCode` - HTTP 状态码
- `createdAt` - 请求时间

---

## Session 管理 API

活跃 Session 监控和详情查询。

### API 端点列表

| 端点 | 方法 | 说明 | 权限 |
| --- | --- | --- | --- |
| `/api/actions/active-sessions/getActiveSessions` | POST | 获取活跃 Session 列表 | admin/user |
| `/api/actions/active-sessions/getSessionDetails` | POST | 获取 Session 详情 | admin/user |
| `/api/actions/active-sessions/getSessionMessages` | POST | 获取 Session 消息内容 | admin/user |

### 获取活跃 Session

```bash
POST /api/actions/active-sessions/getActiveSessions
```

**响应示例：**

```json
{
  "ok": true,
  "data": [
    {
      "sessionId": "sess_abc123",
      "userName": "developer1",
      "userId": 1,
      "keyId": 1,
      "keyName": "default",
      "providerId": 1,
      "providerName": "Anthropic Official",
      "model": "claude-sonnet-4-20250514",
      "apiType": "chat",
      "startTime": 1704067200000,
      "inputTokens": 5000,
      "outputTokens": 2000,
      "totalTokens": 7000,
      "costUsd": 0.05,
      "requestCount": 10,
      "durationMs": 25000
    }
  ]
}
```

### 获取 Session 详情

```bash
POST /api/actions/active-sessions/getSessionDetails
Content-Type: application/json

{
  "sessionId": "sess_abc123"
}
```

{% callout title="Messages 存储" type="note" %}
只有当 `STORE_SESSION_MESSAGES=true` 时，才能获取 Session 的完整消息内容。该功能会增加 Redis 内存使用，且消息可能包含敏感信息。
{% /callout %}

---

## 敏感词管理 API

敏感词过滤规则的 CRUD 操作。

### API 端点列表

| 端点 | 方法 | 说明 | 权限 |
| --- | --- | --- | --- |
| `/api/actions/sensitive-words/listSensitiveWords` | POST | 获取敏感词列表 | admin |
| `/api/actions/sensitive-words/createSensitiveWordAction` | POST | 创建敏感词 | admin |
| `/api/actions/sensitive-words/updateSensitiveWordAction` | POST | 更新敏感词 | admin |
| `/api/actions/sensitive-words/deleteSensitiveWordAction` | POST | 删除敏感词 | admin |
| `/api/actions/sensitive-words/refreshCacheAction` | POST | 刷新敏感词缓存 | admin |
| `/api/actions/sensitive-words/getCacheStats` | POST | 获取缓存统计 | admin |

### 创建敏感词

```bash
POST /api/actions/sensitive-words/createSensitiveWordAction
Content-Type: application/json

{
  "word": "敏感内容",
  "matchType": "contains",
  "description": "禁止包含此内容"
}
```

**匹配类型：**

| 值 | 说明 |
| --- | --- |
| `contains` | 包含匹配 |
| `exact` | 精确匹配 |
| `regex` | 正则表达式匹配 |

---

## 错误规则 API

错误分类和处理规则管理（通过 Web UI 管理，未暴露为 REST API）。

错误规则功能包括：

- **模式匹配**：支持 `contains`、`exact`、`regex` 三种匹配方式
- **错误分类**：`prompt_limit`、`content_filter`、`pdf_limit`、`thinking_error`、`parameter_error`、`invalid_request`、`cache_limit`
- **响应覆写**：自定义错误响应体和状态码
- **ReDoS 防护**：自动检测危险的正则表达式

---

## 模型价格 API

模型价格表管理和同步。

### API 端点列表

| 端点 | 方法 | 说明 | 权限 |
| --- | --- | --- | --- |
| `/api/actions/model-prices/getModelPrices` | POST | 获取所有模型价格 | admin |
| `/api/actions/model-prices/uploadPriceTable` | POST | 上传价格表 | admin |
| `/api/actions/model-prices/syncLiteLLMPrices` | POST | 同步 LiteLLM 价格表 | admin |
| `/api/actions/model-prices/getAvailableModelsByProviderType` | POST | 获取可用模型列表 | admin |
| `/api/actions/model-prices/hasPriceTable` | POST | 检查是否有价格表 | all |

### 同步 LiteLLM 价格表

```bash
POST /api/actions/model-prices/syncLiteLLMPrices
```

**响应示例：**

```json
{
  "ok": true,
  "data": {
    "added": ["gpt-4o-2024-08-06", "claude-3-5-sonnet-20241022"],
    "updated": ["claude-sonnet-4-20250514"],
    "unchanged": ["gpt-4", "gpt-3.5-turbo"],
    "failed": [],
    "total": 150
  }
}
```

### 上传自定义价格表

```bash
POST /api/actions/model-prices/uploadPriceTable
Content-Type: application/json

{
  "jsonContent": "{\"custom-model\": {\"mode\": \"chat\", \"input_cost_per_token\": 0.00001, \"output_cost_per_token\": 0.00003}}"
}
```

---

## 系统配置 API

系统级配置管理。

### API 端点列表

| 端点 | 方法 | 说明 | 权限 |
| --- | --- | --- | --- |
| `/api/actions/system-config/fetchSystemSettings` | POST | 获取系统设置 | admin |
| `/api/actions/system-config/saveSystemSettings` | POST | 保存系统设置 | admin |

### 保存系统设置

```bash
POST /api/actions/system-config/saveSystemSettings
Content-Type: application/json

{
  "siteTitle": "My CCH Instance",
  "allowGlobalUsageView": false,
  "currencyDisplay": "USD",
  "enableAutoCleanup": true,
  "cleanupRetentionDays": 30,
  "enableClientVersionCheck": true
}
```

---

## 通知管理 API

Webhook 通知配置和测试。

### API 端点列表

| 端点 | 方法 | 说明 | 权限 |
| --- | --- | --- | --- |
| `/api/actions/notifications/getNotificationSettingsAction` | POST | 获取通知设置 | admin |
| `/api/actions/notifications/updateNotificationSettingsAction` | POST | 更新通知设置 | admin |
| `/api/actions/notifications/testWebhookAction` | POST | 测试 Webhook | admin |

### 测试 Webhook

```bash
POST /api/actions/notifications/testWebhookAction
Content-Type: application/json

{
  "webhookUrl": "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=xxx"
}
```

{% callout title="SSRF 防护" type="warning" %}
Webhook URL 会进行 SSRF 安全检查，禁止访问内部网络地址（localhost、私有 IP 等）。
{% /callout %}

---

## 健康检查端点

```bash
GET /api/actions/health
```

**响应示例：**

```json
{
  "status": "ok",
  "timestamp": "2024-01-01T12:00:00.000Z",
  "version": "1.0.0"
}
```

---

## 错误处理最佳实践

### 处理认证错误

```typescript
const response = await fetch('/api/actions/users/getUsers', {
  method: 'POST',
  credentials: 'include'  // 重要：携带 Cookie
});

if (response.status === 401) {
  // 重定向到登录页面
  window.location.href = '/login';
}
```

### 处理业务错误

```typescript
const result = await response.json();

if (!result.ok) {
  // 显示错误消息
  toast.error(result.error);

  // 可选：根据 errorCode 进行特殊处理
  if (result.errorCode === 'PERMISSION_DENIED') {
    // 权限不足的特殊处理
  }
}
```

### 常见错误码

| 错误码 | 含义 |
| --- | --- |
| `UNAUTHORIZED` | 未登录 |
| `PERMISSION_DENIED` | 权限不足 |
| `NOT_FOUND` | 资源不存在 |
| `INVALID_FORMAT` | 参数格式错误 |
| `CREATE_FAILED` | 创建操作失败 |
| `UPDATE_FAILED` | 更新操作失败 |
| `DELETE_FAILED` | 删除操作失败 |
| `OPERATION_FAILED` | 操作失败（通用） |

---

## 相关链接

- [环境变量配置](/docs/reference/env-variables) - 完整的环境变量说明
- [数据库架构](/docs/reference/database-schema) - 数据表结构参考
- [熔断器机制](/docs/reference/circuit-breaker) - 熔断器工作原理
- [限流机制](/docs/reference/rate-limiting) - 限流算法详解
