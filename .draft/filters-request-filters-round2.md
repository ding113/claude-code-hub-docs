# Request Filters - Round 2 Verified Draft

## Review Summary

**Verification Status**: COMPLETED with CRITICAL CORRECTIONS

### Critical Corrections Made

1. **Pipeline Order CORRECTED**: Round1 incorrectly claimed `requestFilter` executes BEFORE `sensitive`. The actual CHAT_PIPELINE order shows `sensitive` is step 2 and `requestFilter` is step 9. The comment in `request-filter.ts` is OUTDATED.

2. **Missing UI Components Added**: Added `group-multi-select.tsx`, `provider-multi-select.tsx`, `request-filters-skeleton.tsx`.

3. **Missing Server Actions Added**: Added `listProvidersForFilterAction` and `getDistinctProviderGroupsAction`.

4. **Code snippets verified**: All code snippets verified against actual implementation.

---

## Intent Analysis

### Purpose and Design Philosophy

The Request Filters feature in Claude Code Hub is a request transformation system designed to intercept and modify incoming API requests before they are forwarded to upstream LLM providers. This feature addresses several operational challenges:

1. **Request Sanitization**: Remove or modify sensitive headers and body content before sending to external providers
2. **Data Masking**: Replace sensitive information in request bodies using patterns or JSON paths (PII compliance)
3. **Header Management**: Add, remove, or override HTTP headers for specific providers or provider groups
4. **Provider-Specific Customization**: Apply different filter rules based on the selected provider or provider group

### Fail-Open Design Philosophy

The system uses a "fail-open" philosophy - filter failures do not block the main request flow. This ensures high availability even when filter configurations have issues.

### Two-Phase Filter Architecture

The system implements a two-phase filter architecture:

1. **Global Filters (Phase 1)**: Applied before provider selection via `requestFilter` step
2. **Provider-Specific Filters (Phase 2)**: Applied after provider selection via `providerRequestFilter` step

---

## Behavior Summary

### Core Architecture

The request filter system operates within the Guard Pipeline architecture at two distinct phases:

1. **Global Filter Phase** (`requestFilter` step): Applied BEFORE provider selection
2. **Provider-Specific Filter Phase** (`providerRequestFilter` step): Applied AFTER provider selection

### Pipeline Position

**VERIFIED from `/Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/guard-pipeline.ts` (lines 172-188):**

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
  9. requestFilter     - GLOBAL request filters
  10. rateLimit        - Rate limiting
  11. provider         - Provider selection
  12. providerRequestFilter - PROVIDER-SPECIFIC filters
  13. messageContext   - Message logging context
```

**IMPORTANT**: Global request filters execute AFTER sensitive word detection, not before. The comment in `request-filter.ts` (lines 10-11) stating "在 GuardPipeline 中于敏感词检测前执行" is OUTDATED and does not reflect the actual pipeline configuration.

### COUNT_TOKENS_PIPELINE

**VERIFIED from guard-pipeline.ts (lines 191-203):**

```typescript
export const COUNT_TOKENS_PIPELINE: GuardConfig = {
  steps: [
    "auth",
    "client",
    "model",
    "version",
    "probe",
    "requestFilter",        // Global filters applied
    "provider",
    "providerRequestFilter", // Provider-specific filters applied
  ],
};
```

Note: COUNT_TOKENS_PIPELINE does NOT include `sensitive`, `session`, `warmup`, `rateLimit`, or `messageContext` steps.

### Filter Execution Flow

```
Incoming Request
    |
ProxySession created (headers, body captured)
    |
Guard Pipeline executes
    |
requestFilter step
    |
RequestFilterEngine.applyGlobal(session)
    |
For each global filter:
    - Check scope (header/body)
    - Apply action (remove/set/json_path/text_replace)
    - Mutate session directly
    |
Provider Selection
    |
providerRequestFilter step
    |
RequestFilterEngine.applyForProvider(session)
    |
For each provider-specific filter:
    - Check binding match (providerId/groupTag)
    - Apply action
    |
