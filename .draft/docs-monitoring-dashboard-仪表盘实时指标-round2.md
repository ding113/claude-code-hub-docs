# Dashboard Real-time Metrics Implementation Report

## 1. Intent Analysis

The claude-code-hub dashboard provides a comprehensive real-time monitoring interface for administrators and users to track API usage, costs, provider health, and system performance. The dashboard serves multiple key purposes:

### 1.1 Core Objectives
- **Real-time Monitoring**: Track concurrent sessions, request rates, costs, and error rates with configurable refresh intervals (5 seconds for dashboard, 2 seconds for big screen)
- **Usage Analytics**: Display detailed statistics on user consumption, provider performance, and model distribution
- **Operational Visibility**: Monitor provider capacity, rate limiting events, and system health
- **Cost Management**: Track spending across multiple dimensions (users, providers, models, time periods)
- **Performance Optimization**: Identify bottlenecks through response time metrics and throughput analysis

### 1.2 User Roles and Permissions
The dashboard implements a role-based access control system:
- **Administrators**: Full access to all metrics, global statistics, concurrent sessions, and provider management
- **Standard Users**: Limited to personal usage data unless `allowGlobalUsageView` is enabled in system settings
- **Global View Permission**: Non-admin users can view aggregate data when `allowGlobalUsageView` is `true`

### 1.3 Key Design Decisions
1. **Hybrid Data Strategy**: Combines Redis for real-time session tracking with PostgreSQL for persistent analytics
2. **Optimistic Caching**: Redis-based caching with 60-second TTL for leaderboard data to reduce database load, using distributed locks to prevent cache stampede
3. **Partial Failure Tolerance**: Uses `Promise.allSettled()` to ensure dashboard functionality even if some data sources fail
4. **Timezone Awareness**: All time-based aggregations respect the configured system timezone via `resolveSystemTimezone()` with fallback chain: DB settings -> env TZ -> UTC
5. **Currency Flexibility**: Support for multiple currencies (USD, CNY, EUR, JPY, GBP, HKD, TWD, KRW, SGD) via `formatCurrency()`
6. **Warmup Exclusion**: All statistics exclude warmup requests (`blockedBy = 'warmup'`) via `EXCLUDE_WARMUP_CONDITION`

---

## 2. Behavior Summary

### 2.1 Dashboard Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           Dashboard Frontend                                 │
├─────────────────────────────────────────────────────────────────────────────┤
│  DashboardBento  │  StatisticsChart  │  Leaderboards  │  Live Sessions     │
│  (Metric Cards)  │  (Area Charts)    │  (Rankings)    │  (Activity Stream) │
└─────────────────────────────────────────────────────────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         Server Actions Layer                                 │
├─────────────────────────────────────────────────────────────────────────────┤
│  getOverviewData()  │  getUserStatistics()  │  getDashboardRealtimeData()  │
│  getActiveSessions() │  getProviderSlots()   │  getRateLimitStats()         │
└─────────────────────────────────────────────────────────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         Data Repository Layer                                │
├─────────────────────────────────────────────────────────────────────────────┤
│  overview.ts      │  statistics.ts      │  leaderboard.ts  │  activity-stream.ts│
│  (Core metrics)   │  (Time-series)      │  (Rankings)      │  (Real-time feed)  │
└─────────────────────────────────────────────────────────────────────────────┘
                                       │
                     ┌─────────────────┴─────────────────┐
                     ▼                                   ▼
         ┌───────────────────────┐           ┌───────────────────────┐
         │       PostgreSQL      │           │        Redis          │
         │  (Persistent storage) │           │  (Session tracking &  │
         │                       │           │   leaderboard cache)  │
         └───────────────────────┘           └───────────────────────┘
