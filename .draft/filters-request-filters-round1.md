# Request Filters - Round 1 Exploration Draft

## Intent Analysis

### Purpose and Design Philosophy

The Request Filters feature in Claude Code Hub is a sophisticated request transformation system designed to intercept and modify incoming API requests before they are forwarded to upstream LLM providers. This feature was architected to address several real-world operational challenges in AI proxy infrastructure:

1. **Request Sanitization**: Remove or modify sensitive headers and body content before sending to external providers, ensuring internal authentication tokens or metadata never leak to third parties
2. **Protocol Adaptation**: Transform request formats to match specific provider requirements, enabling seamless integration with diverse API formats (OpenAI, Anthropic, Google, etc.)
3. **Data Masking**: Replace sensitive information in request bodies using patterns or JSON paths, supporting PII (Personally Identifiable Information) compliance requirements
4. **Header Management**: Add, remove, or override HTTP headers for specific providers or provider groups, enabling custom authentication schemes or metadata injection
5. **Provider-Specific Customization**: Apply different filter rules based on the selected provider or provider group, allowing fine-grained control per upstream endpoint

### Fail-Open Design Philosophy

The system is designed with a "fail-open" philosophy, meaning filter failures do not block the main request flow. This design choice ensures high availability even when filter configurations have issues. The rationale is that it's better to forward a request unmodified than to fail the request entirely due to a filter error. This is critical for production environments where request availability takes precedence over perfect filtering.

### Position in Request Lifecycle

Request filters occupy a strategic position in the request processing pipeline. They execute after authentication but before the request is forwarded to the upstream provider. This positioning allows filters to work with authenticated session data while still having the opportunity to modify requests before they leave the system.

### Two-Phase Filter Architecture

The system implements a two-phase filter architecture:

1. **Global Filters (Phase 1)**: Applied before provider selection, these filters can perform universal transformations that don't depend on which provider will handle the request
2. **Provider-Specific Filters (Phase 2)**: Applied after provider selection, these filters can make provider-aware transformations based on the specific upstream endpoint chosen

This architecture enables both broad, request-wide transformations and precise, provider-targeted modifications.

## Behavior Summary

### Core Architecture

The request filter system operates within the Guard Pipeline architecture, positioned strategically to allow request modification at two distinct phases:

1. **Global Filter Phase** (`requestFilter` step): Applied BEFORE provider selection
2. **Provider-Specific Filter Phase** (`providerRequestFilter` step): Applied AFTER provider selection

This two-phase approach enables both universal request preprocessing and provider-specific customizations.

### Pipeline Position

```
CHAT_PIPELINE execution order:
  1. auth              - API key authentication
  2. sensitive         - Sensitive word detection
  3. client            - Client validation
  4. model             - Model validation
  5. version           - Client version check
  6. probe             - Probe request handling
  7. session           - Session management
  8. warmup            - Warmup request handling
  9. requestFilter     - GLOBAL request filters ←
  10. rateLimit        - Rate limiting
  11. provider         - Provider selection
  12. providerRequestFilter - PROVIDER-SPECIFIC filters ←
  13. messageContext   - Message logging context
```

**Key Design Decision**: Global filters execute BEFORE sensitive word detection (as noted in `/Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/request-filter.ts` lines 10-11), allowing sensitive data to be sanitized before content filtering occurs.

### Filter Execution Flow

The complete execution flow of request filters is as follows:

```
Incoming Request
    ↓
ProxySession created (headers, body captured)
    ↓
Guard Pipeline executes
    ↓
requestFilter step
    ↓
RequestFilterEngine.applyGlobal(session)
    ↓
For each global filter:
    - Check scope (header/body)
    - Apply action (remove/set/json_path/text_replace)
    - Mutate session directly
    ↓
Provider Selection
    ↓
providerRequestFilter step
    ↓
RequestFilterEngine.applyForProvider(session)
    ↓
For each provider-specific filter:
    - Check binding match (providerId/groupTag)
    - Apply action
    ↓
Request forwarded to provider
```

### Session Mutation Model

Filters operate directly on the `ProxySession` object, which contains:

- `session.headers`: A `Headers` object that can be modified (delete/set operations)
- `session.request.message`: The parsed request body that can be transformed

This direct mutation model ensures that filter changes are immediately reflected in the request that will be forwarded to the provider. The session maintains a copy of the original headers (`originalHeaders`) for audit purposes, allowing comparison between pre-filter and post-filter states if needed.

