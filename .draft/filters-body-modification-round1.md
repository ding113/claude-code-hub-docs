# Body Modification (Body 修改) - Round 1 Exploration Draft

## 1. Intent Analysis

### 1.1 What is Body Modification?

Body Modification is a core feature of the Claude Code Hub request filter system that allows administrators to programmatically modify the request body before it is forwarded to upstream AI providers. This feature enables:

- **Data Sanitization**: Remove or redact sensitive information from requests
- **Request Normalization**: Standardize request formats across different providers
- **Content Filtering**: Replace or modify specific content patterns
- **Dynamic Injection**: Add or modify fields in the request payload
- **Compliance Enforcement**: Ensure requests meet organizational policies

### 1.2 Purpose and Use Cases

The body modification feature serves several critical purposes in the proxy pipeline:

1. **Privacy Protection**: Automatically redact PII (Personally Identifiable Information) such as emails, phone numbers, or API keys embedded in user messages
2. **Cost Optimization**: Modify request parameters to reduce token usage (e.g., truncate long contexts)
3. **Provider Compatibility**: Transform request fields to match specific provider requirements
4. **Security Enforcement**: Remove potentially harmful instructions or content
5. **Audit Compliance**: Ensure all outgoing requests meet organizational standards

### 1.3 Architecture Position

Body modification operates as part of the **Request Filter Engine** (`/Users/ding/Github/claude-code-hub/src/lib/request-filter-engine.ts`), which executes in two phases:

1. **Global Phase** (`applyGlobal`): Applied before provider selection
2. **Provider-Specific Phase** (`applyForProvider`): Applied after provider selection

The filter engine is invoked by:
- `ProxyRequestFilter.ensure()` - Global filters at `/Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/request-filter.ts`
- `ProxyProviderRequestFilter.ensure()` - Provider-specific filters at `/Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/provider-request-filter.ts`

---

## 2. Behavior Summary

### 2.1 Scope and Actions

Body modification supports two distinct actions defined in `/Users/ding/Github/claude-code-hub/src/repository/request-filters.ts`:

```typescript
export type RequestFilterScope = "header" | "body";
export type RequestFilterAction = "remove" | "set" | "json_path" | "text_replace";
```

For **body scope**, the available actions are:

| Action | Description | Use Case |
|--------|-------------|----------|
| `json_path` | Set a specific JSON path to a value | Modify specific fields like `model`, `temperature`, `max_tokens` |
| `text_replace` | Replace text patterns throughout the body | Redact sensitive keywords, replace domain names |

### 2.2 Body Filter Execution Flow

The body filter execution follows this flow (from `/Users/ding/Github/claude-code-hub/src/lib/request-filter-engine.ts`, lines 367-394):

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

### 2.3 JSON Path Action

The `json_path` action uses dot-notation paths with array bracket support. The path parser is implemented at lines 17-29:

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

The `setValueByPath` function (lines 31-68) creates intermediate objects/arrays as needed:
- If a path segment doesn't exist, it creates an object or array based on the next segment's type
- Arrays are created when the next key is numeric
- Objects are created for string keys

### 2.4 Text Replace Action

The `text_replace` action performs deep recursive replacement across all string values in the request body. It supports three match types (defined at line 10 in `/Users/ding/Github/claude-code-hub/src/repository/request-filters.ts`):

```typescript
export type RequestFilterMatchType = "regex" | "contains" | "exact" | null;
```

The replacement logic at lines 70-112:

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
        const re = new RegExp(compiledRegex.source, compiledRegex.flags);
        return input.replace(re, replacement);
      }
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

The `deepReplace` method (lines 396-423) recursively traverses:
- **Strings**: Apply replacement
- **Arrays**: Map over each element
- **Objects**: Recurse into each property
- **Primitives**: Return unchanged

### 2.5 Match Types for Text Replace

