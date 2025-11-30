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

本文档详细介绍如何将各种 AI Coding 工具客户端接入 Claude Code Hub (CCH)。 {% .lead %}

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

## 支持的 API 端点

CCH 提供以下 API 端点，支持不同客户端的接入：

| 端点 | 说明 | 适用客户端 |
|------|------|-----------|
| `/v1/messages` | Claude Messages API | Claude Code CLI, 其他 Claude API 兼容客户端 |
| `/v1/messages/count_tokens` | Token 计数 API | Claude Code CLI |
| `/v1/chat/completions` | OpenAI Chat Completions API | Cursor, Continue, OpenAI 兼容客户端 |
| `/v1/responses` | Codex Response API | OpenAI Codex CLI |

---

## Claude Code CLI 接入

Claude Code CLI 是 Anthropic 官方提供的命令行 AI 编程助手。

### 配置步骤

1. **设置 API 端点**

   在终端中执行以下命令配置 API 基础 URL：

   ```bash
   claude config set apiUrl https://your-cch-domain.com
   ```

   如果使用本地部署：

   ```bash
   claude config set apiUrl http://localhost:23000
   ```

2. **设置 API Key**

   使用 CCH 分配的 API Key（非 Anthropic 官方密钥）：

   ```bash
   claude config set apiKey your-cch-api-key
   ```

3. **验证连接**

   执行以下命令测试配置是否正确：

   ```bash
   claude "你好，请简单介绍你自己"
   ```

   如果返回正常响应，说明配置成功。

### 环境变量方式

也可以通过环境变量配置：

```bash
export ANTHROPIC_BASE_URL=https://your-cch-domain.com
export ANTHROPIC_API_KEY=your-cch-api-key
```

将上述配置添加到 `~/.bashrc` 或 `~/.zshrc` 以持久化。

---

## OpenAI Codex CLI 接入

OpenAI Codex CLI 是 OpenAI 提供的命令行编程助手，CCH 通过 `/v1/responses` 端点提供兼容支持。

### 配置步骤

1. **设置环境变量**

   ```bash
   export OPENAI_BASE_URL=https://your-cch-domain.com/v1
   export OPENAI_API_KEY=your-cch-api-key
   ```

2. **验证配置**

   启动 Codex CLI 并测试：

   ```bash
   codex "写一个 Python hello world 程序"
   ```

{% callout type="note" title="指令注入配置" %}
CCH 支持 Codex CLI 的指令注入功能。可以在供应商设置中配置 `codexInstructions` 字段为 `auto`、`force_official` 或 `keep_original`，控制系统提示词的处理方式。
{% /callout %}

---

## Cursor IDE 接入

Cursor 是一款集成 AI 功能的代码编辑器，支持 OpenAI 兼容 API。

### 配置步骤

1. 打开 Cursor 设置 (`Cmd/Ctrl + ,`)
2. 搜索 `OpenAI` 或 `API`
3. 找到 API 配置区域
4. 设置以下参数：

   | 设置项 | 值 |
   |--------|-----|
   | API Base URL | `https://your-cch-domain.com/v1` |
   | API Key | `your-cch-api-key` |

5. 保存设置并重启 Cursor

### 验证连接

在 Cursor 中打开 AI 对话窗口（`Cmd/Ctrl + L`），输入测试问题验证连接是否正常。

---

## Continue 插件接入

Continue 是 VS Code 和 JetBrains IDE 的开源 AI 编程插件。

### VS Code 配置

1. 安装 Continue 插件
2. 打开 Continue 配置文件 `~/.continue/config.json`
3. 添加或修改模型配置：

   ```json
   {
     "models": [
       {
         "title": "Claude via CCH",
         "provider": "openai",
         "model": "claude-sonnet-4-20250514",
         "apiBase": "https://your-cch-domain.com/v1",
         "apiKey": "your-cch-api-key"
       }
     ]
   }
   ```

4. 保存配置文件，Continue 会自动重新加载

### JetBrains IDE 配置

1. 安装 Continue 插件
2. 打开设置 `Settings > Tools > Continue`
3. 配置 API 参数：
   - Base URL: `https://your-cch-domain.com/v1`
   - API Key: `your-cch-api-key`
4. 选择要使用的模型
5. 应用并重启 IDE

---

