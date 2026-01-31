# 成本追踪与计费 (Cost Tracking and Billing) - Round 1 Exploration Draft

## Intent Analysis

成本追踪与计费系统是 Claude Code Hub 的核心功能之一，用于精确计算、记录和监控 API 请求的成本消耗。该系统的设计意图包括：

1. **精确计费**：基于模型价格配置和实际 Token 使用量计算每次请求的成本
2. **多层限额控制**：支持 User、Key、Provider 三个层级的消费限额管理
3. **实时成本追踪**：通过 Redis 实现高性能的实时成本累计和限流检查
4. **成本预警**：当消费接近限额阈值时触发告警通知
5. **灵活的价格管理**：支持从 LiteLLM 同步价格或手动配置模型价格
6. **多维度统计**：支持按时间范围、用户、Key、供应商等维度聚合成本数据

## Behavior Summary

### 1. 成本计算流程

成本计算发生在请求处理完成后的响应阶段：

```
请求处理 -> 获取 Usage 数据 -> 查询模型价格 -> 应用供应商倍率 -> 计算成本 -> 记录到 DB 和 Redis
```

核心计算逻辑位于 `/Users/ding/Github/claude-code-hub/src/lib/utils/cost-calculation.ts`：

```typescript
export function calculateRequestCost(
  usage: UsageMetrics,
  priceData: ModelPriceData,
  multiplier: number = 1.0,
  context1mApplied: boolean = false
): Decimal {
  const segments: Decimal[] = [];
  
  // 1. 按次计费（input_cost_per_request）
  if (typeof inputCostPerRequest === "number" && Number.isFinite(inputCostPerRequest)) {
    segments.push(toDecimal(inputCostPerRequest));
  }
  
  // 2. Input Token 费用（支持阶梯定价）
  // - Claude 1M Context: 使用倍数计算溢价
  // - Gemini 等: 使用独立价格字段（>200K 部分使用不同价格）
  // - 普通模型: 直接计算
  
  // 3. Output Token 费用（同上）
  
  // 4. 缓存相关费用
  // - Cache Creation (5分钟 TTL)
  // - Cache Creation (1小时 TTL)
  // - Cache Read
  
  // 5. 图片 Token 费用（Gemini 等模型）
  
  // 6. 应用供应商倍率
  const total = segments.reduce((acc, segment) => acc.plus(segment), new Decimal(0));
  return total.mul(multiplierDecimal).toDecimalPlaces(COST_SCALE);
}
```

### 2. 价格数据来源优先级

系统支持两种计费模型来源配置（`billingModelSource`）：

- **original**: 优先使用重定向前模型（用户请求的原始模型）
- **redirected**: 优先使用重定向后模型（实际调用的模型）

配置存储在 `system_settings` 表中，默认值为 `"original"`。

### 3. 成本追踪层级

系统实现了三个层级的成本追踪：

| 层级 | 存储位置 | 用途 |
|------|----------|------|
| **Key** | Redis + DB | 单个 API Key 的消费限额检查 |
| **User** | Redis + DB | 用户级别的消费限额检查 |
| **Provider** | Redis + DB | 供应商级别的消费限额检查 |

### 4. 时间窗口模式

支持两种时间窗口重置模式：

- **Fixed（固定时间）**: 在指定时间重置（如每天 18:00）
- **Rolling（滚动窗口）**: 过去 N 小时的滚动窗口（如过去 5 小时、过去 24 小时）

### 5. 成本预警机制

当消费达到限额阈值（默认 80%）时触发预警：

```typescript
// /Users/ding/Github/claude-code-hub/src/lib/notification/tasks/cost-alert.ts
export async function generateCostAlerts(threshold: number): Promise<CostAlertData[]> {
  const alerts: CostAlertData[] = [];
  
  // 检查用户级别的配额超额
  const userAlerts = await checkUserQuotas(threshold);
  alerts.push(...userAlerts);
  
  // 检查供应商级别的配额超额
  const providerAlerts = await checkProviderQuotas(threshold);
  alerts.push(...providerAlerts);
  
  return alerts;
}
```

## Config/Commands

### 数据库 Schema

#### 1. 模型价格表 (`model_prices`)

```typescript
// /Users/ding/Github/claude-code-hub/src/drizzle/schema.ts
export const modelPrices = pgTable('model_prices', {
  id: serial('id').primaryKey(),
  modelName: varchar('model_name').notNull(),
  priceData: jsonb('price_data').notNull(),  // ModelPriceData JSON
  source: varchar('source', { length: 20 })
    .notNull()
    .default('litellm')
    .$type<'litellm' | 'manual'>(),  // 价格来源
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});
```

