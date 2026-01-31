# User Expiration Management - Round 1 Exploration Draft

## Intent Analysis

The user expiration management system in Claude Code Hub serves a critical role in controlling access to AI API resources. This feature allows administrators to:

1. **Time-box user access** - Set specific expiration dates when user accounts should automatically become inactive
2. **Implement subscription-based models** - Support business models where users pay for access periods
3. **Manage trial periods** - Automatically disable trial accounts after a set duration
4. **Maintain security hygiene** - Ensure dormant accounts don't remain active indefinitely

The system distinguishes between two types of access control:
- **User-level expiration** (`expiresAt` on users table) - Controls whether the user account can make API requests
- **Key-level expiration** (`expiresAt` on keys table) - Controls individual API key validity

Both mechanisms work independently but follow similar patterns. When a user expires, all their keys become unusable. When a key expires, only that specific key is blocked.

## Behavior Summary

### Core Expiration States

The system recognizes four distinct expiration states for users:

| State | Condition | Visual Indicator | API Access |
|-------|-----------|------------------|------------|
| **Active** | `isEnabled = true` AND (`expiresAt` is null OR future) | Green checkmark | Allowed |
| **Expiring Soon** | `isEnabled = true` AND `expiresAt` within 72 hours | Yellow clock icon | Allowed (with warning) |
| **Expired** | `isEnabled = true` AND `expiresAt` in past | Red X circle | Blocked |
| **Disabled** | `isEnabled = false` | Gray circle-off | Blocked |

### Lazy Expiration Enforcement

The system uses a "lazy" expiration checking strategy. Rather than running a background job to disable expired users, expiration is checked at the point of API request authentication:

```typescript
// From: /Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/auth-guard.ts (lines 133-158)
// 2. Check if user is expired (lazy expiration check)
if (user.expiresAt && user.expiresAt.getTime() <= Date.now()) {
  logger.warn("[ProxyAuthenticator] User has expired", {
    userId: user.id,
    userName: user.name,
    expiresAt: user.expiresAt.toISOString(),
  });
  // Best-effort lazy mark user as disabled (idempotent)
  markUserExpired(user.id).catch((error) => {
    logger.error("[ProxyAuthenticator] Failed to mark user as expired", {
      userId: user.id,
      error: error instanceof Error ? error.message : String(error),
    });
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

This approach has several advantages:
- No background job infrastructure required
- Expiration check happens exactly when it matters (at request time)
- Idempotent `markUserExpired()` call ensures `isEnabled` is set to false for consistency
- Clear error message returned to user with expiration date

### End-of-Day Time Handling

To avoid timezone confusion, all expiration dates are stored and compared at the end of the day (23:59:59.999):

```typescript
// From: /Users/ding/Github/claude-code-hub/src/app/[locale]/dashboard/_components/user/forms/quick-renew-dialog.tsx (lines 90-97)
const handleQuickSelect = useCallback(async (days: number) => {
  // Base date: max(current time, original expiry time)
  const baseDate =
    user.expiresAt && new Date(user.expiresAt) > new Date()
      ? new Date(user.expiresAt)
      : new Date();
  const newDate = addDays(baseDate, days);
  // Set to end of day
  newDate.setHours(23, 59, 59, 999);
  const result = await onConfirm(
    user.id,
    newDate,
    !user.isEnabled && enableOnRenew ? true : undefined
  );
}, [user, enableOnRenew, onConfirm, onOpenChange]);
```

This ensures that:
- A user expiring on "2025-12-31" can use the API throughout that entire day
- No ambiguity about exact expiration moment across timezones
- Simple date-only display in UI (YYYY-MM-DD format)

## Config/Commands

### Database Schema

The expiration fields are defined in the Drizzle schema:

```typescript
// From: /Users/ding/Github/claude-code-hub/src/drizzle/schema.ts (lines 63-65, 81-84)
// Users table
export const users = pgTable('users', {
  // ... other fields ...
  
  // User status and expiry management
  isEnabled: boolean('is_enabled').notNull().default(true),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  
  // ... other fields ...
}, (table) => ({
  // 优化过期用户查询的复合索引（用于定时任务），仅索引未删除的用户
  usersEnabledExpiresAtIdx: index('idx_users_enabled_expires_at')
    .on(table.isEnabled, table.expiresAt)
    .where(sql`${table.deletedAt} IS NULL`),
  // ... other indexes ...
}));

