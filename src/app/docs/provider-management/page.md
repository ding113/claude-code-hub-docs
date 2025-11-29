---
dimensions:
  type:
    primary: implementation
    detail: configuration
  level: intermediate
standard_title: 供应商管理
language: zh
---

# 供应商管理

供应商（Provider）是 Claude Code Hub 的核心概念之一，代表了上游 AI API 服务的配置单元。通过灵活的供应商管理，您可以同时接入多家 AI 服务商，实现成本优化、高可用性和精细化流量控制。

## 供应商类型详解

Claude Code Hub 支持 6 种供应商类型，每种类型对应不同的上游 API 协议和认证方式。

### claude - Anthropic 官方 API

标准的 Anthropic Claude API 接入方式，使用 `x-api-key` 头进行认证。

```
类型标识: claude
认证方式: x-api-key 请求头
API 格式: Claude Messages API
适用场景: 直接对接 Anthropic 官方 API
```

**配置示例**:
- URL: `https://api.anthropic.com`
- Key: 您的 Anthropic API Key（sk-ant-...）

### claude-auth - Claude 中转服务

针对 Claude Max 订阅或第三方中转服务设计，仅使用 Bearer Token 认证，不发送 `x-api-key` 头。

```
类型标识: claude-auth
认证方式: Authorization: Bearer 请求头
API 格式: Claude Messages API
适用场景: Claude Max 订阅、第三方中转站
```

**配置示例**:
- URL: `https://your-relay-service.com`
- Key: 中转服务提供的认证令牌

### codex - OpenAI Codex 兼容

支持 OpenAI 的 Response API 格式，专为 Codex CLI 等工具设计。

```
类型标识: codex
认证方式: Authorization: Bearer 请求头
API 格式: OpenAI Response API
适用场景: Codex CLI、OpenAI 兼容服务
```

**特殊配置**:
- **Codex Instructions 策略**（`codexInstructionsStrategy`）:
  - `auto`（默认）: 透传客户端 instructions，400 错误时自动重试使用官方 instructions
  - `force_official`: 始终强制使用官方 Codex CLI instructions
  - `keep_original`: 始终透传客户端 instructions，不自动重试

### gemini - Google Gemini API

直接对接 Google Gemini API 服务。

```
类型标识: gemini
认证方式: API Key
API 格式: Gemini generateContent API
适用场景: Google Gemini 官方 API
```

### gemini-cli - Gemini CLI 模式

针对 Gemini CLI 工具优化的接入模式。

```
类型标识: gemini-cli
认证方式: API Key
API 格式: Gemini CLI 专用格式
适用场景: Gemini CLI 工具调用
```

### openai-compatible - 通用 OpenAI 兼容

支持任何兼容 OpenAI Chat Completions API 的服务。

```
类型标识: openai-compatible
认证方式: Authorization: Bearer 请求头
API 格式: OpenAI Chat Completions API
适用场景: 第三方 OpenAI 兼容服务、本地模型
```

**配置示例**:
- URL: `https://api.openai.com/v1` 或任意兼容端点
- Key: 服务提供的 API Key

## 供应商配置项详解

### 基础配置

| 配置项 | 类型 | 说明 |
|--------|------|------|
| `name` | string | 供应商名称，用于管理界面展示和日志标识 |
| `description` | string | 供应商描述信息 |
| `url` | string | 上游 API 的基础 URL |
| `key` | string | API 认证密钥 |
| `providerType` | enum | 供应商类型（见上文 6 种类型） |
| `isEnabled` | boolean | 是否启用该供应商 |

### 调度权重与优先级

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `weight` | integer | 1 | 调度权重，数值越大被选中概率越高 |
| `priority` | integer | 0 | 优先级，数值越小优先级越高（0 为最高） |
| `costMultiplier` | decimal | 1.0 | 成本倍率，用于计费和成本优化排序 |

**调度逻辑说明**:
1. 首先按 `priority` 分层，只在最高优先级层内选择
2. 同优先级内按 `costMultiplier` 排序（成本低的优先）
3. 最终通过 `weight` 进行加权随机选择

### 模型配置

| 配置项 | 类型 | 说明 |
|--------|------|------|
| `modelRedirects` | JSON | 模型重定向映射，格式为 `{"源模型": "目标模型"}` |
| `allowedModels` | JSON | 允许的模型列表（数组格式） |
| `joinClaudePool` | boolean | 非 Anthropic 供应商是否加入 Claude 调度池 |

**模型重定向示例**:
```json
{
  "claude-3-opus-20240229": "claude-3-5-sonnet-20241022",
  "gpt-4": "claude-3-5-sonnet-20241022"
}
```

**模型白名单语义**:
- **Anthropic 供应商**: `allowedModels` 作为白名单，限制可调度的 Claude 模型
- **非 Anthropic 供应商**: `allowedModels` 作为声明列表，声明该供应商支持的模型
- **空或未设置**: Anthropic 允许所有 claude 模型，非 Anthropic 允许任意模型

### 限流配置

| 配置项 | 类型 | 说明 |
|--------|------|------|
| `limit5hUsd` | decimal | 5 小时消费限额（USD） |
| `limitDailyUsd` | decimal | 每日消费限额（USD） |
| `dailyResetMode` | enum | 每日重置模式：`fixed`（固定时间）或 `rolling`（滚动窗口） |
| `dailyResetTime` | string | 每日重置时间（HH:mm 格式，仅 fixed 模式） |
| `limitWeeklyUsd` | decimal | 每周消费限额（USD） |
| `limitMonthlyUsd` | decimal | 每月消费限额（USD） |
| `limitConcurrentSessions` | integer | 并发 Session 数量限制 |

