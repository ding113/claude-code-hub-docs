# Provider Health Check - Round 2 Verified Draft

## Intent Analysis

The provider health check system in claude-code-hub serves a critical role in maintaining
service reliability by continuously monitoring the health of AI model providers (like Claude,
OpenAI, etc.) and automatically managing their availability. The system is designed to:

1. **Detect provider failures early** - Through continuous probing and request monitoring
2. **Prevent cascading failures** - Using circuit breaker patterns to stop sending requests
to unhealthy providers
3. **Enable automatic recovery** - Through smart probing and gradual reintroduction of
recovered providers
4. **Provide visibility** - Via real-time dashboards and health status indicators
5. **Support manual intervention** - Allowing administrators to reset circuit breakers when
needed

The health check system operates at multiple levels: endpoint-level probing (HTTP health
checks), provider-level circuit breakers (based on request failures), and agent-level health
management (for connection pooling).

## Behavior Summary

### 1. Circuit Breaker State Machine

The core health check mechanism is built around a three-state circuit breaker pattern
implemented in `/Users/ding/Github/claude-code-hub/src/lib/circuit-breaker.ts`.

**States:**
- **Closed** - Normal operation, requests flow through
- **Open** - Provider is unhealthy, requests are blocked
- **Half-Open** - Testing recovery, limited requests allowed

**State Transitions:**

```
Closed --[failureCount >= threshold]--> Open --[timeout expires]--> Half-Open
   ^                                            |
   +-------------[successCount >= threshold]----+
```

The `ProviderHealth` interface (lines 32-41) tracks:

```typescript
export interface ProviderHealth {
  failureCount: number;                    // Current consecutive failures
  lastFailureTime: number | null;         // Timestamp of last failure
  circuitState: "closed" | "open" | "half-open";
  circuitOpenUntil: number | null;        // When to attempt recovery
  halfOpenSuccessCount: number;           // Successes in half-open state
  config: CircuitBreakerConfig | null;    // Cached configuration
  configLoadedAt: number | null;          // When config was loaded
}
```

### 2. Endpoint Probing System

The endpoint probe system
(`/Users/ding/Github/claude-code-hub/src/lib/provider-endpoints/probe.ts`) performs active
health checks on provider endpoints.

**Probe Method (lines 121-130):**
- First attempts a `HEAD` request (faster, no body)
- Falls back to `GET` only if `HEAD` returns `statusCode === null` (network/timeout errors)
- Considers HTTP 5xx as unhealthy (statusCode >= 500)
- 4xx errors are NOT considered probe failures (client errors)

**Probe Result Structure (lines 10-17):**

```typescript
export interface EndpointProbeResult {
  ok: boolean;                    // true if statusCode < 500
  method: EndpointProbeMethod;    // "HEAD" or "GET"
  statusCode: number | null;      // HTTP status or null on network error
  latencyMs: number | null;       // Response time
  errorType: string | null;       // "timeout", "network_error", "http_5xx", etc.
  errorMessage: string | null;    // Human-readable error
}
```

**Error Types (from toErrorInfo function, lines 60-72):**
- `timeout` - AbortError from fetch timeout
- `network_error` - Connection failure, DNS error, etc.
- `invalid_url` - URL parsing failure
- `http_5xx` - Server error (5xx status codes)
- `unknown_error` - Unexpected errors

### 3. Probe Scheduler

The probe scheduler
(`/Users/ding/Github/claude-code-hub/src/lib/provider-endpoints/probe-scheduler.ts`) manages
periodic health checks.

**Key Features:**
- **Leader election** - Uses Redis locks to ensure only one instance runs probes
- **Adaptive intervals** - Different probe frequencies based on endpoint state:
  - Base interval: 60 seconds (default)
  - Single-vendor interval: 10 minutes (for vendors with only 1 endpoint)
  - Timeout override: 10 seconds (for endpoints with recent timeout errors)
- **Concurrent probing** - Configurable concurrency (default: 10)
- **Jitter** - Random delay (default: 1s) to prevent thundering herd

**Scheduler State Management (lines 43-49):**

