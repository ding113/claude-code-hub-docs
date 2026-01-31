# Provider Availability Monitoring - Round 1 Exploration Draft

**Status**: Exploration Draft
**Word Count**: ~5,200 words
**Scope**: Provider availability monitoring, health checks, circuit breakers, and probe systems

---

## Intent Analysis

The availability monitoring system in claude-code-hub serves a critical purpose: ensuring that AI providers are healthy and routing traffic only to available endpoints. The system addresses several key concerns:

1. **Health Detection**: Determining whether a provider is currently able to serve requests
2. **Failure Isolation**: Preventing cascading failures by stopping traffic to unhealthy providers
3. **Automatic Recovery**: Detecting when providers recover and gradually restoring traffic
4. **Observability**: Providing visibility into provider health through dashboards and metrics
5. **Cost Protection**: Preventing runaway costs by limiting spend per provider

The system uses a multi-layered approach combining request-log-based availability scoring, active endpoint probing, circuit breakers for failure isolation, and cost-based rate limiting.

---

## Behavior Summary

### Core Availability Monitoring

The availability monitoring system uses a **simple two-tier classification** based on HTTP status codes from request logs:

- **GREEN (1.0)**: HTTP 2xx/3xx responses - successful requests
- **RED (0.0)**: HTTP 4xx/5xx responses or network errors - failed requests
- **UNKNOWN (-1)**: No data available - honest reporting without assumptions

This classification is implemented in `/Users/ding/Github/claude-code-hub/src/lib/availability/availability-service.ts`:

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

  // HTTP success (2xx/3xx) - all successful requests are green
  return { status: "green", isSuccess: true, isError: false };
}
```

**Critical Design Decision**: The system explicitly uses "unknown" status when no data exists, rather than assuming healthy. This honesty principle appears throughout the codebase:

```typescript
// From /Users/ding/Github/claude-code-hub/src/lib/availability/availability-service.ts:429-436
// IMPORTANT: No data = 'unknown', NOT 'green'! Must be honest.
let status: AvailabilityStatus = "unknown";
if (total === 0) {
  status = "unknown"; // No data - must be honest, don't assume healthy!
} else {
  // Simple: >= 50% success = green, otherwise red
  status = availability >= 0.5 ? "green" : "red";
}
```

### Availability Score Calculation

The availability score is calculated as a simple ratio:

```typescript
export function calculateAvailabilityScore(greenCount: number, redCount: number): number {
  const total = greenCount + redCount;
  if (total === 0) return 0;
  return greenCount / total;
}
```

A provider is considered "green" (healthy) when its availability score is >= 0.5 (50% success rate) over the evaluation window.

### Time Bucketing

Availability data is aggregated into time buckets for visualization and analysis. The system automatically determines optimal bucket sizes:

```typescript
export function determineOptimalBucketSize(
  _totalRequests: number,
  timeRangeMinutes: number
): number {
  const targetBuckets = 50;
  const idealBucketMinutes = timeRangeMinutes / targetBuckets;
  const standardSizes = [1, 5, 15, 60, 1440]; // 1min, 5min, 15min, 1hour, 1day

  for (const size of standardSizes) {
    if (idealBucketMinutes <= size) {
      return size;
    }
  }
  return 1440;
}
```

The minimum bucket size is 0.25 minutes (15 seconds) to prevent division by zero.

---

## Configuration and Commands

### Environment Variables

The availability and probing system is controlled through several environment variables:

**Probe Scheduler Configuration** (from `/Users/ding/Github/claude-code-hub/src/lib/provider-endpoints/probe-scheduler.ts`):

| Variable | Default | Description |
|----------|---------|-------------|
| `ENDPOINT_PROBE_INTERVAL_MS` | 60000 | Base probe interval in milliseconds |
| `ENDPOINT_PROBE_TIMEOUT_MS` | 5000 | Probe request timeout |
| `ENDPOINT_PROBE_CONCURRENCY` | 10 | Number of concurrent probe workers |
| `ENDPOINT_PROBE_CYCLE_JITTER_MS` | 1000 | Random delay per cycle to prevent thundering herd |
| `ENDPOINT_PROBE_LOCK_TTL_MS` | 30000 | Leader lock TTL for distributed scheduling |

**Smart Probe Configuration** (from `/Users/ding/Github/claude-code-hub/src/lib/circuit-breaker-probe.ts`):

| Variable | Default | Description |
|----------|---------|-------------|
| `ENABLE_SMART_PROBING` | false | Enable automatic probing of OPEN circuits |
| `PROBE_INTERVAL_MS` | 10000 | Interval between smart probe cycles |
| `PROBE_TIMEOUT_MS` | 5000 | Timeout for each smart probe |

**Circuit Breaker Configuration** (from `/Users/ding/Github/claude-code-hub/src/lib/redis/circuit-breaker-config.ts`):

| Variable | Default | Description |
|----------|---------|-------------|
| `failureThreshold` | 5 | Failures before opening circuit |
| `openDuration` | 1800000 (30 min) | Duration to keep circuit open |
| `halfOpenSuccessThreshold` | 2 | Successes needed to close from half-open |

### API Endpoints

**GET /api/availability** - Query historical availability data

Query parameters:
- `startTime`: ISO string (default: 24h ago)
- `endTime`: ISO string (default: now)
- `providerIds`: Comma-separated IDs (default: all)
- `bucketSizeMinutes`: Number (default: auto, min: 0.25)
- `includeDisabled`: Boolean (default: false)
- `maxBuckets`: Number (default: 100)

**GET /api/availability/current** - Get current status (last 15 minutes)

Returns array of provider statuses with availability scores.

**GET /api/availability/endpoints** - List endpoints by vendor and type

Query parameters:
- `vendorId`: Required, vendor ID
- `providerType`: Required, one of claude, claude-auth, codex, gemini, gemini-cli, openai-compatible

**GET /api/availability/endpoints/probe-logs** - Get probe logs for an endpoint

Query parameters:
- `endpointId`: Required
- `limit`: Number (default: 200, max: 1000)
- `offset`: Number (default: 0)

---

## Architecture Components

### 1. Circuit Breaker State Machine

The circuit breaker implements a classic three-state pattern in `/Users/ding/Github/claude-code-hub/src/lib/circuit-breaker.ts`:

**CLOSED State** (Normal Operation):
- Requests flow through normally
- Failures are counted
- Successes reset failure count

**OPEN State** (Circuit Broken):
- All requests rejected immediately
- No traffic to provider
- Auto-transitions to HALF_OPEN after `openDuration`

**HALF_OPEN State** (Recovery Testing):
- Allows limited requests through
- Requires `halfOpenSuccessThreshold` consecutive successes to close
- Any failure returns to OPEN

**State Transitions**:

```
CLOSED --[failures >= threshold]--> OPEN --[time expires]--> HALF_OPEN --[successes >= threshold]--> CLOSED
                                          ^                                    |
                                          |__________[any failure]_____________|
