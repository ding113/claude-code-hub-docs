# 用户标签功能 - Round 1 探索草稿

## 文档元数据

- **路由**: `/docs/users/tags`
- **状态**: Round 1 - 技术探索草稿
- **目标**: 全面理解用户标签功能的技术实现
- **字数**: 约 4,500 字

---

## 1. Intent Analysis (功能意图分析)

### 1.1 功能定位

用户标签(User Tags)是 Claude Code Hub 中用于**用户分类管理**和**批量筛选**的核心功能。它允许管理员为每个用户分配多个标签，实现灵活的用户组织和快速定位。

### 1.2 核心使用场景

**场景一：用户分类管理**
- 按部门/团队标记用户（如 `engineering`, `product`, `design`）
- 按客户等级标记（如 `vip`, `enterprise`, `trial`）
- 按使用场景标记（如 `api-only`, `web-ui`, `cli`）

**场景二：批量筛选与操作**
- 快速筛选特定标签的用户进行批量编辑
- 在排行榜中按标签筛选查看特定群体的使用情况
- 结合其他筛选条件（状态、密钥分组）进行精细化用户管理

**场景三：权限与配额管理**
- 通过标签识别特定用户群体，配合其他系统功能实施差异化策略
- 标签作为元数据，可与外部系统集成进行用户身份识别

### 1.3 设计哲学

1. **自由标签 vs 受控标签**: 系统采用自由标签模式，管理员可以创建任意标签，而非从预定义列表中选择
2. **多标签支持**: 每个用户可拥有最多 20 个标签，满足复杂分类需求
3. **标签即筛选**: 标签设计的核心目的是筛选，而非权限控制
4. **扁平化结构**: 不支持标签层级或嵌套，保持简单直观

---

## 2. Behavior Summary (行为总结)

### 2.1 标签创建与分配

**创建方式**:
- **用户创建时分配**: 在创建用户对话框中通过 `ArrayTagInputField` 组件添加标签
- **用户编辑时修改**: 在编辑用户对话框中增删标签
- **批量编辑**: 通过批量编辑对话框同时修改多个用户的标签

**标签格式规范**:
- 单个标签最大长度: 32 字符
- 单个用户最多标签数: 20 个
- 标签内容限制: 字母、数字、下划线、连字符（正则: `/^[a-zA-Z0-9_-]+$/`）
- 不允许重复标签

**验证规则** (来自 `/Users/ding/Github/claude-code-hub/src/lib/validation/schemas.ts`):
```typescript
tags: z
  .array(z.string().max(32, "标签长度不能超过32个字符"))
  .max(20, "标签数量不能超过20个")
  .optional()
  .default([]),
```

### 2.2 标签筛选行为

**筛选位置**:
- 用户管理页面的工具栏
- 排行榜页面的筛选区域

**筛选逻辑**:
- **OR 逻辑**: 选择多个标签时，返回包含**任意**选中标签的用户
- 与密钥分组筛选是 AND 关系
- 与搜索词、状态筛选叠加使用

**筛选流程**:
1. 管理员在 `TagInput` 组件中选择标签
2. 标签通过 `getUsersBatch` action 传递到后端
3. 后端使用 PostgreSQL JSONB 操作符进行筛选

### 2.3 标签管理行为

**标签发现**:
- 系统自动收集所有用户的标签
- 在标签输入框中提供自动完成建议
- 通过 `getAllUserTags` action 获取全量标签列表

**标签生命周期**:
- 标签没有独立的生命周期，随用户创建而创建，随用户删除而消失
- 当最后一个使用某标签的用户被删除，该标签自然消失
- 没有单独的"标签管理"界面

---

## 3. Technical Architecture (技术架构)

### 3.1 数据模型

**数据库 Schema** (来自 `/Users/ding/Github/claude-code-hub/src/drizzle/schema.ts`):

```typescript
// Users table
export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  name: varchar('name').notNull(),
  description: text('description'),
  role: varchar('role').default('user'),
  rpmLimit: integer('rpm_limit'),
  dailyLimitUsd: numeric('daily_limit_usd', { precision: 10, scale: 2 }),
  providerGroup: varchar('provider_group', { length: 200 }).default('default'),
  // 用户标签（用于分类和筛选）
  tags: jsonb('tags').$type<string[]>().default([]),
  // ... 其他字段
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});
```

**关键设计决策**:
- 使用 `jsonb` 类型存储标签数组，支持灵活的标签操作
- 默认值为空数组 `[]`，避免 null 处理
- 没有单独的 tags 表，简化数据模型

**TypeScript 类型定义** (来自 `/Users/ding/Github/claude-code-hub/src/types/user.ts`):