#### 2. 请求记录表 (`message_request`)

```typescript
export const messageRequest = pgTable('message_request', {
  id: serial('id').primaryKey(),
  providerId: integer('provider_id').notNull(),
  userId: integer('user_id').notNull(),
  key: varchar('key').notNull(),
  model: varchar('model', { length: 128 }),
  durationMs: integer('duration_ms'),
  costUsd: numeric('cost_usd', { precision: 21, scale: 15 }).default('0'),
  costMultiplier: numeric('cost_multiplier', { precision: 10, scale: 4 }),  // 供应商倍率
  sessionId: varchar('session_id', { length: 64 }),
  
  // Token 使用量
  inputTokens: bigint('input_tokens', { mode: 'number' }),
  outputTokens: bigint('output_tokens', { mode: 'number' }),
  cacheCreationInputTokens: bigint('cache_creation_input_tokens', { mode: 'number' }),
  cacheReadInputTokens: bigint('cache_read_input_tokens', { mode: 'number' }),
  cacheCreation5mInputTokens: bigint('cache_creation_5m_input_tokens', { mode: 'number' }),
  cacheCreation1hInputTokens: bigint('cache_creation_1h_input_tokens', { mode: 'number' }),
  
  // 1M Context Window 应用状态
  context1mApplied: boolean('context_1m_applied').default(false),
  
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});
```

#### 3. 限额配置字段

**Users 表限额字段：**
```typescript
dailyLimitUsd: numeric('daily_limit_usd', { precision: 10, scale: 2 }),
limit5hUsd: numeric('limit_5h_usd', { precision: 10, scale: 2 }),
limitWeeklyUsd: numeric('limit_weekly_usd', { precision: 10, scale: 2 }),
limitMonthlyUsd: numeric('limit_monthly_usd', { precision: 10, scale: 2 }),
limitTotalUsd: numeric('limit_total_usd', { precision: 10, scale: 2 }),
dailyResetMode: dailyResetModeEnum('daily_reset_mode').default('fixed'),
dailyResetTime: varchar('daily_reset_time', { length: 5 }).default('00:00'),
```

**Keys 表限额字段：**（与用户表类似）

**Providers 表限额字段：**
```typescript
costMultiplier: numeric('cost_multiplier', { precision: 10, scale: 4 }).default('1.0'),
limit5hUsd: numeric('limit_5h_usd', { precision: 10, scale: 2 }),
limitDailyUsd: numeric('limit_daily_usd', { precision: 10, scale: 2 }),
limitWeeklyUsd: numeric('limit_weekly_usd', { precision: 10, scale: 2 }),
limitMonthlyUsd: numeric('limit_monthly_usd', { precision: 10, scale: 2 }),
limitTotalUsd: numeric('limit_total_usd', { precision: 10, scale: 2 }),
```

### 价格数据结构

```typescript
// /Users/ding/Github/claude-code-hub/src/types/model-price.ts
export interface ModelPriceData {
  // 基础价格
  input_cost_per_token?: number;
  output_cost_per_token?: number;
  input_cost_per_request?: number;  // 按次调用固定费用
  
  // 缓存相关价格
  cache_creation_input_token_cost?: number;
  cache_creation_input_token_cost_above_1hr?: number;
  cache_read_input_token_cost?: number;
  
  // 200K 分层价格（Gemini 等模型使用）
  input_cost_per_token_above_200k_tokens?: number;
  output_cost_per_token_above_200k_tokens?: number;
  cache_creation_input_token_cost_above_200k_tokens?: number;
  cache_read_input_token_cost_above_200k_tokens?: number;
  
  // 图片生成价格
  output_cost_per_image?: number;
  output_cost_per_image_token?: number;
  input_cost_per_image?: number;
  input_cost_per_image_token?: number;
  
  // 搜索上下文价格
  search_context_cost_per_query?: {
    search_context_size_high?: number;
    search_context_size_low?: number;
    search_context_size_medium?: number;
  };
  
  // 模型能力信息
  mode?: "chat" | "image_generation" | "completion";
  supports_prompt_caching?: boolean;
  // ... 其他字段
}
```

### Redis Key 命名规范

