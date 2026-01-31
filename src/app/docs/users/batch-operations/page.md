---
dimensions:
  type:
    primary: reference
    detail: guide
  level: intermediate
standard_title: 批量操作
language: zh
---

# 批量操作

Claude Code Hub 的批量操作功能让管理员能够同时管理多个用户及其关联的 API Key，
大幅提升管理效率。无需逐个编辑，你可以选中多个用户，一次性应用相同的配置变更。

{% callout type="note" title="适用场景" %}
批量操作特别适合以下场景：

- 为整个团队统一调整配额限制
- 批量添加或移除用户标签
- 统一修改 RPM（每分钟请求数）限制
- 批量调整 Key 的供应商分组或权限设置
{% /callout %}

## 功能概述

批量操作系统由多个协同工作的组件构成：

1. **批量编辑界面** - 提供直观的用户/Key 选择和配置界面
2. **批量更新 Action** - 服务端函数，执行实际的更新操作
3. **验证层** - Zod 校验和权限检查，确保数据完整性
4. **数据库事务** - 基于 Drizzle ORM 的原子操作

### 操作流程

典型的批量编辑流程如下：

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│ 1. 进入批量模式  │ -> │ 2. 选择用户/Key │ -> │ 3. 配置更新字段 │
└─────────────────┘    └─────────────────┘    └─────────────────┘
                                                        │
┌─────────────────┐    ┌─────────────────┐    ┌────────▼────────┐
│ 6. 完成更新      │ <- │ 5. 执行批量更新  │ <- │ 4. 确认变更内容 │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

## 支持的批量字段

### 用户级别字段

通过 `batchUpdateUsers` 可以批量修改以下用户属性：

{% table %}
| 字段 | 类型 | 限制 | 说明 |
|------|------|------|------|
| `note` | string | 最多 200 字符 | 用户备注说明 |
| `tags` | string[] | 最多 20 个标签，每个最多 32 字符 | 用户标签数组 |
| `rpm` | number | 0-1,000,000 | 每分钟请求限制，0 表示无限制 |
| `dailyQuota` | number | 0-100,000 | 每日消费限额（USD），0 表示无限制 |
| `limit5hUsd` | number | 0-10,000 | 5 小时消费限额（USD） |
| `limitWeeklyUsd` | number | 0-50,000 | 每周消费限额（USD） |
| `limitMonthlyUsd` | number | 0-200,000 | 每月消费限额（USD） |
{% /table %}

### Key 级别字段

通过 `batchUpdateKeys` 可以批量修改以下 Key 属性：

{% table %}
| 字段 | 类型 | 限制 | 说明 |
|------|------|------|------|
| `providerGroup` | string | 最多 200 字符 | 供应商分组分配 |
| `limit5hUsd` | number | 0-10,000 | 5 小时消费限额（USD） |
| `limitDailyUsd` | number | 0-10,000 | 每日消费限额（USD） |
| `limitWeeklyUsd` | number | 0-50,000 | 每周消费限额（USD） |
| `limitMonthlyUsd` | number | 0-200,000 | 每月消费限额（USD） |
| `canLoginWebUi` | boolean | true/false | 是否允许登录 Web UI |
| `isEnabled` | boolean | true/false | Key 是否启用 |
{% /table %}

### 字段验证规则

批量更新使用 Zod 进行严格的输入验证：

**用户字段验证** (`src/lib/validation/schemas.ts`):

```typescript
export const UpdateUserSchema = z.object({
  note: z.string().max(200).optional(),
  tags: z.array(z.string().max(32)).max(20).optional(),
  rpm: z.number().min(0).max(1_000_000).nullable().optional(),
  dailyQuota: z.number().min(0).max(100_000).nullable().optional(),
  limit5hUsd: z.number().min(0).max(10_000).nullable().optional(),
  limitWeeklyUsd: z.number().min(0).max(50_000).nullable().optional(),
  limitMonthlyUsd: z.number().min(0).max(200_000).nullable().optional(),
});
```

**Key 字段验证**:

```typescript
export const UpdateKeySchema = z.object({
  providerGroup: z.string().max(200).nullable().optional(),
  limit5hUsd: z.number().min(0).max(10_000).nullable().optional(),
  limitDailyUsd: z.number().min(0).max(10_000).nullable().optional(),
  limitWeeklyUsd: z.number().min(0).max(50_000).nullable().optional(),
  limitMonthlyUsd: z.number().min(0).max(200_000).nullable().optional(),
  canLoginWebUi: z.boolean().optional(),
  isEnabled: z.boolean().optional(),
});
```

