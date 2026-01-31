---
dimensions:
  type:
    primary: reference
    detail: guide
  level: intermediate
standard_title: 负载均衡
language: zh
---

# 负载均衡

负载均衡是 Claude Code Hub 代理服务的核心功能，负责在多个供应商之间智能分配请求流量。系统通过多层过滤管道、成本感知选择和加权随机算法，实现高可用性、成本优化和智能故障转移。

{% callout type="note" title="核心目标" %}
负载均衡系统旨在实现以下目标：
- **高可用性**：即使单个供应商故障，服务也能持续可用
- **成本优化**：优先将请求路由到成本倍率较低的供应商
- **会话粘性**：通过复用供应商保持对话连续性
- **健康感知路由**：通过熔断器和健康检查避免不健康的供应商
- **多租户隔离**：通过供应商分组标签隔离不同用户群体
{% /callout %}

## 负载均衡架构

Claude Code Hub 的负载均衡在两个层面运作：

| 层级 | 作用范围 | 决策内容 |
|------|----------|----------|
| **供应商级别** | 多个供应商之间 | 选择哪个供应商处理请求 |
| **端点级别** | 单个供应商内部 | 选择哪个端点 (URL) 发送请求 |

### 供应商选择流程

供应商选择遵循多阶段过滤管道：

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│ 1. 会话复用检查 │ -> │ 2. 分组预过滤   │ -> │ 3. 基础过滤     │
└─────────────────┘    └─────────────────┘    └─────────────────┘
                                                          │
┌─────────────────┐    ┌─────────────────┐    ┌────────▼────────┐
│ 6. 加权随机选择 │ <- │ 5. 优先级分层   │ <- │ 4. 健康检查     │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

**第一阶段：会话复用检查**

如果会话存在且绑定的供应商健康，系统会复用该供应商以确保对话连续性。

**第二阶段：分组预过滤**

根据用户的 `providerGroup` 标签过滤供应商，确保用户只能访问授权的供应商。

**第三阶段：基础过滤**

- 移除禁用的供应商
- 移除排除的供应商（重试中失败的）
- 格式/类型兼容性检查
- 模型支持检查

**第四阶段：1M 上下文过滤**

如果请求使用 1M 上下文窗口，过滤掉禁用 1M 上下文的供应商。

**第五阶段：健康检查过滤**

- 厂商类型临时熔断检查
- 供应商熔断器检查
- 费用限制检查（5小时、日、周、月、总消费）
- 并发会话限制检查

**第六阶段：优先级分层 + 成本排序 + 加权随机选择**

1. 仅选择最高优先级的供应商（最小数字）
2. 按 `costMultiplier` 升序排序（成本低的在前）
3. 基于供应商权重进行加权随机选择

### 端点选择流程

在选定的供应商内，端点按以下标准排序：

1. **熔断器状态**：优先选择 `closed` 状态的端点
2. **探测状态**：优先选择 `lastProbeOk = true` 的端点
3. **排序顺序**：配置的 `sortOrder` 优先级
4. **延迟**：最低延迟优先
5. **ID**：稳定的决胜因素

## 加权随机选择算法

系统使用加权随机算法在候选供应商中进行选择，确保权重高的供应商有更高的被选概率。

```typescript
// 按 costMultiplier 升序排序（便宜的优先）
const sorted = [...providers].sort((a, b) => 
  a.costMultiplier - b.costMultiplier
);

// 计算总权重
const totalWeight = sorted.reduce((sum, p) => sum + p.weight, 0);

// 生成随机数
const random = Math.random() * totalWeight;
let cumulativeWeight = 0;

// 选择供应商
for (const provider of sorted) {
  cumulativeWeight += provider.weight;
  if (random < cumulativeWeight) {
    return provider;
  }
}
```

**概率计算示例**：

假设有三个供应商，权重分别为 1、2、3：

| 供应商 | 权重 | 选择概率 |
|--------|------|----------|
| A | 1 | 16.7% |
| B | 2 | 33.3% |
| C | 3 | 50% |

如果总权重为 0，系统会回退到均匀随机选择，每个供应商具有相等的概率。

## 优先级分层机制

优先级字段 (`priority`) 用于实现供应商分层，数值越小优先级越高。

```typescript
const minPriority = Math.min(...providers.map((p) => p.priority || 0));
const topPriorityProviders = providers.filter(
  (p) => (p.priority || 0) === minPriority
);
```

