---
title: Token 统计
description: 了解 Claude Code Hub 如何追踪、聚合和统计 Token 使用情况，包括多供应商数据归一化、缓存 Token 处理、分级定价计算和实时限额追踪。
nextjs:
  metadata:
    title: Token 统计
    description: Claude Code Hub Token 统计文档
---

# Token 统计

Token 统计是 Claude Code Hub 的核心功能之一，它负责追踪、聚合和分析每一次 API 请求的 Token 使用情况。准确的 Token 统计不仅是成本计算的基础，也是限额管理、运营监控和系统优化的关键数据来源。

## 核心能力

Token 统计系统的设计目标包括：

- **多供应商数据归一化**：将 Claude、OpenAI、Gemini、Codex 等不同供应商的 Token 数据格式统一为内部标准
- **细粒度 Token 分类**：区分输入 Token、输出 Token、缓存创建 Token（5 分钟/1 小时 TTL）、缓存读取 Token 和图像 Token
- **实时限额追踪**：将 Token 使用量实时同步到 Redis，支持毫秒级的限额检查
- **分级定价支持**：处理 200K Token 阈值和 1M 上下文窗口的分级定价模型
- **流式响应处理**：从 SSE 流中实时提取 Token 使用数据

## Token 类型详解

系统追踪以下几类 Token，每类都有特定的计费规则：

| Token 类型 | 说明 | 计费特点 |
|-----------|------|----------|
| **输入 Token** | 请求中发送给模型的 Token | 按输入价格计费 |
| **输出 Token** | 模型生成的响应 Token | 按输出价格计费（通常高于输入） |
| **缓存创建 Token (5m)** | 写入 5 分钟 TTL 缓存的 Token | 按缓存创建价格计费（通常 1.25x 输入价格） |
| **缓存创建 Token (1h)** | 写入 1 小时 TTL 缓存的 Token | 按缓存创建价格计费（通常 2x 输入价格） |
| **缓存读取 Token** | 从缓存中读取的 Token | 按缓存读取价格计费（通常 0.1x 输入价格） |
| **图像输入 Token** | 图像输入的 Token（Gemini） | 按图像输入价格计费 |
| **图像输出 Token** | 图像生成的 Token（Gemini） | 按图像输出价格计费 |

{% callout type="note" title="缓存计费优势" %}
缓存机制可以显著降低成本。假设输入价格为 $3/MTok：
- 缓存创建成本：$3.75/MTok（5m）或 $6/MTok（1h）
- 缓存读取成本：仅 $0.30/MTok
对于频繁访问的提示词，缓存可以节省 90% 以上的成本。
{% /callout %}

## 数据存储架构

### 数据库表结构

Token 统计数据存储在 `message_request` 表中，采用以下字段设计：

```typescript
// Token 相关字段
{
  inputTokens: bigint,                    // 输入 Token 数量
  outputTokens: bigint,                   // 输出 Token 数量
  cacheCreationInputTokens: bigint,       // 缓存创建 Token 总数
  cacheCreation5mInputTokens: bigint,     // 5 分钟缓存创建 Token
  cacheCreation1hInputTokens: bigint,     // 1 小时缓存创建 Token
  cacheReadInputTokens: bigint,           // 缓存读取 Token
  cacheTtlApplied: varchar(10),           // 应用的缓存 TTL（5m/1h/mixed）
  context1mApplied: boolean,              // 是否应用 1M 上下文定价
}
```

{% callout type="note" title="Bigint 类型" %}
Token 字段使用 `bigint` 类型（而非 `integer`），以支持大流量场景和 1M+ 上下文窗口模型。在迁移 `0057_conscious_quicksilver.sql` 中，这些字段从 `integer` 升级到了 `bigint`。
{% /callout %}

### 索引优化

为支持高效的 Token 统计查询，系统建立了专门的复合索引：

```sql
-- 用户 + 时间 + 成本索引（用于统计查询）
CREATE INDEX idx_message_request_user_date_cost 
ON message_request (user_id, created_at, cost_usd) 
WHERE deleted_at IS NULL;

-- Session 索引（用于会话聚合）
CREATE INDEX idx_message_request_session_id 
ON message_request (session_id) 
WHERE deleted_at IS NULL;

-- Session + 序号复合索引（用于会话请求列表）
CREATE INDEX idx_message_request_session_seq 
ON message_request (session_id, request_sequence) 
WHERE deleted_at IS NULL;
```

