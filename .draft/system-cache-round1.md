# Cache Management (缓存管理) - Round 1 Exploration Draft

## Intent Analysis

The claude-code-hub (CCH) implements a sophisticated multi-layer caching strategy designed to optimize performance while maintaining data consistency across distributed instances. The cache management system serves several critical purposes:

1. **Performance Optimization**: Reduce database query load by caching frequently accessed data like provider configurations, system settings, and session information
2. **Cross-Instance Synchronization**: Ensure cache consistency when running multiple server instances via Redis Pub/Sub invalidation
3. **Rate Limiting**: Track usage across time windows (5h, daily, weekly, monthly) using Redis data structures
4. **Circuit Breaker State**: Persist and share circuit breaker states across instances for fault tolerance
5. **Session Management**: Track active sessions and concurrent usage with automatic expiration

The system follows a "fail-open" philosophy - when cache infrastructure (Redis) is unavailable, the system degrades gracefully rather than failing hard, ensuring service continuity.

---

## Behavior Summary

### Cache Architecture Overview

CCH employs a three-tier caching architecture:

```
┌─────────────────────────────────────────────────────────────────┐
│                    CACHE ARCHITECTURE                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐ │
│  │  In-Memory      │  │  Redis          │  │  Database       │ │
│  │  (Process-local)│  │  (Shared)       │  │  (Source)       │ │
│  │                 │  │                 │  │                 │ │
│  │ • Provider List │  │ • Sessions      │  │ • Providers     │ │
│  │ • System Settings│  │ • Rate Limits   │  │ • Users/Keys    │ │
│  │ • Session Cache │  │ • Circuit State │  │ • Configs       │ │
│  │ • Filter Rules  │  │ • Leaderboards  │  │ • Logs          │ │
│  │ • Error Rules   │  │ • Version Info  │  │                 │ │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘ │
│           │                    │                    │          │
│           └────────────────────┴────────────────────┘          │
│                         │                                      │
│              ┌──────────┴──────────┐                          │
│              │  Pub/Sub Invalidation │                          │
│              │  (Cross-Instance Sync)│                          │
│              └───────────────────────┘                          │
└─────────────────────────────────────────────────────────────────┘
```

### Cache Storage Mechanisms

#### 1. In-Memory Caches (Process-Level)

**Provider Cache** (`/Users/ding/Github/claude-code-hub/src/lib/cache/provider-cache.ts`)
- **Purpose**: Cache provider list to avoid DB queries on every proxy request
- **TTL**: 30 seconds
- **Features**:
  - Redis Pub/Sub invalidation for cross-instance sync
  - Version number to prevent race conditions during concurrent refreshes
  - Request-level snapshot support for data consistency during failover
  - Degradation strategy: relies on TTL when Redis unavailable

```typescript
// File: /Users/ding/Github/claude-code-hub/src/lib/cache/provider-cache.ts
const CACHE_TTL_MS = 30_000; // 30 seconds

interface ProviderCacheState {
  data: Provider[] | null;
  expiresAt: number;
  version: number; // Prevents concurrent refresh race conditions
  refreshPromise: Promise<Provider[]> | null;
}
```

**Session Cache** (`/Users/ding/Github/claude-code-hub/src/lib/cache/session-cache.ts`)
- **Purpose**: Reduce database queries for active session lists and details
- **TTL**: 
  - Active Sessions: 2 seconds
  - Session Details: 1 second (shorter due to more frequent changes)
- **Implementation**: Generic `SessionCache<T>` class using Map with timestamp-based expiration

```typescript
// File: /Users/ding/Github/claude-code-hub/src/lib/cache/session-cache.ts
class SessionCache<T> {
  private cache = new Map<string, CacheEntry<T>>();
  private ttl: number; // TTL in milliseconds

  constructor(ttlSeconds: number = 2) {
    this.ttl = ttlSeconds * 1000;
  }

  get(key: string): T | null {
    const entry = this.cache.get(key);
    if (!entry) return null;
    
    const age = Date.now() - entry.timestamp;
    if (age > this.ttl) {
      this.cache.delete(key);
      return null;
    }
    return entry.data;
  }
}
```

**System Settings Cache** (`/Users/ding/Github/claude-code-hub/src/lib/config/system-settings-cache.ts`)
- **Purpose**: Cache system settings to avoid DB queries on every proxy request
- **TTL**: 1 minute (60,000 ms)
- **Features**:
  - No Redis dependency for read path
  - Lazy loading on first access
  - Manual invalidation when settings saved
  - Fail-open: returns default settings on error

