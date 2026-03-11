---
dimensions:
  type:
    primary: reference
    detail: guide
  level: intermediate
standard_title: 请求响应整流器
language: zh
---

# 请求响应整流器

请求响应整流器（Rectifier）是 Claude Code Hub 代理链路中的自动修复机制。当客户端发送的请求格式不符合上游 API 要求、或上游返回特定错误时，整流器会自动修正请求体并重试，避免用户手动干预。

{% callout type="note" title="设计理念" %}
整流器采用"最小侵入"原则——仅在检测到明确的格式问题或已知错误模式时才介入，且只修改必要的字段。所有整流行为都会记录到 `specialSettings` 审计字段中，方便在请求日志中追溯。
{% /callout %}

## 整流器概览

系统内置四个整流器，按触发时机分为两类：

**主动整流（请求发送前）**：
- **Response Input Rectifier**：规范化 `/v1/responses` 端点的 `input` 字段格式
- **Billing Header Rectifier**：剥离 Claude Code 客户端注入的计费头文本块

**被动整流（上游报错后）**：
- **Thinking Budget Rectifier**：修复 `budget_tokens` 低于最低值的错误
- **Thinking Signature Rectifier**：移除不兼容的 thinking/signature 块并重试

| 整流器 | 触发时机 | 适用供应商 | 系统设置 | 默认状态 |
|-------|---------|-----------|---------|---------|
| Response Input | 请求发送前 | 全部（Response API） | `enableResponseInputRectifier` | 启用 |
| Billing Header | 请求发送前 | Claude / Claude Auth | `enableBillingHeaderRectifier` | 启用 |
| Thinking Budget | 上游 400 错误后 | Claude / Claude Auth | `enableThinkingBudgetRectifier` | 启用 |
| Thinking Signature | 上游 400 错误后 | Claude / Claude Auth | `enableThinkingSignatureRectifier` | 启用 |

## Response Input Rectifier（响应输入整流器）

### 问题背景

OpenAI Responses API（`/v1/responses`）的 `input` 字段支持多种格式：字符串简写、单对象、数组。但下游代码（格式检测、转换器）要求 `input` 必须为数组格式。此整流器在 Guard Pipeline 之前将非数组 `input` 规范化为数组。

### 触发条件

当请求格式检测为 `response`（即 `/v1/responses` 端点）时，在 `proxy-handler.ts` 中自动调用 `normalizeResponseInput(session)`。

### 转换规则

| 原始格式 | 转换动作 | 转换结果 |
|---------|---------|---------|
| 字符串（非空） | `string_to_array` | `[{ role: "user", content: [{ type: "input_text", text: 原始字符串 }] }]` |
| 空字符串 `""` | `empty_string_to_empty_array` | `[]` |
| 单对象（含 `role` 或 `type` 字段） | `object_to_array` | `[原始对象]` |
| 数组 | `passthrough` | 不修改 |
| `undefined`/`null`/其他 | `passthrough` | 不修改，交由下游处理错误 |

### 审计记录

当整流生效时，写入 `specialSettings`：

```json
{
  "type": "response_input_rectifier",
  "scope": "request",
  "hit": true,
  "action": "string_to_array",
  "originalType": "string"
}
```

### 系统设置

通过 `enableResponseInputRectifier` 控制开关，默认启用（`true`）。关闭后整流器不执行任何操作。

## Thinking Budget Rectifier（思考预算整流器）

### 问题背景

Anthropic API 要求 `thinking.budget_tokens` 的值不低于 1024。当客户端发送的值低于此阈值时，上游会返回 400 错误。此整流器检测到该错误后，自动将预算调整到安全值并重试。

### 触发条件

仅对 `claude` 或 `claude-auth` 类型供应商生效。通过 `detectThinkingBudgetRectifierTrigger` 函数检测错误消息，匹配以下特征：

- 同时包含 `budget_tokens`（或 `budget tokens`）和 `thinking`
- 且包含 `greater than or equal to 1024`、`>= 1024`、或 `1024` + `input should be`

匹配成功返回触发类型 `budget_tokens_too_low`。

