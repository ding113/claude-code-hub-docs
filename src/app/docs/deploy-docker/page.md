---
dimensions:
  type:
    primary: getting-started
    detail: deployment
  level: beginner
standard_title: Docker Compose 部署
language: zh
---

# Docker Compose 部署

Docker Compose 是部署 Claude Code Hub 的**推荐方式**，它会自动配置数据库、Redis 和应用服务，无需手动安装依赖，适合生产环境快速部署。

---

## 环境要求

在开始之前，请确保你的系统满足以下要求：

| 组件 | 最低版本 | 推荐版本 |
| --- | --- | --- |
| Docker | 20.10+ | 最新稳定版 |
| Docker Compose | v2.0+ | 最新稳定版 |

{% callout type="note" title="验证安装" %}
运行以下命令验证 Docker 和 Docker Compose 是否已正确安装：

```bash
docker --version
docker compose version
```
{% /callout %}

---

## 三步启动

### 步骤 1：克隆项目并配置环境

```bash
git clone https://github.com/ding113/claude-code-hub.git
cd claude-code-hub
cp .env.example .env
```

### 步骤 2：修改配置文件

编辑 `.env` 文件，**必须修改** `ADMIN_TOKEN`（后台登录令牌）：

```bash
# 必须修改此项！这是登录管理后台的唯一凭证
ADMIN_TOKEN=your-secure-token-here

# 数据库密码（建议修改为安全密码）
DB_PASSWORD=your-secure-password-here
```

{% callout type="warning" title="安全提醒" %}
- `ADMIN_TOKEN` 是登录管理后台的唯一凭证，请设置为复杂的随机字符串
- `DB_PASSWORD` 用于数据库认证，生产环境请务必修改默认值
- 请妥善保管这些凭证，不要提交到版本控制系统
{% /callout %}

### 步骤 3：启动服务

```bash
docker compose up -d
```

首次启动会自动拉取镜像并初始化数据库，可能需要几分钟时间。

---

## 查看状态和日志

### 查看服务状态

```bash
docker compose ps
```

正常运行时，你应该看到三个服务都处于 `running` 状态：

```
NAME                    STATUS                   PORTS
claude-code-hub-app     Up (healthy)             0.0.0.0:23000->3000/tcp
claude-code-hub-db      Up (healthy)
claude-code-hub-redis   Up (healthy)
```

### 查看应用日志

```bash
# 实时查看应用日志
docker compose logs -f app

# 查看最近 100 行日志
docker compose logs --tail 100 app

# 查看所有服务的日志
docker compose logs -f
```

---

## 访问应用

启动成功后，可以通过以下地址访问：

| 服务 | 地址 | 说明 |
| --- | --- | --- |
| 管理后台 | `http://localhost:23000` | 使用 `ADMIN_TOKEN` 登录 |
| API 文档 (Scalar) | `http://localhost:23000/api/actions/scalar` | 交互式 API 文档 |
| API 文档 (Swagger) | `http://localhost:23000/api/actions/docs` | Swagger UI |

{% callout type="note" title="远程访问" %}
如果需要从其他机器访问，请将 `localhost` 替换为服务器的 IP 地址或域名。

如果使用 HTTP 远程访问（非 localhost），需要在 `.env` 中设置：
```bash
ENABLE_SECURE_COOKIES=false
```
{% /callout %}

---

## 配置反向代理（可选）

生产环境建议使用 HTTPS 反向代理（nginx/Caddy）来提供 SSL 加密和域名访问。

### Nginx 配置示例

创建 nginx 配置文件：

```nginx
server {
    listen 443 ssl http2;
    server_name your-cch-domain.com;

    # SSL 证书配置
    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    # SSL 优化配置
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;

    # 重要：允许带下划线的 HTTP header（Codex 客户端需要）
    underscores_in_headers on;

    location / {
        proxy_pass http://127.0.0.1:23000;
        proxy_http_version 1.1;

        # 标准代理头
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # SSE 流式响应支持
        proxy_set_header Connection '';
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 300s;
        chunked_transfer_encoding on;
    }
}

# HTTP 自动跳转 HTTPS
server {
    listen 80;
    server_name your-cch-domain.com;
    return 301 https://$server_name$request_uri;
}
```

