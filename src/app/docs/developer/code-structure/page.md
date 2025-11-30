---
title: 代码结构
description: Claude Code Hub 项目的代码组织、目录结构和模块划分说明
---

# 代码结构

本文档详细介绍 Claude Code Hub 的代码组织方式，帮助开发者快速理解项目架构并参与开发。

---

## 概述

Claude Code Hub 采用 **模块化单体架构（Modular Monolith）**，基于 Next.js 15 App Router 构建。代码组织遵循以下原则：

1. **关注点分离**：UI、业务逻辑、数据访问层清晰划分
2. **按功能模块组织**：每个功能模块包含完整的组件、Action 和类型定义
3. **共享代码集中管理**：通用工具、类型、组件统一放置
4. **约定优于配置**：遵循 Next.js 和 React 社区最佳实践

{% callout title="路径别名" %}
项目配置了 `@/*` 路径别名指向 `./src/*`，所有导入使用绝对路径：

```typescript
import { logger } from "@/lib/logger";
import { users } from "@/drizzle/schema";
```
{% /callout %}

---

## 项目根目录结构

```
claude-code-hub/
├── .claude/              # Claude Code 配置
├── .github/              # GitHub Actions 和 CI/CD 配置
├── deploy/               # Docker 部署相关文件
├── dev/                  # 本地开发环境配置
├── docs/                 # 项目文档（PRD、架构设计）
├── drizzle/              # 数据库迁移文件（SQL）
├── messages/             # i18n 国际化翻译文件
├── public/               # 静态资源
├── scripts/              # 构建和部署脚本
├── src/                  # 源代码目录（核心）
├── tests/                # 测试文件
├── .env.example          # 环境变量示例
├── docker-compose.yaml   # Docker Compose 配置
├── drizzle.config.ts     # Drizzle ORM 配置
├── next.config.ts        # Next.js 配置
├── package.json          # 项目依赖和脚本
├── tailwind.config.ts    # Tailwind CSS 配置
└── tsconfig.json         # TypeScript 配置
```

### 配置文件说明

| 文件 | 用途 |
|------|------|
| `package.json` | 项目依赖、npm 脚本、版本信息 |
| `tsconfig.json` | TypeScript 编译配置，包含路径别名 `@/*` |
| `next.config.ts` | Next.js 配置，包括 i18n 插件、服务端包排除、Webpack 配置 |
| `drizzle.config.ts` | Drizzle ORM 配置，指定 schema 和迁移输出目录 |
| `docker-compose.yaml` | 生产环境 Docker Compose，包含 app、postgres、redis 服务 |
| `eslint.config.mjs` | ESLint 代码风格检查配置 |
| `postcss.config.mjs` | PostCSS 配置（Tailwind CSS 使用） |

---

## src/ 目录结构

```
src/
├── actions/              # Server Actions（业务逻辑层）
├── app/                  # Next.js App Router（页面和 API）
├── components/           # React 组件
├── drizzle/              # 数据库 Schema 和连接
├── hooks/                # React 自定义 Hooks
├── i18n/                 # 国际化配置
├── lib/                  # 共享工具库（核心）
├── repository/           # 数据库查询层
├── types/                # TypeScript 类型定义
├── instrumentation.ts    # Next.js instrumentation
└── middleware.ts         # Next.js 中间件
```

---

## app/ 目录详解

App Router 是 Next.js 15 的核心路由系统，采用文件系统路由。

```
app/
├── [locale]/             # 国际化动态路由
│   ├── dashboard/        # 仪表盘页面
│   ├── settings/         # 设置管理页面
│   │   ├── providers/    # 供应商管理
│   │   ├── logs/         # 日志查询
│   │   ├── prices/       # 价格管理
│   │   ├── config/       # 系统配置
│   │   ├── error-rules/  # 错误规则
│   │   ├── sensitive-words/ # 敏感词管理
│   │   ├── client-versions/ # 客户端版本
│   │   └── data/         # 数据管理
│   ├── login/            # 登录页面
│   └── usage-doc/        # 使用文档
├── api/                  # API 路由
│   ├── actions/          # Server Actions OpenAPI 端点
│   ├── auth/             # 认证 API
│   └── ...               # 其他 API
├── v1/                   # 代理 API 端点（核心）
│   ├── [...route]/       # 动态路由处理
│   └── _lib/             # 代理核心逻辑
├── v1beta/               # Beta 版本 API
├── globals.css           # 全局样式
├── providers.tsx         # React Context Providers
└── favicon.ico           # 网站图标
```

### v1/_lib/ 代理核心

这是代理功能的核心实现目录：

