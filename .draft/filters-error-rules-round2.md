# Error Rules Detection - Round 2 Verified Draft

## Intent Analysis

The Error Rules Detection system in claude-code-hub serves a critical purpose: intelligently classifying and handling errors from upstream AI providers to optimize retry behavior, improve user experience, and maintain system stability. Unlike generic error handling that treats all errors equally, this system recognizes that different error types require different responses:

- **Client input errors** (prompt too long, content filtered, invalid parameters) should NOT be retried - retrying will always fail
- **Provider errors** (5xx server errors, rate limits) should trigger circuit breaker tracking and provider failover
- **Network errors** (DNS failures, connection timeouts) should be retried once before failover
- **Client aborts** (connection closed by client) should be logged but not retried or counted against providers

The system achieves this through a configurable rule-based engine that matches error messages against predefined patterns, classifies them into categories, and optionally transforms error responses to provide clearer feedback to end users.

## Core Architecture

### 1. ErrorRuleDetector - The Detection Engine

Located at `src/lib/error-rule-detector.ts`, the `ErrorRuleDetector` class is the heart of the error detection system. It implements a singleton pattern for global reuse and provides high-performance pattern matching through intelligent caching.

**Key Design Principles:**

1. **Performance-First Detection Order**: The detector prioritizes speed by checking patterns in order of computational cost:
   - Contains matching (fastest, simple substring search)
   - Exact matching (O(1) HashMap lookup)
   - Regex matching (slowest but most flexible)

2. **Three-Tier Caching Strategy**: Rules are cached in three separate data structures optimized for their match type:

```typescript
// Lines 78-80 from error-rule-detector.ts
private regexPatterns: RegexPattern[] = [];
private containsPatterns: ContainsPattern[] = [];
private exactPatterns: Map<string, ExactPattern> = new Map();
```

3. **Lazy Initialization with Race Condition Protection**: The detector uses a Promise-based initialization guard to prevent concurrent reloads:

```typescript
// Lines 134-147 from error-rule-detector.ts
async ensureInitialized(): Promise<void> {
  // Only skip initialization if successfully loaded from database
  if (this.dbLoadedSuccessfully && this.isInitialized) {
    return;
  }

  if (!this.initializationPromise) {
    this.initializationPromise = this.reload().finally(() => {
      this.initializationPromise = null;
    });
  }

  await this.initializationPromise;
}
```

4. **ReDoS Protection**: All regex patterns are validated using the `safe-regex` library to prevent Regular Expression Denial of Service attacks:

```typescript
// Lines 245-251 from error-rule-detector.ts
if (!safeRegex(rule.pattern)) {
  logger.warn(
    `[ErrorRuleDetector] ReDoS risk detected in pattern: ${rule.pattern}, skipping`
  );
  skippedRedosCount++;
  break;
}
```

### 2. Error Classification System

Located at `src/app/v1/_lib/proxy/errors.ts`, the `ErrorCategory` enum defines five distinct error classifications:

```typescript
// Lines 457-463 from errors.ts
export enum ErrorCategory {
  PROVIDER_ERROR,              // Provider issues (all 4xx/5xx HTTP errors) -> circuit breaker + direct switch
  SYSTEM_ERROR,                // System/network issues (fetch network exceptions) -> no circuit breaker + retry once first
  CLIENT_ABORT,                // Client actively interrupted -> no circuit breaker + no retry + return directly
  NON_RETRYABLE_CLIENT_ERROR,  // Client input errors -> no circuit breaker + no retry + return directly
  RESOURCE_NOT_FOUND,          // Upstream 404 error -> no circuit breaker + direct switch provider
}
```

The classification logic follows strict priority order (in `categorizeErrorAsync` function, lines 780-814):

1. **CLIENT_ABORT** (highest priority): Detected via `isClientAbortError()` which checks for AbortError, ResponseAborted, or status code 499
2. **NON_RETRYABLE_CLIENT_ERROR**: Detected via error rules matching - these are client input errors that will fail on retry
3. **RESOURCE_NOT_FOUND**: 404 errors get special handling - failover without penalizing the provider
4. **PROVIDER_ERROR**: All other HTTP errors (4xx/5xx) from ProxyError
5. **SYSTEM_ERROR** (lowest priority): Catch-all for network-level failures

### 3. Error Rule Data Model

The database schema at `src/drizzle/schema.ts` (lines 479-505) defines the `error_rules` table:

```typescript
export const errorRules = pgTable('error_rules', {
  id: serial('id').primaryKey(),
  pattern: text('pattern').notNull(),
  matchType: varchar('match_type', { length: 20 })
    .notNull()
    .default('regex')
    .$type<'regex' | 'contains' | 'exact'>(),
  category: varchar('category', { length: 50 }).notNull(),
  description: text('description'),
  overrideResponse: jsonb('override_response'),
  overrideStatusCode: integer('override_status_code'),
  isEnabled: boolean('is_enabled').notNull().default(true),
  isDefault: boolean('is_default').notNull().default(false),
  priority: integer('priority').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  errorRulesEnabledIdx: index('idx_error_rules_enabled').on(table.isEnabled, table.priority),
  errorRulesPatternUniqueIdx: uniqueIndex('unique_pattern').on(table.pattern),
  errorRulesCategoryIdx: index('idx_category').on(table.category),
  errorRulesMatchTypeIdx: index('idx_match_type').on(table.matchType),
}));
```

**Key Fields:**
- `pattern`: The matching pattern (string for contains/exact, regex for regex type)
- `matchType`: One of `regex`, `contains`, or `exact`
- `category`: Classification category (prompt_limit, content_filter, etc.)
- `overrideResponse`: JSON object to replace the original error response
- `overrideStatusCode`: HTTP status code to override (null = pass through)
- `isDefault`: Marks system-defined rules that sync from code

## Default Error Rules

The system ships with approximately 30 pre-defined error rules covering common AI provider error scenarios. These are defined in `src/repository/error-rules.ts` in the `DEFAULT_ERROR_RULES` array (lines 292-841).

### Rule Categories

1. **prompt_limit**: Input token count exceeds model limits
   - Pattern: `prompt is too long.*(tokens.*maximum|maximum.*tokens)`
   - Override: Friendly Chinese message explaining token limits

2. **input_limit**: Input content length exceeds provider limit
   - Pattern: `Input is too long`
   - Override: Explanation that input content exceeds limit

3. **content_filter**: Content blocked by safety filters
   - Pattern: `blocked by.*content filter`
   - Override: Explanation that content was filtered

4. **pdf_limit**: PDF page count exceeds limits
   - Pattern: `PDF has too many pages|maximum of.*PDF pages`
   - Override: PDF page limit guidance

5. **media_limit**: Combined media (images + PDF pages) limits
   - Pattern: `Too much media`
   - Override: Media count limit explanation

6. **thinking_error**: Extended thinking mode errors
   - Multiple patterns for thinking block format issues
   - Override: Guidance on proper thinking block usage

7. **parameter_error**: Missing or extra parameters
   - Pattern: `Missing required parameter|Extra inputs.*not permitted`
   - Override: Parameter validation error message

8. **invalid_request**: Malformed requests
   - Pattern: `illegal request|invalid request`
   - Override: Request format guidance

9. **cache_limit**: Cache control block limits
   - Pattern: `(cache_control.*(limit|maximum).*blocks|(maximum|limit).*blocks.*cache_control)`
   - Override: Cache block limit explanation

10. **validation_error**: Tool use validation errors
    - Multiple patterns for tool_use ID uniqueness, tool_result validation
    - Override: Tool validation requirement messages

11. **model_error**: Unknown or invalid models
    - Pattern: `unknown model|model.*not.*found|model.*does.*not.*exist`
    - Override: Model validation message

12. **context_limit**: Context window or token limit exceeded
    - Pattern: `context.*(length|window|limit).*exceed|exceed.*(context|token|length).*(limit|window)`
    - Override: Context limit explanation

### Rule Priority System

Each rule has a `priority` field (default 0, higher = more important). The detector loads rules ordered by priority, ensuring higher-priority rules are checked first within each match type category.

## Error Response Override System

### Supported Response Formats

The system supports three major AI API error formats, defined in `src/repository/error-rules.ts` (lines 14-58):

**Claude Format:**
```typescript
export interface ClaudeErrorResponse {
  type: "error";
  error: {
    type: string;
    message: string;
    [key: string]: unknown;
  };
  request_id?: string;
}
```

**Gemini Format:**
```typescript
export interface GeminiErrorResponse {
  error: {
    code: number;
    message: string;
    status: string;
    details?: unknown[];
  };
}
```

**OpenAI Format:**
```typescript
export interface OpenAIErrorResponse {
  error: {
    message: string;
    type: string;
    param?: string | null;
    code?: string | null;
  };
}
```

