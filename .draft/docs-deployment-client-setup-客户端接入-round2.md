# 客户端接入与 API 认证

## 概述

Claude Code Hub 提供统一的 API 代理服务，支持多种 AI 客户端接入。系统支持多种认证方式，兼容 Claude Messages API、OpenAI Chat Completions API、Response API (Codex) 和 Gemini API 等多种协议格式。

## 认证方式

### 代理端点认证 (/v1/*)

对于所有代理端点（如 `/v1/messages`、`/v1/chat/completions` 等），支持以下认证方式：

#### 1. Authorization Bearer Token（推荐）

```http
Authorization: Bearer <your-api-key>
```

#### 2. x-api-key Header

```http
x-api-key: <your-api-key>
```

#### 3. x-goog-api-key Header（Gemini 专用）

```http
x-goog-api-key: <your-api-key>
```

#### 4. Query 参数（Gemini CLI 支持）

```
/v1beta/models/gemini-1.5-pro:generateContent?key=<your-api-key>
```

### Web UI/API 认证 (/api/*)

对于管理后台 API 和 Web UI：

#### 1. Cookie 认证（Web UI）

登录后自动设置 `auth-token` Cookie，有效期 7 天。

#### 2. Bearer Token 认证（API 调用）

```http
Authorization: Bearer <your-api-key>
```

或

```http
Cookie: auth-token=<your-api-key>
```

## API Key 格式

生成的 API Key 格式为：

```
sk-<32位十六进制字符>
```

示例：`sk-a1b2c3d4e5f6...（共66字符）`

## 支持的端点

### Claude Messages API

```
POST /v1/messages
POST /v1/messages/count_tokens
```

### OpenAI Chat Completions API

```
GET  /v1/models
GET  /v1/chat/completions/models
GET  /v1/chat/models
POST /v1/chat/completions
```

### Response API (Codex)

```
GET  /v1/responses/models
POST /v1/responses
```

### Gemini API

```
GET  /v1beta/models
POST /v1beta/models/{model}:generateContent
POST /v1beta/models/{model}:streamGenerateContent
```

## 客户端配置示例

### Claude Code CLI

```bash
export ANTHROPIC_BASE_URL=https://your-hub-domain.com/v1
export ANTHROPIC_API_KEY=your-api-key-here

claude
```

### Codex CLI

```bash
export OPENAI_BASE_URL=https://your-hub-domain.com/v1
export OPENAI_API_KEY=your-api-key-here

codex
```

### OpenAI 兼容客户端

```bash
export OPENAI_BASE_URL=https://your-hub-domain.com/v1
export OPENAI_API_KEY=your-api-key-here
```

### Gemini CLI

```bash
export GOOGLE_GEMINI_BASE_URL=https://your-hub-domain.com
export GEMINI_API_KEY=your-api-key-here
export GEMINI_MODEL=gemini-3-pro-preview
```

### OpenCode

配置文件路径：`~/.config/opencode/opencode.json`

```json
{
  "model": "openai/gpt-5.2",
  "provider": {
    "cchClaude": {
      "name": "Claude via cch",
      "options": {
        "baseURL": "https://your-hub-domain.com/v1",
        "apiKey": "{env:CCH_API_KEY}"
      }
    }
  }
}
```

## cURL 示例

### Claude Messages API

```bash
curl -X POST https://your-hub-domain.com/v1/messages \
  -H "Authorization: Bearer your-api-key" \
  -H "Content-Type: application/json" \
  -H "anthropic-version: 2023-06-01" \
  -d '{
    "model": "claude-3-opus-20240229",
    "max_tokens": 1024,
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

### OpenAI Chat Completions

```bash
curl -X POST https://your-hub-domain.com/v1/chat/completions \
  -H "x-api-key: your-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

### Response API (Codex)

```bash
curl -X POST https://your-hub-domain.com/v1/responses \
  -H "Authorization: Bearer your-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-5.2",
    "input": [{"role": "user", "content": "Hello!"}]
  }'
```

### Gemini API

```bash
curl -X POST "https://your-hub-domain.com/v1beta/models/gemini-1.5-pro:generateContent?key=your-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "contents": [{"role": "user", "parts": [{"text": "Hello!"}]}]
  }'
```

## 错误响应

### 认证错误 (401)

**未提供认证凭据：**

```json
{
  "error": {
    "message": "未提供认证凭据。请在 Authorization 头部、x-api-key 头部或 x-goog-api-key 头部中包含 API 密钥。",
    "type": "authentication_error",
    "code": "authentication_error"
  }
}
```

**API 密钥无效：**

```json
{
  "error": {
    "message": "API 密钥无效。提供的密钥不存在、已被删除、已被禁用或已过期。",
    "type": "invalid_api_key",
    "code": "invalid_api_key"
  }
}
```

**用户账户已禁用：**

