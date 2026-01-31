---
title: 错误率统计
description: 了解 Claude Code Hub 的错误率统计系统如何分类、计算和监控 API 错误，包括错误分类体系、规则引擎、限流事件统计和熔断器集成。
nextjs:
  metadata:
    title: 错误率统计
    description: Claude Code Hub 错误率统计文档
---

# 错误率统计

错误率统计是 Claude Code Hub 监控系统的核心功能，用于追踪 API 请求的错误情况、分析错误来源，并为熔断器和限流决策提供数据支撑。系统采用五层错误分类体系，结合规则引擎实现精确的错误识别和处理。

## 错误分类体系

系统采用五层错误分类体系，每种错误类型对应不同的处理策略：

| 错误类型 | 说明 | 熔断器计数 | 处理策略 |
|---------|------|-----------|----------|
| **供应商错误** | 上游供应商返回的 4xx/5xx 错误 | 计入 | 直接切换供应商 |
| **系统错误** | 网络超时、DNS 失败等系统问题 | 不计入 | 先重试 1 次 |
| **客户端中断** | 用户主动取消请求 | 不计入 | 直接返回，不重试 |
| **不可重试的客户端错误** | Prompt 超限、内容过滤等输入错误 | 不计入 | 直接返回，不重试 |
| **资源未找到** | 上游返回 404 错误 | 不计入 | 直接切换供应商 |

### 分类优先级

错误分类按照以下优先级顺序进行判断：

1. **客户端中断检测**（最高优先级）
   - 检测条件：`error.name === "AbortError"` 或 `error.statusCode === 499`
   - 处理策略：不计入熔断器，不重试，直接返回

2. **不可重试的客户端输入错误**
   - 通过错误规则引擎检测（`errorRuleDetector`）
   - 包括 Prompt 超限、内容过滤、PDF 限制等
   - 处理策略：不计入熔断器，不重试，直接返回

3. **供应商问题（ProxyError）**
   - 所有 4xx/5xx HTTP 错误
   - 特殊处理：404 错误单独分类为资源未找到
   - 处理策略：计入熔断器，触发故障切换

4. **空响应错误（EmptyResponseError）**
   - 原因：`empty_body`、`no_output_tokens`、`missing_content`
   - 处理策略：计入熔断器，触发故障切换

5. **系统/网络问题**（默认分类）
   - 包括 DNS 解析失败、连接被拒绝、连接超时等
   - 处理策略：不计入熔断器，先重试 1 次

{% callout type="note" title="熔断器集成" %}
错误分类直接决定熔断器行为。只有供应商错误和空响应错误会计入熔断器统计，客户端错误和系统错误不会触发熔断。这种设计避免了因用户输入错误或瞬时网络问题导致供应商被误熔断。
{% /callout %}

## 错误规则检测引擎

错误规则检测引擎位于 `src/lib/error-rule-detector.ts`，采用三层匹配策略实现高效的错误识别：

```typescript
class ErrorRuleDetector {
  private regexPatterns: RegexPattern[] = [];      // 正则匹配（最灵活）
  private containsPatterns: ContainsPattern[] = []; // 包含匹配
  private exactPatterns: Map<string, ExactPattern> = new Map(); // 精确匹配
}
```

### 检测顺序

引擎按照性能优先的顺序进行匹配：

1. **包含匹配**（`String.prototype.includes`）- 最快
2. **精确匹配**（`Map.get`）- O(1) 查询
3. **正则匹配**（`RegExp.prototype.test`）- 最灵活但较慢

### 错误规则类别

系统预置 40+ 条默认错误规则，涵盖常见的客户端输入错误：

| 类别 | 描述 | 示例匹配文本 |
|------|------|-------------|
| `prompt_limit` | Prompt 超限 | "prompt is too long" |
| `content_filter` | 内容过滤 | "blocked by content filter" |
| `pdf_limit` | PDF 页数限制 | "PDF has too many pages" |
| `thinking_error` | Thinking 格式错误 | "must start with a thinking block" |
| `parameter_error` | 参数错误 | "Missing required parameter" |
| `invalid_request` | 非法请求 | "非法请求" |
| `cache_limit` | 缓存限制 | "cache_control limit" |
| `input_limit` | 输入限制 | "Input is too long" |
| `validation_error` | 验证错误 | "ValidationException" |
| `context_limit` | 上下文限制 | "context length exceed" |
| `token_limit` | Token 限制 | "max_tokens exceed" |
| `model_error` | 模型错误 | "unknown model" |
| `media_limit` | 媒体限制 | "Too much media" |

### 错误覆写功能

检测到的错误可以被覆写为更友好的用户提示：

```typescript
const DEFAULT_ERROR_RULES = [
  {
    pattern: "prompt is too long.*(tokens.*maximum|maximum.*tokens)",
    category: "prompt_limit",
    matchType: "regex",
    priority: 100,
    overrideResponse: {
      type: "error",
      error: {
        type: "prompt_limit",
        message: "输入内容过长，请减少 Prompt 中的 token 数量后重试",
      },
    },
  },
];
```

