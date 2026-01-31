# Round 2: 用户 CRUD 操作 (User CRUD Operations)

## 1. 功能概述

用户 CRUD 操作是 Claude Code Hub 平台的核心功能模块，提供完整的用户生命周期管理。该系统支持多租户架构，通过精细的配额控制、访问限制和分层权限，实现对 API 消费者的管理。

### 1.1 核心能力

- **用户创建**: 支持创建带有多维度配额限制的用户账户
- **用户查询**: 提供分页、搜索、筛选等多种查询模式
- **用户更新**: 支持字段级权限控制的部分更新
- **用户删除**: 软删除机制保留历史数据
- **批量操作**: 支持批量更新用户属性
- **配额监控**: 实时追踪用户在各时间维度的消费情况

### 1.2 用户角色体系

| 角色 | 权限范围 |
|------|----------|
| `admin` | 管理所有用户、查看全部数据、配置系统 |
| `user` | 仅查看和管理自己的数据 |

---

## 2. 数据模型

### 2.1 数据库 Schema

**文件**: `/Users/ding/Github/claude-code-hub/src/drizzle/schema.ts` (lines 36-88)

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
  
  // 多时间维度配额
  limit5hUsd: numeric('limit_5h_usd', { precision: 10, scale: 2 }),
  limitWeeklyUsd: numeric('limit_weekly_usd', { precision: 10, scale: 2 }),
  limitMonthlyUsd: numeric('limit_monthly_usd', { precision: 10, scale: 2 }),
  limitTotalUsd: numeric('limit_total_usd', { precision: 10, scale: 2 }),
  limitConcurrentSessions: integer('limit_concurrent_sessions'),
  
  // 每日限额重置配置
  dailyResetMode: dailyResetModeEnum('daily_reset_mode').default('fixed').notNull(),
  dailyResetTime: varchar('daily_reset_time', { length: 5 }).default('00:00').notNull(),
  
  // 状态管理
  isEnabled: boolean('is_enabled').notNull().default(true),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  
  // 访问限制
  allowedClients: jsonb('allowed_clients').$type<string[]>().default([]),
  allowedModels: jsonb('allowed_models').$type<string[]>().default([]),
  
  // 时间戳
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (table) => ({
  // 复合索引：按角色排序（管理员优先）
  usersActiveRoleSortIdx: index('idx_users_active_role_sort')
    .on(table.deletedAt, table.role, table.id)
    .where(sql`${table.deletedAt} IS NULL`),
  // 复合索引：过期用户查询（用于定时任务）
  usersEnabledExpiresAtIdx: index('idx_users_enabled_expires_at')
    .on(table.isEnabled, table.expiresAt)
    .where(sql`${table.deletedAt} IS NULL`),
  // 基础索引
  usersCreatedAtIdx: index('idx_users_created_at').on(table.createdAt),
  usersDeletedAtIdx: index('idx_users_deleted_at').on(table.deletedAt),
}));
```

### 2.2 TypeScript 类型定义

**文件**: `/Users/ding/Github/claude-code-hub/src/types/user.ts`

#### User 接口 (lines 1-32)

```typescript
export interface User {
  id: number;
  name: string;
  description: string;
  role: "admin" | "user";
  rpm: number | null;              // 每分钟请求数限制，null = 无限制
  dailyQuota: number | null;       // 每日额度限制（美元），null = 无限制
  providerGroup: string | null;    // 供应商分组
  tags?: string[];                 // 用户标签
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date;
  
  // 用户级配额字段
  limit5hUsd?: number;             // 5小时消费上限
  limitWeeklyUsd?: number;         // 周消费上限
  limitMonthlyUsd?: number;        // 月消费上限
  limitTotalUsd?: number | null;   // 总消费上限
  limitConcurrentSessions?: number;// 并发 Session 上限
  
  // 每日限额重置模式
  dailyResetMode: "fixed" | "rolling";
  dailyResetTime: string;          // HH:mm 格式
  
  // 用户状态
  isEnabled: boolean;
  expiresAt?: Date | null;
  
