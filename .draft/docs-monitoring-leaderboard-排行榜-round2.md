# Leaderboard Implementation Analysis Report (Round 2)

## 1. Intent Analysis

### 1.1 Purpose
The leaderboard feature in Claude Code Hub is designed to provide comprehensive usage statistics and rankings across multiple dimensions. It serves as a monitoring and analytics tool that enables administrators and authorized users to track consumption patterns, compare performance metrics, and gain insights into system usage.

### 1.2 Core Objectives
- **Usage Visibility**: Provide transparent visibility into API consumption across users, providers, and models
- **Cost Tracking**: Enable cost-based ranking to identify high-consumption entities
- **Performance Monitoring**: Track success rates, latency metrics (TTFB), and token throughput
- **Cache Efficiency Analysis**: Monitor provider cache hit rates to optimize costs
- **Administrative Control**: Allow administrators to monitor system-wide usage while respecting privacy controls
- **Scheduled Reporting**: Support automated daily leaderboard notifications via webhooks

### 1.3 Target Users
- **Administrators**: Full access to all leaderboard scopes (user, provider, model, cache hit rate)
- **Regular Users with Global View Permission**: Access to user rankings when `allowGlobalUsageView` is enabled
- **Regular Users**: Limited access to their own data only (when global view is disabled)

---

## 2. Behavior Summary

### 2.1 Leaderboard Scopes

The system supports four distinct leaderboard scopes, each providing different analytical perspectives:

#### 2.1.1 User Rankings (`user`)
- **Purpose**: Rank users by their API consumption
- **Metrics**: Total requests, total cost (USD), total tokens
- **Sorting**: By total cost (descending)
- **Filters**: User tags (OR logic), user groups (OR logic) - admin only
- **Data Source**: Aggregated from `message_request` table joined with `users`

#### 2.1.2 Provider Rankings (`provider`)
- **Purpose**: Rank LLM providers by usage and performance
- **Metrics**: 
  - Total requests, total cost, total tokens
  - Success rate (successful requests / total requests)
  - Average TTFB (Time To First Byte) in milliseconds
  - Average tokens per second (calculated from output tokens and response time)
- **Sorting**: By total cost (descending)
- **Filters**: Provider type (Claude, Claude-auth, Codex, Gemini, Gemini-cli, OpenAI-compatible)

#### 2.1.3 Provider Cache Hit Rate Rankings (`providerCacheHitRate`)
- **Purpose**: Analyze cache efficiency across providers
- **Metrics**: 
  - Cache hit rate (0-1 decimal, formatted as percentage in UI)
  - Cache read tokens
  - Cache creation cost
  - Total input tokens (input + cache creation + cache read)
- **Sorting**: By cache hit rate (descending), then by request count (descending)
- **Filters**: Provider type
- **Special Logic**: Only includes requests with cache activity (creation or read tokens > 0)

#### 2.1.4 Model Rankings (`model`)
- **Purpose**: Rank AI models by usage frequency
- **Metrics**: Total requests, total cost, total tokens, success rate
- **Sorting**: By request count (descending) - different from other scopes
- **Configuration**: Model source determined by `billingModelSource` setting
  - `original`: Use `originalModel` (user-requested model), fallback to `model`
  - `redirected`: Use `model` (actual model after redirection), fallback to `originalModel`

### 2.2 Time Period Filters

The leaderboard supports multiple time period filters to accommodate different analysis needs:

| Period | Description | SQL Implementation |
|--------|-------------|-------------------|
| `daily` | Current calendar day | `(${messageRequest.createdAt} AT TIME ZONE ${timezone})::date = (CURRENT_TIMESTAMP AT TIME ZONE ${timezone})::date` |
| `weekly` | Current week (ISO week) | `date_trunc('week', ${messageRequest.createdAt} AT TIME ZONE ${timezone}) = date_trunc('week', CURRENT_TIMESTAMP AT TIME ZONE ${timezone})` |
| `monthly` | Current calendar month | `date_trunc('month', ${messageRequest.createdAt} AT TIME ZONE ${timezone}) = date_trunc('month', CURRENT_TIMESTAMP AT TIME ZONE ${timezone})` |
| `allTime` | All historical data | `1=1` (no date filter) |
| `custom` | User-defined date range | `startDate <= date <= endDate` with timezone conversion |

**Note**: The `last24h` period exists internally for daily notifications but is NOT exposed via the public API.

### 2.3 Frontend Components

