# Client Setup and API Authentication Report - Claude Code Hub

## Intent Analysis

The claude-code-hub project is an intelligent AI API proxy platform designed to provide unified access to multiple AI service providers (Claude, OpenAI, Codex, Gemini) with intelligent load balancing, rate limiting, and monitoring. The client setup and API authentication system serves as the entry point for all client connections, ensuring secure access control while supporting multiple client types and authentication methods.

The primary intent of this system is to:
1. Provide seamless authentication for various AI clients (Claude Code CLI, Codex CLI, Gemini CLI, custom applications)
2. Support multiple authentication mechanisms to accommodate different client capabilities
3. Enable secure API key validation with comprehensive user management
4. Facilitate format conversion between different AI API standards (Claude Messages API, OpenAI Chat Completions, Response API, Gemini API)
5. Maintain session context for intelligent provider selection and rate limiting

---

## Behavior Summary

### 1. API Authentication Flow

The authentication system in `/Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/auth-guard.ts` implements a multi-layered approach:

**Primary Authentication Methods:**
- **Authorization Bearer Token**: Standard `Authorization: Bearer <api_key>` header
- **x-api-key Header**: Direct API key in `x-api-key` header
- **x-goog-api-key Header**: Gemini-specific authentication header
- **Query Parameter**: Gemini CLI supports `?key=<api_key>` query parameter

**Authentication Process:**
```typescript
// From /Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/auth-guard.ts
export class ProxyAuthenticator {
  static async ensure(session: ProxySession): Promise<Response | null> {
    const authHeader = session.headers.get("authorization") ?? undefined;
    const apiKeyHeader = session.headers.get("x-api-key") ?? undefined;
    // Gemini CLI authentication support
    const geminiApiKeyHeader = session.headers.get(GEMINI_PROTOCOL.HEADERS.API_KEY) ?? undefined;
    const geminiApiKeyQuery = session.requestUrl.searchParams.get("key") ?? undefined;

    const authState = await ProxyAuthenticator.validate({
      authHeader,
      apiKeyHeader,
      geminiApiKeyHeader,
      geminiApiKeyQuery,
    });
    // ... validation logic
  }
}
```

**API Key Validation:**
The system validates API keys through `/Users/ding/Github/claude-code-hub/src/repository/key.ts`:
- Keys are stored with SHA-256 hashing
- Validation checks: key exists, is enabled, not expired
- User lookup with permission verification
- Admin token bypass for administrative access

### 2. Client Format Detection

The system automatically detects client request formats in `/Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/format-mapper.ts`:

**Endpoint-Based Detection (Priority Order):**
1. `/v1/messages` → Claude Messages API
2. `/v1/responses` → Codex/Response API
3. `/v1/chat/completions` → OpenAI Chat Completions
4. `/v1beta/models/...:generateContent` → Gemini Direct API
5. `/v1internal/models/...` → Gemini CLI

**Request Body-Based Detection:**
```typescript
// From /Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/format-mapper.ts
export function detectClientFormat(requestBody: Record<string, unknown>): ClientFormat {
  // 1. Direct Gemini API format
  if (Array.isArray(requestBody.contents) && !(typeof requestBody.request === "object")) {
    return "gemini";
  }
  // 2. Gemini CLI envelope format
  if (typeof requestBody.request === "object" && requestBody.request !== null) {
    return "gemini-cli";
  }
  // 3. Response API (Codex) format
  if (Array.isArray(requestBody.input)) {
    return "response";
  }
  // 4. OpenAI Compatible format
  if (Array.isArray(requestBody.messages)) {
    if (Array.isArray(requestBody.system)) {
      return "claude";
    }
    return "openai";
  }
  // 5. Default to Claude Messages API
  return "claude";
}
```

### 3. Proxy Pipeline Architecture

The request flows through a guard pipeline defined in `/Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/guard-pipeline.ts`:

**Full Chat Pipeline:**
```
auth → sensitive → client → model → version → probe → session → warmup → 
requestFilter → rateLimit → provider → providerRequestFilter → messageContext
```

**Count Tokens Pipeline (Minimal):**
```
auth → client → model → version → probe → requestFilter → provider → providerRequestFilter
```

### 4. Request Forwarding Logic

The forwarder in `/Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/forwarder.ts` handles:

**Header Processing:**
- Removes client IP headers (configurable)
- Sets upstream authentication headers
- Handles provider-specific header requirements
- Preserves or overrides User-Agent

**URL Building:**
Smart URL construction in `/Users/ding/Github/claude-code-hub/src/app/v1/_lib/url.ts`:
- Detects if baseUrl already contains endpoint paths
- Prevents duplicate path segments
- Supports multiple endpoint types (messages, responses, chat/completions, models)

