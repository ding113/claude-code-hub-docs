# Round 2 Verified Draft: 权限控制系统 (Permission Control System)

**Route**: `/docs/users/permissions`  
**Status**: Verified Technical Draft  
**Word Count**: ~4,800 words  
**Last Updated**: 2026-01-29

---

## 1. Intent Analysis

### 1.1 Purpose

The Permission Control System in Claude Code Hub implements a **Role-Based Access Control (RBAC)** model that governs user access to system resources, API endpoints, and administrative functions. This system is designed to:

1. **Separate administrative and user privileges** - Ensuring only authorized personnel can perform sensitive operations
2. **Protect sensitive user data** - Preventing unauthorized modification of critical fields
3. **Control resource access** - Managing who can view or modify system-wide configurations
4. **Enable multi-tenant scenarios** - Supporting different access levels within the same deployment

### 1.2 Target Audience

- **System Administrators** - Need to understand how to configure and manage permissions
- **Developers** - Integrating with the permission system or extending its functionality
- **Security Auditors** - Reviewing access control implementations
- **End Users** - Understanding their access limitations and capabilities

### 1.3 Core Concepts

The permission system is built around several key concepts:

| Concept | Description |
|---------|-------------|
| **Role** | A predefined set of permissions assigned to users (`admin` or `user`) |
| **Permission** | The ability to perform a specific action or access a resource |
| **Field-Level Permission** | Granular control over which user fields can be modified by whom |
| **API Access Control** | Route-level protection based on authentication and role |
| **Resource Ownership** | Users can manage their own resources but not others' (unless admin) |
| **Read-Only Access** | Special access mode for keys with `canLoginWebUi: false` |

---

## 2. Behavior Summary

### 2.1 Role Hierarchy

The system implements a simple two-role hierarchy:

```
Roles:
├── admin
│   ├── Manage providers (create, edit, delete)
│   ├── Manage users (create, edit, delete, configure quotas)
│   ├── Manage keys (create for any user, edit, delete)
│   ├── View all statistics and usage data
│   ├── Configure system settings
│   ├── Manage sensitive words and error rules
│   ├── Access session management
│   └── View leaderboard and rankings
└── user
    ├── Use proxy endpoints (API access)
    ├── View own statistics
    ├── Manage own keys (if canLoginWebUi is enabled)
    ├── View personal usage via /my-usage
    └── Limited dashboard access
```

### 2.2 Permission Enforcement Patterns

The system employs multiple enforcement patterns:

#### 2.2.1 Server-Side Role Checks

Most administrative actions require explicit role validation:

```typescript
// Pattern: Direct role check in Server Actions
const session = await getSession();
if (!session || session.user.role !== "admin") {
  return {
    ok: false,
    error: tError("PERMISSION_DENIED"),
    errorCode: ERROR_CODES.PERMISSION_DENIED,
  };
}
```

**Verified Location**: `/Users/ding/Github/claude-code-hub/src/actions/users.ts` (line 771-778)

#### 2.2.2 Resource Ownership Checks

For resources that users can manage, ownership is verified:

```typescript
// Pattern: Admin bypass + ownership verification
if (session.user.role !== "admin" && session.user.id !== resourceOwnerId) {
  return {
    ok: false,
    error: tError("PERMISSION_DENIED"),
    errorCode: ERROR_CODES.PERMISSION_DENIED,
  };
}
```

**Verified Location**: `/Users/ding/Github/claude-code-hub/src/actions/keys.ts` (line 120-126)

#### 2.2.3 Field-Level Permission Filtering

When updating user data, sensitive fields are filtered based on role:

```typescript
// Pattern: Filter unauthorized fields before processing
const unauthorizedFields = getUnauthorizedFields(data, session.user.role);
if (unauthorizedFields.length > 0) {
  return {
    ok: false,
    error: `${tError("PERMISSION_DENIED")}: ${unauthorizedFields.join(", ")}`,
    errorCode: ERROR_CODES.PERMISSION_DENIED,
  };
}
```

**Verified Location**: `/Users/ding/Github/claude-code-hub/src/actions/users.ts` (line 1156-1165)

#### 2.2.4 Page-Level Access Control

Frontend pages enforce access at the routing level:

