---
title: 供应商聚合
nextjs:
  metadata:
    title: 供应商聚合
    description: 了解 Claude Code Hub 如何智能聚合多个上游供应商，实现高可用、成本优化和访问控制
---

# 供应商聚合

供应商聚合是 Claude Code Hub 的核心机制，让你能够同时配置多个上游 AI 供应商，并根据可用性、成本、优先级和用户权限自动路由请求。当你在生产环境中运行 AI 代理时，单点故障是不可接受的。供应商聚合通过智能分发请求到多个供应商来解决这个问题。

## 核心设计原则

供应商聚合围绕以下关键原则设计：

- **高可用性**：当某个供应商出现故障时，请求自动故障转移到备选供应商
- **成本优化**：在可能的情况下将请求路由到更便宜的供应商
- **访问控制**：不同用户可以访问不同的供应商子集
- **会话粘性**：多轮对话保持在同一供应商以确保一致性
- **健康感知**：不健康的供应商自动从池中移除

## 供应商选择流程

当请求到达时，系统会执行多阶段选择流程：

### 1. 会话复用检查

对于多轮对话，系统首先尝试复用之前的供应商以维持上下文一致性。只有当对话包含多条消息时才会触发复用检查。

复用条件包括：
- 会话绑定的供应商仍然健康
- 供应商未超过成本限额
- 用户仍有权访问该供应商
- 供应商支持请求的模型

### 2. 分组预过滤

系统根据用户分配的供应商组过滤供应商。每个用户或 API 密钥可以分配到特定组，只能看到匹配该组的供应商。这是一个静默过滤，用户不会感知到组外的供应商。

### 3. 格式和模型匹配

根据请求的模型和 API 格式进一步过滤供应商：

| 客户端格式 | 兼容的供应商类型 |
|-----------|----------------|
| Claude | `claude`, `claude-auth` |
| Response | `codex` |
| OpenAI | `openai-compatible` |
| Gemini | `gemini` |
| Gemini CLI | `gemini-cli` |

系统还会检查：
- 供应商类型兼容性
- `allowedModels` 白名单
- 模型重定向配置

### 4. 1M 上下文过滤

如果客户端通过 `anthropic-beta` 头请求 1M 上下文窗口，会排除 `context1mPreference` 设置为 `disabled` 的供应商。

### 5. 健康检查过滤

系统检查多个健康指标：
- 熔断器状态（关闭/开启/半开）
- 成本限额（5小时、每日、每周、每月、总计）
- 供应商类型熔断器

### 6. 优先级分层

只保留最高优先级（最小优先级数字）的供应商。这确保主供应商始终优先于备用供应商。

### 7. 成本加权选择

在同一优先级层级内，供应商按成本乘数排序，然后使用加权随机分布进行选择。

## 供应商类型

系统支持六种供应商类型，每种针对特定 API 格式设计：

### Claude

直接连接 Anthropic Claude API，支持所有 Claude 模型，使用标准 Anthropic 认证（x-api-key 头）。这是默认的供应商类型。

### Claude Auth

用于 Claude 转发服务，仅使用 Bearer 认证（无 x-api-key 头），兼容 Claude API 格式，适用于第三方 Claude 兼容服务。

### Codex

OpenAI Responses API，专为 Codex CLI 集成设计，支持响应式 API 调用，以不同于标准 OpenAI 的方式处理工具调用。

### Gemini

直接集成 Google Gemini API，原生 Gemini 请求/响应格式，支持 Gemini 特有功能，基于 URL 路径的模型指定。

### Gemini CLI

Gemini CLI 包装器格式，特殊的请求包装以实现 CLI 兼容性，处理包装后的请求体。

### OpenAI Compatible

通用 OpenAI 兼容 API 格式，可与任何 OpenAI API 兼容服务配合使用，模型支持灵活。

## 配置字段

### 基础配置

