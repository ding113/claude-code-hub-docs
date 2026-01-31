# Response Override (响应覆写) - Round 1 Exploration Draft

## Intent Analysis

### Purpose and Overview

Response Override (响应覆写) is a critical feature in claude-code-hub that allows administrators to intercept and modify API error responses before they reach the client. This feature serves multiple important purposes:

1. **User Experience Enhancement**: Transform cryptic upstream error messages into user-friendly, localized messages
2. **Security Hardening**: Hide sensitive internal details (provider names, internal paths) from end users
3. **Error Standardization**: Normalize different provider error formats into consistent responses
4. **Client Error Handling**: Prevent unnecessary retries on non-retryable client errors

### Core Design Philosophy

The response override system follows these key design principles:

- **Pattern-Based Matching**: Uses regex, contains, or exact matching to identify error patterns
- **Multi-Format Support**: Supports Claude, Gemini, and OpenAI error response formats
- **Flexible Override Modes**: Can override response body, status code, or both
- **Performance Optimized**: Caches rules in memory with hot-reload capability
- **Fail-Safe**: Validation at multiple layers prevents malformed overrides from breaking the system

---

## Behavior Summary

### How Response Override Works

The response override system operates at the error handling layer of the proxy pipeline:

```
Upstream Error → Error Detection → Rule Matching → Override Application → Client Response
```

#### 1. Error Detection Phase

When an upstream error occurs, the system extracts error content for pattern matching:

**File**: `/Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/errors.ts` (Lines 471-477)

```typescript
function extractErrorContentForDetection(error: Error): string {
  // 优先使用整个响应体进行规则匹配
  if (error instanceof ProxyError && error.upstreamError?.body) {
    return error.upstreamError.body;
  }
  return error.message;
}
```

The system prioritizes matching against the entire upstream response body, allowing rules to match any content within the response.

#### 2. Rule Matching Phase

The `ErrorRuleDetector` class performs pattern matching using three strategies (performance-ordered):

**File**: `/Users/ding/Github/claude-code-hub/src/lib/error-rule-detector.ts` (Lines 329-400)

```typescript
detect(errorMessage: string): ErrorDetectionResult {
  if (!errorMessage || errorMessage.length === 0) {
    return { matched: false };
  }

  const lowerMessage = errorMessage.toLowerCase();
  const trimmedMessage = lowerMessage.trim();

  // 1. 包含匹配（最快）
  for (const pattern of this.containsPatterns) {
    if (lowerMessage.includes(pattern.text)) {
      return {
        matched: true,
        ruleId: pattern.ruleId,
        category: pattern.category,
        pattern: pattern.pattern,
        matchType: "contains",
        description: pattern.description,
        overrideResponse: pattern.overrideResponse,
        overrideStatusCode: pattern.overrideStatusCode,
      };
    }
  }

  // 2. 精确匹配（O(1) 查询）
  const exactMatch = this.exactPatterns.get(trimmedMessage);
  if (exactMatch) {
    return {
      matched: true,
      ruleId: exactMatch.ruleId,
      category: exactMatch.category,
      pattern: exactMatch.pattern,
      matchType: "exact",
      description: exactMatch.description,
      overrideResponse: exactMatch.overrideResponse,
      overrideStatusCode: exactMatch.overrideStatusCode,
    };
  }

  // 3. 正则匹配（最慢，但最灵活）
  for (const {
    ruleId, rawPattern, pattern, category, description,
    overrideResponse, overrideStatusCode,
  } of this.regexPatterns) {
    if (pattern.test(errorMessage)) {
      return {
        matched: true, ruleId, category,
        pattern: rawPattern, matchType: "regex", description,
        overrideResponse, overrideStatusCode,
      };
    }
  }

  return { matched: false };
}
```

**Matching Priority**: Contains → Exact → Regex (fastest to slowest)

#### 3. Override Application Phase

The `ProxyErrorHandler` applies overrides in three possible modes:

**File**: `/Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/error-handler.ts` (Lines 98-230)

