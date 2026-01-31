# Batch Operations - 批量操作

## Intent Analysis

The batch operations feature in claude-code-hub allows administrators to efficiently manage multiple users and their associated keys simultaneously. Rather than editing users one by one, you can select multiple users and apply the same changes to all of them in a single operation. This is particularly useful when:

- You need to update quota limits for a group of users
- You want to add or remove tags from multiple users
- You need to adjust RPM (requests per minute) limits across a team
- You want to modify key settings for multiple users at once

The batch system supports both user-level fields (like tags, quotas, and RPM) and key-level fields (like provider groups and key-specific limits). All batch operations are atomic - they either complete successfully for all selected items or fail entirely, ensuring data consistency.

## Behavior Summary

### Overview

The batch operations system consists of several interconnected components:

1. **Batch Edit UI Components** - The interface for selecting users/keys and configuring batch updates
2. **Batch Update Actions** - Server-side functions that perform the actual updates
3. **Validation Layer** - Zod schemas and permission checks to ensure data integrity
4. **Database Transactions** - Atomic operations using Drizzle ORM transactions

### Batch Edit Workflow

The typical batch edit workflow follows these steps:

1. **Enter Batch Mode** - Click "Batch Edit" button in the user management table
2. **Select Users/Keys** - Use checkboxes to select multiple users or individual keys
3. **Configure Updates** - Enable specific fields and set their new values
4. **Confirm Changes** - Review the affected users/keys and field changes
5. **Execute Update** - Apply changes atomically with transaction guarantees

### Supported Batch Fields

**User Fields (via `batchUpdateUsers`):**
- `note` - User description/notes (string, max 200 characters)
- `tags` - Array of tags (max 20 tags, each max 32 characters)
- `rpm` - Requests per minute limit (integer, 1-10000)
- `dailyQuota` - Daily spending limit in USD (0-10000)
- `limit5hUsd` - 5-hour spending limit in USD (0-10000)
- `limitWeeklyUsd` - Weekly spending limit in USD (0-50000)
- `limitMonthlyUsd` - Monthly spending limit in USD (0-200000)

**Key Fields (via `batchUpdateKeys`):**
- `providerGroup` - Provider group assignment (string, max 200 characters)
- `limit5hUsd` - 5-hour spending limit (0-10000)
- `limitDailyUsd` - Daily spending limit (0-10000)
- `limitWeeklyUsd` - Weekly spending limit (0-50000)
- `limitMonthlyUsd` - Monthly spending limit (0-200000)
- `canLoginWebUi` - Web UI login permission (boolean)
- `isEnabled` - Key enabled status (boolean)

### Batch Size Limits

Both `batchUpdateUsers` and `batchUpdateKeys` enforce a maximum batch size of 500 items per request:

```typescript
// From /Users/ding/Github/claude-code-hub/src/actions/users.ts (line 614)
const MAX_BATCH_SIZE = 500;

// From /Users/ding/Github/claude-code-hub/src/actions/keys.ts (line 868)
const MAX_BATCH_SIZE = 500;
```

If you attempt to update more than 500 items, the operation will fail with a `BATCH_SIZE_EXCEEDED` error.

### Permission Requirements

All batch operations require administrator privileges. The system checks permissions at multiple levels:

1. **Session Authentication** - User must be logged in
2. **Role Verification** - User must have "admin" role
3. **Field-Level Permissions** - Certain fields can only be modified by admins

Non-admin users attempting batch operations receive `PERMISSION_DENIED` errors.

## Config/Commands

### Batch Update Users API

**Function:** `batchUpdateUsers`  
**Location:** `/Users/ding/Github/claude-code-hub/src/actions/users.ts` (lines 592-718)

**Interface:**
```typescript
export interface BatchUpdateUsersParams {
  userIds: number[];
  updates: {
    note?: string;
    tags?: string[];
    rpm?: number | null;
    dailyQuota?: number | null;
    limit5hUsd?: number | null;
    limitWeeklyUsd?: number | null;
    limitMonthlyUsd?: number | null;
  };
}

export interface BatchUpdateResult {
  requestedCount: number;
  updatedCount: number;
  updatedIds: number[];
}
```

