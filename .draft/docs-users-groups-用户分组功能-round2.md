# 用户分组功能 (User Groups) - Round 2 Review Draft

## Intent Analysis

### 功能定位
用户分组（Provider Group）是 claude-code-hub 中实现多租户资源隔离和权限控制的核心机制。该功能通过将供应商（Provider）划分为不同的逻辑分组，并将用户/密钥与特定分组关联，实现以下核心目标：

1. **资源隔离**：不同分组的用户只能访问其被授权的供应商池
2. **权限分级**：管理员可通过分组控制用户的 API 访问范围
3. **成本管控**：按分组分配不同成本等级的供应商资源
4. **灵活调度**：支持基于分组的供应商筛选和负载均衡

### 业务场景
- **场景1**：企业内部不同部门使用不同的供应商预算池（如"研发部"、"市场部"）
- **场景2**：区分"生产环境"和"测试环境"的供应商资源
- **场景3**：VIP 用户可访问高性能/低延迟的专属供应商组（如"premium"）
- **场景4**：限制特定用户只能使用免费的供应商端点（如"free"分组）
- **场景5**：为命令行工具用户分配专用供应商池（如"cli"分组）

### 关键设计决策
1. **分组是标签而非实体**：分组是字符串标签，无需预先创建，动态使用
2. **多对多关系**：一个供应商可属于多个分组（逗号分隔），一个用户/密钥可访问多个分组
3. **Key 级覆盖**：密钥的 providerGroup 优先级高于用户的 providerGroup
4. **自动同步**：用户分组自动计算为其所有 Key 分组的并集（非管理员创建 Key 时触发）
5. **安全模型**：非管理员用户无法直接修改 providerGroup，只能通过 Key 的创建/删除间接影响

---

## Behavior Summary

### 核心行为流程

#### 1. 分组定义与分配
```
供应商分组标签 (provider.groupTag)
    ↓
用户/密钥分组 (user.providerGroup / key.providerGroup)
    ↓
请求时分组匹配 (provider-selector.ts)
    ↓
供应商筛选与调度
```

#### 2. 分组匹配规则
- **默认分组**：`"default"` - 未指定分组时的 fallback，所有无 groupTag 的供应商自动归属此分组
- **全局通配**：`"*"` - 管理员专用，可访问所有分组（包括未标记的供应商）
- **交集匹配**：用户分组与供应商分组存在交集时允许访问
- **多标签支持**：支持逗号分隔的多个分组标签（如 `"cli,chat"`），空格会被自动 trim

#### 3. 分组继承优先级
```
Key.providerGroup > User.providerGroup > "default"
```

具体逻辑见 `src/app/v1/_lib/proxy/provider-selector.ts`：
```typescript
function getEffectiveProviderGroup(session?: ProxySession): string | null {
  if (!session?.authState) {
    return null;
  }
  const { key, user } = session.authState;
  if (key) {
    return key.providerGroup || PROVIDER_GROUP.DEFAULT;
  }
  if (user) {
    return user.providerGroup || PROVIDER_GROUP.DEFAULT;
  }
  return PROVIDER_GROUP.DEFAULT;
}
```

#### 4. 用户分组自动同步机制
当管理员执行以下操作时，自动触发用户分组同步：
- 创建新 Key (`addKey`)
- 编辑 Key 分组 (`editKey`)  
- 删除 Key (`removeKey`)
- 批量更新 Key (`batchUpdateKeys`)

同步逻辑：`用户分组 = 该用户所有 Key 的 providerGroup 并集`

同步函数 `syncUserProviderGroupFromKeys` 位于 `src/actions/users.ts` (lines 143-167)：
```typescript
export async function syncUserProviderGroupFromKeys(userId: number): Promise<void> {
  const keys = await findKeyList(userId);
  const allGroups = new Set<string>();

  for (const key of keys) {
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
}
```

---

## Config/Commands

### 数据库 Schema

#### Users 表
```typescript
// /Users/ding/Github/claude-code-hub/src/drizzle/schema.ts (lines 36-88)
export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  name: varchar('name').notNull(),
  description: text('description'),
  role: varchar('role').default('user'),
  rpmLimit: integer('rpm_limit'),
  dailyLimitUsd: numeric('daily_limit_usd', { precision: 10, scale: 2 }),
  providerGroup: varchar('provider_group', { length: 200 }).default('default'),  // 用户分组
  tags: jsonb('tags').$type<string[]>().default([]),
  // ... 其他字段
});
```

