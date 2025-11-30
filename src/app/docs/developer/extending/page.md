---
title: 扩展开发
description: 了解如何扩展 Claude Code Hub 的功能，包括添加新供应商类型、格式转换器、Guard 和 Server Actions
---

# 扩展开发

Claude Code Hub 采用模块化设计，提供多个扩展点供二次开发。本文档介绍如何扩展系统的各个核心组件。

---

## 扩展点概述

CCH 提供以下主要扩展点：

| 扩展点 | 位置 | 用途 |
|--------|------|------|
| 供应商类型 | `src/types/provider.ts` | 添加新的 AI 服务供应商类型 |
| 格式转换器 | `src/app/v1/_lib/converters/` | 支持新的 API 格式转换 |
| Guard Pipeline | `src/app/v1/_lib/proxy/guard-pipeline.ts` | 添加新的请求处理守卫 |
| Server Actions | `src/actions/` | 添加新的后台管理 API |
| UI 组件 | `src/app/[locale]/` | 扩展管理界面功能 |
| 环境变量 | `src/lib/config/env.schema.ts` | 添加新的配置项 |

---

## 添加新供应商类型

当需要支持新的 AI 服务供应商（如自建模型服务）时，需要修改多个文件。

### 步骤 1：修改类型定义

编辑 `src/types/provider.ts`，添加新的供应商类型：

```typescript
// src/types/provider.ts
export type ProviderType =
  | "claude"
  | "claude-auth"
  | "codex"
  | "gemini"
  | "gemini-cli"
  | "openai-compatible"
  | "your-new-type";  // 添加新类型
```

### 步骤 2：更新数据库 Schema

编辑 `src/drizzle/schema.ts`，更新 `providerType` 字段的类型约束：

```typescript
// src/drizzle/schema.ts
providerType: varchar('provider_type', { length: 20 })
  .notNull()
  .default('claude')
  .$type<'claude' | 'claude-auth' | 'codex' | 'gemini-cli' | 'gemini' | 'openai-compatible' | 'your-new-type'>(),
```

{% callout type="warning" title="数据库迁移" %}
修改 Schema 后需要生成并执行数据库迁移：
```bash
bun run db:generate
bun run db:migrate
```
{% /callout %}

### 步骤 3：添加格式映射

如果新供应商使用独特的 API 格式，需要在 `src/app/v1/_lib/proxy/format-mapper.ts` 中添加映射：

```typescript
// src/app/v1/_lib/proxy/format-mapper.ts

// 1. 添加到 ClientFormat 类型
export type ClientFormat = "response" | "openai" | "claude" | "gemini" | "gemini-cli" | "your-format";

// 2. 添加端点检测规则
const endpointPatterns: Array<{ pattern: RegExp; format: ClientFormat }> = [
  // ... 现有规则
  { pattern: /^\/v1\/your-endpoint$/i, format: "your-format" },
];

// 3. 添加格式转换映射
export function mapClientFormatToTransformer(clientFormat: ClientFormat): Format {
  switch (clientFormat) {
    // ... 现有映射
    case "your-format":
      return "your-new-type";
    // ...
  }
}
```

### 步骤 4：更新 UI 表单

编辑供应商表单组件，添加新类型的选项：

```typescript
// src/app/[locale]/settings/providers/_components/forms/provider-form.tsx

const PROVIDER_TYPES = [
  { value: "claude", label: "Claude (Anthropic)" },
  { value: "claude-auth", label: "Claude 中转服务" },
  { value: "codex", label: "Codex CLI" },
  { value: "gemini-cli", label: "Gemini CLI" },
  { value: "openai-compatible", label: "OpenAI Compatible" },
  { value: "your-new-type", label: "您的新类型" },  // 添加
];
```

### 步骤 5：添加测试预设（可选）

如果新供应商需要特定的测试逻辑，编辑 `src/lib/provider-testing/presets.ts`：

```typescript
// src/lib/provider-testing/presets.ts
export function getPresetsForProvider(providerType: ProviderType): PresetConfig[] {
  switch (providerType) {
    // ... 现有预设
    case "your-new-type":
      return [
        {
          name: "基础测试",
          endpoint: "/v1/your-endpoint",
          // ... 测试配置
        },
      ];
  }
}
```

