# Leaderboard Implementation Analysis Report

## 1. Intent Analysis

### 1.1 Purpose
The leaderboard feature in Claude Code Hub is designed to provide comprehensive usage statistics and rankings across multiple dimensions. It serves as a monitoring and analytics tool that enables administrators and authorized users to track consumption patterns, compare performance metrics, and gain insights into system usage.

### 1.2 Core Objectives
- **Usage Visibility**: Provide transparent visibility into API consumption across users, providers, and models
- **Cost Tracking**: Enable cost-based ranking to identify high-consumption entities
- **Performance Monitoring**: Track success rates, latency metrics, and cache hit rates
- **Administrative Control**: Allow administrators to monitor system-wide usage while respecting privacy controls
- **Scheduled Reporting**: Support automated daily leaderboard notifications via webhooks

### 1.3 Target Users
- **Administrators**: Full access to all leaderboard scopes (user, provider, model, cache hit rate)
- **Regular Users with Global View Permission**: Access to user rankings when `allowGlobalUsageView` is enabled
- **Regular Users**: Limited access to their own data only

---

## 2. Behavior Summary

### 2.1 Leaderboard Scopes

The system supports four distinct leaderboard scopes, each providing different analytical perspectives:

#### 2.1.1 User Rankings (`user`)
- **Purpose**: Rank users by their API consumption
- **Metrics**: Total requests, total cost (USD), total tokens
- **Sorting**: By total cost (descending)
- **Filters**: User tags, user groups (admin only)

#### 2.1.2 Provider Rankings (`provider`)
- **Purpose**: Rank LLM providers by usage and performance
- **Metrics**: Total requests, total cost, total tokens, success rate, average TTFB (Time To First Byte), average tokens per second
- **Sorting**: By total cost (descending)
- **Filters**: Provider type (Claude, Codex, Gemini, etc.)

#### 2.1.3 Provider Cache Hit Rate Rankings (`providerCacheHitRate`)
- **Purpose**: Analyze cache efficiency across providers
- **Metrics**: Cache hit rate, cache read tokens, cache creation cost, total input tokens
- **Sorting**: By cache hit rate (descending), then by request count
- **Filters**: Provider type

#### 2.1.4 Model Rankings (`model`)
- **Purpose**: Rank AI models by usage frequency
- **Metrics**: Total requests, total cost, total tokens, success rate
- **Sorting**: By request count (descending)
- **Configuration**: Model source determined by `billingModelSource` setting (`original` or `redirected`)

### 2.2 Time Period Filters

The leaderboard supports multiple time period filters to accommodate different analysis needs:

| Period | Description | SQL Implementation |
|--------|-------------|-------------------|
| `daily` | Current calendar day | `(createdAt AT TIME ZONE timezone)::date = (CURRENT_TIMESTAMP AT TIME ZONE timezone)::date` |
| `weekly` | Current week (ISO week) | `date_trunc('week', createdAt AT TIME ZONE timezone) = date_trunc('week', CURRENT_TIMESTAMP AT TIME ZONE timezone)` |
| `monthly` | Current calendar month | `date_trunc('month', createdAt AT TIME ZONE timezone) = date_trunc('month', CURRENT_TIMESTAMP AT TIME ZONE timezone)` |
| `allTime` | All historical data | `1=1` (no date filter) |
| `custom` | User-defined date range | `BETWEEN startDate AND endDate` |
| `last24h` | Rolling 24-hour window | `createdAt >= (CURRENT_TIMESTAMP - INTERVAL '24 hours')` |

### 2.3 Frontend Components

#### 2.3.1 Leaderboard View (`leaderboard-view.tsx`)
- Main container component for the leaderboard page
- Manages scope selection, period filtering, and data fetching
- Supports URL query parameters for deep linking (`?period=daily&scope=user`)
- Implements loading states with skeleton UI
- Handles error states with user-friendly messages

#### 2.3.2 Leaderboard Table (`leaderboard-table.tsx`)
- Reusable table component with dynamic column definitions
- Supports client-side sorting on multiple columns
- Displays ranking indicators (medals for top 3 positions)
- Responsive design with proper formatting for costs and token counts

