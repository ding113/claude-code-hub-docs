---
title: 访问限制
nextjs:
  metadata:
    title: 访问限制
    description: Claude Code Hub 访问限制文档
---

# 访问限制

Claude Code Hub 的访问限制系统是一个多层防护体系，用于控制谁可以访问代理服务、
他们能访问什么资源，以及如何使用这些资源。该系统专为多租户环境设计，让管理员
能够对用户权限、资源分配和安全策略进行精细化控制。

{% callout type="note" title="核心目标" %}
访问限制系统旨在实现以下目标：
- **安全控制**：在请求到达上游供应商之前验证客户端、模型和用户状态
- **资源管理**：通过配额限制（RPM、成本限额、并发会话）防止滥用并管理成本
- **合规执行**：通过限制可用的 AI 模型和客户端应用来执行组织策略
- **运营安全**：通过敏感词过滤和请求修改功能阻止潜在有害内容
{% /callout %}

## 防护管道执行顺序

访问限制系统以防护管道的形式运作，每个传入请求都会按顺序通过一系列检查。
每个防护层都可以允许请求继续执行，或者使用特定的错误响应阻止请求。

```
┌─────────────┐   ┌─────────────┐   ┌─────────────┐   ┌─────────────┐
│    认证     │ → │   敏感词    │ → │   客户端    │ → │    模型     │
└─────────────┘   └─────────────┘   └─────────────┘   └─────────────┘
       │
┌─────────────┐   ┌─────────────┐   ┌─────────────┐   ┌─────────────┐
│   限流      │ ← │   请求过滤  │ ← │   预热拦截  │ ← │   会话      │
└─────────────┘   └─────────────┘   └─────────────┘   └─────────────┘
```

防护层按以下顺序执行：

| 顺序 | 防护层 | 功能 |
|-----|--------|------|
| 1 | 认证 | 验证用户状态和有效期 |
| 2 | 敏感词 | 检测并阻止包含敏感内容的请求 |
| 3 | 客户端 | 限制允许的 CLI/IDE 客户端 |
| 4 | 模型 | 限制可使用的 AI 模型 |
| 5 | 版本 | 检查客户端版本是否为最新 |
| 6 | 预热 | 拦截健康检查请求 |
| 7 | 会话 | 分配和追踪会话 |
| 8 | 请求过滤 | 修改请求内容 |
| 9 | 限流 | 执行配额和速率限制 |
| 10 | 供应商 | 选择上游供应商 |

如果任何防护层返回非空响应，管道会立即终止，并将该响应返回给客户端，
而不会到达上游供应商。这种设计确保了安全检查的原子性——一旦某个检查失败，
后续检查不会执行，从而避免不必要的计算开销。

## 用户状态与有效期

认证防护层在允许访问之前验证用户状态。这是整个防护管道的第一个检查点，
确保只有有效且活跃的用户才能继续使用服务。

### 数据库字段

```typescript
{
  isEnabled: boolean,      // 账户是否启用
  expiresAt: timestamp,    // 账户过期时间（可选）
}
```

### 行为说明

- **禁用账户**：当 `isEnabled` 为 `false` 时，用户会收到 401 错误：
  "用户账户已被禁用。请联系管理员。"

- **过期账户**：当 `expiresAt` 已过期时，用户会收到 401 错误：
  "用户账户已于 {date} 过期。请续费订阅。"

- **自动禁用**：过期用户会通过 `markUserExpired()` 函数被延迟标记为禁用状态。
  这种延迟标记机制避免了在每次请求时都进行数据库更新，提高了系统性能。

### 管理配置

管理员可以通过用户编辑表单设置用户状态和有效期。这些字段仅限管理员修改：

```typescript
export const USER_FIELD_PERMISSIONS = {
  isEnabled: { requiredRole: "admin" },
  expiresAt: { requiredRole: "admin" },
  // ...
};
```

{% callout type="warning" title="管理员权限" %}
只有管理员可以修改用户的启用状态和过期时间。普通用户无法自行更改这些设置，
即使通过 API 直接调用也不行。
{% /callout %}

## 客户端限制

客户端防护层限制哪些 CLI/IDE 客户端可以访问服务。这对于控制组织内使用的工具
和确保合规性非常有用。

### 数据库字段

```typescript
{
  allowedClients: string[],  // 允许的客户端模式列表
}
```

### 匹配逻辑