  // 访问限制
  allowedClients?: string[];       // 空数组 = 无限制
  allowedModels?: string[];        // 空数组 = 无限制
}
```

#### CreateUserData 接口 (lines 37-60)

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

#### UpdateUserData 接口 (lines 65-88)

与 CreateUserData 结构相同，但所有字段均为可选（`?:`），支持部分更新。

#### UserDisplay 接口 (lines 135-161)

前端展示用的用户对象，包含关联的密钥信息和统计：

```typescript
export interface UserDisplay {
  id: number;
  name: string;
  note?: string;
  role: "admin" | "user";
  rpm: number | null;
  dailyQuota: number | null;
  providerGroup?: string | null;
  tags?: string[];
  keys: UserKeyDisplay[];
  limit5hUsd?: number | null;
  limitWeeklyUsd?: number | null;
  limitMonthlyUsd?: number | null;
  limitTotalUsd?: number | null;
  limitConcurrentSessions?: number | null;
  dailyResetMode?: "fixed" | "rolling";
  dailyResetTime?: string;
  isEnabled: boolean;
  expiresAt?: Date | null;
  allowedClients?: string[];
  allowedModels?: string[];
}
```

### 2.3 数据转换器

**文件**: `/Users/ding/Github/claude-code-hub/src/repository/_shared/transformers.ts` (lines 10-55)

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

**关键转换逻辑**:
- `rpm` 和 `dailyQuota`: 0 或负数转换为 `null`（表示无限制）
- 数值字段: 从字符串（数据库 numeric 类型）转换为 number
- 日期字段: 转换为 JavaScript Date 对象
- 数组字段: 提供默认空数组

---

## 3. 验证 Schema

### 3.1 CreateUserSchema

**文件**: `/Users/ding/Github/claude-code-hub/src/lib/validation/schemas.ts` (lines 31-162)

```typescript
export const CreateUserSchema = z.object({
  name: z.string().min(1, "用户名不能为空").max(64, "用户名不能超过64个字符"),
  note: z.string().max(200, "备注不能超过200个字符").optional().default(""),
  providerGroup: z.string().max(200).nullable().optional().default(""),
  tags: z.array(z.string().max(32)).max(20).optional().default([]),
  
  // RPM: 0-1,000,000（0 = 无限制）
  rpm: z.coerce.number().int().min(0).max(1_000_000).nullable().optional(),
  
  // 每日额度: 0-100,000 USD（0 = 无限制）
  dailyQuota: z.coerce.number().min(0).max(100_000).nullable().optional(),
  
  // 多时间维度配额限制
  limit5hUsd: z.coerce.number().min(0).max(10_000).nullable().optional(),
  limitWeeklyUsd: z.coerce.number().min(0).max(50_000).nullable().optional(),
  limitMonthlyUsd: z.coerce.number().min(0).max(200_000).nullable().optional(),
  limitTotalUsd: z.coerce.number().min(0).max(10_000_000).nullable().optional(),
  limitConcurrentSessions: z.coerce.number().int().min(0).max(1000).nullable().optional(),
  
  // 状态管理
  isEnabled: z.boolean().optional().default(true),
  expiresAt: z.preprocess(/* ... */).optional(), // 必须是将来时间，最多10年
  
  // 每日重置配置
  dailyResetMode: z.enum(["fixed", "rolling"]).optional().default("fixed"),
  dailyResetTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional().default("00:00"),
  
  // 访问限制
  allowedClients: z.array(z.string().max(64)).max(50).optional().default([]),
  allowedModels: z.array(z.string().max(64)).max(50).optional().default([]),
});
```

### 3.2 UpdateUserSchema

**文件**: `/Users/ding/Github/claude-code-hub/src/lib/validation/schemas.ts` (lines 167-285)

与 CreateUserSchema 结构相同，但所有字段均为 `.optional()`，支持部分更新。

**过期时间验证差异**:
- **创建时**: 必须是将来时间（`date > now`）
- **更新时**: 允许过去时间（用于立即让用户过期）
- **共同限制**: 最多10年后

### 3.3 用户限制常量

**文件**: `/Users/ding/Github/claude-code-hub/src/lib/constants/user.constants.ts`

```typescript
export const USER_LIMITS = {
  RPM: {
    MIN: 0,              // 0 = 无限制
    MAX: 1_000_000,      // 最大 100 万
  },
  DAILY_QUOTA: {
    MIN: 0,
    MAX: 100_000,        // 最大 10 万美元
  },
} as const;
```

---

## 4. 权限控制

### 4.1 字段级权限配置

**文件**: `/Users/ding/Github/claude-code-hub/src/lib/permissions/user-field-permissions.ts`

```typescript
export const USER_FIELD_PERMISSIONS = {
  // 配额相关字段（仅管理员）
  rpm: { requiredRole: "admin" },
  dailyQuota: { requiredRole: "admin" },
  limit5hUsd: { requiredRole: "admin" },
  limitWeeklyUsd: { requiredRole: "admin" },
  limitMonthlyUsd: { requiredRole: "admin" },
  limitTotalUsd: { requiredRole: "admin" },
  limitConcurrentSessions: { requiredRole: "admin" },
  
  // 配置字段（仅管理员）
  providerGroup: { requiredRole: "admin" },
  dailyResetMode: { requiredRole: "admin" },
  dailyResetTime: { requiredRole: "admin" },
  
  // 状态字段（仅管理员）
  isEnabled: { requiredRole: "admin" },
  expiresAt: { requiredRole: "admin" },
  
  // 访问限制字段（仅管理员）
  allowedClients: { requiredRole: "admin" },
  allowedModels: { requiredRole: "admin" },
} as const;

