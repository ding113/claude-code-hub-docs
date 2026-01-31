# Body Modification (Body 修改) - Round 2 Verified Draft

## Review Summary

This document has been verified against the actual codebase at `/Users/ding/Github/claude-code-hub/`. All code snippets, file paths, and line numbers have been confirmed accurate.

**Verification Status**: PASSED
**Files Verified**:
- `/src/lib/request-filter-engine.ts` (482 lines)
- `/src/repository/request-filters.ts` (173 lines)
- `/src/drizzle/schema.ts` (lines 508-536)
- `/src/app/v1/_lib/proxy/request-filter.ts` (23 lines)
- `/src/app/v1/_lib/proxy/provider-request-filter.ts` (30 lines)
- `/src/app/v1/_lib/proxy/session.ts` (lines 821-890)
- `/src/app/[locale]/settings/request-filters/_components/filter-dialog.tsx` (508 lines)
- `/src/actions/request-filters.ts` (313 lines)
- `/messages/zh-CN/settings/requestFilters.json` (85 lines)

---

## 1. Overview

Body Modification is a core feature of the Claude Code Hub request filter system that allows administrators to programmatically modify the request body before it is forwarded to upstream AI providers.

### 1.1 Key Capabilities

- **Data Sanitization**: Remove or redact sensitive information from requests
- **Request Normalization**: Standardize request formats across different providers
- **Content Filtering**: Replace or modify specific content patterns
- **Dynamic Injection**: Add or modify fields in the request payload
- **Compliance Enforcement**: Ensure requests meet organizational policies

### 1.2 Architecture Position

Body modification operates as part of the **Request Filter Engine** (`src/lib/request-filter-engine.ts`), which executes in two phases:

1. **Global Phase** (`applyGlobal`): Applied before provider selection
2. **Provider-Specific Phase** (`applyForProvider`): Applied after provider selection

The filter engine is invoked by:
- `ProxyRequestFilter.ensure()` - Global filters at `src/app/v1/_lib/proxy/request-filter.ts`
- `ProxyProviderRequestFilter.ensure()` - Provider-specific filters at `src/app/v1/_lib/proxy/provider-request-filter.ts`

---

## 2. Type Definitions

### 2.1 Core Types

From `src/repository/request-filters.ts` (lines 8-11):

```typescript
export type RequestFilterScope = "header" | "body";
export type RequestFilterAction = "remove" | "set" | "json_path" | "text_replace";
export type RequestFilterMatchType = "regex" | "contains" | "exact" | null;
export type RequestFilterBindingType = "global" | "providers" | "groups";
```

### 2.2 RequestFilter Interface

From `src/repository/request-filters.ts` (lines 13-29):

```typescript
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

## 3. Body Filter Actions

For **body scope**, two actions are available:

| Action | Description | Use Case |
|--------|-------------|----------|
| `json_path` | Set a specific JSON path to a value | Modify specific fields like `model`, `temperature`, `max_tokens` |
| `text_replace` | Replace text patterns throughout the body | Redact sensitive keywords, replace domain names |

### 3.1 JSON Path Action

The `json_path` action uses dot-notation paths with array bracket support.

**Path Parser** (from `src/lib/request-filter-engine.ts`, lines 17-29):

```typescript
function parsePath(path: string): Array<string | number> {
  const parts: Array<string | number> = [];
  const regex = /([^.[\]]+)|(\[(\d+)\])/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(path)) !== null) {
    if (match[1]) {
      parts.push(match[1]);
    } else if (match[3]) {
      parts.push(Number(match[3]));
    }
  }
  return parts;
}
```

**setValueByPath Function** (lines 31-68):
- Creates intermediate objects/arrays as needed
- Arrays are created when the next key is numeric (e.g., `messages[0]`)
- Objects are created for string keys
- Existing non-object values are overwritten to allow traversal

**Example Paths**:
- `model` - Sets the model field
- `messages.0.content` - Sets the first message's content
- `data.items[0].token` - Sets a nested array element

### 3.2 Text Replace Action

The `text_replace` action performs deep recursive replacement across all string values in the request body.

**Match Types**:

| Match Type | Behavior | Example |
|------------|----------|---------|
| `contains` | Replace all occurrences of substring | `"secret"` in `"my secret data"` -> `"my [REDACTED] data"` |
| `exact` | Replace only if entire string matches | `"secret"` matches `"secret"` but not `"my secret"` |
| `regex` | Replace using regex pattern | `"\d{3}-\d{4}"` matches `"123-4567"` |

**replaceText Function** (from `src/lib/request-filter-engine.ts`, lines 70-112):

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
      if (compiledRegex) {
        try {
          const re = new RegExp(compiledRegex.source, compiledRegex.flags);
          return input.replace(re, replacement);
        } catch (error) {
          logger.error("[RequestFilterEngine] Regex replace failed", { error });
          return input;
        }
      }
      // Fallback with safety check
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
      // "contains" or any unrecognized matchType
      if (!target) return input;
      return input.split(target).join(replacement);
    }
  }
}
```