- **大小写不敏感**：匹配时忽略大小写
- **连字符/下划线规范化**：`gemini-cli` 可以匹配 `GeminiCLI`、`gemini_cli` 或 `gemini-cli`
- **空数组表示无限制**：未配置限制时允许所有客户端
- **最多 50 个模式**：每个模式最多 64 个字符

规范化逻辑通过将连字符和下划线移除来实现灵活匹配：

```typescript
const normalize = (s: string) => s.toLowerCase().replace(/[-_]/g, "");
```

### 预设客户端

系统提供以下预设客户端供快速选择：

| 值 | 标签 |
|---|------|
| claude-cli | Claude Code CLI |
| gemini-cli | Gemini CLI |
| factory-cli | Droid CLI |
| codex-cli | Codex CLI |

### 错误响应

- **缺少 User-Agent**：当配置了限制但未提供 User-Agent 头时：
  "Client not allowed. User-Agent header is required when client restrictions are configured."

- **客户端不匹配**：当 User-Agent 不匹配任何允许的模式时：
  "Client not allowed. Your client is not in the allowed list."

### 配置示例

```typescript
// 只允许 Claude Code CLI 和 Gemini CLI
allowedClients: ["claude-cli", "gemini-cli"]

// 匹配测试示例
// User-Agent: "GeminiCLI/0.22.5/gemini-3-pro-preview (darwin; arm64)"
// 模式: "gemini-cli" -> 匹配成功
```

### 边缘情况处理

- 模式 `-` 或 `___` 规范化后为空字符串，会被跳过，不会匹配所有内容
- 混合模式如 `my-special_cli` 会规范化后一致匹配

## 模型限制

模型防护层限制用户可以访问哪些 AI 模型。这对于控制成本、确保合规性和管理
模型访问权限非常重要。

### 数据库字段

```typescript
{
  allowedModels: string[],  // 允许的模型名称列表
}
```

### 匹配逻辑

- **大小写不敏感精确匹配**：模型名称必须完全匹配（如 `claude-3-opus-20240229`）
- **非子字符串匹配**：`claude-3` 不会匹配 `claude-3-opus-20240229`
- **空数组表示无限制**：未配置限制时允许所有模型
- **最多 50 个模型**：每个模型名称最多 64 个字符

### 模型名称格式

有效的模型名称格式包括：

```
gemini-1.5-pro
gpt-4.1
claude-3-opus-20240229
o1-mini
```

模型名称只能包含字母、数字、点、下划线、冒号、斜杠和连字符。

### 错误响应

- **缺少模型**：当配置了限制但未指定模型时：
  "Model not allowed. Model specification is required when model restrictions are configured."

- **模型不允许**：当请求的模型不在允许列表中时：
  "Model not allowed. The requested model '{model}' is not in the allowed list."

### 使用场景

模型限制在以下场景特别有用：

1. **成本控制**：限制只能使用较便宜的模型（如 `gpt-3.5-turbo`）
2. **合规要求**：某些组织可能只允许使用特定的模型
3. **功能隔离**：为不同用户组分配不同的模型访问权限

## 速率限制与配额

速率限制防护层通过多层次的消耗限制来防止滥用。这是资源管理的核心组件。

### 检查顺序

限流检查按以下优先级顺序执行：

1. **永久硬限制**：Key 总限额 → User 总限额
2. **资源/频率保护**：Key 并发 → User 并发 → User RPM
3. **短期周期限额**：Key 5小时 → User 5小时 → Key 每日 → User 每日
4. **中长期周期限额**：Key 每周 → User 每周 → Key 每月 → User 每月

这种顺序确保了最重要的限制（永久限额）首先被检查，而周期性的限制按照
时间粒度从小到大检查。

### 限额类型

| 限额类型 | 数据库字段 | 说明 |
|---------|-----------|------|
| 总成本 | `limitTotalUsd` | 永久生命周期限额 |
| 5小时 | `limit5hUsd` | 滚动 5 小时窗口 |
| 每日 | `limitDailyUsd` / `dailyQuota` | 每日消费限额 |
| 每周 | `limitWeeklyUsd` | 每周消费限额 |
| 每月 | `limitMonthlyUsd` | 每月消费限额 |
| 并发会话 | `limitConcurrentSessions` | 最大并行连接数 |
| RPM | `rpmLimit` | 每分钟请求数 |

### 每日重置模式

