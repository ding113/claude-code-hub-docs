---
dimensions:
  type:
    primary: reference
    detail: guide
  level: intermediate
standard_title: API Key 管理
language: zh
---

# API Key 管理

API Key 是 Claude Code Hub 的核心认证机制，是用户访问 Claude API 代理服务的主要凭证。
系统支持多 Key 管理、细粒度权限控制和多维度的使用限额，为团队提供安全、灵活的
访问控制能力。

## 核心概念

### API Key 的作用

API Key 在 Claude Code Hub 中承担以下关键职责：

- **身份认证**：验证请求者身份，确定所属用户和权限范围
- **权限控制**：通过供应商分组限制可访问的供应商资源
- **使用限额**：为不同 Key 设置独立的消费限额，实现精细化成本控制
- **访问控制**：控制是否允许登录 Web UI 管理后台，区分 API 和 UI 访问权限
- **用量追踪**：按 Key 统计使用量，支持成本分摊和审计

### Key 格式与安全性

系统生成的 API Key 遵循标准格式：

```
sk-{32 位十六进制字符}
```

例如：`sk-a1b2c3d4e5f678901234567890123456`

Key 使用 Node.js `crypto.randomBytes(16)` 生成，提供 128 位熵，约有
3.4 × 10³⁸ 种可能组合，足以抵御暴力破解攻击。Key 以明文形式存储在数据库中
（非哈希），以支持直接的 Key 字符串查找认证。

{% callout type="note" title="存储说明" %}
API Key 在数据库中以明文存储，这是为了支持高效的 Key 查找认证。请确保数据库
访问安全，并定期审计 Key 使用情况。
{% /callout %}

### 认证方式概览

系统支持多种认证方式，按以下优先级依次检查：

1. **Authorization Header**：`Authorization: Bearer <api_key>`
2. **X-API-Key Header**：`x-api-key: <api_key>`
3. **Gemini 协议**：`x-goog-api-key` header 或 `?key=` 查询参数
4. **Cookie 认证**：`auth-token` Cookie（用于 Web UI）

当多个认证方式同时提供时，系统会检测冲突。如果提供了多个不同的 API Key，
请求会被拒绝并返回 401 错误。

### 验证流程

当请求到达代理服务时，系统执行以下验证步骤：

1. **提取 Key**：从请求头或 Cookie 中提取 API Key
2. **查找 Key**：在数据库中查找匹配的 Key 记录
3. **状态检查**：验证 Key 是否启用、未过期、未删除
4. **用户检查**：验证关联用户是否存在且启用
5. **权限检查**：验证 Key 是否有权执行请求的操作

只有通过所有验证步骤，请求才会被放行到后续处理流程。

## 创建 API Key

### 基本流程

创建 API Key 的步骤如下：

1. 登录管理后台，进入 **用户管理** 页面
2. 选择目标用户，点击 **管理 Key** 按钮
3. 点击 **添加 Key**，填写配置信息
4. 保存后系统生成 Key，**仅显示一次**，请务必复制保存

{% callout type="warning" title="重要提示" %}
创建 Key 时生成的密钥字符串**仅显示一次**，页面关闭后将无法再次查看。
如果丢失 Key，只能删除后重新创建。建议创建后立即复制到安全的位置保存。
{% /callout %}

### 配置选项详解