---

## 添加新格式转换器

格式转换器负责在不同 API 格式之间转换请求和响应。

### 转换器接口

转换器需要实现以下接口：

```typescript
// src/app/v1/_lib/converters/types.ts

// API 格式类型
export type Format = "claude" | "codex" | "gemini-cli" | "openai-compatible";

// 请求转换函数
export type RequestTransform = (
  model: string,
  rawJSON: Record<string, unknown>,
  stream: boolean
) => Record<string, unknown>;

// 流式响应转换函数
export type ResponseStreamTransform = (
  ctx: Context,
  model: string,
  originalRequest: Record<string, unknown>,
  transformedRequest: Record<string, unknown>,
  chunk: string,
  state?: TransformState
) => string[];

// 非流式响应转换函数
export type ResponseNonStreamTransform = (
  ctx: Context,
  model: string,
  originalRequest: Record<string, unknown>,
  transformedRequest: Record<string, unknown>,
  response: Record<string, unknown>
) => Record<string, unknown>;

// 响应转换器
export interface ResponseTransform {
  stream?: ResponseStreamTransform;
  nonStream?: ResponseNonStreamTransform;
}
```

### 创建转换器模块

以 `your-format` 到 `claude` 的转换为例：

```
src/app/v1/_lib/converters/your-format-to-claude/
├── index.ts      # 注册入口
├── request.ts    # 请求转换逻辑
└── response.ts   # 响应转换逻辑
```

#### 请求转换器

```typescript
// src/app/v1/_lib/converters/your-format-to-claude/request.ts
import { logger } from "@/lib/logger";

export function transformYourFormatRequestToClaude(
  model: string,
  rawJSON: Record<string, unknown>,
  stream: boolean
): Record<string, unknown> {
  logger.debug("[YourFormat→Claude] Transforming request", { model, stream });

  // 转换请求格式
  const claudeRequest = {
    model,
    max_tokens: rawJSON.max_tokens ?? 4096,
    messages: transformMessages(rawJSON.messages as any[]),
    stream,
    // ... 其他字段转换
  };

  return claudeRequest;
}

function transformMessages(messages: any[]): any[] {
  // 实现消息格式转换
  return messages.map(msg => ({
    role: msg.role,
    content: msg.content,
  }));
}
```

#### 响应转换器

```typescript
// src/app/v1/_lib/converters/your-format-to-claude/response.ts
import type { Context } from "hono";
import type { TransformState } from "../types";
import { logger } from "@/lib/logger";

export function transformClaudeStreamResponseToYourFormat(
  ctx: Context,
  model: string,
  originalRequest: Record<string, unknown>,
  transformedRequest: Record<string, unknown>,
  chunk: string,
  state?: TransformState
): string[] {
  // 解析 SSE chunk
  if (!chunk.startsWith("data: ")) {
    return [chunk];
  }

  const data = chunk.slice(6);
  if (data === "[DONE]") {
    return ["data: [DONE]\n\n"];
  }

  try {
    const parsed = JSON.parse(data);
    // 转换响应格式
    const transformed = {
      // ... 转换逻辑
    };
    return [`data: ${JSON.stringify(transformed)}\n\n`];
  } catch (error) {
    logger.warn("[Claude→YourFormat] Failed to parse chunk", { error });
    return [chunk];
  }
}

export function transformClaudeNonStreamResponseToYourFormat(
  ctx: Context,
  model: string,
  originalRequest: Record<string, unknown>,
  transformedRequest: Record<string, unknown>,
  response: Record<string, unknown>
): Record<string, unknown> {
  // 转换非流式响应
  return {
    // ... 转换逻辑
  };
}
```

### 注册转换器

