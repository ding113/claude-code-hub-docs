# Load Balancing Implementation Analysis - claude-code-hub

## 1. Intent Analysis (设计意图)

The claude-code-hub proxy implements a sophisticated multi-layer load balancing system designed to:

1. **High Availability**: Ensure continuous service even when individual providers fail
2. **Cost Optimization**: Route requests to providers with lower cost multipliers
3. **Session Stickiness**: Maintain conversation continuity by reusing providers for existing sessions
4. **Health-Aware Routing**: Avoid unhealthy providers through circuit breakers and health checks
5. **Multi-Tenancy Support**: Isolate different user groups through provider group tags
6. **Intelligent Failover**: Gracefully handle failures with automatic provider switching

The load balancing operates at two levels:
- **Provider Level**: Selecting which provider to use for a request
- **Endpoint Level**: Selecting which endpoint (URL) within a provider/vendor to use

## 2. Behavior Summary (行为概述)

### 2.1 Provider Selection Flow

The provider selection process follows a multi-stage filtering pipeline:

```
1. Session Reuse Check
   └── If session exists and provider is healthy → Reuse provider
   
2. Group Pre-filtering (Silent)
   └── Filter providers by user's providerGroup tag
   
3. Base Filtering
   ├── Remove disabled providers
   ├── Remove excluded providers (failed in retry)
   ├── Format/Type compatibility check
   └── Model support check
   
4. 1M Context Filter (if applicable)
   └── Filter providers that don't support 1M context
   
5. Health Check Filtering
   ├── Vendor-type circuit breaker check
   ├── Provider circuit breaker check
   ├── Cost limit check (5h, daily, weekly, monthly, total)
   └── Concurrent session limit check
   
6. Priority Stratification
   └── Select only providers with highest priority (lowest number)
   
7. Cost Sorting + Weighted Random Selection
   ├── Sort by costMultiplier (ascending)
   └── Weighted random selection based on provider weight
```

### 2.2 Endpoint Selection Flow

Within a selected provider, endpoints are ranked by:

```
1. Circuit breaker state (closed endpoints first)
2. Probe status (lastProbeOk = true first)
3. Sort order (configured priority)
4. Latency (lowest latency first)
5. ID (stable tie-breaker)
```

### 2.3 Retry and Failover Behavior

**Inner Loop (Endpoint Retry)**:
- Network errors (SYSTEM_ERROR): Advance to next endpoint, retry up to maxAttemptsPerProvider
- Provider errors (4xx/5xx): Stay on same endpoint, retry up to maxAttemptsPerProvider
- Client abort/non-retryable errors: Stop immediately

**Outer Loop (Provider Switch)**:
- When all endpoints exhausted or max retries reached → Switch to alternative provider
- Up to MAX_PROVIDER_SWITCHES (20) provider switches allowed

## 3. Configuration & Commands (配置与命令)

### 3.1 Provider Configuration Fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `weight` | integer | 1 | Selection weight (1-100), higher = more likely |
| `priority` | integer | 0 | Priority level (lower = higher priority) |
| `costMultiplier` | decimal | 1.0 | Cost multiplier for billing |
| `groupTag` | string | null | Provider group tag(s), comma-separated |
| `isEnabled` | boolean | true | Whether provider is active |
| `limitConcurrentSessions` | integer | 0 | Max concurrent sessions (0 = unlimited) |
| `maxRetryAttempts` | integer | null | Max retries per provider (null = use default) |
| `circuitBreakerFailureThreshold` | integer | 3 | Failures before opening circuit |
| `circuitBreakerOpenDuration` | integer | 300000 | Circuit open duration in ms (5 min) |
| `circuitBreakerHalfOpenSuccessThreshold` | integer | 1 | Successes needed to close circuit |

### 3.2 Endpoint Configuration Fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `url` | string | required | Endpoint URL |
| `sortOrder` | integer | 0 | Sort priority (lower = higher) |
| `isEnabled` | boolean | true | Whether endpoint is active |
| `providerType` | enum | 'claude' | Provider type classification |

### 3.3 Database Schema

