---
dimensions:
  type:
    primary: reference
    detail: rate-limiting
  level: advanced
standard_title: 限流规则详解
language: zh
---

# 限流规则详解

Claude Code Hub 实现了一套完整的多维度限流体系，通过 Redis 的原子性 Lua 脚本实现精确的请求控制和成本管理。本文档详细介绍限流系统的设计目标、实现机制和配置方法。

---

## 概述

### 设计目标

限流系统的核心设计目标包括：

1. **成本控制** - 防止单个用户或密钥过度消耗 API 资源
2. **公平调度** - 确保多用户场景下的资源公平分配
3. **服务保护** - 防止上游供应商因过载而不可用
4. **高可用性** - 采用 Fail-Open 策略，Redis 故障时不阻塞业务

### 限流层级

限流检查按以下顺序执行：

```
请求到达
    │
    ▼
┌─────────────────────────┐
│   用户层限流 (User)      │  ← RPM + 每日消费额度
└───────────┬─────────────┘
            │
            ▼
┌─────────────────────────┐
│   密钥层限流 (Key)       │  ← 5h/日/周/月金额 + 并发 Session
└───────────┬─────────────┘
            │
            ▼
┌─────────────────────────┐
│   供应商层限流 (Provider)│  ← 5h/日/周/月金额 + 并发 Session
└───────────┬─────────────┘
            │
            ▼
      请求转发
```

{% callout type="note" title="限流优先级" %}
当多个层级同时设置了限流参数时，系统会取各层级中最严格的限制。例如，用户每日限额为 $100，密钥每日限额为 $50，则实际生效的限额为 $50。
{% /callout %}

---

## 六维限流模型

Claude Code Hub 支持六种维度的限流控制，覆盖不同的时间窗口和资源类型：

| 维度 | 时间窗口 | 适用场景 | 重置机制 |
|------|----------|----------|----------|
| **RPM** | 1 分钟 | 防止突发流量 | 滑动窗口 |
| **5 小时成本** | 5 小时 | 短期成本控制 | 滑动窗口 |
| **日成本** | 24 小时 | 日常预算管理 | 固定时间或滑动窗口 |
| **周成本** | 自然周 | 周度预算管理 | 每周一 00:00 重置 |
| **月成本** | 自然月 | 月度预算管理 | 每月 1 日 00:00 重置 |
| **并发 Session** | 实时 | 资源占用控制 | Session 超时释放 |

### RPM（每分钟请求数）

RPM 限制使用 Redis ZSET 实现滑动窗口算法，精确统计过去 60 秒内的请求数量。

**实现原理：**
1. 每次请求时，清理 1 分钟前的记录
2. 统计当前窗口内的请求数
3. 如果未超限，记录本次请求（时间戳作为 score）

**配置位置：** 用户管理 > 编辑用户 > RPM 限制

**默认值：** 60 次/分钟

### 5 小时成本限制

5 小时限制采用滚动窗口机制，持续追踪过去 5 小时内的累计消费。

**实现原理：**
- 使用 Redis ZSET 存储每笔消费记录
- Lua 脚本原子性地清理过期记录并计算总额
- 每条记录格式：`timestamp:cost`

**适用场景：** 防止短时间内大量消费，适合按需调整的弹性预算

### 日成本限制

日成本限制支持两种重置模式：

| 模式 | 说明 | 适用场景 |
|------|------|----------|
| **固定时间 (fixed)** | 在指定时间点重置（如每天 00:00 或 18:00） | 与财务周期对齐 |
| **滚动窗口 (rolling)** | 持续统计过去 24 小时消费 | 平滑的预算控制 |

**配置示例：**
- 固定时间模式：每天 18:00 重置，适合下班后统计当日消费
- 滚动窗口模式：任意时刻查看过去 24 小时消费

### 周成本限制

周成本限制按自然周计算，每周一 00:00（配置时区）自动重置。

