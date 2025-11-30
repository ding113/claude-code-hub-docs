---
dimensions:
  type:
    primary: reference
    detail: provider-types
  level: intermediate
standard_title: 供应商类型详解
language: zh
---

# 供应商类型详解

Claude Code Hub 支持多种供应商类型，每种类型针对不同的 AI 服务商和 API 协议进行了专门优化。本文档详细介绍各供应商类型的特点、适用场景和配置方法。

{% callout type="note" title="版本说明" %}
供应商类型功能在所有版本中可用。部分非 Claude 类型（如 Gemini、OpenAI Compatible）需要在环境变量中启用 `ENABLE_MULTI_PROVIDER_TYPES=true` 才能使用。
{% /callout %}

---

## 类型概览

Claude Code Hub 支持以下六种供应商类型：

| 类型 | 说明 | 适用场景 |
| --- | --- | --- |
| `claude` | Anthropic 官方 API | 直连 Anthropic 或标准中转站 |
| `claude-auth` | Claude 中转服务 | 仅支持 Bearer Token 的中转站 |
| `codex` | OpenAI Codex/Response API | Codex CLI、Cursor 等客户端 |
| `gemini` | Google Gemini API | Gemini 官方 API |
| `gemini-cli` | Gemini CLI 格式 | Gemini CLI 工具 |
| `openai-compatible` | OpenAI 兼容 API | 第三方 OpenAI 兼容服务 |

---

## Claude 类型 (claude)

### 概述

`claude` 是最常用的供应商类型，用于连接 Anthropic 官方 API 或遵循 Anthropic 协议的中转服务。

### 适用场景

- Anthropic 官方 API 直连
- 遵循 Anthropic API 规范的中转站
- 支持 `x-api-key` 头部认证的服务

### URL 格式

```
https://api.anthropic.com          # 官方 API
https://your-proxy.com/v1          # 中转服务
https://your-proxy.com/anthropic   # 带路径的中转服务
```

### 认证方式

`claude` 类型同时发送两种认证头部：

- `Authorization: Bearer <api_key>` - Bearer Token 认证
- `x-api-key: <api_key>` - Anthropic 标准认证头

### API 端点

| 端点 | 用途 |
| --- | --- |
| `/v1/messages` | Claude Messages API（主要端点） |
| `/v1/messages/count_tokens` | Token 计数 |

### 配置示例

```yaml
名称: Anthropic Official
类型: claude
URL: https://api.anthropic.com
API Key: sk-ant-xxx
```

### 支持的功能

- 流式响应 (Streaming)
- 工具调用 (Tool Use)
- 思考模式 (Extended Thinking)
- 缓存创建和读取 (Prompt Caching)
- 多模态输入 (Vision)

---

## Claude Auth 类型 (claude-auth)

### 概述

`claude-auth` 是专为部分中转服务设计的类型。这些中转服务只接受 Bearer Token 认证，不支持或会因 `x-api-key` 头部产生冲突。

### 与 claude 类型的区别

| 特性 | claude | claude-auth |
| --- | --- | --- |
| Authorization 头 | 发送 | 发送 |
| x-api-key 头 | 发送 | **不发送** |
| 适用场景 | 官方 API / 标准中转 | 仅 Bearer Token 中转 |

### 适用场景

- 中转服务使用自定义认证机制
- 中转服务拒绝 `x-api-key` 头部
- 中转服务的 API Key 格式与 Anthropic 不同

### 认证方式

`claude-auth` 类型仅发送：

- `Authorization: Bearer <api_key>` - Bearer Token 认证

{% callout type="note" title="何时使用" %}
如果你使用的中转服务在配置为 `claude` 类型时返回认证错误，尝试切换为 `claude-auth` 类型。这通常可以解决因 `x-api-key` 头部冲突导致的问题。
{% /callout %}

### 配置示例

```yaml
名称: Claude Relay Service
类型: claude-auth
URL: https://relay.example.com/v1
API Key: your-relay-token
```

### URL 格式

与 `claude` 类型相同：

