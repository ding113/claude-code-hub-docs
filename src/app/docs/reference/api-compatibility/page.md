---
dimensions:
  type:
    primary: reference
    detail: api
  level: intermediate
standard_title: API 兼容层
language: zh
---

# API 兼容层

Claude Code Hub 提供了完整的 API 兼容层，支持 Claude Messages API、OpenAI Chat Completions API 和 Codex Response API 三种主流格式。系统能够自动检测请求格式并进行双向转换，使您可以使用任何兼容的客户端工具无缝接入。

{% callout type="note" title="设计目标" %}
API 兼容层的核心设计目标是**透明代理**：无论您使用 Claude Code、Codex CLI、Cursor 还是其他 AI 编程工具，都可以直接连接 Claude Code Hub，无需修改客户端配置或代码。
{% /callout %}

---

## 支持的 API 格式

系统内部定义了四种 API 格式类型，用于请求和响应的自动转换：

| 格式标识 | 说明 | 典型客户端 |
|----------|------|------------|
| `claude` | Anthropic Claude Messages API | Claude Code、官方 SDK |
| `codex` | OpenAI Codex Response API | Codex CLI |
| `openai-compatible` | OpenAI Chat Completions API | Cursor、第三方工具 |
| `gemini-cli` | Google Gemini CLI 格式 | Gemini CLI |

转换器注册表（`TransformerRegistry`）管理所有格式之间的转换函数，支持请求转换和流式/非流式响应转换。

---

## Claude Messages API

Claude Messages API 是 Anthropic 官方的 API 格式，也是 Claude Code Hub 的原生格式。

### 端点

```
POST /v1/messages
POST /v1/messages/count_tokens
```

### 请求格式

```json
{
  "model": "claude-sonnet-4-20250514",
  "max_tokens": 8192,
  "system": "You are a helpful coding assistant.",
  "messages": [
    {
      "role": "user",
      "content": "请帮我写一个 Python 函数"
    }
  ],
  "stream": true
}
```

### 请求字段说明

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `model` | string | 是 | 模型名称 |
| `max_tokens` | number | 是 | 最大输出 Token 数 |
| `messages` | array | 是 | 消息数组 |
| `system` | string/array | 否 | 系统提示词 |
| `stream` | boolean | 否 | 是否使用流式响应 |
| `tools` | array | 否 | 工具定义 |
| `tool_choice` | object | 否 | 工具选择策略 |
| `temperature` | number | 否 | 温度参数 (0-1) |
| `top_p` | number | 否 | Top-p 采样参数 |

### 消息内容格式

消息内容支持文本和多模态格式：

```json
{
  "role": "user",
  "content": [
    {
      "type": "text",
      "text": "这张图片里有什么？"
    },
    {
      "type": "image",
      "source": {
        "type": "base64",
        "media_type": "image/png",
        "data": "iVBORw0KGgo..."
      }
    }
  ]
}
```

### 工具调用格式

Claude API 的工具调用使用 `tool_use` 和 `tool_result` 类型：

```json
{
  "role": "assistant",
  "content": [
    {
      "type": "tool_use",
      "id": "toolu_01ABC",
      "name": "read_file",
      "input": {
        "path": "/src/main.ts"
      }
    }
  ]
}
```

```json
{
  "role": "user",
  "content": [
    {
      "type": "tool_result",
      "tool_use_id": "toolu_01ABC",
      "content": "文件内容..."
    }
  ]
}
```

### 流式响应格式 (SSE)

Claude API 使用 Server-Sent Events (SSE) 进行流式响应：

```
event: message_start
data: {"type":"message_start","message":{"id":"msg_01ABC","type":"message","role":"assistant","model":"claude-sonnet-4-20250514"}}

event: content_block_start
data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}

event: content_block_stop
data: {"type":"content_block_stop","index":0}

event: message_delta
data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":10}}

event: message_stop
data: {"type":"message_stop"}
```

### 非流式响应格式

```json
{
  "id": "msg_01ABC",
  "type": "message",
  "role": "assistant",
  "model": "claude-sonnet-4-20250514",
  "content": [
    {
      "type": "text",
      "text": "这是响应内容..."
    }
  ],
  "stop_reason": "end_turn",
  "usage": {
    "input_tokens": 100,
    "output_tokens": 50
  }
}
```

---

## OpenAI Chat Completions API

Claude Code Hub 完全兼容 OpenAI Chat Completions API 格式，支持 Cursor、ChatGPT 客户端等工具直接连接。

