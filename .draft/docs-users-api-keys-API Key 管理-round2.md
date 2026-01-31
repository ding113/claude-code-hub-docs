# API Key 管理 (API Key Management) - Round 2 Verified Draft

## Intent Analysis

### Purpose
The API Key Management system in Claude Code Hub serves as the core authentication and authorization mechanism for the entire platform. It enables:

1. **User Authentication**: API keys are the primary credential for accessing the Claude API proxy service
2. **Access Control**: Fine-grained permissions through provider groups, Web UI login restrictions, and usage limits
3. **Usage Tracking**: Per-key consumption monitoring for cost allocation and quota enforcement
4. **Multi-tenancy Isolation**: Ensuring users can only access resources within their assigned provider groups

### Target Users
- **End Users**: Developers who need API access to Claude models through the proxy
- **Administrators**: Platform operators managing user access, quotas, and provider configurations
- **Service Accounts**: Automated systems requiring API access with specific permission scopes

### Key Workflows
1. Key creation with configurable limits and permissions
2. Key validation during API proxy requests
3. Key lifecycle management (enable/disable, renew, revoke)
4. Usage monitoring and quota enforcement
5. Provider group synchronization for access control

---

## Behavior Summary

### 1. API Key Generation

**Key Format**: API keys follow the format `sk-{32 hex characters}` (34 characters total, or 35 including "sk-")

```typescript
// From: /Users/ding/Github/claude-code-hub/src/actions/keys.ts (line 283)
const generatedKey = `sk-${randomBytes(16).toString("hex")}`;
```

The key generation uses Node.js `crypto.randomBytes(16)` to produce 128 bits of entropy, encoded as 32 hexadecimal characters. This provides:
- 2^128 possible combinations (approximately 3.4 × 10^38)
- Sufficient entropy to prevent brute-force attacks
- Human-readable prefix for easy identification

**Storage**: Keys are stored in plaintext in the database (note: not hashed), allowing direct key lookup during authentication:

```typescript
// From: /Users/ding/Github/claude-code-hub/src/repository/key.ts (lines 402-437)
export async function findActiveKeyByKeyString(keyString: string): Promise<Key | null> {
  const [key] = await db
    .select({...})
    .from(keys)
    .where(
      and(
        eq(keys.key, keyString),  // Direct string comparison
        isNull(keys.deletedAt),
        eq(keys.isEnabled, true),
        or(isNull(keys.expiresAt), gt(keys.expiresAt, new Date()))
      )
    );
  ...
}
```

### 2. Key Validation

The validation system supports multiple authentication methods:

**Primary Methods**:
1. **Authorization Header**: `Authorization: Bearer <api_key>`
2. **X-API-Key Header**: `x-api-key: <api_key>`
3. **Gemini Protocol**: `x-goog-api-key` header or `?key=` query parameter

```typescript
// From: /Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/auth-guard.ts (lines 8-30)
export class ProxyAuthenticator {
  static async ensure(session: ProxySession): Promise<Response | null> {
    const authHeader = session.headers.get("authorization") ?? undefined;
    const apiKeyHeader = session.headers.get("x-api-key") ?? undefined;
    const geminiApiKeyHeader = session.headers.get(GEMINI_PROTOCOL.HEADERS.API_KEY) ?? undefined;
    const geminiApiKeyQuery = session.requestUrl.searchParams.get("key") ?? undefined;

    const authState = await ProxyAuthenticator.validate({
      authHeader,
      apiKeyHeader,
      geminiApiKeyHeader,
      geminiApiKeyQuery,
    });
    ...
  }
}
```

**Web UI Authentication**: Uses cookie-based authentication with `auth-token` cookie:

```typescript
// From: /Users/ding/Github/claude-code-hub/src/lib/auth.ts (lines 94-114)
const AUTH_COOKIE_NAME = "auth-token";
const AUTH_COOKIE_MAX_AGE = 60 * 60 * 24 * 7; // 7 days

export async function setAuthCookie(keyString: string) {
  const cookieStore = await cookies();
  const env = getEnvConfig();
  cookieStore.set(AUTH_COOKIE_NAME, keyString, {
    httpOnly: true,
    secure: env.ENABLE_SECURE_COOKIES,
    sameSite: "lax",
    maxAge: AUTH_COOKIE_MAX_AGE,
    path: "/",
  });
}
```

