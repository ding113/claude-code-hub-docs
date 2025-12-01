---
dimensions:
  type:
    primary: reference
    detail: architecture
  level: advanced
standard_title: 智能调度详解
language: zh
---

# 智能调度详解

Claude Code Hub 的核心价值之一是**智能调度**：系统能够根据多种因素自动选择最优供应商，并在故障时无缝切换，为用户提供透明、高可用的服务体验。

本文档深入介绍调度算法的工作原理、配置方法和最佳实践。

## 调度设计目标

智能调度系统旨在实现以下目标：

1. **高可用性** - 单个供应商故障不影响服务，自动故障转移
2. **负载均衡** - 按权重分配流量，避免单点过载
3. **成本优化** - 优先使用成本更低的供应商
4. **会话连续性** - 同一对话尽量路由到同一供应商，提高缓存命中率
5. **隔离管控** - 支持用户分组，实现资源隔离

## 调度算法详解

### 整体流程

每次请求到达时，调度器按以下步骤选择供应商：

```
1. Session 复用检查
   └─ 是否有已绑定的供应商？
      ├─ 是 → 验证供应商可用性 → 复用
      └─ 否 → 进入供应商选择流程

2. 供应商选择流程
   ├─ Step 1: 基础过滤（启用状态、格式兼容、模型支持）
   ├─ Step 2: 分组过滤（用户 groupTag 匹配）
   ├─ Step 3: 健康度过滤（熔断器状态、限流检查）
   ├─ Step 4: 优先级分层（只选最高优先级）
   └─ Step 5: 加权随机选择

3. 并发检查与绑定
   └─ 原子性检查并发限制 → 成功则绑定
```

### Step 1: 基础过滤

系统首先过滤掉不符合基本条件的供应商：

| 过滤条件 | 说明 |
| --- | --- |
| 启用状态 | `isEnabled = false` 的供应商被排除 |
| 格式兼容 | 根据请求格式（Claude/OpenAI/Codex/Gemini）匹配供应商类型 |
| 模型支持 | 检查供应商是否支持请求的模型 |
| 排除列表 | 已在当前请求中失败的供应商被排除 |

**格式与供应商类型映射**：

| 请求格式 | 兼容的供应商类型 |
| --- | --- |
| `claude` | claude, claude-auth |
| `response` | codex |
| `openai` | openai-compatible |
| `gemini` | gemini |
| `gemini-cli` | gemini-cli |

### Step 2: 分组过滤

如果用户配置了 `providerGroup`，系统会进行严格的分组隔离：

- 只有 `groupTag` 与用户分组匹配的供应商才会被选中
- 支持多分组匹配（逗号分隔，如 `cli,chat`）
- 无匹配供应商时返回错误，不会降级到全局供应商

{% callout type="warning" title="严格分组隔离" %}
当用户配置了分组后，系统会严格执行分组隔离策略。如果该分组下没有可用供应商，请求会失败并返回 503 错误，而不是降级到其他分组的供应商。这是为了确保资源隔离的安全性。
{% /callout %}

### Step 3: 健康度过滤

检查每个候选供应商的运行状态：

| 检查项 | 说明 |
| --- | --- |
| 熔断器状态 | `OPEN` 状态的供应商被排除 |
| 金额限制 | 超过 5 小时/日/周/月限额的供应商被排除 |

{% callout type="note" title="并发检查延后" %}
并发 Session 限制检查被延后到选择完成后执行。这是为了使用原子性检查（Check and Track），避免竞态条件导致的并发超限。
{% /callout %}

### Step 4: 优先级分层

从健康的候选供应商中，选择**优先级最高**（数值最小）的一批：

```
示例：
供应商 A: priority = 0  ← 被选入
供应商 B: priority = 0  ← 被选入
供应商 C: priority = 1  ← 被过滤
供应商 D: priority = 2  ← 被过滤
```

只有优先级相同的供应商才会进入下一步的加权选择。

