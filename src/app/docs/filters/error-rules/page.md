---
dimensions:
  type:
    primary: reference
    detail: guide
  level: intermediate
standard_title: 错误规则检测
language: zh
---

# 错误规则检测

Claude Code Hub 的错误规则检测系统是一个智能化的错误分类引擎，负责识别上游 AI 供应商返回的各类错误，并根据错误类型决定最优的处理策略。该系统通过可配置的规则引擎，实现精准的错误分类、智能重试决策和用户友好的错误响应。

{% callout type="note" title="核心价值" %}
错误规则检测系统的核心目标：
- **智能分类**：区分客户端错误、供应商错误和网络错误
- **精准重试**：避免对必然失败的请求进行无效重试
- **友好响应**：将技术性错误信息转换为用户可理解的提示
- **系统稳定**：配合熔断器保护系统免受级联故障影响
{% /callout %}

## 错误分类体系

系统将错误分为五个类别，每个类别有不同的处理策略：

| 错误类别 | 触发条件 | 处理策略 |
|---------|---------|---------|
| `CLIENT_ABORT` | 客户端主动中断连接 | 不重试、不计入熔断器 |
| `NON_RETRYABLE_CLIENT_ERROR` | 客户端输入错误（如 prompt 过长） | 不重试、直接返回错误 |
| `RESOURCE_NOT_FOUND` | 上游返回 404 | 切换供应商、不计入熔断器 |
| `PROVIDER_ERROR` | 供应商 4xx/5xx 错误 | 计入熔断器、切换供应商 |
| `SYSTEM_ERROR` | 网络层故障 | 重试一次后切换供应商 |

{% callout type="warning" title="分类优先级" %}
错误分类按优先级顺序判断：CLIENT_ABORT > NON_RETRYABLE_CLIENT_ERROR > RESOURCE_NOT_FOUND > PROVIDER_ERROR > SYSTEM_ERROR。高优先级类别会覆盖低优先级的判断。
{% /callout %}

## 规则匹配机制

### 三种匹配类型

错误规则支持三种匹配方式，按性能从高到低排序：

| 匹配类型 | 说明 | 性能 | 适用场景 |
|---------|------|------|---------|
| `contains` | 子字符串匹配 | 最快 | 简单关键词匹配 |
| `exact` | 精确匹配 | 快速 | 固定错误消息 |
| `regex` | 正则表达式匹配 | 较慢 | 复杂模式匹配 |

### 匹配流程

检测器按以下顺序执行匹配，确保最优性能：

1. **Contains 匹配**：遍历所有 contains 规则，检查错误消息是否包含指定字符串
2. **Exact 匹配**：使用 HashMap O(1) 查找精确匹配的错误消息
3. **Regex 匹配**：按优先级顺序执行正则表达式匹配

{% callout type="note" title="大小写不敏感" %}
所有匹配类型都是大小写不敏感的。Contains 和 Exact 匹配会将模式和消息都转换为小写后比较，Regex 匹配使用 `i` 标志。
{% /callout %}

## 预置错误规则

系统内置约 30 条预定义规则，覆盖常见的 AI 供应商错误场景：

| 规则类别 | 说明 | 示例模式 |
|---------|------|---------|
| `prompt_limit` | Token 数量超限 | `prompt is too long.*tokens.*maximum` |
| `input_limit` | 输入内容长度超限 | `Input is too long` |
| `content_filter` | 内容安全过滤 | `blocked by.*content filter` |
| `pdf_limit` | PDF 页数超限 | `PDF has too many pages` |
| `media_limit` | 媒体文件数量超限 | `Too much media` |
| `thinking_error` | 扩展思考模式错误 | `expected.*thinking.*found.*tool_use` |
| `parameter_error` | 参数缺失或多余 | `Missing required parameter` |
| `validation_error` | 工具调用验证错误 | `tool_use ids must be unique` |
| `model_error` | 模型不存在或无效 | `unknown model\|model not found` |
| `context_limit` | 上下文窗口超限 | `context.*length.*exceed` |

## 错误响应覆盖

### 覆盖功能

每条规则可配置响应覆盖，将原始错误转换为更友好的消息：

- **overrideResponse**：替换整个响应体
- **overrideStatusCode**：覆盖 HTTP 状态码（限 400-599）

### 支持的响应格式

系统支持三种主流 AI API 的错误响应格式：

**Claude 格式：**
```json
{
  "type": "error",
  "error": {
    "type": "prompt_limit",
    "message": "你的提示词超出了 token 限制"
  }
}
```