```typescript
// src/app/v1/_lib/converters/your-format-to-claude/index.ts
import { registerTransformer } from "../registry";
import { transformYourFormatRequestToClaude } from "./request";
import {
  transformClaudeStreamResponseToYourFormat,
  transformClaudeNonStreamResponseToYourFormat,
} from "./response";

// 注册 YourFormat → Claude 转换器
registerTransformer("your-format", "claude", transformYourFormatRequestToClaude, {
  stream: transformClaudeStreamResponseToYourFormat,
  nonStream: transformClaudeNonStreamResponseToYourFormat,
});
```

### 激活转换器

在 `src/app/v1/_lib/converters/index.ts` 中导入新转换器：

```typescript
// src/app/v1/_lib/converters/index.ts

// 导入转换器（副作用：自动注册到 defaultRegistry）
import "./codex-to-claude";
import "./openai-to-claude";
// ... 现有导入
import "./your-format-to-claude";  // 添加新转换器
```

---

## 扩展 Guard Pipeline

Guard Pipeline 是请求处理的核心链路，用于认证、限流、供应商选择等。

### Guard 接口

每个 Guard 需要实现以下接口：

```typescript
// src/app/v1/_lib/proxy/guard-pipeline.ts

export interface GuardStep {
  name: string;
  execute(session: ProxySession): Promise<Response | null>;
}
```

- 返回 `null`：继续执行下一个 Guard
- 返回 `Response`：提前终止 Pipeline，返回该响应

### 创建新 Guard

```typescript
// src/app/v1/_lib/proxy/your-guard.ts
import type { ProxySession } from "./session";
import { ProxyResponses } from "./responses";
import { logger } from "@/lib/logger";

export class YourGuard {
  static async ensure(session: ProxySession): Promise<Response | null> {
    logger.debug("[YourGuard] Checking request", {
      userId: session.authState?.user?.id,
    });

    // 执行检查逻辑
    const isValid = await yourValidationLogic(session);

    if (!isValid) {
      // 返回错误响应，终止 Pipeline
      return ProxyResponses.buildError(403, "检查未通过");
    }

    // 检查通过，继续下一个 Guard
    return null;
  }
}

async function yourValidationLogic(session: ProxySession): Promise<boolean> {
  // 实现自定义验证逻辑
  return true;
}
```

### 注册 Guard

在 `guard-pipeline.ts` 中注册新 Guard：

```typescript
// src/app/v1/_lib/proxy/guard-pipeline.ts
import { YourGuard } from "./your-guard";

// 1. 添加 Guard Key
export type GuardStepKey =
  | "auth"
  | "version"
  | "probe"
  | "session"
  | "sensitive"
  | "rateLimit"
  | "provider"
  | "messageContext"
  | "yourGuard";  // 添加

// 2. 注册 Guard 实现
const Steps: Record<GuardStepKey, GuardStep> = {
  // ... 现有 Guards
  yourGuard: {
    name: "yourGuard",
    async execute(session) {
      return YourGuard.ensure(session);
    },
  },
};

// 3. 添加到 Pipeline 配置
export const CHAT_PIPELINE: GuardConfig = {
  steps: [
    "auth",
    "version",
    "probe",
    "session",
    "sensitive",
    "yourGuard",  // 在适当位置添加
    "rateLimit",
    "provider",
    "messageContext",
  ],
};
```

{% callout type="note" title="Guard 顺序" %}
Guard 的执行顺序很重要。通常建议：
1. 认证 Guard 在最前面
2. 限流 Guard 在供应商选择之前
3. 日志记录 Guard 在最后
{% /callout %}

---

## 添加新 Server Action

Server Actions 提供后台管理 API，自动生成 OpenAPI 文档。

### Action 结构

每个 Action 模块遵循以下结构：