### Step 5: 加权随机选择

在同优先级的供应商中，系统执行：

1. **成本排序** - 按 `costMultiplier` 升序排序（成本低的在前）
2. **加权随机** - 根据 `weight` 进行加权随机选择

选中概率计算公式：

```
供应商 X 的选中概率 = weight_X / sum(所有候选供应商的 weight)
```

{% callout type="note" title="权重为 0 的处理" %}
如果所有候选供应商的权重之和为 0，系统会退化为等概率随机选择。
{% /callout %}

## Session 粘性

### 设计目的

Session 粘性机制确保同一对话的多次请求路由到同一供应商，带来以下好处：

1. **提高缓存命中率** - Claude API 支持 Prompt Caching，同供应商更容易命中缓存
2. **降低成本** - 缓存命中可显著降低 Token 计费
3. **一致性体验** - 避免不同供应商间的响应差异

### 工作原理

```
请求 1 (messages.length = 1)
└─ 首次请求，无绑定 → 执行供应商选择
└─ 请求成功 → 绑定 session:provider

请求 2 (messages.length = 3)
└─ 检查 shouldReuseProvider() = true (length > 1)
└─ 读取 session:provider → 复用已绑定供应商
```

**复用条件**：

- `messages.length > 1`（对话有历史上下文）
- Redis 中存在 session 绑定记录
- 绑定的供应商仍然可用（启用、未熔断、分组匹配）

### TTL 配置

Session 绑定信息存储在 Redis 中，默认 TTL 为 **5 分钟**（300 秒）。

可通过环境变量调整：

```bash
SESSION_TTL=300  # 单位：秒
```

{% callout type="note" title="滑动窗口" %}
每次成功复用 session 时，TTL 会被刷新。这意味着持续活跃的对话可以一直保持 session 绑定。
{% /callout %}

### 智能绑定策略

系统采用智能绑定策略，在以下情况会更新绑定：

| 场景 | 行为 |
| --- | --- |
| 首次成功 | 使用 `SET NX` 原子绑定，避免并发覆盖 |
| 故障转移成功 | 无条件更新到新供应商 |
| 原供应商熔断 | 更新到新的可用供应商 |
| 新供应商优先级更高 | 迁移到高优先级供应商 |
| 其他情况 | 保持原绑定（稳定性优先） |

## 权重配置

### 权重范围

权重值范围为 **0-100**，代表供应商在同优先级组中被选中的相对概率。

### 配置建议

| 场景 | 推荐配置 |
| --- | --- |
| 主力供应商 | weight = 80-100 |
| 备用供应商 | weight = 20-50 |
| 仅用于故障转移 | weight = 1-10 |
| 暂时禁用（保留配置） | weight = 0 |

### 权重分配示例

**场景**：1 个主力供应商 + 2 个备用供应商

```yaml
供应商 A (主力):
  weight: 80
  priority: 0

供应商 B (备用):
  weight: 15
  priority: 0

供应商 C (备用):
  weight: 5
  priority: 0
```

实际选中概率：

- 供应商 A: 80%
- 供应商 B: 15%
- 供应商 C: 5%

{% callout type="note" title="权重为 0 的特殊处理" %}
权重为 0 的供应商不会被主动选中，但仍可能在 Session 复用时被使用（如果之前已绑定）。若要完全禁用供应商，请使用"禁用"开关而非设置权重为 0。
{% /callout %}

## 优先级配置

### 优先级数值含义

优先级为整数，**数值越小优先级越高**：

| 优先级值 | 典型用途 |
| --- | --- |
| 0 | 最高优先级，主力供应商 |
| 1 | 第一备用梯队 |
| 2 | 第二备用梯队 |
| 10+ | 低优先级备用 |

### 故障转移顺序

当高优先级供应商全部不可用时，系统会自动切换到下一优先级：

```
优先级 0 的供应商全部不可用
    ↓
切换到优先级 1 的供应商
    ↓
优先级 1 也不可用
    ↓
切换到优先级 2 的供应商
    ↓
...以此类推
```