```
v1/_lib/
├── proxy/                # 代理管道组件
│   ├── guard-pipeline.ts # 守卫管道配置
│   ├── auth-guard.ts     # 认证守卫
│   ├── version-guard.ts  # 版本检查守卫
│   ├── session-guard.ts  # Session 管理守卫
│   ├── sensitive-word-guard.ts # 敏感词过滤守卫
│   ├── rate-limit-guard.ts # 限流守卫
│   ├── provider-selector.ts # 供应商选择器
│   ├── forwarder.ts      # 请求转发器
│   ├── response-handler.ts # 响应处理器
│   ├── error-handler.ts  # 错误处理器
│   ├── message-service.ts # 消息日志服务
│   ├── model-redirector.ts # 模型重定向
│   ├── format-mapper.ts  # 格式检测映射
│   ├── session.ts        # ProxySession 类
│   ├── errors.ts         # 错误定义
│   └── responses.ts      # 响应构造器
├── converters/           # 格式转换器
│   ├── claude-to-openai/ # Claude -> OpenAI 转换
│   ├── openai-to-claude/ # OpenAI -> Claude 转换
│   ├── codex-to-claude/  # Codex -> Claude 转换
│   ├── claude-to-codex/  # Claude -> Codex 转换
│   ├── gemini-cli-to-claude/ # Gemini CLI -> Claude
│   ├── gemini-cli-to-openai/ # Gemini CLI -> OpenAI
│   ├── registry.ts       # 转换器注册表
│   ├── types.ts          # 转换器类型定义
│   └── index.ts          # 自动注册入口
├── codex/                # Codex CLI 适配器
│   ├── codex-cli-adapter.ts
│   ├── constants/        # 指令常量
│   ├── types/            # 类型定义
│   └── utils/            # 工具函数
├── gemini/               # Gemini API 适配器
│   ├── adapter.ts
│   ├── auth.ts
│   ├── protocol.ts
│   └── types.ts
├── proxy-handler.ts      # 代理入口处理器
├── headers.ts            # 请求头处理
└── url.ts                # URL 构造工具
```

{% callout type="warning" title="核心文件" %}
`proxy-handler.ts` 是代理请求的主入口，串联整个守卫管道：

```typescript
const pipeline = GuardPipelineBuilder.fromRequestType(type);
const early = await pipeline.run(session);
if (early) return early;

const response = await ProxyForwarder.send(session);
return await ProxyResponseHandler.dispatch(session, response);
```
{% /callout %}

### 设置页面结构

每个设置子页面遵循统一结构：

```
settings/providers/
├── page.tsx              # 页面组件
└── _components/          # 页面专属组件
    ├── forms/            # 表单组件
    ├── hooks/            # 页面专用 Hooks
    └── ...
```

---

## actions/ 目录

Server Actions 实现业务逻辑，是 UI 与数据层的桥梁。

```
actions/
├── users.ts              # 用户管理
├── keys.ts               # API 密钥管理
├── providers.ts          # 供应商管理
├── statistics.ts         # 统计数据
├── usage-logs.ts         # 使用日志
├── overview.ts           # 概览数据
├── model-prices.ts       # 模型价格
├── error-rules.ts        # 错误规则
├── sensitive-words.ts    # 敏感词管理
├── active-sessions.ts    # 活跃 Session
├── notifications.ts      # 通知管理
├── system-config.ts      # 系统配置
├── client-versions.ts    # 客户端版本
├── concurrent-sessions.ts # 并发 Session
├── rate-limit-stats.ts   # 限流统计
└── types.ts              # Action 类型定义
```

所有 Action 通过 `@/lib/api/action-adapter-openapi.ts` 自动生成 OpenAPI 文档，访问：
- Swagger UI: `/api/actions/docs`
- Scalar UI: `/api/actions/scalar`
- OpenAPI JSON: `/api/actions/openapi.json`

---

## repository/ 目录

数据访问层，封装所有数据库查询逻辑。

```
repository/
├── user.ts               # 用户查询
├── key.ts                # 密钥查询
├── provider.ts           # 供应商查询
├── message.ts            # 消息日志查询
├── statistics.ts         # 统计查询
├── overview.ts           # 概览数据查询
├── leaderboard.ts        # 排行榜查询
├── model-price.ts        # 价格查询
├── error-rules.ts        # 错误规则查询
├── sensitive-words.ts    # 敏感词查询
├── system-config.ts      # 系统配置查询
├── notifications.ts      # 通知查询
├── client-versions.ts    # 客户端版本查询
├── usage-logs.ts         # 使用日志查询
├── activity-stream.ts    # 活动流查询
├── _shared/              # 共享转换器
│   └── transformers.ts
└── index.ts              # 统一导出
```