```

**Key Code** (from `/Users/ding/Github/claude-code-hub/src/lib/circuit-breaker.ts:203-225`):

```typescript
export async function isCircuitOpen(providerId: number): Promise<boolean> {
  const health = await getOrCreateHealth(providerId);

  if (health.circuitState === "closed") {
    return false;
  }

  if (health.circuitState === "open") {
    // Check if can transition to half-open
    if (health.circuitOpenUntil && Date.now() > health.circuitOpenUntil) {
      health.circuitState = "half-open";
      health.halfOpenSuccessCount = 0;
      persistStateToRedis(providerId, health);
      return false; // Allow trial
    }
    return true; // Still open
  }

  // half-open: allow attempt
  return false;
}
```

### 2. Endpoint Probe Scheduler

The probe scheduler uses a distributed leader-election pattern with Redis:

**Three-Tier Interval System** (from `/Users/ding/Github/claude-code-hub/src/lib/provider-endpoints/probe-scheduler.ts:22-104`):

```typescript
// Base interval (default 60s)
const BASE_INTERVAL_MS = parseIntWithDefault(process.env.ENDPOINT_PROBE_INTERVAL_MS, 60_000);

// Single-vendor interval (10 minutes) - reduced probing for sole endpoints
const SINGLE_VENDOR_INTERVAL_MS = 600_000;

