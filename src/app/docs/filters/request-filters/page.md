---
dimensions:
  type:
    primary: reference
    detail: guide
  level: intermediate
standard_title: 请求过滤器
language: zh
---

# 请求过滤器

请求过滤器是 Claude Code Hub 的请求转换系统，用于在请求转发到上游 LLM 供应商之前拦截并修改传入的 API 请求。该功能支持请求净化、数据脱敏、Header 管理和供应商特定定制。

{% callout type="note" title="设计理念" %}
请求过滤器采用"失败开放"（fail-open）设计哲学——过滤器执行失败不会阻塞主请求流程，确保系统在过滤器配置出现问题时仍能保持高可用性。
{% /callout %}

## 核心架构

请求过滤器系统实现了两阶段过滤架构：

1. **全局过滤阶段**：在供应商选择之前应用，通过 `requestFilter` 步骤执行
2. **供应商特定过滤阶段**：在供应商选择之后应用，通过 `providerRequestFilter` 步骤执行

### 管道执行顺序

在 Guard Pipeline 中，请求过滤器的执行位置如下：

| 步骤 | 名称 | 说明 |
|-----|------|------|
| 1 | auth | API Key 认证 |
| 2 | sensitive | 敏感词检测 |
| 3-8 | ... | 客户端、模型、版本等验证 |
| 9 | **requestFilter** | 全局请求过滤器 |
| 10 | rateLimit | 限流检查 |
| 11 | provider | 供应商选择 |
| 12 | **providerRequestFilter** | 供应商特定过滤器 |
| 13 | messageContext | 消息日志上下文 |

{% callout type="warning" title="执行顺序说明" %}
全局请求过滤器在敏感词检测**之后**执行，而非之前。这意味着敏感词检测会先于过滤器处理原始请求内容。
{% /callout %}

### 会话变更模型

过滤器直接操作 `ProxySession` 对象：

- `session.headers`：可修改的 Headers 对象（支持 delete/set 操作）
- `session.request.message`：可转换的解析后请求体

## 过滤器类型与操作

### Header 过滤器

Header 过滤器操作请求中的 HTTP 头：

| 操作 | 说明 | target 字段 | replacement 字段 |
|-----|------|------------|-----------------|
| `remove` | 删除指定 Header | Header 名称 | 不需要 |
| `set` | 设置/覆盖 Header | Header 名称 | Header 值 |

### Body 过滤器

Body 过滤器操作请求消息体：

| 操作 | 说明 | target 字段 | replacement 字段 | matchType |
|-----|------|------------|-----------------|-----------|
| `json_path` | 在 JSON 路径设置值 | JSON 路径（如 `temperature`） | 新值 | 不需要 |
| `text_replace` | 替换匹配模式的文本 | 搜索模式 | 替换文本 | `contains`/`exact`/`regex` |

### 匹配类型说明

`text_replace` 操作支持三种匹配类型：

| 匹配类型 | 行为 |
|---------|------|
| `contains` | 简单字符串替换，替换所有出现的目标文本 |
| `exact` | 精确匹配，仅当整个字符串完全匹配时才替换 |
| `regex` | 正则表达式匹配，支持全局替换 |

{% callout type="note" title="深度替换" %}
`text_replace` 操作会递归遍历整个消息对象，对所有字符串字段执行替换操作。
{% /callout %}

## 绑定类型

过滤器可以在三个级别绑定：

| 绑定类型 | 说明 | 适用场景 |
|---------|------|---------|
| `global` | 应用于所有请求 | 通用净化、公共 Header |
| `providers` | 应用于特定供应商 | 供应商特定的 API Key Header |
| `groups` | 应用于匹配分组标签的供应商 | 多供应商配置 |

### 绑定验证规则

- `providers` 绑定：必须选择至少一个供应商，不能同时选择分组
- `groups` 绑定：必须选择至少一个分组标签，不能同时选择供应商
- `global` 绑定：不能指定供应商或分组

## 优先级与排序