```typescript
const schedulerState = globalThis as unknown as {
  __CCH_ENDPOINT_PROBE_SCHEDULER_STARTED__?: boolean;
  __CCH_ENDPOINT_PROBE_SCHEDULER_INTERVAL_ID__?: ReturnType<typeof setInterval>;
  __CCH_ENDPOINT_PROBE_SCHEDULER_RUNNING__?: boolean;
  __CCH_ENDPOINT_PROBE_SCHEDULER_LOCK__?: LeaderLock;
  __CCH_ENDPOINT_PROBE_SCHEDULER_STOP_REQUESTED__?: boolean;
};
```

**Lock Key:** `locks:endpoint-probe-scheduler` (line 14)

### 4. Smart Probing for Recovery

The smart probe system
(`/Users/ding/Github/claude-code-hub/src/lib/circuit-breaker-probe.ts`) accelerates
recovery detection.

**Purpose:** When a provider's circuit is OPEN, the system periodically probes it to detect
when it recovers, rather than waiting for the full timeout period.

**Configuration (lines 18-21):**
- `ENABLE_SMART_PROBING` - Enable/disable (default: false)
- `PROBE_INTERVAL_MS` - Probe interval (default: 10000ms = 10s)
- `PROBE_TIMEOUT_MS` - Request timeout (default: 5000ms = 5s)

**IMPORTANT DISCREPANCY:** The `.env.example` file documents `PROBE_INTERVAL_MS` default as
30000ms (30s), but the actual code default is 10000ms (10s).

**Behavior:**
- Only probes providers in OPEN state (lines 164-167)
- On success, transitions circuit to HALF-OPEN immediately via `tripToHalfOpen()` (line 124)
- Uses actual provider test requests via `executeProviderTest()` (line 107)
- Caches provider configs for 1 minute to reduce database load

### 5. Availability Monitoring

The availability service
(`/Users/ding/Github/claude-code-hub/src/lib/availability/availability-service.ts`)
calculates provider health based on actual request history.

**Status Classification (lines 27-52):**

```typescript
export function classifyRequestStatus(statusCode: number | null): RequestStatusClassification {
  // No status code means network error or timeout
  if (statusCode === null) {
    return { status: "red", isSuccess: false, isError: true };
  }

  // HTTP error (4xx/5xx)
  if (statusCode >= 400) {
    return { status: "red", isSuccess: false, isError: true };
  }

  // HTTP success (2xx/3xx)
  return { status: "green", isSuccess: true, isError: false };
}
```

**Current Status Determination (lines 291-301):**
- Analyzes last 3 time buckets (recent history)
- Status is `unknown` if no data available (important: does NOT assume healthy)
- `green` if >= 50% success rate (average across 3 buckets)
- `red` if < 50% success rate

**Availability Score (lines 57-62):**

```typescript
export function calculateAvailabilityScore(greenCount: number, redCount: number): number {
  const total = greenCount + redCount;
  if (total === 0) return 0;
  return greenCount / total;
}
```

**Note:** The `AVAILABILITY_WEIGHTS` constant exists in types.ts (green=1.0, red=0.0,
unknown=-1) but is NOT used in the actual scoring calculation. The implementation uses a
simple ratio instead.

### 6. Endpoint Circuit Breaker

A separate circuit breaker for individual endpoints
(`/Users/ding/Github/claude-code-hub/src/lib/endpoint-circuit-breaker.ts`):

**Default Configuration (lines 18-22):**

```typescript
export const DEFAULT_ENDPOINT_CIRCUIT_BREAKER_CONFIG: EndpointCircuitBreakerConfig = {
  failureThreshold: 3,           // Open after 3 failures
  openDuration: 300000,          // 5 minutes
  halfOpenSuccessThreshold: 1,   // Close after 1 success
};
```

This is more aggressive than the provider-level circuit breaker, designed for faster
failover at the endpoint level.

### 7. Agent Pool Health Management

The agent pool (`/Users/ding/Github/claude-code-hub/src/lib/proxy-agent/agent-pool.ts`)
manages HTTP connection health.

**Health Features:**
- Agents marked as unhealthy on SSL certificate errors (detected in forwarder.ts line 1683)
- Agents marked as unhealthy on HTTP/2 protocol errors (detected in forwarder.ts line 1806)
- Unhealthy agents are replaced on next request (getAgent() lines 189-192)
- Tracks unhealthy agent count in pool statistics (getPoolStats() line 288)

**Marking Unhealthy (lines 265-271):**