| 配置项 | 说明 | 默认值 |
|--------|------|--------|
| **名称** | Key 的标识名称，同一用户下不可重复 | 必填 |
| **有效期** | Key 的过期时间，留空表示永不过期 | 无 |
| **允许登录 Web UI** | 是否可用此 Key 登录管理后台 | false |
| **供应商分组** | 可访问的供应商分组，多个用逗号分隔 | default |
| **5 小时限额** | 过去 5 小时滚动窗口的消费上限（USD） | 无限制 |
| **日限额** | 每日消费上限（USD） | 无限制 |
| **日重置模式** | 固定时间 / 滚动 24 小时 | 固定 |
| **日重置时间** | 固定模式下的重置时间点（如 00:00） | 00:00 |
| **周限额** | 自然周（周一 00:00 开始）消费上限 | 无限制 |
| **月限额** | 自然月（1 日 00:00 开始）消费上限 | 无限制 |
| **总限额** | 终身累计消费上限 | 无限制 |
| **并发会话数** | 同时进行的会话数量上限 | 0（无限制） |
| **缓存 TTL 偏好** | 强制覆盖缓存时间（inherit/5m/1h） | inherit |

### 供应商分组配置

供应商分组决定 Key 可以访问哪些供应商资源：

- **default**：默认分组，访问未指定分组的供应商
- **自定义分组**：如 `premium`、`team-a` 等，访问对应分组的供应商
- **多个分组**：用逗号分隔，如 `group1,group2,default`

{% callout type="note" title="权限继承" %}
非管理员用户只能为自己创建其已有权限范围内的供应商分组。系统会验证用户是否
拥有所请求分组的访问权限。管理员可以为任何用户分配任何分组。
{% /callout %}

### 创建时的验证规则

创建 Key 时，系统会执行以下验证：

1. **权限检查**：用户只能为自己创建 Key；管理员可以为任何用户创建
2. **供应商分组安全**：非管理员用户只能分配其已有权限的分组
3. **名称唯一性**：同一用户下不能有两个同名且有效的 Key
4. **限额约束**：Key 级别的限额不能超过用户级别的限额

如果验证失败，创建操作会被拒绝并返回相应的错误信息。

## 使用 API Key

### Authorization Header（推荐）

最常用的认证方式，符合 OpenAI API 标准：

```bash
curl -H "Authorization: Bearer sk-your-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-3-5-sonnet",
    "messages": [{"role": "user", "content": "Hello"}]
  }' \
  http://localhost:23000/v1/chat/completions
```

### X-API-Key Header

替代认证方式，某些客户端可能更易配置：

```bash
curl -H "x-api-key: sk-your-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-3-5-sonnet",
    "messages": [{"role": "user", "content": "Hello"}]
  }' \
  http://localhost:23000/v1/chat/completions
```

### Gemini 协议兼容

为兼容 Google Gemini API 客户端：

```bash
# Header 方式
curl -H "x-goog-api-key: sk-your-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-3-5-sonnet",
    "messages": [{"role": "user", "content": "Hello"}]
  }' \
  http://localhost:23000/v1/chat/completions

# Query 参数方式
curl "http://localhost:23000/v1/chat/completions?key=sk-your-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-3-5-sonnet",
    "messages": [{"role": "user", "content": "Hello"}]
  }'
```

### Web UI Cookie 认证

登录管理后台时，系统会设置 `auth-token` Cookie：

```typescript
// Cookie 配置
name: "auth-token"
httpOnly: true
secure: 取决于 ENABLE_SECURE_COOKIES 环境变量
sameSite: "lax"
maxAge: 7 天
path: "/"
```

Cookie 认证主要用于 Web UI 的页面访问，API 请求建议使用 Header 认证。

### 登录权限控制

`canLoginWebUi` 字段控制 Key 的登录权限：

- **true**：可用此 Key 登录 Web UI，进入管理后台
- **false**：仅用于 API 调用，登录后会被重定向到只读的 **我的用量** 页面

```typescript
// 登录后跳转逻辑
if (user.role === "admin") {
  return "/dashboard";
}
if (key.canLoginWebUi) {
  return "/dashboard";
}
return "/my-usage";  // 只读页面
```

这种设计允许创建仅用于 API 访问的服务账号 Key，减少安全风险。

## Key 生命周期管理

### 启用与禁用

Key 可以随时启用或禁用：

- **禁用**：Key 立即失效，所有使用该 Key 的请求会被拒绝，返回 401 错误
- **启用**：Key 恢复可用状态