### Filter Application Methods

The `RequestFilterEngine` class provides two primary methods for applying filters:

#### applyGlobal(session: ProxySession)

This method applies all global filters to the session. It is called during the `requestFilter` pipeline step, before provider selection. Global filters are those with `bindingType` set to `"global"` or null.

Key behaviors:
- Early exit if no global filters are configured
- Filters are applied in priority order (ascending)
- Each filter's scope determines whether it operates on headers or body
- Errors are caught and logged but do not stop execution

#### applyForProvider(session: ProxySession)

This method applies provider-specific filters after a provider has been selected. It matches filters based on:
- Direct provider ID matching (`bindingType: "providers"`)
- Group tag intersection (`bindingType: "groups"`)

Key behaviors:
- Requires `session.provider` to be set
- Skips execution with a warning if no provider is selected
- Uses Set-based lookups for O(1) provider matching
- Only applies filters whose binding criteria match the selected provider

### Filter Scope Determination

Each filter has a `scope` property that determines what part of the request it can modify:

- **`header` scope**: Operates on HTTP headers via `session.headers`
  - Actions: `remove`, `set`
  - Target: Header name (case-insensitive in most cases)
  - Replacement: String value (for `set` action)

- **`body` scope**: Operates on the request body via `session.request.message`
  - Actions: `json_path`, `text_replace`
  - Target: JSON path or search pattern
  - Replacement: Any JSON-serializable value

The scope is evaluated at filter application time, and the appropriate handler method is called based on the scope value.

## Configuration/Commands

### Administrative Interface

Request filters are managed through the administrative web interface at `/settings/request-filters`. The interface provides:

- **List View**: Display all configured filters with their status, scope, action, and binding
- **Create/Edit Dialog**: Form-based configuration with validation
- **Enable/Disable Toggle**: Quick activation/deactivation without deletion
- **Priority Adjustment**: Ordering control for filter execution sequence

The admin UI is implemented in:
- `/Users/ding/Github/claude-code-hub/src/app/[locale]/settings/request-filters/page.tsx` - Main page
- `/Users/ding/Github/claude-code-hub/src/app/[locale]/settings/request-filters/_components/filter-table.tsx` - Filter list table
- `/Users/ding/Github/claude-code-hub/src/app/[locale]/settings/request-filters/_components/filter-dialog.tsx` - Creation/editing dialog

### Server Actions API

The following server actions are available for programmatic filter management:

#### listRequestFilters()
Returns all request filters (admin only).

#### createRequestFilterAction(data)
Creates a new request filter with validation.

Parameters:
- `name`: Filter name (required)
- `description`: Optional description
- `scope`: `"header"` or `"body"` (required)
- `action`: `"remove"`, `"set"`, `"json_path"`, or `"text_replace"` (required)
- `target`: Header name, JSON path, or search pattern (required)
- `matchType`: `"regex"`, `"contains"`, `"exact"`, or `null`
- `replacement`: Replacement value (for set/json_path/text_replace)
- `priority`: Execution order (default: 0)
- `bindingType`: `"global"`, `"providers"`, or `"groups"` (default: "global")
- `providerIds`: Array of provider IDs (for providers binding)
- `groupTags`: Array of group tag strings (for groups binding)

#### updateRequestFilterAction(id, updates)
Updates an existing filter. Performs ReDoS validation when target is modified.

#### deleteRequestFilterAction(id)
Deletes a filter by ID.

#### refreshRequestFiltersCache()
Manually triggers a cache reload across all instances.

### Database Schema

Request filters are stored in the `request_filters` table defined in `/Users/ding/Github/claude-code-hub/src/drizzle/schema.ts` (lines 507-536):

```typescript
export const requestFilters = pgTable('request_filters', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 100 }).notNull(),
  description: text('description'),
  scope: varchar('scope', { length: 20 })
    .notNull()
    .$type<'header' | 'body'>(),
  action: varchar('action', { length: 30 })
    .notNull()
    .$type<'remove' | 'set' | 'json_path' | 'text_replace'>(),
  matchType: varchar('match_type', { length: 20 }),
  target: text('target').notNull(),
  replacement: jsonb('replacement'),
  priority: integer('priority').notNull().default(0),
  isEnabled: boolean('is_enabled').notNull().default(true),
  bindingType: varchar('binding_type', { length: 20 })
    .notNull()
    .default('global')
    .$type<'global' | 'providers' | 'groups'>(),
  providerIds: jsonb('provider_ids').$type<number[] | null>(),
  groupTags: jsonb('group_tags').$type<string[] | null>(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  requestFiltersEnabledIdx: index('idx_request_filters_enabled').on(table.isEnabled, table.priority),
  requestFiltersScopeIdx: index('idx_request_filters_scope').on(table.scope),
  requestFiltersActionIdx: index('idx_request_filters_action').on(table.action),
  requestFiltersBindingIdx: index('idx_request_filters_binding').on(table.isEnabled, table.bindingType),
}));
```