```typescript
// File: /Users/ding/Github/claude-code-hub/src/lib/config/system-settings-cache.ts
const CACHE_TTL_MS = 60 * 1000; // 1 minute

export async function getCachedSystemSettings(): Promise<SystemSettings> {
  const now = Date.now();
  
  // Return cached if still valid
  if (cachedSettings && now - cachedAt < CACHE_TTL_MS) {
    return cachedSettings;
  }
  
  try {
    const settings = await getSystemSettings();
    cachedSettings = settings;
    cachedAt = now;
    return settings;
  } catch (error) {
    // Fail-open: return previous cached value or defaults
    if (cachedSettings) return cachedSettings;
    return DEFAULT_SETTINGS;
  }
}
```

**Sensitive Word Cache** (`/Users/ding/Github/claude-code-hub/src/lib/sensitive-word-detector.ts`)
- **Purpose**: Cache sensitive word patterns for content filtering
- **Structure**: Grouped by match type (contains, exact, regex)
- **Features**: EventEmitter-driven auto-reload, ReDoS protection

**Error Rule Cache** (`/Users/ding/Github/claude-code-hub/src/lib/error-rule-detector.ts`)
- **Purpose**: Cache error detection rules for response classification
- **Structure**: Regex, contains, and exact patterns
- **Features**: Cross-process notification via Redis Pub/Sub

**Request Filter Cache** (`/Users/ding/Github/claude-code-hub/src/lib/request-filter-engine.ts`)
- **Purpose**: Cache request filtering rules
- **Features**: Memory leak cleanup, lazy initialization

#### 2. Redis Caches (Shared Across Instances)

**Redis Client Configuration** (`/Users/ding/Github/claude-code-hub/src/lib/redis/client.ts`)

```typescript
// File: /Users/ding/Github/claude-code-hub/src/lib/redis/client.ts
export function getRedisClient(): Redis | null {
  // Skip during CI/build phase
  if (process.env.CI === "true" || process.env.NEXT_PHASE === "phase-production-build") {
    return null;
  }

  const redisUrl = process.env.REDIS_URL;
  const isEnabled = process.env.ENABLE_RATE_LIMIT === "true";

  if (!isEnabled || !redisUrl) {
    logger.warn("[Redis] Rate limiting disabled or REDIS_URL not configured");
    return null;
  }
  
  // Connection options
  const redisOptions: RedisOptions = {
    enableOfflineQueue: false, // Fast fail
    maxRetriesPerRequest: 3,
    retryStrategy(times) {
      if (times > 5) {
        logger.error("[Redis] Max retries reached, giving up");
        return null; // Stop retrying, trigger fallback
      }
      const delay = Math.min(times * 200, 2000);
      return delay;
    },
  };
}
```

**Session Data Storage** (`/Users/ding/Github/claude-code-hub/src/lib/session-manager.ts`)
- **Session TTL**: 5 minutes (300 seconds, configurable via `SESSION_TTL`)
- **Storage Keys**:
  - `session:${sessionId}:seq` - Request sequence counter
  - `session:${sessionId}:info` - Session metadata
  - `session:${sessionId}:req:${sequence}` - Request headers
  - `session:${sessionId}:res:${sequence}` - Response body (5 min TTL)
  - `session:${sessionId}:usage` - Usage statistics

```typescript
// File: /Users/ding/Github/claude-code-hub/src/lib/session-manager.ts
private static readonly SESSION_TTL = parseInt(process.env.SESSION_TTL || "300", 10);

static async storeSessionResponse(
  sessionId: string,
  response: string | object,
  requestSequence?: number
): Promise<void> {
  const redis = getRedisClient();
  if (!redis || redis.status !== "ready") return;
  
  const key = requestSequence !== undefined 
    ? `session:${sessionId}:res:${requestSequence}`
    : `session:${sessionId}:res`;
    
  // Store with 5-minute expiration
  await redis.setex(key, 300, JSON.stringify({
    response: typeof response === "string" ? response : JSON.stringify(response),
    storedAt: Date.now(),
  }));
}
```

**Rate Limit Tracking** (`/Users/ding/Github/claude-code-hub/src/lib/rate-limit/service.ts`)
Uses multiple Redis data structures based on time window mode:

| Period | Mode | Data Structure | Key Pattern | TTL |
|--------|------|----------------|-------------|-----|
| 5h | Rolling | ZSET | `{type}:{id}:cost_5h_rolling` | 6 hours |
| Daily | Fixed | STRING | `{type}:{id}:cost_daily_{HHmm}` | Dynamic (to next reset) |
| Daily | Rolling | ZSET | `{type}:{id}:cost_daily_rolling` | 25 hours |
| Weekly | Fixed | STRING | `{type}:{id}:cost_weekly` | To next Monday |
| Monthly | Fixed | STRING | `{type}:{id}:cost_monthly` | To next 1st |

```typescript
// File: /Users/ding/Github/claude-code-hub/src/lib/rate-limit/service.ts
// Fixed window with dynamic TTL
const ttl = await getTTLForPeriodWithMode(limit.period, normalized, limit.mode);
await RateLimitService.redis.set(
  `${type}:${id}:cost_${periodKey}`,
  current.toString(),
  "EX",
  ttl
);
```

**Circuit Breaker State** (`/Users/ding/Github/claude-code-hub/src/lib/redis/circuit-breaker-state.ts`)
- **Key Pattern**: `circuit_breaker:state:{providerId}`
- **Data Structure**: Redis Hash
- **TTL**: 24 hours (86400 seconds)
- **Fields**:
  - `failureCount`: number
  - `lastFailureTime`: timestamp
  - `circuitState`: "closed" | "open" | "half-open"
  - `circuitOpenUntil`: timestamp
  - `halfOpenSuccessCount`: number

```typescript
// File: /Users/ding/Github/claude-code-hub/src/lib/redis/circuit-breaker-state.ts
const STATE_TTL_SECONDS = 86400; // 24 hours

export async function saveCircuitState(
  providerId: number,
  state: CircuitBreakerState
): Promise<void> {
  const key = getStateKey(providerId);
  await redis.hset(key, serializeState(state));
  await redis.expire(key, STATE_TTL_SECONDS);
}
```

**Circuit Breaker Config** (`/Users/ding/Github/claude-code-hub/src/lib/redis/circuit-breaker-config.ts`)
- **Key Pattern**: `circuit_breaker:config:{providerId}`
- **Data Structure**: Redis Hash
- **TTL**: Permanent (refreshed on provider update)

**Leaderboard Cache** (`/Users/ding/Github/claude-code-hub/src/lib/redis/leaderboard-cache.ts`)
- **Key Pattern**: `leaderboard:{scope}:{period}:{date}:{currency}{filters}`
- **TTL**: 60 seconds
- **Features**:
  - Distributed locking to prevent cache stampede
  - Automatic fallback to database on Redis failure
  - Supports multiple scopes: user, provider, providerCacheHitRate, model

```typescript
// File: /Users/ding/Github/claude-code-hub/src/lib/redis/leaderboard-cache.ts
const cacheKey = buildCacheKey(period, currencyDisplay, timezone, scope, dateRange, filters);
const lockKey = `${cacheKey}:lock`;

// Try to acquire lock (10 second expiration)
const locked = await redis.set(lockKey, "1", "EX", 10, "NX");

if (locked === "OK") {
  // Got lock - query DB and cache
  const data = await queryDatabase(period, scope, dateRange, filters);
  await redis.setex(cacheKey, 60, JSON.stringify(data));
  await redis.del(lockKey);
} else {
  // Wait and retry for up to 5 seconds
  for (let i = 0; i < 50; i++) {
    await sleep(100);
    const cached = await redis.get(cacheKey);
    if (cached) return JSON.parse(cached);
  }
  // Timeout - fallback to DB
  return await queryDatabase(period, scope, dateRange, filters);
}
```

**Client Version Cache** (`/Users/ding/Github/claude-code-hub/src/lib/client-version-checker.ts`)
- **User Version Key**: `client_version:{clientType}:{userId}`
- **GA Version Key**: `ga_version:{clientType}`
- **TTL**:
  - User Version: 7 days (matches active user window)
  - GA Version: 5 minutes (frequently accessed)

```typescript
// File: /Users/ding/Github/claude-code-hub/src/lib/client-version-checker.ts
const REDIS_KEYS = {
  /** User current version: client_version:{clientType}:{userId} */
  userVersion: (clientType: string, userId: number) => `client_version:${clientType}:${userId}`,
  /** GA version cache: ga_version:{clientType} */
  gaVersion: (clientType: string) => `ga_version:${clientType}`,
};

const TTL = {
  USER_VERSION: 7 * 24 * 60 * 60, // 7 days
  GA_VERSION: 5 * 60, // 5 minutes
};
```

