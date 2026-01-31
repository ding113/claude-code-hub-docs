---
title: 统计图表可视化
description: 了解 Claude Code Hub 的统计图表可视化系统，包括用户统计、限流监控、供应商可用性等图表组件的使用和实现原理
nextjs:
  metadata:
    title: 统计图表可视化
    description: Claude Code Hub 统计图表可视化文档
---

# 统计图表可视化

Claude Code Hub 的统计图表可视化系统基于 **Recharts** 构建，提供全面的数据洞察能力。系统采用分层架构设计，涵盖从数据库聚合到前端展示的完整数据流，支持多时间维度、多用户视角的灵活分析。

图表系统主要服务于以下场景：

- **用量统计**：追踪 API 消费模式和调用趋势
- **成本分析**：可视化支出趋势，支持多币种格式化
- **限流监控**：展示限流事件分布和时间线
- **供应商可用性**：监控服务提供商健康状态、延迟和可用性
- **实时监控大屏**：为运维团队提供实时数据展示

## 架构设计

### 分层架构

```
┌─────────────────────────────────────────────────────────────┐
│                    图表组件层 (Chart Components)              │
│  UserStatisticsChart / RateLimitEventsChart / LaneChart    │
├─────────────────────────────────────────────────────────────┤
│                    容器封装层 (ChartContainer)                │
│  ResponsiveContainer / 主题管理 / CSS 变量注入               │
├─────────────────────────────────────────────────────────────┤
│                    图表库层 (Recharts)                        │
│  AreaChart / LineChart / PieChart / ComposedChart          │
├─────────────────────────────────────────────────────────────┤
│                    数据转换层 (Server Actions)                │
│  原始数据 → ChartDataItem 格式转换                           │
├─────────────────────────────────────────────────────────────┤
│                    数据库聚合层 (PostgreSQL)                  │
│  generate_series CTEs / 时区感知查询 / 权限过滤              │
└─────────────────────────────────────────────────────────────┘
```

### 核心依赖

| 包名 | 版本 | 用途 |
|------|------|------|
| `recharts` | ^2.x | 图表渲染库 |
| `date-fns-tz` | latest | 时区感知日期格式化 |
| `decimal.js` | latest | 精确货币计算 |
| `framer-motion` | latest | 大屏动画效果 |
| `swr` | latest | 实时数据获取 |

## 核心组件

### 图表容器组件 (ChartContainer)

**文件**: `/src/components/ui/chart.tsx`

`ChartContainer` 是所有图表的基础包装组件，提供以下功能：

- **响应式布局**: 使用 `ResponsiveContainer` 自动适应容器尺寸
- **主题管理**: 通过 CSS 变量注入颜色配置
- **暗色模式支持**: 自动适配 `light` / `dark` 主题

```typescript
export type ChartConfig = {
  [k in string]: {
    label?: React.ReactNode;
    icon?: React.ComponentType;
  } & (
    | { color?: string; theme?: never }
    | { color?: never; theme: Record<keyof typeof THEMES, string> }
  );
};
```

使用示例：

```typescript
const chartConfig = {
  p50: { label: "P50", color: "var(--chart-2)" },
  p95: { label: "P95", color: "var(--chart-4)" },
  p99: { label: "P99", color: "var(--chart-1)" },
} satisfies ChartConfig;
```

### 用户统计图表 (UserStatisticsChart)

**文件**: `/src/app/[locale]/dashboard/_components/statistics/chart.tsx`

**功能特性**:

- **双指标展示**: 支持消费金额 (cost) 和 API 调用次数 (calls) 切换
- **双模式显示**:
  - Overlay 模式: 多用户重叠显示，按数值降序渲染避免遮挡
  - Stacked 模式: 数值堆叠显示
- **用户选择**: Admin 模式下可选择显示特定用户（至少保留一个）
- **24色调色板**: 使用 HSL 色彩空间，确保多用户场景下的可辨识度

**颜色系统**:

```typescript
const USER_COLOR_PALETTE = [
  "var(--chart-1)", "var(--chart-2)", "var(--chart-3)",
  "var(--chart-4)", "var(--chart-5)",
  // ... 共 24 个颜色（5 个 CSS 变量 + 19 个 HSL 值）
  "hsl(295, 85%, 70%)",
] as const;
```

