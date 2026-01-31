---
dimensions:
  type:
    primary: reference
    detail: guide
  level: intermediate
standard_title: Cache TTL 控制
language: zh
---

# Cache TTL 控制

Claude Code Hub 的 Cache TTL（Time To Live）控制系统是一个多层次的缓存管理机制，用于优化系统性能、减少数据库查询压力，并确保数据在合理的时间范围内保持新鲜。系统采用 Redis 作为主要缓存后端，结合进程级内存缓存，实现高性能的数据访问和灵活的配置管理。

## 缓存架构概览

### 三层缓存架构

系统采用三层缓存架构，每层针对不同的数据类型和访问模式：

```
┌─────────────────────────────────────────────────────────────┐
│                    缓存架构层级                              │
├─────────────────────────────────────────────────────────────┤
│  L1: 进程级内存缓存                                          │
│      - Provider 配置缓存 (30s TTL)                           │
│      - 系统设置缓存 (60s TTL)                                │
│      - 熔断器配置缓存 (5min TTL)                             │
├─────────────────────────────────────────────────────────────┤
│  L2: Redis 分布式缓存                                        │
│      - Session 数据 (5min TTL, 可配置)                       │
│      - 限流计数窗口 (动态 TTL)                               │
│      - 熔断器状态 (24h TTL)                                  │
│      - 并发 Session 追踪 (1h 兜底 TTL)                       │
│      - 客户端版本信息 (7d / 5min TTL)                        │
├─────────────────────────────────────────────────────────────┤
│  L3: 持久化存储 (PostgreSQL)                                 │
│      - 所有业务数据的最终持久化                              │
└─────────────────────────────────────────────────────────────┘
```

### Redis Key 命名规范

| Key 模式 | 用途 | TTL |
|---------|------|-----|
| `session:{sessionId}:seq` | Session 请求序号计数 | 300s (SESSION_TTL) |
| `session:{sessionId}:key` | Session 绑定的 Key ID | 300s |
| `session:{sessionId}:provider` | Session 绑定的 Provider | 300s |
| `session:{sessionId}:info` | Session 详细信息 (Hash) | 300s |
| `session:{sessionId}:usage` | Session 使用量统计 | 300s |
| `session:{sessionId}:concurrent_count` | Session 并发计数 | 600s |
| `hash:{contentHash}:session` | 内容哈希到 Session 映射 | 300s |
| `global:active_sessions` | 全局活跃 Session ZSET | 3600s |
| `key:{keyId}:active_sessions` | Key 级活跃 Session ZSET | 3600s |
| `provider:{providerId}:active_sessions` | Provider 级活跃 Session ZSET | 3600s |
| `user:{userId}:active_sessions` | 用户级活跃 Session ZSET | 3600s |
| `key:{keyId}:cost_5h_rolling` | 5小时消费滚动窗口 | 21600s (6h) |
| `key:{keyId}:cost_daily_rolling` | 日消费滚动窗口 | 90000s (25h) |
| `key:{keyId}:cost:{period}` | 周期消费计数 (fixed 模式) | 动态计算 |
| `user:{userId}:rpm` | 用户 RPM 计数 | 120s |
| `circuit_breaker:state:{providerId}` | 熔断器状态 (Hash) | 86400s (24h) |
| `circuit_breaker:config:{providerId}` | 熔断器配置 (Hash) | 无 TTL |
| `endpoint_circuit_breaker:state:{endpointId}` | Endpoint 熔断器状态 | 86400s |
| `vendor_type_circuit_breaker:state:{vendorId}:{type}` | Vendor 类型熔断器 | 2592000s (30d) |
| `client_version:{clientType}:{userId}` | 用户客户端版本 | 604800s (7d) |
| `ga_version:{clientType}` | GA 版本缓存 | 300s (5min) |

## 环境变量配置

### 可配置的 TTL 参数

以下环境变量允许你调整缓存 TTL：

