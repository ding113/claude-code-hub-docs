# Round 1 Exploration Draft: i18n 多语言支持

## Intent Analysis

Claude Code Hub implements a comprehensive internationalization (i18n) system using `next-intl` to support multiple languages across its web interface. The system is designed to:

1. **Support 5 locales**: Simplified Chinese (zh-CN, canonical), Traditional Chinese (zh-TW), English (en), Russian (ru), and Japanese (ja)
2. **Provide seamless locale switching**: Users can switch languages while maintaining their current page context
3. **Ensure type safety**: Full TypeScript support for locale types and translation keys
4. **Maintain translation quality**: Automated scripts to audit and synchronize translations across locales
5. **Integrate with authentication**: Locale persistence through cookies and redirects that preserve locale context

The i18n system is deeply integrated into the Next.js 15 App Router architecture, using dynamic route segments (`[locale]`) and middleware-based locale detection.

---

## Behavior Summary

### Supported Locales

The application supports 5 locales with the following configuration:

| Locale Code | Native Name | English Name | Status |
|-------------|-------------|--------------|--------|
| zh-CN | 简体中文 | Chinese (Simplified) | Canonical (default) |
| zh-TW | 繁体中文 | Chinese (Traditional) | Supported |
| en | English | English | Supported |
| ru | Русский | Russian | Supported |
| ja | 日本語 | Japanese | Supported |

**Source**: `/Users/ding/Github/claude-code-hub/src/i18n/config.ts`

```typescript
// Supported locales in the application
export const locales = ["zh-CN", "zh-TW", "en", "ru", "ja"] as const;

// TypeScript type for locale
export type Locale = (typeof locales)[number];

// Default locale (Chinese Simplified)
export const defaultLocale: Locale = "zh-CN";

// Locale labels for language switcher UI
export const localeLabels: Record<Locale, string> = {
  "zh-CN": "简体中文",
  "zh-TW": "繁体中文",
  en: "English",
  ru: "Русский",
  ja: "日本語",
};
```

### Locale Detection Strategy

The system uses a three-tier fallback strategy for locale detection:

1. **NEXT_LOCALE cookie** - User's persisted preference (1 year expiry)
2. **Accept-Language header** - Browser's preferred language
3. **Default locale** - zh-CN as final fallback

**Source**: `/Users/ding/Github/claude-code-hub/src/i18n/routing.ts`

```typescript
export const routing = defineRouting({
  locales,
  defaultLocale,
  localePrefix: "always",  // All routes include locale prefix
  localeCookie: {
    name: "NEXT_LOCALE",
    maxAge: 365 * 24 * 60 * 60,  // 1 year
    path: "/",
    sameSite: "lax",
  },
});
```

### Routing Strategy

The application uses an "always-prefix" strategy where all routes include the locale prefix:

- `/zh-CN/dashboard` - Chinese Simplified
- `/en/dashboard` - English
- `/ja/settings` - Japanese

This is enforced by the `localePrefix: "always"` configuration in the routing setup.

### Translation Namespaces

Translations are organized into namespaces by feature area:

| Namespace | Purpose | File Location |
|-----------|---------|---------------|
| auth | Login/logout, authentication | `messages/<locale>/auth.json` |
| common | Shared UI elements (buttons, actions) | `messages/<locale>/common.json` |
| dashboard | Main dashboard UI | `messages/<locale>/dashboard.json` |
| errors | Error messages with placeholders | `messages/<locale>/errors.json` |
| forms | Form validation messages | `messages/<locale>/forms.json` |
| myUsage | User usage statistics | `messages/<locale>/myUsage.json` |
| notifications | Toast/notification messages | `messages/<locale>/notifications.json` |
| provider-chain | Provider decision chain UI | `messages/<locale>/provider-chain.json` |
| providers | Provider type definitions | `messages/<locale>/providers.json` |
| quota | Quota management | `messages/<locale>/quota.json` |
| settings | Settings UI (split structure) | `messages/<locale>/settings/` |
| ui | UI components | `messages/<locale>/ui.json` |
| usage | Usage documentation | `messages/<locale>/usage.json` |
| users | User management | `messages/<locale>/users.json` |
| validation | Form validation rules | `messages/<locale>/validation.json` |

---

## Configuration & Commands

### Core i18n Configuration Files

#### 1. Locale Configuration (`/Users/ding/Github/claude-code-hub/src/i18n/config.ts`)

Defines supported locales, default locale, and locale labels:

```typescript
/**
 * i18n Configuration
 * Defines supported locales and default locale for the application
 */

// Supported locales in the application
export const locales = ["zh-CN", "zh-TW", "en", "ru", "ja"] as const;

// TypeScript type for locale
export type Locale = (typeof locales)[number];

// Default locale (Chinese Simplified)
export const defaultLocale: Locale = "zh-CN";

// Locale labels for language switcher UI
export const localeLabels: Record<Locale, string> = {
  "zh-CN": "简体中文",
  "zh-TW": "繁体中文",
  en: "English",
  ru: "Русский",
  ja: "日本語",
};

// Locale names in English (for metadata, SEO)
export const localeNamesInEnglish: Record<Locale, string> = {
  "zh-CN": "Chinese (Simplified)",
  "zh-TW": "Chinese (Traditional)",
  en: "English",
  ru: "Russian",
  ja: "Japanese",
};
```