## 多供应商数据归一化

不同 AI 供应商返回的 Token 使用数据格式各不相同。系统的 `extractUsageMetrics` 函数负责将这些格式统一转换为内部标准。

### Claude 格式

```json
{
  "usage": {
    "input_tokens": 1000,
    "output_tokens": 500,
    "cache_creation_input_tokens": 200,
    "cache_read_input_tokens": 100
  }
}
```

### OpenAI 格式

```json
{
  "usage": {
    "prompt_tokens": 1000,
    "completion_tokens": 500,
    "input_tokens_details": {
      "cached_tokens": 100
    }
  }
}
```

### Gemini 格式

```json
{
  "usageMetadata": {
    "promptTokenCount": 1000,
    "candidatesTokenCount": 500,
    "cachedContentTokenCount": 100,
    "promptTokensDetails": [
      { "modality": "TEXT", "tokenCount": 800 },
      { "modality": "IMAGE", "tokenCount": 200 }
    ]
  }
}
```

### 归一化逻辑

```typescript
function extractUsageMetrics(value: unknown): UsageMetrics | null {
  const result: UsageMetrics = {};
  
  // Claude 标准格式
  if (typeof usage.input_tokens === "number") {
    result.input_tokens = usage.input_tokens;
  }
  
  // Gemini 格式：promptTokenCount 包含缓存 Token，需要扣除
  if (typeof usage.promptTokenCount === "number") {
    const cachedTokens = usage.cachedContentTokenCount ?? 0;
    result.input_tokens = Math.max(usage.promptTokenCount - cachedTokens, 0);
  }
  
  // Gemini 图像 Token 提取
  const promptDetails = usage.promptTokensDetails;
  if (Array.isArray(promptDetails)) {
    let imageTokens = 0;
    let textTokens = 0;
    for (const detail of promptDetails) {
      if (detail.modality?.toUpperCase() === "IMAGE") {
        imageTokens += detail.tokenCount ?? 0;
      } else {
        textTokens += detail.tokenCount ?? 0;
      }
    }
    result.input_image_tokens = imageTokens;
    result.input_tokens = textTokens;
  }
  
  // OpenAI 缓存读取 Token（嵌套结构）
  const inputTokensDetails = usage.input_tokens_details;
  if (inputTokensDetails?.cached_tokens) {
    result.cache_read_input_tokens = inputTokensDetails.cached_tokens;
  }
  
  return result;
}
```

{% callout type="warning" title="Gemini Token 扣除" %}
Gemini 的 `promptTokenCount` 包含缓存 Token，如果直接使用会导致重复计费。系统会自动扣除 `cachedContentTokenCount`，确保计费准确。
{% /callout %}

## 流式响应 Token 提取

对于流式响应（SSE），Token 使用数据分散在多个事件中。系统需要合并这些事件以获取完整的 Token 统计。

### Claude SSE 处理

Claude 的流式响应中，Token 数据分布在 `message_start` 和 `message_delta` 事件中：

```typescript
// message_start 事件（可能包含缓存创建细分）
{
  "type": "message_start",
  "message": {
    "usage": {
      "input_tokens": 1000,
      "cache_creation": {
        "ephemeral_5m_input_tokens": 200,
        "ephemeral_1h_input_tokens": 100
      }
    }
  }
}

// message_delta 事件（包含输出 Token）
{
  "type": "message_delta",
  "usage": {
    "output_tokens": 500
  }
}
```

系统会合并这两个事件的数据，优先使用 `message_delta` 的输出 Token，同时保留 `message_start` 的缓存创建细分。

### 提取流程

```typescript
export function parseUsageFromResponseText(
  responseText: string,
  providerType: string
): { usageRecord: Record | null; usageMetrics: UsageMetrics | null } {
  // 1. 尝试解析为 JSON（非流式响应）
  try {
    const parsed = JSON.parse(responseText);
    applyUsageValue(parsed.usage, "json.root.usage");
    applyUsageValue(parsed.usageMetadata, "json.root.usageMetadata");
  } catch {
    // 不是有效 JSON，继续尝试 SSE 解析
  }
  
  // 2. SSE 流解析
  if (!usageMetrics && responseText.includes("data:")) {
    const events = parseSSEData(responseText);
    
    let messageStartUsage: UsageMetrics | null = null;
    let messageDeltaUsage: UsageMetrics | null = null;
    
    for (const event of events) {
      if (event.type === "message_start") {
        messageStartUsage = extractUsageMetrics(event.message?.usage);
      } else if (event.type === "message_delta") {
        messageDeltaUsage = extractUsageMetrics(event.usage);
      }
    }
    
    // 合并：优先使用 message_delta，缺失字段从 message_start 补充
    usageMetrics = mergeUsageMetrics(messageStartUsage, messageDeltaUsage);
  }
  
  return { usageRecord, usageMetrics };
}
```

