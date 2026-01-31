---
dimensions:
  type:
    primary: reference
    detail: guide
  level: intermediate
standard_title: 响应覆写
language: zh
---

# 响应覆写

响应覆写是 Claude Code Hub 的关键功能，允许管理员在错误响应返回客户端之前进行拦截和修改。该功能可以将晦涩的上游错误信息转换为用户友好的本地化消息，同时隐藏敏感的内部细节。

{% callout type="note" title="核心价值" %}
响应覆写功能的主要用途：
- **用户体验提升**：将技术性错误消息转换为易懂的提示
- **安全加固**：隐藏供应商名称、内部路径等敏感信息
- **错误标准化**：统一不同供应商的错误格式
- **重试控制**：通过状态码引导客户端的重试行为
{% /callout %}

## 工作原理

响应覆写系统在代理管道的错误处理层运行：

```
上游错误 -> 错误检测 -> 规则匹配 -> 覆写应用 -> 客户端响应
```

### 错误检测阶段

当上游发生错误时，系统会提取错误内容用于模式匹配。系统优先匹配完整的上游响应体，允许规则匹配响应中的任意内容。

### 规则匹配阶段

`ErrorRuleDetector` 类使用三种匹配策略（按性能排序）：

1. **Contains 匹配**（最快）：大小写不敏感的子串匹配
2. **Exact 匹配**（O(1) 查找）：大小写不敏感的精确匹配
3. **Regex 匹配**（最灵活）：正则表达式匹配

{% callout type="note" title="匹配优先级" %}
系统按 Contains -> Exact -> Regex 的顺序进行匹配，一旦匹配成功即停止。这种设计确保了最佳性能。
{% /callout %}

### 覆写应用阶段

系统支持三种覆写模式：

| 覆写模式 | 说明 | 适用场景 |
|---------|------|---------|
| 响应体覆写 | 替换整个错误响应体 | 转换技术错误为用户友好消息 |
| 状态码覆写 | 仅修改 HTTP 状态码 | 规范化不同供应商的状态码 |
| 组合覆写 | 同时覆写响应体和状态码 | 完整转换错误响应 |

## 支持的错误格式

系统支持三种主流 API 错误格式，并能自动检测格式类型：

### Claude 格式

```json
{
  "type": "error",
  "error": {
    "type": "invalid_request_error",
    "message": "你的自定义错误消息"
  }
}
```

### Gemini 格式

```json
{
  "error": {
    "code": 400,
    "message": "你的自定义错误消息",
    "status": "INVALID_ARGUMENT"
  }
}
```

### OpenAI 格式

```json
{
  "error": {
    "message": "你的自定义错误消息",
    "type": "invalid_request_error",
    "param": null,
    "code": null
  }
}
```

## 错误规则配置

### 数据库字段

| 字段 | 类型 | 说明 |
|-----|------|------|
| `pattern` | text | 匹配模式（正则、子串或精确值） |
| `matchType` | varchar | 匹配类型：`regex`、`contains`、`exact` |
| `category` | varchar | 错误分类 |
| `description` | text | 规则描述 |
| `overrideResponse` | jsonb | 覆写响应体（JSON 格式） |
| `overrideStatusCode` | integer | 覆写状态码（400-599） |
| `isEnabled` | boolean | 是否启用 |
| `priority` | integer | 优先级（数值越大越先匹配） |

### 错误分类

系统支持以下错误分类：

| 分类 | 说明 |
|-----|------|
| `prompt_limit` | 输入提示超出 token 限制 |
| `content_filter` | 内容被安全过滤器拦截 |
| `pdf_limit` | PDF 页数超出限制 |
| `thinking_error` | 思考块格式错误 |
| `parameter_error` | 参数缺失或无效 |
| `invalid_request` | 请求结构格式错误 |
| `cache_limit` | 缓存控制块超出限制 |

{% callout type="note" title="扩展分类" %}
默认规则中还包含 `input_limit`、`validation_error`、`context_limit`、`token_limit`、`model_error`、`media_limit` 等分类。
{% /callout %}

### 优先级系统

规则按优先级（数值越大越先）在每个匹配类型内进行评估。相同优先级的规则按分类排序。第一个匹配的规则生效，后续规则不再评估。

## 边界情况处理

### 空消息回退

当覆写响应的 message 为空时，系统会回退到原始的客户端安全消息：

```typescript
const overrideMessage =
  typeof overrideErrorObj?.message === "string" &&
  overrideErrorObj.message.trim().length > 0
    ? overrideErrorObj.message
    : clientErrorMessage;
```

### 无效状态码处理

状态码必须在 400-599 范围内，否则会被拒绝并记录警告，回退到上游状态码。

### 无效响应体处理

格式错误的覆写响应会被跳过并记录日志。如果同时配置了状态码覆写，状态码覆写仍会生效。

### 响应大小限制

覆写响应体限制为 10KB，防止滥用。

### ReDoS 防护

正则表达式模式会检查 ReDoS（正则表达式拒绝服务）风险，有风险的模式会被跳过。

## 缓存与热重载

系统采用事件驱动的缓存机制：

- **内存缓存**：规则加载后缓存在内存中
- **事件监听**：通过 EventEmitter 监听规则更新事件
- **跨进程同步**：通过 Redis Pub/Sub 实现多 Worker 部署的缓存同步
- **检测结果缓存**：使用 WeakMap 缓存错误检测结果，避免重复匹配

## 默认规则

系统内置 25+ 条预配置的默认错误规则，覆盖常见场景：

- 提示词 token 限制超出
- 内容被安全过滤器拦截
- 上下文窗口超出限制
- 模型不支持的参数
- PDF 页数限制
- 媒体文件限制

{% callout type="warning" title="默认规则同步" %}
默认规则采用"用户自定义优先"策略：
- 新模式：插入新规则
- 已存在且 `isDefault=true`：更新为最新默认规则
- 已存在且 `isDefault=false`：跳过（保留用户自定义版本）
{% /callout %}

## 管理界面

### 规则测试

管理界面提供实时测试功能，可以输入错误消息测试匹配结果。测试会模拟运行时处理逻辑，确保测试结果与实际行为一致。

### 模板支持

界面内置 Claude、Gemini、OpenAI 三种格式的响应模板，方便快速配置。

### 实时验证

- JSON 格式实时校验
- 状态码范围检查
- 响应格式自动检测

## 最佳实践

### 规则设计

1. **优先使用 Contains 匹配**：性能最佳，适合大多数场景
2. **谨慎使用 Regex**：仅在需要复杂模式时使用
3. **设置合理优先级**：确保更具体的规则优先匹配

### 消息设计

1. **用户友好**：使用清晰、易懂的语言
2. **可操作**：告诉用户如何解决问题
3. **安全**：不暴露内部实现细节

### 状态码选择

| 场景 | 建议状态码 |
|-----|----------|
| 客户端错误（可修复） | 400 |
| 认证失败 | 401 |
| 权限不足 | 403 |
| 资源不存在 | 404 |
| 请求过于频繁 | 429 |
| 服务端错误 | 500 |
| 服务不可用 | 503 |

## 相关文档

- [错误规则管理](/docs/filters/error-rules) - 错误规则的创建和管理
- [请求过滤](/docs/filters/request-filters) - 请求过滤系统
- [敏感词检测](/docs/filters/sensitive-words) - 敏感词检测功能
