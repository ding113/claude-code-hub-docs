# Provider Aggregation (供应商聚合)

## Intent Analysis

Provider aggregation is the core mechanism that enables claude-code-hub to distribute requests across multiple upstream providers intelligently. When you're running a production AI proxy, you don't want a single point of failure. Provider aggregation solves this by allowing you to configure multiple providers with different characteristics and letting the system automatically route requests to the most appropriate one based on availability, cost, priority, and user permissions.

The system is designed around several key principles:

1. **High Availability**: When one provider fails, requests automatically failover to alternatives
2. **Cost Optimization**: Route requests to cheaper providers when possible
3. **Access Control**: Different users can access different subsets of providers
4. **Session Stickiness**: Multi-turn conversations stay with the same provider for consistency
5. **Health Awareness**: Unhealthy providers are automatically removed from the pool

## Behavior Summary

### Provider Selection Pipeline

The provider selection process follows a multi-stage pipeline defined in `/Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/provider-selector.ts`. When a request arrives, the system goes through these steps:

**Step 1: Group Pre-filtering**
The system first filters providers based on the user's assigned provider group. Each user or API key can be assigned to specific groups, and they can only see providers matching those groups. This is a silent filter - users are unaware of providers outside their assigned groups.

```typescript
// From /Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/provider-selector.ts
const effectiveGroupPick = getEffectiveProviderGroup(session);
let visibleProviders = allProviders;
if (effectiveGroupPick) {
  const groupFiltered = allProviders.filter((p) =>
    checkProviderGroupMatch(p.groupTag, effectiveGroupPick)
  );
  visibleProviders = groupFiltered;
}
```

**Step 2: Format and Model Matching**
Providers are filtered based on whether they support the requested model and API format. The system checks:
- Provider type compatibility (claude, codex, openai-compatible, gemini, etc.)
- Model support via `allowedModels` whitelist
- Model redirects for non-standard model names

**Step 3: 1M Context Filtering**
If the client requests 1M context window, providers with `context1mPreference === 'disabled'` are filtered out.

**Step 4: Health Check Filtering**
The `filterByLimits` method checks multiple health indicators:
- Circuit breaker state (open/closed/half-open)
- Cost limits (5h, daily, weekly, monthly, total)
- Vendor-type circuit breakers

**Step 5: Priority Stratification**
Only providers with the highest priority (lowest priority number) are selected. This ensures primary providers are always preferred over backups.

```typescript
// From /Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/provider-selector.ts
private static selectTopPriority(providers: Provider[]): Provider[] {
  const minPriority = Math.min(...providers.map((p) => p.priority || 0));
  return providers.filter((p) => (p.priority || 0) === minPriority);
}
```

**Step 6: Cost-Weighted Selection**
Within the same priority tier, providers are sorted by cost multiplier and then selected using weighted random distribution.

### Session Reuse

For multi-turn conversations, the system attempts to reuse the same provider to maintain context consistency. This is handled by the `findReusable` method:

```typescript
// From /Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/provider-selector.ts
private static async findReusable(session: ProxySession): Promise<Provider | null> {
  // Only reuse if session has messages > 1
  if (!session.shouldReuseProvider()) {
    return null;
  }
  
  // Check if previous provider still healthy and within limits
  const costCheck = await RateLimitService.checkCostLimitsWithLease(provider.id, "provider", {
    limit_5h_usd: provider.limit5hUsd,
    limit_daily_usd: provider.limitDailyUsd,
    // ... other limits
  });
  
  if (!costCheck.allowed) {
    return null;
  }
  
  return provider;
}
```

Session reuse only occurs when:
- The conversation has more than one message
- The previous provider is still healthy
- The provider hasn't exceeded cost limits
- The user still has permission to access that provider

### Failover and Retry Chains

When a provider fails during request processing, the system implements a sophisticated failover mechanism:

```typescript
// From /Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/provider-selector.ts
// === Failover Loop ===
let attemptCount = 0;
while (true) {
  attemptCount++;
  
  if (!session.provider) {
    break; // No available providers, exit loop
  }
  
  // Atomic concurrent session check
  const checkResult = await RateLimitService.checkAndTrackProviderSession(
    session.provider.id,
    session.sessionId,
    limit
  );
  
  if (!checkResult.allowed) {
    // Add to exclusion list and retry
    excludedProviders.push(session.provider.id);
    const { provider: fallbackProvider } = await ProxyProviderResolver.pickRandomProvider(
      session, 
      excludedProviders
    );
    session.setProvider(fallbackProvider);
    continue;
  }
  
  // Provider selected successfully
  break;
}
```

The failover mechanism:
1. Tracks failed providers in an exclusion list
2. Attempts to select an alternative provider
3. Records each attempt in the provider chain for debugging
4. Continues until a healthy provider is found or all options are exhausted

### Provider Chain Tracking

Every provider selection and failover is tracked in the `providerChain` array within the session:

```typescript
// From /Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/session.ts
interface ProviderChainItem {
  id: number;
  name: string;
  vendorId?: number;
  providerType: ProviderType;
  reason?: "session_reuse" | "initial_selection" | "concurrent_limit_failed" | 
           "retry_success" | "retry_failed" | "system_error" | ...;
  selectionMethod?: "session_reuse" | "weighted_random" | "group_filtered";
  circuitState?: "closed" | "open" | "half-open";
  priority: number;
  weight: number;
  costMultiplier: number;
  groupTag: string | null;
  timestamp: number;
  attemptNumber?: number;
  errorMessage?: string;
  decisionContext?: ProviderSelectionContext;
}
```

This tracking enables:
- Debugging provider selection decisions
- Understanding why certain providers were skipped
- Analyzing failover patterns
- Cost attribution per provider

## Config/Commands

### Provider Configuration Fields

The provider schema in `/Users/ding/Github/claude-code-hub/src/drizzle/schema.ts` defines these aggregation-related fields:

```typescript
// From /Users/ding/Github/claude-code-hub/src/drizzle/schema.ts
export const providers = pgTable('providers', {
  id: serial('id').primaryKey(),
  name: varchar('name').notNull(),
  url: varchar('url').notNull(),
  key: varchar('key').notNull(),
  providerVendorId: integer('provider_vendor_id')
    .notNull()
    .references(() => providerVendors.id),
  
  // Enable/disable provider
  isEnabled: boolean('is_enabled').notNull().default(true),
  
  // Weight for weighted random selection (1-100)
  weight: integer('weight').notNull().default(1),
  
  // Priority - lower is higher priority
  priority: integer('priority').notNull().default(0),
  
  // Cost multiplier for cost-based optimization
  costMultiplier: numeric('cost_multiplier', { precision: 10, scale: 4 }).default('1.0'),
  
  // Group tag for access control (supports comma-separated multi-tags)
  groupTag: varchar('group_tag', { length: 50 }),
  
  // Provider type determines API format
  providerType: varchar('provider_type', { length: 20 })
    .notNull()
    .default('claude')
    .$type<ProviderType>(),
  
  // Model whitelist/declaration
  allowedModels: jsonb('allowed_models').$type<string[]>(),
  
  // Join Claude scheduling pool (for non-Anthropic providers)
  joinClaudePool: boolean('join_claude_pool').notNull().default(false),
  
  // Model redirects
  modelRedirects: jsonb('model_redirects').$type<Record<string, string>>(),
  
  // Cost limits
  limit5hUsd: numeric('limit_5h_usd', { precision: 10, scale: 2 }),
  limitDailyUsd: numeric('limit_daily_usd', { precision: 10, scale: 2 }),
  limitWeeklyUsd: numeric('limit_weekly_usd', { precision: 10, scale: 2 }),
  limitMonthlyUsd: numeric('limit_monthly_usd', { precision: 10, scale: 2 }),
  limitTotalUsd: numeric('limit_total_usd', { precision: 10, scale: 2 }),
  
  // Concurrent session limit
  limitConcurrentSessions: integer('limit_concurrent_sessions').default(0),
});
```