### Override Validation

The `src/lib/error-override-validator.ts` module provides comprehensive validation:

1. **Format Detection**: Automatically detects which format a response follows via `detectErrorResponseFormat()`
2. **Schema Validation**: Validates required fields for each format
3. **Size Limit**: Enforces 10KB maximum response size (`MAX_OVERRIDE_RESPONSE_BYTES = 10 * 1024`)
4. **Runtime Guards**: Double-validation at both load time and runtime

```typescript
// Lines 203-269 from error-override-validator.ts
export function validateErrorOverrideResponse(response: unknown): string | null {
  // Check if pure object (exclude null and arrays)
  if (!response || typeof response !== "object" || Array.isArray(response)) {
    return "override response must be an object";
  }

  const obj = response as Record<string, unknown>;
  const format = detectErrorResponseFormat(response);

  if (format === "claude") {
    return validateClaudeFormat(obj);
  } else if (format === "gemini") {
    return validateGeminiFormat(obj);
  } else if (format === "openai") {
    return validateOpenAIFormat(obj);
  }
  // ...
}
```

## Cache Synchronization Strategy

### User-First Sync Policy

The `syncDefaultErrorRules()` function at `src/repository/error-rules.ts` (lines 858-938) implements a sophisticated synchronization strategy:

```
Pattern doesn't exist -> Insert new rule
Pattern exists + isDefault=true -> Update to latest
Pattern exists + isDefault=false -> Skip (preserve user customization)
Pattern in DB but not in code -> Delete (cleanup old defaults)
```

This ensures:
- New system rules are automatically added
- System rules are updated when code changes
- User customizations are never overwritten
- Deleted system rules are cleaned up

### Event-Driven Cache Refresh

The system uses a dual-channel event system for cache invalidation:

1. **In-Process Events**: Via `eventEmitter` for single-worker updates
2. **Cross-Process Events**: Via Redis pub/sub for multi-instance synchronization

```typescript
// Lines 95-121 from error-rule-detector.ts
private async setupEventListener(): Promise<void> {
  if (typeof process !== "undefined" && process.env.NEXT_RUNTIME !== "edge") {
    const { eventEmitter } = await import("@/lib/event-emitter");
    const handleUpdated = () => {
      this.dbLoadedSuccessfully = false;
      this.isInitialized = false;
      this.reload().catch((error) => {
        logger.error("[ErrorRuleDetector] Failed to reload cache on event:", error);
      });
    };

    eventEmitter.on("errorRulesUpdated", handleUpdated);

    const { CHANNEL_ERROR_RULES_UPDATED, subscribeCacheInvalidation } = await import(
      "@/lib/redis/pubsub"
    );
    await subscribeCacheInvalidation(CHANNEL_ERROR_RULES_UPDATED, handleUpdated);
  }
}
```

## Error Detection Caching

To optimize performance, error detection results are cached per Error object using a `WeakMap`:

```typescript
// Lines 485-507 from errors.ts
const errorDetectionCache = new WeakMap<Error, ErrorDetectionResult>();

async function detectErrorRuleOnceAsync(error: Error): Promise<ErrorDetectionResult> {
  const cached = errorDetectionCache.get(error);
  if (cached) {
    return cached;
  }

  const content = extractErrorContentForDetection(error);
  const result = await errorRuleDetector.detectAsync(content);
  errorDetectionCache.set(error, result);
  return result;
}
```

**Benefits:**
- Same Error object only detected once
- WeakMap prevents memory leaks (entries garbage collected when Error is no longer referenced)
- Both sync and async detection paths share the cache

## Integration with Proxy Flow

### Error Handler Integration

The `ProxyErrorHandler` at `src/app/v1/_lib/proxy/error-handler.ts` integrates error rules into the response flow:

```typescript
// Lines 100-231 from error-handler.ts
if (error instanceof Error) {
  const override = await getErrorOverrideAsync(error);
  if (override) {
    // Validate status code range (400-599)
    let validatedStatusCode = override.statusCode;
    if (validatedStatusCode !== null && 
        (!Number.isInteger(validatedStatusCode) ||
         validatedStatusCode < 400 ||
         validatedStatusCode > 599)) {
      validatedStatusCode = null;
    }

    const responseStatusCode = validatedStatusCode ?? statusCode;

    // Case 1: Response body override
    if (override.response) {
      // Validate, build response
      return new Response(JSON.stringify(responseBody), {
        status: responseStatusCode,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Case 2: Status code only override
    return ProxyResponses.buildError(responseStatusCode, clientErrorMessage);
  }
}
```