### Bento 统计卡片 (StatisticsChartCard)

**文件**: `/src/app/[locale]/dashboard/_components/bento/statistics-chart-card.tsx`

Dashboard 首页使用的紧凑图表组件，与 `UserStatisticsChart` 功能类似，但采用 Bento Grid 布局风格，适合在有限空间内展示关键趋势。

### 限流事件图表

#### 时间线图表 (RateLimitEventsChart)

**文件**: `/src/app/[locale]/dashboard/_components/rate-limit-events-chart.tsx`

- 展示小时级别的限流事件趋势
- 使用渐变填充的面积图
- 显示总事件数统计

#### 类型分布饼图 (RateLimitTypeBreakdown)

**文件**: `/src/app/[locale]/dashboard/_components/rate-limit-type-breakdown.tsx`

- 展示不同限流类型的占比分布
- 支持类型: `rpm`, `usd_5h`, `usd_weekly`, `usd_monthly`, `usd_total`,
  `concurrent_sessions`, `daily_quota`
- 自定义图例和百分比标签

### 供应商可用性图表

#### 延迟百分位图 (LatencyChart)

**文件**: `/src/app/[locale]/dashboard/availability/_components/provider/latency-chart.tsx`

- 展示 P50、P95、P99 延迟百分位
- 多供应商数据聚合
- 自动单位转换（ms → s）

#### 延迟曲线图 (LatencyCurve)

**文件**: `/src/app/[locale]/dashboard/availability/_components/endpoint/latency-curve.tsx`

- 单个端点的探测日志可视化
- 失败请求用红色圆点标记
- 显示统计信息（平均值、最小值、最大值）

#### 可用性泳道图 (LaneChart)

**文件**: `/src/app/[locale]/dashboard/availability/_components/provider/lane-chart.tsx`

**双模式可视化**（基于供应商总请求数判断）:

- **高数据量** (≥50 请求): 柱状图，高度表示请求量
- **低数据量** (<50 请求): 散点图，圆点表示存在数据

**颜色编码规则**:

| 可用性范围 | 颜色 | 状态 |
|-----------|------|------|
| ≥ 95% | Emerald (翠绿) | 优秀 |
| 80% - 95% | Lime (青柠) | 良好 |
| 50% - 80% | Orange (橙色) | 降级 |
| < 50% | Rose (玫瑰红) | 故障 |

### 实时监控大屏

**文件**: `/src/app/[locale]/internal/dashboard/big-screen/page.tsx`

**特性**:

- **2秒刷新**: 使用 SWR 实现实时数据更新
- **流量趋势图**: 24小时面积图
- **模型分布图**: 饼图展示模型使用占比
- **粒子动画背景**: Canvas 实现的动态背景
- **数字滚动动画**: 数值变化时的平滑过渡效果

## 数据模型

### 时间范围配置

**文件**: `/src/types/statistics.ts`

```typescript
export type TimeRange = "today" | "7days" | "30days" | "thisMonth";

export interface TimeRangeConfig {
  label: string;
  key: TimeRange;
  resolution: "hour" | "day";
  description?: string;
}

export const TIME_RANGE_OPTIONS: TimeRangeConfig[] = [
  { label: "today", key: "today", resolution: "hour",
    description: "todayDescription" },
  { label: "7days", key: "7days", resolution: "day",
    description: "7daysDescription" },
  { label: "30days", key: "30days", resolution: "day",
    description: "30daysDescription" },
  { label: "thisMonth", key: "thisMonth", resolution: "day",
    description: "thisMonthDescription" },
];
```

### 图表数据结构

```typescript
export interface ChartDataItem {
  date: string;  // ISO 格式日期字符串
  [key: string]: string | number;  // 动态键: "user-1_cost", "user-1_calls"
}

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
  dataKey: string;  // 格式: "user-{id}" 或 "key-{id}"
}
```

### 限流事件统计

```typescript
export type RateLimitType =
  | "rpm"
  | "usd_5h"
  | "usd_weekly"
  | "usd_monthly"
  | "usd_total"
  | "concurrent_sessions"
  | "daily_quota";

export interface RateLimitEventStats {
  total_events: number;
  events_by_type: Record<RateLimitType, number>;
  events_by_user: Record<number, number>;
  events_by_provider: Record<number, number>;
  events_timeline: EventTimeline[];
  avg_current_usage: number;
}
```

