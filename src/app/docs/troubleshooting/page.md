---
dimensions:
  scope: intermediate
  context: operational
  language: zh-CN
standard_title: troubleshooting
---

# 故障排查指南

本指南汇总了 Claude Code Hub 使用过程中常见问题的诊断方法和解决方案，帮助您快速定位和解决问题。

---

## 部署问题

### 数据库连接失败

**现象**
- 应用启动时报错 `Connection refused` 或 `ECONNREFUSED`
- 日志显示 `Database connection failed`

**原因**
1. DSN 格式或凭据配置错误
2. 数据库服务未启动
3. 网络/防火墙阻止连接
4. Docker 环境下使用了错误的主机名

**解决方案**

1. 确认 DSN 格式正确：
```bash
# 正确格式
DSN=postgres://用户名:密码@主机:端口/数据库名

# Docker Compose 环境示例
DSN=postgres://postgres:postgres@postgres:5432/claude_code_hub
```

2. 检查数据库服务状态：
```bash
# Docker 环境
docker compose ps postgres
docker compose logs postgres

# 本地环境
systemctl status postgresql
```

3. 测试数据库连接：
```bash
# 使用 psql 测试
psql "postgres://用户名:密码@主机:端口/数据库名"

# Docker 环境下进入容器测试
docker compose exec postgres psql -U postgres -d claude_code_hub
```

{% callout type="warning" %}
Docker Compose 环境下，应用容器应使用服务名（如 `postgres`）而非 `localhost` 作为数据库主机名。
{% /callout %}

---

### Redis 连接问题

**现象**
- 日志显示 `Redis connection error` 或 `ECONNREFUSED`
- 限流功能失效但请求仍可处理（Fail-Open 策略生效）

**原因**
1. Redis 服务未启动
2. REDIS_URL 配置错误
3. 需要 TLS 但未使用 `rediss://` 协议

**解决方案**

1. 检查 Redis 服务状态：
```bash
# Docker 环境
docker compose ps redis
docker compose logs redis

# 本地环境
redis-cli ping
```

2. 确认 REDIS_URL 配置正确：
```bash
# 标准连接
REDIS_URL=redis://localhost:6379

# Docker Compose 环境
REDIS_URL=redis://redis:6379

# TLS 连接（云服务）
REDIS_URL=rediss://用户:密码@主机:6379
```

3. 测试 Redis 连接：
```bash
redis-cli -u "redis://localhost:6379" ping
```

{% callout type="note" %}
Redis 不可用时，系统采用 Fail-Open 策略：限流和 Session 统计会降级，但请求仍会继续处理。建议监控日志及时发现并恢复 Redis 服务。
{% /callout %}

---

### 自动迁移失败

**现象**
- 启动时报错 `Migration failed`
- 数据库表结构不完整

**原因**
1. 数据库权限不足
2. 存在冲突的手动修改
3. 迁移文件损坏

**解决方案**

1. 确认数据库用户有足够权限：
```sql
GRANT ALL PRIVILEGES ON DATABASE claude_code_hub TO postgres;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO postgres;
```

2. 手动执行迁移：
```bash
# 进入应用容器
docker compose exec app sh

# 查看迁移状态
bunx drizzle-kit check

# 手动推送 schema
bunx drizzle-kit push
```

3. 如需禁用自动迁移：
```bash
# .env 配置
AUTO_MIGRATE=false
```

{% callout type="warning" %}
生产环境建议在首次部署成功后将 `AUTO_MIGRATE` 设为 `false`，使用 Drizzle CLI 手动管理迁移。
{% /callout %}

---

### Cookie 设置失败导致无法登录

**现象**
- 输入正确的 Admin Token 后仍无法登录
- 浏览器开发者工具显示 Cookie 未被设置

**原因**
- 使用 HTTP（非 localhost）访问时，`ENABLE_SECURE_COOKIES=true` 导致浏览器拒绝设置 Cookie

**解决方案**

1. 推荐：配置 HTTPS 反向代理（Nginx/Caddy）

2. 内网部署临时方案：
```bash
# .env 配置
ENABLE_SECURE_COOKIES=false
```

