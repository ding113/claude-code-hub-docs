---
dimensions:
  type:
    primary: reference
    detail: guide
  level: intermediate
standard_title: Header 修改
language: zh
---

# Header 修改

Header 修改是 Claude Code Hub 代理系统的核心功能，允许管理员在请求转发到上游 AI 供应商之前，以编程方式修改 HTTP 请求头。

{% callout type="note" title="核心用途" %}
Header 修改功能主要用于：
- **隐私保护**：移除敏感头信息（如客户端 IP、内部令牌）
- **请求标准化**：统一不同客户端类型的请求头
- **供应商定制**：根据目标供应商应用不同的头规则
- **安全合规**：强制执行组织策略
{% /callout %}

## 过滤器类型

系统支持两种主要的 Header 修改操作：

| 操作 | 说明 | 使用场景 |
|-----|------|---------|
| `remove` | 从请求中删除指定头 | 移除内部认证令牌、客户端 IP 头 |
| `set` | 设置或替换头的值 | 覆盖 User-Agent、添加自定义追踪头 |

## 绑定类型

Header 过滤器可以在不同范围应用：

| 绑定类型 | 说明 | 应用时机 |
|---------|------|---------|
| `global` | 应用于所有请求 | 供应商选择之前 |
| `providers` | 应用于特定供应商 | 供应商选择之后 |
| `groups` | 应用于特定分组标签的供应商 | 供应商选择之后 |

## 执行流程

Header 修改在请求处理管道中的执行顺序：

```
请求到达 -> 解析 Headers -> 应用全局过滤器 -> 选择供应商 -> 应用供应商过滤器 -> 头处理器清理 -> 转发请求
```

1. **全局过滤器**：在供应商选择前应用，按优先级排序执行
2. **供应商过滤器**：在供应商选择后应用，仅对匹配的供应商生效
3. **头处理器**：最终清理和标准化，添加认证信息

## 配置示例

### 移除敏感头

```typescript
// 移除内部令牌
{
  name: "移除内部令牌",
  scope: "header",
  action: "remove",
  target: "x-internal-token",
  bindingType: "global",
  priority: 10,
}
```

### 设置自定义头

```typescript
// 覆盖 User-Agent
{
  name: "自定义 User-Agent",
  scope: "header",
  action: "set",
  target: "user-agent",
  replacement: "MyApp/1.0",
  bindingType: "providers",
  providerIds: [1, 2],
  priority: 5,
}
```

### 分组过滤器

```typescript
// 为高级用户组添加优先级头
{
  name: "高级用户优先级",
  scope: "header",
  action: "set",
  target: "x-priority",
  replacement: "high",
  bindingType: "groups",
  groupTags: ["premium"],
  priority: 20,
}
```

## 优先级系统

过滤器按优先级升序执行（数值越小越先执行）。当多个过滤器针对同一个头时：

1. **相同优先级**：按 ID 升序排列，后执行的覆盖先执行的
2. **不同优先级**：高优先级（数值大）的结果生效
3. **全局 vs 供应商**：供应商过滤器在全局过滤器之后执行，可以覆盖全局设置

{% callout type="warning" title="优先级冲突" %}
如果需要确保某个过滤器的结果不被覆盖，请为其设置较高的优先级数值。
{% /callout %}

## 特殊行为

### 失败开放策略

Header 过滤器失败**不会阻塞**请求。系统采用失败开放策略：

```typescript
try {
  await requestFilterEngine.applyGlobal(session);
} catch (error) {
  // 过滤器失败不阻塞主流程
  logger.error("Failed to apply filters", { error });
}
```

### 空值处理

使用 `action: "set"` 时：
- `replacement` 为 `null` 或 `undefined`：头设置为空字符串 `""`
- `replacement` 为非字符串值：会被 JSON 序列化
- 要移除头，请使用 `action: "remove"` 而非设置空值

### 头名称大小写

头名称**不区分大小写**（符合 HTTP 规范）。配置时建议使用小写：`user-agent`、`x-api-key`。

### 无法修改的头

以下头由系统管理，过滤器无法有效修改：

| 头名称 | 原因 |
|-------|------|
| `host` | 由头处理器根据供应商 URL 覆盖 |
| `authorization` | 由头处理器使用供应商 API Key 覆盖 |
| `content-length` | 由头处理器删除（动态计算） |
| `connection` | 由 HTTP 客户端管理 |

### Codex User-Agent 特殊处理

对于 Codex 类型供应商，系统会检测 User-Agent 是否被过滤器修改：

- 如果过滤器修改了 User-Agent，使用修改后的值
- 如果过滤器删除了 User-Agent，回退到原始值
- 如果无原始值，使用默认的 Codex CLI User-Agent

## 绑定验证

系统对绑定类型有严格约束：

- **不能混用**：`providers` 绑定不能同时指定 `groupTags`
- **全局限制**：`global` 绑定不能指定 `providerIds` 或 `groupTags`

```typescript
// 错误示例
{
  bindingType: "providers",
  providerIds: [1, 2],
  groupTags: ["premium"],  // 错误：不能同时指定
}
```

## 常见用例

| 用例 | 操作 | 目标 | 替换值 |
|-----|------|------|-------|
| 移除内部认证 | remove | x-internal-token | - |
| 标准化 User-Agent | set | user-agent | "MyApp/1.0" |
| 添加追踪头 | set | x-request-source | "claude-code-hub" |
| 移除客户端 IP | remove | x-forwarded-for | - |
| 覆盖 API 版本 | set | anthropic-version | "2023-06-01" |

## 性能考虑

1. **早期退出**：无过滤器时引擎会快速返回
2. **预排序**：过滤器在初始化时按优先级预排序
3. **Set 查找**：供应商和分组匹配使用 Set 数据结构，O(1) 复杂度
4. **热重载**：过滤器更新无需重启，通过事件发射器实时生效

## 安全考虑

1. **ReDoS 防护**：Body 过滤器中的正则表达式使用 `safe-regex` 验证
2. **失败开放**：过滤器失败不会阻塞请求
3. **认证保护**：`authorization` 头始终由转发器覆盖，过滤器无法泄露凭证
4. **审计追踪**：头修改可通过 `isHeaderModified()` 检测并记录

## UI 管理

在设置页面 **Settings > Request Filters** 中管理 Header 过滤器：

- **创建过滤器**：点击添加按钮，填写名称、绑定类型、操作、目标等字段
- **编辑过滤器**：点击编辑按钮修改现有配置
- **启用/禁用**：使用开关切换过滤器状态
- **刷新缓存**：修改后点击刷新按钮使配置立即生效

## 相关文档

- [Body 修改](/docs/filters/body-modification) - 了解请求体修改功能
- [供应商管理](/docs/provider-management) - 了解供应商配置和分组
- [智能路由](/docs/proxy/intelligent-routing) - 了解请求路由机制
