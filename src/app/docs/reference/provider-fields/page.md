---
dimensions:
  type:
    primary: reference
    detail: api
  level: intermediate
standard_title: 供应商字段详解
language: zh
---

# 供应商字段详解

本文档详细说明 Claude Code Hub 供应商（Provider）的所有配置字段，包括字段类型、默认值、取值范围和使用场景。这是管理员配置供应商时的核心参考文档。

{% callout type="note" %}
供应商配置直接影响系统的路由策略、高可用性和成本控制。建议在修改关键字段前仔细阅读相关说明。
{% /callout %}

---

## 字段分类概览

供应商配置字段按功能分为以下几类：

| 分类 | 说明 | 关键字段 |
| --- | --- | --- |
| **基础字段** | 供应商的标识和连接信息 | id, name, url, key |
| **调度字段** | 控制请求路由和负载均衡 | weight, priority, costMultiplier, groupTag |
| **限制字段** | 并发和成本限制 | limitConcurrentSessions, limit5hUsd, limitDailyUsd |
| **超时配置** | 请求超时控制 | firstByteTimeoutStreamingMs, streamingIdleTimeoutMs |
| **代理配置** | HTTP/SOCKS 代理设置 | proxyUrl, proxyFallbackToDirect |
| **模型配置** | 模型重定向和白名单 | modelRedirects, allowedModels |
| **特性配置** | 供应商特定功能 | codexInstructionsStrategy, mcpPassthroughType |
| **上下文窗口配置** | 1M 上下文窗口控制 | context1mPreference |
| **熔断器配置** | 故障隔离和恢复 | circuitBreakerFailureThreshold 等 |
| **元数据字段** | 时间戳和软删除 | createdAt, updatedAt, deletedAt |

---

## 基础字段

基础字段定义供应商的核心标识和连接信息。

### 字段说明

| 字段名 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `id` | integer | - | 自增 | 供应商唯一标识，系统自动生成 |
| `name` | string | 是 | - | 供应商名称，用于显示和日志记录，最大 64 字符 |
| `description` | string | 否 | null | 供应商描述信息 |
| `url` | string | 是 | - | API 端点地址，最大 255 字符，必须是有效 URL |
| `key` | string | 是 | - | API 密钥，最大 1024 字符，存储时脱敏 |
| `isEnabled` | boolean | 否 | `true` | 是否启用供应商参与调度 |
| `providerType` | enum | 否 | `claude` | 供应商类型（见下表） |
| `websiteUrl` | string | 否 | null | 供应商官网地址，用于快速跳转 |
| `faviconUrl` | string | 否 | null | 网站图标 URL，系统根据 websiteUrl 自动生成 |
| `preserveClientIp` | boolean | 否 | `false` | 是否将客户端 IP 透传给上游供应商 |

### 供应商类型（providerType）

| 类型 | 说明 | 认证方式 |
| --- | --- | --- |
| `claude` | Anthropic 官方 API | x-api-key 头 + Bearer Token |
| `claude-auth` | Claude 中转服务 | 仅 Bearer Token |
| `codex` | OpenAI Codex/Response API | Bearer Token |
| `gemini` | Google Gemini API | API Key |
| `gemini-cli` | Gemini CLI 格式 | API Key |
| `openai-compatible` | OpenAI 兼容 API | Bearer Token |

### 配置示例

```json
{
  "name": "官方 Claude API",
  "url": "https://api.anthropic.com",
  "key": "sk-ant-api03-xxx...",
  "providerType": "claude",
  "isEnabled": true,
  "websiteUrl": "https://console.anthropic.com"
}
```

{% callout type="warning" %}
API Key 在数据库中以明文存储。生产环境请确保数据库访问受到严格限制。
{% /callout %}

---

## 调度相关字段

调度字段控制系统如何选择供应商处理请求，是实现智能负载均衡的核心。

### 字段说明