```

### 2.2 Main Dashboard Components

#### 2.2.1 Dashboard Bento Layout (`dashboard-bento.tsx`)
The primary dashboard interface uses a responsive bento grid layout with:

**Section 1: Core Metrics (Admin Only)**
- Concurrent Sessions: Real-time count of active sessions from Redis (via `SessionTracker.getGlobalSessionCount()`)
- RPM (Requests Per Minute): Rolling 1-minute request count from database
- Today's Cost: Accumulated spending for current day (USD base, displayed in configured currency)
- Average Response Time: Mean latency across all requests (in milliseconds)

Each metric includes comparison indicators showing percentage change vs yesterday's same period.

**Section 2: Statistics Chart (Full Width)**
- Interactive area chart showing cost and call volume over time
- Time range selector: Today (hour resolution), 7 Days, 30 Days, This Month (day resolution)
- Dual mode: Overlay (stacked areas) vs Stacked (cumulative)
- User filtering: Toggle individual users on/off (admin mode)
- Three display modes based on permissions:
  - **Admin**: Shows all users' data
  - **Mixed** (`allowGlobalUsageView=true`): Own keys detail + others aggregated
  - **Keys only** (default user): Only own API keys data

**Section 3: Leaderboards + Live Sessions**
- User Rankings: Top consumers by cost (via `/api/leaderboard?period=daily&scope=user`)
- Provider Rankings: Top providers by request volume (via `/api/leaderboard?period=daily&scope=provider`)
- Model Rankings: Most used models (via `/api/leaderboard?period=daily&scope=model`)
- Live Sessions Panel: Real-time active session list (admin only)

#### 2.2.2 Real-time Data Flow

```typescript
// Refresh intervals configured across components
const REFRESH_INTERVAL = 5000; // 5 seconds for dashboard bento
const BIG_SCREEN_REFRESH_INTERVAL = 2000; // 2 seconds for big screen display
```

Data fetching uses React Query with `refetchInterval` for automatic polling:
```typescript
const { data: overview } = useQuery<OverviewData>({
  queryKey: ["overview-data"],
  queryFn: fetchOverviewData,
  refetchInterval: REFRESH_INTERVAL,
});
```

#### 2.2.3 Big Screen Dashboard (`internal/dashboard/big-screen/page.tsx`)
A dedicated full-screen display optimized for monitoring stations:
- **2-second refresh rate** using SWR
- **Three-column layout**: User Rankings + Provider Rankings | Provider Quotas + Traffic Trend + Model Distribution | Activity Stream
- **Animated transitions** using Framer Motion
- **Dark/Light theme** toggle with system detection
- **Particle background** effects for visual engagement
- **Auto-hiding UI** for distraction-free viewing
- **Five key metrics**: Concurrent Sessions, Today Requests, Today Cost, Avg Latency, Error Rate

### 2.3 Data Refresh Patterns

| Component | Refresh Interval | Data Source | Strategy |
|-----------|-----------------|-------------|----------|
| Overview Metrics | 5 seconds | PostgreSQL + Redis | Parallel queries via `Promise.all()` |
| Statistics Chart | On time range change | PostgreSQL | Time-range based SQL with `generate_series` |
| Leaderboards | 60 seconds (Redis cache) | PostgreSQL | Optimistic cache with distributed lock |
| Activity Stream | Real-time (hybrid) | Redis + PostgreSQL | Active sessions first, then recent requests |
| Provider Slots | 5 seconds (via big screen) | Redis | Real-time counts per provider |
| Live Sessions | 5 seconds | Redis + PostgreSQL | Cached with 5-second TTL |

---

## 3. Configuration and Commands

### 3.1 Dashboard Configuration

#### 3.1.1 System Settings (`system-config`)
Key settings affecting dashboard behavior:

```typescript
interface SystemSettings {
  // Currency display preference
  currencyDisplay: CurrencyCode; // "USD" | "CNY" | "EUR" | "JPY" | "GBP" | "HKD" | "TWD" | "KRW" | "SGD"
  
  // Global visibility toggle
  allowGlobalUsageView: boolean; // Allow non-admins to see aggregate data
  
  // Timezone configuration
  timezone: string; // e.g., "Asia/Shanghai", "UTC" - IANA timezone identifier
  
  // Billing model source for model statistics
  billingModelSource: "original" | "redirected"; // Which model field to use for model leaderboard
}
```

#### 3.1.2 Environment Variables
```bash
# Redis configuration for session tracking
REDIS_URL=redis://localhost:6379

# Database connection
DATABASE_URL=postgresql://user:pass@localhost:5432/claude_code_hub

