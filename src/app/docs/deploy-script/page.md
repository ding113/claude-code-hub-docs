---
dimensions:
  type:
    primary: getting-started
    detail: deployment
  level: beginner
standard_title: 一键部署
language: zh
---

# 一键部署

一键部署脚本是部署 Claude Code Hub 最简单的方式。脚本会自动完成所有配置工作，让你在几分钟内即可启动服务。

## 系统要求

- **操作系统**：Linux、macOS 或 Windows
- **Docker**：脚本会自动检测并安装（Linux/macOS）
- **Docker Compose**：包含在 Docker 安装中
- **网络**：需要访问 GitHub Container Registry 下载镜像

{% callout type="note" title="Windows 用户须知" %}
Windows 系统需要预先安装 Docker Desktop。如果未安装，脚本会自动打开下载页面。
{% /callout %}

## 快速开始

### Linux / macOS

使用 curl 下载并运行部署脚本：

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

{% callout type="warning" title="Linux 权限提示" %}
在 Linux 系统上，如果 Docker 未安装，脚本需要 root 权限来安装 Docker 和创建 `/www` 目录。请使用 `sudo ./deploy.sh` 运行。
{% /callout %}

### Windows (PowerShell)

以管理员模式运行 PowerShell，然后执行：

```powershell
Invoke-WebRequest -Uri "https://raw.githubusercontent.com/ding113/claude-code-hub/main/scripts/deploy.ps1" -OutFile "deploy.ps1"
Set-ExecutionPolicy -ExecutionPolicy Bypass -Scope Process -Force
.\deploy.ps1
```

## 部署目录

脚本会根据操作系统自动选择部署目录：

| 操作系统 | 部署目录 |
| --- | --- |
| Linux | `/www/compose/claude-code-hub` |
| macOS | `~/Applications/claude-code-hub` |
| Windows | `C:\ProgramData\claude-code-hub` |

部署目录结构：

```plaintext
claude-code-hub/
├── docker-compose.yaml    # Docker Compose 配置文件
├── .env                   # 环境变量配置
└── data/
    ├── postgres/          # PostgreSQL 数据持久化
    └── redis/             # Redis 数据持久化
```

## 分支选择

运行脚本时，会提示选择部署分支：

```plaintext
Please select the branch to deploy:
  1) main   (Stable release - recommended for production)
  2) dev    (Latest features - for testing)
```

| 分支 | 镜像标签 | 说明 |
| --- | --- | --- |
| main | `latest` | 稳定版本，推荐生产环境使用 |
| dev | `dev` | 开发版本，包含最新功能，适合测试 |

默认选择 `main` 分支（直接按回车）。

## 脚本执行流程

一键部署脚本会自动完成以下步骤：

### 1. 环境检测

- 检测操作系统类型（Linux/macOS/Windows）
- 检查 Docker 和 Docker Compose 是否已安装

### 2. 自动安装 Docker（Linux/macOS）

如果 Docker 未安装，脚本会：

- 从 `get.docker.com` 下载官方安装脚本
- 执行安装并启动 Docker 服务
- 配置 Docker 开机自启
- 将当前用户添加到 docker 组（Linux）

{% callout type="note" title="Windows Docker 安装" %}
Windows 系统不支持自动安装 Docker。脚本会打开 Docker Desktop 下载页面，请手动安装后重新运行脚本。
{% /callout %}

### 3. 生成安全凭证

脚本会自动生成：

- **管理员令牌**（Admin Token）：32 位随机字符串，用于登录管理后台
- **数据库密码**：24 位随机字符串，用于 PostgreSQL 认证
- **容器后缀**：4 位随机字符串，确保容器名称唯一

### 4. 创建配置文件

自动生成 `docker-compose.yaml` 和 `.env` 配置文件，包含：

- PostgreSQL 18 数据库配置
- Redis 7 缓存配置
- 应用服务配置
- 健康检查配置
- 网络配置

### 5. 启动服务

- 拉取最新 Docker 镜像
- 按依赖顺序启动服务（PostgreSQL -> Redis -> App）
- 等待所有服务健康检查通过（最长 60 秒）

