# 配额管理 (Quota Management) - Round 2 Verified Draft

## Intent Analysis

配额管理是 Claude Code Hub 中用于控制资源使用和消费成本的核心机制。该系统通过多层次、多维度的限额配置，确保系统资源被合理分配，防止单个用户或密钥过度消耗资源，同时为管理员提供精细化的成本控制能力。

配额管理的主要目标包括：

1. **成本控制**：通过设置消费上限，防止意外的高额 API 调用费用
2. **资源保护**：限制并发会话数和请求频率，保护上游供应商服务稳定性
3. **公平使用**：确保多用户环境下的资源公平分配
4. **分级管理**：支持用户级、密钥级和供应商级三重限额，实现精细化权限控制
5. **灵活配置**：支持多种时间窗口（5小时、日、周、月）和重置模式（固定时间、滚动窗口）

## Behavior Summary

配额管理系统在三个实体层级上运作：用户（User）、密钥（Key）和供应商（Provider）。每个层级都可以配置独立的限额参数，系统按照特定的优先级顺序进行检查。

### 核心行为特征

1. **分层限额检查**：系统按照"硬限制 → 资源保护 → 短期周期 → 中长期周期"的顺序进行检查
2. **Fail-Open 策略**：当 Redis 不可用或检查失败时，系统默认允许请求通过，避免服务中断
3. **实时追踪**：消费数据实时记录到 Redis，支持秒级精度
4. **自动重置**：支持固定时间重置和滚动窗口两种模式
5. **缓存预热**：当 Redis 数据丢失时，自动从数据库恢复并重建缓存

### 限额类型矩阵

| 限额类型 | 用户级 | 密钥级 | 供应商级 | 说明 |
|---------|--------|--------|----------|------|
| 总消费限额 (Total) | ✓ | ✓ | ✓ | 永久累计消费上限，支持手动重置 |
| 5小时消费 (5h) | ✓ | ✓ | ✓ | 滚动窗口消费限额 |
| 每日消费 (Daily) | ✓ | ✓ | ✓ | 日消费限额，支持 fixed/rolling 模式 |
| 每周消费 (Weekly) | ✓ | ✓ | ✓ | 自然周消费限额（周一 00:00 重置） |
| 每月消费 (Monthly) | ✓ | ✓ | ✓ | 自然月消费限额（1号 00:00 重置） |
| 并发会话 (Concurrent) | ✓ | ✓ | ✓ | 同时进行的会话数上限 |
| 每分钟请求 (RPM) | ✓ | ✗ | ✗ | 用户级请求频率限制 |

### 检查顺序设计

限额检查顺序经过精心设计，遵循以下原则（来自 `rate-limit-guard.ts`）：

```
1-2. 永久硬限制：Key 总限额 → User 总限额
3-5. 资源/频率保护：Key 并发 → User 并发 → User RPM
6-9. 短期周期限额：Key 5h → User 5h → Key 每日 → User 每日
10-13. 中长期周期限额：Key 周 → User 周 → Key 月 → User 月
```

设计原则：
- **硬上限优先于周期上限**：永久超限的请求最早被拒绝
- **同一窗口内 Key → User 交替**：避免单方超限影响另一方
- **资源/频率保护足够靠前**：并发和频率限制在消费检查之前
- **高触发概率窗口优先**：短期限额先于中长期限额检查

## Config/Commands

### 数据库 Schema 配置

配额配置存储在数据库的三个核心表中：

#### 1. Users 表 (`src/drizzle/schema.ts`)

```typescript
export const users = pgTable('users', {
  // ... 基础字段 ...
  
  // 传统限额字段（保持向后兼容）
  rpmLimit: integer('rpm_limit'),
  dailyLimitUsd: numeric('daily_limit_usd', { precision: 10, scale: 2 }),
  
  // 用户级限额字段（新增）
  limit5hUsd: numeric('limit_5h_usd', { precision: 10, scale: 2 }),
  limitWeeklyUsd: numeric('limit_weekly_usd', { precision: 10, scale: 2 }),
  limitMonthlyUsd: numeric('limit_monthly_usd', { precision: 10, scale: 2 }),
  limitTotalUsd: numeric('limit_total_usd', { precision: 10, scale: 2 }),
  limitConcurrentSessions: integer('limit_concurrent_sessions'),
  
  // 每日限额重置配置
  dailyResetMode: dailyResetModeEnum('daily_reset_mode')
    .default('fixed')
    .notNull(), // 'fixed' 或 'rolling'
  dailyResetTime: varchar('daily_reset_time', { length: 5 })
    .default('00:00')
    .notNull(), // HH:mm 格式
  
  // 用户状态管理
  isEnabled: boolean('is_enabled').notNull().default(true),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  
  // ... 其他字段 ...
});
```

#### 2. Keys 表 (`src/drizzle/schema.ts`)

```typescript
export const keys = pgTable('keys', {
  // ... 基础字段 ...
  
  // 金额限流配置
  limit5hUsd: numeric('limit_5h_usd', { precision: 10, scale: 2 }),
  limitDailyUsd: numeric('limit_daily_usd', { precision: 10, scale: 2 }),
  dailyResetMode: dailyResetModeEnum('daily_reset_mode')
    .default('fixed')
    .notNull(),
  dailyResetTime: varchar('daily_reset_time', { length: 5 })
    .default('00:00')
    .notNull(),
  limitWeeklyUsd: numeric('limit_weekly_usd', { precision: 10, scale: 2 }),
  limitMonthlyUsd: numeric('limit_monthly_usd', { precision: 10, scale: 2 }),
  limitTotalUsd: numeric('limit_total_usd', { precision: 10, scale: 2 }),
  limitConcurrentSessions: integer('limit_concurrent_sessions').default(0),
  
  // ... 其他字段 ...
});
```

#### 3. Providers 表 (`src/drizzle/schema.ts`)

```typescript
export const providers = pgTable('providers', {
  // ... 基础字段 ...
  
  // 金额限流配置
  limit5hUsd: numeric('limit_5h_usd', { precision: 10, scale: 2 }),
  limitDailyUsd: numeric('limit_daily_usd', { precision: 10, scale: 2 }),
  dailyResetMode: dailyResetModeEnum('daily_reset_mode')
    .default('fixed')
    .notNull(),
  dailyResetTime: varchar('daily_reset_time', { length: 5 })
    .default('00:00')
    .notNull(),
  limitWeeklyUsd: numeric('limit_weekly_usd', { precision: 10, scale: 2 }),
  limitMonthlyUsd: numeric('limit_monthly_usd', { precision: 10, scale: 2 }),
  limitTotalUsd: numeric('limit_total_usd', { precision: 10, scale: 2 }),
  totalCostResetAt: timestamp('total_cost_reset_at', { withTimezone: true }),
  limitConcurrentSessions: integer('limit_concurrent_sessions').default(0),
  
  // ... 其他字段 ...
});
```