{% callout type="warning" title="验证失败处理" %}
如果传入的数据不符合验证规则，操作会立即失败并返回 `INVALID_FORMAT` 错误，
不会执行任何数据库更新。建议在调用前在前端也进行相同的验证。
{% /callout %}

## 批量大小限制

为了保证系统稳定性，单次批量操作最多支持 500 个条目：

```typescript
// 用户批量更新限制
const MAX_BATCH_SIZE = 500;

// Key 批量更新限制
const MAX_BATCH_SIZE = 500;
```

如果尝试更新超过 500 个条目，操作将失败并返回 `BATCH_SIZE_EXCEEDED` 错误。

{% callout type="warning" title="分批处理建议" %}
当需要更新大量用户时，建议将数据分成多个批次，每批不超过 500 个。
可以在界面上分批选择，或通过 API 多次调用实现。
{% /callout %}

## 权限要求

所有批量操作都需要管理员权限。系统会在多个层面进行权限检查：

1. **会话认证** - 用户必须已登录
2. **角色验证** - 用户必须具有 "admin" 角色
3. **字段级权限** - 某些敏感字段仅限管理员修改

非管理员用户尝试执行批量操作将收到 `PERMISSION_DENIED` 错误。

## API 参考

### 批量更新用户

**函数**: `batchUpdateUsers`
**位置**: `src/actions/users.ts`

**接口定义**:

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
  requestedCount: number;  // 请求更新的数量
  updatedCount: number;    // 实际更新的数量
  updatedIds: number[];    // 已更新的用户 ID 列表
}
```

**使用示例**:

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

### 批量更新 Key

**函数**: `batchUpdateKeys`
**位置**: `src/actions/keys.ts`

**接口定义**:

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

**使用示例**:

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

### 返回值说明

所有批量操作都返回统一的 `ActionResult` 类型：

```typescript
type ActionResult<T = undefined> =
  | { ok: true; data?: T }
  | { ok: false; error: string; errorCode?: string; errorParams?: Record<string, string | number> };
```

**成功响应** (`ok: true`):
- `data`: 包含操作结果数据
  - `requestedCount`: 请求更新的条目数
  - `updatedCount`: 实际更新的条目数
  - `updatedIds`: 已更新的 ID 列表

**失败响应** (`ok: false`):
- `error`: 错误消息（已本地化的用户友好提示）
- `errorCode`: 错误代码，用于程序化处理
- `errorParams`: 错误消息中的动态参数

**处理示例**:

```typescript
const result = await batchUpdateUsers({ userIds: [1, 2, 3], updates: { rpm: 100 } });

if (!result.ok) {
  switch (result.errorCode) {
    case "BATCH_SIZE_EXCEEDED":
      console.error("批量大小超过限制，请减少选择的数量");
      break;
    case "PERMISSION_DENIED":
      console.error("权限不足，需要管理员权限");
      break;
    case "CANNOT_DISABLE_LAST_KEY":
      console.error("不能禁用用户的最后一个 Key");
      break;
    default:
      console.error(`操作失败: ${result.error}`);
  }
}
```

### 批量查询用户

**函数**: `getUsersBatch`
**位置**: `src/actions/users.ts`

支持游标分页，适合处理大量用户数据：

```typescript
export interface GetUsersBatchParams {
  cursor?: number;      // 分页游标
  limit?: number;       // 每页数量
  searchTerm?: string;  // 搜索关键词
  tagFilters?: string[];        // 标签过滤
  keyGroupFilters?: string[];   // Key 分组过滤
  statusFilter?: "all" | "active" | "expired" | 
                   "expiringSoon" | "enabled" | "disabled";
  sortBy?: "name" | "tags" | "expiresAt" | "rpm" | 
            "limit5hUsd" | "limitDailyUsd" | 
            "limitWeeklyUsd" | "limitMonthlyUsd" | "createdAt";
  sortOrder?: "asc" | "desc";
}