{% callout type="warning" title="最后 Key 保护" %}
系统禁止禁用用户的最后一个可用 Key，防止用户被完全锁定无法访问系统。
如果尝试禁用最后一个 Key，操作会被拒绝并提示错误信息。
{% /callout %}

### 续期

对于设置了有效期的 Key，可以通过续期功能延长使用时间：

1. 在 Key 列表中找到目标 Key
2. 点击 **续期** 按钮
3. 选择新的过期时间
4. 可选择同时启用 Key（如果当前是禁用状态）

续期操作不会影响 Key 的其他配置，包括限额设置和供应商分组。

### 编辑 Key

Key 的配置可以随时修改，但需要注意以下事项：

- **有效期字段**：仅在显式提供时才会更新，防止意外清除
- **供应商分组**：修改后会自动同步用户的有效分组集合
- **限额设置**：不能超过用户级别的限额

非管理员用户不能修改供应商分组（管理员专属字段）。

### 删除（软删除）

Key 采用软删除机制：

- 删除后 Key 立即失效，无法用于认证
- 数据库中保留记录（标记 `deletedAt` 时间戳）
- 不可恢复，需要重新创建新的 Key

{% callout type="warning" title="删除限制" %}
删除 Key 时，系统会执行以下检查：
1. 不能删除用户的最后一个可用 Key（防止锁定）
2. 非管理员用户删除后不能导致自己失去所有供应商分组访问权限
{% /callout %}

## 使用限额详解

### 限额类型说明

| 限额类型 | 时间窗口 | 重置行为 | 适用场景 |
|----------|----------|----------|----------|
| **5 小时限额** | 过去 5 小时滚动窗口 | 持续滚动 | 短期爆发控制，防止突发高消费 |
| **日限额** | 24 小时 | 固定时间或滚动 | 日常预算控制 |
| **周限额** | 自然周 | 周一 00:00 | 周度预算规划 |
| **月限额** | 自然月 | 每月 1 日 00:00 | 月度预算控制 |
| **总限额** | 终身累计 | 永不重置 | 硬上限控制，防止超支 |
| **并发会话** | 实时 | 会话结束 | 资源保护，防止独占 |

### 日限额重置模式

**固定时间模式（Fixed）**

- 在配置的每日重置时间点重置计数
- 例如：设置重置时间为 `18:00`，则每天 18:00 重置当日计数
- 适合有固定结算时间点的业务场景

**滚动窗口模式（Rolling）**

- 统计过去 24 小时的累计消费
- 无固定重置时间点，平滑计算
- 适合需要连续流量控制的场景

配置示例：

```
日限额: $50.00
日重置模式: 固定
日重置时间: 00:00
```

### 限额检查顺序

系统在代理请求时按以下顺序检查限额（`rate-limit-guard.ts`）：

```
Layer 1 - 永久硬限制（最先检查）
  1. Key 总消费限额
  2. User 总消费限额

Layer 2 - 资源/频率保护
  3. Key 并发会话数
  4. User 并发会话数
  5. User RPM 限制

Layer 3 - 短期周期限制
  6. Key 5 小时限额
  7. User 5 小时限额
  8. Key 日限额
  9. User 日限额

Layer 4 - 中长期周期限制
  10. Key 周限额
  11. User 周限额
  12. Key 月限额
  13. User 月限额
```

{% callout type="note" title="设计原则" %}
- 硬限制优先于周期限制，确保成本绝对可控
- 同一窗口内，Key 限制先于 User 限制检查
- 资源保护类限制位置靠前，及时拦截异常流量
{% /callout %}

### 限额继承关系

Key 级别的限额不能超过 User 级别的限额：

```
如果 User 日限额 = $100
则 Key 日限额 ≤ $100
```

创建或编辑 Key 时，系统会自动验证限额关系。如果 Key 限额超出用户限额，
操作会被拒绝并返回错误提示。