### 超时配置

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `firstByteTimeoutStreamingMs` | integer | 0 | 流式请求首字节超时（毫秒），0 表示禁用 |
| `streamingIdleTimeoutMs` | integer | 0 | 流式请求静默期超时（毫秒），最小 60 秒 |
| `requestTimeoutNonStreamingMs` | integer | 0 | 非流式请求总超时（毫秒） |

### 代理配置

| 配置项 | 类型 | 说明 |
|--------|------|------|
| `proxyUrl` | string | 代理服务器地址，支持 HTTP/HTTPS/SOCKS5 协议 |
| `proxyFallbackToDirect` | boolean | 代理失败时是否降级到直连 |

**代理 URL 格式**:
```
http://proxy.example.com:8080
https://proxy.example.com:8080
socks5://proxy.example.com:1080
socks5://user:pass@proxy.example.com:1080
```

### MCP 透传配置

| 配置项 | 类型 | 说明 |
|--------|------|------|
| `mcpPassthroughType` | enum | MCP 透传类型：`none`、`minimax`、`glm`、`custom` |
| `mcpPassthroughUrl` | string | MCP 服务基础 URL，未配置则从 provider.url 提取 |

**MCP 透传类型说明**:
- `none`（默认）: 不启用 MCP 透传
- `minimax`: 透传到 MiniMax MCP 服务（图片识别、联网搜索）
- `glm`: 透传到智谱 MCP 服务（预留）
- `custom`: 自定义 MCP 服务（预留）

### 分组标签

| 配置项 | 类型 | 说明 |
|--------|------|------|
| `groupTag` | string | 供应商分组标签，支持多标签（逗号分隔） |

**分组标签用途**:
- 实现用户与供应商的分组隔离
- 支持多标签配置，如 `"cli,chat"` 表示同时属于 cli 和 chat 分组
- 用户设置 `providerGroup` 后只能使用对应分组的供应商

### 熔断器配置

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `circuitBreakerFailureThreshold` | integer | 5 | 触发熔断的连续失败次数 |
| `circuitBreakerOpenDuration` | integer | 1800000 | 熔断器打开持续时间（毫秒，默认 30 分钟） |
| `circuitBreakerHalfOpenSuccessThreshold` | integer | 2 | 半开状态恢复所需的连续成功次数 |

### 辅助配置

| 配置项 | 类型 | 说明 |
|--------|------|------|
| `websiteUrl` | string | 供应商官网地址，便于快速跳转管理 |
| `faviconUrl` | string | 供应商图标 URL |

## 供应商状态管理

### 启用状态

供应商通过 `isEnabled` 字段控制是否参与请求调度：

- **启用** (`isEnabled: true`): 供应商加入调度池，可被选中处理请求
- **禁用** (`isEnabled: false`): 供应商从调度池移除，不会被选中

### 健康状态

系统通过多维度指标判断供应商健康状态：

1. **消费限额检查**: 5 小时/日/周/月限额是否达到
2. **并发 Session 检查**: 当前并发数是否超过限制
3. **熔断器状态**: 是否处于熔断打开状态

只有通过所有健康检查的供应商才会进入最终调度候选池。

### 熔断状态

熔断器采用经典的三状态模型：

```
        失败次数达到阈值
    ┌──────────────────────────┐
    │                          v
┌───────┐                 ┌─────────┐
│ CLOSED │                 │  OPEN   │
└───┬───┘                 └────┬────┘
    │                          │
    │ 成功                      │ 超时后进入半开
    │                          v
    │                    ┌───────────┐
    └────────────────────│ HALF-OPEN │
         成功阈值达到     └───────────┘
```

**状态说明**:
- **CLOSED（关闭）**: 正常状态，请求正常转发
- **OPEN（打开）**: 熔断状态，拒绝所有请求，直接故障转移
- **HALF-OPEN（半开）**: 试探状态，允许少量请求通过以检测恢复

## 配置最佳实践

### 多供应商高可用配置

```yaml
# 主供应商（高优先级）
供应商 A:
  priority: 0
  weight: 10
  costMultiplier: 1.0

# 备用供应商（低优先级）
供应商 B:
  priority: 1
  weight: 5
  costMultiplier: 1.2
```

### 成本优化配置

```yaml
# 低成本供应商（高权重）
经济型供应商:
  priority: 0
  weight: 8
  costMultiplier: 0.8

# 高成本供应商（低权重）
高端供应商:
  priority: 0
  weight: 2
  costMultiplier: 1.5
```

### 分组隔离配置

```yaml
# CLI 专用供应商
CLI 供应商:
  groupTag: "cli"

# Web 专用供应商
Web 供应商:
  groupTag: "web"

# 通用供应商（多分组）
通用供应商:
  groupTag: "cli,web"
```

## 相关文档

- [智能调度与负载均衡](/docs/intelligent-routing) - 了解供应商选择算法详情
- [限流与配额管理](/docs/rate-limiting) - 深入了解限流机制
- [熔断器机制](/docs/circuit-breaker) - 熔断器工作原理详解