| Match Type | Behavior | Example Target | Example Input | Result |
|------------|----------|----------------|---------------|--------|
| `contains` | Replace all occurrences | `secret` | `my secret data secret` | `my [REDACTED] data [REDACTED]` |
| `exact` | Replace only if entire string matches | `secret` | `secret` | `[REDACTED]` |
| `regex` | Replace using regex pattern | `\d{3}-\d{4}` | `phone: 123-4567` | `phone: [PHONE]` |

---

## 3. Configuration and Commands

### 3.1 Database Schema

Body modification filters are stored in the `request_filters` table defined in `/Users/ding/Github/claude-code-hub/src/drizzle/schema.ts` (lines 507-536):

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

### 3.2 TypeScript Types

From `/Users/ding/Github/claude-code-hub/src/repository/request-filters.ts` (lines 8-29):

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

### 3.3 Filter Configuration Examples

#### Example 1: JSON Path - Modify Model Name

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

#### Example 2: Text Replace - Redact Email Addresses

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

#### Example 3: Text Replace - Remove API Keys

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

#### Example 4: JSON Path - Set Max Tokens

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

#### Example 5: Text Replace - Contains Match

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

### 3.4 UI Configuration

The filter dialog UI at `/Users/ding/Github/claude-code-hub/src/app/[locale]/settings/request-filters/_components/filter-dialog.tsx` shows:

- **Scope Selection**: Header or Body (line 336-347)
- **Action Selection**: Dynamic based on scope (lines 175-185)
  - Body scope: `json_path`, `text_replace`
- **Match Type**: Only shown for `body` + `text_replace` combination (line 187)
- **Target**: JSON path placeholder for `json_path` action (lines 406-409)
- **Replacement**: Optional field for setting new values

Action options for body scope (lines 181-184):
```typescript
: [
    { value: "json_path", label: t("actionLabel.json_path") },
    { value: "text_replace", label: t("actionLabel.text_replace") },
  ];
```

### 3.5 i18n Translations

From `/Users/ding/Github/claude-code-hub/messages/zh-CN/settings/requestFilters.json`:

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

## 4. Request vs Response Body Handling

### 4.1 Important Limitation: Request Body Only

**Body modification in Claude Code Hub ONLY modifies REQUEST bodies, not RESPONSE bodies.**

This is a critical architectural decision:

1. **Request Filters** (`/Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/request-filter.ts`): Applied to incoming client requests
2. **Provider Filters** (`/Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/provider-request-filter.ts`): Applied after provider selection but still before forwarding

Both operate on `session.request.message`, which is the parsed request body.

### 4.2 Request Body Processing Flow

The request body is parsed in `/Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/session.ts` (lines 836-890):

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

  // Truncation detection...
  
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

### 4.3 Body Size Limits

From `/Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/session.ts` (lines 821-827):

```typescript
/**
 * Large request body threshold (10MB)
 * When request body exceeds this size and model field is missing,
 * return a friendly error suggesting possible truncation by proxy limit.
 * Related config: next.config.ts proxyClientMaxBodySize (100MB)
 */
const LARGE_REQUEST_BODY_BYTES = 10 * 1024 * 1024;
```

The actual body size limit is configured in `next.config.ts` as `proxyClientMaxBodySize` (100MB default).

### 4.4 Response Body Not Modified

Response bodies are handled differently in `/Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/response-handler.ts`. The system:
- Streams responses directly to clients
- Applies response fixers for format corrections
- Does NOT apply user-configured body modification filters

If response modification is needed, the system uses:
- **Error Rules** (`error_rules` table): Override error responses
- **Response Fixer**: Automatic format corrections for truncated JSON, SSE format issues

---

## 5. Edge Cases and Behaviors

### 5.1 Regex Safety (ReDoS Protection)

The system uses the `safe-regex` library to prevent Regular Expression Denial of Service attacks. From `/Users/ding/Github/claude-code-hub/src/lib/request-filter-engine.ts` (lines 192-208):

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

Validation also occurs in actions at `/Users/ding/Github/claude-code-hub/src/actions/request-filters.ts` (lines 42-46):

```typescript
if (data.action === "text_replace" && data.matchType === "regex" && data.target) {
  if (!safeRegex(data.target)) {
    return "正则表达式存在 ReDoS 风险";
  }
}
```

