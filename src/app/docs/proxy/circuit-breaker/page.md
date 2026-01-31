---
dimensions:
  type:
    primary: reference
    detail: guide
  level: intermediate
standard_title: 熔断器机制
language: zh
---

# 熔断器机制

熔断器是 Claude Code Hub 代理服务的核心保护机制，用于防止级联故障。当上游供应商出现不稳定或不可用时，熔断器会自动切断对该供应商的请求，避免资源浪费，并在适当时候尝试恢复。

## 为什么需要熔断器

在高并发场景下，如果某个供应商持续返回错误，系统会不断向其发送请求，导致：

- **资源耗尽**：大量请求阻塞等待超时，占用连接池和线程
- **级联故障**：一个供应商的问题可能拖垮整个代理服务
- **用户体验差**：请求长时间挂起后才返回错误

熔断器通过快速失败（Fail-Fast）机制，在检测到供应商异常时立即拒绝请求，保护系统稳定性。

## 三层保护架构

Claude Code Hub 实现了三个层级的熔断器保护：

| 层级 | 作用范围 | 文件位置 | 特点 |
|------|----------|----------|------|
| **供应商级** | 单个供应商 | `src/lib/circuit-breaker.ts` | 完整三态，可配置 |
| **端点级** | 单个端点 | `src/lib/endpoint-circuit-breaker.ts` | 阈值更敏感 |
| **厂商类型级** | 厂商+类型组合 | `src/lib/vendor-type-circuit-breaker.ts` | 两态，无半开，支持手动熔断，默认熔断 60 秒 |

{% callout type="note" title="层级关系" %}
当端点级熔断器打开时，对应供应商的请求会被阻止；当厂商类型级熔断器打开时，该厂商所有同类型端点都会被阻止。这种分层设计提供了精细和粗粒度相结合的保护。
{% /callout %}

## 状态机详解

熔断器采用经典的三状态状态机：

```
┌─────────┐     失败次数 >= 阈值      ┌─────────┐
│ CLOSED  │ ───────────────────────> │  OPEN   │
│ (关闭)  │                          │ (打开)  │
└─────────┘                          └────┬────┘
     ▲                                    │
     │ 半开成功次数 >= 阈值               │ 熔断时长到期
     │                                    ▼
     └────────────────────────────  ┌─────────┐
                                    │HALF_OPEN│
                                    │(半开)   │
                                    └─────────┘
                                           │
                                           │ 失败次数 >= 阈值
                                           ▼
                                    ┌─────────┐
                                    │  OPEN   │
                                    │ (重新打开)│
                                    └─────────┘
```

### CLOSED（关闭状态）

- **行为**：所有请求正常通过
- **触发条件**：系统初始状态，或半开恢复成功
- **监控**：持续统计失败次数

### OPEN（打开状态）

- **行为**：请求被立即拒绝，不发送到供应商
- **触发条件**：连续失败次数达到 `failureThreshold`
- **恢复**：等待 `openDuration` 后自动进入 HALF_OPEN

### HALF_OPEN（半开状态）

- **行为**：允许有限请求通过，测试供应商是否恢复
- **触发条件**：OPEN 状态持续时间到期
- **成功**：连续成功次数达到 `halfOpenSuccessThreshold` 后回到 CLOSED
- **失败**：失败次数再次达到阈值则回到 OPEN

{% callout type="note" title="半开状态的重要细节" %}
进入 HALF_OPEN 时，`halfOpenSuccessCount` 会被重置为 0，但 `failureCount` 会继续累积。这意味着在半开状态下，如果失败次数再次达到 `failureThreshold`，熔断器会重新打开。
{% /callout %}

## 配置参数

### 供应商级配置

每个供应商可以独立配置熔断器参数，存储在数据库中：

| 参数 | 字段名 | 默认值 | 说明 |
|------|--------|--------|------|
| 失败阈值 | `circuitBreakerFailureThreshold` | 5 | 连续失败多少次后打开熔断器 |
| 熔断时长 | `circuitBreakerOpenDuration` | 1800000 (30分钟) | 熔断器保持打开的毫秒数 |
| 恢复阈值 | `circuitBreakerHalfOpenSuccessThreshold` | 2 | 半开状态下需要连续成功多少次才能关闭 |

{% callout type="note" title="禁用熔断器" %}
将 `failureThreshold` 设为 0 可以完全禁用该供应商的熔断器。这适用于关键供应商，确保其永远不会被熔断。
{% /callout %}

### 端点级默认配置

端点级熔断器使用更敏感的默认阈值：

```typescript
{
  failureThreshold: 3,           // 3 次连续失败
  openDuration: 300000,          // 5 分钟
  halfOpenSuccessThreshold: 1    // 1 次成功即可恢复
}
```

端点级配置目前不支持按端点单独设置，所有端点共享 `DEFAULT_ENDPOINT_CIRCUIT_BREAKER_CONFIG`。

### 环境变量

| 变量名 | 默认值 | 说明 |
|--------|--------|------|
| `ENABLE_CIRCUIT_BREAKER_ON_NETWORK_ERRORS` | `false` | 是否将网络错误计入熔断器统计 |
| `MAX_RETRY_ATTEMPTS_DEFAULT` | `2` | 默认最大重试次数 |

## Redis 状态存储

熔断器状态通过 Redis 持久化，支持多实例部署时的状态同步。