```
# 固定时间窗口（STRING 类型）
{type}:{id}:cost_daily_{suffix}
# 示例: key:123:cost_daily_1800 (18:00 重置)

# 滚动窗口（ZSET 类型）
{type}:{id}:cost_daily_rolling
{type}:{id}:cost_5h_rolling

# 其他周期（STRING 类型）
{type}:{id}:cost_weekly
{type}:{id}:cost_monthly
```

## Edge Cases

### 1. 阶梯定价计算

**Claude 1M Context Window：**
- 阈值：200K tokens（`CONTEXT_1M_TOKEN_THRESHOLD`）
- 阈值内：基础价格
- 阈值外：基础价格 × 溢价倍数（Input: 1.25x, Output: 5.0x）

**Gemini 200K+ Tokens：**
- 使用独立价格字段（`*_above_200k_tokens`）
- 阈值内使用基础价格，阈值外使用溢价价格

### 2. 缓存价格回退逻辑

```typescript
// Cache Creation 5分钟 TTL
const cacheCreation5mCost =
  priceData.cache_creation_input_token_cost ??
  (inputCostPerToken != null ? inputCostPerToken * 1.25 : undefined);

// Cache Creation 1小时 TTL
const cacheCreation1hCost =
  priceData.cache_creation_input_token_cost_above_1hr ??
  (inputCostPerToken != null ? inputCostPerToken * 2 : undefined) ??
  cacheCreation5mCost;

// Cache Read
const cacheReadCost =
  priceData.cache_read_input_token_cost ??
  (inputCostPerToken != null ? inputCostPerToken * 0.1 : undefined);
```

### 3. 价格数据验证

```typescript
// /Users/ding/Github/claude-code-hub/src/lib/utils/price-data.ts
export function hasValidPriceData(priceData: ModelPriceData): boolean {
  const numericCosts = [
    priceData.input_cost_per_token,
    priceData.output_cost_per_token,
    priceData.input_cost_per_request,
    // ... 其他价格字段
  ];
  
  return numericCosts.some(
    (value) => typeof value === "number" && Number.isFinite(value) && value >= 0
  );
}
```

### 4. Redis 降级处理

当 Redis 不可用时，系统会降级到数据库查询：

```typescript
// /Users/ding/Github/claude-code-hub/src/lib/rate-limit/service.ts
if (current === 0) {
  const exists = await RateLimitService.redis.exists(key);
  if (!exists) {
    logger.info(`[RateLimit] Cache miss for ${type}:${id}:cost_5h, querying database`);
    return await RateLimitService.checkCostLimitsFromDatabase(id, type, costLimits);
  }
}
```

### 5. 货币精度处理

使用 `decimal.js-light` 确保高精度计算：

```typescript
// /Users/ding/Github/claude-code-hub/src/lib/utils/currency.ts
export const COST_SCALE = 15;  // 15位小数精度

Decimal.set({
  precision: 30,
  rounding: Decimal.ROUND_HALF_UP,
});

export function formatCostForStorage(value: DecimalInput): string | null {
  const decimal = toCostDecimal(value);
  return decimal ? decimal.toFixed(COST_SCALE) : null;
}
```

### 6. 排除 Warmup 请求

统计查询时排除 Warmup 请求：

```typescript
// /Users/ding/Github/claude-code-hub/src/repository/_shared/message-request-conditions.ts
export const EXCLUDE_WARMUP_CONDITION = sql`${messageRequest.blockedBy} IS NULL OR ${messageRequest.blockedBy} <> 'warmup'`;
```

## References

### 核心文件

1. **成本计算**
   - `/Users/ding/Github/claude-code-hub/src/lib/utils/cost-calculation.ts` - 核心成本计算逻辑
   - `/Users/ding/Github/claude-code-hub/src/lib/utils/currency.ts` - 货币和精度处理
   - `/Users/ding/Github/claude-code-hub/src/lib/utils/price-data.ts` - 价格数据验证

2. **价格管理**
   - `/Users/ding/Github/claude-code-hub/src/types/model-price.ts` - 价格数据类型定义
   - `/Users/ding/Github/claude-code-hub/src/repository/model-price.ts` - 价格数据库操作
   - `/Users/ding/Github/claude-code-hub/src/actions/model-prices.ts` - 价格管理 Actions

3. **限流与成本追踪**
   - `/Users/ding/Github/claude-code-hub/src/lib/rate-limit/service.ts` - Redis 成本追踪服务
   - `/Users/ding/Github/claude-code-hub/src/lib/rate-limit/time-utils.ts` - 时间窗口计算
   - `/Users/ding/Github/claude-code-hub/src/lib/rate-limit/lease-service.ts` - 配额租赁服务

