---
dimensions:
  type:
    primary: reference
    detail: guides
  level: beginner
standard_title: 常见问题
language: zh
---

# 常见问题

本页面汇总了 Claude Code Hub 部署和使用过程中的常见问题及解决方案。 {% .lead %}

---

## 安装与部署问题

### Docker 启动失败怎么办？

**症状**：执行 `docker compose up -d` 后容器无法正常启动。

**排查步骤**：

1. 检查 Docker 服务状态：
   ```bash
   docker info
   docker compose ps
   ```

2. 查看容器日志定位错误：
   ```bash
   docker compose logs -f app
   ```

3. 常见原因及解决方案：

| 错误类型 | 可能原因 | 解决方案 |
| --- | --- | --- |
| 端口冲突 | 23000 端口已被占用 | 修改 `docker-compose.yml` 中的端口映射 |
| 镜像拉取失败 | 网络问题或镜像仓库不可达 | 配置 Docker 镜像加速器或使用代理 |
| 资源不足 | 内存或磁盘空间不足 | 清理无用容器和镜像，释放资源 |
| 权限问题 | 数据卷权限不正确 | 检查并修正挂载目录的权限 |

{% callout type="note" title="Docker 资源清理" %}
使用以下命令清理无用的 Docker 资源：
```bash
docker system prune -a
```
{% /callout %}

---

### 数据库连接失败如何排查？

**症状**：应用启动时报告数据库连接错误。

**排查步骤**：

1. **确认 DSN 格式正确**
   ```bash
   # Docker Compose 场景下应使用服务名
   DSN=postgres://postgres:postgres@postgres:5432/claude_code_hub

   # 本地开发应使用 localhost
   DSN=postgres://postgres:postgres@localhost:5432/claude_code_hub
   ```

2. **检查数据库容器状态**
   ```bash
   docker compose ps postgres
   docker compose logs postgres
   ```

3. **测试数据库连接**
   ```bash
   # 进入数据库命令行
   docker compose exec postgres psql -U postgres -d claude_code_hub

   # 或使用 dev 目录的 Makefile
   cd dev && make db-shell
   ```

4. **常见错误及解决方案**

| 错误信息 | 原因 | 解决方案 |
| --- | --- | --- |
| `connection refused` | 数据库未启动 | 等待数据库容器完全启动 |
| `authentication failed` | 用户名或密码错误 | 检查 DSN 中的凭据 |
| `database does not exist` | 数据库未创建 | 启用 `AUTO_MIGRATE=true` 或手动创建 |

{% callout type="warning" title="Docker 网络" %}
在 Docker Compose 环境中，服务间通信应使用服务名（如 `postgres`）而非 `localhost`。
{% /callout %}

---

### Redis 连接问题解决

**症状**：日志中出现 Redis 连接错误，但服务仍在运行。

**说明**：Claude Code Hub 采用 **Fail-Open** 策略，Redis 不可用时服务会自动降级：

- 限流功能暂时失效（所有请求放行）
- Session 缓存失效（每次请求重新选择供应商）
- 统计数据可能不准确

**排查步骤**：

1. **检查 Redis 容器状态**
   ```bash
   docker compose ps redis
   docker compose logs redis
   ```

2. **测试 Redis 连接**
   ```bash
   docker compose exec redis redis-cli ping
   # 应返回 PONG
   ```

3. **检查 REDIS_URL 配置**
   ```bash
   # Docker Compose 场景
   REDIS_URL=redis://redis:6379

   # 支持 TLS 连接
   REDIS_URL=rediss://redis:6379
   ```

{% callout type="note" title="Redis 降级影响" %}
Redis 离线时建议尽快恢复，以避免：
- 限流失效导致的请求过载
- Session 频繁切换导致的上下文丢失
- 统计数据不准确
{% /callout %}

---

## 使用问题

### API Key 如何获取？

**获取步骤**：

1. 登录管理后台 (`http://localhost:23000`)
2. 进入 **用户管理** 页面
3. 创建新用户或编辑现有用户
4. 在用户详情中查看或生成 API Key

**API Key 格式**：
```
cch-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

**使用方式**：
```bash
# 设置为环境变量
export ANTHROPIC_API_KEY=cch-your-api-key

