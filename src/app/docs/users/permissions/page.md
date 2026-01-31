---
title: 权限控制系统
description: Claude Code Hub 权限控制系统实现基于角色的访问控制（RBAC），支持管理员和普通用户两种角色，提供字段级权限控制和 API 访问保护。
---

# 权限控制系统

Claude Code Hub 实现了一套基于角色的访问控制（RBAC）系统，用于管理用户对系统资源、API 端点和
管理功能的访问权限。该系统通过多层次的权限检查确保敏感操作只能由授权人员执行。

{% callout type="note" title="核心特性" %}
- **双角色模型**：管理员（admin）和普通用户（user）两种角色
- **字段级权限**：控制哪些用户字段可以被谁修改
- **多层防护**：服务端、字段、路由和组件级别的权限检查
- **灵活访问模式**：支持只读访问和管理员令牌
{% /callout %}

## 角色体系

系统采用简洁的两级角色体系：

### 管理员（admin）

管理员拥有系统的完全访问权限，可以执行以下操作：

- 管理供应商（创建、编辑、删除）
- 管理用户（创建、编辑、删除、配置配额）
- 管理 API Key（为任何用户创建、编辑、删除）
- 查看所有统计数据和使用情况
- 配置系统设置
- 管理敏感词和错误规则
- 访问会话管理
- 查看排行榜和排名

管理员角色在数据库中存储为 `"admin"`，具有最高级别的系统访问权限。只有管理员可以创建其他管理员用户，
或者将现有用户的角色提升为管理员。

### 普通用户（user）

普通用户拥有有限的访问权限：

- 使用代理端点（API 访问）
- 查看个人统计数据
- 管理自己的 API Key（如果启用了 `canLoginWebUi`）
- 通过 `/my-usage` 查看个人使用情况
- 有限的仪表盘访问权限

普通用户在数据库中的默认角色值为 `"user"`。这类用户无法访问管理功能，也不能查看其他用户的数据。

## 权限执行模式

系统采用多种模式执行权限检查，确保安全性。每种模式针对不同的应用场景，形成互补的防护机制。

### 服务端角色检查

大多数管理操作需要显式的角色验证。这是最常见的权限检查模式，直接在服务端动作（Server Actions）中执行：

```typescript
const session = await getSession();
if (!session || session.user.role !== "admin") {
  return {
    ok: false,
    error: tError("PERMISSION_DENIED"),
    errorCode: ERROR_CODES.PERMISSION_DENIED,
  };
}
```

这种模式用于以下场景：
- 创建、编辑或删除供应商
- 管理用户账户
- 查看系统级统计数据
- 修改系统配置

### 资源所有权检查

对于用户可管理的资源，系统会验证所有权。这种模式允许用户管理自己的资源，同时防止访问他人的资源：

```typescript
if (session.user.role !== "admin" && session.user.id !== resourceOwnerId) {
  return {
    ok: false,
    error: tError("PERMISSION_DENIED"),
    errorCode: ERROR_CODES.PERMISSION_DENIED,
  };
}
```

管理员可以绕过所有权检查，管理所有用户的资源。这种模式主要用于：
- API Key 管理
- 个人资料编辑
- 个人统计数据查看

### 字段级权限过滤

更新用户数据时，敏感字段会根据角色进行过滤。这种模式提供了细粒度的访问控制：

```typescript
const unauthorizedFields = getUnauthorizedFields(data, session.user.role);
if (unauthorizedFields.length > 0) {
  return {
    ok: false,
    error: `${tError("PERMISSION_DENIED")}: ${unauthorizedFields.join(", ")}`,
    errorCode: ERROR_CODES.PERMISSION_DENIED,
  };
}
```

字段级权限检查确保即使请求通过了角色验证，也不能修改超出权限范围的数据字段。

### 页面级访问控制

前端页面在路由级别强制执行访问控制。这种检查发生在页面渲染之前，防止未授权用户看到管理界面：

```typescript
export default async function AdminPage({ params }) {
  const { locale } = await params;
  const session = await getSession();

  if (!session || session.user.role !== "admin") {
    redirect({ href: session ? "/dashboard" : "/login", locale });
  }

  return <AdminPageContent />;
}
```

如果未认证用户尝试访问管理页面，系统会将其重定向到登录页面。如果普通用户尝试访问，则重定向到仪表盘。

## 管理员专属字段

以下字段仅限管理员修改，普通用户尝试修改这些字段会被拒绝：