### Provider Group Configuration

Provider groups are defined using the `groupTag` field which supports comma-separated multi-tags:

```typescript
// From /Users/ding/Github/claude-code-hub/src/lib/constants/provider.constants.ts
export const PROVIDER_GROUP = {
  /** Default group identifier - for keys/providers without explicit group */
  DEFAULT: "default",
  /** Global access identifier - can access all providers (admin only) */
  ALL: "*",
} as const;
```

Group matching logic from `/Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/provider-selector.ts`:

```typescript
function checkProviderGroupMatch(providerGroupTag: string | null, userGroups: string): boolean {
  const groups = parseGroupString(userGroups);
  
  if (groups.includes(PROVIDER_GROUP.ALL)) {
    return true; // Admin wildcard access
  }
  
  const providerTags = providerGroupTag
    ? parseGroupString(providerGroupTag)
    : [PROVIDER_GROUP.DEFAULT];
  
  // Check for intersection between provider tags and user groups
  return providerTags.some((tag) => groups.includes(tag));
}
```

### User/Key Group Assignment

Users and API keys can be assigned to provider groups via the `providerGroup` field:

```typescript
// From /Users/ding/Github/claude-code-hub/src/drizzle/schema.ts
export const users = pgTable('users', {
  // ... other fields
  providerGroup: varchar('provider_group', { length: 200 }).default('default'),
});

export const keys = pgTable('keys', {
  // ... other fields
  providerGroup: varchar('provider_group', { length: 200 }).default('default'),
});
```

The effective group is determined with key group taking priority:

```typescript
// From /Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/provider-selector.ts
function getEffectiveProviderGroup(session: ProxySession): string | null {
  const keyGroup = session?.authState?.key?.providerGroup;
  const userGroup = session?.authState?.user?.providerGroup;
  return keyGroup || userGroup || null;
}
```

### Provider Type Constants

The system supports multiple provider types for different API formats:

```typescript
// From /Users/ding/Github/claude-code-hub/src/types/provider.ts
export type ProviderType = 
  | "claude"           // Anthropic official API
  | "claude-auth"      // Claude relay service (Bearer only, no x-api-key)
  | "codex"            // Codex CLI (Response API)
  | "gemini"           // Google Gemini API
  | "gemini-cli"       // Gemini CLI wrapper
  | "openai-compatible"; // OpenAI Compatible API
```

### Weight and Priority Limits

```typescript
// From /Users/ding/Github/claude-code-hub/src/lib/constants/provider.constants.ts
export const PROVIDER_LIMITS = {
  // Weight: 1-100 for weighted polling
  WEIGHT: { MIN: 1, MAX: 100 },
  // Max retry attempts per provider
  MAX_RETRY_ATTEMPTS: { MIN: 1, MAX: 10 },
  // Cost limits
  LIMIT_5H_USD: { MIN: 0.1, MAX: 1000, STEP: 1 },
  LIMIT_WEEKLY_USD: { MIN: 1, MAX: 5000, STEP: 1 },
  LIMIT_MONTHLY_USD: { MIN: 10, MAX: 30000, STEP: 1 },
  // Concurrent sessions
  CONCURRENT_SESSIONS: { MIN: 1, MAX: 150 },
} as const;

export const PROVIDER_DEFAULTS = {
  IS_ENABLED: true,
  WEIGHT: 1,
  MAX_RETRY_ATTEMPTS: 2,
} as const;
```

## Edge Cases

### No Matching Providers

When no providers match the criteria, the system returns a 503 error with detailed context:

```typescript
// From /Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/provider-selector.ts
if (healthyProviders.length === 0) {
  logger.warn("ProviderSelector: All providers rate limited or unavailable");
  // Return null to trigger 503 error
  return { provider: null, context };
}
```

The error response includes:
- Total providers in system
- How many passed each filter stage
- Which providers were filtered and why
- User's effective group

### All Providers Rate Limited

When all providers exceed their cost limits:

```typescript
// From /Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/provider-selector.ts
const costCheck = await RateLimitService.checkCostLimitsWithLease(p.id, "provider", {
  limit_5h_usd: p.limit5hUsd,
  limit_daily_usd: p.limitDailyUsd,
  // ...
});

if (!costCheck.allowed) {
  logger.debug("ProviderSelector: Provider cost limit exceeded", {
    providerId: p.id,
  });
  return null; // Filter out this provider
}
```

The system logs which limit was exceeded and continues to the next provider in the failover chain.

### Concurrent Session Limit Race Condition

To prevent race conditions in concurrent session tracking, the system uses atomic Redis Lua scripts:

```typescript
// From /Users/ding/Github/claude-code-hub/src/lib/rate-limit/service.ts
static async checkAndTrackProviderSession(
  providerId: number,
  sessionId: string,
  limit: number
): Promise<{ allowed: boolean; count: number; tracked: boolean; reason?: string }> {
  // Execute Lua script for atomic check + track
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
  
  return { allowed: true, count, tracked: tracked === 1 };
}
```

### Circuit Breaker State Transitions

The circuit breaker implements a three-state machine:

```typescript
// From /Users/ding/Github/claude-code-hub/src/lib/circuit-breaker.ts
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
      return false; // Allow trial request
    }
    return true; // Still open
  }
  
  // half-open: allow trial
  return false;
}
```

State transitions:
- **Closed** -> **Open**: When failure count exceeds threshold
- **Open** -> **Half-Open**: When open duration expires
- **Half-Open** -> **Closed**: When success count reaches threshold in half-open
- **Half-Open** -> **Open**: When any failure occurs in half-open

### 1M Context Window Filtering

When a client requests 1M context, providers with `context1mPreference === 'disabled'` are excluded:

```typescript
// From /Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/provider-selector.ts
const clientRequestsContext1m = session?.clientRequestsContext1m() ?? false;
if (clientRequestsContext1m) {
  afterContext1mFilter = enabledProviders.filter((p) => {
    // Only filter if explicitly disabled
    return p.context1mPreference !== "disabled";
  });
  
  if (afterContext1mFilter.length === 0) {
    logger.warn("ProviderSelector: No providers support 1M context");
    return { provider: null, context };
  }
}
```

### Session Provider Group Mismatch

When a session tries to reuse a provider but the user's group no longer has access:

```typescript
// From /Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/provider-selector.ts
if (effectiveGroup) {
  if (!checkProviderGroupMatch(provider.groupTag, effectiveGroup)) {
    if (!provider.groupTag) {
      logger.warn(
        "ProviderSelector: Session provider has no group tag but user/key requires group",
        { providerId: provider.id, effectiveGroup }
      );
    } else {
      logger.warn(
        "ProviderSelector: Session provider group mismatch, rejecting reuse",
        { providerId: provider.id, providerGroup: provider.groupTag, effectiveGroup }
      );
    }
    return null; // Reject session reuse
  }
}
```

### Model Support Detection

The system uses sophisticated logic to determine if a provider supports a requested model:

```typescript
// From /Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/provider-selector.ts
function providerSupportsModel(provider: Provider, requestedModel: string): boolean {
  const isClaudeModel = requestedModel.startsWith("claude-");
  const isClaudeProvider =
    provider.providerType === "claude" || provider.providerType === "claude-auth";
  
  // Case 1: Claude model requests
  if (isClaudeModel) {
    // 1a. Anthropic providers
    if (isClaudeProvider) {
      if (!provider.allowedModels || provider.allowedModels.length === 0) {
        return true; // Allow all Claude models
      }
      return provider.allowedModels.includes(requestedModel);
    }
    
    // 1b. Non-Anthropic with joinClaudePool
    if (provider.joinClaudePool) {
      const redirectedModel = provider.modelRedirects?.[requestedModel];
      return redirectedModel?.startsWith("claude-") || false;
    }
    
    // 1c. Other cases
    return false;
  }
  
  // Case 2: Non-Claude models
  // Check explicit declaration first (allows cross-type proxying)
  const explicitlyDeclared = !!(
    provider.allowedModels?.includes(requestedModel) || 
    provider.modelRedirects?.[requestedModel]
  );
  
  if (explicitlyDeclared) {
    return true;
  }
  
  // Anthropic providers don't support non-Claude models unless declared
  if (isClaudeProvider) {
    return false;
  }
  
  // Non-Anthropic providers support any model
  return true;
}
```

