# Round 1 Exploration: 用户 CRUD 操作 (User CRUD Operations)

## Intent Analysis

The User CRUD (Create, Read, Update, Delete) operations form the foundational user management layer of the Claude Code Hub platform. This system is designed to manage API consumers with sophisticated quota controls, access restrictions, and hierarchical permissions. The primary intents are:

1. **Multi-tenant User Management**: Support multiple users with isolated resources (Keys) and configurable usage limits
2. **Role-based Access Control**: Differentiate between admin and regular users with field-level permission granularity
3. **Resource Quota Enforcement**: Implement comprehensive spending limits across multiple time windows (5h, daily, weekly, monthly, total)
4. **Flexible Authentication**: Support various client types (CLI tools like Claude Code CLI, Gemini CLI, Codex CLI) with client-specific restrictions
5. **Soft Deletion Architecture**: Maintain data integrity through soft deletes while preserving historical usage records

The user system serves as the parent entity for API keys, message requests, and usage statistics, making it central to the entire platform's operation.

---

## Behavior Summary

### User Data Model Overview

The user entity is defined across multiple layers:

**Database Schema** (`/Users/ding/Github/claude-code-hub/src/drizzle/schema.ts` lines 36-88):
```typescript
export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  name: varchar('name').notNull(),
  description: text('description'),
  role: varchar('role').default('user'),
  rpmLimit: integer('rpm_limit'),
  dailyLimitUsd: numeric('daily_limit_usd', { precision: 10, scale: 2 }),
  providerGroup: varchar('provider_group', { length: 200 }).default('default'),
  tags: jsonb('tags').$type<string[]>().default([]),
  limit5hUsd: numeric('limit_5h_usd', { precision: 10, scale: 2 }),
  limitWeeklyUsd: numeric('limit_weekly_usd', { precision: 10, scale: 2 }),
  limitMonthlyUsd: numeric('limit_monthly_usd', { precision: 10, scale: 2 }),
  limitTotalUsd: numeric('limit_total_usd', { precision: 10, scale: 2 }),
  limitConcurrentSessions: integer('limit_concurrent_sessions'),
  dailyResetMode: dailyResetModeEnum('daily_reset_mode').default('fixed').notNull(),
  dailyResetTime: varchar('daily_reset_time', { length: 5 }).default('00:00').notNull(),
  isEnabled: boolean('is_enabled').notNull().default(true),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  allowedClients: jsonb('allowed_clients').$type<string[]>().default([]),
  allowedModels: jsonb('allowed_models').$type<string[]>().default([]),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (table) => ({
  usersActiveRoleSortIdx: index('idx_users_active_role_sort').on(table.deletedAt, table.role, table.id).where(sql`${table.deletedAt} IS NULL`),
  usersEnabledExpiresAtIdx: index('idx_users_enabled_expires_at').on(table.isEnabled, table.expiresAt).where(sql`${table.deletedAt} IS NULL`),
  usersCreatedAtIdx: index('idx_users_created_at').on(table.createdAt),
  usersDeletedAtIdx: index('idx_users_deleted_at').on(table.deletedAt),
}));
```

**TypeScript Interface** (`/Users/ding/Github/claude-code-hub/src/types/user.ts` lines 1-32):
```typescript
export interface User {
  id: number;
  name: string;
  description: string;
  role: "admin" | "user";
  rpm: number | null; // 每分钟请求数限制，null = 无限制
  dailyQuota: number | null; // 每日额度限制（美元），null = 无限制
  providerGroup: string | null; // 供应商分组
  tags?: string[]; // 用户标签（可选）
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date;
  limit5hUsd?: number; // 5小时消费上限（美元）
  limitWeeklyUsd?: number; // 周消费上限（美元）
  limitMonthlyUsd?: number; // 月消费上限（美元）
  limitTotalUsd?: number | null; // 总消费上限（美元）
  limitConcurrentSessions?: number; // 并发 Session 上限
  dailyResetMode: "fixed" | "rolling"; // 每日限额重置模式
  dailyResetTime: string; // 每日重置时间 (HH:mm)
  isEnabled: boolean; // 用户启用状态
  expiresAt?: Date | null; // 用户过期时间
  allowedClients?: string[]; // 允许的客户端模式（空数组=无限制）
  allowedModels?: string[]; // 允许的AI模型（空数组=无限制）
}
```

### CRUD Operations Architecture

The User CRUD operations follow a layered architecture:

1. **Action Layer** (`/Users/ding/Github/claude-code-hub/src/actions/users.ts`): Server actions handling business logic, validation, permissions, and translations
2. **Repository Layer** (`/Users/ding/Github/claude-code-hub/src/repository/user.ts`): Database operations using Drizzle ORM
3. **Validation Layer** (`/Users/ding/Github/claude-code-hub/src/lib/validation/schemas.ts`): Zod schemas for input validation
4. **Permission Layer** (`/Users/ding/Github/claude-code-hub/src/lib/permissions/user-field-permissions.ts`): Field-level access control