### 端点

```
POST /v1/chat/completions
```

### 请求格式

```json
{
  "model": "claude-sonnet-4-20250514",
  "messages": [
    {
      "role": "system",
      "content": "You are a helpful assistant."
    },
    {
      "role": "user",
      "content": "Hello!"
    }
  ],
  "stream": true,
  "max_tokens": 8192
}
```

### 格式自动检测

系统通过以下规则自动检测请求格式：

- 包含 `messages` 数组 → OpenAI Chat Completions 格式
- 包含 `input` 数组 → Response API (Codex) 格式

```typescript
const isOpenAIFormat = "messages" in request && Array.isArray(request.messages);
const isResponseAPIFormat = "input" in request && Array.isArray(request.input);
```

### OpenAI → Claude 字段映射

| OpenAI 字段 | Claude 字段 | 说明 |
|-------------|-------------|------|
| `messages[role=system]` | `system` | System 消息提取到顶级字段 |
| `messages[role=user/assistant]` | `messages` | 保持角色不变 |
| `messages[].content` (string) | `content` (string) | 简单文本直接透传 |
| `messages[].content[type=text]` | `content[type=text]` | 文本内容 |
| `messages[].content[type=image_url]` | `content[type=image]` | 图片内容转换 |
| `messages[role=tool]` | `content[type=tool_result]` | 工具结果转换 |
| `tool_calls` | `content[type=tool_use]` | 工具调用转换 |
| `tools[].function` | `tools[]` | 工具定义转换 |
| `tools[].function.parameters` | `input_schema` | 参数 Schema 字段名变更 |
| `tool_choice` | `tool_choice` | 策略值映射 |
| `max_tokens` | `max_tokens` | 直接透传（默认 32000） |
| `temperature` | `temperature` | 直接透传 |
| `top_p` | `top_p` | 直接透传 |

### tool_choice 值映射

| OpenAI 值 | Claude 值 |
|-----------|-----------|
| `"auto"` | `{ type: "auto" }` |
| `"required"` | `{ type: "any" }` |
| `"none"` | 不设置 |
| `{ type: "function", function: { name } }` | `{ type: "tool", name }` |

### 图片内容转换

OpenAI 格式的 `image_url` 转换为 Claude 的 `image` 格式：

**OpenAI 格式：**
```json
{
  "type": "image_url",
  "image_url": {
    "url": "data:image/png;base64,iVBORw0..."
  }
}
```

**转换后 Claude 格式：**
```json
{
  "type": "image",
  "source": {
    "type": "base64",
    "media_type": "image/png",
    "data": "iVBORw0..."
  }
}
```

### 流式响应格式

OpenAI 格式的流式响应：

```
data: {"id":"chatcmpl-xxx","object":"chat.completion.chunk","model":"claude-sonnet-4-20250514","choices":[{"index":0,"delta":{"content":"Hello"},"finish_reason":null}]}

data: {"id":"chatcmpl-xxx","object":"chat.completion.chunk","model":"claude-sonnet-4-20250514","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}

data: [DONE]
```

---

## Codex Response API

Codex Response API 是 OpenAI Codex CLI 使用的格式，Claude Code Hub 提供完整支持。

### 端点

```
POST /v1/responses
```

### 请求格式

```json
{
  "model": "gpt-5-codex",
  "instructions": "You are a coding agent...",
  "input": [
    {
      "type": "input_text",
      "text": "帮我实现一个排序算法"
    }
  ],
  "stream": true,
  "max_output_tokens": 16000
}
```

### Claude → Codex 字段映射

| Claude 字段 | Codex 字段 | 说明 |
|-------------|------------|------|
| `system` | `instructions` | 系统提示词 |
| `messages[]` | `input[]` | 消息数组 |
| `user` + text | `input_text` | 用户文本消息 |
| `assistant` + text | `output_text` | 助手文本消息 |
| `user` + image | `input_image` | 图片消息（Data URL） |
| `tool_use` | `function_call` | 工具调用 |
| `tool_result` | `function_call_output` | 工具结果 |
| `tools[]` | 转换后的工具数组 | 工具名称缩短处理 |
| `max_tokens` | `max_output_tokens` | 最大输出 Token |

### 消息类型转换示例

**用户文本消息：**
```json
// Claude 格式
{ "role": "user", "content": "Hello" }

// 转换为 Codex 格式
{ "type": "input_text", "text": "Hello" }
```