#### 2. Routing Configuration (`/Users/ding/Github/claude-code-hub/src/i18n/routing.ts`)

Configures locale routing and provides navigation utilities:

```typescript
/**
 * i18n Routing Configuration
 * Configures locale routing and provides type-safe navigation utilities
 */

import { createNavigation } from "next-intl/navigation";
import { defineRouting } from "next-intl/routing";
import { defaultLocale, locales } from "./config";

// Define routing configuration for next-intl
export const routing = defineRouting({
  // All supported locales
  locales,

  // Default locale (used when no locale prefix is present)
  defaultLocale,

  // Locale detection strategy:
  // 1. Check locale cookie (NEXT_LOCALE)
  // 2. Check Accept-Language header
  // 3. Fall back to default locale
  localePrefix: "always",

  // Locale cookie configuration
  localeCookie: {
    name: "NEXT_LOCALE",
    // Cookie expires in 1 year
    maxAge: 365 * 24 * 60 * 60,
    // Available across the entire site
    path: "/",
    // SameSite to prevent CSRF
    sameSite: "lax",
  },
});

// Type-safe navigation utilities
// These replace Next.js's default Link, redirect, useRouter, usePathname
// with locale-aware versions that automatically prepend the locale prefix
export const { Link, redirect, useRouter, usePathname } = createNavigation(routing);

// Re-export routing type for use in other files
export type Routing = typeof routing;
```

#### 3. Request Configuration (`/Users/ding/Github/claude-code-hub/src/i18n/request.ts`)

Configures how translations are loaded for each request:

```typescript
/**
 * i18n Request Configuration
 * Configures how translations are loaded for each request
 */

import { getRequestConfig } from "next-intl/server";
import { resolveSystemTimezone } from "@/lib/utils/timezone";
import type { Locale } from "./config";
import { routing } from "./routing";

export default getRequestConfig(async ({ requestLocale }) => {
  // This typically corresponds to the `[locale]` segment in the app directory
  let locale = await requestLocale;

  // Ensure that the incoming locale is valid
  if (!locale || !routing.locales.includes(locale as Locale)) {
    locale = routing.defaultLocale;
  }

  // Dynamically import all translation files for the current locale
  // NOTE: This import expects each `messages/<locale>/index.ts` to default-export the full messages object.
  // The `settings` namespace is composed by `messages/<locale>/settings/index.ts` so key paths stay stable.
  const messages = await import(`../../messages/${locale}`).then((module) => module.default);

  const timeZone = await resolveSystemTimezone();

  return {
    locale,
    messages,
    timeZone,
    now: new Date(),
    // Optional: Enable runtime warnings for missing translations in development
    onError:
      process.env.NODE_ENV === "development"
        ? (error) => {
            console.error("i18n error:", error);
          }
        : undefined,
    // Optional: Configure what happens when a translation is missing
    getMessageFallback: ({ namespace, key }) => {
      return `${namespace}.${key}`;
    },
  };
});
```

#### 4. Next.js Configuration (`/Users/ding/Github/claude-code-hub/next.config.ts`)

Integrates the next-intl plugin:

```typescript
import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

// Create next-intl plugin with i18n request configuration
const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  output: "standalone",
  transpilePackages: ["@lobehub/icons"],
  serverExternalPackages: [
    "bull",
    "bullmq",
    "@bull-board/api",
    "@bull-board/express",
    "ioredis",
    "postgres",
    "drizzle-orm",
  ],
  outputFileTracingIncludes: {
    "/**": ["./node_modules/undici/**/*", "./node_modules/fetch-socks/**/*"],
  },
  experimental: {
    serverActions: {
      bodySizeLimit: "500mb",
    },
    proxyClientMaxBodySize: "100mb",
  },
};

// Wrap the Next.js config with next-intl plugin
export default withNextIntl(nextConfig);
```

### Available Scripts

| Command | Purpose | Script Location |
|---------|---------|-----------------|
| `bun run i18n:audit-placeholders` | Detects zh-CN placeholders in non-canonical locales | `scripts/audit-settings-placeholders.js` |
| `bun run i18n:audit-placeholders:fail` | Same as above but fails on findings (for CI) | `scripts/audit-settings-placeholders.js` |
| `bun run i18n:audit-messages-no-emoji:fail` | Ensures no emoji in messages JSON | `scripts/audit-messages-no-emoji.js` |
| `node scripts/sync-settings-keys.js` | Synchronizes keys across locales using zh-CN as canonical | `scripts/sync-settings-keys.js` |
| `tsx scripts/extract-translations.ts` | Extracts hardcoded Chinese strings from TSX files | `scripts/extract-translations.ts` |

### Translation Quality Rules

**Source**: `/Users/ding/Github/claude-code-hub/docs/i18n-translation-quality.md`

#### Rule R1: No zh-CN placeholders in non-canonical locales

