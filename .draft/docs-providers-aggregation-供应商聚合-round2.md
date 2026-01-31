# Provider Aggregation (供应商聚合)

## Intent Analysis

Provider aggregation is the core mechanism that enables claude-code-hub to distribute
requests across multiple upstream providers intelligently. When you're running a
production AI proxy, you don't want a single point of failure. Provider aggregation
solves this by allowing you to configure multiple providers with different
characteristics and letting the system automatically route requests to the most
appropriate one based on availability, cost, priority, and user permissions.

The system is designed around several key principles:

1. **High Availability**: When one provider fails, requests automatically failover
to alternatives
2. **Cost Optimization**: Route requests to cheaper providers when possible
3. **Access Control**: Different users can access different subsets of providers
4. **Session Stickiness**: Multi-turn conversations stay with the same provider
for consistency
5. **Health Awareness**: Unhealthy providers are automatically removed from the
pool

## Behavior Summary

### Provider Selection Pipeline

The provider selection process follows a multi-stage pipeline defined in
`/Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/provider-selector.ts`.
When a request arrives, the system goes through these steps:

**Step 1: Group Pre-filtering**
The system first filters providers based on the user's assigned provider group.
Each user or API key can be assigned to specific groups, and they can only see
providers matching those groups. This is a silent filter - users are unaware of
providers outside their assigned groups.

```typescript
// From /Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/provider-selector.ts
// Lines 669-730
const effectiveGroupPick = getEffectiveProviderGroup(session);
if (effectiveGroupPick) {
  const groupFiltered = allProviders.filter((p) =>
    checkProviderGroupMatch(p.groupTag, effectiveGroupPick)
  );
  visibleProviders = groupFiltered;
}
```

**Step 2: Format and Model Matching**
Providers are filtered based on whether they support the requested model and API
format. The system checks:
- Provider type compatibility (claude, codex, openai-compatible, gemini, etc.)
- Model support via `allowedModels` whitelist
- Model redirects for non-standard model names

**Step 3: 1M Context Filtering**
If the client requests 1M context window via the `anthropic-beta` header,
providers with `context1mPreference === 'disabled'` are filtered out.

**Step 4: Health Check Filtering**
The `filterByLimits` method checks multiple health indicators:
- Circuit breaker state (open/closed/half-open)
- Cost limits (5h, daily, weekly, monthly, total)
- Vendor-type circuit breakers

**Step 5: Priority Stratification**
Only providers with the highest priority (lowest priority number) are selected.
This ensures primary providers are always preferred over backups.

```typescript
// From /Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/provider-selector.ts
// Lines 1038-1048
private static selectTopPriority(providers: Provider[]): Provider[] {
  if (providers.length === 0) {
    return [];
  }

  // 找到最小的优先级值（最高优先级）
  const minPriority = Math.min(...providers.map((p) => p.priority || 0));

  // 只返回该优先级的供应商
  return providers.filter((p) => (p.priority || 0) === minPriority);
}
```

**Step 6: Cost-Weighted Selection**
Within the same priority tier, providers are sorted by cost multiplier and then
selected using weighted random distribution via the `selectOptimal` method.

### Session Reuse

For multi-turn conversations, the system attempts to reuse the same provider to
maintain context consistency. This is handled by the `findReusable` method:

```typescript
// From /Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/provider-selector.ts
// Lines 508-655 (comprehensive implementation)
private static async findReusable(session: ProxySession): Promise<Provider | null> {
  // Only reuse if session has messages > 1
  if (!session.shouldReuseProvider() || !session.sessionId) {
    return null;
  }

  // 从 Redis 读取该 session 绑定的 provider
  const providerId = await SessionManager.getSessionProvider(session.sessionId);
  if (!providerId) {
    return null;
  }

  // 验证 provider 可用性
  const provider = await findProviderById(providerId);
  if (!provider || !provider.isEnabled) {
    return null;
  }

  // 临时熔断（vendor+type）：防止会话复用绕过故障隔离
  if (
    provider.providerVendorId &&
    provider.providerVendorId > 0 &&
    (await isVendorTypeCircuitOpen(provider.providerVendorId, provider.providerType))
  ) {
    return null;
  }

  // 检查熔断器状态
  if (await isCircuitOpen(provider.id)) {
    return null;
  }

  // 检查模型支持
  const requestedModel = session.getOriginalModel();
  if (requestedModel && !providerSupportsModel(provider, requestedModel)) {
    return null;
  }

  // 修复：检查用户分组权限（严格分组隔离 + 支持多分组）
  const effectiveGroup = getEffectiveProviderGroup(session);
  if (effectiveGroup) {
    if (!checkProviderGroupMatch(provider.groupTag, effectiveGroup)) {
      return null; // Reject reuse, re-select
    }
  }

  // 会话复用也必须遵守限额
  const costCheck = await RateLimitService.checkCostLimitsWithLease(
    provider.id,
    "provider",
    {
      limit_5h_usd: provider.limit5hUsd,
      limit_daily_usd: provider.limitDailyUsd,
      daily_reset_mode: provider.dailyResetMode,
      daily_reset_time: provider.dailyResetTime,
      limit_weekly_usd: provider.limitWeeklyUsd,
      limit_monthly_usd: provider.limitMonthlyUsd,
    }
  );

  if (!costCheck.allowed) {
    return null;
  }

  return provider;
}
```