## 分级定价计算

系统支持两种分级定价模型：200K Token 阈值（Gemini）和 1M 上下文窗口（Claude）。

### 200K 阈值定价（Gemini）

Gemini 模型对超过 200K Token 的部分使用更高的价格：

```typescript
// 价格配置
interface ModelPriceData {
  input_cost_per_token: number;                    // 基础输入价格
  input_cost_per_token_above_200k_tokens: number;  // 200K 以上价格
  output_cost_per_token: number;                   // 基础输出价格
  output_cost_per_token_above_200k_tokens: number; // 200K 以上价格
}

// 分级成本计算
function calculateTieredCostWithSeparatePrices(
  tokens: number,
  basePrice: number,
  above200kPrice: number
): Decimal {
  if (tokens <= 200000) {
    return new Decimal(tokens).mul(basePrice);
  }
  
  const baseCost = new Decimal(200000).mul(basePrice);
  const aboveCost = new Decimal(tokens - 200000).mul(above200kPrice);
  return baseCost.plus(aboveCost);
}
```

### 1M 上下文窗口定价（Claude）

Claude 的 1M 上下文窗口使用价格倍数而非独立价格字段：

```typescript
// 定价倍数
const CONTEXT_1M_INPUT_PREMIUM_MULTIPLIER = 2.0;   // 输入 2x
const CONTEXT_1M_OUTPUT_PREMIUM_MULTIPLIER = 1.5;  // 输出 1.5x

// 计算逻辑
if (context1mApplied && inputCostPerToken != null) {
  segments.push(
    calculateTieredCost(
      usage.input_tokens,
      inputCostPerToken,
      CONTEXT_1M_INPUT_PREMIUM_MULTIPLIER
    )
  );
}
```

{% callout type="note" title="1M 上下文触发条件" %}
当请求的上下文窗口超过 200K Token 时，系统会自动应用 1M 上下文定价。这通过 `context1mApplied` 字段标记，并在成本计算时使用相应的倍数。
{% /callout %}

## 成本计算流程

完整的成本计算流程如下：

```typescript
export function calculateRequestCost(
  usage: UsageMetrics,
  priceData: ModelPriceData,
  multiplier: number = 1.0,
  context1mApplied: boolean = false
): Decimal {
  const segments: Decimal[] = [];
  
  // 1. 按请求固定费用（如果有）
  if (priceData.input_cost_per_request) {
    segments.push(toDecimal(priceData.input_cost_per_request));
  }
  
  // 2. 输入 Token 成本（支持分级定价）
  if (context1mApplied) {
    segments.push(calculateTieredCost(
      usage.input_tokens,
      priceData.input_cost_per_token,
      CONTEXT_1M_INPUT_PREMIUM_MULTIPLIER
    ));
  } else if (priceData.input_cost_per_token_above_200k_tokens) {
    segments.push(calculateTieredCostWithSeparatePrices(
      usage.input_tokens,
      priceData.input_cost_per_token,
      priceData.input_cost_per_token_above_200k_tokens
    ));
  } else {
    segments.push(multiplyCost(usage.input_tokens, priceData.input_cost_per_token));
  }
  
  // 3. 输出 Token 成本（类似输入）
  // ...
  
  // 4. 缓存创建成本（5m TTL）
  segments.push(multiplyCost(
    usage.cache_creation_5m_input_tokens,
    priceData.cache_creation_input_token_cost ?? priceData.input_cost_per_token * 1.25
  ));
  
  // 5. 缓存创建成本（1h TTL）
  segments.push(multiplyCost(
    usage.cache_creation_1h_input_tokens,
    priceData.cache_creation_input_token_cost_above_1hr ?? priceData.input_cost_per_token * 2
  ));
  
  // 6. 缓存读取成本
  segments.push(multiplyCost(
    usage.cache_read_input_tokens,
    priceData.cache_read_input_token_cost ?? priceData.input_cost_per_token * 0.1
  ));
  
  // 7. 图像 Token 成本
  if (usage.output_image_tokens) {
    segments.push(multiplyCost(
      usage.output_image_tokens,
      priceData.output_cost_per_image_token ?? priceData.output_cost_per_token
    ));
  }
  
  // 汇总并应用供应商倍率
  const total = segments.reduce((acc, seg) => acc.plus(seg), new Decimal(0));
  return total.mul(multiplier);
}
```

