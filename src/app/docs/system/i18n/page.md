---
title: 多语言支持
description: Claude Code Hub 的国际化系统设计与实现
---

Claude Code Hub 内置完整的国际化（i18n）系统，基于 `next-intl` 构建，支持五种语言界面。系统采用类型安全的设计，提供自动语言检测、无缝语言切换和完善的翻译管理工具。

## 支持的语言

系统支持以下五种语言：

| 语言代码 | 本地名称 | 英语名称 | 状态 |
|---------|---------|---------|------|
| zh-CN | 简体中文 | Chinese (Simplified) | 默认语言 |
| zh-TW | 繁体中文 | Chinese (Traditional) | 已支持 |
| en | English | English | 已支持 |
| ru | Русский | Russian | 已支持 |
| ja | 日本語 | Japanese | 已支持 |

简体中文（zh-CN）作为**规范语言（canonical locale）**，是翻译的源头参考。其他语言的翻译键值结构与 zh-CN 保持一致。

## 语言检测策略

系统采用三级回退策略检测用户语言偏好：

1. **NEXT_LOCALE Cookie** - 用户之前选择的语言（有效期一年）
2. **Accept-Language 请求头** - 浏览器设置的首选语言
3. **默认语言** - 回退到简体中文（zh-CN）

这种设计确保首次访问的用户能看到符合其浏览器设置的语言界面，而已选择过语言的用户则能直接看到之前的偏好设置。

## 路由策略

所有路由都采用"始终带前缀"策略，URL 中始终包含语言代码：

```
/zh-CN/dashboard    # 简体中文界面
/en/dashboard       # 英文界面
/ja/settings        # 日文设置页
```

这种设计的好处：
- URL 自描述，便于分享和 SEO
- 服务端渲染时能立即确定语言，无需额外检测
- 避免同一内容的多语言版本竞争搜索引擎排名

## 翻译文件组织

翻译文件按功能领域划分为多个命名空间（namespace）：

| 命名空间 | 用途 | 文件位置 |
|---------|------|---------|
| auth | 登录、认证相关 | `messages/<locale>/auth.json` |
| common | 通用 UI 元素（按钮、操作） | `messages/<locale>/common.json` |
| dashboard | 仪表盘界面 | `messages/<locale>/dashboard.json` |
| errors | 错误消息（支持占位符） | `messages/<locale>/errors.json` |
| forms | 表单验证消息 | `messages/<locale>/forms.json` |
| myUsage | 用户使用统计 | `messages/<locale>/myUsage.json` |
| notifications | 通知、提示消息 | `messages/<locale>/notifications.json` |
| provider-chain | 供应商决策链 | `messages/<locale>/provider-chain.json` |
| providers | 供应商类型定义 | `messages/<locale>/providers.json` |
| quota | 配额管理 | `messages/<locale>/quota.json` |
| settings | 设置界面（分层结构） | `messages/<locale>/settings/` |
| ui | UI 组件 | `messages/<locale>/ui.json` |
| usage | 使用文档 | `messages/<locale>/usage.json` |
| users | 用户管理 | `messages/<locale>/users.json` |
| validation | 表单验证规则 | `messages/<locale>/validation.json` |

### 翻译文件结构

每个语言目录包含一个 `index.ts` 入口文件，聚合所有命名空间：

```typescript
// messages/zh-CN/index.ts
import auth from "./auth.json";
import common from "./common.json";
import dashboard from "./dashboard.json";
// ... 其他导入

export default {
  auth,
  common,
  dashboard,
  // ... 其他命名空间
};
```

settings 命名空间采用分层结构管理复杂度：

```
messages/zh-CN/settings/
├── index.ts           # 聚合所有子模块
├── nav.json           # 导航菜单
├── common.json        # 通用设置
├── config.json        # 配置项
├── providers/         # 供应商相关
│   ├── autoSort.json
│   ├── batchEdit.json
│   └── form/          # 表单相关
│       ├── apiTest.json
│       └── buttons.json
```

## 核心配置文件

### 语言配置（config.ts）

定义支持的语言、默认语言和语言标签：

