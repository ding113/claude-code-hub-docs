---
dimensions:
  type:
    primary: reference
    detail: guide
  level: intermediate
standard_title: Web UI 登录控制
language: zh
---

# Web UI 登录控制

Claude Code Hub 的 Web UI 登录控制系统提供安全的身份验证机制，让你能够安全地访问基于 Web 的管理界面。与传统的用户名/密码认证不同，系统使用 API Key 作为主要凭证，实现 Web UI 和 API 访问的统一认证模型。

{% callout type="note" title="核心特性" %}
Web UI 登录控制的核心设计目标：
- **统一认证**：使用 API Key 替代独立凭证，简化认证模型
- **细粒度访问控制**：通过 `canLoginWebUi` 权限精确控制哪些密钥可以访问 Web UI
- **安全会话管理**：HTTP-only Cookie 配合可配置的安全设置，防止 XSS 攻击
- **只读访问模式**：没有 Web UI 登录权限的密钥仍可访问 `/my-usage` 页面进行自助用量监控
- **管理员令牌绕过**：基于环境变量的管理员令牌提供无需数据库依赖的紧急访问
{% /callout %}

## 登录流程概览

登录过程遵循以下顺序：

```
用户访问 /login 页面
       │
       ▼
输入 API Key 凭证
       │
       ▼
前端提交到 /api/auth/login
       │
       ▼
服务器验证密钥存在性、启用状态和过期时间
       │
       ▼
验证成功，设置 auth-token HTTP-only Cookie
       │
       ▼
根据角色和权限重定向到相应页面
```

### 认证方法

系统支持两种主要认证机制：

#### 1. 基于 Cookie 的认证（Web UI）

用于浏览器访问 Web UI。`auth-token` Cookie 具有以下特性：

- **HTTP-only**：防止 JavaScript 访问，减轻 XSS 攻击风险
- **Secure**：通过 `ENABLE_SECURE_COOKIES` 环境变量配置
- **SameSite=lax**：提供 CSRF 保护，同时允许正常导航
- **7 天有效期**：在安全性和用户便利性之间取得平衡

```typescript
// src/lib/auth.ts (lines 94-104)
export async function setAuthCookie(keyString: string) {
  const cookieStore = await cookies();
  const env = getEnvConfig();
  cookieStore.set(AUTH_COOKIE_NAME, keyString, {
    httpOnly: true,
    secure: env.ENABLE_SECURE_COOKIES,
    sameSite: "lax",
    maxAge: AUTH_COOKIE_MAX_AGE, // 7 days
    path: "/",
  });
}
```

#### 2. Bearer Token 认证（API/只读）

用于程序化访问或 Cookie 不可用时，系统接受：
- `Authorization: Bearer <api-key>` 请求头
- 主要用于 `/my-usage` 等只读 API 端点

```typescript
// src/lib/auth.ts (lines 139-147)
async function getAuthToken(): Promise<string | undefined> {
  // 优先：Cookie 优先（Web UI 兼容性）
  const cookieToken = await getAuthCookie();
  if (cookieToken) return cookieToken;

  // 降级：Authorization 请求头用于程序化访问
  const headersStore = await headers();
  return parseBearerToken(headersStore.get("authorization"));
}
```

## 基于权限的访问控制

系统实现三层访问模型：

### 1. 管理员用户

- **角色**：users 表中的 `admin`
- **访问权限**：所有页面和功能的完全访问
- **绕过**：绕过所有权限检查，包括 `canLoginWebUi`

### 2. 标准用户（canLoginWebUi=true）

- **密钥**：启用 `canLoginWebUi` 权限的密钥
- **访问权限**：完整的仪表板访问（`/dashboard` 及子页面）
- **能力**：管理自己的用量，查看统计信息

### 3. API-only 用户（canLoginWebUi=false）

- **密钥**：没有 Web UI 登录权限的密钥
- **访问权限**：仅限 `/my-usage` 只读页面
- **限制**：无法访问仪表板或管理功能