```typescript
// src/actions/your-module.ts
"use server";

import { getSession } from "@/lib/auth";
import { logger } from "@/lib/logger";
import type { ActionResult } from "./types";

/**
 * 获取数据列表
 */
export async function getYourDataList(): Promise<ActionResult<YourData[]>> {
  try {
    const session = await getSession();
    if (!session || session.user.role !== "admin") {
      return { success: false, error: "权限不足" };
    }

    const data = await fetchYourData();
    return { success: true, data };
  } catch (error) {
    logger.error("获取数据失败:", error);
    return { success: false, error: "获取数据失败" };
  }
}

/**
 * 创建数据
 */
export async function createYourData(
  input: CreateYourDataInput
): Promise<ActionResult<YourData>> {
  try {
    const session = await getSession();
    if (!session || session.user.role !== "admin") {
      return { success: false, error: "权限不足" };
    }

    // 验证输入
    const validated = CreateYourDataSchema.safeParse(input);
    if (!validated.success) {
      return { success: false, error: validated.error.message };
    }

    const data = await insertYourData(validated.data);
    return { success: true, data };
  } catch (error) {
    logger.error("创建数据失败:", error);
    return { success: false, error: "创建数据失败" };
  }
}
```

### Zod Schema 定义

在 `src/lib/validation/schemas.ts` 中定义验证 Schema：

```typescript
// src/lib/validation/schemas.ts
import { z } from "zod";

export const CreateYourDataSchema = z.object({
  name: z.string().min(1, "名称不能为空").max(64, "名称不能超过64个字符"),
  description: z.string().max(200, "描述不能超过200个字符").optional(),
  isEnabled: z.boolean().default(true),
  config: z.record(z.unknown()).optional(),
});

export const UpdateYourDataSchema = CreateYourDataSchema.partial();

export type CreateYourDataInput = z.infer<typeof CreateYourDataSchema>;
export type UpdateYourDataInput = z.infer<typeof UpdateYourDataSchema>;
```

### 注册 OpenAPI 端点

在 `src/app/api/actions/[...route]/route.ts` 中注册 Action：

```typescript
// src/app/api/actions/[...route]/route.ts
import * as yourModuleActions from "@/actions/your-module";
import { CreateYourDataSchema, UpdateYourDataSchema } from "@/lib/validation/schemas";

// 获取列表
const { route: getYourDataListRoute, handler: getYourDataListHandler } = createActionRoute(
  "your-module",
  "getYourDataList",
  yourModuleActions.getYourDataList,
  {
    description: "获取数据列表 (管理员)",
    tags: ["您的模块"],
    requiredRole: "admin",
  }
);
app.openapi(getYourDataListRoute, getYourDataListHandler);

// 创建数据
const { route: createYourDataRoute, handler: createYourDataHandler } = createActionRoute(
  "your-module",
  "createYourData",
  yourModuleActions.createYourData,
  {
    requestSchema: CreateYourDataSchema,
    description: "创建数据 (管理员)",
    tags: ["您的模块"],
    requiredRole: "admin",
  }
);
app.openapi(createYourDataRoute, createYourDataHandler);

// 更新文档标签
app.doc("/openapi.json", {
  // ...
  tags: [
    // ... 现有标签
    { name: "您的模块", description: "您的模块管理" },
  ],
});
```

---

## 扩展 UI 功能

### 添加新页面

创建新的管理页面：

```
src/app/[locale]/settings/your-page/
├── page.tsx              # 页面组件
└── _components/          # 页面专用组件
    ├── your-list.tsx
    └── your-form.tsx
```

```typescript
// src/app/[locale]/settings/your-page/page.tsx
import { getTranslations } from "next-intl/server";
import { YourList } from "./_components/your-list";

export default async function YourPage() {
  const t = await getTranslations("yourPage");

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{t("title")}</h1>
      </div>
      <YourList />
    </div>
  );
}
```

### 组件开发

使用项目的 UI 组件库：

```typescript
// src/app/[locale]/settings/your-page/_components/your-form.tsx
"use client";

import { useState } from "react";
import { Button, Form, Input, message } from "antd";
import { createYourData } from "@/actions/your-module";

export function YourForm() {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (values: any) => {
    setLoading(true);
    try {
      const result = await createYourData(values);
      if (result.success) {
        message.success("创建成功");
        form.resetFields();
      } else {
        message.error(result.error);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <Form form={form} onFinish={handleSubmit} layout="vertical">
      <Form.Item
        name="name"
        label="名称"
        rules={[{ required: true, message: "请输入名称" }]}
      >
        <Input placeholder="输入名称" />
      </Form.Item>
      <Form.Item>
        <Button type="primary" htmlType="submit" loading={loading}>
          提交
        </Button>
      </Form.Item>
    </Form>
  );
}
```

