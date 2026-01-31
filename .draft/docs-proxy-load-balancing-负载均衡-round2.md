# 负载均衡 (Load Balancing)

## 1. 设计意图 (Design Intent)

claude-code-hub 的代理模块实现了一套复杂的多层负载均衡系统，旨在解决以下核心问题：

1. **高可用性 (High Availability)**: 即使单个供应商出现故障，也能确保服务持续可用
2. **成本优化 (Cost Optimization)**: 优先将请求路由到成本倍率较低的供应商
3. **会话粘性 (Session Stickiness)**: 通过复用供应商保持对话连续性
4. **健康感知路由 (Health-Aware Routing)**: 通过熔断器和健康检查避免不健康的供应商
5. **多租户隔离 (Multi-Tenancy Support)**: 通过供应商分组标签隔离不同用户群体
6. **智能故障转移 (Intelligent Failover)**: 自动切换供应商以优雅地处理故障

负载均衡在两个层面运作：
- **供应商级别 (Provider Level)**: 选择哪个供应商处理请求
- **端点级别 (Endpoint Level)**: 在选定的供应商/厂商内选择哪个端点 (URL)

## 2. 行为概述 (Behavior Summary)

### 2.1 供应商选择流程

供应商选择遵循多阶段过滤管道：

```
1. 会话复用检查
   └── 如果会话存在且供应商健康 → 复用供应商
   
2. 分组预过滤（静默）
   └── 根据用户的 providerGroup 标签过滤供应商
   
3. 基础过滤
   ├── 移除禁用的供应商
   ├── 移除排除的供应商（重试中失败的）
   ├── 格式/类型兼容性检查
   └── 模型支持检查
   
4. 1M 上下文过滤（如适用）
   └── 过滤掉禁用 1M 上下文的供应商
   
5. 健康检查过滤
   ├── 厂商类型临时熔断检查
   ├── 供应商熔断器检查
   ├── 费用限制检查（5h、日、周、月、总消费）
   └── 并发会话限制检查
   
6. 优先级分层
   └── 仅选择最高优先级的供应商（最小数字）
   
7. 成本排序 + 加权随机选择
   ├── 按 costMultiplier 升序排序
   └── 基于供应商权重进行加权随机选择
```

### 2.2 端点选择流程

在选定的供应商内，端点按以下标准排序：

```
1. 熔断器状态（优先选择 closed 状态的端点）
2. 探测状态（优先选择 lastProbeOk = true 的端点）
3. 排序顺序（配置的优先级）
4. 延迟（最低延迟优先）
5. ID（稳定的决胜因素）
```

### 2.3 重试和故障转移行为

**内层循环（端点重试）**:
- 网络错误 (SYSTEM_ERROR): 切换到下一个端点，最多重试 maxAttemptsPerProvider 次
- 供应商错误 (4xx/5xx): 保持在同一端点，最多重试 maxAttemptsPerProvider 次
- 客户端中止/不可重试错误: 立即停止

**外层循环（供应商切换）**:
- 当所有端点耗尽或达到最大重试次数 → 切换到替代供应商
- 最多允许 MAX_PROVIDER_SWITCHES (20) 次供应商切换

## 3. 配置与命令 (Configuration & Commands)

### 3.1 供应商配置字段

| 字段 | 类型 | 默认值 | 描述 |
|------|------|--------|------|
| `weight` | integer | 1 | 选择权重 (1-100)，越高越可能被选中 |
| `priority` | integer | 0 | 优先级级别（越小优先级越高） |
| `costMultiplier` | decimal | 1.0 | 计费成本倍率 |
| `groupTag` | string | null | 供应商分组标签，逗号分隔 |
| `isEnabled` | boolean | true | 供应商是否启用 |
| `limitConcurrentSessions` | integer | 0 | 最大并发会话数（0 = 无限制） |
| `maxRetryAttempts` | integer | null | 每个供应商的最大重试次数（null = 使用默认值） |
| `circuitBreakerFailureThreshold` | integer | 5 | 熔断前失败次数 |
| `circuitBreakerOpenDuration` | integer | 1800000 | 熔断持续时间（毫秒，默认30分钟） |
| `circuitBreakerHalfOpenSuccessThreshold` | integer | 2 | 关闭熔断所需的成功次数 |