系统只考虑具有最高优先级的供应商进行选择。这种设计允许你：

- 将主力供应商设为 `priority=0`
- 将备用供应商设为 `priority=1`
- 将紧急备份供应商设为 `priority=2` 或更高

## 健康度负载均衡

### 熔断器集成

负载均衡与三层熔断器紧密集成：

| 层级 | 作用范围 | 状态 |
|------|----------|------|
| **供应商级** | 单个供应商 | Closed / Open / Half-Open |
| **端点级** | 单个端点 | Closed / Open / Half-Open |
| **厂商类型级** | 厂商+类型组合 | Closed / Open |

处于 `Open` 状态的供应商会被过滤掉，不会参与负载均衡选择。

### 并发会话限制

系统使用 Redis Lua 脚本进行原子性检查并追踪：

```lua
-- CHECK_AND_TRACK_SESSION
-- 1. 清理过期会话（5分钟前）
-- 2. 检查会话是否已被追踪
-- 3. 如果计数 < 限制，添加会话并返回成功
-- 4. 否则返回失败及当前计数
```

这防止了竞态条件，即多个请求同时通过限制检查。

### 费用限制检查

系统检查多个时间窗口的费用限制：

| 时间窗口 | 存储方式 | 重置规则 |
|----------|----------|----------|
| 5小时 | ZSET 滚动窗口 | 滚动计算 |
| 日 | STRING 或 ZSET | 固定或滚动模式 |
| 周 | STRING | 周一 00:00 重置 |
| 月 | STRING | 每月1日 00:00 重置 |
| 总消费 | STRING | 手动重置 |

达到费用限制的供应商会被排除出候选池。

### 端点探测状态

端点定期被探测健康状况，探测结果影响负载均衡决策：

- `lastProbeOk`：布尔成功状态
- `lastProbeLatencyMs`：响应时间
- `lastProbeStatusCode`：HTTP 状态码

探测成功的端点优先被选择。

## 故障转移与重试

### 内层循环（端点重试）

| 错误类型 | 处理策略 |
|----------|----------|
| 网络错误 (`SYSTEM_ERROR`) | 切换到下一个端点，最多重试 `maxAttemptsPerProvider` 次 |
| 供应商错误 (4xx/5xx) | 保持在同一端点，最多重试 `maxAttemptsPerProvider` 次 |
| 客户端中止/不可重试错误 | 立即停止 |

### 外层循环（供应商切换）

当所有端点耗尽或达到最大重试次数时：

1. 将失败的供应商加入 `failedProviderIds` 排除列表
2. 选择下一个可用供应商
3. 重置重试计数器，开始新一轮内层循环
4. 最多允许 `MAX_PROVIDER_SWITCHES` (20) 次供应商切换

## 配置参数

### 供应商配置字段

以下字段影响负载均衡决策：

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `weight` | number | 1 | 选择权重 (1-100)，越高越可能被选中 |
| `priority` | number | 0 | 优先级级别（越小优先级越高） |
| `costMultiplier` | number | 1.0 | 计费成本倍率 |
| `groupTag` | string | null | 供应商分组标签，逗号分隔 |
| `isEnabled` | boolean | true | 供应商是否启用 |
| `limitConcurrentSessions` | number | 0 | 最大并发会话数（0 = 无限制） |
| `maxRetryAttempts` | number \| null | null | 每个供应商的最大重试次数 |
| `circuitBreakerFailureThreshold` | number | 5 | 熔断前失败次数 |
| `circuitBreakerOpenDuration` | number | 1800000 | 熔断持续时间（毫秒，默认30分钟） |
| `circuitBreakerHalfOpenSuccessThreshold` | number | 2 | 关闭熔断所需的成功次数 |

### 端点配置字段

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `url` | string | 必需 | 端点 URL |
| `sortOrder` | number | 0 | 排序优先级（越小越高） |
| `isEnabled` | boolean | true | 端点是否启用 |
| `providerType` | string | 'claude' | 供应商类型分类 |

### 验证规则

| 字段 | 有效范围 |
|------|----------|
| `weight` | 1-100（拒绝: 0、负数、>100） |
| `priority` | 非负整数 |
| `limitConcurrentSessions` | 0-150（0 = 无限制） |
| `maxRetryAttempts` | 1-10 |

## 会话复用（粘性会话）