## 服务端实现

### 统计数据的三种显示模式

**文件**: `/src/actions/statistics.ts`

| 模式 | 适用场景 | 数据来源 |
|------|----------|----------|
| `users` | Admin 用户 | 所有用户数据 |
| `keys` | 普通用户 | 仅自己的 API Keys |
| `mixed` | 普通用户 + allowGlobalUsageView | 自己的 Keys + 其他用户汇总 |

### 数据库查询实现

**文件**: `/src/repository/statistics.ts`

#### 时区感知的时间桶生成

```sql
-- 今天（小时分辨率）
WITH hour_range AS (
  SELECT generate_series(
    DATE_TRUNC('day', TIMEZONE(${timezone}, NOW())),
    DATE_TRUNC('day', TIMEZONE(${timezone}, NOW())) + INTERVAL '23 hours',
    '1 hour'::interval
  ) AS hour
)

-- 7天/30天（天分辨率）
WITH date_range AS (
  SELECT generate_series(
    (CURRENT_TIMESTAMP AT TIME ZONE ${timezone})::date - INTERVAL '6 days',
    (CURRENT_TIMESTAMP AT TIME ZONE ${timezone})::date,
    '1 day'::interval
  )::date AS date
)
```

#### 数据聚合模式

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

**关键设计点**:

- `CROSS JOIN`: 确保所有时间桶都有记录，即使没有数据
- `EXCLUDE_WARMUP_CONDITION`: 过滤健康检查请求
- `resolveSystemTimezone()`: 统一时区处理
- `COALESCE`: 处理 NULL 值为 0

## 工具函数

### 日期格式化

**文件**: `/src/lib/utils/date-format.ts`

```typescript
// 时区感知的日期格式化
export function formatDate(
  date: Date | number | string,
  formatString: string,
  locale: string = "zh-CN",
  timezone?: string
): string {
  const dateObj = typeof date === "string" ? new Date(date) : date;
  const dateFnsLocale = getDateFnsLocale(locale);

  if (timezone) {
    return formatInTimeZone(dateObj, timezone, formatString, {
      locale: dateFnsLocale,
    });
  }
  return format(dateObj, formatString, { locale: dateFnsLocale });
}
```

支持的 locale: `zh-CN`, `zh-TW`, `en`, `ru`, `ja`

### 货币格式化

```typescript
// 使用 Decimal.js 防止浮点精度问题
const costDecimal = toDecimal(day[costKey]);
normalized[costKey] = costDecimal
  ? Number(costDecimal.toDecimalPlaces(6).toString())
  : 0;
```

## 边缘情况处理

### 空数据状态

所有图表组件都实现了空数据优雅降级：

```typescript
if (chartData.length === 0) {
  return (
    <div className="flex items-center justify-center h-[300px]
                    text-muted-foreground">
      {t("noData")}
    </div>
  );
}
```

### 数值溢出保护

```typescript
if (errorMessage.includes("numeric field overflow")) {
  return {
    ok: false,
    error: "数据金额过大，请检查数据库中的费用记录",
  };
}
```

### 单用户约束

用户选择至少保留一个选中项：

```typescript
const toggleUserSelection = (userId: number) => {
  setSelectedUserIds((prev) => {
    const next = new Set(prev);
    if (next.has(userId)) {
      if (next.size > 1) {  // 防止取消最后一个
        next.delete(userId);
      }
    } else {
      next.add(userId);
    }
    return next;
  });
};
```

### 时区回退

```typescript
const timeZone = useTimeZone() ?? "UTC";
```

## 文件结构

### 核心文件

| 文件路径 | 说明 |
|----------|------|
| `/src/components/ui/chart.tsx` | 图表容器和工具组件 |
| `/src/types/statistics.ts` | TypeScript 类型定义 |
| `/src/actions/statistics.ts` | 统计数据 Server Actions |
| `/src/repository/statistics.ts` | 数据库查询实现 |
| `/src/lib/utils/date-format.ts` | 日期格式化工具 |

### 图表组件