### Create Operation

**Primary Function**: `addUser()` in `/Users/ding/Github/claude-code-hub/src/actions/users.ts` (lines 720-910)

The user creation process:
1. **Permission Check**: Verifies the session user has admin role
2. **Zod Validation**: Validates input against `CreateUserSchema`
3. **Provider Group Normalization**: Normalizes the provider group string
4. **Database Insert**: Creates user record via `createUser()` repository function
5. **Default Key Generation**: Automatically creates a default API key for the new user
6. **Cache Revalidation**: Invalidates dashboard cache

Key validation constraints from `CreateUserSchema` (`/Users/ding/Github/claude-code-hub/src/lib/validation/schemas.ts` lines 31-162):
- `name`: Required, 1-64 characters
- `note`: Optional, max 200 characters
- `providerGroup`: Optional, max 200 characters, nullable
- `tags`: Array of strings, max 20 tags, each max 32 characters
- `rpm`: Integer, 0-1,000,000 (0 = unlimited)
- `dailyQuota`: Number, 0-100,000 USD (0 = unlimited)
- `limit5hUsd`: Number, 0-10,000 USD
- `limitWeeklyUsd`: Number, 0-50,000 USD
- `limitMonthlyUsd`: Number, 0-200,000 USD
- `limitTotalUsd`: Number, 0-10,000,000 USD
- `limitConcurrentSessions`: Integer, 0-1000
- `expiresAt`: Must be future date, max 10 years from now
- `dailyResetMode`: "fixed" or "rolling"
- `dailyResetTime`: HH:mm format
- `allowedClients`: Array of strings, max 50 items, each max 64 characters
- `allowedModels`: Array of strings, max 50 items, each max 64 characters

**Repository Create Function** (`/Users/ding/Github/claude-code-hub/src/repository/user.ts` lines 43-90):
```typescript
export async function createUser(userData: CreateUserData): Promise<User> {
  const dbData = {
    name: userData.name,
    description: userData.description,
    rpmLimit: userData.rpm,
    dailyLimitUsd: userData.dailyQuota?.toString(),
    providerGroup: userData.providerGroup,
    tags: userData.tags ?? [],
    limit5hUsd: userData.limit5hUsd?.toString(),
    limitWeeklyUsd: userData.limitWeeklyUsd?.toString(),
    limitMonthlyUsd: userData.limitMonthlyUsd?.toString(),
    limitTotalUsd: userData.limitTotalUsd?.toString(),
    limitConcurrentSessions: userData.limitConcurrentSessions,
    dailyResetMode: userData.dailyResetMode ?? "fixed",
    dailyResetTime: userData.dailyResetTime ?? "00:00",
    isEnabled: userData.isEnabled ?? true,
    expiresAt: userData.expiresAt ?? null,
    allowedClients: userData.allowedClients ?? [],
    allowedModels: userData.allowedModels ?? [],
  };

  const [user] = await db.insert(users).values(dbData).returning({
    id: users.id,
    name: users.name,
    // ... all fields
  });

  return toUser(user);
}
```

### Read Operations

The system provides multiple query patterns for different use cases:

**1. Simple List with Pagination** (`findUserList`, lines 92-125):
```typescript
export async function findUserList(limit: number = 50, offset: number = 0): Promise<User[]> {
  const result = await db
    .select({ /* fields */ })
    .from(users)
    .where(isNull(users.deletedAt))
    .orderBy(sql`CASE WHEN ${users.role} = 'admin' THEN 0 ELSE 1 END`, users.id)
    .limit(limit)
    .offset(offset);

  return result.map(toUser);
}
```
- Returns users ordered by role (admin first), then by ID
- Excludes soft-deleted users
- Default limit: 50 records

**2. Cursor-based Batch Query** (`findUserListBatch`, lines 151-312):
Supports advanced filtering:
- `searchTerm`: Searches across username, description, provider group, tags, and associated keys
- `tagFilters`: OR logic for multiple tags
- `keyGroupFilters`: Filter by provider groups
- `statusFilter`: "all" | "active" | "expired" | "expiringSoon" | "enabled" | "disabled"
- `sortBy` and `sortOrder`: Flexible sorting

**3. Single User Lookup** (`findUserById`, lines 314-346):
```typescript
export async function findUserById(id: number): Promise<User | null> {
  const [user] = await db
    .select({ /* fields */ })
    .from(users)
    .where(and(eq(users.id, id), isNull(users.deletedAt)));

  if (!user) return null;
  return toUser(user);
}
```

