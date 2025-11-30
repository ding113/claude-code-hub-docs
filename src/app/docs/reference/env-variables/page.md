---
title: 环境变量参考
description: Claude Code Hub 所有环境变量的完整参考，包括必需变量、数据库配置、Redis 配置、安全设置等
---

# 环境变量参考

本文档详细说明 Claude Code Hub 支持的所有环境变量，帮助您正确配置系统以满足不同部署场景的需求。

---

## 概述

Claude Code Hub 使用环境变量进行配置，支持以下几类配置：

- **必需变量**：系统运行所必须的配置
- **数据库配置**：PostgreSQL 连接和迁移设置
- **Redis 配置**：缓存、限流和 Session 管理
- **安全配置**：Cookie 策略和认证设置
- **熔断器配置**：故障保护和智能探测
- **高级配置**：调试、超时和实验性功能

{% callout type="warning" title="布尔值配置注意事项" %}
所有布尔类型的环境变量请直接使用 `true` 或 `false`（或 `1`/`0`），**不要加引号**。
系统内部使用特殊逻辑处理：只有 `"false"` 和 `"0"` 会被转换为 `false`，其他所有值都会被视为 `true`。
{% /callout %}

---

## 必需变量

### ADMIN_TOKEN

| 属性 | 值 |
|------|-----|
| **类型** | `string` |
| **默认值** | `change-me`（占位符） |
| **必需** | 是 |

管理员登录令牌，用于访问后台管理界面。

{% callout type="error" title="安全警告" %}
**部署前必须修改此值！** 使用默认值 `change-me` 会导致系统拒绝启动或存在严重安全风险。
建议使用至少 32 位的随机字符串作为令牌。
{% /callout %}

**生成安全令牌的方法：**

```bash
# Linux/macOS
openssl rand -hex 32

# 或使用 Node.js
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

**配置示例：**

```bash
ADMIN_TOKEN=a1b2c3d4e5f6789012345678901234567890abcdef
```

---

### DSN

| 属性 | 值 |
|------|-----|
| **类型** | `string` (URL 格式) |
| **默认值** | 无 |
| **必需** | 是（非 Docker Compose 部署时） |

PostgreSQL 数据库连接字符串。

**格式：**

```
postgres://用户名:密码@主机:端口/数据库名
```

**配置示例：**

```bash
# 本地开发
DSN=postgres://postgres:password@localhost:5432/claude_code_hub

# Docker Compose（容器内自动配置，通常无需手动设置）
DSN=postgresql://postgres:postgres@postgres:5432/claude_code_hub

# 远程数据库
DSN=postgres://myuser:mypassword@db.example.com:5432/claude_code_hub
```

{% callout type="note" title="Docker Compose 部署" %}
使用 Docker Compose 部署时，`DSN` 会自动从 `DB_USER`、`DB_PASSWORD`、`DB_NAME` 变量构建，
通常无需手动配置。
{% /callout %}

---

## 数据库配置

### DB_USER

| 属性 | 值 |
|------|-----|
| **类型** | `string` |
| **默认值** | `postgres` |
| **必需** | 否（Docker Compose 部署时使用） |

PostgreSQL 数据库用户名，仅在 Docker Compose 部署时使用。

---

### DB_PASSWORD

| 属性 | 值 |
|------|-----|
| **类型** | `string` |
| **默认值** | `postgres` |
| **必需** | 否（Docker Compose 部署时使用） |

PostgreSQL 数据库密码。

{% callout type="warning" title="生产环境安全" %}
请务必修改默认密码，使用强密码保护数据库。
{% /callout %}

---

### DB_NAME

| 属性 | 值 |
|------|-----|
| **类型** | `string` |
| **默认值** | `claude_code_hub` |
| **必需** | 否 |

PostgreSQL 数据库名称。

---

### AUTO_MIGRATE

| 属性 | 值 |
|------|-----|
| **类型** | `boolean` |
| **默认值** | `true` |
| **必需** | 否 |

控制应用启动时是否自动执行数据库迁移。

| 值 | 行为 |
|------|------|
| `true` | 启动时自动执行 Drizzle ORM 迁移，确保数据库 schema 最新 |
| `false` | 跳过自动迁移，需要手动执行 `bun run drizzle:migrate` |

**使用建议：**

- **开发环境**：建议设为 `true`，方便快速迭代
- **生产环境**：首次部署后建议设为 `false`，手动控制迁移时机

---

## Redis 配置

### REDIS_URL

| 属性 | 值 |
|------|-----|
| **类型** | `string` (URL 格式) |
| **默认值** | 无 |
| **必需** | 启用限流时必需 |

Redis 连接地址。

**支持的协议：**

| 协议 | 说明 |
|------|------|
| `redis://` | 标准 TCP 连接 |
| `rediss://` | TLS 加密连接（适用于 Upstash 等云服务） |

