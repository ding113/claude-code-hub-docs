---
title: 配额管理
description: 了解 Claude Code Hub 的配额管理系统，包括用户、API Key 和供应商三个层级的限额配置、租约机制、检查顺序和最佳实践
nextjs:
  metadata:
    title: 配额管理
    description: Claude Code Hub 配额管理文档
---

# 配额管理

配额管理是 Claude Code Hub 中用于控制资源使用和消费成本的核心机制。系统通过多层次、多维度的限额配置，确保资源被合理分配，防止单个用户或密钥过度消耗资源，同时为管理员提供精细化的成本控制能力。

{% callout type="note" title="配额层级" %}
配额管理在三个实体层级上运作：
- **User（用户）** - 控制单个用户的总体资源使用
- **Key（API Key）** - 控制特定密钥的资源使用
- **Provider（供应商）** - 控制上游供应商的资源消耗
{% /callout %}

## 配额类型概览

Claude Code Hub 支持以下配额类型：

| 配额类型 | 用户级 | 密钥级 | 供应商级 | 说明 |
|---------|--------|--------|----------|------|
| 总消费限额 | ✓ | ✓ | ✓ | 永久累计消费上限，支持手动重置 |
| 5小时消费 | ✓ | ✓ | ✓ | 滚动窗口消费限额 |
| 每日消费 | ✓ | ✓ | ✓ | 日消费限额，支持固定/滚动模式 |
| 每周消费 | ✓ | ✓ | ✓ | 自然周消费限额（周一 00:00 重置）|
| 每月消费 | ✓ | ✓ | ✓ | 自然月消费限额（1号 00:00 重置）|
| 并发会话 | ✓ | ✓ | ✓ | 同时进行的会话数上限 |
| 每分钟请求 | ✓ | ✗ | ✗ | 用户级请求频率限制（RPM）|

## 配额检查顺序

系统按照精心设计的顺序执行配额检查，遵循"硬限制优先于周期限制"的原则：

```
Layer 1 - 永久硬限制（最先检查）
  1. Key 总消费限额
  2. User 总消费限额

Layer 2 - 资源/频率保护
  3. Key 并发会话数
  4. User 并发会话数
  5. User RPM 限制

Layer 3 - 短期周期限制
  6. Key 5小时滚动窗口
  7. User 5小时滚动窗口
  8. Key 日限额
  9. User 日限额

Layer 4 - 中长期周期限制
  10. Key 周限额
  11. User 周限额
  12. Key 月限额
  13. User 月限额
```

{% callout type="note" title="设计原则" %}
- **硬限制优先**：永久超限的请求最早被拒绝，确保成本绝对可控
- **交替检查**：同一窗口内，Key 限制先于 User 限制检查，避免单方超限影响另一方
- **资源保护靠前**：并发和频率限制在消费检查之前，及时拦截异常流量
- **高概率优先**：短期限额先于中长期限额检查，减少无效计算
{% /callout %}

## 消费限额配置

### 时间窗口类型

| 窗口类型 | 计算方式 | 适用场景 |
|----------|----------|----------|
| **5小时滚动** | 过去5小时的累计消费 | 短期爆发控制 |
| **日限额 - 固定** | 从配置的重置时间开始24小时 | 按自然日结算 |
| **日限额 - 滚动** | 过去24小时的累计消费 | 平滑流量控制 |
| **周限额** | 自然周（周一 00:00 至下周一 00:00）| 周度预算控制 |
| **月限额** | 自然月（1日 00:00 至下月1日 00:00）| 月度预算控制 |

### 日限额重置模式

系统支持两种日限额重置模式：

**固定时间模式（Fixed）**

在配置的每日重置时间点重置计数。例如，设置重置时间为 `18:00`，则每天 18:00 重置。适合有固定结算时间点的场景。

**滚动窗口模式（Rolling）**

统计过去24小时的累计消费，无固定重置时间点，平滑计算。适合需要连续流量控制的场景。

### 配置示例

在用户或密钥管理界面配置以下字段：

```
日限额: $50.00
日重置模式: 固定
日重置时间: 00:00

周限额: $300.00
月限额: $1000.00
5小时限额: $20.00
总消费限额: $5000.00
```

## 总消费限额

总消费限额是永久性的硬限制，用于控制累计消费金额的上限。

### 重置机制

供应商的总消费限额支持手动重置：