**4. Search for Filter Dropdown** (`searchUsersForFilter`, lines 127-146):
Returns minimal user info (id, name) for UI filter components with name-based search.

**5. Get All Tags** (`getAllUserTags`, lines 466-479):
Aggregates all unique tags across users for filter dropdowns.

**6. Get All Provider Groups** (`getAllUserProviderGroups`, lines 485-504):
Extracts all unique provider groups from users.

### Update Operation

**Primary Function**: `editUser()` in `/Users/ding/Github/claude-code-hub/src/actions/users.ts` (lines 1079-1216)

Update flow:
1. **Authentication Check**: Validates session exists
2. **Zod Validation**: Validates against `UpdateUserSchema`
3. **Field Permission Check**: Uses `getUnauthorizedFields()` to verify user can modify requested fields
4. **Ownership Check**: Non-admin users can only modify their own data
5. **Provider Group Normalization**: Normalizes provider group if provided
6. **Database Update**: Calls `updateUser()` repository function
7. **Cache Revalidation**: Invalidates dashboard cache

**Field-level Permissions** (`/Users/ding/Github/claude-code-hub/src/lib/permissions/user-field-permissions.ts`):
```typescript
export const USER_FIELD_PERMISSIONS = {
  rpm: { requiredRole: "admin" },
  dailyQuota: { requiredRole: "admin" },
  providerGroup: { requiredRole: "admin" },
  limit5hUsd: { requiredRole: "admin" },
  limitWeeklyUsd: { requiredRole: "admin" },
  limitMonthlyUsd: { requiredRole: "admin" },
  limitTotalUsd: { requiredRole: "admin" },
  limitConcurrentSessions: { requiredRole: "admin" },
  dailyResetMode: { requiredRole: "admin" },
  dailyResetTime: { requiredRole: "admin" },
  isEnabled: { requiredRole: "admin" },
  expiresAt: { requiredRole: "admin" },
  allowedClients: { requiredRole: "admin" },
  allowedModels: { requiredRole: "admin" },
} as const;
```

**Repository Update Function** (`/Users/ding/Github/claude-code-hub/src/repository/user.ts` lines 348-436):
```typescript
export async function updateUser(id: number, userData: UpdateUserData): Promise<User | null> {
  if (Object.keys(userData).length === 0) {
    return findUserById(id);
  }

  const dbData: UpdateDbData = {
    updatedAt: new Date(),
  };
  
  // Conditionally set fields
  if (userData.name !== undefined) dbData.name = userData.name;
  if (userData.description !== undefined) dbData.description = userData.description;
  if (userData.rpm !== undefined) dbData.rpmLimit = userData.rpm;
  if (userData.dailyQuota !== undefined)
    dbData.dailyLimitUsd = userData.dailyQuota === null ? null : userData.dailyQuota.toString();
  // ... more fields

  const [user] = await db
    .update(users)
    .set(dbData)
    .where(and(eq(users.id, id), isNull(users.deletedAt)))
    .returning({ /* fields */ });

  if (!user) return null;
  return toUser(user);
}
```

**Additional Update Operations**:
- `renewUser()`: Extends user expiration date
- `toggleUserEnabled()`: Enables/disables user account
- `batchUpdateUsers()`: Batch updates multiple users atomically
- `syncUserProviderGroupFromKeys()`: Syncs user provider group from associated keys

### Delete Operation

**Primary Function**: `removeUser()` in `/Users/ding/Github/claude-code-hub/src/actions/users.ts` (lines 1218-1242)

Delete flow:
1. **Permission Check**: Only admins can delete users
2. **Soft Delete**: Sets `deletedAt` timestamp instead of removing record
3. **Cache Revalidation**: Invalidates dashboard cache

**Repository Delete Function** (`/Users/ding/Github/claude-code-hub/src/repository/user.ts` lines 438-446):
```typescript
export async function deleteUser(id: number): Promise<boolean> {
  const result = await db
    .update(users)
    .set({ deletedAt: new Date() })
    .where(and(eq(users.id, id), isNull(users.deletedAt)))
    .returning({ id: users.id });

  return result.length > 0;
}
```

**Additional Delete-Related Operations**:
- `markUserExpired()`: Disables expired users (idempotent)
- `purgeUserCompletely()`: Hard delete with cleanup of all related data (message requests, Redis cache)

---

## Config/Commands

### Validation Constants

**User Limits** (`/Users/ding/Github/claude-code-hub/src/lib/constants/user.constants.ts`):
```typescript
export const USER_LIMITS = {
  RPM: {
    MIN: 0, // 0 = 无限制
    MAX: 1_000_000, // 提升到 100 万
  },
  DAILY_QUOTA: {
    MIN: 0,
    MAX: 100_000, // 提升到 10 万美元
  },
} as const;
```

