---
dimensions:
  type:
    primary: implementation
    detail: setup
  level: intermediate
standard_title: 环境配置
language: zh
---

# 环境配置

本文档详细介绍 Claude Code Hub (CCH) 的环境变量配置。正确配置这些参数对于系统的稳定运行至关重要。

---

## 基础配置

### ADMIN_TOKEN

管理员登录令牌，用于访问后台管理界面。

```env
ADMIN_TOKEN=your-secure-token-here
```

{% callout type="warning" title="安全警告" %}
部署前必须修改此值！默认值 `change-me` 仅用于开发环境。建议使用至少 32 位的随机字符串。
{% /callout %}

### APP_PORT

应用服务端口。

```env
APP_PORT=23000
```

- **默认值**: `23000`
- **说明**: 生产端口，可被容器或进程管理器覆盖

### APP_URL

应用访问地址，用于 OpenAPI 文档中正确显示服务器地址。

```env
APP_URL=https://your-domain.com
```

- **默认值**: 空（自动检测）
- **说明**: 生产环境建议显式配置
- **示例**: `https://your-domain.com` 或 `http://192.168.1.100:23000`

### AUTO_MIGRATE

控制启动时是否自动执行数据库迁移。

```env
AUTO_MIGRATE=true
```

- **默认值**: `true`
- **说明**: 生产环境完成初始部署后建议改为 `false`，使用 Drizzle CLI 手动管理迁移

---

## 数据库配置

### DSN

PostgreSQL 数据库连接字符串。

```env
DSN=postgres://user:password@host:port/db_name
```

**Docker Compose 部署示例**:

```env
DSN=postgres://postgres:postgres@postgres:5432/claude_code_hub
```

**本地开发示例**:

```env
DSN=postgres://user:password@localhost:5432/claude_code_hub
```

{% callout type="note" title="Docker 环境说明" %}
在 Docker Compose 场景下，使用服务名（如 `postgres:5432`）而非 `localhost`。
{% /callout %}

### Docker Compose 专用配置

使用 Docker Compose 部署时，可以使用以下变量自动配置数据库：

```env
DB_USER=postgres
DB_PASSWORD=your-secure-password_change-me
DB_NAME=claude_code_hub
```

---

## Redis 配置

Redis 用于限流、Session 追踪和分布式状态管理。

### REDIS_URL

Redis 连接地址。

```env
REDIS_URL=redis://localhost:6379
```

**不同环境配置**:

```env
# 本地开发
REDIS_URL=redis://localhost:6379

# Docker Compose 部署
REDIS_URL=redis://redis:6379

# TLS 加密连接
REDIS_URL=rediss://your-redis-host:6379
```

{% callout type="note" title="Fail-Open 策略" %}
CCH 采用 Fail-Open 策略：Redis 不可用时限流与会话统计会降级，但请求仍会继续处理。建议监控日志中的 Redis Error 并尽快恢复。
{% /callout %}

---

## 限流配置

### ENABLE_RATE_LIMIT

是否启用多维限流功能。

```env
ENABLE_RATE_LIMIT=true
```

- **默认值**: `true`
- **功能包括**:
  - 金额限制（5小时/周/月）
  - Session 并发限制
  - RPM (每分钟请求数) 限制

---

## Session 配置

### SESSION_TTL

Session 过期时间（秒）。

```env
SESSION_TTL=300
```

- **默认值**: `300`（5 分钟）
- **说明**: 影响供应商复用策略，5 分钟内的请求会路由到同一供应商以提高缓存命中率

### STORE_SESSION_MESSAGES

是否存储请求 messages 到 Redis。

```env
STORE_SESSION_MESSAGES=false
```

- **默认值**: `false`
- **用途**: 用于实时监控页面查看请求详情

{% callout type="warning" title="注意" %}
启用后会增加 Redis 内存使用，且可能包含敏感信息。仅在需要调试时启用。
{% /callout %}

---

## 安全配置

### ENABLE_SECURE_COOKIES

控制是否强制 HTTPS Cookie。

```env
ENABLE_SECURE_COOKIES=true
```

- **默认值**: `true`
- **说明**:
  - `true`: 仅允许 HTTPS 传输 Cookie（浏览器会自动放行 localhost 的 HTTP）
  - `false`: 允许 HTTP 传输 Cookie（会降低安全性，仅推荐用于内网部署）

{% callout type="warning" title="重要提示" %}
若设置为 `true` 且使用远程 HTTP 访问（非 localhost），浏览器将拒绝设置 Cookie 导致无法登录。
{% /callout %}

---

## 熔断器配置

### ENABLE_CIRCUIT_BREAKER_ON_NETWORK_ERRORS

控制网络错误是否计入熔断器失败计数。

```env
ENABLE_CIRCUIT_BREAKER_ON_NETWORK_ERRORS=false
```