| 字段 | 类型 | 默认值 | 说明 |
|-----|------|-------|------|
| `name` | string | 必填 | 供应商名称 |
| `url` | string | 必填 | API 端点 URL |
| `key` | string | 必填 | API 密钥 |
| `providerType` | enum | `claude` | 供应商类型 |
| `isEnabled` | boolean | `true` | 是否启用 |
| `description` | text | - | 供应商描述 |

### 选择和路由配置

| 字段 | 类型 | 默认值 | 说明 |
|-----|------|-------|------|
| `weight` | integer | 1 | 加权随机选择的权重（1-100） |
| `priority` | integer | 0 | 优先级，数字越小优先级越高 |
| `costMultiplier` | decimal | 1.0 | 成本乘数，用于成本优化 |
| `groupTag` | string | - | 分组标签，支持逗号分隔的多标签 |

### 模型配置

| 字段 | 类型 | 默认值 | 说明 |
|-----|------|-------|------|
| `allowedModels` | string[] | null | 允许的模型列表，null 表示允许所有 |
| `modelRedirects` | object | - | 模型名称重定向映射 |
| `joinClaudePool` | boolean | false | 非 Anthropic 供应商是否加入 Claude 调度池 |

### 成本限额配置

| 字段 | 类型 | 说明 |
|-----|------|------|
| `limit5hUsd` | decimal | 5 小时滚动限额（美元） |
| `limitDailyUsd` | decimal | 每日限额（美元） |
| `limitWeeklyUsd` | decimal | 每周限额（美元） |
| `limitMonthlyUsd` | decimal | 每月限额（美元） |
| `limitTotalUsd` | decimal | 总计限额（美元） |

每日限额支持两种重置模式：
- **fixed**：在固定时间重置（由 `dailyResetTime` 指定，默认 00:00）
- **rolling**：滚动窗口，24 小时后重置

### 熔断器配置

| 字段 | 类型 | 默认值 | 说明 |
|-----|------|-------|------|
| `circuitBreakerFailureThreshold` | integer | 5 | 触发熔断的失败次数阈值 |
| `circuitBreakerOpenDuration` | integer | 1800000 | 熔断持续时间（毫秒，默认 30 分钟） |
| `circuitBreakerHalfOpenSuccessThreshold` | integer | 2 | 半开状态恢复所需的连续成功次数 |

### 并发和超时配置

| 字段 | 类型 | 默认值 | 说明 |
|-----|------|-------|------|
| `limitConcurrentSessions` | integer | 0 | 并发会话限制（0 表示无限制） |
| `maxRetryAttempts` | integer | - | 每个请求的最大重试次数（null 使用全局默认值） |
| `firstByteTimeoutStreamingMs` | integer | 0 | 流式响应首字节超时（0 使用全局默认值） |
| `streamingIdleTimeoutMs` | integer | 0 | 流式响应空闲超时（0 使用全局默认值） |
| `requestTimeoutNonStreamingMs` | integer | 0 | 非流式请求超时（0 使用全局默认值） |

### 其他配置

| 字段 | 类型 | 默认值 | 说明 |
|-----|------|-------|------|
| `preserveClientIp` | boolean | false | 是否在请求中保留客户端 IP |
| `context1mPreference` | enum | `inherit` | 1M 上下文窗口偏好（`inherit`/`force_enable`/`disabled`） |
| `cacheTtlPreference` | integer | - | 缓存 TTL 覆盖值 |
| `proxyUrl` | string | - | 代理 URL |
| `proxyFallbackToDirect` | boolean | false | 代理失败时是否回退到直连 |

## 供应商分组

供应商分组通过 `groupTag` 字段实现，支持逗号分隔的多标签。分组常量定义如下：

- `default`：默认分组标识符，用于未设置分组的密钥或供应商
- `*`：全局访问标识符，可访问所有供应商（管理员专用）

### 分组匹配逻辑

分组匹配检查供应商标签和用户组之间的交集：