// Keys table (similar structure)
export const keys = pgTable('keys', {
  // ... other fields ...
  isEnabled: boolean('is_enabled').default(true),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  // ... other fields ...
});
```

### Validation Schema

User creation and updates use Zod schemas with expiration validation:

```typescript
// From: /Users/ding/Github/claude-code-hub/src/lib/validation/schemas.ts (lines 91-142)
export const CreateUserSchema = z.object({
  // ... other fields ...
  
  // User status and expiry management
  isEnabled: z.boolean().optional().default(true),
  expiresAt: z.preprocess(
    (val) => {
      // null/undefined/empty string -> treat as not set
      if (val === null || val === undefined || val === "") return undefined;

      // Already a Date object
      if (val instanceof Date) {
        if (Number.isNaN(val.getTime())) return val;
        return val;
      }

      // String date -> convert to Date object
      if (typeof val === "string") {
        const date = new Date(val);
        if (Number.isNaN(date.getTime())) return val;
        return date;
      }

      return val;
    },
    z
      .date()
      .optional()
      .superRefine((date, ctx) => {
        if (!date) {
          return; // Allow null value
        }

        const now = new Date();

        // Check if it's a future time
        if (date <= now) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "过期时间必须是将来时间",
          });
        }

        // Limit maximum renewal duration (10 years)
        const maxExpiry = new Date(now.getTime());
        maxExpiry.setFullYear(maxExpiry.getFullYear() + 10);
        if (date > maxExpiry) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "过期时间不能超过10年",
          });
        }
      })
  ),
  // ... other fields ...
});
```

Validation rules:
- Expiration date must be in the future (for creation)
- Maximum expiration is 10 years from now
- Update schema allows past dates (to immediately expire a user)
- Empty/null values mean "never expires"

### Server Actions

#### renewUser - Extend User Expiration

```typescript
// From: /Users/ding/Github/claude-code-hub/src/actions/users.ts (lines 1325-1402)
export async function renewUser(
  userId: number,
  data: {
    expiresAt: string; // ISO 8601 string to avoid serialization issues
    enableUser?: boolean; // Whether to also enable the user
  }
): Promise<ActionResult> {
  // Permission check: only admin can renew
  const session = await getSession();
  if (!session || session.user.role !== "admin") {
    return {
      ok: false,
      error: tError("PERMISSION_DENIED"),
      errorCode: ERROR_CODES.PERMISSION_DENIED,
    };
  }

  // Parse and validate expiration date (using system timezone)
  const timezone = await resolveSystemTimezone();
  const expiresAt = parseDateInputAsTimezone(data.expiresAt, timezone);

  // Validate expiration time
  const validationResult = await validateExpiresAt(expiresAt, tError);
  if (validationResult) {
    return {
      ok: false,
      error: validationResult.error,
      errorCode: validationResult.errorCode,
    };
  }

  // Check if user exists
  const user = await findUserById(userId);
  if (!user) {
    return {
      ok: false,
      error: tError("USER_NOT_FOUND"),
      errorCode: ERROR_CODES.NOT_FOUND,
    };
  }

  // Update user expiration date and optionally enable user
  const updateData: {
    expiresAt: Date;
    isEnabled?: boolean;
  } = {
    expiresAt,
  };

  if (data.enableUser === true) {
    updateData.isEnabled = true;
  }

  const updated = await updateUser(userId, updateData);
  // ...
}
```

#### validateExpiresAt - Common Validation Logic

```typescript
// From: /Users/ding/Github/claude-code-hub/src/actions/users.ts (lines 102-135)
async function validateExpiresAt(
  expiresAt: Date,
  tError: Awaited<ReturnType<typeof getTranslations<"errors">>>,
  options: { allowPast?: boolean } = {}
): Promise<{ error: string; errorCode: string } | null> {
  // Check if it's a valid date
  if (Number.isNaN(expiresAt.getTime())) {
    return {
      error: tError("INVALID_FORMAT", { field: tError("EXPIRES_AT_FIELD") }),
      errorCode: ERROR_CODES.INVALID_FORMAT,
    };
  }

  // Reject past or current time (configurable to allow past time for immediate expiration)
  const now = new Date();
  if (!options.allowPast && expiresAt <= now) {
    return {
      error: tError("EXPIRES_AT_MUST_BE_FUTURE"),
      errorCode: "EXPIRES_AT_MUST_BE_FUTURE",
    };
  }

  // Limit maximum renewal duration (10 years)
  const maxExpiry = new Date(now);
  maxExpiry.setFullYear(maxExpiry.getFullYear() + 10);
  if (expiresAt > maxExpiry) {
    return {
      error: tError("EXPIRES_AT_TOO_FAR"),
      errorCode: "EXPIRES_AT_TOO_FAR",
    };
  }

  return null;
}
```

#### markUserExpired - Idempotent Expiration Marker

```typescript
// From: /Users/ding/Github/claude-code-hub/src/repository/user.ts (lines 448-460)
/**
 * Mark an expired user as disabled (idempotent operation)
 * Only updates if the user is currently enabled
 */