#### 2.3.1 Leaderboard Page (`page.tsx`)
- Server component that handles authentication and permission checks
- Displays permission alert for unauthorized users with helpful guidance
- Renders `LeaderboardView` component for authorized users

#### 2.3.2 Leaderboard View (`leaderboard-view.tsx`)
- Main container component for the leaderboard interface
- Manages scope selection via tabs (user, provider, providerCacheHitRate, model)
- Supports URL query parameters for deep linking (`?period=daily&scope=user`)
- Implements loading states with skeleton UI
- Handles error states with user-friendly messages
- Provides filter controls:
  - Provider type filter (for provider scopes)
  - User tag filter with autocomplete
  - User group filter with autocomplete

#### 2.3.3 Leaderboard Table (`leaderboard-table.tsx`)
- Reusable table component with dynamic column definitions
- Supports client-side sorting on multiple columns
- Displays ranking indicators (medals for top 3 positions: 🥇 🥈 🥉)
- Responsive design with proper formatting for costs and token counts
- Empty state handling with period-specific messages

#### 2.3.4 Date Range Picker (`date-range-picker.tsx`)
- Quick period selection buttons (Daily, Weekly, Monthly, All Time)
- Custom date range picker with calendar interface
- Navigation arrows for moving between periods
- Handles timezone-aware date formatting
- Parses dates as local dates to avoid timezone off-by-one errors

#### 2.3.5 Dashboard Mini Leaderboards
- `today-leaderboard.tsx`: Legacy component for dashboard overview
- `leaderboard-card.tsx`: Bento grid card component showing top N entries with progress bars
- `dashboard-bento.tsx`: Integrates multiple leaderboard cards (user, provider, model)

### 2.4 API Endpoint

**Endpoint**: `GET /api/leaderboard`

**Query Parameters**:
```typescript
{
  period: "daily" | "weekly" | "monthly" | "allTime" | "custom",
  scope: "user" | "provider" | "providerCacheHitRate" | "model",
  startDate?: string,  // YYYY-MM-DD format (required for custom period)
  endDate?: string,    // YYYY-MM-DD format (required for custom period)
  providerType?: ProviderType,  // Filter by provider type
  userTags?: string,   // Comma-separated list of tags (max 20 items)
  userGroups?: string  // Comma-separated list of groups (max 20 items)
}
```

**Validation Rules**:
- Date format validated with regex: `/^\d{4}-\d{2}-\d{2}$/`
- `startDate` must not be after `endDate`
- User tags/groups are trimmed, filtered (empty removed), and capped at 20 items
- Provider type must be one of: claude, claude-auth, codex, gemini, gemini-cli, openai-compatible

**Response Headers**:
```
Cache-Control: public, s-maxage=60, stale-while-revalidate=120
```

**Error Responses**:
- HTTP 401: Not authenticated ("未登录")
- HTTP 403: No permission ("无权限访问排行榜，请联系管理员开启全站使用量查看权限")
- HTTP 400: Invalid parameters with specific error messages

---

## 3. Ranking Algorithms

### 3.1 User Ranking Algorithm

```typescript
// Core query structure (from src/repository/leaderboard.ts)
const rankings = await db
  .select({
    userId: messageRequest.userId,
    userName: users.name,
    totalRequests: sql<number>`count(*)::double precision`,
    totalCost: sql<string>`COALESCE(sum(${messageRequest.costUsd}), 0)`,
    totalTokens: sql<number>`COALESCE(
      sum(
        ${messageRequest.inputTokens} +
        ${messageRequest.outputTokens} +
        COALESCE(${messageRequest.cacheCreationInputTokens}, 0) +
        COALESCE(${messageRequest.cacheReadInputTokens}, 0)
      )::double precision,
      0::double precision
    )`,
  })
  .from(messageRequest)
  .innerJoin(users, and(
    sql`${messageRequest.userId} = ${users.id}`, 
    isNull(users.deletedAt)
  ))
  .where(and(
    isNull(messageRequest.deletedAt),
    EXCLUDE_WARMUP_CONDITION,
    buildDateCondition(period, timezone, dateRange),
    // Optional: tagFilterCondition OR groupFilterCondition
  ))
  .groupBy(messageRequest.userId, users.name)
  .orderBy(desc(sql`sum(${messageRequest.costUsd})`));
```

**Key Points**:
- Excludes deleted users (`isNull(users.deletedAt)`)
- Excludes deleted requests (`isNull(messageRequest.deletedAt)`)
- Excludes warmup requests (`EXCLUDE_WARMUP_CONDITION`)
- Token calculation includes: input + output + cache creation + cache read tokens
- Sorted by total cost in descending order