```typescript
// src/lib/auth.ts (lines 88-92)
export function getLoginRedirectTarget(session: AuthSession): string {
  if (session.user.role === "admin") return "/dashboard";
  if (session.key.canLoginWebUi) return "/dashboard";
  return "/my-usage";
}
```

## 中间件保护

Next.js 中间件（`src/proxy.ts`）对所有路由强制执行认证：

```typescript
// src/proxy.ts (lines 9-15)
// 不需要认证的公开路径
const PUBLIC_PATH_PATTERNS = ["/login", "/usage-doc", "/api/auth/login", "/api/auth/logout"];

// 允许只读访问的路径（用于 canLoginWebUi=false 的密钥）
const READ_ONLY_PATH_PATTERNS = ["/my-usage"];
```

**中间件逻辑：**
1. 跳过 `/v1/*` API 路由的认证（它们使用自己的认证）
2. 跳过公开路径的认证
3. 对于受保护路径，检查 `auth-token` Cookie
4. 如果没有 Cookie，使用 `?from=` 参数重定向到登录页
5. 如果 Cookie 存在，验证密钥权限
6. 如果密钥缺少 `canLoginWebUi` 且路径不是只读路径，重定向到 `/my-usage`

## 配置选项

### 环境变量

认证行为通过 `/src/lib/config/env.schema.ts` 中定义的环境变量控制：

{% table %}
| 变量 | 默认值 | 描述 |
|------|--------|------|
| `ADMIN_TOKEN` | undefined | 紧急访问的主管理员令牌 |
| `ENABLE_SECURE_COOKIES` | `true` | 在 Cookie 上设置 `Secure` 标志（需要 HTTPS） |
| `SESSION_TTL` | `300` | Redis 跟踪的会话 TTL（秒） |
{% /table %}

```typescript
// src/lib/config/env.schema.ts (lines 81-96)
ADMIN_TOKEN: z.preprocess((val) => {
  if (!val || typeof val !== "string") return undefined;
  if (val === "change-me") return undefined;
  return val;
}, z.string().min(1, "管理员令牌不能为空").optional()),
ENABLE_SECURE_COOKIES: z.string().default("true").transform(booleanTransform),
SESSION_TTL: z.coerce.number().default(300),
```

### 数据库模式

`canLoginWebUi` 权限存储在 keys 表中：

```typescript
// src/drizzle/schema.ts (lines 99-100)
export const keys = pgTable('keys', {
  // ... 其他字段
  // Web UI 登录权限控制
  canLoginWebUi: boolean('can_login_web_ui').default(false),
  // ... 其他字段
});
```

**注意**：虽然数据库默认为 `false`，但 `/src/repository/_shared/transformers.ts` 中的转换器为了向后兼容性默认为 `true`：

```typescript
// src/repository/_shared/transformers.ts (line 62)
canLoginWebUi: dbKey?.canLoginWebUi ?? true,
```

这意味着通过应用程序 API 创建密钥时，新密钥默认为 `canLoginWebUi=true`（宽松），而直接在数据库中创建的密钥默认为 `false`（严格）。

### Cookie 配置

认证 Cookie 配置遵循安全最佳实践：

```typescript
// src/lib/auth.ts (lines 9-10)
const AUTH_COOKIE_NAME = "auth-token";
const AUTH_COOKIE_MAX_AGE = 60 * 60 * 24 * 7; // 7 天
```

**Cookie 属性：**
- `httpOnly: true` - 防止 XSS 攻击
- `secure: env.ENABLE_SECURE_COOKIES` - 生产环境仅限 HTTPS
- `sameSite: "lax"` - CSRF 保护
- `maxAge: 604800` - 7 天
- `path: "/"` - 全站可用

## 密钥验证逻辑

### 密钥验证过程

`validateKey` 函数执行全面的验证：