### 状态存储结构

**供应商级熔断器**:
```
Key: circuit_breaker:state:{providerId}
Fields:
  - failureCount: number           // 当前连续失败次数
  - lastFailureTime: number|null   // 最后一次失败时间戳
  - circuitState: "closed"|"open"|"half-open"
  - circuitOpenUntil: number|null  // 熔断到期时间戳
  - halfOpenSuccessCount: number   // 半开状态成功次数
TTL: 24 小时
```

**端点级熔断器**:
```
Key: endpoint_circuit_breaker:state:{endpointId}
Fields: 与供应商级相同
TTL: 24 小时
```

**厂商类型级熔断器**:
```
Key: vendor_type_circuit_breaker:state:{vendorId}:{providerType}
Fields:
  - circuitState: "closed"|"open"
  - circuitOpenUntil: number|null
  - lastFailureTime: number|null
  - manualOpen: boolean           // 是否手动熔断
TTL: 30 天
```

### 配置缓存

```
Key: circuit_breaker:config:{providerId}
Fields:
  - failureThreshold: string
  - openDuration: string
  - halfOpenSuccessThreshold: string
```

配置在内存中缓存 5 分钟（`CONFIG_CACHE_TTL`），减少数据库查询压力。Redis 中的配置数据本身不设置 TTL，持久存储直到显式清除。

{% callout type="note" title="状态同步策略" %}
当供应商处于 OPEN 或 HALF_OPEN 状态时，每次访问都会从 Redis 读取最新状态。这确保了：
- 外部手动重置立即生效
- 多实例间状态保持一致
- 管理后台操作实时同步
{% /callout %}

## 智能探测

系统支持智能探测机制，主动检测处于 OPEN 状态的供应商是否已恢复。

**配置参数**：

| 变量名 | 默认值 | 说明 |
|--------|--------|------|
| `ENABLE_SMART_PROBING` | `false` | 是否启用智能探测 |
| `PROBE_INTERVAL_MS` | `10000` | 探测周期（毫秒） |
| `PROBE_TIMEOUT_MS` | `5000` | 单次探测超时（毫秒） |

当探测成功时，熔断器会从 OPEN 直接转换到 HALF_OPEN 状态，加快恢复速度。探测失败则保持 OPEN 状态，等待下次探测周期。

{% callout type="warning" title="生产环境建议" %}
智能探测默认关闭。启用后会增加额外的探测流量，可能产生费用。建议仅在关键供应商场景下启用。
{% /callout %}

## 网络错误处理

默认情况下，网络错误（如连接超时、DNS 解析失败）**不计入**熔断器统计。这是因为网络错误可能是瞬时的，不应立即熔断供应商。

如需将网络错误纳入统计，设置环境变量：

```bash
ENABLE_CIRCUIT_BREAKER_ON_NETWORK_ERRORS=true
```

无论此设置如何，发生网络错误的供应商会被临时标记为不可用，在当前请求中不会被再次选择。

## 告警通知

当熔断器状态发生变化时，系统会发送通知（如果配置了通知渠道）。

## 故障排查

### 查看熔断器状态

熔断器状态会反映在供应商详情页的**健康状态**中。状态包括：

- **健康**：CLOSED 状态，正常服务
- **熔断中**：OPEN 状态，请求被阻止
- **恢复中**：HALF_OPEN 状态，正在测试恢复

### 手动重置熔断器

管理后台提供手动重置功能，可以立即将熔断器恢复到 CLOSED 状态。这在以下场景有用：

- 已知供应商已修复，不想等待自动恢复
- 测试和调试需要
- 误熔断后的紧急恢复

### 常见问题

**Q: 为什么供应商被熔断了？**

检查供应商详情页的**错误统计**，查看连续失败的请求和错误类型。常见原因：
- API Key 失效或额度耗尽
- 供应商服务端故障
- 网络连接问题

**Q: 熔断后多久恢复？**

默认 30 分钟后进入半开状态，半开状态下需要连续 2 次成功请求才能完全恢复。可以通过调整 `circuitBreakerOpenDuration` 和 `circuitBreakerHalfOpenSuccessThreshold` 来改变恢复时间。

**Q: 多实例部署时状态如何同步？**

熔断器状态存储在 Redis 中，所有实例共享同一状态。但配置缓存（5 分钟）可能导致配置变更有短暂延迟。

## 最佳实践

1. **根据供应商稳定性调整阈值**：对于 SLA 较高的供应商，可以适当提高阈值；对于经常出问题的供应商，降低阈值以更快熔断

2. **合理设置熔断时长**：太短会导致频繁尝试失败供应商，太长会影响恢复速度。建议 5-30 分钟

3. **监控熔断器事件**：关注熔断器打开/关闭的频率，这反映了供应商的稳定性

4. **关键供应商禁用熔断**：对于业务必需的供应商，设置 `failureThreshold = 0` 禁用熔断，但确保有完善的监控和告警

5. **配合重试策略**：熔断器与重试机制配合使用，先重试几次再熔断，避免瞬时故障导致熔断

## 相关文档

- [故障转移与重试](/docs/proxy/failover-retry) - 了解请求失败后的处理策略
- [健康检查](/docs/providers/health-check) - 供应商健康状态的检测机制
- [智能路由算法](/docs/proxy/intelligent-routing) - 熔断器如何影响路由决策
