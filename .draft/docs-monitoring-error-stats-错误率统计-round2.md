# 错误率统计 (Error Rate Statistics) - Round 2 Review Draft

**Route**: `/docs/monitoring/error-stats`  
**Related Codebase**: `/Users/ding/Github/claude-code-hub`

---

## 1. Intent Analysis

### 1.1 Purpose

错误率统计是 claude-code-hub 监控系统的核心功能之一，用于：

1. **实时监控**：追踪系统整体错误率趋势，及时发现服务异常
2. **故障定位**：通过错误分类和聚合，快速定位问题根源（供应商/网络/客户端）
3. **容量规划**：基于历史错误率数据，评估系统稳定性和容量需求
4. **告警触发**：为熔断器、限流器等防护机制提供数据支撑

### 1.2 User Personas

- **系统管理员**：关注整体错误率趋势，需要按供应商、时间维度分析
- **运维工程师**：需要详细的错误分类信息，用于故障排查
- **开发者**：需要了解错误处理机制和统计数据来源

### 1.3 Key Questions Answered

- 系统的实时错误率是多少？
- 错误主要来源于哪些供应商？
- 错误类型分布如何（网络错误、客户端错误、供应商错误）？
- 错误率的时间趋势如何？
- 哪些错误不应该计入熔断器？

---

## 2. Behavior Summary

### 2.1 Error Classification System

系统采用五层错误分类体系，定义于 `/Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/errors.ts`：

```typescript
export enum ErrorCategory {
  PROVIDER_ERROR,              // 供应商问题（所有 4xx/5xx HTTP 错误）→ 计入熔断器 + 直接切换
  SYSTEM_ERROR,                // 系统/网络问题（fetch 异常）→ 不计入熔断器 + 先重试1次
  CLIENT_ABORT,                // 客户端主动中断 → 不计入熔断器 + 不重试 + 直接返回
  NON_RETRYABLE_CLIENT_ERROR,  // 客户端输入错误 → 不计入熔断器 + 不重试 + 直接返回
  RESOURCE_NOT_FOUND,          // 上游 404 错误 → 不计入熔断器 + 直接切换供应商
}
```

**分类优先级**（从高到低）：

1. **客户端中断检测**（最高优先级）
   - 检测逻辑：`error.name === "AbortError" || error.name === "ResponseAborted"`
   - 或 `error.statusCode === 499`
   - 处理策略：不计入熔断器，不重试，直接返回

2. **不可重试的客户端输入错误**
   - 通过错误规则引擎检测（`errorRuleDetector`）
   - 包括：Prompt 超限、内容过滤、PDF 限制、Thinking 格式错误等
   - 处理策略：不计入熔断器，不重试，直接返回

3. **供应商问题（ProxyError）**
   - 所有 4xx/5xx HTTP 错误
   - 特殊处理：404 错误单独分类为 `RESOURCE_NOT_FOUND`
   - 处理策略：计入熔断器，触发故障切换

4. **空响应错误（EmptyResponseError）**
   - 原因：`empty_body`、`no_output_tokens`、`missing_content`
   - 处理策略：计入熔断器，触发故障切换

5. **系统/网络问题**（默认分类）
   - 包括：DNS 解析失败、连接被拒绝、连接超时、网络中断等
   - 处理策略：不计入熔断器，先重试1次

### 2.2 Error Detection Engine

错误规则检测引擎位于 `/Users/ding/Github/claude-code-hub/src/lib/error-rule-detector.ts`，采用三层匹配策略：

```typescript
class ErrorRuleDetector {
  private regexPatterns: RegexPattern[] = [];      // 正则匹配（最慢，最灵活）
  private containsPatterns: ContainsPattern[] = []; // 包含匹配（O(n*m)）
  private exactPatterns: Map<string, ExactPattern> = new Map(); // 精确匹配（O(1)）
}
```