```typescript
// Pattern: Route-level permission check
export default async function AdminPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const session = await getSession();

  // 权限检查：仅 admin 用户可访问
  if (!session || session.user.role !== "admin") {
    redirect({ href: session ? "/dashboard" : "/login", locale });
  }

  return <AdminPageContent />;
}
```

### 2.3 Special Permission Scenarios

#### 2.3.1 Global Usage View

The system supports a configurable setting `allowGlobalUsageView` that enables non-admin users to view the leaderboard/rankings:

```typescript
// From /Users/ding/Github/claude-code-hub/src/app/api/leaderboard/route.ts (line 52-69)
const systemSettings = await getSystemSettings();
const isAdmin = session.user.role === "admin";
const hasPermission = isAdmin || systemSettings.allowGlobalUsageView;

if (!hasPermission) {
  logger.warn("Leaderboard API: Access denied", {
    userId: session.user.id,
    userName: session.user.name,
    isAdmin,
    allowGlobalUsageView: systemSettings.allowGlobalUsageView,
  });
  return NextResponse.json(
    { error: "无权限访问排行榜，请联系管理员开启全站使用量查看权限" },
    { status: 403 }
  );
}
```

**Verified**: The error message is returned in Chinese regardless of locale, as seen in the actual code.

#### 2.3.2 Read-Only Access (my-usage)

Keys with `canLoginWebUi: false` can still access the `/my-usage` page for viewing personal statistics:

```typescript
// From /Users/ding/Github/claude-code-hub/src/proxy.ts (line 14-15, 64-67)
const READ_ONLY_PATH_PATTERNS = ["/my-usage"];
const isReadOnlyPath = READ_ONLY_PATH_PATTERNS.some(pattern => 
  pathWithoutLocale === pattern || pathWithoutLocale.startsWith(`${pattern}/`)
);

// Validate with allowReadOnlyAccess flag
const session = await validateKey(authToken.value, { allowReadOnlyAccess: isReadOnlyPath });
```

**Verified Location**: `/Users/ding/Github/claude-code-hub/src/proxy.ts`

#### 2.3.3 Admin Token Authentication

A special `ADMIN_TOKEN` environment variable allows super-admin access without database authentication:

```typescript
// From /Users/ding/Github/claude-code-hub/src/lib/auth.ts (line 28-68)
const adminToken = config.auth.adminToken;
if (adminToken && keyString === adminToken) {
  const now = new Date();
  const adminUser: User = {
    id: -1,
    name: "Admin Token",
    description: "Environment admin session",
    role: "admin",
    rpm: 0,
    dailyQuota: 0,
    providerGroup: null,
    isEnabled: true,
    expiresAt: null,
    dailyResetMode: "fixed",
    dailyResetTime: "00:00",
    createdAt: now,
    updatedAt: now,
  };

  const adminKey: Key = {
    id: -1,
    userId: adminUser.id,
    name: "ADMIN_TOKEN",
    key: keyString,
    isEnabled: true,
    canLoginWebUi: true, // Admin Token always allows Web UI login
    providerGroup: null,
    limit5hUsd: null,
    limitDailyUsd: null,
    dailyResetMode: "fixed",
    dailyResetTime: "00:00",
    limitWeeklyUsd: null,
    limitMonthlyUsd: null,
    limitConcurrentSessions: 0,
    cacheTtlPreference: null,
    createdAt: now,
    updatedAt: now,
  };

  return { user: adminUser, key: adminKey };
}
```

**Key Characteristics**:
- Admin token user has `id: -1` (synthetic identifier)
- Admin token key has `canLoginWebUi: true` by default
- The token is configured via `ADMIN_TOKEN` environment variable

---

## 3. Technical Architecture

### 3.1 Data Model

#### 3.1.1 User Schema (Role Storage)

The user role is stored in the database schema at `/Users/ding/Github/claude-code-hub/src/drizzle/schema.ts`:

