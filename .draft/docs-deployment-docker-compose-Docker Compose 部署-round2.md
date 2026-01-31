# Docker Compose 部署指南

## 概述

Claude Code Hub 提供完整的 Docker Compose 部署方案，通过单一命令即可启动包含 PostgreSQL 数据库、Redis 缓存和 Next.js 应用服务的完整栈。

## 设计目标

- **简洁性**: 一条命令 `docker compose up -d` 启动所有服务
- **数据持久化**: 使用 Docker 卷确保容器重启后数据不丢失
- **健康监控**: 所有服务均配置健康检查，实现依赖管理
- **安全性**: 数据库不对外暴露端口，凭证通过环境变量注入
- **灵活性**: 支持手动部署和自动化脚本部署

## 服务编排流程

### 启动顺序

1. **postgres** 和 **redis** 首先启动（无依赖）
2. **app** 等待数据库和缓存均健康后才启动（`condition: service_healthy`）

### 健康检查策略

| 服务 | 检查方式 | 说明 |
|------|----------|------|
| PostgreSQL | `pg_isready` 命令 | 验证数据库接受连接 |
| Redis | `redis-cli ping` | 验证缓存服务响应 |
| App | HTTP GET `/api/actions/health` | 验证应用服务就绪 |

### 重启策略

所有服务使用 `unless-stopped`：容器自动重启，除非用户显式停止。

### 网络隔离

服务通过内部 Docker 网络通信，仅应用端口对外暴露。

## 服务配置详解

### 服务概览

| 服务 | 镜像 | 用途 | 内部端口 |
|------|------|------|----------|
| postgres | postgres:18 | 主数据库 | 5432 |
| redis | redis:7-alpine | 会话缓存与限流 | 6379 |
| app | ghcr.io/ding113/claude-code-hub:latest | 主应用 | 3000 |

### 端口映射

| 服务 | 外部端口 | 内部端口 | 说明 |
|------|----------|----------|------|
| app | `${APP_PORT:-23000}` | 3000 | 唯一对外暴露的端口 |
| postgres | 无 | 5432 | 仅内部网络访问 |
| redis | 无 | 6379 | 仅内部网络访问 |

**调试说明**: PostgreSQL 端口在 `docker-compose.yaml` 中已注释（第9-10行）。如需本地调试，可取消注释：

```yaml
ports:
  - "127.0.0.1:35432:5432"
```

### 数据卷挂载

| 服务 | 主机路径 | 容器路径 | 用途 |
|------|----------|----------|------|
| postgres | `./data/postgres` | `/data` | 数据库持久化 |
| redis | `./data/redis` | `/data` | AOF 持久化 |

**重要**: PostgreSQL 使用自定义 `PGDATA: /data/pgdata` 避免与卷挂载的权限冲突。

### 健康检查配置

**PostgreSQL**:
```yaml
test: ["CMD-SHELL", "pg_isready -U ${DB_USER:-postgres} -d ${DB_NAME:-claude_code_hub}"]
interval: 5s
timeout: 5s
retries: 10
start_period: 10s
```

**Redis**:
```yaml
test: ["CMD", "redis-cli", "ping"]
interval: 5s
timeout: 3s
retries: 5
start_period: 5s
```

**App**:
```yaml
test: ["CMD-SHELL", "curl -f http://localhost:3000/api/actions/health || exit 1"]
interval: 30s
timeout: 5s
retries: 3
start_period: 30s
```

## 环境变量

### 数据库配置（来自 `.env`）

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `DB_USER` | postgres | PostgreSQL 用户名 |
| `DB_PASSWORD` | postgres | PostgreSQL 密码 |
| `DB_NAME` | claude_code_hub | 数据库名称 |

### 应用配置

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `APP_PORT` | 23000 | 外部访问端口 |
| `AUTO_MIGRATE` | true | 启动时运行迁移 |
| `ENABLE_RATE_LIMIT` | true | 启用基于 Redis 的限流 |
| `SESSION_TTL` | 300 | 会话缓存 TTL（秒） |
| `ADMIN_TOKEN` | （必填） | 管理员认证令牌 |
| `COMPOSE_PROJECT_NAME` | claude-code-hub | Docker Compose 项目名称 |

### 内部连接字符串（自动配置）

```
DSN: postgresql://${DB_USER}:${DB_PASSWORD}@postgres:5432/${DB_NAME}
REDIS_URL: redis://redis:6379
```

### 完整环境变量列表

更多环境变量请参考 `.env.example`：

- `DB_POOL_MAX` / `DB_POOL_IDLE_TIMEOUT` / `DB_POOL_CONNECT_TIMEOUT`: 连接池配置
- `MESSAGE_REQUEST_WRITE_MODE`: 请求日志写入模式（async/sync）
- `ENABLE_SECURE_COOKIES`: Cookie 安全策略
- `REDIS_TLS_REJECT_UNAUTHORIZED`: Redis TLS 证书验证
- `STORE_SESSION_MESSAGES`: 会话消息存储模式
- `ENABLE_CIRCUIT_BREAKER_ON_NETWORK_ERRORS`: 网络错误计入熔断器
- `ENABLE_PROVIDER_CACHE`: 供应商进程级缓存
- `FETCH_CONNECT_TIMEOUT` / `FETCH_HEADERS_TIMEOUT` / `FETCH_BODY_TIMEOUT`: 请求超时配置
- `MAX_RETRY_ATTEMPTS_DEFAULT`: 单供应商最大尝试次数
- `ENABLE_SMART_PROBING` / `PROBE_INTERVAL_MS` / `PROBE_TIMEOUT_MS`: 智能探测配置
- `ENDPOINT_PROBE_*`: 端点探测配置

