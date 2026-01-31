# Failover and Retry Mechanism Analysis Report
## 故障转移与重试机制分析报告

**Target Documentation Page**: `/docs/proxy/failover-retry` (故障转移与重试)  
**Analysis Date**: 2026-01-29  
**Source Repository**: `/Users/ding/Github/claude-code-hub`

---

## 1. Intent Analysis (设计意图)

The failover and retry mechanism in claude-code-hub is designed to provide **high availability and fault tolerance** for AI model proxy services. The system handles transient failures gracefully by:

1. **Automatic retry within a single provider** - Attempting the same request multiple times on the same provider before giving up
2. **Provider failover** - Switching to alternative providers when the current provider fails
3. **Circuit breaker protection** - Preventing cascading failures by temporarily disabling unhealthy providers
4. **Endpoint-level resilience** - Supporting multiple endpoints per provider with automatic endpoint selection

The core philosophy is to **maximize request success rate** while **minimizing latency impact** and **preventing provider overload**.

---

## 2. Behavior Summary (行为总结)

### 2.1 Dual-Loop Architecture (双循环架构)

The failover mechanism uses a **nested loop structure** implemented in `/Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/forwarder.ts`:

```
Outer Loop: Provider Switching (MAX_PROVIDER_SWITCHES attempts)
  └── Inner Loop: Retry Current Provider (maxAttemptsPerProvider attempts)
```

**Outer Loop** (`/Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/forwarder.ts:216-1078`):
- Iterates through different providers when the current provider exhausts all retries
- Maintains a `failedProviderIds` array to track exhausted providers
- Uses `selectAlternative()` to pick the next available provider
- Has a safety limit (`MAX_PROVIDER_SWITCHES`) to prevent infinite loops

**Inner Loop** (`/Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/forwarder.ts:317-1049`):
- Retries the same provider with the same or different endpoints
- Advances endpoint index on network errors (endpoint stickiness)
- Waits 100ms between retry attempts
- Tracks `attemptCount` against `maxAttemptsPerProvider`

### 2.2 Request Flow

1. **Initial Request** → Primary provider selected via `ProxyProviderResolver`
2. **Attempt 1** → Try primary provider with best endpoint
3. **On Failure** → Classify error type → Decide retry/failover strategy
4. **Retry** → Wait 100ms → Try next endpoint (if network error) or same endpoint
5. **Exhausted** → Add to `failedProviderIds` → Select alternative provider
6. **Repeat** → Until success or all providers exhausted
7. **Final Failure** → Return 503 "All providers temporarily unavailable"

---

## 3. Retry Mechanisms (重试机制)

### 3.1 Retry Configuration (重试配置)

**Environment Default** (`/Users/ding/Github/claude-code-hub/src/lib/config/env.schema.ts:109-113`):
```typescript
MAX_RETRY_ATTEMPTS_DEFAULT: z.coerce.number()
  .min(1)
  .max(10)
  .default(2)  // Default: 2 attempts per provider
```

**Per-Provider Configuration** (`/Users/ding/Github/claude-code-hub/src/types/provider.ts:101`):
```typescript
maxRetryAttempts: number | null;  // null = use environment default
```

**Validation Limits** (`/Users/ding/Github/claude-code-hub/src/lib/constants/provider.constants.ts:8`):
```typescript
MAX_RETRY_ATTEMPTS: { MIN: 1, MAX: 10 }
```

### 3.2 Retry Logic Implementation

**Max Attempts Resolution** (`/Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/forwarder.ts:220-223`):
```typescript
let maxAttemptsPerProvider = resolveMaxAttemptsForProvider(
  currentProvider,
  envDefaultMaxAttempts
);
```

The actual retry attempts per provider is determined by:
1. Provider's `maxRetryAttempts` field (if set)
2. Environment `MAX_RETRY_ATTEMPTS_DEFAULT` (fallback)
3. Clamped to valid range [1, 10]

