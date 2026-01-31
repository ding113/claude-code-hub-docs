# Charts Implementation Analysis Report

## Intent Analysis

The claude-code-hub project implements a comprehensive chart visualization system for monitoring and analytics purposes. The primary intent is to provide users with visual insights into:

1. **Usage Statistics**: Track API consumption patterns across users and keys over time
2. **Cost Analysis**: Visualize spending trends with currency formatting and aggregation
3. **Rate Limit Monitoring**: Display rate limit events and their distribution by type
4. **Provider Availability**: Monitor service provider health, latency, and uptime
5. **Real-time Dashboards**: Big-screen displays for operational monitoring

The chart system is designed with the following architectural goals:
- **Modularity**: Reusable chart components with consistent styling
- **Internationalization**: Full i18n support with timezone-aware formatting
- **Accessibility**: Proper ARIA labels and keyboard navigation
- **Performance**: Efficient data aggregation at the database level
- **Responsiveness**: Adaptive layouts for various screen sizes

---

## Behavior Summary

### Core Chart Infrastructure

The chart system is built on top of **Recharts v3**, wrapped by custom UI components in `/src/components/ui/chart.tsx`. The architecture follows a layered approach:

```
┌─────────────────────────────────────────────────────────────┐
│                    Chart Components                         │
│  (UserStatisticsChart, RateLimitEventsChart, etc.)         │
├─────────────────────────────────────────────────────────────┤
│                 ChartContainer Wrapper                      │
│  (ResponsiveContainer, theming, CSS variables)             │
├─────────────────────────────────────────────────────────────┤
│                    Recharts Library                         │
│  (AreaChart, LineChart, PieChart, etc.)                    │
├─────────────────────────────────────────────────────────────┤
│              Data Transformation Layer                      │
│  (Server Actions → ChartDataItem format)                   │
├─────────────────────────────────────────────────────────────┤
│              Database Aggregation Layer                     │
│  (PostgreSQL with generate_series CTEs)                    │
└─────────────────────────────────────────────────────────────┘
```

### Chart Types and Their Behaviors

#### 1. Area Charts (User Statistics)

**Location**: `/src/app/[locale]/dashboard/_components/statistics/chart.tsx`

**Behavior**:
- Displays dual metrics: cost and API calls
- Supports two visualization modes:
  - **Overlay**: Multiple users shown as overlapping areas (sorted by total value)
  - **Stacked**: Values accumulated on top of each other
- Interactive legend with user filtering (admin mode)
- Gradient fills with dynamic color assignment
- Custom tooltip with timezone-aware date formatting

**Key Features**:
- Color palette with 24 distinct HSL colors cycling for multi-user display
- Decimal.js for precise currency calculations
- User selection with "select all" / "deselect all" controls
- Sorting by total cost or calls in legend

#### 2. Area Charts (Rate Limit Events)

**Location**: `/src/app/[locale]/dashboard/_components/rate-limit-events-chart.tsx`

**Behavior**:
- Hourly timeline of rate limit events
- Single metric display with gradient fill
- Total event count in card description

#### 3. Pie Charts (Rate Limit Type Breakdown)

**Location**: `/src/app/[locale]/dashboard/_components/rate-limit-type-breakdown.tsx`

**Behavior**:
- Distribution of rate limit events by type (rpm, usd_5h, usd_weekly, etc.)
- Percentage labels on chart segments
- Custom legend with color-coded items
- Empty state handling

#### 4. Area Charts (Provider Latency)

**Location**: `/src/app/[locale]/dashboard/availability/_components/provider/latency-chart.tsx`

**Behavior**:
- Displays P50, P95, P99 latency percentiles
- Aggregates data across multiple providers
- Automatic unit formatting (ms → s for large values)
- Empty state with "no data" message

#### 5. Line Charts (Endpoint Latency)

**Location**: `/src/app/[locale]/dashboard/availability/_components/endpoint/latency-curve.tsx`

**Behavior**:
- Individual probe log visualization
- Failed requests highlighted with red dots
- Statistics display (avg, min, max latency)
- Custom dot rendering for error states

#### 6. Custom Lane Chart (Availability)

**Location**: `/src/app/[locale]/dashboard/availability/_components/provider/lane-chart.tsx`

**Behavior**:
- Two visualization modes based on request volume:
  - **High volume (>50 requests)**: Bar visualization with height representing request count
  - **Low volume**: Scatter dot visualization
- Color-coded by availability score:
  - Emerald (≥95%): Excellent availability
  - Lime (80-95%): Good availability
  - Orange (50-80%): Degraded
  - Rose (<50%): Poor availability
- Interactive tooltips with detailed metrics
- Provider click handling for navigation

#### 7. Big Screen Dashboard Charts

**Location**: `/src/app/[locale]/internal/dashboard/big-screen/page.tsx`

**Behavior**:
- Real-time data with 2-second refresh interval (SWR)
- Traffic trend area chart (24-hour view)
- Model distribution pie chart
- Animated transitions with Framer Motion
- Dark/light theme support