# Timezone fallback (used if DB setting is invalid)
TZ=Asia/Shanghai
```

### 3.2 API Endpoints

#### 3.2.1 Dashboard Data Endpoints

| Endpoint | Method | Description | Access |
|----------|--------|-------------|--------|
| `/api/actions/overview/getOverviewData` | POST | Core metrics (concurrent, costs, errors) | Authenticated |
| `/api/actions/statistics/getUserStatistics` | POST | Time-series statistics | Authenticated |
| `/api/actions/dashboard-realtime/getDashboardRealtimeData` | POST | Complete dashboard snapshot | Admin/GlobalView |
| `/api/actions/active-sessions/getActiveSessions` | POST | Live session list | Admin only |
| `/api/actions/provider-slots/getProviderSlots` | POST | Provider capacity status | Admin/GlobalView |
| `/api/leaderboard` | GET | Rankings data with caching | Admin/GlobalView |

#### 3.2.2 Leaderboard API Parameters
```typescript
// GET /api/leaderboard?period=daily&scope=user
interface LeaderboardQueryParams {
  period: "daily" | "weekly" | "monthly" | "allTime" | "custom";
  scope: "user" | "provider" | "providerCacheHitRate" | "model";
  startDate?: string; // YYYY-MM-DD (required for custom)
  endDate?: string;   // YYYY-MM-DD (required for custom)
  providerType?: string; // Filter for provider scopes: "claude" | "claude-auth" | "codex" | "gemini" | "gemini-cli" | "openai-compatible"
  userTags?: string;     // Comma-separated tags (max 20)
  userGroups?: string;   // Comma-separated groups (max 20)
}
```

### 3.3 Server Actions

#### 3.3.1 Overview Data Action
```typescript
// src/actions/overview.ts
export async function getOverviewData(): Promise<ActionResult<OverviewData>> {
  // 1. Check authentication via getSession()
  // 2. Determine visibility scope (admin vs user via allowGlobalUsageView)
  // 3. Parallel query: concurrent sessions (admin only) + metrics
  // 4. Return aggregated data with yesterday comparisons
}
```

**Response Structure:**
```typescript
interface OverviewData {
  concurrentSessions: number;        // Active sessions from Redis
  todayRequests: number;             // Total requests today
  todayCost: number;                 // Accumulated cost (USD)
  avgResponseTime: number;           // Mean latency (ms)
  todayErrorRate: number;            // Error percentage (statusCode >= 400)
  yesterdaySamePeriodRequests: number;  // Comparison metric
  yesterdaySamePeriodCost: number;      // Comparison metric
  yesterdaySamePeriodAvgResponseTime: number; // Comparison metric
  recentMinuteRequests: number;      // RPM metric
}
```

#### 3.3.2 Dashboard Real-time Action
```typescript
// src/actions/dashboard-realtime.ts
export async function getDashboardRealtimeData(): Promise<ActionResult<DashboardRealtimeData>> {
  // Parallel queries using Promise.allSettled():
  // - getOverviewData()
  // - findRecentActivityStream(20) - hybrid Redis + DB
  // - findDailyLeaderboard()
  // - findDailyProviderLeaderboard()
  // - getProviderSlots()
  // - findDailyModelLeaderboard()
  // - getUserStatistics("today")
}
```

**DashboardRealtimeData Structure:**
```typescript
interface DashboardRealtimeData {
  metrics: OverviewData;
  activityStream: ActivityStreamEntry[];      // Last 20 activities
  userRankings: LeaderboardEntry[];           // Top 5 users by cost
  providerRankings: ProviderLeaderboardEntry[]; // Top 5 providers
  providerSlots: ProviderSlotInfo[];          // Slot usage (top 3 by utilization)
  modelDistribution: ModelLeaderboardEntry[]; // Top 10 models
  trendData: Array<{ hour: number; value: number }>; // 24h trend
}
```

### 3.4 Time Range Configuration

```typescript
// src/types/statistics.ts
export const TIME_RANGE_OPTIONS: TimeRangeConfig[] = [
  { key: "today", label: "today", resolution: "hour", description: "todayDescription" },
  { key: "7days", label: "7days", resolution: "day", description: "7daysDescription" },
  { key: "30days", label: "30days", resolution: "day", description: "30daysDescription" },
  { key: "thisMonth", label: "thisMonth", resolution: "day", description: "thisMonthDescription" },
];
```

---

## 4. Edge Cases and Error Handling

### 4.1 Partial Data Failure

The dashboard uses `Promise.allSettled()` to handle partial failures gracefully:

```typescript
const [
  overviewResult,
  activityStreamResult,
  userRankingsResult,
  // ... other queries
] = await Promise.allSettled([
  getOverviewData(),
  findRecentActivityStream(ACTIVITY_STREAM_LIMIT),
  findDailyLeaderboard(),
  // ...
]);

// Extract data with fallbacks
const overviewData =
  overviewResult.status === "fulfilled" && overviewResult.value.ok
    ? overviewResult.value.data
    : null;