### 租赁机制（Lease）

为了提升高并发场景下的性能，系统采用 Lease（租赁）机制减少数据库查询：

1. **获取租赁**：从数据库批量获取一段配额（如总限额的 5%）
2. **本地扣减**：请求消费从租赁配额中扣减，无需访问数据库
3. **租赁刷新**：租赁耗尽或过期时，重新从数据库获取
4. **原子操作**：使用 Redis Lua 脚本确保扣减的原子性

这种机制可能导致用量显示有短暂延迟（默认 10 秒刷新间隔）。

## 批量操作

管理员可以对多个 Key 执行批量更新，提高管理效率。

### 支持的批量操作

- 修改供应商分组
- 修改各类限额（5h/日/周/月/总）
- 修改 Web UI 登录权限
- 启用/禁用 Key

### 批量操作限制

- 单次最多操作 500 个 Key
- 批量禁用时会验证每个用户至少保留一个可用 Key
- 操作在数据库事务中执行，确保原子性
- 操作前后都有验证，防止竞态条件

### 使用场景

1. **统一调整限额**：为某个团队的所有 Key 增加日限额
2. **分组迁移**：将一批 Key 从旧分组迁移到新分组
3. **权限回收**：批量禁用某批用户的 Web UI 登录权限
4. **过期处理**：批量续期即将过期的 Key

### 批量操作 API

