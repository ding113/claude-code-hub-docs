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

Claude Code Hub 提供了强大的 API 兼容层，支持多种主流 AI API 格式的无缝转换。无论您的客户端使用何种 API 格式，都可以通过统一的代理端点访问各种 AI 服务提供商。

## 概述

API 兼容层基于转换器注册表（Transformer Registry）架构实现，支持以下 API 格式之间的双向转换：

```
支持的格式:
├── Claude Messages API (claude)
├── OpenAI Chat Completions API (openai-compatible)
├── Codex Response API (codex)
├── Gemini API (gemini)
└── Gemini CLI (gemini-cli)
```

### 转换器架构

```
客户端请求 → 格式检测 → 请求转换 → 供应商调用 → 响应转换 → 客户端响应
                ↓            ↓           ↓           ↓
            原始格式      目标格式    供应商响应    原始格式
```

## Claude Messages API

Claude Messages API 是 Anthropic 官方的 API 格式，也是 Claude Code Hub 的原生格式。

### 端点

```
POST /v1/messages
```

### 认证方式

支持以下认证方式（优先级从高到低）：

| 认证方式 | Header | 说明 |
|----------|--------|------|
| Bearer Token | `Authorization: Bearer <api-key>` | 标准 OAuth 风格认证 |
| API Key Header | `x-api-key: <api-key>` | Anthropic 风格认证 |

### 请求格式

```json
{
  "model": "claude-3-5-sonnet-20241022",
  "max_tokens": 4096,
  "messages": [
    {
      "role": "user",
      "content": "Hello, Claude!"
    }
  ],
  "system": "You are a helpful assistant.",
  "stream": true,
  "temperature": 0.7,
  "tools": [
    {
      "name": "get_weather",
      "description": "Get weather information",
      "input_schema": {
        "type": "object",
        "properties": {
          "location": { "type": "string" }
        },
        "required": ["location"]
      }
    }
  ]
}
```

### 请求参数说明

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `model` | string | 是 | 模型标识符 |
| `max_tokens` | integer | 是 | 最大生成 Token 数 |
| `messages` | array | 是 | 对话消息列表 |
| `system` | string/array | 否 | 系统提示词 |
| `stream` | boolean | 否 | 是否启用流式响应 |
| `temperature` | number | 否 | 采样温度（0-1） |
| `top_p` | number | 否 | 核采样参数 |
| `tools` | array | 否 | 工具定义列表 |
| `tool_choice` | object | 否 | 工具选择策略 |

### 消息格式

**文本消息**:

```json
{
  "role": "user",
  "content": "Hello!"
}
```

**多模态消息（图片）**:

```json
{
  "role": "user",
  "content": [
    {
      "type": "text",
      "text": "What's in this image?"
    },
    {
      "type": "image",
      "source": {
        "type": "base64",
        "media_type": "image/png",
        "data": "<base64-encoded-image>"
      }
    }
  ]
}
```

**工具调用结果**:

```json
{
  "role": "user",
  "content": [
    {
      "type": "tool_result",
      "tool_use_id": "tool_123",
      "content": "The weather is sunny, 25°C"
    }
  ]
}
```

### 响应格式

**非流式响应**:

```json
{
  "id": "msg_01XFDUDYJgAACzvnptvVoYEL",
  "type": "message",
  "role": "assistant",
  "content": [
    {
      "type": "text",
      "text": "Hello! How can I help you today?"
    }
  ],
  "model": "claude-3-5-sonnet-20241022",
  "stop_reason": "end_turn",
  "usage": {
    "input_tokens": 10,
    "output_tokens": 25
  }
}
```

**流式响应（SSE）**:

```
event: message_start
data: {"type":"message_start","message":{"id":"msg_xxx","type":"message","role":"assistant","content":[],"model":"claude-3-5-sonnet-20241022"}}

event: content_block_start
data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}

event: content_block_stop
data: {"type":"content_block_stop","index":0}

event: message_delta
data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":25}}

event: message_stop
data: {"type":"message_stop"}
```

## OpenAI Chat Completions API

兼容 OpenAI Chat Completions API 格式，支持大多数 OpenAI 兼容客户端和工具。

### 端点

```
POST /v1/chat/completions
```

### 认证方式

```
Authorization: Bearer <api-key>
```

### 请求格式

```json
{
  "model": "claude-3-5-sonnet-20241022",
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
  "max_tokens": 4096,
  "stream": true,
  "temperature": 0.7,
  "tools": [
    {
      "type": "function",
      "function": {
        "name": "get_weather",
        "description": "Get weather information",
        "parameters": {
          "type": "object",
          "properties": {
            "location": { "type": "string" }
          },
          "required": ["location"]
        }
      }
    }
  ]
}
```

### 格式转换规则

**请求转换（OpenAI -> Claude）**:

| OpenAI 格式 | Claude 格式 | 说明 |
|-------------|-------------|------|
| `messages[role="system"]` | `system` | 系统消息提取到顶级字段 |
| `messages[].content` | `messages[].content` | 内容格式保持或转换 |
| `messages[].tool_calls` | `content[type="tool_use"]` | 工具调用转换 |
| `tools[].function.parameters` | `tools[].input_schema` | 工具参数定义 |
| `tool_choice="auto"` | `tool_choice.type="auto"` | 自动选择工具 |
| `tool_choice="required"` | `tool_choice.type="any"` | 强制使用工具 |

**响应转换（Claude -> OpenAI）**:

| Claude 格式 | OpenAI 格式 | 说明 |
|-------------|-------------|------|
| `content[type="text"]` | `message.content` | 文本内容 |
| `content[type="tool_use"]` | `tool_calls` | 工具调用 |
| `stop_reason` | `finish_reason` | 停止原因映射 |
| `usage.input_tokens` | `usage.prompt_tokens` | Token 统计 |
| `usage.output_tokens` | `usage.completion_tokens` | Token 统计 |

### 响应格式

**非流式响应**:

```json
{
  "id": "chatcmpl-xxx",
  "object": "chat.completion",
  "created": 1699000000,
  "model": "claude-3-5-sonnet-20241022",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "Hello! How can I help you today?"
      },
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "prompt_tokens": 10,
    "completion_tokens": 25,
    "total_tokens": 35
  }
}
```

**流式响应（SSE）**:

```
data: {"id":"chatcmpl-xxx","object":"chat.completion.chunk","created":1699000000,"model":"claude-3-5-sonnet-20241022","choices":[{"index":0,"delta":{"role":"assistant","content":"Hello"},"finish_reason":null}]}

data: {"id":"chatcmpl-xxx","object":"chat.completion.chunk","created":1699000000,"model":"claude-3-5-sonnet-20241022","choices":[{"index":0,"delta":{"content":"!"},"finish_reason":null}]}

data: {"id":"chatcmpl-xxx","object":"chat.completion.chunk","created":1699000000,"model":"claude-3-5-sonnet-20241022","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":10,"completion_tokens":25,"total_tokens":35}}

data: [DONE]
```

## Codex Response API

Codex Response API 专为 Codex CLI 等工具设计，提供兼容 OpenAI Response API 的接口。

### 端点

```
POST /v1/responses
```

### 认证方式

```
Authorization: Bearer <api-key>
```

### 请求格式

```json
{
  "model": "claude-3-5-sonnet-20241022",
  "input": [
    {
      "role": "user",
      "content": "Write a Python function to sort a list"
    }
  ],
  "instructions": "You are a coding assistant.",
  "stream": true,
  "max_output_tokens": 4096
}
```

### 请求参数说明

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `model` | string | 是 | 模型标识符 |
| `input` | array | 是 | 输入消息列表 |
| `instructions` | string | 否 | 系统指令 |
| `stream` | boolean | 否 | 是否启用流式响应 |
| `max_output_tokens` | integer | 否 | 最大输出 Token 数 |

### Instructions 策略

供应商可配置 Codex Instructions 的处理策略：

| 策略 | 说明 |
|------|------|
| `auto` | 透传客户端 instructions，400 错误时自动重试使用官方 instructions |
| `force_official` | 始终强制使用官方 Codex CLI instructions |
| `keep_original` | 始终透传客户端 instructions，不自动重试 |

### 格式转换

Codex Response API 请求会自动转换为 Claude Messages API 格式：

- `input` -> `messages`
- `instructions` -> `system`
- `max_output_tokens` -> `max_tokens`

## Gemini API 兼容

支持 Google Gemini API 格式的请求和响应转换。

### 端点映射

Gemini 格式的请求通过格式检测后自动路由到相应的处理器。

### 认证方式

支持以下认证方式：

| 认证方式 | 方式 | 说明 |
|----------|------|------|
| Header | `x-goog-api-key: <api-key>` | Gemini 风格头部认证 |
| Query | `?key=<api-key>` | URL 查询参数认证 |

### 请求格式转换

**输入转换规则**:

| Gemini 格式 | Claude 格式 | 说明 |
|-------------|-------------|------|
| `contents[role="user"]` | `messages[role="user"]` | 用户消息 |
| `contents[role="model"]` | `messages[role="assistant"]` | 模型响应 |
| `systemInstruction` | `system` | 系统指令 |
| `generationConfig.temperature` | `temperature` | 采样温度 |
| `generationConfig.maxOutputTokens` | `max_tokens` | 最大输出 |

### 响应格式转换

**输出转换规则**:

| Claude 格式 | Gemini/OpenAI 格式 | 说明 |
|-------------|-------------------|------|
| `content[].text` | `candidates[].content.parts[].text` | 文本内容 |
| `stop_reason` | `candidates[].finishReason` | 停止原因 |
| `usage` | `usageMetadata` | Token 统计 |

### Finish Reason 映射

| Gemini | OpenAI |
|--------|--------|
| `STOP` | `stop` |
| `MAX_TOKENS` | `length` |
| `SAFETY` | `content_filter` |

### Gemini 缓存支持

响应中包含 Gemini 缓存相关的 Token 统计：

```json
{
  "usage": {
    "prompt_tokens": 100,
    "completion_tokens": 50,
    "total_tokens": 150,
    "cache_read_input_tokens": 80
  }
}
```

## 认证方式汇总

Claude Code Hub 支持多种认证方式，系统会自动检测并验证：

### 认证优先级

```
1. Authorization: Bearer <key>  (标准 Bearer Token)
2. x-api-key: <key>             (Anthropic 风格)
3. x-goog-api-key: <key>        (Gemini 风格)
4. ?key=<key>                   (URL 查询参数)
```

### 认证规则

- 多种认证方式同时存在时，使用第一个有效的 Key
- 如果提供了多个不同的 Key，返回 401 错误
- 认证开销控制在 10ms 以内

### 错误响应

认证失败时返回标准错误格式：

```json
{
  "error": {
    "type": "authentication_error",
    "message": "令牌已过期或验证不正确"
  }
}
```

## 转换器注册表

Claude Code Hub 使用转换器注册表管理所有格式之间的转换：

### 已注册转换器

| 源格式 | 目标格式 | 支持类型 |
|--------|----------|----------|
| `openai-compatible` | `claude` | 请求 + 响应 |
| `claude` | `openai-compatible` | 请求 + 响应 |
| `codex` | `claude` | 请求 + 响应 |
| `claude` | `codex` | 请求 + 响应 |
| `codex` | `openai-compatible` | 请求 + 响应 |
| `gemini-cli` | `claude` | 请求 + 响应 |
| `gemini-cli` | `openai-compatible` | 请求 + 响应 |
| `gemini` | `claude` | 请求 |

### 转换状态

转换器支持在流式响应处理中保持状态：

```typescript
interface TransformState {
  hasToolCall?: boolean;      // 是否有工具调用
  currentIndex?: number;      // 当前内容块索引
  currentBlockType?: string;  // 当前内容块类型
}
```

## 使用示例

### cURL 示例

**Claude Messages API**:

```bash
curl -X POST https://your-hub.com/v1/messages \
  -H "Content-Type: application/json" \
  -H "x-api-key: your-api-key" \
  -d '{
    "model": "claude-3-5-sonnet-20241022",
    "max_tokens": 1024,
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

**OpenAI Chat Completions API**:

```bash
curl -X POST https://your-hub.com/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-api-key" \
  -d '{
    "model": "claude-3-5-sonnet-20241022",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

**Codex Response API**:

```bash
curl -X POST https://your-hub.com/v1/responses \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-api-key" \
  -d '{
    "model": "claude-3-5-sonnet-20241022",
    "input": [{"role": "user", "content": "Write a hello world in Python"}]
  }'
```

### Python SDK 示例

**使用 Anthropic SDK**:

```python
from anthropic import Anthropic

client = Anthropic(
    api_key="your-api-key",
    base_url="https://your-hub.com"
)

message = client.messages.create(
    model="claude-3-5-sonnet-20241022",
    max_tokens=1024,
    messages=[{"role": "user", "content": "Hello!"}]
)
print(message.content[0].text)
```

**使用 OpenAI SDK**:

```python
from openai import OpenAI

client = OpenAI(
    api_key="your-api-key",
    base_url="https://your-hub.com/v1"
)

response = client.chat.completions.create(
    model="claude-3-5-sonnet-20241022",
    messages=[{"role": "user", "content": "Hello!"}]
)
print(response.choices[0].message.content)
```

## 错误处理

### 通用错误格式

所有 API 端点返回统一的错误格式：

```json
{
  "error": {
    "type": "error_type",
    "message": "Human-readable error message"
  }
}
```

### 常见错误码

| HTTP 状态码 | 错误类型 | 说明 |
|-------------|----------|------|
| 400 | `invalid_request_error` | 请求格式错误或参数无效 |
| 401 | `authentication_error` | 认证失败 |
| 429 | `rate_limit_error` | 请求频率超限 |
| 500 | `api_error` | 服务器内部错误 |
| 503 | `overloaded_error` | 服务暂时不可用 |

## 相关文档

- [供应商管理](/docs/provider-management) - 配置不同类型的 API 供应商
- [高级设置](/docs/advanced-settings) - 错误规则和响应覆写配置
- [限流与配额管理](/docs/rate-limiting) - API 调用限制说明
