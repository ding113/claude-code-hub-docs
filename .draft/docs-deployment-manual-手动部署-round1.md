# Claude Code Hub 手动部署实现分析报告

## 1. Intent Analysis (实现意图分析)

### 1.1 项目概述

Claude Code Hub (CCH) 是一个基于 Next.js 15 + Hono + PostgreSQL + Redis 构建的智能 AI API 代理中转服务平台。项目支持多种部署方式，其中手动部署（Manual Deployment）提供了最大的灵活性和控制权，适合有特定基础设施需求或需要自定义部署环境的用户。

### 1.2 手动部署的设计目标

根据代码分析，手动部署实现具有以下核心设计目标：

1. **灵活性优先**：允许用户完全控制运行环境、依赖版本和配置参数
2. **最小化依赖**：仅需 Bun/Node.js、PostgreSQL 和 Redis 即可运行
3. **构建-运行分离**：明确的构建阶段（`bun run build`）和运行阶段（`bun run start`）
4. **自动初始化支持**：通过 `AUTO_MIGRATE` 环境变量控制数据库自动迁移
5. **生产级准备**：支持独立输出（standalone）、连接池配置、健康检查等生产环境特性

### 1.3 与 Docker 部署的差异

手动部署相比 Docker Compose 部署：
- **优势**：更轻量、可集成现有基础设施、便于调试、无容器开销
- **劣势**：需要手动管理依赖、环境一致性需自行保证、升级过程更复杂

---

## 2. Behavior Summary (行为总结)

### 2.1 应用启动流程

根据 `/Users/ding/Github/claude-code-hub/src/instrumentation.ts` 的实现，应用启动时执行以下初始化流程：

```
1. 检查 CI 环境 → 如果是 CI 则跳过所有数据库初始化
2. 启动 Session 缓存清理任务（每 60 秒）
3. 注册进程关闭钩子（SIGTERM/SIGINT）
4. 检查数据库连接（最多重试 30 次，每次间隔 2 秒）
5. 执行数据库迁移（如果 AUTO_MIGRATE !== "false"）
6. 回填 provider_vendors 数据
7. 回填 provider_endpoints 数据
8. 初始化价格表（如果数据库为空）
9. 启动云端价格表定时同步（每 30 分钟）
10. 同步错误规则并初始化检测器
11. 初始化日志清理任务队列
12. 初始化通知任务队列
13. 初始化智能探测调度器（如果启用）
14. 启动端点探测调度器
15. 启动探测日志清理任务
```

### 2.2 数据库迁移行为

根据 `/Users/ding/Github/claude-code-hub/src/lib/migrate.ts`：

- 迁移使用 Drizzle ORM 的 `migrate()` 函数执行
- 迁移文件位于 `drizzle/` 目录
- 迁移执行前会验证 `DSN` 环境变量
- 迁移失败会导致进程退出（`process.exit(1)`）
- 使用独立的 postgres 客户端（max: 1）执行迁移

### 2.3 构建过程行为

根据 `/Users/ding/Github/claude-code-hub/package.json` 和 `/Users/ding/Github/claude-code-hub/deploy/Dockerfile`：

```bash
# 构建命令
bun run build  # 等价于: next build && cp VERSION .next/standalone/VERSION
```

构建过程：
1. Next.js 执行静态生成和服务器构建
2. 输出 standalone 模式（`output: "standalone"` in next.config.ts）
3. 复制 VERSION 文件到 standalone 目录
4. 构建时使用占位符 DSN 和 REDIS_URL（避免数据库连接错误）
5. CI=true 标记跳过 instrumentation 的数据库初始化

### 2.4 运行时行为

```bash
# 启动命令
bun run start  # 等价于: next start
```

运行时特性：
- 监听端口由 `PORT` 环境变量控制（默认 23000）
- 生产环境使用 Node.js 运行（避免 Bun 流式响应内存泄漏 Issue #18488）
- 自动执行 instrumentation.ts 中的初始化逻辑
- 支持优雅关闭（处理 SIGTERM/SIGINT 信号）

---

## 3. Configuration & Commands (配置与命令)

### 3.1 必需环境变量

根据 `/Users/ding/Github/claude-code-hub/.env.example` 和 `/Users/ding/Github/claude-code-hub/src/lib/config/env.schema.ts`：

| 变量名 | 类型 | 必需 | 说明 |
|--------|------|------|------|
| `ADMIN_TOKEN` | string | 是 | 后台登录令牌，部署前必须修改 |
| `DSN` | string | 是 | PostgreSQL 连接字符串，格式：`postgres://user:pass@host:5432/db` |
| `REDIS_URL` | string | 是 | Redis 连接地址，格式：`redis://host:6379`，支持 `rediss://` |

### 3.2 重要可选环境变量

