# Rate Limiting Implementation Analysis - Draft Report

## 1. Intent Analysis

The claude-code-hub project implements a sophisticated multi-dimensional rate limiting system designed to protect API resources, control costs, and ensure fair usage across multiple levels (User, Key, and Provider). The system addresses several critical business requirements:

- **Cost Control**: Prevent runaway spending through multi-layered budget limits (5h rolling, daily, weekly, monthly, and total lifetime limits)
- **Resource Protection**: Limit concurrent sessions to prevent overwhelming downstream AI providers
- **Frequency Control**: RPM (requests per minute) limiting to block high-frequency abuse
- **Fairness**: Ensure no single user or key monopolizes resources
- **Fail-Safe Operation**: Graceful degradation when Redis is unavailable (Fail-Open strategy)

The rate limiting system is deeply integrated into the proxy request pipeline, checking limits at multiple stages before allowing requests to reach AI providers.

---

## 2. Behavior Summary

### 2.1 Rate Limit Check Order

The system checks rate limits in a carefully designed sequence (`/Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/rate-limit-guard.ts`, lines 31-46):

```
Layer 1 - Permanent Hard Limits:
  1. Key Total Limit (lifetime spending cap)
  2. User Total Limit (account-level lifetime budget)

Layer 2 - Resource/Frequency Protection:
  3. Key Concurrent Sessions
  4. User Concurrent Sessions
  5. User RPM (Requests Per Minute)

Layer 3 - Short-term Cycle Limits:
  6. Key 5h Rolling Window
  7. User 5h Rolling Window
  8. Key Daily Limit
  9. User Daily Limit

Layer 4 - Medium/Long-term Cycle Limits:
  10. Key Weekly Limit
  11. User Weekly Limit
  12. Key Monthly Limit
  13. User Monthly Limit
```

Design principles:
- Hard caps are checked before cycle-based limits
- Within the same window, Key limits are checked before User limits
- Resource/frequency protections are positioned early enough to be effective
- High-probability triggers are checked earlier

### 2.2 Core Rate Limit Service

The `RateLimitService` class (`/Users/ding/Github/claude-code-hub/src/lib/rate-limit/service.ts`) provides the main rate limiting functionality:

**Key Methods:**
- `checkCostLimits()` - Checks spending limits across multiple time windows (lines 139-276)
- `checkTotalCostLimit()` - Checks lifetime spending caps with Redis caching (lines 282-370)
- `checkSessionLimit()` - Checks concurrent session limits (lines 508-539)
- `checkAndTrackProviderSession()` - Atomic check and track for provider sessions (lines 551-599)
- `checkUserRPM()` - RPM limiting using sliding window (lines 929-979)
- `trackCost()` - Records spending after request completion (lines 605-720)

### 2.3 Response Headers

The system returns rate limit information in response headers:
- `X-RateLimit-Limit`: The limit value
- `X-RateLimit-Remaining`: Remaining budget/quota
- `X-RateLimit-Reset`: Reset time (ISO 8601 format)

---

## 3. Configuration & Commands

### 3.1 Environment Variables

Located in `/Users/ding/Github/claude-code-hub/src/lib/redis/client.ts`:

```bash
# Required for rate limiting
ENABLE_RATE_LIMIT=true
REDIS_URL=redis://localhost:6379

# Optional TLS configuration
REDIS_TLS_REJECT_UNAUTHORIZED=false
```

### 3.2 User-Level Limits (Database Schema)

From `/Users/ding/Github/claude-code-hub/src/drizzle/schema.ts` (lines 37-77):

```typescript
// Users table rate limit fields
rpmLimit: integer('rpm_limit'),                          // Requests per minute
dailyLimitUsd: numeric('daily_limit_usd'),              // Daily spending cap
limit5hUsd: numeric('limit_5h_usd'),                    // 5-hour rolling window
limitWeeklyUsd: numeric('limit_weekly_usd'),            // Weekly spending cap
limitMonthlyUsd: numeric('limit_monthly_usd'),          // Monthly spending cap
limitTotalUsd: numeric('limit_total_usd'),              // Lifetime spending cap
limitConcurrentSessions: integer('limit_concurrent_sessions'), // Max concurrent sessions

// Daily reset configuration
dailyResetMode: dailyResetModeEnum('daily_reset_mode').default('fixed'), // 'fixed' or 'rolling'
dailyResetTime: varchar('daily_reset_time').default('00:00'),           // HH:mm format
```

