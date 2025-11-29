---
dimensions:
  type:
    primary: conceptual
    detail: mechanism
  level: intermediate
standard_title: 熔断器与故障转移
language: zh
---

# 熔断器与故障转移

熔断器（Circuit Breaker）是 Claude Code Hub 保障服务高可用性的核心机制。当上游供应商出现故障时，熔断器会自动隔离问题供应商，防止级联故障，并在供应商恢复后自动重新启用。

## 熔断器原理

### 三态状态机

熔断器采用经典的三态状态机模型，每个供应商独立维护一个熔断器实例：

```
                    失败次数达到阈值
        ┌───────────────────────────────────────┐
        │                                       ▼
    ┌───────┐                             ┌─────────┐
    │CLOSED │                             │  OPEN   │
    │(关闭) │                             │ (打开)  │
    └───┬───┘                             └────┬────┘
        │                                      │
        │ 成功请求                              │ 超时时间到期
        │ 重置失败计数                          ▼
        │                               ┌───────────┐
        └───────────────────────────────│ HALF-OPEN │
                  成功次数达到阈值       │ (半开)    │
                                        └───────────┘
```

**状态说明：**

| 状态 | 描述 | 行为 |
|------|------|------|
| **CLOSED（关闭）** | 正常状态 | 请求正常通过，记录失败次数 |
| **OPEN（打开）** | 熔断状态 | 所有请求被拒绝，等待超时 |
| **HALF-OPEN（半开）** | 恢复探测状态 | 允许少量请求测试供应商是否恢复 |

### 状态转换条件

```typescript
// 熔断器配置接口
interface CircuitBreakerConfig {
  failureThreshold: number;        // 触发熔断的失败次数阈值
  openDuration: number;            // 熔断持续时间（毫秒）
  halfOpenSuccessThreshold: number; // 半开状态下恢复所需的成功次数
}

// 默认配置
const DEFAULT_CONFIG = {
  failureThreshold: 5,              // 5 次失败后熔断
  openDuration: 1800000,            // 30 分钟
  halfOpenSuccessThreshold: 2       // 2 次成功后关闭熔断器
};
```

**状态转换规则：**

1. **CLOSED → OPEN**：连续失败次数达到 `failureThreshold`
2. **OPEN → HALF-OPEN**：等待 `openDuration` 超时后自动转换
3. **HALF-OPEN → CLOSED**：连续成功次数达到 `halfOpenSuccessThreshold`
4. **HALF-OPEN → OPEN**：在半开状态下发生任何失败

### 错误阈值配置

每个供应商可以独立配置熔断器参数：

```typescript
// 供应商表中的熔断器配置字段
{
  circuitBreakerFailureThreshold: 5,        // 失败阈值
  circuitBreakerOpenDuration: 1800000,      // 打开持续时间 (30分钟)
  circuitBreakerHalfOpenSuccessThreshold: 2 // 半开成功阈值
}
```

## 智能探测机制

### 半开状态探测

当熔断器处于 OPEN 状态时，系统支持两种恢复方式：

1. **被动恢复**：等待 `openDuration` 超时后自动转为 HALF-OPEN
2. **主动探测**：通过智能探测机制提前检测供应商恢复

智能探测调度器会定期对处于 OPEN 状态的供应商发送测试请求：

```typescript
// 智能探测配置（环境变量）
ENABLE_SMART_PROBING=true     // 启用智能探测
PROBE_INTERVAL_MS=30000       // 探测间隔（默认 30 秒）
PROBE_TIMEOUT_MS=5000         // 探测超时（默认 5 秒）
```

### 探测流程

```
┌─────────────────────────────────────────────────────┐
│                  智能探测调度器                       │
│                                                     │
│  1. 获取所有 OPEN 状态的供应商                        │
│  2. 对每个供应商发送测试请求                          │
│  3. 如果探测成功 → 转换到 HALF-OPEN                  │
│  4. 如果探测失败 → 保持 OPEN 状态                    │
│                                                     │
│  间隔: PROBE_INTERVAL_MS                            │
└─────────────────────────────────────────────────────┘
```

### 自动恢复逻辑

```typescript
// 探测成功后的状态转换
async function probeProvider(providerId: number): Promise<boolean> {
  const result = await executeProviderTest({
    providerUrl: config.url,
    apiKey: config.key,
    providerType: config.providerType,
    timeoutMs: PROBE_TIMEOUT_MS,
  });

  if (result.success) {
    // 转换到 HALF-OPEN 状态进行安全的恢复验证
    tripToHalfOpen(providerId);
    return true;
  }
  return false;
}
```

### 背压控制

为避免探测请求对系统造成额外负担，系统实现了以下背压控制：

1. **串行探测**：使用 `isProbing` 标志防止并发探测周期
2. **配置缓存**：供应商配置缓存 1 分钟，减少数据库查询
3. **超时控制**：每个探测请求有独立的超时限制

```typescript
let isProbing = false;

async function runProbeCycle(): Promise<void> {
  if (isProbing) {
    // 跳过本次周期，上一周期仍在运行
    return;
  }

  isProbing = true;
  try {
    // 执行探测逻辑
  } finally {
    isProbing = false;
  }
}
```

## 故障转移策略

### 自动切换到备用供应商

当请求遇到熔断的供应商时，系统会自动选择下一个可用供应商：