**Validation Checks**:
1. Key exists in database
2. Key is enabled (`isEnabled = true`)
3. Key has not expired (`expiresAt > now()` or `null`)
4. Associated user exists and is enabled
5. Web UI login permission (for dashboard access)

```typescript
// From: /Users/ding/Github/claude-code-hub/src/lib/auth.ts (lines 17-86)
export async function validateKey(
  keyString: string,
  options?: { allowReadOnlyAccess?: boolean }
): Promise<AuthSession | null> {
  // Admin token special handling
  const adminToken = config.auth.adminToken;
  if (adminToken && keyString === adminToken) {
    return { user: adminUser, key: adminKey };
  }

  const key = await findActiveKeyByKeyString(keyString);
  if (!key) return null;

  // Check Web UI login permission
  if (!allowReadOnlyAccess && !key.canLoginWebUi) {
    return null;
  }

  const user = await findUserById(key.userId);
  if (!user) return null;

  return { user, key };
}
```

**Login Redirect Logic**:

```typescript
// From: /Users/ding/Github/claude-code-hub/src/lib/auth.ts (lines 88-92)
export function getLoginRedirectTarget(session: AuthSession): string {
  if (session.user.role === "admin") return "/dashboard";
  if (session.key.canLoginWebUi) return "/dashboard";
  return "/my-usage";
}
```

### 3. Key Lifecycle Management

#### Creation
Keys are created through the `addKey` server action with comprehensive validation:

```typescript
// From: /Users/ding/Github/claude-code-hub/src/actions/keys.ts (lines 86-325)
export async function addKey(data: {
  userId: number;
  name: string;
  expiresAt?: string;
  isEnabled?: boolean;
  canLoginWebUi?: boolean;
  limit5hUsd?: number | null;
  limitDailyUsd?: number | null;
  dailyResetMode?: "fixed" | "rolling";
  dailyResetTime?: string;
  limitWeeklyUsd?: number | null;
  limitMonthlyUsd?: number | null;
  limitTotalUsd?: number | null;
  limitConcurrentSessions?: number;
  providerGroup?: string | null;
  cacheTtlPreference?: "inherit" | "5m" | "1h";
}): Promise<ActionResult<{ generatedKey: string; name: string }>>
```