```typescript
// 检测是否有覆写配置（响应体或状态码）
const override = await getErrorOverrideAsync(error);
if (override) {
  // 运行时校验覆写状态码范围（400-599）
  let validatedStatusCode = override.statusCode;
  if (
    validatedStatusCode !== null &&
    (!Number.isInteger(validatedStatusCode) ||
      validatedStatusCode < OVERRIDE_STATUS_CODE_MIN ||
      validatedStatusCode > OVERRIDE_STATUS_CODE_MAX)
  ) {
    logger.warn("ProxyErrorHandler: Invalid override status code, falling back to upstream");
    validatedStatusCode = null;
  }

  const responseStatusCode = validatedStatusCode ?? statusCode;

  // 情况 1: 有响应体覆写 - 返回覆写的 JSON 响应
  if (override.response) {
    // 运行时守卫：验证覆写响应格式是否合法
    if (!isValidErrorOverrideResponse(override.response)) {
      logger.warn("ProxyErrorHandler: Invalid override response in database, skipping");
      // 跳过响应体覆写，但仍可应用状态码覆写
      if (override.statusCode !== null) {
        return await attachSessionIdToErrorResponse(
          session.sessionId,
          ProxyResponses.buildError(responseStatusCode, clientErrorMessage, ...)
        );
      }
      // 两者都无效，返回原始错误
      return await attachSessionIdToErrorResponse(...);
    }

    // 覆写消息为空时回退到客户端安全消息
    const overrideErrorObj = override.response.error as Record<string, unknown>;
    const overrideMessage =
      typeof overrideErrorObj?.message === "string" &&
      overrideErrorObj.message.trim().length > 0
        ? overrideErrorObj.message
        : clientErrorMessage;

    // 构建覆写响应体
    const responseBody = {
      ...override.response,
      error: {
        ...overrideErrorObj,
        message: overrideMessage,
      },
    };

    return await attachSessionIdToErrorResponse(
      session.sessionId,
      new Response(JSON.stringify(responseBody), {
        status: responseStatusCode,
        headers: { "Content-Type": "application/json" },
      })
    );
  }

  // 情况 2: 仅状态码覆写 - 返回客户端安全消息，但使用覆写的状态码
  return await attachSessionIdToErrorResponse(
    session.sessionId,
    ProxyResponses.buildError(
      responseStatusCode, clientErrorMessage, undefined, undefined, safeRequestId
    )
  );
}
```

### Override Types

The system supports three override modes:

#### 1. Response Body Override (响应体覆写)

Replaces the entire error response body with a custom JSON response while optionally modifying the status code.

**Use Cases**:
- Transform technical error messages into user-friendly messages
- Standardize different provider error formats
- Add custom error codes or metadata

#### 2. Status Code Override (状态码覆写)

Changes only the HTTP status code while preserving the original error message (or using the client-safe message).

**Use Cases**:
- Normalize status codes across different providers
- Change 500 errors to more appropriate 4xx errors for client errors
- Signal retry behavior through status codes

#### 3. Combined Override (组合覆写)

Simultaneously overrides both the response body and status code.

**Use Cases**:
- Complete transformation of error responses
- Converting provider-specific errors to standard formats

---

## Configuration and Commands

### Database Schema

**File**: `/Users/ding/Github/claude-code-hub/src/drizzle/schema.ts` (Lines 478-505)

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
  // 覆写响应体（JSONB）：匹配成功时用此响应替换原始错误响应
  // 格式参考 Claude API: { type: "error", error: { type: "...", message: "..." }, request_id?: "..." }
  // null = 不覆写，保留原始错误响应
  overrideResponse: jsonb('override_response'),
  // 覆写状态码：null = 透传上游状态码
  overrideStatusCode: integer('override_status_code'),
  isEnabled: boolean('is_enabled').notNull().default(true),
  isDefault: boolean('is_default').notNull().default(false),
  priority: integer('priority').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  // 状态与类型查询优化
  errorRulesEnabledIdx: index('idx_error_rules_enabled').on(table.isEnabled, table.priority),
  errorRulesPatternUniqueIdx: uniqueIndex('unique_pattern').on(table.pattern),
  errorRulesCategoryIdx: index('idx_category').on(table.category),
  errorRulesMatchTypeIdx: index('idx_match_type').on(table.matchType),
}));
```

### TypeScript Interfaces

**File**: `/Users/ding/Github/claude-code-hub/src/repository/error-rules.ts` (Lines 10-75)

```typescript
/**
 * Claude API 错误格式
 */
export interface ClaudeErrorResponse {
  type: "error";
  error: {
    type: string;
    message: string;
    [key: string]: unknown;
  };
  request_id?: string;
  [key: string]: unknown;
}

/**
 * Gemini API 错误格式
 */
