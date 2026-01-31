# Intelligent Routing Algorithm Analysis Report

## 1. Intent Analysis

The intelligent routing algorithm in claude-code-hub is designed to provide a sophisticated multi-layered provider selection mechanism that optimizes for cost, reliability, and user experience. The primary intents are:

- **Cost Optimization**: Select providers with lower cost multipliers while maintaining service quality
- **Load Balancing**: Distribute traffic across multiple providers using weighted random selection
- **Failover Resilience**: Automatically retry with alternative providers when failures occur
- **Session Affinity**: Maintain consistent provider binding for multi-turn conversations
- **Access Control**: Enforce provider group isolation between different user segments
- **Health Awareness**: Integrate circuit breaker patterns and rate limiting to avoid unhealthy providers

The routing system acts as the core decision engine within the proxy pipeline (`/Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/provider-selector.ts`), determining which upstream provider will handle each incoming request.

## 2. Behavior Summary

### 2.1 Core Routing Flow

The routing algorithm follows a multi-step selection process defined in `ProxyProviderResolver.pickRandomProvider()`:

```
Step 1: Group Pre-filtering → Step 2: Format/Model Matching → Step 2.5: 1M Context Filter
  → Step 3: Candidate Selection → Step 4: Health Check Filtering
  → Step 5: Priority Stratification → Step 6: Cost Sorting + Weighted Selection
```

#### Step 1: Group Pre-filtering
Users can only see providers matching their assigned group. The system checks `provider.groupTag` against the user's `providerGroup` (priority: key > user). Groups support comma-separated multi-tag matching (e.g., "premium,cli" matches users with either tag).

#### Step 2: Format and Model Matching
The algorithm filters providers based on:
- **Format Compatibility**: Maps client format (claude/response/openai/gemini/gemini-cli) to compatible provider types. When `originalFormat` is not set, defaults to "claude" for backward compatibility
- **Model Support**: Uses `providerSupportsModel()` to check if the provider can handle the requested model:
  - Claude models: Anthropic providers use allowedModels whitelist; non-Anthropic providers check joinClaudePool + modelRedirects
  - Non-Claude models: Check explicit declarations in allowedModels or modelRedirects
- **Format Type Mismatch**: Providers incompatible with the client's request format are filtered with reason `format_type_mismatch`

#### Step 2.5: 1M Context Window Filter
When clients request 1M context (`clientRequestsContext1m()`), providers with `context1mPreference === 'disabled'` are filtered out.

The decision context tracks provider counts after this filter via `afterGroupFilter` field.

#### Step 4: Health Check Filtering
The `filterByLimits()` method performs comprehensive health checks:
- Vendor-type circuit breaker check (`isVendorTypeCircuitOpen`)
- Provider circuit breaker check (`isCircuitOpen`)
- Cost limit checks (5h, daily, weekly, monthly via `RateLimitService.checkCostLimitsWithLease`)
- Total cost limit check (`RateLimitService.checkTotalCostLimit`)

#### Step 5: Priority Stratification
Only providers with the highest priority (lowest numeric value) are selected. Priority values default to 0, with higher numbers indicating lower priority tiers (0 = primary, 1 = backup, 2 = emergency).

#### Step 6: Cost Sorting and Weighted Selection
Within the same priority tier:
1. Providers are sorted by `costMultiplier` (ascending)
2. Weighted random selection is applied using `weightedRandom()`
3. Selection probability = provider.weight / totalWeight

### 2.2 Session Reuse (Sticky Sessions)

The `findReusable()` method implements session affinity:
- For multi-turn conversations (>1 message), the system attempts to reuse the previously bound provider
- Binding is stored in Redis as `session:{sessionId}:provider` with TTL
- Reuse validation includes: provider existence, enabled status, group permission, and cost limits
- Session binding uses SET NX (atomic) to prevent race conditions during concurrent requests

### 2.3 Failover and Retry Logic