**Retry Delay** (`/Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/forwarder.ts:807, 1029`):
- Fixed 100ms delay between retry attempts
- Applied consistently across all error types

### 3.3 Endpoint Candidate Truncation

**Latency-Based Selection** (`/Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/forwarder.ts:263-274`):
```typescript
if (endpointCandidates.length > maxAttemptsPerProvider) {
  const originalCount = endpointCandidates.length;
  endpointCandidates.length = maxAttemptsPerProvider;
  // Only keep N lowest-latency endpoints (N = maxRetryAttempts)
}
```

Endpoints are ranked by:
1. Probe status (`lastProbeOk`)
2. Sort order (`sortOrder`)
3. Latency (`lastProbeLatencyMs`)

---

## 4. Provider Fallback Selection (供应商回退选择)

### 4.1 Selection Algorithm

**Primary Method** (`/Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/provider-selector.ts:657-958`):

The `pickRandomProvider()` method implements a multi-stage filtering pipeline:

1. **Group Pre-filtering** - Users only see providers in their assigned group
2. **Base Filtering**:
   - Enabled providers only (`isEnabled`)
   - Exclude failed providers (`excludeIds`)
   - Format compatibility check
   - Model support verification
3. **Health Check Filtering** (`filterByLimits`):
   - Circuit breaker state check
   - Cost limit validation (5h, daily, weekly, monthly)
   - Total cost limit check
4. **Priority Stratification** - Select only highest priority providers
5. **Cost-Weighted Random Selection** - Lower cost multiplier = higher probability

### 4.2 Alternative Provider Selection

**selectAlternative()** (`/Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/forwarder.ts:2068-2095`):
```typescript
private static async selectAlternative(
  session: ProxySession,
  excludeProviderIds: number[]
): Promise<typeof session.provider | null> {
  const alternativeProvider = await ProxyProviderResolver.pickRandomProviderWithExclusion(
    session,
    excludeProviderIds
  );
  // Safety check: ensure returned provider is not in excluded list
}
```

### 4.3 Session Reuse and Binding

**Smart Binding Strategy** (`/Users/ding/Github/claude-code-hub/src/lib/session-manager.ts:766-785`):
- Sessions are bound to providers for consistency
- On circuit open, sessions migrate to backup providers
- New sessions prefer non-failed providers

---

## 5. Error Classification (错误分类)

### 5.1 Error Categories

**Enum Definition** (`/Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/errors.ts:457-463`):
```typescript
export enum ErrorCategory {
  PROVIDER_ERROR,              // 4xx/5xx HTTP errors → Circuit breaker + Failover
  SYSTEM_ERROR,                // Network errors → Retry 1 time, then failover
  CLIENT_ABORT,                // Connection reset → No retry, return immediately
  NON_RETRYABLE_CLIENT_ERROR,  // Input validation → No retry, return immediately
  RESOURCE_NOT_FOUND,          // 404 errors → No circuit breaker, failover
}
```

### 5.2 Classification Logic

**categorizeErrorAsync()** (`/Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/errors.ts:780-813`):

Priority order (highest to lowest):
1. **Client Abort Detection** - `isClientAbortError()` checks for connection reset
2. **Non-retryable Client Error** - Matches error rules (prompt limit, content filter, etc.)
3. **Provider Error** - `ProxyError` instances (HTTP 4xx/5xx)
   - 404 errors get special `RESOURCE_NOT_FOUND` category
4. **Empty Response Error** - Treated as provider error
5. **System Error** - All other errors (network, DNS, timeout)

### 5.3 Error Rule System

**Error Rules Repository** (`/Users/ding/Github/claude-code-hub/src/repository/error-rules.ts`):

Default rules include patterns for:
- Prompt token limits (`prompt is too long`)
- Content filtering (`content filter`, `safety`)
- PDF limits (`PDF pages`, `document`)
- Thinking format errors (`thinking_budget`)
- Parameter errors (`Missing or invalid`)
- Model errors (`unknown model`)