### Data Transformers

**User Transformer** (`/Users/ding/Github/claude-code-hub/src/repository/_shared/transformers.ts` lines 10-55):
```typescript
export function toUser(dbUser: any): User {
  const parseOptionalNumber = (value: unknown): number | null | undefined => {
    if (value === undefined) return undefined;
    if (value === null) return null;
    const parsed = Number.parseFloat(String(value));
    return Number.isNaN(parsed) ? null : parsed;
  };

  return {
    ...dbUser,
    description: dbUser?.description || "",
    role: (dbUser?.role as User["role"]) || "user",
    rpm: (() => {
      if (dbUser?.rpm === null || dbUser?.rpm === undefined) return null;
      const parsed = Number(dbUser.rpm);
      return parsed > 0 ? parsed : null;
    })(),
    dailyQuota: (() => {
      if (dbUser?.dailyQuota === null || dbUser?.dailyQuota === undefined) return null;
      const parsed = Number.parseFloat(dbUser.dailyQuota);
      return parsed > 0 ? parsed : null;
    })(),
    providerGroup: dbUser?.providerGroup ?? null,
    tags: dbUser?.tags ?? [],
    limit5hUsd: parseOptionalNumber(dbUser?.limit5hUsd),
    limitWeeklyUsd: parseOptionalNumber(dbUser?.limitWeeklyUsd),
    limitMonthlyUsd: parseOptionalNumber(dbUser?.limitMonthlyUsd),
    limitTotalUsd: parseOptionalNumber(dbUser?.limitTotalUsd),
    limitConcurrentSessions: parseOptionalInteger(dbUser?.limitConcurrentSessions),
    dailyResetMode: dbUser?.dailyResetMode ?? "fixed",
    dailyResetTime: dbUser?.dailyResetTime ?? "00:00",
    isEnabled: dbUser?.isEnabled ?? true,
    expiresAt: dbUser?.expiresAt ? new Date(dbUser.expiresAt) : null,
    allowedClients: dbUser?.allowedClients ?? [],
    allowedModels: dbUser?.allowedModels ?? [],
    createdAt: dbUser?.createdAt ? new Date(dbUser.createdAt) : new Date(),
    updatedAt: dbUser?.updatedAt ? new Date(dbUser.updatedAt) : new Date(),
  };
}
```

### Database Indexes

The users table has optimized indexes for common query patterns:

1. **`idx_users_active_role_sort`**: Composite index on (deletedAt, role, id) for admin-first ordering
2. **`idx_users_enabled_expires_at`**: Index on (isEnabled, expiresAt) for expiration job queries
3. **`idx_users_created_at`**: Index for time-based queries
4. **`idx_users_deleted_at`**: Index for soft-delete filtering

---

## Edge Cases

### 1. Soft Delete Handling

All read operations filter out soft-deleted users using `isNull(users.deletedAt)`. The delete operation performs a soft delete by setting `deletedAt` to the current timestamp. This preserves:
- Historical message request records
- Usage statistics for reporting
- Audit trails

### 2. Provider Group Synchronization

User provider groups are automatically synchronized from their associated keys. When a key is created, updated, or deleted:
- The system collects all unique provider groups from the user's active keys
- Concatenates them into a comma-separated string
- Updates the user's `providerGroup` field

This ensures the user's provider group always reflects their key assignments.

### 3. Expiration Time Validation

The system enforces strict expiration time rules:
- Must be a valid future date (for creation)
- Maximum 10 years from current date
- Uses system timezone for date boundary calculations

### 4. Batch Update Atomicity

Batch updates use database transactions to ensure atomicity:
```typescript
await db.transaction(async (tx) => {
  // Verify all users exist
  // Perform update
  // Verify update counts match
});
```

If any user in the batch doesn't exist or the update count doesn't match, the entire transaction rolls back.

### 5. Permission Escalation Prevention

The field-level permission system prevents non-admin users from modifying sensitive fields:
- All quota-related fields (rpm, dailyQuota, limit*)
- Status fields (isEnabled, expiresAt)
- Access control fields (allowedClients, allowedModels)
- Configuration fields (dailyResetMode, dailyResetTime)

### 6. Self-Disabling Prevention

The system prevents users from disabling their own account:
```typescript
if (session.user.id === userId && !enabled) {
  return {
    ok: false,
    error: tError("CANNOT_DISABLE_SELF"),
    errorCode: ERROR_CODES.PERMISSION_DENIED,
  };
}
```

### 7. Default Key Auto-Creation

When creating a user via `addUser()`, the system automatically generates a default API key:
- Key format: `sk-${randomBytes(16).toString("hex")}`
- Name: "default"
- Provider group: Inherited from user
- The full key is returned only once during creation