```typescript
markUnhealthy(cacheKey: string, reason: string): void {
  this.unhealthyKeys.add(cacheKey);
  logger.warn("AgentPool: Agent marked as unhealthy", {
    cacheKey,
    reason,
  });
}
```

**Replacement Flow:**
1. When `getAgent()` is called, it checks if the cache key is in `unhealthyKeys` Set (line 190)
2. If marked unhealthy, it removes the key from `unhealthyKeys` and evicts the cached agent
3. A new agent is created for the request (new agent flag at line 234)

### 8. Circuit Breaker Alert Notifications

When a circuit breaker opens, the system can send webhook notifications to alert
administrators.

**Implementation:** `/Users/ding/Github/claude-code-hub/src/lib/circuit-breaker.ts` (lines
285-329)

**Alert Content:**
- Provider name and ID
- Failure count that triggered the open
- Timestamp when retry will be attempted
- Last error message

**Webhook Implementation:** `/Users/ding/Github/claude-code-hub/src/lib/notification/notifier.ts`
(lines 11-123)

**Key Features:**
- Duplicate suppression: 5-minute Redis cache (line 28, 75)
- Two modes: Legacy (single webhook) and Binding-based (multiple targets)
- Settings checked: `settings.enabled` and `settings.circuitBreakerEnabled` (line 17)

**Code Flow:**
1. `recordFailure()` detects threshold reached (line 250)
2. `triggerCircuitBreakerAlert()` is called asynchronously (line 267)
3. Provider details are fetched from database
4. Webhook payload is constructed and sent via `sendCircuitBreakerAlert()`
5. Errors in alert sending are logged but don't affect circuit breaker operation

### 9. Health Check Integration with Provider Selection

The health check system is tightly integrated with the provider selection logic. When a
request comes in, the system goes through multiple filtering stages.

**File:** `/Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/provider-selector.ts`

**Selection Pipeline (lines 669-957):**

| Step | Stage | Description |
|------|-------|-------------|
| 1 | Group Pre-filter | Filters by user/key providerGroup |
| 2 | Base Filter + Format/Model Match | isEnabled, excludeIds, format compatibility, model support |
| 3 | 1M Context Filter | Filters providers with context1mPreference === 'disabled' |
| 4 | Health Check (filterByLimits) | Circuit breaker + spending limits |
| 5 | Priority Stratification | Select only highest priority providers |
| 6 | Cost Sort + Weighted Selection | Sort by costMultiplier, weighted random selection |

**Decision Context Tracking (lines 864-868):**

```typescript
context.beforeHealthCheck = candidateProviders.length;
const healthyProviders = await ProxyProviderResolver.filterByLimits(candidateProviders);
context.afterHealthCheck = healthyProviders.length;
```

This tracking enables the decision chain visualization in the logs, showing how many
providers were filtered out at each stage.

**Health Filtering Logic (filterByLimits, lines 966-1033):**

The `filterByLimits` function checks the following in order:

1. **Vendor-Type Circuit Breaker** (lines 970-981) - Checks
`isVendorTypeCircuitOpen(p.providerVendorId, p.providerType)`
2. **Provider Circuit Breaker** (lines 983-989) - Checks `isCircuitOpen(p.id)`
3. **5h/Daily/Weekly/Monthly Spending Limits** (lines 991-1006) - Calls
`RateLimitService.checkCostLimitsWithLease()`
4. **Total Cost Limit** (lines 1008-1024) - Calls
`RateLimitService.checkTotalCostLimit()`

**IMPORTANT CORRECTION:** Concurrent session limits are NOT checked in `filterByLimits`.
The comment at line 1026 states: `// 并发 Session 限制已移至原子性检查（avoid race condition)`.
Concurrent session checks are performed atomically in the `ensure()` method (lines 282-403)
using `RateLimitService.checkAndTrackProviderSession()`.

### 10. Provider Testing Service

The smart probing system uses a dedicated provider testing service
(`/Users/ding/Github/claude-code-hub/src/lib/provider-testing/test-service.ts`) to perform
actual API calls against providers.

**IMPORTANT CORRECTION:** The current implementation supports **ONE unified test type** - a
Completion Test. There is NO separate implementation for Connection Test or Model List Test.

**Test Execution:**

```typescript
export async function executeProviderTest(
  config: ProviderTestConfig
): Promise<ProviderTestResult>
```

