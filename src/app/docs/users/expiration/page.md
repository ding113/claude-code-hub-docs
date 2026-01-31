---
dimensions:
  type:
    primary: reference
    detail: guide
  level: intermediate
standard_title: 用户过期管理
language: zh
---

# 用户过期管理

用户过期管理是 Claude Code Hub 中控制 API 访问权限的核心机制。通过为每个用户设置过期时间，你可以实现订阅制访问、试用期管理以及安全合规要求。

{% callout type="note" title="核心功能" %}
用户过期管理让你能够：
- **限时访问**：为账户设置具体的过期日期
- **订阅管理**：支持按周期续费的商业模式
- **试用控制**：自动禁用超期的试用账户
- **安全合规**：确保长期未使用的账户不会保持活跃
{% /callout %}

## 过期状态说明

系统通过 `isEnabled` 状态和 `expiresAt` 字段的组合来判断用户的访问权限。

### 四种过期状态

{% table %}
| 状态 | 条件 | 界面标识 | API 访问 |
|------|------|----------|----------|
| **已启用** | `isEnabled = true` 且 (`expiresAt` 为空或未来时间) | 绿色对勾 | 允许 |
| **即将过期** | `isEnabled = true` 且 `expiresAt` 在 72 小时内 | 黄色时钟 | 允许（带警告） |
| **已过期** | `isEnabled = true` 且 `expiresAt` 已过去 | 红色叉号 | 阻止 |
| **已禁用** | `isEnabled = false` | 灰色禁用 | 阻止 |
{% /table %}

系统使用 72 小时作为"即将过期"的阈值：

```typescript
// src/app/[locale]/dashboard/_components/user/user-key-table-row.tsx (line 84)
const EXPIRING_SOON_MS = 72 * 60 * 60 * 1000; // 72 小时（毫秒）
```

### 用户过期与密钥过期的区别

Claude Code Hub 提供两个层面的过期控制：

- **用户级别过期**（`users.expiresAt`）：控制整个账户的 API 访问权限
- **密钥级别过期**（`keys.expiresAt`）：控制单个 API 密钥的有效性

两者独立工作但遵循相似模式。当用户过期时，其所有密钥都无法使用；当某个密钥过期时，仅该密钥被阻止，用户账户和其他密钥不受影响。

## 延迟过期检查机制

系统采用"延迟检查"策略，而非后台定时任务。过期状态在 API 请求认证时实时检查：

```typescript
// src/app/v1/_lib/proxy/auth-guard.ts (lines 133-158)
// 2. 检查用户是否过期（延迟过期检查）
if (user.expiresAt && user.expiresAt.getTime() <= Date.now()) {
  logger.warn("[ProxyAuthenticator] 用户已过期", {
    userId: user.id,
    userName: user.name,
    expiresAt: user.expiresAt.toISOString(),
  });
  // 尽力而为：延迟标记用户为禁用状态（幂等操作）
  markUserExpired(user.id).catch((error) => {
    logger.error("[ProxyAuthenticator] 标记用户过期失败", {
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

这种设计的优势：
- 无需后台任务基础设施
- 过期检查在请求发生时进行，确保时效性
- `markUserExpired()` 幂等调用将 `isEnabled` 设为 false 以保持一致性
- 向用户返回包含过期日期的清晰错误信息

## 日期处理与边界时间

为避免时区混淆，所有过期日期都存储并比较于当天的最后时刻（23:59:59.999）：

```typescript
// src/app/[locale]/dashboard/_components/user/forms/quick-renew-dialog.tsx (lines 85-111)
const handleQuickSelect = useCallback(
  async (days: number) => {
    if (!user) return;
    setIsSubmitting(true);
    try {
      // 基准日期：取当前时间和原过期时间的较大值
      const baseDate =
        user.expiresAt && new Date(user.expiresAt) > new Date()
          ? new Date(user.expiresAt)
          : new Date();
      const newDate = addDays(baseDate, days);
      // 设置为当天最后时刻
      newDate.setHours(23, 59, 59, 999);
      const result = await onConfirm(
        user.id,
        newDate,
        !user.isEnabled && enableOnRenew ? true : undefined
      );
      if (result.ok) {
        onOpenChange(false);
      }
    } finally {
      setIsSubmitting(false);
    }
  },
  [user, enableOnRenew, onConfirm, onOpenChange]
);
```

这样确保：
- 过期日期为"2025-12-31"的用户可以在当天全天使用 API
- 跨时区时不会产生歧义
- UI 中只需显示日期部分（YYYY-MM-DD 格式）

## 数据库结构

### 用户表过期字段

```typescript
// src/drizzle/schema.ts (lines 63-65, 81-84)
// users 表
export const users = pgTable('users', {
  // ... 其他字段 ...
  
  // 用户状态和过期管理
  isEnabled: boolean('is_enabled').notNull().default(true),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  
  // ... 其他字段 ...
}, (table) => ({
  // 优化过期用户查询的复合索引（用于定时任务），仅索引未删除的用户
  usersEnabledExpiresAtIdx: index('idx_users_enabled_expires_at')
    .on(table.isEnabled, table.expiresAt)
    .where(sql`${table.deletedAt} IS NULL`),
  // ... 其他索引 ...
}));