**Providers Table** (`providers`):
```sql
- weight: integer NOT NULL DEFAULT 1
- priority: integer NOT NULL DEFAULT 0
- cost_multiplier: numeric(10,4) DEFAULT '1.0'
- group_tag: varchar(50)
- is_enabled: boolean NOT NULL DEFAULT true
- limit_concurrent_sessions: integer DEFAULT 0
- provider_type: varchar(20) DEFAULT 'claude'
- provider_vendor_id: integer NOT NULL (FK to provider_vendors)
```

**Provider Endpoints Table** (`provider_endpoints`):
```sql
- vendor_id: integer NOT NULL (FK to provider_vendors)
- provider_type: varchar(20) NOT NULL DEFAULT 'claude'
- url: text NOT NULL
- sort_order: integer NOT NULL DEFAULT 0
- is_enabled: boolean NOT NULL DEFAULT true
- last_probe_ok: boolean
- last_probe_latency_ms: integer
```

**Indexes for Performance**:
```sql
idx_providers_enabled_priority ON (isEnabled, priority, weight) WHERE deletedAt IS NULL
idx_providers_group ON (groupTag) WHERE deletedAt IS NULL
idx_providers_vendor_type ON (providerVendorId, providerType) WHERE deletedAt IS NULL
idx_provider_endpoints_vendor_type ON (vendorId, providerType) WHERE deletedAt IS NULL
```

### 3.4 Validation Rules

**Weight**: 1-100 integer (rejected: 0, negative, >100)
**Priority**: Non-negative integer
**Concurrent Sessions**: 0-1000 (0 = unlimited)
**Retry Attempts**: 1-10 (configurable via PROVIDER_LIMITS)

### 3.5 API Endpoints

**Provider Management**:
- `POST /api/actions/providers` - Create provider
- `PUT /api/actions/providers/:id` - Update provider
- `GET /api/actions/providers` - List providers

**Endpoint Management**:
- Managed through provider vendor interface

## 4. Algorithms (算法详解)

### 4.1 Weighted Random Selection

```typescript
private static weightedRandom(providers: Provider[]): Provider {
  const totalWeight = providers.reduce((sum, p) => sum + p.weight, 0);
  
  if (totalWeight === 0) {
    return providers[Math.floor(Math.random() * providers.length)];
  }
  
  const random = Math.random() * totalWeight;
  let cumulativeWeight = 0;
  
  for (const provider of providers) {
    cumulativeWeight += provider.weight;
    if (random < cumulativeWeight) {
      return provider;
    }
  }
  
  return providers[providers.length - 1];
}
```

**Probability Calculation**:
```typescript
const probability = totalWeight > 0 ? provider.weight / totalWeight : 1 / count;
```

### 4.2 Cost-Aware Selection (selectOptimal)

```typescript
private static selectOptimal(providers: Provider[]): Provider {
  if (providers.length === 1) return providers[0];
  
  // Sort by costMultiplier ascending (cheaper first)
  const sorted = [...providers].sort((a, b) => 
    a.costMultiplier - b.costMultiplier
  );
  
  // Apply weighted random on sorted list
  return weightedRandom(sorted);
}
```

This ensures:
- Lower cost providers are preferred
- Weight still influences selection within same cost tier
- Cost optimization without completely ignoring weights

### 4.3 Priority Stratification

```typescript
private static selectTopPriority(providers: Provider[]): Provider[] {
  const minPriority = Math.min(...providers.map((p) => p.priority || 0));
  return providers.filter((p) => (p.priority || 0) === minPriority);
}
```

Only providers with the highest priority (lowest number) are considered for selection.

### 4.4 Endpoint Ranking Algorithm

```typescript
function rankProviderEndpoints(endpoints: ProviderEndpoint[]): ProviderEndpoint[] {
  const priorityRank = (endpoint: ProviderEndpoint): number => {
    if (endpoint.lastProbeOk === true) return 0;
    if (endpoint.lastProbeOk === null) return 1;
    return 2;
  };
  
  return enabled.slice().sort((a, b) => {
    // 1. Probe status rank
    const rankDiff = priorityRank(a) - priorityRank(b);
    if (rankDiff !== 0) return rankDiff;
    
    // 2. Configured sort order
    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
    
    // 3. Latency (lower is better)
    const aLatency = a.lastProbeLatencyMs ?? Infinity;
    const bLatency = b.lastProbeLatencyMs ?? Infinity;
    if (aLatency !== bLatency) return aLatency - bLatency;
    
    // 4. Stable tie-breaker
    return a.id - b.id;
  });
}
```