For any non-canonical locale, if a leaf string equals the zh-CN leaf string at the same key path and contains Han characters, it is treated as a placeholder candidate that should be fixed or allowlisted.

#### Rule R2: Placeholders/tokens must be preserved

When updating translations, do not change:
- Keys / JSON structure
- Placeholder tokens (e.g., `{name}`, `{count}`, `{resetTime}`)
- URL / command snippets unless intentionally translated and verified safe

#### Rule R3: Glossary and consistent terminology

Maintain consistency for:
- Provider / Model / API / HTTP/2
- Claude / OpenAI / Codex (names should not be translated)

#### Rule R4: No emoji in messages JSON

`messages/**/*.json` must not contain emoji characters.

---

## Translation File Organization

### Directory Structure

```
messages/
├── en/                    # English locale
│   ├── index.ts          # Aggregates all namespaces
│   ├── auth.json
│   ├── common.json
│   ├── dashboard.json
│   ├── errors.json
│   └── settings/         # Split settings namespace
│       ├── index.ts
│       ├── nav.json
│       ├── common.json
│       └── providers/
│           ├── form/
│           │   ├── apiTest.json
│           │   ├── buttons.json
│           │   └── ...
│           └── ...
├── ja/                   # Japanese locale (same structure)
├── ru/                   # Russian locale (same structure)
├── zh-CN/                # Simplified Chinese (canonical)
├── zh-TW/                # Traditional Chinese
├── provider-i18n-patch.json
└── providers-i18n-additions.json
```

### Locale Index.ts Pattern

**Source**: `/Users/ding/Github/claude-code-hub/messages/zh-CN/index.ts`

```typescript
import auth from "./auth.json";
import bigScreen from "./bigScreen.json";
import common from "./common.json";
import customs from "./customs.json";
import dashboard from "./dashboard.json";
import errors from "./errors.json";
import forms from "./forms.json";
import internal from "./internal.json";
import myUsage from "./myUsage.json";
import notifications from "./notifications.json";
import providerChain from "./provider-chain.json";
import providers from "./providers.json";
import quota from "./quota.json";
import settings from "./settings";
import ui from "./ui.json";
import usage from "./usage.json";
import users from "./users.json";
import validation from "./validation.json";

export default {
  auth,
  bigScreen,
  common,
  customs,
  dashboard,
  errors,
  forms,
  notifications,
  "provider-chain": providerChain,
  providers,
  quota,
  myUsage,
  settings,
  ui,
  usage,
  users,
  validation,
  internal,
};
```

### Settings Namespace Split Structure

The settings namespace is heavily split to manage complexity:

**Source**: `/Users/ding/Github/claude-code-hub/messages/zh-CN/settings/index.ts`

```typescript
import clientVersions from "./clientVersions.json";
import common from "./common.json";
import config from "./config.json";
import data from "./data.json";
// ... more imports

import providersAutoSort from "./providers/autoSort.json";
import providersBatchEdit from "./providers/batchEdit.json";
// ... more provider imports

import providersFormApiTest from "./providers/form/apiTest.json";
import providersFormButtons from "./providers/form/buttons.json";
// ... more form imports

const providersForm = {
  ...providersFormStrings,
  ...providersFormCommon,
  apiTest: providersFormApiTest,
  buttons: providersFormButtons,
  // ... more form sections
};

const providers = {
  ...providersStrings,
  autoSort: providersAutoSort,
  batchEdit: providersBatchEdit,
  form: providersForm,
  // ... more provider sections
};

export default {
  nav,
  common,
  config,
  providers,
  prices,
  sensitiveWords,
  requestFilters,
  logs,
  data,
  clientVersions,
  notifications,
  errors,
  errorRules,
  ...strings,
};
```

### Translation File Format Examples

**Auth translations** (`/Users/ding/Github/claude-code-hub/messages/zh-CN/auth.json`):

```json
{
  "login": {
    "title": "登录",
    "description": "输入管理员令牌以访问系统",
    "tokenLabel": "管理员令牌",
    "tokenPlaceholder": "请输入管理员令牌",
    "submitButton": "登录",
    "loggingIn": "登录中...",
    "success": "登录成功",
    "error": "登录失败，请检查令牌是否正确"
  },
  "logout": {
    "confirm": "确定要退出登录吗?",
    "success": "已退出登录"
  },
  "errors": {
    "loginFailed": "登录失败",
    "networkError": "网络错误，请稍后重试",
    "invalidToken": "无效的认证令牌",
    "apiKeyRequired": "请输入 API Key",
    "apiKeyInvalidOrExpired": "API Key 无效或已过期",
    "serverError": "登录失败，请稍后重试"
  }
}
```

**Common translations** (`/Users/ding/Github/claude-code-hub/messages/zh-CN/common.json`):