// keys 表（类似结构）
export const keys = pgTable('keys', {
  // ... 其他字段 ...
  isEnabled: boolean('is_enabled').default(true),  // 注意：可为空，与 users 表不同
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  // ... 其他字段 ...
});
```

**用户表与密钥表的关键区别：**
- 用户表：`isEnabled` 为 `NOT NULL DEFAULT true`
- 密钥表：`isEnabled` 可为空，仅默认 `true`
- 只有用户表有 `(isEnabled, expiresAt)` 复合索引

## 验证规则

### 创建用户时的过期时间验证

```typescript
// src/lib/validation/schemas.ts (lines 91-142)
export const CreateUserSchema = z.object({
  // ... 其他字段 ...
  
  // 用户状态和过期管理
  isEnabled: z.boolean().optional().default(true),
  expiresAt: z.preprocess(
    (val) => {
      // null/undefined/空字符串 -> 视为未设置
      if (val === null || val === undefined || val === "") return undefined;

      // 已经是 Date 对象
      if (val instanceof Date) {
        if (Number.isNaN(val.getTime())) return val;
        return val;
      }

      // 字符串日期 -> 转换为 Date 对象
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
          return; // 允许空值
        }

        const now = new Date();

        // 检查是否为未来时间
        if (date <= now) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "过期时间必须是将来时间",
          });
        }

        // 限制最大续期时长（10 年）
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
  // ... 其他字段 ...
});
```

验证规则：
- 创建时过期日期必须是未来时间
- 最大过期时间为 10 年后
- 更新时允许设置过去的时间（用于立即禁用用户）
- 空值/null 表示"永不过期"

## 服务器操作

### 续期用户

```typescript
// src/actions/users.ts (lines 1325-1402)
export async function renewUser(
  userId: number,
  data: {
    expiresAt: string; // ISO 8601 字符串，避免序列化问题
    enableUser?: boolean; // 是否同时启用用户
  }
): Promise<ActionResult> {
  // 权限检查：只有管理员可以续期
  const session = await getSession();
  if (!session || session.user.role !== "admin") {
    return {
      ok: false,
      error: tError("PERMISSION_DENIED"),
      errorCode: ERROR_CODES.PERMISSION_DENIED,
    };
  }

  // 解析并验证过期日期（使用系统时区）
  const timezone = await resolveSystemTimezone();
  const expiresAt = parseDateInputAsTimezone(data.expiresAt, timezone);

  // 验证过期时间
  const validationResult = await validateExpiresAt(expiresAt, tError);
  if (validationResult) {
    return {
      ok: false,
      error: validationResult.error,
      errorCode: validationResult.errorCode,
    };
  }

  // 检查用户是否存在
  const user = await findUserById(userId);
  if (!user) {
    return {
      ok: false,
      error: tError("USER_NOT_FOUND"),
      errorCode: ERROR_CODES.NOT_FOUND,
    };
  }

  // 更新用户过期日期，并可选择同时启用用户
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

### 验证过期时间

```typescript
// src/actions/users.ts (lines 102-135)
async function validateExpiresAt(
  expiresAt: Date,
  tError: Awaited<ReturnType<typeof getTranslations<"errors">>>,
  options: { allowPast?: boolean } = {}
): Promise<{ error: string; errorCode: string } | null> {
  // 检查是否为有效日期
  if (Number.isNaN(expiresAt.getTime())) {
    return {
      error: tError("INVALID_FORMAT", { field: tError("EXPIRES_AT_FIELD") }),
      errorCode: ERROR_CODES.INVALID_FORMAT,
    };
  }

  // 拒绝过去或当前时间（可配置为允许过去时间以实现立即过期）
  const now = new Date();
  if (!options.allowPast && expiresAt <= now) {
    return {
      error: tError("EXPIRES_AT_MUST_BE_FUTURE"),
      errorCode: "EXPIRES_AT_MUST_BE_FUTURE",
    };
  }

  // 限制最大续期时长（10 年）
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

### 标记用户过期

```typescript
// src/repository/user.ts (lines 448-460)
/**
 * 标记过期用户为禁用状态（幂等操作）
 * 仅在用户当前启用时更新
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

## 状态筛选

用户列表支持按过期状态筛选：

```typescript
// src/repository/user.ts (lines 221-248)
// 状态筛选
if (statusFilter && statusFilter !== "all") {
  switch (statusFilter) {
    case "active":
      // 用户已启用且未过期（或永不过期）
      conditions.push(
        sql`(${users.expiresAt} IS NULL OR ${users.expiresAt} >= NOW()) AND ${users.isEnabled} = true`
      );
      break;
    case "expired":
      // 用户已过期（expiresAt 在过去）
      conditions.push(sql`${users.expiresAt} < NOW()`);
      break;
    case "expiringSoon":
      // 用户在 7 天内过期
      conditions.push(
        sql`${users.expiresAt} IS NOT NULL AND ${users.expiresAt} >= NOW() AND ${users.expiresAt} <= NOW() + INTERVAL '7 days'`
      );
      break;
    case "enabled":
      // 用户已启用（不考虑过期状态）
      conditions.push(sql`${users.isEnabled} = true`);
      break;
    case "disabled":
      // 用户已禁用
      conditions.push(sql`${users.isEnabled} = false`);
      break;
  }
}
```

可用的状态筛选器：
- `all` - 无筛选
- `active` - 已启用且未过期（或无过期时间）
- `expired` - 已过期
- `expiringSoon` - 7 天内过期
- `enabled` - 已启用（不考虑过期状态）
- `disabled` - 已禁用

## 界面操作

### 快捷续期

管理界面提供快捷续期功能，支持预设选项：

{% table %}
| 选项 | 时长 | 用途 |
|------|------|------|
| 7 天 | 一周 | 短期试用延长 |
| 30 天 | 一个月 | 月度订阅 |
| 90 天 | 三个月 | 季度订阅 |
| 1 年 | 十二个月 | 年度订阅 |
| 自定义 | 任意日期 | 灵活调整 |
{% /table %}

### 乐观更新与回滚

UI 实现乐观更新以提供即时反馈，失败时自动回滚：

```typescript
// src/app/[locale]/dashboard/_components/user/user-management-table.tsx (lines 351-392)
const handleQuickRenewConfirm = async (
  userId: number,
  expiresAt: Date,
  enableUser?: boolean
): Promise<{ ok: boolean }> => {
  // 乐观更新：立即更新 UI
  setOptimisticUserExpiries((prev) => {
    const next = new Map(prev);
    next.set(userId, expiresAt);
    return next;
  });

  try {
    const res = await renewUser(userId, { expiresAt: expiresAt.toISOString(), enableUser });
    if (!res.ok) {
      // 失败时回滚
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
    // 异常时回滚
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

## 时区处理

系统谨慎处理时区以确保一致行为：

```typescript
// src/lib/utils/date-input.ts (lines 25-63)
export function parseDateInputAsTimezone(input: string, timezone: string): Date {
  // 仅日期格式（YYYY-MM-DD）：解释为指定时区的 23:59:59
  if (/^\d{4}-\d{2}-\d{2}$/.test(input)) {
    const localDateTime = parse(`${input} 23:59:59`, "yyyy-MM-dd HH:mm:ss", new Date());
    return fromZonedTime(localDateTime, timezone);  // 转换为 UTC
  }

  // 带时区标识符（Z 或偏移量）：直接解析为绝对时间点
  const hasTimezoneDesignator = /([zZ]|[+-]\d{2}:?\d{2})$/.test(input);
  if (hasTimezoneDesignator) {
    return new Date(input);  // 已是 UTC
  }

  // 无时区的 ISO 日期时间：视为本地时间，转换为 UTC
  const localDate = new Date(input);
  return fromZonedTime(localDate, timezone);  // 转换为 UTC
}
```

系统使用配置的系统时区（来自 `system_settings.timezone` 或 `TZ` 环境变量）进行所有日期边界计算。

## API 错误响应

当用户过期时，API 返回：

```json
{
  "error": {
    "type": "user_expired",
    "message": "用户账户已于 2025-01-15 过期。请续费订阅。"
  }
}
```

HTTP 状态码：401 Unauthorized

## 最佳实践

### 设置合理的过期策略

1. **试用期用户**：设置 7-14 天的短期过期
2. **月度订阅**：设置 30 天过期，每月续期
3. **年度订阅**：设置 365 天过期，提前提醒续费
4. **内部用户**：可设置为永不过期（留空）

### 监控即将过期的用户

定期查看"即将过期"筛选结果，主动通知用户续费：

```sql
-- 查询 7 天内过期的用户
SELECT * FROM users 
WHERE deleted_at IS NULL 
  AND expires_at >= NOW() 
  AND expires_at <= NOW() + INTERVAL '7 days';
```

### 处理过期后的数据

用户过期仅阻止 API 访问，不会删除用户数据：
- 历史使用记录保留
- 会话记录保留
- 密钥配置保留

如需彻底清理，请使用软删除功能。

## 相关文档

- [用户管理](/docs/users/management) - 了解用户创建和编辑
- [API 认证](/docs/api-compatibility/authentication) - 了解 API 密钥认证流程
- [数据库设计](/docs/architecture/database-schema) - 了解完整的数据库结构