- **固定时间** (`fixed`)：在特定时间重置（如 `"00:00"`、`"18:00"`）
- **滚动窗口** (`rolling`)：24 小时滚动窗口

固定重置时间使用 `dailyResetTime` 字段配置，格式为 `HH:MM`。

### 错误消息差异

- **固定窗口**：显示重置时间 "Quota will reset at 2024-01-15T00:00:00Z"
- **滚动窗口**：显示剩余时间 "Quota will reset in 3 hours"

### 并发会话追踪

并发会话通过 Redis 进行追踪：

```typescript
// 预热请求不计入并发限制
if (!warmupMaybeIntercepted) {
  void SessionTracker.trackSession(sessionId, keyId, userId);
}
```

这确保预热请求不会消耗配额。会话追踪使用 Redis 的原子操作确保准确性。

## 敏感词过滤

敏感词防护层阻止包含禁止内容的请求。这对于内容审核和合规性非常重要。

### 数据库字段

```typescript
{
  word: string,           // 敏感词或模式
  matchType: string,      // 匹配类型: contains | exact | regex
  description: string,    // 描述（可选）
  isEnabled: boolean,     // 是否启用
}
```

### 匹配类型

| 类型 | 复杂度 | 说明 |
|-----|-------|------|
| `contains` | O(n×m) | 子字符串匹配（最快） |
| `exact` | O(1) | 精确字符串匹配（使用 Set） |
| `regex` | 可变 | 正则表达式匹配（最灵活，最慢） |

检测引擎按效率顺序执行：先执行 `contains` 检查，然后是 `exact`，最后是 `regex`。
这种优化确保了常见的简单匹配能够快速完成，而复杂的正则表达式只在必要时使用。

### 被阻止请求日志

被敏感词过滤阻止的请求会记录以下信息：

```typescript
{
  blockedBy: "sensitive_word",
  blockedReason: {
    word: "sensitive-word",
    matchType: "contains",
    matchedText: "..."
  },
  providerId: 0,      // 0 表示未到达供应商
  cost: 0             // 不收费
}
```

### 配置建议

1. **优先使用 contains**：对于简单的关键词过滤，使用 `contains` 类型获得最佳性能
2. **谨慎使用 regex**：正则表达式虽然灵活，但可能影响性能，只在必要时使用
3. **描述字段**：为每个敏感词添加描述，方便后续管理和审计

## 请求过滤

请求过滤系统在请求到达供应商之前修改请求内容。这可以用于删除敏感信息、
添加自定义头或修改请求体。

### 数据库字段

```typescript
{
  name: string,           // 过滤器名称
  scope: string,          // 范围: header | body
  action: string,         // 动作: remove | set | json_path | text_replace
  matchType: string,      // 匹配类型（可选）
  target: string,         // 目标字段或路径
  replacement: any,       // 替换值
  priority: number,       // 执行优先级
  isEnabled: boolean,     // 是否启用
  bindingType: string,    // 绑定类型: global | providers | groups
  providerIds: number[],  // 绑定的供应商 ID（可选）
  groupTags: string[],    // 绑定的分组标签（可选）
}
```

### 过滤器动作

| 范围 | 动作 | 说明 |
|-----|------|------|
| Header | `remove` | 删除请求头 |
| Header | `set` | 设置/替换请求头值 |
| Body | `json_path` | 使用 JSON Path 修改请求体 |
| Body | `text_replace` | 替换文本（支持 contains/exact/regex） |

### 执行阶段

1. **全局过滤器**：在供应商选择之前执行
2. **供应商特定过滤器**：在供应商选择之后执行

这种分阶段设计允许在路由决策前后分别进行修改。

### 使用示例

```typescript
// 删除敏感请求头
{
  name: "Remove Internal Headers",
  scope: "header",
  action: "remove",
  target: "X-Internal-Token",
  bindingType: "global"
}

// 修改请求体中的模型名称
{
  name: "Redirect Model",
  scope: "body",
  action: "json_path",
  target: "$.model",
  replacement: "gpt-4-turbo",
  bindingType: "providers",
  providerIds: [1, 2]
}
```

## 客户端版本检查

版本防护层阻止过时的客户端版本。这有助于确保用户使用最新的功能和安全补丁。

### 系统设置

```typescript
{
  enableClientVersionCheck: boolean,  // 是否启用版本检查
}
```

### GA 版本检测

GA（Generally Available）版本定义为被至少 `GA_THRESHOLD` 个用户使用的最新版本。
活跃窗口为过去 7 天内有请求的用户。默认阈值为 2（可通过环境变量配置）。

