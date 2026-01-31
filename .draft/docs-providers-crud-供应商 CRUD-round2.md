# Provider CRUD Operations - Round 2 Verified Draft

## Intent Analysis

A Provider in Claude Code Hub represents an upstream AI service that the hub connects
to. Providers are the core entities that enable the hub to route requests to various
AI services like Anthropic, OpenAI-compatible APIs, Gemini, and Codex.

The provider CRUD system allows administrators to:

1. **Configure multiple provider types** - Support for 6 provider types (claude,
   claude-auth, codex, gemini, gemini-cli, openai-compatible), each with different
   authentication methods and API formats
2. **Enable intelligent routing** - Provider properties like weight, priority, and
   group tags feed into the smart routing algorithm
3. **Control costs** - Spending limits, cost multipliers, and quotas help manage
   expenses
4. **Ensure high availability** - Circuit breaker configuration, timeout settings,
   and proxy support maintain service stability
5. **Aggregate by vendor** - The vendor entity groups providers by their official
   website domain for endpoint pool management

## Behavior Summary

### Provider Data Model

Providers are stored in PostgreSQL across three main tables:

#### 1. providers Table

Located in `/Users/ding/Github/claude-code-hub/src/drizzle/schema.ts` (lines 148-297).

Core fields:

```typescript
// Basic information
id: serial('id').primaryKey()
name: varchar('name').notNull()           // Provider display name
description: text('description')          // Optional description
url: varchar('url').notNull()             // API endpoint URL
key: varchar('key').notNull()             // API authentication key
providerVendorId: integer('provider_vendor_id').notNull()  // Links to vendor

// Status controls
isEnabled: boolean('is_enabled').notNull().default(true)  // Active/inactive
weight: integer('weight').notNull().default(1)            // 1-100 for weighted routing

// Priority and grouping
priority: integer('priority').notNull().default(0)        // Lower = higher priority
costMultiplier: numeric('cost_multiplier', { precision: 10, scale: 4 }).default('1.0')
groupTag: varchar('group_tag', { length: 50 })            // Comma-separated tags

// Provider type
providerType: varchar('provider_type', { length: 20 })
  .notNull()
  .default('claude')
  .$type<ProviderType>()  // 'claude' | 'claude-auth' | 'codex' | 'gemini' | 'gemini-cli' | 'openai-compatible'

// Model configuration
preserveClientIp: boolean('preserve_client_ip').notNull().default(false)
modelRedirects: jsonb('model_redirects').$type<Record<string, string>>()  // Model name mapping
allowedModels: jsonb('allowed_models').$type<string[] | null>().default(null)  // Whitelist/declaration
joinClaudePool: boolean('join_claude_pool').default(false)  // Join Claude scheduling pool

// MCP passthrough configuration
mcpPassthroughType: varchar('mcp_passthrough_type', { length: 20 })
  .notNull()
  .default('none')
  .$type<'none' | 'minimax' | 'glm' | 'custom'>()
mcpPassthroughUrl: varchar('mcp_passthrough_url', { length: 512 })

// Spending limits
limit5hUsd: numeric('limit_5h_usd', { precision: 10, scale: 2 })
limitDailyUsd: numeric('limit_daily_usd', { precision: 10, scale: 2 })
dailyResetMode: dailyResetModeEnum('daily_reset_mode').default('fixed').notNull()
dailyResetTime: varchar('daily_reset_time', { length: 5 }).default('00:00')
limitWeeklyUsd: numeric('limit_weekly_usd', { precision: 10, scale: 2 })
limitMonthlyUsd: numeric('limit_monthly_usd', { precision: 10, scale: 2 })
limitTotalUsd: numeric('limit_total_usd', { precision: 10, scale: 2 })
totalCostResetAt: timestamp('total_cost_reset_at', { withTimezone: true })
limitConcurrentSessions: integer('limit_concurrent_sessions').default(0)

// Circuit breaker configuration
maxRetryAttempts: integer('max_retry_attempts')
circuitBreakerFailureThreshold: integer('circuit_breaker_failure_threshold').default(5)
circuitBreakerOpenDuration: integer('circuit_breaker_open_duration').default(1800000)  // 30 minutes in ms
circuitBreakerHalfOpenSuccessThreshold: integer('circuit_breaker_half_open_success_threshold').default(2)

// Proxy configuration
proxyUrl: varchar('proxy_url', { length: 512 })
proxyFallbackToDirect: boolean('proxy_fallback_to_direct').default(false)

// Timeout configuration (milliseconds)
firstByteTimeoutStreamingMs: integer('first_byte_timeout_streaming_ms').notNull().default(0)
streamingIdleTimeoutMs: integer('streaming_idle_timeout_ms').notNull().default(0)
requestTimeoutNonStreamingMs: integer('request_timeout_non_streaming_ms').notNull().default(0)

// Special attribute preferences
cacheTtlPreference: varchar('cache_ttl_preference', { length: 10 })
context1mPreference: varchar('context_1m_preference', { length: 20 })

// Codex parameter overrides
codexReasoningEffortPreference: varchar('codex_reasoning_effort_preference', { length: 20 })
codexReasoningSummaryPreference: varchar('codex_reasoning_summary_preference', { length: 20 })
codexTextVerbosityPreference: varchar('codex_text_verbosity_preference', { length: 10 })
codexParallelToolCallsPreference: varchar('codex_parallel_tool_calls_preference', { length: 10 })

// Deprecated fields (kept for backward compatibility)
tpm: integer('tpm').default(0)
rpm: integer('rpm').default(0)
rpd: integer('rpd').default(0)
cc: integer('cc').default(0)

// Timestamps
createdAt: timestamp('created_at', { withTimezone: true }).defaultNow()
updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow()
deletedAt: timestamp('deleted_at', { withTimezone: true })  // Soft delete marker
```

#### 2. provider_vendors Table

Located in `/Users/ding/Github/claude-code-hub/src/drizzle/schema.ts` (lines 132-146).

The vendor entity aggregates providers by their official website domain:

```typescript
export const providerVendors = pgTable('provider_vendors', {
  id: serial('id').primaryKey(),
  websiteDomain: varchar('website_domain', { length: 255 }).notNull(),
  displayName: varchar('display_name', { length: 200 }),
  websiteUrl: text('website_url'),
  faviconUrl: text('favicon_url'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  providerVendorsWebsiteDomainUnique: uniqueIndex('uniq_provider_vendors_website_domain').on(
    table.websiteDomain
  ),
}));
```

#### 3. provider_endpoints Table

Located in `/Users/ding/Github/claude-code-hub/src/drizzle/schema.ts` (lines 299-342).

Manages the endpoint pool for each vendor and provider type:

```typescript
export const providerEndpoints = pgTable('provider_endpoints', {
  id: serial('id').primaryKey(),
  vendorId: integer('vendor_id')
    .notNull()
    .references(() => providerVendors.id, { onDelete: 'cascade' }),
  providerType: varchar('provider_type', { length: 20 })
    .notNull()
    .default('claude')
    .$type<ProviderType>(),
  url: text('url').notNull(),
  label: varchar('label', { length: 200 }),
  sortOrder: integer('sort_order').notNull().default(0),
  isEnabled: boolean('is_enabled').notNull().default(true),
  // Health probe snapshot
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

### TypeScript Type Definitions

#### Provider Interface

Located in `/Users/ding/Github/claude-code-hub/src/types/provider.ts` (lines 39-144):

```typescript
export interface Provider {
  id: number;
  name: string;
  url: string;
  key: string;
  providerVendorId: number | null;
  isEnabled: boolean;
  weight: number;
  priority: number;
  costMultiplier: number;
  groupTag: string | null;
  providerType: ProviderType;
  preserveClientIp: boolean;
  modelRedirects: Record<string, string> | null;
  allowedModels: string[] | null;
  joinClaudePool: boolean;
  codexInstructionsStrategy: CodexInstructionsStrategy;
  mcpPassthroughType: McpPassthroughType;
  mcpPassthroughUrl: string | null;
  limit5hUsd: number | null;
  limitDailyUsd: number | null;
  dailyResetMode: "fixed" | "rolling";
  dailyResetTime: string;
  limitWeeklyUsd: number | null;
  limitMonthlyUsd: number | null;
  limitTotalUsd: number | null;
  totalCostResetAt: Date | null;
  limitConcurrentSessions: number;
  maxRetryAttempts: number | null;
  circuitBreakerFailureThreshold: number;
  circuitBreakerOpenDuration: number;  // milliseconds
  circuitBreakerHalfOpenSuccessThreshold: number;
  proxyUrl: string | null;
  proxyFallbackToDirect: boolean;
  firstByteTimeoutStreamingMs: number;
  streamingIdleTimeoutMs: number;
  requestTimeoutNonStreamingMs: number;
  websiteUrl: string | null;
  faviconUrl: string | null;
  cacheTtlPreference: CacheTtlPreference | null;
  context1mPreference: Context1mPreference | null;
  codexReasoningEffortPreference: CodexReasoningEffortPreference | null;
  codexReasoningSummaryPreference: CodexReasoningSummaryPreference | null;
  codexTextVerbosityPreference: CodexTextVerbosityPreference | null;
  codexParallelToolCallsPreference: CodexParallelToolCallsPreference | null;
  tpm: number | null;
  rpm: number | null;
  rpd: number | null;
  cc: number | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date;
}
```

#### CreateProviderData and UpdateProviderData

Located in `/Users/ding/Github/claude-code-hub/src/types/provider.ts`:

- `CreateProviderData` (lines 235-303): Same fields as Provider but using snake_case
  naming (is_enabled, cost_multiplier, etc.)
- `UpdateProviderData` (lines 305-373): Same fields as CreateProviderData but all
  optional

### Provider Status Management

The `isEnabled` field controls whether a provider participates in request routing:

**Enabled state scope:**

1. **Routing decisions** - Disabled providers are excluded from smart routing
2. **Circuit breaker state** - Circuit breaker status is ignored for disabled providers
3. **Statistics** - Disabled providers still appear in historical stats but not new
   request allocation
4. **Cache invalidation** - Status changes trigger cross-instance cache invalidation

**Status change flow:**

```typescript
// 1. Update database status
await updateProvider(providerId, { is_enabled: false });

// 2. Broadcast cache invalidation (cross-instance sync)
await broadcastProviderCacheInvalidation({ operation: "edit", providerId });

// 3. Takes effect immediately on next routing decision
```

**Batch status management:**

Located in `/Users/ding/Github/claude-code-hub/src/actions/providers.ts` (lines 1004-1071):

```typescript
const BATCH_OPERATION_MAX_SIZE = 500;

export async function batchUpdateProviders(params: {
  providerIds: number[];
  updates: {
    is_enabled?: boolean;
    priority?: number;
    weight?: number;
    cost_multiplier?: number;
    group_tag?: string | null;
  };
}): Promise<ActionResult<{ updatedCount: number }>> {
  if (providerIds.length > BATCH_OPERATION_MAX_SIZE) {
    return { ok: false, error: `Batch operations limited to ${BATCH_OPERATION_MAX_SIZE} providers` };
  }
  // ... implementation
}
```

### Provider Grouping

The `groupTag` field supports multiple comma-separated tags for flexible grouping:

```typescript
// Group tag parsing logic
const groups = groupTag
  .split(",")
  .map((g) => g.trim())
  .filter(Boolean);