```typescript
// src/lib/auth.ts (lines 17-86)
export async function validateKey(
  keyString: string,
  options?: { allowReadOnlyAccess?: boolean }
): Promise<AuthSession | null> {
  const allowReadOnlyAccess = options?.allowReadOnlyAccess ?? false;

  // 1. 检查管理员令牌
  const adminToken = config.auth.adminToken;
  if (adminToken && keyString === adminToken) {
    // 返回合成管理员用户和密钥
    return { user: adminUser, key: adminKey };
  }

  // 2. 查询数据库中的活动密钥
  const key = await findActiveKeyByKeyString(keyString);
  if (!key) return null;

  // 3. 检查 Web UI 登录权限
  if (!allowReadOnlyAccess && !key.canLoginWebUi) {
    return null;
  }

  // 4. 加载用户数据
  const user = await findUserById(key.userId);
  if (!user) return null;

  return { user, key };
}
```

### 活动密钥标准

`findActiveKeyByKeyString` 函数验证以下条件：

**验证标准：**
1. 密钥字符串必须完全匹配
2. 密钥不能是软删除状态（`deletedAt IS NULL`）
3. 密钥必须启用（`isEnabled = true`）
4. 密钥不能过期（`expiresAt IS NULL` 或 `expiresAt > now()`）

## 登录页面实现

### 前端组件

登录页面提供精致的用户体验：

**主要特性：**
1. **HTTP 安全警告**：检测非本地主机 HTTP 访问并警告 Cookie 安全问题
2. **表单验证**：客户端验证要求非空 API Key
3. **加载状态**：认证期间提供视觉反馈
4. **错误显示**：在 Alert 组件中显示服务器错误消息
5. **重定向处理**：保留 `?from=` 参数用于登录后导航

```typescript
// src/app/[locale]/login/page.tsx (lines 34-42)
// 检测 HTTP（非本地主机）安全警告
useEffect(() => {
  if (typeof window !== "undefined") {
    const isHttp = window.location.protocol === "http:";
    const isLocalhost =
      window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
    setShowHttpWarning(isHttp && !isLocalhost);
  }
}, []);
```

### 登录 API 端点

登录 API 处理认证请求：

```typescript
// src/app/api/auth/login/route.ts (lines 55-91)
export async function POST(request: NextRequest) {
  const locale = getLocaleFromRequest(request);
  const t = await getAuthErrorTranslations(locale);

  try {
    const { key } = await request.json();

    if (!key) {
      return NextResponse.json({ error: t?.("apiKeyRequired") }, { status: 400 });
    }

    // 允许只读访问验证（用于 my-usage 页面用户）
    const session = await validateKey(key, { allowReadOnlyAccess: true });
    if (!session) {
      return NextResponse.json({ error: t?.("apiKeyInvalidOrExpired") }, { status: 401 });
    }

    // 设置认证 Cookie
    await setAuthCookie(key);

    const redirectTo = getLoginRedirectTarget(session);

    return NextResponse.json({
      ok: true,
      user: { id: session.user.id, name: session.user.name, /* ... */ },
      redirectTo,
    });
  } catch (error) {
    logger.error("Login error:", error);
    return NextResponse.json({ error: t?.("serverError") }, { status: 500 });
  }
}
```

## 登出实现

### 登出 API

登出端点简单但有效：

```typescript
// src/app/api/auth/logout/route.ts
import { NextResponse } from "next/server";
import { clearAuthCookie } from "@/lib/auth";

export async function POST() {
  await clearAuthCookie();
  return NextResponse.json({ ok: true });
}
```

### 用户菜单组件

登出按钮集成在用户菜单中：

```typescript
// src/app/[locale]/dashboard/_components/user-menu.tsx (lines 21-28)
const handleLogout = () => {
  // 立即导航以获得响应式用户体验
  router.push("/login");
  // 异步登出 API 调用（非阻塞）
  fetch("/api/auth/logout", { method: "POST" }).then(() => {
    router.refresh();
  });
};
```

**UX 考虑：**
- 立即导航到登录页面以获得感知性能
- 异步登出 API 调用（非阻塞）
- 登出后刷新页面以清除任何缓存状态