检测流程：
1. 检查 Redis 缓存
2. 查询过去 7 天的活跃用户
3. 解析 User-Agent 并按版本统计用户数
4. 返回使用用户数 >= GA_THRESHOLD 的最新版本

### 错误响应

当客户端版本过时时，返回以下错误：

```json
{
  "error": {
    "type": "client_upgrade_required",
    "message": "Your Claude Code CLI (v1.0.0) is outdated. Please upgrade to v2.0.0 or later to continue using this service.",
    "current_version": "1.0.0",
    "required_version": "2.0.0",
    "client_type": "claude-cli",
    "client_display_name": "Claude Code CLI"
  }
}
```

### 故障开放行为

- 版本检查失败时允许请求
- User-Agent 解析失败时允许请求
- 功能禁用时允许所有请求

这种故障开放设计确保了版本检查不会意外阻止合法用户。

## 预热请求拦截

预热防护层拦截 Anthropic 预热请求以避免不必要的上游调用。预热请求是客户端
在启动时发送的健康检查请求，用于验证连接。

### 系统设置

```typescript
{
  interceptAnthropicWarmupRequests: boolean,  // 是否拦截预热请求
}
```

### 预热请求检测

预热请求必须满足以下条件：
- 请求路径为 `/v1/messages`
- 恰好有 1 条消息，角色为 `user`
- 恰好有 1 个内容块，类型为 `text`
- 文本内容为 `warmup`（大小写不敏感）
- 具有 `cache_control.type == "ephemeral"`

### 拦截响应

- 返回最小化的有效 Anthropic 响应
- 日志记录 `blockedBy: "warmup"`
- 不计费，不计入统计
- 响应头包含 `x-cch-intercepted: warmup`

这种拦截可以显著减少不必要的上游 API 调用，节省成本。

## Key 级别限制

API Key 有自己的限制设置，可以与用户级别限制结合使用。这为细粒度的访问控制
提供了可能。

### Key 限制字段

```typescript
{
  isEnabled: boolean,              // Key 是否启用
  expiresAt: timestamp,            // Key 过期时间
  canLoginWebUi: boolean,          // 是否允许登录 Web UI
  limit5hUsd: number,              // 5 小时限额
  limitDailyUsd: number,           // 每日限额
  limitWeeklyUsd: number,          // 每周限额
  limitMonthlyUsd: number,         // 每月限额
  limitTotalUsd: number,           // 总限额
  limitConcurrentSessions: number, // 并发会话限制
  providerGroup: string,           // 供应商分组
}
```

### Key 特定行为

- `canLoginWebUi`：控制 Key 是否可以用于访问 Web 仪表板。这对于区分 API 访问
  和 Web 访问非常有用。
- Key 级别限额与用户级别限额独立计算。这意味着用户需要同时满足两个级别的限制。
- Key 可以拥有与用户不同的供应商分组，允许更细粒度的路由控制。

### 使用场景

1. **项目隔离**：为不同项目创建不同的 Key，每个 Key 有自己的限额
2. **临时访问**：创建有过期时间的临时 Key
3. **Web 访问控制**：限制某些 Key 只能用于 API 访问，不能登录 Web UI

## 设计原则

### 故障开放哲学

大多数防护层设计为故障开放——如果限制检查出错，请求会被允许通过而不是被阻止。
这确保了服务的可用性。以下防护层采用故障开放：

- 版本防护：任何错误返回 null（允许）
- 敏感词防护：检测错误返回 null（允许）
- 请求过滤：过滤失败记录错误但不阻止

以下防护层采用故障关闭（阻止）：

- 认证防护：认证失败返回 401
- 限流防护：超出限额抛出 RateLimitError
- 客户端/模型防护：模式不匹配返回 400

### 选择性限制

限制只在显式配置时生效。空数组或空值表示"无限制"。这种设计确保了向后兼容性——
没有限制的现有用户无需迁移即可继续工作。

```typescript
// 客户端防护
const allowedClients = user.allowedClients ?? [];
if (allowedClients.length === 0) {
  return null; // 无限制 - 允许所有
}

// 模型防护
const allowedModels = user.allowedModels ?? [];
if (allowedModels.length === 0) {
  return null; // 无限制 - 允许所有
}
```

### 分层防御