Session reuse only occurs when:
- The conversation has more than one message (`shouldReuseProvider()` returns true)
- The previous provider is still healthy
- The provider hasn't exceeded cost limits
- The user still has permission to access that provider
- The vendor-type circuit breaker is not open
- The provider supports the requested model

### Failover and Retry Chains

When a provider fails during request processing, the system implements a
sophisticated failover mechanism:

```typescript
// From /Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/provider-selector.ts
// Lines 272-409
// === 故障转移循环 ===
let attemptCount = 0;
while (true) {
  attemptCount++;

  if (!session.provider) {
    break; // 无可用供应商，退出循环
  }

  // 原子性并发检查并追踪
  if (session.sessionId) {
    const limit = session.provider.limitConcurrentSessions || 0;

    const checkResult = await RateLimitService.checkAndTrackProviderSession(
      session.provider.id,
      session.sessionId,
      limit
    );

    if (!checkResult.allowed) {
      // === 并发限制失败 ===
      logger.warn(
        "ProviderSelector: Provider concurrent session limit exceeded",
        { providerName: session.provider.name, attempt: attemptCount }
      );

      // 记录失败到决策链
      session.addProviderToChain(session.provider, {
        reason: "concurrent_limit_failed",
        attemptNumber: attemptCount,
        errorMessage: checkResult.reason,
      });

      // 加入排除列表
      excludedProviders.push(session.provider.id);

      // === 重试选择 ===
      const { provider: fallbackProvider } =
        await ProxyProviderResolver.pickRandomProvider(session, excludedProviders);

      if (!fallbackProvider) {
        break; // 无其他可用供应商
      }

      session.setProvider(fallbackProvider);
      continue; // 继续下一次循环
    }

    // === 成功 ===
    return null;
  }
}
```

The failover mechanism:
1. Tracks failed providers in an exclusion list
2. Attempts to select an alternative provider
3. Records each attempt in the provider chain for debugging
4. Continues until a healthy provider is found or all options are exhausted

### Provider Chain Tracking

Every provider selection and failover is tracked in the `providerChain` array
within the session:

```typescript
// From /Users/ding/Github/claude-code-hub/src/types/message.ts
// Lines 10-182
interface ProviderChainItem {
  id: number;
  name: string;
  vendorId?: number;
  providerType?: ProviderType;
  endpointId?: number | null;
  endpointUrl?: string;
  reason?: "session_reuse" | "initial_selection" | "concurrent_limit_failed" |
           "request_success" | "retry_success" | "retry_failed" | ...;
  selectionMethod?: "session_reuse" | "weighted_random" | "group_filtered" |
                    "fail_open_fallback";
  circuitState?: "closed" | "open" | "half-open";
  priority?: number;
  weight?: number;
  costMultiplier?: number;
  groupTag?: string | null;
  timestamp?: number;
  attemptNumber?: number;
  errorMessage?: string;
  // Embedded decision context (not a standalone interface)
  decisionContext?: {
    totalProviders: number;
    enabledProviders: number;
    targetType: "claude" | "codex" | "openai-compatible" | "gemini" | "gemini-cli";
    requestedModel?: string;
    userGroup?: string;
    afterGroupFilter?: number;
    groupFilterApplied: boolean;
    beforeHealthCheck: number;
    afterHealthCheck: number;
    filteredProviders?: Array<{
      id: number;
      name: string;
      reason: string;
      details?: string;
    }>};
    priorityLevels: number[];
    selectedPriority: number;
    candidatesAtPriority: Array<{
      id: number;
      name: string;
      weight: number;
      costMultiplier: number;
      probability?: number;
    }>};
    sessionId?: string;
    sessionAge?: number;
    concurrentLimit?: number;
    currentConcurrent?: number;
    excludedProviderIds?: number[];
    retryReason?: string;
  };
}
```

