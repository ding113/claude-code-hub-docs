---
dimensions:
  type:
    primary: reference
    detail: guide
  level: intermediate
standard_title: 缓存管理
language: zh
---

# 缓存管理

Claude Code Hub 采用多层缓存架构，在保证数据一致性的同时优化系统性能。缓存系统服务于以下核心目标：

{% callout type="note" title="设计理念" %}
缓存系统遵循 **Fail-Open** 原则：当缓存基础设施（Redis）不可用时，系统会优雅降级而非直接失败，确保服务连续性。
{% /callout %}

- **性能优化**：减少数据库查询负载
- **跨实例同步**：通过 Redis Pub/Sub 实现多实例缓存一致性
- **限流追踪**：使用 Redis 数据结构追踪多时间窗口的使用量
- **熔断状态**：跨实例共享熔断器状态
- **会话管理**：追踪活跃会话和并发使用

## 缓存架构概览

系统采用三层缓存架构：

```
┌─────────────────────────────────────────────────────────────────────┐
│                         缓存架构                                     │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐     │
│  │   进程内存       │  │   Redis         │  │   数据库         │     │
│  │   (本地)        │  │   (共享)        │  │   (数据源)       │     │
│  │                 │  │                 │  │                 │     │
│  │ - 供应商列表     │  │ - 会话数据      │  │ - 供应商配置     │     │
│  │ - 系统设置      │  │ - 限流计数      │  │ - 用户/密钥      │     │
│  │ - 会话缓存      │  │ - 熔断状态      │  │ - 系统配置       │     │
│  │ - 过滤规则      │  │ - 排行榜        │  │ - 日志记录       │     │
│  │ - 错误规则      │  │ - 版本信息      │  │                 │     │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘     │
│           │                    │                    │               │
│           └────────────────────┴────────────────────┘               │
│                              │                                      │
│                   ┌──────────┴──────────┐                          │
│                   │  Pub/Sub 失效通知    │                          │
│                   │  (跨实例同步)        │                          │
│                   └─────────────────────┘                          │
└─────────────────────────────────────────────────────────────────────┘
```

## 进程内存缓存

### 供应商缓存

供应商缓存避免每次代理请求都查询数据库。

| 配置项 | 值 | 说明 |
|-------|-----|------|
| TTL | 30 秒 | 缓存过期时间 |
| 同步机制 | Redis Pub/Sub | 跨实例失效通知 |
| 降级策略 | TTL 过期 | Redis 不可用时依赖 TTL |

**特性**：
- 版本号机制防止并发刷新时的竞态条件
- 请求级快照支持故障转移时的数据一致性
- 支持缓存预热

### 会话缓存

减少活跃会话列表和详情的数据库查询。

| 缓存类型 | TTL | 说明 |
|---------|-----|------|
| 活跃会话列表 | 2 秒 | 变化较少 |
| 会话详情 | 1 秒 | 变化频繁，TTL 更短 |

### 系统设置缓存

| 配置项 | 值 | 说明 |
|-------|-----|------|
| TTL | 60 秒 | 缓存过期时间 |
| Redis 依赖 | 无 | 读取路径不依赖 Redis |
| 降级策略 | 返回默认值 | 出错时返回上次缓存或默认设置 |

### 敏感词与规则缓存

| 缓存类型 | 刷新方式 | 特性 |
|---------|---------|------|
| 敏感词 | 手动调用 `reload()` | ReDoS 防护 |
| 错误规则 | EventEmitter + Pub/Sub | 自动重载 |
| 请求过滤 | EventEmitter + Pub/Sub | 预编译正则，O(1) 查找 |

## Redis 缓存

### 环境变量配置

| 变量 | 默认值 | 说明 |
|------|-------|------|
| `REDIS_URL` | - | Redis 连接 URL |
| `ENABLE_RATE_LIMIT` | `true` | 启用 Redis 限流和缓存 |
| `REDIS_TLS_REJECT_UNAUTHORIZED` | `true` | TLS 证书验证 |
| `SESSION_TTL` | `300` | 会话过期时间（秒） |
| `CLIENT_VERSION_GA_THRESHOLD` | `2` | GA 版本检测阈值（1-10） |

{% callout type="warning" title="TLS 配置" %}
使用云托管 Redis（如 Upstash）时，系统支持 TLS 连接和 SNI。自签名证书需设置 `REDIS_TLS_REJECT_UNAUTHORIZED=false`。
{% /callout %}

### 会话数据存储

会话数据使用以下 Redis 键模式：

| 键模式 | 用途 |
|-------|------|
| `session:{sessionId}:seq` | 请求序列计数器 |
| `session:{sessionId}:info` | 会话元数据（Hash） |
| `session:{sessionId}:key` | API Key 绑定 |
| `session:{sessionId}:provider` | 供应商绑定 |
| `session:{sessionId}:usage` | 使用统计（Hash） |

默认 TTL 为 300 秒（5 分钟），可通过 `SESSION_TTL` 环境变量配置。

### 限流数据结构

系统根据时间窗口模式使用不同的 Redis 数据结构：