#### 2.3.3 Date Range Picker (`date-range-picker.tsx`)
- Quick period selection buttons (Daily, Weekly, Monthly, All Time)
- Custom date range picker with calendar interface
- Navigation arrows for moving between periods
- Handles timezone-aware date formatting

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
  userTags?: string,   // Comma-separated list of tags
  userGroups?: string  // Comma-separated list of groups
}
```

**Response Headers**:
```
Cache-Control: public, s-maxage=60, stale-while-revalidate=120
```

---

## 3. Ranking Algorithms

### 3.1 User Ranking Algorithm

```sql
SELECT 
  userId,
  userName,
  count(*)::double precision as totalRequests,
  COALESCE(sum(costUsd), 0) as totalCost,
  COALESCE(
    sum(
      inputTokens + outputTokens + 
      COALESCE(cacheCreationInputTokens, 0) + 
      COALESCE(cacheReadInputTokens, 0)
    )::double precision,
    0::double precision
  ) as totalTokens
FROM message_request
INNER JOIN users ON messageRequest.userId = users.id AND users.deletedAt IS NULL
WHERE deletedAt IS NULL
  AND (blockedBy IS NULL OR blockedBy <> 'warmup')
  AND <date_condition>
GROUP BY userId, userName
ORDER BY sum(costUsd) DESC
```

**Key Points**:
- Excludes deleted users and deleted requests
- Excludes warmup requests (`blockedBy <> 'warmup'`)
- Token calculation includes input, output, cache creation, and cache read tokens
- Sorted by total cost in descending order

### 3.2 Provider Ranking Algorithm

```sql
SELECT 
  providerId,
  providerName,
  count(*)::double precision as totalRequests,
  COALESCE(sum(costUsd), 0) as totalCost,
  COALESCE(
    sum(inputTokens + outputTokens + ...)
  ) as totalTokens,
  COALESCE(
    count(CASE WHEN errorMessage IS NULL OR errorMessage = '' THEN 1 END)::double precision
    / NULLIF(count(*)::double precision, 0),
    0::double precision
  ) as successRate,
  avg(ttfbMs) as avgTtfbMs,
  avg(tokensPerSecond) as avgTokensPerSecond
FROM message_request
INNER JOIN providers ON messageRequest.providerId = providers.id AND providers.deletedAt IS NULL
WHERE <conditions>
GROUP BY providerId, providerName
ORDER BY sum(costUsd) DESC
```

**Key Points**:
- Success rate calculated as: `successful_requests / total_requests`
- TTFB (Time To First Byte) averaged across all requests
- Tokens per second averaged for performance metrics

### 3.3 Cache Hit Rate Ranking Algorithm

```sql
SELECT 
  providerId,
  providerName,
  count(*)::double precision as totalRequests,
  COALESCE(sum(costUsd), 0) as totalCost,
  sum(cacheReadInputTokens) as cacheReadTokens,
  sum(cacheCreationCost) as cacheCreationCost,
  sum(inputTokens + cacheCreationInputTokens) as totalInputTokens,
  CASE 
    WHEN sum(inputTokens + cacheCreationInputTokens) > 0 
    THEN sum(cacheReadInputTokens)::double precision 
         / sum(inputTokens + cacheCreationInputTokens)::double precision
    ELSE 0::double precision
  END as cacheHitRate
FROM message_request
-- ... joins and where clauses
GROUP BY providerId, providerName
ORDER BY cacheHitRate DESC, count(*) DESC
```

**Cache Hit Rate Formula**:
```
cacheHitRate = cacheReadTokens / (inputTokens + cacheCreationInputTokens)
```

### 3.4 Model Ranking Algorithm

```sql
-- Model field determined by billingModelSource setting
CASE 
  WHEN billingModelSource = 'original' 
  THEN COALESCE(originalModel, model)
  ELSE COALESCE(model, originalModel)
END as modelField