**配置示例：**

```bash
# 本地 Redis
REDIS_URL=redis://localhost:6379

# Docker Compose
REDIS_URL=redis://redis:6379

# 带密码认证
REDIS_URL=redis://:password@localhost:6379

# Upstash (TLS)
REDIS_URL=rediss://default:your-password@your-endpoint.upstash.io:6379
```

---

### ENABLE_RATE_LIMIT

| 属性 | 值 |
|------|-----|
| **类型** | `boolean` |
| **默认值** | `true` |
| **必需** | 否 |

是否启用限流功能。

**功能范围：**

- RPM（每分钟请求数）限制
- 金额限制（5 小时/周/月）
- Session 并发限制
- 供应商并发限制

{% callout type="note" title="Fail-Open 策略" %}
当 Redis 不可用时，系统采用 **Fail-Open** 策略：限流检查自动跳过，请求正常处理。
这确保 Redis 故障不会影响服务可用性，但会记录警告日志。
{% /callout %}

---

## Session 配置

### SESSION_TTL

| 属性 | 值 |
|------|-----|
| **类型** | `number` |
| **默认值** | `300`（5 分钟） |
| **单位** | 秒 |
| **必需** | 否 |

Session 过期时间，控制 Session 与供应商的绑定关系缓存时长。

**影响范围：**

- Session 粘性（同一会话路由到同一供应商）
- 供应商缓存命中率优化
- 活跃 Session 监控数据保留时间

**配置建议：**

| 场景 | 建议值 | 说明 |
|------|--------|------|
| 短会话场景 | `180`（3 分钟） | 适合快速问答 |
| 标准使用 | `300`（5 分钟） | 默认值，平衡缓存效果和资源占用 |
| 长会话场景 | `600`（10 分钟） | 适合深度编程对话 |

---

### STORE_SESSION_MESSAGES

| 属性 | 值 |
|------|-----|
| **类型** | `boolean` |
| **默认值** | `false` |
| **必需** | 否 |

是否存储请求 messages 到 Redis（用于实时监控页面查看对话详情）。

{% callout type="warning" title="资源和隐私警告" %}
启用此选项会：
- **增加 Redis 内存使用**：每个请求的完整消息内容都会被存储
- **可能包含敏感信息**：用户的代码和对话内容会被缓存

建议仅在调试或需要详细监控时临时启用。
{% /callout %}

---

### SHORT_CONTEXT_THRESHOLD

| 属性 | 值 |
|------|-----|
| **类型** | `number` |
| **默认值** | `2` |
| **必需** | 否 |

短上下文阈值，用于并发任务检测。当消息数量小于等于此值时，触发短上下文并发检测逻辑。

---

### ENABLE_SHORT_CONTEXT_DETECTION

| 属性 | 值 |
|------|-----|
| **类型** | `boolean` |
| **默认值** | `true` |
| **必需** | 否 |

是否启用短上下文并发检测。当检测到短上下文（消息数 <= `SHORT_CONTEXT_THRESHOLD`）且存在并发请求时，
系统会强制创建新 Session，避免并发短任务错误复用同一供应商。

---

## 应用配置

### APP_PORT

| 属性 | 值 |
|------|-----|
| **类型** | `number` |
| **默认值** | `23000` |
| **必需** | 否 |

应用对外暴露的端口号。

{% callout type="note" title="Docker Compose 端口映射" %}
在 Docker Compose 部署中，容器内部始终使用端口 `3000`，`APP_PORT` 控制的是映射到宿主机的端口。
{% /callout %}

---

### APP_URL

| 属性 | 值 |
|------|-----|
| **类型** | `string` (URL 格式) |
| **默认值** | 空（自动检测） |
| **必需** | 否（生产环境建议配置） |

应用的完整访问地址，用于 OpenAPI 文档生成等场景。

**配置示例：**

```bash
# HTTPS 域名
APP_URL=https://your-domain.com

# IP 地址访问
APP_URL=http://192.168.1.100:23000

# 本地开发（通常留空自动检测）
APP_URL=
```

**影响范围：**

- OpenAPI 文档中的 `servers` 配置
- API 文档的基础 URL 显示

---

### API_TEST_TIMEOUT_MS