| 字段 | 说明 |
|------|------|
| `rpm` | 每分钟请求数限制 |
| `dailyQuota` | 每日配额限制（美元） |
| `providerGroup` | 供应商组分配 |
| `limit5hUsd` | 5 小时消费限制 |
| `limitWeeklyUsd` | 每周消费限制 |
| `limitMonthlyUsd` | 每月消费限制 |
| `limitTotalUsd` | 总消费限制 |
| `limitConcurrentSessions` | 并发会话限制 |
| `dailyResetMode` | 每日重置模式（固定/滚动） |
| `dailyResetTime` | 每日重置时间（HH:mm） |
| `isEnabled` | 用户启用状态 |
| `expiresAt` | 账户过期日期 |
| `allowedClients` | 允许的客户端模式 |
| `allowedModels` | 允许的 AI 模型 |

这些字段的配置直接影响用户的资源使用权限和成本控制能力，因此仅限管理员修改。

## 特殊权限场景

### 全局使用量查看

系统支持通过 `allowGlobalUsageView` 设置启用非管理员用户查看排行榜：

```typescript
const systemSettings = await getSystemSettings();
const isAdmin = session.user.role === "admin";
const hasPermission = isAdmin || systemSettings.allowGlobalUsageView;

if (!hasPermission) {
  return NextResponse.json(
    { error: "无权限访问排行榜，请联系管理员开启全站使用量查看权限" },
    { status: 403 }
  );
}
```

管理员可以在**系统设置**中开启此选项，允许普通用户查看用户排行榜。这在需要透明度的团队环境中特别有用。

### 只读访问（my-usage）

设置了 `canLoginWebUi: false` 的 API Key 仍然可以访问 `/my-usage` 页面查看个人统计数据：

```typescript
const READ_ONLY_PATH_PATTERNS = ["/my-usage"];
const isReadOnlyPath = READ_ONLY_PATH_PATTERNS.some(pattern => 
  pathWithoutLocale === pattern || pathWithoutLocale.startsWith(`${pattern}/`)
);

const session = await validateKey(authToken.value, { 
  allowReadOnlyAccess: isReadOnlyPath 
});
```

这种设计允许你为自动化脚本创建只能查看使用情况的 API Key，而不能访问管理界面。`allowReadOnlyAccess` 选项在验证 Key 时临时绕过 `canLoginWebUi` 检查，仅允许访问只读路径。

### 管理员令牌认证

系统支持通过 `ADMIN_TOKEN` 环境变量配置超级管理员令牌，无需数据库认证即可获得管理员权限：

```typescript
const adminToken = config.auth.adminToken;
if (adminToken && keyString === adminToken) {
  const adminUser = {
    id: -1,
    name: "Admin Token",
    role: "admin",
    // ... 其他字段
  };
  
  return { user: adminUser, key: adminKey };
}
```

管理员令牌用户的特性：
- 用户 ID 为 `-1`（合成标识符）
- 默认启用 `canLoginWebUi`
- 不受用户级配额限制
- 无法通过 UI 修改（无数据库记录）

管理员令牌适用于以下场景：
- 系统初始设置时创建第一个管理员用户
- 自动化脚本和运维工具
- 紧急情况下的系统恢复

## 登录重定向逻辑

系统根据用户角色和 Key 配置决定登录后的跳转目标：

```typescript
export function getLoginRedirectTarget(session: AuthSession): string {
  if (session.user.role === "admin") return "/dashboard";
  if (session.key.canLoginWebUi) return "/dashboard";
  return "/my-usage";
}
```

- 管理员用户始终跳转到 `/dashboard`
- 启用了 `canLoginWebUi` 的普通用户跳转到 `/dashboard`
- 禁用了 `canLoginWebUi` 的普通用户跳转到 `/my-usage`

这种设计确保只读 API Key 的用户不会被困在无法访问的页面上。

## 权限检查流程

### 认证流程