**Detection Methods**:
- `contains` - Substring match (fastest)
- `exact` - Exact string match (O(1))
- `regex` - Regular expression match (most flexible)

---

## 6. Circuit Breaker Integration (熔断器集成)

### 6.1 Provider-Level Circuit Breaker

**Implementation** (`/Users/ding/Github/claude-code-hub/src/lib/circuit-breaker.ts`):

**States**:
- `closed` - Normal operation, requests pass through
- `open` - Failure threshold reached, requests blocked
- `half-open` - Testing if provider recovered

**Configuration per Provider** (`/Users/ding/Github/claude-code-hub/src/types/provider.ts:102-104`):
```typescript
circuitBreakerFailureThreshold: number;        // Default: 5
circuitBreakerOpenDuration: number;            // Default: 30 minutes (ms)
circuitBreakerHalfOpenSuccessThreshold: number; // Default: 2
```

**State Transitions**:
1. **Closed → Open**: When `failureCount >= failureThreshold`
2. **Open → Half-Open**: When `currentTime > circuitOpenUntil`
3. **Half-Open → Closed**: When `halfOpenSuccessCount >= halfOpenSuccessThreshold`
4. **Half-Open → Open**: On any failure

### 6.2 Endpoint-Level Circuit Breaker

**Implementation** (`/Users/ding/Github/claude-code-hub/src/lib/endpoint-circuit-breaker.ts`):

**Default Configuration**:
```typescript
failureThreshold: 3,
openDuration: 300000,  // 5 minutes
halfOpenSuccessThreshold: 1
```

**Integration with Provider Selection** (`/Users/ding/Github/claude-code-hub/src/lib/provider-endpoints/endpoint-selector.ts:44-51`):
```typescript
const circuitResults = await Promise.all(
  filtered.map(async (endpoint) => ({
    endpoint,
    isOpen: await isEndpointCircuitOpen(endpoint.id),
  }))
);
const candidates = circuitResults.filter(({ isOpen }) => !isOpen).map(({ endpoint }) => endpoint);
```

### 6.3 Vendor-Type Circuit Breaker

**Implementation** (`/Users/ding/Github/claude-code-hub/src/lib/vendor-type-circuit-breaker.ts`):

Temporary circuit breaker for vendor+type combinations to prevent session reuse bypassing fault isolation.

### 6.4 Failure Recording

**When to Record** (`/Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/forwarder.ts`):

| Error Category | Record to Circuit Breaker | Notes |
|----------------|---------------------------|-------|
| PROVIDER_ERROR | Yes | After retry exhaustion |
| SYSTEM_ERROR | Configurable | `ENABLE_CIRCUIT_BREAKER_ON_NETWORK_ERRORS` |
| RESOURCE_NOT_FOUND | No | 404 errors don't count |
| CLIENT_ABORT | No | Client disconnection |
| NON_RETRYABLE_CLIENT_ERROR | No | Client input error |

**Probe Request Exclusion** (`/Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/forwarder.ts:1034-1040`):
```typescript
if (session.isProbeRequest()) {
  // Skip circuit breaker for health check probes
} else {
  await recordFailure(currentProvider.id, lastError);
}
```

---

## 7. Endpoint-Level Failover (端点级故障转移)

### 7.1 Endpoint Selection Strategy

**getPreferredProviderEndpoints()** (`/Users/ding/Github/claude-code-hub/src/lib/provider-endpoints/endpoint-selector.ts:30-54`):

Returns endpoints sorted by:
1. **Circuit state** - Closed circuits first
2. **Probe status** - `lastProbeOk === true` prioritized
3. **Sort order** - Configured `sortOrder` field
4. **Latency** - `lastProbeLatencyMs` ascending

### 7.2 Endpoint Stickiness

**Implementation** (`/Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/forwarder.ts:799-808`):

```typescript
// Network error: advance to next endpoint for retry
// This implements "endpoint stickiness" where network errors switch endpoints
// but non-network errors (PROVIDER_ERROR) keep the same endpoint
currentEndpointIndex++;
```

