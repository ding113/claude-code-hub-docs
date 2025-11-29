---
dimensions:
  type:
    primary: implementation
    detail: integration
  level: beginner
standard_title: 客户端接入
language: zh
---

# 客户端接入

本文档介绍如何将各种 AI 编程工具连接到 Claude Code Hub (CCH)。CCH 提供兼容多种 API 格式的代理服务，支持 Claude Code CLI、OpenAI Codex CLI、Cursor IDE 等客户端无缝接入。

---

## 前置条件

在开始配置客户端之前，您需要：

1. **CCH 服务已部署并运行** - 参考[快速开始](/docs/getting-started)完成部署
2. **获取 API Key** - 管理员在 CCH 后台为您创建的 API Key
3. **确认 CCH 服务地址** - 如 `http://your-server:23000`

{% callout type="note" title="用户接入流程" %}
1. 管理员在 CCH 后台创建用户并生成 API Key
2. 管理员将 API Key 分发给开发者
3. 开发者配置客户端环境变量
4. 开始使用 AI 编程工具
{% /callout %}

---

## Claude Code CLI 配置

Claude Code CLI 是 Anthropic 官方的命令行 AI 编程助手。通过配置环境变量即可将其连接到 CCH。

### 环境变量配置

设置以下两个环境变量：

```bash
# CCH 服务地址
export ANTHROPIC_BASE_URL=http://your-cch-server:23000

# CCH 分配的 API Key
export ANTHROPIC_API_KEY=your-cch-api-key
```

### 永久配置（推荐）

#### macOS / Linux

将配置添加到 shell 配置文件：

```bash
# Bash 用户
echo 'export ANTHROPIC_BASE_URL=http://your-cch-server:23000' >> ~/.bashrc
echo 'export ANTHROPIC_API_KEY=your-cch-api-key' >> ~/.bashrc
source ~/.bashrc

# Zsh 用户
echo 'export ANTHROPIC_BASE_URL=http://your-cch-server:23000' >> ~/.zshrc
echo 'export ANTHROPIC_API_KEY=your-cch-api-key' >> ~/.zshrc
source ~/.zshrc
```

#### Windows (PowerShell)

```powershell
# 设置用户级环境变量
[Environment]::SetEnvironmentVariable("ANTHROPIC_BASE_URL", "http://your-cch-server:23000", "User")
[Environment]::SetEnvironmentVariable("ANTHROPIC_API_KEY", "your-cch-api-key", "User")

# 重启 PowerShell 生效
```

### 验证配置

配置完成后，运行 Claude Code CLI 测试连接：

```bash
claude
```

如果配置正确，CLI 将通过 CCH 代理正常工作，您可以在 CCH 后台看到请求日志。

{% callout type="note" title="透明代理" %}
CCH 作为透明代理，客户端使用体验与直连 Anthropic API 完全一致。您无需修改任何使用习惯。
{% /callout %}

---

## OpenAI Codex CLI 配置

CCH 提供 OpenAI 兼容层，支持 Codex CLI 和其他 OpenAI 格式的客户端。

### API 兼容说明

CCH 支持以下 OpenAI 兼容端点：

| 端点 | 说明 |
|------|------|
| `/v1/chat/completions` | OpenAI Chat Completions API |
| `/v1/responses` | Codex Response API |

### 环境变量配置

```bash
# OpenAI 兼容端点
export OPENAI_BASE_URL=http://your-cch-server:23000/v1

# CCH 分配的 API Key
export OPENAI_API_KEY=your-cch-api-key
```

### Codex CLI 特定配置

Codex CLI 使用 Response API 格式：

```bash
# 配置示例
export OPENAI_BASE_URL=http://your-cch-server:23000/v1
export OPENAI_API_KEY=your-cch-api-key
```

{% callout type="note" title="格式自动转换" %}
CCH 会自动进行格式转换：
- 客户端发送 OpenAI/Codex 格式请求
- CCH 转换为上游供应商所需格式
- 响应自动转换回客户端期望格式
{% /callout %}

---

## Cursor IDE 配置

Cursor 是一款流行的 AI 增强代码编辑器，可以通过自定义 API 端点连接到 CCH。

