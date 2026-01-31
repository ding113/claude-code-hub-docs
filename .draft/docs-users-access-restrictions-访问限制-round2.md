# Access Restrictions (访问限制) - Round 2 Draft

## Intent Analysis

The access restrictions system in Claude Code Hub serves a critical purpose: controlling who can access the proxy service, what they can access, and how they can access it. This system is designed for multi-tenant environments where administrators need fine-grained control over user permissions, resource allocation, and security policies.

The primary intents are:

1. **Security Control**: Prevent unauthorized access by validating clients, models, and user status before allowing requests to reach upstream providers.

2. **Resource Management**: Limit consumption through quota-based restrictions (RPM, cost limits, concurrent sessions) to prevent abuse and manage costs.

3. **Compliance**: Enforce organizational policies by restricting which AI models can be used and which client applications are permitted.

4. **Operational Safety**: Block potentially harmful content through sensitive word filtering and request modification capabilities.

## Behavior Summary

The access restriction system operates as a multi-layered guard pipeline that processes every incoming request. Each guard can either allow the request to proceed or block it with a specific error response.

### Guard Pipeline Execution Order

The guards execute in a specific sequence defined in `/Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/guard-pipeline.ts`:

```typescript
export const CHAT_PIPELINE: GuardConfig = {
  steps: [
    "auth",              // Authentication and user status check
    "sensitive",         // Sensitive word detection
    "client",            // Client/IDE restriction
    "model",             // AI model restriction
    "version",           // Client version check
    "probe",             // Health probe handling
    "session",           // Session assignment
    "warmup",            // Warmup request interception
    "requestFilter",     // Request filtering/modification
    "rateLimit",         // Rate limiting and quotas
    "provider",          // Provider selection
    "providerRequestFilter", // Provider-specific filtering
    "messageContext",    // Message context handling
  ],
};
```

Each guard runs in sequence. If any guard returns a non-null Response, the pipeline terminates early and the response is returned to the client without reaching upstream providers.

### Key Design Principles

1. **Fail-Open Philosophy**: Most guards are designed to fail open - if there's an error in the restriction check, the request is allowed through rather than blocked. This ensures service availability.

2. **Opt-In Restrictions**: Restrictions only apply when explicitly configured. Empty arrays or null values mean "no restrictions."

3. **Layered Defense**: Multiple guards can block the same request, with each layer providing a different type of protection.

4. **Audit Trail**: Blocked requests are logged with specific `blockedBy` and `blockedReason` fields for troubleshooting and compliance.

## Configuration and Usage

### 1. User Status and Expiry (Authentication Guard)

Located in `/Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/auth-guard.ts`, the authentication guard validates user status before allowing access.

**Database Schema** (from `/Users/ding/Github/claude-code-hub/src/drizzle/schema.ts`):

```typescript
export const users = pgTable('users', {
  // ... other fields
  isEnabled: boolean('is_enabled').notNull().default(true),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  // ...
});
```

**Behavior**:
- If `isEnabled` is `false`, the user receives a 401 error: "用户账户已被禁用。请联系管理员。" (User account has been disabled. Please contact administrator.)
- If `expiresAt` is set and has passed, the user receives a 401 error with the expiration date: "用户账户已于 {date} 过期。请续费订阅。" (User account expired on {date}. Please renew subscription.)
- Expired users are lazily marked as disabled via `markUserExpired()`

**Configuration via Dashboard**:
Administrators can set user status and expiry through the user edit form. These are admin-only fields as defined in `/Users/ding/Github/claude-code-hub/src/lib/permissions/user-field-permissions.ts`:

```typescript
export const USER_FIELD_PERMISSIONS = {
  isEnabled: { requiredRole: "admin" },
  expiresAt: { requiredRole: "admin" },
  // ...
};
```

### 2. Client Restrictions (Client Guard)

Located in `/Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/client-guard.ts`, this guard restricts which CLI/IDE clients can access the service.

**Database Schema**:

```typescript
export const users = pgTable('users', {
  // ...
  allowedClients: jsonb('allowed_clients').$type<string[]>().default([]),
  // ...
});
```

**Matching Logic**:
- Case-insensitive substring match with hyphen/underscore normalization
- Patterns like "gemini-cli" match "GeminiCLI", "gemini_cli", or "gemini-cli"
- Empty array means no restrictions
- Maximum 50 patterns, each up to 64 characters