```

**Use cases:**

1. **User-provider binding** - Users specify accessible groups via `providerGroup`
2. **Routing isolation** - Different groups enable physical traffic isolation
3. **Gradual rollout** - New providers can start in test groups before production

**Getting all groups:**

Located in `/Users/ding/Github/claude-code-hub/src/repository/provider.ts` (lines 752-776):

```typescript
export async function getDistinctProviderGroups(): Promise<string[]> {
  const result = await db
    .selectDistinct({ groupTag: providers.groupTag })
    .from(providers)
    .where(
      and(
        isNull(providers.deletedAt),
        and(isNotNull(providers.groupTag), ne(providers.groupTag, ""))
      )
    )
    .orderBy(providers.groupTag);

  // Split comma-separated tags and deduplicate
  const allTags = result
    .map((r) => r.groupTag)
    .filter((tag): tag is string => tag !== null)
    .flatMap((tag) =>
      tag
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean)
    );

  return [...new Set(allTags)].sort();
}
```

## Config/Commands

### Repository Layer CRUD Operations

Located in `/Users/ding/Github/claude-code-hub/src/repository/provider.ts`.

#### Create - createProvider

Lines 17-153:

```typescript
export async function createProvider(providerData: CreateProviderData): Promise<Provider> {
  // 1. Get or create providerVendor
  const providerVendorId = await getOrCreateProviderVendorIdFromUrls({
    providerUrl: providerData.url,
    websiteUrl: providerData.website_url ?? null,
    faviconUrl: providerData.favicon_url ?? null,
    displayName: providerData.name,
  });

  // 2. Build database data with defaults
  const dbData = {
    name: providerData.name,
    url: providerData.url,
    key: providerData.key,
    providerVendorId,
    isEnabled: providerData.is_enabled,
    weight: providerData.weight,
    priority: providerData.priority,
    costMultiplier: providerData.cost_multiplier != null ? providerData.cost_multiplier.toString() : "1.0",
    // ... 40+ additional fields mapped
  };

  // 3. Insert into database
  const [provider] = await db.insert(providers).values(dbData).returning({
    id: providers.id,
    name: providers.name,
    // ... all fields
  });

  // 4. Auto-create endpoint for this provider
  if (created.providerVendorId) {
    await ensureProviderEndpointExistsForUrl({
      vendorId: created.providerVendorId,
      providerType: created.providerType,
      url: created.url,
    });
  }

  return created;
}
```

#### Read Operations

**findProviderList** (lines 155-225) - Paginated query:

```typescript
export async function findProviderList(
  limit: number = 50,
  offset: number = 0
): Promise<Provider[]> {
  const result = await db
    .select({ /* all fields */ })
    .from(providers)
    .where(isNull(providers.deletedAt))  // Exclude soft-deleted
    .orderBy(desc(providers.createdAt))
    .limit(limit)
    .offset(offset);

  return result.map(toProvider);
}
```

**findAllProvidersFresh** (lines 234-299) - Direct database query (bypasses cache):

```typescript
export async function findAllProvidersFresh(): Promise<Provider[]> {
  const result = await db
    .select({ /* all fields */ })
    .from(providers)
    .where(isNull(providers.deletedAt))
    .orderBy(desc(providers.createdAt));

  return result.map(toProvider);
}
```

**findAllProviders** (lines 310-312) - With caching:

```typescript
export async function findAllProviders(): Promise<Provider[]> {
  return getCachedProviders(findAllProvidersFresh);
}
```

**findProviderById** (lines 314-374):

```typescript
export async function findProviderById(id: number): Promise<Provider | null> {
  const [provider] = await db
    .select({ /* all fields */ })
    .from(providers)
    .where(and(eq(providers.id, id), isNull(providers.deletedAt)));

  if (!provider) return null;
  return toProvider(provider);
}
```

#### Update - updateProvider

Lines 376-593:

```typescript
export async function updateProvider(
  id: number,
  providerData: UpdateProviderData
): Promise<Provider | null> {
  // Early return if no data to update
  if (Object.keys(providerData).length === 0) {
    return findProviderById(id);
  }

  // Build update data dynamically
  const dbData: any = { updatedAt: new Date() };
  if (providerData.name !== undefined) dbData.name = providerData.name;
  if (providerData.url !== undefined) dbData.url = providerData.url;
  // ... conditional field mapping for all fields

  // Handle vendor changes when URL changes
  let previousVendorId: number | null = null;
  if (providerData.url !== undefined || providerData.website_url !== undefined) {
    const [current] = await db.select({ /* ... */ }).from(providers).where(...);
    if (current) {
      previousVendorId = current.providerVendorId;
      const providerVendorId = await getOrCreateProviderVendorIdFromUrls({
        providerUrl: providerData.url ?? current.url,
        websiteUrl: providerData.website_url ?? current.websiteUrl,
        faviconUrl: providerData.favicon_url ?? current.faviconUrl,
        displayName: providerData.name ?? current.name,
      });
      dbData.providerVendorId = providerVendorId;
    }
  }

  // Execute update
  const [provider] = await db
    .update(providers)
    .set(dbData)
    .where(and(eq(providers.id, id), isNull(providers.deletedAt)))
    .returning({ /* all fields */ });

  if (!provider) return null;
  const transformed = toProvider(provider);

  // Update endpoint if URL or type changed
  if (providerData.url !== undefined || providerData.provider_type !== undefined) {
    await ensureProviderEndpointExistsForUrl({
      vendorId: transformed.providerVendorId,
      providerType: transformed.providerType,
      url: transformed.url,
    });
  }

  // Clean up empty vendor if vendor changed
  if (previousVendorId && transformed.providerVendorId !== previousVendorId) {
    await tryDeleteProviderVendorIfEmpty(previousVendorId);
  }

  return transformed;
}
```

**updateProviderPrioritiesBatch** (lines 595-630):

```typescript
export async function updateProviderPrioritiesBatch(
  updates: Array<{ id: number; priority: number }>
): Promise<number> {
  // Deduplicate: last one wins for same ID
  const updateMap = new Map<number, number>();
  for (const update of updates) {
    updateMap.set(update.id, update.priority);
  }

  const ids = Array.from(updateMap.keys());
  const cases = ids.map((id) => sql`WHEN ${id} THEN ${updateMap.get(id)!}`);

  // Use CASE statement for efficient batch update
  const query = sql`
    UPDATE providers
    SET
      priority = CASE id ${sql.join(cases, sql` `)} ELSE priority END,
      updated_at = NOW()
    WHERE id IN (${idList}) AND deleted_at IS NULL
  `;

  const result = await db.execute(query);
  return (result as any).rowCount || 0;
}
```

**updateProvidersBatch** (lines 650-699):

```typescript
export async function updateProvidersBatch(
  ids: number[],
  updates: BatchProviderUpdates
): Promise<number> {
  const setClauses: Record<string, unknown> = { updatedAt: new Date() };

  if (updates.isEnabled !== undefined) setClauses.isEnabled = updates.isEnabled;
  if (updates.priority !== undefined) setClauses.priority = updates.priority;
  if (updates.weight !== undefined) setClauses.weight = updates.weight;
  if (updates.costMultiplier !== undefined) setClauses.costMultiplier = updates.costMultiplier;
  if (updates.groupTag !== undefined) setClauses.groupTag = updates.groupTag;

  const result = await db
    .update(providers)
    .set(setClauses)
    .where(sql`id IN (${idList}) AND deleted_at IS NULL`)
    .returning({ id: providers.id });

  return result.length;
}
```

#### Delete Operations

**deleteProvider** (lines 632-640) - Soft delete:

```typescript
export async function deleteProvider(id: number): Promise<boolean> {
  const result = await db
    .update(providers)
    .set({ deletedAt: new Date() })
    .where(and(eq(providers.id, id), isNull(providers.deletedAt)))
    .returning({ id: providers.id });

  return result.length > 0;
}
```

**deleteProvidersBatch** (lines 701-724):

```typescript
export async function deleteProvidersBatch(ids: number[]): Promise<number> {
  const result = await db
    .update(providers)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(sql`id IN (${idList}) AND deleted_at IS NULL`)
    .returning({ id: providers.id });

  return result.length;
}
```

### Action Layer Business Operations

Located in `/Users/ding/Github/claude-code-hub/src/actions/providers.ts`.

#### getProviders

Lines 164-307:

```typescript
export async function getProviders(): Promise<ProviderDisplay[]> {
  // Permission check
  const session = await getSession();
  if (!session || session.user.role !== "admin") {
    return [];  // Silent fail for non-admins
  }

  const providers = await findAllProvidersFresh();

  return providers.map((provider) => ({
    id: provider.id,
    name: provider.name,
    url: provider.url,
    maskedKey: maskKey(provider.key),  // Masked for security
    isEnabled: provider.isEnabled,
    weight: provider.weight,
    priority: provider.priority,
    costMultiplier: provider.costMultiplier,
    groupTag: provider.groupTag,
    providerType: provider.providerType,
    // ... all other fields
    createdAt: createdAtStr,
    updatedAt: updatedAtStr,
    todayTotalCostUsd: stats?.today_cost ?? "0",
    todayCallCount: stats?.today_calls ?? 0,
    lastCallTime: lastCallTimeStr,
    lastCallModel: stats?.last_call_model ?? null,
  }));
}
```

#### addProvider

Lines 442-605:

```typescript
export async function addProvider(data: {
  name: string;
  url: string;
  key: string;
  // ... 40+ optional fields
}): Promise<ActionResult> {
  // Permission check
  const session = await getSession();
  if (!session || session.user.role !== "admin") {
    return { ok: false, error: "Permission denied" };
  }

  // Validate proxy URL format
  if (data.proxy_url && !isValidProxyUrl(data.proxy_url)) {
    return {
      ok: false,
      error: "Invalid proxy URL format. Supported: http://, https://, socks5://, socks4://",
    };
  }

  // Schema validation
  const validated = CreateProviderSchema.parse(data);

  // Auto-generate favicon from website URL
  let faviconUrl: string | null = null;
  if (validated.website_url) {
    const url = new URL(validated.website_url);
    const domain = url.hostname;
    faviconUrl = `https://www.google.com/s2/favicons?domain=${domain}&sz=32`;
  }

  const payload = { ...validated, favicon_url: faviconUrl };

  // Create provider
  const provider = await createProvider(payload);

  // Sync circuit breaker config to Redis
  await saveProviderCircuitConfig(provider.id, {
    failureThreshold: provider.circuitBreakerFailureThreshold,
    openDuration: provider.circuitBreakerOpenDuration,
    halfOpenSuccessThreshold: provider.circuitBreakerHalfOpenSuccessThreshold,
  });

  // Broadcast cache invalidation
  await broadcastProviderCacheInvalidation({ operation: "add", providerId: provider.id });

  return { ok: true };
}
```

#### editProvider

Lines 608-739:

```typescript
export async function editProvider(
  providerId: number,
  data: { /* optional fields */ }
): Promise<ActionResult> {
  // Permission check
  const session = await getSession();
  if (!session || session.user.role !== "admin") {
    return { ok: false, error: "Permission denied" };
  }

  // Validate proxy URL
  if (data.proxy_url && !isValidProxyUrl(data.proxy_url)) {
    return { ok: false, error: "Invalid proxy URL format" };
  }

  const validated = UpdateProviderSchema.parse(data);

  // Regenerate favicon if website_url changed
  let faviconUrl: string | null | undefined;
  if (validated.website_url !== undefined) {
    if (validated.website_url) {
      const url = new URL(validated.website_url);
      faviconUrl = `https://www.google.com/s2/favicons?domain=${url.hostname}&sz=32`;
    } else {
      faviconUrl = null;
    }
  }

  const payload = {
    ...validated,
    ...(faviconUrl !== undefined && { favicon_url: faviconUrl }),
  };

  const provider = await updateProvider(providerId, payload);
  if (!provider) {
    return { ok: false, error: "Provider not found" };
  }

  // Sync circuit breaker config if changed
  const hasCircuitConfigChange =
    validated.circuit_breaker_failure_threshold !== undefined ||
    validated.circuit_breaker_open_duration !== undefined ||
    validated.circuit_breaker_half_open_success_threshold !== undefined;

  if (hasCircuitConfigChange) {
    await saveProviderCircuitConfig(providerId, {
      failureThreshold: provider.circuitBreakerFailureThreshold,
      openDuration: provider.circuitBreakerOpenDuration,
      halfOpenSuccessThreshold: provider.circuitBreakerHalfOpenSuccessThreshold,
    });
    clearConfigCache(providerId);
  }

  await broadcastProviderCacheInvalidation({ operation: "edit", providerId });

  return { ok: true };
}
```

#### removeProvider

Lines 742-781:

```typescript
export async function removeProvider(providerId: number): Promise<ActionResult> {
  const session = await getSession();
  if (!session || session.user.role !== "admin") {
    return { ok: false, error: "Permission denied" };
  }

  const provider = await findProviderById(providerId);
  await deleteProvider(providerId);

  // Clear memory cache
  clearConfigCache(providerId);
  await clearProviderState(providerId);

  // Delete Redis cache
  await deleteProviderCircuitConfig(providerId);

  // Auto-cleanup vendor if empty
  if (provider?.providerVendorId) {
    await tryDeleteProviderVendorIfEmpty(provider.providerVendorId);
  }

  await broadcastProviderCacheInvalidation({ operation: "remove", providerId });

  return { ok: true };
}
```

#### batchDeleteProviders

Lines 1073-1121:

```typescript
export async function batchDeleteProviders(
  params: { providerIds: number[] }
): Promise<ActionResult<{ deletedCount: number }>> {
  const session = await getSession();
  if (!session || session.user.role !== "admin") {
    return { ok: false, error: "Permission denied" };
  }

  const { providerIds } = params;

  if (!providerIds || providerIds.length === 0) {
    return { ok: false, error: "Please select providers to delete" };
  }

  if (providerIds.length > BATCH_OPERATION_MAX_SIZE) {
    return { ok: false, error: `Batch operations limited to ${BATCH_OPERATION_MAX_SIZE} providers` };
  }

  const deletedCount = await deleteProvidersBatch(providerIds);

  // Clear cache for all deleted providers
  for (const id of providerIds) {
    clearProviderState(id);
    clearConfigCache(id);
  }

  await broadcastProviderCacheInvalidation({
    operation: "remove",
    providerId: providerIds[0],
  });

  return { ok: true, data: { deletedCount } };
}
```

#### autoSortProviderPriority

Lines 783-907:

```typescript
export async function autoSortProviderPriority(args: {
  confirm: boolean;
}): Promise<ActionResult<AutoSortResult>> {
  const session = await getSession();
  if (!session || session.user.role !== "admin") {
    return { ok: false, error: "Permission denied" };
  }

  const providers = await findAllProvidersFresh();

  // Group by cost multiplier
  const groupsByCostMultiplier = new Map<number, typeof providers>();
  for (const provider of providers) {
    const costMultiplier = Number(provider.costMultiplier);
    const bucket = groupsByCostMultiplier.get(costMultiplier);
    if (bucket) {
      bucket.push(provider);
    } else {
      groupsByCostMultiplier.set(costMultiplier, [provider]);
    }
  }

  // Sort by cost multiplier ascending (lower cost = higher priority)
  const sortedCostMultipliers = Array.from(groupsByCostMultiplier.keys()).sort((a, b) => a - b);

  const changes: Array<{
    providerId: number;
    name: string;
    oldPriority: number;
    newPriority: number;
    costMultiplier: number;
  }> = [];

  for (const [priority, costMultiplier] of sortedCostMultipliers.entries()) {
    const groupProviders = groupsByCostMultiplier.get(costMultiplier) ?? [];
    for (const provider of groupProviders) {
      const oldPriority = provider.priority ?? 0;
      const newPriority = priority;
      if (oldPriority !== newPriority) {
        changes.push({ providerId: provider.id, name: provider.name, oldPriority, newPriority, costMultiplier });
      }
    }
  }

  if (args.confirm && changes.length > 0) {
    await updateProviderPrioritiesBatch(
      changes.map((change) => ({ id: change.providerId, priority: change.newPriority }))
    );
    await publishProviderCacheInvalidation();
  }

  return {
    ok: true,
    data: {
      groups,
      changes,
      summary: {
        totalProviders: providers.length,
        changedCount: changes.length,
        groupCount: groups.length,
      },
      applied: args.confirm,
    },
  };
}
```

#### getProviderLimitUsage

Lines 1169-1264:

```typescript
export async function getProviderLimitUsage(providerId: number): Promise<
  ActionResult<{
    cost5h: { current: number; limit: number | null; resetInfo: string };
    costDaily: { current: number; limit: number | null; resetAt?: Date };
    costWeekly: { current: number; limit: number | null; resetAt: Date };
    costMonthly: { current: number; limit: number | null; resetAt: Date };
    concurrentSessions: { current: number; limit: number };
  }>