- `totalCostResetAt` 为 null 时，从历史最早记录开始累计
- `totalCostResetAt` 有值时，从该时间点开始累计

适用于需要周期性重置总限额的场景，如每月重置。

{% callout type="warning" title="注意" %}
总消费限额是硬限制，一旦达到将完全禁止访问。设置时请确保留有足够的安全边际。
{% /callout %}

## 并发会话限制

并发会话限制控制同时进行的对话数量，防止资源被单个用户或 Key 独占。

### 会话生命周期

1. **会话创建** - 首次请求时创建会话记录
2. **会话活跃** - 每次请求更新会话时间戳
3. **会话过期** - 5分钟无活动后自动过期
4. **会话清理** - Redis ZSET 自动清理过期成员

### 配置建议

| 场景 | 建议限制 | 说明 |
|------|----------|------|
| 个人用户 | 3-5 | 正常使用场景 |
| 团队用户 | 10-20 | 多人共享账号 |
| API Key | 1-3 | 按 Key 粒度控制 |
| 供应商 | 50-150 | 防止单一供应商过载 |

{% callout type="warning" title="原子性检查" %}
供应商级别的并发限制在 Provider 选择阶段进行原子性检查，使用 Lua 脚本保证并发安全。这确保了在并发场景下的准确性。
{% /callout %}

## 租约机制（Lease）

为了提升高并发场景下的性能，系统采用租约（Lease）机制减少对数据库的频繁查询。

### 工作原理

1. **获取租约**：从数据库批量获取一段配额（如总限额的 5%）
2. **本地扣减**：请求消费从租约预算中扣减，无需访问数据库
3. **租约刷新**：租约耗尽或过期时，重新从数据库获取
4. **原子操作**：使用 Redis Lua 脚本确保扣减的原子性

### 租约配置

通过系统设置配置租约参数：

```
quotaLeasePercent5h: 5%      # 5小时限额的租约比例
quotaLeasePercentDaily: 5%   # 日限额的租约比例
quotaLeasePercentWeekly: 5%  # 周限额的租约比例
quotaLeasePercentMonthly: 5% # 月限额的租约比例
quotaLeaseCapUsd: 10.0       # 单次租约金额上限（可选）
quotaDbRefreshIntervalSeconds: 10  # 租约刷新间隔（秒）
```

### 租约计算

租约切片计算公式：

```
remainingBudget = min(limit * percent, remaining, capUsd)
```

{% callout type="note" title="性能优化" %}
租约机制将高频的数据库查询转换为低频的批量获取，在高并发场景下可显著提升性能。租约比例和上限可根据实际业务调整。
{% /callout %}

## Redis 数据结构

### 固定窗口（STRING 类型）

固定窗口使用 Redis STRING 类型存储累计消费金额：

```
Key: key:123:cost_daily_1800
Value: 15.50
TTL: 到下一个重置时间的秒数
```

更新操作使用 `INCRBYFLOAT` 命令：

```typescript
pipeline.incrbyfloat(`key:${keyId}:cost_daily_${suffix}`, cost);
pipeline.expire(`key:${keyId}:cost_daily_${suffix}`, ttlDailyKey);
```

### 滚动窗口（ZSET 类型）

滚动窗口使用 Redis Sorted Set 存储每条消费记录：

```
Key: key:123:cost_5h_rolling
Type: ZSET
Member: timestamp:requestId:cost
Score: timestamp
```

例如：

```
1715424000000:req_abc123:0.5
1715427600000:req_def456:1.2
1715431200000:req_ghi789:0.8
```

### 租约存储（STRING 类型）

租约使用 JSON 字符串存储：

```
Key: lease:key:123:daily
Value: {
  "entityType": "key",
  "entityId": 123,
  "window": "daily",
  "resetMode": "fixed",
  "resetTime": "00:00",
  "snapshotAtMs": 1715424000000,
  "currentUsage": 45.50,
  "limitAmount": 100,
  "remainingBudget": 5,
  "ttlSeconds": 10
}
```

## Fail-Open 策略

当 Redis 不可用时，系统采用 Fail-Open 策略：允许请求通过，而不是阻断服务。

### 降级行为

| 功能 | Redis 可用时 | Redis 不可用时 |
|------|--------------|----------------|
| RPM 检查 | 正常限制 | 允许通过 |
| 成本限制 | Redis + 租约 | 回退到数据库查询 |
| 并发会话 | Redis ZSET | 允许通过 |
| 租约扣减 | 原子 Lua 脚本 | 允许通过 |

