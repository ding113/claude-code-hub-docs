---
title: 国际化指南
description: Claude Code Hub 多语言支持实现指南，包括翻译文件管理、添加新语言、使用翻译 Hook 等最佳实践。
---

# 国际化指南

本文档介绍 Claude Code Hub 的国际化（i18n）架构设计与实现，帮助开发者理解和扩展多语言支持。

---

## 概述

Claude Code Hub 使用 [next-intl](https://next-intl-docs.vercel.app/) 实现国际化，支持以下特性：

- **5 种语言**：简体中文（默认）、繁体中文、英语、俄语、日语
- **URL 路由前缀**：所有页面路径包含语言前缀（如 `/zh-CN/dashboard`）
- **Cookie 持久化**：用户语言偏好通过 `NEXT_LOCALE` Cookie 保存
- **自动检测**：根据浏览器 Accept-Language 头自动选择语言

---

## 技术栈

### 核心依赖

| 库 | 版本 | 用途 |
|---|---|---|
| `next-intl` | ^4.x | 核心 i18n 库 |
| `next-intl/plugin` | - | Next.js 插件集成 |
| `next-intl/server` | - | 服务端翻译加载 |
| `next-intl/navigation` | - | 类型安全的路由导航 |

### App Router 集成

```typescript
// next.config.ts
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

export default withNextIntl(nextConfig);
```

---

## 目录结构

### i18n 配置目录

```
src/i18n/
├── config.ts          # 语言配置和类型定义
├── routing.ts         # 路由配置和导航工具
├── request.ts         # 服务端请求配置
├── index.ts           # 统一导出
└── README.md          # 详细技术文档
```

### 翻译文件目录

```
messages/
├── zh-CN/             # 简体中文（默认语言）
│   ├── index.ts       # 命名空间聚合导出
│   ├── common.json    # 通用文本
│   ├── auth.json      # 认证相关
│   ├── dashboard.json # 仪表盘
│   ├── settings.json  # 设置页面
│   ├── providers.json # 供应商管理
│   ├── users.json     # 用户管理
│   ├── errors.json    # 错误消息
│   ├── ui.json        # UI 组件
│   └── ...            # 其他命名空间
├── zh-TW/             # 繁体中文
├── en/                # 英语
├── ru/                # 俄语
└── ja/                # 日语
```

### 支持的语言代码

| 语言代码 | 语言名称 | 原生名称 |
|---------|---------|---------|
| `zh-CN` | Chinese (Simplified) | 简体中文 |
| `zh-TW` | Chinese (Traditional) | 繁體中文 |
| `en` | English | English |
| `ru` | Russian | Русский |
| `ja` | Japanese | 日本語 |

---

## 翻译文件格式

### JSON 结构规范

翻译文件使用 JSON 格式，支持嵌套键和插值变量：

```json
// messages/zh-CN/auth.json
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
    "invalidToken": "无效的认证令牌"
  }
}
```

### 命名空间聚合

每个语言目录的 `index.ts` 文件聚合所有命名空间：

```typescript
// messages/zh-CN/index.ts
import auth from "./auth.json";
import common from "./common.json";
import dashboard from "./dashboard.json";
import errors from "./errors.json";
import settings from "./settings.json";
import ui from "./ui.json";
// ... 其他命名空间

export default {
  auth,
  common,
  dashboard,
  errors,
  settings,
  ui,
  // ... 其他命名空间
};
```

### 插值变量

支持在翻译文本中使用占位符：

```json
{
  "greeting": "你好，{name}！",
  "itemCount": "共 {count} 项",
  "pageInfo": "第 {current} 页，共 {total} 页",
  "minLength": "{field}长度不能少于{min}个字符"
}
```

---

## 使用翻译

### 服务端组件

在服务端组件中使用 `useTranslations` 或 `getTranslations`：

```typescript
// 方式一：useTranslations（推荐用于 React 组件）
import { useTranslations } from "next-intl";

export default function ServerComponent() {
  const t = useTranslations("auth");

  return (
    <div>
      <h1>{t("login.title")}</h1>
      <p>{t("login.description")}</p>
    </div>
  );
}

// 方式二：getTranslations（用于非组件函数）
import { getTranslations } from "next-intl/server";

export async function generateMetadata() {
  const t = await getTranslations("common");
  return {
    title: t("siteTitle"),
  };
}
```

### 客户端组件

客户端组件使用方式相同，但需要 `"use client"` 指令：

```typescript
"use client";

import { useTranslations } from "next-intl";
import { Link } from "@/i18n/routing";

export default function ClientComponent() {
  const t = useTranslations("dashboard");

  return (
    <div>
      <h1>{t("title")}</h1>
      <Link href="/settings">{t("goToSettings")}</Link>
    </div>
  );
}
```

### Server Actions

在 Server Actions 中使用 `getTranslations`：

```typescript
"use server";

import { getTranslations } from "next-intl/server";

export async function createUser(formData: FormData) {
  const t = await getTranslations("errors");

  try {
    // 业务逻辑...
  } catch (error) {
    return { error: t("CREATE_USER_FAILED") };
  }
}
```

### 带变量的翻译

```typescript
const t = useTranslations("ui");

// 使用插值变量
<span>{t("pagination.pageInfo", { current: 1, total: 10 })}</span>
// 输出: "第 1 页，共 10 页"

<span>{t("pagination.total", { total: 100 })}</span>
// 输出: "共 100 项"
```

---

## 添加新语言

### 步骤一：创建翻译文件目录

```bash
# 以添加韩语 (ko) 为例
mkdir -p messages/ko
```

### 步骤二：复制并翻译文件

```bash
# 复制英语作为模板
cp messages/en/*.json messages/ko/
cp messages/en/index.ts messages/ko/

# 然后翻译每个 JSON 文件
```

### 步骤三：更新配置

编辑 `src/i18n/config.ts`：

```typescript
// 添加新语言到 locales 数组
export const locales = ["zh-CN", "zh-TW", "en", "ru", "ja", "ko"] as const;

// 更新类型定义（自动推导）
export type Locale = (typeof locales)[number];

// 添加语言标签
export const localeLabels: Record<Locale, string> = {
  "zh-CN": "简体中文",
  "zh-TW": "繁体中文",
  en: "English",
  ru: "Русский",
  ja: "日本語",
  ko: "한국어",  // 新增
};

// 添加英文名称
export const localeNamesInEnglish: Record<Locale, string> = {
  "zh-CN": "Chinese (Simplified)",
  "zh-TW": "Chinese (Traditional)",
  en: "English",
  ru: "Russian",
  ja: "Japanese",
  ko: "Korean",  // 新增
};
```

### 步骤四：测试验证

```bash
# 启动开发服务器
bun run dev

# 访问新语言路由
open http://localhost:23000/ko/dashboard
```

{% callout type="warning" title="翻译完整性检查" %}
添加新语言后，务必确保所有命名空间的翻译文件都已创建，且键值与其他语言保持一致。缺失的翻译键会显示为 `namespace.key` 格式。
{% /callout %}

---

## 翻译键管理

### 命名约定

| 规则 | 示例 | 说明 |
|-----|------|-----|
| 使用 camelCase | `loginButton` | 键名使用驼峰命名 |
| 按功能分组 | `login.title`, `login.error` | 使用点号分隔层级 |
| 动作使用动词 | `save`, `delete`, `confirm` | 按钮等操作用动词 |
| 状态使用形容词 | `loading`, `empty`, `error` | 状态描述用形容词 |

### 命名空间划分

| 命名空间 | 用途 | 示例键 |
|---------|------|-------|
| `common` | 通用按钮、操作 | `save`, `cancel`, `confirm` |
| `auth` | 认证相关 | `login.title`, `logout.confirm` |
| `dashboard` | 仪表盘页面 | `overview`, `statistics` |
| `settings` | 设置页面 | `general`, `appearance` |
| `providers` | 供应商管理 | `create`, `edit`, `test` |
| `users` | 用户管理 | `list`, `create`, `delete` |
| `errors` | 错误消息 | `UNAUTHORIZED`, `NOT_FOUND` |
| `ui` | UI 组件 | `table.pagination`, `empty.title` |

### 复用策略

1. **通用文本放 `common`**：如 `save`、`cancel`、`loading`
2. **页面特定文本放对应命名空间**：如 `dashboard.overview`
3. **错误消息统一放 `errors`**：便于集中管理
4. **UI 组件文本放 `ui`**：如分页、表格、空状态

---

## 日期和数字格式化

### 日期格式化

```typescript
import { useFormatter } from "next-intl";

function DateDisplay() {
  const format = useFormatter();
  const date = new Date();

  return (
    <span>
      {format.dateTime(date, {
        year: "numeric",
        month: "short",
        day: "numeric",
      })}
    </span>
  );
}
```

### 数字格式化

```typescript
import { useFormatter } from "next-intl";

function NumberDisplay() {
  const format = useFormatter();

  return (
    <div>
      {/* 货币格式 */}
      <span>{format.number(1234.56, { style: "currency", currency: "USD" })}</span>

      {/* 百分比格式 */}
      <span>{format.number(0.856, { style: "percent" })}</span>

      {/* 紧凑格式 */}
      <span>{format.number(1000000, { notation: "compact" })}</span>
    </div>
  );
}
```

{% callout type="note" title="格式化配置" %}
可以在 `src/i18n/request.ts` 中预定义常用的日期和数字格式，然后在组件中引用。
{% /callout %}

---

## 语言切换

### UI 实现

项目提供了 `LanguageSwitcher` 组件：

```typescript
// src/components/ui/language-switcher.tsx
import { LanguageSwitcher } from "@/components/ui/language-switcher";

// 在导航栏或设置页面使用
<LanguageSwitcher size="sm" />
```

### 组件特性

- 下拉选择器显示所有支持的语言
- 使用原生语言名称显示（如"简体中文"而非"Chinese"）
- 切换时自动更新 URL 和 Cookie
- 保持当前页面路径不变
- 支持键盘导航（Tab、Enter、方向键）

### 路由处理

语言切换时，`next-intl` 的 `useRouter` 自动处理：

```typescript
"use client";

import { useRouter, usePathname } from "@/i18n/routing";
import { useLocale } from "next-intl";

function LanguageSwitcher() {
  const router = useRouter();
  const pathname = usePathname();
  const currentLocale = useLocale();

  const handleLocaleChange = (newLocale: string) => {
    // 自动更新 URL 前缀和设置 Cookie
    router.push(pathname, { locale: newLocale });
  };

  // ...
}
```

### Cookie 配置

语言偏好通过 Cookie 持久化：

```typescript
// src/i18n/routing.ts
localeCookie: {
  name: "NEXT_LOCALE",
  maxAge: 365 * 24 * 60 * 60,  // 1 年
  path: "/",
  sameSite: "lax",
}
```

---

## 最佳实践

### 翻译完整性检查

开发时启用错误警告：

```typescript
// src/i18n/request.ts
onError:
  process.env.NODE_ENV === "development"
    ? (error) => {
        console.error("i18n error:", error);
      }
    : undefined,

// 缺失翻译时显示键名
getMessageFallback: ({ namespace, key }) => {
  return `${namespace}.${key}`;
},
```

### 占位符使用规范

```json
// 好的做法：使用有意义的变量名
{
  "greeting": "你好，{userName}！",
  "fileSize": "文件大小：{size} MB",
  "duration": "持续时间：{hours} 小时 {minutes} 分钟"
}

// 避免：使用无意义的变量名
{
  "greeting": "你好，{0}！",
  "fileSize": "文件大小：{x} MB"
}
```

### 避免硬编码文本

```typescript
// 错误：硬编码文本
<button>保存</button>

// 正确：使用翻译
const t = useTranslations("common");
<button>{t("save")}</button>
```

### 路由导航使用 i18n 工具

```typescript
// 错误：使用 next/link
import Link from "next/link";
<Link href="/dashboard">Dashboard</Link>

// 正确：使用 i18n/routing
import { Link } from "@/i18n/routing";
<Link href="/dashboard">Dashboard</Link>  // 自动添加语言前缀
```

---

## 相关资源

- [next-intl 官方文档](https://next-intl-docs.vercel.app/)
- [Next.js App Router 国际化](https://nextjs.org/docs/app/building-your-application/routing/internationalization)
- [i18n 配置 README](/Users/ding/Github/claude-code-hub/src/i18n/README.md)
