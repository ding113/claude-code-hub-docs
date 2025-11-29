---
dimensions:
  type:
    primary: conceptual
    detail: mechanism
  level: intermediate
standard_title: 限流与并发控制
language: zh
---

# 限流与并发控制

Claude Code Hub 提供多维度的限流和并发控制机制，保护系统资源、控制成本、防止滥用。系统支持用户级、API Key 级和供应商级的配额管理。

## 限流维度

### 5 小时滑动窗口限额

5 小时滑动窗口是最细粒度的成本控制维度，用于平滑短期内的使用峰值：

```
                    5 小时滑动窗口
    ├─────────────────────────────────────────┤
    │                                         │
    时间线 ───────────────────────────────────────────►
              ↑                               ↑
           5小时前                           现在

    窗口内的所有请求成本累加，窗口随时间持续滑动
```

**特点：**
- 使用 Redis ZSET（有序集合）实现
- 真正的滑动窗口，精度到毫秒级
- 自动清理过期数据

```typescript
// Redis Key 格式
`key:{keyId}:cost_5h_rolling`     // API Key 的 5h 消费
`provider:{providerId}:cost_5h_rolling`  // 供应商的 5h 消费
```

### 周限额

周限额基于自然周计算，每周一 00:00（配置时区）自动重置：

```typescript
// 周限额配置
{
  limit_weekly_usd: 100  // 每周最多消费 $100
}

// Redis Key 格式
`key:{keyId}:cost_weekly`
`provider:{providerId}:cost_weekly`
```

### 月限额

月限额基于自然月计算，每月 1 号 00:00（配置时区）自动重置：

```typescript
// 月限额配置
{
  limit_monthly_usd: 500  // 每月最多消费 $500
}

// Redis Key 格式
`key:{keyId}:cost_monthly`
`provider:{providerId}:cost_monthly`
```

### 每个维度的 Token/请求数限制

除了金额限制，系统还支持以下维度的限流：

| 限流维度 | 作用对象 | 说明 |
|----------|----------|------|
| RPM（每分钟请求数） | 用户 | 防止单用户短时间内发送过多请求 |
| 每日消费额度 | 用户 | 控制单用户每日总成本 |
| 5h/日/周/月消费 | API Key | 多时间维度的成本控制 |
| 5h/日/周/月消费 | 供应商 | 控制单个供应商的使用量 |

### 日限额重置模式

日限额支持两种重置模式：

**1. 固定时间重置（fixed）**
```typescript
{
  daily_reset_mode: 'fixed',
  daily_reset_time: '18:00'  // 每天 18:00 重置
}

// Redis Key 包含重置时间
`key:{keyId}:cost_daily_1800`  // 18:00 重置
`key:{keyId}:cost_daily_0000`  // 00:00 重置
```

**2. 滚动窗口（rolling）**
```typescript
{
  daily_reset_mode: 'rolling'
  // 过去 24 小时的滑动窗口
}

// Redis Key
`key:{keyId}:cost_daily_rolling`
```

## 并发控制

### 并发 Session 限制

系统支持限制同时活跃的 Session 数量，防止资源过度占用：

```typescript
// API Key 级并发限制
{
  limitConcurrentSessions: 5  // 最多同时 5 个活跃 Session
}

// 供应商级并发限制
{
  limitConcurrentSessions: 100  // 供应商最多支持 100 个并发
}
```

### 排队机制

当并发达到上限时，新请求会收到 429 错误响应：

```typescript
// 并发检查响应
{
  allowed: false,
  reason: "供应商并发 Session 上限已达到（100/100）"
}
```

客户端可以根据响应实现自己的排队和重试逻辑。

### 超限处理

系统使用原子操作确保并发控制的准确性：

```typescript
// 原子性检查并追踪 Session
static async checkAndTrackProviderSession(
  providerId: number,
  sessionId: string,
  limit: number
): Promise<{ allowed: boolean; count: number; tracked: boolean }> {
  // 使用 Lua 脚本保证原子性
  const result = await redis.eval(
    CHECK_AND_TRACK_SESSION,
    1,
    key,
    sessionId,
    limit.toString(),
    now.toString()
  );

  return {
    allowed: result[0] === 1,
    count: result[1],
    tracked: result[2] === 1
  };
}
```

## 实现原理

### Redis Lua 脚本原子操作

为保证限流计数的准确性，系统使用 Lua 脚本实现原子操作：

**5 小时滚动窗口追踪脚本：**

