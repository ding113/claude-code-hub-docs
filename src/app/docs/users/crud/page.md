---
dimensions:
  type:
    primary: reference
    detail: guide
  level: intermediate
standard_title: 用户 CRUD 操作
language: zh
---

# 用户 CRUD 操作

Claude Code Hub 的用户管理系统提供完整的用户生命周期管理能力，支持多租户
架构下的精细化配额控制、访问限制和分层权限管理。通过这套系统，你可以
创建、查询、更新和删除用户，同时控制他们的 API 访问权限和消费限额。

{% callout type="note" title="用户与密钥的关系" %}
每个用户可以拥有多个 API Key。Key 继承用户的配额限制，但也可以设置
自己的独立限制。用户级别的限制是总闸，Key 级别的限制是子闸。
{% /callout %}

## 用户角色体系

系统采用两级角色体系：

| 角色 | 权限范围 |
|------|----------|
| `admin` | 管理所有用户、查看全部数据、配置系统设置 |
| `user` | 仅查看和管理自己的数据 |

角色在创建用户时指定，创建后可以通过编辑用户来修改角色。

## 创建用户

### 基本流程

当你创建一个新用户时，系统会执行以下操作：

1. **验证输入数据** - 使用 Zod Schema 验证所有字段
2. **创建用户记录** - 在数据库中插入用户数据
3. **自动生成默认密钥** - 为用户创建一个名为 "default" 的 API Key
4. **返回用户信息和密钥** - 仅此时返回完整的 API Key，之后无法再次查看

### 必填字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `name` | string | 用户名，1-64 个字符 |

### 可选配置字段

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `note` | string | `""` | 用户备注，最多 200 字符 |
| `providerGroup` | string | `""` | 供应商分组，控制可用供应商 |
| `tags` | string[] | `[]` | 用户标签，最多 20 个，每个最多 32 字符 |
| `rpm` | number | `null` | 每分钟请求数限制，0 = 无限制，最大 1,000,000 |
| `dailyQuota` | number | `null` | 每日消费限额（USD），0 = 无限制，最大 100,000 |
| `limit5hUsd` | number | `null` | 5 小时滚动窗口限额（USD），最大 10,000 |
| `limitWeeklyUsd` | number | `null` | 周消费限额（USD），最大 50,000 |
| `limitMonthlyUsd` | number | `null` | 月消费限额（USD），最大 200,000 |
| `limitTotalUsd` | number | `null` | 总消费限额（USD），最大 10,000,000 |
| `limitConcurrentSessions` | number | `null` | 并发会话数限制，最大 1000 |
| `dailyResetMode` | enum | `"fixed"` | 日限额重置模式：`fixed` 或 `rolling` |
| `dailyResetTime` | string | `"00:00"` | 日限额重置时间（HH:mm 格式） |
| `isEnabled` | boolean | `true` | 用户是否启用 |
| `expiresAt` | Date | `null` | 过期时间，最多 10 年后 |
| `allowedClients` | string[] | `[]` | 允许的客户端标识，空数组 = 无限制 |
| `allowedModels` | string[] | `[]` | 允许的模型列表，空数组 = 无限制 |

### 创建示例

```typescript
// 基础用户
const basicUser = {
  name: "测试用户",
  note: "这是一个测试账号",
  rpm: 100,
  dailyQuota: 100,
  isEnabled: true,
};

// 带过期时间的临时用户
const tempUser = {
  name: "临时用户",
  note: "30天试用账号",
  rpm: 60,
  dailyQuota: 50,
  isEnabled: true,
  expiresAt: new Date("2026-01-01T23:59:59.999Z"),
};

// 完整配置的高级用户
const advancedUser = {
  name: "高级用户",
  note: "团队负责人账号",
  providerGroup: "premium,backup",
  tags: ["team-lead", "priority"],
  rpm: 1000,
  dailyQuota: 500,
  limit5hUsd: 100,
  limitWeeklyUsd: 2000,
  limitMonthlyUsd: 8000,
  limitTotalUsd: 50000,
  limitConcurrentSessions: 10,
  dailyResetMode: "fixed",
  dailyResetTime: "00:00",
  isEnabled: true,
  allowedModels: ["claude-3-5-sonnet", "gpt-4"],
};
```