### Caddy 配置示例

Caddy 自动处理 HTTPS 证书，配置更简单：

```caddyfile
your-cch-domain.com {
    reverse_proxy localhost:23000
}
```

{% callout type="note" title="Caddy 自动配置" %}
Caddy 会自动处理 SSL 证书申请、续期和 HTTP header 转发，无需额外配置 `underscores_in_headers`。
{% /callout %}

### 验证配置

配置反向代理后，测试访问：

```bash
# 测试 HTTPS 访问
curl -I https://your-cch-domain.com

# 测试 API 端点
curl https://your-cch-domain.com/api/health
```

配置完成后，记得修改 `.env` 文件确保 Secure Cookie 启用：

```bash
ENABLE_SECURE_COOKIES=true
```

---

## 配置说明

### 关键环境变量

以下是 Docker Compose 部署时最重要的配置项：

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `ADMIN_TOKEN` | `change-me` | 管理后台登录令牌，**必须修改** |
| `DB_USER` | `postgres` | 数据库用户名 |
| `DB_PASSWORD` | `your-secure-password_change-me` | 数据库密码，**建议修改** |
| `DB_NAME` | `claude_code_hub` | 数据库名称 |
| `APP_PORT` | `23000` | 应用对外暴露的端口 |
| `AUTO_MIGRATE` | `true` | 启动时自动执行数据库迁移 |

### 其他常用配置

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `ENABLE_RATE_LIMIT` | `true` | 启用限流功能 |
| `SESSION_TTL` | `300` | Session 过期时间（秒） |
| `ENABLE_SECURE_COOKIES` | `true` | 强制 HTTPS Cookie |
| `API_TEST_TIMEOUT_MS` | `15000` | API 测试超时时间（毫秒） |

{% callout type="note" title="完整配置" %}
查看 `.env.example` 文件获取所有可配置项的详细说明。
{% /callout %}

---

## 使用远程数据库

默认情况下，Docker Compose 会启动一个本地 PostgreSQL 容器。如果您希望使用已有的远程数据库（如云数据库服务），可以通过配置 `DSN` 环境变量来实现。

### DSN 连接字符串格式

DSN（Data Source Name）是 PostgreSQL 的标准连接字符串格式：

```
postgres://用户名:密码@主机:端口/数据库名?参数=值
```

或

```
postgresql://用户名:密码@主机:端口/数据库名?参数=值
```

{% callout type="note" title="两种协议前缀等效" %}
`postgres://` 和 `postgresql://` 在功能上完全等效，可以互换使用。
{% /callout %}

### 配置步骤

#### 1. 修改 .env 文件

在 `.env` 文件中直接设置 `DSN` 环境变量：

```bash
# 使用远程数据库时，直接指定完整的 DSN
DSN=postgres://myuser:mypassword@db.example.com:5432/claude_code_hub

# DB_USER、DB_PASSWORD、DB_NAME 仅用于本地 PostgreSQL 容器
# 使用远程数据库时可以忽略这些配置
```

{% callout type="note" title="环境变量优先级" %}
`.env` 文件中的 `DSN` 变量会覆盖 `docker-compose.yaml` 中由 `DB_USER`、`DB_PASSWORD`、`DB_NAME` 构建的默认 DSN。
{% /callout %}

#### 2. 移除本地数据库服务（可选）

如果不需要本地 PostgreSQL 容器，可以修改启动命令只启动应用和 Redis：

```bash
# 仅启动 app 和 redis 服务
docker compose up -d app redis
```

或者创建一个 `docker-compose.override.yml` 文件来禁用 postgres 服务：

```yaml
services:
  postgres:
    profiles:
      - disabled
```

