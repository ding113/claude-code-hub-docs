---
title: 用户标签
description: 使用用户标签对 Claude Code Hub 用户进行分类管理、批量筛选和灵活组织。
---

# 用户标签

用户标签是 Claude Code Hub 中用于用户分类管理和批量筛选的核心功能。你可以为每个用户分配多个标签，实现灵活的用户组织和快速定位。

{% callout type="note" title="功能概述" %}
- 自由标签模式：无需预定义，随时创建任意标签
- 多标签支持：每个用户最多可拥有 20 个标签
- 批量筛选：支持多标签 OR 逻辑筛选
- 排行榜集成：可按标签筛选排行榜数据
{% /callout %}

## 使用场景

### 按部门或团队分类

为用户标记所属部门，便于按团队查看使用情况：

- `engineering` - 工程团队
- `product` - 产品团队
- `design` - 设计团队
- `marketing` - 市场团队

### 按客户等级分类

区分不同等级的客户，实施差异化管理：

- `vip` - VIP 客户
- `enterprise` - 企业客户
- `trial` - 试用客户
- `standard` - 标准客户

### 按使用场景分类

标记用户的主要使用方式：

- `api-only` - 仅通过 API 使用
- `web-ui` - 主要使用 Web 界面
- `cli` - 使用命令行工具
- `integration` - 系统集成用户

## 标签格式规范

创建标签时需要遵循以下规则：

| 限制项 | 值 | 说明 |
|-------|-----|------|
| 最大长度 | 32 字符 | 单个标签不能超过 32 个字符 |
| 最大数量 | 20 个 | 每个用户最多拥有 20 个标签 |
| 允许字符 | 字母、数字、下划线、连字符 | 正则表达式：`/^[a-zA-Z0-9_-]+$/` |
| 重复标签 | 不允许 | 同一用户不能有重复标签 |

{% callout type="warning" title="标签格式限制" %}
标签只能包含字母、数字、下划线（`_`）和连字符（`-`）。空格和其他特殊字符不被允许。
{% /callout %}

## 管理用户标签

### 创建用户时添加标签

在创建用户对话框中，你可以通过标签输入字段为用户添加标签：

1. 进入**用户管理**页面
2. 点击**添加用户**按钮
3. 在表单中找到**标签**字段
4. 输入标签名称并按回车添加
5. 完成其他字段填写后保存

### 编辑用户标签

你可以随时修改用户的标签：

1. 在用户列表中找到目标用户
2. 点击用户行或**编辑**按钮
3. 在编辑对话框中修改标签字段
4. 点击**保存**完成修改

### 批量编辑标签

当需要为多个用户添加或修改相同标签时，使用批量编辑功能：

1. 在用户列表中勾选多个用户
2. 点击工具栏中的**批量编辑**按钮
3. 在批量编辑对话框中启用**标签**字段
4. 输入新的标签列表
5. 点击**应用**完成批量更新

{% callout type="note" title="批量编辑行为" %}
批量编辑会**覆盖**用户原有的标签，而不是合并。如果你需要保留原有标签，请确保在批量编辑时包含所有需要的标签。
{% /callout %}

## 标签输入组件

标签输入组件提供了丰富的交互功能，帮助你高效管理标签。

### 基本操作

- **添加标签**：输入标签名称后按回车
- **删除标签**：点击标签上的 X 按钮
- **键盘导航**：使用上下箭头在建议列表中移动
- **批量粘贴**：支持粘贴逗号、中文逗号或换行符分隔的标签列表

### 自动完成

当你开始输入时，系统会显示已存在的标签建议：

- 建议列表来自系统中所有用户的标签
- 仅管理员可以看到所有标签建议
- 点击建议项或按回车即可快速选择

### 验证提示

输入无效标签时，系统会显示相应的错误提示：

| 错误类型 | 提示信息 | 触发条件 |
|---------|---------|---------|
| 空标签 | 标签不能为空 | 输入为空字符串 |
| 重复标签 | 标签已存在 | 添加已存在的标签 |
| 长度超限 | 标签长度不能超过 32 个字符 | 超过 32 字符 |
| 格式错误 | 标签格式不正确 | 包含非法字符 |
| 数量超限 | 标签数量不能超过 20 个 | 超过 20 个标签 |

## 标签筛选

标签的核心价值在于筛选功能。你可以在多个页面使用标签筛选用户。

### 用户列表筛选

在用户管理页面，你可以通过标签筛选快速找到目标用户：

1. 在工具栏找到**标签筛选**输入框
2. 输入或选择要筛选的标签
3. 支持同时选择多个标签（OR 逻辑）
4. 筛选结果会实时更新

**筛选逻辑**：

- 选择多个标签时，返回包含**任意**选中标签的用户
- 标签筛选与密钥分组筛选是**AND**关系
- 标签筛选与搜索词、状态筛选叠加使用

### 排行榜标签筛选

管理员可以在排行榜中按标签筛选用户数据：

1. 进入**排行榜**页面
2. 选择**用户排行**维度
3. 在筛选区域输入用户标签
4. 排行榜会显示符合条件的用户排名

{% callout type="note" title="筛选逻辑差异" %}
用户列表页面中，标签筛选与分组筛选是 AND 关系；排行榜页面中，标签筛选与分组筛选是 OR 关系。这是因为两个页面的使用场景不同。
{% /callout %}

