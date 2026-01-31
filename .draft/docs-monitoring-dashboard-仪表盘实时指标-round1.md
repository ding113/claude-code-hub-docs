# Dashboard Real-time Metrics Implementation Report

## 1. Intent Analysis

The claude-code-hub dashboard provides a comprehensive real-time monitoring interface for administrators and users to track API usage, costs, provider health, and system performance. The dashboard serves multiple key purposes:

### 1.1 Core Objectives
- **Real-time Monitoring**: Track concurrent sessions, request rates, costs, and error rates with sub-second refresh intervals
- **Usage Analytics**: Display detailed statistics on user consumption, provider performance, and model distribution
- **Operational Visibility**: Monitor provider capacity, rate limiting events, and system health
- **Cost Management**: Track spending across multiple dimensions (users, providers, models, time periods)
- **Performance Optimization**: Identify bottlenecks through response time metrics and throughput analysis

### 1.2 User Roles and Permissions
The dashboard implements a role-based access control system:
- **Administrators**: Full access to all metrics, global statistics, and provider management
- **Standard Users**: Limited to personal usage data unless `allowGlobalUsageView` is enabled
- **Read-only Access**: Certain endpoints support read-only API key access for monitoring integrations

### 1.3 Key Design Decisions
1. **Hybrid Data Strategy**: Combines Redis for real-time session tracking with PostgreSQL for persistent analytics
2. **Optimistic Caching**: Redis-based caching with 60-second TTL for leaderboard data to reduce database load
3. **Partial Failure Tolerance**: Uses `Promise.allSettled()` to ensure dashboard functionality even if some data sources fail
4. **Timezone Awareness**: All time-based aggregations respect the configured system timezone
5. **Currency Flexibility**: Support for multiple currencies (USD, CNY, EUR, JPY, GBP, HKD, TWD, KRW, SGD)

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
        │                       │           │   real-time counts)   │
        └───────────────────────┘           └───────────────────────┘
```

### 2.2 Main Dashboard Components

#### 2.2.1 Dashboard Bento Layout (`dashboard-bento.tsx`)
The primary dashboard interface uses a responsive bento grid layout with:

**Section 1: Core Metrics (Admin Only)**
- Concurrent Sessions: Real-time count of active sessions from Redis
- RPM (Requests Per Minute): Rolling 1-minute request count
- Today's Cost: Accumulated spending for current day
- Average Response Time: Mean latency across all requests

**Section 2: Statistics Chart (Full Width)**
- Interactive area chart showing cost and call volume over time
- Time range selector: Today, 7 Days, 30 Days, This Month
- Dual mode: Overlay (stacked areas) vs Stacked (cumulative)
- User filtering: Toggle individual users on/off (admin mode)

**Section 3: Leaderboards + Live Sessions**
- User Rankings: Top consumers by cost
- Provider Rankings: Top providers by request volume
- Model Rankings: Most used models
- Live Sessions Panel: Real-time active session list

#### 2.2.2 Real-time Data Flow

```typescript
// Refresh intervals configured across components
const REFRESH_INTERVAL = 5000; // 5 seconds for dashboard bento
const STATISTICS_REFRESH_INTERVAL = 5000; // 5 seconds for statistics
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

#### 2.2.3 Big Screen Dashboard (`big-screen/page.tsx`)
A dedicated full-screen display optimized for monitoring stations:
- **2-second refresh rate** using SWR
- **Three-column layout**: Metrics | Provider Quotas + Trends | Activity Stream
- **Animated transitions** using Framer Motion
- **Dark/Light theme** toggle with system detection
- **Auto-hiding UI** for distraction-free viewing

### 2.3 Data Refresh Patterns

| Component | Refresh Interval | Data Source | Strategy |
|-----------|-----------------|-------------|----------|
| Overview Metrics | 5 seconds | PostgreSQL + Redis | Parallel queries |
| Statistics Chart | 5 seconds | PostgreSQL | Time-range cached |
| Leaderboards | 60 seconds (cache) | PostgreSQL | Redis optimistic cache |
| Activity Stream | 2 seconds | Redis + PostgreSQL | Hybrid (active + recent) |
| Provider Slots | 5 seconds | Redis | Real-time counts |
| Live Sessions | 5 seconds | Redis | Active session list |

---

## 3. Configuration and Commands

### 3.1 Dashboard Configuration

#### 3.1.1 System Settings (`system-config`)
Key settings affecting dashboard behavior:

```typescript
interface SystemSettings {
  // Currency display preference
  currencyDisplay: CurrencyCode; // "USD" | "CNY" | "EUR" | ...
  
  // Global visibility toggle
  allowGlobalUsageView: boolean; // Allow non-admins to see aggregate data
  
  // Timezone configuration
  timezone: string; // e.g., "Asia/Shanghai", "UTC"
}
```