**OpenAI 格式：**
```json
{
  "error": {
    "message": "你的提示词超出了 token 限制",
    "type": "invalid_request_error",
    "code": "context_length_exceeded"
  }
}
```

**Gemini 格式：**
```json
{
  "error": {
    "code": 400,
    "message": "你的提示词超出了 token 限制",
    "status": "INVALID_ARGUMENT"
  }
}
```

{% callout type="note" title="响应大小限制" %}
覆盖响应的最大大小为 10KB。超过此限制的响应将被拒绝。
{% /callout %}

## 缓存与同步

### 三层缓存结构

检测器使用三层缓存优化性能：

1. **规则缓存**：按匹配类型分类存储规则
2. **检测结果缓存**：使用 WeakMap 缓存每个 Error 对象的检测结果
3. **正则表达式缓存**：预编译的正则表达式对象

### 缓存同步机制

规则更新时，系统通过双通道事件机制同步缓存：

- **进程内事件**：通过 EventEmitter 通知当前进程
- **跨进程事件**：通过 Redis Pub/Sub 通知其他实例

### 默认规则同步策略

系统启动时自动同步默认规则，遵循以下策略：

| 场景 | 处理方式 |
|-----|---------|
| 新规则（模式不存在） | 插入新规则 |
| 系统规则（isDefault=true） | 更新为最新版本 |
| 用户自定义规则（isDefault=false） | 保留不变 |
| 代码中已删除的系统规则 | 从数据库删除 |

{% callout type="note" title="用户优先原则" %}
用户自定义的规则永远不会被系统更新覆盖。如果你修改了某条系统规则，它会被标记为非默认规则，后续的系统更新不会影响你的修改。
{% /callout %}

## 安全防护

### ReDoS 防护

所有正则表达式规则在加载时都会进行 ReDoS（正则表达式拒绝服务）风险检测。存在风险的模式会被跳过并记录警告日志。

### 并发保护

检测器使用 Promise 锁和加载标志防止并发重载：

- 初始化时使用 Promise 锁确保只执行一次
- 重载时检查 `isLoading` 标志避免重复执行

### 数据库故障处理

当数据库加载失败时，检测器会保留现有缓存继续工作，并在下次请求时重试加载。

## 管理界面

在设置页面的「错误规则」选项卡中，你可以：

- **查看规则列表**：显示所有规则的状态、模式、类别
- **添加自定义规则**：创建新的错误匹配规则
- **编辑现有规则**：修改规则的模式、类别或覆盖响应
- **测试规则匹配**：输入错误消息测试匹配结果
- **刷新缓存**：手动触发规则缓存同步

## 配置示例

### 基础规则（Contains 匹配）

```json
{
  "pattern": "rate limit exceeded",
  "matchType": "contains",
  "category": "rate_limit",
  "description": "通用速率限制错误"
}
```

### 正则规则（带响应覆盖）

```json
{
  "pattern": "prompt is too long.*(\\d+).*tokens.*(\\d+).*maximum",
  "matchType": "regex",
  "category": "prompt_limit",
  "description": "Token 超限错误",
  "overrideResponse": {
    "type": "error",
    "error": {
      "type": "prompt_limit",
      "message": "你的提示词超出了模型的 token 限制，请缩短输入内容"
    }
  },
  "overrideStatusCode": 400
}
```

### 精确匹配规则

```json
{
  "pattern": "Invalid API key",
  "matchType": "exact",
  "category": "auth_error",
  "description": "API 密钥无效"
}
```

## 最佳实践

### 规则设计建议

1. **优先使用 Contains**：对于简单的关键词匹配，Contains 性能最优
2. **谨慎使用 Regex**：只在需要复杂模式匹配时使用正则表达式
3. **设置合理优先级**：高优先级规则会先被检查，将常见错误的规则设为高优先级
4. **提供友好消息**：使用 overrideResponse 将技术性错误转换为用户可理解的提示

### 监控建议

- 定期检查被跳过的 ReDoS 风险规则
- 监控规则匹配的命中率，优化低效规则
- 关注 `NON_RETRYABLE_CLIENT_ERROR` 类别的错误，这些通常是用户输入问题

## 相关文档

- [熔断器](/docs/proxy/circuit-breaker) - 了解熔断器如何与错误分类配合工作
- [智能路由](/docs/proxy/intelligent-routing) - 了解错误如何触发供应商切换
- [限流](/docs/proxy/rate-limiting) - 了解速率限制相关的错误处理
