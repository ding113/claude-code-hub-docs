---
title: 供应商 CRUD
dimensions:
  width: 1200
  height: 800
level: 1
standard_title: Provider CRUD
language: zh
nextjs:
  metadata:
    title: 供应商 CRUD
    description: Claude Code Hub 供应商 CRUD 文档
---

# 供应商 CRUD

{% callout type="note" title="核心概念" %}
供应商（Provider）代表 Claude Code Hub 连接的 AI 服务。通过供应商 CRUD 操作，你可以配置多个 AI 服务提供商，实现智能路由、成本控制和负载均衡。
{% /callout %}

## 供应商数据模型

### 核心字段

供应商包含以下关键配置：

{% table %}
| 字段 | 说明 | 示例 |
|------|------|------|
| `name` | 供应商显示名称 | "Anthropic Claude" |
| `url` | API 端点地址 | "https://api.anthropic.com" |
| `key` | API 认证密钥 | "sk-ant-api03-..." |
| `provider_type` | 供应商类型 | claude, openai-compatible, gemini 等 |
| `is_enabled` | 是否启用 | true/false |
| `weight` | 权重（1-100）| 用于加权路由 |
| `priority` | 优先级（数字越小优先级越高）| 0, 1, 2... |
| `cost_multiplier` | 成本倍数 | 1.0, 1.5, 0.8 等 |
| `group_tag` | 分组标签 | "production", "backup" |
| `active_time_start` | 定时启动时间（HH:mm 格式）| "08:00"（v0.6.0+） |
| `active_time_end` | 定时停止时间（HH:mm 格式）| "22:00"（v0.6.0+） |
{% /table %}

{% callout type="note" %}
**定时启停功能**（v0.6.0+）：设置 `active_time_start` 和 `active_time_end` 后，供应商仅在指定时间窗口内参与请求调度。两个字段都为空时，供应商始终活跃。该功能可用于按时间调度供应商，例如在低价时段使用特定供应商。
{% /callout %}

### 供应商类型

系统支持 6 种供应商类型：

{% table %}
| 类型 | 说明 | 认证方式 |
|------|------|----------|
| `claude` | Anthropic Claude API | x-api-key + Authorization |
| `claude-auth` | Claude 转发服务 | 仅 Bearer 认证 |
| `codex` | Codex CLI (Response API) | 支持 reasoning 参数覆盖 |
| `gemini` | Gemini API | 支持 MCP 透传 |
| `gemini-cli` | Gemini CLI | Gemini CLI 专用 |
| `openai-compatible` | OpenAI 兼容 API | 标准 OpenAI 认证 |
{% /table %}

## 基本操作

### 创建供应商

使用 `addProvider` Server Action 创建新供应商：

```typescript
const result = await addProvider({
  name: "My Claude Provider",
  url: "https://api.anthropic.com",
  key: "sk-ant-api03-...",
  provider_type: "claude",
  is_enabled: true,
  weight: 10,
  priority: 0,
  cost_multiplier: 1.0,
  group_tag: "production",
});
```

**创建时会自动：**
1. 根据 URL 自动获取或创建供应商厂商（Vendor）
2. 自动生成网站图标（favicon）
3. 自动创建对应的端点记录
4. 同步熔断器配置到 Redis
5. 广播缓存失效通知

### 查询供应商列表

```typescript
// 获取所有供应商（管理员权限）
const providers = await getProviders();

// 返回字段包含：
// - 基本信息（id, name, url, providerType 等）
// - 统计信息（今日总成本、调用次数、最后调用时间等）
// - 密钥已脱敏处理（maskKey）
```

### 更新供应商

```typescript
const result = await editProvider(providerId, {
  name: "Updated Name",
  is_enabled: false,  // 禁用供应商
  priority: 5,        // 调整优先级
  cost_multiplier: 1.2,
});
```

**更新时会自动：**
1. 如果 URL 变更，自动更新厂商关联
2. 如果熔断器配置变更，同步到 Redis
3. 清理相关缓存

### 删除供应商

```typescript
const result = await removeProvider(providerId);
```

**删除特性：**
- 使用软删除（设置 `deletedAt` 时间戳）
- 保留历史请求日志
- 自动清理空厂商
- 清除 Redis 缓存和内存状态

## 批量操作

### 批量更新

同时更新多个供应商的字段：

```typescript
const result = await batchUpdateProviders({
  providerIds: [1, 2, 3, 4, 5],
  updates: {
    is_enabled: true,
    priority: 1,
    weight: 10,
  },
});
```

**限制：** 单次最多 500 个供应商

### 批量删除

```typescript
const result = await batchDeleteProviders({
  providerIds: [10, 11, 12],
});
```

## 高级功能

### 自动排序优先级

根据成本倍数自动调整供应商优先级：

```typescript
// 预览排序结果
const preview = await autoSortProviderPriority({ confirm: false });

// 应用排序
const result = await autoSortProviderPriority({ confirm: true });
```

**排序规则：** 成本倍数越低，优先级越高（数字越小）

### 获取限额使用情况

查询供应商的各项限额使用状态：

```typescript
const usage = await getProviderLimitUsage(providerId);

// 返回：
// - 5 小时成本 / 限额
// - 日成本 / 限额 / 重置时间
// - 周成本 / 限额 / 重置时间
// - 月成本 / 限额 / 重置时间
// - 并发会话数 / 限额
```

### 熔断器管理

手动重置供应商熔断器状态：

```typescript
// 重置单个供应商
await resetProviderCircuit(providerId);

// 批量重置
await batchResetProviderCircuits({
  providerIds: [1, 2, 3],
});
```

### 获取健康状态

获取所有供应商的熔断器健康状态：