1. 如果用户组包含 `*`，允许访问所有供应商
2. 如果供应商没有设置 `groupTag`，视为 `default` 组
3. 检查供应商标签和用户组是否有交集

### 用户分组分配

用户和 API 密钥可以通过 `providerGroup` 字段分配到供应商组。密钥的分组设置优先于用户设置。

## 故障转移和重试

当供应商在请求处理过程中失败时，系统实现复杂的故障转移机制：

1. 将失败的供应商添加到排除列表
2. 尝试选择替代供应商
3. 在供应商链中记录每次尝试以供调试
4. 继续直到找到健康供应商或耗尽所有选项

### 双循环重试系统

转发器实现双循环重试机制：

**外层循环**：供应商切换，最多尝试 20 个供应商
**内层循环**：当前供应商重试，每个供应商最多重试指定次数

错误分类处理：

- **CLIENT_ABORT**：客户端断开连接，立即失败不重试
- **NON_RETRYABLE_CLIENT_ERROR**：无效请求（提示过长、内容过滤），立即失败
- **SYSTEM_ERROR**：网络问题，重试一次后切换供应商
- **RESOURCE_NOT_FOUND**：404 错误，重试后切换
- **PROVIDER_ERROR**：4xx/5xx 错误，重试后切换并记录熔断器

## 模型重定向

供应商可以配置模型名称重定向，用于：
- 成本优化：将昂贵模型重定向到更便宜的替代方案
- 第三方集成：将 Claude 模型名称映射到供应商特定名称
- A/B 测试：将部分流量重定向到不同模型版本

配置示例：

```json
{
  "modelRedirects": {
    "claude-sonnet-4-5": "claude-3-5-sonnet-20241022",
    "claude-opus-4": "claude-3-opus-20240229"
  }
}
```

对于 Gemini 供应商，系统还会自动更新 URL 路径中的模型名称。

## 加入 Claude 池

非 Anthropic 供应商可以通过设置 `joinClaudePool=true` 参与 Claude 模型调度。这允许第三方供应商处理 Claude 模型请求。

要求：
1. 供应商必须设置 `joinClaudePool=true`
2. 供应商必须有 `modelRedirects` 条目将请求的 Claude 模型映射到另一个 Claude 模型
3. 重定向的模型必须以 `claude-` 开头

## 供应商链跟踪

每次供应商选择和故障转移都会在会话的 `providerChain` 数组中跟踪。跟踪信息包括：

- 供应商 ID、名称、类型
- 选择原因（会话复用、初始选择、并发限制失败等）
- 选择方法（加权随机、分组过滤等）
- 熔断器状态
- 优先级、权重、成本乘数
- 决策上下文（总供应商数、过滤后的数量、优先级层级等）

这支持：
- 调试供应商选择决策
- 理解为什么跳过某些供应商
- 分析故障转移模式
- 按供应商进行成本归因

## 边缘情况处理

### 无匹配供应商

当没有供应商匹配条件时，系统返回 503 错误，并包含详细的上下文信息：
- 系统中的总供应商数
- 每个过滤阶段通过的数量
- 哪些供应商被过滤及原因
- 用户的有效分组

### 所有供应商达到限额

当所有供应商超过成本限额时，系统记录哪个限额被超出，并继续故障转移链中的下一个供应商。

### 并发会话限制竞态条件

为防止并发会话跟踪中的竞态条件，系统使用原子 Redis Lua 脚本执行以下操作：
1. 清理过期会话（超过 5 分钟）
2. 检查会话是否已被跟踪
3. 获取当前并发计数
4. 检查是否超过限制（排除已跟踪的会话）
5. 使用 ZADD 跟踪会话
6. 返回状态

### 熔断器状态转换

熔断器实现三状态机：

- **关闭** -> **开启**：当失败次数超过阈值（默认 5 次）
- **开启** -> **半开**：当熔断持续时间到期（默认 30 分钟）
- **半开** -> **关闭**：当成功次数达到阈值（默认 2 次）
- **半开** -> **开启**：半开状态下发生任何失败