**字段演变历史**：
- 初始创建：varchar(50)，无默认值，可为 NULL
- 迁移 #0039：添加默认值 'default'，迁移现有 NULL 值
- 迁移 #0053：扩展长度至 varchar(200) 以支持更多分组标签

#### Keys 表
```typescript
// /Users/ding/Github/claude-code-hub/src/drizzle/schema.ts (lines 90-130)
export const keys = pgTable('keys', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull(),
  key: varchar('key').notNull(),
  name: varchar('name').notNull(),
  // ... 其他字段
  providerGroup: varchar('provider_group', { length: 200 }).default('default'),  // Key 级分组覆盖
  // ...
});
```

#### Providers 表
```typescript
// /Users/ding/Github/claude-code-hub/src/drizzle/schema.ts (lines 148-297)
export const providers = pgTable('providers', {
  id: serial('id').primaryKey(),
  name: varchar('name').notNull(),
  // ... 其他字段
  groupTag: varchar('group_tag', { length: 50 }),  // 供应商分组标签（可逗号分隔）
  // ...
}, (table) => ({
  // 分组查询优化索引
  providersGroupIdx: index('idx_providers_group').on(table.groupTag).where(sql`${table.deletedAt} IS NULL`),
  // ...
}));
```

**注意**：供应商的 groupTag 长度限制为 50 字符，而用户/Key 的 providerGroup 限制为 200 字符，以支持多分组组合。

### 常量定义
```typescript
// /Users/ding/Github/claude-code-hub/src/lib/constants/provider.constants.ts (lines 25-30)
export const PROVIDER_GROUP = {
  /** 默认分组标识符 - 用于表示未设置分组的 key/供应商 */
  DEFAULT: "default",
  /** 全局访问标识符 - 可访问所有供应商（管理员专用） */
  ALL: "*",
} as const;
```

### 核心工具函数

#### 分组标准化
```typescript
// /Users/ding/Github/claude-code-hub/src/lib/utils/provider-group.ts
import { PROVIDER_GROUP } from "@/lib/constants/provider.constants";

/**
 * Normalize provider group value to a consistent format
 * - Returns "default" for null/undefined/empty values
 * - Trims whitespace and removes duplicates
 * - Sorts groups alphabetically for consistency
 */
export function normalizeProviderGroup(value: unknown): string {
  if (value === null || value === undefined) return PROVIDER_GROUP.DEFAULT;
  if (typeof value !== "string") return PROVIDER_GROUP.DEFAULT;
  const trimmed = value.trim();
  if (trimmed === "") return PROVIDER_GROUP.DEFAULT;

  const groups = trimmed
    .split(",")
    .map((g) => g.trim())
    .filter(Boolean);
  if (groups.length === 0) return PROVIDER_GROUP.DEFAULT;

  return Array.from(new Set(groups)).sort().join(",");
}

export function parseProviderGroups(value: string): string[] {
  return value
    .split(",")
    .map((g) => g.trim())
    .filter(Boolean);
}
```

#### 分组颜色生成
```typescript
// /Users/ding/Github/claude-code-hub/src/lib/utils/color.ts
/**
 * Generate a stable color for a provider group string.
 * Returns a CSS hsl() string so it can be used in inline styles.
 */
export function getGroupColor(group?: string | null): string {
  const value = group?.trim();
  if (!value) {
    return "hsl(220, 10%, 40%)";  // Default gray
  }

  // Simple string hash to derive hue (0-359)
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }

  const hue = hash % 360;
  const saturation = 65;
  const lightness = 40;  // Lower lightness for white text contrast

  return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
}
```

### Server Actions