### Format Compatibility Checking

The system ensures API format compatibility between client requests and provider types:

```typescript
// From /Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/provider-selector.ts
function checkFormatProviderTypeCompatibility(
  format: ClientFormat,
  providerType: Provider["providerType"]
): boolean {
  switch (format) {
    case "claude":
      return providerType === "claude" || providerType === "claude-auth";
    case "response":
      return providerType === "codex";
    case "openai":
      return providerType === "openai-compatible";
    case "gemini":
      return providerType === "gemini";
    case "gemini-cli":
      return providerType === "gemini-cli";
    default:
      return true; // Unknown format defaults to compatible
  }
}
```

**Format to Provider Mapping:**

| Client Format | Compatible Provider Types |
|--------------|--------------------------|
| `claude` | `claude`, `claude-auth` |
| `response` | `codex` |
| `openai` | `openai-compatible` |
| `gemini` | `gemini` |
| `gemini-cli` | `gemini-cli` |

### Provider Type Details

The system supports six provider types, each designed for specific API formats:

**1. Claude (`claude`)**
- Direct Anthropic Claude API
- Supports all Claude models
- Uses standard Anthropic authentication
- Default provider type

**2. Claude Auth (`claude-auth`)**
- Claude relay services
- Bearer-only authentication (no x-api-key header)
- Compatible with Claude API format
- Useful for third-party Claude-compatible services

**3. Codex (`codex`)**
- OpenAI Responses API
- Designed for Codex CLI integration
- Supports response-style API calls
- Handles tool calling differently than standard OpenAI

**4. Gemini (`gemini`)**
- Google Gemini API direct integration
- Native Gemini request/response format
- Supports Gemini-specific features
- URL path-based model specification

**5. Gemini CLI (`gemini-cli`)**
- Gemini CLI wrapper format
- Special request wrapping for CLI compatibility
- Handles wrapped request bodies

**6. OpenAI Compatible (`openai-compatible`)**
- Generic OpenAI-compatible API format
- Works with any OpenAI API-compatible service
- Flexible model support

### Dual-Loop Retry System

The forwarder implements a sophisticated dual-loop retry mechanism:

```typescript
// From /Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/forwarder.ts
const MAX_PROVIDER_SWITCHES = 20; // Safety limit
const failedProviderIds: number[] = [];

// Outer loop: Provider switching
while (totalProvidersAttempted < MAX_PROVIDER_SWITCHES) {
  totalProvidersAttempted++;
  let attemptCount = 0;
  let maxAttemptsPerProvider = resolveMaxAttemptsForProvider(currentProvider);

  // Inner loop: Retry current provider
  while (attemptCount < maxAttemptsPerProvider) {
    attemptCount++;
    
    try {
      const response = await ProxyForwarder.doForward(...);
      return response; // Success: exit all loops
    } catch (error) {
      const errorCategory = await categorizeErrorAsync(error);
      
      // Handle based on error category
      switch (errorCategory) {
        case ErrorCategory.CLIENT_ABORT:
          throw error; // Don't retry client aborts
          
        case ErrorCategory.NON_RETRYABLE_CLIENT_ERROR:
          throw error; // Don't retry client errors
          
        case ErrorCategory.SYSTEM_ERROR:
          if (attemptCount < maxAttemptsPerProvider) {
            await delay(100);
            continue; // Retry same provider
          }
          failedProviderIds.push(currentProvider.id);
          break; // Switch provider
          
        case ErrorCategory.PROVIDER_ERROR:
          if (attemptCount < maxAttemptsPerProvider) {
            await delay(100);
            continue; // Retry same provider
          }
          await recordFailure(currentProvider.id, error);
          failedProviderIds.push(currentProvider.id);
          break; // Switch provider
      }
    }
  }
  
  // Select alternative provider
  const alternative = await ProxyForwarder.selectAlternative(session, failedProviderIds);
  if (!alternative) break; // No more providers
  currentProvider = alternative;
}
```