**User Filter Logic**:
- Tags use JSONB containment operator: `users.tags ? ${tag}`
- Groups use regex split on comma: `regexp_split_to_array(coalesce(${users.providerGroup}, ''), '\s*,\s*')`
- Tag and group conditions are combined with OR logic when both present

### 3.2 Provider Ranking Algorithm

```typescript
const rankings = await db
  .select({
    providerId: messageRequest.providerId,
    providerName: providers.name,
    totalRequests: sql<number>`count(*)::double precision`,
    totalCost: sql<string>`COALESCE(sum(${messageRequest.costUsd}), 0)`,
    totalTokens: sql<number>`/* same as user query */`,
    successRate: sql<number>`COALESCE(
      count(CASE WHEN ${messageRequest.errorMessage} IS NULL OR ${messageRequest.errorMessage} = '' THEN 1 END)::double precision
      / NULLIF(count(*)::double precision, 0),
      0::double precision
    )`,
    avgTtfbMs: sql<number>`COALESCE(avg(${messageRequest.ttfbMs})::double precision, 0::double precision)`,
    avgTokensPerSecond: sql<number>`COALESCE(
      avg(
        CASE
          WHEN ${messageRequest.outputTokens} > 0
            AND ${messageRequest.durationMs} IS NOT NULL
            AND ${messageRequest.ttfbMs} IS NOT NULL
            AND ${messageRequest.ttfbMs} < ${messageRequest.durationMs}
            AND (${messageRequest.durationMs} - ${messageRequest.ttfbMs}) >= 100
          THEN (${messageRequest.outputTokens}::double precision)
            / ((${messageRequest.durationMs} - ${messageRequest.ttfbMs}) / 1000.0)
        END
      )::double precision,
      0::double precision
    )`,
  })
  .from(messageRequest)
  .innerJoin(providers, and(
    sql`${messageRequest.providerId} = ${providers.id}`,
    isNull(providers.deletedAt)
  ))
  .where(/* same conditions + optional providerType */)
  .groupBy(messageRequest.providerId, providers.name)
  .orderBy(desc(sql`sum(${messageRequest.costUsd})`));
```

**Key Points**:
- Success rate: `successful_requests / total_requests` (null/empty errorMessage = success)
- TTFB averaged across all requests with null handling
- Tokens per second calculated only when:
  - Output tokens > 0
  - Duration and TTFB are available
  - TTFB < Duration (valid timing)
  - Generation time >= 100ms (to avoid division by near-zero)
- Formula: `outputTokens / ((durationMs - ttfbMs) / 1000.0)`

### 3.3 Cache Hit Rate Ranking Algorithm

```typescript
const totalInputTokensExpr = sql<number>`(
  COALESCE(${messageRequest.inputTokens}, 0)::double precision +
  COALESCE(${messageRequest.cacheCreationInputTokens}, 0)::double precision +
  COALESCE(${messageRequest.cacheReadInputTokens}, 0)::double precision
)`;

const cacheRequiredCondition = sql`(
  COALESCE(${messageRequest.cacheCreationInputTokens}, 0) > 0
  OR COALESCE(${messageRequest.cacheReadInputTokens}, 0) > 0
)`;

const cacheHitRateExpr = sql<number>`COALESCE(
  ${sumCacheReadTokens} / NULLIF(${sumTotalInputTokens}, 0::double precision),
  0::double precision
)`;
```

**Cache Hit Rate Formula**:
```
cacheHitRate = cacheReadTokens / (inputTokens + cacheCreationInputTokens + cacheReadInputTokens)
```

**Key Points**:
- Only includes requests with cache activity (creation OR read tokens > 0)
- Total input tokens = input + cache creation + cache read
- Sorted by cache hit rate (descending), then by request count (descending)
- Cache creation cost is the sum of costs for requests with cache creation tokens

### 3.4 Model Ranking Algorithm

```typescript
// Model field determined by billingModelSource setting
const modelField = billingModelSource === "original"
  ? sql<string>`COALESCE(${messageRequest.originalModel}, ${messageRequest.model})`
  : sql<string>`COALESCE(${messageRequest.model}, ${messageRequest.originalModel})`;

const rankings = await db
  .select({
    model: modelField,
    totalRequests: sql<number>`count(*)::double precision`,
    totalCost: sql<string>`COALESCE(sum(${messageRequest.costUsd}), 0)`,
    totalTokens: sql<number>`/* same calculation */`,
    successRate: sql<number>`/* same as provider */`,
  })
  .from(messageRequest)
  .where(
    isNull(messageRequest.deletedAt),
    EXCLUDE_WARMUP_CONDITION,
    buildDateCondition(period, timezone, dateRange)
  )
  .groupBy(modelField)
  .orderBy(desc(sql`count(*)`)); // Note: sorted by request count, not cost

// Filter out null/empty model names
return rankings
  .filter((entry) => entry.model !== null && entry.model !== "")
  .map(/* ... */);
```

