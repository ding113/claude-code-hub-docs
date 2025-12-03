---
dimensions:
  type:
    primary: getting-started
    detail: settings
  level: intermediate
standard_title: 请求过滤器
language: zh
---

# 请求过滤器

请求过滤器功能允许管理员对传入的 API 请求进行规则匹配和自动替换。通过配置过滤规则，可以修改请求头、替换请求体内容或删除敏感信息，实现数据脱敏、参数调整等高级功能。

## 访问请求过滤器页面

1. 登录管理后台
2. 在左侧导航栏选择「设置」
3. 点击「请求过滤器」子菜单

## 功能概述

请求过滤器管理页面提供以下核心功能：

- **过滤规则列表**：查看所有已配置的过滤规则
- **添加规则**：创建新的过滤规则
- **编辑规则**：修改现有规则的配置
- **删除规则**：移除不再需要的规则
- **启用/禁用**：临时关闭或开启单条规则
- **优先级排序**：控制规则的执行顺序

---

## 过滤规则配置

每条过滤规则包含以下配置项：

### 作用范围（Scope）

指定规则作用于请求的哪个部分：

| 范围 | 说明 |
| --- | --- |
| `header` | 作用于 HTTP 请求头 |
| `body` | 作用于请求体（JSON） |

### 操作类型（Action）

定义对匹配内容执行的操作：

| 操作 | 适用范围 | 说明 |
| --- | --- | --- |
| `remove` | header | 删除匹配的请求头 |
| `set` | header | 设置或覆盖请求头的值 |
| `json_path` | body | 修改请求体中指定 JSON 路径的值 |
| `text_replace` | body | 在请求体中进行文本替换（支持深度递归） |

### 匹配模式（Match Type）

定义如何匹配目标内容：

| 模式 | 说明 | 性能 |
| --- | --- | --- |
| `exact` | 精确匹配，目标内容必须完全一致 | 最高 |
| `contains` | 包含匹配，目标内容包含指定文本即匹配 | 高 |
| `regex` | 正则表达式匹配，支持复杂模式 | 较低 |

### 其他字段

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `target` | string | 匹配目标（字段名、JSON 路径或要替换的文本） |
| `replacement` | string | 替换内容（根据操作类型有不同含义） |
| `priority` | number | 执行优先级，数字越小越先执行 |
| `isEnabled` | boolean | 是否启用该规则 |

---

## 操作类型详解

### remove（删除）

删除指定的请求头。仅适用于 `header` 范围。

**示例**：
- **Scope**: header
- **Action**: remove
- **Target**: `X-Custom-Header`
- **效果**: 从请求头中移除 `X-Custom-Header`

### set（设置）

设置或覆盖请求头的值。仅适用于 `header` 范围。

**示例**：
- **Scope**: header
- **Action**: set
- **Target**: `User-Agent`
- **Replacement**: `CustomAgent/1.0`
- **效果**: 将请求头 `User-Agent` 设置为 `CustomAgent/1.0`

### json_path（JSON 路径修改）

直接修改请求体中指定 JSON 路径的值。支持嵌套路径。

**示例**：
- **Scope**: body
- **Action**: json_path
- **Target**: `messages[0].content`
- **Replacement**: `Hello, World!`
- **效果**: 将 `messages` 数组第一个元素的 `content` 字段修改为 `Hello, World!`

{% callout type="note" title="JSON 路径语法" %}
支持点号分隔的路径和数组索引，例如：`user.profile.name`、`items[0].value`
{% /callout %}

### text_replace（文本替换）

在请求体中进行文本替换，支持深度递归遍历所有字符串字段。

**示例**：
- **Scope**: body
- **Action**: text_replace
- **Match Type**: regex
- **Target**: `sk-[a-zA-Z0-9]{32}`
- **Replacement**: `[REDACTED]`
- **效果**: 将请求体中所有匹配 API Key 格式的内容替换为 `[REDACTED]`

---

## 优先级说明

过滤规则按 `priority` 字段**升序**执行：

- 数字越小，优先级越高，越先执行
- 相同优先级的规则执行顺序不确定
- 建议使用 10、20、30 等间隔值，便于后续插入新规则

**执行流程示例**：

```
规则 A (priority=10) → 规则 B (priority=20) → 规则 C (priority=30)
```

---

## 配置示例

### 示例 1：移除敏感请求头

移除可能泄露客户端信息的请求头：

| 字段 | 值 |
| --- | --- |
| Scope | header |
| Action | remove |
| Match Type | exact |
| Target | X-Client-Secret |
| Priority | 10 |

### 示例 2：替换敏感文本

将请求体中的敏感信息替换为占位符：

| 字段 | 值 |
| --- | --- |
| Scope | body |
| Action | text_replace |
| Match Type | regex |
| Target | `\b\d{11}\b`（11位数字，如手机号） |
| Replacement | `[PHONE_REDACTED]` |
| Priority | 20 |

### 示例 3：修改 JSON 字段

修改请求中的特定 JSON 字段值：

| 字段 | 值 |
| --- | --- |
| Scope | body |
| Action | json_path |
| Match Type | exact |
| Target | `metadata.source` |
| Replacement | `claude-code-hub` |
| Priority | 30 |

---

## 添加过滤规则

1. 点击页面右上角的「添加过滤器」按钮
2. 在弹出的对话框中填写以下信息：
   - **作用范围**：选择 Header 或 Body
   - **操作类型**：选择 remove、set、json_path 或 text_replace
   - **匹配模式**：选择精确匹配、包含匹配或正则表达式
   - **目标**：输入要匹配的内容
   - **替换值**：输入替换后的内容（部分操作需要）
   - **优先级**：设置执行顺序
3. 点击「创建」按钮保存

创建成功后，规则会立即生效。

---

## 安全说明

### 正则表达式安全

系统使用 `safe-regex` 库检测正则表达式，**防止正则表达式拒绝服务攻击（ReDoS）**。

以下类型的正则表达式会被拒绝：

- 包含嵌套量词的表达式（如 `(a+)+`）
- 可能导致指数级回溯的表达式

{% callout type="warning" title="正则表达式验证" %}
添加正则表达式类型的规则时，系统会自动验证表达式的安全性。不安全的正则表达式将无法保存。
{% /callout %}

### 执行时机

请求过滤器在 Guard Pipeline 中执行，位于敏感词检测**之前**。这意味着：

1. 过滤器可以在敏感词检测前修改内容
2. 可以用于对请求进行预处理和规范化

---

## 最佳实践

1. **合理设置优先级**：使用间隔值（如 10、20、30）便于后续插入新规则
2. **优先使用精确匹配**：性能最好，满足大部分需求
3. **正则表达式谨慎使用**：复杂的正则可能影响性能，建议先测试
4. **添加描述信息**：为规则添加清晰的描述，方便团队维护
5. **测试新规则**：添加规则后进行实际测试，确保效果符合预期
6. **利用禁用功能**：调试时可临时禁用规则而不删除

---

## 相关功能

- [敏感词过滤](/docs/guide/settings-sensitive-words) - 基于关键词的内容拦截
- [错误规则](/docs/guide/settings-error-rules) - 错误分类和重试策略