| 字段名 | 类型 | 默认值 | 范围 | 说明 |
| --- | --- | --- | --- | --- |
| `weight` | integer | `1` | 1-100 | 权重，同优先级内按权重比例分配流量 |
| `priority` | integer | `0` | 0-2147483647 | 优先级，数值越小越优先被选择 |
| `costMultiplier` | decimal | `1.0` | >= 0 | 成本系数，用于调整该供应商的成本计算 |
| `groupTag` | string | null | 最大 50 字符 | 分组标签，用于用户分组绑定 |

### 调度算法说明

1. **优先级优先**：系统首先选择优先级最小（最高优先级）的供应商组
2. **权重分配**：在同优先级组内，按权重比例随机分配请求
3. **健康过滤**：自动排除已禁用或已熔断的供应商
4. **会话粘性**：5 分钟内的连续请求优先路由到同一供应商

### 权重（weight）

权重决定了同优先级供应商之间的流量分配比例：

```
供应商A (weight=70) + 供应商B (weight=30)
→ A 获得 70% 流量，B 获得 30% 流量
```

{% callout type="note" %}
权重范围为 1-100，建议使用整十数值（如 10、20、50）便于理解和计算。
{% /callout %}

### 优先级（priority）

优先级用于实现主备切换和故障转移：

| 配置场景 | 主供应商 priority | 备用供应商 priority |
| --- | --- | --- |
| 主备模式 | 0 | 10 |
| 三级容灾 | 0 | 10 / 20 |
| 负载均衡 | 相同值 | 相同值 |

### 成本系数（costMultiplier）

成本系数用于调整供应商的计费计算，常见场景：

- **中转站优惠**：设为 `0.8` 表示 8 折计费
- **溢价供应商**：设为 `1.2` 表示 120% 成本
- **内部渠道**：设为 `0` 表示免费（不计入成本统计）

### 分组标签（groupTag）

分组标签用于将供应商划分到不同组，配合用户的 `providerGroup` 实现：

- **用户隔离**：不同用户组使用不同供应商池
- **资源分配**：VIP 用户使用高优供应商
- **成本控制**：按部门分配不同供应商

### 配置示例

```json
{
  "name": "主力供应商",
  "weight": 80,
  "priority": 0,
  "costMultiplier": 1.0,
  "groupTag": "production"
}
```

---

## 限制字段

限制字段用于控制供应商的并发使用和成本消耗。

### 字段说明

| 字段名 | 类型 | 默认值 | 范围 | 说明 |
| --- | --- | --- | --- | --- |
| `limitConcurrentSessions` | integer | `0` | 0-1000 | 并发 Session 上限，0 表示不限制 |
| `limit5hUsd` | decimal | null | 0-10000 | 5 小时消费上限（美元），null 不限制 |
| `limitDailyUsd` | decimal | null | 0-10000 | 每日消费上限（美元），null 不限制 |
| `dailyResetMode` | enum | `fixed` | fixed/rolling | 每日限制重置模式 |
| `dailyResetTime` | string | `00:00` | HH:mm 格式 | 固定模式的重置时间点 |
| `limitWeeklyUsd` | decimal | null | 0-50000 | 每周消费上限（美元），null 不限制 |
| `limitMonthlyUsd` | decimal | null | 0-200000 | 每月消费上限（美元），null 不限制 |

### 并发限制（limitConcurrentSessions）

控制同时活跃的会话数量，防止单供应商过载：

- **0**：不限制并发
- **正整数**：最大允许的同时活跃会话数

{% callout type="warning" %}
并发限制生效需要 Redis 可用。Redis 不可用时会 Fail-Open（允许请求）。
{% /callout %}

### 成本限制时间窗口

| 限制类型 | 窗口周期 | 说明 |
| --- | --- | --- |
| 5 小时限制 | 滚动 5 小时 | 防止短时间内大量消费 |
| 每日限制 | 固定/滚动 24 小时 | 控制每日支出 |
| 每周限制 | 自然周（周一至周日） | 周期性成本控制 |
| 每月限制 | 自然月 | 月度预算管理 |

### 每日重置模式（dailyResetMode）