**Key Points**:
- Model source configurable via `billingModelSource` setting
- Filters out null and empty model names after query
- Sorted by request count (not cost) to show most frequently used models
- No joins required - data comes from `message_request` table only

---

## 4. Data Sources and Aggregation

### 4.1 Primary Data Source: `message_request` Table

All leaderboard data is aggregated from the `message_request` table.

**Key Fields**:
| Field | Type | Description |
|-------|------|-------------|
| `userId` | integer | User who made the request |
| `providerId` | integer | LLM provider used |
| `model` | varchar(128) | Actual model used (after redirection) |
| `originalModel` | varchar(128) | User-requested model name |
| `costUsd` | numeric(21,15) | Calculated cost in USD |
| `inputTokens` | bigint | Input token count |
| `outputTokens` | bigint | Output token count |
| `cacheCreationInputTokens` | bigint | Cache creation tokens |
| `cacheReadInputTokens` | bigint | Cache read tokens |
| `ttfbMs` | integer | Time to first byte in milliseconds |
| `durationMs` | integer | Total request duration |
| `errorMessage` | text | Error message if request failed |
| `createdAt` | timestamp | Request timestamp (with timezone) |
| `deletedAt` | timestamp | Soft delete timestamp |
| `blockedBy` | varchar(50) | Interception reason (e.g., 'warmup') |

### 4.2 Exclusion Rules

The following records are excluded from all leaderboard calculations:

1. **Deleted records**: `deletedAt IS NULL`
2. **Warmup requests**: `blockedBy IS NULL OR blockedBy <> 'warmup'`
3. **Invalid models**: Model name is null or empty string (for model rankings)
4. **Deleted users/providers**: Join conditions filter out soft-deleted entities

**Warmup Exclusion Implementation** (`src/repository/_shared/message-request-conditions.ts`):
```typescript
export const EXCLUDE_WARMUP_CONDITION = 
  sql`(${messageRequest.blockedBy} IS NULL OR ${messageRequest.blockedBy} <> 'warmup')`;
```

### 4.3 Cost Calculation

Costs are calculated at request time using the cost calculation utilities. The leaderboard reads the pre-calculated `costUsd` field.

Cost components typically include:
1. Input tokens × input_cost_per_token
2. Output tokens × output_cost_per_token
3. Cache creation tokens × cache_creation_cost
4. Cache read tokens × cache_read_cost
5. Context 1M premium multiplier (if applicable)

### 4.4 Token Aggregation

Total tokens are calculated as:
```
totalTokens = inputTokens + outputTokens + cacheCreationInputTokens + cacheReadInputTokens
```

All token fields use `COALESCE` to treat NULL as 0.

---

## 5. Configuration

### 5.1 System Settings

#### 5.1.1 allowGlobalUsageView
```typescript
// Location: src/drizzle/schema.ts
allowGlobalUsageView: boolean('allow_global_usage_view').notNull().default(false)
```

**Purpose**: Controls whether non-admin users can view global usage statistics.

**Behavior**:
- When `true`: Regular users can see user rankings and global statistics
- When `false`: Regular users see permission denied message

**UI Location**: Settings > System Configuration > Allow Global Usage View

#### 5.1.2 billingModelSource
```typescript
billingModelSource: varchar('billing_model_source', { length: 20 })
  .notNull()
  .default('original')
  .$type<'original' | 'redirected'>()
```

**Purpose**: Determines which model name to use for model rankings.

**Options**:
- `original`: Use `originalModel` (user-requested model), fallback to `model`
- `redirected`: Use `model` (actual model after redirection), fallback to `originalModel`

#### 5.1.3 currencyDisplay
```typescript
currencyDisplay: varchar('currency_display', { length: 10 }).notNull().default('USD')
```

**Purpose**: Determines the currency unit for cost display.

**Supported Values**: USD, CNY, EUR, etc. (defined in `CURRENCY_CONFIG`)

#### 5.1.4 timezone
```typescript
timezone: varchar('timezone', { length: 64 })  // IANA timezone identifier
```