### Filter Types and Actions

#### Scope: Header

Header filters operate on HTTP headers in the request:

| Action | Description | Target | Replacement |
|--------|-------------|--------|-------------|
| `remove` | Delete a header | Header name | N/A |
| `set` | Set/overwrite a header | Header name | Header value |

**Implementation** (`/Users/ding/Github/claude-code-hub/src/lib/request-filter-engine.ts`, lines 346-365):

```typescript
private applyHeaderFilter(session: ProxySession, filter: CachedRequestFilter) {
  const key = filter.target;
  switch (filter.action) {
    case "remove":
      session.headers.delete(key);
      break;
    case "set": {
      const value =
        typeof filter.replacement === "string"
          ? filter.replacement
          : filter.replacement !== null && filter.replacement !== undefined
            ? JSON.stringify(filter.replacement)
            : "";
      session.headers.set(key, value);
      break;
    }
    default:
      logger.warn("[RequestFilterEngine] Unsupported header action", { action: filter.action });
  }
}
```

#### Scope: Body

Body filters operate on the request message body:

| Action | Description | Target | Replacement | Match Type |
|--------|-------------|--------|-------------|------------|
| `json_path` | Set value at JSON path | JSON path (e.g., `messages[0].content`) | New value | N/A |
| `text_replace` | Replace text matching pattern | Search pattern | Replacement text | `contains`, `exact`, `regex` |

**Implementation** (`/Users/ding/Github/claude-code-hub/src/lib/request-filter-engine.ts`, lines 367-394):

```typescript
private applyBodyFilter(session: ProxySession, filter: CachedRequestFilter) {
  const message = session.request.message as Record<string, unknown>;

  switch (filter.action as RequestFilterAction) {
    case "json_path": {
      setValueByPath(message, filter.target, filter.replacement ?? null);
      break;
    }
    case "text_replace": {
      const replacementStr =
        typeof filter.replacement === "string"
          ? filter.replacement
          : JSON.stringify(filter.replacement ?? "");
      const replaced = this.deepReplace(
        message,
        filter.target,
        replacementStr,
        filter.matchType,
        filter.compiledRegex
      );
      session.request.message = replaced as typeof session.request.message;
      break;
    }
    default:
      logger.warn("[RequestFilterEngine] Unsupported body action", { action: filter.action });
  }
}
```

### Match Types for text_replace

The `text_replace` action supports three match types (`/Users/ding/Github/claude-code-hub/src/lib/request-filter-engine.ts`, lines 70-112):

```typescript
function replaceText(
  input: string,
  target: string,
  replacement: string,
  matchType: RequestFilterMatchType,
  compiledRegex?: RegExp
): string {
  switch (matchType) {
    case "regex": {
      // Use pre-compiled regex if available
      if (compiledRegex) {
        try {
          const re = new RegExp(compiledRegex.source, compiledRegex.flags);
          return input.replace(re, replacement);
        } catch (error) {
          logger.error("[RequestFilterEngine] Regex replace failed", { error });
          return input;
        }
      }

      // Fallback to old logic (for backward compatibility)
      if (!safeRegex(target)) {
        logger.warn("[RequestFilterEngine] Skip unsafe regex", { target });
        return input;
      }
      try {
        const re = new RegExp(target, "g");
        return input.replace(re, replacement);
      } catch (error) {
        logger.error("[RequestFilterEngine] Invalid regex pattern", { target, error });
        return input;
      }
    }
    case "exact":
      return input === target ? replacement : input;
    default: {
      // "contains" or any unrecognized matchType defaults to simple string replacement
      if (!target) return input;
      return input.split(target).join(replacement);
    }
  }
}
```

### Binding Types

Filters can be bound at three levels:

| Binding Type | Description | Use Case |
|--------------|-------------|----------|
| `global` | Applies to ALL requests | Universal sanitization, common headers |
| `providers` | Applies to specific providers | Provider-specific API key headers |
| `groups` | Applies to providers with matching group tags | Multi-provider configurations |

**Provider Matching** (`/Users/ding/Github/claude-code-hub/src/lib/request-filter-engine.ts`, lines 304-318):

```typescript
for (const filter of this.providerFilters) {
  // Check binding match
  let matches = false;

  if (filter.bindingType === "providers") {
    // O(1) lookup using Set
    matches = filter.providerIdsSet?.has(providerId) ?? false;
  } else if (filter.bindingType === "groups" && providerTagsSet) {
    // O(m) intersection check
    matches = filter.groupTagsSet
      ? Array.from(providerTagsSet).some((tag) => filter.groupTagsSet!.has(tag))
      : false;
  }

  if (!matches) continue;
  // Apply filter...
}
```

### Priority and Ordering

Filters are executed in priority order (ascending), with ID as tiebreaker:

```typescript
this.globalFilters = cachedFilters
  .filter((f) => f.bindingType === "global" || !f.bindingType)
  .sort((a, b) => a.priority - b.priority || a.id - b.id);

this.providerFilters = cachedFilters
  .filter((f) => f.bindingType === "providers" || f.bindingType === "groups")
  .sort((a, b) => a.priority - b.priority || a.id - b.id);
```

Lower priority numbers execute first. This allows careful ordering of dependent transformations.

## Configuration Examples

### Example 1: Remove Sensitive Header (Global)

```json
{
  "name": "Remove X-Internal-Token",
  "description": "Remove internal authentication header before forwarding",
  "scope": "header",
  "action": "remove",
  "target": "X-Internal-Token",
  "priority": 10,
  "isEnabled": true,
  "bindingType": "global"
}
```

### Example 2: Set Provider-Specific API Key

```json
{
  "name": "Set OpenAI API Key",
  "description": "Override Authorization header for OpenAI provider",
  "scope": "header",
  "action": "set",
  "target": "Authorization",
  "replacement": "Bearer sk-openai-key-here",
  "priority": 20,
  "isEnabled": true,
  "bindingType": "providers",
  "providerIds": [1]
}
```

### Example 3: JSON Path Body Modification

```json
{
  "name": "Force Temperature",
  "description": "Override temperature parameter to 0.7",
  "scope": "body",
  "action": "json_path",
  "target": "temperature",
  "replacement": 0.7,
  "priority": 5,
  "isEnabled": true,
  "bindingType": "global"
}
```

### Example 4: Text Replace with Regex (Group Binding)

```json
{
  "name": "Mask Phone Numbers",
  "description": "Replace phone numbers in messages",
  "scope": "body",
  "action": "text_replace",
  "matchType": "regex",
  "target": "\\b\\d{3}[-.]?\\d{3}[-.]?\\d{4}\\b",
  "replacement": "[PHONE REDACTED]",
  "priority": 15,
  "isEnabled": true,
  "bindingType": "groups",
  "groupTags": ["production"]
}
```

### Example 5: Contains Match for PII

```json
{
  "name": "Remove SSN Patterns",
  "description": "Redact Social Security Numbers",
  "scope": "body",
  "action": "text_replace",
  "matchType": "contains",
  "target": "SSN:",
  "replacement": "[REDACTED]:",
  "priority": 25,
  "isEnabled": true,
  "bindingType": "global"
}
```

## Edge Cases and Behaviors

### 1. Fail-Open Design

Filter failures are logged but do not block the request:

```typescript
// From /Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/request-filter.ts
static async ensure(session: ProxySession): Promise<void> {
  try {
    await requestFilterEngine.applyGlobal(session);
  } catch (error) {
    // Fail-open: 过滤失败不阻塞主流程
    logger.error("[ProxyRequestFilter] Failed to apply global request filters", { error });
  }
}
```

### 2. ReDoS Protection

Regex patterns are validated for ReDoS (Regular Expression Denial of Service) attacks using the `safe-regex` library:

```typescript
// From /Users/ding/Github/claude-code-hub/src/actions/request-filters.ts
if (data.action === "text_replace" && data.matchType === "regex" && data.target) {
  if (!safeRegex(data.target)) {
    return "正则表达式存在 ReDoS 风险";
  }
}
```

Unsafe regex patterns are rejected at creation/update time and skipped at runtime.

### 3. JSON Path Creation