```json
{
  "save": "保存",
  "cancel": "取消",
  "delete": "删除",
  "confirm": "确认",
  "edit": "编辑",
  "status": "状态",
  "create": "创建",
  "close": "关闭",
  "back": "返回",
  "next": "下一步",
  "refresh": "刷新",
  "search": "搜索",
  "filter": "筛选",
  "export": "导出",
  "import": "导入",
  "submit": "提交",
  "reset": "重置",
  "copy": "复制",
  "copySuccess": "已复制",
  "copyFailed": "复制失败",
  "loading": "加载中...",
  "error": "错误",
  "success": "成功",
  "warning": "警告",
  "info": "信息",
  "noData": "暂无数据",
  "theme": "主题",
  "light": "浅色",
  "dark": "深色",
  "system": "跟随系统",
  "relativeTimeShort": {
    "now": "刚刚",
    "secondsAgo": "{count}秒前",
    "minutesAgo": "{count}分前",
    "hoursAgo": "{count}时前",
    "daysAgo": "{count}天前",
    "weeksAgo": "{count}周前",
    "monthsAgo": "{count}月前",
    "yearsAgo": "{count}年前"
  }
}
```

**Error translations with placeholders** (`/Users/ding/Github/claude-code-hub/messages/zh-CN/errors.json`):

```json
{
  "REQUIRED_FIELD": "{field}不能为空",
  "MIN_LENGTH": "{field}长度不能少于{min}个字符",
  "MAX_LENGTH": "{field}长度不能超过{max}个字符",
  "DUPLICATE_NAME": "名称'{name}'已存在",
  "INVALID_RANGE": "{field}必须在{min}到{max}之间",
  "UNAUTHORIZED": "未授权，请先登录",
  "PERMISSION_DENIED": "权限不足",
  "RATE_LIMIT_RPM_EXCEEDED": "请求频率超限：当前 {current} 次/分钟（限制：{limit} 次/分钟）。将于 {resetTime} 重置",
  "RATE_LIMIT_DAILY_QUOTA_EXCEEDED": "每日额度超限：当前 ${current} USD（限制：${limit} USD）。将于 {resetTime} 重置"
}
```

---

## Translation Usage Patterns

### In Server Components

**Source**: `/Users/ding/Github/claude-code-hub/src/app/[locale]/layout.tsx`

```typescript
import { NextIntlClientProvider } from "next-intl";
import { getMessages } from "next-intl/server";
import { type Locale, locales } from "@/i18n/config";

export default async function RootLayout({
  children,
  params,
}: Readonly<{
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}>) {
  const { locale } = await params;

  // Validate locale
  if (!locales.includes(locale as Locale)) {
    notFound();
  }

  // Load translation messages
  const messages = await getMessages();
  const timeZone = await resolveSystemTimezone();
  const now = new Date();

  return (
    <html lang={locale} suppressHydrationWarning>
      <body className="antialiased">
        <NextIntlClientProvider messages={messages} timeZone={timeZone} now={now}>
          <AppProviders>
            <div className="flex min-h-screen flex-col bg-background text-foreground">
              <main className="flex-1">{children}</main>
              <Footer />
            </div>
            <Toaster />
          </AppProviders>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}

export function generateStaticParams() {
  return locales.map((locale) => ({ locale }));
}
```

### In Client Components

**Source**: `/Users/ding/Github/claude-code-hub/src/components/ui/language-switcher.tsx`

```typescript
"use client";

import { Check, Languages } from "lucide-react";
import { useLocale } from "next-intl";
import * as React from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { type Locale, localeLabels, locales } from "@/i18n/config";
import { usePathname, useRouter } from "@/i18n/routing";

export function LanguageSwitcher({ className, size = "sm" }: LanguageSwitcherProps) {
  const currentLocale = useLocale() as Locale;
  const router = useRouter();
  const pathname = usePathname();
  const [isTransitioning, setIsTransitioning] = React.useState(false);

  const handleLocaleChange = React.useCallback(
    (newLocale: Locale) => {
      if (newLocale === currentLocale || isTransitioning) {
        return;
      }

      setIsTransitioning(true);

      try {
        router.push(pathname || "/dashboard", { locale: newLocale });
      } catch (error) {
        console.error("Failed to switch locale:", error);
        setIsTransitioning(false);
      }
    },
    [currentLocale, pathname, router, isTransitioning]
  );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size={buttonSize} disabled={isTransitioning}>
          <Languages className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[10rem]" sideOffset={8}>
        {locales.map((locale) => (
          <DropdownMenuItem
            key={locale}
            onClick={() => handleLocaleChange(locale)}
            className="flex cursor-pointer items-center justify-between"
          >
            <span>{localeLabels[locale]}</span>
            {locale === currentLocale && <Check className="size-4" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
```

### Using useTranslations Hook

**Source**: `/Users/ding/Github/claude-code-hub/src/app/[locale]/dashboard/_components/user/hooks/use-user-translations.ts`