**GA Version Detection Logic**:
The system automatically detects the "Generally Available" version by analyzing user version distribution:

```typescript
// File: /Users/ding/Github/claude-code-hub/src/lib/client-version-checker.ts
private static computeGAVersionFromUsers(
  users: Array<{ userId: number; version: string }>
): string | null {
  // 1. Count users per version (deduplicated)
  const versionCounts = new Map<string, Set<number>>();
  for (const user of users) {
    if (!versionCounts.has(user.version)) {
      versionCounts.set(user.version, new Set());
    }
    versionCounts.get(user.version)?.add(user.userId);
  }

  // 2. Find the latest version with >= GA_THRESHOLD users
  let gaVersion: string | null = null;
  for (const [version, userIds] of versionCounts.entries()) {
    if (userIds.size >= GA_THRESHOLD) {
      if (!gaVersion || isVersionGreater(version, gaVersion)) {
        gaVersion = version;
      }
    }
  }
  return gaVersion;
}
```

**GA Threshold Configuration**:
```typescript
// Configurable via CLIENT_VERSION_GA_THRESHOLD env var (range: 1-10, default: 2)
const GA_THRESHOLD = (() => {
  const envValue = process.env.CLIENT_VERSION_GA_THRESHOLD;
  const parsed = envValue ? parseInt(envValue, 10) : 2;
  if (Number.isNaN(parsed) || parsed < 1) return 1;
  if (parsed > 10) return 10;
  return parsed;
})();
```

**Session Tracking with Redis ZSET** (`/Users/ding/Github/claude-code-hub/src/lib/session-tracker.ts`)

The session tracker uses Redis Sorted Sets (ZSET) for efficient session management:

```typescript
// File: /Users/ding/Github/claude-code-hub/src/lib/session-tracker.ts
// Key patterns:
// - global:active_sessions - All active sessions
// - key:${keyId}:active_sessions - Sessions per API key
// - provider:${providerId}:active_sessions - Sessions per provider
// - user:${userId}:active_sessions - Sessions per user

private static readonly SESSION_TTL = 300000; // 5 minutes (milliseconds)

// Session lifecycle methods:
static async trackSession(sessionId: string, keyId: number, userId?: number): Promise<void>
static async updateProvider(sessionId: string, providerId: number): Promise<void>
static async refreshSession(sessionId: string, keyId: number, providerId: number, userId?: number): Promise<void>
```

**Session Counting Algorithm**:
```typescript
private static async countFromZSet(key: string): Promise<number> {
  const now = Date.now();
  const fiveMinutesAgo = now - SessionTracker.SESSION_TTL;

  // 1. Clean expired sessions (5 minutes old)
  await redis.zremrangebyscore(key, "-inf", fiveMinutesAgo);

  // 2. Get remaining session IDs
  const sessionIds = await redis.zrange(key, 0, -1);

  // 3. Verify session:${sessionId}:info exists (double-check)
  const pipeline = redis.pipeline();
  for (const sessionId of sessionIds) {
    pipeline.exists(`session:${sessionId}:info`);
  }
  
  // 4. Count only valid sessions
  const results = await pipeline.exec();
  return results.filter(([err, exists]) => !err && exists === 1).length;
}
```

---

## Config/Commands

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `REDIS_URL` | - | Redis connection URL (supports `redis://` and `rediss://`) |
| `ENABLE_RATE_LIMIT` | `true` | Enable Redis-based rate limiting and caching |
| `REDIS_TLS_REJECT_UNAUTHORIZED` | `true` | Verify TLS certificates (set `false` for self-signed) |
| `SESSION_TTL` | `300` | Session expiration time in seconds (5 minutes) |
| `STORE_SESSION_MESSAGES` | `false` | Store full message content (vs redacted) |
| `ENABLE_PROVIDER_CACHE` | `true` | Enable provider list caching |
| `SHORT_CONTEXT_THRESHOLD` | `2` | Short context detection threshold |
| `ENABLE_SHORT_CONTEXT_DETECTION` | `true` | Enable short context detection |

### Cache TTL Configuration Summary