```json
{
  "error": {
    "message": "用户账户已被禁用。请联系管理员。",
    "type": "user_disabled",
    "code": "user_disabled"
  }
}
```

**用户账户已过期：**

```json
{
  "error": {
    "message": "用户账户已于 2025-01-15 过期。请续费订阅。",
    "type": "user_expired",
    "code": "user_expired"
  }
}
```

**多个冲突的 API 密钥：**

```json
{
  "error": {
    "message": "提供了多个冲突的 API 密钥。请仅使用一种认证方式。",
    "type": "authentication_error",
    "code": "authentication_error"
  }
}
```

## 请求处理流程

### 完整聊天请求流程

```
auth → sensitive → client → model → version → probe → session → warmup → 
requestFilter → rateLimit → provider → providerRequestFilter → messageContext
```

### Count Tokens 请求流程

```
auth → client → model → version → probe → requestFilter → provider → providerRequestFilter
```

## 供应商类型

系统支持以下供应商类型：

| 类型 | 说明 | 适用端点 |
|------|------|----------|
| `claude` | Anthropic 标准认证 | `/v1/messages` |
| `claude-auth` | 仅 Bearer 认证（不发送 x-api-key） | `/v1/messages` |
| `codex` | Codex CLI (Response API) | `/v1/responses` |
| `openai-compatible` | OpenAI 兼容 API | `/v1/chat/completions` |
| `gemini` | Gemini 直接 API | `/v1beta/models/...` |
| `gemini-cli` | Gemini CLI 包装格式 | `/v1internal/models/...` |

## CORS 配置

允许的请求头：

```
authorization, x-api-key, x-goog-api-key, content-type, anthropic-version, x-session-id, x-client-version
```

允许的暴露头：

```
x-request-id, x-ratelimit-limit, x-ratelimit-remaining, x-ratelimit-reset, retry-after
```

## 环境变量配置

```bash
# 核心认证
ADMIN_TOKEN=change-me                    # 管理员登录令牌（必需）

# 应用配置
APP_PORT=23000                          # 应用端口
APP_URL=                                # 显式应用 URL（用于 OpenAPI 文档）

# 安全配置
ENABLE_SECURE_COOKIES=true              # HTTPS-only Cookie（HTTP 开发环境请禁用）

# 会话管理
SESSION_TTL=300                         # 会话缓存 TTL（秒）
STORE_SESSION_MESSAGES=false            # 存储完整消息内容

# 限流配置
ENABLE_RATE_LIMIT=true                  # 启用限流
REDIS_URL=redis://localhost:6379        # Redis 连接地址

# 网络配置
FETCH_CONNECT_TIMEOUT=30000             # TCP 连接超时（毫秒）
ENABLE_HTTP2=true                       # 启用 HTTP/2 连接
```

## 请求格式自动检测

系统根据端点和请求体自动检测客户端格式：

### 基于端点的检测（优先级顺序）

1. `/v1/messages` → Claude Messages API
2. `/v1/responses` → Response API (Codex)
3. `/v1/chat/completions` → OpenAI Chat Completions
4. `/v1beta/models/...:generateContent` → Gemini Direct API

### 基于请求体的检测

```typescript
// 1. Gemini 直接格式
if (Array.isArray(requestBody.contents)) → "gemini"

// 2. Gemini CLI 信封格式
if (typeof requestBody.request === "object") → "gemini-cli"

// 3. Response API (Codex) 格式
if (Array.isArray(requestBody.input)) → "response"

// 4. OpenAI 兼容格式
if (Array.isArray(requestBody.messages)) → "openai" 或 "claude"

// 5. 默认回退
→ "claude"
```

## 参考实现

### 核心认证文件

- **认证守卫**: `src/app/v1/_lib/proxy/auth-guard.ts`
- **API Key 仓库**: `src/repository/key.ts`
- **认证工具**: `src/lib/auth.ts`

### 代理和路由文件

- **代理处理器**: `src/app/v1/_lib/proxy-handler.ts`
- **格式映射器**: `src/app/v1/_lib/proxy/format-mapper.ts`
- **代理转发器**: `src/app/v1/_lib/proxy/forwarder.ts`
- **URL 构建器**: `src/app/v1/_lib/url.ts`

### 路由定义

- **V1 路由**: `src/app/v1/[...route]/route.ts`
- **V1Beta 路由**: `src/app/v1beta/[...route]/route.ts`

### 转换器

- **OpenAI → Claude**: `src/app/v1/_lib/converters/openai-to-claude/request.ts`
- **Claude → OpenAI**: `src/app/v1/_lib/converters/claude-to-openai/request.ts`
- **OpenAI → Codex**: `src/app/v1/_lib/converters/openai-to-codex/request.ts`
- **Codex → OpenAI**: `src/app/v1/_lib/converters/codex-to-openai/request.ts`
- **Gemini 适配器**: `src/app/v1/_lib/converters/gemini/adapter.ts`