**Error Categories:**

1. **CLIENT_ABORT**: Client disconnected, immediate failure
2. **NON_RETRYABLE_CLIENT_ERROR**: Invalid requests (prompt too long, content filtered), immediate failure
3. **SYSTEM_ERROR**: Network issues, retry once then switch
4. **RESOURCE_NOT_FOUND**: 404 errors, retry then switch
5. **PROVIDER_ERROR**: 4xx/5xx errors, retry then switch with circuit breaker recording

### Model Redirects

Providers can configure model name redirections:

```typescript
// From /Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/model-redirector.ts
export class ModelRedirector {
  static apply(session: ProxySession, provider: Provider): boolean {
    const trueOriginalModel = session.getOriginalModel() || session.request.model;
    
    if (!provider.modelRedirects || Object.keys(provider.modelRedirects).length === 0) {
      return false;
    }

    const redirectedModel = provider.modelRedirects[originalModel];
    if (!redirectedModel) {
      return false;
    }

    // Apply redirect - modify request model
    session.request.message.model = redirectedModel;
    session.request.model = redirectedModel;
    
    // Special handling for Gemini URL paths
    if (provider.providerType === "gemini" || provider.providerType === "gemini-cli") {
      // Replace model in URL path: /models/{model}:action
    }
    
    return true;
  }
}
```

**Use Cases:**
- Cost optimization: Redirect expensive models to cheaper alternatives
- Third-party integration: Map Claude model names to provider-specific names
- A/B testing: Redirect portions of traffic to different model versions

### Join Claude Pool Mechanism

Non-Anthropic providers can participate in Claude model scheduling:

```typescript
// From /Users/ding/Github/claude-code-hub/src/drizzle/schema.ts
joinClaudePool: boolean('join_claude_pool').default(false),
```

**How it works:**
- When `joinClaudePool=true` and the provider has a model redirect from the requested Claude model to another Claude model, it can handle Claude requests
- Example: A Gemini provider can handle `claude-sonnet-4-5` requests if it has a redirect mapping it to a supported model

**Requirements:**
1. Provider must have `joinClaudePool=true`
2. Provider must have a `modelRedirects` entry mapping the requested Claude model to another Claude model
3. The redirected model must start with `claude-`

### Decision Context Deep Dive

The decision context captures comprehensive information about provider selection:

```typescript
// From /Users/ding/Github/claude-code-hub/src/types/message.ts
interface ProviderSelectionContext {
  // Provider pool state
  totalProviders: number;
  enabledProviders: number;
  targetType: "claude" | "codex" | "openai-compatible" | "gemini" | "gemini-cli";
  requestedModel?: string;

  // Group filtering
  userGroup?: string;
  afterGroupFilter?: number;
  groupFilterApplied: boolean;

  // Health check filtering
  beforeHealthCheck: number;
  afterHealthCheck: number;
  filteredProviders?: Array<{
    id: number;
    name: string;
    reason: "circuit_open" | "rate_limited" | "excluded" | 
           "format_type_mismatch" | "type_mismatch" | 
           "model_not_allowed" | "context_1m_disabled" | "disabled";
    details?: string;
  }>};

  // Priority stratification
  priorityLevels: number[];
  selectedPriority: number;
  candidatesAtPriority: Array<{
    id: number;
    name: string;
    weight: number;
    costMultiplier: number;
    probability?: number;
  }>};

  // Session-specific
  sessionId?: string;
  sessionAge?: number;
  concurrentLimit?: number;
  currentConcurrent?: number;
  excludedProviderIds?: number[];
  retryReason?: string;
}
```