### 3.2 端点配置字段

| 字段 | 类型 | 默认值 | 描述 |
|------|------|--------|------|
| `url` | string | 必需 | 端点 URL |
| `sortOrder` | integer | 0 | 排序优先级（越小越高） |
| `isEnabled` | boolean | true | 端点是否启用 |
| `providerType` | enum | 'claude' | 供应商类型分类 |

### 3.3 数据库 Schema

**供应商表** (`providers`):
```sql
- weight: integer NOT NULL DEFAULT 1
- priority: integer NOT NULL DEFAULT 0
- cost_multiplier: numeric(10,4) DEFAULT '1.0'
- group_tag: varchar(50)
- is_enabled: boolean NOT NULL DEFAULT true
- limit_concurrent_sessions: integer DEFAULT 0
- provider_type: varchar(20) DEFAULT 'claude'
- provider_vendor_id: integer NOT NULL (FK to provider_vendors)
```

**供应商端点表** (`provider_endpoints`):
```sql
- vendor_id: integer NOT NULL (FK to provider_vendors)
- provider_type: varchar(20) NOT NULL DEFAULT 'claude'
- url: text NOT NULL
- sort_order: integer NOT NULL DEFAULT 0
- is_enabled: boolean NOT NULL DEFAULT true
- last_probe_ok: boolean
- last_probe_latency_ms: integer
```

**性能优化索引**:
```sql
idx_providers_enabled_priority ON (isEnabled, priority, weight) WHERE deletedAt IS NULL
idx_providers_group ON (groupTag) WHERE deletedAt IS NULL
idx_providers_vendor_type ON (providerVendorId, providerType) WHERE deletedAt IS NULL
idx_provider_endpoints_vendor_type ON (vendorId, providerType) WHERE deletedAt IS NULL
```

### 3.4 验证规则

**Weight**: 1-100 的整数（拒绝: 0、负数、>100）
**Priority**: 非负整数
**Concurrent Sessions**: 0-150（0 = 无限制）
**Retry Attempts**: 1-10（可通过 PROVIDER_LIMITS 配置）

### 3.5 API 端点

**供应商管理**:
- `POST /api/actions/providers` - 创建供应商
- `PUT /api/actions/providers/:id` - 更新供应商
- `GET /api/actions/providers` - 列出供应商

**端点管理**:
- 通过供应商厂商界面管理

## 4. 算法详解 (Algorithms)

### 4.1 加权随机选择

