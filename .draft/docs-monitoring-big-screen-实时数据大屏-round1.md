# Big Screen (实时数据大屏) - Technical Analysis Report

## Intent Analysis

The Big Screen (实时数据大屏) feature in Claude Code Hub is a comprehensive real-time monitoring dashboard designed for system administrators to visualize critical system metrics, user activities, and resource utilization in a single, immersive full-screen interface. The primary intent is to provide:

1. **Real-time System Monitoring**: Display live metrics including concurrent sessions, request volume, costs, latency, and error rates
2. **Operational Visibility**: Show active user sessions, provider performance, and model distribution
3. **Decision Support**: Enable administrators to quickly identify bottlenecks, high-cost users, and system health issues
4. **Presentation Ready**: Full-screen layout optimized for display on large monitors or TV screens in office environments

The feature targets administrators and operators who need continuous visibility into the Claude Code Hub proxy system's operational status.

---

## Behavior Summary

### Page Location and Routing

The big screen is located at:
- **Route**: `/internal/dashboard/big-screen`
- **Layout**: `src/app/[locale]/internal/dashboard/big-screen/layout.tsx`
- **Page**: `src/app/[locale]/internal/dashboard/big-screen/page.tsx`

The route uses a special layout that removes all navigation bars, sidebars, and other UI chrome to provide a true full-screen experience.

### Core Data Sources

The big screen aggregates data from multiple sources through the `getDashboardRealtimeData` server action:

1. **Core Metrics** (`getOverviewData`): Concurrent sessions, today's requests, cost, average response time, error rate
2. **Activity Stream** (`findRecentActivityStream`): Live feed of recent requests from Redis active sessions + database
3. **User Rankings** (`findDailyLeaderboard`): Top 5 users by consumption
4. **Provider Rankings** (`findDailyProviderLeaderboard`): Top 5 providers by cost
5. **Provider Slots** (`getProviderSlots`): Real-time concurrent slot usage per provider
6. **Model Distribution** (`findDailyModelLeaderboard`): Model call distribution
7. **Trend Data** (`getUserStatistics`): 24-hour traffic trends

### Visual Layout

The page uses a 12-column grid layout with three main sections:

```
┌─────────────────────────────────────────────────────────────┐
│  HEADER: Title + Clock + Language Switcher + Theme Toggle   │
├──────────────┬──────────────────────────────┬───────────────┤
│              │                              │               │
│  LEFT COL    │      MIDDLE COL              │   RIGHT COL   │
│  (col-span-3)│      (col-span-5)            │  (col-span-4) │
│              │                              │               │
│  User        │  Provider Quotas             │               │
│  Rankings    │  (Slot usage visualization)  │  Activity     │
│  (flex-[3])  │                              │  Stream       │
│              ├──────────────────────────────┤  (Live feed)  │
│  Provider    │  Traffic Trend               │               │
│  Rankings    │  (24h area chart)            │               │
│  (flex-[2])  │                              │               │
│              ├──────────────────────────────┤               │
│              │  Model Distribution          │               │
│              │  (Pie chart)                 │               │
│              │                              │               │
└──────────────┴──────────────────────────────┴───────────────┘
│  FOOTER: System Status + Last Update Time                   │
└─────────────────────────────────────────────────────────────┘
```

### Top Metrics Row

Five key metric cards displayed at the top:
1. **Concurrent Sessions**: Live active session count with pulse indicator
2. **Today's Requests**: Total requests in last 24h with count-up animation
3. **Today's Cost**: Total cost with currency formatting
4. **Average Latency**: Response time in milliseconds
5. **Error Rate**: Percentage of failed requests with color-coded status

### Component Architecture

The page is composed of several specialized components:

- **MetricCard**: Animated metric display with icons and trend indicators
- **ActivityStream**: Scrolling list of recent requests with status colors
- **UserRankings**: Bar chart showing top users by token consumption
- **ProviderRanking**: List of top providers by cost
- **ProviderQuotas**: Visual representation of slot usage (used/total)
- **TrafficTrend**: 24-hour area chart with gradient fill
- **ModelDistribution**: Pie chart showing model usage distribution
- **ParticleBackground**: Animated background effect for visual appeal

---

## Configuration and Commands

### Permission Requirements

Access to the big screen requires:

```typescript
// From src/actions/dashboard-realtime.ts
const settings = await getSystemSettings();
const isAdmin = session.user.role === "admin";
const canViewGlobalData = isAdmin || settings.allowGlobalUsageView;

if (!canViewGlobalData) {
  return {
    ok: false,
    error: "无权限查看全局数据",
  };
}
```

**Configuration**: The `allowGlobalUsageView` setting in System Settings controls whether non-admin users can view the big screen.

### System Settings Configuration

The big screen respects the following system settings:

| Setting | Type | Description | Default |
|---------|------|-------------|---------|
| `allowGlobalUsageView` | boolean | Allow non-admin users to view global usage data | `false` |
| `currencyDisplay` | string | Currency code for cost display (USD/CNY/EUR) | `"USD"` |
| `billingModelSource` | string | Use 'original' or 'redirected' model for stats | `"original"` |
| `timezone` | string | Timezone for date calculations | `null` (UTC) |

### Environment Variables

The big screen relies on Redis for real-time session tracking:

```bash
# Redis configuration (required for real-time features)
ENABLE_RATE_LIMIT=true                  # Enable Redis-based tracking
REDIS_URL=redis://localhost:6379        # Redis connection URL
SESSION_TTL=300                         # Session expiration (seconds)
```

### Data Refresh Configuration

```typescript
// From page.tsx - SWR configuration
const { data, error, mutate } = useSWR(
  "dashboard-realtime",
  async () => {
    const result = await getDashboardRealtimeData();
    return result.data;
  },
  {
    refreshInterval: 2000,  // 2-second refresh interval
    revalidateOnFocus: false,
  }
);
```

### Theme Configuration

The big screen supports two themes:

```typescript
const THEMES = {
  dark: {
    bg: "bg-[#0a0a0c]",
    card: "bg-[#141417]/80 border border-white/[0.06]",
    text: "text-[#e6e6e6]",
    accent: "text-orange-400",
  },
  light: {
    bg: "bg-slate-50",
    card: "bg-white border border-slate-200",
    text: "text-slate-700",
    accent: "text-orange-500",
  },
};
```

---

## Auto-Refresh Mechanisms

### Client-Side Polling (SWR)

The big screen uses SWR (Stale-While-Revalidate) for data fetching:

```typescript
useSWR(
  "dashboard-realtime",
  fetcher,
  {
    refreshInterval: 2000,  // Poll every 2 seconds
    revalidateOnFocus: false,  // Don't refresh on window focus
  }
);
```

### Activity Stream Data Source

The activity stream combines two data sources for real-time accuracy:

1. **Redis Active Sessions**: Live sessions currently being tracked in Redis
2. **Database Fallback**: Recent requests from database when Redis data is insufficient

```typescript
// From src/repository/activity-stream.ts
export async function findRecentActivityStream(limit = 20): Promise<ActivityStreamItem[]> {
  // 1. Get active session IDs from Redis
  const activeSessionIds = await SessionTracker.getActiveSessions();
  
  // 2. Query latest request for each active session
  const activeSessionRequests = await db.select(...)
    .where(inArray(messageRequest.sessionId, activeSessionIds));
  
  // 3. If insufficient data, supplement with recent DB requests
  if (activityItems.length < limit) {
    const additionalItems = await db.select(...)
      .orderBy(desc(messageRequest.createdAt))
      .limit(remaining);
  }
}
```

### Session Tracking (Redis)

Real-time session counts are maintained via Redis:

```typescript
// From src/lib/session-tracker.ts
static async trackSession(sessionId: string, providerId: number): Promise<void> {
  const pipeline = redis.pipeline();
  
  // Update global active sessions set
  pipeline.zadd("global:active_sessions", now, sessionId);
  
  // Add to provider-specific set
  pipeline.zadd(`provider:${providerId}:active_sessions`, now, sessionId);
  pipeline.expire(`provider:${providerId}:active_sessions`, 3600);
  
  await pipeline.exec();
}
```

### Concurrent Session Counting

Provider slot usage is calculated using Redis ZSET operations:

```typescript
// Atomic check and track using Lua script
const CHECK_AND_TRACK_SESSION = `
  -- 1. Clean expired sessions (5 minutes ago)
  redis.call('ZREMRANGEBYSCORE', provider_key, '-inf', five_minutes_ago)
  
  -- 2. Check if session already tracked
  local is_tracked = redis.call('ZSCORE', provider_key, session_id)
  
  -- 3. Get current count
  local current_count = redis.call('ZCARD', provider_key)
  
  -- 4. Check limit
  if limit > 0 and not is_tracked and current_count >= limit then
    return {0, current_count, 0}  -- Rejected
  end
  
  -- 5. Track session
  redis.call('ZADD', provider_key, now, session_id)
  return {1, current_count + 1, 1}  -- Allowed
`;
```

---

## Display Modes

### Theme Modes

The big screen supports two visual themes:

1. **Dark Mode** (Default)
   - Background: `#0a0a0c` (near black)
   - Cards: `#141417` with subtle borders
   - Text: `#e6e6e6` (light gray)
   - Accent: Orange (`#ff6b35`)
   - Optimized for dark rooms and TV displays

2. **Light Mode**
   - Background: `slate-50`
   - Cards: White with slate borders
   - Text: `slate-700`
   - Accent: Orange
   - Better for bright environments

### Language Support

The big screen supports multiple languages via next-intl:

- **English** (`messages/en/bigScreen.json`)
- **Simplified Chinese** (`messages/zh-CN/bigScreen.json`)
- **Traditional Chinese** (`messages/zh-TW/bigScreen.json`)
- **Japanese** (`messages/ja/bigScreen.json`)
- **Russian** (`messages/ru/bigScreen.json`)

Language can be switched via the globe icon in the header.

### Responsive Behavior

While designed for large screens, the layout adapts:
- **Desktop (≥1280px)**: Full 12-column layout
- **Tablet**: Adjusted column spans
- **Mobile**: Stacked layout (not recommended for actual use)

### Animation Features

1. **Particle Background**: Animated floating particles for visual interest
2. **Count-Up Animation**: Numbers animate when values change
3. **Pulse Indicator**: Live indicator for concurrent sessions
4. **Activity Stream Scroll**: Auto-scrolling list of recent requests
5. **Card Hover Effects**: Subtle border glow on hover

---

## Edge Cases

### Permission Denied

When a user without `allowGlobalUsageView` permission accesses the page:
- The server action returns `{ ok: false, error: "无权限查看全局数据" }`
- SWR will throw an error
- Error state should be handled by the UI (though currently the page assumes access)

### Redis Unavailable

If Redis is not configured or unavailable:
- Session tracking falls back to database queries
- Concurrent session counts may be less accurate
- Activity stream still works but with higher latency

```typescript
// Fail-open strategy
if (!redis || redis.status !== "ready") {
  logger.warn("[Redis] Rate limiting disabled");
  return null;  // Fail open
}
```

### Empty Data States

All components handle empty data gracefully:

```typescript
const metrics = data?.metrics || {
  concurrentSessions: 0,
  todayRequests: 0,
  todayCost: 0,
  avgResponseTime: 0,
  todayErrorRate: 0,
};

const activities = (data?.activityStream || []).map(...);
const users = data?.userRankings || [];
```

### Database Query Failures

The system uses `Promise.allSettled` for partial failure tolerance:

```typescript
const [
  overviewResult,
  activityStreamResult,
  userRankingsResult,
  // ...
] = await Promise.allSettled([
  getOverviewData(),
  findRecentActivityStream(ACTIVITY_STREAM_LIMIT),
  // ...
]);

// Failed queries return empty arrays instead of crashing
const userRankings = userRankingsResult.status === "fulfilled" 
  ? userRankingsResult.value 
  : [];
```

### High Latency Calculation

For in-progress requests without `durationMs`, latency is calculated dynamically:

```typescript
const latency = item.durationMs ?? now - item.startTime;
```

This ensures the activity stream shows meaningful latency even for ongoing requests.

### Provider Slot Filtering

Only providers with configured limits are shown:

```typescript
const providerSlotsWithVolume = providerSlots
  .filter((slot) => slot.totalSlots > 0)  // Filter unset limits
  .sort((a, b) => {
    // Sort by usage ratio (descending)
    const usageA = a.totalSlots > 0 ? a.usedSlots / a.totalSlots : 0;
    const usageB = b.totalSlots > 0 ? b.usedSlots / b.totalSlots : 0;
    return usageB - usageA;
  })
  .slice(0, 3);  // Show top 3
```

### Timezone Handling

All time-based aggregations respect the system timezone setting:

```typescript
const timezone = await resolveSystemTimezone();
// Used in SQL queries with AT TIME ZONE
```

### Rate Limiting During Refresh

If many users have the big screen open simultaneously:
- Each client polls every 2 seconds
- Server-side caching via React `cache()` function
- Database queries are optimized with proper indexes

---

## References

### Key Files

| File | Purpose |
|------|---------|
| `src/app/[locale]/internal/dashboard/big-screen/page.tsx` | Main page component |
| `src/app/[locale]/internal/dashboard/big-screen/layout.tsx` | Full-screen layout |
| `src/app/[locale]/internal/dashboard/big-screen/loading.tsx` | Loading skeleton |
| `src/actions/dashboard-realtime.ts` | Server action for data fetching |
| `src/repository/activity-stream.ts` | Activity stream data source |
| `src/repository/leaderboard.ts` | Leaderboard queries |
| `src/actions/provider-slots.ts` | Provider slot information |
| `src/lib/session-tracker.ts` | Redis session tracking |
| `messages/*/bigScreen.json` | i18n translations |

### Related Components

- `MetricCard`: Animated metric display
- `ActivityStream`: Live request feed
- `UserRankings`: User consumption chart
- `ProviderRanking`: Provider performance list
- `ProviderQuotas`: Slot usage visualization
- `TrafficTrend`: 24h area chart
- `ModelDistribution`: Pie chart
- `ParticleBackground`: Animated background

### Dependencies

- `swr`: Data fetching and caching
- `recharts`: Charts and visualizations
- `framer-motion`: Animations
- `lucide-react`: Icons
- `next-intl`: Internationalization

### API Endpoints

The big screen uses the following server actions (not REST APIs):

- `getDashboardRealtimeData()`: Main data fetch
- `getOverviewData()`: Core metrics
- `findRecentActivityStream()`: Activity feed
- `findDailyLeaderboard()`: User rankings
- `findDailyProviderLeaderboard()`: Provider rankings
- `getProviderSlots()`: Slot usage
- `findDailyModelLeaderboard()`: Model distribution
- `getUserStatistics()`: Trend data

---

## Summary

The Big Screen feature is a sophisticated real-time monitoring dashboard that combines:

1. **High-frequency data polling** (2-second intervals)
2. **Multi-source data aggregation** (Redis + Database)
3. **Rich visualizations** (Charts, lists, metrics)
4. **Full-screen immersive experience**
5. **Multi-language support**
6. **Theme customization**
7. **Robust error handling** (Fail-open, partial tolerance)

It serves as the primary operational visibility tool for Claude Code Hub administrators, providing at-a-glance insight into system health, usage patterns, and resource utilization.