## 仪表板布局保护

仪表板布局在布局级别强制执行认证：

```typescript
// src/app/[locale]/dashboard/layout.tsx (lines 19-27)
const session = await getSession();

if (!session) {
  return redirect({ href: "/login?from=/dashboard", locale });
}

if (session.user.role !== "admin" && !session.key.canLoginWebUi) {
  return redirect({ href: "/my-usage", locale });
}
```

**保护流程：**
1. 检查有效会话（如果缺失则重定向到登录）
2. 检查用户角色（管理员绕过所有限制）
3. 检查 `canLoginWebUi` 权限（如果为 false 则重定向到 `/my-usage`）
4. 使用会话数据渲染仪表板

## 管理员令牌认证

系统支持特殊的管理员令牌认证机制，绕过数据库验证。通过 `ADMIN_TOKEN` 环境变量配置。

### 管理员令牌验证

当用户尝试使用管理员令牌登录时，系统创建合成用户和密钥对象：

```typescript
// src/lib/auth.ts (lines 28-68)
const adminToken = config.auth.adminToken;
if (adminToken && keyString === adminToken) {
  const now = new Date();
  const adminUser: User = {
    id: -1,
    name: "Admin Token",
    description: "Environment admin session",
    role: "admin",
    rpm: 0,
    dailyQuota: 0,
    providerGroup: null,
    isEnabled: true,
    expiresAt: null,
    dailyResetMode: "fixed",
    dailyResetTime: "00:00",
    createdAt: now,
    updatedAt: now,
  };

  const adminKey: Key = {
    id: -1,
    userId: adminUser.id,
    name: "ADMIN_TOKEN",
    key: keyString,
    isEnabled: true,
    canLoginWebUi: true, // 管理员始终具有 Web UI 访问权限
    providerGroup: null,
    limit5hUsd: null,
    limitDailyUsd: null,
    dailyResetMode: "fixed",
    dailyResetTime: "00:00",
    limitWeeklyUsd: null,
    limitMonthlyUsd: null,
    limitTotalUsd: null,
    limitConcurrentSessions: 0,
    cacheTtlPreference: null,
    createdAt: now,
    updatedAt: now,
  };

  return { user: adminUser, key: adminKey };
}
```

**管理员令牌特性：**
- 用户 ID：`-1`（表示合成管理员用户）
- 角色：`admin`（绕过所有权限检查）
- `canLoginWebUi`：始终为 `true`
- 不应用配额或限制
- 不需要数据库持久化

### 管理员令牌使用场景

1. **初始设置**：在创建任何数据库用户之前访问系统
2. **紧急恢复**：如果所有数据库用户被锁定，重新获得访问权限
3. **自动化部署**：无需创建用户即可进行基于脚本的配置
4. **测试**：用于开发和测试目的的快速访问

### 安全考虑

- 管理员令牌应该是强随机生成的字符串
- 永远不要将管理员令牌提交到版本控制
- 定期轮换令牌
- 对不同环境使用不同的令牌
- 考虑在初始设置后禁用生产环境的管理员令牌

## 会话状态管理

### 会话接口

认证会话结合用户和密钥信息：

```typescript
// src/lib/auth.ts (lines 12-15)
export interface AuthSession {
  user: User;
  key: Key;
}
```

### 会话检索

`getSession` 函数从请求中检索当前会话：

```typescript
// src/lib/auth.ts (lines 116-128)
export async function getSession(options?: {
  allowReadOnlyAccess?: boolean;
}): Promise<AuthSession | null> {
  const keyString = await getAuthToken();
  if (!keyString) {
    return null;
  }

  return validateKey(keyString, options);
}
```

**会话检索流程：**
1. 从 Cookie 或 Authorization 请求头提取认证令牌
2. 如果没有找到令牌，返回 `null`
3. 针对数据库或管理员令牌验证密钥
4. 返回会话对象，如果无效则返回 `null`