---

## Configuration and Commands

### Chart Configuration Type

```typescript
// /src/components/ui/chart.tsx
export type ChartConfig = {
  [k in string]: {
    label?: React.ReactNode;
    icon?: React.ComponentType;
  } & (
    | { color?: string; theme?: never }
    | { theme: Record<keyof typeof THEMES, string> }
  );
};
```

### Time Range Configuration

```typescript
// /src/types/statistics.ts
export type TimeRange = "today" | "7days" | "30days" | "thisMonth";

export interface TimeRangeConfig {
  label: string;
  key: TimeRange;
  resolution: "hour" | "day";
  description?: string;
}

export const TIME_RANGE_OPTIONS: TimeRangeConfig[] = [
  {
    label: "today",
    key: "today",
    resolution: "hour",
    description: "todayDescription",
  },
  {
    label: "7days",
    key: "7days",
    resolution: "day",
    description: "7daysDescription",
  },
  {
    label: "30days",
    key: "30days",
    resolution: "day",
    description: "30daysDescription",
  },
  {
    label: "thisMonth",
    key: "thisMonth",
    resolution: "day",
    description: "thisMonthDescription",
  },
];
```

### Data Structure

```typescript
// Chart data item format
export interface ChartDataItem {
  date: string;
  [key: string]: string | number;  // Dynamic keys like "user-1_cost", "user-1_calls"
}

// User statistics response
export interface UserStatisticsData {
  chartData: ChartDataItem[];
  users: StatisticsUser[];
  timeRange: TimeRange;
  resolution: "hour" | "day";
  mode: "users" | "keys" | "mixed";
}

export interface StatisticsUser {
  id: number;
  name: string;
  dataKey: string;  // Format: "user-{id}" or "key-{id}"
}
```

### Color System

CSS Variables (defined in theme):
```css
--chart-1: hsl(220, 70%, 50%);
--chart-2: hsl(160, 60%, 45%);
--chart-3: hsl(30, 80%, 55%);
--chart-4: hsl(280, 65%, 60%);
--chart-5: hsl(340, 75%, 55%);
```

Extended palette for multi-user charts (24 colors):
```typescript
const USER_COLOR_PALETTE = [
  "var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)",
  "hsl(15, 85%, 60%)", "hsl(195, 85%, 60%)", "hsl(285, 85%, 60%)",
  // ... 15 more HSL colors
] as const;
```

### Server Action API

```typescript
// /src/actions/statistics.ts
export async function getUserStatistics(
  timeRange: TimeRange = DEFAULT_TIME_RANGE
): Promise<ActionResult<UserStatisticsData>>;
```

**Display Modes**:
- `users`: Admin view - shows all users
- `keys`: Non-admin view - shows only own API keys
- `mixed`: Non-admin with `allowGlobalUsageView=true` - own keys + aggregated "others"

---

## Data Aggregation Implementation

### PostgreSQL Time Bucket Generation

The system uses PostgreSQL's `generate_series` function to create time buckets:

```sql
-- Today (hourly resolution)
WITH hour_range AS (
  SELECT generate_series(
    DATE_TRUNC('day', TIMEZONE(${timezone}, NOW())),
    DATE_TRUNC('day', TIMEZONE(${timezone}, NOW())) + INTERVAL '23 hours',
    '1 hour'::interval
  ) AS hour
)

-- 7/30 days (daily resolution)
WITH date_range AS (
  SELECT generate_series(
    (CURRENT_TIMESTAMP AT TIME ZONE ${timezone})::date - INTERVAL '6 days',
    (CURRENT_TIMESTAMP AT TIME ZONE ${timezone})::date,
    '1 day'::interval
  )::date AS date
)
```

### Aggregation Query Pattern

```sql
SELECT
  u.id AS user_id,
  u.name AS user_name,
  hr.hour,
  COUNT(mr.id) AS api_calls,
  COALESCE(SUM(mr.cost_usd), 0) AS total_cost
FROM users u
CROSS JOIN hour_range hr
LEFT JOIN message_request mr ON u.id = mr.user_id
  AND DATE_TRUNC('hour', mr.created_at AT TIME ZONE ${timezone}) = hr.hour
  AND mr.deleted_at IS NULL 
  AND (mr.blocked_by IS NULL OR mr.blocked_by <> 'warmup')
WHERE u.deleted_at IS NULL
GROUP BY u.id, u.name, hr.hour
ORDER BY hour ASC, user_name ASC
```

### Key Features of Aggregation

1. **Timezone Awareness**: All queries use `resolveSystemTimezone()` for consistent time boundaries
2. **Warmup Exclusion**: `EXCLUDE_WARMUP_CONDITION` filters out health check requests
3. **Soft Delete Handling**: `deleted_at IS NULL` checks for users and requests
4. **CROSS JOIN Pattern**: Ensures all time buckets appear even with no data

---

## Edge Cases and Handling

### 1. Empty Data States

All chart components handle empty data gracefully:

```typescript
// Latency chart example
if (chartData.length === 0) {
  return (
    <div className="flex items-center justify-center h-[300px] text-muted-foreground">
      {t("noData")}
    </div>
  );
}
```

### 2. Numeric Overflow Protection

```typescript
// Server action error handling
if (errorMessage.includes("numeric field overflow")) {
  return {
    ok: false,
    error: "数据金额过大，请检查数据库中的费用记录",
  };
}
```

### 3. Single User Constraint

User selection enforces at least one selected user:

```typescript
const toggleUserSelection = (userId: number) => {
  setSelectedUserIds((prev) => {
    const next = new Set(prev);
    if (next.has(userId)) {
      if (next.size > 1) {  // Prevent deselecting last user
        next.delete(userId);
      }
    } else {
      next.add(userId);
    }
    return next;
  });
};
```

### 4. Decimal Precision

Cost calculations use Decimal.js to prevent floating-point errors:

```typescript
const costDecimal = toDecimal(day[costKey]);
normalized[costKey] = costDecimal 
  ? Number(costDecimal.toDecimalPlaces(6).toString()) 
  : 0;
```

### 5. Timezone Edge Cases

- Fallback to "UTC" when timezone is undefined
- Date formatting with `date-fns-tz` for consistent display
- Hour vs day resolution affects date format patterns

### 6. High Volume Data Handling

Lane chart switches visualization based on request count:

```typescript
const HIGH_VOLUME_THRESHOLD = 50;
const isHighVolume = provider.totalRequests >= HIGH_VOLUME_THRESHOLD;
// High volume: solid bars
// Low volume: scatter dots
```

---

## References

### Core Files

| File | Purpose |
|------|---------|
| `/src/components/ui/chart.tsx` | Core chart wrapper components |
| `/src/types/statistics.ts` | TypeScript types for chart data |
| `/src/actions/statistics.ts` | Server action for fetching statistics |
| `/src/repository/statistics.ts` | Database queries for aggregation |

### Chart Components

| File | Chart Type | Purpose |
|------|------------|---------|
| `/src/app/[locale]/dashboard/_components/statistics/chart.tsx` | Area Chart | User statistics (cost/calls) |
| `/src/app/[locale]/dashboard/_components/bento/statistics-chart-card.tsx` | Area Chart | Bento-style statistics card |
| `/src/app/[locale]/dashboard/_components/rate-limit-events-chart.tsx` | Area Chart | Rate limit timeline |
| `/src/app/[locale]/dashboard/_components/rate-limit-type-breakdown.tsx` | Pie Chart | Rate limit distribution |
| `/src/app/[locale]/dashboard/availability/_components/provider/latency-chart.tsx` | Area Chart | Provider latency percentiles |
| `/src/app/[locale]/dashboard/availability/_components/endpoint/latency-curve.tsx` | Line Chart | Endpoint latency curve |
| `/src/app/[locale]/dashboard/availability/_components/provider/lane-chart.tsx` | Custom | Availability visualization |
| `/src/app/[locale]/internal/dashboard/big-screen/page.tsx` | Mixed | Real-time dashboard |

### Supporting Components

| File | Purpose |
|------|---------|
| `/src/app/[locale]/dashboard/_components/statistics/time-range-selector.tsx` | Time range selection UI |
| `/src/lib/utils/date-format.ts` | Date formatting utilities |
| `/src/lib/utils/currency.ts` | Currency formatting utilities |

### External Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `recharts` | ^3 | Charting library |
| `date-fns-tz` | latest | Timezone-aware date formatting |
| `decimal.js` | latest | Precise decimal calculations |
| `framer-motion` | latest | Animations for big-screen dashboard |

### Test Files

| File | Coverage |
|------|----------|
| `/tests/unit/dashboard/availability/latency-chart.test.tsx` | Provider latency chart |
| `/tests/unit/dashboard/availability/latency-curve.test.tsx` | Endpoint latency curve |
| `/tests/unit/settings/providers/endpoint-latency-sparkline-ui.test.tsx` | Sparkline component |

---

## Summary

The claude-code-hub chart implementation provides a robust, scalable visualization system with the following characteristics:

1. **Layered Architecture**: Clear separation between data layer (PostgreSQL), transformation layer (Server Actions), and presentation layer (React components)

2. **Flexible Time Ranges**: Four predefined time ranges with automatic resolution switching (hourly for today, daily for longer periods)

3. **Multi-User Support**: Up to 24 users/keys can be displayed simultaneously with distinct colors

4. **Accessibility**: Full keyboard navigation, ARIA labels, and screen reader support

5. **Internationalization**: Complete i18n support with timezone-aware formatting using date-fns-tz

6. **Performance**: Database-level aggregation using PostgreSQL CTEs, minimizing data transfer

7. **Error Resilience**: Comprehensive error handling for numeric overflow, empty states, and edge cases

8. **Theming**: CSS variable-based theming with light/dark mode support

The system is designed to be extended - new chart types can be added by following the established patterns of ChartContainer wrapping and ChartConfig for consistent styling.