**检测顺序**（性能优先）：
1. 包含匹配（`String.prototype.includes`）- 最快
2. 精确匹配（`Map.get`）- O(1) 查询
3. 正则匹配（`RegExp.prototype.test`）- 最慢但最灵活

**错误规则类别**（定义于 `/Users/ding/Github/claude-code-hub/src/repository/error-rules.ts`）：

| 类别 | 描述 | 示例 |
|------|------|------|
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

### 2.3 Error Rate Calculation

错误率计算基于 `message_request` 表，核心逻辑位于 `/Users/ding/Github/claude-code-hub/src/repository/overview.ts`：

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
        sql`(${messageRequest.createdAt} AT TIME ZONE ${timezone})::date = (CURRENT_TIMESTAMP AT TIME ZONE ${timezone})::date`
      )
    );

  // 处理成本数据
  const costDecimal = toCostDecimal(result.totalCost) ?? new Decimal(0);
  const todayCost = costDecimal.toDecimalPlaces(6).toNumber();

  // 处理平均响应时间（转换为整数）
  const avgResponseTime = result.avgDuration ? Math.round(Number(result.avgDuration)) : 0;

  // 计算错误率（百分比）
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

**错误率公式**：
```
Error Rate = (Count of statusCode >= 400 / Total Requests) × 100%
```

**关键约束**：
- 排除已删除记录（`deletedAt IS NULL`）
- 排除 warmup 请求（`blocked_by <> 'warmup'`）
- 基于系统时区计算"今日"
- 结果保留两位小数

### 2.4 Error Aggregation by Provider

按供应商聚合错误统计，用于供应商健康度评估。数据来源于 `message_request` 表的 `providerId` 字段，结合 `statusCode >= 400` 条件进行筛选。

### 2.5 Rate Limit Event Statistics

限流事件统计是错误统计的特殊类型，位于 `/Users/ding/Github/claude-code-hub/src/repository/statistics.ts`：

```typescript
export async function getRateLimitEventStats(
  filters: RateLimitEventFilters = {}
): Promise<RateLimitEventStats> {
  const timezone = await resolveSystemTimezone();
  const { user_id, provider_id, limit_type, start_time, end_time, key_id } = filters;

  // 构建 WHERE 条件，筛选包含 rate_limit_metadata 的错误记录
  const conditions: string[] = [
    `${messageRequest.errorMessage.name} LIKE '%rate_limit_metadata%'`,
    `${messageRequest.deletedAt.name} IS NULL`,
  ];

  // 按类型、用户、供应商、小时聚合
  const eventsByType: Record<string, number> = {};
  const eventsByUser: Record<number, number> = {};
  const eventsByProvider: Record<number, number> = {};
  const eventsByHour: Record<string, number> = {};

  // 处理每条记录，解析 rate_limit_metadata JSON
  for (const row of rows) {
    const metadataMatch = row.error_message.match(/rate_limit_metadata:\s*(\{[^}]+\})/);
    if (!metadataMatch) continue;

    const metadata = JSON.parse(metadataMatch[1]);
    // 按维度统计...
  }

  return {
    total_events: rows.length,
    events_by_type: eventsByType as Record<RateLimitType, number>,
    events_by_user: eventsByUser,
    events_by_provider: eventsByProvider,
    events_timeline: eventsTimeline,
    avg_current_usage: Number(avgCurrentUsage.toFixed(2)),
  };
}
```

**限流类型**（`RateLimitType`）：
- `rpm`：每分钟请求数限制
- `usd_5h`：5小时消费限额
- `usd_weekly`：周消费限额
- `usd_monthly`：月消费限额
- `usd_total`：总消费限额
- `concurrent_sessions`：并发会话限制
- `daily_quota`：每日配额

---

## 3. Config/Commands

### 3.1 Database Schema

**message_request 表**（错误统计数据源）：