**ProviderTestConfig Interface:**
- `providerId` - Provider ID (for existing providers)
- `providerUrl` - Provider base URL (required)
- `apiKey` - API key for authentication (required)
- `providerType` - Provider type determines request format (required)
- `model` - Model to test (uses default if not provided)
- `latencyThresholdMs` - Latency threshold in ms (default: 5000)
- `successContains` - String that must be present in response
- `timeoutMs` - Request timeout in ms (default: 10000)
- `preset` - Preset configuration ID (e.g., 'cc_base', 'cx_base')
- `customPayload` - Custom JSON payload (overrides preset)
- `customHeaders` - Custom headers to merge with defaults

**Test Results:**
- `success` - Overall success (status is green or yellow)
- `status` - "green" | "yellow" | "red"
- `subStatus` - Detailed status like "success", "slow_latency", "auth_error"
- `latencyMs` - Total request latency
- `firstByteMs` - Time to first byte
- `httpStatusCode` - HTTP status code
- `content` - Response content preview (truncated to 500 chars)
- `errorMessage` - Error message (if failed)

This is more comprehensive than simple HTTP probes because it validates that the provider
API is actually working and responding correctly to AI model requests.

## Configuration

### Environment Variables

**Endpoint Probe Configuration (from probe-scheduler.ts):**

| Variable | Default | Description |
|----------|---------|-------------|
| `ENDPOINT_PROBE_INTERVAL_MS` | 60000 | Base probe interval (60 seconds) |
| `ENDPOINT_PROBE_TIMEOUT_MS` | 5000 | Probe request timeout (5 seconds) |
| `ENDPOINT_PROBE_CONCURRENCY` | 10 | Concurrent probe workers |
| `ENDPOINT_PROBE_CYCLE_JITTER_MS` | 1000 | Random delay per cycle |
| `ENDPOINT_PROBE_LOCK_TTL_MS` | 30000 | Leader lock TTL |
| `ENDPOINT_PROBE_LOG_RETENTION_DAYS` | 1 | Probe log cleanup retention |
| `ENDPOINT_PROBE_LOG_CLEANUP_BATCH_SIZE` | 10000 | Cleanup batch size |

**Smart Probe Configuration (from circuit-breaker-probe.ts):**

| Variable | Default | Description |
|----------|---------|-------------|
| `ENABLE_SMART_PROBING` | false | Enable smart probing for recovery |
| `PROBE_INTERVAL_MS` | 10000 | Smart probe interval (10 seconds) |
| `PROBE_TIMEOUT_MS` | 5000 | Smart probe timeout (5 seconds) |

**IMPORTANT:** The `.env.example` file incorrectly documents `PROBE_INTERVAL_MS` default as
30000ms (30s). The actual code default is 10000ms (10s).

**Circuit Breaker Default Configuration (from circuit-breaker-config.ts, lines 23-27):**

```typescript
export const DEFAULT_CIRCUIT_BREAKER_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 5,           // Failures before opening
  openDuration: 1800000,         // 30 minutes
  halfOpenSuccessThreshold: 2,   // Successes to close
};
```

Per-provider configuration can be customized via the database and is cached in Redis.

**NOTE:** None of these health check variables are defined in
`/Users/ding/Github/claude-code-hub/src/lib/config/env.schema.ts`. They are read directly
from `process.env` in their respective modules without Zod validation.

### Database Schema

**Provider Table (lines 230-235 in schema.ts):**

```typescript
circuitBreakerFailureThreshold: integer('circuit_breaker_failure_threshold').default(5),
circuitBreakerOpenDuration: integer('circuit_breaker_open_duration').default(1800000), // 30分钟（毫秒）
circuitBreakerHalfOpenSuccessThreshold: integer('circuit_breaker_half_open_success_threshold').default(2),
```

**Provider Endpoint Probe History:**
The system records all probe results for historical analysis and debugging.

### Redis Key Structure

**Circuit Breaker State (from circuit-breaker-state.ts):**

```
Key: circuit_breaker:state:{providerId}
Type: Hash
Fields:
  - failureCount: number
  - lastFailureTime: number | ""
  - circuitState: "closed" | "open" | "half-open"
  - circuitOpenUntil: number | ""
  - halfOpenSuccessCount: number
TTL: 86400 seconds (24 hours)
```

**Circuit Breaker Config (from circuit-breaker-config.ts):**