**Usage Example:**
```typescript
import { batchUpdateUsers } from "@/actions/users";

const result = await batchUpdateUsers({
  userIds: [1, 2, 3, 4, 5],
  updates: {
    tags: ["premium", "team-a"],
    rpm: 120,
    dailyQuota: 50.00,
    limitMonthlyUsd: 500.00
  }
});

if (result.ok) {
  console.log(`Updated ${result.data.updatedCount} users`);
  console.log(`Updated user IDs: ${result.data.updatedIds.join(", ")}`);
} else {
  console.error(`Batch update failed: ${result.error}`);
}
```

### Batch Update Keys API

**Function:** `batchUpdateKeys`  
**Location:** `/Users/ding/Github/claude-code-hub/src/actions/keys.ts` (lines 839-1046)

**Interface:**
```typescript
export interface BatchUpdateKeysParams {
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

**Usage Example:**
```typescript
import { batchUpdateKeys } from "@/actions/keys";

const result = await batchUpdateKeys({
  keyIds: [10, 11, 12, 13, 14],
  updates: {
    providerGroup: "production",
    canLoginWebUi: true,
    limitDailyUsd: 25.00
  }
});

if (result.ok) {
  console.log(`Updated ${result.data.updatedCount} keys`);
} else {
  console.error(`Batch update failed: ${result.error}`);
}
```

### Batch User Query (Cursor Pagination)

**Function:** `getUsersBatch`  
**Location:** `/Users/ding/Github/claude-code-hub/src/actions/users.ts` (lines 431-585)

**Interface:**
```typescript
export interface GetUsersBatchParams {
  cursor?: number;
  limit?: number;
  searchTerm?: string;
  tagFilters?: string[];
  keyGroupFilters?: string[];
  statusFilter?: "all" | "active" | "expired" | "expiringSoon" | "enabled" | "disabled";
  sortBy?: "name" | "tags" | "expiresAt" | "rpm" | "limit5hUsd" | 
           "limitDailyUsd" | "limitWeeklyUsd" | "limitMonthlyUsd" | "createdAt";
  sortOrder?: "asc" | "desc";
}

export interface GetUsersBatchResult {
  users: UserDisplay[];
  nextCursor: number | null;
  hasMore: boolean;
}
```

**Usage Example:**
```typescript
import { getUsersBatch } from "@/actions/users";

const result = await getUsersBatch({
  cursor: 0,
  limit: 50,
  searchTerm: "team-a",
  tagFilters: ["premium"],
  statusFilter: "active",
  sortBy: "createdAt",
  sortOrder: "desc"
});