- **默认值**: `false`
- **配置说明**:
  - `false`: 网络错误（DNS 解析失败、连接超时、代理连接失败等）不计入熔断器，仅供应商错误（4xx/5xx HTTP 响应）计入
  - `true`: 所有错误都计入熔断器失败计数

**使用场景**:

| 场景 | 建议配置 | 原因 |
|------|----------|------|
| 网络不稳定环境（使用代理） | `false` | 避免因临时网络抖动触发熔断器 |
| 网络稳定环境 | `true` | 连续网络错误也应触发熔断保护 |

---

## 智能探测配置

当熔断器处于 OPEN 状态时，定期探测供应商以实现更快恢复。

### ENABLE_SMART_PROBING

是否启用智能探测。

```env
ENABLE_SMART_PROBING=false
```

- **默认值**: `false`

### PROBE_INTERVAL_MS

探测周期间隔（毫秒）。

```env
PROBE_INTERVAL_MS=30000
```

- **默认值**: `30000`（30秒）

### PROBE_TIMEOUT_MS

单次探测超时时间（毫秒）。

```env
PROBE_TIMEOUT_MS=5000
```

- **默认值**: `5000`（5秒）

**工作原理**:
1. 定期检查处于 OPEN 状态的熔断器
2. 使用轻量级测试请求探测供应商
3. 探测成功则提前将熔断器转为 HALF_OPEN 状态

---

## API 测试配置

### API_TEST_TIMEOUT_MS

供应商 API 测试请求超时时间（毫秒）。

```env
API_TEST_TIMEOUT_MS=15000
```

- **默认值**: `15000`（15秒）
- **范围**: 5000-120000
- **说明**: 跨境网络环境可适当提高此值

---

## 高级配置

### ENABLE_MULTI_PROVIDER_TYPES

启用多提供商类型支持（实验性功能）。

```env
ENABLE_MULTI_PROVIDER_TYPES=false
```

- **默认值**: `false`
- **说明**:
  - `false`: 仅支持 Claude、Codex 类型供应商
  - `true`: 支持 Gemini CLI、OpenAI Compatible 等其他类型

{% callout type="warning" title="实验性功能" %}
其他类型功能仍在开发中，暂不建议在生产环境启用。
{% /callout %}

---

## 配置示例

### 最小化生产配置

```env
# 必须配置
ADMIN_TOKEN=your-secure-random-token-at-least-32-chars

# 数据库
DSN=postgres://user:password@localhost:5432/claude_code_hub

# Redis
REDIS_URL=redis://localhost:6379
```

### 完整生产配置

```env
# 管理员认证
ADMIN_TOKEN=your-secure-random-token-at-least-32-chars

# 数据库
DSN=postgres://cch_user:secure_password@db.example.com:5432/claude_code_hub
AUTO_MIGRATE=false

# Redis
REDIS_URL=rediss://redis.example.com:6379
ENABLE_RATE_LIMIT=true

# 应用
APP_PORT=23000
APP_URL=https://cch.example.com

# Session
SESSION_TTL=300
STORE_SESSION_MESSAGES=false

# 安全
ENABLE_SECURE_COOKIES=true

# 熔断器
ENABLE_CIRCUIT_BREAKER_ON_NETWORK_ERRORS=false
ENABLE_SMART_PROBING=true
PROBE_INTERVAL_MS=30000
PROBE_TIMEOUT_MS=5000

# API 测试
API_TEST_TIMEOUT_MS=15000
```

### Docker Compose 配置

```env
# 管理员认证
ADMIN_TOKEN=your-secure-random-token

# Docker Compose 数据库配置
DB_USER=postgres
DB_PASSWORD=your-secure-db-password
DB_NAME=claude_code_hub

# Redis（使用 Docker 服务名）
REDIS_URL=redis://redis:6379

# 应用
APP_PORT=23000
```

---

## 配置注意事项

{% callout type="note" title="布尔值格式" %}
布尔变量请直接写 `true/false` 或 `1/0`，**不要**加引号，避免被 Zod 转换为真值。
{% /callout %}

### 常见问题

**Q: 数据库连接失败怎么办？**

- 确认 `DSN` 格式与凭据无误
- Docker 场景下使用服务名（如 `postgres:5432`）
- 查看 `docker compose ps` 或本地 PostgreSQL 状态

**Q: Redis 离线会影响服务吗？**

平台采用 Fail-Open 策略：限流与会话统计会降级，但请求仍会继续。建议监控日志中的 Redis Error 并尽快恢复。

**Q: 熔断器持续打开如何排查？**

1. 查看日志中的 `[CircuitBreaker]` 记录
2. 确认是否由于 4xx/5xx 或网络错误导致
3. 在管理后台检查供应商健康状态
4. 等待 30 分钟或重启应用重置状态