export interface GeminiErrorResponse {
  error: {
    code: number;
    message: string;
    status: string;
    details?: unknown[];
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

/**
 * OpenAI API 错误格式
 */
export interface OpenAIErrorResponse {
  error: {
    message: string;
    type: string;
    param?: string | null;
    code?: string | null;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export type ErrorOverrideResponse = ClaudeErrorResponse | GeminiErrorResponse | OpenAIErrorResponse;

export interface ErrorRule {
  id: number;
  pattern: string;
  matchType: "regex" | "contains" | "exact";
  category: string;
  description: string | null;
  overrideResponse: ErrorOverrideResponse | null;
  overrideStatusCode: number | null;
  isEnabled: boolean;
  isDefault: boolean;
  priority: number;
  createdAt: Date;
  updatedAt: Date;
}
```

### Error Categories

The following error categories are supported for classification:

| Category | Description |
|----------|-------------|
| `prompt_limit` | Input prompt exceeds token limits |
| `content_filter` | Content blocked by safety filters |
| `pdf_limit` | PDF page count exceeds limits |
| `thinking_error` | Thinking block format errors |
| `parameter_error` | Missing or invalid parameters |
| `invalid_request` | Malformed request structure |
| `cache_limit` | Cache control block limits exceeded |
| `input_limit` | Input content length exceeded |
| `validation_error` | Request validation failures |
| `context_limit` | Context window exceeded |
| `token_limit` | Max tokens parameter too high |
| `model_error` | Unknown or invalid model |

### Match Types

**File**: `/Users/ding/Github/claude-code-hub/src/actions/error-rules.ts` (Lines 119-148)

```typescript
// 默认 matchType 为 regex
const matchType = data.matchType || "regex";

// ReDoS (Regular Expression Denial of Service) 风险检测
if (matchType === "regex") {
  if (!safeRegex(data.pattern)) {
    return {
      ok: false,
      error: "正则表达式存在 ReDoS 风险，请简化模式",
    };
  }

  // 验证正则表达式语法
  try {
    new RegExp(data.pattern);
  } catch {
    return {
      ok: false,
      error: "无效的正则表达式",
    };
  }
}
```

| Match Type | Description | Performance |
|------------|-------------|-------------|
| `contains` | Case-insensitive substring match | Fastest (O(n*m)) |
| `exact` | Case-insensitive exact match | Fast (O(1) lookup) |
| `regex` | Regular expression match | Slowest (most flexible) |

### Priority System

Error rules are evaluated by priority (higher numbers first) within each match type category. The `priority` field (default: 0) determines the evaluation order when multiple rules could match:

**File**: `/Users/ding/Github/claude-code-hub/src/repository/error-rules.ts` (Lines 106-110)

```typescript
export async function getActiveErrorRules(): Promise<ErrorRule[]> {
  const results = await db.query.errorRules.findMany({
    where: eq(errorRules.isEnabled, true),
    orderBy: [errorRules.priority, errorRules.category],
  });
  // ...
}
```

Rules with higher priority values are checked first. If two rules have the same priority, they are ordered by category. The first matching rule wins - once a rule matches, no further rules are evaluated for that error.

### Default Override Templates

**File**: `/Users/ding/Github/claude-code-hub/src/app/[locale]/settings/error-rules/_components/override-section.tsx` (Lines 23-52)

```typescript
/** Claude format override response template */
const CLAUDE_OVERRIDE_TEMPLATE = `{
  "type": "error",
  "error": {
    "type": "invalid_request_error",
    "message": "Your custom error message here"
  }
}`;

/** Gemini format override response template */
const GEMINI_OVERRIDE_TEMPLATE = `{
  "error": {
    "code": 400,
    "message": "Your custom error message here",
    "status": "INVALID_ARGUMENT"
  }
}`;

/** OpenAI format override response template */
const OPENAI_OVERRIDE_TEMPLATE = `{
  "error": {
    "message": "Your custom error message here",
    "type": "invalid_request_error",
    "param": null,
    "code": null
  }
}`;
```

---

## Code Implementation Details

### Error Rule Detector

**File**: `/Users/ding/Github/claude-code-hub/src/lib/error-rule-detector.ts`

The `ErrorRuleDetector` is a singleton class that manages error rule caching and detection:

```typescript
class ErrorRuleDetector {
  private regexPatterns: RegexPattern[] = [];
  private containsPatterns: ContainsPattern[] = [];
  private exactPatterns: Map<string, ExactPattern> = new Map();
  private lastReloadTime: number = 0;
  private isLoading: boolean = false;
  private isInitialized: boolean = false;
  private initializationPromise: Promise<void> | null = null;
  private dbLoadedSuccessfully: boolean = false;

  // Event-driven hot reload
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

      // Cross-process notification via Redis
      const { CHANNEL_ERROR_RULES_UPDATED, subscribeCacheInvalidation } = await import(
        "@/lib/redis/pubsub"
      );
      await subscribeCacheInvalidation(CHANNEL_ERROR_RULES_UPDATED, handleUpdated);
    }
  }
}

export const errorRuleDetector = new ErrorRuleDetector();
```

### Response Validation

**File**: `/Users/ding/Github/claude-code-hub/src/lib/error-override-validator.ts` (Lines 15, 203-279)

```typescript
/** 覆写响应体最大字节数限制 (10KB) */
const MAX_OVERRIDE_RESPONSE_BYTES = 10 * 1024;

export function validateErrorOverrideResponse(response: unknown): string | null {
  // 检查是否为纯对象（排除 null 和数组）
  if (!response || typeof response !== "object" || Array.isArray(response)) {
    return "覆写响应必须是对象";
  }

  const obj = response as Record<string, unknown>;

  // 检测格式类型
  const format = detectErrorResponseFormat(response);

  if (format === "claude") {
    const claudeError = validateClaudeFormat(obj);
    if (claudeError) return claudeError;
  } else if (format === "gemini") {
    const geminiError = validateGeminiFormat(obj);
    if (geminiError) return geminiError;
  } else if (format === "openai") {
    const openaiError = validateOpenAIFormat(obj);
    if (openaiError) return openaiError;
  } else {
    return '覆写响应格式无法识别。支持 Claude 格式、Gemini 格式或 OpenAI 格式';
  }

  // 检查响应体大小限制
  try {
    const jsonString = JSON.stringify(response);
    const byteLength = new TextEncoder().encode(jsonString).length;
    if (byteLength > MAX_OVERRIDE_RESPONSE_BYTES) {
      return `覆写响应体大小 (${Math.round(byteLength / 1024)}KB) 超过限制 (10KB)`;
    }
  } catch {
    return "覆写响应无法序列化为 JSON";
  }

  return null;
}
```

### Default Error Rules

**File**: `/Users/ding/Github/claude-code-hub/src/repository/error-rules.ts` (Lines 292-841)

The system includes 30+ pre-configured default error rules covering common scenarios:

```typescript
const DEFAULT_ERROR_RULES = [
  {
    pattern: "prompt is too long.*(tokens.*maximum|maximum.*tokens)",
    category: "prompt_limit",
    description: "Prompt token limit exceeded",
    matchType: "regex" as const,
    isDefault: true,
    isEnabled: true,
    priority: 100,
    overrideResponse: {
      type: "error",
      error: {
        type: "prompt_limit",
        message: "输入内容过长，请减少 Prompt 中的 token 数量后重试",
      },
    },
  },
  {
    pattern: "blocked by.*content filter",
    category: "content_filter",
    description: "Content blocked by safety filters",
    matchType: "regex" as const,
    isDefault: true,
    isEnabled: true,
    priority: 90,
    overrideResponse: {
      type: "error",
      error: {
        type: "content_filter",
        message: "内容被安全过滤器拦截，请修改输入内容后重试",
      },
    },
  },
  // ... more rules
];
```

### Server Actions

**File**: `/Users/ding/Github/claude-code-hub/src/actions/error-rules.ts`

Key server actions for managing error rules:

```typescript
// Create a new error rule
export async function createErrorRuleAction(data: {
  pattern: string;
  category: string;
  matchType?: "contains" | "exact" | "regex";
  description?: string;
  overrideResponse?: ErrorOverrideResponse | null;
  overrideStatusCode?: number | null;
}): Promise<ActionResult<ErrorRule>>

// Update an existing error rule
export async function updateErrorRuleAction(
  id: number,
  updates: Partial<{
    pattern: string;
    category: string;
    matchType: "regex" | "contains" | "exact";
    description: string;
    overrideResponse: ErrorOverrideResponse | null;
    overrideStatusCode: number | null;
    isEnabled: boolean;
    priority: number;
  }>
): Promise<ActionResult<ErrorRule>>

// Test error rule matching
export async function testErrorRuleAction(input: { message: string }): Promise<
  ActionResult<{
    matched: boolean;
    rule?: { category; pattern; matchType; overrideResponse; overrideStatusCode };
    finalResponse: ErrorOverrideResponse | null;
    finalStatusCode: number | null;
    warnings?: string[];
  }>
>

// Refresh cache and sync default rules
export async function refreshCacheAction(): Promise<
  ActionResult<{
    stats: ReturnType<typeof errorRuleDetector.getStats>;
    syncResult: { inserted: number; updated: number; skipped: number; deleted: number };
  }>
>
```

---

## Edge Cases and Behaviors

### 1. Empty Override Message Fallback

When the override response message is empty, the system falls back to the original client-safe message:

**File**: `/Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/error-handler.ts` (Lines 160-166)

```typescript
// 覆写消息为空时回退到客户端安全消息
const overrideErrorObj = override.response.error as Record<string, unknown>;
const overrideMessage =
  typeof overrideErrorObj?.message === "string" &&
  overrideErrorObj.message.trim().length > 0
    ? overrideErrorObj.message
    : clientErrorMessage;
```

### 2. Invalid Status Code Handling

Invalid status codes (outside 400-599 range) are rejected with a warning:

**File**: `/Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/error-handler.ts` (Lines 103-116)

```typescript
// 运行时校验覆写状态码范围（400-599），防止数据库脏数据导致 Response 抛 RangeError
let validatedStatusCode = override.statusCode;
if (
  validatedStatusCode !== null &&
  (!Number.isInteger(validatedStatusCode) ||
    validatedStatusCode < OVERRIDE_STATUS_CODE_MIN ||
    validatedStatusCode > OVERRIDE_STATUS_CODE_MAX)
) {
  logger.warn("ProxyErrorHandler: Invalid override status code, falling back to upstream", {
    overrideStatusCode: validatedStatusCode,
    upstreamStatusCode: statusCode,
  });
  validatedStatusCode = null;
}
```

### 3. Invalid Override Response Handling

Malformed override responses are skipped with logging:

**File**: `/Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/error-handler.ts` (Lines 128-158)

```typescript
// 运行时守卫：验证覆写响应格式是否合法（双重保护，加载时已过滤一次）
if (!isValidErrorOverrideResponse(override.response)) {
  logger.warn("ProxyErrorHandler: Invalid override response in database, skipping", {
    response: JSON.stringify(override.response).substring(0, 200),
  });
  // 跳过响应体覆写，但仍可应用状态码覆写
  if (override.statusCode !== null) {
    return await attachSessionIdToErrorResponse(
      session.sessionId,
      ProxyResponses.buildError(responseStatusCode, clientErrorMessage, ...)
    );
  }
  // 两者都无效，返回原始错误（但仍透传 request_id，因为有覆写意图）
  return await attachSessionIdToErrorResponse(...);
}
```

### 4. Request ID Injection

The system automatically extracts and injects upstream request IDs into override responses:

**File**: `/Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/error-handler.ts` (Lines 121-124)

```typescript
// 提取上游 request_id（用于覆写场景透传）
const upstreamRequestId =
  error instanceof ProxyError ? error.upstreamError?.requestId : undefined;
const safeRequestId = typeof upstreamRequestId === "string" ? upstreamRequestId : undefined;
```

### 5. Detection Result Caching

Error detection results are cached using WeakMap to avoid repeated pattern matching:

**File**: `/Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/errors.ts` (Lines 485-507)

```typescript
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

### 6. Response Size Limit

Override responses are limited to 10KB to prevent abuse:

**File**: `/Users/ding/Github/claude-code-hub/src/lib/error-override-validator.ts` (Line 16)

```typescript
/** 覆写响应体最大字节数限制 (10KB) */
const MAX_OVERRIDE_RESPONSE_BYTES = 10 * 1024;
```

### 7. ReDoS Protection

Regex patterns are checked for ReDoS (Regular Expression Denial of Service) risks:

**File**: `/Users/ding/Github/claude-code-hub/src/lib/error-rule-detector.ts` (Lines 243-251)

```typescript
// 使用 safe-regex 检测 ReDoS 风险
try {
  if (!safeRegex(rule.pattern)) {
    logger.warn(
      `[ErrorRuleDetector] ReDoS risk detected in pattern: ${rule.pattern}, skipping`
    );
    skippedRedosCount++;
    break;
  }
  // ...
}
```

### 8. Default Rule Synchronization

Default rules are synchronized with "user customization priority" strategy:

**File**: `/Users/ding/Github/claude-code-hub/src/repository/error-rules.ts` (Lines 858-937)

```typescript
export async function syncDefaultErrorRules(): Promise<{
  inserted: number;
  updated: number;
  skipped: number;
  deleted: number;
}> {
  // 策略：
  // - pattern 不存在：插入新规则
  // - pattern 存在且 isDefault=true：更新为最新默认规则
  // - pattern 存在且 isDefault=false：跳过（保留用户的自定义版本）
  // - 不再存在于 DEFAULT_ERROR_RULES 中的默认规则：删除
}
```

---

## Advanced Implementation Details

### Error Detection Result Interface

**File**: `/Users/ding/Github/claude-code-hub/src/lib/error-rule-detector.ts` (Lines 19-33)

```typescript
export interface ErrorDetectionResult {
  matched: boolean;
  ruleId?: number; // 规则 ID
  category?: string; // 触发的错误分类
  pattern?: string; // 匹配的规则模式
  matchType?: string; // 匹配类型（regex/contains/exact）
  description?: string; // 规则描述
  /** 覆写响应体：如果配置了则用此响应替换原始错误响应 */
  overrideResponse?: ErrorOverrideResponse;
  /** 覆写状态码：如果配置了则用此状态码替换原始状态码 */
  overrideStatusCode?: number;
}
```

### Error Override Result Interface

**File**: `/Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/errors.ts` (Lines 562-569)

```typescript
export interface ErrorOverrideResult {
  /** 覆写的响应体（可选，null 表示不覆写响应体，仅覆写状态码） */
  response: ErrorOverrideResponse | null;
  /** 覆写的状态码（可选，null 表示透传上游状态码） */
  statusCode: number | null;
}
```

### Override Status Code Constants

**File**: `/Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/error-handler.ts` (Lines 21-24)

```typescript
/** 覆写状态码最小值 */
const OVERRIDE_STATUS_CODE_MIN = 400;
/** 覆写状态码最大值 */
const OVERRIDE_STATUS_CODE_MAX = 599;
```

These constraints ensure that only valid HTTP error status codes (4xx-5xx) can be used for overrides.

### Repository Sanitization Function

**File**: `/Users/ding/Github/claude-code-hub/src/repository/error-rules.ts` (Lines 77-101)

```typescript
function sanitizeOverrideResponse(raw: unknown, context: string): ErrorOverrideResponse | null {
  if (raw === null || raw === undefined) {
    return null;
  }

  const validationError = validateErrorOverrideResponse(raw);
  if (validationError) {
    logger.warn(
      `[ErrorRulesRepository] Invalid overrideResponse in ${context}: ${validationError}`
    );
    return null;
  }

  return raw as ErrorOverrideResponse;
}
```

This function provides runtime validation at the repository layer, ensuring that malformed override responses from the database are sanitized before being used.

### Error Response Format Detection

**File**: `/Users/ding/Github/claude-code-hub/src/lib/error-override-validator.ts` (Lines 27-53)

```typescript
export function detectErrorResponseFormat(response: unknown): ErrorResponseFormat | null {
  if (!response || typeof response !== "object" || Array.isArray(response)) {
    return null;
  }

  const obj = response as Record<string, unknown>;

  // Claude 格式：有顶层 type: "error"
  if (obj.type === "error" && obj.error && typeof obj.error === "object") {
    return "claude";
  }

  // Gemini 格式：有 error.code (number) 和 error.status (string)
  if (obj.error && typeof obj.error === "object" && !Array.isArray(obj.error)) {
    const errorObj = obj.error as Record<string, unknown>;
    if (typeof errorObj.code === "number" && typeof errorObj.status === "string") {
      return "gemini";
    }
    // OpenAI 格式：有 error.type (string) 和 error.message (string)，无顶层 type
    if (typeof errorObj.type === "string" && typeof errorObj.message === "string") {
      return "openai";
    }
  }

  return null;
}
```

The format detection logic automatically identifies which error format is being used based on the structure of the response object.

### Format-Specific Validation

**Claude Format Validation** (Lines 67-97):

```typescript
function validateClaudeFormat(obj: Record<string, unknown>): string | null {
  // 顶层 type 必须为 "error"
  if (typeof obj.type !== "string" || obj.type.trim().length === 0) {
    return "Claude 格式覆写响应缺少 type 字段";
  }
  if (obj.type !== "error") {
    return 'Claude 格式覆写响应 type 字段必须为 "error"';
  }

  // error 对象存在且不是数组
  if (!obj.error || typeof obj.error !== "object" || Array.isArray(obj.error)) {
    return "Claude 格式覆写响应缺少 error 对象";
  }

  const errorObj = obj.error as Record<string, unknown>;

  if (typeof errorObj.type !== "string" || errorObj.type.trim().length === 0) {
    return "Claude 格式覆写响应 error.type 字段缺失或为空";
  }

  // message 允许为空字符串，运行时将回退到原始错误消息
  if (typeof errorObj.message !== "string") {
    return "Claude 格式覆写响应 error.message 字段必须是字符串";
  }

  return null;
}
```

**Gemini Format Validation** (Lines 111-140):

```typescript
function validateGeminiFormat(obj: Record<string, unknown>): string | null {
  if (!obj.error || typeof obj.error !== "object" || Array.isArray(obj.error)) {
    return "Gemini 格式覆写响应缺少 error 对象";
  }

  const errorObj = obj.error as Record<string, unknown>;

  if (typeof errorObj.code !== "number") {
    return "Gemini 格式覆写响应 error.code 字段必须是数字";
  }

  if (typeof errorObj.message !== "string") {
    return "Gemini 格式覆写响应 error.message 字段必须是字符串";
  }

  if (typeof errorObj.status !== "string" || errorObj.status.trim().length === 0) {
    return "Gemini 格式覆写响应 error.status 字段缺失或为空";
  }

  return null;
}
```

**OpenAI Format Validation** (Lines 157-190):

```typescript
function validateOpenAIFormat(obj: Record<string, unknown>): string | null {
  if (!obj.error || typeof obj.error !== "object" || Array.isArray(obj.error)) {
    return "OpenAI 格式覆写响应缺少 error 对象";
  }

  const errorObj = obj.error as Record<string, unknown>;

  if (typeof errorObj.type !== "string" || errorObj.type.trim().length === 0) {
    return "OpenAI 格式覆写响应 error.type 字段缺失或为空";
  }

  if (typeof errorObj.message !== "string") {
    return "OpenAI 格式覆写响应 error.message 字段必须是字符串";
  }

  return null;
}
```

### Error Handler Logging

When an override is applied, detailed logging is performed:

**File**: `/Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/error-handler.ts` (Lines 179-195)

```typescript
logger.info("ProxyErrorHandler: Applied error override response", {
  original: logErrorMessage.substring(0, 200),
  format: isClaudeErrorFormat(override.response)
    ? "claude"
    : isGeminiErrorFormat(override.response)
      ? "gemini"
      : isOpenAIErrorFormat(override.response)
        ? "openai"
        : "unknown",
  statusCode: responseStatusCode,
});

logger.error("ProxyErrorHandler: Request failed (overridden)", {
  error: logErrorMessage,
  statusCode: responseStatusCode,
  overridden: true,
});
```

### Error Rule Testing Action

The test action simulates runtime processing to ensure test results match actual behavior:

**File**: `/Users/ding/Github/claude-code-hub/src/actions/error-rules.ts` (Lines 456-585)

```typescript
export async function testErrorRuleAction(input: { message: string }): Promise<
  ActionResult<{
    matched: boolean;
    rule?: {
      category: string;
      pattern: string;
      matchType: "regex" | "contains" | "exact";
      overrideResponse: repo.ErrorOverrideResponse | null;
      overrideStatusCode: number | null;
    };
    finalResponse: repo.ErrorOverrideResponse | null;
    finalStatusCode: number | null;
    warnings?: string[];
  }>
> {
  // ... validation and detection

  // 模拟运行时处理逻辑，确保测试结果与实际行为一致
  const warnings: string[] = [];
  let finalResponse: repo.ErrorOverrideResponse | null = null;
  let finalStatusCode: number | null = null;

  if (detection.matched) {
    // 1. 验证覆写响应格式（与 error-handler.ts 运行时逻辑一致）
    if (detection.overrideResponse) {
      const validationError = validateErrorOverrideResponse(detection.overrideResponse);
      if (validationError) {
        warnings.push(`${validationError}，运行时将跳过响应体覆写`);
      } else {
        // 2. 移除 request_id（运行时会从上游注入）
        const { request_id: _ignoredRequestId, ...responseWithoutRequestId } =
          detection.overrideResponse as Record<string, unknown>;

        // 3. 处理 message 为空的情况（运行时会回退到原始错误消息）
        const overrideErrorObj = detection.overrideResponse.error as Record<string, unknown>;
        const isMessageEmpty =
          typeof overrideErrorObj?.message !== "string" ||
          overrideErrorObj.message.trim().length === 0;

        if (isMessageEmpty) {
          warnings.push("覆写响应的 message 为空，运行时将回退到原始错误消息");
        }

        // 构建最终响应
        finalResponse = { ... } as repo.ErrorOverrideResponse;
      }
    }

    // 4. 验证状态码范围
    const statusCodeError = validateOverrideStatusCodeRange(detection.overrideStatusCode);
    if (!statusCodeError && detection.overrideStatusCode !== null) {
      finalStatusCode = detection.overrideStatusCode;
    }
  }

  return { ok: true, data: { matched, rule, finalResponse, finalStatusCode, warnings } };
}
```

### UI Component: OverrideSection

The frontend provides a user-friendly interface for configuring overrides:

**File**: `/Users/ding/Github/claude-code-hub/src/app/[locale]/settings/error-rules/_components/override-section.tsx` (Lines 65-101)

```typescript
export function OverrideSection({
  idPrefix,
  enableOverride,
  onEnableOverrideChange,
  overrideResponse,
  onOverrideResponseChange,
  overrideStatusCode,
  onOverrideStatusCodeChange,
}: OverrideSectionProps) {
  const t = useTranslations("settings");

  /** Real-time JSON format validation */
  const jsonStatus = useMemo((): JsonValidationState => {
    const trimmed = overrideResponse.trim();
    if (!trimmed) {
      return { state: "empty" };
    }
    try {
      JSON.parse(trimmed);
      return { state: "valid" };
    } catch (error) {
      return { state: "invalid", message: (error as Error).message };
    }
  }, [overrideResponse]);

  /** Handle use template button click */
  const handleUseTemplate = useCallback(
    (template: string) => {
      if (overrideResponse.trim().length > 0) {
        const confirmed = window.confirm(t("errorRules.dialog.useTemplateConfirm"));
        if (!confirmed) return;
      }
      onOverrideResponseChange(template);
    },
    [overrideResponse, onOverrideResponseChange, t]
  );

  // ... render UI with validation indicators
}
```

---

## References

### Key Files

| File Path | Description |
|-----------|-------------|
| `/Users/ding/Github/claude-code-hub/src/repository/error-rules.ts` | Error rule repository with types, interfaces, and default rules |
| `/Users/ding/Github/claude-code-hub/src/lib/error-rule-detector.ts` | Error detection engine with caching and pattern matching |
| `/Users/ding/Github/claude-code-hub/src/lib/error-override-validator.ts` | Response format validation for Claude/Gemini/OpenAI formats |
| `/Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/error-handler.ts` | Error handler that applies overrides to responses |
| `/Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/errors.ts` | Error classification and override detection |
| `/Users/ding/Github/claude-code-hub/src/actions/error-rules.ts` | Server actions for CRUD operations on error rules |
| `/Users/ding/Github/claude-code-hub/src/drizzle/schema.ts` | Database schema definition for error_rules table |
| `/Users/ding/Github/claude-code-hub/src/app/[locale]/settings/error-rules/_components/override-section.tsx` | UI component for configuring override responses |
| `/Users/ding/Github/claude-code-hub/src/app/[locale]/settings/error-rules/_components/add-rule-dialog.tsx` | Dialog for creating new error rules |
| `/Users/ding/Github/claude-code-hub/src/app/[locale]/settings/error-rules/_components/edit-rule-dialog.tsx` | Dialog for editing existing error rules |
| `/Users/ding/Github/claude-code-hub/src/app/[locale]/settings/error-rules/_components/error-rule-tester.tsx` | Component for testing error rule matching |

### Related Documentation Pages

- `/docs/filters/request-filters` - Request filtering system
- `/docs/filters/sensitive-words` - Sensitive word detection
- `/docs/filters/error-rules` - Error rule management
- `/docs/filters/header-modification` - Header modification
- `/docs/filters/body-modification` - Body modification
- `/docs/filters/model-whitelist` - Model whitelist

---

## Summary

The Response Override feature in claude-code-hub provides a powerful, flexible mechanism for transforming API error responses. Key characteristics include:

1. **Multi-format Support**: Handles Claude, Gemini, and OpenAI error formats with automatic format detection
2. **Flexible Matching**: Supports regex, contains, and exact matching strategies with performance-ordered evaluation
3. **Performance Optimized**: Uses caching, lazy loading, and efficient pattern ordering (contains → exact → regex)
4. **Production Ready**: Includes validation at multiple layers, size limits (10KB), ReDoS protection, and graceful fallbacks
5. **Hot Reload**: Event-driven cache invalidation via EventEmitter and Redis pub/sub supports multi-worker deployments
6. **User-Friendly UI**: Built-in templates for all three formats and real-time testing tools for administrators
7. **Security Conscious**: Hides provider names and internal details from client-facing error messages
8. **Fail-Safe Design**: Invalid overrides are skipped with warnings rather than causing system failures

This feature is essential for production deployments where user experience, error clarity, and security are critical requirements.