```lua
-- TRACK_COST_5H_ROLLING_WINDOW
-- KEYS[1]: cost key
-- ARGV[1]: cost amount
-- ARGV[2]: current timestamp
-- ARGV[3]: window size (5 hours in ms)

local key = KEYS[1]
local cost = tonumber(ARGV[1])
local now = tonumber(ARGV[2])
local window = tonumber(ARGV[3])

-- 清理过期数据
redis.call('ZREMRANGEBYSCORE', key, '-inf', now - window)

-- 添加新的成本记录
redis.call('ZADD', key, now, now .. ':' .. cost)

-- 设置 TTL
redis.call('EXPIRE', key, math.ceil(window / 1000))

return 'OK'
```

**并发 Session 检查脚本：**

```lua
-- CHECK_AND_TRACK_SESSION
-- KEYS[1]: sessions key
-- ARGV[1]: session id
-- ARGV[2]: limit
-- ARGV[3]: current timestamp

local key = KEYS[1]
local sessionId = ARGV[1]
local limit = tonumber(ARGV[2])
local now = tonumber(ARGV[3])

-- 清理过期 Session（5 分钟超时）
redis.call('ZREMRANGEBYSCORE', key, '-inf', now - 300000)

-- 检查当前 Session 是否已存在
local exists = redis.call('ZSCORE', key, sessionId)
if exists then
  -- Session 已存在，更新时间戳
  redis.call('ZADD', key, now, sessionId)
  local count = redis.call('ZCARD', key)
  return {1, count, 0}  -- allowed, count, not newly tracked
end

-- 检查并发数
local count = redis.call('ZCARD', key)
if count >= limit then
  return {0, count, 0}  -- not allowed
end

-- 添加新 Session
redis.call('ZADD', key, now, sessionId)
redis.call('EXPIRE', key, 600)

return {1, count + 1, 1}  -- allowed, new count, newly tracked
```

### 滑动窗口算法

系统使用 Redis ZSET 实现精确的滑动窗口：

```
ZSET 结构：
┌──────────────────────────────────────────────────────┐
│  Score (时间戳)          │  Member (唯一标识:成本)    │
├──────────────────────────────────────────────────────┤
│  1732950000000           │  1732950000000:0.05       │
│  1732950100000           │  1732950100000:0.12       │
│  1732950200000           │  1732950200000:0.08       │
└──────────────────────────────────────────────────────┘

查询当前窗口总成本：
ZRANGEBYSCORE key (now - 5h) +inf
然后累加所有成本值
```

### 计数器设计

对于固定时间窗口（周/月限额），使用简单的 STRING 类型计数器：

```typescript
// 累加成本
await redis.incrbyfloat(`key:${keyId}:cost_weekly`, cost);

// 设置 TTL（到下周一的秒数）
await redis.expire(`key:${keyId}:cost_weekly`, ttlToNextMonday);
```

**TTL 计算逻辑：**

```typescript
// 计算到下周一 00:00 的秒数
function getTTLForWeekly(): number {
  const timezone = 'Asia/Shanghai';
  const now = new Date();
  const zonedNow = toZonedTime(now, timezone);
  const startOfThisWeek = startOfWeek(zonedNow, { weekStartsOn: 1 });
  const nextWeek = addWeeks(startOfThisWeek, 1);

  return Math.ceil((fromZonedTime(nextWeek, timezone).getTime() - now.getTime()) / 1000);
}
```

## Fail-Open 策略

### Redis 故障时的降级

当 Redis 不可用时，系统采用 Fail-Open 策略保证服务可用性：

```typescript
static async checkCostLimits(...): Promise<{ allowed: boolean }> {
  try {
    if (this.redis && this.redis.status === 'ready') {
      // Fast Path: Redis 查询
      return await this.checkFromRedis(...);
    }

    // Slow Path: 降级到数据库
    logger.warn('[RateLimit] Redis unavailable, checking from database');
    return await this.checkCostLimitsFromDatabase(...);
  } catch (error) {
    logger.error('[RateLimit] Check failed, fallback to database:', error);
    return await this.checkCostLimitsFromDatabase(...);
  }
}
```

### 保证服务可用性

Fail-Open 策略的核心原则：

1. **限流检查失败 → 允许请求通过**
2. **Redis 不可用 → 降级到数据库查询**
3. **数据库也失败 → 返回 `allowed: true`**

```typescript
// 并发检查的 Fail-Open
static async checkSessionLimit(...): Promise<{ allowed: boolean }> {
  try {
    const count = await SessionTracker.getKeySessionCount(id);
    // ... 检查逻辑
  } catch (error) {
    logger.error('[RateLimit] Session check failed:', error);
    return { allowed: true };  // Fail Open
  }
}
```

### 缓存预热

当 Redis 缓存未命中时，系统会从数据库恢复数据并写回 Redis：