**Provider Type Handling:**
- **claude**: Standard Claude Messages API
- **claude-auth**: Bearer-only authentication (no x-api-key)
- **codex**: OpenAI Response API format
- **openai-compatible**: Standard OpenAI Chat Completions
- **gemini**: Direct Gemini API
- **gemini-cli**: Gemini CLI wrapper format

---

## Configuration and Commands

### 1. Environment Variables

Key configuration in `/Users/ding/Github/claude-code-hub/.env.example`:

```bash
# Core Authentication
ADMIN_TOKEN=change-me                    # Admin login token (required)

# Application
APP_PORT=23000                          # Application port
APP_URL=                                # Explicit app URL for OpenAPI docs

# Security
ENABLE_SECURE_COOKIES=true              # HTTPS-only cookies (disable for HTTP)

# Session Management
SESSION_TTL=300                         # Session cache TTL (seconds)
STORE_SESSION_MESSAGES=false            # Store full message content

# Rate Limiting
ENABLE_RATE_LIMIT=true                  # Enable rate limiting
REDIS_URL=redis://localhost:6379        # Redis connection

# Network
FETCH_CONNECT_TIMEOUT=30000             # TCP connection timeout (ms)
ENABLE_HTTP2=true                       # Enable HTTP/2 connections
```

### 2. CORS Configuration

From `/Users/ding/Github/claude-code-hub/src/app/v1/_lib/cors.ts`:

```typescript
const DEFAULT_ALLOW_HEADERS =
  "authorization,x-api-key,x-goog-api-key,content-type,anthropic-version,x-session-id,x-client-version";

const DEFAULT_CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
  "Access-Control-Allow-Headers": DEFAULT_ALLOW_HEADERS,
  "Access-Control-Expose-Headers":
    "x-request-id,x-ratelimit-limit,x-ratelimit-remaining,x-ratelimit-reset,retry-after",
  "Access-Control-Max-Age": "86400",
};
```

### 3. API Routes

From `/Users/ding/Github/claude-code-hub/src/app/v1/[...route]/route.ts`:

```typescript
const app = new Hono().basePath("/v1");

// Model list endpoints
app.get("/models", handleAvailableModels);                    // All available models
app.get("/responses/models", handleCodexModels);             // Codex-only models
app.get("/chat/completions/models", handleOpenAICompatibleModels);  // OpenAI-compatible models
app.get("/chat/models", handleOpenAICompatibleModels);       // Shorthand

// OpenAI Compatible API
app.post("/chat/completions", handleChatCompletions);

// Response API (Codex)
app.post("/responses", handleChatCompletions);

// Claude API and fallback
app.all("*", handleProxyRequest);
```

### 4. Client Connection Examples

**Claude Code CLI:**
```bash
# Set environment variable
export ANTHROPIC_BASE_URL=https://your-hub-domain.com/v1
export ANTHROPIC_API_KEY=your-api-key-here

# Claude Code will automatically use these settings
claude
```

**Codex CLI:**
```bash
# Set environment variables
export OPENAI_BASE_URL=https://your-hub-domain.com/v1
export OPENAI_API_KEY=your-api-key-here

# Run Codex
codex
```

**OpenAI-Compatible Clients:**
```bash
# Standard OpenAI client configuration
export OPENAI_BASE_URL=https://your-hub-domain.com/v1
export OPENAI_API_KEY=your-api-key-here
```

**Gemini CLI:**
```bash
# Gemini uses x-goog-api-key header or query parameter
export GEMINI_API_KEY=your-api-key-here
# Configure base URL to point to hub
```