**Error Messages**:
- Missing User-Agent when restrictions exist: "Client not allowed. User-Agent header is required when client restrictions are configured."
- Non-matching client: "Client not allowed. Your client is not in the allowed list."

**Preset Clients** (from `/Users/ding/Github/claude-code-hub/src/app/[locale]/dashboard/_components/user/forms/access-restrictions-section.tsx`):

```typescript
const PRESET_CLIENTS = [
  { value: "claude-cli", label: "Claude Code CLI" },
  { value: "gemini-cli", label: "Gemini CLI" },
  { value: "factory-cli", label: "Droid CLI" },
  { value: "codex-cli", label: "Codex CLI" },
];
```

**Example Test Cases** (from `/Users/ding/Github/claude-code-hub/tests/unit/proxy/client-guard.test.ts`):

```typescript
test("should match gemini-cli pattern against GeminiCLI User-Agent", async () => {
  const session = createMockSession("GeminiCLI/0.22.5/gemini-3-pro-preview (darwin; arm64)", [
    "gemini-cli",
  ]);
  const result = await ProxyClientGuard.ensure(session);
  expect(result).toBeNull(); // null means allowed
});
```

### 3. Model Restrictions (Model Guard)

Located in `/Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/model-guard.ts`, this guard restricts which AI models a user can access.

**Database Schema**:

```typescript
export const users = pgTable('users', {
  // ...
  allowedModels: jsonb('allowed_models').$type<string[]>().default([]),
  // ...
});
```

**Matching Logic**:
- Case-insensitive exact match (not substring)
- Model name must match exactly (e.g., "claude-3-opus-20240229")
- Empty array means no restrictions
- Maximum 50 models, each up to 64 characters

**Error Messages**:
- Missing model when restrictions exist: "Model not allowed. Model specification is required when model restrictions are configured."
- Non-allowed model: "Model not allowed. The requested model '{model}' is not in the allowed list."

**Validation Pattern** (from `/Users/ding/Github/claude-code-hub/src/app/[locale]/dashboard/_components/user/forms/access-restrictions-section.tsx`):

```typescript
const MODEL_NAME_PATTERN = /^[a-zA-Z0-9._:/-]+$/;
// Examples: gemini-1.5-pro, gpt-4.1, claude-3-opus-20240229, o1-mini
```

### 4. Rate Limiting and Quotas (Rate Limit Guard)

Located in `/Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/rate-limit-guard.ts`, this guard enforces multiple levels of consumption limits.

**Check Order** (as documented in the code):

```typescript
/**
 * 检查顺序（基于 Codex 专业分析）：
 * 1-2. 永久硬限制：Key 总限额 → User 总限额
 * 3-5. 资源/频率保护：Key 并发 → User 并发 → User RPM
 * 6-9. 短期周期限额：Key 5h → User 5h → Key 每日 → User 每日
 * 10-13. 中长期周期限额：Key 周 → User 周 → Key 月 → User 月
 */
```

**Limit Types**:

| Limit Type | Field | Description |
|------------|-------|-------------|
| Total Cost | `limitTotalUsd` | Permanent lifetime limit |
| 5-hour | `limit5hUsd` | Rolling 5-hour window |
| Daily | `limitDailyUsd` / `dailyQuota` | Daily spending limit |
| Weekly | `limitWeeklyUsd` | Weekly spending limit |
| Monthly | `limitMonthlyUsd` | Monthly spending limit |
| Concurrent Sessions | `limitConcurrentSessions` | Max parallel connections |
| RPM | `rpm` | Requests per minute (note: DB field is `rpmLimit`, accessed as `user.rpm` in code) |

**Daily Reset Modes**:
- `fixed`: Resets at a specific time (e.g., "00:00", "18:00")
- `rolling`: 24-hour rolling window

**Database Schema**:

```typescript
export const users = pgTable('users', {
  rpmLimit: integer('rpm_limit'),
  dailyLimitUsd: numeric('daily_limit_usd', { precision: 10, scale: 2 }),
  limit5hUsd: numeric('limit_5h_usd', { precision: 10, scale: 2 }),
  limitWeeklyUsd: numeric('limit_weekly_usd', { precision: 10, scale: 2 }),
  limitMonthlyUsd: numeric('limit_monthly_usd', { precision: 10, scale: 2 }),
  limitTotalUsd: numeric('limit_total_usd', { precision: 10, scale: 2 }),
  limitConcurrentSessions: integer('limit_concurrent_sessions'),
  dailyResetMode: dailyResetModeEnum('daily_reset_mode').default('fixed').notNull(),
  dailyResetTime: varchar('daily_reset_time', { length: 5 }).default('00:00').notNull(),
});
```