```typescript
export interface User {
  id: number;
  name: string;
  description: string;
  role: "admin" | "user";
  rpm: number | null;
  dailyQuota: number | null;
  providerGroup: string | null;
  tags?: string[]; // 用户标签（可选）
  // ... 其他字段
}

export interface CreateUserData {
  name: string;
  description: string;
  rpm?: number | null;
  dailyQuota?: number | null;
  providerGroup?: string | null;
  tags?: string[]; // 可选，用户标签
  // ... 其他字段
}

export interface UpdateUserData {
  name?: string;
  description?: string;
  rpm?: number | null;
  dailyQuota?: number | null;
  providerGroup?: string | null;
  tags?: string[]; // 可选，用户标签
  // ... 其他字段
}
```

### 3.2 后端实现

#### 3.2.1 Repository 层

**文件**: `/Users/ding/Github/claude-code-hub/src/repository/user.ts`

**创建用户时处理标签**:
```typescript
export async function createUser(userData: CreateUserData): Promise<User> {
  const dbData = {
    name: userData.name,
    description: userData.description,
    rpmLimit: userData.rpm,
    dailyLimitUsd: userData.dailyQuota?.toString(),
    providerGroup: userData.providerGroup,
    tags: userData.tags ?? [], // 标签默认为空数组
    // ... 其他字段
  };

  const [user] = await db.insert(users).values(dbData).returning({
    // ...
    tags: users.tags,
    // ...
  });

  return toUser(user);
}
```

**更新用户时处理标签**:
```typescript
export async function updateUser(id: number, userData: UpdateUserData): Promise<User | null> {
  interface UpdateDbData {
    // ...
    tags?: string[];
    // ...
  }

  const dbData: UpdateDbData = {
    updatedAt: new Date(),
  };
  
  if (userData.tags !== undefined) dbData.tags = userData.tags;
  // ... 处理其他字段

  const [user] = await db
    .update(users)
    .set(dbData)
    .where(and(eq(users.id, id), isNull(users.deletedAt)))
    .returning({
      // ...
      tags: users.tags,
      // ...
    });

  return user ? toUser(user) : null;
}
```

**标签筛选实现** (核心逻辑):
```typescript
export async function findUserListBatch(
  filters: UserListBatchFilters
): Promise<UserListBatchResult> {
  const {
    cursor,
    limit = 50,
    searchTerm,
    tagFilters,  // 标签筛选参数
    keyGroupFilters,
    statusFilter,
    sortBy = "createdAt",
    sortOrder = "asc",
  } = filters;

  const conditions = [isNull(users.deletedAt)];

  // 搜索词也匹配标签
  const trimmedSearch = searchTerm?.trim();
  if (trimmedSearch) {
    const pattern = `%${trimmedSearch}%`;
    conditions.push(sql`(
      ${users.name} ILIKE ${pattern}
      OR ${users.description} ILIKE ${pattern}
      OR ${users.providerGroup} ILIKE ${pattern}
      OR EXISTS (
        SELECT 1
        FROM jsonb_array_elements_text(coalesce(${users.tags}, '[]'::jsonb)) AS tag
        WHERE tag ILIKE ${pattern}
      )
      OR EXISTS (
        SELECT 1
        FROM ${keysTable}
        WHERE ${keysTable.userId} = ${users.id}
          AND ${keysTable.deletedAt} IS NULL
          AND (
            ${keysTable.name} ILIKE ${pattern}
            OR ${keysTable.key} ILIKE ${pattern}
            OR ${keysTable.providerGroup} ILIKE ${pattern}
          )
      )
    )`);
  }

  // Multi-tag filter with OR logic: users with ANY selected tag
  const normalizedTags = (tagFilters ?? []).map((tag) => tag.trim()).filter(Boolean);
  let tagFilterCondition: SQL | undefined;
  if (normalizedTags.length > 0) {
    const tagConditions = normalizedTags.map(
      (tag) => sql`${users.tags} @> ${JSON.stringify([tag])}::jsonb`
    );
    tagFilterCondition = sql`(${sql.join(tagConditions, sql` OR `)})`;
  }

  // 与密钥分组筛选组合（AND 关系）
  const trimmedGroups = (keyGroupFilters ?? []).map((group) => group.trim()).filter(Boolean);
  let keyGroupFilterCondition: SQL | undefined;
  if (trimmedGroups.length > 0) {
    const groupConditions = trimmedGroups.map(
      (group) =>
        sql`${group} = ANY(regexp_split_to_array(coalesce(${users.providerGroup}, ''), '\\s*,\\s*'))`
    );
    keyGroupFilterCondition = sql`(${sql.join(groupConditions, sql` OR `)})`;
  }

  if (tagFilterCondition && keyGroupFilterCondition) {
    conditions.push(sql`(${tagFilterCondition}) AND (${keyGroupFilterCondition})`);
  } else if (tagFilterCondition) {
    conditions.push(tagFilterCondition);
  } else if (keyGroupFilterCondition) {
    conditions.push(keyGroupFilterCondition);
  }

  // ... 执行查询
}
```