export interface GetUsersBatchResult {
  users: UserDisplay[];
  nextCursor: number | null;
  hasMore: boolean;
}
```

**使用示例**:

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

## 界面组件

批量操作功能由以下 React 组件实现：

{% table %}
| 组件 | 路径 | 功能 |
|------|------|------|
| `BatchEditDialog` | `user/batch-edit/batch-edit-dialog.tsx` | 批量编辑主对话框 |
| `BatchEditToolbar` | `user/batch-edit/batch-edit-toolbar.tsx` | 批量模式工具栏 |
| `BatchUserSection` | `user/batch-edit/batch-user-section.tsx` | 用户字段编辑区 |
| `BatchKeySection` | `user/batch-edit/batch-key-section.tsx` | Key 字段编辑区 |
| `FieldCard` | `user/batch-edit/field-card.tsx` | 可启用的字段卡片 |
| `utils` | `user/batch-edit/utils.ts` | ICU 模板格式化工具 |
{% /table %}

### 使用界面进行批量操作

1. **进入批量模式**: 在用户管理表格中点击 "批量编辑" 按钮
2. **选择条目**: 使用复选框选择多个用户或单个 Key
3. **配置字段**: 启用需要修改的字段并设置新值
4. **确认变更**: 查看受影响的用户/Key 和字段变更
5. **执行更新**: 原子性应用所有变更

### 界面交互细节

**批量编辑对话框** (`BatchEditDialog`) 的工作流程：

```typescript
interface BatchEditDialogProps {
  open: boolean;                    // 对话框显示状态
  onOpenChange: (open: boolean) => void;
  selectedUserIds: Set<number>;     // 选中的用户 ID 集合
  selectedKeyIds: Set<number>;      // 选中的 Key ID 集合
  onSuccess?: () => void;           // 成功回调
}
```

**字段卡片** (`FieldCard`) 的设计：

每个可批量修改的字段都使用 FieldCard 组件包装，提供：
- 启用/禁用开关：控制是否更新该字段
- 输入控件：根据字段类型显示不同的输入方式
- 验证反馈：实时显示输入验证错误

```typescript
interface FieldCardProps {
  title: string;           // 字段标题
  description?: string;    // 字段说明
  enabled: boolean;        // 是否启用
  onEnabledChange: (enabled: boolean) => void;
  children: React.ReactNode;  // 输入控件
}
```

**工具栏** (`BatchEditToolbar`) 提供以下功能：
- 进入/退出批量模式
- 全选/取消全选
- 显示当前选中数量
- 打开批量编辑对话框

## 错误处理

### 常见错误码

{% table %}
| 错误码 | 说明 | 处理建议 |
|--------|------|----------|
| `BATCH_SIZE_EXCEEDED` | 批量大小超过 500 限制 | 减少单次选择的数量，分批处理 |
| `EMPTY_UPDATE` | 未指定任何更新字段 | 至少启用一个字段并设置值 |
| `NOT_FOUND` | 部分用户或 Key 不存在 | 刷新列表后重试 |
| `PERMISSION_DENIED` | 权限不足 | 确认当前用户具有管理员角色 |
| `CANNOT_DISABLE_LAST_KEY` | 不能禁用用户的最后一个 Key | 确保每个用户至少保留一个启用的 Key |
| `UPDATE_FAILED` | 更新行数不匹配 | 可能是数据已被删除，请刷新后重试 |
{% /table %}

### 空更新验证

系统会阻止没有任何实际变更的批量更新。如果调用时 `updates` 对象为空，
将返回 `EMPTY_UPDATE` 错误：

```typescript
const hasAnyUpdate = Object.values(updates).some((v) => v !== undefined);
if (!hasAnyUpdate) {
  return { 
    ok: false, 
    error: tError("EMPTY_UPDATE"), 
    errorCode: ERROR_CODES.EMPTY_UPDATE 
  };
}
```

### 不存在条目处理

在执行更新前，系统会验证所有请求的用户/Key 是否存在。如果有任何条目不存在，
整个事务将失败：

```typescript
await db.transaction(async (tx) => {
  const existingRows = await tx
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(and(
      inArray(usersTable.id, requestedIds), 
      isNull(usersTable.deletedAt)
    ));

  const existingSet = new Set(existingRows.map((r) => r.id));
  const missingIds = requestedIds.filter((id) => !existingSet.has(id));
  
  if (missingIds.length > 0) {
    throw new BatchUpdateError(
      `部分用户不存在: ${missingIds.join(", ")}`,
      ERROR_CODES.NOT_FOUND
    );
  }
});
```

## 边界情况处理

### 禁用最后一个 Key 的保护

批量更新 Key 时，系统会阻止禁用用户的最后一个启用 Key。
此验证在更新前后都会执行，防止竞态条件：

```typescript
// 更新前检查
if (updates.isEnabled === false) {
  const currentKeyStates = await tx
    .select({ id: keysTable.id, userId: keysTable.userId, 
              isEnabled: keysTable.isEnabled })
    .from(keysTable)
    .where(and(
      inArray(keysTable.id, requestedIds), 
      isNull(keysTable.deletedAt)
    ));

  // 统计每个用户将被禁用的 Key 数量
  const userDisableCounts = new Map<number, number>();
  for (const key of currentKeyStates) {
    if (key.isEnabled) {
      userDisableCounts.set(
        key.userId, 
        (userDisableCounts.get(key.userId) ?? 0) + 1
      );
    }
  }

  // 确保每个用户至少保留一个启用的 Key
  for (const [userId, disableCount] of userDisableCounts) {
    const currentEnabledCount = userEnabledCounts.get(userId) ?? 0;
    if (currentEnabledCount - disableCount < 1) {
      throw new BatchUpdateError(
        tError("CANNOT_DISABLE_LAST_KEY"), 
        ERROR_CODES.OPERATION_FAILED
      );
    }
  }
}
```

### 事务回滚

所有批量更新都包装在数据库事务中。如果更新过程中任何部分失败，
整个操作将回滚，确保数据一致性：

```typescript
await db.transaction(async (tx) => {
  // 事务内的所有操作都是原子的
  // 如果抛出任何错误，所有变更都会被回滚
});
```

### 行数不匹配检查

更新后，系统会验证实际更新的行数是否与请求的数量一致：

```typescript
if (updatedIds.length !== requestedIds.length) {
  throw new BatchUpdateError(
    "批量更新失败：更新行数不匹配", 
    ERROR_CODES.UPDATE_FAILED
  );
}
```

这可以捕获在存在检查和实际更新之间某些行被删除的边界情况。

### 部分成功处理

当用户更新成功但 Key 更新失败时（或相反），UI 层会妥善处理：

```typescript
if (anySuccess) {
  // 刷新相关查询缓存
  await queryClient.invalidateQueries({ queryKey: ["users"] });
  await queryClient.invalidateQueries({ queryKey: ["userKeyGroups"] });
  await queryClient.invalidateQueries({ queryKey: ["userTags"] });
}