```

**Behavior:**
- Individual data source failures don't crash the dashboard
- Failed components show loading states or cached data
- Errors are logged via logger for debugging
- Overview data failure causes entire dashboard to fail (critical path)

### 4.2 Redis Connection Failures

Session tracking implements "Fail Open" strategy:

```typescript
// Session tracker returns 0 on Redis failure
static async getProviderSessionCount(providerId: number): Promise<number> {
  const redis = getRedisClient();
  if (!redis || redis.status !== "ready") return 0;  // Fail open
  
  try {
    // ... query logic
  } catch (error) {
    logger.error("SessionTracker: Failed to get provider session count", { error });
    return 0;  // Fail open
  }
}
```

Leaderboard cache gracefully degrades to direct database query:
```typescript
export async function getLeaderboardWithCache(...) {
  const redis = getRedisClient();
  // Redis unavailable, direct query
  if (!redis) {
    return await queryDatabase(period, scope, dateRange, filters);
  }
  // ...
}
```

### 4.3 Database Query Timeouts

Large time-range queries implement safeguards:
- **Numeric overflow protection**: Detects and reports "numeric field overflow" errors
- **Time range limits**: Custom date range limited by application logic
- **Aggregation optimization**: Uses `generate_series` for time-series gaps filling

### 4.4 Timezone Edge Cases

All time-based queries use explicit timezone conversion:

```typescript
// Ensures "today" is correct regardless of server timezone
sql`(${messageRequest.createdAt} AT TIME ZONE ${timezone})::date = 
    (CURRENT_TIMESTAMP AT TIME ZONE ${timezone})::date`
```

**Handled Scenarios:**
- Daylight saving time transitions
- Cross-timezone user access
- Database server in different timezone than application
- Invalid timezone fallback chain: DB -> env TZ -> UTC

### 4.5 Currency Conversion Edge Cases

```typescript
// Decimal precision handling
export const COST_SCALE = 15;

// Prevents floating-point errors
export function toCostDecimal(value: DecimalInput): Decimal | null {
  const decimal = toDecimal(value);
  return decimal ? decimal.toDecimalPlaces(COST_SCALE) : null;
}
```

### 4.6 Session Tracker Type Conflicts

Session tracker handles legacy data format migration:

```typescript
static async initialize(): Promise<void> {
  const key = "global:active_sessions";
  const exists = await redis.exists(key);
  if (exists === 1) {
    const type = await redis.type(key);
    if (type !== "zset") {
      // Delete legacy Set format, will be recreated as ZSET
      await redis.del(key);
    }
  }
}
```

**Automatic Recovery:**
- Pipeline errors with "WRONGTYPE" trigger automatic re-initialization
- Old Set format is automatically deleted and recreated as ZSET

---

## 5. Data Aggregation Logic

### 5.1 Overview Metrics Aggregation

```typescript
// src/repository/overview.ts
export async function getOverviewMetricsWithComparison(userId?: number): Promise<OverviewMetricsWithComparison> {
  const timezone = await resolveSystemTimezone();

  // Parallel query: today, yesterday same period, and RPM
  const [todayResult, yesterdayResult, rpmResult] = await Promise.all([
    // Today: 00:00 to now
    db.select({...})
      .where(and(
        isNull(messageRequest.deletedAt),
        EXCLUDE_WARMUP_CONDITION,
        userCondition,
        sql`(${messageRequest.createdAt} AT TIME ZONE ${timezone})::date = (CURRENT_TIMESTAMP AT TIME ZONE ${timezone})::date`
      )),
    
    // Yesterday same period: yesterday 00:00 to yesterday current time
    db.select({...})
      .where(and(
        isNull(messageRequest.deletedAt),
        EXCLUDE_WARMUP_CONDITION,
        userCondition,
        sql`(${messageRequest.createdAt} AT TIME ZONE ${timezone})::date = ((CURRENT_TIMESTAMP AT TIME ZONE ${timezone}) - INTERVAL '1 day')::date`,
        sql`(${messageRequest.createdAt} AT TIME ZONE ${timezone})::time <= (CURRENT_TIMESTAMP AT TIME ZONE ${timezone})::time`
      )),
    
    // RPM: last 1 minute
    db.select({ requestCount: count() })
      .where(and(
        isNull(messageRequest.deletedAt),
        EXCLUDE_WARMUP_CONDITION,
        userCondition,
        gte(messageRequest.createdAt, sql`CURRENT_TIMESTAMP - INTERVAL '1 minute'`)
      ))
  ]);

  // Calculate error rate as percentage
  const todayErrorRate = requestCount > 0 
    ? parseFloat(((errorCount / requestCount) * 100).toFixed(2)) 
    : 0;
}
```

### 5.2 Activity Stream Hybrid Strategy

The activity stream combines Redis (active sessions) with PostgreSQL (recent requests):

```typescript
// Step 1: Get active session IDs from Redis
const activeSessionIds = await SessionTracker.getActiveSessions();

// Step 2: Query latest request for each active session using ROW_NUMBER()
const activeSessionRequests = await db
  .select({
    // ... fields
    rowNum: sql<number>`ROW_NUMBER() OVER (PARTITION BY ${messageRequest.sessionId} ORDER BY ${messageRequest.createdAt} DESC)`,
  })
  .where(inArray(messageRequest.sessionId, activeSessionIds));

// Filter to get only the latest per session
const latestPerSession = activeSessionRequests.filter((row) => row.rowNum === 1);

