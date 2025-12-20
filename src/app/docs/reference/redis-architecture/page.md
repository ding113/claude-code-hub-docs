---
title: Redis 架构设计
nextjs:
  metadata:
    title: Redis 架构设计
    description: Claude Code Hub 的 Redis 数据结构、连接配置、容错策略与性能优化指南
---

# Redis 架构设计

Redis 在 Claude Code Hub 中扮演关键角色,提供会话状态缓存、限流计数、熔断器状态共享和分布式锁等核心功能。本文档详细介绍 Redis 的架构设计、数据结构、容错策略和性能优化方案。

---

## 连接配置

### 环境变量

```bash
# 基础连接(本地 Redis)
REDIS_URL=redis://localhost:6379

# TLS 连接(托管服务如 Upstash)
REDIS_URL=rediss://username:password@hostname:6379

# 配置开关
ENABLE_RATE_LIMIT=true          # 启用限流功能
SESSION_TTL=300                 # 会话过期时间(秒)
STORE_SESSION_MESSAGES=false    # 是否存储请求 messages 到 Redis
```

### 连接池配置

`src/lib/redis/client.ts` 中的单例客户端配置:

```typescript
const redisOptions: RedisOptions = {
  enableOfflineQueue: false,      // 快速失败,不排队
  maxRetriesPerRequest: 3,        // 单个命令最多重试 3 次
  retryStrategy(times) {
    if (times > 5) return null;   // 停止重试,触发降级
    return Math.min(times * 200, 2000); // 指数退避,最多 2s
  },
};

// TLS/SNI 配置(rediss:// 协议自动启用)
if (useTls) {
  redisOptions.tls = { host: url.hostname }; // 显式 SNI 修复
}
```

{% callout type="warning" title="TLS 连接注意事项" %}
使用托管 Redis 服务(如 Upstash)时,必须使用 `rediss://` 协议并提供用户名密码。系统自动检测协议头并配置 TLS + SNI,避免证书验证失败。
{% /callout %}

---

## 核心数据结构

### 1. 会话状态缓存

#### 会话绑定

| Redis Key                          | 类型   | TTL    | 说明                     |
| ---------------------------------- | ------ | ------ | ------------------------ |
| `session:{sessionId}:provider`     | STRING | 300s   | 会话绑定的供应商 ID      |
| `session:{sessionId}:key`          | STRING | 300s   | 会话使用的 API Key       |
| `session:{sessionId}:info`         | HASH   | 300s   | 会话元信息(model, 用户)  |
| `session:{sessionId}:usage`        | HASH   | 300s   | 实时 Token 使用统计      |
| `session:{sessionId}:messages`     | STRING | 300s   | 请求 messages(可选存储)  |
| `session:{sessionId}:response`     | STRING | 300s   | 最近一次响应内容         |
| `hash:{contentHash}:session`       | STRING | 300s   | 内容哈希到会话 ID 的映射 |

**实现位置**: `src/lib/session-manager.ts`

**使用场景**: 5 分钟会话粘性,保证同一对话连续请求打到相同供应商,提升缓存命中率。

#### 会话追踪

| Redis Key                          | 类型 | TTL    | 说明                      |
| ---------------------------------- | ---- | ------ | ------------------------- |
| `global:active_sessions`           | ZSET | 3600s  | 全局活跃会话(score=时间戳)|
| `key:{keyId}:active_sessions`      | ZSET | 3600s  | 单个 Key 的活跃会话       |
| `provider:{providerId}:active_sessions` | ZSET | -      | 供应商并发会话追踪        |
| `session:{sessionId}:concurrent_count` | STRING | 300s | 单会话并发计数器          |

**实现位置**: `src/lib/session-tracker.ts`

**Lua 脚本**: `CHECK_AND_TRACK_SESSION` 原子性检查并发限制 + 添加会话

```lua
-- 原子操作:检查并发限制 -> 添加到 ZSET -> 设置过期时间
local count = redis.call('zcard', provider_key)
if count >= max_sessions then
  return { 0, count }
end
redis.call('zadd', provider_key, timestamp, session_id)
redis.call('expire', provider_key, ttl)
return { 1, count + 1 }
```

