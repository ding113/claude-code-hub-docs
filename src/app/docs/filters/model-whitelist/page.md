---
dimensions:
  type:
    primary: reference
    detail: guide
  level: intermediate
standard_title: 模型白名单
language: zh
---

# 模型白名单

模型白名单是 Claude Code Hub 的核心访问控制功能，允许管理员限制特定用户或供应商可以访问的 AI 模型。该功能支持两个独立的控制层级：用户级白名单和供应商级白名单。

{% callout type="note" title="核心用途" %}
模型白名单主要用于：
- **成本控制**：限制用户只能使用较便宜的模型
- **合规管理**：确保用户只能访问已授权的模型
- **质量保证**：限制用户使用经过测试验证的模型
- **供应商管理**：控制每个供应商端点可以提供的模型
{% /callout %}

## 用户级模型白名单

用户级白名单由 `ProxyModelGuard` 在请求管道中执行，控制单个用户可以请求哪些模型。

### 基本行为

| 配置状态 | 行为 |
|---------|------|
| 空数组 `[]` 或未定义 | 无限制，用户可请求任意模型 |
| 非空数组 | 严格限制，请求的模型必须在白名单中 |

### 匹配规则

- **大小写不敏感**：`claude-3-opus` 可匹配 `Claude-3-Opus`
- **精确匹配**：不支持通配符或模式匹配
- **完整名称**：`claude-3-opus-20240229` 必须完整列出

### 错误响应

当用户配置了白名单但请求不符合要求时：

| 场景 | HTTP 状态码 | 错误信息 |
|-----|------------|---------|
| 请求未指定模型 | 400 | Model specification is required when model restrictions are configured |
| 模型不在白名单中 | 400 | The requested model 'xxx' is not in the allowed list |

## 供应商级模型白名单

供应商级 `allowedModels` 字段具有双重语义，根据供应商类型有不同含义。

### Anthropic 供应商（claude, claude-auth）

作为**白名单**使用，限制供应商可以提供哪些 Claude 模型：

| 配置状态 | 行为 |
|---------|------|
| `null` 或空数组 | 允许所有 claude-* 模型 |
| 非空数组 | 仅允许列出的模型（**大小写敏感**） |

### 非 Anthropic 供应商（codex, gemini, gemini-cli, openai-compatible）

作为**声明列表**使用，声明供应商支持哪些模型：

| 配置状态 | 行为 |
|---------|------|
| `null` 或空数组 | 接受任意模型（由上游验证） |
| 非空数组 | 仅将列出的模型路由到此供应商 |

{% callout type="warning" title="大小写敏感性差异" %}
用户级白名单匹配是**大小写不敏感**的，而供应商级白名单匹配是**大小写敏感**的。配置供应商白名单时请确保模型名称大小写正确。
{% /callout %}

## 请求管道位置

模型白名单检查在请求处理管道的特定位置执行：

```
认证 -> 敏感词检测 -> 客户端限制 -> [模型白名单] -> 版本检查 -> ... -> 供应商选择
```

这确保：
1. 用户已通过认证后才检查模型权限
2. 无效模型在供应商选择前被拒绝
3. 速率限制在模型验证后执行

## 配置方法

### 用户白名单配置

在用户管理界面的「访问限制」部分配置：

- 支持标签式输入模型名称
- 最多配置 50 个模型
- 每个模型名称最长 64 字符
- 支持从供应商配置获取模型建议

### 供应商白名单配置

在供应商设置的「路由配置」部分配置：

- 使用模型多选组件选择允许的模型
- 支持手动输入模型名称
- 根据供应商类型显示不同的帮助文本

## 配置示例

### 限制用户使用特定模型

```json
{
  "userId": 123,
  "allowedModels": ["claude-3-opus-20240229", "claude-3-sonnet-20240229"]
}
```

用户只能请求这两个特定版本的 Claude 模型。

### 限制 Anthropic 供应商的模型

```json
{
  "providerId": 456,
  "providerType": "claude",
  "allowedModels": ["claude-3-opus-20240229", "claude-3-sonnet-20240229"]
}
```

该供应商只能提供这两个模型，即使上游支持更多。

### 声明 OpenAI 兼容供应商支持的模型

```json
{
  "providerId": 789,
  "providerType": "openai-compatible",
  "allowedModels": ["gpt-4", "gpt-4-turbo", "gpt-3.5-turbo"]
}
```

声明该供应商支持这些模型，用于路由选择。

## 交互行为

### 与模型重定向的交互

模型重定向在白名单检查**之后**执行：

1. 用户请求 `claude-3-opus`
2. 模型守卫验证 `user.allowedModels`
3. 供应商选择找到合适的供应商
4. 模型重定向可能将请求改为其他模型
5. 上游收到重定向后的模型名称

### 与供应商分组的交互

模型白名单与供应商分组独立工作：

- 用户的 `allowedModels` 限制可请求的模型
- 供应商的 `allowedModels` 限制可提供的模型
- 两者的交集决定实际可用性

**示例**：
- 用户白名单：`["claude-3-opus", "claude-3-sonnet"]`
- 供应商 A 白名单：`["claude-3-opus"]`
- 供应商 B 白名单：`["claude-3-sonnet", "claude-3-haiku"]`
- 结果：用户可通过供应商 A 访问 opus，通过供应商 B 访问 sonnet

### count_tokens 端点

模型白名单同样适用于 `/v1/messages/count_tokens` 端点，确保所有 API 端点的访问控制一致。

## 注意事项

{% callout type="note" title="管理员权限" %}
系统没有管理员覆盖机制——管理员与普通用户受相同的白名单限制。如需管理员无限制访问，请将其 `allowedModels` 保持为空。
{% /callout %}

### 跨类型代理支持

供应商级 `allowedModels` 支持跨类型代理场景：

- Claude 类型供应商可通过 `allowedModels` 或 `modelRedirects` 声明支持非 Claude 模型
- 这允许将 `gemini-*` 请求通过配置了模型重定向的 Claude 供应商路由

## 相关文档

- [智能路由算法](/docs/proxy/intelligent-routing) - 了解供应商选择的完整流程
- [供应商管理](/docs/provider-management) - 了解供应商配置界面
- [用户管理](/docs/user-management) - 了解用户配置界面
