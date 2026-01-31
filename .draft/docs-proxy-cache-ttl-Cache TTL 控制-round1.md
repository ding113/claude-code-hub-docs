# Cache TTL 控制 - Code Exploration Report

## Intent Analysis

The Cache TTL (Time To Live) control system in claude-code-hub manages caching duration for various data types to optimize performance while ensuring data freshness. This feature is essential for:

1. **Performance Optimization**: Reducing database queries and API calls
2. **Cost Reduction**: Minimizing redundant data fetching
3. **Freshness Control**: Balancing cache hit rates with data accuracy
4. **Resource Management**: Preventing cache bloat and memory issues
5. **Operational Flexibility**: Different TTLs for different data types

The system uses Redis as the primary cache backend with configurable TTL values for sessions, rate limits, provider configurations, and other ephemeral data.

## Behavior Summary

### 1. Cache Architecture

**Primary Cache**: Redis
**Fallback**: In-memory (when Redis unavailable - Fail-Open)
**Key Structure**: Namespaced keys with type prefixes

```
cch:session:{sessionId}           # Session data
cch:ratelimit:{keyId}             # Rate limit counters
cch:provider:{providerId}         # Provider configuration
cch:circuit:{providerId}          # Circuit breaker state
cch:stats:{timeRange}             # Statistics aggregation
```

### 2. TTL Configuration Hierarchy

**Global Defaults** (Environment Variables):
```typescript
SESSION_TTL=300                    # 5 minutes
RATE_LIMIT_WINDOW=3600            # 1 hour
PROVIDER_CONFIG_TTL=300           # 5 minutes
CIRCUIT_BREAKER_TTL=600           # 10 minutes
```

**Per-Provider Overrides**:
```typescript
interface Provider {
  cacheTtl?: number;               # Override global default
}
```

**Dynamic TTL** (based on data characteristics):
- Session TTL: Extended on activity
- Rate limit windows: Fixed rolling windows
- Config cache: Refreshed on updates

### 3. Session TTL Implementation

**Core File**: `/Users/ding/Github/claude-code-hub/src/lib/session-manager.ts`

```typescript
const SESSION_TTL = parseInt(process.env.SESSION_TTL || '300'); // 5 minutes

class SessionManager {
  async getSession(sessionId: string): Promise<Session | null> {
    const key = `cch:session:${sessionId}`;
    const session = await redis.get(key);
    
    if (session) {
      // Extend TTL on access (sliding window)
      await redis.expire(key, SESSION_TTL);
    }
    
    return session;
  }
  
  async setSession(sessionId: string, data: Session): Promise<void> {
    const key = `cch:session:${sessionId}`;
    await redis.setex(key, SESSION_TTL, JSON.stringify(data));
  }
}
```

**Sliding Window Behavior**:
- Initial TTL: 300 seconds (5 minutes)
- On each access: TTL reset to full duration
- Inactive sessions expire automatically

### 4. Rate Limit TTL

**Core File**: `/Users/ding/Github/claude-code-hub/src/lib/rate-limit/lua-scripts.ts`

**5-Hour Rolling Window**:
```lua
-- TTL = window size + buffer
local ttl = 5 * 3600  -- 5 hours
redis.call('EXPIRE', key, ttl)
```

**Daily/Weekly/Monthly Windows**:
- Fixed windows: TTL until window end
- Rolling windows: TTL = window duration

**Concurrent Session TTL**:
```lua
-- Session tracking with 5-minute TTL
redis.call('ZADD', key, timestamp, sessionId)
redis.call('EXPIRE', key, 300)  -- 5 minutes
```

### 5. Provider Configuration Cache

**Caching Strategy** (`/Users/ding/Github/claude-code-hub/src/lib/provider-config-cache.ts`):

