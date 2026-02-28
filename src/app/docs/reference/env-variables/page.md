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
- **API Key 安全配置**：Vacuum Filter 和鉴权缓存
- **熔断器配置**：故障保护和智能探测
- **端点探测配置**：端点健康检查和动态间隔
- **Langfuse 可观测性**：LLM 请求追踪和分析
- **高级配置**：调试、性能、超时和实验性功能

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

{% callout type="warning" title="安全警告" %}
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

会话消息存储模式。控制请求/响应中 message 内容的存储方式（v0.5.1 行为变更）。

- **`false`（默认）**：存储请求/响应体但对 message 内容脱敏，显示为 `[REDACTED]`
- **`true`**：原样存储 message 内容

{% callout type="warning" title="资源和隐私警告" %}
启用此选项会：
- **增加 Redis/DB 存储空间**：每个请求的完整消息内容都会被存储
- **可能包含敏感信息**：用户的代码和对话内容会被缓存

建议仅在调试或需要详细监控时临时启用。
{% /callout %}

---

### STORE_SESSION_RESPONSE_BODY

| 属性 | 值 |
|------|-----|
| **类型** | `boolean` |
| **默认值** | `true` |
| **必需** | 否 |

是否在 Redis 中存储会话响应体（SSE/JSON）。用于调试和问题定位。

- **`true`（默认）**：存储响应体到 Redis 临时缓存
- **`false`**：不存储响应体

{% callout type="note" %}
此开关不影响内部统计读取响应体（tokens/费用统计、SSE 假 200 检测仍会正常进行），仅影响后续通过管理面板查看 response body。
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

{% callout type="warning" title="内网部署注意事项" %}
如果您需要通过 **远程 HTTP**（非 localhost）访问管理界面：
- 必须设置 `ENABLE_SECURE_COOKIES=false`
- 否则浏览器将拒绝设置 Cookie，导致无法登录

这会降低安全性，建议配合 VPN 或内网隔离使用。
{% /callout %}

---

## API Key 安全配置

### ENABLE_API_KEY_VACUUM_FILTER

| 属性 | 值 |
|------|-----|
| **类型** | `boolean` |
| **默认值** | `true` |
| **必需** | 否 |

启用 API Key 真空过滤器（Vacuum Filter），在访问数据库前对无效 API Key 进行负向短路，降低数据库压力、抵御暴力破解。

| 值 | 行为 |
|------|------|
| `true` | 启用过滤器，无效 Key 在内存中即被拦截 |
| `false` | 禁用过滤器，所有 Key 查询直接走数据库 |

---

### ENABLE_API_KEY_REDIS_CACHE

| 属性 | 值 |
|------|-----|
| **类型** | `boolean` |
| **默认值** | `true` |
| **必需** | 否 |

是否启用 API Key Redis 缓存。需要 `ENABLE_RATE_LIMIT=true` 且配置 `REDIS_URL` 才会生效；否则自动回落到数据库查询。

---

### API_KEY_AUTH_CACHE_TTL_SECONDS

| 属性 | 值 |
|------|-----|
| **类型** | `number` |
| **默认值** | `60` |
| **单位** | 秒 |
| **范围** | 最大 3600 |
| **必需** | 否 |

API Key 鉴权缓存 TTL。缓存链路为 Vacuum Filter -> Redis -> DB。

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

### ENABLE_ENDPOINT_CIRCUIT_BREAKER

| 属性 | 值 |
|------|-----|
| **类型** | `boolean` |
| **默认值** | `false` |
| **必需** | 否 |

控制是否启用端点级别的熔断器。

| 值 | 行为 |
|------|------|
| `false` | 禁用端点熔断器，所有启用的端点均可使用 |
| `true` | 启用熔断器，供应商类型级别和端点级别的熔断器均生效，连续失败的端点会被临时屏蔽（默认 3 次失败后熔断 5 分钟） |

{% callout type="note" %}
此开关同时控制供应商类型级别和端点级别的熔断器。启用后，供应商类型和端点的熔断器都会生效。
{% /callout %}

---

## 端点探测配置

端点探测始终启用，定期检查所有启用的端点并刷新端点选择排名。

### ENDPOINT_PROBE_INTERVAL_MS

| 属性 | 值 |
|------|-----|
| **类型** | `number` |
| **默认值** | `60000`（60 秒） |
| **单位** | 毫秒 |
| **必需** | 否 |

端点探测基础间隔。系统使用动态间隔规则：
1. **超时覆盖**（10 秒）：端点上次探测超时且未恢复时
2. **单端点供应商**（10 分钟）：供应商仅有 1 个启用端点时
3. **基础间隔**：其他端点使用此值

---

### ENDPOINT_PROBE_TIMEOUT_MS

| 属性 | 值 |
|------|-----|
| **类型** | `number` |
| **默认值** | `5000`（5 秒） |
| **单位** | 毫秒 |
| **必需** | 否 |

单次端点探测超时时间。

---

### ENDPOINT_PROBE_METHOD

| 属性 | 值 |
|------|-----|
| **类型** | `string` |
| **默认值** | `TCP` |
| **可选值** | `TCP` / `HEAD` / `GET` |
| **必需** | 否 |

端点探测方式。`TCP` 模式（默认）仅检测连接，不发送 HTTP 请求，不产生访问日志。

---

### ENDPOINT_PROBE_CONCURRENCY

| 属性 | 值 |
|------|-----|
| **类型** | `number` |
| **默认值** | `10` |
| **必需** | 否 |

端点探测并发数。

---

### ENDPOINT_PROBE_LOG_RETENTION_DAYS

| 属性 | 值 |
|------|-----|
| **类型** | `number` |
| **默认值** | `1` |
| **单位** | 天 |
| **必需** | 否 |