```bash
# .env.example

# Session TTL（秒）- 控制 Session 缓存时长
SESSION_TTL=300                         # 默认 300 秒 = 5 分钟

# 供应商进程级缓存开关
ENABLE_PROVIDER_CACHE=true              # 默认启用，30s TTL

# 限流功能开关（影响所有限流相关缓存）
ENABLE_RATE_LIMIT=true                  # 默认启用
```

### 固定 TTL 值

以下 TTL 值在代码中硬编码，无法通过环境变量调整：

| 缓存类型 | TTL 值 | 位置 |
|---------|--------|------|
| Provider 进程缓存 | 30s | `src/lib/cache/provider-cache.ts` |
| 系统设置缓存 | 60s | `src/lib/config/system-settings-cache.ts` |
| 熔断器配置缓存 | 5min | `src/lib/circuit-breaker.ts` |
| Session 并发计数 | 10min | `src/lib/session-tracker.ts` |
| 活跃 Session ZSET | 1h | `src/lib/session-tracker.ts` |
| 5h 消费窗口兜底 | 6h | `src/lib/redis/lua-scripts.ts` |
| 日消费窗口兜底 | 25h | `src/lib/redis/lua-scripts.ts` |
| 熔断器状态 | 24h | `src/lib/redis/circuit-breaker-state.ts` |
| Vendor 类型熔断器 | 30d | `src/lib/redis/vendor-type-circuit-breaker-state.ts` |
| 用户 RPM 计数 | 2min | `src/lib/rate-limit/service.ts` |
| 客户端版本 (User) | 7d | `src/lib/client-version-checker.ts` |
| 客户端版本 (GA) | 5min | `src/lib/client-version-checker.ts` |
| Session 列表缓存 | 2s | `src/lib/cache/session-cache.ts` |
| Session 详情缓存 | 1s | `src/lib/cache/session-cache.ts` |

## Session TTL 管理

### Session 生命周期

Session TTL 是 Claude Code Hub 最核心的缓存机制之一，默认 **5 分钟（300 秒）**，可通过 `SESSION_TTL` 环境变量调整。

**核心文件**: `src/lib/session-manager.ts`

```typescript
// SessionManager 中的 TTL 定义
private static readonly SESSION_TTL = parseInt(process.env.SESSION_TTL || "300", 10);
```

### Session 相关 Redis Key 及 TTL

每次请求涉及多个 Redis Key，它们的 TTL 统一由 `SESSION_TTL` 控制：

| Key 模式 | 用途 | 刷新时机 |
|---------|------|---------|
| `session:{id}:seq` | 请求序号计数器 | 首次创建时设置 TTL |
| `session:{id}:key` | 绑定的 API Key | 每次访问刷新 |
| `session:{id}:provider` | 绑定的 Provider | 每次访问刷新 |
| `session:{id}:info` | Session 元信息 (Hash) | 每次访问刷新 |
| `session:{id}:usage` | 使用量统计 (Hash) | 每次访问刷新 |
| `session:{id}:last_seen` | 最后访问时间 | 每次访问刷新 |
| `session:{id}:messages` | 消息内容 | 存储时设置 |
| `session:{id}:req:{seq}:messages` | 分请求消息存储 | 存储时设置 |
| `session:{id}:req:{seq}:response` | 分请求响应存储 | 存储时设置 |
| `session:{id}:req:{seq}:requestBody` | 请求体存储 | 存储时设置 |

### 滑动窗口机制

Session 采用**滑动窗口**（Sliding Window）机制：每次访问时刷新所有相关 Key 的 TTL，确保活跃 Session 不会过期。