#### 3.1.2 Environment Variables
```bash
# Redis configuration for session tracking
REDIS_URL=redis://localhost:6379

# Database connection
DATABASE_URL=postgresql://user:pass@localhost:5432/claude_code_hub

# Session TTL (affects dashboard real-time counts)
SESSION_TTL=300000  # 5 minutes in milliseconds
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
  providerType?: string; // Filter for provider scopes
  userTags?: string;     // Comma-separated tags
  userGroups?: string;   // Comma-separated groups
}
```

### 3.3 Server Actions

#### 3.3.1 Overview Data Action
```typescript
// src/actions/overview.ts
export async function getOverviewData(): Promise<ActionResult<OverviewData>> {
  // 1. Check authentication
  // 2. Determine visibility scope (admin vs user)
  // 3. Parallel query: concurrent sessions + metrics
  // 4. Return aggregated data with comparisons
}
```

**Response Structure:**
```typescript
interface OverviewData {
  concurrentSessions: number;        // Active sessions from Redis
  todayRequests: number;             // Total requests today
  todayCost: number;                 // Accumulated cost (USD)
  avgResponseTime: number;           // Mean latency (ms)
  todayErrorRate: number;            // Error percentage
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
  // - findRecentActivityStream(20)
  // - findDailyLeaderboard()
  // - findDailyProviderLeaderboard()
  // - getProviderSlots()
  // - findDailyModelLeaderboard()
  // - getUserStatistics("today")
}
```

### 3.4 Time Range Configuration

```typescript
// src/types/statistics.ts
export const TIME_RANGE_OPTIONS = [
  { key: "today", label: "Today", hours: 24, resolution: "hour" },
  { key: "7days", label: "7 Days", hours: 168, resolution: "day" },
  { key: "30days", label: "30 Days", hours: 720, resolution: "day" },
  { key: "thisMonth", label: "This Month", hours: 720, resolution: "day" },
] as const;
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
- Errors are logged for debugging

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

### 4.3 Database Query Timeouts

Large time-range queries implement safeguards:
- **Numeric overflow protection**: Detects and reports "numeric field overflow" errors
- **Time range limits**: Maximum 30-day window for detailed queries
- **Aggregation optimization**: Uses materialized patterns for all-time statistics

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

### 4.6 Concurrent Session Race Conditions

Provider session tracking uses atomic Lua scripts:

```typescript
// Atomic check-and-track operation
const result = await redis.eval(
  CHECK_AND_TRACK_SESSION,
  1,              // KEYS count
  key,            // KEYS[1]
  sessionId,      // ARGV[1]
  limit.toString(), // ARGV[2]
  now.toString()  // ARGV[3]
) as [number, number, number];

const [allowed, count, tracked] = result;
```

**Prevents:**
- Concurrent requests exceeding limits
- Double-counting sessions
- Stale session data

---

## 5. Data Aggregation Logic

### 5.1 Overview Metrics Aggregation

```typescript
// src/repository/overview.ts
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
        EXCLUDE_WARMUP_CONDITION,  // Excludes warmup requests
        sql`(${messageRequest.createdAt} AT TIME ZONE ${timezone})::date = 
            (CURRENT_TIMESTAMP AT TIME ZONE ${timezone})::date`
      )
    );

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

// Step 2: Query latest request for each active session
const activeSessionRequests = await db.query(/* ... */);

// Step 3: If insufficient data, supplement with recent DB requests
if (activityItems.length < limit) {
  const recentRequests = await db.query(/* ... */);
  activityItems = [...activityItems, ...recentRequests];
}

// Step 4: Deduplicate and sort
const uniqueItems = new Map<number, ActivityStreamItem>();
const sortedItems = Array.from(uniqueItems.values())
  .sort((a, b) => b.startTime - a.startTime)
  .slice(0, limit);
```

### 5.3 Statistics Time-Series Aggregation

```typescript
// Group data by date/hour for chart display
const dataByDate = new Map<string, ChartDataItem>();

statsData.forEach((row) => {
  // Format date based on resolution (hour vs day)
  const dateStr = rangeConfig.resolution === "hour"
    ? new Date(row.date).toISOString()
    : new Date(row.date).toISOString().split("T")[0];

  if (!dataByDate.has(dateStr)) {
    dataByDate.set(dateStr, { date: dateStr });
  }

  const dateData = dataByDate.get(dateStr)!;
  const entityKey = createDataKey(prefix, entityId);

  // Store cost and calls for each entity
  dateData[`${entityKey}_cost`] = formatCostForStorage(row.total_cost);
  dateData[`${entityKey}_calls`] = row.api_calls || 0;
});
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
  .innerJoin(users, /* ... */)
  .where(and(...whereConditions))
  .groupBy(messageRequest.userId, users.name)
  .orderBy(desc(sql`sum(${messageRequest.costUsd})`));
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
```

---

## 6. Chart and Visualization Components

### 6.1 Chart Library: Recharts

The dashboard uses **Recharts** for all visualizations with custom theming support.

### 6.2 Area Chart Implementation

**User Statistics Chart** (`statistics/chart.tsx`):
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

### 6.3 Pie Chart for Distribution

**Model Distribution** (`rate-limit-type-breakdown.tsx`):
```typescript
<PieChart>
  <Pie
    data={chartData}
    dataKey="count"
    nameKey="name"
    cx="50%"
    cy="50%"
    outerRadius={80}
    label={({ name, percent }) => `${name} ${((percent ?? 0) * 100).toFixed(0)}%`}
  >
    {chartData.map((entry, index) => (
      <Cell key={`cell-${entry.type}`} fill={COLORS[index % COLORS.length]} />
    ))}
  </Pie>
  <Legend verticalAlign="bottom" />