# 或在请求头中携带
curl -H "x-api-key: cch-your-api-key" ...
```

{% callout type="warning" title="安全提示" %}
API Key 是访问凭证，请妥善保管，不要泄露或提交到代码仓库。
{% /callout %}

---

### 为什么请求被限流？

**限流类型**：

Claude Code Hub 支持多维度限流：

| 限流维度 | 说明 | 默认值 |
| --- | --- | --- |
| RPM | 每分钟请求次数 | 用户配置 |
| 5小时金额 | 5小时内消费上限 | 用户配置 |
| 周金额 | 每周消费上限 | 用户配置 |
| 月金额 | 每月消费上限 | 用户配置 |
| 并发 Session | 同时活跃的会话数 | 用户配置 |

**排查方法**：

1. **查看用户限额配置**
   - 登录管理后台
   - 进入用户管理页面
   - 检查目标用户的限流设置

2. **查看当前使用量**
   - 进入仪表盘查看实时统计
   - 查看排行榜了解用户消耗

3. **查看请求日志**
   - 日志页面会显示被限流的请求
   - 检查 HTTP 状态码 429

**解决方案**：
- 调整用户限额配置
- 等待限流窗口重置
- 优化请求频率

---

### Session 绑定失败怎么办？

**症状**：请求时报告 Session 相关错误，或频繁切换供应商。

**排查步骤**：

1. **检查 Redis 状态**
   - Session 数据存储在 Redis 中
   - 参考上文 Redis 连接问题解决

2. **检查并发限制**
   - 用户可能已达到并发 Session 上限
   - 在用户管理中调整并发限制

3. **检查 Session TTL 配置**
   ```bash
   # Session 缓存时间（秒），默认 300
   SESSION_TTL=300
   ```

4. **查看决策链日志**
   - 在日志页面查看请求的决策链
   - 确认 Session 分配是否正常

---

## 供应商相关

### 如何添加新供应商？

**添加步骤**：

1. 登录管理后台
2. 进入 **供应商管理** 页面
3. 点击 **添加供应商** 按钮
4. 填写供应商信息：

| 字段 | 说明 | 示例 |
| --- | --- | --- |
| 名称 | 供应商标识名称 | `claude-primary` |
| 类型 | API 类型 | Claude / OpenAI / Gemini |
| API Key | 供应商的 API 密钥 | `sk-xxx...` |
| Base URL | API 基础地址 | `https://api.anthropic.com` |
| 权重 | 负载均衡权重 | `100` |
| 优先级 | 选择优先级（数值越小越优先） | `1` |

5. 点击 **测试连接** 验证配置
6. 保存供应商

{% callout type="note" title="模型重定向" %}
可以配置模型重定向，将请求的模型名映射到供应商实际支持的模型。
{% /callout %}

---

### 供应商认证失败如何处理？

**常见原因**：

| 错误类型 | 可能原因 | 解决方案 |
| --- | --- | --- |
| `401 Unauthorized` | API Key 无效或过期 | 更新 API Key |
| `403 Forbidden` | 账户权限不足 | 检查供应商账户状态 |
| `Network Error` | 网络不通或被防火墙拦截 | 配置代理或检查网络 |

**排查步骤**：

1. **使用测试连接功能**
   - 在供应商管理页面点击"测试连接"
   - 查看详细错误信息

2. **检查代理配置**
   - 如需代理访问，确认代理 URL 格式正确
   - 支持 `http://`、`https://`、`socks5://` 协议

3. **查看请求日志**
   - 在日志页面筛选该供应商的请求
   - 查看具体错误响应

---

### 熔断后如何恢复？

**熔断机制说明**：

当供应商连续出现错误时，熔断器会自动打开，暂时停止向该供应商发送请求。

**熔断状态**：

| 状态 | 说明 | 行为 |
| --- | --- | --- |
| CLOSED | 正常状态 | 正常转发请求 |
| OPEN | 熔断打开 | 拒绝请求，等待恢复 |
| HALF-OPEN | 半开状态 | 允许少量探测请求 |

**恢复方式**：

1. **自动恢复**
   - 熔断器默认 30 分钟后自动尝试恢复
   - 启用智能探测时会更快恢复

2. **手动恢复**
   - 重启应用服务会重置熔断状态
   - 在供应商管理中重新启用供应商

3. **排查根本原因**
   - 查看日志中的 `[CircuitBreaker]` 记录
   - 确认错误类型（4xx/5xx/网络错误）
   - 修复供应商配置或等待供应商恢复