**cURL Example:**
```bash
# Using Authorization Bearer
curl -X POST https://your-hub-domain.com/v1/messages \
  -H "Authorization: Bearer your-api-key" \
  -H "Content-Type: application/json" \
  -H "anthropic-version: 2023-06-01" \
  -d '{
    "model": "claude-3-opus-20240229",
    "max_tokens": 1024,
    "messages": [{"role": "user", "content": "Hello!"}]
  }'

# Using x-api-key
curl -X POST https://your-hub-domain.com/v1/chat/completions \
  -H "x-api-key: your-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

---

## Edge Cases and Error Handling

### 1. Authentication Failures

**No Credentials Provided:**
- Returns 401 with message: "未提供认证凭据。请在 Authorization 头部、x-api-key 头部或 x-goog-api-key 头部中包含 API 密钥。"

**Invalid API Key:**
- Returns 401 with message: "API 密钥无效。提供的密钥不存在、已被删除、已被禁用或已过期。"
- Error code: `invalid_api_key`

**Disabled User:**
- Returns 401 with message: "用户账户已被禁用"
- Error code: `user_disabled`

### 2. Format Compatibility Issues

**Unknown Endpoint:**
- Falls back to request body detection
- Defaults to Claude Messages API if no format detected

**Format-Provider Mismatch:**
- System checks format compatibility in provider selection
- Filters out providers that don't support the detected format

### 3. Session and Rate Limiting

**Session ID Generation:**
- Based on userId, keyId, and model
- Used for sticky sessions and concurrent request tracking

**Rate Limit Fail-Open:**
- If Redis unavailable, rate limiting is skipped
- Request continues without limit checks

### 4. Network and Proxy Handling

**Proxy Fallback:**
- Configurable fallback to direct connection
- Logs proxy usage and fallback events

**HTTP/2 Fallback:**
- Automatic fallback to HTTP/1.1 on connection issues
- Preserves request context during retry

### 5. Model Redirects

From `/Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/model-redirector.ts`:
- Supports model name mapping per provider
- Automatically resets to original model when switching providers
- Special handling for Gemini URL path modification

### 6. Client Version Checking

From `/Users/ding/Github/claude-code-hub/src/lib/client-version-checker.ts`:
- Tracks client versions by User-Agent
- Detects GA (Generally Available) versions
- Can enforce minimum version requirements

---

## References

### Core Authentication Files

1. **Authentication Guard**: `/Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/auth-guard.ts`
   - Main authentication logic
   - Multiple auth method support
   - Error response generation

2. **API Key Repository**: `/Users/ding/Github/claude-code-hub/src/repository/key.ts`
   - Database queries for key validation
   - User lookup and permission checking
   - `validateApiKeyAndGetUser()` function

3. **Auth Utilities**: `/Users/ding/Github/claude-code-hub/src/lib/auth.ts`
   - Cookie-based session management
   - Admin token handling
   - Bearer token parsing

### Proxy and Routing Files

4. **Proxy Handler**: `/Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy-handler.ts`
   - Main request entry point
   - Format detection orchestration
   - Guard pipeline execution

5. **Format Mapper**: `/Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/format-mapper.ts`
   - Client format detection
   - Endpoint pattern matching
   - Transformer format mapping

6. **Proxy Forwarder**: `/Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/forwarder.ts`
   - Upstream request forwarding
   - Header processing
   - Provider-specific handling

7. **URL Builder**: `/Users/ding/Github/claude-code-hub/src/app/v1/_lib/url.ts`
   - Smart URL construction
   - Endpoint path detection
   - Provider URL preview

### Configuration Files

8. **CORS Configuration**: `/Users/ding/Github/claude-code-hub/src/app/v1/_lib/cors.ts`
   - Allowed headers and methods
   - Preflight response handling
   - Dynamic CORS header building

9. **Environment Schema**: `/Users/ding/Github/claude-code-hub/src/lib/config/env.schema.ts`
   - Environment variable validation
   - Default values and constraints

10. **Route Definitions**: `/Users/ding/Github/claude-code-hub/src/app/v1/[...route]/route.ts`
    - API endpoint registration
    - Handler mapping

### Converter Files

11. **OpenAI to Claude**: `/Users/ding/Github/claude-code-hub/src/app/v1/_lib/converters/openai-to-claude/request.ts`
12. **Claude to OpenAI**: `/Users/ding/Github/claude-code-hub/src/app/v1/_lib/converters/claude-to-openai/request.ts`
13. **OpenAI to Codex**: `/Users/ding/Github/claude-code-hub/src/app/v1/_lib/converters/openai-to-codex/request.ts`
14. **Codex to OpenAI**: `/Users/ding/Github/claude-code-hub/src/app/v1/_lib/converters/codex-to-openai/request.ts`

### Documentation

15. **API Authentication Guide**: `/Users/ding/Github/claude-code-hub/docs/api-authentication-guide.md`
    - User-facing authentication documentation
    - Code examples in multiple languages
    - Troubleshooting guide

16. **Architecture Document**: `/Users/ding/Github/claude-code-hub/docs/architecture-claude-code-hub-2025-11-29.md`
    - System architecture overview
    - Authentication flow diagrams
    - Security considerations

---

## Summary

The claude-code-hub client setup and API authentication system provides a robust, flexible entry point for AI clients. Key characteristics include:

1. **Multi-Method Authentication**: Supports Bearer tokens, x-api-key headers, and Gemini-specific authentication to accommodate different client requirements.

2. **Automatic Format Detection**: Intelligently detects request formats from both URL patterns and request body structure, enabling seamless protocol translation.

3. **Comprehensive Security**: API key validation with SHA-256 hashing, user permission checking, and optional admin token bypass.

4. **Flexible Configuration**: Environment-based configuration for CORS, session management, rate limiting, and network settings.

5. **Protocol Compatibility**: Full support for Claude Messages API, OpenAI Chat Completions, Response API (Codex), and Gemini API with bidirectional format conversion.

6. **Production-Ready Features**: CORS support, session management, rate limiting with Redis, circuit breakers, and comprehensive logging.

The system is designed to be transparent to end clients while providing powerful management capabilities for administrators.