```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐
│   Client    │────▶│  Middleware  │────▶│   validate  │
│   Request   │     │   (proxy.ts) │     │    Key()    │
└─────────────┘     └──────────────┘     └──────┬──────┘
                                                │
                       ┌────────────────────────┘
                       ▼
              ┌─────────────────┐
              │  Check Admin    │
              │    Token?       │
              └────────┬────────┘
                       │
          ┌─────────────┼─────────────┐
          ▼             ▼             ▼
     ┌─────────┐  ┌──────────┐  ┌──────────┐
     │  Admin  │  │ Database │  │  Return  │
     │ Session │  │  Lookup  │  │   Null   │
     └────┬────┘  └────┬─────┘  └────┬─────┘
          │            │             │
          └────────────┼─────────────┘
                       ▼
             ┌──────────────────┐
             │ Check canLogin   │
             │    WebUi         │
             └────────┬─────────┘
                      │
          ┌───────────┴───────────┐
          ▼                       ▼
    ┌────────────┐          ┌──────────┐
    │   Allow    │          │  Deny    │
    │  Access    │          │  Access  │
    └────────────┘          └──────────┘
```

### 权限检查流程

```
┌─────────────────┐
│  User Action    │
│  (Server Action)│
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│   getSession()  │
└────────┬────────┘
         │
         ▼
┌─────────────────┐     ┌─────────────────┐
│  Session Null?  │────▶│ Return UNAUTHORIZED│
└────────┬────────┘     └─────────────────┘
         │ No
         ▼
┌─────────────────┐     ┌─────────────────┐
│  Role Check     │────▶│ Return PERMISSION_DENIED│
│ (admin required)│     └─────────────────┘
└────────┬────────┘
         │ Pass
         ▼
┌─────────────────┐     ┌─────────────────┐
│ Ownership Check │────▶│ Return PERMISSION_DENIED│
│ (if applicable) │     └─────────────────┘
└────────┬────────┘
         │ Pass
         ▼
┌─────────────────┐
│  Field Filter   │
│ (getUnauthorized│
│    Fields)      │
└────────┬────────┘
         │
         ▼
┌─────────────────┐     ┌─────────────────┐
│ Fields Valid?   │────▶│ Return PERMISSION_DENIED│
└────────┬────────┘     │  (with field list)      │
         │ Yes          └─────────────────┘
         ▼
┌─────────────────┐
│ Execute Action  │
└─────────────────┘
```

## 错误处理

### 错误代码

权限相关的错误代码定义在 `error-messages.ts` 中：

```typescript
export const AUTH_ERRORS = {
  UNAUTHORIZED: "UNAUTHORIZED",
  INVALID_CREDENTIALS: "INVALID_CREDENTIALS",
  SESSION_EXPIRED: "SESSION_EXPIRED",
  PERMISSION_DENIED: "PERMISSION_DENIED",
  TOKEN_REQUIRED: "TOKEN_REQUIRED",
  INVALID_TOKEN: "INVALID_TOKEN",
} as const;
```

### 国际化错误消息

系统支持英语和繁体中文的错误消息：

**英语（en）**：
```json
{
  "UNAUTHORIZED": "Unauthorized, please log in",
  "PERMISSION_DENIED": "Permission denied"
}
```

**繁体中文（zh-TW）**：
```json
{
  "UNAUTHORIZED": "未授權，請先登入",
  "PERMISSION_DENIED": "權限不足"
}
```

错误消息通过 `tError` 函数根据当前语言环境自动选择。

## 供应商组权限验证

非管理员用户只能创建具有其已有访问权限的供应商组的 API Key：

```typescript
if (isAdmin) {
  providerGroupForKey = requestedProviderGroup;
} else {
  // 安全检查：要求先有一个 default 组的 Key 才能创建 default 组的新 Key
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

这种设计确保用户无法通过创建新 Key 来获取超出其权限范围的供应商访问权限。验证逻辑检查用户是否已有相应供应商组的 Key，防止权限提升攻击。

## 安全考虑

### 纵深防御

权限系统实现了多层防御：

1. **数据库层**：角色存储在数据库中，默认值为 "user"
2. **API 层**：所有服务端操作都验证会话和角色
3. **字段层**：敏感字段需要显式的管理员角色
4. **前端层**：UI 组件根据角色条件渲染
5. **路由层**：页面级重定向阻止访问管理页面

每一层都是独立的安全检查点，即使某一层被绕过，其他层仍然提供保护。

### 不信任客户端

所有权限检查都在服务端执行。客户端检查仅用于提升用户体验：

```typescript
// 服务端操作始终重新验证
const session = await getSession();
// 从不信任客户端发送的角色信息
```

这意味着即使客户端被篡改，服务端的权限检查仍然有效。

### 审计日志

权限拒绝会被记录用于安全监控：

```typescript
logger.warn(`[ActionAPI] ${fullPath} 权限不足: 需要 admin 角色`, {
  userId: session.user.id,
  userRole: session.user.role,
});
```

这些日志可以帮助检测潜在的未授权访问尝试。

## 边缘情况处理

### 会话过期

如果用户的会话在页面加载和服务端操作执行之间过期，操作会返回 `UNAUTHORIZED` 错误，客户端应重定向到登录页面。

### 并发角色变更

如果管理员将用户降级为非管理员时该用户有活跃会话：

- 用户的下一次操作会失败角色检查
- 现有会话不会立即失效
- 每次服务端操作都会执行角色检查

这种设计平衡了安全性和用户体验，避免频繁地强制用户重新登录。

### 字段权限绕过尝试

如果非管理员用户尝试修改受保护字段：

```typescript
const result = await editUser(userId, {
  name: "New Name",
  dailyQuota: 1000,  // 管理员专属字段！
});