```sql
CREATE TABLE message_request (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  provider_id INTEGER NOT NULL,
  key VARCHAR NOT NULL,
  model VARCHAR(128),
  duration_ms INTEGER,
  cost_usd NUMERIC(21, 15) DEFAULT '0',
  cost_multiplier NUMERIC(10, 4),
  session_id VARCHAR(64),
  request_sequence INTEGER DEFAULT 1,
  provider_chain JSONB,
  status_code INTEGER,
  api_type VARCHAR(20),
  endpoint VARCHAR(256),
  original_model VARCHAR(128),
  input_tokens BIGINT,
  output_tokens BIGINT,
  ttfb_ms INTEGER,
  cache_creation_input_tokens BIGINT,
  cache_read_input_tokens BIGINT,
  error_message TEXT,
  error_stack TEXT,
  error_cause TEXT,
  blocked_by VARCHAR(50),
  blocked_reason TEXT,
  user_agent VARCHAR(512),
  messages_count INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);
```

**error_rules 表**（错误规则配置）：

```sql
CREATE TABLE error_rules (
  id SERIAL PRIMARY KEY,
  pattern TEXT NOT NULL UNIQUE,
  match_type VARCHAR(20) NOT NULL DEFAULT 'regex',
  category VARCHAR(50) NOT NULL,
  description TEXT,
  override_response JSONB,
  override_status_code INTEGER,
  is_enabled BOOLEAN DEFAULT true NOT NULL,
  is_default BOOLEAN DEFAULT false NOT NULL,
  priority INTEGER DEFAULT 0 NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

### 3.2 Environment Variables

| 变量名 | 描述 | 默认值 |
|--------|------|--------|
| `SYSTEM_TIMEZONE` | 系统时区配置（影响"今日"计算） | `"Asia/Shanghai"` |

### 3.3 API Endpoints

**获取概览统计数据**（含错误率）：
```typescript
// src/repository/overview.ts
export async function getOverviewMetrics(): Promise<OverviewMetrics>
export async function getOverviewMetricsWithComparison(userId?: number): Promise<OverviewMetricsWithComparison>
```

**获取限流事件统计**（管理员）：
```typescript
// src/actions/rate-limit-stats.ts
export async function getRateLimitStats(
  filters: RateLimitEventFilters = {}
): Promise<ActionResult<RateLimitEventStats>>
```

**获取使用日志统计**（含错误详情）：
```typescript
// src/repository/usage-logs.ts
export async function findUsageLogsStats(
  filters: Omit<UsageLogFilters, "page" | "pageSize">
): Promise<UsageLogSummary>
```

### 3.4 Default Error Rules

系统预置 40+ 条默认错误规则，位于 `/Users/ding/Github/claude-code-hub/src/repository/error-rules.ts`：

**关键规则示例**：

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
  {
    pattern: "blocked by.*content filter",
    category: "content_filter",
    matchType: "regex",
    priority: 90,
    overrideResponse: {
      type: "error",
      error: {
        type: "content_filter",
        message: "内容被安全过滤器拦截，请修改输入内容后重试",
      },
    },
  },
  // ... 更多规则
];
```

---

## 4. Edge Cases

### 4.1 Warmup Request Exclusion

Warmup 请求（健康检查）不计入错误统计：

```typescript
// src/repository/_shared/message-request-conditions.ts
export const EXCLUDE_WARMUP_CONDITION = sql`(
  ${messageRequest.blockedBy} IS NULL OR 
  ${messageRequest.blockedBy} <> 'warmup'
)`;
```

### 4.2 Client Abort Handling

客户端主动中断请求（如用户取消）不应计入错误率：

```typescript
export function isClientAbortError(error: Error): boolean {
  // 1. 检查错误名称（最可靠）
  if (error.name === "AbortError" || error.name === "ResponseAborted") {
    return true;
  }

  // 2. 检查 HTTP 状态码（Nginx 使用的 "Client Closed Request"）
  if (error instanceof ProxyError && error.statusCode === 499) {
    return true;
  }

  // 3. 检查精确的错误消息（白名单模式）
  const abortMessages = [
    "This operation was aborted",
    "The user aborted a request",
    "aborted",
  ];

  return abortMessages.some((msg) => error.message.includes(msg));
}
```