### 系统设置配置

配额租约（Lease）机制的配置存储在 System Settings 中：

```typescript
// src/drizzle/schema.ts
export const systemSettings = pgTable('system_settings', {
  // ... 其他配置 ...
  
  // Quota lease settings
  quotaDbRefreshIntervalSeconds: integer('quota_db_refresh_interval_seconds').default(10),
  quotaLeasePercent5h: numeric('quota_lease_percent_5h', { precision: 5, scale: 4 }).default('0.05'),
  quotaLeasePercentDaily: numeric('quota_lease_percent_daily', { precision: 5, scale: 4 }).default('0.05'),
  quotaLeasePercentWeekly: numeric('quota_lease_percent_weekly', { precision: 5, scale: 4 }).default('0.05'),
  quotaLeasePercentMonthly: numeric('quota_lease_percent_monthly', { precision: 5, scale: 4 }).default('0.05'),
  quotaLeaseCapUsd: numeric('quota_lease_cap_usd', { precision: 10, scale: 2 }),
});
```

### 供应商限额常量

```typescript
// src/lib/constants/provider.constants.ts
export const PROVIDER_LIMITS = {
  // 权重：用于加权轮询，1-100 覆盖绝大多数场景
  WEIGHT: { MIN: 1, MAX: 100 },
  // 单个供应商最大重试次数
  MAX_RETRY_ATTEMPTS: { MIN: 1, MAX: 10 },
  // 5小时消费上限：0.1 - 1000 USD，步进 1 美元
  LIMIT_5H_USD: { MIN: 0.1, MAX: 1000, STEP: 1 },
  // 周消费上限：1 - 5000 USD，步进 1 美元
  LIMIT_WEEKLY_USD: { MIN: 1, MAX: 5000, STEP: 1 },
  // 月消费上限：10 - 30000 USD，步进 1 美元
  LIMIT_MONTHLY_USD: { MIN: 10, MAX: 30000, STEP: 1 },
  // 并发 Session 上限：1 - 150
  CONCURRENT_SESSIONS: { MIN: 1, MAX: 150 },
} as const;
```

## Edge Cases

### 1. Redis 不可用时的降级处理

当 Redis 不可用时，系统会降级到数据库查询：

```typescript
// src/lib/rate-limit/service.ts
static async checkCostLimits(...) {
  try {
    // Fast Path: Redis 查询
    if (RateLimitService.redis && RateLimitService.redis.status === "ready") {
      // ... Redis 逻辑 ...
    }
    
    // Slow Path: Redis 不可用，降级到数据库
    logger.warn(`[RateLimit] Redis unavailable, checking ${type} cost limits from database`);
    return await RateLimitService.checkCostLimitsFromDatabase(id, type, costLimits);
  } catch (error) {
    logger.error("[RateLimit] Check failed, fallback to database:", error);
    return await RateLimitService.checkCostLimitsFromDatabase(id, type, costLimits);
  }
}
```

降级策略：
- Redis 连接失败时自动降级到数据库查询
- 数据库查询使用 `sumKeyCostInTimeRange`、`sumUserCostInTimeRange` 等函数
- 降级过程对用户透明，不会中断服务

### 2. 缓存 Miss 处理

当 Redis 中不存在限额数据时（如 Redis 重启后），系统会从数据库恢复并预热缓存：

```typescript
// Cache Miss 检测
if (current === 0) {
  const exists = await RateLimitService.redis.exists(key);
  if (!exists) {
    logger.info(`[RateLimit] Cache miss for ${type}:${id}:cost_5h, querying database`);
    return await RateLimitService.checkCostLimitsFromDatabase(id, type, costLimits);
  }
}
```

对于滚动窗口（5h/daily rolling），系统还会从数据库查询历史记录并重建 ZSET：

```typescript
// 从数据库查询消费明细
const entries = await findKeyCostEntriesInTimeRange(id, startTime, endTime);

// 重建 Redis ZSET
await RateLimitService.warmRollingCostZset(key, entries, ttlSeconds);
```

### 3. 并发竞态条件处理

供应商并发会话限制使用 Lua 脚本保证原子性：

```lua
-- src/lib/redis/lua-scripts.ts
-- CHECK_AND_TRACK_SESSION
-- 1. 清理过期 session（5 分钟前）
-- 2. 检查 session 是否已追踪（避免重复计数）
-- 3. 检查当前并发数是否超限
-- 4. 如果未超限，追踪新 session（原子操作）
```

Lua 脚本返回值：
- `{1, count, 1}` - 允许（新追踪），返回新的并发数和 tracked=1
- `{1, count, 0}` - 允许（已追踪），返回当前并发数和 tracked=0
- `{0, count, 0}` - 拒绝（超限），返回当前并发数和 tracked=0

### 4. 限额变更时的租约失效

当限额配置发生变化时，租约服务会检测到并强制刷新：

```typescript
// src/lib/rate-limit/lease-service.ts
if (lease.limitAmount !== limitAmount) {
  logger.debug("[LeaseService] Limit changed, force refresh", {
    key: leaseKey,
    cachedLimit: lease.limitAmount,
    newLimit: limitAmount,
  });
  return await LeaseService.refreshCostLeaseFromDb(params);
}
```

### 5. 滚动窗口与固定窗口的边界处理

每日限额支持两种重置模式：

**Fixed 模式**：在指定时间重置（如每天 18:00）
- 使用 Redis STRING 类型存储累计值
- Key 格式：`{type}:{id}:cost_daily_{suffix}`（如 `key:123:cost_daily_1800`）
- TTL 计算到下一个重置时间

**Rolling 模式**：过去 24 小时的滚动窗口
- 使用 Redis ZSET 类型存储每条消费记录
- Key 格式：`{type}:{id}:cost_daily_rolling`
- TTL 固定 24 小时