探测日志保留天数。自动清理任务每 24 小时运行，删除过期记录。

---

## Langfuse 可观测性

以下变量控制 Langfuse LLM 可观测性集成，自 v0.6.0 起可用。

### LANGFUSE_PUBLIC_KEY

| 属性 | 值 |
|------|-----|
| **类型** | `string` |
| **默认值** | 无 |
| **必需** | 否（设置后自动启用 Langfuse） |

Langfuse 项目公钥，以 `pk-lf-` 开头。与 `LANGFUSE_SECRET_KEY` 同时配置后自动启用追踪。

---

### LANGFUSE_SECRET_KEY

| 属性 | 值 |
|------|-----|
| **类型** | `string` |
| **默认值** | 无 |
| **必需** | 否（设置后自动启用 Langfuse） |

Langfuse 项目密钥，以 `sk-lf-` 开头。

---

### LANGFUSE_BASE_URL

| 属性 | 值 |
|------|-----|
| **类型** | `string` (URL 格式) |
| **默认值** | `https://cloud.langfuse.com` |
| **必需** | 否 |

Langfuse 服务器地址。使用 Langfuse Cloud 时无需修改，自托管实例需指向你的服务地址。

---

### LANGFUSE_SAMPLE_RATE

| 属性 | 值 |
|------|-----|
| **类型** | `number` |
| **默认值** | `1.0` |
| **范围** | `0.0` - `1.0` |
| **必需** | 否 |

追踪采样率。`0.0` 表示不采样，`1.0` 表示全量采样。高并发场景建议降低采样率以控制 Langfuse 存储成本。

---

### LANGFUSE_DEBUG

| 属性 | 值 |
|------|-----|
| **类型** | `boolean` |
| **默认值** | `false` |
| **必需** | 否 |

是否启用 Langfuse SDK 调试日志。排查 Langfuse 集成问题时可临时开启。

---

## 高级配置

### ENABLE_PROVIDER_CACHE

| 属性 | 值 |
|------|-----|
| **类型** | `boolean` |
| **默认值** | `true` |
| **必需** | 否 |

启用供应商进程级缓存（30s TTL + Redis Pub/Sub 跨实例即时失效），提升供应商查询性能。禁用后每次请求直接查询数据库。

---

### MESSAGE_REQUEST_WRITE_MODE

| 属性 | 值 |
|------|-----|
| **类型** | `string` |
| **默认值** | `async` |
| **可选值** | `async` / `sync` |
| **必需** | 否 |

请求日志（message_request）写入模式。`async` 为异步批量写入（降低 DB 写放大和连接占用），`sync` 为同步写入（兼容旧行为，但高并发下会增加请求尾部阻塞）。

---

### DB_POOL_MAX

| 属性 | 值 |
|------|-----|
| **类型** | `number` |
| **默认值** | `20`（生产），`10`（开发） |
| **必需** | 否 |

PostgreSQL 每个应用进程的连接池上限。K8s 多副本部署时需按副本数分摊。

---

### MAX_RETRY_ATTEMPTS_DEFAULT

| 属性 | 值 |
|------|-----|
| **类型** | `number` |
| **默认值** | `2` |
| **范围** | 1-10 |
| **必需** | 否 |

单供应商最大尝试次数（含首次调用）。

---

### LOG_LEVEL

| 属性 | 值 |
|------|-----|
| **类型** | `enum` |
| **默认值** | 开发环境: `debug`，生产环境: `info` |
| **可选值** | `fatal`、`error`、`warn`、`info`、`debug`、`trace` |
| **必需** | 否 |

日志输出级别，从高到低依次为：`fatal` > `error` > `warn` > `info` > `debug` > `trace`。

**级别详细说明：**

| 级别 | 优先级 | 说明 |
|------|--------|------|
| `fatal` | 60 | 仅输出致命错误 |
| `error` | 50 | 输出错误信息 |
| `warn` | 40 | 输出警告和错误 |
| `info` | 30 | 标准信息（推荐生产环境使用） |
| `debug` | 20 | 调试信息（推荐开发环境使用） |
| `trace` | 10 | 最详细的追踪信息 |

**默认值逻辑：**

1. 优先使用环境变量 `LOG_LEVEL` 的值
2. 如果未设置 `LOG_LEVEL`，检查 `DEBUG_MODE` 是否为 `true`（向后兼容）
3. 如果都未设置，根据运行环境决定：
   - 开发环境（`NODE_ENV !== 'production'`）：`debug`
   - 生产环境：`info`

{% callout type="note" title="优先级说明" %}
`LOG_LEVEL` 的优先级高于 `DEBUG_MODE`。如果同时设置了两者，以 `LOG_LEVEL` 为准。
{% /callout %}

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
| `FETCH_BODY_TIMEOUT` | `600000`（600 秒） | 请求/响应体传输超时 |
| `FETCH_HEADERS_TIMEOUT` | `600000`（600 秒） | 响应头接收超时 |
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
ENABLE_ENDPOINT_CIRCUIT_BREAKER=false

# API Key 安全
ENABLE_API_KEY_VACUUM_FILTER=true
ENABLE_API_KEY_REDIS_CACHE=true
API_KEY_AUTH_CACHE_TTL_SECONDS=60

# 日志
LOG_LEVEL=info
TZ=Asia/Shanghai

# Langfuse 可观测性（可选）
# LANGFUSE_PUBLIC_KEY=pk-lf-your-public-key
# LANGFUSE_SECRET_KEY=sk-lf-your-secret-key
# LANGFUSE_BASE_URL=https://cloud.langfuse.com
# LANGFUSE_SAMPLE_RATE=1.0
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