SELECT 
  modelField as model,
  count(*)::double precision as totalRequests,
  COALESCE(sum(costUsd), 0) as totalCost,
  COALESCE(sum(...)) as totalTokens,
  COALESCE(
    count(CASE WHEN errorMessage IS NULL OR errorMessage = '' THEN 1 END)::double precision
    / NULLIF(count(*)::double precision, 0),
    0::double precision
  ) as successRate
FROM message_request
WHERE deletedAt IS NULL
  AND (blockedBy IS NULL OR blockedBy <> 'warmup')
  AND <date_condition>
GROUP BY modelField
ORDER BY count(*) DESC
```

**Key Points**:
- Model source configurable via `billingModelSource` setting
- Filters out null and empty model names
- Sorted by request count (not cost) to show most frequently used models

---

## 4. Usage Aggregation

### 4.1 Data Source

All leaderboard data is aggregated from the `message_request` table, which stores individual API request records.

**Key Fields**:
- `userId`: User who made the request
- `providerId`: LLM provider used
- `model` / `originalModel`: Model name (potentially redirected)
- `costUsd`: Calculated cost in USD
- `inputTokens`: Input token count
- `outputTokens`: Output token count
- `cacheCreationInputTokens`: Cache creation tokens (5min/1hr TTL)
- `cacheReadInputTokens`: Cache read tokens
- `ttfbMs`: Time to first byte in milliseconds
- `errorMessage`: Error message if request failed
- `createdAt`: Request timestamp
- `blockedBy`: Interception reason (e.g., 'warmup')

### 4.2 Cost Calculation

Costs are calculated at request time using the `calculateRequestCost` function in `src/lib/utils/cost-calculation.ts`:

```typescript
// Cost components:
1. Input tokens × input_cost_per_token
2. Output tokens × output_cost_per_token
3. Cache creation tokens × cache_creation_cost
4. Cache read tokens × cache_read_cost
5. Image tokens × image_cost_per_token (if applicable)
6. Fixed per-request cost (if applicable)

// Special pricing tiers:
- Context 1M premium multiplier for Claude models
- Above 200K tokens tiered pricing for Gemini
```

### 4.3 Token Aggregation

Total tokens are calculated as:
```
totalTokens = inputTokens + outputTokens + cacheCreationInputTokens + cacheReadInputTokens
```

### 4.4 Exclusion Rules

The following records are excluded from all leaderboard calculations:
1. **Deleted records**: `deletedAt IS NULL`
2. **Warmup requests**: `blockedBy IS NULL OR blockedBy <> 'warmup'`
3. **Invalid models**: Model name is null or empty string (for model rankings)

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
- When `false`: Regular users only see their own data

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

**Supported Values**: USD, CNY, EUR, etc.

#### 5.1.4 timezone
```typescript
timezone: varchar('timezone', { length: 64 })  // IANA timezone identifier
```

**Purpose**: Defines the system timezone for date boundary calculations.

**Default**: Uses environment variable `TZ` or falls back to UTC

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
- **Webhook URL**: Target URL for webhook notifications (supports WeChat Work, Feishu, DingTalk, Telegram)
- **Send Time**: Cron schedule time in HH:mm format (default: 09:00)
- **Top N**: Number of top users to include in the notification (default: 5)

**Webhook Format**:
```json
{
  "date": "2025-01-29",
  "entries": [
    {
      "userId": 1,
      "userName": "User Name",
      "totalRequests": 100,
      "totalCost": 12.3456,
      "totalTokens": 50000
    }
  ],
  "totalRequests": 500,
  "totalCost": 45.6789
}
```

### 5.3 Redis Cache Configuration

The leaderboard implements Redis-based optimistic caching:

```typescript
// Cache TTL: 60 seconds
// Lock TTL: 10 seconds
// Retry: 50 attempts × 100ms = 5 seconds max wait