```typescript
interface BatchUpdateKeysParams {
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

## 统计与监控

### Key 级别统计

每个 Key 都有独立的用量统计，包括：

- **今日消费**：当日累计消费金额（USD）
- **今日 Token**：当日消耗的 Token 数量
- **总消费**：历史累计消费金额
- **请求次数**：累计请求数量
- **模型分布**：各模型的使用占比和成本

### 查看用量

1. 进入 **用户管理** 页面
2. 点击 **管理 Key** 查看 Key 列表
3. 列表中显示各 Key 的今日消费和总消费
4. 点击 Key 名称可查看详细用量统计

### 限额使用率

系统会计算并显示各限额的使用百分比：

```
日限额: $50.00 / $100.00 (50%)
周限额: $180.00 / $500.00 (36%)
月限额: $450.00 / $1000.00 (45%)
```

当使用率达到阈值时，建议及时调整限额或续期 Key。

### 限额使用详情

通过 `getKeyLimitUsage` 接口可以获取 Key 的详细限额使用情况：

- 各时间窗口的当前用量
- 限额总量和剩余量
- 重置时间（对于固定重置模式）

## 安全最佳实践

### 1. 最小权限原则

- 为不同用途创建独立的 Key（开发、测试、生产）
- 只分配必要的供应商分组权限
- 按需设置使用限额，避免过度授权

### 2. 定期轮换

- 为 Key 设置合理的有效期（如 90 天）
- 定期续期或重新创建 Key
- 及时删除不再使用的 Key

### 3. 分离 API 和 UI 权限

- 服务账号使用的 Key 建议关闭 Web UI 登录权限（`canLoginWebUi: false`）
- 个人使用的 Key 可以开启 Web UI 登录
- 管理员账号使用独立的 Key

### 4. 监控异常用量

- 定期查看 Key 的用量统计
- 设置合理的限额作为安全网
- 发现异常用量时立即禁用 Key 并调查原因

### 5. 安全存储

- 不要将 Key 硬编码在代码中
- 使用环境变量或密钥管理服务存储 Key
- 避免在日志中输出完整的 Key 字符串

## 故障排查

### Key 认证失败

**现象**：请求返回 401 认证错误

**排查步骤**：

1. 检查 Key 字符串是否正确（包含 `sk-` 前缀，共 34 字符）
2. 确认 Key 未被禁用或删除
3. 检查 Key 是否已过期（查看 `expiresAt`）
4. 验证请求头格式：`Authorization: Bearer sk-xxx`
5. 检查是否提供了多个冲突的 Key

### 限额误触发

**现象**：请求被限流，但用量显示未超限

**可能原因**：

1. 其他并发请求同时消耗配额
2. 租赁机制（Lease）的批量扣减导致显示延迟
3. 时区问题导致日限额计算偏差

**解决方法**：

1. 检查 Redis 中的实时用量数据
2. 等待租赁刷新（默认 10 秒间隔）
3. 确认系统时区配置正确（`TZ` 环境变量）

### 无法创建 Key

**现象**：创建 Key 时提示错误

**常见原因**：

1. **名称重复**：同一用户下已存在同名 Key
2. **限额超限**：设置的限额超过用户级别限额
3. **分组权限不足**：非管理员用户尝试分配无权限的分组
4. **权限不足**：尝试为其他用户创建 Key（非管理员）

### Web UI 登录失败

**现象**：使用 Key 登录后跳转到了只读的 **我的用量** 页面

**原因**：Key 的 `canLoginWebUi` 字段为 false

**解决**：使用具有 Web UI 登录权限的 Key，或联系管理员修改 Key 配置。

### 供应商访问被拒绝

**现象**：请求返回 403 错误，提示无权限访问供应商

**原因**：Key 的供应商分组不包含目标供应商

**解决**：
1. 检查 Key 的供应商分组配置
2. 确认目标供应商所属的分组
3. 修改 Key 的分组配置或联系管理员

## 边缘情况处理

### 1. 最后 Key 保护

系统防止用户被锁定：

- 不能禁用用户的最后一个可用 Key
- 不能删除用户的最后一个可用 Key
- 批量禁用时会验证每个用户至少保留一个可用 Key

### 2. 供应商分组空保护

非管理员用户删除 Key 时，系统会检查：

- 删除后用户是否还有任何供应商分组访问权限
- 如果会导致用户失去所有分组访问权限，删除操作会被拒绝

### 3. 过期时间处理

- 过期时间使用系统时区解析
- 过期 Key 会自动失效，无法用于认证
- 可以通过续期功能延长过期时间

### 4. 并发操作安全

批量操作使用数据库事务：

- 操作前验证所有 Key 存在且未删除
- 操作在事务中执行，确保原子性
- 操作后验证约束条件（如最后 Key 保护）

### 5. 管理员 Token 特殊处理

系统支持通过环境变量配置管理员 Token：

```bash
ADMIN_TOKEN=your-admin-token
```

管理员 Token 绕过正常的 Key 验证流程，直接获得管理员权限。这用于系统初始化
或紧急访问场景。

{% callout type="warning" title="安全提醒" %}
管理员 Token 拥有最高权限，请妥善保管。建议仅在必要时使用，并定期更换。
{% /callout %}

## 数据库 Schema

Key 的数据存储在 `keys` 表中：

```typescript
export const keys = pgTable('keys', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull(),
  key: varchar('key').notNull(),
  name: varchar('name').notNull(),
  isEnabled: boolean('is_enabled').default(true),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  
  // Web UI 登录权限
  canLoginWebUi: boolean('can_login_web_ui').default(false),
  
  // 配额限制
  limit5hUsd: numeric('limit_5h_usd', { precision: 10, scale: 2 }),
  limitDailyUsd: numeric('limit_daily_usd', { precision: 10, scale: 2 }),
  dailyResetMode: dailyResetModeEnum('daily_reset_mode').default('fixed').notNull(),
  dailyResetTime: varchar('daily_reset_time', { length: 5 }).default('00:00').notNull(),
  limitWeeklyUsd: numeric('limit_weekly_usd', { precision: 10, scale: 2 }),
  limitMonthlyUsd: numeric('limit_monthly_usd', { precision: 10, scale: 2 }),
  limitTotalUsd: numeric('limit_total_usd', { precision: 10, scale: 2 }),
  limitConcurrentSessions: integer('limit_concurrent_sessions').default(0),
  
  // 供应商分组和缓存偏好
  providerGroup: varchar('provider_group', { length: 200 }).default('default'),
  cacheTtlPreference: varchar('cache_ttl_preference', { length: 10 }),
  
  // 时间戳
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});
```

### 索引设计

```typescript
(table) => ({
  keysUserIdIdx: index('idx_keys_user_id').on(table.userId),
  keysCreatedAtIdx: index('idx_keys_created_at').on(table.createdAt),
  keysDeletedAtIdx: index('idx_keys_deleted_at').on(table.deletedAt),
})
```

索引设计支持以下查询场景：
- `idx_keys_user_id`：按用户 ID 查询 Key 列表
- `idx_keys_created_at`：按创建时间排序
- `idx_keys_deleted_at`：过滤已删除的 Key

## 验证 Schema

Key 表单使用 Zod 进行验证：

```typescript
export const KeyFormSchema = z.object({
  name: z.string()
    .min(1, "密钥名称不能为空")
    .max(64, "密钥名称不能超过64个字符"),
  expiresAt: z.string()
    .optional()
    .default("")
    .transform((val) => (val === "" ? undefined : val)),
  canLoginWebUi: z.boolean()
    .optional()
    .default(true),
  limit5hUsd: z.coerce.number()
    .min(0)
    .max(10000)
    .nullable()
    .optional(),
  limitDailyUsd: z.coerce.number()
    .min(0)
    .max(10000)
    .nullable()
    .optional(),
  dailyResetMode: z.enum(["fixed", "rolling"])
    .optional()
    .default("fixed"),
  dailyResetTime: z.string()
    .regex(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/)
    .optional()
    .default("00:00"),
  limitWeeklyUsd: z.coerce.number()
    .min(0)
    .max(50000)
    .nullable()
    .optional(),
  limitMonthlyUsd: z.coerce.number()
    .min(0)
    .max(200000)
    .nullable()
    .optional(),
  limitTotalUsd: z.coerce.number()
    .min(0)
    .max(10000000)
    .nullable()
    .optional(),
  limitConcurrentSessions: z.coerce.number()
    .int()
    .min(0)
    .max(1000)
    .optional()
    .default(0),
  providerGroup: z.string()
    .max(200)
    .nullable()
    .optional()
    .default(""),
  cacheTtlPreference: z.enum(["inherit", "5m", "1h"])
    .optional()
    .default("inherit"),
});
```

### 限额最大值

| 限额类型 | 最大值（USD） |
|----------|---------------|
| 5 小时限额 | 10,000 |
| 日限额 | 10,000 |
| 周限额 | 50,000 |
| 月限额 | 200,000 |
| 总限额 | 10,000,000 |
| 并发会话数 | 1,000 |

## API 端点

Key 管理通过以下 API 端点提供服务：

| 端点 | 方法 | 描述 | 权限 |
|------|------|------|------|
| `/api/actions/keys/getKeys` | POST | 获取用户的 Key 列表 | 已认证 |
| `/api/actions/keys/addKey` | POST | 创建新 Key | 已认证 |
| `/api/actions/keys/editKey` | POST | 更新 Key 设置 | 已认证 |
| `/api/actions/keys/removeKey` | POST | 删除（软删除）Key | 已认证 |
| `/api/actions/keys/toggleKeyEnabled` | POST | 启用/禁用 Key | 已认证 |
| `/api/actions/keys/getKeyLimitUsage` | POST | 获取限额使用统计 | 已认证 |
| `/api/actions/keys/batchUpdateKeys` | POST | 批量更新 Key | 管理员 |
| `/api/actions/keys/renewKeyExpiresAt` | POST | 续期 Key | 已认证 |

### Server Actions

```typescript
// Key CRUD 操作
export async function addKey(data: CreateKeyData): Promise<ActionResult<{ generatedKey: string; name: string }>>
export async function editKey(keyId: number, data: UpdateKeyData): Promise<ActionResult>
export async function removeKey(keyId: number): Promise<ActionResult>
export async function getKeys(userId: number): Promise<ActionResult<Key[]>>

