---
dimensions:
  type:
    primary: operational
    detail: advanced
  level: advanced
standard_title: 高级设置
language: zh
---

# 高级设置

Claude Code Hub 提供了一系列高级配置选项，允许管理员对系统行为进行精细化控制。这些设置涵盖敏感词过滤、错误规则配置、客户端版本管理、价格表管理和通知配置等方面。

## 敏感词过滤

敏感词过滤功能用于检测和拦截包含敏感内容的请求，保护系统免受不当内容的影响。该功能在认证成功后、计费之前执行，被拦截的请求不计入费用。

### 工作原理

敏感词检测引擎采用三种匹配模式，按性能优先的顺序执行检测：

1. **包含匹配（contains）**: 检查文本是否包含敏感词，最快速
2. **精确匹配（exact）**: 检查文本是否与敏感词完全相同
3. **正则匹配（regex）**: 使用正则表达式进行灵活匹配

```
检测流程:
请求文本 → 包含匹配 → 精确匹配 → 正则匹配 → 通过/拦截
```

### 配置敏感词列表

在管理后台的"敏感词管理"页面，您可以配置敏感词规则：

| 字段 | 类型 | 说明 |
|------|------|------|
| `word` | string | 敏感词内容或正则表达式 |
| `matchType` | enum | 匹配类型：`contains`、`exact`、`regex` |
| `isEnabled` | boolean | 是否启用该规则 |

**配置示例**:

```json
{
  "word": "禁止词汇",
  "matchType": "contains",
  "isEnabled": true
}
```

**正则表达式示例**:

```json
{
  "word": "敏感.*内容",
  "matchType": "regex",
  "isEnabled": true
}
```

### 拦截响应

当请求被拦截时，系统返回 HTTP 400 错误，响应体包含详细的拦截信息：

```json
{
  "error": {
    "type": "invalid_request_error",
    "message": "请求包含敏感词：\"xxx\"，匹配内容：\"xxx\"，匹配类型：包含匹配，请修改后重试。"
  }
}
```

### 审计日志

被拦截的请求会记录到数据库，包含以下信息：

- 用户 ID 和用户名
- API Key ID
- Session ID
- 触发的敏感词
- 匹配类型
- 匹配到的文本片段

### 热重载

敏感词规则支持热重载，修改配置后无需重启服务即可生效。系统在启动时自动加载规则到内存缓存，并通过事件机制实现实时更新。

## 错误规则配置

错误规则允许管理员定义自定义的错误处理逻辑，包括错误分类、重试策略和响应覆写。

### 错误分类规则

错误规则用于识别特定的错误类型，并决定相应的处理策略：

| 字段 | 类型 | 说明 |
|------|------|------|
| `pattern` | string | 错误消息匹配模式 |
| `matchType` | enum | 匹配类型：`contains`、`exact`、`regex` |
| `category` | string | 错误分类标识 |
| `description` | string | 规则描述 |
| `isEnabled` | boolean | 是否启用 |

### 响应覆写

可以为特定错误配置响应覆写，将复杂的上游错误转换为友好的用户提示：

| 字段 | 类型 | 说明 |
|------|------|------|
| `overrideResponse` | JSON | 覆写的响应体 |
| `overrideStatusCode` | integer | 覆写的 HTTP 状态码（400-599） |

**响应覆写示例**:

```json
{
  "pattern": "rate limit exceeded",
  "matchType": "contains",
  "category": "rate_limit",
  "overrideResponse": {
    "error": {
      "type": "rate_limit_error",
      "message": "请求过于频繁，请稍后重试"
    }
  },
  "overrideStatusCode": 429
}
```

### 内置错误分类

系统内置以下错误分类用于智能处理：

| 分类 | 说明 | 处理策略 |
|------|------|----------|
| `PROVIDER_ERROR` | 供应商错误（HTTP 4xx/5xx） | 计入熔断器，切换供应商 |
| `SYSTEM_ERROR` | 系统/网络错误 | 不计入熔断器，先重试 |
| `CLIENT_ABORT` | 客户端中断 | 不计入熔断器，不重试 |
| `NON_RETRYABLE_CLIENT_ERROR` | 客户端输入错误 | 不计入熔断器，不重试 |

### ReDoS 防护

正则表达式规则在加载时会进行 ReDoS（正则表达式拒绝服务）风险检测，存在风险的模式会被自动跳过并记录警告日志。

## 客户端版本管理

客户端版本管理功能用于追踪用户使用的客户端版本，并可选择性地强制用户升级到最新版本。

### 功能概述

```
版本检查流程:
请求 → 解析 User-Agent → 提取版本 → 检查是否需要升级 → 放行/拦截
```

### 系统配置

在系统设置中启用客户端版本检查：

| 配置项 | 类型 | 说明 |
|--------|------|------|
| `enableClientVersionCheck` | boolean | 是否启用版本检查 |

### GA 版本检测

系统自动检测每种客户端的"GA 版本"（Generally Available 版本），定义为被一定数量用户使用的最新版本：

- **GA 阈值**: 通过环境变量 `CLIENT_VERSION_GA_THRESHOLD` 配置（默认 2）
- **活跃窗口**: 过去 7 天内有请求的用户
- **缓存机制**: GA 版本信息缓存 5 分钟

### 支持的客户端类型

| 客户端类型 | 说明 |
|------------|------|
| `claude-vscode` | VSCode 插件 |
| `claude-cli` | Claude CLI |
| `claude-cli-unknown` | 无法识别的旧版本 CLI |
| `anthropic-sdk-typescript` | TypeScript SDK |