> {
  const session = await getSession();
  if (!session || session.user.role !== "admin") {
    return { ok: false, error: "Permission denied" };
  }

  const provider = await findProviderById(providerId);
  if (!provider) {
    return { ok: false, error: "Provider not found" };
  }

  // Calculate time ranges for each period
  const [range5h, rangeDaily, rangeWeekly, rangeMonthly] = await Promise.all([
    getTimeRangeForPeriod("5h"),
    getTimeRangeForPeriodWithMode("daily", provider.dailyResetTime, provider.dailyResetMode),
    getTimeRangeForPeriod("weekly"),
    getTimeRangeForPeriod("monthly"),
  ]);

  // Get spending and concurrent sessions
  const [cost5h, costDaily, costWeekly, costMonthly, concurrentSessions] = await Promise.all([
    sumProviderCostInTimeRange(providerId, range5h.startTime, range5h.endTime),
    sumProviderCostInTimeRange(providerId, rangeDaily.startTime, rangeDaily.endTime),
    sumProviderCostInTimeRange(providerId, rangeWeekly.startTime, rangeWeekly.endTime),
    sumProviderCostInTimeRange(providerId, rangeMonthly.startTime, rangeMonthly.endTime),
    SessionTracker.getProviderSessionCount(providerId),
  ]);

  return {
    ok: true,
    data: {
      cost5h: { current: cost5h, limit: provider.limit5hUsd, resetInfo: "..." },
      costDaily: { current: costDaily, limit: provider.limitDailyUsd, resetAt: ... },
      costWeekly: { current: costWeekly, limit: provider.limitWeeklyUsd, resetAt: ... },
      costMonthly: { current: costMonthly, limit: provider.limitMonthlyUsd, resetAt: ... },
      concurrentSessions: { current: concurrentSessions, limit: provider.limitConcurrentSessions || 0 },
    },
  };
}
```

### Validation Schemas

Located in `/Users/ding/Github/claude-code-hub/src/lib/validation/schemas.ts`.

#### CreateProviderSchema

Lines 355-532:

```typescript
export const CreateProviderSchema = z.object({
  name: z.string().min(1, "Provider name is required").max(64, "Max 64 characters"),
  url: z.string().url("Valid URL required").max(255, "Max 255 characters"),
  key: z.string().min(1, "API key is required").max(1024, "Max 1024 characters"),
  is_enabled: z.boolean().optional().default(true),
  weight: z.number().int().min(1).max(100).optional().default(1),
  priority: z.number().int().min(0).max(2147483647).optional().default(0),
  cost_multiplier: z.coerce.number().min(0).optional().default(1.0),
  group_tag: z.string().max(50).nullable().optional(),
  provider_type: z.enum([
    "claude", "claude-auth", "codex", "gemini", "gemini-cli", "openai-compatible"
  ]).optional().default("claude"),
  preserve_client_ip: z.boolean().optional().default(false),
  model_redirects: z.record(z.string(), z.string()).nullable().optional(),
  allowed_models: z.array(z.string()).nullable().optional(),
  join_claude_pool: z.boolean().optional().default(false),
  mcp_passthrough_type: z.enum(["none", "minimax", "glm", "custom"]).optional().default("none"),
  mcp_passthrough_url: z.string().max(512).url().nullable().optional(),
  // Spending limits
  limit_5h_usd: z.coerce.number().min(0).max(10000).nullable().optional(),
  limit_daily_usd: z.coerce.number().min(0).max(10000).nullable().optional(),
  daily_reset_mode: z.enum(["fixed", "rolling"]).optional().default("fixed"),
  daily_reset_time: z.string().regex(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/).optional().default("00:00"),
  limit_weekly_usd: z.coerce.number().min(0).max(50000).nullable().optional(),
  limit_monthly_usd: z.coerce.number().min(0).max(200000).nullable().optional(),
  limit_total_usd: z.coerce.number().min(0).max(10000000).nullable().optional(),
  limit_concurrent_sessions: z.coerce.number().int().min(0).max(1000).optional().default(0),
  // Circuit breaker
  max_retry_attempts: z.coerce.number().int().min(1).max(10).nullable().optional(),
  circuit_breaker_failure_threshold: z.coerce.number().int().min(0).optional(),
  circuit_breaker_open_duration: z.coerce.number().int().min(1000).max(86400000).optional(),
  circuit_breaker_half_open_success_threshold: z.coerce.number().int().min(1).max(10).optional(),
  // Proxy
  proxy_url: z.string().max(512).nullable().optional(),
  proxy_fallback_to_direct: z.boolean().optional().default(false),
  // Timeouts (0 = disabled)
  first_byte_timeout_streaming_ms: z.union([z.literal(0), z.coerce.number().int().min(1000).max(180000)]).optional(),
  streaming_idle_timeout_ms: z.union([z.literal(0), z.coerce.number().int().min(60000).max(600000)]).optional(),
  request_timeout_non_streaming_ms: z.union([z.literal(0), z.coerce.number().int().min(60000).max(1800000)]).optional(),
  // URLs
  website_url: z.string().url().max(512).nullable().optional(),
  favicon_url: z.string().max(512).nullable().optional(),
  // Deprecated
  tpm: z.number().int().nullable().optional(),
  rpm: z.number().int().nullable().optional(),
  rpd: z.number().int().nullable().optional(),
  cc: z.number().int().nullable().optional(),
});
```

#### UpdateProviderSchema

Lines 537-710:

Same as CreateProviderSchema but all fields are optional, with a final validation
that at least one field must be provided:

```typescript
export const UpdateProviderSchema = z.object({
  // ... same fields as CreateProviderSchema but all .optional()
}).refine((obj) => Object.keys(obj).length > 0, { message: "Update content is empty" });
```

### Constants

Located in `/Users/ding/Github/claude-code-hub/src/lib/constants/provider.constants.ts`.

```typescript
export const PROVIDER_LIMITS = {
  WEIGHT: { MIN: 1, MAX: 100 },
  MAX_RETRY_ATTEMPTS: { MIN: 1, MAX: 10 },
  LIMIT_5H_USD: { MIN: 0.1, MAX: 1000, STEP: 1 },
  LIMIT_WEEKLY_USD: { MIN: 1, MAX: 5000, STEP: 1 },
  LIMIT_MONTHLY_USD: { MIN: 10, MAX: 30000, STEP: 1 },
  CONCURRENT_SESSIONS: { MIN: 1, MAX: 150 },
} as const;