### 3.3 Provider-Level Limits

From `/Users/ding/Github/claude-code-hub/src/lib/constants/provider.constants.ts` (lines 4-17):

```typescript
export const PROVIDER_LIMITS = {
  LIMIT_5H_USD: { MIN: 0.1, MAX: 1000, STEP: 1 },      // 5-hour limit: $0.1 - $1000
  LIMIT_WEEKLY_USD: { MIN: 1, MAX: 5000, STEP: 1 },    // Weekly limit: $1 - $5000
  LIMIT_MONTHLY_USD: { MIN: 10, MAX: 30000, STEP: 1 }, // Monthly limit: $10 - $30000
  CONCURRENT_SESSIONS: { MIN: 1, MAX: 150 },           // Concurrent sessions: 1-150
};
```

### 3.4 System Settings for Lease-Based Limits

From `/Users/ding/Github/claude-code-hub/src/lib/rate-limit/lease-service.ts` (lines 152-162):

```typescript
// Lease configuration (from system settings)
const ttlSeconds = settings.quotaDbRefreshIntervalSeconds ?? 10;  // How often to refresh from DB
const capUsd = settings.quotaLeaseCapUsd ?? undefined;            // Max lease slice in USD

// Lease percentages for each window
quotaLeasePercent5h: 0.05,      // 5% of 5h limit per lease
quotaLeasePercentDaily: 0.05,   // 5% of daily limit per lease
quotaLeasePercentWeekly: 0.05,  // 5% of weekly limit per lease
quotaLeasePercentMonthly: 0.05, // 5% of monthly limit per lease
```

---

## 4. Redis Lua Scripts for Atomic Operations

All Lua scripts are defined in `/Users/ding/Github/claude-code-hub/src/lib/redis/lua-scripts.ts`.

### 4.1 CHECK_AND_TRACK_SESSION

**Purpose**: Atomically check provider concurrent session limit and track new sessions.

**Parameters:**
- `KEYS[1]`: `provider:${providerId}:active_sessions`
- `ARGV[1]`: sessionId
- `ARGV[2]`: limit (concurrent session limit)
- `ARGV[3]`: now (current timestamp in ms)

**Returns:**
- `{1, count, 1}` - Allowed (new tracking), returns new count and tracked=1
- `{1, count, 0}` - Allowed (already tracked), returns current count and tracked=0
- `{0, count, 0}` - Rejected (limit exceeded), returns current count and tracked=0

**Implementation** (lines 26-60):
```lua
local provider_key = KEYS[1]
local session_id = ARGV[1]
local limit = tonumber(ARGV[2])
local now = tonumber(ARGV[3])
local ttl = 300000  -- 5 minutes (ms)

-- 1. Clean expired sessions (5 minutes ago)
local five_minutes_ago = now - ttl
redis.call('ZREMRANGEBYSCORE', provider_key, '-inf', five_minutes_ago)

-- 2. Check if session is already tracked
local is_tracked = redis.call('ZSCORE', provider_key, session_id)

-- 3. Get current concurrent count
local current_count = redis.call('ZCARD', provider_key)

-- 4. Check limit (excluding already tracked sessions)
if limit > 0 and not is_tracked and current_count >= limit then
  return {0, current_count, 0}
end

-- 5. Track session (ZADD updates timestamp for existing members)
redis.call('ZADD', provider_key, now, session_id)
redis.call('EXPIRE', provider_key, 3600)  -- 1 hour fallback TTL

-- 6. Return success
if is_tracked then
  return {1, current_count, 0}
else
  return {1, current_count + 1, 1}
end
```

### 4.2 TRACK_COST_5H_ROLLING_WINDOW

**Purpose**: Track spending in a 5-hour rolling window using Redis ZSET.

**Parameters:**
- `KEYS[1]`: `key:${id}:cost_5h_rolling` or `provider:${id}:cost_5h_rolling`
- `ARGV[1]`: cost (amount spent)
- `ARGV[2]`: now (current timestamp in ms)
- `ARGV[3]`: window (window duration in ms, default 18000000 = 5 hours)
- `ARGV[4]`: request_id (optional, for deduplication)