---

### 2. 限流计数器

#### RPM(请求速率)限制

| Redis Key                     | 类型 | TTL   | 说明                          |
| ----------------------------- | ---- | ----- | ----------------------------- |
| `user:{userId}:rpm_window`    | ZSET | 60s   | 用户 1 分钟内的请求时间戳     |
| `key:{keyId}:rpm_window`      | ZSET | 60s   | API Key 的 RPM 限制           |

**实现位置**: `src/lib/rate-limit/service.ts`

**算法**: 滑动窗口,每次请求移除过期时间戳并计数。

#### 成本限制(固定窗口)

| Redis Key                          | 类型   | TTL      | 说明                     |
| ---------------------------------- | ------ | -------- | ------------------------ |
| `user:{userId}:cost_daily_{HHmm}`  | STRING | 86400s   | 用户每日成本(固定窗口)   |
| `user:{userId}:cost_weekly`        | STRING | 604800s  | 用户每周成本             |
| `user:{userId}:cost_monthly`       | STRING | 2592000s | 用户每月成本             |

**密钥格式**: `_daily_{HHmm}` 表示每日重置时间(如 `_daily_0000` 表示零点重置)。

#### 成本限制(滚动窗口)

| Redis Key                          | 类型 | TTL    | 说明                     |
| ---------------------------------- | ---- | ------ | ------------------------ |
| `user:{userId}:cost_5h_rolling`    | ZSET | 18000s | 5 小时滚动窗口(score=时间戳) |
| `user:{userId}:cost_daily_rolling` | ZSET | 86400s | 24 小时滚动窗口          |

**Lua 脚本**:
- `TRACK_COST_5H_ROLLING_WINDOW`: 移除 5 小时外的记录 -> 计算当前成本 -> 添加新记录
- `TRACK_COST_DAILY_ROLLING_WINDOW`: 同上逻辑,24 小时窗口

**优势**: 无固定重置点,更平滑的成本控制。

{% callout type="note" title="固定窗口 vs 滚动窗口" %}
- **固定窗口**: 性能更优(单个 STRING 键),但存在边界突发(零点前后可能双倍流量)
- **滚动窗口**: 更精确的限流,无边界问题,但 ZSET 操作稍慢
CCH 同时支持两种策略,可通过配置选择。
{% /callout %}

---

### 3. 熔断器状态

#### 配置缓存

| Redis Key                                 | 类型 | TTL  | 说明                     |
| ----------------------------------------- | ---- | ---- | ------------------------ |
| `circuit_breaker:config:{providerId}`     | HASH | 300s | 供应商熔断器配置缓存     |

**字段**:
- `failureThreshold`: 触发熔断的失败次数(默认 5)
- `openDuration`: 熔断持续时间(默认 1800000ms = 30 分钟)
- `halfOpenSuccessThreshold`: HALF-OPEN 转 CLOSED 需要的成功次数(默认 2)

**实现位置**: `src/lib/redis/circuit-breaker-config.ts`

**特点**: 5 分钟缓存 TTL,降低频繁查询 Redis/数据库的压力。

#### 状态机存储（v0.3.20+）

| Redis Key                                 | 类型 | TTL     | 说明                     |
| ----------------------------------------- | ---- | ------- | ------------------------ |
| `circuit_breaker:state:{providerId}`      | HASH | 86400s  | 供应商熔断器运行时状态   |

**字段**:
- `failureCount`: 连续失败计数（整数字符串）
- `lastFailureTime`: 最后失败时间戳（Unix 毫秒字符串）
- `circuitState`: 当前状态（closed/open/half-open）
- `circuitOpenUntil`: 熔断结束时间戳（仅 OPEN 状态，Unix 毫秒字符串）
- `halfOpenSuccessCount`: 半开状态成功计数（整数字符串）

**实现位置**: `src/lib/circuit-breaker.ts`、`src/lib/redis/circuit-breaker-state.ts`

