# 配额管理 (Quota Management) - Round 1 Exploration Draft

## Intent Analysis

配额管理是 Claude Code Hub 中用于控制资源使用和消费成本的核心机制。该系统通过多层次、多维度的限额配置，确保系统资源被合理分配，防止单个用户或密钥过度消耗资源，同时为管理员提供精细化的成本控制能力。

配额管理的主要目标包括：

1. **成本控制**：通过设置消费上限，防止意外的高额 API 调用费用
2. **资源保护**：限制并发会话数和请求频率，保护上游供应商服务稳定性
3. **公平使用**：确保多用户环境下的资源公平分配
4. **分级管理**：支持用户级和密钥级双重限额，实现精细化权限控制
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
| 总消费限额 (Total) | ✓ | ✓ | ✓ | 永久累计消费上限 |
| 5小时消费 (5h) | ✓ | ✓ | ✓ | 滚动窗口消费限额 |
| 每日消费 (Daily) | ✓ | ✓ | ✓ | 日消费限额，支持固定/滚动模式 |
| 每周消费 (Weekly) | ✓ | ✓ | ✓ | 自然周消费限额 |
| 每月消费 (Monthly) | ✓ | ✓ | ✓ | 自然月消费限额 |
| 并发会话 (Concurrent) | ✓ | ✓ | ✓ | 同时进行的会话数上限 |
| 每分钟请求 (RPM) | ✓ | ✗ | ✗ | 用户级请求频率限制 |

## Config/Commands

### 数据库 Schema 配置

配额配置存储在数据库的三个核心表中：

#### 1. Users 表 (`/Users/ding/Github/claude-code-hub/src/drizzle/schema.ts`)

```typescript
export const users = pgTable('users', {
  // ... 基础字段 ...
  
  // 用户级限额字段
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
  
  // 传统字段
  rpmLimit: integer('rpm_limit'),
  dailyLimitUsd: numeric('daily_limit_usd', { precision: 10, scale: 2 }),
});
```

#### 2. Keys 表 (`/Users/ding/Github/claude-code-hub/src/drizzle/schema.ts`)

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
});
```

#### 3. Providers 表 (`/Users/ding/Github/claude-code-hub/src/drizzle/schema.ts`)

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
});
```

### 系统设置配置

配额租约（Lease）机制的配置存储在 System Settings 中：

```typescript
// /Users/ding/Github/claude-code-hub/src/drizzle/schema.ts
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
// /Users/ding/Github/claude-code-hub/src/lib/constants/provider.constants.ts
export const PROVIDER_LIMITS = {
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
// /Users/ding/Github/claude-code-hub/src/lib/rate-limit/service.ts
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

### 3. 并发竞态条件处理

供应商并发会话限制使用 Lua 脚本保证原子性：

```lua
-- /Users/ding/Github/claude-code-hub/src/lib/redis/lua-scripts.ts
-- CHECK_AND_TRACK_SESSION
-- 1. 清理过期 session（5 分钟前）
-- 2. 检查 session 是否已追踪
-- 3. 检查当前并发数是否超限
-- 4. 如果未超限，追踪新 session（原子操作）
```

### 4. 限额变更时的租约失效

当限额配置发生变化时，租约服务会检测到并强制刷新：

```typescript
// /Users/ding/Github/claude-code-hub/src/lib/rate-limit/lease-service.ts
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
- **Fixed 模式**：在指定时间重置（如每天 18:00）
- **Rolling 模式**：过去 24 小时的滚动窗口

```typescript
// /Users/ding/Github/claude-code-hub/src/lib/rate-limit/time-utils.ts
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

### 7. 时间边界和时区处理

配额管理系统使用时区感知的时间计算：

```typescript
// /Users/ding/Github/claude-code-hub/src/lib/rate-limit/time-utils.ts
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

系统使用 `date-fns-tz` 库处理时区转换，确保在全球不同地区的部署都能正确计算时间窗口。

### 8. 限额值为 null 或 0 的处理

当限额值为 null 或 0 时，系统视为无限制：