对于多轮对话，系统会尝试复用之前绑定的供应商：

1. **绑定时机**：请求成功完成后绑定
2. **存储位置**：Redis `session:{sessionId}:provider`
3. **TTL**：默认 300 秒
4. **复用验证**：检查供应商健康状态、分组权限、费用限制

如果绑定的供应商变得不健康，系统会拒绝复用并触发重新选择。

## 决策上下文日志

系统记录每个请求的详细决策上下文，用于调试和监控：

```typescript
interface DecisionContext {
  totalProviders: number;           // 系统中供应商总数
  enabledProviders: number;         // 基础过滤后的数量
  targetType: string;               // 从请求格式推断
  requestedModel: string;           // 原始请求的模型
  groupFilterApplied: boolean;      // 是否应用了分组过滤
  userGroup?: string;               // 用户的供应商分组
  beforeHealthCheck: number;        // 健康过滤前的供应商数
  afterHealthCheck: number;         // 健康过滤后的供应商数
  filteredProviders: Array<{        // 供应商被过滤的原因
    id: number;
    name: string;
    reason: 'circuit_open' | 'rate_limited' | ...;
    details?: string;
  }>;
  priorityLevels: number[];         // 可用的优先级级别
  selectedPriority: number;         // 选定的优先级级别
  candidatesAtPriority: Array<{     // 该优先级的候选者
    id: number;
    name: string;
    weight: number;
    costMultiplier: number;
    probability?: number;
  }>;
}
```

## 边界情况处理

### 所有供应商不可用

当所有供应商被过滤掉时：

- 返回 HTTP 503 Service Unavailable
- 错误类型: `rate_limit_exceeded`、`circuit_breaker_open`、`mixed_unavailable`
- 详细上下文日志包括被过滤供应商的原因

### 网络错误 vs 供应商错误

**网络错误 (`SYSTEM_ERROR`)**：
- 默认不计入熔断器（可通过 `ENABLE_CIRCUIT_BREAKER_ON_NETWORK_ERRORS` 启用）
- 切换到下一个端点
- 耗尽重试后切换到下一个供应商

**供应商错误 (4xx/5xx)**：
- 计入熔断器
- 保持在同一端点进行重试
- 达到最大重试后切换供应商

**不可重试的客户端错误**：
- 包括: prompt 过长、内容过滤、PDF 限制、thinking 格式错误
- 不计入熔断器
- 立即返回错误，不重试

### 最大供应商切换安全限制

为防止无限循环：

- 每个请求最多 20 次供应商切换
- 达到限制后返回 503 错误
- 记录为安全限制超出

### 供应商分组隔离

严格执行分组隔离：

- 用户只能看到匹配其分组标签的供应商
- 如果供应商不再属于用户分组，会话复用将被拒绝
- 支持每个供应商多个标签（逗号分隔）

## 最佳实践

### 配置建议

**主力供应商**：
- `priority=0`
- `weight=较高值`（如 5-10）
- `costMultiplier=1.0`

**备用供应商**：
- `priority=1`
- `weight=中等值`（如 3-5）
- `costMultiplier<=1.0`

**廉价供应商**：
- `priority=0`
- `weight=较低值`（如 1-2）
- `costMultiplier<1.0`

### 高可用配置

1. 配置至少两个不同 Vendor 的供应商，避免单点故障
2. 为每个供应商配置多个端点（如果可用）
3. 设置合理的熔断阈值（建议 3-5 次失败）
4. 监控 `filteredProviders` 了解过滤原因分布

### 成本优化

1. 将低成本供应商设为相同优先级但较低权重
2. 使用 `costMultiplier` 控制成本排序
3. 定期审查供应商使用率和成本分布

### 分组隔离

1. 为不同用户群体配置独立的供应商组
2. 使用描述性的分组标签（如 `premium`、`internal`、`trial`）
3. 定期审查未配置分组的供应商访问权限

## 相关文档

- [智能路由算法](/docs/proxy/intelligent-routing) - 了解路由决策的完整流程
- [熔断器机制](/docs/proxy/circuit-breaker) - 了解熔断器的工作原理
- [故障转移与重试](/docs/proxy/failover-retry) - 了解请求失败后的处理策略
- [限流](/docs/proxy/rate-limiting) - 了解金额限流和并发限制
- [会话管理](/docs/proxy/session-management) - 了解会话绑定和复用机制
