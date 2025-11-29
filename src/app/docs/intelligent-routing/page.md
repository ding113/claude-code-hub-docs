---
dimensions:
  type:
    primary: conceptual
    detail: architecture
  level: intermediate
standard_title: 智能调度与负载均衡
language: zh
---

# 智能调度与负载均衡

Claude Code Hub 的智能调度系统是整个代理平台的核心组件，负责在多个上游供应商之间进行智能路由决策。本文将深入解析调度算法原理、权重计算机制、分组策略以及决策链追踪功能。

## 调度算法原理

### 整体流程

调度器（`ProxyProviderResolver`）采用多阶段过滤与加权选择的混合策略：

```
请求到达
    │
    ▼
┌─────────────────┐
│  1. 会话复用检查  │  ← 检查是否有绑定的供应商
└────────┬────────┘
         │ 无绑定
         ▼
┌─────────────────┐
│  2. 基础过滤     │  ← 启用状态、格式兼容、模型支持
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  3. 分组过滤     │  ← 用户分组隔离
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  4. 健康度过滤   │  ← 限流检查、熔断器状态
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  5. 优先级分层   │  ← 选择最高优先级层
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  6. 加权随机选择  │  ← 成本排序 + 权重概率
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  7. 并发检查     │  ← 原子性并发 Session 验证
└────────┬────────┘
         │
         ▼
    选定供应商
```

### 会话复用机制

当请求携带 `x-session-id` 头时，系统会优先尝试复用之前绑定的供应商：

1. **查询缓存**: 从 Redis 读取 Session 绑定的 Provider ID
2. **有效性验证**:
   - 供应商是否仍然启用
   - 熔断器是否处于打开状态
   - 是否支持请求的模型
   - 是否符合用户分组权限
3. **复用决策**: 通过所有验证则复用，否则重新选择

会话复用的优势：
- 保持对话上下文一致性
- 减少调度开销
- 避免频繁切换供应商带来的延迟波动

### 基础过滤规则

第一轮过滤确保供应商的基本可用性：

```typescript
// 过滤条件
1. isEnabled === true        // 供应商已启用
2. !excludeIds.includes(id)  // 不在排除列表中
3. 格式类型兼容              // 请求格式与供应商类型匹配
4. 模型支持                  // 供应商支持请求的模型
```

**格式类型兼容映射**:

| 请求格式 | 兼容的供应商类型 |
|----------|------------------|
| `claude` | `claude`, `claude-auth` |
| `response` | `codex` |
| `openai` | `openai-compatible` |
| `gemini` | `gemini` |
| `gemini-cli` | `gemini-cli` |

**模型支持判断逻辑**:

对于 Claude 模型请求（`claude-*`）:
- Anthropic 供应商：检查 `allowedModels` 白名单
- 非 Anthropic 供应商：需开启 `joinClaudePool` 且配置模型重定向

对于非 Claude 模型请求:
- 优先检查显式声明（`allowedModels` 或 `modelRedirects`）
- Anthropic 供应商默认不支持非 Claude 模型
- 非 Anthropic 供应商：未设置 `allowedModels` 时接受任意模型

### 健康状态过滤

健康度过滤包含两个维度：

**1. 熔断器状态检查**

```typescript
if (await isCircuitOpen(provider.id)) {
  // 跳过该供应商
}
```

只有熔断器处于 CLOSED（关闭）或 HALF-OPEN（半开）状态的供应商才能参与调度。

**2. 消费限额检查**

```typescript
const costCheck = await RateLimitService.checkCostLimits(provider.id, "provider", {
  limit_5h_usd,      // 5 小时限额
  limit_daily_usd,   // 每日限额
  limit_weekly_usd,  // 每周限额
  limit_monthly_usd  // 每月限额
});
```

任一限额达到上限的供应商都会被过滤。

## 权重计算与选择

### 优先级分层

系统首先按 `priority` 字段进行分层，**只选择优先级数值最小（最高优先）的供应商**：