| 模式 | 说明 | 使用场景 |
| --- | --- | --- |
| `fixed` | 在指定时间点重置 | 与工作时间对齐 |
| `rolling` | 滚动 24 小时窗口 | 持续平滑限制 |

### 配置示例

```json
{
  "limitConcurrentSessions": 50,
  "limit5hUsd": 100,
  "limitDailyUsd": 500,
  "dailyResetMode": "fixed",
  "dailyResetTime": "00:00",
  "limitWeeklyUsd": 2000,
  "limitMonthlyUsd": 8000
}
```

{% callout type="note" %}
成本限制基于实时计算的消费金额。当达到限制时，供应商会被临时排除在调度之外，直到窗口重置。
{% /callout %}

---

## 超时配置

超时配置用于控制与上游供应商的请求超时行为。

### 字段说明

| 字段名 | 类型 | 默认值 | 范围 | 说明 |
| --- | --- | --- | --- | --- |
| `firstByteTimeoutStreamingMs` | integer | `0` | 0 或 1000-180000 | 流式首字节超时（毫秒） |
| `streamingIdleTimeoutMs` | integer | `0` | 0 或 60000-600000 | 流式空闲超时（毫秒） |
| `requestTimeoutNonStreamingMs` | integer | `0` | 0 或 60000-1800000 | 非流式总超时（毫秒） |

{% callout type="warning" %}
值为 `0` 表示不设置超时限制。非零值必须在指定范围内。
{% /callout %}

### 流式首字节超时（firstByteTimeoutStreamingMs）

控制从发起请求到收到首个响应字节的最大等待时间：

- **作用**：解决流式请求启动缓慢问题
- **场景**：供应商响应延迟过高时快速切换
- **推荐值**：30000（30 秒）

### 流式空闲超时（streamingIdleTimeoutMs）

控制流式响应中两次数据块之间的最大间隔：

- **作用**：解决流式中途卡住问题
- **场景**：检测供应商中途无响应
- **推荐值**：60000（60 秒）
- **最小值**：如果配置，最少为 60 秒

### 非流式总超时（requestTimeoutNonStreamingMs）

控制非流式请求的总处理时间：

- **作用**：防止长请求无限挂起
- **场景**：count_tokens 等非流式 API
- **推荐值**：120000（2 分钟）

### 配置示例

```json
{
  "firstByteTimeoutStreamingMs": 30000,
  "streamingIdleTimeoutMs": 60000,
  "requestTimeoutNonStreamingMs": 120000
}
```

{% callout type="note" %}
跨境网络环境建议适当增加超时时间，避免因网络延迟导致误判。
{% /callout %}

---

## 代理配置

代理配置用于通过 HTTP/HTTPS/SOCKS 代理访问上游供应商。

### 字段说明

| 字段名 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `proxyUrl` | string | null | 代理服务器地址，最大 512 字符 |
| `proxyFallbackToDirect` | boolean | `false` | 代理失败时是否降级为直连 |

### 代理 URL 格式

支持以下代理协议：

| 协议 | 格式示例 |
| --- | --- |
| HTTP | `http://proxy.example.com:8080` |
| HTTPS | `https://proxy.example.com:8080` |
| SOCKS5 | `socks5://proxy.example.com:1080` |
| SOCKS4 | `socks4://proxy.example.com:1080` |
| 带认证 | `http://user:pass@proxy.example.com:8080` |

### 降级直连（proxyFallbackToDirect）

当代理连接失败时的处理策略：

- **false（默认）**：代理失败直接返回错误
- **true**：代理失败后尝试直接连接

{% callout type="warning" %}
启用降级直连可能导致请求绕过代理。如果代理是必须的（如合规要求），请保持关闭。
{% /callout %}

### 配置示例

```json
{
  "proxyUrl": "http://192.168.1.100:7890",
  "proxyFallbackToDirect": true
}
```

---

## IP 透传配置

IP 透传功能用于将客户端真实 IP 地址传递给上游供应商。