| Cache Type | Location | TTL | Notes |
|------------|----------|-----|-------|
| Provider List | `provider-cache.ts` | 30s | Process-level with Pub/Sub sync |
| Active Sessions | `session-cache.ts` | 2s | In-memory only |
| Session Details | `session-cache.ts` | 1s | In-memory only |
| System Settings | `system-settings-cache.ts` | 60s | In-memory with fallback |
| Session Data (Redis) | `session-manager.ts` | 300s | Configurable via SESSION_TTL |
| Leaderboard | `leaderboard-cache.ts` | 60s | Redis with distributed lock |
| Circuit Breaker State | `circuit-breaker-state.ts` | 24h | Redis Hash |
| Circuit Breaker Config | `circuit-breaker-config.ts` | Permanent | Refreshed on update |
| Client Version (User) | `client-version-checker.ts` | 7d | Redis |
| Client Version (GA) | `client-version-checker.ts` | 5m | Redis |
| Rate Limit (5h) | `rate-limit/service.ts` | 6h | ZSET rolling window |
| Rate Limit (Daily Fixed) | `rate-limit/service.ts` | Dynamic | To next reset time |
| Rate Limit (Daily Rolling) | `rate-limit/service.ts` | 25h | ZSET rolling window |
| Sensitive Words | `sensitive-word-detector.ts` | Manual | Reloaded on change |
| Error Rules | `error-rule-detector.ts` | Manual | Reloaded on change |
| Request Filters | `request-filter-engine.ts` | Manual | Reloaded on change |

### Cache TTL Preference (API Request Caching)

The system supports overriding cache TTL for Anthropic API requests via the `cache_ttl_preference` setting:

**Type Definition** (`/Users/ding/Github/claude-code-hub/src/types/cache.ts`):
```typescript
export type CacheTtlPreference = "inherit" | "5m" | "1h";
export type CacheTtlResolved = Exclude<CacheTtlPreference, "inherit">;
```

**Resolution Logic** (`/Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/forwarder.ts`):
```typescript
function resolveCacheTtlPreference(
  keyPref: CacheTtlOption,
  providerPref: CacheTtlOption
): CacheTtlResolved | null {
  const normalize = (value: CacheTtlOption): CacheTtlResolved | null => {
    if (!value || value === "inherit") return null;
    return value;
  };

  // Priority: Key preference > Provider preference > null (inherit from client)
  return normalize(keyPref) ?? normalize(providerPref) ?? null;
}
```

**Application to Messages** (`/Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/forwarder.ts`):
```typescript
function applyCacheTtlOverrideToMessage(
  message: Record<string, unknown>,
  ttl: CacheTtlResolved
): boolean {
  // Applies to messages with cache_control.type === "ephemeral"
  // Sets ttl to "5m" or "1h" based on preference
}
```

This feature is applied only for `providerType === "claude"` or `"claude-auth"` providers.

---

## Edge Cases and Behaviors

### 1. Redis Unavailable (Fail-Open Strategy)

When Redis is unavailable, the system degrades gracefully:

**Leaderboard Cache**:
- Falls back to direct database query
- Logs warning: `[LeaderboardCache] Redis not available, fallback to direct query`

**Circuit Breaker**:
- Uses in-memory state only
- Loses cross-instance state sharing
- Loses state persistence across restarts

**Rate Limiting**:
- Falls back to database queries
- May cause performance degradation
- Logs: `[RateLimit] Cache miss for ${type}:${id}, querying database`

**Session Tracking**:
- Skips tracking (requests proceed normally)
- Returns 0 for concurrent session counts

**Pub/Sub Invalidation**:
- Silently ignores publish failures
- Local caches rely on TTL expiration

### 2. Cache Stampede Prevention

**Provider Cache**:
```typescript
// File: /Users/ding/Github/claude-code-hub/src/lib/cache/provider-cache.ts
// Uses refreshPromise to prevent concurrent refresh
if (cache.refreshPromise) {
  return cache.refreshPromise;
}

cache.refreshPromise = (async () => {
  try {
    const data = await fetcher();
    // Check version to prevent stale data
    if (cache.version === currentVersion) {
      cache.data = data;
      cache.expiresAt = Date.now() + CACHE_TTL_MS;
    }
    return data;
  } finally {
    cache.refreshPromise = null;
  }
})();
```

**Leaderboard Cache**:
- Uses Redis distributed locking (`SET NX EX`)
- Non-lock holders wait and retry (max 5 seconds)
- Timeout falls back to database