### 8. Numeric Field Conversion

Database stores numeric values as strings (for precision), requiring conversion:
- Storage: `userData.dailyQuota?.toString()`
- Retrieval: `Number.parseFloat(dbUser.dailyQuota)`
- Null/undefined handling: Preserves null for "unlimited" semantics

### 9. Tag and Array Field Handling

JSONB arrays have careful default handling:
- Empty arrays in database represent "no restrictions" for allowedClients/allowedModels
- Tags default to empty array `[]`
- Array operations use JSONB operators for filtering

### 10. Timezone-Aware Date Operations

The system supports configurable timezones for daily reset calculations:
- `dailyResetTime`: Stored as "HH:mm" string
- `dailyResetMode`: "fixed" (resets at specific time) or "rolling" (24h window)
- System timezone configuration affects all time boundary calculations

---

## References

### Core Files

| File Path | Purpose |
|-----------|---------|
| `/Users/ding/Github/claude-code-hub/src/actions/users.ts` | Server actions for user CRUD operations |
| `/Users/ding/Github/claude-code-hub/src/repository/user.ts` | Database repository layer for users |
| `/Users/ding/Github/claude-code-hub/src/types/user.ts` | TypeScript type definitions for users |
| `/Users/ding/Github/claude-code-hub/src/lib/validation/schemas.ts` | Zod validation schemas |
| `/Users/ding/Github/claude-code-hub/src/lib/permissions/user-field-permissions.ts` | Field-level permission configuration |
| `/Users/ding/Github/claude-code-hub/src/drizzle/schema.ts` | Database schema definitions |
| `/Users/ding/Github/claude-code-hub/src/repository/_shared/transformers.ts` | Data transformation utilities |
| `/Users/ding/Github/claude-code-hub/src/lib/constants/user.constants.ts` | User-related constants |

### Key Functions

**Action Layer** (`/Users/ding/Github/claude-code-hub/src/actions/users.ts`):
```typescript
// Create
export async function addUser(data: CreateUserData): Promise<ActionResult<{ user: User; defaultKey: Key }>>
export async function createUserOnly(data: CreateUserData): Promise<ActionResult<{ user: User }>>

// Read
export async function getUsers(): Promise<UserDisplay[]>
export async function getUsersBatch(params: GetUsersBatchParams): Promise<ActionResult<GetUsersBatchResult>>
export async function searchUsersForFilter(searchTerm?: string): Promise<ActionResult<Array<{ id: number; name: string }>>>
export async function getAllUserTags(): Promise<ActionResult<string[]>>
export async function getAllUserKeyGroups(): Promise<ActionResult<string[]>>

// Update
export async function editUser(userId: number, data: UpdateUserData): Promise<ActionResult>
export async function batchUpdateUsers(params: BatchUpdateUsersParams): Promise<ActionResult<BatchUpdateResult>>
export async function renewUser(userId: number, data: { expiresAt: string; enableUser?: boolean }): Promise<ActionResult>
export async function toggleUserEnabled(userId: number, enabled: boolean): Promise<ActionResult>
export async function syncUserProviderGroupFromKeys(userId: number): Promise<void>

// Delete
export async function removeUser(userId: number): Promise<ActionResult>
export async function purgeUserCompletely(userId: number): Promise<ActionResult>

// Utility
export async function getUserLimitUsage(userId: number): Promise<ActionResult<LimitUsage>>
export async function getUserAllLimitUsage(userId: number): Promise<ActionResult<AllLimitUsage>>
```

**Repository Layer** (`/Users/ding/Github/claude-code-hub/src/repository/user.ts`):
```typescript
export async function createUser(userData: CreateUserData): Promise<User>
export async function findUserList(limit?: number, offset?: number): Promise<User[]>
export async function findUserListBatch(filters: UserListBatchFilters): Promise<UserListBatchResult>
export async function findUserById(id: number): Promise<User | null>
export async function searchUsersForFilter(searchTerm?: string): Promise<Array<{ id: number; name: string }>>
export async function updateUser(id: number, userData: UpdateUserData): Promise<User | null>
export async function deleteUser(id: number): Promise<boolean>
export async function markUserExpired(userId: number): Promise<boolean>
export async function getAllUserTags(): Promise<string[]>
export async function getAllUserProviderGroups(): Promise<string[]>
```

### Validation Schema