### 验证规则

创建用户时，系统会执行以下验证：

- **用户名**: 不能为空，最多 64 个字符
- **过期时间**: 必须是将来时间，最多 10 年后
- **RPM**: 0 - 1,000,000（0 表示无限制）
- **日限额**: 0 - 100,000 USD（0 表示无限制）
- **标签**: 最多 20 个，每个最多 32 个字符
- **客户端/模型白名单**: 最多 50 个，每个最多 64 个字符

### 创建响应

创建成功后，响应包含用户信息和默认密钥：

```typescript
{
  ok: true,
  data: {
    user: {
      id: 123,
      name: "测试用户",
      role: "user",
      // ... 其他字段
    },
    defaultKey: {
      id: 456,
      name: "default",
      key: "sk-abc123...",  // 仅此时返回完整密钥
    }
  }
}
```

{% callout type="warning" title="重要提示" %}
创建用户时返回的 `defaultKey.key` 是唯一一次你能看到完整密钥的机会。
请务必立即保存，之后无法再次获取。如果丢失，只能重新生成密钥。
{% /callout %}

## 查询用户

### 获取用户列表

管理员可以获取所有用户列表，普通用户只能看到自己。

```typescript
// 获取用户列表（带关联数据）
const users = await getUsers();
```

返回的 `UserDisplay` 对象包含：

- 用户基本信息
- 关联的 API Key 列表
- 今日用量统计
- 限额使用情况

### 批量查询（游标分页）

对于大量用户，使用游标分页获取：

```typescript
const result = await getUsersBatch({
  cursor: 0,           // 起始位置
  limit: 50,           // 每页数量
  searchTerm: "test",  // 搜索关键词
  tagFilters: ["vip"], // 标签筛选
  keyGroupFilters: ["group1"], // 密钥分组筛选
  statusFilter: "active", // 状态筛选
  sortBy: "createdAt", // 排序字段
  sortOrder: "asc",    // 排序方向
});

// 返回结果
{
  users: [...],       // 用户列表
  nextCursor: 50,     // 下一页游标
  hasMore: true,      // 是否还有更多
}
```

### 搜索能力

搜索功能支持以下字段：

- 用户名（`name`）
- 备注（`description`）
- 供应商分组（`providerGroup`）
- 标签（`tags`）
- 关联的 API Key

搜索使用不区分大小写的模糊匹配（`ILIKE`）。

### 状态筛选

| 筛选值 | 说明 |
|--------|------|
| `active` | 已启用且未过期 |
| `expired` | 已过期 |
| `expiringSoon` | 7 天内过期 |
| `enabled` | 已启用（包含过期） |
| `disabled` | 已禁用 |

### 排序选项

| 字段 | 说明 |
|------|------|
| `name` | 按用户名排序 |
| `tags` | 按标签排序 |
| `expiresAt` | 按过期时间排序 |
| `rpm` | 按 RPM 限制排序 |
| `dailyQuota` | 按日限额排序 |
| `createdAt` | 按创建时间排序 |

### 排序规则

默认排序规则：

1. 管理员优先（`role='admin'` 排在前面）
2. 然后按 ID 升序排列

## 更新用户

### 部分更新

用户更新支持部分字段更新，只提供你想修改的字段：

```typescript
// 只更新名称
await editUser(123, { name: "新名称" });

// 更新多个字段
await editUser(123, {
  note: "更新后的备注",
  tags: ["new-tag"],
  dailyQuota: 200,
});
```

### 字段级权限控制

不同角色能更新的字段不同：