**时区配置：** 通过 `TZ` 环境变量设置，默认为 `Asia/Shanghai`

### 月成本限制

月成本限制按自然月计算，每月 1 日 00:00（配置时区）自动重置。

### 并发 Session 限制

限制同时活跃的会话数量，防止资源过度占用。

**Session 生命周期：**
- 创建：首次请求时分配 Session ID
- 活跃：每次请求刷新 Session 时间戳
- 过期：5 分钟无活动后自动释放

---

## 用户级限流

用户级限流在请求进入代理管道时最先执行，适用于所有使用该用户账户的 API 请求。

### 用户限流配置

在用户管理页面，可为每个用户配置以下限流参数：

| 参数 | 字段名 | 说明 | 默认值 |
|------|--------|------|--------|
| RPM 限制 | `rpmLimit` | 每分钟最大请求数 | 60 |
| 每日限额 | `dailyLimitUsd` | 每日消费上限（美元） | 100.00 |
| 5 小时限额 | `limit5hUsd` | 5 小时滚动窗口消费上限 | 无限制 |
| 周限额 | `limitWeeklyUsd` | 每周消费上限 | 无限制 |
| 月限额 | `limitMonthlyUsd` | 每月消费上限 | 无限制 |
| 并发 Session | `limitConcurrentSessions` | 最大并发会话数 | 无限制 |

### 限流生效逻辑

```
用户请求 → RateLimitGuard.ensure()
    │
    ├─► checkUserRPM(userId, rpmLimit)
    │       └─► 检查 user:{userId}:rpm_window ZSET
    │
    └─► checkUserDailyCost(userId, dailyLimitUsd)
            └─► 检查 user:{userId}:daily_cost STRING
```

---

## API Key 级限流

API Key 级限流在用户级检查通过后执行，提供更细粒度的控制。

### Key 限流配置

在密钥管理页面，可为每个 API Key 配置以下限流参数：

| 参数 | 字段名 | 说明 |
|------|--------|------|
| 5 小时限额 | `limit5hUsd` | 5 小时滚动窗口消费上限 |
| 每日限额 | `limitDailyUsd` | 每日消费上限 |
| 日限额重置模式 | `dailyResetMode` | `fixed`（固定时间）或 `rolling`（滚动窗口） |
| 日限额重置时间 | `dailyResetTime` | 固定模式下的重置时间（HH:mm 格式） |
| 周限额 | `limitWeeklyUsd` | 每周消费上限 |
| 月限额 | `limitMonthlyUsd` | 每月消费上限 |
| 并发 Session | `limitConcurrentSessions` | 最大并发会话数 |

### Key 与用户限流关系

API Key 限流与用户限流是**叠加关系**，请求需要同时满足两者的限制：

```
                    用户限额: $100/日
                          │
                          ▼
                    ┌─────┴─────┐
                    │           │
              Key A: $50/日   Key B: $30/日
                    │           │
              实际: $50/日    实际: $30/日
```

{% callout type="warning" title="限额配置建议" %}
建议将 Key 级限额设置为用户级限额的子集，避免配置冲突导致的混淆。
{% /callout %}

---

## 供应商级限流

供应商级限流在选择供应商时执行，用于保护上游服务并实现成本分摊。

### 供应商 RPM 限制

供应商不直接支持 RPM 限制，但通过熔断器机制间接实现流量保护。

### 供应商成本限制

在供应商管理页面，可配置以下限流参数：

| 参数 | 字段名 | 说明 |
|------|--------|------|
| 5 小时限额 | `limit5hUsd` | 5 小时滚动窗口消费上限 |
| 每日限额 | `limitDailyUsd` | 每日消费上限 |
| 日限额重置模式 | `dailyResetMode` | `fixed` 或 `rolling` |
| 日限额重置时间 | `dailyResetTime` | 固定模式下的重置时间 |
| 周限额 | `limitWeeklyUsd` | 每周消费上限 |
| 月限额 | `limitMonthlyUsd` | 每月消费上限 |