This tracking enables:
- Debugging provider selection decisions
- Understanding why certain providers were skipped
- Analyzing failover patterns
- Cost attribution per provider

## Config/Commands

### Provider Configuration Fields

The provider schema in `/Users/ding/Github/claude-code-hub/src/drizzle/schema.ts`
defines these aggregation-related fields (lines 148-297):

```typescript
// From /Users/ding/Github/claude-code-hub/src/drizzle/schema.ts
export const providers = pgTable('providers', {
  id: serial('id').primaryKey(),
  name: varchar('name').notNull(),
  description: text('description'),                      // Provider description
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
  costMultiplier: numeric('cost_multiplier', { precision: 10, scale: 4 })
    .default('1.0'),

  // Group tag for access control (supports comma-separated multi-tags)
  groupTag: varchar('group_tag', { length: 50 }),

  // Provider type determines API format
  providerType: varchar('provider_type', { length: 20 })
    .notNull()
    .default('claude')
    .$type<ProviderType>(),

  // Preserve client IP in requests
  preserveClientIp: boolean('preserve_client_ip').notNull().default(false),

  // Model whitelist/declaration
  allowedModels: jsonb('allowed_models').$type<string[] | null>().default(null),

  // Model redirects for mapping model names
  modelRedirects: jsonb('model_redirects').$type<Record<string, string>>(),

  // Join Claude scheduling pool (for non-Anthropic providers)
  joinClaudePool: boolean('join_claude_pool').default(false),

  // MCP passthrough configuration
  mcpPassthroughType: varchar('mcp_passthrough_type', { length: 20 })
    .$type<'none' | 'minimax' | 'glm' | 'custom'>()
    .default('none'),
  mcpPassthroughUrl: varchar('mcp_passthrough_url', { length: 500 }),

  // Cost limits
  limit5hUsd: numeric('limit_5h_usd', { precision: 10, scale: 2 }),
  limitDailyUsd: numeric('limit_daily_usd', { precision: 10, scale: 2 }),
  limitWeeklyUsd: numeric('limit_weekly_usd', { precision: 10, scale: 2 }),
  limitMonthlyUsd: numeric('limit_monthly_usd', { precision: 10, scale: 2 }),
  limitTotalUsd: numeric('limit_total_usd', { precision: 10, scale: 2 }),

  // Daily reset configuration
  dailyResetMode: varchar('daily_reset_mode', { length: 10 })
    .$type<'fixed' | 'rolling'>()
    .default('fixed'),
  dailyResetTime: varchar('daily_reset_time', { length: 5 }).default('00:00'),

  // Total cost reset tracking
  totalCostResetAt: timestamp('total_cost_reset_at', { mode: 'date' }),

  // Concurrent session limit (0 = unlimited)
  limitConcurrentSessions: integer('limit_concurrent_sessions').default(0),

  // Max retry attempts per request (null = use global default)
  maxRetryAttempts: integer('max_retry_attempts'),

  // Circuit breaker configuration
  circuitBreakerFailureThreshold: integer('circuit_breaker_failure_threshold')
    .default(5),
  circuitBreakerOpenDuration: integer('circuit_breaker_open_duration')
    .default(1800000), // 30 minutes in milliseconds
  circuitBreakerHalfOpenSuccessThreshold:
    integer('circuit_breaker_half_open_success_threshold').default(2),

  // Proxy configuration
  proxyUrl: varchar('proxy_url', { length: 500 }),
  proxyFallbackToDirect: boolean('proxy_fallback_to_direct').default(false),

  // Timeout settings (0 = use global default)
  firstByteTimeoutStreamingMs: integer('first_byte_timeout_streaming_ms')
    .default(0),
  streamingIdleTimeoutMs: integer('streaming_idle_timeout_ms').default(0),
  requestTimeoutNonStreamingMs: integer('request_timeout_non_streaming_ms')
    .default(0),

  // Vendor metadata
  websiteUrl: varchar('website_url', { length: 500 }),
  faviconUrl: varchar('favicon_url', { length: 500 }),

  // Cache TTL override
  cacheTtlPreference: integer('cache_ttl_preference'),

  // 1M context window preference
  context1mPreference: varchar('context_1m_preference', { length: 20 })
    .$type<'inherit' | 'force_enable' | 'disabled'>()
    .default('inherit'),

  // Codex-specific preferences
  codexReasoningEffortPreference: varchar('codex_reasoning_effort_preference'),
  codexReasoningSummaryPreference: varchar('codex_reasoning_summary_preference'),
  codexTextVerbosityPreference: varchar('codex_text_verbosity_preference'),
  codexParallelToolCallsPreference:
    varchar('codex_parallel_tool_calls_preference'),

  // Timestamps
  createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { mode: 'date' }).defaultNow().notNull(),
  deletedAt: timestamp('deleted_at', { mode: 'date' }), // Soft delete
});
```