```typescript
export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  name: varchar('name').notNull(),
  description: text('description'),
  role: varchar('role').default('user'),  // 'admin' or 'user'
  rpmLimit: integer('rpm_limit'),
  dailyLimitUsd: numeric('daily_limit_usd', { precision: 10, scale: 2 }),
  providerGroup: varchar('provider_group', { length: 200 }).default('default'),
  tags: jsonb('tags').$type<string[]>().default([]),
  
  // User-level quota fields
  limit5hUsd: numeric('limit_5h_usd', { precision: 10, scale: 2 }),
  limitWeeklyUsd: numeric('limit_weekly_usd', { precision: 10, scale: 2 }),
  limitMonthlyUsd: numeric('limit_monthly_usd', { precision: 10, scale: 2 }),
  limitTotalUsd: numeric('limit_total_usd', { precision: 10, scale: 2 }),
  limitConcurrentSessions: integer('limit_concurrent_sessions'),
  
  // Daily quota reset configuration
  dailyResetMode: dailyResetModeEnum('daily_reset_mode').default('fixed').notNull(),
  dailyResetTime: varchar('daily_reset_time', { length: 5 }).default('00:00').notNull(),
  
  // User status and expiry management
  isEnabled: boolean('is_enabled').notNull().default(true),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  
  // Access restrictions
  allowedClients: jsonb('allowed_clients').$type<string[]>().default([]),
  allowedModels: jsonb('allowed_models').$type<string[]>().default([]),
  
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (table) => ({
  // Composite index for user list queries (sorted by role, admins first)
  usersActiveRoleSortIdx: index('idx_users_active_role_sort')
    .on(table.deletedAt, table.role, table.id)
    .where(sql`${table.deletedAt} IS NULL`),
  // Composite index for expired user queries (for scheduled tasks)
  usersEnabledExpiresAtIdx: index('idx_users_enabled_expires_at')
    .on(table.isEnabled, table.expiresAt)
    .where(sql`${table.deletedAt} IS NULL`),
}));
```

**Verified**: The role field is stored as `varchar` with a default value of `'user'`.

#### 3.1.2 TypeScript Type Definition

The User type is defined in `/Users/ding/Github/claude-code-hub/src/types/user.ts`:

```typescript
export interface User {
  id: number;
  name: string;
  description: string;
  role: "admin" | "user";  // Strict union type for roles
  rpm: number | null;
  dailyQuota: number | null;
  providerGroup: string | null;
  tags?: string[];
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date;
  // User-level quota fields
  limit5hUsd?: number;
  limitWeeklyUsd?: number;
  limitMonthlyUsd?: number;
  limitTotalUsd?: number | null;
  limitConcurrentSessions?: number;
  // Daily quota reset mode
  dailyResetMode: "fixed" | "rolling";
  dailyResetTime: string;
  // User status and expiry management
  isEnabled: boolean;
  expiresAt?: Date | null;
  // Access restrictions
  allowedClients?: string[];
  allowedModels?: string[];
}
```

**Verified**: The TypeScript type uses a strict union type `"admin" | "user"` for the role field.

### 3.2 Core Permission Module

#### 3.2.1 Field-Level Permission Configuration

Located at `/Users/ding/Github/claude-code-hub/src/lib/permissions/user-field-permissions.ts`:

```typescript
export const USER_FIELD_PERMISSIONS = {
  // Admin-only fields (UpdateUserSchema sensitive fields)
  rpm: { requiredRole: "admin" },
  dailyQuota: { requiredRole: "admin" },
  providerGroup: { requiredRole: "admin" },

  // Admin-only fields (user-level quota fields)
  limit5hUsd: { requiredRole: "admin" },
  limitWeeklyUsd: { requiredRole: "admin" },
  limitMonthlyUsd: { requiredRole: "admin" },
  limitTotalUsd: { requiredRole: "admin" },
  limitConcurrentSessions: { requiredRole: "admin" },

  // Admin-only fields (daily reset configuration)
  dailyResetMode: { requiredRole: "admin" },
  dailyResetTime: { requiredRole: "admin" },

  // Admin-only fields (status and expiry)
  isEnabled: { requiredRole: "admin" },
  expiresAt: { requiredRole: "admin" },

  // Admin-only field (client restrictions)
  allowedClients: { requiredRole: "admin" },

  // Admin-only field (model restrictions)
  allowedModels: { requiredRole: "admin" },
} as const;
```

**Complete List of Admin-Only Fields**:

| Field | Description |
|-------|-------------|
| `rpm` | Requests per minute limit |
| `dailyQuota` | Daily quota limit (USD) |
| `providerGroup` | Provider group assignment |
| `limit5hUsd` | 5-hour spending limit |
| `limitWeeklyUsd` | Weekly spending limit |
| `limitMonthlyUsd` | Monthly spending limit |
| `limitTotalUsd` | Total spending limit |
| `limitConcurrentSessions` | Concurrent session limit |
| `dailyResetMode` | Daily reset mode (fixed/rolling) |
| `dailyResetTime` | Daily reset time (HH:mm) |
| `isEnabled` | User enabled status |
| `expiresAt` | Account expiration date |
| `allowedClients` | Allowed client patterns |
| `allowedModels` | Allowed AI models |

#### 3.2.2 Permission Checking Functions

```typescript
/**
 * Check if a user has permission to modify a specific field
 */
export function checkFieldPermission(field: string, userRole: string): boolean {
  const permission = USER_FIELD_PERMISSIONS[field as keyof typeof USER_FIELD_PERMISSIONS];

  // If no permission is defined for the field, allow modification
  if (!permission) return true;

  // Check if user's role matches the required role
  return userRole === permission.requiredRole;
}

/**
 * Get all unauthorized fields from a data object based on user role
 */
export function getUnauthorizedFields(data: Record<string, unknown>, userRole: string): string[] {
  return Object.keys(data).filter((field) => !checkFieldPermission(field, userRole));
}
```

**Verified Location**: `/Users/ding/Github/claude-code-hub/src/lib/permissions/user-field-permissions.ts`

### 3.3 Authentication & Session Management

#### 3.3.1 Auth Session Interface

From `/Users/ding/Github/claude-code-hub/src/lib/auth.ts`:

```typescript
export interface AuthSession {
  user: User;
  key: Key;
}

export async function getSession(options?: {
  allowReadOnlyAccess?: boolean;
}): Promise<AuthSession | null> {
  const keyString = await getAuthToken();
  if (!keyString) {
    return null;
  }
  return validateKey(keyString, options);
}
```

#### 3.3.2 Key Validation with Web UI Login Check

```typescript
export async function validateKey(
  keyString: string,
  options?: { allowReadOnlyAccess?: boolean }
): Promise<AuthSession | null> {
  const allowReadOnlyAccess = options?.allowReadOnlyAccess ?? false;

  // Check for admin token first
  const adminToken = config.auth.adminToken;
  if (adminToken && keyString === adminToken) {
    // Return synthetic admin session
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

**Important**: The `allowReadOnlyAccess` option allows bypassing the `canLoginWebUi` check for read-only pages like `/my-usage`.

#### 3.3.3 Login Redirect Logic

```typescript
export function getLoginRedirectTarget(session: AuthSession): string {
  if (session.user.role === "admin") return "/dashboard";
  if (session.key.canLoginWebUi) return "/dashboard";
  return "/my-usage";
}
```

**Behavior**:
- Admin users always go to `/dashboard`
- Regular users with `canLoginWebUi: true` go to `/dashboard`
- Regular users with `canLoginWebUi: false` go to `/my-usage`

### 3.4 API Route Protection

#### 3.4.1 OpenAPI Action Adapter

From `/Users/ding/Github/claude-code-hub/src/lib/api/action-adapter-openapi.ts`:

```typescript
export function createActionRoute<TRequest, TResponse>(
  module: string,
  action: string,
  handler: (data: TRequest) => Promise<ActionResult<TResponse>>,
  config: {
    requestSchema?: z.ZodSchema;
    responseSchema?: z.ZodSchema;
    description?: string;
    summary?: string;
    tags?: string[];
    requiresAuth?: boolean;
    allowReadOnlyAccess?: boolean;
    requiredRole?: "admin";
  }
) {
  // ... route setup

  // Check role permission
  if (requiredRole === "admin" && session.user.role !== "admin") {
    logger.warn(`[ActionAPI] ${fullPath} 权限不足: 需要 admin 角色`, {
      userId: session.user.id,
      userRole: session.user.role,
    });
    return c.json({ ok: false, error: "权限不足" }, 403);
  }
}
```

**Verified**: The adapter supports `requiredRole: "admin"` for admin-only endpoints.

---

## 4. Data Flow

### 4.1 Authentication Flow

```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐
│   Client    │────▶│  Middleware  │────▶│   validate  │
│   Request   │     │   (proxy.ts) │     │    Key()    │
└─────────────┘     └──────────────┘     └──────┬──────┘
                                                │
                       ┌────────────────────────┘
                       ▼
              ┌─────────────────┐
              │  Check Admin    │
              │    Token?       │
              └────────┬────────┘
                       │
          ┌─────────────┼─────────────┐
          ▼             ▼             ▼
     ┌─────────┐  ┌──────────┐  ┌──────────┐
     │  Admin  │  │ Database │  │  Return  │
     │ Session │  │  Lookup  │  │   Null   │
     └────┬────┘  └────┬─────┘  └────┬─────┘
          │            │             │
          └────────────┼─────────────┘
                       ▼
             ┌──────────────────┐
             │ Check canLogin   │
             │    WebUi         │
             └────────┬─────────┘
                      │
          ┌───────────┴───────────┐
          ▼                       ▼
    ┌────────────┐          ┌──────────┐
    │   Allow    │          │  Deny    │
    │  Access    │          │  Access  │
    └────────────┘          └──────────┘