```
https://relay.example.com          # 基础域名
https://relay.example.com/v1       # 带版本路径
https://relay.example.com/api      # 自定义路径
```

---

## Codex 类型 (codex)

### 概述

`codex` 类型用于连接 OpenAI Codex API 或支持 Response API 格式的服务。这是 Codex CLI 和部分编程助手工具使用的协议。

### 适用场景

- OpenAI Codex/Response API
- Codex CLI 客户端
- 支持 Response API 格式的中转服务

### API 端点

| 端点 | 用途 |
| --- | --- |
| `/v1/responses` | Codex Response API（主要端点） |

### URL 格式

```
https://api.openai.com             # OpenAI 官方
https://your-proxy.com             # 中转服务
https://your-proxy.com/openai      # 带路径的中转
```

### Instructions 策略

Codex 类型提供三种 Instructions 处理策略：

| 策略 | 说明 |
| --- | --- |
| `auto` | 默认策略。透传客户端 instructions，400 错误时自动重试（使用官方 instructions） |
| `force_official` | 始终使用官方 Codex CLI instructions（约 4000+ 字完整 prompt） |
| `keep_original` | 始终透传客户端 instructions，不自动重试 |

{% callout type="warning" title="策略选择建议" %}
- 对于严格验证 instructions 的中转站（如 88code、foxcode），建议使用 `force_official` 策略
- 对于宽松的中转站，可使用 `auto` 策略以获得更好的灵活性
- `keep_original` 适用于已知中转站不验证 instructions 的场景
{% /callout %}

### 配置示例

```yaml
名称: Codex Provider
类型: codex
URL: https://api.openai.com
API Key: sk-xxx
Instructions 策略: auto
```

### 请求清洗

系统会自动清洗 Codex 请求，包括：

1. **Instructions 处理** - 根据策略处理 instructions 字段
2. **参数过滤** - 移除不支持的参数（如 `max_tokens`, `temperature`, `top_p` 等）
3. **必需字段** - 确保 `stream`, `store`, `parallel_tool_calls` 字段存在

### 官方客户端检测

系统会自动检测官方 Codex CLI 客户端（通过 User-Agent），对于官方客户端使用 `auto` 策略时会跳过清洗，直接透传请求。

官方客户端 User-Agent 格式：
- `codex_vscode/0.35.0 (Windows 10.0.26100; x86_64) unknown (Cursor; 0.4.10)`
- `codex_cli_rs/0.50.0 (Mac OS 26.0.1; arm64) vscode/1.7.54`

---

## Gemini 类型 (gemini)

### 概述

`gemini` 类型用于连接 Google Gemini 官方 API。支持 Gemini 1.5、2.0 等模型系列。

{% callout type="note" title="实验性功能" %}
Gemini 类型是实验性功能，需要启用 `ENABLE_MULTI_PROVIDER_TYPES=true` 环境变量。
{% /callout %}

### 适用场景

- Google Gemini 官方 API
- Gemini 模型直接访问
- 需要 Gemini 特有功能的场景

### API 端点

| 端点 | 用途 |
| --- | --- |
| `/v1beta/models/{model}:generateContent` | 内容生成 |
| `/v1beta/models/{model}:streamGenerateContent` | 流式生成 |
| `/v1beta/models/{model}:countTokens` | Token 计数 |

### URL 格式

```
https://generativelanguage.googleapis.com/v1beta  # 官方 API（默认）
https://your-proxy.com/v1beta                     # 中转服务
```

### 认证方式

Gemini 支持两种认证方式：

1. **API Key 认证**：
   - 头部：`x-goog-api-key: <api_key>`
   - 适用：以 `AIza` 开头的 API Key

2. **OAuth Token 认证**：
   - 头部：`Authorization: Bearer <access_token>`
   - 适用：Google Cloud 服务账号或 OAuth 流程获取的 Token

### 配置示例

```yaml
名称: Gemini Official
类型: gemini
URL: https://generativelanguage.googleapis.com/v1beta
API Key: AIzaSyXXX  # 或 OAuth Access Token
```

### 请求透传