**Returns:** String representing total spending in current window.

**Implementation** (lines 121-155):
```lua
local key = KEYS[1]
local cost = tonumber(ARGV[1])
local now_ms = tonumber(ARGV[2])
local window_ms = tonumber(ARGV[3])  -- 5 hours = 18000000 ms
local request_id = ARGV[4]

-- 1. Clean expired records (data older than 5 hours)
redis.call('ZREMRANGEBYSCORE', key, '-inf', now_ms - window_ms)

-- 2. Add current spending record
local member
if request_id and request_id ~= '' then
  member = now_ms .. ':' .. request_id .. ':' .. cost
else
  member = now_ms .. ':' .. cost
end
redis.call('ZADD', key, now_ms, member)

-- 3. Calculate total spending in window
local records = redis.call('ZRANGE', key, 0, -1)
local total = 0
for _, record in ipairs(records) do
  local cost_str = string.match(record, '.*:(.+)')
  if cost_str then
    total = total + tonumber(cost_str)
  end
end

-- 4. Set fallback TTL (6 hours to prevent data accumulation)
redis.call('EXPIRE', key, 21600)

return tostring(total)
```

### 4.3 TRACK_COST_DAILY_ROLLING_WINDOW

**Purpose**: Track spending in a 24-hour rolling window (for daily rolling mode).

**Parameters:**
- `KEYS[1]`: `key:${id}:cost_daily_rolling` or `provider:${id}:cost_daily_rolling`
- `ARGV[1]`: cost
- `ARGV[2]`: now (ms)
- `ARGV[3]`: window (ms, default 86400000 = 24 hours)
- `ARGV[4]`: request_id (optional)

**Returns:** String representing total spending in current window.

**Implementation** (lines 208-242):
```lua
local key = KEYS[1]
local cost = tonumber(ARGV[1])
local now_ms = tonumber(ARGV[2])
local window_ms = tonumber(ARGV[3])  -- 24 hours = 86400000 ms
local request_id = ARGV[4]

-- 1. Clean expired records (data older than 24 hours)
redis.call('ZREMRANGEBYSCORE', key, '-inf', now_ms - window_ms)

-- 2. Add current spending record
local member
if request_id and request_id ~= '' then
  member = now_ms .. ':' .. request_id .. ':' .. cost
else
  member = now_ms .. ':' .. cost
end
redis.call('ZADD', key, now_ms, member)

-- 3. Calculate total spending in window
local records = redis.call('ZRANGE', key, 0, -1)
local total = 0
for _, record in ipairs(records) do
  local cost_str = string.match(record, '.*:(.+)')
  if cost_str then
    total = total + tonumber(cost_str)
  end
end

-- 4. Set fallback TTL (25 hours)
redis.call('EXPIRE', key, 90000)

return tostring(total)
```

### 4.4 GET_COST_5H_ROLLING_WINDOW / GET_COST_DAILY_ROLLING_WINDOW

**Purpose**: Query current spending in rolling windows without adding new records.

**Implementation** (lines 170-189, 257-276):
```lua
local key = KEYS[1]
local now_ms = tonumber(ARGV[1])
local window_ms = tonumber(ARGV[2])

-- 1. Clean expired records
redis.call('ZREMRANGEBYSCORE', key, '-inf', now_ms - window_ms)

-- 2. Calculate total spending
local records = redis.call('ZRANGE', key, 0, -1)
local total = 0
for _, record in ipairs(records) do
  local cost_str = string.match(record, '.*:(.+)')
  if cost_str then
    total = total + tonumber(cost_str)
  end
end

return tostring(total)
```

### 4.5 Lease Decrement Lua Script

**Purpose**: Atomically decrement budget from a lease slice.

**Location**: `/Users/ding/Github/claude-code-hub/src/lib/rate-limit/lease-service.ts` (lines 283-313)