### 5. Sensitive Word Filtering (Sensitive Word Guard)

Located in `/Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/sensitive-word-guard.ts`, this guard blocks requests containing prohibited content.

**Database Schema** (from `/Users/ding/Github/claude-code-hub/src/drizzle/schema.ts`):

```typescript
export const sensitiveWords = pgTable('sensitive_words', {
  id: serial('id').primaryKey(),
  word: varchar('word', { length: 255 }).notNull(),
  matchType: varchar('match_type', { length: 20 }).notNull().default('contains'),
  description: text('description'),
  isEnabled: boolean('is_enabled').notNull().default(true),
});
```

**Match Types**:
- `contains`: Substring match (fastest, O(n*m))
- `exact`: Exact string match (O(1) with Set)
- `regex`: Regular expression match (most flexible, slowest)

**Detection Engine** (from `/Users/ding/Github/claude-code-hub/src/lib/sensitive-word-detector.ts`):

```typescript
class SensitiveWordCache {
  private contains: string[] = [];
  private exact: Set<string> = new Set();
  private regex: RegexPattern[] = [];

  detect(text: string): DetectionResult {
    // 1. Contains match (fastest)
    for (const word of this.contains) {
      if (lowerText.includes(word)) {
        return { matched: true, word, matchType: "contains", ... };
      }
    }

    // 2. Exact match (O(1))
    if (this.exact.has(trimmedText)) {
      return { matched: true, word: trimmedText, matchType: "exact", ... };
    }

    // 3. Regex match (most flexible)
    for (const { pattern, word } of this.regex) {
      const match = pattern.exec(text);
      if (match) {
        return { matched: true, word, matchType: "regex", matchedText: match[0] };
      }
    }

    return { matched: false };
  }
}
```

**Blocked Request Logging**:
- `blockedBy`: "sensitive_word"
- `blockedReason`: JSON with `word`, `matchType`, `matchedText`
- Provider ID: 0 (indicates blocked before reaching provider)
- Cost: 0 (not charged)

### 6. Request Filtering (Request Filter)

Located in `/Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/request-filter.ts` and `/Users/ding/Github/claude-code-hub/src/lib/request-filter-engine.ts`, this system modifies requests before they reach providers.

**Database Schema**:

```typescript
export const requestFilters = pgTable('request_filters', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 100 }).notNull(),
  scope: varchar('scope', { length: 20 }).notNull().$type<'header' | 'body'>(),
  action: varchar('action', { length: 30 }).notNull()
    .$type<'remove' | 'set' | 'json_path' | 'text_replace'>(),
  matchType: varchar('match_type', { length: 20 }),  // Optional field
  target: text('target').notNull(),
  replacement: jsonb('replacement'),
  priority: integer('priority').notNull().default(0),
  isEnabled: boolean('is_enabled').notNull().default(true),
  bindingType: varchar('binding_type', { length: 20 })
    .notNull().default('global').$type<'global' | 'providers' | 'groups'>(),
  providerIds: jsonb('provider_ids').$type<number[] | null>(),
  groupTags: jsonb('group_tags').$type<string[] | null>(),
});
```

**Filter Actions**:

| Scope | Action | Description |
|-------|--------|-------------|
| Header | `remove` | Delete header |
| Header | `set` | Set/replace header value |
| Body | `json_path` | Modify JSON using path |
| Body | `text_replace` | Replace text (contains/exact/regex) |

**Execution Phases**:
1. Global filters run before provider selection
2. Provider-specific filters run after provider selection

### 7. Client Version Checking (Version Guard)

Located in `/Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/version-guard.ts`, this guard blocks outdated client versions.

**System Setting**:

```typescript
export const systemSettings = pgTable('system_settings', {
  enableClientVersionCheck: boolean('enable_client_version_check').notNull().default(false),
});
```

**GA Version Detection** (from `/Users/ding/Github/claude-code-hub/src/lib/client-version-checker.ts`):