// Step 3: If insufficient data, supplement with recent DB requests
if (activityItems.length < limit) {
  const recentRequests = await db.query(/* exclude already included sessions */);
  activityItems = [...activityItems, ...recentRequests];
}

// Step 4: Deduplicate by ID and sort by time
const uniqueItems = new Map<number, ActivityStreamItem>();
const sortedItems = Array.from(uniqueItems.values())
  .sort((a, b) => b.startTime - a.startTime)
  .slice(0, limit);
```

### 5.3 Statistics Time-Series Aggregation

```typescript
// Uses generate_series to fill gaps in time-series data
const query = sql`
  WITH time_series AS (
    SELECT generate_series(
      DATE_TRUNC('day', TIMEZONE(${timezone}, NOW())),
      DATE_TRUNC('day', TIMEZONE(${timezone}, NOW())) + INTERVAL '23 hours',
      '1 hour'::interval
    ) AS hour
  ),
  stats AS (
    SELECT 
      DATE_TRUNC('hour', ${messageRequest.createdAt} AT TIME ZONE ${timezone}) AS hour,
      count(*) AS api_calls,
      COALESCE(sum(${messageRequest.costUsd}), 0) AS total_cost
    FROM ${messageRequest}
    WHERE ${messageRequest.createdAt} AT TIME ZONE ${timezone} >= DATE_TRUNC('day', TIMEZONE(${timezone}, NOW()))
    GROUP BY DATE_TRUNC('hour', ${messageRequest.createdAt} AT TIME ZONE ${timezone})
  )
  SELECT 
    time_series.hour,
    COALESCE(stats.api_calls, 0) AS api_calls,
    COALESCE(stats.total_cost, 0) AS total_cost
  FROM time_series
  LEFT JOIN stats ON time_series.hour = stats.hour
  ORDER BY time_series.hour
`;
```

### 5.4 Leaderboard Aggregation

**User Rankings (by cost):**
```typescript
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
  .innerJoin(users, and(sql`${messageRequest.userId} = ${users.id}`, isNull(users.deletedAt)))
  .where(and(...whereConditions))
  .groupBy(messageRequest.userId, users.name)
  .orderBy(desc(sql`sum(${messageRequest.costUsd})`));
```

**Model Rankings with Billing Source:**
```typescript
// Uses billingModelSource setting to determine which model field to use
const modelField = billingModelSource === "original"
  ? sql<string>`COALESCE(${messageRequest.originalModel}, ${messageRequest.model})`
  : sql<string>`COALESCE(${messageRequest.model}, ${messageRequest.originalModel})`;
```

### 5.5 Provider Slot Tracking

```typescript
// Get concurrent usage for each provider
const slotInfoList = await Promise.all(
  providerList.map(async (provider) => {
    const usedSlots = await SessionTracker.getProviderSessionCount(provider.id);
    
    return {
      providerId: provider.id,
      name: provider.name,
      usedSlots,
      totalSlots: provider.limitConcurrentSessions ?? 0,
      totalVolume: 0, // Populated from leaderboard data
    };
  })
);

// Filter and sort by utilization rate
const providerSlotsWithVolume = providerSlots
  .filter((slot) => slot.totalSlots > 0) // Only show providers with limits
  .sort((a, b) => {
    const usageA = a.totalSlots > 0 ? a.usedSlots / a.totalSlots : 0;
    const usageB = b.totalSlots > 0 ? b.usedSlots / b.totalSlots : 0;
    return usageB - usageA; // Descending by utilization
  })
  .slice(0, 3); // Top 3 only
```

---

## 6. Chart and Visualization Components

### 6.1 Chart Library: Recharts

The dashboard uses **Recharts** for all visualizations with custom theming support via `ChartContainer` component.

### 6.2 Area Chart Implementation

**User Statistics Chart** (`statistics/chart.tsx` and `bento/statistics-chart-card.tsx`):
```typescript
<AreaChart data={numericChartData} margin={{ left: 12, right: 12 }}>
  <defs>
    {data.users.map((user, index) => (
      <linearGradient
        key={user.dataKey}
        id={`fill-${user.dataKey}`}
        x1="0" y1="0" x2="0" y2="1"
      >
        <stop offset="5%" stopColor={color} stopOpacity={0.8} />
        <stop offset="95%" stopColor={color} stopOpacity={0.1} />
      </linearGradient>
    ))}
  </defs>
  
  <CartesianGrid strokeDasharray="3 3" vertical={false} />
  <XAxis dataKey="date" tickFormatter={formatDate} />
  <YAxis yAxisId="left" orientation="left" />
  <YAxis yAxisId="right" orientation="right" />
  
  {visibleUsers.map((user) => (
    <Area
      key={user.dataKey}
      dataKey={`${user.dataKey}_${activeChart}`}
      name={user.name}
      type="monotone"
      fill={`url(#fill-${user.dataKey})`}
      stroke={color}
      stackId={chartMode === "stacked" ? "a" : undefined}
    />
  ))}
