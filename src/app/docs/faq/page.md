---
dimensions:
  type:
    primary: reference
    detail: troubleshooting
  level: beginner
standard_title: 常见问题
language: zh
---

# 常见问题（FAQ）

本页面汇集了 Claude Code Hub 使用过程中的常见问题及解决方案，涵盖部署、配置、使用、供应商管理、性能优化和安全等方面。如果您遇到的问题未在此列出，欢迎在 [GitHub Issues](https://github.com/ding113/claude-code-hub/issues) 提交反馈。

---

## 部署相关问题

### 数据库连接失败怎么办？

**可能原因：**

1. `DSN` 环境变量格式错误
2. 数据库服务未启动
3. 网络或防火墙问题
4. 凭据不正确

**解决方案：**

1. 确认 `DSN` 格式正确：
   ```bash
   # 标准格式
   DSN="postgres://用户名:密码@主机:端口/数据库名"

   # Docker Compose 示例
   DSN="postgres://postgres:postgres@postgres:5432/claude_code_hub"
   ```

2. 检查数据库服务状态：
   ```bash
   # Docker Compose 部署
   docker compose ps
   docker compose logs postgres

   # 本地 PostgreSQL
   pg_isready -h localhost -p 5432
   ```

3. 测试数据库连接：
   ```bash
   # 进入数据库命令行
   docker compose exec postgres psql -U postgres -d claude_code_hub
   ```

{% callout type="note" title="Docker 网络注意事项" %}
Docker Compose 部署时，应用需使用服务名（如 `postgres`）而非 `localhost` 访问数据库。
{% /callout %}

---

### Redis 离线会影响服务吗？

**影响范围：**

Claude Code Hub 采用 **Fail-Open** 策略，即 Redis 不可用时，系统会自动降级而不是拒绝请求：

| 功能 | Redis 离线时的行为 |
|------|-------------------|
| **限流检查** | 跳过限流，允许所有请求通过 |
| **Session 缓存** | 每次请求重新选择供应商（无粘性） |
| **熔断器状态** | 使用内存缓存（无法跨实例共享） |
| **并发 Session 统计** | 无法准确统计，可能超限 |

**建议措施：**

1. 监控日志中的 Redis Error 告警
2. 确保 Redis 配置持久化以加速恢复
3. 生产环境考虑 Redis Sentinel 或 Cluster 实现高可用

```bash
# 检查 Redis 状态
docker compose logs redis
redis-cli -h localhost -p 6379 ping
```

{% callout type="warning" title="安全提示" %}
Fail-Open 策略确保服务可用性，但可能导致限额被突破。请及时恢复 Redis 服务。
{% /callout %}

---

### 如何升级到新版本？

**Docker Compose 部署：**

```bash
# 拉取最新镜像并重启
docker compose pull
docker compose up -d

# 查看升级日志
docker compose logs -f app
```

**源码部署：**

```bash
git pull origin main
bun install
bun run build
bun run start
```

{% callout type="note" title="自动迁移" %}
默认情况下 `AUTO_MIGRATE=true`，启动时会自动执行数据库迁移。生产环境建议在升级前备份数据库。
{% /callout %}

---

## 配置相关问题

### 环境变量如何配置？

**核心配置说明：**

| 变量 | 必填 | 默认值 | 说明 |
|-----|------|--------|------|
| `ADMIN_TOKEN` | 是 | `change-me` | 后台登录令牌，**必须修改** |
| `DSN` | 是 | - | PostgreSQL 连接串 |
| `REDIS_URL` | 否 | `redis://localhost:6379` | Redis 连接地址 |
| `APP_PORT` | 否 | `23000` | 应用监听端口 |
| `APP_URL` | 否 | 空（自动检测） | 应用访问地址 |
| `ENABLE_RATE_LIMIT` | 否 | `true` | 是否启用限流 |
| `SESSION_TTL` | 否 | `300` | Session 过期时间（秒） |

**限流相关配置：**

| 变量 | 默认值 | 说明 |
|-----|--------|------|
| `ENABLE_RATE_LIMIT` | `true` | 启用后支持 RPM、金额限制、并发 Session 限制 |
| `SESSION_TTL` | `300` | Session 5 分钟内复用同一供应商 |
| `STORE_SESSION_MESSAGES` | `false` | 是否存储请求内容到 Redis |

**熔断器相关配置：**

| 变量 | 默认值 | 说明 |
|-----|--------|------|
| `ENABLE_CIRCUIT_BREAKER_ON_NETWORK_ERRORS` | `false` | 网络错误是否计入熔断器 |
| `ENABLE_SMART_PROBING` | `false` | 启用智能探测以加速熔断恢复 |
| `PROBE_INTERVAL_MS` | `30000` | 探测间隔（毫秒） |
| `PROBE_TIMEOUT_MS` | `5000` | 单次探测超时（毫秒） |

{% callout type="warning" title="布尔值配置" %}
布尔变量请直接写 `true` 或 `false`，不要加引号，否则可能被错误解析。
{% /callout %}

---

### Cookie 无法设置导致登录失败怎么办？

**问题原因：**

`ENABLE_SECURE_COOKIES=true`（默认值）要求 HTTPS 连接才能设置 Cookie。通过 HTTP 远程访问时浏览器会拒绝设置 Secure Cookie。

**解决方案：**

1. **推荐**：配置 HTTPS（Nginx/Caddy 反向代理 + SSL 证书）

2. **内网部署**：如果是纯内网环境，可关闭安全 Cookie：
   ```bash
   ENABLE_SECURE_COOKIES=false
   ```

{% callout type="note" title="localhost 例外" %}
浏览器会自动放行 `localhost` 的 HTTP Cookie，本地开发时无需修改此配置。
{% /callout %}

---

### 如何配置代理访问供应商？

在供应商管理页面为每个供应商单独配置代理：

**支持的代理协议：**

- HTTP 代理：`http://host:port`
- HTTPS 代理：`https://host:port`
- SOCKS5 代理：`socks5://user:pass@host:port`

**配置步骤：**

1. 进入「供应商管理」页面
2. 编辑目标供应商
3. 在「代理设置」填入代理 URL
4. 可选：启用「代理失败时直连」（`proxy_fallback_to_direct`）
5. 使用「测试连接」按钮验证配置

{% callout type="warning" title="代理 URL 格式" %}
代理 URL 必须包含协议前缀（`http://`、`https://`、`socks5://`），否则无法正确解析。
{% /callout %}

---

### 通过 nginx 反向代理访问时 Codex 客户端认证失败怎么办？

**问题描述：**

使用 nginx 反向代理 Claude Code Hub 后，Codex 客户端请求失败，返回 500 错误：

```
Provider xxx returned 500: This API endpoint is only accessible via the official Codex CLI
```

**原因：**

nginx 默认会丢弃 HTTP header 名称中包含下划线的请求头（`underscores_in_headers off`）。某些 Codex 中转站或客户端可能使用带下划线的自定义 header，被 nginx 丢弃后导致认证失败。

**解决方案：**

在 nginx 配置文件的 `http` 或 `server` 块中添加：

```nginx
underscores_in_headers on;
```

完整配置示例参考：[故障排查 - 反向代理问题](/docs/troubleshooting#通过-nginx-反代时-codex-客户端认证失败)

{% callout type="note" title="其他反向代理" %}
Caddy、Traefik 等现代反向代理通常默认允许下划线 header，无需额外配置。
{% /callout %}

---

## 使用相关问题

### 客户端如何接入 Claude Code Hub？

**Claude Code CLI 配置：**

```bash
# 设置 API 端点
export ANTHROPIC_BASE_URL=http://your-cch-server:23000

# 设置 API Key（从 CCH 后台获取）
export ANTHROPIC_API_KEY=cch_your_api_key_here
```

**Codex CLI 配置：**

```bash
# 设置 API 端点
export OPENAI_BASE_URL=http://your-cch-server:23000/v1

# 设置 API Key
export OPENAI_API_KEY=cch_your_api_key_here
```

**API 请求示例：**

```bash
curl -X POST http://your-cch-server:23000/v1/messages \
  -H "Authorization: Bearer cch_your_api_key" \
  -H "Content-Type: application/json" \
  -H "anthropic-version: 2023-06-01" \
  -d '{
    "model": "claude-sonnet-4-20250514",
    "max_tokens": 1024,
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

---

### 新版 Claude Code 安装后仍要求登录怎么办？

**问题描述：**

新版 Claude Code 全新安装后，即使已配置 `~/.claude/settings.json`，首次启动仍要求登录 Anthropic 账号。

**解决方案：**

在 `~/.claude.json` 文件中添加 `hasCompletedOnboarding` 配置：

```json
{
  "hasCompletedOnboarding": true
}
```

**配置位置：**
- macOS/Linux: `~/.claude.json`
- Windows: `C:\Users\你的用户名\.claude.json`

详细说明请参考：[客户端接入 - 跳过首次登录引导](/docs/client-setup#跳过首次登录引导)

{% callout type="note" %}
`~/.claude.json` 是 Claude Code 的全局状态文件，与项目配置文件 `~/.claude/settings.json` 不同。
{% /callout %}

---

### 触发限流后如何处理？

当请求触发限流时，系统返回 HTTP 429 状态码并包含限流原因：

**限流类型及重置机制：**

| 限流类型 | 说明 | 重置机制 |
|---------|------|---------|
| RPM 限流 | 每分钟请求数超限 | 滑动窗口，60 秒后自动恢复 |
| 5 小时消费限流 | 5 小时内消费超限 | 滚动窗口，持续滑动 |
| 每日消费限流 | 24 小时内消费超限 | 支持固定时间或滚动窗口 |
| 周消费限流 | 每周消费超限 | 每周一 00:00 重置 |
| 月消费限流 | 每月消费超限 | 每月 1 日 00:00 重置 |
| 并发 Session | 同时活跃会话数超限 | Session 5 分钟后自动失效 |

**处理建议：**

1. 检查响应中的 `x-rate-limit-*` 头部了解限额详情
2. 等待限额重置或联系管理员调整配额
3. 分散请求时间，避免集中调用

{% callout type="note" title="限额优先级" %}
当用户限额和 API Key 限额同时存在时，系统取两者中更严格的限制。
{% /callout %}

---

### 如何查看我的使用情况？

**管理员视角：**

1. **仪表盘**：查看整体调用量、成本、活跃 Session
2. **排行榜**：按用户统计请求数、Token、成本
3. **日志查询**：筛选特定用户的请求记录
4. **限流监控**：查看限流事件统计和受影响用户

**普通用户：**

目前普通用户无法直接查看自己的使用情况，需联系管理员获取。

---

### 日志清理后排行榜/统计数据为什么消失了？

**原因说明：**

排行榜和消费统计数据是**基于请求日志（message_request 表）实时计算**的，系统不存在独立的统计汇总表。当日志被清理后，用于计算排行榜的原始数据已不存在，因此统计也随之消失。

**建议措施：**

| 场景 | 建议 |
|------|------|
| 日常运维 | 至少保留 30 天日志，确保月排行榜正常工作 |
| 自动清理 | 配置保留天数 ≥ 30 天 |
| 手动清理 | 清理前截图或导出当前排行榜数据 |
| 费用分摊 | 每月初导出上月排行榜数据作为记录 |

{% callout type="warning" title="数据不可恢复" %}
日志清理是物理删除操作，被删除的日志及其对应的统计数据无法恢复。请根据实际需求谨慎配置日志保留策略。
{% /callout %}

---

## 供应商相关问题

### 熔断器持续打开如何排查？

**熔断器状态说明：**

| 状态 | 说明 | 行为 |
|-----|------|------|
| CLOSED | 正常状态 | 请求正常转发 |
| OPEN | 熔断打开 | 请求跳过该供应商 |
| HALF-OPEN | 半开状态 | 允许少量请求测试恢复 |

**默认熔断配置：**

- 失败阈值：连续失败 5 次后触发熔断
- 熔断持续时间：30 分钟
- 恢复阈值：半开状态下成功 2 次后关闭熔断器

**排查步骤：**

1. 查看应用日志中的 `[CircuitBreaker]` 记录：
   ```bash
   docker compose logs app | grep CircuitBreaker
   ```

2. 确认失败原因：
   - 4xx 错误：检查 API Key 是否有效、额度是否充足
   - 5xx 错误：供应商服务异常
   - 网络错误：检查代理配置、DNS 解析

3. 在管理后台检查供应商健康状态

4. 如需手动恢复，可重启应用或等待熔断时间结束

{% callout type="note" title="网络错误配置" %}
默认情况下网络错误不计入熔断器（`ENABLE_CIRCUIT_BREAKER_ON_NETWORK_ERRORS=false`）。如需更激进的熔断策略，可设置为 `true`。
{% /callout %}

---

### 提示「无可用供应商」该怎么办？

**可能原因及解决方案：**

| 原因 | 检查方法 | 解决方案 |
|-----|---------|---------|
| 所有供应商已禁用 | 检查供应商列表的启用状态 | 启用至少一个供应商 |
| 所有供应商熔断 | 查看熔断器状态 | 等待恢复或手动重置 |
| 权重/优先级配置不当 | 检查供应商权重是否为 0 | 设置大于 0 的权重 |
| 用户分组限制 | 检查用户的供应商分组设置 | 调整分组或供应商标签 |
| 并发 Session 超限 | 检查供应商并发限制 | 提高限制或等待 Session 释放 |
| 模型不支持 | 检查供应商的允许模型列表 | 添加模型到白名单或清空限制 |

**查看决策链日志：**

```bash
# 查看请求日志中的 providerChain 字段
# 可以看到每次供应商选择的尝试和失败原因
```

---

### 不同格式的 API 如何转换？

Claude Code Hub 支持多种 API 格式的自动转换：

**支持的转换路径：**

```
Claude Messages API ←→ OpenAI Chat Completions
Claude Messages API ←→ Codex Response API
Claude Messages API ←→ Gemini API
```

**格式对应关系：**

| 客户端格式 | 请求端点 | 供应商类型 |
|-----------|---------|-----------|
| Claude | `/v1/messages` | claude, claude-auth |
| OpenAI | `/v1/chat/completions` | codex, openai-compatible |
| Codex | `/v1/responses` | codex |
| Gemini | `/v1/generateContent` | gemini, gemini-cli |

**自动转换行为：**

- 请求到达时自动检测格式
- 根据目标供应商类型转换请求格式
- 响应返回时转换回客户端期望的格式
- 流式响应保持正确的 SSE 格式

{% callout type="note" title="模型重定向" %}
可在供应商配置中设置模型重定向，将客户端请求的模型名映射到供应商实际支持的模型。
{% /callout %}

---

## 性能相关问题

### 响应延迟较高怎么优化？

**延迟构成分析：**

```
总延迟 = CCH 处理延迟 + 网络延迟 + 供应商响应延迟
         (目标 <50ms)   (取决于网络)  (取决于供应商)
```

**CCH 侧优化：**

1. **确保 Redis 正常运行**：Session 和限流检查依赖 Redis
2. **减少供应商切换**：合理配置权重和优先级
3. **启用 Session 粘性**：`SESSION_TTL` 设置合理值（默认 300 秒）

**网络侧优化：**

1. CCH 部署在靠近用户的位置
2. 供应商选择延迟较低的节点
3. 代理配置使用低延迟线路

**排查工具：**

```bash
# 查看请求日志中的 durationMs 字段
# 分析各环节耗时
```

---

### 连接超时如何配置？

**供应商超时配置：**

在供应商管理页面为每个供应商配置独立的超时参数：

| 参数 | 默认值 | 说明 |
|-----|--------|------|
| `timeoutFirstByte` | 30000ms | 流式响应首字节超时 |
| `timeoutIdle` | 60000ms | 流式响应空闲超时 |
| `timeoutRequest` | 120000ms | 非流式请求总超时 |

**API 测试超时：**

```bash
# 供应商测试连接的超时时间
API_TEST_TIMEOUT_MS=15000  # 默认 15 秒，范围 5000-120000
```

{% callout type="note" title="跨境网络建议" %}
使用跨境网络访问供应商时，建议适当提高超时配置以避免因网络波动导致的请求失败。
{% /callout %}

---

## 安全相关问题

### API Key 如何安全存储？

**CCH 的安全措施：**

1. **哈希存储**：API Key 使用 SHA-256 哈希后存储，数据库中不保存明文
2. **脱敏显示**：管理界面仅显示 Key 的最后 4 位
3. **日志脱敏**：请求日志中不记录完整的 API Key
4. **创建时显示**：Key 仅在创建时完整显示一次，请务必保存

**用户侧建议：**

1. 不要在代码仓库中明文存储 Key
2. 使用环境变量或密钥管理服务
3. 定期轮换 API Key
4. 为不同用途创建不同的 Key

---

### 如何防止敏感内容泄露？

**内置防护：**

1. **敏感词过滤**：在「设置 > 敏感词」配置过滤规则
2. **请求内容不默认存储**：`STORE_SESSION_MESSAGES=false`
3. **日志脱敏**：敏感信息自动脱敏

**配置敏感词过滤：**

1. 进入「设置 > 敏感词管理」
2. 添加需要过滤的词汇或正则表达式
3. 支持精确匹配和正则匹配
4. 匹配的请求将被拒绝并记录

{% callout type="warning" title="合规提示" %}
如需存储请求内容用于审计，请确保符合当地数据保护法规，并告知用户。
{% /callout %}

---

### 管理员令牌丢失怎么办？

**解决方案：**

1. 修改 `.env` 文件中的 `ADMIN_TOKEN` 为新值
2. 重启应用：
   ```bash
   docker compose restart app
   ```
3. 使用新令牌登录后台

{% callout type="warning" title="安全提示" %}
`ADMIN_TOKEN` 是登录后台的唯一凭证，请妥善保管。建议使用高强度随机字符串。
{% /callout %}

---

### 消息推送只支持企业微信吗？

**不是。** 当前版本的 Claude Code Hub 内置多平台推送能力，支持企业微信、飞书、钉钉、Telegram 以及自定义 Webhook（JSON 模板 + 占位符），可按通知类型绑定多个推送目标，实现多平台同时推送。

**平台支持情况：**

| 平台 | 支持方式 |
|------|----------|
| 企业微信 | 内置（群机器人 Webhook） |
| 飞书 | 内置（群机器人 Webhook，交互式卡片） |
| 钉钉 | 内置（群机器人 Webhook，支持签名 Secret） |
| Telegram | 内置（Bot API：Bot Token + Chat ID） |
| 其他平台（Slack/Discord/自建系统等） | 使用「自定义 Webhook」+ 模板适配 |

详细配置请参考：[消息推送](/docs/guide/settings-notifications)

---

## 更多帮助

如果上述内容未能解决您的问题，可通过以下渠道获取帮助：

- **GitHub Issues**：[提交问题](https://github.com/ding113/claude-code-hub/issues)
- **Telegram 交流群**：[加入讨论](https://t.me/ygxz_group)
- **项目文档**：查阅其他文档页面了解更多功能细节

---

## 相关文档

- [系统设置](/docs/guide/settings) - 部署和初始配置指南
- [供应商管理](/docs/guide/settings-providers) - 供应商配置详解
- [限流监控](/docs/guide/rate-limits) - 限流机制说明
- [可用性监控](/docs/guide/availability) - 熔断器和健康状态监控