**获取所有标签** (用于筛选下拉框):
```typescript
/**
 * Get all unique tags from all users (for tag filter dropdown)
 * Returns tags from all users regardless of current filters
 */
export async function getAllUserTags(): Promise<string[]> {
  const result = await db.select({ tags: users.tags }).from(users).where(isNull(users.deletedAt));

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

#### 3.2.2 Action 层

**文件**: `/Users/ding/Github/claude-code-hub/src/actions/users.ts`

**获取所有用户标签**:
```typescript
/**
 * 获取所有用户标签（用于标签筛选下拉框）
 * 返回所有用户的标签，不受当前筛选条件影响
 *
 * 注意：仅管理员可用。
 */
export async function getAllUserTags(): Promise<ActionResult<string[]>> {
  try {
    const tError = await getTranslations("errors");

    const session = await getSession();
    if (!session) {
      return {
        ok: false,
        error: tError("UNAUTHORIZED"),
        errorCode: ERROR_CODES.UNAUTHORIZED,
      };
    }

    if (session.user.role !== "admin") {
      return {
        ok: false,
        error: tError("PERMISSION_DENIED"),
        errorCode: ERROR_CODES.PERMISSION_DENIED,
      };
    }

    const tags = await getAllUserTagsRepository();
    return { ok: true, data: tags };
  } catch (error) {
    logger.error("Failed to get all user tags:", error);
    const message = error instanceof Error ? error.message : "Failed to get all user tags";
    return { ok: false, error: message, errorCode: ERROR_CODES.DATABASE_ERROR };
  }
}
```

**批量更新用户标签**:
```typescript
export interface BatchUpdateUsersParams {
  userIds: number[];
  updates: {
    note?: string;
    tags?: string[];  // 支持批量更新标签
    rpm?: number | null;
    dailyQuota?: number | null;
    limit5hUsd?: number | null;
    limitWeeklyUsd?: number | null;
    limitMonthlyUsd?: number | null;
  };
}

export async function batchUpdateUsers(
  params: BatchUpdateUsersParams
): Promise<ActionResult<BatchUpdateResult>> {
  // ... 权限检查

  const updatesSchema = UpdateUserSchema.pick({
    note: true,
    tags: true,  // 包含标签验证
    rpm: true,
    dailyQuota: true,
    limit5hUsd: true,
    limitWeeklyUsd: true,
    limitMonthlyUsd: true,
  });

  // ... 验证和更新逻辑
  
  await db.transaction(async (tx) => {
    // ...
    const dbUpdates: Record<string, unknown> = { updatedAt: new Date() };

    if (updates.note !== undefined) dbUpdates.description = updates.note;
    if (updates.tags !== undefined) dbUpdates.tags = updates.tags;  // 批量更新标签
    // ... 其他字段

    const updatedRows = await tx
      .update(usersTable)
      .set(dbUpdates)
      .where(and(inArray(usersTable.id, requestedIds), isNull(usersTable.deletedAt)))
      .returning({ id: usersTable.id });
    // ...
  });
  
  // ...
}
```

### 3.3 前端实现

#### 3.3.1 标签输入组件

**文件**: `/Users/ding/Github/claude-code-hub/src/components/ui/tag-input.tsx`

这是一个通用的标签输入组件，支持以下功能：
- 标签的添加、删除
- 自动完成建议
- 键盘导航（上下箭头、回车、退格）
- 粘贴批量添加
- 验证回调
- 最大标签数限制
- 最大标签长度限制

```typescript
export interface TagInputProps extends Omit<React.ComponentProps<"input">, "value" | "onChange"> {
  value: string[];
  onChange: (tags: string[]) => void;
  onChangeCommit?: (tags: string[]) => void;
  maxTags?: number;
  maxTagLength?: number;
  maxVisibleTags?: number;
  onSuggestionsClose?: () => void;
  clearable?: boolean;
  clearLabel?: string;
  onClear?: () => void;
  allowDuplicates?: boolean;
  separator?: RegExp;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  validateTag?: (tag: string) => boolean;
  onInvalidTag?: (tag: string, reason: string) => void;
  suggestions?: TagInputSuggestion[];
}