When using `json_path` action, missing intermediate objects/arrays are automatically created:

```typescript
// From /Users/ding/Github/claude-code-hub/src/lib/request-filter-engine.ts
if (current[key] === undefined) {
  const nextKey = keys[i + 1];
  current[key] = typeof nextKey === "number" ? [] : {};
}
```

### 4. Deep Replacement Recursion

`text_replace` with `contains` or `regex` match types recursively traverses the entire message object:

```typescript
// From /Users/ding/Github/claude-code-hub/src/lib/request-filter-engine.ts
private deepReplace(
  value: unknown,
  target: string,
  replacement: string,
  matchType: RequestFilterMatchType,
  compiledRegex?: RegExp
): unknown {
  if (typeof value === "string") {
    return replaceText(value, target, replacement, matchType, compiledRegex);
  }

  if (Array.isArray(value)) {
    return value.map((item) =>
      this.deepReplace(item, target, replacement, matchType, compiledRegex)
    );
  }

  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      result[k] = this.deepReplace(v, target, replacement, matchType, compiledRegex);
    }
    return result;
  }

  return value;
}
```

This ensures text replacement works within nested objects and arrays (e.g., message content).

### 5. Empty Filter Optimization

The engine includes early-exit optimizations when no filters are configured:

```typescript
// From /Users/ding/Github/claude-code-hub/src/lib/request-filter-engine.ts
async applyGlobal(session: ProxySession): Promise<void> {
  // Optimization #4: Early exit if already initialized and empty
  if (this.isInitialized && this.globalFilters.length === 0) return;
  // ...
}
```

### 6. Cache Warming and Hot Reload

Filters are cached in memory and reloaded automatically when changes occur:

```typescript
// Event-driven hot reload
constructor() {
  this.setupEventListener();
}

private async setupEventListener(): Promise<void> {
  if (typeof process !== "undefined" && process.env.NEXT_RUNTIME !== "edge") {
    const { eventEmitter } = await import("@/lib/event-emitter");
    eventEmitter.on("requestFiltersUpdated", () => {
      void this.reload();
    });
    // Cross-instance notification via Redis Pub/Sub
    const { CHANNEL_REQUEST_FILTERS_UPDATED, subscribeCacheInvalidation } = await import(
      "@/lib/redis/pubsub"
    );
    this.redisPubSubCleanup = await subscribeCacheInvalidation(
      CHANNEL_REQUEST_FILTERS_UPDATED,
      handler
    );
  }
}
```

### 7. Provider Filter Without Provider

If provider-specific filters are triggered but no provider is selected, a warning is logged and execution continues:

```typescript
// From /Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/provider-request-filter.ts
static async ensure(session: ProxySession): Promise<void> {
  if (!session.provider) {
    logger.warn(
      "[ProxyProviderRequestFilter] No provider selected, skipping provider-specific filters"
    );
    return;
  }
  // ...
}
```

### 8. count_tokens Pipeline Behavior

Request filters are applied even for token counting requests, but in a reduced pipeline:

```typescript
// From /Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/guard-pipeline.ts
export const COUNT_TOKENS_PIPELINE: GuardConfig = {
  // Minimal chain for count_tokens: no session, no sensitive, no rate limit, no message logging
  steps: [
    "auth",
    "client",
    "model",
    "version",
    "probe",
    "requestFilter",        // Global filters still applied
    "provider",
    "providerRequestFilter", // Provider-specific filters still applied
  ],
};
```

### 9. Binding Type Validation

The system enforces mutual exclusivity between binding types:

```typescript
// From /Users/ding/Github/claude-code-hub/src/actions/request-filters.ts
if (bindingType === "providers") {
  if (!data.providerIds || data.providerIds.length === 0) {
    return "至少选择一个 Provider";
  }
  if (data.groupTags && data.groupTags.length > 0) {
    return "不能同时选择 Providers 和 Groups";
  }
}
if (bindingType === "groups") {
  if (!data.groupTags || data.groupTags.length === 0) {
    return "至少选择一个 Group Tag";
  }
  if (data.providerIds && data.providerIds.length > 0) {
    return "不能同时选择 Providers 和 Groups";
  }
}
```

### 10. Original Headers Preservation

The ProxySession preserves original headers for potential audit/comparison:

```typescript
// From /Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/session.ts
private readonly originalHeaders: Headers; // Original headers copy for filter modification detection
```

## Implementation Details

### Key Files