export const PROVIDER_DEFAULTS = {
  IS_ENABLED: true,
  WEIGHT: 1,
  MAX_RETRY_ATTEMPTS: 2,
} as const;

export const PROVIDER_GROUP = {
  DEFAULT: "default",
  ALL: "*",
} as const;

export const PROVIDER_TIMEOUT_LIMITS = {
  FIRST_BYTE_TIMEOUT_STREAMING_MS: { MIN: 1000, MAX: 180000 },
  STREAMING_IDLE_TIMEOUT_MS: { MIN: 60000, MAX: 600000 },
  REQUEST_TIMEOUT_NON_STREAMING_MS: { MIN: 60000, MAX: 1800000 },
} as const;

export const PROVIDER_TIMEOUT_DEFAULTS = {
  FIRST_BYTE_TIMEOUT_STREAMING_MS: 0,
  STREAMING_IDLE_TIMEOUT_MS: 0,
  REQUEST_TIMEOUT_NON_STREAMING_MS: 0,
} as const;
```

## Edge Cases

### 1. Provider Type Behavior Differences

Different provider types have distinct authentication and behavior patterns:

- **claude**: Standard Anthropic provider, sends x-api-key and Authorization headers
- **claude-auth**: Claude relay service, sends only Bearer auth (no x-api-key)
- **codex**: Codex CLI (Response API), supports reasoning_effort parameter overrides
- **gemini**: Gemini API, supports MCP passthrough
- **gemini-cli**: Gemini CLI specific
- **openai-compatible**: OpenAI-compatible API, supports chat completions endpoint

### 2. allowedModels Dual Semantics

The `allowedModels` field has different meanings based on provider type:

- **Anthropic providers (claude/claude-auth)**: Whitelist mode - restricts which models
  can be scheduled
- **Non-Anthropic providers**: Declaration mode - lists models the provider claims to
  support
- **null or empty array**: For Anthropic, allows all Claude models; for non-Anthropic,
  allows any model

### 3. Soft Delete and Data Retention

Providers use soft deletion (`deletedAt` field). When deleted:

- Sets `deletedAt` to current timestamp
- Preserves historical request logs (message_request table)
- Auto-cleans associated providerVendor if no active providers/endpoints remain
- Clears Redis cache and in-memory state

### 4. Automatic Vendor Management

Vendor management happens automatically:

```typescript
// Creating a provider automatically gets or creates vendor
const providerVendorId = await getOrCreateProviderVendorIdFromUrls({
  providerUrl: providerData.url,
  websiteUrl: providerData.website_url ?? null,
  faviconUrl: providerData.favicon_url ?? null,
  displayName: providerData.name,
});

