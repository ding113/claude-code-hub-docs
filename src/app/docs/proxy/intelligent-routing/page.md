---
dimensions:
  type:
    primary: reference
    detail: guide
  level: intermediate
standard_title: 智能路由算法
language: zh
---

# 智能路由算法

Claude Code Hub 的智能路由算法是系统的核心决策引擎，负责为每个传入请求选择最优的上游供应商。该算法综合考虑成本、可靠性、负载均衡和用户体验等多个维度，实现智能化的流量调度。

{% callout type="note" title="核心目标" %}
智能路由算法旨在实现以下目标：
- **成本优化**：优先选择成本倍率较低的供应商
- **负载均衡**：通过加权随机算法分散流量
- **故障恢复**：自动在供应商间进行故障转移
- **会话一致性**：多轮对话保持供应商绑定
- **访问隔离**：不同用户组使用独立的供应商池
{% /callout %}

## 路由流程概览

路由算法采用六步选择流程，从候选供应商中筛选出最优选择：

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│  1. 分组预过滤   │ -> │ 2. 格式/模型匹配 │ -> │ 3. 1M上下文过滤 │
└─────────────────┘    └─────────────────┘    └─────────────────┘
                                                         │
┌─────────────────┐    ┌─────────────────┐    ┌────────▼────────┐
│ 6. 加权随机选择  │ <- │  5. 优先级分层   │ <- │ 4. 健康度检查   │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

### 第一步：分组预过滤

系统首先根据用户的分组权限过滤供应商。分组匹配遵循以下规则：

- **优先级**：API Key 的分组 > 用户的分组
- **多标签支持**：供应商可配置逗号分隔的多个标签（如 `premium,cli`），匹配任一标签即可访问
- **通配符**：`"*"` 表示可访问所有供应商（管理员专用）
- **严格隔离**：未配置 `groupTag` 的供应商不能被有分组限制的用户访问

{% callout type="warning" title="分组隔离原则" %}
为确保安全，供应商必须显式配置 `groupTag` 才能被对应分组的用户访问。未配置分组的供应商仅对无分组限制的用户可见。
{% /callout %}

### 第二步：格式与模型匹配

系统根据请求格式和目标模型进一步筛选供应商：

**格式兼容性检查**

| 客户端格式 | 兼容的供应商类型 |
|-----------|----------------|
| `claude` / `response` | `claude`, `claude-auth` |
| `openai` | `codex`, `openai-compatible` |
| `gemini` | `gemini` |
| `gemini-cli` | `gemini-cli` |

**模型支持检查**

- **Claude 模型**：Anthropic 类型供应商通过 `allowedModels` 白名单控制；非 Anthropic 供应商需启用 `joinClaudePool` 并配置正确的 `modelRedirects`
- **非 Claude 模型**：检查 `allowedModels` 声明或 `modelRedirects` 重定向配置

### 第三步：1M 上下文过滤

当客户端请求 1M 上下文窗口时，系统会过滤掉 `context1mPreference` 设置为 `disabled` 的供应商。只有设置为 `inherit` 或 `force_enable` 的供应商才能处理此类请求。

### 第四步：健康度检查

通过健康检查的供应商才会被纳入候选池。检查项目包括：

1. **Vendor 级熔断检查**：检查供应商所属 Vendor 的熔断状态
2. **供应商熔断检查**：检查单个供应商的熔断器状态
3. **金额限流检查**：
   - 5小时消费限额 (`limit5hUsd`)
   - 日消费限额 (`limitDailyUsd`)
   - 周消费限额 (`limitWeeklyUsd`)
   - 月消费限额 (`limitMonthlyUsd`)
   - 总消费限额 (`limitTotalUsd`)

{% callout type="note" title="并发限制检查" %}
并发 Session 限制在供应商选择后的 `ensure()` 方法中进行原子性检查，而非在此阶段，以避免竞态条件。
{% /callout %}

### 第五步：优先级分层

系统只选择最高优先级（数值最小）的供应商进入最终候选池：

| 优先级值 | 含义 | 建议用途 |
|---------|------|---------|
| 0 | 最高优先级 | 主力供应商 |
| 1 | 次高优先级 | 备用供应商 |
| 2+ | 较低优先级 | 紧急备份供应商 |

### 第六步：成本排序与加权随机选择

在相同优先级内，系统执行以下步骤：

1. **成本排序**：按 `costMultiplier` 升序排列（成本低的在前）
2. **加权随机**：根据供应商 `weight` 计算选择概率

加权随机算法示例：

```typescript
// 权重 1:2:3 的供应商，选择概率分别为 16.7% : 33.3% : 50%
const random = Math.random() * totalWeight;
let cumulativeWeight = 0;
for (const provider of providers) {
  cumulativeWeight += provider.weight;
  if (random < cumulativeWeight) return provider;
}
```

## 会话复用（粘性会话）

对于多轮对话（messages 长度 > 1），系统会尝试复用之前绑定的供应商，确保对话上下文的一致性。

### 绑定机制

- **存储位置**：Redis `session:{sessionId}:provider`
- **TTL**：默认 300 秒（可通过 `SESSION_TTL` 环境变量配置）
- **原子性**：使用 `SET NX` 命令确保只有首次绑定成功