```
Key: circuit_breaker:config:{providerId}
Type: Hash
Fields:
  - failureThreshold: number
  - openDuration: number
  - halfOpenSuccessThreshold: number
TTL: NO TTL (permanent, commented out at line 125)
```

**Probe Scheduler Lock:**

```
Key: locks:endpoint-probe-scheduler
```

## Health Check Endpoints

### 1. Basic Health Endpoint

**File:** `/Users/ding/Github/claude-code-hub/src/app/api/actions/[...route]/route.ts` (lines
1799-1806)

```typescript
// 健康检查端点
app.get("/health", (c) =>
  c.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    version: "1.0.0",
  })
);
```

**URL:** `GET /api/actions/health`

**Response:**

```json
{
  "status": "ok",
  "timestamp": "2025-01-29T12:00:00.000Z",
  "version": "1.0.0"
}
```

This endpoint is used by Docker health checks and load balancers.

### 2. Provider Health Status API

**File:** `/Users/ding/Github/claude-code-hub/src/actions/providers.ts` (lines 913-956)

**Action:** `getProvidersHealthStatus`

**Access:** Admin only

**Response Format:**

```typescript
Record<number, {
  circuitState: "closed" | "open" | "half-open";
  failureCount: number;
  lastFailureTime: number | null;
  circuitOpenUntil: number | null;
  recoveryMinutes: number | null;  // Minutes until recovery attempt
}>
```

### 3. Availability Query API

**File:** `/Users/ding/Github/claude-code-hub/src/app/api/availability/route.ts`

**URL:** `GET /api/availability`

**Query Parameters:**
- `startTime` - ISO string, default: 24h ago
- `endTime` - ISO string, default: now
- `providerIds` - Comma-separated IDs, default: all
- `bucketSizeMinutes` - Time bucket size, supports sub-minute (0.25 min = 15 sec minimum)
- `includeDisabled` - Include disabled providers, default: false
- `maxBuckets` - Max time buckets, default: 100

**Response:** `AvailabilityQueryResult` with provider summaries and time buckets

### 4. Current Status API

**File:** `/Users/ding/Github/claude-code-hub/src/app/api/availability/current/route.ts`

**URL:** `GET /api/availability/current`

Returns lightweight current status for all enabled providers based on last 15 minutes of
data.

## Health Status Reporting and Dashboards

### 1. Provider Settings Page

**File:**
`/Users/ding/Github/claude-code-hub/src/app/[locale]/settings/providers/_components/provider-list-item.legacy.tsx`

Health status is displayed as badges:
- **Open Circuit (熔断中)** - Red destructive badge with recovery time countdown, manual
reset button
- **Half-Open (恢复中)** - Yellow secondary badge
- **No badge** - Closed (healthy)

**Manual Reset:** Administrators can manually reset the circuit breaker via a confirmation
dialog (lines 124-147, 221-265).

### 2. Availability Dashboard

**File:**
`/Users/ding/Github/claude-code-hub/src/app/[locale]/dashboard/availability/_components/availability-view.tsx`

**Features:**
- Summary cards: System availability, healthy/unhealthy/unknown counts
- Time range selection: 15min, 1h, 6h, 24h, 7d
- Heatmap visualization showing availability over time
- Color coding:
  - Green: >= 95% availability
  - Lime: 80-95% availability
  - Orange: 50-80% availability
  - Red: < 50% availability
  - Gray: No data

**Tooltip Information:**
- Time bucket
- Total requests
- Availability percentage
- Average latency
- Green/Red request counts

### 3. Provider Manager Dashboard

**File:**
`/Users/ding/Github/claude-code-hub/src/app/[locale]/settings/providers/_components/provider-manager.tsx`

Displays:
- Count of providers with open circuits
- Filter to show only unhealthy providers
- Real-time health status updates via React Query

## Automatic Failover

### 1. Provider Selection Flow

When routing requests, the system filters providers through multiple stages.

**File:** `/Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/provider-selector.ts`

**Health Filtering (lines 864-868):**

```typescript
context.beforeHealthCheck = candidateProviders.length;
const healthyProviders = await ProxyProviderResolver.filterByLimits(candidateProviders);
context.afterHealthCheck = healthyProviders.length;
```

