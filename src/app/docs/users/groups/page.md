---
title: 用户分组功能
description: 了解 Claude Code Hub 的用户分组功能，实现多租户资源隔离和权限控制，包括分组匹配规则、权限继承和安全模型。
nextjs:
  metadata:
    title: 用户分组功能
    description: Claude Code Hub 用户分组功能文档
---

# 用户分组功能

用户分组（Provider Group）是 Claude Code Hub 实现多租户资源隔离和权限控制的核心机制。通过将供应商划分为不同的逻辑分组，并将用户或 API Key 与特定分组关联，你可以精确控制谁可以访问哪些供应商资源。

{% callout type="note" title="核心概念" %}
分组是字符串标签而非独立实体，无需预先创建，动态使用即可。供应商、用户和 API Key 都可以关联一个或多个分组标签。
{% /callout %}

## 功能概述

用户分组功能帮助你实现以下目标：

| 目标 | 说明 |
|------|------|
| **资源隔离** | 不同分组的用户只能访问其被授权的供应商池 |
| **权限分级** | 通过分组控制用户的 API 访问范围 |
| **成本管控** | 按分组分配不同成本等级的供应商资源 |
| **灵活调度** | 支持基于分组的供应商筛选和负载均衡 |

### 典型应用场景

- **部门隔离**：企业内部不同部门使用不同的供应商预算池（如"研发部"、"市场部"）
- **环境分离**：区分"生产环境"和"测试环境"的供应商资源
- **VIP 服务**：VIP 用户可访问高性能/低延迟的专属供应商组（如"premium"）
- **免费配额**：限制特定用户只能使用免费的供应商端点（如"free"分组）
- **工具专用**：为命令行工具用户分配专用供应商池（如"cli"分组）

## 分组匹配规则

### 特殊分组标识符

系统定义了两个特殊的分组标识符：

| 标识符 | 含义 | 用途 |
|--------|------|------|
| `default` | 默认分组 | 未指定分组时的 fallback，所有无 groupTag 的供应商自动归属此分组 |
| `*` | 全局通配 | 管理员专用，可访问所有分组（包括未标记的供应商） |

### 分组继承优先级

当用户发起 API 请求时，系统按以下优先级确定有效的分组：

```
API Key 的分组 > 用户的分组 > "default"
```

这意味着：

1. 如果 API Key 配置了 `providerGroup`，使用该值
2. 否则，如果用户配置了 `providerGroup`，使用该值
3. 否则，使用 `"default"` 作为 fallback

### 匹配逻辑

系统通过检查用户/Key 的分组与供应商的 `groupTag` 是否存在交集来决定是否允许访问：

```typescript
// 用户/Key 分组为 "premium,chat"
// 供应商 groupTag 为 "premium"
// 存在交集（premium），允许访问

// 用户/Key 分组为 "free"
// 供应商 groupTag 为 "premium"
// 无交集，拒绝访问
```

### 多标签支持

所有分组字段都支持逗号分隔的多个标签：

```
供应商 groupTag: "premium,chat,internal"
用户 providerGroup: "premium,cli"
```

系统会自动 trim 空格并去重。只要用户/Key 的任一分组与供应商的任一分组匹配，即允许访问。

## 数据库 Schema

### Users 表

```typescript
export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  name: varchar('name').notNull(),
  description: text('description'),
  role: varchar('role').default('user'),
  providerGroup: varchar('provider_group', { length: 200 }).default('default'),
  // ... 其他字段
});
```

### Keys 表

```typescript
export const keys = pgTable('keys', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull(),
  key: varchar('key').notNull(),
  name: varchar('name').notNull(),
  providerGroup: varchar('provider_group', { length: 200 }).default('default'),
  // ... 其他字段
});
```

### Providers 表

```typescript
export const providers = pgTable('providers', {
  id: serial('id').primaryKey(),
  name: varchar('name').notNull(),
  groupTag: varchar('group_tag', { length: 50 }),  // 可为 null
  // ... 其他字段
}, (table) => ({
  // 分组查询优化索引
  providersGroupIdx: index('idx_providers_group')
    .on(table.groupTag)
    .where(sql`${table.deletedAt} IS NULL`),
}));
```