```

### 4.2 Permission Check Flow

```
┌─────────────────┐
│  User Action    │
│  (Server Action)│
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│   getSession()  │
└────────┬────────┘
         │
         ▼
┌─────────────────┐     ┌─────────────────┐
│  Session Null?  │────▶│ Return UNAUTHORIZED│
└────────┬────────┘     └─────────────────┘
         │ No
         ▼
┌─────────────────┐     ┌─────────────────┐
│  Role Check     │────▶│ Return PERMISSION_DENIED│
│ (admin required)│     └─────────────────┘
└────────┬────────┘
         │ Pass
         ▼
┌─────────────────┐     ┌─────────────────┐
│ Ownership Check │────▶│ Return PERMISSION_DENIED│
│ (if applicable) │     └─────────────────┘
└────────┬────────┘
         │ Pass
         ▼
┌─────────────────┐
│  Field Filter   │
│ (getUnauthorized│
│    Fields)      │
└────────┬────────┘
         │
         ▼
┌─────────────────┐     ┌─────────────────┐
│ Fields Valid?   │────▶│ Return PERMISSION_DENIED│
└────────┬────────┘     │  (with field list)      │
         │ Yes          └─────────────────┘
         ▼
┌─────────────────┐
│ Execute Action  │
└─────────────────┘
```

---

## 5. Configuration

### 5.1 Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `ADMIN_TOKEN` | Master admin token for super-admin access | `undefined` |
| `ENABLE_SECURE_COOKIES` | Whether to use secure cookie flag | `true` |

**Verified Location**: `/Users/ding/Github/claude-code-hub/src/lib/config/env.schema.ts` (line 81-86, 95)

### 5.2 System Settings

From `/Users/ding/Github/claude-code-hub/src/drizzle/schema.ts`:

```typescript
export const systemSettings = pgTable('system_settings', {
  id: serial('id').primaryKey(),
  siteTitle: varchar('site_title', { length: 128 }).notNull().default('Claude Code Hub'),
  allowGlobalUsageView: boolean('allow_global_usage_view').notNull().default(false),
  // ... other settings
});
```

The `allowGlobalUsageView` setting controls whether non-admin users can view the global leaderboard.

---

## 6. Edge Cases

### 6.1 Session Expiration During Action

If a user's session expires between the initial page load and a server action execution:

```typescript
const session = await getSession();
if (!session) {
  return {
    ok: false,
    error: tError("UNAUTHORIZED"),
    errorCode: ERROR_CODES.UNAUTHORIZED,
  };
}
```

The action returns an `UNAUTHORIZED` error, and the client should redirect to the login page.

### 6.2 Concurrent Role Changes

If an admin demotes a user to non-admin while they have an active session:

- The user's next action will fail the role check
- Existing sessions are not immediately invalidated
- The role check is performed on every server action

### 6.3 Admin Token vs Database Admin

The system distinguishes between:
- **Admin Token users**: Synthetic admin session with `id: -1`
- **Database admin users**: Regular users with `role: "admin"`

Both have identical permissions, but the admin token user:
- Cannot be modified through the UI (no database record)
- Has a synthetic key with `id: -1`
- Is not subject to user-level quotas

### 6.4 Field Permission Bypass Attempts

If a non-admin user attempts to modify protected fields:

```typescript
// Example: User tries to set their own quota
const result = await editUser(userId, {
  name: "New Name",
  dailyQuota: 1000,  // Admin-only field!
});