| 属性 | 值 |
|------|-----|
| **类型** | `number` |
| **默认值** | `15000`（15 秒） |
| **范围** | `5000` - `120000` |
| **单位** | 毫秒 |
| **必需** | 否 |

供应商 API 连接测试的超时时间。

**配置建议：**

| 场景 | 建议值 | 说明 |
|------|--------|------|
| 国内直连 | `15000` | 默认值，适合大多数场景 |
| 跨境网络 | `30000` - `60000` | 网络延迟较高时适当增加 |
| 代理访问 | `45000` - `60000` | 代理可能增加额外延迟 |

---

## 安全配置

### ENABLE_SECURE_COOKIES

| 属性 | 值 |
|------|-----|
| **类型** | `boolean` |
| **默认值** | `true` |
| **必需** | 否 |

控制是否强制 HTTPS Cookie（设置 cookie 的 `secure` 属性）。

| 值 | 行为 |
|------|------|
| `true` | 仅允许 HTTPS 传输 Cookie（浏览器自动放行 localhost 的 HTTP） |
| `false` | 允许 HTTP 传输 Cookie（降低安全性） |

{% callout type="error" title="内网部署注意事项" %}
如果您需要通过 **远程 HTTP**（非 localhost）访问管理界面：
- 必须设置 `ENABLE_SECURE_COOKIES=false`
- 否则浏览器将拒绝设置 Cookie，导致无法登录

这会降低安全性，建议配合 VPN 或内网隔离使用。
{% /callout %}

---

## 熔断器配置

### ENABLE_CIRCUIT_BREAKER_ON_NETWORK_ERRORS

| 属性 | 值 |
|------|-----|
| **类型** | `boolean` |
| **默认值** | `false` |
| **必需** | 否 |

控制网络错误是否计入熔断器失败计数。

| 值 | 行为 |
|------|------|
| `false` | 网络错误（DNS 解析失败、连接超时、代理失败等）不触发熔断，仅供应商错误（4xx/5xx）计入 |
| `true` | 所有错误（包括网络错误）都计入熔断器失败计数 |

**使用场景：**

| 场景 | 建议值 | 说明 |
|------|--------|------|
| 网络不稳定（使用代理） | `false` | 避免临时网络抖动触发熔断 |
| 网络稳定环境 | `true` | 连续网络错误也触发熔断保护 |

---

### ENABLE_SMART_PROBING

| 属性 | 值 |
|------|-----|
| **类型** | `boolean` |
| **默认值** | `false` |
| **必需** | 否 |

是否启用智能探测功能。当熔断器处于 `OPEN` 状态时，定期探测供应商以实现更快恢复。

**工作原理：**

1. 定期检查处于 `OPEN` 状态的熔断器
2. 使用轻量级测试请求探测供应商
3. 探测成功则提前将熔断器转为 `HALF_OPEN` 状态

---

### PROBE_INTERVAL_MS

| 属性 | 值 |
|------|-----|
| **类型** | `number` |
| **默认值** | `30000`（30 秒） |
| **单位** | 毫秒 |
| **必需** | 否 |

智能探测的周期间隔。仅在 `ENABLE_SMART_PROBING=true` 时生效。

---

### PROBE_TIMEOUT_MS

| 属性 | 值 |
|------|-----|
| **类型** | `number` |
| **默认值** | `5000`（5 秒） |
| **单位** | 毫秒 |
| **必需** | 否 |

单次探测请求的超时时间。仅在 `ENABLE_SMART_PROBING=true` 时生效。

---

## 高级配置

### ENABLE_MULTI_PROVIDER_TYPES

| 属性 | 值 |
|------|-----|
| **类型** | `boolean` |
| **默认值** | `false` |
| **必需** | 否 |

是否启用多供应商类型支持（实验性功能）。

| 值 | 支持的供应商类型 |
|------|------|
| `false` | 仅支持 `claude`、`claude-auth`、`codex` |
| `true` | 额外支持 `gemini`、`gemini-cli`、`openai-compatible` |

{% callout type="warning" title="实验性功能" %}
Gemini CLI、OpenAI Compatible 等类型功能仍在开发中，可能存在不稳定性。
生产环境暂不建议启用。
{% /callout %}

---

### LOG_LEVEL

| 属性 | 值 |
|------|-----|
| **类型** | `enum` |
| **默认值** | `info` |
| **可选值** | `fatal`、`error`、`warn`、`info`、`debug`、`trace` |
| **必需** | 否 |