```typescript
const PROVIDER_CONFIG_TTL = 300; // 5 minutes

class ProviderConfigCache {
  async get(providerId: string): Promise<Provider | null> {
    const key = `cch:provider:${providerId}`;
    const cached = await redis.hgetall(key);
    
    if (Object.keys(cached).length > 0) {
      return this.transform(cached);
    }
    
    // Cache miss - fetch from DB
    const config = await db.query.providers.findFirst({
      where: eq(providers.id, providerId),
    });
    
    if (config) {
      await redis.hset(key, this.flatten(config));
      await redis.expire(key, PROVIDER_CONFIG_TTL);
    }
    
    return config;
  }
  
  async invalidate(providerId: string): Promise<void> {
    const key = `cch:provider:${providerId}`;
    await redis.del(key);
  }
}
```

**Cache Invalidation**:
- On provider update: Immediate invalidation
- On provider delete: Key deletion
- TTL expiration: Automatic cleanup

### 6. Circuit Breaker State TTL

**State Persistence** (`/Users/ding/Github/claude-code-hub/src/lib/circuit-breaker.ts`):

```typescript
const CIRCUIT_BREAKER_TTL = 600; // 10 minutes

class CircuitBreaker {
  async recordFailure(providerId: string): Promise<void> {
    const key = `cch:circuit:${providerId}`;
    const state = await this.getState(key);
    
    state.failureCount++;
    state.lastFailureTime = Date.now();
    
    await redis.hset(key, state);
    await redis.expire(key, CIRCUIT_BREAKER_TTL);
  }
}
```

**State Recovery**:
- After TTL expiration: State resets to CLOSED
- Manual reset: Immediate via API
- Success recording: Extends TTL

## Config/Commands

### 1. Environment Variables

**Cache TTL Configuration** (`/Users/ding/Github/claude-code-hub/.env.example`):

```bash
# Session TTL (seconds)
SESSION_TTL=300

# Rate Limit Windows
RATE_LIMIT_5H_WINDOW=18000        # 5 hours in seconds
RATE_LIMIT_DAILY_WINDOW=86400     # 24 hours
RATE_LIMIT_WEEKLY_WINDOW=604800   # 7 days
RATE_LIMIT_MONTHLY_WINDOW=2592000 # 30 days

# Provider Config Cache
PROVIDER_CONFIG_TTL=300

# Circuit Breaker State
CIRCUIT_BREAKER_TTL=600

# Statistics Cache
STATS_CACHE_TTL=300
```

### 2. Redis Configuration

**Connection**:
```bash
REDIS_URL=redis://localhost:6379
# or with TLS
REDIS_URL=rediss://secure.redis.host:6380
REDIS_TLS_REJECT_UNAUTHORIZED=true
```

**Memory Management**:
```bash
# Redis maxmemory policy (in redis.conf)
maxmemory-policy allkeys-lru  # Evict least recently used
```

### 3. TTL Values by Data Type

| Data Type | Default TTL | Configurable | Notes |
|-----------|-------------|--------------|-------|
| Session | 300s | Yes (env) | Sliding window |
| Rate Limit (5h) | 18000s | No | Fixed window |
| Rate Limit (daily) | 86400s | No | Fixed/rolling |
| Provider Config | 300s | Yes (env) | Invalidated on update |
| Circuit Breaker | 600s | Yes (env) | State persistence |
| Statistics | 300s | Yes (env) | Aggregated data |
| Token Price | 3600s | No | Hourly refresh |

### 4. Cache Inspection Commands

**Redis CLI**:
```bash
# List all CCH keys
redis-cli KEYS 'cch:*'

# Get TTL of specific key
redis-cli TTL cch:session:abc123

# Get all session keys with TTL
redis-cli --scan --pattern 'cch:session:*' | xargs -I {} sh -c 'echo "{}: $(redis-cli TTL {})"'

# Memory usage by key pattern
redis-cli --scan --pattern 'cch:session:*' | xargs redis-cli MEMORY USAGE
```

### 5. Cache Warming

**Manual Warmup** (for critical providers):
```typescript
// Pre-load provider configs into cache
const criticalProviders = ['anthropic', 'openai'];
for (const id of criticalProviders) {
  await providerConfigCache.warm(id);
}
```