## 5. Health-Based Load Balancing (健康度负载均衡)

### 5.1 Circuit Breaker States

**Provider-Level Circuit Breaker** (`src/lib/circuit-breaker.ts`):
- **Closed**: Normal operation, requests allowed
- **Open**: Failure threshold exceeded, requests blocked for `openDuration`
- **Half-Open**: After timeout, allowing test requests

**Endpoint-Level Circuit Breaker** (`src/lib/endpoint-circuit-breaker.ts`):
- Same state machine as provider-level
- Independent configuration per endpoint
- Default: 3 failures, 5 min open duration, 1 success to close

### 5.2 Circuit Breaker Configuration

```typescript
interface CircuitBreakerConfig {
  failureThreshold: number;        // Default: 3
  openDuration: number;            // Default: 300000ms (5 min)
  halfOpenSuccessThreshold: number; // Default: 1
}
```

### 5.3 Health Check Integration

**Provider Health Filtering** (`filterByLimits`):
1. Check vendor-type circuit breaker (temporary circuit for vendor+type)
2. Check provider circuit breaker
3. Check cost limits (5h, daily, weekly, monthly, total)
4. Check concurrent session limit (atomic check-and-track)

**Endpoint Health Filtering**:
1. Filter out endpoints with open circuit breaker
2. Rank by probe status and latency

### 5.4 Concurrent Session Limiting

Atomic check-and-track using Redis Lua script:

```lua
-- CHECK_AND_TRACK_SESSION
-- 1. Clean expired sessions
-- 2. Check if session already tracked
-- 3. If count < limit, add session and return success
-- 4. Otherwise return failure with current count
```

This prevents race conditions where multiple requests simultaneously pass the limit check.

### 5.5 Cost Limit Tracking

**Time Windows**:
- 5h: Rolling window (ZSET with Lua script)
- Daily: Fixed or rolling mode
- Weekly: Fixed window (Monday 00:00 reset)
- Monthly: Fixed window (1st day 00:00 reset)
- Total: Accumulated since last reset

**Redis Key Patterns**:
```
provider:{id}:cost_5h_rolling      # ZSET for rolling window
provider:{id}:cost_daily_{HHmm}    # STRING for fixed daily
provider:{id}:cost_daily_rolling   # ZSET for rolling daily
provider:{id}:cost_weekly          # STRING
provider:{id}:cost_monthly         # STRING
```

### 5.6 Endpoint Probing

Endpoints are periodically probed for health:
- **Scheduled**: Background job probes all endpoints
- **Manual**: Admin-triggered probe
- **Runtime**: Probe on failure to verify recovery

Probe results stored in:
- `lastProbeOk`: Boolean success status
- `lastProbeLatencyMs`: Response time
- `lastProbeStatusCode`: HTTP status
- `lastProbeErrorType/Message`: Error details

## 6. Edge Cases (边界情况)

### 6.1 All Providers Unavailable

When all providers are filtered out (circuit open, rate limited, etc.):
- Returns HTTP 503 Service Unavailable
- Error types: `rate_limit_exceeded`, `circuit_breaker_open`, `mixed_unavailable`
- Detailed context logged including filtered provider reasons

### 6.2 Session Reuse with Unhealthy Provider

When a session-bound provider becomes unhealthy:
1. Check circuit breaker state
2. Check cost limits
3. Check model support
4. Check group permissions
5. If any check fails → Reject reuse, trigger re-selection

### 6.3 Concurrent Limit Race Condition

Solved by atomic Lua script:
- Single Redis operation for check + track
- Prevents multiple requests from simultaneously passing limit
- Returns current count for logging

### 6.4 Network Errors vs Provider Errors

**Network Errors (SYSTEM_ERROR)**:
- Not counted toward circuit breaker (by default)
- Advance to next endpoint
- Can be enabled via `ENABLE_CIRCUIT_BREAKER_ON_NETWORK_ERRORS`