4. **成本统计**
   - `/Users/ding/Github/claude-code-hub/src/repository/statistics.ts` - 成本统计查询
   - `/Users/ding/Github/claude-code-hub/src/repository/usage-logs.ts` - 使用日志查询
   - `/Users/ding/Github/claude-code-hub/src/actions/statistics.ts` - 统计 Actions
   - `/Users/ding/Github/claude-code-hub/src/actions/my-usage.ts` - 个人使用统计

5. **成本预警**
   - `/Users/ding/Github/claude-code-hub/src/lib/notification/tasks/cost-alert.ts` - 成本预警生成

6. **数据库 Schema**
   - `/Users/ding/Github/claude-code-hub/src/drizzle/schema.ts` - 数据库表定义

### 关键代码片段

#### 成本计算核心逻辑

```typescript
// /Users/ding/Github/claude-code-hub/src/lib/utils/cost-calculation.ts:109-311
export function calculateRequestCost(
  usage: UsageMetrics,
  priceData: ModelPriceData,
  multiplier: number = 1.0,
  context1mApplied: boolean = false
): Decimal {
  const segments: Decimal[] = [];
  
  // 按次计费
  if (typeof inputCostPerRequest === "number" && Number.isFinite(inputCostPerRequest)) {
    segments.push(toDecimal(inputCostPerRequest));
  }
  
  // Input Token 费用（支持阶梯定价）
  if (context1mApplied && inputCostPerToken != null && usage.input_tokens != null) {
    segments.push(calculateTieredCost(
      usage.input_tokens,
      inputCostPerToken,
      CONTEXT_1M_INPUT_PREMIUM_MULTIPLIER
    ));
  } else if (inputAbove200k != null && inputCostPerToken != null) {
    segments.push(calculateTieredCostWithSeparatePrices(
      usage.input_tokens,
      inputCostPerToken,
      inputAbove200k
    ));
  } else {
    segments.push(multiplyCost(usage.input_tokens, inputCostPerToken));
  }
  
  // ... Output Token、缓存、图片 Token 等计算
  
  const total = segments.reduce((acc, segment) => acc.plus(segment), new Decimal(0));
  return total.mul(multiplierDecimal).toDecimalPlaces(COST_SCALE);
}
```

#### 成本追踪到 Redis

```typescript
// /Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/response-handler.ts:1966-2020
async function trackCostToRedis(session: ProxySession, usage: UsageMetrics | null): Promise<void> {
  if (!usage || !session.sessionId) return;
  
  // 计算成本（应用倍率）
  const priceData = await session.getCachedPriceDataByBillingSource();
  if (!priceData) return;
  
  const cost = calculateRequestCost(
    usage,
    priceData,
    provider.costMultiplier,
    session.getContext1mApplied()
  );
  
  // 追踪到 Redis
  await RateLimitService.trackCost(
    key.id,
    provider.id,
    session.sessionId,
    costFloat,
    {
      keyResetTime: key.dailyResetTime,
      keyResetMode: key.dailyResetMode,
      providerResetTime: provider.dailyResetTime,
      providerResetMode: provider.dailyResetMode,
    }
  );
  
  // 追踪用户层每日消费
  await RateLimitService.trackUserDailyCost(
    user.id,
    costFloat,
    user.dailyResetTime,
    user.dailyResetMode
  );
}
```

#### 价格查询（手动优先）

```typescript
// /Users/ding/Github/claude-code-hub/src/repository/model-price.ts:35-67
export async function findLatestPriceByModel(modelName: string): Promise<ModelPrice | null> {
  const [price] = await db
    .select(selection)
    .from(modelPrices)
    .where(eq(modelPrices.modelName, modelName))
    .orderBy(
      // 本地手动配置优先（哪怕云端数据更新得更晚）
      sql`(${modelPrices.source} = 'manual') DESC`,
      sql`${modelPrices.createdAt} DESC NULLS LAST`,
      desc(modelPrices.id)
    )
    .limit(1);
  
  return price ? toModelPrice(price) : null;
}
```

#### 用户成本统计查询