## Edge Cases

### 1. Redis Unavailable (Fail-Open)

**Behavior**:
- Cache operations silently fail
- System continues with database queries
- No error returned to users
- Automatic recovery when Redis returns

**Implementation**:
```typescript
try {
  await redis.setex(key, ttl, value);
} catch (err) {
  logger.warn('Redis unavailable, operating without cache');
  // Continue without caching
}
```

### 2. TTL Race Condition

**Issue**: Key expires between read and write

**Solution**: Atomic operations with Lua scripts
```lua
-- Check and set with TTL in single operation
local current = redis.call('GET', key)
if not current then
  redis.call('SETEX', key, ttl, value)
  return 1
end
return 0
```

### 3. Clock Skew

**Issue**: Different servers have different times

**Impact**: 
- Rate limit windows may be inconsistent
- Session expiration timing varies

**Mitigation**:
- Use Redis TIME command for server time
- Allow small tolerance (±1 second)
- Prefer Redis-based timestamps

### 4. Memory Pressure

**Issue**: Redis reaches maxmemory limit

**Eviction Policies**:
- `allkeys-lru`: Evict least recently used (recommended)
- `allkeys-lfu`: Evict least frequently used
- `volatile-lru`: Evict only keys with TTL

**Monitoring**:
```bash
redis-cli INFO memory
# Check used_memory and maxmemory
```

### 5. Large Value Serialization

**Issue**: Session data too large for Redis

**Solution**:
- Compress large values
- Split into multiple keys
- Use Redis hashes for structured data

```typescript
// Compress large session data
import { compress, decompress } from 'lz4';

async setLargeSession(id: string, data: object): Promise<void> {
  const compressed = compress(JSON.stringify(data));
  await redis.setex(`cch:session:${id}`, SESSION_TTL, compressed);
}
```

### 6. Cold Start

**Issue**: Cache empty after Redis restart

**Impact**:
- Increased database load
- Higher latency initially

**Mitigation**:
- Gradual traffic ramp-up
- Cache warming scripts
- Database connection pool sizing

### 7. TTL Precision

**Issue**: Redis TTL is second-precision

**Impact**:
- Sub-second TTLs not supported
- Sessions may live up to 1 second longer

**Workaround**:
- Use millisecond timestamps in value
- Check expiration in application layer

## References

### Core Files

| File | Purpose |
|------|---------|
| `/Users/ding/Github/claude-code-hub/src/lib/session-manager.ts` | Session TTL management |
| `/Users/ding/Github/claude-code-hub/src/lib/rate-limit/lua-scripts.ts` | Rate limit TTL Lua scripts |
| `/Users/ding/Github/claude-code-hub/src/lib/provider-config-cache.ts` | Provider config caching |
| `/Users/ding/Github/claude-code-hub/src/lib/circuit-breaker.ts` | Circuit breaker state TTL |
| `/Users/ding/Github/claude-code-hub/src/lib/redis-client.ts` | Redis connection management |

### Configuration Files

| File | Purpose |
|------|---------|
| `/Users/ding/Github/claude-code-hub/.env.example` | Environment variable defaults |
| `/Users/ding/Github/claude-code-hub/src/lib/config/env.schema.ts` | Env validation schema |

### Type Definitions

| File | Purpose |
|------|---------|
| `/Users/ding/Github/claude-code-hub/src/types/session.ts` | Session data types |
| `/Users/ding/Github/claude-code-hub/src/types/provider.ts` | Provider config types |

## Summary

The Cache TTL control system provides:

1. **Flexible TTL Configuration**: Per-data-type TTL with environment overrides
2. **Automatic Expiration**: Redis-managed TTL with automatic cleanup
3. **Sliding Windows**: Session TTL extends on access
4. **Fail-Open Design**: Continues operating when Redis unavailable
5. **Cache Invalidation**: Immediate invalidation on data updates
6. **Memory Safety**: Configurable eviction policies and size limits

This system balances performance optimization with data freshness requirements.