| 周期 | 模式 | 数据结构 | TTL |
|-----|------|---------|-----|
| 5 小时 | 滚动 | ZSET | 6 小时 |
| 每日 | 固定 | STRING | 动态（到下次重置） |
| 每日 | 滚动 | ZSET | 25 小时 |
| 每周 | 固定 | STRING | 到下周一 |
| 每月 | 固定 | STRING | 到下月 1 日 |

### 熔断器状态

| 配置项 | 值 |
|-------|-----|
| 键模式 | `circuit_breaker:state:{providerId}` |
| 数据结构 | Redis Hash |
| TTL | 24 小时 |

存储字段包括：`failureCount`、`lastFailureTime`、`circuitState`、`circuitOpenUntil`、`halfOpenSuccessCount`。

### 排行榜缓存

| 配置项 | 值 |
|-------|-----|
| 键模式 | `leaderboard:{scope}:{period}:{date}:{currency}{filters}` |
| TTL | 60 秒 |
| 防踩踏 | 分布式锁（SET NX EX 10） |

非锁持有者等待重试（最多 5 秒），超时后回退到数据库查询。

### 客户端版本缓存

| 键类型 | TTL | 说明 |
|-------|-----|------|
| 用户版本 | 7 天 | 匹配活跃用户窗口 |
| GA 版本 | 5 分钟 | 频繁访问 |

GA 版本通过分析用户版本分布自动检测：统计每个版本的用户数，选择达到阈值的最新版本。

## 缓存 TTL 汇总

| 缓存类型 | 位置 | TTL | 备注 |
|---------|------|-----|------|
| 供应商列表 | 进程内存 | 30 秒 | Pub/Sub 同步 |
| 活跃会话 | 进程内存 | 2 秒 | 仅内存 |
| 会话详情 | 进程内存 | 1 秒 | 仅内存 |
| 系统设置 | 进程内存 | 60 秒 | 带降级 |
| 会话数据 | Redis | 300 秒 | 可配置 |
| 排行榜 | Redis | 60 秒 | 分布式锁 |
| 熔断状态 | Redis | 24 小时 | Hash |
| 熔断配置 | Redis | 永久 | 无 TTL |
| 用户版本 | Redis | 7 天 | - |
| GA 版本 | Redis | 5 分钟 | - |

## API 请求缓存 TTL 偏好

系统支持通过 `cache_ttl_preference` 设置覆盖 Anthropic API 请求的缓存 TTL。

**可选值**：
- `inherit`：继承客户端设置
- `5m`：5 分钟
- `1h`：1 小时

**优先级**：API Key 设置 > 供应商设置 > 客户端设置

此设置应用于消息中 `cache_control.type === "ephemeral"` 的内容项。

## 边界情况处理

### Redis 不可用时的降级

| 组件 | 降级行为 |
|------|---------|
| 排行榜 | 直接查询数据库 |
| 熔断器 | 仅使用内存状态，丢失跨实例共享 |
| 限流 | 回退到数据库查询 |
| 会话追踪 | 跳过追踪，并发计数返回 0 |
| Pub/Sub | 静默忽略，依赖 TTL 过期 |

### 缓存踩踏防护

**供应商缓存**：使用 `refreshPromise` 防止并发刷新，同一时刻只有一个刷新请求执行。

**排行榜缓存**：使用 Redis 分布式锁，非锁持有者等待重试或超时回退。

### 跨实例缓存失效

Pub/Sub 通道：
- `cch:cache:providers:updated` - 供应商更新
- `cch:cache:error_rules:updated` - 错误规则更新
- `cch:cache:request_filters:updated` - 请求过滤更新

**失效流程**：
1. 实例 A 更新供应商
2. 实例 A 发布失效通知
3. 所有实例收到通知并清除本地缓存
4. 下次请求触发新的数据库加载

### 构建/CI 阶段处理

构建或 CI 阶段自动跳过 Redis 连接：

```typescript
if (process.env.CI === "true" || process.env.NEXT_PHASE === "phase-production-build") {
  return null;
}
```

### 内存管理

- **会话缓存**：定时清理过期条目（默认 60 秒间隔）
- **请求过滤引擎**：提供 `destroy()` 方法清理 EventEmitter 和 Pub/Sub 订阅

### Lua 脚本原子操作

系统使用 Lua 脚本确保多命令操作的原子性：

| 脚本 | 用途 |
|------|------|
| `CHECK_AND_TRACK_SESSION` | 检查并发限制 + 追踪 |
| `BATCH_CHECK_SESSION_LIMITS` | 批量检查多供应商 |
| `TRACK_COST_5H_ROLLING_WINDOW` | 5 小时滚动窗口成本追踪 |
| `TRACK_COST_DAILY_ROLLING_WINDOW` | 24 小时滚动窗口追踪 |

## 相关文档

- [熔断器](/docs/proxy/circuit-breaker) - 熔断器工作原理和配置
- [限流](/docs/proxy/rate-limiting) - 金额限流和并发限制
- [会话管理](/docs/proxy/session-management) - 会话绑定和复用机制