### 3. Cross-Instance Cache Invalidation

**Pub/Sub Channels** (`/Users/ding/Github/claude-code-hub/src/lib/redis/pubsub.ts`):
```typescript
export const CHANNEL_ERROR_RULES_UPDATED = "cch:cache:error_rules:updated";
export const CHANNEL_REQUEST_FILTERS_UPDATED = "cch:cache:request_filters:updated";
export const CHANNEL_PROVIDERS_UPDATED = "cch:cache:providers:updated";
```

**Invalidation Flow**:
1. Admin updates provider in Instance A
2. Instance A calls `publishProviderCacheInvalidation()`
3. Redis publishes to `cch:cache:providers:updated` channel
4. All instances receive notification
5. Each instance clears local cache
6. Next request triggers fresh DB load

### 4. Build/CI Phase Handling

During build or CI phases, Redis connections are skipped:
```typescript
// File: /Users/ding/Github/claude-code-hub/src/lib/redis/client.ts
if (process.env.CI === "true" || process.env.NEXT_PHASE === "phase-production-build") {
  return null;
}
```

This prevents connection errors during Next.js build phase.

### 5. Memory Management

**Session Cache Cleanup**:
```typescript
// File: /Users/ding/Github/claude-code-hub/src/lib/cache/session-cache.ts
export function startCacheCleanup(intervalSeconds: number = 60) {
  cacheCleanupState.__CCH_CACHE_CLEANUP_INTERVAL_ID__ = setInterval(() => {
    activeSessionsCache.cleanup();
    sessionDetailsCache.cleanup();
  }, intervalSeconds * 1000);
}
```

**Circuit Breaker Config Cache** (`/Users/ding/Github/claude-code-hub/src/lib/circuit-breaker.ts`):
```typescript
const CONFIG_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Per-provider config cache with TTL
if (health.config && health.configLoadedAt && 
    now - health.configLoadedAt < CONFIG_CACHE_TTL) {
  return health.config;
}
```

### 6. Lua Scripts for Atomic Operations

**File**: `/Users/ding/Github/claude-code-hub/src/lib/redis/lua-scripts.ts`

Used for atomic operations that require multiple Redis commands:
- `CHECK_AND_TRACK_SESSION`: Check concurrency limit + track atomically
- `BATCH_CHECK_SESSION_LIMITS`: Batch check multiple providers
- `TRACK_COST_5H_ROLLING_WINDOW`: 5-hour rolling window cost tracking
- `GET_COST_5H_ROLLING_WINDOW`: Query 5-hour window total
- `TRACK_COST_DAILY_ROLLING_WINDOW`: 24-hour rolling window tracking
- `GET_COST_DAILY_ROLLING_WINDOW`: Query 24-hour window total

### 7. Cache Warming

**Rate Limit Cache Warming** (`/Users/ding/Github/claude-code-hub/src/lib/rate-limit/service.ts`):
```typescript
// Warms Redis cache from database on cache miss
if (current === 0) {
  const exists = await RateLimitService.redis.exists(key);
  if (!exists) {
    logger.info(`[RateLimit] Cache miss for ${type}:${id}, querying database`);
    return await RateLimitService.checkCostLimitsFromDatabase(id, type, costLimits);
  }
}
```

**Provider Cache Warming** (`/Users/ding/Github/claude-code-hub/src/lib/cache/provider-cache.ts`):
```typescript
export async function warmupProviderCache(fetcher: () => Promise<Provider[]>): Promise<void> {
  try {
    await getCachedProviders(fetcher);
    logger.info("[ProviderCache] Cache warmed up successfully");
  } catch (error) {
    logger.warn("[ProviderCache] Cache warmup failed", { error });
  }
}
```

### 8. Version-Based Cache Consistency

Provider cache uses version numbers to prevent stale data during concurrent updates:
```typescript
const currentVersion = cache.version;

// After async fetch, check if cache was invalidated during fetch
if (cache.version === currentVersion) {
  cache.data = data;
  cache.expiresAt = Date.now() + CACHE_TTL_MS;
}
```

### 9. TLS Configuration for Cloud Redis

Supports managed Redis providers like Upstash:
```typescript
// File: /Users/ding/Github/claude-code-hub/src/lib/redis/client.ts
if (useTls) {
  const rejectUnauthorized = process.env.REDIS_TLS_REJECT_UNAUTHORIZED !== "false";
  redisOptions.tls = {
    host: url.hostname,
    servername: url.hostname, // SNI support
    rejectUnauthorized,
  };
}
```