### 优先级与权重配合

**最佳实践**：使用优先级实现梯队划分，使用权重实现梯队内负载均衡。

```yaml
# 第一梯队（主力）
供应商 A:
  priority: 0
  weight: 60

供应商 B:
  priority: 0
  weight: 40

# 第二梯队（备用）
供应商 C:
  priority: 1
  weight: 70

供应商 D:
  priority: 1
  weight: 30
```

正常情况下，流量按 60:40 分配到 A 和 B。当 A、B 都不可用时，流量按 70:30 分配到 C 和 D。

## 成本系数

### costMultiplier 用途

`costMultiplier` 是一个乘数，用于：

1. **费用计算** - 实际费用 = 标准费用 x costMultiplier
2. **调度优化** - 成本系数低的供应商在同优先级中会被优先排序

### 典型配置

| 供应商类型 | 推荐 costMultiplier |
| --- | --- |
| 官方 API（原价） | 1.0 |
| 折扣渠道 | 0.8-0.9 |
| 中转服务（加价） | 1.2-1.5 |
| 测试/免费额度 | 0.0 |

### 成本优化策略

系统在加权选择前会按 `costMultiplier` 升序排序，使成本更低的供应商更容易被选中（在权重相同的情况下）。

{% callout type="note" title="成本系数影响范围" %}
costMultiplier 影响的是同优先级内的排序顺序，不会跨越优先级。高优先级的高成本供应商仍然会优先于低优先级的低成本供应商。
{% /callout %}

## 分组标签

### groupTag 配置

`groupTag` 用于实现供应商分组和用户隔离：

**供应商侧**：

```yaml
供应商 A:
  groupTag: "team-a,cli"

供应商 B:
  groupTag: "team-b,chat"

供应商 C:
  groupTag: "shared"
```

**用户侧**：

```yaml
用户 Alice:
  providerGroup: "team-a"  # 只能使用 groupTag 包含 "team-a" 的供应商

用户 Bob:
  providerGroup: "cli,shared"  # 可以使用 "cli" 或 "shared" 标签的供应商

用户 Guest:
  providerGroup: null  # 全局用户，可以使用任意供应商
```

### 多标签匹配

供应商和用户都支持多标签（逗号分隔）。匹配规则是**交集匹配**：

- 用户的任一分组标签与供应商的任一标签匹配即可

### 使用场景

| 场景 | 配置方式 |
| --- | --- |
| 团队资源隔离 | 每个团队使用独立的 groupTag |
| CLI vs Chat 隔离 | 使用 `cli` 和 `chat` 标签区分用途 |
| VIP 专属通道 | 为 VIP 用户配置专属标签 |
| 测试环境隔离 | 使用 `test` 标签标记测试供应商 |

## 调度决策链

### 决策记录

每次请求的调度决策都会被记录到 `providerChain` 中，包含：

- 尝试的供应商列表
- 每次选择的原因（session_reuse、initial_selection、retry_success 等）
- 决策上下文（候选数量、过滤原因、优先级分布等）
- 熔断器状态

### 日志查看

在请求日志详情页面，可以展开查看完整的决策链：

```
决策链:
1. 供应商 A (session_reuse)
   - 原因: 复用已绑定的 session
   - 熔断状态: closed

2. 供应商 B (retry_success)
   - 原因: 供应商 A 请求失败，切换到备用
   - 选择方法: weighted_random
   - 熔断状态: closed
```

### 调试技巧

当遇到调度问题时，检查决策链中的以下信息：

1. **filteredProviders** - 哪些供应商被过滤，过滤原因是什么
2. **priorityLevels** - 当前可用的优先级层级
3. **candidatesAtPriority** - 最终参与选择的候选供应商及其权重

## 配置示例

### 高可用配置

目标：确保服务持续可用，即使主力供应商故障