```typescript
/**
 * GA 版本定义：被 GA_THRESHOLD 个或以上用户使用的最新版本
 * 活跃窗口：过去 7 天内有请求的用户
 * 默认阈值：2 (configurable via CLIENT_VERSION_GA_THRESHOLD env var)
 */
static async detectGAVersion(clientType: string): Promise<string | null> {
  // 1. Check Redis cache
  // 2. Query active users from last 7 days
  // 3. Parse UA and count users per version
  // 4. Return latest version with >= GA_THRESHOLD users
}
```

**Error Response**:

```json
{
  "error": {
    "type": "client_upgrade_required",
    "message": "Your Claude Code CLI (v1.0.0) is outdated. Please upgrade to v2.0.0 or later to continue using this service.",
    "current_version": "1.0.0",
    "required_version": "2.0.0",
    "client_type": "claude-cli",
    "client_display_name": "Claude Code CLI"
  }
}
```

**Fail-Open Behavior**:
- If version check fails, request is allowed
- If UA parsing fails, request is allowed
- If feature is disabled, all requests allowed

### 8. Warmup Request Interception (Warmup Guard)

Located in `/Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/warmup-guard.ts`, this guard intercepts Anthropic warmup requests to avoid unnecessary upstream calls.

**System Setting**:

```typescript
export const systemSettings = pgTable('system_settings', {
  interceptAnthropicWarmupRequests: boolean('intercept_anthropic_warmup_requests')
    .notNull().default(false),
});
```

**Warmup Request Detection** (from `/Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/session.ts`):

```typescript
isWarmupRequest(): boolean {
  // Must be /v1/messages endpoint
  // Must have exactly 1 message with role "user"
  // Must have exactly 1 content block of type "text"
  // Text must be "warmup" (case-insensitive)
  // Must have cache_control.type == "ephemeral"
}
```

**Intercepted Response**:
- Returns minimal valid Anthropic response
- Logs with `blockedBy: "warmup"`
- Not charged, not counted in statistics
- Headers include `x-cch-intercepted: warmup`

### 9. Key-Level Restrictions

Keys have their own set of restrictions defined in `/Users/ding/Github/claude-code-hub/src/drizzle/schema.ts`:

```typescript
export const keys = pgTable('keys', {
  isEnabled: boolean('is_enabled').default(true),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  canLoginWebUi: boolean('can_login_web_ui').default(false),
  limit5hUsd: numeric('limit_5h_usd', { precision: 10, scale: 2 }),
  limitDailyUsd: numeric('limit_daily_usd', { precision: 10, scale: 2 }),
  limitWeeklyUsd: numeric('limit_weekly_usd', { precision: 10, scale: 2 }),
  limitMonthlyUsd: numeric('limit_monthly_usd', { precision: 10, scale: 2 }),
  limitTotalUsd: numeric('limit_total_usd', { precision: 10, scale: 2 }),
  limitConcurrentSessions: integer('limit_concurrent_sessions').default(0),
  providerGroup: varchar('provider_group', { length: 200 }).default('default'),
});
```

**Key-Specific Behaviors**:
- `canLoginWebUi`: Controls whether the key can be used to access the web dashboard
- Key-level limits override or combine with user-level limits (depending on implementation)
- Keys can have different provider groups than their parent user

## Edge Cases and Considerations

### 1. Empty vs Null Restrictions

All restriction fields use "empty means no restriction" semantics:

```typescript
// Client guard
const allowedClients = user.allowedClients ?? [];
if (allowedClients.length === 0) {
  return null; // No restrictions - allow all
}

// Model guard
const allowedModels = user.allowedModels ?? [];
if (allowedModels.length === 0) {
  return null; // No restrictions - allow all
}
```

This design ensures backward compatibility - existing users without restrictions continue to work without migration.

### 2. Pattern Normalization Edge Cases

The client guard normalizes hyphens and underscores:

```typescript
const normalize = (s: string) => s.toLowerCase().replace(/[-_]/g, "");
```