Request forwarded to provider
```

### Session Mutation Model

Filters operate directly on the `ProxySession` object:

- `session.headers`: A `Headers` object that can be modified (delete/set operations)
- `session.request.message`: The parsed request body that can be transformed

**VERIFIED from `/Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/session.ts` (lines 55-59):**

```typescript
readonly headers: Headers;
// 原始 headers 的副本，用于检测过滤器修改
private readonly originalHeaders: Headers;
readonly headerLog: string;
readonly request: ProxyRequestPayload;
```

---

## Configuration/Commands

### Administrative Interface

Request filters are managed through the administrative web interface at `/settings/request-filters`.

**VERIFIED UI Components:**

| File | Purpose |
|------|---------|
| `page.tsx` | Main page with Suspense loading |
| `filter-table.tsx` | Filter list table with enable/disable toggle |
| `filter-dialog.tsx` | Creation/editing dialog |
| `provider-multi-select.tsx` | Provider selection for binding |
| `group-multi-select.tsx` | Group tag selection for binding |
| `request-filters-skeleton.tsx` | Loading skeleton |

### Server Actions API

**VERIFIED from `/Users/ding/Github/claude-code-hub/src/actions/request-filters.ts`:**

#### listRequestFilters()
Returns all request filters (admin only). Returns empty array if not admin.

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

#### listProvidersForFilterAction()
Returns list of all providers (id, name) for filter binding selection.

#### getDistinctProviderGroupsAction()
Returns distinct provider group tags for filter binding selection.

### Database Schema

**VERIFIED from `/Users/ding/Github/claude-code-hub/src/drizzle/schema.ts` (lines 507-536):**

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

---

## Filter Types and Actions

### Scope: Header

Header filters operate on HTTP headers in the request:

| Action | Description | Target | Replacement |
|--------|-------------|--------|-------------|
| `remove` | Delete a header | Header name | N/A |
| `set` | Set/overwrite a header | Header name | Header value |

**VERIFIED Implementation from `/Users/ding/Github/claude-code-hub/src/lib/request-filter-engine.ts` (lines 346-365):**

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

### Scope: Body

Body filters operate on the request message body:

| Action | Description | Target | Replacement | Match Type |
|--------|-------------|--------|-------------|------------|
| `json_path` | Set value at JSON path | JSON path (e.g., `messages[0].content`) | New value | N/A |
| `text_replace` | Replace text matching pattern | Search pattern | Replacement text | `contains`, `exact`, `regex` |

**VERIFIED Implementation from request-filter-engine.ts (lines 367-394):**

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

**VERIFIED from request-filter-engine.ts (lines 70-112):**

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
      // Fallback with ReDoS check
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

---

## Binding Types

Filters can be bound at three levels:

| Binding Type | Description | Use Case |
|--------------|-------------|----------|
| `global` | Applies to ALL requests | Universal sanitization, common headers |
| `providers` | Applies to specific providers | Provider-specific API key headers |
| `groups` | Applies to providers with matching group tags | Multi-provider configurations |

**VERIFIED Provider Matching from request-filter-engine.ts (lines 304-318):**

```typescript
for (const filter of this.providerFilters) {
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

---

## Priority and Ordering

Filters are executed in priority order (ascending), with ID as tiebreaker:

**VERIFIED from request-filter-engine.ts (lines 223-229):**

```typescript
this.globalFilters = cachedFilters
  .filter((f) => f.bindingType === "global" || !f.bindingType)
  .sort((a, b) => a.priority - b.priority || a.id - b.id);

this.providerFilters = cachedFilters
  .filter((f) => f.bindingType === "providers" || f.bindingType === "groups")
  .sort((a, b) => a.priority - b.priority || a.id - b.id);
```

Lower priority numbers execute first.

---

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

---

## Edge Cases and Behaviors

### 1. Fail-Open Design

**VERIFIED from `/Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/request-filter.ts` (lines 14-21):**

```typescript
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

**VERIFIED from `/Users/ding/Github/claude-code-hub/src/actions/request-filters.ts` (lines 42-46):**

```typescript
if (data.action === "text_replace" && data.matchType === "regex" && data.target) {
  if (!safeRegex(data.target)) {
    return "正则表达式存在 ReDoS 风险";
  }
}
```

### 3. JSON Path Creation

When using `json_path` action, missing intermediate objects/arrays are automatically created.

**VERIFIED from request-filter-engine.ts (lines 55-58):**

```typescript
if (current[key] === undefined) {
  const nextKey = keys[i + 1];
  current[key] = typeof nextKey === "number" ? [] : {};
}
```

### 4. Deep Replacement Recursion

`text_replace` recursively traverses the entire message object.

**VERIFIED from request-filter-engine.ts (lines 396-423):**

```typescript
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

### 5. Empty Filter Optimization

**VERIFIED from request-filter-engine.ts (lines 260-262):**

```typescript
async applyGlobal(session: ProxySession): Promise<void> {
  // Optimization #4: Early exit if already initialized and empty
  if (this.isInitialized && this.globalFilters.length === 0) return;
```

### 6. Cache Warming and Hot Reload

**VERIFIED from request-filter-engine.ts (lines 135-165):**

```typescript
private async setupEventListener(): Promise<void> {
  if (typeof process !== "undefined" && process.env.NEXT_RUNTIME !== "edge") {
    try {
      const { eventEmitter } = await import("@/lib/event-emitter");
      const handler = () => {
        void this.reload();
      };
      eventEmitter.on("requestFiltersUpdated", handler);

      // Store cleanup function
      this.eventEmitterCleanup = () => {
        eventEmitter.off("requestFiltersUpdated", handler);
      };

      // Cross-instance notification via Redis Pub/Sub
      try {
        const { CHANNEL_REQUEST_FILTERS_UPDATED, subscribeCacheInvalidation } = await import(
          "@/lib/redis/pubsub"
        );
        this.redisPubSubCleanup = await subscribeCacheInvalidation(
          CHANNEL_REQUEST_FILTERS_UPDATED,
          handler
        );
      } catch {
        // Ignore import errors
      }
    } catch {
      // Ignore import errors
    }
  }
}
```

### 7. Provider Filter Without Provider

**VERIFIED from `/Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/provider-request-filter.ts` (lines 11-17):**

```typescript
static async ensure(session: ProxySession): Promise<void> {
  if (!session.provider) {
    logger.warn(
      "[ProxyProviderRequestFilter] No provider selected, skipping provider-specific filters"
    );
    return;
  }
```

### 8. Binding Type Validation

**VERIFIED from actions/request-filters.ts (lines 48-73):**

```typescript
const bindingType = data.bindingType ?? "global";
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
if (bindingType === "global") {
  if (
    (data.providerIds && data.providerIds.length > 0) ||
    (data.groupTags && data.groupTags.length > 0)
  ) {
    return "Global 类型不能指定 Providers 或 Groups";
  }
}
```

---

## Performance Optimizations

### 1. Regex Pre-compilation

**VERIFIED from request-filter-engine.ts (lines 191-209):**

```typescript
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

### 2. Set-based Lookups

**VERIFIED from request-filter-engine.ts (lines 211-217):**

```typescript
if (f.bindingType === "providers" && f.providerIds) {
  cached.providerIdsSet = new Set(f.providerIds);
}
if (f.bindingType === "groups" && f.groupTags) {
  cached.groupTagsSet = new Set(f.groupTags);
}
```

### 3. Lazy Initialization

**VERIFIED from request-filter-engine.ts (lines 247-255):**

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

### 4. Conditional Tag Parsing

**VERIFIED from request-filter-engine.ts (lines 297-302):**

```typescript
let providerTagsSet: Set<string> | null = null;
if (this.hasGroupBasedFilters) {
  const providerGroupTag = session.provider.groupTag;
  providerTagsSet = new Set(providerGroupTag?.split(",").map((t) => t.trim()) ?? []);
}
```

---

## Memory Management

**VERIFIED from request-filter-engine.ts (lines 168-177):**

```typescript
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

---

## Statistics and Monitoring

**VERIFIED from request-filter-engine.ts (lines 471-478):**

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

---

## TypeScript Types

**VERIFIED from `/Users/ding/Github/claude-code-hub/src/repository/request-filters.ts` (lines 8-29):**

```typescript
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

---

## Key Files

| File | Purpose |
|------|---------|
| `/src/lib/request-filter-engine.ts` | Core filter engine with caching and execution logic |
| `/src/app/v1/_lib/proxy/request-filter.ts` | Global filter guard step adapter |
| `/src/app/v1/_lib/proxy/provider-request-filter.ts` | Provider-specific filter guard step adapter |
| `/src/app/v1/_lib/proxy/guard-pipeline.ts` | Pipeline configuration and execution |
| `/src/repository/request-filters.ts` | Database access layer |
| `/src/actions/request-filters.ts` | Server actions for CRUD operations |
| `/src/drizzle/schema.ts` | Database schema definition |
| `/src/app/[locale]/settings/request-filters/page.tsx` | Admin UI page |
| `/src/app/[locale]/settings/request-filters/_components/filter-dialog.tsx` | Filter creation/editing dialog |
| `/src/app/[locale]/settings/request-filters/_components/filter-table.tsx` | Filter list table |
| `/src/app/[locale]/settings/request-filters/_components/provider-multi-select.tsx` | Provider selection component |
| `/src/app/[locale]/settings/request-filters/_components/group-multi-select.tsx` | Group tag selection component |
| `/src/app/[locale]/settings/request-filters/_components/request-filters-skeleton.tsx` | Loading skeleton |

---

## Security Considerations

### ReDoS Protection

All regex patterns are validated using the `safe-regex` library to prevent Regular Expression Denial of Service attacks.

### Access Control

Filter management is restricted to admin users only:

**VERIFIED from actions/request-filters.ts (lines 24-26):**

```typescript
function isAdmin(session: Awaited<ReturnType<typeof getSession>>): boolean {
  return !!session && session.user.role === "admin";
}
```

---

## Related Features

- Sensitive Words (`/docs/filters/sensitive-words`) - Content filtering that executes BEFORE request filters
- Error Rules (`/docs/filters/error-rules`) - Response error pattern matching
- Provider Management (`/docs/providers/crud`) - Provider configuration for filter binding

---

*Document verified against codebase: 2026-01-29*
*All code snippets and file paths verified*