```typescript
// src/lib/rate-limit/time-utils.ts
export async function getTimeRangeForPeriodWithMode(
  period: TimePeriod,
  resetTime = "00:00",
  mode: DailyResetMode = "fixed"
): Promise<TimeRange> {
  if (period === "daily" && mode === "rolling") {
    // 滚动窗口：过去 24 小时
    const now = new Date();
    return {
      startTime: new Date(now.getTime() - 24 * 60 * 60 * 1000),
      endTime: now,
    };
  }
  // 其他情况使用原有逻辑
  return getTimeRangeForPeriod(period, resetTime);
}
```

### 6. 总消费限额的手动重置

供应商的总消费限额支持手动重置：

```typescript
// 通过更新 totalCostResetAt 字段来重置累计消费
limitTotalUsd: numeric('limit_total_usd', { precision: 10, scale: 2 }),
totalCostResetAt: timestamp('total_cost_reset_at', { withTimezone: true }),
```

重置逻辑：
- `totalCostResetAt` 为 null 时，从历史最早记录开始累计
- `totalCostResetAt` 有值时，从该时间点开始累计
- 适用于需要周期性重置总限额场景（如每月重置）

### 7. 时间边界和时区处理

配额管理系统使用时区感知的时间计算：

```typescript
// src/lib/rate-limit/time-utils.ts
function getCustomDailyResetTime(now: Date, resetTime: string, timezone: string): Date {
  const { hours, minutes } = parseResetTime(resetTime);
  const zonedNow = toZonedTime(now, timezone);
  const zonedResetToday = buildZonedDate(zonedNow, hours, minutes);
  const resetToday = fromZonedTime(zonedResetToday, timezone);

  if (now >= resetToday) {
    return resetToday;
  }

  return addDays(resetToday, -1);
}
```

系统使用 `date-fns-tz` 库处理时区转换，确保在全球不同地区的部署都能正确计算时间窗口。时区配置通过 `resolveSystemTimezone()` 获取，支持系统级时区设置。

### 8. 限额值为 null 或 0 的处理

当限额值为 null 或 0 时，系统视为无限制：

```typescript
// src/lib/rate-limit/service.ts
if (!limit.amount || limit.amount <= 0) continue; // 跳过未设置的限额

// 总消费限额检查
if (limitTotalUsd === null || limitTotalUsd === undefined || limitTotalUsd <= 0) {
  return { allowed: true };
}
```

### 9. 并发会话的清理机制

并发会话使用 Redis Sorted Set 存储，自动清理 5 分钟前的过期记录：

```lua
-- 清理过期 session（5 分钟前）
local five_minutes_ago = now - ttl
redis.call('ZREMRANGEBYSCORE', provider_key, '-inf', five_minutes_ago)
```

SessionTracker 维护以下 ZSET：
- `global:active_sessions` - 全局活跃会话
- `key:${keyId}:active_sessions` - Key 级活跃会话
- `user:${userId}:active_sessions` - User 级活跃会话
- `provider:${providerId}:active_sessions` - Provider 级活跃会话

### 10. 租约过期后的行为

当租约过期后，系统会自动从数据库刷新：

```typescript
// src/lib/rate-limit/lease-service.ts
if (lease && !isLeaseExpired(lease)) {
  // 使用缓存的租约
  return lease;
}
// 租约过期或不存在，从数据库刷新
return await LeaseService.refreshCostLeaseFromDb(params);
```

租约刷新间隔由 `quotaDbRefreshIntervalSeconds` 配置控制，默认 10 秒。

## Implementation Details

### Redis 数据结构详解

#### 固定窗口（STRING 类型）

固定窗口使用 Redis STRING 类型存储累计消费金额：

```
Key: key:123:cost_daily_1800
Value: 15.50
TTL: 到下一个重置时间的秒数
```

更新操作使用 `INCRBYFLOAT` 命令：

```typescript
pipeline.incrbyfloat(`key:${keyId}:cost_daily_${suffix}`, cost);
pipeline.expire(`key:${keyId}:cost_daily_${suffix}`, ttlDailyKey);
```

#### 滚动窗口（ZSET 类型）

滚动窗口使用 Redis Sorted Set 存储每条消费记录：

```
Key: key:123:cost_5h_rolling
Type: ZSET
Member: timestamp:requestId:cost
Score: timestamp
```

例如：
```
1715424000000:req_abc123:0.5
1715427600000:req_def456:1.2
1715431200000:req_ghi789:0.8
```

查询时使用 Lua 脚本清理过期记录并计算总和：

```lua
-- 1. 清理过期记录
redis.call('ZREMRANGEBYSCORE', key, '-inf', now_ms - window_ms)

-- 2. 计算窗口内总消费
local records = redis.call('ZRANGE', key, 0, -1)
local total = 0
for _, record in ipairs(records) do
  local cost_str = string.match(record, '.*:(.+)')
  if cost_str then
    total = total + tonumber(cost_str)
  end
end
```

#### 租约存储（STRING 类型）

租约使用 JSON 字符串存储在 Redis 中：

```
Key: lease:key:123:daily
Value: {
  "entityType": "key",
  "entityId": 123,
  "window": "daily",
  "resetMode": "fixed",
  "resetTime": "00:00",
  "snapshotAtMs": 1715424000000,
  "currentUsage": 45.50,
  "limitAmount": 100,
  "remainingBudget": 5,
  "ttlSeconds": 10
}
TTL: 10 秒（由 quotaDbRefreshIntervalSeconds 配置）
```

### 租约机制详解

租约（Lease）机制是为了减少对数据库的频繁查询而设计的缓存策略。

#### 租约结构

```typescript
interface BudgetLease {
  entityType: 'key' | 'user' | 'provider';
  entityId: number;
  window: '5h' | 'daily' | 'weekly' | 'monthly';
  resetMode: 'fixed' | 'rolling';
  resetTime: string;
  snapshotAtMs: number;      // 租约创建时间
  currentUsage: number;      // 数据库查询的当前使用量
  limitAmount: number;       // 限额值
  remainingBudget: number;   // 剩余预算（租约切片）
  ttlSeconds: number;        // 租约有效期
}
```

#### 租约切片计算

租约切片是限额的一个百分比，用于控制缓存的粒度：