## 技术实现

### 数据存储

用户标签使用 PostgreSQL 的 JSONB 类型存储：

```typescript
// 数据库 Schema 定义
export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  name: varchar('name').notNull(),
  // ... 其他字段
  tags: jsonb('tags').$type<string[]>().default([]),
  // ... 其他字段
});
```

**设计决策**：

- 使用 `jsonb` 类型支持灵活的标签操作
- 默认值为空数组 `[]`，避免 null 处理
- 没有单独的 tags 表，简化数据模型

### 标签筛选实现

用户列表页面使用 `@>` 操作符进行包含检查：

```typescript
// 多标签 OR 逻辑筛选
const tagConditions = normalizedTags.map(
  (tag) => sql`${users.tags} @> ${JSON.stringify([tag])}::jsonb`
);
const tagFilterCondition = sql`(${sql.join(tagConditions, sql` OR `)})`;
```

排行榜使用 `?` 操作符检查元素存在：

```typescript
// 检查 JSONB 数组中是否包含指定标签
const tagConditions = normalizedTags.map(
  (tag) => sql`${users.tags} ? ${tag}`
);
```

### 搜索集成

搜索用户时，系统也会匹配标签：

```typescript
// 搜索词匹配标签
OR EXISTS (
  SELECT 1
  FROM jsonb_array_elements_text(coalesce(${users.tags}, '[]'::jsonb)) AS tag
  WHERE tag ILIKE ${pattern}
)
```

这意味着你在用户列表的搜索框中输入标签名称，也能找到对应的用户。

## API 参考

### Server Actions

#### 获取所有用户标签

```typescript
import { getAllUserTags } from "@/actions/users";

const result = await getAllUserTags();
if (result.ok) {
  console.log(result.data); // string[]
}
```

**权限**：仅管理员可用。

#### 批量获取用户（支持标签筛选）

```typescript
import { getUsersBatch } from "@/actions/users";

const result = await getUsersBatch({
  limit: 50,
  tagFilters: ["vip", "enterprise"], // OR 逻辑
  keyGroupFilters: ["default"],
  statusFilter: "active",
});
```

#### 批量更新用户标签

```typescript
import { batchUpdateUsers } from "@/actions/users";

const result = await batchUpdateUsers({
  userIds: [1, 2, 3],
  updates: {
    tags: ["vip", "priority"], // 会覆盖原有标签
  },
});
```

### REST API

排行榜 API 支持通过 URL 参数进行标签筛选：

```bash
# 按标签筛选用户排行
GET /api/leaderboard?period=daily&scope=user&userTags=vip,enterprise

# 多参数组合
GET /api/leaderboard?period=weekly&scope=user&userTags=premium&userGroups=default
```

**参数说明**：

| 参数 | 类型 | 必填 | 说明 |
|-----|------|-----|------|
| period | string | 是 | 时间周期：daily、weekly、monthly、allTime、custom |
| scope | string | 是 | 排行榜维度：user、provider、providerCacheHitRate、model |
| userTags | string | 否 | 用户标签筛选，逗号分隔多个标签 |
| userGroups | string | 否 | 用户组筛选，逗号分隔多个组 |

## 最佳实践

### 标签命名规范

为了保持标签的一致性和可维护性，建议遵循以下命名规范：

1. **使用小写字母**：`engineering` 而不是 `Engineering`
2. **使用连字符分隔**：`api-only` 而不是 `api_only`
3. **保持简洁**：标签应该简短且含义明确
4. **避免特殊字符**：只使用字母、数字、下划线和连字符

### 标签策略建议

**按组织架构**：

```
team-frontend
team-backend
team-product
team-design
```

**按客户等级**：

```
tier-vip
tier-enterprise
tier-standard
tier-trial
```

**按使用场景**：

```
usage-api
usage-web
usage-cli
usage-integration
```

### 定期清理

- 标签没有独立的生命周期，随用户创建而创建
- 当最后一个使用某标签的用户被删除，该标签自然消失
- 定期审查标签使用情况，合并相似标签
- 建立标签使用规范，避免标签泛滥

## 限制与注意事项

1. **无标签层级**：不支持父子标签关系，所有标签都是扁平的
2. **无反向筛选**：无法直接筛选"无标签"的用户
3. **标签不控制权限**：标签仅用于分类和筛选，不控制访问权限
4. **并发编辑**：并发编辑同一用户时，后提交者覆盖前者
5. **性能考虑**：大量标签可能影响 `getAllUserTags` 查询性能

## 故障排查

### 标签无法保存

- 检查标签长度是否超过 32 字符
- 确认标签不包含非法字符
- 验证用户标签数量未超过 20 个

### 筛选无结果

- 确认标签名称拼写正确
- 检查筛选逻辑（OR 而非 AND）
- 验证用户确实拥有该标签

### 标签建议不显示

- 确认你是管理员身份
- 检查是否有其他用户已创建标签
- 刷新页面重新加载标签列表

## 相关功能

- [用户 CRUD 操作](/docs/users/crud) - 创建和管理用户
- [批量操作](/docs/users/batch-operations) - 批量编辑用户属性
- [排行榜](/docs/monitoring/leaderboard) - 按标签查看使用排行
- [用户组](/docs/users/groups) - 另一种用户分类方式