## 错误率计算

错误率基于 `message_request` 表计算，核心逻辑位于 `src/repository/overview.ts`：

```typescript
export async function getOverviewMetrics(): Promise<OverviewMetrics> {
  const timezone = await resolveSystemTimezone();

  const [result] = await db
    .select({
      requestCount: count(),
      totalCost: sum(messageRequest.costUsd),
      avgDuration: avg(messageRequest.durationMs),
      errorCount: sql<number>`count(*) FILTER (WHERE ${messageRequest.statusCode} >= 400)`,
    })
    .from(messageRequest)
    .where(
      and(
        isNull(messageRequest.deletedAt),
        EXCLUDE_WARMUP_CONDITION,
        sql`(${messageRequest.createdAt} AT TIME ZONE ${timezone})::date = 
            (CURRENT_TIMESTAMP AT TIME ZONE ${timezone})::date`
      )
    );

  const requestCount = Number(result.requestCount || 0);
  const errorCount = Number(result.errorCount || 0);
  const todayErrorRate =
    requestCount > 0 ? parseFloat(((errorCount / requestCount) * 100).toFixed(2)) : 0;

  return {
    todayRequests: requestCount,
    todayCost,
    avgResponseTime,
    todayErrorRate,
  };
}
```

### 计算公式

```
错误率 = (状态码 >= 400 的请求数 / 总请求数) × 100%
```

### 计算约束

- 排除已删除记录（`deletedAt IS NULL`）
- 排除 warmup 请求（`blocked_by <> 'warmup'`）
- 基于系统时区计算"今日"
- 结果保留两位小数

{% callout type="note" title="时区处理" %}
系统使用 `SYSTEM_TIMEZONE` 环境变量配置时区（默认 "Asia/Shanghai"）。所有时间相关的统计都基于此时区计算，确保"今日"的定义符合预期。
{% /callout %}

## 限流事件统计

限流事件是错误统计的特殊类型，记录用户触发限流规则的情况：

```typescript
export async function getRateLimitEventStats(
  filters: RateLimitEventFilters = {}
): Promise<RateLimitEventStats> {
  const conditions: string[] = [
    `${messageRequest.errorMessage.name} LIKE '%rate_limit_metadata%'`,
    `${messageRequest.deletedAt.name} IS NULL`,
  ];

  // 按类型、用户、供应商、小时聚合
  const eventsByType: Record<string, number> = {};
  const eventsByUser: Record<number, number> = {};
  const eventsByProvider: Record<number, number> = {};
  const eventsByHour: Record<string, number> = {};

  // 解析 rate_limit_metadata JSON 进行统计
  for (const row of rows) {
    const metadataMatch = row.error_message.match(/rate_limit_metadata:\s*(\{[^}]+\})/);
    if (!metadataMatch) continue;
    const metadata = JSON.parse(metadataMatch[1]);
    // 按维度统计...
  }
}
```

### 限流类型

| 类型 | 说明 |
|------|------|
| `rpm` | 每分钟请求数限制 |
| `usd_5h` | 5 小时消费限额 |
| `usd_weekly` | 周消费限额 |
| `usd_monthly` | 月消费限额 |
| `usd_total` | 总消费限额 |
| `concurrent_sessions` | 并发会话限制 |
| `daily_quota` | 每日配额 |

## 数据库表结构

### message_request 表

错误统计数据来源于 `message_request` 表：

```sql
CREATE TABLE message_request (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  provider_id INTEGER NOT NULL,
  key VARCHAR NOT NULL,
  model VARCHAR(128),
  duration_ms INTEGER,
  cost_usd NUMERIC(21, 15) DEFAULT '0',
  status_code INTEGER,              -- HTTP 状态码，>=400 表示错误
  error_message TEXT,               -- 错误消息
  error_stack TEXT,                 -- 错误堆栈
  error_cause TEXT,                 -- 错误原因
  blocked_by VARCHAR(50),           -- 拦截原因（如 warmup）
  blocked_reason TEXT,              -- 拦截详细原因
  provider_chain JSONB,             -- 供应商选择决策链
  created_at TIMESTAMPTZ DEFAULT NOW(),
  deleted_at TIMESTAMPTZ            -- 软删除标记
);
```

### error_rules 表

错误规则配置存储在 `error_rules` 表中：