// Timeout override interval (10 seconds) - aggressive retry for timeout failures
const TIMEOUT_OVERRIDE_INTERVAL_MS = 10_000;
```

The effective interval is determined by priority:
1. **Timeout override** (10s): If last probe had timeout error
2. **Single-vendor** (10min): If vendor has only one endpoint
3. **Base interval** (60s): Default

**Leader Election** (from `/Users/ding/Github/claude-code-hub/src/lib/provider-endpoints/leader-lock.ts`):

Uses Redis Lua scripts for atomic lock acquisition with memory fallback for single-instance deployments:

```typescript
const luaScript = "return redis.call('SET', KEYS[1], ARGV[1], 'NX', 'PX', ARGV[2])";
const result = await redis.eval(luaScript, 1, key, lockId, ttlMs.toString());
```

### 3. Provider Selection with Health Filtering

The provider selector filters providers through multiple layers (from `/Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/provider-selector.ts:966-1033`):

```typescript
private static async filterByLimits(providers: Provider[]): Promise<Provider[]> {
  const results = await Promise.all(
    providers.map(async (p) => {
      // -1. Check vendor-type circuit breaker
      if (await isVendorTypeCircuitOpen(p.providerVendorId, p.providerType)) {
        return null;
      }

      // 0. Check circuit breaker state
      if (await isCircuitOpen(p.id)) {
        return null;
      }

      // 1. Check cost limits
      const costCheck = await RateLimitService.checkCostLimitsWithLease(p.id, "provider", {
        limit_5h_usd: p.limit5hUsd,
        limit_daily_usd: p.limitDailyUsd,
        limit_weekly_usd: p.limitWeeklyUsd,
        limit_monthly_usd: p.limitMonthlyUsd,
      });
      if (!costCheck.allowed) return null;

      // 2. Check total cost limit
      const totalCheck = await RateLimitService.checkTotalCostLimit(
        p.id, "provider", p.limitTotalUsd, { resetAt: p.totalCostResetAt }
      );
      if (!totalCheck.allowed) return null;

      return p;
    })
  );
  return results.filter((p): p is Provider => p !== null);
}
```

### 4. Database Schema

**provider_endpoints Table** (from `/Users/ding/Github/claude-code-hub/src/drizzle/schema.ts:300-342`):

```typescript
export const providerEndpoints = pgTable('provider_endpoints', {
  id: serial('id').primaryKey(),
  vendorId: integer('vendor_id').notNull(),
  providerType: varchar('provider_type', { length: 20 }).notNull(),
  url: text('url').notNull(),
  label: varchar('label', { length: 200 }),
  sortOrder: integer('sort_order').notNull().default(0),
  isEnabled: boolean('is_enabled').notNull().default(true),

  // Last probe snapshot
  lastProbedAt: timestamp('last_probed_at', { withTimezone: true }),
  lastProbeOk: boolean('last_probe_ok'),
  lastProbeStatusCode: integer('last_probe_status_code'),
  lastProbeLatencyMs: integer('last_probe_latency_ms'),
  lastProbeErrorType: varchar('last_probe_error_type', { length: 64 }),
  lastProbeErrorMessage: text('last_probe_error_message'),

  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});