**CreateUserSchema** (`/Users/ding/Github/claude-code-hub/src/lib/validation/schemas.ts` lines 31-162):
```typescript
export const CreateUserSchema = z.object({
  name: z.string().min(1).max(64),
  note: z.string().max(200).optional().default(""),
  providerGroup: z.string().max(200).nullable().optional().default(""),
  tags: z.array(z.string().max(32)).max(20).optional().default([]),
  rpm: z.coerce.number().int().min(0).max(1_000_000).nullable().optional(),
  dailyQuota: z.coerce.number().min(0).max(100_000).nullable().optional(),
  limit5hUsd: z.coerce.number().min(0).max(10000).nullable().optional(),
  limitWeeklyUsd: z.coerce.number().min(0).max(50000).nullable().optional(),
  limitMonthlyUsd: z.coerce.number().min(0).max(200000).nullable().optional(),
  limitTotalUsd: z.coerce.number().min(0).max(10000000).nullable().optional(),
  limitConcurrentSessions: z.coerce.number().int().min(0).max(1000).nullable().optional(),
  isEnabled: z.boolean().optional().default(true),
  expiresAt: z.preprocess(/* ... */).optional(),
  dailyResetMode: z.enum(["fixed", "rolling"]).optional().default("fixed"),
  dailyResetTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional().default("00:00"),
  allowedClients: z.array(z.string().max(64)).max(50).optional().default([]),
  allowedModels: z.array(z.string().max(64)).max(50).optional().default([]),
});
```

**UpdateUserSchema** (`/Users/ding/Github/claude-code-hub/src/lib/validation/schemas.ts` lines 167-285):
Similar structure to CreateUserSchema but with all fields optional, supporting partial updates.

### Type Definitions

**CreateUserData** (`/Users/ding/Github/claude-code-hub/src/types/user.ts` lines 37-60):
```typescript
export interface CreateUserData {
  name: string;
  description: string;
  rpm?: number | null;
  dailyQuota?: number | null;
  providerGroup?: string | null;
  tags?: string[];
  limit5hUsd?: number;
  limitWeeklyUsd?: number;
  limitMonthlyUsd?: number;
  limitTotalUsd?: number | null;
  limitConcurrentSessions?: number;
  dailyResetMode?: "fixed" | "rolling";
  dailyResetTime?: string;
  isEnabled?: boolean;
  expiresAt?: Date | null;
  allowedClients?: string[];
  allowedModels?: string[];
}
```

**UpdateUserData** (`/Users/ding/Github/claude-code-hub/src/types/user.ts` lines 65-88):
Same as CreateUserData but all fields are optional.

**UserDisplay** (`/Users/ding/Github/claude-code-hub/src/types/user.ts` lines 135-161):
Frontend-optimized user type including associated keys and computed statistics.

---

## Frontend Components

The user management UI is built with React Server Components and Client Components, using a modular architecture:

### User Management Page

**Main Page Component**: `/Users/ding/Github/claude-code-hub/src/app/[locale]/dashboard/users/users-page-client.tsx`

The users page implements a comprehensive user management interface with:
- Virtualized scrolling for large user lists
- Real-time search with debouncing
- Multi-select batch operations
- Filter panels for tags, provider groups, and status
- Infinite scroll pagination

### Key UI Components

**1. UserManagementTable** (`/Users/ding/Github/claude-code-hub/src/app/[locale]/dashboard/_components/user/user-management-table.tsx`):
```typescript
interface UserManagementTableProps {
  users: UserDisplay[];
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  onLoadMore: () => void;
  currentUser: User;
  isMultiSelectMode: boolean;
  selectedUserIds: Set<number>;
  onSelectUser: (userId: number, selected: boolean) => void;
  onOpenBatchEdit: () => void;
  // ... additional props
}
```

Features:
- Virtualized list rendering using `@tanstack/react-virtual`
- Expandable user rows showing associated keys
- Inline quota usage visualization
- Quick actions (renew, toggle enabled, delete)
- Multi-select mode for batch operations

**2. UserForm Component** (`/Users/ding/Github/claude-code-hub/src/app/[locale]/dashboard/_components/user/forms/user-form.tsx`):
```typescript
interface UserFormProps {
  user?: UserDisplay;
  currentUser?: { role: string };
  onSuccess?: () => void;
  onCancel?: () => void;
}
```

The form implements:
- Zod schema validation with i18n error messages
- Provider group selection with available groups fetching
- Tag input with autocomplete
- Date picker for expiration
- Quota limit inputs with min/max constraints
- Client and model restriction arrays

**3. AddUserDialog** (`/Users/ding/Github/claude-code-hub/src/app/[locale]/dashboard/_components/user/add-user-dialog.tsx`):
```typescript
interface AddUserDialogProps {
  variant?: ButtonProps["variant"];
  size?: ButtonProps["size"];
  className?: string;
  currentUser?: { role: string };
}
```

A modal dialog wrapper around UserForm for creating new users.