| 变量名 | 默认值 | 说明 |
|--------|--------|------|
| `AUTO_MIGRATE` | `true` | 启动时自动执行数据库迁移，生产环境可设为 `false` 手动控制 |
| `NODE_ENV` | `development` | 运行环境，`production` 启用完整初始化流程 |
| `PORT` | `23000` | 应用监听端口 |
| `APP_URL` | - | 应用访问地址，用于 OpenAPI 文档 |
| `DB_POOL_MAX` | 20 (prod) / 10 (dev) | PostgreSQL 连接池上限 |
| `DB_POOL_IDLE_TIMEOUT` | `20` | 空闲连接回收时间（秒） |
| `DB_POOL_CONNECT_TIMEOUT` | `10` | 连接建立超时（秒） |
| `ENABLE_RATE_LIMIT` | `true` | 是否启用限流功能 |
| `SESSION_TTL` | `300` | Session 缓存时间（秒） |
| `ENABLE_SECURE_COOKIES` | `true` | 是否强制 HTTPS Cookie |

### 3.3 完整部署命令流程

```bash
# 1. 克隆项目
git clone https://github.com/ding113/claude-code-hub.git
cd claude-code-hub

# 2. 安装依赖
bun install

# 3. 配置环境变量
cp .env.example .env
# 编辑 .env 文件，设置 ADMIN_TOKEN、DSN、REDIS_URL

# 4. 构建应用
bun run build

# 5. 启动应用（方式一：直接使用 bun）
bun run start

# 5. 启动应用（方式二：使用 Node.js，推荐用于生产）
cd .next/standalone
node server.js
```

### 3.4 数据库迁移命令

```bash
# 生成迁移（修改 schema.ts 后执行）
bun run db:generate

# 手动执行迁移
bun run db:migrate

# 推送 schema 变更（开发环境）
bun run db:push

# 打开 Drizzle Studio
bun run db:studio
```

### 3.5 其他管理命令

```bash
# 代码检查
bun run lint
bun run typecheck

# 测试
bun run test

# 格式化
bun run format
```

---

## 4. Edge Cases & Considerations (边界情况与注意事项)

### 4.1 AUTO_MIGRATE 行为详解

根据 `/Users/ding/Github/claude-code-hub/src/instrumentation.ts` 第 202-207 行：

```typescript
// 执行迁移（可通过 AUTO_MIGRATE=false 跳过）
if (process.env.AUTO_MIGRATE !== "false") {
  await runMigrations();
} else {
  logger.info("[Instrumentation] AUTO_MIGRATE=false: skipping migrations");
}
```

关键注意点：
- **字符串比较**：使用 `!== "false"` 进行严格字符串比较，不是布尔值比较
- **默认启用**：任何非 `"false"` 值（包括 undefined、空字符串、`"true"`、`"1"`）都会启用自动迁移
- **生产环境建议**：首次部署后建议设为 `"false"`，使用 Drizzle CLI 手动管理迁移

### 4.2 数据库连接重试机制

根据 `/Users/ding/Github/claude-code-hub/src/lib/migrate.ts` 第 44-67 行：

```typescript
export async function checkDatabaseConnection(retries = 30, delay = 2000): Promise<boolean>
```

- 默认重试 30 次，每次间隔 2 秒
- 总等待时间最长约 60 秒
- 连接失败会导致应用启动失败（生产环境 `process.exit(1)`）

### 4.3 构建时环境变量要求

根据 `/Users/ding/Github/claude-code-hub/deploy/Dockerfile` 第 21-26 行：

```dockerfile
# 构建时需要的环境变量 (避免数据库初始化错误)
ENV DSN="postgres://placeholder:placeholder@localhost:5432/placeholder"
ENV REDIS_URL="redis://localhost:6379"
ENV CI=true
```

构建时：
- 必须设置 `CI=true` 跳过 instrumentation 的数据库初始化
- DSN 和 REDIS_URL 可以是占位符，不会被实际使用
- 构建不依赖真实数据库连接

### 4.4 运行时 Node.js/Bun 选择

根据 `/Users/ding/Github/claude-code-hub/deploy/Dockerfile` 第 30-31 行：

```dockerfile
# 运行阶段：使用 Node.js（避免 Bun 流式响应内存泄漏 Issue #18488）
FROM node:trixie-slim AS runner
```

重要说明：
- 构建阶段使用 Bun（快速）
- 运行阶段建议使用 Node.js（稳定，避免内存泄漏）
- 如果使用 Bun 运行，需监控流式响应场景的内存使用

### 4.5 连接池配置注意事项

根据 `/Users/ding/Github/claude-code-hub/src/drizzle/db.ts` 第 18-25 行：

```typescript
const defaultMax = env.NODE_ENV === 'production' ? 20 : 10;
const client = postgres(connectionString, {
  max: env.DB_POOL_MAX ?? defaultMax,
  idle_timeout: env.DB_POOL_IDLE_TIMEOUT ?? 20,
  connect_timeout: env.DB_POOL_CONNECT_TIMEOUT ?? 10,
});
```