// 只有完全成功时才关闭对话框
if (anySuccess && !anyFailed) {
  onSuccess?.();
  handleRequestClose(false);
} else {
  // 关闭确认对话框，但保持主对话框打开以便重试
  setConfirmOpen(false);
}
```

### 重复 ID 处理

系统会自动去重用户/Key ID：

```typescript
const requestedIds = Array.from(new Set(params.userIds))
  .filter((id) => Number.isInteger(id));
```

### Null 值处理

对于配额字段，系统区分 "不修改"（undefined）和 "清除限制"（null）：

```typescript
if (updates.dailyQuota !== undefined) {
  dbUpdates.dailyLimitUsd = updates.dailyQuota === null 
    ? null 
    : updates.dailyQuota.toString();
}
```

将字段设为 `null` 会清除限制（无限制），而省略字段（undefined）则保持原有值不变。

## 实际应用场景

### 场景一：为新团队批量配置用户

假设你需要为新加入的 "team-alpha" 团队配置 20 个用户，每个用户需要相同的配额设置：

```typescript
// 第一步：获取团队用户
const teamUsers = await getUsersBatch({
  searchTerm: "team-alpha",
  limit: 50
});

if (!teamUsers.ok) {
  console.error("Failed to fetch users");
  return;
}

const userIds = teamUsers.data.users.map(u => u.id);

// 第二步：批量应用配置
const result = await batchUpdateUsers({
  userIds,
  updates: {
    tags: ["team-alpha", "engineering"],
    rpm: 200,
    dailyQuota: 100.00,
    limitWeeklyUsd: 500.00,
    limitMonthlyUsd: 2000.00
  }
});