```typescript
// 默认配置（从 system_settings 读取）
const leasePercentConfig = {
  quotaLeasePercent5h: 0.05,      // 5%
  quotaLeasePercentDaily: 0.05,   // 5%
  quotaLeasePercentWeekly: 0.05,  // 5%
  quotaLeasePercentMonthly: 0.05, // 5%
};

// 计算租约切片
const remainingBudget = calculateLeaseSlice({
  limitAmount,
  currentUsage,
  percent: 0.05,
  capUsd: settings.quotaLeaseCapUsd, // 可选的上限
});
```

计算公式：
```
remainingBudget = min(limit * percent, remaining, capUsd)
```

#### 租约扣减流程

1. 请求通过限额检查后，从租约中预扣预算
2. 请求完成后，根据实际消费扣减租约
3. 当租约剩余预算不足时，触发刷新或拒绝请求

```typescript
// 检查租约
const lease = await LeaseService.getCostLease({...});
if (lease.remainingBudget <= 0) {
  return { allowed: false, reason: '限额已用完' };
}

// 请求完成后扣减（使用 Lua 脚本保证原子性）
await LeaseService.decrementLeaseBudget({
  entityType, entityId, window, cost
});
```

租约扣减使用 Lua 脚本保证原子性：

```lua
local key = KEYS[1]
local cost = tonumber(ARGV[1])

local leaseJson = redis.call('GET', key)
if not leaseJson then
  return {-1, 0}  -- Key 不存在
end

local lease = cjson.decode(leaseJson)
local remaining = tonumber(lease.remainingBudget) or 0

if remaining < cost then
  return {0, 0}  -- 预算不足
end

lease.remainingBudget = remaining - cost
redis.call('SET', key, cjson.encode(lease))
return {lease.remainingBudget, 1}  -- 成功
```

### 批量查询优化

为避免 N+1 查询问题，系统实现了批量查询：

```typescript
// src/lib/rate-limit/service.ts
static async getCurrentCostBatch(
  providerIds: number[],
  dailyResetConfigs: Map<number, { resetTime?: string | null; resetMode?: string | null }>
): Promise<Map<number, { cost5h: number; costDaily: number; costWeekly: number; costMonthly: number }>> {
  // 使用 Redis Pipeline 批量查询
  const pipeline = RateLimitService.redis.pipeline();
  
  for (const providerId of providerIds) {
    // 添加多个查询命令到 pipeline
    pipeline.eval(GET_COST_5H_ROLLING_WINDOW, ...);
    pipeline.get(`provider:${providerId}:cost_daily_${suffix}`);
    pipeline.get(`provider:${providerId}:cost_weekly`);
    pipeline.get(`provider:${providerId}:cost_monthly`);
  }
  
  // 一次性执行所有命令
  const results = await pipeline.exec();
  // 解析结果...
}
```

优化效果：
- 优化前：50 个供应商 = 52 次 DB 查询 + 250 次 Redis 查询
- 优化后：50 个供应商 = 2 次 DB 查询 + 2 次 Redis Pipeline 查询

### 限额检查顺序设计

限额检查顺序经过精心设计，遵循以下原则：

```typescript
// src/app/v1/_lib/proxy/rate-limit-guard.ts
/**
 * 检查顺序（基于 Codex 专业分析）：
 * 1-2. 永久硬限制：Key 总限额 → User 总限额
 * 3-5. 资源/频率保护：Key 并发 → User 并发 → User RPM
 * 6-9. 短期周期限额：Key 5h → User 5h → Key 每日 → User 每日
 * 10-13. 中长期周期限额：Key 周 → User 周 → Key 月 → User 月
 *
 * 设计原则：
 * - 硬上限优先于周期上限
 * - 同一窗口内 Key → User 交替
 * - 资源/频率保护足够靠前
 * - 高触发概率窗口优先
 */
```

这种顺序确保：
1. **快速失败**：永久超限的请求最早被拒绝
2. **资源保护**：并发和频率限制在消费检查之前
3. **公平性**：Key 和 User 限额交替检查，避免单方超限影响另一方

### 错误处理与日志

限额检查过程中的关键日志：

```typescript
// 限额超限警告
logger.warn(`[RateLimit] Key total limit exceeded: key=${key.id}, ${keyTotalCheck.reason}`);

// Redis 降级警告
logger.warn(`[RateLimit] Redis unavailable, checking ${type} cost limits from database`);

// 缓存 Miss 信息
logger.info(`[RateLimit] Cache miss for ${type}:${id}:cost_5h, querying database`);

// 租约刷新调试
logger.debug("[LeaseService] Lease refreshed from DB", {
  key: leaseKey,
  currentUsage,
  remainingBudget,
  ttl: ttlSeconds,
});
```

## Data Flow Architecture

### 完整请求生命周期中的配额管理

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              HTTP Request                                    │
└─────────────────────────────────────────────────────────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                        1. Authentication (auth-guard)                        │
│                           - 验证 API Key                                     │
│                           - 加载 User/Key 配置                               │
└─────────────────────────────────────────────────────────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                     2. Session Assignment (session-guard)                    │
│                        - 分配/复用 Session ID                                │
│                        - 初始化 Session 追踪                                 │
└─────────────────────────────────────────────────────────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                      3. Rate Limit Check (rate-limit-guard)                  │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ Layer 1: 永久硬限制                                                  │   │
│  │   - Key Total Limit                                                 │   │
│  │   - User Total Limit                                                │   │
│  ├─────────────────────────────────────────────────────────────────────┤   │
│  │ Layer 2: 资源/频率保护                                               │   │
│  │   - Key Concurrent Sessions                                         │   │
│  │   - User Concurrent Sessions                                        │   │
│  │   - User RPM                                                        │   │
│  ├─────────────────────────────────────────────────────────────────────┤   │
│  │ Layer 3-4: 周期消费限额                                              │   │
│  │   - 5h / Daily / Weekly / Monthly                                   │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                      4. Provider Selection                                   │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ 供应商选择时再次检查供应商限额                                         │   │
│  │   - Provider Cost Limits (5h/daily/weekly/monthly)                  │   │
│  │   - Provider Total Limit                                            │   │
│  │   - Provider Concurrent Sessions                                    │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                      5. Request Processing                                   │
│                        - 发送到上游供应商                                    │
│                        - 接收响应                                            │
└─────────────────────────────────────────────────────────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                      6. Cost Tracking                                        │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ 请求完成后追踪消费                                                    │   │
│  │   - Track Key Cost (Redis + 租约扣减)                                │   │
│  │   - Track Provider Cost (Redis)                                     │   │
│  │   - Track User Daily Cost (Redis)                                   │   │
│  │   - Save to Database (message_request)                              │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 消费追踪时序图