### 自动修复

`rectifyThinkingBudget` 函数执行以下修正（原地修改请求体）：

1. 设置 `thinking.type = "enabled"`
2. 设置 `thinking.budget_tokens = 32000`
3. 如果 `max_tokens` 未设置或低于 32001，设置 `max_tokens = 64000`

{% callout type="note" title="adaptive 模式例外" %}
当 `thinking.type` 为 `"adaptive"` 时，整流器不执行任何修改，直接返回 `applied: false`。
{% /callout %}

### 重试策略

- 整流后使用**同一供应商**进行一次额外重试
- 如果重试后仍失败，标记为 `NON_RETRYABLE_CLIENT_ERROR`，不触发供应商切换或熔断器
- 每个供应商仅重试一次（通过 `thinkingBudgetRectifierRetried` 标记）
- 整流未实际修改任何值时，跳过重试

### 审计记录

```json
{
  "type": "thinking_budget_rectifier",
  "scope": "request",
  "hit": true,
  "providerId": 1,
  "providerName": "my-claude",
  "trigger": "budget_tokens_too_low",
  "attemptNumber": 1,
  "retryAttemptNumber": 2,
  "before": {
    "maxTokens": 4096,
    "thinkingType": "enabled",
    "thinkingBudgetTokens": 512
  },
  "after": {
    "maxTokens": 64000,
    "thinkingType": "enabled",
    "thinkingBudgetTokens": 32000
  }
}
```

## Thinking Signature Rectifier（思考签名整流器）

### 问题背景

Anthropic API 对 thinking 块的签名有严格校验。当请求中包含无效签名、缺失签名、跨渠道切换导致的不兼容 thinking 块时，上游会返回 400 错误。此整流器通过移除有问题的 thinking 块和 signature 字段来修复请求。

### 触发条件

仅对 `claude` 或 `claude-auth` 类型供应商生效。通过 `detectThinkingSignatureRectifierTrigger` 函数检测以下错误模式：

| 触发类型 | 匹配的错误消息特征 |
|---------|-----------------|
| `assistant_message_must_start_with_thinking` | 包含 `must start with a thinking block`，或匹配 `expected thinking or redacted_thinking...found tool_use` |
| `invalid_signature_in_thinking_block` | 同时包含 `invalid`、`signature`、`thinking`、`block` |
| `invalid_signature_in_thinking_block` | 包含 `signature` + `field required`（签名字段缺失） |
| `invalid_signature_in_thinking_block` | 包含 `signature` + `extra inputs are not permitted`（签名字段不被接受） |
| `invalid_signature_in_thinking_block` | 包含 `thinking`/`redacted_thinking` + `cannot be modified`（thinking 块被修改） |
| `invalid_request` | 匹配 `非法请求`、`illegal request`、`invalid request` |

### 自动修复

`rectifyAnthropicRequestMessage` 函数执行以下整流（原地修改请求体）：

1. **移除 thinking 块**：从所有 `messages[*].content` 中移除 `type: "thinking"` 的块
2. **移除 redacted_thinking 块**：移除 `type: "redacted_thinking"` 的块
3. **移除遗留 signature 字段**：从非 thinking 类型的 content 块中移除 `signature` 属性
4. **兜底处理**：当 thinking 已启用但最后一条 assistant 消息未以 thinking 块开头且包含 `tool_use` 块时，删除顶层 `thinking` 字段（仅影响本次重试）

{% callout type="warning" title="兜底删除 thinking" %}
第 4 步的兜底处理会直接删除请求体的顶层 `thinking` 字段。这是为了避免 Anthropic API 返回 "Expected thinking..., but found tool_use" 错误。此行为仅在工具调用链路中缺少 thinking 前缀时触发，且仅影响本次重试请求。
{% /callout %}

### 重试策略

- 整流后使用**同一供应商**进行一次额外重试
- 已重试过仍失败时，标记为 `NON_RETRYABLE_CLIENT_ERROR`
- 每个供应商仅重试一次（通过 `thinkingSignatureRectifierRetried` 标记）
- 整流未实际修改任何内容时（`applied: false`），跳过重试
- 重试前会记录整流前的请求快照（`requestDetailsBeforeRectify`），便于审计对比