```typescript
// /Users/ding/Github/claude-code-hub/src/lib/rate-limit/service.ts
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

### 10. 租约过期后的行为

当租约过期后，系统会自动从数据库刷新：

```typescript
// /Users/ding/Github/claude-code-hub/src/lib/rate-limit/lease-service.ts
if (lease && !isLeaseExpired(lease)) {
  // 使用缓存的租约
  return lease;
}
// 租约过期或不存在，从数据库刷新
return await LeaseService.refreshCostLeaseFromDb(params);
```

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

// 请求完成后扣减
await LeaseService.decrementLeaseBudget({
  entityType, entityId, window, cost
});
```

### 批量查询优化

为避免 N+1 查询问题，系统实现了批量查询：

```typescript
// /Users/ding/Github/claude-code-hub/src/lib/rate-limit/service.ts
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
// /Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/rate-limit-guard.ts
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
// /Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/provider-selector.ts
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
  
  // ...
}
```

### 供应商选择时的限额过滤

```typescript
// /Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/provider-selector.ts
private async checkProviderAvailability(provider: Provider): Promise<boolean> {
  // 1. 检查金额限制
  const costCheck = await RateLimitService.checkCostLimitsWithLease(p.id, "provider", {
    limit_5h_usd: p.limit5hUsd,
    limit_daily_usd: p.limitDailyUsd,
    daily_reset_mode: p.dailyResetMode,
    daily_reset_time: p.dailyResetTime,
    limit_weekly_usd: p.limitWeeklyUsd,
    limit_monthly_usd: p.limitMonthlyUsd,
  });

  if (!costCheck.allowed) {
    logger.debug("ProviderSelector: Provider cost limit exceeded");
    return false;
  }

  // 2. 检查总消费上限
  const totalCheck = await RateLimitService.checkTotalCostLimit(
    p.id,
    "provider",
    p.limitTotalUsd,
    { resetAt: p.totalCostResetAt }
  );

  if (!totalCheck.allowed) {
    logger.debug("ProviderSelector: Provider total limit exceeded");
    return false;
  }

  // 3. 检查并发限制
  const sessionCheck = await RateLimitService.checkAndTrackProviderSession(
    provider.id,
    sessionId,
    provider.limitConcurrentSessions ?? 0
  );

  if (!sessionCheck.allowed) {
    logger.debug("ProviderSelector: Provider concurrent limit exceeded");
    return false;
  }

  return true;
}
```

## Frontend Integration

### 配额状态展示组件

```typescript
// /Users/ding/Github/claude-code-hub/src/components/quota/user-quota-header.tsx
export function UserQuotaHeader({
  userId,
  userName,
  rpmCurrent,
  rpmLimit,
  dailyCostCurrent,
  dailyCostLimit,
  // ...
}: UserQuotaHeaderProps) {
  // 计算使用率
  const rpmRate = getUsageRate(rpmCurrent, rpmLimit);
  const dailyRate = getUsageRate(dailyCostCurrent, dailyCostLimit);
  const maxRate = Math.max(rpmRate, dailyRate);

  // 获取状态颜色
  const colorClass = getQuotaColorClass(maxRate);
  
  // 根据状态显示不同背景色
  const bgColorClass = cn({
    "bg-card": colorClass === "normal",
    "bg-yellow-50 dark:bg-yellow-950/20": colorClass === "warning",
    "bg-orange-50 dark:bg-orange-950/20": colorClass === "danger",
    "bg-red-50 dark:bg-red-950/20": colorClass === "exceeded",
  });
}
```

### 供应商配额管理页面

