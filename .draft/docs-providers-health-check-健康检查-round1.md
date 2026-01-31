# Provider Health Check - Round 1 Exploration Draft

## Intent Analysis

The provider health check system in claude-code-hub serves a critical role in maintaining service reliability by continuously monitoring the health of AI model providers (like Claude, OpenAI, etc.) and automatically managing their availability. The system is designed to:

1. **Detect provider failures early** - Through continuous probing and request monitoring
2. **Prevent cascading failures** - Using circuit breaker patterns to stop sending requests to unhealthy providers
3. **Enable automatic recovery** - Through smart probing and gradual reintroduction of recovered providers
4. **Provide visibility** - Via real-time dashboards and health status indicators
5. **Support manual intervention** - Allowing administrators to reset circuit breakers when needed

The health check system operates at multiple levels: endpoint-level probing (HTTP health checks), provider-level circuit breakers (based on request failures), and agent-level health management (for connection pooling).

## Behavior Summary

### 1. Circuit Breaker State Machine

The core health check mechanism is built around a three-state circuit breaker pattern implemented in `/Users/ding/Github/claude-code-hub/src/lib/circuit-breaker.ts`:

**States:**
- **Closed** - Normal operation, requests flow through
- **Open** - Provider is unhealthy, requests are blocked
- **Half-Open** - Testing recovery, limited requests allowed

**State Transitions:**