### 5.2 Filter Priority and Ordering

Filters are sorted by priority (ascending) and then by ID (lines 223-229):

```typescript
this.globalFilters = cachedFilters
  .filter((f) => f.bindingType === "global" || !f.bindingType)
  .sort((a, b) => a.priority - b.priority || a.id - b.id);

this.providerFilters = cachedFilters
  .filter((f) => f.bindingType === "providers" || f.bindingType === "groups")
  .sort((a, b) => a.priority - b.priority || a.id - b.id);
```

**Important**: Filters with the same target are applied sequentially; later filters overwrite earlier ones.

### 5.3 Empty or Invalid Replacement

For `json_path` action, null/undefined replacement is converted to `null`:
```typescript
setValueByPath(message, filter.target, filter.replacement ?? null);
```

For `text_replace`, non-string replacements are JSON-stringified:
```typescript
const replacementStr =
  typeof filter.replacement === "string"
    ? filter.replacement
    : JSON.stringify(filter.replacement ?? "");
```

### 5.4 Path Creation Behavior

The `setValueByPath` function creates intermediate structures:
- If path segment doesn't exist, creates object or array
- Arrays created when next key is numeric (e.g., `messages[0]`)
- Objects created for string keys
- Existing non-object values are overwritten to allow traversal

### 5.5 Non-JSON Request Bodies

If the request body is not valid JSON (lines 876-880 in session.ts):
```typescript
try {
  const parsedMessage = JSON.parse(requestBodyText) as Record<string, unknown>;
  requestMessage = parsedMessage;
} catch {
  requestMessage = { raw: requestBodyText };
  requestBodyLog = requestBodyText;
  requestBodyLogNote = "请求体不是合法 JSON，已记录原始文本。";
}
```

Body filters may not work as expected on non-JSON bodies since the `raw` wrapper changes the structure.

### 5.6 Fail-Open Behavior

Both filter wrappers implement fail-open behavior:

From `/Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/request-filter.ts`:
```typescript
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

### 5.7 Binding Type Constraints

Validation enforces mutual exclusivity (from `/Users/ding/Github/claude-code-hub/src/actions/request-filters.ts`, lines 48-75):

```typescript
// Validate binding type constraints
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
```

### 5.8 Group Tag Matching

Group tags support comma-separated values. From the test file (`/Users/ding/Github/claude-code-hub/tests/unit/request-filter-binding.test.ts`, lines 381-393):

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

### 5.9 Cache and Hot Reload

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

### 5.10 Performance Optimizations

The engine implements several optimizations (documented in code comments):

1. **Pre-compiled Regex** (Optimization #2): Regex patterns are compiled once at load time
2. **Set Caches** (Optimization #3): Provider IDs and group tags stored as Sets for O(1) lookup
3. **Early Exit** (Optimization #4): Skip processing if no filters exist
4. **Lazy Tag Parsing** (Optimization #5): Only parse provider group tags when group filters exist

---

## 6. Code References

### Core Implementation Files

| File | Purpose | Key Lines |
|------|---------|-----------|
| `/Users/ding/Github/claude-code-hub/src/lib/request-filter-engine.ts` | Filter engine implementation | 1-482 |
| `/Users/ding/Github/claude-code-hub/src/repository/request-filters.ts` | Repository and type definitions | 1-173 |
| `/Users/ding/Github/claude-code-hub/src/drizzle/schema.ts` | Database schema | 507-536 |
| `/Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/request-filter.ts` | Global filter wrapper | 1-23 |
| `/Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/provider-request-filter.ts` | Provider filter wrapper | 1-30 |
| `/Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/session.ts` | Session and body parsing | 836-890 |

### UI Files

| File | Purpose |
|------|---------|
| `/Users/ding/Github/claude-code-hub/src/app/[locale]/settings/request-filters/_components/filter-dialog.tsx` | Filter creation/editing dialog |
| `/Users/ding/Github/claude-code-hub/src/app/[locale]/settings/request-filters/_components/filter-table.tsx` | Filter listing table |
| `/Users/ding/Github/claude-code-hub/src/actions/request-filters.ts` | Server actions for filter CRUD |

### Test Files

| File | Purpose |
|------|---------|
| `/Users/ding/Github/claude-code-hub/tests/unit/request-filter-binding.test.ts` | Comprehensive binding tests |

### i18n Files

| File | Purpose |
|------|---------|
| `/Users/ding/Github/claude-code-hub/messages/zh-CN/settings/requestFilters.json` | Chinese translations |
| `/Users/ding/Github/claude-code-hub/messages/en/settings/requestFilters.json` | English translations |

---

## 7. Integration with Proxy Pipeline

### 7.1 Filter Execution Order

The body modification filters execute at specific points in the request lifecycle:

1. **Client Request Received** → Parse body (`session.ts`)
2. **Authentication** → Validate API key/user
3. **Global Filters** → `ProxyRequestFilter.ensure()` executes
4. **Provider Selection** → Choose upstream provider
5. **Provider Filters** → `ProxyProviderRequestFilter.ensure()` executes
6. **Forward Request** → Send modified body to provider

This ordering ensures:
- Filters can modify requests before provider-specific logic
- Provider binding works correctly (provider is known for provider filters)
- Modified body is what gets forwarded upstream

### 7.2 Filter Application Points

From `/Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/request-filter.ts`:
```typescript
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