## 实时限额追踪

Token 使用量会实时同步到 Redis，用于限额检查。系统使用多种 Redis 数据结构支持不同的限额窗口。

### 数据结构

| 窗口类型 | Redis 结构 | 说明 |
|---------|-----------|------|
| 5 小时滚动窗口 | ZSET | 使用 Lua 脚本维护滑动窗口 |
| 每日滚动窗口 | ZSET | 24 小时滑动窗口 |
| 每日固定窗口 | STRING | 按日重置的累计值 |
| 每周窗口 | STRING | 按周重置的累计值 |
| 每月窗口 | STRING | 按月重置的累计值 |

### 追踪实现

```typescript
static async trackCost(
  keyId: number,
  providerId: number,
  cost: number,
  options: TrackCostOptions
): Promise<void> {
  const now = options.createdAtMs ?? Date.now();
  const window5h = 5 * 60 * 60 * 1000;
  const window24h = 24 * 60 * 60 * 1000;
  
  // 1. 5 小时滚动窗口（ZSET + Lua 脚本）
  await redis.eval(TRACK_COST_5H_ROLLING_WINDOW,
    1,                                          // KEYS 数量
    `key:${keyId}:cost_5h_rolling`,            // KEYS[1]
    cost.toString(),                           // ARGV[1]: 成本
    now.toString(),                            // ARGV[2]: 当前时间
    window5h.toString(),                       // ARGV[3]: 窗口大小
    requestId                                  // ARGV[4]: 请求 ID
  );
  
  // 2. 每日滚动窗口（如果配置为 rolling 模式）
  if (keyDailyMode === "rolling") {
    await redis.eval(TRACK_COST_DAILY_ROLLING_WINDOW, ...);
  }
  
  // 3. 固定窗口（STRING + Pipeline）
  const pipeline = redis.pipeline();
  pipeline.incrbyfloat(`key:${keyId}:cost_daily_${keyDailyReset.suffix}`, cost);
  pipeline.expire(`key:${keyId}:cost_daily_${keyDailyReset.suffix}`, ttlDaily);
  pipeline.incrbyfloat(`key:${keyId}:cost_weekly`, cost);
  pipeline.incrbyfloat(`key:${keyId}:cost_monthly`, cost);
  await pipeline.exec();
}
```

## 会话级 Token 聚合

系统支持在会话级别聚合 Token 使用数据，用于实时监控和会话管理。

### 数据库存储聚合

```typescript
export async function aggregateSessionStats(sessionId: string) {
  const [stats] = await db
    .select({
      requestCount: sql`count(*) FILTER (WHERE ${EXCLUDE_WARMUP_CONDITION})`,
      totalInputTokens: sql`sum(input_tokens) FILTER (WHERE ${EXCLUDE_WARMUP_CONDITION})`,
      totalOutputTokens: sql`sum(output_tokens) FILTER (WHERE ${EXCLUDE_WARMUP_CONDITION})`,
      totalCacheCreationTokens: sql`sum(cache_creation_input_tokens) FILTER (WHERE ${EXCLUDE_WARMUP_CONDITION})`,
      totalCacheReadTokens: sql`sum(cache_read_input_tokens) FILTER (WHERE ${EXCLUDE_WARMUP_CONDITION})`,
      totalCostUsd: sql`sum(cost_usd) FILTER (WHERE ${EXCLUDE_WARMUP_CONDITION})`,
    })
    .from(messageRequest)
    .where(and(
      eq(messageRequest.sessionId, sessionId),
      isNull(messageRequest.deletedAt)
    ));
    
  return stats;
}
```

### Redis 实时聚合

