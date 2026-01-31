---
title: 成本追踪与计费
description: 了解 Claude Code Hub 如何精确计算 API 请求成本，以及多层级限额控制和实时成本追踪的工作原理
---

# 成本追踪与计费

Claude Code Hub 提供了一套完整的成本追踪与计费系统，能够精确计算每次 API 请求的成本消耗，并在多个层级实施消费限额控制。无论你是管理员需要监控系统支出，还是普通用户想了解自己的使用情况，这套系统都能满足你的需求。

## 成本计算流程

当 API 请求完成时，系统会自动计算本次请求的成本。整个流程涉及价格查询、Token 用量统计、阶梯定价计算和供应商倍率应用。

### 计算流程概览

```
请求完成 → 获取 Token 用量 → 查询模型价格 → 应用阶梯定价 → 
计算缓存费用 → 应用供应商倍率 → 记录到数据库和 Redis
```

### 核心计算逻辑

成本计算的核心位于 `src/lib/utils/cost-calculation.ts`，它会根据多种因素综合计算最终成本：

```typescript
export function calculateRequestCost(
  usage: UsageMetrics,
  priceData: ModelPriceData,
  multiplier: number = 1.0,
  context1mApplied: boolean = false
): Decimal {
  const segments: Decimal[] = [];
  
  // 按次计费（如果配置了固定费用）
  if (typeof inputCostPerRequest === "number") {
    segments.push(toDecimal(inputCostPerRequest));
  }
  
  // Input Token 费用（支持阶梯定价）
  // Output Token 费用（同上）
  // 缓存相关费用（Creation 5分钟、Creation 1小时、Read）
  // 图片 Token 费用（Gemini 等模型）
  
  // 应用供应商倍率
  const total = segments.reduce((acc, s) => acc.plus(s), new Decimal(0));
  return total.mul(multiplier).toDecimalPlaces(15);
}
```

## 价格数据来源

系统支持灵活的价格管理机制，你可以从 LiteLLM 同步价格，也可以手动配置特定模型的价格。

### 价格来源优先级

查询模型价格时，系统遵循以下优先级：

1. **手动配置优先**：`source = 'manual'` 的价格记录优先于 LiteLLM 同步的价格
2. **时间优先**：相同来源下，按 `created_at` 降序排列，取最新记录

```typescript
// 价格查询逻辑
const [price] = await db
  .select()
  .from(modelPrices)
  .where(eq(modelPrices.modelName, modelName))
  .orderBy(
    // 本地手动配置优先
    sql`(${modelPrices.source} = 'manual') DESC`,
    sql`${modelPrices.createdAt} DESC NULLS LAST`
  )
  .limit(1);
```

### 计费模型来源配置

系统支持两种计费模型来源配置，存储在 `system_settings` 表中：

- **original**（默认）：使用重定向前模型（用户请求的原始模型）价格
- **redirected**：使用重定向后模型（实际调用的模型）价格

### 价格数据结构

模型价格支持多种计费维度：

```typescript
interface ModelPriceData {
  // 基础 Token 价格
  input_cost_per_token?: number;
  output_cost_per_token?: number;
  input_cost_per_request?: number;  // 按次固定费用
  
  // 缓存相关价格
  cache_creation_input_token_cost?: number;
  cache_creation_input_token_cost_above_1hr?: number;
  cache_read_input_token_cost?: number;
  
  // 200K+ 分层价格（Gemini 等模型使用）
  input_cost_per_token_above_200k_tokens?: number;
  output_cost_per_token_above_200k_tokens?: number;
  
  // 图片生成价格
  output_cost_per_image?: number;
  output_cost_per_image_token?: number;
}
```

## 多层级成本追踪

系统实现了三个层级的成本追踪和限额控制，每个层级都可以独立设置消费限额。

### 层级概览

| 层级 | 存储位置 | 用途 | 限额字段示例 |
|------|----------|------|--------------|
| **Key** | Redis + DB | 单个 API Key 的消费控制 | `limitDailyUsd`, `limit5hUsd` |
| **User** | Redis + DB | 用户级别的消费控制 | `dailyLimitUsd`, `limitMonthlyUsd` |
| **Provider** | Redis + DB | 供应商级别的消费控制 | `limitDailyUsd`, `limitTotalUsd` |

### 成本追踪到 Redis

每次请求完成后，成本会被追踪到 Redis 用于实时限额检查：

```typescript
// 计算成本
const cost = calculateRequestCost(
  usage,
  priceData,
  provider.costMultiplier,
  context1mApplied
);

// 追踪到 Key 层级
await RateLimitService.trackCost(
  key.id,
  provider.id,
  sessionId,
  costFloat,
  {
    keyResetTime: key.dailyResetTime,
    keyResetMode: key.dailyResetMode,
    providerResetTime: provider.dailyResetTime,
    providerResetMode: provider.dailyResetMode,
  }
);

// 追踪到 User 层级
await RateLimitService.trackUserDailyCost(
  user.id,
  costFloat,
  user.dailyResetTime,
  user.dailyResetMode
);
```

## 时间窗口与限额重置