// Deleting a provider auto-cleans empty vendor
await tryDeleteProviderVendorIfEmpty(providerVendorId);
```

### 5. Cache Invalidation

CRUD operations broadcast cache invalidation:

```typescript
async function broadcastProviderCacheInvalidation(context: {
  operation: "add" | "edit" | "remove";
  providerId: number;
}): Promise<void> {
  try {
    await publishProviderCacheInvalidation();
  } catch (error) {
    // Failure doesn't block main flow - other instances rely on TTL expiration
  }
}
```

### 6. Batch Operation Limits

All batch operations enforce a maximum size:

```typescript
const BATCH_OPERATION_MAX_SIZE = 500;
```

### 7. Cost Multiplier Precision

Cost multiplier uses `numeric(10, 4)` storage, supporting 4 decimal places:

```typescript
costMultiplier: numeric('cost_multiplier', { precision: 10, scale: 4 }).default('1.0')
```

### 8. Time Configuration Validation

The `daily_reset_time` must match HH:mm format:

```typescript
daily_reset_time: z.string().regex(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/)
```

### 9. Proxy URL Format Validation

Supported protocols: http://, https://, socks5://, socks4://

```typescript
export function isValidProxyUrl(url: string): boolean {
  const validProtocols = ['http:', 'https:', 'socks5:', 'socks4:'];
  try {
    const parsed = new URL(url);
    return validProtocols.includes(parsed.protocol) && !!parsed.hostname;
  } catch {
    return false;
  }
}
```

### 10. Circuit Breaker Config Sync

Circuit breaker configuration syncs to Redis for runtime access:

```typescript
await saveProviderCircuitConfig(provider.id, {
  failureThreshold: provider.circuitBreakerFailureThreshold,
  openDuration: provider.circuitBreakerOpenDuration,
  halfOpenSuccessThreshold: provider.circuitBreakerHalfOpenSuccessThreshold,
});
```

### 11. Provider Statistics Calculation

Statistics use the providerChain to determine the final provider (handles retry
switches):

```sql
CASE
  WHEN provider_chain IS NULL OR jsonb_array_length(provider_chain) = 0 THEN provider_id
  ELSE (provider_chain->-1->>'id')::int
END AS final_provider_id
```

### 12. Automatic Endpoint Creation

Creating or updating a provider automatically creates the corresponding endpoint:

```typescript
await ensureProviderEndpointExistsForUrl({
  vendorId: created.providerVendorId,
  providerType: created.providerType,
  url: created.url,
});
```

### 13. Group Tag Parsing

Group tags support comma-separated multiple tags:

```typescript
const groups = groupTag
  .split(",")
  .map((g) => g.trim())
  .filter(Boolean);