// Key 状态管理
export async function toggleKeyEnabled(keyId: number, enabled: boolean): Promise<ActionResult>
export async function renewKeyExpiresAt(keyId: number, data: { expiresAt: string; enableKey?: boolean }): Promise<ActionResult>

// 批量操作（管理员）
export async function batchUpdateKeys(params: BatchUpdateKeysParams): Promise<ActionResult<BatchUpdateResult>>

// 统计信息
export async function getKeysWithStatistics(userId: number): Promise<ActionResult<KeyStatistics[]>>
export async function getKeyLimitUsage(keyId: number): Promise<ActionResult<KeyLimitUsage>>
```

## 供应商分组验证机制

### 分组权限检查

当非管理员用户创建或修改 Key 的供应商分组时，系统会执行严格的权限验证：

```typescript
function validateNonAdminProviderGroup(
  userProviderGroup: string,
  requestedProviderGroup: string,
  options: { hasDefaultKey: boolean },
  tError: TranslationFunction
): string {
  const userGroups = parseProviderGroups(userProviderGroup);
  const requestedGroups = parseProviderGroups(requestedProviderGroup);

  // 如果用户拥有全局访问权限，允许任何分组
  if (userGroups.includes(PROVIDER_GROUP.ALL)) {
    return requestedProviderGroup;
  }

  const userGroupSet = new Set(userGroups);
  
  // 检查默认分组权限
  if (requestedGroups.includes(PROVIDER_GROUP.DEFAULT) && !options.hasDefaultKey) {
    throw new Error(tError("NO_DEFAULT_GROUP_PERMISSION"));
  }

  // 检查是否有权限访问所有请求的分组
  const invalidGroups = requestedGroups.filter((g) => !userGroupSet.has(g));
  if (invalidGroups.length > 0) {
    throw new Error(tError("NO_GROUP_PERMISSION", { 
      groups: invalidGroups.join(", ") 
    }));
  }

  return requestedProviderGroup;
}
```

### 供应商分组常量

系统定义了以下供应商分组常量：

```typescript
export const PROVIDER_GROUP = {
  /** 默认分组标识符 */
  DEFAULT: "default",
  /** 全局访问标识符（管理员专用） */
  ALL: "*",
} as const;
```

### 用户有效分组计算

用户的有效供应商分组是其所有 Key 分组的并集：

```
用户有效分组 = Key1分组 ∪ Key2分组 ∪ ... ∪ KeyN分组
```

当 Key 的分组发生变化时，系统会自动重新计算用户的有效分组并同步更新。

## 缓存 TTL 偏好

Key 可以设置缓存 TTL（Time To Live）偏好，用于控制响应缓存时间：

| 偏好值 | 说明 |
|--------|------|
| **inherit** | 继承供应商或客户端请求的设置（默认） |
| **5m** | 强制 5 分钟缓存 TTL |
| **1h** | 强制 1 小时缓存 TTL |

缓存 TTL 偏好适用于需要特殊缓存策略的场景：

- **5m**：适合中等频率的重复请求
- **1h**：适合低频但计算成本高的请求
- **inherit**：保持默认行为，灵活性最高

## 相关文档

- [配额管理](/docs/users/quota) - 了解用户级别的限额体系
- [多维度限流](/docs/proxy/rate-limiting) - 深入理解限流机制和 Lease 实现
- [用户分组功能](/docs/users/groups) - 供应商分组详解和配置
- [会话管理](/docs/proxy/session-management) - Session 与 Key 的关系
- [权限控制系统](/docs/users/permissions) - 角色和权限体系
- [缓存机制](/docs/system/cache) - 了解缓存 TTL 的工作原理