#### 获取可用分组列表
```typescript
// /Users/ding/Github/claude-code-hub/src/actions/providers.ts (lines 361-396)
export async function getAvailableProviderGroups(userId?: number): Promise<string[]> {
  try {
    const { getDistinctProviderGroups } = await import("@/repository/provider");
    const allGroups = await getDistinctProviderGroups();
    const allGroupsWithDefault = [
      PROVIDER_GROUP.DEFAULT,
      ...allGroups.filter((group) => group !== PROVIDER_GROUP.DEFAULT),
    ];

    // 无 userId 时返回全部分组（向后兼容）
    if (!userId) {
      return allGroupsWithDefault;
    }

    // 查询用户配置的分组
    const { findUserById } = await import("@/repository/user");
    const user = await findUserById(userId);

    const userGroups = (user?.providerGroup || PROVIDER_GROUP.DEFAULT)
      .split(",")
      .map((g) => g.trim())
      .filter(Boolean);

    // 管理员通配符：可访问所有分组
    if (userGroups.includes(PROVIDER_GROUP.ALL)) {
      return allGroupsWithDefault;
    }

    // 过滤：只返回用户配置的分组（但始终包含 default）
    const filtered = allGroupsWithDefault.filter((group) => userGroups.includes(group));
    return [PROVIDER_GROUP.DEFAULT, ...filtered.filter((g) => g !== PROVIDER_GROUP.DEFAULT)];
  } catch (error) {
    logger.error("获取供应商分组失败:", error);
    return [PROVIDER_GROUP.DEFAULT];
  }
}
```

#### 获取分组及供应商数量统计
```typescript
// /Users/ding/Github/claude-code-hub/src/actions/providers.ts (lines 398-440)
export async function getProviderGroupsWithCount(): Promise<
  ActionResult<Array<{ group: string; providerCount: number }>>
> {
  try {
    const providers = await findAllProvidersFresh();
    const groupCounts = new Map<string, number>();

    for (const provider of providers) {
      const groupTag = provider.groupTag?.trim();
      if (!groupTag) {
        groupCounts.set(PROVIDER_GROUP.DEFAULT, (groupCounts.get(PROVIDER_GROUP.DEFAULT) || 0) + 1);
        continue;
      }

      const groups = groupTag
        .split(",")
        .map((g) => g.trim())
        .filter(Boolean);

      for (const group of groups) {
        groupCounts.set(group, (groupCounts.get(group) || 0) + 1);
      }
    }
    // ... 返回排序后的结果
  }
}
```

#### 用户分组自动同步
```typescript
// /Users/ding/Github/claude-code-hub/src/actions/users.ts (lines 143-167)
export async function syncUserProviderGroupFromKeys(userId: number): Promise<void> {
  // Note: This function intentionally does NOT catch errors.
  // Callers (addKey, editKey, removeKey, batchUpdateKeys) have their own error handling
  // and should fail explicitly if provider group sync fails to maintain data consistency.
  const keys = await findKeyList(userId);
  const allGroups = new Set<string>();

  for (const key of keys) {
    // NOTE(#400): Key.providerGroup is now required (no more null semantics).
    // For backward compatibility, treat null/empty as "default".
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
  logger.info(
    `[UserAction] Synced user provider group: userId=${userId}, groups=${newProviderGroup}`
  );
}
```

#### 创建 Key 时的分组验证（非管理员）
```typescript
// /Users/ding/Github/claude-code-hub/src/actions/keys.ts (lines 34-59)
function validateNonAdminProviderGroup(
  userProviderGroup: string,
  requestedProviderGroup: string,
  options: { hasDefaultKey: boolean },
  tError: TranslationFunction
): string {
  const userGroups = parseProviderGroups(userProviderGroup);
  const requestedGroups = parseProviderGroups(requestedProviderGroup);

  // 管理员通配符检查
  if (userGroups.includes(PROVIDER_GROUP.ALL)) {
    return requestedProviderGroup;
  }

  const userGroupSet = new Set(userGroups);

  // 安全策略：创建 default 分组 Key 需要已有 default 分组 Key
  if (requestedGroups.includes(PROVIDER_GROUP.DEFAULT) && !options.hasDefaultKey) {
    throw new Error(tError("NO_DEFAULT_GROUP_PERMISSION"));
  }

  // 验证请求的分组都是用户已有分组的子集
  const invalidGroups = requestedGroups.filter((g) => !userGroupSet.has(g));
  if (invalidGroups.length > 0) {
    throw new Error(tError("NO_GROUP_PERMISSION", { groups: invalidGroups.join(", ") }));
  }

  return requestedProviderGroup;
}
```

### API 端点