**deepReplace Method** (lines 396-423):
- Recursively traverses the entire request body
- Strings: Apply replacement
- Arrays: Map over each element
- Objects: Recurse into each property
- Primitives: Return unchanged

---

## 4. Filter Execution

### 4.1 applyBodyFilter Method

From `src/lib/request-filter-engine.ts` (lines 367-394):

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

### 4.2 Filter Priority and Ordering

Filters are sorted by priority (ascending) and then by ID (lines 223-229):

```typescript
this.globalFilters = cachedFilters
  .filter((f) => f.bindingType === "global" || !f.bindingType)
  .sort((a, b) => a.priority - b.priority || a.id - b.id);

this.providerFilters = cachedFilters
  .filter((f) => f.bindingType === "providers" || f.bindingType === "groups")
  .sort((a, b) => a.priority - b.priority || a.id - b.id);
```

**Important**: Lower priority numbers execute first. Filters with the same target are applied sequentially; later filters overwrite earlier ones.

---

## 5. Database Schema

From `src/drizzle/schema.ts` (lines 508-536):

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

## 6. Configuration Examples

### 6.1 JSON Path - Modify Model Name

```json
{
  "name": "Force Claude 3.5 Sonnet",
  "description": "Override model to claude-3-5-sonnet-20241022",
  "scope": "body",
  "action": "json_path",
  "target": "model",
  "replacement": "claude-3-5-sonnet-20241022",
  "priority": 10,
  "isEnabled": true,
  "bindingType": "global"
}
```

### 6.2 Text Replace - Redact Email Addresses

```json
{
  "name": "Redact Emails",
  "description": "Replace email patterns with [EMAIL]",
  "scope": "body",
  "action": "text_replace",
  "target": "[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}",
  "matchType": "regex",
  "replacement": "[EMAIL]",
  "priority": 5,
  "isEnabled": true,
  "bindingType": "global"
}
```

### 6.3 Text Replace - Contains Match

```json
{
  "name": "Replace Internal Domain",
  "description": "Replace internal.company.com with example.com",
  "scope": "body",
  "action": "text_replace",
  "target": "internal.company.com",
  "matchType": "contains",
  "replacement": "example.com",
  "priority": 0,
  "isEnabled": true,
  "bindingType": "global"
}
```

### 6.4 JSON Path - Set Max Tokens (Group Binding)

```json
{
  "name": "Limit Max Tokens",
  "description": "Cap max_tokens at 4096",
  "scope": "body",
  "action": "json_path",
  "target": "max_tokens",
  "replacement": 4096,
  "priority": 20,
  "isEnabled": true,
  "bindingType": "groups",
  "groupTags": ["cost-controlled"]
}
```

### 6.5 Text Replace - Provider-Specific API Key Redaction

```json
{
  "name": "Remove API Keys",
  "description": "Redact sk- prefixed API keys",
  "scope": "body",
  "action": "text_replace",
  "target": "sk-[a-zA-Z0-9]{48}",
  "matchType": "regex",
  "replacement": "[API_KEY_REDACTED]",
  "priority": 1,
  "isEnabled": true,
  "bindingType": "providers",
  "providerIds": [1, 2, 3]
}
```