{% callout type="warning" %}
将 `ENABLE_SECURE_COOKIES` 设为 `false` 会降低安全性，仅推荐在受信任的内网环境使用。
{% /callout %}

---

## 认证问题

### API Key 无效

**现象**
- 请求返回 `401 Unauthorized`
- 错误消息 `Invalid API key`

**原因**
1. API Key 格式错误或不存在
2. API Key 已被禁用或过期
3. Authorization 头格式错误

**解决方案**

1. 确认 Authorization 头格式正确：
```bash
# 正确格式
Authorization: Bearer cch_xxxxx

# 或使用 x-api-key 头
x-api-key: cch_xxxxx
```

2. 在管理后台检查 API Key 状态：
   - 确认 Key 处于启用状态
   - 检查是否已过期
   - 确认 Key 归属用户处于启用状态

3. 重新生成 API Key：
   - 进入 **设置 > API Keys 管理**
   - 创建新的 API Key
   - 更新客户端配置

---

### Admin Token 错误

**现象**
- 无法登录管理后台
- 提示"令牌无效"

**原因**
1. Token 输入错误（注意空格）
2. 环境变量未正确加载
3. 使用了默认的不安全 Token

**解决方案**

1. 确认 `.env` 中的 `ADMIN_TOKEN` 配置：
```bash
# 查看当前配置（注意保护敏感信息）
docker compose exec app printenv ADMIN_TOKEN
```

2. 重新设置 Token：
```bash
# .env 配置（使用强密码）
ADMIN_TOKEN=你的安全令牌
```

3. 重启应用使配置生效：
```bash
docker compose restart app
```

{% callout type="warning" %}
请务必修改默认的 `ADMIN_TOKEN`，使用至少 32 个字符的随机字符串。
{% /callout %}

---

## 供应商问题

### 提示"无可用供应商"

**现象**
- 请求返回 `503 Service Unavailable`
- 错误消息 `No available provider found`

**原因**
1. 所有供应商都被禁用
2. 所有供应商的熔断器都处于 OPEN 状态
3. 供应商分组限制导致无法匹配
4. 并发限制已达上限

**解决方案**

1. 在管理后台检查供应商状态：
   - 进入 **设置 > 供应商管理**
   - 确认至少有一个供应商处于启用状态
   - 查看熔断器状态

2. 如熔断器处于 OPEN 状态：
   - 等待熔断器自动恢复（默认 30 分钟）
   - 或手动重置熔断器（重启应用）

3. 检查供应商分组设置：
   - 确认用户的 `providerGroup` 与供应商的 `groupTag` 匹配
   - 或将用户的 `providerGroup` 设为空以使用所有供应商

4. 检查并发限制：
```bash
# 查看 Redis 中的活跃 Session
redis-cli keys "session:*" | wc -l
```

---

### 熔断器持续打开

**现象**
- 日志显示 `Circuit breaker is OPEN for provider`
- 供应商长时间不可用

**原因**
1. 供应商 API 持续返回错误
2. 网络问题导致连接失败
3. 熔断器配置过于敏感

**解决方案**

1. 查看日志中的熔断器记录：
```bash
docker compose logs app | grep -i "circuit"
```

2. 使用管理后台测试供应商连接：
   - 进入供应商管理页面
   - 点击"测试连接"按钮
   - 查看返回的错误信息

3. 调整熔断器配置（供应商级别）：
```json
{
  "circuitBreakerFailureThreshold": 5,      // 触发熔断的失败次数
  "circuitBreakerOpenDuration": 1800000,    // 熔断持续时间（毫秒）
  "circuitBreakerHalfOpenSuccessThreshold": 2  // 恢复所需成功次数
}
```

4. 如需将网络错误也计入熔断：
```bash
# .env 配置
ENABLE_CIRCUIT_BREAKER_ON_NETWORK_ERRORS=true
```

5. 重启应用重置所有熔断器状态：
```bash
docker compose restart app
```

---

### 代理配置失败

**现象**
- 通过代理的请求超时或失败
- 日志显示代理连接错误