#### 获取供应商列表（带分组信息）
```typescript
// /Users/ding/Github/claude-code-hub/src/app/api/actions/[...route]/route.ts (lines 352-384)
const { route: getProvidersRoute, handler: getProvidersHandler } = createActionRoute(
  "providers",
  "getProviders",
  providerActions.getProviders,
  {
    requestSchema: z.object({}).describe("无需请求参数"),
    responseSchema: z.array(
      z.object({
        id: z.number(),
        name: z.string(),
        // ...
        groups: z.array(z.string()).describe("分组"),  // 返回分组数组
        // ...
      })
    ),
    description: "获取所有供应商列表 (管理员)",
    tags: ["供应商管理"],
    requiredRole: "admin",
  }
);
```

---

## Edge Cases

### 1. 分组匹配边界情况

#### 供应商无分组标签
```typescript
// /Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/provider-selector.ts (lines 88-92)
const providerTags = providerGroupTag
  ? parseGroupString(providerGroupTag)
  : [PROVIDER_GROUP.DEFAULT];  // 无分组时视为 default
```
**行为**：供应商未设置 groupTag 时，视为属于 "default" 分组。

#### 用户/Key 无分组
```typescript
// 同样使用 DEFAULT 作为 fallback
return key.providerGroup || PROVIDER_GROUP.DEFAULT;
```

### 2. 权限绕过防护

#### 非管理员创建 Key 的分组限制
```typescript
// /Users/ding/Github/claude-code-hub/src/actions/keys.ts (lines 130-159)
// 非 admin 创建 Key 时的分组验证：providerGroup 必须是用户现有分组的子集
const userProviderGroup = normalizeProviderGroup(user.providerGroup);
const requestedProviderGroup = normalizeProviderGroup(data.providerGroup);

if (isAdmin) {
  providerGroupForKey = requestedProviderGroup;
} else {
  // NOTE(#400): Security - require an existing default-group key before allowing default
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

#### 删除 Key 时的分组保护
```typescript
// /Users/ding/Github/claude-code-hub/src/actions/keys.ts (lines 594-619)
// 非 admin 删除时的额外检查：确保删除后用户仍有分组
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
      error: "无法删除此密钥：删除后您将没有任何可用的供应商分组...",
    };
  }
}
```

#### 编辑 Key 时的分组保护
```typescript
// /Users/ding/Github/claude-code-hub/src/actions/keys.ts (lines 378-391)
// 普通用户禁止修改 providerGroup（即使是自己的 Key）
const providerGroupProvided = Object.hasOwn(data, "providerGroup");
if (session.user.role !== "admin" && providerGroupProvided) {
  const currentGroup = normalizeProviderGroup(key.providerGroup);
  const requestedGroup = normalizeProviderGroup(data.providerGroup);
  if (currentGroup !== requestedGroup) {
    return {
      ok: false,
      error: tError("PERMISSION_DENIED"),
      errorCode: ERROR_CODES.PERMISSION_DENIED,
    };
  }
}
```

### 3. 批量操作的分组同步
```typescript
// /Users/ding/Github/claude-code-hub/src/actions/keys.ts (lines 1022-1026)
// 批量更新 Key 后同步受影响用户的分组
if (normalizedProviderGroup !== undefined && affectedUserIds.length > 0) {
  await Promise.all(affectedUserIds.map((userId) => syncUserProviderGroupFromKeys(userId)));
}
```

### 4. 空分组与空数组处理
```typescript
// 分组标准化处理各种空值情况
if (value === null || value === undefined) return PROVIDER_GROUP.DEFAULT;
if (typeof value !== "string") return PROVIDER_GROUP.DEFAULT;
const trimmed = value.trim();
if (trimmed === "") return PROVIDER_GROUP.DEFAULT;
```

### 5. 并发情况下的分组竞争
**场景**：两个并发请求同时修改同一用户的 Key 分组
**处理**：通过数据库事务和行级锁保证一致性，同步操作在 Key 变更后触发

### 6. 严格分组隔离（Fix #281）
```typescript
// /Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/provider-selector.ts (lines 582-609)
if (!checkProviderGroupMatch(provider.groupTag, effectiveGroup)) {
  // Detailed logging based on specific failure reason
  if (!provider.groupTag) {
    logger.warn(
      "ProviderSelector: Session provider has no group tag but user/key requires group",
      {
        sessionId: session.sessionId,
        providerId: provider.id,
        effectiveGroups: effectiveGroup,
        message: "Strict group isolation: rejecting untagged provider for group-scoped user/key",
      }
    );
  }
  return null; // Reject reuse, re-select
}
```
**行为**：当用户/Key 有分组限制时，无 groupTag 的供应商会被拒绝访问。

---

## Frontend Components

### 分组选择器组件
```typescript
// /Users/ding/Github/claude-code-hub/src/app/[locale]/dashboard/_components/user/forms/provider-group-select.tsx
export interface ProviderGroupSelectProps {
  /** Comma-separated group tags. */
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  /** Whether to show provider counts in suggestions. Defaults to `true`. */
  showProviderCount?: boolean;
  translations: Record<string, unknown>;
}