This context is recorded in the provider chain for debugging and auditing purposes.

## References

### Core Files

- `/Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/provider-selector.ts` - Main provider selection logic
- `/Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/session.ts` - Session management and provider chain tracking
- `/Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/forwarder.ts` - Request forwarding and failover handling
- `/Users/ding/Github/claude-code-hub/src/lib/circuit-breaker.ts` - Circuit breaker implementation
- `/Users/ding/Github/claude-code-hub/src/lib/vendor-type-circuit-breaker.ts` - Vendor-type circuit breakers
- `/Users/ding/Github/claude-code-hub/src/lib/rate-limit/service.ts` - Rate limiting and concurrent session tracking

### Schema and Types

- `/Users/ding/Github/claude-code-hub/src/drizzle/schema.ts` - Database schema including providers table
- `/Users/ding/Github/claude-code-hub/src/types/provider.ts` - Provider type definitions
- `/Users/ding/Github/claude-code-hub/src/lib/constants/provider.constants.ts` - Provider constants and limits

### Configuration and Validation

- `/Users/ding/Github/claude-code-hub/src/lib/validation/schemas.ts` - Provider validation schemas
- `/Users/ding/Github/claude-code-hub/src/repository/provider.ts` - Provider repository functions
- `/Users/ding/Github/claude-code-hub/src/actions/providers.ts` - Provider management actions

### Request Filtering

- `/Users/ding/Github/claude-code-hub/src/lib/request-filter-engine.ts` - Provider-specific request filtering
- `/Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/provider-request-filter.ts` - Provider filter application

### Tests

- `/Users/ding/Github/claude-code-hub/tests/unit/proxy/provider-selector-select-provider-by-type.test.ts` - Provider type selection tests
- `/Users/ding/Github/claude-code-hub/tests/unit/proxy/provider-selector-model-redirect.test.ts` - Model redirect tests

### Key Functions Reference

| Function | Location | Purpose |
|----------|----------|---------|
| `ProxyProviderResolver.ensure` | provider-selector.ts | Main entry point for provider selection |
| `pickRandomProvider` | provider-selector.ts | Selects provider using weighted random |
| `selectTopPriority` | provider-selector.ts | Filters to highest priority providers |
| `selectOptimal` | provider-selector.ts | Cost-based selection within priority tier |
| `weightedRandom` | provider-selector.ts | Weighted random selection algorithm |
| `filterByLimits` | provider-selector.ts | Health check filtering |
| `checkProviderGroupMatch` | provider-selector.ts | Group tag matching logic |
| `providerSupportsModel` | provider-selector.ts | Model support detection |
| `findReusable` | provider-selector.ts | Session provider reuse logic |
| `isCircuitOpen` | circuit-breaker.ts | Circuit breaker state check |
| `isVendorTypeCircuitOpen` | vendor-type-circuit-breaker.ts | Vendor-type circuit breaker check |
| `checkAndTrackProviderSession` | rate-limit/service.ts | Atomic concurrent session check |

### Provider Aggregation Flow Diagram

```
Request Arrives
      |
      v
[Session Reuse Check] -----> [Reuse Provider?] -----> Yes -> Use Same Provider
      |                                           |
      No                                          v
      |                                    [Check Limits]
      v                                           |
[Group Pre-filter] <-----------------------------|
      |
      v
[Format/Model Match]
      |
      v
[1M Context Filter]
      |
      v
[Health Check Filter] -----> [Circuit Open?] -----> Yes -> Exclude
      |                                           |
      |                                           No
      |                                           |
      v                                           v
[Priority Stratification] <----------------------|
      |
      v
[Cost Sort + Weighted Random]
      |
      v
[Atomic Concurrent Check] -----> [Limit Exceeded?] -----> Yes -> Failover
      |                                                   |
      No                                                  v
      |                                            [Select Alternative]
      v                                                   |
[Provider Selected] <------------------------------------|
```

This architecture ensures high availability, cost optimization, and fine-grained access control while maintaining session consistency for multi-turn conversations.