- **Network errors** (`SYSTEM_ERROR`): Try next endpoint
- **Provider errors** (`PROVIDER_ERROR`): Keep same endpoint
- **404 errors**: Keep same endpoint (will failover provider after retries)

### 7.3 HTTP/2 Fallback

**Implementation** (`/Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/forwarder.ts:1862-1895`):

When HTTP/2 protocol errors occur:
1. Detect `HPE_INVALID_HEADER_TOKEN` or `HPE_INVALID_CONSTANT`
2. Retry with HTTP/1.1 (`http1FallbackInit`)
3. Log success/failure for monitoring

### 7.4 Proxy Fallback

**Configuration** (`/Users/ding/Github/claude-code-hub/src/types/provider.ts:108`):
```typescript
proxyFallbackToDirect: boolean;  // Default: false
```

**Implementation** (`/Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/forwarder.ts:1922-1946`):

When proxy connection fails and `fallbackToDirect` is enabled:
1. Remove proxy dispatcher from fetch config
2. Attempt direct connection
3. If successful, continue; otherwise throw original error

---

## 8. Configuration Reference (配置参考)

### 8.1 Environment Variables

| Variable | Default | Range | Description |
|----------|---------|-------|-------------|
| `MAX_RETRY_ATTEMPTS_DEFAULT` | 2 | 1-10 | Default retry attempts per provider |
| `ENABLE_CIRCUIT_BREAKER_ON_NETWORK_ERRORS` | false | boolean | Count network errors toward circuit breaker |
| `FETCH_BODY_TIMEOUT` | 600000 | ms | Request/response body timeout |
| `FETCH_HEADERS_TIMEOUT` | 600000 | ms | Response headers timeout |
| `FETCH_CONNECT_TIMEOUT` | 30000 | ms | TCP connection timeout |

### 8.2 Provider Configuration Fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `maxRetryAttempts` | number \| null | null | Provider-specific retry attempts |
| `circuitBreakerFailureThreshold` | number | 5 | Failures before opening circuit |
| `circuitBreakerOpenDuration` | number | 1800000 | Circuit open duration (ms) |
| `circuitBreakerHalfOpenSuccessThreshold` | number | 2 | Successes needed to close circuit |
| `proxyUrl` | string \| null | null | HTTP/HTTPS/SOCKS5 proxy URL |
| `proxyFallbackToDirect` | boolean | false | Allow direct connection on proxy failure |
| `firstByteTimeoutStreamingMs` | number | 0 | Streaming first byte timeout |
| `streamingIdleTimeoutMs` | number | 0 | Streaming idle timeout |
| `requestTimeoutNonStreamingMs` | number | 0 | Non-streaming request timeout |

### 8.3 Database Schema

**providers table** (`/Users/ding/Github/claude-code-hub/src/drizzle/schema.ts:228-239`):
```sql
max_retry_attempts INTEGER,
circuit_breaker_failure_threshold INTEGER DEFAULT 5,
circuit_breaker_open_duration INTEGER DEFAULT 1800000,
circuit_breaker_half_open_success_threshold INTEGER DEFAULT 2,
proxy_url VARCHAR(512),
proxy_fallback_to_direct BOOLEAN DEFAULT FALSE,
```

---

## 9. Edge Cases (边界情况)

### 9.1 All Providers Exhausted

When all providers fail, the system returns:
```typescript
throw new ProxyError("所有供应商暂时不可用，请稍后重试", 503);
```

This is intentionally vague to avoid exposing provider details.

### 9.2 Session Binding Conflicts

When a session is bound to a provider that becomes unavailable:
1. Circuit breaker check in `findReusable()` prevents reuse
2. Session migrates to new provider via `updateSessionBindingSmart()`
3. Original provider is excluded from future selection

### 9.3 Concurrent Session Limits