```typescript
// src/lib/session-manager.ts
private static async refreshSessionTTL(sessionId: string): Promise<void> {
  const redis = getRedisClient();
  if (!redis || redis.status !== "ready") return;

  try {
    const pipeline = redis.pipeline();

    // 刷新所有 session 相关 key 的 TTL
    pipeline.expire(`session:${sessionId}:key`, SessionManager.SESSION_TTL);
    pipeline.expire(`session:${sessionId}:provider`, SessionManager.SESSION_TTL);
    pipeline.setex(
      `session:${sessionId}:last_seen`,
      SessionManager.SESSION_TTL,
      Date.now().toString()
    );

    await pipeline.exec();
  } catch (error) {
    logger.error("SessionManager: Failed to refresh TTL", { error });
  }
}
```

### Session 并发计数 TTL

Session 并发计数使用独立的 TTL（10 分钟），比 Session TTL 长一倍，防止计数泄漏：

```typescript
// src/lib/session-tracker.ts
static async incrementConcurrentCount(sessionId: string): Promise<void> {
  const key = `session:${sessionId}:concurrent_count`;
  await redis.incr(key);
  await redis.expire(key, 600); // 10 分钟 TTL
}
```

## 限流系统 TTL 管理

### 动态 TTL 计算

限流系统根据窗口类型和重置模式计算动态 TTL，确保数据在正确的时间点过期。

**核心文件**: `src/lib/rate-limit/time-utils.ts`

```typescript
export async function getTTLForPeriod(
  period: TimePeriod,
  resetTime = "00:00"
): Promise<number> {
  switch (period) {
    case "5h":
      return 5 * 3600; // 5 小时固定

    case "daily": {
      // 计算到下一个自定义重置时间的秒数
      const nextReset = getNextDailyResetTime(now, normalizedResetTime, timezone);
      return Math.max(1, Math.ceil((nextReset.getTime() - now.getTime()) / 1000));
    }

    case "weekly": {
      // 计算到下周一 00:00 的秒数
      const zonedNow = toZonedTime(now, timezone);
      const zonedStartOfWeek = startOfWeek(zonedNow, { weekStartsOn: 1 });
      const zonedNextWeek = addWeeks(zonedStartOfWeek, 1);
      const nextWeek = fromZonedTime(zonedNextWeek, timezone);
      return Math.ceil((nextWeek.getTime() - now.getTime()) / 1000);
    }

    case "monthly": {
      // 计算到下月 1 号 00:00 的秒数
      const zonedNow = toZonedTime(now, timezone);
      const zonedStartOfMonth = startOfMonth(zonedNow);
      const zonedNextMonth = addMonths(zonedStartOfMonth, 1);
      const nextMonth = fromZonedTime(zonedNextMonth, timezone);
      return Math.ceil((nextMonth.getTime() - now.getTime()) / 1000);
    }
  }
}
```

### 滚动窗口 vs 固定窗口 TTL

| 窗口类型 | 模式 | TTL 策略 |
|---------|------|---------|
| 5h | 滚动 | 固定 6 小时兜底 |
| daily | fixed | 到下一个重置时间点 |
| daily | rolling | 固定 24 小时 |
| weekly | 自然周 | 到下周一 00:00 |
| monthly | 自然月 | 到下月 1 号 00:00 |

### Lua 脚本中的兜底 TTL

Lua 脚本在执行时设置兜底 TTL，防止因程序异常导致数据永久堆积：

```lua
-- TRACK_COST_5H_ROLLING_WINDOW
-- 设置兜底 TTL（6 小时，防止数据永久堆积）
redis.call('EXPIRE', key, 21600)

-- TRACK_COST_DAILY_ROLLING_WINDOW
-- 设置兜底 TTL（25 小时，防止数据永久堆积）
redis.call('EXPIRE', key, 90000)
```

### RPM 限流 TTL

用户 RPM（每分钟请求数）计数使用 2 分钟 TTL：

```typescript
// src/lib/rate-limit/service.ts
await redis
  .pipeline()
  .zadd(key, now, `${now}:${Math.random()}`)
  .expire(key, 120) // 2 分钟 TTL
  .exec();
```

## 熔断器 TTL 管理