From `/Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/provider-request-filter.ts`:
```typescript
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
      // Fail-open: фильтр не блокирует основной поток
      logger.error("[ProxyProviderRequestFilter] Failed to apply provider-specific filters", {
        error,
        providerId: session.provider.id,
      });
    }
  }
}
```

### 7.3 Body Modification in Request Forwarding

After filters are applied, the modified request body is forwarded to the provider. From `/Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/forwarder.ts`, the `session.request.message` (which has been modified by filters) is serialized and sent:

```typescript
const bodyString = JSON.stringify(session.request.message);
requestBody = bodyString;
```

This means:
- All `json_path` modifications are included
- All `text_replace` redactions are applied
- The provider receives the sanitized/modified request

### 7.4 Interaction with Other Features

Body modification interacts with several other CCH features:

| Feature | Interaction |
|---------|-------------|
| **Sensitive Words** | Filters execute before sensitive word detection, allowing pre-sanitization |
| **Model Redirect** | Body modification can change the `model` field, which then affects model redirect logic |
| **Session Management** | Modified request is stored in session for replay/debugging |
| **Logging** | Both original and modified bodies can be logged (depending on configuration) |
| **Provider Selection** | Global filters execute before provider selection; provider filters after |

## 8. Real-World Use Cases

### 8.1 Enterprise Data Loss Prevention (DLP)

**Scenario**: Prevent employees from sending customer PII to AI providers.

**Solution**: Create multiple text_replace filters:

```json
[
  {
    "name": "Redact SSN",
    "scope": "body",
    "action": "text_replace",
    "target": "\\b\\d{3}-\\d{2}-\\d{4}\\b",
    "matchType": "regex",
    "replacement": "[SSN_REDACTED]",
    "bindingType": "global"
  },
  {
    "name": "Redact Credit Card",
    "scope": "body",
    "action": "text_replace",
    "target": "\\b\\d{4}[\\s-]?\\d{4}[\\s-]?\\d{4}[\\s-]?\\d{4}\\b",
    "matchType": "regex",
    "replacement": "[CC_REDACTED]",
    "bindingType": "global"
  }
]
```

### 8.2 Cost Control by Token Limiting

**Scenario**: Enforce max_tokens limit on expensive providers.

**Solution**: Provider-specific json_path filter:

```json
{
  "name": "Cap tokens for expensive providers",
  "scope": "body",
  "action": "json_path",
  "target": "max_tokens",
  "replacement": 2048,
  "bindingType": "providers",
  "providerIds": [5, 6, 7]
}
```

### 8.3 Multi-Provider Model Normalization

**Scenario**: Different providers use different model name formats.

**Solution**: Group-based filters:

```json
[
  {
    "name": "Normalize to OpenAI format",
    "scope": "body",
    "action": "json_path",
    "target": "model",
    "replacement": "gpt-4",
    "bindingType": "groups",
    "groupTags": ["openai-compatible"]
  },
  {
    "name": "Normalize to Anthropic format",
    "scope": "body",
    "action": "json_path",
    "target": "model",
    "replacement": "claude-3-5-sonnet-20241022",
    "bindingType": "groups",
    "groupTags": ["anthropic-official"]
  }
]
```

### 8.4 Development Environment Sanitization

**Scenario**: Ensure no production data reaches development providers.

**Solution**: Replace internal domains and identifiers:

```json
{
  "name": "Sanitize for dev environment",
  "scope": "body",
  "action": "text_replace",
  "target": "prod.company.com",
  "matchType": "contains",
  "replacement": "dev.example.com",
  "bindingType": "groups",
  "groupTags": ["development"]
}
```

## 9. Testing and Validation

### 9.1 Unit Tests

The comprehensive test suite in `/Users/ding/Github/claude-code-hub/tests/unit/request-filter-binding.test.ts` covers:

- Global filter application
- Provider-specific binding
- Group tag matching
- Priority ordering
- Edge cases (null values, empty arrays)

Example test for body filter with text_replace (lines 198-218):
```typescript
test("should apply global body filter (text_replace with contains)", async () => {
  const filter = createGlobalFilter(
    "body",
    "text_replace",
    "secret",
    "[HIDDEN]",
    0,
    "contains"
  );
  requestFilterEngine.setFiltersForTest([filter]);

  const session = createSession();

  await requestFilterEngine.applyGlobal(
    session as Parameters<typeof requestFilterEngine.applyGlobal>[0]
  );

  expect((session.request.message as Record<string, string>).text).toBe(
    "hello world [HIDDEN] data"
  );
});
```

### 9.2 Manual Testing

To test filters manually:

1. Create filter via Settings UI
2. Send test request through proxy
3. Check logs for filter application
4. Verify upstream receives modified body

### 9.3 Debugging

Enable debug logging to see filter execution:
- Filter loading: `[RequestFilterEngine] Filters loaded`
- Filter application errors: `[RequestFilterEngine] Failed to apply global filter`
- Regex warnings: `[RequestFilterEngine] Skip unsafe regex`

## 10. Best Practices

### 10.1 Filter Design

1. **Use Specific Targets**: Narrow regex patterns to avoid false positives
2. **Test Regex**: Validate regex patterns before deployment
3. **Priority Planning**: Design priority order when multiple filters target similar content
4. **Document Intent**: Use descriptive names and descriptions

### 10.2 Performance

1. **Limit Regex Complexity**: Avoid catastrophic backtracking
2. **Use Contains When Possible**: Simple string matching is faster than regex
3. **Group by Binding Type**: Organize filters by provider/group to minimize unnecessary checks
4. **Monitor Filter Count**: Large numbers of filters impact performance

### 10.3 Security

1. **Review Regex Patterns**: Ensure no ReDoS vulnerabilities
2. **Validate Replacements**: Ensure replacement values don't introduce new issues
3. **Audit Filter Changes**: Log who creates/modifies filters
4. **Test Before Deploy**: Validate filters in staging environment

## 11. Limitations and Future Considerations

### 11.1 Current Limitations

1. **Request-Only**: Cannot modify response bodies
2. **JSON-Only**: Designed for JSON APIs; limited support for other formats
3. **No Conditional Logic**: Cannot apply filters based on request content (other than binding)
4. **No Chaining**: Cannot use output of one filter as input to another
5. **No Validation**: Cannot validate request content before forwarding

### 11.2 Potential Enhancements

Future versions could consider:

1. **Response Body Modification**: Apply filters to provider responses
2. **Conditional Filters**: Apply based on request content, headers, or user
3. **Filter Chaining**: Pipeline multiple transformations
4. **Custom Scripts**: JavaScript/TypeScript for complex transformations
5. **Request Validation**: Reject requests based on content patterns

## 12. Summary

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