---

## 7. UI Configuration

The filter dialog UI at `src/app/[locale]/settings/request-filters/_components/filter-dialog.tsx` provides:

### 7.1 Scope Selection (lines 336-347)

```typescript
<Select value={scope} onValueChange={(val) => setScope(val as RequestFilter["scope"])}>
  <SelectContent>
    <SelectItem value="header">{t("scopeLabel.header")}</SelectItem>
    <SelectItem value="body">{t("scopeLabel.body")}</SelectItem>
  </SelectContent>
</Select>
```

### 7.2 Action Options (lines 175-185)

```typescript
const actionOptions = useMemo(() => {
  return scope === "header"
    ? [
        { value: "remove", label: t("actionLabel.remove") },
        { value: "set", label: t("actionLabel.set") },
      ]
    : [
        { value: "json_path", label: t("actionLabel.json_path") },
        { value: "text_replace", label: t("actionLabel.text_replace") },
      ];
}, [scope, t]);
```

### 7.3 Match Type (line 187)

Match type selector is only shown for `body` scope with `text_replace` action:

```typescript
const showMatchType = scope === "body" && action === "text_replace";
```

### 7.4 Target Placeholder (lines 406-409)

```typescript
placeholder={
  action === "json_path"
    ? t("dialog.jsonPathPlaceholder")
    : t("dialog.targetPlaceholder")
}
```

---

## 8. i18n Translations

From `messages/zh-CN/settings/requestFilters.json`:

```json
{
  "scopeLabel": {
    "header": "Header",
    "body": "Body"
  },
  "actionLabel": {
    "remove": "删除 Header",
    "set": "设置 Header",
    "json_path": "JSON 路径替换",
    "text_replace": "文本替换"
  },
  "dialog": {
    "matchType": "匹配类型",
    "matchTypeContains": "包含",
    "matchTypeExact": "精确匹配",
    "matchTypeRegex": "正则",
    "jsonPathPlaceholder": "例如: messages.0.content 或 data.items[0].token",
    "targetPlaceholder": "Header 名称或文本/路径",
    "replacementPlaceholder": "字符串或 JSON，留空表示删除"
  }
}
```

---

## 9. Request Body Processing

### 9.1 Body Parsing

From `src/app/v1/_lib/proxy/session.ts` (lines 836-890):

```typescript
async function parseRequestBody(c: Context): Promise<RequestBodyResult> {
  const method = c.req.method.toUpperCase();
  const hasBody = method !== "GET" && method !== "HEAD";

  if (!hasBody) {
    return { requestMessage: {}, requestBodyLog: "(empty)" };
  }

  const contentLength = parseContentLengthHeader(c.req.header("content-length"));
  const requestBodyBuffer = await c.req.raw.clone().arrayBuffer();
  const actualBodyBytes = requestBodyBuffer.byteLength;
  const requestBodyText = new TextDecoder().decode(requestBodyBuffer);

  // ... truncation detection ...

  let requestMessage: Record<string, unknown> = {};
  let requestBodyLog: string;
  let requestBodyLogNote: string | undefined;

  try {
    const parsedMessage = JSON.parse(requestBodyText) as Record<string, unknown>;
    requestMessage = parsedMessage;
    requestBodyLog = JSON.stringify(optimizeRequestMessage(parsedMessage), null, 2);
  } catch {
    requestMessage = { raw: requestBodyText };
    requestBodyLog = requestBodyText;
    requestBodyLogNote = "请求体不是合法 JSON，已记录原始文本。";
  }

  return {
    requestMessage,
    requestBodyLog,
    requestBodyLogNote,
    requestBodyBuffer,
    contentLength,
    actualBodyBytes,
  };
}
```

### 9.2 Body Size Limits

From `src/app/v1/_lib/proxy/session.ts` (lines 821-827):

