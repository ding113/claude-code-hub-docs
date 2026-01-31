---
dimensions:
  type:
    primary: getting-started
    detail: guide
  level: beginner
standard_title: 客户端接入
language: zh
---

# 客户端接入

Claude Code Hub (CCH) 支持多种主流 AI 编程助手工具的接入。本指南提供各客户端的完整安装、配置和使用说明。

{% callout type="note" title="获取 API Key" %}
在开始配置前，请先登录 CCH 控制台创建 API Key：**用户管理 → API 密钥管理 → 创建密钥**
{% /callout %}

---

## Claude Code

Claude Code 是 Anthropic 官方推出的 AI 编程助手，支持通过 CCH 代理服务使用。

### 环境准备

Claude Code 需要 Node.js 18 或更高版本。

{% tabs %}
{% tab label="macOS" %}

**Homebrew 安装（推荐）**

```bash
# 更新 Homebrew
brew update
# 安装 Node.js
brew install node
```

**官网下载**

1. 访问 [https://nodejs.org/](https://nodejs.org/)
2. 下载适合 macOS 的 LTS 版本（需 v18 或更高）
3. 打开下载的 .pkg 文件，按照安装向导完成

{% /tab %}
{% tab label="Windows" %}

**官网下载（推荐）**

1. 访问 [https://nodejs.org/](https://nodejs.org/)
2. 下载 LTS 版本（需 v18 或更高）
3. 双击 .msi 文件，按向导安装（保持默认设置）

**包管理器**

```powershell
# 使用 Chocolatey
choco install nodejs

# 或使用 Scoop
scoop install nodejs
```

{% callout type="note" %}
建议使用 PowerShell 而不是 CMD，以获得更好的体验。
{% /callout %}

{% /tab %}
{% tab label="Linux" %}

**官方仓库（推荐）**

```bash
# 添加 NodeSource 仓库
curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
# 安装 Node.js
sudo apt-get install -y nodejs
```

**系统包管理器**

```bash
# Ubuntu/Debian
sudo apt update
sudo apt install nodejs npm

# CentOS/RHEL/Fedora
sudo dnf install nodejs npm
```

{% /tab %}
{% /tabs %}

**验证安装**

```bash
node --version
npm --version
```

如果显示版本号，说明安装成功。

### 安装 Claude Code

{% tabs %}
{% tab label="Native Install（推荐）" %}

官方推荐使用 Native 安装方式，具有以下优势：

- 单个可执行文件，无需 Node.js 依赖
- 自动更新机制更稳定
- 启动速度更快

**macOS**

```bash
# Homebrew（推荐）
brew install --cask claude-code

# 或使用 curl 脚本
# 安装稳定版（默认）
curl -fsSL https://claude.ai/install.sh | bash

# 安装最新版
curl -fsSL https://claude.ai/install.sh | bash -s latest

# 安装指定版本
curl -fsSL https://claude.ai/install.sh | bash -s 1.0.58
```

{% callout type="note" title="自动更新说明" %}
通过 Homebrew 安装的 Claude Code 会在 brew 目录外自动更新，除非使用 `DISABLE_AUTOUPDATER` 环境变量显式禁用。
{% /callout %}

**Linux**

```bash
# 安装稳定版（默认）
curl -fsSL https://claude.ai/install.sh | bash

# 安装最新版
curl -fsSL https://claude.ai/install.sh | bash -s latest
```

{% callout type="warning" title="Alpine Linux" %}
基于 musl/uClibc 的发行版（如 Alpine Linux）需要安装额外依赖：

```bash
apk add libgcc libstdc++ ripgrep
export USE_BUILTIN_RIPGREP=0
```
{% /callout %}

**Windows**

```powershell
# PowerShell - 安装稳定版
irm https://claude.ai/install.ps1 | iex

# PowerShell - 安装最新版
& ([scriptblock]::Create((irm https://claude.ai/install.ps1))) latest
```

```batch
REM CMD - 安装稳定版
curl -fsSL https://claude.ai/install.cmd -o install.cmd && install.cmd && del install.cmd
```

{% /tab %}
{% tab label="NPM" %}

使用 NPM 安装需要先安装 Node.js 18 或更高版本。

```bash
npm install -g @anthropic-ai/claude-code
```

{% callout type="warning" %}
不要使用 `sudo npm install -g`，这可能导致权限问题和安全风险。如果遇到权限错误，请参考 NPM 官方解决方案。
{% /callout %}

**迁移到 Native Install**

如果你已通过 NPM 全局安装，可以使用以下命令迁移：

```bash
claude install
```

{% /tab %}
{% /tabs %}

**验证安装**

```bash
claude --version
```

{% callout type="note" %}
安装前请确保移除任何过期的别名或符号链接。使用 `claude doctor` 命令可以检查安装类型和版本。
{% /callout %}

### 连接 CCH 服务

{% tabs %}
{% tab label="配置文件（推荐）" %}

编辑 `~/.claude/settings.json`（Windows: `C:\Users\你的用户名\.claude\settings.json`）：

```json
{
  "env": {
    "ANTHROPIC_AUTH_TOKEN": "your-api-key-here",
    "ANTHROPIC_BASE_URL": "https://your-cch-domain.com",
    "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC": "1"
  },
  "permissions": {
    "allow": [],
    "deny": []
  }
}
```

{% callout type="note" title="路径说明" %}
- Windows：`C:/Users/你的用户名/.claude`
- Linux 或 macOS：`~/.claude`
- 如果 `settings.json` 文件不存在，请自行创建
{% /callout %}

{% callout type="warning" title="重要提示" %}
- 将 `your-api-key-here` 替换为您的实际 API 密钥
- 密钥获取方式：登录控制台 → API 密钥管理 → 创建密钥
{% /callout %}

{% /tab %}
{% tab label="环境变量" %}

**macOS / Linux**

临时设置（当前会话）：

```bash
export ANTHROPIC_BASE_URL="https://your-cch-domain.com"
export ANTHROPIC_AUTH_TOKEN="your-api-key-here"
```

永久设置（添加到 `~/.zshrc` 或 `~/.bashrc`）：

```bash
echo 'export ANTHROPIC_BASE_URL="https://your-cch-domain.com"' >> ~/.zshrc
echo 'export ANTHROPIC_AUTH_TOKEN="your-api-key-here"' >> ~/.zshrc
source ~/.zshrc
```

**Windows**

临时设置（当前会话）：

```powershell
$env:ANTHROPIC_BASE_URL = "https://your-cch-domain.com"
$env:ANTHROPIC_AUTH_TOKEN = "your-api-key-here"
```

永久设置（用户级）：

```powershell
[System.Environment]::SetEnvironmentVariable("ANTHROPIC_BASE_URL", "https://your-cch-domain.com", [System.EnvironmentVariableTarget]::User)
[System.Environment]::SetEnvironmentVariable("ANTHROPIC_AUTH_TOKEN", "your-api-key-here", [System.EnvironmentVariableTarget]::User)
```

设置后需要重新打开 PowerShell 窗口才能生效。

{% /tab %}
{% /tabs %}

**验证配置**

```bash
echo $ANTHROPIC_BASE_URL
echo $ANTHROPIC_AUTH_TOKEN
```

预期输出：

```
https://your-cch-domain.com
sk_xxxxxxxxxxxxxxxxxx
```

### VS Code 扩展配置

1. 在 VS Code 扩展中搜索并安装 **Claude Code for VS Code**
2. 在 `~/.claude` 目录下创建 `config.json` 文件（如果没有）
3. 添加以下内容：

```jsonc
// Path: ~/.claude/config.json
{
  "primaryApiKey": "any-value"
}
```

{% callout type="note" %}
- 是 `config.json`，不是 `settings.json`
- `primaryApiKey` 字段值可以为任意内容，只要存在即可
{% /callout %}

### 启动 Claude Code

```bash
cd /path/to/your/project
claude
```

首次启动时，Claude Code 会进行初始化配置。

---

## Codex CLI

Codex 是 OpenAI 官方的命令行 AI 编程助手，支持通过 CCH 代理使用。

{% callout type="warning" %}
Codex 使用 OpenAI 兼容格式，端点需要包含 `/v1` 路径。
{% /callout %}

### 安装 Codex

```bash
npm i -g @openai/codex --registry=https://registry.npmmirror.com
```

验证安装：

```bash
codex --version
```

### 连接 CCH 服务

在 `~/.codex`（Windows: `C:\Users\你的用户名\.codex`）目录下创建配置文件。

{% tabs %}
{% tab label="配置文件方式" %}

**config.toml**

```toml
model_provider = "cch"
model = "gpt-5.2"
model_reasoning_effort = "xhigh"
disable_response_storage = true
sandbox_mode = "workspace-write"

[features]
plan_tool = true
apply_patch_freeform = true
view_image_tool = true
web_search_request = true
unified_exec = false
streamable_shell = false
rmcp_client = true

[model_providers.cch]
name = "cch"
base_url = "https://your-cch-domain.com/v1"
wire_api = "responses"
requires_openai_auth = true

[sandbox_workspace_write]
network_access = true
```

**auth.json**

```json
{
  "OPENAI_API_KEY": "your-api-key-here"
}
```

{% callout type="note" %}
此方式通过 `auth.json` 文件存储 API 密钥，`config.toml` 中无需配置 `env_key` 字段。
{% /callout %}

{% /tab %}
{% tab label="环境变量方式" %}

**config.toml**（需要添加 `env_key` 字段）

```toml
model_provider = "cch"
model = "gpt-5.2"
model_reasoning_effort = "xhigh"
disable_response_storage = true
sandbox_mode = "workspace-write"

[features]
plan_tool = true
apply_patch_freeform = true
view_image_tool = true
web_search_request = true
unified_exec = false
streamable_shell = false
rmcp_client = true

[model_providers.cch]
name = "cch"
base_url = "https://your-cch-domain.com/v1"
wire_api = "responses"
env_key = "CCH_API_KEY"
requires_openai_auth = true

[sandbox_workspace_write]
network_access = true
```

**设置环境变量**

macOS / Linux：

```bash
echo 'export CCH_API_KEY="your-api-key-here"' >> ~/.zshrc
source ~/.zshrc
```

Windows：

```powershell
[System.Environment]::SetEnvironmentVariable("CCH_API_KEY", "your-api-key-here", [System.EnvironmentVariableTarget]::User)
```

{% /tab %}
{% /tabs %}

{% callout type="warning" title="重要提示" %}
- 将 `your-api-key-here` 替换为您的 CCH API 密钥
- Codex 使用 OpenAI 兼容格式，端点包含 `/v1` 路径
{% /callout %}

### VS Code 扩展配置

1. 在 VS Code 扩展中搜索并安装 **Codex – OpenAI's coding agent**
2. 确保已按照上述步骤配置好 `config.toml` 和 `auth.json`
3. 设置环境变量 `CCH_API_KEY`

{% callout type="warning" %}
`env_key` 只能是环境变量名称（如 `CCH_API_KEY`），不能是完整的密钥。如果直接填写密钥，会报错找不到令牌或令牌配置错误。
{% /callout %}

### 启动 Codex

```bash
cd /path/to/your/project
codex
```

---

## Gemini CLI

Gemini CLI 是 Google 官方的 AI 编程助手命令行工具，支持通过 CCH 代理服务使用。

### 安装 Gemini CLI

```bash
npm install -g @google/gemini-cli
```

验证安装：

```bash
gemini --version
```

### 连接 CCH 服务

{% tabs %}
{% tab label="配置文件（推荐）" %}

**创建配置目录**

```bash
# macOS / Linux
mkdir -p ~/.gemini

# Windows (PowerShell)
mkdir $env:USERPROFILE\.gemini
```

**创建 .env 文件**

在 `~/.gemini/.env` 中添加：

```bash
GOOGLE_GEMINI_BASE_URL=https://your-cch-domain.com
GEMINI_API_KEY=your-api-key-here
GEMINI_MODEL=gemini-3-pro-preview
```

**创建 settings.json 文件**

在 `~/.gemini/settings.json` 中添加：

```json
{
  "ide": {
    "enabled": true
  },
  "security": {
    "auth": {
      "selectedType": "gemini-api-key"
    }
  }
}
```

{% callout type="note" title="参数说明" %}
- `GOOGLE_GEMINI_BASE_URL`: CCH API 基础地址
- `GEMINI_API_KEY`: 您在 CCH 控制台创建的 API 密钥
- `GEMINI_MODEL`: 使用的模型（默认为 gemini-2.5-pro）
{% /callout %}

{% /tab %}
{% tab label="环境变量" %}

如果您只想临时使用，可以通过环境变量配置：

**macOS / Linux**

```bash
export GOOGLE_GEMINI_BASE_URL="https://your-cch-domain.com"
export GEMINI_API_KEY="your-api-key-here"
export GEMINI_MODEL="gemini-2.5-pro"
```

**Windows (PowerShell)**

```powershell
$env:GOOGLE_GEMINI_BASE_URL="https://your-cch-domain.com"
$env:GEMINI_API_KEY="your-api-key-here"
$env:GEMINI_MODEL="gemini-2.5-pro"
```

环境变量只在当前终端会话中有效。如需持久化配置，请使用配置文件方式。

{% /tab %}
{% /tabs %}

### 启动和验证

```bash
cd /path/to/your/project
gemini
```

在 Gemini CLI 中尝试发送一个简单的请求测试连接：

```
你好，请帮我创建一个 Python 的 hello world 程序
```

**Agent Mode**

Gemini CLI 支持 Agent Mode，可以自动规划和执行复杂任务：

```bash
gemini --agent
```

在 Agent Mode 下，Gemini 会：

- 自动分析任务需求
- 制定执行计划
- 逐步执行并验证结果
- 根据反馈调整策略

---

## OpenCode

OpenCode 是一款在终端中运行的 CLI + TUI AI 编程代理工具，支持接入多种模型。

### 安装 OpenCode

{% tabs %}
{% tab label="macOS" %}

**官方安装脚本（推荐）**

```bash
curl -fsSL https://opencode.ai/install | bash
```

**Homebrew**

```bash
brew install anomalyco/tap/opencode
```

**npm**

```bash
npm install -g opencode-ai
```

**Bun**

```bash
bun add -g opencode-ai
```

{% /tab %}
{% tab label="Linux" %}

**官方安装脚本（推荐）**

```bash
curl -fsSL https://opencode.ai/install | bash
```

**Homebrew**

```bash
brew install anomalyco/tap/opencode
```

**npm**

```bash
npm install -g opencode-ai
```

**Paru（Arch Linux）**

```bash
paru -S opencode-bin
```

{% /tab %}
{% tab label="Windows" %}

**Chocolatey**

```powershell
choco install opencode
```

**Scoop**

```powershell
scoop bucket add extras
scoop install extras/opencode
```

**npm**

```powershell
npm install -g opencode-ai
```

{% callout type="note" %}
不建议通过 npm 镜像源/第三方 registry 安装 opencode-ai，可能会导致依赖缺失；如遇问题请改用官方 npm registry。
{% /callout %}

{% /tab %}
{% /tabs %}

### 连接 CCH 服务

配置文件路径：`~/.config/opencode/opencode.json`（Windows: `%USERPROFILE%\.config\opencode\opencode.json`）

```json
{
  "$schema": "https://opencode.ai/config.json",
  "theme": "opencode",
  "autoupdate": false,
  "model": "openai/gpt-5.2",
  "small_model": "openai/gpt-5.2-small",
  "provider": {
    "cchClaude": {
      "npm": "@ai-sdk/anthropic",
      "name": "Claude via cch",
      "options": {
        "baseURL": "https://your-cch-domain.com/v1",
        "apiKey": "{env:CCH_API_KEY}"
      },
      "models": {
        "claude-haiku-4-5-20251001": { "name": "Claude Haiku 4.5" },
        "claude-sonnet-4-5-20250929": { "name": "Claude Sonnet 4.5" },
        "claude-opus-4-5-20251101": { "name": "Claude Opus 4.5" }
      }
    },
    "cchGPT": {
      "npm": "@ai-sdk/openai",
      "name": "GPT via cch",
      "options": {
        "baseURL": "https://your-cch-domain.com/v1",
        "apiKey": "{env:CCH_API_KEY}",
        "store": false,
        "setCacheKey": true
      },
      "models": {
        "gpt-5.2": {
          "name": "GPT-5.2",
          "options": {
            "reasoningEffort": "xhigh",
            "store": false,
            "include": ["reasoning.encrypted_content"]
          }
        },
        "gpt-5.2-small": {
          "id": "gpt-5.2",
          "name": "GPT-5.2 Small",
          "options": {
            "reasoningEffort": "medium",
            "store": false,
            "include": ["reasoning.encrypted_content"]
          }
        }
      }
    },
    "cchGemini": {
      "npm": "@ai-sdk/google",
      "name": "Gemini via cch",
      "options": {
        "baseURL": "https://your-cch-domain.com/v1beta",
        "apiKey": "{env:CCH_API_KEY}"
      },
      "models": {
        "gemini-3-pro-preview": { "name": "Gemini 3 Pro Preview" },
        "gemini-3-flash-preview": { "name": "Gemini 3 Flash Preview" }
      }
    }
  }
}
```

{% callout type="warning" title="重要说明" %}
- 请先在 CCH 后台创建 API Key，并设置环境变量 `CCH_API_KEY`
- cchClaude/cchGPT 使用 `/v1`，cchGemini 使用 `/v1beta`
- 模型选择时使用 `provider_id/model_id` 格式
{% /callout %}

### 启动 OpenCode

```bash
cd /path/to/your/project
opencode
```

在 TUI 中输入 `/models` 查看/选择模型。

---

## Droid CLI

Droid 是 Factory AI 开发的交互式终端 AI 编程助手，支持通过 CCH 代理服务使用。

{% callout type="warning" %}
使用前必须先注册并登录 Droid 官方账号。
{% /callout %}

### 安装 Droid

**macOS / Linux**

```bash
curl -fsSL https://app.factory.ai/cli | sh
```

Linux 用户需确保已安装 xdg-utils：

```bash
sudo apt-get install xdg-utils
```

**Windows (PowerShell)**

```powershell
irm https://app.factory.ai/cli/windows | iex
```

### 连接 CCH 服务

**前置步骤：必须先登录 Droid 官方账号**

1. 运行 `droid` 命令
2. 按提示通过浏览器登录 Factory 官方账号
3. 登录成功后，才能继续配置自定义模型

**配置自定义模型**

编辑 `~/.factory/config.json`（Windows: `%USERPROFILE%\.factory\config.json`）：

```json
{
  "custom_models": [
    {
      "model_display_name": "Sonnet 4.5 [cch]",
      "model": "claude-sonnet-4-5-20250929",
      "base_url": "https://your-cch-domain.com",
      "api_key": "your-api-key-here",
      "provider": "anthropic"
    },
    {
      "model_display_name": "GPT-5.2 [cch]",
      "model": "gpt-5.2",
      "base_url": "https://your-cch-domain.com/v1",
      "api_key": "your-api-key-here",
      "provider": "openai"
    }
  ]
}
```

{% callout type="warning" title="重要说明" %}
- Anthropic 格式：使用 `https://your-cch-domain.com`（无 `/v1`）
- OpenAI 格式：使用 `https://your-cch-domain.com/v1`（需要 `/v1`）
{% /callout %}

**切换模型**

1. 重启 Droid
2. 输入 `/model` 命令
3. 选择 `GPT-5-Codex [cch]` 或 `Sonnet 4.5 [cch]`
4. 开始使用！

---

## 常用命令

启动 CLI 工具后，可以使用以下常用命令：

| 命令 | 说明 |
|------|------|
| `/help` | 查看帮助信息 |
| `/clear` | 清空对话历史，开启新对话 |
| `/compact` | 总结当前对话 |
| `/cost` | 查看当前对话已使用的金额 |
| `/model` | 切换模型（Droid 专用） |

更多命令请查看 [Claude Code 官方文档](https://docs.claude.com/zh-CN/docs/claude-code/overview)。

---

## 通用故障排查

### 安装失败

- 检查网络连接是否正常
- 确保有管理员权限（Windows）或使用 sudo（macOS / Linux）
- 尝试使用代理或镜像源（npm 可使用 `--registry` 参数）

### API 密钥无效

- 确认密钥已正确复制（无多余空格）
- 检查密钥是否在有效期内
- 验证账户权限是否正常
- 确认使用了正确的端点格式（Anthropic 无 `/v1`，OpenAI 有 `/v1`）

### 端点配置错误

| 客户端 | 正确的端点格式 |
|--------|----------------|
| Claude Code / Droid Anthropic | `https://your-cch-domain.com`（无 `/v1`） |
| Codex / Droid OpenAI | `https://your-cch-domain.com/v1`（必须包含 `/v1`） |
| Gemini CLI | `https://your-cch-domain.com`（无 `/v1`） |
| OpenCode (Claude/GPT) | `https://your-cch-domain.com/v1` |
| OpenCode (Gemini) | `https://your-cch-domain.com/v1beta` |

### 命令未找到

**Windows**

- 确保 npm 全局路径（通常是 `C:\Users\你的用户名\AppData\Roaming\npm`）已添加到系统 PATH
- 重新打开 PowerShell 窗口

**macOS / Linux**

```bash
# 检查 npm 全局安装路径
npm config get prefix

# 添加到 PATH（如果不在）
echo 'export PATH="$HOME/.npm-global/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc
```

---

## 下一步

配置好客户端后，你可以：

{% quick-links %}
{% quick-link title="API Key 管理" href="/docs/users/api-keys" description="了解如何创建和管理 API Key" /%}
{% quick-link title="智能路由" href="/docs/proxy/intelligent-routing" description="了解请求如何被路由到供应商" /%}
{% quick-link title="监控仪表盘" href="/docs/monitoring/dashboard" description="查看调用统计和成本分析" /%}
{% /quick-links %}