**Provider Errors (4xx/5xx)**:
- Counted toward circuit breaker
- Stay on same endpoint for retry
- After max retries → Switch provider

### 6.5 Empty Weight Handling

If total weight is 0:
- Falls back to uniform random selection
- Each provider has equal probability

### 6.6 Provider Group Isolation

Strict group isolation enforced:
- Users can only see providers matching their group tag
- Session reuse rejected if provider no longer in user's groups
- Supports multiple tags per provider (comma-separated)

### 6.7 Max Provider Switches Safety Limit

To prevent infinite loops:
- Maximum 20 provider switches per request
- After limit reached → Return 503 error
- Logged as safety limit exceeded

## 7. References (代码引用)

### 7.1 Core Files

| File | Purpose |
|------|---------|
| `src/app/v1/_lib/proxy/provider-selector.ts` | Provider selection logic |
| `src/lib/provider-endpoints/endpoint-selector.ts` | Endpoint ranking and selection |
| `src/app/v1/_lib/proxy/forwarder.ts` | Request forwarding with retry logic |
| `src/lib/circuit-breaker.ts` | Provider circuit breaker |
| `src/lib/endpoint-circuit-breaker.ts` | Endpoint circuit breaker |
| `src/lib/rate-limit/service.ts` | Rate limiting and cost tracking |

### 7.2 Type Definitions

| File | Purpose |
|------|---------|
| `src/types/provider.ts` | Provider and endpoint type definitions |
| `src/types/message.ts` | ProviderChainItem type for decision tracking |
| `src/drizzle/schema.ts` | Database schema definitions |

### 7.3 Configuration

| File | Purpose |
|------|---------|
| `src/lib/validation/schemas.ts` | Provider validation schemas |
| `src/lib/constants/provider.constants.ts` | Default values and limits |

### 7.4 Key Functions

**Provider Selection**:
- `ProxyProviderResolver.ensure()` - Main entry point
- `ProxyProviderResolver.pickRandomProvider()` - Selection with filtering
- `ProxyProviderResolver.filterByLimits()` - Health filtering
- `ProxyProviderResolver.selectOptimal()` - Cost-aware weighted selection

**Endpoint Selection**:
- `getPreferredProviderEndpoints()` - Rank and filter endpoints
- `rankProviderEndpoints()` - Sorting algorithm
- `pickBestProviderEndpoint()` - Select single best endpoint

**Circuit Breakers**:
- `isCircuitOpen()` / `isEndpointCircuitOpen()` - Check state
- `recordFailure()` / `recordEndpointFailure()` - Record failure
- `recordSuccess()` / `recordEndpointSuccess()` - Record success

**Rate Limiting**:
- `RateLimitService.checkAndTrackProviderSession()` - Atomic concurrent check
- `RateLimitService.checkCostLimitsWithLease()` - Cost limit check
- `RateLimitService.trackCost()` - Record request cost

## 8. Decision Context Logging

The system records detailed decision context for each request:

```typescript
interface DecisionContext {
  totalProviders: number;           // Total providers in system
  enabledProviders: number;         // After base filtering
  targetType: ProviderType;         // Inferred from request format
  requestedModel: string;           // Original model requested
  groupFilterApplied: boolean;      // Whether group filtering occurred
  userGroup?: string;               // User's provider group
  beforeHealthCheck: number;        // Providers before health filter
  afterHealthCheck: number;         // Providers after health filter
  filteredProviders: Array<{        // Why providers were filtered
    id: number;
    name: string;
    reason: 'circuit_open' | 'rate_limited' | ...;
    details?: string;
  }>;
  priorityLevels: number[];         // Available priority levels
  selectedPriority: number;         // Priority level selected
  candidatesAtPriority: Array<{     // Candidates at selected priority
    id: number;
    name: string;
    weight: number;
    costMultiplier: number;
    probability?: number;
  }>;
}
```

This enables detailed debugging and monitoring of load balancing decisions.

---

*Document generated from codebase analysis of claude-code-hub*
*Analysis date: 2026-01-29*