```typescript
const healthStatus = await getProvidersHealthStatus();

// 返回每个供应商的：
// - circuitState: "closed" | "open" | "half-open"
// - failureCount: 失败次数
// - recoveryMinutes: 恢复剩余分钟数
```

## 配置详解

### 成本限额

支持多维度成本限额控制：

{% table %}
| 限额类型 | 字段 | 说明 |
|----------|------|------|
| 5 小时限额 | `limit_5h_usd` | 滑动窗口，最近 5 小时 |
| 日限额 | `limit_daily_usd` | 支持固定/滚动重置模式 |
| 周限额 | `limit_weekly_usd` | 自然周重置 |
| 月限额 | `limit_monthly_usd` | 自然月重置 |
| 总限额 | `limit_total_usd` | 累计总成本限额 |
| 并发会话 | `limit_concurrent_sessions` | 最大并发连接数 |
{% /table %}

**日重置模式：**
- `fixed`：固定时间重置（如每天 00:00）
- `rolling`：滚动窗口（最近 24 小时）

### 熔断器配置

```typescript
{
  circuit_breaker_failure_threshold: 5,      // 失败阈值
  circuit_breaker_open_duration: 1800000,    // 熔断持续时间（毫秒）
  circuit_breaker_half_open_success_threshold: 2,  // 半开成功阈值
}
```

### 超时配置

```typescript
{
  first_byte_timeout_streaming_ms: 30000,    // 流式首字节超时
  streaming_idle_timeout_ms: 300000,         // 流式空闲超时
  request_timeout_non_streaming_ms: 60000,   // 非流式请求超时
}
```

**注意：** 0 表示禁用该超时（使用系统默认值）

### 代理配置

```typescript
{
  proxy_url: "http://proxy.example.com:8080",
  proxy_fallback_to_direct: true,  // 代理失败时直连
}
```

**支持的协议：** http://, https://, socks5://, socks4://

## 模型配置

### 模型重定向

将请求中的模型名称映射到供应商支持的模型：

```typescript
{
  model_redirects: {
    "claude-3-opus": "claude-3-opus-20240229",
    "gpt-4": "claude-3-sonnet",  // 模型别名
  }
}
```

### 允许模型列表

**Anthropic 供应商：** 白名单模式，限制可调度模型
**非 Anthropic 供应商：** 声明模式，列出支持的模型

```typescript
{
  allowed_models: ["claude-3-opus", "claude-3-sonnet"]
}
```

## 分组标签

使用 `group_tag` 实现灵活的供应商分组：

```typescript
// 单标签
group_tag: "production"

// 多标签（逗号分隔）
group_tag: "production,high-priority"
```

**使用场景：**
- 用户-供应商绑定：用户通过 `providerGroup` 字段指定可访问的分组
- 路由隔离：不同分组实现物理流量隔离
- 灰度发布：新供应商先在测试分组验证

## 数据关系

### 三表结构

```
providers (供应商)
    ↓ providerVendorId
provider_vendors (厂商) - 按网站域名聚合
    ↓ id
provider_endpoints (端点) - 端点池管理
```

**自动管理：**
- 创建供应商时自动获取/创建厂商
- 删除供应商时自动清理空厂商
- 更新 URL 时自动更新端点记录

## 验证规则

{% table %}
| 字段 | 规则 |
|------|------|
| name | 必填，1-64 字符 |
| url | 必填，有效 URL，最大 255 字符 |
| key | 必填，1-1024 字符 |
| weight | 1-100 整数 |
| priority | 0-2147483647 整数 |
| cost_multiplier | 最小 0，支持 4 位小数 |
| daily_reset_time | HH:mm 格式，如 "00:00" |
{% /table %}

## 缓存策略

供应商数据使用多级缓存：

1. **进程级缓存**：30 秒 TTL
2. **Redis Pub/Sub**：跨实例缓存失效通知
3. **数据库**：最终数据源

**缓存失效触发：**
- 增删改供应商操作
- 手动调用 `publishProviderCacheInvalidation()`

## 最佳实践

### 1. 成本优化

- 使用 `cost_multiplier` 标记不同供应商的成本差异
- 定期运行 `autoSortProviderPriority` 自动优化优先级
- 设置合理的成本限额防止意外超支

### 2. 高可用配置

- 配置多个同类型供应商
- 启用熔断器自动故障转移
- 使用分组标签实现流量隔离

### 3. 安全建议

- 定期轮换 API 密钥
- 使用代理隐藏真实 IP
- 设置并发会话限制防止滥用

### 4. 监控告警

- 定期检查 `getProvidersHealthStatus()` 熔断器状态
- 监控限额使用情况，提前预警
- 关注失败率异常的供应商

## 相关文件

{% table %}
| 文件 | 用途 |
|------|------|
| `src/drizzle/schema.ts` | 数据库表结构定义 |
| `src/types/provider.ts` | TypeScript 类型定义 |
| `src/repository/provider.ts` | Repository 层 CRUD 操作 |
| `src/actions/providers.ts` | Action 层业务逻辑 |
| `src/lib/validation/schemas.ts` | 验证 Schema |
| `src/lib/constants/provider.constants.ts` | 常量定义 |
{% /table %}

## API 端点

所有供应商操作通过 Server Actions 提供：

```
GET  /api/actions/providers/getProviders
POST /api/actions/providers/addProvider
POST /api/actions/providers/editProvider
POST /api/actions/providers/removeProvider
POST /api/actions/providers/batchUpdateProviders
POST /api/actions/providers/batchDeleteProviders
POST /api/actions/providers/autoSortProviderPriority
POST /api/actions/providers/getProviderLimitUsage
GET  /api/actions/providers/getProvidersHealthStatus
POST /api/actions/providers/resetProviderCircuit
```