---

## References

### Core Cache Files

| File | Purpose |
|------|---------|
| `/Users/ding/Github/claude-code-hub/src/lib/cache/provider-cache.ts` | Provider list process-level cache |
| `/Users/ding/Github/claude-code-hub/src/lib/cache/session-cache.ts` | Session data in-memory cache |
| `/Users/ding/Github/claude-code-hub/src/lib/config/system-settings-cache.ts` | System settings cache |
| `/Users/ding/Github/claude-code-hub/src/lib/redis/client.ts` | Redis client initialization |
| `/Users/ding/Github/claude-code-hub/src/lib/redis/pubsub.ts` | Cache invalidation Pub/Sub |
| `/Users/ding/Github/claude-code-hub/src/lib/redis/leaderboard-cache.ts` | Leaderboard Redis cache |
| `/Users/ding/Github/claude-code-hub/src/lib/redis/circuit-breaker-state.ts` | Circuit breaker state persistence |
| `/Users/ding/Github/claude-code-hub/src/lib/redis/circuit-breaker-config.ts` | Circuit breaker config cache |
| `/Users/ding/Github/claude-code-hub/src/lib/redis/lua-scripts.ts` | Atomic Lua scripts |
| `/Users/ding/Github/claude-code-hub/src/lib/session-manager.ts` | Session data management |
| `/Users/ding/Github/claude-code-hub/src/lib/session-tracker.ts` | Session tracking with Redis ZSET |
| `/Users/ding/Github/claude-code-hub/src/lib/rate-limit/service.ts` | Rate limiting with Redis |
| `/Users/ding/Github/claude-code-hub/src/lib/client-version-checker.ts` | Client version caching |
| `/Users/ding/Github/claude-code-hub/src/lib/sensitive-word-detector.ts` | Sensitive word cache |
| `/Users/ding/Github/claude-code-hub/src/lib/error-rule-detector.ts` | Error rule cache |
| `/Users/ding/Github/claude-code-hub/src/lib/request-filter-engine.ts` | Request filter cache |

### Type Definitions

| File | Purpose |
|------|---------|
| `/Users/ding/Github/claude-code-hub/src/types/cache.ts` | Cache TTL preference types |
| `/Users/ding/Github/claude-code-hub/src/types/provider.ts` | Provider type with cacheTtlPreference |
| `/Users/ding/Github/claude-code-hub/src/types/key.ts` | Key type with cacheTtlPreference |

### Configuration

| File | Purpose |
|------|---------|
| `/Users/ding/Github/claude-code-hub/src/lib/config/env.schema.ts` | Environment variable schema |
| `/Users/ding/Github/claude-code-hub/.env.example` | Configuration examples |

### Database Schema

| File | Purpose |
|------|---------|
| `/Users/ding/Github/claude-code-hub/src/drizzle/schema.ts` | Database schema with cache_ttl_preference fields |

---

## Summary

The claude-code-hub cache management system is a production-ready, multi-layered architecture that balances performance, consistency, and reliability:

1. **Performance**: Multiple cache layers (in-memory, Redis) reduce database load significantly
2. **Consistency**: Redis Pub/Sub ensures cross-instance cache coherence
3. **Reliability**: Fail-open design ensures service continuity even when cache infrastructure fails
4. **Flexibility**: Configurable TTLs and cache preferences allow fine-tuning for different use cases
5. **Observability**: Comprehensive logging throughout the cache lifecycle

The system handles edge cases like cache stampedes, concurrent updates, and infrastructure failures through careful design patterns like distributed locking, version tracking, and graceful degradation.

---

## Additional Implementation Details

### Proxy Agent Pool Cache

The system also includes a proxy agent pool cache for HTTP/HTTPS connections (`/Users/ding/Github/claude-code-hub/src/lib/proxy-agent/agent-pool.ts`):

```typescript
// File: /Users/ding/Github/claude-code-hub/src/lib/proxy-agent/agent-pool.ts
async getAgent(params: GetAgentParams): Promise<GetAgentResult> {
  const cacheKey = generateAgentCacheKey(params);
  this.stats.totalRequests++;

  // Check if marked as unhealthy
  if (this.unhealthyKeys.has(cacheKey)) {
    this.unhealthyKeys.delete(cacheKey);
    await this.evictByKey(cacheKey);
  }

  // Try to get from cache
  const cached = this.cache.get(cacheKey);
  if (cached && !this.isExpired(cached)) {
    cached.lastUsedAt = Date.now();
    cached.requestCount++;
    this.stats.cacheHits++;
    return { agent: cached.agent, isNew: false, cacheKey };
  }
  // ... create new agent
}
```