```typescript
static async getSessionById(sessionId: string): Promise<ActiveSessionInfo | null> {
  const infoKey = `session:${sessionId}:info`;
  const usageKey = `session:${sessionId}:usage`;
  
  const [infoData, usageData] = await Promise.all([
    redis.get(infoKey),
    redis.hgetall(usageKey),
  ]);
  
  return {
    sessionId,
    inputTokens: parseInt(usageData.inputTokens, 10) || 0,
    outputTokens: parseInt(usageData.outputTokens, 10) || 0,
    cacheCreationInputTokens: parseInt(usageData.cacheCreationInputTokens, 10) || 0,
    cacheReadInputTokens: parseInt(usageData.cacheReadInputTokens, 10) || 0,
    costUsd: usageData.costUsd || "0",
    totalTokens: input + output + cacheCreate + cacheRead,
  };
}
```

## Token 格式化

前端使用统一的格式化函数显示 Token 数量：

```typescript
export function formatTokenAmount(value: number | null | undefined): string {
  if (value === null || value === undefined) {
    return "-";
  }
  
  const absolute = Math.abs(value);
  
  // 小于 1000：显示原始值
  if (absolute < 1000) {
    return value.toLocaleString();
  }
  
  // 小于 1M：转换为 K（如 1,500 -> 1.5K）
  if (absolute < 1000000) {
    return `${(value / 1000).toFixed(2)}K`;
  }
  
  // 大于等于 1M：转换为 M（如 1,500,000 -> 1.5M）
  return `${(value / 1000000).toFixed(2)}M`;
}
```

## 边缘情况处理

### 缺失 Token 数据

当供应商未返回 Token 使用数据时（如请求失败或某些流式场景）：

1. `extractUsageMetrics` 返回 `null`
2. 成本计算跳过该请求
3. 请求仍被记录用于分析，但成本显示为 0

### Codex 缓存 Token 调整

Codex 将缓存 Token 包含在 `input_tokens` 中，需要调整以避免重复计费：

```typescript
function adjustUsageForProviderType(
  usage: UsageMetrics,
  providerType: string
): UsageMetrics {
  if (providerType !== "codex") return usage;
  
  const cachedTokens = usage.cache_read_input_tokens ?? 0;
  const inputTokens = usage.input_tokens ?? 0;
  
  // 从 input_tokens 中扣除缓存 Token
  const adjustedInput = Math.max(inputTokens - cachedTokens, 0);
  
  return { ...usage, input_tokens: adjustedInput };
}
```

### Warmup 请求排除

Warmup 请求（用于供应商健康检查）不计入 Token 统计：

```typescript
const EXCLUDE_WARMUP_CONDITION = sql`
  ${messageRequest.blockedBy} IS NULL 
  OR ${messageRequest.blockedBy} <> 'warmup'
`;
```

### Token 计数端点特殊处理

`/v1/messages/count_tokens` 端点用于计算 Token 数量而不实际调用模型，这类请求：

- 跳过限额检查
- 不增加并发计数
- 不记录到使用日志

```typescript
if (session.isCountTokensRequest()) {
  return RequestType.COUNT_TOKENS;
}
```

## 配置选项

### 环境变量

| 环境变量 | 默认值 | 说明 |
|---------|--------|------|
| `MESSAGE_REQUEST_WRITE_MODE` | `async` | Token 更新写入模式：`sync` 或 `async` |
| `MESSAGE_REQUEST_ASYNC_FLUSH_INTERVAL_MS` | `250` | 异步刷新间隔（毫秒） |
| `MESSAGE_REQUEST_ASYNC_BATCH_SIZE` | `200` | 批量写入大小 |

### 异步写入模式

异步模式使用内存缓冲区批量写入 Token 数据，降低数据库压力：

```typescript
// 异步模式：更新被缓冲，定期批量刷新
enqueueMessageRequestUpdate(id, { 
  inputTokens, 
  outputTokens, 
  costUsd 
});
```

**工作原理**：

1. **更新合并**：同一 ID 的多次更新在内存中合并
2. **队列保护**：超过 `maxPending` 时优先丢弃非终态更新
3. **批量刷新**：使用 CTE 和 `CASE WHEN` 实现高效批量更新
4. **定时刷新**：按配置间隔自动刷新

## 性能考虑

### 数据库性能