The `ensure()` method implements a failover loop:
1. **Initial Selection**: Pick a provider using the full selection algorithm
2. **Concurrent Limit Check**: Atomically check and track session count against `limitConcurrentSessions`
3. **On Failure**: Add provider to exclusion list, retry with `pickRandomProvider(session, excludedProviders)`
4. **Decision Chain Recording**: Log each attempt with metadata (reason, circuit state, error details)
5. **Final Error**: Return 503 when all providers exhausted

### 2.4 Weighted Random Selection Algorithm

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
    if (random < cumulativeWeight) return provider;
  }
  return providers[providers.length - 1];
}
```

Example: Providers with weights 1:2:3 have selection probabilities of 16.7%:33.3%:50%.

## 3. Configuration and Commands

### 3.1 Provider Configuration Fields

Located in `/Users/ding/Github/claude-code-hub/src/types/provider.ts`:

| Field | Type | Description |
|-------|------|-------------|
| `weight` | number | Selection weight (default: 1, range: 1-100) |
| `priority` | number | Priority tier (default: 0, lower = higher priority) |
| `costMultiplier` | number | Cost calculation multiplier (default: 1.0) |
| `groupTag` | string | Comma-separated group tags for access control |
| `providerType` | ProviderType | claude/claude-auth/codex/gemini/gemini-cli/openai-compatible |
| `allowedModels` | string[] | Model whitelist/declaration list |
| `modelRedirects` | Record<string,string> | Model name remapping |
| `joinClaudePool` | boolean | Allow non-Anthropic providers to handle Claude models |
| `limitConcurrentSessions` | number | Max concurrent sessions per provider |
| `circuitBreakerFailureThreshold` | number | Failures before opening circuit (default: 5) |
| `circuitBreakerOpenDuration` | number | Milliseconds to keep circuit open (default: 1800000) |
| `circuitBreakerHalfOpenSuccessThreshold` | number | Successes needed to close circuit (default: 2) |

### 3.2 Circuit Breaker States

Located in `/Users/ding/Github/claude-code-hub/src/lib/circuit-breaker.ts`:

- **Closed**: Normal operation, requests pass through
- **Open**: Circuit tripped, requests rejected immediately
- **Half-Open**: Testing state after timeout, limited requests allowed

State transitions:
- Closed → Open: Failure count exceeds threshold
- Open → Half-Open: Timeout duration elapsed (`circuitBreakerOpenDuration`)
- Half-Open → Closed: Success count reaches `circuitBreakerHalfOpenSuccessThreshold`
- Half-Open → Open: Any failure during half-open

### 3.3 Session Configuration

Session binding TTL: Defined in `SessionManager.SESSION_TTL` (default: 300 seconds / 5 minutes, configurable via `SESSION_TTL` environment variable)
Redis keys:
- `session:{sessionId}:provider` - Provider binding
- `hash:{contentHash}:session` - Content-based session deduplication

**Note on Delayed Binding**: Session binding occurs after successful request completion, not during initial selection. This ensures sessions are only bound to providers that actually succeed, avoiding binding to providers that pass concurrent checks but fail during request execution.

### 3.4 API Endpoints for Provider Selection

The `selectProviderByType()` method in `ProxyProviderResolver` is exposed for `/v1/models` endpoint to return available models per provider type.

```typescript
static async selectProviderByType(
  authState: {
    user: { id: number; providerGroup: string | null } | null;
    key: { providerGroup: string | null } | null;
  } | null,
  providerType: Provider["providerType"]
): Promise<{ provider: Provider | null; context: DecisionContext }>
```

### 3.5 Additional Public Methods

**pickRandomProviderWithExclusion**: Selects a provider while excluding specific provider IDs (used for retry scenarios)
```typescript
static async pickRandomProviderWithExclusion(
  session: ProxySession,
  excludeIds: number[]
): Promise<Provider | null>
```

### 3.6 Error Types

The routing system returns different error types when provider selection fails:

| Error Type | Condition |
|------------|-----------|
| `no_available_providers` | No providers after initial filtering |
| `all_providers_failed` | All providers tried and failed |
| `rate_limit_exceeded` | All enabled providers rate limited |
| `circuit_breaker_open` | All enabled providers circuit open |
| `mixed_unavailable` | Mix of rate limited and circuit open |
| `concurrent_limit_exceeded` | All providers hit concurrent session limits |

### 3.7 Verbose Error Mode

When enabled via system settings (`verboseProviderError`), detailed filtering reasons are included in error responses. This is cached for 60 seconds to avoid frequent database queries.

## 4. Edge Cases

### 4.1 No Available Providers
When all providers are filtered out (health checks, limits, circuit breakers), the system returns HTTP 503 with error type `no_available_providers`. If verbose error mode is enabled, detailed filtering reasons are included.

### 4.2 Concurrent Session Limit Exceeded
When a provider's `limitConcurrentSessions` is reached:
1. The provider is excluded from current selection
2. A retry is attempted with remaining providers
3. If all providers hit limits, 503 is returned with `concurrent_limit_exceeded` error type

### 4.3 Session Provider No Longer Available
During session reuse (`findReusable`):
- If bound provider is disabled/deleted → Return null (triggers new selection)
- If bound provider exceeds cost limits → Return null
- If bound provider's group no longer matches user → Return null
- If vendor-type circuit breaker is open for the provider → Return null (prevents session reuse from bypassing fault isolation)

### 4.4 Circuit Breaker Race Conditions
The circuit breaker uses both in-memory state and Redis persistence:
- State changes are persisted to Redis asynchronously
- On startup, states are loaded from Redis
- For open/half-open states, Redis is checked on every `isCircuitOpen()` call to sync external resets

### 4.5 Model Redirect Conflicts
When switching providers during failover:
- Original model name is preserved via `session.setOriginalModel()`
- New provider's `modelRedirects` is applied
- If new provider has no redirect for the model, it resets to original

### 4.6 Group Permission Changes
Group matching supports multi-tag providers and single-tag users:
- Provider with "premium,cli" is accessible to users with either "premium" OR "cli"
- Users with "*" (PROVIDER_GROUP.ALL) can access all providers
- Users without explicit group assignment default to "default"
- **Strict Isolation**: Providers without a `groupTag` cannot be accessed by users who have explicit group restrictions (enforced to prevent unauthorized access)

### 4.7 1M Context Window Handling
When `clientRequestsContext1m()` returns true:
- Providers with `context1mPreference === 'disabled'` are excluded
- Both 'inherit' and 'force_enable' preferences allow the request
- If no providers support 1M context after filtering, returns null provider

## 5. References

### 5.1 Core Implementation Files

| File | Purpose |
|------|---------|
| `/Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/provider-selector.ts` | Main routing algorithm implementation (1200+ lines) |
| `/Users/ding/Github/claude-code-hub/src/lib/circuit-breaker.ts` | Circuit breaker state machine and logic |
| `/Users/ding/Github/claude-code-hub/src/lib/session-manager.ts` | Session binding and provider affinity management |
| `/Users/ding/Github/claude-code-hub/src/lib/vendor-type-circuit-breaker.ts` | Vendor-level circuit breaker for provider types |
| `/Users/ding/Github/claude-code-hub/src/lib/endpoint-circuit-breaker.ts` | Endpoint-level circuit breaker |
| `/Users/ding/Github/claude-code-hub/src/lib/provider-endpoints/endpoint-selector.ts` | Endpoint ranking and selection within a vendor |

### 5.2 Type Definitions

| File | Purpose |
|------|---------|
| `/Users/ding/Github/claude-code-hub/src/types/provider.ts` | Provider interface and type definitions |
| `/Users/ding/Github/claude-code-hub/src/types/message.ts` | ProviderChainItem and decision context types |
| `/Users/ding/Github/claude-code-hub/src/lib/constants/provider.constants.ts` | Provider configuration constants |

### 5.3 Configuration and UI

| File | Purpose |
|------|---------|
| `/Users/ding/Github/claude-code-hub/src/app/[locale]/settings/providers/_components/forms/provider-form/sections/routing-section.tsx` | Provider routing configuration UI |
| `/Users/ding/Github/claude-code-hub/src/drizzle/schema.ts` | Database schema for providers table |
| `/Users/ding/Github/claude-code-hub/src/lib/redis/circuit-breaker-config.ts` | Circuit breaker Redis configuration |
| `/Users/ding/Github/claude-code-hub/src/lib/redis/circuit-breaker-state.ts` | Circuit breaker Redis state management |

### 5.4 Session and Request Context

| File | Purpose |
|------|---------|
| `/Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/session.ts` | ProxySession class with provider chain tracking |
| `/Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/forwarder.ts` | Request forwarding with retry logic |
| `/Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/response-handler.ts` | Response handling and circuit breaker updates |

### 5.5 Decision Context Structure

The `DecisionContext` object captures detailed information about the provider selection process:

```typescript
interface DecisionContext {
  totalProviders: number;           // Total providers in system
  enabledProviders: number;         // After basic filtering
  targetType: "claude" | "codex" | "openai-compatible" | "gemini" | "gemini-cli";
  requestedModel: string;
  groupFilterApplied: boolean;
  userGroup?: string;
  afterGroupFilter?: number;        // After 1M context filter
  beforeHealthCheck: number;
  afterHealthCheck: number;
  filteredProviders: Array<{
    id: number;
    name: string;
    reason: string;                 // e.g., "circuit_open", "rate_limited", "format_type_mismatch"
    details?: string;
  }>;
  priorityLevels: number[];
  selectedPriority: number;
  candidatesAtPriority: Array<{
    id: number;
    name: string;
    weight: number;
    costMultiplier: number;
    probability?: number;
  }>;
  excludedProviderIds?: number[];
  concurrentLimit?: number;         // For concurrent limit errors
  currentConcurrent?: number;
}
```

### 5.6 Key Classes and Methods

```typescript
// Main resolver class
class ProxyProviderResolver {
  static async ensure(session: ProxySession): Promise<Response | null>
  static async pickRandomProvider(session?: ProxySession, excludeIds?: number[]): Promise<{provider: Provider | null, context: DecisionContext}>
  static async pickRandomProviderWithExclusion(session: ProxySession, excludeIds: number[]): Promise<Provider | null>
  static async selectProviderByType(authState: { user: { id: number; providerGroup: string | null } | null; key: { providerGroup: string | null } | null; } | null, providerType: Provider["providerType"]): Promise<{provider: Provider | null, context: DecisionContext}>
  private static async findReusable(session: ProxySession): Promise<Provider | null>
  private static async filterByLimits(providers: Provider[]): Promise<Provider[]>
  private static selectTopPriority(providers: Provider[]): Provider[]
  private static selectOptimal(providers: Provider[]): Provider
  private static weightedRandom(providers: Provider[]): Provider
}

// Session manager for binding
class SessionManager {
  static async bindSessionToProvider(sessionId: string, providerId: number): Promise<void>
  static async getSessionProvider(sessionId: string): Promise<number | null>
  static async updateSessionBindingSmart(sessionId: string, newProviderId: number, ...): Promise<{updated: boolean, reason: string}>
}

// Circuit breaker functions
async function isCircuitOpen(providerId: number): Promise<boolean>
async function recordFailure(providerId: number, error: Error): Promise<void>
async function recordSuccess(providerId: number): Promise<void>
function getCircuitState(providerId: number): "closed" | "open" | "half-open"
```

---

*Report generated from analysis of claude-code-hub codebase*
*Total word count: ~4800 characters*