```typescript
// /Users/ding/Github/claude-code-hub/src/app/[locale]/dashboard/quotas/providers/page.tsx
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
// /Users/ding/Github/claude-code-hub/src/app/[locale]/dashboard/quotas/users/page.tsx
async function getUsersWithQuotas() {
  const users = await getUsers();

  const usersWithQuotas = await Promise.all(
    users.map(async (user) => {
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
2. **租约缓存**：使用租约机制缓存限额状态
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

### 成本预警任务

```typescript
// /Users/ding/Github/claude-code-hub/src/lib/notification/tasks/cost-alert.ts
export async function checkUserQuotasForAlerts(): Promise<CostAlert[]> {
  const alerts: CostAlert[] = [];
  
  // 检查每个用户的限额使用情况
  for (const user of users) {
    // 检查每日限额
    if (user.dailyQuota) {
      const dailyCost = await sumUserCostInTimeRange(user.id, startTime, endTime);
      if (dailyCost >= user.dailyQuota * threshold) {
        alerts.push({
          targetType: "user",
          targetName: user.name,
          currentCost: dailyCost,
          quotaLimit: user.dailyQuota,
          threshold,
          period: "今日",
        });
      }
    }
    
    // 检查月限额...
  }
  
  return alerts;
}
```

### 限额超限日志

所有限额超限事件都会记录警告日志：

```typescript
logger.warn(`[RateLimit] Key total limit exceeded: key=${key.id}, ${keyTotalCheck.reason}`);
logger.warn(`[RateLimit] User daily limit exceeded: user=${user.id}, ${userDailyCheck.reason}`);
logger.warn(`[RateLimit] Provider cost limit exceeded: provider=${provider.id}`);
```

## References

### 核心服务文件

#### 1. Rate Limit Service (`/Users/ding/Github/claude-code-hub/src/lib/rate-limit/service.ts`)

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
  
  // 获取当前消费
  static async getCurrentCost(...)
  
  // 检查用户 RPM 限制
  static async checkUserRPM(...)
  
  // 检查用户每日消费额度限制
  static async checkUserDailyCost(...)
  
  // 使用租约机制检查消费限额
  static async checkCostLimitsWithLease(...)
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

#### 2. Lease Service (`/Users/ding/Github/claude-code-hub/src/lib/rate-limit/lease-service.ts`)

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

#### 3. Time Utils (`/Users/ding/Github/claude-code-hub/src/lib/rate-limit/time-utils.ts`)

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

#### 4. Rate Limit Guard (`/Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/rate-limit-guard.ts`)

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

#### 5. Quota Helpers (`/Users/ding/Github/claude-code-hub/src/lib/utils/quota-helpers.ts`)

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
```

#### 6. Lua Scripts (`/Users/ding/Github/claude-code-hub/src/lib/redis/lua-scripts.ts`)

Redis Lua 脚本集合，用于保证原子性操作：

```typescript
// 原子性检查并发限制 + 追踪 Session
export const CHECK_AND_TRACK_SESSION = `...`

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

1. **请求处理完成后** (`/Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/response-handler.ts`):

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
```

2. **租约扣减** (请求结束后):

```typescript
// 扣减各窗口的租约预算
await RateLimitService.decrementLeaseBudget(entityId, entityType, window, cost);
```

### 前端配额展示

配额数据通过以下 Server Actions 提供给前端：

1. **Key Quota** (`/Users/ding/Github/claude-code-hub/src/actions/key-quota.ts`):

```typescript
export async function getKeyQuota(keyId: number): Promise<ActionResult<KeyQuotaData>> {
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

2. **My Usage** (`/Users/ding/Github/claude-code-hub/src/actions/my-usage.ts`):

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

3. **User Quota** (`/Users/ding/Github/claude-code-hub/src/actions/users.ts`):

```typescript
export async function getUserQuota(userId: number): Promise<ActionResult<UserQuotaData>> {
  // 获取 RPM 使用情况
  const rpmCurrent = 0; // RPM 是动态滑动窗口，无法精确获取当前值
  
  // 获取每日消费
  const { startTime, endTime } = await getTimeRangeForPeriodWithMode(
    "daily",
    resetTime,
    resetMode
  );
  const dailyCost = await sumUserCostInTimeRange(userId, startTime, endTime);
}
```

### 统计查询 Repository

数据库统计查询实现 (`/Users/ding/Github/claude-code-hub/src/repository/statistics.ts`):

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
export async function sumKeyTotalCost(keyHash: string): Promise<number>

// 查询用户历史总消费
export async function sumUserTotalCost(userId: number, maxAgeDays?: number): Promise<number>

// 查询供应商历史总消费
export async function sumProviderTotalCost(
  providerId: number,
  resetAt: Date | null
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