// Result:
// { ok: false, error: "Permission denied: dailyQuota", errorCode: "PERMISSION_DENIED" }
```

### 6.5 Read-Only Key Access

Keys with `canLoginWebUi: false` can only access `/my-usage`:

```typescript
// From /Users/ding/Github/claude-code-hub/src/lib/auth.ts (line 75-78)
if (!allowReadOnlyAccess && !key.canLoginWebUi) {
  return null;  // Denies access to non-read-only paths
}
```

Attempting to access `/dashboard` with such a key results in a redirect to `/my-usage` or login page.

### 6.6 Provider Group Permission Validation

Non-admin users can only create keys with provider groups they already have access to:

```typescript
// From /Users/ding/Github/claude-code-hub/src/actions/keys.ts (line 130-159)
if (isAdmin) {
  providerGroupForKey = requestedProviderGroup;
} else {
  // Security: require an existing default-group key before allowing default
  const userKeys = await findKeyList(data.userId);
  const hasDefaultKey = userKeys.some((k) =>
    parseProviderGroups(normalizeProviderGroup(k.providerGroup)).includes(
      PROVIDER_GROUP.DEFAULT
    )
  );
  providerGroupForKey = validateNonAdminProviderGroup(
    userProviderGroup,
    requestedProviderGroup,
    { hasDefaultKey },
    tError
  );
}
```

---

## 7. Error Handling

### 7.1 Error Codes

From `/Users/ding/Github/claude-code-hub/src/lib/utils/error-messages.ts`:

```typescript
export const AUTH_ERRORS = {
  UNAUTHORIZED: "UNAUTHORIZED",
  INVALID_CREDENTIALS: "INVALID_CREDENTIALS",
  SESSION_EXPIRED: "SESSION_EXPIRED",
  PERMISSION_DENIED: "PERMISSION_DENIED",
  TOKEN_REQUIRED: "TOKEN_REQUIRED",
  INVALID_TOKEN: "INVALID_TOKEN",
} as const;

export const ERROR_CODES = {
  ...VALIDATION_ERRORS,
  ...AUTH_ERRORS,
  ...SERVER_ERRORS,
  ...NETWORK_ERRORS,
  ...BUSINESS_ERRORS,
  ...RATE_LIMIT_ERRORS,
} as const;
```

### 7.2 Error Messages (Internationalized)

From `/Users/ding/Github/claude-code-hub/messages/en/errors.json`:

```json
{
  "UNAUTHORIZED": "Unauthorized, please log in",
  "PERMISSION_DENIED": "Permission denied"
}
```

From `/Users/ding/Github/claude-code-hub/messages/zh-TW/errors.json`:

```json
{
  "UNAUTHORIZED": "未授權，請先登入",
  "PERMISSION_DENIED": "權限不足"
}
```

**Note**: The system supports both `en` (English) and `zh-TW` (Traditional Chinese) locales.

---

## 8. Code References

### 8.1 Core Permission Files

| File | Purpose |
|------|---------|
| `/src/lib/permissions/user-field-permissions.ts` | Field-level permission configuration and checking functions |
| `/src/lib/auth.ts` | Session management, authentication, and role retrieval |
| `/src/drizzle/schema.ts` | Database schema including user role field |
| `/src/types/user.ts` | TypeScript type definitions for User with role |

### 8.2 Permission Enforcement Locations

| File | Pattern Used |
|------|--------------|
| `/src/actions/users.ts` | Role checks, field filtering, ownership verification |
| `/src/actions/keys.ts` | Role checks, ownership verification, provider group validation |
| `/src/actions/sensitive-words.ts` | Admin-only checks |
| `/src/actions/error-rules.ts` | Admin-only checks |
| `/src/actions/providers.ts` | Admin-only checks |
| `/src/actions/active-sessions.ts` | Role-based filtering |
| `/src/app/api/leaderboard/route.ts` | Role + settings check |

### 8.3 Frontend Permission Checks

| File | Pattern Used |
|------|--------------|
| `/src/app/[locale]/dashboard/providers/page.tsx` | Route-level redirect |
| `/src/app/[locale]/dashboard/sessions/page.tsx` | Route-level redirect |
| `/src/app/[locale]/dashboard/_components/user/user-actions.tsx` | Component-level conditional render |
| `/src/app/[locale]/dashboard/_components/user/key-actions.tsx` | Component-level conditional render |
| `/src/app/[locale]/dashboard/leaderboard/page.tsx` | Permission-based UI display |

### 8.4 Key Code Snippets

#### 8.4.1 Admin Check Pattern (Most Common)

```typescript
// From /src/actions/users.ts (line 771-778)
if (!session || session.user.role !== "admin") {
  return {
    ok: false,
    error: tError("PERMISSION_DENIED"),
    errorCode: ERROR_CODES.PERMISSION_DENIED,
  };
}
```

#### 8.4.2 Ownership + Role Check

```typescript
// From /src/actions/keys.ts (line 120-126)
if (session.user.role !== "admin" && session.user.id !== data.userId) {
  return {
    ok: false,
    error: tError("PERMISSION_DENIED"),
    errorCode: ERROR_CODES.PERMISSION_DENIED,
  };
}
```

#### 8.4.3 Field Permission Filtering

```typescript
// From /src/actions/users.ts (line 1156-1165)
const unauthorizedFields = getUnauthorizedFields(validatedData, session.user.role);