export async function markUserExpired(userId: number): Promise<boolean> {
  const result = await db
    .update(users)
    .set({ isEnabled: false, updatedAt: new Date() })
    .where(and(eq(users.id, userId), eq(users.isEnabled, true), isNull(users.deletedAt)))
    .returning({ id: users.id });

  return result.length > 0;
}
```

### Status Filtering

The user list supports filtering by expiration status:

```typescript
// From: /Users/ding/Github/claude-code-hub/src/repository/user.ts (lines 221-248)
// Status filter
if (statusFilter && statusFilter !== "all") {
  switch (statusFilter) {
    case "active":
      // User is enabled and either never expires or expires in the future
      conditions.push(
        sql`(${users.expiresAt} IS NULL OR ${users.expiresAt} >= NOW()) AND ${users.isEnabled} = true`
      );
      break;
    case "expired":
      // User has expired (expiresAt is in the past)
      conditions.push(sql`${users.expiresAt} < NOW()`);
      break;
    case "expiringSoon":
      // User expires within 7 days
      conditions.push(
        sql`${users.expiresAt} IS NOT NULL AND ${users.expiresAt} >= NOW() AND ${users.expiresAt} <= NOW() + INTERVAL '7 days'`
      );
      break;
    case "enabled":
      // User is enabled regardless of expiration
      conditions.push(sql`${users.isEnabled} = true`);
      break;
    case "disabled":
      // User is disabled
      conditions.push(sql`${users.isEnabled} = false`);
      break;
  }
}
```

Available status filters:
- `all` - No filtering
- `active` - Enabled and not expired (or no expiration)
- `expired` - Has passed expiration date
- `expiringSoon` - Expires within 7 days
- `enabled` - Is enabled (regardless of expiration)
- `disabled` - Is disabled

## Edge Cases

### 1. Timezone Handling

The system handles timezones carefully to ensure consistent behavior:

```typescript
// From: /Users/ding/Github/claude-code-hub/src/lib/utils/date-input.ts
export function parseDateInputAsTimezone(dateInput: string, timezone: string): Date {
  // Parse the date input as being in the specified timezone
  const date = new Date(dateInput);
  
  // Convert to UTC for storage
  return new Date(date.toLocaleString("en-US", { timeZone: timezone }));
}
```

The system uses the configured system timezone (from `system_settings.timezone` or `TZ` environment variable) for all date boundary calculations.

### 2. Optimistic Updates and Rollback

The UI implements optimistic updates for immediate feedback, with rollback on failure:

```typescript
// From: /Users/ding/Github/claude-code-hub/src/app/[locale]/dashboard/_components/user/user-management-table.tsx (lines 356-392)
const handleQuickRenewConfirm = async (
  userId: number,
  expiresAt: Date,
  enableUser?: boolean
): Promise<{ ok: boolean }> => {
  // Optimistic update: immediately update UI
  setOptimisticUserExpiries((prev) => {
    const next = new Map(prev);
    next.set(userId, expiresAt);
    return next;
  });

  try {
    const res = await renewUser(userId, { expiresAt: expiresAt.toISOString(), enableUser });
    if (!res.ok) {
      // Rollback on failure
      setOptimisticUserExpiries((prev) => {
        const next = new Map(prev);
        next.delete(userId);
        return next;
      });
      toast.error(res.error || tUserMgmt("quickRenew.failed"));
      return { ok: false };
    }
    toast.success(tUserMgmt("quickRenew.success"));
    queryClient.invalidateQueries({ queryKey: ["users"] });
    router.refresh();
    return { ok: true };
  } catch (error) {
    // Rollback on error
    setOptimisticUserExpiries((prev) => {
      const next = new Map(prev);
      next.delete(userId);
      return next;
    });
    toast.error(tUserMgmt("quickRenew.failed"));
    return { ok: false };
  }
};
```

### 3. Key Expiration vs User Expiration

Keys have independent expiration from users. A key can expire while the user remains active:

```typescript
// From: /Users/ding/Github/claude-code-hub/src/repository/key.ts (lines 402-437)
export async function findActiveKeyByKeyString(keyString: string): Promise<Key | null> {
  const [key] = await db
    .select({ /* ... */ })
    .from(keys)
    .where(
      and(
        eq(keys.key, keyString),
        isNull(keys.deletedAt),
        eq(keys.isEnabled, true),
        or(isNull(keys.expiresAt), gt(keys.expiresAt, new Date()))
      )
    );

  if (!key) return null;
  return toKey(key);
}
```

However, if a user expires, all their keys become unusable because the auth guard checks user expiration first.

### 4. Concurrent Renewal Race Condition

If two administrators renew the same user simultaneously:

1. Both requests pass validation (user exists, date is valid)
2. Both execute `updateUser()` 
3. The last write wins (no locking mechanism)

This is generally acceptable because:
- Both renewals are likely setting future dates
- The `updatedAt` field will reflect the last change
- No data corruption occurs

### 5. Expiration During Active Session

If a user's expiration passes while they have an active API session:

1. Existing requests continue normally (expiration checked at request start)
2. Subsequent requests fail with 401 "user_expired" error
3. The `markUserExpired()` call sets `isEnabled = false` for consistency

There is no mechanism to terminate in-flight requests when expiration occurs.

### 6. Null/Undefined Expiration Semantics

- `null` or `undefined` `expiresAt` means the user never expires
- Empty string in forms is treated as "no expiration"
- Once set, expiration can be cleared by setting to `null`

### 7. Database Index for Expiration Queries

The composite index on `(isEnabled, expiresAt)` optimizes the common query patterns:

```sql
-- Finding active users (uses partial index)
SELECT * FROM users 
WHERE deleted_at IS NULL 
  AND is_enabled = true 
  AND (expires_at IS NULL OR expires_at >= NOW());