```lua
local key = KEYS[1]
local cost = tonumber(ARGV[1])

-- Get current lease JSON
local leaseJson = redis.call('GET', key)
if not leaseJson then
  return {-1, 0}  -- Key not found
end

-- Parse lease JSON
local lease = cjson.decode(leaseJson)
local remaining = tonumber(lease.remainingBudget) or 0

-- Check if budget is sufficient
if remaining < cost then
  return {0, 0}  -- Insufficient budget
end

-- Decrement budget
local newRemaining = remaining - cost
lease.remainingBudget = newRemaining

-- Get TTL and update lease
local ttl = redis.call('TTL', key)
if ttl > 0 then
  redis.call('SETEX', key, ttl, cjson.encode(lease))
end

return {newRemaining, 1}  -- Success
```

---

## 5. RPM (Requests Per Minute) Limiting

### 5.1 Implementation

RPM limiting is implemented in `/Users/ding/Github/claude-code-hub/src/lib/rate-limit/service.ts` (lines 929-979):

```typescript
static async checkUserRPM(
  userId: number,
  rpmLimit: number
): Promise<{ allowed: boolean; reason?: string; current?: number }> {
  if (!rpmLimit || rpmLimit <= 0) {
    return { allowed: true }; // No limit set
  }

  if (!RateLimitService.redis) {
    logger.warn("[RateLimit] Redis unavailable, skipping user RPM check");
    return { allowed: true }; // Fail Open
  }

  const key = `user:${userId}:rpm_window`;
  const now = Date.now();
  const oneMinuteAgo = now - 60000;

  try {
    // Use Pipeline for better performance
    const pipeline = RateLimitService.redis.pipeline();

    // 1. Clean requests older than 1 minute
    pipeline.zremrangebyscore(key, "-inf", oneMinuteAgo);

    // 2. Count current requests
    pipeline.zcard(key);

    const results = await pipeline.exec();
    const count = (results?.[1]?.[1] as number) || 0;

    if (count >= rpmLimit) {
      return {
        allowed: false,
        reason: `User RPM limit reached (${count}/${rpmLimit})`,
        current: count,
      };
    }

    // 3. Record this request
    await RateLimitService.redis
      .pipeline()
      .zadd(key, now, `${now}:${Math.random()}`)
      .expire(key, 120) // 2 minute TTL
      .exec();

    return { allowed: true, current: count + 1 };
  } catch (error) {
    logger.error(`[RateLimit] User RPM check failed for user ${userId}:`, error);
    return { allowed: true }; // Fail Open
  }
}
```

### 5.2 Key Characteristics

- **Sliding Window**: Uses Redis ZSET with timestamp scores for precise sliding window
- **Random Member**: Uses `${now}:${Math.random()}` as member to handle concurrent requests in same millisecond
- **TTL**: 2-minute TTL ensures cleanup even if requests stop
- **Fail-Open**: If Redis fails, allows the request through

---

## 6. Cost-Based Limiting (5h/Week/Month)

### 6.1 Time Window Types

The system supports multiple time window configurations (`/Users/ding/Github/claude-code-hub/src/lib/rate-limit/time-utils.ts`):

| Period | Type | Description |
|--------|------|-------------|
| 5h | Rolling | Past 5 hours from current time |
| Daily | Fixed | From custom reset time (e.g., 18:00) to next reset |
| Daily | Rolling | Past 24 hours from current time |
| Weekly | Natural | From Monday 00:00 (system timezone) to next Monday |
| Monthly | Natural | From 1st of month 00:00 to next month 1st |

### 6.2 Daily Reset Modes

From `/Users/ding/Github/claude-code-hub/src/lib/rate-limit/time-utils.ts` (lines 91-107):

```typescript
export async function getTimeRangeForPeriodWithMode(
  period: TimePeriod,
  resetTime = "00:00",
  mode: DailyResetMode = "fixed"
): Promise<TimeRange> {
  if (period === "daily" && mode === "rolling") {
    // Rolling window: past 24 hours
    const now = new Date();
    return {
      startTime: new Date(now.getTime() - 24 * 60 * 60 * 1000),
      endTime: now,
    };
  }

  // Other cases use original logic
  return getTimeRangeForPeriod(period, resetTime);
}
```

### 6.3 Cost Tracking Flow

After request completion, costs are tracked (`/Users/ding/Github/claude-code-hub/src/lib/rate-limit/service.ts`, lines 605-720):