```typescript
"use client";

import { useTranslations } from "next-intl";
import { useMemo } from "react";

export interface UserEditTranslations {
  sections: {
    basicInfo: string;
    expireTime: string;
    limitRules: string;
    accessRestrictions: string;
  };
  fields: {
    username: {
      label: string;
      placeholder: string;
    };
    // ... more fields
  };
}

export function useUserTranslations(
  options: UseUserTranslationsOptions = {}
): UserEditTranslations {
  const { showProviderGroup = false } = options;
  const t = useTranslations("dashboard.userManagement");
  const tUi = useTranslations("ui.tagInput");

  return useMemo(() => {
    return {
      sections: {
        basicInfo: t("userEditSection.sections.basicInfo"),
        expireTime: t("userEditSection.sections.expireTime"),
        limitRules: t("userEditSection.sections.limitRules"),
        accessRestrictions: t("userEditSection.sections.accessRestrictions"),
      },
      fields: {
        username: {
          label: t("userEditSection.fields.username.label"),
          placeholder: t("userEditSection.fields.username.placeholder"),
        },
        // ... more fields
      },
    };
  }, [t, tUi, showProviderGroup]);
}
```

### In Server Actions

**Source**: `/Users/ding/Github/claude-code-hub/src/actions/keys.ts`

```typescript
"use server";

import { getTranslations } from "next-intl/server";
import { ERROR_CODES } from "@/lib/utils/error-messages";

export async function batchUpdateKeys(
  params: BatchUpdateKeysParams
): Promise<ActionResult<BatchUpdateResult>> {
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
    // ... rest of the action
  } catch (error) {
    // ... error handling
  }
}
```

### Locale Detection in Authentication

**Source**: `/Users/ding/Github/claude-code-hub/src/app/api/auth/login/route.ts`

```typescript
import { type NextRequest, NextResponse } from "next/server";
import { getTranslations } from "next-intl/server";
import { defaultLocale, type Locale, locales } from "@/i18n/config";

/**
 * Get locale from request (cookie or Accept-Language header)
 */
function getLocaleFromRequest(request: NextRequest): Locale {
  // 1. Check NEXT_LOCALE cookie
  const localeCookie = request.cookies.get("NEXT_LOCALE")?.value;
  if (localeCookie && locales.includes(localeCookie as Locale)) {
    return localeCookie as Locale;
  }

  // 2. Check Accept-Language header
  const acceptLanguage = request.headers.get("accept-language");
  if (acceptLanguage) {
    for (const locale of locales) {
      if (acceptLanguage.toLowerCase().includes(locale.toLowerCase())) {
        return locale;
      }
    }
  }

  // 3. Fall back to default
  return defaultLocale;
}

async function getAuthErrorTranslations(locale: Locale) {
  try {
    return await getTranslations({ locale, namespace: "auth.errors" });
  } catch (error) {
    // Fallback to default locale if translation loading fails
    try {
      return await getTranslations({ locale: defaultLocale, namespace: "auth.errors" });
    } catch (fallbackError) {
      return null;
    }
  }
}

export async function POST(request: NextRequest) {
  const locale = getLocaleFromRequest(request);
  const t = await getAuthErrorTranslations(locale);

  try {
    const { key } = await request.json();

    if (!key) {
      return NextResponse.json({ error: t?.("apiKeyRequired") }, { status: 400 });
    }

    const session = await validateKey(key, { allowReadOnlyAccess: true });
    if (!session) {
      return NextResponse.json({ error: t?.("apiKeyInvalidOrExpired") }, { status: 401 });
    }

    // ... rest of login logic
  } catch (error) {
    return NextResponse.json({ error: t?.("serverError") }, { status: 500 });
  }
}
```

### Locale Switching in Components

**Source**: `/Users/ding/Github/claude-code-hub/src/app/[locale]/internal/dashboard/big-screen/page.tsx`

```typescript
"use client";

import { useLocale, useTranslations } from "next-intl";
import { type Locale, localeLabels, locales } from "@/i18n/config";
import { usePathname, useRouter } from "@/i18n/routing";

export default function BigScreenPage() {
  const t = useTranslations("bigScreen");
  
  // Language switching
  const currentLocale = useLocale() as Locale;
  const router = useRouter();
  const pathname = usePathname();

  const handleLocaleSwitch = () => {
    // Cycle through languages: zh-CN → en → ja → ru → zh-TW → zh-CN
    const currentIndex = locales.indexOf(currentLocale as Locale);
    const nextIndex = (currentIndex + 1) % locales.length;
    const nextLocale = locales[nextIndex];

    router.push(pathname || "/dashboard", { locale: nextLocale });
  };

  // ... rest of component
}
```

---

## Error Message Translation System

**Source**: `/Users/ding/Github/claude-code-hub/src/lib/utils/error-messages.ts`

The application uses a centralized error code system that enables dynamic error message translation:

```typescript
/**
 * Error Code Mapping System for i18n Error Messages
 *
 * This module provides a centralized error code system that enables dynamic error message
 * translation across the application. Error codes are mapped to translated messages on the
 * client side, supporting parameter interpolation for context-specific errors.
 */

// Validation Error Codes
export const VALIDATION_ERRORS = {
  REQUIRED_FIELD: "REQUIRED_FIELD",
  USER_NAME_REQUIRED: "USER_NAME_REQUIRED",
  API_KEY_REQUIRED: "API_KEY_REQUIRED",
  MIN_LENGTH: "MIN_LENGTH",
  MAX_LENGTH: "MAX_LENGTH",
  INVALID_EMAIL: "INVALID_EMAIL",
  INVALID_URL: "INVALID_URL",
  // ... more codes
} as const;

// Authentication Error Codes
export const AUTH_ERRORS = {
  UNAUTHORIZED: "UNAUTHORIZED",
  INVALID_CREDENTIALS: "INVALID_CREDENTIALS",
  SESSION_EXPIRED: "SESSION_EXPIRED",
  PERMISSION_DENIED: "PERMISSION_DENIED",
} as const;

// Rate Limit Error Codes
export const RATE_LIMIT_ERRORS = {
  RATE_LIMIT_RPM_EXCEEDED: "RATE_LIMIT_RPM_EXCEEDED",
  RATE_LIMIT_5H_EXCEEDED: "RATE_LIMIT_5H_EXCEEDED",
  RATE_LIMIT_WEEKLY_EXCEEDED: "RATE_LIMIT_WEEKLY_EXCEEDED",
  RATE_LIMIT_MONTHLY_EXCEEDED: "RATE_LIMIT_MONTHLY_EXCEEDED",
} as const;

// All Error Codes Union
export const ERROR_CODES = {
  ...VALIDATION_ERRORS,
  ...AUTH_ERRORS,
  ...SERVER_ERRORS,
  ...NETWORK_ERRORS,
  ...BUSINESS_ERRORS,
  ...RATE_LIMIT_ERRORS,
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

/**
 * Get translated error message (Client-side)
 */
export function getErrorMessage(
  t: (key: string, params?: Record<string, string | number>) => string,
  code: ErrorCode | string,
  params?: Record<string, string | number>
): string {
  try {
    return t(code, params);
  } catch (error) {
    console.warn("Translation missing for error code", code, error);
    return t("INTERNAL_ERROR");
  }
}

/**
 * Get translated error message (Server-side)
 */
export async function getErrorMessageServer(
  locale: string,
  code: ErrorCode | string,
  params?: Record<string, string | number>
): Promise<string> {
  try {
    const { getTranslations } = await import("next-intl/server");
    const t = await getTranslations({ locale, namespace: "errors" });
    return t(code, params);
  } catch (error) {
    console.error("getErrorMessageServer failed", { locale, code, error });
    return "An error occurred";
  }
}

/**
 * Helper: Convert Zod error to error code
 */
export function zodErrorToCode(
  zodErrorCode: string,
  params: Record<string, unknown>
): { code: ErrorCode; params?: Record<string, string | number> } {
  const { minimum, maximum, type, path } = params;
  const field = Array.isArray(path) ? path.join(".") : undefined;

  switch (zodErrorCode) {
    case "invalid_type":
      if (type === "string" && params.received === "undefined") {
        return { code: ERROR_CODES.REQUIRED_FIELD, params: { field: field || "field" } };
      }
      return { code: ERROR_CODES.INVALID_TYPE, params: { field: field || "field" } };

    case "too_small":
      if (typeof minimum === "number") {
        const isStringType = type === "string";
        return {
          code: isStringType ? ERROR_CODES.MIN_LENGTH : ERROR_CODES.MIN_VALUE,
          params: { field: field || "field", min: minimum },
        };
      }
      return { code: ERROR_CODES.MIN_VALUE };

    case "too_big":
      if (typeof maximum === "number") {
        const isStringType = type === "string";
        return {
          code: isStringType ? ERROR_CODES.MAX_LENGTH : ERROR_CODES.MAX_VALUE,
          params: { field: field || "field", max: maximum },
        };
      }
      return { code: ERROR_CODES.MAX_VALUE };

    default:
      return { code: ERROR_CODES.INVALID_FORMAT };
  }
}
```

---

## Timezone Integration

**Source**: `/Users/ding/Github/claude-code-hub/src/lib/utils/timezone.ts`

The i18n system integrates with timezone handling for proper date/time display:

```typescript
/**
 * Timezone Utilities
 *
 * Provides timezone validation and resolution functions.
 * Uses IANA timezone database identifiers (e.g., "Asia/Shanghai", "America/New_York").
 *
 * resolveSystemTimezone() implements the fallback chain:
 *   DB timezone -> env TZ -> UTC
 */

/**
 * Common IANA timezone identifiers for dropdown UI.
 */
export const COMMON_TIMEZONES = [
  "UTC",
  "Asia/Shanghai",
  "Asia/Tokyo",
  "Asia/Seoul",
  "Asia/Singapore",
  "Asia/Hong_Kong",
  "Asia/Taipei",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "Europe/Moscow",
  "America/New_York",
  "America/Los_Angeles",
  "America/Chicago",
  "Pacific/Auckland",
  "Pacific/Sydney",
] as const;

export type CommonTimezone = (typeof COMMON_TIMEZONES)[number];

/**
 * Validates if a string is a valid IANA timezone identifier.
 */
export function isValidIANATimezone(timezone: string): boolean {
  if (!timezone || typeof timezone !== "string") {
    return false;
  }
  try {
    Intl.DateTimeFormat(undefined, { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolves the system timezone using the fallback chain:
 *   1. DB system_settings.timezone (via cached settings)
 *   2. env TZ variable
 *   3. "UTC" as final fallback
 */
export async function resolveSystemTimezone(): Promise<string> {
  // Step 1: Try DB timezone from cached system settings
  try {
    const settings = await getCachedSystemSettings();
    if (settings.timezone && isValidIANATimezone(settings.timezone)) {
      return settings.timezone;
    }
  } catch (error) {
    logger.warn("[TimezoneResolver] Failed to read cached system settings", { error });
  }

  // Step 2: Fallback to env TZ
  try {
    const { TZ } = getEnvConfig();
    if (TZ && isValidIANATimezone(TZ)) {
      return TZ;
    }
  } catch (error) {
    logger.warn("[TimezoneResolver] Failed to read env TZ", { error });
  }

  // Step 3: Ultimate fallback
  return "UTC";
}
```