过滤器按优先级升序执行（数值越小越先执行），相同优先级时按 ID 排序：

| 优先级 | 建议用途 |
|-------|---------|
| 0-10 | 高优先级操作（如强制参数覆盖） |
| 10-50 | 常规过滤操作 |
| 50+ | 低优先级操作（如日志增强） |

## 配置示例

### 示例 1：移除敏感 Header（全局）

```json
{
  "name": "移除内部令牌",
  "description": "转发前移除内部认证 Header",
  "scope": "header",
  "action": "remove",
  "target": "X-Internal-Token",
  "priority": 10,
  "bindingType": "global"
}
```

### 示例 2：设置供应商特定 API Key

```json
{
  "name": "设置 OpenAI API Key",
  "description": "为 OpenAI 供应商覆盖 Authorization Header",
  "scope": "header",
  "action": "set",
  "target": "Authorization",
  "replacement": "Bearer sk-xxx",
  "priority": 20,
  "bindingType": "providers",
  "providerIds": [1]
}
```

### 示例 3：JSON 路径修改

```json
{
  "name": "强制温度参数",
  "description": "将 temperature 参数覆盖为 0.7",
  "scope": "body",
  "action": "json_path",
  "target": "temperature",
  "replacement": 0.7,
  "priority": 5,
  "bindingType": "global"
}
```

### 示例 4：正则表达式文本替换（分组绑定）

```json
{
  "name": "脱敏电话号码",
  "description": "替换消息中的电话号码",
  "scope": "body",
  "action": "text_replace",
  "matchType": "regex",
  "target": "\\b\\d{3}[-.]?\\d{3}[-.]?\\d{4}\\b",
  "replacement": "[电话已脱敏]",
  "priority": 15,
  "bindingType": "groups",
  "groupTags": ["production"]
}
```

## 管理界面

请求过滤器通过管理后台 `/settings/request-filters` 进行管理。界面提供以下功能：

- 过滤器列表展示与启用/禁用切换
- 创建和编辑过滤器对话框
- 供应商和分组标签多选绑定
- 实时缓存刷新

## 安全特性

### ReDoS 防护

所有正则表达式模式在保存时都会使用 `safe-regex` 库进行验证，防止正则表达式拒绝服务攻击。不安全的正则表达式将被拒绝保存。

### 访问控制

过滤器管理功能仅限管理员用户访问。非管理员用户无法查看或修改过滤器配置。

## 性能优化

系统实现了多项性能优化：

| 优化项 | 说明 |
|-------|------|
| 正则预编译 | 在加载时预编译正则表达式，避免运行时重复编译 |
| Set 查找 | 使用 Set 数据结构实现 O(1) 的供应商 ID 查找 |
| 延迟初始化 | 首次使用时才加载过滤器，减少启动开销 |
| 空过滤器优化 | 无过滤器时直接跳过处理逻辑 |
| 条件标签解析 | 仅在存在分组绑定过滤器时才解析供应商标签 |

## 缓存与热更新

过滤器配置支持热更新：

- **本地事件**：通过 EventEmitter 监听 `requestFiltersUpdated` 事件
- **跨实例同步**：通过 Redis Pub/Sub 实现多实例间的缓存失效通知
- **手动刷新**：管理界面提供手动刷新缓存按钮

## 边界情况

### JSON 路径自动创建

使用 `json_path` 操作时，如果中间路径不存在，系统会自动创建缺失的对象或数组。

### 无供应商时的处理

如果在 `providerRequestFilter` 步骤执行时尚未选择供应商，系统会跳过供应商特定过滤器并记录警告日志。

### 过滤器执行失败

单个过滤器执行失败不会影响其他过滤器的执行，也不会阻塞请求流程。失败信息会被记录到日志中。

## 相关文档

- [敏感词过滤](/docs/filters/sensitive-words) - 在请求过滤器之前执行的内容过滤
- [错误规则](/docs/filters/error-rules) - 响应错误模式匹配
- [供应商管理](/docs/providers/crud) - 供应商配置与过滤器绑定