Cache Key Format:
- Daily: `leaderboard:{scope}:daily:2025-01-29:{currency}`
- Weekly: `leaderboard:{scope}:weekly:2025-W04:{currency}`
- Monthly: `leaderboard:{scope}:monthly:2025-01:{currency}`
- Custom: `leaderboard:{scope}:custom:2025-01-01_2025-01-29:{currency}`
```

---

## 6. Edge Cases

### 6.1 Permission Denied

**Scenario**: Non-admin user attempts to access leaderboard without `allowGlobalUsageView` enabled.

**Behavior**:
- API returns HTTP 403 with message: "无权限访问排行榜，请联系管理员开启全站使用量查看权限"
- UI displays permission alert with link to contact administrator

### 6.2 Empty Data

**Scenario**: No usage data exists for the selected period.

**Behavior**:
- API returns empty array `[]`
- UI displays "No data available" message
- Daily leaderboard notification is skipped if no data

### 6.3 Redis Unavailable

**Scenario**: Redis connection fails during leaderboard request.

**Behavior**:
- System logs warning: "[LeaderboardCache] Redis not available, fallback to direct query"
- Falls back to direct database query
- Request succeeds but without caching benefits

### 6.4 Concurrent Cache Miss

**Scenario**: Multiple requests hit cache miss simultaneously.

**Behavior**:
- First request acquires distributed lock and queries database
- Other requests wait and retry (max 5 seconds)
- If lock holder completes, waiting requests read from cache
- If timeout occurs, waiting requests fall back to direct query

### 6.5 Invalid Date Range

**Scenario**: User provides invalid date parameters for custom period.

**Behavior**:
- API validates date format using regex: `/^\d{4}-\d{2}-\d{2}$/`
- Returns HTTP 400 with specific error message
- Validates that `startDate` is not after `endDate`

### 6.6 Invalid Period/Scope

**Scenario**: User provides invalid period or scope parameter.

**Behavior**:
- API validates against allowed values arrays
- Returns HTTP 400 with list of valid options
- Defaults to `daily` period and `user` scope if not provided

### 6.7 Timezone Handling

**Scenario**: System spans multiple timezones.

**Behavior**:
- All date calculations use system-configured timezone
- SQL queries use `AT TIME ZONE` operator
- Frontend displays dates in user's local timezone
- Cache keys include timezone to prevent cross-timezone contamination

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

# Custom date range with filters
curl -H "Cookie: session=..." \
  "http://localhost:3000/api/leaderboard?period=custom&scope=user&startDate=2025-01-01&endDate=2025-01-31&userTags=premium,vip"

# Provider cache hit rate for specific provider type
curl -H "Cookie: session=..." \
  "http://localhost:3000/api/leaderboard?period=daily&scope=providerCacheHitRate&providerType=claude"
```

### 7.2 Server Actions

```typescript
// Get daily leaderboard data
import { findDailyLeaderboard } from "@/repository/leaderboard";
const users = await findDailyLeaderboard();

// Get provider rankings
import { findDailyProviderLeaderboard } from "@/repository/leaderboard";
const providers = await findDailyProviderLeaderboard(providerType);

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
```

### 7.3 Scheduled Tasks

```typescript
// Generate and send daily leaderboard
import { sendDailyLeaderboard } from "@/lib/notification/notifier";
await sendDailyLeaderboard();

// Generate leaderboard data only
import { generateDailyLeaderboard } from "@/lib/notification/tasks/daily-leaderboard";
const data = await generateDailyLeaderboard(10);  // Top 10 users
```

---

## 8. References

### 8.1 File References

| File | Purpose |
|------|---------|
| `src/app/api/leaderboard/route.ts` | API endpoint for leaderboard data |
| `src/repository/leaderboard.ts` | Database queries for all leaderboard types |
| `src/lib/redis/leaderboard-cache.ts` | Redis caching layer |
| `src/app/[locale]/dashboard/leaderboard/page.tsx` | Leaderboard page component |
| `src/app/[locale]/dashboard/leaderboard/_components/leaderboard-view.tsx` | Main leaderboard UI |
| `src/app/[locale]/dashboard/leaderboard/_components/leaderboard-table.tsx` | Table component with sorting |
| `src/app/[locale]/dashboard/leaderboard/_components/date-range-picker.tsx` | Date range selection UI |
| `src/app/[locale]/dashboard/_components/today-leaderboard.tsx` | Dashboard mini leaderboard |
| `src/lib/notification/tasks/daily-leaderboard.ts` | Daily leaderboard generation |
| `src/lib/webhook/templates/daily-leaderboard.ts` | Webhook message formatting |
| `src/drizzle/schema.ts` | Database schema including system settings |
| `src/repository/system-config.ts` | System settings repository |