```
Client          Proxy Handler          RateLimitService         Redis           Database
  │                    │                       │                  │                │
  │ ─────────────────> │                       │                  │                │
  │     Request        │                       │                  │                │
  │                    │ ─────────────────────>│                  │                │
  │                    │    checkCostLimits()  │                  │                │
  │                    │                       │ ───────────────> │                │
  │                    │                       │   GET cost_key   │                │
  │                    │                       │ <─────────────── │                │
  │                    │ <─────────────────────│   allowed=true   │                │
  │                    │                       │                  │                │
  │                    │ ────────────────────────────────────────────────────────>│
  │                    │            Forward to Provider                         │
  │                    │ <────────────────────────────────────────────────────────│
  │                    │            Response from Provider                      │
  │                    │                       │                  │                │
  │                    │ ─────────────────────>│                  │                │
  │                    │      trackCost()      │                  │                │
  │                    │                       │ ───────────────> │                │
  │                    │                       │  INCRBYFLOAT     │                │
  │                    │                       │ <─────────────── │                │
  │                    │                       │                  │                │
  │                    │ ────────────────────────────────────────────────────────>│
  │                    │         INSERT message_request                        │
  │                    │ <────────────────────────────────────────────────────────│
  │                    │                       │                  │                │
  │ <───────────────── │                       │                  │                │
  │     Response       │                       │                  │                │
```

## Provider Selection Integration

配额检查在供应商选择阶段也发挥着重要作用。

### 会话复用时的限额检查

```typescript
// src/app/v1/_lib/proxy/provider-selector.ts
async function tryReuseSession(...): Promise<SessionReuseResult | null> {
  // ... 其他检查 ...
  
  // 会话复用也必须遵守限额（否则会绕过"达到限额即禁用"的语义）
  const costCheck = await RateLimitService.checkCostLimitsWithLease(provider.id, "provider", {
    limit_5h_usd: provider.limit5hUsd,
    limit_daily_usd: provider.limitDailyUsd,
    daily_reset_mode: provider.dailyResetMode,
    daily_reset_time: provider.dailyResetTime,
    limit_weekly_usd: provider.limitWeeklyUsd,
    limit_monthly_usd: provider.limitMonthlyUsd,
  });

  if (!costCheck.allowed) {
    logger.debug("ProviderSelector: Session provider cost limit exceeded, reject reuse", {
      sessionId: session.sessionId,
      providerId: provider.id,
    });
    return null;
  }
  
  // 检查总消费限额
  const totalCheck = await RateLimitService.checkTotalCostLimit(
    provider.id,
    "provider",
    provider.limitTotalUsd,
    { resetAt: provider.totalCostResetAt }
  );

  if (!totalCheck.allowed) {
    logger.debug("ProviderSelector: Session provider total cost limit exceeded, reject reuse");
    return null;
  }
  
  // ...
}
```

### 供应商选择时的限额过滤

```typescript
// src/app/v1/_lib/proxy/provider-selector.ts
private async filterByLimits(providers: Provider[]): Promise<Provider[]> {
  const results = await Promise.all(
    providers.map(async (p) => {
      // 1. 检查临时熔断（vendor+type）
      if (await isVendorTypeCircuitOpen(p.providerVendorId, p.providerType)) {
        return null;
      }

      // 2. 检查熔断器状态
      if (await isCircuitOpen(p.id)) {
        return null;
      }

      // 3. 检查金额限制
      const costCheck = await RateLimitService.checkCostLimitsWithLease(p.id, "provider", {
        limit_5h_usd: p.limit5hUsd,
        limit_daily_usd: p.limitDailyUsd,
        daily_reset_mode: p.dailyResetMode,
        daily_reset_time: p.dailyResetTime,
        limit_weekly_usd: p.limitWeeklyUsd,
        limit_monthly_usd: p.limitMonthlyUsd,
      });

      if (!costCheck.allowed) {
        return null;
      }

      // 4. 检查总消费上限
      const totalCheck = await RateLimitService.checkTotalCostLimit(
        p.id,
        "provider",
        p.limitTotalUsd,
        { resetAt: p.totalCostResetAt }
      );

      if (!totalCheck.allowed) {
        return null;
      }

      return p;
    })
  );

  return results.filter((p): p is Provider => p !== null);
}
```

供应商选择时的限额检查顺序：
1. 临时熔断检查（vendor+type 维度）
2. 熔断器状态检查
3. 周期消费限额检查（使用租约机制）
4. 总消费限额检查

注意：并发 Session 限制检查已移至原子性检查阶段（ensure 方法中），以避免竞态条件。

## Frontend Integration

### 配额状态展示组件

```typescript
// src/lib/utils/quota-helpers.ts
export type KeyQuota = {
  cost5h: { current: number; limit: number | null };
  costDaily: { current: number; limit: number | null };
  costWeekly: { current: number; limit: number | null };
  costMonthly: { current: number; limit: number | null };
  concurrentSessions: { current: number; limit: number };
} | null;

export type UserQuota = {
  rpm: { current: number; limit: number | null; window: "per_minute" };
  dailyCost: { current: number; limit: number | null; resetAt?: Date };
} | null;

// 计算使用率
export function getUsageRate(current: number, limit: number | null): number {
  if (!limit || limit <= 0) return 0;
  return (current / limit) * 100;
}

// 获取状态颜色
export function getQuotaColorClass(rate: number): "normal" | "warning" | "danger" | "exceeded" {
  if (rate >= 100) return "exceeded";
  if (rate >= 80) return "danger";
  if (rate >= 60) return "warning";
  return "normal";
}

// 获取状态标签
export function getQuotaStatus(keyQuota: KeyQuota, userQuota: UserQuota): "正常" | "预警" | "超限" {
  if (isExceeded(keyQuota, userQuota)) {
    return "超限";
  }
  if (isWarning(keyQuota, userQuota)) {
    return "预警";
  }
  return "正常";
}
```

### 供应商配额管理页面

