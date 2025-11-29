---
dimensions:
  type:
    primary: implementation
    detail: quickstart
  level: beginner
standard_title: 快速安装
language: zh
---

# 快速安装

本指南将帮助你快速部署 Claude Code Hub。推荐使用一键部署脚本，全自动完成安装配置。 {% .lead %}

---

## 环境要求

在开始安装之前，请确保你的系统满足以下要求：

| 依赖项 | 版本要求 | 说明 |
| --- | --- | --- |
| Docker | 最新版本（推荐） | 容器运行环境 |
| Docker Compose | V2（推荐） | 多容器编排工具 |
| Node.js | >= 20（本地开发可选） | JavaScript 运行时 |
| Bun | >= 1.3（本地开发可选） | 高性能 JavaScript 运行时 |

{% callout type="note" title="关于 Docker" %}
Docker 和 Docker Compose 是部署 Claude Code Hub 的首选方式。一键部署脚本会自动检测并安装 Docker（Linux/macOS 支持自动安装）。
{% /callout %}

---

## 一键部署脚本（推荐）

一键部署脚本会**自动完成**以下所有步骤：

- 检查并安装 Docker 和 Docker Compose
- 创建部署目录并配置文件
- 生成安全的管理员令牌和数据库密码
- 启动所有服务并等待健康检查
- 显示访问地址和管理员令牌

### Linux / macOS

使用 curl 下载并运行：

```bash
curl -fsSL https://raw.githubusercontent.com/ding113/claude-code-hub/main/scripts/deploy.sh -o deploy.sh
chmod +x deploy.sh
./deploy.sh
```

或者使用 wget：

```bash
wget https://raw.githubusercontent.com/ding113/claude-code-hub/main/scripts/deploy.sh
chmod +x deploy.sh
./deploy.sh
```

### Windows (PowerShell)

以**管理员模式**运行 PowerShell，然后执行：

```powershell
Invoke-WebRequest -Uri "https://raw.githubusercontent.com/ding113/claude-code-hub/main/scripts/deploy.ps1" -OutFile "deploy.ps1"
Set-ExecutionPolicy -ExecutionPolicy Bypass -Scope Process -Force
.\deploy.ps1
```

{% callout type="warning" title="Windows 用户注意" %}
如果你的系统未安装 Docker Desktop，脚本会自动打开下载页面。请先安装 Docker Desktop 后再运行部署脚本。
{% /callout %}

### 部署目录

脚本会根据操作系统自动选择部署目录：

| 操作系统 | 部署目录 |
| --- | --- |
| Linux | `/www/compose/claude-code-hub` |
| macOS | `~/Applications/claude-code-hub` |
| Windows | `C:\ProgramData\claude-code-hub` |

### 分支选择

脚本运行时会提示你选择部署分支：

| 分支 | 镜像标签 | 说明 |
| --- | --- | --- |
| `main` | `latest` | **稳定版本**，推荐生产环境使用 |
| `dev` | `dev` | 开发版本，包含最新功能，用于测试 |

{% callout type="warning" title="重要提示" %}
请妥善保存脚本输出的**管理员令牌**（Admin Token），这是登录后台的唯一凭证！丢失后需要重新部署或手动修改配置文件。
{% /callout %}

---

## Docker Compose 手动部署

如果你更喜欢手动控制部署过程，可以使用 Docker Compose 方式。

### 第一步：克隆项目并配置环境

```bash
git clone https://github.com/ding113/claude-code-hub.git
cd claude-code-hub
cp .env.example .env
```

### 第二步：修改配置文件

编辑 `.env` 文件，**必须修改** `ADMIN_TOKEN`（后台登录令牌）：

```bash
# 必须修改此项！请设置一个安全的随机字符串
ADMIN_TOKEN=your-secure-token-here

# Docker Compose 默认配置（通常无需修改）
DSN=postgres://postgres:postgres@postgres:5432/claude_code_hub
REDIS_URL=redis://redis:6379
```

{% callout type="note" title="生成安全令牌" %}
你可以使用以下命令生成安全的随机令牌：
```bash
openssl rand -base64 32 | tr -d '/+=' | head -c 32
```
{% /callout %}

### 第三步：启动服务

```bash
docker compose up -d
```

查看启动状态：

```bash
docker compose ps
docker compose logs -f app
```

### 升级服务

```bash
docker compose pull && docker compose up -d
```

停止并清理服务：

```bash
docker compose down
```

---

## 本地开发环境

如果你想参与开发或需要在本地调试，可以使用开发工具链。

### 使用 Makefile（推荐）

进入 `dev/` 目录，使用 Makefile 管理开发环境：

```bash
cd dev

# 一键启动 PostgreSQL + Redis + bun dev
make dev

# 仅启动数据库和 Redis
make db

# 查看服务日志
make logs
make logs-app

# 清理或重置环境
make clean
make reset

# 数据库操作
make migrate      # 执行数据库迁移
make db-shell     # 进入数据库命令行
```

### 手动启动

如果不使用 Makefile，可以手动执行：

```bash
# 安装依赖
bun install

# 构建项目
bun run build

# 启动生产服务器
bun run start
```

{% callout type="note" title="自动迁移" %}
首次运行时建议开启 `AUTO_MIGRATE=true` 自动迁移数据库。生产环境完成后建议改为 `false` 并使用 Drizzle CLI 手动管理迁移。
{% /callout %}

---

## 访问应用

启动成功后，你可以通过以下地址访问：

| 服务 | 地址 | 说明 |
| --- | --- | --- |
| 管理后台 | `http://localhost:23000` | 使用 `ADMIN_TOKEN` 登录 |
| API 文档 (Scalar) | `http://localhost:23000/api/actions/scalar` | 现代化 API 文档界面 |
| API 文档 (Swagger) | `http://localhost:23000/api/actions/docs` | 经典 Swagger UI |

{% callout type="note" title="修改端口" %}
如需修改端口，请编辑 `docker-compose.yml` 或 `.env` 文件中的 `APP_PORT` 配置。
{% /callout %}

---

## 常见问题

### 数据库连接失败

1. 确认 `DSN` 格式与凭据无误
2. Docker 场景下使用服务名（如 `postgres:5432`）而非 `localhost`
3. 使用 `docker compose ps` 检查数据库容器状态
4. 使用 `make db-shell` 进入数据库诊断

### Redis 离线会影响服务吗？

平台采用 **Fail-Open** 策略：限流与会话统计会降级，但请求仍会继续处理。建议监控日志中的 Redis Error 并尽快恢复。

### Windows 上无法运行脚本

1. 确保以管理员模式运行 PowerShell
2. 执行 `Set-ExecutionPolicy -ExecutionPolicy Bypass -Scope Process -Force` 允许脚本执行
3. 确保已安装 Docker Desktop 并正在运行

---

## 下一步

安装完成后，继续以下步骤：

1. **[配置环境变量](/docs/configuration)** - 了解所有可配置项
2. **[添加供应商](/docs/providers)** - 添加你的第一个 AI 供应商
3. **[创建用户](/docs/users)** - 创建用户并分配 API Key
4. **[客户端配置](/docs/client-setup)** - 配置 Claude Code 等客户端连接