-- Finding expired users
SELECT * FROM users 
WHERE deleted_at IS NULL 
  AND expires_at < NOW();

-- Finding users expiring soon
SELECT * FROM users 
WHERE deleted_at IS NULL 
  AND expires_at >= NOW() 
  AND expires_at <= NOW() + INTERVAL '7 days';
```

## References

### Core Files

| File | Purpose |
|------|---------|
| `/Users/ding/Github/claude-code-hub/src/drizzle/schema.ts` | Database schema with `expiresAt` fields |
| `/Users/ding/Github/claude-code-hub/src/types/user.ts` | TypeScript types for User with expiration |
| `/Users/ding/Github/claude-code-hub/src/lib/validation/schemas.ts` | Zod validation schemas for expiration |
| `/Users/ding/Github/claude-code-hub/src/repository/user.ts` | Database queries including `markUserExpired` |
| `/Users/ding/Github/claude-code-hub/src/actions/users.ts` | Server actions: `renewUser`, `validateExpiresAt` |
| `/Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/auth-guard.ts` | Lazy expiration check in API auth |

### UI Components

| File | Purpose |
|------|---------|
| `/Users/ding/Github/claude-code-hub/src/app/[locale]/dashboard/_components/user/user-management-table.tsx` | Main table with expiration column |
| `/Users/ding/Github/claude-code-hub/src/app/[locale]/dashboard/_components/user/user-key-table-row.tsx` | Row component with status indicators |
| `/Users/ding/Github/claude-code-hub/src/app/[locale]/dashboard/_components/user/forms/quick-renew-dialog.tsx` | Quick renew with preset options |
| `/Users/ding/Github/claude-code-hub/src/app/[locale]/dashboard/_components/user/forms/user-form.tsx` | Create/edit form with date picker |
| `/Users/ding/Github/claude-code-hub/src/app/[locale]/dashboard/_components/user/user-list.tsx` | Sidebar with renew actions |

### i18n Translations

Translation keys for expiration UI (in `messages/*/dashboard.json`):

```json
{
  "userList": {
    "expiresAt": "过期时间",
    "expiresAtHint": "用户过期后将自动禁用",
    "status": {
      "active": "已启用",
      "expiringSoon": "即将过期",
      "expired": "已过期",
      "disabled": "已禁用"
    },
    "actions": {
      "renew": "续期",
      "renew30d": "续期 30 天",
      "renew90d": "续期 90 天",
      "renew1y": "续期 1 年",
      "renewCustom": "自定义...",
      "enableOnRenew": "同时启用用户"
    }
  },
  "userManagement": {
    "quickRenew": {
      "title": "快捷续期",
      "description": "为用户 {userName} 设置新的过期时间",
      "currentExpiry": "当前到期时间",
      "neverExpires": "永不过期",
      "expired": "已过期",
      "quickOptions": {
        "7days": "7 天",
        "30days": "30 天",
        "90days": "90 天",
        "1year": "1 年"
      },
      "enableOnRenew": "同时启用用户"
    }
  },
  "userForm": {
    "expiresAt": {
      "label": "过期时间",
      "placeholder": "留空表示永不过期",
      "description": "用户过期后将自动禁用"
    }
  }
}
```

### API Error Codes

When a user is expired, the API returns:

```json
{
  "error": {
    "type": "user_expired",
    "message": "用户账户已于 2025-01-15 过期。请续费订阅。"
  }
}
```

HTTP Status: 401 Unauthorized

### Environment Variables

No specific environment variables control expiration behavior. The feature is always enabled and managed per-user through the database.

### Migration History

The expiration fields were added in early schema migrations. Check `drizzle/meta/` for historical changes:

```bash
# Look for migrations that added expires_at columns
grep -r "expires_at" /Users/ding/Github/claude-code-hub/drizzle/meta/
```

---

*This draft was generated by exploring the actual claude-code-hub codebase. All code snippets reference absolute file paths in the source project.*