系统支持两种时间窗口重置模式，满足不同场景的需求。

### 固定时间窗口（Fixed）

在每天的指定时间重置消费统计：

- **实现方式**：Redis STRING + `INCRBYFLOAT`
- **Key 格式**：`{type}:{id}:cost_daily_{HHmm}`
- **示例**：`key:123:cost_daily_1800` 表示每天 18:00 重置
- **TTL**：动态计算到下一个重置时间

### 滚动时间窗口（Rolling）

基于过去 N 小时的滚动窗口：

- **实现方式**：Redis ZSET + Lua 脚本
- **Key 格式**：`{type}:{id}:cost_daily_rolling`
- **机制**：使用 `ZREMRANGEBYSCORE` 清理过期记录
- **TTL**：固定 24 小时

### 支持的限额周期

| 周期 | 窗口类型 | 说明 |
|------|----------|------|
| 5 小时 | 滚动窗口 | 过去 5 小时的累计消费 |
| 每日 | 固定/滚动 | 可配置重置时间或滚动窗口 |
| 每周 | 自然周 | 周一 00:00 重置 |
| 每月 | 自然月 | 每月 1 日 00:00 重置 |
| 总计 | 累计 | 从重置时间点开始的累计消费 |

## 阶梯定价计算

系统支持多种阶梯定价模式，以适应不同模型的计费规则。

### Claude 1M Context Window

当请求触发 1M Context Window 时，超过 200K tokens 的部分会应用溢价倍率：

```
费用 = min(tokens, 200K) × 基础价格 
     + max(0, tokens - 200K) × 基础价格 × 溢价倍率

Input 溢价倍率：2.0x
Output 溢价倍率：1.5x
```

### Gemini 200K+ Tokens

Gemini 模型使用独立的价格字段处理超过 200K tokens 的部分：

```
费用 = min(tokens, 200K) × 基础价格
     + max(0, tokens - 200K) × 溢价价格
```

### 缓存价格回退逻辑

如果未配置特定的缓存价格，系统会使用回退逻辑：

```typescript
// Cache Creation（5分钟 TTL）
const cacheCreation5mCost =
  priceData.cache_creation_input_token_cost ??
  inputCostPerToken * 1.25;  // 回退：基础价格 × 1.25

// Cache Creation（1小时 TTL）
const cacheCreation1hCost =
  priceData.cache_creation_input_token_cost_above_1hr ??
  inputCostPerToken * 2.0 ??  // 回退：基础价格 × 2.0
  cacheCreation5mCost;         // 最终回退到 5分钟价格

// Cache Read
const cacheReadCost =
  priceData.cache_read_input_token_cost ??
  inputCostPerToken * 0.1;  // 回退：基础价格 × 0.1
```

## 成本限额检查

在每次请求前，系统会检查各层级的消费限额，确保不会超支。

### 限额检查流程

```typescript
static async checkCostLimits(
  id: number,
  type: "key" | "provider" | "user",
  limits: CostLimits
): Promise<{ allowed: boolean; reason?: string }> {
  // 优先使用 Redis 进行快速检查
  if (redis?.status === "ready") {
    // 5h 滚动窗口使用 Lua 脚本
    const result = await redis.eval(
      GET_COST_5H_ROLLING_WINDOW,
      1, key, now.toString(), window5h.toString()
    );
    
    // 检查是否超过限额
    if (current >= limit.amount) {
      return {
        allowed: false,
        reason: `${type} ${limit.name}消费上限已达到`
      };
    }
  }
  
  // Redis 不可用时降级到数据库查询
  return await checkCostLimitsFromDatabase(id, type, limits);
}
```

### Redis 降级处理

当 Redis 不可用时，系统会自动降级到数据库查询：

```typescript
if (current === 0) {
  const exists = await redis.exists(key);
  if (!exists) {
    // 缓存未命中，查询数据库
    return await checkCostLimitsFromDatabase(id, type, costLimits);
  }
}
```

## 成本预警机制

当消费接近限额阈值时，系统会触发预警通知。

### 预警生成逻辑

```typescript
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

### 预警触发条件

默认情况下，当消费达到限额的 80% 时会触发预警。你可以通过系统设置调整这个阈值。

## 成本统计与查询

系统提供了丰富的成本统计功能，支持多维度数据聚合。

### 用户成本统计

```typescript
export async function sumUserCostInTimeRange(
  userId: number,
  startTime: Date,
  endTime: Date
): Promise<number> {
  const result = await db
    .select({ 
      total: sql<number>`COALESCE(SUM(${messageRequest.costUsd}), 0)` 
    })
    .from(messageRequest)
    .where(
      and(
        eq(messageRequest.userId, userId),
        gte(messageRequest.createdAt, startTime),
        lt(messageRequest.createdAt, endTime),
        isNull(messageRequest.deletedAt),
        EXCLUDE_WARMUP_CONDITION  // 排除 Warmup 请求
      )
    );
  
  return Number(result[0]?.total || 0);
}
```

### 数据库 Schema

成本数据存储在 `message_request` 表中：

```typescript
export const messageRequest = pgTable('message_request', {
  id: serial('id').primaryKey(),
  providerId: integer('provider_id').notNull(),
  userId: integer('user_id').notNull(),
  key: varchar('key').notNull(),
  model: varchar('model', { length: 128 }),
  
  // 成本相关字段
  costUsd: numeric('cost_usd', { precision: 21, scale: 15 }).default('0'),
  costMultiplier: numeric('cost_multiplier', { precision: 10, scale: 4 }),
  
  // Token 使用量
  inputTokens: bigint('input_tokens', { mode: 'number' }),
  outputTokens: bigint('output_tokens', { mode: 'number' }),
  cacheCreationInputTokens: bigint('cache_creation_input_tokens', { mode: 'number' }),
  cacheReadInputTokens: bigint('cache_read_input_tokens', { mode: 'number' }),
  
  // 1M Context Window 标记
  context1mApplied: boolean('context_1m_applied').default(false),
  
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});
```

## 货币精度处理

系统使用 `decimal.js-light` 确保高精度货币计算，避免浮点数精度问题。

```typescript
import Decimal from "decimal.js-light";