1. **5h Rolling Window**: Uses ZSET + Lua script (`TRACK_COST_5H_ROLLING_WINDOW`)
2. **Daily Rolling Window**: Uses ZSET + Lua script (`TRACK_COST_DAILY_ROLLING_WINDOW`)
3. **Fixed Windows** (daily fixed/weekly/monthly): Uses simple INCR on STRING keys

### 6.4 Lease-Based Cost Limiting

For improved performance, the system uses a lease-based mechanism (`/Users/ding/Github/claude-code-hub/src/lib/rate-limit/lease-service.ts`):

**Concept**: Instead of querying the database for every request, the system:
1. Takes a "lease" (budget slice) from the database periodically
2. Stores the lease in Redis with a TTL
3. Decrements from the lease for each request
4. Refreshes the lease when it expires or is exhausted

**Lease Calculation** (from `/Users/ding/Github/claude-code-hub/src/lib/rate-limit/lease.ts`, lines 101-123):
```typescript
export function calculateLeaseSlice(params: CalculateLeaseSliceParams): number {
  const { limitAmount, currentUsage, percent, capUsd } = params;

  const remaining = Math.max(0, limitAmount - currentUsage);
  if (remaining === 0) {
    return 0;
  }

  // Clamp percent to valid range [0, 1]
  const safePercent = Math.min(1, Math.max(0, percent));
  let slice = limitAmount * safePercent;

  // Cap by remaining budget
  slice = Math.min(slice, remaining);

  // Cap by USD limit if provided
  if (capUsd !== undefined) {
    slice = Math.min(slice, Math.max(0, capUsd));
  }

  // Round to 4 decimal places
  return Math.max(0, Math.round(slice * 10000) / 10000);
}
```

---

## 7. Concurrent Session Limiting

### 7.1 Session Tracking Architecture

The `SessionTracker` class (`/Users/ding/Github/claude-code-hub/src/lib/session-tracker.ts`) manages active sessions using Redis ZSET:

**Data Structures:**
- `global:active_sessions` (ZSET): All active sessions
- `key:${keyId}:active_sessions` (ZSET): Sessions per API key
- `provider:${providerId}:active_sessions` (ZSET): Sessions per provider
- `user:${userId}:active_sessions` (ZSET): Sessions per user

**ZSET Score**: Timestamp of last activity (milliseconds)
**TTL**: 5 minutes of inactivity before session is considered expired

### 7.2 Session Lifecycle

1. **Track Session** (`trackSession`, line 66-108): Called when session is created
2. **Update Provider** (`updateProvider`, line 118-153): Called when provider is selected
3. **Refresh Session** (`refreshSession`, line 165-218): Called on each request to update timestamp
4. **Count Sessions** (`countFromZSet`, line 511-552): Counts valid sessions with expiration cleanup

### 7.3 Provider Concurrent Session Check

For providers, the system uses an atomic Lua script (`/Users/ding/Github/claude-code-hub/src/lib/rate-limit/service.ts`, lines 551-599):

```typescript
static async checkAndTrackProviderSession(
  providerId: number,
  sessionId: string,
  limit: number
): Promise<{ allowed: boolean; count: number; tracked: boolean; reason?: string }> {
  if (limit <= 0) {
    return { allowed: true, count: 0, tracked: false };
  }

  if (!RateLimitService.redis) {
    logger.warn("[RateLimit] Redis unavailable, skipping provider session check");
    return { allowed: true, count: 0, tracked: false }; // Fail Open
  }

  try {
    const key = `provider:${providerId}:active_sessions`;
    const now = Date.now();

    // Execute Lua script: atomic check + track
    const result = (await RateLimitService.redis.eval(
      CHECK_AND_TRACK_SESSION,
      1, // KEYS count
      key, // KEYS[1]
      sessionId, // ARGV[1]
      limit.toString(), // ARGV[2]
      now.toString() // ARGV[3]
    )) as [number, number, number];

    const [allowed, count, tracked] = result;

    if (allowed === 0) {
      return {
        allowed: false,
        count,
        tracked: false,
        reason: `Provider concurrent session limit reached (${count}/${limit})`,
      };
    }

    return {
      allowed: true,
      count,
      tracked: tracked === 1,
    };
  } catch (error) {
    logger.error("[RateLimit] Atomic check-and-track failed:", error);
    return { allowed: true, count: 0, tracked: false }; // Fail Open
  }
}
```