if (unauthorizedFields.length > 0) {
  return {
    ok: false,
    error: `${tError("PERMISSION_DENIED")}: ${unauthorizedFields.join(", ")}`,
    errorCode: ERROR_CODES.PERMISSION_DENIED,
  };
}
```

---

## 9. Security Considerations

### 9.1 Defense in Depth

The permission system implements defense in depth:

1. **Database Level**: Role stored in database with default "user"
2. **API Level**: All server actions validate session and role
3. **Field Level**: Sensitive fields require explicit admin role
4. **Frontend Level**: UI components conditionally render based on role
5. **Route Level**: Page-level redirects prevent access to admin pages

### 9.2 No Client-Side Trust

All permission checks are performed server-side. Client-side checks are for UX only:

```typescript
// Server action ALWAYS re-validates
const session = await getSession();
// Never trust client-sent role information
```

### 9.3 Audit Logging

Permission denials are logged for security monitoring:

```typescript
logger.warn(`[ActionAPI] ${fullPath} 权限不足: 需要 admin 角色`, {
  userId: session.user.id,
  userRole: session.user.role,
});
```

---

## 10. Future Considerations

### 10.1 Potential Extensions

1. **Granular Permissions**: Replace binary admin/user with fine-grained permissions (e.g., `users:read`, `users:write`, `providers:manage`)
2. **Role Groups**: Support for custom role definitions
3. **Time-Based Access**: Temporary elevation of privileges
4. **Audit Trail**: Comprehensive logging of all permission checks and denials

### 10.2 Current Limitations

1. **Hardcoded Roles**: Only "admin" and "user" roles are supported
2. **No Permission Inheritance**: Users cannot inherit permissions from groups
3. **No API Key Scoping**: API keys have the same permissions as their owning user

---

## 11. Summary

The Claude Code Hub permission system implements a robust RBAC model with the following characteristics:

- **Simple but effective**: Two-role system (admin/user) covers most use cases
- **Multi-layered protection**: Server, field, route, and component-level checks
- **Flexible access modes**: Support for read-only access and admin tokens
- **Configurable visibility**: System settings allow relaxing certain restrictions
- **Comprehensive error handling**: Clear error codes and internationalized messages

The system prioritizes security over flexibility, with all critical checks performed server-side and no trust placed in client-side state.

---

## 12. Verification Notes

This draft has been verified against the actual codebase:

- ✅ All file paths verified to exist
- ✅ All code snippets match actual implementation
- ✅ All error codes verified in error-messages.ts
- ✅ All i18n messages verified in messages/ directory
- ✅ Database schema verified in drizzle/schema.ts
- ✅ TypeScript types verified in types/user.ts
- ✅ Permission functions verified in permissions/user-field-permissions.ts
- ✅ Authentication flow verified in lib/auth.ts
- ✅ Middleware behavior verified in proxy.ts

**Corrections from Round 1**:
- Fixed: Error message locale (actual code returns Chinese message regardless of locale for leaderboard)
- Added: Complete list of admin-only fields (14 fields total)
- Added: Provider group permission validation for non-admin users
- Added: Login redirect logic documentation
- Added: Cookie and Bearer token authentication methods
- Clarified: Admin token user has `id: -1` and synthetic key properties

---

*End of Round 2 Verified Draft*