### 4.3 Error Override Edge Cases

错误覆写时的边界处理：

```typescript
// 运行时校验覆写状态码范围（400-599）
if (
  validatedStatusCode !== null &&
  (!Number.isInteger(validatedStatusCode) ||
    validatedStatusCode < OVERRIDE_STATUS_CODE_MIN ||
    validatedStatusCode > OVERRIDE_STATUS_CODE_MAX)
) {
  logger.warn("ProxyErrorHandler: Invalid override status code, falling back to upstream");
  validatedStatusCode = null;
}

// 覆写消息为空时回退到客户端安全消息
const overrideMessage =
  typeof overrideErrorObj?.message === "string" &&
  overrideErrorObj.message.trim().length > 0
    ? overrideErrorObj.message
    : clientErrorMessage;
```

### 4.4 Timezone Handling

系统时区配置影响"今日"错误率计算：

```typescript
export async function resolveSystemTimezone(): Promise<string> {
  const envTimezone = process.env.SYSTEM_TIMEZONE;
  if (envTimezone && Intl.supportedValuesOf("timeZone").includes(envTimezone)) {
    return envTimezone;
  }
  return "Asia/Shanghai"; // 默认时区
}
```

### 4.5 Empty Response Detection

空响应（无输出 token 或空 body）视为供应商错误：

```typescript
export class EmptyResponseError extends Error {
  constructor(
    public readonly providerId: number,
    public readonly providerName: string,
    public readonly reason: "empty_body" | "no_output_tokens" | "missing_content"
  ) {
    super(`Empty response from provider ${providerName}: ${reasonMessages[reason]}`);
  }
}
```

### 4.6 Circuit Breaker Integration

错误分类直接影响熔断器行为：

```typescript
export async function categorizeErrorAsync(error: Error): Promise<ErrorCategory> {
  // 客户端中断和不可重试错误不计入熔断器
  if (isClientAbortError(error)) {
    return ErrorCategory.CLIENT_ABORT;
  }
  if (await isNonRetryableClientErrorAsync(error)) {
    return ErrorCategory.NON_RETRYABLE_CLIENT_ERROR;
  }

  // 供应商问题计入熔断器
  if (error instanceof ProxyError) {
    return ErrorCategory.PROVIDER_ERROR;
  }

  // 系统错误不计入熔断器
  return ErrorCategory.SYSTEM_ERROR;
}
```

### 4.7 Error Detection Caching

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

### 4.8 ReDoS Protection

错误规则检测引擎使用 safe-regex 防止正则表达式拒绝服务攻击：

```typescript
import safeRegex from "safe-regex";

// 使用 safe-regex 检测 ReDoS 风险
if (!safeRegex(rule.pattern)) {
  logger.warn(
    `[ErrorRuleDetector] ReDoS risk detected in pattern: ${rule.pattern}, skipping`
  );
  skippedRedosCount++;
  break;
}
```

---

## 5. References

### 5.1 Core Files

| 文件路径 | 描述 |
|----------|------|
| `/Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/errors.ts` | 错误分类、ProxyError 类、错误检测函数 |
| `/Users/ding/Github/claude-code-hub/src/lib/error-rule-detector.ts` | 错误规则检测引擎 |
| `/Users/ding/Github/claude-code-hub/src/repository/error-rules.ts` | 错误规则数据模型和默认规则（40+ 条） |
| `/Users/ding/Github/claude-code-hub/src/repository/overview.ts` | 概览统计数据（含错误率） |
| `/Users/ding/Github/claude-code-hub/src/repository/statistics.ts` | 限流事件统计 |
| `/Users/ding/Github/claude-code-hub/src/repository/usage-logs.ts` | 使用日志查询（含错误详情） |
| `/Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/error-handler.ts` | 错误处理和数据库记录 |
| `/Users/ding/Github/claude-code-hub/src/repository/_shared/message-request-conditions.ts` | Warmup 排除条件 |