{% callout type="note" title="状态存储策略" %}
从 v0.3.20 版本开始，熔断器状态支持 Redis 持久化：
- **Redis 可用时**：状态同步存储到 Redis，实现多实例共享和重启保留
- **Redis 不可用时**：降级为内存存储（`healthMap`），重启后状态重置
- **24 小时 TTL**：自动清理长期未使用的供应商状态

这种设计既保证了多实例部署场景下的状态一致性，又确保了 Redis 故障时的服务可用性。
{% /callout %}

---

### 4. 分布式锁

#### 排行榜缓存锁

| Redis Key                                         | 类型   | TTL   | 说明                     |
| ------------------------------------------------- | ------ | ----- | ------------------------ |
| `leaderboard:{scope}:daily:{date}:{currency}`     | STRING | 60s   | 每日排行榜缓存           |
| `leaderboard:{scope}:monthly:{month}:{currency}`  | STRING | 60s   | 每月排行榜缓存           |
| `{cacheKey}:lock`                                 | STRING | 10s   | 排行榜重建的分布式锁     |

**实现位置**: `src/lib/redis/leaderboard-cache.ts`

**锁实现**: `SET NX EX` 原子操作,10 秒 TTL 防止死锁。

#### 数据库备份锁

| Redis Key              | 类型   | TTL  | 说明                     |
| ---------------------- | ------ | ---- | ------------------------ |
| `database:backup:lock` | STRING | 300s | 数据库备份全局锁         |

**实现位置**: `src/lib/database-backup/backup-lock.ts`

**Lua 脚本**: 原子 `SET NX PX`,返回成功/失败/剩余时间。

---

### 5. 业务缓存

#### Codex 指令缓存

| Redis Key                                        | 类型   | TTL    | 说明                     |
| ------------------------------------------------ | ------ | ------ | ------------------------ |
| `codex:instructions:{providerId}:{model}`        | STRING | 86400s | Codex CLI 的 instructions 字段缓存 |

**实现位置**: `src/lib/codex-instructions-cache.ts`

**用途**: 避免每次请求都查询数据库获取 Codex 指令配置。

---

### 6. 后台任务队列

CCH 使用 **Bull** 基于 Redis 实现后台任务队列:

| Queue 名称     | 用途                 | 文件位置                                    |
| -------------- | -------------------- | ------------------------------------------- |
| `notifications`| 通知发送队列         | `src/lib/notification/notification-queue.ts`|
| `log-cleanup`  | 日志清理定时任务     | `src/lib/log-cleanup/cleanup-queue.ts`      |

**配置**: 与主 Redis 连接共享,支持 TLS/SNI。

---

### 7. Session 缓存层

CCH 在 Redis 之上提供了一层内存缓存,进一步减少高频读取场景下的数据库查询。

**实现位置**: `src/lib/cache/session-cache.ts`

#### 缓存类型

| 缓存实例             | TTL  | 用途                               |
| -------------------- | ---- | ---------------------------------- |
| `activeSessionsCache`| 2s   | 活跃 Session 列表(仪表盘展示)      |
| `sessionDetailsCache`| 1s   | 单个 Session 详情(频繁变化数据)    |

#### 核心 API

```typescript
// 活跃 Sessions 缓存
getActiveSessionsCache(key?: string): SessionData[] | null
setActiveSessionsCache(data: SessionData[], key?: string): void
clearActiveSessionsCache(): void

// Session 详情缓存
getSessionDetailsCache(sessionId: string): SessionDetail | null
setSessionDetailsCache(sessionId: string, data: SessionDetail): void
clearSessionDetailsCache(sessionId: string): void

// 全局操作
clearAllSessionCache(): void
getCacheStats(): { activeSessions: Stats; sessionDetails: Stats }
```

#### 自动清理机制

```typescript
// 启动定期清理任务（默认 60 秒间隔）
startCacheCleanup(intervalSeconds: number = 60): void

// 停止清理任务
stopCacheCleanup(): void
```

**热重载支持**: 使用 `globalThis` 存储 interval ID,避免开发环境热重载时创建多个清理任务。