</PieChart>
```

### 6.4 Custom Components

#### 6.4.1 Circular Progress (Provider Capacity)
```typescript
// Circular progress for slot utilization
interface CircularProgressProps {
  value: number;      // Current usage
  max: number;        // Total capacity
  size?: number;      // Component size
  strokeWidth?: number;
  showPercentage?: boolean;
}

// Auto-color based on utilization:
// - Green: < 70%
// - Yellow: 70% - 90%
// - Red: > 90%
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
Score: timestamp
Member: sessionId

# Provider-level sessions
Key: provider:{providerId}:active_sessions
Type: ZSET

# Key-level sessions  
Key: key:{keyId}:active_sessions
Type: ZSET

# User-level sessions
Key: user:{userId}:active_sessions
Type: ZSET

# Session metadata
Key: session:{sessionId}:info
Type: Hash
TTL: 5 minutes

# Session concurrent request count
Key: session:{sessionId}:concurrent_count
Type: String (counter)
TTL: 10 minutes
```

### 7.2 Session Lifecycle

```
1. Request Start
   └─> SessionTracker.trackSession() 
       └─> ZADD global:active_sessions (timestamp)
       └─> ZADD key:{keyId}:active_sessions
       └─> ZADD user:{userId}:active_sessions (if applicable)

2. Provider Selection
   └─> SessionTracker.trackProviderSession()
       └─> ZADD provider:{providerId}:active_sessions

3. Request End / Session Expire
   └─> SessionTracker.untrackSession()
       └─> ZREM from all sets
       └─> DEL session:{sessionId}:info
```

### 7.3 Cleanup Mechanism

Automatic cleanup of stale sessions (5-minute TTL):

```typescript
private static async countFromZSet(key: string): Promise<number> {
  const now = Date.now();
  const fiveMinutesAgo = now - SessionTracker.SESSION_TTL;

  // Remove expired sessions
  await redis.zremrangebyscore(key, "-inf", fiveMinutesAgo);

  // Get remaining valid sessions
  const sessionIds = await redis.zrange(key, 0, -1);
  
  // Verify session info exists (double-check)
  const existsResults = await redis.pipeline(
    sessionIds.map(id => ["exists", `session:${id}:info`])
  ).exec();
  
  return existsResults.filter(([_, exists]) => exists).length;
}
```

---

## 8. References

### 8.1 Key Source Files

| Component | Path |
|-----------|------|
| Dashboard Layout | `src/app/[locale]/dashboard/layout.tsx` |
| Dashboard Bento | `src/app/[locale]/dashboard/_components/bento/dashboard-bento.tsx` |
| Statistics Chart | `src/app/[locale]/dashboard/_components/statistics/chart.tsx` |
| Big Screen | `src/app/[locale]/internal/dashboard/big-screen/page.tsx` |
| Overview Action | `src/actions/overview.ts` |
| Dashboard Realtime | `src/actions/dashboard-realtime.ts` |
| Statistics Action | `src/actions/statistics.ts` |
| Overview Repository | `src/repository/overview.ts` |
| Statistics Repository | `src/repository/statistics.ts` |
| Leaderboard Repository | `src/repository/leaderboard.ts` |
| Activity Stream | `src/repository/activity-stream.ts` |
| Session Tracker | `src/lib/session-tracker.ts` |
| Chart UI Component | `src/components/ui/chart.tsx` |
| Circular Progress | `src/components/ui/circular-progress.tsx` |

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
2. **Redis Caching**: 60-second TTL for leaderboard data
3. **Parallel Queries**: `Promise.all()` for independent data sources
4. **Partial Failure**: `Promise.allSettled()` prevents cascading failures

### 9.2 Frontend Optimization

1. **React Query Caching**: Stale-while-revalidate pattern
2. **Debounced Updates**: 5-second refresh intervals to reduce load
3. **Virtual Scrolling**: For large activity streams and log tables
4. **Lazy Loading**: Statistics panel loads on demand

### 9.3 Scalability Limits

| Metric | Limit | Notes |
|--------|-------|-------|
| Concurrent Dashboard Users | 100+ | Redis connection pooling |
| Activity Stream Items | 20 | Configurable |
| Leaderboard Entries | Top 5 | Dashboard view only |
| Chart Data Points | 30 days | Hourly resolution |
| Session TTL | 5 minutes | Configurable |

---

*Report generated: 2025-01-29*
*Target documentation: /docs/monitoring/dashboard (仪表盘实时指标)*