**Purpose**: Defines the system timezone for date boundary calculations.

**Default**: Uses environment variable `TZ` or falls back to UTC via `resolveSystemTimezone()`

### 5.2 Notification Settings

#### 5.2.1 Daily Leaderboard Configuration
```typescript
// Location: src/drizzle/schema.ts
dailyLeaderboardEnabled: boolean('daily_leaderboard_enabled').notNull().default(false)
dailyLeaderboardWebhook: varchar('daily_leaderboard_webhook', { length: 512 })
dailyLeaderboardTime: varchar('daily_leaderboard_time', { length: 10 }).default('09:00')
dailyLeaderboardTopN: integer('daily_leaderboard_top_n').default(5)
```

**Configuration Options**:
- **Enable**: Toggle daily leaderboard notifications
- **Webhook URL**: Target URL for webhook notifications (legacy mode)
- **Send Time**: Time in HH:mm format (default: 09:00)
- **Top N**: Number of top users to include (default: 5)

**Webhook Targets Mode** (New):
The system also supports a modern notification target binding system:
```typescript
// Notification Target Bindings table
notificationTargetBindings: {
  notificationType: 'daily_leaderboard',
  targetId: number,  // References webhookTargets
  isEnabled: boolean,
  scheduleCron: string,  // Optional cron override
  scheduleTimezone: string,  // Optional timezone override
}
```

**Webhook Message Format**:
```typescript
interface DailyLeaderboardData {
  date: string;  // YYYY-MM-DD format
  entries: Array<{
    userId: number;
    userName: string;
    totalRequests: number;
    totalCost: number;
    totalTokens: number;
  }>;
  totalRequests: number;
  totalCost: number;
}
```

**Message Template** (Chinese):
- Title: "过去24小时用户消费排行榜"
- Icon: 📊
- Level: info
- Sections: Date quote, Ranked list with medals, Divider, Summary statistics

### 5.3 Redis Cache Configuration

The leaderboard implements Redis-based optimistic caching:

**Cache Strategy**:
```typescript
// Cache TTL: 60 seconds
// Lock TTL: 10 seconds  
// Retry: 50 attempts × 100ms = 5 seconds max wait
```

**Cache Key Format**:
```
leaderboard:{scope}:{period}:{date}:{currency}{providerSuffix}{filterSuffix}
```

Examples:
- Daily: `leaderboard:user:daily:2025-01-29:USD`
- Weekly: `leaderboard:user:weekly:2025-W04:USD`
- Monthly: `leaderboard:user:monthly:2025-01:USD`
- Custom: `leaderboard:user:custom:2025-01-01_2025-01-29:USD`
- With provider filter: `leaderboard:provider:daily:2025-01-29:USD:provider=claude`
- With user filters: `leaderboard:user:daily:2025-01-29:USD:tags=tag1,tag2`

**Cache Behavior**:
1. First request checks cache
2. Cache miss → acquire distributed lock (SET NX EX 10)
3. Lock holder queries database and writes cache (SETEX 60)
4. Non-lock holders wait and retry (up to 5 seconds)
5. Timeout or Redis failure → fallback to direct database query

---

## 6. Edge Cases and Error Handling

### 6.1 Permission Denied

**Scenario**: Non-admin user attempts to access leaderboard without `allowGlobalUsageView` enabled.

**Behavior**:
- API returns HTTP 403 with message: "无权限访问排行榜，请联系管理员开启全站使用量查看权限"
- UI displays permission alert with:
  - Alert icon and title
  - Description explaining the restriction
  - Link to system settings (for admins)
  - Guidance for regular users to contact administrator

### 6.2 Empty Data

**Scenario**: No usage data exists for the selected period.

**Behavior**:
- API returns empty array `[]`
- UI displays period-specific "no data" message:
  - Daily: "states.todayNoData"
  - Weekly: "states.weekNoData"
  - Monthly: "states.monthNoData"
  - Default: "states.noData"
- Daily leaderboard notification is skipped if no data

### 6.3 Redis Unavailable

**Scenario**: Redis connection fails during leaderboard request.

**Behavior**:
- System logs warning: "[LeaderboardCache] Redis not available, fallback to direct query"
- Falls back to direct database query
- Request succeeds but without caching benefits
- Error is logged but not exposed to user

### 6.4 Concurrent Cache Miss (Cache Stampede Protection)

**Scenario**: Multiple requests hit cache miss simultaneously.