// 检查字段权限
export function checkFieldPermission(field: string, userRole: string): boolean {
  const permission = USER_FIELD_PERMISSIONS[field as keyof typeof USER_FIELD_PERMISSIONS];
  if (!permission) return true; // 未定义的字段允许修改
  return userRole === permission.requiredRole;
}

// 获取未授权字段列表
export function getUnauthorizedFields(data: Record<string, unknown>, userRole: string): string[] {
  return Object.keys(data).filter((field) => !checkFieldPermission(field, userRole));
}
```

### 4.2 权限规则总结

| 操作 | 管理员 | 普通用户 |
|------|--------|----------|
| 创建用户 | 允许 | 拒绝 |
| 查看所有用户 | 允许 | 拒绝（只能看自己） |
| 修改任意用户 | 允许 | 拒绝（只能修改自己） |
| 修改敏感字段 | 允许 | 拒绝 |
| 修改 name/note/tags | 允许 | 允许（仅自己） |
| 删除用户 | 允许 | 拒绝 |
| 禁用自己 | - | 拒绝（自我保护） |

---

## 5. Repository 层

**文件**: `/Users/ding/Github/claude-code-hub/src/repository/user.ts`

### 5.1 创建用户 (lines 43-90)

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
    // ... 所有字段
  });

  return toUser(user);
}
```

### 5.2 查询用户列表 (lines 92-125)

```typescript
export async function findUserList(limit: number = 50, offset: number = 0): Promise<User[]> {
  const result = await db
    .select({ /* 所有字段 */ })
    .from(users)
    .where(isNull(users.deletedAt))
    .orderBy(
      sql`CASE WHEN ${users.role} = 'admin' THEN 0 ELSE 1 END`,
      users.id
    )
    .limit(limit)
    .offset(offset);

  return result.map(toUser);
}
```

**排序规则**: 管理员优先（role='admin' 排前面），然后按 ID 排序。

### 5.3 批量查询 (lines 151-312)

```typescript
export async function findUserListBatch(
  filters: UserListBatchFilters
): Promise<UserListBatchResult> {
  const {
    cursor,
    limit = 50,
    searchTerm,
    tagFilters,
    keyGroupFilters,
    statusFilter,
    sortBy = "createdAt",
    sortOrder = "asc",
  } = filters;

  // 构建查询条件
  const conditions = [isNull(users.deletedAt)];
  
  // 搜索条件：用户名、备注、供应商分组、标签、关联密钥
  if (trimmedSearch) {
    conditions.push(sql`(
      ${users.name} ILIKE ${pattern}
      OR ${users.description} ILIKE ${pattern}
      OR ${users.providerGroup} ILIKE ${pattern}
      OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(...) WHERE tag ILIKE ${pattern})
      OR EXISTS (SELECT 1 FROM ${keysTable} WHERE ...)
    )`);
  }
  
  // 标签筛选（OR 逻辑）
  if (normalizedTags.length > 0) {
    const tagConditions = normalizedTags.map(
      (tag) => sql`${users.tags} @> ${JSON.stringify([tag])}::jsonb`
    );
    conditions.push(sql`(${sql.join(tagConditions, sql` OR `)})`);
  }
  
  // 分组筛选
  if (trimmedGroups.length > 0) {
    // 使用 regexp_split_to_array 处理逗号分隔的分组
  }
  
  // 状态筛选
  switch (statusFilter) {
    case "active":    // 启用且未过期
    case "expired":   // 已过期
    case "expiringSoon": // 7天内过期
    case "enabled":   // 已启用
    case "disabled":  // 已禁用
  }
  
  // 动态排序
  const sortColumn = { name, tags, expiresAt, rpm, ... }[sortBy];
  
  // 获取 limit + 1 条记录以判断是否还有更多
  const results = await db
    .select({ /* ... */ })
    .from(users)
    .where(and(...conditions))
    .orderBy(orderByClause, asc(users.id))
    .limit(fetchLimit)
    .offset(offset);
    
  return {
    users: usersToReturn.map(toUser),
    nextCursor: hasMore ? offset + limit : null,
    hasMore,
  };
}
```

### 5.4 根据 ID 查询 (lines 314-346)

```typescript
export async function findUserById(id: number): Promise<User | null> {
  const [user] = await db
    .select({ /* 所有字段 */ })
    .from(users)
    .where(and(eq(users.id, id), isNull(users.deletedAt)));

  if (!user) return null;
  return toUser(user);
}
```

### 5.5 更新用户 (lines 348-436)