if (result.ok) {
  console.log(`Retrieved ${result.data.users.length} users`);
  console.log(`Has more: ${result.data.hasMore}`);
  console.log(`Next cursor: ${result.data.nextCursor}`);
}
```

### Repository Layer: findUserListBatch

**Function:** `findUserListBatch`  
**Location:** `/Users/ding/Github/claude-code-hub/src/repository/user.ts` (lines 151-312)

This is the underlying repository function that powers `getUsersBatch`. It performs offset-based pagination with filtering and sorting.

**Key Features:**
- Searches across user names, descriptions, provider groups, tags, and key names
- Multi-tag filtering with OR logic (users with ANY selected tag)
- Key group filtering with regex pattern matching
- Status filtering (active, expired, expiringSoon, enabled, disabled)
- Dynamic sorting by any user field

### UI Components

**Batch Edit Dialog:**
- **Location:** `/Users/ding/Github/claude-code-hub/src/app/[locale]/dashboard/_components/user/batch-edit/batch-edit-dialog.tsx`
- **Props:**
  ```typescript
  interface BatchEditDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    selectedUserIds: Set<number>;
    selectedKeyIds: Set<number>;
    onSuccess?: () => void;
  }
  ```

**Batch Edit Toolbar:**
- **Location:** `/Users/ding/Github/claude-code-hub/src/app/[locale]/dashboard/_components/user/batch-edit/batch-edit-toolbar.tsx`
- Provides "Enter Batch Mode" button and selection controls

**Batch User Section:**
- **Location:** `/Users/ding/Github/claude-code-hub/src/app/[locale]/dashboard/_components/user/batch-edit/batch-user-section.tsx`
- UI for editing user-specific fields

**Batch Key Section:**
- **Location:** `/Users/ding/Github/claude-code-hub/src/app/[locale]/dashboard/_components/user/batch-edit/batch-key-section.tsx`
- UI for editing key-specific fields

## Edge Cases

### Empty Update Validation

The system prevents batch updates with no actual changes. If you call `batchUpdateUsers` or `batchUpdateKeys` with an empty updates object, you'll receive an `EMPTY_UPDATE` error:

```typescript
// From /Users/ding/Github/claude-code-hub/src/actions/users.ts (lines 646-650)
const updates = validationResult.data;
const hasAnyUpdate = Object.values(updates).some((v) => v !== undefined);
if (!hasAnyUpdate) {
  return { ok: false, error: tError("EMPTY_UPDATE"), errorCode: ERROR_CODES.EMPTY_UPDATE };
}
```

### Non-Existent User/Key Handling

Before performing updates, the system validates that all requested users/keys exist. If any are missing, the entire transaction fails:

```typescript
// From /Users/ding/Github/claude-code-hub/src/actions/users.ts (lines 654-667)
await db.transaction(async (tx) => {
  const existingRows = await tx
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(and(inArray(usersTable.id, requestedIds), isNull(usersTable.deletedAt)));

  const existingSet = new Set(existingRows.map((r) => r.id));
  const missingIds = requestedIds.filter((id) => !existingSet.has(id));
  if (missingIds.length > 0) {
    throw new BatchUpdateError(
      `部分用户不存在: ${missingIds.join(", ")}`,
      ERROR_CODES.NOT_FOUND
    );
  }
  // ... rest of transaction
});
```

### Cannot Disable Last Key

When batch updating keys, the system prevents you from disabling the last enabled key for any user:

```typescript
// From /Users/ding/Github/claude-code-hub/src/actions/keys.ts (lines 997-1020)
// CRITICAL: Post-update validation to prevent race conditions
if (updates.isEnabled === false) {
  for (const userId of affectedUserIds) {
    const [remainingEnabled] = await tx
      .select({ count: count() })
      .from(keysTable)
      .where(
        and(
          eq(keysTable.userId, userId),
          eq(keysTable.isEnabled, true),
          isNull(keysTable.deletedAt)
        )
      );

    if (Number(remainingEnabled?.count ?? 0) < 1) {
      throw new BatchUpdateError(
        tError("CANNOT_DISABLE_LAST_KEY"),
        ERROR_CODES.OPERATION_FAILED
      );
    }
  }
}
```

This check runs both pre-update (to validate the operation) and post-update (to prevent race conditions).

### Transaction Rollback

All batch updates are wrapped in database transactions. If any part of the update fails, the entire operation is rolled back:

```typescript
await db.transaction(async (tx) => {
  // All operations within this callback are atomic
  // If any error is thrown, all changes are rolled back
});
```

### Row Count Mismatch

After updating, the system verifies that the number of updated rows matches the number of requested IDs:

```typescript
// From /Users/ding/Github/claude-code-hub/src/actions/users.ts (lines 692-696)
if (updatedIds.length !== requestedIds.length) {
  throw new BatchUpdateError("批量更新失败：更新行数不匹配", ERROR_CODES.UPDATE_FAILED);
}
```

This catches edge cases where some rows might have been deleted between the existence check and the actual update.

### Partial Success Handling

The UI layer handles partial success scenarios where user updates succeed but key updates fail (or vice versa):

```typescript
// From /Users/ding/Github/claude-code-hub/src/app/[locale]/dashboard/_components/user/batch-edit/batch-edit-dialog.tsx (lines 377-391)
if (anySuccess) {
  await queryClient.invalidateQueries({ queryKey: ["users"] });
  await queryClient.invalidateQueries({ queryKey: ["userKeyGroups"] });
  await queryClient.invalidateQueries({ queryKey: ["userTags"] });
}