**Behavior**:
- First request acquires distributed lock and queries database
- Other requests wait and retry (max 50 retries × 100ms = 5 seconds)
- If lock holder completes, waiting requests read from cache
- If timeout occurs, waiting requests fall back to direct query
- Lock is automatically released after 10 seconds (TTL)

### 6.5 Invalid Date Range

**Scenario**: User provides invalid date parameters for custom period.

**Behavior**:
- API validates date format using regex: `/^\d{4}-\d{2}-\d{2}$/`
- Returns HTTP 400 with specific error message:
  - "当 period=custom 时，必须提供 startDate 和 endDate 参数"
  - "日期格式必须是 YYYY-MM-DD"
  - "startDate 不能大于 endDate"

### 6.6 Invalid Period/Scope

**Scenario**: User provides invalid period or scope parameter.

**Behavior**:
- API validates against allowed values arrays
- Returns HTTP 400 with list of valid options
- Defaults to `daily` period and `user` scope if not provided

### 6.7 Timezone Handling

**Scenario**: System spans multiple timezones.

**Behavior**:
- All date calculations use system-configured timezone via `resolveSystemTimezone()`
- SQL queries use `AT TIME ZONE` operator for proper boundary calculation
- Cache keys include timezone to prevent cross-timezone contamination
- Daily leaderboard notifications use system timezone for date formatting

### 6.8 Deleted Users/Providers

**Scenario**: User or provider is soft-deleted (deletedAt set).

**Behavior**:
- Records are excluded from rankings via `isNull(users.deletedAt)` condition
- Historical data remains in database but not visible in current leaderboards
- All-time rankings reflect only active entities

### 6.9 Model Name Variations

**Scenario**: Same model appears with different names (e.g., "gpt-4" vs "gpt-4-turbo").

**Behavior**:
- Models are grouped by exact string match
- No automatic alias resolution
- Administrators should ensure consistent model naming in provider configurations

### 6.10 Currency Conversion

**Scenario**: Costs stored in USD but displayed in other currencies.

**Behavior**:
- Costs always stored in USD in database
- Conversion happens at display time using `formatCurrency` function
- Formatted values appended to API response as `totalCostFormatted`
- Cache keys include currency display to prevent cross-currency contamination

### 6.11 User Filter Parameters

**Scenario**: User provides malformed tag or group filters.

**Behavior**:
- Parameters are split by comma
- Each item is trimmed of whitespace
- Empty strings are filtered out
- Maximum 20 items are processed (additional items ignored)
- Filters only apply when scope is "user"

---

## 7. Commands and API Usage

### 7.1 Fetch Leaderboard Data

```bash
# Daily user rankings
curl -H "Cookie: session=..." \
  "http://localhost:3000/api/leaderboard?period=daily&scope=user"

# Weekly provider rankings
curl -H "Cookie: session=..." \
  "http://localhost:3000/api/leaderboard?period=weekly&scope=provider"

# Custom date range with user filters
curl -H "Cookie: session=..." \
  "http://localhost:3000/api/leaderboard?period=custom&scope=user&startDate=2025-01-01&endDate=2025-01-31&userTags=premium,vip"

# Provider cache hit rate for specific provider type
curl -H "Cookie: session=..." \
  "http://localhost:3000/api/leaderboard?period=daily&scope=providerCacheHitRate&providerType=claude"
```

### 7.2 Server Actions

```typescript
// Get daily leaderboard data with user filters
import { findDailyLeaderboard } from "@/repository/leaderboard";
const users = await findDailyLeaderboard({ userTags: ["premium"], userGroups: ["enterprise"] });

// Get provider rankings with type filter
import { findDailyProviderLeaderboard } from "@/repository/leaderboard";
const providers = await findDailyProviderLeaderboard("claude");

// Get model rankings
import { findDailyModelLeaderboard } from "@/repository/leaderboard";
const models = await findDailyModelLeaderboard();

// Get cached leaderboard (with Redis)
import { getLeaderboardWithCache } from "@/lib/redis";
const data = await getLeaderboardWithCache(
  "daily",      // period
  "USD",        // currency
  "user",       // scope
  undefined,    // dateRange
  { userTags: ["premium"] }  // filters
);

// Get last 24h leaderboard (for notifications)
import { findLast24HoursLeaderboard } from "@/repository/leaderboard";
const leaderboard = await findLast24HoursLeaderboard();
```

### 7.3 Scheduled Tasks