供应商类型熔断器使用更简单的两状态机（关闭/开启），没有半开状态。

### 会话供应商分组不匹配

当会话尝试复用供应商但用户的分组不再有权访问时，系统拒绝复用并重新选择供应商。

## 使用示例

### 基础多供应商配置

配置两个 Anthropic 供应商实现高可用：

```json
{
  "name": "Anthropic Primary",
  "url": "https://api.anthropic.com",
  "key": "sk-ant-api-key-1",
  "providerType": "claude",
  "priority": 0,
  "weight": 2,
  "limitDailyUsd": 100
}
```

```json
{
  "name": "Anthropic Backup",
  "url": "https://api.anthropic.com",
  "key": "sk-ant-api-key-2",
  "providerType": "claude",
  "priority": 1,
  "weight": 1,
  "limitDailyUsd": 50
}
```

### 成本优化配置

配置主供应商和成本优化供应商：

```json
{
  "name": "Premium Provider",
  "url": "https://api.anthropic.com",
  "key": "premium-key",
  "providerType": "claude",
  "priority": 0,
  "costMultiplier": 1.0
}
```

```json
{
  "name": "Budget Provider",
  "url": "https://budget-api.example.com",
  "key": "budget-key",
  "providerType": "openai-compatible",
  "priority": 1,
  "costMultiplier": 0.5,
  "modelRedirects": {
    "claude-sonnet-4-5": "gpt-4o"
  }
}
```

### 分组访问控制

为不同团队配置供应商分组：

```json
{
  "name": "Enterprise Provider",
  "url": "https://enterprise.example.com",
  "key": "enterprise-key",
  "groupTag": "enterprise",
  "providerType": "claude"
}
```

```json
{
  "name": "Standard Provider",
  "url": "https://standard.example.com",
  "key": "standard-key",
  "groupTag": "standard",
  "providerType": "claude"
}
```

将用户分配到 `enterprise` 组以访问企业级供应商，或分配到 `standard` 组以访问标准供应商。

### 模型白名单配置

限制供应商只支持特定模型：

```json
{
  "name": "Limited Provider",
  "url": "https://api.example.com",
  "key": "api-key",
  "providerType": "claude",
  "allowedModels": ["claude-sonnet-4-5", "claude-haiku-4-5"]
}
```

## 监控和调试

### 查看供应商链

在请求日志中查看 `providerChain` 字段以了解供应商选择决策过程。每个条目包含：
- 选择原因和方法
- 决策上下文（过滤前后的供应商数量）
- 失败原因（如果有）

### 检查熔断器状态

通过管理界面或 API 检查供应商熔断器状态：
- 关闭：供应商健康，正常接受请求
- 开启：供应商熔断，暂时不接受请求
- 半开：试探性接受请求以检查恢复情况

### 分析成本分布

使用 `costMultiplier` 和权重配置分析不同供应商的成本分布，优化路由策略以实现成本目标。

## 最佳实践

1. **始终配置至少两个供应商**：确保高可用性，避免单点故障
2. **使用优先级分层**：主供应商使用优先级 0，备用供应商使用更高数字
3. **设置合理的成本限额**：防止意外超支，同时确保服务可用性
4. **配置适当的权重**：根据供应商性能和成本调整权重
5. **使用分组进行访问控制**：为不同用户或团队隔离供应商访问
6. **监控供应商链**：定期审查故障转移模式，识别问题供应商
7. **测试故障转移**：定期模拟供应商故障，验证故障转移机制正常工作
8. **配置模型重定向**：为第三方供应商配置适当的模型映射
9. **设置合理的熔断器阈值**：避免过于敏感的熔断导致不必要的故障转移
10. **使用会话粘性**：多轮对话保持在同一供应商以维持上下文一致性