### Provider Group Configuration

Provider groups are defined using the `groupTag` field which supports
comma-separated multi-tags:

```typescript
// From /Users/ding/Github/claude-code-hub/src/lib/constants/provider.constants.ts
// Lines 25-30
export const PROVIDER_GROUP = {
  /** 默认分组标识符 - 用于表示未设置分组的 key/供应商 */
  DEFAULT: "default",
  /** 全局访问标识符 - 可访问所有供应商（管理员专用） */
  ALL: "*",
} as const;
```

Group matching logic from
`/Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/provider-selector.ts`:

```typescript
// Lines 81-93
function checkProviderGroupMatch(
  providerGroupTag: string | null,
  userGroups: string
): boolean {
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

Users and API keys can be assigned to provider groups via the `providerGroup`
field:

```typescript
// From /Users/ding/Github/claude-code-hub/src/drizzle/schema.ts
// Users table - Line 44
export const users = pgTable('users', {
  // ... other fields
  providerGroup: varchar('provider_group', { length: 200 }).default('default'),
});

// Keys table - Line 117
export const keys = pgTable('keys', {
  // ... other fields
  providerGroup: varchar('provider_group', { length: 200 }).default('default'),
});
```

The effective group is determined with key group taking priority:

```typescript
// From /Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/provider-selector.ts
// Lines 60-72
function getEffectiveProviderGroup(session?: ProxySession): string | null {
  if (!session?.authState) {
    return null;
  }
  const { key, user } = session.authState;
  if (key) {
    return key.providerGroup || PROVIDER_GROUP.DEFAULT;
  }
  if (user) {
    return user.providerGroup || PROVIDER_GROUP.DEFAULT;
  }
  return PROVIDER_GROUP.DEFAULT;
}
```

### Provider Type Constants

The system supports multiple provider types for different API formats:

```typescript
// From /Users/ding/Github/claude-code-hub/src/types/provider.ts
// Lines 6-12
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
// Lines 4-23
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

// Timeout defaults (lines 37-57)
export const PROVIDER_TIMEOUT_DEFAULTS = {
  FIRST_BYTE_TIMEOUT_STREAMING_MS: 30000,      // 30 seconds
  STREAMING_IDLE_TIMEOUT_MS: 300000,           // 5 minutes
  REQUEST_TIMEOUT_NON_STREAMING_MS: 300000,    // 5 minutes
} as const;
```

Note: `LIMIT_DAILY_USD` and `LIMIT_TOTAL_USD` exist in the schema but are not
defined in the `PROVIDER_LIMITS` constant. They have validation in the Zod
schemas instead.

## Edge Cases

### No Matching Providers

When no providers match the criteria, the system returns a 503 error with
detailed context:

```typescript
// From /Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/provider-selector.ts
// Lines 915-920
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
// Lines 866-906 (filterByLimits method)
const costCheck = await RateLimitService.checkCostLimitsWithLease(p.id, "provider", {
  limit_5h_usd: p.limit5hUsd,
  limit_daily_usd: p.limitDailyUsd,
  daily_reset_mode: p.dailyResetMode,
  daily_reset_time: p.dailyResetTime,
  limit_weekly_usd: p.limitWeeklyUsd,
  limit_monthly_usd: p.limitMonthlyUsd,
});