### 配置步骤

1. **打开 Cursor 设置**
   - 使用快捷键 `Cmd/Ctrl + ,` 打开设置
   - 或点击菜单 `File > Preferences > Settings`

2. **搜索 API 配置**
   - 在设置搜索框中输入 `openai` 或 `api`

3. **配置自定义端点**

   ```
   API Base URL: http://your-cch-server:23000/v1
   API Key: your-cch-api-key
   ```

4. **选择模型**
   - 根据您的 CCH 供应商配置选择可用模型
   - 如 `claude-sonnet-4-20250514`、`claude-3-5-sonnet-20241022` 等

### 配置文件方式

也可以直接编辑 Cursor 配置文件：

```json
{
  "openai.apiKey": "your-cch-api-key",
  "openai.baseUrl": "http://your-cch-server:23000/v1"
}
```

---

## 其他 OpenAI 兼容客户端

任何支持 OpenAI API 的客户端都可以通过 CCH 的兼容层接入。

### 通用配置方法

大多数 OpenAI 兼容客户端支持以下配置方式：

#### 环境变量

```bash
export OPENAI_API_BASE=http://your-cch-server:23000/v1
export OPENAI_API_KEY=your-cch-api-key
```

#### Python OpenAI SDK

```python
from openai import OpenAI

client = OpenAI(
    base_url="http://your-cch-server:23000/v1",
    api_key="your-cch-api-key"
)

response = client.chat.completions.create(
    model="claude-sonnet-4-20250514",
    messages=[
        {"role": "user", "content": "Hello!"}
    ]
)
```

#### Node.js OpenAI SDK

```javascript
import OpenAI from 'openai';

const client = new OpenAI({
  baseURL: 'http://your-cch-server:23000/v1',
  apiKey: 'your-cch-api-key',
});

const response = await client.chat.completions.create({
  model: 'claude-sonnet-4-20250514',
  messages: [
    { role: 'user', content: 'Hello!' }
  ],
});
```

#### cURL 测试

```bash
curl http://your-cch-server:23000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-cch-api-key" \
  -d '{
    "model": "claude-sonnet-4-20250514",
    "messages": [
      {"role": "user", "content": "Hello!"}
    ]
  }'
```

---

## 支持的 API 端点

CCH 提供以下 API 端点供不同客户端使用：

| 端点 | 格式 | 适用客户端 |
|------|------|------------|
| `/v1/messages` | Claude Messages API | Claude Code CLI |
| `/v1/chat/completions` | OpenAI Chat Completions | Cursor, OpenAI SDK |
| `/v1/responses` | Codex Response API | Codex CLI |

---

## 故障排除

### 连接失败

**症状**: 客户端无法连接到 CCH

**排查步骤**:
1. 确认 CCH 服务正在运行
   ```bash
   curl http://your-cch-server:23000/health
   ```
2. 检查防火墙设置是否放行端口
3. 确认环境变量配置正确

### 认证失败

**症状**: 返回 401 Unauthorized 错误

**排查步骤**:
1. 确认 API Key 正确无误
2. 检查 API Key 是否已在 CCH 后台启用
3. 确认 API Key 未过期

### 请求超时

**症状**: 请求长时间无响应

**排查步骤**:
1. 检查 CCH 后台供应商健康状态
2. 查看是否有供应商处于熔断状态
3. 确认网络连接正常

### 查看请求日志

在 CCH 管理后台可以查看详细的请求日志，包括：
- 请求时间和用户
- 使用的供应商
- Token 消耗和成本
- 错误信息（如有）

---

## 最佳实践

{% callout type="note" title="推荐配置" %}
1. **使用永久环境变量** - 避免每次启动终端都需要配置
2. **妥善保管 API Key** - 不要将 Key 提交到代码仓库
3. **定期检查用量** - 在 CCH 后台监控个人使用情况
4. **利用 Session 复用** - CCH 会自动复用 Session 以提高缓存命中率
{% /callout %}

### 安全建议

- 不要在公共代码库中暴露 API Key
- 使用环境变量或配置文件管理敏感信息
- 如果 Key 泄露，立即联系管理员重新生成