{% callout type="note" title="缓存层设计理念" %}
Session 缓存层与 Redis 的定位不同:
- **Redis**: 跨实例共享状态、分布式锁、持久化
- **内存缓存**: 单实例内的极速读取,适用于仪表盘等高频刷新场景

两者配合使用:先查内存缓存,未命中则查 Redis/数据库,再回填内存缓存。
{% /callout %}

---

### 8. 优雅关闭

CCH 实现了完整的优雅关闭机制,确保服务停止时正确清理资源。

**实现位置**: `src/instrumentation.ts`、`src/lib/async-task-manager.ts`

#### Instrumentation 钩子

服务器启动时自动初始化,关闭时清理:

```typescript
// 启动时
register() {
  startCacheCleanup(60);  // 启动缓存清理
  
  // 注册关闭钩子
  process.once("SIGTERM", shutdownHandler);
  process.once("SIGINT", shutdownHandler);
}

// 关闭时
async shutdownHandler(signal: string) {
  stopCacheCleanup();     // 停止缓存清理
  await closeRedis();     // 关闭 Redis 连接
}
```

**防重入设计**: 使用 `globalThis` 存储状态标志,防止:
- 热重载时重复初始化
- 多次信号触发重复关闭

#### 异步任务管理器

统一管理后台异步任务的生命周期:

```typescript
// 注册任务
const abortController = AsyncTaskManager.register(
  taskId,
  asyncPromise,
  "stream-processing"
);

// 取消任务
AsyncTaskManager.cancel(taskId);

// 获取活跃任务数
AsyncTaskManager.getActiveTaskCount();
```

**核心特性**:

| 特性             | 说明                                       |
| ---------------- | ------------------------------------------ |
| AbortController  | 每个任务提供取消机制                       |
| 自动清理         | 任务完成后自动从 Map 中移除                |
| 超时保护         | 每分钟检查,超过 10 分钟未完成的任务自动取消 |
| 信号监听         | SIGTERM/SIGINT/beforeExit 触发全部任务取消 |

**单例模式**: 使用 `globalThis` 缓存实例,确保热重载场景下只有一个管理器。

{% callout type="warning" title="关闭顺序" %}
优雅关闭的执行顺序:
1. 收到 SIGTERM/SIGINT 信号
2. 停止接收新请求(由容器/负载均衡器处理)
3. 取消所有异步任务(AsyncTaskManager)
4. 停止缓存清理定时器
5. 关闭 Redis 连接
6. 进程退出

确保先停止产生新任务,再清理现有资源。
{% /callout %}

---

## Lua 脚本列表

所有 Lua 脚本位于 `src/lib/redis/lua-scripts.ts`,通过 `EVALSHA` 调用。

### 会话管理脚本

| 脚本名称                         | 功能                     | KEYS                                      | ARGV                    | 返回值                  |
| -------------------------------- | ------------------------ | ----------------------------------------- | ----------------------- | ----------------------- |
| `CHECK_AND_TRACK_SESSION`        | 检查并发限制 + 追踪会话  | `provider:{providerId}:active_sessions`   | `sessionId, limit, now` | `{allowed, count, tracked}` |
| `BATCH_CHECK_SESSION_LIMITS`     | 批量检查多个供应商并发   | 多个供应商 key                            | `sessionId, limits..., now` | `[{allowed, count}...]` |

### 成本追踪脚本

| 脚本名称                         | 功能                     | KEYS                                      | ARGV                    | 返回值                  |
| -------------------------------- | ------------------------ | ----------------------------------------- | ----------------------- | ----------------------- |
| `TRACK_COST_5H_ROLLING_WINDOW`   | 5 小时滚动成本追踪       | `{type}:{id}:cost_5h_rolling`             | `cost, now, window`     | `total_cost` (string)   |
| `GET_COST_5H_ROLLING_WINDOW`     | 查询 5 小时滚动成本      | `{type}:{id}:cost_5h_rolling`             | `now, window`           | `total_cost` (string)   |
| `TRACK_COST_DAILY_ROLLING_WINDOW`| 24 小时滚动成本追踪      | `{type}:{id}:cost_daily_rolling`          | `cost, now, window`     | `total_cost` (string)   |
| `GET_COST_DAILY_ROLLING_WINDOW`  | 查询 24 小时滚动成本     | `{type}:{id}:cost_daily_rolling`          | `now, window`           | `total_cost` (string)   |