---

## drizzle/ 目录

数据库 Schema 定义和连接管理。

```
src/drizzle/
├── schema.ts             # 数据库表结构定义
├── db.ts                 # 数据库连接实例
└── index.ts              # 统一导出
```

根目录下的 `drizzle/` 存放迁移文件：

```
drizzle/
├── 0000_legal_brother_voodoo.sql
├── 0001_ambiguous_bromley.sql
├── ...
└── meta/                 # 迁移元数据
```

---

## lib/ 目录详解

共享工具库，包含核心业务逻辑和基础设施代码。

```
lib/
├── api/                  # API 适配器
│   └── action-adapter-openapi.ts  # Action -> OpenAPI 转换
├── availability/         # 可用性检测服务
├── cache/                # 缓存管理
│   └── session-cache.ts
├── config/               # 配置管理
│   ├── config.ts         # 配置读取
│   ├── env.schema.ts     # 环境变量 Schema
│   └── index.ts
├── constants/            # 常量定义
│   ├── provider.constants.ts
│   └── user.constants.ts
├── database-backup/      # 数据库备份工具
├── data-generator/       # 测试数据生成
├── hooks/                # 共享 React Hooks
│   ├── use-debounce.ts
│   ├── use-format-currency.ts
│   └── use-zod-form.tsx
├── log-cleanup/          # 日志清理服务
├── mcp/                  # MCP 客户端
├── notification/         # 通知服务
├── permissions/          # 权限管理
├── polyfills/            # Polyfills
├── price-sync/           # 价格同步服务
├── provider-testing/     # 供应商测试
├── rate-limit/           # 限流服务
│   ├── service.ts        # 限流核心逻辑
│   ├── time-utils.ts     # 时间窗口计算
│   └── index.ts
├── redis/                # Redis 工具
│   ├── client.ts         # Redis 客户端
│   ├── circuit-breaker-config.ts
│   ├── leaderboard-cache.ts
│   ├── lua-scripts.ts    # Lua 原子脚本
│   ├── session-stats.ts
│   └── index.ts
├── utils/                # 通用工具函数
│   ├── cn.ts             # className 合并
│   ├── cost-calculation.ts # 成本计算
│   ├── currency.ts       # 货币格式化
│   ├── date.ts           # 日期工具
│   ├── date-format.ts    # 日期格式化
│   ├── sse.ts            # SSE 工具
│   ├── token.ts          # Token 工具
│   ├── quota-helpers.ts  # 配额计算
│   ├── error-messages.ts # 错误消息
│   ├── validation/       # 验证工具
│   └── index.ts
├── validation/           # Zod 验证 Schema
│   └── schemas.ts
├── wechat/               # 企业微信通知
├── auth.ts               # 认证工具
├── circuit-breaker.ts    # 熔断器实现
├── circuit-breaker-loader.ts
├── circuit-breaker-probe.ts
├── client-version-checker.ts
├── codex-instructions-cache.ts
├── error-override-validator.ts
├── error-rule-detector.ts # 错误规则检测
├── event-emitter.ts      # 事件发射器
├── logger.ts             # 日志工具（Pino）
├── message-extractor.ts  # 消息提取
├── migrate.ts            # 数据库迁移
├── price-sync.ts         # 价格同步
├── provider-type-utils.tsx
├── proxy-agent.ts        # 代理 Agent 创建
├── proxy-status-tracker.ts # 代理状态追踪
├── sensitive-word-detector.ts # 敏感词检测
├── session-manager.ts    # Session 管理器
├── session-tracker.ts    # Session 追踪
├── ua-parser.ts          # User-Agent 解析
└── version.ts            # 版本信息
```

{% callout title="核心服务" %}
以下是最重要的业务逻辑文件：

- `circuit-breaker.ts` - 熔断器状态机实现
- `session-manager.ts` - Session 粘性管理
- `rate-limit/service.ts` - 多维度限流（RPM、金额、并发）
- `proxy-agent.ts` - HTTP/SOCKS 代理支持
{% /callout %}

---

## components/ 目录

React 组件库，分为 UI 基础组件和业务组件。

