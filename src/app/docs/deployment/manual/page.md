---
dimensions:
  type:
    primary: getting-started
    detail: guide
  level: intermediate
standard_title: 手动部署
language: zh
---

# 手动部署

手动部署让你完全控制运行环境，适合有特定基础设施需求或需要自定义部署环境的场景。

## 环境要求

在开始之前，你需要准备以下环境：

- **Bun** 1.3+ 或 Node.js 20+
- **PostgreSQL** 13+
- **Redis** 6+

{% callout type="note" title="提示" %}
如果你还没有安装 Bun，可以通过以下命令安装：

```bash
curl -fsSL https://bun.sh/install | bash
```
{% /callout %}

## 快速开始

### 1. 克隆项目

```bash
git clone https://github.com/ding113/claude-code-hub.git
cd claude-code-hub
```

### 2. 安装依赖

```bash
bun install
```

### 3. 配置环境变量

```bash
cp .env.example .env
```

编辑 `.env` 文件，至少配置以下必需变量：

```bash
# 管理员令牌（必须修改，不能保留默认值）
ADMIN_TOKEN=your-secure-token-here

# PostgreSQL 连接字符串
DSN=postgres://user:password@localhost:5432/claude_code_hub

# Redis 连接地址
REDIS_URL=redis://localhost:6379
```

### 4. 构建应用

```bash
CI=true bun run build
```

{% callout type="note" title="为什么需要 CI=true？" %}
构建时设置 `CI=true` 会跳过数据库初始化检查。这是因为构建阶段不需要真实的数据库连接，DSN 和 REDIS_URL 可以使用占位符值。
{% /callout %}

### 5. 启动应用

```bash
bun run start
```

应用默认监听端口 `23000`。访问 `http://localhost:23000` 即可进入管理后台。

## 必需环境变量

| 变量名 | 说明 | 示例 |
|--------|------|------|
| `ADMIN_TOKEN` | 后台登录令牌，部署前必须修改 | `your-secure-token` |
| `DSN` | PostgreSQL 连接字符串 | `postgres://user:pass@host:5432/db` |
| `REDIS_URL` | Redis 连接地址 | `redis://localhost:6379` |

## 重要可选配置

| 变量名 | 默认值 | 说明 |
|--------|--------|------|
| `AUTO_MIGRATE` | `true` | 启动时自动执行数据库迁移 |
| `PORT` | `23000` | 应用监听端口 |
| `NODE_ENV` | `development` | 运行环境，生产环境设为 `production` |
| `DB_POOL_MAX` | 20 (prod) / 10 (dev) | PostgreSQL 连接池上限 |
| `ENABLE_RATE_LIMIT` | `true` | 是否启用限流功能 |

{% callout type="warning" title="生产环境建议" %}
首次部署后建议将 `AUTO_MIGRATE` 设为 `false`，使用 Drizzle CLI 手动管理迁移，避免意外变更数据库结构。
{% /callout %}

## 数据库管理

### 生成迁移

当你修改了 `src/drizzle/schema.ts` 后，需要生成新的迁移文件：

```bash
bun run db:generate
```

### 手动执行迁移

```bash
bun run db:migrate
```

### 开发环境快速同步

```bash
bun run db:push
```

{% callout type="warning" title="注意" %}
`db:push` 仅适用于开发环境，它会直接修改数据库结构而不生成迁移文件。
{% /callout %}

### 打开 Drizzle Studio

```bash
bun run db:studio
```

## 生产部署

### 使用 systemd 管理服务

创建 `/etc/systemd/system/claude-code-hub.service`：

```ini
[Unit]
Description=Claude Code Hub
After=network.target postgresql.service redis.service

[Service]
Type=simple
User=cch
WorkingDirectory=/opt/claude-code-hub
Environment=NODE_ENV=production
Environment=PORT=23000
Environment=ADMIN_TOKEN=your-secure-token
Environment=DSN=postgres://cch:password@localhost:5432/claude_code_hub
Environment=REDIS_URL=redis://localhost:6379
Environment=AUTO_MIGRATE=false
ExecStart=/usr/bin/bun run start
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

启动服务：

```bash
sudo systemctl enable claude-code-hub
sudo systemctl start claude-code-hub
```

### Nginx 反向代理配置

```nginx
server {
    listen 80;
    server_name your-domain.com;
    
    location / {
        proxy_pass http://localhost:23000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 86400;
    }
}
```

## 升级流程

```bash
# 1. 备份数据库
pg_dump -U postgres claude_code_hub > backup_$(date +%Y%m%d).sql

# 2. 拉取最新代码
git pull origin main

# 3. 安装依赖
bun install

# 4. 构建
CI=true bun run build

# 5. 执行迁移（如果 AUTO_MIGRATE=false）
bun run db:migrate

# 6. 重启服务
sudo systemctl restart claude-code-hub
```

## 故障排查

### 数据库连接失败

应用启动时会重试连接数据库，最多 30 次，每次间隔 2 秒。如果仍然失败，请检查：

- DSN 格式是否正确
- PostgreSQL 服务是否运行
- 网络连接是否正常
- 防火墙是否允许连接

### Redis 不可用

平台采用 Fail-Open 策略：当 Redis 不可用时，限流和 Session 统计会自动降级，但核心代理功能不受影响。建议尽快恢复 Redis 服务。

### 健康检查

应用提供健康检查端点：

```bash
curl http://localhost:23000/api/actions/health
```

可用于负载均衡器的健康检查配置。

## 与 Docker 部署对比

| 特性 | 手动部署 | Docker Compose |
|------|----------|----------------|
| 灵活性 | 高，完全控制环境 | 中，受容器限制 |
| 资源占用 | 低，无容器开销 | 中，有容器开销 |
| 环境一致性 | 需自行保证 | 高，容器隔离 |
| 调试便利性 | 高，直接访问 | 中，需进入容器 |
| 升级复杂度 | 较高 | 低，一键更新 |

选择手动部署的场景：
- 已有成熟的基础设施
- 需要与其他服务深度集成
- 对性能有极致要求
- 团队有运维经验

选择 Docker Compose 的场景：
- 快速部署或测试
- 环境隔离要求高
- 团队运维经验有限
- 需要快速扩缩容

## 下一步

- [配置指南](/docs/configuration) - 了解所有配置选项
- [API 认证指南](/docs/api-compatibility/authentication) - 配置客户端接入
- [供应商管理](/docs/provider-management) - 添加和管理 AI 供应商