```

### 14. Spending Limit Precision

Spending fields use `numeric(10, 2)` for 2 decimal places (cents):

```typescript
limitDailyUsd: numeric('limit_daily_usd', { precision: 10, scale: 2 })
```

### 15. API Key Masking

API keys are masked for frontend display:

```typescript
export function maskKey(key: string): string {
  if (!key || key.length <= 8) return "••••••";
  return `${key.slice(0, 4)}••••••${key.slice(-4)}`;
}
```

### 16. Vendor Key Computation

Vendor keys are computed differently based on websiteUrl:

```typescript
export async function computeVendorKey(input: {
  providerUrl: string;
  websiteUrl?: string | null;
}): Promise<string | null> {
  // Case 1: websiteUrl provided - use hostname only (strip www, lowercase)
  if (websiteUrl?.trim()) {
    return normalizeWebsiteDomainFromUrl(websiteUrl);
  }

  // Case 2: websiteUrl empty - use host:port as key
  // IPv6 format: [ipv6]:port
  // Default ports: http=80, https=443
  return normalizeHostWithPort(providerUrl);
}
```

### 17. Concurrent Session Tracking

Provider-level concurrent session limits use Redis ZSET:

```typescript
// Located in /Users/ding/Github/claude-code-hub/src/lib/session-tracker.ts
static async getProviderSessionCount(providerId: number): Promise<number> {
  const key = `provider:${providerId}:active_sessions`;
  // Uses ZSET with timestamp scoring for automatic expiration
}
```

### 18. Circuit Breaker Reset

Manual reset of provider circuit breaker state:

```typescript
// Located in /Users/ding/Github/claude-code-hub/src/actions/providers.ts (lines 961-976)
export async function resetProviderCircuit(providerId: number): Promise<ActionResult> {
  const session = await getSession();
  if (!session || session.user.role !== "admin") {
    return { ok: false, error: "Permission denied" };
  }
  resetCircuit(providerId);
  return { ok: true };
}

// Batch reset (lines 1123-1164)
export async function batchResetProviderCircuits(
  params: { providerIds: number[] }
): Promise<ActionResult<{ resetCount: number }>> {
  for (const id of providerIds) {
    resetCircuit(id);
    clearConfigCache(id);
  }
  return { ok: true, data: { resetCount: providerIds.length } };
}
```

### 19. Total Usage Reset

Manual reset of provider "total spending" baseline:

```typescript
// Located in /Users/ding/Github/claude-code-hub/src/actions/providers.ts (lines 978-1002)
export async function resetProviderTotalUsage(providerId: number): Promise<ActionResult> {
  const session = await getSession();
  if (!session || session.user.role !== "admin") {
    return { ok: false, error: "Permission denied" };
  }

  // Updates total_cost_reset_at as aggregation baseline - does NOT delete logs
  const ok = await resetProviderTotalCostResetAt(providerId, new Date());
  if (!ok) {
    return { ok: false, error: "Provider not found" };
  }

  return { ok: true };
}
```

### 20. Provider Health Status

Get all providers' circuit breaker health status:

```typescript
// Located in /Users/ding/Github/claude-code-hub/src/actions/providers.ts (lines 909-956)
export async function getProvidersHealthStatus() {
  const session = await getSession();
  if (!session || session.user.role !== "admin") {
    return {};
  }

  const providerIds = await findAllProvidersFresh().then((providers) =>
    providers.map((p) => p.id)
  );
  const healthStatus = await getAllHealthStatusAsync(providerIds, { forceRefresh: true });

  const enrichedStatus: Record<number, {
    circuitState: "closed" | "open" | "half-open";
    failureCount: number;
    lastFailureTime: number | null;
    circuitOpenUntil: number | null;
    recoveryMinutes: number | null;
  }> = {};

  Object.entries(healthStatus).forEach(([providerId, health]) => {
    enrichedStatus[Number(providerId)] = {
      circuitState: health.circuitState,
      failureCount: health.failureCount,
      lastFailureTime: health.lastFailureTime,
      circuitOpenUntil: health.circuitOpenUntil,
      recoveryMinutes: health.circuitOpenUntil
        ? Math.ceil((health.circuitOpenUntil - Date.now()) / 60000)
        : null,
    };
  });

  return enrichedStatus;
}
```

### 21. Endpoint Auto-Creation

Each provider creation automatically creates a corresponding endpoint record:

```typescript
// Located in /Users/ding/Github/claude-code-hub/src/repository/provider-endpoints.ts (lines 717-751)
export async function ensureProviderEndpointExistsForUrl(input: {
  vendorId: number;
  providerType: ProviderType;
  url: string;
  label?: string | null;
}): Promise<boolean> {
  const trimmedUrl = input.url.trim();
  if (!trimmedUrl) return false;

  try {
    new URL(trimmedUrl);
  } catch {
    return false;
  }

  const inserted = await db
    .insert(providerEndpoints)
    .values({
      vendorId: input.vendorId,
      providerType: input.providerType,
      url: trimmedUrl,
      label: input.label ?? null,
      updatedAt: new Date(),
    })
    .onConflictDoNothing({
      target: [providerEndpoints.vendorId, providerEndpoints.providerType, providerEndpoints.url],
    })
    .returning({ id: providerEndpoints.id });

  return inserted.length > 0;
}
```

### 22. Data Transformer

Database rows are transformed to TypeScript types:

```typescript
// Located in /Users/ding/Github/claude-code-hub/src/repository/_shared/transformers.ts (lines 81-134)
export function toProvider(dbProvider: any): Provider {
  return {
    ...dbProvider,
    providerVendorId: dbProvider?.providerVendorId ?? null,
    isEnabled: dbProvider?.isEnabled ?? true,
    weight: dbProvider?.weight ?? 1,
    priority: dbProvider?.priority ?? 0,
    costMultiplier: dbProvider?.costMultiplier ? parseFloat(dbProvider.costMultiplier) : 1.0,
    // ... all fields with defaults and type conversions
    createdAt: dbProvider?.createdAt ? new Date(dbProvider.createdAt) : new Date(),
    updatedAt: dbProvider?.updatedAt ? new Date(dbProvider.updatedAt) : new Date(),
  };
}
```

### 23. Cache Strategy

Providers use multi-level caching:

```typescript
// Located in /Users/ding/Github/claude-code-hub/src/lib/cache/provider-cache.ts
const CACHE_TTL_MS = 30_000; // 30 seconds

export async function getCachedProviders(
  fetcher: () => Promise<Provider[]>
): Promise<Provider[]> {
  // 1. Process-level cache (30s TTL)
  const cached = providerCache.get<Provider[]>('all');
  if (cached) return cached;

  // 2. Fetch from database
  const providers = await fetcher();

  // 3. Write to cache
  providerCache.set('all', providers, { ttl: CACHE_TTL_MS });

  return providers;
}