**原因**
1. 代理 URL 格式错误
2. 代理服务不可用
3. 代理认证失败

**解决方案**

1. 确认代理 URL 格式正确：
```bash
# HTTP 代理
http://用户:密码@主机:端口

# HTTPS 代理
https://用户:密码@主机:端口

# SOCKS5 代理
socks5://用户:密码@主机:端口
```

2. 使用管理后台测试代理连接：
   - 进入供应商管理页面
   - 配置代理 URL
   - 点击"测试连接"验证

3. 启用代理降级策略：
   - 在供应商设置中启用 `proxy_fallback_to_direct`
   - 代理失败时自动切换到直连

{% callout type="note" %}
使用代理时，建议适当增加 `API_TEST_TIMEOUT_MS` 配置值（范围 5000-120000 毫秒）。
{% /callout %}

---

### 供应商返回错误

**现象**
- 请求返回 4xx 或 5xx 错误
- 错误来自上游供应商

**原因**
1. 供应商 API Key 无效或过期
2. 请求参数不符合供应商要求
3. 供应商服务暂时不可用
4. 账户余额不足或配额耗尽

**解决方案**

1. 检查供应商 API Key：
   - 确认 Key 有效且有正确权限
   - 检查供应商控制台的账户状态

2. 查看详细错误信息：
```bash
# 查看最近的错误日志
docker compose logs app --tail=100 | grep -i "error"
```

3. 根据错误码处理：
   - `400`: 检查请求参数
   - `401/403`: 检查 API Key
   - `429`: 触发了供应商限流
   - `500/502/503`: 供应商服务问题，等待恢复或使用其他供应商

---

## 限流问题

### 触发限流 (429)

**现象**
- 请求返回 `429 Too Many Requests`
- 返回头包含 `Retry-After`

**原因**
1. 超过 RPM（每分钟请求数）限制
2. 超过金额限制（5 小时/日/周/月）
3. 超过并发 Session 限制

**解决方案**

1. 查看限流详情：
   - 检查返回的错误消息，了解触发的具体限制
   - 查看 `Retry-After` 头获取重试时间

2. 调整用户限制：
   - 进入 **设置 > 用户管理**
   - 修改对应用户的限流配置

3. 调整 API Key 限制：
   - 进入 **设置 > API Keys 管理**
   - 修改对应 Key 的限流配置

4. 限流维度说明：

| 维度 | 配置字段 | 说明 |
|------|---------|------|
| RPM | `rpmLimit` | 每分钟请求数限制 |
| 5小时金额 | `limit5hUsd` | 滑动窗口5小时内消费限制 |
| 日金额 | `dailyLimitUsd` | 固定时间窗口每日消费限制 |
| 周金额 | `limitWeeklyUsd` | 每周消费限制 |
| 月金额 | `limitMonthlyUsd` | 每月消费限制 |
| 并发 | `limitConcurrentSessions` | 同时活跃的 Session 数量 |

{% callout type="note" %}
限流采用多层级设计：用户级别、API Key 级别、供应商级别。实际限制取各级别中的最严格值。
{% /callout %}

---

### 限流不生效

**现象**
- 配置了限流但未生效
- 日志显示 `Rate limit skipped` 或 `fail-open`

**原因**
1. `ENABLE_RATE_LIMIT` 配置为 `false`
2. Redis 不可用，Fail-Open 策略生效
3. 限流值配置为 0 或 null（表示无限制）

**解决方案**

1. 确认限流功能已启用：
```bash
# .env 配置
ENABLE_RATE_LIMIT=true
```

2. 检查 Redis 连接状态：
```bash
# 查看应用日志中的 Redis 错误
docker compose logs app | grep -i "redis"

# 测试 Redis 连接
redis-cli -u "$REDIS_URL" ping
```

3. 确认限流值配置正确：
   - 值为 `0` 或 `null` 表示无限制
   - 确保设置了具体的数值限制

---

## 性能问题

### 请求延迟高

**现象**
- API 响应时间明显变长
- 日志显示 `duration_ms` 值偏高