### 熔断器状态 TTL

熔断器状态持久化到 Redis，支持多实例共享和服务重启恢复。

**核心文件**: `src/lib/redis/circuit-breaker-state.ts`

```typescript
// State TTL: 24 hours (cleanup old states)
const STATE_TTL_SECONDS = 86400;

export async function saveCircuitState(
  providerId: number,
  state: CircuitBreakerState
): Promise<void> {
  const key = getStateKey(providerId); // circuit_breaker:state:{providerId}
  await redis.hset(key, data);
  await redis.expire(key, STATE_TTL_SECONDS);
}
```

### 多层级熔断器 TTL

| 熔断器类型 | Key 模式 | TTL |
|-----------|---------|-----|
| Provider 熔断器 | `circuit_breaker:state:{providerId}` | 24h |
| Endpoint 熔断器 | `endpoint_circuit_breaker:state:{endpointId}` | 24h |
| Vendor 类型熔断器 | `vendor_type_circuit_breaker:state:{vendorId}:{type}` | 30d |

### 熔断器配置缓存

熔断器配置从 Redis 加载，内存中缓存 5 分钟：

```typescript
// src/lib/circuit-breaker.ts
const CONFIG_CACHE_TTL = 5 * 60 * 1000; // 5 分钟

async function getProviderConfig(providerId: number): Promise<CircuitBreakerConfig> {
  // 检查内存缓存是否有效
  if (health.config && health.configLoadedAt && 
      now - health.configLoadedAt < CONFIG_CACHE_TTL) {
    return health.config;
  }
  // 从 Redis/数据库加载配置
  const config = await loadProviderCircuitConfig(providerId);
}
```

## Provider 缓存 TTL 管理

### 进程级缓存架构

Provider 配置使用进程级内存缓存 + Redis Pub/Sub 失效通知，实现高性能读取和跨实例同步。

**核心文件**: `src/lib/cache/provider-cache.ts`

```typescript
const CACHE_TTL_MS = 30_000; // 30 seconds

interface ProviderCacheState {
  data: Provider[] | null;
  expiresAt: number;
  version: number; // 防止并发刷新竞态
  refreshPromise: Promise<Provider[]> | null;
}
```

### 缓存失效机制

```typescript
// 失效通知频道
export const CHANNEL_PROVIDERS_UPDATED = "cch:cache:providers:updated";

// 发布失效通知（CRUD 操作后调用）
export async function publishProviderCacheInvalidation(): Promise<void> {
  invalidateCache();
  await publishCacheInvalidation(CHANNEL_PROVIDERS_UPDATED);
}

// 订阅失效通知
await subscribeCacheInvalidation(CHANNEL_PROVIDERS_UPDATED, () => {
  invalidateCache();
});
```

### 降级策略

当 Redis 不可用时，依赖 TTL 自动过期：

```typescript
export async function getCachedProviders(fetcher: () => Promise<Provider[]>): Promise<Provider[]> {
  // 检查是否启用缓存（默认启用）
  if (!ENABLE_PROVIDER_CACHE) {
    return fetcher();
  }

  // 缓存命中且未过期
  if (cache.data && cache.expiresAt > now) {
    return cache.data;
  }

  // 需要刷新，从数据库加载
  const data = await fetcher();
  cache.data = data;
  cache.expiresAt = Date.now() + CACHE_TTL_MS;
  return data;
}
```

## 系统设置缓存 TTL

### 内存缓存

系统设置使用 1 分钟内存缓存，避免每次代理请求都查询数据库。

**核心文件**: `src/lib/config/system-settings-cache.ts`

```typescript
/** Cache TTL in milliseconds (1 minute) */
const CACHE_TTL_MS = 60 * 1000;

export async function getCachedSystemSettings(): Promise<SystemSettings> {
  const now = Date.now();

  // Return cached if still valid
  if (cachedSettings && now - cachedAt < CACHE_TTL_MS) {
    return cachedSettings;
  }

  // Fetch fresh settings from database
  const settings = await getSystemSettings();
  cachedSettings = settings;
  cachedAt = now;
  return settings;
}
```