### 审计记录

```json
{
  "type": "thinking_signature_rectifier",
  "scope": "request",
  "hit": true,
  "providerId": 1,
  "providerName": "my-claude",
  "trigger": "invalid_signature_in_thinking_block",
  "attemptNumber": 1,
  "retryAttemptNumber": 2,
  "removedThinkingBlocks": 2,
  "removedRedactedThinkingBlocks": 1,
  "removedSignatureFields": 3
}
```

## Billing Header Rectifier（计费头整流器）

### 问题背景

Claude Code 客户端 v2.1.36+ 会在请求体的 `system` 内容数组中注入 `x-anthropic-billing-header: ...` 文本块。非原生 Anthropic 上游（如 Amazon Bedrock）无法识别这类保留关键字，会返回 400 错误：

```
"x-anthropic-billing-header is a reserved keyword and may not be used in the system prompt."
```

### 触发条件

在 `forwarder.ts` 的供应商级参数覆写阶段执行，仅对 `claude` 或 `claude-auth` 类型供应商生效。在请求发送到上游**之前**主动剥离。

### 自动修复

`rectifyBillingHeader` 函数使用正则 `/^\s*x-anthropic-billing-header\s*:/i` 匹配，处理三种 `system` 格式：

| system 格式 | 处理方式 |
|------------|---------|
| `undefined`/`null` | 不处理 |
| 字符串 | 如果匹配，删除整个 `system` 字段 |
| 数组 | 过滤掉匹配的 `{ type: "text", text: "x-anthropic-billing-header: ..." }` 块 |

### 审计记录

```json
{
  "type": "billing_header_rectifier",
  "scope": "request",
  "hit": true,
  "removedCount": 1,
  "extractedValues": ["x-anthropic-billing-header: ..."]
}
```

### 系统设置

通过 `enableBillingHeaderRectifier` 控制开关，默认启用（`true`）。

## 审计与日志

所有整流器共享统一的审计机制：

- **specialSettings 记录**：每次整流操作都会通过 `session.addSpecialSetting()` 写入审计字段，包含操作类型、命中状态、修改前后的状态
- **结构化日志**：通过 `logger.info` 输出结构化日志，包含 sessionId、providerId、触发原因等上下文
- **请求详情快照**：被动整流器（Thinking Budget/Thinking Signature）在整流前保存请求快照（`requestDetailsBeforeRectify`），整流后的重试请求与原始请求均可在日志详情中对比查看
- **请求链路追踪**：整流重试的第一次失败请求会以 `retry_failed` 状态记录到供应商链路（`providerChain`）中，完整保留审计轨迹

{% callout type="note" title="独立于错误规则" %}
整流器的触发检测不依赖错误规则（Error Rules）系统。即使用户关闭了相关的错误规则，整流器仍会独立检测并修复问题。这是因为整流器和错误规则服务于不同目的：整流器修复请求以使其成功，错误规则覆写响应以改善用户体验。
{% /callout %}

## 配置

所有整流器通过系统设置（Settings）页面控制，支持独立开关：

| 设置项 | 默认值 | 说明 |
|-------|-------|------|
| `enableResponseInputRectifier` | `true` | Response API input 格式规范化 |
| `enableBillingHeaderRectifier` | `true` | 计费头文本块剥离 |
| `enableThinkingBudgetRectifier` | `true` | 思考预算自动修复与重试 |
| `enableThinkingSignatureRectifier` | `true` | 思考签名不兼容自动修复与重试 |

在管理后台的 **Settings > 高级设置** 中可以找到这些开关。

## 相关文档

- [请求过滤器](/docs/filters/request-filters) - 请求发送前的过滤与转换
- [响应覆写](/docs/filters/response-override) - 错误响应的拦截与修改
- [错误规则](/docs/filters/error-rules) - 错误模式匹配与响应覆写规则
- [高级设置](/docs/advanced-settings) - 系统设置管理