```typescript
private static weightedRandom(providers: Provider[]): Provider {
  const totalWeight = providers.reduce((sum, p) => sum + p.weight, 0);
  
  if (totalWeight === 0) {
    return providers[Math.floor(Math.random() * providers.length)];
  }
  
  const random = Math.random() * totalWeight;
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

**概率计算**:
```typescript
const probability = totalWeight > 0 ? provider.weight / totalWeight : 1 / count;
```

### 4.2 成本感知选择 (selectOptimal)

```typescript
private static selectOptimal(providers: Provider[]): Provider {
  if (providers.length === 1) return providers[0];
  
  // 按 costMultiplier 升序排序（便宜的优先）
  const sorted = [...providers].sort((a, b) => 
    a.costMultiplier - b.costMultiplier
  );
  
  // 在排序后的列表上应用加权随机
  return weightedRandom(sorted);
}
```

这确保了：
- 优先选择成本较低的供应商
- 权重仍在相同成本层级内影响选择
- 成本优化而不会完全忽略权重

### 4.3 优先级分层

```typescript
private static selectTopPriority(providers: Provider[]): Provider[] {
  const minPriority = Math.min(...providers.map((p) => p.priority || 0));
  return providers.filter((p) => (p.priority || 0) === minPriority);
}
```

仅考虑具有最高优先级（最小数字）的供应商进行选择。

### 4.4 端点排序算法

```typescript
function rankProviderEndpoints(endpoints: ProviderEndpoint[]): ProviderEndpoint[] {
  const priorityRank = (endpoint: ProviderEndpoint): number => {
    if (endpoint.lastProbeOk === true) return 0;
    if (endpoint.lastProbeOk === null) return 1;
    return 2;
  };
  
  return enabled.slice().sort((a, b) => {
    // 1. 探测状态排序
    const rankDiff = priorityRank(a) - priorityRank(b);
    if (rankDiff !== 0) return rankDiff;
    
    // 2. 配置的排序顺序
    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
    
    // 3. 延迟（越低越好）
    const aLatency = a.lastProbeLatencyMs ?? Infinity;
    const bLatency = b.lastProbeLatencyMs ?? Infinity;
    if (aLatency !== bLatency) return aLatency - bLatency;
    
    // 4. 稳定决胜因素
    return a.id - b.id;
  });
}
```

## 5. 健康度负载均衡 (Health-Based Load Balancing)

### 5.1 熔断器状态

**供应商级别熔断器** (`src/lib/circuit-breaker.ts`):
- **Closed**: 正常运行，允许请求通过
- **Open**: 超过失败阈值，在 `openDuration` 内阻止请求
- **Half-Open**: 超时后，允许测试请求

**端点级别熔断器** (`src/lib/endpoint-circuit-breaker.ts`):
- 与供应商级别相同的状态机
- 每个端点独立配置
- 默认: 3 次失败，5 分钟熔断持续时间，1 次成功关闭

**厂商类型临时熔断器** (`src/lib/vendor-type-circuit-breaker.ts`):
- 针对特定厂商+类型的组合熔断
- 当某厂商某类型的所有端点都超时时触发
- 支持手动开启/关闭

### 5.2 熔断器配置

```typescript
interface CircuitBreakerConfig {
  failureThreshold: number;        // 默认: 5（供应商）, 3（端点）
  openDuration: number;            // 默认: 1800000ms（30分钟，供应商）, 300000ms（5分钟，端点）
  halfOpenSuccessThreshold: number; // 默认: 2（供应商）, 1（端点）
}
```

### 5.3 健康检查集成

**供应商健康过滤** (`filterByLimits`):
1. 检查厂商类型临时熔断（vendor+type）
2. 检查供应商熔断器状态
3. 检查费用限制（5h、日、周、月、总消费）
4. 检查并发会话限制（原子性检查并追踪）

**端点健康过滤**:
1. 过滤掉熔断器打开的端点
2. 按探测状态和延迟排序

### 5.4 并发会话限制

使用 Redis Lua 脚本进行原子性检查并追踪：

```lua
-- CHECK_AND_TRACK_SESSION
-- 1. 清理过期会话（5分钟前）
-- 2. 检查会话是否已被追踪
-- 3. 如果计数 < 限制，添加会话并返回成功
-- 4. 否则返回失败及当前计数
```

这防止了竞态条件，即多个请求同时通过限制检查。

### 5.5 费用限制追踪

**时间窗口**:
- 5h: 滚动窗口（使用 ZSET + Lua 脚本）
- 日: 固定或滚动模式
- 周: 固定窗口（周一 00:00 重置）
- 月: 固定窗口（每月1日 00:00 重置）
- 总消费: 自上次重置以来累计

**Redis Key 模式**:
```
provider:{id}:cost_5h_rolling      # ZSET 用于滚动窗口
provider:{id}:cost_daily_{HHmm}    # STRING 用于固定日窗口
provider:{id}:cost_daily_rolling   # ZSET 用于滚动日窗口
provider:{id}:cost_weekly          # STRING
provider:{id}:cost_monthly         # STRING
```

### 5.6 端点探测

端点定期被探测健康状况：
- **定时**: 后台任务探测所有端点
- **手动**: 管理员触发探测
- **运行时**: 失败时探测以验证恢复

探测结果存储在：
- `lastProbeOk`: 布尔成功状态
- `lastProbeLatencyMs`: 响应时间
- `lastProbeStatusCode`: HTTP 状态码
- `lastProbeErrorType/Message`: 错误详情

## 6. 边界情况 (Edge Cases)

### 6.1 所有供应商不可用

当所有供应商被过滤掉（熔断打开、速率限制等）时：
- 返回 HTTP 503 Service Unavailable
- 错误类型: `rate_limit_exceeded`, `circuit_breaker_open`, `mixed_unavailable`
- 详细上下文日志包括被过滤供应商的原因

### 6.2 会话复用与健康检查

当会话绑定的供应商变得不健康时：
1. 检查熔断器状态
2. 检查费用限制
3. 检查模型支持
4. 检查组权限
5. 如果任何检查失败 → 拒绝复用，触发重新选择

### 6.3 并发限制竞态条件

通过原子性 Lua 脚本解决：
- 单一 Redis 操作进行检查 + 追踪
- 防止多个请求同时通过限制
- 返回当前计数用于日志记录

### 6.4 网络错误 vs 供应商错误

**网络错误 (SYSTEM_ERROR)**:
- 默认不计入熔断器（可通过 `ENABLE_CIRCUIT_BREAKER_ON_NETWORK_ERRORS` 启用）
- 切换到下一个端点
- 耗尽重试后切换到下一个供应商

**供应商错误 (4xx/5xx)**:
- 计入熔断器
- 保持在同一端点进行重试
- 达到最大重试后 → 切换供应商

**不可重试的客户端错误**:
- 包括: prompt 过长、内容过滤、PDF 限制、thinking 格式错误
- 不计入熔断器
- 立即返回错误，不重试

### 6.5 空权重处理

如果总权重为 0：
- 回退到均匀随机选择
- 每个供应商具有相等的概率

### 6.6 供应商分组隔离

严格执行分组隔离：
- 用户只能看到匹配其分组标签的供应商
- 如果供应商不再属于用户分组，会话复用将被拒绝
- 支持每个供应商多个标签（逗号分隔）

### 6.7 最大供应商切换安全限制

为防止无限循环：
- 每个请求最多 20 次供应商切换
- 达到限制后 → 返回 503 错误
- 记录为安全限制超出

### 6.8 404 资源未找到错误

- 不计入熔断器
- 先重试当前供应商
- 重试耗尽后切换到下一个供应商

## 7. 代码引用 (References)

### 7.1 核心文件

| 文件 | 用途 |
|------|------|
| `src/app/v1/_lib/proxy/provider-selector.ts` | 供应商选择逻辑 |
| `src/lib/provider-endpoints/endpoint-selector.ts` | 端点排序和选择 |
| `src/app/v1/_lib/proxy/forwarder.ts` | 请求转发与重试逻辑 |
| `src/lib/circuit-breaker.ts` | 供应商熔断器 |
| `src/lib/endpoint-circuit-breaker.ts` | 端点熔断器 |
| `src/lib/vendor-type-circuit-breaker.ts` | 厂商类型临时熔断器 |
| `src/lib/rate-limit/service.ts` | 速率限制和费用追踪 |

### 7.2 类型定义

| 文件 | 用途 |
|------|------|
| `src/types/provider.ts` | 供应商和端点类型定义 |
| `src/types/message.ts` | ProviderChainItem 类型用于决策追踪 |
| `src/drizzle/schema.ts` | 数据库 Schema 定义 |

### 7.3 配置

| 文件 | 用途 |
|------|------|
| `src/lib/validation/schemas.ts` | 供应商验证 schema |
| `src/lib/constants/provider.constants.ts` | 默认值和限制 |

### 7.4 关键函数

**供应商选择**:
- `ProxyProviderResolver.ensure()` - 主入口点
- `ProxyProviderResolver.pickRandomProvider()` - 带过滤的选择
- `ProxyProviderResolver.filterByLimits()` - 健康过滤
- `ProxyProviderResolver.selectOptimal()` - 成本感知加权选择

**端点选择**:
- `getPreferredProviderEndpoints()` - 排序和过滤端点
- `rankProviderEndpoints()` - 排序算法
- `pickBestProviderEndpoint()` - 选择单个最佳端点

**熔断器**:
- `isCircuitOpen()` / `isEndpointCircuitOpen()` / `isVendorTypeCircuitOpen()` - 检查状态
- `recordFailure()` / `recordEndpointFailure()` - 记录失败
- `recordSuccess()` / `recordEndpointSuccess()` - 记录成功

**速率限制**:
- `RateLimitService.checkAndTrackProviderSession()` - 原子性并发检查
- `RateLimitService.checkCostLimitsWithLease()` - 费用限制检查
- `RateLimitService.trackCost()` - 记录请求费用

## 8. 决策上下文日志 (Decision Context Logging)

系统记录每个请求的详细决策上下文：

```typescript
interface DecisionContext {
  totalProviders: number;           // 系统中供应商总数
  enabledProviders: number;         // 基础过滤后的数量
  targetType: ProviderType;         // 从请求格式推断
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

这实现了负载均衡决策的详细调试和监控。

## 9. 模型匹配逻辑 (Model Matching Logic)

供应商选择包含复杂的模型匹配逻辑：

### 9.1 Claude 模型请求

**Anthropic 供应商** (`claude`, `claude-auth`):
- 如果 `allowedModels` 未设置或为空 → 允许所有 claude 模型
- 否则检查白名单

**非 Anthropic 供应商 + joinClaudePool**:
- 检查模型是否重定向到 claude 模型
- 通过 `modelRedirects` 配置实现

**其他情况**:
- 非 Anthropic 供应商且未加入 Claude 调度池 → 拒绝

### 9.2 非 Claude 模型请求

**显式声明优先**:
- 通过 `allowedModels` 或 `modelRedirects` 显式声明的模型优先级最高
- 允许跨类型代理（如 Claude 类型供应商转发 Gemini 请求）

**Anthropic 供应商保护**:
- Anthropic 供应商不支持未声明的非 Claude 模型
- 防止误路由到 Anthropic API

## 10. 特殊功能

### 10.1 Thinking Signature Rectifier

当检测到 thinking 格式错误时：
- 自动整流请求消息
- 重试当前供应商
- 记录重试来源（缓存或官方）

### 10.2 Codex Instructions 策略

支持三种策略：
- `auto`: 自动选择
- `force_official`: 强制使用官方 instructions
- `keep_original`: 保持原始 instructions

### 10.3 MCP 透传

支持 MCP 透传类型：
- `none`: 不启用（默认）
- `minimax`: 透传到 minimax MCP 服务
- `glm`: 透传到智谱 MCP 服务
- `custom`: 自定义 MCP 服务

---

*文档基于 claude-code-hub 代码库分析生成*
*分析日期: 2026-01-29*
*验证文件*:
- `src/app/v1/_lib/proxy/provider-selector.ts` - 供应商选择核心逻辑
- `src/lib/provider-endpoints/endpoint-selector.ts` - 端点选择逻辑
- `src/app/v1/_lib/proxy/forwarder.ts` - 请求转发与重试
- `src/lib/circuit-breaker.ts` - 供应商熔断器
- `src/lib/endpoint-circuit-breaker.ts` - 端点熔断器
- `src/lib/vendor-type-circuit-breaker.ts` - 厂商类型熔断器
- `src/lib/rate-limit/service.ts` - 速率限制服务
- `src/lib/redis/lua-scripts.ts` - Redis Lua 脚本
- `src/types/provider.ts` - 供应商类型定义
- `src/types/message.ts` - 消息和决策链类型
- `src/drizzle/schema.ts` - 数据库 Schema
- `src/lib/constants/provider.constants.ts` - 供应商常量
- `src/lib/validation/schemas.ts` - 验证 Schema