**助手文本消息：**
```json
// Claude 格式
{ "role": "assistant", "content": "Hi there!" }

// 转换为 Codex 格式
{ "type": "output_text", "text": "Hi there!" }
```

**图片消息：**
```json
// Claude 格式
{
  "role": "user",
  "content": [
    {
      "type": "image",
      "source": {
        "type": "base64",
        "media_type": "image/png",
        "data": "iVBORw0..."
      }
    }
  ]
}

// 转换为 Codex 格式
{
  "type": "input_image",
  "image_url": "data:image/png;base64,iVBORw0..."
}
```

**工具调用：**
```json
// Claude 格式
{
  "type": "tool_use",
  "id": "toolu_01ABC",
  "name": "Read",
  "input": { "path": "/src/main.ts" }
}

// 转换为 Codex 格式
{
  "type": "function_call",
  "call_id": "toolu_01ABC",
  "name": "Read",
  "arguments": "{\"path\":\"/src/main.ts\"}"
}
```

### 工具名称映射

系统会将 Claude Code 的长工具名映射为 Codex 使用的短名称：

| 原始名称 | 短名称 |
|----------|--------|
| `Bash` | `Bash` |
| `Read` | `Read` |
| `Edit` | `Edit` |
| `Write` | `Write` |
| `Glob` | `Glob` |
| `Grep` | `Grep` |
| `WebFetch` | `WebFetch` |
| `TodoWrite` | `TodoWrite` |
| `NotebookEdit` | `NotebookEdit` |
| `mcp__*` | 保持原名 |

### SSE 事件映射

流式响应时，Claude 的 SSE 事件会转换为 Codex 格式：

| Claude 事件 | Codex 事件 |
|-------------|------------|
| `message_start` | `response.created` |
| `content_block_start (thinking)` | `response.reasoning_summary_part.added` |
| `content_block_delta (thinking_delta)` | `response.reasoning_summary_text.delta` |
| `content_block_delta (text_delta)` | `response.output_text.delta` |
| `content_block_start (tool_use)` | `response.output_item.added` |
| `content_block_delta (input_json_delta)` | `response.function_call_arguments.delta` |
| `message_delta + message_stop` | `response.completed` |

### Codex 指令注入策略

Claude Code Hub 支持三种 Codex CLI 指令处理策略：

| 策略 | 说明 |
|------|------|
| `auto` | 自动检测并缓存指令，智能学习用户习惯 |
| `force_official` | 强制使用官方 Codex 指令，忽略用户自定义 |
| `keep_original` | 保持原始指令不变 |

系统内置两套官方指令：

- **GPT5_PROMPT**：标准 GPT-5 提示词，简短版本
- **GPT5_CODEX_PROMPT**：完整 GPT-5 Codex 提示词（约 4000+ 字符）

通过 `isOfficialInstructions()` 函数检测用户指令是否为官方提示词，避免重复注入。

---

## 格式转换详解

### 转换器架构