const DEFAULT_SEPARATOR = /[,，\n]/; // 逗号、中文逗号、换行符
const DEFAULT_TAG_PATTERN = /^[a-zA-Z0-9_-]+$/; // 字母、数字、下划线、连字符
```

#### 3.3.2 用户表单中的标签字段

**文件**: `/Users/ding/Github/claude-code-hub/src/app/[locale]/dashboard/_components/user/forms/user-form.tsx`

```typescript
<ArrayTagInputField
  label={tForm("tags.label")}
  maxTagLength={32}
  maxTags={20}
  placeholder={tForm("tags.placeholder")}
  description={tForm("tags.description")}
  onInvalidTag={(_tag, reason) => {
    const messages: Record<string, string> = {
      empty: tUI("emptyTag"),
      duplicate: tUI("duplicateTag"),
      too_long: tUI("tooLong", { max: 32 }),
      invalid_format: tUI("invalidFormat"),
      max_tags: tUI("maxTags"),
    };
    toast.error(messages[reason] || reason);
  }}
  {...form.getArrayFieldProps("tags")}
/>
```

#### 3.3.3 用户页面中的标签筛选

**文件**: `/Users/ding/Github/claude-code-hub/src/app/[locale]/dashboard/users/users-page-client.tsx`

```typescript
// 标签筛选状态
const [tagFilters, setTagFilters] = useState<string[]>([]);
const [pendingTagFilters, setPendingTagFilters] = useState<string[]>([]);

// 获取所有标签（用于建议）
const { data: allTags = [] } = useQuery({
  queryKey: ["userTags"],
  queryFn: async () => {
    const result = await getAllUserTags();
    if (!result.ok) throw new Error(result.error);
    return result.data;
  },
  enabled: isAdmin,
});

// 标签筛选 UI
<TagInput
  value={pendingTagFilters}
  onChange={setPendingTagFilters}
  onChangeCommit={handleTagCommit}
  suggestions={uniqueTags}
  placeholder={t("toolbar.tagFilter")}
  maxVisibleTags={2}
  allowDuplicates={false}
  validateTag={(tag) => uniqueTags.includes(tag)}
  onSuggestionsClose={handleApplyFilters}
  clearable
  clearLabel={tCommon("clear")}
  className="h-9 flex-nowrap items-center overflow-hidden py-1"
/>

// 提交筛选
const handleTagCommit = useCallback((nextTags: string[]) => {
  setTagFilters(nextTags);
  setPendingTagFilters(nextTags);
}, []);
```

#### 3.3.4 批量编辑中的标签

**文件**: `/Users/ding/Github/claude-code-hub/src/app/[locale]/dashboard/_components/user/batch-edit/batch-user-section.tsx`

```typescript
export interface BatchUserSectionState {
  noteEnabled: boolean;
  note: string;
  tagsEnabled: boolean;  // 标签字段启用开关
  tags: string[];        // 标签值
  // ... 其他字段
}

// 在批量编辑对话框中
<FieldCard
  title={translations.fields.tags}
  enabled={state.tagsEnabled}
  onEnabledChange={(enabled) => onChange({ tagsEnabled: enabled })}
  enableFieldAria={translations.enableFieldAria}
>
  <TagInput
    value={state.tags}
    onChange={(tags) => onChange({ tags })}
    disabled={!state.tagsEnabled}
    placeholder={translations.placeholders.tagsPlaceholder}
  />
