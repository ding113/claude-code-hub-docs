# Circuit Breaker Mechanism Analysis Report

## Intent Analysis

The circuit breaker mechanism in claude-code-hub is designed to protect the proxy service from cascading failures when upstream providers become unavailable or unstable. The primary intent is to:

1. **Prevent Resource Exhaustion**: When a provider fails repeatedly, the system stops sending requests to it, preventing wasted resources on doomed requests.

2. **Enable Graceful Degradation**: By isolating failing providers, the system can continue serving requests through healthy providers.

3. **Automatic Recovery**: The system automatically attempts to recover providers after a cooldown period, reducing manual intervention.

4. **Multi-level Protection**: Circuit breakers operate at three levels - provider level, endpoint level, and vendor-type level - providing comprehensive protection.

## Behavior Summary

### State Machine

The circuit breaker implements a three-state state machine:

1. **CLOSED (关闭)**: Normal operation state. All requests pass through to the provider.
2. **OPEN (打开)**: Failure threshold exceeded. Requests are blocked from reaching the provider.
3. **HALF-OPEN (半开)**: Recovery testing state. Limited requests are allowed to test if the provider has recovered.

### State Transitions

```
CLOSED -> OPEN: When failureCount >= failureThreshold
OPEN -> HALF-OPEN: When currentTime > circuitOpenUntil (timeout expired)
HALF-OPEN -> CLOSED: When halfOpenSuccessCount >= halfOpenSuccessThreshold
HALF-OPEN -> OPEN: When a failure occurs during half-open
```

### Core Functions

**File**: `/Users/ding/Github/claude-code-hub/src/lib/circuit-breaker.ts`

- `isCircuitOpen(providerId)`: Checks if requests should be blocked for a provider
- `recordFailure(providerId, error)`: Records a failure and potentially opens the circuit
- `recordSuccess(providerId)`: Records success and handles half-open recovery
- `resetCircuit(providerId)`: Manually resets a circuit to closed state
- `tripToHalfOpen(providerId)`: Transitions from OPEN to HALF_OPEN (used by smart probe)

### Endpoint-Level Circuit Breaker

**File**: `/Users/ding/Github/claude-code-hub/src/lib/endpoint-circuit-breaker.ts`

A separate circuit breaker implementation for provider endpoints with different default thresholds:
- Failure Threshold: 3 (vs 5 for providers)
- Open Duration: 300000ms / 5 minutes (vs 30 minutes for providers)
- Half-Open Success Threshold: 1 (vs 2 for providers)

Functions:
- `isEndpointCircuitOpen(endpointId)`
- `recordEndpointFailure(endpointId, error)`
- `recordEndpointSuccess(endpointId)`
- `resetEndpointCircuit(endpointId)`

### Vendor-Type Circuit Breaker

**File**: `/Users/ding/Github/claude-code-hub/src/lib/vendor-type-circuit-breaker.ts`

A simplified circuit breaker at the vendor + provider type level with only CLOSED/OPEN states (no HALF-OPEN). Used when all endpoints of a specific vendor+type combination fail.

Key features:
- Supports manual open/close via `manualOpen` flag
- Auto-open duration: 60 seconds
- Functions: `isVendorTypeCircuitOpen()`, `recordVendorTypeAllEndpointsTimeout()`, `setVendorTypeCircuitManualOpen()`

### Smart Probe Scheduler

**File**: `/Users/ding/Github/claude-code-hub/src/lib/circuit-breaker-probe.ts`

Periodically probes providers in OPEN state to enable faster recovery:
- Configurable via environment variables
- Default: Disabled (`ENABLE_SMART_PROBING=false`)
- Probe interval: 10 seconds (configurable)
- Probe timeout: 5 seconds (configurable)
- On success, transitions circuit to HALF_OPEN

## Configuration Options

### Provider-Level Configuration (Per Provider)

**Database Schema**: `/Users/ding/Github/claude-code-hub/src/drizzle/schema.ts`

```typescript
circuitBreakerFailureThreshold: integer().default(5)        // 失败阈值
circuitBreakerOpenDuration: integer().default(1800000)     // 熔断时长（毫秒，默认30分钟）
circuitBreakerHalfOpenSuccessThreshold: integer().default(2) // 恢复阈值
```

### Default Values

**File**: `/Users/ding/Github/claude-code-hub/src/lib/redis/circuit-breaker-config.ts`

```typescript
DEFAULT_CIRCUIT_BREAKER_CONFIG = {
  failureThreshold: 5,           // 5 consecutive failures
  openDuration: 1800000,         // 30 minutes
  halfOpenSuccessThreshold: 2    // 2 successful requests to close
}
```

**File**: `/Users/ding/Github/claude-code-hub/src/lib/endpoint-circuit-breaker.ts`

```typescript
DEFAULT_ENDPOINT_CIRCUIT_BREAKER_CONFIG = {
  failureThreshold: 3,           // 3 consecutive failures
  openDuration: 300000,          // 5 minutes
  halfOpenSuccessThreshold: 1    // 1 successful request to close
}
```

### Environment Variables

**File**: `/Users/ding/Github/claude-code-hub/src/lib/config/env.schema.ts`

- `ENABLE_CIRCUIT_BREAKER_ON_NETWORK_ERRORS`: Whether to count network errors toward circuit breaker (default: false)
- `MAX_RETRY_ATTEMPTS_DEFAULT`: Default max retry attempts per provider (default: 2)