- 生产环境默认连接池大小为 20
- Kubernetes 多副本部署时需按副本数分摊数据库 `max_connections`
- 每个应用进程独立维护连接池

### 4.6 Redis Fail-Open 策略

根据 `/Users/ding/Github/claude-code-hub/.env.example` 第 54 行注释：

```
# - Fail Open 策略：Redis 不可用时自动降级，不影响服务可用性
```

- 限流和 Session 统计会在 Redis 不可用时降级
- 核心代理功能不受影响
- 建议监控 Redis 状态并尽快恢复

### 4.7 健康检查端点

根据 `/Users/ding/Github/claude-code-hub/docker-compose.yaml` 第 71 行：

```yaml
test: ["CMD-SHELL", "curl -f http://localhost:3000/api/actions/health || exit 1"]
```

- 健康检查端点：`/api/actions/health`
- 可用于负载均衡器健康检查

---

## 5. Production Deployment Considerations (生产部署考虑)

### 5.1 系统服务配置示例 (systemd)

```ini
# /etc/systemd/system/claude-code-hub.service
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
ExecStart=/usr/bin/node .next/standalone/server.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

### 5.2 反向代理配置 (Nginx)

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
        
        # 长连接支持（用于 SSE）
        proxy_read_timeout 86400;
    }
}
```

### 5.3 升级流程

```bash
# 1. 备份数据库
pg_dump -U postgres claude_code_hub > backup_$(date +%Y%m%d).sql

# 2. 拉取最新代码
git pull origin main

# 3. 安装依赖
bun install

# 4. 构建
bun run build

# 5. 执行迁移（如果 AUTO_MIGRATE=false）
bun run db:migrate

# 6. 重启服务
sudo systemctl restart claude-code-hub
```

### 5.4 监控建议

- 应用日志：配置日志收集（如 ELK、Loki）
- 数据库监控：连接数、查询性能、慢查询
- Redis 监控：内存使用、连接状态
- 健康检查：定期检查 `/api/actions/health`
- 资源监控：CPU、内存、磁盘使用

---

## 6. References (参考文件)

### 6.1 核心配置文件

| 文件路径 | 说明 |
|----------|------|
| `/Users/ding/Github/claude-code-hub/package.json` | 项目依赖、脚本定义 |
| `/Users/ding/Github/claude-code-hub/deploy/Dockerfile` | 容器构建流程参考 |
| `/Users/ding/Github/claude-code-hub/.env.example` | 环境变量完整示例 |
| `/Users/ding/Github/claude-code-hub/next.config.ts` | Next.js 配置 |

### 6.2 源代码文件

| 文件路径 | 说明 |
|----------|------|
| `/Users/ding/Github/claude-code-hub/src/instrumentation.ts` | 启动初始化逻辑 |
| `/Users/ding/Github/claude-code-hub/src/lib/migrate.ts` | 数据库迁移实现 |
| `/Users/ding/Github/claude-code-hub/src/drizzle/db.ts` | 数据库连接配置 |
| `/Users/ding/Github/claude-code-hub/src/lib/config/env.schema.ts` | 环境变量验证 Schema |

### 6.3 部署相关文件

| 文件路径 | 说明 |
|----------|------|
| `/Users/ding/Github/claude-code-hub/docker-compose.yaml` | Docker Compose 部署参考 |
| `/Users/ding/Github/claude-code-hub/scripts/deploy.sh` | 一键部署脚本（Linux/macOS） |
| `/Users/ding/Github/claude-code-hub/scripts/deploy.ps1` | 一键部署脚本（Windows） |
| `/Users/ding/Github/claude-code-hub/drizzle.config.ts` | Drizzle ORM 配置 |

### 6.4 文档文件

| 文件路径 | 说明 |
|----------|------|
| `/Users/ding/Github/claude-code-hub/README.md` | 项目主文档 |
| `/Users/ding/Github/claude-code-hub/AGENTS.md` | 开发指南 |
| `/Users/ding/Github/claude-code-hub/docs/api-authentication-guide.md` | API 认证指南 |

---

## 7. Summary (总结)

Claude Code Hub 的手动部署实现遵循现代 Node.js 应用的最佳实践：

1. **构建-运行分离**：使用 `bun run build` 生成 standalone 输出，然后使用 `bun run start` 或 `node server.js` 启动
2. **自动初始化**：通过 `AUTO_MIGRATE` 控制数据库迁移，首次部署建议开启，后续建议手动管理
3. **环境变量驱动**：所有配置通过环境变量注入，便于不同环境的管理
4. **优雅关闭**：正确处理进程信号，确保资源释放和数据完整性
5. **健康检查**：内置健康检查端点，便于监控和负载均衡

手动部署适合有一定运维经验的用户，需要对 PostgreSQL、Redis 和 Node.js/Bun 环境有基本了解。对于快速部署或测试环境，建议使用 Docker Compose 或一键部署脚本。