```typescript
export async function updateUser(id: number, userData: UpdateUserData): Promise<User | null> {
  if (Object.keys(userData).length === 0) {
    return findUserById(id); // 空更新直接返回
  }

  const dbData: UpdateDbData = {
    updatedAt: new Date(),
  };
  
  // 条件设置字段
  if (userData.name !== undefined) dbData.name = userData.name;
  if (userData.description !== undefined) dbData.description = userData.description;
  if (userData.rpm !== undefined) dbData.rpmLimit = userData.rpm;
  if (userData.dailyQuota !== undefined)
    dbData.dailyLimitUsd = userData.dailyQuota === null ? null : userData.dailyQuota.toString();
  // ... 其他字段

  const [user] = await db
    .update(users)
    .set(dbData)
    .where(and(eq(users.id, id), isNull(users.deletedAt)))
    .returning({ /* 所有字段 */ });

  if (!user) return null;
  return toUser(user);
}
```

### 5.6 删除用户 (lines 438-446)

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

**软删除机制**: 设置 `deletedAt` 时间戳，而非物理删除。

### 5.7 标记过期用户 (lines 452-460)

```typescript
export async function markUserExpired(userId: number): Promise<boolean> {
  const result = await db
    .update(users)
    .set({ isEnabled: false, updatedAt: new Date() })
    .where(and(
      eq(users.id, userId),
      eq(users.isEnabled, true),
      isNull(users.deletedAt)
    ))
    .returning({ id: users.id });

  return result.length > 0;
}
```

### 5.8 获取所有标签 (lines 466-479)

```typescript
export async function getAllUserTags(): Promise<string[]> {
  const result = await db
    .select({ tags: users.tags })
    .from(users)
    .where(isNull(users.deletedAt));

  const allTags = new Set<string>();
  for (const row of result) {
    if (row.tags && Array.isArray(row.tags)) {
      for (const tag of row.tags) {
        allTags.add(tag);
      }
    }
  }

  return Array.from(allTags).sort();
}
```

### 5.9 获取所有供应商分组 (lines 485-504)

```typescript
export async function getAllUserProviderGroups(): Promise<string[]> {
  const result = await db
    .select({ providerGroup: users.providerGroup })
    .from(users)
    .where(isNull(users.deletedAt));

  const allGroups = new Set<string>();
  for (const row of result) {
    const groups = row.providerGroup
      ?.split(",")
      .map((group) => group.trim())
      .filter(Boolean);
    if (!groups || groups.length === 0) continue;
    for (const group of groups) {
      allGroups.add(group);
    }
  }

  return Array.from(allGroups).sort();
}
```

---

## 6. Action 层

**文件**: `/Users/ding/Github/claude-code-hub/src/actions/users.ts`

### 6.1 获取用户列表 (lines 169-319)

```typescript
export async function getUsers(): Promise<UserDisplay[]> {
  const session = await getSession();
  if (!session) return [];

  const isAdmin = session.user.role === "admin";

  // 权限控制：管理员看所有，普通用户只看自己
  let users: User[] = [];
  if (isAdmin) {
    users = await findUserList();
  } else {
    const selfUser = await findUserById(session.user.id);
    users = selfUser ? [selfUser] : [];
  }

  if (users.length === 0) return [];

  // 批量查询优化：3 次查询替代 N*3 次
  const userIds = users.map((u) => u.id);
  const [keysMap, usageMap, statisticsMap] = await Promise.all([
    findKeyListBatch(userIds),
    findKeyUsageTodayBatch(userIds),
    findKeysWithStatisticsBatch(userIds),
  ]);

  // 组装 UserDisplay
  const userDisplays: UserDisplay[] = users.map((user) => {
    const keys = keysMap.get(user.id) || [];
    // ... 组装逻辑
    return {
      id: user.id,
      name: user.name,
      // ... 其他字段
      keys: keys.map((key) => ({
        // 密钥可见性控制：管理员或自己可以看到完整密钥
        fullKey: canUserManageKey ? key.key : undefined,
        canCopy: canUserManageKey,
        // ...
      })),
    };
  });

  return userDisplays;
}
```

### 6.2 批量获取用户 (lines 431-585)

```typescript
export async function getUsersBatch(
  params: GetUsersBatchParams
): Promise<ActionResult<GetUsersBatchResult>> {
  // 权限检查：仅管理员
  const session = await getSession();
  if (!session) return { ok: false, error: tError("UNAUTHORIZED"), ... };
  if (session.user.role !== "admin") return { ok: false, error: tError("PERMISSION_DENIED"), ... };

  const { users, nextCursor, hasMore } = await findUserListBatch({
    cursor: params.cursor,
    limit: params.limit,
    searchTerm: params.searchTerm,
    tagFilters: params.tagFilters,
    keyGroupFilters: params.keyGroupFilters,
    statusFilter: params.statusFilter,
    sortBy: params.sortBy,
    sortOrder: params.sortOrder,
  });

  // 批量查询关联数据并组装
  // ...
}
```

### 6.3 批量更新用户 (lines 592-718)