### Forwarder Integration

The forwarder uses error classification to decide retry behavior:

```typescript
// Conceptual flow (from errors.ts categorization)
const category = await categorizeErrorAsync(error);

switch (category) {
  case ErrorCategory.CLIENT_ABORT:
    // Don't retry, don't count against provider
    return;
  case ErrorCategory.NON_RETRYABLE_CLIENT_ERROR:
    // Don't retry, return to client immediately
    throw error;
  case ErrorCategory.PROVIDER_ERROR:
    // Count against circuit breaker, failover
    circuitBreaker.recordFailure();
    tryNextProvider();
  case ErrorCategory.SYSTEM_ERROR:
    // Retry once, then failover
    await retryOnce();
}
```

## Admin UI Components

### Settings Page

Located at `src/app/[locale]/settings/error-rules/page.tsx`, the admin interface provides:

1. **Rule List Table**: Displays all rules with status, pattern, category, and actions (`rule-list-table.tsx`)
2. **Add Rule Dialog**: Form for creating new rules with pattern testing (`add-rule-dialog.tsx`)
3. **Edit Rule Dialog**: Modify existing rules (`edit-rule-dialog.tsx`)
4. **Rule Tester**: Interactive testing of error messages against rules (`error-rule-tester.tsx`, `regex-tester.tsx`)
5. **Refresh Cache Button**: Manual sync of default rules and cache refresh (`refresh-cache-button.tsx`)
6. **Override Section**: Configure response body and status code overrides (`override-section.tsx`)

### UI Component Files

| File | Purpose |
|------|---------|
| `page.tsx` | Main settings page |
| `rule-list-table.tsx` | Table displaying all error rules |
| `add-rule-dialog.tsx` | Dialog for creating new rules |
| `edit-rule-dialog.tsx` | Dialog for editing existing rules |
| `error-rule-tester.tsx` | Test error messages against rules |
| `regex-tester.tsx` | Test regex patterns |
| `refresh-cache-button.tsx` | Trigger cache refresh |
| `override-section.tsx` | Configure override response/status |
| `error-rules-skeleton.tsx` | Loading skeleton |

## Configuration Examples

### Basic Error Rule

```json
{
  "pattern": "rate limit exceeded",
  "matchType": "contains",
  "category": "rate_limit",
  "description": "Generic rate limit error"
}
```

### Regex Pattern with Override

```json
{
  "pattern": "prompt is too long.*(\\d+).*tokens.*(\\d+).*maximum",
  "matchType": "regex",
  "category": "prompt_limit",
  "description": "Token limit exceeded with counts",
  "overrideResponse": {
    "type": "error",
    "error": {
      "type": "prompt_limit",
      "message": "Your prompt exceeds the token limit"
    }
  },
  "overrideStatusCode": 400
}
```

### Exact Match Rule

```json
{
  "pattern": "Invalid API key",
  "matchType": "exact",
  "category": "auth_error",
  "description": "Invalid API key error"
}
```

## Edge Cases and Special Behaviors

### 1. Empty Error Messages

The detector handles empty strings gracefully:

```typescript
// Lines 330-332 from error-rule-detector.ts
if (!errorMessage || errorMessage.length === 0) {
  return { matched: false };
}
```

### 2. Case Insensitivity

All matching is case-insensitive:
- Contains: Convert both pattern and message to lowercase
- Exact: Convert both to lowercase before comparison
- Regex: Use `i` flag for case-insensitive matching

### 3. Concurrent Reload Protection

The detector prevents concurrent reloads using an `isLoading` flag:

```typescript
// Lines 157-161 from error-rule-detector.ts
async reload(): Promise<void> {
  if (this.isLoading) {
    logger.warn("[ErrorRuleDetector] Reload already in progress, skipping");
    return;
  }
  this.isLoading = true;
  // ... reload logic
}
```

### 4. Database Failure Handling

If database loading fails, the detector preserves existing cache:

```typescript
// Lines 169-187 from error-rule-detector.ts
try {
  rules = await getActiveErrorRules();
  this.dbLoadedSuccessfully = true;
} catch (dbError) {
  const errorMessage = (dbError as Error).message || "";
  if (errorMessage.includes("relation") && errorMessage.includes("does not exist")) {
    logger.warn("[ErrorRuleDetector] error_rules table does not exist yet");
  } else {
    logger.error("[ErrorRuleDetector] Database error:", dbError);
  }
  // Keep existing cache, retry next time
  this.lastReloadTime = Date.now();
  return;
}
```

