# Web UI 登录控制

## Intent Analysis

The Web UI login control system in Claude Code Hub provides secure authentication for accessing the web-based management interface. Unlike traditional username/password authentication, the system uses API Keys as the primary credential, offering a unified authentication mechanism that works across both the Web UI and API access. The design intent focuses on:

1. **Unified Authentication**: Using API Keys instead of separate credentials simplifies the authentication model and reduces credential management overhead.
2. **Granular Access Control**: The `canLoginWebUi` permission on keys allows fine-grained control over which keys can access the Web UI versus API-only access.
3. **Secure Session Management**: HTTP-only cookies with configurable security settings ensure session tokens are protected from XSS attacks.
4. **Read-Only Access Mode**: Keys without Web UI login permission can still access the `/my-usage` page for self-service usage monitoring.
5. **Admin Token Bypass**: Environment-based admin tokens provide emergency access without database dependencies.

## Behavior Summary

### Login Flow Overview

The login process follows this sequence:

1. **User Access**: User visits `/login` page (localized as `/[locale]/login`)
2. **Credential Input**: User enters their API Key in the login form
3. **Validation**: Frontend submits to `/api/auth/login` endpoint
4. **Key Verification**: Server validates key existence, enabled status, and expiration
5. **Session Creation**: Upon successful validation, server sets `auth-token` HTTP-only cookie
6. **Redirect**: User is redirected to appropriate dashboard based on role and permissions

### Authentication Methods

The system supports two primary authentication mechanisms:

#### 1. Cookie-Based Authentication (Web UI)

Used for browser-based access to the Web UI. The `auth-token` cookie is:
- **HTTP-only**: Prevents JavaScript access to mitigate XSS attacks
- **Secure**: Configurable via `ENABLE_SECURE_COOKIES` environment variable
- **SameSite=Lax**: Provides CSRF protection while allowing normal navigation
- **7-day expiration**: Balances security with user convenience

```typescript
// From /Users/ding/Github/claude-code-hub/src/lib/auth.ts (lines 94-104)
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

#### 2. Bearer Token Authentication (API/Read-Only)

For programmatic access or when cookies aren't available, the system accepts:
- `Authorization: Bearer <api-key>` header
- This is primarily used for read-only API endpoints like `/my-usage`

```typescript
// From /Users/ding/Github/claude-code-hub/src/lib/auth.ts (lines 139-147)
async function getAuthToken(): Promise<string | undefined> {
  // Priority: Cookie first (Web UI compatibility)
  const cookieToken = await getAuthCookie();
  if (cookieToken) return cookieToken;

  // Fallback: Authorization header for programmatic access
  const headersStore = await headers();
  return parseBearerToken(headersStore.get("authorization"));
}
```

### Permission-Based Access Control

The system implements a three-tier access model:

#### 1. Admin Users
- Role: `admin` in the users table
- Access: Full access to all pages and features
- Bypass: All permission checks including `canLoginWebUi`

#### 2. Standard Users (canLoginWebUi=true)
- Keys with `canLoginWebUi` permission enabled
- Access: Full dashboard access (`/dashboard` and sub-pages)
- Can: Manage their own usage, view statistics

#### 3. API-Only Users (canLoginWebUi=false)
- Keys without Web UI login permission
- Access: Limited to `/my-usage` read-only page
- Cannot: Access dashboard or management features

```typescript
// From /Users/ding/Github/claude-code-hub/src/lib/auth.ts (lines 88-92)
export function getLoginRedirectTarget(session: AuthSession): string {
  if (session.user.role === "admin") return "/dashboard";
  if (session.key.canLoginWebUi) return "/dashboard";
  return "/my-usage";
}
```

### Middleware Protection

The Next.js middleware (`/Users/ding/Github/claude-code-hub/src/proxy.ts`) enforces authentication on all routes:

```typescript
// From /Users/ding/Github/claude-code-hub/src/proxy.ts (lines 9-15)
// Public paths that don't require authentication
const PUBLIC_PATH_PATTERNS = ["/login", "/usage-doc", "/api/auth/login", "/api/auth/logout"];

