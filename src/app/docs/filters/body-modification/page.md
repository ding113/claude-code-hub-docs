---
dimensions:
  type:
    primary: reference
    detail: guide
  level: intermediate
standard_title: Body 修改
language: zh
---

# Body 修改

Body 修改是 Claude Code Hub 请求过滤系统的核心功能，允许管理员在请求转发到上游 AI 供应商之前，对请求体进行编程式修改。

{% callout type="note" title="核心能力" %}
Body 修改功能支持以下场景：
- **数据脱敏**：移除或替换请求中的敏感信息
- **请求规范化**：统一不同客户端的请求格式
- **内容过滤**：替换或修改特定内容模式
- **动态注入**：添加或修改请求载荷中的字段
- **合规执行**：确保请求符合组织策略
{% /callout %}

## 架构位置

Body 修改作为**请求过滤引擎**的一部分运行，在两个阶段执行：

1. **全局阶段**：在供应商选择之前应用
2. **供应商特定阶段**：在供应商选择之后应用

```
请求进入 → 全局过滤器 → 供应商选择 → 供应商过滤器 → 转发上游
```

## Body 过滤器操作类型

对于 Body 作用域，系统提供两种操作类型：

| 操作类型 | 说明 | 适用场景 |
|---------|------|---------|
| `json_path` | 设置指定 JSON 路径的值 | 修改 `model`、`temperature`、`max_tokens` 等字段 |
| `text_replace` | 在整个请求体中替换文本模式 | 脱敏关键词、替换域名 |

### JSON Path 操作

`json_path` 操作使用点号分隔的路径语法，支持数组下标访问。

**路径示例**：
- `model` - 设置模型字段
- `messages.0.content` - 设置第一条消息的内容
- `data.items[0].token` - 设置嵌套数组元素

**特性**：
- 自动创建中间对象/数组
- 数字键会创建数组，字符串键会创建对象
- 现有非对象值会被覆盖以允许遍历

### Text Replace 操作

`text_replace` 操作在请求体的所有字符串值中执行深度递归替换。

**匹配类型**：

| 匹配类型 | 行为 | 示例 |
|---------|------|------|
| `contains` | 替换所有出现的子串 | `"secret"` 在 `"my secret data"` 中 → `"my [REDACTED] data"` |
| `exact` | 仅当整个字符串匹配时替换 | `"secret"` 匹配 `"secret"` 但不匹配 `"my secret"` |
| `regex` | 使用正则表达式模式替换 | `"\d{3}-\d{4}"` 匹配 `"123-4567"` |

{% callout type="warning" title="正则安全" %}
系统使用 `safe-regex` 库检测并拒绝可能导致 ReDoS（正则表达式拒绝服务）攻击的不安全正则表达式。
{% /callout %}

## 绑定类型

过滤器支持三种绑定类型，决定其应用范围：

| 绑定类型 | 说明 | 执行阶段 |
|---------|------|---------|
| `global` | 应用于所有请求 | 全局阶段 |
| `providers` | 仅应用于指定供应商 | 供应商特定阶段 |
| `groups` | 应用于匹配分组标签的供应商 | 供应商特定阶段 |

{% callout type="note" title="分组标签匹配" %}
供应商的分组标签支持逗号分隔的多值格式（如 `"basic, vip, beta"`）。只要任一标签匹配过滤器配置的 `groupTags`，过滤器就会生效。
{% /callout %}

## 优先级与执行顺序

过滤器按优先级（升序）排序，相同优先级按 ID 排序：

- **数值越小，优先级越高**
- 相同目标的过滤器按顺序执行，后执行的会覆盖先执行的结果

| 优先级值 | 建议用途 |
|---------|---------|
| 0-10 | 安全相关（脱敏、密钥移除） |
| 10-50 | 业务规则（模型覆盖、参数限制） |
| 50+ | 通用转换 |

## 配置示例

### 示例 1：强制使用指定模型

```json
{
  "name": "强制 Claude 3.5 Sonnet",
  "description": "将模型覆盖为 claude-3-5-sonnet-20241022",
  "scope": "body",
  "action": "json_path",
  "target": "model",
  "replacement": "claude-3-5-sonnet-20241022",
  "priority": 10,
  "isEnabled": true,
  "bindingType": "global"
}
```

### 示例 2：脱敏邮箱地址