```typescript
// src/app/[locale]/dashboard/quotas/providers/page.tsx
async function getProvidersWithQuotas() {
  const providers = await getProviders();

  // 使用批量查询获取所有供应商的限额数据（避免 N+1 查询问题）
  // 优化前: 50 个供应商 = 52 DB + 250 Redis 查询
  // 优化后: 50 个供应商 = 2 DB + 2 Redis Pipeline 查询
  const quotaMap = await getProviderLimitUsageBatch(
    providers.map((p) => ({
      id: p.id,
      dailyResetTime: p.dailyResetTime,
      dailyResetMode: p.dailyResetMode,
      limit5hUsd: p.limit5hUsd,
      limitDailyUsd: p.limitDailyUsd,
      limitWeeklyUsd: p.limitWeeklyUsd,
      limitMonthlyUsd: p.limitMonthlyUsd,
      limitConcurrentSessions: p.limitConcurrentSessions,
    }))
  );

  // 组装数据...
}
```

### 用户配额管理页面

```typescript
// src/app/[locale]/dashboard/quotas/users/page.tsx
async function getUsersWithQuotas(): Promise<UserQuotaWithUsage[]> {
  const users = await getUsers();

  const usersWithQuotas = await Promise.all(
    users.map(async (user) => {
      // Fetch quota usage and total cost in parallel
      const [quotaResult, totalUsage] = await Promise.all([
        getUserLimitUsage(user.id),
        sumUserTotalCost(user.id, ALL_TIME_MAX_AGE_DAYS),
      ]);
      
      // 获取用户的 Key 列表及其配额
      const keysWithUsage = await Promise.all(
        user.keys.map(async (key) => {
          const keyTotalUsage = await sumKeyTotalCostById(key.id, ALL_TIME_MAX_AGE_DAYS);
          return {
            id: key.id,
            name: key.name,
            totalUsage: keyTotalUsage,
            limit5hUsd: key.limit5hUsd,
            limitDailyUsd: key.limitDailyUsd,
            // ...
          };
        })
      );

      return {
        ...user,
        keys: keysWithUsage,
      };
    })
  );
}
```

### 密钥配额查询

```typescript
// src/actions/key-quota.ts
export async function getKeyQuotaUsage(keyId: number): Promise<ActionResult<KeyQuotaUsageResult>> {
  // ... 权限检查 ...
  
  // Calculate time ranges using Key's dailyResetTime/dailyResetMode configuration
  const keyDailyTimeRange = await getTimeRangeForPeriodWithMode(
    "daily",
    keyRow.dailyResetTime ?? "00:00",
    (keyRow.dailyResetMode as DailyResetMode | undefined) ?? "fixed"
  );

  // 5h/weekly/monthly use unified time ranges
  const range5h = await getTimeRangeForPeriod("5h");
  const rangeWeekly = await getTimeRangeForPeriod("weekly");
  const rangeMonthly = await getTimeRangeForPeriod("monthly");

  // 查询各周期消费数据
  const [cost5h, costDaily, costWeekly, costMonthly, totalCost, concurrentSessions] =
    await Promise.all([
      sumKeyCostInTimeRange(keyId, range5h.startTime, range5h.endTime),
      sumKeyCostInTimeRange(keyId, keyDailyTimeRange.startTime, keyDailyTimeRange.endTime),
      sumKeyCostInTimeRange(keyId, rangeWeekly.startTime, rangeWeekly.endTime),
      sumKeyCostInTimeRange(keyId, rangeMonthly.startTime, rangeMonthly.endTime),
      getTotalUsageForKey(keyRow.key),
      SessionTracker.getKeySessionCount(keyId),
    ]);
    
  // 组装返回数据...
}
```

## Performance Considerations

### Redis 性能优化

1. **Pipeline 批量操作**：使用 Redis Pipeline 减少网络往返
2. **Lua 脚本原子性**：使用 Lua 脚本保证复杂操作的原子性
3. **TTL 自动过期**：设置合理的 TTL 避免数据永久堆积
4. **ZSET 滑动窗口**：使用 Sorted Set 实现精确的滚动窗口

### 数据库查询优化

1. **复合索引优化**：
   ```sql
   -- 优化统计查询的复合索引
   CREATE INDEX idx_message_request_user_date_cost 
   ON message_request(user_id, created_at, cost_usd) 
   WHERE deleted_at IS NULL;
   ```

2. **时间范围查询优化**：
   ```typescript
   // 使用明确的时区转换避免全表扫描
   const zonedNow = toZonedTime(now, timezone);
   const zonedStartOfWeek = startOfWeek(zonedNow, { weekStartsOn: 1 });
   const startTime = fromZonedTime(zonedStartOfWeek, timezone);
   ```

3. **批量查询**：使用 `Promise.all` 并行查询多个时间范围

### 缓存策略

1. **Fast Path / Slow Path**：优先使用 Redis，降级到数据库
2. **租约缓存**：使用租约机制缓存限额状态，默认 10 秒刷新
3. **总消费缓存**：5 分钟 TTL 缓存总消费
4. **缓存预热**：Redis 数据丢失时自动从数据库恢复

## Security Considerations

### Fail-Open 策略

系统在以下情况会放行请求：

1. Redis 不可用
2. 限额检查失败（抛出异常）
3. 租约获取失败
4. RPM 检查失败

```typescript
try {
  // 限额检查
} catch (error) {
  logger.error("[RateLimit] Check failed:", error);
  return { allowed: true }; // Fail Open
}
```

这种设计确保了即使配额系统出现故障，也不会阻断正常业务。

### 并发安全

1. **Lua 脚本原子性**：所有关键操作使用 Lua 脚本
2. **Redis 单线程**：利用 Redis 单线程特性避免竞态条件
3. **租约扣减原子性**：使用 Lua 脚本保证租约扣减的原子性

### 数据一致性

1. **数据库为权威源**：所有限额以数据库配置为准
2. **Redis 仅作缓存**：Redis 数据丢失可从数据库恢复
3. **租约过期刷新**：租约过期后自动从数据库刷新

## Monitoring and Alerting

### 限额超限日志

所有限额超限事件都会记录警告日志：

```typescript
logger.warn(`[RateLimit] Key total limit exceeded: key=${key.id}, ${keyTotalCheck.reason}`);
logger.warn(`[RateLimit] User daily limit exceeded: user=${user.id}, ${userDailyCheck.reason}`);
logger.warn(`[RateLimit] Provider cost limit exceeded: provider=${provider.id}`);
```

### 租约调试日志

开发模式下可启用租约调试日志：

```typescript
logger.debug("[LeaseService] Lease refreshed from DB", {
  key: leaseKey,
  currentUsage,
  remainingBudget,
  ttl: ttlSeconds,
});
```

## References

### 核心服务文件