// Only close dialog and clear selection when fully successful
// On partial success (some failed), keep dialog open to let user see results
if (anySuccess && !anyFailed) {
  onSuccess?.();
  handleRequestClose(false);
} else {
  // Close confirm dialog, but keep main dialog open for retry/review
  setConfirmOpen(false);
}
```

### Duplicate ID Handling

The system automatically deduplicates user/key IDs before processing:

```typescript
// From /Users/ding/Github/claude-code-hub/src/actions/users.ts (line 615)
const requestedIds = Array.from(new Set(params.userIds)).filter((id) => Number.isInteger(id));
```

### Null Value Handling

For quota fields, the system distinguishes between "no change" (undefined) and "clear the limit" (null):

```typescript
// From /Users/ding/Github/claude-code-hub/src/actions/users.ts (lines 676-684)
if (updates.dailyQuota !== undefined)
  dbUpdates.dailyLimitUsd =
    updates.dailyQuota === null ? null : updates.dailyQuota.toString();
if (updates.limit5hUsd !== undefined)
  dbUpdates.limit5hUsd = updates.limit5hUsd === null ? null : updates.limit5hUsd.toString();
```

Setting a field to `null` clears the limit (no restriction), while omitting the field (undefined) leaves the existing value unchanged.

## References

### Core Files

| File | Description |
|------|-------------|
| `/Users/ding/Github/claude-code-hub/src/actions/users.ts` | User batch operations (batchUpdateUsers, getUsersBatch) |
| `/Users/ding/Github/claude-code-hub/src/actions/keys.ts` | Key batch operations (batchUpdateKeys) |
| `/Users/ding/Github/claude-code-hub/src/repository/user.ts` | User repository with findUserListBatch |
| `/Users/ding/Github/claude-code-hub/src/lib/validation/schemas.ts` | Zod validation schemas (CreateUserSchema, UpdateUserSchema) |
| `/Users/ding/Github/claude-code-hub/src/lib/permissions/user-field-permissions.ts` | Field-level permission definitions |

### UI Component Files

| File | Description |
|------|-------------|
| `/Users/ding/Github/claude-code-hub/src/app/[locale]/dashboard/_components/user/batch-edit/batch-edit-dialog.tsx` | Main batch edit dialog component |
| `/Users/ding/Github/claude-code-hub/src/app/[locale]/dashboard/_components/user/batch-edit/batch-edit-toolbar.tsx` | Toolbar with batch mode controls |
| `/Users/ding/Github/claude-code-hub/src/app/[locale]/dashboard/_components/user/batch-edit/batch-user-section.tsx` | User fields editing section |
| `/Users/ding/Github/claude-code-hub/src/app/[locale]/dashboard/_components/user/batch-edit/batch-key-section.tsx` | Key fields editing section |
| `/Users/ding/Github/claude-code-hub/src/app/[locale]/dashboard/_components/user/batch-edit/field-card.tsx` | Reusable field card component |

### Error Codes

From `/Users/ding/Github/claude-code-hub/src/lib/utils/error-messages.ts`:

```typescript
export const ERROR_CODES = {
  // Validation errors
  REQUIRED_FIELD: "REQUIRED_FIELD",
  BATCH_SIZE_EXCEEDED: "BATCH_SIZE_EXCEEDED",
  EMPTY_UPDATE: "EMPTY_UPDATE",
  INVALID_FORMAT: "INVALID_FORMAT",
  
  // Auth errors
  UNAUTHORIZED: "UNAUTHORIZED",
  PERMISSION_DENIED: "PERMISSION_DENIED",
  
  // Server errors
  NOT_FOUND: "NOT_FOUND",
  UPDATE_FAILED: "UPDATE_FAILED",
  OPERATION_FAILED: "OPERATION_FAILED",
  
  // Business logic errors
  CANNOT_DISABLE_LAST_KEY: "CANNOT_DISABLE_LAST_KEY",
} as const;
```

### Validation Constants

From `/Users/ding/Github/claude-code-hub/src/lib/constants/user.constants.ts`:

```typescript
export const USER_LIMITS = {
  RPM: { MIN: 1, MAX: 10000 },
  DAILY_QUOTA: { MIN: 0, MAX: 10000 },
  LIMIT_5H: { MIN: 0, MAX: 10000 },
  LIMIT_WEEKLY: { MIN: 0, MAX: 50000 },
  LIMIT_MONTHLY: { MIN: 0, MAX: 200000 },
  LIMIT_TOTAL: { MIN: 0, MAX: 10000000 },
  CONCURRENT_SESSIONS: { MIN: 0, MAX: 1000 },
  TAGS_MAX: 20,
  TAG_LENGTH_MAX: 32,
  NAME_MAX: 64,
  NOTE_MAX: 200,
} as const;
```

### Type Definitions

**BatchUpdateError Class** (from `/Users/ding/Github/claude-code-hub/src/actions/users.ts`):
```typescript
class BatchUpdateError extends Error {
  readonly errorCode: string;