日志输出级别，从高到低依次为：`fatal` > `error` > `warn` > `info` > `debug` > `trace`。

| 级别 | 说明 |
|------|------|
| `fatal` | 仅输出致命错误 |
| `error` | 输出错误信息 |
| `warn` | 输出警告和错误 |
| `info` | 标准信息（推荐生产环境使用） |
| `debug` | 调试信息（推荐开发环境使用） |
| `trace` | 最详细的追踪信息 |

---

### DEBUG_MODE

| 属性 | 值 |
|------|-----|
| **类型** | `boolean` |
| **默认值** | `false` |
| **必需** | 否 |

向后兼容的调试模式开关。设置为 `true` 时等同于 `LOG_LEVEL=debug`。

{% callout type="note" %}
建议使用 `LOG_LEVEL` 进行更精细的日志控制，`DEBUG_MODE` 仅为兼容旧配置保留。
{% /callout %}

---

### TZ

| 属性 | 值 |
|------|-----|
| **类型** | `string` |
| **默认值** | `Asia/Shanghai` |
| **必需** | 否 |

系统时区设置，影响日志时间戳和时间相关功能。

**常用时区：**

```bash
TZ=Asia/Shanghai      # 北京时间 (UTC+8)
TZ=America/New_York   # 美东时间
TZ=Europe/London      # 伦敦时间
TZ=UTC                # 协调世界时
```

---

### Fetch 超时配置

以下变量控制上游请求的各阶段超时时间：

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `FETCH_BODY_TIMEOUT` | `120000`（120 秒） | 请求/响应体传输超时 |
| `FETCH_HEADERS_TIMEOUT` | `60000`（60 秒） | 响应头接收超时 |
| `FETCH_CONNECT_TIMEOUT` | `30000`（30 秒） | TCP 连接建立超时 |

这些配置适用于系统向上游供应商发起的所有请求。

---

## 完整配置示例

### 开发环境

```bash
# 必需配置
ADMIN_TOKEN=dev-token-for-local-testing

# 数据库（本地 PostgreSQL）
DSN=postgres://postgres:postgres@localhost:5432/claude_code_hub
AUTO_MIGRATE=true

# Redis（本地）
REDIS_URL=redis://localhost:6379
ENABLE_RATE_LIMIT=true

# 应用
APP_PORT=23000
ENABLE_SECURE_COOKIES=false  # 开发环境允许 HTTP

# 调试
LOG_LEVEL=debug
```

### 生产环境（Docker Compose）

```bash
# 必需配置（务必修改！）
ADMIN_TOKEN=your-secure-random-token-here

# 数据库配置（Docker Compose 自动构建 DSN）
DB_USER=postgres
DB_PASSWORD=your-strong-password-here
DB_NAME=claude_code_hub
AUTO_MIGRATE=false  # 生产环境手动控制迁移

# Redis
REDIS_URL=redis://redis:6379
ENABLE_RATE_LIMIT=true

# Session
SESSION_TTL=300
STORE_SESSION_MESSAGES=false

# 应用
APP_PORT=23000
APP_URL=https://your-domain.com
ENABLE_SECURE_COOKIES=true

# 熔断器
ENABLE_CIRCUIT_BREAKER_ON_NETWORK_ERRORS=false
ENABLE_SMART_PROBING=true
PROBE_INTERVAL_MS=30000
PROBE_TIMEOUT_MS=5000

# 日志
LOG_LEVEL=info
TZ=Asia/Shanghai
```

### 内网部署（HTTP 访问）

```bash
# 必需配置
ADMIN_TOKEN=your-secure-random-token-here

# 数据库
DSN=postgres://user:password@db-server:5432/claude_code_hub

# Redis
REDIS_URL=redis://redis-server:6379

# 安全配置（内网 HTTP 访问）
ENABLE_SECURE_COOKIES=false  # 允许 HTTP Cookie

# 应用
APP_PORT=23000
APP_URL=http://192.168.1.100:23000
```

---

## 环境变量验证

系统启动时会通过 Zod schema 验证环境变量。如果配置无效，会输出明确的错误信息。

验证规则定义在 `src/lib/config/env.schema.ts` 中，主要包括：

- 类型验证（字符串、数字、布尔值）
- 必需字段检查
- 默认值应用
- URL 格式验证
- 枚举值验证

{% callout type="note" title="占位符处理" %}
系统会自动忽略占位符值：
- `DSN` 中包含 `user:password@host:port` 的模板会被视为未配置
- `ADMIN_TOKEN` 值为 `change-me` 会被视为未配置
{% /callout %}