The `filterByLimits` function checks:
1. Circuit breaker state (excludes OPEN providers)
2. Rate limits (5h, daily, weekly, monthly spending)
3. Total cost limit

**Concurrent session limits are checked separately** in the `ensure()` method to avoid race
conditions.

### 2. Failover Strategy

If the selected provider fails during a request:

1. **Failure recorded** - `recordFailure()` increments failure count
2. **Circuit check** - If threshold reached, circuit opens
3. **Retry with fallback** - Request can be retried with next provider in chain
4. **Alert triggered** - Webhook notification sent on circuit open

### 3. Recovery Flow

When a provider in OPEN state is probed successfully:

1. **Smart probe succeeds** - `tripToHalfOpen()` transitions to HALF-OPEN
2. **Limited traffic** - Real requests gradually test the provider
3. **Success tracking** - Each success increments `halfOpenSuccessCount`
4. **Full recovery** - After threshold successes, circuit closes

## Edge Cases

### 1. Redis Unavailability

**Behavior:** The system degrades gracefully when Redis is unavailable:
- Circuit breaker operates in memory-only mode
- State is not shared across instances
- State is lost on restart
- Configuration falls back to database on cache miss

**Code:** `/Users/ding/Github/claude-code-hub/src/lib/circuit-breaker.ts` (lines 76-136)

**Redis Client Configuration (`client.ts`):**
- `enableOfflineQueue: false` - Fast fail strategy
- `maxRetriesPerRequest: 3` - Limited retries
- `retryStrategy` - Exponential backoff, stops after 5 retries

### 2. Multiple Instance Coordination

**Leader Election:** Only one instance runs the probe scheduler:
- Uses Redis-based distributed locking
- Lock TTL: 30 seconds (configurable via `ENDPOINT_PROBE_LOCK_TTL_MS`)
- Keep-alive renews lock every 15 seconds
- If leadership lost, probing stops immediately

**State Synchronization:**
- Circuit states are persisted to Redis immediately on change
- Other instances check Redis before using cached state
- Batch loading on startup for efficiency

### 3. Configuration Cache

**TTL:** 5 minutes (`CONFIG_CACHE_TTL = 5 * 60 * 1000`)

**Invalidation:**
- Automatic on TTL expiration
- Manual via `clearConfigCache(providerId)` when provider updated

### 4. No Data Scenarios

**Availability Dashboard:**
- Status is `unknown` (not `green`) when no request data exists
- This is intentional to avoid falsely reporting healthy status

**Circuit Breaker:**
- New providers start in CLOSED state with zero failures
- No historical data needed for operation

### 5. Timeout Handling

**Probe Timeouts:**
- Default: 5 seconds
- Endpoints with timeout errors get probed more frequently (10s interval)
- This accelerates detection of recovery from timeout conditions

**Request Timeouts:**
- Configurable per provider
- Do NOT trigger circuit breaker (only failures do)

### 6. SSL and Protocol Errors

**Agent Pool Behavior:**
- SSL certificate errors mark agent as unhealthy (forwarder.ts line 1683)
- HTTP/2 protocol errors mark agent as unhealthy (forwarder.ts line 1806)
- New agent created on next request
- Does NOT affect circuit breaker state directly

**Detection Patterns:**
- SSL errors: "certificate", "ssl", "tls", "cert_", "self signed", "hostname mismatch",
"unable_to_get_issuer_cert", "cert_has_expired", etc.
- HTTP/2 errors: "GOAWAY", "RST_STREAM", "PROTOCOL_ERROR", "HTTP/2", "ERR_HTTP2_",
"NGHTTP2_", "HTTP_1_1_REQUIRED", "REFUSED_STREAM"

### 7. Provider Deletion and Cleanup

When a provider is deleted, the system performs cleanup.

**Circuit Breaker Cleanup (lines 619-632):**

```typescript
export async function clearProviderState(providerId: number): Promise<void> {
  // 清除内存状态
  healthMap.delete(providerId);
  loadedFromRedis.delete(providerId);

  // 清除 Redis 状态
  const { deleteCircuitState } = await import("@/lib/redis/circuit-breaker-state");
  await deleteCircuitState(providerId);

  logger.info(`[CircuitBreaker] Cleared all state for provider ${providerId}`, {
    providerId,
  });
}
```

**Usage:**
- Line 754 in `removeProvider()` - properly awaited
- Line 1101 in `batchDeleteProviders()` - **NOT awaited** (fire-and-forget)