### 7.4 Key/User Concurrent Session Check

For Key and User levels, the system uses `checkSessionLimit` (`/Users/ding/Github/claude-code-hub/src/lib/rate-limit/service.ts`, lines 508-539):

```typescript
static async checkSessionLimit(
  id: number,
  type: "key" | "provider" | "user",
  limit: number
): Promise<{ allowed: boolean; reason?: string }> {
  if (limit <= 0) {
    return { allowed: true };
  }

  try {
    // Use SessionTracker's unified counting logic
    const count =
      type === "key"
        ? await SessionTracker.getKeySessionCount(id)
        : type === "provider"
          ? await SessionTracker.getProviderSessionCount(id)
          : await SessionTracker.getUserSessionCount(id);

    if (count >= limit) {
      const typeLabel = type === "key" ? "Key" : type === "provider" ? "Provider" : "User";
      return {
        allowed: false,
        reason: `${typeLabel} concurrent session limit reached (${count}/${limit})`,
      };
    }

    return { allowed: true };
  } catch (error) {
    logger.error("[RateLimit] Session check failed:", error);
    return { allowed: true }; // Fail Open
  }
}
```

---

## 8. Fail-Open Behavior When Redis Unavailable

### 8.1 Philosophy

The system adopts a **Fail-Open** strategy: when Redis is unavailable, requests are allowed through rather than being blocked. This prioritizes availability over strict rate limiting.

### 8.2 Implementation Examples

**RateLimitService.checkUserRPM** (`/Users/ding/Github/claude-code-hub/src/lib/rate-limit/service.ts`, lines 937-940, 976-978):
```typescript
if (!RateLimitService.redis) {
  logger.warn("[RateLimit] Redis unavailable, skipping user RPM check");
  return { allowed: true }; // Fail Open
}

// ... try-catch block ...

catch (error) {
  logger.error(`[RateLimit] User RPM check failed for user ${userId}:`, error);
  return { allowed: true }; // Fail Open
}
```

**RateLimitService.checkSessionLimit** (lines 535-538):
```typescript
catch (error) {
  logger.error("[RateLimit] Session check failed:", error);
  return { allowed: true }; // Fail Open
}
```

**LeaseService.decrementLeaseBudget** (`/Users/ding/Github/claude-code-hub/src/lib/rate-limit/lease-service.ts`, lines 334-343, 373-382):
```typescript
// Fail-open if Redis is not ready
if (!redis || redis.status !== "ready") {
  logger.warn("[LeaseService] Redis not ready, fail-open for decrement", {
    entityType, entityId, window, cost,
  });
  return { success: true, newRemaining: -1, failOpen: true };
}

// ... try-catch block ...

catch (error) {
  // Fail-open on any error
  logger.error("[LeaseService] decrementLeaseBudget failed, fail-open", {
    entityType, entityId, window, cost, error,
  });
  return { success: true, newRemaining: -1, failOpen: true };
}
```

### 8.3 Database Fallback for Cost Limits

When Redis is unavailable for cost limit checks, the system falls back to database queries (`/Users/ding/Github/claude-code-hub/src/lib/rate-limit/service.ts`, lines 269-276):

```typescript
// Slow Path: Redis unavailable, fallback to database
logger.warn(`[RateLimit] Redis unavailable, checking ${type} cost limits from database`);
return await RateLimitService.checkCostLimitsFromDatabase(id, type, costLimits);

// ... error handling ...

catch (error) {
  logger.error("[RateLimit] Check failed, fallback to database:", error);
  return await RateLimitService.checkCostLimitsFromDatabase(id, type, costLimits);
}
```

### 8.4 Redis Client Configuration

The Redis client is configured for fast failure (`/Users/ding/Github/claude-code-hub/src/lib/redis/client.ts`, lines 55-67):

```typescript
const baseOptions = {
  enableOfflineQueue: false, // Fast fail
  maxRetriesPerRequest: 3,
  retryStrategy(times: number) {
    if (times > 5) {
      logger.error("[Redis] Max retries reached, giving up");
      return null; // Stop retrying, allow fallback
    }
    const delay = Math.min(times * 200, 2000);
    logger.warn(`[Redis] Retry ${times}/5 after ${delay}ms`);
    return delay;
  },
};
```