---

## Middleware Integration

**Source**: `/Users/ding/Github/claude-code-hub/src/proxy.ts`

The middleware integrates i18n with authentication:

```typescript
import { type NextRequest, NextResponse } from "next/server";
import createMiddleware from "next-intl/middleware";
import type { Locale } from "@/i18n/config";
import { routing } from "@/i18n/routing";
import { validateKey } from "@/lib/auth";

// Public paths that don't require authentication
const PUBLIC_PATH_PATTERNS = ["/login", "/usage-doc", "/api/auth/login", "/api/auth/logout"];

// Create next-intl middleware for locale detection and routing
const intlMiddleware = createMiddleware(routing);

async function proxyHandler(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  // API proxy routes don't need locale handling (use their own Bearer token)
  if (pathname.startsWith(API_PROXY_PATH)) {
    return NextResponse.next();
  }

  // Skip locale handling for static files and Next.js internals
  if (pathname.startsWith("/_next") || pathname === "/favicon.ico") {
    return NextResponse.next();
  }

  // Apply locale middleware first (handles locale detection and routing)
  const localeResponse = intlMiddleware(request);

  // Extract locale from pathname (format: /[locale]/path or just /path)
  const localeMatch = pathname.match(/^\/([^/]+)/);
  const potentialLocale = localeMatch?.[1];
  const isLocaleInPath = routing.locales.includes(potentialLocale as Locale);

  // Get the pathname without locale prefix
  const pathWithoutLocale = isLocaleInPath
    ? pathname.slice((potentialLocale?.length ?? 0) + 1)
    : pathname;

  // Check if current path (without locale) is a public path
  const isPublicPath = PUBLIC_PATH_PATTERNS.some(
    (pattern) => pathWithoutLocale === pattern || pathWithoutLocale.startsWith(pattern)
  );

  // Public paths don't require authentication
  if (isPublicPath) {
    return localeResponse;
  }

  // Check authentication for protected routes
  const authToken = request.cookies.get("auth-token");

  if (!authToken) {
    // Not authenticated, redirect to login page
    const url = request.nextUrl.clone();
    // Preserve locale in redirect
    const locale = isLocaleInPath ? potentialLocale : routing.defaultLocale;
    url.pathname = `/${locale}/login`;
    url.searchParams.set("from", pathWithoutLocale || "/dashboard");
    return NextResponse.redirect(url);
  }

  // Validate key permissions
  const session = await validateKey(authToken.value, { allowReadOnlyAccess: isReadOnlyPath });
  if (!session) {
    // Invalid key or insufficient permissions, clear cookie and redirect to login
    const url = request.nextUrl.clone();
    // Preserve locale in redirect
    const locale = isLocaleInPath ? potentialLocale : routing.defaultLocale;
    url.pathname = `/${locale}/login`;
    url.searchParams.set("from", pathWithoutLocale || "/dashboard");
    const response = NextResponse.redirect(url);
    response.cookies.delete("auth-token");
    return response;
  }

  // Authentication passed, return locale response
  return localeResponse;
}

export default proxyHandler;

export const config = {
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico).*)",
  ],
};
```

---

## Edge Cases

### 1. Invalid Locale Handling

When an invalid locale is provided in the URL, the system falls back to the default locale:

**Source**: `/Users/ding/Github/claude-code-hub/src/i18n/request.ts`

```typescript
export default getRequestConfig(async ({ requestLocale }) => {
  let locale = await requestLocale;

  // Ensure that the incoming locale is valid
  if (!locale || !routing.locales.includes(locale as Locale)) {
    locale = routing.defaultLocale;
  }

  // ... continue loading translations
});
```

### 2. Missing Translation Fallback

When a translation key is missing, the system returns a fallback string:

```typescript
getMessageFallback: ({ namespace, key }) => {
  return `${namespace}.${key}`;
}
```

This results in displaying `errors.UNKNOWN_ERROR` instead of crashing.

### 3. Translation Loading Failure

In the login route, translation loading has multiple fallback layers:

**Source**: `/Users/ding/Github/claude-code-hub/src/app/api/auth/login/route.ts`