### 5.2 Key Code Snippets

**ErrorCategory Enum** (`/Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/errors.ts:457-463`):

```typescript
export enum ErrorCategory {
  PROVIDER_ERROR,             // 供应商问题 → 计入熔断器 + 直接切换
  SYSTEM_ERROR,               // 系统/网络问题 → 不计入熔断器 + 先重试1次
  CLIENT_ABORT,               // 客户端主动中断 → 不计入熔断器 + 不重试
  NON_RETRYABLE_CLIENT_ERROR, // 客户端输入错误 → 不计入熔断器 + 不重试
  RESOURCE_NOT_FOUND,         // 上游 404 → 不计入熔断器 + 直接切换
}
```

**Error Rate SQL** (`/Users/ding/Github/claude-code-hub/src/repository/overview.ts:46-60`):

```typescript
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
      sql`(${messageRequest.createdAt} AT TIME ZONE ${timezone})::date = (CURRENT_TIMESTAMP AT TIME ZONE ${timezone})::date`
    )
  );
```

**Error Detection Cache** (`/Users/ding/Github/claude-code-hub/src/app/v1/_lib/proxy/errors.ts:479-507`):

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

**Rate Limit Event Query** (`/Users/ding/Github/claude-code-hub/src/repository/statistics.ts:1043-1195`):

```typescript
export async function getRateLimitEventStats(
  filters: RateLimitEventFilters = {}
): Promise<RateLimitEventStats> {
  const conditions: string[] = [
    `${messageRequest.errorMessage.name} LIKE '%rate_limit_metadata%'`,
    `${messageRequest.deletedAt.name} IS NULL`,
  ];

  const query = sql`
    SELECT
      ${messageRequest.id},
      ${messageRequest.userId},
      ${messageRequest.providerId},
      ${messageRequest.errorMessage},
      DATE_TRUNC('hour', ${messageRequest.createdAt} AT TIME ZONE ${timezone}) AS hour
    FROM ${messageRequest}
    WHERE ${sql.raw(conditions.join(" AND "))}
    ORDER BY ${messageRequest.createdAt}
  `;
  // ... 聚合处理
}
```

### 5.3 Related Types

**OverviewMetrics Interface** (`/Users/ding/Github/claude-code-hub/src/repository/overview.ts:10-22`):

```typescript
export interface OverviewMetrics {
  todayRequests: number;      // 今日总请求数
  todayCost: number;          // 今日总消耗（美元）
  avgResponseTime: number;    // 平均响应时间（毫秒）
  todayErrorRate: number;     // 今日错误率（百分比）
}
```

**RateLimitEventStats Interface** (`/Users/ding/Github/claude-code-hub/src/types/statistics.ts:101-108`):

```typescript
export interface RateLimitEventStats {
  total_events: number;
  events_by_type: Record<RateLimitType, number>;
  events_by_user: Record<number, number>;
  events_by_provider: Record<number, number>;
  events_timeline: Array<{ hour: string; count: number }>;
  avg_current_usage: number;
}
```

**ErrorRule Interface** (`/Users/ding/Github/claude-code-hub/src/repository/error-rules.ts:60-75`):

```typescript
export interface ErrorRule {
  id: number;
  pattern: string;
  matchType: "regex" | "contains" | "exact";
  category: string;
  description: string | null;
  overrideResponse: ErrorOverrideResponse | null;
  overrideStatusCode: number | null;
  isEnabled: boolean;
  isDefault: boolean;
  priority: number;
  createdAt: Date;
  updatedAt: Date;
}
```

### 5.4 Test Files