export function ProviderGroupSelect({
  value,
  onChange,
  disabled = false,
  showProviderCount = true,
  translations,
}: ProviderGroupSelectProps) {
  // 加载分组列表及供应商数量
  // 支持标签输入和下拉建议
  // 选择新分组后自动移除 "default"
}
```

### 分组信息显示组件
```typescript
// /Users/ding/Github/claude-code-hub/src/app/[locale]/my-usage/_components/provider-group-info.tsx
interface ProviderGroupInfoProps {
  keyProviderGroup: string | null;
  userProviderGroup: string | null;
  userAllowedModels?: string[];
  userAllowedClients?: string[];
  className?: string;
}

export function ProviderGroupInfo({
  keyProviderGroup,
  userProviderGroup,
  userAllowedModels = [],
  userAllowedClients = [],
  className,
}: ProviderGroupInfoProps) {
  // 显示 Key 级分组（或继承自用户的分组）
  // 显示用户级分组
  // 显示访问限制（允许的模型和客户端）
}
```

---

## Error Messages

### i18n 错误码定义
```json
// /Users/ding/Github/claude-code-hub/messages/zh-CN/errors.json
{
  "NO_DEFAULT_GROUP_PERMISSION": "无权使用 default 分组，您当前没有 default 分组的 Key",
  "NO_GROUP_PERMISSION": "无权使用以下分组: {groups}"
}
```

```json
// /Users/ding/Github/claude-code-hub/messages/en/errors.json
{
  "NO_DEFAULT_GROUP_PERMISSION": "No permission to use default group. You don't have a Key with default group",
  "NO_GROUP_PERMISSION": "No permission to use the following groups: {groups}"
}
```

### 表单验证错误
```json
// /Users/ding/Github/claude-code-hub/messages/zh-CN/settings/providers/form/errors.json
{
  "groupTagTooLong": "分组标签总长度不能超过 {max} 个字符"
}
```

---

## Data Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          User Group Feature Flow                        │
└─────────────────────────────────────────────────────────────────────────┘

1. ADMIN: Create Provider with groupTag
   ┌─────────────┐     ┌─────────────────────┐
   │ ProviderForm │────▶│ providers.groupTag  │
   └─────────────┘     └─────────────────────┘
                              │
                              ▼
                    ┌─────────────────┐
                    │ "premium,chat"  │
                    └─────────────────┘

2. ADMIN: Create User (initial group from first Key)
   ┌──────────┐     ┌──────────────────────────┐
   │ UserForm  │────▶│ createUser()             │
   └──────────┘     │ - Creates user record    │
                    │ - Creates default Key    │
                    └──────────────────────────┘
                              │
                              ▼
                    ┌─────────────────┐
                    │ keys.providerGroup│
                    └─────────────────┘

3. ADMIN/USER: Create Additional Key with specific group
   ┌──────────┐     ┌──────────────────────────────┐
   │ AddKeyForm│────▶│ addKey()                     │
   └──────────┘     │ - Validate group permission  │
                    │ - Create Key record          │
                    │ - syncUserProviderGroupFromKeys()
                    └──────────────────────────────┘
                              │
                              ▼
                    ┌─────────────────────────┐
                    │ users.providerGroup =   │
                    │  keys groups UNION      │
                    └─────────────────────────┘

4. API Request: Provider Selection with Group Filter
   ┌──────────┐     ┌──────────────────────────────────────┐
   │ API Call  │────▶│ ProxyProviderResolver.pickProvider() │
   └──────────┘     └──────────────────────────────────────┘
                              │
              ┌───────────────┼───────────────┐
              ▼               ▼               ▼
         ┌─────────┐    ┌────────────┐   ┌──────────────┐
         │Session  │    │getEffective│   │checkProvider │
         │Auth     │───▶│ProviderGroup│──▶│GroupMatch    │
         └─────────┘    └────────────┘   └──────────────┘
                                              │
                                              ▼
                                    ┌─────────────────┐
                                    │ Filter providers│
                                    │ by group match  │
                                    └─────────────────┘

5. Permission Enforcement Points
   
   a) Key Creation (非管理员)
      - Requested group must be subset of user's current groups
      - Need existing default-group key to create new default-group key
   
   b) Key Deletion (非管理员)
      - Cannot delete last key of a group (would lose access)
   
   c) Key Edit (非管理员)
      - Cannot change providerGroup field
   
   d) API Request
      - Provider must match user's effective group
      - 403 if no matching providers available
```