### 字段说明

| 字段名 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `preserveClientIp` | boolean | `false` | 是否将客户端 IP 透传给上游 |

### 工作原理

启用 IP 透传后，系统会在转发请求时添加以下 HTTP 头：

- `x-forwarded-for`：包含客户端 IP 的转发链
- `x-real-ip`：客户端的真实 IP 地址

默认情况下，系统会移除所有客户端 IP 相关的请求头以保护用户隐私。启用此选项后，这些头部会被保留并传递给上游供应商。

### IP 解析优先级

系统按以下优先级从请求头中解析客户端 IP：

| 优先级 | HTTP 头 | 说明 |
| --- | --- | --- |
| 1 | `x-forwarded-for` | 标准的代理转发头 |
| 2 | `x-real-ip` | Nginx 常用的真实 IP 头 |
| 3 | `x-client-ip` | 部分代理使用 |
| 4 | `x-originating-ip` | 部分负载均衡器使用 |
| 5 | `x-remote-ip` | 备选头部 |
| 6 | `x-remote-addr` | 备选头部 |

### 配置示例

```json
{
  "preserveClientIp": true
}
```

{% callout type="warning" title="隐私注意" %}
启用此功能会将用户的真实 IP 地址暴露给上游供应商。请确保：
- 符合相关隐私法规要求
- 已告知用户其 IP 可能被传递给第三方
- 上游供应商的隐私政策符合您的合规需求
{% /callout %}

---

## 模型配置

模型配置用于控制模型名称映射和访问限制。

### 字段说明

| 字段名 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `modelRedirects` | JSON object | null | 模型名称重定向映射 |
| `allowedModels` | JSON array | null | 允许的模型列表 |
| `joinClaudePool` | boolean | `false` | 是否加入 Claude 调度池 |

### 模型重定向（modelRedirects）

将请求中的模型名称映射到实际模型：

```json
{
  "modelRedirects": {
    "claude-3-5-sonnet-20241022": "claude-3-5-sonnet-latest",
    "gpt-4": "claude-3-opus-20240229"
  }
}
```

**使用场景**：

- 模型名称规范化
- 模型版本升级过渡
- 跨平台模型映射

### 允许模型列表（allowedModels）

根据供应商类型有不同语义：

| 供应商类型 | allowedModels 语义 |
| --- | --- |
| claude/claude-auth | **白名单**：仅允许调用列表中的模型 |
| 其他类型 | **声明列表**：供应商支持的模型列表 |

```json
{
  "allowedModels": [
    "claude-3-5-sonnet-20241022",
    "claude-3-opus-20240229",
    "claude-3-haiku-20240307"
  ]
}
```

- **null 或空数组**：不限制（允许所有模型）

### 加入 Claude 调度池（joinClaudePool）

{% callout type="warning" title="即将上线" %}
此功能正在开发中，尚未正式发布。
{% /callout %}

仅对非 Anthropic 类型供应商有效：

- **false（默认）**：独立调度
- **true**：配合 modelRedirects 加入 Claude 请求的调度池

{% callout type="note" %}
启用此选项后，非 Claude 类型的供应商也可以参与处理 Claude 模型的请求（通过模型重定向）。
{% /callout %}

---

## Codex 特殊配置

针对 Codex 类型供应商的专属配置。

### 字段说明

| 字段名 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `codexInstructionsStrategy` | enum | `auto` | Codex instructions 处理策略 |

### Instructions 处理策略

| 策略值 | 说明 | 使用场景 |
| --- | --- | --- |
| `auto` | 透传客户端 instructions，400 错误时自动重试（使用官方 instructions） | 默认推荐 |
| `force_official` | 始终强制使用官方 Codex CLI instructions | 严格合规场景 |
| `keep_original` | 始终透传客户端 instructions，不重试 | 宽松的中转站 |

{% callout type="note" %}
此配置仅对 `providerType = 'codex'` 的供应商生效。
{% /callout %}

### 配置示例