**原因**
1. 供应商响应慢
2. 网络延迟
3. 代理链路问题
4. 系统资源不足

**解决方案**

1. 检查供应商响应时间：
   - 查看日志中的 `durationMs` 字段
   - 对比不同供应商的响应时间

2. 调整供应商超时配置：
```json
{
  "timeout": 120000,           // 总超时（毫秒）
  "firstByteTimeout": 30000,   // 首字节超时
  "idleTimeout": 60000         // 空闲超时
}
```

3. 检查系统资源：
```bash
# 查看容器资源使用
docker stats

# 查看应用内存使用
docker compose exec app ps aux
```

4. 优化供应商选择：
   - 调整权重，优先使用响应快的供应商
   - 启用 Session 粘性减少上下文传输

---

### 流式响应卡顿

**现象**
- Streaming 输出断断续续
- 长时间无新数据

**原因**
1. 供应商端生成速度慢
2. 网络传输不稳定
3. 客户端处理能力不足
4. 空闲超时配置过短

**解决方案**

1. 调整供应商的空闲超时：
   - 在供应商设置中增加 `idleTimeout` 值
   - 默认 60 秒，可根据需要调整

2. 检查网络稳定性：
```bash
# 测试到供应商的网络延迟
ping api.anthropic.com
```

3. 使用代理改善连接质量：
   - 配置稳定的代理服务
   - 选择距离供应商更近的代理节点

---

### 内存使用过高

**现象**
- 应用容器内存持续增长
- 出现 OOM (Out of Memory) 错误

**原因**
1. 大量并发长连接
2. 日志积累过多
3. 内存泄漏

**解决方案**

1. 限制并发连接数：
   - 调整供应商的 `limitConcurrentSessions`
   - 配置合理的用户并发限制

2. 调整容器内存限制：
```yaml
# docker-compose.yml
services:
  app:
    deploy:
      resources:
        limits:
          memory: 2G
```

3. 启用自动日志清理：
   - 在系统设置中启用 `enableAutoCleanup`
   - 配置合理的 `cleanupRetentionDays`

4. 重启应用释放内存：
```bash
docker compose restart app
```

---

## 日志分析

### 日志级别说明

系统使用 Pino 日志库，支持以下级别（从高到低）：

| 级别 | 数值 | 说明 |
|-----|------|------|
| fatal | 60 | 致命错误，系统无法继续运行 |
| error | 50 | 错误，需要关注 |
| warn | 40 | 警告，潜在问题 |
| info | 30 | 一般信息 |
| debug | 20 | 调试信息 |
| trace | 10 | 详细追踪信息 |

默认级别：开发环境 `debug`，生产环境 `info`

---

### 常用日志查看命令

```bash
# 查看实时日志
docker compose logs -f app

# 查看最近 100 行日志
docker compose logs app --tail=100

# 筛选错误日志
docker compose logs app 2>&1 | grep -i "error"

# 筛选特定供应商的日志
docker compose logs app 2>&1 | grep "providerId"

# 筛选熔断器相关日志
docker compose logs app 2>&1 | grep -i "circuit"

# 筛选限流相关日志
docker compose logs app 2>&1 | grep -i "rate"

# 按时间范围查看（Docker 支持）
docker compose logs app --since="2024-01-01T00:00:00" --until="2024-01-01T23:59:59"
```

---

### 关键日志字段

| 字段 | 说明 |
|-----|------|
| `level` | 日志级别 |
| `time` | 时间戳 |
| `msg` | 日志消息 |
| `providerId` | 供应商 ID |
| `userId` | 用户 ID |
| `sessionId` | 会话 ID |
| `durationMs` | 请求耗时（毫秒） |
| `statusCode` | HTTP 状态码 |
| `error` | 错误信息 |
| `providerChain` | 供应商调用链 |

---

### 日志分析示例

**分析请求失败原因：**
```bash
# 查找所有失败请求
docker compose logs app 2>&1 | grep '"statusCode":5'

# 查找特定用户的请求
docker compose logs app 2>&1 | grep '"userId":1'
```