```typescript
// 找到最小的优先级值
const minPriority = Math.min(...providers.map(p => p.priority || 0));

// 只返回该优先级的供应商
return providers.filter(p => (p.priority || 0) === minPriority);
```

**优先级使用场景**:
- 主备切换：主供应商 priority=0，备用供应商 priority=1
- 成本分层：经济型 priority=0，高端型 priority=1
- 地域分流：本地供应商 priority=0，跨境供应商 priority=1

### 成本排序

在同一优先级内，供应商按 `costMultiplier`（成本倍率）升序排序：

```typescript
const sorted = [...providers].sort((a, b) => {
  return a.costMultiplier - b.costMultiplier;
});
```

这确保了低成本供应商在加权选择时获得位置优势。

### 加权随机选择

最终选择采用加权随机算法：

```typescript
function weightedRandom(providers: Provider[]): Provider {
  // 计算总权重
  const totalWeight = providers.reduce((sum, p) => sum + p.weight, 0);

  // 生成随机数
  const random = Math.random() * totalWeight;

  // 累积权重选择
  let cumulativeWeight = 0;
  for (const provider of providers) {
    cumulativeWeight += provider.weight;
    if (random < cumulativeWeight) {
      return provider;
    }
  }

  return providers[providers.length - 1];
}
```

**选中概率计算**:

```
供应商选中概率 = 供应商权重 / 总权重 * 100%
```

**示例**:
| 供应商 | 权重 | 选中概率 |
|--------|------|----------|
| A | 10 | 50% |
| B | 6 | 30% |
| C | 4 | 20% |

### 动态权重调整策略

虽然当前版本权重为静态配置，但系统设计支持以下动态调整场景：

1. **响应延迟反馈**: 根据历史响应时间动态调整权重
2. **错误率惩罚**: 高错误率供应商自动降低权重
3. **余额感知**: 根据供应商剩余额度调整权重（规划中）

### 失败惩罚机制

当选中的供应商请求失败时，系统会：

1. **加入排除列表**: 将失败供应商 ID 加入 `excludeIds`
2. **重新选择**: 在剩余供应商中重复调度流程
3. **最大重试**: 最多尝试 3 次故障转移

```typescript
// 故障转移循环
while (true) {
  if (!session.provider) break;

  // 并发检查失败
  if (!checkResult.allowed) {
    excludedProviders.push(session.provider.id);
    // 重新选择...
    continue;
  }

  // 成功
  return null;
}
```

## 分组调度

### 供应商分组概念

分组（Group）机制实现了用户与供应商之间的隔离：

- **用户分组**（`user.providerGroup`）: 用户所属的分组，支持多分组（逗号分隔）
- **供应商标签**（`provider.groupTag`）: 供应商所属的分组，支持多标签

### 分组匹配规则

```typescript
// 用户分组处理
const userGroups = userGroup.split(',').map(g => g.trim());

// 供应商标签处理
const providerTags = provider.groupTag.split(',').map(t => t.trim());

// 检查是否有交集
const hasIntersection = providerTags.some(tag => userGroups.includes(tag));
```

**匹配示例**:

| 用户分组 | 供应商标签 | 是否匹配 |
|----------|------------|----------|
| `cli` | `cli` | 是 |
| `cli` | `cli,web` | 是 |
| `cli,web` | `chat` | 否 |
| `api` | `api,internal` | 是 |

### 组内负载均衡

分组过滤后，剩余供应商仍按照标准的优先级 + 权重算法进行选择：

```
全部供应商
    │ 分组过滤
    ▼
分组内供应商
    │ 健康过滤
    ▼
健康供应商
    │ 优先级分层
    ▼
最高优先级供应商
    │ 加权随机
    ▼
选中供应商
```

### 严格分组隔离

系统采用严格分组隔离策略：

- **有分组用户**: 只能使用对应分组的供应商，无匹配时返回 503 错误
- **无分组用户**: 可以使用所有启用的供应商（全局用户）