```typescript
/**
 * Large request body threshold (10MB)
 * When request body exceeds this size and model field is missing,
 * return a friendly error suggesting possible truncation by proxy limit.
 * Related config: next.config.ts proxyClientMaxBodySize (100MB)
 */
const LARGE_REQUEST_BODY_BYTES = 10 * 1024 * 1024;
```

### 9.3 Non-JSON Request Bodies

If the request body is not valid JSON, it is wrapped in a `{ raw: ... }` object. Body filters may not work as expected on non-JSON bodies since the structure changes.

---

## 10. Safety and Security

### 10.1 ReDoS Protection

The system uses the `safe-regex` library to prevent Regular Expression Denial of Service attacks.

**At Load Time** (lines 192-208):

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

**At Validation** (from `src/actions/request-filters.ts`, lines 42-46):

```typescript
if (data.action === "text_replace" && data.matchType === "regex" && data.target) {
  if (!safeRegex(data.target)) {
    return "正则表达式存在 ReDoS 风险";
  }
}
```

### 10.2 Fail-Open Behavior

Both filter wrappers implement fail-open behavior to ensure filter errors don't block request processing.

From `src/app/v1/_lib/proxy/request-filter.ts` (lines 14-21):

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

### 10.3 Binding Type Validation

From `src/actions/request-filters.ts` (lines 48-73):

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

## 11. Performance Optimizations

The engine implements several optimizations (documented in code comments):