  constructor(message: string, errorCode: string) {
    super(message);
    this.name = "BatchUpdateError";
    this.errorCode = errorCode;
  }
}
```

**ActionResult Type** (from `/Users/ding/Github/claude-code-hub/src/actions/types.ts`):
```typescript
export type ActionResult<T = void> =
  | { ok: true; data?: T }
  | { ok: false; error: string; errorCode?: string; errorParams?: Record<string, string | number> };
```

### Related Operations

While not strictly "batch" operations, these related functions support bulk user management:

**User Creation:**
- `addUser` - Creates a user with a default key
- `createUserOnly` - Creates a user without a default key

**User Management:**
- `editUser` - Updates a single user
- `removeUser` - Soft-deletes a user
- `renewUser` - Extends user expiration date
- `toggleUserEnabled` - Enables/disables a user

**Statistics:**
- `getUserLimitUsage` - Gets current RPM and daily cost usage
- `getUserAllLimitUsage` - Gets all limit usage (5h, daily, weekly, monthly, total)
- `resetUserAllStatistics` - Resets all user statistics (admin only)

### Database Schema

The batch operations work with these main tables (defined in `/Users/ding/Github/claude-code-hub/src/drizzle/schema.ts`):

**Users Table:**
- `id` - Primary key
- `name` - User name
- `description` - User notes
- `tags` - JSONB array of tags
- `rpmLimit` - RPM limit
- `dailyLimitUsd` - Daily quota
- `limit5hUsd`, `limitWeeklyUsd`, `limitMonthlyUsd`, `limitTotalUsd` - Spending limits
- `isEnabled` - Enabled status
- `expiresAt` - Expiration date
- `deletedAt` - Soft delete timestamp

**Keys Table:**
- `id` - Primary key
- `userId` - Foreign key to users
- `name` - Key name
- `key` - API key value
- `providerGroup` - Provider group
- `isEnabled` - Enabled status
- `canLoginWebUi` - Web UI login permission
- Various limit fields (same as users)
- `deletedAt` - Soft delete timestamp

### Notes on Import/Export

The claude-code-hub project does not currently support CSV or Excel import/export for users. Database-level import/export is available via:

- **Export:** `/api/admin/database/export` - Exports full database as PostgreSQL dump
- **Import:** `/api/admin/database/import` - Imports PostgreSQL dump with SSE progress streaming

These are full database operations, not user-specific batch import/export features.