| 文件路径 | 图表类型 | 用途 |
|----------|----------|------|
| `/src/app/[locale]/dashboard/_components/statistics/chart.tsx` | 面积图 | 用户统计（消费/调用） |
| `/src/app/[locale]/dashboard/_components/bento/statistics-chart-card.tsx` | 面积图 | Bento 布局统计卡片 |
| `/src/app/[locale]/dashboard/_components/rate-limit-events-chart.tsx` | 面积图 | 限流事件时间线 |
| `/src/app/[locale]/dashboard/_components/rate-limit-type-breakdown.tsx` | 饼图 | 限流类型分布 |
| `/src/app/[locale]/dashboard/availability/_components/provider/latency-chart.tsx` | 面积图 | 供应商延迟百分位 |
| `/src/app/[locale]/dashboard/availability/_components/endpoint/latency-curve.tsx` | 折线图 | 端点延迟曲线 |
| `/src/app/[locale]/dashboard/availability/_components/provider/lane-chart.tsx` | 自定义 | 可用性可视化 |
| `/src/app/[locale]/internal/dashboard/big-screen/page.tsx` | 混合 | 实时监控大屏 |

### 支持组件

| 文件路径 | 用途 |
|----------|------|
| `/src/app/[locale]/dashboard/_components/statistics/time-range-selector.tsx` | 时间范围选择器 |

### 测试文件

| 文件路径 | 覆盖范围 |
|----------|----------|
| `/tests/unit/dashboard/availability/latency-chart.test.tsx` | 供应商延迟百分位图表 |
| `/tests/unit/dashboard/availability/latency-curve.test.tsx` | 端点延迟曲线图表 |

## API 接口

以下接口基于 Next.js Server Actions 实现，非传统 REST API。

### 统计数据接口

**Action**: `statistics.getUserStatistics`

**请求参数**:

```json
{
  "timeRange": "today" | "7days" | "30days" | "thisMonth"
}
```

**响应结构**:

```json
{
  "chartData": [
    { "date": "2024-01-01T00:00:00.000Z", "user-1_cost": 1.23,
      "user-1_calls": 100 }
  ],
  "users": [{ "id": 1, "name": "User1", "dataKey": "user-1" }],
  "timeRange": "today",
  "resolution": "hour",
  "mode": "users"
}
```

### 限流统计接口

**Action**: `rateLimitStats.getRateLimitStats`

**请求参数**:

```json
{
  "user_id?": number,
  "provider_id?": number,
  "limit_type?": RateLimitType,
  "start_time?": Date,
  "end_time?": Date
}
```

## 最佳实践

### 添加新图表类型

遵循以下步骤添加新的图表组件：

1. **定义配置**: 创建 `ChartConfig` 对象
2. **数据转换**: 在 Server Action 中转换为 `ChartDataItem` 格式
3. **使用容器**: 使用 `ChartContainer` 包装 Recharts 组件
4. **处理空状态**: 始终实现空数据展示
5. **添加测试**: 为颜色绑定和空状态编写单元测试

### 颜色使用规范

- 使用 CSS 变量：`var(--chart-1)` 到 `var(--chart-5)`
- 避免直接硬编码颜色值
- 多用户场景使用 `USER_COLOR_PALETTE` 循环分配

### 性能优化

- 数据库层面聚合数据，减少传输量
- 使用 `useMemo` 缓存图表数据转换
- 大数据量时考虑虚拟化或采样

### 国际化

- 所有标签使用 `useTranslations` 获取
- 日期格式化使用 `date-fns-tz` 支持时区
- 数字格式化使用 `toLocaleString()`

## 总结

Claude Code Hub 的图表可视化系统具有以下特点：

1. **分层架构**: 清晰的数据流，从 PostgreSQL 到 React 组件
2. **灵活时间维度**: 四种预设时间范围，自动切换分辨率
3. **权限感知**: 根据用户角色显示不同数据范围
4. **多语言支持**: 完整的 i18n 和时区支持
5. **性能优化**: 数据库级聚合，减少前端计算
6. **容错设计**: 全面的空状态和错误处理
7. **主题适配**: CSS 变量支持亮暗主题切换

系统设计遵循可扩展原则，新图表类型可以通过复用现有模式快速实现。