- **批量写入**：异步模式下使用批量 UPDATE 减少数据库往返
- **索引覆盖**：统计查询使用覆盖索引避免回表
- **软删除**：所有查询包含 `deletedAt IS NULL` 条件，利用索引过滤

### Redis 性能

- **Pipeline 批量操作**：多个限额窗口使用 Pipeline 批量更新
- **Lua 脚本原子性**：滚动窗口使用 Lua 脚本保证原子性
- **TTL 自动过期**：所有限额键都设置 TTL 避免数据累积

### 前端性能

- **乐观更新**：Token 统计先更新本地状态，再同步服务器
- **防抖计算**：成本计算使用防抖避免频繁重算
- **虚拟滚动**：大量日志数据使用虚拟滚动保持流畅

## 故障排查

### Token 数据显示为 0

1. 检查供应商是否正确返回 Token 使用数据
2. 查看日志中的 `extractUsageMetrics` 调试信息
3. 确认请求是否被标记为 warmup
4. 检查异步写入缓冲区是否正常刷新

### 成本计算不准确

1. 验证模型价格配置是否正确
2. 检查是否应用了正确的供应商倍率
3. 确认分级定价阈值配置（200K/1M）
4. 查看缓存 Token 是否正确扣除（特别是 Gemini）

### 限额未正确触发

1. 检查 Redis 连接状态
2. 验证限额键是否正确生成
3. 查看 `trackCost` 调用是否成功
4. 检查限额窗口类型配置（滚动/固定）

### 会话 Token 统计不一致

1. 对比数据库聚合和 Redis 实时数据
2. 检查是否有并发更新冲突
3. 验证会话 TTL 配置
4. 查看是否有请求未正确关联 Session ID

## 最佳实践

### 监控关键指标

建议重点关注以下 Token 相关指标：

- **缓存命中率**：`cache_read_input_tokens / (input_tokens + cache_read_input_tokens)`
- **平均请求大小**：`total_input_tokens / request_count`
- **输出/输入比率**：`output_tokens / input_tokens`（反映对话深度）
- **分级定价触发频率**：超过 200K/1M 阈值的请求占比

### 优化缓存使用

1. **合理设置缓存 TTL**：频繁访问的提示词使用 1h，临时使用 5m
2. **监控缓存创建成本**：确保缓存命中率足够高以抵消创建成本
3. **批量预热**：新部署时批量预热常用提示词缓存

### 成本控制

1. **设置合理的限额**：基于历史 Token 使用数据设置日/周/月限额
2. **监控异常使用**：设置 Token 使用量告警阈值
3. **定期审查模型选择**：高 Token 使用场景考虑使用更经济的模型

## 数据流架构

Token 统计涉及多个组件的协作，以下是完整的数据流：

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   API 请求      │────▶│   代理处理器      │────▶│   供应商 API    │
└─────────────────┘     └──────────────────┘     └─────────────────┘
                               │                           │
                               ▼                           ▼
                        ┌──────────────────┐     ┌─────────────────┐
                        │  响应处理器       │◀────│   流式/非流式    │
                        │  extractUsage    │     │   响应数据       │
                        └──────────────────┘     └─────────────────┘
                               │
                               ▼
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   成本计算       │◀────│   数据归一化      │────▶│   数据库写入    │
│  calculateCost  │     │  UsageMetrics    │     │  message_request│
└──────────────────┘     └──────────────────┘     └─────────────────┘
        │                                               │
        ▼                                               ▼
┌─────────────────┐                           ┌─────────────────┐
│   限额检查       │                           │   统计聚合      │
│   Redis ZSET    │                           │  Session/用户   │
└─────────────────┘                           └─────────────────┘
```

### 关键处理节点

1. **响应处理器** (`response-handler.ts`)：解析供应商返回的 Token 数据，处理不同格式的归一化
2. **数据归一化** (`extractUsageMetrics`)：将所有供应商格式转换为统一的 `UsageMetrics` 结构
3. **成本计算** (`cost-calculation.ts`)：基于价格配置计算实际成本
4. **限额追踪** (`rate-limit/service.ts`)：将成本同步到 Redis 用于实时限额检查
5. **数据持久化** (`message.ts`)：将 Token 数据写入 PostgreSQL

## 价格配置结构

模型价格配置决定了 Token 如何计费，以下是完整的价格数据结构：

```typescript
interface ModelPriceData {
  // 基础价格
  input_cost_per_token?: number;                    // 输入 Token 单价
  output_cost_per_token?: number;                   // 输出 Token 单价
  input_cost_per_request?: number;                  // 每次请求的固定费用