**ISSUE:** In `batchDeleteProviders()`, `clearProviderState(id)` is called without `await`,
which could lead to incomplete cleanup if the process exits before async operations
complete.

This ensures that:
- Memory is freed
- Redis keys are removed
- No stale state remains for deleted providers

### 8. Circuit Breaker State Persistence Strategy

The system uses a dual-layer persistence strategy.

**Layer 1: In-Memory (Primary)**
- Fast access during request processing
- No network latency
- Lost on process restart
- `healthMap: Map<number, ProviderHealth>` (line 44)
- `loadedFromRedis: Set<number>` (line 50)

**Layer 2: Redis (Backup)**
- Shared across instances
- Survives process restarts
- 24-hour TTL on state keys
- Config keys have NO TTL (permanent)

**Sync Strategy:**
- Write-through: Every state change is written to Redis immediately
- Lazy read: Only check Redis when state is needed and not in memory, or when in
non-closed state
- Batch load: On admin dashboard queries, load all states in parallel

### 9. Health Check Metrics and Observability

The system provides multiple ways to observe health check behavior.

**Logs:**
- Circuit state transitions with provider ID and timestamp
- Probe results with latency and status
- Failure counts and threshold breaches
- Recovery attempts and success counts

**Metrics Available:**
- Circuit breaker state distribution (closed/open/half-open counts)
- Probe success/failure rates by endpoint
- Average probe latency
- Time to recovery after circuit open

**Debug Endpoints:**
The probe scheduler status can be queried programmatically (lines 339-363):

```typescript
export function getEndpointProbeSchedulerStatus(): {
  started: boolean;
  running: boolean;
  baseIntervalMs: number;
  singleVendorIntervalMs: number;
  timeoutOverrideIntervalMs: number;
  tickIntervalMs: number;
  timeoutMs: number;
  concurrency: number;
  jitterMs: number;
  lockTtlMs: number;
}
```

### 10. Handling Flapping Providers

**NOT IMPLEMENTED**

No flapping detection mechanism exists in the codebase. The system does NOT:
- Track state transition frequency
- Detect rapid open/close cycles
- Have special handling for providers that flap between states

The circuit breaker only tracks:
- `failureCount` - Consecutive failures
- `halfOpenSuccessCount` - Successes in half-open state
- `circuitState` - Current state (closed/open/half-open)

**Circuit Breaker Cooldown:**
- Once opened, the circuit stays open for a configurable duration (default: 30 minutes)
- This prevents rapid oscillation between open and closed states

**Half-Open State:**
- Acts as a buffer between open and closed
- Requires multiple consecutive successes before closing (default: 2)
- Single failure reopens the circuit

### 11. Startup Behavior

When the application starts:

**Circuit Breaker Initialization:**
1. Memory map is empty
2. On first request to a provider, state is loaded from Redis
3. If no Redis state exists, provider starts in CLOSED state
4. Configuration is loaded from database and cached

**Probe Scheduler Startup:**
1. Scheduler starts on application initialization
2. Attempts to acquire leader lock
3. If leader, begins probe cycles
4. If not leader, waits (other instances handle probing)

**Config Preloading:**

```typescript
export async function loadAllProvidersCircuitConfig(): Promise<void>
```

This optional startup step preloads all provider configurations into Redis for faster
access.

## Summary of Corrections from Round 1

### Major Corrections

1. **Provider Testing Service:** Only Completion Test is implemented. Connection Test and
Model List Test are NOT separate implementations.

2. **filterByLimits:** Does NOT check concurrent session limits. These are checked
atomically in the `ensure()` method to avoid race conditions.

3. **PROBE_INTERVAL_MS Default:** The `.env.example` documents 30000ms (30s) but the actual
code default is 10000ms (10s).

4. **Flapping Detection:** NOT implemented. The round1 draft described flapping handling
that does not exist in the codebase.

5. **Availability Score:** Uses simple ratio `greenCount / total`, NOT the
`AVAILABILITY_WEIGHTS` constant that exists in types.ts.

### Minor Corrections

1. **Config TTL:** Circuit breaker config keys have NO TTL (commented out), while state keys
expire after 24 hours.

2. **clearProviderState in Batch Deletion:** Called without `await` in
`batchDeleteProviders()`, which could cause incomplete cleanup.