```
Closed ──[failureCount >= threshold]──> Open ──[timeout expires]──> Half-Open
  ^                                          |
  └────────[successCount >= threshold]───────┘
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

The endpoint probe system (`/Users/ding/Github/claude-code-hub/src/lib/provider-endpoints/probe.ts`) performs active health checks on provider endpoints:

**Probe Method:**
- First attempts a `HEAD` request (faster, no body)
- Falls back to `GET` if `HEAD` fails or returns no status
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

**Error Types:**
- `timeout` - Request exceeded timeout limit
- `network_error` - Connection failure, DNS error, etc.
- `invalid_url` - URL parsing failure
- `http_5xx` - Server error (5xx status codes)
- `unknown_error` - Unexpected errors

### 3. Probe Scheduler

The probe scheduler (`/Users/ding/Github/claude-code-hub/src/lib/provider-endpoints/probe-scheduler.ts`) manages periodic health checks:

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

### 4. Smart Probing for Recovery

The smart probe system (`/Users/ding/Github/claude-code-hub/src/lib/circuit-breaker-probe.ts`) accelerates recovery detection:

**Purpose:** When a provider's circuit is OPEN, the system periodically probes it to detect when it recovers, rather than waiting for the full timeout period.

**Configuration:**
- `ENABLE_SMART_PROBING` - Enable/disable (default: false)
- `PROBE_INTERVAL_MS` - Probe interval (default: 10000ms = 10s)
- `PROBE_TIMEOUT_MS` - Request timeout (default: 5000ms = 5s)

**Behavior:**
- Only probes providers in OPEN state
- On success, transitions circuit to HALF-OPEN immediately
- Uses actual provider test requests (not just HTTP probes)
- Caches provider configs for 1 minute to reduce database load

### 5. Availability Monitoring

The availability service (`/Users/ding/Github/claude-code-hub/src/lib/availability/availability-service.ts`) calculates provider health based on actual request history:

**Status Classification (lines 27-52):**
```typescript
export function classifyRequestStatus(statusCode: number | null): RequestStatusClassification {
  if (statusCode === null) {
    return { status: "red", isSuccess: false, isError: true };  // Network error
  }
  if (statusCode >= 400) {
    return { status: "red", isSuccess: false, isError: true };  // HTTP error
  }
  return { status: "green", isSuccess: true, isError: false }; // Success (2xx/3xx)
}
```

**Current Status Determination (lines 291-301):**
- Analyzes last 3 time buckets (recent history)
- Status is `unknown` if no data available (important: does NOT assume healthy)
- `green` if >= 50% success rate
- `red` if < 50% success rate

**Availability Score:**
```
availabilityScore = greenCount / (greenCount + redCount)
```

### 6. Endpoint Circuit Breaker

A separate circuit breaker for individual endpoints (`/Users/ding/Github/claude-code-hub/src/lib/endpoint-circuit-breaker.ts`):

**Default Configuration:**
```typescript
export const DEFAULT_ENDPOINT_CIRCUIT_BREAKER_CONFIG: EndpointCircuitBreakerConfig = {
  failureThreshold: 3,           // Open after 3 failures
  openDuration: 300000,          // 5 minutes
  halfOpenSuccessThreshold: 1,   // Close after 1 success
};
```

This is more aggressive than the provider-level circuit breaker, designed for faster failover at the endpoint level.

### 7. Agent Pool Health Management

The agent pool (`/Users/ding/Github/claude-code-hub/src/lib/proxy-agent/agent-pool.ts`) manages HTTP connection health:

**Health Features:**
- Agents marked as unhealthy on SSL certificate errors
- Agents marked as unhealthy on HTTP/2 protocol errors
- Unhealthy agents are replaced on next request
- Tracks unhealthy agent count in pool statistics

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

### 8. Circuit Breaker Alert Notifications

When a circuit breaker opens, the system can send webhook notifications to alert administrators:

**Implementation:** `/Users/ding/Github/claude-code-hub/src/lib/circuit-breaker.ts` (lines 285-329)

**Alert Content:**
- Provider name and ID
- Failure count that triggered the open
- Timestamp when retry will be attempted
- Last error message

**Webhook Configuration:**
The webhook URL is read from system configuration. The notification is sent asynchronously to avoid blocking the request flow.

**Code Flow:**
1. `recordFailure()` detects threshold reached
2. `triggerCircuitBreakerAlert()` is called asynchronously
3. Provider details are fetched from database
4. Webhook payload is constructed and sent
5. Errors in alert sending are logged but don't affect circuit breaker operation

### 9. Health Check Integration with Provider Selection

The health check system is tightly integrated with the provider selection logic. When a request comes in, the system goes through multiple filtering stages:

**File:** `/Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/provider-selector.ts`

**Selection Pipeline:**
1. **Type Filter** - Filter by provider type (Claude, OpenAI, etc.)
2. **Model Filter** - Filter by supported models
3. **Health Filter** - Remove providers with open circuits or exceeded limits
4. **Priority Selection** - Select from highest priority group
5. **Weight-based Random** - Random selection weighted by provider weights

**Decision Context Tracking (lines 245-246, 864-872):**
```typescript
context.beforeHealthCheck = candidateProviders.length;
const healthyProviders = await ProxyProviderResolver.filterByLimits(candidateProviders);
context.afterHealthCheck = healthyProviders.length;
```

This tracking enables the decision chain visualization in the logs, showing how many providers were filtered out at each stage.

**Health Filtering Logic:**
The `filterByLimits` function in the provider resolver checks multiple health indicators:
- Circuit breaker state (excludes OPEN providers)
- 5-hour spending limit
- Weekly spending limit
- Monthly spending limit
- Concurrent session limit

If any limit is exceeded, the provider is excluded from selection.

### 10. Provider Testing Service

The smart probing system uses a dedicated provider testing service (`/Users/ding/Github/claude-code-hub/src/lib/provider-testing/test-service.ts`) to perform actual API calls against providers:

**Test Types:**
- **Connection Test** - Simple HTTP probe to check connectivity
- **Model List Test** - Fetch available models from provider
- **Completion Test** - Send a minimal completion request

**Test Execution:**
```typescript
export async function executeProviderTest(params: {
  providerUrl: string;
  apiKey: string;
  providerType: ProviderType;
  timeoutMs?: number;
}): Promise<ProviderTestResult>
```

The test service handles different provider types (Claude, OpenAI, Gemini, etc.) with appropriate request formats for each.

**Test Results:**
- Success/failure status
- Latency measurement
- HTTP status code
- Error details on failure

This is more comprehensive than simple HTTP probes because it validates that the provider API is actually working and responding correctly to AI model requests.

## Configuration

### Environment Variables

**Endpoint Probe Configuration:**

| Variable | Default | Description |
|----------|---------|-------------|
| `ENDPOINT_PROBE_INTERVAL_MS` | 60000 | Base probe interval (60 seconds) |
| `ENDPOINT_PROBE_TIMEOUT_MS` | 5000 | Probe request timeout (5 seconds) |
| `ENDPOINT_PROBE_CONCURRENCY` | 10 | Concurrent probe workers |
| `ENDPOINT_PROBE_CYCLE_JITTER_MS` | 1000 | Random delay per cycle |
| `ENDPOINT_PROBE_LOCK_TTL_MS` | 30000 | Leader lock TTL |

**Smart Probe Configuration:**

| Variable | Default | Description |
|----------|---------|-------------|
| `ENABLE_SMART_PROBING` | false | Enable smart probing for recovery |
| `PROBE_INTERVAL_MS` | 10000 | Smart probe interval (10 seconds) |
| `PROBE_TIMEOUT_MS` | 5000 | Smart probe timeout (5 seconds) |

**Circuit Breaker Default Configuration:**

```typescript
export const DEFAULT_CIRCUIT_BREAKER_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 5,           // Failures before opening
  openDuration: 1800000,         // 30 minutes
  halfOpenSuccessThreshold: 2,   // Successes to close
};
```

Per-provider configuration can be customized via the database and is cached in Redis.

### Database Schema

**Provider Table (relevant fields):**
```sql
circuit_breaker_failure_threshold INTEGER DEFAULT 5,
circuit_breaker_open_duration INTEGER DEFAULT 1800000,
circuit_breaker_half_open_success_threshold INTEGER DEFAULT 2,
```

**Provider Endpoint Probe History:**
The system records all probe results for historical analysis and debugging.

### Redis Key Structure

**Circuit Breaker State:**
```
Key: circuit_breaker:state:{providerId}
Fields:
  - failureCount: number
  - lastFailureTime: number | ""
  - circuitState: "closed" | "open" | "half-open"
  - circuitOpenUntil: number | ""
  - halfOpenSuccessCount: number