```
┌─────────────────────────────────────────────────────────────┐
│                   TransformerRegistry                        │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │                 Request Transformers                   │   │
│  │  openai-compatible → claude                           │   │
│  │  claude → openai-compatible                           │   │
│  │  claude → codex                                       │   │
│  │  codex → claude                                       │   │
│  │  gemini-cli → claude                                  │   │
│  │  gemini-cli → openai-compatible                       │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │                Response Transformers                   │   │
│  │  claude → openai-compatible (stream + non-stream)     │   │
│  │  claude → codex (stream + non-stream)                 │   │
│  │  codex → openai-compatible (stream + non-stream)      │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

### 转换流程

1. **请求接收**：解析客户端请求，检测原始格式
2. **格式检测**：根据请求结构判断格式类型
3. **请求转换**：调用 `transformRequest(from, to, model, request, stream)`
4. **转发上游**：将转换后的请求发送给供应商
5. **响应转换**：调用 `transformStreamResponse()` 或 `transformNonStreamResponse()`
6. **返回客户端**：将转换后的响应返回给客户端

### 消息角色映射

| Claude 角色 | OpenAI 角色 | Codex 类型 |
|-------------|-------------|------------|
| `user` | `user` | `input_text` / `input_image` |
| `assistant` | `assistant` | `output_text` |
| `user` (tool_result) | `tool` | `function_call_output` |
| `assistant` (tool_use) | `assistant` (tool_calls) | `function_call` |

### Token 计数映射

| Claude 字段 | OpenAI 字段 |
|-------------|-------------|
| `usage.input_tokens` | `usage.prompt_tokens` |
| `usage.output_tokens` | `usage.completion_tokens` |
| 无直接对应 | `usage.total_tokens` (计算得出) |

---

## 认证方式

Claude Code Hub 支持多种认证方式，系统会自动检测并验证：

### Authorization Header

最常用的认证方式，兼容 OpenAI 和 Anthropic SDK：

```
Authorization: Bearer cch_your_api_key_here
```

### X-Api-Key Header

Anthropic 官方 SDK 使用的认证头：

```
x-api-key: cch_your_api_key_here
```

### Gemini API Key

支持 Gemini CLI 的认证方式：

```
x-goog-api-key: cch_your_api_key_here
```

或使用查询参数：

```
GET /v1/models?key=cch_your_api_key_here
```

### 认证优先级

当请求中包含多个认证凭据时，系统会检查它们是否一致：

1. 提取 `Authorization: Bearer` 中的 Token
2. 提取 `x-api-key` Header
3. 提取 `x-goog-api-key` Header 或 `key` 查询参数
4. 验证所有提供的凭据是否相同
5. 如果不一致，返回认证失败

{% callout type="warning" title="注意" %}
如果同时提供多个不同的 API Key，系统会拒绝请求并返回 401 错误，以防止潜在的安全问题。
{% /callout %}

---

## 错误响应格式

### 错误分类

系统将错误分为四类，用于决定是否重试和熔断：

| 错误类型 | 说明 | 重试策略 | 计入熔断 |
|----------|------|----------|----------|
| `PROVIDER_ERROR` | 供应商返回 4xx/5xx 错误 | 切换供应商重试 | 是 |
| `SYSTEM_ERROR` | 网络错误、超时等 | 先原地重试一次 | 可配置 |
| `CLIENT_ABORT` | 客户端主动断开连接 | 不重试 | 否 |
| `NON_RETRYABLE_CLIENT_ERROR` | 客户端输入错误 | 不重试 | 否 |

### 不可重试的客户端错误

以下错误被判定为客户端问题，不会重试：

- Prompt 过长（`prompt_too_long`）
- 内容过滤触发（`content_filter`）
- 输出超限（`max_tokens_exceeded`）
- 无效的 API Key（`invalid_api_key`）
- 模型不存在（`model_not_found`）
- 账户余额不足（`billing_quota_exceeded`）

### Claude 格式错误响应

```json
{
  "type": "error",
  "error": {
    "type": "invalid_request_error",
    "message": "Invalid request: model is required"
  }
}
```

### OpenAI 格式错误响应

```json
{
  "error": {
    "message": "Invalid request: model is required",
    "type": "invalid_request_error",
    "code": "missing_required_fields"
  }
}
```

### HTTP 状态码说明

| 状态码 | 说明 |
|--------|------|
| 400 | 请求格式错误或缺少必填字段 |
| 401 | 认证失败（API Key 无效或过期） |
| 403 | 权限不足（内容被过滤等） |
| 404 | 模型不存在 |
| 429 | 请求过于频繁（触发限流） |
| 500 | 服务器内部错误 |
| 502 | 上游供应商错误 |
| 503 | 服务暂时不可用（熔断中） |

---

## 最佳实践

### 客户端配置建议

1. **使用 Authorization Header**：兼容性最好，所有客户端都支持
2. **启用流式响应**：减少首字节延迟，提升用户体验
3. **设置合理的 max_tokens**：避免不必要的 Token 消耗

### 格式选择建议

| 场景 | 推荐格式 | 原因 |
|------|----------|------|
| Claude Code CLI | Claude Messages | 原生支持，无需转换 |
| Codex CLI | Response API | 原生支持，无需转换 |
| Cursor / 第三方工具 | OpenAI Chat Completions | 广泛兼容 |
| 自定义开发 | Claude Messages | 功能最完整 |

### 错误处理建议

1. **检查响应状态码**：非 2xx 响应表示请求失败
2. **解析错误消息**：`error.message` 包含详细错误信息
3. **实现重试逻辑**：对于 5xx 错误，可以在客户端实现重试
4. **处理 429 限流**：根据 `Retry-After` Header 等待后重试

---

## 相关文档

- [供应商类型](/docs/reference/provider-types) - 了解不同供应商类型的配置
- [熔断器机制](/docs/reference/circuit-breaker) - 了解故障转移和熔断保护
- [限流配置](/docs/reference/rate-limiting) - 了解多维度限流机制
- [智能路由](/docs/reference/intelligent-routing) - 了解供应商选择算法