</AreaChart>
```

**Features:**
- Dual Y-axes for cost and calls
- Gradient fills for visual depth
- Stacked vs Overlay mode toggle
- Interactive legend for user filtering
- Smart sorting in overlay mode (largest values at bottom)

### 6.3 Pie Chart for Model Distribution

**Big Screen Model Distribution:**
```typescript
<PieChart>
  <Pie
    data={chartData}
    dataKey="value"
    nameKey="name"
    innerRadius={30}
    outerRadius={50}
    paddingAngle={2}
    stroke="none"
  >
    {chartData.map((_, index) => (
      <Cell key={`cell-${index}`} fill={COLORS.models[index % COLORS.models.length]} />
    ))}
  </Pie>
</PieChart>
```

### 6.4 Custom Components

#### 6.4.1 Provider Quota Visualization (Big Screen)
```typescript
// Linear progress bar with color coding based on utilization
<div className="h-2.5 w-full bg-gray-700/30 rounded-sm overflow-hidden">
  <div
    className={`h-full transition-all duration-1000 ${
      isCritical
        ? "bg-gradient-to-r from-red-500 to-red-400"
        : isWarning
          ? "bg-gradient-to-r from-yellow-500 to-orange-500"
          : "bg-gradient-to-r from-blue-600 to-cyan-400"
    }`}
    style={{ width: `${percent}%` }}
  />
</div>

// Color thresholds:
// - Critical (>90%): Red gradient
// - Warning (70-90%): Yellow/Orange gradient
// - Normal (<70%): Blue/Cyan gradient
```

#### 6.4.2 Metric Cards
```typescript
interface BentoMetricCardProps {
  title: string;
  value: number | string;
  icon: LucideIcon;
  accentColor: "emerald" | "blue" | "purple" | "amber";
  comparisons?: Array<{
    value: number;
    label: string;
    isPercentage?: boolean;
  }>;
  formatter?: (value: number) => string;
}
```

### 6.5 Chart Container Pattern

All charts use a standardized container for consistent theming:

```typescript
<ChartContainer
  config={chartConfig}
  className="aspect-auto h-[320px] w-full"
>
  {/* Chart implementation */}
</ChartContainer>
```

**ChartConfig Structure:**
```typescript
type ChartConfig = {
  [key: string]: {
    label?: React.ReactNode;
    icon?: React.ComponentType;
    color?: string;
    theme?: Record<"light" | "dark", string>;
  };
};
```

---

## 7. Session Tracking Architecture

### 7.1 Redis Data Structures

```
# Global active sessions (Sorted Set)
Key: global:active_sessions
Type: ZSET
Score: timestamp (milliseconds)
Member: sessionId
TTL: 1 hour (refreshed on each update)

# Provider-level sessions
Key: provider:{providerId}:active_sessions
Type: ZSET
Score: timestamp

# Key-level sessions  
Key: key:{keyId}:active_sessions
Type: ZSET
Score: timestamp

# User-level sessions
Key: user:{userId}:active_sessions
Type: ZSET
Score: timestamp

# Session binding info (for validation)
Key: session:{sessionId}:provider
Type: String (providerId)
TTL: 5 minutes

Key: session:{sessionId}:key
Type: String (keyId)
TTL: 5 minutes

Key: session:{sessionId}:last_seen
Type: String (timestamp)
TTL: 5 minutes

# Session concurrent request count
Key: session:{sessionId}:concurrent_count
Type: String (counter)
TTL: 10 minutes
```

### 7.2 Session Lifecycle

```
1. Request Start (SessionGuard)
   └─> SessionTracker.trackSession(sessionId, keyId, userId)
       └─> ZADD global:active_sessions (timestamp)
       └─> ZADD key:{keyId}:active_sessions
       └─> ZADD user:{userId}:active_sessions (if applicable)

2. Provider Selection (ProviderResolver)
   └─> SessionTracker.updateProvider(sessionId, providerId)
       └─> ZADD global:active_sessions (refresh timestamp)
       └─> ZADD provider:{providerId}:active_sessions
       └─> SET session:{sessionId}:provider (binding)

3. Request Processing
   └─> SessionTracker.incrementConcurrentCount(sessionId)
       └─> INCR session:{sessionId}:concurrent_count

4. Request End (finally block)
   └─> SessionTracker.decrementConcurrentCount(sessionId)
       └─> DECR session:{sessionId}:concurrent_count
       └─> DEL if count <= 0