## 边缘情况与注意事项

### 1. 数据持久化

- **场景**: 容器被移除并重新创建
- **行为**: 数据保留在主机 `./data/` 目录
- **风险**: 如果删除主机目录，数据将丢失
- **缓解**: 定期备份 `./data/postgres`

### 2. 端口冲突

- **场景**: 端口 23000 已被占用
- **错误**: `bind: address already in use`
- **解决**: 设置 `APP_PORT` 环境变量为其他端口

### 3. 数据库迁移失败

- **场景**: `AUTO_MIGRATE=true` 但迁移失败
- **行为**: 应用容器可能进入重启循环
- **解决**: 使用 `docker compose logs -f app` 查看日志，手动运行迁移

### 4. Redis 故障转移

- **场景**: Redis 不可用
- **行为**: 限流和会话功能降级（Fail-Open）
- **恢复**: Redis 容器自动重启，应用自动重连

### 5. 时区一致性

- PostgreSQL 和 App 服务配置 `TZ: Asia/Shanghai`
- 确保日志和数据库记录的时戳一致

## 升级命令

### 标准升级

```bash
cd /path/to/claude-code-hub
docker compose pull
docker compose up -d
```

### 带数据迁移的升级

```bash
# 先备份
cp -r data data.backup.$(date +%Y%m%d)

# 升级
docker compose pull
docker compose up -d

# 验证
docker compose ps
docker compose logs -f app
```

### 完全重置（数据丢失）

```bash
docker compose down -v  # 删除卷
rm -rf data/            # 删除持久化数据
docker compose up -d    # 全新启动
```

## 必需的环境变量

### 最小配置（来自 `.env.example`）

| 变量 | 必需 | 用途 |
|------|------|------|
| `ADMIN_TOKEN` | **是** | 管理员登录认证 |
| `DB_PASSWORD` | 推荐 | 数据库安全 |

### Docker Compose 自动配置

以下变量通过 `docker-compose.yaml` 自动配置，通常无需手动设置：
- `DSN`: 由 DB_* 变量构建
- `REDIS_URL`: 固定为 `redis://redis:6379`
- `NODE_ENV`: 设置为 `production`

### 可选但推荐的变量

| 变量 | 默认值 | 覆盖场景 |
|------|--------|----------|
| `APP_PORT` | 23000 | 端口冲突 |
| `SESSION_TTL` | 300 | 会话缓存需求 |
| `ENABLE_RATE_LIMIT` | true | 调试时禁用 |
| `AUTO_MIGRATE` | true | 手动控制迁移 |

## 文件引用

- **主 Compose**: `/Users/ding/Github/claude-code-hub/docker-compose.yaml`
- **开发 Compose**: `/Users/ding/Github/claude-code-hub/dev/docker-compose.yaml`
- **Dockerfile**: `/Users/ding/Github/claude-code-hub/deploy/Dockerfile`
- **环境模板**: `/Users/ding/Github/claude-code-hub/.env.example`
- **部署脚本 (Linux/macOS)**: `/Users/ding/Github/claude-code-hub/scripts/deploy.sh`
- **部署脚本 (Windows)**: `/Users/ding/Github/claude-code-hub/scripts/deploy.ps1`

## 对比：生产环境 vs 开发环境

| 特性 | 生产环境 (`docker-compose.yaml`) | 开发环境 (`dev/docker-compose.yaml`) |
|------|----------------------------------|--------------------------------------|
| 应用镜像 | GHCR 预构建镜像 | 本地源码构建 |
| Postgres 端口 | 不暴露 | 暴露于 `${POSTGRES_PORT:-5432}` |
| Redis 端口 | 不暴露 | 暴露于 `${REDIS_PORT:-6379}` |
| 数据目录 | `./data/postgres` | `../data/postgres-dev` |
| 应用 Profile | 始终启动 | 需要 `--profile app` |
| 健康检查间隔 | 30s | 15s |
| 健康检查重试 | 3 次 | 20 次 |
| 管理员令牌 | 来自 `.env` | 默认 `cch-dev-admin` |
| 镜像标签 | `latest` | `${APP_VERSION:-dev}` |

## Dockerfile 说明

构建阶段使用 `oven/bun:debian`，运行阶段使用 `node:trixie-slim`：

- **构建**: Bun 提供快速包管理和构建
- **运行**: Node.js 避免 Bun 流式响应内存泄漏问题 (#18488)
- **工具**: 安装 PostgreSQL 18 客户端用于数据库备份/恢复
- **用户**: 以 `node` 用户运行（非 root）
- **端口**: 暴露 3000 端口

## 安全考虑

1. **数据库访问**: PostgreSQL 仅在 Docker 网络内可访问
2. **管理员令牌**: 必须修改默认值，存储于 `.env` 文件并设置 600 权限
3. **镜像来源**: 使用 GitHub Container Registry (ghcr.io) 的签名镜像
4. **非 Root 运行**: 应用容器以 `node` 用户运行

---

*文档基于 `/Users/ding/Github/claude-code-hub` 仓库的源代码分析生成*