```json
{
  "providerType": "codex",
  "codexInstructionsStrategy": "auto"
}
```

---

## MCP 透传配置

MCP（Model Context Protocol）透传功能用于增强模型能力。

### 字段说明

| 字段名 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `mcpPassthroughType` | enum | `none` | MCP 透传类型 |
| `mcpPassthroughUrl` | string | null | MCP 服务 URL，最大 512 字符 |

### MCP 透传类型

| 类型值 | 说明 |
| --- | --- |
| `none` | 不启用 MCP 透传 |
| `minimax` | 透传到 minimax MCP 服务（图片识别、联网搜索） |
| `glm` | 透传到智谱 MCP 服务（预留） |
| `custom` | 自定义 MCP 服务（预留） |

### 配置示例

```json
{
  "mcpPassthroughType": "minimax",
  "mcpPassthroughUrl": "https://api.minimaxi.com"
}
```

{% callout type="warning" %}
MCP 透传 URL 禁止使用内部网络地址（localhost、私有 IP 等）以防止 SSRF 攻击。
{% /callout %}

---

## 1M 上下文窗口配置

1M 上下文窗口是 Anthropic 提供的大容量上下文功能，允许模型处理最多 100 万 token 的上下文内容。此功能通过供应商级别的配置进行控制。

### 字段说明

| 字段名 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `context1mPreference` | enum | `inherit` | 1M 上下文窗口偏好设置 |

### 配置选项（context1mPreference）

| 选项值 | 说明 | 使用场景 |
| --- | --- | --- |
| `inherit` | 继承客户端请求设置 | 默认推荐，由客户端决定是否启用 |
| `force_enable` | 强制启用 1M 上下文 | 需要确保支持长上下文的场景 |
| `disabled` | 禁用 1M 上下文 | 成本敏感场景，避免分层定价 |

### 支持的模型

1M 上下文窗口功能仅支持以下模型前缀：

| 模型前缀 | 说明 |
| --- | --- |
| `claude-sonnet-4-5` | Claude Sonnet 4.5 系列 |
| `claude-sonnet-4` | Claude Sonnet 4 系列 |

{% callout type="note" %}
模型匹配使用前缀规则，例如 `claude-sonnet-4-20250514` 会匹配 `claude-sonnet-4` 前缀。
{% /callout %}

### 分层定价

使用 1M 上下文窗口时，超过 200k token 的部分会按溢价计费：

| 定价类型 | 阈值 | 溢价倍数 | 说明 |
| --- | --- | --- | --- |
| 输入 token | >200k | 2x | 例如：$3/MTok → $6/MTok |
| 输出 token | >200k | 1.5x | 例如：$15/MTok → $22.50/MTok |

{% callout type="warning" title="成本注意" %}
启用 1M 上下文窗口后，超过 200k token 的输入和输出会按溢价计费。请根据实际使用场景评估成本影响。
{% /callout %}

### 工作原理

1. **客户端请求**：客户端通过 `anthropic-beta: context-1m-2025-08-07` 请求头申请启用 1M 上下文
2. **供应商过滤**：路由选择器会自动过滤掉设置为 `disabled` 的供应商
3. **请求转发**：对于 `inherit` 或 `force_enable` 的供应商，系统会在转发请求时添加相应的 beta 头部

### 配置示例

```json
{
  "context1mPreference": "inherit"
}
```

**强制启用示例**（适用于需要保证长上下文支持的供应商）：

```json
{
  "context1mPreference": "force_enable"
}
```

**禁用示例**（适用于成本敏感或不支持 1M 上下文的中转站）：

```json
{
  "context1mPreference": "disabled"
}
```

---

## 熔断器配置

熔断器用于隔离故障供应商，防止级联失败。

### 字段说明

| 字段名 | 类型 | 默认值 | 范围 | 说明 |
| --- | --- | --- | --- | --- |
| `circuitBreakerFailureThreshold` | integer | `5` | 1-100 | 触发熔断的连续失败次数 |
| `circuitBreakerOpenDuration` | integer | `1800000` | 1000-86400000 | 熔断持续时间（毫秒） |
| `circuitBreakerHalfOpenSuccessThreshold` | integer | `2` | 1-10 | 恢复需要的连续成功次数 |