```
请求到达
    │
    ▼
┌─────────────────────────────┐
│   Provider Selector         │
│   检查供应商熔断状态          │
└─────────────────────────────┘
    │
    ├── 供应商 A: OPEN → 跳过
    ├── 供应商 B: OPEN → 跳过
    └── 供应商 C: CLOSED → 选中
            │
            ▼
       转发请求
```

供应商选择算法会过滤掉所有处于 OPEN 状态的供应商：

```typescript
// 供应商选择流程
async function selectProvider(session: ProxySession): Promise<Provider | null> {
  // 1. 获取所有启用的供应商
  const providers = await getEnabledProviders();

  // 2. 过滤掉熔断状态的供应商
  const availableProviders = providers.filter(async (p) => {
    const isOpen = await isCircuitOpen(p.id);
    return !isOpen;
  });

  // 3. 按权重进行加权随机选择
  return weightedRandomSelect(availableProviders);
}
```

### 重试策略

请求失败时，系统会记录失败并尝试下一个供应商：

```typescript
// 请求失败处理
async function handleRequestFailure(
  providerId: number,
  error: Error
): Promise<void> {
  // 记录失败，可能触发熔断器状态转换
  await recordFailure(providerId, error);

  // 如果熔断器打开，发送告警通知
  if (health.circuitState === 'open') {
    await triggerCircuitBreakerAlert(providerId, ...);
  }
}
```

### 最大重试次数

系统通过供应商链（Provider Chain）记录请求的路由历史，防止无限重试：

```typescript
interface MessageRequestLog {
  // ...
  providerChain: { id: number; name: string }[];  // 供应商链
}
```

当所有可用供应商都失败时，系统会返回错误响应而不是继续重试。

## 配置参数

### 供应商级别配置

在管理后台为每个供应商配置独立的熔断参数：

| 参数 | 说明 | 默认值 | 建议范围 |
|------|------|--------|----------|
| `circuitBreakerFailureThreshold` | 触发熔断的连续失败次数 | 5 | 3-10 |
| `circuitBreakerOpenDuration` | 熔断持续时间（毫秒） | 1800000 (30分钟) | 60000-3600000 |
| `circuitBreakerHalfOpenSuccessThreshold` | 恢复所需的连续成功次数 | 2 | 1-5 |

### 全局智能探测配置

通过环境变量配置智能探测行为：

```bash
# 启用智能探测（默认关闭）
ENABLE_SMART_PROBING=true

# 探测间隔（毫秒，默认 30 秒）
PROBE_INTERVAL_MS=30000

# 单次探测超时（毫秒，默认 5 秒）
PROBE_TIMEOUT_MS=5000
```

### 配置缓存策略

熔断器配置使用两级缓存：

1. **Redis 缓存**：持久化配置，跨实例共享
2. **内存缓存**：5 分钟 TTL，减少 Redis 查询

```typescript
// 配置缓存 TTL
const CONFIG_CACHE_TTL = 5 * 60 * 1000;  // 5 分钟

// 缓存未命中时从 Redis/数据库加载
async function getProviderConfig(providerId: number): Promise<CircuitBreakerConfig> {
  const health = getOrCreateHealth(providerId);

  // 检查内存缓存
  if (health.config && Date.now() - health.configLoadedAt < CONFIG_CACHE_TTL) {
    return health.config;
  }

  // 从 Redis/数据库加载
  const config = await loadProviderCircuitConfig(providerId);
  health.config = config;
  health.configLoadedAt = Date.now();

  return config;
}
```

## 监控与告警

### 熔断器状态监控

系统提供 API 获取所有供应商的熔断器状态：

```typescript
// 获取所有供应商的健康状态
function getAllHealthStatus(): Record<number, ProviderHealth> {
  // 返回每个供应商的：
  // - failureCount: 当前失败次数
  // - circuitState: 熔断器状态
  // - circuitOpenUntil: 熔断器打开截止时间
  // - halfOpenSuccessCount: 半开状态成功次数
}
```

### 熔断告警通知

当熔断器打开时，系统会自动发送告警通知：

```typescript
// 告警通知内容
interface CircuitBreakerAlert {
  providerName: string;    // 供应商名称
  providerId: number;      // 供应商 ID
  failureCount: number;    // 失败次数
  retryAt: string;         // 预计恢复时间
  lastError: string;       // 最后一次错误信息
}
```

告警可以发送到企业微信机器人等 Webhook 端点。

## 手动干预

### 手动重置熔断器

运维人员可以手动重置供应商的熔断器状态：

```typescript
// 完全重置熔断器到 CLOSED 状态
function resetCircuit(providerId: number): void {
  const health = getOrCreateHealth(providerId);

  health.circuitState = 'closed';
  health.failureCount = 0;
  health.lastFailureTime = null;
  health.circuitOpenUntil = null;
  health.halfOpenSuccessCount = 0;
}
```

### 手动触发探测

可以手动对特定供应商触发探测请求：

```typescript
// 手动触发探测
async function triggerManualProbe(providerId: number): Promise<boolean> {
  await loadProviderConfigs();
  return probeProvider(providerId);
}
```

## 最佳实践

1. **合理设置失败阈值**：根据供应商的稳定性调整，不稳定的供应商可以设置较低的阈值
2. **启用智能探测**：在生产环境启用智能探测，加快故障恢复速度
3. **监控熔断事件**：配置告警通知，及时发现供应商故障
4. **定期检查配置**：确保熔断器配置与供应商 SLA 相匹配
5. **使用多供应商**：配置多个供应商并合理分配权重，提高系统整体可用性