**Smart Probe Configuration** (`/Users/ding/Github/claude-code-hub/src/lib/circuit-breaker-probe.ts`):
- `ENABLE_SMART_PROBING`: Enable/disable smart probing (default: false)
- `PROBE_INTERVAL_MS`: Interval between probe cycles (default: 10000ms)
- `PROBE_TIMEOUT_MS`: Timeout for each probe request (default: 5000ms)

## Redis Integration for State Storage

### State Storage Structure

**File**: `/Users/ding/Github/claude-code-hub/src/lib/redis/circuit-breaker-state.ts`

Redis Hash structure for provider-level circuit breaker:
```
Key: circuit_breaker:state:{providerId}
Fields:
  - failureCount: number
  - lastFailureTime: number | null
  - circuitState: "closed" | "open" | "half-open"
  - circuitOpenUntil: number | null
  - halfOpenSuccessCount: number
```

TTL: 24 hours (86400 seconds)

### Config Storage

**File**: `/Users/ding/Github/claude-code-hub/src/lib/redis/circuit-breaker-config.ts`

```
Key: circuit_breaker:config:{providerId}
Fields:
  - failureThreshold: string
  - openDuration: string
  - halfOpenSuccessThreshold: string
```

### Endpoint State Storage

**File**: `/Users/ding/Github/claude-code-hub/src/lib/redis/endpoint-circuit-breaker-state.ts`

```
Key: endpoint_circuit_breaker:state:{endpointId}
TTL: 24 hours
```

### Vendor-Type State Storage

**File**: `/Users/ding/Github/claude-code-hub/src/lib/redis/vendor-type-circuit-breaker-state.ts`

```
Key: vendor_type_circuit_breaker:state:{vendorId}:{providerType}
Fields:
  - circuitState: "closed" | "open"
  - circuitOpenUntil: number | null
  - lastFailureTime: number | null
  - manualOpen: boolean
TTL: 30 days (2592000 seconds)
```

### State Persistence Strategy

1. **Memory-First**: All state changes are stored in memory first for performance
2. **Async Redis Persistence**: State is asynchronously persisted to Redis without blocking
3. **State Recovery**: On startup or when accessing a provider, the system loads state from Redis
4. **Multi-Instance Synchronization**: Redis acts as the source of truth for multi-instance deployments

## Edge Cases

### 1. Network Error Handling

**File**: `/Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/forwarder.ts`

Network errors (fetch failures, timeouts) are NOT counted toward circuit breaker by default. This can be enabled via `ENABLE_CIRCUIT_BREAKER_ON_NETWORK_ERRORS=true`.

When enabled:
- Network errors trigger `recordFailure()`
- Provider is added to `failedProviderIds` to prevent re-selection

### 2. Disabling Circuit Breaker

Setting `failureThreshold = 0` disables the circuit breaker for that provider. This is useful for critical providers that should never be bypassed.

### 3. Duplicate Alert Prevention

**File**: `/Users/ding/Github/claude-code-hub/src/lib/notification/notifier.ts`

Circuit breaker alerts are deduplicated using Redis cache:
- Cache key: `circuit-breaker-alert:{providerId}`
- TTL: 5 minutes (300 seconds)
- Prevents spam when a provider flaps

### 4. Redis Unavailability

All Redis operations have graceful fallbacks:
- If Redis is unavailable, operations continue with in-memory state only
- State persistence failures are logged but don't block request processing
- Config loading falls back to database or default values

### 5. State Synchronization

When a provider is in non-closed state, the system always checks Redis on access:
- Allows external resets to take effect immediately
- Supports manual circuit reset via admin operations
- Prevents stale state in multi-instance deployments

### 6. Configuration Caching

Provider configurations are cached in memory for 5 minutes (`CONFIG_CACHE_TTL`) to reduce Redis/database load. The cache is cleared when:
- TTL expires
- `clearConfigCache(providerId)` is called (after provider updates)

### 7. Provider Deletion

When a provider is deleted, `clearProviderState()` is called to:
- Remove from memory map
- Remove from loadedFromRedis set
- Delete Redis state

## Key Source Files

| File | Purpose |
|------|---------|
| `/Users/ding/Github/claude-code-hub/src/lib/circuit-breaker.ts` | Main circuit breaker service |
| `/Users/ding/Github/claude-code-hub/src/lib/redis/circuit-breaker-state.ts` | Redis state persistence |
| `/Users/ding/Github/claude-code-hub/src/lib/redis/circuit-breaker-config.ts` | Redis config caching |
| `/Users/ding/Github/claude-code-hub/src/lib/endpoint-circuit-breaker.ts` | Endpoint-level circuit breaker |
| `/Users/ding/Github/claude-code-hub/src/lib/vendor-type-circuit-breaker.ts` | Vendor-type level circuit breaker |
| `/Users/ding/Github/claude-code-hub/src/lib/circuit-breaker-probe.ts` | Smart probe scheduler |
| `/Users/ding/Github/claude-code-hub/src/lib/circuit-breaker-loader.ts` | Startup initialization |
| `/Users/ding/Github/claude-code-hub/src/lib/notification/notifier.ts` | Alert notifications |

## References

- Circuit Breaker Pattern: https://martinfowler.com/bliki/CircuitBreaker.html
- Redis Hash Commands: https://redis.io/commands/?group=hash
- Implementation inspired by Netflix Hystrix and Resilience4j
