---
dimensions:
  type:
    primary: getting-started
    detail: guide
  level: beginner
standard_title: 脚本部署
language: zh
---

# 脚本部署

使用一键脚本快速部署 Claude Code Hub，支持 Linux、macOS 和 Windows 三大平台。

---

## 前置要求

在开始部署前，确保你的系统满足以下条件：

| 要求 | 说明 |
| --- | --- |
| **Docker** | 用于运行 PostgreSQL、Redis 和应用容器 |
| **Root/管理员权限** | Linux 需要 sudo，Windows 需要管理员权限 |
| **网络连接** | 下载 Docker 镜像和脚本 |

{% callout type="note" title="Docker 安装" %}
脚本会自动检测 Docker 是否已安装：
- **Linux**：自动下载并安装 Docker
- **macOS/Windows**：会提示你手动安装 Docker Desktop
{% /callout %}

---

## 快速开始

### Linux / macOS

```bash
# 下载并运行部署脚本
curl -fsSL https://raw.githubusercontent.com/ding113/claude-code-hub/main/scripts/deploy.sh | bash

# 或者先下载再执行
wget https://raw.githubusercontent.com/ding113/claude-code-hub/main/scripts/deploy.sh
chmod +x deploy.sh
./deploy.sh
```

### Windows

以管理员身份运行 PowerShell：

```powershell
# 下载脚本
Invoke-WebRequest -Uri "https://raw.githubusercontent.com/ding113/claude-code-hub/main/scripts/deploy.ps1" -OutFile "deploy.ps1"

# 执行部署
.\deploy.ps1
```

{% callout type="warning" title="执行策略" %}
如果 PowerShell 提示执行策略限制，先运行：
```powershell
Set-ExecutionPolicy -ExecutionPolicy Bypass -Scope Process -Force
```
{% /callout %}

---

## 部署选项

脚本支持多种命令行选项，满足不同的部署需求：

| 选项 | 简写 | 说明 | 默认值 |
| --- | --- | --- | --- |
| `--branch` | `-b` | 部署分支 (`main` 或 `dev`) | `main` |
| `--port` | `-p` | 应用外部端口 | `23000` |
| `--admin-token` | `-t` | 自定义管理员令牌 | 自动生成 |
| `--deploy-dir` | `-d` | 自定义部署目录 | 系统默认 |
| `--domain` | - | 域名（启用 HTTPS） | - |
| `--enable-caddy` | - | 启用 Caddy 反向代理 | `false` |
| `--yes` | `-y` | 非交互模式，使用默认值 | `false` |
| `--help` | `-h` | 显示帮助信息 | - |

### 常用部署示例

```bash
# 非交互式部署（使用所有默认值）
./deploy.sh -y

# 部署开发分支到自定义端口
./deploy.sh -b dev -p 8080 -y

# 生产环境部署，启用 HTTPS
./deploy.sh --domain hub.example.com -y

# 仅启用 HTTP 反向代理（无 HTTPS）
./deploy.sh --enable-caddy -y

# 指定管理员令牌（至少 16 位字符）
./deploy.sh -t "my-secure-token-min-16-chars" -y
```

Windows PowerShell 示例：

```powershell
.\deploy.ps1 -Yes
.\deploy.ps1 -Branch dev -Port 8080 -Yes
.\deploy.ps1 -Domain "hub.example.com" -Yes
```

---

## 部署目录

脚本会在不同操作系统上使用默认的部署路径：

| 系统 | 默认路径 | 说明 |
| --- | --- | --- |
| **Linux** | `/www/compose/claude-code-hub` | 需要 root 权限创建 |
| **macOS** | `~/Applications/claude-code-hub` | 用户目录 |
| **Windows** | `C:\ProgramData\claude-code-hub` | 系统数据目录 |

你可以通过 `--deploy-dir` 选项指定自定义路径。

---

## 部署流程

脚本执行时会完成以下步骤：

```
1. 解析命令行参数
2. 检测操作系统
3. 验证输入参数
4. 检查/安装 Docker
5. 选择部署分支
6. 生成安全密钥
7. 创建目录结构
8. 写入配置文件
9. 启动服务
10. 健康检查并显示结果
```

整个流程通常需要 2-5 分钟，具体时间取决于网络状况。

---