Gemini 类型使用**直接透传**模式，不进行格式转换。请求体直接发送到上游，响应也直接返回给客户端。

---

## Gemini CLI 类型 (gemini-cli)

{% callout type="warning" title="即将上线" %}
此功能正在开发中，尚未正式发布。
{% /callout %}

### 概述

`gemini-cli` 类型专为 Gemini CLI 工具设计，使用 Google 内部 API 端点和特殊的请求封装格式。

{% callout type="note" title="实验性功能" %}
Gemini CLI 类型是实验性功能，需要启用 `ENABLE_MULTI_PROVIDER_TYPES=true` 环境变量。
{% /callout %}

### 与 gemini 类型的区别

| 特性 | gemini | gemini-cli |
| --- | --- | --- |
| API 端点 | `/v1beta/...` | `/v1internal/...` |
| 请求格式 | 标准 Gemini API | CLI 封装格式 |
| 适用客户端 | 通用 | Gemini CLI 专用 |
| 默认端点 | generativelanguage.googleapis.com | cloudcode-pa.googleapis.com |

### API 端点

| 端点 | 用途 |
| --- | --- |
| `/v1internal/models/{model}:generateContent` | CLI 内容生成 |
| `/v1internal/models/{model}:streamGenerateContent` | CLI 流式生成 |

### URL 格式

```
https://cloudcode-pa.googleapis.com/v1internal  # 官方 CLI 端点（默认）
https://your-proxy.com/v1internal               # 中转服务
```

### 配置示例

```yaml
名称: Gemini CLI
类型: gemini-cli
URL: https://cloudcode-pa.googleapis.com/v1internal
API Key: your-cli-token
```

### 特殊头部

Gemini CLI 类型会自动添加：
- `x-goog-api-client: GeminiCLI/1.0`

---

## OpenAI Compatible 类型 (openai-compatible)

{% callout type="warning" title="即将上线" %}
此功能正在开发中，尚未正式发布。
{% /callout %}

### 概述

`openai-compatible` 类型用于连接任何遵循 OpenAI Chat Completions API 格式的第三方服务。这包括许多本地模型服务和 API 聚合服务。

{% callout type="note" title="实验性功能" %}
OpenAI Compatible 类型是实验性功能，需要启用 `ENABLE_MULTI_PROVIDER_TYPES=true` 环境变量。
{% /callout %}

### 适用场景

- OpenAI 官方 API
- OpenAI 兼容的第三方服务（如 Groq、Together AI、Fireworks AI）
- 本地模型服务（如 Ollama、LocalAI、vLLM）
- API 聚合服务

### API 端点

| 端点 | 用途 |
| --- | --- |
| `/v1/chat/completions` | Chat Completions API（主要端点） |
| `/v1/models` | 模型列表 |

### URL 格式

```
https://api.openai.com/v1          # OpenAI 官方
https://api.groq.com/openai/v1     # Groq
https://localhost:11434/v1         # Ollama
https://your-proxy.com/v1          # 自定义服务
```

### 配置示例

```yaml
名称: OpenAI Compatible
类型: openai-compatible
URL: https://api.groq.com/openai/v1
API Key: gsk_xxx
```

### 格式转换

当客户端使用 Claude 格式请求，但目标供应商为 `openai-compatible` 类型时，系统会自动进行格式转换：

**Claude -> OpenAI 转换规则：**

- `messages` 格式转换
- `system` 字段处理
- `max_tokens` -> `max_completion_tokens`
- 工具调用格式适配
- 流式响应格式转换

### 加入 Claude 调度池

{% callout type="warning" title="即将上线" %}
此功能正在开发中，尚未正式发布。
{% /callout %}

非 Anthropic 类型供应商可以通过启用 `joinClaudePool` 选项加入 Claude 调度池。这需要配合模型重定向功能使用：

```yaml
名称: OpenAI as Claude
类型: openai-compatible
URL: https://api.openai.com/v1
加入 Claude 调度池: 是
模型重定向:
  claude-sonnet-4-20250514: gpt-4o
  claude-3-5-sonnet-20241022: gpt-4-turbo
```

---