```typescript
export async function batchUpdateUsers(
  params: BatchUpdateUsersParams
): Promise<ActionResult<BatchUpdateResult>> {
  // 权限检查：仅管理员
  
  const MAX_BATCH_SIZE = 500;
  const requestedIds = Array.from(new Set(params.userIds)).filter((id) => Number.isInteger(id));
  
  if (requestedIds.length === 0) {
    return { ok: false, error: tError("REQUIRED_FIELD"), errorCode: ERROR_CODES.REQUIRED_FIELD };
  }
  if (requestedIds.length > MAX_BATCH_SIZE) {
    return { ok: false, error: tError("BATCH_SIZE_EXCEEDED", { max: MAX_BATCH_SIZE }), ... };
  }

  // 只允许更新特定字段
  const updatesSchema = UpdateUserSchema.pick({
    note: true,
    tags: true,
    rpm: true,
    dailyQuota: true,
    limit5hUsd: true,
    limitWeeklyUsd: true,
    limitMonthlyUsd: true,
  });

  // 事务保证原子性
  await db.transaction(async (tx) => {
    // 1. 验证所有用户存在
    const existingRows = await tx
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(and(inArray(usersTable.id, requestedIds), isNull(usersTable.deletedAt)));

    const existingSet = new Set(existingRows.map((r) => r.id));
    const missingIds = requestedIds.filter((id) => !existingSet.has(id));
    if (missingIds.length > 0) {
      throw new BatchUpdateError(`部分用户不存在: ${missingIds.join(", ")}`, ERROR_CODES.NOT_FOUND);
    }

    // 2. 执行更新
    const updatedRows = await tx
      .update(usersTable)
      .set(dbUpdates)
      .where(and(inArray(usersTable.id, requestedIds), isNull(usersTable.deletedAt)))
      .returning({ id: usersTable.id });

    // 3. 验证更新数量
    if (updatedRows.length !== requestedIds.length) {
      throw new BatchUpdateError("批量更新失败：更新行数不匹配", ERROR_CODES.UPDATE_FAILED);
    }
  });

  revalidatePath("/dashboard");
  return { ok: true, data: { requestedCount, updatedCount, updatedIds } };
}
```

### 6.4 添加用户 (lines 721-910)

```typescript
export async function addUser(data: {
  name: string;
  note?: string;
  providerGroup?: string | null;
  tags?: string[];
  rpm?: number | null;
  dailyQuota?: number | null;
  limit5hUsd?: number | null;
  limitWeeklyUsd?: number | null;
  limitMonthlyUsd?: number | null;
  limitTotalUsd?: number | null;
  limitConcurrentSessions?: number | null;
  dailyResetMode?: "fixed" | "rolling";
  dailyResetTime?: string;
  isEnabled?: boolean;
  expiresAt?: Date | null;
  allowedClients?: string[];
  allowedModels?: string[];
}): Promise<ActionResult<{ user: User; defaultKey: Key }>> {
  // 权限检查：仅管理员
  const session = await getSession();
  if (!session || session.user.role !== "admin") {
    return { ok: false, error: tError("PERMISSION_DENIED"), errorCode: ERROR_CODES.PERMISSION_DENIED };
  }

  // Zod 验证
  const validationResult = CreateUserSchema.safeParse({ ... });
  if (!validationResult.success) {
    return { ok: false, error: formatZodError(validationResult.error), ... };
  }

  const validatedData = validationResult.data;
  const providerGroup = normalizeProviderGroup(validatedData.providerGroup);

  // 创建用户
  const newUser = await createUser({ ... });

  // 自动创建默认密钥
  const generatedKey = `sk-${randomBytes(16).toString("hex")}`;
  const newKey = await createKey({
    user_id: newUser.id,
    name: "default",
    key: generatedKey,
    is_enabled: true,
    expires_at: undefined,
    provider_group: providerGroup,
  });

  revalidatePath("/dashboard");
  return {
    ok: true,
    data: {
      user: { /* ... */ },
      defaultKey: {
        id: newKey.id,
        name: newKey.name,
        key: generatedKey, // 仅此时返回完整密钥
      },
    },
  };
}
```

### 6.5 仅创建用户（无默认密钥）(lines 912-1077)

`createUserOnly()` 函数与 `addUser()` 类似，但不创建默认密钥。用于统一编辑对话框的创建模式。

### 6.6 编辑用户 (lines 1079-1216)

```typescript
export async function editUser(
  userId: number,
  data: UpdateUserData
): Promise<ActionResult> {
  const session = await getSession();
  if (!session) return { ok: false, error: tError("UNAUTHORIZED"), ... };

  // Zod 验证
  const validationResult = UpdateUserSchema.safeParse(data);
  if (!validationResult.success) { ... }

  const validatedData = validationResult.data;

  // 字段级权限检查
  const unauthorizedFields = getUnauthorizedFields(validatedData, session.user.role);
  if (unauthorizedFields.length > 0) {
    return {
      ok: false,
      error: `${tError("PERMISSION_DENIED")}: ${unauthorizedFields.join(", ")}`,
      errorCode: ERROR_CODES.PERMISSION_DENIED,
    };
  }

  // 额外检查：非管理员只能修改自己的数据
  if (session.user.role !== "admin" && session.user.id !== userId) {
    return { ok: false, error: tError("PERMISSION_DENIED"), ... };
  }

  // 更新用户
  await updateUser(userId, { ... });

  revalidatePath("/dashboard");
  return { ok: true };
}
```