| File | Purpose |
|------|---------|
| `/Users/ding/Github/claude-code-hub/src/lib/request-filter-engine.ts` | Core filter engine with caching and execution logic |
| `/Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/request-filter.ts` | Global filter guard step adapter |
| `/Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/provider-request-filter.ts` | Provider-specific filter guard step adapter |
| `/Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/guard-pipeline.ts` | Pipeline configuration and execution |
| `/Users/ding/Github/claude-code-hub/src/repository/request-filters.ts` | Database access layer |
| `/Users/ding/Github/claude-code-hub/src/actions/request-filters.ts` | Server actions for CRUD operations |
| `/Users/ding/Github/claude-code-hub/src/drizzle/schema.ts` | Database schema definition |
| `/Users/ding/Github/claude-code-hub/src/app/[locale]/settings/request-filters/page.tsx` | Admin UI page |
| `/Users/ding/Github/claude-code-hub/src/app/[locale]/settings/request-filters/_components/filter-dialog.tsx` | Filter creation/editing dialog |

### TypeScript Types

```typescript
// From /Users/ding/Github/claude-code-hub/src/repository/request-filters.ts
export type RequestFilterScope = "header" | "body";
export type RequestFilterAction = "remove" | "set" | "json_path" | "text_replace";
export type RequestFilterMatchType = "regex" | "contains" | "exact" | null;
export type RequestFilterBindingType = "global" | "providers" | "groups";

export interface RequestFilter {
  id: number;
  name: string;
  description: string | null;
  scope: RequestFilterScope;
  action: RequestFilterAction;
  matchType: RequestFilterMatchType;
  target: string;
  replacement: unknown;
  priority: number;
  isEnabled: boolean;
  bindingType: RequestFilterBindingType;
  providerIds: number[] | null;
  groupTags: string[] | null;
  createdAt: Date;
  updatedAt: Date;
}
```

### Performance Optimizations

The RequestFilterEngine implements several sophisticated optimizations to ensure minimal overhead on request processing:

#### 1. Regex Pre-compilation
Regex patterns for `text_replace` with `matchType: "regex"` are compiled once during filter loading and reused:

```typescript
// From /Users/ding/Github/claude-code-hub/src/lib/request-filter-engine.ts
if (f.matchType === "regex" && f.action === "text_replace") {
  if (!safeRegex(f.target)) {
    logger.warn("[RequestFilterEngine] Skip unsafe regex at load", {
      filterId: f.id,
      target: f.target,
    });
  } else {
    try {
      cached.compiledRegex = new RegExp(f.target, "g");
    } catch (error) {
      logger.warn("[RequestFilterEngine] Failed to compile regex at load", {
        filterId: f.id,
        target: f.target,
        error,
      });
    }
  }
}
```

This avoids the overhead of compiling regex patterns on every request.

#### 2. Set-based Lookups
Provider IDs and group tags are converted to Sets during filter loading for O(1) lookup performance:

```typescript
// Optimization #3: Create Set caches for faster lookups
if (f.bindingType === "providers" && f.providerIds) {
  cached.providerIdsSet = new Set(f.providerIds);
}
if (f.bindingType === "groups" && f.groupTags) {
  cached.groupTagsSet = new Set(f.groupTags);
}
```

#### 3. Lazy Initialization
Filters are loaded from the database only when the first request needs them:

```typescript
private async ensureInitialized(): Promise<void> {
  if (this.isInitialized) return;
  if (!this.initializationPromise) {
    this.initializationPromise = this.reload().finally(() => {
      this.initializationPromise = null;
    });
  }
  await this.initializationPromise;
}
```

#### 4. Early Exit
Empty filter lists bypass all processing:

```typescript
async applyGlobal(session: ProxySession): Promise<void> {
  // Optimization #4: Early exit if already initialized and empty
  if (this.isInitialized && this.globalFilters.length === 0) return;
  // ...
}
```

#### 5. Conditional Tag Parsing
Provider group tags are only parsed when group-based filters exist:

```typescript
// Optimization #5: Only parse tags if we have group-based filters
let providerTagsSet: Set<string> | null = null;
if (this.hasGroupBasedFilters) {
  const providerGroupTag = session.provider.groupTag;
  providerTagsSet = new Set(providerGroupTag?.split(",").map((t) => t.trim()) ?? []);
}
```

### Memory Management

The engine provides cleanup methods to prevent memory leaks in long-running processes:

```typescript
// From /Users/ding/Github/claude-code-hub/src/lib/request-filter-engine.ts
destroy(): void {
  if (this.eventEmitterCleanup) {
    this.eventEmitterCleanup();
    this.eventEmitterCleanup = null;
  }
  if (this.redisPubSubCleanup) {
    this.redisPubSubCleanup();
    this.redisPubSubCleanup = null;
  }
}
```

This is particularly important for test environments and hot-reloading scenarios where the engine instance may be recreated multiple times.

### Statistics and Monitoring

The engine exposes statistics for monitoring:

```typescript
getStats() {
  return {
    count: this.globalFilters.length + this.providerFilters.length,
    lastReloadTime: this.lastReloadTime,
    isLoading: this.isLoading,
    isInitialized: this.isInitialized,
  };
}
```

These stats are used by the admin interface to show cache status and filter counts.

## References

### Internal Documentation

- `/Users/ding/Github/claude-code-hub/CLAUDE.md` - Project architecture overview
- `/Users/ding/Github/claude-code-hub/docs/architecture-claude-code-hub-2025-11-29.md` - Detailed architecture document

### Database Migration

- `/Users/ding/Github/claude-code-hub/drizzle/0024_request-filters.sql` - Initial table creation

### Related Features

- Sensitive Words (`/docs/filters/sensitive-words`) - Content filtering that executes after request filters
- Error Rules (`/docs/filters/error-rules`) - Response error pattern matching
- Provider Management (`/docs/providers/crud`) - Provider configuration for filter binding

### External Dependencies

- `safe-regex` - ReDoS protection for regex patterns
- `drizzle-orm` - Database ORM for filter persistence

## Additional Use Cases and Scenarios

### Use Case 1: Multi-Tenant API Key Management

In a multi-tenant deployment, different users may need to use different API keys for the same provider. Request filters can dynamically set the Authorization header based on the selected provider:

```json
{
  "name": "Tenant A - OpenAI Key",
  "scope": "header",
  "action": "set",
  "target": "Authorization",
  "replacement": "Bearer sk-tenant-a-key",
  "priority": 10,
  "isEnabled": true,
  "bindingType": "providers",
  "providerIds": [1]
}
```

### Use Case 2: Request Parameter Normalization

Different LLM providers may have different parameter requirements. Filters can normalize parameters:

```json
{
  "name": "Normalize max_tokens",
  "description": "Ensure max_tokens is set for all requests",
  "scope": "body",
  "action": "json_path",
  "target": "max_tokens",
  "replacement": 4096,
  "priority": 5,
  "isEnabled": true,
  "bindingType": "global"
}
```

### Use Case 3: PII Scrubbing for Compliance

For HIPAA or GDPR compliance, sensitive data must be removed before sending to external providers:

```json
{
  "name": "Remove Email Addresses",
  "description": "Scrub email addresses from all messages",
  "scope": "body",
  "action": "text_replace",
  "matchType": "regex",
  "target": "[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}",
  "replacement": "[EMAIL REDACTED]",
  "priority": 1,
  "isEnabled": true,
  "bindingType": "global"
}
```

### Use Case 4: Provider-Specific Feature Flags

Some providers support features that others don't. Filters can inject feature flags:

```json
{
  "name": "Enable JSON Mode for GPT-4",
  "scope": "body",
  "action": "json_path",
  "target": "response_format",
  "replacement": { "type": "json_object" },
  "priority": 20,
  "isEnabled": true,
  "bindingType": "providers",
  "providerIds": [2, 3]
}
```

### Use Case 5: Request Metadata Injection

Internal tracking IDs can be added to requests:

```json
{
  "name": "Add Request ID Header",
  "scope": "header",
  "action": "set",
  "target": "X-Request-ID",
  "replacement": "{{generated_uuid}}",
  "priority": 1,
  "isEnabled": true,
  "bindingType": "global"
}
```

Note: Dynamic values like UUIDs would require custom implementation; the replacement field currently supports static values only.

## Troubleshooting and Debugging

### Common Issues

#### 1. Filters Not Applying

Check the following:
- Is the filter enabled (`isEnabled: true`)?
- Is the priority correct (lower numbers execute first)?
- For provider-specific filters: is the provider correctly selected?
- Check server logs for filter application errors

#### 2. Regex Patterns Not Matching