// 结果：
// { ok: false, error: "Permission denied: dailyQuota", errorCode: "PERMISSION_DENIED" }
```

系统会明确列出被拒绝的字段，帮助用户理解权限边界。

## 环境变量配置

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `ADMIN_TOKEN` | 超级管理员令牌 | `undefined` |
| `ENABLE_SECURE_COOKIES` | 是否使用安全 Cookie 标志 | `true` |

`ADMIN_TOKEN` 应该设置为强随机字符串，并妥善保管。在生产环境中，建议定期轮换此令牌。

## 系统设置

`allowGlobalUsageView` 设置控制非管理员用户是否可以查看全局排行榜：

```typescript
export const systemSettings = pgTable('system_settings', {
  id: serial('id').primaryKey(),
  allowGlobalUsageView: boolean('allow_global_usage_view').notNull().default(false),
  // ... 其他设置
});
```

默认情况下，此功能处于关闭状态，只有管理员可以查看排行榜。

## 最佳实践

### 管理员建议

1. **谨慎分配管理员角色**：只将管理员权限授予可信任的人员
2. **定期审查用户权限**：检查是否有不必要的管理员账户
3. **使用管理员令牌进行自动化**：为脚本和自动化工具配置 `ADMIN_TOKEN`
4. **监控权限拒绝日志**：关注异常的大量权限拒绝请求

### 普通用户管理

1. **合理设置字段权限**：利用字段级权限控制用户可修改的内容
2. **使用 `canLoginWebUi` 控制访问**：为纯 API 使用场景禁用 Web UI 登录
3. **配置 `allowGlobalUsageView`**：根据组织需求决定是否开放排行榜查看

### 安全建议

1. **启用安全 Cookie**：在生产环境中确保 `ENABLE_SECURE_COOKIES` 为 `true`
2. **使用 HTTPS**：所有权限检查都应在 HTTPS 连接上进行
3. **定期审计**：定期检查用户角色和权限配置
4. **最小权限原则**：只授予用户完成工作所需的最小权限

## 故障排查

### 权限被拒绝

**问题**：操作返回 "Permission denied"

**排查步骤**：
1. 确认用户角色是否为 `admin`
2. 检查是否尝试修改管理员专属字段
3. 验证会话是否过期
4. 查看系统日志获取详细信息

### 无法访问排行榜

**问题**：普通用户无法查看排行榜

**解决方案**：
1. 管理员在系统设置中启用 `allowGlobalUsageView`
2. 或者将用户角色提升为 `admin`

### 管理员令牌无效

**问题**：使用 `ADMIN_TOKEN` 无法登录

**排查步骤**：
1. 确认 `ADMIN_TOKEN` 环境变量已正确设置
2. 检查令牌值是否完全匹配（包括大小写）
3. 验证系统已重启以加载新配置

### 只读 Key 无法访问预期页面

**问题**：设置了 `canLoginWebUi: false` 的 Key 无法访问某些页面

**排查步骤**：
1. 确认只读 Key 只能访问 `/my-usage` 页面
2. 检查是否正确设置了 `allowReadOnlyAccess` 选项
3. 验证路径是否在 `READ_ONLY_PATH_PATTERNS` 列表中

## 相关文档

- [用户 CRUD 操作](/docs/users/crud) - 用户管理操作详解
- [API Key 管理](/docs/users/api-keys) - API Key 的创建和配置
- [配额管理](/docs/users/quota) - 用户配额体系说明
- [排行榜](/docs/monitoring/leaderboard) - 使用量排行和统计