1. **Pre-compiled Regex** (Optimization #2): Regex patterns are compiled once at load time
2. **Set Caches** (Optimization #3): Provider IDs and group tags stored as Sets for O(1) lookup
3. **Early Exit** (Optimization #4): Skip processing if no filters exist
4. **Lazy Tag Parsing** (Optimization #5): Only parse provider group tags when group filters exist
5. **Memory Leak Cleanup** (Optimization #1): Proper cleanup of event listeners

### 11.1 CachedRequestFilter Interface

From `src/lib/request-filter-engine.ts` (lines 10-15):

```typescript
interface CachedRequestFilter extends RequestFilter {
  compiledRegex?: RegExp; // Pre-compiled regex for text_replace
  providerIdsSet?: Set<number>; // O(1) provider lookup
  groupTagsSet?: Set<string>; // O(1) group lookup
}
```

### 11.2 Hot Reload Support

The filter engine supports hot reload via event emitter and Redis pub/sub (lines 135-165):

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

      // Cross-process notification
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

---

## 12. Proxy Filter Wrappers

### 12.1 Global Filter Wrapper

From `src/app/v1/_lib/proxy/request-filter.ts` (23 lines):

```typescript
/**
 * 请求过滤器：支持 Header 删除/覆盖，Body 替换（JSON Path / 文本关键字/正则）
 *
 * 设计：
 * - 管理端配置的过滤规则存储在 request_filters 表
 * - 通过 RequestFilterEngine 缓存并监听 eventEmitter 自动热更新
 * - 在 GuardPipeline 中于敏感词检测前执行，便于先脱敏再检测
 */
export class ProxyRequestFilter {
  static async ensure(session: ProxySession): Promise<void> {
    try {
      await requestFilterEngine.applyGlobal(session);
    } catch (error) {
      // Fail-open: 过滤失败不阻塞主流程
      logger.error("[ProxyRequestFilter] Failed to apply global request filters", { error });
    }
  }
}
```

### 12.2 Provider-Specific Filter Wrapper

From `src/app/v1/_lib/proxy/provider-request-filter.ts` (30 lines):

```typescript
/**
 * Provider-specific Request Filter
 * Applies filters bound to specific provider or group
 * Executes AFTER provider selection
 */
export class ProxyProviderRequestFilter {
  static async ensure(session: ProxySession): Promise<void> {
    if (!session.provider) {
      logger.warn(
        "[ProxyProviderRequestFilter] No provider selected, skipping provider-specific filters"
      );
      return;
    }

    try {
      await requestFilterEngine.applyForProvider(session);
    } catch (error) {
      // Fail-open: filter does not block main flow
      logger.error("[ProxyProviderRequestFilter] Failed to apply provider-specific filters", {
        error,
        providerId: session.provider.id,
      });
    }
  }
}
```

---

## 13. Group Tag Matching

Group tags support comma-separated values. From the test file (`tests/unit/request-filter-binding.test.ts`, lines 381-393):

```typescript
test("should apply filter when provider has comma-separated tags and one matches", async () => {
  const filter = createGroupFilter(["vip"], "header", "set", "x-vip", "true");
  requestFilterEngine.setFiltersForTest([filter]);

  // Provider has multiple tags: "basic, vip, beta"
  const session = createSessionWithProvider(1, "basic, vip, beta");

  await requestFilterEngine.applyForProvider(
    session as Parameters<typeof requestFilterEngine.applyForProvider>[0]
  );

  expect(session.headers.get("x-vip")).toBe("true");
});
```

---

## 14. Important Limitations

### 14.1 Request-Only Modification

**Body modification in Claude Code Hub ONLY modifies REQUEST bodies, not RESPONSE bodies.**

Both filter wrappers operate on `session.request.message`, which is the parsed request body. Response bodies are handled differently and do not support user-configured body modification filters.

### 14.2 JSON-Centric Design

The system is designed for JSON request bodies (OpenAI/Claude API format). Non-JSON bodies are wrapped in `{ raw: ... }` and may not work as expected with body filters.

### 14.3 No Conditional Logic

Filters cannot be applied based on request content (other than binding type). All matching filters are applied in priority order.

### 14.4 No Chaining

Cannot use output of one filter as input to another. Each filter operates independently on the current state of the request body.

---

## 15. Code References

### Core Implementation Files

| File | Purpose | Lines |
|------|---------|-------|
| `src/lib/request-filter-engine.ts` | Filter engine implementation | 482 |
| `src/repository/request-filters.ts` | Repository and type definitions | 173 |
| `src/drizzle/schema.ts` | Database schema | 508-536 |
| `src/app/v1/_lib/proxy/request-filter.ts` | Global filter wrapper | 23 |
| `src/app/v1/_lib/proxy/provider-request-filter.ts` | Provider filter wrapper | 30 |
| `src/app/v1/_lib/proxy/session.ts` | Session and body parsing | 821-890 |

### UI Files

| File | Purpose |
|------|---------|
| `src/app/[locale]/settings/request-filters/_components/filter-dialog.tsx` | Filter creation/editing dialog |
| `src/app/[locale]/settings/request-filters/_components/filter-table.tsx` | Filter listing table |
| `src/actions/request-filters.ts` | Server actions for filter CRUD |

### Test Files

| File | Purpose |
|------|---------|
| `tests/unit/request-filter-binding.test.ts` | Comprehensive binding tests |
| `tests/unit/request-filter-engine.test.ts` | Engine unit tests |

### i18n Files

| File | Purpose |
|------|---------|
| `messages/zh-CN/settings/requestFilters.json` | Chinese translations |
| `messages/en/settings/requestFilters.json` | English translations |

---

## 16. Summary

Body modification in Claude Code Hub is a powerful feature for request transformation with the following characteristics:

1. **Two Actions**: `json_path` for targeted field modification, `text_replace` for pattern-based replacement
2. **Three Match Types**: `contains`, `exact`, `regex` (for text_replace only)
3. **Three Binding Types**: `global` (all requests), `providers` (specific providers), `groups` (provider groups)
4. **Request-Only**: Only modifies request bodies, not responses
5. **JSON-Centric**: Designed for JSON request bodies (OpenAI/Claude API format)
6. **Safe by Default**: ReDoS protection for regex patterns
7. **Fail-Open**: Filter errors don't block request processing
8. **Hot Reload**: Configuration changes apply without restart
9. **Performance Optimized**: Pre-compiled regex, Set-based lookups, early exits
10. **Well-Tested**: Comprehensive test coverage for all binding types and edge cases

The feature integrates seamlessly into the proxy pipeline, executing after authentication but before forwarding to upstream providers, making it ideal for data sanitization, normalization, and policy enforcement in enterprise environments.