5. Session Refresh (Response complete)
   └─> SessionTracker.refreshSession(sessionId, keyId, providerId, userId)
       └─> ZADD all sets (refresh timestamps)
       └─> EXPIRE binding keys (refresh TTL)

6. Session Expire (5 minutes of inactivity)
   └─> Redis TTL expires binding keys
   └─> ZREM on next cleanup (lazy deletion)
```

### 7.3 Cleanup Mechanism

Automatic cleanup of stale sessions (5-minute TTL):

```typescript
private static async countFromZSet(key: string): Promise<number> {
  const now = Date.now();
  const fiveMinutesAgo = now - SessionTracker.SESSION_TTL; // 300000ms

  // Phase 1: Remove expired sessions by score
  await redis.zremrangebyscore(key, "-inf", fiveMinutesAgo);

  // Phase 2: Get remaining session IDs
  const sessionIds = await redis.zrange(key, 0, -1);
  
  // Phase 3: Verify session info exists (double-check)
  const existsResults = await redis.pipeline(
    sessionIds.map(id => ["exists", `session:${id}:info`])
  ).exec();
  
  return existsResults.filter(([_, exists]) => exists).length;
}
```

### 7.4 Batch Operations for Performance

```typescript
// Batch get concurrent counts for multiple sessions
static async getConcurrentCountBatch(sessionIds: string[]): Promise<Map<string, number>> {
  if (sessionIds.length === 0) return new Map();
  
  const pipeline = redis.pipeline();
  for (const sessionId of sessionIds) {
    pipeline.get(`session:${sessionId}:concurrent_count`);
  }
  const results = await pipeline.exec();
  
  // Map results to session IDs
  const counts = new Map<string, number>();
  sessionIds.forEach((id, index) => {
    const result = results?.[index];
    const count = result && result[0] === null && result[1] 
      ? parseInt(result[1] as string, 10) 
      : 0;
    counts.set(id, count);
  });
  return counts;
}

// Batch get provider session counts
static async getProviderSessionCountBatch(providerIds: number[]): Promise<Map<number, number>> {
  // Phase 1: Cleanup and get session IDs for all providers (pipeline)
  // Phase 2: Batch validate session existence
  // Phase 3: Calculate counts per provider
}
```

---

## 8. References

### 8.1 Key Source Files

| Component | Path |
|-----------|------|
| Dashboard Layout | `src/app/[locale]/dashboard/layout.tsx` |
| Dashboard Bento | `src/app/[locale]/dashboard/_components/bento/dashboard-bento.tsx` |
| Dashboard Bento Section | `src/app/[locale]/dashboard/_components/dashboard-bento-sections.tsx` |
| Statistics Chart | `src/app/[locale]/dashboard/_components/statistics/chart.tsx` |
| Bento Statistics Chart | `src/app/[locale]/dashboard/_components/bento/statistics-chart-card.tsx` |
| Big Screen | `src/app/[locale]/internal/dashboard/big-screen/page.tsx` |
| Overview Panel | `src/components/customs/overview-panel.tsx` |
| Overview Action | `src/actions/overview.ts` |
| Dashboard Realtime | `src/actions/dashboard-realtime.ts` |
| Statistics Action | `src/actions/statistics.ts` |
| Provider Slots | `src/actions/provider-slots.ts` |
| Active Sessions | `src/actions/active-sessions.ts` |
| Concurrent Sessions | `src/actions/concurrent-sessions.ts` |
| Overview Repository | `src/repository/overview.ts` |
| Statistics Repository | `src/repository/statistics.ts` |
| Leaderboard Repository | `src/repository/leaderboard.ts` |
| Activity Stream | `src/repository/activity-stream.ts` |
| Session Tracker | `src/lib/session-tracker.ts` |
| Leaderboard Cache | `src/lib/redis/leaderboard-cache.ts` |
| Timezone Utils | `src/lib/utils/timezone.ts` |
| Currency Utils | `src/lib/utils/currency.ts` |
| Chart UI Component | `src/components/ui/chart.tsx` |
| Leaderboard API | `src/app/api/leaderboard/route.ts` |

### 8.2 Data Types Reference

```typescript
// Core dashboard data structures
interface DashboardRealtimeData {
  metrics: OverviewData;
  activityStream: ActivityStreamEntry[];
  userRankings: LeaderboardEntry[];
  providerRankings: ProviderLeaderboardEntry[];
  providerSlots: ProviderSlotInfo[];
  modelDistribution: ModelLeaderboardEntry[];
  trendData: Array<{ hour: number; value: number }>;
}