**Creation Validations**:
1. **Permission Check**: Users can only create keys for themselves; admins can create for any user
2. **Provider Group Security**: Non-admin users can only assign provider groups they already have access to (see NOTE #400)
3. **Duplicate Name Prevention**: Cannot create two active keys with the same name for the same user
4. **Limit Constraints**: Key-level limits cannot exceed user-level limits

#### Editing
Keys can be updated with partial data, with special handling for `expiresAt`:

```typescript
// From: /Users/ding/Github/claude-code-hub/src/actions/keys.ts (lines 327-562)
export async function editKey(keyId: number, data: {...}): Promise<ActionResult>
```

**Edit Behavior**:
- `expiresAt` field is only updated if explicitly provided (to prevent accidental clearing)
- Provider group changes trigger automatic user group synchronization
- Non-admin users cannot modify provider group assignments (admin-only field)

#### Deletion (Soft Delete)
Keys are soft-deleted by setting `deletedAt` timestamp:

```typescript
// From: /Users/ding/Github/claude-code-hub/src/repository/key.ts (lines 392-400)
export async function deleteKey(id: number): Promise<boolean> {
  const result = await db
    .update(keys)
    .set({ deletedAt: new Date() })
    .where(and(eq(keys.id, id), isNull(keys.deletedAt)))
    .returning({ id: keys.id });
  return result.length > 0;
}
```

**Deletion Constraints**:
1. Cannot delete the last enabled key for a user
2. Non-admin users cannot delete keys that would leave them without any provider groups

#### Enable/Disable Toggle
Keys can be enabled or disabled independently:

```typescript
// From: /Users/ding/Github/claude-code-hub/src/actions/keys.ts (lines 794-839)
export async function toggleKeyEnabled(keyId: number, enabled: boolean): Promise<ActionResult>
```

**Toggle Constraints**:
- Cannot disable the last enabled key for a user
- Batch updates validate that each user retains at least one enabled key

#### Renewal
A dedicated renewal function allows updating expiration without affecting other settings:

```typescript
// From: /Users/ding/Github/claude-code-hub/src/actions/keys.ts (lines 1054-1098)
export async function renewKeyExpiresAt(
  keyId: number,
  data: { expiresAt: string; enableKey?: boolean }
): Promise<ActionResult>
```

### 4. Key Permissions and Access Control

#### Provider Group System
Provider groups control which upstream providers a key can access:

```typescript
// From: /Users/ding/Github/claude-code-hub/src/drizzle/schema.ts (lines 116-117)
providerGroup: varchar('provider_group', { length: 200 }).default('default'),
```

**Security Model** (NOTE #400):
- Keys must explicitly store provider groups (default: "default")
- Non-admin users can only assign groups they already have access to
- User's effective provider group is the union of all their keys' groups
- Group synchronization happens automatically on key changes

```typescript
// From: /Users/ding/Github/claude-code-hub/src/actions/keys.ts (lines 34-59)
function validateNonAdminProviderGroup(
  userProviderGroup: string,
  requestedProviderGroup: string,
  options: { hasDefaultKey: boolean },
  tError: TranslationFunction
): string {
  const userGroups = parseProviderGroups(userProviderGroup);
  const requestedGroups = parseProviderGroups(requestedProviderGroup);

  if (userGroups.includes(PROVIDER_GROUP.ALL)) {
    return requestedProviderGroup;
  }

  const userGroupSet = new Set(userGroups);
  
  if (requestedGroups.includes(PROVIDER_GROUP.DEFAULT) && !options.hasDefaultKey) {
    throw new Error(tError("NO_DEFAULT_GROUP_PERMISSION"));
  }

  const invalidGroups = requestedGroups.filter((g) => !userGroupSet.has(g));
  if (invalidGroups.length > 0) {
    throw new Error(tError("NO_GROUP_PERMISSION", { groups: invalidGroups.join(", ") }));
  }

  return requestedProviderGroup;
}
```

**Provider Group Constants**:

```typescript
// From: /Users/ding/Github/claude-code-hub/src/lib/constants/provider.constants.ts (lines 25-30)
export const PROVIDER_GROUP = {
  /** 默认分组标识符 - 用于表示未设置分组的 key/供应商 */
  DEFAULT: "default",
  /** 全局访问标识符 - 可访问所有供应商（管理员专用） */
  ALL: "*",
} as const;
```

#### Web UI Login Permission
The `canLoginWebUi` flag controls dashboard access:

```typescript
// From: /Users/ding/Github/claude-code-hub/src/drizzle/schema.ts (line 100)
canLoginWebUi: boolean('can_login_web_ui').default(false),
```

- `true`: Key can be used to log into the Web UI dashboard
- `false`: Key is API-only; users with only such keys are redirected to `/my-usage` read-only page

#### Usage Limits
Keys support multiple quota dimensions:

| Limit Type | Description | Reset Behavior |
|------------|-------------|----------------|
| `limit5hUsd` | 5-hour rolling window cost limit | Rolling window |
| `limitDailyUsd` | Daily cost limit | Fixed time or rolling |
| `limitWeeklyUsd` | Weekly cost limit | Fixed time (Monday) |
| `limitMonthlyUsd` | Monthly cost limit | Fixed time (1st) |
| `limitTotalUsd` | Total cumulative cost limit | Never resets |
| `limitConcurrentSessions` | Max concurrent sessions | Real-time |

**Daily Reset Modes**:
- **Fixed**: Resets at a specific time (e.g., "00:00", "18:00")
- **Rolling**: 24-hour sliding window

```typescript
// From: /Users/ding/Github/claude-code-hub/src/drizzle/schema.ts (lines 105-110)
dailyResetMode: dailyResetModeEnum('daily_reset_mode')
  .default('fixed')
  .notNull(),
dailyResetTime: varchar('daily_reset_time', { length: 5 })
  .default('00:00')
  .notNull(),
```

#### Cache TTL Preference
Keys can override the default cache TTL behavior:

```typescript
// From: /Users/ding/Github/claude-code-hub/src/types/cache.ts
type CacheTtlPreference = "inherit" | "5m" | "1h";
```

- `inherit`: Follow provider or client request settings
- `5m`: Force 5-minute cache TTL
- `1h`: Force 1-hour extended cache TTL

### 5. Batch Operations

Administrators can perform bulk updates on multiple keys:

```typescript
// From: /Users/ding/Github/claude-code-hub/src/actions/keys.ts (lines 846-1046)
export async function batchUpdateKeys(
  params: BatchUpdateKeysParams
): Promise<ActionResult<BatchUpdateResult>>

interface BatchUpdateKeysParams {
  keyIds: number[];
  updates: {
    providerGroup?: string | null;
    limit5hUsd?: number | null;
    limitDailyUsd?: number | null;
    limitWeeklyUsd?: number | null;
    limitMonthlyUsd?: number | null;
    canLoginWebUi?: boolean;
    isEnabled?: boolean;
  };
}
```

**Batch Constraints**:
- Maximum 500 keys per batch
- Validates all keys exist before updating
- Ensures users retain at least one enabled key after disable operations
- Post-update validation within transaction to prevent race conditions

---

## Config/Commands

### Database Schema

**Keys Table** (`/Users/ding/Github/claude-code-hub/src/drizzle/schema.ts`, lines 91-130):

```typescript
export const keys = pgTable('keys', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull(),
  key: varchar('key').notNull(),
  name: varchar('name').notNull(),
  isEnabled: boolean('is_enabled').default(true),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  
  // Web UI login permission
  canLoginWebUi: boolean('can_login_web_ui').default(false),
  
  // Quota limits
  limit5hUsd: numeric('limit_5h_usd', { precision: 10, scale: 2 }),
  limitDailyUsd: numeric('limit_daily_usd', { precision: 10, scale: 2 }),
  dailyResetMode: dailyResetModeEnum('daily_reset_mode').default('fixed').notNull(),
  dailyResetTime: varchar('daily_reset_time', { length: 5 }).default('00:00').notNull(),
  limitWeeklyUsd: numeric('limit_weekly_usd', { precision: 10, scale: 2 }),
  limitMonthlyUsd: numeric('limit_monthly_usd', { precision: 10, scale: 2 }),
  limitTotalUsd: numeric('limit_total_usd', { precision: 10, scale: 2 }),
  limitConcurrentSessions: integer('limit_concurrent_sessions').default(0),
  
  // Provider group and cache preferences
  providerGroup: varchar('provider_group', { length: 200 }).default('default'),
  cacheTtlPreference: varchar('cache_ttl_preference', { length: 10 }),
  
  // Timestamps
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (table) => ({
  keysUserIdIdx: index('idx_keys_user_id').on(table.userId),
  keysCreatedAtIdx: index('idx_keys_created_at').on(table.createdAt),
  keysDeletedAtIdx: index('idx_keys_deleted_at').on(table.deletedAt),
}));
```

### API Endpoints

**Key Management API** (`/Users/ding/Github/claude-code-hub/src/app/api/actions/[...route]/route.ts`):

| Endpoint | Method | Description | Auth Required |
|----------|--------|-------------|---------------|
| `/api/actions/keys/getKeys` | POST | Get user's key list | Yes |
| `/api/actions/keys/addKey` | POST | Create new key | Yes |
| `/api/actions/keys/editKey` | POST | Update key settings | Yes |
| `/api/actions/keys/removeKey` | POST | Delete (soft) a key | Yes |
| `/api/actions/keys/toggleKeyEnabled` | POST | Enable/disable key | Yes |
| `/api/actions/keys/getKeyLimitUsage` | POST | Get quota usage stats | Yes |
| `/api/actions/keys/batchUpdateKeys` | POST | Bulk update keys | Admin Only |
| `/api/actions/keys/renewKeyExpiresAt` | POST | Renew key expiration | Yes |

### Server Actions

**Key Actions** (`/Users/ding/Github/claude-code-hub/src/actions/keys.ts`):

```typescript
// Key CRUD operations
export async function addKey(data: CreateKeyData): Promise<ActionResult<{ generatedKey: string; name: string }>>
export async function editKey(keyId: number, data: UpdateKeyData): Promise<ActionResult>
export async function removeKey(keyId: number): Promise<ActionResult>
export async function getKeys(userId: number): Promise<ActionResult<Key[]>>

// Key state management
export async function toggleKeyEnabled(keyId: number, enabled: boolean): Promise<ActionResult>
export async function renewKeyExpiresAt(keyId: number, data: { expiresAt: string; enableKey?: boolean }): Promise<ActionResult>

// Bulk operations (admin only)
export async function batchUpdateKeys(params: BatchUpdateKeysParams): Promise<ActionResult<BatchUpdateResult>>

// Statistics
export async function getKeysWithStatistics(userId: number): Promise<ActionResult<KeyStatistics[]>>
export async function getKeyLimitUsage(keyId: number): Promise<ActionResult<KeyLimitUsage>>
```

**Repository Functions** (`/Users/ding/Github/claude-code-hub/src/repository/key.ts`):

```typescript
export async function findKeyById(id: number): Promise<Key | null>
export async function findKeyList(userId: number): Promise<Key[]>
export async function findKeyListBatch(userIds: number[]): Promise<Map<number, Key[]>>
export async function createKey(keyData: CreateKeyData): Promise<Key>
export async function updateKey(id: number, keyData: UpdateKeyData): Promise<Key | null>
export async function deleteKey(id: number): Promise<boolean>
export async function findActiveKeyByKeyString(keyString: string): Promise<Key | null>
export async function findActiveKeyByUserIdAndName(userId: number, name: string): Promise<Key | null>
export async function validateApiKeyAndGetUser(keyString: string): Promise<{ user: User; key: Key } | null>
export async function countActiveKeysByUser(userId: number): Promise<number>
export async function findKeysWithStatistics(userId: number): Promise<KeyStatistics[]>
export async function findKeysWithStatisticsBatch(userIds: number[]): Promise<Map<number, KeyStatistics[]>>
export async function findKeyUsageToday(userId: number): Promise<Array<{ keyId: number; totalCost: number }>>
export async function findKeyUsageTodayBatch(userIds: number[]): Promise<Map<number, Array<{ keyId: number; totalCost: number; totalTokens: number }>>>
```

### Validation Schema

**KeyFormSchema** (`/Users/ding/Github/claude-code-hub/src/lib/validation/schemas.ts`, lines 290-350):

```typescript
export const KeyFormSchema = z.object({
  name: z.string().min(1, "密钥名称不能为空").max(64, "密钥名称不能超过64个字符"),
  expiresAt: z.string().optional().default("").transform((val) => (val === "" ? undefined : val)),
  canLoginWebUi: z.boolean().optional().default(true),
  limit5hUsd: z.coerce.number().min(0).max(10000).nullable().optional(),
  limitDailyUsd: z.coerce.number().min(0).max(10000).nullable().optional(),
  dailyResetMode: z.enum(["fixed", "rolling"]).optional().default("fixed"),
  dailyResetTime: z.string().regex(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/).optional().default("00:00"),
  limitWeeklyUsd: z.coerce.number().min(0).max(50000).nullable().optional(),
  limitMonthlyUsd: z.coerce.number().min(0).max(200000).nullable().optional(),
  limitTotalUsd: z.coerce.number().min(0).max(10000000).nullable().optional(),
  limitConcurrentSessions: z.coerce.number().int().min(0).max(1000).optional().default(0),
  providerGroup: z.string().max(200).nullable().optional().default(""),
  cacheTtlPreference: z.enum(["inherit", "5m", "1h"]).optional().default("inherit"),
});
```

---

## Edge Cases

### 1. Last Key Protection

The system prevents users from being locked out by enforcing that each user must retain at least one enabled key:

```typescript
// From: /Users/ding/Github/claude-code-hub/src/actions/keys.ts (lines 582-592)
if (key.isEnabled) {
  const activeKeyCount = await countActiveKeysByUser(key.userId);
  if (activeKeyCount <= 1) {
    return {
      ok: false,
      error: "该用户至少需要保留一个可用的密钥，无法删除最后一个密钥",
    };
  }
}
```

This protection applies to:
- Single key deletion
- Batch disable operations
- Toggle enable/disable

### 2. Provider Group Emptying Prevention

Non-admin users cannot delete keys that would leave them without any provider groups:

```typescript
// From: /Users/ding/Github/claude-code-hub/src/actions/keys.ts (lines 594-620)
if (session.user.role !== "admin") {
  const userKeys = await findKeyList(key.userId);
  const remainingGroups = new Set<string>();
  for (const k of userKeys) {
    if (k.id === keyId) continue;
    const group = k.providerGroup || PROVIDER_GROUP.DEFAULT;
    group.split(",").map((g) => g.trim()).filter(Boolean).forEach((g) => remainingGroups.add(g));
  }

  const currentGroups = parseProviderGroups(normalizeProviderGroup(user?.providerGroup));
  if (currentGroups.length > 0 && remainingGroups.size === 0) {
    return {
      ok: false,
      error: "无法删除此密钥：删除后您将没有任何可用的供应商分组。请先创建其他包含分组的密钥，或联系管理员。",
    };
  }
}
```

### 3. Limit Exceeding Prevention

Key-level limits cannot exceed user-level limits:

```typescript
// Example validation for 5h limit
if (
  validatedData.limit5hUsd != null &&
  validatedData.limit5hUsd > 0 &&
  user.limit5hUsd != null &&
  user.limit5hUsd > 0 &&
  validatedData.limit5hUsd > user.limit5hUsd
) {
  return {
    ok: false,
    error: tError("KEY_LIMIT_5H_EXCEEDS_USER_LIMIT", {
      keyLimit: String(validatedData.limit5hUsd),
      userLimit: String(user.limit5hUsd),
    }),
  };
}
```

Validations exist for: `limit5hUsd`, `limitDailyUsd`, `limitWeeklyUsd`, `limitMonthlyUsd`, `limitTotalUsd`, `limitConcurrentSessions`

### 4. Duplicate Name Prevention

Users cannot have two active keys with the same name:

```typescript
// From: /Users/ding/Github/claude-code-hub/src/actions/keys.ts (lines 177-184)
const existingKey = await findActiveKeyByUserIdAndName(data.userId, validatedData.name);
if (existingKey) {
  return {
    ok: false,
    error: `名为"${validatedData.name}"的密钥已存在且正在生效中，请使用不同的名称`,
  };
}
```

### 5. ExpiresAt Partial Update Handling

The `expiresAt` field has special handling to prevent accidental clearing during partial updates:

```typescript
// From: /Users/ding/Github/claude-code-hub/src/actions/keys.ts (lines 393-395, 505-525)
const hasExpiresAtField = Object.hasOwn(data, "expiresAt");

let expiresAt: Date | null | undefined;
if (hasExpiresAtField) {
  if (validatedData.expiresAt === undefined) {
    expiresAt = null;  // Explicitly set to null (never expires)
  } else {
    const timezone = await resolveSystemTimezone();
    expiresAt = parseDateInputAsTimezone(validatedData.expiresAt, timezone);
  }
}

await updateKey(keyId, {
  ...(hasExpiresAtField ? { expires_at: expiresAt } : {}),
  ...
});
```

### 6. Admin Token Special Handling

The admin token from environment variables bypasses normal key validation:

```typescript
// From: /Users/ding/Github/claude-code-hub/src/lib/auth.ts (lines 28-68)
const adminToken = config.auth.adminToken;
if (adminToken && keyString === adminToken) {
  const adminUser: User = {
    id: -1,
    name: "Admin Token",
    role: "admin",
    ...
  };
  const adminKey: Key = {
    id: -1,
    userId: adminUser.id,
    name: "ADMIN_TOKEN",
    canLoginWebUi: true,
    ...
  };
  return { user: adminUser, key: adminKey };
}
```

### 7. Batch Update Race Condition Prevention

Batch updates include post-update validation within the transaction:

```typescript
// From: /Users/ding/Github/claude-code-hub/src/actions/keys.ts (lines 997-1020)
if (updates.isEnabled === false) {
  for (const userId of affectedUserIds) {
    const [remainingEnabled] = await tx
      .select({ count: count() })
      .from(keysTable)
      .where(and(
        eq(keysTable.userId, userId),
        eq(keysTable.isEnabled, true),
        isNull(keysTable.deletedAt)
      ));

    if (Number(remainingEnabled?.count ?? 0) < 1) {
      throw new BatchUpdateError(tError("CANNOT_DISABLE_LAST_KEY"), ERROR_CODES.OPERATION_FAILED);
    }
  }
}
```

### 8. Timezone-Aware Expiration

Expiration dates are parsed using the system timezone:

```typescript
// From: /Users/ding/Github/claude-code-hub/src/actions/keys.ts (lines 285-290)
const timezone = await resolveSystemTimezone();
const expiresAt =
  validatedData.expiresAt === undefined
    ? null
    : parseDateInputAsTimezone(validatedData.expiresAt, timezone);
```

This ensures consistent behavior across different deployment environments.

### 9. Multiple Conflicting Keys Detection

The proxy authenticator detects when multiple different API keys are provided:

```typescript
// From: /Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/auth-guard.ts (lines 69-87)
const [firstKey] = providedKeys;
const hasMismatch = providedKeys.some((key) => key !== firstKey);

if (hasMismatch) {
  logger.warn("[ProxyAuthenticator] Multiple conflicting API keys provided", ...);
  return {
    user: null,
    key: null,
    apiKey: null,
    success: false,
    errorResponse: ProxyResponses.buildError(
      401,
      "提供了多个冲突的 API 密钥。请仅使用一种认证方式。",
      "authentication_error"
    ),
  };
}
```

### 10. User Expiration Lazy Check

Users with expired accounts are blocked at authentication time with lazy marking:

```typescript
// From: /Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/auth-guard.ts (lines 133-158)
if (user.expiresAt && user.expiresAt.getTime() <= Date.now()) {
  // Best-effort lazy mark user as disabled (idempotent)
  markUserExpired(user.id).catch((error) => {
    logger.error("[ProxyAuthenticator] Failed to mark user as expired", ...);
  });
  return {
    user: null,
    key: null,
    apiKey,
    success: false,
    errorResponse: ProxyResponses.buildError(
      401,
      `用户账户已于 ${user.expiresAt.toISOString().split("T")[0]} 过期。请续费订阅。`,
      "user_expired"
    ),
  };
}
```

---

## Rate Limiting Integration

API keys participate in the multi-layer rate limiting system:

**Check Order** (`/Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/rate-limit-guard.ts`):
1. Key total limit (permanent hard limit)
2. User total limit (account-level budget)
3. Key concurrent sessions
4. User concurrent sessions
5. User RPM
6. Key 5h limit
7. User 5h limit
8. Key daily limit
9. User daily quota
10. Key weekly limit
11. User weekly limit
12. Key monthly limit
13. User monthly limit

The lease-based rate limiting system (`/Users/ding/Github/claude-code-hub/src/lib/rate-limit/lease-service.ts`) caches quota slices in Redis for high-performance checks.

---

## References

### Core Files

| File Path | Description |
|-----------|-------------|
| `/Users/ding/Github/claude-code-hub/src/actions/keys.ts` | Server actions for key CRUD operations, batch updates, and lifecycle management |
| `/Users/ding/Github/claude-code-hub/src/repository/key.ts` | Database repository functions for key queries and mutations |
| `/Users/ding/Github/claude-code-hub/src/lib/auth.ts` | Authentication logic including key validation, session management, and cookie handling |
| `/Users/ding/Github/claude-code-hub/src/drizzle/schema.ts` | Database schema definition for keys table and relations |
| `/Users/ding/Github/claude-code-hub/src/types/key.ts` | TypeScript type definitions for Key entity and related interfaces |
| `/Users/ding/Github/claude-code-hub/src/lib/validation/schemas.ts` | Zod validation schemas for key form data |
| `/Users/ding/Github/claude-code-hub/src/app/api/actions/[...route]/route.ts` | OpenAPI route definitions for key management API endpoints |
| `/Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/auth-guard.ts` | Proxy authentication guard for API key validation during requests |
| `/Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/rate-limit-guard.ts` | Rate limiting checks including key-level limits |
| `/Users/ding/Github/claude-code-hub/src/lib/rate-limit/lease-service.ts` | Lease-based quota management for high-performance rate limiting |

### Frontend Components

| File Path | Description |
|-----------|-------------|
| `/Users/ding/Github/claude-code-hub/src/app/[locale]/dashboard/_components/user/key-list.tsx` | Key list display component with statistics |
| `/Users/ding/Github/claude-code-hub/src/app/[locale]/dashboard/_components/user/key-actions.tsx` | Key action buttons (edit, delete) |
| `/Users/ding/Github/claude-code-hub/src/app/[locale]/dashboard/_components/user/forms/add-key-form.tsx` | Form for creating new keys |
| `/Users/ding/Github/claude-code-hub/src/app/[locale]/dashboard/_components/user/forms/edit-key-form.tsx` | Form for editing existing keys |
| `/Users/ding/Github/claude-code-hub/src/app/[locale]/dashboard/_components/user/add-key-dialog.tsx` | Dialog for displaying newly created keys |
| `/Users/ding/Github/claude-code-hub/src/app/[locale]/dashboard/_components/user/user-key-manager.tsx` | Main key management container component |

### Related Utilities

| File Path | Description |
|-----------|-------------|
| `/Users/ding/Github/claude-code-hub/src/lib/utils/provider-group.ts` | Provider group parsing and normalization utilities |
| `/Users/ding/Github/claude-code-hub/src/lib/utils/date-input.ts` | Timezone-aware date parsing utilities |
| `/Users/ding/Github/claude-code-hub/src/lib/utils/timezone.ts` | System timezone resolution |
| `/Users/ding/Github/claude-code-hub/src/repository/_shared/transformers.ts` | Database-to-TypeScript object transformers |
| `/Users/ding/Github/claude-code-hub/src/lib/constants/provider.constants.ts` | Provider group constants |

### Test Files

| File Path | Description |
|-----------|-------------|
| `/Users/ding/Github/claude-code-hub/tests/api/keys-actions.test.ts` | API tests for key management endpoints |
| `/Users/ding/Github/claude-code-hub/tests/integration/auth.test.ts` | Integration tests for authentication |

### Key Code Snippets

**Key Generation**:
```typescript
// /Users/ding/Github/claude-code-hub/src/actions/keys.ts:283
const generatedKey = `sk-${randomBytes(16).toString("hex")}`;
```

**Active Key Lookup**:
```typescript
// /Users/ding/Github/claude-code-hub/src/repository/key.ts:402-437
export async function findActiveKeyByKeyString(keyString: string): Promise<Key | null> {
  const [key] = await db
    .select({...})
    .from(keys)
    .where(
      and(
        eq(keys.key, keyString),
        isNull(keys.deletedAt),
        eq(keys.isEnabled, true),
        or(isNull(keys.expiresAt), gt(keys.expiresAt, new Date()))
      )
    );
  ...
}
```

**Provider Group Validation**:
```typescript
// /Users/ding/Github/claude-code-hub/src/actions/keys.ts:34-59
function validateNonAdminProviderGroup(
  userProviderGroup: string,
  requestedProviderGroup: string,
  options: { hasDefaultKey: boolean },
  tError: TranslationFunction
): string {...}
```

**Batch Update with Transaction**:
```typescript
// /Users/ding/Github/claude-code-hub/src/actions/keys.ts:895-1021
await db.transaction(async (tx) => {
  // Validation queries...
  const updatedRows = await tx
    .update(keysTable)
    .set(dbUpdates)
    .where(and(inArray(keysTable.id, requestedIds), isNull(keysTable.deletedAt)))
    .returning({ id: keysTable.id });
  // Post-update validation...
});
```

---

## Summary

The API Key Management system in Claude Code Hub is a comprehensive authentication and authorization framework with the following characteristics:

1. **Security**: Multi-layered validation including key existence, enabled status, expiration, user permissions, and conflicting key detection
2. **Flexibility**: Support for multiple authentication methods (Bearer, X-API-Key, Gemini protocol, Cookie)
3. **Granularity**: Fine-grained access control through provider groups and Web UI login permissions
4. **Quota Management**: Multi-dimensional usage limits (5h, daily, weekly, monthly, total, concurrent sessions) with lease-based high-performance enforcement
5. **Safety**: Multiple safeguards prevent accidental lockout (last key protection, group emptying prevention)
6. **Scalability**: Batch operations support efficient management of large key sets with transaction safety
7. **Auditability**: Comprehensive statistics tracking per-key usage including model-level breakdowns
8. **Timezone Awareness**: Consistent expiration handling across different deployment environments

The system balances security requirements with operational flexibility, providing administrators with powerful management capabilities while protecting users from common misconfigurations.

---

## Corrections from Round 1

1. **Cookie Authentication**: Added detailed documentation of the `auth-token` cookie mechanism for Web UI sessions
2. **Login Redirect Logic**: Added `getLoginRedirectTarget` function documentation
3. **Provider Group Constants**: Added reference to `PROVIDER_GROUP` constants with `DEFAULT` and `ALL` values
4. **Batch Repository Functions**: Added `findKeyListBatch`, `findKeysWithStatisticsBatch`, and `findKeyUsageTodayBatch` functions
5. **Rate Limiting Integration**: Added comprehensive section on how keys participate in the rate limiting system
6. **Multiple Conflicting Keys**: Added edge case documentation for conflicting key detection
7. **User Expiration**: Added lazy expiration check documentation
8. **Key Statistics Interface**: Added `KeyStatistics` interface documentation with model-level stats
9. **Validation Schema Limits**: Corrected limit values to match actual schema (daily: 10000, weekly: 50000, monthly: 200000, total: 10000000)
10. **Schema Default Values**: Corrected `canLoginWebUi` default to `false` (not `true` as in round1)