```typescript
if (groupFiltered.length === 0) {
  // 严格隔离：返回错误而不是 fallback
  logger.error("Strict group isolation: returning null");
  return { provider: null, context };
}
```

### 跨组故障转移

当用户指定分组内的所有供应商都不可用时：

1. **不会 fallback**: 系统不会自动切换到其他分组
2. **返回明确错误**: 503 错误，说明该分组无可用供应商
3. **管理员干预**: 需要管理员调整供应商配置或扩展分组

## 决策链追踪

### 日志记录

每次调度决策都会记录详细的决策上下文：

```typescript
interface DecisionContext {
  totalProviders: number;       // 总供应商数
  enabledProviders: number;     // 启用的供应商数
  targetType: string;           // 目标供应商类型
  requestedModel: string;       // 请求的模型
  groupFilterApplied: boolean;  // 是否应用了分组过滤
  beforeHealthCheck: number;    // 健康检查前的候选数
  afterHealthCheck: number;     // 健康检查后的候选数
  priorityLevels: number[];     // 所有优先级层级
  selectedPriority: number;     // 选中的优先级
  candidatesAtPriority: [];     // 该优先级的候选供应商
  filteredProviders: [];        // 被过滤的供应商及原因
}
```

### Provider Chain 记录

每个请求的供应商决策链会被记录到数据库：

```typescript
interface ProviderChainItem {
  id: number;                   // 供应商 ID
  name: string;                 // 供应商名称
  reason: string;               // 选择/失败原因
  selectionMethod: string;      // 选择方法
  circuitState: string;         // 熔断器状态
  attemptNumber?: number;       // 尝试次数
  errorMessage?: string;        // 错误信息
  decisionContext?: object;     // 决策上下文
}
```

**记录的 reason 类型**:
| reason | 说明 |
|--------|------|
| `session_reuse` | 会话复用 |
| `initial_selection` | 首次选择 |
| `concurrent_limit_failed` | 并发限制失败 |
| `request_failed` | 请求失败 |
| `failover_success` | 故障转移成功 |

### 调度路径可视化

在管理后台的日志详情中，可以查看完整的调度路径：

```
请求 #12345 调度路径:
├─ [1] 供应商 A (session_reuse) → 熔断器打开，跳过
├─ [2] 供应商 B (weighted_random) → 并发限制，切换
├─ [3] 供应商 C (weighted_random) → 请求失败，重试
└─ [4] 供应商 D (weighted_random) → 成功 ✓
```

### 过滤原因追踪

系统会记录每个被过滤供应商的原因：

| 原因 | 说明 |
|------|------|
| `disabled` | 供应商已禁用 |
| `excluded` | 在排除列表中（前序失败） |
| `format_type_mismatch` | 格式类型不匹配 |
| `model_not_allowed` | 不支持请求的模型 |
| `circuit_open` | 熔断器打开 |
| `rate_limited` | 达到消费限额 |

## 调度配置最佳实践

### 高可用配置

```yaml
# 主供应商集群（优先级 0）
主供应商 1:
  priority: 0
  weight: 5

主供应商 2:
  priority: 0
  weight: 5

# 备用供应商（优先级 1）
备用供应商:
  priority: 1
  weight: 10
```

### 成本优化配置

```yaml
# 高权重低成本
经济供应商:
  priority: 0
  weight: 8
  costMultiplier: 0.7

# 低权重高质量
高端供应商:
  priority: 0
  weight: 2
  costMultiplier: 1.5
```

### 流量灰度配置

```yaml
# 新供应商试用（低权重）
新供应商:
  priority: 0
  weight: 1

# 稳定供应商（高权重）
稳定供应商:
  priority: 0
  weight: 9
```

## 相关文档

- [供应商管理](/docs/provider-management) - 供应商配置详解
- [熔断器机制](/docs/circuit-breaker) - 熔断器工作原理
- [会话管理](/docs/session-management) - Session 粘性机制
- [限流与配额](/docs/rate-limiting) - 消费限额控制