---

## 9. Edge Cases

### 9.1 Cache Miss Recovery

When Redis returns 0 for a cost window but the key doesn't exist (cache miss), the system queries the database and optionally warms the cache (`/Users/ding/Github/claude-code-hub/src/lib/rate-limit/service.ts`, lines 191-200):

```typescript
// Cache Miss detection: if returns 0 but key doesn't exist in Redis, recover from DB
if (current === 0) {
  const exists = await RateLimitService.redis.exists(key);
  if (!exists) {
    logger.info(`[RateLimit] Cache miss for ${type}:${id}:cost_5h, querying database`);
    return await RateLimitService.checkCostLimitsFromDatabase(id, type, costLimits);
  }
}
```

### 9.2 Session Type Conflict Handling

When Redis data type conflicts occur (e.g., legacy Set vs new ZSET), the system auto-fixes (`/Users/ding/Github/claude-code-hub/src/lib/session-tracker.ts`, lines 88-102):

```typescript
const results = await pipeline.exec();

// Check execution results, catch type conflict errors
if (results) {
  for (const [err] of results) {
    if (err) {
      logger.error("SessionTracker: Pipeline command failed", { error: err });
      // If type conflict (WRONGTYPE), auto-fix
      if (err.message?.includes("WRONGTYPE")) {
        logger.warn("SessionTracker: Type conflict detected, auto-fixing");
        await SessionTracker.initialize(); // Re-initialize, clean old data
        return; // This tracking fails, next request will succeed
      }
    }
  }
}
```

### 9.3 Concurrent Request Handling

The Lua scripts ensure atomicity for concurrent requests:
- `CHECK_AND_TRACK_SESSION` handles race conditions for provider session limits
- `DECREMENT_LUA_SCRIPT` ensures atomic budget decrement for leases

### 9.4 Timezone Handling

All time windows respect the system-configured timezone (`/Users/ding/Github/claude-code-hub/src/lib/rate-limit/time-utils.ts`):

```typescript
const timezone = await resolveSystemTimezone();
const zonedNow = toZonedTime(now, timezone);
const zonedStartOfWeek = startOfWeek(zonedNow, { weekStartsOn: 1 }); // Monday
const startTime = fromZonedTime(zonedStartOfWeek, timezone);
```

---

## 10. References

### Source Files

| File | Description |
|------|-------------|
| `/Users/ding/Github/claude-code-hub/src/lib/rate-limit/service.ts` | Main RateLimitService implementation |
| `/Users/ding/Github/claude-code-hub/src/lib/rate-limit/lease-service.ts` | Lease-based budget management |
| `/Users/ding/Github/claude-code-hub/src/lib/rate-limit/lease.ts` | Lease data structures and calculations |
| `/Users/ding/Github/claude-code-hub/src/lib/rate-limit/time-utils.ts` | Time window calculations |
| `/Users/ding/Github/claude-code-hub/src/lib/redis/lua-scripts.ts` | Redis Lua scripts for atomic operations |
| `/Users/ding/Github/claude-code-hub/src/lib/session-tracker.ts` | Session tracking and concurrent limit management |
| `/Users/ding/Github/claude-code-hub/src/lib/redis/client.ts` | Redis client configuration |
| `/Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/rate-limit-guard.ts` | Rate limit guard for proxy requests |
| `/Users/ding/Github/claude-code-hub/src/drizzle/schema.ts` | Database schema with limit fields |
| `/Users/ding/Github/claude-code-hub/src/lib/constants/provider.constants.ts` | Provider limit constants |

### Key Classes and Functions

- `RateLimitService.checkCostLimits()` - Multi-window cost limit checking
- `RateLimitService.checkUserRPM()` - RPM limiting
- `RateLimitService.checkSessionLimit()` - Concurrent session checking
- `RateLimitService.checkAndTrackProviderSession()` - Atomic provider session tracking
- `RateLimitService.trackCost()` - Post-request cost tracking
- `LeaseService.getCostLease()` - Lease retrieval
- `LeaseService.decrementLeaseBudget()` - Atomic lease budget decrement
- `SessionTracker` - Session lifecycle management

---

*Report generated from analysis of claude-code-hub codebase*