```typescript
// Cache Miss 检测和恢复
if (current === 0) {
  const exists = await this.redis.exists(key);
  if (!exists) {
    // 从数据库恢复
    const dbValue = await sumKeyCostInTimeRange(id, startTime, endTime);

    // 写回 Redis（Cache Warming）
    await this.redis.eval(
      TRACK_COST_5H_ROLLING_WINDOW,
      1,
      key,
      dbValue.toString(),
      now.toString(),
      window5h.toString()
    );
  }
}
```

## 配置示例

### 环境变量配置

```bash
# Redis 连接配置
REDIS_URL=redis://localhost:6379

# 时区配置（影响周/月限额的重置时间）
TZ=Asia/Shanghai
```

### 用户级别配置

在用户管理界面配置：

```typescript
// 用户限流配置
{
  rpmLimit: 60,          // 每分钟最多 60 个请求
  dailyLimitUsd: 10,     // 每日最多消费 $10
  limit5hUsd: 2,         // 5 小时最多消费 $2
  limitWeeklyUsd: 50,    // 每周最多消费 $50
  limitMonthlyUsd: 200   // 每月最多消费 $200
}
```

### API Key 级别配置

在 API Key 管理界面配置：

```typescript
// API Key 限流配置
{
  limit5hUsd: 5,                    // 5 小时限额
  limitDailyUsd: 20,                // 日限额
  dailyResetTime: '18:00',          // 日限额重置时间
  dailyResetMode: 'fixed',          // 重置模式：fixed 或 rolling
  limitWeeklyUsd: 100,              // 周限额
  limitMonthlyUsd: 400,             // 月限额
  limitConcurrentSessions: 10       // 并发 Session 限制
}
```

### 供应商级别配置

在供应商管理界面配置：

```typescript
// 供应商限流配置
{
  limit5hUsd: 100,                  // 供应商 5 小时总消费限额
  limitDailyUsd: 500,               // 供应商日限额
  limitWeeklyUsd: 2000,             // 供应商周限额
  limitMonthlyUsd: 8000,            // 供应商月限额
  limitConcurrentSessions: 100      // 供应商并发限制
}
```

## 限流响应

当请求被限流时，系统返回标准的 429 响应：

```json
{
  "type": "rate_limit_error",
  "message": "5小时消费上限已达到（$5.0000/$5）",
  "error": {
    "type": "rate_limit_error",
    "limit_type": "usd_5h",
    "current_usage": 5.0,
    "limit_value": 5.0,
    "reset_time": "2024-01-01T12:00:00.000Z"
  }
}
```

**响应字段说明：**

| 字段 | 说明 |
|------|------|
| `limit_type` | 限流类型：`rpm`, `daily_quota`, `usd_5h`, `usd_weekly`, `usd_monthly`, `concurrent_sessions` |
| `current_usage` | 当前使用量 |
| `limit_value` | 限额值 |
| `reset_time` | 限额重置时间（ISO 8601 格式） |

## 监控与统计

### 批量查询接口

系统提供批量查询接口，避免 N+1 查询问题：

```typescript
// 批量获取供应商消费数据
static async getCurrentCostBatch(
  providerIds: number[],
  dailyResetConfigs: Map<number, { resetTime?: string; resetMode?: string }>
): Promise<Map<number, {
  cost5h: number;
  costDaily: number;
  costWeekly: number;
  costMonthly: number;
}>>
```

### Redis Key 命名规范

```
限流相关 Key 命名：
├── 5h 滚动窗口
│   ├── key:{keyId}:cost_5h_rolling
│   └── provider:{providerId}:cost_5h_rolling
├── 日限额（固定重置）
│   ├── key:{keyId}:cost_daily_{HHmm}
│   └── provider:{providerId}:cost_daily_{HHmm}
├── 日限额（滚动窗口）
│   ├── key:{keyId}:cost_daily_rolling
│   └── provider:{providerId}:cost_daily_rolling
├── 周限额
│   ├── key:{keyId}:cost_weekly
│   └── provider:{providerId}:cost_weekly
├── 月限额
│   ├── key:{keyId}:cost_monthly
│   └── provider:{providerId}:cost_monthly
├── 并发 Session
│   ├── key:{keyId}:active_sessions
│   └── provider:{providerId}:active_sessions
└── 用户相关
    ├── user:{userId}:rpm_window
    └── user:{userId}:daily_cost
```

## 最佳实践

1. **合理设置配额层级**：用户配额 > API Key 配额，确保单个 Key 不会耗尽用户全部额度
2. **启用多时间维度**：同时配置 5h/日/周/月限额，防止短期突发消耗
3. **使用滚动窗口**：对于需要精确控制的场景，使用 `rolling` 模式
4. **监控限流事件**：关注 429 响应率，及时调整配额或扩容
5. **配置告警阈值**：当使用量接近限额时发送预警通知
6. **定期审计配额**：根据实际使用情况调整配额设置