TTL: 86400 seconds (24 hours)
```

**Circuit Breaker Config:**
```
Key: circuit_breaker:config:{providerId}
Fields:
  - failureThreshold: number
  - openDuration: number
  - halfOpenSuccessThreshold: number
```

**Probe Scheduler Lock:**
```
Key: locks:endpoint-probe-scheduler
```

## Health Check Endpoints

### 1. Basic Health Endpoint

**File:** `/Users/ding/Github/claude-code-hub/src/app/api/actions/[...route]/route.ts` (lines 1799-1806)

```typescript
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
- `bucketSizeMinutes` - Time bucket size, default: auto
- `includeDisabled` - Include disabled providers, default: false
- `maxBuckets` - Max time buckets, default: 100

**Response:** `AvailabilityQueryResult` with provider summaries and time buckets

### 4. Current Status API

**File:** `/Users/ding/Github/claude-code-hub/src/app/api/availability/current/route.ts`

**URL:** `GET /api/availability/current`

Returns lightweight current status for all enabled providers based on last 15 minutes of data.

## Health Status Reporting and Dashboards

### 1. Provider Settings Page

**File:** `/Users/ding/Github/claude-code-hub/src/app/[locale]/settings/providers/_components/provider-list-item.legacy.tsx`

Health status is displayed as badges:
- **🔴 熔断中 (Open)** - Red badge with recovery time countdown
- **🟡 恢复中 (Half-Open)** - Yellow badge
- **No badge** - Closed (healthy)

**Manual Reset:** Administrators can manually reset the circuit breaker via a confirmation dialog (lines 221-255).

### 2. Availability Dashboard

**File:** `/Users/ding/Github/claude-code-hub/src/app/[locale]/dashboard/availability/_components/availability-view.tsx`

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

**File:** `/Users/ding/Github/claude-code-hub/src/app/[locale]/settings/providers/_components/provider-manager.tsx`

Displays:
- Count of providers with open circuits
- Filter to show only unhealthy providers
- Real-time health status updates via React Query

## Automatic Failover

### 1. Provider Selection Flow

When routing requests, the system filters providers through multiple stages:

**File:** `/Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/provider-selector.ts`

**Health Filtering (lines 864-872):**
```typescript
context.beforeHealthCheck = candidateProviders.length;
const healthyProviders = await ProxyProviderResolver.filterByLimits(candidateProviders);
context.afterHealthCheck = healthyProviders.length;
```