</FieldCard>
```

---

## 4. Edge Cases (边界情况)

### 4.1 数据层边界

**空标签处理**:
- 数据库默认值为 `[]`，不会出现 null
- 前端表单默认值为 `[]`
- 标签数组为空时，用户列表正常显示，不显示标签徽章

**标签长度超限**:
- 单个标签最大 32 字符
- 超出时前端显示错误提示: "标签长度不能超过32个字符"
- Zod schema 验证阻止提交

**标签数量超限**:
- 单个用户最多 20 个标签
- 超出时 `onInvalidTag` 回调触发，显示 "标签数量不能超过20个"
- 批量粘贴时自动截断，只添加前 20 个有效标签

**非法字符**:
- 默认只允许字母、数字、下划线、连字符
- 非法字符触发 `invalid_format` 错误
- 可通过 `validateTag` 属性自定义验证逻辑

### 4.2 筛选边界

**无标签用户筛选**:
- 无法直接筛选"无标签"的用户
- 系统不提供反向筛选功能

**标签不存在**:
- 手动输入不存在的标签时，`validateTag` 返回 false
- 筛选下拉框只显示已存在的标签

**大量标签性能**:
- `getAllUserTags` 查询所有用户的所有标签
- 在内存中 dedupe 和排序
- 标签数量理论上无上限，但建议保持在合理范围（<1000）

### 4.3 并发与一致性

**批量编辑冲突**:
- 批量更新使用数据库事务保证原子性
- 标签更新会覆盖原有标签数组，而非合并
- 并发编辑同一用户时，后提交者覆盖前者

**标签删除**:
- 用户被软删除（`deletedAt` 设置）后，其标签不再出现在建议列表
- 硬删除用户后，标签数据随用户记录一起删除

---

## 5. Code References (代码引用)

### 5.1 核心文件清单

| 文件路径 | 描述 |
|---------|------|
| `/Users/ding/Github/claude-code-hub/src/drizzle/schema.ts` | 数据库 Schema 定义，users.tags 字段 |
| `/Users/ding/Github/claude-code-hub/src/types/user.ts` | TypeScript 类型定义 |
| `/Users/ding/Github/claude-code-hub/src/lib/validation/schemas.ts` | Zod 验证 Schema |
| `/Users/ding/Github/claude-code-hub/src/repository/user.ts` | 数据访问层，标签 CRUD 和筛选 |
| `/Users/ding/Github/claude-code-hub/src/actions/users.ts` | Server Actions，业务逻辑 |
| `/Users/ding/Github/claude-code-hub/src/components/ui/tag-input.tsx` | 标签输入 UI 组件 |
| `/Users/ding/Github/claude-code-hub/src/components/form/form-field.tsx` | 表单字段封装 |
| `/Users/ding/Github/claude-code-hub/src/app/[locale]/dashboard/_components/user/forms/user-form.tsx` | 用户表单 |
| `/Users/ding/Github/claude-code-hub/src/app/[locale]/dashboard/_components/user/batch-edit/batch-user-section.tsx` | 批量编辑用户字段 |
| `/Users/ding/Github/claude-code-hub/src/app/[locale]/dashboard/_components/user/batch-edit/batch-edit-dialog.tsx` | 批量编辑对话框 |
| `/Users/ding/Github/claude-code-hub/src/app/[locale]/dashboard/users/users-page-client.tsx` | 用户页面，标签筛选 |

### 5.2 关键代码片段

**数据库筛选条件构建** (来自 `/Users/ding/Github/claude-code-hub/src/repository/user.ts`):
```typescript
// Multi-tag filter with OR logic: users with ANY selected tag
const normalizedTags = (tagFilters ?? []).map((tag) => tag.trim()).filter(Boolean);
let tagFilterCondition: SQL | undefined;
if (normalizedTags.length > 0) {
  const tagConditions = normalizedTags.map(
    (tag) => sql`${users.tags} @> ${JSON.stringify([tag])}::jsonb`
  );
  tagFilterCondition = sql`(${sql.join(tagConditions, sql` OR `)})`;
}
```

**搜索包含标签**:
```typescript
OR EXISTS (
  SELECT 1
  FROM jsonb_array_elements_text(coalesce(${users.tags}, '[]'::jsonb)) AS tag
  WHERE tag ILIKE ${pattern}
)
```

### 5.3 相关 API 端点

**Server Actions**:
- `getAllUserTags()`: 获取所有标签（管理员）
- `getUsersBatch(params)`: 批量获取用户，支持 tagFilters
- `batchUpdateUsers(params)`: 批量更新用户标签
- `addUser(data)`: 创建用户，包含 tags
- `editUser(userId, data)`: 编辑用户，包含 tags

---

## 6. Summary (总结)

### 6.1 功能特点

1. **简单易用**: 自由标签模式，无需预定义
2. **灵活筛选**: OR 逻辑多标签筛选，与其他筛选条件组合
3. **批量操作**: 支持批量编辑用户标签
4. **实时建议**: 自动完成已存在的标签
5. **数据验证**: 长度、数量、格式多重验证

### 6.2 技术亮点

1. **JSONB 存储**: 利用 PostgreSQL JSONB 类型高效存储和查询
2. **@> 操作符**: 使用 PostgreSQL JSONB 包含操作符实现高效筛选
3. **组件复用**: TagInput 组件通用化，支持多种场景
4. **类型安全**: 完整的 TypeScript 类型定义

### 6.3 限制与注意事项

1. 无标签层级结构
2. 无标签权限控制
3. 筛选为 OR 逻辑，不支持 AND
4. 标签无独立生命周期管理
5. 大量标签可能影响筛选性能（需监控）

---

*文档生成时间: 2026-01-29*
*基于代码版本: claude-code-hub main branch*