### 国际化

添加翻译文件：

```json
// messages/zh-CN/yourPage.json
{
  "title": "您的页面",
  "create": "创建",
  "edit": "编辑",
  "delete": "删除",
  "name": "名称",
  "description": "描述",
  "confirmDelete": "确定要删除吗？"
}
```

```json
// messages/en-US/yourPage.json
{
  "title": "Your Page",
  "create": "Create",
  "edit": "Edit",
  "delete": "Delete",
  "name": "Name",
  "description": "Description",
  "confirmDelete": "Are you sure you want to delete?"
}
```

在组件中使用：

```typescript
import { useTranslations } from "next-intl";

export function YourComponent() {
  const t = useTranslations("yourPage");

  return <h1>{t("title")}</h1>;
}
```

---

## 添加新环境变量

### 定义 Schema

在 `src/lib/config/env.schema.ts` 中添加新变量：

```typescript
// src/lib/config/env.schema.ts
import { z } from "zod";

const booleanTransform = (s: string) => s !== "false" && s !== "0";

export const EnvSchema = z.object({
  // ... 现有变量

  // 新增变量
  YOUR_NEW_VAR: z.string().optional(),
  YOUR_BOOLEAN_VAR: z.string().default("false").transform(booleanTransform),
  YOUR_NUMBER_VAR: z.coerce.number().default(100),
});

export type EnvConfig = z.infer<typeof EnvSchema>;
```

{% callout type="warning" title="布尔值处理" %}
不要使用 `z.coerce.boolean()`，因为 `Boolean("false") === true`。
使用 `transform` 显式处理 `"false"` 和 `"0"` 字符串。
{% /callout %}

### 使用环境变量

```typescript
import { getEnvConfig } from "@/lib/config/env.schema";

export function yourFunction() {
  const env = getEnvConfig();

  if (env.YOUR_BOOLEAN_VAR) {
    // 功能启用时的逻辑
  }

  const limit = env.YOUR_NUMBER_VAR;
  // ...
}
```

### 更新文档

在 `.env.example` 中添加示例：

```bash
# 您的新功能配置
YOUR_NEW_VAR=example-value
YOUR_BOOLEAN_VAR=true
YOUR_NUMBER_VAR=100
```

---

## 扩展最佳实践

### 代码组织

- 遵循现有的目录结构和命名规范
- 相关文件放在同一目录下
- 使用 `_components` 目录存放页面专用组件
- 公共组件放在 `src/components` 目录

### 类型安全

- 所有新代码必须使用 TypeScript
- 定义明确的接口和类型
- 使用 Zod 进行运行时验证
- 避免使用 `any` 类型

### 错误处理

```typescript
// 推荐的错误处理模式
export async function yourAction(): Promise<ActionResult<Data>> {
  try {
    // 业务逻辑
    return { success: true, data };
  } catch (error) {
    logger.error("操作失败:", {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    return { success: false, error: "操作失败，请稍后重试" };
  }
}
```

### 日志记录

```typescript
import { logger } from "@/lib/logger";

// 使用适当的日志级别
logger.trace("详细调试信息");
logger.debug("调试信息");
logger.info("一般信息");
logger.warn("警告信息");
logger.error("错误信息", { error });
```

### 测试

- 为新功能编写单元测试
- 格式转换器需要覆盖流式和非流式场景
- Guard 需要测试正常和异常情况

```typescript
// 测试示例
import { describe, it, expect } from "bun:test";
import { transformYourFormatRequestToClaude } from "./request";

describe("YourFormat to Claude Request Transform", () => {
  it("should transform basic request", () => {
    const input = { /* ... */ };
    const result = transformYourFormatRequestToClaude("model", input, false);
    expect(result.model).toBe("model");
    // ...
  });
});
```

---

## 相关资源

- [架构设计](/docs/developer/architecture) - 了解系统整体架构
- [代码结构](/docs/developer/code-structure) - 了解项目代码组织
- [贡献指南](/docs/developer/contributing) - 如何参与项目开发