## 生成的配置文件

部署完成后，以下文件会被创建在部署目录中：

### docker-compose.yaml

定义了所有服务的容器配置：

- **postgres**：PostgreSQL 18 数据库
- **redis**：Redis 7 缓存服务
- **app**：Claude Code Hub 应用
- **caddy**：（可选）反向代理

### .env

包含应用的环境变量，权限设置为仅所有者可读写：

```bash
ADMIN_TOKEN=<自动生成的 32 位令牌>
DB_USER=postgres
DB_PASSWORD=<自动生成的 24 位密码>
DB_NAME=claude_code_hub
APP_PORT=23000
APP_URL=https://<你的域名>  # 如果指定了域名
AUTO_MIGRATE=true
ENABLE_RATE_LIMIT=true
SESSION_TTL=300
STORE_SESSION_MESSAGES=false
ENABLE_SECURE_COOKIES=true
NODE_ENV=production
TZ=Asia/Shanghai
LOG_LEVEL=info
```

{% callout type="warning" title="保管好 .env 文件" %}
`.env` 文件包含敏感信息，请妥善保管。Linux/macOS 上权限为 600，Windows 上设置了 ACL 限制。
{% /callout %}

### Caddyfile（可选）

当启用 `--enable-caddy` 或指定 `--domain` 时生成：

**HTTPS 模式**（带域名）：
```caddyfile
hub.example.com {
    reverse_proxy app:23000
    encode gzip
}
```

**HTTP 模式**（仅 Caddy）：
```caddyfile
:80 {
    reverse_proxy app:23000
    encode gzip
}
```

---

## 部署后操作

### 查看服务状态

```bash
cd <部署目录>
docker compose ps
```

### 查看日志

```bash
# 查看所有服务日志
docker compose logs -f

# 查看特定服务日志
docker compose logs -f app
```

### 停止服务

```bash
docker compose down
```

### 重启服务

```bash
docker compose restart
```

### 更新到最新版本

```bash
# 拉取最新镜像
docker compose pull

# 重启服务
docker compose up -d
```

### 访问数据库

```bash
docker compose exec postgres psql -U postgres -d claude_code_hub
```

### 访问 Redis

```bash
docker compose exec redis redis-cli
```

---

## 访问应用

部署完成后，脚本会显示访问地址：

- **本地访问**：`http://localhost:23000`
- **网络访问**：`http://<服务器IP>:23000`
- **HTTPS 访问**：`https://<你的域名>`（如果启用了域名）

首次登录需要使用部署时生成的 `ADMIN_TOKEN` 作为管理员密码。

---

## 故障排查

### 端口冲突

如果指定的端口已被占用，Docker Compose 会启动失败。解决方法：

1. 停止现有服务释放端口
2. 或使用 `--port` 指定其他端口重新部署

### 健康检查超时

如果 60 秒内服务未就绪，脚本会显示警告。你可以：

```bash
# 检查服务状态
docker compose ps

# 查看详细日志
docker compose logs
```

### Docker 未安装（Linux）

脚本会自动尝试安装 Docker。如果失败，请手动安装：

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
```

然后重新登录或重启系统。

### 权限问题（Linux）

如果在 Linux 上遇到权限错误，确保使用 sudo 运行：

```bash
sudo ./deploy.sh
```

---

## 升级指南

要升级到最新版本：

```bash
# 进入部署目录
cd <部署目录>

# 拉取最新镜像
docker compose pull

# 重启服务
docker compose up -d

# 验证状态
docker compose ps
```

数据会保留在 `./data` 目录中，升级不会丢失。

---

## 安全建议

1. **修改默认令牌**：生产环境建议设置强密码
2. **启用 HTTPS**：使用 `--domain` 启用自动 HTTPS
3. **防火墙配置**：仅开放必要的端口（80/443/23000）
4. **定期备份**：备份 `./data` 目录和 `.env` 文件

---

{% quick-links %}
{% quick-link title="Docker Compose 部署" href="/docs/deployment/docker-compose" description="手动 Docker Compose 部署指南" /%}
{% quick-link title="配置指南" href="/docs/configuration" description="了解所有配置选项" /%}
{% quick-link title="客户端设置" href="/docs/client-setup" description="配置 Claude Code 等客户端" /%}
{% /quick-links %}