### 熔断器状态

```
CLOSED（正常）
    ↓ 连续失败达到阈值
  OPEN（熔断）
    ↓ 等待 openDuration 后
HALF-OPEN（试探）
    ↓ 连续成功达到阈值 → CLOSED
    ↓ 发生失败 → OPEN
```

### 参数说明

- **失败阈值（failureThreshold）**：越小越敏感，越容易触发熔断
- **熔断时长（openDuration）**：建议 30 分钟（1800000ms），避免频繁探测
- **恢复阈值（halfOpenSuccessThreshold）**：建议 2-3 次，确保真正恢复

### 配置示例

```json
{
  "circuitBreakerFailureThreshold": 5,
  "circuitBreakerOpenDuration": 1800000,
  "circuitBreakerHalfOpenSuccessThreshold": 2
}
```

{% callout type="note" %}
网络不稳定的环境可以适当提高失败阈值，避免误触发熔断。
{% /callout %}

---

## 元数据字段

系统自动管理的时间戳和软删除字段。

### 字段说明

| 字段名 | 类型 | 说明 |
| --- | --- | --- |
| `createdAt` | timestamp | 创建时间，系统自动设置 |
| `updatedAt` | timestamp | 最后更新时间，每次修改自动更新 |
| `deletedAt` | timestamp | 软删除时间，非 null 表示已删除 |

### 软删除说明

- 删除供应商时设置 `deletedAt` 为当前时间
- 已删除的供应商不参与调度
- 历史日志仍可关联到已删除供应商
- 软删除数据不可恢复

---

## 废弃字段

以下字段已废弃，保留仅为向后兼容，不再生效：

| 字段名 | 类型 | 说明 |
| --- | --- | --- |
| `tpm` | integer | Tokens Per Minute（已废弃） |
| `rpm` | integer | Requests Per Minute（已废弃） |
| `rpd` | integer | Requests Per Day（已废弃） |
| `cc` | integer | Concurrent Connections（已废弃） |

{% callout type="warning" %}
请勿依赖这些废弃字段，它们可能在未来版本中移除。
{% /callout %}

---

## 完整配置示例

以下是一个典型供应商的完整配置示例：

```json
{
  "name": "主力 Claude API",
  "url": "https://api.anthropic.com",
  "key": "sk-ant-api03-xxx...",
  "providerType": "claude",
  "isEnabled": true,
  "websiteUrl": "https://console.anthropic.com",

  "weight": 70,
  "priority": 0,
  "costMultiplier": 1.0,
  "groupTag": "production",

  "limitConcurrentSessions": 50,
  "limit5hUsd": 100,
  "limitDailyUsd": 500,
  "dailyResetMode": "fixed",
  "dailyResetTime": "00:00",
  "limitWeeklyUsd": 2000,
  "limitMonthlyUsd": 8000,

  "firstByteTimeoutStreamingMs": 30000,
  "streamingIdleTimeoutMs": 60000,
  "requestTimeoutNonStreamingMs": 120000,

  "proxyUrl": null,
  "proxyFallbackToDirect": false,

  "preserveClientIp": false,

  "modelRedirects": {
    "claude-3-5-sonnet-20241022": "claude-3-5-sonnet-latest"
  },
  "allowedModels": null,

  "circuitBreakerFailureThreshold": 5,
  "circuitBreakerOpenDuration": 1800000,
  "circuitBreakerHalfOpenSuccessThreshold": 2
}
```

---

## 相关文档

- [供应商管理](/docs/guide/settings-providers) - 供应商管理页面操作指南
- [高可用机制](/docs/guide/availability) - 熔断器和故障转移详解
- [限流配置](/docs/guide/rate-limits) - 多维度限流机制说明
- [用户管理](/docs/guide/users) - 用户分组与供应商绑定