```yaml
# 主力供应商 - 官方 API
供应商 A:
  name: "Anthropic Official"
  priority: 0
  weight: 100
  costMultiplier: 1.0
  circuitBreakerFailureThreshold: 5
  circuitBreakerOpenDuration: 1800000  # 30 分钟

# 备用供应商 1 - 中转服务
供应商 B:
  name: "Relay Service 1"
  priority: 1
  weight: 60
  costMultiplier: 1.2

# 备用供应商 2 - 另一中转服务
供应商 C:
  name: "Relay Service 2"
  priority: 1
  weight: 40
  costMultiplier: 1.3

# 最后防线 - 高成本但稳定
供应商 D:
  name: "Emergency Fallback"
  priority: 2
  weight: 100
  costMultiplier: 2.0
```

### 成本优化配置

目标：在保证可用性的前提下，优先使用低成本渠道

```yaml
# 折扣渠道 - 高权重
供应商 A:
  name: "Discount Channel"
  priority: 0
  weight: 80
  costMultiplier: 0.85

# 官方 API - 低权重备用
供应商 B:
  name: "Official API"
  priority: 0
  weight: 20
  costMultiplier: 1.0
```

### 分组隔离配置

目标：为不同团队提供独立的供应商池

```yaml
# 团队 A 专属
供应商 A1:
  name: "Team A - Primary"
  groupTag: "team-a"
  priority: 0
  weight: 100

供应商 A2:
  name: "Team A - Backup"
  groupTag: "team-a"
  priority: 1
  weight: 100

# 团队 B 专属
供应商 B1:
  name: "Team B - Primary"
  groupTag: "team-b"
  priority: 0
  weight: 100

# 共享供应商（所有用户可用）
供应商 Shared:
  name: "Shared Pool"
  groupTag: "shared"
  priority: 2
  weight: 100
```

对应的用户配置：

```yaml
用户 Alice:
  providerGroup: "team-a,shared"

用户 Bob:
  providerGroup: "team-b,shared"
```

## 故障转移机制

### 最大重试次数

- **每个供应商最多尝试**：2 次（首次 + 1 次重试）
- **最多切换供应商**：20 次（保险栓，防止无限循环）

### 重试触发条件

以下情况会触发切换到下一个供应商：

1. 供应商返回 5xx 错误
2. 网络超时或连接失败
3. 并发限制超限
4. 熔断器打开

### 不重试的情况

以下情况不会触发重试：

1. 客户端错误（4xx，如参数错误、内容审核）
2. 用户主动取消请求
3. 已达到最大重试次数

{% callout type="warning" title="熔断器记录" %}
只有供应商错误（5xx）会被记录到熔断器。网络错误是否计入熔断器取决于环境变量 `ENABLE_CIRCUIT_BREAKER_ON_NETWORK_ERRORS` 的配置。
{% /callout %}

## 监控与调优

### 关键指标

监控以下指标以评估调度效果：

| 指标 | 说明 | 健康标准 |
| --- | --- | --- |
| Session 复用率 | 复用 session 的请求占比 | > 60% |
| 首次成功率 | 首选供应商成功的请求占比 | > 95% |
| 故障转移率 | 需要切换供应商的请求占比 | < 5% |
| 平均供应商切换次数 | 每次请求平均切换供应商数 | < 1.1 |

### 调优建议

1. **Session 复用率低**：检查 SESSION_TTL 是否过短，或用户请求间隔是否过长
2. **首次成功率低**：检查主力供应商的稳定性，考虑调整权重或优先级
3. **故障转移率高**：检查供应商健康状态，考虑调整熔断器阈值
4. **成本过高**：检查高成本供应商是否被过多选中，调整权重分配

## 相关文档

- [供应商管理](/docs/guide/settings-providers) - 供应商配置详解
- [可用性监控](/docs/guide/availability) - 供应商健康状态监控
- [限流配置](/docs/guide/rate-limits) - 金额和并发限制
- [请求日志](/docs/guide/logs) - 查看调度决策链