```

**provider_endpoint_probe_logs Table**:

```typescript
export const providerEndpointProbeLogs = pgTable('provider_endpoint_probe_logs', {
  id: serial('id').primaryKey(),
  endpointId: integer('endpoint_id').notNull(),
  source: varchar('source', { length: 20 }).notNull(), // 'scheduled' | 'manual' | 'runtime'
  ok: boolean('ok').notNull(),
  statusCode: integer('status_code'),
  latencyMs: integer('latency_ms'),
  errorType: varchar('error_type', { length: 64 }),
  errorMessage: text('error_message'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});
```

### 5. Dashboard UI Components

The availability dashboard provides multiple views:

**Overview Section** (from `/Users/ding/Github/claude-code-hub/src/app/[locale]/dashboard/availability/_components/overview/overview-section.tsx`):
- System availability gauge
- Average latency gauge
- Error rate gauge
- Active probes counter

**Provider Lane Chart** (from `/Users/ding/Github/claude-code-hub/src/app/[locale]/dashboard/availability/_components/provider/lane-chart.tsx`):
- Heatmap visualization of availability over time
- Dual modes: solid bars for high volume, dots for low volume
- Color coding: emerald (>95%), lime (80-95%), orange (50-80%), rose (<50%), gray (no data)

**Endpoint Probe Grid** (from `/Users/ding/Github/claude-code-hub/src/app/[locale]/dashboard/availability/_components/endpoint/probe-grid.tsx`):
- Grid of endpoint cards showing status
- Manual probe trigger buttons
- Last probe latency display

**Auto-Refresh Behavior**:
- Provider tab: 30-second refresh interval
- Endpoint tab: 10-second refresh interval

---

## Edge Cases and Important Behaviors

### 1. No Data Handling

The system explicitly treats "no requests" as "unknown" status rather than assuming healthy. This appears in multiple places:

```typescript
// From availability-service.ts:429-432
if (total === 0) {
  status = "unknown"; // No data - must be honest, don't assume healthy!
}
```

### 2. OOM Protection

Availability queries are capped at 100,000 requests to prevent memory issues:

```typescript
const MAX_REQUESTS_PER_QUERY = 100000;

if (requests.length === MAX_REQUESTS_PER_QUERY) {
  logger.warn("[Availability] Query hit max request limit, results may be incomplete");
}
```

### 3. Probe Request Exclusion

Probe requests don't count toward circuit breaker failures to avoid false positives:

```typescript
// From forwarder.ts:1034-1042
if (session.isProbeRequest()) {
  logger.debug("ProxyForwarder: Probe request error, skipping circuit breaker");
} else {
  await recordFailure(currentProvider.id, lastError);
}
```

### 4. Session Reuse Circuit Check

When reusing a session's provider, the circuit breaker is still checked:

```typescript
// From provider-selector.ts:547-556
// TC-055 fix: Check circuit breaker during session reuse
if (await isCircuitOpen(provider.id)) {
  return null; // Reject reuse, re-select
}
```

### 5. Count Tokens Special Handling

Count tokens requests don't trigger circuit breaker or provider switching:

```typescript
// From forwarder.ts:977-989
if (session.isCountTokensRequest()) {
  throw lastError; // Direct throw without circuit breaker
}
```

### 6. HTTP/2 Fallback

When HTTP/2 errors occur, the system falls back to HTTP/1.1 without counting toward circuit breaker. This is important because HTTP/2-specific errors (like stream resets) don't indicate provider health issues.

### 7. Redis Failover

All Redis-dependent features have fallbacks:
- Circuit breaker state: Memory fallback
- Rate limiting: Database fallback
- Leader lock: Memory fallback for single-instance

### 8. Soft Delete Pattern

All tables use `deletedAt` timestamp for soft deletion, with partial indexes excluding deleted rows for query performance.

### 9. Batch Cleanup

Old probe logs are cleaned up using batch deletion with `FOR UPDATE SKIP LOCKED` to avoid lock contention:

```typescript
const result = await db.execute(sql`
  WITH ids_to_delete AS (
    SELECT id FROM provider_endpoint_probe_logs
    WHERE created_at < ${beforeDate}
    ORDER BY created_at ASC
    LIMIT ${batchSize}
    FOR UPDATE SKIP LOCKED
  )
  DELETE FROM provider_endpoint_probe_logs
  WHERE id IN (SELECT id FROM ids_to_delete)
`);
```

### 10. Minimum Bucket Size

Time buckets have a minimum of 0.25 minutes (15 seconds) to prevent division by zero in calculations.

---

## Provider Testing System

The provider testing system implements a three-tier validation approach based on the relay-pulse project patterns.

### Three-Tier Validation

**Tier 1: HTTP Status Validation** (from `/Users/ding/Github/claude-code-hub/src/lib/provider-testing/validators/http-validator.ts`):

```typescript
export function classifyHttpStatus(
  statusCode: number,
  latencyMs: number,
  slowThresholdMs: number = TEST_DEFAULTS.SLOW_LATENCY_MS
): HttpValidationResult {
  // 2xx = Green (or Yellow if slow)
  if (statusCode >= 200 && statusCode < 300) {
    if (latencyMs > slowThresholdMs) {
      return { status: "yellow", subStatus: "slow_latency" };
    }
    return { status: "green", subStatus: "success" };
  }

  // 401/403 = Red (auth failure)
  if (statusCode === 401 || statusCode === 403) {
    return { status: "red", subStatus: "auth_error" };
  }

  // 429 = Red (rate limit)
  if (statusCode === 429) {
    return { status: "red", subStatus: "rate_limit" };
  }

  // 5xx = Red (server error)
  if (statusCode >= 500) {
    return { status: "red", subStatus: "server_error" };
  }

  // Other 4xx = Red (client error)
  return { status: "red", subStatus: "client_error" };
}
```

**Tier 2: Latency Threshold Validation**:
- GREEN: Latency <= 5000ms
- YELLOW: Latency > 5000ms (HTTP OK but degraded)
- RED: Any HTTP failure

**Tier 3: Content Validation** (from `/Users/ding/Github/claude-code-hub/src/lib/provider-testing/validators/content-validator.ts`):

```typescript
export function evaluateContentValidation(
  baseStatus: TestStatus,
  baseSubStatus: TestSubStatus,
  responseBody: string,
  successContains?: string
): ContentValidationResult {
  // No validation configured - pass through
  if (!successContains) {
    return { status: baseStatus, subStatus: baseSubStatus, contentPassed: true };
  }

  // Already red - no need to validate
  if (baseStatus === "red") {
    return { status: baseStatus, subStatus: baseSubStatus, contentPassed: false };
  }

  // 429 rate limit: skip content validation
  if (baseSubStatus === "rate_limit") {
    return { status: baseStatus, subStatus: baseSubStatus, contentPassed: false };
  }

  // Empty response = content mismatch
  if (!responseBody || !responseBody.trim()) {
    return { status: "red", subStatus: "content_mismatch", contentPassed: false };
  }

  // Check if response contains expected content
  if (!responseBody.includes(successContains)) {
    return { status: "red", subStatus: "content_mismatch", contentPassed: false };
  }

  return { status: baseStatus, subStatus: baseSubStatus, contentPassed: true };
}
```

### Test Presets

Available test presets (from `/Users/ding/Github/claude-code-hub/src/lib/provider-testing/presets.ts`):

| Preset ID | Description | Provider Types | Default Model | Success Contains |
|-----------|-------------|----------------|---------------|------------------|
| `cc_base` | Claude CLI base (haiku, fast) | claude, claude-auth | claude-haiku-4-5-20251001 | "isNewTopic" |
| `cc_sonnet` | Claude CLI sonnet (with cache) | claude, claude-auth | claude-sonnet-4-5-20250929 | "pong" |
| `public_cc_base` | Public/Community Claude (thinking) | claude, claude-auth | claude-sonnet-4-5-20250929 | "pong" |
| `cx_base` | Codex CLI (Response API) | codex, openai-compatible | gpt-5-codex | "pong" |

### Default Test Prompts

Default test prompts by provider type (from `/Users/ding/Github/claude-code-hub/src/lib/provider-testing/utils/test-prompts.ts`):

```typescript
export const DEFAULT_SUCCESS_CONTAINS: Record<ProviderType, string> = {
  claude: "pong",
  "claude-auth": "pong",
  codex: "pong",
  "openai-compatible": "pong",
  gemini: "pong",
  "gemini-cli": "pong",
};
```

---

## Rate Limiting Integration

The availability system works alongside a sophisticated rate limiting system.

### Cost Limit Time Windows

| Window | Type | Reset Behavior |
|--------|------|----------------|
| **5h** | Rolling | Past 5 hours from now |
| **Daily** | Fixed/Rolling | Custom reset time or 24h rolling |
| **Weekly** | Fixed | Monday 00:00 |
| **Monthly** | Fixed | 1st of month 00:00 |
| **Total** | Permanent | Manual reset only |

### Lease-Based Budget Slicing

The system uses leases for efficient limit checking (from `/Users/ding/Github/claude-code-hub/src/lib/rate-limit/lease.ts`):

```typescript
export function calculateLeaseSlice(params: CalculateLeaseSliceParams): number {
  const { limitAmount, currentUsage, percent, capUsd } = params;

  const remaining = Math.max(0, limitAmount - currentUsage);
  if (remaining === 0) {
    return 0;
  }

  const safePercent = Math.min(1, Math.max(0, percent));
  let slice = limitAmount * safePercent;
  slice = Math.min(slice, remaining);

  if (capUsd !== undefined) {
    slice = Math.min(slice, Math.max(0, capUsd));
  }

  return Math.max(0, Math.round(slice * 10000) / 10000);
}
```

### Fast Path (Redis) and Slow Path (Database)

The rate limit service uses Redis as the primary check mechanism with database fallback:

```typescript
// Fast Path: Redis query
if (RateLimitService.redis && RateLimitService.redis.status === "ready") {
  const now = Date.now();
  const window5h = 5 * 60 * 60 * 1000;

  for (const limit of costLimits) {
    if (!limit.amount || limit.amount <= 0) continue;

    let current = 0;

    if (limit.period === "5h") {
      const key = `${type}:${id}:cost_5h_rolling`;
      const result = (await RateLimitService.redis.eval(
        GET_COST_5H_ROLLING_WINDOW,
        1,
        key,
        now.toString(),
        window5h.toString()
      )) as string;
      current = parseFloat(result || "0");
    }
    
    if (current >= limit.amount) {
      return { allowed: false, reason: `${typeName} ${limit.name} limit reached` };
    }
  }
}
```

---

## Smart Probe Mechanism

The smart probe scheduler enables faster recovery detection for providers in OPEN circuit state.

### Configuration

```typescript
const ENABLE_SMART_PROBING = process.env.ENABLE_SMART_PROBING === "true";
const PROBE_INTERVAL_MS = parseInt(process.env.PROBE_INTERVAL_MS || "10000", 10);
const PROBE_TIMEOUT_MS = parseInt(process.env.PROBE_TIMEOUT_MS || "5000", 10);
```

### Probe Cycle

```typescript
async function runProbeCycle(): Promise<void> {
  if (isProbing) {
    logger.debug("[SmartProbe] Skipping cycle, previous cycle still running");
    return;
  }

  isProbing = true;
  try {
    await loadProviderConfigs();
    
    const healthStatus = getAllHealthStatus();
    const openCircuits: number[] = [];
    
    for (const [providerId, health] of Object.entries(healthStatus)) {
      if (health.circuitState === "open") {
        openCircuits.push(parseInt(providerId, 10));
      }
    }
    
    const results = await Promise.allSettled(
      openCircuits.map((id) => probeProvider(id))
    );
  } finally {
    isProbing = false;
  }
}
```

### Safe Recovery via HALF_OPEN

When a probe succeeds, the circuit transitions to HALF_OPEN (not directly to CLOSED):

```typescript
if (result.success) {
  logger.info("[SmartProbe] Probe succeeded, transitioning to half-open");
  tripToHalfOpen(providerId);
  return true;
}
```

This safety mechanism ensures real user requests gradually test the provider before full traffic restoration.

---

## Dashboard Visualization

### Lane Chart Heatmap

The lane chart provides a heatmap visualization of availability over time (from `/Users/ding/Github/claude-code-hub/src/app/[locale]/dashboard/availability/_components/provider/lane-chart.tsx`):

```typescript
function getAvailabilityColor(score: number, hasData: boolean): string {
  if (!hasData) return "bg-slate-300/50 dark:bg-slate-600/50";
  if (score < 0.5) return "bg-rose-500";
  if (score < 0.8) return "bg-orange-500";
  if (score < 0.95) return "bg-lime-500";
  return "bg-emerald-500";
}
```

**Color Coding**:
- **Emerald** (>95%): Excellent availability
- **Lime** (80-95%): Good availability
- **Orange** (50-80%): Fair availability
- **Rose** (<50%): Poor availability
- **Gray**: No data

### Dual Visualization Modes

The lane chart adapts based on data volume:
- **High Volume** (>= 50 requests): Solid bars with height representing request count
- **Low Volume** (< 50 requests): Scatter dots with size representing request count

### Confidence Badge

The confidence badge indicates data reliability:
- **Low confidence** (0-9 requests): 1 bar, gray
- **Medium confidence** (10-49 requests): 2 bars, amber
- **High confidence** (50+ requests): 3 bars, emerald

---

## Additional Edge Cases

### 11. Empty Response Detection

The system detects empty responses as a special error type:

```typescript
// From forwarder.ts
if (contentLength === "0") {
  throw new EmptyResponseError(currentProvider.id, currentProvider.name, "empty_body");
}
```

### 12. Thinking Signature Rectifier

Special handling for Anthropic thinking signature incompatibility:

```typescript
// Retries once with rectified request without counting toward circuit breaker
```

### 13. Network Error Circuit Breaker Config

Controlled by `ENABLE_CIRCUIT_BREAKER_ON_NETWORK_ERRORS` env var:
- Default: disabled (network errors don't count toward circuit breaker)
- When enabled: network errors will open circuits

### 14. User-Agent Requirements

Different provider types require specific User-Agent strings:

```typescript
export const USER_AGENTS: Record<ProviderType, string> = {
  claude: "claude-cli/2.0.50 (external, cli)",
  "claude-auth": "claude-cli/2.0.50 (external, cli)",
  codex: "codex_cli_rs/0.63.0",
  "openai-compatible": "OpenAI/NodeJS/3.2.1",
  gemini: "GeminiCLI/v0.17.1 (darwin; arm64)",
  "gemini-cli": "GeminiCLI/v0.17.1 (darwin; arm64)",
};
```

### 15. Vendor-Type Circuit Breaker

A special circuit breaker at vendor+type level for temporary isolation:

```typescript
// When all endpoints of a vendor+type timeout
if (statusCode === 524 && 
    endpointAttemptsEvaluated >= endpointCandidates.length &&
    allEndpointAttemptsTimedOut) {
  await recordVendorTypeAllEndpointsTimeout(
    currentProvider.providerVendorId,
    currentProvider.providerType
  );
}
```

---

## File References (Extended)

### Provider Testing
- `/Users/ding/Github/claude-code-hub/src/lib/provider-testing/index.ts` - Test module exports
- `/Users/ding/Github/claude-code-hub/src/lib/provider-testing/types.ts` - Test type definitions
- `/Users/ding/Github/claude-code-hub/src/lib/provider-testing/presets.ts` - Test presets
- `/Users/ding/Github/claude-code-hub/src/lib/provider-testing/test-service.ts` - Test execution
- `/Users/ding/Github/claude-code-hub/src/lib/provider-testing/validators/http-validator.ts` - HTTP validation
- `/Users/ding/Github/claude-code-hub/src/lib/provider-testing/validators/content-validator.ts` - Content validation
- `/Users/ding/Github/claude-code-hub/src/lib/provider-testing/utils/test-prompts.ts` - Test prompts

### Redis State Management
- `/Users/ding/Github/claude-code-hub/src/lib/redis/circuit-breaker-state.ts` - Circuit breaker Redis persistence
- `/Users/ding/Github/claude-code-hub/src/lib/redis/circuit-breaker-config.ts` - Config Redis caching
- `/Users/ding/Github/claude-code-hub/src/lib/redis/endpoint-circuit-breaker-state.ts` - Endpoint circuit state

### Additional Dashboard Components
- `/Users/ding/Github/claude-code-hub/src/app/[locale]/dashboard/availability/_components/provider/latency-chart.tsx` - Latency visualization
- `/Users/ding/Github/claude-code-hub/src/app/[locale]/dashboard/availability/_components/endpoint/probe-terminal.tsx` - Terminal-style logs
- `/Users/ding/Github/claude-code-hub/src/app/[locale]/dashboard/availability/_components/overview/gauge-card.tsx` - Gauge component
- `/Users/ding/Github/claude-code-hub/src/app/[locale]/dashboard/availability/_components/shared/time-range-selector.tsx` - Time range control

---

## Summary

The availability monitoring system in claude-code-hub is a comprehensive solution that combines:

1. **Request-log-based availability scoring** using simple green/red classification
2. **Active endpoint probing** with configurable intervals and distributed scheduling
3. **Circuit breaker pattern** with three states for failure isolation and recovery
4. **Smart probing** for faster detection of provider recovery
5. **Rate limiting integration** to prevent cost overruns
6. **Rich dashboard visualization** with heatmaps and real-time metrics

Key design principles:
- **Honesty**: No data = unknown (not assumed healthy)
- **Safety**: Circuits transition through HALF_OPEN before CLOSED
- **Fail-open**: Redis failures don't block the system
- **Observability**: Comprehensive logging and metrics

---

*This is a round 1 exploration draft. It documents the current implementation as found in the codebase. All file paths are absolute and code snippets are verbatim from the source.*

When HTTP/2 errors occur, the system falls back to HTTP/1.1 without counting toward circuit breaker.

### 7. Redis Failover

All Redis-dependent features have fallbacks:
- Circuit breaker state: Memory fallback
- Rate limiting: Database fallback
- Leader lock: Memory fallback for single-instance

### 8. Soft Delete Pattern

All tables use `deletedAt` timestamp for soft deletion, with partial indexes excluding deleted rows for query performance.

### 9. Batch Cleanup

Old probe logs are cleaned up using batch deletion with `FOR UPDATE SKIP LOCKED` to avoid lock contention:

```typescript
const result = await db.execute(sql`
  WITH ids_to_delete AS (
    SELECT id FROM provider_endpoint_probe_logs
    WHERE created_at < ${beforeDate}
    ORDER BY created_at ASC
    LIMIT ${batchSize}
    FOR UPDATE SKIP LOCKED
  )
  DELETE FROM provider_endpoint_probe_logs
  WHERE id IN (SELECT id FROM ids_to_delete)
`);
```

### 10. Minimum Bucket Size

Time buckets have a minimum of 0.25 minutes (15 seconds) to prevent division by zero in calculations.

---

## Integration with Other Systems

### Rate Limiting Integration

The availability system works alongside rate limiting:

1. **Cost Limits**: Providers are filtered out when they hit spending limits
2. **Concurrent Sessions**: Limited per provider to prevent overload
3. **Lease-Based Budgeting**: Uses Redis leases for efficient limit checking

### Circuit Breaker Integration

Circuit breakers provide failure isolation:

1. **Provider-Level**: Tracks failures per provider
2. **Endpoint-Level**: Separate circuit breaker for each endpoint
3. **Vendor-Type-Level**: Temporary isolation when all endpoints of a vendor+type fail

### Provider Testing Integration

The testing system uses three-tier validation:

1. **Tier 1**: HTTP status code validation
2. **Tier 2**: Latency threshold validation
3. **Tier 3**: Content validation (response contains expected string)

Smart probing uses the testing system to check recovery of OPEN circuits.

---

## File References

### Core Availability
- `/Users/ding/Github/claude-code-hub/src/lib/availability/index.ts` - Module exports
- `/Users/ding/Github/claude-code-hub/src/lib/availability/types.ts` - Type definitions
- `/Users/ding/Github/claude-code-hub/src/lib/availability/availability-service.ts` - Core service

### Circuit Breaker
- `/Users/ding/Github/claude-code-hub/src/lib/circuit-breaker.ts` - Provider-level circuit breaker
- `/Users/ding/Github/claude-code-hub/src/lib/endpoint-circuit-breaker.ts` - Endpoint-level circuit breaker
- `/Users/ding/Github/claude-code-hub/src/lib/vendor-type-circuit-breaker.ts` - Vendor-type circuit breaker
- `/Users/ding/Github/claude-code-hub/src/lib/circuit-breaker-probe.ts` - Smart probe scheduler

### Probe System
- `/Users/ding/Github/claude-code-hub/src/lib/provider-endpoints/probe.ts` - Core probing logic
- `/Users/ding/Github/claude-code-hub/src/lib/provider-endpoints/probe-scheduler.ts` - Scheduled probing
- `/Users/ding/Github/claude-code-hub/src/lib/provider-endpoints/leader-lock.ts` - Distributed locking
- `/Users/ding/Github/claude-code-hub/src/lib/provider-endpoints/endpoint-selector.ts` - Endpoint selection

### API Routes
- `/Users/ding/Github/claude-code-hub/src/app/api/availability/route.ts` - Main availability API
- `/Users/ding/Github/claude-code-hub/src/app/api/availability/current/route.ts` - Current status API
- `/Users/ding/Github/claude-code-hub/src/app/api/availability/endpoints/route.ts` - Endpoints API
- `/Users/ding/Github/claude-code-hub/src/app/api/availability/endpoints/probe-logs/route.ts` - Probe logs API

### Dashboard UI
- `/Users/ding/Github/claude-code-hub/src/app/[locale]/dashboard/availability/_components/availability-dashboard.tsx`
- `/Users/ding/Github/claude-code-hub/src/app/[locale]/dashboard/availability/_components/availability-view.tsx`
- `/Users/ding/Github/claude-code-hub/src/app/[locale]/dashboard/availability/_components/overview/overview-section.tsx`
- `/Users/ding/Github/claude-code-hub/src/app/[locale]/dashboard/availability/_components/provider/lane-chart.tsx`
- `/Users/ding/Github/claude-code-hub/src/app/[locale]/dashboard/availability/_components/endpoint/probe-grid.tsx`

### Database
- `/Users/ding/Github/claude-code-hub/src/drizzle/schema.ts` - Schema definitions
- `/Users/ding/Github/claude-code-hub/src/repository/provider-endpoints.ts` - Data access

### Provider Selection
- `/Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/provider-selector.ts` - Selection algorithm
- `/Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/forwarder.ts` - Request forwarding

### Rate Limiting
- `/Users/ding/Github/claude-code-hub/src/lib/rate-limit/service.ts` - Rate limit service
- `/Users/ding/Github/claude-code-hub/src/lib/rate-limit/lease-service.ts` - Lease-based budgeting

---

## Open Questions and Future Work

1. **Long-term Storage**: Probe logs are retained for a configurable period (default 1 day). Consider archiving strategy for historical analysis.

2. **Predictive Health**: Currently reactive. Could add predictive health scoring based on latency trends.

3. **Multi-region Support**: Circuit breaker state is shared via Redis. Consider region-isolated health for multi-region deployments.

4. **Custom Health Checks**: Currently uses HTTP status codes. Could support custom health check endpoints.

5. **Alerting Integration**: Circuit breaker alerts are sent via webhooks. Could add more alerting channels.

---

*This is a round 1 exploration draft. It documents the current implementation as found in the codebase. All file paths are absolute and code snippets are verbatim from the source.*