### 6.7 删除用户 (lines 1218-1242)

```typescript
export async function removeUser(userId: number): Promise<ActionResult> {
  const session = await getSession();
  if (!session || session.user.role !== "admin") {
    return { ok: false, error: tError("PERMISSION_DENIED"), ... };
  }

  await deleteUser(userId);
  revalidatePath("/dashboard");
  return { ok: true };
}
```

### 6.8 获取用户限额使用情况 (lines 1244-1320)

```typescript
export async function getUserLimitUsage(userId: number): Promise<
  ActionResult<{
    rpm: { current: number; limit: number | null; window: "per_minute" };
    dailyCost: { current: number; limit: number | null; resetAt?: Date };
  }>
> {
  // 权限检查：管理员或自己
  if (session.user.role !== "admin" && session.user.id !== userId) { ... }

  // 获取 RPM（实时滑动窗口，无法精确获取当前值）
  const rpmCurrent = 0;

  // 获取每日消费（使用用户的 dailyResetTime 和 dailyResetMode 配置）
  const { startTime, endTime } = await getTimeRangeForPeriodWithMode(
    "daily",
    user.dailyResetTime ?? "00:00",
    user.dailyResetMode ?? "fixed"
  );
  const dailyCost = await sumUserCostInTimeRange(userId, startTime, endTime);
  const resetInfo = await getResetInfoWithMode("daily", resetTime, resetMode);

  return {
    ok: true,
    data: {
      rpm: { current: rpmCurrent, limit: user.rpm, window: "per_minute" },
      dailyCost: { current: dailyCost, limit: user.dailyQuota, resetAt },
    },
  };
}
```

### 6.9 续期用户 (lines 1322-1402)

```typescript
export async function renewUser(
  userId: number,
  data: { expiresAt: string; enableUser?: boolean }
): Promise<ActionResult> {
  // 权限检查：仅管理员

  // 解析并验证过期时间
  const timezone = await resolveSystemTimezone();
  const expiresAt = parseDateInputAsTimezone(data.expiresAt, timezone);

  // 验证：必须是将来时间，最多10年
  const validationResult = await validateExpiresAt(expiresAt, tError);
  if (validationResult) return { ok: false, ...validationResult };

  // 更新过期时间，可选同时启用用户
  const updateData: { expiresAt: Date; isEnabled?: boolean } = { expiresAt };
  if (data.enableUser === true) updateData.isEnabled = true;

  await updateUser(userId, updateData);
  revalidatePath("/dashboard");
  return { ok: true };
}
```

### 6.10 切换用户启用状态 (lines 1404-1445)

```typescript
export async function toggleUserEnabled(userId: number, enabled: boolean): Promise<ActionResult> {
  // 权限检查：仅管理员

  // 自我保护：禁止禁用自己
  if (session.user.id === userId && !enabled) {
    return {
      ok: false,
      error: tError("CANNOT_DISABLE_SELF"),
      errorCode: ERROR_CODES.PERMISSION_DENIED,
    };
  }

  await updateUser(userId, { isEnabled: enabled });
  revalidatePath("/dashboard/users");
  revalidatePath("/dashboard");
  return { ok: true };
}
```

### 6.11 获取用户所有限额使用情况 (lines 1447-1527)

```typescript
export async function getUserAllLimitUsage(userId: number): Promise<
  ActionResult<{
    limit5h: { usage: number; limit: number | null };
    limitDaily: { usage: number; limit: number | null };
    limitWeekly: { usage: number; limit: number | null };
    limitMonthly: { usage: number; limit: number | null };
    limitTotal: { usage: number; limit: number | null };
  }>
> {
  const ALL_TIME_MAX_AGE_DAYS = 36500; // ~100年

  // 并行查询各时间范围消费
  const [usage5h, usageDaily, usageWeekly, usageMonthly, usageTotal] = await Promise.all([
    sumUserCostInTimeRange(userId, range5h.startTime, range5h.endTime),
    sumUserCostInTimeRange(userId, rangeDaily.startTime, rangeDaily.endTime),
    sumUserCostInTimeRange(userId, rangeWeekly.startTime, rangeWeekly.endTime),
    sumUserCostInTimeRange(userId, rangeMonthly.startTime, rangeMonthly.endTime),
    sumUserTotalCost(userId, ALL_TIME_MAX_AGE_DAYS),
  ]);

  return {
    ok: true,
    data: {
      limit5h: { usage: usage5h, limit: user.limit5hUsd ?? null },
      limitDaily: { usage: usageDaily, limit: user.dailyQuota ?? null },
      limitWeekly: { usage: usageWeekly, limit: user.limitWeeklyUsd ?? null },
      limitMonthly: { usage: usageMonthly, limit: user.limitMonthlyUsd ?? null },
      limitTotal: { usage: usageTotal, limit: user.limitTotalUsd ?? null },
    },
  };
}
```