### 版本拦截响应

当用户版本过旧时，返回 HTTP 400 错误：

```json
{
  "error": {
    "type": "client_upgrade_required",
    "message": "Your Claude CLI (v1.0.0) is outdated. Please upgrade to v2.0.0 or later to continue using this service.",
    "current_version": "1.0.0",
    "required_version": "2.0.0",
    "client_type": "claude-cli",
    "client_display_name": "Claude CLI"
  }
}
```

### Fail-Open 设计

版本检查采用 Fail-Open 设计原则：

- 配置关闭时跳过所有检查
- UA 解析失败时放行
- 检测过程出错时放行
- 不影响正常服务可用性

## 价格表管理

价格表管理功能维护各 AI 模型的定价数据，用于精确计算请求成本和账单生成。

### 价格数据来源

系统支持从 LiteLLM 项目自动同步价格数据：

```
同步流程:
CDN 获取 → JSON 解析 → 数据库更新 → 缓存刷新
   ↓ 失败
本地缓存降级
```

**数据源 URL**: `https://jsd-proxy.ygxz.in/gh/BerriAI/litellm/model_prices_and_context_window.json`

### 价格数据结构

| 字段 | 类型 | 说明 |
|------|------|------|
| `model` | string | 模型标识符 |
| `inputCostPerToken` | decimal | 输入 Token 单价（USD） |
| `outputCostPerToken` | decimal | 输出 Token 单价（USD） |
| `contextWindow` | integer | 上下文窗口大小 |

### 成本计算规则

请求成本按以下公式计算：

```
成本 = (输入 Token 数 * 输入单价) + (输出 Token 数 * 输出单价) * 成本倍率
```

其中"成本倍率"来自供应商配置的 `costMultiplier` 字段。

### 缓存策略

- **CDN 获取超时**: 10 秒
- **本地缓存路径**: `public/cache/litellm-prices.json`
- **降级策略**: CDN 获取失败时使用本地缓存

### 手动更新

管理员可以通过管理后台手动更新特定模型的价格，手动设置的价格优先于自动同步的数据。

## 通知配置

通知系统用于向管理员发送重要的系统告警和事件通知。

### 通知类型

| 类型 | 说明 |
|------|------|
| 成本告警 | 用户消费达到阈值时触发 |
| 每日排行榜 | 每日使用量排名报告 |
| 系统告警 | 供应商异常、熔断等事件 |

### 成本告警配置

成本告警在用户消费达到指定阈值时触发通知：

```typescript
// 告警阈值配置示例
{
  thresholds: [10, 50, 100, 500],  // USD
  channels: ["webhook", "email"]
}
```

### 通知渠道

#### Webhook 通知

支持通过 Webhook 发送通知到外部系统（如企业微信、钉钉、Slack 等）：

| 配置项 | 说明 |
|--------|------|
| `webhookUrl` | Webhook 接收地址 |
| `webhookSecret` | 签名密钥（可选） |

**Webhook 请求格式**:

```json
{
  "type": "cost_alert",
  "timestamp": "2025-01-01T00:00:00Z",
  "data": {
    "userId": 123,
    "userName": "user@example.com",
    "currentCost": 50.00,
    "threshold": 50,
    "period": "monthly"
  }
}
```

#### 邮件通知（预留）

邮件通知功能当前为预留接口，未来版本将支持：

- SMTP 服务器配置
- 邮件模板自定义
- 收件人列表管理

### 通知队列

通知采用异步队列处理，确保不阻塞主业务流程：

```
事件触发 → 加入队列 → 异步处理 → 发送通知 → 记录日志
```

### 每日排行榜

每日排行榜功能生成用户使用量排名报告：

| 统计维度 | 说明 |
|----------|------|
| 请求数量 | 当日总请求次数 |
| Token 用量 | 当日总 Token 消耗 |
| 消费金额 | 当日总消费（USD） |

## 系统配置汇总

以下是所有高级设置相关的系统配置项：

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `enableClientVersionCheck` | boolean | false | 启用客户端版本检查 |
| `CLIENT_VERSION_GA_THRESHOLD` | integer | 2 | GA 版本检测阈值 |

### 环境变量

| 变量名 | 说明 |
|--------|------|
| `CLIENT_VERSION_GA_THRESHOLD` | GA 版本检测阈值（1-10） |

## 最佳实践

### 敏感词过滤最佳实践

1. **分层过滤**: 使用包含匹配处理常见敏感词，正则匹配处理复杂模式
2. **定期审查**: 定期审查拦截日志，优化规则减少误报
3. **测试验证**: 新规则上线前在测试环境验证

### 错误规则最佳实践

1. **精确匹配优先**: 尽量使用精确匹配，避免正则表达式性能问题
2. **分类清晰**: 为不同类型的错误定义清晰的分类
3. **友好提示**: 使用响应覆写提供用户友好的错误信息

### 版本管理最佳实践

1. **渐进式强制**: 先发布新版本，观察用户升级情况后再启用强制升级
2. **合理阈值**: 根据用户基数调整 GA 阈值
3. **监控告警**: 监控版本分布，及时发现异常

## 相关文档

- [供应商管理](/docs/provider-management) - 供应商配置详解
- [限流与配额管理](/docs/rate-limiting) - 限流机制说明
- [熔断器机制](/docs/circuit-breaker) - 熔断器工作原理
- [监控与日志](/docs/monitoring) - 系统监控功能