多个防护层可以阻止同一个请求，每层提供不同类型的保护。这种纵深防御策略
确保了即使某一层被绕过，其他层仍然可以提供保护。

### 审计追踪

被阻止的请求会记录特定的 `blockedBy` 和 `blockedReason` 字段，用于故障排除和合规审计。
常见的 `blockedBy` 值包括：

- `"warmup"` - 拦截的预热请求
- `"sensitive_word"` - 敏感词过滤阻止

## 权限系统

所有限制字段仅限管理员修改：

```typescript
export const USER_FIELD_PERMISSIONS = {
  allowedClients: { requiredRole: "admin" },
  allowedModels: { requiredRole: "admin" },
  isEnabled: { requiredRole: "admin" },
  expiresAt: { requiredRole: "admin" },
  rpmLimit: { requiredRole: "admin" },
  dailyQuota: { requiredRole: "admin" },
  limit5hUsd: { requiredRole: "admin" },
  limitWeeklyUsd: { requiredRole: "admin" },
  limitMonthlyUsd: { requiredRole: "admin" },
  limitTotalUsd: { requiredRole: "admin" },
  limitConcurrentSessions: { requiredRole: "admin" },
  dailyResetMode: { requiredRole: "admin" },
  dailyResetTime: { requiredRole: "admin" },
  providerGroup: { requiredRole: "admin" },
};
```

非管理员用户无法修改限制设置，即使是自己的账户。这种设计防止了特权升级攻击。

## 验证限制

系统对限制配置应用以下验证规则：

```typescript
allowedClients: z
  .array(z.string().max(64, "客户端模式长度不能超过64个字符"))
  .max(50, "客户端模式数量不能超过50个")
  .optional()
  .default([]),

allowedModels: z
  .array(z.string().max(64, "模型名称长度不能超过64个字符"))
  .max(50, "模型数量不能超过50个")
  .optional()
  .default([]),
```

这些限制防止：
- 大数组导致的内存过度使用
- 过多模式导致的性能下降
- 数据库 JSONB 列的存储膨胀

## 数据库索引

系统为被阻止的请求查询优化了数据库索引：

```typescript
// 排除预热请求的会话查询索引
idx_message_request_session_id_prefix: index('idx_message_request_session_id_prefix')
  .on(sql`${table.sessionId} varchar_pattern_ops`)
  .where(sql`${table.deletedAt} IS NULL AND (${table.blockedBy} IS NULL OR ${table.blockedBy} <> 'warmup')`),

// 按阻止原因查询索引
idx_message_request_blocked_by: index('idx_message_request_blocked_by')
  .on(table.blockedBy)
  .where(sql`${table.deletedAt} IS NULL`),
```

这些索引优化了：
- 从会话查询中排除预热请求
- 按类型查找被阻止的请求

## 最佳实践

### 配置建议

1. **渐进式限制**：从宽松的限制开始，根据实际使用情况逐步收紧
2. **分层限额**：同时使用用户级别和 Key 级别限额，提供双重保护
3. **合理的时间窗口**：根据业务周期选择合适的重置模式
   - 对于日结业务，使用固定时间重置（如每天 00:00）
   - 对于持续服务，使用滚动窗口

### 安全建议

1. **客户端限制**：限制允许的客户端以防止未授权的工具访问
2. **模型白名单**：只允许经过批准的 AI 模型
3. **敏感词过滤**：配置组织特定的敏感词列表
4. **版本控制**：启用客户端版本检查以确保安全性

### 监控建议

1. **审查阻止日志**：定期检查 `blockedBy` 字段了解阻止原因分布
2. **配额使用监控**：监控限额使用情况，及时调整配置
3. **并发会话追踪**：了解用户的并发使用模式

### 故障排除

当用户报告访问问题时，检查以下方面：

1. **用户状态**：确认 `isEnabled` 为 true 且未过期
2. **客户端匹配**：验证 User-Agent 是否匹配允许的模式
3. **模型权限**：确认请求的模型在允许列表中
4. **限额状态**：检查是否已达到任何限额
5. **阻止日志**：查看 `message_request` 表中的 `blockedBy` 和 `blockedReason`

## 相关文档

- [用户管理](/docs/users) - 了解用户配置界面
- [供应商管理](/docs/provider-management) - 了解供应商配置
- [智能路由](/docs/proxy/intelligent-routing) - 了解路由决策流程
- [限流](/docs/proxy/rate-limiting) - 了解速率限制机制