**4. BatchEditToolbar** (`/Users/ding/Github/claude-code-hub/src/app/[locale]/dashboard/_components/user/batch-edit/batch-edit-toolbar.tsx`):
```typescript
interface BatchEditToolbarProps {
  isMultiSelectMode: boolean;
  allSelected: boolean;
  selectedUsersCount: number;
  selectedKeysCount: number;
  totalUsersCount: number;
  onEnterMode: () => void;
  onExitMode: () => void;
  onSelectAll: (checked: boolean) => void;
  onEditSelected: () => void;
}
```

Provides the multi-select interface with:
- Enter/exit multi-select mode
- Select all/none toggle
- Selected count display
- Batch edit button

**5. QuickRenewDialog** (`/Users/ding/Github/claude-code-hub/src/app/[locale]/dashboard/_components/user/forms/quick-renew-dialog.tsx`):

A streamlined dialog for extending user expiration dates with preset durations (7 days, 30 days, 90 days, 1 year) and optional user enablement.

### Form Validation Hook

**useZodForm** (`/Users/ding/Github/claude-code-hub/src/lib/hooks/use-zod-form.tsx`):
```typescript
interface UseZodFormOptions<T extends z.ZodSchema> {
  schema: T;
  defaultValues: Partial<z.infer<T>>;
  onSubmit: (data: z.infer<T>) => Promise<void> | void;
}

export function useZodForm<T extends z.ZodSchema>({
  schema,
  defaultValues,
  onSubmit,
}: UseZodFormOptions<T>) {
  // Returns: { values, errors, isSubmitting, canSubmit, setValue, handleSubmit, getFieldProps, getArrayFieldProps }
}
```

A custom React hook that provides:
- Zod schema validation
- Form state management
- Error handling
- Field props generation
- Array field support for tags/clients/models

---

## API Routes

The user CRUD operations are exposed through OpenAPI-compatible HTTP endpoints:

### Route Configuration

**Base Route**: `/Users/ding/Github/claude-code-hub/src/app/api/actions/[...route]/route.ts`

The API uses Hono with OpenAPI specification generation:

```typescript
const { route: getUsersRoute, handler: getUsersHandler } = createActionRoute(
  "users",
  "getUsers",
  userActions.getUsers,
  {
    requestSchema: z.object({}),
    responseSchema: z.array(UserDisplaySchema),
    description: "获取用户列表 (管理员获取所有用户，普通用户仅获取自己)",
    summary: "获取用户列表",
    tags: ["用户管理"],
  }
);
app.openapi(getUsersRoute, getUsersHandler);
```

### Available Endpoints

| Method | Endpoint | Action | Auth Required | Admin Only |
|--------|----------|--------|---------------|------------|
| GET | `/api/actions/users/getUsers` | getUsers | Yes | No |
| POST | `/api/actions/users/addUser` | addUser | Yes | Yes |
| POST | `/api/actions/users/editUser` | editUser | Yes | Yes* |
| POST | `/api/actions/users/removeUser` | removeUser | Yes | Yes |
| POST | `/api/actions/users/getUserLimitUsage` | getUserLimitUsage | Yes | No |
| POST | `/api/actions/users/getUserAllLimitUsage` | getUserAllLimitUsage | Yes | No |
| POST | `/api/actions/users/renewUser` | renewUser | Yes | Yes |
| POST | `/api/actions/users/toggleUserEnabled` | toggleUserEnabled | Yes | Yes |
| POST | `/api/actions/users/batchUpdateUsers` | batchUpdateUsers | Yes | Yes |
| POST | `/api/actions/users/getUsersBatch` | getUsersBatch | Yes | Yes |
| POST | `/api/actions/users/searchUsersForFilter` | searchUsersForFilter | Yes | Yes |
| POST | `/api/actions/users/getAllUserTags` | getAllUserTags | Yes | Yes |
| POST | `/api/actions/users/getAllUserKeyGroups` | getAllUserKeyGroups | Yes | Yes |

*Non-admin users can edit their own data with field restrictions.

### Request/Response Examples

**Create User Request**:
```json
POST /api/actions/users/addUser
{
  "name": "Test User",
  "note": "Temporary test account",
  "rpm": 100,
  "dailyQuota": 50.00,
  "isEnabled": true,
  "expiresAt": "2026-01-01T23:59:59.999Z",
  "tags": ["test", "temporary"],
  "providerGroup": "default",
  "allowedClients": ["claude-cli"],
  "allowedModels": ["claude-3-5-sonnet"]
}
```