  // 缓存相关价格
  cache_creation_input_token_cost?: number;         // 5m 缓存创建价格
  cache_creation_input_token_cost_above_1hr?: number; // 1h 缓存创建价格
  cache_read_input_token_cost?: number;             // 缓存读取价格

  // 200K 分级定价（Gemini）
  input_cost_per_token_above_200k_tokens?: number;
  output_cost_per_token_above_200k_tokens?: number;
  cache_creation_input_token_cost_above_200k_tokens?: number;
  cache_read_input_token_cost_above_200k_tokens?: number;

  // 图像相关价格
  output_cost_per_image?: number;                   // 每张图像的价格
  output_cost_per_image_token?: number;             // 图像输出 Token 单价
  input_cost_per_image?: number;                    // 每张输入图像的价格
  input_cost_per_image_token?: number;              // 图像输入 Token 单价

  // 功能标志
  supports_prompt_caching?: boolean;                // 是否支持提示词缓存
}
```

### 价格回退逻辑

当某些价格字段未配置时，系统使用智能回退：

| 目标字段 | 回退链 |
|---------|--------|
| `cache_creation_input_token_cost` | 显式配置 → `input_cost_per_token * 1.25` |
| `cache_creation_input_token_cost_above_1hr` | 显式配置 → `input_cost_per_token * 2` → `cache_creation_input_token_cost` |
| `cache_read_input_token_cost` | 显式配置 → `input_cost_per_token * 0.1` → `output_cost_per_token * 0.1` |
| `output_cost_per_image_token` | 显式配置 → `output_cost_per_token` |
| `input_cost_per_image_token` | 显式配置 → `input_cost_per_token` |

## 缓存 TTL 推导

当供应商返回的 Token 数据未明确区分 5m 和 1h 缓存时，系统会智能推导：

```typescript
// 推导缓存创建 Token 的 TTL 分布
let cache5mTokens = usage.cache_creation_5m_input_tokens;
let cache1hTokens = usage.cache_creation_1h_input_tokens;

if (typeof usage.cache_creation_input_tokens === "number") {
  // 计算未分配的 Token 数量
  const remaining = usage.cache_creation_input_tokens 
    - (cache5mTokens ?? 0) 
    - (cache1hTokens ?? 0);

  if (remaining > 0) {
    // 根据 cache_ttl 字段决定分配到哪个桶
    const target = usage.cache_ttl === "1h" ? "1h" : "5m";
    if (target === "1h") {
      cache1hTokens = (cache1hTokens ?? 0) + remaining;
    } else {
      cache5mTokens = (cache5mTokens ?? 0) + remaining;
    }
  }
}
```

这种推导确保了即使供应商只返回总的缓存创建 Token 数，系统也能合理分配到不同的 TTL 类别进行计费。

## 供应商特定处理

### Gemini 思考 Token

Gemini 的 "thinking" 或 "reasoning" Token 会计入输出 Token：

```typescript
// Gemini 思考 Token 直接加到 output_tokens
// 思考 Token 的价格与输出 Token 相同
if (typeof usage.thoughtsTokenCount === "number" && usage.thoughtsTokenCount > 0) {
  result.output_tokens = (result.output_tokens ?? 0) + usage.thoughtsTokenCount;
}
```

### 遗留字段支持

为兼容某些中继/旧版本 API，系统还支持以下遗留字段名：

```typescript
// 旧版中继格式（低优先级，仅在标准字段缺失时使用）
if (typeof usage.claude_cache_creation_5_m_tokens === "number") {
  result.cache_creation_5m_input_tokens = usage.claude_cache_creation_5_m_tokens;
}
if (typeof usage.claude_cache_creation_1_h_tokens === "number") {
  result.cache_creation_1h_input_tokens = usage.claude_cache_creation_1_h_tokens;
}
```

## 统计数据一致性保证

Token 统计涉及多个数据源（PostgreSQL、Redis），系统通过以下机制保证一致性：

### 写入时序

1. **请求开始时**：创建 `message_request` 记录，Token 字段为 NULL
2. **收到响应后**：解析 Token 数据，更新数据库记录
3. **成本计算后**：计算成本并更新记录
4. **限额追踪**：异步将成本同步到 Redis

### 一致性策略

| 场景 | 策略 | 说明 |
|-----|------|------|
| 数据库 vs Redis | 最终一致性 | Redis 用于实时限额，数据库用于持久化 |
| 异步写入 | 缓冲区合并 | 同一请求的多次更新合并为一次写入 |
| 并发更新 | 乐观锁 | 使用 `updated_at` 检测冲突 |
| 失败重试 | 指数退避 | 数据库写入失败时自动重试 |

## 监控与告警

### 关键监控指标

系统内部监控以下 Token 相关指标：

```typescript
// Token 统计监控指标
interface TokenMetrics {
  // 请求级别
  requestsPerMinute: number;           // 每分钟请求数
  averageTokensPerRequest: number;     // 平均 Token 数/请求
  tokenParsingSuccessRate: number;     // Token 解析成功率