3. **Environment Variables:** None of the health check variables are validated in
`env.schema.ts` - they are read directly from `process.env`.

4. **Additional Environment Variables:** Several variables were not documented in round1:
   - `ENDPOINT_PROBE_LOCK_TTL_MS` (default: 30000)
   - `ENDPOINT_PROBE_LOG_RETENTION_DAYS` (default: 1)
   - `ENDPOINT_PROBE_LOG_CLEANUP_BATCH_SIZE` (default: 10000)

## References

### Core Files

| File | Purpose |
|------|---------|
| `/Users/ding/Github/claude-code-hub/src/lib/circuit-breaker.ts` | Main circuit breaker implementation |
| `/Users/ding/Github/claude-code-hub/src/lib/endpoint-circuit-breaker.ts` | Endpoint-level circuit breaker |
| `/Users/ding/Github/claude-code-hub/src/lib/circuit-breaker-probe.ts` | Smart probing for recovery |
| `/Users/ding/Github/claude-code-hub/src/lib/provider-endpoints/probe.ts` | HTTP endpoint probing |
| `/Users/ding/Github/claude-code-hub/src/lib/provider-endpoints/probe-scheduler.ts` | Probe scheduling and coordination |
| `/Users/ding/Github/claude-code-hub/src/lib/provider-endpoints/leader-lock.ts` | Redis leader election |
| `/Users/ding/Github/claude-code-hub/src/lib/availability/availability-service.ts` | Availability calculation from request logs |
| `/Users/ding/Github/claude-code-hub/src/lib/availability/types.ts` | Availability type definitions |
| `/Users/ding/Github/claude-code-hub/src/lib/redis/circuit-breaker-state.ts` | Redis persistence for circuit states |
| `/Users/ding/Github/claude-code-hub/src/lib/redis/circuit-breaker-config.ts` | Redis caching for configurations |
| `/Users/ding/Github/claude-code-hub/src/lib/redis/client.ts` | Redis client configuration |
| `/Users/ding/Github/claude-code-hub/src/lib/proxy-agent/agent-pool.ts` | Connection pool health management |
| `/Users/ding/Github/claude-code-hub/src/lib/provider-testing/test-service.ts` | Provider testing service |
| `/Users/ding/Github/claude-code-hub/src/lib/notification/notifier.ts` | Circuit breaker alert notifications |
| `/Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/forwarder.ts` | SSL/HTTP2 error detection |
| `/Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/errors.ts` | Error classification functions |

### API Routes

| File | Endpoint |
|------|----------|
| `/Users/ding/Github/claude-code-hub/src/app/api/actions/[...route]/route.ts` | `/api/actions/health` |
| `/Users/ding/Github/claude-code-hub/src/app/api/availability/route.ts` | `/api/availability` |
| `/Users/ding/Github/claude-code-hub/src/app/api/availability/current/route.ts` | `/api/availability/current` |

### UI Components

| File | Purpose |
|------|---------|
| `/Users/ding/Github/claude-code-hub/src/app/[locale]/settings/providers/_components/provider-list-item.legacy.tsx` | Provider health status display |
| `/Users/ding/Github/claude-code-hub/src/app/[locale]/settings/providers/_components/provider-rich-list-item.tsx` | Rich provider list with health |
| `/Users/ding/Github/claude-code-hub/src/app/[locale]/dashboard/availability/_components/availability-view.tsx` | Availability heatmap dashboard |
| `/Users/ding/Github/claude-code-hub/src/app/[locale]/dashboard/availability/_components/availability-dashboard.tsx` | Dashboard container |

### Actions

| File | Function |
|------|----------|
| `/Users/ding/Github/claude-code-hub/src/actions/providers.ts` | `getProvidersHealthStatus`, `resetProviderCircuit`, `removeProvider`, `batchDeleteProviders` |
| `/Users/ding/Github/claude-code-hub/src/actions/provider-endpoints.ts` | `getEndpointHealthInfo` |

### Database Schema

| File | Purpose |
|------|---------|
| `/Users/ding/Github/claude-code-hub/src/drizzle/schema.ts` | Provider table with circuit breaker fields |

---

*This document is a Round 2 verified draft for the provider health check system in
claude-code-hub. All code snippets and file paths have been verified against the actual
implementation.*