The `filterByLimits` function checks:
1. Circuit breaker state (excludes OPEN providers)
2. Rate limits (5h, weekly, monthly spending)
3. Concurrent session limits

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

### 2. Multiple Instance Coordination

**Leader Election:** Only one instance runs the probe scheduler:
- Uses Redis-based distributed locking
- Lock TTL: 30 seconds (configurable)
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
- SSL certificate errors mark agent as unhealthy
- HTTP/2 protocol errors mark agent as unhealthy
- New agent created on next request
- Does NOT affect circuit breaker state directly

### 7. Provider Deletion and Cleanup

When a provider is deleted, the system performs cleanup:

**Circuit Breaker Cleanup:**
```typescript
export async function clearProviderState(providerId: number): Promise<void> {
  // Clear memory state
  healthMap.delete(providerId);
  loadedFromRedis.delete(providerId);

  // Clear Redis state
  const { deleteCircuitState } = await import("@/lib/redis/circuit-breaker-state");
  await deleteCircuitState(providerId);
}
```

This ensures that:
- Memory is freed
- Redis keys are removed
- No stale state remains for deleted providers

### 8. Circuit Breaker State Persistence Strategy

The system uses a dual-layer persistence strategy:

**Layer 1: In-Memory (Primary)**
- Fast access during request processing
- No network latency
- Lost on process restart

**Layer 2: Redis (Backup)**
- Shared across instances
- Survives process restarts
- 24-hour TTL on state keys

**Sync Strategy:**
- Write-through: Every state change is written to Redis immediately
- Lazy read: Only check Redis when state is needed and not in memory, or when in non-closed state
- Batch load: On admin dashboard queries, load all states in parallel

### 9. Health Check Metrics and Observability

The system provides multiple ways to observe health check behavior:

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
The probe scheduler status can be queried programmatically:
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

A "flapping" provider is one that rapidly switches between healthy and unhealthy states. The system has several mechanisms to handle this:

**Circuit Breaker Cooldown:**
- Once opened, the circuit stays open for a configurable duration (default: 30 minutes)
- This prevents rapid oscillation between open and closed states

**Half-Open State:**
- Acts as a buffer between open and closed
- Requires multiple consecutive successes before closing (default: 2)
- Single failure reopens the circuit

**Success Count Reset:**
- In closed state, a single success resets the failure count to zero
- This allows providers to recover quickly after intermittent failures

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

This optional startup step preloads all provider configurations into Redis for faster access.

## References

### Core Files

| File | Purpose |
|------|---------|
| `/Users/ding/Github/claude-code-hub/src/lib/circuit-breaker.ts` | Main circuit breaker implementation |
| `/Users/ding/Github/claude-code-hub/src/lib/endpoint-circuit-breaker.ts` | Endpoint-level circuit breaker |
| `/Users/ding/Github/claude-code-hub/src/lib/circuit-breaker-probe.ts` | Smart probing for recovery |
| `/Users/ding/Github/claude-code-hub/src/lib/provider-endpoints/probe.ts` | HTTP endpoint probing |
| `/Users/ding/Github/claude-code-hub/src/lib/provider-endpoints/probe-scheduler.ts` | Probe scheduling and coordination |
| `/Users/ding/Github/claude-code-hub/src/lib/availability/availability-service.ts` | Availability calculation from request logs |
| `/Users/ding/Github/claude-code-hub/src/lib/availability/types.ts` | Availability type definitions |
| `/Users/ding/Github/claude-code-hub/src/lib/redis/circuit-breaker-state.ts` | Redis persistence for circuit states |
| `/Users/ding/Github/claude-code-hub/src/lib/redis/circuit-breaker-config.ts` | Redis caching for configurations |
| `/Users/ding/Github/claude-code-hub/src/lib/proxy-agent/agent-pool.ts` | Connection pool health management |

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
| `/Users/ding/Github/claude-code-hub/src/actions/providers.ts` | `getProvidersHealthStatus`, `resetProviderCircuit` |
| `/Users/ding/Github/claude-code-hub/src/actions/provider-endpoints.ts` | `getEndpointHealthInfo` |

---

*This document is a Round 1 exploration draft for the provider health check system in claude-code-hub. It covers the circuit breaker pattern, endpoint probing, availability monitoring, and health status reporting.*