{% callout type="note" title="字段长度差异" %}
供应商的 `groupTag` 限制为 50 字符，而用户/Key 的 `providerGroup` 限制为 200 字符。这是因为用户/Key 需要存储多个分组标签的组合。
{% /callout %}

## 用户分组自动同步

系统通过自动同步机制维护用户的 `providerGroup` 字段，确保其与用户拥有的所有 API Key 的分组保持一致。

### 同步触发时机

当管理员执行以下操作时，会自动触发用户分组同步：

- 创建新 Key (`addKey`)
- 编辑 Key 分组 (`editKey`)
- 删除 Key (`removeKey`)
- 批量更新 Key (`batchUpdateKeys`)

### 同步逻辑

```
用户分组 = 该用户所有 Key 的 providerGroup 并集
```

例如，用户有两个 Key：
- Key A 的分组：`"premium"`
- Key B 的分组：`"chat,cli"`

同步后用户的 `providerGroup` 将为：`"chat,cli,premium"`（按字母排序）

{% callout type="note" title="设计意图" %}
非管理员用户无法直接修改自己的 `providerGroup`，只能通过创建/删除 Key 间接影响。这确保了权限控制的安全性。

注意：分组同步仅在管理员操作用户的 Key 时触发。非管理员用户自行创建 Key 不会触发同步。
{% /callout %}

## 权限控制

### 非管理员用户的分组限制

普通用户在创建 API Key 时，只能使用自己当前已有分组的子集：

1. **创建 Key 时的验证**：请求的分组必须是用户现有分组的子集
2. **default 分组保护**：创建 default 分组的 Key 需要已有 default 分组的 Key
3. **编辑限制**：普通用户无法修改已有 Key 的 `providerGroup`
4. **删除保护**：不能删除最后一个某分组的 Key（防止失去该分组访问权限）

### 管理员权限

管理员（`role = "admin"`）拥有完全的分组控制权：

- 可以为用户/Key 设置任意分组
- 可以使用 `"*"` 通配符访问所有供应商
- 可以直接修改用户的 `providerGroup`

## 工作流程

### 1. 配置供应商分组

在创建或编辑供应商时，设置 `groupTag` 字段：

```
供应商名称: Claude Premium
Group Tag: premium
```

或配置多个分组：

```
Group Tag: premium,chat,internal
```

### 2. 创建带分组的 API Key

管理员在为用户创建 API Key 时指定分组：

```
Key 名称: 生产环境 Key
Provider Group: premium
```

创建后，用户的 `providerGroup` 会自动同步为该 Key 的分组。

### 3. 使用 Key 发起请求

当用户使用该 Key 发起请求时：

```bash
curl -H "Authorization: Bearer YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"claude-3-5-sonnet","messages":[{"role":"user","content":"hi"}]}' \
  http://localhost:23000/v1/chat/completions
```

系统会：
1. 验证 Key 的分组为 `"premium"`
2. 筛选出 `groupTag` 包含 `"premium"` 的供应商
3. 从这些供应商中选择最优的一个处理请求

### 4. 分组不匹配时的响应

如果用户的分组没有匹配的供应商，请求会被拒绝：

```json
{
  "error": {
    "message": "No available providers",
    "type": "no_available_providers",
    "code": "no_available_providers"
  }
}
```

## 工具函数

### 分组标准化

```typescript
import { normalizeProviderGroup, parseProviderGroups } 
  from "@/lib/utils/provider-group";

// 标准化分组值
normalizeProviderGroup(" premium , chat , premium ");
// 返回: "chat,premium"（去重、排序、trim）

// 解析分组字符串为数组
parseProviderGroups("premium,chat");
// 返回: ["premium", "chat"]
```

### 分组颜色生成

```typescript
import { getGroupColor } from "@/lib/utils/color";

getGroupColor("premium");
// 返回: "hsl(123, 65%, 40%)"（稳定的 HSL 颜色值）
```

系统使用此函数为不同分组生成一致的 UI 颜色。

## 边界情况处理

### 供应商无分组标签

当供应商未设置 `groupTag` 时，系统会将其视为属于 `"default"` 分组。匹配时，系统会检查用户/Key 的分组与供应商的分组（包括默认的 `"default"`）是否存在交集。