```typescript
async function getAuthErrorTranslations(locale: Locale) {
  try {
    return await getTranslations({ locale, namespace: "auth.errors" });
  } catch (error) {
    // Try default locale as fallback
    try {
      return await getTranslations({ locale: defaultLocale, namespace: "auth.errors" });
    } catch (fallbackError) {
      return null;  // Ultimate fallback
    }
  }
}
```

### 4. SSR/CSR Hydration Mismatch Prevention

To avoid hydration mismatches with relative time formatting:

**Source**: `/Users/ding/Github/claude-code-hub/src/app/[locale]/layout.tsx`

```typescript
// Create a stable `now` timestamp to avoid SSR/CSR hydration mismatch for relative time
const now = new Date();

return (
  <NextIntlClientProvider messages={messages} timeZone={timeZone} now={now}>
    {/* ... */}
  </NextIntlClientProvider>
);
```

### 5. Locale-Aware Redirects

Redirects preserve the current locale:

**Source**: `/Users/ding/Github/claude-code-hub/src/app/[locale]/page.tsx`

```typescript
import { redirect } from "@/i18n/routing";

export default async function Home({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  return redirect({ href: "/dashboard", locale });
}
```

### 6. Translation Key Synchronization

When adding new keys to the canonical locale (zh-CN), the sync script propagates them to other locales:

**Source**: `/Users/ding/Github/claude-code-hub/scripts/sync-settings-keys.js`

This script ensures all locales have the same key structure, adding missing keys with empty strings or zh-CN values as placeholders.

### 7. Placeholder Detection

The audit script detects when non-canonical locales have zh-CN values (indicating untranslated strings):

**Source**: `/Users/ding/Github/claude-code-hub/scripts/audit-settings-placeholders.js`

This helps maintain translation quality by identifying strings that need translation.

---

## References

### Core i18n Files

| File | Purpose |
|------|---------|
| `/Users/ding/Github/claude-code-hub/src/i18n/config.ts` | Locale definitions and configuration |
| `/Users/ding/Github/claude-code-hub/src/i18n/routing.ts` | Locale routing and navigation utilities |
| `/Users/ding/Github/claude-code-hub/src/i18n/request.ts` | Server-side request configuration |
| `/Users/ding/Github/claude-code-hub/src/i18n/index.ts` | Central exports for all i18n utilities |
| `/Users/ding/Github/claude-code-hub/src/i18n/README.md` | i18n infrastructure documentation |

### Translation Files

| File | Purpose |
|------|---------|
| `/Users/ding/Github/claude-code-hub/messages/zh-CN/index.ts` | zh-CN locale entry point |
| `/Users/ding/Github/claude-code-hub/messages/en/index.ts` | en locale entry point |
| `/Users/ding/Github/claude-code-hub/messages/zh-CN/settings/index.ts` | Settings namespace composition |

### Integration Files

| File | Purpose |
|------|---------|
| `/Users/ding/Github/claude-code-hub/next.config.ts` | Next.js config with next-intl plugin |
| `/Users/ding/Github/claude-code-hub/src/proxy.ts` | Middleware with i18n integration |
| `/Users/ding/Github/claude-code-hub/src/app/[locale]/layout.tsx` | Root layout with locale handling |

### Utility Files

| File | Purpose |
|------|---------|
| `/Users/ding/Github/claude-code-hub/src/lib/utils/error-messages.ts` | Error code system with i18n support |
| `/Users/ding/Github/claude-code-hub/src/lib/utils/timezone.ts` | Timezone resolution utilities |
| `/Users/ding/Github/claude-code-hub/src/components/ui/language-switcher.tsx` | Language switcher component |

### Scripts

| File | Purpose |
|------|---------|
| `/Users/ding/Github/claude-code-hub/scripts/extract-translations.ts` | Extract hardcoded strings from TSX |
| `/Users/ding/Github/claude-code-hub/scripts/audit-settings-placeholders.js` | Audit for untranslated strings |
| `/Users/ding/Github/claude-code-hub/scripts/audit-messages-no-emoji.js` | Audit for emoji in translations |
| `/Users/ding/Github/claude-code-hub/scripts/sync-settings-keys.js` | Sync keys across locales |

### Documentation

| File | Purpose |
|------|---------|
| `/Users/ding/Github/claude-code-hub/docs/i18n-translation-quality.md` | Translation quality rules (R1-R4) |

---

## Summary

The Claude Code Hub i18n system is a comprehensive, production-ready internationalization solution built on `next-intl`. Key characteristics:

1. **5 supported locales** with zh-CN as the canonical source
2. **Always-prefix routing** strategy for consistent URL structure
3. **Three-tier locale detection**: cookie → Accept-Language header → default
4. **Namespace-based organization** with deeply nested settings namespace
5. **Full TypeScript support** with type-safe translations and routing
6. **Automated quality assurance** via audit and sync scripts
7. **Integration with authentication** preserving locale in redirects
8. **Error code system** enabling dynamic error message translation
9. **Timezone integration** for proper date/time display
10. **SSR/CSR hydration safety** with stable timestamps

The system enforces strict quality rules (no emoji, no placeholders in non-canonical locales, consistent terminology) and provides tooling to maintain translation consistency across all supported languages.