### 组件中的会话使用

仪表板组件通过 props 接收会话：

```typescript
// src/app/[locale]/dashboard/layout.tsx
import { getSession } from "@/lib/auth";
import { DashboardHeader } from "./_components/dashboard-header";

export default async function DashboardLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const session = await getSession();

  if (!session) {
    return redirect({ href: "/login?from=/dashboard", locale });
  }

  return (
    <div className="min-h-screen bg-background">
      <DashboardHeader session={session} />
      <DashboardMain>{children}</DashboardMain>
    </div>
  );
}
```

会话然后传递给子组件如 `DashboardHeader`，显示用户信息和登出按钮。

## 只读访问模式

### 目的

只读访问模式允许 API-only 密钥访问 `/my-usage` 页面进行自助用量监控，而无需授予完整的仪表板访问权限。

### 实现

验证函数中的 `allowReadOnlyAccess` 选项启用此行为：

```typescript
// src/lib/auth.ts (lines 17-26)
export async function validateKey(
  keyString: string,
  options?: {
    /**
     * 允许仅访问只读页面（如 my-usage），跳过 canLoginWebUi 校验
     */
    allowReadOnlyAccess?: boolean;
  }
): Promise<AuthSession | null> {
  const allowReadOnlyAccess = options?.allowReadOnlyAccess ?? false;
  // ... 验证逻辑
}
```

### My-Usage 布局保护

`/my-usage` 页面有自己的布局保护，与仪表板逻辑相反：

```typescript
// src/app/[locale]/my-usage/layout.tsx (lines 13-21)
const session = await getSession({ allowReadOnlyAccess: true });

if (!session) {
  return redirect({ href: "/login?from=/my-usage", locale });
}

if (session.user.role === "admin" || session.key.canLoginWebUi) {
  return redirect({ href: "/dashboard", locale });
}
```

**关键行为：**
- 未认证用户 -> 重定向到 `/login?from=/my-usage`
- 管理员用户 -> 重定向到 `/dashboard`（他们不使用 my-usage）
- `canLoginWebUi=true` 的用户 -> 重定向到 `/dashboard`
- 只有 `canLoginWebUi=false` 的用户才被允许访问 my-usage

## Bearer Token 解析

系统支持使用 Bearer 方案从 Authorization 请求头提取 API 密钥：

```typescript
// src/lib/auth.ts (lines 130-137)
function parseBearerToken(raw: string | null | undefined): string | undefined {
  const trimmed = raw?.trim();
  if (!trimmed) return undefined;

  const match = /^Bearer\s+(.+)$/i.exec(trimmed);
  const token = match?.[1]?.trim();
  return token || undefined;
}
```

**解析规则：**
- 不区分大小写匹配 "Bearer" 前缀
- "Bearer" 后允许任意空白字符
- 修剪令牌的空白字符
- 如果没有找到有效的 Bearer 令牌则返回 `undefined`

**使用示例：**
```bash
curl -H "Authorization: Bearer sk-xxxxxxxx" https://api.example.com/my-usage
```

## 边缘情况和错误处理

### 1. HTTP 访问警告

当通过 HTTP（非本地主机）访问时，登录页面显示安全警告，因为浏览器可能拒绝 HTTP 上的 `Secure` Cookie：

**解决方案：**
1. 使用 HTTPS（生产环境推荐）
2. 在 `.env` 中设置 `ENABLE_SECURE_COOKIES=false`（降低安全性，适合本地开发）

### 2. 过期密钥

`expiresAt` 在过去的关键字在验证期间自动被拒绝。用户必须联系管理员续订密钥。

### 3. 禁用密钥

`isEnabled = false` 的密钥无法认证。这允许管理员暂时禁用访问而无需删除密钥。

### 4. 软删除密钥

设置了 `deletedAt` 的密钥（软删除）在验证期间被视为不存在。

### 5. 缺失用户

如果密钥引用不存在的用户（数据完整性问题），认证失败并返回空会话。