```typescript
// Generate and send daily leaderboard
import { sendDailyLeaderboard } from "@/lib/notification/notifier";
await sendDailyLeaderboard();

// Generate leaderboard data only
import { generateDailyLeaderboard } from "@/lib/notification/tasks/daily-leaderboard";
const data = await generateDailyLeaderboard(10);  // Top 10 users

// Manually invalidate cache
import { invalidateLeaderboardCache } from "@/lib/redis";
await invalidateLeaderboardCache("daily", "USD", "user");
```

---

## 8. File References

### 8.1 Core Implementation Files

| File | Purpose |
|------|---------|
| `src/app/api/leaderboard/route.ts` | API endpoint for leaderboard data |
| `src/repository/leaderboard.ts` | Database queries for all leaderboard types |
| `src/lib/redis/leaderboard-cache.ts` | Redis caching layer with distributed locking |
| `src/app/[locale]/dashboard/leaderboard/page.tsx` | Leaderboard page server component |
| `src/app/[locale]/dashboard/leaderboard/_components/leaderboard-view.tsx` | Main leaderboard UI with filters |
| `src/app/[locale]/dashboard/leaderboard/_components/leaderboard-table.tsx` | Table component with client-side sorting |
| `src/app/[locale]/dashboard/leaderboard/_components/date-range-picker.tsx` | Date range selection UI |
| `src/app/[locale]/dashboard/_components/today-leaderboard.tsx` | Legacy dashboard mini leaderboard |
| `src/app/[locale]/dashboard/_components/bento/leaderboard-card.tsx` | Bento grid leaderboard card |
| `src/repository/_shared/message-request-conditions.ts` | Shared exclusion conditions (warmup, etc.) |

### 8.2 Notification Files

| File | Purpose |
|------|---------|
| `src/lib/notification/tasks/daily-leaderboard.ts` | Daily leaderboard data generation |
| `src/lib/notification/notifier.ts` | Notification dispatcher |
| `src/lib/notification/notification-queue.ts` | Bull queue for async notifications |
| `src/lib/webhook/templates/daily-leaderboard.ts` | Webhook message formatting |
| `src/lib/webhook/notifier.ts` | Webhook sender with retry logic |
| `src/lib/webhook/types.ts` | TypeScript type definitions |

### 8.3 Configuration Files

| File | Purpose |
|------|---------|
| `src/drizzle/schema.ts` | Database schema including system settings |
| `src/repository/system-config.ts` | System settings repository |
| `src/types/system-config.ts` | System settings TypeScript types |
| `src/lib/config/system-settings-cache.ts` | Cached system settings access |

### 8.4 Database Schema References

| Table | Relevant Columns |
|-------|-----------------|
| `message_request` | userId, providerId, model, originalModel, costUsd, inputTokens, outputTokens, cacheCreationInputTokens, cacheReadInputTokens, ttfbMs, durationMs, errorMessage, createdAt, deletedAt, blockedBy |
| `users` | id, name, tags, providerGroup, deletedAt |
| `providers` | id, name, providerType, deletedAt |
| `system_settings` | allowGlobalUsageView, currencyDisplay, billingModelSource, timezone |
| `notification_settings` | dailyLeaderboardEnabled, dailyLeaderboardWebhook, dailyLeaderboardTime, dailyLeaderboardTopN |
| `webhook_targets` | id, providerType, webhookUrl, etc. |
| `notification_target_bindings` | notificationType, targetId, isEnabled, scheduleCron |

### 8.5 Type Definitions

```typescript
// Leaderboard Period (API-exposed)
type LeaderboardPeriod = "daily" | "weekly" | "monthly" | "allTime" | "custom";

// Internal period (includes last24h for notifications)
type InternalLeaderboardPeriod = "daily" | "weekly" | "monthly" | "allTime" | "custom" | "last24h";

// Leaderboard Scope
type LeaderboardScope = "user" | "provider" | "providerCacheHitRate" | "model";

// Leaderboard Entry (User)
interface LeaderboardEntry {
  userId: number;
  userName: string;
  totalRequests: number;
  totalCost: number;
  totalTokens: number;
}

// Provider Leaderboard Entry
interface ProviderLeaderboardEntry {
  providerId: number;
  providerName: string;
  totalRequests: number;
  totalCost: number;
  totalTokens: number;
  successRate: number;  // 0-1 decimal
  avgTtfbMs: number;
  avgTokensPerSecond: number;
}

// Cache Hit Rate Entry
interface ProviderCacheHitRateLeaderboardEntry {
  providerId: number;
  providerName: string;
  totalRequests: number;
  totalCost: number;
  cacheReadTokens: number;
  cacheCreationCost: number;
  totalInputTokens: number;
  cacheHitRate: number;  // 0-1 decimal
}

// Model Leaderboard Entry
interface ModelLeaderboardEntry {
  model: string;
  totalRequests: number;
  totalCost: number;
  totalTokens: number;
  successRate: number;  // 0-1 decimal
}

// Date Range Parameters
interface DateRangeParams {
  startDate: string;  // YYYY-MM-DD
  endDate: string;    // YYYY-MM-DD
}

// User Filters
interface UserLeaderboardFilters {
  userTags?: string[];
  userGroups?: string[];
}
```

