---
dimensions:
  type:
    primary: getting-started
    detail: deployment
  level: intermediate
standard_title: 手动部署
language: zh
---

# 手动部署

本文档介绍如何通过 `bun build + start` 方式手动部署 Claude Code Hub。这种部署方式适合需要更灵活控制的场景，如自定义进程管理、与现有基础设施集成等。

{% callout type="note" title="适用场景" %}
手动部署适合以下情况：
- 需要使用 PM2、systemd 等进程管理工具
- 希望与现有的 PostgreSQL/Redis 实例集成
- 需要自定义构建流程
- 不便使用 Docker 的环境
{% /callout %}

## 环境要求

在开始之前，请确保满足以下环境要求：

| 组件 | 最低版本 | 说明 |
|------|---------|------|
| Node.js | >= 20 | 运行时环境 |
| Bun | >= 1.3 | 包管理器和运行时 |
| PostgreSQL | >= 14 | 数据存储 |
| Redis | >= 7 | 缓存和会话管理 |

### 检查环境

```bash
# 检查 Node.js 版本
node --version
# 输出示例: v20.x.x 或更高

# 检查 Bun 版本
bun --version
# 输出示例: 1.3.x 或更高
```

如果尚未安装 Bun，可通过以下命令安装：

```bash
# macOS / Linux
curl -fsSL https://bun.sh/install | bash

# Windows (PowerShell)
powershell -c "irm bun.sh/install.ps1 | iex"
```

## 安装依赖并构建

### 1. 克隆项目

```bash
git clone https://github.com/ding113/claude-code-hub.git
cd claude-code-hub
```

### 2. 安装依赖

```bash
bun install
```

### 3. 构建生产版本

```bash
bun run build
```

{% callout type="note" title="构建说明" %}
`bun run build` 命令会执行以下操作：
1. 运行 `next build` 构建 Next.js 应用
2. 自动将 `VERSION` 文件复制到 `.next/standalone/VERSION`

构建产物位于 `.next/standalone` 目录。
{% /callout %}

## 环境变量配置

### 创建配置文件

```bash
cp .env.example .env
```

### 必须配置的变量

以下变量**必须**在生产环境中配置：

```bash
# 管理员令牌（必须修改！）
ADMIN_TOKEN=your-secure-token-here

# 数据库连接字符串
DSN="postgres://user:password@host:5432/claude_code_hub"

# Redis 连接地址
REDIS_URL=redis://localhost:6379
```

{% callout type="warning" title="安全提示" %}
- `ADMIN_TOKEN` 是后台登录的唯一凭证，请使用强随机字符串
- 数据库密码请使用复杂密码
- 生产环境中请勿使用默认值
{% /callout %}

### 常用配置项

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `APP_PORT` | `23000` | 应用监听端口 |
| `APP_URL` | 空 | 应用访问地址，用于 OpenAPI 文档 |
| `AUTO_MIGRATE` | `true` | 启动时自动执行数据库迁移 |
| `ENABLE_RATE_LIMIT` | `true` | 是否启用限流功能 |
| `ENABLE_SECURE_COOKIES` | `true` | 是否强制 HTTPS Cookie |
| `SESSION_TTL` | `300` | Session 过期时间（秒） |

### HTTP 访问配置

如果通过 HTTP（非 localhost）访问，需要禁用安全 Cookie：

```bash
ENABLE_SECURE_COOKIES=false
```

{% callout type="warning" title="注意" %}
禁用安全 Cookie 会降低安全性，仅推荐用于内网部署。生产环境建议使用 HTTPS。
{% /callout %}

## 启动生产服务器

### 直接启动

```bash
bun run start
```

服务默认监听 3000 端口。可通过 `PORT` 环境变量修改：

```bash
PORT=23000 bun run start
```

### 使用 PM2 管理

推荐使用 PM2 进行进程管理，支持守护进程、自动重启、日志管理等功能。

#### 安装 PM2

```bash
npm install -g pm2
```

#### 创建 PM2 配置文件

在项目根目录创建 `ecosystem.config.js`：

```javascript
module.exports = {
  apps: [
    {
      name: 'claude-code-hub',
      script: 'server.js',
      cwd: '/path/to/claude-code-hub/.next/standalone',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        PORT: 23000,
        ADMIN_TOKEN: 'your-secure-token-here',
        DSN: 'postgres://user:password@localhost:5432/claude_code_hub',
        REDIS_URL: 'redis://localhost:6379',
        AUTO_MIGRATE: 'true',
        ENABLE_RATE_LIMIT: 'true',
        ENABLE_SECURE_COOKIES: 'true',
      },
      error_file: '/path/to/claude-code-hub/logs/error.log',
      out_file: '/path/to/claude-code-hub/logs/out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      max_memory_restart: '1G',
      restart_delay: 3000,
    },
  ],
};
```