// Paths that allow read-only access (for canLoginWebUi=false keys)
const READ_ONLY_PATH_PATTERNS = ["/my-usage"];
```

**Middleware Logic:**
1. Skip authentication for `/v1/*` API routes (they use their own auth)
2. Skip authentication for public paths
3. For protected paths, check `auth-token` cookie
4. If no cookie, redirect to login with `?from=` parameter
5. If cookie exists, validate key permissions
6. If key lacks `canLoginWebUi` and path isn't read-only, redirect to `/my-usage`

## Configuration

### Environment Variables

Authentication behavior is controlled through environment variables defined in `/Users/ding/Github/claude-code-hub/src/lib/config/env.schema.ts`:

| Variable | Default | Description |
|----------|---------|-------------|
| `ADMIN_TOKEN` | undefined | Master admin token for emergency access |
| `ENABLE_SECURE_COOKIES` | `true` | Sets `Secure` flag on cookies (requires HTTPS) |
| `SESSION_TTL` | `300` | Session TTL in seconds (5 minutes) for Redis tracking |

```typescript
// From /Users/ding/Github/claude-code-hub/src/lib/config/env.schema.ts (lines 81-96)
ADMIN_TOKEN: z.preprocess((val) => {
  if (!val || typeof val !== "string") return undefined;
  if (val === "change-me") return undefined;
  return val;
}, z.string().min(1, "管理员令牌不能为空").optional()),
ENABLE_SECURE_COOKIES: z.string().default("true").transform(booleanTransform),
SESSION_TTL: z.coerce.number().default(300),
```

### Database Schema

The `canLoginWebUi` permission is stored in the keys table:

```typescript
// From /Users/ding/Github/claude-code-hub/src/drizzle/schema.ts (lines 91-130)
export const keys = pgTable('keys', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull(),
  key: varchar('key').notNull(),
  name: varchar('name').notNull(),
  isEnabled: boolean('is_enabled').default(true),
  expiresAt: timestamp('expires_at', { withTimezone: true }),

  // Web UI 登录权限控制
  canLoginWebUi: boolean('can_login_web_ui').default(false),
  // ... other fields
});
```

**Note**: While the database defaults to `false`, the transformer in `/Users/ding/Github/claude-code-hub/src/repository/_shared/transformers.ts` defaults to `true` for backward compatibility:

```typescript
canLoginWebUi: dbKey?.canLoginWebUi ?? true,
```

### Cookie Configuration

The auth cookie is configured with security best practices:

```typescript
// From /Users/ding/Github/claude-code-hub/src/lib/auth.ts (lines 9-10)
const AUTH_COOKIE_NAME = "auth-token";
const AUTH_COOKIE_MAX_AGE = 60 * 60 * 24 * 7; // 7 days
```

**Cookie Attributes:**
- `httpOnly: true` - Prevents XSS attacks
- `secure: env.ENABLE_SECURE_COOKIES` - HTTPS-only in production
- `sameSite: "lax"` - CSRF protection
- `maxAge: 604800` - 7 days
- `path: "/"` - Available site-wide

## Key Validation Logic

### Key Validation Process

The `validateKey` function in `/Users/ding/Github/claude-code-hub/src/lib/auth.ts` performs comprehensive validation:

```typescript
// From /Users/ding/Github/claude-code-hub/src/lib/auth.ts (lines 17-86)
export async function validateKey(
  keyString: string,
  options?: { allowReadOnlyAccess?: boolean }
): Promise<AuthSession | null> {
  const allowReadOnlyAccess = options?.allowReadOnlyAccess ?? false;

  // 1. Check for Admin Token
  const adminToken = config.auth.adminToken;
  if (adminToken && keyString === adminToken) {
    // Return synthetic admin user and key
    return { user: adminUser, key: adminKey };
  }

  // 2. Query database for active key
  const key = await findActiveKeyByKeyString(keyString);
  if (!key) return null;

  // 3. Check Web UI login permission
  if (!allowReadOnlyAccess && !key.canLoginWebUi) {
    return null;
  }

  // 4. Load user data
  const user = await findUserById(key.userId);
  if (!user) return null;

  return { user, key };
}
```

### Active Key Criteria

The `findActiveKeyByKeyString` function in `/Users/ding/Github/claude-code-hub/src/repository/key.ts` validates:

```typescript
// From /Users/ding/Github/claude-code-hub/src/repository/key.ts (lines 402-437)
export async function findActiveKeyByKeyString(keyString: string): Promise<Key | null> {
  const [key] = await db
    .select({ /* ... */ })
    .from(keys)
    .where(
      and(
        eq(keys.key, keyString),        // Exact key match
        isNull(keys.deletedAt),         // Not soft-deleted
        eq(keys.isEnabled, true),       // Key is enabled
        or(
          isNull(keys.expiresAt),       // No expiration OR
          gt(keys.expiresAt, new Date()) // Not expired
        )
      )
    );
  // ...
}
```

**Validation Criteria:**
1. Key string must match exactly
2. Key must not be soft-deleted (`deletedAt IS NULL`)
3. Key must be enabled (`isEnabled = true`)
4. Key must not be expired (`expiresAt IS NULL` or `expiresAt > now()`)

## Login Page Implementation

### Frontend Component

The login page at `/Users/ding/Github/claude-code-hub/src/app/[locale]/login/page.tsx` provides a polished user experience:

**Key Features:**
1. **HTTP Security Warning**: Detects non-localhost HTTP access and warns about cookie security
2. **Form Validation**: Client-side validation requiring non-empty API key
3. **Loading States**: Visual feedback during authentication
4. **Error Display**: Server error messages displayed in Alert component
5. **Redirect Handling**: Preserves `?from=` parameter for post-login navigation

```typescript
// From /Users/ding/Github/claude-code-hub/src/app/[locale]/login/page.tsx (lines 34-42)
// Detect HTTP (non-localhost) for security warning
useEffect(() => {
  if (typeof window !== "undefined") {
    const isHttp = window.location.protocol === "http:";
    const isLocalhost =
      window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
    setShowHttpWarning(isHttp && !isLocalhost);
  }
}, []);
```

**Login Submission Handler:**

```typescript
// From /Users/ding/Github/claude-code-hub/src/app/[locale]/login/page.tsx (lines 44-72)
const handleSubmit = async (e: React.FormEvent) => {
  e.preventDefault();
  setError("");
  setLoading(true);

  try {
    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: apiKey }),
    });

    const data = await response.json();

    if (!response.ok) {
      setError(data.error || t("errors.loginFailed"));
      return;
    }

    // Redirect to server-specified target or original page
    const redirectTarget = data.redirectTo || from;
    router.push(redirectTarget);
    router.refresh();
  } catch {
    setError(t("errors.networkError"));
  } finally {
    setLoading(false);
  }
};
```

### Login API Endpoint

The login API at `/Users/ding/Github/claude-code-hub/src/app/api/auth/login/route.ts`:

```typescript
// From /Users/ding/Github/claude-code-hub/src/app/api/auth/login/route.ts (lines 55-91)
export async function POST(request: NextRequest) {
  const locale = getLocaleFromRequest(request);
  const t = await getAuthErrorTranslations(locale);

  try {
    const { key } = await request.json();

    if (!key) {
      return NextResponse.json({ error: t?.("apiKeyRequired") }, { status: 400 });
    }

    // Validate with read-only access allowed (for my-usage page users)
    const session = await validateKey(key, { allowReadOnlyAccess: true });
    if (!session) {
      return NextResponse.json({ error: t?.("apiKeyInvalidOrExpired") }, { status: 401 });
    }

    // Set auth cookie
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

## Logout Implementation

### Logout API

The logout endpoint at `/Users/ding/Github/claude-code-hub/src/app/api/auth/logout/route.ts` is simple but effective:

```typescript
// From /Users/ding/Github/claude-code-hub/src/app/api/auth/logout/route.ts
import { NextResponse } from "next/server";
import { clearAuthCookie } from "@/lib/auth";

export async function POST() {
  await clearAuthCookie();
  return NextResponse.json({ ok: true });
}
```

### User Menu Component

The logout button is integrated into the user menu at `/Users/ding/Github/claude-code-hub/src/app/[locale]/dashboard/_components/user-menu.tsx`:

```typescript
// From /Users/ding/Github/claude-code-hub/src/app/[locale]/dashboard/_components/user-menu.tsx (lines 21-28)
const handleLogout = () => {
  // Navigate immediately for responsive UX
  router.push("/login");
  // Async logout call (non-blocking)
  fetch("/api/auth/logout", { method: "POST" }).then(() => {
    router.refresh();
  });
};
```

**UX Considerations:**
- Immediate navigation to login page for perceived performance
- Asynchronous logout API call (non-blocking)
- Page refresh after logout to clear any cached state

## Dashboard Layout Protection

The dashboard layout enforces authentication at the layout level:

```typescript
// From /Users/ding/Github/claude-code-hub/src/app/[locale]/dashboard/layout.tsx (lines 19-27)
const session = await getSession();

if (!session) {
  return redirect({ href: "/login?from=/dashboard", locale });
}

if (session.user.role !== "admin" && !session.key.canLoginWebUi) {
  return redirect({ href: "/my-usage", locale });
}
```

**Protection Flow:**
1. Check for valid session (redirect to login if missing)
2. Check user role (admin bypasses all restrictions)
3. Check `canLoginWebUi` permission (redirect to `/my-usage` if false)
4. Render dashboard with session data

## Admin Token Authentication

The system supports a special admin token authentication mechanism that bypasses database validation. This is configured via the `ADMIN_TOKEN` environment variable.

### Admin Token Validation

When a user attempts to log in with the admin token, the system creates synthetic user and key objects:

```typescript
// From /Users/ding/Github/claude-code-hub/src/lib/auth.ts (lines 28-68)
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
    canLoginWebUi: true, // Admin always has Web UI access
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

**Admin Token Characteristics:**
- User ID: `-1` (indicates synthetic admin user)
- Role: `admin` (bypasses all permission checks)
- `canLoginWebUi`: Always `true`
- No quotas or limits applied
- No database persistence required

### Use Cases for Admin Token

1. **Initial Setup**: Access the system before creating any database users
2. **Emergency Recovery**: Regain access if all database users are locked out
3. **Automated Deployment**: Script-based configuration without user creation
4. **Testing**: Quick access for development and testing purposes

### Security Considerations

- The admin token should be a strong, randomly generated string
- Never commit the admin token to version control
- Rotate the token periodically
- Use different tokens for different environments
- Consider disabling admin token in production after initial setup

## Session State Management

### Session Interface

The auth session combines user and key information:

```typescript
// From /Users/ding/Github/claude-code-hub/src/lib/auth.ts (lines 12-15)
export interface AuthSession {
  user: User;
  key: Key;
}
```

### Session Retrieval

The `getSession` function retrieves the current session from the request:

```typescript
// From /Users/ding/Github/claude-code-hub/src/lib/auth.ts (lines 116-128)
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

**Session Retrieval Flow:**
1. Extract auth token from cookie or Authorization header
2. If no token found, return `null`
3. Validate the key against database or admin token
4. Return session object or `null` if invalid

### Session Usage in Components

Dashboard components receive the session via props:

```typescript
// From /Users/ding/Github/claude-code-hub/src/app/[locale]/dashboard/layout.tsx
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

The session is then passed to child components like `DashboardHeader` which displays user information and the logout button.

## Read-Only Access Mode

### Purpose

The read-only access mode allows API-only keys to access the `/my-usage` page for self-service usage monitoring without granting full dashboard access.

### Implementation

The `allowReadOnlyAccess` option in validation functions enables this behavior:

```typescript
// From /Users/ding/Github/claude-code-hub/src/lib/auth.ts (lines 17-25)
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
  // ... validation logic
}
```

### Middleware Handling

The middleware identifies read-only paths and passes the flag to validation:

```typescript
// From /Users/ding/Github/claude-code-hub/src/proxy.ts (lines 64-67)
const isReadOnlyPath = READ_ONLY_PATH_PATTERNS.some(
  (pattern) => pathWithoutLocale === pattern || pathWithoutLocale.startsWith(`${pattern}/`)
);

// Lines 82-83: Pass the read-only flag to validation
const session = await validateKey(authToken.value, { allowReadOnlyAccess: isReadOnlyPath });
```

### Login API Behavior

The login endpoint always allows read-only access validation so that API-only keys can still log in:

```typescript
// From /Users/ding/Github/claude-code-hub/src/app/api/auth/login/route.ts (line 66)
const session = await validateKey(key, { allowReadOnlyAccess: true });
```

After login, the user is redirected based on their permissions:
- Admin or `canLoginWebUi=true` → `/dashboard`
- `canLoginWebUi=false` → `/my-usage`

## Bearer Token Parsing

The system supports extracting API keys from the Authorization header using the Bearer scheme:

```typescript
// From /Users/ding/Github/claude-code-hub/src/lib/auth.ts (lines 130-137)
function parseBearerToken(raw: string | null | undefined): string | undefined {
  const trimmed = raw?.trim();
  if (!trimmed) return undefined;

  const match = /^Bearer\s+(.+)$/i.exec(trimmed);
  const token = match?.[1]?.trim();
  return token || undefined;
}
```

**Parsing Rules:**
- Case-insensitive match for "Bearer" prefix
- Allows arbitrary whitespace after "Bearer"
- Trims whitespace from the token
- Returns `undefined` if no valid Bearer token found

**Usage Example:**
```bash
curl -H "Authorization: Bearer sk-xxxxxxxx" https://api.example.com/my-usage
```

## Internationalization

Login-related translations are stored in `/Users/ding/Github/claude-code-hub/messages/zh-CN/auth.json`:

```json
{
  "errors": {
    "loginFailed": "登录失败",
    "networkError": "网络错误，请稍后重试",
    "apiKeyRequired": "请输入 API Key",
    "apiKeyInvalidOrExpired": "API Key 无效或已过期",
    "serverError": "登录失败，请稍后重试"
  },
  "security": {
    "cookieWarningTitle": "Cookie 安全警告",
    "cookieWarningDescription": "您正在使用 HTTP 访问系统，浏览器安全策略可能阻止 Cookie 设置导致登录失败。",
    "solutionTitle": "解决方案：",
    "useHttps": "使用 HTTPS 访问（推荐）",
    "disableSecureCookies": "在 .env 中设置 ENABLE_SECURE_COOKIES=false（会降低安全性）"
  }
}
```

## Edge Cases and Error Handling

### 1. HTTP Access Warning

When accessing via HTTP (non-localhost), the login page displays a security warning because browsers may reject `Secure` cookies over HTTP:

**Solutions:**
1. Use HTTPS (recommended for production)
2. Set `ENABLE_SECURE_COOKIES=false` in `.env` (reduces security, suitable for local development)

### 2. Expired Keys

Keys with `expiresAt` in the past are automatically rejected during validation. Users must contact an admin to renew their key.

### 3. Disabled Keys

Keys with `isEnabled = false` cannot authenticate. This allows admins to temporarily disable access without deleting the key.

### 4. Soft-Deleted Keys

Keys with `deletedAt` set (soft delete) are treated as non-existent during validation.

### 5. Missing User

If a key references a non-existent user (data integrity issue), authentication fails with a null session.

### 6. Admin Token Fallback

The `ADMIN_TOKEN` environment variable provides emergency access:
- Bypasses database validation
- Creates synthetic admin user on-the-fly
- Useful for initial setup or database recovery scenarios

### 7. Read-Only Access Edge Case

Keys with `canLoginWebUi = false` can still:
- Access `/my-usage` page via cookie auth
- Access `/my-usage` page via `Authorization: Bearer <key>` header
- Cannot access any dashboard pages

### 8. Concurrent Session Handling

While the Web UI doesn't explicitly limit concurrent sessions, API requests are subject to:
- Key-level concurrent session limits (`limitConcurrentSessions`)
- User-level concurrent session limits

These are enforced in the proxy rate limit guard, not during Web UI login.

### 9. Cookie Deletion on Invalid Key

If a user presents an invalid/expired cookie, the middleware clears it before redirecting to login:

```typescript
// From /Users/ding/Github/claude-code-hub/src/proxy.ts (lines 84-94)
const session = await validateKey(authToken.value, { allowReadOnlyAccess: isReadOnlyPath });
if (!session) {
  const url = request.nextUrl.clone();
  url.pathname = `/${locale}/login`;
  url.searchParams.set("from", pathWithoutLocale || "/dashboard");
  const response = NextResponse.redirect(url);
  response.cookies.delete("auth-token"); // Clear invalid cookie
  return response;
}
```

### 10. Locale Preservation

The login flow preserves the user's locale:
1. Middleware detects locale from URL path
2. On redirect to login, locale is included in the path (`/[locale]/login`)
3. Login page displays in the detected locale
4. Post-login redirect maintains the locale

## Security Considerations

### 1. XSS Protection

- Cookies are HTTP-only (JavaScript cannot access them)
- No sensitive data stored in localStorage/sessionStorage
- API keys are never logged

### 2. CSRF Protection

- `SameSite=lax` cookie attribute prevents cross-site request forgery
- No state-changing operations via GET requests

### 3. Session Fixation

- New cookie value on each login (key string is the cookie value)
- Cookie cleared on logout

### 4. Brute Force Protection

While there's no explicit rate limiting on the login endpoint, the system benefits from:
- API Key length (typically 30+ characters)
- Database query overhead (natural rate limiting)
- No timing attack vulnerabilities (constant-time comparison not needed for random keys)

### 5. HTTPS Enforcement

Production deployments should:
- Use HTTPS
- Set `ENABLE_SECURE_COOKIES=true` (default)
- Configure HSTS headers at the reverse proxy level

## References

### Core Files

| File | Purpose |
|------|---------|
| `/Users/ding/Github/claude-code-hub/src/lib/auth.ts` | Core authentication logic, cookie management, session validation |
| `/Users/ding/Github/claude-code-hub/src/proxy.ts` | Next.js middleware for route protection and authentication |
| `/Users/ding/Github/claude-code-hub/src/app/api/auth/login/route.ts` | Login API endpoint |
| `/Users/ding/Github/claude-code-hub/src/app/api/auth/logout/route.ts` | Logout API endpoint |
| `/Users/ding/Github/claude-code-hub/src/app/[locale]/login/page.tsx` | Login page UI component |
| `/Users/ding/Github/claude-code-hub/src/repository/key.ts` | Key database queries including `findActiveKeyByKeyString` |
| `/Users/ding/Github/claude-code-hub/src/repository/user.ts` | User database queries |
| `/Users/ding/Github/claude-code-hub/src/drizzle/schema.ts` | Database schema definitions |
| `/Users/ding/Github/claude-code-hub/src/lib/config/env.schema.ts` | Environment variable validation |
| `/Users/ding/Github/claude-code-hub/messages/zh-CN/auth.json` | Chinese translations for auth UI |
| `/Users/ding/Github/claude-code-hub/messages/en/auth.json` | English translations for auth UI |

### Related Documentation

- `/Users/ding/Github/claude-code-hub/docs/api-authentication-guide.md` - API authentication guide covering both Web UI and programmatic access
- `/Users/ding/Github/claude-code-hub/README.md` - Project README with setup instructions

### Test Files

- `/Users/ding/Github/claude-code-hub/tests/integration/auth.test.ts` - Integration tests for authentication flows
- `/Users/ding/Github/claude-code-hub/tests/api/api-endpoints.test.ts` - API endpoint authentication tests

---

*This documentation was generated by exploring the actual claude-code-hub codebase at `/Users/ding/Github/claude-code-hub/` to ensure accuracy and completeness.*