if (result.ok) {
  console.log(`Successfully configured ${result.data.updatedCount} team members`);
}
```

### 场景二：批量迁移供应商分组

当需要将一批用户从 "staging" 环境迁移到 "production" 环境时：

```typescript
// 获取 staging 环境的所有 Key
const stagingKeys = await getUsersBatch({
  tagFilters: ["staging"],
  limit: 500
});

// 收集所有 Key ID
const keyIds: number[] = [];
for (const user of stagingKeys.data?.users || []) {
  // 假设每个用户的 keys 数组包含 Key 信息
  keyIds.push(...user.keys.map(k => k.id));
}

// 批量更新供应商分组
const result = await batchUpdateKeys({
  keyIds,
  updates: {
    providerGroup: "production",
    limitDailyUsd: 50.00  // 生产环境设置更严格的限额
  }
});
```

### 场景三：临时提升配额应对高峰期

在业务高峰期临时提升一批用户的 RPM 限制：

```typescript
// 为所有 premium 用户临时提升配额
const premiumUsers = await getUsersBatch({
  tagFilters: ["premium"],
  statusFilter: "active",
  limit: 500
});

if (premiumUsers.ok) {
  const userIds = premiumUsers.data.users.map(u => u.id);

  await batchUpdateUsers({
    userIds,
    updates: {
      rpm: 500,  // 从默认 120 提升到 500
      limit5hUsd: 100.00  // 同时提升短期限额
    }
  });
}

// 高峰期过后恢复默认设置
// ... 类似的批量更新代码
```

### 场景四：清理过期用户标签

批量移除不再使用的标签：

```typescript
// 为所有带有 "legacy-project" 标签的用户移除该标签
const legacyUsers = await getUsersBatch({
  tagFilters: ["legacy-project"],
  limit: 500
});

if (legacyUsers.ok) {
  for (const user of legacyUsers.data.users) {
    // 过滤掉 legacy-project 标签，保留其他标签
    const newTags = user.tags.filter(t => t !== "legacy-project");

    await batchUpdateUsers({
      userIds: [user.id],
      updates: { tags: newTags }
    });
  }
}
```

## 性能注意事项

### 数据库事务开销

批量更新使用数据库事务确保原子性，但大事务会带来以下开销：

1. **锁竞争**: 大批量更新会增加行锁持有时间
2. **回滚段**: 大事务需要更多 undo 空间
3. **复制延迟**: 主从架构下大事务会增加复制延迟

{% callout type="note" title="性能优化建议" %}
- 单批控制在 100-200 个条目可获得最佳性能
- 避免在高峰期执行大批量更新
- 大批量更新时考虑分批提交
{% /callout %}

### 缓存失效策略

批量更新成功后，系统会自动刷新相关缓存：

```typescript
// 自动刷新的查询缓存
await queryClient.invalidateQueries({ queryKey: ["users"] });
await queryClient.invalidateQueries({ queryKey: ["userKeyGroups"] });
await queryClient.invalidateQueries({ queryKey: ["userTags"] });
```

这意味着大批量更新后，所有客户端都会重新获取数据，可能产生较高的数据库查询负载。

## 安全考虑

### 操作审计

建议对批量操作进行审计记录：

```typescript
// 在调用批量更新前记录操作日志
async function auditedBatchUpdate(
  adminId: number,
  params: BatchUpdateUsersParams
) {
  // 记录操作开始
  await logAuditEvent({
    adminId,
    action: "BATCH_UPDATE_USERS",
    targetCount: params.userIds.length,
    updates: Object.keys(params.updates),
    timestamp: new Date()
  });

  const result = await batchUpdateUsers(params);

  // 记录操作结果
  await logAuditEvent({
    adminId,
    action: "BATCH_UPDATE_USERS_COMPLETE",
    success: result.ok,
    updatedCount: result.ok ? result.data.updatedCount : 0,
    error: result.ok ? undefined : result.error
  });

  return result;
}
```

### 敏感字段保护

某些字段的批量修改需要格外谨慎：

{% table %}
| 字段 | 风险等级 | 注意事项 |
|------|----------|----------|
| `isEnabled` | 高 | 禁用 Key 可能导致服务中断 |
| `providerGroup` | 中 | 错误的分组可能导致路由失败 |
| `rpm` | 中 | 设置过高可能导致成本激增 |
| `dailyQuota` | 中 | 设置过高可能导致成本激增 |
| `tags` | 低 | 通常用于组织管理，风险较低 |
{% /table %}

## 故障排查

### 常见问题

**问题：批量更新返回 `UPDATE_FAILED` 错误**

可能原因：
- 在存在检查和实际更新之间，某些用户/Key 被删除
- 数据库连接中断
- 并发更新导致行锁超时

解决方案：
1. 刷新用户列表后重试
2. 减小批量大小
3. 检查数据库连接状态

**问题：部分用户更新成功，部分失败**

这是预期行为吗？不是。批量更新是原子操作，应该全部成功或全部失败。

可能原因：
- 事务超时导致部分提交（不应发生）
- 应用层逻辑错误

解决方案：
- 检查服务端日志
- 确认数据库事务配置正确

**问题：更新后数据未立即生效**

可能原因：
- 客户端缓存未刷新
- 其他会话的缓存数据

解决方案：
```typescript
// 强制刷新缓存
await queryClient.invalidateQueries({
  queryKey: ["users"],
  exact: false  // 刷新所有匹配的查询
});
```

## 最佳实践

### 批量更新策略

1. **小批量测试**: 先对少量用户测试批量更新，确认效果后再扩大范围
2. **分批处理**: 超过 500 个用户时，分成多个批次处理
3. **标签管理**: 使用标签对用户分组，便于后续批量选择
4. **配额规划**: 设置合理的消费限额，避免意外超支

### 权限管理

- 仅授予可信管理员批量操作权限
- 定期审查管理员列表
- 对敏感操作（如禁用 Key）进行二次确认

### 监控与审计

- 关注批量操作的错误日志
- 定期检查用户配额使用情况
- 使用标签追踪不同用户组的配置

### 开发建议

1. **封装业务逻辑**: 将常见的批量操作封装成可复用的函数
2. **进度反馈**: 大批量操作时提供进度反馈
3. **预览功能**: 执行前显示将要影响的条目列表
4. **撤销机制**: 考虑实现批量操作的撤销功能

## 数据一致性保证

### 原子性操作

批量更新是原子性操作，遵循 "全有或全无" 原则：

```
开始事务
  ├── 验证所有条目存在
  ├── 执行业务规则检查
  ├── 更新数据库记录
  └── 验证更新结果