When provider's concurrent session limit is reached:
1. Atomic check-and-track in `ensure()` method
2. If limit exceeded, provider added to exclusion list
3. Fallback provider selected immediately

### 9.4 Empty Response Detection

**Implementation** (`/Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/forwarder.ts:343-354`):

Non-streaming responses with `Content-Length: 0` throw `EmptyResponseError`, which is treated as `PROVIDER_ERROR` and triggers failover.

### 9.5 Timeout Handling

**Response Timeout Types**:
- `streaming_first_byte` - Time to first byte for streaming requests
- `streaming_idle` - Idle time between chunks
- `non_streaming` - Total request timeout

On timeout, a `ProxyError` with status 524 is thrown, categorized as `PROVIDER_ERROR`.

---

## 10. Source File References (源文件引用)

### Core Files

| File Path | Description |
|-----------|-------------|
| `/Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/forwarder.ts` | Main failover and retry logic (2000+ lines) |
| `/Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/provider-selector.ts` | Provider selection algorithm |
| `/Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/errors.ts` | Error classification and detection |
| `/Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/error-handler.ts` | Error response handling |
| `/Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy-handler.ts` | Entry point for proxy requests |

### Circuit Breaker Files

| File Path | Description |
|-----------|-------------|
| `/Users/ding/Github/claude-code-hub/src/lib/circuit-breaker.ts` | Provider-level circuit breaker |
| `/Users/ding/Github/claude-code-hub/src/lib/endpoint-circuit-breaker.ts` | Endpoint-level circuit breaker |
| `/Users/ding/Github/claude-code-hub/src/lib/vendor-type-circuit-breaker.ts` | Vendor-type circuit breaker |
| `/Users/ding/Github/claude-code-hub/src/lib/redis/circuit-breaker-state.ts` | Circuit state persistence |
| `/Users/ding/Github/claude-code-hub/src/lib/redis/circuit-breaker-config.ts` | Circuit config persistence |

### Endpoint Files

| File Path | Description |
|-----------|-------------|
| `/Users/ding/Github/claude-code-hub/src/lib/provider-endpoints/endpoint-selector.ts` | Endpoint ranking and selection |

### Configuration Files

| File Path | Description |
|-----------|-------------|
| `/Users/ding/Github/claude-code-hub/src/lib/config/env.schema.ts` | Environment variable schema |
| `/Users/ding/Github/claude-code-hub/src/lib/constants/provider.constants.ts` | Provider configuration limits |
| `/Users/ding/Github/claude-code-hub/src/types/provider.ts` | TypeScript type definitions |
| `/Users/ding/Github/claude-code-hub/src/drizzle/schema.ts` | Database schema |

### Supporting Files

| File Path | Description |
|-----------|-------------|
| `/Users/ding/Github/claude-code-hub/src/lib/session-manager.ts` | Session binding and migration |
| `/Users/ding/Github/claude-code-hub/src/repository/error-rules.ts` | Error rule definitions |
| `/Users/ding/Github/claude-code-hub/src/lib/error-rule-detector.ts` | Error pattern detection |
| `/Users/ding/Github/claude-code-hub/src/lib/webhook/utils/retry.ts` | Generic retry utility |

---

## 11. Key Insights (关键洞察)

1. **Retry is per-provider, not per-request**: The system retries within a provider before considering failover
2. **Endpoint stickiness for provider errors**: Provider errors (4xx/5xx) keep the same endpoint; network errors switch endpoints
3. **Circuit breaker is failure-agnostic**: Once threshold is reached, all requests are blocked regardless of error type
4. **404 is special**: Not counted toward circuit breaker, but still triggers failover after retries
5. **Network errors are configurable**: Can be excluded from circuit breaker by default
6. **Probe requests are protected**: Health checks don't affect circuit breaker state
7. **Session binding provides consistency**: Users stick to providers unless they fail
8. **Multi-layered protection**: Provider-level, endpoint-level, and vendor-type circuit breakers

---

*Report generated for documentation page: `/docs/proxy/failover-retry`*