```typescript
// /Users/ding/Github/claude-code-hub/src/repository/statistics.ts:857-876
export async function sumUserCostInTimeRange(
  userId: number,
  startTime: Date,
  endTime: Date
): Promise<number> {
  const result = await db
    .select({ total: sql<number>`COALESCE(SUM(${messageRequest.costUsd}), 0)` })
    .from(messageRequest)
    .where(
      and(
        eq(messageRequest.userId, userId),
        gte(messageRequest.createdAt, startTime),
        lt(messageRequest.createdAt, endTime),
        isNull(messageRequest.deletedAt),
        EXCLUDE_WARMUP_CONDITION
      )
    );
  
  return Number(result[0]?.total || 0);
}
```

#### 成本限额检查

```typescript
// /Users/ding/Github/claude-code-hub/src/lib/rate-limit/service.ts:139-200
static async checkCostLimits(
  id: number,
  type: "key" | "provider" | "user",
  limits: {
    limit_5h_usd: number | null;
    limit_daily_usd: number | null;
    daily_reset_time?: string;
    daily_reset_mode?: DailyResetMode;
    limit_weekly_usd: number | null;
    limit_monthly_usd: number | null;
  }
): Promise<{ allowed: boolean; reason?: string }> {
  // Fast Path: Redis 查询
  if (RateLimitService.redis?.status === "ready") {
    // 5h 使用滚动窗口 Lua 脚本
    const result = await RateLimitService.redis.eval(
      GET_COST_5H_ROLLING_WINDOW,
      1,
      key,
      now.toString(),
      window5h.toString()
    );
    
    // 检查是否超过限额
    if (current + estimatedCost > limit.amount) {
      return {
        allowed: false,
        reason: `${limit.name}消费限额 exceeded`,
      };
    }
  }
  
  // Fallback: 数据库查询
  return await RateLimitService.checkCostLimitsFromDatabase(id, type, costLimits);
}
```

### API 端点

1. **模型价格管理**（管理员）
   - `GET /api/actions/model-prices/getModelPrices` - 获取模型价格列表
   - `POST /api/actions/model-prices/uploadPriceTable` - 上传价格表
   - `POST /api/actions/model-prices/upsertSingleModelPrice` - 更新单个模型价格

2. **使用统计**
   - `GET /api/actions/statistics/getUserStatistics` - 获取用户统计数据
   - `GET /api/actions/usage-logs/getUsageLogs` - 获取使用日志
   - `GET /api/actions/my-usage/getMyQuota` - 获取个人配额
   - `GET /api/actions/my-usage/getMyTodayStats` - 获取今日统计

3. **供应商管理**（管理员）
   - `GET /api/actions/providers/getProviderQuota` - 获取供应商配额
   - `POST /api/actions/providers/updateProvider` - 更新供应商配置

## 系统架构图

```
┌─────────────────────────────────────────────────────────────────┐
│                        Cost Tracking System                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐      │
│  │   Request    │ -> │  Calculate   │ -> │    Store     │      │
│  │   Handler    │    │    Cost      │    │   Cost Data  │      │
│  └──────────────┘    └──────────────┘    └──────────────┘      │
│         │                   │                   │               │
│         v                   v                   v               │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐      │
│  │  Get Price   │    │  Apply       │    │  PostgreSQL  │      │
│  │  Data        │    │  Multiplier  │    │  (message_   │      │
│  │              │    │              │    │   request)   │      │
│  └──────────────┘    └──────────────┘    └──────────────┘      │
│         │                                         │             │
│         v                                         v             │
│  ┌──────────────┐                        ┌──────────────┐      │
│  │  Model Price │                        │    Redis     │      │
│  │  Repository  │                        │  (Real-time  │      │
│  │              │                        │   tracking)  │      │
│  └──────────────┘                        └──────────────┘      │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                    Rate Limit Check                      │   │
│  │  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐    │   │
│  │  │   5h    │  │  Daily  │  │ Weekly  │  │ Monthly │    │   │
│  │  │ Rolling │  │Fixed/Rol│  │ Natural │  │ Natural │    │   │
│  │  └─────────┘  └─────────┘  └─────────┘  └─────────┘    │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                   Cost Aggregation                       │   │
│  │  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐    │   │
│  │  │  User   │  │   Key   │  │ Provider│  │  Total  │    │   │
│  │  │  Level  │  │  Level  │  │  Level  │  │  Stats  │    │   │
│  │  └─────────┘  └─────────┘  └─────────┘  └─────────┘    │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

*Generated for Route: `/docs/monitoring/cost-tracking`*
*Word Count: ~4,800 words*