### SSL/TLS 连接

大多数云数据库服务要求使用 SSL 加密连接。在 DSN 中添加 `sslmode` 参数：

```bash
# 启用 SSL 连接
DSN=postgres://user:pass@host:5432/db?sslmode=require
```

**常用 sslmode 值：**

| 值 | 说明 |
|---|---|
| `disable` | 禁用 SSL（不推荐） |
| `require` | 要求 SSL 连接，不验证证书 |
| `verify-ca` | 验证服务器证书由可信 CA 签发 |
| `verify-full` | 验证证书且检查主机名匹配 |

{% callout type="warning" title="生产环境安全建议" %}
生产环境建议使用 `sslmode=require` 或更高级别，确保数据传输加密。部分云服务（如 Supabase、Neon）默认强制 SSL。
{% /callout %}

### 云数据库配置示例

#### Supabase

```bash
# 在 Supabase 控制台 → Settings → Database → Connection string 获取
DSN=postgres://postgres.[project-ref]:[password]@aws-0-[region].pooler.supabase.com:6543/postgres
```

{% callout type="note" title="Supabase 连接模式" %}
Supabase 提供两种连接模式：
- **Session mode (端口 5432)**：适用于长连接场景
- **Transaction mode (端口 6543)**：适用于 Serverless 场景，推荐用于 Claude Code Hub
{% /callout %}

#### Neon

```bash
# 在 Neon 控制台 → Connection Details 获取
DSN=postgres://[user]:[password]@[endpoint].neon.tech/[database]?sslmode=require
```

#### Railway

```bash
# 在 Railway 项目 → PostgreSQL 服务 → Connect 获取
DSN=postgres://postgres:[password]@[host].railway.app:5432/railway
```

#### 阿里云 RDS

```bash
# 内网访问
DSN=postgres://user:password@rm-xxx.pg.rds.aliyuncs.com:5432/claude_code_hub

# 公网访问（需开启公网地址）
DSN=postgres://user:password@pgm-xxx.pg.rds.aliyuncs.com:5432/claude_code_hub?sslmode=require
```

#### 自建 PostgreSQL

```bash
# 局域网内其他服务器
DSN=postgres://user:password@192.168.1.100:5432/claude_code_hub

# 通过 SSH 隧道访问（需先建立隧道）
# ssh -L 15432:localhost:5432 user@remote-server
DSN=postgres://user:password@localhost:15432/claude_code_hub
```

### 验证数据库连接

启动服务后，可以通过以下方式验证数据库连接是否成功：

```bash
# 查看应用日志
docker compose logs app | grep -i "database\|migration"

# 成功连接时会显示：
# Database connection established
# ✅ Database migrations completed successfully!
```

如果连接失败，日志会显示详细的错误信息，常见问题包括：

| 错误类型 | 可能原因 | 解决方案 |
|---------|---------|---------|
| `connection refused` | 防火墙阻止、数据库未启动 | 检查防火墙规则和数据库状态 |
| `authentication failed` | 用户名或密码错误 | 核对数据库凭据 |
| `SSL required` | 数据库要求 SSL 连接 | 在 DSN 中添加 `?sslmode=require` |
| `database does not exist` | 数据库未创建 | 手动创建数据库 |

### 数据库初始化

使用远程数据库时，首次启动会自动执行数据库迁移（`AUTO_MIGRATE=true` 时）。确保：

1. **数据库已创建**：应用不会自动创建数据库，需手动创建
2. **用户有足够权限**：需要 `CREATE TABLE`、`ALTER TABLE` 等权限
3. **网络可达**：确保 Docker 容器能访问远程数据库地址

```bash
# 手动创建数据库（如果不存在）
psql -h db.example.com -U postgres -c "CREATE DATABASE claude_code_hub;"
```

{% callout type="note" title="数据库迁移" %}
自动迁移会在应用启动时检查并应用所有待执行的 schema 变更。生产环境首次部署后，建议设置 `AUTO_MIGRATE=false` 并手动控制迁移时机。
{% /callout %}