#### 1. Rate Limit Service (`src/lib/rate-limit/service.ts`)

这是配额管理的核心服务，实现了所有限额检查逻辑：

```typescript
export class RateLimitService {
  // 检查金额限制（Key、Provider 或 User）
  static async checkCostLimits(...)
  
  // 检查总消费限额（带 Redis 缓存优化）
  static async checkTotalCostLimit(...)
  
  // 检查并发 Session 限制
  static async checkSessionLimit(...)
  
  // 原子性检查并追踪供应商 Session
  static async checkAndTrackProviderSession(...)
  
  // 累加消费（请求结束后调用）
  static async trackCost(...)
  
  // 累加用户每日消费
  static async trackUserDailyCost(...)
  
  // 获取当前消费
  static async getCurrentCost(...)
  
  // 检查用户 RPM 限制
  static async checkUserRPM(...)
  
  // 使用租约机制检查消费限额
  static async checkCostLimitsWithLease(...)
  
  // 扣减租约预算
  static async decrementLeaseBudget(...)
}
```

**Redis Key 命名规范**：

```typescript
// 固定时间窗口（STRING 类型）
// Format: {type}:{id}:cost_daily_{suffix}
// Example: key:123:cost_daily_1800 (resets at 18:00)

// 滚动窗口（ZSET 类型）
// Format: {type}:{id}:cost_5h_rolling
// Format: {type}:{id}:cost_daily_rolling

// 租约 Key
// Format: lease:{entityType}:{entityId}:{window}
// Example: lease:key:123:daily
```

#### 2. Lease Service (`src/lib/rate-limit/lease-service.ts`)

实现基于租约的预算切片机制：

```typescript
export class LeaseService {
  // 获取成本租约
  static async getCostLease(params: GetCostLeaseParams): Promise<BudgetLease | null>
  
  // 从数据库刷新租约
  static async refreshCostLeaseFromDb(params: GetCostLeaseParams): Promise<BudgetLease | null>
  
  // 原子性扣减租约预算
  static async decrementLeaseBudget(params: DecrementLeaseBudgetParams): Promise<DecrementLeaseBudgetResult>
}
```

租约计算逻辑：

```typescript
// remainingBudget = min(limit * percent, remaining, capUsd)
export function calculateLeaseSlice(params: CalculateLeaseSliceParams): number {
  const { limitAmount, currentUsage, percent, capUsd } = params;
  const remaining = Math.max(0, limitAmount - currentUsage);
  
  const safePercent = Math.min(1, Math.max(0, percent));
  let slice = limitAmount * safePercent;
  slice = Math.min(slice, remaining);
  
  if (capUsd !== undefined) {
    slice = Math.min(slice, Math.max(0, capUsd));
  }
  
  return Math.max(0, Math.round(slice * 10000) / 10000);
}
```

#### 3. Time Utils (`src/lib/rate-limit/time-utils.ts`)

时间窗口计算工具：

```typescript
// 根据周期计算时间范围
export async function getTimeRangeForPeriod(period: TimePeriod, resetTime?: string): Promise<TimeRange>

// 支持滚动窗口模式的时间范围计算
export async function getTimeRangeForPeriodWithMode(
  period: TimePeriod,
  resetTime?: string,
  mode?: DailyResetMode
): Promise<TimeRange>

// 计算 Redis Key 的 TTL
export async function getTTLForPeriod(period: TimePeriod, resetTime?: string): Promise<number>

// 获取重置信息（用于前端展示）
export async function getResetInfo(period: TimePeriod, resetTime?: string): Promise<ResetInfo>
```

#### 4. Rate Limit Guard (`src/app/v1/_lib/proxy/rate-limit-guard.ts`)

代理层的限额检查守卫，实现了分层检查逻辑：

```typescript
export class ProxyRateLimitGuard {
  /**
   * 检查顺序（基于 Codex 专业分析）：
   * 1-2. 永久硬限制：Key 总限额 → User 总限额
   * 3-5. 资源/频率保护：Key 并发 → User 并发 → User RPM
   * 6-9. 短期周期限额：Key 5h → User 5h → Key 每日 → User 每日
   * 10-13. 中长期周期限额：Key 周 → User 周 → Key 月 → User 月
   */
  static async ensure(session: ProxySession): Promise<void> {
    // 13 层限额检查...
  }
}
```

#### 5. Quota Helpers (`src/lib/utils/quota-helpers.ts`)

限额状态判断工具函数：

```typescript
// 判断密钥是否设置了限额
export function hasKeyQuotaSet(quota: KeyQuota): boolean

// 计算使用率（百分比）
export function getUsageRate(current: number, limit: number | null): number

// 判断用户是否超限
export function isUserExceeded(userQuota: UserQuota): boolean

// 获取密钥限额的最高使用率
export function getMaxUsageRate(quota: KeyQuota): number

// 判断是否预警（使用率 ≥60%）
export function isWarning(keyQuota: KeyQuota, userQuota: UserQuota): boolean

// 判断是否超限（使用率 ≥100%）
export function isExceeded(keyQuota: KeyQuota, userQuota: UserQuota): boolean

// 获取状态标签
export function getQuotaStatus(keyQuota: KeyQuota, userQuota: UserQuota): "正常" | "预警" | "超限"

// 获取状态颜色
export function getQuotaColorClass(rate: number): "normal" | "warning" | "danger" | "exceeded"
```

#### 6. Lua Scripts (`src/lib/redis/lua-scripts.ts`)

Redis Lua 脚本集合，用于保证原子性操作：

```typescript
// 原子性检查并发限制 + 追踪 Session
export const CHECK_AND_TRACK_SESSION = `...`

// 批量检查多个供应商的并发限制
export const BATCH_CHECK_SESSION_LIMITS = `...`

// 追踪 5小时滚动窗口消费
export const TRACK_COST_5H_ROLLING_WINDOW = `...`

// 查询 5小时滚动窗口当前消费
export const GET_COST_5H_ROLLING_WINDOW = `...`

// 追踪 24小时滚动窗口消费
export const TRACK_COST_DAILY_ROLLING_WINDOW = `...`

// 查询 24小时滚动窗口当前消费
export const GET_COST_DAILY_ROLLING_WINDOW = `...`
```

### 数据追踪流程

消费追踪的完整数据流：

1. **请求处理完成后** (`src/app/v1/_lib/proxy/response-handler.ts`):