### 8.2 Database Schema References

| Table | Relevant Columns |
|-------|-----------------|
| `message_request` | userId, providerId, model, originalModel, costUsd, inputTokens, outputTokens, cacheCreationInputTokens, cacheReadInputTokens, ttfbMs, errorMessage, createdAt, deletedAt, blockedBy |
| `users` | id, name, tags, groups, deletedAt |
| `providers` | id, name, providerType, deletedAt |
| `system_settings` | allowGlobalUsageView, currencyDisplay, billingModelSource, timezone |
| `notification_settings` | dailyLeaderboardEnabled, dailyLeaderboardWebhook, dailyLeaderboardTime, dailyLeaderboardTopN |

### 8.3 Type Definitions

```typescript
// Leaderboard Period
type LeaderboardPeriod = "daily" | "weekly" | "monthly" | "allTime" | "custom" | "last24h";

// Leaderboard Scope
type LeaderboardScope = "user" | "provider" | "providerCacheHitRate" | "model";

// Leaderboard Entry (User)
interface LeaderboardEntry {
  userId: number;
  userName: string;
  totalRequests: number;
  totalCost: number;
  totalTokens: number;
  totalCostFormatted?: string;
}

// Provider Leaderboard Entry
interface ProviderLeaderboardEntry {
  providerId: number;
  providerName: string;
  totalRequests: number;
  totalCost: number;
  totalTokens: number;
  successRate: number;
  avgTtfbMs: number;
  avgTokensPerSecond: number;
  totalCostFormatted?: string;
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
  cacheHitRate: number;
  cacheCreationCostFormatted?: string;
}

// Model Leaderboard Entry
interface ModelLeaderboardEntry {
  model: string;
  totalRequests: number;
  totalCost: number;
  totalTokens: number;
  successRate: number;
  totalCostFormatted?: string;
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

### 8.4 Related Features

- **Usage Logs**: Detailed request logs accessible from leaderboard entries
- **Statistics Charts**: Time-series visualization of usage data
- **Provider Availability**: Real-time provider health monitoring
- **Rate Limiting**: Usage quotas based on aggregated statistics
- **Cost Alerts**: Automated notifications when usage thresholds are exceeded

---

## 9. Performance Considerations

### 9.1 Database Optimization

- **Indexes**: Composite indexes on `(userId, createdAt, costUsd)` and `(providerId, createdAt)`
- **Partitioning**: Consider time-based partitioning for large `message_request` tables
- **Query Optimization**: Uses `EXCLUDE_WARMUP_CONDITION` to leverage partial indexes

### 9.2 Caching Strategy

- **Redis Cache**: 60-second TTL for leaderboard data
- **Distributed Lock**: Prevents cache stampede during high traffic
- **Graceful Degradation**: Falls back to database queries if Redis unavailable

### 9.3 Frontend Optimization

- **Skeleton Loading**: Shows placeholder UI while data loads
- **Client-Side Sorting**: Sorting happens on already-fetched data
- **Memoization**: Uses `useMemo` for expensive calculations

---

## 10. Security Considerations

### 10.1 Authentication

- All leaderboard endpoints require valid session
- Unauthenticated requests return HTTP 401

### 10.2 Authorization

- Admin users have full access to all scopes
- Regular users require `allowGlobalUsageView` permission
- Non-admin users are restricted to user scope only

### 10.3 Data Privacy

- User names are visible in rankings (when permission granted)
- API keys are never exposed in leaderboard data
- Cost data respects currency display settings

### 10.4 Input Validation

- Date format validated with regex
- Period and scope validated against allowed values
- SQL injection prevented via parameterized queries (Drizzle ORM)

---

*Report generated for documentation purposes. All code references are based on the current state of the claude-code-hub repository.*