### 脚本实现细节

**CHECK_AND_TRACK_SESSION**:

```lua
-- 原子操作流程:
-- 1. 清理 5 分钟前的过期 session
-- 2. 检查 session 是否已追踪(避免重复计数)
-- 3. 检查并发数是否超限
-- 4. 追踪新 session 并设置兜底 TTL
```

**TRACK_COST_5H_ROLLING_WINDOW**:

```lua
-- 原子操作流程:
-- 1. 清理窗口外的过期记录
-- 2. 添加当前消费(member = "timestamp:cost")
-- 3. 计算窗口内总消费
-- 4. 设置 6 小时兜底 TTL
```

**优势**:
1. 原子性保证(无竞态条件)
2. 减少网络往返(多个 Redis 命令合并为一次调用)
3. 服务端执行,性能更优
4. 数据格式可追溯(`timestamp:cost` 便于调试)

---

## 容错策略

CCH 采用全面的 **Fail-Open** 策略,确保 Redis 不可用时服务可降级运行。

{% callout type="warning" title="Fail-Open 核心原则" %}
**Redis 不可用时优先保证服务可用性,而非数据完整性**。所有 Redis 依赖的功能在降级后:
- 限流功能失效(允许所有请求通过)
- 会话粘性失效(每次请求重新选择供应商)
- 熔断器使用内存状态(重启后重置)
{% /callout %}

### 连接级容错

```typescript
// enableOfflineQueue: false - Redis 断线时立即失败,不排队
// maxRetriesPerRequest: 3 - 单命令最多重试 3 次
// retryStrategy - 指数退避,5 次后停止重试

if (times > 5) {
  logger.error("Redis retry exhausted, fail-open");
  return null; // 触发降级
}
```

### 功能级容错

| 功能模块       | 降级行为                             | 实现位置                        |
| -------------- | ------------------------------------ | ------------------------------- |
| 限流           | 跳过限流检查,允许所有请求            | `src/lib/rate-limit/service.ts` |
| 会话管理       | 降级为无状态,每次请求重新选择供应商  | `src/lib/session-manager.ts`    |
| 熔断器配置     | 返回默认配置                         | `src/lib/redis/circuit-breaker-config.ts` |
| 排行榜缓存     | 降级为实时查询数据库                 | `src/lib/redis/leaderboard-cache.ts` |
| Codex 指令缓存 | 每次从数据库读取                     | `src/lib/codex-instructions-cache.ts` |

**日志记录**: 所有降级行为都记录 WARN 级别日志,便于监控和排查。

---

## 性能优化

### 1. Pipeline 批量操作

在会话清理等批量操作中使用 Pipeline:

```typescript
// src/lib/session-tracker.ts
const pipeline = redis.pipeline();
pipeline.zrem("global:active_sessions", sessionId);
pipeline.zrem(`key:${keyId}:active_sessions`, sessionId);
pipeline.zrem(`provider:${providerId}:active_sessions`, sessionId);
pipeline.del(`session:${sessionId}:concurrent_count`);
await pipeline.exec();
```

**优势**: 减少 4 次网络往返为 1 次,延迟降低 75%。

### 2. 过期策略

| 数据类型       | TTL 策略                             | 原因                            |
| -------------- | ------------------------------------ | ------------------------------- |
| 会话绑定       | 300s(5 分钟)                         | 会话粘性窗口,超时自动解绑       |
| 限流计数器     | 按窗口时长(60s/5h/1d/1w/1m)          | 窗口结束自动清理                |
| 熔断器配置缓存 | 300s(5 分钟)                         | 平衡新鲜度与查询压力            |
| 排行榜缓存     | 60s(1 分钟)                          | 快速更新,减少数据库查询         |
| Codex 指令缓存 | 86400s(24 小时)                      | 配置更新频率低                  |