**分析性能问题：**
```bash
# 查找慢请求（>10秒）
docker compose logs app 2>&1 | grep -E '"durationMs":[0-9]{5,}'
```

---

## 错误码参考

### HTTP 状态码

| 状态码 | 类型 | 说明 |
|-------|------|------|
| 400 | Bad Request | 请求参数错误 |
| 401 | Unauthorized | 认证失败（API Key 无效） |
| 403 | Forbidden | 无权访问 |
| 404 | Not Found | 资源不存在 |
| 422 | Unprocessable Entity | 请求格式正确但内容无法处理 |
| 429 | Too Many Requests | 触发限流 |
| 500 | Internal Server Error | 服务器内部错误 |
| 502 | Bad Gateway | 上游供应商错误 |
| 503 | Service Unavailable | 服务不可用（无可用供应商） |
| 504 | Gateway Timeout | 请求超时 |

---

### 错误分类

系统将错误分为以下类别：

| 类别 | 说明 | 是否重试 |
|-----|------|---------|
| PROVIDER_ERROR | 供应商返回的 HTTP 4xx/5xx 错误 | 视情况 |
| SYSTEM_ERROR | 网络错误、超时等系统级错误 | 是 |
| CLIENT_ABORT | 客户端主动断开连接 | 否 |
| NON_RETRYABLE_CLIENT_ERROR | 不可重试的客户端错误（如参数错误） | 否 |

---

### 常见错误消息

| 错误消息 | 原因 | 解决方案 |
|---------|------|---------|
| `Invalid API key` | API Key 无效 | 检查 Key 是否正确、是否启用 |
| `Rate limit exceeded` | 触发限流 | 等待或调整限流配置 |
| `No available provider found` | 无可用供应商 | 检查供应商状态和熔断器 |
| `Circuit breaker is OPEN` | 熔断器打开 | 等待恢复或检查供应商 |
| `Request timeout` | 请求超时 | 检查网络或调整超时配置 |
| `Sensitive content detected` | 触发敏感词过滤 | 检查请求内容 |
| `User is disabled` | 用户已禁用 | 联系管理员启用 |
| `Key is disabled` | API Key 已禁用 | 启用或创建新 Key |

---

## 获取帮助

### 自助排查清单

在寻求帮助前，请先完成以下检查：

- [ ] 查看应用日志，定位错误信息
- [ ] 确认环境变量配置正确
- [ ] 检查数据库和 Redis 连接状态
- [ ] 验证供应商 API Key 有效性
- [ ] 确认网络连通性

---

### 收集诊断信息

提交问题时，请提供以下信息：

```bash
# 1. 系统版本信息
docker compose exec app cat VERSION 2>/dev/null || echo "VERSION file not found"

# 2. 环境信息
uname -a
docker --version
docker compose version

# 3. 容器状态
docker compose ps

# 4. 最近的错误日志
docker compose logs app --tail=50 2>&1 | grep -i "error"

# 5. 配置信息（隐藏敏感信息）
cat .env | grep -v "TOKEN\|KEY\|PASSWORD\|SECRET"
```

---

### 社区支持

- **GitHub Issues**: [提交问题](https://github.com/ding113/claude-code-hub/issues)
- **Telegram 群组**: [加入讨论](https://t.me/ygxz_group)
- **DeepWiki**: [AI 问答](https://deepwiki.com/ding113/claude-code-hub)

提交 Issue 时请：
1. 搜索是否已有类似问题
2. 使用清晰的标题描述问题
3. 提供复现步骤和诊断信息
4. 标注问题类型（bug/feature/question）

---

### 紧急问题处理

对于影响生产的紧急问题：

1. 尝试重启服务：
```bash
docker compose restart app
```

2. 检查供应商可用性，临时禁用问题供应商

3. 如限流异常，可临时调整或禁用：
```bash
# .env 配置
ENABLE_RATE_LIMIT=false
```

4. 在 Issue 中 @维护者 或在 Telegram 群组说明紧急情况

{% callout type="warning" %}
紧急修改配置后，问题解决后请记得恢复正常配置，并提交 Issue 帮助改进系统。
{% /callout %}