---

## 修改端口

如果默认端口 `23000` 已被占用，可以在 `.env` 文件中修改：

```bash
APP_PORT=8080
```

然后重启服务：

```bash
docker compose down
docker compose up -d
```

---

## 升级版本

当有新版本发布时，按以下步骤升级：

```bash
# 拉取最新镜像
docker compose pull

# 重启服务（自动使用新镜像）
docker compose up -d
```

{% callout type="note" title="数据安全" %}
升级过程会自动保留数据库数据，无需手动备份。但建议在重要升级前手动备份数据。
{% /callout %}

---

## 停止和清理

### 停止服务

```bash
# 停止所有服务（保留数据）
docker compose down
```

### 数据存储位置

Docker Compose 配置将数据持久化到本地目录：

| 数据 | 存储位置 |
| --- | --- |
| PostgreSQL 数据 | `./data/postgres/` |
| Redis 数据 | `./data/redis/` |

{% callout type="warning" title="删除数据" %}
如需完全删除所有数据，请手动删除 `./data/` 目录：
```bash
docker compose down
rm -rf ./data
```
{% /callout %}

---

## 服务架构

Docker Compose 部署包含三个服务：

```
┌─────────────────────────────────────────────────────────────┐
│                      Docker Compose                          │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐         │
│  │    app      │  │  postgres   │  │   redis     │         │
│  │  (Next.js)  │──│ (数据库)    │  │  (缓存)     │         │
│  │  :23000     │  │  :35432     │  │             │         │
│  └─────────────┘  └─────────────┘  └─────────────┘         │
└─────────────────────────────────────────────────────────────┘
```

| 服务 | 镜像 | 端口映射 | 说明 |
| --- | --- | --- | --- |
| `app` | `ghcr.io/ding113/claude-code-hub:latest` | `23000:3000` | 应用主服务 |
| `postgres` | `postgres:18` | 无（仅内部网络） | PostgreSQL 数据库 |
| `redis` | `redis:7-alpine` | 无外部映射 | Redis 缓存 |

{% callout type="note" title="数据库安全配置" %}
PostgreSQL 默认不对外暴露端口，仅允许容器内部网络访问。这是生产环境的安全最佳实践。如需调试数据库，可取消 `docker-compose.yaml` 中的端口注释（绑定到 `127.0.0.1:35432`），或通过 SSH 隧道连接。
{% /callout %}

---

## 常见问题

### 数据库连接失败

**问题**：应用日志显示无法连接数据库

**解决方案**：
1. 检查 PostgreSQL 服务是否健康：`docker compose ps`
2. 确认 `.env` 中的 `DB_USER`、`DB_PASSWORD`、`DB_NAME` 配置正确
3. 查看数据库日志：`docker compose logs postgres`

### 端口被占用

**问题**：启动时提示端口已被占用

**解决方案**：
1. 修改 `.env` 中的 `APP_PORT` 为其他端口
2. 或者停止占用该端口的其他服务

### 无法登录管理后台

**问题**：输入 ADMIN_TOKEN 后无法登录

**解决方案**：
1. 确认使用的是 `.env` 文件中设置的 `ADMIN_TOKEN` 值
2. 如果通过远程 HTTP 访问，设置 `ENABLE_SECURE_COOKIES=false`
3. 清除浏览器缓存后重试

### 健康检查失败

**问题**：服务启动后状态显示 `unhealthy`

**解决方案**：
1. 等待更长时间，首次启动可能需要几分钟
2. 查看应用日志：`docker compose logs app`
3. 确认服务器有足够的内存（建议至少 2GB）

---

## 下一步

- [系统设置](/docs/guide/settings) - 了解如何配置和使用
- [供应商管理](/docs/guide/settings-providers) - 添加 AI 供应商
- [用户管理](/docs/guide/users) - 创建和管理用户