## 通用 OpenAI 兼容客户端配置

对于其他支持 OpenAI API 的工具和库，可按以下通用方式配置：

### Python (openai 库)

```python
from openai import OpenAI

client = OpenAI(
    api_key="your-cch-api-key",
    base_url="https://your-cch-domain.com/v1"
)

response = client.chat.completions.create(
    model="claude-sonnet-4-20250514",
    messages=[
        {"role": "user", "content": "Hello!"}
    ]
)

print(response.choices[0].message.content)
```

### Node.js (openai 库)

```javascript
import OpenAI from 'openai';

const client = new OpenAI({
  apiKey: 'your-cch-api-key',
  baseURL: 'https://your-cch-domain.com/v1'
});

const response = await client.chat.completions.create({
  model: 'claude-sonnet-4-20250514',
  messages: [
    { role: 'user', content: 'Hello!' }
  ]
});

console.log(response.choices[0].message.content);
```

### cURL 请求示例

```bash
curl https://your-cch-domain.com/v1/chat/completions \
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

## 认证方式说明

CCH 支持多种认证头格式，兼容不同客户端的认证习惯：

| 认证头 | 格式 | 说明 |
|--------|------|------|
| `Authorization` | `Bearer {api_key}` | 标准 Bearer Token 认证 |
| `x-api-key` | `{api_key}` | Anthropic 风格认证 |
| `x-goog-api-key` | `{api_key}` | Gemini CLI 风格认证 |

所有认证方式使用同一个 CCH API Key，系统会自动识别认证头类型。

---

## 常见问题

### 连接失败

**症状**：客户端报告无法连接到服务器

**排查步骤**：

1. 确认 CCH 服务正在运行：
   ```bash
   docker compose ps
   # 或
   curl http://localhost:23000/api/health
   ```

2. 检查 URL 配置是否正确，注意：
   - 协议（http/https）是否正确
   - 端口号是否正确
   - 是否有多余的斜杠或路径

3. 检查防火墙或网络策略是否阻止访问

### 认证错误 (401)

**症状**：返回 `令牌已过期或验证不正确` 错误

**排查步骤**：

1. 确认使用的是 CCH 分配的 API Key，而非上游供应商密钥
2. 检查 API Key 是否已在管理后台启用
3. 确认 API Key 未过期
4. 检查认证头格式是否正确

### 无可用供应商 (503)

**症状**：返回 `无可用供应商` 错误

**排查步骤**：

1. 登录管理后台检查供应商状态
2. 确认至少有一个供应商已启用
3. 检查供应商是否处于熔断状态（红色标记）
4. 查看供应商的 API 连通性测试结果

### 请求超时

**症状**：请求长时间无响应或超时

**排查步骤**：

1. 检查上游供应商服务是否正常
2. 如果通过代理访问，检查代理配置是否正确
3. 适当增加供应商的超时配置：
   - 首字节超时（streaming first byte timeout）
   - 流式静默期超时（streaming idle timeout）
   - 非流式总超时（non-streaming timeout）

### 格式转换错误

**症状**：响应格式不符合预期

**排查步骤**：

1. 确认使用了正确的 API 端点：
   - Claude 客户端使用 `/v1/messages`
   - OpenAI 兼容客户端使用 `/v1/chat/completions`
   - Codex CLI 使用 `/v1/responses`

2. 检查请求体格式是否符合对应 API 规范

---

## Session 机制说明

CCH 实现了 Session 粘性机制，确保同一对话的请求路由到同一供应商，提高缓存命中率并降低成本。

- **Session TTL**：默认 5 分钟（可通过 `SESSION_TTL` 环境变量调整）
- **Session ID**：从请求头 `x-session-id` 提取，或由系统自动生成
- **故障转移**：当绑定的供应商不可用时，系统会自动切换到其他可用供应商

{% callout type="note" title="优化建议" %}
对于需要保持上下文的长对话，建议客户端在请求头中传递 `x-session-id`，确保对话的连续性和一致性。
{% /callout %}

---

## 下一步

- [用户管理](/docs/guide/user-management) - 了解如何管理用户和 API Key
- [供应商管理](/docs/guide/provider-management) - 配置上游 AI 供应商
- [监控与日志](/docs/guide/monitoring) - 查看请求日志和使用统计
