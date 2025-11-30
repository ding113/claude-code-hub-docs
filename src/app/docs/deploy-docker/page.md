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
claude-code-hub-db      Up (healthy)             0.0.0.0:35432->5432/tcp
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
| `postgres` | `postgres:18` | `35432:5432` | PostgreSQL 数据库 |
| `redis` | `redis:7-alpine` | 无外部映射 | Redis 缓存 |

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

- [快速开始](/docs/quickstart) - 了解如何配置和使用
- [供应商管理](/docs/providers) - 添加 AI 供应商
- [用户管理](/docs/users) - 创建和管理用户