### Fail-Open 策略

获取失败时返回之前的缓存值或默认值：

```typescript
try {
  const settings = await getSystemSettings();
  cachedSettings = settings;
  cachedAt = now;
  return settings;
} catch (error) {
  // Fail-open: return previous cached value or defaults
  if (cachedSettings) {
    return cachedSettings;
  }
  // Return minimal default settings
  return { ...DEFAULT_SETTINGS };
}
```

## 客户端版本检查 TTL

### 双级缓存策略

客户端版本检查使用双级 TTL 策略：

**核心文件**: `src/lib/client-version-checker.ts`

```typescript
const TTL = {
  USER_VERSION: 7 * 24 * 60 * 60, // 7 天（匹配活跃窗口）
  GA_VERSION: 5 * 60,             // 5 分钟
};
```

| Key 模式 | 用途 | TTL |
|---------|------|-----|
| `client_version:{clientType}:{userId}` | 记录用户当前使用的客户端版本 | 7 天 |
| `ga_version:{clientType}` | 缓存该客户端类型的 GA 版本 | 5 分钟 |

## 边缘情况处理

### Redis 不可用（Fail-Open）

所有缓存组件都实现了 Fail-Open 策略：

```typescript
const redis = getRedisClient();
if (!redis || redis.status !== "ready") {
  // 降级处理：直接查询数据库或使用默认值
  return fetcher();
}
```

### TTL 竞态条件

使用 Redis Pipeline 和 Lua 脚本确保原子性：

```typescript
// Pipeline 确保多个操作原子性执行
const pipeline = redis.pipeline();
pipeline.zadd("global:active_sessions", now, sessionId);
pipeline.expire("global:active_sessions", 3600);
await pipeline.exec();
```

### 时钟漂移

限流系统使用应用服务器时间戳，但 TTL 计算基于 Redis 内部时钟。为减少时钟漂移影响：

1. 使用相对时间（毫秒偏移）而非绝对时间戳
2. 设置合理的兜底 TTL（比实际窗口长）
3. Lua 脚本中清理过期数据时使用时间戳比较

### 内存压力

为防止 Redis 内存无限增长：

1. **所有 Key 都有 TTL**：没有永久存储的数据
2. **兜底 TTL**：Lua 脚本中设置比实际窗口更长的兜底 TTL
3. **定期清理**：ZSET 类型数据在访问时自动清理过期成员
4. **Redis 配置建议**：
   ```
   maxmemory-policy allkeys-lru  # 或 volatile-lru
   ```

### 冷启动

应用启动时的缓存预热：

```typescript
// Provider 缓存预热
export async function warmupProviderCache(fetcher: () => Promise<Provider[]>): Promise<void> {
  try {
    await getCachedProviders(fetcher);
    logger.info("[ProviderCache] Cache warmed up successfully");
  } catch (error) {
    logger.warn("[ProviderCache] Cache warmup failed", { error });
  }
}

// 熔断器状态恢复
export async function loadAllCircuitStates(providerIds: number[]): Promise<Map<number, CircuitBreakerState>> {
  // 启动时从 Redis 批量加载所有熔断器状态
}
```

## 监控与调试

### Redis 命令参考

```bash
# 查看所有 Session 相关 Key
redis-cli --scan --pattern 'session:*'

# 查看特定 Session 的 TTL
redis-cli TTL session:abc123:key
redis-cli TTL session:abc123:provider

# 查看活跃 Session 集合
redis-cli ZRANGE global:active_sessions 0 -1 WITHSCORES

# 查看熔断器状态
redis-cli HGETALL circuit_breaker:state:1

# 查看内存使用
redis-cli INFO memory

# 查看 Key 数量
redis-cli DBSIZE

# 按模式统计 Key 数量
redis-cli --scan --pattern 'session:*:info' | wc -l
```