### 复用验证

复用时会验证以下条件：
- 供应商仍存在且已启用
- 用户仍有该供应商的分组权限
- 供应商未达到金额限额
- Vendor 级熔断器未开启

{% callout type="note" title="延迟绑定策略" %}
会话绑定在请求成功完成后才进行，而非并发检查通过时。这确保会话只绑定到真正成功的供应商，避免绑定到中途失败的供应商。
{% /callout %}

## 故障转移与重试

当所选供应商失败时，系统会自动尝试其他可用供应商：

### 故障转移流程

1. **初始选择**：使用完整选择算法选定供应商
2. **并发检查**：原子性检查并追踪并发 Session 数
3. **失败处理**：将失败供应商加入排除列表，重新选择
4. **决策记录**：记录每次尝试的详细上下文
5. **耗尽返回**：所有供应商尝试失败后返回 503 错误

### 错误类型

| 错误类型 | 触发条件 |
|---------|---------|
| `no_available_providers` | 初始过滤后无可用供应商 |
| `all_providers_failed` | 所有供应商尝试后均失败 |
| `rate_limit_exceeded` | 所有供应商均达到金额限额 |
| `circuit_breaker_open` | 所有供应商熔断器均开启 |
| `concurrent_limit_exceeded` | 所有供应商均达到并发限制 |

## 供应商配置参数

以下是影响路由决策的关键配置字段：

| 字段 | 类型 | 默认值 | 说明 |
|-----|------|-------|------|
| `weight` | number | 1 | 选择权重，影响加权随机的概率 |
| `priority` | number | 0 | 优先级，数值越小优先级越高 |
| `costMultiplier` | number | 1.0 | 成本倍率，用于成本排序 |
| `groupTag` | string | null | 分组标签，支持逗号分隔多标签 |
| `providerType` | ProviderType | "claude" | 供应商类型 |
| `allowedModels` | string[] | null | 模型白名单/声明列表 |
| `modelRedirects` | Record | null | 模型名称重定向映射 |
| `joinClaudePool` | boolean | false | 非 Anthropic 供应商是否加入 Claude 调度池 |
| `limitConcurrentSessions` | number | 0 | 最大并发 Session 数（0 表示无限制） |
| `circuitBreakerFailureThreshold` | number | 5 | 熔断前允许的最大失败次数 |
| `circuitBreakerOpenDuration` | number | 1800000 | 熔断持续时间（毫秒） |
| `circuitBreakerHalfOpenSuccessThreshold` | number | 2 | 半开状态恢复所需成功次数 |

## 熔断器集成

智能路由与熔断器紧密集成，确保故障供应商被及时隔离。

### 熔断器状态

- **Closed（关闭）**：正常状态，请求通过
- **Open（打开）**：失败次数超过阈值，请求被拒绝
- **Half-Open（半开）**：超时后允许少量请求试探

### 状态转换

```
Closed --(失败数>=阈值)--> Open --(超时)--> Half-Open --(成功数>=阈值)--> Closed
                              ^                                    |
                              └────────────(任何失败)──────────────┘
```

## 决策上下文

每次路由决策都会生成详细的上下文信息，用于调试和监控：

```typescript
interface DecisionContext {
  totalProviders: number;           // 系统中供应商总数
  enabledProviders: number;         // 基础过滤后数量
  targetType: string;               // 目标供应商类型
  requestedModel: string;           // 请求的模型
  groupFilterApplied: boolean;      // 是否应用了分组过滤
  userGroup?: string;               // 用户所属分组
  afterGroupFilter?: number;        // 1M 上下文过滤后数量
  beforeHealthCheck: number;        // 健康检查前数量
  afterHealthCheck: number;         // 健康检查后数量
  filteredProviders: Array<{        // 被过滤的供应商
    id: number;
    name: string;
    reason: string;                 // 过滤原因
    details?: string;
  }>;
  priorityLevels: number[];         // 存在的优先级层级
  selectedPriority: number;         // 选中的优先级
  candidatesAtPriority: Array<{     // 同优先级候选者
    id: number;
    name: string;
    weight: number;
    costMultiplier: number;
    probability?: number;           // 选择概率
  }>;
}
```

## 最佳实践

### 配置建议

1. **主力供应商**：priority=0, weight=较高值, costMultiplier=1.0
2. **备用供应商**：priority=1, weight=中等值, costMultiplier<=1.0
3. **廉价供应商**：priority=0, weight=较低值, costMultiplier<1.0

### 故障转移策略

- 为关键业务配置至少两个不同 Vendor 的供应商
- 设置合理的熔断阈值（建议 3-5 次失败）
- 监控 `filteredProviders` 了解过滤原因分布

### 分组隔离

- 为不同用户群体配置独立的供应商组
- 使用描述性的分组标签（如 `premium`, `internal`, `trial`）
- 定期审查未配置分组的供应商访问权限

## 相关文档

- [熔断器](/docs/proxy/circuit-breaker) - 了解熔断器的工作原理和配置
- [限流](/docs/proxy/rate-limiting) - 了解金额限流和并发限制
- [会话管理](/docs/proxy/session-management) - 了解会话绑定和复用机制
- [供应商管理](/docs/provider-management) - 了解供应商配置界面