### 6. 显示部署结果

部署成功后显示：

- 访问地址（包括所有网络接口的 IP）
- 管理员令牌
- 常用管理命令

## 部署成功输出示例

```plaintext
╔════════════════════════════════════════════════════════════════╗
║                                                                ║
║          Claude Code Hub Deployed Successfully!                ║
║                                                                ║
╚════════════════════════════════════════════════════════════════╝

📍 Deployment Directory:
   /www/compose/claude-code-hub

🌐 Access URLs:
   http://192.168.1.100:23000
   http://localhost:23000

🔑 Admin Token (KEEP THIS SECRET!):
   aBcDeFgHiJkLmNoPqRsTuVwXyZ123456

📚 Usage Documentation:
   Chinese: http://localhost:23000/zh-CN/usage-doc
   English: http://localhost:23000/en-US/usage-doc

🔧 Useful Commands:
   View logs:    cd /www/compose/claude-code-hub && docker compose logs -f
   Stop services: cd /www/compose/claude-code-hub && docker compose down
   Restart:      cd /www/compose/claude-code-hub && docker compose restart

⚠️  IMPORTANT: Please save the admin token in a secure location!
```

{% callout type="warning" title="务必保存管理员令牌" %}
管理员令牌是登录管理后台的唯一凭证，且仅在部署时显示一次。请立即将其保存到安全的位置（如密码管理器）。如果丢失，需要手动修改 `.env` 文件重新设置。
{% /callout %}

## 常用管理命令

部署完成后，进入部署目录执行以下命令管理服务：

```bash
# 进入部署目录
cd /www/compose/claude-code-hub  # Linux
cd ~/Applications/claude-code-hub  # macOS
cd C:\ProgramData\claude-code-hub  # Windows

# 查看服务状态
docker compose ps

# 查看实时日志
docker compose logs -f

# 仅查看应用日志
docker compose logs -f app

# 重启所有服务
docker compose restart

# 停止所有服务
docker compose down

# 更新到最新版本
docker compose pull && docker compose up -d
```

## 常见问题

### Docker 安装失败

**问题**：脚本无法自动安装 Docker

**解决方案**：
1. 确保有网络连接
2. Linux 用户确保使用 `sudo` 运行
3. 手动安装 Docker：访问 [Docker 官方文档](https://docs.docker.com/engine/install/)

### 服务健康检查超时

**问题**：等待 60 秒后服务仍未健康

**解决方案**：

```bash
# 查看详细日志
docker compose logs

# 检查各服务状态
docker compose ps

# 如果是首次启动，数据库初始化可能需要更长时间
# 可以等待几分钟后检查
docker inspect --format='{{.State.Health.Status}}' claude-code-hub-app-xxxx
```

### 端口冲突

**问题**：端口 23000 或 35432 已被占用

**解决方案**：

1. 查找占用端口的进程：
   ```bash
   # Linux/macOS
   lsof -i :23000
   # Windows
   netstat -ano | findstr :23000
   ```

2. 修改 `.env` 文件中的端口配置：
   ```plaintext
   APP_PORT=23001
   ```

3. 重启服务：
   ```bash
   docker compose down && docker compose up -d
   ```

### 忘记管理员令牌

**问题**：部署后忘记保存管理员令牌

**解决方案**：

```bash
# 查看 .env 文件中的 ADMIN_TOKEN
cat /www/compose/claude-code-hub/.env | grep ADMIN_TOKEN
```

或直接编辑 `.env` 文件修改为新的令牌：

```bash
# 编辑 .env 文件
nano /www/compose/claude-code-hub/.env

# 修改 ADMIN_TOKEN 行后重启服务
docker compose restart app
```

### 磁盘空间不足

**问题**：Docker 镜像下载失败或服务启动失败

**解决方案**：

```bash
# 检查磁盘空间
df -h

# 清理未使用的 Docker 资源
docker system prune -a
```

## 下一步

部署成功后，你可以：

- [访问管理后台](/docs/guide/settings)配置系统
- [添加供应商](/docs/guide/settings-providers)接入 AI 服务
- [创建用户和 API Key](/docs/guide/users)分发给团队成员