**管理员可更新的字段：**
- 所有字段

**普通用户可更新的字段（仅自己）：**
- `name` - 用户名
- `note` - 备注
- `tags` - 标签

尝试更新无权限的字段会返回权限错误：

```json
{
  "ok": false,
  "error": "权限不足: rpm, dailyQuota",
  "errorCode": "PERMISSION_DENIED"
}
```

### 过期时间验证差异

创建和更新时的过期时间验证略有不同：

| 场景 | 验证规则 |
|------|----------|
| **创建时** | 必须是将来时间（`date > now`） |
| **更新时** | 允许过去时间（用于立即让用户过期） |
| **共同限制** | 最多 10 年后 |

### 批量更新

管理员可以批量更新多个用户：

```typescript
const result = await batchUpdateUsers({
  userIds: [1, 2, 3, 4, 5],
  updates: {
    note: "批量更新的备注",
    tags: ["batch-updated"],
    dailyQuota: 100,
  },
});

// 返回结果
{
  ok: true,
  data: {
    requestedCount: 5,
    updatedCount: 5,
    updatedIds: [1, 2, 3, 4, 5],
  }
}
```

**批量更新限制：**
- 最多 500 个用户
- 只允许更新特定字段：`note`, `tags`, `rpm`, `dailyQuota`, `limit5hUsd`,
  `limitWeeklyUsd`, `limitMonthlyUsd`
- 使用事务保证原子性

## 删除用户

### 软删除机制

用户删除采用软删除机制，设置 `deletedAt` 时间戳而非物理删除：

```typescript
await removeUser(123);
```

软删除的好处：
- 保留历史数据用于统计
- 可以恢复误删的用户
- 关联的 `messageRequest` 记录保留

### 删除后的影响

- 用户无法登录
- 用户的所有 API Key 失效
- 历史请求记录保留用于报表

{% callout type="warning" title="注意" %}
目前系统不提供用户恢复功能。如需恢复，需要直接在数据库中将
`deletedAt` 设为 `NULL`。
{% /callout %}

## 用户状态管理

### 启用/禁用用户

你可以临时禁用用户而不删除：

```typescript
// 禁用用户
await toggleUserEnabled(123, false);

// 启用用户
await toggleUserEnabled(123, true);
```

**自我保护机制：** 你不能禁用自己（防止管理员把自己锁在外面）。

### 续期用户

为即将过期的用户延长有效期：

```typescript
// 仅更新过期时间
await renewUser(123, {
  expiresAt: "2026-12-31T23:59:59",
});

// 同时启用用户
await renewUser(123, {
  expiresAt: "2026-12-31T23:59:59",
  enableUser: true,
});
```

过期时间验证：
- 必须是将来时间
- 最多 10 年后
- 使用时区感知的日期计算

### 自动过期处理

系统通过定时任务自动处理过期用户：

1. 每分钟检查即将过期的用户
2. 过期时自动禁用用户（设置 `isEnabled = false`）
3. 记录过期事件到日志

## 限额监控

### 获取限额使用情况

查询用户当前的限额使用：

```typescript
// 基础限额（RPM + 日消费）
const usage = await getUserLimitUsage(123);

// 返回结果
{
  ok: true,
  data: {
    rpm: {
      current: 45,        // 当前分钟请求数
      limit: 100,         // 限制值
      window: "per_minute",
    },
    dailyCost: {
      current: 12.50,     // 今日消费
      limit: 100,         // 日限额
      resetAt: Date,      // 下次重置时间
    },
  }
}
```

### 获取所有限额

查询用户在所有时间维度的限额使用：

```typescript
const allUsage = await getUserAllLimitUsage(123);

// 返回结果
{
  ok: true,
  data: {
    limit5h: { usage: 8.50, limit: 20 },
    limitDaily: { usage: 12.50, limit: 100 },
    limitWeekly: { usage: 45.00, limit: 300 },
    limitMonthly: { usage: 120.00, limit: 1000 },
    limitTotal: { usage: 500.00, limit: 5000 },
  }
}
```

