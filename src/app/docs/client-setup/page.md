---
dimensions:
  type:
    primary: getting-started
    detail: configuration
  level: beginner
standard_title: 客户端接入
language: zh
---

# 客户端接入

完整的 Claude Code、Codex、Gemini CLI 和 Droid CLI 集成指南。 {% .lead %}

---

## 前置条件

在开始配置客户端之前，请确保：

1. CCH 服务已成功部署并运行
2. 已在管理后台创建至少一个用户和 API Key
3. 已添加并启用至少一个上游供应商

{% callout title="API Key 获取方式" %}
登录 CCH 管理后台，进入「用户管理」页面，选择目标用户后点击「添加密钥」创建新的 API Key。创建后请立即复制保存，密钥仅在创建时显示一次。
{% /callout %}

---

## Claude Code 使用指南

Claude Code 是 Anthropic 官方推出的 AI 编程助手，支持通过 CCH 代理服务使用。本指南将帮助您在不同操作系统上完成安装和配置。

### macOS

#### 环境准备：安装 Node.js

Claude 需要 Node.js 环境才能运行（需 v18 或更高版本）。

**方法一：使用 Homebrew（推荐）**

```bash
# 更新 Homebrew
brew update
# 安装 Node.js
brew install node
```

**方法二：官网下载**