### 供应商并发限制

供应商并发 Session 限制使用原子性 Lua 脚本实现，解决高并发场景下的竞态条件问题。

**实现原理：**
1. 清理过期 Session（5 分钟前）
2. 检查 Session 是否已追踪（避免重复计数）
3. 检查当前并发数是否超限
4. 如未超限，原子性追踪新 Session

**配置位置：** 供应商管理 > 编辑供应商 > 并发 Session 限制

---

## 限流实现

### Redis 键结构

Claude Code Hub 使用结构化的 Redis 键命名规范：

#### 固定时间窗口键（STRING 类型）

```
{type}:{id}:cost_{period}_{suffix}

示例：
key:123:cost_daily_1800       # Key 123 的日限额，18:00 重置
provider:456:cost_daily_0000  # Provider 456 的日限额，00:00 重置
key:123:cost_weekly           # Key 123 的周限额
key:123:cost_monthly          # Key 123 的月限额
```

#### 滚动窗口键（ZSET 类型）

```
{type}:{id}:cost_{period}_rolling

示例：
key:123:cost_5h_rolling       # Key 123 的 5 小时滚动窗口
key:123:cost_daily_rolling    # Key 123 的日滚动窗口（24 小时）
provider:456:cost_5h_rolling  # Provider 456 的 5 小时滚动窗口
```

#### RPM 窗口键（ZSET 类型）

```
user:{userId}:rpm_window

示例：
user:1:rpm_window             # 用户 1 的 RPM 滑动窗口
```

#### 并发 Session 键（ZSET 类型）

```
{type}:{id}:active_sessions

示例：
key:123:active_sessions       # Key 123 的活跃 Session
provider:456:active_sessions  # Provider 456 的活跃 Session
global:active_sessions        # 全局活跃 Session
```

### Lua 脚本原子性

系统使用 Lua 脚本确保限流操作的原子性，主要包括：

#### CHECK_AND_TRACK_SESSION

原子性检查并发限制并追踪 Session：

```lua
-- 1. 清理过期 session（5 分钟前）
-- 2. 检查 session 是否已追踪
-- 3. 获取当前并发数
-- 4. 检查限制（排除已追踪的 session）
-- 5. 追踪 session
-- 返回：{allowed, count, tracked}
```

#### TRACK_COST_5H_ROLLING_WINDOW

追踪 5 小时滚动窗口消费：

```lua
-- 1. 清理过期记录（5 小时前）
-- 2. 添加当前消费记录（timestamp:cost）
-- 3. 计算窗口内总消费
-- 4. 设置兜底 TTL（6 小时）
-- 返回：当前窗口总消费
```

### 滑动窗口 vs 固定窗口

| 特性 | 滑动窗口 | 固定窗口 |
|------|----------|----------|
| **数据结构** | ZSET | STRING |
| **精度** | 毫秒级 | 分钟级 |
| **复杂度** | O(N) | O(1) |
| **适用场景** | 5h、daily rolling | daily fixed、weekly、monthly |
| **TTL 策略** | 固定（窗口时长） | 动态（到重置时间） |

**选择建议：**
- 需要精确控制短期消费：选择滑动窗口
- 需要与财务周期对齐：选择固定窗口

---

## Fail-Open 策略

当 Redis 不可用时，系统采用 **Fail-Open** 策略，确保核心业务不受影响。

### Redis 不可用处理

```
Redis 状态检查
    │
    ├─► status === 'ready' → 正常执行限流检查
    │
    └─► status !== 'ready' → Fail-Open
            │
            ├─► 记录警告日志
            ├─► 返回 { allowed: true }
            └─► 业务正常继续
```

### 降级行为

| 功能 | Redis 可用 | Redis 不可用 |
|------|------------|--------------|
| RPM 限制 | 正常检查 | 跳过检查，允许通过 |
| 成本限制 | Redis 优先，DB 降级 | 直接查询数据库 |
| 并发 Session | 原子性检查 | 跳过检查，允许通过 |
| Session 追踪 | 正常追踪 | 跳过追踪 |