例如：
- 用户分组为 `"premium"`，供应商无 `groupTag`（视为 `"default"`）→ 无交集，拒绝访问
- 用户分组为 `"default,premium"`，供应商无 `groupTag` → 有交集（default），允许访问

### 用户/Key 无分组

当用户或 Key 的 `providerGroup` 为 null、undefined 或空字符串时，系统使用 `"default"` 作为 fallback。

### 严格分组隔离

为确保安全，当用户/Key 配置了特定分组（且不包括 `"default"`）时，无 `groupTag` 的供应商会被拒绝访问：

```typescript
// 用户分组为 "premium"
// 供应商无 groupTag（视为 "default"）
// 结果：拒绝访问（无交集）
```

这防止了无分组供应商被"意外"分配给仅有特定分组权限的用户。

## 前端组件

### 分组选择器

系统在 Key 创建/编辑表单中提供分组选择器组件：

- 显示所有可用的分组标签
- 显示每个分组对应的供应商数量
- 支持输入自定义分组（管理员）
- 自动 trim 空格并去重

### 分组信息展示

在"我的使用"页面，用户可以查看：

- 当前 Key 的分组（或继承自用户的分组）
- 用户级别的所有分组
- 允许的模型和客户端列表

## 最佳实践

### 1. 规划分组策略

在开始使用前，规划清晰的分组策略：

```
premium    - 高性能供应商，用于生产环境
standard   - 标准供应商，用于日常开发
trial      - 试用/测试供应商，成本敏感
internal   - 内部工具专用
cli        - 命令行工具专用
```

### 2. 为供应商显式配置分组

始终为供应商显式配置 `groupTag`，避免使用默认的 null 值：

```
生产供应商 -> groupTag: "premium"
测试供应商 -> groupTag: "trial"
```

### 3. 使用描述性的分组名称

选择清晰、描述性的分组名称，便于团队成员理解：

```
好的: "production-us", "development", "team-alpha"
避免: "group1", "test", "tmp"
```

### 4. 定期审查分组配置

- 检查是否有未配置分组的供应商
- 确认用户的分组与其职责匹配
- 清理不再使用的分组标签

### 5. 为新用户设置默认分组

创建新用户时，通过创建带有适当分组的第一个 Key 来设置其默认分组访问权限。

## 错误代码

当分组权限验证失败时，系统会返回以下错误代码：

| 错误代码 | 中文消息 | 英文消息 | 触发条件 |
|----------|----------|----------|----------|
| `NO_DEFAULT_GROUP_PERMISSION` | 无权使用 default 分组，您当前没有 default 分组的 Key | No permission to use default group. You don't have a Key with default group | 非管理员用户尝试创建 default 分组的 Key，但当前没有 default 分组的 Key |
| `NO_GROUP_PERMISSION` | 无权使用以下分组: {groups} | No permission to use the following groups: {groups} | 非管理员用户尝试使用自己没有权限的分组 |

### 表单验证错误

在供应商配置表单中，如果 `groupTag` 超过长度限制，会显示：

```
分组标签总长度不能超过 50 个字符
```

## 故障排查

### 用户无法访问特定供应商

1. 检查用户的 `providerGroup` 字段
2. 检查用户使用的 Key 的 `providerGroup` 字段
3. 检查目标供应商的 `groupTag` 字段
4. 确认是否存在交集

### 分组同步未生效

1. 检查用户是否有 Key
2. 查看日志中的 `[UserAction] Synced user provider group` 记录
3. 确认操作是否触发了同步（创建/编辑/删除 Key）

### 创建 Key 时提示无权限

非管理员用户创建 Key 时，只能使用自己已有分组的子集。如果需要新分组，请联系管理员。

## 相关文档

- [API Key 管理](/docs/users/api-keys) - 了解 Key 的创建和管理
- [用户 CRUD 操作](/docs/users/crud) - 了解用户管理
- [权限控制系统](/docs/users/permissions) - 了解完整的权限体系
- [智能路由算法](/docs/proxy/intelligent-routing) - 了解供应商选择机制
- [访问限制](/docs/users/access-restrictions) - 了解模型和客户端限制