**自动清理**: 利用 Redis 的 TTL 机制,无需额外清理任务。

### 3. 数据结构选择

| 场景           | 数据结构 | 原因                            |
| -------------- | -------- | ------------------------------- |
| 滑动窗口计数   | ZSET     | 支持按时间戳范围查询和删除      |
| 固定窗口计数   | STRING   | INCR 原子操作,性能最优          |
| 会话信息存储   | HASH     | 多字段存储,支持部分更新         |
| 分布式锁       | STRING   | SET NX EX 原子操作              |

---

## 监控指标

### 关键指标

| 指标类型       | 监控项                               | 告警阈值建议           |
| -------------- | ------------------------------------ | ---------------------- |
| 连接状态       | Redis 可用性                         | 连续失败 > 5 次        |
| 内存使用       | 已用内存 / 最大内存                  | > 80%                  |
| 命中率         | 会话缓存命中率                       | < 70%                  |
| 延迟           | 命令执行 P95 延迟                    | > 10ms                 |
| 降级事件       | Fail-Open 降级次数                   | > 10 次/小时           |

### 监控实现

```typescript
// 日志示例(降级事件)
logger.warn({
  action: "redis_unavailable_fail_open",
  context: "rate_limit",
  error: error.message,
});

// 指标记录(自行接入 Prometheus)
redisCommandDuration.observe(duration);
redisFailOpenCounter.inc({ context: "session" });
```

---

## 部署建议

### 单节点部署(默认)

```yaml
# docker-compose.yml
redis:
  image: redis:7-alpine
  command: redis-server --appendonly yes --maxmemory 512mb --maxmemory-policy allkeys-lru
  volumes:
    - redis-data:/data
```

**配置要点**:
- `--appendonly yes`: 启用 AOF 持久化(降低数据丢失风险)
- `--maxmemory 512mb`: 限制内存使用
- `--maxmemory-policy allkeys-lru`: 内存满时淘汰最少使用的键

### Redis Cluster(生产环境)

**适用场景**:
- 并发会话 > 1000
- 多实例水平扩展
- 需要高可用(主从 + 哨兵)

**注意事项**:
- Bull 队列不支持 Cluster 模式(需要单独的 Redis 实例)
- Lua 脚本需确保所有键在同一 slot(使用 `{hash_tag}` 语法)

### 托管 Redis(推荐)

**Upstash Redis** 配置示例:

```bash
REDIS_URL=rediss://default:your-token@region.upstash.io:6379
```

**优势**:
- 自动 TLS 加密
- 无需管理基础设施
- 按请求计费,成本可控

---

## 故障排查

### 问题 1: TLS 连接失败

**症状**: `unable to verify the first certificate`

**解决**: 确保 URL 使用 `rediss://` 协议,代码已自动配置 SNI:

```typescript
if (useTls) {
  redisOptions.tls = { host: url.hostname }; // 修复 SNI
}
```

### 问题 2: 限流失效

**症状**: 用户超出配额仍能继续请求

**排查**:
1. 检查 `ENABLE_RATE_LIMIT` 环境变量
2. 查看日志是否有 `redis_unavailable_fail_open`
3. 验证限流配置是否正确设置

### 问题 3: 会话粘性失效

**症状**: 同一会话的请求打到不同供应商

**排查**:
1. 检查 `SESSION_TTL` 是否过短
2. 确认 Redis 可用性(会话绑定依赖 Redis)
3. 查看是否有 `session_provider_not_found` 日志

---

## 相关文档

- [限流策略详解](/docs/reference/rate-limiting) - 深入了解 RPM 和成本限制算法
- [熔断器设计](/docs/reference/circuit-breaker) - 熔断器状态机与容错机制
- [活跃 Session](/docs/guide/sessions) - 会话粘性实现原理
- [环境变量配置](/docs/reference/env-variables) - 完整的 Redis 相关配置项