```typescript
// src/i18n/config.ts
export const locales = ["zh-CN", "zh-TW", "en", "ru", "ja"] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = "zh-CN";

export const localeLabels: Record<Locale, string> = {
  "zh-CN": "简体中文",
  "zh-TW": "繁体中文",
  en: "English",
  ru: "Русский",
  ja: "日本語",
};
```

### 路由配置（routing.ts）

配置语言路由和导航工具：

```typescript
// src/i18n/routing.ts
import { createNavigation } from "next-intl/navigation";
import { defineRouting } from "next-intl/routing";

export const routing = defineRouting({
  locales,
  defaultLocale,
  localePrefix: "always",
  localeCookie: {
    name: "NEXT_LOCALE",
    maxAge: 365 * 24 * 60 * 60,  // 1年
    path: "/",
    sameSite: "lax",
  },
});

// 类型安全的导航工具
export const { Link, redirect, useRouter, usePathname } = createNavigation(routing);
```

### 请求配置（request.ts）

配置每个请求的翻译加载方式：

```typescript
// src/i18n/request.ts
import { getRequestConfig } from "next-intl/server";

export default getRequestConfig(async ({ requestLocale }) => {
  let locale = await requestLocale;

  // 验证语言有效性
  if (!locale || !routing.locales.includes(locale as Locale)) {
    locale = routing.defaultLocale;
  }

  // 动态导入当前语言的翻译文件
  const messages = await import(`../../messages/${locale}`)
    .then((module) => module.default);

  const timeZone = await resolveSystemTimezone();

  return {
    locale,
    messages,
    timeZone,
    now: new Date(),
    getMessageFallback: ({ namespace, key }) => `${namespace}.${key}`,
  };
});
```

## 在代码中使用翻译

### 服务端组件

在服务端组件中使用 `useTranslations`：

```typescript
import { useTranslations } from "next-intl";

export default function DashboardPage() {
  const t = useTranslations("dashboard");

  return (
    <div>
      <h1>{t("title")}</h1>
      <p>{t("welcomeMessage")}</p>
    </div>
  );
}
```

### 客户端组件

客户端组件使用相同的 hook，配合语言感知的路由组件：

```typescript
"use client";

import { useTranslations } from "next-intl";
import { Link } from "@/i18n/routing";

export function UserCard() {
  const t = useTranslations("users");

  return (
    <div>
      <h2>{t("cardTitle")}</h2>
      <Link href="/users/profile">
        {t("viewProfile")}
      </Link>
    </div>
  );
}
```

### 服务端 Action

在服务端 Action 中使用 `getTranslations`：

```typescript
"use server";

import { getTranslations } from "next-intl/server";

export async function createUser(data: UserData) {
  const t = await getTranslations("errors");

  if (!data.name) {
    return { error: t("REQUIRED_FIELD", { field: "用户名" }) };
  }

  // ... 业务逻辑
}
```

### 语言切换组件

系统提供内置的语言切换器组件：

```typescript
import { LanguageSwitcher } from "@/components/ui/language-switcher";

// 在布局或导航栏中使用
<LanguageSwitcher size="sm" />
```

切换语言时，系统会：
1. 更新 `NEXT_LOCALE` Cookie
2. 保持当前页面路径不变
3. 重新加载页面显示新语言

## 错误消息翻译系统

系统采用集中式错误码映射，支持动态错误消息翻译：

```typescript
// src/lib/utils/error-messages.ts
export const ERROR_CODES = {
  UNAUTHORIZED: "UNAUTHORIZED",
  PERMISSION_DENIED: "PERMISSION_DENIED",
  RATE_LIMIT_RPM_EXCEEDED: "RATE_LIMIT_RPM_EXCEEDED",
  // ... 更多错误码
} as const;

// 在翻译文件中使用占位符
{
  "RATE_LIMIT_RPM_EXCEEDED": "请求频率超限：当前 {current} 次/分钟（限制：{limit} 次/分钟）"
}

// 使用示例
const message = t("RATE_LIMIT_RPM_EXCEEDED", {
  current: 120,
  limit: 100,
});
// 结果："请求频率超限：当前 120 次/分钟（限制：100 次/分钟）"
```