1. 访问 [https://nodejs.org/](https://nodejs.org/)
2. 下载适合 macOS 的 LTS 版本（需 v18 或更高）
3. 打开下载的 .pkg 文件，按照安装向导完成

**验证 Node.js 安装**

安装完成后，打开终端，输入以下命令验证：

```bash
node --version
npm --version
```

如果显示版本号，说明安装成功了！

#### 安装 Claude Code

{% tabs %}

{% tab label="Native Install（推荐）" %}

官方推荐使用 Native 安装方式，具有以下优势：

- 单个可执行文件，无需 Node.js 依赖
- 自动更新机制更稳定
- 启动速度更快

**方法一：Homebrew（推荐）**

```bash
brew install --cask claude-code
```

{% callout title="自动更新说明" %}
通过 Homebrew 安装的 Claude Code 会在 brew 目录外自动更新，除非使用 DISABLE_AUTOUPDATER 环境变量显式禁用。
{% /callout %}

**方法二：curl 脚本**

```bash
# 安装稳定版（默认）
curl -fsSL https://claude.ai/install.sh | bash

# 安装最新版
curl -fsSL https://claude.ai/install.sh | bash -s latest

# 安装指定版本
curl -fsSL https://claude.ai/install.sh | bash -s 1.0.58
```

**验证安装**

```bash
claude --version
```

如果显示版本号，恭喜！Claude Code 已成功安装。

{% callout title="提示" %}
安装前请确保移除任何过期的别名或符号链接。使用 `claude doctor` 命令可以检查安装类型和版本。
{% /callout %}

{% /tab %}

{% tab label="NPM" %}

使用 NPM 安装需要先安装 Node.js 18 或更高版本。适合偏好使用 NPM 管理工具的开发者。

```bash
npm install -g @anthropic-ai/claude-code
```

{% callout type="warning" title="警告" %}
不要使用 `sudo npm install -g`，这可能导致权限问题和安全风险。如果遇到权限错误，请参考 NPM 官方解决方案。
{% /callout %}

**验证安装**

```bash
claude --version
```

如果显示版本号，恭喜！Claude Code 已成功安装。

**迁移到 Native Install**

如果你已通过 NPM 全局安装，可以使用以下命令迁移到 Native 安装：

```bash
claude install
```

部分用户可能会被自动迁移到这种安装方式。

{% /tab %}

{% /tabs %}

#### 连接 CCH 服务

**方法一：settings.json 配置（推荐）**

配置文件路径：`~/.claude/settings.json`

{% callout title="路径说明" %}
- macOS / Linux：`~/.claude`
- 如果 settings.json 文件不存在，请自行创建
{% /callout %}

编辑 settings.json 文件，添加以下内容：

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

{% callout title="重要提示" %}
- 将 `your-api-key-here` 替换为您的实际 API 密钥
- 将 `https://your-cch-domain.com` 替换为您的 CCH 服务地址
- 密钥获取方式：登录控制台 → API 密钥管理 → 创建密钥
{% /callout %}

**方法二：环境变量配置**

临时设置（当前会话）：

```bash
export ANTHROPIC_BASE_URL="https://your-cch-domain.com"
export ANTHROPIC_AUTH_TOKEN="your-api-key-here"
```

永久设置，添加到您的 shell 配置文件（~/.zshrc 或 ~/.bash_profile）：

```bash
echo 'export ANTHROPIC_BASE_URL="https://your-cch-domain.com"' >> ~/.zshrc
echo 'export ANTHROPIC_AUTH_TOKEN="your-api-key-here"' >> ~/.zshrc
source ~/.zshrc
```

**验证配置**

配置完成后,验证环境变量是否设置成功:

```bash
echo $ANTHROPIC_BASE_URL
echo $ANTHROPIC_AUTH_TOKEN
```

预期输出示例:

```text
https://your-cch-domain.com
sk_xxxxxxxxxxxxxxxxxx
```

{% callout type="note" title="注意" %}
如果输出为空或显示变量名本身,说明环境变量设置失败,请重新按照上述步骤设置。
{% /callout %}

#### 跳过首次登录引导

新版 Claude Code 全新安装后,即使已正确配置 `settings.json`,首次启动仍会要求登录 Anthropic 账号。这是因为 Claude Code 需要完成首次使用引导(onboarding)流程。

**解决方案:**

在 `~/.claude.json` 文件中添加以下配置(如果文件不存在,请创建):

```json
{
  "hasCompletedOnboarding": true
}
```

{% callout type="note" title="配置文件说明" %}
- `~/.claude.json` 是 Claude Code 的全局状态文件,与 `~/.claude/settings.json` 不同
- 此配置告诉 Claude Code 跳过首次登录引导流程
- macOS/Linux: `~/.claude.json`
- Windows: `C:\Users\你的用户名\.claude.json`
{% /callout %}

**完整配置示例:**

如果 `.claude.json` 文件已存在,请在最后添加 `hasCompletedOnboarding` 字段:

```json
{
  "installMethod": "unknown",
  "autoUpdates": true,
  "firstStartTime": "2025-07-14T06:11:03.877Z",
  "userID": "f5afdd05117c901a4a5a0761d08230bfcbb76f9fd380ff7bc144cc12c52e55aa",
  "projects": {
    "/home/nassi": {
      "allowedTools": [],
      "history": [],
      "mcpContextUris": [],
      "mcpServers": {},
      "enabledMcpjsonServers": [],
      "disabledMcpjsonServers": [],
      "hasTrustDialogAccepted": false,
      "projectOnboardingSeenCount": 0,
      "hasClaudeMdExternalIncludesApproved": false,
      "hasClaudeMdExternalIncludesWarningShown": false
    }
  },
  "hasCompletedOnboarding": true
}
```

{% callout type="warning" title="JSON 语法注意事项" %}
- 在添加新字段前,确保上一行末尾有逗号(`,`)
- JSON 不支持注释,请删除所有注释内容
- 使用标准的 JSON 格式,字段名必须用双引号包裹
{% /callout %}

#### VS Code 扩展配置

1. 在 VS Code 扩展中搜索并安装 Claude Code for VS Code
2. 在 ~/.claude 目录下创建 config.json 文件（如果没有）
3. 添加以下内容：

```jsonc
// Path: ~/.claude/config.json
{
  "primaryApiKey": "any-value"
}
```

{% callout title="注意" %}
- 是 config.json，不是 settings.json
- primaryApiKey 字段值可以为任意内容，只要存在即可
{% /callout %}

#### 启动 Claude Code

在项目目录下运行：

```bash
cd /path/to/your/project
claude
```

首次启动时，Claude 会进行初始化配置。

#### 常见问题

**1. 命令未找到**

```bash
# 检查 npm 全局安装路径并添加到 PATH（如果不在）
npm config get prefix

# 添加到 PATH（如果不在）
echo 'export PATH="$HOME/.npm-global/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc
```

**2. API 连接失败**

```bash
# 检查环境变量
echo $ANTHROPIC_AUTH_TOKEN

# 测试网络连接
curl -I https://your-cch-domain.com
```

**3. 更新 Claude Code**

重新运行安装脚本即可更新到最新版本。

---

### Windows

#### 环境准备：安装 Node.js

**方法一：官网下载（推荐）**

1. 访问 [https://nodejs.org/](https://nodejs.org/)
2. 下载 LTS 版本（需 v18 或更高）
3. 双击 .msi 文件，按向导安装（保持默认设置）

**方法二：使用包管理器**

```powershell
# 使用 Chocolatey
choco install nodejs

# 或使用 Scoop
scoop install nodejs
```

{% callout title="提示" %}
建议使用 PowerShell 而不是 CMD，以获得更好的体验。
{% /callout %}

**验证 Node.js 安装**

```powershell
node --version
npm --version
```

如果显示版本号，说明安装成功了！

#### 安装 Claude Code

{% tabs %}

{% tab label="Native Install（推荐）" %}

**方法一：PowerShell**

```powershell
# 安装稳定版（默认）
irm https://claude.ai/install.ps1 | iex

# 安装最新版
& ([scriptblock]::Create((irm https://claude.ai/install.ps1))) latest

# 安装指定版本
& ([scriptblock]::Create((irm https://claude.ai/install.ps1))) 1.0.58
```

**方法二：CMD**

```batch
REM 安装稳定版（默认）
curl -fsSL https://claude.ai/install.cmd -o install.cmd && install.cmd && del install.cmd

REM 安装最新版
curl -fsSL https://claude.ai/install.cmd -o install.cmd && install.cmd latest && del install.cmd

REM 安装指定版本
curl -fsSL https://claude.ai/install.cmd -o install.cmd && install.cmd 1.0.58 && del install.cmd
```

**验证安装**

```powershell
claude --version
```

{% /tab %}

{% tab label="NPM" %}

```powershell
npm install -g @anthropic-ai/claude-code
```

{% callout type="warning" title="警告" %}
不要使用 `sudo npm install -g`，这可能导致权限问题和安全风险。
{% /callout %}

**验证安装**

```powershell
claude --version
```

{% /tab %}

{% /tabs %}

#### 连接 CCH 服务

**方法一：settings.json 配置（推荐）**

配置文件路径：`C:\Users\你的用户名\.claude\settings.json`

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

**方法二：环境变量配置**

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

**验证配置**

在 PowerShell 中执行：

```powershell
echo $env:ANTHROPIC_BASE_URL
echo $env:ANTHROPIC_AUTH_TOKEN
```

在 CMD 中执行：

```cmd
echo %ANTHROPIC_BASE_URL%
echo %ANTHROPIC_AUTH_TOKEN%
```

#### 跳过首次登录引导

新版 Claude Code 全新安装后,即使已正确配置 `settings.json`,首次启动仍会要求登录 Anthropic 账号。这是因为 Claude Code 需要完成首次使用引导(onboarding)流程。

**解决方案:**

在 `C:\Users\你的用户名\.claude.json` 文件中添加以下配置(如果文件不存在,请创建):

```json
{
  "hasCompletedOnboarding": true
}
```

{% callout type="note" title="配置文件说明" %}
- `.claude.json` 是 Claude Code 的全局状态文件,与 `.claude\settings.json` 不同
- 此配置告诉 Claude Code 跳过首次登录引导流程
- Windows: `C:\Users\你的用户名\.claude.json`
- macOS/Linux: `~/.claude.json`
{% /callout %}

**完整配置示例:**

如果 `.claude.json` 文件已存在,请在最后添加 `hasCompletedOnboarding` 字段:

```json
{
  "installMethod": "unknown",
  "autoUpdates": true,
  "firstStartTime": "2025-07-14T06:11:03.877Z",
  "userID": "f5afdd05117c901a4a5a0761d08230bfcbb76f9fd380ff7bc144cc12c52e55aa",
  "projects": {
    "C:\\Users\\你的用户名\\Documents": {
      "allowedTools": [],
      "history": [],
      "mcpContextUris": [],
      "mcpServers": {},
      "enabledMcpjsonServers": [],
      "disabledMcpjsonServers": [],
      "hasTrustDialogAccepted": false,
      "projectOnboardingSeenCount": 0,
      "hasClaudeMdExternalIncludesApproved": false,
      "hasClaudeMdExternalIncludesWarningShown": false
    }
  },
  "hasCompletedOnboarding": true
}
```

{% callout type="warning" title="JSON 语法注意事项" %}
- 在添加新字段前,确保上一行末尾有逗号(`,`)
- JSON 不支持注释,请删除所有注释内容
- 使用标准的 JSON 格式,字段名必须用双引号包裹
- Windows 路径中的反斜杠需要转义: `C:\\Users\\...`
{% /callout %}

#### VS Code 扩展配置

配置文件路径：`C:\Users\你的用户名\.claude\config.json`

```jsonc
{
  "primaryApiKey": "any-value"
}
```

#### 启动 Claude Code

```powershell
cd C:\path\to\your\project
claude
```

#### 常见问题

**1. 命令未找到**

- 确保 npm 全局路径（通常是 `C:\Users\你的用户名\AppData\Roaming\npm`）已添加到系统 PATH
- 重新打开 PowerShell 窗口

**2. API 连接失败**

```powershell
# 检查环境变量
echo $env:ANTHROPIC_AUTH_TOKEN

# 测试网络连接
Test-NetConnection -ComputerName your-cch-domain.com -Port 443
```

---

### Linux

#### 环境准备：安装 Node.js

**方法一：使用官方仓库（推荐）**

```bash
# 添加 NodeSource 仓库
curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
# 安装 Node.js
sudo apt-get install -y nodejs
```

**方法二：使用系统包管理器**

```bash
# Ubuntu/Debian
sudo apt update
sudo apt install nodejs npm

# CentOS/RHEL/Fedora
sudo dnf install nodejs npm
```

**验证安装**

```bash
node --version
npm --version
```

#### 安装 Claude Code

{% tabs %}

{% tab label="Native Install（推荐）" %}

```bash
# 安装稳定版（默认）
curl -fsSL https://claude.ai/install.sh | bash

# 安装最新版
curl -fsSL https://claude.ai/install.sh | bash -s latest

# 安装指定版本
curl -fsSL https://claude.ai/install.sh | bash -s 1.0.58
```

{% callout type="warning" title="Alpine Linux 特殊说明" %}
基于 musl/uClibc 的发行版（如 Alpine Linux）需要安装额外依赖：

```bash
apk add libgcc libstdc++ ripgrep
export USE_BUILTIN_RIPGREP=0
```
{% /callout %}

**验证安装**

```bash
claude --version
```

{% /tab %}

{% tab label="NPM" %}

```bash
npm install -g @anthropic-ai/claude-code
```

**验证安装**

```bash
claude --version
```

{% /tab %}

{% /tabs %}

#### 连接 CCH 服务

**方法一：settings.json 配置（推荐）**

配置文件路径：`~/.claude/settings.json`

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

**方法二：环境变量配置**

临时设置：

```bash
export ANTHROPIC_BASE_URL="https://your-cch-domain.com"
export ANTHROPIC_AUTH_TOKEN="your-api-key-here"
```

永久设置，添加到 ~/.bashrc 或 ~/.zshrc：

```bash
echo 'export ANTHROPIC_BASE_URL="https://your-cch-domain.com"' >> ~/.bashrc
echo 'export ANTHROPIC_AUTH_TOKEN="your-api-key-here"' >> ~/.bashrc
source ~/.bashrc
```

#### 跳过首次登录引导

新版 Claude Code 全新安装后,即使已正确配置 `settings.json`,首次启动仍会要求登录 Anthropic 账号。这是因为 Claude Code 需要完成首次使用引导(onboarding)流程。

**解决方案:**

在 `~/.claude.json` 文件中添加以下配置(如果文件不存在,请创建):

```json
{
  "hasCompletedOnboarding": true
}
```

{% callout type="note" title="配置文件说明" %}
- `~/.claude.json` 是 Claude Code 的全局状态文件,与 `~/.claude/settings.json` 不同
- 此配置告诉 Claude Code 跳过首次登录引导流程
- macOS/Linux: `~/.claude.json`
- Windows: `C:\Users\你的用户名\.claude.json`
{% /callout %}

**完整配置示例:**

如果 `.claude.json` 文件已存在,请在最后添加 `hasCompletedOnboarding` 字段:

```json
{
  "installMethod": "unknown",
  "autoUpdates": true,
  "firstStartTime": "2025-07-14T06:11:03.877Z",
  "userID": "f5afdd05117c901a4a5a0761d08230bfcbb76f9fd380ff7bc144cc12c52e55aa",
  "projects": {
    "/home/nassi": {
      "allowedTools": [],
      "history": [],
      "mcpContextUris": [],
      "mcpServers": {},
      "enabledMcpjsonServers": [],
      "disabledMcpjsonServers": [],
      "hasTrustDialogAccepted": false,
      "projectOnboardingSeenCount": 0,
      "hasClaudeMdExternalIncludesApproved": false,
      "hasClaudeMdExternalIncludesWarningShown": false
    }
  },
  "hasCompletedOnboarding": true
}
```

{% callout type="warning" title="JSON 语法注意事项" %}
- 在添加新字段前,确保上一行末尾有逗号(`,`)
- JSON 不支持注释,请删除所有注释内容
- 使用标准的 JSON 格式,字段名必须用双引号包裹
{% /callout %}

#### VS Code 扩展配置

---

## Codex CLI 使用指南

Codex 是 OpenAI 官方的命令行 AI 编程助手，支持通过 CCH 代理使用。注意：Codex 使用 OpenAI 兼容格式，端点需要包含 `/v1` 路径。

### macOS

#### 环境准备：安装 Node.js

（同 Claude Code 的 macOS 环境准备步骤）

#### 安装 Codex

```bash
npm i -g @openai/codex --registry=https://registry.npmmirror.com
```

验证安装：

```bash
codex --version
```

#### 连接 CCH 服务

**方法一：配置文件方式（推荐）**

1. 打开文件资源管理器，找到 `~/.codex` 文件夹（不存在则创建）
2. 创建 `config.toml` 文件
3. 使用文本编辑器打开，添加以下内容：

```toml
model_provider = "cch"
model = "gpt-5.1-codex"
model_reasoning_effort = "high"
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

4. 创建 `auth.json` 文件，添加：

```json
{
  "OPENAI_API_KEY": "your-api-key-here"
}
```

{% callout title="重要提示" %}
- 将 `your-api-key-here` 替换为您的 CCH API 密钥
- 注意：Codex 使用 OpenAI 兼容格式，端点包含 `/v1` 路径
{% /callout %}

**方法二：环境变量配置**

设置环境变量：

```bash
echo 'export CCH_API_KEY="your-api-key-here"' >> ~/.zshrc
source ~/.zshrc
```

#### VS Code 扩展配置

1. 在 VS Code 扩展中搜索并安装 Codex – OpenAI's coding agent
2. 确保已按照上述步骤配置好 config.toml 和 auth.json
3. 设置环境变量 CCH_API_KEY

{% callout title="重要" %}
env_key 只能是环境变量名称（如 CCH_API_KEY），不能是完整的密钥。如果直接填写密钥，会报错找不到令牌或令牌配置错误。
{% /callout %}

#### 启动 Codex

```bash
cd /path/to/your/project
codex
```

#### 常见问题

**1. 命令未找到**

```bash
# 检查 npm 全局安装路径并添加到 PATH（如果不在）
npm config get prefix

# 添加到 PATH（如果不在）
echo 'export PATH="$HOME/.npm-global/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc
```

**2. API 连接失败**

```bash
# 检查环境变量
echo $CCH_API_KEY

# 测试网络连接
curl -I https://your-cch-domain.com
```

**3. 更新 Codex**

```bash
npm i -g @openai/codex --registry=https://registry.npmmirror.com
```

---

### Windows

#### 安装 Codex

以管理员身份运行 PowerShell，执行：

```powershell
npm i -g @openai/codex --registry=https://registry.npmmirror.com
```

验证安装：

```powershell
codex --version
```

#### 连接 CCH 服务

**配置文件方式**

配置文件路径：`C:\Users\你的用户名\.codex`

创建 `config.toml`：

```toml
model_provider = "cch"
model = "gpt-5.1-codex"
model_reasoning_effort = "high"
disable_response_storage = true
sandbox_mode = "workspace-write"
windows_wsl_setup_acknowledged = true

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

创建 `auth.json`：

```json
{
  "OPENAI_API_KEY": "your-api-key-here"
}
```

**环境变量配置**

```powershell
[System.Environment]::SetEnvironmentVariable("CCH_API_KEY", "your-api-key-here", [System.EnvironmentVariableTarget]::User)
```

设置后需要重新打开 PowerShell 窗口才能生效。

#### 启动 Codex

```powershell
cd C:\path\to\your\project
codex
```

---

### Linux

#### 安装 Codex

```bash
npm i -g @openai/codex --registry=https://registry.npmmirror.com
```

验证安装：

```bash
codex --version
```

#### 连接 CCH 服务

配置文件路径：`~/.codex`

创建 `config.toml` 和 `auth.json`（内容同 macOS 部分）。

环境变量配置：

```bash
echo 'export CCH_API_KEY="your-api-key-here"' >> ~/.bashrc
source ~/.bashrc
```

#### 启动 Codex

```bash
cd /path/to/your/project
codex
```

---

## Gemini CLI 使用指南

{% callout type="warning" title="即将上线" %}
此功能正在开发中，尚未正式发布。
{% /callout %}

Gemini CLI 是 Google 官方的 AI 编程助手命令行工具，支持通过 CCH 代理服务使用。

### macOS

#### 环境准备：安装 Node.js

（同 Claude Code 的 macOS 环境准备步骤）

#### 安装 Gemini CLI

确保您已安装 Node.js 18 或更高版本，然后全局安装 Gemini CLI：

```bash
npm install -g @google/gemini-cli
```

验证安装：

```bash
gemini --version
```

#### 连接 CCH 服务

**方法一：配置文件方式（推荐）**

**创建配置目录**

Gemini CLI 的配置文件位于 `~/.gemini/` 目录。

```bash
mkdir -p ~/.gemini
```

**创建 .env 配置文件**

在 ~/.gemini/ 目录下创建 .env 文件：

```bash
nano ~/.gemini/.env
```

添加以下内容：

```bash
GOOGLE_GEMINI_BASE_URL=https://your-cch-domain.com
GEMINI_API_KEY=your-api-key-here
GEMINI_MODEL=gemini-3-pro-preview
```

**创建 settings.json 配置文件**

在 ~/.gemini/ 目录下创建 settings.json 文件：

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

这个配置文件启用了 IDE 集成，并设置认证方式为 API Key。

{% callout title="参数说明" %}
- `GOOGLE_GEMINI_BASE_URL`: CCH API 基础地址
- `GEMINI_API_KEY`: 您在 CCH 控制台创建的 API 密钥
- `GEMINI_MODEL`: 使用的模型（默认为 gemini-2.5-pro）
{% /callout %}

{% callout title="重要提示" %}
- 将 `your-api-key-here` 替换为您的实际 API 密钥
- 密钥获取方式：登录控制台 → API 密钥管理 → 创建密钥
{% /callout %}

**方法二：环境变量配置**

如果您只想临时使用，可以通过环境变量配置：

```bash
export GOOGLE_GEMINI_BASE_URL="https://your-cch-domain.com"
export GEMINI_API_KEY="your-api-key-here"
export GEMINI_MODEL="gemini-2.5-pro"
```

环境变量只在当前终端会话中有效。如需持久化配置，请使用配置文件方式。

#### 启动和验证

**启动 Gemini CLI**

进入您的项目目录并启动 Gemini CLI：

```bash
cd /path/to/your/project
gemini
```

首次启动时，Gemini CLI 会读取配置文件中的设置。

**验证配置**

在 Gemini CLI 中尝试发送一个简单的请求测试连接：

```text
你好，请帮我创建一个 Python 的 hello world 程序
```

如果 Gemini CLI 正常响应，说明配置成功！

**使用 Agent Mode**

Gemini CLI 支持 Agent Mode，可以自动规划和执行复杂任务：

```bash
gemini --agent
```

在 Agent Mode 下，Gemini 会：

- 自动分析任务需求
- 制定执行计划
- 逐步执行并验证结果
- 根据反馈调整策略

#### 常见问题

**1. 命令未找到**

```bash
# 检查 npm 全局安装路径并添加到 PATH（如果不在）
npm config get prefix

# 添加到 PATH（如果不在）
echo 'export PATH="$HOME/.npm-global/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc
```

**2. API 连接失败**

- 检查环境变量或配置文件中的 GEMINI_API_KEY 是否设置正确
- 验证 GOOGLE_GEMINI_BASE_URL 是否正确
- 测试网络连接

**3. 更新 Gemini CLI**

```bash
npm install -g @google/gemini-cli
```

---

### Windows

#### 安装 Gemini CLI

```powershell
npm install -g @google/gemini-cli
```

验证安装：

```powershell
gemini --version
```

#### 连接 CCH 服务

**创建配置目录**

```powershell
mkdir $env:USERPROFILE\.gemini
```

**创建 .env 配置文件**

在 `%USERPROFILE%\.gemini\` 目录下创建 .env 文件，添加：

```bash
GOOGLE_GEMINI_BASE_URL=https://your-cch-domain.com
GEMINI_API_KEY=your-api-key-here
GEMINI_MODEL=gemini-3-pro-preview
```

**创建 settings.json 配置文件**

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

**环境变量配置（临时）**

PowerShell：

```powershell
$env:GOOGLE_GEMINI_BASE_URL="https://your-cch-domain.com"
$env:GEMINI_API_KEY="your-api-key-here"
$env:GEMINI_MODEL="gemini-2.5-pro"
```

CMD：

```cmd
set GOOGLE_GEMINI_BASE_URL=https://your-cch-domain.com
set GEMINI_API_KEY=your-api-key-here
set GEMINI_MODEL=gemini-3-pro-preview
```

环境变量只在当前终端会话中有效。如需持久化配置，请使用配置文件方式。

#### 启动 Gemini CLI

```powershell
cd C:\path\to\your\project
gemini
```

---

### Linux

#### 安装 Gemini CLI

```bash
npm install -g @google/gemini-cli
```

验证安装：

```bash
gemini --version
```

#### 连接 CCH 服务

**创建配置目录**

```bash
mkdir -p ~/.gemini
```

**创建 .env 配置文件**

```bash
nano ~/.gemini/.env
```

添加：

```bash
GOOGLE_GEMINI_BASE_URL=https://your-cch-domain.com
GEMINI_API_KEY=your-api-key-here
GEMINI_MODEL=gemini-3-pro-preview
```

**创建 settings.json 配置文件**

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

#### 启动 Gemini CLI

```bash
cd /path/to/your/project
gemini
```

---

## Droid CLI 使用指南

Droid 是 Factory AI 开发的交互式终端 AI 编程助手，支持通过 CCH 代理服务使用。使用前必须先注册并登录 Droid 官方账号。

### macOS / Linux

#### 安装 Droid

```bash
curl -fsSL https://app.factory.ai/cli | sh
```

{% callout title="提示" %}
Linux 用户需确保已安装 xdg-utils：

```bash
sudo apt-get install xdg-utils
```
{% /callout %}

#### 连接 CCH 服务

{% callout type="warning" title="前置步骤：必须先登录 Droid 官方账号" %}
1. 运行 `droid` 命令
2. 按提示通过浏览器登录 Factory 官方账号
3. 登录成功后，才能继续配置自定义模型
{% /callout %}

**配置自定义模型**

配置文件路径：`~/.factory/config.json`

编辑配置文件，添加以下内容：

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
      "model_display_name": "GPT-5-Codex [cch]",
      "model": "gpt-5.1-codex",
      "base_url": "https://your-cch-domain.com/v1",
      "api_key": "your-api-key-here",
      "provider": "openai"
    }
  ]
}
```

{% callout title="重要说明" %}
- 将 `your-api-key-here` 替换为您的 CCH API 密钥
- Anthropic 格式：使用 `https://your-cch-domain.com`（无 /v1）
- OpenAI 格式：使用 `https://your-cch-domain.com/v1`（需要 /v1）
{% /callout %}

**切换模型**

1. 重启 Droid
2. 输入 `/model` 命令
3. 选择 GPT-5-Codex [cch] 或 Sonnet 4.5 [cch]
4. 开始使用！

#### 启动 Droid

```bash
cd /path/to/your/project
droid
```

#### 常见问题

**1. 命令未找到**

```bash
# 检查 npm 全局安装路径并添加到 PATH（如果不在）
npm config get prefix

# 添加到 PATH（如果不在）
echo 'export PATH="$HOME/.npm-global/bin:$PATH"' >> ~/.bashrc
source ~/.bashrc
```

---

### Windows

#### 安装 Droid

在 PowerShell 中执行：

```powershell
irm https://app.factory.ai/cli/windows | iex
```

#### 连接 CCH 服务

{% callout type="warning" title="前置步骤：必须先登录 Droid 官方账号" %}
1. 运行 `droid` 命令
2. 按提示通过浏览器登录 Factory 官方账号
3. 登录成功后，才能继续配置自定义模型
{% /callout %}

**配置自定义模型**

配置文件路径：`%USERPROFILE%\.factory\config.json`

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
      "model_display_name": "GPT-5-Codex [cch]",
      "model": "gpt-5.1-codex",
      "base_url": "https://your-cch-domain.com/v1",
      "api_key": "your-api-key-here",
      "provider": "openai"
    }
  ]
}
```

#### 启动 Droid

```powershell
cd C:\path\to\your\project
droid
```

#### 常见问题

**1. 命令未找到**

- 确保 npm 全局路径（通常是 `C:\Users\你的用户名\AppData\Roaming\npm`）已添加到系统 PATH
- 重新打开 PowerShell 窗口

---

## 常用命令

启动 Claude Code 后，您可以使用以下常用命令：

| 命令 | 说明 |
|------|------|
| `/help` | 查看帮助信息 |
| `/clear` | 清空对话历史，开启新对话 |
| `/compact` | 总结当前对话 |
| `/cost` | 查看当前对话已使用的金额 |
| `/model` | 切换模型（Droid 专用） |

更多命令查看 [官方文档](https://docs.claude.com/zh-CN/docs/claude-code/overview)

---

## 通用故障排查

### 安装失败

- 检查网络连接是否正常
- 确保有管理员权限（Windows）或使用 sudo（macOS / Linux）
- 尝试使用代理或镜像源（npm 可使用 --registry 参数）

### API 密钥无效

- 确认密钥已正确复制（无多余空格）
- 检查密钥是否在有效期内
- 验证账户权限是否正常
- 确认使用了正确的端点格式（Anthropic 无 /v1，OpenAI 有 /v1）

### 端点配置错误

- Claude Code / Droid Anthropic 模型：使用 `https://your-cch-domain.com`（无 /v1）
- Codex / Droid OpenAI 模型：使用 `https://your-cch-domain.com/v1`（必须包含 /v1）

---

## 认证方式

CCH 支持多种认证头格式，兼容不同客户端：

| 认证头 | 格式 | 适用客户端 |
|--------|------|-----------|
| `Authorization` | `Bearer {api_key}` | 通用标准 |
| `x-api-key` | `{api_key}` | Claude Code |
| `x-goog-api-key` | `{api_key}` | Gemini CLI |

所有认证方式使用同一个 CCH API Key，系统自动识别认证头类型。

---

## 下一步

- [用户管理](/docs/guide/users) - 管理用户和 API Key
- [供应商管理](/docs/guide/settings-providers) - 配置上游 AI 供应商
- [使用文档页面](/docs/guide/usage-doc) - 了解 CCH 内置文档的功能