if (!costCheck.allowed) {
  logger.debug("ProviderSelector: Provider cost limit exceeded", {
    providerId: p.id,
  });
  return null; // Filter out this provider
}
```

The system logs which limit was exceeded and continues to the next provider in
the failover chain.

### Concurrent Session Limit Race Condition

To prevent race conditions in concurrent session tracking, the system uses
atomic Redis Lua scripts:

```typescript
// From /Users/ding/Github/claude-code-hub/src/lib/rate-limit/service.ts
// Lines 551-599
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
      reason: `供应商并发 Session 上限已达到（${count}/${limit}）`,
    };
  }

  return { allowed: true, count, tracked: tracked === 1 };
}
```

The Lua script (`/Users/ding/Github/claude-code-hub/src/lib/redis/lua-scripts.ts`,
lines 26-60) performs these operations atomically:
1. Cleans up expired sessions (older than 5 minutes)
2. Checks if session is already tracked
3. Gets current concurrent count
4. Checks against limit (excluding already-tracked sessions)
5. Tracks the session with ZADD
6. Returns status

### Circuit Breaker State Transitions

The circuit breaker implements a three-state machine:

```typescript
// From /Users/ding/Github/claude-code-hub/src/lib/circuit-breaker.ts
// Lines 203-225
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
- **Closed** -> **Open**: When failure count exceeds threshold (default 5)
- **Open** -> **Half-Open**: When open duration expires (default 30 minutes)
- **Half-Open** -> **Closed**: When success count reaches threshold (default 2)
- **Half-Open** -> **Open**: When any failure occurs in half-open

Note: Vendor-type circuit breakers use a simpler two-state machine (closed/open)
without the half-open state.

### 1M Context Window Filtering

When a client requests 1M context, providers with
`context1mPreference === 'disabled'` are excluded:

```typescript
// From /Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/provider-selector.ts
// Lines 828-858
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

The `clientRequestsContext1m()` method checks for the `anthropic-beta` header
indicating 1M context support is requested.

### Session Provider Group Mismatch

When a session tries to reuse a provider but the user's group no longer has
access:

```typescript
// From /Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/provider-selector.ts
// Lines 578-594
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

The system uses sophisticated logic to determine if a provider supports a
requested model:

```typescript
// From /Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/provider-selector.ts
// Lines 115-172
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
  if (!provider.allowedModels || provider.allowedModels.length === 0) {
    return true;
  }

  return false;
}
```

### Format Compatibility Checking

The system ensures API format compatibility between client requests and provider
types:

```typescript
// From /Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/provider-selector.ts
// Lines 192-210
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
- Uses standard Anthropic authentication (x-api-key header)
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
// Lines 70, 215-216, 316-317
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

**Error Categories** (from `/Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/errors.ts`,
lines 457-463):

1. **CLIENT_ABORT**: Client disconnected, immediate failure
2. **NON_RETRYABLE_CLIENT_ERROR**: Invalid requests (prompt too long, content
   filtered), immediate failure
3. **SYSTEM_ERROR**: Network issues, retry once then switch
4. **RESOURCE_NOT_FOUND**: 404 errors, retry then switch
5. **PROVIDER_ERROR**: 4xx/5xx errors, retry then switch with circuit breaker
   recording

### Model Redirects

Providers can configure model name redirections:

```typescript
// From /Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/model-redirector.ts
// Lines 20-129
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
    session.setOriginalModel(originalModel);
    session.request.message.model = redirectedModel;
    session.request.model = redirectedModel;

    // Regenerate request buffer
    const updatedBody = JSON.stringify(session.request.message);
    session.request.buffer = encoder.encode(updatedBody).buffer;

    // Special handling for Gemini URL paths
    if (provider.providerType === "gemini" || provider.providerType === "gemini-cli") {
      const originalPath = session.requestUrl.pathname;
      const newPath = originalPath.replace(
        /\/models\/([^/:]+)(:[^/]+)?$/,
        `/models/${redirectedModel}$2`
      );

      if (newPath !== originalPath) {
        const newUrl = new URL(session.requestUrl.toString());
        newUrl.pathname = newPath;
        session.requestUrl = newUrl;
      }
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
// Line 192
joinClaudePool: boolean('join_claude_pool').default(false),
```

**How it works:**
- When `joinClaudePool=true` and the provider has a model redirect from the
  requested Claude model to another Claude model, it can handle Claude requests
- Example: A Gemini provider can handle `claude-sonnet-4-5` requests if it has a
  redirect mapping it to a supported model

**Requirements:**
1. Provider must have `joinClaudePool=true`
2. Provider must have a `modelRedirects` entry mapping the requested Claude
   model to another Claude model
3. The redirected model must start with `claude-`

### Decision Context Deep Dive

The decision context captures comprehensive information about provider selection.
Note: This is not a standalone interface but embedded within `ProviderChainItem`
as the `decisionContext` field:

```typescript
// From /Users/ding/Github/claude-code-hub/src/types/message.ts
// Lines 124-181 (embedded in ProviderChainItem)
decisionContext?: {
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
};
```

This context is recorded in the provider chain for debugging and auditing
purposes.

## References

### Core Files

- `/Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/provider-selector.ts` -
  Main provider selection logic (1225 lines)
- `/Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/session.ts` -
  Session management and provider chain tracking
- `/Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/forwarder.ts` -
  Request forwarding and failover handling
- `/Users/ding/Github/claude-code-hub/src/lib/circuit-breaker.ts` -
  Circuit breaker implementation
- `/Users/ding/Github/claude-code-hub/src/lib/vendor-type-circuit-breaker.ts` -
  Vendor-type circuit breakers (two-state: closed/open)
- `/Users/ding/Github/claude-code-hub/src/lib/rate-limit/service.ts` -
  Rate limiting and concurrent session tracking

### Schema and Types

- `/Users/ding/Github/claude-code-hub/src/drizzle/schema.ts` -
  Database schema including providers table (lines 148-297)
- `/Users/ding/Github/claude-code-hub/src/types/provider.ts` -
  Provider type definitions
- `/Users/ding/Github/claude-code-hub/src/lib/constants/provider.constants.ts` -
  Provider constants and limits

### Configuration and Validation

- `/Users/ding/Github/claude-code-hub/src/lib/validation/schemas.ts` -
  Provider validation schemas (CreateProviderSchema, UpdateProviderSchema)
- `/Users/ding/Github/claude-code-hub/src/repository/provider.ts` -
  Provider repository functions (889 lines)
- `/Users/ding/Github/claude-code-hub/src/actions/providers.ts` -
  Provider management actions (3762 lines)

### Request Filtering

- `/Users/ding/Github/claude-code-hub/src/lib/request-filter-engine.ts` -
  Provider-specific request filtering (481 lines)
- `/Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/provider-request-filter.ts` -
  Provider filter application wrapper (29 lines)

### Model Redirection

- `/Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/model-redirector.ts` -
  Model redirect logic with Gemini URL handling (200 lines)

### Tests

- `/Users/ding/Github/claude-code-hub/tests/unit/proxy/provider-selector-select-provider-by-type.test.ts` -
  Provider type selection tests
- `/Users/ding/Github/claude-code-hub/tests/unit/proxy/provider-selector-model-redirect.test.ts` -
  Model redirect tests
- `/Users/ding/Github/claude-code-hub/tests/unit/proxy/provider-selector-total-limit.test.ts` -
  Total cost limit tests

### Key Functions Reference

| Function | Location | Purpose |
|----------|----------|---------|
| `ProxyProviderResolver.ensure` | provider-selector.ts:272 | Main entry point for provider selection |
| `pickRandomProvider` | provider-selector.ts:657 | Selects provider using weighted random |
| `selectTopPriority` | provider-selector.ts:1038 | Filters to highest priority providers |
| `selectOptimal` | provider-selector.ts:1051 | Cost-based selection within priority tier |
| `weightedRandom` | provider-selector.ts:1100 | Weighted random selection algorithm |
| `filterByLimits` | provider-selector.ts:866 | Health check filtering |
| `checkProviderGroupMatch` | provider-selector.ts:81 | Group tag matching logic |
| `providerSupportsModel` | provider-selector.ts:115 | Model support detection |
| `findReusable` | provider-selector.ts:508 | Session provider reuse logic |
| `isCircuitOpen` | circuit-breaker.ts:203 | Circuit breaker state check |
| `isVendorTypeCircuitOpen` | vendor-type-circuit-breaker.ts:115 | Vendor-type circuit breaker check |
| `checkAndTrackProviderSession` | rate-limit/service.ts:551 | Atomic concurrent session check |
| `checkCostLimitsWithLease` | rate-limit/service.ts:1311 | Cost limit checking with lease |
| `ModelRedirector.apply` | model-redirector.ts:20 | Apply model redirects |

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

This architecture ensures high availability, cost optimization, and fine-grained
access control while maintaining session consistency for multi-turn conversations.