- Verify the regex syntax is valid JavaScript/TypeScript
- Check that the pattern passes ReDoS validation
- Test the pattern independently against sample data
- Remember that `text_replace` with `regex` match type performs a global replace

#### 3. JSON Path Not Working

- The JSON path format supports dot notation (`messages[0].content`) and bracket notation
- Arrays are automatically created for numeric indices
- Objects are automatically created for string keys
- Invalid paths are logged as warnings

### Logging

The filter engine logs at several points:

- Filter loading: `[RequestFilterEngine] Filters loaded { globalCount, providerCount }`
- Filter errors: `[RequestFilterEngine] Failed to apply global filter { filterId, scope, action, error }`
- Regex warnings: `[RequestFilterEngine] Skip unsafe regex { target }`

Enable debug logging to see detailed filter application information.

### Testing Filters

When creating new filters:

1. Start with a high priority number (e.g., 100) to test without affecting existing filters
2. Use the `contains` match type first, then refine to `regex` if needed
3. Test with sample requests through the proxy
4. Monitor logs for any errors or warnings
5. Adjust priority as needed for proper ordering

## Security Considerations

### ReDoS Protection

All regex patterns are validated using the `safe-regex` library to prevent Regular Expression Denial of Service attacks. Patterns that exhibit exponential backtracking behavior are rejected.

### Header Injection Risks

When using the `set` action on headers:
- Be cautious with headers like `Content-Length` which could corrupt requests
- Avoid setting security-sensitive headers unless specifically required
- Validate replacement values to prevent header injection attacks

### Data Leakage Prevention

The `originalHeaders` field in ProxySession preserves the pre-filter state for audit purposes. Ensure this data is handled appropriately in your logging and monitoring systems.

### Access Control

Filter management is restricted to admin users only. The server actions verify the session role before allowing any modifications:

```typescript
const session = await getSession();
if (!isAdmin(session)) return { ok: false, error: "权限不足" };
```

## Future Enhancements

Potential areas for future development:

1. **Conditional Filters**: Apply filters based on request content conditions
2. **Template Variables**: Support for dynamic values like timestamps, UUIDs, or request metadata
3. **Filter Chains**: Explicit dependencies between filters
4. **Testing Interface**: Built-in filter testing against sample requests
5. **Metrics**: Per-filter execution metrics and success rates
6. **Filter Versioning**: Track changes to filter configurations over time

## References

### Internal Documentation

- `/Users/ding/Github/claude-code-hub/CLAUDE.md` - Project architecture overview
- `/Users/ding/Github/claude-code-hub/docs/architecture-claude-code-hub-2025-11-29.md` - Detailed architecture document

### Database Migration

- `/Users/ding/Github/claude-code-hub/drizzle/0024_request-filters.sql` - Initial table creation

### Related Features

- Sensitive Words (`/docs/filters/sensitive-words`) - Content filtering that executes after request filters
- Error Rules (`/docs/filters/error-rules`) - Response error pattern matching
- Provider Management (`/docs/providers/crud`) - Provider configuration for filter binding

### External Dependencies

- `safe-regex` - ReDoS protection for regex patterns
- `drizzle-orm` - Database ORM for filter persistence

### Source Code Locations

| Component | File Path |
|-----------|-----------|
| Core Engine | `/Users/ding/Github/claude-code-hub/src/lib/request-filter-engine.ts` |
| Global Filter Step | `/Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/request-filter.ts` |
| Provider Filter Step | `/Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/provider-request-filter.ts` |
| Pipeline Configuration | `/Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/guard-pipeline.ts` |
| Database Repository | `/Users/ding/Github/claude-code-hub/src/repository/request-filters.ts` |
| Server Actions | `/Users/ding/Github/claude-code-hub/src/actions/request-filters.ts` |
| Database Schema | `/Users/ding/Github/claude-code-hub/src/drizzle/schema.ts` |
| Admin UI Page | `/Users/ding/Github/claude-code-hub/src/app/[locale]/settings/request-filters/page.tsx` |
| Filter Dialog | `/Users/ding/Github/claude-code-hub/src/app/[locale]/settings/request-filters/_components/filter-dialog.tsx` |
| Filter Table | `/Users/ding/Github/claude-code-hub/src/app/[locale]/settings/request-filters/_components/filter-table.tsx` |
| Event Emitter | `/Users/ding/Github/claude-code-hub/src/lib/emit-event.ts` |

---

*Document generated for: `/docs/filters/request-filters`*
*Exploration date: 2026-01-29*