```sql
CREATE TABLE error_rules (
  id SERIAL PRIMARY KEY,
  pattern TEXT NOT NULL UNIQUE,     -- 匹配模式
  match_type VARCHAR(20) NOT NULL DEFAULT 'regex',  -- 匹配类型
  category VARCHAR(50) NOT NULL,    -- 错误类别
  description TEXT,                 -- 描述
  override_response JSONB,          -- 覆写响应
  override_status_code INTEGER,     -- 覆写状态码
  is_enabled BOOLEAN DEFAULT true,  -- 是否启用
  is_default BOOLEAN DEFAULT false, -- 是否默认规则
  priority INTEGER DEFAULT 0,       -- 优先级
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

## 边缘情况处理

### Warmup 请求排除

健康检查请求不计入错误统计：

```typescript
export const EXCLUDE_WARMUP_CONDITION = sql`(
  ${messageRequest.blockedBy} IS NULL OR 
  ${messageRequest.blockedBy} <> 'warmup'
)`;
```

### 客户端中断检测

客户端主动中断请求不应计入错误率：

```typescript
export function isClientAbortError(error: Error): boolean {
  // 检查错误名称
  if (error.name === "AbortError" || error.name === "ResponseAborted") {
    return true;
  }

  // 检查 HTTP 状态码（Nginx 使用的 "Client Closed Request"）
  if (error instanceof ProxyError && error.statusCode === 499) {
    return true;
  }

  // 检查错误消息
  const abortMessages = [
    "This operation was aborted",
    "The user aborted a request",
    "aborted",
  ];

  return abortMessages.some((msg) => error.message.includes(msg));
}
```

### 错误检测缓存

使用 WeakMap 缓存错误检测结果，避免重复计算：

```typescript
const errorDetectionCache = new WeakMap<Error, ErrorDetectionResult>();

async function detectErrorRuleOnceAsync(error: Error): Promise<ErrorDetectionResult> {
  const cached = errorDetectionCache.get(error);
  if (cached) {
    return cached;
  }

  const content = extractErrorContentForDetection(error);
  const result = await errorRuleDetector.detectAsync(content);
  errorDetectionCache.set(error, result);
  return result;
}
```

### ReDoS 防护

错误规则检测引擎使用 safe-regex 防止正则表达式拒绝服务攻击：

```typescript
import safeRegex from "safe-regex";

if (!safeRegex(rule.pattern)) {
  logger.warn(
    `[ErrorRuleDetector] ReDoS risk detected in pattern: ${rule.pattern}, skipping`
  );
  skippedRedosCount++;
  break;
}
```

## API 端点

### 获取概览统计数据

```typescript
// src/repository/overview.ts
export async function getOverviewMetrics(): Promise<OverviewMetrics>
export async function getOverviewMetricsWithComparison(userId?: number): Promise<OverviewMetricsWithComparison>
```

返回数据包含今日错误率（`todayErrorRate`）。

### 获取限流事件统计

```typescript
// src/actions/rate-limit-stats.ts
export async function getRateLimitStats(
  filters: RateLimitEventFilters = {}
): Promise<ActionResult<RateLimitEventStats>>
```

仅管理员可访问，支持按用户、供应商、时间范围筛选。

### 获取使用日志统计

```typescript
// src/repository/usage-logs.ts
export async function findUsageLogsStats(
  filters: Omit<UsageLogFilters, "page" | "pageSize">
): Promise<UsageLogSummary>
```

返回错误数量、错误率等统计信息。

## 环境变量

| 变量名 | 默认值 | 说明 |
|--------|--------|------|
| `SYSTEM_TIMEZONE` | `"Asia/Shanghai"` | 系统时区配置，影响"今日"错误率计算 |

## 故障排查

### 错误率突然升高

1. 检查仪表盘错误率趋势，确认是持续性还是瞬时问题
2. 查看使用日志，筛选状态码 >= 400 的请求
3. 分析错误类型分布，识别主要错误来源
4. 检查供应商健康状态，确认是否有供应商被熔断

### 限流事件过多

1. 查看限流事件统计，识别触发限流的用户和类型
2. 检查用户配额配置，确认是否合理
3. 分析限流时间分布，识别高峰时段
4. 考虑调整限流阈值或引导用户错峰使用

### 错误分类不准确

1. 检查错误规则配置，确认规则是否启用
2. 查看错误消息内容，确认是否匹配现有规则
3. 必要时添加新的错误规则
4. 检查规则优先级，确保高优先级规则先匹配

## 最佳实践

### 1. 监控关键指标

建议重点关注以下错误相关指标：

- **错误率趋势**：及时发现系统异常
- **错误类型分布**：识别主要问题来源
- **供应商错误率**：评估供应商稳定性
- **限流事件数**：了解系统负载情况

### 2. 配置合理的错误规则

- 定期审查错误规则的有效性
- 根据业务场景添加自定义规则
- 合理设置规则优先级
- 使用覆写功能提供友好的错误提示

### 3. 处理边缘情况

- 确保 warmup 请求被正确排除
- 客户端中断不应触发告警
- 网络错误需要与供应商错误区分
- 空响应错误需要特殊处理

### 4. 时区管理

- 配置正确的系统时区
- 跨时区团队使用时明确告知时区设置
- 定期检查时区配置是否影响统计准确性

## 相关文档

- [熔断器机制](/docs/proxy/circuit-breaker) - 了解错误如何触发熔断
- [限流机制](/docs/proxy/rate-limiting) - 了解限流事件的产生
- [日志查询与筛选](/docs/monitoring/logs) - 了解如何查看错误日志
- [仪表盘实时指标](/docs/monitoring/dashboard) - 了解错误率展示
- [错误规则检测](/docs/filters/error-rules) - 了解错误规则配置