// Redis Pub/Sub for cross-instance invalidation
export async function publishProviderCacheInvalidation(): Promise<void> {
  await redis.publish(CHANNEL_PROVIDERS_UPDATED, Date.now().toString());
}
```

## References

### Core Files

| File Path | Description |
|-----------|-------------|
| `/Users/ding/Github/claude-code-hub/src/drizzle/schema.ts` | Database schema (providers, providerVendors, providerEndpoints) |
| `/Users/ding/Github/claude-code-hub/src/types/provider.ts` | TypeScript types (Provider, CreateProviderData, UpdateProviderData) |
| `/Users/ding/Github/claude-code-hub/src/repository/provider.ts` | Repository layer CRUD operations |
| `/Users/ding/Github/claude-code-hub/src/repository/provider-endpoints.ts` | Vendor and endpoint management |
| `/Users/ding/Github/claude-code-hub/src/actions/providers.ts` | Action layer business logic |
| `/Users/ding/Github/claude-code-hub/src/lib/validation/schemas.ts` | Validation schemas |
| `/Users/ding/Github/claude-code-hub/src/lib/constants/provider.constants.ts` | Provider constants |
| `/Users/ding/Github/claude-code-hub/src/lib/cache/provider-cache.ts` | Provider caching |
| `/Users/ding/Github/claude-code-hub/src/repository/_shared/transformers.ts` | Data transformers |

### Database Indexes

```typescript
// Located in /Users/ding/Github/claude-code-hub/src/drizzle/schema.ts (lines 288-296)
(table) => ({
  // Optimize enabled provider queries (sorted by priority and weight)
  providersEnabledPriorityIdx: index('idx_providers_enabled_priority')
    .on(table.isEnabled, table.priority, table.weight)
    .where(sql`${table.deletedAt} IS NULL`),
  // Group query optimization
  providersGroupIdx: index('idx_providers_group')
    .on(table.groupTag)
    .where(sql`${table.deletedAt} IS NULL`),
  // Basic indexes
  providersCreatedAtIdx: index('idx_providers_created_at').on(table.createdAt),
  providersDeletedAtIdx: index('idx_providers_deleted_at').on(table.deletedAt),
  providersVendorTypeIdx: index('idx_providers_vendor_type')
    .on(table.providerVendorId, table.providerType)
    .where(sql`${table.deletedAt} IS NULL`),
})
```

### API Endpoints

```typescript
// Located in /Users/ding/Github/claude-code-hub/src/app/api/actions/[...route]/route.ts

// Provider list
GET /api/actions/providers/getProviders

// Vendor list
GET /api/actions/providers/getProviderVendors

// Endpoint list
POST /api/actions/providers/getProviderEndpoints
  { vendorId: number, providerType: ProviderType }

// Create endpoint
POST /api/actions/providers/addProviderEndpoint
  { vendorId, providerType, url, label?, sortOrder?, isEnabled? }

// Update endpoint
POST /api/actions/providers/editProviderEndpoint
  { endpointId, url?, label?, sortOrder?, isEnabled? }

// Delete endpoint
POST /api/actions/providers/removeProviderEndpoint
  { endpointId }

// Add provider
POST /api/actions/providers/addProvider

// Edit provider
POST /api/actions/providers/editProvider
  { providerId, ...fields }

// Remove provider
POST /api/actions/providers/removeProvider
  { providerId }

// Get health status
GET /api/actions/providers/getProvidersHealthStatus

// Reset circuit
POST /api/actions/providers/resetProviderCircuit
  { providerId }

// Get limit usage
POST /api/actions/providers/getProviderLimitUsage
  { providerId }

// Auto sort priority
POST /api/actions/providers/autoSortProviderPriority
  { confirm: boolean }

// Batch operations
POST /api/actions/providers/batchUpdateProviders
  { providerIds: number[], updates: { is_enabled?, priority?, weight?, cost_multiplier?, group_tag? } }

POST /api/actions/providers/batchDeleteProviders
  { providerIds: number[] }

POST /api/actions/providers/batchResetProviderCircuits
  { providerIds: number[] }
```

### Related Type Definitions

```typescript
// Provider type enum
export type ProviderType =
  | "claude"
  | "claude-auth"
  | "codex"
  | "gemini"
  | "gemini-cli"
  | "openai-compatible";

// MCP passthrough type
export type McpPassthroughType = "none" | "minimax" | "glm" | "custom";

// Codex instructions strategy
export type CodexInstructionsStrategy = "auto" | "force_official" | "keep_original";

// Codex parameter override preferences
type CodexReasoningEffortPreference = "inherit" | "none" | "minimal" | "low" | "medium" | "high" | "xhigh";
type CodexReasoningSummaryPreference = "inherit" | "auto" | "detailed";
type CodexTextVerbosityPreference = "inherit" | "low" | "medium" | "high";
type CodexParallelToolCallsPreference = "inherit" | "true" | "false";
```

---

## Corrections from Round 1

The following corrections were made based on code verification:

1. **ProviderType count**: The schema comment mentions "5 types" but the actual enum
   has 6 values (claude, claude-auth, codex, gemini, gemini-cli, openai-compatible).
   The comment at line 168-173 was missing "gemini".

2. **Validation limits discrepancy**: The schema validation limits differ from
   PROVIDER_LIMITS constants:
   - `limit_5h_usd`: Schema allows 0-10000, constant says 0.1-1000
   - `limit_weekly_usd`: Schema allows 0-50000, constant says 1-5000
   - `limit_monthly_usd`: Schema allows 0-200000, constant says 10-30000
   - `limit_concurrent_sessions`: Schema allows 0-1000, constant says 1-150
   The schema values (more permissive) are the actual enforcement points.

3. **maskKey implementation**: The actual implementation shows 6 dots (••••••)
   between head and tail, not 4 stars (****).

4. **Batch operation limit**: Confirmed as 500 (BATCH_OPERATION_MAX_SIZE).

5. **Cache TTL**: Confirmed as 30 seconds (30_000ms).

6. **Timeout defaults**: All timeout defaults are 0 (disabled), not arbitrary
   non-zero values.

7. **Permission patterns**: Two functions (getProviders, getProvidersHealthStatus)
   return empty data for non-admins (silent fail), while others return explicit
   permission errors.

8. **Daily reset time regex**: The actual regex is `/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/`
   which allows single-digit hours (like "9:00"), not strictly requiring two digits.

9. **toProvider transformer defaults**: The transformer provides specific defaults
   for timeout fields (30000, 10000, 600000) that differ from schema defaults (0).
   This is important for understanding actual runtime behavior.

10. **Session tracker key pattern**: Uses `provider:${providerId}:active_sessions`
    (ZSET with timestamp scoring), not `provider:${providerId}:sessions` (SET).

---

*Document generated: 2026-01-29*
*Verified against Claude Code Hub codebase*