### 缓存 Miss 处理

当 Redis 中不存在限额数据时（如 Redis 重启后），系统会从数据库恢复并预热缓存：

1. 检测缓存 Miss（当前值为 0 且 Key 不存在）
2. 从数据库查询历史消费记录
3. 重建 Redis ZSET 或 STRING
4. 继续正常处理

{% callout type="warning" title="运维建议" %}
虽然 Fail-Open 确保了服务连续性，但 Redis 故障期间配额功能会失效。建议：
1. 配置 Redis 监控告警
2. 尽快恢复 Redis 服务
3. 考虑部署 Redis 哨兵或集群提高可用性
{% /callout %}

## 时区和时间边界

配额管理系统使用时区感知的时间计算：

```typescript
function getCustomDailyResetTime(now: Date, resetTime: string, timezone: string): Date {
  const { hours, minutes } = parseResetTime(resetTime);
  const zonedNow = toZonedTime(now, timezone);
  const zonedResetToday = buildZonedDate(zonedNow, hours, minutes);
  const resetToday = fromZonedTime(zonedResetToday, timezone);

  if (now >= resetToday) {
    return resetToday;
  }

  return addDays(resetToday, -1);
}
```

系统使用 `date-fns-tz` 库处理时区转换，确保在全球不同地区的部署都能正确计算时间窗口。时区配置通过系统设置获取。

## 前端配额展示

### 配额状态计算

```typescript
// 计算使用率
export function getUsageRate(current: number, limit: number | null): number {
  if (!limit || limit <= 0) return 0;
  return (current / limit) * 100;
}

// 获取状态颜色
export function getQuotaColorClass(rate: number): "normal" | "warning" | "danger" | "exceeded" {
  if (rate >= 100) return "exceeded";
  if (rate >= 80) return "danger";
  if (rate >= 60) return "warning";
  return "normal";
}
```

### 状态阈值

| 使用率 | 状态 | 颜色 |
|--------|------|------|
| < 60% | 正常 | 绿色 |
| 60% - 80% | 预警 | 黄色 |
| 80% - 100% | 危险 | 橙色 |
| ≥ 100% | 超限 | 红色 |

## 最佳实践

### 分层设置限额

```
User 级别：
  - 月限额: $500（硬上限）
  - 周限额: $150（预警）
  - 日限额: $50（日常控制）
  - 5小时: $15（短期爆发）
  - 并发会话: 10

Key 级别：
  - 月限额: $200（子账号控制）
  - 日限额: $20（细粒度）
  - 并发会话: 3
```

### RPM 设置建议

- **标准模型**（如 Claude 3.5 Sonnet）：60-120 RPM
- **轻量模型**（如 GPT-3.5）：120-300 RPM
- **批处理场景**：根据实际并发需求调整

### 监控与告警

关注以下指标：

- 配额超限触发频率（各维度）
- Redis 连接状态
- 租约刷新频率
- Fail-Open 事件次数

### 限额超限日志

所有配额超限事件都会记录警告日志：

```
[RateLimit] Key total limit exceeded: key=123, reason=...
[RateLimit] User daily limit exceeded: user=456, reason=...
[RateLimit] Provider cost limit exceeded: provider=789
```

## 故障排查

### 配额未生效

1. 检查 `ENABLE_RATE_LIMIT` 是否为 `true`
2. 检查 Redis 连接是否正常
3. 检查用户/Key 的限额配置是否大于 0
4. 查看日志中的 `[RateLimit]` 相关记录

### 误触发配额限制

1. 检查是否有其他请求共享同一 User/Key
2. 检查并发会话是否包含已过期但未清理的会话
3. 验证系统时间是否同步

### Redis 性能问题

1. 检查 Redis 内存使用情况
2. 考虑调整租约参数减少查询频率
3. 监控 Redis 慢查询日志

## 相关文档

- [多维度限流](/docs/proxy/rate-limiting) - 了解限流系统的技术实现
- [API Key 管理](/docs/users/api-keys) - 配置密钥级配额
- [用户管理](/docs/users/crud) - 配置用户级配额
- [供应商管理](/docs/providers/crud) - 配置供应商级配额
- [成本追踪](/docs/monitoring/cost-tracking) - 成本统计与计费机制