```typescript
// 追踪到 Redis
await RateLimitService.trackCost(
  key.id,
  provider.id,
  session.sessionId,
  costFloat,
  {
    keyResetTime: key.dailyResetTime,
    keyResetMode: key.dailyResetMode,
    providerResetTime: provider.dailyResetTime,
    providerResetMode: provider.dailyResetMode,
    requestId: messageContext.id,
    createdAtMs: messageContext.createdAt.getTime(),
  }
);

// 追踪用户层每日消费
await RateLimitService.trackUserDailyCost(
  user.id,
  costFloat,
  user.dailyResetTime,
  user.dailyResetMode,
  {
    requestId: messageContext.id,
    createdAtMs: messageContext.createdAt.getTime(),
  }
);

// 扣减租约预算（fire-and-forget）
const windows: LeaseWindowType[] = ["5h", "daily", "weekly", "monthly"];
void Promise.all([
  ...windows.map((w) => RateLimitService.decrementLeaseBudget(key.id, "key", w, costFloat)),
  ...windows.map((w) => RateLimitService.decrementLeaseBudget(user.id, "user", w, costFloat)),
  ...windows.map((w) =>
    RateLimitService.decrementLeaseBudget(provider.id, "provider", w, costFloat)
  ),
]).catch((error) => {
  logger.warn("[ResponseHandler] Failed to decrement lease budgets:", error);
});
```

### 前端配额展示

配额数据通过以下 Server Actions 提供给前端：

1. **Key Quota** (`src/actions/key-quota.ts`):

```typescript
export async function getKeyQuotaUsage(keyId: number): Promise<ActionResult<KeyQuotaUsageResult>> {
  // 查询各周期消费数据
  const [cost5h, costDaily, costWeekly, costMonthly, totalCost, concurrentSessions] =
    await Promise.all([
      sumKeyCostInTimeRange(keyId, range5h.startTime, range5h.endTime),
      sumKeyCostInTimeRange(keyId, keyDailyTimeRange.startTime, keyDailyTimeRange.endTime),
      sumKeyCostInTimeRange(keyId, rangeWeekly.startTime, rangeWeekly.endTime),
      sumKeyCostInTimeRange(keyId, rangeMonthly.startTime, rangeMonthly.endTime),
      getTotalUsageForKey(keyRow.key),
      SessionTracker.getKeySessionCount(keyId),
    ]);
}
```

2. **My Usage** (`src/actions/my-usage.ts`):

```typescript
export async function getMyQuota(): Promise<ActionResult<MyUsageQuota>> {
  // 同时查询 Key 和 User 各周期消费
  const [
    keyCost5h, keyCostDaily, keyCostWeekly, keyCostMonthly, keyTotalCost, keyConcurrent,
    userCost5h, userCostDaily, userCostWeekly, userCostMonthly, userTotalCost, userKeyConcurrent,
  ] = await Promise.all([
    // Key 配额查询...
    // User 配额查询...
  ]);
}
```

3. **Provider Quota** (`src/actions/providers.ts`):

```typescript
export async function getProviderQuota(providerId: number): Promise<ActionResult<ProviderQuotaData>> {
  // 获取金额消费（直接查询数据库，确保配额显示与 DB 一致）
  const [cost5h, costDaily, costWeekly, costMonthly, concurrentSessions] = await Promise.all([
    sumProviderCostInTimeRange(providerId, range5h.startTime, range5h.endTime),
    sumProviderCostInTimeRange(providerId, rangeDaily.startTime, rangeDaily.endTime),
    sumProviderCostInTimeRange(providerId, rangeWeekly.startTime, rangeWeekly.endTime),
    sumProviderCostInTimeRange(providerId, rangeMonthly.startTime, rangeMonthly.endTime),
    SessionTracker.getProviderSessionCount(providerId),
  ]);
}
```

### 统计查询 Repository

数据库统计查询实现 (`src/repository/statistics.ts`):

```typescript
// 查询 Key 在指定时间范围内的消费总和
export async function sumKeyCostInTimeRange(
  keyId: number,
  startTime: Date,
  endTime: Date
): Promise<number>

// 查询用户在指定时间范围内的消费总和
export async function sumUserCostInTimeRange(
  userId: number,
  startTime: Date,
  endTime: Date
): Promise<number>

// 查询供应商在指定时间范围内的消费总和
export async function sumProviderCostInTimeRange(
  providerId: number,
  startTime: Date,
  endTime: Date
): Promise<number>

// 查询 Key 历史总消费
export async function sumKeyTotalCost(keyHash: string, maxAgeDays?: number): Promise<number>

// 查询用户历史总消费
export async function sumUserTotalCost(userId: number, maxAgeDays?: number): Promise<number>

// 查询供应商历史总消费
export async function sumProviderTotalCost(
  providerId: number,
  resetAt?: Date | null
): Promise<number>

// 查询时间范围内的消费明细（用于滚动窗口重建）
export async function findKeyCostEntriesInTimeRange(...)
export async function findUserCostEntriesInTimeRange(...)
export async function findProviderCostEntriesInTimeRange(...)
```

---

## 架构总结

配额管理系统采用分层架构设计：

1. **数据层**：PostgreSQL 存储配置和持久化消费记录，Redis 存储实时计数和缓存
2. **服务层**：RateLimitService 提供核心限额检查，LeaseService 提供租约机制
3. **守卫层**：ProxyRateLimitGuard 实现请求拦截和分层检查
4. **展示层**：Server Actions 提供配额数据查询，React 组件渲染配额状态

系统通过 Redis + Lua 脚本保证高并发场景下的数据一致性，通过 Fail-Open 策略保证服务可用性，通过租约机制减少对数据库的频繁查询。

### 关键设计决策

1. **双模式窗口**：固定窗口（STRING）用于固定时间重置，滚动窗口（ZSET）用于精确时间窗口
2. **租约机制**：通过预算切片减少数据库查询，同时保证限额准确性
3. **Fail-Open**：任何故障都不应阻断正常业务
4. **时区感知**：所有时间计算都基于系统配置的时区
5. **分层检查**：硬限制优先，资源保护次之，周期限额最后

### 性能指标

- **限额检查延迟**：< 5ms（Redis 命中）
- **降级查询延迟**：< 50ms（数据库查询）
- **租约刷新频率**：每 10 秒（可配置）
- **总消费缓存**：5 分钟
- **并发检查**：原子性 Lua 脚本，无竞态条件