## 类型对比表

### 认证方式对比

| 类型 | Authorization | x-api-key | 其他 |
| --- | --- | --- | --- |
| claude | Bearer Token | API Key | - |
| claude-auth | Bearer Token | 不发送 | - |
| codex | Bearer Token | - | - |
| gemini | Bearer Token 或 - | - | x-goog-api-key |
| gemini-cli | Bearer Token 或 - | - | x-goog-api-key |
| openai-compatible | Bearer Token | - | - |

### API 格式对比

| 类型 | 请求格式 | 响应格式 | 流式格式 |
| --- | --- | --- | --- |
| claude | Claude Messages | Claude Messages | SSE |
| claude-auth | Claude Messages | Claude Messages | SSE |
| codex | Response API | Response API | SSE |
| gemini | Gemini API | Gemini API | SSE |
| gemini-cli | Gemini CLI | Gemini CLI | SSE |
| openai-compatible | OpenAI Chat | OpenAI Chat | SSE |

### 功能支持对比

| 功能 | claude | claude-auth | codex | gemini | gemini-cli | openai-compatible |
| --- | --- | --- | --- | --- | --- | --- |
| 流式响应 | 支持 | 支持 | 支持 | 支持 | 支持 | 支持 |
| 工具调用 | 支持 | 支持 | 支持 | 支持 | 支持 | 支持 |
| 思考模式 | 支持 | 支持 | 部分 | - | - | 部分 |
| 缓存 | 支持 | 支持 | - | - | - | - |
| 多模态 | 支持 | 支持 | 部分 | 支持 | 支持 | 部分 |
| 格式转换 | - | - | 支持 | - | 支持 | 支持 |

---

## 选择建议

### 场景一：使用 Anthropic 官方 API

**推荐类型：** `claude`

```yaml
名称: Anthropic
类型: claude
URL: https://api.anthropic.com
```

### 场景二：使用中转服务

**先尝试：** `claude`

如果出现认证错误，**切换为：** `claude-auth`

### 场景三：使用 Codex CLI 或 Cursor

**推荐类型：** `codex`

```yaml
名称: Codex Provider
类型: codex
URL: https://api.openai.com
Instructions 策略: auto
```

### 场景四：使用 Gemini 模型

**通用场景：** `gemini`
**CLI 工具：** `gemini-cli`

### 场景五：使用 OpenAI 兼容服务

**推荐类型：** `openai-compatible`

适用于 Groq、Together AI、Ollama 等服务。

### 场景六：混合调度

如果需要将非 Claude 供应商加入 Claude 调度池：

1. 选择对应的供应商类型
2. 启用「加入 Claude 调度池」
3. 配置模型重定向规则

---

## 常见问题

### 如何判断应该使用哪种类型？

1. **看服务商文档**：确认 API 格式和认证方式
2. **看端点路径**：`/v1/messages` 通常是 Claude 类型，`/v1/responses` 是 Codex 类型
3. **测试连接**：使用 CCH 的连接测试功能验证配置

### claude-auth 和 claude 有什么区别？

主要区别是 `claude-auth` 不发送 `x-api-key` 头部。如果中转服务因该头部产生冲突，应使用 `claude-auth`。

### Codex Instructions 策略如何选择？

- **不确定时**：使用 `auto`（默认）
- **中转站要求官方 instructions**：使用 `force_official`
- **中转站宽松或已知不验证**：使用 `keep_original`

### 为什么 Gemini/OpenAI Compatible 类型显示为实验性？

这些类型的功能仍在完善中，部分高级功能（如 MCP 透传、完整的格式转换）可能不完全支持。建议在测试环境验证后再用于生产。

---

## 相关文档

- [供应商管理](/docs/guide/settings-providers) - 供应商管理页面操作指南
- [环境变量配置](/docs/reference/env-variables) - 配置 `ENABLE_MULTI_PROVIDER_TYPES` 等选项
- [智能路由](/docs/reference/intelligent-routing) - 了解供应商选择机制
- [熔断器机制](/docs/reference/circuit-breaker) - 了解故障保护机制