---

## Security Considerations

1. **分组隔离严格性**：供应商选择器在每次请求时都重新计算有效分组，不依赖缓存
2. **权限最小化**：非管理员用户无法直接修改自己的分组，只能通过 Key 的创建/删除间接影响
3. **默认分组保护**：创建 default 分组的 Key 需要已有 default 分组的 Key，防止意外失去默认访问
4. **批量操作安全**：批量更新 Key 分组时，每个受影响用户的分组都会重新同步
5. **删除保护**：防止删除最后一个某分组的 Key 导致用户失去该分组访问权限
6. **编辑保护**：普通用户无法修改 Key 的 providerGroup 字段
7. **严格隔离（Fix #281）**：无 groupTag 的供应商对有限制的用户/Key 不可见

---

## Known Limitations

1. **分组无层级**：不支持分组继承或层级结构
2. **无分组配额**：分组本身没有独立的配额限制，配额在用户/Key 级别
3. **分组无元数据**：分组只是字符串标签，没有描述、创建时间等元数据
4. **即时生效**：分组变更立即生效，可能影响进行中的请求（通过 Session 快照缓解）
5. **长度限制差异**：供应商 groupTag 限制 50 字符，用户/Key providerGroup 限制 200 字符

---

## References

### 核心文件

#### 1. 数据库 Schema
**文件**: `/Users/ding/Github/claude-code-hub/src/drizzle/schema.ts`
- **Users 表** (lines 36-88): 定义 `providerGroup` 字段，varchar(200)，默认 "default"
- **Keys 表** (lines 90-130): 定义 `providerGroup` 字段，varchar(200)，默认 "default"
- **Providers 表** (lines 148-297): 定义 `groupTag` 字段，varchar(50)，可为空
- **索引**: `providersGroupIdx` (line 292) - 优化分组查询

#### 2. 常量定义
**文件**: `/Users/ding/Github/claude-code-hub/src/lib/constants/provider.constants.ts`
```typescript
export const PROVIDER_GROUP = {
  DEFAULT: "default",
  ALL: "*",
} as const;
```

#### 3. 工具函数
**文件**: `/Users/ding/Github/claude-code-hub/src/lib/utils/provider-group.ts`
- `normalizeProviderGroup(value: unknown): string` - 分组标准化
- `parseProviderGroups(value: string): string[]` - 解析分组字符串

**文件**: `/Users/ding/Github/claude-code-hub/src/lib/utils/color.ts`
- `getGroupColor(group?: string | null): string` - 生成分组颜色

#### 4. 供应商选择器（核心匹配逻辑）
**文件**: `/Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/provider-selector.ts`
```typescript
// lines 47-52: 解析分组字符串
function parseGroupString(groupString: string): string[]

// lines 60-72: 获取有效分组（Key > User > default）
function getEffectiveProviderGroup(session?: ProxySession): string | null

// lines 81-93: 分组匹配核心逻辑
function checkProviderGroupMatch(providerGroupTag: string | null, userGroups: string): boolean
```

#### 5. 用户 Actions
**文件**: `/Users/ding/Github/claude-code-hub/src/actions/users.ts`
- `syncUserProviderGroupFromKeys(userId: number)` (lines 143-167) - 分组同步
- `addUser()` (lines 721-909) - 创建用户时设置分组
- `editUser()` (lines 1079-1216) - 编辑用户分组
- `getAllUserKeyGroups()` (lines 395-424) - 获取所有用户分组