### 日限额重置模式

系统支持两种日限额重置模式：

**固定时间模式（Fixed）**
- 在配置的每日重置时间点重置计数
- 例如：设置重置时间为 `18:00`，则每天 18:00 重置
- 适合有固定结算时间点的场景

**滚动窗口模式（Rolling）**
- 统计过去 24 小时的累计消费
- 无固定重置时间点，平滑计算
- 适合需要连续流量控制的场景

## 数据模型

### 数据库 Schema

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
});
```

### 数据库索引

系统为常用查询创建了以下索引：

| 索引名 | 字段 | 用途 |
|--------|------|------|
| `idx_users_active_role_sort` | `deletedAt, role, id` | 按角色排序（管理员优先） |
| `idx_users_enabled_expires_at` | `isEnabled, expiresAt` | 过期用户查询（定时任务） |
| `idx_users_created_at` | `createdAt` | 创建时间排序 |
| `idx_users_deleted_at` | `deletedAt` | 软删除过滤 |

## 权限控制总结

| 操作 | 管理员 | 普通用户 |
|------|--------|----------|
| 创建用户 | 允许 | 拒绝 |
| 查看所有用户 | 允许 | 拒绝（只能看自己） |
| 修改任意用户 | 允许 | 拒绝（只能修改自己） |
| 修改敏感字段 | 允许 | 拒绝 |
| 修改 name/note/tags | 允许 | 允许（仅自己） |
| 删除用户 | 允许 | 拒绝 |
| 禁用自己 | - | 拒绝（自我保护） |

## 错误处理

### 错误码定义

| 错误码 | 说明 |
|--------|------|
| `PERMISSION_DENIED` | 权限不足 |
| `UNAUTHORIZED` | 未登录 |
| `NOT_FOUND` | 用户不存在 |
| `INVALID_FORMAT` | 数据格式错误 |
| `BATCH_SIZE_EXCEEDED` | 批量操作超出限制 |
| `EXPIRES_AT_MUST_BE_FUTURE` | 过期时间必须是将来 |
| `EXPIRES_AT_TOO_FAR` | 过期时间太远（超过 10 年） |

### 错误响应格式

```json
{
  "ok": false,
  "error": "用户名不能为空",
  "errorCode": "INVALID_FORMAT",
  "errorParams": { "field": "name" }
}
```

## 实现细节

### 数值存储转换

数据库使用 `numeric` 类型存储金额，Repository 层负责转换：

- **写入时**: 调用 `.toString()` 转为字符串
- **读取时**: 调用 `Number.parseFloat()` 转为数字
- **特殊处理**: 0 值转换为 `null` 表示"无限制"

### 供应商分组同步

用户的 `providerGroup` 字段不是直接设置的，而是由其关联的 API Key
的分组自动计算得出：

1. 收集用户所有 Key 的分组
2. 去重并排序
3. 用逗号连接存储

当 Key 增删改时，会自动触发同步。

### 批量查询优化

获取用户列表时，系统使用 3 次批量查询替代 N*3 次单独查询：

```typescript
const [keysMap, usageMap, statisticsMap] = await Promise.all([
  findKeyListBatch(userIds),
  findKeyUsageTodayBatch(userIds),
  findKeysWithStatisticsBatch(userIds),
]);
```

这种优化显著提升了大数据量时的性能。

## 相关文档

- [配额管理](/docs/users/quota) - 深入了解配额体系
- [权限控制](/docs/users/permissions) - 完整的权限系统说明
- [API 密钥管理](/docs/users/api-keys) - 管理用户的 API Key
- [访问限制](/docs/users/access-restrictions) - 客户端和模型白名单
- [用户标签](/docs/users/tags) - 使用标签组织用户
- [批量操作](/docs/users/batch-operations) - 批量管理用户