### 6.12 从密钥同步供应商分组 (lines 143-167)

```typescript
export async function syncUserProviderGroupFromKeys(userId: number): Promise<void> {
  const keys = await findKeyList(userId);
  const allGroups = new Set<string>();

  for (const key of keys) {
    // Key.providerGroup 为必填，null/empty 视为 "default"
    const group = key.providerGroup || PROVIDER_GROUP.DEFAULT;
    group
      .split(",")
      .map((g) => g.trim())
      .filter(Boolean)
      .forEach((g) => allGroups.add(g));
  }

  const newProviderGroup =
    allGroups.size > 0 ? Array.from(allGroups).sort().join(",") : PROVIDER_GROUP.DEFAULT;
  
  await updateUser(userId, { providerGroup: newProviderGroup });
  logger.info(`[UserAction] Synced user provider group: userId=${userId}, groups=${newProviderGroup}`);
}
```

---

## 7. API 路由

**文件**: `/Users/ding/Github/claude-code-hub/src/app/api/actions/[...route]/route.ts`

### 7.1 用户管理端点

| 方法 | 端点 | Action | 认证 | 管理员 |
|------|------|--------|------|--------|
| GET | `/api/actions/users/getUsers` | getUsers | 是 | 否* |
| POST | `/api/actions/users/addUser` | addUser | 是 | 是 |
| POST | `/api/actions/users/editUser` | editUser | 是 | 是** |
| POST | `/api/actions/users/removeUser` | removeUser | 是 | 是 |
| POST | `/api/actions/users/getUserLimitUsage` | getUserLimitUsage | 是 | 否 |

*普通用户只能看到自己
**非管理员可以编辑自己的数据，但有字段限制

**注意**: 以下 Action 函数在 `src/actions/users.ts` 中定义，用于 Server Components 和 Server Actions 内部调用，但未在 API 路由中暴露为 HTTP 端点：

- `createUserOnly()` - 仅创建用户（不生成默认密钥）
- `getUsersBatch()` - 批量获取用户（支持游标分页）
- `batchUpdateUsers()` - 批量更新用户
- `searchUsersForFilter()` - 搜索用户（用于筛选下拉框）
- `getAllUserTags()` - 获取所有用户标签
- `getAllUserKeyGroups()` - 获取所有用户密钥分组
- `renewUser()` - 续期用户
- `toggleUserEnabled()` - 切换用户启用状态
- `getUserAllLimitUsage()` - 获取用户所有限额使用情况

### 7.2 路由配置示例

```typescript
const { route: addUserRoute, handler: addUserHandler } = createActionRoute(
  "users",
  "addUser",
  userActions.addUser,
  {
    requestSchema: CreateUserSchema,
    responseSchema: z.object({
      user: z.object({ /* ... */ }),
      defaultKey: z.object({ id: z.number(), name: z.string(), key: z.string() }),
    }),
    description: "创建新用户 (管理员)",
    summary: "创建新用户并返回用户信息及默认密钥",
    tags: ["用户管理"],
    requiredRole: "admin",
    requestExamples: {
      basic: {
        summary: "基础用户",
        value: {
          name: "测试用户",
          note: "这是一个测试账号",
          rpm: 100,
          dailyQuota: 100,
          isEnabled: true,
        },
      },
      withExpiry: {
        summary: "带过期时间的用户",
        value: {
          name: "临时用户",
          note: "30天试用账号",
          rpm: 60,
          dailyQuota: 50,
          isEnabled: true,
          expiresAt: "2026-01-01T23:59:59.999Z",
        },
      },
    },
  }
);
app.openapi(addUserRoute, addUserHandler);
```

---

## 8. 错误处理

### 8.1 错误码定义

**文件**: `/Users/ding/Github/claude-code-hub/src/lib/utils/error-messages.ts`

```typescript
export const ERROR_CODES = {
  PERMISSION_DENIED: "PERMISSION_DENIED",
  UNAUTHORIZED: "UNAUTHORIZED",
  NOT_FOUND: "NOT_FOUND",
  INVALID_FORMAT: "INVALID_FORMAT",
  CREATE_FAILED: "CREATE_FAILED",
  UPDATE_FAILED: "UPDATE_FAILED",
  DELETE_FAILED: "DELETE_FAILED",
  BATCH_SIZE_EXCEEDED: "BATCH_SIZE_EXCEEDED",
  EMPTY_UPDATE: "EMPTY_UPDATE",
  REQUIRED_FIELD: "REQUIRED_FIELD",
  DATABASE_ERROR: "DATABASE_ERROR",
  INTERNAL_ERROR: "INTERNAL_ERROR",
  OPERATION_FAILED: "OPERATION_FAILED",
  // 过期时间验证错误码
  EXPIRES_AT_MUST_BE_FUTURE: "EXPIRES_AT_MUST_BE_FUTURE",
  EXPIRES_AT_TOO_FAR: "EXPIRES_AT_TOO_FAR",
} as const;
```