### Filter Options Cache

Usage log filter options are cached to improve dashboard performance (`/Users/ding/Github/claude-code-hub/src/actions/usage-logs.ts`):

```typescript
// File: /Users/ding/Github/claude-code-hub/src/actions/usage-logs.ts
const FILTER_OPTIONS_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// Cache structure
let filterOptionsCache: {
  data: FilterOptions | null;
  expiresAt: number;
} = { data: null, expiresAt: 0 };
```

### Provider Selector Settings Cache

Provider selection settings are cached for 60 seconds (`/Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/provider-selector.ts`):

```typescript
// File: /Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/provider-selector.ts
const SETTINGS_CACHE_TTL_MS = 60_000; // 60 seconds

let settingsCache: {
  data: SystemSettings | null;
  expiresAt: number;
} = { data: null, expiresAt: 0 };
```

### User Limit Badge Cache

Dashboard user limit badges are cached for 1 minute (`/Users/ding/Github/claude-code-hub/src/app/[locale]/dashboard/_components/user/user-limit-badge.tsx`):

```typescript
// File: /Users/ding/Github/claude-code-hub/src/app/[locale]/dashboard/_components/user/user-limit-badge.tsx
const CACHE_TTL = 60 * 1000; // 1 minute

// Client-side cache for limit data
if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
  return cached.data;
}
```

### Circuit Breaker Probe Cache

Provider configuration for circuit breaker probes is cached for 1 minute (`/Users/ding/Github/claude-code-hub/src/lib/circuit-breaker-probe.ts`):

```typescript
// File: /Users/ding/Github/claude-code-hub/src/lib/circuit-breaker-probe.ts
const PROVIDER_CACHE_TTL = 60000; // 1 minute

if (now - lastProviderCacheUpdate < PROVIDER_CACHE_TTL && providerConfigCache.size > 0) {
  return providerConfigCache;
}
```

---

## Best Practices for Cache Management

### 1. TTL Selection Guidelines

| Data Type | Recommended TTL | Rationale |
|-----------|-----------------|-----------|
| Static config | 1-5 minutes | Rarely changes, admin-controlled |
| User data | 1-2 seconds | Frequently updated, needs freshness |
| Aggregated stats | 30-60 seconds | Expensive to compute, acceptable staleness |
| Session data | 5 minutes | Matches session activity window |
| Rate limit counters | Window-based | Must align with limit period |

### 2. Cache Key Naming Conventions

The codebase follows consistent key naming patterns:
- **Prefix by entity type**: `session:`, `provider:`, `key:`, `user:`
- **Include identifiers**: `{type}:{id}:{attribute}`
- **Add context suffixes**: `:active_sessions`, `:cost_daily`, `:info`

### 3. Error Handling Patterns

All cache operations follow the fail-open pattern:
```typescript
try {
  // Cache operation
} catch (error) {
  logger.warn("[CacheName] Operation failed", { error });
  // Return fallback value or proceed without cache
}
```

### 4. Monitoring and Debugging

Cache statistics are available for monitoring:
```typescript
// Provider cache stats
export function getProviderCacheStats(): {
  hasData: boolean;
  count: number;
  expiresIn: number;
  version: number;
  isRefreshing: boolean;
}

// Session cache stats
export function getCacheStats() {
  return {
    activeSessions: activeSessionsCache.getStats(),
    sessionDetails: sessionDetailsCache.getStats(),
  };
}
```

---

## Conclusion

The claude-code-hub cache management system represents a well-architected solution for high-performance API proxy operations. Key takeaways:

1. **Multi-layer caching** provides both speed (in-memory) and consistency (Redis)
2. **Fail-open design** ensures service availability even during infrastructure issues
3. **Pub/Sub invalidation** maintains cache coherence across distributed instances
4. **Atomic Lua scripts** handle complex operations safely in high-concurrency scenarios
5. **Configurable TTLs** allow fine-tuning for different deployment scenarios

The system is designed to scale horizontally while maintaining data consistency, making it suitable for production deployments with multiple server instances.