### 6. 无效 Cookie 删除

如果用户呈现无效/过期的 Cookie，中间件在重定向到登录之前清除它：

```typescript
// src/proxy.ts (lines 84-94)
const session = await validateKey(authToken.value, { allowReadOnlyAccess: isReadOnlyPath });
if (!session) {
  const url = request.nextUrl.clone();
  url.pathname = `/${locale}/login`;
  url.searchParams.set("from", pathWithoutLocale || "/dashboard");
  const response = NextResponse.redirect(url);
  response.cookies.delete("auth-token"); // 清除无效 Cookie
  return response;
}
```

### 7. 区域设置保留

登录流程保留用户的区域设置：
1. 中间件从 URL 路径检测区域设置
2. 重定向到登录时，区域设置包含在路径中（`/[locale]/login`）
3. 登录页面以检测到的区域设置显示
4. 登录后重定向保持区域设置

## 安全考虑

### 1. XSS 保护

- Cookie 是 HTTP-only（JavaScript 无法访问它们）
- 敏感数据不存储在 localStorage/sessionStorage 中
- API 密钥永远不会被记录

### 2. CSRF 保护

- `SameSite=lax` Cookie 属性防止跨站请求伪造
- 没有通过 GET 请求进行状态更改的操作

### 3. 会话固定

- 每次登录新的 Cookie 值（密钥字符串是 Cookie 值）
- 登出时清除 Cookie

### 4. 暴力破解保护

虽然登录端点没有明确的速率限制，但系统受益于：
- API Key 长度（通常 30+ 字符）
- 数据库查询开销（自然速率限制）
- 没有时间攻击漏洞（随机密钥不需要恒定时间比较）

### 5. HTTPS 强制执行

生产环境部署应该：
- 使用 HTTPS
- 设置 `ENABLE_SECURE_COOKIES=true`（默认）
- 在反向代理级别配置 HSTS 请求头

## 相关文件

{% table %}
| 文件 | 用途 |
|------|------|
| `src/lib/auth.ts` | 核心认证逻辑、Cookie 管理、会话验证 |
| `src/proxy.ts` | 用于路由保护和认证的 Next.js 中间件 |
| `src/app/api/auth/login/route.ts` | 登录 API 端点 |
| `src/app/api/auth/logout/route.ts` | 登出 API 端点 |
| `src/app/[locale]/login/page.tsx` | 登录页面 UI 组件 |
| `src/app/[locale]/dashboard/layout.tsx` | 带认证保护的仪表板布局 |
| `src/app/[locale]/my-usage/layout.tsx` | 带只读访问的 My-usage 布局 |
| `src/repository/key.ts` | 密钥数据库查询，包括 `findActiveKeyByKeyString` |
| `src/drizzle/schema.ts` | 数据库模式定义 |
| `src/lib/config/env.schema.ts` | 环境变量验证 |
| `messages/zh-CN/auth.json` | 认证 UI 的中文翻译 |
| `messages/en/auth.json` | 认证 UI 的英文翻译 |
{% /table %}

## 故障排除

### 无法登录

1. **检查 API Key 是否有效**：确保密钥未过期、已启用且未删除
2. **检查 `canLoginWebUi` 权限**：验证密钥具有 Web UI 登录权限
3. **检查 HTTP 警告**：如果在 HTTP 上访问，考虑启用 `ENABLE_SECURE_COOKIES=false` 或使用 HTTPS
4. **检查浏览器 Cookie 设置**：确保浏览器接受第三方 Cookie（如果使用 iframe）

### 重定向循环

如果看到登录和仪表板之间的重定向循环：
1. 清除浏览器 Cookie
2. 检查 `canLoginWebUi` 权限设置
3. 验证中间件配置

### 管理员令牌不工作

1. 验证 `ADMIN_TOKEN` 环境变量已设置且不为 "change-me"
2. 确保令牌与输入完全匹配
3. 检查服务器日志中的验证错误