```json
{
  "name": "脱敏邮箱",
  "description": "将邮箱模式替换为 [EMAIL]",
  "scope": "body",
  "action": "text_replace",
  "target": "[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}",
  "matchType": "regex",
  "replacement": "[EMAIL]",
  "priority": 5,
  "isEnabled": true,
  "bindingType": "global"
}
```

### 示例 3：替换内部域名

```json
{
  "name": "替换内部域名",
  "description": "将 internal.company.com 替换为 example.com",
  "scope": "body",
  "action": "text_replace",
  "target": "internal.company.com",
  "matchType": "contains",
  "replacement": "example.com",
  "priority": 0,
  "isEnabled": true,
  "bindingType": "global"
}
```

### 示例 4：限制 max_tokens（分组绑定）

```json
{
  "name": "限制 Max Tokens",
  "description": "将 max_tokens 限制为 4096",
  "scope": "body",
  "action": "json_path",
  "target": "max_tokens",
  "replacement": 4096,
  "priority": 20,
  "isEnabled": true,
  "bindingType": "groups",
  "groupTags": ["cost-controlled"]
}
```

### 示例 5：脱敏 API 密钥（供应商绑定）

```json
{
  "name": "移除 API 密钥",
  "description": "脱敏 sk- 前缀的 API 密钥",
  "scope": "body",
  "action": "text_replace",
  "target": "sk-[a-zA-Z0-9]{48}",
  "matchType": "regex",
  "replacement": "[API_KEY_REDACTED]",
  "priority": 1,
  "isEnabled": true,
  "bindingType": "providers",
  "providerIds": [1, 2, 3]
}
```

## UI 配置

在设置页面的「请求过滤器」中，你可以通过图形界面配置 Body 过滤器：

1. **作用域选择**：选择 `Body`
2. **操作类型**：选择 `JSON 路径替换` 或 `文本替换`
3. **匹配类型**：仅 `文本替换` 需要选择（包含/精确匹配/正则）
4. **目标**：JSON 路径（如 `messages.0.content`）或匹配文本
5. **替换值**：字符串或 JSON 值

{% callout type="note" title="目标字段提示" %}
- JSON 路径操作：输入如 `messages.0.content` 或 `data.items[0].token`
- 文本替换操作：输入要匹配的文本或正则表达式
{% /callout %}

## 安全与可靠性

### 失败开放策略

过滤器采用**失败开放**（fail-open）策略：过滤器执行失败不会阻塞请求处理，而是记录错误并继续转发原始请求。

### ReDoS 防护

系统在两个层面防护 ReDoS 攻击：

1. **验证时**：创建/更新过滤器时检测不安全正则
2. **加载时**：引擎加载过滤器时再次验证并预编译正则

### 绑定类型验证

系统强制执行绑定类型的一致性：

- `providers` 类型必须指定至少一个供应商 ID
- `groups` 类型必须指定至少一个分组标签
- `global` 类型不能指定供应商或分组
- 不能同时指定供应商和分组

## 性能优化

引擎实现了多项性能优化：

| 优化项 | 说明 |
|-------|------|
| 预编译正则 | 正则表达式在加载时编译一次 |
| Set 缓存 | 供应商 ID 和分组标签使用 Set 存储，O(1) 查找 |
| 提前退出 | 无过滤器时跳过处理 |
| 延迟解析 | 仅在存在分组过滤器时解析供应商标签 |
| 热重载 | 配置变更无需重启即可生效 |

## 重要限制

### 仅修改请求

Body 修改**仅作用于请求体**，不支持修改响应体。

### JSON 中心设计

系统针对 JSON 请求体（OpenAI/Claude API 格式）设计。非 JSON 请求体会被包装为 `{ raw: ... }` 格式，Body 过滤器可能无法按预期工作。

### 无条件逻辑

过滤器不能基于请求内容进行条件应用（绑定类型除外）。所有匹配的过滤器按优先级顺序应用。

### 无链式处理

不能将一个过滤器的输出作为另一个过滤器的输入。每个过滤器独立操作当前请求体状态。

## 相关文档

- [Header 修改](/docs/filters/header-modification) - 了解 Header 过滤器的配置
- [请求过滤器](/docs/filters/request-filters) - 了解请求过滤系统概览
- [敏感词过滤](/docs/filters/sensitive-words) - 了解敏感词检测功能