interface OverviewData {
  concurrentSessions: number;
  todayRequests: number;
  todayCost: number;
  avgResponseTime: number;
  todayErrorRate: number;
  yesterdaySamePeriodRequests: number;
  yesterdaySamePeriodCost: number;
  yesterdaySamePeriodAvgResponseTime: number;
  recentMinuteRequests: number;
}

interface ActivityStreamEntry {
  id: string;
  user: string;
  model: string;
  provider: string;
  latency: number;
  status: number;
  cost: number;
  startTime: number;
}

interface LeaderboardEntry {
  userId: number;
  userName: string;
  totalRequests: number;
  totalCost: number;
  totalTokens: number;
}

interface ProviderLeaderboardEntry {
  providerId: number;
  providerName: string;
  totalRequests: number;
  totalCost: number;
  totalTokens: number;
  successRate: number;
  avgTtfbMs: number;
  avgTokensPerSecond: number;
}

interface ModelLeaderboardEntry {
  model: string;
  totalRequests: number;
  totalCost: number;
  totalTokens: number;
  successRate: number;
}

interface ProviderSlotInfo {
  providerId: number;
  name: string;
  usedSlots: number;
  totalSlots: number;
  totalVolume: number;
}
```

### 8.3 Related Documentation

- **Rate Limiting**: `/docs/monitoring/rate-limiting` - Details on quota tracking
- **Session Management**: `/docs/architecture/session-management` - Session lifecycle
- **Provider Configuration**: `/docs/configuration/providers` - Provider slot limits
- **Database Schema**: `/docs/architecture/database-schema` - Message request table structure

---

## 9. Performance Considerations

### 9.1 Query Optimization

1. **Composite Indexes**: Database indexes on `(userId, createdAt, costUsd)` for fast aggregation
2. **Redis Caching**: 60-second TTL for leaderboard data with distributed locking
3. **Parallel Queries**: `Promise.all()` for independent data sources
4. **Partial Failure**: `Promise.allSettled()` prevents cascading failures
5. **Batch Operations**: Pipeline Redis commands for multiple session operations
6. **Window Functions**: Use `ROW_NUMBER() OVER` for efficient "latest per group" queries

### 9.2 Frontend Optimization

1. **React Query Caching**: Stale-while-revalidate pattern with 5-second refetch
2. **SWR for Big Screen**: 2-second refresh with `revalidateOnFocus: false`
3. **Initial Data**: Statistics panel uses server-fetched initial data
4. **Conditional Fetching**: Active sessions only fetched for admin users
5. **Memoization**: `useMemo` for computed values like session activity timestamps

### 9.3 Scalability Limits

| Metric | Limit | Notes |
|--------|-------|-------|
| Concurrent Dashboard Users | 100+ | Redis connection pooling |
| Activity Stream Items | 20 | Configurable via `ACTIVITY_STREAM_LIMIT` |
| Leaderboard Entries | All | Dashboard displays top 5, API returns all |
| Model Distribution | 10 | `MODEL_DISTRIBUTION_LIMIT` for big screen |
| Provider Slots Display | 3 | Top 3 by utilization rate |
| Chart Data Points | 24/7/30 | Based on time range resolution |
| Session TTL | 5 minutes | Configurable via `SESSION_TTL` constant |
| Leaderboard Cache TTL | 60 seconds | Optimistic caching strategy |
| Cache Lock Timeout | 10 seconds | Prevents indefinite locks |

### 9.4 Cache Invalidation Strategy

```typescript
// Leaderboard cache keys include:
// - scope: user | provider | providerCacheHitRate | model
// - period: daily | weekly | monthly | allTime | custom
// - date component (based on timezone)
// - currency display
// - provider type filter
// - user tags/groups filter

// Example keys:
// leaderboard:user:daily:2025-01-29:USD
// leaderboard:provider:weekly:2025-W05:CNY:providerType:claude
// leaderboard:user:custom:2025-01-01_2025-01-29:USD:tags:vip,groups:premium
```

---

## 10. Internationalization

The dashboard supports multiple languages via next-intl:

| Language | File | Coverage |
|----------|------|----------|
| English | `messages/en/dashboard.json` | Full |
| Simplified Chinese | `messages/zh-CN/dashboard.json` | Full |
| Traditional Chinese | `messages/zh-TW/dashboard.json` | Full |
| Big Screen EN | `messages/en/bigScreen.json` | Full |
| Big Screen ZH-CN | `messages/zh-CN/bigScreen.json` | Full |
| Big Screen ZH-TW | `messages/zh-TW/bigScreen.json` | Full |

Translation keys follow hierarchical structure:
```
dashboard:
  title: {...}
  actions: {...}
  leaderboard: {...}
  sessions: {...}
  quotas: {...}
```

---

*Report generated: 2025-01-29*
*Target documentation: /docs/monitoring/dashboard (仪表盘实时指标)*