### 8.2 ActionResult 类型

```typescript
interface ActionResult<T = void> {
  ok: boolean;
  data?: T;
  error?: string;
  errorCode?: string;
  errorParams?: Record<string, unknown>;
}
```

### 8.3 错误响应示例

```json
{
  "ok": false,
  "error": "用户名不能为空",
  "errorCode": "INVALID_FORMAT",
  "errorParams": { "field": "name" }
}
```

---

## 9. 核心文件索引

| 文件路径 | 用途 |
|----------|------|
| `/Users/ding/Github/claude-code-hub/src/actions/users.ts` | 用户 CRUD Server Actions |
| `/Users/ding/Github/claude-code-hub/src/repository/user.ts` | 用户数据库操作 |
| `/Users/ding/Github/claude-code-hub/src/types/user.ts` | 用户类型定义 |
| `/Users/ding/Github/claude-code-hub/src/lib/validation/schemas.ts` | Zod 验证 Schema |
| `/Users/ding/Github/claude-code-hub/src/lib/permissions/user-field-permissions.ts` | 字段级权限配置 |
| `/Users/ding/Github/claude-code-hub/src/drizzle/schema.ts` | 数据库 Schema |
| `/Users/ding/Github/claude-code-hub/src/repository/_shared/transformers.ts` | 数据转换器 |
| `/Users/ding/Github/claude-code-hub/src/lib/constants/user.constants.ts` | 用户限制常量 |
| `/Users/ding/Github/claude-code-hub/src/app/api/actions/[...route]/route.ts` | API 路由定义 |

---

## 10. 关键实现细节

### 10.1 软删除架构

- 所有查询通过 `isNull(users.deletedAt)` 过滤已删除用户
- 删除操作设置 `deletedAt = new Date()`，保留历史记录
- 关联的 messageRequest 等记录保留用于统计

### 10.2 供应商分组同步

- 用户分组由其关联密钥的分组自动计算
- 当密钥增删改时，触发 `syncUserProviderGroupFromKeys()`
- 分组值为逗号分隔的排序后唯一分组名

### 10.3 数值存储转换

- 数据库 numeric 类型存储为字符串
- Repository 层写入时调用 `.toString()`
- Transformer 层读取时调用 `Number.parseFloat()`
- 0 值转换为 `null` 表示"无限制"

### 10.4 批量查询优化

- 使用 `Promise.all()` 并行查询密钥、用量、统计
- 使用 Map 构建查找表避免嵌套循环
- 游标分页（limit + 1 技巧）判断是否有更多数据

### 10.5 每日限额重置模式

- **fixed**: 在指定时间（dailyResetTime）重置
- **rolling**: 24小时滑动窗口
- 使用时区感知的日期计算

---

## 11. 与 Round 1 的修正对比

| 项目 | Round 1 | Round 2 修正 |
|------|---------|--------------|
| `addUser` 行号 | 720-910 | 721-910（准确） |
| `editUser` 行号 | 1079-1216 | 1080-1216（准确） |
| `removeUser` 行号 | 1218-1242 | 1219-1242（准确） |
| `findUserListBatch` 行号 | 151-312 | 151-312（准确） |
| `updateUser` 行号 | 348-436 | 348-436（准确） |
| `deleteUser` 行号 | 438-446 | 438-446（准确） |
| `markUserExpired` | 未提及 | 已补充 (lines 452-460) |
| `getAllUserTags` | 466-479 | 466-479（准确） |
| `getAllUserProviderGroups` | 485-504 | 485-504（准确） |
| `createUserOnly` | 未提及 | 已补充 (lines 913-1077) |
| `renewUser` | 未提及 | 已补充 (lines 1325-1402) |
| `toggleUserEnabled` | 未提及 | 已补充 (lines 1407-1445) |
| `getUserAllLimitUsage` | 未提及 | 已补充 (lines 1451-1527) |
| `syncUserProviderGroupFromKeys` | 提及但未给出代码 | 已补充完整代码 |
| `BatchUpdateError` | 未提及 | 已补充 |
| `validateExpiresAt` | 未提及 | 已补充 |
| `USER_LIMITS` 数值 | 正确 | 确认正确 |
| `toUser` 转换逻辑 | 正确 | 确认正确 |

---

*文档生成时间: 2026-01-29*
*基于代码版本: claude-code-hub main branch*