  // 成本级别
  costPerMinute: number;               // 每分钟成本
  cacheHitRate: number;                // 缓存命中率
  tieredPricingRatio: number;          // 触发分级定价的请求比例

  // 系统级别
  asyncBufferSize: number;             // 异步写入缓冲区大小
  redisSyncLatency: number;            // Redis 同步延迟
}
```

### 建议的告警阈值

| 指标 | 警告阈值 | 严重阈值 | 说明 |
|-----|---------|---------|------|
| Token 解析失败率 | > 1% | > 5% | 供应商格式可能变更 |
| 缓存命中率 | < 10% | < 5% | 缓存配置可能需要优化 |
| 异步缓冲区大小 | > 1000 | > 5000 | 数据库写入可能延迟 |
| 分级定价触发率 | > 20% | > 50% | 用户可能在使用大上下文 |

## 调试与日志

### 调试日志

开启 `debug` 日志级别可查看详细的 Token 处理过程：

```bash
LOG_LEVEL=debug
```

关键日志输出：

```
[ResponseHandler] Parsed usage from response
  source: "json.root.usage"
  providerType: "anthropic"
  usage: { input_tokens: 1000, output_tokens: 500, ... }

[UsageMetrics] Adjusted codex input tokens to exclude cached tokens
  originalInputTokens: 1100
  cachedTokens: 100
  adjustedInputTokens: 1000

[CostCalculation] Calculated request cost
  inputCost: 0.003
  outputCost: 0.015
  cacheCreationCost: 0.00075
  totalCost: 0.01875
```

### 诊断 API

管理员可以通过以下方式诊断 Token 统计问题：

```typescript
// 获取特定请求的 Token 处理详情
GET /api/admin/token-debug?requestId=12345

// 响应
{
  "requestId": 12345,
  "rawUsage": { /* 供应商原始数据 */ },
  "normalizedUsage": { /* 归一化后的数据 */ },
  "priceConfig": { /* 应用的定价配置 */ },
  "calculatedCost": 0.01875,
  "processingSteps": [
    { "step": "parse", "success": true, "durationMs": 0.5 },
    { "step": "normalize", "success": true, "durationMs": 0.2 },
    { "step": "calculate", "success": true, "durationMs": 0.3 }
  ]
}
```

## 升级与迁移

### 从旧版本升级

如果你从早期版本升级，可能需要执行以下迁移：

1. **字段类型升级**（migration 0057）：将 Token 字段从 `integer` 升级到 `bigint`
2. **新增缓存细分字段**：添加 `cache_creation_5m_input_tokens` 和 `cache_creation_1h_input_tokens`
3. **1M 上下文标记**：添加 `context1m_applied` 布尔字段

### 数据回填

对于历史数据，可以运行数据回填脚本：

```bash
# 回填缓存 TTL 信息
bun run scripts/backfill-cache-ttl.ts

# 重新计算成本（价格变更后）
bun run scripts/recalculate-costs.ts --start-date=2024-01-01
```

## 相关文档

- [成本追踪与计费](/docs/monitoring/cost-tracking) - 了解成本计算详情
- [日志查询与筛选](/docs/monitoring/logs) - 查看 Token 使用日志
- [限流与配额](/docs/proxy/rate-limiting) - 了解基于 Token 的限额管理
- [供应商管理](/docs/providers/crud) - 配置模型价格和缓存选项
- [缓存 TTL 配置](/docs/proxy/cache-ttl) - 了解缓存机制