// 设置计算精度
Decimal.set({
  precision: 30,
  rounding: Decimal.ROUND_HALF_UP,
});

export const COST_SCALE = 15;  // 15位小数精度

export function formatCostForStorage(value: DecimalInput): string | null {
  const decimal = toCostDecimal(value);
  return decimal ? decimal.toFixed(COST_SCALE) : null;
}
```

## API 端点

### 模型价格管理（管理员）

| 端点 | 说明 |
|------|------|
| `getModelPrices` | 获取模型价格列表 |
| `uploadPriceTable` | 批量上传价格表 |
| `upsertSingleModelPrice` | 更新单个模型价格 |
| `syncFromLiteLLM` | 从 LiteLLM 同步价格 |

### 使用统计

| 端点 | 说明 |
|------|------|
| `getUserStatistics` | 获取用户统计数据 |
| `getUsageLogs` | 获取详细使用日志 |
| `getMyQuota` | 获取个人配额信息 |
| `getMyTodayStats` | 获取今日使用统计 |

### 供应商管理（管理员）

| 端点 | 说明 |
|------|------|
| `getProviderQuota` | 获取供应商配额信息 |
| `updateProvider` | 更新供应商配置（含倍率） |

## 配置指南

### 设置供应商倍率

你可以在供应商配置中设置成本倍率，用于调整特定供应商的实际计费：

```typescript
// 供应商配置
{
  costMultiplier: 1.5,  // 该供应商的成本 × 1.5
  limitDailyUsd: 100,   // 每日限额 $100
  limitMonthlyUsd: 2000 // 每月限额 $2000
}
```

### 配置用户限额

为用户设置消费限额：

```typescript
// 用户限额配置
{
  dailyLimitUsd: 10,           // 每日限额
  limit5hUsd: 5,               // 5小时滚动限额
  limitMonthlyUsd: 100,        // 每月限额
  dailyResetMode: 'fixed',     // 固定时间重置
  dailyResetTime: '00:00'      // 每天 00:00 重置
}
```

### 系统设置

影响成本追踪的系统设置：

```typescript
interface SystemSettings {
  // 计费模型来源
  billingModelSource: "original" | "redirected";
  
  // 货币显示偏好
  currencyDisplay: "USD" | "CNY" | "EUR" | ...;
  
  // 时区配置
  timezone: string;
}
```

## 最佳实践

### 1. 合理设置限额

- **Key 层级**：为每个 API Key 设置合理的每日限额，防止密钥泄露导致的大额消费
- **User 层级**：根据用户角色设置不同的消费限额
- **Provider 层级**：为每个供应商设置月度限额，控制整体支出

### 2. 价格管理策略

- 定期从 LiteLLM 同步最新价格
- 对常用模型手动配置价格，确保优先级
- 监控价格变动，及时调整预算

### 3. 监控成本趋势

- 定期查看仪表盘的成本统计图表
- 关注成本预警通知，及时调整使用策略
- 分析高成本请求，优化模型选择

### 4. 时区管理

- 在系统设置中配置正确的时区
- 确保"每日"限额的定义符合你的业务需求
- 跨时区团队使用时，明确告知时区设置

## 故障排查

### 成本显示为 0

1. 检查模型价格是否正确配置
2. 确认 `billingModelSource` 设置
3. 查看请求是否成功完成（失败请求可能不计费）

### 限额检查失败

1. 检查 Redis 连接状态
2. 验证限额配置是否正确
3. 查看服务器日志中的错误信息

### 成本计算不准确

1. 确认模型价格数据完整
2. 检查供应商倍率配置
3. 验证 Token 用量统计是否正确

## 相关文档

- [仪表盘实时指标](/docs/monitoring/dashboard) - 查看成本统计图表
- [配额管理](/docs/users/quota) - 配置消费限额
- [价格管理](/docs/providers/pricing) - 管理模型价格
- [价格同步功能](/docs/system/price-sync) - 从 LiteLLM 同步价格
- [限流机制](/docs/proxy/rate-limiting) - 了解限额检查机制