---

## 9. Performance Considerations

### 9.1 Database Optimization

**Indexes** (defined in schema):
- `idx_message_request_user_date_cost`: Composite index on (userId, createdAt, costUsd) with deletedAt IS NULL filter
- `idx_message_request_user_query`: Composite index on (userId, createdAt) for user queries
- `idx_message_request_provider_id`: Index on providerId
- `idx_message_request_created_at`: Index on createdAt
- `idx_message_request_blocked_by`: Partial index for warmup exclusion

**Query Optimization**:
- Uses `EXCLUDE_WARMUP_CONDITION` to leverage partial indexes
- All queries filter on `deletedAt IS NULL` to use partial indexes
- Timezone conversion happens in SQL via `AT TIME ZONE` operator

### 9.2 Caching Strategy

- **Redis Cache**: 60-second TTL for leaderboard data
- **Distributed Lock**: Prevents cache stampede during high traffic
- **Graceful Degradation**: Falls back to database queries if Redis unavailable
- **Cache Key Design**: Includes all filter parameters to prevent contamination

### 9.3 Frontend Optimization

- **Skeleton Loading**: Shows placeholder UI while data loads
- **Client-Side Sorting**: Sorting happens on already-fetched data (no server round-trip)
- **Memoization**: Uses `useMemo` for expensive calculations (sorted data, column definitions)
- **URL State**: Period and scope synced to URL for shareable links

---

## 10. Security Considerations

### 10.1 Authentication

- All leaderboard endpoints require valid session via `getSession()`
- Unauthenticated requests return HTTP 401

### 10.2 Authorization

- Admin users have full access to all scopes
- Regular users require `allowGlobalUsageView` permission
- Non-admin users are restricted to user scope only
- Permission check happens at API level and page level

### 10.3 Data Privacy

- User names are visible in rankings (when permission granted)
- API keys are never exposed in leaderboard data
- Cost data respects currency display settings
- Deleted users are excluded from all rankings

### 10.4 Input Validation

- Date format validated with regex
- Period and scope validated against allowed values arrays
- User tags/groups are trimmed, filtered, and capped at 20 items
- SQL injection prevented via parameterized queries (Drizzle ORM)

### 10.5 Rate Limiting

- Cache-Control headers allow CDN/browser caching (60s s-maxage)
- Redis caching reduces database load
- Distributed locking prevents thundering herd

---

## 11. Testing

### 11.1 Unit Tests

**Location**: `tests/unit/api/leaderboard-route.test.ts`

**Test Coverage**:
- Authentication failure (401)
- User tags/groups parsing and trimming
- 20-item cap on filter lists
- Scope-specific filter behavior (userTags only apply to user scope)

### 11.2 Webhook Template Tests

**Location**: `tests/unit/webhook/templates/templates.test.ts`

**Test Coverage**:
- Daily leaderboard message structure
- Medal icons for top 3 entries
- Empty data handling
- Token formatting (K/M suffixes)

---

## 12. Related Features

- **Usage Logs**: Detailed request logs accessible from leaderboard entries
- **Statistics Charts**: Time-series visualization of usage data
- **Provider Availability**: Real-time provider health monitoring
- **Rate Limiting**: Usage quotas based on aggregated statistics
- **Cost Alerts**: Automated notifications when usage thresholds are exceeded
- **Session Management**: Track conversation sessions and their costs

---

*Report generated for documentation purposes. All code references are based on the current state of the claude-code-hub repository.*

**Verification Notes (Round 2)**:
- Verified all SQL queries against actual implementation in `src/repository/leaderboard.ts`
- Confirmed `last24h` period is internal-only (not exposed via API)
- Corrected cache hit rate formula to include all three token types in denominator
- Verified tokens per second calculation includes all edge case conditions
- Confirmed user group filter uses regex split on comma with whitespace handling
- Verified webhook notification system supports both legacy and target binding modes