{% callout type="warning" title="Fail-Open 风险提示" %}
Fail-Open 策略可能导致 Redis 故障期间的限流失效。建议：
1. 监控 Redis 健康状态
2. 配置 Redis 高可用（Sentinel 或 Cluster）
3. 定期检查限流相关日志
{% /callout %}

### Cache Miss 处理

当 Redis 缓存未命中时，系统会自动从数据库恢复：

1. **检测 Cache Miss** - 查询返回 null 或 0
2. **查询数据库** - 计算指定时间范围内的实际消费
3. **Cache Warming** - 将查询结果写回 Redis
4. **继续限流检查** - 使用数据库结果判断

---

## 限流响应

### 429 状态码

当请求触发限流时，系统返回 HTTP 429 Too Many Requests 状态码。

### Retry-After 头

响应中包含 `Retry-After` 头，指示客户端何时可以重试：

| 限流类型 | Retry-After 计算 |
|----------|------------------|
| RPM | 60 秒后 |
| 5 小时限额 | 5 小时后 |
| 日限额（fixed） | 下一个重置时间 |
| 日限额（rolling） | 24 小时后 |
| 周限额 | 下周一 00:00 |
| 月限额 | 下月 1 日 00:00 |
| 并发 Session | 当前时间（需等待 Session 释放） |

### 错误消息

限流错误消息支持国际化，包含以下信息：

```json
{
  "type": "rate_limit_error",
  "message": "用户每分钟请求数上限已达到（60/60）",
  "limit_type": "rpm",
  "current_usage": 60,
  "limit_value": 60,
  "reset_time": "2024-01-01T12:01:00.000Z"
}
```

---

## 监控与调试

### 限流监控页面

在管理后台的「配额管理 > 限流监控」页面，可以查看：

- **限流事件时间线** - 按小时聚合的限流事件分布
- **限流类型分布** - 各类型限流事件的占比
- **受影响用户排行** - 触发限流最多的用户列表
- **筛选功能** - 按时间、用户、供应商、限流类型筛选

### 限流日志

系统在以下场景记录限流相关日志：

| 日志级别 | 场景 |
|----------|------|
| `WARN` | 用户/Key/供应商触发限流 |
| `WARN` | Redis 不可用，执行 Fail-Open |
| `INFO` | Cache Miss，从数据库恢复 |
| `INFO` | Cache Warming，写回 Redis |
| `DEBUG` | 成本追踪成功 |
| `ERROR` | 限流检查异常 |

**日志示例：**

```
[RateLimit] User RPM exceeded: user=123, 用户每分钟请求数上限已达到（60/60）
[RateLimit] Redis unavailable, checking key cost limits from database
[RateLimit] Cache miss for key:123:cost_5h, querying database
[RateLimit] Cache warmed for key:123:cost_5h_rolling, value=15.5 (rolling window)
```

### 调试建议

1. **检查 Redis 连接** - 确保 `REDIS_URL` 配置正确
2. **验证键存在** - 使用 `redis-cli KEYS "*:cost_*"` 检查限流键
3. **查看 ZSET 内容** - 使用 `ZRANGE key 0 -1 WITHSCORES` 查看滚动窗口数据
4. **监控 TTL** - 使用 `TTL key` 确认过期时间设置正确

---

## 相关功能

- [用户配额](/docs/guide/quotas-users) - 查看用户维度的配额使用情况
- [供应商配额](/docs/guide/quotas-providers) - 查看供应商维度的配额使用情况
- [限流监控](/docs/guide/rate-limits) - 查看限流事件统计和分析
- [Redis 架构](/docs/reference/redis-architecture) - 了解 Redis 数据结构和键命名规范
- [熔断器机制](/docs/reference/circuit-breaker) - 了解供应商熔断保护机制