### 日志追踪

关键日志标记：

| 组件 | 日志标记 | 说明 |
|-----|---------|------|
| SessionManager | `SessionManager: Refreshed TTL` | TTL 刷新成功 |
| SessionTracker | `SessionTracker: Refreshed session` | Session 时间戳刷新 |
| ProviderCache | `[ProviderCache] Cache refreshed` | Provider 缓存刷新 |
| CircuitBreakerState | `[CircuitBreakerState] Saved to Redis` | 熔断器状态保存 |
| RateLimit | `[RateLimit] Cache miss` | 限流缓存未命中 |

## 配置建议

### 生产环境推荐配置

```bash
# Session TTL - 根据业务场景调整
# - 短对话场景：300s (5分钟)
# - 长对话场景：600s (10分钟) 或更长
SESSION_TTL=300

# 启用所有缓存
ENABLE_PROVIDER_CACHE=true
ENABLE_RATE_LIMIT=true

# Redis 配置
REDIS_URL=redis://localhost:6379
```

### 不同场景的调整建议

| 场景 | 建议调整 | 说明 |
|-----|---------|------|
| 高并发短对话 | SESSION_TTL=180 | 减少内存占用，加快 Session 轮换 |
| 长对话应用 | SESSION_TTL=600 | 避免长对话中频繁切换供应商 |
| 内存受限 | 减少 SESSION_TTL，禁用 ENABLE_PROVIDER_CACHE | 降低内存使用 |
| 多实例部署 | 保持默认配置 | Redis Pub/Sub 自动同步缓存失效 |

## 核心文件索引

| 文件 | 用途 |
|------|------|
| `src/lib/session-manager.ts` | Session TTL 管理、滑动窗口实现 |
| `src/lib/session-tracker.ts` | 活跃 Session 追踪、并发计数 |
| `src/lib/cache/provider-cache.ts` | Provider 进程级缓存（30s TTL） |
| `src/lib/cache/session-cache.ts` | Session 列表/详情内存缓存 |
| `src/lib/config/system-settings-cache.ts` | 系统设置缓存（60s TTL） |
| `src/lib/rate-limit/service.ts` | 限流服务、RPM 计数 |
| `src/lib/rate-limit/time-utils.ts` | 动态 TTL 计算 |
| `src/lib/redis/lua-scripts.ts` | Lua 脚本、兜底 TTL 设置 |
| `src/lib/redis/circuit-breaker-state.ts` | 熔断器状态持久化（24h TTL） |
| `src/lib/redis/circuit-breaker-config.ts` | 熔断器配置缓存 |
| `src/lib/redis/endpoint-circuit-breaker-state.ts` | Endpoint 熔断器状态 |
| `src/lib/redis/vendor-type-circuit-breaker-state.ts` | Vendor 类型熔断器状态（30d TTL） |
| `src/lib/circuit-breaker.ts` | 熔断器逻辑、配置缓存（5min） |
| `src/lib/client-version-checker.ts` | 客户端版本缓存 |
| `src/lib/config/env.schema.ts` | 环境变量验证、SESSION_TTL 定义 |

## 总结

Claude Code Hub 的 Cache TTL 控制系统通过多层级缓存架构实现了高性能与数据一致性的平衡：

1. **进程级缓存**（30s-60s）：Provider 配置、系统设置，减少数据库查询
2. **Redis 分布式缓存**（动态 TTL）：Session、限流、熔断器状态，支持多实例共享
3. **Fail-Open 设计**：所有组件在 Redis 不可用时自动降级，保证服务可用性
4. **灵活的 TTL 配置**：关键参数可通过环境变量调整，适应不同业务场景
5. **内存安全**：所有 Key 都有 TTL，Lua 脚本设置兜底过期时间，防止内存泄漏