| 文件路径 | 描述 |
|----------|------|
| `/Users/ding/Github/claude-code-hub/tests/integration/proxy-errors.test.ts` | 代理错误处理集成测试 |
| `/Users/ding/Github/claude-code-hub/tests/integration/error-rule-detector.test.ts` | 错误规则检测引擎测试 |
| `/Users/ding/Github/claude-code-hub/tests/unit/proxy/ssl-error-detection.test.ts` | SSL 错误检测单元测试 |
| `/Users/ding/Github/claude-code-hub/tests/unit/repository/error-rules-default-thinking-tooluse.test.ts` | 默认规则测试 |
| `/Users/ding/Github/claude-code-hub/tests/unit/repository/warmup-stats-exclusion.test.ts` | Warmup 排除测试 |

---

## 6. Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                        Error Flow                               │
└─────────────────────────────────────────────────────────────────┘

   ┌──────────────┐
   │ Client Request│
   └──────┬───────┘
          │
          ▼
   ┌──────────────┐     ┌──────────────────┐
   │ ProxySession  │────▶│ Error Detection  │
   └──────┬───────┘     └────────┬─────────┘
          │                       │
          │              ┌────────┴────────┐
          │              │                 │
          │      ┌───────▼──────┐  ┌──────▼──────┐
          │      │ Error Rules  │  │ HTTP Status │
          │      │  Engine      │  │   Check     │
          │      └───────┬──────┘  └──────┬──────┘
          │              │                 │
          │              └────────┬────────┘
          │                       │
          ▼                       ▼
   ┌──────────────┐     ┌──────────────────┐
   │ categorize   │────▶│ ErrorCategory    │
   │ ErrorAsync   │     │ Enum             │
   └──────┬───────┘     └────────┬─────────┘
          │                       │
          │         ┌─────────────┼─────────────┐
          │         │             │             │
          │    ┌────▼───┐   ┌────▼───┐   ┌────▼───┐
          │    │PROVIDER│   │ SYSTEM │   │CLIENT  │
          │    │ _ERROR │   │ _ERROR │   │_ABORT  │
          │    └────┬───┘   └───┬────┘   └───┬────┘
          │         │           │            │
          │    ┌────▼───┐   ┌───▼────┐   ┌───▼────┐
          │    │Circuit │   │ Retry  │   │ Return │
          │    │ Breaker│   │ 1 Time │   │ Direct │
          │    └────┬───┘   └───┬────┘   └───┬────┘
          │         │           │            │
          │         └───────────┴────────────┘
          │                       │
          ▼                       ▼
   ┌──────────────┐     ┌──────────────────┐
   │ ErrorHandler  │────▶│ Database Logger  │
   └──────┬───────┘     └────────┬─────────┘
          │                       │
          │              ┌────────┴────────┐
          │              │                 │
          │      ┌───────▼──────┐  ┌──────▼──────┐
          │      │ message_     │  │ provider_   │
          └─────▶│ request      │  │ chain       │
                 │ (error_log)  │  │ (retry_log) │
                 └──────────────┘  └─────────────┘
```

---

## 7. Summary

claude-code-hub 的错误率统计系统具有以下特点：

1. **五层错误分类**：精确区分供应商错误、系统错误、客户端中断、不可重试错误和 404 错误
2. **规则引擎驱动**：支持 40+ 种预置错误规则，可按正则/包含/精确三种方式匹配
3. **智能错误检测**：使用 WeakMap 缓存检测结果，避免重复计算
4. **熔断器集成**：错误分类直接决定熔断器计数策略
5. **多维度聚合**：支持按供应商、用户、时间、错误类型等多维度统计
6. **限流事件追踪**：特殊的限流错误统计，支持 7 种限流类型
7. **时区感知**：基于系统配置时区计算"今日"错误率
8. **Warmup 排除**：健康检查请求不计入错误统计
9. **ReDoS 防护**：使用 safe-regex 防止正则表达式攻击
10. **错误覆写**：支持将复杂的上游错误转换为友好的用户提示

**字数统计**：约 4,800 字