#### 6. 密钥 Actions
**文件**: `/Users/ding/Github/claude-code-hub/src/actions/keys.ts`
- `addKey()` (lines 86-325) - 创建 Key 时的分组验证和同步
- `editKey()` (lines 328-562) - 编辑 Key 分组
- `removeKey()` (lines 565-634) - 删除 Key 时的分组保护
- `batchUpdateKeys()` (lines 846-1046) - 批量更新分组
- `validateNonAdminProviderGroup()` (lines 34-59) - 非管理员分组验证

#### 7. 供应商 Actions
**文件**: `/Users/ding/Github/claude-code-hub/src/actions/providers.ts`
- `getAvailableProviderGroups()` (lines 361-396) - 获取可用分组
- `getProviderGroupsWithCount()` (lines 398-440) - 获取分组及供应商数量
- `checkProviderGroupMatch()` (lines 3515-3525) - 分组匹配检查
- `getDistinctProviderGroups()` (lines 752-776) - 获取所有供应商分组

#### 8. 数据访问层
**文件**: `/Users/ding/Github/claude-code-hub/src/repository/user.ts`
- `getAllUserProviderGroups()` (lines 485-504) - 查询所有用户分组
- `findUserListBatch()` (lines 151-312) - 带分组过滤的用户查询

**文件**: `/Users/ding/Github/claude-code-hub/src/repository/provider.ts`
- `getDistinctProviderGroups()` (lines 752-776) - 获取供应商分组标签

#### 9. 前端组件
**文件**: `/Users/ding/Github/claude-code-hub/src/app/[locale]/dashboard/_components/user/forms/provider-group-select.tsx`
- 分组选择器组件，支持标签输入和下拉建议，显示供应商数量

**文件**: `/Users/ding/Github/claude-code-hub/src/app/[locale]/my-usage/_components/provider-group-info.tsx`
- 显示用户/Key 的分组信息及访问限制

**文件**: `/Users/ding/Github/claude-code-hub/src/app/[locale]/dashboard/_components/user/utils/provider-group.ts`
- 前端分组标准化工具

#### 10. 测试文件
**文件**: `/Users/ding/Github/claude-code-hub/tests/unit/proxy/provider-group-match.test.ts`
- 分组匹配逻辑的单元测试，覆盖全局访问、交集匹配、边界情况等

**文件**: `/Users/ding/Github/claude-code-hub/tests/api/keys-actions.test.ts`
- Key 创建时的分组验证 API 测试

#### 11. i18n 文件
**文件**: `/Users/ding/Github/claude-code-hub/messages/{zh-CN,en,ja,zh-TW,ru}/errors.json`
- 分组相关错误消息：`NO_DEFAULT_GROUP_PERMISSION`, `NO_GROUP_PERMISSION`

**文件**: `/Users/ding/Github/claude-code-hub/messages/{zh-CN,en,ja,zh-TW,ru}/settings/providers/form/errors.json`
- 表单验证错误：`groupTagTooLong`

#### 12. 迁移文件
**文件**: `/Users/ding/Github/claude-code-hub/drizzle/0030_unusual_goliath.sql`
- 初始添加 `keys.provider_group` 字段

**文件**: `/Users/ding/Github/claude-code-hub/drizzle/0039_abnormal_marvel_apes.sql`
- 添加默认值 'default'，迁移 NULL 值

**文件**: `/Users/ding/Github/claude-code-hub/drizzle/0053_watery_madame_hydra.sql`
- 扩展字段长度至 varchar(200)

---

## Document History

- **Round 1**: 初始探索草稿，基于代码库分析
- **Round 2**: 验证并修正，补充了以下内容：
  - 字段长度限制差异说明（50 vs 200）
  - 数据库迁移历史
  - `getProviderGroupsWithCount()` 函数
  - `getGroupColor()` 颜色生成工具
  - 严格分组隔离（Fix #281）说明
  - 编辑 Key 时的分组保护
  - 安全模型 NOTE(#400) 说明
  - 更详细的权限控制点说明
  - 前端组件详细说明
  - i18n 错误消息多语言支持

---

*Document Version: Round 2 Review*
*Verified Against: claude-code-hub codebase (commit: latest)*
*Generated: 2026-01-29*
