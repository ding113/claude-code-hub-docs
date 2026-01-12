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
https://your-proxy.com/anthropic   # 带路径的中转服务
https://your-proxy.com            # 中转服务（推荐填写基础地址）
```

{% callout type="note" title="关于 URL 填写" %}
Claude Code Hub 会基于客户端请求路径（如 `/v1/messages`）自动拼接到供应商 URL 上。通常建议填写**供应商基础地址**（不要额外带 `/v1` 之类的版本前缀），以避免出现重复路径（例如 `/v1/v1/messages`）。
{% /callout %}

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
URL: https://relay.example.com
API Key: your-relay-token
```

### URL 格式

与 `claude` 类型相同：

```
https://relay.example.com          # 基础域名
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

{% callout type="note" title="Codex instructions 策略已废弃" %}
历史版本曾支持基于策略对 `instructions` 进行注入/替换与缓存。当前版本中，Codex 请求的 `instructions` 字段**一律透传**（不注入、不替换、不缓存），相关策略字段仅为兼容旧数据保留。
{% /callout %}

### 配置示例

```yaml
名称: Codex Provider
类型: codex
URL: https://api.openai.com
API Key: sk-xxx
```

### 请求清洗与兼容处理

为提升对上游（尤其是带“官方客户端校验”的中转站）的兼容性，Claude Code Hub 会对 **非官方 Codex 客户端**的请求做最小侵入清洗：

1. **instructions 透传**：不注入、不替换、不缓存（兼容历史字段）
2. **参数过滤**：移除 Responses API 不支持的参数（如 `max_tokens` / `temperature` / `top_p` 等）
3. **必需字段**：强制 `store=false`；`parallel_tool_calls` 缺省时默认 `true`
4. **stream 不强制**：如果客户端未指定 `stream`，会保持未设置，避免对不支持 `stream` 参数的端点造成误伤

### 官方客户端检测

系统会自动检测官方 Codex CLI 客户端（通过 User-Agent）。官方客户端请求会跳过清洗，直接透传，以避免兼容逻辑误伤官方参数。

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
https://generativelanguage.googleapis.com         # 官方 API（推荐填写基础地址）
https://your-proxy.com                            # 中转服务
```

### 认证方式

Gemini 支持两种认证方式：

1. **API Key 认证**：
   - 头部：`x-goog-api-key: <api_key>`
   - 适用：Google Gemini API Key（通常形如 `AIza...`）

2. **OAuth Token 认证**：
   - 头部：`Authorization: Bearer <access_token>`
   - 适用：Access Token（常见前缀 `ya29.`）

{% callout type="note" title="扩展：JSON 凭据" %}
Gemini 供应商的 Key 也可以填写 JSON（常见为 `authorized_user` 导出的字段集合），Claude Code Hub 会按以下逻辑处理（不回写数据库）：

- 如果提供了 `access_token` 且未过期：直接使用
- 如果提供了 `refresh_token` + `client_id` + `client_secret`：会尝试刷新并使用新的 `access_token`

说明：目前不支持直接使用 Google `service_account` JSON 自动换取 access token（除非你自行填入 `access_token` / 通过外部方式提供 token）。
{% /callout %}

### 配置示例

```yaml
名称: Gemini Official
类型: gemini
URL: https://generativelanguage.googleapis.com
API Key: AIzaSyXXX  # 或 OAuth Access Token
```

### 请求透传

Gemini 类型使用**直接透传**模式，不进行格式转换。请求体直接发送到上游，响应也直接返回给客户端。

---

## Gemini CLI 类型 (gemini-cli)

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
https://cloudcode-pa.googleapis.com             # 官方 CLI 端点（推荐填写基础地址）
https://your-proxy.com                          # 中转服务
```

### 配置示例

```yaml
名称: Gemini CLI
类型: gemini-cli
URL: https://cloudcode-pa.googleapis.com
API Key: your-cli-token
```

### 特殊头部

Gemini CLI 类型会自动添加：
- `x-goog-api-client: GeminiCLI/1.0`

---

## OpenAI Compatible 类型 (openai-compatible)

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
https://api.openai.com             # OpenAI 官方（推荐填写基础地址）
https://api.groq.com/openai        # Groq（会拼接出 /openai/v1/...）
http://localhost:11434             # Ollama（会拼接出 /v1/...）
https://your-proxy.com             # 自定义服务
```

### 配置示例

```yaml
名称: OpenAI Compatible
类型: openai-compatible
URL: https://api.groq.com/openai
API Key: gsk_xxx
```

{% callout type="note" title="关于格式转换" %}
Claude Code Hub 内置多种协议之间的请求/响应转换器，但调度器默认会根据请求端点/请求体识别出的格式，优先选择**同类型供应商**以避免格式错配。不同 API 入口与兼容细节请参考 [API 兼容层](/docs/reference/api-compatibility)。
{% /callout %}

### 加入 Claude 调度池

非 Anthropic 类型供应商可以通过启用 `joinClaudePool` 选项加入 Claude 调度池。这需要配合模型重定向功能使用：

```yaml
名称: OpenAI Compatible (Claude pool)
类型: openai-compatible
URL: https://api.openai.com
加入 Claude 调度池: 是
模型重定向:
  claude-sonnet-4-20250514: claude-3-5-sonnet-20241022
  claude-3-opus-20240229: claude-3-5-sonnet-20241022
```

{% callout type="note" %}
`joinClaudePool` 只影响“调度器是否把该供应商纳入候选集”的模型匹配逻辑（当用户请求 `claude-*` 模型时）。它不会改变请求格式与供应商类型的兼容性约束。
{% /callout %}

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