Edge cases handled:
- Pattern "-" normalizes to empty string (skipped, won't match everything)
- Pattern "___" normalizes to empty string (skipped)
- Mixed patterns like "my-special_cli" normalize consistently

### 3. Rate Limit Window Nuances

**Fixed vs Rolling Windows**:
- Fixed: Resets at specific time (e.g., every day at 00:00)
- Rolling: 5-hour or 24-hour sliding window from current time

**Error Message Differences**:
- Fixed windows show reset time: "Quota will reset at 2024-01-15T00:00:00Z"
- Rolling windows show duration: "Quota will reset in 3 hours"

### 4. Blocked Request Logging

All blocked requests are logged to `message_request` table with special fields:

```typescript
blockedBy: varchar('blocked_by', { length: 50 }),
blockedReason: text('blocked_reason'),
```

Common `blockedBy` values:
- `"warmup"` - Intercepted warmup request
- `"sensitive_word"` - Blocked by sensitive word filter

The `blockedReason` field contains JSON with detailed information about why the request was blocked.

### 5. Database Indexes for Blocked Queries

From `/Users/ding/Github/claude-code-hub/src/drizzle/schema.ts`:

```typescript
// Database index names use idx_ prefix
idx_message_request_session_id_prefix: index('idx_message_request_session_id_prefix')
  .on(sql`${table.sessionId} varchar_pattern_ops`)
  .where(sql`${table.deletedAt} IS NULL AND (${table.blockedBy} IS NULL OR ${table.blockedBy} <> 'warmup')`),

idx_message_request_blocked_by: index('idx_message_request_blocked_by')
  .on(table.blockedBy)
  .where(sql`${table.deletedAt} IS NULL`),
```

These indexes optimize:
- Excluding warmup requests from session queries
- Finding blocked requests by type

### 6. Permission System

Field-level permissions are enforced in server actions. From `/Users/ding/Github/claude-code-hub/src/lib/permissions/user-field-permissions.ts`:

```typescript
export const USER_FIELD_PERMISSIONS = {
  allowedClients: { requiredRole: "admin" },
  allowedModels: { requiredRole: "admin" },
  isEnabled: { requiredRole: "admin" },
  expiresAt: { requiredRole: "admin" },
  rpm: { requiredRole: "admin" },
  dailyQuota: { requiredRole: "admin" },
  limit5hUsd: { requiredRole: "admin" },
  limitWeeklyUsd: { requiredRole: "admin" },
  limitMonthlyUsd: { requiredRole: "admin" },
  limitTotalUsd: { requiredRole: "admin" },
  limitConcurrentSessions: { requiredRole: "admin" },
  dailyResetMode: { requiredRole: "admin" },
  dailyResetTime: { requiredRole: "admin" },
  providerGroup: { requiredRole: "admin" },
};
```

Non-admin users cannot modify restriction settings, even for their own account.

### 7. Validation Limits

From `/Users/ding/Github/claude-code-hub/src/lib/validation/schemas.ts`:

```typescript
allowedClients: z
  .array(z.string().max(64, "客户端模式长度不能超过64个字符"))
  .max(50, "客户端模式数量不能超过50个")
  .optional()
  .default([]),

allowedModels: z
  .array(z.string().max(64, "模型名称长度不能超过64个字符"))
  .max(50, "模型数量不能超过50个")
  .optional()
  .default([]),
```

These limits prevent:
- Excessive memory usage from large arrays
- Performance degradation from too many patterns
- Storage bloat in database JSONB columns

### 8. Fail-Open vs Fail-Closed

Different guards have different failure modes:

**Fail-Open** (allow on error):
- Version guard: Any error returns null (allow)
- Sensitive word guard: Detection error returns null (allow)
- Request filter: Filter failure logs error but doesn't block

**Fail-Closed** (block on error):
- Auth guard: Authentication failures return 401
- Rate limit guard: Limit exceeded throws RateLimitError
- Client/Model guards: Pattern mismatch returns 400

### 9. Concurrent Session Tracking

Concurrent sessions are tracked via Redis in `/Users/ding/Github/claude-code-hub/src/lib/session-tracker.ts`. The session guard checks limits:

```typescript
// Warmup requests don't count toward concurrent limits
if (!warmupMaybeIntercepted) {
  void SessionTracker.trackSession(sessionId, keyId, userId);
}
```

This prevents warmup requests from consuming quota.

### 10. Provider Group Restrictions

Users and keys can be assigned to provider groups. The provider selector enforces group restrictions in `/Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/provider-selector.ts`:

```typescript
// Fix #190: Support provider multi-tags (e.g. "cli,chat") matching user single-tag (e.g. "cli")
// Fix #281: Reject providers without groupTag when user/key has group restrictions
if (!checkProviderGroupMatch(provider.groupTag, effectiveGroup)) {
  // Reject reuse, re-select provider
  return null;
}
```

If a user has a non-default provider group, they can only use providers tagged with that group.

## References

### Core Files

| File | Purpose |
|------|---------|
| `/Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/guard-pipeline.ts` | Guard pipeline orchestration |
| `/Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/auth-guard.ts` | Authentication and user status |
| `/Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/client-guard.ts` | Client/IDE restrictions |
| `/Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/model-guard.ts` | AI model restrictions |
| `/Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/rate-limit-guard.ts` | Rate limiting and quotas |
| `/Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/sensitive-word-guard.ts` | Sensitive word filtering |
| `/Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/request-filter.ts` | Request modification |
| `/Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/version-guard.ts` | Client version checking |
| `/Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/warmup-guard.ts` | Warmup request interception |
| `/Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/session-guard.ts` | Session management |

### Supporting Libraries

| File | Purpose |
|------|---------|
| `/Users/ding/Github/claude-code-hub/src/lib/sensitive-word-detector.ts` | Sensitive word detection engine |
| `/Users/ding/Github/claude-code-hub/src/lib/request-filter-engine.ts` | Request filter engine |
| `/Users/ding/Github/claude-code-hub/src/lib/client-version-checker.ts` | Version tracking and GA detection |
| `/Users/ding/Github/claude-code-hub/src/lib/rate-limit/service.ts` | Rate limit checking service |
| `/Users/ding/Github/claude-code-hub/src/lib/permissions/user-field-permissions.ts` | Field-level permission definitions |
| `/Users/ding/Github/claude-code-hub/src/lib/session-tracker.ts` | Concurrent session tracking |

### Database Schema

| File | Purpose |
|------|---------|
| `/Users/ding/Github/claude-code-hub/src/drizzle/schema.ts` | Complete database schema including all restriction fields |

### UI Components

| File | Purpose |
|------|---------|
| `/Users/ding/Github/claude-code-hub/src/app/[locale]/dashboard/_components/user/forms/access-restrictions-section.tsx` | Access restrictions form UI |

### Type Definitions

| File | Purpose |
|------|---------|
| `/Users/ding/Github/claude-code-hub/src/types/user.ts` | User type definitions with restriction fields |

### Tests

| File | Purpose |
|------|---------|
| `/Users/ding/Github/claude-code-hub/tests/unit/proxy/client-guard.test.ts` | Client guard unit tests |

## Summary

The access restrictions system in Claude Code Hub provides comprehensive control over service access through a layered guard architecture. Each guard serves a specific purpose:

1. **Authentication Guard** ensures users are valid, enabled, and not expired
2. **Client Guard** restricts which applications can access the service
3. **Model Guard** controls which AI models users can invoke
4. **Rate Limit Guard** prevents abuse through multi-layered quota enforcement
5. **Sensitive Word Guard** blocks prohibited content
6. **Request Filter** modifies requests for compliance or safety
7. **Version Guard** ensures clients are up-to-date
8. **Warmup Guard** optimizes performance by intercepting health checks

The system is designed with security, performance, and usability in mind:
- Fail-open philosophy ensures service availability
- Opt-in restrictions maintain backward compatibility
- Comprehensive audit logging supports troubleshooting
- Admin-only configuration prevents privilege escalation
- Database indexes optimize common query patterns

Understanding these restrictions is essential for administrators configuring the system and developers integrating with the API.

---

## Verification Notes

This round2 draft has been verified against the actual claude-code-hub codebase. The following corrections were made from round1:

1. **RPM field clarification**: The database schema uses `rpmLimit`, but the rate-limit-guard.ts code accesses it as `user.rpm`. Documentation now clarifies this distinction.

2. **Database index naming**: Index names in the database use `idx_` prefix (e.g., `idx_message_request_session_id_prefix`), not camelCase variable names.

3. **matchType is optional**: In the request_filters table, `matchType` is an optional (nullable) field, not required.

4. **Complete permission fields**: Added all admin-only fields to the USER_FIELD_PERMISSIONS section, including rpm, dailyQuota, and providerGroup.

5. **Provider selector fixes**: Added both Fix #190 and Fix #281 comments for complete context on provider group matching.

All code snippets have been verified against the actual implementation at `/Users/ding/Github/claude-code-hub/`.