{% callout type="note" title="路径说明" %}
请将 `/path/to/claude-code-hub` 替换为实际的项目路径。
{% /callout %}

#### PM2 常用命令

```bash
# 启动应用
pm2 start ecosystem.config.js

# 查看状态
pm2 status

# 查看日志
pm2 logs claude-code-hub

# 重启应用
pm2 restart claude-code-hub

# 停止应用
pm2 stop claude-code-hub

# 设置开机自启
pm2 startup
pm2 save
```

### 使用 systemd 管理

对于 Linux 系统，也可使用 systemd 管理服务。

创建 `/etc/systemd/system/claude-code-hub.service`：

```ini
[Unit]
Description=Claude Code Hub
After=network.target postgresql.service redis.service

[Service]
Type=simple
User=www-data
WorkingDirectory=/path/to/claude-code-hub/.next/standalone
ExecStart=/usr/bin/node server.js
Restart=on-failure
RestartSec=10
EnvironmentFile=/path/to/claude-code-hub/.env

[Install]
WantedBy=multi-user.target
```

```bash
# 重载配置
sudo systemctl daemon-reload

# 启动服务
sudo systemctl start claude-code-hub

# 设置开机自启
sudo systemctl enable claude-code-hub

# 查看状态
sudo systemctl status claude-code-hub
```

## 数据库迁移

### 自动迁移

首次运行时，建议开启自动迁移：

```bash
AUTO_MIGRATE=true bun run start
```

应用启动时会自动执行 Drizzle 迁移脚本。

### 手动迁移

生产环境稳定后，建议关闭自动迁移，改为手动控制：

```bash
# 关闭自动迁移
AUTO_MIGRATE=false

# 手动执行迁移
bun run db:migrate
```

### 迁移相关命令

```bash
# 生成迁移文件
bun run db:generate

# 执行迁移
bun run db:migrate

# 直接推送 Schema（开发环境）
bun run db:push

# 打开 Drizzle Studio
bun run db:studio
```

## 本地开发模式

项目提供了便捷的本地开发工具，位于 `dev/` 目录。

### 使用 Makefile

```bash
cd dev

# 查看所有可用命令
make help

# 启动完整开发环境（PostgreSQL + Redis + bun dev）
make dev

# 仅启动数据库和 Redis
make db

# 仅启动应用（假设数据库已运行）
make app

# 查看服务状态
make status

# 查看日志
make logs

# 清理环境
make clean

# 完全重置
make reset
```

### 开发环境配置

开发环境使用 `dev/.env.dev` 配置文件，包含以下默认配置：

| 配置项 | 默认值 | 说明 |
|--------|--------|------|
| `PORT` | `13500` | 开发服务器端口 |
| `ADMIN_TOKEN` | `dev-admin-token` | 开发环境管理员令牌 |
| `DSN` | `postgresql://postgres:dev_password_123@localhost:5433/claude_relay_dev` | 开发数据库 |
| `REDIS_URL` | `redis://localhost:6380` | 开发 Redis |

### 开发环境端口

| 服务 | 端口 |
|------|------|
| 应用 | 13500 |
| PostgreSQL | 5433 |
| Redis | 6380 |

## 验证部署

### 检查服务状态

```bash
# 检查应用是否运行
curl http://localhost:23000/api/health
```

### 访问管理后台

打开浏览器访问：

```
http://localhost:23000
```

使用配置的 `ADMIN_TOKEN` 登录。

### 访问 API 文档

- Scalar UI: `http://localhost:23000/api/actions/scalar`
- Swagger UI: `http://localhost:23000/api/actions/docs`

## 常见问题

### 数据库连接失败

1. 检查 `DSN` 格式是否正确
2. 确认 PostgreSQL 服务已启动
3. 验证用户名密码和数据库名称

```bash
# 测试数据库连接
psql "postgres://user:password@host:5432/claude_code_hub"
```

### Redis 连接失败

1. 检查 `REDIS_URL` 格式
2. 确认 Redis 服务已启动

```bash
# 测试 Redis 连接
redis-cli -u redis://localhost:6379 ping
```

{% callout type="note" title="Fail-Open 策略" %}
Redis 不可用时，系统会自动降级运行。限流和会话统计功能将暂时失效，但不影响核心代理功能。
{% /callout %}

### 端口被占用

```bash
# 检查端口占用
lsof -i :23000

# 使用其他端口
PORT=3001 bun run start
```

## 下一步

- [配置参考](/docs/reference/env-variables) - 了解所有可配置项
- [供应商管理](/docs/guide/settings-providers) - 添加和配置 AI 供应商
- [用户管理](/docs/guide/users) - 创建用户和 API Key