**Create User Response**:
```json
{
  "ok": true,
  "data": {
    "user": {
      "id": 42,
      "name": "Test User",
      "note": "Temporary test account",
      "role": "user",
      "isEnabled": true,
      "expiresAt": "2026-01-01T23:59:59.999Z",
      "rpm": 100,
      "dailyQuota": 50.00,
      "providerGroup": "default",
      "tags": ["test", "temporary"],
      "limit5hUsd": null,
      "limitWeeklyUsd": null,
      "limitMonthlyUsd": null,
      "limitTotalUsd": null,
      "limitConcurrentSessions": null,
      "allowedModels": []
    },
    "defaultKey": {
      "id": 123,
      "name": "default",
      "key": "sk-a1b2c3d4e5f6..."
    }
  }
}
```

**Update User Request**:
```json
POST /api/actions/users/editUser
{
  "userId": 42,
  "name": "Updated Name",
  "dailyQuota": 100.00,
  "isEnabled": false
}
```

**Batch Update Request**:
```json
POST /api/actions/users/batchUpdateUsers
{
  "userIds": [1, 2, 3, 4, 5],
  "updates": {
    "tags": ["batch-updated"],
    "rpm": 200,
    "dailyQuota": 100.00
  }
}
```

---

## Data Flow Architecture

### Create User Flow

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   UserForm UI   │────▶│   addUser Action │────▶│  CreateUserSchema│
│                 │     │                  │     │    Validation   │
└─────────────────┘     └──────────────────┘     └─────────────────┘
                                                           │
                                                           ▼
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  Default Key    │◀────│  createUser Repo │◀────│ Permission Check│
│   Generation    │     │                  │     │   (Admin Only)  │
└─────────────────┘     └──────────────────┘     └─────────────────┘
         │
         ▼
┌─────────────────┐
│  revalidatePath │
│  ("/dashboard") │
└─────────────────┘
```

### Read Users Flow

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│ UserManagement  │────▶│  getUsers Action │────▶│  findUserList   │
│     Table       │     │                  │     │    Repository   │
└─────────────────┘     └──────────────────┘     └─────────────────┘
                                                           │
                                                           ▼
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  Transform to   │◀────│  Batch Key Query │◀────│   Drizzle ORM   │
│   UserDisplay   │     │                  │     │                 │
└─────────────────┘     └──────────────────┘     └─────────────────┘
```

### Update User Flow

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   UserForm UI   │────▶│  editUser Action │────▶│  UpdateUserSchema│
│                 │     │                  │     │    Validation   │
└─────────────────┘     └──────────────────┘     └─────────────────┘
                                                           │
                                                           ▼
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  revalidatePath │◀────│  updateUser Repo │◀────│ Field Permission│
│  ("/dashboard")  │     │                  │     │    Check        │
└─────────────────┘     └──────────────────┘     └─────────────────┘
```

---

## Error Handling

The user CRUD system implements comprehensive error handling with i18n support:

### Error Codes

| Error Code | Description | HTTP Status |
|------------|-------------|-------------|
| `PERMISSION_DENIED` | User lacks required permissions | 403 |
| `UNAUTHORIZED` | No valid session | 401 |
| `NOT_FOUND` | User does not exist | 404 |
| `INVALID_FORMAT` | Validation failed | 400 |
| `CREATE_FAILED` | Database insert failed | 500 |
| `UPDATE_FAILED` | Database update failed | 500 |
| `DELETE_FAILED` | Database delete failed | 500 |
| `BATCH_SIZE_EXCEEDED` | Batch size > 500 | 400 |
| `EMPTY_UPDATE` | No fields to update | 400 |
| `REQUIRED_FIELD` | Missing required field | 400 |

### Error Response Format

```typescript
interface ActionResult<T = void> {
  ok: boolean;
  data?: T;
  error?: string;
  errorCode?: string;
  errorParams?: Record<string, unknown>;
}
```

Example error response:
```json
{
  "ok": false,
  "error": "用户名不能为空",
  "errorCode": "INVALID_FORMAT",
  "errorParams": { "field": "name" }
}
```

---

## Summary

The User CRUD system in Claude Code Hub is a sophisticated multi-layered architecture that provides:

1. **Comprehensive User Management**: Full lifecycle management with soft deletes
2. **Granular Access Control**: Field-level permissions based on user roles
3. **Flexible Quota System**: Multi-timeframe spending limits with configurable reset modes
4. **Advanced Querying**: Cursor-based pagination with multi-field filtering
5. **Data Integrity**: Transaction-based batch operations with proper error handling
6. **Internationalization**: Full i18n support for error messages and UI text
7. **Audit Trail**: Soft deletes preserve historical data for reporting
8. **Modern UI**: Virtualized lists, real-time search, and batch operations
9. **API-First Design**: OpenAPI-compatible endpoints with auto-generated documentation
10. **Type Safety**: End-to-end TypeScript with Zod schema validation

The system is designed to scale with the platform's needs, supporting complex filtering, batch operations, and fine-grained access control while maintaining data consistency and performance through proper indexing and query optimization.