```
components/
├── ui/                   # 基础 UI 组件（shadcn/ui）
│   ├── button.tsx
│   ├── card.tsx
│   ├── dialog.tsx
│   ├── input.tsx
│   ├── select.tsx
│   ├── table.tsx
│   ├── data-table.tsx
│   ├── chart.tsx
│   └── ...
├── customs/              # 自定义业务组件
│   ├── active-sessions-list.tsx
│   ├── active-sessions-panel.tsx
│   ├── concurrent-sessions-card.tsx
│   ├── metric-card.tsx
│   ├── overview-panel.tsx
│   ├── session-card.tsx
│   ├── version-checker.tsx
│   └── footer.tsx
├── form/                 # 表单组件
│   ├── form-field.tsx
│   └── form-layout.tsx
├── quota/                # 配额相关组件
│   ├── quota-countdown.tsx
│   ├── quota-progress.tsx
│   ├── quota-toolbar.tsx
│   └── user-quota-header.tsx
├── section.tsx           # 页面区块组件
├── error-boundary.tsx    # 错误边界
└── form-error-boundary.tsx
```

---

## types/ 目录

TypeScript 类型定义。

```
types/
├── provider.ts           # 供应商类型
├── user.ts               # 用户类型
├── key.ts                # 密钥类型
├── message.ts            # 消息类型
├── session.ts            # Session 类型
├── statistics.ts         # 统计类型
├── model-price.ts        # 价格类型
├── proxy-status.ts       # 代理状态类型
├── system-config.ts      # 系统配置类型
├── database-backup.ts    # 备份类型
└── safe-regex.d.ts       # 第三方库类型声明
```

---

## 关键文件说明

### proxy-handler.ts

代理请求的主入口，负责：
1. 创建 ProxySession 上下文
2. 检测请求格式（Claude/OpenAI/Codex/Gemini）
3. 构建并执行守卫管道
4. 转发请求并处理响应

### guard-pipeline.ts

守卫管道配置，定义请求处理流程：

```typescript
// Chat 请求完整管道
const CHAT_PIPELINE: GuardConfig = {
  steps: [
    "auth",         // 认证
    "version",      // 版本检查
    "probe",        // 探测请求处理
    "session",      // Session 管理
    "sensitive",    // 敏感词过滤
    "rateLimit",    // 限流检查
    "provider",     // 供应商选择
    "messageContext", // 日志上下文
  ],
};

// count_tokens 请求精简管道
const COUNT_TOKENS_PIPELINE: GuardConfig = {
  steps: ["auth", "version", "probe", "provider"],
};
```

### provider-selector.ts

智能供应商选择器，实现：
- 权重随机选择
- 优先级排序
- 熔断器状态检查
- Session 粘性
- 模型支持检测

### converters/

格式转换器系统，支持双向转换：
- Claude Messages API <-> OpenAI Chat Completions
- Claude Messages API <-> Codex Response API
- Claude Messages API <-> Gemini API

---

## 命名约定

### 文件命名

| 类型 | 约定 | 示例 |
|------|------|------|
| 页面 | `page.tsx` | `app/[locale]/dashboard/page.tsx` |
| 布局 | `layout.tsx` | `app/[locale]/layout.tsx` |
| 组件 | kebab-case | `metric-card.tsx` |
| Hook | camelCase，use 前缀 | `useCountdown.ts` |
| 工具 | kebab-case | `cost-calculation.ts` |
| 类型 | kebab-case | `provider.ts` |

### 导出约定

- 页面组件：默认导出
- 工具函数：命名导出
- 类型：命名导出
- 组件：命名导出

### 代码风格

- 2 空格缩进
- 单引号字符串
- 尾随逗号
- TypeScript 严格模式

---

## 模块依赖关系

```
┌─────────────────────────────────────────────────────────┐
│                      UI Layer                           │
│  app/[locale]/*  →  components/*  →  hooks/*            │
└────────────────────────┬────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────┐
│                   Actions Layer                         │
│                    actions/*                            │
└────────────────────────┬────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────┐
│                 Repository Layer                        │
│                   repository/*                          │
└────────────────────────┬────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────┐
│                  Database Layer                         │
│              drizzle/* (Schema + DB)                    │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│                   Proxy Layer                           │
│  app/v1/_lib/*  →  lib/circuit-breaker.ts              │
│                 →  lib/session-manager.ts              │
│                 →  lib/rate-limit/*                    │
│                 →  lib/redis/*                         │
└─────────────────────────────────────────────────────────┘
```

依赖规则：
1. UI 层只依赖 Actions 和 Components
2. Actions 依赖 Repository，不直接操作数据库
3. Repository 依赖 Drizzle Schema
4. Proxy 层独立于 UI，直接使用 lib/ 工具
5. lib/ 是共享层，被所有层依赖

---

## 下一步

- [开发环境搭建](/docs/developer/setup) - 配置本地开发环境
- [代理管道详解](/docs/architecture/proxy-pipeline) - 深入理解代理实现
- [贡献指南](/docs/developer/contributing) - 参与项目开发