{% callout type="note" title="网络错误熔断" %}
默认情况下网络错误不计入熔断器。如需更激进的熔断策略，可设置：
```bash
ENABLE_CIRCUIT_BREAKER_ON_NETWORK_ERRORS=true
```
{% /callout %}

---

## 性能优化

### 如何提高缓存命中率？

**Session 缓存优化**：

1. **调整 Session TTL**
   ```bash
   # 增加缓存时间以提高复用率
   SESSION_TTL=600  # 10分钟
   ```

2. **优化并发配置**
   - 适当限制并发 Session 数
   - 避免过多 Session 分散请求

**Redis 缓存优化**：

1. **确保 Redis 稳定运行**
   - 监控 Redis 内存使用
   - 配置适当的内存淘汰策略

2. **网络优化**
   - Redis 与应用部署在同一网络
   - 减少网络延迟

---

### 响应延迟高怎么优化？

**排查方向**：

1. **供应商延迟**
   - 查看日志中的响应时间
   - 考虑配置就近的供应商或代理

2. **数据库查询**
   - 检查 PostgreSQL 性能
   - 确保索引正确创建

3. **Redis 延迟**
   - 检查 Redis 响应时间
   - 确保 Redis 部署在低延迟网络

4. **网络优化**
   - 配置合适的代理
   - 优化网络路由

**优化建议**：

| 场景 | 优化方案 |
| --- | --- |
| 供应商响应慢 | 配置多供应商负载均衡 |
| 首次请求慢 | 预热 Session 缓存 |
| 跨境访问慢 | 使用代理或边缘节点 |

---

### 数据库查询慢如何解决？

**排查步骤**：

1. **检查数据库状态**
   ```bash
   docker compose exec postgres psql -U postgres -d claude_code_hub -c "SELECT * FROM pg_stat_activity;"
   ```

2. **查看慢查询**
   - 启用 PostgreSQL 慢查询日志
   - 分析查询计划

3. **常见优化**：

| 问题 | 解决方案 |
| --- | --- |
| 日志表过大 | 定期清理历史日志 |
| 索引缺失 | 检查并创建必要索引 |
| 连接数过多 | 配置连接池大小 |

{% callout type="note" title="数据维护" %}
建议定期清理超过 30 天的日志数据，保持数据库性能。
{% /callout %}

---

## 安全建议

### API Key 安全存储

**最佳实践**：

1. **环境变量方式**
   ```bash
   # 不要硬编码在代码中
   export ANTHROPIC_API_KEY=cch-your-api-key
   ```

2. **配置文件权限**
   ```bash
   # 限制 .env 文件权限
   chmod 600 .env
   ```

3. **不要泄露的位置**：
   - 代码仓库（添加到 .gitignore）
   - 日志文件
   - 错误信息
   - 客户端代码

{% callout type="warning" title="泄露处理" %}
如果 API Key 泄露，请立即：
1. 在管理后台禁用或删除该用户
2. 生成新的 API Key
3. 更新所有客户端配置
{% /callout %}

---

### 网络隔离建议

**部署建议**：

1. **内网部署**
   - 将管理后台部署在内网
   - 仅暴露 API 端点到公网

2. **防火墙配置**
   ```bash
   # 仅允许特定 IP 访问管理端口
   # 示例：仅允许内网访问 23000 端口
   ```

3. **反向代理**
   - 使用 Nginx/Caddy 做反向代理
   - 配置 HTTPS 加密传输
   - 启用访问日志和限流

4. **Docker 网络**
   ```yaml
   # docker-compose.yml
   networks:
     internal:
       internal: true  # 内部网络，不暴露到宿主机
   ```

---

### 日志敏感信息处理

**默认行为**：

Claude Code Hub 会自动脱敏以下信息：
- API Key 显示为部分掩码
- 请求内容不记录完整 body

**建议配置**：

1. **生产环境日志级别**
   - 避免使用 DEBUG 级别
   - 减少敏感信息输出

2. **日志存储**
   - 定期清理过期日志
   - 限制日志访问权限

3. **审计需求**
   - 如需完整审计，单独配置审计日志
   - 加密存储审计数据

---

## 获取帮助

如果以上内容未能解决你的问题，可以通过以下方式获取帮助：

1. **Telegram 交流群**：[https://t.me/ygxz_group](https://t.me/ygxz_group)
2. **GitHub Issues**：[提交问题](https://github.com/ding113/claude-code-hub/issues)
3. **GitHub Discussions**：[参与讨论](https://github.com/ding113/claude-code-hub/discussions)