### 5. Invalid Override Response Handling

Malformed override responses are filtered at load time:

```typescript
// Lines 202-211 from error-rule-detector.ts
if (rule.overrideResponse) {
  if (isValidErrorOverrideResponse(rule.overrideResponse)) {
    validatedOverrideResponse = rule.overrideResponse;
  } else {
    logger.warn(
      `[ErrorRuleDetector] Invalid override_response for rule ${rule.id}`
    );
    skippedInvalidResponseCount++;
  }
}
```

### 6. Status Code Validation

Override status codes are validated to be within HTTP error range (400-599):

```typescript
// Lines 21-24 from error-handler.ts
const OVERRIDE_STATUS_CODE_MIN = 400;
const OVERRIDE_STATUS_CODE_MAX = 599;
```

### 7. Request ID Extraction and Injection

The system extracts request_id from upstream responses and can inject it into override responses:

```typescript
// Lines 74-84 from errors.ts (ProxyError)
const requestId =
  ProxyError.extractRequestIdFromBody(parsed) ||
  ProxyError.extractRequestIdFromHeaders(response.headers);

return new ProxyError(message, response.status, {
  body: truncatedBody,
  parsed,
  providerId: provider.id,
  providerName: provider.name,
  requestId,
});
```

### 8. HTTP/2 and SSL Error Detection

Special detection for protocol-level errors:

```typescript
// Lines 829-838 from errors.ts
const HTTP2_ERROR_PATTERNS = [
  "GOAWAY", "RST_STREAM", "PROTOCOL_ERROR", "HTTP/2",
  "ERR_HTTP2_", "NGHTTP2_", "HTTP_1_1_REQUIRED", "REFUSED_STREAM"
];

// Lines 885-900 from errors.ts
const SSL_ERROR_PATTERNS = [
  "certificate", "ssl", "tls", "cert_",
  "unable to verify", "self signed", "hostname mismatch",
  "unable_to_get_issuer_cert", "cert_has_expired",
  "depth_zero_self_signed_cert", "unable_to_verify_leaf_signature",
  "err_tls_cert_altname_invalid", "cert_untrusted", "altnames"
];
```

## References

### Key Files

| File | Purpose |
|------|---------|
| `src/lib/error-rule-detector.ts` | Core detection engine |
| `src/app/v1/_lib/proxy/errors.ts` | Error classification and ProxyError class |
| `src/app/v1/_lib/proxy/error-handler.ts` | Error response handling |
| `src/repository/error-rules.ts` | Data access layer and default rules |
| `src/actions/error-rules.ts` | Server actions for CRUD operations |
| `src/lib/error-override-validator.ts` | Response format validation |
| `src/drizzle/schema.ts` | Database schema (lines 479-505) |
| `src/lib/emit-event.ts` | Event emission for cache invalidation |

### Default Rule Categories

| Category | Description | Example Pattern |
|----------|-------------|-----------------|
| prompt_limit | Token count exceeded | `prompt is too long.*tokens.*maximum` |
| input_limit | Input content length exceeded | `Input is too long` |
| content_filter | Safety filter blocked | `blocked by.*content filter` |
| pdf_limit | PDF page limit | `PDF has too many pages` |
| media_limit | Combined media limit | `Too much media` |
| thinking_error | Extended thinking errors | `expected.*thinking.*found.*tool_use` |
| parameter_error | Missing/extra parameters | `Missing required parameter` |
| invalid_request | Malformed request | `illegal request|invalid request` |
| cache_limit | Cache block limit | `cache_control.*limit.*blocks` |
| validation_error | Tool use validation | `tool_use ids must be unique` |
| model_error | Unknown/invalid model | `unknown model|model not found` |
| context_limit | Context window exceeded | `context.*length.*exceed` |
| token_limit | Max tokens exceeded | `max_tokens.*exceed` |

### API Response Formats Supported

1. **Claude**: `{ type: "error", error: { type, message }, request_id? }`
2. **Gemini**: `{ error: { code, message, status, details? } }`
3. **OpenAI**: `{ error: { message, type, param?, code? } }`

---

*This document represents a verified exploration of the Error Rules Detection system in claude-code-hub. All code references have been verified against the actual implementation.*