提交/回滚事务
```

这意味着：
- 所有选中的用户/Key 都会成功更新
- 或者所有更新都不会生效
- 不会出现部分成功、部分失败的情况

### 并发控制

系统使用数据库事务隔离级别防止并发冲突：

```typescript
await db.transaction(async (tx) => {
  // 使用 SELECT FOR UPDATE 锁定行
  const existingRows = await tx
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(inArray(usersTable.id, requestedIds))
    .for('update');  // 行级锁定
  
  // 执行更新...
});
```

这确保了：
- 同时执行的两个批量更新不会互相覆盖
- 正在更新的记录不会被其他操作修改
- 数据一致性得到保证

### 软删除处理

批量操作会自动排除已软删除的用户和 Key：

```typescript
.where(and(
  inArray(usersTable.id, requestedIds),
  isNull(usersTable.deletedAt)  // 排除已删除的记录
))
```

如果你尝试更新已删除的用户，会收到 `NOT_FOUND` 错误。

## 与单条操作的对比

{% table %}
| 特性 | 批量操作 | 单条操作 |
|------|----------|----------|
| 性能 | 一次请求更新多条记录 | 每条记录单独请求 |
| 原子性 | 全部成功或全部失败 | 独立执行 |
| 适用场景 | 大量相似配置的用户 | 个性化配置 |
| 错误处理 | 整体失败 | 独立失败 |
| 权限检查 | 一次检查 | 每次检查 |
{% /table %}

### 何时使用批量操作

**适合使用批量操作**：
- 为新团队配置统一配额
- 批量迁移供应商分组
- 统一调整 RPM 限制
- 批量添加/移除标签

**适合使用单条操作**：
- 为特定用户设置个性化配置
- 修改单个用户的备注信息
- 调整单个 Key 的特殊权限

## 相关文档

- [用户管理](/docs/users/user-management) - 了解单个用户的创建和管理
- [Key 管理](/docs/users/key-management) - 了解 API Key 的详细配置
- [权限系统](/docs/advanced-settings/permissions) - 了解角色和权限配置