## 时区集成

i18n 系统与时区处理集成，确保日期时间正确显示：

```typescript
// 时区解析优先级：
// 1. 数据库 system_settings.timezone
// 2. 环境变量 TZ
// 3. 回退到 UTC

const timeZone = await resolveSystemTimezone();
// 返回如 "Asia/Shanghai", "America/New_York" 等 IANA 时区标识符
```

支持的常用时区包括：UTC、Asia/Shanghai、Asia/Tokyo、Europe/London、Europe/Moscow、America/New_York 等。

## 翻译质量管理

系统通过自动化脚本确保翻译质量：

### 可用脚本

| 命令 | 用途 |
|-----|------|
| `bun run i18n:audit-placeholders` | 检测非规范语言中的中文占位符 |
| `bun run i18n:audit-placeholders:fail` | 同上，但发现问题时返回错误码（用于 CI） |
| `bun run i18n:audit-messages-no-emoji:fail` | 确保翻译文件不含 emoji |
| `node scripts/sync-settings-keys.js` | 同步各语言的键值结构 |

### 翻译质量规则

**规则 R1：非规范语言中不得包含中文占位符**

对于非 zh-CN 语言，如果某个键的值与 zh-CN 相同且包含汉字，则视为需要翻译的占位符。

**规则 R2：保留占位符和标记**

更新翻译时不得修改：
- JSON 键结构
- 占位符标记（如 `{name}`, `{count}`）
- URL 和命令片段

**规则 R3：术语一致性**

保持以下术语的一致性：
- Provider / Model / API / HTTP/2（不翻译）
- Claude / OpenAI / Codex（品牌名不翻译）

**规则 R4：翻译文件不含 emoji**

`messages/**/*.json` 文件中不得包含 emoji 字符。

## 边缘情况处理

### 无效语言代码

当 URL 包含无效的语言代码时，系统自动回退到默认语言：

```typescript
if (!locale || !routing.locales.includes(locale as Locale)) {
  locale = routing.defaultLocale;
}
```

### 缺失翻译回退

当翻译键不存在时，系统显示键名本身而非报错：

```typescript
getMessageFallback: ({ namespace, key }) => {
  return `${namespace}.${key}`;
}
// 显示如 "errors.UNKNOWN_ERROR"
```

### 服务端/客户端水合不匹配防护

为避免相对时间格式化导致的水合不匹配：

```typescript
// 创建稳定的 now 时间戳
const now = new Date();

<NextIntlClientProvider messages={messages} timeZone={timeZone} now={now}>
  {children}
</NextIntlClientProvider>
```

### 认证失败时保留语言

重定向到登录页面时保留当前语言：

```typescript
const locale = isLocaleInPath ? potentialLocale : routing.defaultLocale;
url.pathname = `/${locale}/login`;
url.searchParams.set("from", pathWithoutLocale);
return NextResponse.redirect(url);
```

## 添加新语言

如需添加对新语言的支持：

1. **更新配置**：在 `src/i18n/config.ts` 的 `locales` 数组中添加新语言代码
2. **创建翻译目录**：复制 `messages/zh-CN` 为新语言目录（如 `messages/fr`）
3. **翻译内容**：将所有 JSON 文件中的中文翻译为目标语言
4. **更新入口**：确保 `messages/fr/index.ts` 正确导出所有命名空间
5. **测试验证**：运行 `bun run i18n:audit-placeholders` 检查翻译完整性

## 最佳实践

1. **始终使用类型安全的导航工具**：导入 `@/i18n/routing` 中的 `Link`、`redirect` 等，而非 Next.js 默认导出
2. **按功能组织翻译键**：相关功能的文本放在同一命名空间，避免单个文件过大
3. **使用语义化键名**：如 `submitButton` 而非 `button1`，提高可维护性
4. **复用通用翻译**：按钮、操作等通用文本放在 `common` 命名空间
5. **服务端优先**：能在服务端获取的翻译不要放到客户端，减少 JavaScript 体积
